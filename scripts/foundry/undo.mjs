/** Restoration of an item from its undo snapshot (C14). */
import { MODULE_ID } from "../constants.mjs";
import { UNDO_FLAG, modifiedSince, restoreOps } from "../core/snapshot.mjs";

/** The undo snapshot stored on the item, if any. */
export const getSnapshot = (item) => item.getFlag(MODULE_ID, UNDO_FLAG) ?? null;

/** Write the snapshot back: type, system (`_replace`), effects with their original ids, and drop the flag. */
export async function restoreItem(item, snapshot) {
  const ops = restoreOps(snapshot, item.toObject());
  await item.update({
    type: ops.update.type,
    system: _replace(ops.update.system),
    [`flags.${MODULE_ID}.${UNDO_FLAG}`]: _del
  });
  const stale = ops.deleteEffectIds.filter((id) => item.effects.has(id));
  if (stale.length) await item.deleteEmbeddedDocuments("ActiveEffect", stale);
  if (ops.createEffects.length) await item.createEmbeddedDocuments("ActiveEffect", ops.createEffects, { keepId: true });
}

/**
 * Undo the last configuration of an item, after confirmation when the item changed since.
 * @param {Item} item
 * @returns {Promise<boolean>}  Whether the item was restored.
 */
export async function undoLastConfiguration(item) {
  const snapshot = getSnapshot(item);
  if (!snapshot) return false;
  if (modifiedSince(snapshot, item.toObject())) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize(`${MODULE_ID}.Undo.Title`) },
      content: `<p>${game.i18n.localize(`${MODULE_ID}.Undo.Modified`)}</p>`,
      rejectClose: false
    });
    if (!confirmed) return false;
  }
  await restoreItem(item, snapshot);
  ui.notifications.info(game.i18n.format(`${MODULE_ID}.Undo.Done`, { name: item.name }));
  return true;
}
