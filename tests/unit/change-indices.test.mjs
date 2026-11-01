// Effect change indices: where a Claude / plan change lands in the Foundry effect source (v13 `changes` array).
import { describe, expect, it } from "vitest";
import { analyzeClaudeFirst } from "../../scripts/core/analyze-claude.mjs";
import { applySelection, buildChangeSet } from "../../scripts/core/changes.mjs";
import { changeIndices, factsFromClaude } from "../../scripts/core/crosscheck.mjs";
import { setPath } from "../../scripts/core/paths.mjs";
import { buildFromClaude } from "../../scripts/ai/claude-build.mjs";
import { ENUMS, K } from "../helpers/claude.mjs";
import { blank, idGenerator, p, parser, resolveSpell } from "../helpers/analysis.mjs";

const okResult = (json) => ({ ok: true, status: "ok", json, model: "m", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, retried: false });
const change = (key, value, mode = 2) => ({ key, mode, value, priority: null });

describe("changeIndices", () => {
  it("keeps the order of the wanted entries", () => {
    const changes = [change("a", "1"), change("b", "2"), change("c", "3")];
    expect(changeIndices(changes, [change("b", "2"), change("c", "3")])).toEqual([1, 2]);
    expect(changeIndices(changes, [change("a", "1"), change("c", "3")])).toEqual([0, 2]);
  });
  it("ignores an entry deduplicated by toEffects: two identical wanted against one written -> [0]", () => {
    expect(changeIndices([change("a", "1")], [change("a", "1"), change("a", "1")])).toEqual([0]);
  });
  it("an entry absent from the source is skipped; no data gives []", () => {
    expect(changeIndices([change("a", "1")], [change("z", "9")])).toEqual([]);
    expect(changeIndices(undefined, undefined)).toEqual([]);
  });
});

describe("setPath on a change array", () => {
  it("writes an existing index", () => {
    const o = { changes: [{ key: "k", mode: 2, value: "+1" }] };
    setPath(o, "changes.0.value", "+9");
    expect(o.changes[0].value).toBe("+9");
  });
  it("leaves the object intact for a missing or non-numeric index", () => {
    const o = { changes: [{ key: "k", mode: 2, value: "+1" }] };
    const before = structuredClone(o);
    setPath(o, "changes.3.value", "+9");
    setPath(o, "changes.x.value", "+9");
    expect(o).toEqual(before);
  });
});

describe("effectChanges of buildFromClaude and the facts of factsFromClaude", () => {
  const text = "You have a +1 bonus to attack rolls and a +2 bonus to AC, and a jump of 30 feet.";
  const item = {
    details: [], activities: [], notAutomated: [], flavor: [],
    effects: [{
      ref: "e1", name: "Boost", quotes: [text], certainty: "high", inferred: false, transfer: true,
      changes: [{ kind: "speed", scope: "jump", on: "", value: "30" }, { kind: "attack", scope: "", on: "", value: "+1" }, { kind: "ac", scope: "", on: "", value: "+2" }],
      duration: { value: 0, units: "", until: "" }
    }]
  };
  const built = buildFromClaude(item, { parser, keys: K, idGen: idGenerator(), type: "equipment", name: "X", resolveSpell });
  const facts = (opts) => factsFromClaude(item, [text], opts).filter((f) => f.family === "effectBonus");
  const fieldsOf = (list, value) => list.find((f) => f.value.startsWith(value)).patch.map((x) => x.field);

  it("effectChanges: the skipped jump has no index, attack takes four, ac the fifth", () => {
    expect(built.effectChanges).toEqual([[[], [0, 1, 2, 3], [4]]]);
    expect(built.effects[0].changes).toHaveLength(5);
  });
  it("with effectChanges: speed:jump has no patch, attack four fields, ac changes.4", () => {
    const list = facts({ effectChanges: built.effectChanges });
    expect(list.find((f) => f.value.startsWith("speed:jump")).patch).toEqual([]);
    expect(fieldsOf(list, "attack")).toEqual([0, 1, 2, 3].map((k) => `changes.${k}.value`));
    expect(fieldsOf(list, "ac")).toEqual(["changes.4.value"]);
  });
  it("without effectChanges: fallback to changes.<j>.value", () => {
    const list = facts();
    expect(fieldsOf(list, "speed:jump")).toEqual(["changes.0.value"]);
    expect(fieldsOf(list, "attack")).toEqual(["changes.1.value"]);
    expect(fieldsOf(list, "ac")).toEqual(["changes.2.value"]);
  });
});

describe("conflicts through analyzeClaudeFirst", () => {
  async function analyze(text, changes) {
    const json = {
      details: [], activities: [], notAutomated: [], flavor: [],
      effects: [{ ref: "e1", name: "B", quotes: [text], certainty: "high", inferred: false, transfer: true, changes, duration: { value: 0, units: "", until: "" } }]
    };
    const source = blank("equipment");
    const proposal = await analyzeClaudeFirst(
      { name: "Ring", html: p("Wondrous item, rare", text), type: "equipment", value: "ring", subtype: "", source },
      { parser, keys: K, enums: ENUMS, complete: async () => okResult(json), idGen: idGenerator(), resolveSpell, metric: false }
    );
    return { proposal, cs: buildChangeSet(source, proposal, { parser }) };
  }

  it("two passive rules effects grouped in one source: the rules patch points at the real index of the second change", async () => {
    const { proposal, cs } = await analyze("you gain a +2 bonus to AC and a +3 bonus to Wisdom saving throws, as a +4 ring",
      [{ kind: "ac", scope: "", on: "", value: "+2" }, { kind: "save", scope: "wis", on: "", value: "+4" }]);
    const conflict = proposal.crosscheck.conflict.filter((c) => c.family === "effectBonus");
    expect(conflict).toHaveLength(1);
    expect(conflict[0].patch.rules.map((x) => x.field)).toEqual(["changes.1.value"]);
    expect(conflict[0].patch.claude.map((x) => x.field)).toEqual(["changes.1.value"]);
    expect(cs.effects.add[0].changes.map((c) => c.key)).toEqual(["system.attributes.ac.bonus", "system.abilities.wis.bonuses.save"]);
  });

  it("an attack bonus conflict (rules +1, Claude +2) decided 'rules' sets the four system.bonuses.<type>.attack to '+1'", async () => {
    const { cs } = await analyze("you gain a +1 bonus to attack rolls, as a +2 ring", [{ kind: "attack", scope: "", on: "", value: "+2" }]);
    expect(cs.effects.add[0].changes.map((c) => c.value)).toEqual(["+2", "+2", "+2", "+2"]);
    const chosen = applySelection(cs, { choices: Object.fromEntries(cs.check.map((c) => [c.id, "rules"])) });
    const attack = chosen.effects.add[0].changes;
    expect(attack.map((c) => c.key).sort()).toEqual(["mwak", "rwak", "msak", "rsak"].map((t) => `system.bonuses.${t}.attack`).sort());
    for (const c of attack) expect(c.value).toBe("+1");
  });
});
