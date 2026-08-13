/**
 * Opportunity attacks: capability guidance + a runtime tag.
 *
 * Two separate layers live in this file.
 *
 * A. Capability layer — pure guidance, nothing is ever blocked.
 *    An ability is a *reaction* when its `system.actionCost` reads "Reaction"
 *    (derived, no new field: the ten pack abilities that are reactions already
 *    say so — Counterattack, Riposte, Retaliatory strike, Cunning Strike,
 *    Shove, Reaction Cast, Drop Prone, Guard, Opportunity Attack).
 *    An ability *may be used as an opportunity attack* when the item carries
 *    `system.opportunityAttack === true`, or when an actor-level permission in
 *    OPPORTUNITY_PERMISSIONS below unlocks it (today only Pikeman doctrine 8,
 *    which turns Reckless strike into a legal opportunity attack).
 *    Normal weapon attacks — the Attack Actions dialog — are always
 *    opportunity-capable; no ability item is involved there, so nothing to flag.
 *    `abilityUsageFit` turns all of that into one short line of advice, which
 *    the combat abilities dialog uses to dim (never disable) a row whose timing
 *    looks wrong. Timing is a table ruling, so the row stays fully clickable.
 *
 * B. Runtime tag layer — for buffs that key on "this attack was an opportunity
 *    attack". The dialogs declare the intent as the actor flag
 *    `flags.redsteel.useOpportunityAttack`; it is consumed exactly once at roll
 *    time (`consumeOpportunityFlag`) and re-surfaces on the attack chat card as
 *    `flags.redsteel.attackTags: ["opportunity"]` plus a visible chip.
 *    The tag grants no bonus by itself.
 */

import { ruleActive } from "./abilityGrants.mjs";

/** Ability compendium UUID from a bare item id. */
const A = (id) => `Compendium.redsteel.redsteel-items.Item.${id}`;

/**
 * Abilities a trigger unlocks for use as an opportunity attack.
 * Matched by compendium source first, by English item name as a fallback for
 * copies that lost `_stats.compendiumSource`.
 */
const OPPORTUNITY_PERMISSIONS = [
  {
    label: "Pikeman 8 → Reckless strike may be used as an opportunity attack",
    when: { kind: "doctrine", key: "pikeman", min: 8 },
    uuids: [A("CKSRdqAvrm7SOqCs"), A("0YDsI6HYQ31hAWHp")],
    names: ["Reckless strike", "Reckless strike (Reaver)"],
  },
];

/** Does this permission rule name the given ability? */
function ruleMatchesAbility(rule, ability) {
  return !!(
    rule.uuids?.includes(ability?._stats?.compendiumSource) ||
    rule.names?.includes(ability?.name)
  );
}

/** True if this ability is a retaliatory/reaction action (Counterattack, Riposte, …). */
export function isReactionAbility(ability) {
  return /reaction/i.test(String(ability?.system?.actionCost ?? ""));
}

/** True if the actor may use this ability as an opportunity attack. */
export function canBeOpportunityAttack(actor, ability) {
  if (!ability) return false;
  if (ability.system?.opportunityAttack === true) return true;
  return OPPORTUNITY_PERMISSIONS.some(
    (rule) => ruleMatchesAbility(rule, ability) && ruleActive(actor, rule),
  );
}

/**
 * Is this actor the combatant whose turn is currently running?
 * False outside combat and for actors that are not in the encounter, so the
 * attack dialogs keep offering the opportunity toggle when there is no turn
 * order to contradict it.
 */
export function isOwnTurn(actor, token = null) {
  const combat = game.combat;
  if (!combat?.started) return false;
  const combatant = token?.id
    ? combat.getCombatantByToken(token.id)
    : combat.combatants.contents.find((c) => c.actorId === actor?.id);
  if (!combatant) return false;
  return combat.combatant?.id === combatant.id;
}

/**
 * Timing guidance for one ability. Returns null when there is nothing to say
 * (no active combat, or the actor is not a combatant) — callers must not dim
 * anything in that case.
 * @param {Actor} actor
 * @param {Item} ability
 * @param {Token|TokenDocument|null} token
 * @returns {null | {fit: "ok"} | {fit: "reaction", reason: string} | {fit: "turnAction", reason: string}}
 */
export function abilityUsageFit(actor, ability, token = null) {
  const combat = game.combat;
  if (!combat?.started) return null;
  const combatant = token?.id
    ? combat.getCombatantByToken(token.id)
    : combat.combatants.contents.find((c) => c.actorId === actor?.id);
  if (!combatant) return null;

  const offTurn = combat.combatant?.id !== combatant.id;
  const reaction = isReactionAbility(ability);

  if (!offTurn && reaction) {
    return {
      fit: "reaction",
      reason: "Reaction — normally used outside your turn.",
    };
  }

  if (offTurn && !reaction && !canBeOpportunityAttack(actor, ability)) {
    return {
      fit: "turnAction",
      reason:
        "Turn action — normally used on your own turn, not as a reaction or opportunity attack.",
    };
  }

  return { fit: "ok" };
}

/** Read and clear the one-shot opportunity declaration. */
export async function consumeOpportunityFlag(actor) {
  if (!actor) return false;
  const declared = !!actor.getFlag("redsteel", "useOpportunityAttack");
  if (declared) await actor.unsetFlag("redsteel", "useOpportunityAttack");
  return declared;
}

/** Human label for a runtime attack tag. */
const ATTACK_TAG_LABELS = {
  opportunity: "Opportunity Attack",
};

/** Chat-card chip for the tags on an attack. */
export function renderAttackTagsHtml(tags = []) {
  if (!tags?.length) return "";
  return tags
    .map((tag) => {
      const key = String(tag ?? "");
      const label =
        ATTACK_TAG_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
      return `<span class="rs-attack-tag">${label}</span>`;
    })
    .join("");
}
