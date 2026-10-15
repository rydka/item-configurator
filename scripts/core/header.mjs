/**
 * The header line of an item description, read on the module side: "Wondrous item, rare (requires attunement)",
 * "Armor (plate), rare", "Arme (épée longue), peu commune". The parser library reads the rarity, the attunement and
 * the kind from it but keeps neither the line nor the kind in the plan; the preview needs the line as the source
 * passage of these facts (C12) and the type window needs the kind to preselect the type (C3).
 * Pure: no Foundry global. English and French, same words as the library's lexicon.
 */

/** Rarity words (longest first so "very rare" wins over "rare"). */
const RARITIES = ["very rare", "très rare", "tres rare", "peu commun", "peu commune", "uncommon", "common", "commun", "commune",
  "rare", "legendary", "légendaire", "legendaire", "artifact", "artefact"];

/** Item kinds of the header (`Weapon (longsword)`, `Objet merveilleux`), same keys as the library. */
export const KINDS = {
  weapon: "weapon", arme: "weapon", armor: "armor", armour: "armor", armure: "armor", potion: "potion",
  scroll: "scroll", parchemin: "scroll", wand: "wand", baguette: "wand", rod: "rod", sceptre: "rod", staff: "staff",
  "bâton": "staff", baton: "staff", ring: "ring", anneau: "ring", "wondrous item": "wondrous", "objet merveilleux": "wondrous",
  ammunition: "ammo", munition: "ammo", poison: "poison", food: "food", nourriture: "food"
};

/** Base armors of the header detail ("Armor (plate)") -> dnd5e armor type; longest names first. */
const ARMOR_TYPES = [
  ["studded leather", "light"], ["cuir clouté", "light"], ["cuir cloute", "light"], ["padded", "light"],
  ["matelassée", "light"], ["matelassee", "light"], ["leather", "light"], ["cuir", "light"], ["light", "light"],
  ["légère", "light"], ["legere", "light"],
  ["chain shirt", "medium"], ["chemise de mailles", "medium"], ["scale mail", "medium"], ["écailles", "medium"],
  ["ecailles", "medium"], ["breastplate", "medium"], ["cuirasse", "medium"], ["half plate", "medium"],
  ["half-plate", "medium"], ["demi-plate", "medium"], ["demi plate", "medium"], ["hide", "medium"], ["peau", "medium"],
  ["medium", "medium"], ["intermédiaire", "medium"], ["intermediaire", "medium"],
  ["ring mail", "heavy"], ["armure d'anneaux", "heavy"], ["anneaux", "heavy"], ["chain mail", "heavy"],
  ["cotte de mailles", "heavy"], ["splint", "heavy"], ["clibanion", "heavy"], ["plate", "heavy"], ["harnois", "heavy"],
  ["heavy", "heavy"], ["lourde", "heavy"],
  ["shield", "shield"], ["bouclier", "shield"]
];

/** Worn wondrous items, by a word of their name -> dnd5e equipment type. */
const WORN = [
  [/\b(?:ring|anneau)\b/u, "ring"],
  [/\b(?:cloak|cape|robe|mantle|boots?|gloves?|gauntlets?|belt|hat|helm|helmet|bracers?|vest|slippers|manteau|bottes?|gants?|gantelets?|ceinture|chapeau|heaume|casque|brassards?)\b/u, "clothing"]
];

const normalize = (text) => String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RARITY_WORDS = RARITIES.map(escape).join("|");
const HEADER = new RegExp(
  `^[ \\t]*([^,(\\n]{2,40}?)[ \\t]*(?:\\(([^)\\n]*)\\))?[ \\t]*,[ \\t]*(${RARITY_WORDS})(?![\\p{L}])(?:[ \\t]*\\(([^)\\n]*)\\))?`,
  "imu"
);
const BARE_RARITY = new RegExp(`^[ \\t]*(${RARITY_WORDS})(?![\\p{L}])(?:[ \\t]*\\([^)\\n]*\\))?[ \\t]*$`, "imu");
/** A known kind opening a line, then a comma: a header without rarity ("Wondrous item, (requires attunement)"). */
const KIND_WORDS = Object.keys(KINDS).sort((a, b) => b.length - a.length).map(escape).join("|");
const KIND_HEADER = new RegExp(`^[ \\t]*(${KIND_WORDS})(?![\\p{L}])[ \\t]*(?:\\(([^)\\n]*)\\))?[ \\t]*,[^\\n]*`, "imu");
const ATTUNEMENT = [
  /\brequires?\s+attunement(?:\s+by\s+[^)\n.;]+)?/iu,
  /\b(?:n[ée]cessite|requiert)\s+un\s+lien(?:\s+d['’]harmonisation)?(?:\s+(?:avec|par)\s+[^)\n.;]+)?/iu
];

/** Kind key of a header word ("Wondrous Item", "Armure"), or null. */
export function kindOf(word) {
  const key = normalize(word).replace(/\s+/g, " ");
  const found = Object.entries(KINDS).find(([name]) => normalize(name) === key);
  return found ? found[1] : null;
}

/**
 * Read the header line of a description.
 * @param {string} text   Plain text of the description.
 * @returns {{ raw: string, kind: string|null, kindDetail: string|null, rarity: string|null, attunementRaw: string }}
 *   `raw` is the header line ("" when none), `attunementRaw` the passage stating the attunement ("" when none).
 */
export function readHeader(text) {
  const source = String(text ?? "");
  const result = { raw: "", kind: null, kindDetail: null, rarity: null, attunementRaw: "" };
  let found = source.match(HEADER);
  // Away from the first line, only a known item kind makes a comma-separated phrase a header
  if (found && found.index > 0 && !kindOf(found[1])) found = null;
  // A known kind without a rarity ("Wondrous item, (requires attunement)") is a header too
  const kindOnly = found ? null : source.match(KIND_HEADER);
  let span = null;
  if (found) {
    result.kind = kindOf(found[1]);
    result.kindDetail = found[2]?.trim() || null;
    result.rarity = normalize(found[3]);
    result.raw = found[0].trim();
    span = [found.index, found.index + found[0].length];
  } else if (kindOnly) {
    result.kind = kindOf(kindOnly[1]);
    result.kindDetail = kindOnly[2]?.trim() || null;
    result.raw = kindOnly[0].trim();
    span = [kindOnly.index, kindOnly.index + kindOnly[0].length];
  } else {
    const bare = source.match(BARE_RARITY);
    if (bare) {
      result.rarity = normalize(bare[1]);
      result.raw = bare[0].trim();
      span = [bare.index, bare.index + bare[0].length];
    }
  }
  const attunement = ATTUNEMENT.map((re) => source.match(re)).find(Boolean);
  if (attunement) {
    const inHeader = span && attunement.index >= span[0] && attunement.index < span[1];
    result.attunementRaw = inHeader ? result.raw : attunement[0].trim();
  }
  return result;
}

/**
 * dnd5e armor type of a header detail ("plate", "chain mail", "heavy", "cuir clouté"), or "" when unknown.
 * @param {string|null|undefined} detail
 * @returns {string}
 */
export function armorTypeOf(detail) {
  const text = normalize(detail);
  if (!text) return "";
  return ARMOR_TYPES.find(([name]) => text.includes(normalize(name)))?.[1] ?? "";
}

/**
 * Equipment type of a worn wondrous item from its name: `ring`, `clothing`, or `wondrous` when the name says nothing.
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function wornTypeOf(name) {
  const text = normalize(name);
  return WORN.find(([re]) => re.test(text))?.[1] ?? "wondrous";
}
