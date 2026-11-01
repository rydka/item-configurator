/** Flag key (in the module scope) of the undo snapshot. */
export const UNDO_FLAG = "undo";

/** Snapshot format version. */
export const SNAPSHOT_VERSION = 1;

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
};

/** Compare two effect sources ignoring `_stats` and key order. */
function sameEffect(a, b) {
  const canon = (effect) => {
    const copy = { ...effect };
    delete copy._stats;
    return JSON.stringify(sortKeys(copy));
  };
  return canon(a) === canon(b);
}

/**
 * Capture what is needed to restore an item exactly as it was (C14).
 * @param {object} source        `item.toObject()` before the configuration.
 * @param {string} userId        User who configures.
 * @param {number} [now]         Timestamp (ms).
 * @param {string} [version]     Module version.
 * @returns {{ v: number, userId: string, at: number, version: string|null,
 *   source: { type: string, system: object, effects: object[] } }}
 *   `after` (content fingerprint once the configuration is written) is added by the caller, see `contentFingerprint`.
 */
export function makeSnapshot(source, userId, now = Date.now(), version = null) {
  return {
    v: SNAPSHOT_VERSION,
    userId,
    at: now,
    version,
    source: structuredClone({ type: source.type, system: source.system ?? {}, effects: source.effects ?? [] })
  };
}

/**
 * Identity of what a restore would discard: type, system and effects (without `_stats`, key order ignored). Written
 * in the snapshot (`after`) once the configuration is done, and compared at undo time; no clock involved.
 * @param {object} source  `item.toObject()`.
 * @returns {string}
 */
export function contentFingerprint(source) {
  const effects = (source?.effects ?? []).map((effect) => {
    const copy = { ...effect };
    delete copy._stats;
    return copy;
  });
  return JSON.stringify(sortKeys({ type: source?.type ?? null, system: source?.system ?? {}, effects }));
}

/**
 * Was the item modified after the configuration (to ask confirmation before undoing)? Compares the content
 * fingerprint recorded after the configuration (`snapshot.after`). Snapshots written before that marker existed
 * fall back to the item's `_stats.modifiedTime` against `snapshot.at`.
 * @param {object} snapshot
 * @param {object} currentSource  `item.toObject()`.
 * @returns {boolean}
 */
export function modifiedSince(snapshot, currentSource) {
  if (typeof snapshot.after === "string") return contentFingerprint(currentSource) !== snapshot.after;
  return (currentSource?._stats?.modifiedTime ?? 0) > snapshot.at;
}

/**
 * Compute the operations that restore the item from a snapshot.
 * The caller writes `update` with `restoreUpdate` of `update-ops.mjs` (`==system`, `-=undo`), deletes
 * `deleteEffectIds`, then creates `createEffects` with `{ keepId: true }`.
 * @param {object} snapshot
 * @param {object} currentSource  `item.toObject()` now.
 * @returns {{ update: { type: string, system: object }, deleteEffectIds: string[], createEffects: object[] }}
 */
export function restoreOps(snapshot, currentSource) {
  const saved = snapshot.source;
  const savedById = new Map(saved.effects.map((effect) => [effect._id, effect]));
  const currentById = new Map((currentSource?.effects ?? []).map((effect) => [effect._id, effect]));

  const deleteEffectIds = [];
  for (const [id, effect] of currentById) {
    const original = savedById.get(id);
    if (!original || !sameEffect(original, effect)) deleteEffectIds.push(id);
  }
  const createEffects = [];
  for (const [id, effect] of savedById) {
    const current = currentById.get(id);
    if (!current || !sameEffect(effect, current)) createEffects.push(structuredClone(effect));
  }
  return { update: { type: saved.type, system: structuredClone(saved.system) }, deleteEffectIds, createEffects };
}
