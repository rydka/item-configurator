// Port to Foundry v13 / dnd5e 5.3.3: one block per gap of the design (I1 to I9), named by gap.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzeClaudeFirst } from "../../scripts/core/analyze-claude.mjs";
import { applySelection, buildChangeSet, effectSignature } from "../../scripts/core/changes.mjs";
import { carryOverSystem } from "../../scripts/core/convert.mjs";
import { render } from "../../scripts/core/crosscheck.mjs";
import { DETAIL_FIELDS, schemaEnums } from "../../scripts/ai/claude-schema.mjs";
import { buildFromClaude } from "../../scripts/ai/claude-build.mjs";
import { ENUMS, K } from "../helpers/claude.mjs";
import { blank, idGenerator, p, parser, resolveSpell, run } from "../helpers/analysis.mjs";
import { referenceFile } from "../helpers/keys.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = () => JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
const okResult = (json) => ({ ok: true, status: "ok", json, model: "claude-sonnet-5-5", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, retried: false });

/** Claude answers with one effect (`changes`, `duration`) on a one-paragraph consumable. */
async function withEffect(text, changes, duration, transfer = false) {
  const json = {
    details: [], activities: [], notAutomated: [], flavor: [],
    effects: [{ ref: "e1", name: "Boost", quotes: [text], certainty: "high", inferred: false, transfer, changes, duration }]
  };
  const source = blank("consumable");
  const proposal = await analyzeClaudeFirst(
    { name: "Potion", html: p("Wondrous item, rare", text), type: "consumable", value: "potion", subtype: "", source },
    { parser, keys: K, enums: ENUMS, complete: async () => okResult(json), idGen: idGenerator(), resolveSpell, metric: false }
  );
  return { proposal, cs: buildChangeSet(source, proposal, { parser }) };
}

describe("I1: rarity is a string", () => {
  it("DETAIL_FIELDS.rarity writes the path 'rarity'", () => {
    expect(DETAIL_FIELDS.rarity.path).toBe("rarity");
  });
  it("the rules write system.rarity = 'rare' (string), never system.rarities", async () => {
    const { changeSet: cs } = await run({ html: p("Wondrous item, rare", "You gain a +1 bonus to AC."), type: "equipment", value: "ring" });
    expect(cs.systemPatch["system.rarity"]).toBe("rare");
    expect(cs.systemPatch).not.toHaveProperty("system.rarities");
  });
  it("Claude's rarity detail builds system.rarity as a string", () => {
    const item = {
      details: [{ field: "rarity", key: "rare", quotes: ["Wondrous item, rare"], certainty: "high", inferred: false }],
      activities: [], effects: [], notAutomated: [], flavor: []
    };
    const built = buildFromClaude(item, { parser, keys: K, idGen: idGenerator(), type: "equipment", name: "X", resolveSpell });
    const json = JSON.stringify(built.systemPatch ?? built);
    expect(json).toContain("rare");
    expect(json).not.toContain("rarities");
  });
  it("the rarity fact of the cross-check targets system.rarity with a plain key", async () => {
    const text = "You can use your reaction to gain 1d6 + your proficiency bonus temporary hit points.";
    const json = {
      details: [{ field: "rarity", key: "rare", quotes: ["Wondrous item, rare"], certainty: "high", inferred: false }],
      activities: [{ ref: "a1", type: "heal", name: "Gain", quotes: ["use your reaction", "1d6 + your proficiency bonus temporary hit points"], certainty: "high", inferred: [],
        activation: { type: "reaction", value: 0, condition: "" }, healing: { number: 1, denomination: 6, bonus: "@prof", types: ["temphp"] }, effects: [] }],
      effects: [], notAutomated: [], flavor: []
    };
    const source = blank("equipment");
    const proposal = await analyzeClaudeFirst(
      { name: "Ring", html: p("Wondrous item, rare", text), type: "equipment", value: "ring", subtype: "", source },
      { parser, keys: K, enums: ENUMS, complete: async () => okResult(json), idGen: idGenerator(), resolveSpell, metric: false }
    );
    const rarity = proposal.crosscheck.agree.find((a) => a.family === "rarity");
    expect(rarity).toBeTruthy();
    expect(rarity.claude.path).toBe("system.rarity");
    expect(rarity.claude.patch).toEqual([{ field: "system.rarity", form: "key", data: "rare" }]);
    expect(render("rarity", "rare", "key")).toBe("rare");
  });
  it("carryOverSystem keeps rarity when the type changes", () => {
    const system = { description: { value: "<p>x</p>" }, rarity: "rare", quantity: 1, weight: { value: 1, units: "lb" }, price: { value: 1, denomination: "gp" }, activities: {} };
    expect(carryOverSystem(system, "weapon", "equipment")).toMatchObject({ rarity: "rare" });
    expect(carryOverSystem(system, "weapon", "equipment")).not.toHaveProperty("rarities");
  });
});

