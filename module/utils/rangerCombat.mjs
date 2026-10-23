/**
 * Hraničář (Ranger): the attack-dialog pieces of the tree.
 *
 * - Doražení (dorazeni, Finishing Blow), specializace-wip.md r318:
 *   "Modifikuje libovolný útok (Souboj či Střelba) vedený na cíl, na který má
 *   Metlu. Šance na Kritický zásah +10%, Kritický rozsah +3 a Ověření +10%."
 *   The numbers live on the modifier item itself (critChance, critRange and
 *   a "precision" extra effect), read by the ordinary modifier pipeline in
 *   basicAttack.mjs / combatAbilities.mjs and combatSkillBonuses.mjs
 *   getEffectRolls. This file only refuses the modifier, before anything is
 *   paid, unless exactly one token is targeted and it is a Bane of the
 *   attacker (grimm.mjs isBaneFoe, which also counts an Expose Weakness mark).
 * - Dravčí smysly (dravciSmysly, Predatory Senses), r322: "Získává Výhodu na
 *   Útok (Souboj i Střelba) v prvním kole boje při přepadení nebo při boji v
 *   přírodě." The node sets `system.predatorySenses` (its passive Active
 *   Effect). Whether the fight is an ambush or in the wild is the player's
 *   call, so both attack dialogs show an "Ambush / In nature" toggle while no
 *   encounter is running or it is still round 1. Ticked, it sets the
 *   `usePredatorySenses` actor flag, which getAttackRolls consumes like the
 *   Flanking flag and turns into Advantage on that one attack roll.
 */

import { isBaneFoe } from "./grimm.mjs";

const SYSTEM_ID = "redsteel";
export const FINISHING_BLOW_KEY = "REDSTEEL.Items.FinishingBlow.name";
/** Actor flag the attack dialogs set and getAttackRolls consumes. */
export const PREDATORY_SENSES_FLAG = "usePredatorySenses";

/** Is this the Finishing Blow modifier (by key, or the pack's English name)? */
export function isFinishingBlow(ability) {
  return (
    ability?.system?.localizationKey === FINISHING_BLOW_KEY ||
    ability?.name === "Finishing Blow"
  );
}

/**
 * Why Finishing Blow may not ride this attack, or null when it may (or is
 * not ticked at all).
 *
 * @param {Actor} actor
 * @param {Item[]} modifiers  the ticked attack modifiers
 * @param {Token[]} targets   the user's targeted tokens
 * @returns {string|null}     a localized refusal
 */
export function finishingBlowRefusal(actor, modifiers = [], targets = []) {
  if (!modifiers.some(isFinishingBlow)) return null;
  const others = targets.filter((t) => t?.actor && t.actor !== actor);
  if (others.length === 1 && isBaneFoe(actor, others[0].actor)) return null;
  return game.i18n.localize("REDSTEEL.FinishingBlow.NotBane");
}

/**
 * May the Predatory Senses toggle be offered right now: the actor has the
 * node, and either no encounter is running or it is still in round 1.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function predatorySensesAvailable(actor) {
  if (!actor?.system?.predatorySenses) return false;
  const combat = game.combat;
  return !combat?.started || Number(combat.round) <= 1;
}

/**
 * Consume the dialog's Predatory Senses flag. True only when it was set and
 * still applies (the gate is checked again, so a flag left behind by a
 * dialog that never rolled cannot grant Advantage in a later round).
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export async function consumePredatorySenses(actor) {
  if (!actor?.getFlag?.(SYSTEM_ID, PREDATORY_SENSES_FLAG)) return false;
  await actor.unsetFlag(SYSTEM_ID, PREDATORY_SENSES_FLAG);
  return predatorySensesAvailable(actor);
}

/**
 * Set or clear the flag from a dialog's toggle.
 *
 * @param {Actor} actor
 * @param {boolean} on
 */
export async function setPredatorySenses(actor, on) {
  if (on && predatorySensesAvailable(actor)) {
    await actor.setFlag(SYSTEM_ID, PREDATORY_SENSES_FLAG, true);
  } else if (actor?.getFlag?.(SYSTEM_ID, PREDATORY_SENSES_FLAG)) {
    await actor.unsetFlag(SYSTEM_ID, PREDATORY_SENSES_FLAG);
  }
}
