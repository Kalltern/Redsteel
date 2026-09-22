/**
 * Positioning in combat (Postavení v boji) — facing, flanks and the back.
 *
 * Everything here is read-only geometry over state Foundry already keeps. A
 * token's facing IS `TokenDocument#rotation`: core's own convention is that a
 * rotation of zero faces south, which is exactly the rulebook's "a figure faces
 * the hex below it by default", and V13's movement rotation keeps it current as
 * the token walks. Nothing in this system ever writes rotation. A player turns
 * their token with the normal Foundry controls, as often as they like, and the
 * rules follow.
 *
 * The six hexes around a defender split into three arcs:
 *
 *   FRONT  the facing hex and the two beside it. No modifier (guide letter A).
 *   FLANK  the two hexes beside the back hex. Attacker +10% to hit (letter B).
 *   BACK   the hex opposite the face. No defense at all (letter C).
 *
 * Two deliberate choices.
 *
 * A. Sectors are measured by ANGLE between token centres, not by adjacency.
 *    The rule applies at any distance — an archer or a caster standing behind
 *    you is behind you — and there is no adjacency to read at range. For two
 *    neighbouring hexes the two readings are identical, because adjacent hex
 *    centres sit exactly in the middle of their arc.
 *
 * B. The six directions are read off the grid itself (`getAdjacentOffsets` plus
 *    `getCenterPoint`) rather than hardcoded. Flat-top against pointy-top, odd
 *    against even, columns against rows: none of it can be got wrong here, and
 *    a scene set up differently from the system default still behaves. Off a
 *    hex grid the facing simply is not snapped, and the arcs still hold.
 *
 * The back rule is not absolute, and never was. Shadow's Blindside Dodge (node
 * `backDodge`) already buys the right to dodge a blow from behind at -20%, and
 * until facing existed the defense dialog could only offer it as a button the
 * defender chose by hand. So "may this actor answer a back attack at all" is
 * one exported gate, `canDefendFromBehind`, which every caller asks. Further
 * features join it by granting the capability flag `system.backstabDefense`
 * through an Active Effect change, the same pattern ironMuscles and
 * magicPotential use, with nothing to change here.
 *
 * What the exception is *worth* is not this file's business. Back stays back;
 * the defense dialog decides which buttons a back attack leaves on the table.
 */

/** The three arcs. Stored on attack cards as these exact strings. */
export const SECTOR = Object.freeze({
  FRONT: "front",
  FLANK: "flank",
  BACK: "back",
});

/** To-hit bonus for attacking into a flank, in percent. */
export const FLANK_ATTACK_BONUS = 10;

/**
 * Degrees added to `rotation` to get a screen-space heading.
 *
 * Screen space here is the usual canvas convention: 0° points right (+x), 90°
 * points down (+y), angles increase clockwise. Foundry sprites rotate clockwise
 * and a rotation of 0 faces south, so a heading is the rotation plus a quarter
 * turn.
 */
const FACING_OFFSET = 90;

/* -------------------------------------------- */
/*  ANGLE PRIMITIVES                            */
/* -------------------------------------------- */

const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

/** Signed difference a − b, in (−180, 180]. */
function signedDelta(a, b) {
  const d = normalizeDeg(a - b);
  return d > 180 ? d - 360 : d;
}

