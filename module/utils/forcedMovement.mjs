/**
 * Forced movement: anything that moves a token the token did not choose to
 * walk. Pushes, pulls, slides, swaps and teleports all come through here, so a
 * spell or ability only has to say WHAT happens and never re-derives the grid
 * geometry, the collision rule or the movement-hook exemptions.
 *
 * Every entry point runs on a GM client (the target is rarely owned by whoever
 * caused the move). Anyone else goes through `requestForcedMovement`, which
 * relays the same payload over the system socket.
 *
 * The primitives:
 *
 * - `pushToken`    straight line away from a point (Shield Bash, a blast).
 * - `pullToken`    straight line toward a point, stopping in front of it.
 * - `slideToken`   straight line along a bearing, independent of any source.
 * - `swapTokens`   two tokens trade hexes (replacement spells).
 * - `teleportToken` a token is placed on a hex without travelling there.
 *
 * Straight-line moves go hex by hex. A step is refused by a movement wall
 * (closed doors included), by the edge of the scene, or by another token
 * standing in the next hex; the mover stops where it is and that is a
 * COLLISION. Everyone who collided (the mover, plus the token it hit, if any)
 * takes the collision damage, `1d8` ignoring armor by default, posted as one
 * card and applied through the ordinary Apply Damage pipeline so temporary
 * health, shields and Dying all behave as for any other hit.
 *
 * Dead tokens do not block: a corpse is on the floor, not in the way. A
 * Rooted token (IMMOVABLE_STATUSES) is not moved at all.
 *
 * A forced move never turns the token (`autoRotate: false`), never counts
 * against the moved token's own movement, never charges its Action and never
 * asks an ally for passage. Those hooks ask `isForcedMove` before they act.
 *
 * Known simplification: the moved token and any blocker are read from their
 * centre hex, the same way positioning.mjs reads reach, so a multi-hex body is
 * treated as standing on one hex.
 */

// Circular with applyDamage.mjs (it calls resolvePushOnHit); both sides only
// touch the other's exports at call time, never while the modules evaluate.
import { applyDamageAsGM, SOCKET } from "./applyDamage.mjs";
import { withForcedFlag } from "./forcedMoveRegistry.mjs";
// Circular too (hoplite.mjs reads versusOutcome); call time only.
import { offerHopliteOnslaught } from "./hoplite.mjs";

/**
 * Statuses that pin a token in place: pushes, pulls and slides leave it where
 * it stands (no movement, no collision). Rooted covers Impale too, which
 * reuses the Rooted effect. Swap and teleport are not gated; whether magic
 * can lift a rooted body is the calling spell's rule.
 */
export const IMMOVABLE_STATUSES = Object.freeze(["root"]);

/** Is this token pinned against straight-line forced movement? */
export function isImmovable(tokenDoc) {
  const statuses = tokenDoc?.actor?.statuses;
  return !!statuses && IMMOVABLE_STATUSES.some((id) => statuses.has(id));
}

/** Collision damage when a caller does not name its own. */
export const DEFAULT_COLLISION_DAMAGE = "1d8";

/** Penetration 100 is "ignores armor" (combatSkillBonuses ARMOR_IGNORING_PENETRATION). */
const ARMOR_IGNORING_PENETRATION = 100;

const SOCKET_TYPE = "forcedMovement";

/* -------------------------------------------- */
/*  GEOMETRY                                    */
/* -------------------------------------------- */

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

function signedDelta(a, b) {
  const d = normalizeDeg(a - b);
  return d > 180 ? d - 360 : d;
}

