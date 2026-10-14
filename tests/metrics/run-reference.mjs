// M2 (recall), M3 (precision, critical fields), M4 (AI timing) on the reference set. Never fails: it only measures.
// Usage: node tests/metrics/run-reference.mjs [--ai] [--model=llama3.1:8b] [--url=http://localhost:11434]
//          [--set=reference] [--limit=N] [--out=<dir>]
// Rules only runs in Node with the real parser; --ai adds the Ollama fallback (no download, same resolver as the module).
// Truth = the compendium document, restricted to fields the description attests (isEvidenced).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "../../scripts/core/analyze.mjs";
import { buildChangeSet } from "../../scripts/core/changes.mjs";
import { createOllamaResolver } from "../../scripts/ai/resolver.mjs";
import { K, idGenerator, parser, resolveSpell } from "../helpers/analysis.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? d;
const flag = (n) => process.argv.includes(`--${n}`);
const here = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(here, "..", "fixtures", "reference");
const AI = flag("ai");
const MODEL = arg("model", "llama3.1:8b");
const URL_ = arg("url", "http://localhost:11434");
const SET = arg("set", "reference");
const LIMIT = Number(arg("limit", "0")) || Infinity;
const OUT = arg("out", path.join(here, "..", "..", "..", "..", "reports", "tests", "item-configurator", "initial", "metrics"));

const textOf = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1").replace(/\s+/g, " ").toLowerCase();
const tidy = (v) => (v === undefined || v === null ? "" : JSON.stringify(Array.isArray(v) ? [...v].sort() : v));

/** Canonical { path, value, critical } list from a dnd5e item source (truth) or from a change set. */
function canonSystem(system, type) {
  const f = [];
  const add = (p, v, critical = false) => { if (v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length) && v !== false) f.push({ path: p, value: v, critical }); };
  add("rarities", system.rarities);
  add("attunement", system.attunement || undefined);
  add("weight", system.weight?.value || undefined);
  add("price", system.price?.value ? `${system.price.value}${system.price.denomination}` : undefined);
  add("uses.max", system.uses?.max ? String(system.uses.max) : undefined);
  add("uses.autoDestroy", system.uses?.autoDestroy || undefined);
  add("magicalBonus", system.magicalBonus ? String(system.magicalBonus) : undefined, true);
  if (type === "weapon") {
    for (const part of ["base", "versatile"]) {
      const d = system.damage?.[part];
      if (d?.denomination) add(`damage.${part}`, `${d.number ?? 1}d${d.denomination}:${[...(d.types ?? [])].sort().join(",")}`, true);
    }
  }
  if (type === "equipment") {
    add("armor.value", system.armor?.value || undefined, true);
    add("strength", system.strength || undefined);
  }
  return f;
}

const partSig = (p) => `${p.number ?? 1}d${p.denomination}${p.bonus ? `+${p.bonus}` : ""}:${[...(p.types ?? [])].sort().join(",")}`;
function canonActivities(activities) {
  const f = [];
  for (const a of activities) {
    f.push({ path: `activity.${a.type}`, value: a.type, critical: false });
    for (const p of a.damage?.parts ?? []) if (p.denomination) f.push({ path: `activity.${a.type}.damage`, value: partSig(p), critical: true });
    if (a.healing?.denomination) f.push({ path: "activity.heal.healing", value: partSig(a.healing), critical: true });
    if (a.type === "save") {
      f.push({ path: "activity.save.ability", value: [...(a.save?.ability ?? [])].sort().join(","), critical: true });
      if (a.save?.dc?.formula) f.push({ path: "activity.save.dc", value: String(a.save.dc.formula), critical: true });
    }
  }
  return f;
}
function canonEffects(effects) {
  return effects.flatMap((e) => (e.system?.changes ?? []).map((c) => ({
    path: `effect.${c.key}`, value: String(c.value), critical: /ac\.|\.bonus|\.save|abilities\./.test(c.key)
  })));
}

/** Is the field attested by the description (otherwise it cannot be expected from the text)? */
function evidenced(field, text) {
  const v = String(field.value).toLowerCase();
  if (field.path === "rarities") return field.value.some((r) => text.includes(r.replace(/([A-Z])/g, " $1").toLowerCase()));
  if (field.path === "attunement") return /attunement|harmonis/.test(text);
  if (field.path === "uses.autoDestroy") return /crumble|dust|destroy|consum|vanish|disappear|detruit|poussi/.test(text);
  if (field.path.startsWith("activity.") && !field.critical) return true;
  if (field.path === "weight" || field.path === "price") return text.includes(String(parseInt(v, 10)));
  if (field.path.startsWith("damage.")) return text.includes(v.split(":")[0]);
  if (field.path.startsWith("activity.") && /damage|healing/.test(field.path)) return text.includes(v.split(":")[0].replace(/\+.*/, ""));
  if (field.path === "activity.save.dc") return text.includes(v);
  if (field.path === "activity.save.ability") return true;
  if (field.path.startsWith("effect.")) return /\+\d|\d+/.test(String(field.value)) ? text.includes(String(field.value).replace("+", "")) : true;
  return text.includes(v);
}

