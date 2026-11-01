// I5, I6: the update payloads of Foundry v13 (`"==system"` and `"-=key"`), which replace `_replace(...)` / `_del` (v14 only).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activityDeletionUpdate, restoreUpdate, typeChangeUpdate } from "../../scripts/core/update-ops.mjs";
import { makeSnapshot, restoreOps } from "../../scripts/core/snapshot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith(".mjs") ? [path.join(dir, e.name)] : [])));

const source = () => ({
  _id: "item1", name: "Rod", type: "loot",
  system: { rarity: "rare", activities: { a1: { type: "attack" } }, description: { value: "<p>x</p>" } },
  effects: [{ _id: "fx1", name: "e", transfer: true, changes: [{ key: "system.attributes.ac.bonus", mode: 2, value: "+1", priority: null }] }]
});

describe("I5: changing the type replaces the system with '==system'", () => {
  it("typeChangeUpdate('equipment', {a: 1}) -> { type, '==system' }", () => {
    expect(typeChangeUpdate("equipment", { a: 1 })).toEqual({ type: "equipment", "==system": { a: 1 } });
  });
  it("carries the data as given, and has no other key", () => {
    const system = { description: { value: "<p>d</p>" }, quantity: 3 };
    const update = typeChangeUpdate("weapon", system);
    expect(Object.keys(update).sort()).toEqual(["==system", "type"]);
    expect(update["==system"]).toEqual(system);
    expect(update).not.toHaveProperty("system");
  });
  it("restoreUpdate of an undo snapshot: type, '==system' = the saved system, and the undo flag removed with '-='", () => {
    const snapshot = makeSnapshot(source(), "u1");
    const current = { ...source(), type: "weapon", system: { activities: {} }, effects: [] };
    const ops = restoreOps(snapshot, current);
    const update = restoreUpdate(ops);
    expect(update).toEqual({
      type: "loot",
      "==system": source().system,
      "flags.item-configurator.-=undo": null
    });
    expect(update).not.toHaveProperty("system");
    expect(update).not.toHaveProperty("flags.item-configurator.undo");
  });
  it("restoreUpdate takes the module id for the flag scope", () => {
    const update = restoreUpdate({ update: { type: "loot", system: {} } }, "other-module");
    expect(update["flags.other-module.-=undo"]).toBeNull();
  });
});

describe("I6: deletions use '-=' with null", () => {
  it("activityDeletionUpdate('abc') -> { 'system.activities.-=abc': null }", () => {
    expect(activityDeletionUpdate("abc")).toEqual({ "system.activities.-=abc": null });
  });
  it("the value is null, not undefined (a '-=' key needs null)", () => {
    const update = activityDeletionUpdate("x1");
    expect(Object.keys(update)).toHaveLength(1);
    expect(Object.values(update)[0]).toBeNull();
  });
});

describe("I5-I7: v14 operators are gone from the module", () => {
  const scripts = walk(path.join(root, "scripts"));
  it("no file of scripts/ calls _replace( or uses _del", () => {
    const offenders = scripts.filter((f) => /(?<![\w.])_replace\s*\(|(?<![\w.])_del\b/.test(fs.readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
  it("a use of _replace would throw (the unit globals do not define it)", () => {
    expect(typeof globalThis._replace).toBe("undefined");
    expect(typeof globalThis._del).toBe("undefined");
  });
  it("apply.mjs and undo.mjs build their updates with update-ops.mjs", () => {
    const apply = fs.readFileSync(path.join(root, "scripts/foundry/apply.mjs"), "utf8");
    const undo = fs.readFileSync(path.join(root, "scripts/foundry/undo.mjs"), "utf8");
    expect(apply).toContain("typeChangeUpdate");
    expect(apply).toContain("activityDeletionUpdate");
    expect(undo).toContain("restoreUpdate");
  });
  it("I7: eslint.config.mjs no longer declares the globals _replace and _del", () => {
    const config = fs.readFileSync(path.join(root, "eslint.config.mjs"), "utf8");
    expect(config).not.toMatch(/\b_replace\b/);
    expect(config).not.toMatch(/\b_del\b/);
  });
});
