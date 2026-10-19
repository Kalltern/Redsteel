/**
 * Předvoj → Rozražení (Bull Charge), Vanguard batch 2.
 * Rulebook specializace-wip.md r529: "Rozražení · Volná akce · 2 výdrže ·
 * Modifikuje akci Zteč nebo Zteč s rozseknutím. Umožňuje ztečovat skrze
 * spojence (Který použije Reakci) a skrze nebo okolo nepřítele. Vyvolá versus
 * Test Síly, při neúspěchu je zastaven (Probíhání skrz nebo okolo) nebo
 * dostane Příležitostný útok a pokračuje (Probíhání okolo). Probíhání skrze
 * oponenta ho může povalit (Kritický úspěch)."
 *
 * User rulings 2026-10-19: full automation; every contest is rolled for both
 * sides at once when the route is committed (nobody waits on an answer); a
 * lost contest AROUND an enemy lets the charger pick: stop there, or run on
 * and that enemy gets an Opportunity Attack (offered to it as a chip).
 *
 * THE ITEM. "Bull Charge" is an attack modifier, legal only on Zteč (Charge,
 * Improved Charge, Pikeman charge) and Zteč s rozseknutím (Charge with
 * Cleave); Shield Charge is not a Zteč. combatAbilities.mjs refuses it on
 * anything else before anything is paid (bullChargeRefusal). Ticked on a
 * charge that declares its approach, it is paid right then (2 Stamina, a
 * Free action) and the charge lock is stamped `bullCharge: true`
 * (abilityMovement.mjs declareChargeMove, actionTracker.mjs lockMovement). The
 * swing that follows drops it from its modifiers, so it is never paid twice.
 * Ticked on a charge with no approach left (the turn's movement is used), it
 * is refused: there is no approach for it to modify.
 *
 * MOVEMENT. Under a Bull Charge lock the zone lets the route run
 * through enemy hexes (never end on one) and past enemies: entering an
 * enemy's reach no longer ends the move and the one-step-around rule is
 * lifted (movementZones.mjs computeMovementZone `bullCharge`). Like every
 * zone, that is display. What is enforced is here, on the moving client.
 * Allies are untouched: allyPassage.mjs still asks each one for its Reaction.
 *
 * ORDER OF EVENTS for one drag of a Bull Charge:
 *  1. preMoveToken (this file's hook, registered BEFORE allyPassage.mjs's, so
 *     it runs first and a cancel here stops allyPassage from asking anyone
 *     yet) reads the planned route: the origin plus the move's waypoints,
 *     expanded hex by hex along canvas.grid.getDirectPath (the ruler's line).
 *  2. A route ending on an enemy's hex is cancelled with a notice.
 *  3. The enemies the route meets are listed IN ROUTE ORDER: "through" = the
 *     route enters the enemy's hex (ordered by that step); "around" = the
 *     route steps into a hex next to the enemy and later steps out of the
 *     ring again without ending the move in it (ordered by the step in),
 *     never the charge's own target. Living, on the other side
 *     (movementZones.mjs isHostileSide), not hidden, and not already
 *     contested in this charge (`contested` on the lock). None left: the move
 *     goes on untouched (allyPassage.mjs runs next).
 *  4. Otherwise the move is cancelled (return false) and the contests run on
 *     this client, one after another in route order. Each: the charger's
 *     Strength Test (resolveTestRating, versus bonuses included) against the
 *     enemy's better of Strength and Dexterity (attribute rating plus
 *     testRating.mjs versusTestBonus), both rolled with the actors' own roll
 *     bias. The higher margin wins, a dead tie goes to the charger (house
 *     rule: tie to the attacker). One chat card per contest.
 *       - through, won: go on. A Critical Success on the charger's die
 *         knocks the enemy Prone (directly, or through the active GM).
 *       - through, lost: the route is cut at the last hex before that
 *         enemy's hex. Nothing further is contested.
 *       - around, won: go on.
 *       - around, lost: the charger is asked. Stop: the route is cut at the
 *         last hex before the step into that enemy's ring. Continue: go on,
 *         and the enemy is offered an Opportunity Attack on the charger for
 *         that turn (a hotbar chip, its Reaction paid as usual).
 *     A cut end that lands on another token steps back to a free hex.
 *  5. Every enemy contested is written to the lock's `contested` list
 *     (actionTracker.mjs noteBullChargeContested), and only then is the
 *     route (whole, or cut) re-issued with TokenDocument#move.
 *  6. The re-issued move comes back through preMoveToken: nothing is left to
 *     contest, so this hook lets it pass and allyPassage.mjs asks any ally on
 *     the (possibly cut) route for its Reaction, exactly as for any move.
 *
 * A forced move (push, pull) never contests. Outside a started combat, or
 * off the charger's own turn, nothing happens.
 */

