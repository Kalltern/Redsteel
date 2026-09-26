/**
 * Passing through an ally (user ruling 2026-09-24).
 *
 * In combat a token may move through a hex an ally stands on only if that ally
 * lets it, and letting it costs the ally its Reaction. The movement zones draw
 * such hexes faint (movementZones.mjs); this file makes the move itself ask.
 *
 * FLOW
 * ----
 * 1. `preMoveToken` runs on the moving client only, sees the whole planned
 *    route, and may cancel it by returning false (V14 docs). When the route
 *    passes an ally, it is cancelled and the request below starts instead.
 * 2. Each ally on the route is asked in turn. The question goes to the player
 *    whose character it is if they are online, otherwise to the GM (user
 *    ruling). A user who controls both tokens is not asked: it passes at once.
 * 3. The answering client spends the ally's Reaction itself, since it owns
 *    that actor, and replies over the system socket.
 * 4. All yes: the mover's client stores a short-lived approval and re-issues
 *    the same waypoints with TokenDocument#move; `preMoveToken` sees the
 *    approval and lets it through. Any no, no Reaction left, nobody to ask or
 *    no answer within the timeout: that attempt is cancelled and the token
 *    keeps its remaining movement (user ruling: the attempt, not the turn).
 *
 * Outside a started combat nothing is asked.
 */

import { spend } from "./actionTracker.mjs";
import { alliesOnPath } from "./movementZones.mjs";

const SOCKET = "system.redsteel";
const REQUEST = "allyPassRequest";
const RESPONSE = "allyPassResponse";

/** How long the mover waits for an answer before counting it as a no. */
const ANSWER_TIMEOUT_MS = 60_000;

/** How long an approval stays good for the re-issued move to pick it up. */
const APPROVAL_TTL_MS = 30_000;

/** Mover token id -> { allyIds: Set<string>, until: number }. This client only. */
const approvals = new Map();

/** Request id -> resolve(accepted: boolean), for requests this client sent. */
const pending = new Map();

/** Mover token ids with a request in flight, so a second drag does not stack. */
const asking = new Set();

