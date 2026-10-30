/**
 * Validation of the structured answer of Claude (section 3 of the "Claude first" design). Pure: no Foundry global.
 *
 * Every value is checked against the keys of the world (`enums` from `schemaEnums`, `keys` from `keysFromConfig`),
 * the bounds, the formula whitelist, the quotes (each one is a passage of the description) and the numbers (each
 * number reported must be in the quotes of its element, unless the field is listed in `inferred`). An invalid
 * optional field is removed and the element kept (a correction); an invalid essential field rejects the element.
 * Nothing is ever invented: a correction never adds a value, except the conversion of a distance to the units of
 * the world. Corrections and rejections are `{ ref, field, reason, data }`, `reason` being a code of
 * `item-configurator.Claude.Reason.<code>`.
 */
import { hasDice, hasNumber, normalizeQuote } from "./prompt.mjs";
import {
  ACTIVITY_TYPES, ATTACK_CLASSIFICATIONS, ATTACK_TYPES, BONUS_KINDS, CERTAINTIES, CONSUME_TARGETS, DETAIL_FIELDS,
  EFFECT_KINDS, EFFECT_ON, EFFECT_UNTIL, INFERRABLE, NO_VALUE_KINDS, NUMBER_KINDS, ON_SAVE, RECOVERY_TYPES
} from "./claude-schema.mjs";

/** More activities or effects than this are dropped (the first ones are kept). */
export const MAX_ELEMENTS = 12;
export const DENOMINATIONS = [2, 3, 4, 6, 8, 10, 12, 20, 100];
export const BOUNDS = {
  diceNumber: [1, 100], attackBonus: [-5, 30], dc: [5, 40], uses: [1, 100], activationValue: [0, 10],
  duration: [1, 1000], distanceFeet: [0, 10000], effectBonus: 30, multiplier: 10, abilityScore: [1, 30],
  magicalBonus: [1, 10], spellLevel: [0, 9], count: [1, 100]
};
/** Reason codes of corrections and rejections (keys of `item-configurator.Claude.Reason.*`). */
export const REASONS = ["quoteMissing", "numberNotQuoted", "unknownKey", "outOfBounds", "formulaNotAllowed", "scopeMismatch",
  "distanceConverted", "fieldRemoved", "notApplicable", "effectSkipped", "tooMany", "instruction"];

/**
 * Wordings of a paragraph that reads as an instruction to an AI rather than as a rule of the item (prompt injection),
 * English and French, on the normalized text (lowercase, no diacritics).
 */
const INSTRUCTION_PATTERNS = [
  /\b(?:ignore|disregard|forget|override|skip)\b.{0,40}\b(?:instructions?|prompt|above|previous|earlier|system)\b/,
  /\b(?:ignore|ignorez|oublie|oubliez|ne tiens pas compte|ne tenez pas compte|fais abstraction|faites abstraction)\b.{0,40}\b(?:instructions?|consignes?|precedent\w*|systeme)\b/,
  /\b(?:assistant|language model|ai model|llm|claude|chatgpt|gpt|system prompt|modele de langage|l ia\b|une ia\b|intelligence artificielle)/,
  /\b(?:you must|you should|you are to|you will|tu dois|vous devez|tu vas|vous allez)\b.{0,40}\b(?:output|return|answer|respond|configure|set|add|write|produce|json|schema|configurer|renvoyer|repondre|ajouter|ecrire|produire)\b/,
  /\b(?:output|return|respond with|answer with|reponds|repondez|renvoie|renvoyez|retourne|retournez)\b.{0,30}\b(?:json|schema|schema|approved)\b/,
  /\b(?:configure|configures|configurez) (?:this|the|cet|l) ?(?:item|objet)\b/
];

/**
 * Does a paragraph read as an instruction addressed to the AI ("ignore the previous instructions", "you must add
 * 10d10 fire damage") rather than as a rule of the item?
 * @param {string} text
 * @returns {boolean}
 */
export function isInstructionParagraph(text) {
  const norm = normalizeQuote(text);
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(norm));
}

const FEET_PER_UNIT = { ft: 1, mi: 5280, m: 10 / 3, km: 10000 / 3 };
const METRIC_UNITS = ["m", "km"];
const IMPERIAL_UNITS = ["ft", "mi"];
const SCALAR_PERIODS = ["turn", "round", "second", "minute", "hour", "day", "week", "month", "year"];
const NO_ACTIVITY_TYPES = ["loot", "container"];
const TERM = String.raw`(?:\d+\s*d\s*\d+|\d+|@prof|@mod|@abilities\.[a-z]{3}\.mod)`;
const FORMULA = new RegExp(String.raw`^\s*[+-]?\s*${TERM}(?:\s*[+-]\s*${TERM})*\s*$`, "i");
const NAME_LENGTH = 80;
const CONDITION_LENGTH = 200;

