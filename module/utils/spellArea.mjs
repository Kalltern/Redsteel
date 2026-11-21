/**
 * Spell areas: place an area spell's shape on the hex grid, target everyone
 * inside, and leave a lasting zone on the map.
 *
 * THE DATA
 * --------
 * A spell carries `system.area = {shape, size, angle, targets, linger, rounds}`
 * (template.json). The code only ever sees hex counts; turning the book's
 * metres into hexes (1 hex = 1.5 m, user ruling 2026-11-20) is done by whoever
 * authors the spell. Shapes:
 *
 *   burst  the placed hex plus `size` rings around it (size 0 = one hex);
 *   aura   the caster's own hexes plus `size` rings, nothing to place;
 *   cone   Breath: starts next to the caster along its facing, the wheel
 *          turns it (and the token), Shift + wheel moves it one hex out;
 *          `size` hexes deep (the first hex counts as 1), snapped to the
 *          grid: 45° widens 1, 2, 3 a row, 90° widens 1, 3, 5 (coneCells);
 *   line   a beam of `size` hexes from next to the caster towards the cursor.
 *
 * PLACEMENT
 * ---------
 * castSpell.mjs performCast calls `placeSpellArea` before anything is paid. A
 * bronze silhouette follows the cursor and breathes while it is not placed
 * (the overwatch.mjs pattern: window capture-phase listeners, right click,
 * Escape or a minute of nothing cancels). Then a confirm step: the placed
 * hexes stay drawn, everyone standing in them is targeted (allies too, never
 * the dead, the caster only when `includeCaster` is set for healing and
 * cleansing areas; a player only targets what they can see), and a small
 * panel lets the caster click tokens on and off before casting. A spell
 * marked `targets: "enemies"` starts with only the other side targeted
 * (user rulings 2026-11-20). Cancelling anywhere restores the previous targets
 * and spends nothing. Without a canvas, without a caster token on the viewed
 * scene, or with the world setting off, the spell is cast exactly as before,
 * on hand-picked targets.
 *
 * ZONES
 * -----
 * A `linger` spell that landed leaves a Scene Region of its hexes, visible to
 * everyone, with no behaviors (zone triggers are not built yet). Regions are
 * GM-only documents, so the data is built on the caster's client (it has the
 * grid) and created by the active GM over the system socket. The Region
 * carries `flags.redsteel.spellZone = {casterUuid, spellId, spellName,
 * castMessageId, channelingEffectId, cells, expires}`. It goes away, on the
 * active GM, when the Channeling effect it was cast with is deleted (matched
 * by effect id, never spell id: a recast deletes the old Channeling while the
 * new zone is being made), when its round limit is reached, or when its
 * combat is deleted. A sustained spell's tick (magicSkillBonuses.mjs
 * resolveChannelingTick) retargets whoever stands in its zone that round.
 *
 * Every other area spell that landed leaves a brief zone (`flash: true`) so
 * the whole table sees where it hit (user ruling 2026-11-20): in combat it
 * lasts until the turn changes (`expires.endOfTurn`), outside combat for
 * FLASH_SECONDS (`expires.at`, a GM clock time set when the GM creates it).
 *
 * MOVING ZONES (user rulings 2026-11-21)
 * -------------
 * A lasting burst with `area.move` keeps its centre and size in the flag
 * (`move, moveHexes, origin, size, startRound, movedRound`) and is rebuilt
 * around a new centre by the active GM:
 *   random  drifts by itself at each round top, one 1d6 per hex, clockwise
 *           from the top hex, with a chat line of the rolls (the tornadoes);
 *   steer   the caster moves it up to `moveHexes` with a hotbar chip
 *           (actionSuggestions.mjs), free, once per combat round.
 * Damage to whoever stands in a moving zone stays a table step until zone
 * triggers are built.
 */

import { isHostileSide } from "./movementZones.mjs";
import { isActorDead } from "./deadTokens.mjs";
import { getSpellPower } from "./spellPower.mjs";
import { resolveSpellPowerTokens } from "./spellCards.mjs";
import { getBaseSpellManaCost } from "./lindarCharge.mjs";

const SYSTEM_ID = "redsteel";
const SOCKET = "system.redsteel";
const ZONE_FLAG = "spellZone";
const SETTING = "spellAreaPlacement";

/** Socket message types (the active GM runs both). */
const MSG_CREATE = "spellZoneCreate";
const MSG_DELETE = "spellZoneDelete";
const MSG_MOVE = "spellZoneMove";

const SHAPES = new Set(["burst", "aura", "cone", "line", "trap", "wall"]);
/** What a wall's hexes block: nothing, vision only, or movement and vision. */
const WALL_BLOCKS = new Set(["sight", "solid"]);
/** How a lasting burst zone moves: by the caster's chip, or on its own. */
const MOVES = new Set(["steer", "random"]);

/** Bronze: the palette is grayscale and gold, never red. */
const ZONE_COLOR = "#a0703c";

/** The silhouette: bronze while placeable, steel gray when out of range. */
const PREVIEW_FILL = 0xa0703c;
const PREVIEW_LINE = 0xd9a86a;
const INVALID_FILL = 0x5a5a5a;
const INVALID_LINE = 0x8a8e90;
const PREVIEW_ALPHA_MIN = 0.16;
const PREVIEW_ALPHA_MAX = 0.34;
/** The confirm step's fixed alpha: placed, so it no longer breathes. */
const PLACED_ALPHA = 0.3;
/** One breath, in milliseconds. */
const PREVIEW_PERIOD = 1400;
/** Placement gives up after a minute of nothing. */
const PLACEMENT_TIMEOUT = 60_000;
/** Ranges this long or longer read as unlimited. */
const UNLIMITED_RANGE = 500;
/** How long a cast's brief zone stays outside combat. */
const FLASH_SECONDS = 10;

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function isActiveGM() {
  return game.user.isGM && game.users.activeGM?.id === game.user.id;
}

/** Run on the active GM: here if this is it, otherwise over the socket. */
function toGM(type, payload) {
  if (isActiveGM()) return handleGM({ type, payload });
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.SpellArea.NoGM"));
    return null;
  }
  game.socket.emit(SOCKET, { type, payload });
  return null;
}

const cellKey = ({ i, j }) => `${i},${j}`;

/** Canvas point under a mouse event. */
function canvasPoint(event) {
  const client = { x: event.clientX, y: event.clientY };
  return typeof canvas.canvasCoordinatesFromClient === "function"
    ? canvas.canvasCoordinatesFromClient(client)
    : canvas.stage.worldTransform.applyInverse(client);
}

/** The hexes a token covers, as offsets. Its centre hex when core says none. */
function occupiedOffsets(doc) {
  if (!doc || !canvas?.grid) return [];
  let offsets = [];
  try {
    offsets = doc.getOccupiedGridSpaceOffsets?.() ?? [];
  } catch (_error) {
    offsets = [];
  }
  if (offsets.length) return offsets.map(({ i, j }) => ({ i, j }));
  const center = doc.object?.center;
  if (!center) return [];
  try {
    const { i, j } = canvas.grid.getOffset({ x: center.x, y: center.y });
    return [{ i, j }];
  } catch (_error) {
    return [];
  }
}

/** Hex steps between two offsets, along the grid's direct path. */
function hexDistance(a, b) {
  const grid = canvas.grid;
  try {
    const path =
      grid.getDirectPath([grid.getCenterPoint(a), grid.getCenterPoint(b)]) ??
      [];
    return Math.max(0, path.length - 1);
  } catch (_error) {
    return Infinity;
  }
}

/** The nearest distance from any hex the caster covers to `cell`. */
function distanceFrom(casterCells, cell) {
  let best = Infinity;
  for (const from of casterCells) best = Math.min(best, hexDistance(from, cell));
  return best;
}

/**
 * The seed hexes plus `rings` rings around them, seeds first. Breadth-first
 * over the grid's adjacency, so ring n is exactly the hexes n steps away.
 */
function growCells(seeds, rings, grid = canvas.grid) {
  const seen = new Set();
  const cells = [];
  let frontier = [];
  for (const seed of seeds) {
    const k = cellKey(seed);
    if (seen.has(k)) continue;
    seen.add(k);
    cells.push({ i: seed.i, j: seed.j });
    frontier.push(seed);
  }
  for (let ring = 0; ring < rings; ring++) {
    const next = [];
    for (const cell of frontier) {
      for (const n of grid.getAdjacentOffsets({ i: cell.i, j: cell.j })) {
        const k = cellKey(n);
        if (seen.has(k)) continue;
        seen.add(k);
        cells.push({ i: n.i, j: n.j });
        next.push(n);
      }
    }
    frontier = next;
  }
  return cells;
}

