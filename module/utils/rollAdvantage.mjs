/**
 * Actor-driven advantage / disadvantage on margin-of-success tests.
 *
 * The system models advantage/disadvantage as a **signed integer bias** that
 * accumulates from many sources (fatigue, features, buffs, the manual hotbar
 * picker). The net sign decides the die: positive → advantage (2d100kl, keep
 * the lower/better since the die is subtracted), negative → disadvantage
 * (2d100kh, keep the higher/worse), zero → a plain 1d100. Multiple advantages
 * and disadvantages therefore cancel out, D&D-style, rather than stacking dice.
 *
 * ## The `system.rollAdvantage` field
 * Seeded in {@link seedRollAdvantage} (called from Actor#prepareBaseData) as a
 * flat map of signed integers:
 *   {
 *     all: 0,          // applies to every test this actor makes
 *     stealth: 0,      // applies only to that skill / attribute / combat-skill
 *     athletics: 0,
 *     ...one key per rollable skill/attribute...
 *   }
 *
 * ## How to grant advantage/disadvantage from a feature or buff
 * Add an **Active Effect** change in ADD mode (mode 2) — see
 * `feature-flag-active-effects` in memory for the JSON shape:
 *   - All rolls, advantage:        key `system.rollAdvantage.all`        value `1`
 *   - All rolls, disadvantage:     key `system.rollAdvantage.all`        value `-1`
 *   - One skill, advantage:        key `system.rollAdvantage.stealth`    value `1`
 *   - One skill, disadvantage:     key `system.rollAdvantage.athletics`  value `-1`
 * The leaf is pre-seeded to 0, so ADD-mode effects accumulate cleanly.
 *
 * ## How the bias reaches a roll
 * Actor#getRollData() shallow-copies `system`, so `roll.data.rollAdvantage`
 * references the same object — the global evaluate wrapper in rollModifier.mjs
 * reads it with no per-call-site wiring. That covers the actor-wide `all` bias
 * automatically (this is what fatigue degree 4 uses). The per-skill bias needs
 * the skill key, which only the call site knows: tag it with {@link tagRollSkill}
 * before evaluating. Sites that don't tag a skill simply get the `all` bias.
 */

/** Rollable groups whose keys each get their own advantage bucket. */
const ROLL_GROUPS = [
  "skills",
  "combatSkills",
  "attributes",
  "secondaryAttributes",
];

/**
 * Initialise `system.rollAdvantage` with a 0 bucket for `all` and for every
 * rollable skill/attribute key, so ADD-mode Active Effects have a numeric leaf
 * to accumulate onto. Call from Actor#prepareBaseData (before effects apply).
 * @param {object} system  The actor's system data.
 */
export function seedRollAdvantage(system) {
  const adv = { all: 0, twoHanded: 0 };
  for (const group of ROLL_GROUPS) {
    for (const key of Object.keys(system?.[group] ?? {})) {
      // First writer wins; never clobber a real skill key with a later group.
      if (!(key in adv)) adv[key] = 0;
    }
  }
  system.rollAdvantage = adv;
}

/**
 * Net advantage bias for a given roll, combining the actor-wide `all` bucket
 * with the skill-specific bucket when a skill key is known.
 * @param {object} rollData   The Roll's data (a copy of actor system data).
 * @param {string} [skillKey] The skill/attribute key this roll represents.
 * @returns {number} >0 advantage, <0 disadvantage, 0 none.
 */
export function getRollBias(rollData, skillKey) {
  const adv = rollData?.rollAdvantage;
  if (!adv) return 0;
  let bias = Number(adv.all) || 0;
  if (skillKey && Number.isFinite(adv[skillKey])) bias += adv[skillKey];
  return bias;
}

/**
 * Tag a not-yet-evaluated Roll with the skill key it represents so the global
 * modifier wrapper can apply that skill's advantage bucket. No-op without a key.
 * @param {Roll} roll
 * @param {string} [skillKey]
 */
export function tagRollSkill(roll, skillKey) {
  if (!roll || !skillKey) return;
  roll.options ??= {};
  roll.options.redsteel = { ...(roll.options.redsteel ?? {}), skill: skillKey };
}

/**
 * Merge the actor's advantage buckets into a roll-data object so a Roll built
 * with a custom data object (not Actor#getRollData) still carries the actor-wide
 * bias. Use at test-roll call sites: `new Roll(formula, withRollBias({…}, actor))`.
 * Returns the same object for convenient inline use.
 * @param {object} rollData
 * @param {Actor}  actor
 * @returns {object} rollData
 */
export function withRollBias(rollData = {}, actor) {
  const adv = actor?.system?.rollAdvantage;
  if (adv) rollData.rollAdvantage = adv;
  // Carry fatigue context + the acting actor's uuid so the roll layer can apply
  // the actor-wide bias, ignore-fatigue logic, and the Desperate Effort cost.
  if (actor) {
    rollData.actorUuid = actor.uuid;
    rollData.fatigueDegree = actor.system?.fatigueDegree ?? 0;
    rollData.fatigueDisadvantage = !!actor.system?.fatigueDisadvantage;
  }
  return rollData;
}

/**
 * Shift critical thresholds for a Desperate Effort test (when the roll is tagged
 * with `options.redsteel.desperate`). Desperate Effort raises crit-success
 * chance by 5% (successThreshold +5) and lowers crit-failure chance by 5%
 * (failureThreshold +5), and ignores the fatigue crit-failure penalty by adding
 * the fatigue degree back to the failure threshold. Returns possibly-unchanged
 * thresholds, so it's safe to wrap every crit evaluation.
 * @param {Roll} roll
 * @param {number} successThreshold
 * @param {number} failureThreshold
 * @returns {{successThreshold:number, failureThreshold:number}}
 */
export function applyDesperateCrit(roll, successThreshold, failureThreshold) {
  if (!roll?.options?.redsteel?.desperate) {
    return { successThreshold, failureThreshold };
  }
  const fatigueDegree = roll.data?.fatigueDegree ?? 0;
  return {
    successThreshold: successThreshold + 5,
    failureThreshold: failureThreshold + 5 + fatigueDegree,
  };
}
