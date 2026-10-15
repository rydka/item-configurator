/**
 * Pure computation of the change set: the proposal of `analyze()` compared with the existing item, either filling
 * what is empty ("merge") or replacing group by group ("replace"). No Foundry global; the parser is injected.
 *
 * ChangeSet = {
 *   typeChange: { from, to, system } | null,   // in-place conversion; `system` = fields carried over
 *   systemPatch: { "system.x.y": value },       // applied after the conversion
 *   activities: { add: object[], remove: string[] },
 *   effects: { add: object[], remove: string[] },
 *   entries: Entry[],                           // what the preview shows
 *   unrecognized: { text }[], rejected: Entry[], empty: boolean
 * }
 * Entry = { id, group: "details"|"activities"|"effects", action: "add"|"set"|"replace"|"remove"|"keep",
 *   label: { key, data } | string, value, previous, raw, origin: "rules"|"fallback"|"base",
 *   derived?: boolean, chosen?: boolean, refs?: { paths?, activities?, effects? } }
 * `derived` entries come from the chosen type, the base item or a deduction, not from a sentence of the text.
 * `chosen` entries are the type / subtype picked in the type window (`value` and `previous` are dnd5e type keys).
 */
import { carryOverSystem } from "./convert.mjs";
import { clone, getPath, leaves, same, setPath } from "./paths.mjs";

/** Item types without activities. */
export const NO_ACTIVITY_TYPES = ["loot", "container"];

const FIELD_KEY = "dnd5e-text-parser.Describe.Field";
const NOTE_UNRECOGNIZED = "dnd5e-text-parser.Note.Unrecognized";
/** Fields where a stored 0 is the default, not a value. */
const ZERO_IS_BLANK = ["weight.value", "price.value"];
const DAMAGE_PARTS = ["damage.base", "damage.versatile"];

const toArray = (value) => (value instanceof Set ? [...value] : (Array.isArray(value) ? value : []));

/** Short readable form of a value, for labels. */
export function summarize(value) {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.map(summarize).join(", ");
  if (typeof value === "object") {
    if (value.denomination) {
      const dice = `${value.number ?? 1}d${value.denomination}`;
      return [dice, value.bonus ? `+ ${value.bonus}` : "", ...toArray(value.types)].filter(Boolean).join(" ");
    }
    return JSON.stringify(value);
  }
  return String(value);
}

/** A stored value that is only a default: empty, `false`, or a 0 in a field where 0 is the default. */
function isBlank(parser, path, value) {
  return parser.isEmpty(value) || value === false || (value === 0 && ZERO_IS_BLANK.includes(path));
}

/** Copy of the existing system where default damage parts (no dice) are emptied, so they do not count as filled. */
function normalizedPrior(system) {
  const prior = clone(system ?? {});
  for (const path of DAMAGE_PARTS) {
    const part = getPath(prior, path);
    if (part && !part.denomination && !part.custom?.enabled && !part.bonus) setPath(prior, path, {});
  }
  return prior;
}

const damageSignature = (parts) => toArray(parts).map((p) => [
  p.number ?? "", p.denomination ?? "", String(p.bonus ?? ""), toArray(p.types).sort().join(",")
].join(":"));

/** Identity of an activity for the purpose of "is it already there?". */
export function activitySignature(activity) {
  return JSON.stringify([
    activity.type,
    activity.activation?.type ?? "",
    damageSignature(activity.damage?.parts),
    activity.healing ? damageSignature([activity.healing]) : [],
    toArray(activity.save?.ability).sort(),
    String(activity.save?.dc?.formula ?? ""),
    activity.spell?.uuid ?? "",
    activity.attack?.type?.value ?? "",
    String(activity.attack?.bonus ?? "")
  ]);
}

/** Identity of an effect source. */
export function effectSignature(effect) {
  const changes = toArray(effect.system?.changes).map((c) => `${c.key}|${c.type}|${c.value}`).sort();
  return JSON.stringify([Boolean(effect.transfer), changes]);
}

const activityLabel = (activity) => ({
  key: "item-configurator.Preview.ExistingActivity", data: { name: activity.name || activity.type, type: activity.type }
});
const effectLabel = (effect) => ({ key: "item-configurator.Preview.ExistingEffect", data: { name: effect.name ?? "" } });
const fieldLabel = (path, value) => ({ key: FIELD_KEY, data: { path, value: summarize(value) } });
/** The type / subtype picked in the type window: that explicit choice is the consent to replace the stored one. */
const chosenLabel = (path, value) => ({ key: "item-configurator.Preview.Chosen", data: { path, value: summarize(value) } });

