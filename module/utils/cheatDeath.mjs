/**
 * Cheat Death (Obelstění smrti).
 *
 * A character whose Dying countdown runs out does not simply die. The GM first
 * confirms the death (the countdown is GM-only knowledge), then the player
 * chooses: attempt to Cheat Death, or accept it.
 *
 *   Chance = 25 + Endurance ×5 + Luck ×2 + Traits/Features bonuses
 *            (`system.cheatDeath.bonus`, fed by Active Effects).
 *   Once per 10 in-world days (`flags.redsteel.cheatDeath.lastUsed`, worldTime
 *   seconds; the day length comes from Calendaria).
 *   Before the roll, Max Wounds drop permanently by 1
 *   (`system.stats.graveWounds.lost`). If that would put Max Wounds below the
 *   current Wounds, there is no right to Cheat Death.
 *   Success: 1 health, Incapacitated / Bleeding / Burning removed, no Wound.
 *
 * State lives on the Dying effect (`flags.redsteel.deathState`):
 *   undefined → "awaitingGM" → "awaitingPlayer" → "resolving"
 * "resolving" is a lock taken by whoever clicks Attempt/Accept first, so a
 * player and a GM clicking the same card cannot pay the Max Wound twice.
 *
 * Just before this module deletes Dying it stamps `flags.redsteel.endedBy`
 * ("death" | "cheatDeath"), which RedsteelActiveEffect#_onDelete reads to skip
 * the +1 Wound (and, on death, the resolve test).
 *
 * The roll itself runs on the clicking owner's client so their dice and their
 * roll bias (Guardian Angel's advantage) show; everything that edits effects,
 * statuses or combatants is relayed to the active GM.
 */

import { withRollBias, tagRollBuckets } from "./rollAdvantage.mjs";
import { secondsPerDay } from "./calendariaIntegration.mjs";
import { clearBleedEffects } from "./otherActions.mjs";
import { combatantsForActor } from "./combatants.mjs";

const SOCKET = "system.redsteel";
const SOCKET_TYPE = "cheatDeath";

/** In-world days between two uses. */
const COOLDOWN_DAYS = 10;

const L = (key) => game.i18n.localize(`REDSTEEL.CheatDeath.${key}`);
const F = (key, data) => game.i18n.format(`REDSTEEL.CheatDeath.${key}`, data);

/* -------------------------------------------- */
/*  Lookups                                      */
/* -------------------------------------------- */

function hasStatus(effect, id) {
  return (
    effect.statuses?.has(id) || effect.getFlag("core", "statusId") === id
  );
}

function findDying(actor) {
  return actor?.effects.find((e) => hasStatus(e, "dying")) ?? null;
}

/** True while a Combat First Aid "Stabilise" attempt is running on the actor. */
function isBeingStabilised(actor) {
  const pause = actor.getFlag("redsteel", "firstAidPause");
  if (!pause?.aiderUuid) return false;
  const aider = fromUuidSync(pause.aiderUuid);
  return (
    aider?.getFlag("redsteel", "firstAidProgress")?.actionType === "stabilise"
  );
}

/**
 * The Cheat Death chance and its parts.
 * @param {Actor} actor
 * @returns {{total:number, end:number, lck:number, bonus:number}}
 */
export function getCheatDeathChance(actor) {
  const system = actor?.system ?? {};
  const end = Number(system.attributes?.end?.total) || 0;
  const lck = Number(system.secondaryAttributes?.lck?.total) || 0;
  const bonus = Number(system.cheatDeath?.bonus || 0);
  return { total: 25 + end * 5 + lck * 2 + bonus, end, lck, bonus };
}

/**
 * Whether the actor may attempt Cheat Death right now.
 * @param {Actor} actor
 * @returns {{ok:boolean, reason?:"cooldown"|"wounds", days?:number}}
 */
export function getEligibility(actor) {
  const lastUsed = actor.getFlag("redsteel", "cheatDeath.lastUsed");
  if (lastUsed != null && Number.isFinite(Number(lastUsed))) {
    const day = secondsPerDay();
    const readyAt = Number(lastUsed) + COOLDOWN_DAYS * day;
    const now = game.time.worldTime;
    if (now < readyAt) {
      return {
        ok: false,
        reason: "cooldown",
        days: Math.max(1, Math.ceil((readyAt - now) / day)),
      };
    }
  }

  const gw = actor.system.stats?.graveWounds ?? {};
  if ((Number(gw.max) || 0) - 1 < (Number(gw.value) || 0)) {
    return { ok: false, reason: "wounds" };
  }
  return { ok: true };
}

/** GMs plus every user who owns the actor. */
function ownerRecipients(actor) {
  return game.users
    .filter((u) => u.isGM || actor.testUserPermission(u, "OWNER"))
    .map((u) => u.id);
}

function buttonRow(buttons) {
  return `<div class="redsteel-action-buttons">${buttons
    .map(
      ([action, label]) =>
        `<button type="button" data-action="${action}">${label}</button>`,
    )
    .join("")}</div>`;
}

