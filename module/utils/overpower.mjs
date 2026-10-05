/**
 * Přesílení (Overpower, Weapon Master).
 *
 * "May reroll a Hit, Defense or Ranged Defense roll if the difference in
 * margin of success was 10 or less." Free action, 1 Stamina.
 *
 * User rulings (2026-10-01):
 *   - Offered on the hotbar, never asked about: the side that LOST a combat
 *     contest by 10 or less sees the chip, for the turn the contest happened.
 *   - Once per contest per side, and it works like any other reroll: the die
 *     is thrown again and the contest is restated against the new one.
 *
 * The contest is the defense card: it holds both margins (`versus`). A tie
 * goes to the attacker, so the defender lost when `gap <= 0` and the attacker
 * lost when `gap > 0`. A verdict settled by a natural critical, or on the raw
 * dice, is not a margin difference at all and is never offered.
 *
 * Defender: the ordinary chat reroll of the defense card (executeReroll in
 * redsteel.mjs), which already contests the same attack again.
 *
 * Attacker: the attack card is rerolled the same way, then the defense card is
 * restated in place against the new attack: its versus block, the attack
 * packet it answers (so Apply Damage finds it from the new attack card) and
 * every claim that hangs off whether the guard held. The defense card belongs
 * to the defender's user, so when the attacker cannot write it the restating
 * is relayed to the GM over the system socket.
 *
 * "Once" is stamped on the contest itself: `flags.redsteel.overpowerUsedBy`
 * on the defense card lists the token ids that spent it. A defender reroll
 * carries the list onto the new card; an attacker restating writes it in the
 * same update.
 */

import {
  badDodgeMargin,
  buildAttackPacket,
  isBadDodge,
  renderVersusBlock,
} from "./defense.mjs";

/** localizationKey of the Overpower ability (the item kept its old key). */
export const OVERPOWER_KEY = "REDSTEEL.Items.Overpowering.name";

/** Largest margin difference Overpower may answer. */
export const OVERPOWER_MAX_GAP = 10;

const SOCKET = "system.redsteel";
const SOCKET_TYPE = "overpowerRestate";

/** The live card a rerolled-away card was replaced by, followed to the end. */
function liveCard(message) {
  let current = message;
  for (let i = 0; i < 20 && current; i++) {
    const next = current.getFlag?.("redsteel", "rerolledAway");
    if (!next) return current;
    if (next === true) return null;
    current = game.messages.get(next) ?? null;
  }
  return null;
}

/**
 * The side of this contest that may Overpower, or null.
 *
 * @param {object} versus  `flags.redsteel.versus` of a defense card.
 * @returns {"attacker"|"defender"|null}
 */
export function overpowerSide(versus) {
  if (!versus || versus.critical || versus.onDice) return null;
  const gap = Number(versus.gap);
  if (!Number.isFinite(gap) || Math.abs(gap) > OVERPOWER_MAX_GAP) return null;
  return versus.blocked ? "attacker" : "defender";
}

/**
 * The newest live defense card of the current turn in which one of these
 * tokens is on the losing side by 10 or less and has not Overpowered yet.
 *
 * @param {Set<string>} tokenIds  the actor's tokens
 * @param {Combat} combat
 * @returns {{message: ChatMessage, side: "attacker"|"defender",
 *   tokenId: string, gap: number}|null}
 */
export function findOverpowerContest(tokenIds, combat) {
  if (!combat || !tokenIds.size) return null;
  const messages = game.messages?.contents ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const flags = message.flags?.redsteel ?? {};
    const defense = flags.defense;
    if (!defense || !flags.versus) continue;

    const stamp = defense.combat;
    // Older turns are closed; the walk can stop at the first one.
    if (
      !stamp ||
      stamp.id !== combat.id ||
      Number(stamp.round) !== Number(combat.round) ||
      Number(stamp.turn) !== Number(combat.turn)
    ) {
      return null;
    }
    if (flags.rerolledAway) continue;

    const isDefender = tokenIds.has(defense.defenderTokenId);
    const isAttacker = tokenIds.has(defense.attackerTokenId);
    if (!isDefender && !isAttacker) continue;
    // A card without a die (the undefendable blow from behind) has nothing to
    // reroll on the defender's side and is a natural critical anyway.
    if (!message.rolls?.length) continue;

    const side = overpowerSide(flags.versus);
    const mine =
      (side === "defender" && isDefender) || (side === "attacker" && isAttacker);
    if (!mine) continue;
    const tokenId =
      side === "defender" ? defense.defenderTokenId : defense.attackerTokenId;
    const used = Array.isArray(flags.overpowerUsedBy) ? flags.overpowerUsedBy : [];
    if (used.includes(tokenId)) continue;
    if (side === "attacker" && !attackCardFor(message)) continue;

    return { message, side, tokenId, gap: Math.abs(Number(flags.versus.gap)) };
  }
  return null;
}

/** The live attack card a defense card answered, or null. */
function attackCardFor(defenseMessage) {
  const id = defenseMessage.flags?.redsteel?.versusAttack?.messageId;
  const attack = id ? game.messages.get(id) : null;
  return attack ? liveCard(attack) : null;
}

/* -------------------------------------------- */
/*  Using it                                    */
/* -------------------------------------------- */

/**
 * Spend Overpower on the contest in this defense card.
 *
 * @param {Actor} actor  the overpowering actor
 * @param {string} defenseMessageId
 * @returns {Promise<boolean>}
 */
