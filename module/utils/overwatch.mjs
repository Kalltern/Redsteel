/**
 * Stráž (Overwatch): watch an area, shoot whoever moves or casts in it.
 *
 * Book: "For one turn, designate an area of 4.5m in sight. In that area you may
 * use reactions to make Opportunity Attacks against targets that move or cast
 * within it." The -20% to defenses from outside the area is NOT automated
 * (user ruling 2026-09-27: status only).
 *
 * ACTIVATION
 * ----------
 * Using the ability rolls nothing. The archer places the area by hand (a gold
 * silhouette follows the cursor, a click places it; never snapped to a
 * target), pays the cost, and gets the
 * `overwatch` status (config.mjs, one actor turn: gone at the start of their
 * next turn). The watched area is a real Scene Region: the centre hex plus its
 * ring, 7 hexes, about 4.5m across (user ruling 2026-09-27), one polygon per
 * hex. Regions are GM-only documents, so a player's client asks the active GM
 * over the system socket to create it. It carries
 * `flags.redsteel.overwatch = {actorUuid, tokenId}` and is visible to the
 * archer's owners (OBSERVER) and the GM. Deleting the status deletes it.
 *
 * THE TRIGGER
 * -----------
 * Movement is Foundry's own region tracking: the Region has a core Execute
 * Script behavior subscribed to tokenMoveIn / tokenMoveWithin / tokenMoveOut,
 * whose one line hands the event to `onRegionEvent` below. Casting is the
 * active GM seeing a spell card whose caster's token stands in the Region
 * (TokenDocument#regions). Either way an enemy of the archer stamps the
 * archer's actor with
 * `flags.redsteel.overwatchTrigger = {combat, round, turn, tokenId, reason, at}`.
 * Written by the active GM only, the newest trigger wins, and it is
 * turn-stamped like the action tracker: a stamp from another turn reads as
 * nothing, so there is no clean-up. The hotbar's suggestion strip turns a live
 * trigger into a "shoot as a reaction" chip; the chip is spent once the archer
 * posts an Opportunity Attack card after the stamp.
 *
 * Any movement triggers, forced ones included: a push, pull, slide or swap
 * through the area arms the shot the same as a step (user ruling 2026-09-27:
 * "any movement unless said otherwise").
 */

import { isHostileSide } from "./movementZones.mjs";

const SYSTEM_ID = "redsteel";
const SOCKET = "system.redsteel";
const STATUS = "overwatch";
const REGION_FLAG = "overwatch";
const TRIGGER_FLAG = "overwatchTrigger";

/** Socket message types (the active GM runs both). */
const MSG_CREATE = "overwatchCreateRegion";
const MSG_TRIGGER = "overwatchTrigger";

/** Gold, the palette's accent; the ranged plate is yellow too. */
const REGION_COLOR = "#c9a227";

/** The events the Region's behavior subscribes to (CONST.REGION_EVENTS). */
const MOVE_EVENTS = ["tokenMoveIn", "tokenMoveWithin", "tokenMoveOut"];

/**
 * The behavior's whole script. The logic stays here in the system, so a fix
 * never needs the Regions already on a scene rewritten.
 */
const BEHAVIOR_SOURCE = "await game.redsteel.overwatch?.onRegionEvent(event);";

/** The pack ability's localisation key, the identity its cards carry. */
export const OVERWATCH_KEY = "REDSTEEL.Items.Overwatch.name";

/**
 * Is this the Overwatch ability? By key, with the always-English name as the
 * fallback for a hand-made copy.
 */
export function isOverwatchAbility(ability) {
  return (
    ability?.system?.localizationKey === OVERWATCH_KEY ||
    ability?.name === "Overwatch"
  );
}

/** The actor's Overwatch effect, or null. */
export function overwatchEffect(actor) {
  return (
    actor?.effects?.contents?.find((e) => e.statuses?.has(STATUS)) ?? null
  );
}

function isActiveGM() {
  return game.user.isGM && game.users.activeGM?.id === game.user.id;
}

/** Run on the active GM: here if this is it, otherwise over the socket. */
function toGM(type, payload) {
  if (isActiveGM()) return handleGM({ type, payload });
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Overwatch.NoGM"));
    return null;
  }
  game.socket.emit(SOCKET, { type, payload });
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Activation                                                                */
/* -------------------------------------------------------------------------- */

