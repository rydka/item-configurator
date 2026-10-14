// One-shot extraction of the M2/M3 reference set from the dnd5e compendiums.
// Runs only with IC_EXTRACT=1. Writes tests/fixtures/reference/{srd-items,keys,type-config}.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { selectReference } from "../metrics/select-reference.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "reference");
const TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];

test.skip(!process.env.IC_EXTRACT, "Reference extraction runs only with IC_EXTRACT=1");

test("extract the reference set and the config snapshots", async ({ foundry }) => {
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
          description,
          truth: { system, activities, effects: obj.effects ?? [] }
        });
      }
    }
    const C = CONFIG.DND5E;
    const dict = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) =>
      [k, game.i18n.localize(typeof v === "string" ? v : (v?.label ?? v?.name ?? k))]));
    const keys = {};
    for (const name of ["damageTypes", "healingTypes", "abilities", "skills", "conditions", "statusEffects",
      "activityActivationTypes", "itemRarity", "weaponTypes", "armorTypes", "consumableTypes", "toolTypes",
      "lootTypes", "miscEquipmentTypes", "itemProperties", "spellSchools", "scalingModes", "limitedUsePeriods",
      "attackClassifications", "attackModes", "weaponProficiencies", "armorProficiencies", "currencies",
      "timePeriods", "movementTypes", "senses", "damageModifiers", "creatureTypes", "areaTargetTypes",
      "individualTargetTypes", "distanceUnits", "attackTypes", "itemActionTypes", "saves"]) {
      if (C[name]) keys[name] = dict(C[name]);
    }
    const typeConfig = {
      itemTypes: Object.keys(CONFIG.Item.dataModels ?? {}).filter((t) => types.includes(t)),
      subtypes: {
        weapon: Object.keys(C.weaponTypes ?? {}), equipment: Object.keys({ ...C.equipmentTypes }),
        consumable: Object.keys(C.consumableTypes ?? {}), tool: Object.keys(C.toolTypes ?? {}),
        loot: Object.keys(C.lootTypes ?? {}), container: []
      },
      activityTypes: Object.keys(CONFIG.DND5E.activityTypes ?? {}),
      versions: { foundry: game.version, dnd5e: game.system.version }
    };
    return { candidates, keys, typeConfig };
  }, TYPES);

  expect(data.candidates.length).toBeGreaterThan(100);
  const selected = selectReference(data.candidates);
  fs.mkdirSync(OUT, { recursive: true });
  const w = (f, o) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(o, null, 1) + "\n");
  w("srd-items.json", selected);
  w("keys.json", data.keys);
  w("type-config.json", data.typeConfig);
  const counts = {};
  for (const i of selected) counts[i.stratum] = (counts[i.stratum] ?? 0) + 1;
  fs.writeFileSync(test.info().outputPath("extract-counts.json"),
    JSON.stringify({ candidates: data.candidates.length, selected: selected.length, counts }, null, 1));
  expect(selected.length).toBe(70);
});
