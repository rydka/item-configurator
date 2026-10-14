export const MODULE_ID = "item-configurator";

/**
 * Register module settings. Called on the `init` hook.
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, "enabled", {
    name: `${MODULE_ID}.settings.enabled.name`,
    hint: `${MODULE_ID}.settings.enabled.hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}

export function isEnabled() {
  return game.settings.get(MODULE_ID, "enabled");
}

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
