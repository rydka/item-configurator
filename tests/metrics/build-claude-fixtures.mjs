// Builds tests/fixtures/claude/*: simulated Messages API answers for the Claude-first mode (ring, compass, failure cases).
// Hand-written, no network. Usage: node tests/metrics/build-claude-fixtures.mjs
// The shape follows design-claude-first.md section 2 (numbers are numbers, absence is "" / 0 / [], optional blocks are omitted).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "claude");
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- Inputs ---------------------------------------------------------------------------------------------------
const ring = {
  name: "L'Anneau du Dernier Souffle", type: "equipment", value: "ring", subtypeLabel: "Anneau",
  paragraphs: [
    "Anneau, peu commun (nécessite un lien d'harmonisation)",
    "Forgé dans l'argent noirci, cet anneau serti d'une pierre grise garde la chaleur de celui qui le porte, même lorsque la vie s'enfuit.",
    "Le dernier souffle. Une fois par repos long, quand vous tombez à 0 point de vie sans être tué sur le coup, vous pouvez utiliser votre réaction pour tomber à 1 point de vie à la place et gagner 1d6 + votre bonus de maîtrise points de vie temporaires.",
    "Le prix du sursis. Jusqu'à la fin de votre prochain tour, votre vitesse est réduite de moitié et vous ne pouvez pas effectuer de réactions."
  ]
};
const compass = {
  name: "La Boussole des Chemins Oubliés", type: "equipment", value: "wondrous", subtypeLabel: "Objet merveilleux",
  paragraphs: [
    "Objet merveilleux, peu commun (ne nécessite pas d'harmonisation)",
    "Le bronze terni de cette boussole est gravé d'une inscription que personne ne sait plus lire ; son aiguille ne désigne jamais le nord.",
    "Écho des passages. En utilisant une action, vous faites vibrer l'aiguille vers le passage le plus proche dans un rayon de 9 mètres autour de vous, sans révéler comment l'ouvrir. Pendant 1 minute, elle suit ce passage, mais elle reste inefficace contre les passages cachés par une illusion.",
    "Le chemin le plus sûr. Quand vous faites un test de Sagesse (Survie) pour vous orienter ou éviter de vous perdre, vous pouvez lancer 1d4 et ajouter le résultat à votre test, après avoir lancé le d20 mais avant de connaître le résultat.",
    "Mémoire des pierres. Une fois par aube, vous pouvez mémoriser le trajet que vous parcourez. Durant les 10 prochaines minutes, la boussole garde en mémoire chaque virage que vous prenez, sans garantir que le trajet reste praticable.",
    "Fil lumineux. Pendant les 24 heures suivantes, vous pouvez utiliser une action pour faire apparaître un fil lumineux qui retrace votre dernier trajet ; seul vous le voyez."
  ]
};
for (const item of [ring, compass]) item.html = item.paragraphs.map((p) => `<p>${p}</p>`).join("");

// ---- Building blocks ------------------------------------------------------------------------------------------
const dice = (number, denomination, bonus, types) => ({ number, denomination, bonus, types });
const activity = (o) => ({
  ref: "a1", type: "utility", name: "", quotes: [], certainty: "high", inferred: [],
  activation: { type: "action", value: 0, condition: "" }, effects: [], ...o
});
const effect = (o) => ({ ref: "e1", name: "", quotes: [], certainty: "high", inferred: false, transfer: false, changes: [], ...o });
const detail = (field, quotes, o = {}) => ({ field, quotes, certainty: "high", inferred: false, ...o });

