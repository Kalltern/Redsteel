export async function castSpell() {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;
  const result = await game.redsteel.showSpellSelectionDialogs(actor);
  if (!result) {
    ui.notifications.info("Spell casting canceled.");
    return;
  }

  const { freeCast, focusSpent, ignoreChanneling, maintainChanneling } = result;

  // If the spell has linked variants, let the player choose which version to
  // cast. Resolves with the parent spell itself when no valid variants exist.
  const spell = await game.redsteel.showVariantSelectionDialog(result.spell);
  if (!spell) {
    ui.notifications.info("Spell casting canceled.");
    return;
  }

  if (!freeCast) {
    const ok = await game.redsteel.deductMana(actor, spell);
    if (!ok) return;
  }

  const bonuses = game.redsteel.calculateAttackBonuses(actor, spell);

  const attackResults = await game.redsteel.performAttackRoll(
    actor,
    spell,
    bonuses.attackBonus,
    focusSpent,
    { ignoreChanneling },
  );

  await game.redsteel.finalizeRollsAndPostChat(
    actor,
    spell,
    bonuses,
    attackResults,
    {
      focusSpent,
      ignoreChanneling,
      maintainChanneling,
      freeCast,
    },
  );
}
