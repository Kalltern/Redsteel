/**
 * Hraničář (Ranger) → Zášť (Grudge), specializace-wip.md r312.
 *
 * "Začíná souboj s jedním Mířením na vybraném nepříteli. Toto Míření
 * přetrvává, dokud je cíl Zášti naživu. Jakmile je cíl zabit, může si zvolit
 * nový cíl." Volná akce, Výdrž 2 / 5.
 *
 * User rulings 2026-10-22:
 * - Declared in the first round of the encounter for 2 Stamina, on the one
 *   targeted enemy. Once the Grudge target is dead a new one may be picked at
 *   any time for 5 Stamina. Any other time the ability is refused.
 * - The Aim is a floor, not a bonus: while the target lives the ranger always
 *   holds at least one Aim on it. Spending or breaking the aim leaves that
 *   stack behind, and an aim moved onto another target snaps back to the
 *   Grudge once that aim is gone. The floor itself is aim.mjs clearAim.
 * - It lasts the encounter: deleting the combat drops the flag.
 *
 * The Grudge lives on the ranger's token (`flags.redsteel.grudge`), next to
 * the aim flag it props up.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { applyGrudgeFloor, GRUDGE_FLAG, livingGrudgeTarget } from "./aim.mjs";
import { tokenForActor } from "./movementZones.mjs";

const SYSTEM_ID = "redsteel";
export const GRUDGE_KEY = "REDSTEEL.Items.Grudge.name";
/** Stamina to declare the Grudge at the start of the encounter. */
const DECLARE_COST = 2;
/** Stamina to pick a new Grudge once the old target is dead. */
const REPICK_COST = 5;

/** Is this the Grudge ability (by key, or the pack's English name)? */
export function isGrudge(ability) {
  return (
    ability?.system?.localizationKey === GRUDGE_KEY ||
    ability?.name === "Grudge"
  );
}

/**
 * What the Grudge may do right now, or null when it may do nothing: the
 * hotbar chip and useGrudge both read this.
 *   "declare": no Grudge yet in this encounter and it is still round 1.
 *   "repick":  the Grudge target is dead (or gone from the scene).
 *
 * @param {Actor} actor
 * @returns {{kind: "declare"|"repick", cost: number}|null}
 */
export function grudgeState(actor) {
  if (!actorHasSpecNode(actor, "ranger", "zast")) return null;
  const combat = game.combat;
  const token = tokenForActor(actor);
  if (!combat?.started || !token) return null;
  if (!combat.combatants.contents.some((c) => c.tokenId === token.id)) {
    return null;
  }

  const grudge = token.document.getFlag(SYSTEM_ID, GRUDGE_FLAG);
  if (!grudge?.targetId || grudge.combatId !== combat.id) {
    return combat.round <= 1 ? { kind: "declare", cost: DECLARE_COST } : null;
  }
  if (!livingGrudgeTarget(token.document)) {
    return { kind: "repick", cost: REPICK_COST };
  }
  return null;
}

/**
 * Use Grudge on the targeted enemy. Always handles the click (true): a
 * refusal is a notification, not a fall-through to the plain card.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function useGrudge(actor, ability) {
  const state = grudgeState(actor);
  if (!state) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Grudge.Refused"));
    return true;
  }
  const token = tokenForActor(actor);
  const targets = [...(game.user?.targets ?? [])].filter(
    (t) => t.id !== token.id,
  );
  const target = targets.length === 1 ? targets[0] : null;
  if (!target || target.actor?.statuses?.has("dead")) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Grudge.NeedTarget"));
    return true;
  }

  // The item carries the declaration price; a new Grudge costs more.
  const priced =
    Number(ability.system.cost) === state.cost
      ? ability
      : ability.clone({ "system.cost": state.cost }, { keepId: true });
  if (!(await game.redsteel.deductAbilityCost(actor, [priced]))) return true;

  await token.document.setFlag(SYSTEM_ID, GRUDGE_FLAG, {
    targetId: target.id,
    combatId: game.combat.id,
  });
  const placed = await applyGrudgeFloor(token.document);

  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const label = ability.localizedName ?? ability.name;
  const line = game.i18n.format(
    placed ? "REDSTEEL.Grudge.DeclaredAim" : "REDSTEEL.Grudge.Declared",
    { name: esc(actor.name), target: esc(target.name), cost: state.cost },
  );
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token.document }),
    flavor: `<p class="rs-card-headline"><b>${esc(label)}</b></p>
<p style="text-align:center;">${line}</p>`,
  });
  return true;
}

/**
 * A Grudge lasts the encounter: when the combat is deleted, the active GM
 * drops the flag from every token that fought in it.
 */
export function registerRangerHooks() {
  Hooks.on("deleteCombat", async (combat) => {
    if (game.users.activeGM?.id !== game.user.id) return;
    for (const combatant of combat.combatants.contents) {
      const doc = combatant.token;
      if (doc?.getFlag(SYSTEM_ID, GRUDGE_FLAG)?.combatId === combat.id) {
        await doc.unsetFlag(SYSTEM_ID, GRUDGE_FLAG);
      }
    }
  });
}