const ringJson = {
  details: [
    detail("rarity", ["peu commun"], { key: "uncommon" }),
    detail("attunement", ["nécessite un lien d'harmonisation"], { key: "required" }),
    detail("weaponProperty", ["peu commun"], { key: "mgc", inferred: true, certainty: "medium" })
  ],
  uses: {
    max: 1, recovery: [{ period: "lr", type: "recoverAll", formula: "" }], autoDestroy: false,
    quotes: ["Une fois par repos long"], certainty: "high", inferred: false
  },
  activities: [activity({
    ref: "a1", type: "heal", name: "Le dernier souffle",
    quotes: ["vous pouvez utiliser votre réaction", "1d6 + votre bonus de maîtrise points de vie temporaires"],
    inferred: ["range", "target"],
    activation: { type: "reaction", value: 0, condition: "tomber à 0 point de vie sans être tué sur le coup" },
    range: { value: 0, units: "self" },
    target: { template: { type: "", size: 0, units: "ft" }, affects: { type: "self", count: 0, special: "" } },
    consume: { target: "itemUses", amount: 1 },
    healing: dice(1, 6, "@prof", ["temphp"]),
    effects: ["e1"]
  })],
  effects: [effect({
    ref: "e1", name: "Le prix du sursis",
    quotes: ["Jusqu'à la fin de votre prochain tour, votre vitesse est réduite de moitié"],
    changes: [{ kind: "speedMultiplier", scope: "", on: "", value: "0.5" }],
    duration: { value: 0, units: "", until: "sourceEnd" }
  })],
  notAutomated: [
    { quote: "tomber à 1 point de vie à la place", reason: "Les points de vie à 1 ne sont pas automatisés" },
    { quote: "vous ne pouvez pas effectuer de réactions", reason: "Restriction d'actions non automatisée" }
  ],
  flavor: ["Forgé dans l'argent noirci, cet anneau serti d'une pierre grise garde la chaleur de celui qui le porte"]
};

const compassJson = {
  details: [
    detail("rarity", ["peu commun"], { key: "uncommon" }),
    detail("attunement", ["ne nécessite pas d'harmonisation"], { key: "" }),
    detail("weaponProperty", ["peu commun"], { key: "mgc", inferred: true, certainty: "medium" })
  ],
  activities: [
    activity({
      ref: "a1", name: "Écho des passages",
      quotes: ["En utilisant une action", "dans un rayon de 9 mètres autour de vous", "Pendant 1 minute"],
      range: { value: 0, units: "self" },
      target: { template: { type: "radius", size: 9, units: "m" }, affects: { type: "", count: 0, special: "" } },
      duration: { value: 1, units: "minute", concentration: false }
    }),
    activity({
      ref: "a2", name: "Le chemin le plus sûr",
      quotes: ["Quand vous faites un test de Sagesse (Survie) pour vous orienter ou éviter de vous perdre", "vous pouvez lancer 1d4 et ajouter le résultat à votre test"],
      activation: { type: "special", value: 0, condition: "Test de Sagesse (Survie) pour s'orienter, après le d20, avant le résultat" },
      roll: { formula: "1d4", name: "Le chemin le plus sûr" }
    }),
    activity({
      ref: "a3", name: "Mémoire des pierres", quotes: ["Une fois par aube", "Durant les 10 prochaines minutes"],
      inferred: ["activation"], certainty: "medium",
      duration: { value: 10, units: "minute", concentration: false },
      uses: { max: 1, period: "dawn" }, consume: { target: "activityUses", amount: 1 }
    }),
    activity({
      ref: "a4", name: "Fil lumineux", quotes: ["Pendant les 24 heures suivantes, vous pouvez utiliser une action"],
      inferred: ["range"],
      activation: { type: "action", value: 0, condition: "dans les 24 heures suivant la mémorisation" },
      range: { value: 0, units: "self" }
    })
  ],
  effects: [],
  notAutomated: [
    { quote: "sans révéler comment l'ouvrir", reason: "L'aiguille ne révèle pas l'ouverture" },
    { quote: "inefficace contre les passages cachés par une illusion", reason: "Exception non automatisée" },
    { quote: "pour vous orienter ou éviter de vous perdre", reason: "Condition narrative du d4" },
    { quote: "mémoriser le trajet que vous parcourez", reason: "Mémorisation du trajet" },
    { quote: "seul vous le voyez", reason: "Visibilité du fil" },
    { quote: "sans garantir que le trajet reste praticable", reason: "Trajet non garanti" }
  ],
  flavor: ["Le bronze terni de cette boussole est gravé d'une inscription que personne ne sait plus lire"]
};

// ---- Envelopes (full Messages API payloads) -------------------------------------------------------------------
const MODEL = "claude-sonnet-5-5";
let n = 0;
const usage = (o = {}) => ({ input_tokens: 612, output_tokens: 840, cache_creation_input_tokens: 0, cache_read_input_tokens: 3104, ...o });
const envelope = (json, o = {}) => ({
  id: `msg_sim${String(++n).padStart(4, "0")}`, type: "message", role: "assistant", model: MODEL,
  content: [{ type: "text", text: typeof json === "string" ? json : JSON.stringify(json) }],
  stop_reason: "end_turn", stop_sequence: null, usage: usage(), ...o
});
const errorBody = (status, type, message) => ({ status, body: { type: "error", error: { type, message }, request_id: "req_sim" } });

