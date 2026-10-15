// Review fixes: item edited during the preview (C13/M6), non-empty container refused, "Kept" line shows the proposed
// value, the chosen subtype is shown as a change with the previous value.
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { PREFIX, TEXTS, clientCleanup, evidence } from "./helpers.mjs";

test.describe.configure({ timeout: 240_000 });

test.afterEach(async ({ foundry }) => {
  await foundry(clientCleanup, PREFIX);
});

const create = (foundry, data) => foundry(async ({ prefix, data }) => {
  const item = await Item.implementation.create({ ...data, name: `${prefix}${data.name}` });
  return item.uuid;
}, { prefix: PREFIX, data });

async function openDialog(foundry, gamePage, uuid) {
  await foundry(async (id) => (await fromUuid(id)).sheet.render({ force: true }), uuid);
  await gamePage.locator(".item-configurator-configure").first().click();
  const dialog = gamePage.locator(".item-configurator.type-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openPreview(foundry, gamePage, uuid, { type, subtype } = {}) {
  const dialog = await openDialog(foundry, gamePage, uuid);
  if (type) await dialog.locator('select[name="type"]').selectOption(type);
  if (subtype) await dialog.locator('select[name="subtype"]').selectOption({ value: subtype });
  await dialog.locator(".item-configurator-analyze").click();
  const preview = gamePage.locator(".item-configurator.preview");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  return preview;
}

const sourceOf = (foundry, uuid) => foundry(async (id) => {
  const item = await fromUuid(id);
  return {
    rarities: [...(item._source.system.rarities ?? [])], activities: Object.keys(item._source.system.activities ?? {}).length,
    effects: item.effects.size, type: item.type, weight: item._source.system.weight?.value ?? null
  };
}, uuid);

test("C13/M6: an item edited while the preview is open is not overwritten; Apply recomputes and warns first", async ({ foundry, gamePage }) => {
  const uuid = await create(foundry, { name: "Edited Sword", type: "weapon", system: { description: { value: TEXTS.flameTongue } } });
  const preview = await openPreview(foundry, gamePage, uuid, { type: "weapon" });
  // Someone edits the rarity meanwhile (the text says "rare").
  await foundry(async (id) => (await fromUuid(id)).update({ "system.rarities": ["legendary"] }), uuid);
  const edited = await sourceOf(foundry, uuid);

  await preview.locator(".item-configurator-apply").click();
  await expect(preview.locator(".stale")).toBeVisible();
  const afterFirst = await sourceOf(foundry, uuid);
  await gamePage.screenshot({ path: test.info().outputPath("C13-stale-warning.png") });
  const flag = await foundry(async (id) => (await fromUuid(id)).getFlag("item-configurator", "undo") ?? null, uuid);
  evidence("C13-stale-first-apply.json", { edited, afterFirst, flag });
  expect(afterFirst).toEqual(edited);
  expect(flag).toBeNull();
  expect(afterFirst.rarities).toEqual(["legendary"]);

  // The second click applies the recomputed proposal: the edited rarity survives.
  await preview.locator(".item-configurator-apply").click();
  await expect(preview).toBeHidden();
  const final = await sourceOf(foundry, uuid);
  evidence("C13-stale-second-apply.json", final);
  expect(final.rarities).toEqual(["legendary"]);
  expect(final.activities).toBeGreaterThan(0);
});

test("Non-empty container: the conversion is refused by the type window and by the API", async ({ foundry, gamePage }) => {
  const uuid = await foundry(async ({ prefix }) => {
    const box = await Item.implementation.create({ name: `${prefix}Box`, type: "container", system: { description: { value: "<p>A silver trinket worth 50 gp that weighs 2 pounds.</p>" } } });
    await Item.implementation.create({ name: `${prefix}Content`, type: "loot", system: { container: box.id } });
    return box.uuid;
  }, { prefix: PREFIX });
  const message = await foundry(() => game.i18n.localize("item-configurator.Messages.ContainerNotEmpty"));
  expect(message).not.toContain("Messages.ContainerNotEmpty");

  const api = await foundry(async (id) => {
    const item = await fromUuid(id);
    try {
      await game.modules.get("item-configurator").api.configure(item, { type: "loot", useAI: false, apply: true });
      return { refused: false };
    } catch (err) {
      return { refused: true, message: err.message };
    }
  }, uuid);
  const afterApi = await sourceOf(foundry, uuid);

  const dialog = await openDialog(foundry, gamePage, uuid);
  await dialog.locator('select[name="type"]').selectOption("loot");
  await dialog.locator(".item-configurator-analyze").click();
  await expect(gamePage.locator(".notification", { hasText: message }).first()).toBeVisible();
  await expect(gamePage.locator(".item-configurator.preview")).toHaveCount(0);
  await gamePage.screenshot({ path: test.info().outputPath("container-not-empty-window.png") });
  const afterWindow = await sourceOf(foundry, uuid);
  evidence("container-not-empty.json", { api, message, afterApi, afterWindow });
  expect(api.refused).toBe(true);
  expect(api.message).toBe(message);
  expect(afterApi.type).toBe("container");
  expect(afterWindow.type).toBe("container");
});

test("A Kept line shows the value proposed by the text", async ({ foundry, gamePage }) => {
  const uuid = await create(foundry, { name: "Kept Sword", type: "weapon", system: { description: { value: TEXTS.flameTongue }, rarities: ["legendary"] } });
  const preview = await openPreview(foundry, gamePage, uuid, { type: "weapon" });
  const kept = await preview.locator("li.entry.keep").evaluateAll((lis) => lis.map((li) => ({
    label: li.querySelector(".label")?.textContent.trim(),
    previous: li.querySelector(".previous code")?.textContent.trim() ?? null,
    proposed: li.querySelector(".proposed code")?.textContent.trim() ?? null
  })));
  evidence("keep-line-proposed.json", kept);
  await gamePage.screenshot({ path: test.info().outputPath("keep-line-proposed.png") });
  expect(kept.length).toBeGreaterThan(0);
  expect(kept.some((k) => k.proposed), "a Kept line shows the proposed value").toBe(true);
  await preview.locator('button[data-action="cancel"]').click();
});

test("The chosen subtype is a visible change with the previous value", async ({ foundry, gamePage }) => {
  const uuid = await create(foundry, { name: "Subtype Sword", type: "weapon", system: { description: { value: TEXTS.flameTongue }, type: { value: "simpleM" } } });
  const previousLabel = await foundry(() => {
    const def = CONFIG.DND5E.weaponTypes.simpleM;
    return typeof def === "string" ? def : def.label;
  });
  const preview = await openPreview(foundry, gamePage, uuid, { type: "weapon", subtype: "martialM|" });
  const chosen = await preview.locator("li.entry").evaluateAll((lis) => lis.map((li) => ({
    label: li.querySelector(".label")?.textContent.trim(),
    previous: li.querySelector(".previous code")?.textContent.trim() ?? null,
    action: li.className
  })));
  evidence("subtype-chosen.json", { previousLabel, chosen });
  await gamePage.screenshot({ path: test.info().outputPath("subtype-chosen.png") });
  const entry = chosen.find((e) => e.previous === previousLabel);
  expect(entry, "an entry shows the previous subtype").toBeTruthy();
  expect(entry.action).not.toMatch(/\bkeep\b/);
  await preview.locator('button[data-action="cancel"]').click();
});