import {
  getActionPools,
  getMovementLock,
  getSpent,
  isTrackedTurn,
  noteBullChargeContested,
} from "./actionTracker.mjs";
import { isForcedMove } from "./forcedMoveRegistry.mjs";
import { isHostileSide } from "./movementZones.mjs";
import { isCharge } from "./abilityMovement.mjs";
import { resolveTestRating, versusTestBonus } from "./testRating.mjs";
import {
  forfeitAdvantageOnCritFail,
  tagRollSkill,
  withRollBias,
} from "./rollAdvantage.mjs";

const SYSTEM_ID = "redsteel";
const SOCKET = "system.redsteel";
const MSG_PRONE = "bullChargeProne";
const MSG_OPPORTUNITY = "bullChargeOpportunity";

/** Bull Charge, by localisation key. */
export const BULL_CHARGE_KEY = "REDSTEEL.Items.BullCharge.name";

/** Shield Charge is a charge but not a Zteč. */
const SHIELD_CHARGE_KEYS = new Set([
  "REDSTEEL.Items.ShieldCharge.name",
  "REDSTEEL.Items.ShieldChargeSmallShield.name",
]);
const SHIELD_CHARGE_NAMES = new Set(["Shield Charge", "Shield Charge (small shield)"]);

/** These never block, contest or get contested. */
const FALLEN_STATUSES = ["dead", "dying", "downed", "unconscious"];

/** Actor flag on the enemy: the Opportunity Attack a lost "around" earned. */
const OPPORTUNITY_FLAG = "bullChargeOpportunity";

