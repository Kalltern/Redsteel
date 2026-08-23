/**
 * Resolving which combatants belong to an actor.
 *
 * Matching on `combatant.actorId` looks right and is wrong for every unlinked
 * token: an unlinked NPC's synthetic actor keeps the *base* actor's id, so ten
 * goblins dropped from one prototype share a single `actorId`. Any lookup on
 * that id answers "the first goblin in the tracker" no matter which goblin the
 * caller meant — which is how killing the goblin at the back of the room
 * deleted the one at the front, and repeated calls chewed through the rest of
 * the group one combatant per call.
 *
 * Identity is therefore read off the actor's uuid, which is the one value that
 * distinguishes them: a linked actor is `Actor.<id>`, a synthetic token actor
 * is `Scene.<id>.Token.<id>.Actor.<id>`. A linked actor placed several times
 * still matches all of its combatants (they really are the same character);
 * an unlinked token matches only its own.
 */

/**
 * Every combatant in `combat` that represents `actor`.
 * @param {Actor}  actor
 * @param {Combat} [combat] Defaults to the active combat.
 * @returns {Combatant[]}
 */
export function combatantsForActor(actor, combat = game.combat) {
  if (!actor || !combat) return [];
  const uuid = actor.uuid;
  return combat.combatants.filter((c) => c.actor?.uuid === uuid);
}

/**
 * The single combatant representing `actor`, or null.
 * @param {Actor}  actor
 * @param {Combat} [combat] Defaults to the active combat.
 * @returns {Combatant|null}
 */
export function combatantForActor(actor, combat = game.combat) {
  return combatantsForActor(actor, combat)[0] ?? null;
}

/**
 * Whether the actor is a participant in `combat`.
 * @param {Actor}  actor
 * @param {Combat} [combat] Defaults to the active combat.
 * @returns {boolean}
 */
export function isActorInCombat(actor, combat = game.combat) {
  if (!actor || !combat) return false;
  const uuid = actor.uuid;
  return combat.combatants.some((c) => c.actor?.uuid === uuid);
}