describe("I2: an existing v13 effect is recognized (effectSignature reads changes and mode)", () => {
  const CLOAK = p("Wondrous item, uncommon (requires attunement)", "You gain a +1 bonus to AC and saving throws while you wear this cloak.");
  const cloakEffect = (mode = 2) => ({
    _id: "existing0000001", name: "Cloak", transfer: true, disabled: false,
    changes: [
      { key: "system.attributes.ac.bonus", mode, value: "+1", priority: null },
      { key: "system.bonuses.abilities.save", mode, value: "+1", priority: null }
    ],
    duration: { seconds: null, rounds: null, turns: null }
  });
  it("the signature contains key|mode|value of each change, and differs when the mode differs", () => {
    const signature = effectSignature(cloakEffect());
    expect(signature).toContain("system.attributes.ac.bonus|2|+1");
    expect(signature).toContain("system.bonuses.abilities.save|2|+1");
    expect(effectSignature(cloakEffect(4))).not.toBe(signature);
  });
  it("two effects with different changes do not share a signature (not all empty)", () => {
    const other = { ...cloakEffect(), changes: [{ key: "system.traits.dr.value", mode: 2, value: "cold", priority: null }] };
    expect(effectSignature(other)).not.toBe(effectSignature(cloakEffect()));
  });
  it("an existing effect with the same changes as the proposal is kept, not added again", async () => {
    const source = { type: "equipment", system: {}, effects: [cloakEffect()] };
    const { changeSet: cs } = await run({ html: CLOAK, type: "equipment", value: "clothing" }, { source });
    expect(cs.effects.add).toEqual([]);
    const entries = cs.entries.filter((e) => e.group === "effects");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.action === "keep")).toBe(true);
  });
  it("an existing effect with other changes does not hide the proposal", async () => {
    const other = { ...cloakEffect(), changes: [{ key: "system.traits.dr.value", mode: 2, value: "cold", priority: null }] };
    const { changeSet: cs } = await run({ html: CLOAK, type: "equipment", value: "clothing" }, { source: { type: "equipment", system: {}, effects: [other] } });
    expect(cs.effects.add).toHaveLength(1);
  });
  it("the proposed effect itself has changes at the top level and no system", async () => {
    const { changeSet: cs } = await run({ html: CLOAK, type: "equipment", value: "clothing" });
    const [effect] = cs.effects.add;
    expect(effect).not.toHaveProperty("system");
    expect(effect.changes.map((c) => c.key)).toEqual(expect.arrayContaining(["system.attributes.ac.bonus", "system.bonuses.abilities.save"]));
    expect(effect.changes.every((c) => typeof c.mode === "number" && typeof c.value === "string")).toBe(true);
  });
});

