/* global document */
// Helpers of the Claude-first integration specs (T4): the Anthropic API is answered by page.route with the simulated
// answers of tests/fixtures/claude; nothing ever leaves the machine.
import { expect } from "../../../../test-env/fixtures.mjs";
import { PREFIX, fixtureJson } from "./helpers.mjs";

export const FAKE_KEY = "sk-ant-fake-for-route-test-0123456789";
export const fx = (name) => fixtureJson(`claude/${name}.json`);
export const ITEMS = fx("items");

/** Settings of the Game Master's browser for the Claude-first mode (the key is client-scoped). */
export async function claudeOn(foundry, { key = FAKE_KEY, timeout = 30 } = {}) {
  await foundry(async ({ key, timeout }) => {
    await game.settings.set("item-configurator", "aiEnabled", true);
    await game.settings.set("item-configurator", "aiProvider", "anthropic");
    await game.settings.set("item-configurator", "anthropicTimeout", timeout);
    await game.settings.set("item-configurator", "anthropicApiKey", key);
  }, { key, timeout });
}

/** Back to the defaults (also used after each test). */
export async function claudeOff() {
  await game.settings.set("item-configurator", "aiEnabled", false);
  await game.settings.set("item-configurator", "aiProvider", "ollama");
  await game.settings.set("item-configurator", "anthropicTimeout", 60);
  await game.settings.set("item-configurator", "anthropicApiKey", "");
}

/**
 * Answer every call to api.anthropic.com. `reply(body, headers, index)` returns `{ status, body, headers, delay }`,
 * or `"abort"` (network failure). Returns the recorded requests.
 */
export async function serve(page, reply) {
  const requests = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    const body = request.postDataJSON();
    requests.push({ url: request.url(), method: request.method(), headers: request.headers(), body });
    const answer = await reply(body, request.headers(), requests.length - 1);
    if (answer === "abort") return route.abort("connectionrefused").catch(() => {});
    if (answer.delay) await new Promise((resolve) => setTimeout(resolve, answer.delay));
    await route.fulfill({
      status: answer.status ?? 200, contentType: "application/json", headers: answer.headers ?? {},
      body: JSON.stringify(answer.body)
    }).catch(() => {}); // the client may have gone (cancel, timeout)
  });
  return requests;
}

/** The recorded answer of a fixture as `serve` expects it. */
export const ok = (id, over = {}) => ({ status: 200, body: fx(id).response, ...over });
export const httpError = (id, over = {}) => ({ status: fx(id).httpError.status, body: fx(id).httpError.body, ...over });

/** A fixture whose JSON was modified by `edit(json)`. */
export function mutate(id, edit) {
  const copy = structuredClone(fx(id).response);
  const json = JSON.parse(copy.content[0].text);
  edit(json);
  copy.content[0].text = JSON.stringify(json);
  return { status: 200, body: copy };
}

/** Creates an item of the ring or the compass (type of the fixtures) in the world; returns its uuid. */
export function createItem(foundry, { name, type = "loot", html }) {
  return foundry(async ({ prefix, name, type, html }) => {
    const item = await Item.implementation.create({ name: `${prefix}${name}`, type, system: { description: { value: html } } });
    return item.uuid;
  }, { prefix: PREFIX, name, type, html });
}

/** Sheet -> Configure -> choose the type -> Analyze. Returns the type window (progress is visible in it). */
export async function startAnalysis(foundry, gamePage, uuid, { type, subtype } = {}) {
  await foundry(async (id) => (await fromUuid(id)).sheet.render({ force: true }), uuid);
  await gamePage.locator(".item-configurator-configure-button").first().click();
  const dialog = gamePage.locator(".item-configurator.type-dialog");
  await expect(dialog).toBeVisible();
  // The window preselects the type and sub-type read from the header: only change what differs (a change re-renders it)
  const typeSelect = dialog.locator('select[name="type"]');
  if (type && (await typeSelect.inputValue()) !== type) await typeSelect.selectOption(type);
  const subtypeSelect = dialog.locator('select[name="subtype"]');
  if (subtype && (await subtypeSelect.inputValue()).split("|")[0] !== subtype) await subtypeSelect.selectOption({ value: `${subtype}|` });
  await dialog.locator(".item-configurator-analyze").click();
  return dialog;
}

export async function waitPreview(gamePage, timeout = 40_000) {
  const preview = gamePage.locator(".item-configurator.preview");
  await expect(preview).toBeVisible({ timeout });
  return preview;
}