/* -------------------------------------------- */
/*  Step 1: bled out (GM, from the countdown)    */
/* -------------------------------------------- */

/**
 * Called by RedsteelActiveEffect#_handleDyingCountdown on the authoritative GM
 * every round the counter sits at -1 or below.
 * @param {Actor} actor
 * @param {ActiveEffect} dying
 */
export async function onBledOut(actor, dying) {
  if (!actor || !dying || actor.type !== "character") return;
  if (dying.getFlag("redsteel", "deathState")) return;
  // Someone is mid-Stabilise: the countdown keeps running, so this is asked
  // again next round start if they fail.
  if (isBeingStabilised(actor)) return;

  await dying.setFlag("redsteel", "deathState", "awaitingGM");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="redsteel-dying">
        <p><b>${F("BledOutTitle", { name: actor.name })}</b></p>
        <p>${L("BledOutBody")}</p>
        ${buttonRow([["cheatDeathConfirm", L("ConfirmButton")]])}
      </div>`,
    whisper: ChatMessage.getWhisperRecipients("GM"),
    blind: true,
    flags: { redsteel: { type: "cheatDeathGM", actorUuid: actor.uuid } },
  });
}

/* -------------------------------------------- */
/*  Step 2: GM confirms → player's choice        */
/* -------------------------------------------- */

async function onConfirm(actor, button) {
  if (!game.user.isGM) {
    ui.notifications.warn(L("GMOnly"));
    return;
  }
  button.disabled = true;

  const dying = findDying(actor);
  if (dying?.getFlag("redsteel", "deathState") !== "awaitingGM") {
    ui.notifications.info(L("Stale"));
    return;
  }
  await dying.setFlag("redsteel", "deathState", "awaitingPlayer");

  const eligibility = getEligibility(actor);
  let body;
  let buttons;
  if (eligibility.ok) {
    const chance = getCheatDeathChance(actor);
    const advantage =
      Number(actor.system.rollAdvantage?.cheatDeath) > 0
        ? `<p>${L("Advantage")}</p>`
        : "";
    const maxWounds = Number(actor.system.stats.graveWounds?.max) || 0;
    body = `
      <p><b>${F("Chance", { chance: chance.total })}</b></p>
      <p style="font-size:11px;opacity:.75;">${F("Breakdown", {
        end: chance.end,
        endPart: chance.end * 5,
        lck: chance.lck,
        lckPart: chance.lck * 2,
        bonus: chance.bonus,
      })}</p>
      ${advantage}
      <p>${F("Cost", { max: maxWounds, after: maxWounds - 1 })}</p>`;
    buttons = [
      ["cheatDeathAttempt", L("AttemptButton")],
      ["cheatDeathAccept", L("AcceptButton")],
    ];
  } else {
    body =
      eligibility.reason === "cooldown"
        ? `<p>${F("IneligibleCooldown", { days: eligibility.days })}</p>`
        : `<p>${L("IneligibleWounds")}</p>`;
    buttons = [["cheatDeathAccept", L("AcceptButton")]];
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="redsteel-dying">
        <p><b>${F("DoorTitle", { name: actor.name })}</b></p>
        ${body}
        ${buttonRow(buttons)}
      </div>`,
    whisper: ownerRecipients(actor),
    flags: { redsteel: { type: "cheatDeathPlayer", actorUuid: actor.uuid } },
  });
}

/* -------------------------------------------- */
/*  Step 3: the player's choice (owner client)   */
/* -------------------------------------------- */

/**
 * Take the "resolving" lock on the Dying effect, or explain why not.
 * @returns {Promise<boolean>}
 */
async function claimDecision(actor) {
  if (!game.users.activeGM) {
    ui.notifications.warn(L("NoGM"));
    return false;
  }
  const dying = findDying(actor);
  if (dying?.getFlag("redsteel", "deathState") !== "awaitingPlayer") {
    ui.notifications.info(L("Stale"));
    return false;
  }
  await dying.setFlag("redsteel", "deathState", "resolving");
  return true;
}

