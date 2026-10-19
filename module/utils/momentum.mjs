/**
 * Momentum, one path for both items that carry it.
 *
 * - Momentum (the doctrine action). Rulebook ruzne-info.md r182: "Momentum ·
 *   Volná akce · 3 výdrže · Při zabití oponenta útokem zbraní může jednou za
 *   kolo ihned znovu zaútočit. Při Kritickém zásahu může jednou za kolo ihned
 *   znovu zaútočit." Granted by Pikenýr X, Šermíř VIII, Plenitel VIII and
 *   Jezdec X (abilityGrants.mjs; dovednosti.md, user ruling 2026-10-19
 *   "momentum should exist in doctrines"). Qualifies on any WEAPON attack:
 *   the card names a weapon item the attacker owns (`weaponId`). Spells,
 *   non-weapon abilities (Shield Bash, Shove) and explosives carry none.
 * - Momentum (Hoplite), specializace-wip.md r267: the same rule limited to a
 *   short sword, hatchet, mace, spear or trident, plus a Daring Throw kill.
 *   The qualifier lives in hoplite.mjs (isMomentumWeapon, cardIsDaringThrow).
 *
 * One Momentum per round per actor across both items: the round's use is one
 * action-tracker source, whichever item paid it. Apply Damage stamps the
 * chance on the attacker (offerMomentum, on the GM applying it) with the item
 * that qualified, the doctrine Momentum first. The hotbar chip
 * (actionSuggestions.mjs) and the Combat Abilities dialog (combatAbilities.mjs)
 * use it: pay the item, note the round's use, and the next plain Attack this
 * turn costs no Action (actionTracker.mjs grantFreeAttack). Own turn only,
 * once per card.
 *
 * Předvoj (Vanguard, vanguard.mjs):
 * - Momentum: Výdrž -1 (momentumVydrz): the doctrine Momentum costs 2 Stamina
 *   (momentumStaminaCost, read in combatAbilities.mjs deductAbilityCost).
 *   Momentum (Hoplite) keeps its 3: the node needs Pikenýr, Plenitel or Šermíř
 *   X, so every holder owns the doctrine item.
 * - Momentum: Speciální akce (momentumSpecialni): the extra attack may be a
 *   weapon attack ability too. useMomentum adds a free-ability grant over the
 *   actor's attack abilities, paired with the free Attack so only one of the
 *   two is ever spent (actionTracker.mjs grantFreeAbility `pairedAttack`).
 *   Applies to both Momentum items.
 *
 * A "kill" is the user ruling of 2026-10-12/14: the victim ended the Apply
 * Damage dead, or newly Downed, Dying or Unconscious (applyDamage.mjs
 * felledIds). A critical is the mode the GM applied ("critical").
 *
 * Storage keeps the names it had when only the Hoplite had Momentum, so a
 * stamp or a card from before this file reads the same: the actor flag
 * `flags.redsteel.hopliteMomentum`, the card flag `hopliteMomentumOffered`
 * and the round source `hopliteMomentum.<combat>.<round>`. The stamp gained
 * an `itemId`.
 */

import {
  getSpent,
  grantFreeAbility,
  grantFreeAttack,
  isTrackedTurn,
  markBonusSource,
  trackedCombat,
} from "./actionTracker.mjs";
import { tokenForActor } from "./movementZones.mjs";
import {
  cardIsDaringThrow,
  hasHopliteNode,
  isHopliteMomentum,
  isMomentumWeapon,
} from "./hoplite.mjs";
import {
  hasVanguardNode,
  MOMENTUM_STAMINA_DISCOUNT,
  vanguardMomentumAbilityKeys,
} from "./vanguard.mjs";

const SYSTEM_ID = "redsteel";

/** The doctrine Momentum, by localisation key. */
export const MOMENTUM_KEY = "REDSTEEL.Items.Momentum.name";

/** Actor flag holding the pending chance (turn-stamped). */
const MOMENTUM_FLAG = "hopliteMomentum";
/** Card flag: this card already offered a Momentum. */
const OFFERED_FLAG = "hopliteMomentumOffered";