/** Bearing from one canvas point to another, in degrees (canvas axes). */
function bearing(from, to) {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

/** The smallest angle between two bearings, 0..180. */
function angleBetween(a, b) {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

/**
 * The bearings of the six neighbours of a hex (the same for every hex on a
 * hex grid), sorted. Read off the grid so row and column hexes both work.
 */
function faceBearings(cell) {
  const centre = canvas.grid.getCenterPoint(cell);
  return canvas.grid
    .getAdjacentOffsets({ i: cell.i, j: cell.j })
    .map((n) => ((bearing(centre, canvas.grid.getCenterPoint(n)) % 360) + 360) % 360)
    .sort((a, b) => a - b);
}

/** The neighbour of `cell` lying towards `angle` (one of its face bearings). */
function stepToward(cell, angle) {
  const centre = canvas.grid.getCenterPoint(cell);
  let best = null;
  for (const n of canvas.grid.getAdjacentOffsets({ i: cell.i, j: cell.j })) {
    const d = angleBetween(bearing(centre, canvas.grid.getCenterPoint(n)), angle);
    if (!best || d < best.d) best = { n, d };
  }
  return { i: best.n.i, j: best.n.j };
}

/** The candidate closest to `angle`. */
function nearestBearing(candidates, angle) {
  return candidates.reduce((best, c) =>
    angleBetween(c, angle) < angleBetween(best, angle) ? c : best,
  );
}

/**
 * A cone, snapped to the hex grid so it never comes out gappy (a free
 * angle test leaves holes, since hexes only line up in six directions).
 * The origin counts as row 1 of `size` rows:
 *   angle ≤ 60 (the 45° cones): a triangle aimed between two hex faces,
 *     widening by one hex a row (1, 2, 3 ...);
 *   wider (the 90° cones): a wedge aimed straight out of a face, widening by
 *     two a row (1, 3, 5 ...).
 * `direction` is any bearing; the nearest aim the shape allows is taken.
 */
function coneCells(origin, direction, size, angle) {
  const depth = Math.max(1, size);
  const faces = faceBearings(origin);
  if (faces.length !== 6) return [{ i: origin.i, j: origin.j }];

  // The pairs of face directions whose triangles make up the cone.
  let pairs;
  if (angle <= 60) {
    const vertices = faces.map((f) => (f + 30) % 360);
    const aim = nearestBearing(vertices, direction);
    pairs = [[aim - 30, aim + 30]];
  } else {
    const aim = nearestBearing(faces, direction);
    pairs = [
      [aim - 60, aim],
      [aim, aim + 60],
    ];
  }

  const seen = new Set();
  const cells = [];
  for (const [fa, fb] of pairs) {
    let rowStart = { i: origin.i, j: origin.j };
    for (let a = 0; a < depth; a++) {
      let cell = rowStart;
      for (let b = 0; a + b < depth; b++) {
        const k = cellKey(cell);
        if (!seen.has(k)) {
          seen.add(k);
          cells.push({ i: cell.i, j: cell.j });
        }
        cell = stepToward(cell, fb);
      }
      rowStart = stepToward(rowStart, fa);
    }
  }
  return cells;
}

/**
 * A beam: the first `size` distinct hexes a ray from the caster's centre
 * towards `toward` passes through, sampled every quarter hex, leaving out the
 * caster's own hexes.
 */
function lineCells(from, toward, size, ownKeys) {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1 || size < 1) return [];
  const ux = dx / length;
  const uy = dy / length;
  const step = canvas.grid.size / 4;
  const limit = (size + ownKeys.size + 2) * canvas.grid.size * 2;
  const seen = new Set();
  const cells = [];
  for (let d = 0; cells.length < size && d <= limit; d += step) {
    const cell = canvas.grid.getOffset({ x: from.x + ux * d, y: from.y + uy * d });
    const k = cellKey(cell);
    if (ownKeys.has(k) || seen.has(k)) continue;
    seen.add(k);
    cells.push({ i: cell.i, j: cell.j });
  }
  return cells;
}

/**
 * The spell's reach in hexes: the largest number in `system.range`
 * ("6 - 80" reaches 80). No number ("Caster", "X", empty) or a very long
 * range means no limit, null.
 */
function spellRange(spell) {
  const numbers = String(spell?.system?.range ?? "").match(/\d+/g);
  if (!numbers) return null;
  const max = Math.max(...numbers.map(Number));
  if (!Number.isFinite(max) || max >= UNLIMITED_RANGE) return null;
  return max;
}

/** The caster's token on the viewed scene, as a document, or null. */
function casterTokenDoc(actor, token) {
  const sceneId = canvas?.scene?.id;
  if (!sceneId) return null;
  const given = token?.document ?? token ?? null;
  if (given?.parent?.id === sceneId && given.object) return given;
  return (
    actor
      ?.getActiveTokens?.(false, true)
      ?.find((d) => d.parent?.id === sceneId && d.object) ?? null
  );
}

/** Is this token one of the caster's own? */
function isCasterToken(doc, actorUuid, casterDocId) {
  if (!doc) return false;
  if (casterDocId && doc.id === casterDocId) return true;
  return !!actorUuid && doc.actor?.uuid === actorUuid;
}

/** Which side the caster fights on, with or without a token to read. */
function casterSide(actor, casterDoc) {
  return casterDoc
    ? isHostileSide(casterDoc)
    : actor?.type !== "character" && !actor?.system?.partyMember;
}

/**
 * The token documents standing in `cellKeys`: not dead, not the caster's
 * unless `includeCaster` (support spells), optionally only the visible ones
 * and only the other side.
 */
function occupants(scene, cellKeys, actor, casterDoc, { visibleOnly, enemiesOnly, includeCaster = false }) {
  const found = [];
  if (!scene) return found;
  const actorUuid = actor?.uuid ?? null;
  const side = enemiesOnly ? casterSide(actor, casterDoc) : null;
  for (const doc of scene.tokens?.contents ?? []) {
    if (!includeCaster && isCasterToken(doc, actorUuid, casterDoc?.id)) continue;
    if (isActorDead(doc.actor)) continue;
    if (visibleOnly && !doc.object?.visible) continue;
    if (enemiesOnly && isHostileSide(doc) === side) continue;
    if (!occupiedOffsets(doc).some((c) => cellKeys.has(cellKey(c)))) continue;
    found.push(doc);
  }
  return found;
}

/**
 * Make this user's targets exactly `ids` (token ids on the viewed scene),
 * releasing every other target.
 *
 * @param {string[]} ids
 */
export function setUserTargets(ids) {
  const want = new Set(ids ?? []);
  for (const token of [...game.user.targets]) {
    if (!want.has(token.id)) token.setTarget(false, { releaseOthers: false });
  }
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (!want.has(token.id) || game.user.targets.has(token)) continue;
    token.setTarget(true, { releaseOthers: false });
  }
}

/* -------------------------------------------------------------------------- */
/*  Reading a spell                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The spell's area, normalised, or null when it has none.
 *
 * @param {Item} spell
 * @returns {{shape: string, size: number, angle: number, targets: string,
 *   includeCaster: boolean, linger: boolean, rounds: string,
 *   move: ""|"steer"|"random", moveHexes: number}|null}
 */
export function spellArea(spell) {
  const area = spell?.system?.area;
  const shape = String(area?.shape ?? "").trim();
  if (!SHAPES.has(shape)) return null;
  const move = MOVES.has(area.move) ? area.move : "";
  return {
    shape,
    size: Math.max(0, Math.floor(Number(area.size) || 0)),
    angle: Math.max(0, Number(area.angle) || 0),
    targets: area.targets === "enemies" ? "enemies" : "all",
    includeCaster: area.includeCaster === true,
    linger: area.linger === true,
    rounds: area.rounds == null ? "" : String(area.rounds).trim(),
    move,
    moveHexes: move ? Math.max(0, Math.floor(Number(area.moveHexes) || 0)) : 0,
    // Traps (shape "trap"): stop the walker, may sit next to another trap,
    // show an image of the caster.
    stops: area.stops === true,
    mayBorder: area.mayBorder === true,
    decoy: area.decoy === true,
    // Walls (shape "wall"): the most hexes (a formula, "" = no limit), what
    // the hexes block, whether crossing sets the spell off, whether occupied
    // hexes may be covered, and how many hexes one payment of the cost buys.
    length: area.length == null ? "" : String(area.length).trim(),
    blocks: WALL_BLOCKS.has(area.blocks) ? area.blocks : "",
    crossing: area.crossing === true,
    occupiedOk: area.occupiedOk === true,
    hexesPerCost: Math.max(0, Math.floor(Number(area.hexesPerCost) || 0)),
  };
}

/**
 * A lingering zone's round limit: a number or a formula with the description
 * Spell Power token. Empty (the template default is "", which `?? 0` would
 * not catch) or anything that does not evaluate means no limit, 0.
 */
function zoneRounds(actor, spell, rounds) {
  const raw = String(rounds ?? "").trim();
  if (!raw) return 0;
  const power = getSpellPower(actor, spell?.system?.type);
  const text = resolveSpellPowerTokens(raw, power).replace(
    /\bspellPower\b/gi,
    String(power),
  );
  let value = Number(text);
  if (!Number.isFinite(value)) {
    try {
      value = Number(Roll.safeEval(text));
    } catch (_error) {
      value = 0;
    }
  }
  // A halved Spell Power of 1 is 0.5: floored it would read as "no limit",
  // so any positive result lasts at least one round.
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 0;
}

/* -------------------------------------------------------------------------- */
/*  Placement                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The hexes drawn on canvas.controls, above the tokens (the aim.mjs overlay
 * rule). Breathing while being placed, steady once placed.
 */
function createOverlay({ breathe = true } = {}) {
  const host = canvas.controls ?? canvas.interface;
  const gfx = new PIXI.Graphics();
  gfx.eventMode = "none";
  gfx.zIndex = 950;
  host.sortableChildren = true;
  host.addChild(gfx);

  let drawnKey = null;
  const draw = (cells, valid = true) => {
    const key = cells?.length
      ? `${valid ? 1 : 0}|${cells.map(cellKey).join(";")}`
      : null;
    if (key === drawnKey) return;
    drawnKey = key;
    gfx.clear();
    if (!key) return;
    const width = Math.max(2, canvas.grid.size * 0.03);
    for (const cell of cells) {
      const points = canvas.grid.getVertices(cell).flatMap((p) => [p.x, p.y]);
      gfx.lineStyle(width, valid ? PREVIEW_LINE : INVALID_LINE, 0.9);
      gfx.beginFill(valid ? PREVIEW_FILL : INVALID_FILL, 1);
      gfx.drawPolygon(points);
      gfx.endFill();
    }
  };

  const start = performance.now();
  const tick = () => {
    if (gfx.destroyed) return;
    const t = ((performance.now() - start) % PREVIEW_PERIOD) / PREVIEW_PERIOD;
    const wave = (1 - Math.cos(t * Math.PI * 2)) / 2;
    gfx.alpha = PREVIEW_ALPHA_MIN + (PREVIEW_ALPHA_MAX - PREVIEW_ALPHA_MIN) * wave;
  };
  if (breathe) {
    tick();
    canvas.app.ticker.add(tick);
  } else {
    gfx.alpha = PLACED_ALPHA;
  }

  const destroy = () => {
    if (breathe) canvas.app?.ticker?.remove(tick);
    if (!gfx.destroyed) gfx.destroy();
  };
  return { draw, destroy };
}

