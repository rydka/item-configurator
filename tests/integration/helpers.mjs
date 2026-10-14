// Shared helpers for the integration specs of item-configurator (T3).
//
// The `client*` functions run INSIDE Foundry through `foundry(fn, arg)` or `page.evaluate`: Playwright serializes them,
// so they must stay self-contained (no reference to anything declared in this file).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, waitForGame } from "../../../../test-env/fixtures.mjs";

export const MODULE_ID = "item-configurator";
export const PREFIX = "ICT ";
export const PLAYER_NAME = "ICT Test Player";
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export const fixtureJson = (name) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));

/** Writes a named proof file (archived with the run). Prefix the name with the criterion or metric. */
export function evidence(name, data) {
  writeFileSync(test.info().outputPath(name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

/** Descriptions used by several specs (taken from the scenarios of the specification). */
export const TEXTS = {
  flameTongue: "<p><em>Weapon (any sword), rare (requires attunement)</em></p>"
    + "<p>You can use a bonus action to speak this magic sword's command word, causing flames to erupt from the blade. "
    + "These flames shed bright light in a 40-foot radius and dim light for an additional 40 feet. While the sword is ablaze, "
    + "it deals an extra 2d6 fire damage to any target it hits. The flames last until you use a bonus action to speak the "
    + "command word again or until you drop or sheathe the sword.</p>",
  healing: "<p><em>Potion, common</em></p><p>You regain 2d4 + 2 hit points when you drink this potion. The potion's red liquid glimmers when agitated.</p>",
  cloak: "<p><em>Wondrous item, uncommon (requires attunement)</em></p><p>You gain a +1 bonus to AC and saving throws while you wear this cloak.</p>",
  ring: "<p><em>Ring, rare (requires attunement)</em></p><p>You gain a +1 bonus to AC and saving throws while you wear this ring.</p>",
  plate: "<p><em>Armor (plate), rare</em></p><p>You have a +2 bonus to AC while wearing this armor. Plate armor has an AC of 18 and imposes disadvantage on Dexterity (Stealth) checks.</p>",
  nothing: "<p>Lorem ipsum dolor sit amet.</p>"
};

/**
 * Joins the world as the test player in a separate browser context (it never touches the Gamemaster session).
 * Create the user first with `clientEnsurePlayer`.
 */
export async function joinAsPlayer(browser, baseURL) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, viewport: { width: 1600, height: 900 } });
  await context.addInitScript(() => localStorage.setItem("core.noCanvas", "true"));
  const page = await context.newPage();
  await page.goto("/join");
  await page.getByRole("combobox", { name: "Select User" }).selectOption({ label: PLAYER_NAME });
  await page.getByRole("button", { name: "Join Game Session" }).click();
  await waitForGame(page);
  return { context, page };
}

/** Creates the test player (if missing) and returns its id. */
export async function clientEnsurePlayer(name) {
  const user = game.users.getName(name) ?? await CONFIG.User.documentClass.create({ name, role: CONST.USER_ROLES.PLAYER });
  return user.id;
}

/** Removes everything the specs create: items, actors, folders, messages, packs and the test player. */
export async function clientCleanup(prefix) {
  const wanted = (doc) => String(doc.name ?? "").startsWith(prefix);
  await game.settings.set("item-configurator", "allowPlayers", true);
  await game.settings.set("item-configurator", "aiEnabled", false);
  await game.settings.set("item-configurator", "ollamaUrl", "http://localhost:11434");
  for (const app of foundry.applications.instances.values()) {
    if (app.constructor.name !== "Sidebar" && app.options?.classes?.includes("item-configurator")) await app.close().catch(() => {});
  }
  for (const pack of game.packs.filter((p) => p.metadata.packageType === "world" && wanted({ name: p.metadata.label }))) {
    await pack.deleteCompendium();
  }
  await CONFIG.Actor.documentClass.deleteDocuments(game.actors.filter(wanted).map((a) => a.id));
  await Item.implementation.deleteDocuments(game.items.filter(wanted).map((i) => i.id));
  await CONFIG.Folder.documentClass.deleteDocuments(game.folders.filter(wanted).map((f) => f.id));
  await ChatMessage.implementation.deleteDocuments(game.messages.map((m) => m.id));
  const users = game.users.filter((u) => u.name.startsWith(prefix));
  await CONFIG.User.documentClass.deleteDocuments(users.map((u) => u.id));
}

/** Plain-object copy of `item.toObject()` without volatile data (stats, empty module flag scope) for exact comparisons. */
export function clientNormalized(item) {
  const data = item.toObject();
  delete data._stats;
  for (const effect of data.effects ?? []) delete effect._stats;
  if (data.flags?.["item-configurator"] && !Object.keys(data.flags["item-configurator"]).length) delete data.flags["item-configurator"];
  return JSON.parse(JSON.stringify(data));
}

/** Header button state of an item's sheet, rendered in the current client. */
export async function clientButtons(uuid) {
  const item = await fromUuid(uuid);
  await item.sheet.render({ force: true });
  const el = item.sheet.element;
  const configure = el.querySelector(".item-configurator-configure");
  const undo = el.querySelector(".item-configurator-undo");
  const result = {
    configure: Boolean(configure),
    configureDisabled: configure?.disabled ?? null,
    tooltip: configure?.dataset.tooltip ?? null,
    undo: Boolean(undo)
  };
  await item.sheet.close();
  return result;
}
