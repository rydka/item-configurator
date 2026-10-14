import { MODULE_ID } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";

export { MODULE_ID };

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.errors.wrongSystem`));
    return;
  }
  console.log(`${MODULE_ID} | ready`);
});