/**
 * The attack the library adds to every weapon, whatever the text says: it carries nothing the text stated, so it must
 * not count as something recognized (C16).
 */
const isDefaultAttack = (activity) => activity?.type === "attack" && !activity.damage?.parts?.length
  && !activity.attack?.flat && !activity.activation && !activity.range && !activity.target && !activity.effects?.length
  && !activity.consumption?.targets?.length;

/**
 * Descriptors the library may emit without a source passage, and where the fact comes from (C12): the header line
 * (`proposal.header`, see `core/header.mjs`), or the item name for a weapon / armor the library deduced from the
 * "+1" of the name ("Plate Armor +1").
 */
const HEADER_KEYS = {
  "dnd5e-text-parser.Describe.Rarity": ["raw"],
  "dnd5e-text-parser.Describe.Attunement": ["attunementRaw", "raw"],
  "dnd5e-text-parser.Describe.Armor": ["raw", "name"],
  "dnd5e-text-parser.Describe.Weapon": ["raw", "name"]
};

/** Source passage of a header-derived descriptor, or "". */
function headerRaw(key, { header, name }) {
  const fields = HEADER_KEYS[key];
  if (!fields) return "";
  const sources = { ...(header ?? {}), name: name ?? "" };
  return fields.map((field) => sources[field]).find(Boolean) ?? "";
}

/** Index `n` of a descriptor path such as `activities.2`. */
const indices = (paths, prefix) => (paths ?? []).filter((p) => p.startsWith(`${prefix}.`)).map((p) => Number(p.slice(prefix.length + 1)));

/**
 * Compare the proposal with the existing item.
 * @param {object} source          `item.toObject()`.
 * @param {object} proposal        Result of `analyze()`.
 * @param {object} options
 * @param {boolean} [options.replace=false]   "Replace existing": overwrite, group by group.
 * @param {object} options.parser            The `dnd5e-text-parser` API (`describe`, `isEmpty`).
 * @returns {object}  ChangeSet
 */
