import { describe, expect, it } from "vitest";
import {
  ACTIVATIONS, DEFAULT_ENUMS, FACT_KINDS, SYSTEM_PROMPT, buildMessages, buildSchema, enumFor, isQuoted, normalizeQuote
} from "../../scripts/ai/prompt.mjs";
import { keys } from "../helpers/keys.mjs";
import { fixture } from "../helpers/fake-ollama.mjs";

describe("buildSchema (C9)", () => {
  const schema = buildSchema(keys());
  const fact = schema.properties.results.items.properties.facts.items;

  it("is the envelope { results: [{ index, facts }] }", () => {
    expect(schema.required).toEqual(["results"]);
    expect(schema.properties.results.items.required).toEqual(["index", "facts"]);
    expect(fact.required).toEqual(["kind", "evidence"]);
  });
  it("limits kinds and keys with enumerations taken from dnd5e", () => {
    expect(fact.properties.kind.enum).toEqual(FACT_KINDS);
    expect(fact.properties.damageType.enum).toContain("necrotic");
    expect(fact.properties.damageType.enum).not.toContain("vorpal");
    expect(fact.properties.ability.enum.sort()).toEqual(["cha", "con", "dex", "int", "str", "wis"]);
    // rarity and attunement are read by the rules only: the model cannot report them
    expect(fact.properties.rarity).toBeUndefined();
    expect(fact.properties.attunement).toBeUndefined();
    expect(fact.properties.kind.enum).not.toContain("detail");
    expect(fact.properties.effectKind.enum).not.toContain("advantage");
    expect(fact.properties.effectKind.enum).not.toContain("disadvantage");
    expect(fact.properties.scope.enum).toEqual(expect.arrayContaining(["fire", "str", "ste", "mwak", "walk", "all"]));
  });
  it("falls back to the defaults without keys", () => {
    const bare = buildSchema().properties.results.items.properties.facts.items;
    expect(bare.properties.damageType.enum).toEqual(DEFAULT_ENUMS.damageTypes);
    expect(enumFor({ abilities: new Set() }, "abilities")).toEqual(DEFAULT_ENUMS.abilities);
  });
  it("activation enumeration matches the exported list", () => {
    expect(fact.properties.activation.enum).toEqual(ACTIVATIONS);
  });
  it("fixtures/ollama/schema.json has the same fact fields as the current schema", async () => {
    const fs = await import("node:fs");
    const url = new URL("../fixtures/ollama/schema.json", import.meta.url);
    const recorded = JSON.parse(fs.readFileSync(url, "utf8")).properties.results.items.properties.facts.items;
    expect(Object.keys(recorded.properties).sort()).toEqual(Object.keys(fact.properties).sort());
  });
  it("recorded fixtures only use field names of the schema", () => {
    for (const name of ["single-damage", "save-condition", "uses-recharge", "french", "batch", "valid"]) {
      const json = JSON.parse(fixture(name).response.message.content);
      for (const entry of json.results) for (const f of entry.facts) {
        for (const key of Object.keys(f)) expect(Object.keys(fact.properties), `${name}.${key}`).toContain(key);
      }
    }
  });
});

describe("buildMessages", () => {
  it("makes a system and a user message with numbered sentences", () => {
    const m = buildMessages([{ sentence: "First   sentence.", context: { name: "Sword", itemType: "weapon" } }, { sentence: "Second." }]);
    expect(m[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    expect(m[1].content).toBe("Item: Sword\nType: weapon\nSentences:\n[0] First sentence.\n[1] Second.");
  });
  it("works without context or requests", () => {
    expect(buildMessages([{ sentence: "A" }])[1].content).toBe("Sentences:\n[0] A");
    expect(buildMessages([])[1].content).toBe("Sentences:\n");
  });
  it("the system prompt asks for quotes, forbids invention and has a French example", () => {
    expect(SYSTEM_PROMPT).toMatch(/evidence/);
    expect(SYSTEM_PROMPT).toMatch(/Never infer/);
    expect(SYSTEM_PROMPT).toMatch(/French/);
  });
});

describe("isQuoted / normalizeQuote", () => {
  it("accepts exact passages despite case, accents, punctuation, spacing", () => {
    expect(isQuoted("EXTRA 2d6", "a hit deals an extra 2d6, necrotic damage")).toBe(true);
    expect(isQuoted("degats de feu", "inflige 1d6 dégâts de feu.")).toBe(true);
    expect(isQuoted("extra  2d6", "an extra\n2d6")).toBe(true);
  });
  it("rejects words not contiguous, partial words and too short quotes", () => {
    expect(isQuoted("extra necrotic", "an extra 2d6 necrotic damage")).toBe(false);
    expect(isQuoted("xtra 2d6", "an extra 2d6")).toBe(false);
    expect(isQuoted("2", "an extra 2d6 and 2")).toBe(false);
    expect(isQuoted("", "anything")).toBe(false);
    expect(isQuoted(undefined, "anything")).toBe(false);
  });
  it("keeps + and - so bonuses stay distinguishable", () => {
    expect(normalizeQuote("+1 Bonus")).toBe("+1 bonus");
    expect(isQuoted("+1 bonus", "You gain a +1 bonus to AC")).toBe(true);
    expect(isQuoted("+2 bonus", "You gain a +1 bonus to AC")).toBe(false);
  });
});
