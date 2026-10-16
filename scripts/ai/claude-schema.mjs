/**
 * Enumerations and JSON schema of the answer Claude gives in the "Claude first" mode (one call per item, the whole
 * description, a structured output close to the dnd5e data). Pure: no Foundry global, no network.
 *
 * Constraints of the Messages API structured outputs (the client is a raw `fetch`, no SDK strips unsupported
 * keywords): `additionalProperties: false` on every object, no union type (`anyOf`, `type: [x, "null"]`: absence is
 * `""`, `0` or `[]`), no `minimum` / `maximum` / `maxItems` / `minLength` / `pattern` (bounds are checked afterwards
 * in `claude-validate.mjs`), at most 24 optional fields in the whole schema (this one has 17).
 *
 * The schema is built once per session from `CONFIG.DND5E` with sorted enumerations: it is identical from one call
 * to the next, which keeps the prompt cache and the compiled grammar of the API.
 */

/** Activity types Claude may propose: the ones that reference no other document nor profile. */
export const ACTIVITY_TYPES = ["attack", "save", "damage", "heal", "cast", "check", "utility"];

/** `kind` of an `ItemEffect` of the dnd5e-text-parser library (`toEffects` knows how to write each of them). */
export const EFFECT_KINDS = ["ac", "attack", "damage", "save", "check", "resistance", "immunity", "vulnerability",
  "advantage", "disadvantage", "abilityScore", "speed", "speedMultiplier", "damageReduction", "sense"];

/** Effect kinds whose value is a bonus written as a signed string ("+1"), like the rules do. */
export const BONUS_KINDS = ["ac", "attack", "damage", "save", "check"];
/** Effect kinds whose value is a number (feet, score, factor, amount). */
export const NUMBER_KINDS = ["abilityScore", "speed", "speedMultiplier", "damageReduction", "sense"];
/** Effect kinds without any value: the scope says everything. */
export const NO_VALUE_KINDS = ["resistance", "immunity", "vulnerability", "advantage", "disadvantage"];

/** `inferred` fields of an activity: the only ones Claude may fill without a quote (always marked "inferred"). */
export const INFERRABLE = ["activation", "range", "target", "duration"];

export const CERTAINTIES = ["high", "medium", "low"];
export const CONSUME_TARGETS = ["", "itemUses", "activityUses"];
export const EFFECT_ON = ["", "save", "check", "skill"];
export const EFFECT_UNTIL = ["", "sourceEnd", "sourceStart"];
export const RECOVERY_TYPES = ["recoverAll", "formula"];
export const ATTACK_TYPES = ["", "melee", "ranged"];
export const ATTACK_CLASSIFICATIONS = ["", "weapon", "spell", "unarmed"];
export const ON_SAVE = ["", "half", "none", "full"];
export const WEIGHT_UNITS = ["lb", "kg"];

/**
 * Fields of a `Detail`: the item-level facts, and the `system.*` path (per item type when it differs) each one
 * writes. `key` names the enumeration of `Enums` that constrains `Detail.key` (`""` = no key), `value` what the
 * detail carries (`key`, `number`, `dice`, or nothing).
 */
export const DETAIL_FIELDS = {
  rarity: { value: "key", key: "itemRarity", path: "rarities" },
  attunement: { value: "key", key: "attunementTypes", path: "attunement" },
  attunementCondition: { value: "", path: null },           // kept as a clause: dnd5e 6 has no field for it
  magicalBonus: { value: "number", path: { weapon: "magicalBonus", equipment: "armor.magicalBonus" } },
  weight: { value: "number", key: "weightUnits", path: "weight" },
  price: { value: "number", key: "currencies", path: "price" },
  armorValue: { value: "number", path: { equipment: "armor.value" } },
  armorDexCap: { value: "number", path: { equipment: "armor.dex" } },
  strength: { value: "number", path: { equipment: "strength" } },
  stealthDisadvantage: { value: "", path: { equipment: "properties" } },
  weaponDamage: { value: "dice", path: { weapon: "damage.base" } },
  versatileDamage: { value: "dice", path: { weapon: "damage.versatile" } },
  weaponProperty: { value: "key", key: "validProperties", path: { weapon: "properties", equipment: "properties", consumable: "properties" } },
  weaponRange: { value: "number", path: { weapon: "range" } },
  destroyOnEmpty: { value: "", path: "uses.autoDestroy" }
};

