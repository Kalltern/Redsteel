/**
 * Critical success / failure chances for the character sheet's Statistics
 * column, read off the active weapon set.
 *
 * Nothing here does its own math: attacks go through getAttackCritThresholds
 * and defenses through buildDefenseProfile, the same functions the rolls use,
 * so the sheet cannot drift from the dice. Left out on purpose, because they
 * belong to one particular roll: Aim's Calculation crit, Bane, Desperate
 * Effort and the crit modifiers of a ticked attack modifier.
 */
import {
  computeDoctrineBonuses,
  getAttackCritThresholds,
  getWeaponSkillBonuses,
} from "./combatSkillBonuses.mjs";
import { buildDefenseProfile } from "./defense.mjs";
import { resolveWeaponContext } from "./weaponResolver.mjs";
import { asMakeshiftMelee, isRangedWeapon } from "./makeshift.mjs";

/**
 * A d100 crit pair as chances: success on a roll at or under its threshold,
 * failure at or over its threshold.
 */
function asChances(success, failure) {
  const clamp = (n) => Math.min(100, Math.max(0, Math.round(n)));
  return { success: clamp(success), failure: clamp(101 - failure) };
}

/**
 * One attack row. `weapon` is the active main hand when it attacks with this
 * skill, otherwise null, which reads the skill's own thresholds.
 */
async function attackChances(actor, weapon, rangedSkill = "") {
  const { doctrineCritBonus } = computeDoctrineBonuses(actor, weapon);
  const { weaponSkillCrit } = weapon
    ? await getWeaponSkillBonuses(actor, weapon)
    : { weaponSkillCrit: 0 };
  const { success, failure } = getAttackCritThresholds(actor, weapon, {
    doctrineCritBonus,
    weaponSkillCrit,
    rangedSkill: weapon ? "" : rangedSkill,
  });
  return asChances(success, failure);
}

/** One defense row; without a weapon in hand, the skill's own thresholds. */
async function defenseChances(actor, mode, skill, context) {
  if (!context) {
    return asChances(skill.criticalSuccessThreshold, skill.criticalFailureThreshold);
  }
  const profile = await buildDefenseProfile({ actor, mode, context });
  return asChances(profile.critSuccess, profile.critFailure);
}

/**
 * @param {Actor} actor  a character
 * @returns {Promise<Record<string, {success: number, failure: number}>>}
 *   keyed by combat skill: combat, archery, throwing, meleeDefense,
 *   rangedDefense, dodge
 */
export async function getSheetCritChances(actor) {
  const skills = actor.system.combatSkills;
  const context = resolveWeaponContext(actor);
  const main = context?.weapon ?? null;

  // Melee swings everything but a thrown weapon; a bow or crossbow swings as
  // the makeshift weapon basicAttack turns it into.
  const meleeWeapon = main && !main.system?.thrown ? asMakeshiftMelee(main) : null;
  const bow = main && isRangedWeapon(main) ? main : null;
  const thrown = main?.system?.thrown === true ? main : null;

  return {
    combat: await attackChances(actor, meleeWeapon),
    archery: await attackChances(actor, bow, "archery"),
    throwing: await attackChances(actor, thrown, "throwing"),
    meleeDefense: await defenseChances(actor, "melee", skills.meleeDefense, context),
    rangedDefense: await defenseChances(actor, "ranged", skills.rangedDefense, context),
    dodge: await defenseChances(actor, "dodge", skills.dodge, context),
  };
}
