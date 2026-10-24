/**
 * Action / Reaction tracker — a readout, not a rule.
 *
 * The book gives everyone 2 Actions, 1 Reaction and any number of Free actions
 * per round ("Combat Actions", General Rules), with more granted only rarely.
 * This file counts what has been spent so the hotbar can draw it. Nothing here
 * ever refuses a use: running out dims the pips and that is all. Whether an
 * action was legal is a table ruling, and the GM is at the table.
 *
 * WHAT IS STORED, AND WHY SO LITTLE
 * ---------------------------------
 * One actor flag, `flags.redsteel.actionTracker`, holding a round stamp and the
 * two spent counts:
 *
 *     { combat: <combat id>, round: <number>, actions: <n>, reactions: <n>,
 *       moved: <bool> }
 *
 * `moved` is what keeps movement to one Action however far a character walks.
 * It lives in this same record rather than on the token, so it expires with the
 * round stamp for free like everything else here; each combatant takes one turn
 * per round, so "once this round" and "once this turn" are the same statement.
 *
 * Both pools refresh at the top of the round (user ruling 2026-09-22), so the
 * stamp alone decides whether a record still applies: a record from an earlier
 * round, or from a combat that has ended, reads as *nothing spent* and is
 * simply overwritten by the next spend. That is the same trick `overwhelm.mjs`
 * uses, and it is what lets the tracker work with **no reset writes at all** —
 * no `updateCombat` handler racing three clients to zero the same flag, no
 * permission puzzle over who owns the write, and no way for a missed hook to
 * strand somebody at zero actions for the rest of the fight.
 *
 * Spends are written by whoever performed the action, on their own actor, so
 * ordinary ownership covers every case: a player spends on their character, the
 * GM spends on an NPC. A user who cannot write the actor silently records
 * nothing rather than throwing — again, this is a readout.
 *
 * READING A COST
 * --------------
 * `parseActionCost` (spellbook.mjs) already turns the free-text
 * `system.actionCost` the packs use — "1 Action", "2 Actions", "Free action",
 * "Reaction", "1 | Reaction", "2 | C" — into `{actions, free, reaction}`. It is
 * reused verbatim; there is no second spelling of the field anywhere.
 *
 * The off-turn rule comes straight from the book: "Reakce lze využívat vždy jen
 * mimo svůj tah." So an item that *can* be a reaction spends the reaction when
 * it is used outside its actor's turn, and spends actions on its own turn. An
 * item that is only a reaction ("Counterattack") spends a reaction off-turn and
 * nothing at all on-turn — using it there is already a timing mistake the
 * combat abilities dialog flags, and inventing an action cost for it would be
 * this file guessing at a rule.
 */

import { parseActionCost } from "./spellbook.mjs";
import { combatantForActor } from "./combatants.mjs";
import { isExploitAsRetaliation } from "./dragonGuard.mjs";
import { hasFreeRiposte, isRiposte, markFreeRiposteUsed } from "./swordServant.mjs";
import { isForcedMove } from "./forcedMoveRegistry.mjs";
import { aimBreakKind, breakAimOnAction } from "./aim.mjs";

/**
 * Movement declarations that are a non-attack action of their own and so
 * break a normal Aim when they cost an Action (aim.mjs). A Charge's approach
 * is part of its attack, and the ability-driven steps are paid (or free)
 * through their abilities.
 */
const AIM_BREAKING_MODES = new Set(["move", "slow", "sprint", "disengage"]);

const SYSTEM_ID = "redsteel";
const FLAG = "actionTracker";

/** Book defaults, used when an actor predates the template fields. */
const DEFAULT_ACTIONS = 2;
const DEFAULT_REACTIONS = 1;

/**
 * The most pips one pool will ever draw.
 *
 * The book calls anything past 2 Actions / 1 Reaction "velmi vzácně", and the
 * grants it names add one at a time, so a real pool in the low single digits is
 * the whole range. This exists for the other case: an Active Effect with a
 * multiply mode, or a number typed with an extra zero, which would otherwise
 * hand the hotbar a hundred stars to draw and push the panel off the screen.
 * A pool genuinely above this reads as the ceiling rather than as itself, which
 * is the mildest way to be wrong.
 */
const MAX_POOL = 12;

/* -------------------------------------------------------------------------- */
/*  Pools                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How many actions and reactions this actor has per round.
 *
 * Real schema fields rather than derived numbers, so the rare grants the book
 * names — "+1 Reakce za odbornost Bleskové reflexy", "+1 akce za kouzlo
 * Rychlost", the Shadow node that costs one — can be hung on them as ordinary
 * Active Effect changes later without touching this file.
 *
 * @param {Actor} actor
 * @returns {{actions: number, reactions: number}}
 */
