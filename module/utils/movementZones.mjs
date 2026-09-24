/**
 * Movement zones: the hex areas a token can reach this turn, drawn on the
 * canvas grid.
 *
 * Three consumers share the geometry here:
 *
 *   - documents/token.mjs draws the bands while a token is being dragged;
 *   - the hotbar's suggestion strip previews a mode's zone while a chip is
 *     hovered (`showPreview` / `clearPreview`);
 *   - once a movement mode is declared from the strip, a locked zone stays
 *     on the board and shrinks as the token walks (`refreshLockedZone`).
 *
 * Zones are threat-aware (user rulings 2026-09-24): hexes next to an enemy are
 * tinted red, enemy hexes are impassable, a step out of a threatened hex
 * provokes an opportunity attack (a red sword marks every hex that cannot be
 * reached without one), and only one step around the same enemy is allowed
 * per stay in its reach. Display only: the ruler and the drop still let the
 * player move anywhere.
 *
 * Canvas calls used: canvas.grid.getOffset / getAdjacentOffsets /
 * getTopLeftPoint / getCenterPoint / getShape, canvas.interface.grid
 * addHighlightLayer / highlightPosition / clearHighlightLayer, and one PIXI
 * container per layer on canvas.controls for the swords (the aim.mjs overlay
 * pattern). Everything here only draws; nothing writes a document.
 */

import {
  getActionPools,
  getMovementLock,
  getSpent,
  isTrackedTurn,
} from "./actionTracker.mjs";

/**
 * The three ways to spend a turn's movement (book: Pohyb, Pomalý pohyb, Běh).
 *
 * `actions` is what the mode costs; Sprint's two are paid by the Sprint
 * ability itself. The colours are the drag bands token.mjs has always drawn,
 * so a hovered chip and a dragged token read the same.
 */
export const MOVEMENT_MODES = {
  move: {
    budgetFn: (spd) => spd,
    color: 0x66ff99,
    actions: 1,
    icon: "fa-light fa-person-walking",
    labelKey: "REDSTEEL.Bg3Hotbar.Suggest.Move",
  },
  slow: {
    budgetFn: (spd) => Math.floor(spd / 2),
    color: 0x66ccff,
    actions: 1,
    icon: "fa-light fa-shoe-prints",
    labelKey: "REDSTEEL.Bg3Hotbar.Suggest.SlowMove",
  },
  sprint: {
    budgetFn: (spd) => Math.min(spd * 2, 12),
    color: 0xffff66,
    actions: 2,
    icon: "fa-light fa-person-running",
    labelKey: "REDSTEEL.Bg3Hotbar.Suggest.Sprint",
  },
  // Odpoutání: break free of the enemies next to you without provoking them,
  // Speed/2 hexes away. Offered only while an enemy is adjacent. The zone
  // honours the rest of the action's text: it cannot go around the enemies
  // it breaks from (hexes next to them are closed) and cannot end next to
  // another enemy (those hexes drop out). Other enemies still provoke.
  disengage: {
    budgetFn: (spd) => Math.floor(spd / 2),
    color: 0xd8c38a,
    actions: 2,
    icon: "fa-light fa-person-walking-arrow-right",
    labelKey: "REDSTEEL.Bg3Hotbar.Suggest.Disengage",
  },
};

const PREVIEW_LAYER = "redsteel-move-preview";

/** Sword container for a dragged route's opportunity attacks (token.mjs). */
export const DRAG_PATH_LAYER = "redsteel-drag-path";
const LOCK_LAYER = "redsteel-move-lock";
const PREVIEW_ALPHA = 0.25;
const LOCK_ALPHA = 0.18;

/** Tint of a hex adjacent to an enemy, whatever the mode's colour. */
export const THREAT_COLOR = 0xb02a2a;

/** Floor on a threatened hex's opacity, whatever band it is drawn in. */
const THREAT_ALPHA = 0.4;

/** Opacity factor for hexes reachable only by passing through an ally. */
const VIA_ALLY_FADE = 0.35;

/** A creature in one of these neither engages nor threatens anyone. */
const HARMLESS_STATUSES = ["dead", "dying", "downed", "unconscious"];

