/**
 * Floating "End Turn" button anchored above the centre of the hotbar.
 *
 * It is only visible while a combat encounter is active and the current user
 * is allowed to advance the current turn — i.e. the GM, or the player who
 * owns the active combatant. Clicking it does exactly what the Combat Tracker
 * sidebar's End Turn control does: calls `combat.nextTurn()`. Round rollovers
 * are still handled by the dynamic-initiative wrapper on `Combat#nextRound`.
 */

let advancing = false;

/** Whether this user may end the combat's current turn right now. */
function canEndCurrentTurn(combat) {
  if (!combat?.started) return false;
  if (game.user.isGM) return true;
  const combatant = combat.combatant;
  return !!combatant && combatant.players?.some((u) => u.id === game.user.id);
}

/**
 * Whatever must appear and disappear with the turn carries this class: the two
 * caps when they sit in the action row, the floating plate when they do not.
 */
const TURN_CONTROL = ".redsteel-turn-control";

/**
 * The experimental BG3 hotbar hides the core `#hotbar`, so when it is active
 * the buttons live on that panel instead. Either container may be absent.
 */
function refreshButton(root = ui.redsteelHotbar?.element ?? ui.hotbar?.element) {
  const controls = root?.querySelectorAll?.(TURN_CONTROL);
  if (!controls?.length) return;
  const visible = canEndCurrentTurn(game.combat);
  for (const control of controls) control.classList.toggle("hidden", !visible);
}

async function onEndTurn() {
  const combat = game.combat;
  if (advancing || !canEndCurrentTurn(combat)) return;

  advancing = true;
  refreshButton();
  try {
    await combat.nextTurn();
  } catch (err) {
    console.error("REDSTEEL | End Turn failed", err);
    ui.notifications.warn("Unable to end your turn.");
  } finally {
    advancing = false;
    refreshButton();
  }
}

/**
 * Where the controls belong in this container.
 *
 * On the Redsteel panel the two close the action row, Delay then End, set off
 * from the last ability by the gap the GM tools use at the other end. They are
 * in flow rather than pinned to the row's edge, so the row centres itself and
 * the pair ends up with the same air on the right that the GM tools have on the
 * left. Joining the existing row rather than adding one also keeps the panel
 * from changing height when combat starts.
 *
 * Ending the turn is the row's most consequential button, so it sits furthest
 * from the abilities you press every round rather than next to the sword.
 *
 * The core hotbar has no such row, so there the pair floats above the bar's
 * left corner. Same two buttons either way.
 */
function placeControls(root, endButton, delayButton) {
  delayButton.classList.add("redsteel-turn-button");
  endButton.classList.add("redsteel-turn-button");

  const group = document.createElement("div");
  group.className = "redsteel-turn-group redsteel-turn-control hidden";
  group.append(delayButton, endButton);

  const actions = root.querySelector(".rs-bg3-row--actions");
  if (actions) {
    // The panel renders its own buttons before this hook fires, so appending
    // lands the pair after every action including the GM tools.
    actions.append(group);
    return;
  }

  group.classList.add("redsteel-turn-group--floating");
  root.appendChild(group);
}

function injectButton(element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root || root.querySelector(TURN_CONTROL)) return;

  // Icon only, like the action row they sit in. The label moves to the panel's
  // tooltip (`data-tt-kind`), which is what every other icon cell here uses.
  const endButton = document.createElement("button");
  endButton.type = "button";
  endButton.className = "redsteel-end-turn";
  endButton.setAttribute("aria-label", "End Turn");
  endButton.dataset.ttKind = "text";
  endButton.dataset.ttText = "End Turn";
  endButton.innerHTML = '<i class="fa-regular fa-flag"></i>';
  endButton.addEventListener("click", (event) => {
    event.preventDefault();
    onEndTurn();
  });

  const delayButton = document.createElement("button");
  delayButton.type = "button";
  delayButton.className = "redsteel-delay-turn";
  delayButton.setAttribute("aria-label", "Delay Turn");
  delayButton.dataset.ttKind = "text";
  delayButton.dataset.ttText = "Delay Turn";
  delayButton.innerHTML = '<i class="fa-light fa-hourglass-half"></i>';
  delayButton.addEventListener("click", (event) => {
    event.preventDefault();
    game.redsteel.delayTurn();
  });

  placeControls(root, endButton, delayButton);
  refreshButton(root);
}

export function registerEndTurnButton() {
  Hooks.on("renderHotbar", (_app, element) => injectButton(element));
  // ApplicationV2 emits render<ClassName>; the panel class is named Bg3Hotbar.
  Hooks.on("renderBg3Hotbar", (_app, element) => injectButton(element));

  // Refresh visibility whenever combat state that affects the active turn
  // or this user's permission to advance it can change.
  for (const hook of [
    "updateCombat",
    "createCombat",
    "deleteCombat",
    "combatStart",
    "createCombatant",
    "deleteCombatant",
    "updateCombatant",
  ]) {
    Hooks.on(hook, () => refreshButton());
  }

  Hooks.once("ready", () => {
    if (ui.hotbar?.element) injectButton(ui.hotbar.element);
  });
}
