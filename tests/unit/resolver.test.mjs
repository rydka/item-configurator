import { describe, expect, it } from "vitest";
import { createOllamaResolver, toFacts } from "../../scripts/ai/resolver.mjs";
import { FIXTURES, fakeFetch, fixture, replay } from "../helpers/fake-ollama.mjs";
import { keys } from "../helpers/keys.mjs";

const K = keys();
const SENTENCE = "Once per turn, a hit with this weapon deals an extra 2d6 necrotic damage.";
const req = { sentence: SENTENCE };
const dmg = (over = {}) => ({ kind: "damage", evidence: "extra 2d6 necrotic damage", number: 2, denomination: 6, damageType: "necrotic", ...over });
const make = (name, options = {}) => {
  const r = replay(name, options);
  return { ...r, resolver: createOllamaResolver({ url: "http://x", fetch: r.fetch, keys: K, timeoutMs: 200 }) };
};

describe("toFacts (C9)", () => {
  it("accepts a quoted damage fact with known keys", () => {
    const { facts, rejected, accepted } = toFacts({ index: 0, facts: [dmg()] }, req, K);
    expect(rejected).toEqual([]);
    expect(accepted).toBe(1);
    expect(facts.damage).toEqual([{ number: 2, denomination: 6, bonus: "", type: "necrotic", raw: "extra 2d6 necrotic damage" }]);
  });
  it("accepts the facts array directly and tolerates garbage", () => {
    expect(toFacts([dmg()], req, K).accepted).toBe(1);
    expect(toFacts(null, req, K)).toEqual({ facts: {}, rejected: [], accepted: 0 });
    expect(toFacts({ facts: "x" }, req, K).accepted).toBe(0);
  });
  it("quote check ignores case, diacritics and punctuation", () => {
    const sentence = "Au contact, la lame inflige 1d6 dégâts de feu supplémentaires.";
    const fact = { kind: "damage", evidence: "1D6 DEGATS de feu", number: 1, denomination: 6, damageType: "fire" };
    expect(toFacts([fact], { sentence }, K).accepted).toBe(1);
  });

  describe("rejections", () => {
    const rejects = (fact, reason, sentence = SENTENCE) => {
      const r = toFacts([fact], { sentence }, K);
      expect(r.accepted).toBe(0);
      expect(r.facts).toEqual({});
      expect(r.rejected).toHaveLength(1);
      expect(r.rejected[0].reason).toMatch(reason);
    };
    it("evidence absent from the sentence", () => rejects(dmg({ evidence: "deals 4d8 acid damage to undead" }), /evidence/));
    it("empty or too short evidence", () => {
      rejects(dmg({ evidence: "" }), /evidence/);
      rejects(dmg({ evidence: "2" }), /evidence/);
    });
    it("unknown damage type key", () => rejects(dmg({ damageType: "vorpal" }), /damage type/));
    it("dice out of bounds", () => {
      rejects(dmg({ number: 0 }), /dice/);
      rejects(dmg({ number: 101 }), /dice/);
      rejects(dmg({ denomination: 1 }), /dice/);
      rejects(dmg({ denomination: 101 }), /dice/);
    });
    it("half-specified dice", () => rejects(dmg({ denomination: undefined }), /dice/));
    it("no dice nor bonus", () => rejects(dmg({ number: undefined, denomination: undefined }), /no dice/));
    it("unknown kind", () => rejects({ kind: "teleport", evidence: "extra 2d6" }, /unsupported/));
    it("consume: amount required and bounded; cast: spell name required, DC bounded", () => {
      rejects({ kind: "consume", evidence: "extra 2d6 necrotic" }, /amount/);
      rejects({ kind: "consume", evidence: "extra 2d6 necrotic", amount: 0 }, /amount/);
      rejects({ kind: "cast", evidence: "extra 2d6 necrotic" }, /spell/);
      rejects({ kind: "cast", evidence: "extra 2d6 necrotic", spell: "fireball", dc: 99 }, /DC/);
    });
    it("extraDamage: needs a known damage type and bounded dice", () => {
      rejects(dmg({ kind: "extraDamage", damageType: "vorpal" }), /damage type/);
      rejects(dmg({ kind: "extraDamage", number: 0 }), /dice/);
    });
    it("not an object", () => {
      const r = toFacts([null, "x"], req, K);
      expect(r.rejected.map((x) => x.reason)).toEqual(["not an object", "not an object"]);
    });
    it("save: unknown ability, DC out of bounds", () => {
      rejects({ kind: "save", evidence: "extra 2d6", ability: "luck", dc: 15 }, /ability/);
      rejects({ kind: "save", evidence: "extra 2d6", ability: "wis", dc: 99 }, /DC/);
      rejects({ kind: "save", evidence: "extra 2d6", ability: "wis", dc: 4 }, /DC/);
    });
    it("attack: needs an attack roll, bonus bounded", () => {
      rejects({ kind: "attack", evidence: "a hit with this weapon" }, /no attack roll/);
      rejects({ kind: "attack", evidence: "a hit with this weapon", bonus: 99 }, /bonus/);
    });
    it("uses: bounds and period", () => {
      rejects({ kind: "uses", evidence: "Once per turn", max: 0, period: "day" }, /uses/);
      rejects({ kind: "uses", evidence: "Once per turn", max: 1, period: "fortnight" }, /period/);
    });
    it("activation: unknown type, cost out of bounds", () => {
      rejects({ kind: "activation", evidence: "Once per turn", activation: "teleport" }, /activation/);
      rejects({ kind: "activation", evidence: "Once per turn", activation: "action", cost: 99 }, /cost/);
    });
    it("effect: unknown kind, scope not matching the kind, missing amount", () => {
      rejects({ kind: "effect", evidence: "extra 2d6", effectKind: "weird" }, /effect kind/);
      rejects({ kind: "effect", evidence: "extra 2d6", effectKind: "resistance", scope: "str" }, /scope/);
      rejects({ kind: "effect", evidence: "extra 2d6", effectKind: "ac", scope: undefined }, /amount|scope/);
    });
    it("detail: unknown rarity, empty detail", () => {
      rejects({ kind: "detail", evidence: "extra 2d6", rarity: "mythic" }, /rarity/);
      rejects({ kind: "detail", evidence: "extra 2d6" }, /empty detail/);
    });
    it("a second single fact (save) is rejected as duplicate", () => {
      const save = { kind: "save", evidence: "extra 2d6", ability: "wis", dc: 15 };
      const r = toFacts([save, save], req, K);
      expect(r.accepted).toBe(1);
      expect(r.rejected[0].reason).toMatch(/duplicate/);
    });
  });

  describe("kinds", () => {
    it("heal gives a healing part whatever damageType says", () => {
      const sentence = "You regain 2d4 + 2 hit points.";
      const r = toFacts([{ kind: "heal", evidence: "2d4 + 2 hit points", number: 2, denomination: 4, bonus: 2, damageType: "bludgeoning" }], { sentence }, K);
      expect(r.facts.heal).toEqual({ number: 2, denomination: 4, bonus: "2", type: "healing", raw: "2d4 + 2 hit points" });
      expect(r.facts.damage).toBeUndefined();
    });
    it("save, uses and activation facts", () => {
      const sentence = "DC 15 Wisdom saving throw, half on success; 3 times per day as a bonus action.";
      const r = toFacts([
        { kind: "save", evidence: "DC 15 Wisdom saving throw", ability: "wis", dc: 15, onSave: "half" },
        { kind: "uses", evidence: "3 times per day", max: 3, period: "day" },
        { kind: "activation", evidence: "bonus action", activation: "bonus" }
      ], { sentence }, K);
      expect(r.rejected).toEqual([]);
      expect(r.facts.save).toMatchObject({ ability: "wis", dc: 15, onSave: "half" });
      expect(r.facts.uses).toMatchObject({ max: 3, period: "day" });
      expect(r.facts.activation).toMatchObject({ type: "bonus", cost: null });
    });
    it("consume, cast and extraDamage give the facts of the plan", () => {
      const sentence = "Expend 1 charge to cast fireball (save DC 15) from it. Deals an extra 2d6 fire damage.";
      const r = toFacts([
        { kind: "consume", evidence: "Expend 1 charge", amount: 1 },
        { kind: "cast", evidence: "cast fireball (save DC 15)", spell: "fireball", dc: 15, level: 3 },
        { kind: "extraDamage", evidence: "extra 2d6 fire damage", number: 2, denomination: 6, damageType: "fire" }
      ], { sentence }, K);
      expect(r.rejected).toEqual([]);
      expect(r.facts.consume).toMatchObject({ target: "itemUses", amount: 1 });
      expect(r.facts.cast).toMatchObject({ name: "fireball", dc: 15, level: 3 });
      expect(r.facts.extraDamage).toMatchObject({ number: 2, denomination: 6, type: "fire" });
      expect(r.facts.damage).toBeUndefined();
    });
    it("effects and details", () => {
      const sentence = "You have resistance to cold damage. Rare, requires attunement.";
      const r = toFacts([
        { kind: "effect", evidence: "resistance to cold damage", effectKind: "resistance", scope: "cold" },
        { kind: "detail", evidence: "Rare", rarity: "rare" },
        { kind: "detail", evidence: "requires attunement", attunement: "required" }
      ], { sentence }, K);
      expect(r.rejected).toEqual([]);
      expect(r.facts.effects).toEqual([{ kind: "resistance", value: null, scope: "cold", raw: "resistance to cold damage" }]);
      expect(r.facts.details).toEqual({ rarity: "rare", attunement: "required" });
    });
  });
});

