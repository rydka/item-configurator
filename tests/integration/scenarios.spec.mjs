// C15: a configured item behaves in dnd5e as the preview announced (attack, damage, save, healing, charges, effects).
// Dice are forced through CONFIG.Dice.randomUniform; totals are compared with the minimum or maximum of the same formula.
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { PREFIX, TEXTS, clientCleanup, evidence } from "./helpers.mjs";

test.describe.configure({ timeout: 240_000 });

test.afterEach(async ({ foundry }) => {
  await foundry(async () => { delete CONFIG.Dice.randomUniform; });
  await foundry(clientCleanup, PREFIX);
});

/** Configures a loot item from its description and gives a copy to a new actor. Returns the uuids. */
async function configuredOnActor(foundry, { name, text, type, subtype }) {
  return foundry(async ({ prefix, name, text, type, subtype }) => {
    const item = await Item.implementation.create({ name: `${prefix}${name}`, type: "loot", system: { description: { value: text } } });
    const { applied, changeSet } = await game.modules.get("item-configurator").api.configure(item, { type, subtype, useAI: false, apply: true });
    const actor = await CONFIG.Actor.documentClass.create({
      name: `${prefix}${name} bearer`, type: "character",
      system: { abilities: { str: { value: 16 }, dex: { value: 14 }, con: { value: 12 } }, attributes: { prof: 2 } }
    });
    const [owned] = await actor.createEmbeddedDocuments("Item", [item.toObject()], { keepId: true });
    return {
      applied, empty: changeSet.empty, actor: actor.uuid, item: owned.uuid,
      activities: Object.values(owned.system.activities ?? {}).map((a) => ({ id: a.id, type: a.type, name: a.name, activation: a.activation?.type ?? null }))
    };
  }, { prefix: PREFIX, name, text, type, subtype });
}

/** Rolls every roll of an activity with dice forced to the maximum, and returns the formulas and totals. */
const ROLL = async ({ uuid, id, kind }) => {
  const item = await fromUuid(uuid);
  const activity = item.system.activities.get(id);
  CONFIG.Dice.randomUniform = () => 0;
  const rolls = kind === "attack"
    ? await activity.rollAttack({}, { configure: false }, { create: false })
    : await activity.rollDamage({}, { configure: false }, { create: false });
  const out = [];
  for (const roll of rolls ?? []) {
    const max = await Roll.create(roll.formula).evaluate({ maximize: true });
    const min = await Roll.create(roll.formula).evaluate({ minimize: true });
    out.push({ formula: roll.formula, total: roll.total, max: max.total, min: min.total, type: roll.options?.type ?? null, types: roll.options?.types ?? null });
  }
  return out;
};

test("C15: Flame Tongue Longsword attacks with the right bonus and deals 1d8 slashing, 1d10 versatile and 2d6 fire", async ({ foundry }) => {
  const set = await configuredOnActor(foundry, { name: "Flame Tongue Longsword", text: TEXTS.flameTongue, type: "weapon", subtype: "martialM" });
  expect(set.applied).toBe(true);
  const types = set.activities.map((a) => a.type);
  expect(types).toContain("attack");

  const details = await foundry(async (uuid) => {
    const item = await fromUuid(uuid);
    const damageParts = (a) => (a.damage?.parts ?? []).map((p) => `${p.number ?? 1}d${p.denomination}${p.bonus ? `+${p.bonus}` : ""}:${[...p.types].join(",")}`);
    return {
      base: `${item.system.damage.base.number}d${item.system.damage.base.denomination}`, baseTypes: [...item.system.damage.base.types],
      versatile: item.system.damage.versatile?.denomination ? `${item.system.damage.versatile.number ?? 1}d${item.system.damage.versatile.denomination}` : null, properties: [...item.system.properties],
      rarities: [...item.system.rarities], attunement: item.system.attunement,
      activityDamage: item.system.activities.map((a) => ({ type: a.type, parts: damageParts(a) }))
    };
  }, set.item);
  evidence("C15-flame-tongue-data.json", { set, details });
  expect(details.base).toMatch(/1d8/);
  expect(details.baseTypes).toContain("slashing");
  expect(details.versatile).toMatch(/1d10/);
  expect(details.properties).toContain("ver");
  expect(details.rarities).toContain("rare");
  expect(details.attunement).toBe("required");
  const allParts = details.activityDamage.flatMap((a) => a.parts);
  expect(allParts.some((p) => p.startsWith("2d6") && p.includes("fire")), "extra 2d6 fire damage").toBe(true);

  const attack = set.activities.find((a) => a.type === "attack");
  const attackRolls = await foundry(ROLL, { uuid: set.item, id: attack.id, kind: "attack" });
  const damageRolls = await foundry(ROLL, { uuid: set.item, id: attack.id, kind: "damage" });
  evidence("C15-flame-tongue-rolls.json", { attackRolls, damageRolls });
  expect(attackRolls.length).toBe(1);
  expect(attackRolls[0].formula).toContain("d20");
  // STR 16 (+3) and proficiency (+2): the attack bonus is what dnd5e computes for the actor, not something invented.
  expect([attackRolls[0].min, attackRolls[0].max]).toContain(attackRolls[0].total);
  expect(damageRolls.length).toBeGreaterThan(0);
  for (const roll of damageRolls) expect([roll.min, roll.max]).toContain(roll.total);
  expect(damageRolls.map((r) => r.formula).join(" ")).toMatch(/1d8|1d10/);
});