/**
 * One placement phase. `compute(point)` turns the cursor's canvas point into
 * `{cells, valid, reason}`; the silhouette follows it and a left click on the
 * board accepts it, unless it is not valid (then `reason` is shown, if any,
 * and the click is refused). Right click, Escape or a minute of nothing
 * cancels. Clicks and the Escape are swallowed so they neither select a
 * token nor close a window.
 *
 * @returns {Promise<object|null>} The accepted state, or null.
 */
function interact(compute) {
  const board = document.getElementById("board");
  if (!board || !canvas?.ready) return Promise.resolve(null);
  const overlay = createOverlay({ breathe: true });

  return new Promise((resolve) => {
    let timer = null;
    const finish = (value) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
      overlay.destroy();
      resolve(value);
    };
    const onMove = (event) => {
      // Off the board (over the sidebar, the hotbar ...) the silhouette hides.
      if (event.target !== board) return overlay.draw(null);
      const state = compute(canvasPoint(event));
      overlay.draw(state?.cells, state?.valid !== false);
    };
    // On the window in the capture phase, so it runs before the canvas's own
    // handlers; clicks on the UI pass untouched.
    const onPointer = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button !== 0) return finish(null);
      const state = compute(canvasPoint(event));
      if (!state?.cells?.length) return;
      if (state.valid === false) {
        if (state.reason) ui.notifications.warn(state.reason);
        return;
      }
      finish(state);
    };
    // The right click that cancels must not open a token HUD behind it.
    const onContext = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey, true);
    timer = setTimeout(() => finish(null), PLACEMENT_TIMEOUT);
  });
}

/** Burst: the hovered hex and its rings, refused beyond the range. */
async function placeBurst({ area, range, casterCells, label }) {
  ui.notifications.info(
    game.i18n.format("REDSTEEL.SpellArea.PickArea", { spell: label }),
  );
  const cache = new Map();
  const state = await interact((point) => {
    const centre = canvas.grid.getOffset(point);
    const k = cellKey(centre);
    if (cache.has(k)) return cache.get(k);
    const distance = distanceFrom(casterCells, centre);
    const valid = range === null || distance <= range;
    const result = {
      cells: growCells([centre], area.size),
      valid,
      reason: valid
        ? null
        : game.i18n.format("REDSTEEL.SpellArea.OutOfRange", {
            spell: label,
            range,
          }),
      origin: { i: centre.i, j: centre.j },
    };
    cache.set(k, result);
    return result;
  });
  return state ? { cells: state.cells, origin: state.origin, direction: null } : null;
}

/** Facing (token rotation, 0 = south) to a canvas bearing, and back. */
const rotationToBearing = (rotation) => ((((Number(rotation) || 0) + 90) % 360) + 360) % 360;
const bearingToRotation = (b) => ((((b - 90) % 360) + 360) % 360);

/**
 * Cone: it starts at the caster, facing the way the token faces (user
 * ruling 2026-11-21). The mouse wheel turns it and the token's facing with
 * it; Shift + wheel pushes the first hex one hex further out and back. A
 * click (or Enter) casts, right click or Escape cancels and restores the
 * facing.
 *
 * Positions: a wide cone (over 60°) is a wedge aimed out of a face, six
 * positions. A narrow cone is a 1-2-3 triangle, which always leans to one
 * side of the face hex it starts from; it gets twelve positions, each face
 * leaning anticlockwise then clockwise, so a wheel tick turns it about 30°.
 * The token faces the face hex the cone starts from.
 */
async function placeCone({ area, casterDoc, casterCells, label }) {
  const board = document.getElementById("board");
  if (!board || !canvas?.ready) return null;
  const own = new Set(casterCells.map(cellKey));
  const centrePoint = casterDoc.object?.center ?? canvas.grid.getCenterPoint(casterCells[0]);
  const centreCell = canvas.grid.getOffset(centrePoint);
  const faces = faceBearings(centreCell);
  if (faces.length !== 6) return null;

  const narrow = area.angle <= 60;
  const positions = narrow
    ? faces.flatMap((face) => [
        { face, aim: (face + 330) % 360 },
        { face, aim: (face + 30) % 360 },
      ])
    : faces.map((face) => ({ face, aim: face }));

  const startRotation = Number(casterDoc.rotation) || 0;
  const startFace = nearestBearing(faces, rotationToBearing(startRotation));
  // Start on the token's face, leaning clockwise for a narrow cone.
  let index = positions.findIndex(
    (p) => p.face === startFace && (!narrow || p.aim === (startFace + 30) % 360),
  );
  if (index < 0) index = 0;
  let gap = 0;

  const build = () => {
    const { face, aim } = positions[index];
    // The first hex: out of the caster's own hexes along the face, then the gap.
    let origin = { i: centreCell.i, j: centreCell.j };
    for (let guard = 0; own.has(cellKey(origin)) && guard < 20; guard++) {
      origin = stepToward(origin, face);
    }
    for (let g = 0; g < gap; g++) origin = stepToward(origin, face);
    return { cells: coneCells(origin, aim, area.size, area.angle), origin, direction: aim, face };
  };

  // The token's facing follows the cone, written a beat after the wheel
  // stops so a fast spin is one update.
  let facingTimer = null;
  let writtenRotation = startRotation;
  const writeFacing = (rotation) => {
    if (rotation === writtenRotation) return;
    writtenRotation = rotation;
    casterDoc.update({ rotation }).catch((err) =>
      console.error("Redsteel | Cone facing update failed", err),
    );
  };
  const queueFacing = (face) => {
    clearTimeout(facingTimer);
    facingTimer = setTimeout(() => writeFacing(bearingToRotation(face)), 150);
  };

  ui.notifications.info(game.i18n.format("REDSTEEL.SpellArea.PickConeAim", { spell: label }));
  const overlay = createOverlay({ breathe: true });
  let state = build();
  overlay.draw(state.cells, true);
  queueFacing(state.face);

  return new Promise((resolve) => {
    let timer = null;
    let wheelLock = 0;
    const finish = (confirmed) => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
      clearTimeout(facingTimer);
      overlay.destroy();
      if (!confirmed) {
        writeFacing(startRotation);
        return resolve(null);
      }
      writeFacing(bearingToRotation(state.face));
      resolve({
        cells: state.cells,
        origin: state.origin,
        direction: state.direction,
        restoreFacing: () => writeFacing(startRotation),
      });
    };
    const onWheel = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // Shift + wheel comes through as a sideways scroll in some browsers.
      const delta = event.deltaY || event.deltaX;
      if (!delta) return;
      // One step per notch: touchpads send a stream of small deltas.
      const now = performance.now();
      if (now < wheelLock) return;
      wheelLock = now + 90;
      if (event.shiftKey) {
        const next = delta < 0 ? 1 : 0;
        if (next === gap) return;
        gap = next;
      } else {
        index = (index + (delta > 0 ? 1 : -1) + positions.length) % positions.length;
      }
      state = build();
      overlay.draw(state.cells, true);
      queueFacing(state.face);
    };
    const onPointer = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(event.button === 0);
    };
    const onContext = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKey = (event) => {
      if (event.key !== "Escape" && event.key !== "Enter") return;
      const el = event.target;
      if (event.key === "Enter" &&
          (el?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(event.key === "Enter");
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey, true);
    timer = setTimeout(() => finish(false), PLACEMENT_TIMEOUT);
  });
}

/** Line: from next to the caster towards the cursor. */
async function placeLine({ area, casterDoc, casterCells, label }) {
  ui.notifications.info(
    game.i18n.format("REDSTEEL.SpellArea.PickDirection", { spell: label }),
  );
  const ownKeys = new Set(casterCells.map(cellKey));
  const from = casterDoc.object?.center ?? canvas.grid.getCenterPoint(casterCells[0]);
  const state = await interact((point) => {
    const cells = lineCells(from, point, area.size, ownKeys);
    return {
      cells,
      valid: cells.length > 0,
      direction: bearing(from, point),
    };
  });
  return state
    ? { cells: state.cells, origin: state.cells[0] ?? null, direction: state.direction }
    : null;
}

/* -------------------------------------------------------------------------- */
/*  Confirm step                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How far from the bottom of the window the confirm panel sits: just above
 * whichever hotbar is showing (Redsteel's own panel or Foundry's), so it
 * never covers the board where the area tends to be.
 */
function panelBottomOffset() {
  const tops = ["#redsteel-bg3-hotbar", "#hotbar"]
    .map((sel) => document.querySelector(sel))
    .filter((el) => el?.offsetParent)
    .map((el) => el.getBoundingClientRect().top)
    .filter((top) => top > window.innerHeight / 2);
  if (!tops.length) return 110;
  return Math.round(window.innerHeight - Math.min(...tops) + 12);
}

