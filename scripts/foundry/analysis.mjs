/**
 * Bridge between the Foundry layer and the pure analysis (`core/analyze.mjs`, `core/changes.mjs`).
 * `runAnalysis` is the ONLY place that calls `analyze()` and `buildChangeSet()`: the interface never touches them.
 */
import { MODULE_ID } from "../constants.mjs";
import { getAiConfig } from "../settings.mjs";
import { createResolver } from "../ai/resolver.mjs";
import * as anthropic from "../ai/anthropic.mjs";
import { readHeader } from "../core/header.mjs";
import { validateChangeSet } from "./apply.mjs";

const PARSER_URL = "/modules/dnd5e-text-parser/scripts/index.mjs";
let parserPromise = null;

/** Load the shared parser library (once) and check its major version. */
export function loadParser() {
  parserPromise ??= import(PARSER_URL).then((parser) => {
    if (String(parser.API_VERSION ?? "").split(".")[0] !== "1") {
      throw new Error(game.i18n.format(`${MODULE_ID}.errors.parserVersion`, { version: parser.API_VERSION }));
    }
    return parser;
  }).catch((err) => {
    parserPromise = null;
    throw err;
  });
  return parserPromise;
}

/** Plain text of an HTML description, without executing anything. */
export function descriptionText(html) {
  return new DOMParser().parseFromString(String(html ?? ""), "text/html").body.textContent.trim();
}

let cached = null;

/**
 * The AI resolver (Ollama or Anthropic) for the current settings, shared so the Ollama probe and the picked model are
 * reused between the warm-up and the analysis; null when the AI is disabled. The Anthropic resolver sends nothing
 * without an API key.
 */
export function getResolver(parser) {
  const config = getAiConfig();
  if (!config.enabled) return null;
  const id = JSON.stringify(config);
  if (cached?.id !== id) {
    const keys = parser.keysFromConfig(CONFIG.DND5E);
    cached = { id, resolver: createResolver({ ...config, fetch: (...args) => globalThis.fetch(...args), keys }) };
  }
  return cached.resolver;
}

/** Start loading the AI model without waiting for it (called when the type window opens). */
export async function warmUpAi() {
  try {
    const parser = await loadParser();
    await getResolver(parser)?.warmUp();
  } catch (err) {
    console.debug(`${MODULE_ID} | AI warm-up skipped`, err);
  }
}

/**
 * Quick synchronous plan used to preselect the type (C3); null when the parser cannot give one. The header line of
 * the description ("Armor (plate), rare"), which the library reads but does not keep, is added as `plan.header`.
 */
export async function quickPlan(item) {
  try {
    const parser = await loadParser();
    const keys = parser.keysFromConfig(CONFIG.DND5E);
    const html = item.system?.description?.value ?? "";
    const plan = parser.parseItem?.(item.name, html, { itemType: item.type, keys }) ?? null;
    if (plan) plan.header = readHeader(parser.htmlToText(html));
    return plan;
  } catch (err) {
    console.debug(`${MODULE_ID} | quick plan unavailable`, err);
    return null;
  }
}

const wordsOf = (text) => String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .split(/[^a-z0-9]+/).filter(Boolean);

/** Is `part` a run of consecutive words of `words`? */
function hasRun(words, part) {
  if (!part.length) return false;
  return words.some((_, at) => part.every((word, i) => words[at + i] === word));
}

let baseItems = null;

/**
 * Names of the base weapons, armors and shields of the dnd5e configuration, read once from the compendium indexes.
 * @returns {Promise<{ uuid: string, type: string, words: string[] }[]>}
 */
async function baseItemNames() {
  if (baseItems) return baseItems;
  const groups = [["weapon", CONFIG.DND5E.weaponIds], ["equipment", CONFIG.DND5E.armorIds], ["equipment", CONFIG.DND5E.shieldIds]];
  const list = [];
  for (const [type, ids] of groups) {
    for (const uuid of Object.values(ids ?? {})) {
      const parsed = foundry.utils.parseUuid(uuid);
      const pack = parsed?.collection;
      if (!pack?.getIndex) continue;
      const name = (await pack.getIndex()).get(parsed.documentId ?? parsed.id)?.name;
      if (name) list.push({ uuid, type, words: wordsOf(name) });
    }
  }
  baseItems = list;
  return list;
}