function bearing(from, to) {
  return normalizeDeg((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

/** A token's centre from its document footprint, placeable or not. */
function centerOfDoc(doc) {
  const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
  const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
  // Stored position, not the live one: the live x/y trail the movement
  // animation, which stalls while the GM's Foundry tab is in the background,
  // and a chained push would then test the wrong hexes for blockers.
  return {
    x: Number(doc._source?.x ?? doc.x) + (Number(doc.width ?? 1) * sizeX) / 2,
    y: Number(doc._source?.y ?? doc.y) + (Number(doc.height ?? 1) * sizeY) / 2,
  };
}

/** A point, a Token, or a TokenDocument, as a canvas point. */
function pointOf(source) {
  if (!source) return null;
  if (typeof source.x === "number" && typeof source.y === "number" && !source.documentName && !source.document) {
    return { x: source.x, y: source.y };
  }
  const doc = source.document ?? source;
  return centerOfDoc(doc);
}

/**
 * The neighbouring hex of `center` that lies most nearly along `heading`.
 * Asked of the grid (getAdjacentOffsets) so it works on every hex parity and
 * on square grids alike.
 *
 * @returns {{i:number, j:number, center:{x:number,y:number}}|null}
 */
function neighbourToward(center, heading) {
  const grid = canvas.grid;
  const origin = grid.getOffset({ x: center.x, y: center.y });
  let best = null;
  let bestDelta = Infinity;
  for (const offset of grid.getAdjacentOffsets(origin) ?? []) {
    const c = grid.getCenterPoint(offset);
    const delta = Math.abs(signedDelta(bearing(center, c), heading));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = { i: offset.i, j: offset.j, center: c };
    }
  }
  return best;
}

function sameHex(a, b) {
  const grid = canvas.grid;
  const oa = grid.getOffset(a);
  const ob = grid.getOffset(b);
  return oa.i === ob.i && oa.j === ob.j;
}

function isDeadToken(doc) {
  return doc.actor?.effects?.some((e) => e.statuses?.has("dead")) === true;
}

/** The living token (other than those excluded) standing on the hex at `point`. */
function occupantAt(scene, point, excludeIds) {
  return (
    scene.tokens.contents.find(
      (t) => !excludeIds.has(t.id) && !isDeadToken(t) && sameHex(centerOfDoc(t), point),
    ) ?? null
  );
}

function outsideScene(point) {
  const rect = canvas.dimensions?.sceneRect;
  return !!rect && !rect.contains(point.x, point.y);
}

/** Does a movement wall stand between the two centres? */
function wallBetween(tokenDoc, from, to) {
  const token = tokenDoc.object;
  if (!token?.checkCollision) return false;
  return !!token.checkCollision(to, { origin: from, type: "move", mode: "any" });
}

/* -------------------------------------------- */
/*  STRAIGHT-LINE MOVES                         */
/* -------------------------------------------- */

/**
 * Walk a token `distance` hexes along `heading`, stopping at the first refused
 * step. The heading is re-read per step from the current hex, so a push that
 * starts off-axis settles onto a grid line instead of zig-zagging.
 *
 * @param {TokenDocument} tokenDoc
 * @param {object} opts
 * @param {number} opts.heading        screen-space bearing in degrees
 * @param {number} opts.distance       hexes
 * @param {{x:number,y:number}} [opts.stopBefore]  a pull stops next to this
 * @param {boolean} [opts.collide=true]
 * @param {string}  [opts.collisionDamage]
 * @param {string}  [opts.label]       card title
 * @param {Actor}   [opts.sourceActor] who caused it (card speaker)
 * @returns {Promise<{moved:number, collision:object|null}>}
 */
async function moveAlongHeading(tokenDoc, opts) {
  const {
    heading,
    distance = 1,
    stopBefore = null,
    collide = true,
    collisionDamage = DEFAULT_COLLISION_DAMAGE,
    label = "",
    sourceActor = null,
  } = opts;
  const scene = tokenDoc.parent;
  if (isImmovable(tokenDoc)) {
    ui.notifications.info(
      game.i18n.format("REDSTEEL.ForcedMovement.Rooted", { name: tokenDoc.name }),
    );
    return { moved: 0, collision: null };
  }
  if (!canvas?.ready || canvas.scene?.id !== scene?.id) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.ForcedMovement.WrongScene"));
    return { moved: 0, collision: null };
  }

  const start = centerOfDoc(tokenDoc);
  const path = [];
  let current = start;
  let collision = null;
  const exclude = new Set([tokenDoc.id]);

  for (let step = 0; step < distance; step++) {
    const next = neighbourToward(current, heading);
    if (!next) break;
    if (stopBefore && sameHex(next.center, stopBefore)) break;

    if (outsideScene(next.center) || wallBetween(tokenDoc, current, next.center)) {
      collision = { kind: "wall", blocker: null };
      break;
    }
    const blocker = occupantAt(scene, next.center, exclude);
    if (blocker) {
      collision = { kind: "token", blocker };
      break;
    }
    path.push(next.center);
    current = next.center;
  }

  if (path.length) await placeAlong(tokenDoc, start, path);

  if (collision && collide) {
    const victims = [tokenDoc, collision.blocker].filter(Boolean);
    await dealCollisionDamage(scene, victims, {
      formula: collisionDamage,
      label,
      sourceActor,
      mover: tokenDoc,
      blocker: collision.blocker,
    });
  }

  return { moved: path.length, collision };
}

/**
 * Move the token through `path` (hex centres) without turning it. Waypoints are
 * the document's top-left shifted by the centre delta, so a token larger than
 * one hex keeps its footprint.
 */
async function placeAlong(tokenDoc, start, path, { teleport = false } = {}) {
  const singleHex = Number(tokenDoc.width ?? 1) === 1 && Number(tokenDoc.height ?? 1) === 1;
  const waypoints = path.map((c) => {
    // A one-hex token lands on the grid's own top-left for that hex, exactly
    // where a drag would snap it; hex centres are fractional, and rounding a
    // shifted corner drifts the token off its cell.
    const corner = singleHex ? canvas.grid.getTopLeftPoint(canvas.grid.getOffset(c)) : null;
    const w = corner
      ? { x: corner.x, y: corner.y }
      : {
          x: Math.round(Number(tokenDoc._source?.x ?? tokenDoc.x) + (c.x - start.x)),
          y: Math.round(Number(tokenDoc._source?.y ?? tokenDoc.y) + (c.y - start.y)),
        };
    // Core's "displace" action places without travelling. Only used when this
    // Foundry build defines it; otherwise the token slides there.
    if (teleport && CONFIG.Token?.movement?.actions?.displace) w.action = "displace";
    return w;
  });
  return withForcedFlag(tokenDoc, () =>
    tokenDoc.move(waypoints, {
      autoRotate: false,
      showRuler: false,
      constrainOptions: { ignoreWalls: true, ignoreCost: true },
    }),
  );
}

/**
 * Push a token straight away from `from` (a token or a point).
 *
 * @param {TokenDocument} tokenDoc
 * @param {Token|TokenDocument|{x:number,y:number}} from
 * @param {object} [opts]  distance, collide, collisionDamage, label, sourceActor
 */
export async function pushToken(tokenDoc, from, opts = {}) {
  const origin = pointOf(from);
  const here = centerOfDoc(tokenDoc);
  if (!origin || (origin.x === here.x && origin.y === here.y)) {
    return { moved: 0, collision: null };
  }
  return moveAlongHeading(tokenDoc, { ...opts, heading: bearing(origin, here) });
}

/**
 * Pull a token straight toward `toward`, stopping on the hex next to it.
 */
export async function pullToken(tokenDoc, toward, opts = {}) {
  const target = pointOf(toward);
  const here = centerOfDoc(tokenDoc);
  if (!target || sameHex(target, here)) return { moved: 0, collision: null };
  return moveAlongHeading(tokenDoc, {
    ...opts,
    heading: bearing(here, target),
    stopBefore: target,
  });
}

/**
 * Slide a token along a fixed bearing (degrees, screen space: 0 = east,
 * 90 = south).
 */
export async function slideToken(tokenDoc, heading, opts = {}) {
  return moveAlongHeading(tokenDoc, { ...opts, heading: normalizeDeg(heading) });
}

/* -------------------------------------------- */
/*  REPLACEMENTS                                */
/* -------------------------------------------- */

/** Two tokens trade places. No collision: each lands where the other stood. */
export async function swapTokens(a, b) {
  if (!a || !b || a.parent?.id !== b.parent?.id) return false;
  const ca = centerOfDoc(a);
  const cb = centerOfDoc(b);
  await Promise.all([
    placeAlong(a, ca, [cb], { teleport: true }),
    placeAlong(b, cb, [ca], { teleport: true }),
  ]);
  return true;
}

/**
 * Put a token on the hex at `point` without travelling there. Refuses an
 * occupied hex or one off the scene, and returns false: what to do then
 * (fizzle, pick again, collide) is the calling spell's rule, not this one's.
 * `ignoreIds` names tokens the caller knows have just left that hex (their
 * stored position moved, the canvas animation may still be catching up).
 */
export async function teleportToken(tokenDoc, point, { ignoreIds = [] } = {}) {
  const scene = tokenDoc.parent;
  const dest = canvas.grid.getCenterPoint(canvas.grid.getOffset(point));
  if (outsideScene(dest)) return false;
  if (occupantAt(scene, dest, new Set([tokenDoc.id, ...ignoreIds]))) return false;
  await placeAlong(tokenDoc, centerOfDoc(tokenDoc), [dest], { teleport: true });
  return true;
}

/* -------------------------------------------- */
/*  COLLISION DAMAGE                            */
/* -------------------------------------------- */

/**
 * Roll the collision once and apply it to every collided token. The card has
 * the same `flags.attack` shape as environmental damage (`type:
 * "environment"`, so no Defend button, no Overwhelm, no attacker perks) and is
 * applied straight away; `autoApplied` hides its Apply Damage button so it
 * cannot be landed twice.
 */
async function dealCollisionDamage(scene, victims, { formula, label, sourceActor, mover, blocker }) {
  const roll = new Roll(formula || DEFAULT_COLLISION_DAMAGE);
  await roll.evaluate();
  const damage = Math.max(0, Math.floor(roll.total));

  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const title = label
    ? game.i18n.format("REDSTEEL.ForcedMovement.CollisionTitleFrom", { source: label })
    : game.i18n.localize("REDSTEEL.ForcedMovement.CollisionTitle");
  const line = blocker
    ? game.i18n.format("REDSTEEL.ForcedMovement.HitToken", {
        name: esc(mover.name),
        other: esc(blocker.name),
      })
    : game.i18n.format("REDSTEEL.ForcedMovement.HitWall", { name: esc(mover.name) });

  const flavor = `
<div style="display:flex; align-items:center; gap:8px; font-weight:bold;">
  <i class="fa-solid fa-person-falling-burst" style="font-size:28px;"></i>
  <span>${esc(title)}</span>
</div>
<hr>
<p style="text-align:center;">${line}</p>
<p style="text-align:center;">${game.i18n.format("REDSTEEL.ForcedMovement.CollisionDamage", {
    damage,
    targets: victims.map((v) => esc(v.name)).join(", "),
  })}</p>`;

  const message = await ChatMessage.create({
    // Never the source actor itself: Apply Damage would read the collision as
    // that actor's attack and settle Aim, Blood Harvest and the like on it.
    // Only its name rides along, as the alias.
    speaker: {
      scene: scene.id,
      actor: null,
      token: null,
      alias: sourceActor?.name ?? title,
    },
    content: `<div class="roll-column">${await roll.render()}</div>`,
    flavor,
    rolls: [roll],
    flags: {
      redsteel: {
        rollName: title,
        forcedMovementCollision: true,
        autoApplied: true,
      },
      attack: {
        type: "environment",
        damageProfile: { expression: [] },
        effects: {},
        normal: { damage, penetration: ARMOR_IGNORING_PENETRATION },
      },
    },
  });

  await applyDamageAsGM({
    messageId: message.id,
    mode: "normal",
    sceneId: scene.id,
    targetIds: victims.map((v) => v.id),
    selectedEffects: {},
  });
}

/* -------------------------------------------- */
/*  ABILITY TEMPLATE                            */
/* -------------------------------------------- */

/**
 * Abilities whose landed hit pushes the target, keyed by localisation key
 * (the English pack name as the fallback for a hand-made copy). Apply Damage
 * reads this after the damage is in; adding a new pushing ability is one line.
 *
 * `distance` hexes, `collisionDamage` formula (default 1d8, ignores armor).
 * `damageMinMargin`: the card's own damage needs the versus Test won by at
 * least this much; a smaller win pushes without it (see gateVersusPush).
 * `proneGap`: a won versus Test by at least this much also knocks the target
 * Prone ("Při rozdílu 50 ... Povalí"), read off the defender's answer.
 * `contest`: Zteč štítem's two-stage push. The first `distance` hexes land
 * whatever the contest; the card's damage and effects need the contest won
 * (gateVersusPush: a lost one pushes the first hexes only, no dialog); a win
 * pushes `contest.extraDistance` hexes more, unless the first push already
 * collided. Each stage happens once per target per card (`cardPush` flag),
 * at Apply Damage or when the answer arrives, whichever comes last.
 *
 * A push that collides moves nothing: the mover and whoever it hit take the
 * collision damage instead (moveAlongHeading).
 */
export const PUSH_ON_HIT = Object.freeze({
  // Úder štítem: Apply Damage being pressed is the won contest.
  "REDSTEEL.Items.ShieldBash.name": { distance: 1, proneGap: 50 },
  "REDSTEEL.Items.ShieldBashSmallShield.name": { distance: 1, proneGap: 50 },
  // Zteč štítem: one hex on landing, two more on a won +20% versus Test.
  "REDSTEEL.Items.ShieldCharge.name": {
    distance: 1,
    proneGap: 50,
    contest: { extraDistance: 2 },
  },
  "REDSTEEL.Items.ShieldChargeSmallShield.name": {
    distance: 1,
    proneGap: 50,
    contest: { extraDistance: 2 },
  },
  // Odstrčení: pushed on any win, the 3d4 only at MoS 25+.
  "REDSTEEL.Items.ShoveStrength.name": { distance: 1, damageMinMargin: 25 },
  "REDSTEEL.Items.ShoveDexterity.name": { distance: 1, damageMinMargin: 25 },
});

const PUSH_ON_HIT_NAMES = Object.freeze({
  "Shield Bash": "REDSTEEL.Items.ShieldBash.name",
  "Shield Bash (small shield)": "REDSTEEL.Items.ShieldBashSmallShield.name",
  "Shield Charge": "REDSTEEL.Items.ShieldCharge.name",
  "Shield Charge (small shield)": "REDSTEEL.Items.ShieldChargeSmallShield.name",
  "Shove (Strength)": "REDSTEEL.Items.ShoveStrength.name",
  "Shove (Dexterity)": "REDSTEEL.Items.ShoveDexterity.name",
});

/** The push a landed card carries, or null. */
export function pushForCard(message) {
  const flags = message?.flags?.redsteel ?? {};
  const key = flags.abilityKey ?? PUSH_ON_HIT_NAMES[flags.abilityName] ?? null;
  return (key && PUSH_ON_HIT[key]) || null;
}

const SYSTEM_ID = "redsteel";
const PRONE_STATUS = "prone";

/**
 * Knock a token Prone (the `prone` status, Povalení) unless it already is.
 * True when it newly went down. GM side.
 */
async function knockProne(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor || actor.statuses?.has(PRONE_STATUS)) return false;
  await game.redsteel.applyEffect(actor, PRONE_STATUS);
  return actor.statuses?.has(PRONE_STATUS) === true;
}

