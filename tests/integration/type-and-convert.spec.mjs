// C3 (type window and preselection), C4 (in-place conversion keeps name, image, description, owner, location).
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

/** Opens the type window from the sheet header. */
async function openTypeWindow(foundry, gamePage, uuid) {
  await foundry(async (id) => (await fromUuid(id)).sheet.render({ force: true }), uuid);
  await gamePage.locator(".item-configurator-configure").first().click();
  const dialog = gamePage.locator(".item-configurator.type-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select[name="type"] option')).not.toHaveCount(0);
  return dialog;
}

const closeAll = (foundry) => foundry(async () => {
  for (const app of [...foundry.applications.instances.values()]) {
    if (app.options?.classes?.includes("item-configurator") || app.document) await app.close().catch(() => {});
  }
});

test("C3: the type window offers the 6 types and their subtypes", async ({ foundry, gamePage }) => {
  const uuid = await create(foundry, { name: "Loot", type: "loot", system: { description: { value: TEXTS.nothing } } });
  const dialog = await openTypeWindow(foundry, gamePage, uuid);
  const types = await dialog.locator('select[name="type"] option').evaluateAll((o) => o.map((x) => x.value));
  expect(types).toEqual(["consumable", "weapon", "equipment", "tool", "loot", "container"]);

  const subtypesOf = async (type) => {
    await dialog.locator('select[name="type"]').selectOption(type);
    return dialog.locator('select[name="subtype"] option').evaluateAll((o) => o.map((x) => x.value.split("|")[0]));
  };
  const subtypes = {};
  for (const type of types) subtypes[type] = await subtypesOf(type);
  evidence("C3-types-subtypes.json", { types, subtypes });
  expect(subtypes.consumable).toEqual(expect.arrayContaining(["potion", "scroll", "ammo"]));
  expect(subtypes.weapon).toEqual(expect.arrayContaining(["simpleM", "martialM", "simpleR", "martialR"]));
  expect(subtypes.equipment).toEqual(expect.arrayContaining(["light", "medium", "heavy", "shield", "clothing", "ring"]));
  await dialog.locator('select[name="type"]').selectOption("weapon");
  await gamePage.screenshot({ path: test.info().outputPath("C3-type-window.png") });
  await closeAll(foundry);
});

const PRESELECTION = [
  { id: "potion", name: "Potion of Healing", type: "loot", text: TEXTS.healing, expect: { type: "consumable", value: "potion" } },
  { id: "sword", name: "Flame Tongue Longsword", type: "loot", text: TEXTS.flameTongue, expect: { type: "weapon", value: "martialM" } },
  { id: "cloak", name: "Cloak of Protection", type: "loot", text: TEXTS.cloak, expect: { type: "equipment", value: "clothing" } },
  { id: "ring", name: "Ring of Protection", type: "loot", text: TEXTS.ring, expect: { type: "equipment", value: "ring" } },
  { id: "plate", name: "Plate Armor", type: "loot", text: TEXTS.plate, expect: { type: "equipment", value: "heavy" } },
  { id: "unknown", name: "Odd Thing", type: "tool", text: TEXTS.nothing, expect: { type: "tool", value: null } }
];

for (const c of PRESELECTION) {
  test(`C3: the window preselects ${c.expect.type}${c.expect.value ? ` / ${c.expect.value}` : ""} for ${c.name}`, async ({ foundry, gamePage }) => {
    const uuid = await create(foundry, { name: c.name, type: c.type, system: { description: { value: c.text } } });
    const dialog = await openTypeWindow(foundry, gamePage, uuid);
    const selected = {
      type: await dialog.locator('select[name="type"]').inputValue(),
      subtype: (await dialog.locator('select[name="subtype"]').inputValue()).split("|")[0]
    };
    evidence(`C3-preselection-${c.id}.json`, { item: c.name, currentType: c.type, selected, expected: c.expect });
    await gamePage.screenshot({ path: test.info().outputPath(`C3-preselection-${c.id}.png`) });
    expect(selected.type).toBe(c.expect.type);
    if (c.expect.value) expect(selected.subtype).toBe(c.expect.value);
    await closeAll(foundry);
  });
}

// ---- C4 ------------------------------------------------------------------------------------------------------------

const CONVERSIONS = [
  { id: "loot-weapon", from: "loot", to: "weapon", subtype: "martialM", text: TEXTS.flameTongue },
  { id: "equipment-consumable", from: "equipment", to: "consumable", subtype: "potion", text: TEXTS.healing },
  { id: "container-loot", from: "container", to: "loot", subtype: "", text: "<p>A silver trinket worth 50 gp that weighs 2 pounds. Rare (requires attunement).</p>" }
];
const PLACES = ["world", "folder", "actor", "compendium"];

for (const c of CONVERSIONS) {
  for (const place of PLACES) {
    test(`C4: ${c.from} to ${c.to} in place (${place}) keeps id, name, image, description, folder, ownership and parent`, async ({ foundry }) => {
      const result = await foundry(async ({ prefix, c, place }) => {
        const name = `${prefix}${c.id}`;
        const data = { name, type: c.from, img: "icons/svg/sword.svg", system: { description: { value: c.text }, quantity: 2 } };
        let item;
        let content = null;
        if (place === "world") item = await Item.implementation.create({ ...data, ownership: { default: 2 } });
        if (place === "folder") {
          const folder = await CONFIG.Folder.documentClass.create({ name: `${prefix}folder`, type: "Item" });
          item = await Item.implementation.create({ ...data, folder: folder.id });
        }
        if (place === "actor") {
          const actor = await CONFIG.Actor.documentClass.create({ name: `${prefix}actor`, type: "character" });
          [item] = await actor.createEmbeddedDocuments("Item", [data]);
        }
        if (place === "compendium") {
          const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ label: `${prefix}pack`, name: "ict-convert", type: "Item" });
          [item] = await Item.implementation.createDocuments([data], { pack: pack.collection });
        }
        if (c.from === "container" && place !== "compendium") {
          const [child] = await Item.implementation.createDocuments(
            [{ name: `${prefix}content`, type: "loot", system: { container: item.id } }], item.parent ? { parent: item.parent } : {}
          );
          content = child.uuid;
        }
        const keep = (i) => ({
          id: i.id, name: i.name, img: i.img, description: i.system.description.value, folder: i.folder?.id ?? null,
          ownership: i.ownership, parent: i.parent?.id ?? null, pack: i.pack ?? null
        });
        const before = keep(item);
        const api = game.modules.get("item-configurator").api;
        const outcome = await api.configure(item, { type: c.to, subtype: c.subtype, useAI: false, apply: true });
        const live = await fromUuid(item.uuid);
        const after = keep(live);
        // Reopen the sheet: its class must be the default sheet of the new type.
        await live.sheet.render({ force: true });
        const sheetClass = live.sheet.constructor.name;
        const expectedSheet = Object.values(CONFIG.Item.sheetClasses[live.type] ?? {}).find((s) => s.default)?.cls?.name ?? null;
        await live.sheet.close();
        return {
          before, after, type: live.type, applied: outcome.applied, empty: outcome.changeSet.empty, typeChange: outcome.changeSet.typeChange?.to ?? null,
          sheetClass, expectedSheet, contentKept: content ? (await fromUuid(content))?.system.container === item.id : null
        };
      }, { prefix: PREFIX, c, place });
      evidence(`C4-${c.id}-${place}.json`, result);
      expect(result.applied).toBe(true);
      expect(result.type).toBe(c.to);
      expect(result.after).toEqual(result.before);
      expect(result.sheetClass).toBe(result.expectedSheet);
      if (result.contentKept !== null) expect(result.contentKept).toBe(true);
    });
  }
}