// ---- Cases ----------------------------------------------------------------------------------------------------
const cases = [];
const files = {};
/**
 * @param {string} id            File name without extension.
 * @param {object} input         Item sent (name, type, value, paragraphs).
 * @param {object|string} json   Claude's JSON (or raw text).
 * @param {object} expect        What the validator / replay must produce (loose, see README).
 * @param {object} [extra]       `envelope` overrides, `world`.
 */
function add(id, input, json, expect, extra = {}) {
  files[`${id}.json`] = {
    input: { name: input.name, type: input.type, value: input.value, subtypeLabel: input.subtypeLabel, paragraphs: input.paragraphs },
    response: envelope(json, extra.envelope),
    world: extra.world ?? { metric: false }
  };
  cases.push({ id, file: `${id}.json`, ...expect });
}
const withText = (item, index, from, to) => {
  const c = clone(item);
  if (!c.paragraphs[index].includes(from)) throw new Error(`text ${from} not in paragraph ${index}`);
  c.paragraphs[index] = c.paragraphs[index].replace(from, to);
  c.html = c.paragraphs.map((p) => `<p>${p}</p>`).join("");
  return c;
};

// Valid answers
add("ring", ring, ringJson, { kind: "valid", expectedFile: "expected.json#ring", uncovered: [], rejections: [] });
add("compass", compass, compassJson, {
  kind: "valid", expectedFile: "expected.json#compass", uncovered: [], rejections: [],
  corrections: [{ ref: "a1", field: "target.template.size", reason: "9 m -> 30 ft (imperial world)" }]
});
add("compass-metric", compass, compassJson, {
  kind: "valid", note: "metric world: 9 m kept, no distance correction", expectedFile: "expected.json#compass", corrections: []
}, { world: { metric: true } });