/** The confirm panel: a stone plate centred just above the hotbar. */
function createPanel(label) {
  const panel = document.createElement("div");
  panel.className = "rs-spell-area-confirm";
  panel.style.cssText = [
    "position: fixed",
    `bottom: ${panelBottomOffset()}px`,
    "left: 50%",
    "transform: translateX(-50%)",
    "z-index: 1000",
    "min-width: 280px",
    "padding: 8px 14px 10px",
    "background: var(--rs-chat-bg, #0f0f0f)",
    "border: 1px solid rgba(160, 112, 60, 0.7)",
    "box-shadow: 0 2px 10px rgba(0, 0, 0, 0.7)",
    "color: var(--rs-chat-text, #b8bbbd)",
    'font-family: Georgia, "Times New Roman", serif',
    "text-align: center",
  ].join("; ");

  const title = document.createElement("div");
  title.style.cssText =
    "font-weight: bold; font-size: 15px; color: var(--rs-chat-text-strong, #cdd0d2); padding-bottom: 4px; border-bottom: 1px solid rgba(160, 112, 60, 0.45);";
  const hint = document.createElement("div");
  hint.style.cssText =
    "font-size: 12px; color: var(--rs-chat-text-dim, #8a8e90); margin: 6px 0 8px;";
  hint.textContent = game.i18n.localize("REDSTEEL.SpellArea.ClickToToggle");

  const row = document.createElement("div");
  row.style.cssText = "display: flex; gap: 8px; justify-content: center;";
  const button = (key) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = game.i18n.localize(key);
    b.style.cssText =
      'flex: 1; font-family: Georgia, "Times New Roman", serif; background: var(--rs-chat-bg-alt, #181818); color: var(--rs-chat-text-strong, #cdd0d2); border: 1px solid rgba(160, 112, 60, 0.6); border-radius: 0;';
    return b;
  };
  const cast = button("REDSTEEL.SpellArea.Cast");
  const cancel = button("REDSTEEL.SpellArea.Cancel");
  row.append(cast, cancel);
  panel.append(title, hint, row);
  document.body.append(panel);

  const update = () => {
    title.textContent = game.i18n.format("REDSTEEL.SpellArea.ConfirmTitle", {
      spell: label,
      count: game.user.targets.size,
    });
  };
  update();
  return { cast, cancel, update, remove: () => panel.remove() };
}

/** The topmost token under a canvas point the user may target, or null. */
function tokenAt(point) {
  let best = null;
  for (const token of canvas.tokens.placeables) {
    if (!game.user.isGM && !token.visible) continue;
    if (!token.bounds?.contains(point.x, point.y)) continue;
    const rank = [Number(token.document.elevation) || 0, Number(token.document.sort) || 0];
    if (
      !best ||
      rank[0] > best.rank[0] ||
      (rank[0] === best.rank[0] && rank[1] >= best.rank[1])
    ) {
      best = { token, rank };
    }
  }
  return best?.token ?? null;
}

/**
 * Show the placed hexes, target everyone in them and let the caster click
 * tokens on and off. Enter or Cast confirms; Escape, right click on the board
 * or Cancel restores the previous targets.
 *
 * @returns {Promise<string[]|null>} The final target ids, or null on cancel.
 */
function confirmTargets({ actor, casterDoc, area, cells, label }) {
  const board = document.getElementById("board");
  const previous = [...game.user.targets].map((t) => t.id);
  const overlay = createOverlay({ breathe: false });
  overlay.draw(cells, true);

  const initial = occupants(canvas.scene, new Set(cells.map(cellKey)), actor, casterDoc, {
    visibleOnly: !game.user.isGM,
    enemiesOnly: area.targets === "enemies",
    includeCaster: area.includeCaster,
  });
  setUserTargets(initial.map((d) => d.id));
  const panel = createPanel(label);
  const actorUuid = actor?.uuid ?? null;

  return new Promise((resolve) => {
    let done = false;
    const finish = (confirmed) => {
      if (done) return;
      done = true;
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      overlay.destroy();
      panel.remove();
      if (!confirmed) {
        setUserTargets(previous);
        return resolve(null);
      }
      resolve([...game.user.targets].map((t) => t.id));
    };
    const refresh = () => {
      panel.update();
      // A target change can settle a tick later; read the count again then.
      setTimeout(() => !done && panel.update(), 0);
    };
    const onPointer = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button !== 0) return finish(false);
      const token = tokenAt(canvasPoint(event));
      if (!token) return;
      if (!area.includeCaster && isCasterToken(token.document, actorUuid, casterDoc?.id)) return;
      token.setTarget(!game.user.targets.has(token), { releaseOthers: false });
      refresh();
    };
    const onContext = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        return finish(false);
      }
      if (event.key !== "Enter") return;
      // Enter in the chat box or any other field stays theirs.
      const el = event.target;
      if (el?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(true);
    };
    panel.cast.addEventListener("click", () => finish(true));
    panel.cancel.addEventListener("click", () => finish(false));
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * Place a spell's area and settle its targets. Called before anything of the
 * cast is paid.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {Token|TokenDocument|null} [token]  The caster's token, if known.
 * @returns {Promise<{sceneId: string, shape: string, cells: {i:number,j:number}[],
 *   origin: {i:number,j:number}|null, direction: number|null,
 *   targetIds: string[]}|{skipped: true}|null>} Null when the caster backed
 *   out; `{skipped: true}` when the spell should be cast on hand-picked
 *   targets as before.
 */
export async function placeSpellArea(actor, spell, token = null, { freeCast = false } = {}) {
  const area = spellArea(spell);
  if (!area) return { skipped: true };
  if (!game.settings.get(SYSTEM_ID, SETTING)) return { skipped: true };
  if (!canvas?.ready || !canvas.scene || !canvas.grid || canvas.grid.isGridless) {
    return { skipped: true };
  }
  if (!document.getElementById("board")) return { skipped: true };

  const casterDoc = casterTokenDoc(actor, token);
  const casterCells = casterDoc ? occupiedOffsets(casterDoc) : [];
  if (!casterDoc || !casterCells.length) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.SpellArea.NoCanvas"));
    return { skipped: true };
  }

  const label = spell.localizedName ?? spell.name;
  const range = spellRange(spell);
  const ctx = { area, range, casterDoc, casterCells, label };
  if (area.shape === "wall") ctx.max = wallMaxHexes(actor, spell, area, freeCast);

  let placed = null;
  switch (area.shape) {
    case "burst":
      placed = await placeBurst(ctx);
      break;
    case "aura":
      placed = {
        cells: growCells(casterCells, area.size),
        origin: casterCells[0],
        direction: null,
      };
      break;
    case "cone":
      placed = await placeCone(ctx);
      break;
    case "line":
      placed = await placeLine(ctx);
      break;
    case "trap":
      placed = await placeTrap(ctx);
      break;
    case "wall":
      placed = await placeWall(ctx);
      break;
  }
  if (!placed?.cells?.length) return null;

  // A trap is aimed at nobody yet: no confirm step, and the card goes out
  // with no targets (the trap's victims are chosen when it goes off).
  if (area.shape === "trap") {
    setUserTargets([]);
    return {
      sceneId: canvas.scene.id,
      shape: "trap",
      cells: placed.cells,
      origin: placed.origin,
      direction: null,
      targetIds: [],
      decoyTile: area.decoy ? decoyTileData(casterDoc, placed.origin) : null,
    };
  }

  // A wall over empty hexes is aimed at nobody (whoever crosses it is hit
  // later); one that may cover occupied hexes (Ice wall) targets who stands
  // there through the usual confirm step below.
  if (area.shape === "wall" && !area.occupiedOk) {
    setUserTargets([]);
    return {
      sceneId: canvas.scene.id,
      shape: "wall",
      cells: placed.cells,
      origin: placed.origin,
      direction: null,
      targetIds: [],
      crossing: area.crossing,
    };
  }

  const targetIds = await confirmTargets({
    actor,
    casterDoc,
    area,
    cells: placed.cells,
    label,
  });
  if (!targetIds) {
    // Backing out of the targets undoes a cone's turn of the token too.
    placed.restoreFacing?.();
    return null;
  }

  return {
    sceneId: canvas.scene.id,
    shape: area.shape,
    cells: placed.cells,
    origin: placed.origin ?? null,
    direction: placed.direction ?? null,
    targetIds,
  };
}

/* -------------------------------------------------------------------------- */
/*  Zones                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Leave the cast's area on the map as a Region. Built here, created by the
 * active GM. The caller decides that the spell landed, and whether it lingers
 * or only shows where it hit (`flash`).
 *
 * @param {{actor: Actor, spell: Item, area: object, castMessageId?: string|null,
 *   channelingEffectId?: string|null, flash?: boolean}} options  `area` is
 *   placeSpellArea's result.
 */
