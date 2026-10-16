// Recorded Claude answers replayed in Foundry: what the module builds from them is accepted by dnd5e in strict mode
// (nothing refused by validateChangeSet), then written, and the item re-reads as built (design: "strict-claude").
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { PREFIX, clientCleanup, evidence } from "./helpers.mjs";
import { claudeOff, claudeOn, fx, serve } from "./claude-helpers.mjs";

test.describe.configure({ timeout: 240_000 });

test.afterEach(async ({ foundry }) => {
  await foundry(claudeOff);
  await foundry(clientCleanup, PREFIX);
});

const CASES = [
  ["ring", "equipment", "ring"], ["compass", "equipment", "wondrous"], ["low-certainty", "equipment", "ring"],
  // Corrected answers: the corrected result must still be buildable
  ["unknown-key-optional", "equipment", "wondrous"], ["formula-actor", "equipment", "wondrous"], ["number-not-cited", "equipment", "wondrous"],
  ["out-of-bounds-duration", "equipment", "wondrous"], ["script-in-name", "equipment", "wondrous"], ["html-and-handlebars", "equipment", "wondrous"],
  ["scope-incompatible", "equipment", "ring"], ["thirteen-activities", "equipment", "wondrous"], ["quote-absent", "equipment", "wondrous"]
];

for (const [id, type, subtype] of CASES) {
  test(`strict: ${id}`, async ({ foundry, gamePage }) => {
    await claudeOn(foundry);
    const fixture = fx(id);
    await serve(gamePage, () => ({ body: fixture.response }));
    const html = fixture.input.paragraphs.map((p) => `<p>${p}</p>`).join("");
    const result = await foundry(async ({ prefix, id, html, type, subtype }) => {
      const item = await Item.implementation.create({ name: `${prefix}strict ${id}`, type: "loot", system: { description: { value: html } } });
      const { proposal, changeSet, applied } = await game.modules.get("item-configurator").api.configure(item, { type, subtype, apply: true });
      const reread = game.items.get(item.id);
      return {
        mode: proposal.mode, status: proposal.ai.status, applied,
        rejected: changeSet.rejected.map((r) => `${r.label?.key ?? ""} ${JSON.stringify(r.label?.data ?? {})}`),
        built: { activities: changeSet.activities.add.length, effects: changeSet.effects.add.length },
        written: { activities: reread.system.activities.size, effects: reread.effects.size, type: reread.type },
        names: reread.system.activities.map((a) => a.name)
      };
    }, { prefix: PREFIX, id, html, type, subtype });
    evidence(`strict-${id}.json`, result);
    expect(result.mode).toBe("claude");
    expect(result.status).toBe("ok");
    expect(result.rejected.filter((r) => /strict|refused by dnd5e/i.test(r))).toEqual([]);
    expect(result.applied).toBe(true);
    expect(result.written.type).toBe(type);
    expect(result.written.activities).toBe(result.built.activities);
    expect(result.written.effects).toBe(result.built.effects);
    for (const name of result.names) expect(name).not.toMatch(/[<>]/);
  });
}
