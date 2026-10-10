import {
  hasWeaponMasterNode,
  PRIMARY_DAMAGE_MULTIPLIER,
} from "./weaponMaster.mjs";

/**
 * A die size as it can be spliced straight into a roll formula.
 *
 * `system.roll.diceSize` is not always a bare integer. Foundry's own dice
 * notation rides along with it: `"10x"` is an exploding d10, and the Longbow
 * stores `"8k5"` (keep 5). `Number("10x")` is NaN, which the old `|| 0`
 * turned into `2d0` — a formula that rolls and deals nothing at all, silently.
 *
 * So: a plain integer comes back as a number, a leading integer followed by
 * dice notation comes back as authored, and anything else (empty, null, a
 * stray word) comes back as 0. The 0 fallback is the guard that has to stay:
 * an empty field used to build `"nulld"`, which Roll cannot resolve and which
 * threw mid-cast, taking the whole spell down.
 *
 * @param {*} raw  The stored `system.roll.diceSize`.
 * @returns {number|string}
 */
export function parseDiceSize(raw) {
  const text = String(raw ?? "").trim();
  if (/^\d+$/.test(text)) return Number(text);
  // A whole formula typed into the size field ("2d6") is not notation: it
  // would splice into "1d2d6". Rejected before the notation test, which would
  // otherwise wave it through, so it falls back to 0 like any other garbage.
  if (/^\d+[dD]\d+$/.test(text)) return 0;
  // <digits><notation>, e.g. "10x", "10x>8", "8k5", "10kh3", "10r<3".
  if (/^\d+[A-Za-z][A-Za-z0-9<>=!]*$/.test(text)) return text;
  return 0;
}

/**
 * The damage formula of a weapon (and of every other non-consumable,
 * non-spell item with a `roll` block), as stored in `system.formula` by
 * RedsteelItem.prepareDerivedData. Pure: reads only, writes nothing.
 *
 * Dice from `system.roll`, plus the attribute the wielder adds: Strength by
 * default, Dexterity for a finesse weapon when the actor owns the Finesse
 * feature, Perception for bows and crossbows and (when it beats Strength) for
 * thrown weapons. Giant adds 1d4 to non-launcher weapons, Weapon Master's
 * primaryDamage multiplies the attribute, and an NPC adds its flat damage
 * bonus instead. Without an actor the formula is "" (nobody to read the
 * attribute off).
 *
 * Also used by the makeshift view (utils/makeshift.mjs) on its overridden
 * system, so a bow swung in melee gets the melee attribute.
 *
 * @param {Actor|null} actor  the owning actor
 * @param {object} system     item system data: roll, class, finesse, thrown
 * @returns {string}
 */
export function weaponDamageFormula(actor, system) {
  // A spell that deals no direct damage (Poisoned blood, Coagulation …) can
  // have these left null/empty by the sheet. Coerce to 0 so the formula is
  // always a valid one — "nulld" reaches Roll as an unresolvable term and
  // throws on evaluate, taking the whole cast down with it.
  const diceNum = Number(system.roll.diceNum) || 0;
  const diceSize = parseDiceSize(system.roll.diceSize);
  const diceBonus = system.roll.diceBonus ?? 0;

  let formula = "";

  // Default to Strength
  let attr = "str";

  if (actor) {
    let str = actor.system.attributes.str.total;
    let dex = actor.system.attributes.dex.total;
    let per = actor.system.attributes.per.total;

    // Check if the actor owns an item named "Finesse"
    const hasFinesse = actor.items.some(
      (item) => item.name.toLowerCase() === "finesse",
    );
    // Check if the actor owns an item named "Giant"
    const hasGiant = actor.items.some(
      (item) => item.name.toLowerCase() === "giant",
    );

    // Check if *this* weapon has finesse
    if (system.finesse === true && hasFinesse && str <= dex) {
      attr = "dex"; // Use Dexterity if all conditions are met
    }

    // Check if *this* weapon is bow or crossbow
    if (system.class === "crossbow" || system.class === "bow") {
      attr = "per"; // Use Perception if ranged weapon
    }

    // Check if *this* weapon is throwing and compare str with per
    if (system.thrown && str <= per) {
      attr = "per";
      // Check if *this* weapon has finesse
      if (
        system.finesse === true &&
        hasFinesse &&
        str <= dex &&
        str <= per
      ) {
        attr = "dex"; // Use Dexterity if all conditions are met
      }
    }
    // Damage +50% from Primary Attributes (Weapon Master, primaryDamage):
    // whichever attribute this attack adds counts one and a half times,
    // rounded down.
    const attrTerm =
      actor.type === "character" &&
      hasWeaponMasterNode(actor, "primaryDamage")
        ? `floor(@${attr} * ${PRIMARY_DAMAGE_MULTIPLIER})`
        : `@${attr}`;
    if (
      hasGiant &&
      system.class !== "crossbow" &&
      system.class !== "bow"
    ) {
      formula = `${diceNum}d${diceSize} + 1d4 ${diceBonus ? `+${diceBonus}` : ""} + ${attrTerm}`;
    } else {
      formula = `${diceNum}d${diceSize} ${diceBonus ? `+${diceBonus}` : ""} + ${attrTerm}`;
    }
    if (actor.type === "npc") {
      formula = `${diceNum}d${diceSize}  ${
        diceBonus ? `+${diceBonus}` : ""
      } + ${actor.system.combatSkills.damageBonus.value}`;
    }
  }

  return formula;
}
