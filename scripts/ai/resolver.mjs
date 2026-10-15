/**
 * FallbackResolver (contract of dnd5e-text-parser) with `resolveMany`, backed by Ollama or by Anthropic's Claude.
 * Both providers get the same prompt and schema (`prompt.mjs`) and the same hardened validation (`toFacts`).
 * Pure apart from the injected `fetch`. Never throws: any failure gives `null` entries and a status.
 */
import * as ollama from "./ollama.mjs";
import * as anthropic from "./anthropic.mjs";
import {
  ACTIVATIONS, BONUS_KINDS, EFFECT_KINDS, FACT_KINDS, PERIODS, buildMessages, buildSchema, enumFor, evidenceProblem, isQuoted, worthAsking
} from "./prompt.mjs";

const PROBE_CACHE_MS = 60000;
const MODEL_OPTIONS = { temperature: 0, seed: 0, num_ctx: 2048, num_predict: 512 };

const isInt = (v, min, max) => Number.isInteger(v) && (v >= min) && (v <= max);
const has = (keys, name, key) => enumFor(keys, name).includes(key);

/** Allowed `scope` values for an effect kind (null = no scope). */
function effectScopes(kind, keys) {
  switch ( kind ) {
    case "resistance": return enumFor(keys, "damageTypes");
    case "vulnerability": return enumFor(keys, "damageTypes");
    case "immunity": return [...enumFor(keys, "damageTypes"), ...enumFor(keys, "conditionTypes")];
    case "save": case "check": return [...enumFor(keys, "abilities"), "all"];
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
    if ( ["detail", "advantage", "disadvantage"].includes(kind) || ["advantage", "disadvantage"].includes(fact.effectKind) ) {
      reject("kind not allowed for the model (rarity, attunement, advantage, disadvantage)"); continue;
    }
    if ( !FACT_KINDS.includes(kind) ) { reject("unsupported kind"); continue; }
    const before = structuredClone(facts);
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
      case "damage": case "extraDamage": case "heal": {
        const type = (kind === "heal") ? "healing" : fact.damageType;
        if ( (kind !== "heal") && !has(keys, "damageTypes", type) ) { reject("unknown damage type"); continue; }
        if ( (kind !== "damage") && !single(kind) ) continue;
        const { part, error } = damagePart(fact, type);
        if ( error ) { reject(error); continue; }
        if ( kind === "damage" ) (facts.damage ??= []).push(part);
        else facts[kind] = part;
        break;
      }
      case "consume": {
        if ( !single("consume") ) continue;
        const amount = fact.amount ?? fact.charges;
        if ( !isInt(amount, 1, 100) ) { reject("consumed amount missing or out of bounds"); continue; }
        facts.consume = { target: "itemUses", amount, raw: evidence };
        break;
      }
      case "cast": {
        if ( !single("cast") ) continue;
        const spell = typeof fact.spell === "string" ? fact.spell.trim() : "";
        if ( !spell ) { reject("no spell name"); continue; }
        if ( (fact.dc != null) && !isInt(fact.dc, 5, 40) ) { reject("DC out of bounds"); continue; }
        facts.cast = {
          name: spell, level: isInt(fact.level, 0, 9) ? fact.level : null, dc: fact.dc ?? null,
          attack: isInt(fact.bonus, -5, 30) ? fact.bonus : null, charges: isInt(fact.charges, 1, 100) ? fact.charges : null,
          raw: evidence
        };
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
        // Same shapes as the rules: a bonus is a signed string, "all" is no scope
        const bonus = BONUS_KINDS.includes(fact.effectKind) && (fact.amount != null);
        const scope = (scopes && (fact.scope !== "all")) ? fact.scope : null;
        const effect = {
          kind: fact.effectKind, scope, raw: evidence,
          value: bonus ? `${(fact.amount >= 0) ? "+" : ""}${fact.amount}` : (fact.amount ?? null)
        };
        (facts.effects ??= []).push(effect);
        break;
      }
      default:
        reject("unsupported kind");
        continue;
    }
    // The quote must justify the fact (key word of its kind, every number it reports)
    const problem = evidenceProblem(fact, evidence);
    if ( problem ) {
      for ( const key of Object.keys(facts) ) delete facts[key];
      Object.assign(facts, before);
      reject(problem);
      continue;
    }
    accepted++;
  }
  return { facts, rejected, accepted };
}

/**
 * Shared skeleton of a `resolveMany` run: which sentences are worth asking, the run record, and the function that
 * closes the run with a status.
 * @param {object[]} requests
 * @param {{ now: function(): number, resolver: function }} context
 */
function startRun(requests, { now, resolver }) {
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
  // Only a sentence with a number or a key word can hold a mechanic the rules missed
  const asked = list.map((request, at) => ({ request, at })).filter(({ request }) => worthAsking(request.sentence));
  return { results, run, finish, asked };
}

/** Validate the entries of the model (`{ results: [{ index, facts }] }`) and fill `results`; false when malformed. */
function collect(json, { asked, results, run, keys }) {
  const entries = Array.isArray(json?.results) ? json.results : null;
  if ( !entries ) return false;
  for ( const entry of entries ) {
    const index = entry?.index;
    if ( !isInt(index, 0, asked.length - 1) ) continue;
    const { at, request } = asked[index];
    if ( results[at] ) continue;
    const { facts, rejected, accepted } = toFacts(entry, request, keys);
    for ( const r of rejected ) run.rejected.push({ index: at, sentence: request.sentence, ...r });
    if ( !accepted ) continue;
    results[at] = { facts, confidence: accepted / (accepted + rejected.length) };
  }
  return true;
}