/**
 * Apply Damage landed a pushing ability: push each target away from the
 * attacker. GM only (called from applyDamageAsGM, from the Shield Charge
 * lost-contest relay and from the answer queue). Skipped for a target the
 * attacker cannot be located against, and for a dead target.
 *
 * A plain push (Shield Bash, Shove) pushes on every call, as before: the GM
 * re-applying a card pushes again (accepted, see the forced-movement notes).
 * A `contest` push keeps its stages in the card's `cardPush` flag, so each
 * happens once. `proneGap` is settled once per target (`pushProne` flag).
 *
 * @param {ChatMessage} message        the attack card
 * @param {Scene} scene
 * @param {string[]} targetIds
 * @param {TokenDocument|null} attackerDoc
 * @param {Actor|null} attacker
 * @param {object} [opts]
 * @param {boolean} [opts.firstOnly]  a lost contest: the first hexes only
 * @param {boolean} [opts.answerOnly] the answer queue: nothing a plain push
 *   would repeat, only the stages that wait on the contest
 * @returns {Promise<{tokenId: string, moved: number, prone: boolean}[]>} per
 *   target a push was tried on: hexes it has been moved by this card (a
 *   contest push counts every stage so far), and whether this call knocked it
 *   Prone. Empty when the card pushes nothing.
 */
