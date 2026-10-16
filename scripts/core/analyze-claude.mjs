/**
 * Pure orchestration of the "Claude first" mode: the rules (`analyze`, synchronous in practice) and one call to
 * Claude run side by side; Claude's answer is validated (`ai/claude-validate.mjs`), built into dnd5e sources
 * (`ai/claude-build.mjs`) and cross-checked with the rules (`core/crosscheck.mjs`). The result is a proposal of the
 * same shape as `analyze()` (so `buildChangeSet` and `validateChangeSet` are unchanged), with `mode: "claude"`,
 * `descriptors`, `claude` and `crosscheck`. Any failure of Claude (no key, network, time limit, refusal, truncated or
 * invalid answer) falls back to the rules alone, with the cause in `ai.status`; nothing throws.
 *
 * `complete` is injected: `anthropic.complete` partially applied to its configuration and `fetch`, called as
 * `complete({ system, messages, schema }, { signal })`. No Foundry global.
 */
import { SINGLE_USE_TYPES, analyze, baseFragment } from "./analyze.mjs";
import { CROSSCHECK_POLICY, coveredParagraphs, crossCheck, factsFromClaude, factsFromRules } from "./crosscheck.mjs";
import { activitySignature, effectSignature } from "./changes.mjs";
import { clone, getPath, randomId, setPath } from "./paths.mjs";
import { buildItemSchema } from "../ai/claude-schema.mjs";
import { buildClaudeRequest, describeForClaude } from "../ai/claude-prompt.mjs";
import { validateClaudeItem } from "../ai/claude-validate.mjs";
import { buildFromClaude } from "../ai/claude-build.mjs";

/** Client statuses -> statuses the preview explains (`Preview.Ai.*`). */
const STATUS = { http: "error", invalid: "error" };
const NO_ACTIVITY_TYPES = ["loot", "container"];

const aiStatus = (status) => STATUS[status] ?? status ?? "error";

/** `complete` wrapped so that it never throws and always answers in the client's shape. */
async function callClaude(complete, request, signal) {
  if (typeof complete !== "function") return { ok: false, status: "noKey", retried: false };
  try {
    const result = await complete(request, { signal });
    return result && typeof result === "object" ? result : { ok: false, status: "invalid", error: "no result", retried: false };
  } catch (err) {
    return { ok: false, status: signal?.aborted ? "aborted" : "error", error: String(err?.message ?? err), retried: false };
  }
}

/**
 * Elements the rules alone found (`crosscheck.rulesOnly`), added to the Claude translation: checked when Claude
 * cited nothing in their paragraph (a complement), unchecked when it read the paragraph and left them out. An
 * element Claude already proposes (same signature) is not added again. Activities bring their linked effects along.
 * Descriptors come from `parser.describe(rules.plan)`, re-indexed.
 */
