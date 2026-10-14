// Records real Ollama responses as unit-test fixtures (tests/fixtures/ollama/*.json), using the module's own
// prompt and schema (scripts/ai/prompt.mjs) so the fixtures match the client.
// Usage: node tests/metrics/record-ollama.mjs [--model=llama3.1:8b] [--url=http://localhost:11434]
// Never pulls a model; fails if the model is not installed. The unit tests do not depend on Ollama at run time.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMessages, buildSchema } from "../../scripts/ai/prompt.mjs";
import { keys as loadKeys } from "../helpers/keys.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? d;
const MODEL = arg("model", "llama3.1:8b");
const URL_ = arg("url", "http://localhost:11434");
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "ollama");
const schema = buildSchema(loadKeys());

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
  const body = {
    model: MODEL, stream: false, keep_alive: "10m", format: schema,
    options: { temperature: 0, seed: 0, num_ctx: 2048, num_predict: 512 },
    messages: buildMessages(sentences.map((sentence) => ({ sentence })))
  };
  const t0 = Date.now();
  const res = await fetch(`${URL_}/api/chat`, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const response = await res.json();
  const slim = { model: response.model, message: response.message, done: response.done };
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({
    description: name, sentences, requestModel: MODEL, elapsedMs: Date.now() - t0, response: slim
  }, null, 1) + "\n");
  console.log(name, Date.now() - t0, "ms", slim.message.content.slice(0, 200));
}
fs.writeFileSync(path.join(OUT, "schema.json"), JSON.stringify(schema, null, 1) + "\n");
