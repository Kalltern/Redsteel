/**
 * Ochrana (Protection). Rulebook, ruzne-info.md r212 (Bojové akce): "Ochrana ·
 * Reakce · 6 výdrže · Garantovaná reakce. Na jedno kolo může přidat vlastní
 * hod na Obranu či Kryt s postihem -10% na sousedícího spojence nebo proti
 * střelbě, která protíná sousedící hexy. Použití zruší Obranný postoj. Efekty
 * rušící Míření a Postoje chráněnému nebo ochránci zruší Ochranu. Pokud by měl
 * ochránce přijít o více Reakcí, než kolik jich právě má, je Ochrana zrušena."
 *
 * The pack already ships this action as "Guard (Stance)" (cs "Ochrana", key
 * `guard`, Shieldbearer 2, Reaction, 6 Stamina) with the `guard` status
 * (helpers/config.mjs: one turn on the effect clock, and taking it deletes
 * `defensive_stance` through EFFECT_OVERRIDES in documents/effects.mjs). This
 * file automates it on top of that item and status rather than adding a
 * second Protection ability.
 *
 * The flow (Warden batch 1, 2026-10-19):
 *
 * 1. Use. The Combat Abilities flow (combatAbilities.mjs, the stance branch)
 *    asks pickProtectedAlly BEFORE anything is paid: a targeted adjacent ally,
 *    else the only adjacent ally, else a pick dialog. Closing the dialog
 *    cancels the use. With no adjacent ally (or "No ally" picked) Guard is
 *    taken exactly as before, a plain status for the table to resolve.
 * 2. After the `guard` effect exists, startProtection writes
 *    `flags.redsteel.protection = {allyTokenId, protectorTokenId, sceneId}` on
 *    it (the protector's own effect, written by its owner) and asks the active
 *    GM (socket `wardenProtection`, or directly when this client may write
 *    the ally) to put the `protected_by` marker on the ally, whose
 *    `flags.redsteel.protection = {protectors: [tokenId...], allyTokenId,
 *    sceneId}` names who protects it. The marker has no clock of its own.
 * 3. Defending. Every attack card that names the ally as a target and was
 *    posted after the protector's `guard` effect was created gets a
 *    "Protect <ally>" button, shown to the protector's owners and the GM. A
 *    click re-checks that the `guard` effect still points at that ally, that
 *    the two tokens are still adjacent, and that this protector has not
 *    already answered this card for this ally, then rolls the protector's own
 *    Defense (melee blow) or Cover (ranged, thrown) at PROTECTION_PENALTY
 *    through defense.mjs defenseRoll. The defense card's defender is the
 *    protector; `flags.redsteel.defense.protectedTokenId` names the ally, and
 *    Apply Damage's findAnsweringDefense (applyDamage.mjs) reads it as the
 *    answer for the ally. The ally may still roll its own defense: the newest
 *    answering card is the one Apply Damage reads.
 * 4. End. `guard` ends on the effect clock at the protector's next turn start
 *    (defaultTurns 1), when the protector uses Guard again (the stance
 *    toggle), or when anyone deletes it. The active GM's deleteActiveEffect
 *    hook then takes the protector off the ally's marker (deleting it when no
 *    protector is left). Deleting the marker by hand deletes the matching
 *    `guard` effects in turn. Both directions pass
 *    `redsteelProtectionCleanup` so they do not bounce.
 *
 * Not automated (left to the table): "proti střelbě, která protíná sousedící
 * hexy" (there is no shot-line helper; only the adjacent-ally case is built),
 * "Efekty rušící Míření a Postoje" (the system has no notion of an effect that
 * cancels Aim or Stances), and the Reaction-overdraw cancel (the action
 * tracker clamps spent Reactions to the pool, so an overdraw cannot be seen).
 */

import { areAdjacent } from "./positioning.mjs";
import { isHostileSide } from "./movementZones.mjs";
import { attackerTokenIdFromMessage } from "./overwhelm.mjs";
import { buildAttackPacket } from "./defense.mjs";

const SYSTEM_ID = "redsteel";
const SOCKET = "system.redsteel";
const SOCKET_TYPE = "wardenProtection";
const FLAG = "protection";
const CLEANUP_OPTION = "redsteelProtectionCleanup";