/**
 * Base item (e.g. longsword) whose full name appears in the item name, to inherit the base weapon / armor data.
 * A single generic word ("hide", "plate", "leather") is not enough: "Boots of Leather Striding" must not inherit the
 * AC of the leather armor. The longest matching name wins ("Half Plate Armor" over "Plate Armor").
 */
async function guessBaseItem(item, type) {
  if (!["weapon", "equipment"].includes(type)) return null;
  const words = wordsOf(item.name);
  const match = (await baseItemNames())
    .filter((base) => base.type === type && hasRun(words, base.words))
    .sort((a, b) => b.words.length - a.words.length)[0];
  if (!match) return null;
  try {
    // `Trait.getBaseItem(id, { fullItem })` returns nothing for these packs in dnd5e 6.0.6; the UUID is in the config
    return (await fromUuid(match.uuid))?.toObject?.() ?? null;
  } catch {
    return null;
  }
}

const SPELL_PACKS = ["dnd5e.spells24", "dnd5e.spells"];
let spellIndex = null;

/**
 * Name -> UUID lookup for the spells an item can cast ("you can cast fireball from it"), built from the dnd5e spell
 * compendiums. The index is only loaded when the description talks about casting. English names only.
 * @returns {Promise<function(string): (string|null)|undefined>}
 */
async function spellResolver(parser, html) {
  if (!/\b(cast|lanc|incant)/i.test(descriptionText(html))) return undefined;
  if (!spellIndex) {
    const map = new Map();
    for (const id of SPELL_PACKS) {
      const pack = game.packs.get(id);
      if (!pack) continue;
      for (const entry of await pack.getIndex()) {
        const key = parser.nameKey(entry.name);
        if (!map.has(key)) map.set(key, entry.uuid);
      }
    }
    spellIndex = map;
  }
  return (name) => spellIndex.get(parser.nameKey(name)) ?? null;
}

/**
 * Would converting the item to `type` orphan its contents? dnd5e 6.0.6 has no handling for a container that changes
 * type: the contained items keep `system.container` pointing at it and vanish from every view. The conversion of a
 * non-empty container is refused (the contents can be moved out first).
 * @param {Item} item
 * @param {string} type   Target item type.
 * @returns {Promise<boolean>}
 */
export async function containerNotEmpty(item, type) {
  if (item.type !== "container" || type === "container") return false;
  return ((await item.system?.contentsCount) ?? 0) > 0;
}

/**
 * Identity of an item's content (`item.toObject()`), to notice an edit made between the analysis and "Apply".
 * @param {object} source
 * @returns {string}
 */
export const fingerprint = (source) => JSON.stringify(source);

/** Is the "Claude first" mode on: AI enabled, Anthropic provider (the key is checked by the analysis itself)? */
export function claudeMode(useAI) {
  const config = getAiConfig();
  return Boolean(useAI ?? config.enabled) && config.provider === "anthropic";
}

/** Localized label of a dnd5e configuration entry (`{ label }` or a string), or "". */
const configLabel = (table, key) => {
  const def = key ? table?.[key] : null;
  if (!def) return "";
  const label = typeof def === "string" ? def : def.label;
  return label ? game.i18n.localize(label) : "";
};

/** Localized labels of the chosen type, subtype and consumable subtype, sent to Claude next to their keys. */
function typeLabels(type, value, subtype) {
  const config = CONFIG.DND5E ?? {};
  const tables = [config.weaponTypes, config.equipmentTypes, config.consumableTypes, config.toolTypes, config.lootTypes];
  return {
    type: game.i18n.has(`${MODULE_ID}.Type.${type}`) ? game.i18n.localize(`${MODULE_ID}.Type.${type}`) : "",
    value: tables.map((table) => configLabel(table, value)).find(Boolean) ?? "",
    subtype: configLabel(config.consumableTypes?.[value]?.subtypes, subtype)
  };
}

