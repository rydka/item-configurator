import { describe, expect, it } from "vitest";
import { createOllamaResolver } from "../../scripts/ai/resolver.mjs";
import { K, p, parser, run } from "../helpers/analysis.mjs";
import { fakeFetch } from "../helpers/fake-ollama.mjs";

const FLAME = p(
  "Weapon (any sword), rare (requires attunement)",
  "You can use a bonus action to speak this magic sword's command word, causing flames to erupt from the blade. These flames shed bright light in a 40-foot radius and dim light for an additional 40 feet. While the sword is ablaze, it deals an extra 2d6 fire damage to any target it hits."
);
const POTION = p("Potion, common", "You regain 2d4 + 2 hit points when you drink this potion.");
const CLOAK = p("Wondrous item, uncommon (requires attunement)", "You gain a +1 bonus to AC and saving throws while you wear this cloak.");
const WAND = p(
  "Wand, rare (requires attunement by a wizard)",
  "This wand has 7 charges. While holding it, you can use an action to expend 1 charge and cast fireball (save DC 15) from it. The wand regains 1d6 + 1 expended charges daily at dawn."
);

const groups = (cs, group, action) => cs.entries.filter((e) => e.group === group && (!action || e.action === action));
const changesOf = (cs) => cs.effects.add.flatMap((e) => e.changes.map((c) => `${c.key}=${c.value}`));

describe("scenario 1: Flame Tongue (C5, C6, C12)", () => {
  it("details, attack and 'Command Word' activities with the extra 2d6 fire", async () => {
    const { changeSet: cs, proposal } = await run({ name: "Flame Tongue Longsword", html: FLAME, type: "weapon", value: "martialM" });
    expect(cs.systemPatch).toMatchObject({ "system.rarity": "rare", "system.attunement": "required", "system.type.value": "martialM" });
    const [attack, command] = cs.activities.add;
    expect(attack.type).toBe("attack");
    expect(attack.damage.parts[0]).toMatchObject({ number: 2, denomination: 6, types: ["fire"] });
    expect(attack.damage.includeBase).toBe(true);
    expect(command).toMatchObject({ type: "utility", name: "Command Word", activation: { type: "bonus" } });
    expect(cs.empty).toBe(false);
    expect(cs.unrecognized).toEqual([]);
    expect(proposal.ai.status).toBe("off");
  });
  it("every non-derived entry cites the sentence of the description (C12)", async () => {
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" });
    const text = FLAME.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const cited = cs.entries.filter((e) => !e.derived && e.action !== "remove");
    expect(cited.length).toBeGreaterThan(3);
    for (const e of cited) {
      expect(e.group).toMatch(/details|activities|effects/);
      if (e.raw) expect(text.replace(/\s/g, "")).toContain(e.raw.replace(/\s+/g, "").slice(0, 30));
    }
    expect(groups(cs, "activities").some((e) => e.raw.includes("2d6 fire"))).toBe(true);
  });
  it("inherits the base weapon damage, range and properties when a base item is given", async () => {
    const baseItem = {
      type: "weapon",
      system: {
        damage: { base: { number: 1, denomination: 8, types: ["slashing"] }, versatile: { number: 1, denomination: 10, types: ["slashing"] } },
        properties: ["ver"], type: { baseItem: "longsword" }
      }
    };
    const { changeSet: cs } = await run({ html: FLAME, type: "weapon", value: "martialM" }, { baseItem });
    expect(cs.systemPatch["system.damage.base.denomination"]).toBe(8);
    expect(cs.systemPatch["system.damage.base.types"]).toEqual(["slashing"]);
    expect(cs.systemPatch["system.damage.versatile.denomination"]).toBe(10);
    expect(cs.systemPatch["system.type.baseItem"]).toBe("longsword");
    expect(cs.entries.filter((e) => e.origin === "base").every((e) => e.derived)).toBe(true);
  });
});