export function buildChangeSet(source, proposal, { replace = false, parser } = {}) {
  const { plan, target, translation: tr } = proposal;
  const typeChanged = source.type !== target.type;
  const typeChange = typeChanged
    ? { from: source.type, to: target.type, system: carryOverSystem(source.system, source.type, target.type) }
    : null;
  const existingSystem = typeChanged ? typeChange.system : (source.system ?? {});
  const prior = normalizedPrior(existingSystem);
  const entries = [];
  let counter = 0;
  const push = (entry) => entries.push({ id: `${entry.group}:${counter++}`, origin: "rules", raw: "", ...entry });
  const descriptors = parser.describe(plan).map((d) => (d.raw ? d : { ...d, raw: headerRaw(d.key, proposal) }));

  // ---- Details -------------------------------------------------------------------------------------------------
  const systemPatch = {};
  const candidates = [
    ...leaves(tr.system).map((leaf) => ({ ...leaf, origin: "rules" })),
    ...leaves(tr.base).map((leaf) => ({ ...leaf, origin: "base" }))
  ].map((leaf) => {
    const full = `system.${leaf.path}`;
    const chosen = tr.chosen.includes(full);
    const deduced = tr.deduced.find((d) => d.paths.some((p) => full === p || full.startsWith(`${p}.`))) ?? null;
    const existing = getPath(prior, leaf.path);
    let action = null;
    if (!same(existing, leaf.value)) {
      if (isBlank(parser, leaf.path, existing)) action = "set";
      else action = (replace || chosen) ? "replace" : "keep";
    }
    return { ...leaf, full, chosen, deduced, existing, action };
  }).filter((leaf) => leaf.action);

  for (const leaf of candidates) if (leaf.action !== "keep") systemPatch[leaf.full] = clone(leaf.value);

  const detailEntry = (label, cands, extra = {}) => {
    const changed = cands.filter((c) => c.action !== "keep");
    const kept = cands.filter((c) => c.action === "keep");
    const valueOf = (list, pick) => (list.length === 1 ? pick(list[0]) : Object.fromEntries(list.map((c) => [c.full, pick(c)])));
    if (changed.length) {
      const replaced = changed.filter((c) => c.action === "replace");
      push({
        group: "details", action: replaced.length ? "replace" : "set", label,
        value: valueOf(changed, (c) => c.value),
        previous: replaced.length ? valueOf(replaced, (c) => c.existing) : undefined,
        refs: { paths: changed.map((c) => c.full) }, ...extra
      });
    }
    if (kept.length) {
      push({
        group: "details", action: "keep", label,
        value: valueOf(kept, (c) => c.value), previous: valueOf(kept, (c) => c.existing), ...extra
      });
    }
  };

  const free = new Set(candidates.filter((c) => c.origin === "rules" && !c.chosen && !c.deduced));
  for (const d of descriptors.filter((descriptor) => descriptor.group === "details")) {
    const claimed = [...free].filter((c) => d.paths.some((p) => c.full === p || c.full.startsWith(`${p}.`)));
    claimed.forEach((c) => free.delete(c));
    if (claimed.length) detailEntry({ key: d.key, data: d.data }, claimed, { raw: d.raw, origin: d.origin });
  }
  // A leaf no descriptor claims: the "magical" property comes from the rarity of the header line (C12)
  for (const c of free) {
    detailEntry(fieldLabel(c.full, c.value), [c], c.full === "system.properties" ? { raw: proposal.header?.raw ?? "" } : {});
  }
  // Shown as a change with the previous value, even without "Replace existing" (the choice was explicit)
  for (const c of candidates.filter((x) => x.chosen)) detailEntry(chosenLabel(c.full, c.value), [c], { derived: true, chosen: true });
  for (const deduction of tr.deduced) {
    const cands = candidates.filter((c) => c.deduced === deduction);
    if (cands.length) detailEntry(deduction.label, cands, { derived: true });
  }
  const baseGroups = new Map();
  for (const c of candidates.filter((x) => x.origin === "base")) {
    const segments = c.path.split(".");
    const group = segments[0] === "damage" ? segments.slice(0, 2).join(".") : segments[0];
    baseGroups.set(group, [...(baseGroups.get(group) ?? []), c]);
  }
  for (const [group, cands] of baseGroups) {
    detailEntry(fieldLabel(`system.${group}`, getPath(tr.base, group)), cands, { derived: true, origin: "base" });
  }

  // ---- Activities ------------------------------------------------------------------------------------------------
  const noActivities = NO_ACTIVITY_TYPES.includes(target.type);
  const existingActivities = Object.values(source.system?.activities ?? {});
  const proposedActivities = noActivities ? [] : tr.activities;
  const hasProposedActivities = proposedActivities.some(Boolean);
  const removeExistingActivities = hasProposedActivities && replace;

  const existingEffects = source.effects ?? [];
  const hasProposedEffects = tr.effects.length > 0;
  const removeExistingEffects = hasProposedEffects && replace;

  // What is already there is not added again (merge mode only: in replace mode the old ones go)
  const activityDup = new Map();
  if (!removeExistingActivities && !typeChanged) {
    const known = new Map(existingActivities.map((a) => [activitySignature(a), a._id]));
    proposedActivities.forEach((a, i) => { if (a && known.has(activitySignature(a))) activityDup.set(i, known.get(activitySignature(a))); });
  }
  const effectDup = new Map();
  if (!removeExistingEffects) {
    const known = new Map(existingEffects.map((e) => [effectSignature(e), e._id]));
    tr.effects.forEach((e, i) => { if (known.has(effectSignature(e))) effectDup.set(i, known.get(effectSignature(e))); });
  }
  const effectIdRemap = new Map([...effectDup].map(([i, id]) => [tr.effects[i]._id, id]));

  const activityAdd = proposedActivities.map((a, i) => ({ a, i })).filter(({ a, i }) => a && !activityDup.has(i)).map(({ a }) => {
    const copy = clone(a);
    if (copy.effects?.length) copy.effects = copy.effects.map((e) => ({ ...e, _id: effectIdRemap.get(e._id) ?? e._id }));
    return copy;
  });
  const effectAdd = tr.effects.filter((e, i) => !effectDup.has(i)).map(clone);

  const rejected = [];
  if (noActivities) {
    for (const a of plan.activities ?? []) {
      rejected.push({
        id: `rejected:${counter++}`, group: "activities", action: "remove", raw: a.raw, origin: a.origin ?? "rules",
        label: { key: "item-configurator.Preview.NotApplicable", data: { what: a.name || a.kind, type: target.type } }
      });
    }
  }

  for (const d of descriptors.filter((descriptor) => descriptor.group === "activities")) {
    if (noActivities) continue;
    const list = indices(d.paths, "activities");
    const targets = list.filter((n) => proposedActivities[n]);
    if (!targets.length) continue;
    const fresh = targets.filter((n) => !activityDup.has(n));
    push({
      group: "activities", action: fresh.length ? "add" : "keep", label: { key: d.key, data: d.data }, raw: d.raw, origin: d.origin,
      ...(targets.every((n) => isDefaultAttack(proposedActivities[n])) ? { derived: true } : {}),
      ...(fresh.length ? { refs: { activities: fresh.map((n) => proposedActivities[n]._id) } } : {})
    });
  }

  // ---- Effects ---------------------------------------------------------------------------------------------------
  for (const d of descriptors.filter((descriptor) => descriptor.group === "effects")) {
    const list = tr.effectsAligned ? indices(d.paths, "effects").filter((n) => tr.effects[n]) : tr.effects.map((_, n) => n);
    if (!list.length) continue;
    const fresh = list.filter((n) => !effectDup.has(n));
    // Every line shows its source sentence, even when several lines (+1 AC, +1 saves) come from the same one (C12)
    push({
      group: "effects", action: fresh.length ? "add" : "keep", label: { key: d.key, data: d.data }, raw: d.raw, origin: d.origin,
      ...(fresh.length ? { refs: { effects: fresh.map((n) => tr.effects[n]._id) } } : {})
    });
  }

  // ---- Removals --------------------------------------------------------------------------------------------------
  const activityRemove = [];
  if (typeChanged || removeExistingActivities) {
    for (const activity of existingActivities) {
      if (!typeChanged) activityRemove.push(activity._id);
      push({ group: "activities", action: "remove", label: activityLabel(activity), previous: activity.name || activity.type });
    }
  }
  const effectRemove = [];
  if (removeExistingEffects) {
    for (const effect of existingEffects) {
      effectRemove.push(effect._id);
      push({ group: "effects", action: "remove", label: effectLabel(effect), previous: effect.name });
    }
  }

  // ---- Notes, rejected and unrecognized sentences ------------------------------------------------------------------
  const seen = new Set();
  for (const note of [...descriptors.filter((d) => d.group === null && d.key !== NOTE_UNRECOGNIZED), ...tr.notes]) {
    const fingerprint = JSON.stringify([note.key, note.data]);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    rejected.push({
      id: `rejected:${counter++}`, group: null, action: "remove", label: { key: note.key, data: note.data },
      raw: note.raw ?? "", origin: note.origin ?? "rules"
    });
  }
  const unrecognized = (plan.unrecognized ?? []).map(({ text }) => ({ text }));

  const changeSet = {
    typeChange, systemPatch,
    activities: { add: activityAdd, remove: activityRemove },
    effects: { add: effectAdd, remove: effectRemove },
    entries, unrecognized, rejected, empty: true
  };
  return refreshEmpty(changeSet);
}