/** The silhouette: the palette's gold, fill breathing between two alphas. */
const PREVIEW_FILL = 0xc9a227;
const PREVIEW_LINE = 0xe8c55a;
const PREVIEW_ALPHA_MIN = 0.16;
const PREVIEW_ALPHA_MAX = 0.34;
/** One breath, in milliseconds. */
const PREVIEW_PERIOD = 1400;

/** The watched hexes around a centre: the centre and its ring. */
function areaCells(centre) {
  return [
    { i: centre.i, j: centre.j },
    ...canvas.grid.getAdjacentOffsets({ i: centre.i, j: centre.j }),
  ];
}

/** Canvas point under a mouse event. */
function canvasPoint(event) {
  const client = { x: event.clientX, y: event.clientY };
  return typeof canvas.canvasCoordinatesFromClient === "function"
    ? canvas.canvasCoordinatesFromClient(client)
    : canvas.stage.worldTransform.applyInverse(client);
}

/**
 * The placement silhouette: the 7 hexes under the cursor, filled in gold and
 * outlined, breathing slowly so it reads as "not placed yet". Drawn on
 * canvas.controls, above the tokens (the aim.mjs overlay rule).
 */
function createPreview() {
  const host = canvas.controls ?? canvas.interface;
  const gfx = new PIXI.Graphics();
  gfx.eventMode = "none";
  gfx.zIndex = 950;
  host.sortableChildren = true;
  host.addChild(gfx);

  let centreKey = null;
  const draw = (centre) => {
    const key = centre ? `${centre.i},${centre.j}` : null;
    if (key === centreKey) return;
    centreKey = key;
    gfx.clear();
    if (!centre) return;
    const width = Math.max(2, canvas.grid.size * 0.03);
    for (const cell of areaCells(centre)) {
      const points = canvas.grid.getVertices(cell).flatMap((p) => [p.x, p.y]);
      gfx.lineStyle(width, PREVIEW_LINE, 0.9);
      gfx.beginFill(PREVIEW_FILL, 1);
      gfx.drawPolygon(points);
      gfx.endFill();
    }
  };

  const start = performance.now();
  const breathe = () => {
    if (gfx.destroyed) return;
    const t = ((performance.now() - start) % PREVIEW_PERIOD) / PREVIEW_PERIOD;
    const wave = (1 - Math.cos(t * Math.PI * 2)) / 2;
    gfx.alpha = PREVIEW_ALPHA_MIN + (PREVIEW_ALPHA_MAX - PREVIEW_ALPHA_MIN) * wave;
  };
  breathe();
  canvas.app.ticker.add(breathe);

  const destroy = () => {
    canvas.app?.ticker?.remove(breathe);
    if (!gfx.destroyed) gfx.destroy();
  };
  return { draw, destroy };
}

/**
 * Let the player place the area: the silhouette follows the cursor hex by hex,
 * a left click on the board places it. Right click, Escape or a minute of
 * nothing cancels. Clicks and the Escape are swallowed so they neither select
 * a token nor close a window.
 *
 * @returns {Promise<{i: number, j: number}|null>}
 */
function placeArea() {
  const board = document.getElementById("board");
  if (!board || !canvas?.ready) return Promise.resolve(null);
  const preview = createPreview();

  return new Promise((resolve) => {
    let timer = null;
    const finish = (value) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(timer);
      preview.destroy();
      resolve(value);
    };
    const onMove = (event) => {
      // Off the board (over the sidebar, the hotbar ...) the silhouette hides.
      preview.draw(
        event.target === board ? canvas.grid.getOffset(canvasPoint(event)) : null,
      );
    };
    // On the window in the capture phase, so it runs before the canvas's own
    // handlers; clicks on the UI pass untouched.
    const onPointer = (event) => {
      if (event.target !== board) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.button !== 0) return finish(null);
      finish(canvas.grid.getOffset(canvasPoint(event)));
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
    timer = setTimeout(() => finish(null), 60_000);
  });
}

/**
 * Where to watch, always placed by hand (user ruling 2026-09-27: never snapped
 * to a target). The window that launched it steps aside while the player
 * places, and comes back afterwards; the caller closes it if it should not
 * stay open. Null when the player backs out, in which case nothing is spent.
 *
 * @param {object} [options]
 * @param {HTMLElement|jQuery|null} [options.hide]  The launching dialog's element.
 * @returns {Promise<{sceneId: string, i: number, j: number}|null>}
 */