describe("scenario 2: Potion of Healing (C5, C6)", () => {
  it("one use destroyed when empty, and a heal activity", async () => {
    const { changeSet: cs } = await run({ name: "Potion of Healing", html: POTION, type: "consumable", value: "potion" });
    expect(cs.systemPatch).toMatchObject({
      "system.uses.max": "1", "system.uses.autoDestroy": true, "system.type.value": "potion", "system.rarity": "common"
    });
    expect(cs.activities.add).toHaveLength(1);
    expect(cs.activities.add[0].type).toBe("heal");
    expect(cs.activities.add[0].healing).toMatchObject({ number: 2, denomination: 4, bonus: "2" });
  });
  it("the single-use deduction is shown as derived, not as read from the text", async () => {
    const { changeSet: cs } = await run({ html: POTION, type: "consumable", value: "potion" });
    const deduced = cs.entries.find((e) => e.label?.key === "item-configurator.Preview.Deduced.SingleUse");
    expect(deduced).toMatchObject({ derived: true, action: "set" });
  });
  it("a scroll with an explicit number of uses is not deduced as single-use", async () => {
    const { proposal } = await run({ html: p("Scroll, rare", "The scroll has 3 charges and regains 1d3 charges daily at dawn."), type: "consumable", value: "scroll" });
    expect(proposal.translation.deduced).toEqual([]);
  });
});

describe("scenario 3: Cloak of Protection (C7)", () => {
  it("one passive effect +1 AC and +1 to saves, attunement required", async () => {
    const { changeSet: cs } = await run({ name: "Cloak of Protection", html: CLOAK, type: "equipment", value: "clothing" });
    expect(cs.systemPatch).toMatchObject({ "system.attunement": "required", "system.rarity": "uncommon", "system.type.value": "clothing" });
    expect(cs.effects.add).toHaveLength(1);
    expect(cs.effects.add[0].transfer).toBe(true);
    expect(changesOf(cs)).toEqual(expect.arrayContaining(["system.attributes.ac.bonus=+1", "system.bonuses.abilities.save=+1"]));
    expect(cs.activities.add).toEqual([]);
  });
});

describe("one case per formulation (C5-C7), English", () => {
  const effect = (text, expected, type = "equipment") => async () => {
    const { changeSet: cs } = await run({ html: p(text), type });
    expect(changesOf(cs), text).toEqual(expect.arrayContaining(expected));
    expect(cs.unrecognized, text).toEqual([]);
  };
  it("bonus to attack and damage rolls", effect("You gain a +1 bonus to attack rolls and damage rolls made with this magic weapon.",
    ["system.bonuses.mwak.attack=+1", "system.bonuses.mwak.damage=+1"]));
  it("bonus to AC", effect("You gain a +2 bonus to AC while you wear this armor.", ["system.attributes.ac.bonus=+2"]));
  it("bonus to one saving throw", effect("You gain a +2 bonus to Wisdom saving throws.", ["system.abilities.wis.bonuses.save=+2"]));
  it("resistance", effect("You have resistance to fire damage while you wear this armor.", ["system.traits.dr.value=fire"]));
  it("immunity to damage", effect("You have immunity to poison damage.", ["system.traits.di.value=poison"]));
  it("immunity to a condition", effect("You are immune to the frightened condition.", ["system.traits.ci.value=frightened"]));
  it("vulnerability", effect("You have vulnerability to cold damage.", ["system.traits.dv.value=cold"]));
  it("advantage on a skill", effect("You have advantage on Dexterity (Stealth) checks.", ["system.skills.ste.roll.mode=1"]));
  it("disadvantage on a skill", effect("You have disadvantage on Dexterity (Stealth) checks.", ["system.skills.ste.roll.mode=-1"]));
  it("ability score", effect("Your Strength score is 19 while you wear this item.", ["system.abilities.str.value=19"]));
  it("speed", effect("Your walking speed increases by 10 feet.", ["system.attributes.movement.bonus=+10"]));

  it("temporary effect after use is not transferred and carries a duration (C7)", async () => {
    const { changeSet: cs } = await run({ html: p("When you drink this potion, you gain resistance to fire damage for 1 hour."), type: "consumable", value: "potion" });
    expect(cs.effects.add[0]).toMatchObject({ transfer: false, duration: { seconds: 3600 } });
    expect(cs.activities.add.some((a) => a.effects?.some((e) => e._id === cs.effects.add[0]._id))).toBe(true);
  });
  it("save activity with DC, ability and half on success (C6)", async () => {
    const { changeSet: cs } = await run({ html: p("A creature must succeed on a DC 15 Constitution saving throw or take 3d6 poison damage, or half as much damage on a successful one."), type: "equipment" });
    const a = cs.activities.add[0];
    expect(a.type).toBe("save");
    expect(a.save.ability).toEqual(["con"]);
    expect(String(a.save.dc.formula)).toBe("15");
    expect(a.damage.parts[0]).toMatchObject({ number: 3, denomination: 6, types: ["poison"] });
    expect(a.damage.onSave).toBe("half");
  });
  it("cast activity with a resolved spell and charge consumption (C6)", async () => {
    const { changeSet: cs } = await run({ html: WAND, type: "consumable", value: "wand" });
    const cast = cs.activities.add.find((a) => a.type === "cast");
    expect(cast).toBeDefined();
    expect(cast.spell.uuid).toMatch(/Fireball/i);
    expect(cast.consumption.targets[0]).toMatchObject({ type: "itemUses", value: "1" });
    expect(cs.systemPatch).toMatchObject({ "system.uses.max": "7", "system.attunement": "required" });
  });
  it("a spell that cannot be found gives a note and no activity, never an invented one", async () => {
    const { changeSet: cs } = await run({ html: WAND, type: "consumable", value: "wand" }, { resolveSpell: () => null });
    expect(cs.activities.add.some((a) => a.type === "cast")).toBe(false);
    expect(cs.rejected.some((r) => r.label.key === "dnd5e-text-parser.Note.SpellNotFound")).toBe(true);
  });
  it("charges and daily recovery for a consumable (C5)", async () => {
    const { changeSet: cs } = await run({ html: p("Wand, rare", "This wand has 7 charges. The wand regains 1d6 + 1 expended charges daily at dawn."), type: "consumable", value: "wand" });
    expect(cs.systemPatch["system.uses.max"]).toBe("7");
    expect(cs.systemPatch["system.uses.recovery"]).toEqual([{ period: "dawn", type: "formula", formula: "1d6 + 1" }]);
  });
  it("weight and price (C5)", async () => {
    const { changeSet: cs } = await run({ html: p("This weapon weighs 3 pounds and costs 50 gp."), type: "weapon", value: "martialM" });
    expect(cs.systemPatch).toMatchObject({ "system.weight.value": 3, "system.weight.units": "lb", "system.price.value": 50, "system.price.denomination": "gp" });
  });
  it("armor: base AC, Strength and stealth (C5)", async () => {
    const { changeSet: cs } = await run({ html: p("Heavy armor (plate), AC 18, Strength 15. You have disadvantage on Dexterity (Stealth) checks."), type: "equipment", value: "heavy" });
    expect(JSON.stringify(cs.systemPatch)).toContain("18");
    expect(JSON.stringify(cs.systemPatch)).toContain("15");
  });
});