function complementFromRules(rulesOnly, rules, parser, translation, descriptors) {
  const described = parser.describe(rules.plan);
  const added = new Map();   // rules path -> new path
  const addedParagraphs = new Set();
  const activitySeen = new Set(translation.activities.filter(Boolean).map(activitySignature));
  const effectSeen = new Set(translation.effects.filter(Boolean).map(effectSignature));
  const mark = (descriptor, fromPath, toPath, covered) => descriptors.push({
    ...descriptor, paths: descriptor.paths.map((p) => (p === fromPath ? toPath : p)).filter((p) => p === toPath || p.startsWith("system.")),
    origin: "rules", check: "rulesOnly", selected: !covered, ref: fromPath, certainty: null, inferred: []
  });
  const addEffect = (index, covered) => {
    const from = `effects.${index}`;
    if (added.has(from)) return added.get(from);
    const source = rules.translation.effectsAligned ? rules.translation.effects[index] : null;
    if (!source || effectSeen.has(effectSignature(source))) return null;
    effectSeen.add(effectSignature(source));
    const to = `effects.${translation.effects.length}`;
    translation.effects.push(clone(source));
    added.set(from, to);
    for (const d of described.filter((x) => x.group === "effects" && x.paths.includes(from))) mark(d, from, to, covered);
    return to;
  };
  const addActivity = (index, covered) => {
    const from = `activities.${index}`;
    if (added.has(from)) return;
    const source = rules.translation.activities[index];
    if (!source || activitySeen.has(activitySignature(source))) return;
    activitySeen.add(activitySignature(source));
    const copy = clone(source);
    if (copy.effects?.length) {
      const linked = copy.effects.map(({ _id }) => rules.translation.effects.findIndex((e) => e._id === _id)).filter((i) => i >= 0);
      copy.effects = linked.map((i) => addEffect(i, covered)).filter(Boolean).map((to) => ({ _id: translation.effects[Number(to.split(".")[1])]._id }));
      if (!copy.effects.length) delete copy.effects;
    }
    const to = `activities.${translation.activities.length}`;
    translation.activities.push(copy);
    added.set(from, to);
    for (const d of described.filter((x) => x.group === "activities" && x.paths.includes(from))) mark(d, from, to, covered);
  };
  const addSystem = (path, covered) => {
    const field = path.replace(/^system\./, "");
    if (added.has(path) || getPath(translation.system, field) !== undefined) return;
    const value = getPath(rules.translation.system, field);
    if (value === undefined) return;
    setPath(translation.system, field, clone(value));
    added.set(path, path);
    for (const d of described.filter((x) => x.group === "details" && x.paths.some((p) => p === path || path.startsWith(`${p}.`) || p.startsWith(`${path}.`)))) {
      if (!descriptors.some((existing) => existing.ref === d.paths[0] && existing.check === "rulesOnly")) mark(d, d.paths[0], d.paths[0], covered);
    }
  };
  for (const fact of rulesOnly) {
    const covered = fact.covered === true;
    const path = String(fact.path ?? "");
    if (path.startsWith("activities.")) addActivity(Number(path.split(".")[1]), covered);
    else if (path.startsWith("effects.")) addEffect(Number(path.split(".")[1]), covered);
    else if (path.startsWith("system.")) addSystem(path, covered);
    if (Number.isInteger(fact.paragraph) && !covered) addedParagraphs.add(fact.paragraph);
  }
  return addedParagraphs;
}

/**
 * Analyze the description of an item, Claude first and the rules as a control.
 * @param {object} input                       Same as `analyze()`: `{ name, html, type, value, subtype, source }`.
 * @param {object} context
 * @param {object} context.parser              The `dnd5e-text-parser` API.
 * @param {object} [context.keys]              `keysFromConfig(CONFIG.DND5E)`.
 * @param {object} context.enums               `schemaEnums(CONFIG.DND5E, CONST)`.
 * @param {function} [context.complete]        `(request, { signal }) => Promise<result>`; absent = no key.
 * @param {AbortSignal} [context.signal]
 * @param {function(): string} [context.idGen]
 * @param {object|null} [context.baseItem]
 * @param {function(string): (string|null)} [context.resolveSpell]
 * @param {function(object): void} [context.onProgress]   `{ step: "rules"|"claude"|"validate" }`.
 * @param {{ type?: string, value?: string, subtype?: string }} [context.labels]   Localized labels of the type.
 * @param {boolean} [context.metric]           Metric world (distances converted to metres).
 * @param {object} [context.policy]            `CROSSCHECK_POLICY` override.
 * @returns {Promise<object>}  Proposal (see `buildChangeSet`), `mode: "claude"` or `"rules"`.
 */
