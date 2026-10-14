# Ollama response fixtures

Recorded or hand-written answers of `POST /api/chat` (envelope `{ description, sentences, response: { message: { content } } }`). Unit tests of `scripts/ai` replay them through a fake `fetch`; they never call Ollama.

- Recorded with `node tests/metrics/record-ollama.mjs` (model `llama3.1:8b`, temperature 0, seed 0): `single-damage`, `save-condition`, `uses-recharge`, `french`, `no-mechanics`, `batch`. They keep the model's real flaws (missing dice, wrong kind) on purpose: the validator must not trust them.
- Hand-written (`"handcrafted": true`): `valid`, `citation-absent`, `unknown-key`, `out-of-bounds`, `unknown-kind`, `invalid-json`, `wrong-index`, `empty`.
- `schema.json` is the JSON schema sent as `format`, built from `../reference/keys.json`. The fact field names (`dice`, `damageType`, `ability`, `dc`...) are the tester's assumption; align them with `scripts/ai/resolver.mjs` once written.
