/**
 * Floor initiative — Prone / Downed force turn order to 1.
 *
 * "Povalení: Pořadí tahu dočasně sníženo na 1." The rule is a state, not a
 * one-off event: for as long as the actor is on the floor their turn order is
 * 1, whatever their Speed test rolled.
 *
 * Three layers keep that true, because initiative can change from three
 * different directions:
 *
 *   1. The roll itself — `buildSpeedTestFormula` returns a flat "1" for a
 *      floored actor, so every roll made through the tracker (including the
 *      dynamic-initiative reroll at the top of each round) already lands on 1.
 *   2. This module's `syncFloorInitiative`, run when the status is applied or
 *      cleared and again at every round start.
 *   3. The `updateCombatant` clamp registered here, which catches anything
 *      that writes an initiative directly — a GM typing a number into the
 *      tracker, a module, an old value restored by "previous round".
 *
 * The pre-fall initiative is stashed on the combatant so standing up puts the
 * character back where they were instead of leaving them pinned at 1 for the
 * rest of the fight.
 */

/**
 * Statuses that pin turn order to 1 while present. Downed and Incapacitated
 * each apply on their own — a character can be Downed without Prone, and
 * unconsciousness can arrive from a head crit with neither of the other two.
 */
export const FLOOR_STATUSES = ["prone", "downed", "incapacitated"];

/** The initiative a floored combatant is held at. */
export const FLOOR_INITIATIVE = 1;

/** Combatant flag holding the initiative the actor had before falling. */
const PRIOR_FLAG = "initBeforeFloor";

/**
 * Whether an effect is one of the floor statuses. Reads both the modern
 * `statuses` set and the legacy `core.statusId` flag, so effects created by the
 * system and by the core Token HUD are both caught.
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function isFloorEffect(effect) {
  if (!effect) return false;
  const legacy = effect.getFlag?.("core", "statusId");
  return FLOOR_STATUSES.some((s) => effect.statuses?.has(s) || legacy === s);
}

/**
 * Whether the actor is currently on the floor.
 *
 * Read from the effect collection rather than `actor.statuses` so a caller can
 * exclude an effect that is in the middle of being deleted — at
 * `deleteActiveEffect` time the actor's derived status set may not have been
 * rebuilt yet.
 * @param {Actor}  actor
 * @param {object} [options]
 * @param {string} [options.ignoreId]  Effect id to treat as already gone.
 * @returns {boolean}
 */
export function isFloored(actor, { ignoreId = null } = {}) {
  if (!actor) return false;
  return actor.effects.some((e) => e.id !== ignoreId && isFloorEffect(e));
}

/**
 * Whether this combatant's turn is already behind us in the current round.
 * Dropping such a combatant to 1 mid-round re-sorts them below the turn pointer
 * and hands them a second turn, so the drop is deferred to the round start
 * instead.
 * @param {Combat}    combat
 * @param {Combatant} combatant
 * @returns {boolean}
 */
function hasActedThisRound(combat, combatant) {
  if (!combat.started) return false;
  const index = combat.turns.findIndex((t) => t.id === combatant.id);
  return index >= 0 && index < (Number(combat.turn) || 0);
}

/**
 * Whether a combatant can be moved up the order without corrupting the round in
 * progress. Raising an initiative re-sorts the list, and anyone who already
 * acted but now sits *behind* the moved combatant gets a second turn. Nobody is
 * behind anybody before the first turn of a round resolves, so that is the only
 * safe moment — a restore that arrives mid-round waits for the next round start.
 * @param {Combat} combat
 * @returns {boolean}
 */
function canRaiseInitiative(combat) {
  return !combat.started || (Number(combat.turn) || 0) === 0;
}

/**
 * Bring every combatant of an actor in line with their floor state: pinned at
 * initiative 1 while any FLOOR_STATUSES is on them, back to the stashed
 * pre-fall value once they are all gone. Idempotent — safe to call from several
 * paths for the same change.
 *
 * Combatant writes need GM authority, so non-GM clients no-op; the authoritative
 * GM's own call does the work for everyone.
 * @param {Actor}  actor
 * @param {object} [options]
 * @param {Combat} [options.combat]    Defaults to the active combat.
 * @param {string} [options.ignoreId]  Effect id to treat as already gone.
 * @returns {Promise<void>}
 */
