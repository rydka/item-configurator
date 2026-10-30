// Compares a rules run with an AI run of run-reference.mjs (same set): what the AI added, lost, and how right it was.
// Usage: node tests/metrics/analyze-ai.mjs <rules.json> <ai.json> [--verbose]
// The inputs are the per-item details written by run-reference.mjs (not the totals-only held-out summaries).
import fs from "node:fs";

const [rulesFile, aiFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const verbose = process.argv.includes("--verbose");
const load = (file) => {
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  return (json.details ?? json).flatMap((d) => d.rows ?? d);
};
const rules = new Map(load(rulesFile).map((r) => [r.name, r]));
const ai = load(aiFile);

const family = (sig) => {
  const p = sig.split("=")[0];
  if (p.startsWith("effect.")) return "effect";
  if (p.startsWith("dice.")) return "dice";
  if (p.startsWith("activity.") || p.startsWith("save.")) return "activity";
  return "detail";
};

const totals = {
  items: 0, itemsWithAiCall: 0, rejectedByValidation: 0, hitsGained: 0, hitsLost: 0,
  added: { total: 0, correct: 0, "true-not-in-truth": 0, unverified: 0, "wrong-value": 0 },
  byFamily: {}, removed: 0
};
const rows = [];
for (const r of ai) {
  const base = rules.get(r.name);
  if (!base || r.error) continue;
  totals.items++;
  totals.rejectedByValidation += r.aiRejected ?? 0;
  totals.hitsGained += r.hit - base.hit;
  const baseWrong = new Map();
  for (const w of base.wrong) baseWrong.set(w.sig, (baseWrong.get(w.sig) ?? 0) + 1);
  // Wrong facts the AI run has and the rules run does not
  const added = [];
  const seen = new Map();
  for (const w of r.wrong) {
    const n = (seen.get(w.sig) ?? 0) + 1;
    seen.set(w.sig, n);
    if (n > (baseWrong.get(w.sig) ?? 0)) added.push(w);
  }
  const newCorrect = r.correct - base.correct;
  totals.added.total += added.length + Math.max(0, newCorrect);
  totals.added.correct += Math.max(0, newCorrect);
  for (const w of added) {
    totals.added[w.kind]++;
    const key = `${w.kind}/${family(w.sig)}`;
    totals.byFamily[key] = (totals.byFamily[key] ?? 0) + 1;
  }
  if (added.length || newCorrect || r.hit !== base.hit) rows.push({ name: r.name, gained: r.hit - base.hit, newCorrect, added: added.map((w) => `${w.kind}:${w.sig}`) });
}
console.log(JSON.stringify(totals, null, 1));
if (verbose) for (const row of rows) console.log(JSON.stringify(row));
