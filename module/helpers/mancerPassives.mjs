/**
 * Mancer school passives: the specialisation nodes of the six mancer trees
 * that change what a spell does once it is cast, rather than which spells a
 * character may hold (that is helpers/mancerSpells.mjs).
 *
 * Source: docs/rules-source/rules/specializace-wip.md, e.g. r875 "Bleskový
 * šok · Útočná kouzla Školy Vzduchu mají +15/20/25/30% (Podle stupně kouzla)
 * šanci na způsobení Omráčení na dva tahy."
 *
 * Every table here is data; the readers are:
 *   - MANCER_EFFECT_NODES, MANCER_STACK_NODES, MANCER_DAMAGE_NODES:
 *     utils/magicSkillBonuses.mjs (calculateAttackBonuses feeds the effect
 *     chances into the cast's effectModifiers, finalizeRollsAndPostChat adds
 *     the damage, penetration and stacks and prints the card tags).
 *   - MANCER_TRIGGER_NODES: documents/effects.mjs (_applySingleEffect bakes
 *     the extra damage / Stamina into the effect the holder's spell creates).
 *   - MANCER_HOOKED_NODES: nodes whose code is a single check in another file,
 *     named per entry.
 *   - helpers/specialisations.mjs paints all of them as automated.
 *
 * Rulings:
 *   - "A/B/C/D% (Podle stupně kouzla)" reads Apprentice / Expert / Master /
 *     Grandmaster; a Wild spell takes the Apprentice value (lead ruling
 *     2026-11-03).
 *   - "Offensive" is `system.isOffensive === true` and not a heal. Strike
 *     spells are left out: they hit nobody themselves, the same exclusion
 *     Maleficarum's Hex makes (magicSkillBonuses.mjs applySchoolTraitBonus).
 *   - A chance ADDS to the effect when the spell already rolls it, and gives
 *     the cast a rolled entry of its own when it does not. An effect the spell
 *     applies automatically (authored as -1) is left alone: it already lands.
 *   - `onlyIfRolled` entries only raise an effect the spell itself rolls.
 *   - Durations ("na dva tahy", "na tři tahy") are the statuses' own defaults
 *     (stagger 2 turns, slow 3 turns); the Apply path passes no duration.
 *
 * Pure data plus pure reads: no imports beyond the pack-spell matcher, so the
 * specialisation module can import this without a cycle.
 */

import { matchesPackSpell } from "./mancerSpells.mjs";

/** Rank → index into a `chances` array. Wild takes the Apprentice value. */
const RANK_INDEX = { wild: 0, apprentice: 0, expert: 1, master: 2, grandmaster: 3 };

/**
 * Jedovatý hmyz (r1045): these three spells "can cause Poisoned", which makes
 * them poison-based for Travič I / II. On their own they give no chance.
 */
export const VENOMOUS_INSECT_SPELLS = [
  { id: "bWyejPiHoUXBX9xq", name: "Insect swarm" }, // Roj hmyzu
  { id: "N8vIKlNxkA8yf2R4", name: "Greater Swarm of insects" }, // Hejno hmyzu
  { id: "ODDbWcMph5XxYqaz", name: "Metamorphosis" }, // Metamorfóza
];

/**
 * Effect chance nodes.
 *
 *   spec / node   the star that has to be unlocked
 *   schools       the spell's school must be one of these
 *   spells        or: only these pack spells ({id, name})
 *   offensive     only offensive, non-healing spells
 *   damageTypes   the spell deals one of these damage types (dmgType1..4)
 *   poisonBased   the spell deals poison or acid, or is a Venomous Insects
 *                 spell while the caster holds jedovatyHmyz
 *   onlyIfRolled  only raises an effect the spell itself rolls
 *   effect        status id (CONFIG.REDSTEEL.effectDefinitions)
 *   chances       [apprentice, expert, master, grandmaster], or
 *   chance        one flat value
 *   rangeTag      also prints the "+1.5 m" tag (Divoký oheň II)
 */