describe("I3: the bonus conflict targets changes.<j>.value of the effect source", () => {
  const TEXT = "gain a +2 bonus to AC and a +3 bonus to Wisdom saving throws for 10 minutes";
  const bonusConflict = async () => {
    const { proposal, cs } = await withEffect(TEXT, [{ kind: "ac", scope: "", on: "", value: "+3" }], { value: 10, units: "minute", until: "" });
    return { proposal, cs, conflict: proposal.crosscheck.conflict.find((c) => c.family === "effectBonus") };
  };
  it("both readings patch the field changes.0.value, never system.changes", async () => {
    const { conflict } = await bonusConflict();
    expect(conflict).toBeTruthy();
    expect(conflict.patch.claude[0]).toMatchObject({ field: "changes.0.value", data: "+3" });
    expect(conflict.patch.rules[0].field).toBe("changes.0.value");
    expect(JSON.stringify(conflict)).not.toContain("system.changes");
  });
  it("choosing the rules writes their value in changes.0.value of the effect source", async () => {
    const { cs, conflict } = await bonusConflict();
    const item = cs.check.find((c) => c.family === "effectBonus" || c.patch?.rules?.[0]?.field === "changes.0.value");
    expect(item).toBeTruthy();
    const chosen = applySelection(cs, { choices: { [item.id]: "rules" } });
    const ac = chosen.effects.add[0].changes.find((c) => c.key === "system.attributes.ac.bonus");
    expect(ac.value).toBe(conflict.patch.rules[0].data);
    expect(ac.value).not.toBe("+3");
    expect(chosen.effects.add[0]).not.toHaveProperty("system");
    expect(cs.effects.add[0].changes[0].value).toBe("+3"); // the original change set is untouched
  });
});

describe("I4: the duration of an effect is { seconds | rounds | turns }", () => {
  it("Claude's 'until the end of the next turn' becomes { turns: 1 } on the source", async () => {
    const { cs } = await withEffect("Until the end of your next turn, your speed is halved.", [{ kind: "speedMultiplier", scope: "", on: "", value: "0.5" }], { value: 0, units: "", until: "sourceEnd" });
    expect(cs.effects.add).toHaveLength(1);
    expect(cs.effects.add[0].duration).toEqual({ turns: 1 });
    expect(cs.effects.add[0].duration).not.toHaveProperty("expiry");
  });
  it("Claude's '1 hour' becomes { seconds: 3600 }", async () => {
    const { cs } = await withEffect("You gain a +2 bonus to AC for 1 hour.", [{ kind: "ac", scope: "", on: "", value: "+2" }], { value: 1, units: "hour", until: "" });
    expect(cs.effects.add[0].duration).toEqual({ seconds: 3600 });
  });
  it("the duration of a rules effect is { seconds } too (no value / units)", async () => {
    const { changeSet: cs } = await run({ html: p("When you drink this potion, you gain a +2 bonus to AC for 10 minutes."), type: "consumable", value: "potion" });
    expect(cs.effects.add[0].duration).toEqual({ seconds: 600 });
  });
  it("an effect duration conflict has one patch on the field 'duration', with the v13 object", async () => {
    const text = "gain a +2 bonus to AC for 10 minutes";
    const { proposal } = await withEffect(text, [{ kind: "ac", scope: "", on: "", value: "+2" }], { value: 10, units: "hour", until: "" });
    const conflict = proposal.crosscheck.conflict.find((c) => c.family === "duration");
    expect(conflict).toBeTruthy();
    expect(conflict.patch.rules).toEqual([{ field: "duration", data: { seconds: 600 } }]);
    expect(conflict.patch.claude).toEqual([{ field: "duration", data: { seconds: 36000 } }]);
  });
  it("choosing the rules for a duration conflict writes their duration into the effect source", async () => {
    const text = "gain a +2 bonus to AC for 10 minutes";
    const { cs } = await withEffect(text, [{ kind: "ac", scope: "", on: "", value: "+2" }], { value: 10, units: "hour", until: "" });
    expect(cs.effects.add[0].duration).toEqual({ seconds: 36000 });
    const item = cs.check.find((c) => c.patch?.rules?.[0]?.field === "duration");
    expect(item).toBeTruthy();
    const chosen = applySelection(cs, { choices: { [item.id]: "rules" } });
    expect(chosen.effects.add[0].duration).toEqual({ seconds: 600 });
  });
  it("render(..., 'effectDuration') gives turns, rounds or seconds from the canon", () => {
    expect(render("duration", { value: 3, units: "round", seconds: 18 }, "effectDuration")).toEqual({ rounds: 3 });
    expect(render("duration", { value: 2, units: "turn", seconds: 12 }, "effectDuration")).toEqual({ turns: 2 });
    expect(render("duration", { value: 10, units: "minute", seconds: 600 }, "effectDuration")).toEqual({ seconds: 600 });
    expect(render("duration", { value: 1, units: "hour", seconds: 3600 }, "effectDuration")).toEqual({ seconds: 3600 });
  });
  it("the duration of an ACTIVITY is unchanged: value and units", () => {
    expect(render("duration", { value: 10, units: "minute", seconds: 600 }, "activityUnits")).toBe("minute");
    expect(render("duration", { value: 10, units: "minute", seconds: 600 }, "durationValue")).toBe(10);
  });
});