/** The protector's status: the existing Guard (Ochrana) stance. */
export const PROTECTION_STATUS = "guard";
/** The marker on the protected ally. */
export const PROTECTED_STATUS = "protected_by";
/** "s postihem -10%". */
export const PROTECTION_PENALTY = -10;

const GUARD_KEY = "REDSTEEL.Items.GuardStance.name";

/** A creature in one of these is not protected (and protects nobody). */
const FALLEN_STATUSES = ["dead", "dying", "downed", "unconscious"];

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const docOf = (token) => token?.document ?? token ?? null;

/** Is this the Protection (Guard) ability, by key or localisation key? */
export function isProtectionAbility(ability) {
  return (
    ability?.system?.key === PROTECTION_STATUS ||
    ability?.system?.localizationKey === GUARD_KEY
  );
}

/** A living token on the protector's side standing next to it. */
export function adjacentAllies(token) {
  const doc = docOf(token);
  const scene = doc?.parent;
  if (!doc || !scene) return [];
  const side = isHostileSide(doc);
  return scene.tokens.contents.filter((other) => {
    if (other.id === doc.id || !other.actor) return false;
    if (other.hidden && !game.user.isGM) return false;
    if (isHostileSide(other) !== side) return false;
    if (FALLEN_STATUSES.some((s) => other.actor.statuses?.has(s))) return false;
    return areAdjacent(doc, other);
  });
}

/**
 * Which ally this use of Protection covers. Asked before the ability is paid.
 *
 * @param {Token|TokenDocument|null} token  the protector
 * @returns {Promise<{ally: TokenDocument|null}|null>} null = the player
 *   closed the pick, cancel the use; `ally: null` = take Guard without an
 *   automated ally.
 */
export async function pickProtectedAlly(token) {
  const allies = adjacentAllies(token);
  if (!allies.length) {
    ui.notifications.info(game.i18n.localize("REDSTEEL.Warden.ProtectionNoAlly"));
    return { ally: null };
  }
  const targeted = [...(game.user?.targets ?? [])]
    .map((t) => docOf(t))
    .filter((d) => allies.some((a) => a.id === d?.id));
  if (targeted.length === 1) return { ally: targeted[0] };
  if (allies.length === 1) return { ally: allies[0] };

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize("REDSTEEL.Items.GuardStance.name") },
    content: `<p>${game.i18n.localize("REDSTEEL.Warden.ProtectionPick")}</p>`,
    buttons: [
      ...allies.map((ally, index) => ({
        action: ally.id,
        label: esc(ally.name),
        default: index === 0,
      })),
      {
        action: "none",
        label: game.i18n.localize("REDSTEEL.Warden.ProtectionPickNone"),
      },
    ],
    rejectClose: false,
  });
  if (!picked) return null;
  if (picked === "none") return { ally: null };
  return { ally: allies.find((a) => a.id === picked) ?? null };
}

/**
 * Link a freshly taken Guard to its ally: stamp the protector's effect, mark
 * the ally, post one line.
 *
 * @param {Actor} actor             the protector
 * @param {Token|TokenDocument} token
 * @param {ActiveEffect} effect     the `guard` effect just applied
 * @param {TokenDocument} ally
 */
export async function startProtection(actor, token, effect, ally) {
  const protector = docOf(token);
  const scene = ally?.parent;
  if (!effect || !protector || !ally || !scene) return;
  const payload = {
    allyTokenId: ally.id,
    protectorTokenId: protector.id,
    sceneId: scene.id,
  };
  await effect.setFlag(SYSTEM_ID, FLAG, payload);
  await relay({ action: "mark", ...payload });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: protector }),
    content: `<div style="text-align:center;">${game.i18n.format(
      "REDSTEEL.Warden.ProtectionStarted",
      { name: esc(protector.name), ally: esc(ally.name) },
    )}</div>`,
  });
}

/* -------------------------------------------- */
/*  GM writes                                   */
/* -------------------------------------------- */

/** Run a marker write here when allowed, else hand it to the active GM. */
async function relay(payload) {
  const ally = game.scenes?.get(payload.sceneId)?.tokens?.get(payload.allyTokenId);
  if (game.users.activeGM?.isSelf || ally?.actor?.isOwner) {
    return runRelay(payload);
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Warden.ProtectionNoGM"));
    return;
  }
  game.socket.emit(SOCKET, { type: SOCKET_TYPE, ...payload });
}

