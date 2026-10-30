// One-shot snapshot of the raw CONFIG objects `schemaEnums` reads (T0). Runs only with IC_EXTRACT=1.
// Writes tests/fixtures/reference/schema-enums.json. Usage (workshop root):
//   IC_EXTRACT=1 FOUNDRY_TEST_INSTANCE=6 node test-env/run.mjs item-configurator --grep "schema enums"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../../../../test-env/fixtures.mjs";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "reference");

test.skip(!process.env.IC_EXTRACT, "Snapshot runs only with IC_EXTRACT=1");

test("extract the schema enums snapshot", async ({ foundry }) => {
  const data = await foundry(() => {
    const C = CONFIG.DND5E;
    const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    const labelOf = (v, k) => {
      const raw = typeof v === "string" ? v : (v?.label ?? v?.name ?? v?.abbreviation ?? k);
      return game.i18n.localize(String(raw));
    };
    const dict = (o) => sorted(Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, labelOf(v, k)])));
    const names = ["damageTypes", "healingTypes", "abilities", "skills", "conditionTypes", "activityActivationTypes",
      "itemRarity", "attunementTypes", "currencies", "limitedUsePeriods", "timePeriods", "timeUnits", "distanceUnits",
      "areaTargetTypes", "individualTargetTypes", "armorTypes", "miscEquipmentTypes", "movementTypes", "movementUnits",
      "senses", "attackClassifications", "attackTypes", "attackModes", "damageModifiers", "weaponTypes", "scalingModes",
      "itemProperties", "recoveryTypes", "activityConsumptionTypes", "abilityActivationTypes"];
    const config = {};
    for (const n of names) if (C[n]) config[n] = dict(C[n]);
    config.activityTypes = Object.keys(C.activityTypes ?? {}).sort();
    config.equipmentTypes = dict(C.equipmentTypes);
    config.validProperties = Object.fromEntries(Object.entries(C.validProperties ?? {})
      .map(([t, set]) => [t, [...set].sort()]));
    config.statusEffects = Object.keys(C.statusEffects ?? {}).sort();
    config.coreStatusEffects = (CONFIG.statusEffects ?? []).map((s) => s.id).sort();
    config.itemProperties = dict(C.itemProperties);
    config.conditionTypes = dict(C.conditionTypes);
    const units = CONST.ACTIVE_EFFECT_DURATION_UNITS ?? {};
    return {
      versions: { foundry: game.version, dnd5e: game.system.version },
      dnd5e: config,
      const: {
        ACTIVE_EFFECT_DURATION_UNITS: units,
        ACTIVE_EFFECT_MODES: CONST.ACTIVE_EFFECT_MODES ?? null
      }
    };
  });
  expect(Object.keys(data.dnd5e.timePeriods ?? {}).length).toBeGreaterThan(5);
  expect(Object.keys(data.dnd5e.distanceUnits ?? {}).length).toBeGreaterThan(3);
  expect(Object.keys(data.dnd5e.equipmentTypes ?? {}).length).toBeGreaterThan(3);
  expect(Object.keys(data.const.ACTIVE_EFFECT_DURATION_UNITS).length).toBeGreaterThan(3);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "schema-enums.json"), `${JSON.stringify(data, null, 1)}\n`);
});
