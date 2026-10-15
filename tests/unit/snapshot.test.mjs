import { describe, expect, it } from "vitest";
import { SNAPSHOT_VERSION, contentFingerprint, makeSnapshot, modifiedSince, restoreOps } from "../../scripts/core/snapshot.mjs";

const effect = (id, over = {}) => ({ _id: id, name: `e-${id}`, changes: [{ key: "system.attributes.ac.bonus", value: "1", mode: 2 }], _stats: { modifiedTime: 1 }, ...over });
const source = () => ({
  _id: "item1", name: "Sword", type: "weapon", system: { rarity: "rare", activities: { a1: { type: "attack" } } },
  effects: [effect("fx1"), effect("fx2")], flags: {}
});

describe("makeSnapshot (C14)", () => {
  it("keeps type, system and effects, with user, time and version", () => {
    const snap = makeSnapshot(source(), "u1", 1000, "1.0.0");
    expect(snap).toMatchObject({ v: SNAPSHOT_VERSION, userId: "u1", at: 1000, version: "1.0.0" });
    expect(Object.keys(snap.source).sort()).toEqual(["effects", "system", "type"]);
    expect(snap.source.type).toBe("weapon");
    expect(snap.source.effects).toHaveLength(2);
  });
  it("is a deep copy", () => {
    const src = source();
    const snap = makeSnapshot(src, "u1");
    src.system.rarity = "common";
    src.effects[0].name = "changed";
    expect(snap.source.system.rarity).toBe("rare");
    expect(snap.source.effects[0].name).toBe("e-fx1");
  });
  it("defaults the time and tolerates missing system / effects", () => {
    const snap = makeSnapshot({ type: "loot" }, "u1");
    expect(snap.at).toBeGreaterThan(0);
    expect(snap.version).toBeNull();
    expect(snap.source).toEqual({ type: "loot", system: {}, effects: [] });
  });
});

describe("modifiedSince", () => {
  describe("with the content fingerprint (snapshot.after)", () => {
    const configured = { ...source(), type: "weapon", system: { rarity: "rare", activities: { a2: { type: "save" } } }, _stats: { modifiedTime: 5000 } };
    const snap = { ...makeSnapshot(source(), "u1", 1000), after: contentFingerprint(configured) };
    it("is false when the content is the one written, whatever the clock says", () => {
      expect(modifiedSince(snap, { ...configured, _stats: { modifiedTime: 99999 } })).toBe(false);
      expect(modifiedSince(snap, { ...configured, _stats: { modifiedTime: 1 } })).toBe(false);
    });
    it("ignores the key order and the effects' stats", () => {
      const reordered = { effects: configured.effects.map((e) => ({ ...e, _stats: { modifiedTime: 77 } })), system: configured.system, type: "weapon" };
      expect(modifiedSince(snap, reordered)).toBe(false);
    });
    it("is true when the system, the type or an effect changed", () => {
      expect(modifiedSince(snap, { ...configured, system: { ...configured.system, rarity: "legendary" } })).toBe(true);
      expect(modifiedSince(snap, { ...configured, type: "loot" })).toBe(true);
      expect(modifiedSince(snap, { ...configured, effects: [effect("fx1", { name: "renamed" })] })).toBe(true);
    });
    it("takes precedence over the timestamps", () => {
      expect(modifiedSince(snap, { ...configured, _stats: { modifiedTime: 2000 } })).toBe(false);
    });
  });
  describe("without it (older snapshots): fallback on the modification time", () => {
    const snap = makeSnapshot(source(), "u1", 1000);
    it("is true when the item was modified after the snapshot", () => {
      expect(modifiedSince(snap, { _stats: { modifiedTime: 1001 } })).toBe(true);
    });
    it("is false at the same time, before, or without stats", () => {
      expect(modifiedSince(snap, { _stats: { modifiedTime: 1000 } })).toBe(false);
      expect(modifiedSince(snap, { _stats: { modifiedTime: 5 } })).toBe(false);
      expect(modifiedSince(snap, {})).toBe(false);
      expect(modifiedSince(snap, undefined)).toBe(false);
    });
  });
});

describe("restoreOps (C14)", () => {
  it("restores type and system from the snapshot", () => {
    const snap = makeSnapshot(source(), "u1");
    const now = { ...source(), type: "consumable", system: { other: true } };
    const ops = restoreOps(snap, now);
    expect(ops.update).toEqual({ type: "weapon", system: source().system });
  });
  it("an unchanged effect set needs no deletion or creation", () => {
    const snap = makeSnapshot(source(), "u1");
    const ops = restoreOps(snap, source());
    expect(ops.deleteEffectIds).toEqual([]);
    expect(ops.createEffects).toEqual([]);
  });
  it("deletes effects added by the configuration", () => {
    const snap = makeSnapshot(source(), "u1");
    const now = source();
    now.effects.push(effect("new1"));
    expect(restoreOps(snap, now).deleteEffectIds).toEqual(["new1"]);
    expect(restoreOps(snap, now).createEffects).toEqual([]);
  });
  it("recreates effects that were removed", () => {
    const snap = makeSnapshot(source(), "u1");
    const now = source();
    now.effects = [now.effects[0]];
    const ops = restoreOps(snap, now);
    expect(ops.createEffects.map((e) => e._id)).toEqual(["fx2"]);
    expect(ops.deleteEffectIds).toEqual([]);
  });
  it("replaces an effect with the same id but other content", () => {
    const snap = makeSnapshot(source(), "u1");
    const now = source();
    now.effects[1] = effect("fx2", { name: "edited" });
    const ops = restoreOps(snap, now);
    expect(ops.deleteEffectIds).toEqual(["fx2"]);
    expect(ops.createEffects.map((e) => e.name)).toEqual(["e-fx2"]);
  });
  it("ignores _stats and key order when comparing effects", () => {
    const snap = makeSnapshot(source(), "u1");
    const now = source();
    now.effects[0] = { name: "e-fx1", _id: "fx1", changes: [{ mode: 2, value: "1", key: "system.attributes.ac.bonus" }], _stats: { modifiedTime: 99 } };
    const ops = restoreOps(snap, now);
    expect(ops.deleteEffectIds).toEqual([]);
    expect(ops.createEffects).toEqual([]);
  });
  it("returns copies that do not alias the snapshot", () => {
    const snap = makeSnapshot(source(), "u1");
    const ops = restoreOps(snap, { type: "weapon", system: {}, effects: [] });
    ops.update.system.rarity = "x";
    ops.createEffects[0].name = "x";
    expect(snap.source.system.rarity).toBe("rare");
    expect(snap.source.effects[0].name).toBe("e-fx1");
  });
  it("tolerates a current source without effects", () => {
    const snap = makeSnapshot(source(), "u1");
    expect(restoreOps(snap, undefined).createEffects).toHaveLength(2);
  });
});
