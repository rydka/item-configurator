// Guards the simulated Claude answers (tests/fixtures/claude): the files stay consistent with their descriptions.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../fixtures/claude/", import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, dir), "utf8"));
const cases = read("cases.json");
const norm = (s) => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}+-]+/gu, " ").trim();
const quotesOf = (json) => [
  ...json.details.flatMap((d) => d.quotes), ...(json.uses?.quotes ?? []), ...json.activities.flatMap((a) => a.quotes),
  ...json.effects.flatMap((e) => e.quotes), ...json.notAutomated.map((n) => n.quote), ...json.flavor
];

describe("Claude fixtures", () => {
  it("every case has a file and a known kind", () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
    for (const c of cases) {
      expect(fs.existsSync(new URL(c.file, dir)), c.file).toBe(true);
      expect(["valid", "invalid", "fallback"]).toContain(c.kind);
    }
  });
  it("answers are full Messages API payloads", () => {
    for (const c of cases.filter((x) => read(x.file).response)) {
      const { response } = read(c.file);
      expect(response).toMatchObject({ type: "message", role: "assistant", model: expect.any(String) });
      expect(response.usage).toMatchObject({ input_tokens: expect.any(Number), cache_read_input_tokens: expect.any(Number) });
      expect(["end_turn", "max_tokens", "refusal"]).toContain(response.stop_reason);
    }
  });
  it("in the valid and the corrected answers, every quote is a passage of the description, except where the case says otherwise", () => {
    const skip = new Set(["quote-absent"]);
    for (const c of cases.filter((x) => x.kind !== "fallback" && !skip.has(x.id))) {
      const file = read(c.file);
      let json;
      try { json = JSON.parse(file.response.content[0].text); } catch { continue; }
      if (!Array.isArray(json.activities)) continue;
      const text = ` ${norm(file.input.paragraphs.join(" "))} `;
      for (const q of quotesOf(json)) expect(text, `${c.id}: ${q}`).toContain(` ${norm(q)} `);
    }
  });
  it("ring and compass match the expected configuration table", () => {
    const expected = read("expected.json");
    const ring = JSON.parse(read("ring.json").response.content[0].text);
    const compass = JSON.parse(read("compass.json").response.content[0].text);
    expect(ring.activities).toHaveLength(expected.ring.activityCount);
    expect(compass.activities).toHaveLength(expected.compass.activityCount);
    expect(ring.activities[0].healing).toEqual({ number: 1, denomination: 6, bonus: "@prof", types: ["temphp"] });
    expect(compass.activities.find((a) => a.ref === "a2").roll.formula).toBe("1d4");
    expect(compass.activities.find((a) => a.ref === "a3").uses).toEqual({ max: 1, period: "dawn" });
    expect(compass.effects).toEqual([]);
  });
  it("each failure case differs from its base answer", () => {
    const ring = read("ring.json").response.content[0].text;
    const compass = read("compass.json").response.content[0].text;
    for (const c of cases.filter((x) => x.kind === "invalid" && x.id !== "activity-on-loot")) { // same answer, other item type
      const text = read(c.file).response?.content?.[0]?.text;
      expect([ring, compass], c.id).not.toContain(text);
    }
  });
});
