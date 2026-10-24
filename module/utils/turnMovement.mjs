/**
 * Movement in combat goes through a declared movement (user ruling
 * 2026-10-24).
 *
 * 1. Turn start: the actor whose turn it now is gets a plain Move already
 *    declared, as though the player had clicked it, unless they start next
 *    to an enemy, where walking away is a real choice (Move, Slow Movement,
 *    Disengage) and nothing is picked for them. The Move is armed, not paid:
 *    its Action goes on the first step, and until then the strip still
 *    offers the other modes (actionTracker.mjs armTurnMovement).
 * 2. A player cannot drag or key-move a token in combat without a declared
 *    movement: on their own turn they need a lock (the armed Move counts),
 *    off their turn an off-turn step an ability granted (Quick Feet and the
 *    like). GMs are never stopped, and neither is anything moved through
 *    the API (pushes, pulls, teleports, the ally-passage and Bull Charge
 *    re-issues), since V14 tags each movement with its method.
 */

import {
  armTurnMovement,
  getMovementLock,
  hasOffTurnStep,
  isTrackedTurn,
  trackedCombat,
} from "./actionTracker.mjs";
import { isForcedMove } from "./forcedMoveRegistry.mjs";
import {
  engagingEnemyIds,
  movementBudget,
  tokenMovementSpent,
} from "./movementZones.mjs";

/** TokenMovementMethod values a player produces by hand (V14 docs). */
const HAND_METHODS = new Set(["dragging", "keyboard"]);

/**
 * Arm the default Move for the combatant whose turn just began.
 *
 * Adjacency is read off the canvas, so a combatant whose token is not on the
 * scene the GM is viewing is left alone: the player picks by hand.
 *
 * @param {Combat} combat
 * @param {{newRound: boolean}} options  a round change resets every token's
 *   `movementSpent` to 0 (token.mjs), possibly after this runs
 */
async function armCurrentCombatant(combat, { newRound }) {
  const combatant = combat.combatant;
  const actor = combatant?.actor;
  if (!actor || combatant.isDefeated) return;
  const token = combatant.token?.object ?? null;
  if (!token) return;

  const engaged = engagingEnemyIds(token).length > 0;
  const lock = engaged
    ? null
    : {
        mode: "move",
        budget: movementBudget(actor, "move"),
        startSpent: newRound ? 0 : tokenMovementSpent(token),
      };
  await armTurnMovement(actor, lock);
}

export function registerTurnMovementHooks() {
  Hooks.on("updateCombat", (combat, changed) => {
    if (!changed || !("turn" in changed || "round" in changed)) return;
    // Fires on every client; one authoritative GM writes the record.
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    if (!combat?.started) return;
    armCurrentCombatant(combat, { newRound: "round" in changed }).catch((err) =>
      console.error("REDSTEEL: Failed to arm the turn-start Move", err),
    );
  });

  // Registered before bullCharge.mjs and allyPassage.mjs (redsteel.mjs), so a
  // refused drag never opens a passage request or contests anyone.
  Hooks.on("preMoveToken", (tokenDoc, movement) => {
    if (game.user.isGM) return;
    if (!HAND_METHODS.has(movement?.method)) return;
    const actor = tokenDoc?.actor;
    if (!actor || !trackedCombat(actor)) return;
    if (isForcedMove(tokenDoc)) return;

    const ownTurn = isTrackedTurn(actor);
    if (ownTurn ? !!getMovementLock(actor) : hasOffTurnStep(actor)) return;

    ui.notifications.warn(
      game.i18n.localize(
        ownTurn
          ? "REDSTEEL.TurnMovement.PickFirst"
          : "REDSTEEL.TurnMovement.NotYourTurn",
      ),
    );
    return false;
  });
}
