// C12 (preview groups, source sentences, nothing written before Apply, Cancel changes nothing),
// C14 (undo restores the item exactly; the button only exists for the user who configured).
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

const snapshotOf = (foundry, uuid) => foundry(async (id) => {
  const item = await fromUuid(id);
  const data = item.toObject();
  delete data._stats;
  for (const effect of data.effects ?? []) delete effect._stats;
  if (data.flags?.["item-configurator"] && !Object.keys(data.flags["item-configurator"]).length) delete data.flags["item-configurator"];
  return JSON.parse(JSON.stringify(data));
}, uuid);

/** Sheet -> Configure -> Analyze with the preselected type; returns the preview locator. */
async function previewFromSheet(foundry, gamePage, uuid, { type, subtype } = {}) {
  await foundry(async (id) => (await fromUuid(id)).sheet.render({ force: true }), uuid);
  await gamePage.locator(".item-configurator-configure").first().click();
  const dialog = gamePage.locator(".item-configurator.type-dialog");
  await expect(dialog).toBeVisible();
  if (type) await dialog.locator('select[name="type"]').selectOption(type);
  if (subtype) await dialog.locator('select[name="subtype"]').selectOption({ value: subtype });
  await dialog.locator(".item-configurator-analyze").click();
  const preview = gamePage.locator(".item-configurator.preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  return preview;
}

const norm = (s) => String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

const SCENARIOS = [
  { id: "flame-tongue", name: "Flame Tongue Longsword", type: "weapon", text: TEXTS.flameTongue, groups: ["details", "activities"] },
  { id: "cloak", name: "Cloak of Protection", type: "equipment", text: TEXTS.cloak, groups: ["details", "effects"] }
];

for (const s of SCENARIOS) {
  test(`C12: the preview of ${s.name} shows grouped entries with their source sentence; Cancel changes nothing`, async ({ foundry, gamePage }) => {
    const uuid = await create(foundry, { name: s.name, type: "loot", system: { description: { value: s.text } } });
    const before = await snapshotOf(foundry, uuid);
    const preview = await previewFromSheet(foundry, gamePage, uuid, { type: s.type });

    const titles = await preview.locator(".group h3").allTextContents();
    const groups = await preview.locator(".group").evaluateAll((sections) => sections.map((section) => ({
      cls: section.className,
      title: section.querySelector("h3")?.textContent.trim(),
      entries: [...section.querySelectorAll("li.entry")].map((li) => ({
        label: li.querySelector(".label")?.textContent.trim() ?? "",
        source: li.querySelector("blockquote.source")?.textContent.trim() ?? "",
        base: Boolean(li.querySelector(".base-mark"))
      }))
    })));
    evidence(`C12-${s.id}-groups.json`, { titles, groups });
    await gamePage.screenshot({ path: test.info().outputPath(`C12-${s.id}-preview.png`) });

    for (const group of s.groups) {
      const found = groups.find((g) => g.cls.includes(`group-${group}`));
      expect(found, `group ${group}`).toBeTruthy();
      expect(found.entries.length, `entries in ${group}`).toBeGreaterThan(0);
    }
    // Every entry that was read from the text carries the sentence that justifies it, and the sentence is in the description.
    const description = norm(s.text);
    const withoutSource = [];
    for (const group of groups.filter((g) => /group-(details|activities|effects)/.test(g.cls))) {
      for (const entry of group.entries) {
        if (entry.base) continue;
        if (!entry.source) withoutSource.push(`${group.title}: ${entry.label}`);
        else expect(description, `source of ${entry.label}`).toContain(norm(entry.source).replace(/\s*\.\.\.$/, ""));
      }
    }
    evidence(`C12-${s.id}-without-source.json`, withoutSource);
    expect(withoutSource, "entries without a source sentence").toEqual([]);

    // Nothing is written while the preview is open, nor after Cancel.
    expect(await snapshotOf(foundry, uuid)).toEqual(before);
    await preview.locator('button[data-action="cancel"]').click();
    await expect(preview).toBeHidden();
    expect(await snapshotOf(foundry, uuid)).toEqual(before);
    const flag = await foundry(async (id) => (await fromUuid(id)).getFlag("item-configurator", "undo") ?? null, uuid);
    expect(flag).toBeNull();
  });
}

test("C12: Apply writes what the preview showed", async ({ foundry, gamePage }) => {
  const uuid = await create(foundry, { name: "Cloak of Protection", type: "loot", system: { description: { value: TEXTS.cloak } } });
  const preview = await previewFromSheet(foundry, gamePage, uuid, { type: "equipment" });
  const shownEffects = await preview.locator(".group-effects li.entry").count();
  await preview.locator(".item-configurator-apply").click();
  await expect(preview).toBeHidden();
  const after = await foundry(async (id) => {
    const item = await fromUuid(id);
    return { type: item.type, effects: item.effects.size, attunement: item.system.attunement, rarities: [...(item.system.rarities ?? [])] };
  }, uuid);
  evidence("C12-apply.json", { shownEffects, after });
  expect(after.type).toBe("equipment");
  expect(after.effects).toBeGreaterThan(0);
});

// ---- C14 -----------------------------------------------------------------------------------------------------------

test("C14: the undo button restores an item exactly (type, activities, effects and their ids)", async ({ foundry, gamePage }) => {
  // A loot item that already has an effect with a fixed id, converted to a weapon with "Replace existing".
  const uuid = await foundry(async ({ prefix, text }) => {
    const item = await Item.implementation.create({
      name: `${prefix}Undo Sword`, type: "loot", img: "icons/svg/sword.svg", system: { description: { value: text }, quantity: 3 },
      effects: [{ _id: "ictEffect0000001", name: "Existing effect", img: "icons/svg/aura.svg", disabled: false }]
    }, { keepEmbeddedIds: true });
    return item.uuid;
  }, { prefix: PREFIX, text: TEXTS.flameTongue });
  const before = await foundry(async (id) => {
    const item = await fromUuid(id);
    const data = item.toObject();
    delete data._stats;
    for (const effect of data.effects ?? []) delete effect._stats;
    return JSON.parse(JSON.stringify(data));
  }, uuid);

  const preview = await previewFromSheet(foundry, gamePage, uuid, { type: "weapon" });
  await preview.locator('input[name="replace"]').check();
  await preview.locator(".item-configurator-apply").click();
  await expect(preview).toBeHidden();

  const changed = await foundry(async (id) => {
    const item = await fromUuid(id);
    return { type: item.type, activities: Object.keys(item._source.system.activities ?? {}).length, effects: item.effects.map((e) => e.id) };
  }, uuid);
  expect(changed.type).toBe("weapon");

  const undo = gamePage.locator(".item-configurator-undo").first();
  await expect(undo).toBeVisible();
  await gamePage.screenshot({ path: test.info().outputPath("C14-undo-button.png") });
  await undo.click();
  // The item has not been modified by someone else since: no confirmation is asked.
  await gamePage.waitForFunction(async (id) => (await fromUuid(id)).type === "loot", uuid);

  const after = await foundry(async (id) => {
    const item = await fromUuid(id);
    const data = item.toObject();
    delete data._stats;
    for (const effect of data.effects ?? []) delete effect._stats;
    if (data.flags?.["item-configurator"] && !Object.keys(data.flags["item-configurator"]).length) delete data.flags["item-configurator"];
    return JSON.parse(JSON.stringify(data));
  }, uuid);
  if (before.flags?.["item-configurator"] && !Object.keys(before.flags["item-configurator"]).length) delete before.flags["item-configurator"];
  evidence("C14-before-changed-after.json", { before, changed, after });
  expect(after).toEqual(before);
  await expect(gamePage.locator(".item-configurator-undo")).toHaveCount(0);
});

test("C14: a player never gets the undo button of a configuration made by the Game Master", async ({ foundry, browser, baseURL }) => {
  await foundry(clientEnsurePlayer, PLAYER_NAME);
  const uuid = await foundry(async ({ prefix, text, playerName }) => {
    const user = game.users.getName(playerName);
    const item = await Item.implementation.create({
      name: `${prefix}Shared Cloak`, type: "loot", system: { description: { value: text } },
      ownership: { default: 0, [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    });
    await game.modules.get("item-configurator").api.configure(item, { type: "equipment", useAI: false, apply: true });
    return item.uuid;
  }, { prefix: PREFIX, text: TEXTS.cloak, playerName: PLAYER_NAME });

  const gm = await foundry(async (id) => {
    const item = await fromUuid(id);
    await item.sheet.render({ force: true });
    const state = { configure: Boolean(item.sheet.element.querySelector(".item-configurator-configure")), undo: Boolean(item.sheet.element.querySelector(".item-configurator-undo")), flag: Boolean(item.getFlag("item-configurator", "undo")) };
    await item.sheet.close();
    return state;
  }, uuid);
  const { context, page } = await joinAsPlayer(browser, baseURL);
  try {
    const player = await page.evaluate(async (id) => {
      const item = await fromUuid(id);
      await item.sheet.render({ force: true });
      const state = { configure: Boolean(item.sheet.element.querySelector(".item-configurator-configure")), undo: Boolean(item.sheet.element.querySelector(".item-configurator-undo")) };
      await item.sheet.close();
      return state;
    }, uuid);
    evidence("C14-undo-other-user.json", { gm, player });
    expect(gm.flag).toBe(true);
    expect(gm.undo).toBe(true);
    expect(player.configure).toBe(true);
    expect(player.undo).toBe(false);
  } finally {
    await context.close();
  }
});

test("C14: a player undoes their own configuration", async ({ foundry, browser, baseURL }) => {
  await foundry(clientEnsurePlayer, PLAYER_NAME);
  const uuid = await foundry(async ({ prefix, text, playerName }) => {
    const user = game.users.getName(playerName);
    const item = await Item.implementation.create({
      name: `${prefix}Player Cloak`, type: "loot", system: { description: { value: text } },
      ownership: { default: 0, [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER }
    });
    return item.uuid;
  }, { prefix: PREFIX, text: TEXTS.cloak, playerName: PLAYER_NAME });
  const { context, page } = await joinAsPlayer(browser, baseURL);
  try {
    const outcome = await page.evaluate(async ({ id }) => {
      const item = await fromUuid(id);
      const normalize = (i) => { const d = i.toObject(); delete d._stats; for (const e of d.effects) delete e._stats; if (d.flags?.["item-configurator"] && !Object.keys(d.flags["item-configurator"]).length) delete d.flags["item-configurator"]; return JSON.parse(JSON.stringify(d)); };
      const before = normalize(item);
      const result = await game.modules.get("item-configurator").api.configure(item, { type: "equipment", useAI: false, apply: true });
      await item.sheet.render({ force: true });
      const undo = item.sheet.element.querySelector(".item-configurator-undo");
      const shown = Boolean(undo);
      undo?.click();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const after = normalize(item);
      await item.sheet.close();
      return { applied: result.applied, shown, same: JSON.stringify(after) === JSON.stringify(before) };
    }, { id: uuid });
    evidence("C14-player-undo.json", outcome);
    expect(outcome.applied).toBe(true);
    expect(outcome.shown).toBe(true);
    expect(outcome.same).toBe(true);
  } finally {
    await context.close();
  }
});

// ---- M4 (previewReady hook) ----------------------------------------------------------------------------------------

test("M4: the previewReady hook reports the time from Analyze to the rendered preview", async ({ foundry }) => {
  const result = await foundry(async ({ prefix, text }) => {
    const item = await Item.implementation.create({ name: `${prefix}Timed Cloak`, type: "loot", system: { description: { value: text } } });
    const { TypeDialog } = await import("/modules/item-configurator/scripts/foundry/type-dialog.mjs");
    const ready = new Promise((resolve) => Hooks.once("item-configurator.previewReady", resolve));
    const dialog = new TypeDialog({ item });
    await dialog.render({ force: true });
    dialog.element.querySelector('select[name="type"]').value = "equipment";
    dialog.element.querySelector('select[name="type"]').dispatchEvent(new Event("change"));
    const wall = performance.now();
    dialog.element.querySelector(".item-configurator-analyze").click();
    const payload = await Promise.race([ready, new Promise((resolve) => setTimeout(() => resolve(null), 20_000))]);
    const wallMs = performance.now() - wall;
    return payload ? { itemId: payload.item.id === item.id, durationMs: payload.durationMs, hasProposal: Boolean(payload.proposal), wallMs } : null;
  }, { prefix: PREFIX, text: TEXTS.cloak });
  evidence("M4-previewReady-single.json", result);
  expect(result).not.toBeNull();
  expect(result.itemId).toBe(true);
  expect(result.hasProposal).toBe(true);
  expect(result.durationMs).toBeGreaterThan(0);
});