export async function analyzeClaudeFirst(input, {
  parser, keys, enums, complete, signal, idGen = randomId, baseItem = null, resolveSpell, onProgress, labels, metric = false, policy
} = {}) {
  const started = Date.now();
  const { name, html, type, value = "", subtype = "" } = input;
  const { paragraphs } = describeForClaude(html, parser);
  const progress = (step) => { try { onProgress?.({ step }); } catch { /* the display never breaks the analysis */ } };

  // Claude and the rules, side by side: the answer is awaited after the rules are done
  progress("claude");
  const request = { ...buildClaudeRequest({ name, type, value, subtype, labels, paragraphs }), schema: buildItemSchema(enums ?? {}) };
  const claudeStarted = Date.now();
  const pending = callClaude(complete, request, signal);
  progress("rules");
  const rules = await analyze(input, { parser, keys, idGen, baseItem, resolveSpell });
  const result = await pending;
  const ai = {
    status: result.ok ? "ok" : aiStatus(result.status), provider: "anthropic", model: result.model ?? null, calls: 1,
    ms: Date.now() - claudeStarted, usage: result.usage ?? null, retried: Boolean(result.retried),
    ...(result.error ? { error: String(result.error) } : {})
  };
  if (!result.ok) {
    return { ...rules, mode: "rules", ai, durationMs: Date.now() - started, descriptors: null, claude: null, crosscheck: null, paragraphs };
  }

  // Validation, construction, cross-check
  progress("validate");
  const validated = validateClaudeItem(result.json, { paragraphs, enums, keys, metric, type });
  const built = buildFromClaude(validated.item, { parser, keys, idGen, type, name, resolveSpell });
  const covered = coveredParagraphs(validated.item, paragraphs);
  const crosscheck = crossCheck(factsFromRules(rules.plan, paragraphs), factsFromClaude(validated.item, paragraphs), policy ?? CROSSCHECK_POLICY, { covered });

  const system = built.system;
  const chosen = [];
  if (value && type !== "container") { setPath(system, "type.value", value); chosen.push("system.type.value"); }
  if (subtype && type === "consumable") { setPath(system, "type.subtype", subtype); chosen.push("system.type.subtype"); }
  const deduced = [];
  if (type === "consumable" && SINGLE_USE_TYPES.includes(value) && !system.uses?.max) {
    // Same deduction as the rules: a potion is used once and destroyed when empty
    system.uses = { ...(system.uses ?? {}), max: "1", recovery: [], autoDestroy: true };
    deduced.push({ paths: ["system.uses"], label: { key: "item-configurator.Preview.Deduced.SingleUse", data: { type: value } } });
  }
  const descriptors = built.descriptors.map((d) => ({ ...d, selected: d.certainty !== "low" }));
  const translation = {
    system, base: {}, chosen, deduced,
    activities: NO_ACTIVITY_TYPES.includes(type) ? [] : [...built.activities],
    effects: [...built.effects], effectsAligned: true, notes: [...built.notes]
  };
  const complemented = complementFromRules(crosscheck.rulesOnly, rules, parser, translation, descriptors);
  translation.base = baseFragment(baseItem, type, system);
  // Dropped elements (unresolved spell, unwritable effect) keep their index for the cross-check; the change set
  // reads `null` as "dropped"
  translation.effects = translation.effects.map((e) => e ?? null);

  // Paragraphs nobody read: not interpreted (C8). The plan keeps the rules' reading for the loot / container
  // rejections and for anything that still reads it; Claude's activities take its place there.
  const unrecognized = validated.uncovered.filter(({ index }) => !complemented.has(index - 1)).map(({ text }) => ({ text }));
  const plan = {
    ...rules.plan,
    activities: validated.item.activities.map((a) => ({ kind: a.type, name: a.name, raw: a.quotes[0] ?? "", origin: "claude" })),
    effects: [], unrecognized
  };

  return {
    plan, name, header: rules.header, target: { type, value, subtype }, baseItem, ai,
    durationMs: Date.now() - started, translation, mode: "claude", descriptors, paragraphs,
    claude: {
      item: validated.item, corrections: validated.corrections, rejections: validated.rejections, uncovered: validated.uncovered,
      notAutomated: validated.item.notAutomated.map(({ quote, reason }) => ({ quote, reason })),
      flavor: validated.item.flavor.map(({ text }) => text)
    },
    crosscheck,
    rules: { plan: rules.plan, translation: rules.translation }
  };
}
