/**
 * Weak Spot attacks (Útok na slabinu) and the Weapon Master penetration perk.
 *
 * The rules treat "an attack aimed at the weak points in the armour" as one
 * family of actions rather than one action: there is a melee version, a ranged
 * one, a throwing modifier, a rapier-only version from the Imbroccata feat, and
 * the two upgrades the Shadow tree's Vylepšený útok/vrh na slabinu hands out.
 * Mistr zbraní's "Útok na slabinu: Průbojnost +10" node applies to all of them,
 * so the family has to be recognisable from an attack in progress.
 *
 * Matched on localizationKey, which is stable across renames and identical in
 * both languages, with the English name as a fallback for hand-made copies that
 * never got a key — the same shape aim.mjs uses for its ability families.
 */

/** localizationKey -> English name, for every action in the Weak Spot family. */
const WEAK_SPOT_ABILITIES = new Map([
  ["REDSTEEL.Items.ExploitWeakness.name", "Exploit Weakness"],
  ["REDSTEEL.Items.ExploitWeaknessRanged.name", "Exploit Weakness (Ranged)"],
  ["REDSTEEL.Items.ExploitWeaknessThrow.name", "Exploit Weakness (Throw)"],
  ["REDSTEEL.Items.ImprovedExploitWeakness.name", "Improved Exploit Weakness"],
  [
    "REDSTEEL.Items.ImprovedExploitWeaknessThrow.name",
    "Improved Exploit Weakness (Throw)",
  ],
  [
    "REDSTEEL.Items.ImbroccataExploitWeakness.name",
    "Imbroccata: Exploit Weakness",
  ],
]);

/** Penetration the Weapon Master node adds to a Weak Spot attack. */
const WEAPON_MASTER_WEAK_SPOT_PEN = 10;

/** True when this ability (or attack modifier) is a Weak Spot action. */
export function isWeakSpotAttack(item) {
  if (!item) return false;
  const key = item.system?.localizationKey;
  if (key && WEAK_SPOT_ABILITIES.has(key)) return true;
  for (const name of WEAK_SPOT_ABILITIES.values()) {
    if (item.name === name) return true;
  }
  return false;
}

/**
 * Mistr zbraní → "Útok na slabinu: Průbojnost +10".
 *
 * +10 Penetration whenever the attack being rolled is a Weak Spot action, no
 * matter which one: the throwing versions arrive as a selected modifier on an
 * ordinary attack rather than as the ability, so both are checked. The bonus is
 * flat and applies once, however many of them are stacked on one roll.
 *
 * @param {Actor} actor                 the attacker
 * @param {Item|null} ability           the ability being used, if any
 * @param {Item[]} selectedModifiers    attack modifiers ticked in the dialog
 * @returns {number}                    penetration to fold into the attack
 */
export function getWeakSpotPenetration(
  actor,
  ability = null,
  selectedModifiers = [],
) {
  const spec = actor?.system?.specialisations?.weaponMaster;
  if (!spec?.active || !spec.nodes?.weakSpotPen) return 0;

  const used =
    isWeakSpotAttack(ability) ||
    (selectedModifiers ?? []).some((mod) => isWeakSpotAttack(mod));

  return used ? WEAPON_MASTER_WEAK_SPOT_PEN : 0;
}