export async function useOverpower(actor, defenseMessageId) {
  const tokenIds = new Set(
    actor.isToken
      ? [actor.token?.id].filter(Boolean)
      : actor.getActiveTokens(false, true).map((t) => t.id),
  );
  const found = findOverpowerContest(tokenIds, game.combat);
  if (!found || found.message.id !== defenseMessageId) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.WeaponMaster.OverpowerNoCard"));
    return false;
  }

  const ability = actor.items.find(
    (i) => i.type === "ability" && i.system?.localizationKey === OVERPOWER_KEY,
  );
  if (!ability) return false;

  // The attacker's path needs somebody able to rewrite the defense card. Say
  // so before the Stamina is spent rather than after.
  const defenseCard = found.message;
  if (
    found.side === "attacker" &&
    !canWrite(defenseCard) &&
    !game.users.activeGM
  ) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.WeaponMaster.OverpowerNoGM"));
    return false;
  }

  const paid = await game.redsteel.deductAbilityCost(actor, [ability]);
  if (!paid) return false;

  const source = game.i18n.localize("REDSTEEL.WeaponMaster.OverpowerSource");
  const used = [
    ...(Array.isArray(defenseCard.flags.redsteel.overpowerUsedBy)
      ? defenseCard.flags.redsteel.overpowerUsedBy
      : []),
    found.tokenId,
  ];

  if (found.side === "defender") {
    await game.redsteel.executeReroll(defenseCard, source, {
      extraFlags: { overpowerUsedBy: used },
    });
    return true;
  }

  const attackCard = attackCardFor(defenseCard);
  if (!attackCard) return false;
  const created = await game.redsteel.executeReroll(attackCard, source);
  if (!created) return false;

  const payload = {
    type: SOCKET_TYPE,
    defenseMessageId: defenseCard.id,
    attackMessageId: created.id,
    usedBy: used,
    actorName: actor.name,
  };
  if (canWrite(defenseCard)) await restateDefense(payload);
  else game.socket.emit(SOCKET, payload);
  return true;
}

/** May this client update this chat message? */
function canWrite(message) {
  return game.user.isGM || message.isAuthor || message.author?.id === game.user.id;
}

/**
 * Restate a defense card against a rerolled attack card, in place. The
 * defense die stands; only the contest is worked out again, the same way the
 * defense card and a defense reroll work it out.
 *
 * @param {{defenseMessageId: string, attackMessageId: string,
 *   usedBy: string[], actorName: string}} data
 */
export async function restateDefense(data) {
  const defenseCard = game.messages.get(data.defenseMessageId);
  const attackCard = game.messages.get(data.attackMessageId);
  if (!defenseCard || !attackCard || !canWrite(defenseCard)) return;

  const flags = defenseCard.flags.redsteel ?? {};
  const roll = defenseCard.rolls?.[0];
  if (!roll) return;
  const d100 = roll.dice?.[0]?.total ?? null;
  const critSuccess =
    d100 != null && d100 <= Number(flags.criticalSuccessThreshold);
  const critFailure =
    d100 != null && d100 >= Number(flags.criticalFailureThreshold);

  const defender = ChatMessage.getSpeakerActor(defenseCard.speaker ?? {});
  const tokens = Array.isArray(flags.rerollTokens) ? flags.rerollTokens : [];
  const badDodge = tokens.includes("dodge") && isBadDodge(defender, d100);
  const contestedTotal = badDodgeMargin(roll.total, badDodge);

  const packet = buildAttackPacket(attackCard);
  const versus = renderVersusBlock(packet, {
    defenseTotal: contestedTotal,
    defenseD100: d100,
    defenseCrit: critSuccess,
    defenseCritFailure: critFailure,
    dodge: tokens.includes("dodge"),
  });
  if (!versus.versus) return;
  const defenseFailed = !versus.versus.blocked;

  // Swap the versus block in the flavor for the restated one, plus a line
  // saying why the card changed under everyone's eyes.
  const template = document.createElement("template");
  template.innerHTML = defenseCard.flavor ?? "";
  const note = `<p class="rs-overpower-note" style="text-align:center; font-size:12px; opacity:0.8;"><i class="fa-light fa-rotate"></i> ${foundry.utils.escapeHTML(
    game.i18n.format("REDSTEEL.WeaponMaster.OverpowerRestated", {
      name: data.actorName ?? "",
    }),
  )}</p>`;
  const old = template.content.querySelector(".rs-versus");
  template.content.querySelector(".rs-overpower-note")?.remove();
  if (old) old.outerHTML = `${versus.html}${note}`;
  else template.innerHTML += `${versus.html}${note}`;

  const update = {
    flavor: template.innerHTML,
    "flags.redsteel.versusAttack": packet,
    "flags.redsteel.versus": versus.versus,
    "flags.redsteel.overpowerUsedBy": data.usedBy ?? [],
  };
  if (flags.defense) update["flags.redsteel.defense.succeeded"] = !defenseFailed;
  if (flags.tempHealthGrant) {
    update["flags.redsteel.tempHealthGrant.defenseFailed"] = defenseFailed;
    update["flags.redsteel.tempHealthGrant.criticalDefense"] =
      versus.versus.critical === "defense";
  }
  if (flags.advantageousManeuver) {
    update["flags.redsteel.advantageousManeuver.defenseFailed"] = defenseFailed;
  }
  await defenseCard.update(update);
}

/** The GM end of the attacker's restating. Registered once at ready. */
export function registerOverpowerHooks() {
  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
      if (data?.type !== SOCKET_TYPE) return;
      if (!game.users.activeGM?.isSelf) return;
      await restateDefense(data);
    });
  });
}
