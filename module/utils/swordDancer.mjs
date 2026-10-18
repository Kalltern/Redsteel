/**
 * Sword Dancer (Mečový tanečník): the pieces that live outside the Aim engine.
 * The Aim-side rules (Final Strike's price, Defense Reinforcement, Respite,
 * Perfect Opening's miss grant) are in aim.mjs.
 *
 * - Duelist's Advance (Duelistův krok, and its Improved form): "Umožní pohyb
 *   o Rychlost/2 hex a následně získá jedno Míření na oponenta v dosahu ...
 *   Pokud má na cíli tři Míření, může ihned zaútočit jako Volnou akci." The
 *   move is declared by abilityMovement.mjs; the strip's ✓ ends it, and that
 *   is when the Aim lands (completeDuelistsAdvance). With three stacks on the
 *   opponent, the next plain Attack this round is free (actionTracker.mjs
 *   grantFreeAttack). The Improved form also exempts the opponent from the
 *   threat rules for the move: `exempt` on the lock.
 * - Final Strike (Poslední výpad): "Při zabití oponenta získává zpět jednu
 *   Akci." Apply Damage hands the Action back (settleFinalStrikeKill). A kill
 *   is the victim ending the apply dead, or newly Downed or Unconscious (a
 *   PC at 0 HP; user ruling 2026-10-14). The hit's two Aim then go where the player picks.
 */

import { getSpent, grantFreeAttack, setSpent, trackedCombat } from "./actionTracker.mjs";
import { FINAL_STRIKE_KEY, getHeldAim, grantAimStacks } from "./aim.mjs";
import { aimCandidates, pickAimTarget } from "./halfPirouette.mjs";
import { isHostileSide, tokenForActor } from "./movementZones.mjs";

const SYSTEM_ID = "redsteel";
/** Aim on the opponent that makes the follow-up Attack free. */
const FREE_ATTACK_AIM = 3;

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * The opponent an Improved Duelist's Advance moves toward or around without
 * provoking it: the one targeted token, else whoever the aim points at.
 * Null with neither.
 *
 * @param {Token} token  the duellist
 * @returns {string|null}
 */
export function duelistsAdvanceOpponent(token) {
  const targets = [...(game.user?.targets ?? [])].filter((t) => t !== token);
  if (targets.length === 1) return targets[0].id;
  return getHeldAim(token).targetId;
}

/**
 * The Duelist's Advance move is done (the strip's ✓): one Aim on an opponent
 * in reach, and with three Aim on them the next plain Attack is free.
 *
 * @param {Actor} actor
 */
export async function completeDuelistsAdvance(actor) {
  const token = tokenForActor(actor);
  if (!token) return;
  const label = game.i18n.localize("REDSTEEL.Items.DuelistsAdvance.name");
  const target = await pickAimTarget(
    aimCandidates(actor, token, token.center),
    label,
  );

  const lines = [];
  if (target) {
    const { after } = await grantAimStacks(token, target, 1);
    lines.push(
      game.i18n.format("REDSTEEL.HalfPirouette.Aim", {
        name: esc(actor.name),
        stacks: 1,
        target: esc(target.name),
        after,
      }),
    );
    if (after >= FREE_ATTACK_AIM) {
      await grantFreeAttack(actor, target.id);
      lines.push(
        game.i18n.format("REDSTEEL.SwordDancer.FreeAttack", {
          name: esc(actor.name),
          target: esc(target.name),
        }),
      );
    }
  } else {
    lines.push(game.i18n.localize("REDSTEEL.HalfPirouette.NoAimTarget"));
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token.document }),
    flavor: `<p class="rs-card-headline"><b>${esc(label)}</b></p>
${lines.map((l) => `<p style="text-align:center;">${l}</p>`).join("")}`,
  });
}

/** Was this attack card a Final Strike? */
function cardIsFinalStrike(message) {
  const flags = message?.flags?.redsteel ?? {};
  return (
    flags.abilityKey === FINAL_STRIKE_KEY ||
    flags.abilityName === "Final Strike" ||
    flags.abilityName === "Final Thrust"
  );
}

/**
 * Apply Damage felled someone with a Final Strike: killed, or newly Downed or
 * Unconscious (user ruling 2026-10-14). One Action back, once per card. The
 * two Aim the hit earns are not put on the fallen body (aim.mjs holds them
 * back as `owed`): the attacker's owner places them from a button on the card
 * posted here (user ruling 2026-10-14). Runs on the GM applying the damage.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message   the attack card
 * @param {string[]} felledIds    token ids killed or downed by this apply
 * @param {number} owed           Aim held back for the player to place
 */
