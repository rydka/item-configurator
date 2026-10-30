/**
 * Minimal Ollama HTTP client. `fetch` is injected, nothing runs at import, no function throws:
 * failures are returned as values. The module never calls `/api/pull`.
 */
import { guarded } from "./guard.mjs";

export const DEFAULT_URL = "http://localhost:11434";
export const PROBE_TIMEOUT_MS = 1500;
export const KEEP_ALIVE = "10m";

/** Models tried by "auto", in order. Others (qwen 1.5, llama2, llava, llama3.2-vision) are never auto-picked. */
export const PREFERRED_MODELS = ["qwen2.5:3b", "llama3.2:3b", "llama3.1:8b"];

/**
 * @param {string} [url]
 * @returns {string}  Base URL without trailing slash.
 */
export function baseUrl(url) {
  return String(url || DEFAULT_URL).trim().replace(/\/+$/, "");
}

/**
 * First installed model among the preferred list (exact name, or the same name with a "-variant" tag suffix).
 * @param {string[]} installed
 * @returns {string|null}
 */
export function pickDefaultModel(installed) {
  const names = (installed ?? []).filter(n => typeof n === "string");
  for ( const wanted of PREFERRED_MODELS ) {
    const found = names.find(n => (n === wanted) || n.startsWith(`${wanted}-`));
    if ( found ) return found;
  }
  return null;
}

/**
 * Is Ollama reachable? (`GET /api/version`, 1.5 s)
 * @param {string} url
 * @param {{ fetch: function, signal?: AbortSignal, timeoutMs?: number }} options
 * @returns {Promise<boolean>}
 */
export async function ping(url, { fetch, signal, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const run = await guarded(timeoutMs, signal, async s => {
    const response = await fetch(`${baseUrl(url)}/api/version`, { signal: s });
    return !!response?.ok;
  });
  return run.value === true;
}

/**
 * Installed model names (`GET /api/tags`). Empty on any failure.
 * @param {string} url
 * @param {{ fetch: function, signal?: AbortSignal, timeoutMs?: number }} options
 * @returns {Promise<string[]>}
 */
export async function listModels(url, { fetch, signal, timeoutMs = PROBE_TIMEOUT_MS * 2 } = {}) {
  const run = await guarded(timeoutMs, signal, async s => {
    const response = await fetch(`${baseUrl(url)}/api/tags`, { signal: s });
    if ( !response?.ok ) return [];
    const json = await response.json();
    return (json?.models ?? []).map(m => m?.name ?? m?.model).filter(n => (typeof n === "string") && n);
  });
  return Array.isArray(run.value) ? run.value : [];
}

/**
 * Ask Ollama to load the model in memory (`POST /api/generate` with no prompt). Callers do not await it.
 * @param {string} url
 * @param {string} model
 * @param {{ fetch: function, signal?: AbortSignal, timeoutMs?: number }} options
 * @returns {Promise<boolean>}
 */
export async function warmUp(url, model, { fetch, signal, timeoutMs = 60000 } = {}) {
  if ( !model ) return false;
  const run = await guarded(timeoutMs, signal, async s => {
    const response = await fetch(`${baseUrl(url)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: KEEP_ALIVE }),
      signal: s
    });
    return !!response?.ok;
  });
  return run.value === true;
}

/**
 * `POST /api/chat`. The answer's `message.content` is parsed as JSON.
 * @param {string} url
 * @param {object} body                 Ollama chat body (model, messages, format, options…).
 * @param {{ fetch: function, signal?: AbortSignal, timeoutMs?: number }} options
 * @returns {Promise<{ ok: boolean, status: "ok"|"unreachable"|"timeout"|"aborted"|"http"|"invalid",
 *                     json?: *, content?: string, error?: string, httpStatus?: number }>}
 */
export async function chat(url, body, { fetch, signal, timeoutMs = 20000 } = {}) {
  const run = await guarded(timeoutMs, signal, async s => {
    const response = await fetch(`${baseUrl(url)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stream: false, keep_alive: KEEP_ALIVE, ...body }),
      signal: s
    });
    if ( !response?.ok ) return { ok: false, status: "http", httpStatus: response?.status };
    const payload = await response.json();
    const content = payload?.message?.content;
    if ( typeof content !== "string" ) return { ok: false, status: "invalid", error: "no message content" };
    try {
      return { ok: true, status: "ok", content, json: JSON.parse(content) };
    } catch(err) {
      return { ok: false, status: "invalid", content, error: String(err.message) };
    }
  });
  if ( run.value ) return run.value;
  if ( run.reason === "error" ) return { ok: false, status: "unreachable", error: run.error };
  return { ok: false, status: run.reason };
}