/**
 * Create the Ollama resolver.
 * @param {object} config
 * @param {string} [config.url]         Ollama address.
 * @param {string} [config.model]       Model name, "" or undefined = auto (first installed preferred model).
 * @param {number} [config.timeoutMs]   Maximum duration of one `/api/chat` call (default 20 000).
 * @param {function} config.fetch       Injected fetch.
 * @param {object} [config.keys]        dnd5e valid keys.
 * @param {function} [config.now]       Clock (tests).
 * @returns {function & { resolveMany: function, lastRun: object|null, ensureModel: function, warmUp: function,
 *   timeoutMs: number, provider: "ollama" }}
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
    const { results, run, finish, asked } = startRun(requests, { now, resolver });
    try {
      if ( !asked.length ) return finish("ok");
      if ( signal?.aborted ) return finish("aborted");
      if ( !(await reachable(signal)) ) return finish(signal?.aborted ? "aborted" : "unreachable");
      const name = await ensureModel(signal);
      if ( !name ) return finish("no-model");
      run.model = name;

      const answer = await ollama.chat(url, {
        model: name, format: buildSchema(keys), options: MODEL_OPTIONS, messages: buildMessages(asked.map(({ request }) => request))
      }, { fetch, signal, timeoutMs });
      if ( !answer.ok ) {
        if ( answer.status === "unreachable" ) probe = null;
        return finish(answer.status === "http" ? "error" : answer.status);
      }
      if ( !collect(answer.json, { asked, results, run, keys }) ) return finish("invalid");
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
  resolver.timeoutMs = timeoutMs;
  resolver.provider = "ollama";
  resolver.lastRun = null;
  return resolver;
}

/**
 * Create the Anthropic (Claude) resolver. Same prompt, schema and validation as the Ollama one; nothing is sent
 * without an API key (`lastRun.status = "noKey"`). Usable from Node with an explicit configuration (no `game`).
 * @param {object} config
 * @param {string} config.apiKey        Anthropic API key (client-scoped setting in Foundry).
 * @param {string} [config.model]       `claude-sonnet-5-5` (default) or `claude-opus-5-5`.
 * @param {string} [config.effort]      `low` (default), `medium` or `high`.
 * @param {number} [config.timeoutMs]   Maximum duration of one call, retry included (default 20 000).
 * @param {function} [config.fetch]     Injected fetch (defaults to the global one).
 * @param {object} [config.keys]        dnd5e valid keys.
 * @param {function} [config.now]       Clock (tests).
 * @returns {function & { resolveMany: function, lastRun: object|null, ensureModel: function, warmUp: function,
 *   timeoutMs: number, provider: "anthropic" }}
 *   `lastRun` also carries `usage` (`{ input, output }` tokens, or null) and `retried`, for the cost measurement.
 */
export function createAnthropicResolver({
  apiKey, model = anthropic.DEFAULT_MODEL, effort = anthropic.DEFAULT_EFFORT, timeoutMs = 20000,
  fetch = (...args) => globalThis.fetch(...args), keys, now = () => Date.now()
} = {}) {
  const name = anthropic.MODELS.includes(model) ? model : anthropic.DEFAULT_MODEL;

  async function resolveMany(requests, { signal } = {}) {
    const { results, run, finish, asked } = startRun(requests, { now, resolver });
    run.model = name;
    run.usage = null;
    run.retried = false;
    try {
      if ( !asked.length ) return finish("ok");
      if ( signal?.aborted ) return finish("aborted");
      if ( !String(apiKey ?? "").trim() ) return finish("noKey");

      const [system, ...messages] = buildMessages(asked.map(({ request }) => request));
      const answer = await anthropic.complete({ apiKey, model: name, effort }, {
        system: system.content, messages, schema: buildSchema(keys)
      }, { fetch, signal, timeoutMs, now });
      run.usage = answer.usage ?? null;
      run.retried = Boolean(answer.retried);
      if ( answer.error ) run.error = answer.error;
      if ( !answer.ok ) return finish(answer.status === "http" ? "error" : answer.status);
      if ( !collect(answer.json, { asked, results, run, keys }) ) return finish("invalid");
      return finish("ok");
    } catch(err) {
      run.error = String(err?.message ?? err);
      return finish("error");
    }
  }

  const resolver = async (request, options = {}) => (await resolveMany([request], options))[0] ?? null;
  resolver.resolveMany = resolveMany;
  resolver.ensureModel = async () => name;
  resolver.warmUp = async () => false;
  resolver.timeoutMs = timeoutMs;
  resolver.provider = "anthropic";
  resolver.lastRun = null;
  return resolver;
}

/**
 * The resolver of an AI configuration (shape of `getAiConfig()`): Ollama unless `provider` is `anthropic`.
 * @param {object} config   `{ provider, url, model, timeoutMs, apiKey, anthropicModel, effort, fetch, keys, now }`
 * @returns {function}
 */
export function createResolver(config = {}) {
  if ( config.provider === "anthropic" ) return createAnthropicResolver({ ...config, model: config.anthropicModel });
  return createOllamaResolver(config);
}
