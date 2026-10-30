import { SUPPORTED_TYPES } from "./types.mjs";

/**
 * Whether the current user may configure items (C1).
 * @param {object} state
 * @param {boolean} state.isGM            Is the user a Game Master?
 * @param {boolean} state.isOwner         Does the user own the item (an embedded item inherits its actor's ownership)?
 * @param {boolean} state.allowPlayers    Value of the `allowPlayers` world setting.
 * @returns {boolean}
 */
export function canConfigure({ isGM, isOwner, allowPlayers }) {
  if (isGM) return true;
  return Boolean(allowPlayers && isOwner);
}

/**
 * State of the sheet header button (C1, C2).
 * @param {object} state
 * @param {string} state.type                  Item type.
 * @param {boolean} state.canConfigure         Result of `canConfigure`.
 * @param {boolean} [state.packLocked=false]   Is the item in a locked compendium?
 * @returns {"hidden"|"disabled"|"enabled"}
 */
export function buttonState({ type, canConfigure, packLocked = false }) {
  if (!canConfigure || !SUPPORTED_TYPES.includes(type)) return "hidden";
  return packLocked ? "disabled" : "enabled";
}
