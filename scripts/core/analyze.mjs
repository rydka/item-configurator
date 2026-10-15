/**
 * Pure orchestration of an analysis: parse the description (rules, then the optional fallback resolver), translate the
 * plan into dnd5e sources (item patch, activities, effects) and gather the type-based deductions. Nothing is compared
 * with the existing item here: that is `changes.mjs`. The parser is injected (`parser`), no Foundry global.
 */
import { clone, getPath, isPlain, leaves, randomId, setPath } from "./paths.mjs";

/** Consumable types that are used once and destroyed when empty, when the text does not say otherwise. */
export const SINGLE_USE_TYPES = ["potion", "food", "poison"];

/** Prefix of the placeholder UUID given to a spell that could not be found (keeps activity indices aligned). */
const MISSING_SPELL = "item-configurator.missing:";

/** Fields inherited from the base item (longsword, plate...), per item type. */
const BASE_PICKS = {
  weapon: ["damage.base", "damage.versatile", "range", "properties", "mastery", "type.baseItem"],
  equipment: ["armor.value", "armor.dex", "strength", "properties", "type.baseItem"]
};

const damageOf = (part) => {
  if (!part?.denomination) return null;
  const result = { number: part.number ?? 1, denomination: part.denomination };
  if (part.types?.length) result.types = [...part.types];
  if (part.bonus) result.bonus = part.bonus;
  return result;
};

/**
 * What the item inherits from its base item, for the leaves the text left empty. Returns a nested `system` fragment.
 * @param {object|null} baseItem   `toObject()` of the base item (same item type), or null.
 * @param {string} type            Target item type.
 * @param {object} system          Patch built from the text.
 * @returns {object}
 */
function baseFragment(baseItem, type, system) {
  const picks = BASE_PICKS[type];
  if (!picks || !baseItem?.system || baseItem.type !== type) return {};
  const fragment = {};
  for (const path of picks) {
    let value = getPath(baseItem.system, path);
    if (path.startsWith("damage.")) value = damageOf(value);
    if (path === "range") {
      value = (value?.value || value?.reach) ? { value: value.value, long: value.long, reach: value.reach, units: value.units } : null;
    }
    if (value instanceof Set) value = [...value];
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
    if (path === "properties") {
      // The text's properties (magical...) and the base item's are added together
      const own = getPath(system, "properties") ?? [];
      const missing = value.filter((property) => !own.includes(property));
      if (missing.length) setPath(system, "properties", [...own, ...missing]);
      continue;
    }
    const current = getPath(system, path);
    if (isPlain(value)) {
      for (const leaf of leaves(value, path)) {
        if (leaf.value === undefined || leaf.value === null || leaf.value === "") continue;
        if (getPath(system, leaf.path) === undefined) setPath(fragment, leaf.path, clone(leaf.value));
      }
    } else if (current === undefined) {
      setPath(fragment, path, clone(value));
    }
  }
  return fragment;
}

