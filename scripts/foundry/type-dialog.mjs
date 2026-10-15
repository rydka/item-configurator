/** Window asking for the item type and subtype, then running the analysis (C3, C4). */
import { MODULE_ID } from "../constants.mjs";
import { buildTypeChoices, guessType } from "../core/types.mjs";
import { getAiConfig } from "../settings.mjs";
import { containerNotEmpty, descriptionText, quickPlan, runAnalysis, warmUpAi } from "./analysis.mjs";
import { PreviewDialog } from "./preview-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const optionValue = ({ value, subtype }) => `${value}|${subtype ?? ""}`;

export class TypeDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-type-{id}`,
    classes: [MODULE_ID, "type-dialog"],
    tag: "form",
    window: { title: `${MODULE_ID}.TypeDialog.Title`, icon: "fa-solid fa-wand-magic-sparkles" },
    position: { width: 420 },
    form: { handler: TypeDialog.#onSubmit, closeOnSubmit: false }
  };

  static PARTS = { form: { template: `modules/${MODULE_ID}/templates/type-dialog.hbs` } };

  #item;
  #choices;
  #guess;
  #controller = null;

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
    this.#guess ??= guessType(await quickPlan(this.#item), { type: this.#item.type, system: this.#item._source.system });
    const types = this.#choices.map(({ type, label }) => ({ type, label, selected: type === this.#guess.type }));
    return { types, subtypes: this.#subtypeOptions(this.#guess.type), aiEnabled: getAiConfig().enabled };
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
    this.#controller?.abort();
    return super.close(options);
  }

  static async #onSubmit(event, form, formData) {
    await this.#analyze(formData.object);
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
        type, value, subtype, replace: Boolean(replace), signal: this.#controller.signal
      });
      if (this.#controller.signal.aborted) return;
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
      // The window may have been closed during the analysis: there is nothing left to re-enable
      if (!this.element) return;
      this.element.classList.remove("busy");
      for (const control of this.element.querySelectorAll("button, select")) control.disabled = false;
    }
  }
}