export async function resolvePushOnHit(
  message,
  scene,
  targetIds,
  attackerDoc,
  attacker,
  { firstOnly = false, answerOnly = false } = {},
) {
  const results = [];
  const push = pushForCard(message);
  if (!push) return results;
  if (!attackerDoc) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.ForcedMovement.NoAttacker"));
    return results;
  }
  const label = message.flags?.redsteel?.rollName ?? "";
  const outcome = push.contest || push.proneGap ? versusOutcome(message) : null;
  const won = outcome?.attackerWon === true;
  const stages = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "cardPush") ?? {});
  const proned = foundry.utils.deepClone(message.getFlag(SYSTEM_ID, "pushProne") ?? {});
  const opts = (distance) => ({
    distance,
    collisionDamage: push.collisionDamage,
    label,
    sourceActor: attacker,
  });

  for (const id of targetIds) {
    const target = scene.tokens.get(id);
    if (!target || target.id === attackerDoc.id || isDeadToken(target)) continue;
    let moved = 0;

    if (push.contest) {
      const stage = stages[id] ?? { first: null, extra: null };
      if (stage.first === null && !answerOnly) {
        const pushed = await pushToken(target, attackerDoc, opts(push.distance ?? 1));
        stage.first = Number(pushed?.moved) || 0;
      }
      // The second stage waits for the first (it starts where that one ended)
      // and for a won contest. A first push that collided moved nothing, and
      // the same blocker stands in the way, so the second is not tried.
      if (stage.first !== null && stage.extra === null && won && !firstOnly) {
        stage.extra = stage.first > 0
          ? Number(
              (await pushToken(target, attackerDoc, opts(push.contest.extraDistance)))
                ?.moved,
            ) || 0
          : 0;
      }
      stages[id] = stage;
      moved = (stage.first ?? 0) + (stage.extra ?? 0);
    } else if (!answerOnly) {
      const pushed = await pushToken(target, attackerDoc, opts(push.distance ?? 1));
      moved = Number(pushed?.moved) || 0;
    }

    let prone = false;
    if (push.proneGap && won && outcome.gap >= push.proneGap && !proned[id] && !firstOnly) {
      proned[id] = true;
      prone = await knockProne(target);
    }
    results.push({ tokenId: target.id, moved, prone });
  }

  if (push.contest) await message.setFlag(SYSTEM_ID, "cardPush", stages);
  if (push.proneGap) await message.setFlag(SYSTEM_ID, "pushProne", proned);
  if (!answerOnly) {
    const applied = new Set(message.getFlag(SYSTEM_ID, "pushTargets") ?? []);
    for (const r of results) applied.add(r.tokenId);
    await message.setFlag(SYSTEM_ID, "pushTargets", [...applied]);
  }
  return results;
}

