// Deterministic stratified selection of the M2/M3 reference set (pure, no Foundry needed).
const BODY = ["light", "medium", "heavy", "shield"];
const C = (...v) => (i) => i.type === "consumable" && v.includes(i.value);
export const STRATA = [
  { id: "weapon", count: 15, test: (i) => i.type === "weapon" },
  { id: "armor", count: 12, test: (i) => i.type === "equipment" && BODY.includes(i.value) },
  { id: "armor-misc", count: 3, test: (i) => i.type === "equipment" && i.value === "clothing" && i.truth.effects.length },
  { id: "potion", count: 12, test: C("potion") },
  { id: "scroll", count: 5, test: C("scroll") },
  { id: "wand", count: 5, test: C("wand", "rod", "wondrous") },
  { id: "consumable-other", count: 7, test: C("food", "poison", "ammo", "trinket") },
  { id: "wondrous", count: 10, test: (i) => i.type === "equipment" && ["wondrous", "ring", "rod", "wand", "trinket"].includes(i.value) && (i.truth.effects.length || i.truth.activities.length) },
  { id: "misc", count: 5, test: (i) => ["tool", "loot", "container"].includes(i.type) }
];

/** Sort by uuid, then take evenly spaced items so the sample spans the whole list. */
export function pickSpread(list, count) {
  const sorted = [...list].sort((a, b) => a.uuid.localeCompare(b.uuid));
  if (sorted.length <= count) return sorted;
  const out = [];
  for (let k = 0; k < count; k++) out.push(sorted[Math.floor((k * sorted.length) / count)]);
  return out;
}

export function selectReference(candidates) {
  const seen = new Set();
  const result = [];
  for (const s of STRATA) {
    const pool = candidates.filter((i) => s.test(i) && !seen.has(i.uuid));
    // Prefer one item per distinct name (compendiums contain duplicates across packs).
    const names = new Set();
    const unique = pool.filter((i) => !names.has(i.name) && names.add(i.name));
    for (const i of pickSpread(unique, s.count)) { seen.add(i.uuid); result.push({ stratum: s.id, ...i }); }
  }
  return result;
}
