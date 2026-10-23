/**
 * Prepare the data structure for Active Effects which are currently embedded in an Actor or Item.
 * @param {ActiveEffect[]} effects    A collection or generator of Active Effect documents to prepare sheet data for
 * @return {object}                   Data for rendering
 */
export function prepareActiveEffectCategories(effects) {
  // Define effect header categories
  const categories = {
    temporary: {
      type: 'temporary',
      label: game.i18n.localize('REDSTEEL.Effect.Temporary'),
      effects: [],
    },
    passive: {
      type: 'passive',
      label: game.i18n.localize('REDSTEEL.Effect.Passive'),
      effects: [],
    },
    inactive: {
      type: 'inactive',
      label: game.i18n.localize('REDSTEEL.Effect.Inactive'),
      effects: [],
    },
  };

  // Iterate over active effects, classifying them into categories
  for (const e of effects) {
    // A suppressed effect (status-conditional, see RedsteelActiveEffect) is not
    // applying either, so it lists as inactive rather than as a live passive.
    if (e.disabled || e.isSuppressed) categories.inactive.effects.push(e);
    else if (e.isTemporary) categories.temporary.effects.push(e);
    else categories.passive.effects.push(e);
  }

  // Sort each category
  for (const c of Object.values(categories)) {
    c.effects.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  }
  return categories;
}
