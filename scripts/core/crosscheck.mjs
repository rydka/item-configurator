/**
 * Cross-check of the two independent readings of a description: the rules (`parser.parseItem` plan) and Claude
 * (validated answer, see `ai/claude-validate.mjs`). The numbered facts of both (dice, DCs, bonuses, AC, uses,
 * activation, durations, distances, rarity, attunement) are extracted, matched paragraph by paragraph and sorted into
 * agreements, conflicts, Claude-only and rules-only facts. Pure: no Foundry global, nothing is written.
 *
 * Fact = { family, value, display, paragraph, ref, path, patch, canon, critical, inferred, raw }
 * - `value`: normalized form, compared as a string (`1d6+@prof:temphp`, `15`, `check:sur=2`, `1/lr`, seconds, feet);
 * - `paragraph`: 0-based index in `paragraphs` of the quote / source passage, or null when it was not found;
 * - `ref`: the element the fact belongs to (`a1`, `e1`, `uses`, `details.rarity` for Claude; `activities.<n>`,
 *   `effects.<n>`, `uses`, `details.<field>` for the rules, `<n>` being the index in the plan);
 * - `path`: where the element lands in the proposal (`activities.<n>`, `effects.<n>`, `system.<field>`): for Claude,
 *   `<n>` is the index in `item.activities` / `item.effects` of the validated answer (`buildFromClaude` keeps it);
 * - `patch`: `[{ field, form, data }]`, the dnd5e-shaped value(s) the fact writes, relative to the element (`healing`,
 *   `save.dc.formula`, `changes.<j>.value`, `duration`) or absolute for details (`system.armor.value`). In a conflict, the
 *   rules' alternative is rendered in the `form` of Claude's fields, so that a click writes it in Claude's element;
 * - `canon`: the family's canonical value, from which `render` builds any form.
 */
import { normalizeQuote } from "../ai/prompt.mjs";

/** Fact families; `critical` ones are those where a wrong value is a critical error (M3). */
export const FAMILIES = Object.freeze({
  dice: { critical: true },
  dc: { critical: true },
  attackBonus: { critical: true },
  magicalBonus: { critical: true },
  ac: { critical: true },
  effectBonus: { critical: true },
  uses: { critical: false },
  activation: { critical: false },
  duration: { critical: false },
  distance: { critical: false },
  rarity: { critical: false },
  attunement: { critical: false }
});

/** Which reading is proposed in a conflict, per family (tuned on the training sets only). */
export const CROSSCHECK_POLICY = Object.freeze(Object.fromEntries(Object.keys(FAMILIES).map((f) => [f, "claude"])));

/** Families with at most one fact per item, matched by family alone (the header line is not a quoted paragraph). */
const ITEM_LEVEL = new Set(["rarity", "attunement", "magicalBonus", "ac"]);

/** Effect kinds whose value is a number the two readings can disagree on. */
const BONUS_KINDS = ["ac", "attack", "damage", "save", "check", "abilityScore", "speed", "damageReduction", "sense", "speedMultiplier"];

/** Seconds of a duration unit (dnd5e `timePeriods`, singular, and their Foundry plural names); a turn is a round. */
const UNIT_SECONDS = {
  turn: 6, turns: 6, round: 6, rounds: 6, second: 1, seconds: 1, minute: 60, minutes: 60, hour: 3600, hours: 3600,
  day: 86400, days: 86400, month: 2592000, months: 2592000, year: 31536000, years: 31536000
};
/** Plural (Foundry) name of each dnd5e time period, as Claude or the plan may give either. */
const PLURAL_UNITS = { turn: "turns", round: "rounds", second: "seconds", minute: "minutes", hour: "hours", day: "days", month: "months", year: "years" };
const ACTIVITY_UNITS = Object.fromEntries(Object.entries(PLURAL_UNITS).map(([a, e]) => [e, a]));

/** Feet of a distance unit; `null` when the unit is not a length (`self`, `touch`, `any`, `spec`...). */
const UNIT_FEET = { ft: 1, feet: 1, mi: 5280, m: 10 / 3, km: 10000 / 3 };

