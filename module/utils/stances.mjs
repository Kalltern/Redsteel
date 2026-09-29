/**
 * Maintained stances (Postoje): Defensive Stance and anything else authored as
 * an ability with `class: "stance"` and a per-round upkeep (`system.perRound`).
 *
 * A stance is ruled by its holder's TURNS, not by the round counter (user
 * ruling 2026-09-29). Taking it up pays the ability's cost as usual. From then
 * on, each of the holder's own turns asks again: the hotbar's suggestion strip
 * offers Hold (the ability's action cost plus the upkeep) and Drop (the same
 * icon, shaded red). A turn that ends without Hold drops the stance, because
 * "maintaining the stance requires two actions" and those were never spent.
 *
 * The turn a stance was paid for is stamped on the effect itself
 * (`flags.redsteel.stanceHeld = {combat, round}`). One turn per combatant per
 * round, so the round number names the turn; a stamp from another combat or
 * round simply reads as "not held yet", nothing is ever reset.
 *
 * Replaces the old `staminaDrain` onRoundStart trigger, which charged every
 * stance holder at the round rollover whether or not their turn had come.
 */

import { trackedCombat } from "./actionTracker.mjs";
import { resourceLabel } from "./itemResources.mjs";
import { hasHtmlContent } from "./chatBlocks.mjs";
import { parseActionCost } from "./spellbook.mjs";

const SYSTEM_ID = "redsteel";
const HELD_FLAG = "stanceHeld";
const ABILITY_FLAG = "stanceAbilityId";

/**
 * The stance ability behind this effect: the one recorded when it was taken
 * up, else the actor's stance ability whose key is one of the effect's
 * statuses (a status toggled by hand from the HUD). When several share a key
 * (Defensive Stance and its Shieldbearer upgrade), the doctrine copy wins.
 *
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @returns {Item|null}
 */
export function stanceAbilityFor(actor, effect) {
  const recorded = actor.items.get(effect.getFlag?.(SYSTEM_ID, ABILITY_FLAG));
  if (recorded) return recorded;
  const matches = actor.items.filter(
    (i) =>
      i.type === "ability" &&
      i.system?.class === "stance" &&
      i.system?.key &&
      effect.statuses?.has(i.system.key),
  );
  return (
    matches.find((i) => i.system?.category === "doctrine") ?? matches[0] ?? null
  );
}

/** A per-round upkeep worth asking for: a positive number or a dice formula. */
function hasUpkeep(ability) {
  const raw = ability?.system?.perRound;
  if (typeof raw === "string" && /d/i.test(raw)) return true;
  return (Number(raw) || 0) > 0;
}

/**
 * Every stance this actor is holding that costs upkeep, with its ability.
 *
 * @param {Actor} actor
 * @returns {{effect: ActiveEffect, ability: Item}[]}
 */
export function maintainedStances(actor) {
  const out = [];
  for (const effect of actor?.effects?.contents ?? []) {
    if (!effect.statuses?.size) continue;
    const ability = stanceAbilityFor(actor, effect);
    if (ability && hasUpkeep(ability)) out.push({ effect, ability });
  }
  return out;
}

/**
 * Was this stance paid for in the given round of this combat (taken up or
 * held)?
 *
 * @param {ActiveEffect} effect
 * @param {Combat} combat
 * @param {number} [round]  Defaults to the combat's current round.
 */
export function isStanceHeld(effect, combat, round = combat?.round) {
  const stamp = effect?.getFlag?.(SYSTEM_ID, HELD_FLAG);
  if (!stamp || !combat) return false;
  return stamp.combat === combat.id && Number(stamp.round) === Number(round);
}

/**
 * Stamp the stance as paid for this round, and remember which ability it came
 * from. Outside a tracked encounter only the ability is recorded: there are no
 * turns to pay in, and the first turn of a fight asks.
 *
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @param {Item} ability
 */
export async function markStanceHeld(actor, effect, ability) {
  if (!effect) return;
  const combat = trackedCombat(actor);
  const update = { [`flags.${SYSTEM_ID}.${ABILITY_FLAG}`]: ability?.id ?? null };
  if (combat) {
    update[`flags.${SYSTEM_ID}.${HELD_FLAG}`] = {
      combat: combat.id,
      round: combat.round,
    };
  }
  await effect.update(update);
}

