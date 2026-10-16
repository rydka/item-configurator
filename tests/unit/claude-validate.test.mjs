// Validation of Claude's answer (section 3): each invalid case of tests/fixtures/claude and its reason.
import { describe, expect, it } from "vitest";
import { REASONS, isAllowedFormula, toWorldDistance, validateClaudeItem } from "../../scripts/ai/claude-validate.mjs";
import { ENUMS, K, answerOf, claudeFixture } from "../helpers/claude.mjs";

/** Validate a fixture in the world it declares. */
function validate(id, over = {}) {
  const file = claudeFixture(id);
  const json = over.json ?? answerOf(id);
  return validateClaudeItem(json, { paragraphs: file.input.paragraphs, enums: ENUMS, keys: K, metric: file.world.metric, type: file.input.type, ...over.ctx });
}
const pairs = (list) => list.map((x) => `${x.ref}|${x.field}|${x.reason}`);
const refs = (list) => list.map((x) => x.ref);

describe("valid answers", () => {
  it("the ring is accepted as it is", () => {
    const r = validate("ring");
    expect(r.rejections).toEqual([]);
    expect(r.corrections).toEqual([]);
    expect(r.uncovered).toEqual([]);
    expect(r.item.activities).toHaveLength(1);
    expect(r.item.effects).toHaveLength(1);
    expect(r.item.uses).toMatchObject({ max: 1 });
  });
  it("the compass: only the distance is corrected (9 m -> 30 ft in a world in feet)", () => {
    const r = validate("compass");
    expect(r.rejections).toEqual([]);
    expect(pairs(r.corrections)).toEqual(["a1|target.template.size|distanceConverted"]);
    expect(r.corrections[0].data).toMatchObject({ from: "9 m", to: "30 ft" });
    const template = r.item.activities[0].target.template;
    expect(template).toMatchObject({ type: "radius", units: "ft" });
    expect(Number(template.size)).toBe(30);
    expect(r.item.activities).toHaveLength(4);
  });
  it("the compass in a metric world keeps 9 m and reports no correction", () => {
    const r = validate("compass-metric");
    expect(r.corrections).toEqual([]);
    expect(r.item.activities[0].target.template).toMatchObject({ units: "m" });
    expect(Number(r.item.activities[0].target.template.size)).toBe(9);
  });
  it("the quotes of valid elements are kept and the paragraphs they come from are recorded", () => {
    const r = validate("ring");
    expect(r.item.activities[0].quotes.length).toBeGreaterThan(0);
    expect(r.item.activities[0].paragraphs).toContain(3);
  });
  it("an empty attunement is a fact of its own", () => {
    const detail = validate("compass").item.details.find((d) => d.field === "attunement");
    expect(detail).toMatchObject({ key: "" });
  });
});