async function onAttempt(actor) {
  if (!(await claimDecision(actor))) return;

  // Re-checked at click time: days may have passed or Wounds changed since
  // the card was posted. Not eligible any more means death.
  if (!getEligibility(actor).ok) {
    await requestGM("applyDeath", actor);
    return;
  }

  // The price is paid before the roll, win or lose.
  const lost = Number(actor.system.stats.graveWounds?.lost) || 0;
  await actor.update({ "system.stats.graveWounds.lost": lost + 1 });

  const chance = getCheatDeathChance(actor);
  const roll = new Roll(`${chance.total} - 1d100`, withRollBias({}, actor));
  tagRollBuckets(roll, "cheatDeath");
  await roll.evaluate();
  const success = roll.total >= 0;

  const maxWounds = Number(actor.system.stats.graveWounds?.max) || 0;
  const outcome = success
    ? F("ResultSuccess", { name: actor.name })
    : F("ResultFailure", { name: actor.name });

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<p class="rs-card-headline"><b><i class="fa-light fa-skull"></i> ${L("Title")}</b></p>
      <p><b>${outcome}</b></p>
      <p style="font-size:11px;opacity:.75;">${F("Chance", { chance: chance.total })}${
        // A dead character has no use for the remaining Max Wounds.
        success ? ` · ${F("MaxWoundLost", { max: maxWounds })}` : ""
      }</p>`,
    flags: {
      redsteel: { type: "cheatDeathResult", actorUuid: actor.uuid, success },
    },
  });

  await requestGM(success ? "applySuccess" : "applyDeath", actor);
}

async function onAccept(actor) {
  if (!(await claimDecision(actor))) return;
  await requestGM("applyDeath", actor);
}

/* -------------------------------------------- */
/*  Step 4: outcome (active GM)                  */
/* -------------------------------------------- */

async function requestGM(action, actor) {
  const payload = { type: SOCKET_TYPE, action, actorUuid: actor.uuid };
  if (game.user.isGM) return handleGM(payload);
  game.socket.emit(SOCKET, payload);
}

async function handleGM({ action, actorUuid }) {
  const actor = fromUuidSync(actorUuid);
  if (!actor) return;
  const dying = findDying(actor);
  const state = dying?.getFlag("redsteel", "deathState");
  if (!dying || !["awaitingPlayer", "resolving"].includes(state)) {
    ui.notifications.info(L("Stale"));
    return;
  }
  if (action === "applyDeath") await applyDeath(actor, dying);
  else if (action === "applySuccess") await applySuccess(actor, dying);
}

async function applyDeath(actor, dying) {
  await dying.setFlag("redsteel", "endedBy", "death");
  await dying.delete();

  if (!actor.statuses.has("dead")) {
    await actor.toggleStatusEffect("dead", { active: true, overlay: true });
  }
  for (const combatant of combatantsForActor(actor)) {
    if (!combatant.defeated) await combatant.update({ defeated: true });
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="redsteel-dying">
        <p><b>${F("DeadTitle", { name: actor.name })}</b></p>
      </div>`,
  });
}

async function applySuccess(actor, dying) {
  await actor.update({
    "flags.redsteel.cheatDeath.lastUsed": game.time.worldTime,
  });

  await dying.setFlag("redsteel", "endedBy", "cheatDeath");
  await dying.delete();

  const removed = [];
  if ((await clearBleedEffects(actor)) > 0) removed.push(L("Removed.Bleed"));

  const burns = actor.effects.filter((e) => hasStatus(e, "burn"));
  for (const burn of burns) await burn.delete();
  if (burns.length) removed.push(L("Removed.Burn"));

  if (actor.getFlag("redsteel", "firstAidPause")) {
    await actor.unsetFlag("redsteel", "firstAidPause");
  }

  const incapacitated = actor.effects.filter((e) =>
    hasStatus(e, "incapacitated"),
  );
  for (const effect of incapacitated) await effect.delete();
  if (incapacitated.length) removed.push(L("Removed.Incapacitated"));

  await actor.update({ "system.stats.health.value": 1 });

  let prone = false;
  if (!actor.statuses.has("downed") && !actor.statuses.has("incapacitated")) {
    await game.redsteel.applyEffect(actor, "prone");
    prone = true;
  }

  const lines = [`<p>${L("SuccessHealth")}</p>`];
  if (removed.length) {
    lines.push(`<p>${F("RemovedList", { list: removed.join(", ") })}</p>`);
  }
  if (prone) lines.push(`<p>${L("ProneApplied")}</p>`);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="redsteel-dying">
        <p><b>${F("SuccessTitle", { name: actor.name })}</b></p>
        ${lines.join("")}
      </div>`,
  });
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

function resolveActor(message) {
  const uuid = message.getFlag("redsteel", "actorUuid");
  return uuid ? fromUuidSync(uuid) : null;
}

const OWNER_ACTIONS = {
  cheatDeathAttempt: onAttempt,
  cheatDeathAccept: onAccept,
};

/**
 * Wire the chat buttons (at once, so cards rendered during load are covered)
 * and the GM socket listener (at ready).
 */
export function registerCheatDeath() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const type = message.getFlag("redsteel", "type");
    if (type !== "cheatDeathGM" && type !== "cheatDeathPlayer") return;

    html
      .querySelectorAll('[data-action="cheatDeathConfirm"]')
      .forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          const actor = resolveActor(message);
          if (!actor) return;
          await onConfirm(actor, event.currentTarget);
        });
      });

    for (const [action, handler] of Object.entries(OWNER_ACTIONS)) {
      html.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          const target = event.currentTarget;
          const actor = resolveActor(message);
          if (!actor) return;
          if (!actor.isOwner) {
            ui.notifications.warn(L("NotOwner"));
            return;
          }
          // Both choices on the card go dead together.
          target
            .closest(".redsteel-action-buttons")
            ?.querySelectorAll("button")
            .forEach((b) => (b.disabled = true));
          await handler(actor);
        });
      });
    }
  });

  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
      if (data?.type !== SOCKET_TYPE) return;
      if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;
      await handleGM(data);
    });
  });
}