export function getActionPools(actor) {
  const economy = actor?.system?.actionEconomy ?? {};
  const actions = Number(economy.actions);
  const reactions = Number(economy.reactions);
  const clampPool = (value, fallback) =>
    Math.min(MAX_POOL, Math.max(0, Number.isFinite(value) ? value : fallback));
  return {
    actions: clampPool(actions, DEFAULT_ACTIONS),
    reactions: clampPool(reactions, DEFAULT_REACTIONS),
  };
}

/* -------------------------------------------------------------------------- */
/*  The round stamp                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Whether the tracker applies to this actor right now: there is a started
 * encounter and the actor is in it. Outside those the hotbar draws nothing,
 * because a turn economy with no turns is noise.
 *
 * @param {Actor} actor
 * @returns {Combat|null} The encounter the actor is fighting in, or null.
 */
export function trackedCombat(actor) {
  const combat = game.combat;
  if (!actor || !combat?.started) return null;
  return combatantForActor(actor, combat) ? combat : null;
}

/** The stored record, or null when it belongs to an earlier round or combat. */
function currentRecord(actor, combat) {
  const stored = actor?.getFlag?.(SYSTEM_ID, FLAG);
  if (!stored || !combat) return null;
  if (stored.combat !== combat.id) return null;
  if (Number(stored.round) !== Number(combat.round)) return null;
  return stored;
}

/**
 * What this actor has spent this round.
 *
 * @param {Actor} actor
 * @returns {{actions: number, reactions: number, moved: boolean}} Spent counts,
 *   never negative and never above the pool — a pool shrinking mid-fight
 *   (Strain takes a Reaction away) must not leave the readout showing more
 *   spent than exist. `moved` says this round's movement is already accounted
 *   for, whether it was paid for or granted free.
 */
export function getSpent(actor) {
  const combat = trackedCombat(actor);
  const pools = getActionPools(actor);
  const record = currentRecord(actor, combat);
  return {
    actions: clamp(record?.actions, pools.actions),
    reactions: clamp(record?.reactions, pools.reactions),
    moved: !!record?.moved,
    movement: record?.movement ?? null,
    bonusSources: Array.isArray(record?.bonusSources) ? record.bonusSources : [],
    // Duelist's Advance: the token a plain Attack may now be made at as a
    // Free action (grantFreeAttack).
    freeAttack: typeof record?.freeAttack === "string" ? record.freeAttack : null,
    // Forceful Advance (Hoplite): abilities that cost no Action this turn
    // (grantFreeAbility).
    freeAbility: normaliseFreeAbility(record?.freeAbility),
  };
}

/**
 * A free-ability grant with every key spelled out, or null. `turn` is the
 * combat turn it was granted in; it lapses when the turn moves on.
 */
function normaliseFreeAbility(grant) {
  const keys = Array.isArray(grant?.keys)
    ? grant.keys.filter((k) => typeof k === "string" && k)
    : [];
  if (!keys.length) return null;
  return {
    keys,
    targetId:
      typeof grant.targetId === "string" && grant.targetId ? grant.targetId : null,
    turn: Number(grant.turn),
    // Předvoj → Momentum: Speciální akce (momentum.mjs): this grant and the
    // free Attack are one extra attack, so spending either spends both.
    pairedAttack: !!grant.pairedAttack,
  };
}

/**
 * A movement lock with every key spelled out. `setFlag` merges into what is
 * stored, so a key left out of a new lock would let the previous lock's value
 * survive (a stale `done` or `bonus` would end or divert the new movement).
 */
function normaliseLock(lock) {
  if (!lock) return null;
  return {
    mode: lock.mode,
    budget: Math.max(0, Math.floor(Number(lock.budget) || 0)),
    startSpent: Math.max(0, Math.floor(Number(lock.startSpent) || 0)),
    ignore: Array.isArray(lock.ignore) ? lock.ignore : [],
    // Improved Duelist's Advance: enemies that neither threaten the move nor
    // stop it, but may still be walked around (movementZones.mjs).
    exempt: Array.isArray(lock.exempt) ? lock.exempt : [],
    done: !!lock.done,
    // The turn-start default Move (armTurnMovement): declared for the player
    // but not yet paid. The first step pays its Action (noteMovement); until
    // then the strip still offers the other modes.
    armed: !!lock.armed,
    // Charge Defense (Hoplite) ended this movement early: a stopped Charge
    // may not swing (combatAbilities.mjs refuses it).
    stopped: !!lock.stopped,
    // Předvoj → Rozražení (bullCharge.mjs): a charge approach that may run
    // through and around enemies, and the enemy token ids already contested
    // on it (never twice in one charge).
    bullCharge: !!lock.bullCharge,
    contested: Array.isArray(lock.contested)
      ? lock.contested.filter((id) => typeof id === "string" && id)
      : [],
    bonus: !!lock.bonus,
    resume: lock.bonus ? normaliseLock(lock.resume) : null,
    resumeMoved: !!lock.resumeMoved,
    // Quick Feet: the opponent the step must stay next to, and the retaliation
    // the strip's check button fires once the step is done.
    around: typeof lock.around === "string" && lock.around ? lock.around : null,
    // Lunge Step: the attacker the step must close in on.
    toward: typeof lock.toward === "string" && lock.toward ? lock.toward : null,
    // Hoplite Advance: the step keeps to the line from `from` through `to`
    // (grid offset keys "i,j", movementZones.mjs).
    along:
      typeof lock.along?.from === "string" && typeof lock.along?.to === "string"
        ? { from: lock.along.from, to: lock.along.to }
        : null,
    launch: lock.launch?.abilityId
      ? {
          abilityId: String(lock.launch.abilityId),
          targetId: lock.launch.targetId ? String(lock.launch.targetId) : null,
          modifierIds: Array.isArray(lock.launch.modifierIds)
            ? lock.launch.modifierIds.map(String)
            : [],
          turn: Number(lock.launch.turn),
        }
      : null,
  };
}