export async function settleFinalStrikeKill(
  attacker,
  message,
  felledIds = [],
  owed = 0,
) {
  if (!attacker || !cardIsFinalStrike(message)) return;
  const selfId = message.speaker?.token ?? null;
  if (!felledIds.some((id) => id && id !== selfId)) return;

  if (!message.getFlag(SYSTEM_ID, "finalStrikeRefunded") && trackedCombat(attacker)) {
    await message.setFlag(SYSTEM_ID, "finalStrikeRefunded", true);
    const spent = getSpent(attacker).actions;
    await setSpent(attacker, "actions", Math.max(0, spent - 1));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div style="text-align:center;">${game.i18n.format(
        "REDSTEEL.SwordDancer.FinalStrikeRefund",
        { name: esc(attacker.name) },
      )}</div>`,
    });
  }

  if (!(owed > 0)) return;
  // The claim lives on the attacker, which its owner can write; the card
  // only shows the button (the GM authored it, so a player could not flag it).
  // The claim is written first, under the card's id chosen in advance, so the
  // button sees it live the moment the card renders.
  const messageId = foundry.utils.randomID();
  await attacker.setFlag(SYSTEM_ID, AIM_CLAIM_FLAG, { messageId, stacks: owed });
  await ChatMessage.create(
    {
      _id: messageId,
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div style="text-align:center;">${game.i18n.format(
        "REDSTEEL.SwordDancer.FinalStrikeAimOffer",
        { name: esc(attacker.name), stacks: owed },
      )}</div>`,
      flags: {
        [SYSTEM_ID]: {
          finalStrikeAim: { actorUuid: attacker.uuid, stacks: owed },
        },
      },
    },
    { keepId: true },
  );
}

/** Actor flag: Final Strike's held-back Aim, still to be placed. */
const AIM_CLAIM_FLAG = "finalStrikeAim";

/** A creature in one of these is no target to aim at. */
const FALLEN_STATUSES = ["dead", "dying", "downed", "unconscious"];

/** Every living, visible enemy on the canvas: where the Aim may go. */
function aimTargets(token) {
  const hostile = isHostileSide(token.document);
  return (canvas.tokens?.placeables ?? []).filter((t) => {
    if (t === token || !t.actor) return false;
    if (!t.visible && !game.user.isGM) return false;
    if (FALLEN_STATUSES.some((s) => t.actor.statuses?.has(s))) return false;
    return isHostileSide(t.document) !== hostile;
  });
}

/** Place the held-back Aim: the targeted enemy, the only one, or a pick. */
async function claimFinalStrikeAim(actor, message) {
  const claim = actor.getFlag(SYSTEM_ID, AIM_CLAIM_FLAG);
  if (!claim || claim.messageId !== message.id) return false;
  const token = tokenForActor(actor);
  if (!token) return false;
  const label = game.i18n.localize(FINAL_STRIKE_KEY);
  const target = await pickAimTarget(aimTargets(token), label);
  if (!target) return false;

  await actor.unsetFlag(SYSTEM_ID, AIM_CLAIM_FLAG);
  const stacks = Number(claim.stacks) || 0;
  const { after } = await grantAimStacks(token, target, stacks);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token.document }),
    content: `<div style="text-align:center;">${game.i18n.format(
      "REDSTEEL.HalfPirouette.Aim",
      {
        name: esc(actor.name),
        stacks,
        target: esc(target.name),
        after,
      },
    )}</div>`,
  });
  return true;
}

/**
 * The "Take Aim" button on Final Strike's offer card, for the attacker's
 * owner (and the GM). Spent once the actor's claim flag is gone.
 */
export function registerFinalStrikeAimButton() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const offer = message.flags?.[SYSTEM_ID]?.finalStrikeAim;
    if (!offer?.actorUuid) return;
    const actor = fromUuidSync(offer.actorUuid);
    if (!actor?.isOwner) return;
    const content = html.querySelector(".message-content");
    if (!content || content.querySelector(".rs-final-strike-aim")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rs-temp-hp-button rs-final-strike-aim";
    button.innerHTML = `<span>${game.i18n.format(
      "REDSTEEL.SwordDancer.FinalStrikeAimButton",
      { stacks: offer.stacks },
    )}</span>`;
    const live = actor.getFlag(SYSTEM_ID, AIM_CLAIM_FLAG)?.messageId === message.id;
    if (!live) {
      button.disabled = true;
      button.classList.add("is-consumed");
    }
    const wrap = document.createElement("div");
    wrap.className = "button-container single";
    wrap.appendChild(button);
    content.appendChild(wrap);
    if (!live) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (await claimFinalStrikeAim(actor, message)) {
          button.classList.add("is-consumed");
        } else {
          button.disabled = false;
        }
      } catch (err) {
        console.error("REDSTEEL | Final Strike Aim failed", err);
        button.disabled = false;
      }
    });
  });
}
