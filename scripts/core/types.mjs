import { armorTypeOf, wornTypeOf } from "./header.mjs";

/** Item types the module can configure, in the order shown to the user (C3). */
export const SUPPORTED_TYPES = ["consumable", "weapon", "equipment", "tool", "loot", "container"];

const plain = (map) => Object.entries(map ?? {}).map(([value, label]) => ({ value, label }));

/**
 * Build the type and subtype choices from the dnd5e configuration.
 * @param {object} config                       `CONFIG.DND5E` (or a serialized copy).
 * @param {(key: string) => string} [localize]  Localizer for the type labels (identity by default); receives
 *                                              `item-configurator.Type.<type>`.
 * @returns {{ type: string, label: string, subtypes: { value: string, subtype?: string, label: string }[] }[]}
 */
export function buildTypeChoices(config, localize = (key) => key) {
  const consumables = [];
  for (const [value, def] of Object.entries(config?.consumableTypes ?? {})) {
    consumables.push({ value, label: def.label });
    for (const [subtype, label] of Object.entries(def.subtypes ?? {})) {
      consumables.push({ value, subtype, label: `${def.label}: ${label}` });
    }
  }
  const subtypes = {
    consumable: consumables,
    weapon: plain(config?.weaponTypes),
    equipment: plain(config?.equipmentTypes),
    tool: plain(config?.toolTypes),
    loot: Object.entries(config?.lootTypes ?? {}).map(([value, def]) => ({ value, label: def.label })),
    container: []
  };
  return SUPPORTED_TYPES.map((type) => ({
    type,
    label: localize(`item-configurator.Type.${type}`),
    subtypes: subtypes[type]
  }));
}

/**
 * Guess the type and subtype to preselect, from the parsed text and the current item (C3).
 * The item's own values win when the text points to the item's current type. Beyond the library's details, the
 * header line (`plan.header`, read by `core/header.mjs`) gives:
 * - "Armor (plate)" in the header, or "Plate Armor +1" as the name -> equipment, `heavy` (the library knows light /
 *   medium / heavy, not the base armor names);
 * - "Ring, …" -> equipment, `ring`;
 * - "Wondrous item, …" with a passive effect (AC, saves…) -> worn equipment: `clothing` (cloak, boots…) or `ring`
 *   when the name says so, else `wondrous`.
 * @param {object|null} plan                      Plan from the parser (`plan.details.weapon|armor|consumable`,
 *                                                `plan.effects`), with `plan.header` when the caller read it.
 * @param {object} current
 * @param {string} current.type                   Current item type.
 * @param {object} [current.system]               Current item system source.
 * @param {string} [current.name]                 Item name (worn wondrous items).
 * @returns {{ type: string, value: string, subtype: string }}
 */
export function guessType(plan, { type, system, name = "" } = {}) {
  const details = plan?.details ?? {};
  const header = plan?.header ?? {};
  let guess = null;
  if (details.weapon) guess = { type: "weapon", value: details.weapon.category ?? "", subtype: "" };
  else if (details.armor) {
    // "Armor (plate)" in the header, else the base armor in the name ("Plate Armor +1", "Breastplate +3")
    guess = { type: "equipment", value: details.armor.type || armorTypeOf(header.kindDetail) || armorTypeOf(name), subtype: "" };
  } else if (details.consumable) guess = { type: "consumable", value: details.consumable.type ?? "", subtype: "" };
  else if (header.kind === "ring") guess = { type: "equipment", value: "ring", subtype: "" };
  else if (header.kind === "wondrous" && plan?.effects?.length) guess = { type: "equipment", value: wornTypeOf(name), subtype: "" };

  const currentType = SUPPORTED_TYPES.includes(type) ? type : null;
  const own = { value: system?.type?.value ?? "", subtype: system?.type?.subtype ?? "" };
  if (!guess) return currentType ? { type: currentType, ...own } : { type: "loot", value: "", subtype: "" };
  if (guess.type === currentType) {
    return { type: guess.type, value: own.value || guess.value, subtype: own.value ? own.subtype : guess.subtype };
  }
  return guess;
}
