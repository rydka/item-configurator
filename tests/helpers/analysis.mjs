// Runs the real analysis (core/analyze + core/changes) with the real parser, for unit tests and reference replay.
import * as parser from "dnd5e-text-parser";
import { analyze } from "../../scripts/core/analyze.mjs";
import { buildChangeSet } from "../../scripts/core/changes.mjs";
import { keys } from "./keys.mjs";

export { parser };
export const K = keys();

export const idGenerator = () => {
  let n = 0;
  return () => `tid${String(n++).padStart(13, "0")}`;
};
export const blank = (type) => ({ type, system: {}, effects: [] });
export const resolveSpell = (name) => `Compendium.dnd5e.spells.Item.${String(name).replace(/\W+/g, "")}`;

/** Analyze `html` for a target type and compute the change set against `source` (blank item by default). */
export async function run({ name = "Item", html, type, value = "", subtype = "" }, { source = blank(type), replace = false, ...context } = {}) {
  const proposal = await analyze({ name, html, type, value, subtype, source }, {
    parser, keys: K, idGen: idGenerator(), resolveSpell, ...context
  });
  return { proposal, changeSet: buildChangeSet(source, proposal, { replace, parser }) };
}

export const p = (...paragraphs) => paragraphs.map((t) => `<p>${t}</p>`).join("");
