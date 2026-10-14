// M2 (recall), M3 (precision, critical fields), M4 (AI timing) on a reference set. Never fails: it only measures.
// Usage: node tests/metrics/run-reference.mjs [--ai] [--model=llama3.1:8b] [--url=http://localhost:11434]
//          [--set=reference|heldout] [--limit=N] [--out=<dir>]
// Rules only runs in Node with the real parser; --ai adds the Ollama fallback (no download, same resolver as the module).
// Truth = the compendium document, restricted to fields the description attests (evidenced).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../scripts/core/analyze.mjs";
import { buildChangeSet } from "../../scripts/core/changes.mjs";
import { createOllamaResolver } from "../../scripts/ai/resolver.mjs";
import { K, idGenerator, parser, resolveSpell as anySpell } from "../helpers/analysis.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? d;
const flag = (n) => process.argv.includes(`--${n}`);
const here = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(here, "..", "fixtures", "reference");
const AI = flag("ai");
const MODEL = arg("model", "llama3.1:8b");
const URL_ = arg("url", "http://localhost:11434");
const SET = arg("set", "reference");
const LIMIT = Number(arg("limit", "0")) || Infinity;
// Spell names of the dnd5e compendia (extracted in Foundry): a spell that does not exist cannot be linked, as in the module.
const SPELLS_FILE = path.join(REF, "spell-names.json");
const spellNames = fs.existsSync(SPELLS_FILE) ? new Set(JSON.parse(fs.readFileSync(SPELLS_FILE, "utf8")).map((n) => n.toLowerCase())) : null;
const resolveSpell = (name) => (!spellNames || spellNames.has(String(name).toLowerCase()) ? anySpell(name) : null);
const OUT = arg("out", path.join(here, "..", "..", "..", "..", "reports", "tests", "item-configurator", "initial", "metrics"));

const textOf = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\s+/g, " ").toLowerCase();
const tidy = (v) => (v === undefined || v === null ? "" : JSON.stringify(Array.isArray(v) ? [...v].sort() : v));

// ---- Canonical forms -------------------------------------------------------------------------------------------
// Truth (compendium document) and proposal are reduced to the same list of { path, value, critical }.
// Equivalent shapes are folded: bonus effects (bonuses.* vs rolls.*), "+2" vs "2", damage dice wherever they sit
// (a separate "damage" activity vs the damage of an attack / save activity), enchantment data (out of scope).
const SCOPES = ["mwak", "rwak", "msak", "rsak"];
const numeric = (v) => String(v).replace(/^\+/, "");

/** Fold the equivalent effect keys: returns [{ path, value }]. */
export function canonChange(key, value) {
  if (!key) return [];
  const v = numeric(value);
  let m;
  if ((m = key.match(/^system\.bonuses\.abilities\.(save|check)$/)) || (m = key.match(/^system\.rolls\.ability\.(save|check)\.bonus$/))) {
    return [{ path: `bonus.${m[1]}.all`, value: v }];
  }
  if ((m = key.match(/^system\.bonuses\.(mwak|rwak|msak|rsak)\.(attack|damage)$/))) return [{ path: `bonus.${m[2]}.${m[1]}`, value: v }];
  if ((m = key.match(/^system\.rolls\.(attack|damage)\.(mwak|rwak|msak|rsak)\.bonus$/))) return [{ path: `bonus.${m[1]}.${m[2]}`, value: v }];
  if ((m = key.match(/^system\.rolls\.(attack|damage)\.bonus$/))) return SCOPES.map((scope) => ({ path: `bonus.${m[1]}.${scope}`, value: v }));
  // A speed bonus is written as movement.bonus by the parser and as movement.walk (add) by the compendium: same fact.
  if (key === "system.attributes.movement.bonus") return [{ path: "system.attributes.movement.walk", value: v }];
  return [{ path: key, value: v }];
}

