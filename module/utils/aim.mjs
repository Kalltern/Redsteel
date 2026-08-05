/**
 * Aim system.
 *
 * A token can "aim" at a single target, stacking up to 4 times for a cumulative
 * +10% hit chance per stack (+10 / +20 / +30 / +40 %). State lives entirely on a
 * token flag — `flags.redsteel.aim = { targetId, stacks }` — so the flags are the
 * single source of truth. "Who is aiming at whom" is answered by iterating the
 * scene's tokens and filtering on that flag; no lookup table is kept.
 *
 * Two ways to drive it, both manual (aim is never granted or burned on roll
 * hooks):
 *   1. Hold ALT with your aimer token selected — a square button appears over
 *      every other token. Left-click adds a stack toward it, right-click removes
 *      one. The aimer is the currently controlled token.
 *   2. Three macros (Add / Remove / Consume) for hotbar use.
 *
 * A PIXI overlay on `canvas.interface` visualises the current state.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";

const SYSTEM_ID = "redsteel";
const FLAG = "aim";
const MAX_STACKS = 4;
const PER_STACK = 10; // % hit chance per stack
const IMPROVED_AIM_PEN = 10; // Improved Aim: penetration at full aim

const COLOR_AMBER = 0xffb300; // stacks 1–3
const COLOR_RED = 0xff3030; // stack 4 (capped)
const COLOR_IDLE = 0x9aa0a6; // a target with no aim on it yet

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** The token the user is acting with (controlled token, else assigned char). */
function getActingToken() {
  const sel = game.redsteel?.selectToken?.({ warn: false });
  return sel?.token ?? null;
}

function stackColor(stacks) {
  if (stacks >= MAX_STACKS) return COLOR_RED;
  if (stacks > 0) return COLOR_AMBER;
  return COLOR_IDLE;
}

/** Arrow/badge colour: the actor's player-owner colour, else the active GM's. */
function ownerColor(token) {
  const actor = token?.actor;
  let user = null;
  if (actor) {
    const owners = game.users.filter(
      (u) => !u.isGM && actor.testUserPermission(u, "OWNER"),
    );
    user = owners.find((u) => u.active) ?? owners[0] ?? null;
  }
  if (!user) user = game.users.activeGM ?? game.user;
  try {
    return Number(foundry.utils.Color.from(user?.color ?? "#ffffff"));
  } catch {
    return 0xffffff;
  }
}

/**
 * The number of Aim stacks `token` currently holds. The aim flag already stores
 * its own target, so this does NOT require a separate Foundry target reticle.
 * If the user happens to have a target reticle set on a DIFFERENT token than the
 * aimed one, the bonus is suppressed (they're aiming elsewhere). Used to
 * pre-select the "Aim" radio in the attack / combat-ability dialogs so a stacked
 * aim carries into the roll automatically.
 */
export function getAimStacks(token, target = game.user?.targets?.first?.() ?? null) {
  const aim = token?.document?.getFlag(SYSTEM_ID, FLAG);
  if (!aim?.targetId) return 0;
  // Only suppress when an explicit reticle target differs from the aimed token.
  if (target && aim.targetId !== target.id) return 0;
  return Math.min(MAX_STACKS, Math.max(0, aim.stacks ?? 0));
}

/**
 * A one-handed sword: sword class, not a heavy blade (longsword, flamberge) and
 * not currently gripped in two hands. Mirrors buildWeaponSetView's two-hander
 * test, so flipping the grip toggle on the sheet flips eligibility live.
 */
function isOneHandedSword(weapon) {
  const ws = weapon?.system ?? {};
  return ws.class === "sword" && ws.type !== "heavy" && ws.gripMode !== "two";
}

/**
 * A broadsword-type blade actually gripped in two hands: sword class, not a
 * light blade (dagger, sabre, shortsword), and either heavy — longswords and
 * flamberges are two-handed whatever the toggle says, same as
 * buildWeaponSetView reads them — or switched to the two-hand grip.
 */