describe("French reads like English (C17)", () => {
  const frEffect = (text, expected) => async () => {
    const { changeSet: cs } = await run({ html: p(text), type: "equipment" });
    expect(changesOf(cs), text).toEqual(expect.arrayContaining(expected));
  };
  it("bonus to AC", frEffect("Vous bénéficiez d'un bonus de +2 à la CA.", ["system.attributes.ac.bonus=+2"]));
  it("vulnerability", frEffect("Vous avez la vulnérabilité aux dégâts de feu.", ["system.traits.dv.value=fire"]));
  it("advantage on a skill", frEffect("Vous avez l'avantage aux tests de Dextérité (Discrétion).", ["system.skills.ste.roll.mode=1"]));
  it("advantage on a saving throw", frEffect("Vous avez l'avantage aux jets de sauvegarde de Sagesse.", ["system.abilities.wis.save.roll.mode=1"]));
  it("heal activity", async () => {
    const { changeSet: cs } = await run({ html: p("Vous regagnez 2d4 + 2 points de vie."), type: "consumable", value: "potion" });
    expect(cs.activities.add[0]).toMatchObject({ type: "heal", healing: { number: 2, denomination: 4, bonus: "2" } });
  });
  it("extra damage on an attack (library gap: \"supplementaires\" is not read in French)", async () => {
    const { changeSet: cs } = await run({ html: p("Cette lame inflige 2d6 dégâts de feu supplémentaires."), type: "weapon", value: "martialM" });
    expect(cs.activities.add[0].damage.parts[0]).toMatchObject({ number: 2, denomination: 6, types: ["fire"] });
  });
  it("cast activity", async () => {
    const { changeSet: cs } = await run({ html: p("Vous pouvez dépenser 1 charge pour lancer boule de feu (DD 15)."), type: "equipment" });
    expect(cs.activities.add[0].type).toBe("cast");
  });
});

