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

function refreshButton(root = ui.hotbar?.element) {
  const container = root?.querySelector(".redsteel-end-turn-controls");
  if (!container) return;
  container.classList.toggle("hidden", !canEndCurrentTurn(game.combat));
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

function injectButton(element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root || root.querySelector(".redsteel-end-turn-controls")) return;

  const container = document.createElement("div");
  container.className = "redsteel-end-turn-controls hidden";

  const endButton = document.createElement("button");
  endButton.type = "button";
  endButton.className = "redsteel-end-turn";
  endButton.setAttribute("aria-label", "End Turn");
  endButton.innerHTML = "<span>End Turn</span>";
  endButton.addEventListener("click", (event) => {
    event.preventDefault();
    onEndTurn();
  });

  const delayButton = document.createElement("button");
  delayButton.type = "button";
  delayButton.className = "redsteel-delay-turn";
  delayButton.setAttribute("aria-label", "Delay Turn");
  delayButton.innerHTML = "<span>Delay Turn</span>";
  delayButton.addEventListener("click", (event) => {
    event.preventDefault();
    game.redsteel.delayTurn();
  });

  container.append(endButton, delayButton);
  root.appendChild(container);
  refreshButton(root);
}

export function registerEndTurnButton() {
  Hooks.on("renderHotbar", (_app, element) => injectButton(element));

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