async function runRelay(payload) {
  if (payload.action === "mark") return markAlly(payload);
  if (payload.action === "unmark") return unmarkAlly(payload);
}

function markerOf(actor) {
  return (
    actor?.effects?.contents?.find((e) => e.statuses?.has(PROTECTED_STATUS)) ??
    null
  );
}

async function markAlly({ sceneId, allyTokenId, protectorTokenId }) {
  const ally = game.scenes?.get(sceneId)?.tokens?.get(allyTokenId);
  const actor = ally?.actor;
  if (!actor) return;
  let marker = markerOf(actor);
  if (!marker) marker = await game.redsteel.applyEffect(actor, PROTECTED_STATUS);
  if (!marker) return;
  const protectors = new Set(marker.getFlag(SYSTEM_ID, FLAG)?.protectors ?? []);
  protectors.add(protectorTokenId);
  await marker.setFlag(SYSTEM_ID, FLAG, {
    protectors: [...protectors],
    allyTokenId,
    sceneId,
  });
}

async function unmarkAlly({ sceneId, allyTokenId, protectorTokenId }) {
  const ally = game.scenes?.get(sceneId)?.tokens?.get(allyTokenId);
  const marker = markerOf(ally?.actor);
  if (!marker) return;
  const protectors = (marker.getFlag(SYSTEM_ID, FLAG)?.protectors ?? []).filter(
    (id) => id !== protectorTokenId,
  );
  if (!protectors.length) {
    await marker.delete({ [CLEANUP_OPTION]: true });
    return;
  }
  await marker.setFlag(SYSTEM_ID, FLAG, { protectors });
}

/** The marker was removed by hand: end every Guard that pointed at the ally. */
async function endGuardsFor(marker) {
  const data = marker.getFlag(SYSTEM_ID, FLAG) ?? {};
  const scene = game.scenes?.get(data.sceneId);
  if (!scene) return;
  for (const protectorId of data.protectors ?? []) {
    const effect = guardFor(scene.tokens.get(protectorId), data.allyTokenId);
    if (effect) await effect.delete({ [CLEANUP_OPTION]: true });
  }
}

/* -------------------------------------------- */
/*  Reads                                       */
/* -------------------------------------------- */

/** The protector's `guard` effect when it protects this ally, or null. */
function guardFor(protectorDoc, allyTokenId) {
  const actor = protectorDoc?.actor;
  if (!actor || !allyTokenId) return null;
  return (
    actor.effects.contents.find(
      (e) =>
        e.statuses?.has(PROTECTION_STATUS) &&
        e.getFlag(SYSTEM_ID, FLAG)?.allyTokenId === allyTokenId,
    ) ?? null
  );
}

/** Tokens on this scene whose Guard protects the ally, with that effect. */
function protectorsOf(scene, allyTokenId) {
  const found = [];
  for (const doc of scene?.tokens?.contents ?? []) {
    const effect = guardFor(doc, allyTokenId);
    if (effect) found.push({ doc, effect });
  }
  return found;
}

/** Has this protector already answered this attack card for this ally? */
function alreadyAnswered(attackMessageId, protectorId, allyId) {
  return (game.messages?.contents ?? []).some((m) => {
    const flags = m.flags?.[SYSTEM_ID];
    if (!flags?.defense || flags.rerolledAway) return false;
    return (
      flags.versusAttack?.messageId === attackMessageId &&
      flags.defense.defenderTokenId === protectorId &&
      flags.defense.protectedTokenId === allyId
    );
  });
}

/* -------------------------------------------- */
/*  Attack card button                          */
/* -------------------------------------------- */

