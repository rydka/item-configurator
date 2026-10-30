# Simulated Claude answers (T1)

Hand-written, no network call. Regenerate with `node tests/metrics/build-claude-fixtures.mjs`.

- One file per case. `input` = the item sent (`paragraphs` are the plain-text paragraphs `[P1]...`; `items.json` has the HTML). `response` = a full Messages API payload (`content[0].text` is the JSON string, `stop_reason`, `usage` with cache tokens, `model`). `world.metric` = unit system of the world used by the case. HTTP and network failures use `httpError {status, body}` / `networkError` instead of `response`.
- `cases.json`: one entry per file with the expectation, loosely typed. `kind` = `valid` (no rejection), `invalid` (correction or rejection listed as `{ref, field, reason}`; `reason` is indicative, tests match on `ref` and `field`), `fallback` (whole answer discarded, rules only; `status` is indicative).
- `expected.json`: dnd5e configuration expected for the ring and the compass (design-claude-first.md, "Cas de test"), world in feet.
- Shape assumptions (design section 2 leaves them open): numbers are JSON numbers (`activation.value`, `range.value`, `template.size`, `duration.value`, `uses.max`, `consume.amount`, `Dice.number`), `Dice.bonus` is a string, `0` / `""` / `[]` mean absent.
- The ring and the compass texts are written for these fixtures (the user's originals are not in the repository).
