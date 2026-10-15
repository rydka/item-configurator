/**
 * Prompt and constrained JSON schema for the local model. Pure: no Foundry global, no network.
 * The model must quote (`evidence`) the exact passage of the sentence each fact comes from; `toFacts` in
 * `resolver.mjs` rejects any fact whose quote is not in the sentence.
 */

/** Kinds of facts the model may return (all are representable by the parser library). */
export const FACT_KINDS = ["attack", "damage", "extraDamage", "save", "heal", "uses", "activation", "consume", "cast", "effect"];
export const EFFECT_KINDS = ["ac", "attack", "damage", "save", "check", "resistance", "immunity", "vulnerability",
  "abilityScore", "speed"];
/** Effect kinds whose amount is a bonus written as a signed string ("+1"), like the rules do. */
export const BONUS_KINDS = ["ac", "attack", "damage", "save", "check"];
export const PERIODS = ["day", "dawn", "dusk", "sr", "lr"];
export const ACTIVATIONS = ["action", "bonus", "reaction", "legendary", "special"];

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
      spell: { type: "string" },
      level: { type: "integer" },
      charges: { type: "integer" },
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
      scope: { type: "string", enum: scopes }
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
  "Kinds: attack (attack roll), damage (dice and damage type), extraDamage (damage dealt IN ADDITION to the normal damage),",
  "heal (healing dice), save (saving throw: ability, dc, onSave), uses (max uses and period),",
  "activation (action, bonus, reaction), effect (passive: ac, attack, damage, save, check, resistance, immunity,",
  "vulnerability, abilityScore, speed; use effectKind, amount and scope), consume (spends charges: amount) and cast",
  "(casts a spell: spell, level, dc). Never report rarity, attunement, advantage or disadvantage.",
  "The quote must contain the key word of the fact (damage, heal, save, resistance, charges...) and every number you report.",
  "A bonus is a number, not dice.",
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

/** Key words (normalized, no diacritics) a quote must contain, per kind of fact, English and French. */
const KEYWORDS = {
  attack: /attack|attaque|to hit|toucher/,
  damage: /damage|degat|dmg/,
  extraDamage: /damage|degat|dmg/,
  heal: /heal|regain|recover|regagn|recup|soin|hit point|points de vie|\bhp\b|\bpv\b/,
  save: /saving|\bsave|sauvegarde|\bdc\b|\bdd\b/,
  uses: /charge|\buses?\b|utilisation|per (?:day|dawn|dusk|rest)|daily|\bonce\b|par (?:jour|aube|crepuscule|repos)|quotidien/,
  activation: /action|reaction/,
  consume: /charge|expend|depens|consomm|\buse\b/,
  cast: /cast|lanc|incant/
};

const EFFECT_KEYWORDS = {
  ac: /\bac\b|armor class|\bca\b|classe d armure/,
  attack: /attack|attaque/,
  damage: /damage|degat/,
  save: /saving|\bsave|sauvegarde/,
  check: /check|test|ability|caracteristique/,
  resistance: /resist/,
  vulnerability: /vulnerab/,
  immunity: /immun/,
  abilityScore: /score|valeur|ability|caracteristique/,
  speed: /speed|vitesse|\bfly|\bwalk|\bswim|\bclimb|feet|\bft\b|pieds|\bvol/
};

/** Words (normalized) naming a damage type, English and French; a type outside this list is looked up by its key. */
const DAMAGE_TYPE_WORDS = {
  acid: /acid/, bludgeoning: /bludgeon|contond/, cold: /\bcold|froid/, fire: /\bfire|\bfeu\b/, force: /\bforce/,
  lightning: /lightning|foudre/, necrotic: /necrot/, piercing: /pierc|perfor/, poison: /poison/, psychic: /psych/,
  radiant: /radiant/, slashing: /slash|tranch/, thunder: /thunder|tonnerre/
};

/** Words (normalized) naming a recovery period. A day and its dawn are the same thing in these texts. */
const PERIOD_WORDS = {
  day: /\bday|jour|daily|quotidien|dawn|aube/, dawn: /\bday|jour|daily|quotidien|dawn|aube/,
  dusk: /dusk|crepuscule|nightfall|tombee de la nuit/, sr: /\brest|repos/, lr: /\brest|repos/
};

const NUMBER_WORDS = {
  1: ["one", "once", "single", "un", "une"], 2: ["two", "twice", "deux"], 3: ["three", "trois"], 4: ["four", "quatre"],
  5: ["five", "cinq"], 6: ["six"], 7: ["seven", "sept"], 8: ["eight", "huit"], 9: ["nine", "neuf"], 10: ["ten", "dix"]
};