describe("unrecognized sentences and empty results (C8, C16)", () => {
  it("an ambiance sentence goes to flavor, not to the unrecognized sentences, and nothing is invented", async () => {
    const { changeSet: cs, proposal } = await run({ html: p("Weapon (any sword), rare", "The hilt is wrapped in dragon leather."), type: "weapon", value: "martialM" });
    expect(cs.flavor).toEqual([{ text: "The hilt is wrapped in dragon leather." }]);
    expect(cs.unrecognized).toEqual([]);
    expect(cs.activities.add.flatMap((a) => a.damage?.parts ?? [])).toEqual([]);
    expect(cs.effects.add).toEqual([]);
    expect(proposal.ai.status).toBe("off");
  });
  it("a sentence that reads like a rule but has none is listed as unrecognized (C8), not as flavor", async () => {
    for (const sentence of ["The blade hums when goblins are within 60 feet.", "Cette lame murmure quand des gobelins s'approchent à moins de 18 mètres."]) {
      const { changeSet: cs } = await run({ html: p("Weapon (any sword), rare", sentence), type: "weapon", value: "martialM" });
      expect(cs.unrecognized).toEqual([{ text: sentence }]);
      expect(cs.flavor).toEqual([]);
    }
  });
  it("a clause dnd5e cannot apply goes to notAutomated with its sentence", async () => {
    const { changeSet: cs } = await run({ html: p("Weapon (any sword), rare", "You can't take reactions."), type: "weapon", value: "martialM" });
    expect(cs.notAutomated.map((n) => n.raw)).toEqual(["You can't take reactions"]);
    expect(cs.unrecognized).toEqual([]);
    expect(cs.flavor).toEqual([]);
  });
  it("a description without any mechanic is empty (C16): only the chosen type remains", async () => {
    const { changeSet: cs } = await run({ html: p("A lovingly carved wooden figure that a long-dead sculptor left behind."), type: "loot", value: "art" });
    expect(cs.empty).toBe(true);
    expect(cs.activities.add).toEqual([]);
    expect(cs.effects.add).toEqual([]);
    expect(Object.keys(cs.systemPatch)).toEqual(["system.type.value"]);
    expect(cs.entries.every((e) => e.derived)).toBe(true);
  });
  it("C16 on a weapon: the default attack is derived, so the change set is empty", async () => {
    const { changeSet: cs } = await run({ html: p("A lovingly carved sword that a long-dead smith left behind."), type: "weapon", value: "martialM" });
    expect(cs.activities.add.map((a) => a.type)).toEqual(["attack"]);
    expect(cs.entries.filter((e) => e.group === "activities").every((e) => e.derived === true)).toBe(true);
    expect(cs.empty).toBe(true);
  });
  it("an empty description is empty", async () => {
    let { changeSet: cs } = await run({ html: "", type: "weapon" });
    expect(cs.empty).toBe(true);
    expect(cs.entries.filter((e) => !e.derived)).toEqual([]);
    ({ changeSet: cs } = await run({ html: "", type: "equipment" }));
    expect(cs.empty).toBe(true);
    expect(cs.entries).toEqual([]);
    expect(cs.systemPatch).toEqual({});
  });
  it("loot and containers cannot hold activities: they are rejected, not added", async () => {
    const { changeSet: cs } = await run({ html: p("You regain 2d4 + 2 hit points when you use this."), type: "loot" });
    expect(cs.activities.add).toEqual([]);
    expect(cs.rejected.some((r) => r.label.key === "item-configurator.Preview.NotApplicable")).toBe(true);
  });
});

