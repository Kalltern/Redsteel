/**
 * Odbornosti (features) that are actions or that answer an event.
 *
 * Utility abilities carry a `system.key` and arrive here from
 * runUtilityAbility in combatAbilities.mjs, already paid for. Everything a
 * player may not write (another character's effects, its Reaction) goes
 * through the small GM relay at the bottom.
 *
 * Rulings (2026-10-31, the book does not say):
 * - Kip Up's "gains 1 Action" refunds one spent Action on the tracker, and its
 *   Speed test exempts the actor from the Prone floor for as long as this fall
 *   lasts.
 * - The insanity abilities never refuse: world time may not be kept at every
 *   table, so the card names the last attempt and the GM rules on it.
 * - Tenacity and Acrobat II ask on the client applying the damage, which is the
 *   GM's: the rulebook's "may" is answered at the table, out loud.
 */

import { resolveTestRating } from "./testRating.mjs";
import { buildSpeedTestFormula } from "./speedTest.mjs";
import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";
import {
  getSpent,
  grantBonusStep,
  lockMovement,
  getMovementLock,
  setSpent,
  spend,
  trackedCombat,
} from "./actionTracker.mjs";
import { requestForcedMovement } from "./forcedMovement.mjs";
import { heldShield } from "./wardenShield.mjs";
import { engagingEnemyIds, tokenForActor } from "./movementZones.mjs";
import { syncFloorInitiative } from "./floorInitiative.mjs";

const SOCKET = "system.redsteel";
const RELAY = "featureRelay";
const SYSTEM_ID = "redsteel";

/** The book's difficulty words, as the fixed test modifiers. */
const HARD = -20;
const VERY_HARD = -30;
const LEGENDARY = -60;
/** Speed tests have their own scale: Very Hard is -18. */
const SPEED_VERY_HARD = -18;

const DAY = 86400;
const MONTH_DAYS = 30;

