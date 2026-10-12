/**
 * Which doctrine a weapon fights under, so doctrine bonuses never pile up from
 * doctrines the character is not actually practising.
 *
 * A doctrine applies to a weapon only when all three hold:
 *   1. the weapon's doctrine checkbox is ticked (`system.doctrines.<key>`),
 *   2. one of its tags is on the doctrine's list below (the weapon's name
 *      counts as a tag, so older copies with an empty Tags field still match),
 *   3. the hands are set up the doctrine's way (HAND_RULES).
 * A mis-ticked checkbox alone can therefore never leak a bonus (user ruling
 * 2026-10-12). A homebrew weapon needs a listed tag in its Tags field.
 *
 * Doctrines that all pass add together; within one doctrine the higher rank
 * replaces the lower (computeDoctrineBonuses).
 */
import { getWeaponTags, resolveWeaponContext } from "./weaponResolver.mjs";
import { hasDuelistOffHand } from "./aim.mjs";

/** Weapon tags each doctrine accepts. Seeded from the compendium's ticks. */
export const DOCTRINE_WEAPON_TAGS = {
  pikeman: ["bac-de-corbin", "glaive", "halberd", "spear"],
  swordsman: ["broadsword", "flamberge", "longsword", "military cleaver", "sabre", "shortsword"],
  reaver: [
    "bardiche", "flail", "great hammer", "hatchet", "long axe", "mace",
    "two handed flail", "war axe", "war hammer", "war pick",
  ],
  shieldbearer: [
    "baton", "broadsword", "dagger", "fencing dagger", "flail", "hatchet",
    "javelin", "mace", "military cleaver", "rapier", "sabre", "shortsword",
    "spear", "throwing axe", "war axe", "war hammer", "war pick",
  ],
  dimakerus: [
    "baton", "broadsword", "dagger", "flail", "hatchet", "mace",
    "military cleaver", "rapier", "sabre", "shortsword", "throwing axe",
    "war axe", "war hammer", "war pick",
  ],
  duelist: ["broadsword", "dagger", "military cleaver", "rapier", "sabre", "shortsword"],
  monk: ["staff"],
  archer: ["hunting bow", "longbow", "reflex bow"],
  arbalest: ["crossbow", "heavy crossbow"],
  peltast: ["javelin", "throwing axe"],
  juggler: ["throwing axe", "throwing knife"],
};

/** Heavy weapons are always two-handed; others when switched to that grip. */
function isTwoHanded(weapon) {
  const ws = weapon?.system ?? {};
  return ws.type === "heavy" || ws.gripMode === "two";
}

/**
 * Hand setup each doctrine needs (user rulings 2026-10-12). `ctx` is the
 * active weapon set as resolveWeaponContext reads it, or null when there is
 * none, which reads as an empty off hand.
 */
const HAND_RULES = {
  swordsman: (weapon) => isTwoHanded(weapon),
  reaver: (weapon) => isTwoHanded(weapon),
  pikeman: (weapon) => isTwoHanded(weapon),
  monk: (weapon) => isTwoHanded(weapon),
  shieldbearer: (weapon, ctx) => !!ctx?.hasShield,
  peltast: (weapon, ctx) => !!ctx?.hasShield,
  // Both hands hold Dimakerus weapons. A duelist off hand (fencing dagger)
  // is a special off hand for the Duelist only (user ruling 2026-10-12).
  dimakerus: (weapon, ctx) =>
    !!ctx?.isDualWield &&
    !isTwoHanded(weapon) &&
    weaponIsTaggedFor(ctx.offWeapon, "dimakerus"),
  // A free off hand, or an off-hand weapon flagged for the duelist.
  duelist: (weapon, ctx) => !isTwoHanded(weapon) && hasDuelistOffHand(ctx),
  archer: () => true,
  arbalest: () => true,
  juggler: () => true,
};

/** The weapon's tags plus its own name ("Javelin melee" reads as "javelin"). */
function weaponTagSet(weapon) {
  const tags = new Set(getWeaponTags(weapon));
  let name = String(weapon?.name ?? "").trim().toLowerCase();
  if (name.endsWith(" melee")) name = name.slice(0, -6);
  if (name) tags.add(name);
  return tags;
}

/** Checkbox ticked and a listed tag present; the hands are not checked. */
function weaponIsTaggedFor(weapon, doctrine) {
  if (weapon?.system?.doctrines?.[doctrine] !== true) return false;
  const tags = weaponTagSet(weapon);
  return (DOCTRINE_WEAPON_TAGS[doctrine] ?? []).some((t) => tags.has(t));
}

/**
 * @param {Actor} actor  a character
 * @param {Item} weapon  the weapon the roll is made with
 * @param {string} doctrine  doctrine key, e.g. "duelist"
 * @returns {boolean}
 */
export function doctrineAppliesToWeapon(actor, weapon, doctrine) {
  const hands = HAND_RULES[doctrine];
  if (!hands || !weaponIsTaggedFor(weapon, doctrine)) return false;
  const ctx = resolveWeaponContext(actor, null, weapon);
  return hands(weapon, ctx);
}
