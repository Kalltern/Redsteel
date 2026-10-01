/**
 * Odražení (Brace, Weapon Master) and the reaction half of Vylepšená rychlá
 * reakce (Improved Fast Reaction).
 *
 * Brace: "When attacked, may spend a Reaction to gain Advantage on the next
 * Defense." The hotbar offers it against an incoming melee attack
 * (actionSuggestions.mjs); using it runs through the Combat Abilities dialog,
 * which pays the Reaction, and combatAbilities.mjs applies the `brace` effect
 * (helpers/config.mjs): +1 to the meleeDefense, rangedDefense and dodge
 * advantage buckets.
 *
 * The effect is one-shot. The next defense card posted for its owner, of any
 * of the three kinds, uses it up; this file deletes it as soon as that card
 * exists, by which time the roll has already been evaluated with the
 * Advantage. Unused, it lapses at the start of the owner's next turn
 * (defaultTurns 1).
 */

/** localizationKey of the Brace ability (the item kept its old key). */
export const BRACE_KEY = "REDSTEEL.Items.Deflection.name";

/** localizationKey of Improved Fast Reaction, which shares system.key. */
export const IMPROVED_FAST_REACTION_KEY = "REDSTEEL.Items.ImprovedFastReaction.name";

/** Status id of the Brace effect. */
export const BRACE_STATUS = "brace";

/** Is this the Brace ability? `system.key` "brace" also points a copy here. */
export function isBraceAbility(ability) {
  return (
    ability?.system?.key === "brace" ||
    ability?.system?.localizationKey === BRACE_KEY
  );
}

/** The actor's Brace effect, or null. */
export function getBraceEffect(actor) {
  return actor?.effects?.contents?.find((e) => e.statuses?.has(BRACE_STATUS)) ?? null;
}

/**
 * Use the Brace effect up once a defense card is posted for its owner.
 *
 * Single writer: the active GM, so two clients never race to delete the same
 * document. A rerolled defense is a new card for the same defender, but the
 * effect is already gone by then: the Advantage covers the first roll only.
 */
export function registerBraceHooks() {
  Hooks.on("createChatMessage", async (message) => {
    if (!game.users.activeGM?.isSelf) return;
    const defense = message.flags?.redsteel?.defense;
    if (!defense?.defenderTokenId) return;
    // A rerolled card is the same defense again, not a new one.
    if (message.flags?.redsteel?.rerolledFrom) return;

    const token =
      canvas.tokens?.get(defense.defenderTokenId) ??
      game.scenes?.viewed?.tokens?.get(defense.defenderTokenId);
    const actor = token?.actor;
    const effect = getBraceEffect(actor);
    if (!effect) return;
    try {
      await effect.delete();
    } catch (err) {
      console.warn("Redsteel | Could not use up Brace", err);
    }
  });
}
