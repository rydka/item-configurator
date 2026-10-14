import { SUPPORTED_TYPES } from "./types.mjs";

const DESCRIPTION = ["description", "identifier", "source"];
const IDENTIFIABLE = ["identified", "unidentified"];
const PHYSICAL = ["container", "quantity", "weight", "price", "rarities"];
const EQUIPPABLE = ["attunement", "attuned", "equipped"];

/** Fields shared with other types, per target type (dnd5e 6 templates, `data/item/*.mjs`). */
const TEMPLATE_FIELDS = {
  weapon: [...DESCRIPTION, ...IDENTIFIABLE, ...PHYSICAL, ...EQUIPPABLE],
  equipment: [...DESCRIPTION, ...IDENTIFIABLE, ...PHYSICAL, ...EQUIPPABLE],
  consumable: [...DESCRIPTION, ...IDENTIFIABLE, ...PHYSICAL, ...EQUIPPABLE],
  tool: [...DESCRIPTION, ...IDENTIFIABLE, ...PHYSICAL, ...EQUIPPABLE],
  loot: [...DESCRIPTION, ...IDENTIFIABLE, ...PHYSICAL],
  container: [...DESCRIPTION, ...IDENTIFIABLE, ...PHYSICAL, ...EQUIPPABLE]
};

/**
 * Build the `system` source of an item converted to another type (C4). The result is meant to be written with
 * `update({ type, system: _replace(result) })`. Only the fields common to both templates are kept (description,
 * source, identification, container, quantity, weight, price, rarity, attunement, equipped); activities, uses, type
 * and type-specific fields are dropped (the pre-conversion state is kept in the undo snapshot). The target's
 * type/subtype are not set here.
 * @param {object} oldSystem   `system` source of the item before the conversion.
 * @param {string} fromType    Current type.
 * @param {string} toType      Target type.
 * @returns {object}
 */
export function carryOverSystem(oldSystem, fromType, toType) {
  if (!SUPPORTED_TYPES.includes(toType)) throw new Error(`Unsupported item type: ${toType}`);
  if (fromType === toType) return structuredClone(oldSystem ?? {});
  const result = {};
  for (const key of TEMPLATE_FIELDS[toType]) {
    if (oldSystem?.[key] !== undefined) result[key] = structuredClone(oldSystem[key]);
  }
  return result;
}
