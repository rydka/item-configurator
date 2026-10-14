// Records real Ollama responses as unit-test fixtures (tests/fixtures/ollama/*.json).
// Usage: node tests/metrics/record-ollama.mjs [--model=llama3.1:8b] [--url=http://localhost:11434]
// Never pulls a model; fails if the model is not installed. The unit tests do not depend on Ollama at run time.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? d;
const MODEL = arg("model", "llama3.1:8b");
const URL_ = arg("url", "http://localhost:11434");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ollama");

const keys = JSON.parse(fs.readFileSync(path.join(OUT, "..", "reference", "keys.json"), "utf8"));
const enumOf = (name) => Object.keys(keys[name] ?? {});
export const KINDS = ["attack", "damage", "save", "heal", "uses", "activation", "consume", "cast", "effect", "detail"];

export const schema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          facts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: KINDS },
                evidence: { type: "string" },
                dice: { type: "string" },
                damageType: { type: "string", enum: enumOf("damageTypes") },
                ability: { type: "string", enum: enumOf("abilities") },
                dc: { type: "integer" },
                uses: { type: "integer" },
                period: { type: "string", enum: enumOf("limitedUsePeriods") },
                activation: { type: "string", enum: enumOf("activityActivationTypes") },
                condition: { type: "string", enum: enumOf("statusEffects") }
              },
              required: ["kind", "evidence"]
            }
          }
        },
        required: ["index", "facts"]
      }
    }
  },
  required: ["results"]
};

export const SYSTEM = "You extract game mechanics from D&D 5e item sentences. Only extract mechanics that are explicitly stated; return an empty facts array otherwise. Every fact must quote its exact `evidence` from the sentence. Example: \"The blade deals an extra 1d6 fire damage.\" -> {kind:\"damage\",dice:\"1d6\",damageType:\"fire\",evidence:\"extra 1d6 fire damage\"}. Exemple : \"Jet de sauvegarde de Sagesse DD 14.\" -> {kind:\"save\",ability:\"wis\",dc:14,evidence:\"Sagesse DD 14\"}.";

export const CASES = {
  "single-damage": ["Once per turn, a hit with this weapon deals an extra 2d6 necrotic damage."],
  "save-condition": ["A creature hit must succeed on a DC 15 Wisdom saving throw or be frightened."],
  "uses-recharge": ["The staff has 7 charges and regains 1d6 + 1 expended charges daily at dawn."],
  "french": ["Vous pouvez utiliser une action bonus pour lancer boule de feu (DD 15) une fois par repos long."],
  "no-mechanics": ["A lovingly carved wooden figure that a long-dead sculptor left behind."],
  "batch": [
    "When you drink this potion you regain 2d4 + 2 hit points.",
    "A creature must make a DC 12 Constitution saving throw or take 3d6 poison damage.",
    "The cloak smells faintly of lavender."
  ]
};

for (const [name, sentences] of Object.entries(CASES)) {
  const userContent = JSON.stringify(sentences.map((text, index) => ({ index, text })));
  const body = {
    model: MODEL, stream: false, keep_alive: "10m", format: schema,
    options: { temperature: 0, seed: 0, num_ctx: 2048, num_predict: 512 },
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userContent }]
  };
  const t0 = Date.now();
  const res = await fetch(`${URL_}/api/chat`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const response = await res.json();
  const slim = { model: response.model, message: response.message, done: response.done };
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({
    description: name, sentences, requestModel: MODEL, elapsedMs: Date.now() - t0, response: slim
  }, null, 1) + "\n");
  console.log(name, Date.now() - t0, "ms", slim.message.content.slice(0, 160));
}
fs.writeFileSync(path.join(OUT, "schema.json"), JSON.stringify(schema, null, 1) + "\n");
