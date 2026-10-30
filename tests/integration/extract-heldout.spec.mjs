// One-shot extraction of the held-out set and of the spell names. Runs only with IC_EXTRACT_HELDOUT=1.
// Writes tests/fixtures/heldout/items-en.json (candidates outside srd-items.json and outside the library fixtures)
// and tests/fixtures/reference/spell-names.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../../../../test-env/fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(HERE, "..", "fixtures", "reference");
const OUT = path.join(HERE, "..", "fixtures", "heldout");
const TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];
const BODY = ["light", "medium", "heavy", "shield"];
const C = (...v) => (i) => i.type === "consumable" && v.includes(i.value);
const STRATA = [
  { id: "weapon", count: 8, test: (i) => i.type === "weapon" },
  { id: "armor", count: 6, test: (i) => i.type === "equipment" && BODY.includes(i.value) },
  { id: "potion", count: 7, test: C("potion") },
  { id: "scroll-wand", count: 4, test: C("scroll", "wand", "rod", "wondrous") },
  { id: "consumable-other", count: 3, test: C("food", "poison", "ammo", "trinket") },
  { id: "wondrous", count: 10, test: (i) => i.type === "equipment" && ["wondrous", "ring", "rod", "wand", "trinket", "clothing"].includes(i.value) && (i.truth.effects.length || i.truth.activities.length) },
  { id: "misc", count: 2, test: (i) => ["tool", "loot", "container"].includes(i.type) }
];

test.skip(!process.env.IC_EXTRACT_HELDOUT, "Held-out extraction runs only with IC_EXTRACT_HELDOUT=1");

test("extract the held-out set and the spell names", async ({ foundry }) => {
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
    const spells = new Set();
    for (const packId of ["dnd5e.spells", "dnd5e.spells24"]) {
      const pack = game.packs.get(packId);
      if (pack) for (const entry of await pack.getIndex()) spells.add(entry.name);
    }
    return { candidates, spells: [...spells].sort() };
  }, TYPES);

  fs.writeFileSync(path.join(REF, "spell-names.json"), `${JSON.stringify(data.spells)}\n`);

  const used = JSON.parse(fs.readFileSync(path.join(REF, "srd-items.json"), "utf8"));
  const libDir = path.join(HERE, "..", "..", "..", "dnd5e-text-parser", "tests", "fixtures");
  const libNames = new Set();
  for (const f of ["control/objects.json", "reference/objects.json"]) {
    const file = path.join(libDir, f);
    if (!fs.existsSync(file)) continue;
    for (const c of JSON.parse(fs.readFileSync(file, "utf8")).cases ?? []) for (const n of [c.name, c.id, c.ref]) if (n) libNames.add(String(n).toLowerCase());
  }
  const usedUuids = new Set(used.map((i) => i.uuid));
  const usedNames = new Set(used.map((i) => i.name.toLowerCase()));
  const pool = data.candidates.filter((i) => !usedUuids.has(i.uuid) && !usedNames.has(i.name.toLowerCase()) && !libNames.has(i.name.toLowerCase()));

  // Deterministic: sort by uuid, then take evenly spaced items shifted by half a step (the reference set starts at 0).
  const chosen = [];
  const seen = new Set();
  for (const s of STRATA) {
    const names = new Set();
    const unique = pool.filter((i) => s.test(i) && !seen.has(i.uuid) && !names.has(i.name) && names.add(i.name))
      .sort((a, b) => a.uuid.localeCompare(b.uuid));
    const step = unique.length / s.count;
    for (let k = 0; k < Math.min(s.count, unique.length); k++) {
      const item = unique[Math.floor(k * step + step / 2)];
      seen.add(item.uuid);
      chosen.push({ stratum: s.id, ...item });
    }
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "items-en.json"), `${JSON.stringify(chosen, null, 1)}\n`);
  fs.writeFileSync(test.info().outputPath("extract-counts.json"), JSON.stringify({ pool: pool.length, chosen: chosen.length, spells: data.spells.length }, null, 1));
  expect(chosen.length).toBeGreaterThanOrEqual(40);
});