function clamp(value, max) {
  const n = Math.floor(Number(value) || 0);
  return Math.min(Math.max(n, 0), max);
}

/* -------------------------------------------------------------------------- */
/*  Writing                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Write spent counts for the current round.
 *
 * Silent no-op when there is nothing to track or this user cannot write the
 * actor. A player who somehow triggers an NPC's ability should not eat a
 * permission error over a pip.
 *
 * The whole record is written every time, so a caller that means to keep
 * `moved` or `movement` has to pass them. Every one of them below starts from
 * `getSpent`, which carries both.
 *
 * `movement` is written as an explicit null rather than left out. A flag
 * update merges into what is stored, so an omitted key would let last round's
 * lock survive under this round's stamp.
 *
 * @param {Actor} actor
 * @param {{actions: number, reactions: number, moved?: boolean,
 *   movement?: object|null}} spent
 */
async function writeSpent(actor, spent) {
  const combat = trackedCombat(actor);
  if (!combat || !actor.isOwner) return;
  const pools = getActionPools(actor);
  await actor.setFlag(SYSTEM_ID, FLAG, {
    combat: combat.id,
    round: combat.round,
    actions: clamp(spent.actions, pools.actions),
    reactions: clamp(spent.reactions, pools.reactions),
    moved: !!spent.moved,
    movement: normaliseLock(spent.movement),
    bonusSources: Array.isArray(spent.bonusSources) ? spent.bonusSources : [],
    freeAttack: typeof spent.freeAttack === "string" ? spent.freeAttack : null,
    freeAbility: normaliseFreeAbility(spent.freeAbility),
  });
}

/**
 * Add to what has been spent this round.
 *
 * Counts are *not* capped on the way in beyond the pool clamp: spending a
 * second action with one left simply empties the bar. Refusing it would make
 * this authoritative, which it is not.
 *
 * @param {Actor} actor
 * @param {{actions?: number, reactions?: number}} cost
 */
export async function spend(actor, { actions = 0, reactions = 0 } = {}) {
  if (!actor) return;
  if (!actions && !reactions) return;
  if (!trackedCombat(actor)) return;
  const spent = getSpent(actor);
  await writeSpent(actor, {
    ...spent,
    actions: spent.actions + Math.max(0, actions),
    reactions: spent.reactions + Math.max(0, reactions),
  });
}

/**
 * Set one pool's spent count outright. The hotbar's pips use this to let a
 * player correct the tracker by hand, which a non-authoritative readout has to
 * allow or it becomes a nuisance the moment it guesses wrong.
 *
 * @param {Actor} actor
 * @param {"actions"|"reactions"} pool
 * @param {number} value  New spent count.
 */
export async function setSpent(actor, pool, value) {
  if (!actor || (pool !== "actions" && pool !== "reactions")) return;
  if (!trackedCombat(actor)) return;
  await writeSpent(actor, { ...getSpent(actor), [pool]: value });
}

/**
 * Give everything back for this round. Right-click on the pip strip.
 *
 * Clears `moved` too, so a character whose movement was charged by mistake can
 * walk again for the price of one Action rather than being stuck either way.
 */
export async function resetSpent(actor) {
  if (!actor || !trackedCombat(actor)) return;
  await writeSpent(actor, { actions: 0, reactions: 0, moved: false });
}

/* -------------------------------------------------------------------------- */
/*  Movement                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The first move a character makes on its own turn costs one Action; walking
 * further on the same turn costs nothing more (user ruling 2026-09-22).
 *
 * That is deliberately not what the book prices. "Pohyb" is 1 action for Speed
 * hexes and going further is another action or a Run, but the tracker cannot
 * see where a drag stopped being the first action and started being the second,
 * and guessing would put a wrong number on the bar every turn. Charging once is
 * the reading that is right most often and never silently wrong: the GM takes
 * the second action by hand, or clicks a star.
 *
 * Only on the actor's own turn. A token shoved, pulled or repositioned during
 * somebody else's turn is not spending its own Action, and the same guard is
 * what stops a GM dragging an NPC around mid-fight from charging it.
 *
 * @param {Actor} actor
 */