function isTwoHandedSword(weapon) {
  const ws = weapon?.system ?? {};
  if (ws.class !== "sword" || ws.type === "light") return false;
  return ws.type === "heavy" || ws.gripMode === "two";
}

/**
 * The duelling stance: the off hand is free, or holds an off-hand weapon whose
 * off-hand profile is duelist-flagged (`offhandProperties.doctrines.duelist`).
 * Today that is the fencing dagger; a one-handed crossbow or pistol qualifies
 * the day it is added with that flag set, no code change needed. A shield never
 * qualifies.
 */
function hasDuelistOffHand(context) {
  if (context?.hasShield) return false;
  const off = context?.offWeapon;
  if (!off) return true; // empty hand
  return off.system?.offhandProperties?.doctrines?.duelist === true;
}

/**
 * Improved Aim — armour penetration granted at full (4-stack) aim.
 *
 * Two independent sources, both worth +10 and NOT cumulative with each other:
 *   • Duelist I — any one-handed sword, provided the off hand is free or holds
 *     a duelist off-hand weapon (fencing dagger).
 *   • Servant of the Sword, "Improved Aiming" node — a broadsword-type sword
 *     gripped in two hands.
 *
 * Reads the actor `aimCount` flag — the stack count the attack dialog actually
 * committed to this roll, i.e. the same number that pays the +40% hit bonus.
 * That flag is consumed later, inside getAttackRolls, so callers must fold this
 * in while assembling penetration (which happens before the attack roll).
 */
export function getImprovedAimPenetration(actor, weapon, context = null) {
  if (!actor || !weapon) return 0;
  const stacks = Number(actor.getFlag(SYSTEM_ID, "aimCount")) || 0;
  if (stacks < MAX_STACKS) return 0;

  const duelist =
    Number(actor.system?.doctrines?.duelist?.value ?? 0) >= 1 &&
    isOneHandedSword(weapon) &&
    hasDuelistOffHand(context);
  const swordServant =
    isTwoHandedSword(weapon) &&
    actorHasSpecNode(actor, "swordServant", "improvedAim");

  return duelist || swordServant ? IMPROVED_AIM_PEN : 0;
}

/* -------------------------------------------- */
/*  Core aim mutations (token → target)         */
/* -------------------------------------------- */

/**
 * Add one Aim stack from `token` toward `target`.
 * - No existing aim → set at 1 stack.
 * - Same target → increment (max 4, warn at cap).
 * - Different target → switching burns all prior stacks; reset to 1.
 */
async function addAimStackOn(token, target) {
  if (!token || !target) return;
  if (target.id === token.id) return; // a token cannot aim at itself

  const aim = token.document.getFlag(SYSTEM_ID, FLAG);

  if (aim?.targetId === target.id) {
    if (aim.stacks >= MAX_STACKS) return; // already capped
    await token.document.setFlag(SYSTEM_ID, FLAG, {
      targetId: target.id,
      stacks: aim.stacks + 1,
    });
    return;
  }

  // New aim, or switching targets (switching burns all prior stacks → reset to 1).
  await token.document.setFlag(SYSTEM_ID, FLAG, { targetId: target.id, stacks: 1 });
}

/**
 * Remove one Aim stack from `token`; clear the flag entirely at 0.
 * When `target` is given (button right-click), only acts if `token` is actually
 * aiming at that target. When null (macro), decrements the current aim.
 */
async function removeAimStackOn(token, target = null) {
  if (!token) return;

  const aim = token.document.getFlag(SYSTEM_ID, FLAG);
  if (!aim) return;
  if (target && aim.targetId !== target.id) return;

  const stacks = aim.stacks - 1;
  if (stacks <= 0) {
    await token.document.unsetFlag(SYSTEM_ID, FLAG);
    return;
  }
  await token.document.setFlag(SYSTEM_ID, FLAG, { targetId: aim.targetId, stacks });
}

