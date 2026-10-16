# Hidden control set (free-form texts)

Written by the tester in the style of the user's items (property titles, free prose, "per dawn" / "per rest" uses, meters, command words). **Developers do not read this folder** and it is never used as a prompt example; it measures generalization.

- `items-fr.json` (14) and `items-en.json` (8): same shape as the other sets (`name`, `type`, `value`, `subtype`, `description` HTML), but `truth` is a list of hand-written facts in the vocabulary of comparator v2 (`tests/metrics/run-reference.mjs`): `facts[] {path, value, critical?, alternatives?[]}`, `forbidden[]` (a proposed fact equal to one of them is a critical error), `notAutomated[]` (clauses expected in "not automated", for the C8 check).
- `covers` lists what each item exercises. Two items have nothing automatable beyond the header (Collier des Deux Gardiens, Boots of the Quiet Step), two carry a prompt-injection attempt (Eclat de Verite, Amulet of the Last Candle).
- Alternatives are limited to equivalent readings: a use "per dawn" may be read as per day; a magical bonus on a shield may be an AC effect; staff charges recovered by a formula may carry no period.
- `build.mjs` regenerates the two JSON files. `results/` holds the totals of the passes (rules alone, comparator v2).
- Committed before any measurement.