const partSig = (p) => `${p.number ?? 1}d${p.denomination}${p.bonus ? `+${String(p.bonus).replace(/^\+/, "")}` : ""}:${[...(p.types ?? [])].sort().join(",")}`;
const SCORED_ACTIVITIES = ["save", "heal", "cast"];

function canonSystem(system, type) {
  const f = [];
  const add = (p, v, critical = false) => {
    if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length) && v !== false && v !== 0) f.push({ path: p, value: v, critical });
  };
  add("rarities", system.rarities);
  add("attunement", system.attunement || undefined);
  add("weight", system.weight?.value);
  add("price", system.price?.value ? `${system.price.value}${system.price.denomination}` : undefined);
  add("uses.max", system.uses?.max ? String(system.uses.max) : undefined);
  add("uses.autoDestroy", system.uses?.autoDestroy);
  add("magicalBonus", system.magicalBonus ? String(system.magicalBonus).replace(/^\+/, "") : undefined, true);
  if (type === "weapon") {
    for (const part of ["base", "versatile"]) {
      const d = system.damage?.[part];
      if (d?.denomination) add(`damage.${part}`, partSig(d), true);
    }
  }
  if (type === "equipment") {
    add("armor.value", system.armor?.value, true);
    add("strength", system.strength);
  }
  return f;
}

/** Activities: scored types (save, heal, cast), their critical values, and every damage / healing dice anywhere. */
function canonActivities(activities) {
  const f = [];
  const unscored = {};
  for (const a of activities) {
    if (a.type === "enchant") continue;
    for (const p of a.damage?.parts ?? []) if (p.denomination) f.push({ path: "dice.damage", value: partSig(p), critical: true });
    if (a.healing?.denomination) f.push({ path: "dice.heal", value: partSig(a.healing), critical: true });
    if (SCORED_ACTIVITIES.includes(a.type)) {
      f.push({ path: `activity.${a.type}`, value: a.type, critical: false });
      if (a.type === "save") {
        f.push({ path: "save.ability", value: [...(a.save?.ability ?? [])].sort().join(","), critical: true });
        if (a.save?.dc?.formula) f.push({ path: "save.dc", value: String(a.save.dc.formula), critical: true });
      }
    } else {
      unscored[a.type] = (unscored[a.type] ?? 0) + 1;
    }
  }
  return { fields: f, unscored };
}

/** Effect kinds the specification (C7) does not ask for: not expected, not scored. */
const OUT_OF_SCOPE_EFFECTS = /^system\.(traits\.languages|attributes\.senses|attributes\.hp|attributes\.attunement|attributes\.movement\.ignoredDifficultTerrain|traits\.weaponProf|traits\.armorProf|tools)/;

/** Effect fields, deduplicated (the same bonus written twice is one fact). */
function canonEffects(effects, excludeIds = new Set()) {
  const list = effects.filter((e) => !excludeIds.has(e._id)).flatMap((e) => (e.system?.changes ?? [])
    .filter((c) => !OUT_OF_SCOPE_EFFECTS.test(c.key ?? ""))
    .flatMap((c) => canonChange(c.key, c.value)
      .map((x) => ({ path: `effect.${x.path}`, value: x.value, critical: /^bonus\.|ac\.|abilities\./.test(x.path) }))));
  return [...new Map(list.map((x) => [`${x.path}=${tidy(x.value)}`, x])).values()];
}

const RARITY_WORDS = {
  common: ["common", "commun"], uncommon: ["uncommon", "peu commun"], rare: ["rare"], veryRare: ["very rare", "très rare"],
  legendary: ["legendary", "légendaire"], artifact: ["artifact", "artefact"]
};
// English / French words for the values of resistance, immunity and condition effects
const WORDS = {
  acid: ["acid", "acide"], bludgeoning: ["bludgeoning", "contondant"], cold: ["cold", "froid"], fire: ["fire", "feu"],
  force: ["force"], lightning: ["lightning", "foudre"], necrotic: ["necrotic", "nécrotique"], piercing: ["piercing", "perforant"],
  poison: ["poison"], psychic: ["psychic", "psychique"], radiant: ["radiant"], slashing: ["slashing", "tranchant"],
  thunder: ["thunder", "tonnerre"]
};
const num = (x) => String(x).match(/\d+/)?.[0];