export async function noteMovement(actor) {
  const combat = trackedCombat(actor);
  if (!combat || !isActorsTurn(actor, combat)) return;

  const spent = getSpent(actor);
  if (spent.moved) return;

  // The first step of an armed default Move pays for it and settles it.
  const lock = spent.movement;
  await writeSpent(actor, {
    ...spent,
    actions: spent.actions + 1,
    moved: true,
    movement: lock?.armed ? { ...lock, armed: false } : lock,
  });
  // The undeclared first step is a Move action all the same: a normal Aim
  // is lost (aim.mjs), save Harcovník's.
  await breakAimOnAction(actor, { movement: true });
}

/**
 * Account for this turn's movement without charging for it.
 *
 * The hook for everything that grants free movement — Disengage, a Charge that
 * already paid for its own approach, a doctrine that moves you as part of
 * something else. Call it *before* the token moves and the move is free; the
 * mark expires with the round like the rest of the record.
 *
 * It is a no-op once the turn's movement is already accounted for, so calling
 * it after the fact will not refund an Action that has gone. Undoing a charge
 * is what the right-click reset is for.
 *
 * @param {Actor} actor
 */
export async function grantFreeMovement(actor) {
  const combat = trackedCombat(actor);
  if (!combat) return;
  const spent = getSpent(actor);
  if (spent.moved) return;
  await writeSpent(actor, { ...spent, moved: true });
}

/**
 * Declare this turn's movement action from the hotbar's suggestion strip:
 * Move, Slow Movement or Sprint, with the number of hexes it buys.
 *
 * Stored in the round-stamped record, so the lock expires with the round and
 * the right-click reset on the pips clears it along with everything else.
 * `startSpent` is the token's `movementSpent` at the moment of locking; hexes
 * walked since are that counter minus this, which keeps the zone right even
 * when the round-change reset of `movementSpent` did not run (no GM online).
 *
 * Marks `moved`, so the `updateToken` hook does not charge the first step a
 * second time. `charge` is what this call adds to the Action count: 1 for Move
 * and Slow Movement, 0 for a Sprint whose ability already paid through
 * `deductAbilityCost`.
 *
 * @param {Actor} actor
 * `ignore` is Disengage's: the ids of the enemies it breaks free from, which
 * neither threaten the move nor may be walked around (movementZones.mjs).
 *
 * @param {{mode: "move"|"slow"|"sprint"|"disengage", budget: number,
 *   startSpent: number, charge?: number, ignore?: string[]}} lock
 */
export async function lockMovement(
  actor,
  {
    mode,
    budget,
    startSpent = 0,
    charge = 0,
    ignore = [],
    exempt = [],
    launch = null,
    bullCharge = false,
  },
) {
  if (!trackedCombat(actor)) return;
  const spent = getSpent(actor);
  await writeSpent(actor, {
    ...spent,
    actions: spent.actions + Math.max(0, charge),
    moved: true,
    movement: {
      mode,
      budget: Math.max(0, Math.floor(Number(budget) || 0)),
      startSpent: Math.max(0, Math.floor(Number(startSpent) || 0)),
      ignore: Array.isArray(ignore) ? ignore : [],
      exempt: Array.isArray(exempt) ? exempt : [],
      // A Charge: which charge ability the strip's check button swings.
      launch,
      // A Charge with Rozražení ticked (bullCharge.mjs).
      bullCharge: !!bullCharge,
      contested: [],
    },
  });
  // Move, Slow Movement, Sprint or Disengage bought here with an Action is a
  // non-attack action: a normal Aim is lost (aim.mjs). With charge 0 the
  // Action was paid by the ability (Sprint, Disengage), which already broke
  // it through spendForItems, or the move was free.
  if (charge > 0 && AIM_BREAKING_MODES.has(mode)) {
    await breakAimOnAction(actor, { movement: true });
  }
}

/**
 * Předvoj → Rozražení: note enemies a Bull Charge has contested, so
 * the same charge never contests them again (bullCharge.mjs). Only on the
 * round's charge lock; a no-op on anything else.
 *
 * @param {Actor} actor
 * @param {string[]} tokenIds
 */
export async function noteBullChargeContested(actor, tokenIds = []) {
  if (!trackedCombat(actor) || !tokenIds.length) return;
  const spent = getSpent(actor);
  const lock = spent.movement;
  if (!lock || lock.mode !== "charge" || lock.bonus) return;
  await writeSpent(actor, {
    ...spent,
    movement: {
      ...lock,
      contested: [...new Set([...(lock.contested ?? []), ...tokenIds])],
    },
  });
}

