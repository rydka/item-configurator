// C11: the Game Master can enable the AI, choose the Ollama address, the model (installed models) and the time limit.
// The Ollama endpoints are answered by Playwright (page.route): no real Ollama is needed.
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { PLAYER_NAME, PREFIX, clientCleanup, clientEnsurePlayer, evidence, joinAsPlayer } from "./helpers.mjs";

test.describe.configure({ timeout: 120_000 });

const MODELS = ["llama3.1:8b", "qwen2.5:3b", "mistral:7b"];
const CORS = { "access-control-allow-origin": "*", "content-type": "application/json" };

test.afterEach(async ({ foundry }) => {
  await foundry(clientCleanup, PREFIX);
});

async function fakeOllama(page, { models = MODELS, port = 11434 } = {}) {
  const calls = [];
  await page.route(`http://localhost:${port}/api/**`, (route) => {
    const url = route.request().url();
    calls.push(url);
    if (url.endsWith("/api/version")) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ version: "0.0.0-test" }) });
    if (url.endsWith("/api/tags")) return route.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ models: models.map((name) => ({ name, model: name })) }) });
    return route.fulfill({ status: 200, headers: CORS, body: "{}" });
  });
  return calls;
}

const openMenu = (foundry) => foundry(async () => {
  const menu = game.settings.menus.get("item-configurator.ai");
  await new menu.type().render({ force: true });
});

test("C11: the AI window has the four fields and lists the installed models from /api/tags", async ({ foundry, gamePage }) => {
  const calls = await fakeOllama(gamePage);
  const defaults = await foundry(() => ({
    enabled: game.settings.get("item-configurator", "aiEnabled"),
    url: game.settings.get("item-configurator", "ollamaUrl"),
    timeout: game.settings.get("item-configurator", "aiTimeout")
  }));
  await openMenu(foundry);
  const app = gamePage.locator(".item-configurator.ai-settings");
  await expect(app).toBeVisible();
  await expect(app.locator('input[name="aiEnabled"]')).toHaveCount(1);
  await expect(app.locator('input[name="ollamaUrl"]')).toHaveCount(1);
  await expect(app.locator('select[name="ollamaModel"]')).toHaveCount(1);
  await expect(app.locator('input[name="aiTimeout"]')).toHaveCount(1);
  await expect(app.locator(".connection.ok")).toBeVisible();

  const options = await app.locator('select[name="ollamaModel"] option').evaluateAll((o) => o.map((x) => x.value));
  evidence("C11-models.json", { defaults, requests: calls, options });
  await gamePage.screenshot({ path: test.info().outputPath("C11-ai-settings.png") });
  expect(defaults.enabled).toBe(false);
  expect(options).toEqual(["", ...MODELS]);
  expect(calls.some((url) => url.endsWith("/api/tags"))).toBe(true);
});

test("C11: saving the window stores the four settings", async ({ foundry, gamePage }) => {
  await fakeOllama(gamePage, { port: 11500 });
  await fakeOllama(gamePage);
  await openMenu(foundry);
  const app = gamePage.locator(".item-configurator.ai-settings");
  await expect(app.locator(".connection")).toBeVisible();
  await app.locator('input[name="aiEnabled"]').check();
  await app.locator('input[name="ollamaUrl"]').fill("http://localhost:11500");
  await app.locator('input[name="aiTimeout"]').fill("45");
  await app.locator('button[data-action="test"]').click();
  await expect(app.locator(".connection.ok")).toBeVisible();
  await app.locator('select[name="ollamaModel"]').selectOption("qwen2.5:3b");
  await app.locator('button[type="submit"]').click();
  await expect(app).toBeHidden();
  const saved = await foundry(() => ({
    enabled: game.settings.get("item-configurator", "aiEnabled"),
    url: game.settings.get("item-configurator", "ollamaUrl"),
    model: game.settings.get("item-configurator", "ollamaModel"),
    timeout: game.settings.get("item-configurator", "aiTimeout")
  }));
  evidence("C11-saved.json", saved);
  expect(saved).toEqual({ enabled: true, url: "http://localhost:11500", model: "qwen2.5:3b", timeout: 45 });
});

test("C11: the AI menu is restricted to the Game Master", async ({ foundry, browser, baseURL }) => {
  await foundry(clientEnsurePlayer, PLAYER_NAME);
  const restricted = await foundry(() => game.settings.menus.get("item-configurator.ai").restricted);
  const { context, page } = await joinAsPlayer(browser, baseURL);
  try {
    const asPlayer = await page.evaluate(() => ({ isGM: game.user.isGM, restricted: game.settings.menus.get("item-configurator.ai")?.restricted }));
    evidence("C11-player.json", { restricted, asPlayer });
    expect(restricted).toBe(true);
    expect(asPlayer).toEqual({ isGM: false, restricted: true });
  } finally {
    await context.close();
  }
});