/** A creature in one of these is not worth a free attack. */
const FALLEN_STATUSES = ["dead", "dying", "downed", "unconscious"];

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Is this the doctrine Momentum (by key, or the pack's English name)? */
export function isMomentum(ability) {
  if (typeof ability === "string") return ability === MOMENTUM_KEY;
  return (
    ability?.system?.localizationKey === MOMENTUM_KEY ||
    ability?.name === "Momentum"
  );
}

/** Either Momentum item. */
export function isAnyMomentum(ability) {
  return isMomentum(ability) || isHopliteMomentum(ability);
}

/** The once-per-round allowance, noted in the action tracker's round record. */
function momentumSource(combat) {
  return `hopliteMomentum.${combat.id}.${combat.round}`;
}

function turnStamp(combat) {
  return { id: combat.id, round: combat.round, turn: combat.turn };
}

function stampIsThisTurn(stamp, combat) {
  return (
    !!stamp &&
    !!combat?.started &&
    stamp.id === combat.id &&
    Number(stamp.round) === Number(combat.round) &&
    Number(stamp.turn) === Number(combat.turn)
  );
}

function isFallen(actor) {
  return FALLEN_STATUSES.some((s) => actor?.statuses?.has(s));
}

/**
 * Does this Momentum item fire for the card?
 *
 * @param {Actor} attacker
 * @param {Item} item           a Momentum item the attacker owns
 * @param {object} blow
 * @param {Item|null} blow.weapon  the card's weapon, when it is a weapon
 * @param {boolean} blow.kill
 * @param {boolean} blow.crit
 * @param {ChatMessage} blow.message
 * @returns {{kill: boolean, crit: boolean}|null}
 */
function qualifies(attacker, item, { weapon, kill, crit, message }) {
  if (isMomentum(item)) {
    if (!weapon) return null;
    if (!kill && !crit) return null;
    return { kill, crit };
  }
  if (isHopliteMomentum(item)) {
    if (!hasHopliteNode(attacker, "momentum")) return null;
    const byKill =
      kill && (cardIsDaringThrow(message) || isMomentumWeapon(weapon));
    const byCrit = crit && isMomentumWeapon(weapon);
    if (!byKill && !byCrit) return null;
    return { kill: byKill, crit: byCrit };
  }
  return null;
}

/**
 * The Momentum items an actor owns, the doctrine one first: when both
 * qualify the doctrine Momentum is offered (with momentumVydrz it is the
 * cheaper one, and it is never dearer).
 */
function momentumItems(actor) {
  const items = actor.items.filter(
    (i) => i.type === "ability" && isAnyMomentum(i),
  );
  return [
    ...items.filter((i) => isMomentum(i)),
    ...items.filter((i) => !isMomentum(i)),
  ];
}

/**
 * Apply Damage landed: stamp Momentum when the card felled someone, or was
 * applied as a Critical Hit, and one of the attacker's Momentum items
 * qualifies for that blow. Own turn only, once per round, once per card.
 * Runs on the GM applying the damage.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message
 * @param {string[]} targetIds
 * @param {string[]} felledIds
 * @param {string} mode   "normal" | "critical" | "breakthrough"
 */
export async function offerMomentum(
  attacker,
  message,
  targetIds = [],
  felledIds = [],
  mode = "normal",
) {
  if (!attacker || !message) return;
  const items = momentumItems(attacker);
  if (!items.length) return;
  const combat = trackedCombat(attacker);
  if (!combat || !isTrackedTurn(attacker)) return;
  if (message.getFlag(SYSTEM_ID, OFFERED_FLAG)) return;
  if (getSpent(attacker).bonusSources.includes(momentumSource(combat))) return;

  const selfId = message.speaker?.token ?? null;
  const owned = attacker.items.get(message.flags?.redsteel?.weaponId ?? "") ?? null;
  const weapon = owned?.type === "weapon" ? owned : null;
  const killed = felledIds.find((id) => id && id !== selfId) ?? null;
  const blow = { weapon, kill: !!killed, crit: mode === "critical", message };

  let item = null;
  let fired = null;
  for (const candidate of items) {
    fired = qualifies(attacker, candidate, blow);
    if (fired) {
      item = candidate;
      break;
    }
  }
  if (!item) return;

  const targetTokenId =
    killed ?? targetIds.find((id) => id && id !== selfId) ?? null;
  await message.setFlag(SYSTEM_ID, OFFERED_FLAG, true);
  await attacker.setFlag(SYSTEM_ID, MOMENTUM_FLAG, {
    messageId: message.id,
    targetTokenId,
    kill: fired.kill,
    itemId: item.id,
    combat: turnStamp(combat),
  });
}

/** The Momentum this actor may still take this turn, or null. */
export function pendingMomentum(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, MOMENTUM_FLAG);
  const combat = game.combat;
  if (!stored || !stampIsThisTurn(stored.combat, combat)) return null;
  if (getSpent(actor).bonusSources.includes(momentumSource(combat))) return null;
  return stored;
}

