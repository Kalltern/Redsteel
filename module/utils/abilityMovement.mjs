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
 * - Extended Lunge (Daleký výpad): once the attack is made, hit or miss, the
 *   attacker may take one hex in any direction under the ordinary threat
 *   rules. Granted when the card posts, not at Apply Damage, since the hit
 *   does not matter. Ignoring it costs nothing: ✓ or simply Moving on hands
 *   the turn's movement back, and it expires with the round.
 * - Charge (Zteč): movement first, then the attack. Picking Charge on the
 *   actor's own turn, before it has moved, declares a Speed move and rolls
 *   nothing. The attack comes once the approach is done: the strip's ✓ on
 *   the Charge move (redsteelHotbar.mjs), or picking Charge again. The
 *   attack pays the ability's cost and its two Actions, so the move charges
 *   nothing. A character that already moved just attacks.
 *
 * Both are guidance like the rest of the tracker: nothing here refuses a move.
 */

import {
  getMovementLock,
  getSpent,
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
// The Improved variants (spec-node upgrades, abilityGrants.mjs) carry the same
// movement; they are recognised alongside their base.
export const IMPROVED_DUELISTS_ADVANCE_KEY =
  "REDSTEEL.Items.ImprovedDuelistsAdvance.name";
export const IMPROVED_PASSING_STRIKE_KEY =
  "REDSTEEL.Items.ImprovedPassingStrike.name";
export const EXTENDED_LUNGE_KEY = "REDSTEEL.Items.ExtendedLunge.name";
export const CHARGE_KEY = "REDSTEEL.Items.Charge.name";

/**
 * Matched on the localisation key, with the pack's English name as the
 * fallback for a hand-made copy that has none.
 */
export function isDuelistsAdvance(ability) {
  return (
    ability?.system?.localizationKey === DUELISTS_ADVANCE_KEY ||
    ability?.system?.localizationKey === IMPROVED_DUELISTS_ADVANCE_KEY ||
    ability?.name === "Duelist's Advance" ||
    ability?.name === "Improved Duelist's Advance"
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

/** Did this attack card swing with Passing Strike (or its Improved form) selected? */
export function cardUsedPassingStrike(message) {
  const keys = message?.flags?.redsteel?.modifierKeys;
  if (!Array.isArray(keys)) return false;
  return (
    keys.includes(PASSING_STRIKE_KEY) ||
    keys.includes("Passing Strike") ||
    keys.includes(IMPROVED_PASSING_STRIKE_KEY) ||
    keys.includes("Improved Passing Strike")
  );
}

/**
 * Apply Damage landed an attack made with Passing Strike: grant the attacker
 * its free step. Runs on the GM client that applies the damage (the tracker
 * write needs an owner). Once per card: applying it again, to another target
 * or by mistake, grants nothing more (grantBonusStep's `source`).
 *
 * Only on the attacker's own turn. The base Passing Strike does not apply to
 * retaliation attacks, and those (Counterattack, Riposte, Retaliatory strike,
 * opportunity attacks) are all made on someone else's turn. Improved Passing
 * Strike does apply to them, but its off-turn step stays manual for now.
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

/** Is this the Extended Lunge ability (by key, or the pack's English name)? */
export function isExtendedLunge(ability) {
  return (
    ability?.system?.localizationKey === EXTENDED_LUNGE_KEY ||
    ability?.name === "Extended Lunge"
  );
}

/**
 * An Extended Lunge card was just posted: grant the attacker its one-hex
 * step. Runs on the attacker's own client, which owns the actor the tracker
 * writes to. Own turn in a tracked encounter only; anywhere else the step
 * stays manual. Once per card (grantBonusStep's `source`).
 *
 * @param {Actor|null} actor  The attacker.
 * @param {ChatMessage|null} message  The attack card.
 * @param {TokenDocument|null} tokenDoc  The attacker's token.
 */
export async function grantExtendedLungeStep(actor, message, tokenDoc) {
  if (!actor || !tokenDoc || !message) return;
  if (!isTrackedTurn(actor)) return;
  await grantBonusStep(actor, {
    mode: "lunge",
    budget: 1,
    startSpent: Number(tokenDoc.getFlag("redsteel", "movementSpent") ?? 0) || 0,
    source: message.id,
  });
}

/** Is this the Charge ability (by key, or the pack's English name)? */
export function isCharge(ability) {
  return (
    ability?.system?.localizationKey === CHARGE_KEY || ability?.name === "Charge"
  );
}

/**
 * Charge was picked: declare its approach instead of attacking, when this is
 * the first movement of the actor's own turn. Nothing is paid here; the
 * attack that follows pays for the whole Charge.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>} True when the move was declared and the attack
 *   must wait; false when the attack should go ahead now (out of a tracked
 *   turn, no token, or the turn's movement is already taken, which includes
 *   a Charge move declared earlier).
 */
export async function declareChargeMove(actor) {
  if (!actor || !isTrackedTurn(actor)) return false;
  if (getMovementLock(actor) || getSpent(actor).moved) return false;
  const token = tokenForActor(actor);
  if (!token) return false;
  await lockMovement(actor, {
    mode: "charge",
    budget: movementBudget(actor, "charge"),
    startSpent: tokenMovementSpent(token),
    charge: 0,
  });
  return true;
}
