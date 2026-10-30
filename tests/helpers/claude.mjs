// Helpers of the Claude-first tests: fixtures of tests/fixtures/claude, enums of the world, a fake Messages API.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { schemaEnums } from "../../scripts/ai/claude-schema.mjs";
import { K } from "./analysis.mjs";
import { readJson, referenceFile } from "./keys.mjs";

const dir = fileURLToPath(new URL("../fixtures/claude/", import.meta.url));
export const claudeFixture = (name) => readJson(dir, `${name}.json`);
export const CASES = readJson(dir, "cases.json");
export const EXPECTED = readJson(dir, "expected.json");
export const ITEMS = readJson(dir, "items.json");
export { K };

const snapshot = referenceFile("schema-enums.json");
/** Enumerations of the world (Foundry 14.369 / dnd5e 6.0.6 snapshot). */
export const ENUMS = schemaEnums(snapshot.dnd5e, { ACTIVE_EFFECT_DURATION_UNITS: Object.fromEntries(snapshot.const.ACTIVE_EFFECT_DURATION_UNITS.map((u) => [u, u])) });

/** The JSON Claude answered in a fixture (null when the text is not JSON). */
export function answerOf(name) {
  const text = claudeFixture(name).response?.content?.[0]?.text;
  try { return JSON.parse(text); } catch { return null; }
}

/** A fake `fetch` for the Messages API, recording its calls. `replies` are consumed in order (the last one repeats). */
export function fakeMessages(...replies) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: JSON.parse(init.body), headers: init.headers });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r.networkError) throw new TypeError("Failed to fetch");
    if (r.httpError) {
      const { status, body } = r.httpError;
      return { ok: false, status, headers: { get: (h) => r.headers?.[h] ?? null }, json: async () => body };
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => r.response };
  };
  fn.calls = calls;
  return fn;
}

export const fixtureExists = (name) => fs.existsSync(`${dir}${name}.json`);
