/**
 * PLAYER-TO-PLAYER TRADE (WoW-style)
 *
 * A player right-clicks a teammate portrait on the Redsteel hotbar and picks
 * Trade. A trade window opens on BOTH clients at once, no prompt first. Each
 * side puts up to six items and some coins into its own half, and each side
 * clicks Trade to accept. Any change to either offer clears both accepts. Once
 * both have accepted the identical state, the active GM's client performs the
 * swap, because only the GM may write to both actors.
 *
 * STATE. Everything is transient and in memory, nothing is stored on the
 * actors. Each client holds one `session` (one trade per user at a time):
 *   { id, isInitiator, partnerUserId,
 *     me:   { actorUuid, offer: { slots, money, coins }, accepted },
 *     them: { actorUuid, name, img, slots (snapshot), money, accepted } }
 * Each client only ever mutates its own side and broadcasts a full snapshot of
 * it. The partner renders that snapshot and never reads the other actor's
 * items, so an unidentified item's real name cannot leak.
 *
 * SOCKET. Every payload carries `type` (prefixed "trade", so the big handler
 * in redsteel.mjs ignores it), `toUserId`, `fromUserId` and `tradeId`.
 *   tradeOpen    initiator -> partner   opens the partner's window
 *   tradeUpdate  either -> other        full snapshot of the sender's side
 *   tradeAccept  either -> other        accepted flag + the state it was for
 *   tradeCancel  either -> other        closes the other window
 *   tradeExecute initiator -> active GM both sides, performed by the GM
 *   tradeResult  GM -> both             ok / reason
 *
 * ACCEPT. An accept is bound to a `stateKey` (item ids, quantities and money
 * of both sides, initiator first). An accept for a stale state is ignored.
 * Only the initiator sends tradeExecute, so a trade cannot run twice; the GM
 * also drops a tradeId it is already running or has completed.
 */

import {
  chargeActor,
  creditActor,
  formatPrice,
  getRoster,
  layoutPurse,
  purseTotal,
} from "./currency.mjs";
import { isItemUnidentified } from "./itemIdentify.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SOCKET = "system.redsteel";
const APP_ID = "redsteel-trade-window";
const TEMPLATE = "systems/redsteel/templates/trade/trade-window.hbs";
const ICON = "fa-solid fa-scale-balanced";
const SLOT_COUNT = 6;

const MSG = {
  OPEN: "tradeOpen",
  UPDATE: "tradeUpdate",
  ACCEPT: "tradeAccept",
  CANCEL: "tradeCancel",
  EXECUTE: "tradeExecute",
  RESULT: "tradeResult",
};

/** The inventory grid types. Everything else (features, spells…) stays put. */
const TRADEABLE_TYPES = new Set([
  "weapon",
  "gear",
  "consumable",
  "ammunition",
  "item",
  "spellbook",
  "scroll",
]);

/** This client's one open trade, or null. */
let session = null;

/** The window showing `session`, or null. */
let tradeWindow = null;

/** GM only: trade ids running or completed, so a duplicate execute is dropped. */
const executedTrades = new Set();