/** Does the world measure lengths in metres (dnd5e setting)? */
function metricWorld() {
  try {
    return Boolean(game.settings.get("dnd5e", "metricLengthUnits"));
  } catch {
    return false;
  }
}

let claudeEnums = null;

/**
 * The single Claude call of the "Claude first" mode, bound to the current settings; undefined without a key in this
 * browser or for a player (the analysis then reads as "no key": rules alone). Nothing is sent before it is called.
 */
function claudeCompletion(config) {
  if (!game.user?.isGM || !config.apiKey) return undefined;
  return (request, { signal } = {}) => anthropic.complete(
    { apiKey: config.apiKey, model: config.anthropicModel, effort: config.effort },
    request,
    { fetch: (...args) => globalThis.fetch(...args), signal, timeoutMs: config.anthropicTimeoutMs }
  );
}

/**
 * Analyze an item's description.
 * @param {Item} item
 * @param {object} options
 * @param {string} options.type            Target item type.
 * @param {string} [options.value]         Target `system.type.value`.
 * @param {string} [options.subtype]       Target `system.type.subtype`.
 * @param {boolean} [options.replace=false]
 * @param {boolean} [options.useAI]        Defaults to the setting.
 * @param {AbortSignal} [options.signal]   Aborting it cancels the AI call (Claude or Ollama): the rules alone remain.
 * @param {function(object): void} [options.onProgress]   Claude first: `{ step: "rules"|"claude"|"validate" }`.
 * @returns {Promise<{ proposal: object, changeSet: object, fingerprint: string,
 *   rebuild: (replace: boolean, source?: object) => Promise<object> }>}
 *   `fingerprint` is that of the source the change set was computed on; `rebuild` recomputes the change set against
 *   the item as it is now (or against `source`), so that an edit made meanwhile is never overwritten (C13).
 */
export async function runAnalysis(item, { type, value = "", subtype = "", replace = false, useAI, signal, onProgress } = {}) {
  const started = performance.now();
  if (await containerNotEmpty(item, type)) throw new Error(game.i18n.localize(`${MODULE_ID}.Messages.ContainerNotEmpty`));
  const parser = await loadParser();
  const [{ analyze }, { buildChangeSet }] = await Promise.all([
    import("../core/analyze.mjs"), import("../core/changes.mjs")
  ]);
  const keys = parser.keysFromConfig(CONFIG.DND5E);
  const config = getAiConfig();
  const aiOn = useAI ?? config.enabled;
  const source = item.toObject();
  const html = item.system?.description?.value ?? "";
  const input = { name: item.name, html, type, value, subtype, source };
  const context = {
    parser, keys, signal, idGen: () => foundry.utils.randomID(), baseItem: await guessBaseItem(item, type),
    resolveSpell: await spellResolver(parser, html)
  };

  let proposal;
  if (aiOn && config.provider === "anthropic") {
    // Claude first: the rules and one Claude call in parallel, validation, cross-check; rules alone on any failure
    const [{ analyzeClaudeFirst }, { schemaEnums }] = await Promise.all([
      import("../core/analyze-claude.mjs"), import("../ai/claude-schema.mjs")
    ]);
    claudeEnums ??= schemaEnums(CONFIG.DND5E, CONST);
    proposal = await analyzeClaudeFirst(input, {
      ...context, enums: claudeEnums, complete: claudeCompletion(config), onProgress,
      labels: typeLabels(type, value, subtype), metric: metricWorld()
    });
  } else {
    proposal = await analyze(input, { ...context, fallback: aiOn ? getResolver(parser) : null });
  }
  proposal.durationMs = performance.now() - started;

  const rebuild = (replaceExisting, current = item.toObject()) => validateChangeSet(item, buildChangeSet(current, proposal, {
    replace: replaceExisting, parser
  }));
  return { proposal, changeSet: await rebuild(replace, source), rebuild, fingerprint: fingerprint(source) };
}
