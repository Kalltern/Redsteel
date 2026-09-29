/**
 * Hastened Cast (Zrychlené čarování) — mage feature, 5 CP, any Doctrine III.
 *
 * "Může před sesláním kouzla snížit Obtížnost kouzla o 15% výměnou za zvýšenou
 * šanci na Kritický neúspěch o 5%."
 *
 * Declared per cast in the spell dialog, like Blood Payment. The Difficulty
 * side rides the same capped path as Focus (getEffectiveDifficulty): +15 on a
 * negative Difficulty, never past 0. The price is a channeling Critical
 * Failure threshold 5 lower for that one roll, so a 96 threshold becomes 91.
 */

export const HASTENED_CAST_DIFFICULTY = 15;
export const HASTENED_CAST_CRIT_FAIL = 5;

const FEATURE_NAME = "hastened cast";

/**
 * True when the caster owns the Hastened Cast feature. Matched by the pack
 * item's English name, the same way other feature checks read ownership.
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasHastenedCast(actor) {
  return !!actor?.items?.some(
    (i) => i.type === "feature" && i.name?.toLowerCase() === FEATURE_NAME,
  );
}
