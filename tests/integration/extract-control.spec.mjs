// One-shot extraction of a control set from the dnd5e compendia. Runs only with IC_EXTRACT_SET=<name>.
// Writes tests/fixtures/<name>/items-en.json. Excludes every item already used by srd-items.json, by any other set
// under tests/fixtures/, and by the fixtures of the text parser library (any <dir>/objects.json).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../../../../test-env/fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "..", "fixtures");
const NAME = process.env.IC_EXTRACT_SET;
const TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];
const BODY = ["light", "medium", "heavy", "shield"];
const C = (...v) => (i) => i.type === "consumable" && v.includes(i.value);
const STRATA = [
  { id: "weapon", count: 11, test: (i) => i.type === "weapon" },
  { id: "armor", count: 8, test: (i) => i.type === "equipment" && BODY.includes(i.value) },
  { id: "potion", count: 10, test: C("potion") },
  { id: "scroll-wand", count: 6, test: C("scroll", "wand", "rod", "wondrous") },
  { id: "consumable-other", count: 4, test: C("food", "poison", "ammo", "trinket") },
  { id: "wondrous", count: 17, test: (i) => i.type === "equipment" && ["wondrous", "ring", "rod", "wand", "trinket", "clothing"].includes(i.value) && (i.truth.effects.length || i.truth.activities.length) },
  { id: "misc", count: 2, test: (i) => ["tool", "loot", "container"].includes(i.type) }
];

test.skip(!NAME, "Control extraction runs only with IC_EXTRACT_SET=<name>");

test("extract a control set", async ({ foundry }) => {
  test.setTimeout(300_000);
  const data = await foundry(async (types) => {
    const strip = (h) => String(h ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const candidates = [];
    for (const packId of ["dnd5e.items", "dnd5e.equipment24"]) {
      const pack = game.packs.get(packId);
      if (!pack) continue;
      for (const doc of await pack.getDocuments({ type__in: types })) {
        const description = doc.system.description?.value ?? "";
        if (strip(description).length < 80) continue;
        const obj = doc.toObject();
        const system = foundry.utils.deepClone(obj.system);
        delete system.description;
        const activities = Object.values(system.activities ?? {});
        delete system.activities;
        candidates.push({
          uuid: doc.uuid, pack: packId, name: doc.name, type: doc.type,
          value: doc.system.type?.value ?? "", subtype: doc.system.type?.value ?? "",
          description, truth: { system, activities, effects: obj.effects ?? [] }
        });
      }
    }
    return { candidates };
  }, TYPES);

  const read = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
  const used = [read(path.join(FIX, "reference", "srd-items.json"))];
  for (const dir of fs.readdirSync(FIX)) {
    if (dir === NAME || dir === "reference" || dir === "ollama") continue;
    const f = path.join(FIX, dir, "items-en.json");
    if (fs.existsSync(f)) used.push(read(f));
  }
  const usedItems = used.flat();
  const libDir = path.join(HERE, "..", "..", "..", "dnd5e-text-parser", "tests", "fixtures");
  const libNames = new Set();
  for (const dir of fs.readdirSync(libDir)) {
    const file = path.join(libDir, dir, "objects.json");
    if (!fs.existsSync(file)) continue;
    for (const c of read(file).cases ?? []) {
      for (const n of [c.name, c.id, c.ref, String(c.source ?? "").split("/").pop()]) if (n) libNames.add(String(n).toLowerCase());
    }
  }
  const usedUuids = new Set(usedItems.map((i) => i.uuid));
  const usedNames = new Set(usedItems.map((i) => i.name.toLowerCase()));
  const pool = data.candidates.filter((i) => !usedUuids.has(i.uuid) && !usedNames.has(i.name.toLowerCase()) && !libNames.has(i.name.toLowerCase()));

  // Deterministic: sort by uuid, take evenly spaced items (offset 3/4 of a step; earlier sets used 0 and 1/4).
  const chosen = [];
  const seen = new Set();
  for (const s of STRATA) {
    const names = new Set();
    const unique = pool.filter((i) => s.test(i) && !seen.has(i.uuid) && !names.has(i.name) && names.add(i.name))
      .sort((a, b) => a.uuid.localeCompare(b.uuid));
    const step = unique.length / s.count;
    for (let k = 0; k < Math.min(s.count, unique.length); k++) {
      const item = unique[Math.floor(k * step + step * 3 / 4)];
      seen.add(item.uuid);
      chosen.push({ stratum: s.id, ...item });
    }
  }
  fs.mkdirSync(path.join(FIX, NAME), { recursive: true });
  fs.writeFileSync(path.join(FIX, NAME, "items-en.json"), `${JSON.stringify(chosen, null, 1)}\n`);
  fs.writeFileSync(test.info().outputPath("extract-counts.json"), JSON.stringify({ pool: pool.length, chosen: chosen.length }, null, 1));
  expect(chosen.length).toBeGreaterThanOrEqual(50);
});
