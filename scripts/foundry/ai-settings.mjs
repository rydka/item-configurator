/**
 * Settings menu of the AI (C11): enable, provider (Ollama or Anthropic), Ollama address and model (installed models),
 * Anthropic model, effort and API key (kept in this browser only), time limit.
 */
import { MODULE_ID } from "../constants.mjs";
import { listModels, ping } from "../ai/ollama.mjs";
import {
  ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, DEFAULT_ANTHROPIC_TIMEOUT_S, DEFAULT_EFFORT, DEFAULT_OLLAMA_URL, DEFAULT_PROVIDER,
  DEFAULT_TIMEOUT_S, EFFORTS, MAX_ANTHROPIC_TIMEOUT_S, MAX_TIMEOUT_S, MIN_ANTHROPIC_TIMEOUT_S, MIN_TIMEOUT_S, PROVIDERS, getAiConfig
} from "../settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const call = (...args) => globalThis.fetch(...args);
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export class AiSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-ai-settings`,
    classes: [MODULE_ID, "ai-settings"],
    tag: "form",
    window: { title: `${MODULE_ID}.AiSettings.Title`, icon: "fa-solid fa-robot" },
    position: { width: 480 },
    form: { handler: AiSettingsApp.#onSubmit, closeOnSubmit: true },
    actions: { test: AiSettingsApp.#onTest }
  };

  static PARTS = { form: { template: `modules/${MODULE_ID}/templates/ai-settings.hbs` } };

  /** Values typed in the form but not saved yet (kept across a "Test" re-render). */
  #draft = null;

  /** @override */
  async _prepareContext() {
    const saved = getAiConfig();
    const draft = this.#draft ?? {
      enabled: saved.enabled, provider: saved.provider, url: saved.url, model: saved.model, timeout: saved.timeoutMs / 1000,
      apiKey: saved.apiKey, anthropicModel: saved.anthropicModel, effort: saved.effort,
      anthropicTimeout: saved.anthropicTimeoutMs / 1000
    };
    // The only network access: Ollama, when this window opens (or on "Test"). Nothing is sent to Anthropic here.
    const reachable = await ping(draft.url, { fetch: call });
    const installed = reachable ? await listModels(draft.url, { fetch: call }) : [];
    const names = new Set(installed);
    if (draft.model) names.add(draft.model);
    const option = (list, current, label) => list.map((value) => ({ value, label: label(value), selected: value === current }));
    return {
      ...draft,
      min: MIN_TIMEOUT_S,
      max: MAX_TIMEOUT_S,
      minAnthropic: MIN_ANTHROPIC_TIMEOUT_S,
      maxAnthropic: MAX_ANTHROPIC_TIMEOUT_S,
      reachable,
      modelCount: installed.length,
      models: [...names].map((name) => ({ name, selected: name === draft.model, missing: !installed.includes(name) })),
      providers: option(PROVIDERS, draft.provider, (p) => game.i18n.localize(`${MODULE_ID}.AiSettings.Provider.${p}`)),
      anthropicModels: option(ANTHROPIC_MODELS, draft.anthropicModel, (m) => m),
      efforts: option(EFFORTS, draft.effort, (e) => game.i18n.localize(`${MODULE_ID}.AiSettings.Effort.${e}`)),
      isAnthropic: draft.provider === "anthropic"
    };
  }

  #readForm() {
    const form = this.element;
    const value = (name) => form.querySelector(`[name="${name}"]`)?.value ?? "";
    return {
      enabled: form.querySelector('[name="aiEnabled"]').checked,
      provider: pick(value("aiProvider"), PROVIDERS, DEFAULT_PROVIDER),
      url: value("ollamaUrl").trim() || DEFAULT_OLLAMA_URL,
      model: value("ollamaModel"),
      timeout: Number(value("aiTimeout")) || DEFAULT_TIMEOUT_S,
      apiKey: value("anthropicApiKey").trim(),
      anthropicModel: pick(value("anthropicModel"), ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL),
      effort: pick(value("anthropicEffort"), EFFORTS, DEFAULT_EFFORT),
      anthropicTimeout: Number(value("anthropicTimeout")) || DEFAULT_ANTHROPIC_TIMEOUT_S
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const select = this.element.querySelector('[name="aiProvider"]');
    const toggle = () => {
      const anthropic = select.value === "anthropic";
      for (const group of this.element.querySelectorAll(".provider-ollama")) group.hidden = anthropic;
      for (const group of this.element.querySelectorAll(".provider-anthropic")) group.hidden = !anthropic;
    };
    select?.addEventListener("change", toggle);
  }

  static async #onTest() {
    this.#draft = this.#readForm();
    await this.render();
  }

  static async #onSubmit(event, form, formData) {
    const {
      aiEnabled, aiProvider, ollamaUrl, ollamaModel, aiTimeout, anthropicApiKey, anthropicModel, anthropicEffort, anthropicTimeout
    } = formData.object;
    const timeout = Math.min(MAX_TIMEOUT_S, Math.max(MIN_TIMEOUT_S, Number(aiTimeout) || DEFAULT_TIMEOUT_S));
    const claudeTimeout = Math.min(MAX_ANTHROPIC_TIMEOUT_S, Math.max(MIN_ANTHROPIC_TIMEOUT_S, Number(anthropicTimeout) || DEFAULT_ANTHROPIC_TIMEOUT_S));
    await game.settings.set(MODULE_ID, "aiEnabled", Boolean(aiEnabled));
    await game.settings.set(MODULE_ID, "aiProvider", pick(String(aiProvider ?? ""), PROVIDERS, DEFAULT_PROVIDER));
    await game.settings.set(MODULE_ID, "ollamaUrl", String(ollamaUrl || DEFAULT_OLLAMA_URL).trim());
    await game.settings.set(MODULE_ID, "ollamaModel", String(ollamaModel ?? ""));
    await game.settings.set(MODULE_ID, "aiTimeout", timeout);
    await game.settings.set(MODULE_ID, "anthropicModel", pick(String(anthropicModel ?? ""), ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL));
    await game.settings.set(MODULE_ID, "anthropicEffort", pick(String(anthropicEffort ?? ""), EFFORTS, DEFAULT_EFFORT));
    await game.settings.set(MODULE_ID, "anthropicTimeout", claudeTimeout);
    // Client scope: this browser only (never the world settings)
    await game.settings.set(MODULE_ID, "anthropicApiKey", String(anthropicApiKey ?? "").trim());
  }
}