export async function createSpellZone({
  actor,
  spell,
  area,
  castMessageId = null,
  channelingEffectId = null,
  flash = false,
}) {
  const scene = game.scenes.get(area?.sceneId);
  if (!scene || !area.cells?.length) return null;
  const grid = gridFor(scene);
  if (typeof grid?.getVertices !== "function") return null;
  const shapes = regionShapes(grid, area.cells);

  // A lasting burst that moves keeps its centre and size, so it can be
  // rebuilt one hex over (moveZone). Only bursts: a moved cone or beam would
  // need its bearing as well, and no moving spell is one.
  const spellInfo = spellArea(spell);
  const movable =
    !flash && spellInfo?.move && spellInfo.moveHexes > 0 &&
    area.shape === "burst" && area.origin
      ? {
          move: spellInfo.move,
          moveHexes: spellInfo.moveHexes,
          origin: { i: area.origin.i, j: area.origin.j },
          size: spellInfo.size,
        }
      : null;

  const combat = game.combat;
  // The round it was made in: a drifting zone first moves at the next round
  // top, and a round rewound to before it never moves it again.
  if (movable && combat?.started) {
    movable.startRound = { combatId: combat.id, round: combat.round };
  }
  let expires = null;
  if (flash) {
    expires = combat?.started
      ? { combatId: combat.id, round: combat.round, turn: combat.turn, endOfTurn: true }
      : { seconds: FLASH_SECONDS };
  } else {
    const rounds = zoneRounds(actor, spell, spellArea(spell)?.rounds);
    if (rounds > 0 && combat?.started) {
      expires = { combatId: combat.id, round: combat.round + rounds };
    }
  }

  const spellName = spell.localizedName ?? spell.name;
  // A trap is hidden from the other side. A party caster's trap is seen by
  // every player (the players are the party, user ruling 2026-11-21); an
  // enemy's only by the GM and whoever owns that caster.
  const isTrap = area.shape === "trap";
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  if (isTrap) {
    const casterToken =
      scene.tokens?.contents?.find((d) => d.actor?.uuid === actor.uuid) ?? null;
    const enemyCaster = casterSide(actor, casterToken);
    for (const user of game.users.contents) {
      if (user.isGM) continue;
      if (!enemyCaster || actor.testUserPermission?.(user, "OWNER")) {
        ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
      }
    }
  }
  const isWall = area.shape === "wall";
  const data = {
    name: game.i18n.format(
      isTrap
        ? "REDSTEEL.SpellArea.TrapZoneName"
        : isWall
          ? "REDSTEEL.SpellArea.WallZoneName"
          : "REDSTEEL.SpellArea.ZoneName",
      { spell: spellName, caster: actor.name },
    ),
    color: ZONE_COLOR,
    shapes,
    visibility: isTrap ? CONST.REGION_VISIBILITY.OBSERVER : CONST.REGION_VISIBILITY.ALWAYS,
    ownership,
    flags: {
      [SYSTEM_ID]: {
        [ZONE_FLAG]: {
          casterUuid: actor.uuid,
          spellId: spell.id,
          spellName,
          castMessageId: castMessageId ?? null,
          channelingEffectId: channelingEffectId ?? null,
          cells: area.cells.map(({ i, j }) => ({ i, j })),
          flash,
          expires,
          // Moving zones: {move, moveHexes, origin, size}, plus `movedRound`
          // ({combatId, round}) once it has moved in a round.
          ...(movable ?? {}),
          // Traps: {blast, stops, decoy, tileId}; set off by detonateTrap.
          ...(isTrap && {
            trap: {
              blast: spellInfo?.size ?? 0,
              stops: spellInfo?.stops === true,
              decoy: spellInfo?.decoy === true,
              tileId: null,
              // The cast to finish when it goes off (castSpell.mjs trapCast).
              cast: area.trapCast ?? null,
            },
          }),
          // Walls: {blocks, crossing, stops, enemiesOnly, cast}; crossing ones
          // are set off by detonateWall, blocking ones raise Foundry walls.
          ...(isWall && {
            wall: {
              blocks: spellInfo?.blocks ?? "",
              crossing: spellInfo?.crossing === true,
              stops: spellInfo?.stops === true,
              enemiesOnly: spellInfo?.targets === "enemies",
              cast: area.trapCast ?? null,
            },
          }),
        },
      },
    },
  };
  return toGM(MSG_CREATE, {
    sceneId: scene.id,
    data,
    decoyTile: isTrap ? (area.decoyTile ?? null) : null,
    wallEdges: isWall && spellInfo?.blocks ? perimeterEdges(grid, area.cells) : null,
  });
}

/** A scene's grid: the live canvas one when it is the viewed scene. */
function gridFor(scene) {
  return canvas?.scene?.id === scene?.id && canvas.grid ? canvas.grid : scene?.grid;
}

/** One polygon per hex, the Region shapes of a zone. */
function regionShapes(grid, cells) {
  return cells.map((cell) => ({
    type: "polygon",
    hole: false,
    points: grid.getVertices({ i: cell.i, j: cell.j }).flatMap((p) => [p.x, p.y]),
  }));
}

/* -------------------------------------------------------------------------- */
/*  Moving zones                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Rebuild a moving zone around a new centre. Active GM only (Regions are
 * GM documents). `round` stamps the round it moved in, which is what holds
 * a steered zone to once a round and a drifting one to one drift a round.
 */
async function moveZone(region, origin, round = null) {
  const info = region?.getFlag?.(SYSTEM_ID, ZONE_FLAG);
  const scene = region?.parent;
  const grid = gridFor(scene);
  if (!info?.move || !origin || typeof grid?.getVertices !== "function") return;
  const cells = growCells([origin], Number(info.size) || 0, grid);
  await region.update({
    shapes: regionShapes(grid, cells),
    [`flags.${SYSTEM_ID}.${ZONE_FLAG}.origin`]: { i: origin.i, j: origin.j },
    [`flags.${SYSTEM_ID}.${ZONE_FLAG}.cells`]: cells,
    ...(round ? { [`flags.${SYSTEM_ID}.${ZONE_FLAG}.movedRound`]: round } : {}),
  });
}

/** Did this zone already move in the given combat round? */
function movedThisRound(info, combat) {
  return (
    !!combat &&
    info?.movedRound?.combatId === combat.id &&
    Number(info.movedRound.round) === Number(combat.round)
  );
}

/**
 * The six neighbours of a hex in reading order for a 1d6: clockwise from the
 * top hex (the one at or just past north). Index 0 is a roll of 1.
 */
function clockwiseNeighbours(grid, cell) {
  const centre = grid.getCenterPoint(cell);
  return grid
    .getAdjacentOffsets({ i: cell.i, j: cell.j })
    .map((n) => {
      const p = grid.getCenterPoint(n);
      // Canvas y points down, so north is -90 degrees; shift it to 0.
      const compass = ((bearing(centre, p) + 90) % 360 + 360) % 360;
      return { cell: { i: n.i, j: n.j }, compass: Math.round(compass * 1000) / 1000, p };
    })
    .sort((a, b) => a.compass - b.compass);
}

/**
 * Random drift at the top of a round (Burning Tornado, Lightning tornado):
 * one 1d6 per hex, counting clockwise from the top hex. A step whose hex lies
 * off the scene is skipped. Posts one chat line with the rolls. Active GM.
 */
async function driftZone(region, combat) {
  const info = region.getFlag(SYSTEM_ID, ZONE_FLAG);
  const scene = region.parent;
  const grid = gridFor(scene);
  if (!info?.origin || typeof grid?.getAdjacentOffsets !== "function") return;
  const rect = scene.dimensions?.sceneRect;

  let at = { i: info.origin.i, j: info.origin.j };
  const rolls = [];
  let skipped = false;
  for (let step = 0; step < (Number(info.moveHexes) || 0); step++) {
    const roll = await new Roll("1d6").evaluate();
    rolls.push(roll);
    const next = clockwiseNeighbours(grid, at)[roll.total - 1];
    if (!next) continue;
    if (rect && !rect.contains(next.p.x, next.p.y)) {
      skipped = true;
      continue;
    }
    at = next.cell;
  }
  await moveZone(region, at, { combatId: combat.id, round: combat.round });

  const lines = [
    `<p>${game.i18n.format("REDSTEEL.SpellArea.DriftRolls", {
      rolls: rolls.map((r) => r.total).join(", "),
    })}</p>`,
  ];
  if (skipped) lines.push(`<p>${game.i18n.localize("REDSTEEL.SpellArea.DriftEdge")}</p>`);
  await ChatMessage.create({
    speaker: { alias: game.i18n.format("REDSTEEL.SpellArea.DriftTitle", { spell: info.spellName }) },
    content: lines.join(""),
    rolls,
  });
}

/** Drift every random-moving zone of this combat once for its new round. */
async function driftZones(combat) {
  for (const scene of game.scenes.contents) {
    for (const region of scene.regions?.contents ?? []) {
      const info = region.getFlag(SYSTEM_ID, ZONE_FLAG);
      if (info?.move !== "random") continue;
      // Only zones made in this combat; a zone made outside one does not
      // know which round tops belong to it.
      if (info.expires?.combatId !== combat.id) continue;
      // Forward only: past the round it was made in and the last it moved in.
      const last = Math.max(
        info.startRound?.combatId === combat.id ? Number(info.startRound.round) || 0 : 0,
        info.movedRound?.combatId === combat.id ? Number(info.movedRound.round) || 0 : 0,
      );
      if (Number(combat.round) <= last) continue;
      await driftZone(region, combat);
    }
  }
}

/**
 * The steered zones this actor may move now, on the viewed scene: its own
 * zones marked `steer` that have not moved this round. Outside a started
 * combat there is no round to count, so they can always move.
 *
 * @param {Actor} actor
 * @returns {{regionId: string, spellName: string, spellId: string,
 *   moveHexes: number}[]}
 */
export function steerableZones(actor) {
  if (!actor || !canvas?.scene) return [];
  const combat = game.combat?.started ? game.combat : null;
  const out = [];
  for (const region of canvas.scene.regions?.contents ?? []) {
    const info = region.getFlag(SYSTEM_ID, ZONE_FLAG);
    if (info?.move !== "steer" || info.casterUuid !== actor.uuid) continue;
    if (movedThisRound(info, combat)) continue;
    out.push({
      regionId: region.id,
      spellName: info.spellName,
      spellId: info.spellId,
      moveHexes: Number(info.moveHexes) || 0,
    });
  }
  return out;
}

/**
 * The caster moves a steered zone: it follows the cursor within its hexes
 * per round of where it stands, a click drops it there (the GM moves the
 * Region). Free; once per combat round.
 *
 * @param {Actor} actor
 * @param {string} regionId  On the viewed scene.
 * @returns {Promise<boolean>} Whether a move was sent.
 */
export async function steerSpellZone(actor, regionId) {
  const region = canvas?.scene?.regions?.get(regionId);
  const info = region?.getFlag(SYSTEM_ID, ZONE_FLAG);
  if (!actor || !info?.origin || info.move !== "steer" || info.casterUuid !== actor.uuid) {
    return false;
  }
  const combat = game.combat?.started ? game.combat : null;
  if (movedThisRound(info, combat)) return false;

  const hexes = Number(info.moveHexes) || 0;
  const label = info.spellName;
  ui.notifications.info(
    game.i18n.format("REDSTEEL.SpellArea.PickMove", { spell: label, hexes }),
  );
  const from = { i: info.origin.i, j: info.origin.j };
  const cache = new Map();
  const state = await interact((point) => {
    const centre = canvas.grid.getOffset(point);
    const k = cellKey(centre);
    if (cache.has(k)) return cache.get(k);
    const valid = hexDistance(from, centre) <= hexes;
    const result = {
      cells: growCells([centre], Number(info.size) || 0),
      valid,
      reason: valid
        ? null
        : game.i18n.format("REDSTEEL.SpellArea.MoveTooFar", { spell: label, hexes }),
      origin: { i: centre.i, j: centre.j },
    };
    cache.set(k, result);
    return result;
  });
  if (!state || cellKey(state.origin) === cellKey(from)) return false;
  await toGM(MSG_MOVE, {
    sceneId: canvas.scene.id,
    regionId,
    origin: state.origin,
    round: combat ? { combatId: combat.id, round: combat.round } : null,
  });
  return true;
}