/**
 * The player says the declared movement is finished: the strip's check
 * button. Marks the lock `done`, which hides the locked chip and its zone.
 * The lock itself stays, so the drag overlay still caps a further drag at
 * what was left, and it expires with the round like the rest of the record.
 *
 * A bonus step (see grantBonusStep) does not stay behind as a done lock: it
 * hands back whatever movement it interrupted, shifted by the hexes the step
 * walked so that movement's remainder is unchanged, and `moved` goes back to
 * what it was. `tokenSpent` is the token's `movementSpent` now; without it the
 * step counts as fully walked.
 *
 * @param {Actor} actor
 * @param {{tokenSpent?: number}} [options]
 */
export async function confirmMovement(actor, { tokenSpent } = {}) {
  if (!trackedCombat(actor)) return;
  const spent = getSpent(actor);
  const lock = spent.movement;
  if (!lock || lock.done) return;

  if (lock.bonus) {
    const walked = Number.isFinite(Number(tokenSpent))
      ? Math.max(0, Number(tokenSpent) - lock.startSpent)
      : lock.budget;
    const prev = lock.resume;
    await writeSpent(actor, {
      ...spent,
      moved: lock.resumeMoved,
      movement: prev
        ? prev.done
          ? prev
          : { ...prev, startSpent: prev.startSpent + walked }
        : null,
    });
    return;
  }

  await writeSpent(actor, {
    ...spent,
    movement: { ...lock, done: true },
  });
}

/**
 * End this actor's declared movement from outside (Hoplite Charge Defense:
 * "zastaví Zteč"). The lock is marked done and `stopped`, and its `launch`
 * is cleared, so the strip's check button fires no Charge swing and the zone
 * goes away. No refund, nothing else changes. Writes the charger's record, so
 * run it where that actor can be written (the GM).
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>} whether a lock was stopped
 */
export async function stopMovementLock(actor) {
  if (!trackedCombat(actor)) return false;
  const spent = getSpent(actor);
  const lock = spent.movement;
  if (!lock) return false;
  await writeSpent(actor, {
    ...spent,
    movement: { ...lock, done: true, stopped: true, launch: null },
  });
  return true;
}

/**
 * A step an ability grants on top of the turn's movement: Passing Strike's
 * one hex after a hit. Costs nothing and takes the movement slot only for as
 * long as it lasts. Whatever was locked before (a Move with hexes left, or a
 * finished one) is stashed in the lock and comes back when the step ends
 * (confirmMovement), and so does `moved`, so a character who attacks first
 * can still Move afterwards.
 *
 * `source` names what granted the step (the attack card's message id) and is
 * remembered for the round, so applying the same card again grants nothing.
 * A step granted while another bonus step is running replaces it and keeps
 * the original stash.
 *
 * `around` and `launch` are Quick Feet's (abilityMovement.mjs): the opponent
 * the step keeps next to, and the retaliation to fire once it is done.
 * `toward` is Lunge Step's: the attacker the step must close in on.
 * `along` is the Hoplite Advance's: {from, to} grid offset keys, the zone
 * keeps only hexes on the line from `from` through `to` (movementZones.mjs).
 *
 * @param {Actor} actor
 * @param {{mode: string, budget: number, startSpent: number, source?: string,
 *   around?: string|null, toward?: string|null, launch?: object|null,
 *   along?: {from: string, to: string}|null}} step
 * @returns {Promise<boolean>} Whether a step was granted.
 */
export async function grantBonusStep(
  actor,
  {
    mode,
    budget,
    startSpent = 0,
    source = null,
    around = null,
    toward = null,
    launch = null,
    ignore = [],
    along = null,
  },
) {
  if (!trackedCombat(actor)) return false;
  const spent = getSpent(actor);
  if (source && spent.bonusSources.includes(source)) return false;

  const current = spent.movement;
  let resume = current;
  let resumeMoved = spent.moved;
  if (current?.bonus) {
    // The running step's own hexes must not come off the stashed movement.
    const walked = Math.max(0, Number(startSpent) - current.startSpent);
    resume =
      current.resume && !current.resume.done
        ? { ...current.resume, startSpent: current.resume.startSpent + walked }
        : current.resume;
    resumeMoved = current.resumeMoved;
  }

  await writeSpent(actor, {
    ...spent,
    // Marked so the movement hook does not charge the step an Action.
    moved: true,
    movement: {
      mode,
      budget,
      startSpent,
      bonus: true,
      resume,
      resumeMoved,
      around,
      toward,
      launch,
      // Acrobatic Disengage: the enemies it breaks from (see lockMovement).
      ignore: Array.isArray(ignore) ? ignore : [],
      along,
    },
    bonusSources: source ? [...spent.bonusSources, source] : spent.bonusSources,
  });
  return true;
}

/**
 * Note a once-per-round allowance as used, in the same round-stamped record
 * (Vigilant Protector's ally Opportunity Attack). Expires with the round like
 * everything else here. False when there is no encounter to note it in or it
 * was already noted.
 *
 * @param {Actor} actor
 * @param {string} source  any id unique to the allowance and the round
 * @returns {Promise<boolean>}
 */
