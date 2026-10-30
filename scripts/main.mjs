import { MODULE_ID } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { onGetHeaderControls, onRenderItemSheet } from "./foundry/sheet-button.mjs";

export { MODULE_ID };

Hooks.once("init", () => {
  registerSettings();
  Hooks.on("renderItemSheet5e", onRenderItemSheet);
  Hooks.on("getHeaderControlsItemSheet5e", onGetHeaderControls);

  // Public API (C18). Loaded on first call so the module stays light at startup.
  const self = game.modules.get(MODULE_ID);
  if (self) {
    self.api = {
      configure: async (...args) => (await import("./foundry/api.mjs")).configure(...args),
      open: async (...args) => (await import("./foundry/api.mjs")).open(...args)
    };
  }

  // The AI settings window extends ApplicationV2: load it now, register the menu when it is ready.
  import("./foundry/ai-settings.mjs").then(({ AiSettingsApp }) => {
    game.settings.registerMenu(MODULE_ID, "ai", {
      name: `${MODULE_ID}.AiSettings.MenuName`,
      label: `${MODULE_ID}.AiSettings.MenuLabel`,
      hint: `${MODULE_ID}.AiSettings.MenuHint`,
      icon: "fa-solid fa-robot",
      type: AiSettingsApp,
      restricted: true
    });
  }).catch((err) => console.error(`${MODULE_ID} | AI settings menu unavailable`, err));
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.errors.wrongSystem`));
    return;
  }
  if (!game.modules.get("dnd5e-text-parser")?.active) {
    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.errors.parserMissing`));
    return;
  }
  console.log(`${MODULE_ID} | ready`);
});
