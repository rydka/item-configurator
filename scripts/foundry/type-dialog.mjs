/** Window asking for the item type and subtype, then running the analysis (C3, C4). */
import { MODULE_ID } from "../constants.mjs";
import { buildTypeChoices, guessType } from "../core/types.mjs";
import { getAiConfig } from "../settings.mjs";
import { claudeMode, containerNotEmpty, descriptionText, quickPlan, runAnalysis, warmUpAi } from "./analysis.mjs";
import { PreviewDialog } from "./preview-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const optionValue = ({ value, subtype }) => `${value}|${subtype ?? ""}`;
/** Steps of the "Claude first" progress line, in display order (`validate` is the "check" step). */
const STEPS = ["rules", "claude", "validate"];

export class TypeDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-type-{id}`,
    classes: [MODULE_ID, "type-dialog"],
    tag: "form",
    window: { title: `${MODULE_ID}.TypeDialog.Title`, icon: "fa-solid fa-wand-magic-sparkles" },
    position: { width: 420 },
    form: { handler: TypeDialog.#onSubmit, closeOnSubmit: false },
    actions: { cancelAi: TypeDialog.#onCancelAi }
  };

  static PARTS = { form: { template: `modules/${MODULE_ID}/templates/type-dialog.hbs` } };

  #item;
  #choices;
  #guess;
  /** Aborts the AI call of the running analysis (the rules alone remain); the window close aborts it too. */
  #controller = null;
  /** The window is closing: the result of a running analysis is dropped. */
  #closing = false;
  /** Seconds counter of the Claude step. */
  #ticker = null;

  constructor({ item, ...options } = {}) {
    super(options);
    this.#item = item;
  }

  /** @override */
  get title() {
    return game.i18n.format(`${MODULE_ID}.TypeDialog.Heading`, { name: this.#item.name });
  }

  /** @override */
  async _prepareContext() {
    this.#choices ??= buildTypeChoices(CONFIG.DND5E, (key) => game.i18n.localize(key));
    this.#guess ??= guessType(await quickPlan(this.#item), {
      type: this.#item.type, system: this.#item._source.system, name: this.#item.name
    });
    const types = this.#choices.map(({ type, label }) => ({ type, label, selected: type === this.#guess.type }));
    const config = getAiConfig();
    const claude = claudeMode();
    const limit = Math.round(config.anthropicTimeoutMs / 1000);
    // The Claude step is its counter line ("Claude is reading... 0 s / 60 s"), updated every second once it starts
    const steps = STEPS.map((step) => (step === "claude"
      ? { step, counter: game.i18n.format(`${MODULE_ID}.Progress.Claude`, { elapsed: 0, limit }) }
      : { step, label: game.i18n.localize(`${MODULE_ID}.Progress.${step === "validate" ? "Check" : "Rules"}`) }));
    return { types, subtypes: this.#subtypeOptions(this.#guess.type), aiEnabled: config.enabled && !claude, claudeOn: claude, steps, limit };
  }

  /** Options of the subtype select for a type, with the guessed one selected. */
  #subtypeOptions(type) {
    const entry = this.#choices.find((choice) => choice.type === type);
    const wanted = this.#guess.type === type ? optionValue(this.#guess) : "";
    const options = (entry?.subtypes ?? []).map((sub) => ({
      value: optionValue(sub), label: sub.label, selected: optionValue(sub) === wanted
    }));
    if (options.length && !options.some((o) => o.selected)) {
      const plain = options.find((o) => o.value === `${this.#guess.value}|`);
      (plain ?? options[0]).selected = true;
    }
    return options;
  }

  /** @override */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    // Load the AI model while the user chooses (C9, M4); nothing is awaited.
    if (getAiConfig().enabled) warmUpAi();
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const typeSelect = this.element.querySelector('[name="type"]');
    typeSelect?.addEventListener("change", () => {
      const subSelect = this.element.querySelector('[name="subtype"]');
      const options = this.#subtypeOptions(typeSelect.value);
      subSelect.replaceChildren(...options.map(({ value, label, selected }) => {
        const option = new Option(label, value, false, selected);
        return option;
      }));
      subSelect.disabled = !options.length;
      subSelect.closest(".form-group").hidden = !options.length;
    });
  }

  /** @override */
  async close(options) {
    this.#closing = true;
    this.#controller?.abort();
    this.#stopTicker();
    return super.close(options);
  }

  static async #onSubmit(event, form, formData) {
    await this.#analyze(formData.object);
  }

  /** "Cancel" during the Claude call: the call is aborted, the analysis goes on with the rules alone. */
  static #onCancelAi() {
    this.#controller?.abort();
    this.#stopTicker();
    const button = this.element?.querySelector(".item-configurator-cancel-ai");
    if (button) button.disabled = true;
  }

  #stopTicker() {
    if (this.#ticker) clearInterval(this.#ticker);
    this.#ticker = null;
  }

  /**
   * Progress line of the "Claude first" mode: each step is marked active, then done; the Claude step shows a seconds
   * counter against the time limit.
   */
  #onProgress({ step } = {}) {
    const root = this.element;
    if (!root || !STEPS.includes(step)) return;
    root.classList.add("claude-progress");
    const states = root.querySelectorAll(".progress [data-step]");
    for (const li of states) {
      if (li.dataset.step === step) li.classList.add("active");
      // The validation starts once the rules and Claude are both done
      if (step === "validate" && li.dataset.step !== "validate") { li.classList.remove("active"); li.classList.add("done"); }
    }
    if (step === "claude") {
      const started = performance.now();
      const limit = Math.round(getAiConfig().anthropicTimeoutMs / 1000);
      const counter = root.querySelector('.progress [data-step="claude"] .counter');
      const tick = () => {
        if (!counter) return;
        const elapsed = Math.min(limit, Math.round((performance.now() - started) / 1000));
        counter.textContent = game.i18n.format(`${MODULE_ID}.Progress.Claude`, { elapsed, limit });
      };
      tick();
      this.#stopTicker();
      this.#ticker = setInterval(tick, 1000);
      const cancel = root.querySelector(".item-configurator-cancel-ai");
      if (cancel) cancel.disabled = false;
    } else if (step === "validate") this.#stopTicker();
  }

  /** Every step done (the analysis is over, whatever Claude did). */
  #finishProgress() {
    this.#stopTicker();
    for (const li of this.element?.querySelectorAll(".progress [data-step]") ?? []) {
      li.classList.remove("active");
      li.classList.add("done");
    }
  }

  async #analyze({ type, subtype: encoded = "|", replace }) {
    const item = this.#item;
    if (!descriptionText(item.system?.description?.value)) {
      ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.Messages.EmptyDescription`));
      return;
    }
    if (await containerNotEmpty(item, type)) {
      ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.Messages.ContainerNotEmpty`));
      return;
    }
    const [value, subtype = ""] = String(encoded).split("|");
    const started = performance.now();
    this.#controller = new AbortController();
    this.element.classList.add("busy");
    for (const control of this.element.querySelectorAll("button, select")) control.disabled = true;
    try {
      const { proposal, changeSet, rebuild, fingerprint } = await runAnalysis(item, {
        type, value, subtype, replace: Boolean(replace), signal: this.#controller.signal,
        onProgress: (progress) => this.#onProgress(progress)
      });
      this.#finishProgress();
      // Closed meanwhile: nothing to show (a cancelled AI call, on the other hand, gives the rules' preview)
      if (this.#closing) return;
      if (changeSet.empty) {
        ui.notifications.info(game.i18n.localize(`${MODULE_ID}.Messages.NothingRecognized`));
      } else {
        new PreviewDialog({ item, proposal, changeSet, rebuild, fingerprint, replace: Boolean(replace), started })
          .render({ force: true });
      }
      this.#controller = null;
      await this.close();
    } catch (err) {
      console.error(`${MODULE_ID} | analysis failed`, err);
      ui.notifications.error(game.i18n.format(`${MODULE_ID}.errors.analysisFailed`, { error: err.message }));
      this.#stopTicker();
      // The window may have been closed during the analysis: there is nothing left to re-enable
      if (!this.element) return;
      this.element.classList.remove("busy", "claude-progress");
      for (const control of this.element.querySelectorAll("button, select")) control.disabled = false;
      for (const li of this.element.querySelectorAll(".progress [data-step]")) li.classList.remove("active", "done");
    }
  }
}