/** Is the field attested by the description (otherwise it cannot be expected from the text)? */
function evidenced(field, text) {
  const v = String(field.value).toLowerCase();
  const p = field.path;
  if (p === "rarities") return field.value.some((r) => (RARITY_WORDS[r] ?? [r]).some((w) => text.includes(w)));
  if (p === "attunement") return /attunement|attuned|harmonis/.test(text);
  if (p === "uses.autoDestroy") return /crumble|dust|destroy|consum|vanish|détruit|poussi|désintègre/.test(text);
  if (p === "weight") return new RegExp(`\\b${num(v)}\\s*(lb|pound|livre|kg)`).test(text);
  if (p === "price") return new RegExp(`\\b${num(v)}\\s*(gp|sp|cp|ep|pp|gold|silver|copper|po|pa|pc)\\b`).test(text.replace(/(\d),(\d)/g, "$1$2"));
  if (p === "uses.max") return new RegExp(`\\b${v}\\s+(charges|doses|uses|utilisations)`).test(text) || new RegExp(`(charges|utilisations)[^.]{0,20}\\b${v}\\b`).test(text);
  if (p === "magicalBonus") return text.includes(`+${v}`);
  if (p.startsWith("damage.")) { const [dice, type] = v.split(":"); return new RegExp(`${dice.replace(/\+.*/, "")}[^.]{0,30}${type.split(",")[0] || ""}`).test(text); }
  if (p === "armor.value") return new RegExp(`\\bac\\b[^.]{0,12}\\b${v}\\b|\\b${v}\\b[^.]{0,12}\\bac\\b|armor class[^.]{0,12}${v}`).test(text);
  if (p === "strength") return new RegExp(`strength[^.]{0,6}${v}`).test(text);
  if (p.startsWith("dice.")) return text.includes(v.split(":")[0].replace(/\+.*/, ""));
  if (p === "save.dc") return text.includes(v);
  if (p === "save.ability") return true;
  if (p === "activity.cast") return /\bcast|spell|lancer|sort\b/.test(text);
  if (p === "activity.heal") return /regain|hit points|heal|récup|regagn|points de vie/.test(text);
  if (p === "activity.save") return /saving throw|jet de sauvegarde|\/save/.test(text);
  if (p.startsWith("effect.")) {
    if (v === "" || v === "0") return false;
    if (/\.mode$/.test(p)) return /advantage|avantage/.test(text);
    if (/^-?\d+$/.test(v)) return new RegExp(`(^|[^\\d])${num(v)}([^\\d]|$)`).test(text);
    return (WORDS[v] ?? [v]).some((w) => text.includes(w));
  }
  return text.includes(v);
}

const signature = (f) => `${f.path}=${tidy(f.value)}`;
const multiset = (list) => list.reduce((m, f) => m.set(signature(f), (m.get(signature(f)) ?? 0) + 1), new Map());
const diff = (a, b) => [...a].flatMap(([sig, n]) => Array(Math.max(0, n - (b.get(sig) ?? 0))).fill(sig));

