/**
 * Prompt and constrained JSON schema for the local model. Pure: no Foundry global, no network.
 * The model must quote (`evidence`) the exact passage of the sentence each fact comes from; `toFacts` in
 * `resolver.mjs` rejects any fact whose quote is not in the sentence.
 */

/** Kinds of facts the model may return. `consume` and `cast` are accepted by the schema but not representable. */
export const FACT_KINDS = ["attack", "damage", "save", "heal", "uses", "activation", "consume", "cast", "effect", "detail"];
export const EFFECT_KINDS = ["ac", "attack", "damage", "save", "check", "resistance", "immunity", "advantage", "abilityScore", "speed"];
export const PERIODS = ["day", "dawn", "dusk", "sr", "lr"];
export const ACTIVATIONS = ["action", "bonus", "reaction", "legendary", "special"];
export const ATTUNEMENTS = ["required", "optional"];

/** Fallback enumerations when no dnd5e `keys` are given (keys of the dnd5e 6.x configuration). */
export const DEFAULT_ENUMS = {
  damageTypes: ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic",
    "radiant", "slashing", "thunder"],
  abilities: ["str", "dex", "con", "int", "wis", "cha"],
  skills: ["acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv", "med", "nat", "prc", "prf", "per", "rel",
    "slt", "ste", "sur"],
  conditionTypes: ["blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated",
    "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"],
  itemRarity: ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"]
};

/**
 * Enumeration for a key group: the dnd5e keys when provided and non-empty, else the defaults.
 * @param {object|undefined} keys
 * @param {string} name
 * @returns {string[]}
 */
export function enumFor(keys, name) {
  const set = keys?.[name];
  if ( set && set.size ) return [...set];
  return DEFAULT_ENUMS[name] ?? [];
}

/**
 * JSON schema (Ollama `format`) of the answer: `{ results: [{ index, facts: [...] }] }`.
 * All fact fields except `kind` and `evidence` are optional; enumerations limit invention.
 * @param {object} [keys]  dnd5e valid keys (sets).
 * @returns {object}
 */
export function buildSchema(keys) {
  const scopes = [...new Set([
    ...enumFor(keys, "abilities"), ...enumFor(keys, "skills"), ...enumFor(keys, "damageTypes"),
    ...enumFor(keys, "conditionTypes"), "mwak", "rwak", "msak", "rsak", "walk", "fly", "swim", "climb", "burrow", "all"
  ])];
  const fact = {
    type: "object",
    properties: {
      kind: { type: "string", enum: FACT_KINDS },
      evidence: { type: "string" },
      number: { type: "integer" },
      denomination: { type: "integer" },
      bonus: { type: "integer" },
      damageType: { type: "string", enum: enumFor(keys, "damageTypes") },
      attackType: { type: "string", enum: ["melee", "ranged"] },
      classification: { type: "string", enum: ["weapon", "spell"] },
      ability: { type: "string", enum: enumFor(keys, "abilities") },
      dc: { type: "integer" },
      onSave: { type: "string", enum: ["half", "none"] },
      max: { type: "integer" },
      period: { type: "string", enum: PERIODS },
      activation: { type: "string", enum: ACTIVATIONS },
      cost: { type: "integer" },
      effectKind: { type: "string", enum: EFFECT_KINDS },
      amount: { type: "integer" },
      scope: { type: "string", enum: scopes },
      rarity: { type: "string", enum: enumFor(keys, "itemRarity") },
      attunement: { type: "string", enum: ATTUNEMENTS }
    },
    required: ["kind", "evidence"]
  };
  return {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: { index: { type: "integer" }, facts: { type: "array", items: fact } },
          required: ["index", "facts"]
        }
      }
    },
    required: ["results"]
  };
}

export const SYSTEM_PROMPT = [
  "You extract game mechanics from sentences of Dungeons & Dragons 5e item descriptions (English or French).",
  "Return JSON only. For each numbered sentence return its index and a list of facts.",
  "Extract ONLY mechanics that the sentence states explicitly. Never infer, never complete, never invent.",
  "If the sentence states no mechanic (flavor text, lore, advice), return an empty facts list.",
  "Every fact has `kind` and `evidence`: `evidence` is an exact, contiguous quote copied from the sentence that proves the fact.",
  "Kinds: attack (attack roll), damage (dice and damage type), heal (healing dice), save (saving throw: ability, dc, onSave),",
  "uses (max uses and period), activation (action, bonus, reaction), effect (passive: ac, attack, damage, save, check,",
  "resistance, immunity, advantage, abilityScore, speed; use effectKind, amount and scope), detail (rarity, attunement),",
  "consume (spends a resource) and cast (casts a spell).",
  "A resistance is not an advantage. A bonus is a number, not dice.",
  "An attack fact needs an attack roll (attack type or bonus); a saving throw is a save fact, never an attack.",
  "",
  "Example 1 (French). Input: [0] Au contact, la lame inflige 1d6 dégâts de feu supplémentaires.",
  "Output: {\"results\":[{\"index\":0,\"facts\":[{\"kind\":\"damage\",\"evidence\":\"1d6 dégâts de feu\",\"number\":1,\"denomination\":6,\"damageType\":\"fire\"}]}]}",
  "Example 2 (English). Input: [0] The hilt is wrapped in dragon leather. [1] You have resistance to cold damage.",
  "Output: {\"results\":[{\"index\":0,\"facts\":[]},{\"index\":1,\"facts\":[{\"kind\":\"effect\",\"evidence\":\"resistance to cold damage\",\"effectKind\":\"resistance\",\"scope\":\"cold\"}]}]}"
].join("\n");

/**
 * Chat messages for a batch of requests of one item.
 * @param {{ sentence: string, context?: { name?: string, itemType?: string } }[]} requests
 * @returns {{ role: string, content: string }[]}
 */
export function buildMessages(requests) {
  const context = requests[0]?.context ?? {};
  const header = [];
  if ( context.name ) header.push(`Item: ${context.name}`);
  if ( context.itemType ) header.push(`Type: ${context.itemType}`);
  const lines = requests.map((request, i) => `[${i}] ${String(request.sentence).replace(/\s+/g, " ").trim()}`);
  const content = `${header.length ? `${header.join("\n")}\n` : ""}Sentences:\n${lines.join("\n")}`;
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }];
}

/**
 * Normalize text for the quote check: lowercase, no diacritics, punctuation and spacing collapsed.
 * @param {string} text
 * @returns {string}
 */
export function normalizeQuote(text) {
  return String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}+-]+/gu, " ").replace(/\s+/g, " ").trim();
}

/**
 * Is `evidence` an exact passage of `sentence` (after normalization)?
 * @param {string} evidence
 * @param {string} sentence
 * @returns {boolean}
 */
export function isQuoted(evidence, sentence) {
  const quote = normalizeQuote(evidence);
  if ( quote.length < 3 ) return false;
  return ` ${normalizeQuote(sentence)} `.includes(` ${quote} `);
}