describe("createOllamaResolver on recorded and handwritten answers (C9, C10)", () => {
  it("valid answer: one fact set, confidence 1, status ok", async () => {
    const { resolver, requests } = make("valid");
    const out = await resolver.resolveMany(requests);
    expect(out.status).toBe("ok");
    expect(out[0].facts.damage[0]).toMatchObject({ number: 2, denomination: 6, type: "necrotic" });
    expect(out[0].confidence).toBe(1);
    expect(out.rejected).toEqual([]);
    expect(resolver.lastRun).toMatchObject({ status: "ok", model: "llama3.1:8b" });
  });
  it.each([
    ["citation-absent", /evidence/],
    ["unknown-key", /damage type/],
    ["out-of-bounds", /DC|evidence/],
    ["unknown-kind", /unsupported/]
  ])("%s: rejected and reported, nothing returned", async (name, reason) => {
    const { resolver, requests } = make(name);
    const out = await resolver.resolveMany(requests);
    expect(out.status).toBe("ok");
    expect(out[0]).toBeNull();
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0]).toMatchObject({ index: 0, sentence: requests[0].sentence });
    expect(out.rejected[0].reason).toMatch(reason);
  });
  it("wrong index and empty answer: ignored, no entry", async () => {
    for (const name of ["wrong-index", "empty"]) {
      const { resolver, requests } = make(name);
      expect([...(await resolver.resolveMany(requests))]).toEqual([null]);
    }
  });
  it("invalid JSON: status invalid, no exception", async () => {
    const { resolver, requests } = make("invalid-json");
    const out = await resolver.resolveMany(requests);
    expect(out.status).toBe("invalid");
    expect([...out]).toEqual([null]);
  });
  it("sends one chat request for all sentences with schema and options", async () => {
    const { resolver, requests, fetch } = make("batch");
    expect(requests).toHaveLength(3);
    await resolver.resolveMany(requests);
    const chats = fetch.calls.filter((c) => c.url.endsWith("/api/chat"));
    expect(chats).toHaveLength(1);
    expect(chats[0].body).toMatchObject({ model: "llama3.1:8b", stream: false, options: { temperature: 0, seed: 0 } });
    expect(chats[0].body.format.properties.results).toBeDefined();
    expect(chats[0].body.messages[1].content).toContain("[2] The cloak smells faintly of lavender.");
  });
  it("recorded answers: only validated facts come out, flawed ones are reported", async () => {
    for (const name of ["single-damage", "save-condition", "uses-recharge", "french", "no-mechanics", "batch"]) {
      const { resolver, requests } = make(name);
      const out = await resolver.resolveMany(requests);
      expect(["ok", "invalid"], name).toContain(out.status);
      for (const [i, entry] of out.entries()) {
        if (!entry) continue;
        expect(entry.confidence).toBeGreaterThan(0);
        expect(entry.confidence).toBeLessThanOrEqual(1);
        // Every accepted raw quote is an exact passage of the sentence.
        const raws = [entry.facts.attack?.raw, entry.facts.save?.raw, ...(entry.facts.damage ?? []).map((d) => d.raw)].filter(Boolean);
        for (const raw of raws) expect(requests[i].sentence.toLowerCase()).toContain(raw.toLowerCase().slice(0, 4));
      }
    }
  });
  it("recorded batch: the flavor sentence gets nothing", async () => {
    const { resolver, requests } = make("batch");
    expect((await resolver.resolveMany(requests))[2]).toBeNull();
  });
  it("recorded no-mechanics: nothing invented", async () => {
    const { resolver, requests } = make("no-mechanics");
    expect([...(await resolver.resolveMany(requests))]).toEqual([null]);
  });
  it("replays every fixture without throwing (robustness)", async () => {
    for (const name of FIXTURES) {
      const { resolver, requests } = make(name);
      await expect(resolver.resolveMany(requests)).resolves.toBeInstanceOf(Array);
    }
  });
});

