/**
 * Dropping Mind Bending ("Mentální souboj", the Spirit spell).
 *
 * The spell is a Concentration spell ("1 akce - K"): for its duration the
 * caster carries `mind_bending_caster` (−20% Success) and `slow_movement`, and
 * the target carries `mental_strain`. Letting the concentration go ends all
 * three. The hotbar offers it as one free chip, on or off the caster's turn
 * (user ruling 2026-11-20).
 *
 * While a Mental Duel is actually running between the caster and the target
 * the chip is not offered (user ruling 2026-11-20): a running duel has its own
 * exits in the book (the attacker's Will versus Will retreat after a won
 * exchange, Mentalist's Escape, a side at 0 Mind, the GM's End Duel button).
 * Once the duel is over, the chip cleans up whatever debuffs are left.
 *
 * The target is stamped on the caster's `mind_bending_caster` effect when the
 * spell lands (castSpell.mjs maybeStartMentalDuel). A caster effect with no
 * stamp (cast before the stamp existed, or applied by hand) drops only the
 * caster's own debuffs; the target's Mental Strain is then left to the GM.
 *
 * Upkeep (user ruling 2026-11-20): in a started combat, holding the spell
 * costs the caster 1 Action every round, before AND during the Mental Duel it
 * started. The turn it is cast counts as paid (castSpell.mjs stamps it). On
 * each of the caster's later turns the hotbar offers a Hold chip; a turn that
 * ends unpaid lets the spell lapse, and a duel it holds ends with it. The paid
 * turn is stamped on the caster effect (`flags.redsteel.mindBendingHeld =
 * {combat, round}`), the same way stances.mjs stamps a held stance: one turn
 * per combatant per round, so a stamp from another combat or round simply
 * reads as "not held yet". Mentalist → Udržování -1 Akce (soubojUdrzovani)
 * makes the upkeep free: no Hold chip and no lapse. PCs and NPCs alike.
 */

import { SOCKET } from "./applyDamage.mjs";
import { spend, trackedCombat } from "./actionTracker.mjs";
import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { endDuelEverywhere } from "./mentalDuel.mjs";

/** Flag on the caster's `mind_bending_caster` effect: the target TOKEN uuid. */
export const MIND_BENDING_TARGET_FLAG = "mindBendingTarget";

/** Flag on the caster's `mind_bending_caster` effect: the paid turn. */
const HELD_FLAG = "mindBendingHeld";

/** The caster's side of the spell: dropped together. */
const CASTER_STATUSES = ["mind_bending_caster", "slow_movement"];

/** The target's side of the spell. */
const TARGET_STATUS = "mental_strain";

/** The spell's icon, used when the caster effect has none. */
export const MIND_BENDING_ICON = "icons/magic/control/hypnosis-mesmerism-eye.webp";

/**
 * The caster's live `mind_bending_caster` effect, or null.
 * @param {Actor} actor
 * @returns {ActiveEffect|null}
 */
export function mindBendingEffect(actor) {
  return (
    actor?.effects?.contents?.find((e) => e.statuses?.has("mind_bending_caster")) ??
    null
  );
}

/**
 * The actor's token uuids on the current scene (a linked actor may have
 * several; an unlinked token actor has exactly its own).
 * @param {Actor} actor
 * @returns {Set<string>}
 */
function tokenUuidsOf(actor) {
  const uuids = new Set();
  if (actor?.token) uuids.add(actor.token.uuid);
  for (const t of actor?.getActiveTokens?.() ?? []) {
    if (t.document?.uuid) uuids.add(t.document.uuid);
  }
  return uuids;
}

/**
 * The running duel, as the world setting names it, or null.
 * @returns {{attackerUuid: string, defenderUuid: string}|null}
 */
function activeDuel() {
  const active = game.settings.get("redsteel", "mentalDuelActive");
  return active?.attackerUuid && active?.defenderUuid ? active : null;
}

/**
 * True while a Mental Duel is running between the caster and the target. With
 * no stamped target, any running duel the caster is in counts.
 * @param {Actor} actor
 * @param {string|null} targetUuid
 */
function duelRunningBetween(actor, targetUuid) {
  const duel = activeDuel();
  if (!duel) return false;
  const mine = tokenUuidsOf(actor);
  const sides = [duel.attackerUuid, duel.defenderUuid];
  const casterSide = sides.find((uuid) => mine.has(uuid));
  if (!casterSide) return false;
  if (!targetUuid) return true;
  const other = casterSide === duel.attackerUuid ? duel.defenderUuid : duel.attackerUuid;
  return other === targetUuid;
}