// Corrected or rejected (section 3)
{
  const j = clone(compassJson);
  j.activities[1].quotes = ["Quand vous marchez sur une dalle gravée, une lueur vous guide vers la sortie"];
  add("quote-absent", compass, j, { kind: "invalid", rejections: [{ ref: "a2", field: "quotes", reason: "quote not in description" }], keep: ["a1", "a3", "a4"] });
}
{
  const j = clone(ringJson);
  j.activities[0].healing.types = ["tempfoo"];
  add("unknown-key-essential", ring, j, { kind: "invalid", rejections: [{ ref: "a1", field: "healing.types", reason: "unknown healing type" }] });
}
{
  const j = clone(compassJson);
  j.activities[0].range = { value: 0, units: "parsec" };
  add("unknown-key-optional", compass, j, { kind: "invalid", corrections: [{ ref: "a1", field: "range", reason: "unknown distance unit, field removed" }], keep: ["a1"] });
}
{
  const r = withText(ring, 2, "1d6 + votre bonus", "1d7 + votre bonus");
  const j = clone(ringJson);
  j.activities[0].quotes[1] = "1d7 + votre bonus de maîtrise points de vie temporaires";
  j.activities[0].healing.denomination = 7;
  add("out-of-bounds-dice", r, j, { kind: "invalid", rejections: [{ ref: "a1", field: "healing", reason: "dice faces not in {2,3,4,6,8,10,12,20,100}" }] });
}
{
  const r = withText(compass, 4, "Durant les 10 prochaines minutes", "Durant les 5000 prochaines minutes");
  const j = clone(compassJson);
  j.activities[2].quotes[1] = "Durant les 5000 prochaines minutes";
  j.activities[2].duration.value = 5000;
  add("out-of-bounds-duration", r, j, { kind: "invalid", corrections: [{ ref: "a3", field: "duration", reason: "duration above 1000, field removed" }], keep: ["a3"] });
}
{
  const j = clone(compassJson);
  j.activities[1].roll.formula = "1d4 + @actor.level";
  add("formula-actor", compass, j, { kind: "invalid", corrections: [{ ref: "a2", field: "roll", reason: "formula outside the whitelist, field removed" }], keep: ["a2"] });
}
{
  const j = clone(compassJson);
  j.activities[2].duration.value = 12;
  add("number-not-cited", compass, j, { kind: "invalid", corrections: [{ ref: "a3", field: "duration", reason: "12 absent from the quotes, field removed" }], keep: ["a3"] });
}
{
  const j = clone(ringJson);
  j.effects[0].changes = [{ kind: "resistance", scope: "walk", on: "", value: "1" }];
  add("scope-incompatible", ring, j, {
    kind: "invalid", corrections: [{ ref: "e1", field: "changes", reason: "scope walk incompatible with resistance, change removed" }],
    notAutomated: ["Jusqu'à la fin de votre prochain tour, votre vitesse est réduite de moitié"]
  });
}
{
  const j = clone(compassJson);
  const a2 = j.activities[1];
  j.activities = Array.from({ length: 13 }, (_, i) => ({ ...clone(a2), ref: `a${i + 1}` }));
  add("thirteen-activities", compass, j, { kind: "invalid", corrections: [{ ref: "activities", field: "length", reason: "more than 12 activities, first 12 kept" }], activityCount: 12 });
}
{
  const j = clone(compassJson);
  j.activities[0].name = "<script>alert(1)</script>Écho des passages";
  add("script-in-name", compass, j, { kind: "invalid", note: "< and > removed from the name, activity kept; never an HTML field", nameMustNotContain: ["<", ">"], keep: ["a1"] });
}
{
  const j = clone(compassJson);
  j.activities[0].name = "{{actor.name}} <img src=x onerror=alert(1)>";
  j.notAutomated[0].reason = "<b>{{game.user.name}}</b>";
  add("html-and-handlebars", compass, j, { kind: "invalid", note: "angle brackets removed; the double braces stay literal text (the template escapes them)", nameMustNotContain: ["<", ">"], keep: ["a1"] });
}
{
  const j = clone(compassJson);
  j.activities = j.activities.filter((a) => a.ref !== "a4");
  j.notAutomated = j.notAutomated.filter((x) => x.quote !== "seul vous le voyez");
  add("paragraph-uncovered", compass, j, { kind: "invalid", uncovered: ["P6"], note: "paragraph 6 (Fil lumineux) is cited by nothing: listed as not interpreted (C8)" });
}
{
  const j = clone(ringJson);
  j.activities[0].type = "summon";
  add("activity-type-excluded", ring, j, { kind: "invalid", rejections: [{ ref: "a1", field: "type", reason: "activity type not allowed" }] });
}
{
  const r = { ...clone(ring), type: "loot", value: "", subtypeLabel: "Butin" };
  add("activity-on-loot", r, ringJson, { kind: "invalid", rejections: [{ ref: "a1", field: "type", reason: "not applicable to this item type" }], note: "existing behaviour: no activity on a loot or a container" });
}
{
  const j = clone(ringJson);
  j.activities[0].certainty = "low";
  add("low-certainty", ring, j, { kind: "valid", note: "a low-certainty element is proposed unchecked (analyze-claude, not the validator)", lowRefs: ["a1"] });
}
{
  const j = clone(ringJson);
  j.activities = "none";
  add("wrong-shape", ring, j, { kind: "invalid", note: "defensive shape check: activities is not an array" });
}