export async function pickOverwatchArea({ hide = null } = {}) {
  if (!canvas?.ready) return null;
  const element = hide?.[0] ?? hide ?? null;
  const previousDisplay = element?.style?.display ?? "";
  if (element?.style) element.style.display = "none";
  ui.notifications.info(game.i18n.localize("REDSTEEL.Overwatch.PickArea"));
  let centre = null;
  try {
    centre = await placeArea();
  } finally {
    if (element?.style) element.style.display = previousDisplay;
  }
  if (!centre) return null;
  return { sceneId: canvas.scene.id, i: centre.i, j: centre.j };
}

/**
 * The Region's create data, built on the archer's client (it has the canvas
 * and its grid) and created by the GM as is.
 */
function regionData(actor, token, area) {
  const shapes = areaCells(area).map((cell) => ({
    type: "polygon",
    hole: false,
    points: canvas.grid.getVertices(cell).flatMap((p) => [p.x, p.y]),
  }));

  // The archer's players see their own watch; the other side does not.
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  for (const user of game.users.contents) {
    if (user.isGM) continue;
    if (actor.testUserPermission(user, "OWNER")) {
      ownership[user.id] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
    }
  }

  return {
    name: `Overwatch: ${token?.name ?? actor.name}`,
    color: REGION_COLOR,
    shapes,
    visibility: CONST.REGION_VISIBILITY.OBSERVER,
    ownership,
    flags: {
      [SYSTEM_ID]: {
        [REGION_FLAG]: { actorUuid: actor.uuid, tokenId: token?.id ?? null },
      },
    },
    behaviors: [
      {
        name: "Overwatch",
        type: "executeScript",
        system: { events: MOVE_EVENTS, source: BEHAVIOR_SOURCE },
      },
    ],
  };
}

/**
 * Put the archer on Overwatch over `area`. The cost is paid by the caller.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {{sceneId: string, i: number, j: number}} area
 */
