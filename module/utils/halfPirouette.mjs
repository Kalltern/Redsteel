/**
 * Half Pirouette (Půlpirueta). Granted by Swordsman 4, Dimakerus 6, Duelist 9
 * and Monk 9 (abilityGrants.mjs). Free action, its Stamina paid on use.
 *
 * "If you kill an enemy with any attack, immediately move into their space
 * and gain Aim on a target within reach. After a successful Counterattack or
 * Riposte, immediately move one hex around the target and gain Aim on a
 * target within reach. If you kill an enemy with a Counterattack or Riposte,
 * immediately move into their space and gain two Aim on a target within
 * reach. This movement does not trigger an Opportunity Attack."
 *
 * - The chance is stamped by Apply Damage (applyDamage.mjs, on the GM), the
 *   Slip Through pattern: "successful" = the damage was applied, "kill" = the
 *   victim ended that Apply Damage with the `dead` status. Only melee cards
 *   count for a kill (a ranged kill has no space to step into); one chance
 *   per card, so re-applying the card offers nothing new.
 * - The hotbar offers a Half Pirouette chip for the rest of that turn
 *   (actionSuggestions.mjs). Using the ability, from the chip or the sheet,
 *   runs useHalfPirouette instead of the plain card.
 * - Kill: the token is placed on the victim's hex (a corpse does not block,
 *   forcedMovement.mjs occupantAt). A teleport provokes nothing.
 * - Counterattack or Riposte without a kill: a one-hex bonus step that must
 *   stay next to the opponent, `free` so it provokes nothing
 *   (movementZones.mjs `halfPirouette`), walked off-turn like Quick Feet.
 * - Aim: the targeted token when it is a living enemy within reach of where
 *   the move ends, else the only such enemy, else the player picks. On a
 *   Counterattack or Riposte without a kill that is normally the opponent,
 *   whom the step keeps in reach.
 */

import { grantBonusStep } from "./actionTracker.mjs";
import { teleportToken } from "./forcedMovement.mjs";
import {
  isHostileSide,
  tokenForActor,
  tokenMovementSpent,
} from "./movementZones.mjs";
import { grantAimStacks } from "./aim.mjs";
import { resolveWeaponContext } from "./weaponResolver.mjs";

const SYSTEM_ID = "redsteel";
const FLAG = "halfPirouette";
export const HALF_PIROUETTE_KEY = "REDSTEEL.Items.HalfPirouette.name";
const COUNTERATTACK_KEY = "REDSTEEL.Items.Counterattack.name";
const RIPOSTE_KEY = "REDSTEEL.Items.Riposte.name";

/** A creature in one of these is no target to aim at. */
const FALLEN_STATUSES = ["dead", "dying", "downed", "unconscious"];

/** Is this the Half Pirouette ability (by key, or the pack's English name)? */
export function isHalfPirouette(ability) {
  return (
    ability?.system?.localizationKey === HALF_PIROUETTE_KEY ||
    ability?.name === "Half Pirouette"
  );
}

/** Was this attack card a Counterattack or a Riposte? */
function cardIsCounter(message) {
  const key = message?.flags?.redsteel?.abilityKey ?? null;
  const name = message?.flags?.redsteel?.abilityName ?? null;
  return (
    key === COUNTERATTACK_KEY ||
    key === RIPOSTE_KEY ||
    name === "Counterattack" ||
    name === "Riposte"
  );
}

function turnStamp(combat) {
  return { id: combat.id, round: combat.round, turn: combat.turn };
}

/**
 * The Half Pirouette this actor may still make: stamped this very turn of
 * the running encounter, with its token still on the canvas. A step around
 * also needs the opponent alive. Null otherwise.
 *
 * @param {Actor} actor
 * @returns {{messageId: string, kind: "kill"|"counter"|"counterKill",
 *   targetTokenId: string, target: Token}|null}
 */
export function pendingHalfPirouette(actor) {
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
  const target = canvas.tokens?.get(stored.targetTokenId);
  if (!target) return null;
  if (stored.kind === "counter" && target.actor?.statuses?.has("dead")) return null;
  return { ...stored, target };
}

/**
 * Apply Damage landed: stamp the attacker's Half Pirouette when the card
 * killed someone (melee only) or was a Counterattack or Riposte. Runs on the
 * GM client applying the damage, which may write the attacker and the card.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message   the attack card
 * @param {string[]} targetIds    token ids the damage landed on
 * @param {string[]} killedIds    of those, the ones now dead
 */
export async function offerHalfPirouette(attacker, message, targetIds, killedIds) {
  if (!attacker || !message) return;
  const combat = game.combat;
  if (!combat?.started) return;
  if (!attacker.items.some((i) => i.type === "ability" && isHalfPirouette(i))) return;
  // One chance per card: the GM re-applying it must not hand out another.
  if (message.getFlag(SYSTEM_ID, "halfPirouetteOffered")) return;

  const selfId = message.speaker?.token ?? null;
  const counter = cardIsCounter(message);
  const melee = !["ranged", "throwing", "magic"].includes(
    message.flags?.attack?.attackType,
  );
  const killed = melee ? killedIds.find((id) => id && id !== selfId) : null;

  let kind = null;
  let targetTokenId = null;
  if (killed) {
    kind = counter ? "counterKill" : "kill";
    targetTokenId = killed;
  } else if (counter) {
    targetTokenId = targetIds.find((id) => id && id !== selfId) ?? null;
    if (targetTokenId) kind = "counter";
  }
  if (!kind) return;

  await message.setFlag(SYSTEM_ID, "halfPirouetteOffered", true);
  await attacker.setFlag(SYSTEM_ID, FLAG, {
    messageId: message.id,
    kind,
    targetTokenId,
    combat: turnStamp(combat),
  });
}

