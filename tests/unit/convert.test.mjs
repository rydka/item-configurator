import { describe, expect, it } from "vitest";
import { carryOverSystem } from "../../scripts/core/convert.mjs";

const oldSystem = () => ({
  description: { value: "<p>Text</p>", chat: "c" }, identifier: "my-item", source: { book: "PHB" },
  identified: true, unidentified: { name: "Strange" },
  container: "abc", quantity: 3, weight: { value: 2, units: "lb" }, price: { value: 10, denomination: "gp" }, rarities: undefined,
  attunement: "required", attuned: true, equipped: true,
  activities: { a1: { type: "attack" } }, uses: { max: "3" }, type: { value: "martialM" }, damage: { base: {} }
});

describe("carryOverSystem (C4)", () => {
  it("keeps description, source, quantity, weight, price, container and attunement", () => {
    const r = carryOverSystem(oldSystem(), "weapon", "consumable");
    expect(r.description.value).toBe("<p>Text</p>");
    expect(r).toMatchObject({ identifier: "my-item", quantity: 3, container: "abc", attunement: "required", equipped: true });
    expect(r.price).toEqual({ value: 10, denomination: "gp" });
    expect(r.weight).toEqual({ value: 2, units: "lb" });
  });
  it("drops activities, uses, type and type-specific fields", () => {
    const r = carryOverSystem(oldSystem(), "weapon", "loot");
    for (const key of ["activities", "uses", "type", "damage"]) expect(r).not.toHaveProperty(key);
  });
  it("a loot target does not keep the equippable fields", () => {
    const r = carryOverSystem(oldSystem(), "weapon", "loot");
    for (const key of ["attunement", "attuned", "equipped"]) expect(r).not.toHaveProperty(key);
  });
  it("does not carry undefined fields", () => {
    expect(carryOverSystem(oldSystem(), "weapon", "tool")).not.toHaveProperty("rarities");
  });
  it("deep copies: mutating the result leaves the source untouched", () => {
    const src = oldSystem();
    const r = carryOverSystem(src, "weapon", "equipment");
    r.description.value = "changed";
    expect(src.description.value).toBe("<p>Text</p>");
  });
  it("same type: returns a full copy", () => {
    const src = oldSystem();
    const r = carryOverSystem(src, "weapon", "weapon");
    expect(r).toEqual(src);
    expect(r).not.toBe(src);
  });
  it("container to loot keeps the shared fields", () => {
    expect(carryOverSystem({ description: { value: "x" }, quantity: 1 }, "container", "loot"))
      .toEqual({ description: { value: "x" }, quantity: 1 });
  });
  it("rejects an unsupported target type", () => {
    expect(() => carryOverSystem({}, "weapon", "spell")).toThrow(/Unsupported/);
  });
  it("tolerates a missing source", () => {
    expect(carryOverSystem(undefined, "loot", "weapon")).toEqual({});
  });
});