export const MANCER_EFFECT_NODES = [
  // r875 Bleskový šok: Omráčení na dva tahy.
  { spec: "astramancer", node: "bleskovySok", schools: ["air"], offensive: true, effect: "stagger", chances: [15, 20, 25, 30] },
  // r989 Hluboký mráz I: Zpomalení na tři tahy.
  { spec: "cryomancer", node: "hlubokyMraz1", schools: ["water"], offensive: true, effect: "slow", chances: [15, 20, 25, 35] },
  // r991 Hluboký mráz II: Zmražení.
  { spec: "cryomancer", node: "hlubokyMraz2", schools: ["water"], offensive: true, effect: "freeze", chances: [10, 15, 20, 25] },
  // r993 Hluboký mráz III: Zpomalení +45% (tři tahy) a Zmražení +20%.
  { spec: "cryomancer", node: "hlubokyMraz3", schools: ["water"], offensive: true, effect: "slow", chance: 45 },
  { spec: "cryomancer", node: "hlubokyMraz3", schools: ["water"], offensive: true, effect: "freeze", chance: 20 },
  // r995 Ostrý led: Bodné kouzla Školy Vody, Krvácení 30%.
  { spec: "cryomancer", node: "ostryLed", schools: ["water"], offensive: true, damageTypes: ["piercing"], effect: "bleed", chance: 30 },
  // r1037 / r1039 Travič I / II: na jedu či kyselině založená kouzla, Otrávení.
  { spec: "entomancer", node: "travic1", schools: ["earth"], offensive: true, poisonBased: true, effect: "poison", chances: [20, 30, 35, 45] },
  { spec: "entomancer", node: "travic2", schools: ["earth"], offensive: true, poisonBased: true, effect: "poison", chances: [25, 35, 40, 50] },
  // r1031 Leptavá kyselina I: kyselinová kouzla Školy Země, poškození Kz +15%.
  { spec: "entomancer", node: "leptavaKyselina1", schools: ["earth"], damageTypes: ["acid"], onlyIfRolled: true, effect: "corrosion", chance: 15 },
  // r1081 / r1083 Omračující rány I / II: Omráčení na dva tahy (they stack).
  { spec: "geomancer", node: "omracujiciRany1", schools: ["earth"], offensive: true, effect: "stagger", chances: [10, 15, 20, 25] },
  { spec: "geomancer", node: "omracujiciRany2", schools: ["earth"], offensive: true, effect: "stagger", chances: [10, 15, 20, 25] },
  // r1518 Divoký oheň I: Podpálení.
  { spec: "pyromancer", node: "divokyOhen1", schools: ["fire"], offensive: true, effect: "burn", chances: [5, 10, 15, 20] },
  // r1520 Divoký oheň II: Podpálení +10%, rozsah +1,5 m (no range field the
  // targeting reads, so the reach is a card tag).
  { spec: "pyromancer", node: "divokyOhen2", schools: ["fire"], offensive: true, effect: "burn", chance: 10, rangeTag: true },
  // r1573 Škola Ducha: Ochromení +5% (twice): only a Spirit spell that
  // already rolls Stun (lead interpretation 2026-11-03).
  { spec: "vitamancer", node: "ochromeni1", schools: ["spirit"], onlyIfRolled: true, effect: "stun", chance: 5 },
  { spec: "vitamancer", node: "ochromeni2", schools: ["spirit"], onlyIfRolled: true, effect: "stun", chance: 5 },
  // Kulový blesk: Omráčení +15%.
  { spec: "astramancer", node: "kulovyBlesk", spells: [{ id: "RsYfsuXqYWXCYrRn", name: "Lightning ball" }], effect: "stagger", chance: 15 }, // Kulový blesk
];

/**
 * Extra stacks on an effect the cast rolls (same filters as above).
 * r1033 Leptavá kyselina II: "ničí v případě úspěchu o 4 Kz více" — one more
 * Corrosion stack (-4 Az each, documents/effects.mjs).
 */
export const MANCER_STACK_NODES = [
  { spec: "entomancer", node: "leptavaKyselina2", schools: ["earth"], damageTypes: ["acid"], effect: "corrosion", stacks: 1 },
];

/**
 * Damage dice and Penetration added to one spell's own damage roll.
 * Ohnivý štít: Průbojnost +3, Zranění +1d4. The shield's retaliation is the
 * spell's card rolled again for 0 mana (see its manual note), so the card's
 * damage roll is where it lands.
 */
export const MANCER_DAMAGE_NODES = [
  { spec: "pyromancer", node: "ohnivyStit", spells: [{ id: "5w2ZeER1V6kYvkTt", name: "Flame Shield" }], dice: "1d4", penetration: 3 }, // Ohnivý štít
];

/**
 * Additions baked into an effect a holder's spell creates on its target.
 *   damage   dice appended to the effect's damage formula (onApply and
 *            onRoundStart)
 *   stamina  Stamina restored on each tick of a healing trigger
 * Only the CREATE path reads these: a re-applied effect keeps the formula of
 * whoever first applied it (the effect stores its triggers once).
 */
export const MANCER_TRIGGER_NODES = [
  // r1043 Toxiny: Otrávení způsobuje o 1d6 větší zranění (and +1 round, in
  // helpers/specialisations.mjs EFFECT_DURATION_NODES).
  { spec: "entomancer", node: "toxiny", effect: "poison", schools: ["earth"], damage: "1d6" },
  // Regenerace: Obnovuje 2d4 Výdrže.
  { spec: "geomancer", node: "regeneraceVydrze", effect: "regeneration", schools: ["earth"], stamina: "2d4" },
];