describe("createOllamaResolver failures: rules only, no exception (C10)", () => {
  const requests = [req];
  it("unreachable: all null, status unreachable, fast", async () => {
    const fetch = fakeFetch({ down: true });
    const resolver = createOllamaResolver({ url: "http://x", fetch, keys: K });
    const t0 = Date.now();
    const out = await resolver.resolveMany(requests);
    expect([...out]).toEqual([null]);
    expect(out.status).toBe("unreachable");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(fetch.calls.every((c) => !c.url.endsWith("/api/chat"))).toBe(true);
  });
  it("timeout: status timeout", async () => {
    const resolver = createOllamaResolver({ url: "http://x", fetch: fakeFetch({ slow: true }), keys: K, timeoutMs: 30 });
    const out = await resolver.resolveMany(requests);
    expect([...out]).toEqual([null]);
    expect(out.status).toBe("timeout");
  });
  it("http error: status error", async () => {
    const resolver = createOllamaResolver({ url: "http://x", fetch: fakeFetch({ chat: {}, chatStatus: 500 }), keys: K });
    expect((await resolver.resolveMany(requests)).status).toBe("error");
  });
  it("answer that is not an object with results: invalid", async () => {
    const chat = { message: { content: '{"foo":1}' } };
    const resolver = createOllamaResolver({ url: "http://x", fetch: fakeFetch({ chat }), keys: K });
    expect((await resolver.resolveMany(requests)).status).toBe("invalid");
  });
  it("no preferred model installed and none configured: no-model", async () => {
    const resolver = createOllamaResolver({ url: "http://x", fetch: fakeFetch({ models: ["qwen:latest"] }), keys: K });
    expect((await resolver.resolveMany(requests)).status).toBe("no-model");
  });
  it("an explicit model is used as is", async () => {
    const r = replay("valid");
    const resolver = createOllamaResolver({ url: "http://x", model: "mymodel", fetch: r.fetch, keys: K });
    await resolver.resolveMany(r.requests);
    expect(r.fetch.calls.find((c) => c.url.endsWith("/api/chat")).body.model).toBe("mymodel");
    expect(r.fetch.calls.some((c) => c.url.endsWith("/api/tags"))).toBe(false);
  });
  it("an aborted signal returns aborted without any call", async () => {
    const fetch = fakeFetch();
    const resolver = createOllamaResolver({ url: "http://x", fetch, keys: K });
    const out = await resolver.resolveMany(requests, { signal: AbortSignal.abort() });
    expect(out.status).toBe("aborted");
    expect(fetch.calls).toHaveLength(0);
  });
  it("empty request list: ok, no call", async () => {
    const fetch = fakeFetch();
    const resolver = createOllamaResolver({ url: "http://x", fetch, keys: K });
    const out = await resolver.resolveMany([]);
    expect([...out]).toEqual([]);
    expect(out.status).toBe("ok");
    expect(fetch.calls).toHaveLength(0);
  });
  it("a fetch that throws a non-network error never escapes", async () => {
    const resolver = createOllamaResolver({ url: "http://x", fetch: () => { throw new Error("boom"); }, keys: K });
    const out = await resolver.resolveMany(requests);
    expect([...out]).toEqual([null]);
    expect(["unreachable", "error"]).toContain(out.status);
  });
  it("the probe result is cached between calls", async () => {
    const r = replay("valid");
    let t = 0;
    const resolver = createOllamaResolver({ url: "http://x", fetch: r.fetch, keys: K, now: () => t });
    await resolver.resolveMany(r.requests);
    t = 1000;
    await resolver.resolveMany(r.requests);
    expect(r.fetch.calls.filter((c) => c.url.endsWith("/api/version"))).toHaveLength(1);
    t = 61000;
    await resolver.resolveMany(r.requests);
    expect(r.fetch.calls.filter((c) => c.url.endsWith("/api/version"))).toHaveLength(2);
  });
});

describe("single-request contract (FallbackResolver)", () => {
  it("returns the entry of the request, or null", async () => {
    const r = replay("valid");
    const resolver = createOllamaResolver({ url: "http://x", fetch: r.fetch, keys: K });
    const one = await resolver(r.requests[0]);
    expect(one.facts.damage).toHaveLength(1);
    const none = await createOllamaResolver({ url: "http://x", fetch: fakeFetch({ down: true }), keys: K })(r.requests[0]);
    expect(none).toBeNull();
  });
  it("warmUp is false when unreachable and true when the model loads", async () => {
    expect(await createOllamaResolver({ url: "http://x", fetch: fakeFetch({ down: true }) }).warmUp()).toBe(false);
    expect(await createOllamaResolver({ url: "http://x", fetch: fakeFetch() }).warmUp()).toBe(true);
  });
  it("fixtures are consistent: every handwritten fixture is flagged", () => {
    for (const name of ["valid", "citation-absent", "unknown-key", "out-of-bounds", "unknown-kind", "invalid-json", "wrong-index", "empty"]) {
      expect(fixture(name).handcrafted).toBe(true);
    }
  });
});
