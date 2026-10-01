/**
 * Dragon Sleep (Dračí spánek, Servant of the Sword): a one-turn stance.
 *
 * "For one round, Defense, Dodge and Ranged Defense +10%. Gain one Aim and
 * restore 1 Stamina. You cannot use Riposte for one round and give up all
 * your Reactions this round; gain one Rest for each Reaction given up."
 *
 * The stance is the `dragon_sleep` status (config.mjs): the three +10% are
 * its Active Effect changes, and it is gone at the start of the holder's next
 * turn (defaultTurns 1). Taking it up runs takeDragonSleep from the stance
 * branch of combatAbilities.mjs, which settles the rest at once:
 * - every Reaction left this round is spent on the action tracker;
 * - each one is a free Rest, the Rest action's 5 Stamina (otherActions.mjs
 *   restAndRecover), on top of the stance's own 1 Stamina;
 * - one Aim on the user's current target, through the same stack rules as any
 *   other granted Aim; no target, no Aim (the card says so).
 * While it holds, the hotbar offers no Riposte (actionSuggestions.mjs).
 */

import { getActionPools, getSpent, spend, trackedCombat } from "./actionTracker.mjs";
import { grantManeuverAim } from "./aim.mjs";

export const DRAGON_SLEEP_STATUS = "dragon_sleep";
/** Stamina the stance itself restores. */
const OWN_STAMINA = 1;
/** Stamina one Rest restores: the Rest action's amount. */
const REST_STAMINA = 5;

/** Is this actor in Dragon Sleep? */
export function hasDragonSleep(actor) {
  return !!actor?.statuses?.has(DRAGON_SLEEP_STATUS);
}

/**
 * Settle Dragon Sleep's one-off part, right after the stance effect is on.
 *
 * @param {Actor} actor
 */
export async function takeDragonSleep(actor) {
  // The Reactions given up: whatever is left of this round's pool. Outside a
  // tracked encounter there is no pool, so nothing is given up.
  let eaten = 0;
  if (trackedCombat(actor)) {
    eaten = Math.max(
      0,
      getActionPools(actor).reactions - getSpent(actor).reactions,
    );
    if (eaten) await spend(actor, { reactions: eaten });
  }

  const stamina = actor.system.stats?.stamina ?? {};
  const gain = OWN_STAMINA + eaten * REST_STAMINA;
  const current = Number(stamina.value) || 0;
  const max = Number(stamina.max);
  const next = Number.isFinite(max) && max > 0
    ? Math.min(max, current + gain)
    : current + gain;
  if (next !== current) {
    await actor.update({ "system.stats.stamina.value": next });
  }

  const token = actor.isToken
    ? actor.token
    : (actor.getActiveTokens(false, true)?.[0] ?? null);
  const target = game.user.targets?.first?.() ?? null;
  const aimed = !!(token && target && target.document?.id !== token.id);
  if (aimed) await grantManeuverAim(token, target);

  const lines = [
    game.i18n.format("REDSTEEL.Items.DragonSleep.reactionsGiven", { count: eaten }),
    game.i18n.format("REDSTEEL.Items.DragonSleep.staminaGained", {
      amount: next - current,
    }),
    aimed
      ? game.i18n.format("REDSTEEL.Items.DragonSleep.aimGained", {
          target: target.name,
        })
      : game.i18n.localize("REDSTEEL.Items.DragonSleep.noAimTarget"),
  ];
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token }),
    content: `<div style="text-align:center;">${lines.join("<br>")}</div>`,
  });
}
