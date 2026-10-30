// C18: api.configure returns the same proposal as the preview, applies it with apply: true, refuses unauthorized players.
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { PLAYER_NAME, PREFIX, TEXTS, clientCleanup, clientEnsurePlayer, evidence, joinAsPlayer } from "./helpers.mjs";

test.describe.configure({ timeout: 240_000 });

test.afterEach(async ({ foundry }) => {
  await foundry(clientCleanup, PREFIX);
});

const create = (foundry, data) => foundry(async ({ prefix, data }) => {
  const item = await Item.implementation.create({ ...data, name: `${prefix}${data.name}` });
  return item.uuid;
}, { prefix: PREFIX, data });

const stateOf = (foundry, uuid) => foundry(async (id) => {
  const item = await fromUuid(id);
  const data = item.toObject();
  delete data._stats;
  for (const effect of data.effects ?? []) delete effect._stats;
  return JSON.parse(JSON.stringify(data));
}, uuid);

const SCENARIOS = [
  { id: "flame-tongue", name: "Flame Tongue Longsword", type: "weapon", subtype: "martialM", text: TEXTS.flameTongue },
  { id: "potion", name: "Potion of Healing", type: "consumable", subtype: "potion", text: TEXTS.healing },
  { id: "cloak", name: "Cloak of Protection", type: "equipment", subtype: "clothing", text: TEXTS.cloak }
];

for (const s of SCENARIOS) {
  test(`C18: api.configure on ${s.name} gives the preview's proposal, writes nothing without apply, writes with apply`, async ({ foundry, gamePage }) => {
    const uuid = await create(foundry, { name: s.name, type: "loot", system: { description: { value: s.text } } });
    const before = await stateOf(foundry, uuid);

    // The API, without apply.
    const api = await foundry(async ({ uuid, s }) => {
      const item = await fromUuid(uuid);
      const { changeSet, applied } = await game.modules.get("item-configurator").api.configure(item, { type: s.type, subtype: s.subtype, useAI: false });
      const groups = {};
      for (const entry of changeSet.entries ?? []) (groups[entry.group] ??= []).push({ action: entry.action, raw: entry.raw ?? "" });
      return { applied, empty: changeSet.empty, groups, typeChange: changeSet.typeChange?.to ?? null };
    }, { uuid, s });
    expect(api.applied).toBe(false);
    expect(await stateOf(foundry, uuid)).toEqual(before);

    // The preview of the same item with the same choices.
    await foundry(async (id) => (await fromUuid(id)).sheet.render({ force: true }), uuid);
    await gamePage.locator(".item-configurator-configure").first().click();
    const dialog = gamePage.locator(".item-configurator.type-dialog");
    await dialog.locator('select[name="type"]').selectOption(s.type);
    await dialog.locator('select[name="subtype"]').selectOption({ value: `${s.subtype}|` });
    await dialog.locator(".item-configurator-analyze").click();
    const preview = gamePage.locator(".item-configurator.preview");
    await expect(preview).toBeVisible({ timeout: 30_000 });
    const shown = await preview.locator(".group").evaluateAll((sections) => Object.fromEntries(sections
      .filter((section) => /group-(details|activities|effects)/.test(section.className))
      .map((section) => [section.className.match(/group-(details|activities|effects)/)[1], [...section.querySelectorAll("li.entry")].map((li) => ({
        action: li.className.match(/action-(\w+)/)?.[1] ?? "",
        raw: li.querySelector("blockquote.source")?.textContent.trim() ?? ""
      }))])));
    evidence(`C18-${s.id}-api-vs-preview.json`, { api, shown });
    await gamePage.screenshot({ path: test.info().outputPath(`C18-${s.id}-preview.png`) });
    const key = (e) => `${e.action}|${e.raw}`;
    for (const group of new Set([...Object.keys(api.groups), ...Object.keys(shown)])) {
      expect((shown[group] ?? []).map(key).sort(), `group ${group}`).toEqual((api.groups[group] ?? []).map(key).sort());
    }
    await preview.locator('button[data-action="cancel"]').click();

    // The API with apply: true writes.
    const applied = await foundry(async ({ uuid, s }) => {
      const item = await fromUuid(uuid);
      const result = await game.modules.get("item-configurator").api.configure(item, { type: s.type, subtype: s.subtype, useAI: false, apply: true });
      return { applied: result.applied, type: item.type, activities: Object.keys(item._source.system.activities ?? {}).length, effects: item.effects.size };
    }, { uuid, s });
    evidence(`C18-${s.id}-apply.json`, applied);
    expect(applied.applied).toBe(true);
    expect(applied.type).toBe(s.type);
    expect(applied.activities + applied.effects).toBeGreaterThan(0);
    expect(await stateOf(foundry, uuid)).not.toEqual(before);
  });
}

