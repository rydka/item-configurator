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
 *   check: Check[],                             // "To check": the facts the rules and Claude disagree on
 *   unrecognized: { text }[], rejected: Entry[], empty: boolean,
 *   notAutomated: Entry[],                      // clauses dnd5e cannot apply (`Note.NotAutomated`), with their sentence
 *   flavor: { text }[]                          // flavor text (`Note.Flavor`): not interpreted, shown apart
 * }
 * Entry = { id, group: "details"|"activities"|"effects", action: "add"|"set"|"replace"|"remove"|"keep",
 *   label: { key, data } | string, value, previous, raw, origin: "rules"|"fallback"|"base"|"claude",
 *   selected: boolean, certainty?: "high"|"medium"|"low", inferred?: string[],
 *   check?: "agree"|"conflict"|"claudeOnly"|"rulesOnly"|null, alternatives?: { claude: string, rules: string },
 *   derived?: boolean, chosen?: boolean, refs?: { paths?, activities?, effects? } }
 * `derived` entries come from the chosen type, the base item or a deduction, not from a sentence of the text.
 * `chosen` entries are the type / subtype picked in the type window (`value` and `previous` are dnd5e type keys).
 * `selected` is the checkbox of the preview: an unselected entry is not applied (`applySelection`). It starts
 * unchecked when the descriptor says so (`selected: false`) or when Claude's certainty is `low`.
 * Check = { id, group: "check", entryId, family, critical, paragraph, label: { key, data },
 *   claude: { display, raw }, rules: { display, raw }, choice: "claude"|"rules",
 *   target: { kind: "system"|"activity"|"effect", id? }, patch: { claude: [{ field, data }], rules: [...] } }
 * Choosing `rules` writes `patch.rules` into the target element at apply time, without any new call.
 */
import { carryOverSystem } from "./convert.mjs";
import { clone, getPath, leaves, same, setPath } from "./paths.mjs";

/** Item types without activities. */
export const NO_ACTIVITY_TYPES = ["loot", "container"];

const FIELD_KEY = "dnd5e-text-parser.Describe.Field";
const NOTE_UNRECOGNIZED = "dnd5e-text-parser.Note.Unrecognized";
const NOTE_NOT_AUTOMATED = "dnd5e-text-parser.Note.NotAutomated";
const NOTE_FLAVOR = "dnd5e-text-parser.Note.Flavor";
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
  "dnd5e-text-parser.Describe.Rarity": ["rarityRaw", "raw"],
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

/** Does a fact path (`activities.1`, `system.uses`) fall under one of the descriptor paths, or the reverse? */
const underPaths = (path, paths) => (paths ?? []).some((p) => p === path || path.startsWith(`${p}.`) || p.startsWith(`${path}.`));

/**
 * What a descriptor carries about its reading (Claude-first mode): origin, certainty, deduced fields, the result of
 * the cross-check and the initial state of its checkbox. `check` is derived from the cross-check facts of the
 * proposal when the descriptor does not state it (rules-only complements must state it: their facts are indexed in
 * the rules' plan, not in the proposal).
 */
function readingOf(descriptor, crosscheck) {
  const meta = { origin: descriptor.origin ?? "rules" };
  if (descriptor.certainty) meta.certainty = descriptor.certainty;
  if (descriptor.inferred?.length) meta.inferred = [...descriptor.inferred];
  let check = descriptor.check;
  if (check === undefined && crosscheck) {
    const hits = (facts) => facts.some((f) => underPaths(f.path, descriptor.paths));
    if (hits((crosscheck.conflict ?? []).map((c) => c.claude))) check = "conflict";
    else if (hits((crosscheck.agree ?? []).map((a) => a.claude))) check = "agree";
    else if (meta.origin === "claude" && hits(crosscheck.claudeOnly ?? [])) check = "claudeOnly";
    else check = null;
  }
  if (check !== undefined) meta.check = check;
  meta.selected = descriptor.selected ?? (descriptor.certainty !== "low");
  return meta;
}