/** Does the (normalized) quote contain the number, as digits or as a word? */
function hasNumber(quote, value) {
  const n = Math.abs(Number(value));
  if ( new RegExp(String.raw`(?:^|[^\d])${n}(?!\d)`).test(quote) ) return true;
  return (NUMBER_WORDS[n] ?? []).some(word => new RegExp(String.raw`\b${word}\b`).test(quote));
}

const hasDice = (quote, number, denomination) => new RegExp(String.raw`(?:^|[^\d])${number}\s?d\s?${denomination}(?!\d)`).test(quote);

/** Does the (normalized) quote name a damage type (by its English or French word, else by its key)? */
function hasDamageType(quote, type) {
  const word = DAMAGE_TYPE_WORDS[type] ?? new RegExp(String.raw`\b${normalizeQuote(type)}`);
  return word.test(quote);
}

/**
 * Why a quoted passage does not justify a fact, or null when it does: it must contain the key word of the kind of
 * fact, every number the fact reports (dice, bonus, DC, amount, count, level, charges, cost) and the words of what
 * it names (damage type, recovery period, spell).
 * @param {object} fact       Raw fact of the model.
 * @param {string} evidence   The quote.
 * @returns {string|null}
 */
export function evidenceProblem(fact, evidence) {
  const quote = normalizeQuote(evidence);
  const kind = fact?.kind;
  const keyword = kind === "effect" ? EFFECT_KEYWORDS[fact.effectKind] : KEYWORDS[kind];
  if ( !keyword ) return `no key word defined for ${kind === "effect" ? fact.effectKind : kind}`;
  if ( !keyword.test(quote) ) return `quote lacks the key word of a ${kind === "effect" ? fact.effectKind : kind} fact`;
  const numbers = [];
  if ( ["damage", "extraDamage", "heal"].includes(kind) ) {
    if ( (fact.number != null) && (fact.denomination != null) && !hasDice(quote, fact.number, fact.denomination) ) {
      return `dice ${fact.number}d${fact.denomination} not in the quote`;
    }
    // The bonus is a number of its own, not a digit of the dice
    if ( fact.bonus && !hasNumber(quote.replace(/\d+\s?d\s?\d+/g, " "), fact.bonus) ) {
      return `number ${fact.bonus} not in the quote`;
    }
    if ( (kind !== "heal") && fact.damageType && !hasDamageType(quote, fact.damageType) ) {
      return `damage type ${fact.damageType} not in the quote`;
    }
  } else if ( kind === "attack" ) {
    if ( fact.bonus ) numbers.push(fact.bonus);
  } else if ( kind === "save" ) {
    numbers.push(fact.dc);
  } else if ( kind === "uses" ) {
    numbers.push(fact.max);
  } else if ( kind === "activation" ) {
    if ( fact.cost != null ) numbers.push(fact.cost);
  } else if ( kind === "consume" ) {
    numbers.push(fact.amount ?? fact.charges);
  } else if ( kind === "cast" ) {
    // Level, attack bonus and charges are inventions unless the quote states them, like the DC
    for ( const value of [fact.dc, fact.level, fact.bonus, fact.charges] ) if ( value != null ) numbers.push(value);
    const spell = normalizeQuote(fact.spell);
    if ( spell && !quote.includes(spell) ) return "spell name not in the quote";
  } else if ( kind === "effect" && fact.amount != null ) {
    numbers.push(fact.amount);
  }
  for ( const value of numbers ) {
    if ( (value != null) && !hasNumber(quote, value) ) return `number ${value} not in the quote`;
  }
  if ( (kind === "uses") && fact.period && PERIOD_WORDS[fact.period] && !PERIOD_WORDS[fact.period].test(quote) ) {
    return `period ${fact.period} not in the quote`;
  }
  return null;
}

/**
 * Is a sentence worth sending to the model? Only a sentence with a number or a known key word can hold a mechanic
 * the rules missed.
 * @param {string} sentence
 * @returns {boolean}
 */
export function worthAsking(sentence) {
  const text = normalizeQuote(sentence);
  if ( /\d/.test(text) ) return true;
  if ( Object.values(NUMBER_WORDS).flat().some(word => new RegExp(String.raw`\b${word}\b`).test(text)) ) return true;
  return [...Object.values(KEYWORDS), ...Object.values(EFFECT_KEYWORDS)].some(re => re.test(text));
}
