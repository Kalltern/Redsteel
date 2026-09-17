/**
 * Blood Reserve (Zásoba krve) helpers.
 *
 * Rules: besides the Life a Blood caster deliberately transfers with an action,
 * "všechny životy, které sesilatel ztratil skrze Krvácení" flow into the Reserve
 * automatically. That transfer is not limited by the Maximum Transfer (which
 * only caps a single deliberate conversion) — only by the Reserve capacity.
 */

/**
 * Add Life to an actor's Blood Reserve, whatever the source.
 *
 * A no-op for anyone without a Reserve (capacity 0 — i.e. no Blood School
 * specialisation, and no manually set max on an NPC). The gain is clamped to
 * the remaining capacity, so a full Reserve simply absorbs nothing.
 *
 * @param {Actor} actor   The actor whose Reserve fills.
 * @param {number} amount Life to add.
 * @returns {Promise<number>} How much actually entered the Reserve.
 */
export async function gainBlood(actor, amount) {
  const lost = Number(amount) || 0;
  if (!actor || lost <= 0) return 0;

  const pool = actor.system?.stats?.bloodPool;
  const max = Number(pool?.max) || 0;
  if (max <= 0) return 0;

  const current = Number(pool?.value) || 0;
  const next = Math.min(max, current + lost);
  const gained = next - current;
  if (gained <= 0) return 0;

  await actor.update({ "system.stats.bloodPool.value": next });
  return gained;
}

/**
 * Move Life lost to Bleeding into the actor's Blood Reserve.
 *
 * @param {Actor} actor   The bleeding actor.
 * @param {number} amount Life lost to the Bleeding tick.
 * @returns {Promise<number>} How much actually entered the Reserve.
 */
export async function gainBloodFromBleed(actor, amount) {
  return gainBlood(actor, amount);
}

/**
 * Chat-flavor note for a Reserve gain, or "" when nothing was gained.
 *
 * @param {Actor} actor
 * @param {number} gained
 * @returns {string}
 */
export function bloodGainNote(actor, gained) {
  if (!(gained > 0)) return "";
  return `<div style="text-align:center; color:#a01818;">${game.i18n.format(
    "REDSTEEL.Effect.BloodFromBleed",
    { name: actor.name, amount: gained },
  )}</div>`;
}

/* -------------------------------------------- */
/*  Blood Payment (Krvavá platba)               */
/* -------------------------------------------- */

/** Life paid out of the Blood Reserve for one Blood Payment. */
export const BLOOD_PAYMENT_COST = 5;

/**
 * How far one Blood Payment shifts a cast's Difficulty.
 *
 * Difficulty is a *signed modifier* in this system: a spell sitting at +25 is
 * easier than one at -50, and the number is added straight onto the cast roll.
 * The rulebook's "snížení Obtížnosti o 15%" therefore moves the number up by
 * 15, exactly the way Focus does (see getEffectiveDifficulty).
 */
export const BLOOD_PAYMENT_DIFFICULTY = 15;

/**
 * True when the caster owns the Blood Payment node (Škola Krve — Expert).
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasBloodPayment(actor) {
  return (
    actor?.system?.specialisations?.bloodSchool?.nodes?.krvavaPlatba === true
  );
}

/**
 * Current Life sitting in the Blood Reserve.
 * @param {Actor} actor
 * @returns {number}
 */
export function getBloodReserve(actor) {
  return Number(actor?.system?.stats?.bloodPool?.value) || 0;
}

/**
 * Pay the Blood Payment out of the Reserve. Never overdraws: the caller checks
 * affordability before the cast starts (castSpell.mjs/performCast), so a short
 * Reserve here means something else drained it mid-cast and the payment is
 * simply refused.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>} True when the 5 Life were actually spent.
 */
export async function payBloodPayment(actor) {
  const current = getBloodReserve(actor);
  if (current < BLOOD_PAYMENT_COST) return false;
  await actor.update({
    "system.stats.bloodPool.value": current - BLOOD_PAYMENT_COST,
  });
  return true;
}
