import { describe, expect, it } from "vitest";
import { buildChangeSet, pruneChangeSet } from "../../scripts/core/changes.mjs";
import { analyze } from "../../scripts/core/analyze.mjs";
import { K, blank, idGenerator, p, parser, resolveSpell, run } from "../helpers/analysis.mjs";
import { referenceFile } from "../helpers/keys.mjs";

const FLAME = p(
  "Weapon (any sword), rare (requires attunement)",
  "You can use a bonus action to speak this magic sword's command word, causing flames to erupt from the blade. While the sword is ablaze, it deals an extra 2d6 fire damage to any target it hits."
);
const CLOAK = p("Wondrous item, uncommon (requires attunement)", "You gain a +1 bonus to AC and saving throws while you wear this cloak.");

/** An item already configured by hand ("partial" fixture): filled details, one activity, one effect. */
const partialWeapon = () => ({
  type: "weapon",
  system: {
    rarity: "common", attunement: "optional", type: { value: "simpleM" }, price: { value: 5, denomination: "sp" },
    weight: { value: 2, units: "lb" },
    activities: { handmade000000001: { _id: "handmade000000001", type: "attack", name: "Mine", damage: { parts: [] } } }
  },
  effects: [{ _id: "handeffect000001", name: "Mine", transfer: true, changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "+9", priority: null }], duration: { seconds: null, rounds: null, turns: null } }]
});
const partialEquipment = () => ({
  type: "equipment",
  system: { rarity: "rare", attunement: "optional", type: { value: "clothing" } },
  effects: [{ _id: "handeffect000002", name: "Mine", transfer: true, changes: [{ key: "system.traits.dr.value", mode: 2, value: "cold", priority: null }], duration: { seconds: null, rounds: null, turns: null } }]
});

const filled = (parser, source, path) => {
  const value = path.replace(/^system\./, "").split(".").reduce((o, k) => o?.[k], source.system);
  return !(parser.isEmpty(value) || value === false || value === 0);
};

describe("merge without 'Replace existing' (C13, M6)", () => {
  it("never writes a field that is already filled", async () => {
    const source = partialWeapon();
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" }, { source });
    // The sub-type the user picked in the type window (system.type.value) is explicit and may replace the old one.
    for (const path of Object.keys(cs.systemPatch).filter((k) => k !== "system.type.value")) expect(filled(parser, source, path), path).toBe(false);
    expect(cs.systemPatch).not.toHaveProperty("system.rarity");
    expect(cs.systemPatch).not.toHaveProperty("system.attunement");
  });
  it("kept fields are listed as 'keep' with their previous value", async () => {
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" }, { source: partialWeapon() });
    const kept = cs.entries.filter((e) => e.group === "details" && e.action === "keep");
    expect(kept.length).toBeGreaterThan(0);
    expect(JSON.stringify(kept.map((k) => k.previous))).toContain("common");
  });
  it("fills what is empty in the same pass", async () => {
    const source = partialWeapon();
    delete source.system.price;
    const { changeSet: cs } = await run({ html: p("Weapon, rare", "This weapon costs 50 gp."), type: "weapon", value: "simpleM" }, { source });
    expect(cs.systemPatch).toMatchObject({ "system.price.value": 50, "system.price.denomination": "gp" });
    expect(cs.systemPatch).not.toHaveProperty("system.rarity");
  });
  it("never removes existing activities or effects", async () => {
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" }, { source: partialWeapon() });
    expect(cs.activities.remove).toEqual([]);
    expect(cs.effects.remove).toEqual([]);
    expect(cs.entries.some((e) => e.action === "remove")).toBe(false);
    expect(cs.activities.add.length).toBeGreaterThan(0);
  });
  it("adds effects next to the existing ones", async () => {
    const { changeSet: cs } = await run({ html: CLOAK, type: "equipment", value: "clothing" }, { source: partialEquipment() });
    expect(cs.effects.add).toHaveLength(1);
    expect(cs.effects.remove).toEqual([]);
  });
  it("is idempotent: what was proposed and already exists is not added again", async () => {
    const first = await run({ html: CLOAK, type: "equipment", value: "clothing" });
    const source = partialEquipment();
    source.effects = first.changeSet.effects.add;
    const again = await analyze({ name: "Item", html: CLOAK, type: "equipment", value: "clothing", source }, { parser, keys: K, idGen: idGenerator(), resolveSpell });
    const cs = buildChangeSet(source, again, { parser });
    expect(cs.effects.add).toEqual([]);
    expect(cs.entries.filter((e) => e.group === "effects").every((e) => e.action === "keep")).toBe(true);
  });
});

