/**
 * Spell Power (SK — "Síla kouzla") helpers.
 *
 * Spell Power is computed per magic school on the caster in
 * `actor.system.schools[<school>].spellPower` (see Actor.prepareDerivedData).
 * Spells and the effects they apply scale off the caster's SK in the school
 * the spell belongs to (`spell.system.type`).
 */

/**
 * Resolve a caster's Spell Power for a given school, optionally scaled.
 *
 * The single `multiplier` covers every way a rule references SK:
 *   - full SK ("+SK")        → multiplier 1   (default)
 *   - half SK ("+SK/2")      → multiplier 0.5
 *   - a multiple ("+2×SK")   → multiplier 2 (or any number)
 *
 * @param {Actor} caster                    The casting actor.
 * @param {string} school                   School key (fire, water, earth,
 *   air, spirit, body, darkness, blood, gnosis) — typically `spell.system.type`.
 * @param {object} [options]
 * @param {number} [options.multiplier=1]   Scale applied to the raw SK value.
 * @param {boolean} [options.round=true]    Floor the result (matches the
 *   rulebook, which always rounds SK fractions down). Set false for a raw value.
 * @returns {number} The (scaled) spell power, or 0 when the school/caster is
 *   missing.
 */
export function getSpellPower(
  caster,
  school,
  { multiplier = 1, round = true } = {},
) {
  const base = Number(caster?.system?.schools?.[school]?.spellPower ?? 0);
  if (!Number.isFinite(base)) return 0;

  const scaled = base * multiplier;
  return round ? Math.floor(scaled) : scaled;
}
