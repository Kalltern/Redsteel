/**
 * Dragon Guard (Dračí stráž, Servant of the Sword): a one-round stance.
 *
 * "For one round, Hit +10% for Retaliation actions, Riposte and any Momentum
 * that follows them. You may use Exploit Weakness as a Retaliation action."
 *
 * The stance is the `dragon_guard` status (config.mjs), taken up through the
 * ordinary `class: "stance"` path in combatAbilities.mjs and gone at the start
 * of the holder's next turn (defaultTurns 1). No upkeep, so stances.mjs never
 * asks to hold it.
 *
 * Every weapon attack passes getAttackRolls (combatSkillBonuses.mjs), which
 * asks dragonGuardAttack what this swing is:
 * - a Retaliation action (Counterattack, Retaliatory strike, its improved
 *   form) or a Riposte, by the ability's localisation key;
 * - Exploit Weakness swung outside the holder's own turn, which under the
 *   stance IS a Retaliation action: it costs the Reaction (actionTracker.mjs
 *   costOf), is offered on the hotbar after a defense (actionSuggestions.mjs)
 *   and its card is tagged "retaliation", so it cannot itself be answered;
 * - Momentum: any further attack in the same turn, off the holder's turn and
 *   not an Opportunity Attack, after one of the above. Momentum has no ability
 *   of its own to recognise (it is "attack again"), so the boosted swing
 *   stamps the turn on the stance effect (`flags.redsteel.dragonGuardChain`)
 *   and the next swing in that turn reads it.
 */

import { combatantForActor } from "./combatants.mjs";

export const DRAGON_GUARD_STATUS = "dragon_guard";
export const DRAGON_GUARD_HIT_BONUS = 10;
export const EXPLOIT_WEAKNESS_KEY = "REDSTEEL.Items.ExploitWeakness.name";

const SYSTEM_ID = "redsteel";
const CHAIN_FLAG = "dragonGuardChain";

const RETALIATION_KEYS = new Set([
  "REDSTEEL.Items.Counterattack.name",
  "REDSTEEL.Items.RetaliatoryStrike.name",
  "REDSTEEL.Items.ImprovedRetaliatoryStrike.name",
]);
const RIPOSTE_KEY = "REDSTEEL.Items.Riposte.name";

/** Is this actor holding Dragon Guard? */
export function hasDragonGuard(actor) {
  return !!actor?.statuses?.has(DRAGON_GUARD_STATUS);
}

/**
 * Is a started encounter running somebody else's turn while this actor fights
 * in it? False outside combat: with no turn order there is no "off turn".
 */
function isOffTurn(actor) {
  const combat = game.combat;
  if (!combat?.started) return false;
  const combatant = combatantForActor(actor, combat);
  return !!combatant && combat.combatant?.id !== combatant.id;
}

/**
 * Is this ability Exploit Weakness used as a Retaliation action: the melee
 * form, swung off-turn by a Dragon Guard holder?
 *
 * @param {Actor} actor
 * @param {Item|null} ability
 */
export function isExploitAsRetaliation(actor, ability) {
  return (
    ability?.system?.localizationKey === EXPLOIT_WEAKNESS_KEY &&
    hasDragonGuard(actor) &&
    isOffTurn(actor)
  );
}

/** The current turn as a stamp, or null outside a started encounter. */
function turnStamp() {
  const combat = game.combat;
  if (!combat?.started) return null;
  return { combat: combat.id, round: combat.round, turn: combat.turn };
}

function sameTurn(a, b) {
  return (
    !!a &&
    !!b &&
    a.combat === b.combat &&
    Number(a.round) === Number(b.round) &&
    Number(a.turn) === Number(b.turn)
  );
}

/**
 * Which Dragon Guard swing this attack is, if any, and remember a boosted
 * retaliation so the Momentum after it is recognised too. Called once per
 * attack roll, from getAttackRolls.
 *
 * @param {Actor} actor
 * @param {Item|null} ability  null for a plain weapon attack
 * @param {{opportunity?: boolean}} [options]
 * @returns {Promise<"retaliation"|"riposte"|"momentum"|null>}
 */
export async function dragonGuardAttack(actor, ability, { opportunity = false } = {}) {
  if (!hasDragonGuard(actor) || opportunity) return null;
  const effect = actor.effects.find((e) => e.statuses?.has(DRAGON_GUARD_STATUS));
  if (!effect) return null;

  const key = ability?.system?.localizationKey ?? null;
  let kind = null;
  if (RETALIATION_KEYS.has(key) || isExploitAsRetaliation(actor, ability)) {
    kind = "retaliation";
  } else if (key === RIPOSTE_KEY) {
    kind = "riposte";
  }

  const stamp = isOffTurn(actor) ? turnStamp() : null;
  if (kind) {
    if (stamp) await effect.setFlag(SYSTEM_ID, CHAIN_FLAG, stamp);
    return kind;
  }
  if (stamp && sameTurn(effect.getFlag(SYSTEM_ID, CHAIN_FLAG), stamp)) {
    return "momentum";
  }
  return null;
}

/**
 * The runtime tags a Dragon Guard swing adds to its attack card: always
 * "dragonGuard" (the +10% chip), plus "retaliation" for Exploit Weakness used
 * as one, which the hotbar reads as the reaction having been answered and as
 * an attack no reaction may answer.
 *
 * @param {string|null} kind  dragonGuardAttack's answer
 * @param {Actor} actor
 * @param {Item|null} ability
 * @returns {string[]}
 */
export function dragonGuardTags(kind, actor, ability) {
  if (!kind) return [];
  const tags = ["dragonGuard"];
  if (ability?.system?.localizationKey === EXPLOIT_WEAKNESS_KEY && kind === "retaliation") {
    tags.push("retaliation");
  }
  return tags;
}