async function measure(items, label, resolver) {
  const rows = [];
  for (const item of items) {
    const text = textOf(`${item.description} ${item.name}`);
    const enchantEffectIds = new Set((item.truth.activities ?? []).filter((a) => a.type === "enchant").flatMap((a) => (a.effects ?? []).map((e) => e._id)));
    const truthAct = canonActivities(item.truth.activities ?? []);
    const truthAll = [
      ...canonSystem(item.truth.system, item.type), ...truthAct.fields, ...canonEffects(item.truth.effects ?? [], enchantEffectIds)
    ].filter((f) => evidenced(f, text));
    const source = { type: item.type, system: {}, effects: [] };
    const t0 = performance.now();
    let proposal;
    let changeSet;
    try {
      proposal = await analyze({ name: item.name, html: item.description, type: item.type, value: item.value, subtype: item.subtype, source }, {
        parser, keys: K, idGen: idGenerator(), resolveSpell, fallback: resolver ?? null
      });
      changeSet = buildChangeSet(source, proposal, { parser });
    } catch (err) {
      rows.push({ name: item.name, error: String(err.message) });
      continue;
    }
    const ms = performance.now() - t0;
    // Derived entries (chosen type, base item, single-use deduction) are not "read from the text": scored apart.
    const derivedPaths = new Set(changeSet.entries.filter((e) => e.derived).flatMap((e) => e.refs?.paths ?? []));
    const patch = {};
    const derivedPatch = {};
    for (const [k, v] of Object.entries(changeSet.systemPatch)) {
      const keys = k.replace(/^system\./, "").split(".");
      let o = derivedPaths.has(k) || k === "system.type.value" || k === "system.type.subtype" ? derivedPatch : patch;
      keys.slice(0, -1).forEach((x) => { o = o[x] ??= {}; });
      o[keys.at(-1)] = v;
    }
    const proposedAct = canonActivities(changeSet.activities.add);
    const proposedAll = [...canonSystem(patch, item.type), ...proposedAct.fields, ...canonEffects(changeSet.effects.add)];
    const isDeduction = (f) => f.path === "uses.autoDestroy" || f.path === "uses.max";
    const truthDeduced = new Set(canonSystem(item.truth.system, item.type).filter(isDeduction).map(signature));
    const deduced = canonSystem(derivedPatch, item.type).filter(isDeduction);

    const truthSet = multiset(truthAll);
    const proposedSet = multiset(proposedAll);
    let hit = 0;
    let correct = 0;
    for (const [sig, n] of truthSet) hit += Math.min(n, proposedSet.get(sig) ?? 0);
    for (const [sig, n] of proposedSet) correct += Math.min(n, truthSet.get(sig) ?? 0);
    const truthPaths = new Set(truthAll.map((x) => x.path));
    const criticalOf = new Map([...proposedAll, ...truthAll].map((x) => [signature(x), x.critical]));
    // A proposed field absent from the truth is "true-not-in-truth" when the description attests it (incomplete truth),
    // "unverified" otherwise (invented or over-reading); a field on a path the truth has with another value is "wrong-value".
    const fieldOf = new Map(proposedAll.map((x) => [signature(x), x]));
    const wrong = diff(proposedSet, truthSet).map((sig) => {
      const kind = truthPaths.has(sig.split("=")[0]) ? "wrong-value" : (evidenced(fieldOf.get(sig), text) ? "true-not-in-truth" : "unverified");
      return { sig, kind, critical: Boolean(criticalOf.get(sig)) };
    });
    rows.push({
      name: item.name, lang: item.lang ?? "en", type: item.type, stratum: item.stratum, ms: Math.round(ms), ai: proposal.ai.status,
      expected: truthAll.length, proposed: proposedAll.length, hit, correct, missed: diff(truthSet, proposedSet), wrong,
      criticalErrors: wrong.filter((w) => w.critical),
      deduced: deduced.map((d) => ({ sig: signature(d), ok: truthDeduced.has(signature(d)) })),
      unscored: { truth: truthAct.unscored, proposed: proposedAct.unscored },
      aiRejected: resolver?.lastRun?.rejected?.length ?? 0
    });
  }
  const ok = rows.filter((r) => !r.error);
  const sum = (k) => ok.reduce((n, r) => n + r[k], 0);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
  const count = (fn) => ok.reduce((n, r) => n + r.wrong.filter(fn).length, 0);
  const summary = {
    label, items: ok.length, errors: rows.length - ok.length,
    recall: sum("expected") ? sum("hit") / sum("expected") : null,
    precision: sum("proposed") ? sum("correct") / sum("proposed") : null,
    criticalErrors: ok.reduce((n, r) => n + r.criticalErrors.length, 0),
    wrongValue: count((w) => w.kind === "wrong-value"), trueNotInTruth: count((w) => w.kind === "true-not-in-truth"), unverified: count((w) => w.kind === "unverified"),
    precisionAdjusted: sum("proposed") ? (sum("correct") + count((w) => w.kind === "true-not-in-truth")) / sum("proposed") : null,
    criticalErrorsAdjusted: ok.reduce((n, r) => n + r.criticalErrors.filter((w) => w.kind !== "true-not-in-truth").length, 0),
    expectedFields: sum("expected"), proposedFields: sum("proposed"), hits: sum("hit"),
    deductions: { total: ok.reduce((n, r) => n + r.deduced.length, 0), correct: ok.reduce((n, r) => n + r.deduced.filter((d) => d.ok).length, 0) },
    msMedian: ms[Math.floor(ms.length / 2)] ?? null, msP95: ms[Math.floor(ms.length * 0.95)] ?? null, msMax: ms.at(-1) ?? null
  };
  return { summary, rows };
}