/** Podseknutí, plain and Improved: the attack modifiers that knock Prone. */
export const TRIP_KEYS = Object.freeze([
  "REDSTEEL.Items.TripStrength.name",
  "REDSTEEL.Items.TripDexterity.name",
  "REDSTEEL.Items.ImprovedTripStrength.name",
  "REDSTEEL.Items.ImprovedTripDexterity.name",
]);
const TRIP_NAMES = Object.freeze([
  "Trip (Strength)",
  "Trip (Dexterity)",
  "Improved Trip (Strength)",
  "Improved Trip (Dexterity)",
]);

/** Is this attack modifier a Trip? */
export function isTripModifier(mod) {
  return (
    TRIP_KEYS.includes(mod?.system?.localizationKey) || TRIP_NAMES.includes(mod?.name)
  );
}

/** How far back an answer looks for the card it answers. */
const ANSWER_LOOKBACK = 100;

function speakerTokenDoc(message) {
  const speaker = message?.speaker ?? {};
  return game.scenes?.get(speaker.scene)?.tokens?.get(speaker.token) ?? null;
}

/**
 * A defender's versus answer arrived (`flags.redsteel.versusFollowup`). Active
 * GM only, through the queue in hoplite.mjs registerHopliteHooks:
 *
 * - Podseknutí: the newest earlier card whose Trip line (`flags.redsteel
 *   .tripTest`, stamped where the line is rolled) has this margin and source.
 *   Attacker won: the answering defender goes Prone. Once per card
 *   (`tripResolved`), first answer wins.
 * - A pushing card already applied (`pushTargets`) whose own margin line this
 *   answers: the stages that waited on the contest (Shield Charge's two more
 *   hexes, Prone at a gap of 50). Not yet applied: nothing, Apply Damage
 *   reads the answer when it comes.
 *
 * Returns what happened, for Hoplite Onslaught, or null.
 *
 * @param {ChatMessage} message
 * @returns {Promise<{card: ChatMessage, attacker: Actor|null,
 *   pushResults: object[], knockedDownIds: string[]}|null>}
 */
