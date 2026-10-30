/** Public API: `game.modules.get("item-configurator").api` (C18). */
import { MODULE_ID } from "../constants.mjs";
import { buttonState, canConfigure } from "../core/access.mjs";
import { guessType } from "../core/types.mjs";
import { playersAllowed } from "../settings.mjs";
import { quickPlan, runAnalysis } from "./analysis.mjs";
import { applyChangeSet } from "./apply.mjs";

/**
 * Same access rules as the sheet button (C1, C2): throws a localized error when the user may not configure the item.
 * @param {Item} item
 */
function assertAllowed(item) {
  const allowed = buttonState({
    type: item?.type,
    canConfigure: canConfigure({ isGM: game.user.isGM, isOwner: Boolean(item?.isOwner), allowPlayers: playersAllowed() }),
    packLocked: Boolean(item?.compendium?.locked)
  });
  if (allowed === "hidden") throw new Error(game.i18n.localize(`${MODULE_ID}.errors.notAllowed`));
  if (allowed === "disabled") throw new Error(game.i18n.localize(`${MODULE_ID}.Button.LockedPack`));
}

/**
 * Open the module's interface on an item, exactly as the sheet button does: the type window, then the preview.
 * @param {Item} item
 * @returns {Promise<TypeDialog>} The rendered type window (resolves once it is displayed).
 * @throws {Error} When the user may not configure the item (same rules and messages as `configure`).
 */
export async function open(item) {
  assertAllowed(item);
  const { TypeDialog } = await import("./type-dialog.mjs");
  const dialog = new TypeDialog({ item });
  await dialog.render({ force: true });
  return dialog;
}

/**
 * Analyze an item's description with the same path as the preview window, and optionally apply the result.
 * @param {Item} item
 * @param {object} [options]
 * @param {string} [options.type]      Target item type (defaults to a guess from the text and the current type).
 * @param {string} [options.subtype]   Target `system.type.value` (e.g. "martialM", "potion").
 * @param {string} [options.variant]   Target `system.type.subtype` (consumable sub-subtype, e.g. poison kind).
 * @param {boolean} [options.useAI]    Defaults to the "Use the local AI" setting.
 * @param {boolean} [options.replace=false]  Same meaning as the "Replace existing" box.
 * @param {boolean} [options.apply=false]    Write the change set to the item.
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ proposal: object, changeSet: object, applied: boolean }>}
 * @throws {Error} When the user may not configure the item.
 */
export async function configure(item, { type, subtype, variant, useAI, replace = false, apply = false, signal } = {}) {
  assertAllowed(item);

  const guess = guessType(await quickPlan(item), { type: item.type, system: item._source.system, name: item.name });
  const sameType = !type || type === guess.type;
  const target = {
    type: type ?? guess.type,
    value: subtype ?? (sameType ? guess.value : ""),
    subtype: variant ?? ((subtype === undefined) && sameType ? guess.subtype : "")
  };
  const { proposal, changeSet } = await runAnalysis(item, { ...target, replace, useAI, signal });
  let applied = false;
  if (apply && !changeSet.empty) {
    await applyChangeSet(item, changeSet);
    applied = true;
  }
  return { proposal, changeSet, applied };
}
