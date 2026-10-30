/** Preview of the proposed changes, grouped; nothing is written before "Apply" (C12, C13). */
import { MODULE_ID } from "../constants.mjs";
import { applySelection } from "../core/changes.mjs";
import { fingerprint } from "./analysis.mjs";
import { applyChangeSet } from "./apply.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const GROUPS = ["details", "activities", "effects"];
/** `why` values of a `fieldRemoved` correction -> `Claude.Why.*` keys. */
const WHY = { "missing": "missing", "duplicate": "duplicate", "not an object": "notAnObject", "not an array": "notAnArray" };

/**
 * Localize a library descriptor `{ key, data }` (or a plain string). A `null` / `undefined` placeholder value is an
 * absent detail ("Weapon: {category} {baseItem}" for a weapon without category), not the word "null": it is blanked
 * and the spacing collapsed.
 */
function describe(label) {
  if (!label) return "";
  if (typeof label === "string") return game.i18n.has(label) ? game.i18n.localize(label) : label;
  const data = Object.fromEntries(Object.entries(label.data ?? {}).map(([k, v]) => [k, v ?? ""]));
  const suffix = refine(label.key, data);
  return (game.i18n.format(label.key, data) + suffix).replace(/\s{2,}/g, " ").replace(/\s+([,:;)])/g, "$1").trim()
    .replace(/[,:;]$/, "");
}

/** Localized label of a dnd5e configuration entry (`{ label }` or a plain string), or null. */
function configLabel(table, key) {
  const def = key ? table?.[key] : null;
  if (!def) return null;
  const label = typeof def === "string" ? def : def.label;
  return label ? game.i18n.localize(label) : null;
}

/**
 * dnd5e keys the library leaves in a descriptor, shown with the dnd5e label instead ("lr" -> "Long Rest"); the
 * healing type of a heal line that is not plain healing ("Temporary HP") is appended, so that the preview says it.
 * @param {string} key    Descriptor key.
 * @param {object} data   Placeholder values (updated in place).
 * @returns {string}  Text appended after the formatted label ("" when nothing).
 */
function refine(key, data) {
  const config = CONFIG.DND5E ?? {};
  if (key === "dnd5e-text-parser.Describe.Uses") data.period = configLabel(config.limitedUsePeriods, data.period) ?? data.period;
  if (key === "dnd5e-text-parser.Describe.Heal" && data.type && data.type !== "healing") {
    const type = configLabel(config.healingTypes, data.type);
    if (type) return ` (${type})`;
  }
  return "";
}