const signature = (f) => `${f.path}=${tidy(f.value)}`;

async function measure(items, label, resolver) {
  const rows = [];
  for (const item of items) {
    const text = textOf(item.description);
    const truthFields = [
      ...canonSystem(item.truth.system, item.type), ...canonActivities(item.truth.activities ?? []),
      ...canonEffects(item.truth.effects ?? [])
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
    const patch = {};
    for (const [k, v] of Object.entries(changeSet.systemPatch)) {
      const keys = k.replace(/^system\./, "").split(".");
      let o = patch;
      keys.slice(0, -1).forEach((x) => { o = o[x] ??= {}; });
      o[keys.at(-1)] = v;
    }
    const proposed = [
      ...canonSystem(patch, item.type), ...canonActivities(changeSet.activities.add), ...canonEffects(changeSet.effects.add)
    ].filter((f) => f.path !== "type.value");
    const truthSet = new Set(truthFields.map(signature));
    const proposedSet = new Set(proposed.map(signature));
    const hit = truthFields.filter((f) => proposedSet.has(signature(f)));
    const correct = proposed.filter((f) => truthSet.has(signature(f)));
    // Wrong critical fields: proposed critical value on a path the truth also has but with another value, or a value
    // where the truth has none although the text attests it.
    const truthPaths = new Map();
    for (const f of truthFields) truthPaths.set(f.path, [...(truthPaths.get(f.path) ?? []), signature(f)]);
    const criticalErrors = proposed.filter((f) => f.critical && !truthSet.has(signature(f))).map((f) => ({ ...f, expected: truthPaths.get(f.path) ?? null }));
    rows.push({
      name: item.name, lang: item.lang ?? "en", type: item.type, stratum: item.stratum, ms: Math.round(ms), ai: proposal.ai.status,
      expected: truthFields.length, proposed: proposed.length, hit: hit.length, correct: correct.length,
      missed: truthFields.filter((f) => !proposedSet.has(signature(f))).map(signature),
      wrong: proposed.filter((f) => !truthSet.has(signature(f))).map(signature), criticalErrors
    });
  }
  const ok = rows.filter((r) => !r.error);
  const sum = (k) => ok.reduce((n, r) => n + r[k], 0);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
  const summary = {
    label, items: ok.length, errors: rows.length - ok.length,
    recall: sum("expected") ? sum("hit") / sum("expected") : null,
    precision: sum("proposed") ? sum("correct") / sum("proposed") : null,
    criticalErrors: ok.reduce((n, r) => n + r.criticalErrors.length, 0),
    expectedFields: sum("expected"), proposedFields: sum("proposed"),
    msMedian: ms[Math.floor(ms.length / 2)] ?? null, msP95: ms[Math.floor(ms.length * 0.95)] ?? null, msMax: ms.at(-1) ?? null
  };
  return { summary, rows };
}

const readSet = (name) => JSON.parse(fs.readFileSync(path.join(REF, name), "utf8"));
const en = readSet(SET === "reference" ? "srd-items.json" : `${SET}.json`).slice(0, LIMIT).map((i) => ({ ...i, lang: "en" }));
const fr = SET === "reference" ? readSet("fr-items.json").slice(0, LIMIT).map((i) => ({ ...i, lang: "fr" })) : [];

let resolver = null;
const extra = {};
if (AI) {
  resolver = createOllamaResolver({ url: URL_, model: MODEL, fetch: (...a) => globalThis.fetch(...a), keys: K, timeoutMs: 60000 });
  const t0 = Date.now();
  const warmed = await resolver.warmUp();
  extra.coldLoadMs = Date.now() - t0;
  extra.warmed = warmed;
  if (!warmed) console.warn("Ollama unreachable or no model: the AI run falls back to rules only");
  try { extra.ps = (await (await fetch(`${URL_}/api/ps`)).json()).models?.map((m) => ({ name: m.name, size: m.size, size_vram: m.size_vram })); } catch { /* optional */ }
}

const results = [await measure(en, `${AI ? "ai" : "rules"}-en`, resolver)];
if (fr.length) results.push(await measure(fr, `${AI ? "ai" : "rules"}-fr`, resolver));
const all = { date: new Date().toISOString(), set: SET, ai: AI, model: AI ? MODEL : null, extra, results: results.map((r) => r.summary) };
fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `${SET}-${AI ? "ai" : "rules"}.json`);
fs.writeFileSync(file, JSON.stringify({ ...all, details: results }, null, 1) + "\n");
for (const s of all.results) {
  console.log(`${s.label}: ${s.items} items, recall ${(s.recall * 100).toFixed(1)} %, precision ${(s.precision * 100).toFixed(1)} %, critical errors ${s.criticalErrors}, median ${s.msMedian} ms, p95 ${s.msP95} ms`);
}
console.log("written", file);
