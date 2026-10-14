/**
 * Ollama-backed FallbackResolver (contract of dnd5e-text-parser) with `resolveMany`.
 * Pure apart from the injected `fetch`. Never throws: any failure gives `null` entries and a status.
 */
import * as ollama from "./ollama.mjs";
import {
  ACTIVATIONS, ATTUNEMENTS, EFFECT_KINDS, PERIODS, buildMessages, buildSchema, enumFor, isQuoted
} from "./prompt.mjs";

const PROBE_CACHE_MS = 60000;
const MODEL_OPTIONS = { temperature: 0, seed: 0, num_ctx: 2048, num_predict: 512 };

const isInt = (v, min, max) => Number.isInteger(v) && (v >= min) && (v <= max);
const has = (keys, name, key) => enumFor(keys, name).includes(key);

/** Allowed `scope` values for an effect kind (null = no scope). */
function effectScopes(kind, keys) {
  switch ( kind ) {
    case "resistance": return enumFor(keys, "damageTypes");
    case "immunity": return [...enumFor(keys, "damageTypes"), ...enumFor(keys, "conditionTypes")];
    case "save": return [...enumFor(keys, "abilities"), "all"];
    case "check": return [...enumFor(keys, "abilities"), ...enumFor(keys, "skills"), "all"];
    case "advantage": return [...enumFor(keys, "abilities"), ...enumFor(keys, "skills"), ...enumFor(keys, "conditionTypes"), "all"];
    case "abilityScore": return enumFor(keys, "abilities");
    case "speed": return ["walk", "fly", "swim", "climb", "burrow"];
    case "attack": case "damage": return ["mwak", "rwak", "msak", "rsak", "all"];
    default: return null;
  }
}

function damagePart(fact, type) {
  const hasDice = (fact.number != null) || (fact.denomination != null);
  if ( hasDice && !(isInt(fact.number, 1, 100) && isInt(fact.denomination, 2, 100)) ) return { error: "dice out of bounds" };
  if ( !hasDice && (fact.bonus == null) ) return { error: "no dice nor bonus" };
  if ( (fact.bonus != null) && !isInt(fact.bonus, -30, 100) ) return { error: "bonus out of bounds" };
  return {
    part: {
      number: hasDice ? fact.number : null, denomination: hasDice ? fact.denomination : null,
      bonus: (fact.bonus != null) && (fact.bonus !== 0) ? String(fact.bonus) : "", type, raw: fact.evidence
    }
  };
}

/**
 * Validate one sentence's raw model facts and convert them to `Partial<ItemPlan>` facts.
 * @param {object|object[]} json  The model's entry `{ index, facts }` for the sentence, or its facts array.
 * @param {{ sentence: string }} request
 * @param {object} [keys]         dnd5e valid keys.
 * @returns {{ facts: object, rejected: { kind: string, evidence: string, reason: string }[], accepted: number }}
 */
export function toFacts(json, request, keys) {
  const list = Array.isArray(json) ? json : (Array.isArray(json?.facts) ? json.facts : []);
  const facts = {};
  const rejected = [];
  let accepted = 0;

  for ( const fact of list ) {
    const kind = fact?.kind;
    const evidence = typeof fact?.evidence === "string" ? fact.evidence : "";
    const reject = reason => rejected.push({ kind: String(kind), evidence, reason });
    if ( !fact || (typeof fact !== "object") ) { reject("not an object"); continue; }
    if ( !isQuoted(evidence, request.sentence) ) { reject("evidence not found in the sentence"); continue; }
    const single = name => (facts[name] ? (reject(`duplicate ${name}`), false) : true);

    switch ( kind ) {
      case "attack": {
        if ( !single("attack") ) continue;
        if ( (fact.bonus == null) && !["melee", "ranged"].includes(fact.attackType) ) { reject("no attack roll stated"); continue; }
        const bonus = fact.bonus ?? 0;
        if ( !isInt(bonus, -5, 30) ) { reject("attack bonus out of bounds"); continue; }
        facts.attack = {
          type: ["melee", "ranged"].includes(fact.attackType) ? fact.attackType : null,
          classification: ["weapon", "spell"].includes(fact.classification) ? fact.classification : null, bonus,
          raw: evidence
        };
        break;
      }
      case "damage": case "heal": {
        const type = (kind === "heal") ? "healing" : fact.damageType;
        if ( (kind === "damage") && !has(keys, "damageTypes", type) ) { reject("unknown damage type"); continue; }
        const { part, error } = damagePart(fact, type);
        if ( error ) { reject(error); continue; }
        (facts.damage ??= []).push(part);
        break;
      }
      case "save": {
        if ( !single("save") ) continue;
        if ( !has(keys, "abilities", fact.ability) ) { reject("unknown ability"); continue; }
        if ( !isInt(fact.dc, 5, 40) ) { reject("DC out of bounds"); continue; }
        facts.save = { ability: fact.ability, dc: fact.dc, onSave: fact.onSave === "half" ? "half" : "none", damage: [], raw: evidence };
        break;
      }
      case "uses": {
        if ( !single("uses") ) continue;
        if ( !isInt(fact.max, 1, 100) ) { reject("uses out of bounds"); continue; }
        if ( !PERIODS.includes(fact.period) ) { reject("unknown period"); continue; }
        facts.uses = { max: fact.max, period: fact.period, recoverFormula: null, raw: evidence };
        break;
      }
      case "activation": {
        if ( !single("activation") ) continue;
        if ( !ACTIVATIONS.includes(fact.activation) ) { reject("unknown activation"); continue; }
        if ( (fact.cost != null) && !isInt(fact.cost, 1, 10) ) { reject("activation cost out of bounds"); continue; }
        facts.activation = { type: fact.activation, cost: fact.cost ?? null, raw: evidence };
        break;
      }
      case "effect": {
        if ( !EFFECT_KINDS.includes(fact.effectKind) ) { reject("unknown effect kind"); continue; }
        const scopes = effectScopes(fact.effectKind, keys);
        if ( scopes && !scopes.includes(fact.scope) ) { reject("unknown effect scope"); continue; }
        const needsAmount = ["ac", "attack", "damage", "save", "check", "abilityScore", "speed"].includes(fact.effectKind);
        if ( needsAmount && !isInt(fact.amount, (fact.effectKind === "abilityScore") ? 1 : -30, 200) ) {
          reject("effect amount missing or out of bounds"); continue;
        }
        (facts.effects ??= []).push({
          kind: fact.effectKind, value: fact.amount ?? null, scope: scopes ? fact.scope : null, raw: evidence
        });
        break;
      }
      case "detail": {
        const details = (facts.details ??= {});
        if ( fact.rarity ) {
          if ( !has(keys, "itemRarity", fact.rarity) ) { reject("unknown rarity"); continue; }
          details.rarity = fact.rarity;
        } else if ( fact.attunement ) {
          if ( !ATTUNEMENTS.includes(fact.attunement) ) { reject("unknown attunement"); continue; }
          details.attunement = fact.attunement;
        } else { reject("empty detail"); continue; }
        break;
      }
      default:
        reject("unsupported kind");
        continue;
    }
    accepted++;
  }
  if ( facts.details && !Object.keys(facts.details).length ) delete facts.details;
  return { facts, rejected, accepted };
}