/** Hexes between two points, along the grid. */
function hexDistance(a, b) {
  const path = canvas.grid.getDirectPath([a, b]);
  return Math.max(0, (path?.length ?? 1) - 1);
}

/**
 * How far the actor reaches: two hexes with a Long Reach weapon, else one.
 * Resolved like the suggestion strip's `hasLongReach` (actionSuggestions.mjs).
 */
function reachOf(actor) {
  if (resolveWeaponContext(actor)?.weapon?.system?.longReach) return 2;
  if (
    actor.type !== "character" &&
    actor.items.some((i) => i.type === "weapon" && i.system?.longReach)
  ) {
    return 2;
  }
  return 1;
}

/**
 * Living enemies within reach of `point`, nearest first. Enemies = the other
 * side by isHostileSide (movementZones.mjs), which keeps PCs on the party's
 * side whatever their disposition.
 */
function aimCandidates(actor, token, point) {
  const reach = reachOf(actor);
  const hostile = isHostileSide(token.document);
  return (canvas.tokens?.placeables ?? [])
    .filter((t) => {
      if (t === token || !t.actor) return false;
      if (!t.visible && !game.user.isGM) return false;
      if (FALLEN_STATUSES.some((s) => t.actor.statuses?.has(s))) return false;
      return isHostileSide(t.document) !== hostile;
    })
    .map((t) => ({ token: t, distance: hexDistance(point, t.center) }))
    .filter((c) => c.distance >= 1 && c.distance <= reach)
    .sort((a, b) => a.distance - b.distance)
    .map((c) => c.token);
}

/**
 * Who the Aim goes on: the targeted token when it qualifies, the only
 * candidate, or the player's pick. Null with nobody in reach or the pick
 * dismissed.
 */
async function pickAimTarget(candidates, label) {
  if (!candidates.length) return null;
  const targeted = game.user?.targets?.first?.() ?? null;
  if (targeted && candidates.includes(targeted)) return targeted;
  if (candidates.length === 1) return candidates[0];

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: label },
    content: `<p>${game.i18n.localize("REDSTEEL.HalfPirouette.PickPrompt")}</p>`,
    buttons: candidates.map((t, n) => ({
      action: t.id,
      label: t.name,
      default: n === 0,
    })),
    rejectClose: false,
  });
  return candidates.find((t) => t.id === picked) ?? null;
}

/**
 * Use Half Pirouette on the pending chance. Returns false when nothing is
 * pending, so the caller runs the ability's plain card instead.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function useHalfPirouette(actor, ability) {
  const pending = pendingHalfPirouette(actor);
  if (!pending) return false;
  const token = tokenForActor(actor);
  if (!token) return false;
  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return true;
  await actor.unsetFlag(SYSTEM_ID, FLAG);

  const target = pending.target;
  const label = ability.localizedName ?? ability.name;
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const lines = [];
  let from = token.center;

  if (pending.kind === "counter") {
    const combat = game.combat;
    await grantBonusStep(actor, {
      mode: "halfPirouette",
      budget: 1,
      startSpent: tokenMovementSpent(token),
      source: `halfPirouette.${combat?.id}.${pending.messageId}`,
      around: target.id,
    });
    lines.push(
      game.i18n.format("REDSTEEL.HalfPirouette.Step", {
        name: esc(actor.name),
        target: esc(target.name),
      }),
    );
  } else {
    const point = target.center;
    const moved = await teleportToken(token.document, point);
    if (moved) from = point;
    lines.push(
      game.i18n.format(
        moved ? "REDSTEEL.HalfPirouette.MovedIn" : "REDSTEEL.HalfPirouette.Blocked",
        { name: esc(actor.name), target: esc(target.name) },
      ),
    );
  }

  const stacks = pending.kind === "counterKill" ? 2 : 1;
  const aimTarget = await pickAimTarget(
    aimCandidates(actor, token, from),
    label,
  );
  if (aimTarget) {
    const { after } = await grantAimStacks(token, aimTarget, stacks);
    lines.push(
      game.i18n.format("REDSTEEL.HalfPirouette.Aim", {
        name: esc(actor.name),
        stacks,
        target: esc(aimTarget.name),
        after,
      }),
    );
  } else {
    lines.push(game.i18n.localize("REDSTEEL.HalfPirouette.NoAimTarget"));
  }

  const flavor = `<p class="rs-card-headline"><b>${esc(label)}</b></p>
${lines.map((l) => `<p style="text-align:center;">${l}</p>`).join("")}`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token.document }),
    flavor,
  });
  return true;
}
