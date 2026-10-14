// M5: system memory used by Ollama during a run of run-reference.mjs --ai.
// Usage: node tests/metrics/measure-memory.mjs --set=reference [--model=llama3.1:8b] [--out=<file>]
// Baseline = model unloaded (keep_alive 0). Samples (about every 1.5 s, PowerShell): working set of the ollama* and
// llama-server* processes, and the free physical memory. M5 = max - baseline of the working set; free memory and
// /api/ps (size, size_vram) are reported as well. Measure only: never fails.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? d;
const here = path.dirname(fileURLToPath(import.meta.url));
const SET = arg("set", "reference");
const MODEL = arg("model", "llama3.1:8b");
const URL_ = arg("url", "http://localhost:11434");
const OUT = arg("out", path.join(here, "..", "..", "..", "..", "reports", "tests", "item-configurator", "initial", "metrics", `${SET}-memory.json`));

const PS = "$p = Get-Process | Where-Object { $_.ProcessName -like 'ollama*' -or $_.ProcessName -like 'llama-server*' } | Measure-Object WorkingSet64 -Sum; "
  + "$f = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory; \"$($p.Sum) $f\"";
const sample = () => {
  const [ws, free] = execFileSync("powershell", ["-NoProfile", "-Command", PS], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  return { t: Date.now(), workingSetBytes: ws || 0, freeKb: free };
};

await fetch(`${URL_}/api/generate`, { method: "POST", body: JSON.stringify({ model: MODEL, keep_alive: 0 }) }).catch(() => {});
await new Promise((r) => setTimeout(r, 3000));
const baseline = sample();

const samples = [];
const child = spawn(process.execPath, [path.join(here, "run-reference.mjs"), `--set=${SET}`, "--ai", `--model=${MODEL}`], { stdio: "ignore", env: process.env });
let done = false;
child.on("exit", () => { done = true; });
while (!done) {
  samples.push(sample());
  await new Promise((r) => setTimeout(r, 1000));
}
const ps = await fetch(`${URL_}/api/ps`).then((r) => r.json()).catch(() => null);
const maxWs = Math.max(...samples.map((s) => s.workingSetBytes));
const minFree = Math.min(...samples.map((s) => s.freeKb));
const result = {
  set: SET, model: MODEL, samples: samples.length,
  baselineWorkingSetMB: Math.round(baseline.workingSetBytes / 1048576),
  maxWorkingSetMB: Math.round(maxWs / 1048576),
  m5WorkingSetDeltaMB: Math.round((maxWs - baseline.workingSetBytes) / 1048576),
  freePhysicalMemoryDropMB: Math.round((baseline.freeKb - minFree) / 1024),
  ps: ps?.models?.map((m) => ({ name: m.name, size: m.size, size_vram: m.size_vram }))
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(result, null, 1)}\n`);
console.log(JSON.stringify(result));
