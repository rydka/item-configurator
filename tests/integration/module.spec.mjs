import { expect, test } from "../../../../test-env/fixtures.mjs";

const MODULE_ID = "item-configurator";

test("module is active and registers its settings", async ({ foundry }) => {
  const state = await foundry((id) => ({
    active: game.modules.get(id)?.active ?? false,
    enabled: game.settings.get(id, "enabled")
  }), MODULE_ID);
  expect(state).toEqual({ active: true, enabled: true });
});

test("no errors are logged while the world loads", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  await page.goto("/game");
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
  expect(errors.filter((e) => e.includes(MODULE_ID))).toEqual([]);
});
