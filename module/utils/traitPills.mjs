import { matchTriggerScope, normalizeTrigger } from "./rerolls.mjs";

/**
 * Collect trait reminder pills for a roll.
 *
 * Sources: feature items (option "trait" or "feature") whose
 * system.rollTriggers reach the roll, and currently applied Active Effects
 * carrying triggers in flags.redsteel.rollTriggersRaw.
 *
 * Triggers read like reroll pool scopes (see matchTriggerScope in
 * rerolls.mjs): "universal" / "any" / "all" fire on every roll, "str" on the
 * raw Strength test, and "str-based" on every non-combat roll governed by
 * Strength. An empty trigger list fires on nothing. Any trigger may take a
 * "-gm" suffix ("universal-gm"): it fires the same, but the pill is marked
 * gmOnly and the chat renderer shows it to the GM alone.
 *
 * @param {Actor} actor  The rolling actor.
 * @param {string|string[]} tokens  The roll's tokens: "attack" / "defense" for
 *   combat cards, or getRerollTokensForSkill(actor, key) for skill and
 *   attribute rolls (e.g. ["athletics", "strbased"]).
 * @param {{ event?: boolean }} [options]  `event: true` for a card that is not
 *   a roll (Long Rest emits "longrest"): only triggers naming the token fire,
 *   so universal triggers and the Fatigued / Corrupted roll reminders stay off.
 * @returns {{ name: string, description: string, gmOnly?: boolean }[]}
 */
export function getTraitPills(actor, tokens, { event = false } = {}) {
  if (!actor) return [];

  const rollTokens = (Array.isArray(tokens) ? tokens : [tokens])
    .map((t) => normalizeTrigger(t))
    .filter(Boolean);
  if (!rollTokens.length) return [];

  const scopeOptions = { universal: !event };
  const pills = [];
  for (const item of actor.items) {
    if (item.type !== "feature") continue;
    if (!["trait", "feature"].includes(item.system.option)) continue;
    const match = matchTriggerScope(
      item.system.rollTriggers,
      rollTokens,
      scopeOptions,
    );
    if (!match) continue;

    pills.push({
      name: item.localizedName ?? item.name,
      description: item.localizedDescription ?? "",
      gmOnly: match.gmOnly,
    });
  }

  // appliedEffects includes transferred item effects and already excludes
  // disabled/suppressed ones.
  for (const effect of actor.appliedEffects ?? actor.effects) {
    const match = matchTriggerScope(
      effect.getFlag("redsteel", "rollTriggersRaw"),
      rollTokens,
      scopeOptions,
    );
    if (!match) continue;

    pills.push({
      name: effect.name,
      description: effect.description ?? "",
      gmOnly: match.gmOnly,
    });
  }

  if (event) return pills;

  // Fatigued (Unavený) reminds on every roll, regardless of trigger: the
  // character is down to a single action and rolls at −5%.
  if (actor.statuses?.has("fatigued")) {
    pills.push({
      name: "Fatigued — 1 action",
      description:
        "Stamina at 0: loses one action (minimum one remains), −5% to every Success roll, and Speed is halved.",
    });
  }

  // Corrupted (Zkažený): from Corruption degree 2 (61+) a character "counts as
  // Corrupted" for miracles/magic, and degree 3 (91+) is also Light-vulnerable.
  // Remind on every defense roll so the GM can apply Light / Miracle riders.
  if (rollTokens.includes("defense") && actor.system?.isCorrupted) {
    pills.push({
      name: "Corrupted — Zkažený",
      description: actor.system.corruptionLightVulnerable
        ? "Counts as Corrupted for Miracles, magic and similar — and is more vulnerable to Light and selected Miracles."
        : "Counts as Corrupted for the purposes of Miracles, magic and similar effects.",
    });
  }

  return pills;
}
