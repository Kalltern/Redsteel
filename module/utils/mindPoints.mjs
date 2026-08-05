/**
 * Burned Mind points (Spálené Mentální životy).
 *
 * Some abilities let a character *burn* a Mind point rather than merely spend
 * it. A burn costs the point twice over: the current value drops by one and the
 * maximum drops by one as well, so 2/5 becomes 1/4. The loss is permanent for
 * all normal purposes — only a ritual or a potion restores it, and neither is
 * automated, so restoration is done by lowering `system.stats.mind.burned` on
 * the actor's Config tab.
 *
 * The permanent part lives in the stored `burned` counter; `mind.max` subtracts
 * it during data preparation (actor.mjs, both the character and NPC paths).
 * Never write `mind.max` directly — it is derived and would be recomputed away.
 */

/**
 * The update payload for a burn, without applying it.
 *
 * Split out so a caller that changes other resources in the same breath (Blood
 * Pact fills the Blood Reserve) can merge everything into one actor.update and
 * keep the burn atomic with what it paid for.
 *
 * `burnt` is 0 when the actor has no Mind point left to burn: burning is always
 * paid out of the current pool, never on credit.
 *
 * @param {Actor} actor
 * @param {number} [amount=1]
 * @returns {{burnt: number, updates: object}}
 */
export function mindBurnUpdates(actor, amount = 1) {
  const want = Math.max(0, Math.floor(Number(amount) || 0));
  const mind = actor?.system?.stats?.mind;
  const current = Number(mind?.value) || 0;
  const burnt = Math.min(current, want);
  if (burnt <= 0) return { burnt: 0, updates: {} };

  return {
    burnt,
    updates: {
      "system.stats.mind.value": current - burnt,
      "system.stats.mind.burned": (Number(mind?.burned) || 0) + burnt,
    },
  };
}

/**
 * Burn Mind points.
 *
 * @param {Actor} actor    The burner.
 * @param {number} [amount=1] How many points to burn.
 * @returns {Promise<number>} How many points were actually burned.
 */
export async function burnMindPoints(actor, amount = 1) {
  if (!actor) return 0;

  const { burnt, updates } = mindBurnUpdates(actor, amount);
  if (burnt <= 0) return 0;

  await actor.update(updates);
  return burnt;
}

/**
 * Give back burned Mind points (ritual / potion, resolved at the table).
 *
 * Only the ceiling is restored; the character still has to regain the point
 * itself the ordinary way (a Long Rest gives +1 Mind).
 *
 * @param {Actor} actor
 * @param {number} [amount=1]
 * @returns {Promise<number>} How many burned points were given back.
 */
export async function restoreBurnedMind(actor, amount = 1) {
  const want = Math.max(0, Math.floor(Number(amount) || 0));
  if (!actor || want <= 0) return 0;

  const burned = Number(actor.system?.stats?.mind?.burned) || 0;
  const restored = Math.min(burned, want);
  if (restored <= 0) return 0;

  await actor.update({ "system.stats.mind.burned": burned - restored });
  return restored;
}