const sortedKeys = (value) => {
  if (!value) return [];
  if (value instanceof Set) return [...value].sort();
  if (value instanceof Map) return [...value.keys()].sort();
  if (Array.isArray(value)) return [...value].map(String).sort();
  if (typeof value === "object") return Object.keys(value).sort();
  return [];
};

/** Keys of `timePeriods` an activity or an effect duration can count ("1 minute"): the scalar ones. */
const SCALAR_PERIODS = ["turn", "round", "second", "minute", "hour", "day", "week", "month", "year"];

/**
 * Enumerations of the schema, as sorted arrays, from `CONFIG.DND5E` and Foundry's `CONST`. Pure; accepts the
 * snapshot of `tests/fixtures/reference/schema-enums.json` as well as the live configuration (objects, Maps or
 * Sets are all read as their keys).
 * @param {object} dnd5eConfig   `CONFIG.DND5E` (or a snapshot of its relevant groups).
 * @param {object} [coreConst]   `CONST` (`ACTIVE_EFFECT_DURATION_UNITS`).
 * @returns {Record<string, string[]> & { validProperties: Record<string, string[]> }}
 */
export function schemaEnums(dnd5eConfig, coreConst) {
  const config = dnd5eConfig ?? {};
  const group = (name) => sortedKeys(config[name]);
  const timePeriods = group("timePeriods");
  const enums = {
    abilities: group("abilities"),
    skills: group("skills"),
    damageTypes: group("damageTypes"),
    healingTypes: group("healingTypes"),
    conditionTypes: group("conditionTypes"),
    itemRarity: group("itemRarity"),
    attunementTypes: group("attunementTypes"),
    currencies: group("currencies"),
    weightUnits: group("weightUnits").filter((unit) => WEIGHT_UNITS.includes(unit)),
    activityActivationTypes: group("activityActivationTypes"),
    limitedUsePeriods: group("limitedUsePeriods"),
    timePeriods,
    scalarTimePeriods: timePeriods.filter((period) => SCALAR_PERIODS.includes(period)),
    distanceUnits: group("distanceUnits"),
    areaTargetTypes: group("areaTargetTypes"),
    individualTargetTypes: group("individualTargetTypes"),
    movementTypes: group("movementTypes"),
    senses: group("senses"),
    effectDurationUnits: sortedKeys(coreConst?.ACTIVE_EFFECT_DURATION_UNITS),
    validProperties: {}
  };
  if (!enums.weightUnits.length) enums.weightUnits = [...WEIGHT_UNITS].sort();
  for (const type of ["weapon", "equipment", "consumable"]) {
    enums.validProperties[type] = sortedKeys(config.validProperties?.[type]);
  }
  return enums;
}

/** Every `scope` an effect change may carry: abilities, skills, damage types, conditions, senses, movements, rolls. */
export function effectScopes(enums) {
  return [...new Set([
    "", "all", "mwak", "rwak", "msak", "rsak", "weapon", "spell",
    ...enums.abilities, ...enums.skills, ...enums.damageTypes, ...enums.conditionTypes, ...enums.senses,
    ...enums.movementTypes
  ])].sort();
}

const string = () => ({ type: "string" });
const integer = () => ({ type: "integer" });
const boolean = () => ({ type: "boolean" });
const oneOf = (values) => ({ type: "string", enum: [...values] });
const list = (items) => ({ type: "array", items });
const object = (properties, optional = []) => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((name) => !optional.includes(name)),
  additionalProperties: false
});

/**
 * JSON schema of the answer (`output_config.format.schema`). Same enumerations in, same schema out (cache).
 * @param {object} enums   Result of `schemaEnums`.
 * @returns {object}
 */
