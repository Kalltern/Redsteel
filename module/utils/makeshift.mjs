import { weaponDamageFormula } from "./weaponFormula.mjs";

/**
 * Makeshift weapons (provizorní zbraně).
 *
 * The rulebook gives one stat block per size. A bow or crossbow swung
 * or parried with in melee counts as a makeshift weapon of its own size, and
 * always as a BLUNT one (drtivá): it rolls the Blunt weapon skill, deals blunt
 * damage and staggers.
 *
 * These numbers mirror the "Makeshift" folder of the redsteel-items compendium
 * (src/packs/redsteel-items/Weapons_6X9kepiJh0bJGUFK/Makeshift_T048EyF3y5pyqzDO).
 * Change both together.
 *
 * `defense` is the parry modifier. Dodge is deliberately absent: a ranged
 * weapon keeps its own dodge value, the makeshift view only changes attack and
 * parry.
 */
export const MAKESHIFT_STATS = {
  light: {
    attack: -20,
    defense: -20,
    roll: { diceNum: 2, diceSize: "4", diceBonus: "1" },
    penetration: 4,
    effectChance: 10,
    finesse: true,
  },
  medium: {
    attack: -20,
    defense: -20,
    roll: { diceNum: 2, diceSize: "6", diceBonus: "0" },
    penetration: 5,
    effectChance: 10,
    finesse: false,
  },
  heavy: {
    attack: -15,
    defense: -15,
    roll: { diceNum: 2, diceSize: "8", diceBonus: "1" },
    penetration: 5,
    effectChance: 15,
    finesse: false,
  },
};

// Firearms are left out: there is no firearm attack path to "Shoot" with.
const RANGED_CLASSES = ["bow", "crossbow"];

/**
 * A launcher: a bow or crossbow. Thrown weapons are not, they are
 * already melee-capable on their own.
 * @param {Item|null} item
 * @returns {boolean}
 */
export function isRangedWeapon(item) {
  return (
    item?.type === "weapon" &&
    RANGED_CLASSES.includes(item.system?.class) &&
    item.system?.thrown !== true
  );
}

/**
 * The makeshift size a ranged weapon fights as: its own `system.type`, or
 * medium when the field is missing or unknown.
 * @param {Item|null} item
 * @returns {"light"|"medium"|"heavy"}
 */
export function makeshiftSizeOf(item) {
  const size = item?.system?.type;
  return size in MAKESHIFT_STATS ? size : "medium";
}

/** Is this object a makeshift-melee view built by {@link asMakeshiftMelee}? */
export function isMakeshiftView(w) {
  return w?.isMakeshiftView === true;
}

/**
 * The `system` block a ranged weapon has when used in melee: a deep clone of
 * its own, with every combat number replaced by the makeshift stat block of
 * its size. The weapon's own quality, enchantments, doctrines, crit fields,
 * sneak dice and breakthrough do not apply in melee. Dodge stays its own.
 */
function buildMakeshiftSystem(weapon) {
  const size = makeshiftSizeOf(weapon);
  const stats = MAKESHIFT_STATS[size];
  const source = weapon.system;
  let sys = foundry.utils.deepClone(source);
  // deepClone hands back non-plain objects as they are; never mutate the
  // real item's data through the view.
  if (sys === source) sys = foundry.utils.deepClone({ ...source });

  const doctrines = {};
  for (const key of Object.keys(sys.doctrines ?? {})) doctrines[key] = false;

  Object.assign(sys, {
    class: "blunt",
    type: size,
    thrown: false,
    longReach: false,
    // No versatile grip: the two-handed die belongs to real melee weapons.
    gripMode: "one",
    twoHandGrip: false,
    finesse: stats.finesse,
    sharp: false,
    attack: stats.attack,
    defense: stats.defense,
    roll: { ...stats.roll },
    penetration: stats.penetration,
    effects: {
      stagger: stats.effectChance,
      bleed: 0,
      extra1: 0,
      extra2: 0,
      extra3: 0,
    },
    dmgType1: "physical",
    bool2: "and",
    dmgType2: "blunt",
    bool3: "",
    dmgType3: "",
    bool4: "",
    dmgType4: "",
    effectType1: "",
    effectType2: "",
    effectType3: "",
    critRange: 0,
    critChance: 0,
    critFail: 0,
    critDefense: 0,
    critDodge: 0,
    critDamage: 0,
    critPenetration: 0,
    breakthrough: "",
    sneakDamage: "",
    qualityMods: {},
    enchantMods: {},
    doctrines,
    offhand: false,
    tags: "makeshift",
  });
  // system.formula is derived from roll/class/finesse in item.mjs; rebuilt
  // over the makeshift block so the swing adds the melee attribute (Strength,
  // or Dexterity for a finesse size), not a bow's Perception.
  sys.formula = weaponDamageFormula(weapon.actor, sys);
  return sys;
}

/**
 * The weapon as it fights in melee. Anything that is not a ranged weapon comes
 * back unchanged (so this is safe to apply to every melee candidate, and
 * applying it twice is harmless: a view reads as class "blunt").
 *
 * A ranged weapon comes back as a Proxy over the real Item. Only three things
 * differ: `system` (the makeshift block, see buildMakeshiftSystem),
 * `isMakeshiftView` (true) and `localizedName` (with a "(makeshift)" suffix).
 * Everything else is the real Item's, and methods are bound to the real Item,
 * so id, name, img, parent, update and getFlag keep working. A bound method
 * therefore reads the REAL bow's system, never the view's: combat math must
 * read `weapon.system` fields, not call methods on the weapon.
 *
 * @param {Item|null} weapon
 * @returns {Item|null}
 */
export function asMakeshiftMelee(weapon) {
  if (!isRangedWeapon(weapon)) return weapon;
  const system = buildMakeshiftSystem(weapon);
  return new Proxy(weapon, {
    get(target, prop) {
      if (prop === "system") return system;
      if (prop === "isMakeshiftView") return true;
      if (prop === "localizedName") {
        const base = Reflect.get(target, "localizedName", target) ?? target.name;
        return `${base} ${game.i18n.localize("REDSTEEL.AttackDialog.MakeshiftSuffix")}`;
      }
      // A poison coating on a bow is meant for its shots (see usePoison), not
      // for a club swing with the stave, so the view hides it from the damage
      // and effect rolls (combatSkillBonuses reads it through getFlag).
      if (prop === "getFlag") {
        return (scope, key) =>
          scope === "redsteel" && key === "coating"
            ? undefined
            : target.getFlag(scope, key);
      }
      const v = Reflect.get(target, prop, target);
      // The class itself keeps its statics (documentName, metadata…).
      if (prop === "constructor") return v;
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
