/**
 * Minimal Anthropic Messages API client: a raw `fetch` (the module is served as plain ESM, no SDK). `fetch` is
 * injected, nothing runs at import, no function throws: failures are returned as values. No Foundry global, so the
 * client also runs from Node (`fetch` exists in Node 24) when given its configuration.
 *
 * Only the Game Master's browser calls this, with the key stored in that browser (client-scoped setting): the item
 * descriptions are sent to Anthropic.
 */
import { guarded, sleep } from "./guard.mjs";

export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2023-06-01";
export const BETA = "server-side-fallback-2026-07-01";
export const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"];
export const DEFAULT_MODEL = MODELS[0];
export const EFFORTS = ["low", "medium", "high"];
export const DEFAULT_EFFORT = "low";
export const MAX_TOKENS = 4000;
/** Wait before the single retry of a 429 / 5xx answer when the server gives no `retry-after`. */
export const DEFAULT_RETRY_MS = 1000;

/**
 * Request headers. The browser header is required because the call leaves the Game Master's browser directly.
 * @param {string} apiKey
 * @returns {object}
 */
export function headers(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": API_VERSION,
    "anthropic-dangerous-direct-browser-access": "true",
    "anthropic-beta": BETA
  };
}

/**
 * Request body. No `thinking`, `temperature` nor prefilled answer: these are 400 errors on these models.
 * @param {object} options
 * @param {string} options.model
 * @param {string} options.effort            `low` | `medium` | `high`.
 * @param {string} options.system            System prompt.
 * @param {{ role: string, content: string }[]} options.messages
 * @param {object} options.schema            JSON schema of the answer (the same one Ollama gets as `format`).
 * @param {number} [options.maxTokens]
 * @returns {object}
 */
export function buildBody({ model, effort, system, messages, schema, maxTokens = MAX_TOKENS }) {
  return {
    model: MODELS.includes(model) ? model : DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    messages,
    output_config: {
      effort: EFFORTS.includes(effort) ? effort : DEFAULT_EFFORT,
      format: { type: "json_schema", schema }
    },
    fallbacks: "default"
  };
}

/**
 * Delay asked by a `retry-after` header (seconds or HTTP date), in ms; null when absent or unreadable.
 * @param {string|null|undefined} value
 * @param {number} [now]
 * @returns {number|null}
 */
export function retryAfterMs(value, now = Date.now()) {
  if ( value == null || value === "" ) return null;
  const text = String(value).trim();
  if ( /^\d+(?:\.\d+)?$/.test(text) ) return Math.max(0, Number(text) * 1000);
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Token usage of an answer, when reported. */
const usageOf = payload => {
  const usage = payload?.usage;
  if ( !usage || (typeof usage !== "object") ) return null;
  return { input: usage.input_tokens ?? null, output: usage.output_tokens ?? null };
};

/**
 * `POST /v1/messages` with a JSON schema output. The first text block of the answer is parsed as JSON.
 * One retry at most on 429 / 5xx, respecting `retry-after` when it fits in the remaining time.
 * @param {{ apiKey: string, model?: string, effort?: string, maxTokens?: number }} config
 * @param {{ system: string, messages: object[], schema: object }} request
 * @param {{ fetch: function, signal?: AbortSignal, timeoutMs?: number, now?: function(): number }} options
 * @returns {Promise<{ ok: boolean,
 *   status: "ok"|"noKey"|"unauthorized"|"http"|"refusal"|"truncated"|"invalid"|"unreachable"|"timeout"|"aborted",
 *   json?: *, content?: string, error?: string, httpStatus?: number, stopReason?: string,
 *   usage?: { input: number|null, output: number|null }|null, retried: boolean }>}
 */
export async function complete({ apiKey, model, effort, maxTokens } = {}, { system, messages, schema } = {},
  { fetch, signal, timeoutMs = 20000, now = () => Date.now() } = {}) {
  const key = String(apiKey ?? "").trim();
  if ( !key ) return { ok: false, status: "noKey", retried: false };
  const body = JSON.stringify(buildBody({ model, effort, system, messages, schema, maxTokens }));
  const deadline = now() + timeoutMs;
  let retried = false;

  const run = await guarded(timeoutMs, signal, async s => {
    const send = () => fetch(API_URL, { method: "POST", headers: headers(key), body, signal: s });
    let response = await send();
    const retryable = r => (r?.status === 429) || ((r?.status ?? 0) >= 500);
    if ( retryable(response) ) {
      const wait = retryAfterMs(response.headers?.get?.("retry-after"), now()) ?? DEFAULT_RETRY_MS;
      if ( (now() + wait) < deadline ) {
        await sleep(wait, s);
        retried = true;
        response = await send();
      }
    }
    const httpStatus = response?.status;
    if ( !response?.ok ) {
      let error;
      try { error = (await response.json())?.error?.message; } catch { /* no body */ }
      const status = [401, 403].includes(httpStatus) ? "unauthorized" : "http";
      return { ok: false, status, httpStatus, error: error ? String(error) : undefined };
    }
    const payload = await response.json();
    const usage = usageOf(payload);
    const stopReason = payload?.stop_reason;
    if ( stopReason === "refusal" ) return { ok: false, status: "refusal", stopReason, usage, httpStatus };
    if ( stopReason === "max_tokens" ) return { ok: false, status: "truncated", stopReason, usage, httpStatus };
    const content = (payload?.content ?? []).find(block => block?.type === "text")?.text;
    if ( typeof content !== "string" ) return { ok: false, status: "invalid", error: "no text block", stopReason, usage, httpStatus };
    try {
      return { ok: true, status: "ok", content, json: JSON.parse(content), stopReason, usage, httpStatus };
    } catch(err) {
      return { ok: false, status: "invalid", content, error: String(err.message), stopReason, usage, httpStatus };
    }
  });
  if ( run.value ) return { ...run.value, retried };
  if ( run.reason === "error" ) return { ok: false, status: "unreachable", error: run.error, retried };
  return { ok: false, status: run.reason, retried };
}
