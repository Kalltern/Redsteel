/**
 * Normalize a trigger for comparison: lowercase, strip everything that
 * isn't a letter or digit. Item sheets store triggers lowercased
 * ("animalhandling") while skill keys are camelCase ("animalHandling"),
 * so "firstAid", "first aid", "first-aid" and "firstaid" must all match.
 */
function normalizeTrigger(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Parse a comma-separated trigger string into normalized triggers. */
function parseTriggerList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => normalizeTrigger(s))
    .filter(Boolean);
}

/**
 * Collect trait reminder pills for a given roll trigger.
 *
 * Sources: feature items (option "trait" or "feature") with matching
 * system.rollTriggers, and currently applied Active Effects carrying
 * triggers in flags.redsteel.rollTriggersRaw.
 *
 * @param {Actor}  actor    The rolling actor.
 * @param {string} trigger  A trigger identifier, e.g. "resolve", "fear", "athletics".
 * @returns {{ name: string, description: string }[]}
 */
export function getTraitPills(actor, trigger) {
  if (!actor || !trigger) return [];

  const normalized = normalizeTrigger(trigger);
  if (!normalized) return [];

  const pills = actor.items
    .filter(
      (item) =>
        item.type === "feature" &&
        ["trait", "feature"].includes(item.system.option) &&
        Array.isArray(item.system.rollTriggers) &&
        item.system.rollTriggers.some(
          (t) => normalizeTrigger(t) === normalized,
        ),
    )
    .map((item) => ({
      name: item.name,
      description: item.system.description ?? "",
    }));

  // appliedEffects includes transferred item effects and already excludes
  // disabled/suppressed ones.
  for (const effect of actor.appliedEffects ?? actor.effects) {
    const triggers = parseTriggerList(
      effect.getFlag("redsteel", "rollTriggersRaw"),
    );
    if (!triggers.includes(normalized)) continue;

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

  return pills;
}