/**
 * Statuses under which an enemy cannot make opportunity attacks (user ruling
 * 2026-09-24). It still engages: its hex stays impassable and the one-step-
 * around rule still holds next to it, but its neighbours are not tinted red,
 * leaving them provokes nothing and they carry no swords. Ids from
 * CONFIG.REDSTEEL.effectDefinitions; extend here for later features.
 */
export const NO_OPPORTUNITY_ATTACK_STATUSES = [
  "stagger",
  "stun",
  "paralyze",
  "blind",
  "dazzled",
];

// Font Awesome solid, same family list as aim.mjs; U+F71C is fa-sword.
const FA_FAMILY = ["Font Awesome 6 Pro", "Font Awesome 6 Free", "FontAwesome"];
const SWORD_GLYPH = "";

/** Speed, read exactly as token.mjs reads its movement allowance. */
function actorSpeed(actor) {
  return Number(actor?.system?.secondaryAttributes?.spd?.total ?? 0) || 0;
}

/**
 * How many hexes a mode lets this actor walk.
 *
 * @param {Actor} actor
 * @param {"move"|"slow"|"sprint"} mode
 * @returns {number}
 */
export function movementBudget(actor, mode) {
  const def = MOVEMENT_MODES[mode];
  if (!def) return 0;
  return Math.max(0, Math.floor(def.budgetFn(actorSpeed(actor))));
}

/**
 * The placeable token an actor is standing on in the current scene, or null.
 * Same reading as the hotbar's own `tokenForActor`.
 */
export function tokenForActor(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token?.object ?? null;
  return actor.getActiveTokens(false, false)?.[0] ?? null;
}

/** Hexes the token has walked this round, per the drop counter. */
export function tokenMovementSpent(token) {
  return Number(token?.document?.getFlag("redsteel", "movementSpent") ?? 0) || 0;
}

/**
 * What is left of a declared movement: budget minus hexes walked since it was
 * declared. Never negative.
 *
 * @param {Token|null} token
 * @param {{budget: number, startSpent: number}} lock
 */
export function lockRemaining(token, lock) {
  const walked = Math.max(0, tokenMovementSpent(token) - (Number(lock?.startSpent) || 0));
  return Math.max(0, (Number(lock?.budget) || 0) - walked);
}

/**
 * The grid offset under a token's DOCUMENT position rather than its animated
 * one, so a zone drawn right after a move lands where the token is going.
 */
function documentOrigin(token) {
  const doc = token?.document;
  if (!doc) return null;
  const center = {
    x: doc.x + (doc.width * canvas.grid.sizeX) / 2,
    y: doc.y + (doc.height * canvas.grid.sizeY) / 2,
  };
  return canvas.grid.getOffset(center);
}

/**
 * Every hex within `maxDistance` steps of `origin`, breadth-first over the
 * grid's own adjacency. Threat-blind; zones draw from computeMovementZone.
 *
 * @param {{i: number, j: number}} origin
 * @param {number} maxDistance
 * @returns {{i: number, j: number, distance: number}[]}
 */
