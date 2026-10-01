/**
 * Vytrvalý válečník (Enduring Warrior, Weapon Master).
 *
 * "On missing the target with an attack action, regains half the Stamina
 * spent." User ruling (2026-10-01): whether the blow missed is the player's
 * call, made on the attack card itself. A "Missed" button sits beside Apply
 * Damage and refunds half the Stamina the attack paid, with a public chat line
 * so the table sees it happen. The button goes grey for good once:
 *   - it was used (`flags.redsteel.enduringWarrior.used`),
 *   - damage was applied from this card (`flags.redsteel.damageApplied`,
 *     stamped by applyDamage.mjs), or
 *   - the attacker has attacked again since (a newer attack card by the same
 *     speaker; read off the chat log, nothing stored).
 * Using it during a multi-attack ends the chain: the Combat Abilities dialog
 * holding it is closed (`endMultiAttack` in combatAbilities.mjs).
 *
 * The Stamina an attack paid is not known where the card is written, only
 * where the cost is charged (deductAbilityCost). That call notes the amount
 * here, and the attacker's own next attack card picks it up as it is created
 * (`flags.redsteel.staminaSpent`). A multi-attack strike after the first pays
 * only its modifiers, so the chain notes the ability's own Stamina on every
 * strike: a miss on strike three refunds half the ability, as on strike one.
 */

import { hasWeaponMasterNode } from "./weaponMaster.mjs";

const SOCKET = "system.redsteel";
const END_CHAIN = "enduringWarriorEndChain";

/** How long a noted payment waits for its card, in ms. */
const PENDING_TTL = 120_000;

/** actor uuid → {amount, at}: Stamina charged, waiting for its attack card. */
const pending = new Map();

/** actor uuid → close(): the open multi-attack chain on this client. */
const openChains = new Map();

/**
 * Note the Stamina an attack just paid, for the card about to be posted.
 * Every charge overwrites the last, so a cancelled attack cannot leak its
 * payment onto a later card for long.
 *
 * @param {Actor} actor
 * @param {number} amount
 */
export function notePaidStamina(actor, amount) {
  if (!actor?.uuid) return;
  pending.set(actor.uuid, { amount: Math.max(0, Number(amount) || 0), at: Date.now() });
}

/** Register the dialog holding this actor's multi-attack chain. */
export function registerMultiAttackChain(actor, close) {
  if (actor?.uuid) openChains.set(actor.uuid, close);
}

/** The Stamina last noted for this actor and not yet taken by a card. */
export function peekPaidStamina(actor) {
  return pending.get(actor?.uuid)?.amount ?? 0;
}

/** Close this actor's multi-attack chain on this client, if one is open. */
function endChainHere(actorUuid) {
  const close = openChains.get(actorUuid);
  if (!close) return;
  openChains.delete(actorUuid);
  try {
    close();
  } catch (err) {
    console.warn("Redsteel | Could not end the multi-attack", err);
  }
}

/** The actor that posted an attack card. */
function attackerOf(message) {
  return ChatMessage.getSpeakerActor(message.speaker ?? {});
}

/** Same speaker: by token when the card names one, else by actor. */
function sameSpeaker(a, b) {
  if (a?.token || b?.token) return !!a?.token && a.token === b?.token;
  return !!a?.actor && a.actor === b?.actor;
}

/**
 * Has the attacker posted another attack since this card? The card's own
 * rerolls do not count: a reroll is the same attack thrown again.
 */
function attackedAgain(message) {
  const messages = game.messages?.contents ?? [];
  const index = messages.findIndex((m) => m.id === message.id);
  if (index < 0) return false;
  for (let i = index + 1; i < messages.length; i++) {
    const later = messages[i];
    if (later.flags?.attack?.type !== "attack") continue;
    if (!sameSpeaker(later.speaker, message.speaker)) continue;
    if (later.flags?.redsteel?.rerolledFrom === message.id) continue;
    return true;
  }
  return false;
}

/** Why the button is grey, or null while it may still be used. */
function blockedReason(message) {
  const flags = message.flags?.redsteel ?? {};
  if (flags.enduringWarrior?.used) return "used";
  if (flags.damageApplied) return "applied";
  if (attackedAgain(message)) return "again";
  return null;
}

/** Stamina the "Missed" button gives back for this card. */
function refundFor(message) {
  return Math.floor((Number(message.flags?.redsteel?.staminaSpent) || 0) / 2);
}

/** Grey out every live Enduring Warrior button rendered for this card. */
function greyOut(messageId) {
  for (const button of document.querySelectorAll(
    `.chat-message[data-message-id="${messageId}"] .rs-enduring-warrior-button`,
  )) {
    button.disabled = true;
  }
}

