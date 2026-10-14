// Writes tests/fixtures/reference/keys.snapshot.json = keysSnapshot(CONFIG.DND5E-like) (sorted arrays, JSON safe).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keysSnapshot } from "dnd5e-text-parser";
import { dnd5eConfig } from "../helpers/keys.mjs";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "reference", "keys.snapshot.json");
fs.writeFileSync(out, JSON.stringify(keysSnapshot(dnd5eConfig()), null, 1) + "\n");