/** `empty`: nothing was read from the text (what the type or the base item add on their own does not count). */
function refreshEmpty(changeSet) {
  changeSet.empty = !changeSet.entries.some((e) => ["add", "set", "replace"].includes(e.action) && !e.derived);
  return changeSet;
}

/**
 * Remove from a change set what the validation refused: the entries that only described those changes disappear
 * from the preview, and the activities no longer point to refused effects.
 * @param {object} changeSet
 * @param {{ paths?: string[], activities?: string[], effects?: string[] }} removed  Refused `system.*` paths, activity
 *   ids and effect ids (already taken out of `systemPatch`, `activities.add` and `effects.add` by the caller).
 * @returns {object}  The same change set, updated.
 */
export function pruneChangeSet(changeSet, removed = {}) {
  const gone = {
    paths: new Set(removed.paths ?? []), activities: new Set(removed.activities ?? []), effects: new Set(removed.effects ?? [])
  };
  changeSet.entries = changeSet.entries.filter((entry) => {
    if (!entry.refs) return true;
    let total = 0;
    let left = 0;
    for (const kind of ["paths", "activities", "effects"]) {
      const refs = entry.refs[kind];
      if (!refs) continue;
      total += refs.length;
      entry.refs[kind] = refs.filter((ref) => !gone[kind].has(ref));
      left += entry.refs[kind].length;
    }
    return !(total && !left);
  });
  if (gone.effects.size) {
    for (const activity of changeSet.activities?.add ?? []) {
      if (activity.effects) activity.effects = activity.effects.filter((e) => !gone.effects.has(e._id));
    }
  }
  return refreshEmpty(changeSet);
}
