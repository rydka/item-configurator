import { MODULE_ID } from "./constants.mjs";
import { DEFAULT_EFFORT, DEFAULT_MODEL as DEFAULT_ANTHROPIC_MODEL, EFFORTS, MODELS as ANTHROPIC_MODELS } from "./ai/anthropic.mjs";

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_TIMEOUT_S = 20;
export const MIN_TIMEOUT_S = 3;
export const MAX_TIMEOUT_S = 120;
/** Claude reads the whole description in one call: the answer dominates the delay, hence a longer limit. */
export const DEFAULT_ANTHROPIC_TIMEOUT_S = 60;
export const MIN_ANTHROPIC_TIMEOUT_S = 10;
export const MAX_ANTHROPIC_TIMEOUT_S = 180;
export const PROVIDERS = ["ollama", "anthropic"];
export const DEFAULT_PROVIDER = "ollama";
export { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, DEFAULT_EFFORT, EFFORTS };

const setting = (key, extra) => ({
  name: `${MODULE_ID}.settings.${key}.name`,
  hint: `${MODULE_ID}.settings.${key}.hint`,
  scope: "world",
  ...extra
});

/**
 * Register the module settings. Called on the `init` hook. No network access here.
 * @param {object} [options]
 * @param {object} [options.aiMenu]  Menu definition (`{ name, label, hint, icon, type, restricted }`) for the AI
 *                                   settings form, which edits the four AI settings.
 */
export function registerSettings({ aiMenu } = {}) {
  game.settings.register(MODULE_ID, "allowPlayers", setting("allowPlayers", {
    config: true, type: Boolean, default: true
  }));
  game.settings.register(MODULE_ID, "aiEnabled", setting("aiEnabled", {
    config: false, type: Boolean, default: false
  }));
  game.settings.register(MODULE_ID, "ollamaUrl", setting("ollamaUrl", {
    config: false, type: String, default: DEFAULT_OLLAMA_URL
  }));
  // Empty means "auto": the AI client picks the best installed model.
  game.settings.register(MODULE_ID, "ollamaModel", setting("ollamaModel", {
    config: false, type: String, default: ""
  }));
  game.settings.register(MODULE_ID, "aiTimeout", setting("aiTimeout", {
    config: false, type: Number, default: DEFAULT_TIMEOUT_S
  }));
  game.settings.register(MODULE_ID, "aiProvider", setting("aiProvider", {
    config: false, type: String, default: DEFAULT_PROVIDER, choices: Object.fromEntries(PROVIDERS.map((p) => [p, p]))
  }));
  game.settings.register(MODULE_ID, "anthropicModel", setting("anthropicModel", {
    config: false, type: String, default: DEFAULT_ANTHROPIC_MODEL, choices: Object.fromEntries(ANTHROPIC_MODELS.map((m) => [m, m]))
  }));
  game.settings.register(MODULE_ID, "anthropicEffort", setting("anthropicEffort", {
    config: false, type: String, default: DEFAULT_EFFORT, choices: Object.fromEntries(EFFORTS.map((e) => [e, e]))
  }));
  // Time limit of the single Claude call (seconds); `aiTimeout` stays Ollama's.
  game.settings.register(MODULE_ID, "anthropicTimeout", setting("anthropicTimeout", {
    config: false, type: Number, default: DEFAULT_ANTHROPIC_TIMEOUT_S
  }));
  // The key stays in the Game Master's browser: client scope, never written in the world settings.
  game.settings.register(MODULE_ID, "anthropicApiKey", setting("anthropicApiKey", {
    config: false, scope: "client", type: String, default: ""
  }));
  if (aiMenu) game.settings.registerMenu(MODULE_ID, "ai", aiMenu);
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
/** Seconds of a time limit setting, clamped; the default when unreadable. */
const seconds = (key, { min, max, fallback }) => {
  const value = Number(game.settings.get(MODULE_ID, key));
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

/** Whether players may configure the items they own. */
export function playersAllowed() {
  return Boolean(game.settings.get(MODULE_ID, "allowPlayers"));
}

/**
 * Current AI configuration. `url`, `model` and `timeoutMs` are Ollama's; `apiKey`, `anthropicModel`, `effort` and
 * `anthropicTimeoutMs` are Anthropic's (Claude-first mode).
 * @returns {{ enabled: boolean, provider: "ollama"|"anthropic", url: string, model: string, timeoutMs: number,
 *   apiKey: string, anthropicModel: string, effort: string, anthropicTimeoutMs: number }}
 */
export function getAiConfig() {
  return {
    enabled: Boolean(game.settings.get(MODULE_ID, "aiEnabled")),
    provider: pick(game.settings.get(MODULE_ID, "aiProvider"), PROVIDERS, DEFAULT_PROVIDER),
    url: String(game.settings.get(MODULE_ID, "ollamaUrl") || DEFAULT_OLLAMA_URL).replace(/\/+$/, ""),
    model: String(game.settings.get(MODULE_ID, "ollamaModel") ?? ""),
    timeoutMs: seconds("aiTimeout", { min: MIN_TIMEOUT_S, max: MAX_TIMEOUT_S, fallback: DEFAULT_TIMEOUT_S }) * 1000,
    apiKey: String(game.settings.get(MODULE_ID, "anthropicApiKey") ?? "").trim(),
    anthropicModel: pick(game.settings.get(MODULE_ID, "anthropicModel"), ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL),
    effort: pick(game.settings.get(MODULE_ID, "anthropicEffort"), EFFORTS, DEFAULT_EFFORT),
    anthropicTimeoutMs: seconds("anthropicTimeout", {
      min: MIN_ANTHROPIC_TIMEOUT_S, max: MAX_ANTHROPIC_TIMEOUT_S, fallback: DEFAULT_ANTHROPIC_TIMEOUT_S
    }) * 1000
  };
}