/**
 * The Momentum item the pending chance is for: the one stamped, else (a stamp
 * from before the item id was stored) the first Momentum item the actor has.
 */
export function pendingMomentumItem(actor) {
  const pending = pendingMomentum(actor);
  if (!pending) return null;
  const stamped = pending.itemId ? actor.items.get(pending.itemId) : null;
  if (stamped && isAnyMomentum(stamped)) return stamped;
  return momentumItems(actor)[0] ?? null;
}

/**
 * Předvoj → Momentum: Výdrž -1. The Stamina the doctrine Momentum costs this
 * actor. Any other ability passes through unchanged.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {number} cost  the price so far
 * @returns {number}
 */
export function momentumStaminaCost(actor, ability, cost) {
  if (!isMomentum(ability)) return cost;
  if ((ability.system?.costType || "stamina") !== "stamina") return cost;
  if (!hasVanguardNode(actor, "momentumVydrz")) return cost;
  return Math.max(0, cost - MOMENTUM_STAMINA_DISCOUNT);
}

/**
 * Use Momentum on the pending chance: pay the item the chance was stamped
 * with, note the round's use and make the next plain Attack free (with
 * Předvoj's Speciální akce, a weapon attack ability instead if the player
 * prefers). False with nothing pending, so the caller posts the ability's
 * plain card instead.
 *
 * @param {Actor} actor
 * @param {Item} ability  the Momentum item clicked
 * @returns {Promise<boolean>}
 */
export async function useMomentum(actor, ability) {
  const pending = pendingMomentum(actor);
  if (!pending) return false;
  const combat = trackedCombat(actor);
  if (!combat) return false;
  const item = pendingMomentumItem(actor) ?? ability;
  if (!(await game.redsteel.deductAbilityCost(actor, [item]))) return true;
  await actor.unsetFlag(SYSTEM_ID, MOMENTUM_FLAG);
  await markBonusSource(actor, momentumSource(combat));

  // Who the free attack is meant for: the one targeted living token, else
  // the card's victim. A hint only; the tracker does not enforce it.
  const self = tokenForActor(actor);
  const targeted = [...(game.user?.targets ?? [])].filter(
    (t) => t !== self && !isFallen(t.actor),
  );
  const targetId =
    targeted.length === 1 ? targeted[0].id : (pending.targetTokenId ?? "");
  // grantFreeAttack needs some id to hold the grant; nothing reads it back.
  const holder = targetId || self?.id || actor.id;
  await grantFreeAttack(actor, holder);

  // Předvoj → Momentum: Speciální akce. Paired with the free Attack: spending
  // either one spends both.
  const keys = vanguardMomentumAbilityKeys(actor);
  const special =
    keys.length > 0 &&
    (await grantFreeAbility(actor, {
      keys,
      targetId: targetId || null,
      pairedAttack: true,
    }));

  const lineKey = special
    ? "REDSTEEL.Vanguard.MomentumFreeAttackOrAbility"
    : "REDSTEEL.Hoplite.MomentumFreeAttack";
  const token = tokenForActor(actor);
  const title = esc(item.localizedName ?? item.name);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
    flavor: `<p class="rs-card-headline"><b>${title}</b></p>
<p style="text-align:center;">${game.i18n.format(lineKey, {
      name: esc(actor.name),
    })}</p>`,
  });
  return true;
}