/**
 * The token ids standing in a zone right now: the auto-target filter without
 * the visibility check. `spell` decides an enemies-only zone; without it the
 * zone's spell is looked up on the caster, then in the world.
 *
 * @param {Region|RegionDocument} region
 * @param {Actor} casterActor
 * @param {{spell?: Item|null}} [options]
 * @returns {string[]}
 */
export function zoneOccupantIds(region, casterActor, { spell = null } = {}) {
  const doc = region?.document ?? region;
  const info = doc?.getFlag?.(SYSTEM_ID, ZONE_FLAG);
  const scene = doc?.parent;
  if (!info?.cells?.length || !scene) return [];
  const zoneSpell =
    spell ??
    casterActor?.items?.get(info.spellId) ??
    game.items?.get(info.spellId) ??
    null;
  const casterDoc =
    scene.tokens?.contents?.find((d) => d.actor?.uuid === casterActor?.uuid) ??
    null;
  const zoneArea = spellArea(zoneSpell);
  return occupants(scene, new Set(info.cells.map(cellKey)), casterActor, casterDoc, {
    visibleOnly: false,
    enemiesOnly: zoneArea?.targets === "enemies",
    includeCaster: zoneArea?.includeCaster === true,
  }).map((d) => d.id);
}

/** Every spell zone, on any scene, that `test(info)` picks. Active GM only. */
async function deleteZones(test) {
  for (const scene of game.scenes.contents) {
    const ids = [];
    for (const region of scene.regions?.contents ?? []) {
      const info = region.getFlag(SYSTEM_ID, ZONE_FLAG);
      if (info && test(info)) ids.push(region.id);
    }
    if (ids.length) await scene.deleteEmbeddedDocuments("Region", ids);
  }
}

async function handleGM({ type, payload }) {
  if (!isActiveGM() || !payload) return;
  if (type === MSG_CREATE) {
    const scene = game.scenes.get(payload.sceneId);
    if (!scene || !payload.data) return;
    // A timed zone runs on this GM's clock, never the caster's.
    const expires = payload.data.flags?.[SYSTEM_ID]?.[ZONE_FLAG]?.expires;
    if (expires?.seconds) {
      expires.at = Date.now() + Number(expires.seconds) * 1000;
      delete expires.seconds;
    }
    // A Decoy's image is a Tile everyone sees; the trap Region records it.
    if (payload.decoyTile) {
      const [tile] = await scene.createEmbeddedDocuments("Tile", [payload.decoyTile]);
      const trap = payload.data.flags?.[SYSTEM_ID]?.[ZONE_FLAG]?.trap;
      if (tile && trap) trap.tileId = tile.id;
    }
    const created = await scene.createEmbeddedDocuments("Region", [payload.data]);
    for (const region of created ?? []) scheduleTimedZone(region);
    // A blocking spell wall: Foundry walls along its outline, tied to it.
    const region = created?.[0];
    const blocks = region?.getFlag(SYSTEM_ID, ZONE_FLAG)?.wall?.blocks;
    if (region && blocks && payload.wallEdges?.length) {
      const restrict = wallRestrictions(blocks);
      await scene.createEmbeddedDocuments(
        "Wall",
        payload.wallEdges.map((c) => ({
          c,
          ...restrict,
          flags: { [SYSTEM_ID]: { spellWall: region.id } },
        })),
      );
    }
    return created;
  }
  if (type === MSG_DELETE) {
    const scene = game.scenes.get(payload.sceneId);
    const region = scene?.regions?.get(payload.regionId);
    if (region?.getFlag(SYSTEM_ID, ZONE_FLAG)) return region.delete();
  }
  if (type === MSG_MOVE) {
    const scene = game.scenes.get(payload.sceneId);
    const region = scene?.regions?.get(payload.regionId);
    const info = region?.getFlag(SYSTEM_ID, ZONE_FLAG);
    if (info?.move !== "steer" || !payload.origin) return;
    // A second request for the same round (two clicks racing) is dropped.
    const round = payload.round ?? null;
    if (round && info.movedRound?.combatId === round.combatId &&
        Number(info.movedRound.round) === Number(round.round)) return;
    return moveZone(region, payload.origin, round);
  }
}

/**
 * Delete a timed zone when its clock runs out (now, if it already has).
 * Active GM only; a GM reload re-arms the timers from the `ready` sweep.
 */
function scheduleTimedZone(region) {
  const at = Number(region?.getFlag?.(SYSTEM_ID, ZONE_FLAG)?.expires?.at);
  if (!at) return;
  const remove = () => {
    if (!isActiveGM()) return;
    const live = region.parent?.regions?.get(region.id);
    live?.delete().catch((err) => console.error("Redsteel | Spell zone expiry failed", err));
  };
  setTimeout(remove, Math.max(0, at - Date.now()));
}

/* -------------------------------------------------------------------------- */
/*  Traps                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Who reads a trap's cast card before it goes off: null (everyone) for a
 * party caster, whose allies are the players (user ruling 2026-11-21); for
 * an enemy caster the GMs, the caster's owners and whoever cast it.
 *
 * @param {Actor} actor
 * @returns {string[]|null} User ids to whisper to, or null for a public card.
 */
export function trapCardWhisper(actor) {
  const token =
    canvas?.scene?.tokens?.contents?.find((d) => d.actor?.uuid === actor?.uuid) ?? null;
  if (!casterSide(actor, token)) return null;
  return [
    ...new Set([
      game.user.id,
      ...game.users.contents
        .filter((u) => u.isGM || actor?.testUserPermission?.(u, "OWNER"))
        .map((u) => u.id),
    ]),
  ];
}

/** The trap zones on a scene. */
function trapZonesOn(scene) {
  return (scene?.regions?.contents ?? []).filter(
    (r) => r.getFlag(SYSTEM_ID, ZONE_FLAG)?.trap,
  );
}

/** Everything a walker can set off: traps, and walls that go off on crossing. */
function triggerZonesOn(scene) {
  return (scene?.regions?.contents ?? []).filter((r) => {
    const info = r.getFlag(SYSTEM_ID, ZONE_FLAG);
    return info?.trap || info?.wall?.crossing;
  });
}

/**
 * Trap: one empty hex within range, not on or (unless the spell allows it)
 * next to another trap. The rule reads every trap on the scene, the
 * caster's or not: the book says "another trap".
 */
async function placeTrap({ area, range, casterCells, label }) {
  ui.notifications.info(game.i18n.format("REDSTEEL.SpellArea.PickTrap", { spell: label }));
  const trapKeys = new Set();
  for (const region of trapZonesOn(canvas.scene)) {
    for (const cell of region.getFlag(SYSTEM_ID, ZONE_FLAG).cells ?? []) trapKeys.add(cellKey(cell));
  }
  const occupied = new Set();
  for (const doc of canvas.scene.tokens.contents) {
    for (const cell of occupiedOffsets(doc)) occupied.add(cellKey(cell));
  }
  const cache = new Map();
  const state = await interact((point) => {
    const cell = canvas.grid.getOffset(point);
    const k = cellKey(cell);
    if (cache.has(k)) return cache.get(k);
    let reason = null;
    const distance = distanceFrom(casterCells, cell);
    if (range !== null && distance > range) {
      reason = game.i18n.format("REDSTEEL.SpellArea.OutOfRange", { spell: label, range });
    } else if (occupied.has(k)) {
      reason = game.i18n.localize("REDSTEEL.SpellArea.TrapOccupied");
    } else if (
      trapKeys.has(k) ||
      (!area.mayBorder &&
        canvas.grid
          .getAdjacentOffsets({ i: cell.i, j: cell.j })
          .some((n) => trapKeys.has(cellKey(n))))
    ) {
      reason = game.i18n.localize("REDSTEEL.SpellArea.TrapAdjacent");
    }
    const result = {
      cells: [{ i: cell.i, j: cell.j }],
      valid: !reason,
      reason,
      origin: { i: cell.i, j: cell.j },
    };
    cache.set(k, result);
    return result;
  });
  return state ? { cells: state.cells, origin: state.origin, direction: null } : null;
}

/** Tile data for a Decoy: the caster's token image, centred on the hex. */
function decoyTileData(casterDoc, cell) {
  const centre = canvas.grid.getCenterPoint(cell);
  const w = casterDoc.object?.w ?? canvas.grid.sizeX;
  const h = casterDoc.object?.h ?? canvas.grid.sizeY;
  return {
    texture: { src: casterDoc.texture?.src },
    x: Math.round(centre.x - w / 2),
    y: Math.round(centre.y - h / 2),
    width: Math.round(w),
    height: Math.round(h),
    rotation: casterDoc.rotation ?? 0,
  };
}

/**
 * The hexes a token entered on a move, in walking order: each leg between
 * waypoints along the grid's direct path, without the hexes it started on.
 */