/**
 * True while the duel this caster's Mind Bending holds is running (between
 * the caster and its stamped target; with no stamp, any duel the caster is
 * in). The Hold chip reads this to close its right-click drop.
 * @param {Actor} actor
 */
export function isMindBendingDuelRunning(actor) {
  const effect = mindBendingEffect(actor);
  if (!effect) return false;
  const targetUuid = effect.getFlag("redsteel", MIND_BENDING_TARGET_FLAG) || null;
  return duelRunningBetween(actor, targetUuid);
}

/** The display name of a token uuid, or null. */
function targetNameOf(targetUuid) {
  if (!targetUuid) return null;
  try {
    return fromUuidSync(targetUuid)?.name ?? null;
  } catch (err) {
    return null;
  }
}

/**
 * What the cancel chip needs to know, or null when there is nothing to drop
 * (no caster effect) or a duel between the two is still running.
 * @param {Actor} actor
 * @returns {{effect: ActiveEffect, targetUuid: string|null, targetName: string|null, img: string}|null}
 */
export function mindBendingCancelState(actor) {
  const effect = mindBendingEffect(actor);
  if (!effect) return null;
  const targetUuid = effect.getFlag("redsteel", MIND_BENDING_TARGET_FLAG) || null;
  if (duelRunningBetween(actor, targetUuid)) return null;
  const targetName = targetNameOf(targetUuid);
  return { effect, targetUuid, targetName, img: effect.img || MIND_BENDING_ICON };
}

/**
 * Stamp the spell's target on the caster's effect, so the cancel chip knows
 * whose Mental Strain to lift. Called right after the caster effects land.
 * @param {Actor} actor
 * @param {Token|TokenDocument} targetToken
 */
export async function stampMindBendingTarget(actor, targetToken) {
  const doc = targetToken?.document ?? targetToken;
  const effect = mindBendingEffect(actor);
  if (!effect || !doc?.uuid) return;
  if (effect.getFlag("redsteel", MIND_BENDING_TARGET_FLAG) === doc.uuid) return;
  await effect.setFlag("redsteel", MIND_BENDING_TARGET_FLAG, doc.uuid);
}

/**
 * Whether the target's Mental Strain is still owed to something else: another
 * caster's Mind Bending on the same token, or a duel the target is in. Mental
 * Strain does not stack, so lifting it for one caster would lift it for all.
 * @param {string} targetUuid
 * @param {string} casterUuid - the actor dropping its spell (excluded).
 */
function strainStillHeld(targetUuid, casterUuid) {
  const duel = activeDuel();
  if (duel && (duel.attackerUuid === targetUuid || duel.defenderUuid === targetUuid)) {
    return true;
  }
  for (const token of canvas?.tokens?.placeables ?? []) {
    const actor = token.actor;
    if (!actor || actor.uuid === casterUuid) continue;
    const fx = mindBendingEffect(actor);
    if (fx?.getFlag("redsteel", MIND_BENDING_TARGET_FLAG) === targetUuid) return true;
  }
  return false;
}

/**
 * Lift the target's Mental Strain. Runs where the user may write to the
 * target (its owner or a GM).
 * @param {string} targetUuid - TOKEN document uuid.
 * @param {string} casterUuid
 */