/* -------------------------------------------- */
/*  Macros                                      */
/* -------------------------------------------- */

/** Add a stack toward the user's current target. */
export async function addAimStack() {
  const token = getActingToken();
  if (!token) return;
  const target = game.user.targets.first();
  if (!target) return;
  await addAimStackOn(token, target);
}

/** Remove a stack from the acting token's current aim. */
export async function removeAimStack() {
  const token = getActingToken();
  if (!token) return;
  await removeAimStackOn(token, null);
}

/**
 * Consume Aim — run when the token attacks its aimed target. Burns all stacks
 * regardless of how many there were.
 */
export async function consumeAim() {
  const token = getActingToken();
  if (!token) return;
  if (!token.document.getFlag(SYSTEM_ID, FLAG)) return;
  await token.document.unsetFlag(SYSTEM_ID, FLAG);
}

/* -------------------------------------------- */
/*  Canvas overlay (state shared by arrows +    */
/*  ALT buttons)                                */
/* -------------------------------------------- */

let overlay = null; // PIXI.Container on canvas.interface
let arrowGfx = null; // per-frame redrawn lines / rings / badge backgrounds
let badgeLayer = null; // PIXI.Text badges (positioned each frame)
let buttonLayer = null; // interactive ALT buttons
let infoLayer = null; // movement/armor info panels (shown while ALT held)
let badges = new Map(); // sourceTokenId -> PIXI.Text
let relationships = []; // { source, target, stacks, color }
let phase = 0; // animation clock

// ALT-button state
let buttonsVisible = false;
let currentAimer = null; // the token whose aim the buttons mutate
let aimButtons = new Map(); // targetTokenId -> { container, gfx, label, target }

// ALT info-panel state (movement + armor, shown for every token)
let infoVisible = false;
let infoPanels = new Map(); // tokenId -> { container }

/**
 * Host layer for the overlay. `canvas.controls` (ControlsLayer) is rendered
 * ABOVE the token meshes — door controls, cursors and rulers all live here — so
 * arrows, badges and buttons draw on top of tokens instead of behind them
 * (which is what `canvas.interface` did).
 */
function overlayHost() {
  return canvas.controls ?? canvas.interface;
}

/** True once the overlay container is live on the current host layer. */
function overlayLive() {
  return !!overlay && !overlay.destroyed && overlay.parent === overlayHost();
}

function ensureOverlay() {
  if (overlayLive()) return overlay;

  overlay = new PIXI.Container();
  overlay.eventMode = "passive"; // not interactive itself, but children may be
  overlay.sortableChildren = true;
  overlay.zIndex = 1000; // float above the host layer's own children

  arrowGfx = new PIXI.Graphics();
  arrowGfx.eventMode = "none";

  badgeLayer = new PIXI.Container();
  badgeLayer.eventMode = "none";
  badgeLayer.zIndex = 1;

  buttonLayer = new PIXI.Container();
  buttonLayer.eventMode = "passive";
  buttonLayer.zIndex = 2;
  buttonLayer.visible = false;

  infoLayer = new PIXI.Container();
  infoLayer.eventMode = "none";
  infoLayer.zIndex = 3;
  infoLayer.visible = false;

  overlay.addChild(arrowGfx, badgeLayer, buttonLayer, infoLayer);

  badges.clear();
  aimButtons.clear(); // text/graphics from a torn-down canvas died with it
  infoPanels.clear();
  buttonsVisible = false;
  infoVisible = false;

  const host = overlayHost();
  host.sortableChildren = true;
  host.addChild(overlay);

  // One stable ticker callback; remove-then-add prevents duplicates on rebuild.
  canvas.app.ticker.remove(animate);
  canvas.app.ticker.add(animate);

  return overlay;
}

/* -------------------------------------------- */
/*  Aim relationships → arrows + rings          */
/* -------------------------------------------- */