/** Mover token ids with contests running, so a second drag does not stack. */
const busy = new Set();

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.BullCharge.${key}`, data)
    : game.i18n.localize(`REDSTEEL.BullCharge.${key}`);

/* -------------------------------------------- */
/*  The modifier                                */
/* -------------------------------------------- */

/** Is this the Bull Charge modifier (by key, or the pack's English name)? */
export function isBullCharge(item) {
  return (
    item?.system?.localizationKey === BULL_CHARGE_KEY ||
    item?.name === "Bull Charge"
  );
}

/** Zteč or Zteč s rozseknutím: a charge that is not a Shield Charge. */
export function isBullChargeable(ability) {
  if (!isCharge(ability)) return false;
  return !(
    SHIELD_CHARGE_KEYS.has(ability?.system?.localizationKey) ||
    SHIELD_CHARGE_NAMES.has(ability?.name)
  );
}

/** Is this actor's round movement a Bull Charge approach? */
export function hasBullChargeLock(actor) {
  const lock = getMovementLock(actor);
  return lock?.mode === "charge" && !!lock.bullCharge && !lock.bonus;
}

/**
 * Why Bull Charge cannot ride on this ability now, localized, or null.
 * Asked before anything is paid.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {{declaring: boolean}} options  whether this pick declares the
 *   charge's approach (abilityMovement.mjs chargeWouldDeclare)
 */
export function bullChargeRefusal(actor, ability, { declaring = false } = {}) {
  if (!isBullChargeable(ability)) return L("NotACharge");
  if (declaring) return null;
  // The swing after the approach: Bull Charge was paid with it.
  if (hasBullChargeLock(actor)) return null;
  return L("NoApproach");
}

/* -------------------------------------------- */
/*  The route                                   */
/* -------------------------------------------- */

const keyOf = (o) => `${o.i},${o.j}`;

/** Canvas centre of a waypoint or position (top-left x/y, size in spaces). */
function centreOf(position, tokenDoc) {
  const width = Number(position?.width ?? tokenDoc.width) || 1;
  const height = Number(position?.height ?? tokenDoc.height) || 1;
  return {
    x: position.x + (width * canvas.grid.sizeX) / 2,
    y: position.y + (height * canvas.grid.sizeY) / 2,
  };
}

/** The same fields back into a waypoint for TokenDocument#move. */
function copyWaypoint(w) {
  const out = { x: w.x, y: w.y };
  for (const key of ["elevation", "width", "height", "action", "snapped", "explicit", "checkpoint"]) {
    if (w[key] !== undefined) out[key] = w[key];
  }
  return out;
}

/** The route's hexes, origin first, consecutive repeats dropped. */
function routeHexes(points) {
  const out = [];
  for (const step of canvas.grid.getDirectPath(points)) {
    if (out.length && keyOf(out[out.length - 1]) === keyOf(step)) continue;
    out.push({ i: step.i, j: step.j });
  }
  return out;
}

/** Living, standing enemies of the mover, with their hex and ring. */
function enemiesOf(tokenDoc) {
  const scene = tokenDoc.parent;
  if (!scene) return [];
  const mySide = isHostileSide(tokenDoc);
  const list = [];
  for (const other of scene.tokens.contents) {
    if (other.id === tokenDoc.id || other.hidden) continue;
    if (isHostileSide(other) === mySide) continue;
    const statuses = other.actor?.statuses;
    if (statuses && FALLEN_STATUSES.some((s) => statuses.has(s))) continue;
    const center = other.object?.center;
    if (!center) continue;
    const at = canvas.grid.getOffset(center);
    list.push({
      doc: other,
      key: keyOf(at),
      ring: new Set(canvas.grid.getAdjacentOffsets(at).map(keyOf)),
    });
  }
  return list;
}

/**
 * What a route meets. `path` is the route's hexes (origin at 0);
 * `encounters` the enemies to contest, in route order, each with the path
 * index of the step that counts (into its hex for "through", into its ring
 * for "around"); `endsOnEnemy` whether the last hex is an enemy's.
 *
 * @param {TokenDocument} tokenDoc
 * @param {{x: number, y: number}[]} points  canvas points, origin first
 * @param {object} lock  the charge lock
 */
export function planRoute(tokenDoc, points, lock) {
  const path = routeHexes(points);
  const keys = path.map(keyOf);
  const last = keys.length - 1;
  const contested = new Set(lock.contested ?? []);
  const targetId = chargeTargetId(lock);
  const encounters = [];
  let endsOnEnemy = false;

  for (const enemy of enemiesOf(tokenDoc)) {
    if (last >= 1 && keys[last] === enemy.key) endsOnEnemy = true;
    if (contested.has(enemy.doc.id)) continue;

    const through = keys.findIndex((k, i) => i >= 1 && i < last && k === enemy.key);
    if (through >= 1) {
      encounters.push({ kind: "through", index: through, doc: enemy.doc });
      continue;
    }
    if (enemy.doc.id === targetId) continue;
    // "around": a step into the ring, a later step out of it, and the move
    // does not end in the ring.
    if (enemy.ring.has(keys[last])) continue;
    for (let i = 1; i < last; i++) {
      if (!enemy.ring.has(keys[i]) || enemy.ring.has(keys[i - 1])) continue;
      encounters.push({ kind: "around", index: i, doc: enemy.doc });
      break;
    }
  }
  encounters.sort((a, b) => a.index - b.index);
  return { path, encounters, endsOnEnemy };
}

/** The charge's own target: the lock's, else this user's one target. */
function chargeTargetId(lock) {
  if (lock?.launch?.targetId) return lock.launch.targetId;
  const targets = [...(game.user?.targets ?? [])];
  return targets.length === 1 ? targets[0].id : null;
}

/** Hexes another token stands on, for a cut route's end. */
function occupiedKeys(tokenDoc) {
  const out = new Set();
  for (const other of tokenDoc.parent?.tokens.contents ?? []) {
    if (other.id === tokenDoc.id || other.hidden) continue;
    const center = other.object?.center;
    if (center) out.add(keyOf(canvas.grid.getOffset(center)));
  }
  return out;
}

/**
 * The route cut to end on path index `cut` (or earlier, on the nearest free
 * hex before it), as one waypoint per hex. Empty when the token would not
 * move at all.
 */
function cutWaypoints(tokenDoc, path, cut, original) {
  const occupied = occupiedKeys(tokenDoc);
  let end = Math.min(cut, path.length - 1);
  while (end > 0 && occupied.has(keyOf(path[end]))) end--;
  if (end <= 0) return [];
  const tail = original[original.length - 1] ?? {};
  const width = Number(tokenDoc.width) || 1;
  const height = Number(tokenDoc.height) || 1;
  const out = [];
  for (let n = 1; n <= end; n++) {
    const c = canvas.grid.getCenterPoint(path[n]);
    const w = {
      x: Math.round(c.x - (width * canvas.grid.sizeX) / 2),
      y: Math.round(c.y - (height * canvas.grid.sizeY) / 2),
    };
    if (tail.elevation !== undefined) w.elevation = tail.elevation;
    if (tail.action !== undefined) w.action = tail.action;
    out.push(w);
  }
  return out;
}

/* -------------------------------------------- */
/*  The contest                                 */
/* -------------------------------------------- */

function attributeLabel(key) {
  const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
  const path = `REDSTEEL.Actor.Character.Attribute.${capitalized}.long`;
  const localized = game.i18n.localize(path);
  return localized === path ? key : localized;
}

/** Roll `chance - 1d100` for an actor's attribute, with its roll bias. */
async function rollSide(actor, key, chance) {
  const roll = new Roll(`(${chance}) - 1d100`, withRollBias({}, actor));
  tagRollSkill(roll, key);
  await roll.evaluate();
  const attr = actor.system?.attributes?.[key];
  forfeitAdvantageOnCritFail(roll, attr?.criticalFailureThreshold);
  const d100 = roll.dice?.[0]?.total ?? null;
  const crit =
    d100 !== null &&
    attr?.criticalSuccessThreshold != null &&
    d100 <= attr.criticalSuccessThreshold;
  return { roll, key, chance, d100, margin: roll.total, crit };
}

/**
 * The charger's Strength against the enemy's better of Strength and
 * Dexterity. Tie to the charger.
 */
async function rollContest(charger, enemy) {
  const { value } = resolveTestRating(charger, "strength");
  const mine = await rollSide(charger, "str", Number(value) || 0);

  let best = null;
  for (const key of ["str", "dex"]) {
    const attr = enemy.system?.attributes?.[key];
    if (!attr) continue;
    const rating = (Number(attr.mod) || 0) + versusTestBonus(enemy, key);
    if (!best || rating > best.rating) best = { key, rating };
  }
  const theirs = best
    ? await rollSide(enemy, best.key, best.rating)
    : { key: "str", chance: 0, d100: null, margin: -Infinity, crit: false };
  return { mine, theirs, won: mine.margin >= theirs.margin };
}

function sideLine(name, side) {
  return L("Side", {
    name: esc(name),
    attribute: esc(attributeLabel(side.key)),
    chance: side.chance,
    roll: side.d100 ?? "-",
    margin: Number.isFinite(side.margin) ? side.margin : "-",
  });
}

async function postContest(tokenDoc, enemyDoc, kind, contest, outcomeKey) {
  const names = {
    charger: esc(tokenDoc.name),
    enemy: esc(enemyDoc.name),
  };
  const title = L(kind === "through" ? "TitleThrough" : "TitleAround", names);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: tokenDoc.actor, token: tokenDoc }),
    content: `<p class="rs-card-headline"><b>${title}</b></p>
