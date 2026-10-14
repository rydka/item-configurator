// Fake `fetch` replaying Ollama endpoints. Records the calls in `fetch.calls`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ollama");
export const fixture = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
export const FIXTURES = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "schema.json").map((f) => f.slice(0, -5));

const reply = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });

/** A fetch that never answers but rejects with an AbortError when its signal fires. */
export const hang = (_url, { signal } = {}) => new Promise((_, reject) => {
  signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
});

/**
 * @param {object} [options]
 * @param {string[]} [options.models]        Installed models (`/api/tags`).
 * @param {object} [options.chat]            Body of `/api/chat` (a fixture's `response`).
 * @param {number} [options.chatStatus]      HTTP status of `/api/chat`.
 * @param {boolean} [options.down]           Every call rejects (connection refused).
 * @param {boolean} [options.slow]           `/api/chat` never answers.
 */
export function fakeFetch({ models = ["llama3.1:8b"], chat, chatStatus = 200, down = false, slow = false } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (down) throw new TypeError("fetch failed");
    if (url.endsWith("/api/version")) return reply({ version: "0.1.0" });
    if (url.endsWith("/api/tags")) return reply({ models: models.map((name) => ({ name })) });
    if (url.endsWith("/api/generate")) return reply({ done: true });
    if (url.endsWith("/api/chat")) {
      if (slow) return hang(url, init);
      return reply(chat, { ok: chatStatus === 200, status: chatStatus });
    }
    throw new Error(`unexpected url ${url}`);
  };
  fn.calls = calls;
  return fn;
}

/** Fake fetch serving a fixture, and the requests (`{ sentence }`) matching its sentences. */
export function replay(name, options = {}) {
  const data = fixture(name);
  return {
    fetch: fakeFetch({ chat: data.response, ...options }),
    requests: data.sentences.map((sentence) => ({ sentence })),
    data
  };
}
