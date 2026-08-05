/**
 * Blood Reserve (Zásoba krve) helpers.
 *
 * Rules: besides the Life a Blood caster deliberately transfers with an action,
 * "všechny životy, které sesilatel ztratil skrze Krvácení" flow into the Reserve
 * automatically. That transfer is not limited by the Maximum Transfer (which
 * only caps a single deliberate conversion) — only by the Reserve capacity.
 */

/**
 * Move Life lost to Bleeding into the actor's Blood Reserve.
 *
 * A no-op for anyone without a Reserve (capacity 0 — i.e. no Blood School
 * specialisation, and no manually set max on an NPC). The gain is clamped to
 * the remaining capacity, so a full Reserve simply absorbs nothing.
 *
 * @param {Actor} actor   The bleeding actor.
 * @param {number} amount Life lost to the Bleeding tick.
 * @returns {Promise<number>} How much actually entered the Reserve.
 */
export async function gainBloodFromBleed(actor, amount) {
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
