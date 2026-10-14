import fs from "node:fs";
import { describe, expect, it } from "vitest";

const load = () => import("../../scripts/settings.mjs");
const lang = (code) => JSON.parse(fs.readFileSync(new URL(`../../lang/${code}.json`, import.meta.url), "utf8"));
const flat = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  (v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

describe("settings (C10, C11)", () => {
  it("registers the five settings with the documented defaults", async () => {
    const { registerSettings } = await load();
    registerSettings();
    const defs = Object.fromEntries([...game.settings.settings].map(([k, d]) => [k.replace("item-configurator.", ""), d]));
    expect(Object.keys(defs).sort()).toEqual(["aiEnabled", "aiTimeout", "allowPlayers", "ollamaModel", "ollamaUrl"]);
    expect(defs.allowPlayers).toMatchObject({ default: true, scope: "world", config: true });
    expect(defs.aiEnabled.default).toBe(false); // the local AI is opt-in
    expect(defs.ollamaUrl.default).toBe("http://localhost:11434");
    expect(defs.ollamaModel.default).toBe("");
    expect(defs.aiTimeout.default).toBe(20);
    for (const d of Object.values(defs)) expect(d.scope).toBe("world");
  });
  it("getAiConfig clamps the timeout to 3-120 s and trims the URL", async () => {
    const { registerSettings, getAiConfig } = await load();
    registerSettings();
    const set = (k, v) => game.settings.set("item-configurator", k, v);
    expect(getAiConfig()).toEqual({ enabled: false, url: "http://localhost:11434", model: "", timeoutMs: 20000 });
    await set("aiTimeout", 1);
    expect(getAiConfig().timeoutMs).toBe(3000);
    await set("aiTimeout", 9999);
    expect(getAiConfig().timeoutMs).toBe(120000);
    await set("aiTimeout", "abc");
    expect(getAiConfig().timeoutMs).toBe(20000);
    await set("ollamaUrl", "http://host:1234//");
    expect(getAiConfig().url).toBe("http://host:1234");
    await set("ollamaUrl", "");
    expect(getAiConfig().url).toBe("http://localhost:11434");
    await set("aiEnabled", true);
    expect(getAiConfig().enabled).toBe(true);
  });
  it("playersAllowed follows the setting", async () => {
    const { registerSettings, playersAllowed } = await load();
    registerSettings();
    expect(playersAllowed()).toBe(true);
    await game.settings.set("item-configurator", "allowPlayers", false);
    expect(playersAllowed()).toBe(false);
  });
  it("registers the AI menu when given", async () => {
    const { registerSettings } = await load();
    game.settings.registerMenu = (...args) => (game.settings.menus ??= []).push(args);
    registerSettings({ aiMenu: { name: "x" } });
    expect(game.settings.menus[0].slice(0, 2)).toEqual(["item-configurator", "ai"]);
  });
});

describe("translations (C17)", () => {
  const en = lang("en");
  const fr = lang("fr");
  it("en and fr have exactly the same keys", () => {
    const a = flat(en).sort();
    const b = flat(fr).sort();
    expect(a.filter((k) => !b.includes(k))).toEqual([]);
    expect(b.filter((k) => !a.includes(k))).toEqual([]);
  });
  it("no empty value, and placeholders {x} are the same in both languages", () => {
    const get = (o, p) => p.split(".").reduce((x, k) => x[k], o);
    for (const key of flat(en)) {
      const e = get(en, key);
      const f = get(fr, key);
      expect(e, key).not.toBe("");
      expect(f, key).not.toBe("");
      const ph = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph(f), key).toBe(ph(e));
    }
  });
  it("every key lives under the item-configurator namespace", () => {
    expect(Object.keys(en)).toEqual(["item-configurator"]);
  });
});