export async function activateOverwatch(actor, ability, area) {
  const token =
    (actor.isToken ? actor.token : null) ??
    canvas.scene?.tokens?.contents?.find((t) => t.actor === actor) ??
    null;

  const effect = await game.redsteel.applyEffect(actor, STATUS);
  if (!effect) return;
  // A trigger left over from an earlier watch must not arm this one.
  if (actor.getFlag(SYSTEM_ID, TRIGGER_FLAG)) {
    await actor.unsetFlag(SYSTEM_ID, TRIGGER_FLAG);
  }
  await toGM(MSG_CREATE, {
    sceneId: area.sceneId,
    actorUuid: actor.uuid,
    data: regionData(actor, token, area),
  });

  const label = ability.localizedName ?? ability.name;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong>${label}</strong>
</span>
<hr>
<p class="rs-card-headline" style="text-align:center;">${game.i18n.localize(
      "REDSTEEL.Overwatch.Activated",
    )}</p>`,
    flags: { redsteel: { abilityKey: OVERWATCH_KEY } },
  });
}

/* -------------------------------------------------------------------------- */
/*  Regions (active GM)                                                       */
/* -------------------------------------------------------------------------- */

/** Every Overwatch Region an actor owns, on any scene. */
function regionsOf(actorUuid) {
  const found = [];
  for (const scene of game.scenes.contents) {
    for (const region of scene.regions?.contents ?? []) {
      if (region.getFlag(SYSTEM_ID, REGION_FLAG)?.actorUuid === actorUuid) {
        found.push(region);
      }
    }
  }
  return found;
}

async function deleteRegionsOf(actorUuid) {
  for (const region of regionsOf(actorUuid)) await region.delete();
}

/** One watch per archer: the old Region goes before the new one is made. */
async function createRegion({ sceneId, actorUuid, data }) {
  const scene = game.scenes.get(sceneId);
  if (!scene || !data) return;
  await deleteRegionsOf(actorUuid);
  await scene.createEmbeddedDocuments("Region", [data]);
}

/**
 * Stamp the archer watching `region` with a trigger by `moverId`, if the mover
 * fights on the other side. Active GM only.
 */
async function stampFromRegion(region, moverId, reason) {
  const combat = game.combat;
  if (!combat?.started) return;
  const info = region?.getFlag(SYSTEM_ID, REGION_FLAG);
  if (!info) return;
  const archer = fromUuidSync(info.actorUuid);
  if (!archer || !overwatchEffect(archer)) return;

  const scene = region.parent;
  const mover = scene?.tokens?.get(moverId);
  if (!mover || mover.actor === archer || mover.id === info.tokenId) return;
  const archerToken = scene.tokens.get(info.tokenId);
  const archerSide = archerToken
    ? isHostileSide(archerToken)
    : archer.type !== "character" && !archer.system?.partyMember;
  if (isHostileSide(mover) === archerSide) return;

  await archer.setFlag(SYSTEM_ID, TRIGGER_FLAG, {
    combat: combat.id,
    round: combat.round,
    turn: combat.turn,
    tokenId: mover.id,
    reason,
    at: Date.now(),
  });
}

async function handleGM({ type, payload }) {
  if (!isActiveGM() || !payload) return;
  if (type === MSG_CREATE) return createRegion(payload);
  if (type === MSG_TRIGGER) {
    const region = fromUuidSync(payload.regionUuid);
    return stampFromRegion(region, payload.moverId, payload.reason);
  }
}

/**
 * Called by the Region's Execute Script behavior on a token moving into,
 * within or out of it, however it moved (forced moves too). Acted on only by
 * the client that made the move (the event's user), so it is handed to the
 * active GM exactly once.
 *
 * @param {object} event  RegionEvent: {name, data: {token, movement}, region, user}
 */
async function onRegionEvent(event) {
  if (!event?.user?.isSelf) return;
  if (!game.combat?.started) return;
  const mover = event.data?.token;
  if (!mover) return;
  await toGM(MSG_TRIGGER, {
    regionUuid: event.region?.uuid,
    moverId: mover.id,
    reason: "move",
  });
}

/** A spell card (magicSkillBonuses.mjs) from a caster standing in a Region. */
function onCreateChatMessage(message) {
  if (!isActiveGM() || !game.combat?.started) return;
  const flags = message.flags?.redsteel ?? {};
  if (!flags.spellSchool || !flags.casterUuid) return;
  const caster = fromUuidSync(flags.casterUuid);
  for (const tokenDoc of caster?.getActiveTokens?.(false, true) ?? []) {
    for (const region of tokenDoc.regions ?? []) {
      if (!region.getFlag(SYSTEM_ID, REGION_FLAG)) continue;
      stampFromRegion(region, tokenDoc.id, "cast").catch((err) =>
        console.error("Redsteel | Overwatch cast trigger failed", err),
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Reading it back (suggestion strip)                                        */
/* -------------------------------------------------------------------------- */

/**
 * The live trigger for this archer: Overwatch still up, stamped in this very
 * turn, and not yet answered with an Opportunity Attack.
 *
 * @param {Actor} actor
 * @returns {{tokenId: string, reason: string}|null}
 */
export function overwatchTrigger(actor) {
  const combat = game.combat;
  if (!combat?.started || !overwatchEffect(actor)) return null;
  const t = actor.getFlag(SYSTEM_ID, TRIGGER_FLAG);
  if (
    !t ||
    t.combat !== combat.id ||
    Number(t.round) !== Number(combat.round) ||
    Number(t.turn) !== Number(combat.turn)
  ) {
    return null;
  }

  // Answered once this archer has posted an Opportunity Attack since the
  // stamp. Matched by token first: an unlinked NPC's speaker carries the base
  // actor's id, which every copy of that NPC shares.
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
  return t;
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                              */
/* -------------------------------------------------------------------------- */

/** Registered once at init. */
export function registerOverwatchHooks() {
  game.redsteel.overwatch = { onRegionEvent };

  Hooks.on("createChatMessage", onCreateChatMessage);

  // The watch ends with the status: at the archer's next turn start, or when
  // anyone removes it by hand.
  Hooks.on("deleteActiveEffect", (effect) => {
    if (!isActiveGM() || !effect?.statuses?.has(STATUS)) return;
    const actor = effect.parent instanceof Actor ? effect.parent : null;
    if (actor) deleteRegionsOf(actor.uuid);
  });

  Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
      if (data?.type !== MSG_CREATE && data?.type !== MSG_TRIGGER) return;
      handleGM(data).catch((err) =>
        console.error("Redsteel | Overwatch socket request failed", err),
      );
    });
  });
}