export async function markBonusSource(actor, source) {
  if (!source || !trackedCombat(actor)) return false;
  const spent = getSpent(actor);
  if (spent.bonusSources.includes(source)) return false;
  await writeSpent(actor, {
    ...spent,
    bonusSources: [...spent.bonusSources, source],
  });
  return true;
}

/**
 * This round's declared movement, or null when none was locked.
 *
 * @param {Actor} actor
 * @returns {{mode: string, budget: number, startSpent: number,
 *   done?: boolean}|null}
 */
export function getMovementLock(actor) {
  return getSpent(actor).movement;
}

/* -------------------------------------------------------------------------- */
/*  Turning an item into a cost                                               */
/* -------------------------------------------------------------------------- */

/**
 * Is this actor the combatant whose turn is running?
 *
 * Deliberately *not* `isOwnTurn` from opportunityAttacks.mjs: that one answers
 * false when there is no encounter, which is the right answer for "may this be
 * an opportunity attack" and the wrong one here — every caller below has
 * already established that a turn order exists.
 *
 * @param {Actor} actor
 * @param {Combat} combat
 */
function isActorsTurn(actor, combat) {
  const combatant = combatantForActor(actor, combat);
  return !!combatant && combat.combatant?.id === combatant.id;
}

/**
 * Is it this actor's turn in a tracked encounter? The hotbar's suggestion
 * strip offers turn actions only then.
 *
 * @param {Actor} actor
 */
export function isTrackedTurn(actor) {
  const combat = trackedCombat(actor);
  return !!combat && isActorsTurn(actor, combat);
}

/**
 * Movement modes an ability declares outside the actor's own turn
 * (abilityMovement.mjs): Quick Feet's step before a retaliation, Improved
 * Passing Strike's step after one, Lunge Step's step toward an attacker,
 * Half Pirouette's step around the opponent after a Counterattack or Riposte,
 * and Acrobatic Disengage's Disengage after a successful Defense.
 * Movement is otherwise a turn action, so the strip, the locked zone and the
 * drag caps ask isMovementTurn rather than isTrackedTurn, which lets these
 * steps show off-turn without opening Move and Sprint there.
 */
const OFF_TURN_MODES = new Set([
  "quickFeet",
  "passingReaction",
  "lungeStep",
  "halfPirouette",
  "acrobaticDisengage",
  "advance",
  // Krycí postoj's step into the line of fire (skirmisher.mjs).
  "coverStep",
]);

/**
 * Is this the turn-start default Move, still unpaid and switchable?
 *
 * @param {object|null} lock  from getMovementLock
 */
export function isArmedLock(lock) {
  return !!lock?.armed && !lock.done;
}

/**
 * Turn start (turnMovement.mjs): pre-declare a plain Move for the actor whose
 * turn it now is, as though the player had clicked it (user ruling
 * 2026-10-24). `lock` is the Move to arm, or null when the actor starts next
 * to an enemy and must pick a movement themselves.
 *
 * Nothing is charged here: the Action is paid by the first step
 * (noteMovement), so a turn spent standing still costs no movement. Picking
 * another mode from the strip replaces the armed lock (lockMovement).
 *
 * Only a lock left over from an off-turn step (Quick Feet and the like) gives
 * way, together with the `moved` mark it set; that step was free and never
 * this turn's movement. Any other lock, or a `moved` with no lock, means this
 * turn's movement already happened (the GM stepped back a turn), so it is
 * left alone.
 *
 * @param {Actor} actor
 * @param {{mode: string, budget: number, startSpent: number}|null} lock
 * @returns {Promise<boolean>} whether anything was written
 */
export async function armTurnMovement(actor, lock) {
  const combat = trackedCombat(actor);
  if (!combat || !isActorsTurn(actor, combat)) return false;
  const spent = getSpent(actor);
  const held = spent.movement;
  if (held && !OFF_TURN_MODES.has(held.mode)) return false;
  if (!held && spent.moved) return false;
  if (!held && !lock) return false;
  await writeSpent(actor, {
    ...spent,
    moved: false,
    movement: lock ? { ...lock, armed: true } : null,
  });
  return true;
}

/** Does this actor hold an unfinished off-turn step (Quick Feet and the like)? */
export function hasOffTurnStep(actor) {
  if (!trackedCombat(actor)) return false;
  const lock = getMovementLock(actor);
  return !!lock && OFF_TURN_MODES.has(lock.mode) && !lock.done;
}

/**
 * May this actor's movement lock be walked right now: its own turn, or an
 * off-turn step it has been granted.
 *
 * @param {Actor} actor
 */
export function isMovementTurn(actor) {
  return isTrackedTurn(actor) || hasOffTurnStep(actor);
}

/**
 * What one item costs this actor *right now*, reading its `system.actionCost`
 * and the current turn.
 *
 * @param {Actor} actor
 * @param {Item|{system: {actionCost: string, sustained?: boolean}}} item
 * @returns {{actions: number, reactions: number}} Zeroes when the item is free,
 *   carries no cost, or there is no encounter to spend in.
 */