describe("AI fallback (C9, C10)", () => {
  const SENTENCE = "The blade glows with an eerie light whenever orcs are within 60 feet of you.";
  const html = p("Weapon (any sword), rare", SENTENCE);
  const answer = (facts) => ({ message: { content: JSON.stringify({ results: [{ index: 0, facts }] }) } });
  const fact = { kind: "effect", evidence: "within 60 feet of you", effectKind: "speed", scope: "fly", amount: 60 };
  // The quote does not contain the key word of a resistance: rejected by the hardened validation
  const unjustified = { kind: "effect", evidence: "glows with an eerie light", effectKind: "resistance", scope: "cold" };
  const resolverFor = (fetch, timeoutMs = 300) => createOllamaResolver({ url: "http://x", fetch, keys: K, timeoutMs });

  it("the rules alone leave the sentence unrecognized", async () => {
    const { changeSet: cs } = await run({ html, type: "weapon", value: "martialM" });
    expect(cs.unrecognized.map((u) => u.text)).toContain(SENTENCE);
  });
  it("only unrecognized sentences are sent, and the answer is marked fallback", async () => {
    const fetch = fakeFetch({ chat: answer([fact]) });
    const { changeSet: cs, proposal } = await run({ html, type: "weapon", value: "martialM" }, { fallback: resolverFor(fetch) });
    const chat = fetch.calls.filter((c) => c.url.endsWith("/api/chat"));
    expect(chat).toHaveLength(1);
    const prompt = chat[0].body.messages[1].content;
    expect(prompt).toContain(SENTENCE);
    expect(prompt).not.toContain("Weapon (any sword)");
    expect(proposal.ai).toMatchObject({ status: "ok", model: "llama3.1:8b" });
    expect(proposal.ai.calls).toBeGreaterThan(0);
    expect(cs.entries.some((e) => e.origin === "fallback")).toBe(true);
    expect(cs.effects.add).toHaveLength(1);
    expect(cs.entries.find((e) => e.origin === "fallback").raw).toContain("within 60 feet of you");
  });
  it("a fact whose quote does not justify it is rejected with its reason", async () => {
    const resolver = resolverFor(fakeFetch({ chat: answer([unjustified]) }));
    const { changeSet: cs } = await run({ html, type: "weapon", value: "martialM" }, { fallback: resolver });
    expect(cs.effects.add).toEqual([]);
    expect(resolver.lastRun.rejected[0].reason).toMatch(/key word of a resistance/);
    expect(cs.unrecognized.map((u) => u.text)).toContain(SENTENCE);
  });
  it("rules are never replaced by the AI: rule entries are identical with and without it", async () => {
    const rules = await run({ html, type: "weapon", value: "martialM" });
    const ai = await run({ html, type: "weapon", value: "martialM" }, { fallback: resolverFor(fakeFetch({ chat: answer([fact]) })) });
    const ruleEntries = (cs) => cs.entries.filter((e) => e.origin === "rules").map((e) => [e.group, e.action, e.label.key, e.raw]);
    expect(ruleEntries(ai.changeSet)).toEqual(expect.arrayContaining(ruleEntries(rules.changeSet)));
    expect(ai.changeSet.systemPatch).toEqual(expect.objectContaining(rules.changeSet.systemPatch));
  });
  it("an invalid proposal (quote not in the sentence) is dropped and reported", async () => {
    const resolver = resolverFor(fakeFetch({ chat: answer([{ ...fact, evidence: "deals 9d9 acid damage" }]) }));
    const { changeSet: cs } = await run({ html, type: "weapon", value: "martialM" }, { fallback: resolver });
    expect(cs.effects.add).toEqual([]);
    expect(resolver.lastRun.rejected[0].reason).toMatch(/evidence/);
    expect(cs.unrecognized.map((u) => u.text)).toContain(SENTENCE);
  });
  it("unreachable Ollama: same change set as rules only, status unreachable, no error", async () => {
    const rules = await run({ html, type: "weapon", value: "martialM" });
    const t0 = Date.now();
    const ai = await run({ html, type: "weapon", value: "martialM" }, { fallback: resolverFor(fakeFetch({ down: true })) });
    expect(ai.proposal.ai.status).toBe("unreachable");
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(ai.changeSet.systemPatch).toEqual(rules.changeSet.systemPatch);
    expect(ai.changeSet.activities.add).toEqual(rules.changeSet.activities.add);
    expect(ai.changeSet.unrecognized).toEqual(rules.changeSet.unrecognized);
  });
  it("slow Ollama beyond the delay: status timeout, rules only", async () => {
    const t0 = Date.now();
    const { proposal, changeSet } = await run({ html, type: "weapon", value: "martialM" }, { fallback: resolverFor(fakeFetch({ slow: true }), 100) });
    expect(proposal.ai.status).toBe("timeout");
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(changeSet.unrecognized.map((u) => u.text)).toContain(SENTENCE);
  });
  it("invalid JSON from the model: rules only, no exception", async () => {
    const fetch = fakeFetch({ chat: { message: { content: '{ "results": [ { "index": 0' } } });
    const { proposal, changeSet } = await run({ html, type: "weapon", value: "martialM" }, { fallback: resolverFor(fetch) });
    expect(["ok", "error"]).toContain(proposal.ai.status);
    expect(changeSet.unrecognized.map((u) => u.text)).toContain(SENTENCE);
  });
  it("no fallback: status off and no network call", async () => {
    const { proposal } = await run({ html, type: "weapon", value: "martialM" });
    expect(proposal.ai).toMatchObject({ status: "off", calls: 0 });
  });
});

describe("parser API used by the module", () => {
  it("is the 1.x API", () => {
    expect(parser.API_VERSION.split(".")[0]).toBe("1");
  });
});