const readSet = (name) => JSON.parse(fs.readFileSync(path.join(REF, name), "utf8"));
const FILES = { reference: ["srd-items.json", "fr-items.json"], heldout: ["../heldout/items-en.json", "../heldout/items-fr.json"],
  "set-b": ["../set-b/items-en.json", "../set-b/items-fr.json"] };
const [enFile, frFile] = FILES[SET] ?? [`${SET}-en.json`, `${SET}-fr.json`];
const en = readSet(enFile).slice(0, LIMIT).map((i) => ({ ...i, lang: "en" }));
const fr = fs.existsSync(path.join(REF, frFile)) ? readSet(frFile).slice(0, LIMIT).map((i) => ({ ...i, lang: "fr" })) : [];

let resolver = null;
const extra = {};
if (AI) {
  resolver = createOllamaResolver({ url: URL_, model: MODEL, fetch: (...a) => globalThis.fetch(...a), keys: K, timeoutMs: 60000 });
  const t0 = Date.now();
  extra.warmed = await resolver.warmUp();
  extra.coldLoadMs = Date.now() - t0;
  if (!extra.warmed) console.warn("Ollama unreachable or no model: the AI run falls back to rules only");
  try { extra.ps = (await (await fetch(`${URL_}/api/ps`)).json()).models?.map((m) => ({ name: m.name, size: m.size, size_vram: m.size_vram })); } catch { /* optional */ }
}

const results = [await measure(en, `${AI ? "ai" : "rules"}-en`, resolver)];
if (fr.length) results.push(await measure(fr, `${AI ? "ai" : "rules"}-fr`, resolver));
const all = { date: new Date().toISOString(), set: SET, ai: AI, model: AI ? MODEL : null, extra, results: results.map((r) => r.summary) };
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `${SET}-${AI ? "ai" : "rules"}.json`);
// Per-item details of the held-out set stay out of the reports (they would show which items fail): totals only.
const detailsDir = SET !== "reference" ? process.env.IC_HELDOUT_DETAILS : null;
fs.writeFileSync(file, `${JSON.stringify(SET !== "reference" ? all : { ...all, details: results }, null, 1)}\n`);
if (detailsDir) {
  fs.mkdirSync(detailsDir, { recursive: true });
  fs.writeFileSync(path.join(detailsDir, `${SET}-${AI ? "ai" : "rules"}.json`), JSON.stringify(results, null, 1));
}
for (const s of all.results) {
  console.log(`${s.label}: ${s.items} items, recall ${(s.recall * 100).toFixed(1)} %, precision ${(s.precision * 100).toFixed(1)} %, precision adj ${(s.precisionAdjusted * 100).toFixed(1)} %, critical ${s.criticalErrors}/${s.criticalErrorsAdjusted} (strict/adj), wrong value ${s.wrongValue}, true-not-in-truth ${s.trueNotInTruth}, unverified ${s.unverified}, median ${s.msMedian} ms, p95 ${s.msP95} ms`);
}
console.log("written", file);