/** Nodes wired by one check in another file. */
export const MANCER_HOOKED_NODES = [
  // documents/effects.mjs _handleBurningPanic: a burning holder takes no
  // Panic test (r1501 "Podpálení nevyvolává Test Nervů na Paniku").
  { spec: "pyromancer", node: "podpaleniPanika" },
  // utils/applyDamage.mjs: a Staggered target Staggered again by the holder's
  // spell is also knocked Prone (r1089 Urhanova síla).
  { spec: "geomancer", node: "urhanovaSila" },
  // Read by the poisonBased filter above (r1045 Jedovatý hmyz).
  { spec: "entomancer", node: "jedovatyHmyz" },
];

/* -------------------------------------------------------------------------- */

/** True if the actor has `spec`'s tree active AND `node` unlocked. */
export function hasMancerNode(actor, spec, node) {
  const tree = actor?.system?.specialisations?.[spec];
  return !!(tree?.active && tree.nodes?.[node]);
}

/** The spell's damage types, lowercased. */
function damageTypesOf(spell) {
  const system = spell?.system ?? {};
  return [system.dmgType1, system.dmgType2, system.dmgType3, system.dmgType4]
    .filter(Boolean)
    .map((type) => String(type).toLowerCase());
}

/**
 * The chances the spell itself authors, keyed by effect name, read the way the
 * cast card reads them (magicSkillBonuses.mjs finalizeRollsAndPostChat):
 * the built-in keys plus every extraN slot named by effectTypeN / effectNameN.
 * -1 means the effect lands automatically.
 */
export function authoredSpellEffects(spell) {
  const system = spell?.system ?? {};
  const effects = system.effects ?? {};
  const out = {};
  for (const key of ["burn", "slow", "stagger", "bleed", "hex"]) {
    const value = Number(effects[key]);
    if (value) out[key] = (out[key] ?? 0) + value;
  }
  for (const index of [1, 2, 3]) {
    const value = Number(effects[`extra${index}`]);
    if (!value) continue;
    const type = String(system[`effectType${index}`] ?? "").toLowerCase();
    const name = type === "custom" ? String(effects[`effectName${index}`] ?? "") : type;
    if (name) out[name] = (out[name] ?? 0) + value;
  }
  return out;
}

/** Whether a table entry applies to this cast. */
function entryApplies(actor, spell, entry, { strike = false } = {}) {
  if (!hasMancerNode(actor, entry.spec, entry.node)) return false;
  const system = spell?.system ?? {};
  if (entry.spells) {
    if (!entry.spells.some((ref) => matchesPackSpell(spell, ref))) return false;
  } else if (entry.schools && !entry.schools.includes(system.type)) {
    return false;
  }
  if (strike && !entry.spells) return false;

  const venomous =
    entry.poisonBased &&
    hasMancerNode(actor, "entomancer", "jedovatyHmyz") &&
    VENOMOUS_INSECT_SPELLS.some((ref) => matchesPackSpell(spell, ref));
  // The node names those three spells outright, so they need not be marked
  // offensive in the pack to count.
  if (entry.offensive && !venomous) {
    if (system.isOffensive !== true || system.isHealing) return false;
  }
  const types = damageTypesOf(spell);
  if (entry.damageTypes && !entry.damageTypes.some((type) => types.includes(type))) {
    return false;
  }
  if (entry.poisonBased && !venomous && !types.includes("poison") && !types.includes("acid")) {
    return false;
  }
  return true;
}

/** The node's chance for this spell's rank. */
function entryChance(entry, spell) {
  if (Array.isArray(entry.chances)) {
    const rank = String(spell?.system?.rank ?? "").toLowerCase();
    return entry.chances[RANK_INDEX[rank] ?? 0] ?? 0;
  }
  return Number(entry.chance) || 0;
}

/**
 * Everything the mancer passives add to one cast.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {{strike?: boolean}} [options]  `strike`: the spell is a strike
 *   (getStrikeId), which only spell-specific entries reach.
 * @returns {{
 *   modifiers: Record<string, number>,
 *   stacks: Record<string, number>,
 *   dice: string[],
 *   penetration: number,
 *   tags: {spec: string, node: string, kind: string, effect?: string,
 *          chance?: number, stacks?: number, dice?: string, penetration?: number}[],
 * }}
 */