/** The upkeep as a number, rolling a dice formula ("1d4") fresh each time. */
async function rollUpkeep(ability) {
  const raw = ability.system.perRound;
  if (typeof raw === "string" && /d/i.test(raw)) {
    return (await new Roll(raw).evaluate()).total;
  }
  return Math.max(0, Number(raw) || 0);
}

/**
 * The "Hold" chip's line: what holding costs, e.g. "2 Actions, 1 Stamina".
 *
 * @param {Item} ability
 * @returns {string}
 */
export function holdCostLabel(ability) {
  const parts = [];
  const actions = Number(parseActionCost(ability.system.actionCost).actions) || 0;
  if (actions > 0) {
    parts.push(
      game.i18n.localize(
        actions >= 2
          ? "REDSTEEL.Bg3Hotbar.Suggest.TwoActions"
          : "REDSTEEL.Bg3Hotbar.Suggest.OneAction",
      ),
    );
  }
  parts.push(
    `${ability.system.perRound} ${resourceLabel(ability.system.costType || "stamina")}`,
  );
  return parts.join(", ");
}

/**
 * Pay this turn's upkeep: the stance's action cost through the tracker and the
 * per-round amount from its pool, through deductAbilityCost so validation,
 * fatigue direction and the pips all behave as for any other ability. Not
 * enough left to pay drops the stance, as running dry always has.
 *
 * @param {Actor} actor
 * @param {string} effectId
 * @returns {Promise<boolean>} Whether the stance is still held.
 */
export async function holdStance(actor, effectId) {
  const effect = actor?.effects.get(effectId);
  if (!effect) return false;
  const ability = stanceAbilityFor(actor, effect);
  if (!ability) return false;

  const upkeep = await rollUpkeep(ability);
  // The stance's own cost line, with the upkeep standing in for the entry
  // cost and no extra resources: what holding it for one more turn costs.
  const upkeepItem = {
    system: {
      costType: ability.system.costType || "stamina",
      cost: upkeep,
      resources: [],
      actionCost: ability.system.actionCost,
    },
  };
  const paid = await game.redsteel.deductAbilityCost(actor, [upkeepItem]);
  if (!paid) {
    await dropStance(actor, effectId);
    return false;
  }

  await markStanceHeld(actor, effect, ability);
  await postStanceCard(actor, ability, "held");
  return true;
}

/**
 * Let the stance go. Free, as turning it off from the Combat Abilities dialog
 * always has been.
 *
 * @param {Actor} actor
 * @param {string} effectId
 */
export async function dropStance(actor, effectId) {
  const effect = actor?.effects.get(effectId);
  if (!effect) return;
  const ability = stanceAbilityFor(actor, effect);
  await effect.delete();
  if (ability) await postStanceCard(actor, ability, "dropped");
}

/**
 * The stance chat card: taken up (with the ability's prose), held for another
 * turn, or dropped.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {"taken"|"held"|"dropped"} state
 */
export async function postStanceCard(actor, ability, state) {
  const label = ability.localizedName ?? ability.name;
  const status = game.i18n.localize(`REDSTEEL.Items.Stance.${state}`);
  const description =
    state === "taken" ? (ability.localizedDescription ?? "") : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong>${label}</strong>
</span>
<hr>
<div style="text-align:center; font-size:16px;">
  <strong>${status}</strong>
  ${
    hasHtmlContent(description)
      ? `<div style="font-size:14px; opacity:0.8;">${description}</div>`
      : ""
  }
</div>
`,
  });
}

/**
 * A turn ended without the stance being held: it lapses. Only a forward step
 * counts (a GM stepping the tracker back must not strip anyone), and only the
 * active GM writes, so it happens once.
 *
 * `combatTurnChange(combat, prior, current)` fires on every client after the
 * Combat update; `prior`/`current` are CombatHistoryData (round, turn,
 * combatantId, tokenId).
 */
export function registerStanceHooks() {
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
    for (const { effect, ability } of maintainedStances(actor)) {
      if (isStanceHeld(effect, combat, prior.round)) continue;
      await effect.delete();
      await postStanceCard(actor, ability, "dropped");
    }
  });
}
