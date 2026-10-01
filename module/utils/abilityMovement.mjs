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
 * - Quick Feet (Rychlé nohy, Shadow): a modifier on a retaliation, which is
 *   made on somebody else's turn. Like Charge, the step comes first and the
 *   swing waits: picking the retaliation with Quick Feet ticked (or
 *   Shift-clicking its hotbar chip) declares a one-hex step that must stay
 *   next to the targeted opponent, and rolls nothing. The strip's check
 *   button then fires the retaliation with Quick Feet attached, which pays
 *   both. Declared once per turn per retaliation: the second pick swings.
 * - Lunge Step (Přískok, Servant of the Sword): answered to a melee attack
 *   made from beyond the next hex (Long Reach, or Extended Lunge). The hotbar
 *   offers it off-turn (actionSuggestions.mjs) until the defender has
 *   defended; using it pays its Stamina and grants one hex that must close in
 *   on the attacker and provokes nothing. Once per attacker per turn.
 * - Improved Passing Strike off-turn: the Passing Strike step, after a
 *   retaliation landed on somebody else's turn (grantPassingStrikeStep).
 *
 * All of it is guidance like the rest of the tracker: nothing here refuses a move.
 */

import {
  confirmMovement,
  getMovementLock,
  getSpent,
  grantBonusStep,
  isTrackedTurn,
  lockMovement,
  trackedCombat,
} from "./actionTracker.mjs";
import { isReactionAbility } from "./opportunityAttacks.mjs";
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
export const QUICK_FEET_KEY = "REDSTEEL.Items.QuickFeet.name";
export const LUNGE_STEP_KEY = "REDSTEEL.Items.LungeStep.name";
// Servant of the Sword's Charge: +1d4 damage (abilityGrants.mjs), the same
// approach-then-swing action.
export const IMPROVED_CHARGE_KEY = "REDSTEEL.Items.ImprovedCharge.name";

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

/** Did this attack card swing with Improved Passing Strike selected? */
function cardUsedImprovedPassingStrike(message) {
  const keys = message?.flags?.redsteel?.modifierKeys;
  if (!Array.isArray(keys)) return false;
  return (
    keys.includes(IMPROVED_PASSING_STRIKE_KEY) ||
    keys.includes("Improved Passing Strike")
  );
}

/** Did this attack card swing with Passing Strike (or its Improved form) selected? */
export function cardUsedPassingStrike(message) {
  const keys = message?.flags?.redsteel?.modifierKeys;
  if (!Array.isArray(keys)) return false;
  return (
    keys.includes(PASSING_STRIKE_KEY) ||
    keys.includes("Passing Strike") ||
    cardUsedImprovedPassingStrike(message)
  );
}

/**
 * Apply Damage landed an attack made with Passing Strike: grant the attacker
 * its free step. Runs on the GM client that applies the damage (the tracker
 * write needs an owner). Once per card: applying it again, to another target
 * or by mistake, grants nothing more (grantBonusStep's `source`).
 *
 * On the attacker's own turn either form grants the step. Off its turn only
 * Improved Passing Strike does: the base form does not apply to retaliation
 * actions, and those (Counterattack, Riposte, Retaliatory strike, opportunity
 * attacks) are all made on someone else's turn. The off-turn step is its own
 * mode, `passingReaction`, which the tracker lets be walked outside the turn
 * (actionTracker.mjs OFF_TURN_MODES) the way a Quick Feet step is.
 *
 * @param {Actor|null} actor  The attacker.
 * @param {ChatMessage} message  The attack card.
 * @param {TokenDocument|null} tokenDoc  The attacker's token.
 */