describe("I9: Foundry 13 has no CONST.ACTIVE_EFFECT_DURATION_UNITS", () => {
  it("without the constant, effectDurationUnits is empty and the schema is the same", async () => {
    const { buildItemSchema } = await import("../../scripts/ai/claude-schema.mjs");
    const snapshot = referenceFile("schema-enums.json");
    expect(snapshot.const.ACTIVE_EFFECT_DURATION_UNITS).toBeUndefined();
    const without = schemaEnums(snapshot.dnd5e, {});
    expect(without.effectDurationUnits).toEqual([]);
    const withConstant = schemaEnums(snapshot.dnd5e, { ACTIVE_EFFECT_DURATION_UNITS: { seconds: "seconds", rounds: "rounds", turns: "turns" } });
    expect(JSON.stringify(buildItemSchema(without))).toBe(JSON.stringify(buildItemSchema(withConstant)));
  });
  it("the reference snapshot is the 5.3.3 one (no ring area, no teleport activity)", () => {
    const snapshot = referenceFile("schema-enums.json");
    expect(snapshot.versions).toEqual({ foundry: "13", dnd5e: "5.3.3" });
    expect(Object.keys(snapshot.dnd5e.areaTargetTypes)).not.toContain("ring");
    expect(Object.values(snapshot.dnd5e.activityTypes)).not.toContain("teleport");
  });
});

describe("I8: module.json and the release workflow (C5, C6)", () => {
  it("version 0.1.0-v13, Foundry 13, dnd5e 5.3.0 to 5.99", () => {
    const m = manifest();
    expect(m.id).toBe("item-configurator");
    expect(m.version).toBe("0.1.0-v13");
    expect(m.compatibility).toEqual({ minimum: "13", verified: "13" });
    expect(m.relationships.systems).toEqual([{
      id: "dnd5e", type: "system", compatibility: { minimum: "5.3.0", verified: "5.3.3", maximum: "5.99" }
    }]);
  });
  it("requires the library 1.1.0-v13 from the raw manifest of its v13 branch", () => {
    const [library] = manifest().relationships.requires;
    expect(library).toMatchObject({ id: "dnd5e-text-parser", type: "module" });
    expect(library.compatibility).toEqual({ minimum: "1.1.0-v13", verified: "1.1.0-v13" });
    expect(library.manifest).toBe("https://raw.githubusercontent.com/rydka/dnd5e-text-parser/v13/module.json");
  });
  it("manifest is the raw file of the v13 branch, download is the v0.1.0-v13 release", () => {
    const m = manifest();
    expect(m.manifest).toBe("https://raw.githubusercontent.com/rydka/item-configurator/v13/module.json");
    expect(m.download).toBe("https://github.com/rydka/item-configurator/releases/download/v0.1.0-v13/module.zip");
  });
  it("the workflow clones the v13 library and publishes the branch manifest, not releases/latest", () => {
    const yml = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8");
    expect(yml).toContain("--branch v1.1.0-v13");
    expect(yml).toContain("raw.githubusercontent.com/rydka/item-configurator/v13/module.json");
    expect(yml).not.toContain("releases/latest/download/module.json");
  });
  it("the library linked for the tests is on its v13 format (toEffectDuration, CHANGE_MODES)", () => {
    expect(typeof parser.toEffectDuration).toBe("function");
    expect(parser.CHANGE_MODES).toEqual({ custom: 0, multiply: 1, add: 2, downgrade: 3, upgrade: 4, override: 5 });
  });
});

describe("globals of the v13 unit environment", () => {
  it("Foundry 13.350 and dnd5e 5.3.3, no _replace / _del", () => {
    expect(game.version).toBe("13.350");
    expect(game.system.version).toBe("5.3.3");
    expect(game.release.generation).toBe(13);
    expect(CONST.ACTIVE_EFFECT_MODES.UPGRADE).toBe(4);
    expect(CONST.ACTIVE_EFFECT_DURATION_UNITS).toBeUndefined();
  });
});