describe("rejections and corrections (one case each)", () => {
  it("quote absent from the description: the element is rejected, the others stay", () => {
    const r = validate("quote-absent");
    expect(pairs(r.rejections)).toEqual(["a2|quotes|quoteMissing"]);
    expect(refs(r.item.activities)).toEqual(["a1", "a3", "a4"]);
  });
  it("unknown key in an essential field (healing type): the activity is rejected", () => {
    const r = validate("unknown-key-essential");
    expect(pairs(r.rejections)).toEqual(["a1|healing.types|unknownKey"]);
    expect(r.rejections[0].data).toMatchObject({ key: "tempfoo" });
    expect(r.item.activities).toEqual([]);
  });
  it("unknown key in an optional field (distance unit): the field is removed, the activity stays", () => {
    const r = validate("unknown-key-optional");
    expect(r.rejections).toEqual([]);
    expect(pairs(r.corrections)).toContain("a1|range|unknownKey");
    const a1 = r.item.activities.find((a) => a.ref === "a1");
    expect(a1).toBeTruthy();
    expect(a1.range).toBeFalsy();
  });
  it("dice outside the allowed faces (1d7): the heal is rejected", () => {
    const r = validate("out-of-bounds-dice");
    expect(pairs(r.rejections)).toEqual(["a1|healing|outOfBounds"]);
  });
  it("duration above 1000: the field is removed, the activity stays", () => {
    const r = validate("out-of-bounds-duration");
    expect(pairs(r.corrections)).toContain("a3|duration|outOfBounds");
    const a3 = r.item.activities.find((a) => a.ref === "a3");
    expect(a3).toBeTruthy();
    expect(a3.duration).toBeFalsy();
  });
  it("formula outside the whitelist (@actor): the roll is removed, the activity stays", () => {
    const r = validate("formula-actor");
    expect(pairs(r.corrections)).toContain("a2|roll|formulaNotAllowed");
    const a2 = r.item.activities.find((a) => a.ref === "a2");
    expect(a2).toBeTruthy();
    expect(a2.roll).toBeFalsy();
  });
  it("number absent from the quotes (12 minutes for 'les 10 prochaines minutes'): the duration is removed", () => {
    const r = validate("number-not-cited");
    expect(pairs(r.corrections)).toContain("a3|duration|numberNotQuoted");
    expect(r.item.activities.find((a) => a.ref === "a3").duration).toBeFalsy();
  });
  it("scope incompatible with the kind (resistance to 'walk'): the change is removed, the link to the effect too", () => {
    const r = validate("scope-incompatible");
    expect(pairs(r.corrections)).toContain("e1|changes|scopeMismatch");
    const e1 = r.item.effects.find((e) => e.ref === "e1");
    expect((e1?.changes ?? [])).toEqual([]);
    // an effect without change is a clause that dnd5e cannot apply, with its quote
    expect(JSON.stringify(r.item.notAutomated)).toContain("votre vitesse est réduite de moitié");
    expect(r.item.activities[0].effects ?? []).not.toContain("e1");
  });
  it("13 activities: the first 12 are kept and it is said", () => {
    const r = validate("thirteen-activities");
    expect(r.item.activities).toHaveLength(12);
    expect(pairs(r.corrections)).toContain("activities|length|tooMany");
    expect(refs(r.item.activities)).toEqual(Array.from({ length: 12 }, (_, i) => `a${i + 1}`));
  });
  it("<script> in a name: angle brackets removed, nothing else invented", () => {
    const r = validate("script-in-name");
    const name = r.item.activities.find((a) => a.ref === "a1").name;
    expect(name).not.toMatch(/[<>]/);
    expect(name).toContain("Écho des passages");
  });
  it("HTML and Handlebars in names and reasons: no angle bracket survives, double braces stay literal text", () => {
    const r = validate("html-and-handlebars");
    const serialized = JSON.stringify(r.item);
    expect(serialized).not.toMatch(/<img|<b>|<\/b>|<script/);
    expect(r.item.activities.find((a) => a.ref === "a1").name).toContain("{{actor.name}}");
    const reason = r.item.notAutomated[0].reason;
    expect(reason).not.toMatch(/[<>]/);
  });
  it("a paragraph cited by nothing is listed as not interpreted (C8)", () => {
    const r = validate("paragraph-uncovered");
    expect(r.uncovered.map((u) => u.index)).toEqual([6]);
    expect(r.uncovered[0].text).toContain("Fil lumineux");
    expect(validate("compass").uncovered).toEqual([]);
  });
  it("an activity type the module does not write (summon) is rejected", () => {
    const r = validate("activity-type-excluded");
    expect(pairs(r.rejections)).toContain("a1|type|unknownKey");
    expect(r.item.activities).toEqual([]);
  });
  it("an activity on a loot is not applicable", () => {
    const r = validate("activity-on-loot");
    expect(pairs(r.rejections)).toContain("a1|type|notApplicable");
    expect(r.item.activities).toEqual([]);
  });
  it("a shape error (activities is not an array) is reported, never thrown", () => {
    const r = validate("wrong-shape");
    expect(pairs(r.corrections)).toContain("activities|shape|fieldRemoved");
    expect(r.item.activities).toEqual([]);
  });
  it("garbage in, no exception out", () => {
    for (const json of [null, undefined, 3, "x", [], { activities: [null, 3, "x"], details: [null], effects: [[]], notAutomated: [7], flavor: [{}] }]) {
      expect(() => validateClaudeItem(json, { paragraphs: ["Un paragraphe de test."], enums: ENUMS, keys: K })).not.toThrow();
    }
  });
  it("every reason code is a known code", () => {
    const codes = new Set(REASONS);
    for (const id of ["quote-absent", "unknown-key-essential", "unknown-key-optional", "out-of-bounds-dice", "out-of-bounds-duration", "formula-actor",
      "number-not-cited", "scope-incompatible", "thirteen-activities", "activity-type-excluded", "activity-on-loot", "wrong-shape", "compass"]) {
      const r = validate(id);
      for (const x of [...r.corrections, ...r.rejections]) expect(codes.has(x.reason), `${id}: ${x.reason}`).toBe(true);
    }
  });
  it("the magical property is accepted on a loot (also tool and container), as dnd5e allows", () => {
    const r = validate("activity-on-loot");
    expect(r.rejections.map((x) => x.ref)).not.toContain("d3");
    expect(r.item.details.some((d) => d.field === "weaponProperty" && d.key === "mgc")).toBe(true);
  });
});