/**
 * Rebuild the cached aim relationships and badge text. Called whenever flags or
 * the token set might have changed. Live positions are read each frame in
 * animate(), so arrows track moving tokens.
 */
export function refreshAimOverlay() {
  if (!canvas?.ready) return;
  ensureOverlay();

  relationships = [];
  const seen = new Set();

  for (const token of canvas.tokens.placeables) {
    const aim = token.document?.getFlag(SYSTEM_ID, FLAG);
    if (!aim?.targetId) continue;
    const target = canvas.tokens.get(aim.targetId);
    if (!target || target === token) continue;

    const stacks = Math.max(1, Math.min(MAX_STACKS, aim.stacks ?? 1));
    relationships.push({ source: token, target, stacks, color: ownerColor(token) });
    seen.add(token.id);

    let badge = badges.get(token.id);
    if (!badge) {
      badge = new PIXI.Text("", badgeStyle());
      badge.anchor.set(0.5);
      badgeLayer.addChild(badge);
      badges.set(token.id, badge);
    }
    badge.text = `+${stacks * PER_STACK}%`;
  }

  for (const [id, badge] of badges) {
    if (seen.has(id)) continue;
    badge.destroy();
    badges.delete(id);
  }

  if (buttonsVisible) updateButtonStates();
}

function badgeStyle() {
  return new PIXI.TextStyle({
    fontFamily: "Signika, sans-serif",
    fontSize: 22,
    fontWeight: "700",
    fill: "#ffffff",
    stroke: "#1a1108",
    strokeThickness: 4,
    align: "center",
  });
}

/** Per-frame redraw: animated dashes + badge/button placement. */
function animate(delta) {
  if (!overlayLive() || !arrowGfx) return;

  phase += delta;
  const dashOffset = phase * 0.9;

  arrowGfx.clear();

  for (const rel of relationships) {
    const s = rel.source;
    const t = rel.target;
    if (!s?.center || !t?.center || s.destroyed || t.destroyed) continue;

    const from = s.center;
    const to = t.center;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const ux = dx / len;
    const uy = dy / len;

    const targetRadius = Math.max(t.w, t.h) / 2;
    const tipDist = Math.max(0, len - targetRadius);
    const tipX = from.x + ux * tipDist;
    const tipY = from.y + uy * tipDist;

    drawDashedLine(arrowGfx, from.x, from.y, tipX, tipY, {
      dash: 18,
      gap: 12,
      offset: dashOffset,
      width: 4,
      color: rel.color,
      alpha: 0.95,
    });
    drawArrowhead(arrowGfx, tipX, tipY, ux, uy, rel.color);

    const badge = badges.get(s.id);
    if (badge) {
      const mx = (from.x + tipX) / 2;
      const my = (from.y + tipY) / 2;
      badge.position.set(mx, my);

      const halfW = badge.width / 2 + 8;
      const halfH = badge.height / 2 + 4;
      arrowGfx.beginFill(0x000000, 0.55);
      arrowGfx.lineStyle(2, rel.color, 0.9);
      arrowGfx.drawRoundedRect(mx - halfW, my - halfH, halfW * 2, halfH * 2, 6);
      arrowGfx.endFill();
    }
  }

  badgeLayer.visible = relationships.length > 0;

  // Keep ALT buttons glued to their (possibly moving) tokens; self-clean any
  // whose token has gone away.
  if (buttonsVisible) {
    for (const [tid, btn] of aimButtons) {
      const t = canvas.tokens.get(tid);
      if (!t || t.destroyed) {
        btn.container.destroy({ children: true });
        aimButtons.delete(tid);
        continue;
      }
      btn.container.position.set(t.center.x, t.center.y);
    }
  }

  // Float info panels just above each token.
  if (infoVisible) {
    for (const [tid, p] of infoPanels) {
      const t = canvas.tokens.get(tid);
      if (!t || t.destroyed) {
        p.container.destroy({ children: true });
        infoPanels.delete(tid);
        continue;
      }
      p.container.position.set(t.center.x, t.center.y - t.h / 2 - 6);
    }
  }
}