describe("'Replace existing' (C13)", () => {
  it("overwrites proposed details and lists the replaced value", async () => {
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" }, { source: partialWeapon(), replace: true });
    expect(cs.systemPatch).toMatchObject({ "system.rarity": "rare", "system.attunement": "required" });
    const replaced = cs.entries.filter((e) => e.action === "replace");
    expect(replaced.length).toBeGreaterThan(0);
    expect(JSON.stringify(replaced.map((e) => e.previous))).toContain("common");
  });
  it("replaces the activities group, listing each removal", async () => {
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" }, { source: partialWeapon(), replace: true });
    expect(cs.activities.remove).toEqual(["handmade000000001"]);
    expect(cs.entries.filter((e) => e.group === "activities" && e.action === "remove").map((e) => e.previous)).toContain("Mine");
    expect(cs.activities.add.length).toBeGreaterThan(0);
  });
  it("replaces effects only in a group where a proposal exists", async () => {
    // FLAME proposes no effect: the existing effect stays even with 'Replace'
    const flame = await run({ html: FLAME, type: "weapon", value: "martialM" }, { source: partialWeapon(), replace: true });
    expect(flame.changeSet.effects.remove).toEqual([]);
    const cloak = await run({ html: CLOAK, type: "equipment", value: "clothing" }, { source: partialEquipment(), replace: true });
    expect(cloak.changeSet.effects.remove).toEqual(["handeffect000002"]);
    expect(cloak.changeSet.effects.add).toHaveLength(1);
    expect(cloak.changeSet.entries.some((e) => e.group === "effects" && e.action === "remove")).toBe(true);
  });
  it("a group without proposal is untouched: activities stay when only effects are proposed", async () => {
    const source = partialEquipment();
    source.system.activities = { a: { _id: "a", type: "utility", name: "Keep" } };
    const { changeSet: cs } = await run({ html: CLOAK, type: "equipment", value: "clothing" }, { source, replace: true });
    expect(cs.activities.remove).toEqual([]);
  });
  it("unchecking the box again gives the merge result (no remove, no replace)", async () => {
    const source = partialWeapon();
    const on = await run({ html: FLAME, type: "weapon", value: "martialM" }, { source, replace: true });
    const off = buildChangeSet(source, on.proposal, { replace: false, parser });
    expect(off.activities.remove).toEqual([]);
    expect(off.entries.some((e) => !e.derived && (e.action === "replace" || e.action === "remove"))).toBe(false);
  });
});

describe("type change (C4)", () => {
  it("records the conversion with the carried-over system", async () => {
    const source = { type: "loot", system: { description: { value: "<p>x</p>" }, quantity: 4, price: { value: 3, denomination: "gp" }, activities: {} }, effects: [] };
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" }, { source });
    expect(cs.typeChange).toMatchObject({ from: "loot", to: "weapon" });
    expect(cs.typeChange.system).toMatchObject({ description: { value: "<p>x</p>" }, quantity: 4 });
    expect(cs.typeChange.system).not.toHaveProperty("activities");
  });
  it("no conversion when the type is unchanged", async () => {
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" });
    expect(cs.typeChange).toBeNull();
  });
  it("values carried over by the conversion count as existing (not overwritten without Replace)", async () => {
    const source = { type: "loot", system: { price: { value: 3, denomination: "gp" } }, effects: [] };
    const { changeSet: cs } = await run({ html: p("Weapon, rare", "This weapon costs 50 gp."), type: "weapon", value: "martialM" }, { source });
    expect(cs.systemPatch).not.toHaveProperty("system.price.value");
  });
  it("existing activities of the old type are listed for removal by the conversion", async () => {
    const source = { type: "weapon", system: { activities: { a: { _id: "a", type: "attack", name: "Old" } } }, effects: [] };
    const { changeSet: cs } = await run({ html: p("Potion, common", "You regain 2d4 + 2 hit points when you drink this potion."), type: "consumable", value: "potion" }, { source });
    expect(cs.typeChange.to).toBe("consumable");
    expect(cs.entries.filter((e) => e.action === "remove" && e.group === "activities")).toHaveLength(1);
  });
});

describe("pruneChangeSet", () => {
  it("drops the entries whose changes were all refused and recomputes 'empty'", async () => {
    const { changeSet: cs } = await run({ html: CLOAK, type: "equipment", value: "" });
    const id = cs.effects.add[0]._id;
    cs.effects.add = [];
    const before = cs.entries.length;
    const pruned = pruneChangeSet(cs, { effects: [id] });
    expect(pruned.entries.some((e) => e.group === "effects")).toBe(false);
    expect(pruned.entries.length).toBeLessThan(before);
  });
  it("keeps entries that still have a live change", async () => {
    const { changeSet: cs } = await run({ html: CLOAK, type: "equipment", value: "clothing" });
    const n = cs.entries.length;
    expect(pruneChangeSet(cs, {}).entries).toHaveLength(n);
  });
});

describe("reference-set invariants (C5-C7 on real compendium texts)", () => {
  const items = referenceFile("srd-items.json");
  it("analysis never throws and never writes ids that are not 16 characters", async () => {
    for (const item of items.slice(0, 70)) {
      const { changeSet: cs } = await run({ name: item.name, html: item.description, type: item.type, value: item.value, subtype: item.subtype });
      for (const a of cs.activities.add) expect(a._id, item.name).toMatch(/^[A-Za-z0-9]{16}$/);
      for (const e of cs.effects.add) expect(e._id, item.name).toMatch(/^[A-Za-z0-9]{16}$/);
    }
  });
  it("an item filled with its own proposal is a fixed point (second pass adds nothing)", async () => {
    for (const item of items.slice(0, 25)) {
      const first = await run({ name: item.name, html: item.description, type: item.type, value: item.value, subtype: item.subtype });
      const source = blank(item.type);
      source.system = {};
      for (const [path, value] of Object.entries(first.changeSet.systemPatch)) {
        const keys = path.replace(/^system\./, "").split(".");
        let o = source.system;
        keys.slice(0, -1).forEach((k) => { o = o[k] ??= {}; });
        o[keys.at(-1)] = value;
      }
      for (const a of first.changeSet.activities.add) source.system.activities = { ...source.system.activities, [a._id]: a };
      source.effects = first.changeSet.effects.add;
      const again = buildChangeSet(source, first.proposal, { parser });
      expect(Object.keys(again.systemPatch), item.name).toEqual([]);
      expect(again.effects.add, item.name).toEqual([]);
    }
  });
});