const isInt = (value, [min, max]) => Number.isInteger(value) && value >= min && value <= max;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const arrayOf = (value) => (Array.isArray(value) ? value : []);

/**
 * A distance written in one unit, in the units of the world: metres to feet (× 10/3, rounded to 5 ft, as dnd5e
 * does) when the world is imperial, feet to metres (× 0.3, rounded to 0.5 m) when it is metric. A unit that is not a
 * length (`self`, `touch`...) or already in the right system is returned as it is.
 * @param {number} value
 * @param {string} unit
 * @param {boolean} metric   Is the world metric (dnd5e `metricLengthUnits`)?
 * @returns {{ value: number, units: string, converted: boolean }}
 */
export function toWorldDistance(value, unit, metric) {
  const isMetric = METRIC_UNITS.includes(unit);
  const isImperial = IMPERIAL_UNITS.includes(unit);
  if ((!isMetric && !isImperial) || (metric ? isMetric : isImperial)) return { value, units: unit, converted: false };
  const feet = Number(value) * FEET_PER_UNIT[unit];
  if (metric) return { value: Math.round(feet * 0.3 * 2) / 2, units: "m", converted: true };
  const rounded = Math.round(feet / 5) * 5;
  return { value: feet > 0 && !rounded ? 5 : rounded, units: "ft", converted: true };
}

/** Is `formula` in the whitelist (dice, integers, `+`, `-`, `@prof`, `@mod`, `@abilities.<key>.mod`)? */
export function isAllowedFormula(formula) {
  const text = String(formula ?? "").trim();
  return !text || FORMULA.test(text);
}