export async function resolveVersusAnswer(message) {
  const followup = message?.flags?.redsteel?.versusFollowup;
  if (!followup) return null;
  const messages = game.messages?.contents ?? [];
  const index = messages.findIndex((m) => m.id === message.id);
  if (index < 0) return null;
  const margin = Number(followup.margin);
  const source = followup.source ?? "";
  const stop = Math.max(0, index - ANSWER_LOOKBACK);

  for (let i = index - 1; i >= stop; i--) {
    const card = messages[i];
    const flags = card.flags?.redsteel ?? {};
    if (flags.rerolledAway) continue;

    const trip = flags.tripTest;
    if (trip && Number(trip.margin) === margin && (trip.source ?? "") === source) {
      if (flags.tripResolved) return null;
      const outcome = versusOutcomeFor(card, margin, source);
      if (!outcome) return null;
      await card.setFlag(SYSTEM_ID, "tripResolved", true);
      const attackerDoc = speakerTokenDoc(card);
      const defenderDoc = speakerTokenDoc(message);
      if (!outcome.attackerWon || !defenderDoc || defenderDoc === attackerDoc) {
        return null;
      }
      const prone = await knockProne(defenderDoc);
      return {
        card,
        attacker: attackerDoc?.actor ?? null,
        pushResults: [],
        knockedDownIds: prone ? [defenderDoc.id] : [],
      };
    }

    const line = marginLineOf(card);
    if (!line || line.margin !== margin || line.source !== source) continue;
    const push = pushForCard(card);
    if (!push || !(push.contest || push.proneGap)) return null;
    const applied = flags.pushTargets ?? [];
    if (!applied.length) return null;
    const attackerDoc = speakerTokenDoc(card);
    const scene = attackerDoc?.parent ?? null;
    if (!scene) return null;
    const attacker = attackerDoc.actor ?? null;
    const pushResults = await resolvePushOnHit(card, scene, applied, attackerDoc, attacker, {
      answerOnly: true,
    });
    return {
      card,
      attacker,
      pushResults,
      knockedDownIds: pushResults.filter((r) => r.prone).map((r) => r.tokenId),
    };
  }
  return null;
}