export function buildItemSchema(enums) {
  const withBlank = (values) => [...new Set(["", ...values])].sort();
  const dice = object({
    number: integer(),
    denomination: integer(),
    bonus: string(),
    types: list(oneOf([...new Set([...enums.damageTypes, ...enums.healingTypes])].sort()))
  });
  const common = {
    quotes: list(string()),
    certainty: oneOf(CERTAINTIES)
  };
  const propertyKeys = [...new Set([
    "", ...enums.itemRarity, ...enums.attunementTypes, ...enums.currencies, ...enums.weightUnits,
    ...Object.values(enums.validProperties).flat()
  ])].sort();

  const detail = object({
    field: oneOf(Object.keys(DETAIL_FIELDS)),
    key: oneOf(propertyKeys),
    number: integer(),
    dice,
    ...common,
    inferred: boolean()
  }, ["key", "number", "dice"]);

  const uses = object({
    max: integer(),
    recovery: list(object({
      period: oneOf(enums.limitedUsePeriods),
      type: oneOf(RECOVERY_TYPES),
      formula: string()
    })),
    autoDestroy: boolean(),
    ...common,
    inferred: boolean()
  });

  const activity = object({
    ref: string(),
    type: oneOf(ACTIVITY_TYPES),
    name: string(),
    ...common,
    inferred: list(oneOf(INFERRABLE)),
    activation: object({ type: oneOf(withBlank(enums.activityActivationTypes)), value: integer(), condition: string() }),
    duration: object({ value: integer(), units: oneOf(enums.timePeriods), concentration: boolean() }),
    range: object({ value: integer(), units: oneOf(enums.distanceUnits) }),
    target: object({
      template: object({ type: oneOf(withBlank(enums.areaTargetTypes)), size: integer(), units: oneOf(enums.distanceUnits) }),
      affects: object({ type: oneOf(withBlank(enums.individualTargetTypes)), count: integer(), special: string() })
    }),
    uses: object({ max: integer(), period: oneOf(enums.limitedUsePeriods) }),
    consume: object({ target: oneOf(CONSUME_TARGETS), amount: integer() }),
    attack: object({ type: oneOf(ATTACK_TYPES), classification: oneOf(ATTACK_CLASSIFICATIONS), bonus: integer() }),
    save: object({ abilities: list(oneOf(enums.abilities)), dc: integer(), onSave: oneOf(ON_SAVE) }),
    check: object({ ability: oneOf(withBlank(enums.abilities)), skill: oneOf(withBlank(enums.skills)), dc: integer() }),
    damage: list(dice),
    healing: dice,
    roll: object({ formula: string(), name: string() }),
    spell: object({ name: string(), level: integer() }),
    effects: list(string())
  }, ["duration", "range", "target", "uses", "consume", "attack", "save", "check", "damage", "healing", "roll", "spell"]);

  const effect = object({
    ref: string(),
    name: string(),
    ...common,
    inferred: boolean(),
    transfer: boolean(),
    changes: list(object({
      kind: oneOf(EFFECT_KINDS),
      scope: oneOf(effectScopes(enums)),
      on: oneOf(EFFECT_ON),
      value: string()
    })),
    duration: object({ value: integer(), units: oneOf(withBlank(enums.timePeriods)), until: oneOf(EFFECT_UNTIL) })
  }, ["duration"]);

  return object({
    details: list(detail),
    uses,
    activities: list(activity),
    effects: list(effect),
    notAutomated: list(object({ quote: string(), reason: string() })),
    flavor: list(string())
  }, ["uses"]);
}

/**
 * Number of optional fields of a schema (properties absent from `required`), for the API limit of 24.
 * @param {object} schema
 * @returns {number}
 */
export function countOptional(schema) {
  if (!schema || typeof schema !== "object") return 0;
  let count = 0;
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    for (const [name, child] of Object.entries(schema.properties)) {
      if (!required.has(name)) count++;
      count += countOptional(child);
    }
  }
  if (schema.items) count += countOptional(schema.items);
  return count;
}
