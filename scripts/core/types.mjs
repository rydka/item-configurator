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
 * The item's own values win when the text points to the item's current type.
 * @param {object|null} plan                      Plan from the parser (`plan.details.weapon|armor|consumable`).
 * @param {object} current
 * @param {string} current.type                   Current item type.
 * @param {object} [current.system]               Current item system source.
 * @returns {{ type: string, value: string, subtype: string }}
 */
export function guessType(plan, { type, system } = {}) {
  const details = plan?.details ?? {};
  let guess = null;
  if (details.weapon) guess = { type: "weapon", value: details.weapon.category ?? "", subtype: "" };
  else if (details.armor) guess = { type: "equipment", value: details.armor.type ?? "", subtype: "" };
  else if (details.consumable) guess = { type: "consumable", value: details.consumable.type ?? "", subtype: "" };

  const currentType = SUPPORTED_TYPES.includes(type) ? type : null;
  const own = { value: system?.type?.value ?? "", subtype: system?.type?.subtype ?? "" };
  if (!guess) return currentType ? { type: currentType, ...own } : { type: "loot", value: "", subtype: "" };
  if (guess.type === currentType) {
    return { type: guess.type, value: own.value || guess.value, subtype: own.value ? own.subtype : guess.subtype };
  }
  return guess;
}