const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.Trade.${key}`, data)
    : game.i18n.localize(`REDSTEEL.Trade.${key}`);

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Send a payload. Emit does not echo to the sender, so a payload addressed to
 * this user (a GM trading, the GM replying to itself) is handled locally.
 */
function send(payload) {
  const full = { fromUserId: game.user.id, ...payload };
  if (full.toUserId === game.user.id) {
    Promise.resolve().then(() => onSocket(full));
    return;
  }
  game.socket.emit(SOCKET, full);
}

/* -------------------------------------------------------------------------- */
/*  Items                                                                     */
/* -------------------------------------------------------------------------- */

/** How many of this item there are: its quantity field, or 1 without one. */
function stackSize(item) {
  const q = item?.system?.quantity;
  if (q === undefined || q === null || q === "") return 1;
  const n = Math.floor(Number(q));
  return Number.isFinite(n) ? Math.max(0, n) : 1;
}

/** The lang key saying why this item cannot go into the actor's offer, or null. */
function offerProblem(actor, item) {
  if (!actor || !item || item.parent?.uuid !== actor.uuid) return "NotYours";
  if (!TRADEABLE_TYPES.has(item.type) || stackSize(item) < 1) return "NotTradeable";
  if (actor.getEquippedItemIds?.().has(item.id)) return "Equipped";
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Who can trade                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Whether `myActor` can trade with `targetActor`, and with which user.
 *
 * The partner is the online player whose assigned character the target is,
 * else any other online player who owns it. GMs are never a trade partner.
 *
 * @returns {{partnerUser: User}|null}
 */
export function canTradeWith(myActor, targetActor) {
  if (!myActor || !targetActor) return null;
  if (myActor === targetActor || myActor.uuid === targetActor.uuid) return null;
  if (!myActor.isOwner) return null;
  const others = game.users.contents.filter(
    (u) => u.active && !u.isGM && u.id !== game.user.id,
  );
  const partnerUser =
    others.find((u) => u.character?.id === targetActor.id) ??
    others.find((u) => targetActor.testUserPermission(u, "OWNER"));
  return partnerUser ? { partnerUser } : null;
}

/* -------------------------------------------------------------------------- */
/*  Session                                                                   */
/* -------------------------------------------------------------------------- */

function emptySlots() {
  return Array.from({ length: SLOT_COUNT }, () => null);
}

function newSession({ id, isInitiator, partnerUserId, myActor, them }) {
  return {
    id,
    isInitiator,
    partnerUserId,
    executeSent: false,
    lastSent: null,
    me: {
      actorUuid: myActor.uuid,
      offer: { slots: emptySlots(), money: 0, coins: {} },
      accepted: false,
    },
    them: {
      actorUuid: them.actorUuid,
      name: them.name ?? "",
      img: them.img ?? "",
      slots: normaliseSnapshotSlots(them.slots),
      money: Math.max(0, Math.floor(Number(them.money) || 0)),
      accepted: false,
    },
  };
}

function normaliseSnapshotSlots(slots) {
  const out = emptySlots();
  if (!Array.isArray(slots)) return out;
  for (let i = 0; i < SLOT_COUNT; i++) out[i] = slots[i] ?? null;
  return out;
}

function myActor() {
  return session ? fromUuidSync(session.me.actorUuid) : null;
}

/** Both sides accepted the same state: the trade is with the GM. */
function isWaiting() {
  return !!session && session.me.accepted && session.them.accepted;
}

/** The snapshot of my side that goes over the wire. */
function mySide() {
  const actor = myActor();
  const offer = session.me.offer;
  return {
    actorUuid: session.me.actorUuid,
    name: actor?.name ?? "",
    img: actor?.img ?? "",
    money: offer.money,
    slots: offer.slots.map((slot) => {
      if (!slot) return null;
      const item = actor?.items.get(slot.itemId);
      if (!item) return null;
      return {
        itemId: slot.itemId,
        quantity: slot.quantity,
        name: item.localizedName,
        img: item.img,
        type: item.type,
        unidentified: isItemUnidentified(item),
        stack: stackSize(item) > 1,
      };
    }),
  };
}

/** Ids, quantities and money only: what an accept is bound to. */
function keySide(slots, money) {
  return {
    slots: slots.map((s) => (s ? [s.itemId, s.quantity] : null)),
    money: Math.max(0, Math.floor(Number(money) || 0)),
  };
}

function stateKey() {
  const mine = keySide(session.me.offer.slots, session.me.offer.money);
  const theirs = keySide(session.them.slots, session.them.money);
  return JSON.stringify(session.isInitiator ? [mine, theirs] : [theirs, mine]);
}

function address(type, extra = {}) {
  return {
    type,
    toUserId: session.partnerUserId,
    tradeId: session.id,
    ...extra,
  };
}

/** My side changed: nobody's accept stands any more, tell the partner. */
function offerChanged({ warn } = {}) {
  if (!session) return;
  session.me.accepted = false;
  session.them.accepted = false;
  session.executeSent = false;
  const side = mySide();
  session.lastSent = JSON.stringify(side);
  send(address(MSG.UPDATE, { side, warn: warn ?? null }));
  renderWindow();
}

/**
 * Drop whatever in my offer is no longer true: deleted or equipped items,
 * quantities above the stack, money above the purse. True if anything changed.
 */
function reconcileMine() {
  const actor = myActor();
  if (!actor) return false;
  const offer = session.me.offer;
  let changed = false;
  offer.slots = offer.slots.map((slot) => {
    if (!slot) return slot;
    const item = actor.items.get(slot.itemId);
    if (offerProblem(actor, item)) {
      changed = true;
      return null;
    }
    const max = stackSize(item);
    if (slot.quantity > max) {
      changed = true;
      return { ...slot, quantity: max };
    }
    return slot;
  });
  const purse = purseTotal(actor);
  if (offer.money > purse) {
    offer.money = purse;
    offer.coins = layoutPurse(purse);
    changed = true;
  }
  return changed;
}

/** Re-check my side after my actor or its items changed. */
function refreshMine() {
  if (!session) return;
  if (isWaiting()) return;
  reconcileMine();
  const now = JSON.stringify(mySide());
  if (now !== session.lastSent) offerChanged();
  else renderWindow();
}

function renderWindow() {
  if (tradeWindow?.rendered) tradeWindow.render();
}

function openWindow() {
  tradeWindow = new TradeWindow();
  tradeWindow.render({ force: true });
}

/**
 * End this client's trade and close the window.
 * @param {{emitCancel?: boolean, reason?: string}} [options]
 */
function endSession({ emitCancel = false, reason = "cancel" } = {}) {
  if (!session) return;
  if (emitCancel) send(address(MSG.CANCEL, { reason }));
  session = null;
  const app = tradeWindow;
  tradeWindow = null;
  app?.close();
}

/**
 * Initiator only: once both sides accept, hand the trade to the active GM.
 */
function maybeExecute() {
  if (!session?.isInitiator || !isWaiting() || session.executeSent) return;
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn(L("NoGM"));
    offerChanged({ warn: "NoGM" });
    return;
  }
  session.executeSent = true;
  const toWire = (slots) =>
    slots.map((s) => (s ? { itemId: s.itemId, quantity: s.quantity } : null));
  send({
    type: MSG.EXECUTE,
    toUserId: gm.id,
    tradeId: session.id,
    initiatorUserId: game.user.id,
    partnerUserId: session.partnerUserId,
    sides: [
      {
        actorUuid: session.me.actorUuid,
        slots: toWire(session.me.offer.slots),
        money: session.me.offer.money,
      },
      {
        actorUuid: session.them.actorUuid,
        slots: toWire(session.them.slots),
        money: session.them.money,
      },
    ],
  });
}

/* -------------------------------------------------------------------------- */
/*  Offer edits (my side)                                                     */
/* -------------------------------------------------------------------------- */

function addToOffer(item, preferredIndex = null) {
  if (!session || isWaiting()) return false;
  const actor = myActor();
  const problem = offerProblem(actor, item);
  if (problem) {
    ui.notifications.warn(L(problem));
    return false;
  }
  const slots = session.me.offer.slots;
  if (slots.some((s) => s?.itemId === item.id)) {
    ui.notifications.warn(L("Duplicate"));
    return false;
  }
  const index =
    Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < SLOT_COUNT && !slots[preferredIndex]
      ? preferredIndex
      : slots.findIndex((s) => !s);
  if (index < 0) {
    ui.notifications.warn(L("Full"));
    return false;
  }
  slots[index] = { itemId: item.id, quantity: stackSize(item) };
  offerChanged();
  return true;
}

function removeFromOffer(index) {
  if (!session || isWaiting()) return;
  if (!session.me.offer.slots[index]) return;
  session.me.offer.slots[index] = null;
  offerChanged();
}

function setQuantity(index, value) {
  if (!session || isWaiting()) return;
  const slot = session.me.offer.slots[index];
  const item = slot ? myActor()?.items.get(slot.itemId) : null;
  if (!item) return;
  const max = stackSize(item);
  const n = Math.min(max, Math.max(1, Math.floor(Number(value) || 1)));
  if (n === slot.quantity) {
    renderWindow();
    return;
  }
  session.me.offer.slots[index] = { ...slot, quantity: n };
  offerChanged();
}

function setCoins(counts) {
  if (!session || isWaiting()) return;
  const actor = myActor();
  const offer = session.me.offer;
  let coins = {};
  let total = 0;
  for (const d of getRoster()) {
    const n = Math.max(0, Math.floor(Number(counts[d.key]) || 0));
    coins[d.key] = n;
    total += n * d.value;
  }
  const purse = purseTotal(actor);
  if (total > purse) {
    total = purse;
    coins = layoutPurse(purse);
  }
  offer.coins = coins;
  if (total === offer.money) {
    renderWindow();
    return;
  }
  offer.money = total;
  offerChanged();
}

/* -------------------------------------------------------------------------- */
/*  Starting a trade                                                          */
/* -------------------------------------------------------------------------- */

/** Open a trade between `myActor` and `targetActor`, on both clients. */
export function requestTrade(myActor, targetActor) {
  const who = canTradeWith(myActor, targetActor);
  if (!who) return;
  if (session) {
    ui.notifications.warn(L("SelfBusy"));
    tradeWindow?.bringToFront?.();
    return;
  }
  session = newSession({
    id: foundry.utils.randomID(),
    isInitiator: true,
    partnerUserId: who.partnerUser.id,
    myActor,
    them: { actorUuid: targetActor.uuid, name: targetActor.name, img: targetActor.img },
  });
  const side = mySide();
  session.lastSent = JSON.stringify(side);
  send(address(MSG.OPEN, { side, targetActorUuid: targetActor.uuid }));
  openWindow();
}

/* -------------------------------------------------------------------------- */
/*  Socket                                                                    */
/* -------------------------------------------------------------------------- */

function fromPartner(data) {
  return !!session && data.tradeId === session.id && data.fromUserId === session.partnerUserId;
}

async function onSocket(data) {
  switch (data.type) {
    case MSG.OPEN:
      return onOpen(data);
    case MSG.UPDATE:
      return onUpdate(data);
    case MSG.ACCEPT:
      return onAccept(data);
    case MSG.CANCEL:
      return onCancel(data);
    case MSG.EXECUTE:
      return onExecute(data);
    case MSG.RESULT:
      return onResult(data);
  }
}

async function onOpen(data) {
  const reply = (reason) =>
    send({ type: MSG.CANCEL, toUserId: data.fromUserId, tradeId: data.tradeId, reason });
  if (session) return reply("busy");
  const actor = await fromUuid(data.targetActorUuid);
  if (!actor?.isOwner) return reply("cancel");
  // Re-checked after the await: a second open may have arrived meanwhile.
  if (session) return reply("busy");
  session = newSession({
    id: data.tradeId,
    isInitiator: false,
    partnerUserId: data.fromUserId,
    myActor: actor,
    them: data.side ?? {},
  });
  // Introduces my name and portrait; my side is still empty.
  const side = mySide();
  session.lastSent = JSON.stringify(side);
  send(address(MSG.UPDATE, { side, warn: null }));
  openWindow();
}

function onUpdate(data) {
  if (!fromPartner(data)) return;
  const side = data.side ?? {};
  session.them = {
    actorUuid: side.actorUuid ?? session.them.actorUuid,
    name: side.name || session.them.name,
    img: side.img || session.them.img,
    slots: normaliseSnapshotSlots(side.slots),
    money: Math.max(0, Math.floor(Number(side.money) || 0)),
    accepted: false,
  };
  session.me.accepted = false;
  session.executeSent = false;
  if (data.warn) ui.notifications.warn(L(data.warn));
  renderWindow();
}

function onAccept(data) {
  if (!fromPartner(data)) return;
  if (!data.accepted) {
    session.them.accepted = false;
    renderWindow();
    return;
  }
  // An accept for a state that has since changed is stale.
  if (data.stateKey !== stateKey()) return;
  session.them.accepted = true;
  maybeExecute();
  renderWindow();
}

function onCancel(data) {
  if (!fromPartner(data)) return;
  const name = session.them.name;
  ui.notifications.info(data.reason === "busy" ? L("Busy", { name }) : L("Cancelled", { name }));
  endSession();
}

function onResult(data) {
  if (!game.users.get(data.fromUserId)?.isGM) return;
  const mine = !!session && session.id === data.tradeId;
  if (data.ok) {
    ui.notifications.info(L("Complete"));
    if (mine) endSession();
    return;
  }
  ui.notifications.warn(L("Failed", { reason: L(data.reason || "Generic") }));
  if (!mine) return;
  session.me.accepted = false;
  session.them.accepted = false;
  session.executeSent = false;
  // Whatever broke may have been on my side: re-check it and resend if so.
  refreshMine();
  renderWindow();
}

/* -------------------------------------------------------------------------- */
/*  GM: performing the trade                                                  */
/* -------------------------------------------------------------------------- */

/** The failure lang key for one side, or null when it can be performed. */
function validateSide(actor, side, user) {
  if (!actor || !user || !actor.testUserPermission(user, "OWNER")) return "Generic";
  const slots = Array.isArray(side?.slots) ? side.slots : [];
  if (slots.length > SLOT_COUNT) return "Generic";
  const equipped = actor.getEquippedItemIds?.() ?? new Set();
  const seen = new Set();
  for (const slot of slots) {
    if (!slot) continue;
    if (seen.has(slot.itemId)) return "Duplicate";
    seen.add(slot.itemId);
    const item = actor.items.get(slot.itemId);
    if (!item) return "ItemMissing";
    if (!TRADEABLE_TYPES.has(item.type)) return "NotTradeable";
    if (equipped.has(item.id)) return "ItemEquipped";
    const q = Math.floor(Number(slot.quantity));
    if (!(q >= 1 && q <= stackSize(item))) return "QuantityChanged";
  }
  const money = Math.floor(Number(side?.money) || 0);
  if (money < 0) return "Generic";
  if (money > purseTotal(actor)) return "NotEnoughMoney";
  return null;
}

async function onExecute(data) {
  if (game.user.id !== game.users.activeGM?.id) return;
  if (executedTrades.has(data.tradeId)) return;
  executedTrades.add(data.tradeId);

  const userIds = [data.initiatorUserId, data.partnerUserId];
  const reply = (ok, reason = null) => {
    for (const uid of userIds) {
      send({ type: MSG.RESULT, toUserId: uid, tradeId: data.tradeId, ok, reason });
    }
  };
  const fail = (reason) => {
    // A failed trade may be accepted again under the same id.
    executedTrades.delete(data.tradeId);
    reply(false, reason);
  };

  try {
    const sides = Array.isArray(data.sides) ? data.sides : [];
    if (sides.length !== 2) return fail("Generic");
    const actors = await Promise.all(sides.map((s) => fromUuid(s?.actorUuid)));
    if (!actors[0] || !actors[1] || actors[0].uuid === actors[1].uuid) return fail("Generic");
    for (let i = 0; i < 2; i++) {
      const reason = validateSide(actors[i], sides[i], game.users.get(userIds[i]));
      if (reason) return fail(reason);
    }

    // Plan everything before writing anything.
    const creates = [[], []];
    const deletes = [[], []];
    const updates = [[], []];
    const summaries = [];
    for (let i = 0; i < 2; i++) {
      const giver = actors[i];
      const lines = [];
      for (const slot of sides[i].slots) {
        if (!slot) continue;
        const item = giver.items.get(slot.itemId);
        const q = Math.floor(Number(slot.quantity));
        const stack = stackSize(item);
        const copy = item.toObject();
        delete copy._id;
        if (copy.system && "equipped" in copy.system) copy.system.equipped = false;
        if (q < stack) {
          copy.system.quantity = q;
          updates[i].push({ _id: item.id, "system.quantity": stack - q });
        } else {
          deletes[i].push(item.id);
        }
        creates[1 - i].push(copy);
        const name = escapeHtml(item.localizedName);
        lines.push(stack > 1 ? `${name} ×${q}` : name);
      }
      const money = Math.floor(Number(sides[i].money) || 0);
      if (money > 0) lines.push(escapeHtml(formatPrice(money)));
      summaries.push({ name: escapeHtml(giver.name), lines, money });
    }

    // Receivers first: a failure after this leaves a duplicate, never a loss.
    for (let i = 0; i < 2; i++) {
      if (creates[i].length) await actors[i].createEmbeddedDocuments("Item", creates[i]);
    }
    for (let i = 0; i < 2; i++) {
      if (updates[i].length) await actors[i].updateEmbeddedDocuments("Item", updates[i]);
      if (deletes[i].length) await actors[i].deleteEmbeddedDocuments("Item", deletes[i]);
    }
    for (let i = 0; i < 2; i++) {
      const amount = summaries[i].money;
      if (amount <= 0) continue;
      const paid = await chargeActor(actors[i], amount);
      if (!paid) throw new Error(`Trade ${data.tradeId}: ${actors[i].name} could not pay ${amount}`);
      await creditActor(actors[1 - i], amount);
    }

    const content = summaries
      .map(
        (s) =>
          `<p><strong>${L("ChatGave", { actor: s.name })}</strong> ${
            s.lines.length ? s.lines.join(", ") : L("Nothing")
          }</p>`,
      )
      .join("");
    const whisper = [
      ...new Set([
        ...userIds,
        ...game.users.contents.filter((u) => u.isGM).map((u) => u.id),
      ]),
    ];
    await ChatMessage.create({
      content,
      whisper,
      speaker: { alias: L("Title") },
    });

    reply(true);
  } catch (err) {
    console.error("REDSTEEL | Trade failed", err);
    // Writes may have partly happened, so this id is not offered again.
    reply(false, "Generic");
  }
}

/* -------------------------------------------------------------------------- */
/*  Window                                                                    */
/* -------------------------------------------------------------------------- */

class TradeWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: APP_ID,
    classes: ["redsteel", "rs-trade"],
    tag: "div",
    window: { title: "REDSTEEL.Trade.Title", icon: ICON, resizable: false },
    position: { width: 560, height: "auto" },
    actions: {
      accept: TradeWindow._onAccept,
      cancel: TradeWindow._onCancel,
      openPicker: TradeWindow._onOpenPicker,
      pickItem: TradeWindow._onPickItem,
    },
  };

  static PARTS = { body: { template: TEMPLATE } };

  /** The empty slot whose item picker is open, or null. */
  #pickerSlot = null;

  /** Delegated listeners sit on the window element, which outlives renders. */
  #listening = false;

  async _prepareContext() {
    const s = session;
    if (!s) return { ready: false };
    const actor = myActor();
    const waiting = isWaiting();

    const mineSlots = s.me.offer.slots.map((slot, index) => {
      const item = slot ? actor?.items.get(slot.itemId) : null;
      if (!item) return { index, filled: false };
      const max = stackSize(item);
      return {
        index,
        filled: true,
        name: item.localizedName,
        img: item.img,
        quantity: slot.quantity,
        max,
        stack: max > 1,
        unidentified: isItemUnidentified(item),
      };
    });

    const theirSlots = s.them.slots.map((slot, index) =>
      slot
        ? {
            index,
            filled: true,
            name: slot.name,
            img: slot.img,
            quantity: slot.quantity,
            stack: !!slot.stack,
            unidentified: !!slot.unidentified,
          }
        : { index, filled: false },
    );

    let choices = [];
    const pickerOpen = this.#pickerSlot !== null && !waiting && !!actor;
    if (pickerOpen) {
      const offered = new Set(s.me.offer.slots.filter(Boolean).map((x) => x.itemId));
      choices = actor.items.contents
        .filter((i) => !offered.has(i.id) && !offerProblem(actor, i))
        .map((i) => ({
          id: i.id,
          name: i.localizedName,
          img: i.img,
          quantity: stackSize(i),
          stack: stackSize(i) > 1,
          unidentified: isItemUnidentified(i),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    }

    return {
      ready: true,
      waiting,
      mine: {
        name: actor?.name ?? "",
        img: actor?.img ?? "",
        slots: mineSlots,
        coins: getRoster().map((d) => ({
          key: d.key,
          label: d.label,
          color: d.color,
          count: s.me.offer.coins[d.key] ?? 0,
        })),
        purse: L("Purse", { amount: formatPrice(purseTotal(actor)) }),
        accepted: s.me.accepted,
      },
      theirs: {
        name: s.them.name,
        img: s.them.img,
        slots: theirSlots,
        money: formatPrice(s.them.money),
        accepted: s.them.accepted,
      },
      picker: { open: pickerOpen, choices, hasChoices: choices.length > 0 },
      tradeLabel: s.me.accepted ? L("Unaccept") : L("Trade"),
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.#listening) return;
    this.#listening = true;
    const el = this.element;

    el.addEventListener("dragover", (event) => {
      if (event.target.closest?.(".rs-trade-side--mine") && !isWaiting()) event.preventDefault();
    });
    el.addEventListener("drop", (event) => this.#onDrop(event));

    el.addEventListener("contextmenu", (event) => {
      const slot = event.target.closest?.(".rs-trade-side--mine .rs-trade-slot.filled");
      if (!slot) return;
      event.preventDefault();
      event.stopPropagation();
      removeFromOffer(Number(slot.dataset.slot));
    });

    el.addEventListener("change", (event) => {
      const qty = event.target.closest?.(".rs-trade-qty");
      if (qty) {
        setQuantity(Number(qty.dataset.slot), qty.value);
        return;
      }
      if (event.target.closest?.(".rs-trade-coin")) {
        const counts = {};
        for (const input of el.querySelectorAll(".rs-trade-coin")) {
          counts[input.dataset.key] = input.value;
        }
        setCoins(counts);
      }
    });

    // The picker closes on any click outside it.
    el.addEventListener("pointerdown", (event) => {
      if (this.#pickerSlot === null) return;
      if (event.target.closest?.(".rs-trade-picker, [data-action='openPicker']")) return;
      this.#pickerSlot = null;
      this.render();
    });
  }

  async #onDrop(event) {
    if (!event.target.closest?.(".rs-trade-side--mine")) return;
    event.preventDefault();
    if (!session || isWaiting()) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const item = await fromUuid(data.uuid);
    const slotEl = event.target.closest(".rs-trade-slot[data-slot]");
    addToOffer(item, slotEl ? Number(slotEl.dataset.slot) : null);
  }

  _onClose(options) {
    super._onClose?.(options);
    // Closed by the player (Cancel, the X, Escape): tell the partner. A close
    // caused by endSession has already cleared tradeWindow.
    if (tradeWindow !== this) return;
    tradeWindow = null;
    if (!session) return;
    send(address(MSG.CANCEL, { reason: "cancel" }));
    session = null;
  }

  /** @this {TradeWindow} */
  static _onAccept() {
    if (!session || isWaiting()) return;
    if (session.me.accepted) {
      session.me.accepted = false;
      send(address(MSG.ACCEPT, { accepted: false }));
      this.render();
      return;
    }
    session.me.accepted = true;
    send(address(MSG.ACCEPT, { accepted: true, stateKey: stateKey() }));
    maybeExecute();
    this.render();
  }

  /** @this {TradeWindow} */
  static _onCancel() {
    this.close();
  }

  /** @this {TradeWindow} */
  static _onOpenPicker(event, target) {
    if (!session || isWaiting()) return;
    const index = Number(target.dataset.slot);
    this.#pickerSlot = this.#pickerSlot === index ? null : index;
    this.render();
  }

  /** @this {TradeWindow} */
  static _onPickItem(event, target) {
    const index = this.#pickerSlot;
    this.#pickerSlot = null;
    const item = myActor()?.items.get(target.dataset.itemId);
    if (!item || !addToOffer(item, index)) this.render();
  }
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                              */
/* -------------------------------------------------------------------------- */

export function registerTrade() {
  Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
      if (data?.toUserId !== game.user.id) return;
      if (typeof data.type !== "string" || !data.type.startsWith("trade")) return;
      onSocket(data);
    });
  });

  // Keep my side honest while the window is open.
  const onOwnItem = (item) => {
    if (session && item?.parent?.uuid === session.me.actorUuid) refreshMine();
  };
  Hooks.on("createItem", onOwnItem);
  Hooks.on("updateItem", onOwnItem);
  Hooks.on("deleteItem", onOwnItem);
  Hooks.on("updateActor", (actor, changes) => {
    if (!session || actor.uuid !== session.me.actorUuid) return;
    const has = foundry.utils.hasProperty;
    if (has(changes, "system.purse") || has(changes, "system.combat")) refreshMine();
  });

  Hooks.on("userConnected", (user, connected) => {
    if (connected || !session) return;
    if (user.id === session.partnerUserId) {
      ui.notifications.info(L("Cancelled", { name: session.them.name }));
      endSession();
      return;
    }
    // The GM left mid-trade: nobody will answer, so hand control back.
    if (user.isGM && isWaiting() && !game.users.activeGM) {
      session.me.accepted = false;
      session.them.accepted = false;
      session.executeSent = false;
      ui.notifications.warn(L("NoGM"));
      renderWindow();
    }
  });
}
