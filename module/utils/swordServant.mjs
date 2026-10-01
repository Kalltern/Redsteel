/**
 * Servant of the Sword (Služebník meče): the Riposte chain and the Charge
 * distance node. The two stances live in dragonGuard.mjs / dragonSleep.mjs,
 * Slip Through in slipThrough.mjs.
 *
 * - ripostaFree "One Riposte per round as Free action": the first Riposte of
 *   each round costs no Reaction. The Stamina is still paid (user ruling
 *   2026-10-01). The round it was used in is stamped on the actor
 *   (`flags.redsteel.freeRiposte = {combat, round}`), read by the action
 *   tracker's costOf and the hotbar's Riposte chip.
 * - ripostaStamina "Riposte: Stamina -4": taken off the Riposte's cost where
 *   it is paid (combatAbilities.mjs deductAbilityCost).
 * - ripostaCrit "Riposte always counts as Critical": every Riposte card is a
 *   Critical Hit, so if it wins and lands, Apply Damage treats it as one. A
 *   natural fumble stays a fumble (user ruling 2026-10-01).
 * - chargeDistance "Charge: Min. distance -1 hex": every charge needs the
 *   target at least 2 hexes away when it is declared (user ruling
 *   2026-10-01, Shield Charge included); the node lowers that to 1.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { combatantForActor } from "./combatants.mjs";

const SYSTEM_ID = "redsteel";
const SPEC = "swordServant";
const FREE_RIPOSTE_FLAG = "freeRiposte";

export const RIPOSTE_KEY = "REDSTEEL.Items.Riposte.name";
const RIPOSTE_STAMINA_DISCOUNT = 4;

/** Is this ability Riposte (by key, or the pack's English name)? */
export function isRiposte(ability) {
  return (
    ability?.system?.localizationKey === RIPOSTE_KEY ||
    ability?.name === "Riposte"
  );
}

/* -------------------------------------------------------------------------- */
/*  Riposte                                                                   */
/* -------------------------------------------------------------------------- */

/** The started encounter this actor fights in, or null. */
function combatFor(actor) {
  const combat = game.combat;
  if (!actor || !combat?.started) return null;
  return combatantForActor(actor, combat) ? combat : null;
}

/**
 * Does this actor still have this round's free Riposte (ripostaFree)?
 *
 * @param {Actor} actor
 */
export function hasFreeRiposte(actor) {
  if (!actorHasSpecNode(actor, SPEC, "ripostaFree")) return false;
  const combat = combatFor(actor);
  if (!combat) return false;
  const stamp = actor.getFlag(SYSTEM_ID, FREE_RIPOSTE_FLAG);
  return !(
    stamp &&
    stamp.combat === combat.id &&
    Number(stamp.round) === Number(combat.round)
  );
}

/**
 * Spend this round's free Riposte. Called by the action tracker as the
 * Riposte is charged, on the client that owns the actor.
 *
 * @param {Actor} actor
 */
export async function markFreeRiposteUsed(actor) {
  const combat = combatFor(actor);
  if (!combat || !actor.isOwner) return;
  await actor.setFlag(SYSTEM_ID, FREE_RIPOSTE_FLAG, {
    combat: combat.id,
    round: combat.round,
  });
}

/**
 * The cost a Riposte is paid at: Stamina -4 with ripostaStamina, never below
 * 0. Any other item keeps its authored cost.
 *
 * @param {Actor} actor
 * @param {Item|object} item  an ability, or a pseudo item with a cost line
 * @returns {number}
 */
export function paidAbilityCost(actor, item) {
  const cost = Number(item?.system?.cost) || 0;
  if (!isRiposte(item)) return cost;
  if ((item.system.costType || "stamina") !== "stamina") return cost;
  if (!actorHasSpecNode(actor, SPEC, "ripostaStamina")) return cost;
  return Math.max(0, cost - RIPOSTE_STAMINA_DISCOUNT);
}

/**
 * Is this attack a Riposte that must count as a Critical Hit (ripostaCrit)?
 *
 * @param {Actor} actor
 * @param {Item|null} ability
 */
export function riposteAlwaysCrits(actor, ability) {
  return isRiposte(ability) && actorHasSpecNode(actor, SPEC, "ripostaCrit");
}

/* -------------------------------------------------------------------------- */
/*  Charge distance                                                           */
/* -------------------------------------------------------------------------- */

/** Hexes a charge must start from its target, before chargeDistance. */
const CHARGE_MIN_DISTANCE = 2;

/** The minimum distance this actor's charges need. */
export function chargeMinDistance(actor) {
  return actorHasSpecNode(actor, SPEC, "chargeDistance")
    ? CHARGE_MIN_DISTANCE - 1
    : CHARGE_MIN_DISTANCE;
}

/** Hexes between two token centres, along the grid. */
function hexDistance(a, b) {
  const path = canvas.grid.getDirectPath([a.center, b.center]);
  return Math.max(0, (path?.length ?? 1) - 1);
}

/**
 * May this charge be declared against the current target from where the
 * token stands? Warns and answers false when the target is too close. With
 * nothing targeted (or no token on the canvas) there is nothing to measure,
 * so it is allowed: the swing at the end of the move is aimed then.
 *
 * @param {Actor} actor
 * @param {Token|null} token  the charging token
 * @returns {boolean}
 */
export function chargeDistanceAllowed(actor, token) {
  const target = game.user.targets?.first?.() ?? null;
  // A placeable either way: selectToken may hand back the document.
  token = token?.object ?? token;
  if (!token?.center || !target || target.id === token.id) return true;
  const min = chargeMinDistance(actor);
  const distance = hexDistance(token, target);
  if (distance >= min) return true;
  ui.notifications.warn(
    game.i18n.format("REDSTEEL.Charge.TooClose", {
      min,
      distance,
      target: target.name,
    }),
  );
  return false;
}