export function costOf(actor, item) {
  const none = { actions: 0, reactions: 0 };
  const combat = trackedCombat(actor);
  if (!combat || !item) return none;

  const parsed = parseActionCost(
    item.system?.actionCost,
    item.system?.sustained,
  );
  const onTurn = isActorsTurn(actor, combat);

  // Off-turn and able to react: that is what the reaction is for, whatever
  // else the cost line also offers ("1 | Reaction" cast in someone else's
  // turn is the reaction reading of that spell).
  // Servant of the Sword: one Riposte per round is a Free action.
  if (isRiposte(item) && hasFreeRiposte(actor)) return none;
  if (parsed.reaction && !onTurn) return { actions: 0, reactions: 1 };
  // Dragon Guard: Exploit Weakness swung off-turn is a Retaliation action,
  // paid with the Reaction rather than its two Actions.
  if (!onTurn && isExploitAsRetaliation(actor, item)) {
    return { actions: 0, reactions: 1 };
  }

  // A pure reaction used on its own turn. The dialog already calls that out as
  // a timing mistake; charging it an invented action cost would not.
  if (parsed.reaction && parsed.actions === null) return none;

  const actions = Number(parsed.actions) || 0;
  return actions > 0 ? { actions, reactions: 0 } : none;
}

/**
 * Charge this actor for using `items` — one ability, a spell, or an ability
 * plus the attack modifiers ticked alongside it. Modifiers are free actions in
 * the pack, so they contribute nothing and the list can be passed whole.
 *
 * @param {Actor} actor
 * @param {Item|Item[]} items
 */
export async function spendForItems(actor, items) {
  const list = Array.isArray(items) ? items : [items];
  let actions = 0;
  let reactions = 0;
  let freeRiposte = false;
  // Forceful Advance (Hoplite): one listed ability costs no Action, once.
  const freeAbility = liveFreeAbility(actor);
  let freeAbilityUsed = false;
  // What the paid Actions were for, for the Aim rule below.
  const aimBreaks = [];
  for (const item of list) {
    // The free Riposte covers one use: a second Riposte in the same list (or
    // later this round) pays its Reaction.
    if (!freeRiposte && isRiposte(item) && hasFreeRiposte(actor)) {
      freeRiposte = true;
      continue;
    }
    if (
      !freeAbilityUsed &&
      freeAbility?.keys.includes(item?.system?.localizationKey)
    ) {
      freeAbilityUsed = true;
      continue;
    }
    const cost = costOf(actor, item);
    actions += cost.actions;
    reactions += cost.reactions;
    if (cost.actions > 0) {
      const kind = aimBreakKind(item);
      if (kind) aimBreaks.push(kind);
    }
  }
  if (freeRiposte) await markFreeRiposteUsed(actor);
  if (freeAbilityUsed) {
    await writeSpent(actor, {
      ...getSpent(actor),
      freeAbility: null,
      // A paired grant (Momentum's extra attack) was the free Attack too.
      ...(freeAbility.pairedAttack ? { freeAttack: null } : {}),
    });
  }
  await spend(actor, { actions, reactions });
  // "je použita jiná akce než útočná akce ... Míření propadá" (aim.mjs): an
  // Action paid for anything but an attack or an aiming action loses a normal
  // Aim (a Rest keeps a Respite holder's). Free actions and Reactions never
  // do. Here, before the caller runs the ability, so a grant the ability
  // makes (Respite's Aim after a Rest, Dragon Sleep's) lands after the loss.
  if (aimBreaks.length) {
    await breakAimOnAction(actor, {
      movement: aimBreaks.every((kind) => kind === "movement"),
      rest: aimBreaks.every((kind) => kind === "rest"),
    });
  }
}

/**
 * Charge for a plain weapon attack from the Attack Actions dialog, where no
 * ability item is involved. The book prices a weapon attack at 1 Action; an
 * attack declared as an Opportunity Attack is a reaction instead, and by
 * definition happens in somebody else's turn.
 *
 * @param {Actor} actor
 * @param {{opportunity?: boolean}} [options]
 */
export async function spendForAttack(actor, { opportunity = false } = {}) {
  const combat = trackedCombat(actor);
  if (!combat) return;
  if (opportunity && !isActorsTurn(actor, combat)) {
    await spend(actor, { reactions: 1 });
    return;
  }
  // Duelist's Advance with three Aim: this Attack is the Free action it buys.
  if (!opportunity && (await consumeFreeAttack(actor))) return;
  await spend(actor, { actions: 1 });
}

/**
 * Duelist's Advance: "Pokud má na cíli tři Míření, může ihned zaútočit jako
 * Volnou akci." The next plain weapon Attack this round costs no Action
 * (user ruling 2026-10-14: the plain Attack only, not attack abilities).
 * `targetId` names who it may be made at, for the hint; the tracker does not
 * enforce it.
 *
 * @param {Actor} actor
 * @param {string} targetId
 */