const num = (value) => {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const text = (value) => (typeof value === "string" ? value : "");
const list = (value) => (Array.isArray(value) ? value : []);

/* -------------------------------------------- */
/*  Paragraphs                                   */
/* -------------------------------------------- */

/**
 * Locate quotes in the paragraphs of the description (strings, or `{ text }`), after `normalizeQuote`.
 * @param {(string|{ text: string })[]} paragraphs
 * @returns {function(string): (number|null)}  Index of the first paragraph containing the quote, or null.
 */
export function paragraphLocator(paragraphs) {
  const normalized = list(paragraphs).map((p) => ` ${normalizeQuote(typeof p === "string" ? p : p?.text)} `);
  return (quote) => {
    const needle = normalizeQuote(quote);
    if (needle.length < 3) return null;
    const at = normalized.findIndex((p) => p.includes(` ${needle} `));
    return at >= 0 ? at : null;
  };
}

/** First paragraph one of the quotes resolves to, or null. */
const firstParagraph = (locate, quotes) => {
  for (const quote of list(quotes)) {
    const at = locate(quote);
    if (at !== null) return at;
  }
  return null;
};

/* -------------------------------------------- */
/*  Canonical values and rendering              */
/* -------------------------------------------- */

const bonusText = (bonus) => String(bonus ?? "").replace(/\s+/g, "").replace(/^\+/, "");

/** Canonical dice `{ number, denomination, bonus, types }` of a damage / healing part, or null without any dice or bonus. */
function diceCanon({ number, denomination, bonus, types, type } = {}) {
  const d = num(denomination);
  const n = d ? (num(number) ?? 1) : null;
  const b = bonusText(bonus);
  if (!d && !b) return null;
  const kinds = [...new Set(list(types).concat(type ? [type] : []).filter(Boolean))].sort();
  return { number: n, denomination: d, bonus: b, types: kinds };
}

/** Canonical dice of a formula such as `1d4`, `2d6 + 3`, `1d6 + @prof`, `3`. */
export function diceOfFormula(formula) {
  const clean = String(formula ?? "").replace(/\s+/g, "");
  const match = /^(\d*)d(\d+)(?:\+(.+))?$/i.exec(clean);
  if (match) return diceCanon({ number: match[1] || 1, denomination: match[2], bonus: match[3] ?? "" });
  return /^[+-]?\d+$/.test(clean) || /^@/.test(clean) ? diceCanon({ bonus: clean }) : null;
}

const diceFormula = ({ number, denomination, bonus }) => [denomination ? `${number}d${denomination}` : "", bonus]
  .filter(Boolean).join(" + ");

const diceValue = (dice) => `${diceFormula(dice).replace(/\s+/g, "")}:${dice.types.join(",")}`;
const diceDisplay = (dice) => [diceFormula(dice), dice.types.length ? `(${dice.types.join(", ")})` : ""].filter(Boolean).join(" ");

/** Feet of a written distance; null when the unit is not a length. */
const feetOf = (value, units) => {
  const n = num(value);
  const factor = UNIT_FEET[String(units ?? "").toLowerCase()];
  if (n === null || factor === undefined) return null;
  return factor === 1 ? n : Math.round((n * factor) / 5) * 5;
};

/** Seconds of a written duration; null when the unit is not a length of time. */
const secondsOf = (value, units) => {
  const n = num(value);
  const factor = UNIT_SECONDS[String(units ?? "")];
  return (n === null || factor === undefined) ? null : n * factor;
};

/**
 * Render a canonical value in the form of a field (`part`, `formula`, `string`, `number`, `key`, `keyList`,
 * `recovery`, `activityUnits`, `effectDuration`, `durationValue`, `distanceValue`, `distanceUnits`).
 * @param {string} family
 * @param {*} canon
 * @param {string} form
 * @returns {*}
 */
export function render(family, canon, form) {
  switch (form) {
    case "part": return { number: canon.number, denomination: canon.denomination, bonus: canon.bonus, types: [...canon.types] };
    case "formula": return family === "dice" ? diceFormula(canon) : String(canon);
    case "string": return String(canon);
    case "number": return num(canon);
    case "key": return canon;
    case "keyList": return [canon];
    case "usesMax": return String(canon.max);
    case "recovery": return canon.period ? [{ period: canon.period, type: "recoverAll" }] : [];
    case "durationValue": return canon.value;
    case "activityUnits": return ACTIVITY_UNITS[canon.units] ?? canon.units;
    case "effectDuration":
      // Foundry v13 `EffectDurationData` of a duration canon (`units` singular, `seconds` computed)
      if (canon.units === "turn") return { turns: canon.value };
      if (canon.units === "round") return { rounds: canon.value };
      return { seconds: canon.seconds };
    case "distanceValue": return canon.value;
    case "distanceUnits": return canon.units;
    default: return canon;
  }
}

/* -------------------------------------------- */
/*  Fact builders                                */
/* -------------------------------------------- */

const fact = (family, { value, display, paragraph, ref, path, patch = [], canon, inferred = false, raw = "" }) => ({
  family, value: String(value), display: display ?? String(value), paragraph: paragraph ?? null, ref, path, patch, canon,
  critical: FAMILIES[family].critical, inferred, raw
});

const diceFact = (dice, { field, form = "part", ...rest }) => fact("dice", {
  value: diceValue(dice), display: diceDisplay(dice), canon: dice, patch: [{ field, form, data: render("dice", dice, form) }], ...rest
});
const numberFact = (family, n, { field, form, ...rest }) => fact(family, {
  value: n, canon: n, patch: [{ field, form, data: render(family, n, form) }], ...rest
});
const keyFact = (family, key, { field, form = "key", ...rest }) => fact(family, {
  value: key, canon: key, patch: [{ field, form, data: render(family, key, form) }], ...rest
});
// "Per day" and "at dawn" are the same recovery in these texts (the rules say `day`, Claude often says `dawn`)
const usesFact = ({ max, period }, { prefix, ...rest }) => fact("uses", {
  value: `${max}/${period === "dawn" ? "day" : (period ?? "")}`, display: `${max}/${period || "-"}`, canon: { max, period: period ?? "" },
  patch: [{ field: `${prefix}max`, form: "usesMax", data: String(max) }, { field: `${prefix}recovery`, form: "recovery", data: render("uses", { max, period }, "recovery") }],
  ...rest
});
/**
 * Duration fact. An activity duration (`prefix`, `form: "activityUnits"`) patches `duration.value` and
 * `duration.units`; an effect duration (`form: "effectDuration"`) patches the whole v13 `duration`
 * (`{ seconds | rounds | turns }`) of the effect source.
 */
const durationFact = ({ value, units }, { prefix, form, ...rest }) => {
  const seconds = secondsOf(value, units);
  if (seconds === null) return null;
  const canon = { value: num(value), units: ACTIVITY_UNITS[units] ?? units, seconds };
  const patch = form === "effectDuration" ? [{ field: "duration", form, data: render("duration", canon, form) }]
    : [{ field: `${prefix}value`, form: "durationValue", data: canon.value }, { field: `${prefix}units`, form, data: units }];
  return fact("duration", { value: seconds, display: `${value} ${units}`, canon, patch, ...rest });
};
const distanceFact = ({ value, units }, { prefix, ...rest }) => {
  const feet = feetOf(value, units);
  if (feet === null) return null;
  const canon = { value: num(value), units, feet };
  return fact("distance", {
    value: feet, display: `${value} ${units}`, canon,
    patch: [{ field: `${prefix}value`, form: "distanceValue", data: canon.value }, { field: `${prefix}units`, form: "distanceUnits", data: units }],
    ...rest
  });
};
const effectBonusFact = ({ kind, scope, value }, { field, ...rest }) => {
  const amount = num(bonusText(value));
  if (amount === null || !BONUS_KINDS.includes(kind)) return null;
  const where = scope ?? "";
  const sign = amount >= 0 && kind !== "speedMultiplier" ? "+" : "";
  return fact("effectBonus", {
    value: `${kind}:${where}=${amount}`, display: `${kind}${where ? ` (${where})` : ""} ${sign}${amount}`,
    canon: amount, patch: [{ field, form: "string", data: String(value) }], ...rest
  });
};

/* -------------------------------------------- */
/*  Rules                                        */
/* -------------------------------------------- */

/**
 * Facts of the rules' plan (`parser.parseItem`).
 * @param {object} plan                        ItemPlan.
 * @param {(string|{ text: string })[]} paragraphs
 * @returns {object[]}  Facts (`path` of an activity / effect is its index in the plan).
 */
export function factsFromRules(plan, paragraphs) {
  const locate = paragraphLocator(paragraphs);
  const facts = [];
  const add = (f) => { if (f) facts.push(f); };
  const details = plan?.details ?? {};

  if (details.rarity) add(keyFact("rarity", details.rarity, { ref: "details.rarity", path: "system.rarity", field: "system.rarity", form: "key", paragraph: locate(details.rarityRaw) }));
  if (details.attunement) add(keyFact("attunement", details.attunement, { ref: "details.attunement", path: "system.attunement", field: "system.attunement", paragraph: locate(details.attunementRaw) }));
  for (const [name, part] of Object.entries({ weapon: details.weapon, armor: details.armor })) {
    if (!part) continue;
    const paragraph = locate(part.raw);
    const bonus = num(part.magicalBonus);
    if (bonus !== null) add(numberFact("magicalBonus", bonus, { ref: `details.${name}`, path: "system.magicalBonus", field: "system.magicalBonus", form: "number", paragraph, raw: text(part.raw) }));
    if (name === "armor" && num(part.ac) !== null) add(numberFact("ac", num(part.ac), { ref: "details.armor", path: "system.armor.value", field: "system.armor.value", form: "number", paragraph, raw: text(part.raw) }));
    if (name === "weapon") {
      for (const [key, dmg] of Object.entries({ base: part.base, versatile: part.versatile })) {
        const dice = dmg ? diceCanon(dmg) : null;
        if (dice) add(diceFact(dice, { ref: "details.weapon", path: `system.damage.${key}`, field: `system.damage.${key}`, paragraph: locate(dmg.raw) ?? paragraph, raw: text(dmg.raw) }));
      }
    }
  }
  if (plan?.uses && num(plan.uses.max) !== null) {
    add(usesFact({ max: num(plan.uses.max), period: plan.uses.period }, { ref: "uses", path: "system.uses", prefix: "system.uses.", paragraph: locate(plan.uses.raw), raw: text(plan.uses.raw) }));
  }

  list(plan?.activities).forEach((activity, n) => {
    const ref = `activities.${n}`;
    const base = (raw) => ({ ref, path: ref, paragraph: locate(raw) ?? locate(activity.raw), raw: text(raw) || text(activity.raw) });
    if (activity.activation?.type) add(keyFact("activation", activity.activation.type, { field: "activation.type", ...base(activity.activation.raw) }));
    const attackBonus = num(activity.attack?.bonus) ?? num(activity.cast?.attack);
    if (attackBonus !== null) add(numberFact("attackBonus", attackBonus, { field: "attack.bonus", form: "string", ...base(activity.attack?.raw ?? activity.cast?.raw) }));
    const dc = num(activity.save?.dc) ?? num(activity.cast?.dc);
    if (dc !== null) add(numberFact("dc", dc, { field: "save.dc.formula", form: "string", ...base(activity.save?.raw ?? activity.cast?.raw) }));
    const parts = [...list(activity.damage), ...list(activity.save?.damage), ...(activity.extraDamage ? [activity.extraDamage] : [])];
    parts.forEach((part, i) => {
      const dice = diceCanon(part);
      if (dice) add(diceFact(dice, { field: `damage.parts.${i}`, ...base(part.raw) }));
    });
    const heal = activity.heal ? diceCanon(activity.heal) : null;
    if (heal) add(diceFact(heal, { field: "healing", ...base(activity.heal.raw) }));
    const range = num(activity.range?.value) ?? num(activity.range?.reach);
    if (range !== null) add(distanceFact({ value: range, units: "ft" }, { prefix: "range.", ...base(activity.range?.raw) }));
    if (num(activity.template?.size) !== null) add(distanceFact({ value: num(activity.template.size), units: "ft" }, { prefix: "target.template.", ...base(activity.template?.raw) }));
  });

  list(plan?.effects).forEach((effect, n) => {
    const ref = `effects.${n}`;
    const base = { ref, path: ref, paragraph: locate(effect.raw), raw: text(effect.raw) };
    add(effectBonusFact(effect, { field: `changes.${n}.value`, ...base }));
    if (effect.duration) add(durationFact(effect.duration, { form: "effectDuration", ...base }));
  });
  return facts;
}

/* -------------------------------------------- */
/*  Claude                                       */
/* -------------------------------------------- */

/** Claude detail fields that carry a fact, with their family and target. */
const DETAIL_FACTS = {
  rarity: { family: "rarity", path: "system.rarity", form: "key" },
  attunement: { family: "attunement", path: "system.attunement", form: "key" },
  magicalBonus: { family: "magicalBonus", path: "system.magicalBonus", form: "number" },
  armorValue: { family: "ac", path: "system.armor.value", form: "number" },
  weaponDamage: { family: "dice", path: "system.damage.base", form: "part" },
  versatileDamage: { family: "dice", path: "system.damage.versatile", form: "part" }
};

/**
 * Facts of Claude's validated answer (schema of `ai/claude-schema.mjs`).
 * @param {object} item                        Validated item (`details`, `uses`, `activities`, `effects`).
 * @param {(string|{ text: string })[]} paragraphs
 * @returns {object[]}  Facts (`path` of an activity / effect is its index in the item's list).
 */
export function factsFromClaude(item, paragraphs) {
  const locate = paragraphLocator(paragraphs);
  const facts = [];
  const add = (f) => { if (f) facts.push(f); };

  for (const detail of list(item?.details)) {
    const spec = DETAIL_FACTS[detail?.field];
    if (!spec) continue;
    const common = { ref: `details.${detail.field}`, path: spec.path, field: spec.path, form: spec.form, paragraph: firstParagraph(locate, detail.quotes), inferred: Boolean(detail.inferred), raw: text(detail.quotes?.[0]) };
    if (spec.family === "dice") {
      const dice = detail.dice ? diceCanon(detail.dice) : null;
      if (dice) add(diceFact(dice, common));
    } else if (spec.form === "number") {
      if (num(detail.number) !== null) add(numberFact(spec.family, num(detail.number), common));
    } else if (detail.key) add(keyFact(spec.family, detail.key, common));
  }

  const uses = item?.uses;
  if (uses && num(uses.max) > 0) {
    add(usesFact({ max: num(uses.max), period: text(list(uses.recovery)[0]?.period) }, { ref: "uses", path: "system.uses", prefix: "system.uses.", paragraph: firstParagraph(locate, uses.quotes), inferred: Boolean(uses.inferred), raw: text(uses.quotes?.[0]) }));
  }

  list(item?.activities).forEach((activity, n) => {
    const paragraph = firstParagraph(locate, activity.quotes);
    const inferred = list(activity.inferred);
    const base = (field) => ({ ref: text(activity.ref) || `activities.${n}`, path: `activities.${n}`, paragraph, inferred: inferred.includes(field), raw: text(activity.quotes?.[0]) });
    if (activity.activation?.type) add(keyFact("activation", activity.activation.type, { field: "activation.type", ...base("activation") }));
    if (activity.duration?.units) add(durationFact(activity.duration, { prefix: "duration.", form: "activityUnits", ...base("duration") }));
    if (activity.range?.units) add(distanceFact(activity.range, { prefix: "range.", ...base("range") }));
    if (activity.target?.template?.units) add(distanceFact({ value: activity.target.template.size, units: activity.target.template.units }, { prefix: "target.template.", ...base("target") }));
    if (activity.uses && num(activity.uses.max) > 0) add(usesFact({ max: num(activity.uses.max), period: text(activity.uses.period) }, { prefix: "uses.", ...base("uses") }));
    if (num(activity.attack?.bonus) !== null) add(numberFact("attackBonus", num(activity.attack.bonus), { field: "attack.bonus", form: "string", ...base("attack") }));
    for (const [key, data] of Object.entries({ save: activity.save, check: activity.check })) {
      if (num(data?.dc) !== null && num(data.dc) > 0) add(numberFact("dc", num(data.dc), { field: `${key}.dc.formula`, form: "string", ...base(key) }));
    }
    list(activity.damage).forEach((part, i) => {
      const dice = diceCanon(part);
      if (dice) add(diceFact(dice, { field: `damage.parts.${i}`, ...base("damage") }));
    });
    const healing = activity.healing ? diceCanon(activity.healing) : null;
    if (healing) add(diceFact(healing, { field: "healing", ...base("healing") }));
    const roll = activity.roll?.formula ? diceOfFormula(activity.roll.formula) : null;
    if (roll) add(diceFact(roll, { field: "roll.formula", form: "formula", ...base("roll") }));
  });

  list(item?.effects).forEach((effect, n) => {
    const base = { ref: text(effect.ref) || `effects.${n}`, path: `effects.${n}`, paragraph: firstParagraph(locate, effect.quotes), inferred: Boolean(effect.inferred), raw: text(effect.quotes?.[0]) };
    list(effect.changes).forEach((change, j) => add(effectBonusFact(change, { field: `changes.${j}.value`, ...base })));
    if (effect.duration?.units) add(durationFact(effect.duration, { form: "effectDuration", ...base }));
  });
  return facts;
}

/**
 * Paragraphs Claude cited anywhere (elements, not automated clauses, flavor): a rules-only fact in one of them is
 * something Claude read and left out, not something it missed.
 * @param {object} item
 * @param {(string|{ text: string })[]} paragraphs
 * @returns {Set<number>}
 */
export function coveredParagraphs(item, paragraphs) {
  const locate = paragraphLocator(paragraphs);
  const covered = new Set();
  const cite = (quotes) => { for (const q of list(quotes)) { const at = locate(q); if (at !== null) covered.add(at); } };
  for (const group of ["details", "activities", "effects", "notAutomated"]) list(item?.[group]).forEach((e) => cite(e?.quotes ?? (e?.quote ? [e.quote] : [])));
  if (item?.uses) cite(item.uses.quotes);
  cite(item?.flavor);
  return covered;
}

/* -------------------------------------------- */
/*  Matching                                     */
/* -------------------------------------------- */

const samePlace = (a, b) => ITEM_LEVEL.has(a.family) || a.paragraph === null || b.paragraph === null || a.paragraph === b.paragraph;

/**
 * Match the facts of both readings: same family and same paragraph (item-level families by family alone).
 * @param {object[]} rules                     `factsFromRules`.
 * @param {object[]} claude                    `factsFromClaude`.
 * @param {object} [policy]                    Reading proposed per family in a conflict (`CROSSCHECK_POLICY`).
 * @param {{ covered?: Set<number> }} [options]  Paragraphs Claude cited (`coveredParagraphs`): marks `rulesOnly[].covered`.
 * @returns {{ agree: object[], conflict: object[], claudeOnly: object[], rulesOnly: object[] }}
 *   `agree[]` / `conflict[]`: `{ family, paragraph, critical, claude, rules }`; a conflict adds `proposed`
 *   (`"claude"` | `"rules"`) and `patch: { claude, rules }`, the rules' value rendered for Claude's fields.
 */
export function crossCheck(rules, claude, policy = CROSSCHECK_POLICY, { covered } = {}) {
  const left = new Set(list(rules));
  const agree = [];
  const conflict = [];
  const claudeOnly = [];
  const pair = (c, r) => ({ family: c.family, paragraph: c.paragraph ?? r.paragraph, critical: c.critical, claude: c, rules: r });

  const pending = [];
  for (const c of list(claude)) {
    const match = [...left].find((r) => r.family === c.family && samePlace(c, r) && r.value === c.value);
    if (match) { left.delete(match); agree.push(pair(c, match)); } else pending.push(c);
  }
  for (const c of pending) {
    const match = [...left].find((r) => r.family === c.family && samePlace(c, r));
    if (!match) { claudeOnly.push(c); continue; }
    left.delete(match);
    conflict.push({
      ...pair(c, match),
      proposed: (policy ?? CROSSCHECK_POLICY)[c.family] === "rules" ? "rules" : "claude",
      patch: {
        claude: c.patch.map((p) => ({ field: p.field, data: p.data })),
        rules: c.patch.map((p) => ({ field: p.field, data: render(c.family, match.canon, p.form) }))
      }
    });
  }
  const rulesOnly = [...left].map((r) => (covered ? { ...r, covered: r.paragraph !== null && covered.has(r.paragraph) } : r));
  return { agree, conflict, claudeOnly, rulesOnly };
}