const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.FeatureAction.${key}`, data)
    : game.i18n.localize(`REDSTEEL.FeatureAction.${key}`);
const esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));

/** A plain line in chat, speaking as the actor. */
async function post(actor, ability, lines, rolls = []) {
  const title = ability?.localizedName ?? ability?.name ?? "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls,
    flavor: `<span style="display:inline-flex;align-items:center;"><img src="${
      ability?.img ?? ""
    }" width="36" height="36" style="margin-right:8px;"><strong>${esc(title)}</strong></span><hr>${lines
      .map((line) => `<p>${line}</p>`)
      .join("")}`,
  });
}

/** Roll a Test at a modifier. Margin of success on `.total`. */
async function rollTest(actor, testName, modifier = 0) {
  const { value, skillKey } = resolveTestRating(actor, testName);
  const roll = new Roll(`(${value + modifier}) - 1d100`, withRollBias({}, actor));
  tagRollSkill(roll, skillKey);
  await roll.evaluate();
  return roll;
}

function outcome(roll) {
  return roll.total >= 0 ? L("Success", { margin: roll.total }) : L("Failure", { margin: roll.total });
}

function singleTarget(actor) {
  const targets = [...(game.user?.targets ?? [])].filter((t) => t?.actor && t.actor !== actor);
  if (targets.length !== 1) {
    ui.notifications.warn(L("OneTarget"));
    return null;
  }
  return targets[0];
}

/* ---- Akrobat I: Kip Up ------------------------------------------------- */

async function runKipUp(actor, ability) {
  if (!actor.statuses?.has("prone")) {
    ui.notifications.warn(L("NotProne"));
    return;
  }
  const combat = trackedCombat(actor);
  const used = actor.getFlag(SYSTEM_ID, "kipUpRound");
  if (combat && used?.combat === combat.id && used?.round === combat.round) {
    ui.notifications.warn(L("OncePerRound"));
    return;
  }
  if (combat) {
    await actor.setFlag(SYSTEM_ID, "kipUpRound", { combat: combat.id, round: combat.round });
  }

  const test = await rollTest(actor, "acrobacy", VERY_HARD);
  const lines = [L("KipUpTest", { result: outcome(test) })];
  if (test.total >= 0) {
    const spent = getSpent(actor).actions;
    if (spent > 0) await setSpent(actor, "actions", spent - 1);
    lines.push(L("KipUpAction"));
  }
  const rolls = [test];

  // The second half of the feature: keep the turn order through the fall.
  const proneEffect = actor.effects.find((e) => e.statuses?.has("prone"));
  if (combat && proneEffect) {
    // The real test, not the flat 1 a floored actor otherwise rolls.
    const formula = buildSpeedTestFormula(actor, { ignoreFloor: true });
    const speed = await new Roll(
      `${formula} + (${SPEED_VERY_HARD})`,
      actor.getRollData(),
    ).evaluate();
    rolls.push(speed);
    const kept = speed.total >= 0;
    lines.push(L(kept ? "KipUpSpeedKept" : "KipUpSpeedLost", { total: speed.total }));
    if (kept) {
      await actor.setFlag(SYSTEM_ID, "floorExempt", proneEffect.id);
      relay({ op: "syncFloor", actorUuid: actor.uuid });
    }
  }
  await post(actor, ability, lines, rolls);
}

/* ---- Sekerník: Hooking ------------------------------------------------- */

async function runHooking(actor, ability) {
  const target = singleTarget(actor);
  if (!target) return;
  if (!heldShield(target.actor)) {
    ui.notifications.warn(L("NoShield"));
    return;
  }
  const mine = resolveTestRating(actor, "strength").value;
  const theirs = resolveTestRating(target.actor, "strength").value;
  const roll = new Roll(`(${mine}) - 1d100 - ((${theirs}) - 1d100)`, withRollBias({}, actor));
  await roll.evaluate();
  const won = roll.total >= 0;
  const lines = [L("HookingTest", { name: esc(target.name), margin: roll.total })];
  if (won) {
    relay({ op: "hooked", actorUuid: target.actor.uuid });
    lines.push(L("HookingWin", { name: esc(target.name) }));
  } else {
    lines.push(L("HookingLose", { name: esc(target.name) }));
  }
  await post(actor, ability, lines, [roll]);
}

/* ---- Prohození: Swap Places -------------------------------------------- */

async function runSwapPlaces(actor, ability) {
  const target = singleTarget(actor);
  if (!target) return;
  const token = tokenForActor(actor);
  if (!token) return;
  await requestForcedMovement({
    op: "swap",
    sceneId: token.document?.parent?.id ?? canvas.scene?.id,
    tokenId: token.id,
    otherTokenId: target.id,
  });
  await spend(actor, { reactions: 1 });
  relay({ op: "spendReaction", actorUuid: target.actor.uuid });
  await post(actor, ability, [L("Swapped", { name: esc(target.name) })]);
}

/* ---- Poslední krok: Last Step ------------------------------------------ */

async function runLastStep(actor, ability) {
  const token = tokenForActor(actor);
  if (!token) return;
  const speed = Number(actor.system?.secondaryAttributes?.spd?.total) || 0;
  await grantBonusStep(actor, {
    mode: "duelist",
    budget: speed,
    startSpent: Number(token.document?.getFlag(SYSTEM_ID, "movementSpent") ?? 0) || 0,
    source: foundry.utils.randomID(),
  });
  await post(actor, ability, [L("LastStep", { hexes: speed })]);
}

/* ---- Bezpečný krok: Safe Step ------------------------------------------ */

async function runSafeStep(actor, ability) {
  const token = tokenForActor(actor);
  const lock = getMovementLock(actor);
  const test = await rollTest(actor, "stealth", LEGENDARY);
  const lines = [L("SafeStepTest", { result: outcome(test) })];
  if (test.total >= 0) {
    // Disengage's own mechanism: these enemies stop threatening this walk.
    if (token && lock) await lockMovement(actor, { ...lock, ignore: engagingEnemyIds(token) });
    lines.push(L("SafeStepWin"));
  } else {
    lines.push(L("SafeStepLose"));
  }
  await post(actor, ability, lines, [test]);
}

/* ---- Bezchybný plán: Flawless Plan ------------------------------------- */

async function runFlawlessPlan(actor, ability) {
  const combat = trackedCombat(actor);
  const party = await foundry.applications.api.DialogV2.wait({
    window: { title: ability.localizedName ?? ability.name },
    content: `<p>${L("FlawlessPlanPrompt")}</p>`,
    buttons: [
      { action: "ally", label: L("FlawlessPlanAlly"), default: true },
      { action: "party", label: L("FlawlessPlanParty") },
    ],
  });
  if (!party) return;
  const whole = party === "party";
  const targets = whole
    ? (combat?.combatants?.contents ?? [])
        .map((c) => c.actor)
        .filter((a) => a?.type === "character")
    : [singleTarget(actor)?.actor].filter(Boolean);
  if (!targets.length) return;
  const test = await rollTest(actor, "tactics", whole ? LEGENDARY : HARD);
  const lines = [L("FlawlessPlanTest", { result: outcome(test) })];
  if (test.total >= 0) {
    for (const target of targets) relay({ op: "flawlessPlan", actorUuid: target.uuid });
    lines.push(L("FlawlessPlanWin", { names: esc(targets.map((a) => a.name).join(", ")) }));
  }
  await post(actor, ability, lines, [test]);
}

/**
 * Bezchybný plán's Reaction is good once per fight: the moment the actor
 * spends more Reactions than it would have had without it, the effect is gone.
 */
export async function spendFlawlessPlan(actor) {
  const effect = actor?.effects?.find((e) => e.flags?.redsteel?.flawlessPlan);
  if (effect && getSpent(actor).reactions >= 2) await effect.delete();
}

/* ---- Bojová připravenost: Combat Readiness ----------------------------- */

async function runCombatReadiness(actor, ability) {
  const combat = trackedCombat(actor);
  if (!combat) {
    ui.notifications.warn(L("NeedsCombat"));
    return;
  }
  if (combat.getFlag(SYSTEM_ID, "combatReadiness")) {
    ui.notifications.warn(L("OncePerFight"));
    return;
  }
  const targeted = [...(game.user?.targets ?? [])];
  const target = targeted.length === 1 ? targeted[0].actor : actor;
  const bonus = Math.floor((Number(actor.system?.skills?.tactics?.value) || 0) / 2);
  relay({ op: "combatReadiness", actorUuid: target.uuid, bonus, combatId: combat.id });
  await post(actor, ability, [L("CombatReadiness", { name: esc(target.name), bonus })]);
}

/* ---- Insanity relief --------------------------------------------------- */

function lastAttemptLine(actor, key, waitDays) {
  const stamp = actor.getFlag(SYSTEM_ID, `insanityRelief.${key}`);
  if (!stamp) return null;
  const days = Math.floor((game.time.worldTime - Number(stamp.at)) / DAY);
  const wait = stamp.success ? MONTH_DAYS : waitDays;
  return days < wait ? L("TooSoon", { days, wait }) : null;
}

async function reliefAttempt(actor, key, chance) {
  const roll = await new Roll("1d100").evaluate();
  const success = roll.total <= chance;
  const insanity = Number(actor.system?.stats?.insanity?.value) || 0;
  await actor.setFlag(SYSTEM_ID, `insanityRelief.${key}`, { at: game.time.worldTime, success });
  if (success && insanity > 0) {
    await actor.update({ "system.stats.insanity.value": insanity - 1 });
  }
  return { roll, success };
}

async function runInsanityRelief(actor, ability, key, chance, waitDays) {
  const lines = [L("ReliefChance", { chance })];
  const warning = lastAttemptLine(actor, key, waitDays);
  if (warning) lines.push(warning);
  const { roll, success } = await reliefAttempt(actor, key, chance);
  lines.push(L(success ? "ReliefWin" : "ReliefLose", { roll: roll.total }));
  await post(actor, ability, lines, [roll]);
}

const faith = (actor) => Number(actor.system?.secondaryAttributes?.fth?.total) || 0;

/* ---- Dispatch ---------------------------------------------------------- */

const ACTIONS = {
  kipUp: runKipUp,
  hooking: runHooking,
  swapPlaces: runSwapPlaces,
  lastStep: runLastStep,
  safeStep: runSafeStep,
  flawlessPlan: runFlawlessPlan,
  combatReadiness: runCombatReadiness,
  longPrayer: (actor, ability) =>
    runInsanityRelief(actor, ability, "longPrayer", faith(actor) * 2 + 10, 5),
  calmMind: (actor, ability) => runInsanityRelief(actor, ability, "calmMind", 20, 10),
};

/** Run the action an ability's `system.key` names. False when it is not ours. */
export async function runFeatureAction(actor, ability) {
  const run = ACTIONS[ability?.system?.key];
  if (!run) return false;
  await run(actor, ability);
  return true;
}

/* ---- Answers to events ------------------------------------------------- */

/**
 * Houževnatost: the degree this Critical Hit lands at after the victim spends
 * Mind Points on it. Asked once per target, on the client applying the damage.
 */
export async function tenacityDegree(actor, degree) {
  const current = Number(degree) || 0;
  const mind = Number(actor?.system?.stats?.mind?.value) || 0;
  if (!actor?.system?.tenacity || current <= 0 || mind <= 0) return degree;
  const most = Math.min(current, mind);
  const spent = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("REDSTEEL.Items.Tenacity.name") },
    content: `<p>${L("TenacityPrompt", { name: esc(actor.name), degree: current })}</p>
      <input type="number" name="spend" min="0" max="${most}" value="0">`,
    ok: { callback: (_event, button) => Number(button.form.elements.spend.value) || 0 },
    rejectClose: false,
  });
  const amount = Math.min(most, Math.max(0, Math.floor(Number(spent) || 0)));
  if (!amount) return degree;
  await actor.update({ "system.stats.mind.value": mind - amount });
  return current - amount;
}

/**
 * Akrobat II: a knock-down the victim may roll out of. True when it was
 * avoided, and the victim has already stepped one hex back. Only the apply
 * paths ask, so a character dropping prone on purpose is never offered it.
 */
export async function acrobatEvade(actor) {
  if (!actor?.system?.acrobatEvade) return false;
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("REDSTEEL.Items.AcrobatII.name") },
    content: `<p>${L("AcrobatPrompt", { name: esc(actor.name) })}</p>`,
    rejectClose: false,
  });
  if (!yes) return false;
  const test = await rollTest(actor, "acrobacy", LEGENDARY);
  const avoided = test.total >= 0;
  await post(
    actor,
    { name: game.i18n.localize("REDSTEEL.Items.AcrobatII.name"), img: "icons/skills/movement/feet-winged-boots-brown.webp" },
    [L("AcrobatTest", { result: outcome(test) })],
    [test],
  );
  if (!avoided) return false;
  const token = tokenForActor(actor);
  if (token) {
    // Facing 0 is south, and screen bearings start east, so "behind" is
    // facing + 90 + 180.
    const rotation = Number(token.document?.rotation) || 0;
    await requestForcedMovement({
      op: "slide",
      sceneId: token.document?.parent?.id ?? canvas.scene?.id,
      tokenId: token.id,
      heading: rotation + 270,
      distance: 1,
      collide: false,
    });
  }
  return true;
}

/** Mysl nad tělem, on the client that raised the Fatigue. */
async function offerMindOverBody(actor) {
  const mind = Number(actor.system?.stats?.mind?.value) || 0;
  if (mind < 3) return;
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("REDSTEEL.Items.MindOverBody.name") },
    content: `<p>${L("MindOverBodyPrompt", { name: esc(actor.name) })}</p>`,
    rejectClose: false,
  });
  if (!yes) return;
  const fatigue = Number(actor.system?.stats?.fatigue?.value) || 0;
  await actor.update({
    "system.stats.fatigue.value": Math.max(0, fatigue - 1),
    "system.stats.mind.value": mind - 3,
  });
}

/** Očišťující bolest, on the client that wrote the Grave Wound. */
async function rollCleansingPain(actor) {
  const stamp = actor.getFlag(SYSTEM_ID, "insanityRelief.cleansingPain");
  if (stamp?.success && (game.time.worldTime - Number(stamp.at)) / DAY < MONTH_DAYS) return;
  if (!(Number(actor.system?.stats?.insanity?.value) > 0)) return;
  const chance = faith(actor) * 5;
  const { roll, success } = await reliefAttempt(actor, "cleansingPain", chance);
  await post(
    actor,
    { name: game.i18n.localize("REDSTEEL.Items.CleansingPain.name"), img: "icons/magic/unholy/hands-praying-fire-green.webp" },
    [L("ReliefChance", { chance }), L(success ? "ReliefWin" : "ReliefLose", { roll: roll.total })],
    [roll],
  );
}

/* ---- GM relay ---------------------------------------------------------- */

async function runRelay(payload) {
  const actor = payload?.actorUuid ? await fromUuid(payload.actorUuid) : null;
  if (!actor) return;
  switch (payload.op) {
    case "hooked":
      await game.redsteel.applyEffect(actor, "hooked", { stacks: 1 });
      await spend(actor, { reactions: 1 });
      break;
    case "spendReaction":
      await spend(actor, { reactions: 1 });
      break;
    case "syncFloor":
      await syncFloorInitiative(actor);
      break;
    case "flawlessPlan":
      await actor.createEmbeddedDocuments("ActiveEffect", [
        {
          name: game.i18n.localize("REDSTEEL.Items.FlawlessPlan.name"),
          img: "icons/skills/trades/academics-investigation-puzzles.webp",
          changes: [{ key: "system.actionEconomy.reactions", type: "add", value: 1 }],
          flags: { redsteel: { flawlessPlan: true, fightLong: true } },
        },
      ]);
      break;
    case "combatReadiness": {
      await actor.createEmbeddedDocuments("ActiveEffect", [
        {
          name: game.i18n.localize("REDSTEEL.Items.CombatReadiness.name"),
          img: "icons/magic/time/clock-stopwatch-white-blue.webp",
          changes: [{ key: "system.secondaryAttributes.ini.bonus", type: "add", value: payload.bonus }],
          flags: { redsteel: { fightLong: true } },
        },
      ]);
      const combat = game.combats.get(payload.combatId);
      await combat?.setFlag(SYSTEM_ID, "combatReadiness", true);
      const combatant = combat?.combatants.find((c) => c.actorId === actor.id);
      if (combatant && Number.isFinite(combatant.initiative)) {
        await combat.setInitiative(combatant.id, combatant.initiative + payload.bonus);
      }
      break;
    }
  }
}

function relay(payload) {
  if (game.user.isGM) return runRelay(payload);
  game.socket.emit(SOCKET, { type: RELAY, payload });
  return null;
}

/** Listener and hooks. Call once at ready. */
export function registerFeatureActions() {
  game.socket.on(SOCKET, (data) => {
    if (data?.type === RELAY && game.users.activeGM?.isSelf) runRelay(data.payload);
  });

  // Effects that last one fight. Sweeping on deleteCombat, by the active GM.
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.users.activeGM?.isSelf) return;
    for (const combatant of combat.combatants) {
      const stale = combatant.actor?.effects?.filter((e) => e.flags?.redsteel?.fightLong) ?? [];
      for (const effect of stale) await effect.delete();
    }
  });

  Hooks.on("preUpdateActor", (actor, changes, options) => {
    options.redsteelBefore = {
      fatigue: Number(actor.system?.stats?.fatigue?.value) || 0,
      wounds: Number(actor.system?.stats?.graveWounds?.value) || 0,
    };
  });
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id || !options.redsteelBefore) return;
    const fatigue = foundry.utils.getProperty(changes, "system.stats.fatigue.value");
    if (actor.system?.mindOverBody && Number(fatigue) > options.redsteelBefore.fatigue) {
      offerMindOverBody(actor);
    }
    const wounds = foundry.utils.getProperty(changes, "system.stats.graveWounds.value");
    if (actor.system?.cleansingPain && Number(wounds) > options.redsteelBefore.wounds) {
      rollCleansingPain(actor);
    }
  });
}