/** Screen-space bearing from one point to another, in degrees. */
function bearing(from, to) {
  return normalizeDeg(
    (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
  );
}

/* -------------------------------------------- */
/*  TOKENS                                      */
/* -------------------------------------------- */

/** The TokenDocument behind a Token, a TokenDocument, or null. */
function docOf(token) {
  if (!token) return null;
  return token.document ?? token;
}

/**
 * A token's centre in canvas pixels.
 *
 * Prefers the placeable, which already accounts for size and any in-flight
 * animation, and falls back to the document's own footprint so a token on a
 * scene that is not the viewed one still measures.
 */
function centerOf(token) {
  if (token?.center) return token.center;

  const doc = docOf(token);
  if (!doc) return null;
  if (doc.object?.center) return doc.object.center;

  const sizeX = canvas?.grid?.sizeX ?? canvas?.grid?.size ?? 100;
  const sizeY = canvas?.grid?.sizeY ?? canvas?.grid?.size ?? 100;
  return {
    x: Number(doc.x ?? 0) + (Number(doc.width ?? 1) * sizeX) / 2,
    y: Number(doc.y ?? 0) + (Number(doc.height ?? 1) * sizeY) / 2,
  };
}

/**
 * The bearings of the six hexes around a point, straight from the grid.
 *
 * Null on anything that is not a six-neighbour grid — square, gridless, or a
 * token standing off-canvas — which is the signal not to snap.
 */
function neighbourBearings(center) {
  const grid = canvas?.grid;
  if (!grid?.getAdjacentOffsets || !center) return null;

  try {
    const origin = grid.getOffset({ x: center.x, y: center.y });
    const offsets = grid.getAdjacentOffsets(origin) ?? [];
    if (offsets.length !== 6) return null;
    return offsets.map((offset) =>
      bearing(center, grid.getCenterPoint(offset)),
    );
  } catch (_error) {
    return null;
  }
}

/* -------------------------------------------- */
/*  FACING                                      */
/* -------------------------------------------- */

/**
 * Which way a token is looking, as a screen-space bearing.
 *
 * Snapped to whichever of the six hexes it points most nearly at, so a token
 * left on 45° by the rotate tool still has an unambiguous face hex and can
 * never sit on an arc boundary.
 *
 * @param {Token|TokenDocument} token
 * @returns {number|null} degrees, or null when there is no token
 */
export function facingAngle(token) {
  const doc = docOf(token);
  if (!doc) return null;

  const raw = normalizeDeg(Number(doc.rotation ?? 0) + FACING_OFFSET);

  const bearings = neighbourBearings(centerOf(token));
  if (!bearings) return raw;

  let best = raw;
  let bestDelta = Infinity;
  for (const candidate of bearings) {
    const delta = Math.abs(signedDelta(candidate, raw));
    if (delta < bestDelta) {
      bestDelta = delta;
      best = candidate;
    }
  }
  return best;
}

/* -------------------------------------------- */
/*  SECTORS                                     */
/* -------------------------------------------- */

/**
 * Which arc an attacker stands in, as pure geometry. No feature, no exception.
 *
 * Boundaries favour the defender: an attacker exactly on the front/flank line
 * is in front, exactly on the flank/back line is on the flank. Only a ranged
 * attacker can land on one, since an adjacent hex always sits mid-arc.
 *
 * @param {Token|TokenDocument} defender
 * @param {Token|TokenDocument} attacker
 * @returns {"front"|"flank"|"back"|null}
 */
export function attackSector(defender, attacker) {
  const defenderCenter = centerOf(defender);
  const attackerCenter = centerOf(attacker);
  if (!defenderCenter || !attackerCenter) return null;

  // Sharing a hex leaves no direction to read, and no rule applies to it.
  if (
    defenderCenter.x === attackerCenter.x &&
    defenderCenter.y === attackerCenter.y
  ) {
    return SECTOR.FRONT;
  }

  const facing = facingAngle(defender);
  if (facing === null) return null;

  const delta = Math.abs(
    signedDelta(bearing(defenderCenter, attackerCenter), facing),
  );

  if (delta <= 90) return SECTOR.FRONT;
  if (delta <= 150) return SECTOR.FLANK;
  return SECTOR.BACK;
}

/**
 * May this actor answer a blow from behind at all?
 *
 * Two sources, and the gate every caller asks rather than testing either one.
 *
 *   - Shadow's Blindside Dodge (`backDodge`), which buys the dodge at -20% and
 *     is the only defense it buys: no parry, no shield, no magical defense.
 *   - `system.backstabDefense`, a capability flag for features yet to be built,
 *     granted by an Active Effect change the way ironMuscles is. Nothing sets
 *     it today.
 */
export function canDefendFromBehind(actor) {
  if (!actor) return false;
  if (actor.system?.backstabDefense === true) return true;
  const shadow = actor.system?.specialisations?.shadow;
  return !!(shadow?.active && shadow.nodes?.backDodge);
}

/**
 * True when this arc leaves the defender no roll at all.
 *
 * @param {string|null} sector
 * @param {Actor|null} actor  the defender, for their exceptions
 */
export function deniesDefense(sector, actor = null) {
  return sector === SECTOR.BACK && !canDefendFromBehind(actor);
}

/** The attacker's to-hit bonus for standing in this arc, in percent. */
export function attackBonusFor(sector) {
  return sector === SECTOR.FLANK ? FLANK_ATTACK_BONUS : 0;
}

/** Localized name of an arc, or "" for an unknown one. */
export function sectorLabel(sector) {
  switch (sector) {
    case SECTOR.FRONT:
      return game.i18n.localize("REDSTEEL.Positioning.Front");
    case SECTOR.FLANK:
      return game.i18n.localize("REDSTEEL.Positioning.Flank");
    case SECTOR.BACK:
      return game.i18n.localize("REDSTEEL.Positioning.Back");
    default:
      return "";
  }
}

/* -------------------------------------------- */
/*  REACH                                       */
/* -------------------------------------------- */

/** What a long-reach weapon costs its wielder at close quarters. */
export const LONG_REACH_PENALTY = -5;

/**
 * Are these two tokens standing in neighbouring hexes?
 *
 * Asked of the grid rather than computed from a distance, because "is this
 * enemy next to me" is exactly the question `getAdjacentOffsets` answers, on
 * every grid type and every parity. Sharing a hex counts as adjacent: someone
 * standing on top of you is not at spear range either.
 *
 * Measured from centres, so a token larger than one hex is read from the hex it
 * sits on rather than from its whole footprint.
 */
export function areAdjacent(a, b) {
  const grid = canvas?.grid;
  const centerA = centerOf(a);
  const centerB = centerOf(b);
  if (!grid?.getAdjacentOffsets || !centerA || !centerB) return false;

  try {
    const offsetA = grid.getOffset({ x: centerA.x, y: centerA.y });
    const offsetB = grid.getOffset({ x: centerB.x, y: centerB.y });
    if (offsetA.i === offsetB.i && offsetA.j === offsetB.j) return true;
    return grid
      .getAdjacentOffsets(offsetA)
      .some((offset) => offset.i === offsetB.i && offset.j === offsetB.j);
  } catch (_error) {
    return false;
  }
}

/**
 * Does a feature let this actor fight at close quarters with a long-reach
 * weapon and pay nothing for it?
 *
 * A capability flag, granted by an Active Effect change setting
 * `system.longReachNoPenalty` to true, the same pattern ironMuscles uses.
 * Nothing grants it today. The obvious first claimant is the Illusionist
 * Guardian's Pikeman archetype ("gains Long Reach with no penalty"), which is
 * resolved at the table for now.
 */
export function hasLongReachExemption(actor) {
  return actor?.system?.longReachNoPenalty === true;
}

/**
 * The close-quarters penalty a long-reach weapon takes against one opponent:
 * `LONG_REACH_PENALTY` when they are in a neighbouring hex, otherwise 0.
 *
 * Scoped to the opponent actually being fought, not to the crowd. A spearman
 * thrusting at someone two hexes off is not hampered by a third party at their
 * elbow; only the person they are trading blows with counts.
 *
 * The caller is responsible for knowing the weapon has long reach at all — this
 * says nothing about which weapon is in hand.
 *
 * @param {Actor|null} actor      the wielder, for their exemptions
 * @param {Token|TokenDocument|null} self
 * @param {Token|TokenDocument|null} opponent
 * @returns {number} 0 or LONG_REACH_PENALTY
 */
export function longReachPenaltyAgainst(actor, self, opponent) {
  if (!self || !opponent) return 0;
  if (hasLongReachExemption(actor)) return 0;
  return areAdjacent(self, opponent) ? LONG_REACH_PENALTY : 0;
}

/* -------------------------------------------- */
/*  ATTACK CARDS                                */
/* -------------------------------------------- */

/**
 * The arc every current target stands in, for stamping onto an attack card.
 *
 * Captured at swing time for the same reason the target ids are: targets are
 * per-user and live, and a reaction can resolve after everyone has moved. The
 * card is the record of where people stood when the blow was thrown.
 *
 * @param {Token|TokenDocument|null} attackerToken
 * @returns {Record<string, "front"|"flank"|"back">} keyed by target token id
 */
export function captureAttackPositioning(attackerToken) {
  if (!attackerToken) return {};

  const attackerId = docOf(attackerToken)?.id ?? null;
  const positioning = {};

  for (const target of [...(game.user?.targets ?? [])]) {
    const targetId = target?.id ?? null;
    if (!targetId || targetId === attackerId) continue;
    const sector = attackSector(target, attackerToken);
    if (sector) positioning[targetId] = sector;
  }

  return positioning;
}

/**
 * The arc a card recorded for one defender, or null when it recorded none.
 *
 * Takes either the ChatMessage or the attack packet the defense dialogs are
 * handed, since the Defend button extracts the one from the other and only the
 * packet survives as far as the roll.
 */
export function sectorFromMessage(source, defenderTokenId) {
  if (!defenderTokenId) return null;
  const map = source?.flags?.attack?.positioning ?? source?.positioning ?? null;
  const sector = map?.[defenderTokenId];
  return Object.values(SECTOR).includes(sector) ? sector : null;
}

/**
 * The arc a defense is being answered from.
 *
 * The card's stamp first, because it is the only record of where the two of
 * them stood when the blow landed. Live geometry second, which covers a defense
 * launched from the hotbar, a card written before this feature existed, and an
 * attack that named no target.
 *
 * @param {object} opts
 * @param {Token|TokenDocument|null} opts.defenderToken
 * @param {string|null} opts.attackerTokenId
 * @param {object|ChatMessage|null} [opts.attack]  the attack being answered
 * @returns {"front"|"flank"|"back"|null}
 */
export function resolveDefenseSector({
  defenderToken,
  attackerTokenId,
  attack = null,
} = {}) {
  const defender = docOf(defenderToken);
  if (!defender) return null;

  const stamped = sectorFromMessage(attack, defender.id);
  if (stamped) return stamped;

  if (!attackerTokenId || attackerTokenId === defender.id) return null;

  const attacker = defender.parent?.tokens?.get(attackerTokenId) ?? null;
  if (!attacker) return null;

  return attackSector(defenderToken, attacker);
}