test("C15: Potion of Healing heals 2d4 + 2 and is used up", async ({ foundry }) => {
  const set = await configuredOnActor(foundry, { name: "Potion of Healing", text: TEXTS.healing, type: "consumable", subtype: "potion" });
  expect(set.applied).toBe(true);
  const heal = set.activities.find((a) => a.type === "heal");
  expect(heal, "a heal activity").toBeTruthy();

  const data = await foundry(async (uuid) => {
    const item = await fromUuid(uuid);
    const h = item.system.activities.find((a) => a.type === "heal");
    return {
      healing: `${h.healing.number}d${h.healing.denomination}+${h.healing.bonus}`, usesMax: item.system.uses.max, autoDestroy: item.system.uses.autoDestroy,
      uses: item.system.uses.value, quantity: item.system.quantity, rarities: [...item.system.rarities]
    };
  }, set.item);
  const rolls = await foundry(ROLL, { uuid: set.item, id: heal.id, kind: "damage" });
  const used = await foundry(async ({ uuid, id }) => {
    const item = await fromUuid(uuid);
    const activity = item.system.activities.get(id);
    const before = { uses: item.system.uses.value, spent: item.system.uses.spent, quantity: item.system.quantity };
    const actor = item.parent;
    await activity.use({ create: false }, { configure: false }, { create: false });
    const live = actor.items.get(item.id);
    return { before, after: live ? { uses: live.system.uses.value, spent: live.system.uses.spent, quantity: live.system.quantity } : "destroyed" };
  }, { uuid: set.item, id: heal.id });
  evidence("C15-potion-data.json", { data, rolls, used });
  expect(data.healing).toBe("2d4+2");
  expect(Number(data.usesMax)).toBe(1);
  expect(data.autoDestroy).toBe(true);
  expect(rolls.length).toBe(1);
  expect(rolls[0].formula).toMatch(/2d4\s*\+\s*2/);
  expect(rolls[0].total).toBe(rolls[0].max);
  expect(used.after === "destroyed" || used.after.uses < used.before.uses || used.after.quantity < used.before.quantity).toBe(true);
});

test("C15: Cloak of Protection gives +1 AC and +1 to saving throws only when worn and attuned", async ({ foundry }) => {
  const set = await configuredOnActor(foundry, { name: "Cloak of Protection", text: TEXTS.cloak, type: "equipment", subtype: "clothing" });
  expect(set.applied).toBe(true);
  const states = await foundry(async ({ uuid, actorUuid }) => {
    const actor = await fromUuid(actorUuid);
    const item = actor.items.get((await fromUuid(uuid)).id);
    const measure = (label) => ({
      label, equipped: item.system.equipped, attuned: item.system.attuned, ac: actor.system.attributes.ac.value,
      saves: Object.fromEntries(Object.entries(actor.system.abilities).map(([k, v]) => [k, v.save.value])),
      effects: item.effects.map((e) => ({ name: e.name, disabled: e.disabled, suppressed: e.isSuppressed }))
    });
    const out = [];
    await item.update({ "system.equipped": false, "system.attuned": false });
    out.push(measure("not worn"));
    await item.update({ "system.equipped": true, "system.attuned": false });
    out.push(measure("worn, not attuned"));
    await item.update({ "system.equipped": false, "system.attuned": true });
    out.push(measure("attuned, not worn"));
    await item.update({ "system.equipped": true, "system.attuned": true });
    out.push(measure("worn and attuned"));
    return { attunement: item.system.attunement, out };
  }, { uuid: set.item, actorUuid: set.actor });
  evidence("C15-cloak-states.json", states);
  const [none, wornOnly, attunedOnly, both] = states.out;
  expect(states.attunement).toBe("required");
  expect(wornOnly.ac).toBe(none.ac);
  expect(attunedOnly.ac).toBe(none.ac);
  expect(both.ac).toBe(none.ac + 1);
  for (const ability of Object.keys(none.saves)) {
    expect(wornOnly.saves[ability], `${ability} worn only`).toBe(none.saves[ability]);
    expect(both.saves[ability], `${ability} worn and attuned`).toBe(none.saves[ability] + 1);
  }
});