<p style="text-align:center;">${sideLine(tokenDoc.name, contest.mine)}</p>
<p style="text-align:center;">${sideLine(enemyDoc.name, contest.theirs)}</p>
<p style="text-align:center;"><b>${L(outcomeKey, names)}</b></p>`,
  });
}

/** Lost around an enemy: stop, or run on and give it an Opportunity Attack. */
async function askStopOrContinue(enemyDoc) {
  try {
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: L("PromptTitle") },
      classes: ["redsteel"],
      position: { width: 380 },
      content: `<p>${L("PromptBody", { enemy: `<b>${esc(enemyDoc.name)}</b>` })}</p>`,
      buttons: [
        { action: "stop", label: L("Stop"), icon: "fas fa-hand", default: true },
        { action: "continue", label: L("Continue"), icon: "fas fa-person-running" },
      ],
      rejectClose: false,
    });
    return choice === "continue" ? "continue" : "stop";
  } catch (_err) {
    return "stop";
  }
}

/* -------------------------------------------- */
/*  Effects on the enemy (GM relay)             */
/* -------------------------------------------- */

function relay(type, data) {
  if (!game.users.activeGM) {
    ui.notifications.warn(L("NoGM"));
    return;
  }
  game.socket.emit(SOCKET, { type, ...data });
}

async function knockProne(enemyDoc) {
  const actor = enemyDoc.actor;
  if (!actor || actor.statuses?.has("prone")) return;
  if (actor.isOwner) {
    await game.redsteel.applyEffect(actor, "prone");
    return;
  }
  relay(MSG_PRONE, { sceneId: enemyDoc.parent?.id, tokenId: enemyDoc.id });
}

function opportunityStamp(chargerDoc) {
  const combat = game.combat;
  return {
    combat: combat.id,
    round: combat.round,
    turn: combat.turn,
    tokenId: chargerDoc.id,
    at: Date.now(),
  };
}

async function offerOpportunity(enemyDoc, chargerDoc) {
  const actor = enemyDoc.actor;
  if (!actor || !game.combat?.started) return;
  const stamp = opportunityStamp(chargerDoc);
  if (actor.isOwner) {
    await actor.setFlag(SYSTEM_ID, OPPORTUNITY_FLAG, stamp);
    return;
  }
  relay(MSG_OPPORTUNITY, {
    sceneId: enemyDoc.parent?.id,
    tokenId: enemyDoc.id,
    stamp,
  });
}

async function handleGM(data) {
  if (!game.users.activeGM?.isSelf) return;
  const tokenDoc = game.scenes.get(data.sceneId)?.tokens.get(data.tokenId);
  const actor = tokenDoc?.actor;
  if (!actor) return;
  if (data.type === MSG_PRONE) {
    if (!actor.statuses?.has("prone")) {
      await game.redsteel.applyEffect(actor, "prone");
    }
  } else if (data.type === MSG_OPPORTUNITY && data.stamp) {
    await actor.setFlag(SYSTEM_ID, OPPORTUNITY_FLAG, data.stamp);
  }
}

/**
 * The Opportunity Attack a lost "around" contest earned this actor, while it
 * is the same combat turn and the actor has not yet posted an Opportunity
 * Attack since: {tokenId} of the charger, or null. Read by the hotbar
 * (actionSuggestions.mjs), which also checks the Reaction.
 *
 * @param {Actor} actor
 * @returns {{tokenId: string}|null}
 */
export function pendingBullChargeOpportunity(actor) {
  const combat = game.combat;
  if (!combat?.started) return null;
  const t = actor?.getFlag?.(SYSTEM_ID, OPPORTUNITY_FLAG);
  if (
    !t ||
    t.combat !== combat.id ||
    Number(t.round) !== Number(combat.round) ||
    Number(t.turn) !== Number(combat.turn)
  ) {
    return null;
  }
  // Answered once this actor has posted an Opportunity Attack since the
  // stamp. Matched by token first: an unlinked NPC's speaker carries the base
  // actor's id, which every copy of that NPC shares (overwatch.mjs pattern).
  const tokenIds = new Set(
    actor.isToken
      ? [actor.token?.id]
      : actor.getActiveTokens(false, true).map((d) => d.id),
  );
  const messages = game.messages?.contents ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if ((message.timestamp ?? 0) < t.at) break;
    const tags = message.flags?.redsteel?.attackTags;
    if (!Array.isArray(tags) || !tags.includes("opportunity")) continue;
    const speaker = message.speaker ?? {};
    if (speaker.token ? tokenIds.has(speaker.token) : speaker.actor === actor.id) {
      return null;
    }
  }
  return { tokenId: t.tokenId };
}

/** Has this actor a Reaction left this round? */
export function hasReactionLeft(actor) {
  return getSpent(actor).reactions < getActionPools(actor).reactions;
}

/* -------------------------------------------- */
/*  The flow                                    */
/* -------------------------------------------- */

/**
 * Run the contests of one cancelled route in order (step 4 above), note them
 * on the lock (step 5) and re-issue the route, whole or cut.
 */
async function resolveRoute(tokenDoc, plan, waypoints) {
  busy.add(tokenDoc.id);
  try {
    const actor = tokenDoc.actor;
    const contested = [];
    let cut = null;
    for (const encounter of plan.encounters) {
      const enemyDoc = encounter.doc;
      const enemy = enemyDoc.actor;
      if (!enemy) continue;
      contested.push(enemyDoc.id);
      const contest = await rollContest(actor, enemy);

      if (encounter.kind === "through") {
        if (contest.won) {
          if (contest.mine.crit) await knockProne(enemyDoc);
          await postContest(
            tokenDoc,
            enemyDoc,
            "through",
            contest,
            contest.mine.crit ? "ThroughWinProne" : "ThroughWin",
          );
          continue;
        }
        await postContest(tokenDoc, enemyDoc, "through", contest, "ThroughLose");
        cut = encounter.index - 1;
        break;
      }

      if (contest.won) {
        await postContest(tokenDoc, enemyDoc, "around", contest, "AroundWin");
        continue;
      }
      const choice = await askStopOrContinue(enemyDoc);
      if (choice === "stop") {
        await postContest(tokenDoc, enemyDoc, "around", contest, "AroundStopped");
        cut = encounter.index - 1;
        break;
      }
      await postContest(tokenDoc, enemyDoc, "around", contest, "AroundContinued");
      await offerOpportunity(enemyDoc, tokenDoc);
    }

    await noteBullChargeContested(actor, contested);
    const route =
      cut === null
        ? waypoints
        : cutWaypoints(tokenDoc, plan.path, cut, waypoints);
    // Clear the in-flight mark BEFORE re-issuing: the preMoveToken hook
    // cancels any move of a busy token, and this re-issue is one of them.
    // Every enemy on the route is now on the lock as contested, so the hook
    // lets it through without contesting again.
    busy.delete(tokenDoc.id);
    if (route.length) await tokenDoc.move(route);
  } catch (err) {
    console.error("Redsteel | Bull Charge failed", err);
  } finally {
    busy.delete(tokenDoc.id);
  }
}

/**
 * Registered once at init, BEFORE registerAllyPassage (redsteel.mjs), so on a
 * Bull Charge this hook decides first (see the order above).
 */
export function registerBullChargeHooks() {
  Hooks.on("preMoveToken", (tokenDoc, movement) => {
    if (!game.combat?.started) return;
    if (isForcedMove(tokenDoc)) return;
    const actor = tokenDoc.actor;
    if (!actor || !isTrackedTurn(actor)) return;
    const lock = getMovementLock(actor);
    if (lock?.mode !== "charge" || !lock.bullCharge || lock.bonus) return;
    if (lock.done || lock.stopped) return;

    // The route of THIS move, as allyPassage.mjs reads it.
    const origin = movement?.origin;
    const waypoints = [
      ...(movement?.passed?.waypoints ?? []),
      ...(movement?.pending?.waypoints ?? []),
    ].filter((w, i) => !(i === 0 && origin && w.x === origin.x && w.y === origin.y));
    if (!origin || !waypoints.length) return;
    if (busy.has(tokenDoc.id)) return false;

    const points = [
      centreOf(origin, tokenDoc),
      ...waypoints.map((w) => centreOf(w, tokenDoc)),
    ];
    const plan = planRoute(tokenDoc, points, lock);
    if (plan.endsOnEnemy) {
      ui.notifications.warn(L("EndsOnEnemy"));
      return false;
    }
    if (!plan.encounters.length) return;

    resolveRoute(tokenDoc, plan, waypoints.map(copyWaypoint));
    return false;
  });

  Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
      if (data?.type !== MSG_PRONE && data?.type !== MSG_OPPORTUNITY) return;
      handleGM(data).catch((err) =>
        console.error("Redsteel | Bull Charge relay failed", err),
      );
    });
  });
}