export async function grantFreeAttack(actor, targetId) {
  if (!targetId || !trackedCombat(actor)) return;
  await writeSpent(actor, { ...getSpent(actor), freeAttack: targetId });
}

/**
 * Rázný postup (Forceful Advance, Hoplite): "může jednou za kolo udělat Úder
 * štítem nebo Zteč štítem jako Volnou akci". The next use of any ability whose
 * localizationKey is in `keys` costs no Action, on the actor's turn or off
 * it, for the rest of the combat turn it was granted in. Consumed by
 * spendForItems (so through deductAbilityCost); the ability's Stamina is
 * still paid. One grant at a time: a new one replaces the old. `targetId` is
 * a hint only. Does not touch grantFreeAttack's token, unless `pairedAttack`
 * is set: then the grant and the free Attack are one extra attack (Předvoj,
 * Momentum: Speciální akce, momentum.mjs), and spending either one clears
 * the other (spendForItems, consumeFreeAttack).
 *
 * @param {Actor} actor
 * @param {{keys: string[], targetId?: string|null, pairedAttack?: boolean}} grant
 * @returns {Promise<boolean>} whether it was granted
 */
export async function grantFreeAbility(
  actor,
  { keys = [], targetId = null, pairedAttack = false } = {},
) {
  const combat = trackedCombat(actor);
  const grant = normaliseFreeAbility({
    keys,
    targetId,
    turn: combat?.turn,
    pairedAttack,
  });
  if (!combat || !grant) return false;
  await writeSpent(actor, { ...getSpent(actor), freeAbility: grant });
  return true;
}

/**
 * The free-ability grant still usable now (same combat turn), or null.
 *
 * @param {Actor} actor
 * @returns {{keys: string[], targetId: string|null, turn: number}|null}
 */
export function liveFreeAbility(actor) {
  const combat = trackedCombat(actor);
  const grant = combat ? getSpent(actor).freeAbility : null;
  if (!grant || grant.turn !== Number(combat.turn)) return null;
  return grant;
}

/**
 * Spend the free Attack if one is held. True when it was. A free-ability
 * grant paired with it (Momentum: Speciální akce) goes with it.
 */
async function consumeFreeAttack(actor) {
  const spent = getSpent(actor);
  if (!spent.freeAttack || !isTrackedTurn(actor)) return false;
  await writeSpent(actor, {
    ...spent,
    freeAttack: null,
    ...(spent.freeAbility?.pairedAttack ? { freeAbility: null } : {}),
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The round stamp already retires stale records, so there is nothing to clean
 * up for correctness. This clears the flag when an encounter is deleted purely
 * so actors do not carry a dead combat's id around in their flags forever.
 */
export function registerActionTrackerHooks() {
  /**
   * Movement, from wherever it came.
   *
   * `updateToken` rather than the drag handlers in documents/token.mjs, which
   * is where `movementSpent` is counted: those only see a drag that ends on the
   * canvas, and arrow keys, a nudge from a macro and anything a module moves
   * would all walk for free. Position is position however it changed.
   *
   * `userId` is the single-writer rule. The hook fires on every connected
   * client, and without it a player and the GM would both answer the same move.
   * Whoever actually performed it is the one who records it, and `isOwner`
   * inside `noteMovement`'s write is what stops that being a permission error.
   */
  /**
   * Where each token stood before an update this client made. A drag released
   * on the token's own hex still sends x/y, identical to the old ones, and
   * that must not read as a move. `preUpdateToken` runs on the updating client
   * only, which is the same client the `userId` guard below lets through.
   */
  const before = new Map();
  Hooks.on("preUpdateToken", (tokenDoc, changed) => {
    if (typeof changed?.x !== "number" && typeof changed?.y !== "number") return;
    before.set(tokenDoc.id, { x: tokenDoc.x, y: tokenDoc.y });
  });

  Hooks.on("updateToken", async (tokenDoc, changed, _options, userId) => {
    if (userId !== game.user.id) return;
    if (typeof changed?.x !== "number" && typeof changed?.y !== "number") return;
    const prev = before.get(tokenDoc.id);
    before.delete(tokenDoc.id);
    // Pushed, pulled or teleported (forcedMovement.mjs): spends no Action.
    if (isForcedMove(tokenDoc)) return;
    if (prev && prev.x === tokenDoc.x && prev.y === tokenDoc.y) return;
    const actor = tokenDoc?.actor;
    if (!actor?.isOwner) return;
    await noteMovement(actor);
  });

  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;
    for (const combatant of combat.combatants?.contents ?? []) {
      const actor = combatant.actor;
      if (!actor?.isOwner) continue;
      if (actor.getFlag(SYSTEM_ID, FLAG)) {
        await actor.unsetFlag(SYSTEM_ID, FLAG);
      }
    }
  });
}
