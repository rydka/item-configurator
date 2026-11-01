/**
 * Translation of the validated answer of Claude (`claude-validate.mjs`) into dnd5e sources: the item `system`
 * patch, the activity sources (written directly: the schema follows the dnd5e field names), the ActiveEffect
 * sources (written by `parser.toEffects`, whose table of v14 keys is already tested: Claude never picks a
 * `system.*` key) and the damage parts (`parser.toDamagePart`). Also builds the descriptors the preview shows,
 * with the same shape as `parser.describe(plan)` plus `origin: "claude"`, `ref`, `certainty`, `inferred`.
 *
 * Alignment (used by `core/crosscheck.mjs`): `activities[n]` is the source of `item.activities[n]` (null when it
 * could not be written: unresolved spell), `effects[n]` the source of `item.effects[n]` (null when the library
 * could not write any of its changes). Pure: no Foundry global.
 */
import { BONUS_KINDS, DETAIL_FIELDS } from "./claude-schema.mjs";
import { setPath } from "../core/paths.mjs";

const LIB = "dnd5e-text-parser.";
const OWN = "item-configurator.Claude.";
export const NOTE_NOT_AUTOMATED = `${LIB}Note.NotAutomated`;
export const NOTE_FLAVOR = `${LIB}Note.Flavor`;
export const NOTE_EFFECT_SKIPPED = `${LIB}Note.EffectSkipped`;
export const NOTE_SPELL_NOT_FOUND = `${LIB}Note.SpellNotFound`;

/** Property group of `validProperties` per item type. */
const PROPERTY_GROUP = { weapon: "weapon", equipment: "equipment", consumable: "consumable" };
/** Scopes that mean "every roll" for the library (which expects no scope then). */
const ALL_SCOPES = ["all", ""];

const formulaOf = (dice) => [`${dice.number}d${dice.denomination}`, dice.bonus ? dice.bonus.replace(/^\+/, "+ ").replace(/^-/, "- ") : ""]
  .filter(Boolean).join(" ");
const str = (value) => (value === null || value === undefined || value === 0 || value === "" ? "" : String(value));

/**
 * Build the dnd5e sources and the descriptors of a validated Claude item.
 * @param {object} item                       `validateClaudeItem(...).item`.
 * @param {object} context
 * @param {object} context.parser             The `dnd5e-text-parser` API (`toEffects`, `toDamagePart`).
 * @param {object} [context.keys]             `keysFromConfig(CONFIG.DND5E)`.
 * @param {function(): string} context.idGen  Generator of 16-character ids.
 * @param {string} context.type               Target item type.
 * @param {string} [context.name]             Item name (name of the effects without one).
 * @param {function(string): (string|null)} [context.resolveSpell]  Spell name -> UUID.
 * @returns {{ system: object, activities: (object|null)[], effects: (object|null)[], descriptors: object[], notes: object[] }}
 */