async function liftTargetStrain(targetUuid, casterUuid) {
  let doc = null;
  try {
    doc = fromUuidSync(targetUuid);
  } catch (err) {
    doc = null;
  }
  const actor = doc?.actor;
  if (!actor) return;
  if (strainStillHeld(targetUuid, casterUuid)) return;
  const ids = actor.effects.contents
    .filter((e) => e.statuses?.has(TARGET_STATUS))
    .map((e) => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

/**
 * Take the spell down: lift the target's Mental Strain (relayed to the active
 * GM when the user cannot write to the target), then delete the caster's own
 * debuffs. Shared by the free drop (cancelMindBending) and the upkeep lapse
 * (lapseMindBending).
 * @param {Actor} actor - the caster.
 * @param {string|null} targetUuid - the stamped target TOKEN uuid.
 * @returns {Promise<{stillHeld: boolean}>} whether the target stays strained
 *   by another source (read before anything is deleted, for the notice only;
 *   the write side checks again where it runs).
 */
async function removeMindBending(actor, targetUuid) {
  const stillHeld = !!targetUuid && strainStillHeld(targetUuid, actor.uuid);

  // The target first: once the caster effect is gone the stamp goes with it.
  if (targetUuid) {
    let targetActor = null;
    try {
      targetActor = fromUuidSync(targetUuid)?.actor ?? null;
    } catch (err) {
      targetActor = null;
    }
    if (targetActor && (game.user.isGM || targetActor.isOwner)) {
      await liftTargetStrain(targetUuid, actor.uuid);
    } else if (targetActor) {
      if (!game.users.activeGM) {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.MindBendingNoGM"),
        );
      } else {
        game.socket.emit(SOCKET, {
          type: "mindBendingCancel",
          targetUuid,
          casterUuid: actor.uuid,
        });
      }
    }
  }

  const ids = actor.effects.contents
    .filter((e) => CASTER_STATUSES.some((s) => e.statuses?.has(s)))
    .map((e) => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return { stillHeld };
}

/**
 * Drop Mind Bending: delete the caster's own debuffs and lift the target's
 * Mental Strain (relayed to the active GM when the user cannot write to the
 * target). Free; no action is spent.
 * @param {Actor} actor - the caster.
 * @returns {Promise<boolean>} false when there was nothing to drop.
 */
export async function cancelMindBending(actor) {
  if (!actor?.isOwner) return false;
  const state = mindBendingCancelState(actor);
  if (!state) return false;
  const { targetUuid, targetName } = state;
  const { stillHeld } = await removeMindBending(actor, targetUuid);

  let notice;
  if (!targetName) {
    notice = game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.MindBendingDroppedNoTarget");
  } else {
    const key = stillHeld
      ? "REDSTEEL.Bg3Hotbar.Suggest.MindBendingDroppedStillStrained"
      : "REDSTEEL.Bg3Hotbar.Suggest.MindBendingDropped";
    notice = game.i18n.format(key, { target: targetName });
  }
  ui.notifications.info(notice);
  return true;
}

/**
 * Socket receiver: the active GM lifts a relayed target's Mental Strain.
 * @param {{targetUuid: string, casterUuid: string}} data
 */
export async function handleMindBendingCancel(data) {
  if (game.user.id !== game.users.activeGM?.id) return;
  if (!data?.targetUuid) return;
  await liftTargetStrain(data.targetUuid, data.casterUuid);
}

/* -------------------------------------------- */
/*  Upkeep: 1 Action a round                    */
/* -------------------------------------------- */

/**
 * Was the spell paid for in the given round of this combat (cast or held)?
 * @param {ActiveEffect} effect - the caster's `mind_bending_caster` effect.
 * @param {Combat} combat
 * @param {number} [round] - defaults to the combat's current round.
 */
export function isMindBendingHeld(effect, combat, round = combat?.round) {
  const stamp = effect?.getFlag?.("redsteel", HELD_FLAG);
  if (!stamp || !combat) return false;
  return stamp.combat === combat.id && Number(stamp.round) === Number(round);
}

/**
 * Mentalist → Udržování -1 Akce (soubojUdrzovani): holding Mind Bending costs
 * nothing, so there is no Hold chip and the spell never lapses.
 * @param {Actor} actor
 */
export function hasFreeUpkeep(actor) {
  return !!actor && actorHasSpecNode(actor, "mentalist", "soubojUdrzovani");
}

/**
 * Stamp the caster's Mind Bending as paid for this round of the encounter it
 * fights in. Outside a started encounter nothing is stamped: there is no
 * upkeep there, and the first turn of a fight asks.
 * @param {Actor} actor
 */
export async function markMindBendingHeld(actor) {
  const effect = mindBendingEffect(actor);
  const combat = trackedCombat(actor);
  if (!effect || !combat) return;
  await effect.setFlag("redsteel", HELD_FLAG, {
    combat: combat.id,
    round: combat.round,
  });
}

/**
 * The upkeep chat card, in the stance card's shape (stances.mjs
 * postStanceCard): the spell's icon and name, then what happened.
 * @param {Actor} actor
 * @param {string} img
 * @param {string[]} lines - already localized and escaped.
 */
async function postUpkeepCard(actor, img, lines) {
  const title = game.i18n.localize("REDSTEEL.MindBendingUpkeep.Title");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${img}" width="36" height="36" style="margin-right:8px;">
  <strong>${title}</strong>
</span>
<hr>
<div style="text-align:center; font-size:16px;">
  <strong>${lines[0] ?? ""}</strong>
  ${lines
    .slice(1)
    .map((line) => `<div style="font-size:14px; opacity:0.8;">${line}</div>`)
    .join("")}
</div>
`,
  });
}

/**
 * Pay this turn's upkeep: 1 Action through the tracker (which never refuses a
 * use), stamp the turn, post a short card. Nothing to pay with the free
 * upkeep node, outside a started encounter, or when this round is already
 * paid (a second click from another window).
 * @param {Actor} actor - the caster.
 * @returns {Promise<boolean>} whether the spell is held this round.
 */
export async function holdMindBending(actor) {
  if (!actor?.isOwner) return false;
  const effect = mindBendingEffect(actor);
  const combat = trackedCombat(actor);
  if (!effect || !combat) return false;
  if (hasFreeUpkeep(actor) || isMindBendingHeld(effect, combat)) return true;
  await spend(actor, { actions: 1 });
  await markMindBendingHeld(actor);
  await postUpkeepCard(actor, effect.img || MIND_BENDING_ICON, [
    game.i18n.localize("REDSTEEL.MindBendingUpkeep.Held"),
  ]);
  return true;
}

/**
 * A turn ended without the upkeep paid: the spell lapses. A duel it holds is
 * ended first, and awaited, so the strain check below no longer counts it.
 * Then the target's Mental Strain and the caster's debuffs go exactly as the
 * free drop takes them. GM side (the lapse hook runs on the active GM).
 * @param {Actor} actor - the caster.
 */
export async function lapseMindBending(actor, { silent = false } = {}) {
  const effect = mindBendingEffect(actor);
  if (!effect) return;
  const targetUuid = effect.getFlag("redsteel", MIND_BENDING_TARGET_FLAG) || null;
  const img = effect.img || MIND_BENDING_ICON;
  const targetName = targetNameOf(targetUuid);

  let duelEnded = false;
  if (duelRunningBetween(actor, targetUuid)) {
    await endDuelEverywhere(activeDuel()?.attackerUuid ?? null);
    duelEnded = true;
  }

  const { stillHeld } = await removeMindBending(actor, targetUuid);

  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const lines = [game.i18n.localize("REDSTEEL.MindBendingUpkeep.Lapsed")];
  if (duelEnded) lines.push(game.i18n.localize("REDSTEEL.MindBendingUpkeep.LapsedDuel"));
  if (targetName) {
    lines.push(
      game.i18n.format(
        stillHeld
          ? "REDSTEEL.MindBendingUpkeep.LapsedStillStrained"
          : "REDSTEEL.MindBendingUpkeep.LapsedStrain",
        { target: esc(targetName) },
      ),
    );
  }
  // `silent`: a caller that ended the spell for another reason (Mentalist
  // strain cancelling Concentration, mentalist.mjs) posts its own card; this
  // one would wrongly blame unpaid upkeep.
  if (!silent) await postUpkeepCard(actor, img, lines);
}

/**
 * A caster's turn ended without the upkeep paid: Mind Bending lapses. Only a
 * forward step counts (a GM stepping the tracker back must not strip anyone),
 * and only the active GM writes, so it happens once. Same test as
 * stances.mjs registerStanceHooks.
 *
 * `combatTurnChange(combat, prior, current)` fires on every client after the
 * Combat update; `prior`/`current` are CombatHistoryData (round, turn,
 * combatantId, tokenId).
 */
export function registerMindBendingUpkeepHooks() {
  Hooks.on("combatTurnChange", async (combat, prior, current) => {
    const gm = game.users.activeGM;
    if (!gm || gm.id !== game.user.id) return;
    if (!combat?.started || !prior?.combatantId) return;
    const forward =
      Number(current?.round) > Number(prior.round) ||
      (Number(current?.round) === Number(prior.round) &&
        Number(current?.turn) > Number(prior.turn));
    if (!forward) return;

    const actor = combat.combatants.get(prior.combatantId)?.actor;
    if (!actor) return;
    const effect = mindBendingEffect(actor);
    if (!effect) return;
    if (hasFreeUpkeep(actor)) return;
    if (isMindBendingHeld(effect, combat, prior.round)) return;
    await lapseMindBending(actor);
  });
}
