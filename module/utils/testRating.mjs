/**
 * Test Type resolution (the `system.attributeTest` dropdown).
 *
 * A Test Type names either a skill, a combat skill or one of the seven
 * attributes, and every roll site needs the same answer for "what percentage
 * does this actor test at?". The lookup used to be duplicated as a local
 * `attributeMap` at each call site, and the copies drifted: the modifier loops
 * in `basicAttack.mjs` and `combatAbilities.mjs` still listed a `wisdom` key
 * (no such attribute) and had neither `will` nor `perception`, so a Perception
 * test on a modifier such as Distraction (Perception) silently resolved to 0%.
 *
 * Speed tests are NOT handled here — check `isSpeedTest()` first, they roll
 * d12 + Initiative + Speed instead of a d100 margin of success.
 */

/**
 * Test Type label → `system.attributes` key.
 *
 * The live dropdown is rebuilt every prepare from `item.mjs` `system.testOptions`
 * and offers ten values: the seven attributes below plus `leadership` (a skill),
 * `channeling` (a combat skill) and `speed` (the d12 test). The attribute list
 * there is spelt `inteligence`, so that is the spelling actually stored on
 * items; `intelligence` and `willpower` are accepted as aliases so hand-authored
 * or future data cannot fall through to a 0% test.
 */
export const ATTRIBUTE_KEYS = {
  strength: "str",
  dexterity: "dex",
  endurance: "end",
  inteligence: "int",
  intelligence: "int",
  will: "wil",
  willpower: "wil",
  charisma: "cha",
  perception: "per",
};

/**
 * Resolve the base rating an actor tests a Test Type against.
 *
 * Resolution order — Leadership, combat skills, other skills, attributes last —
 * so a skill of the same name always wins over an attribute.
 *
 * @param {Actor} actor
 * @param {string} testName  Raw value from `system.attributeTest`.
 * @returns {{value: number, skillKey: string|null}} `skillKey` is the bucket the
 *   roll should be tagged with for per-skill advantage; null when unresolved.
 */
export function resolveTestRating(actor, testName) {
  const lower = String(testName ?? "")
    .trim()
    .toLowerCase();

  if (lower === "leadership") {
    return {
      value:
        actor.type === "npc"
          ? (actor.system.attributes.cha?.value ?? 0)
          : (actor.system.skills?.leadership?.rating ?? 0),
      skillKey: "leadership",
    };
  }
  if (actor.system.combatSkills?.[lower]) {
    return {
      value: actor.system.combatSkills[lower]?.rating ?? 0,
      skillKey: lower,
    };
  }
  if (actor.system.skills?.[lower]) {
    return { value: actor.system.skills[lower]?.rating ?? 0, skillKey: lower };
  }
  if (ATTRIBUTE_KEYS[lower]) {
    const shortKey = ATTRIBUTE_KEYS[lower];
    return {
      value:
        actor.type === "npc"
          ? (actor.system.attributes[shortKey]?.value ?? 0)
          : (actor.system.attributes[shortKey]?.mod ?? 0),
      skillKey: shortKey,
    };
  }
  return { value: 0, skillKey: null };
}
