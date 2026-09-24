/**
 * The hotbar's suggestion strip: turn actions that make sense right now,
 * floated above the Redsteel panel.
 *
 * A suggestion is a filter, never a refusal. A chip that is not shown is one
 * the tracker thinks cannot be paid for; nothing here stops the player doing it
 * another way.
 *
 * Each provider takes the bound actor and returns zero or more chips. Only
 * movement exists so far; a new provider is one more function in PROVIDERS.
 */

import {
  getActionPools,
  getMovementLock,
  getSpent,
  isTrackedTurn,
} from "./actionTracker.mjs";
import {
  MOVEMENT_MODES,
  engagingEnemyIds,
  lockRemaining,
  movementBudget,
  tokenForActor,
} from "./movementZones.mjs";

const MODE_ORDER = ["move", "slow", "sprint", "disengage"];

function costLabel(actions) {
  return game.i18n.localize(
    actions >= 2
      ? "REDSTEEL.Bg3Hotbar.Suggest.TwoActions"
      : "REDSTEEL.Bg3Hotbar.Suggest.OneAction",
  );
}

/**
 * Movement: Move / Slow Movement / Sprint before the actor has moved, or the
 * one declared mode with what is left of it afterwards.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function movementProvider(actor) {
  const lock = getMovementLock(actor);
  if (lock) {
    const def = MOVEMENT_MODES[lock.mode];
    // Confirmed with the check button: nothing left to suggest.
    if (!def || lock.done) return [];
    const budget = Number(lock.budget) || 0;
    const remaining = lockRemaining(tokenForActor(actor), lock);
    const label = game.i18n.localize(def.labelKey);
    const hexLabel = game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.Remaining", {
      remaining,
      budget,
    });
    return [
      {
        id: `movement-${lock.mode}`,
        mode: lock.mode,
        icon: def.icon,
        label,
        costLabel: "",
        hexLabel,
        locked: true,
        remaining,
        budget,
        ariaLabel: `${game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.Locked")}: ${label}, ${hexLabel}`,
      },
    ];
  }

  const spent = getSpent(actor);
  if (spent.moved) return [];
  const left = getActionPools(actor).actions - spent.actions;

  const chips = [];
  // Disengage is offered only while an enemy stands next to the token.
  const engaged = engagingEnemyIds(tokenForActor(actor)).length > 0;

  for (const mode of MODE_ORDER) {
    const def = MOVEMENT_MODES[mode];
    if (def.actions > left) continue;
    if (mode === "disengage" && !engaged) continue;
    const budget = movementBudget(actor, mode);
    const label = game.i18n.localize(def.labelKey);
    const cost = costLabel(def.actions);
    const hexLabel = game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.Hexes", {
      n: budget,
    });
    chips.push({
      id: `movement-${mode}`,
      mode,
      icon: def.icon,
      label,
      costLabel: cost,
      hexLabel,
      locked: false,
      remaining: budget,
      budget,
      ariaLabel: `${label}, ${cost}, ${hexLabel}`,
    });
  }
  return chips;
}

const PROVIDERS = [movementProvider];

/**
 * Every chip for the strip, or an empty array when the strip should not show:
 * no actor, not the viewer's to drive, or not this actor's turn.
 *
 * @param {Actor|null} actor
 * @returns {object[]}
 */
export function prepareSuggestions(actor) {
  if (!actor?.isOwner || !isTrackedTurn(actor)) return [];
  return PROVIDERS.flatMap((provider) => provider(actor) ?? []);
}
