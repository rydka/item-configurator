# Reference set M2/M3

- `srd-items.json`: 70 English items extracted from `dnd5e.items` and `dnd5e.equipment24` by `tests/integration/extract-reference.spec.mjs` (`IC_EXTRACT=1`), stratified and deterministic (`tests/metrics/select-reference.mjs`). `truth` = `system` (without description and activities), `activities`, `effects` of the compendium document.
- `fr-items.json`: 20 of these items with hand-written French name and description (`tests/metrics/build-fr-items.mjs`), same `truth`.
- `keys.json`: snapshot of the `CONFIG.DND5E` dictionaries (key -> localized label). It is a raw snapshot, not the output of `keysFromConfig` (not written yet); adapt when it exists.
- `type-config.json`: item types, sub-types, activity types, versions.
- Extraction was done on Foundry 14.369 and dnd5e 6.0.6. Committed before any measurement.