/**
 * Create the resolver.
 * @param {object} config
 * @param {string} [config.url]         Ollama address.
 * @param {string} [config.model]       Model name, "" or undefined = auto (first installed preferred model).
 * @param {number} [config.timeoutMs]   Maximum duration of one `/api/chat` call (default 20 000).
 * @param {function} config.fetch       Injected fetch.
 * @param {object} [config.keys]        dnd5e valid keys.
 * @param {function} [config.now]       Clock (tests).
 * @returns {function & { resolveMany: function, lastRun: object|null, ensureModel: function, warmUp: function }}
 */
export function createOllamaResolver({ url, model, timeoutMs = 20000, fetch, keys, now = () => Date.now() } = {}) {
  let probe = null; // { at, ok }
  let picked = null;

  async function reachable(signal) {
    if ( probe && ((now() - probe.at) < PROBE_CACHE_MS) ) return probe.ok;
    const ok = await ollama.ping(url, { fetch, signal });
    if ( !signal?.aborted ) probe = { at: now(), ok };
    return ok;
  }

  async function ensureModel(signal) {
    if ( model ) return model;
    if ( picked ) return picked;
    picked = ollama.pickDefaultModel(await ollama.listModels(url, { fetch, signal }));
    return picked;
  }

  /** Warm the model without awaiting the answer (caller ignores the promise). */
  async function warm(signal) {
    if ( !(await reachable(signal)) ) return false;
    const name = await ensureModel(signal);
    return name ? ollama.warmUp(url, name, { fetch, signal }) : false;
  }

  async function resolveMany(requests, { signal } = {}) {
    const started = now();
    const list = Array.isArray(requests) ? requests : [];
    const results = list.map(() => null);
    const run = { status: "ok", model: null, durationMs: 0, rejected: [] };
    const finish = status => {
      run.status = status;
      run.durationMs = now() - started;
      resolver.lastRun = run;
      results.status = run.status;
      results.rejected = run.rejected;
      return results;
    };
    try {
      if ( !list.length ) return finish("ok");
      if ( signal?.aborted ) return finish("aborted");
      if ( !(await reachable(signal)) ) return finish(signal?.aborted ? "aborted" : "unreachable");
      const name = await ensureModel(signal);
      if ( !name ) return finish("no-model");
      run.model = name;

      const answer = await ollama.chat(url, {
        model: name, format: buildSchema(keys), options: MODEL_OPTIONS, messages: buildMessages(list)
      }, { fetch, signal, timeoutMs });
      if ( !answer.ok ) {
        if ( answer.status === "unreachable" ) probe = null;
        return finish(answer.status === "http" ? "error" : answer.status);
      }
      const entries = Array.isArray(answer.json?.results) ? answer.json.results : null;
      if ( !entries ) return finish("invalid");

      for ( const entry of entries ) {
        const index = entry?.index;
        if ( !isInt(index, 0, list.length - 1) || results[index] ) continue;
        const { facts, rejected, accepted } = toFacts(entry, list[index], keys);
        for ( const r of rejected ) run.rejected.push({ index, sentence: list[index].sentence, ...r });
        if ( !accepted ) continue;
        results[index] = { facts, confidence: accepted / (accepted + rejected.length) };
      }
      return finish("ok");
    } catch(err) {
      run.error = String(err?.message ?? err);
      return finish("error");
    }
  }

  const resolver = async (request, options = {}) => (await resolveMany([request], options))[0] ?? null;
  resolver.resolveMany = resolveMany;
  resolver.ensureModel = ensureModel;
  resolver.warmUp = warm;
  resolver.lastRun = null;
  return resolver;
}
