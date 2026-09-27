/**
 * Movement that an ability grants, declared into the action tracker's
 * movement lock so the hotbar's suggestion strip and the locked zone show it
 * exactly like a Move (movementZones.mjs draws it, token.mjs caps the drag).
 *
 * - Duelist's Advance (Duelistův krok): using the ability declares a Speed/2
 *   move under the ordinary threat rules, the way Slow Movement walks. The
 *   ability pays its own Action (deductAbilityCost), so the lock charges
 *   nothing, and it takes the turn's movement slot: the book says it cannot
 *   be combined with Move, Sprint or Slow Movement.
 * - Passing Strike (Útok s pohybem): an attack modifier. Applying the card's
 *   damage grants one hex in any direction that provokes no Opportunity
 *   Attack, as a bonus step on top of the turn's movement
 *   (actionTracker.grantBonusStep).
 *
 * Both are guidance like the rest of the tracker: nothing here refuses a move.
 */

import {
  grantBonusStep,
  isTrackedTurn,
  lockMovement,
} from "./actionTracker.mjs";
import {
  movementBudget,
  tokenForActor,
  tokenMovementSpent,
} from "./movementZones.mjs";

export const DUELISTS_ADVANCE_KEY = "REDSTEEL.Items.DuelistsAdvance.name";
export const PASSING_STRIKE_KEY = "REDSTEEL.Items.PassingStrike.name";

/**
 * Matched on the localisation key, with the pack's English name as the
 * fallback for a hand-made copy that has none.
 */
export function isDuelistsAdvance(ability) {
  return (
    ability?.system?.localizationKey === DUELISTS_ADVANCE_KEY ||
    ability?.name === "Duelist's Advance"
  );
}

/**
 * The identifiers an attack card stores for its selected modifiers
 * (`flags.redsteel.modifierKeys`): the localisation key, or the item name
 * when there is none.
 *
 * @param {Item[]} modifiers
 * @returns {string[]}
 */
export function modifierKeysOf(modifiers = []) {
  return modifiers
    .map((m) => m?.system?.localizationKey || m?.name)
    .filter(Boolean);
}

/**
 * Declare Duelist's Advance's movement once the ability has been paid for.
 * Only on the actor's own turn in a tracked encounter; anywhere else the move
 * stays manual.
 *
 * @param {Actor} actor
 */
export async function declareDuelistsAdvance(actor) {
  if (!actor || !isTrackedTurn(actor)) return;
  const token = tokenForActor(actor);
  if (!token) return;
  await lockMovement(actor, {
    mode: "duelist",
    budget: movementBudget(actor, "duelist"),
    startSpent: tokenMovementSpent(token),
    charge: 0,
  });
}

/** Did this attack card swing with Passing Strike selected? */
export function cardUsedPassingStrike(message) {
  const keys = message?.flags?.redsteel?.modifierKeys;
  if (!Array.isArray(keys)) return false;
  return keys.includes(PASSING_STRIKE_KEY) || keys.includes("Passing Strike");
}

/**
 * Apply Damage landed an attack made with Passing Strike: grant the attacker
 * its free step. Runs on the GM client that applies the damage (the tracker
 * write needs an owner). Once per card: applying it again, to another target
 * or by mistake, grants nothing more (grantBonusStep's `source`).
 *
 * Only on the attacker's own turn. The base Passing Strike does not apply to
 * retaliation attacks, and those (Counterattack, Riposte, Retaliatory strike,
 * opportunity attacks) are all made on someone else's turn.
 *
 * @param {Actor|null} actor  The attacker.
 * @param {ChatMessage} message  The attack card.
 * @param {TokenDocument|null} tokenDoc  The attacker's token.
 */
export async function grantPassingStrikeStep(actor, message, tokenDoc) {
  if (!actor || !tokenDoc || !cardUsedPassingStrike(message)) return;
  if (!isTrackedTurn(actor)) return;
  const startSpent =
    Number(tokenDoc.getFlag("redsteel", "movementSpent") ?? 0) || 0;
  await grantBonusStep(actor, {
    mode: "passing",
    budget: 1,
    startSpent,
    source: message.id,
  });
}