export function getMancerCastBonuses(actor, spell, { strike = false } = {}) {
  const result = { modifiers: {}, stacks: {}, dice: [], penetration: 0, tags: [] };
  if (!actor || actor.type !== "character" || spell?.type !== "spell") return result;

  const authored = authoredSpellEffects(spell);
  for (const entry of MANCER_EFFECT_NODES) {
    if (!entryApplies(actor, spell, entry, { strike })) continue;
    const base = authored[entry.effect] ?? 0;
    // Lands automatically already: nothing to add, and adding would turn the
    // auto (-1) into a roll.
    if (base === -1) continue;
    if (entry.onlyIfRolled && !(base > 0)) continue;
    const chance = entryChance(entry, spell);
    if (!chance) continue;
    result.modifiers[entry.effect] = (result.modifiers[entry.effect] ?? 0) + chance;
    result.tags.push({ spec: entry.spec, node: entry.node, kind: "chance", effect: entry.effect, chance });
    if (entry.rangeTag) result.tags.push({ spec: entry.spec, node: entry.node, kind: "range" });
  }

  for (const entry of MANCER_STACK_NODES) {
    if (!entryApplies(actor, spell, entry, { strike })) continue;
    const base = authored[entry.effect] ?? 0;
    if (!base) continue;
    result.stacks[entry.effect] = (result.stacks[entry.effect] ?? 0) + entry.stacks;
    result.tags.push({ spec: entry.spec, node: entry.node, kind: "stacks", effect: entry.effect, stacks: entry.stacks });
  }

  for (const entry of MANCER_DAMAGE_NODES) {
    if (!entryApplies(actor, spell, entry, { strike })) continue;
    if (entry.dice) result.dice.push(entry.dice);
    result.penetration += Number(entry.penetration) || 0;
    result.tags.push({
      spec: entry.spec,
      node: entry.node,
      kind: "damage",
      dice: entry.dice ?? "",
      penetration: Number(entry.penetration) || 0,
    });
  }
  return result;
}

/**
 * The cast card's tags for these bonuses, one `action-tag` span per node,
 * the way the Incantator's cast tags are printed.
 */
export function mancerCastTags(bonuses) {
  const tags = bonuses?.tags ?? [];
  if (!tags.length) return "";
  const nodeLabel = (tag) =>
    game.i18n.localize(`REDSTEEL.Actor.Specialisations.${tag.spec}.nodes.${tag.node}.label`);
  const effectLabel = (effect) => {
    const key = `REDSTEEL.MancerPassive.Effect.${effect}`;
    return game.i18n.has(key) ? game.i18n.localize(key) : effect;
  };
  return tags
    .map((tag) => {
      const node = nodeLabel(tag);
      let text = "";
      if (tag.kind === "chance") {
        text = game.i18n.format("REDSTEEL.MancerPassive.TagChance", {
          node,
          effect: effectLabel(tag.effect),
          chance: tag.chance,
        });
      } else if (tag.kind === "stacks") {
        text = game.i18n.format("REDSTEEL.MancerPassive.TagStacks", {
          node,
          effect: effectLabel(tag.effect),
          stacks: tag.stacks,
        });
      } else if (tag.kind === "range") {
        text = game.i18n.format("REDSTEEL.MancerPassive.TagRange", { node });
      } else if (tag.kind === "damage") {
        // The node's own label already reads "Penetration +3, Damage +1d4".
        text = node;
      }
      return `<span class="action-tag mancer ">${foundry.utils.escapeHTML(String(text))}</span>`;
    })
    .join("");
}

/**
 * Bake a holder's trigger bonuses into the triggers of an effect their spell
 * is about to create (documents/effects.mjs _applySingleEffect, NEW EFFECT
 * path). Mutates the cloned `triggers`.
 *
 * @param {Actor|null} sourceCaster
 * @param {string} effectId
 * @param {string|null} school  The school of the spell that applied it.
 * @param {object} triggers     The effect's cloned trigger block.
 */
export function applyMancerTriggerBonuses(sourceCaster, effectId, school, triggers) {
  if (!sourceCaster || !triggers) return;
  for (const entry of MANCER_TRIGGER_NODES) {
    if (entry.effect !== effectId) continue;
    if (entry.schools && !entry.schools.includes(school)) continue;
    if (!hasMancerNode(sourceCaster, entry.spec, entry.node)) continue;
    for (const key of ["onApply", "onRoundStart"]) {
      const trigger = triggers[key];
      if (!trigger) continue;
      if (entry.damage && trigger.formula) {
        trigger.formula = `${trigger.formula} + ${entry.damage}`;
      }
      if (entry.stamina) trigger.stamina = entry.stamina;
    }
  }
}

/** Urhanova síla: whether a re-Stagger from this caster's spell also floors. */
export function restaggerKnocksProne(caster) {
  return hasMancerNode(caster, "geomancer", "urhanovaSila");
}

/** Podpálení nevyvolává Test Nervů na Paniku: the burning holder is spared. */
export function burnSkipsPanic(actor) {
  return hasMancerNode(actor, "pyromancer", "podpaleniPanika");
}
