import { describe, expect, it } from "vitest";
import { parseItem } from "dnd5e-text-parser";
import { SUPPORTED_TYPES, buildTypeChoices, guessType } from "../../scripts/core/types.mjs";
import { dnd5eConfig, keys, referenceFile } from "../helpers/keys.mjs";

describe("buildTypeChoices (C3)", () => {
  const choices = buildTypeChoices(dnd5eConfig(), (k) => `L:${k}`);
  const typeConfig = referenceFile("type-config.json");

  it("lists the six supported types in order, localized", () => {
    expect(choices.map((c) => c.type)).toEqual(["consumable", "weapon", "equipment", "tool", "loot", "container"]);
    expect(choices.map((c) => c.type)).toEqual(SUPPORTED_TYPES);
    expect(choices[0].label).toBe("L:item-configurator.Type.consumable");
  });
  it("offers every dnd5e sub-type of the real configuration", () => {
    for (const choice of choices) {
      const values = new Set(choice.subtypes.map((s) => s.value));
      for (const expected of typeConfig.subtypes[choice.type]) {
        expect(values, `${choice.type}:${expected}`).toContain(expected);
      }
    }
  });
  it("has potion, scroll and ammunition for consumables, weapon and armor categories", () => {
    const by = Object.fromEntries(choices.map((c) => [c.type, c.subtypes.map((s) => s.value)]));
    expect(by.consumable).toEqual(expect.arrayContaining(["potion", "scroll", "ammo"]));
    expect(by.weapon).toEqual(expect.arrayContaining(["simpleM", "martialM", "martialR"]));
    expect(by.equipment).toEqual(expect.arrayContaining(["light", "medium", "heavy", "shield", "clothing", "ring"]));
  });
  it("a container has no sub-type", () => {
    expect(choices.find((c) => c.type === "container").subtypes).toEqual([]);
  });
  it("adds consumable sub-subtypes as value + subtype", () => {
    const config = { consumableTypes: { ammo: { label: "Ammunition", subtypes: { arrow: "Arrow" } } } };
    const sub = buildTypeChoices(config).find((c) => c.type === "consumable").subtypes;
    expect(sub).toEqual([{ value: "ammo", label: "Ammunition" }, { value: "ammo", subtype: "arrow", label: "Ammunition: Arrow" }]);
  });
  it("tolerates an empty configuration", () => {
    expect(buildTypeChoices({}).every((c) => c.subtypes.length === 0)).toBe(true);
    expect(buildTypeChoices(undefined)).toHaveLength(6);
  });
});

describe("guessType (C3)", () => {
  const k = keys();
  const plan = (name, html, itemType) => parseItem(name, html, { itemType, keys: k });

  it("potion text on a loot item -> consumable / potion", () => {
    const p = plan("Potion of Healing", "<p>Potion, common</p><p>You regain 2d4 + 2 hit points when you drink this potion.</p>", "loot");
    expect(guessType(p, { type: "loot", system: {} })).toMatchObject({ type: "consumable", value: "potion" });
  });
  it("sword text on a loot item -> weapon", () => {
    const p = plan("Flame Tongue", "<p>Weapon (any sword), rare (requires attunement)</p>", "loot");
    expect(guessType(p, { type: "loot" }).type).toBe("weapon");
  });
  it("armor text -> equipment", () => {
    const p = plan("Plate", "<p>Heavy armor (plate), base AC 18, Strength 15.</p>", "loot");
    expect(guessType(p, { type: "loot" }).type).toBe("equipment");
  });
  it("a cloak with no armor data keeps the current type and sub-type", () => {
    const p = plan("Cloak", "<p>Wondrous item, uncommon (requires attunement)</p><p>You gain a +1 bonus to AC.</p>", "equipment");
    expect(guessType(p, { type: "equipment", system: { type: { value: "clothing", subtype: "" } } }))
      .toEqual({ type: "equipment", value: "clothing", subtype: "" });
  });
  it("the item's own sub-type wins when the text agrees with the current type", () => {
    const p = { details: { weapon: { category: "simpleM" } } };
    expect(guessType(p, { type: "weapon", system: { type: { value: "martialM", subtype: "x" } } }))
      .toEqual({ type: "weapon", value: "martialM", subtype: "x" });
  });
  it("the text's sub-type is used when the item has none", () => {
    expect(guessType({ details: { weapon: { category: "martialR" } } }, { type: "weapon", system: {} }))
      .toEqual({ type: "weapon", value: "martialR", subtype: "" });
  });
  it("the text wins over a different current type", () => {
    expect(guessType({ details: { consumable: { type: "scroll" } } }, { type: "weapon", system: { type: { value: "martialM" } } }))
      .toEqual({ type: "consumable", value: "scroll", subtype: "" });
  });
  it("no plan: keeps the supported current type, else loot", () => {
    expect(guessType(null, { type: "tool", system: { type: { value: "art" } } })).toEqual({ type: "tool", value: "art", subtype: "" });
    expect(guessType(null, { type: "spell" })).toEqual({ type: "loot", value: "", subtype: "" });
    expect(guessType(undefined, undefined)).toEqual({ type: "loot", value: "", subtype: "" });
  });
});