function drawDashedLine(gfx, x1, y1, x2, y2, opts) {
  const { dash = 16, gap = 12, offset = 0, width = 4, color = 0xffffff, alpha = 1 } = opts;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const period = dash + gap;

  gfx.lineStyle(width, color, alpha);
  let d = -(offset % period);
  while (d < len) {
    const start = Math.max(0, d);
    const end = Math.min(len, d + dash);
    if (end > start) {
      gfx.moveTo(x1 + ux * start, y1 + uy * start);
      gfx.lineTo(x1 + ux * end, y1 + uy * end);
    }
    d += period;
  }
}

function drawArrowhead(gfx, tipX, tipY, ux, uy, color) {
  const size = 14;
  const px = -uy;
  const py = ux;
  const baseX = tipX - ux * size;
  const baseY = tipY - uy * size;
  const half = size * 0.6;

  gfx.lineStyle(0);
  gfx.beginFill(color, 0.95);
  gfx.drawPolygon([
    tipX,
    tipY,
    baseX + px * half,
    baseY + py * half,
    baseX - px * half,
    baseY - py * half,
  ]);
  gfx.endFill();
}

/* -------------------------------------------- */
/*  ALT interactive aim buttons                 */
/* -------------------------------------------- */

/**
 * Button side length in world units, scaled to the grid so it's visible on both
 * fine and coarse (e.g. large-hex) maps. Clamped to a sensible range.
 */
function buttonSize() {
  const g = canvas?.grid?.size ?? 100;
  return Math.round(Math.min(160, Math.max(44, g * 0.45)));
}

function buttonTextStyle(size) {
  return new PIXI.TextStyle({
    fontFamily: "Signika, sans-serif",
    fontSize: Math.round(size * 0.42),
    fontWeight: "700",
    fill: "#1a1108",
    stroke: "#ffffff",
    strokeThickness: Math.max(2, Math.round(size * 0.05)),
    align: "center",
  });
}

function getCurrentAimer() {
  // Prefer the still-controlled token; fall back to the one we opened with.
  return canvas.tokens?.controlled[0] ?? currentAimer ?? null;
}

function makeAimButton(target) {
  const size = buttonSize();
  const container = new PIXI.Container();
  container.eventMode = "static";
  container.cursor = "pointer";
  container.hitArea = new PIXI.Rectangle(-size / 2, -size / 2, size, size);

  const gfx = new PIXI.Graphics();
  const label = new PIXI.Text("", buttonTextStyle(size));
  label.anchor.set(0.5);
  container.addChild(gfx, label);
  container.position.set(target.center.x, target.center.y);

  const btn = { container, gfx, label, target };

  container.on("pointerdown", async (event) => {
    // Don't let the click reach the token layer (deselect / drag-select).
    event.stopPropagation();
    event.nativeEvent?.preventDefault?.();

    const aimer = getCurrentAimer();
    if (!aimer) return;

    if (event.button === 2) {
      await removeAimStackOn(aimer, target);
    } else if (event.button === 0) {
      await addAimStackOn(aimer, target);
    }
    // setFlag fires updateToken → refreshAimOverlay → updateButtonStates().
    // Update immediately too so the label responds without waiting on the hook.
    updateButtonStates();
  });

  return btn;
}

function buildAimButtons(aimer) {
  for (const btn of aimButtons.values()) btn.container.destroy({ children: true });
  aimButtons.clear();

  currentAimer = aimer;

  for (const t of canvas.tokens.placeables) {
    if (t.id === aimer.id) continue;
    if (!t.visible) continue;
    const btn = makeAimButton(t);
    buttonLayer.addChild(btn.container);
    aimButtons.set(t.id, btn);
  }

  updateButtonStates();
}

