/**
 * Hraničář (Ranger) → Útok dravce (Predator's Attack), specializace-wip.md
 * r316. Volná akce, Výdrž 3.
 *
 * "Zabije-li oponenta útokem (Souboj), může okamžitě přezbrojit a vystřelit
 * nebo použít akci Přebíjení (Jednoruční a Lehká kuše) či Rychlé přebíjení
 * (Těžká a Trpasličí kuše)."
 *
 * - The chance is stamped by Apply Damage (applyDamage.mjs, on the GM), the
 *   Half Pirouette pattern: a Melee attack card whose Apply Damage left a
 *   target with the `dead` status. One chance per card. Own turn only: the
 *   free shot is the plain Attack's free grant (actionTracker.mjs
 *   grantFreeAttack), which is an own-turn grant, as for the Skirmisher's
 *   Follow-up Throw.
 * - The hotbar offers a chip for the rest of that turn (actionSuggestions.mjs).
 *   Using the ability, from the chip or the sheet, runs usePredatorsAttack;
 *   with nothing pending it refuses with a notification.
 * - Use: refused before anything is paid when the actor carries no bow or
 *   crossbow. The player picks the bow or crossbow (or keeps one already in
 *   hand) and, for a crossbow, Shoot or Reload; then the item's Stamina is
 *   paid, the re-arm is free (rearm.mjs swapMainWeapon), and Shoot makes the
 *   next Attack this turn a Free action while Reload makes the next use of
 *   the Reload ability a Free action (grantFreeAbility).
 * - The system has no Quick Reload (Rychlé přebíjení) ability, so a heavy or
 *   dwarven crossbow gets the plain Reload too.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import {
  grantFreeAbility,
  grantFreeAttack,
  isTrackedTurn,
  trackedCombat,
} from "./actionTracker.mjs";
import { notePaidStamina } from "./enduringWarrior.mjs";
import { isRangedWeapon } from "./makeshift.mjs";
import { tokenForActor } from "./movementZones.mjs";
import {
  mainHandWeapon,
  pickRearmWeapon,
  rearmCandidates,
  swapMainWeapon,
} from "./rearm.mjs";

const SYSTEM_ID = "redsteel";
/** Actor flag: the pending chance, stamped with its turn. */
const FLAG = "predatorsAttack";
/** Card flag: this card already offered a Predator's Attack. */
const OFFERED_FLAG = "predatorsAttackOffered";
export const PREDATORS_ATTACK_KEY = "REDSTEEL.Items.PredatorsAttack.name";
/** The ability a free Reload is granted for (Base abilities, "Reload"). */
const RELOAD_KEY = "REDSTEEL.Items.Reload.name";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.PredatorsAttack.${key}`, data)
    : game.i18n.localize(`REDSTEEL.PredatorsAttack.${key}`);

/** Is this the Predator's Attack ability (by key, or the pack's English name)? */
export function isPredatorsAttack(ability) {
  return (
    ability?.system?.localizationKey === PREDATORS_ATTACK_KEY ||
    ability?.name === "Predator's Attack"
  );
}

function turnStamp(combat) {
  return { id: combat.id, round: combat.round, turn: combat.turn };
}

/**
 * The Predator's Attack this actor may still make: stamped this very turn of
 * the running encounter. Null otherwise.
 *
 * @param {Actor} actor
 * @returns {{messageId: string, killedTokenId: string}|null}
 */
export function pendingPredatorsAttack(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, FLAG);
  const combat = game.combat;
  if (!stored || !combat?.started) return null;
  const stamp = stored.combat ?? {};
  if (
    stamp.id !== combat.id ||
    Number(stamp.round) !== Number(combat.round) ||
    Number(stamp.turn) !== Number(combat.turn)
  ) {
    return null;
  }
  return stored;
}

/**
 * Apply Damage landed: stamp the attacker's Predator's Attack when a Melee
 * card killed someone on the attacker's own turn. Runs on the GM client
 * applying the damage, which may write the attacker and the card.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message   the attack card
 * @param {string[]} killedIds    token ids this Apply Damage left dead
 */
export async function offerPredatorsAttack(attacker, message, killedIds = []) {
  if (!attacker || !message) return;
  if (!actorHasSpecNode(attacker, "ranger", "utokDravce")) return;
  if (!attacker.items.some((i) => i.type === "ability" && isPredatorsAttack(i))) {
    return;
  }
  const combat = trackedCombat(attacker);
  if (!combat || !isTrackedTurn(attacker)) return;
  if (message.getFlag(SYSTEM_ID, OFFERED_FLAG)) return;
  const melee = !["ranged", "throwing", "magic"].includes(
    message.flags?.attack?.attackType,
  );
  if (!melee) return;
  const selfId = message.speaker?.token ?? null;
  const killed = killedIds.find((id) => id && id !== selfId) ?? null;
  if (!killed) return;

  await message.setFlag(SYSTEM_ID, OFFERED_FLAG, true);
  await attacker.setFlag(SYSTEM_ID, FLAG, {
    messageId: message.id,
    killedTokenId: killed,
    combat: turnStamp(combat),
  });
}

/** Shoot, or (a crossbow only) Reload. Null when the dialog is dismissed. */
async function pickShootOrReload(weapon, title) {
  if (weapon?.system?.class !== "crossbow") return "shoot";
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title },
    classes: ["redsteel"],
    content: `<p>${L("ChoicePrompt")}</p>`,
    buttons: [
      { action: "shoot", label: L("Shoot"), default: true },
      { action: "reload", label: L("Reload") },
    ],
    rejectClose: false,
  });
  return picked === "shoot" || picked === "reload" ? picked : null;
}

/**
 * Use Predator's Attack on the pending chance. Always handles the click
 * (true): with nothing pending, or nothing to shoot with, it refuses with a
 * notification instead of posting the plain card.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function usePredatorsAttack(actor, ability) {
  const pending = pendingPredatorsAttack(actor);
  if (!pending) {
    ui.notifications.warn(L("NothingPending"));
    return true;
  }
  const title = ability.localizedName ?? ability.name;
  const main = mainHandWeapon(actor);
  const keep = isRangedWeapon(main);
  const candidates = rearmCandidates(actor).filter(isRangedWeapon);
  if (!candidates.length && !keep) {
    ui.notifications.warn(L("NoRanged"));
    return true;
  }

  // Every choice is made before anything is paid, so backing out of a
  // dialog costs nothing.
  const picked = candidates.length
    ? await pickRearmWeapon(candidates, {
        title,
        prompt: L("Prompt"),
        confirmLabel: L("Confirm", { cost: Number(ability.system?.cost) || 0 }),
        keepLabel: keep ? L("Keep") : null,
      })
    : "keep";
  if (!picked) return true;
  const weapon = picked === "keep" ? main : picked;
  const choice = await pickShootOrReload(weapon, title);
  if (!choice) return true;

  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return true;
  // The Stamina paid here is not the free shot's (Enduring Warrior).
  notePaidStamina(actor, 0);
  await actor.unsetFlag(SYSTEM_ID, FLAG);
  if (picked !== "keep") await swapMainWeapon(actor, picked.id);

  if (choice === "shoot") {
    // grantFreeAttack needs some id to hold the grant; nothing reads it back.
    const self = tokenForActor(actor);
    await grantFreeAttack(actor, self?.id || actor.id);
  } else {
    await grantFreeAbility(actor, { keys: [RELOAD_KEY] });
  }

  const token = tokenForActor(actor);
  const line = L(choice === "shoot" ? "ReadyShoot" : "ReadyReload", {
    name: esc(actor.name),
    weapon: esc(weapon?.localizedName ?? weapon?.name ?? ""),
  });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
    flavor: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
<p style="text-align:center;">${line}</p>`,
  });
  return true;
}