/**
 * Refund half the attack's Stamina, mark the card, say so in chat, and end a
 * running multi-attack.
 *
 * @param {ChatMessage} message  the attack card
 */
async function claimMiss(message) {
  const actor = attackerOf(message);
  if (!actor?.isOwner) return;
  if (!hasWeaponMasterNode(actor, "vytrvalyValecnik")) return;
  if (blockedReason(message)) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.EnduringWarrior.Blocked"));
    greyOut(message.id);
    return;
  }
  const refund = refundFor(message);
  if (refund <= 0) return;

  // Mark first: a double click must not refund twice.
  try {
    await message.setFlag("redsteel", "enduringWarrior", {
      used: true,
      refund,
    });
  } catch (err) {
    console.warn("Redsteel | Could not mark the Enduring Warrior claim", err);
    return;
  }

  const stamina = actor.system.stats?.stamina ?? {};
  const current = Number(stamina.value) || 0;
  const max = Number(stamina.max);
  const next =
    Number.isFinite(max) && max > 0 ? Math.min(max, current + refund) : current + refund;
  await actor.update({ "system.stats.stamina.value": next });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p class="rs-enduring-warrior-note"><i class="fa-light fa-heart-pulse"></i> ${game.i18n.format(
      "REDSTEEL.EnduringWarrior.Used",
      {
        name: foundry.utils.escapeHTML(actor.name),
        amount: next - current,
      },
    )}</p>`,
  });

  // A miss ends the multi-attack, wherever its dialog is open.
  endChainHere(actor.uuid);
  game.socket.emit(SOCKET, { type: END_CHAIN, actorUuid: actor.uuid });
}

/**
 * Wire it up. The button is added at `ready`, after the hook in redsteel.mjs
 * that builds the card's Apply Damage button, so it lands beside it.
 */
export function registerEnduringWarrior() {
  // The attacker's own next attack card takes the noted payment.
  Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
    if (userId !== game.user.id) return;
    if (message.flags?.attack?.type !== "attack") return;
    if (message.flags?.redsteel?.rerolledFrom) return;
    const actor = attackerOf(message);
    const noted = actor ? pending.get(actor.uuid) : null;
    if (!noted) return;
    pending.delete(actor.uuid);
    // A spell is not an attack action and never paid through
    // deductAbilityCost, so whatever is noted belongs to something else.
    if (message.flags.attack.isSpell) return;
    if (Date.now() - noted.at > PENDING_TTL || noted.amount <= 0) return;
    message.updateSource({ "flags.redsteel.staminaSpent": noted.amount });
  });

  // A new attack by the same speaker greys out the older cards' buttons,
  // which are already rendered and would not redraw on their own.
  Hooks.on("createChatMessage", (message) => {
    if (message.flags?.attack?.type !== "attack") return;
    if (message.flags?.redsteel?.rerolledFrom) return;
    for (const button of document.querySelectorAll(".rs-enduring-warrior-button")) {
      const id = button.dataset.messageId;
      const older = id ? game.messages.get(id) : null;
      if (older && older.id !== message.id && sameSpeaker(older.speaker, message.speaker)) {
        button.disabled = true;
      }
    }
  });

  Hooks.once("ready", () => {
    game.socket.on(SOCKET, (data) => {
      if (data?.type === END_CHAIN) endChainHere(data.actorUuid);
    });

    Hooks.on("renderChatMessageHTML", (message, html) => {
      if (message.flags?.attack?.type !== "attack") return;
      if (message.flags?.redsteel?.rerolledAway) return;
      if (refundFor(message) <= 0) return;
      // Same audience as the card's own Apply Damage button: whoever posted
      // it, plus the GM.
      if (!game.user.isGM && message.author?.id !== game.user.id) return;
      const actor = attackerOf(message);
      if (!hasWeaponMasterNode(actor, "vytrvalyValecnik")) return;
      if (html.querySelector(".rs-enduring-warrior-button")) return;

      let container = html.querySelector(".button-container");
      if (!container) {
        container = document.createElement("div");
        container.className = "button-container";
        html.querySelector(".message-content")?.appendChild(container);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rs-enduring-warrior-button";
      button.dataset.messageId = message.id;
      button.textContent = game.i18n.format("REDSTEEL.EnduringWarrior.Button", {
        amount: refundFor(message),
      });
      button.dataset.tooltip = game.i18n.localize("REDSTEEL.EnduringWarrior.Tooltip");
      button.disabled = !!blockedReason(message);
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        button.disabled = true;
        await claimMiss(message);
      });
      container.appendChild(button);
      container.classList.toggle(
        "single",
        container.querySelectorAll("button, a.button").length <= 1,
      );
    });
  });
}