function drawButton(btn, stacks) {
  const color = stackColor(stacks);
  const s = buttonSize();
  btn.gfx.clear();
  // Bright, opaque fill with a dark outline so it stands out on any map.
  btn.gfx.lineStyle(Math.max(2, s * 0.06), 0x1a1108, 0.95);
  btn.gfx.beginFill(color, 0.95);
  btn.gfx.drawRoundedRect(-s / 2, -s / 2, s, s, Math.round(s * 0.18));
  btn.gfx.endFill();

  btn.label.text = stacks > 0 ? `+${stacks * PER_STACK}` : "＋";
}

function updateButtonStates() {
  const aimer = getCurrentAimer();
  const aim = aimer?.document?.getFlag(SYSTEM_ID, FLAG);
  for (const [tid, btn] of aimButtons) {
    const stacks = aim?.targetId === tid ? aim.stacks : 0;
    drawButton(btn, stacks);
  }
}

/* -------------------------------------------- */
/*  ALT info panels (movement + armor)          */
/* -------------------------------------------- */

// Font Awesome glyphs (FA6 solid). Foundry bundles the webfont, so PIXI text can
// render them once it's loaded (always true by the time ALT is pressed).
const FA_FAMILY = ["Font Awesome 6 Pro", "Font Awesome 6 Free", "FontAwesome"];
const ICON_MOVE = ""; // fa-person-running
const ICON_ARMOR = ""; // fa-shield-halved

/** Movement + armor-total for a token. Movement is Speed for every actor type. */
function getTokenStats(token) {
  const sys = token?.actor?.system ?? {};
  const armor = Math.round(sys.armor?.total ?? 0);
  const movement = sys.secondaryAttributes?.spd?.total ?? 0;
  return { movement: Math.round(movement), armor };
}

/** A small dark, slightly translucent panel: [run icon] N  [shield icon] N. */
function makeInfoPanel(token) {
  const { movement, armor } = getTokenStats(token);

  const container = new PIXI.Container();
  container.eventMode = "none";

  const bg = new PIXI.Graphics();
  container.addChild(bg);

  const fontSize = Math.round(Math.max(13, (canvas.grid?.size ?? 100) * 0.16));
  const iconStyle = new PIXI.TextStyle({
    fontFamily: FA_FAMILY,
    fontWeight: "900",
    fontSize,
    fill: "#ffffff",
  });
  const numStyle = new PIXI.TextStyle({
    fontFamily: "Signika, sans-serif",
    fontWeight: "700",
    fontSize,
    fill: "#ffffff",
    stroke: "#000000",
    strokeThickness: 3,
  });

  const pad = Math.round(fontSize * 0.55);
  const gapSmall = Math.round(fontSize * 0.25); // icon → its number
  const gapLarge = Math.round(fontSize * 0.7); // pair → pair
  const h = fontSize + pad * 2;
  const cy = h / 2;
  let x = pad;

  const addPair = (glyph, value, iconColor) => {
    const icon = new PIXI.Text(glyph, iconStyle.clone());
    icon.style.fill = iconColor;
    icon.anchor.set(0, 0.5);
    icon.position.set(x, cy);
    container.addChild(icon);
    x += icon.width + gapSmall;

    const num = new PIXI.Text(String(value), numStyle);
    num.anchor.set(0, 0.5);
    num.position.set(x, cy);
    container.addChild(num);
    x += num.width + gapLarge;
  };

  addPair(ICON_MOVE, movement, "#8fd0ff"); // movement — blue
  addPair(ICON_ARMOR, armor, "#d7d7d7"); // armor — steel

  const w = x - gapLarge + pad;
  bg.beginFill(0x0c0c0a, 0.7);
  bg.lineStyle(1, 0xffffff, 0.18);
  bg.drawRoundedRect(0, 0, w, h, 6);
  bg.endFill();

  // Anchor bottom-centre so it floats just above the token.
  container.pivot.set(w / 2, h);

  return { container };
}

