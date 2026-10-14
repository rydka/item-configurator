/** Settings menu of the local AI: enable, Ollama address, model (installed models), time limit (C11). */
import { MODULE_ID } from "../constants.mjs";
import { listModels, ping } from "../ai/ollama.mjs";
import { DEFAULT_OLLAMA_URL, DEFAULT_TIMEOUT_S, MAX_TIMEOUT_S, MIN_TIMEOUT_S, getAiConfig } from "../settings.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const call = (...args) => globalThis.fetch(...args);

export class AiSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-ai-settings`,
    classes: [MODULE_ID, "ai-settings"],
    tag: "form",
    window: { title: `${MODULE_ID}.AiSettings.Title`, icon: "fa-solid fa-robot" },
    position: { width: 460 },
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
      enabled: saved.enabled, url: saved.url, model: saved.model, timeout: saved.timeoutMs / 1000
    };
    // The only network access: when this window opens (or on "Test").
    const reachable = await ping(draft.url, { fetch: call });
    const installed = reachable ? await listModels(draft.url, { fetch: call }) : [];
    const names = new Set(installed);
    if (draft.model) names.add(draft.model);
    return {
      ...draft,
      min: MIN_TIMEOUT_S,
      max: MAX_TIMEOUT_S,
      reachable,
      modelCount: installed.length,
      models: [...names].map((name) => ({ name, selected: name === draft.model, missing: !installed.includes(name) }))
    };
  }

  #readForm() {
    const form = this.element;
    return {
      enabled: form.querySelector('[name="aiEnabled"]').checked,
      url: form.querySelector('[name="ollamaUrl"]').value.trim() || DEFAULT_OLLAMA_URL,
      model: form.querySelector('[name="ollamaModel"]').value,
      timeout: Number(form.querySelector('[name="aiTimeout"]').value) || DEFAULT_TIMEOUT_S
    };
  }

  static async #onTest() {
    this.#draft = this.#readForm();
    await this.render();
  }

  static async #onSubmit(event, form, formData) {
    const { aiEnabled, ollamaUrl, ollamaModel, aiTimeout } = formData.object;
    const timeout = Math.min(MAX_TIMEOUT_S, Math.max(MIN_TIMEOUT_S, Number(aiTimeout) || DEFAULT_TIMEOUT_S));
    await game.settings.set(MODULE_ID, "aiEnabled", Boolean(aiEnabled));
    await game.settings.set(MODULE_ID, "ollamaUrl", String(ollamaUrl || DEFAULT_OLLAMA_URL).trim());
    await game.settings.set(MODULE_ID, "ollamaModel", String(ollamaModel ?? ""));
    await game.settings.set(MODULE_ID, "aiTimeout", timeout);
  }
}