export async function syncFloorInitiative(
  actor,
  { combat = game.combat, ignoreId = null } = {},
) {
  if (!actor || !combat) return;
  if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;

  const combatants = combat.combatants.filter((c) => c.actorId === actor.id);
  if (!combatants.length) return;

  const floored = isFloored(actor, { ignoreId });
  const updates = [];
  let dropped = false;
  let restored = false;
  let deferred = false;

  for (const combatant of combatants) {
    if (floored) {
      if (combatant.initiative === FLOOR_INITIATIVE) continue;
      if (hasActedThisRound(combat, combatant)) {
        deferred = true;
        continue;
      }

      const update = { _id: combatant.id, initiative: FLOOR_INITIATIVE };

      // Remember where they were, but never overwrite an earlier stash: a
      // second floor status landing on an already-prone actor must not record
      // the 1 they are currently sitting at.
      const prior = combatant.getFlag("redsteel", PRIOR_FLAG);
      if (prior == null && combatant.initiative != null) {
        update[`flags.redsteel.${PRIOR_FLAG}`] = combatant.initiative;
      }

      updates.push(update);
      dropped = true;
    } else {
      const prior = combatant.getFlag("redsteel", PRIOR_FLAG);
      if (prior == null) continue;

      // Standing up mid-round leaves them at 1 until the round turns over —
      // see canRaiseInitiative. The stash is kept so the round start can still
      // find it.
      if (!canRaiseInitiative(combat)) continue;

      const update = {
        _id: combatant.id,
        [`flags.redsteel.-=${PRIOR_FLAG}`]: null,
      };

      // Only hand the old number back if they are still sitting on the floor
      // value; anything else means something re-rolled them in the meantime and
      // that fresher number wins.
      if (combatant.initiative === FLOOR_INITIATIVE) {
        update.initiative = prior;
        restored = true;
      }

      updates.push(update);
    }
  }

  if (!updates.length) {
    if (deferred) {
      ui.notifications.info(
        `${actor.name} is on the floor — they drop to initiative 1 at the start of the next round.`,
      );
    }
    return;
  }

  await combat.updateEmbeddedDocuments("Combatant", updates);

  if (dropped) {
    ui.notifications.info(`${actor.name} drops to initiative 1 (on the floor).`);
  } else if (restored) {
    ui.notifications.info(`${actor.name} returns to their normal turn order.`);
  }
}

/**
 * Re-clamp every combatant of the combat to their floor state. Used at round
 * start, after the dynamic-initiative reroll has run.
 * @param {Combat} combat
 * @returns {Promise<void>}
 */
export async function syncCombatFloorInitiative(combat) {
  if (!combat) return;
  const seen = new Set();
  for (const combatant of combat.combatants.contents) {
    const actor = combatant.actor;
    if (!actor || seen.has(actor.id)) continue;
    seen.add(actor.id);
    await syncFloorInitiative(actor, { combat });
  }
}

/**
 * Last line of defense: any direct initiative write on a floored combatant is
 * pulled straight back to 1. The clamp cannot loop — an update that already
 * sets 1 is ignored.
 */
export function registerFloorInitiativeClamp() {
  Hooks.on("updateCombatant", async (combatant, changed) => {
    if (!("initiative" in changed)) return;
    if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;

    // `resetAll` blanks initiative before a reroll; the reroll that follows
    // uses the flat-1 formula, so there is nothing to clamp yet.
    if (combatant.initiative == null) return;
    if (combatant.initiative === FLOOR_INITIATIVE) return;

    const actor = combatant.actor;
    if (!actor || !isFloored(actor)) return;

    const combat = combatant.parent;
    if (combat && hasActedThisRound(combat, combatant)) return;

    const update = { initiative: FLOOR_INITIATIVE };
    const prior = combatant.getFlag("redsteel", PRIOR_FLAG);
    if (prior == null) update[`flags.redsteel.${PRIOR_FLAG}`] = combatant.initiative;

    await combatant.update(update);
  });
}