const wordsOf = (text) => String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Is every word of `fragment` in `sentence`, in the same order? */
function isSubsequence(fragment, sentence) {
  const words = wordsOf(sentence);
  let at = 0;
  for (const word of wordsOf(fragment)) {
    at = words.indexOf(word, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

/**
 * Clean the plan of what the library leaves behind (the plan given back is a copy):
 * - a utility activity with nothing in it (the library keeps the sentence of an extra damage that went to the attack);
 * - a leftover fragment of a sentence the rules did read (e.g. "The item and is" after the weight and the price).
 */
function cleanPlan(plan, parser, html) {
  const copy = clone(plan);
  const linked = new Set((copy.effects ?? []).map((effect) => effect.activity).filter(Number.isInteger));
  const empty = (a) => a.kind === "utility" && !a.activation && !a.attack && !a.save && !a.heal && !a.cast && !a.consume
    && !a.extraDamage && !a.damage?.length && !a.template && !a.range && !a.target;
  const kept = (copy.activities ?? []).filter((a) => !empty(a) || linked.has(a.index));
  if (kept.length !== (copy.activities ?? []).length) {
    const remap = new Map(kept.map((a, i) => [a.index, i]));
    kept.forEach((a, i) => { a.index = i; });
    for (const effect of copy.effects ?? []) effect.activity = remap.get(effect.activity) ?? null;
    copy.activities = kept;
  }

  const raws = [
    copy.details?.weight?.raw, copy.details?.price?.raw, copy.details?.weapon?.raw, copy.details?.armor?.raw,
    copy.details?.consumable?.raw, ...(copy.activities ?? []).flatMap((a) => [a.raw, a.heal?.raw, a.cast?.raw, a.consume?.raw]),
    ...(copy.effects ?? []).map((effect) => effect.raw)
  ].filter(Boolean);
  const sentences = parser.splitSentences(parser.htmlToText(html)).map((sentence) => sentence.text);
  copy.unrecognized = (copy.unrecognized ?? []).filter(({ text }) => {
    if (sentences.includes(text)) return true;
    const origin = sentences.find((sentence) => isSubsequence(text, sentence));
    return !(origin && raws.some((raw) => origin.includes(raw)));
  });
  return copy;
}

/** Map the resolver status of the library to the statuses the interface knows. */
function aiStatus(fallback, plan) {
  if (!fallback) return "off";
  const status = plan.fallback?.status ?? "unused";
  if (status === "unused" || status === "ok") return "ok";
  if (status === "timeout" || status === "unreachable") return status;
  return "error";
}

/**
 * Analyze the description of an item.
 * @param {object} input
 * @param {string} input.name        Item name.
 * @param {string} input.html        Description (HTML).
 * @param {string} input.type        Target item type.
 * @param {string} [input.value]     Target `system.type.value`.
 * @param {string} [input.subtype]   Target `system.type.subtype` (consumables).
 * @param {object} [input.source]    `item.toObject()` (not needed for the analysis itself).
 * @param {object} context
 * @param {object} context.parser    The `dnd5e-text-parser` API.
 * @param {object} [context.keys]    Valid dnd5e keys (`parser.keysFromConfig(CONFIG.DND5E)`).
 * @param {function} [context.fallback]      Fallback resolver (Ollama), or null for the rules alone.
 * @param {AbortSignal} [context.signal]
 * @param {function(): string} [context.idGen]      Generator of 16-character ids.
 * @param {object|null} [context.baseItem]  `toObject()` of the base weapon / armor.
 * @param {function(string): (string|null)} [context.resolveSpell]  Spell name -> UUID.
 * @param {number} [context.timeoutMs]      Deadline of the fallback pass (default: the resolver's `timeoutMs`).
 * @returns {Promise<object>}  The proposal (see `buildChangeSet`).
 */
export async function analyze({ name, html, type, value = "", subtype = "" }, {
  parser, keys, fallback = null, signal, idGen = randomId, baseItem = null, resolveSpell, timeoutMs
} = {}) {
  const started = Date.now();
  const deadline = timeoutMs ?? fallback?.timeoutMs;
  const parsed = fallback
    ? await parser.parseItemAsync(name, html, {
      keys, itemType: type, fallback, signal, ...(Number.isFinite(deadline) ? { timeoutMs: deadline } : {})
    })
    : parser.parseItem(name, html, { keys, itemType: type });
  const plan = cleanPlan(parsed, parser, html);

  // Deduction from the chosen type: a potion is used once and destroyed when empty. The library invents neither the
  // charge nor the destruction (it writes no `uses` for a consumable without charges), so the deduction carries both.
  const consumable = plan.details?.consumable;
  const unlimited = !plan.uses && !plan.recharge && !consumable?.charges && !consumable?.destroyOnEmpty;
  const deduceSingleUse = type === "consumable" && SINGLE_USE_TYPES.includes(value) && unlimited;
  const translated = clone(plan);
  if (deduceSingleUse) {
    translated.details ??= {};
    translated.details.consumable = { type: value, ...translated.details.consumable, charges: { max: 1 }, destroyOnEmpty: true };
  }

  const system = parser.toItemPatch(translated, { keys, item: { type } });
  const deduced = [];
  if (deduceSingleUse && system.uses) {
    deduced.push({ paths: ["system.uses"], label: { key: "item-configurator.Preview.Deduced.SingleUse", data: { type: value } } });
  }

  // The type chosen by the user wins over what the text suggests
  const chosen = [];
  if (value && type !== "container") {
    setPath(system, "type.value", value);
    chosen.push("system.type.value");
  }
  if (subtype && type === "consumable") {
    setPath(system, "type.subtype", subtype);
    chosen.push("system.type.subtype");
  }

  const base = baseFragment(baseItem, type, system);

  // Activities and effects, with ids. Spells that cannot be found keep a placeholder so that the indices of
  // `describe(plan)` (`activities.<n>`) stay valid; the placeholder activities are dropped afterwards.
  const effects = parser.toEffects(translated, { keys, idGen });
  const effectNotes = [...(effects.notes ?? [])];
  const missingSpells = [];
  const generated = parser.toActivities(translated, {
    keys, idGen, item: { type }, effects,
    resolveSpell: (spell) => {
      const uuid = resolveSpell?.(spell) ?? null;
      if (uuid) return uuid;
      missingSpells.push({ name: spell });
      return `${MISSING_SPELL}${spell}`;
    }
  });
  const activities = [...generated].map((activity) => (activity.spell?.uuid?.startsWith(MISSING_SPELL) ? null : activity));
  const notes = [
    ...(generated.notes ?? []),
    ...missingSpells.map(({ name: spell }) => ({ key: "dnd5e-text-parser.Note.SpellNotFound", data: { name: spell } })),
    ...effectNotes
  ];

  // Effects: the link with the plan is the flag set by the library; it is not written on the item
  const effectSources = [...effects].map((effect) => {
    const copy = clone(effect);
    if (copy.flags?.["dnd5e-text-parser"]) {
      delete copy.flags["dnd5e-text-parser"];
      if (!Object.keys(copy.flags).length) delete copy.flags;
    }
    return copy;
  });

  const now = Date.now();
  return {
    plan,
    target: { type, value, subtype },
    baseItem,
    ai: {
      status: aiStatus(fallback, plan),
      model: fallback?.lastRun?.model ?? null,
      calls: plan.fallback?.calls ?? 0,
      ms: fallback ? now - started : 0
    },
    durationMs: now - started,
    translation: {
      system, base, chosen, deduced,
      activities,                       // aligned with `activities.<n>` of `describe(plan)`; null = dropped
      effects: effectSources,
      effectsAligned: !effectNotes.length,
      notes
    }
  };
}