/** What the preview shows (status line, groups, marks, checkboxes, radios). */
export function previewFacts(gamePage) {
  return gamePage.evaluate(() => {
    const el = document.querySelector(".item-configurator.preview");
    const texts = (sel) => [...el.querySelectorAll(sel)].map((e) => e.textContent.replace(/\s+/g, " ").trim());
    return {
      status: el.querySelector(".ai-status")?.textContent.trim(), rulesOnly: Boolean(el.querySelector(".ai-status.rules-only")),
      groups: texts(".group h3, details.group summary h3"), checks: texts(".group-check .check .entry-line"),
      choices: [...el.querySelectorAll(".check-choice")].map((r) => `${r.value}:${r.checked}`),
      boxes: el.querySelectorAll(".entry-select").length, checked: el.querySelectorAll(".entry-select:checked").length,
      claudeMarks: el.querySelectorAll(".claude-mark").length, agree: el.querySelectorAll(".check-mark.agree").length,
      conflict: el.querySelectorAll(".check-mark.conflict").length, claudeOnly: el.querySelectorAll(".check-mark.claude-only").length,
      inferred: el.querySelectorAll(".inferred-mark").length, certainty: texts(".certainty-mark"),
      lowEntries: [...el.querySelectorAll("li.entry")].filter((li) => li.querySelector(".certainty-mark.low")).map((li) => ({
        label: li.querySelector(".label")?.textContent.trim(), checked: li.querySelector(".entry-select")?.checked ?? null
      })),
      corrected: texts(".group-corrected li"), discarded: texts(".group-discarded li"), unrecognized: texts(".group-unrecognized li"),
      notAutomated: texts(".group-not-automated li"), flavor: texts(".group-flavor li")
    };
  });
}

/** The configured data of a world item that the specs compare. */
export function itemData(foundry, uuid) {
  return foundry(async (id) => {
    const i = await fromUuid(id);
    return {
      type: i.type, kind: i.system.type?.value, rarities: [...(i.system.rarities ?? [])], attunement: i.system.attunement,
      properties: [...(i.system.properties ?? [])], usesMax: String(i.system.uses?.max ?? ""), recovery: (i.system.uses?.recovery ?? []).map((r) => r.period),
      activities: (i.system.activities?.map?.((a) => ({
        id: a.id, type: a.type, name: a.name, activation: a.activation?.type, condition: a.activation?.condition,
        healing: a.healing?.denomination ? { number: a.healing.number, denomination: a.healing.denomination, bonus: a.healing.bonus, types: [...a.healing.types] } : null,
        damage: (a.damage?.parts ?? []).map((p) => `${p.number}d${p.denomination}`),
        uses: a.uses?.max ? String(a.uses.max) : null, recoveryA: (a.uses?.recovery ?? []).map((r) => r.period),
        consumption: (a.consumption?.targets ?? []).map((t) => t.type), roll: a.roll?.formula ?? null,
        duration: a.duration?.units ? `${a.duration.value} ${a.duration.units}` : null,
        template: a.target?.template?.type ? `${a.target.template.type} ${a.target.template.size} ${a.target.template.units}` : null,
        range: a.range?.units ?? null, effects: [...(a.effects ?? [])].map((e) => e._id ?? e)
      })) ?? []),
      effects: i.effects.map((e) => ({ id: e.id, name: e.name, transfer: e.transfer, expiry: e.duration?.expiry ?? null, changes: e.changes.map((c) => ({ key: c.key, type: c.type, value: c.value })) })),
      undo: Boolean(i.getFlag("item-configurator", "undo"))
    };
  }, uuid);
}

/** Does the key appear anywhere in the world (settings, items, actors, messages, flags, journal, users)? */
export function keyLeaks(foundry, key) {
  return foundry(async (needle) => {
    const hits = [];
    const scan = (label, value) => { if (JSON.stringify(value ?? null).includes(needle)) hits.push(label); };
    scan("world settings", [...game.settings.storage.get("world").values()].map((s) => s.toObject()));
    for (const name of ["items", "actors", "messages", "folders", "journal", "scenes", "users", "combats"]) {
      scan(name, game[name]?.map((d) => d.toObject()));
    }
    for (const pack of game.packs.filter((p) => p.metadata.packageType === "world")) scan(`pack ${pack.collection}`, (await pack.getDocuments()).map((d) => d.toObject()));
    return hits;
  }, key);
}
