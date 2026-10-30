/**
 * Item sheet entry points of the module (C1, C2, C14):
 * - a toolbar with explicit "Configure" / "Undo" buttons under the sheet header (what the user sees first),
 * - the small icons in the window title bar (kept, same technique as dnd5e),
 * - entries in the "⋮" header controls menu (the standard v14 place).
 */
import { MODULE_ID } from "../constants.mjs";
import { UNDO_FLAG } from "../core/snapshot.mjs";
import { buttonState, canConfigure } from "../core/access.mjs";
import { playersAllowed } from "../settings.mjs";

const CONFIGURE = `${MODULE_ID}-configure`;
const UNDO = `${MODULE_ID}-undo`;
const TOOLBAR = `${MODULE_ID}-toolbar`;
const CONFIGURE_BUTTON = `${MODULE_ID}-configure-button`;
const UNDO_BUTTON = `${MODULE_ID}-undo-button`;
const CONFIGURE_ICON = "fa-wand-magic-sparkles";
const UNDO_ICON = "fa-rotate-left";

/* -------------------------------------------- */
/*  State                                       */
/* -------------------------------------------- */

/** @returns {{ item: Item|null, state: "hidden"|"disabled"|"enabled", canUndo: boolean }} */
function sheetState(app) {
  const item = app.item ?? app.document;
  if (!item) return { item: null, state: "hidden", canUndo: false };
  const state = buttonState({
    type: item.type,
    canConfigure: canConfigure({ isGM: game.user.isGM, isOwner: item.isOwner, allowPlayers: playersAllowed() }),
    packLocked: Boolean(item.compendium?.locked)
  });
  // The undo action only exists for the user who configured the item.
  const snapshot = item.getFlag(MODULE_ID, UNDO_FLAG);
  return { item, state, canUndo: snapshot?.userId === game.user.id };
}

async function openConfigure(app) {
  const { TypeDialog } = await import("./type-dialog.mjs");
  new TypeDialog({ item: app.item ?? app.document }).render({ force: true });
}

async function runUndo(app) {
  const { undoLastConfiguration } = await import("./undo.mjs");
  await undoLastConfiguration(app.item ?? app.document);
}

function tooltipKey(state, key) {
  return `${MODULE_ID}.Button.${state === "disabled" ? "LockedPack" : key}`;
}

function setTooltip(button, text) {
  button.dataset.tooltip = text;
  button.setAttribute("aria-label", text);
  button.dataset.tooltipDirection = "DOWN";
}

/** Apply the enabled / disabled state and the matching tooltip to a button. */
function refreshButton(button, state, key) {
  const disabled = state === "disabled";
  button.disabled = disabled;
  button.classList.toggle("disabled", disabled);
  setTooltip(button, game.i18n.localize(tooltipKey(state, key)));
}

/* -------------------------------------------- */
/*  Title bar icons                             */
/* -------------------------------------------- */

/** Create a header icon before the sheet's own copy-UUID / close controls (same technique as dnd5e). */
function createHeaderIcon(element, className, icon, onClick) {
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

/* -------------------------------------------- */
/*  Toolbar under the sheet header              */
/* -------------------------------------------- */

/**
 * The toolbar is a sibling of the sheet parts, inserted after the header part: the Handlebars mixin replaces each
 * part in place on re-render, so the toolbar survives and is only refreshed.
 */
function getToolbar(element) {
  let toolbar = element.querySelector(`.${TOOLBAR}`);
  if (toolbar) return toolbar;
  const anchor = element.querySelector('[data-application-part="header"], .sheet-header');
  if (!anchor) return null;
  toolbar = document.createElement("div");
  toolbar.classList.add(MODULE_ID, TOOLBAR);
  anchor.after(toolbar);
  return toolbar;
}

function createToolbarButton(toolbar, className, icon, labelKey, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add(className);
  const i = document.createElement("i");
  i.className = `fa-solid ${icon}`;
  i.inert = true;
  const span = document.createElement("span");
  span.textContent = game.i18n.localize(`${MODULE_ID}.Button.${labelKey}`);
  button.append(i, span);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    if (!button.disabled) onClick();
  });
  toolbar.append(button);
  return button;
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/**
 * Hook `renderItemSheet5e` (also fired for the container sheet, which extends it).
 * The buttons are created once; their state is refreshed on every render.
 */
export function onRenderItemSheet(app, element) {
  const { item, state, canUndo } = sheetState(app);
  if (!item) return;

  let configure = element.querySelector(`.${CONFIGURE}`);
  let undo = element.querySelector(`.${UNDO}`);
  const toolbar = getToolbar(element);
  let configureButton = toolbar?.querySelector(`.${CONFIGURE_BUTTON}`);
  let undoButton = toolbar?.querySelector(`.${UNDO_BUTTON}`);

  if (state === "hidden") {
    configure?.remove();
    undo?.remove();
    toolbar?.remove();
    return;
  }

  configure ??= createHeaderIcon(element, CONFIGURE, CONFIGURE_ICON, () => openConfigure(app));
  refreshButton(configure, state, "Configure");
  if (toolbar) {
    configureButton ??= createToolbarButton(toolbar, CONFIGURE_BUTTON, CONFIGURE_ICON, "ConfigureLabel", () => openConfigure(app));
    refreshButton(configureButton, state, "Configure");
  }

  if (canUndo) {
    undo ??= createHeaderIcon(element, UNDO, UNDO_ICON, () => runUndo(app));
    refreshButton(undo, state, "Undo");
    if (toolbar) {
      undoButton ??= createToolbarButton(toolbar, UNDO_BUTTON, UNDO_ICON, "Undo", () => runUndo(app));
      refreshButton(undoButton, state, "Undo");
    }
  } else {
    undo?.remove();
    undoButton?.remove();
  }
}

/**
 * Hook `getHeaderControlsItemSheet5e`: entries of the "⋮" menu. The hook fires each time the menu opens, so the
 * state is always current. A context menu has no disabled state: on a locked compendium the entries are
 * listed and explain the lock instead of acting (the toolbar and title bar buttons show the disabled state).
 * @param {ItemSheet5e} app
 * @param {ApplicationHeaderControlsEntry[]} controls
 */
export function onGetHeaderControls(app, controls) {
  const { item, state, canUndo } = sheetState(app);
  if (!item || state === "hidden") return;
  const locked = state === "disabled";
  const warnLocked = () => ui.notifications.warn(game.i18n.localize(`${MODULE_ID}.Button.LockedPack`));

  controls.push({
    action: `${MODULE_ID}-configure`,
    icon: `fa-solid ${CONFIGURE_ICON}`,
    label: `${MODULE_ID}.Button.Configure`,
    onClick: () => (locked ? warnLocked() : openConfigure(app))
  });
  if (canUndo) {
    controls.push({
      action: `${MODULE_ID}-undo`,
      icon: `fa-solid ${UNDO_ICON}`,
      label: `${MODULE_ID}.Button.Undo`,
      onClick: () => (locked ? warnLocked() : runUndo(app))
    });
  }
}
