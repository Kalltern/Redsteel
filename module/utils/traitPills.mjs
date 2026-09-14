import { normalizeTrigger, scopeMatchesTokens } from "./rerolls.mjs";

/**
 * Collect trait reminder pills for a roll.
 *
 * Sources: feature items (option "trait" or "feature") whose
 * system.rollTriggers reach the roll, and currently applied Active Effects
 * carrying triggers in flags.redsteel.rollTriggersRaw.
 *
 * Triggers read like reroll pool scopes (see scopeMatchesTokens in
 * rerolls.mjs): "universal" / "any" / "all" fire on every roll, "str" on the
 * raw Strength test, and "str-based" on every non-combat roll governed by
 * Strength. An empty trigger list fires on nothing.
 *
 * @param {Actor} actor  The rolling actor.
 * @param {string|string[]} tokens  The roll's tokens: "attack" / "defense" for
 *   combat cards, or getRerollTokensForSkill(actor, key) for skill and
 *   attribute rolls (e.g. ["athletics", "strbased"]).
 * @returns {{ name: string, description: string }[]}
 */
export function getTraitPills(actor, tokens) {
  if (!actor) return [];

  const rollTokens = (Array.isArray(tokens) ? tokens : [tokens])
    .map((t) => normalizeTrigger(t))
    .filter(Boolean);
  if (!rollTokens.length) return [];

  const pills = actor.items
    .filter(
      (item) =>
        item.type === "feature" &&
        ["trait", "feature"].includes(item.system.option) &&
        scopeMatchesTokens(item.system.rollTriggers, rollTokens),
    )
    .map((item) => ({
      name: item.localizedName ?? item.name,
      description: item.localizedDescription ?? "",
    }));

  // appliedEffects includes transferred item effects and already excludes
  // disabled/suppressed ones.
  for (const effect of actor.appliedEffects ?? actor.effects) {
    if (
      !scopeMatchesTokens(
        effect.getFlag("redsteel", "rollTriggersRaw"),
        rollTokens,
      )
    )
      continue;

    pills.push({
      name: effect.name,
      description: effect.description ?? "",
    });
  }

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
