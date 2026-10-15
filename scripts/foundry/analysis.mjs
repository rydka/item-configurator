/**
 * Bridge between the Foundry layer and the pure analysis (`core/analyze.mjs`, `core/changes.mjs`).
 * `runAnalysis` is the ONLY place that calls `analyze()` and `buildChangeSet()`: the interface never touches them.
 */
import { MODULE_ID } from "../constants.mjs";
import { getAiConfig } from "../settings.mjs";
import { createOllamaResolver } from "../ai/resolver.mjs";
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
 * The Ollama resolver for the current settings (shared so the probe and the picked model are reused between the
 * warm-up and the analysis), or null when the AI is disabled.
 */
export function getResolver(parser) {
  const config = getAiConfig();
  if (!config.enabled) return null;
  const id = `${config.url}|${config.model}|${config.timeoutMs}`;
  if (cached?.id !== id) {
    const keys = parser.keysFromConfig(CONFIG.DND5E);
    cached = { id, resolver: createOllamaResolver({ ...config, fetch: (...args) => globalThis.fetch(...args), keys }) };
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

/** Quick synchronous plan used to preselect the type (C3); null when the parser cannot give one. */
export async function quickPlan(item) {
  try {
    const parser = await loadParser();
    const keys = parser.keysFromConfig(CONFIG.DND5E);
    return parser.parseItem?.(item.name, item.system?.description?.value ?? "", { itemType: item.type, keys }) ?? null;
  } catch (err) {
    console.debug(`${MODULE_ID} | quick plan unavailable`, err);
    return null;
  }
}

/** Base item (e.g. longsword) guessed from the item name, to inherit the base weapon / armor data. */
async function guessBaseItem(item, type) {
  if (!["weapon", "equipment"].includes(type)) return null;
  const ids = { ...CONFIG.DND5E.weaponIds, ...CONFIG.DND5E.armorIds, ...CONFIG.DND5E.shieldIds };
  const words = String(item.name).toLowerCase().split(/[^a-z]+/);
  const id = Object.keys(ids).find((key) => words.includes(key.toLowerCase()));
  if (!id) return null;
  try {
    // `Trait.getBaseItem(id, { fullItem })` returns nothing for these packs in dnd5e 6.0.6; the UUID is in the config
    return (await fromUuid(ids[id]))?.toObject?.() ?? null;
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
 * Identity of an item's content (`item.toObject()`), to notice an edit made between the analysis and "Apply".
 * @param {object} source
 * @returns {string}
 */
export const fingerprint = (source) => JSON.stringify(source);

/**
 * Analyze an item's description.
 * @param {Item} item
 * @param {object} options
 * @param {string} options.type            Target item type.
 * @param {string} [options.value]         Target `system.type.value`.
 * @param {string} [options.subtype]       Target `system.type.subtype`.
 * @param {boolean} [options.replace=false]
 * @param {boolean} [options.useAI]        Defaults to the setting.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ proposal: object, changeSet: object, fingerprint: string,
 *   rebuild: (replace: boolean, source?: object) => Promise<object> }>}
 *   `fingerprint` is that of the source the change set was computed on; `rebuild` recomputes the change set against
 *   the item as it is now (or against `source`), so that an edit made meanwhile is never overwritten (C13).
 */
export async function runAnalysis(item, { type, value = "", subtype = "", replace = false, useAI, signal } = {}) {
  const started = performance.now();
  const parser = await loadParser();
  const [{ analyze }, { buildChangeSet }] = await Promise.all([
    import("../core/analyze.mjs"), import("../core/changes.mjs")
  ]);
  const keys = parser.keysFromConfig(CONFIG.DND5E);
  const config = getAiConfig();
  const fallback = (useAI ?? config.enabled) ? getResolver(parser) : null;
  const source = item.toObject();

  const proposal = await analyze(
    { name: item.name, html: item.system?.description?.value ?? "", type, value, subtype, source },
    {
      parser, keys, fallback, signal, idGen: () => foundry.utils.randomID(), baseItem: await guessBaseItem(item, type),
      resolveSpell: await spellResolver(parser, item.system?.description?.value ?? "")
    }
  );
  proposal.durationMs = performance.now() - started;

  const rebuild = (replaceExisting, current = item.toObject()) => validateChangeSet(item, buildChangeSet(current, proposal, {
    replace: replaceExisting, parser
  }));
  return { proposal, changeSet: await rebuild(replace, source), rebuild, fingerprint: fingerprint(source) };
}