/** The first margin line a card posts, or null. */
function marginLineOf(message) {
  const html = `${message?.flavor ?? ""}${message?.content ?? ""}`;
  const span = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector(".mos-followup");
  if (!span) return null;
  const margin = Number(span.dataset.margin);
  if (!Number.isFinite(margin)) return null;
  return { margin, source: span.dataset.source ?? "" };
}

/* -------------------------------------------- */
/*  VERSUS TEST GATE                            */
/* -------------------------------------------- */

/**
 * How the versus Test on a contested card came out, read off the chat log.
 *
 * The card posts its margin as a `.mos-followup` span (data-margin,
 * data-source); the defender's answer is a later card flagged
 * `versusFollowup {margin, source}` whose total is the gap between the two
 * margins, positive when the DEFENDER came out ahead (attributeFollowup.mjs).
 * The newest answer wins, so a rerolled answer replaces the first. A rerolled
 * attack card posts a new margin, and an answer to the old one no longer
 * matches it.
 *
 * @returns {{attackerWon:boolean, gap:number}|null}  null when nobody answered
 */
export function versusOutcome(message) {
  const line = marginLineOf(message);
  if (!line) return null;
  return versusOutcomeFor(message, line.margin, line.source);
}

/**
 * versusOutcome for one named line of the card (its margin and source), for
 * a card that posts more than one (a Trip line beside the attack).
 *
 * @returns {{attackerWon:boolean, gap:number}|null}
 */
export function versusOutcomeFor(message, margin, source = "") {
  const messages = game.messages?.contents ?? [];
  const start = messages.findIndex((m) => m.id === message.id);
  for (let i = messages.length - 1; i > start; i--) {
    const followup = messages[i].flags?.redsteel?.versusFollowup;
    if (!followup) continue;
    if (Number(followup.margin) !== margin || (followup.source ?? "") !== source) continue;
    const total = Number(messages[i].rolls?.[0]?.total);
    if (!Number.isFinite(total)) continue;
    // A dead tie goes to the initiator.
    return { attackerWon: total <= 0, gap: Math.abs(total) };
  }
  return null;
}

/**
 * Apply Damage on a card whose damage needs a minimum win (Shove). Runs on
 * the clicking client before the damage dialog opens.
 *
 * - no answer on record: false, the dialog opens and the GM rules it;
 * - defender won: nothing happens, true;
 * - won below the threshold: push only, no dialog, true;
 * - won at or above it: false, the dialog opens and applyDamageAsGM pushes
 *   after the damage, as for Shield Bash.
 *
 * @returns {Promise<boolean>} true when the click has been fully handled
 */
export async function gateVersusPush(message, targets) {
  const push = pushForCard(message);
  if (push?.contest) return gateContestPush(message, targets);
  const min = Number(push?.damageMinMargin);
  if (!push || !Number.isFinite(min)) return false;

  const source = message.flags?.redsteel?.rollName ?? "";
  const outcome = versusOutcome(message);
  if (!outcome) {
    ui.notifications.info(
      game.i18n.format("REDSTEEL.ForcedMovement.NoContest", { source }),
    );
    return false;
  }
  if (outcome.attackerWon && outcome.gap >= min) return false;

  const speaker = { scene: canvas.scene?.id ?? null, actor: null, token: null, alias: source };
  const esc = (v) => foundry.utils.escapeHTML(String(v ?? ""));
  if (!outcome.attackerWon) {
    await ChatMessage.create({
      speaker,
      content: `<p style="text-align:center;">${game.i18n.format(
        "REDSTEEL.ForcedMovement.ContestLost",
        { source: esc(source), gap: outcome.gap },
      )}</p>`,
    });
    return true;
  }

  const attackerTokenId = message.speaker?.token ?? null;
  if (!attackerTokenId) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.ForcedMovement.NoAttacker"));
    return true;
  }
  await ChatMessage.create({
    speaker,
    content: `<p style="text-align:center;">${game.i18n.format(
      "REDSTEEL.ForcedMovement.PushOnly",
      {
        source: esc(source),
        gap: outcome.gap,
        min,
        targets: targets.map((t) => esc(t.name)).join(", "),
      },
    )}</p>`,
  });
  for (const target of targets) {
    if (target.id === attackerTokenId) continue;
    await requestForcedMovement({
      op: "push",
      sceneId: canvas.scene.id,
      tokenId: target.id,
      fromTokenId: attackerTokenId,
      distance: push.distance ?? 1,
      collisionDamage: push.collisionDamage,
      label: source,
    });
  }
  return true;
}

/**
 * Apply Damage on Zteč štítem (a `contest` push). Runs on the clicking client
 * before the damage dialog opens.
 *
 * - no answer on record: false, the dialog opens and the GM rules the
 *   damage; the first hex is pushed after it, the rest when the answer comes;
 * - defender won: no damage, no dialog. The first hex still lands (the book
 *   pushes it before the Test), relayed to the GM, true;
 * - attacker won: false, the dialog opens; after the damage both stages are
 *   pushed and a gap of 50 knocks Prone (resolvePushOnHit).
 *
 * @returns {Promise<boolean>} true when the click has been fully handled
 */
