// M8: criteria covered by at least one passing test. Reads result files (it never fails, it only measures).
// Usage: node tests/metrics/criteria-coverage.mjs <playwright-results.json> [<vitest-results.json>] [--out=<file>]
//   Playwright: test-env/results/results.json (or the archived one). Vitest: npx vitest run --reporter=json --outputFile=<file>
// A test covers criterion Cn when its title (or its describe block) contains "Cn", "Cn/Cm" or "Cn-Cm" / "Cn–Cm" (a range).
import fs from "node:fs";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
const TOTAL = 18;

/** Criteria named by a title: "C5", "C6/C24", "C5–C7", "C1-C4". */
export function criteriaOf(title) {
  const found = new Set();
  const text = String(title);
  for (const m of text.matchAll(/\bC(\d+)\s*[–-]\s*C?(\d+)\b/g)) {
    for (let n = Number(m[1]); n <= Number(m[2]); n++) found.add(n);
  }
  for (const m of text.matchAll(/\bC(\d+)\b/g)) found.add(Number(m[1]));
  return [...found].filter((n) => n >= 1 && n <= TOTAL);
}

function* playwrightTests(suite, trail = []) {
  for (const spec of suite.specs ?? []) {
    const status = spec.tests?.some((t) => t.results?.some((r) => r.status === "passed")) && spec.ok ? "passed" : (spec.tests?.every((t) => t.status === "skipped") ? "skipped" : "failed");
    yield { title: [...trail, spec.title].join(" "), status };
  }
  for (const child of suite.suites ?? []) yield* playwrightTests(child, [...trail, child.title]);
}

function* vitestTests(report) {
  for (const file of report.testResults ?? []) {
    for (const t of file.assertionResults ?? []) yield { title: t.fullName ?? t.title, status: t.status === "passed" ? "passed" : t.status };
  }
}

const all = [];
for (const file of files) {
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  if (report.suites) for (const suite of report.suites) all.push(...playwrightTests(suite));
  else if (report.testResults) all.push(...vitestTests(report));
}

const coverage = Array.from({ length: TOTAL }, (_, i) => ({ criterion: `C${i + 1}`, passed: 0, failed: 0, skipped: 0 }));
for (const t of all) {
  for (const n of criteriaOf(t.title)) {
    const row = coverage[n - 1];
    if (t.status === "passed") row.passed++;
    else if (t.status === "skipped" || t.status === "pending") row.skipped++;
    else row.failed++;
  }
}
const covered = coverage.filter((r) => r.passed > 0).length;
const result = { covered, total: TOTAL, uncovered: coverage.filter((r) => !r.passed).map((r) => r.criterion), coverage };
if (out) fs.writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
for (const r of coverage) console.log(`${r.criterion.padEnd(4)} passed ${String(r.passed).padStart(3)}  failed ${r.failed}  skipped ${r.skipped}`);
console.log(`M8: ${covered}/${TOTAL} criteria covered by a passing test${result.uncovered.length ? ` (missing: ${result.uncovered.join(", ")})` : ""}`);