export function buildFromClaude(item, { parser, keys, idGen, type, name = "", resolveSpell } = {}) {
  const system = {};
  const descriptors = [];
  const notes = [];
  const properties = new Set();
  const propertyQuotes = [];

  const describe = (key, data, element, { group, paths = [], raw } = {}) => descriptors.push({
    key, data, group, raw: raw ?? element?.quotes?.[0] ?? "", origin: "claude", paths: [...paths],
    ref: element?.ref ?? null, certainty: element?.certainty ?? null,
    inferred: Array.isArray(element?.inferred) ? [...element.inferred] : (element?.inferred ? ["value"] : []),
    paragraphs: [...(element?.paragraphs ?? [])]
  });
  const clause = (quote, element, reason = "") => describe(NOTE_NOT_AUTOMATED, { raw: quote, ...(reason ? { reason } : {}) }, element, { group: null, raw: quote });
  // Details without a library label use the library's generic "Filled: {path}" label, like the rules do
  const FIELD = `${LIB}Describe.Field`;
  const pathOf = (spec) => (typeof spec.path === "object" && spec.path !== null ? spec.path[type] : spec.path);
  const propertyGroup = keys?.validProperties?.[PROPERTY_GROUP[type]];
  const allowProperty = (key) => !propertyGroup || propertyGroup.has(key);

  // ---- Details -------------------------------------------------------------------------------------------------
  let rarityDetail = null;
  for (const detail of item.details ?? []) {
    const spec = DETAIL_FIELDS[detail.field];
    const path = spec ? pathOf(spec) : null;
    const quotes = detail.quotes.join(" ");
    switch (detail.field) {
      case "rarity":
        setPath(system, "rarity", detail.key);
        rarityDetail = detail;
        if (["uncommon", "rare", "veryRare", "legendary", "artifact"].includes(detail.key) && allowProperty("mgc")) properties.add("mgc");
        describe(`${LIB}Describe.Rarity`, { rarity: detail.key }, detail, { group: "details", paths: ["system.rarity"] });
        break;
      case "attunement":
        setPath(system, "attunement", detail.key);
        describe(`${LIB}Describe.Attunement`, { attunement: detail.key, condition: "" }, detail, { group: "details", paths: ["system.attunement"] });
        break;
      case "attunementCondition":
        clause(detail.quotes[0], detail);
        break;
      case "weight":
        setPath(system, "weight", { value: detail.number, units: detail.key || "lb" });
        describe(`${LIB}Describe.Weight`, { value: detail.number, units: detail.key || "lb" }, detail, { group: "details", paths: ["system.weight"] });
        break;
      case "price":
        setPath(system, "price", { value: detail.number, denomination: detail.key });
        describe(`${LIB}Describe.Price`, { value: detail.number, denomination: detail.key }, detail, { group: "details", paths: ["system.price"] });
        break;
      case "stealthDisadvantage":
        if (path && allowProperty("stealthDisadvantage")) { properties.add("stealthDisadvantage"); propertyQuotes.push(quotes); }
        break;
      case "weaponProperty":
        if (path && allowProperty(detail.key)) { properties.add(detail.key); propertyQuotes.push(quotes); }
        break;
      case "weaponDamage":
      case "versatileDamage":
        if (!path) break;
        setPath(system, path, parser.toDamagePart({ ...detail.dice, type: detail.dice.types[0] ?? null }, keys));
        describe(FIELD, { path: `system.${path}`, value: `${formulaOf(detail.dice)} ${detail.dice.types.join(", ")}`.trim() }, detail, { group: "details", paths: [`system.${path}`] });
        break;
      case "weaponRange":
        if (!path) break;
        setPath(system, "range", { value: detail.number, units: detail.key || "ft" });
        describe(FIELD, { path: "system.range", value: `${detail.number} ${detail.key || "ft"}` }, detail, { group: "details", paths: ["system.range"] });
        break;
      case "destroyOnEmpty":
        setPath(system, "uses.autoDestroy", true);
        describe(FIELD, { path: "system.uses.autoDestroy", value: "true" }, detail, { group: "details", paths: ["system.uses.autoDestroy"] });
        break;
      default:
        // Numbers: magicalBonus (string in dnd5e), armorValue, armorDexCap, strength
        if (!path) break;
        setPath(system, path, detail.field === "magicalBonus" ? String(detail.number) : detail.number);
        describe(FIELD, { path: `system.${path}`, value: String(detail.number) }, detail, { group: "details", paths: [`system.${path}`] });
    }
  }
  if (properties.size) {
    system.properties = [...properties];
    if (propertyQuotes.length) {
      const first = (item.details ?? []).find((d) => ["weaponProperty", "stealthDisadvantage"].includes(d.field));
      describe(FIELD, { path: "system.properties", value: [...properties].join(", ") }, first, { group: "details", paths: ["system.properties"], raw: propertyQuotes.join(" ") });
    } else if (rarityDetail) {
      // The "magical" property comes from the rarity: shown with its quote
      const rarity = descriptors.find((d) => d.ref === rarityDetail.ref && d.key === `${LIB}Describe.Rarity`);
      if (rarity) rarity.paths.push("system.properties");
    }
  }

  // ---- Item uses -----------------------------------------------------------------------------------------------
  if (item.uses?.max) {
    const uses = { max: String(item.uses.max), recovery: item.uses.recovery.map((r) => ({ ...r })) };
    if (item.uses.autoDestroy || system.uses?.autoDestroy) uses.autoDestroy = true;
    system.uses = { ...(system.uses ?? {}), ...uses };
    describe(`${LIB}Describe.Uses`, { max: item.uses.max, period: item.uses.recovery[0]?.period ?? "" }, item.uses, { group: "details", paths: ["system.uses"] });
  }

  // ---- Effects (first: the activities list their ids) -----------------------------------------------------------
  const effectIds = new Map();
  const effects = (item.effects ?? []).map((effect, n) => {
    const label = effect.name || name || "Effect";
    const planEffects = effect.changes.map((change) => toItemEffect(change, effect));
    const sources = parser.toEffects({ name: label, effects: planEffects }, { keys, idGen, name: label });
    const skipped = [...(sources.notes ?? [])];
    notes.push(...skipped);
    const source = sources[0] ?? null;
    if (!source) {
      // Nothing dnd5e can write: the clause stays visible, with its quote
      clause(effect.quotes[0], effect);
      return null;
    }
    source.name = label;
    source.transfer = effect.transfer;
    if (source.flags) delete source.flags;
    // Foundry v13 duration (`{ seconds | rounds | turns }`): "until the end of the next turn" lasts one turn
    const duration = !effect.transfer && effect.duration ? parser.toEffectDuration(effect.duration) : null;
    if (duration) source.duration = duration;
    else delete source.duration;
    effectIds.set(effect.ref, source._id);
    // A change the library skipped (`Note.EffectSkipped { kind, scope }`) is a clause of its own; the others are
    // described one by one (C12: every line cites its passage)
    const skippedKeys = new Set(skipped.map((note) => `${note.data?.kind}|${note.data?.scope ?? ""}`));
    effect.changes.forEach((change, j) => {
      if (skippedKeys.has(`${planEffects[j].kind}|${planEffects[j].scope ?? ""}`)) { clause(effect.quotes[0], effect); return; }
      describe(`${LIB}Describe.Effect`, { kind: change.kind, value: change.value ?? "", scope: change.scope ?? "" }, effect, {
        group: "effects", paths: [`effects.${n}`]
      });
    });
    if (source.duration) {
      // The descriptor shows Claude's reading (`value`, `units`, `until`): the v13 source only holds seconds / turns
      const { value, units, until } = effect.duration;
      describe(`${OWN}Fact.EffectDuration`, { value: until ? "" : (value ?? ""), units: until ? "" : (units ?? ""), until: until ?? "" }, effect, {
        group: "effects", paths: [`effects.${n}`]
      });
    }
    return source;
  });

  // ---- Activities ----------------------------------------------------------------------------------------------
  const activities = (item.activities ?? []).map((activity, n) => {
    const path = `activities.${n}`;
    const fact = (key, data, raw) => describe(key, data, activity, { group: "activities", paths: [path], raw });
    const source = { _id: idGen(), type: activity.type };
    if (activity.name) source.name = activity.name;

    if (activity.type === "cast") {
      const uuid = resolveSpell?.(activity.spell?.name) ?? null;
      if (!uuid) {
        notes.push({ key: NOTE_SPELL_NOT_FOUND, data: { name: activity.spell?.name ?? "" } });
        return null;
      }
      source.spell = { uuid };
      if (activity.spell.level) source.spell.level = activity.spell.level;
    }

    source.activation = { type: activity.activation.type, condition: activity.activation.condition, override: false };
    if (activity.activation.value) source.activation.value = activity.activation.value;
    if (activity.duration) {
      source.duration = { value: str(activity.duration.value), units: activity.duration.units, concentration: activity.duration.concentration, override: true };
    }
    if (activity.range) source.range = { value: str(activity.range.value), units: activity.range.units, special: "", override: true };
    if (activity.target) {
      source.target = { override: true, prompt: true };
      if (activity.target.template) {
        source.target.template = { type: activity.target.template.type, size: String(activity.target.template.size), units: activity.target.template.units };
      }
      if (activity.target.affects) {
        source.target.affects = { type: activity.target.affects.type, count: str(activity.target.affects.count), choice: false, special: activity.target.affects.special };
      }
    }
    if (activity.uses) source.uses = { max: String(activity.uses.max), recovery: [{ period: activity.uses.period, type: "recoverAll" }] };
    if (activity.consume) {
      source.consumption = { targets: [{ type: activity.consume.target, target: "", value: String(activity.consume.amount), scaling: {} }] };
    }
    const parts = (activity.damage ?? []).map((dice) => parser.toDamagePart({ ...dice, type: dice.types[0] ?? null }, keys));
    if (activity.type === "attack") {
      const attack = activity.attack ?? { type: "", classification: "", bonus: 0 };
      source.attack = {
        ability: "", bonus: attack.bonus ? String(attack.bonus) : "", flat: Boolean(attack.bonus),
        type: { value: attack.type, classification: attack.classification }
      };
      source.damage = { includeBase: true, parts };
    } else if (activity.type === "save") {
      source.save = { ability: [...activity.save.abilities], dc: { calculation: "", formula: String(activity.save.dc) } };
      source.damage = { onSave: activity.save.onSave, parts };
    } else if (activity.type === "damage") {
      source.damage = { parts };
    } else if (activity.type === "heal") {
      source.healing = parser.toDamagePart({ ...activity.healing, type: null }, keys);
      source.healing.types = [...activity.healing.types];
    } else if (activity.type === "check") {
      source.check = {
        ability: activity.check.ability, associated: activity.check.skill ? [activity.check.skill] : [],
        dc: { calculation: "", formula: str(activity.check.dc) }
      };
    } else if (activity.type === "utility" && activity.roll) {
      source.roll = { formula: activity.roll.formula, name: activity.roll.name, prompt: false, visible: true };
    }
    const linked = activity.effects.map((ref) => effectIds.get(ref)).filter(Boolean);
    if (linked.length) source.effects = linked.map((_id) => ({ _id }));

    // Descriptors: the activity, then each of its facts (C12: every line cites its passage)
    fact(`${LIB}Describe.Activity`, {
      kind: activity.type, name: activity.name, ...(activity.activation.condition ? { condition: activity.activation.condition } : {})
    });
    if (activity.activation.type) fact(`${LIB}Describe.Activation`, { type: activity.activation.type, cost: activity.activation.value || "" });
    if (activity.duration) fact(`${OWN}Fact.Duration`, { value: activity.duration.value || "", units: activity.duration.units });
    if (activity.range) fact(`${LIB}Describe.Range`, { reach: "", value: `${activity.range.value || ""} ${activity.range.units}`.trim(), long: "" });
    if (activity.target?.template) fact(`${LIB}Describe.Template`, { type: activity.target.template.type, size: `${activity.target.template.size} ${activity.target.template.units}` });
    if (activity.target?.affects) fact(`${LIB}Describe.Target`, { count: activity.target.affects.count || "", type: activity.target.affects.type });
    if (activity.uses) fact(`${LIB}Describe.Uses`, { max: activity.uses.max, period: activity.uses.period });
    if (activity.consume) fact(`${LIB}Describe.Consume`, { amount: activity.consume.amount });
    if (activity.type === "attack") {
      const attack = activity.attack ?? {};
      fact(`${LIB}Describe.Attack`, { type: attack.type ?? "", classification: attack.classification ?? "", bonus: attack.bonus ? String(attack.bonus) : "" });
    }
    if (activity.save) fact(`${LIB}Describe.Save`, { ability: activity.save.abilities.join(", "), dc: activity.save.dc, onSave: activity.save.onSave });
    if (activity.check) fact(`${OWN}Fact.Check`, { ability: activity.check.ability, skill: activity.check.skill, dc: activity.check.dc || "" });
    for (const dice of activity.damage ?? []) fact(`${LIB}Describe.Damage`, { formula: formulaOf(dice), type: dice.types.join(", "), raw: "", save: activity.type === "save" });
    if (activity.healing) fact(`${LIB}Describe.Heal`, { formula: `${formulaOf(activity.healing)} ${activity.healing.types.join(", ")}`.trim() });
    if (activity.roll && source.roll) fact(`${OWN}Fact.Roll`, { formula: activity.roll.formula, name: activity.roll.name });
    if (activity.spell) fact(`${LIB}Describe.Cast`, { name: activity.spell.name, level: activity.spell.level || "", dc: "", attack: "", charges: "" });
    return source;
  });

  // ---- Clauses and flavor --------------------------------------------------------------------------------------
  for (const entry of item.notAutomated ?? []) clause(entry.quote, entry, entry.reason);
  for (const entry of item.flavor ?? []) {
    describe(NOTE_FLAVOR, { text: entry.text }, { quotes: [entry.text], paragraphs: entry.paragraphs }, { group: null, raw: entry.text });
  }

  return { system, activities, effects, descriptors, notes };
}

/**
 * One validated change of Claude as an `ItemEffect` of the library (`toEffects` picks the dnd5e key).
 * @param {{ kind: string, scope: string, on: string, value: * }} change
 * @param {{ transfer: boolean, quotes: string[] }} effect
 * @returns {object}
 */
export function toItemEffect(change, effect) {
  const { kind, on } = change;
  let scope = change.scope || null;
  // "all" means every roll: the library writes the general key when there is no scope (not for damage reduction)
  if (ALL_SCOPES.includes(change.scope) && ["save", "check", "attack", "damage", "speed", "advantage", "disadvantage"].includes(kind)) scope = null;
  const result = { kind, scope, value: change.value ?? null, raw: effect.quotes?.[0] ?? "", origin: "claude", when: effect.transfer ? "passive" : "onUse", duration: null, activity: null };
  if (on) result.on = on;
  if (BONUS_KINDS.includes(kind)) result.value = String(change.value);
  return result;
}
