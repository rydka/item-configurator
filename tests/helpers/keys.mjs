// dnd5e configuration and valid keys rebuilt from the instantaneous snapshot of CONFIG.DND5E (fixtures/reference).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keysFromConfig } from "dnd5e-text-parser";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "reference");
export const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts), "utf8"));

/** A CONFIG.DND5E-like object (consumable/loot types as `{ label }`, `equipmentTypes` merged). */
export function dnd5eConfig() {
  const raw = readJson(dir, "keys.json");
  const labelled = (map) => Object.fromEntries(Object.entries(map).map(([k, label]) => [k, { label }]));
  // Groups the 2026-10 extraction missed (re-run it with IC_EXTRACT=1 to get the real ones); dnd5e 6.0.6 values.
  const supplement = {
    attunementTypes: { required: "Required", optional: "Optional" },
    conditionTypes: Object.fromEntries(["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled",
      "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]
      .map((k) => [k, k])),
    activityTypes: Object.fromEntries(referenceFile("type-config.json").activityTypes.map((k) => [k, k]))
  };
  return {
    ...supplement,
    ...raw,
    consumableTypes: labelled(raw.consumableTypes),
    lootTypes: labelled(raw.lootTypes),
    equipmentTypes: { ...raw.armorTypes, ...raw.miscEquipmentTypes }
  };
}

/** Valid keys (sets) as given to the parser and to the AI client. */
export const keys = () => keysFromConfig(dnd5eConfig());

/** A JSON file of tests/fixtures/reference. */
export const referenceFile = (name) => readJson(dir, name);