function stringify(value) {
  if (value === undefined || value === null || value === "") return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Localized label of a dnd5e item subtype key (`martialM`, `heavy`, `potion`...), or the key itself. */
function subtypeLabel(key) {
  const config = CONFIG.DND5E ?? {};
  for (const map of [config.weaponTypes, config.equipmentTypes, config.consumableTypes, config.toolTypes, config.lootTypes]) {
    const def = map?.[key];
    if (def) return typeof def === "string" ? def : (def.label ?? String(key));
  }
  return stringify(key);
}

const localize = (key, data) => (game.i18n.has(key) ? game.i18n.format(key, data ?? {}) : "");

/**
 * Text of a correction or rejection of Claude's answer (`{ ref, field, reason, data }`): the element, the field and the
 * localized reason (`Claude.Reason.<code>`, with its data; the `why` of a removed field is localized too).
 */
function reasonText(entry) {
  const data = { ...(entry.data ?? {}) };
  if (data.why) data.why = localize(`${MODULE_ID}.Claude.Why.${WHY[data.why] ?? data.why}`) || data.why;
  const reason = localize(`${MODULE_ID}.Claude.Reason.${entry.reason}`, data) || String(entry.reason ?? "");
  const where = [entry.ref, entry.field].filter(Boolean).join(".");
  return where ? `${where}: ${reason}` : reason;
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
  /** Fingerprint of the item source the change set was computed on. */
  #fingerprint;
  /** The item changed while the preview was open and the change set was recomputed: shown once. */
  #stale = false;
  /** A recomputation is running: clicks are ignored until it is done (one at a time). */
  #busy = false;
  /** Checkboxes and "to check" choices made in the preview, applied by `applySelection` on "Apply". */
  #selection = { selected: {}, choices: {} };

  /**
   * @param {object} config
   * @param {Item} config.item
   * @param {object} config.proposal
   * @param {object} config.changeSet
   * @param {(replace: boolean, source?: object) => Promise<object>} config.rebuild   Recompute the change set (Replace
   *   box, or item edited meanwhile) against the item as it is now.
   * @param {string} [config.fingerprint]   `fingerprint()` of the source the change set was computed on.
   * @param {boolean} [config.replace]
   * @param {number} [config.started]   `performance.now()` when the analysis was requested (M4).
   */
  constructor({
    item, proposal, changeSet, rebuild, fingerprint: seen, replace = false, started = performance.now(), ...options
  } = {}) {
    super(options);
    this.#item = item;
    this.#proposal = proposal;
    this.#changeSet = changeSet;
    this.#rebuild = rebuild;
    this.#fingerprint = seen ?? fingerprint(item.toObject());
    this.#replace = replace;
    this.#started = started;
  }

  /** @override */
  get title() {
    return game.i18n.format(`${MODULE_ID}.Preview.Heading`, { name: this.#item.name });
  }

  /** Checkbox state of an entry: the user's choice, else the change set's. */
  #isSelected(entry) {
    return this.#selection.selected[entry.id] ?? entry.selected !== false;
  }

  /** Chosen reading of a "to check" item: the user's choice, else the proposed one. */
  #choiceOf(item) {
    return this.#selection.choices[item.id] ?? item.choice;
  }

  /** @override */
  async _prepareContext() {
    const cs = this.#changeSet;
    const claudeMode = this.#proposal.mode === "claude";
    const mark = (key) => game.i18n.localize(`${MODULE_ID}.Preview.Check.${key}`);
    const entryView = (entry) => ({
      id: entry.id,
      action: entry.action,
      actionLabel: game.i18n.localize(`${MODULE_ID}.Preview.Action.${entry.action}`),
      label: entry.chosen
        ? describe({ ...entry.label, data: { ...entry.label.data, value: subtypeLabel(entry.value) } })
        : describe(entry.label),
      value: entry.chosen ? subtypeLabel(entry.value) : stringify(entry.value),
      previous: entry.chosen && entry.previous ? subtypeLabel(entry.previous) : stringify(entry.previous),
      raw: entry.raw,
      ai: entry.origin === "fallback",
      claude: entry.origin === "claude",
      base: entry.origin === "base",
      keep: entry.action === "keep",
      remove: entry.action === "remove",
      // One checkbox per proposed change (not for what is kept or removed)
      selectable: Boolean(entry.refs) && ["add", "set", "replace"].includes(entry.action),
      selected: this.#isSelected(entry),
      // Cross-check and reading marks (Claude first)
      agree: entry.check === "agree",
      conflict: entry.check === "conflict",
      claudeOnly: entry.check === "claudeOnly",
      rulesOnly: entry.check === "rulesOnly",
      inferred: Boolean(entry.inferred?.length),
      certainty: ["medium", "low"].includes(entry.certainty) ? mark(`Certainty.${entry.certainty}`) : "",
      low: entry.certainty === "low"
    });
    const groups = GROUPS.map((group) => ({
      group,
      title: game.i18n.localize(`${MODULE_ID}.Preview.Group.${group}`),
      entries: (cs.entries ?? []).filter((entry) => entry.group === group).map(entryView)
    })).filter((g) => g.entries.length);

    // "To check": the facts Claude and the rules read differently, with a choice between the two values
    const labelOf = new Map((cs.entries ?? []).map((entry) => [entry.id, entry]));
    const checks = (cs.check ?? []).map((item) => ({
      id: item.id,
      family: describe(item.label),
      entry: labelOf.has(item.entryId) ? entryView(labelOf.get(item.entryId)).label : "",
      critical: Boolean(item.critical),
      claude: item.claude?.display ?? "",
      rules: item.rules?.display ?? "",
      rulesRaw: item.rules?.raw ?? "",
      claudeChosen: this.#choiceOf(item) === "claude",
      rulesChosen: this.#choiceOf(item) === "rules"
    }));

    const status = this.#proposal.ai?.status ?? "off";
    const model = this.#proposal.ai?.model ?? "";
    let ai;
    if (status !== "ok") {
      const known = game.i18n.has(`${MODULE_ID}.Preview.Ai.${status}`) ? status : "error";
      ai = { text: game.i18n.localize(`${MODULE_ID}.Preview.Ai.${known}`), rulesOnly: true };
    } else if (claudeMode) ai = { text: game.i18n.format(`${MODULE_ID}.Preview.Ai.claude`, { model }), rulesOnly: false };
    else ai = { text: game.i18n.format(`${MODULE_ID}.Preview.Ai.ok`, { model }), rulesOnly: false };

    // What the validation corrected or discarded in Claude's answer, with the reason
    const claude = this.#proposal.claude;
    const corrected = (claude?.corrections ?? []).map((c) => game.i18n.format(`${MODULE_ID}.Claude.Corrected`, { what: reasonText(c) }));
    const discarded = (claude?.rejections ?? []).map((r) => game.i18n.format(`${MODULE_ID}.Claude.Rejected`, { what: reasonText(r) }));

    const typeChange = cs.typeChange
      ? game.i18n.format(`${MODULE_ID}.Preview.TypeChange`, {
        from: game.i18n.localize(`${MODULE_ID}.Type.${cs.typeChange.from}`),
        to: game.i18n.localize(`${MODULE_ID}.Type.${cs.typeChange.to}`)
      })
      : null;
    const removals = (cs.entries ?? []).filter((entry) => entry.action === "remove").length;

    const stale = this.#stale;
    this.#stale = false;

    return {
      groups,
      checks,
      claudeMode,
      corrected,
      discarded,
      typeChange,
      ai,
      stale,
      replace: this.#replace,
      removals,
      unrecognized: (cs.unrecognized ?? []).map((u) => u.text ?? u.raw ?? stringify(u)),
      rejected: (cs.rejected ?? []).map((entry) => ({ label: describe(entry.label), raw: entry.raw })),
      // The clause itself is the information: the library's note text would only repeat it
      notAutomated: (cs.notAutomated ?? []).map((entry) => ({
        raw: entry.raw || describe(entry.label), ai: entry.origin === "fallback", claude: entry.origin === "claude"
      })),
      flavor: (cs.flavor ?? []).map((f) => f.text),
      empty: Boolean(cs.empty)
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // Checkboxes and "to check" choices: remembered, applied on "Apply" (no recomputation needed)
    for (const box of this.element.querySelectorAll(".entry-select")) {
      box.addEventListener("change", () => {
        this.#selection.selected[box.dataset.entry] = box.checked;
        box.closest(".entry")?.classList.toggle("unselected", !box.checked);
      });
    }
    for (const radio of this.element.querySelectorAll(".check-choice")) {
      radio.addEventListener("change", () => {
        if (radio.checked) this.#selection.choices[radio.dataset.check] = radio.value;
      });
    }
    this.element.querySelector('[name="replace"]')?.addEventListener("change", async (event) => {
      const box = event.currentTarget;
      if (this.#busy) {
        box.checked = this.#replace;
        return;
      }
      const previous = this.#replace;
      this.#replace = box.checked;
      if (!(await this.#recompute())) this.#replace = previous;
    });
    if (!this.#notified) {
      this.#notified = true;
      const durationMs = performance.now() - this.#started;
      Hooks.callAll(`${MODULE_ID}.previewReady`, { item: this.#item, proposal: this.#proposal, durationMs });
    }
  }

  /**
   * Recompute the change set against the item as it is now, then render. One recomputation at a time: the controls
   * are disabled meanwhile and a click that slips through is ignored. A failure keeps the previous change set.
   * @param {object} [options]
   * @param {object} [options.source]   `item.toObject()` already read by the caller.
   * @param {boolean} [options.stale]   Show the "item modified meanwhile" warning.
   * @returns {Promise<boolean>}  Whether the change set was recomputed.
   */
  async #recompute({ source = this.#item.toObject(), stale = false } = {}) {
    if (this.#busy) return false;
    this.#busy = true;
    this.#setDisabled(true);
    try {
      this.#changeSet = await this.#rebuild(this.#replace, source);
      this.#fingerprint = fingerprint(source);
      this.#stale = stale;
      return true;
    } catch (err) {
      console.error(`${MODULE_ID} | preview recomputation failed`, err);
      ui.notifications.error(game.i18n.format(`${MODULE_ID}.errors.previewFailed`, { error: err.message }));
      return false;
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  #setDisabled(disabled) {
    for (const control of this.element?.querySelectorAll("button, input") ?? []) control.disabled = disabled;
  }

  static async #onApply() {
    if (this.#busy || this.#changeSet.empty) return;
    // The item may have been edited while the preview was open (the window is not modal): what the user saw is no
    // longer what would be written. Recompute on the current state and ask again instead of applying (C13).
    const source = this.#item.toObject();
    if (fingerprint(source) !== this.#fingerprint) {
      await this.#recompute({ source, stale: true });
      return;
    }
    this.#busy = true;
    this.#setDisabled(true);
    try {
      // Only what is checked, with the chosen reading of each "to check" item
      await applyChangeSet(this.#item, applySelection(this.#changeSet, this.#selection));
      ui.notifications.info(game.i18n.format(`${MODULE_ID}.Messages.Applied`, { name: this.#item.name }));
      await this.close();
    } catch {
      // applyChangeSet already restored the item and notified
      this.#setDisabled(false);
    } finally {
      this.#busy = false;
    }
  }

  static async #onCancel() {
    await this.close();
  }
}
