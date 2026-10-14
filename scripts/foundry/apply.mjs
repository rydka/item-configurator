/** Validation against the dnd5e data model, and application of a change set. */
import { MODULE_ID } from "../constants.mjs";
import { pruneChangeSet } from "../core/changes.mjs";
import { ID_PATTERN } from "../core/paths.mjs";
import { UNDO_FLAG, makeSnapshot } from "../core/snapshot.mjs";
import { restoreItem } from "./undo.mjs";

const flagPath = `flags.${MODULE_ID}.${UNDO_FLAG}`;

const invalidEntry = (group, path, error) => ({
  id: `invalid:${path}`, group, action: "remove", raw: "", origin: "rules",
  label: { key: `${MODULE_ID}.Preview.Invalid`, data: { path, error } }
});

function check(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return String(err?.message ?? err).split("\n")[0];
  }
}

/**
 * Dry-run the change set against the dnd5e data model (strict). Whatever is invalid is removed from the change set
 * and reported in `rejected` (it is never applied), and the preview entries that described it are dropped.
 * Document ids are checked here too: `item.validate` does not notice an invalid activity `_id`.
 * @param {Item} item
 * @param {object} changeSet
 * @returns {Promise<object>}  A new change set.
 */
export async function validateChangeSet(item, changeSet) {
  const result = foundry.utils.deepClone(changeSet);
  result.rejected ??= [];
  // After a type change the changes must be checked against the target type's model.
  const model = result.typeChange
    ? new Item.implementation({ name: item.name, type: result.typeChange.to, system: foundry.utils.deepClone(result.typeChange.system) })
    : item;

  const removed = { paths: [], activities: [], effects: [] };
  const badId = (id) => (ID_PATTERN.test(String(id ?? "")) ? null : `invalid document id "${id}"`);

  for (const [path, value] of Object.entries(result.systemPatch ?? {})) {
    const error = check(() => model.validate({ changes: { [path]: value }, strict: true }));
    if (!error) continue;
    delete result.systemPatch[path];
    removed.paths.push(path);
    result.rejected.push(invalidEntry("details", path, error));
  }
  result.activities.add = (result.activities?.add ?? []).filter((activity) => {
    const path = `system.activities.${activity._id}`;
    const error = badId(activity._id) ?? check(() => model.validate({ changes: { [path]: activity }, strict: true }));
    if (error) {
      removed.activities.push(activity._id);
      result.rejected.push(invalidEntry("activities", path, error));
    }
    return !error;
  });
  result.effects.add = (result.effects?.add ?? []).filter((effect) => {
    const error = badId(effect._id) ?? check(() => new ActiveEffect.implementation(effect, { parent: item, strict: true }));
    if (error) {
      removed.effects.push(effect._id);
      result.rejected.push(invalidEntry("effects", effect.name ?? effect._id ?? "effect", error));
    }
    return !error;
  });
  return pruneChangeSet(result, removed);
}

const created = (data) => ({ ...data, flags: { ...data.flags, [MODULE_ID]: { ...data.flags?.[MODULE_ID], created: true } } });

/**
 * Write a change set to the item: snapshot, optional in-place type conversion, then activities and effects.
 * On failure the item is restored from the snapshot and the error is rethrown.
 * @param {Item} item
 * @param {object} changeSet
 * @returns {Promise<Item>}
 */
export async function applyChangeSet(item, changeSet) {
  const snapshot = makeSnapshot(item.toObject(), game.user.id, Date.now(), game.modules.get(MODULE_ID)?.version ?? null);
  await item.update({ [flagPath]: snapshot });
  try {
    if (changeSet.typeChange) {
      await item.update({ type: changeSet.typeChange.to, system: _replace(changeSet.typeChange.system) });
    }

    const update = { ...changeSet.systemPatch };
    for (const activity of changeSet.activities?.add ?? []) update[`system.activities.${activity._id}`] = created(activity);
    for (const id of changeSet.activities?.remove ?? []) {
      if (item._source.system.activities?.[id]) update[`system.activities.${id}`] = _del;
    }
    if (Object.keys(update).length) await item.update(update);

    const removeEffects = (changeSet.effects?.remove ?? []).filter((id) => item.effects.has(id));
    if (removeEffects.length) await item.deleteEmbeddedDocuments("ActiveEffect", removeEffects);
    if (changeSet.effects?.add?.length) {
      await item.createEmbeddedDocuments("ActiveEffect", changeSet.effects.add.map(created), { keepId: true });
    }
    // Reference time for "modified since the configuration" (see undo.mjs).
    await item.update({ [`${flagPath}.at`]: Date.now() });
  } catch (err) {
    console.error(`${MODULE_ID} | configuration failed, restoring the item`, err);
    await restoreItem(item, snapshot).catch((e) => console.error(`${MODULE_ID} | restore failed`, e));
    ui.notifications.error(game.i18n.format(`${MODULE_ID}.errors.applyFailed`, { error: err.message }));
    throw err;
  }
  Hooks.callAll(`${MODULE_ID}.applied`, item);
  return item;
}
