/**
 * Attack modifiers that open ticked because of who is being attacked.
 *
 * Bonus proti velkým tvorům (Anti-Large, Pikeman 2 / Hoplite) applies whenever
 * a polearm is turned on a Large creature, so the attack dialogs pre-tick its
 * pill instead of trusting the player to remember. Like the Flanking pill, the
 * checkbox stays the single source of truth for the roll: this only sets its
 * starting state, and the player can still untick it or tick it by hand.
 *
 * Rules are keyed on the compendium entry the ability came from rather than a
 * field on the item, so copies actors already carry work without a migration.
 */
import { getActorBaneTags } from "./baneCombat.mjs";
import { weaponHasTag } from "./weaponResolver.mjs";

const ITEMS = "Compendium.redsteel.redsteel-items.Item.";

/**
 * source:    compendium uuid of the ability
 * name:      its (unique, always English) name, for hand-made copies
 * targetTag: creature tag (normalized, as getActorBaneTags returns it)
 * weaponTag: tag or class the swinging weapon must carry (weaponHasTag)
 */
const AUTO_MODIFIERS = [
  {
    source: `${ITEMS}yx2pLONxkiwDfWpo`,
    name: "Anti-Large",
    targetTag: "large",
    weaponTag: "polearm",
  },
];

function ruleFor(item) {
  const source =
    item?.getFlag?.("redsteel", "grantSource") ??
    item?._stats?.compendiumSource;
  return (
    AUTO_MODIFIERS.find((r) => r.source === source) ??
    AUTO_MODIFIERS.find((r) => r.name === item?.name) ??
    null
  );
}

/**
 * Should this modifier pill open ticked?
 *
 * Only with exactly one target (the caller passes null otherwise): a bonus
 * judged per creature must not ride a swing that also catches a small one.
 * With the weapon still unknown (an NPC picks it after this dialog), owning a
 * matching weapon is enough, mirroring filterByRequiredWeaponTag.
 * @param {Item} mod                an attack-modifier ability
 * @param {Actor} actor             the attacker
 * @param {Item|null} weapon        the resolved weapon, or null when unknown
 * @param {Token|null} targetToken  the single target, or null
 * @returns {boolean}
 */
export function autoTickModifier(mod, actor, weapon, targetToken) {
  const rule = ruleFor(mod);
  if (!rule || !targetToken?.actor) return false;
  if (!getActorBaneTags(targetToken.actor).has(rule.targetTag)) return false;
  if (weapon) return weaponHasTag(weapon, rule.weaponTag);
  return actor.items.some(
    (i) => i.type === "weapon" && weaponHasTag(i, rule.weaponTag),
  );
}