const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.AllyPass.${key}`, data)
    : game.i18n.localize(`REDSTEEL.AllyPass.${key}`);

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* -------------------------------------------------------------------------- */
/*  The route                                                                 */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/*  Who answers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The user who answers for an ally: the online player whose character it is,
 * else any online player who owns it, else the active GM. Null when nobody
 * who could answer is connected.
 */
function responderFor(actor) {
  if (!actor) return game.users.activeGM ?? null;
  const players = game.users.contents.filter(
    (u) => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"),
  );
  const own = players.find((u) => u.character?.id === actor.id) ?? players[0];
  return own ?? game.users.activeGM ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Asking                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Ask one ally to let the mover pass. Resolves true once the ally agreed and
 * its Reaction has been spent (by whoever answered), false otherwise.
 */
async function askAlly(moverDoc, allyDoc) {
  const actor = allyDoc.actor;
  const responder = responderFor(actor);
  if (!responder) {
    ui.notifications.warn(L("NoOne", { ally: allyDoc.name }));
    return false;
  }

  // Controlling both tokens: there is nobody else to ask.
  if (responder.id === game.user.id) {
    if (actor) await spend(actor, { reactions: 1 });
    return true;
  }

  const requestId = foundry.utils.randomID();
  ui.notifications.info(L("Waiting", { ally: allyDoc.name }));
  const answer = new Promise((resolve) => {
    pending.set(requestId, resolve);
    setTimeout(() => {
      if (!pending.has(requestId)) return;
      pending.delete(requestId);
      resolve(false);
    }, ANSWER_TIMEOUT_MS);
  });

  game.socket.emit(SOCKET, {
    type: REQUEST,
    requestId,
    toUserId: responder.id,
    fromUserId: game.user.id,
    sceneId: allyDoc.parent?.id,
    allyTokenId: allyDoc.id,
    moverName: moverDoc.name,
  });

  return answer;
}

/**
 * Ask every ally on the route in turn, then re-issue the move. Stops at the
 * first no; the token has not moved, so its remaining movement is untouched.
 */
async function requestPassage(moverDoc, allies, waypoints) {
  if (asking.has(moverDoc.id)) return;
  asking.add(moverDoc.id);
  try {
    for (const ally of allies) {
      if (!ally.hasReaction) {
        ui.notifications.warn(L("NoReaction", { ally: ally.doc.name }));
        return;
      }
      if (!(await askAlly(moverDoc, ally.doc))) {
        ui.notifications.warn(L("Declined", { ally: ally.doc.name }));
        return;
      }
    }
    approvals.set(moverDoc.id, {
      allyIds: new Set(allies.map((a) => a.doc.id)),
      until: Date.now() + APPROVAL_TTL_MS,
    });
    await moverDoc.move(waypoints);
  } catch (err) {
    console.error("REDSTEEL: ally passage failed", err);
  } finally {
    asking.delete(moverDoc.id);
  }
}

/* -------------------------------------------------------------------------- */
/*  Answering                                                                 */
/* -------------------------------------------------------------------------- */

/** The dialog the ally's player (or the GM) sees. Closing it is a no. */
async function promptAlly(data, allyDoc) {
  const DialogV2 = foundry.applications.api.DialogV2;
  let dialogRef = null;
  // Close it just before the mover stops waiting, so a late yes cannot spend
  // a Reaction on a move that was already given up.
  const closer = setTimeout(() => {
    if (typeof dialogRef?.close === "function") dialogRef.close();
  }, ANSWER_TIMEOUT_MS - 2_000);
  try {
    const result = await DialogV2.wait({
      window: { title: L("Title"), icon: "fa-light fa-people-arrows" },
      classes: ["redsteel"],
      position: { width: 360 },
      content: `<p>${L("Body", {
        mover: `<b>${escapeHtml(data.moverName)}</b>`,
        ally: `<b>${escapeHtml(allyDoc.name)}</b>`,
      })}</p>`,
      buttons: [
        { action: "allow", label: L("Allow"), icon: "fas fa-check", default: true },
        { action: "refuse", label: L("Refuse"), icon: "fas fa-xmark" },
      ],
      render: (_event, dialog) => {
        dialogRef = dialog;
      },
    });
    return result === "allow";
  } catch (_err) {
    return false;
  } finally {
    clearTimeout(closer);
  }
}

async function onRequest(data) {
  const allyDoc = game.scenes.get(data.sceneId)?.tokens.get(data.allyTokenId);
  let accepted = false;
  if (allyDoc) {
    accepted = await promptAlly(data, allyDoc);
    if (accepted && allyDoc.actor) await spend(allyDoc.actor, { reactions: 1 });
  }
  game.socket.emit(SOCKET, {
    type: RESPONSE,
    requestId: data.requestId,
    toUserId: data.fromUserId,
    accepted,
  });
}

function onResponse(data) {
  const resolve = pending.get(data.requestId);
  if (!resolve) return;
  pending.delete(data.requestId);
  resolve(!!data.accepted);
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

export function registerAllyPassage() {
  Hooks.on("preMoveToken", (tokenDoc, movement) => {
    if (!game.combat?.started) return;
    const token = tokenDoc.object;
    // The route of THIS move sits in `passed` at pre-move time and `pending`
    // is empty (seen in V14, 2026-09-24); a paused or split move can carry
    // both. The origin itself may lead the list, so drop it.
    const origin = movement?.origin;
    const waypoints = [
      ...(movement?.passed?.waypoints ?? []),
      ...(movement?.pending?.waypoints ?? []),
    ].filter((w, i) => !(i === 0 && origin && w.x === origin.x && w.y === origin.y));
    if (!token || !origin || !waypoints.length) return;

    const points = [
      centreOf(movement.origin, tokenDoc),
      ...waypoints.map((w) => centreOf(w, tokenDoc)),
    ];
    const allies = alliesOnPath(token, points);
    if (!allies.length) return;

    const approval = approvals.get(tokenDoc.id);
    if (
      approval &&
      approval.until > Date.now() &&
      allies.every((a) => approval.allyIds.has(a.doc.id))
    ) {
      approvals.delete(tokenDoc.id);
      return;
    }

    // Cancel this attempt; the request re-issues it if everyone agrees.
    requestPassage(tokenDoc, allies, waypoints.map(copyWaypoint));
    return false;
  });

  Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
      if (data?.toUserId !== game.user.id) return;
      if (data.type === REQUEST) onRequest(data);
      else if (data.type === RESPONSE) onResponse(data);
    });
  });
}