/** Plain text, `<` and `>` removed, whitespace collapsed, cut at `max` characters. */
export function cleanText(value, max = NAME_LENGTH) {
  return String(value ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Allowed `scope` values of an effect change, per kind (`null` = any of the listed sets, `[]` = none). */
export function scopesFor(kind, on, enums) {
  const e = enums ?? {};
  switch (kind) {
    case "resistance": case "vulnerability": return e.damageTypes ?? [];
    case "immunity": return [...(e.damageTypes ?? []), ...(e.conditionTypes ?? [])];
    case "damageReduction": return [...(e.damageTypes ?? []), "all"];
    case "save": return [...(e.abilities ?? []), "all", ""];
    case "check": return on === "skill" ? (e.skills ?? []) : [...(e.abilities ?? []), "all", ""];
    case "advantage": case "disadvantage": return on === "skill" ? (e.skills ?? []) : [...(e.abilities ?? []), ""];
    case "abilityScore": return e.abilities ?? [];
    case "speed": return [...(e.movementTypes ?? []), ""];
    case "sense": return e.senses ?? [];
    case "attack": case "damage": return ["mwak", "rwak", "msak", "rsak", "weapon", "spell", "all", ""];
    case "ac": case "speedMultiplier": return [""];
    default: return [];
  }
}

/**
 * Validate the answer of Claude.
 * @param {object} json
 * @param {object} ctx
 * @param {string[]} [ctx.paragraphs]  Paragraphs of the description (`describeForClaude`).
 * @param {string} [ctx.text]          Labelled text, used when `paragraphs` is empty.
 * @param {object} [ctx.enums]         `schemaEnums(CONFIG.DND5E, CONST)`.
 * @param {object} [ctx.keys]          `keysFromConfig(CONFIG.DND5E)` (fallback for the enumerations).
 * @param {boolean} [ctx.metric]       Metric world (distances are converted to its units).
 * @param {string} [ctx.type]          Target item type (restricts the detail fields and the property keys).
 * @returns {{ item: object, corrections: object[], rejections: object[], uncovered: { index: number, text: string }[] }}
 */
export function validateClaudeItem(json, { paragraphs: given = [], text = "", enums = {}, keys, metric = false, type = "" } = {}) {
  const paragraphs = given.length ? given
    : String(text ?? "").split("\n").map((line) => line.replace(/^\[P\d+\]\s*/, "").trim()).filter(Boolean);
  const normalized = paragraphs.map((paragraph) => ` ${normalizeQuote(paragraph)} `);
  // Paragraphs that read as instructions to the AI (1-based): what is quoted only from them is proposed unchecked
  const suspicious = new Set(paragraphs.map((paragraph, i) => (isInstructionParagraph(paragraph) ? i + 1 : 0)).filter(Boolean));
  const corrections = [];
  const rejections = [];
  const covered = new Set();
  const correct = (ref, field, reason, data) => corrections.push({ ref, field, reason, ...(data ? { data } : {}) });
  const reject = (ref, field, reason, data) => rejections.push({ ref, field, reason, ...(data ? { data } : {}) });

  /** Is `name` a valid key of the enumeration (`enums` first, then `keys`; no list = no check)? */
  const inEnum = (name, value) => {
    const list = enums?.[name];
    if (Array.isArray(list)) return list.includes(value);
    const set = keys?.[name];
    if (set instanceof Set) return set.has(value);
    return true;
  };
  const propertyGroups = type && enums?.validProperties?.[type] ? [enums.validProperties[type]]
    : Object.values(enums?.validProperties ?? {});
  const isProperty = (key) => (propertyGroups.length ? propertyGroups.some((group) => group.includes(key)) : true);

  /** Valid quotes of an element and the paragraphs they come from (1-based). */
  const checkQuotes = (quotes) => {
    const valid = [];
    const cited = new Set();
    for (const quote of arrayOf(quotes)) {
      const norm = normalizeQuote(quote);
      if (norm.split(" ").filter(Boolean).length < 2) continue;
      const hits = normalized.map((p, i) => (p.includes(` ${norm} `) ? i + 1 : 0)).filter(Boolean);
      if (!hits.length) continue;
      valid.push(String(quote).trim());
      hits.forEach((index) => cited.add(index));
    }
    return { quotes: valid, paragraphs: [...cited].sort((a, b) => a - b) };
  };
  const quoted = (element) => normalizeQuote(element.quotes.join(" | "));

  /** Element with valid quotes and coverage, or null (rejected). */
  const accept = (raw, ref, fallbackName) => {
    const { quotes, paragraphs: cited } = checkQuotes(raw.quotes);
    if (!quotes.length) { reject(ref, "quotes", "quoteMissing"); return null; }
    cited.forEach((index) => covered.add(index));
    let certainty = CERTAINTIES.includes(raw.certainty) ? raw.certainty : "low";
    if (certainty !== raw.certainty) correct(ref, "certainty", "unknownKey", { key: String(raw.certainty ?? "") });
    // Quoted only from paragraphs that read as instructions to the AI: kept visible, but unchecked (certainty low)
    if (cited.every((index) => suspicious.has(index))) {
      certainty = "low";
      correct(ref, "certainty", "instruction", { paragraph: cited[0] });
    }
    const name = cleanText(raw.name || fallbackName || "");
    return { ref, name, quotes, paragraphs: cited, certainty };
  };

  /**
   * Dice `{ number, denomination, bonus, types }`, or the reason. An unknown type is dropped (a correction), unless
   * `strictTypes`: the type of a healing or of a single damage part is essential.
   */
  const checkDice = (dice, ref, field, quote, typeSet, strictTypes = false) => {
    if (!isObject(dice)) return { error: "fieldRemoved", data: { field, why: "missing" } };
    if (!isInt(dice.number, BOUNDS.diceNumber) || !DENOMINATIONS.includes(dice.denomination)) return { error: "outOfBounds" };
    if (!hasDice(quote, dice.number, dice.denomination)) return { error: "numberNotQuoted", data: { value: `${dice.number}d${dice.denomination}` } };
    const bonus = String(dice.bonus ?? "").replace(/\s+/g, "");
    const result = { number: dice.number, denomination: dice.denomination, bonus: "", types: [] };
    if (bonus) {
      if (!isAllowedFormula(bonus)) return { error: "formulaNotAllowed", data: { formula: bonus } };
      const bare = quote.replace(/\d+\s?d\s?\d+/g, " ");
      for (const n of bonus.match(/\d+/g) ?? []) {
        if (!hasNumber(bare, Number(n))) return { error: "numberNotQuoted", data: { value: n } };
      }
      result.bonus = /^\d/.test(bonus) ? `+${bonus}` : bonus;
    }
    const types = arrayOf(dice.types).filter((t) => typeSet.some((name) => inEnum(name, t)));
    for (const t of arrayOf(dice.types)) {
      if (types.includes(t)) continue;
      if (strictTypes) return { error: "unknownKey", field: `${field}.types`, data: { key: String(t) } };
      correct(ref, `${field}.types`, "unknownKey", { key: String(t) });
    }
    result.types = [...new Set(types)];
    return { dice: result };
  };

  /** A number of the element: in bounds and quoted (unless `exempt`). */
  const checkNumber = (value, bounds, ref, field, quote, exempt = false) => {
    if (!isInt(value, bounds)) { correct(ref, field, "outOfBounds", { value: String(value) }); return false; }
    if (!exempt && !hasNumber(quote, value)) { correct(ref, field, "numberNotQuoted", { value: String(value) }); return false; }
    return true;
  };

  /**
   * A distance written in the text, converted to the units of the world; null when invalid. `field` is the path of
   * the number (`range.value`, `target.template.size`): a problem that removes the field is reported on its parent, a
   * conversion on the number itself.
   */
  const checkDistance = (value, units, ref, field, quote, exempt) => {
    const parent = field.includes(".") ? field.slice(0, field.lastIndexOf(".")) : field;
    if (!inEnum("distanceUnits", units)) { correct(ref, parent, "unknownKey", { key: String(units) }); return null; }
    if (!FEET_PER_UNIT[units]) return { value: 0, units };
    const feet = Number(value) * FEET_PER_UNIT[units];
    if (!Number.isInteger(value) || value < 0 || feet > BOUNDS.distanceFeet[1]) {
      correct(ref, parent, "outOfBounds", { value: String(value) }); return null;
    }
    if (!exempt && value > 0 && !hasNumber(quote, value)) { correct(ref, parent, "numberNotQuoted", { value: String(value) }); return null; }
    const world = toWorldDistance(value, units, metric);
    if (world.converted) correct(ref, field, "distanceConverted", { from: `${value} ${units}`, to: `${world.value} ${world.units}` });
    return { value: world.value, units: world.units };
  };

  /** A duration `{ value, units }` (dnd5e time periods); null when invalid or absent. Problems remove the field. */
  const checkDuration = (duration, ref, quote, exempt, extra = {}) => {
    if (!isObject(duration)) return null;
    // "until the end of your next turn": the event ends the effect, the count and the unit are not needed
    if (extra.until && !duration.units) return { value: 0, units: "", ...extra };
    if (!inEnum("timePeriods", duration.units)) { correct(ref, "duration", "unknownKey", { key: String(duration.units) }); return null; }
    const scalar = SCALAR_PERIODS.includes(duration.units);
    const result = { value: 0, units: duration.units, ...extra };
    if (scalar) {
      if (extra.until) return result;
      if (!isInt(duration.value, BOUNDS.duration)) { correct(ref, "duration", "outOfBounds", { value: String(duration.value) }); return null; }
      if (!exempt && !hasNumber(quote, duration.value)) { correct(ref, "duration", "numberNotQuoted", { value: String(duration.value) }); return null; }
      result.value = duration.value;
    }
    return result;
  };

  const item = { details: [], uses: null, activities: [], effects: [], notAutomated: [], flavor: [] };
  const root = isObject(json) ? json : {};
  if (!isObject(json)) reject("item", "", "fieldRemoved", { field: "item", why: "not an object" });
  for (const group of ["details", "activities", "effects", "notAutomated", "flavor"]) {
    if (root[group] !== undefined && !Array.isArray(root[group])) correct(group, "shape", "fieldRemoved", { field: group, why: "not an array" });
  }
  const noActivities = NO_ACTIVITY_TYPES.includes(type);

  // ---- Details -------------------------------------------------------------------------------------------------
  const seenFields = new Set();
  arrayOf(root.details).forEach((raw, i) => {
    const ref = `d${i + 1}`;
    if (!isObject(raw)) { reject(ref, "", "fieldRemoved", { field: ref, why: "not an object" }); return; }
    const spec = DETAIL_FIELDS[raw.field];
    if (!spec) { reject(ref, "field", "unknownKey", { key: String(raw.field ?? "") }); return; }
    if (spec.path && typeof spec.path === "object" && type && !spec.path[type]) {
      reject(ref, "field", "unknownKey", { key: raw.field }); return;
    }
    const element = accept(raw, ref);
    if (!element) return;
    const quote = quoted(element);
    const detail = { ...element, field: raw.field, inferred: raw.inferred === true };
    if (spec.value === "key") {
      const key = String(raw.key ?? "");
      // An empty attunement is a fact of its own ("ne nécessite pas d'harmonisation"): `system.attunement = ""`
      const valid = spec.key === "validProperties" ? isProperty(key) : inEnum(spec.key, key) || (!key && raw.field === "attunement");
      if ((!key && raw.field !== "attunement") || !valid) { reject(ref, "key", "unknownKey", { key: key }); return; }
      detail.key = key;
    } else if (spec.value === "number") {
      const bounds = raw.field === "magicalBonus" ? BOUNDS.magicalBonus : [0, raw.field === "weaponRange" ? BOUNDS.distanceFeet[1] : 100000];
      if (!isInt(raw.number, bounds)) { reject(ref, "number", "outOfBounds", { value: String(raw.number ?? "") }); return; }
      if (!hasNumber(quote, raw.number)) { reject(ref, "number", "numberNotQuoted", { value: String(raw.number) }); return; }
      detail.number = raw.number;
      if (raw.field === "price") {
        const key = String(raw.key ?? "");
        if (!inEnum("currencies", key)) { reject(ref, "key", "unknownKey", { key: key }); return; }
        detail.key = key;
      } else if (raw.field === "weight") {
        const key = String(raw.key ?? "");
        if (key && inEnum("weightUnits", key)) detail.key = key;
        else if (key) correct(ref, "key", "unknownKey", { key: key });
      } else if (raw.field === "weaponRange") {
        const distance = checkDistance(raw.number, String(raw.key || "ft"), ref, "number", quote, false);
        if (!distance) { reject(ref, "number", "outOfBounds", { value: String(raw.number) }); return; }
        detail.number = distance.value;
        detail.key = distance.units;
      }
    } else if (spec.value === "dice") {
      const { dice, error, data } = checkDice(raw.dice, ref, "dice", quote, ["damageTypes"]);
      if (error) { reject(ref, "dice", error, data); return; }
      detail.dice = dice;
    }
    if (seenFields.has(raw.field) && raw.field !== "weaponProperty") { correct(ref, "field", "fieldRemoved", { field: raw.field, why: "duplicate" }); return; }
    seenFields.add(raw.field);
    item.details.push(detail);
  });

  // ---- Item uses -----------------------------------------------------------------------------------------------
  if (isObject(root.uses) && root.uses.max !== 0) {
    const ref = "uses";
    const element = accept(root.uses, ref);
    if (element) {
      const quote = quoted(element);
      // A single use is implied by "can't be used again until dawn": only a larger number must be written
      if (!isInt(root.uses.max, BOUNDS.uses)) reject(ref, "max", "outOfBounds", { value: String(root.uses.max) });
      else if (root.uses.max > 1 && !hasNumber(quote, root.uses.max)) reject(ref, "max", "numberNotQuoted", { value: String(root.uses.max) });
      else {
        const recovery = [];
        for (const entry of arrayOf(root.uses.recovery)) {
          if (!isObject(entry) || !inEnum("limitedUsePeriods", entry.period)) { correct(ref, "recovery.period", "unknownKey", { key: String(entry?.period ?? "") }); continue; }
          const kind = RECOVERY_TYPES.includes(entry.type) ? entry.type : "recoverAll";
          const formula = String(entry.formula ?? "").trim();
          if (kind === "formula" && (!formula || !isAllowedFormula(formula))) { correct(ref, "recovery.formula", "formulaNotAllowed", { formula }); continue; }
          recovery.push(kind === "formula" ? { period: entry.period, type: "formula", formula } : { period: entry.period, type: "recoverAll" });
        }
        item.uses = { ...element, max: root.uses.max, recovery, autoDestroy: root.uses.autoDestroy === true, inferred: root.uses.inferred === true };
      }
    }
  }

  // ---- Effects (before the activities: their refs are checked) -------------------------------------------------
  const effectRefs = new Set();
  const rawEffects = arrayOf(root.effects);
  if (rawEffects.length > MAX_ELEMENTS) correct("effects", "length", "tooMany", { max: MAX_ELEMENTS, what: "effects", total: rawEffects.length });
  rawEffects.slice(0, MAX_ELEMENTS).forEach((raw, i) => {
    let ref = typeof raw?.ref === "string" && raw.ref.trim() ? raw.ref.trim() : "";
    if (!ref || effectRefs.has(ref)) ref = `e${i + 1}`;
    if (!isObject(raw)) { reject(ref, "", "fieldRemoved", { field: ref, why: "not an object" }); return; }
    const element = accept(raw, ref, "Effect");
    if (!element) return;
    const quote = quoted(element);
    const changes = [];
    arrayOf(raw.changes).forEach((change, c) => {
      // A removed change is reported on `changes` (the index is in `data`)
      const field = "changes";
      if (!isObject(change) || !EFFECT_KINDS.includes(change.kind)) { correct(ref, field, "unknownKey", { key: String(change?.kind ?? ""), index: c }); return; }
      const on = EFFECT_ON.includes(change.on) ? change.on : "";
      const scope = String(change.scope ?? "");
      if (!scopesFor(change.kind, on, enums).includes(scope)) { correct(ref, field, "scopeMismatch", { kind: change.kind, scope, index: c }); return; }
      const result = { kind: change.kind, scope, on };
      const text = String(change.value ?? "").replace(/\s+/g, "");
      if (BONUS_KINDS.includes(change.kind)) {
        const value = Number(text);
        if (!/^[+-]?\d+$/.test(text) || !value || Math.abs(value) > BOUNDS.effectBonus) { correct(ref, field, "outOfBounds", { value: text, index: c }); return; }
        if (!hasNumber(quote, value)) { correct(ref, field, "numberNotQuoted", { value: text, index: c }); return; }
        result.value = value > 0 ? `+${value}` : String(value);
      } else if (NUMBER_KINDS.includes(change.kind)) {
        const value = Number(text);
        if (change.kind === "speedMultiplier") {
          if (!(value > 0 && value <= BOUNDS.multiplier)) { correct(ref, field, "outOfBounds", { value: text, index: c }); return; }
        } else {
          const bounds = change.kind === "abilityScore" ? BOUNDS.abilityScore : [0, BOUNDS.distanceFeet[1]];
          if (!isInt(value, bounds)) { correct(ref, field, "outOfBounds", { value: text, index: c }); return; }
          // A speed or a sense may be written in metres in the text (30 ft = 9 m)
          const metres = ["speed", "sense"].includes(change.kind) && Number.isInteger(value * 0.3) ? value * 0.3 : null;
          if (!hasNumber(quote, value) && !(metres && hasNumber(quote, metres))) { correct(ref, field, "numberNotQuoted", { value: text, index: c }); return; }
        }
        result.value = value;
      } else if (NO_VALUE_KINDS.includes(change.kind)) {
        result.value = null;
      }
      changes.push(result);
    });
    const transfer = raw.transfer !== false;
    const effect = { ...element, inferred: raw.inferred === true, transfer, changes, duration: null };
    if (!transfer && isObject(raw.duration)) {
      const until = EFFECT_UNTIL.includes(raw.duration.until) ? raw.duration.until : "";
      effect.duration = checkDuration(raw.duration, ref, quote, false, { until });
    }
    if (!changes.length) {
      // A clause the library cannot write as an effect is still a rule of the item: shown as "not automated"
      correct(ref, "changes", "effectSkipped");
      item.notAutomated.push({ ref, quote: element.quotes[0], quotes: element.quotes, paragraphs: element.paragraphs, reason: "" });
      return;
    }
    effectRefs.add(ref);
    item.effects.push(effect);
  });

  // ---- Activities ----------------------------------------------------------------------------------------------
  const activityRefs = new Set();
  const rawActivities = arrayOf(root.activities);
  if (rawActivities.length > MAX_ELEMENTS) correct("activities", "length", "tooMany", { max: MAX_ELEMENTS, what: "activities", total: rawActivities.length });
  rawActivities.slice(0, MAX_ELEMENTS).forEach((raw, i) => {
    let ref = typeof raw?.ref === "string" && raw.ref.trim() ? raw.ref.trim() : "";
    if (!ref || activityRefs.has(ref)) ref = `a${i + 1}`;
    activityRefs.add(ref);
    if (!isObject(raw)) { reject(ref, "", "fieldRemoved", { field: ref, why: "not an object" }); return; }
    if (!ACTIVITY_TYPES.includes(raw.type)) { reject(ref, "type", "unknownKey", { key: String(raw.type ?? "") }); return; }
    const element = accept(raw, ref);
    if (!element) return;
    // A loot or a container has no activity (existing behaviour); what Claude read there still counts as covered
    if (noActivities) { reject(ref, "type", "notApplicable", { what: element.name || raw.type, type }); return; }
    const quote = quoted(element);
    const inferred = [...new Set(arrayOf(raw.inferred).filter((f) => INFERRABLE.includes(f)))];
    const exempt = (field) => inferred.includes(field);
    const activity = { ...element, type: raw.type, inferred, activation: { type: "", value: 0, condition: "" }, effects: [] };

    const activation = isObject(raw.activation) ? raw.activation : {};
    if (activation.type && inEnum("activityActivationTypes", activation.type)) activity.activation.type = activation.type;
    else if (activation.type) correct(ref, "activation.type", "unknownKey", { key: String(activation.type) });
    if (activation.value && checkNumber(activation.value, BOUNDS.activationValue, ref, "activation.value", quote, exempt("activation"))) {
      activity.activation.value = activation.value;
    }
    activity.activation.condition = cleanText(activation.condition, CONDITION_LENGTH);

    if (isObject(raw.duration)) {
      const duration = checkDuration(raw.duration, ref, quote, exempt("duration"));
      if (duration) activity.duration = { ...duration, concentration: raw.duration.concentration === true };
    }
    if (isObject(raw.range)) {
      const range = checkDistance(raw.range.value ?? 0, String(raw.range.units ?? ""), ref, "range.value", quote, exempt("range"));
      if (range && (range.value > 0 || !FEET_PER_UNIT[range.units])) activity.range = range;
      else if (range) correct(ref, "range", "outOfBounds", { value: "0" });
    }
    if (isObject(raw.target)) {
      const target = {};
      const template = isObject(raw.target.template) ? raw.target.template : null;
      if (template?.type) {
        if (!inEnum("areaTargetTypes", template.type)) correct(ref, "target.template.type", "unknownKey", { key: String(template.type) });
        else {
          const size = checkDistance(template.size ?? 0, String(template.units ?? ""), ref, "target.template.size", quote, exempt("target"));
          if (size && size.value > 0) target.template = { type: template.type, size: size.value, units: size.units };
          else if (size) correct(ref, "target.template", "outOfBounds", { value: "0" });
        }
      }
      const affects = isObject(raw.target.affects) ? raw.target.affects : null;
      if (affects?.type || affects?.count) {
        if (affects.type && !inEnum("individualTargetTypes", affects.type)) correct(ref, "target.affects.type", "unknownKey", { key: String(affects.type) });
        else {
          const count = affects.count && checkNumber(affects.count, BOUNDS.count, ref, "target.affects.count", quote, exempt("target")) ? affects.count : 0;
          target.affects = { type: affects.type || "", count, special: cleanText(affects.special) };
        }
      }
      if (Object.keys(target).length) activity.target = target;
    }
    if (isObject(raw.uses) && raw.uses.max) {
      if (!inEnum("limitedUsePeriods", raw.uses.period)) correct(ref, "uses.period", "unknownKey", { key: String(raw.uses.period ?? "") });
      else if (checkNumber(raw.uses.max, BOUNDS.uses, ref, "uses.max", quote, raw.uses.max === 1)) activity.uses = { max: raw.uses.max, period: raw.uses.period };
    }
    if (isObject(raw.consume) && raw.consume.target) {
      if (!CONSUME_TARGETS.includes(raw.consume.target)) correct(ref, "consume.target", "unknownKey", { key: String(raw.consume.target) });
      else {
        const amount = raw.consume.amount || 1;
        // Spending one use is dnd5e's default, not a number read from the text
        if (checkNumber(amount, BOUNDS.uses, ref, "consume.amount", quote, amount === 1)) activity.consume = { target: raw.consume.target, amount };
      }
    }
    if (isObject(raw.attack)) {
      const attack = {
        type: ATTACK_TYPES.includes(raw.attack.type) ? raw.attack.type : "",
        classification: ATTACK_CLASSIFICATIONS.includes(raw.attack.classification) ? raw.attack.classification : "",
        bonus: 0
      };
      if (raw.attack.type && !attack.type) correct(ref, "attack.type", "unknownKey", { key: String(raw.attack.type) });
      if (raw.attack.bonus && checkNumber(raw.attack.bonus, BOUNDS.attackBonus, ref, "attack.bonus", quote)) attack.bonus = raw.attack.bonus;
      activity.attack = attack;
    }
    if (isObject(raw.save)) {
      const abilities = arrayOf(raw.save.abilities).filter((a) => inEnum("abilities", a));
      for (const a of arrayOf(raw.save.abilities)) if (!abilities.includes(a)) correct(ref, "save.abilities", "unknownKey", { key: String(a) });
      if (raw.type === "save") {
        if (!abilities.length) { reject(ref, "save.abilities", "fieldRemoved", { field: "save.abilities", why: "missing" }); return; }
        if (!isInt(raw.save.dc, BOUNDS.dc)) { reject(ref, "save.dc", "outOfBounds", { value: String(raw.save.dc ?? "") }); return; }
        if (!hasNumber(quote, raw.save.dc)) { reject(ref, "save.dc", "numberNotQuoted", { value: String(raw.save.dc) }); return; }
      }
      const onSave = ON_SAVE.includes(raw.save.onSave) && raw.save.onSave ? raw.save.onSave : "none";
      if (abilities.length) activity.save = { abilities: [...new Set(abilities)], dc: isInt(raw.save.dc, BOUNDS.dc) && hasNumber(quote, raw.save.dc) ? raw.save.dc : 0, onSave };
    } else if (raw.type === "save") { reject(ref, "save", "fieldRemoved", { field: "save", why: "missing" }); return; }
    if (isObject(raw.check)) {
      const ability = raw.check.ability && inEnum("abilities", raw.check.ability) ? raw.check.ability : "";
      const skill = raw.check.skill && inEnum("skills", raw.check.skill) ? raw.check.skill : "";
      if (raw.check.ability && !ability) correct(ref, "check.ability", "unknownKey", { key: String(raw.check.ability) });
      if (raw.check.skill && !skill) correct(ref, "check.skill", "unknownKey", { key: String(raw.check.skill) });
      if (raw.type === "check" && !ability && !skill) { reject(ref, "check", "fieldRemoved", { field: "check", why: "missing" }); return; }
      const dc = raw.check.dc && checkNumber(raw.check.dc, BOUNDS.dc, ref, "check.dc", quote) ? raw.check.dc : 0;
      if (ability || skill) activity.check = { ability, skill, dc };
    } else if (raw.type === "check") { reject(ref, "check", "fieldRemoved", { field: "check", why: "missing" }); return; }
    if (Array.isArray(raw.damage)) {
      const parts = [];
      raw.damage.forEach((part, p) => {
        const { dice, error, data } = checkDice(part, ref, `damage.${p}`, quote, ["damageTypes"]);
        if (error) correct(ref, `damage.${p}`, error, data);
        else parts.push(dice);
      });
      if (raw.type === "damage" && raw.damage.length === 1 && !parts.length) { reject(ref, "damage", "fieldRemoved", { field: "damage", why: "missing" }); return; }
      if (parts.length) activity.damage = parts;
    }
    if (raw.type === "damage" && !activity.damage) { reject(ref, "damage", "fieldRemoved", { field: "damage", why: "missing" }); return; }
    if (isObject(raw.healing) || raw.type === "heal") {
      const { dice, error, field, data } = checkDice(raw.healing, ref, "healing", quote, ["healingTypes"], raw.type === "heal");
      if (error) {
        if (raw.type === "heal") { reject(ref, field ?? "healing", error, data); return; }
        correct(ref, "healing", error, data);
      } else {
        if (!dice.types.length) dice.types = ["healing"];
        activity.healing = dice;
      }
    }
    if (isObject(raw.roll) && String(raw.roll.formula ?? "").trim()) {
      const formula = String(raw.roll.formula).replace(/\s+/g, "");
      let ok = isAllowedFormula(formula);
      if (!ok) correct(ref, "roll", "formulaNotAllowed", { formula });
      for (const dice of ok ? formula.match(/\d+d\d+/gi) ?? [] : []) {
        const [n, d] = dice.toLowerCase().split("d").map(Number);
        if (!DENOMINATIONS.includes(d) || !hasDice(quote, n, d)) { correct(ref, "roll", "numberNotQuoted", { value: dice }); ok = false; break; }
      }
      for (const n of ok ? formula.replace(/\d+d\d+/gi, " ").match(/\d+/g) ?? [] : []) {
        if (!hasNumber(quote.replace(/\d+\s?d\s?\d+/g, " "), Number(n))) { correct(ref, "roll", "numberNotQuoted", { value: n }); ok = false; break; }
      }
      if (ok) activity.roll = { formula, name: cleanText(raw.roll.name) };
    }
    if (isObject(raw.spell) || raw.type === "cast") {
      const name = cleanText(raw.spell?.name);
      if (!name) { if (raw.type === "cast") { reject(ref, "spell.name", "fieldRemoved", { field: "spell.name", why: "missing" }); return; } }
      else {
        const level = isInt(raw.spell.level, BOUNDS.spellLevel) ? raw.spell.level : 0;
        if (level && !hasNumber(quote, level)) { correct(ref, "spell.level", "numberNotQuoted", { value: String(level) }); activity.spell = { name, level: 0 }; }
        else activity.spell = { name, level };
      }
    }
    for (const effectRef of arrayOf(raw.effects)) {
      if (effectRefs.has(effectRef)) activity.effects.push(effectRef);
      else correct(ref, "effects", "unknownKey", { key: String(effectRef) });
    }
    item.activities.push(activity);
  });

  // ---- Not automated and flavor --------------------------------------------------------------------------------
  arrayOf(root.notAutomated).forEach((raw, i) => {
    const ref = `n${i + 1}`;
    const { quotes, paragraphs: cited } = checkQuotes([raw?.quote]);
    if (!quotes.length) { correct(ref, "quote", "quoteMissing"); return; }
    cited.forEach((index) => covered.add(index));
    item.notAutomated.push({ ref, quote: quotes[0], quotes, paragraphs: cited, reason: cleanText(raw.reason) });
  });
  arrayOf(root.flavor).forEach((raw, i) => {
    const { quotes, paragraphs: cited } = checkQuotes([raw]);
    if (!quotes.length) { correct(`f${i + 1}`, "flavor", "quoteMissing"); return; }
    cited.forEach((index) => covered.add(index));
    item.flavor.push({ text: quotes[0], paragraphs: cited });
  });

  const uncovered = paragraphs.map((text, i) => ({ index: i + 1, text })).filter(({ index }) => !covered.has(index));
  return { item, corrections, rejections, uncovered };
}
