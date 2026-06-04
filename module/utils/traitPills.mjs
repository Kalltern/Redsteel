/**
 * Collect trait reminder pills for a given roll trigger.
 *
 * @param {Actor}  actor    The rolling actor.
 * @param {string} trigger  A trigger identifier, e.g. "resolve", "fear", "athletics".
 * @returns {{ name: string, description: string }[]}
 */
export function getTraitPills(actor, trigger) {
  if (!actor || !trigger) return [];

  return actor.items
    .filter(
      (item) =>
        item.type === "feature" &&
        item.system.option === "trait" &&
        Array.isArray(item.system.rollTriggers) &&
        item.system.rollTriggers.includes(trigger),
    )
    .map((item) => ({
      name: item.name,
      description: item.system.description ?? "",
    }));
}
