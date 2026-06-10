/**
 * Trait-granted status effects.
 *
 * A "trait" feature item (system.option === "trait") may list status effect
 * ids in system.statusEffects (parsed from the comma-separated
 * statusEffectsRaw). When a token is deployed for an actor that owns such
 * traits, those status effects are applied to the token's actor.
 *
 * Application goes through the system's own `game.redsteel.applyEffect`, so the
 * resulting effects are set up identically to normally-applied statuses
 * (flags.core.statusId, changes, counters). This keeps them compatible with
 * Bar Brawl / the Active status effects module AND removable by the status
 * effect manager's "Remove All" (which filters on flags.core.statusId).
 */

/**
 * Collect the unique status effect ids granted by an actor's trait features.
 *
 * @param {Actor} actor
 * @returns {string[]}
 */
export function getTraitStatusEffects(actor) {
  if (!actor) return [];

  const ids = new Set();
  for (const item of actor.items) {
    if (item.type !== "feature" || item.system.option !== "trait") continue;
    const list = Array.isArray(item.system.statusEffects)
      ? item.system.statusEffects
      : [];
    for (const id of list) if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Apply a token's trait-granted status effects to its actor.
 *
 * @param {TokenDocument} tokenDoc
 */
export async function applyTraitStatusEffects(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor) return;

  const ids = getTraitStatusEffects(actor);
  if (!ids.length) return;

  // CONFIG.statusEffects is an array in v13 and an {[id]: config} dictionary
  // in v14 — handle both shapes.
  const cfg = CONFIG.statusEffects ?? [];
  const valid = new Set(
    Array.isArray(cfg) ? cfg.map((e) => e.id) : Object.keys(cfg),
  );

  for (const id of ids) {
    if (!valid.has(id)) {
      console.warn(`Redsteel | Trait references unknown status effect "${id}"`);
      continue;
    }

    // Don't re-add one the actor already has.
    if (actor.effects.some((e) => e.statuses?.has(id))) continue;

    try {
      await game.redsteel.applyEffect(actor, id);
    } catch (err) {
      console.error(`Redsteel | Failed to apply trait status "${id}"`, err);
    }
  }
}
