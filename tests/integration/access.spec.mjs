// C1 (button presence by user, type and location), C2 (locked compendium).
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { MODULE_ID, PLAYER_NAME, PREFIX, TEXTS, clientButtons, clientCleanup, clientEnsurePlayer, evidence, joinAsPlayer } from "./helpers.mjs";

test.describe.configure({ timeout: 240_000 });

const TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];

test.afterEach(async ({ foundry }) => {
  await foundry(clientCleanup, PREFIX);
});

/** Creates one world item of each supported type (plus a feat, which is not supported) and one actor owning copies. */
async function seed(foundry, playerName, { playerOwns, playerObserves }) {
  return foundry(async ({ prefix, types, text, playerName, playerOwns, playerObserves }) => {
    const user = game.users.getName(playerName);
    const ownership = { default: playerObserves ? CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER : CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
    if (playerOwns) ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const world = {};
    for (const type of [...types, "feat"]) {
      const item = await Item.implementation.create({ name: `${prefix}${type}`, type, ownership, system: { description: { value: text } } });
      world[type] = item.uuid;
    }
    const actor = await CONFIG.Actor.documentClass.create({ name: `${prefix}actor`, type: "character", ownership });
    const owned = {};
    for (const type of types) {
      const [item] = await actor.createEmbeddedDocuments("Item", [{ name: `${prefix}owned ${type}`, type, system: { description: { value: text } } }]);
      owned[type] = item.uuid;
    }
    return { world, owned };
  }, { prefix: PREFIX, types: TYPES, text: TEXTS.flameTongue, playerName, playerOwns, playerObserves });
}

test("C1: the Game Master sees the Configure button on the 6 item types, in the world and on an actor", async ({ foundry, gamePage }) => {
  const { world, owned } = await seed(foundry, PLAYER_NAME, { playerOwns: false, playerObserves: false });
  const found = {};
  for (const [place, uuids] of Object.entries({ world, owned })) {
    for (const [type, uuid] of Object.entries(uuids)) found[`${place}:${type}`] = await foundry(clientButtons, uuid);
  }
  evidence("C1-mj-boutons.json", found);
  for (const [key, state] of Object.entries(found)) {
    if (key.endsWith(":feat")) expect(state.configure, key).toBe(false);
    else {
      expect(state.configure, key).toBe(true);
      expect(state.configureDisabled, key).toBe(false);
    }
  }
  // Visible proof: open one sheet and capture the header.
  await foundry(async (uuid) => (await fromUuid(uuid)).sheet.render({ force: true }), world.weapon);
  await expect(gamePage.locator(".item-configurator-configure").first()).toBeVisible();
  await gamePage.screenshot({ path: test.info().outputPath("C1-mj-bouton-en-tete.png") });
});

test("C1: a player who owns the items sees the button; the allowPlayers setting hides it", async ({ foundry, browser, baseURL }) => {
  await foundry(clientEnsurePlayer, PLAYER_NAME);
  const { world, owned } = await seed(foundry, PLAYER_NAME, { playerOwns: true, playerObserves: true });
  const { context, page } = await joinAsPlayer(browser, baseURL);
  try {
    const withAccess = {};
    for (const [type, uuid] of Object.entries(world)) withAccess[`world:${type}`] = await page.evaluate(clientButtons, uuid);
    for (const [type, uuid] of Object.entries(owned)) withAccess[`owned:${type}`] = await page.evaluate(clientButtons, uuid);
    for (const [key, state] of Object.entries(withAccess)) expect(state.configure, key).toBe(!key.endsWith(":feat"));

    await foundry(async () => game.settings.set("item-configurator", "allowPlayers", false));
    await page.waitForFunction(() => game.settings.get("item-configurator", "allowPlayers") === false);
    const withoutAccess = {};
    for (const [type, uuid] of Object.entries({ ...world, ...owned })) withoutAccess[type] = await page.evaluate(clientButtons, uuid);
    evidence("C1-joueur-proprietaire.json", { allowPlayersTrue: withAccess, allowPlayersFalse: withoutAccess });
    for (const [key, state] of Object.entries(withoutAccess)) expect(state.configure, key).toBe(false);
  } finally {
    await context.close();
  }
});

test("C1: a player who does not own the items never sees the button", async ({ foundry, browser, baseURL }) => {
  await foundry(clientEnsurePlayer, PLAYER_NAME);
  const { world } = await seed(foundry, PLAYER_NAME, { playerOwns: false, playerObserves: true });
  const { context, page } = await joinAsPlayer(browser, baseURL);
  try {
    const states = {};
    for (const [type, uuid] of Object.entries(world)) states[type] = await page.evaluate(clientButtons, uuid);
    evidence("C1-joueur-non-proprietaire.json", states);
    for (const [type, state] of Object.entries(states)) expect(state.configure, type).toBe(false);
  } finally {
    await context.close();
  }
});

test("C2: in a locked compendium the button is disabled with a tooltip; unlocked it is enabled", async ({ foundry, gamePage }) => {
  const uuid = await foundry(async ({ prefix, text }) => {
    const pack = await foundry.documents.collections.CompendiumCollection.createCompendium({ label: `${prefix}pack`, name: "ict-pack", type: "Item" });
    const [item] = await Item.implementation.createDocuments(
      [{ name: `${prefix}sword`, type: "weapon", system: { description: { value: text } } }], { pack: pack.collection }
    );
    await pack.configure({ locked: true });
    return item.uuid;
  }, { prefix: PREFIX, text: TEXTS.flameTongue });

  const locked = await foundry(clientButtons, uuid);
  const lockedTooltip = await foundry(() => game.i18n.localize("item-configurator.Button.LockedPack"));
  await foundry(async (id) => (await fromUuid(id)).sheet.render({ force: true }), uuid);
  const button = gamePage.locator(".item-configurator-configure").first();
  await expect(button).toBeDisabled();
  await gamePage.screenshot({ path: test.info().outputPath("C2-bouton-desactive.png") });
  await foundry(async (id) => (await fromUuid(id)).sheet.close(), uuid);

  await foundry(async () => game.packs.get("world.ict-pack").configure({ locked: false }));
  const unlocked = await foundry(clientButtons, uuid);
  evidence("C2-compendium.json", { locked, lockedTooltip, unlocked });
  expect(locked.configure).toBe(true);
  expect(locked.configureDisabled).toBe(true);
  expect(locked.tooltip).toBe(lockedTooltip);
  expect(lockedTooltip).not.toBe(`${MODULE_ID}.Button.LockedPack`);
  expect(unlocked.configure).toBe(true);
  expect(unlocked.configureDisabled).toBe(false);
});
