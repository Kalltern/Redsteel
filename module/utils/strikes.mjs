/**
 * Strike spells → the caster status effect they impose on a successful cast.
 * Keyed on the item's raw (English) name so this resolves on spell copies that
 * are already owned by live actors, without needing a re-import to pick up a
 * flag. A `flags.redsteel.strike` override wins when present.
 *
 * Enchanted strike is listed under both its final and its old "(WIP)" name —
 * the pack was renamed, but copies already on live actors keep the old one.
 *
 * Lives in its own module because both the cast pipeline (castSpell.mjs) and
 * the spell bonus pipeline (magicSkillBonuses.mjs) need to recognise a strike,
 * and those two already import from each other.
 */
const STRIKE_SPELLS = {
  "Lightning strike": "lightning_strike",
  "Fire strike": "fire_strike",
  "Frost strike": "frost_strike",
  "Venomous strike": "venomous_strike",
  "Enchanted strike": "enchanted_strike",
  "Enchanted strike (WIP)": "enchanted_strike",
  "Dark strike": "dark_strike",
  "Binding strike": "binding_strike",
  "Empower strike": "empower_strike",
};

/**
 * @param {Item} spell
 * @returns {string|null} the strike effect id this spell applies, or null.
 */
export function getStrikeId(spell) {
  const flag = spell?.getFlag?.("redsteel", "strike");
  if (flag) return flag;
  return STRIKE_SPELLS[String(spell?.name ?? "").trim()] ?? null;
}
