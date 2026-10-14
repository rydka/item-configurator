/** Header buttons of the item sheet: "Configure from description" and "Undo last configuration" (C1, C2, C14). */
import { MODULE_ID } from "../constants.mjs";
import { UNDO_FLAG } from "../core/snapshot.mjs";
import { buttonState, canConfigure } from "../core/access.mjs";
import { playersAllowed } from "../settings.mjs";

const CONFIGURE = `${MODULE_ID}-configure`;
const UNDO = `${MODULE_ID}-undo`;

/** Create a header button before the sheet's own copy-UUID / close controls (same technique as dnd5e). */
function createButton(element, className, icon, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("header-control", "icon", "fa-solid", icon, className);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (!button.disabled) onClick();
  });
  const header = element.querySelector(".window-header");
  const sibling = header?.querySelector('[data-action="copyUuid"], [data-action="close"]');
  if (sibling) sibling.before(button);
  else header?.append(button);
  return button;
}

function setTooltip(button, text) {
  button.dataset.tooltip = text;
  button.setAttribute("aria-label", text);
  button.dataset.tooltipDirection = "DOWN";
}

/**
 * Hook `renderItemSheet5e` (also fired for the container sheet, which extends it).
 * The buttons are created once; their state is refreshed on every render.
 */
export function onRenderItemSheet(app, element) {
  const item = app.item ?? app.document;
  if (!item) return;
  const state = buttonState({
    type: item.type,
    canConfigure: canConfigure({ isGM: game.user.isGM, isOwner: item.isOwner, allowPlayers: playersAllowed() }),
    packLocked: Boolean(item.compendium?.locked)
  });

  let configure = element.querySelector(`.${CONFIGURE}`);
  let undo = element.querySelector(`.${UNDO}`);

  if (state === "hidden") {
    configure?.remove();
    undo?.remove();
    return;
  }

  configure ??= createButton(element, CONFIGURE, "fa-wand-magic-sparkles", async () => {
    const { TypeDialog } = await import("./type-dialog.mjs");
    new TypeDialog({ item: app.item ?? app.document }).render({ force: true });
  });
  configure.disabled = state === "disabled";
  configure.classList.toggle("disabled", state === "disabled");
  setTooltip(configure, game.i18n.localize(state === "disabled" ? `${MODULE_ID}.Button.LockedPack` : `${MODULE_ID}.Button.Configure`));

  // The undo button only exists for the user who configured the item.
  const snapshot = item.getFlag(MODULE_ID, UNDO_FLAG);
  if (snapshot?.userId === game.user.id) {
    undo ??= createButton(element, UNDO, "fa-rotate-left", async () => {
      const { undoLastConfiguration } = await import("./undo.mjs");
      await undoLastConfiguration(app.item ?? app.document);
    });
    undo.disabled = state === "disabled";
    undo.classList.toggle("disabled", state === "disabled");
    setTooltip(undo, game.i18n.localize(state === "disabled" ? `${MODULE_ID}.Button.LockedPack` : `${MODULE_ID}.Button.Undo`));
  } else {
    undo?.remove();
  }
}
