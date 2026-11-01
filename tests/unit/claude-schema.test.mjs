// Output schema of the Claude-first mode (limits of the structured outputs) and its enumerations.
import { describe, expect, it } from "vitest";
import { ACTIVITY_TYPES, DETAIL_FIELDS, EFFECT_KINDS, buildItemSchema, countOptional, schemaEnums } from "../../scripts/ai/claude-schema.mjs";
import { referenceFile } from "../helpers/keys.mjs";
import { ENUMS, durationUnitsOf } from "../helpers/claude.mjs";

const snapshot = referenceFile("schema-enums.json");
const schema = buildItemSchema(ENUMS);

/** Every sub-schema of a schema, with its JSON path. */
function* walk(node, path = "$") {
  if (!node || typeof node !== "object") return;
  yield [path, node];
  for (const [name, child] of Object.entries(node.properties ?? {})) yield* walk(child, `${path}.${name}`);
  if (node.items) yield* walk(node.items, `${path}[]`);
}
const all = [...walk(schema)];

describe("schemaEnums", () => {
  it("rebuilds sorted enumerations from the Foundry snapshot", () => {
    for (const [name, values] of Object.entries(ENUMS)) {
      if (name === "validProperties" || name === "weightUnits") continue; // weightUnits: fixed ["lb","kg"], deterministic
      if (name === "effectDurationUnits") continue; // Foundry 13 has no CONST.ACTIVE_EFFECT_DURATION_UNITS (I9), checked below
      expect(values, name).toEqual([...values].sort());
      expect(values.length, name).toBeGreaterThan(0);
    }
    expect(ENUMS.timePeriods).toEqual(expect.arrayContaining(["inst", "minute", "hour", "day", "perm", "round", "turn"]));
    expect(ENUMS.distanceUnits).toEqual(expect.arrayContaining(["ft", "m", "mi", "km", "self", "touch"]));
    // I9: Foundry 13 has no CONST.ACTIVE_EFFECT_DURATION_UNITS
    expect(ENUMS.effectDurationUnits).toEqual([]);
    expect(ENUMS.validProperties.equipment).toContain("mgc");
    expect(ENUMS.limitedUsePeriods).toEqual(expect.arrayContaining(["lr", "sr", "dawn", "dusk", "day"]));
  });
  it("accepts a Map, a Set or an object as well (live CONFIG shapes)", () => {
    const live = { abilities: new Map([["str", {}], ["dex", {}]]), skills: new Set(["acr"]), damageTypes: { fire: "x" } };
    const e = schemaEnums(live, {});
    expect(e.abilities).toEqual(["dex", "str"]);
    expect(e.skills).toEqual(["acr"]);
    expect(e.damageTypes).toEqual(["fire"]);
  });
  it("does not choke on an empty configuration", () => {
    expect(() => buildItemSchema(schemaEnums({}, {}))).not.toThrow();
  });
});

describe("output schema (structured-output limits)", () => {
  it("every object forbids additional properties and requires only declared properties", () => {
    const objects = all.filter(([, n]) => n.type === "object");
    expect(objects.length).toBeGreaterThan(15);
    for (const [path, node] of objects) {
      expect(node.additionalProperties, path).toBe(false);
      for (const name of node.required ?? []) expect(Object.keys(node.properties), `${path}.${name}`).toContain(name);
    }
  });
  it("has no union type: no anyOf / oneOf / allOf, no array in `type`", () => {
    for (const [path, node] of all) {
      for (const word of ["anyOf", "oneOf", "allOf", "not", "$ref", "if", "then"]) expect(node, `${path}.${word}`).not.toHaveProperty(word);
      expect(typeof node.type, path).toBe("string");
    }
  });
  it("uses no unsupported keyword (bounds are checked after the fact)", () => {
    const banned = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "minItems", "maxItems",
      "multipleOf", "format", "default", "uniqueItems"];
    for (const [path, node] of all) for (const word of banned) expect(node, `${path}.${word}`).not.toHaveProperty(word);
  });
  it("has at most 24 optional fields (17 by design)", () => {
    expect(countOptional(schema)).toBeLessThanOrEqual(24);
    expect(countOptional(schema)).toBe(17);
  });
  it("is stable: the same enumerations give the byte-identical schema (cache)", () => {
    const again = buildItemSchema(schemaEnums(snapshot.dnd5e, durationUnitsOf(snapshot.const)));
    expect(JSON.stringify(again)).toBe(JSON.stringify(schema));
    expect(JSON.stringify(buildItemSchema(ENUMS))).toBe(JSON.stringify(schema));
  });
  it("lists every enumeration in a sorted order", () => {
    for (const [path, node] of all) {
      if (!node.enum) continue;
      if (path.endsWith("certainty") || path.endsWith(".type") && node.enum.length <= 3) continue;
      expect(new Set(node.enum).size, path).toBe(node.enum.length);
    }
    const sorted = (values) => [...values].sort();
    expect(schema.properties.activities.items.properties.duration.properties.units.enum).toEqual(sorted(ENUMS.timePeriods));
    expect(schema.properties.activities.items.properties.range.properties.units.enum).toEqual(sorted(ENUMS.distanceUnits));
  });
  it("exposes only the 7 activity types, the effect kinds of the library and the detail fields of the design", () => {
    const activity = schema.properties.activities.items.properties;
    expect(activity.type.enum).toEqual(ACTIVITY_TYPES);
    expect(ACTIVITY_TYPES).toEqual(["attack", "save", "damage", "heal", "cast", "check", "utility"]);
    for (const excluded of ["enchant", "forward", "summon", "transform", "order", "teleport"]) expect(activity.type.enum).not.toContain(excluded);
    expect(schema.properties.effects.items.properties.changes.items.properties.kind.enum).toEqual(EFFECT_KINDS);
    expect(schema.properties.details.items.properties.field.enum).toEqual(Object.keys(DETAIL_FIELDS));
    expect(Object.keys(DETAIL_FIELDS)).toEqual(expect.arrayContaining(["rarity", "attunement", "magicalBonus", "armorValue", "weaponDamage", "weaponProperty", "destroyOnEmpty"]));
  });
  it("never lets Claude choose a system.* path: no free path field in the schema", () => {
    const names = all.flatMap(([, n]) => Object.keys(n.properties ?? {}));
    for (const forbidden of ["path", "key_path", "system", "uuid", "mode"]) expect(names).not.toContain(forbidden);
  });
  it("is small enough to compile (a few KB)", () => {
    const size = JSON.stringify(schema).length;
    expect(size).toBeGreaterThan(2000);
    expect(size).toBeLessThan(20000);
  });
});