function buildInfoPanels() {
  for (const p of infoPanels.values()) p.container.destroy({ children: true });
  infoPanels.clear();

  for (const t of canvas.tokens.placeables) {
    if (!t.visible) continue;
    const panel = makeInfoPanel(t);
    infoLayer.addChild(panel.container);
    infoPanels.set(t.id, panel);
  }
}

function hideInfoPanels() {
  infoVisible = false;
  if (infoLayer) infoLayer.visible = false;
  for (const p of infoPanels.values()) p.container.destroy({ children: true });
  infoPanels.clear();
}

/* -------------------------------------------- */
/*  Show / hide on ALT                          */
/* -------------------------------------------- */

export function showAimButtons() {
  if (!canvas?.ready) return;
  ensureOverlay();

  // Info panels show for every token, regardless of selection.
  infoVisible = true;
  infoLayer.visible = true;
  buildInfoPanels();

  // Aim buttons require a selected aimer token.
  const aimer = canvas.tokens.controlled[0];
  if (!aimer) return;
  buttonsVisible = true;
  buttonLayer.visible = true;
  buildAimButtons(aimer);
}

function hideAimButtons() {
  buttonsVisible = false;
  if (buttonLayer) buttonLayer.visible = false;
  for (const btn of aimButtons.values()) btn.container.destroy({ children: true });
  aimButtons.clear();
  currentAimer = null;
  hideInfoPanels();
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

/** Register the visualisation + ALT-button hooks. Call once during `init`. */
export function registerAimOverlay() {
  Hooks.on("canvasReady", refreshAimOverlay);
  Hooks.on("updateToken", refreshAimOverlay);
  Hooks.on("deleteToken", refreshAimOverlay);
  Hooks.on("createToken", () => {
    refreshAimOverlay();
    if (buttonsVisible) {
      const aimer = getCurrentAimer();
      if (aimer) buildAimButtons(aimer);
    }
    if (infoVisible) buildInfoPanels();
  });
  Hooks.on("updateScene", refreshAimOverlay);

  // Rebuild buttons when the controlled token changes while ALT is held.
  Hooks.on("controlToken", () => {
    if (!buttonsVisible) return;
    const aimer = canvas.tokens.controlled[0];
    if (aimer) buildAimButtons(aimer);
    else hideAimButtons();
  });

  // Piggyback on Foundry's core "Highlight Objects" keybinding (ALT by default).
  // It fires `highlightObjects(active)` on press/release and already handles
  // key-repeat, focus-in-text-field, and window-blur for us.
  Hooks.on("highlightObjects", (active) => {
    if (active) showAimButtons();
    else hideAimButtons();
  });
}

/**
 * Ensure the three shared Aim macros exist in the Macros directory (GM only).
 * Not pinned to a hotbar slot — players drag them where they like, mirroring the
 * "Resume Duel" niche-macro pattern.
 */
export async function ensureAimMacros() {
  if (!game.user.isGM) return;

  const macros = [
    {
      name: "Add Aim Stack",
      command: "game.redsteel.addAimStack();",
      img: "icons/skills/targeting/target-strike-triple-orange.webp",
    },
    {
      name: "Remove Aim Stack",
      command: "game.redsteel.removeAimStack();",
      img: "icons/skills/targeting/crosshair-arrow-yellow.webp",
    },
    {
      name: "Consume Aim (Attack)",
      command: "game.redsteel.consumeAim();",
      img: "icons/skills/ranged/arrow-flying-broadhead-metal.webp",
    },
  ];

  for (const data of macros) {
    if (game.macros.getName(data.name)) continue;
    const macro = await Macro.create({
      name: data.name,
      type: "script",
      command: data.command,
      img: data.img,
    });
    await macro?.update({ ownership: { default: 2 } }); // shared (observer)
  }
}