export async function grantPassingStrikeStep(actor, message, tokenDoc) {
  if (!actor || !tokenDoc || !cardUsedPassingStrike(message)) return;
  const ownTurn = isTrackedTurn(actor);
  if (!ownTurn && !cardUsedImprovedPassingStrike(message)) return;
  const startSpent =
    Number(tokenDoc.getFlag("redsteel", "movementSpent") ?? 0) || 0;
  await grantBonusStep(actor, {
    mode: ownTurn ? "passing" : "passingReaction",
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

/**
 * Every charge: a move, then the swing (user ruling 2026-10-01: all six share
 * the approach and the 2-hex start, swordServant.mjs chargeDistanceAllowed).
 * Keyed by localisation key, with the pack's English names as the fallback.
 */
const CHARGE_KEYS = new Set([
  CHARGE_KEY,
  IMPROVED_CHARGE_KEY,
  "REDSTEEL.Items.PikemanCharge.name",
  "REDSTEEL.Items.ChargeWithCleave.name",
  "REDSTEEL.Items.ShieldCharge.name",
  "REDSTEEL.Items.ShieldChargeSmallShield.name",
]);
const CHARGE_NAMES = new Set([
  "Charge",
  "Improved Charge",
  "Pikeman charge",
  "Charge with Cleave",
  "Shield Charge",
  "Shield Charge (small shield)",
]);

/** Is this one of the charge abilities (Charge, its upgrades and variants)? */
export function isCharge(ability) {
  return (
    CHARGE_KEYS.has(ability?.system?.localizationKey) ||
    CHARGE_NAMES.has(ability?.name)
  );
}

/**
 * Would picking a charge now declare its approach (declareChargeMove), rather
 * than swing straight away? The moment the charge's starting distance counts.
 *
 * @param {Actor} actor
 */
export function chargeWouldDeclare(actor) {
  if (!actor || !isTrackedTurn(actor)) return false;
  if (getMovementLock(actor) || getSpent(actor).moved) return false;
  return !!tokenForActor(actor);
}

/**
 * Charge was picked: declare its approach instead of attacking, when this is
 * the first movement of the actor's own turn. Nothing is paid here; the
 * attack that follows pays for the whole Charge.
 *
 * @param {Actor} actor
 * @param {Item|null} [ability]  the charge picked; its swing is what the
 *   strip's check button launches at the end of the move
 * @returns {Promise<boolean>} True when the move was declared and the attack
 *   must wait; false when the attack should go ahead now (out of a tracked
 *   turn, no token, or the turn's movement is already taken, which includes
 *   a Charge move declared earlier).
 */
export async function declareChargeMove(actor, ability = null) {
  if (!chargeWouldDeclare(actor)) return false;
  const token = tokenForActor(actor);
  await lockMovement(actor, {
    mode: "charge",
    budget: movementBudget(actor, "charge"),
    startSpent: tokenMovementSpent(token),
    charge: 0,
    launch: ability?.id ? { abilityId: ability.id } : null,
  });
  return true;
}

/** Is this the Quick Feet modifier (by key, or the pack's English name)? */
export function isQuickFeet(ability) {
  return (
    ability?.system?.localizationKey === QUICK_FEET_KEY ||
    ability?.name === "Quick Feet"
  );
}

/**
 * A retaliation was picked with Quick Feet among its modifiers: declare the
 * step around the opponent instead of swinging, when this is the first time
 * this turn. Nothing is paid here; the swing that follows pays the
 * retaliation and Quick Feet together.
 *
 * Off-turn only (a retaliation answers somebody else's turn), in a tracked
 * encounter, with a token on the canvas. The opponent is the targeted token;
 * with nothing targeted the step is still granted, just not held to anyone.
 *
 * Once per turn per retaliation (grantBonusStep's `source`): the check
 * button's relaunch, or picking the same retaliation again, finds the step
 * already declared and swings. Any retaliation that swings off-turn closes a
 * Quick Feet step still open (walked or not), so the strip's check button
 * cannot fire a second swing afterwards.
 *
 * @param {Actor} actor
 * @param {Item} ability  the retaliation being used
 * @param {Item[]} modifiers  the modifiers ticked with it
 * @returns {Promise<boolean>} True when the step was declared and the attack
 *   must wait; false when the attack should go ahead now.
 */
export async function declareQuickFeetStep(actor, ability, modifiers = []) {
  if (!actor || !ability || !isReactionAbility(ability)) return false;
  const combat = trackedCombat(actor);
  if (!combat || isTrackedTurn(actor)) return false;
  const token = tokenForActor(actor);
  if (!token) return false;

  const source = `quickFeet.${combat.id}.${combat.round}.${combat.turn}.${ability.id}`;
  if (
    !modifiers.some(isQuickFeet) ||
    getSpent(actor).bonusSources.includes(source)
  ) {
    const lock = getMovementLock(actor);
    if (lock?.mode === "quickFeet" && !lock.done) {
      await confirmMovement(actor, { tokenSpent: tokenMovementSpent(token) });
    }
    return false;
  }

  const opponent = game.user?.targets?.first?.() ?? null;
  return grantBonusStep(actor, {
    mode: "quickFeet",
    budget: 1,
    startSpent: tokenMovementSpent(token),
    source,
    around: opponent?.id ?? null,
    launch: {
      abilityId: ability.id,
      targetId: opponent?.id ?? null,
      modifierIds: modifiers.map((m) => m.id),
      turn: combat.turn,
    },
  });
}

/** Is this the Lunge Step ability (by key, or the pack's English name)? */
export function isLungeStep(ability) {
  return (
    ability?.system?.localizationKey === LUNGE_STEP_KEY ||
    ability?.name === "Lunge Step"
  );
}

/**
 * The tracker source a Lunge Step against this attacker is remembered by:
 * once per attacker per turn. The hotbar reads it to stop offering the step.
 *
 * @param {Combat} combat
 * @param {string|null} attackerId  The attacker's token id.
 */
export function lungeStepSource(combat, attackerId) {
  return `lungeStep.${combat.id}.${combat.round}.${combat.turn}.${attackerId ?? ""}`;
}

/**
 * Lunge Step was used (and paid): grant the one-hex step toward the attacker,
 * who is the targeted token (the hotbar chip targets it). Off-turn only, in a
 * tracked encounter, with a token on the canvas; anywhere else the step stays
 * manual. With nothing targeted the step is still granted, just not held to
 * anyone.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>} Whether a step was granted.
 */
export async function declareLungeStep(actor) {
  const combat = trackedCombat(actor);
  if (!combat || isTrackedTurn(actor)) return false;
  const token = tokenForActor(actor);
  if (!token) return false;
  const attacker = game.user?.targets?.first?.() ?? null;
  return grantBonusStep(actor, {
    mode: "lungeStep",
    budget: 1,
    startSpent: tokenMovementSpent(token),
    source: lungeStepSource(combat, attacker?.id ?? null),
    toward: attacker?.id ?? null,
  });
}
