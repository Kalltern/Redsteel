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
 *   cone   Breath: an origin hex within the spell's range, then a cone
 *          `size` hexes deep (the origin counts as 1), snapped to the grid:
 *          45° widens 1, 2, 3 a row, 90° widens 1, 3, 5 (see coneCells);
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
 */

import { isHostileSide } from "./movementZones.mjs";
import { isActorDead } from "./deadTokens.mjs";
import { getSpellPower } from "./spellPower.mjs";
import { resolveSpellPowerTokens } from "./spellCards.mjs";

const SYSTEM_ID = "redsteel";
const SOCKET = "system.redsteel";
const ZONE_FLAG = "spellZone";
const SETTING = "spellAreaPlacement";

/** Socket message types (the active GM runs both). */
const MSG_CREATE = "spellZoneCreate";
const MSG_DELETE = "spellZoneDelete";

const SHAPES = new Set(["burst", "aura", "cone", "line"]);

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
function growCells(seeds, rings) {
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
      for (const n of canvas.grid.getAdjacentOffsets({ i: cell.i, j: cell.j })) {
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
 *   includeCaster: boolean, linger: boolean, rounds: string}|null}
 */
export function spellArea(spell) {
  const area = spell?.system?.area;
  const shape = String(area?.shape ?? "").trim();
  if (!SHAPES.has(shape)) return null;
  return {
    shape,
    size: Math.max(0, Math.floor(Number(area.size) || 0)),
    angle: Math.max(0, Number(area.angle) || 0),
    targets: area.targets === "enemies" ? "enemies" : "all",
    includeCaster: area.includeCaster === true,
    linger: area.linger === true,
    rounds: area.rounds == null ? "" : String(area.rounds).trim(),
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
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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

/** Cone: first the origin hex, then the bearing. */
async function placeCone({ area, range, casterDoc, casterCells, label }) {
  const ownKeys = new Set(casterCells.map(cellKey));
  const casterCentre = casterDoc.object?.center ?? canvas.grid.getCenterPoint(casterCells[0]);

  // Phase A: the origin, with the cone pointing away from the caster.
  ui.notifications.info(
    game.i18n.format("REDSTEEL.SpellArea.PickOrigin", { spell: label }),
  );
  const cache = new Map();
  const first = await interact((point) => {
    const origin = canvas.grid.getOffset(point);
    const k = cellKey(origin);
    if (cache.has(k)) return cache.get(k);
    const distance = distanceFrom(casterCells, origin);
    const own = ownKeys.has(k);
    const tooFar = range !== null && distance > range;
    const direction = bearing(casterCentre, canvas.grid.getCenterPoint(origin));
    const result = {
      cells: coneCells(origin, direction, area.size, area.angle),
      valid: !own && distance >= 1 && !tooFar,
      reason: tooFar
        ? game.i18n.format("REDSTEEL.SpellArea.OutOfRange", {
            spell: label,
            range,
          })
        : null,
      origin: { i: origin.i, j: origin.j },
      direction,
    };
    cache.set(k, result);
    return result;
  });
  if (!first) return null;

  // Phase B: the cone follows the cursor's bearing from the origin's centre.
  ui.notifications.info(
    game.i18n.format("REDSTEEL.SpellArea.PickDirection", { spell: label }),
  );
  const origin = first.origin;
  const originCentre = canvas.grid.getCenterPoint(origin);
  let last = first.direction;
  const second = await interact((point) => {
    if (Math.hypot(point.x - originCentre.x, point.y - originCentre.y) >= 1) {
      last = bearing(originCentre, point);
    }
    return {
      cells: coneCells(origin, last, area.size, area.angle),
      valid: true,
      direction: last,
    };
  });
  return second ? { cells: second.cells, origin, direction: second.direction } : null;
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
export async function placeSpellArea(actor, spell, token = null) {
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
  }
  if (!placed?.cells?.length) return null;

  const targetIds = await confirmTargets({
    actor,
    casterDoc,
    area,
    cells: placed.cells,
    label,
  });
  if (!targetIds) return null;

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
  // The viewed scene's grid when it is that scene, else the scene's own.
  const grid = canvas?.scene?.id === scene.id ? canvas.grid : scene.grid;
  if (typeof grid?.getVertices !== "function") return null;

  const shapes = area.cells.map((cell) => ({
    type: "polygon",
    hole: false,
    points: grid.getVertices({ i: cell.i, j: cell.j }).flatMap((p) => [p.x, p.y]),
  }));

  const combat = game.combat;
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
  const data = {
    name: game.i18n.format("REDSTEEL.SpellArea.ZoneName", {
      spell: spellName,
      caster: actor.name,
    }),
    color: ZONE_COLOR,
    shapes,
    visibility: CONST.REGION_VISIBILITY.ALWAYS,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
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
        },
      },
    },
  };
  return toGM(MSG_CREATE, { sceneId: scene.id, data });
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
    const created = await scene.createEmbeddedDocuments("Region", [payload.data]);
    for (const region of created ?? []) scheduleTimedZone(region);
    return created;
  }
  if (type === MSG_DELETE) {
    const scene = game.scenes.get(payload.sceneId);
    const region = scene?.regions?.get(payload.regionId);
    if (region?.getFlag(SYSTEM_ID, ZONE_FLAG)) return region.delete();
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
  game.redsteel.spellArea = { placeSpellArea, zoneOccupantIds };

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
    deleteZones((info) => {
      const ex = info.expires;
      if (ex?.combatId !== combat.id) return false;
      if (ex.endOfTurn) return round !== Number(ex.round) || turn !== Number(ex.turn);
      return roundChanged && round >= Number(ex.round);
    }).catch((err) => console.error("Redsteel | Spell zone expiry failed", err));
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
      if (data?.type !== MSG_CREATE && data?.type !== MSG_DELETE) return;
      handleGM(data).catch((err) =>
        console.error("Redsteel | Spell zone socket request failed", err),
      );
    });
  });
}