test("C18: a player who does not own the item, or when players are not allowed, is refused and nothing is written", async ({ foundry, browser, baseURL }) => {
  await foundry(clientEnsurePlayer, PLAYER_NAME);
  const ids = await foundry(async ({ prefix, text, playerName }) => {
    const user = game.users.getName(playerName);
    const notMine = await Item.implementation.create({ name: `${prefix}Not mine`, type: "loot", system: { description: { value: text } }, ownership: { default: 2 } });
    const mine = await Item.implementation.create({ name: `${prefix}Mine`, type: "loot", system: { description: { value: text } }, ownership: { default: 0, [user.id]: 3 } });
    return { notMine: notMine.uuid, mine: mine.uuid, expected: game.i18n.localize("item-configurator.errors.notAllowed") };
  }, { prefix: PREFIX, text: TEXTS.cloak, playerName: PLAYER_NAME });
  const before = { notMine: await stateOf(foundry, ids.notMine), mine: await stateOf(foundry, ids.mine) };

  const { context, page } = await joinAsPlayer(browser, baseURL);
  try {
    const attempt = (uuid) => page.evaluate(async (id) => {
      const item = await fromUuid(id);
      try {
        await game.modules.get("item-configurator").api.configure(item, { type: "equipment", useAI: false, apply: true });
        return { refused: false };
      } catch (err) {
        return { refused: true, message: err.message };
      }
    }, uuid);
    const notOwner = await attempt(ids.notMine);
    await foundry(async () => game.settings.set("item-configurator", "allowPlayers", false));
    await page.waitForFunction(() => game.settings.get("item-configurator", "allowPlayers") === false);
    const notAllowed = await attempt(ids.mine);
    evidence("C18-player-refused.json", { notOwner, notAllowed, expected: ids.expected });
    expect(notOwner.refused).toBe(true);
    expect(notOwner.message).toBe(ids.expected);
    expect(notAllowed.refused).toBe(true);
    expect(notAllowed.message).toBe(ids.expected);
  } finally {
    await context.close();
  }
  expect({ notMine: await stateOf(foundry, ids.notMine), mine: await stateOf(foundry, ids.mine) }).toEqual(before);
});

test("C18: an owner player can use the API when players are allowed", async ({ foundry, browser, baseURL }) => {
  await foundry(clientEnsurePlayer, PLAYER_NAME);
  const uuid = await foundry(async ({ prefix, text, playerName }) => {
    const user = game.users.getName(playerName);
    const item = await Item.implementation.create({ name: `${prefix}Allowed`, type: "loot", system: { description: { value: text } }, ownership: { default: 0, [user.id]: 3 } });
    return item.uuid;
  }, { prefix: PREFIX, text: TEXTS.cloak, playerName: PLAYER_NAME });
  const { context, page } = await joinAsPlayer(browser, baseURL);
  try {
    const result = await page.evaluate(async (id) => {
      const item = await fromUuid(id);
      const { applied, changeSet } = await game.modules.get("item-configurator").api.configure(item, { type: "equipment", useAI: false, apply: true });
      return { applied, empty: changeSet.empty, type: item.type };
    }, uuid);
    evidence("C18-player-allowed.json", result);
    expect(result).toEqual({ applied: true, empty: false, type: "equipment" });
  } finally {
    await context.close();
  }
});