// Whole-answer failures (fallback to rules)
add("refusal", ring, "", { kind: "fallback", status: "refusal" }, { envelope: { content: [], stop_reason: "refusal", usage: usage({ output_tokens: 0 }) } });
{
  const cut = JSON.stringify(ringJson).slice(0, 700);
  add("max-tokens", ring, cut, { kind: "fallback", status: "truncated" }, { envelope: { stop_reason: "max_tokens", usage: usage({ output_tokens: 8000 }) } });
}
add("invalid-json", ring, "Voici la configuration demandée : l'anneau permet de gagner des points de vie temporaires.", { kind: "fallback", status: "invalid" });
add("fenced-json", ring, `\`\`\`json\n${JSON.stringify(ringJson)}\n\`\`\``, { kind: "fallback", status: "invalid", note: "output_config.format guarantees raw JSON: a fenced answer counts as invalid" });
for (const [id, status, type, message, spec] of [
  ["http-401", 401, "authentication_error", "invalid x-api-key", "unauthorized"],
  ["http-403", 403, "permission_error", "forbidden", "unauthorized"],
  ["http-429", 429, "rate_limit_error", "rate limited", "rate-limited"],
  ["http-500", 500, "api_error", "internal error", "server-error"],
  ["http-529", 529, "overloaded_error", "overloaded", "server-error"]
]) {
  files[`${id}.json`] = {
    input: { name: ring.name, type: ring.type, value: ring.value, paragraphs: ring.paragraphs },
    httpError: errorBody(status, type, message), world: { metric: false }
  };
  cases.push({ id, file: `${id}.json`, kind: "fallback", httpStatus: status, status: spec, note: "status names are indicative: the test adapts them to those of anthropic.mjs" });
}
files["network-error.json"] = {
  input: { name: ring.name, type: ring.type, value: ring.value, paragraphs: ring.paragraphs },
  networkError: "TypeError: Failed to fetch", world: { metric: false }
};
cases.push({ id: "network-error", file: "network-error.json", kind: "fallback", status: "network" });

// ---- Expected configurations (design, "Cas de test") ----------------------------------------------------------
const expected = {
  ring: {
    world: "imperial",
    system: { "type.value": "ring", rarity: "uncommon", attunement: "required", propertiesContain: ["mgc"], "uses.max": "1", "uses.recovery": [{ period: "lr", type: "recoverAll" }] },
    activities: [{
      type: "heal", "activation.type": "reaction", "activation.condition": "tomber à 0 point de vie sans être tué sur le coup",
      healing: { number: 1, denomination: 6, bonus: "@prof", types: ["temphp"] },
      "consumption.targets": [{ type: "itemUses", value: "1" }], "range.units": "self", inferred: ["range", "target"], effects: ["E1"]
    }],
    effects: [{ id: "E1", transfer: false, "duration.expiry": ["sourceEnd", "1 turn"], changes: [{ key: "system.attributes.movement.multiplier", type: "multiply", value: "0.5" }] }],
    activityCount: 1,
    notAutomatedQuotes: ["tomber à 1 point de vie à la place", "vous ne pouvez pas effectuer de réactions"],
    flavorParagraph: "P2",
    crosscheckAgree: ["uses 1/lr", "activation reaction", "dice 1d6+@prof temphp", "speedMultiplier 0.5"], crosscheckConflicts: 0
  },
  compass: {
    world: "imperial",
    system: { "type.value": "wondrous", rarity: "uncommon", attunement: "", propertiesContain: ["mgc"], "uses.max": ["", "1 (only if a3 consumes itemUses)"] },
    activities: [
      { type: "utility", "activation.type": "action", "range.units": "self", "target.template": { type: "radius", size: "30", units: "ft" }, duration: { value: "1", units: "minute" }, consumption: [] },
      { type: "utility", "activation.type": "special", "activation.condition": "test de Sagesse (Survie) pour s'orienter, après le d20, avant le résultat", "roll.formula": "1d4", consumption: [], noPassiveEffectOn: "system.skills.sur" },
      { type: "utility", "activation.type": "action", inferred: ["activation"], duration: { value: "10", units: "minute" }, uses: { max: "1", recovery: [{ period: "dawn", type: "recoverAll" }] }, "consumption.targets": [{ type: "activityUses", value: "1" }] },
      { type: "utility", "activation.type": "action", "activation.condition": "dans les 24 heures suivant la mémorisation", "range.units": "self", consumption: [] }
    ],
    activityCount: 4, effects: [],
    notAutomatedQuotes: ["sans révéler comment l'ouvrir", "inefficace contre les passages cachés par une illusion", "pour vous orienter ou éviter de vous perdre", "mémoriser le trajet que vous parcourez", "seul vous le voyez", "sans garantir que le trajet reste praticable"],
    flavorParagraph: "P2", criticalFields: ["1d4 (activity 2)"]
  }
};

// ---- Write ----------------------------------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
const w = (name, data) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(data, null, 1)}\n`);
for (const [name, data] of Object.entries(files)) w(name, data);
w("items.json", { ring, compass });
w("expected.json", expected);
w("cases.json", cases);
console.log(`${Object.keys(files).length} fixtures, ${cases.length} cases written to ${OUT}`);