export function reachableHexes(origin, maxDistance) {
  const visited = new Set();
  const reachable = [];

  const queue = [{ i: origin.i, j: origin.j, distance: 0 }];
  let head = 0;

  while (head < queue.length) {
    const current = queue[head++];
    const key = `${current.i},${current.j}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (current.distance > maxDistance) continue;
    reachable.push(current);

    // Neighbours come from the grid itself, so the overlay is correct on any
    // hex layout (flat-top or pointy-top, odd or even, rows or columns).
    const neighbors = canvas.grid.getAdjacentOffsets({
      i: current.i,
      j: current.j,
    });
    for (const neighbor of neighbors) {
      queue.push({
        i: neighbor.i,
        j: neighbor.j,
        distance: current.distance + 1,
      });
    }
  }

  return reachable;
}

/* -------------------------------------------------------------------------- */
/*  Threat-aware zone                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The search itself, grid-free so it can be tested outside Foundry: hexes are
 * opaque string keys and `neighbors(key)` returns the adjacent keys.
 *
 * Two maps of hex -> enemy ids: `engage` holds every living enemy's
 * neighbours (the step-around rule), `threat` only those of enemies able to
 * make opportunity attacks (red tint, provoking, swords).
 *
 * User rulings (2026-09-24):
 *   - A step that starts next to a threatening enemy provokes (leaving it or
 *     moving around it).
 *   - Any step that ends next to an enemy ENDS the movement: walking into an
 *     enemy's reach stops you there, so nobody slips along an enemy's side.
 *   - A step that keeps the mover next to the same enemy is the one step
 *     around it, allowed only as the FIRST step from where the move starts
 *     (and, being next to the enemy, it ends the move too). Leaving an enemy
 *     (stepping to a hex not next to any) is allowed and the move goes on.
 *   - Allies block. Passing through one needs that ally to spend a Reaction,
 *     so `allies` maps an ally's hex to whether that is on offer (true) or not
 *     (false, a wall). No move may end on an ally's hex.
 *
 * Breadth-first in unit-distance layers over states (hex, p, a, stop): p a
 * provoking step has been taken, a an ally was passed through, stop the last
 * step ended next to an enemy.
 *
 * Per hex the least-demanding way in decides: reachable without passing an
 * ally beats reachable only through one (`viaAlly`), and within that, a way
 * in with no provoking step clears `provokes`. `incident` is the sword: the
 * attack happens on THIS hex, i.e. every shortest way in provokes on its
 * last step.
 * A hex entered cleanly after an earlier provoking step carries no sword.
 *
 * @param {{origin: string, budget: number, neighbors: (key: string) => string[],
 *   engage: Map<string, Set<string>>, threat: Map<string, Set<string>>,
 *   blocked: Set<string>, forbidden?: Set<string>,
 *   allies?: Map<string, boolean>}} input
 * @returns {Map<string, {threatened: boolean, provokes: boolean,
 *   incident: boolean, viaAlly: boolean}>} Without the origin and without
 *   ally hexes.
 */
export function searchZone({
  origin,
  budget,
  neighbors,
  engage,
  threat,
  blocked,
  forbidden = new Set(),
  allies = new Map(),
}) {
  const NONE = new Set();
  const found = new Map();
  const seen = new Set();
  const stateKey = (key, p, a, stop) =>
    `${key}|${p ? 1 : 0}|${a ? 1 : 0}|${stop ? 1 : 0}`;

  let layer = [{ key: origin, p: false, a: false, stop: false }];
  seen.add(stateKey(origin, false, false, false));

  for (let d = 0; d < budget && layer.length; d++) {
    const next = [];
    for (const state of layer) {
      if (state.stop) continue;
      const engageA = engage.get(state.key) ?? NONE;
      const provoking = (threat.get(state.key) ?? NONE).size > 0;
      for (const nb of neighbors(state.key)) {
        if (blocked.has(nb) || forbidden.has(nb)) continue;
        const ally = allies.get(nb);
        if (ally === false) continue;
        const engageB = engage.get(nb) ?? NONE;
        let around = false;
        for (const e of engageA) {
          if (engageB.has(e)) {
            around = true;
            break;
          }
        }
        // Stepping around an enemy only from the starting hex.
        if (around && d > 0) continue;
        const p = state.p || provoking;
        const a = state.a || ally === true;

        // Recorded before the state dedupe: two arrivals can share a state
        // yet differ in whether their last step provoked, and the sword
        // needs to know about a clean one.
        if (nb !== origin && ally === undefined) {
          let cell = found.get(nb);
          if (!cell) {
            cell = {
              threatened: (threat.get(nb) ?? NONE).size > 0,
              clean: null,
              ally: null,
            };
            found.set(nb, cell);
          }
          // The sword follows the shortest way in: a longer detour that
          // happens to end on a clean step does not clear it.
          const slot = a ? "ally" : "clean";
          const prev = cell[slot];
          if (!prev) {
            cell[slot] = { provokes: p, incident: provoking, dist: d + 1 };
          } else {
            prev.provokes = prev.provokes && p;
            if (d + 1 === prev.dist) prev.incident = prev.incident && provoking;
          }
        }

        const stop = engageB.size > 0;
        const sk = stateKey(nb, p, a, stop);
        if (seen.has(sk)) continue;
        seen.add(sk);
        next.push({ key: nb, p, a, stop });
      }
    }
    layer = next;
  }

  const result = new Map();
  for (const [key, cell] of found) {
    const viaAlly = cell.clean === null;
    const best = viaAlly ? cell.ally : cell.clean;
    result.set(key, {
      threatened: cell.threatened,
      provokes: best.provokes,
      incident: best.incident,
      viaAlly,
    });
  }
  return result;
}

const offsetKey = (o) => `${o.i},${o.j}`;

function parseKey(key) {
  const [i, j] = key.split(",").map(Number);
  return { i, j };
}

/**
 * The tokens that engage this one: the other side (HOSTILE against
 * everything else, the countAdjacentEnemies model in sneakTriggers.mjs),
 * standing, and visible to this client. Which of them also threaten is
 * decided in computeMovementZone.
 */
/**
 * Which side a token fights on. A player character (`character` actor), or
 * anything flagged into the party, is on the party's side whatever its token
 * disposition says: tables leave PC tokens on the default Hostile often
 * enough that the disposition alone put the whole scene on one side.
 *
 * Deliberately by actor type, not ownership. An earlier version read
 * `hasPlayerOwner`, and a hostile NPC whose actor players had been given
 * owner rights to (to read its sheet) switched sides and threatened nobody.
 */
function isHostileSide(t) {
  const actor = t?.actor;
  if (actor?.type === "character" || actor?.system?.partyMember) return false;
  return Number(t?.disposition) === CONST.TOKEN_DISPOSITIONS.HOSTILE;
}

/**
 * The mover's standing allies on the board, with their hex and whether they
 * still have a Reaction this round. Passing through an ally costs it one
 * (user ruling 2026-09-24). Fallen allies (dead, downed ...) are left out:
 * they do not block at all.
 *
 * @param {Token} token
 * @returns {{doc: TokenDocument, key: string, hasReaction: boolean}[]}
 */
function allyTokens(token) {
  const list = [];
  const doc = token?.document;
  const scene = doc?.parent;
  if (!doc || !scene) return list;
  const mySide = isHostileSide(doc);
  for (const other of scene.tokens.contents) {
    if (other.id === doc.id) continue;
    if (isHostileSide(other) !== mySide) continue;
    if (!other.object?.visible) continue;
    const actor = other.actor;
    const statuses = actor?.statuses;
    if (statuses && HARMLESS_STATUSES.some((s) => statuses.has(s))) continue;
    const center = other.object?.center;
    if (!center) continue;
    const hasReaction =
      !actor || getSpent(actor).reactions < getActionPools(actor).reactions;
    list.push({
      doc: other,
      key: offsetKey(canvas.grid.getOffset(center)),
      hasReaction,
    });
  }
  return list;
}

/**
 * The mover's allies as hex -> whether that hex can be passed (the ally still
 * has a Reaction to spend on letting the mover through). An ally with none
 * left is a wall.
 *
 * @param {Token} token
 * @returns {Map<string, boolean>}
 */
function alliesOf(token) {
  return new Map(allyTokens(token).map((a) => [a.key, a.hasReaction]));
}

/**
 * The allies a route passes through: every ally standing on a hex of the
 * route between its first and last hex. The route runs through `points`
 * (canvas points, token centres) along canvas.grid.getDirectPath, the line the
 * ruler draws. Used by allyPassage.mjs to ask them before the move goes ahead.
 *
 * @param {Token} token
 * @param {{x: number, y: number}[]} points
 * @returns {{doc: TokenDocument, key: string, hasReaction: boolean}[]}
 */
export function alliesOnPath(token, points) {
  if (!canDraw() || points.length < 2) return [];
  const path = canvas.grid.getDirectPath(points).map(offsetKey);
  const inner = new Set(path.slice(1, -1));
  const last = path[path.length - 1];
  inner.delete(path[0]);
  inner.delete(last);
  if (!inner.size) return [];
  return allyTokens(token).filter((a) => inner.has(a.key));
}

function enemiesOf(token) {
  const doc = token?.document;
  const scene = doc?.parent;
  if (!doc || !scene) return [];
  const mySide = isHostileSide(doc);
  return scene.tokens.contents.filter((other) => {
    if (other.id === doc.id) return false;
    if (isHostileSide(other) === mySide) return false;
    if (!other.object?.visible) return false;
    const statuses = other.actor?.statuses;
    if (statuses && HARMLESS_STATUSES.some((s) => statuses.has(s))) return false;
    return true;
  });
}

/**
 * The enemy picture around a token: `engage` and `threat` map a hex key to the
 * ids of the enemies next to it (every living enemy, and only those able to
 * make opportunity attacks, respectively); `blocked` holds the enemies' own
 * hexes. Enemies stand on their centre hex.
 *
 * @param {Token} token
 * @returns {{engage: Map<string, Set<string>>, threat: Map<string,
 *   Set<string>>, blocked: Set<string>}}
 */
function threatMaps(token, ignore = []) {
  const engage = new Map();
  const threat = new Map();
  const blocked = new Set();
  // Hexes next to the enemies a Disengage breaks from: no threat from them,
  // and closed to the move (it may not go around them or come back).
  const ignored = new Set(ignore ?? []);
  const ignoredRing = new Set();
  const addTo = (map, key, id) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };
  for (const enemy of enemiesOf(token)) {
    const center = enemy.object?.center;
    if (!center) continue;
    const statuses = enemy.actor?.statuses;
    const canStrike = !(
      statuses && NO_OPPORTUNITY_ATTACK_STATUSES.some((s) => statuses.has(s))
    );
    const at = canvas.grid.getOffset({ x: center.x, y: center.y });
    blocked.add(offsetKey(at));
    for (const nb of canvas.grid.getAdjacentOffsets(at)) {
      const key = offsetKey(nb);
      if (ignored.has(enemy.id)) {
        ignoredRing.add(key);
        continue;
      }
      addTo(engage, key, enemy.id);
      if (canStrike) addTo(threat, key, enemy.id);
    }
  }
  return { engage, threat, blocked, ignoredRing };
}

/**
 * The living enemies standing next to this token's hex: the ones a Disengage
 * breaks free from. Empty when nobody is adjacent, which is also what hides
 * the Disengage suggestion.
 *
 * @param {Token} token
 * @returns {string[]} Enemy token ids.
 */
export function engagingEnemyIds(token) {
  const origin = documentOrigin(token);
  if (!origin || !canDraw()) return [];
  const { engage } = threatMaps(token);
  return [...(engage.get(offsetKey(origin)) ?? [])];
}

/**
 * The hexes along a dragged route where an opportunity attack happens: every
 * hex entered by a step that starts next to a threatening enemy.
 *
 * This is the route the player is actually dragging, not the zone's safest
 * one, so a path that walks past an enemy shows the sword even when a clean
 * detour exists. `points` are canvas points (token centre, waypoints, cursor);
 * the hexes between them come from canvas.grid.getDirectPath, the same
 * shortest direct line the ruler draws on a gridded scene.
 *
 * @param {Token} token
 * @param {{x: number, y: number}[]} points
 * @returns {{i: number, j: number}[]}
 */
export function pathSwordHexes(token, points, { ignore = [] } = {}) {
  if (!canDraw() || points.length < 2) return [];
  const { threat } = threatMaps(token, ignore);
  const path = canvas.grid.getDirectPath(points);
  const swords = [];
  let prev = null;
  for (const step of path) {
    const key = offsetKey(step);
    if (prev !== null && key !== prev) {
      if ((threat.get(prev)?.size ?? 0) > 0) swords.push({ i: step.i, j: step.j });
    }
    prev = key;
  }
  return swords;
}

/**
 * Draw sword glyphs on the given hexes, in the named layer's own container,
 * replacing whatever that container held.
 *
 * @param {string} layerId
 * @param {{i: number, j: number}[]} hexes
 */
export function renderSwords(layerId, hexes) {
  clearSwords(layerId);
  if (!canDraw() || !hexes.length) return;
  const container = swordContainer(layerId);
  const style = swordTextStyle();
  for (const hex of hexes) {
    const glyph = new PIXI.Text(SWORD_GLYPH, style);
    glyph.anchor.set(0.5);
    const center = canvas.grid.getCenterPoint({ i: hex.i, j: hex.j });
    glyph.position.set(center.x, center.y);
    container.addChild(glyph);
  }
}

function swordTextStyle() {
  return new PIXI.TextStyle({
    fontFamily: FA_FAMILY,
    fontWeight: "900",
    fontSize: Math.round((canvas.grid.size ?? 100) * 0.3),
    fill: "#d23a3a",
    stroke: "#140606",
    strokeThickness: 3,
  });
}

/**
 * Every hex this token can reach within `budget` steps, with whether it is
 * next to an enemy and whether getting there must provoke. Enemies stand on
 * their centre hex (multi-hex creatures are simplified to it).
 *
 * @param {Token} token
 * @param {number} budget
 * @returns {Map<string, {i: number, j: number, threatened: boolean,
 *   provokes: boolean, sword: boolean}>} Keyed "i,j", origin excluded.
 *   `sword` = every way in provokes on its last step.
 */
export function computeMovementZone(token, budget, { ignore = [] } = {}) {
  const zone = new Map();
  const origin = documentOrigin(token);
  if (!origin) return zone;

  const { engage, threat, blocked, ignoredRing } = threatMaps(token, ignore);
  const disengaging = (ignore?.length ?? 0) > 0;
  const forbidden = new Set(ignoredRing);
  forbidden.delete(offsetKey(origin));

  const found = searchZone({
    origin: offsetKey(origin),
    budget: Math.max(0, Math.floor(Number(budget) || 0)),
    neighbors: (key) =>
      canvas.grid.getAdjacentOffsets(parseKey(key)).map(offsetKey),
    engage,
    threat,
    blocked,
    forbidden,
    allies: alliesOf(token),
  });
  for (const [key, cell] of found) {
    // A Disengage may pass another enemy but not stop next to one.
    if (disengaging && engage.has(key)) continue;
    zone.set(key, {
      ...parseKey(key),
      ...cell,
      // The sword sits where the attack happens, never further along the
      // route (user ruling 2026-09-24).
      sword: cell.incident,
    });
  }
  return zone;
}

/**
 * Hexes a visible token other than `excludeTokenId` stands on. Hidden and
 * invisible tokens are not counted, so they don't block the overlay visually.
 */
function occupiedHexes(excludeTokenId) {
  const occupied = new Set();
  for (const t of canvas.tokens.placeables) {
    if (!t?.center) continue;
    if (!t.visible) continue;
    if (excludeTokenId && t.document?.id === excludeTokenId) continue;
    const off = canvas.grid.getOffset({ x: t.center.x, y: t.center.y });
    occupied.add(`${off.i},${off.j}`);
  }
  return occupied;
}

/**
 * Highlight `cells` on the named grid layer, skipping hexes that a visible
 * token other than `excludeTokenId` stands on.
 *
 * @param {string} layerId
 * @param {{i: number, j: number}[]} cells
 * @param {{color: number, alpha: number}} style
 * @param {string|null} excludeTokenId  The moving token's own document id.
 */
export function renderHexes(layerId, cells, style, excludeTokenId) {
  canvas.interface.grid.addHighlightLayer(layerId);
  const shape = canvas.grid.getShape();
  const occupied = occupiedHexes(excludeTokenId);

  for (const cell of cells) {
    const key = `${cell.i},${cell.j}`;
    if (occupied.has(key)) continue;
    const point = canvas.grid.getTopLeftPoint({ i: cell.i, j: cell.j });
    canvas.interface.grid.highlightPosition(layerId, {
      x: point.x,
      y: point.y,
      shape,
      color: style.color,
      alpha: style.alpha,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*  Swords                                                                    */
/* -------------------------------------------------------------------------- */

/** One PIXI container of sword glyphs per highlight layer id. */
const swordContainers = new Map();

/** Above the token meshes, as in aim.mjs. */
function overlayHost() {
  return canvas.controls ?? canvas.interface;
}

/**
 * The live sword container for a layer, rebuilt when the old one died with a
 * scene change (destroyed, or no longer on the current host layer).
 */
function swordContainer(layerId) {
  const existing = swordContainers.get(layerId);
  const host = overlayHost();
  if (existing && !existing.destroyed && existing.parent === host) {
    return existing;
  }
  clearSwords(layerId);
  const container = new PIXI.Container();
  container.eventMode = "none";
  container.zIndex = 900;
  host.sortableChildren = true;
  host.addChild(container);
  swordContainers.set(layerId, container);
  return container;
}

function clearSwords(layerId) {
  const container = swordContainers.get(layerId);
  swordContainers.delete(layerId);
  if (container && !container.destroyed) container.destroy({ children: true });
}

/**
 * Draw a zone on the named layer: its own colour, threatened hexes in
 * THREAT_COLOR, occupied hexes skipped, and a sword on every hex that cannot
 * be reached without provoking.
 *
 * `options.threatened: "skip"` leaves threatened hexes out entirely, and
 * `options.swords: false` draws no swords. The drag's inner bands use both, so
 * the red and the swords come from the outer band only.
 *
 * @param {string} layerId
 * @param {Map<string, {i: number, j: number, threatened: boolean,
 *   provokes: boolean}>} zone  From computeMovementZone.
 * @param {{color: number, alpha: number}} style
 * @param {string|null} excludeTokenId  The moving token's own document id.
 * @param {{threatened?: "tint"|"skip", swords?: boolean}} [options]
 */
export function renderZone(layerId, zone, style, excludeTokenId, options = {}) {
  const skipThreat = options.threatened === "skip";
  const drawSwords = options.swords !== false;
  canvas.interface.grid.addHighlightLayer(layerId);
  clearSwords(layerId);
  const shape = canvas.grid.getShape();
  const occupied = occupiedHexes(excludeTokenId);

  let swords = null;
  let swordStyle = null;
  for (const [key, cell] of zone) {
    if (occupied.has(key)) continue;
    if (cell.threatened && skipThreat) continue;
    const point = canvas.grid.getTopLeftPoint({ i: cell.i, j: cell.j });
    canvas.interface.grid.highlightPosition(layerId, {
      x: point.x,
      y: point.y,
      shape,
      color: cell.threatened ? THREAT_COLOR : style.color,
      // A dark red at the bands' 15-25% vanishes into grass; keep it legible.
      // Hexes only reachable through an ally (who must spend a Reaction) are
      // drawn faint, sword and all.
      alpha:
        (cell.threatened ? Math.max(style.alpha, THREAT_ALPHA) : style.alpha) *
        (cell.viaAlly ? VIA_ALLY_FADE : 1),
    });

    if (!drawSwords || !cell.sword) continue;
    swords ??= swordContainer(layerId);
    swordStyle ??= swordTextStyle();
    const glyph = new PIXI.Text(SWORD_GLYPH, swordStyle);
    glyph.anchor.set(0.5);
    if (cell.viaAlly) glyph.alpha = VIA_ALLY_FADE;
    const center = canvas.grid.getCenterPoint({ i: cell.i, j: cell.j });
    glyph.position.set(center.x, center.y);
    swords.addChild(glyph);
  }
}

function canDraw() {
  return !!(canvas?.ready && canvas.grid && canvas.interface?.grid);
}

/**
 * Clear a zone layer: its highlight and its swords.
 *
 * @param {string} layerId
 */
export function clearZone(layerId) {
  clearSwords(layerId);
  if (!canDraw()) return;
  canvas.interface.grid.clearHighlightLayer(layerId);
}

/* -------------------------------------------------------------------------- */
/*  Hover preview                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Draw the zone one movement mode would give, around the actor's token.
 *
 * @param {Actor} actor
 * @param {"move"|"slow"|"sprint"} mode
 */
export function showPreview(actor, mode) {
  clearPreview();
  const def = MOVEMENT_MODES[mode];
  if (!def || !canDraw()) return;
  const token = tokenForActor(actor);
  if (!token?.document) return;
  const ignore = mode === "disengage" ? engagingEnemyIds(token) : [];
  renderZone(
    PREVIEW_LAYER,
    computeMovementZone(token, movementBudget(actor, mode), { ignore }),
    { color: def.color, alpha: PREVIEW_ALPHA },
    token.document.id,
  );
}

export function clearPreview() {
  clearZone(PREVIEW_LAYER);
}

/* -------------------------------------------------------------------------- */
/*  Locked zone                                                               */
/* -------------------------------------------------------------------------- */

/** The actor the hotbar is bound to on this client. Transient, never stored. */
let zoneActor = null;

/**
 * Tell the controller whose lock to draw. The hotbar calls this on every
 * render with its bound actor, and with null when it closes.
 *
 * @param {Actor|null} actor
 */
export function setZoneActor(actor) {
  zoneActor = actor ?? null;
}

/**
 * Redraw the locked zone from scratch: remaining hexes of the declared mode
 * around the token, or nothing when there is no lock on this actor's turn.
 */
export function refreshLockedZone() {
  if (!canDraw()) return;
  clearZone(LOCK_LAYER);

  const actor = zoneActor;
  if (!actor || !isTrackedTurn(actor)) return;
  const lock = getMovementLock(actor);
  const def = MOVEMENT_MODES[lock?.mode];
  // Confirmed from the strip's check button: the movement is over.
  if (!lock || !def || lock.done) return;

  const token = tokenForActor(actor);
  if (!token?.document) return;

  renderZone(
    LOCK_LAYER,
    computeMovementZone(token, lockRemaining(token, lock), {
      ignore: lock.ignore ?? [],
    }),
    { color: def.color, alpha: LOCK_ALPHA },
    token.document.id,
  );
}

/** Clear the locked zone without touching the controller's actor. */
export function clearLockedZone() {
  clearZone(LOCK_LAYER);
}

/**
 * Keep the locked zone in step with the board. Registered once at init; every
 * handler only redraws, so this is safe on every client.
 */
export function registerMovementZoneHooks() {
  const refresh = foundry.utils.debounce(() => refreshLockedZone(), 50);
  const isZoneActor = (actor) =>
    !!actor && !!zoneActor && actor.uuid === zoneActor.uuid;

  Hooks.on("updateToken", (tokenDoc, changed) => {
    if (!zoneActor) return;
    const c = changed ?? {};
    // Any token: an enemy moving, appearing or switching sides reshapes the
    // threat around the locked zone.
    if ("x" in c || "y" in c || "hidden" in c || "disposition" in c) {
      refresh();
      return;
    }
    if (!isZoneActor(tokenDoc?.actor)) return;
    if ("movementSpent" in (c.flags?.redsteel ?? {})) refresh();
  });

  Hooks.on("updateActor", (actor) => {
    if (isZoneActor(actor)) refresh();
  });

  // Redraw once the bound token has finished moving. A redraw fired by the
  // update itself runs while the token is still animating along its path and
  // left the swords wrong until the next (even fake) drag redrew them; V14's
  // TokenMovementOperation#finished resolves once the whole movement is done.
  // The dragged route's swords go with it, whatever order the drop's own
  // clean-up ran in.
  Hooks.on("moveToken", (tokenDoc, movement) => {
    if (!isZoneActor(tokenDoc?.actor)) return;
    Promise.resolve(movement?.finished)
      .catch(() => {})
      .then(() => {
        renderSwords(DRAG_PATH_LAYER, []);
        refreshLockedZone();
      });
  });

  // Tokens arriving or leaving, and statuses (dead, downed ...) that take an
  // enemy's threat away or give it back.
  for (const hook of [
    "createToken",
    "deleteToken",
    "createActiveEffect",
    "deleteActiveEffect",
  ]) {
    Hooks.on(hook, () => {
      if (zoneActor) refresh();
    });
  }

  for (const hook of ["updateCombat", "deleteCombat", "canvasReady"]) {
    Hooks.on(hook, () => refresh());
  }
}