function enteredCells(doc, movement, grid) {
  const points = [movement?.origin, ...(movement?.passed?.waypoints ?? [])].filter(
    (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  const out = [];
  let prev = null;
  for (const p of points) {
    let here = [];
    try {
      here = doc.getOccupiedGridSpaceOffsets({ x: p.x, y: p.y }) ?? [];
    } catch (_error) {
      here = [];
    }
    if (!here.length) continue;
    if (prev) {
      let path = [];
      try {
        path =
          grid.getDirectPath([grid.getCenterPoint(prev[0]), grid.getCenterPoint(here[0])]) ?? [];
      } catch (_error) {
        path = [];
      }
      for (const c of path.slice(1)) out.push({ i: c.i, j: c.j });
      // A big token also covers the rest of its hexes at each stop.
      for (const c of here.slice(1)) out.push({ i: c.i, j: c.j });
    }
    prev = here;
  }
  return out;
}

/** The traps a move ran into, in the order it reached them. */
function trapsCrossed(doc, movement) {
  const scene = doc?.parent;
  const traps = triggerZonesOn(scene).filter((r) => {
    // A wall that hits enemies only (Mystical wall) lets the caster's side by.
    const info = r.getFlag(SYSTEM_ID, ZONE_FLAG);
    return !info.wall?.enemiesOnly || isEnemyOfCaster(doc, info);
  });
  if (!traps.length) return [];
  const byCell = new Map();
  for (const region of traps) {
    for (const cell of region.getFlag(SYSTEM_ID, ZONE_FLAG).cells ?? []) {
      byCell.set(cellKey(cell), region);
    }
  }
  const hits = [];
  const seen = new Set();
  for (const cell of enteredCells(doc, movement, gridFor(scene))) {
    const region = byCell.get(cellKey(cell));
    if (!region || seen.has(region.id)) continue;
    seen.add(region.id);
    hits.push({ region, cell, info: region.getFlag(SYSTEM_ID, ZONE_FLAG) });
  }
  return hits;
}

/**
 * Set a trap off (active GM): remove it, then post its cast card for
 * everyone with whoever stands in its blast targeted, the walker always
 * among them (user ruling 2026-11-21: the card was rolled when cast and shown
 * only to the caster and GM until now). Defend and Apply Damage then run on
 * it as on any spell card.
 */
async function detonateTrap(region, walker) {
  const info = region.getFlag(SYSTEM_ID, ZONE_FLAG);
  const scene = region.parent;
  const grid = gridFor(scene);
  const trapCell = info?.cells?.[0];
  if (!info?.trap || !trapCell) return;

  const blast = new Set(
    growCells([trapCell], Number(info.trap.blast) || 0, grid).map(cellKey),
  );
  const victims = scene.tokens.contents.filter((t) => {
    if (isActorDead(t.actor)) return false;
    let cells = [];
    try {
      cells = t.getOccupiedGridSpaceOffsets() ?? [];
    } catch (_error) {
      cells = [];
    }
    return cells.some((c) => blast.has(cellKey(c)));
  });
  if (!victims.some((t) => t.id === walker.id)) victims.unshift(walker);

  // Gone first, so a second move landing meanwhile cannot set it off again.
  if (info.trap.tileId) await scene.tiles?.get(info.trap.tileId)?.delete();
  await region.delete();

  const notice = game.i18n.format("REDSTEEL.SpellArea.TrapTriggered", {
    spell: info.spellName,
    target: walker.name,
  });
  // The full card is rolled now (user ruling 2026-11-21): damage, effects and
  // any versus Test fresh, the margin from the cast. finalizeRollsAndPostChat
  // builds it exactly as a cast would, aimed at the victims.
  const caster = fromUuidSync(info.casterUuid);
  const spell = caster?.items?.get(info.spellId) ?? null;
  const cast = info.trap.cast;
  const attackResults = trapAttackResults(cast, game.messages.get(info.castMessageId));
  if (!caster || !spell || !attackResults || !game.redsteel?.finalizeRollsAndPostChat) {
    await ChatMessage.create({ content: `<p><b>${notice}</b></p>` });
    return;
  }
  await game.redsteel.finalizeRollsAndPostChat(caster, spell, cast.bonuses ?? {}, attackResults, {
    focusSpent: cast.focusSpent ?? 0,
    ignoreChanneling: !!cast.ignoreChanneling,
    bloodPayment: !!cast.bloodPayment,
    hastenedCast: !!cast.hastenedCast,
    catalyst: !!cast.catalyst,
    trap: { targetIds: victims.map((t) => t.id), walkerId: walker.id, notice },
  });
}

/**
 * The cast's margin for a trap going off. The cast card's own roll wins when
 * it has changed since (a chat Re-Roll rewrites the card in place); its
 * criticals are then read off the card's stored thresholds.
 */
function trapAttackResults(cast, castCard) {
  if (!cast) return null;
  const stored = cast.attackRoll ? Roll.fromData(cast.attackRoll) : null;
  const live = castCard?.rolls?.[0] ?? null;
  const results = {
    attackRoll: stored,
    critSuccess: !!cast.critSuccess,
    critFailure: !!cast.critFailure,
    displayCritSuccess: !!cast.displayCritSuccess,
    displayCritFailure: !!cast.displayCritFailure,
  };
  if (live && (!stored || live.total !== stored.total)) {
    const flags = castCard.flags?.[SYSTEM_ID] ?? {};
    const die = live.dice?.find((d) => d.faces === 100)?.total ?? live.dice?.[0]?.total;
    results.attackRoll = live;
    results.displayCritSuccess = Number.isFinite(die) && die <= Number(flags.criticalSuccessThreshold);
    results.displayCritFailure = Number.isFinite(die) && die >= Number(flags.criticalFailureThreshold);
    results.critSuccess = !cast.ignoreChanneling && results.displayCritSuccess;
    results.critFailure = !cast.ignoreChanneling && results.displayCritFailure;
  }
  return results.attackRoll ? results : null;
}

/**
 * After a move (every client): find the traps it ran into. The walker's own
 * client stops the rest of a walk at a trap that stops it (only the mover
 * may); the active GM sets the traps off and puts the walker back on a
 * stopping trap's hex when its leg carried it past.
 */
function onTokenMoved(doc, movement, operation, user) {
  if (operation?.redsteelTrapReturn) return;
  if (isActorDead(doc?.actor)) return;
  const hits = trapsCrossed(doc, movement);
  if (!hits.length) return;
  const stopAt = hits.findIndex((h) => h.info.trap?.stops || h.info.wall?.stops);
  const fired = stopAt >= 0 ? hits.slice(0, stopAt + 1) : hits;

  if (stopAt >= 0 && user?.id === game.user.id && movement?.pending?.waypoints?.length) {
    try {
      doc.stopMovement?.();
    } catch (err) {
      console.error("Redsteel | Trap could not stop the movement", err);
    }
  }
  if (!isActiveGM()) return;

  (async () => {
    for (const hit of fired) {
      if (hit.info.wall) await detonateWall(hit.region, doc);
      else await detonateTrap(hit.region, doc);
    }
    if (stopAt < 0) return;
    const cell = fired.at(-1).cell;
    const on = (doc.getOccupiedGridSpaceOffsets?.() ?? []).some(
      (c) => cellKey(c) === cellKey(cell),
    );
    if (on) return;
    const point = gridFor(doc.parent).getTopLeftPoint(cell);
    await doc.update({ x: point.x, y: point.y }, { redsteelTrapReturn: true });
  })().catch((err) => console.error("Redsteel | Trap failed to go off", err));
}

/* -------------------------------------------------------------------------- */
/*  Walls                                                                     */
/* -------------------------------------------------------------------------- */

/** A wall can never run longer than this, however much it may cost. */
const WALL_HARD_CAP = 60;

/**
 * The most hexes a wall may cover for this caster: its `length` (a number or
 * a Spell Power formula, user ruling 2026-11-21: Stone wall = Spell Power) and,
 * for a wall paid per so many hexes (Fire Wall, 4), as many groups as the
 * caster's Mana pays for. Infinity when nothing limits it (capped later).
 */
function wallMaxHexes(actor, spell, area, freeCast) {
  let max = Infinity;
  const length = zoneRounds(actor, spell, area.length);
  if (length > 0) max = Math.min(max, length);
  if (area.hexesPerCost > 0 && !freeCast) {
    const cost = getBaseSpellManaCost(actor, spell);
    if (cost > 0) {
      const mana = Number(actor?.system?.stats?.mana?.value) || 0;
      max = Math.min(max, Math.floor(mana / cost) * area.hexesPerCost);
    }
  }
  return max;
}

/** A small counter plate over the hotbar while a wall is drawn. */
function createWallCounter() {
  const plate = document.createElement("div");
  plate.className = "rs-spell-area-confirm rs-spell-wall-counter";
  plate.style.cssText = [
    "position: fixed",
    `bottom: ${panelBottomOffset()}px`,
    "left: 50%",
    "transform: translateX(-50%)",
    "z-index: 1000",
    "padding: 6px 14px",
    "background: var(--rs-chat-bg, #0f0f0f)",
    "border: 1px solid rgba(160, 112, 60, 0.7)",
    "box-shadow: 0 2px 10px rgba(0, 0, 0, 0.7)",
    "color: var(--rs-chat-text-strong, #cdd0d2)",
    'font-family: Georgia, "Times New Roman", serif',
    "font-size: 14px",
    "pointer-events: none",
  ].join("; ");
  document.body.appendChild(plate);
  return plate;
}

/**
 * Wall: press on a hex and drag; every hex the cursor passes joins the wall,
 * touching the one before it, up to the spell's limit (user ruling
 * 2026-11-21). Dragging back over the previous hex takes the last one off.
 * Releasing finishes; right click or Escape cancels. Hexes must be in range
 * and, unless the spell allows it (Ice wall), empty.
 */
async function placeWall({ area, range, casterCells, label, max }) {
  const board = document.getElementById("board");
  if (!board || !canvas?.ready) return null;
  const cap = Number.isFinite(max) ? Math.max(0, max) : WALL_HARD_CAP;
  if (cap < 1) return null;
  const limited = Number.isFinite(max);

  const occupied = new Set();
  if (!area.occupiedOk) {
    for (const doc of canvas.scene.tokens.contents) {
      for (const cell of occupiedOffsets(doc)) occupied.add(cellKey(cell));
    }
  }
  const reasonFor = (cell) => {
    if (range !== null && distanceFrom(casterCells, cell) > range) {
      return game.i18n.format("REDSTEEL.SpellArea.OutOfRange", { spell: label, range });
    }
    if (occupied.has(cellKey(cell))) return game.i18n.localize("REDSTEEL.SpellArea.WallOccupied");
    return null;
  };

  ui.notifications.info(
    limited
      ? game.i18n.format("REDSTEEL.SpellArea.PickWall", { spell: label, max: cap })
      : game.i18n.format("REDSTEEL.SpellArea.PickWallNoLimit", { spell: label }),
  );
  const overlay = createOverlay({ breathe: true });
  const counter = createWallCounter();
  const same = (a, b) => a && b && a.i === b.i && a.j === b.j;

  return new Promise((resolve) => {
    let chain = [];
    let dragging = false;
    let timer = null;

    const redraw = (hover = null) => {
      const shown = chain.length ? chain : hover ? [hover] : [];
      overlay.draw(shown, !hover || !reasonFor(hover) || chain.length > 0);
      counter.textContent = game.i18n.format(
        limited ? "REDSTEEL.SpellArea.WallCount" : "REDSTEEL.SpellArea.WallCountNoLimit",
        { spell: label, count: chain.length, max: cap },
      );
    };
    const cellAt = (event) => {
      const { i, j } = canvas.grid.getOffset(canvasPoint(event));
      return { i, j };
    };
    const extendTo = (cell) => {
      const last = chain.at(-1);
      if (!last || same(cell, last)) return;
      // Back over the previous hex: the last one comes off.
      if (chain.length > 1 && same(cell, chain.at(-2))) {
        chain.pop();
        return;
      }
      // A fast drag skips hexes: walk the grid's own path to the cursor.
      let path = [];
      try {
        path =
          canvas.grid.getDirectPath([canvas.grid.getCenterPoint(last), canvas.grid.getCenterPoint(cell)]) ??
          [];
      } catch (_error) {
        path = [cell];
      }
      for (const step of path.slice(1)) {
        const next = { i: step.i, j: step.j };
        if (chain.length >= cap) break;
        if (chain.some((c) => same(c, next))) break;
        if (reasonFor(next)) break;
        chain.push(next);
      }
    };
    const finish = (value) => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
      overlay.destroy();
      counter.remove();
      resolve(value);
    };
    const onDown = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button !== 0) return finish(null);
      const cell = cellAt(event);
      const reason = reasonFor(cell);
      if (reason) {
        ui.notifications.warn(reason);
        return;
      }
      chain = [cell];
      dragging = true;
      redraw();
    };
    const onMove = (event) => {
      if (!dragging) {
        if (event.target !== board) return overlay.draw(null);
        return redraw(cellAt(event));
      }
      extendTo(cellAt(event));
      redraw();
    };
    const onUp = (event) => {
      if (!dragging || event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dragging = false;
      finish(chain.length ? { cells: chain, origin: chain[0], direction: null } : null);
    };
    const onContext = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("contextmenu", onContext, true);
    window.addEventListener("keydown", onKey, true);
    timer = setTimeout(() => finish(null), PLACEMENT_TIMEOUT);
    redraw();
  });
}

