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
 */

import { SOCKET } from "./applyDamage.mjs";

/** Flag on the caster's `mind_bending_caster` effect: the target TOKEN uuid. */
export const MIND_BENDING_TARGET_FLAG = "mindBendingTarget";

/** The caster's side of the spell: dropped together. */
const CASTER_STATUSES = ["mind_bending_caster", "slow_movement"];

/** The target's side of the spell. */
const TARGET_STATUS = "mental_strain";

/** The spell's icon, used when the caster effect has none. */
const MIND_BENDING_ICON = "icons/magic/control/hypnosis-mesmerism-eye.webp";

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
  let targetName = null;
  if (targetUuid) {
    try {
      targetName = fromUuidSync(targetUuid)?.name ?? null;
    } catch (err) {
      targetName = null;
    }
  }
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
  // Read before anything is deleted, for the notice only; the write side
  // checks again where it runs.
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