function renderProtectButtons(message, html) {
  const attack = message.flags?.attack;
  if (attack?.type !== "attack" || attack.contested || attack.isSpell) return;
  if (message.flags?.[SYSTEM_ID]?.rerolledAway) return;
  const targets = Array.isArray(attack.targets) ? attack.targets : [];
  if (!targets.length) return;
  const scene = game.scenes?.get(message.speaker?.scene) ?? canvas?.scene;
  if (!scene) return;
  const attackerTokenId = attackerTokenIdFromMessage(message);

  const offers = [];
  for (const allyId of targets) {
    const ally = scene.tokens.get(allyId);
    if (!ally) continue;
    for (const { doc, effect } of protectorsOf(scene, allyId)) {
      if (doc.id === attackerTokenId) continue;
      if (!game.user.isGM && !doc.isOwner) continue;
      // Only blows thrown while this Guard stood: older cards in the log stay
      // as they were.
      // Both stamps are the server's, so client clocks cannot skew this.
      const since = Number(effect._stats?.createdTime) || 0;
      const posted =
        Number(message._stats?.createdTime) || Number(message.timestamp) || 0;
      if (since && posted && posted < since) continue;
      offers.push({ protector: doc, ally });
    }
  }
  if (!offers.length) return;

  let container = html.querySelector(".button-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "button-container";
    html.querySelector(".message-content")?.appendChild(container);
  }
  if (!container) return;

  for (const { protector, ally } of offers) {
    const selector = `.rs-protect-button[data-protector-id="${protector.id}"][data-ally-id="${ally.id}"]`;
    if (container.querySelector(selector)) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rs-protect-button";
    button.dataset.protectorId = protector.id;
    button.dataset.allyId = ally.id;
    button.innerHTML = `<i class="fa-light fa-shield-halved"></i><span>${game.i18n.format(
      "REDSTEEL.Warden.ProtectButton",
      { ally: esc(ally.name) },
    )}</span>`;
    button.dataset.tooltip = game.i18n.format("REDSTEEL.Warden.ProtectTooltip", {
      name: esc(protector.name),
      ally: esc(ally.name),
      penalty: PROTECTION_PENALTY,
    });
    button.addEventListener("click", (event) => {
      event.preventDefault();
      protectFromCard(message, protector.id, ally.id).catch((err) =>
        console.error("Redsteel | Protection defense failed", err),
      );
    });
    container.appendChild(button);
  }
}

/**
 * The protector answers the attack card for the ally: its own Defense (melee)
 * or Cover (ranged, thrown) at -10.
 */
async function protectFromCard(message, protectorId, allyId) {
  const scene = game.scenes?.get(message.speaker?.scene) ?? canvas?.scene;
  const protector = scene?.tokens?.get(protectorId);
  const ally = scene?.tokens?.get(allyId);
  if (!protector?.actor || !ally) return;

  if (!guardFor(protector, allyId)) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Warden.ProtectionEnded"));
    return;
  }
  if (!areAdjacent(protector, ally)) {
    ui.notifications.warn(
      game.i18n.format("REDSTEEL.Warden.ProtectionNotAdjacent", {
        name: protector.name,
        ally: ally.name,
      }),
    );
    return;
  }
  if (alreadyAnswered(message.id, protectorId, allyId)) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Warden.ProtectionAnswered"));
    return;
  }

  const attackType = message.flags?.attack?.attackType;
  const ranged = ["ranged", "throwing", "magic"].includes(attackType);
  const ability = {
    system: ranged
      ? { rangedDefense: PROTECTION_PENALTY }
      : { defense: PROTECTION_PENALTY },
  };
  await game.redsteel.defenseRoll({
    actor: protector.actor,
    token: protector,
    ability,
    attackerTokenId: attackerTokenIdFromMessage(message),
    attack: buildAttackPacket(message),
    protectedTokenId: allyId,
  });
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerProtectionHooks() {
  // Every client sees the deletion; the active GM does the cleanup once.
  Hooks.on("deleteActiveEffect", (effect, options) => {
    if (!game.users.activeGM?.isSelf) return;
    if (options?.[CLEANUP_OPTION]) return;
    const data = effect.getFlag?.(SYSTEM_ID, FLAG);
    if (!data) return;
    if (effect.statuses?.has(PROTECTION_STATUS) && data.allyTokenId) {
      unmarkAlly(data).catch((err) =>
        console.error("Redsteel | Protection marker cleanup failed", err),
      );
    } else if (effect.statuses?.has(PROTECTED_STATUS)) {
      endGuardsFor(effect).catch((err) =>
        console.error("Redsteel | Protection cleanup failed", err),
      );
    }
  });

  // Rendered at ready, after the hooks that build the card's Apply Damage and
  // Defend buttons, so the Protect button lands beside them.
  Hooks.once("ready", () => {
    Hooks.on("renderChatMessageHTML", (message, html) => {
      renderProtectButtons(message, html);
    });
    game.socket.on(SOCKET, (data) => {
      if (data?.type !== SOCKET_TYPE) return;
      if (!game.users.activeGM?.isSelf) return;
      runRelay(data).catch((err) =>
        console.error("Redsteel | Protection relay failed", err),
      );
    });
  });
}
