import { describe, expect, it } from "vitest";

const load = () => import("../../scripts/main.mjs");

describe("main", () => {
  it("registers its settings on init", async () => {
    const { MODULE_ID, isEnabled } = await load();
    Hooks.callAll("init");
    expect(game.settings.register).toHaveBeenCalledWith(MODULE_ID, "enabled", expect.any(Object));
    expect(isEnabled()).toBe(true);
  });

  it("reports an error when the system is not dnd5e", async () => {
    game.system.id = "pf2e";
    await load();
    Hooks.callAll("init");
    Hooks.callAll("ready");
    expect(ui.notifications.error).toHaveBeenCalledOnce();
  });
});
