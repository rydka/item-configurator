// M4 (rules only): time from "Analyze" to the rendered preview, read from the item-configurator.previewReady hook,
// on the objects of the reference set (EN and FR). It records the values and never fails on them.
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { PREFIX, clientCleanup, evidence, fixtureJson } from "./helpers.mjs";

test.describe.configure({ timeout: 900_000 });

test.afterEach(async ({ foundry }) => {
  await foundry(clientCleanup, PREFIX);
});

test("M4: previewReady durations on the reference set, rules only", async ({ foundry }) => {
  const items = [
    ...fixtureJson("reference/srd-items.json").map((i) => ({ ...i, lang: "en" })),
    ...fixtureJson("reference/fr-items.json").map((i) => ({ ...i, lang: "fr" }))
  ];
  const rows = [];
  for (const entry of items) {
    const row = await foundry(async ({ prefix, entry }) => {
      const item = await Item.implementation.create({ name: `${prefix}${entry.name}`, type: entry.type, system: { description: { value: entry.description } } });
      const { TypeDialog } = await import("/modules/item-configurator/scripts/foundry/type-dialog.mjs");
      let payload = null;
      const hook = Hooks.once("item-configurator.previewReady", (p) => { payload = p; });
      const dialog = new TypeDialog({ item });
      await dialog.render({ force: true });
      const typeSelect = dialog.element.querySelector('select[name="type"]');
      typeSelect.value = entry.type;
      typeSelect.dispatchEvent(new Event("change"));
      const subtype = dialog.element.querySelector('select[name="subtype"]');
      const wanted = [...subtype.options].find((o) => o.value === `${entry.value}|`);
      if (wanted) subtype.value = wanted.value;
      const started = performance.now();
      dialog.element.querySelector(".item-configurator-analyze").click();
      while (!payload && performance.now() - started < 10_000) await new Promise((resolve) => setTimeout(resolve, 10));
      Hooks.off("item-configurator.previewReady", hook);
      const wallMs = performance.now() - started;
      for (const app of [...foundry.applications.instances.values()]) {
        if (app.options?.classes?.includes("item-configurator")) await app.close().catch(() => {});
      }
      await item.delete();
      return { name: entry.name, lang: entry.lang, previewed: Boolean(payload), durationMs: payload?.durationMs ?? null, wallMs: Math.round(wallMs) };
    }, { prefix: PREFIX, entry });
    rows.push(row);
  }
  const times = rows.filter((r) => r.previewed).map((r) => r.durationMs).sort((a, b) => a - b);
  const pick = (q) => times[Math.min(times.length - 1, Math.floor(times.length * q))] ?? null;
  const summary = {
    items: rows.length, previews: times.length, noPreview: rows.filter((r) => !r.previewed).map((r) => r.name),
    medianMs: pick(0.5), p95Ms: pick(0.95), maxMs: times.at(-1) ?? null, targetMs: 1000, withinTarget: times.filter((t) => t <= 1000).length
  };
  evidence("M4-previewReady.json", { summary, rows });
  console.log(`M4: ${summary.previews}/${summary.items} previews, median ${summary.medianMs?.toFixed(0)} ms, p95 ${summary.p95Ms?.toFixed(0)} ms, max ${summary.maxMs?.toFixed(0)} ms`);
  expect(times.length).toBeGreaterThan(0);
});