async function gateContestPush(message, targets) {
  const source = message.flags?.redsteel?.rollName ?? "";
  const outcome = versusOutcome(message);
  if (!outcome) {
    ui.notifications.info(
      game.i18n.format("REDSTEEL.ForcedMovement.NoContest", { source }),
    );
    return false;
  }
  if (outcome.attackerWon) return false;

  const esc = (v) => foundry.utils.escapeHTML(String(v ?? ""));
  await ChatMessage.create({
    speaker: { scene: canvas.scene?.id ?? null, actor: null, token: null, alias: source },
    content: `<p style="text-align:center;">${game.i18n.format(
      "REDSTEEL.ForcedMovement.ContestLostPushed",
      { source: esc(source), gap: outcome.gap },
    )}</p>`,
  });
  await requestForcedMovement({
    op: "cardPush",
    messageId: message.id,
    sceneId: canvas.scene?.id ?? null,
    targetIds: targets.map((t) => t.id),
    firstOnly: true,
  });
  return true;
}

/**
 * The relayed lost-contest push (gateContestPush), on the GM: the first
 * stage only, then Hoplite Onslaught reads what it did.
 */
async function runCardPush(p) {
  const message = game.messages.get(p.messageId);
  const scene = game.scenes.get(p.sceneId);
  if (!message || !scene) return null;
  const attackerDoc = scene.tokens.get(message.speaker?.token ?? "") ?? null;
  const attacker = attackerDoc?.actor ?? null;
  const pushResults = await resolvePushOnHit(
    message,
    scene,
    Array.isArray(p.targetIds) ? p.targetIds : [],
    attackerDoc,
    attacker,
    { firstOnly: p.firstOnly === true },
  );
  await offerHopliteOnslaught(attacker, message, {
    pushResults,
    knockedDownIds: pushResults.filter((r) => r.prone).map((r) => r.tokenId),
  });
  return pushResults;
}

/* -------------------------------------------- */
/*  SOCKET RELAY                                */
/* -------------------------------------------- */

/**
 * Run a forced movement from any client. Payload:
 * `{ op: "push"|"pull"|"slide"|"swap"|"teleport", sceneId, tokenId,
 *    otherTokenId?, point?, fromTokenId?, heading?, distance?, collide?,
 *    collisionDamage?, label?, sourceActorUuid? }`
 * `point` is the push origin / pull target / teleport destination;
 * `fromTokenId` names a token to push from / pull toward instead.
 */
export async function requestForcedMovement(payload) {
  if (game.user.isGM) return runForcedMovement(payload);
  game.socket.emit(SOCKET, { type: SOCKET_TYPE, payload });
  return null;
}

async function runForcedMovement(p) {
  if (p?.op === "cardPush") return runCardPush(p);
  const scene = game.scenes.get(p.sceneId);
  const tokenDoc = scene?.tokens.get(p.tokenId);
  if (!tokenDoc) return null;
  const sourceActor = p.sourceActorUuid ? await fromUuid(p.sourceActorUuid) : null;
  const point = p.fromTokenId ? (scene.tokens.get(p.fromTokenId) ?? null) : p.point;
  const opts = {
    distance: p.distance ?? 1,
    collide: p.collide ?? true,
    collisionDamage: p.collisionDamage,
    label: p.label ?? "",
    sourceActor,
  };
  switch (p.op) {
    case "push":
      return pushToken(tokenDoc, point, opts);
    case "pull":
      return pullToken(tokenDoc, point, opts);
    case "slide":
      return slideToken(tokenDoc, p.heading ?? 0, opts);
    case "swap":
      return swapTokens(tokenDoc, scene.tokens.get(p.otherTokenId));
    case "teleport":
      return teleportToken(tokenDoc, p.point);
    default:
      return null;
  }
}

/** API on game.redsteel, plus the socket listener (the active GM alone runs relayed moves). */
export function registerForcedMovement() {
  game.redsteel.forcedMovement = {
    push: pushToken,
    pull: pullToken,
    slide: slideToken,
    swap: swapTokens,
    teleport: teleportToken,
    request: requestForcedMovement,
  };
  Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
      if (data?.type !== SOCKET_TYPE) return;
      if (game.users.activeGM?.id !== game.user.id) return;
      runForcedMovement(data.payload).catch((err) =>
        console.error("REDSTEEL | Forced movement failed", err),
      );
    });
  });
}