describe("numbers: the written value counts", () => {
  it("a count of 1 use and a consumption of 1 are exempt from the 'number quoted' check (design deviation)", () => {
    const json = answerOf("compass");
    const r = validateClaudeItem(json, { paragraphs: claudeFixture("compass").input.paragraphs, enums: ENUMS, keys: K });
    const a3 = r.item.activities.find((a) => a.ref === "a3");
    expect(a3.uses).toMatchObject({ max: 1 });
    expect(a3.consume).toMatchObject({ amount: 1 });
  });
  it("a number reported by Claude but absent from the quote is refused, even if plausible", () => {
    const json = answerOf("compass");
    json.activities[0].duration.value = 2;   // the text says 1 minute
    const r = validateClaudeItem(json, { paragraphs: claudeFixture("compass").input.paragraphs, enums: ENUMS, keys: K });
    expect(pairs(r.corrections)).toContain("a1|duration|numberNotQuoted");
  });
  it("a number listed in `inferred` of the activity is exempt for an inferable field only (never for dice)", () => {
    const json = answerOf("ring");
    json.activities[0].inferred = ["activation", "range", "target", "duration"];
    json.activities[0].healing.number = 2;       // dice are never inferable
    const r = validateClaudeItem(json, { paragraphs: claudeFixture("ring").input.paragraphs, enums: ENUMS, keys: K });
    expect(pairs(r.rejections).join()).toMatch(/a1\|healing/);
  });
});

describe("helpers", () => {
  it("toWorldDistance converts metres to feet (x10/3, rounded to 5) and back (x0.3, to 0.5 m)", () => {
    expect(toWorldDistance(9, "m", false)).toEqual({ value: 30, units: "ft", converted: true });
    expect(toWorldDistance(18, "m", false)).toEqual({ value: 60, units: "ft", converted: true });
    expect(toWorldDistance(6, "m", false)).toEqual({ value: 20, units: "ft", converted: true });
    expect(toWorldDistance(9, "m", true)).toEqual({ value: 9, units: "m", converted: false });
    expect(toWorldDistance(30, "ft", true)).toEqual({ value: 9, units: "m", converted: true });
    expect(toWorldDistance(1, "m", false).value).toBe(5);        // never rounds a distance down to zero
    expect(toWorldDistance(0, "self", false)).toEqual({ value: 0, units: "self", converted: false });
    expect(toWorldDistance(1, "touch", true)).toMatchObject({ units: "touch", converted: false });
  });
  it("isAllowedFormula: dice, integers, + - @prof @mod @abilities.<key>.mod and nothing else", () => {
    for (const ok of ["1d4", "1d6 + @prof", "2d8+3", "@mod", "@abilities.dex.mod", "1d4 - 1", "", "  5  "]) expect(isAllowedFormula(ok), ok).toBe(true);
    for (const bad of ["1d4 + @actor.level", "@details.level", "1d4 * 2", "(1d4)", "max(1,2)", "1d4; alert(1)", "foo", "1d6 + @prof.x", "@abilities.dex.save", "${1}", "1d4 /roll"]) {
      expect(isAllowedFormula(bad), bad).toBe(false);
    }
  });
});
