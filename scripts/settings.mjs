import { MODULE_ID } from "./constants.mjs";

export const DEFAULT_OLLAMA_URL = "http://localhost:11434";
export const DEFAULT_TIMEOUT_S = 20;
export const MIN_TIMEOUT_S = 3;
export const MAX_TIMEOUT_S = 120;

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
  if (aiMenu) game.settings.registerMenu(MODULE_ID, "ai", aiMenu);
}

/** Whether players may configure the items they own. */
export function playersAllowed() {
  return Boolean(game.settings.get(MODULE_ID, "allowPlayers"));
}

/**
 * Current AI configuration.
 * @returns {{ enabled: boolean, url: string, model: string, timeoutMs: number }}
 */
export function getAiConfig() {
  const seconds = Number(game.settings.get(MODULE_ID, "aiTimeout"));
  const clamped = Number.isFinite(seconds)
    ? Math.min(MAX_TIMEOUT_S, Math.max(MIN_TIMEOUT_S, seconds))
    : DEFAULT_TIMEOUT_S;
  return {
    enabled: Boolean(game.settings.get(MODULE_ID, "aiEnabled")),
    url: String(game.settings.get(MODULE_ID, "ollamaUrl") || DEFAULT_OLLAMA_URL).replace(/\/+$/, ""),
    model: String(game.settings.get(MODULE_ID, "ollamaModel") ?? ""),
    timeoutMs: clamped * 1000
  };
}