/**
 * The outline of a set of hexes as wall segments: every hex edge not shared
 * with another hex of the set, so the Foundry walls box the whole wall in.
 */
function perimeterEdges(grid, cells) {
  const key = (p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  const count = new Map();
  const edges = [];
  for (const cell of cells) {
    const v = grid.getVertices({ i: cell.i, j: cell.j });
    for (let k = 0; k < v.length; k++) {
      const a = v[k];
      const b = v[(k + 1) % v.length];
      const id = [key(a), key(b)].sort().join("|");
      count.set(id, (count.get(id) ?? 0) + 1);
      edges.push({ id, c: [a.x, a.y, b.x, b.y] });
    }
  }
  const seen = new Set();
  return edges
    .filter((e) => count.get(e.id) === 1 && !seen.has(e.id) && seen.add(e.id))
    .map((e) => e.c.map((n) => Math.round(n * 100) / 100));
}

/** What a wall blocks, as Wall document restrictions. */
function wallRestrictions(blocks) {
  const SENSE = CONST.WALL_SENSE_TYPES;
  const MOVE = CONST.WALL_MOVEMENT_TYPES;
  if (blocks === "solid") {
    return { move: MOVE.NORMAL, sight: SENSE.NORMAL, light: SENSE.NORMAL, sound: SENSE.NORMAL };
  }
  // "sight": an opaque wall of fire you can still walk through.
  return { move: MOVE.NONE, sight: SENSE.NORMAL, light: SENSE.NORMAL, sound: SENSE.NONE };
}

/** The Foundry walls a spell wall's Region raised. */
function spellWallsOf(region) {
  return (region?.parent?.walls?.contents ?? []).filter(
    (w) => w.getFlag(SYSTEM_ID, "spellWall") === region.id,
  );
}

/**
 * Someone crossed a wall that goes off on crossing (active GM): its card is
 * rolled for them, the margin the cast's, the wall stays (user ruling
 * 2026-11-21, Fire Wall and Mystical wall).
 */
async function detonateWall(region, walker) {
  const info = region.getFlag(SYSTEM_ID, ZONE_FLAG);
  if (!info?.wall) return;
  const notice = game.i18n.format("REDSTEEL.SpellArea.WallCrossed", {
    spell: info.spellName,
    target: walker.name,
  });
  const caster = fromUuidSync(info.casterUuid);
  const spell = caster?.items?.get(info.spellId) ?? null;
  const cast = info.wall.cast;
  const attackResults = trapAttackResults(cast, game.messages.get(info.castMessageId));
  if (!caster || !spell || !attackResults || !game.redsteel?.finalizeRollsAndPostChat) {
    await ChatMessage.create({ content: `<p><b>${notice}</b></p>` });
    return;
  }
  await game.redsteel.finalizeRollsAndPostChat(caster, spell, cast.bonuses ?? {}, attackResults, {
    focusSpent: cast.focusSpent ?? 0,
    ignoreChanneling: !!cast.ignoreChanneling,
    bloodPayment: !!cast.bloodPayment,
    hastenedCast: !!cast.hastenedCast,
    catalyst: !!cast.catalyst,
    trap: { targetIds: [walker.id], walkerId: walker.id, notice },
  });
}

/** Is this walker on the other side from the zone's caster? */
function isEnemyOfCaster(walker, info) {
  const caster = fromUuidSync(info.casterUuid);
  const casterToken =
    walker.parent?.tokens?.contents?.find((d) => d.actor?.uuid === info.casterUuid) ?? null;
  return isHostileSide(walker) !== casterSide(caster, casterToken);
}

/** The Channeling status, read the way magicSkillBonuses.mjs reads it. */
function isChannelingEffect(effect) {
  return (
    effect?.getFlag?.("core", "statusId") === "channeling" ||
    effect?.statuses?.has("channeling") === true
  );
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                              */
/* -------------------------------------------------------------------------- */

/** Registered once at init. */
export function registerSpellAreaHooks() {
  game.redsteel.spellArea = { placeSpellArea, zoneOccupantIds, steerSpellZone };

  game.settings.register(SYSTEM_ID, SETTING, {
    name: "REDSTEEL.SpellArea.SettingName",
    hint: "REDSTEEL.SpellArea.SettingHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // A zone held by Channeling ends with it. By effect id: a recast deletes
  // the old Channeling while the new zone is on its way.
  Hooks.on("deleteActiveEffect", (effect) => {
    if (!isActiveGM() || !isChannelingEffect(effect)) return;
    const id = effect.id;
    deleteZones((info) => info.channelingEffectId === id).catch((err) =>
      console.error("Redsteel | Spell zone clean-up failed", err),
    );
  });

  // A zone with a round limit ends at the top of that round; a cast's brief
  // zone ends as soon as the turn it was cast in does.
  Hooks.on("updateCombat", (combat, changed) => {
    if (!isActiveGM()) return;
    const roundChanged = changed?.round !== undefined;
    if (!roundChanged && changed?.turn === undefined) return;
    const round = Number(combat.round) || 0;
    const turn = Number(combat.turn) || 0;
    // Expiry first, so a tornado on its last round top is removed rather
    // than moved; then the survivors drift.
    deleteZones((info) => {
      const ex = info.expires;
      if (ex?.combatId !== combat.id) return false;
      if (ex.endOfTurn) return round !== Number(ex.round) || turn !== Number(ex.turn);
      return roundChanged && round >= Number(ex.round);
    })
      .then(() => (roundChanged ? driftZones(combat) : null))
      .catch((err) => console.error("Redsteel | Spell zone expiry failed", err));
  });

  // A token walking into a trap sets it off (every client looks; the mover
  // stops, the GM detonates).
  Hooks.on("moveToken", onTokenMoved);

  // A trap removed by hand takes its Decoy image with it.
  Hooks.on("deleteRegion", (region) => {
    if (!isActiveGM()) return;
    const tileId = region.getFlag?.(SYSTEM_ID, ZONE_FLAG)?.trap?.tileId;
    if (tileId) region.parent?.tiles?.get(tileId)?.delete().catch(() => {});
    // A spell wall's Foundry walls go with it.
    const walls = spellWallsOf(region).map((w) => w.id);
    if (walls.length) region.parent.deleteEmbeddedDocuments("Wall", walls).catch(() => {});
  });

  // ... or with its combat.
  Hooks.on("deleteCombat", (combat) => {
    if (!isActiveGM()) return;
    deleteZones((info) => info.expires?.combatId === combat.id).catch((err) =>
      console.error("Redsteel | Spell zone clean-up failed", err),
    );
  });

  Hooks.once("ready", () => {
    // Re-arm timed zones left from before a reload; stale ones go at once.
    if (isActiveGM()) {
      for (const scene of game.scenes.contents) {
        for (const region of scene.regions?.contents ?? []) scheduleTimedZone(region);
      }
    }
    game.socket.on(SOCKET, (data) => {
      if (![MSG_CREATE, MSG_DELETE, MSG_MOVE].includes(data?.type)) return;
      handleGM(data).catch((err) =>
        console.error("Redsteel | Spell zone socket request failed", err),
      );
    });
  });
}
