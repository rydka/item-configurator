/**
 * Update payloads of the Foundry v13 document API (pure, testable). v13 has no forced-replacement or deletion
 * operators (the v14 globals): a whole-field replacement is written with the `==` prefix (`foundry.utils.mergeObject`;
 * dnd5e 5.3.3 changes an item type the same way, `migration.mjs`), and a key is removed with the `-=` prefix and a
 * `null` value (dnd5e 5.3.3 `Item5e#deleteActivity`: `system.activities.-=<id>`).
 */
import { MODULE_ID } from "../constants.mjs";
import { UNDO_FLAG } from "./snapshot.mjs";

/**
 * Change the type of an item in place, replacing its `system` entirely.
 * @param {string} type
 * @param {object} system
 * @returns {{ type: string, "==system": object }}
 */
export function typeChangeUpdate(type, system) {
  return { type, "==system": system };
}

/**
 * Remove an activity from `system.activities`.
 * @param {string} id
 * @returns {Record<string, null>}  `{ "system.activities.-=<id>": null }`
 */
export function activityDeletionUpdate(id) {
  return { [`system.activities.-=${id}`]: null };
}

/**
 * Write an undo snapshot back (`restoreOps` of `snapshot.mjs`): type, whole `system`, and drop the undo flag.
 * @param {{ update: { type: string, system: object } }} ops
 * @param {string} [moduleId]
 * @returns {object}
 */
export function restoreUpdate(ops, moduleId = MODULE_ID) {
  return { ...typeChangeUpdate(ops.update.type, ops.update.system), [`flags.${moduleId}.-=${UNDO_FLAG}`]: null };
}
