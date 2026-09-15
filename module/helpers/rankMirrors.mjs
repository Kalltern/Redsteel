/**
 * Rank mirrors: the specialisation perks that make one track copy the rank of
 * another instead of being bought.
 *
 * Source: "Pravidla pro ToS V12.1 (WIP)" → "Specializace (WIP)", Hoplita:
 * "Zvolí si dovednost Meče, Sekery nebo Tupé. Každý stupeň dovednosti Dřevcové
 * se počítá jako stupeň zvolené dovednosti, se všemi akcemi a bonusy."
 *
 * Rules:
 *   - The pick is made under the specialisation's star sign in the Learn
 *     window, once the node is unlocked.
 *   - The chosen track's stored rank follows the source track, so every reader
 *     (ability grants, weapon skill bonuses, requirements) sees a real rank.
 *   - Copied ranks cost 0, and the chosen track can be neither bought nor
 *     refunded while the copy holds.
 *   - Ranks already paid for in the chosen track are kept and still charged:
 *     the track holds the higher of those and the source's rank.
 *   - Locking the node, or losing the specialisation, drops the pick and puts
 *     the chosen track back to the ranks that were paid for.
 *
 * Every definition carries `group` (the track group both tracks live in),
 * `from` (the source key) and `choices` (the keys the player may pick).
 *
 * Pure data: the engine (progressionEngine.mjs) applies it, and
 * specialisations.mjs reads SPEC_MIRRORS to paint these perks as automated.
 */

/** Specialisation perk mirrors: specialisation id → node id → mirror. */
export const SPEC_MIRRORS = {
  // Hoplita: every rank of Dřevcové counts as a rank of Meče, Sekery or Tupé.
  hoplite: {
    hoplitaStance: {
      group: "weaponSkills",
      from: "polearms",
      choices: ["swords", "axes", "blunt"],
    },
  },
};
