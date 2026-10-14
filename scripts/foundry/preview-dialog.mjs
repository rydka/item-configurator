/** Preview of the proposed changes, grouped; nothing is written before "Apply" (C12, C13). */
import { MODULE_ID } from "../constants.mjs";
import { applyChangeSet } from "./apply.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const GROUPS = ["details", "activities", "effects"];

/** Localize a library descriptor `{ key, data }` (or a plain string). */
function describe(label) {
  if (!label) return "";
  if (typeof label === "string") return game.i18n.has(label) ? game.i18n.localize(label) : label;
  return game.i18n.format(label.key, label.data ?? {});
}

function stringify(value) {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export class PreviewDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-preview-{id}`,
    classes: [MODULE_ID, "preview"],
    tag: "div",
    window: { title: `${MODULE_ID}.Preview.Title`, icon: "fa-solid fa-wand-magic-sparkles", resizable: true },
    position: { width: 560, height: "auto" },
    actions: { apply: PreviewDialog.#onApply, cancel: PreviewDialog.#onCancel }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/templates/preview.hbs`, scrollable: [".groups"] } };

  #item;
  #proposal;
  #changeSet;
  #rebuild;
  #replace;
  #started;
  #notified = false;

  /**
   * @param {object} config
   * @param {Item} config.item
   * @param {object} config.proposal
   * @param {object} config.changeSet
   * @param {(replace: boolean) => Promise<object>} config.rebuild   Recompute the change set for the Replace box.
   * @param {boolean} [config.replace]
   * @param {number} [config.started]   `performance.now()` when the analysis was requested (M4).
   */
  constructor({ item, proposal, changeSet, rebuild, replace = false, started = performance.now(), ...options } = {}) {
    super(options);
    this.#item = item;
    this.#proposal = proposal;
    this.#changeSet = changeSet;
    this.#rebuild = rebuild;
    this.#replace = replace;
    this.#started = started;
  }

  /** @override */
  get title() {
    return game.i18n.format(`${MODULE_ID}.Preview.Heading`, { name: this.#item.name });
  }

  /** @override */
  async _prepareContext() {
    const cs = this.#changeSet;
    const entryView = (entry) => ({
      id: entry.id,
      action: entry.action,
      actionLabel: game.i18n.localize(`${MODULE_ID}.Preview.Action.${entry.action}`),
      label: describe(entry.label),
      value: stringify(entry.value),
      previous: stringify(entry.previous),
      raw: entry.raw,
      ai: entry.origin === "fallback",
      base: entry.origin === "base",
      keep: entry.action === "keep",
      remove: entry.action === "remove"
    });
    const groups = GROUPS.map((group) => ({
      group,
      title: game.i18n.localize(`${MODULE_ID}.Preview.Group.${group}`),
      entries: (cs.entries ?? []).filter((entry) => entry.group === group).map(entryView)
    })).filter((g) => g.entries.length);

    const status = this.#proposal.ai?.status ?? "off";
    const ai = ["off", "unreachable", "timeout", "error"].includes(status)
      ? { text: game.i18n.localize(`${MODULE_ID}.Preview.Ai.${status}`), rulesOnly: true }
      : { text: game.i18n.format(`${MODULE_ID}.Preview.Ai.ok`, { model: this.#proposal.ai?.model ?? "" }), rulesOnly: false };

    const typeChange = cs.typeChange
      ? game.i18n.format(`${MODULE_ID}.Preview.TypeChange`, {
        from: game.i18n.localize(`${MODULE_ID}.Type.${cs.typeChange.from}`),
        to: game.i18n.localize(`${MODULE_ID}.Type.${cs.typeChange.to}`)
      })
      : null;
    const removals = (cs.entries ?? []).filter((entry) => entry.action === "remove").length;

    return {
      groups,
      typeChange,
      ai,
      replace: this.#replace,
      removals,
      unrecognized: (cs.unrecognized ?? []).map((u) => u.text ?? u.raw ?? stringify(u)),
      rejected: (cs.rejected ?? []).map((entry) => ({ label: describe(entry.label), raw: entry.raw })),
      empty: Boolean(cs.empty)
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[name="replace"]')?.addEventListener("change", async (event) => {
      this.#replace = event.currentTarget.checked;
      this.#changeSet = await this.#rebuild(this.#replace);
      this.render();
    });
    if (!this.#notified) {
      this.#notified = true;
      const durationMs = performance.now() - this.#started;
      Hooks.callAll(`${MODULE_ID}.previewReady`, { item: this.#item, proposal: this.#proposal, durationMs });
    }
  }

  static async #onApply() {
    if (this.#changeSet.empty) return;
    for (const button of this.element.querySelectorAll("button")) button.disabled = true;
    try {
      await applyChangeSet(this.#item, this.#changeSet);
      ui.notifications.info(game.i18n.format(`${MODULE_ID}.Messages.Applied`, { name: this.#item.name }));
      await this.close();
    } catch {
      for (const button of this.element.querySelectorAll("button")) button.disabled = false;
    }
  }

  static async #onCancel() {
    await this.close();
  }
}