/**
 * Compare the proposal with the existing item.
 * @param {object} source          `item.toObject()`.
 * @param {object} proposal        Result of `analyze()` or `analyzeClaudeFirst()`.
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
  const push = (entry) => entries.push({ id: `${entry.group}:${counter++}`, origin: "rules", raw: "", selected: true, ...entry });
  // Claude-first mode gives its own descriptors (with origin, certainty, check...); the rules alone use the library's
  const described = proposal.descriptors ?? parser.describe(plan);
  const descriptors = described.map((d) => (d.raw ? d : { ...d, raw: headerRaw(d.key, proposal) }));
  const reading = (d) => readingOf(d, proposal.crosscheck);

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
    if (claimed.length) detailEntry({ key: d.key, data: d.data }, claimed, { raw: d.raw, ...reading(d) });
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
      group: "activities", action: fresh.length ? "add" : "keep", label: { key: d.key, data: d.data }, raw: d.raw, ...reading(d),
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
      group: "effects", action: fresh.length ? "add" : "keep", label: { key: d.key, data: d.data }, raw: d.raw, ...reading(d),
      ...(fresh.length ? { refs: { effects: fresh.map((n) => tr.effects[n]._id) } } : {})
    });
  }

  // ---- To check: the facts the two readings disagree on, attached to the entry that carries Claude's value --------
  const check = [];
  for (const conflict of proposal.crosscheck?.conflict ?? []) {
    const path = conflict.claude?.path ?? "";
    let target = null;
    if (path.startsWith("activities.")) {
      const id = proposedActivities[Number(path.slice("activities.".length))]?._id;
      if (id && activityAdd.some((a) => a._id === id)) target = { kind: "activity", id };
    } else if (path.startsWith("effects.")) {
      const id = tr.effects[Number(path.slice("effects.".length))]?._id;
      if (id && effectAdd.some((e) => e._id === id)) target = { kind: "effect", id };
    } else if (path.startsWith("system.")) target = { kind: "system" };
    if (!target) continue;
    const entry = entries.find((e) => e.refs && (
      (target.kind === "activity" && e.refs.activities?.includes(target.id))
      || (target.kind === "effect" && e.refs.effects?.includes(target.id))
      || (target.kind === "system" && e.refs.paths?.some((p) => underPaths(path, [p])))
    ));
    if (!entry) continue;
    entry.check = "conflict";
    entry.alternatives ??= { claude: conflict.claude.display, rules: conflict.rules.display };
    check.push({
      id: `check:${counter++}`, group: "check", entryId: entry.id, family: conflict.family, critical: Boolean(conflict.critical),
      paragraph: conflict.paragraph ?? null, label: { key: `item-configurator.Preview.Check.Family.${conflict.family}`, data: {} },
      claude: { display: conflict.claude.display, raw: conflict.claude.raw ?? "" },
      rules: { display: conflict.rules.display, raw: conflict.rules.raw ?? "" },
      choice: conflict.proposed === "rules" ? "rules" : "claude", target,
      patch: { claude: clone(conflict.patch?.claude ?? []), rules: clone(conflict.patch?.rules ?? []) }
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

  // ---- Notes, rejected, not automated, flavor and unrecognized sentences -----------------------------------------
  // A clause dnd5e cannot apply without inventing a rule ("you can't take reactions") is not an ignored proposal:
  // it is shown in its own group with its sentence, so that the table applies it by hand. Flavor text is not
  // interpreted either, but it is prose, not a rule: shown apart, never among the unrecognized sentences.
  const seen = new Set();
  const notAutomated = [];
  const flavor = [];
  for (const note of [...descriptors.filter((d) => d.group === null && d.key !== NOTE_UNRECOGNIZED), ...tr.notes]) {
    const fingerprint = JSON.stringify([note.key, note.data]);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    if (note.key === NOTE_FLAVOR) {
      const text = note.data?.text ?? note.raw ?? "";
      if (text) flavor.push({ text });
      continue;
    }
    if (note.key === NOTE_NOT_AUTOMATED) {
      notAutomated.push({
        id: `not-automated:${counter++}`, group: "notAutomated", action: "keep", label: { key: note.key, data: note.data },
        raw: note.raw ?? note.data?.raw ?? "", origin: note.origin ?? "rules", ...(note.certainty ? { certainty: note.certainty } : {})
      });
      continue;
    }
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
    entries, check, unrecognized, rejected, notAutomated, flavor, empty: true
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
 * from the preview, the activities no longer point to refused effects, and the "to check" items of a refused element
 * go with it.
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
  if (changeSet.check?.length) {
    const live = new Set(changeSet.entries.map((e) => e.id));
    changeSet.check = changeSet.check.filter((item) => {
      if (!live.has(item.entryId)) return false;
      if (item.target.kind === "activity") return !gone.activities.has(item.target.id);
      if (item.target.kind === "effect") return !gone.effects.has(item.target.id);
      return !item.patch.claude.some((p) => gone.paths.has(p.field));
    });
  }
  return refreshEmpty(changeSet);
}

/**
 * The change set as the preview's checkboxes and "to check" choices leave it, ready to apply: unselected entries
 * lose their changes (an activity, effect or field shared by several entries goes only when all of them are
 * unselected), and each "to check" item writes the chosen reading's value into its element. The given change set is
 * not modified: the preview keeps it to re-render.
 * @param {object} changeSet
 * @param {object} [selection]
 * @param {Object<string, boolean>} [selection.selected]  Entry id -> checked; entries not listed keep their state.
 * @param {Object<string, "claude"|"rules">} [selection.choices]  Check id -> chosen reading; others keep theirs.
 * @returns {object}  A new change set.
 */
export function applySelection(changeSet, { selected = {}, choices = {} } = {}) {
  const result = clone(changeSet);
  for (const entry of result.entries) if (typeof selected[entry.id] === "boolean") entry.selected = selected[entry.id];
  for (const item of result.check ?? []) if (["claude", "rules"].includes(choices[item.id])) item.choice = choices[item.id];

  // The chosen reading of each conflict, written into the element that carries it
  for (const item of result.check ?? []) {
    const patch = item.patch?.[item.choice] ?? [];
    const element = item.target.kind === "activity" ? result.activities.add.find((a) => a._id === item.target.id)
      : (item.target.kind === "effect" ? result.effects.add.find((e) => e._id === item.target.id) : null);
    for (const { field, data } of patch) {
      if (item.target.kind === "system") {
        if (field in result.systemPatch) result.systemPatch[field] = clone(data);
      } else if (element) setPath(element, field, clone(data));
    }
  }

  // What the unselected entries described, unless a selected entry still needs it
  const wanted = { paths: new Set(), activities: new Set(), effects: new Set() };
  const unwanted = { paths: new Set(), activities: new Set(), effects: new Set() };
  for (const entry of result.entries) {
    if (!entry.refs) continue;
    const bucket = entry.selected === false ? unwanted : wanted;
    for (const kind of ["paths", "activities", "effects"]) for (const ref of entry.refs[kind] ?? []) bucket[kind].add(ref);
  }
  const removed = {};
  for (const kind of ["paths", "activities", "effects"]) removed[kind] = [...unwanted[kind]].filter((ref) => !wanted[kind].has(ref));
  for (const path of removed.paths) delete result.systemPatch[path];
  result.activities.add = result.activities.add.filter((a) => !removed.activities.includes(a._id));
  result.effects.add = result.effects.add.filter((e) => !removed.effects.includes(e._id));
  return pruneChangeSet(result, removed);
}
