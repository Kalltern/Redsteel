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
 *   - MANCER_EFFECT_NODES, MANCER_STACK_NODES, MANCER_DAMAGE_NODES,
 *     MANCER_ARMOR_NODES, MANCER_RANGE_NODES, MANCER_NOTE_NODES:
 *     utils/magicSkillBonuses.mjs (calculateAttackBonuses feeds the effect chances into the cast's
 *     effectModifiers, finalizeRollsAndPostChat adds the damage, penetration,
 *     stacks and extra armor damage and prints the card tags).
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

/** Ohnivá aura (Fire, Expert, range Caster). */
export const FIERY_AURA_SPELL = { id: "tDAGO4o4a0M93UIt", name: "Fiery Aura" };
/** Kyselinová střela (Earth; rolls Corrosion through effectType1). */
export const ACID_BOLT_SPELL = { id: "oDL1c5pJC3yLpKMg", name: "Acid bolt" };
/** Jedová sprška (Earth breath cone). */
export const POISON_SPRAY_SPELL = { id: "2yp4HO3agdSxD8H6", name: "Poison spray" };
/**
 * Protijed: the Earth Antivenom and the Body Antidote carry the same book
 * text, so both are treated the same.
 */
export const ANTIVENOM_SPELLS = [
  { id: "YrB0ZQw1qx6bz5H6", name: "Antivenom" },
  { id: "zqtXUtlAfFNo7Hny", name: "Antidote" },
];

/**
 * Effect chance nodes.
 *
 *   spec / node   the star that has to be unlocked
 *   schools       the spell's school must be one of these
 *   spells        or: only these pack spells ({id, name})
 *   offensive     only offensive, non-healing spells
 *   supportive    only spells that deal no damage (or heal) and are not
 *                 marked offensive
 *   damageTypes   the spell deals one of these damage types (dmgType1..4)
 *   poisonBased   the spell deals poison or acid, or is a Venomous Insects
 *                 spell while the caster holds jedovatyHmyz
 *   onlyIfRolled  only raises an effect the spell itself rolls
 *   effect        status id (CONFIG.REDSTEEL.effectDefinitions), or "chain"
 *                 (Řetězení), "dispel" or "clearStagger" (Rušivá kouzla),
 *                 which are no statuses (see their entries)
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
  // r877 Řetězení: útočná kouzla Školy Vzduchu, šance na Řetězení +35%
  // (+35% více proti Mokrému cíli). "chain" is no status: Apply Damage turns
  // a ticked row into the chain offer (utils/mancerFollowups.mjs
  // offerChaining) and never applies it as an effect. The Wet bonus is not
  // the node's: it restates the general rule (ruzne-info r1365, r1421), and
  // the Wet status's own Active Effect already adds effectMods.chain +35.
  { spec: "astramancer", node: "retezeni", schools: ["air"], offensive: true, effect: "chain", chance: 35 },
  // r879 Dvojité řetězení: šance na Řetězení +15%, a landed chain hops once
  // more (mancerFollowups.mjs claimMancerFollowup).
  { spec: "astramancer", node: "dvojiteRetezeni", schools: ["air"], offensive: true, effect: "chain", chance: 15 },
  // r1601 Rušivá kouzla: "Všechna útočná kouzla Školy Ducha a Protikouzlo
  // mají +25% šanci na zrušení většiny magických efektů. Kouzla Školy Těla
  // mají šanci +25% zrušit Omráčení." Neither row is a status: a ticked row
  // is resolved by both Apply paths before the card's other effects on that
  // target (utils/applyDamage.mjs resolveDisruptiveRows). Dispel deletes the
  // target's spell-made effects; Clear Stagger deletes its Stagger. The Body
  // row is for supportive Body spells only (user ruling 2026-11-20): never a
  // spell that deals damage, and at apply time never on a target hostile to
  // the caster (applyDamage.mjs resolveDisruptiveRows), which catches the
  // debuffs (Weakness, Fatigue, Malaise...) the pack data cannot tell apart.
  // Protikouzlo's part is its card tag (MANCER_NOTE_NODES below).
  { spec: "vitamancer", node: "rusivaKouzla", schools: ["spirit"], offensive: true, effect: "dispel", chance: 25 },
  { spec: "vitamancer", node: "rusivaKouzla", schools: ["body"], supportive: true, effect: "clearStagger", chance: 25 },
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
 * Extra armor damage on an effect the spell itself rolls: `armor` (negative)
 * is added on top of the effect's own armor loss per stack gained
 * (documents/effects.mjs, Corrosion -4 Az a stack), stamped on the card as
 * the effect's `bonusArmor` and passed on by both Apply paths
 * (utils/applyDamage.mjs).
 * r1015 "Kyselinová střela: Dodatečné poškození zbroje -2 Kz".
 */
export const MANCER_ARMOR_NODES = [
  { spec: "entomancer", node: "kyselinovaStrela", spells: [ACID_BOLT_SPELL], effect: "corrosion", armor: -2 },
];

/**
 * Reach added to one spell, printed as the "+1.5 m" card tag. A breath's
 * reach is only a card label (utils/spellCards.mjs) and no cone is placed, so
 * like Divoký oheň II the reach is a tag for the table.
 * r1015 "Jedová sprška: Oblast +1,5m".
 */
export const MANCER_RANGE_NODES = [
  { spec: "entomancer", node: "jedovaSprska", spells: [POISON_SPRAY_SPELL] },
];

/** Řetězový blesk (Air, Master). */
export const CHAIN_LIGHTNING_SPELL = { id: "6tmWw4LBu2plnlRT", name: "Chain lightning" };

/**
 * Spell tweaks the system cannot simulate, printed as a card tag for the
 * table, like MANCER_RANGE_NODES. The tag text is the node's own label.
 *   - Řetězový blesk "Cíl +1": the target cap itself is enforced at cast
 *     (utils/mancerFollowups.mjs spellTargetCapRefusal); the tag reminds the
 *     table of the extra target.
 *   - Bleskové tornádo: the caster steers the tornado; nothing moves it.
 *   - Cyklon "Pohyb +2 hexy": the trapped target is moved by hand.
 *   - Pád pírka: the fall speed is the caster's call at the table.
 *   - Vitamancer (r1576, r1579): Stabilizace "Šance +20%", Lorikovo kopí
 *     "Může jednou změnit směr", Lořino pouto "Potlačuje vyřazení", Magická
 *     stěna "Omráčení je nahrazen Ochromením" and Ochránce's +100% Health
 *     on Bariéra / Pohyblivá bariéra are the table's to apply. Ochránce's
 *     +50% on the three shields is code (documents/effects.mjs). Rušivá
 *     kouzla's tag on Protikouzlo reminds the table of its dispel chance.
 */
export const MANCER_NOTE_NODES = [
  { spec: "astramancer", node: "retezovyBlesk", spells: [CHAIN_LIGHTNING_SPELL] },
  { spec: "astramancer", node: "bleskoveTornado", spells: [{ id: "KzGnfIKSzywBPSYG", name: "Lightning tornado" }] }, // Bleskové tornádo
  {
    spec: "astramancer",
    node: "cyklonPohyb",
    spells: [
      { id: "wJZk56NUwBiZeowm", name: "Cyclone" }, // Cyklon
      { id: "esiBJjncf27psJ48", name: "Cyclone (reaction)" },
    ],
  },
  { spec: "astramancer", node: "padPirka", spells: [{ id: "VTRyOjac7ueNrdSD", name: "Feather fall" }] }, // Pád pírka
  { spec: "vitamancer", node: "stabilizace", spells: [{ id: "kC8ivAu54ZmUDWc1", name: "Stabilization" }] }, // Stabilizace
  { spec: "vitamancer", node: "lorikovoKopi", spells: [{ id: "b27vy7aWB4YpoZ1R", name: "Lorik's spear" }] }, // Lorikovo kopí
  { spec: "vitamancer", node: "lorinoPouto", spells: [{ id: "TNSdSFAUN8G3FJnb", name: "Lorina's bond" }] }, // Lořino pouto
  { spec: "vitamancer", node: "magickaStena", spells: [{ id: "VJqy6z6FFwG6g63o", name: "Mystical wall" }] }, // Magická stěna
  {
    spec: "vitamancer",
    node: "ochrance",
    spells: [
      { id: "96HAOmiMMAwNP25t", name: "Barrier" }, // Bariéra
      { id: "TIxSNaM84xUaya5O", name: "Mobile barrier" }, // Pohyblivá bariéra
    ],
  },
  { spec: "vitamancer", node: "rusivaKouzla", spells: [{ id: "spJHgIWzpbHaDnpp", name: "Counterspell" }] }, // Protikouzlo
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
  // utils/mancerFollowups.mjs spellTargetCapRefusal, asked by
  // utils/castSpell.mjs performCast: Ice lance takes three targets, not two
  // (r967 Ledové kopí).
  { spec: "cryomancer", node: "ledoveKopi" },
  // utils/mancerFollowups.mjs offerIceShards, called by utils/applyDamage.mjs
  // applyDamageAsGM: a kill by the holder's Frost Water spell splits its
  // excess damage among the neighbours (r987 Ledové úlomky).
  { spec: "cryomancer", node: "ledoveUlomky" },
  // utils/mancerFollowups.mjs sacrificeStoneSkin, called by
  // utils/applyDamage.mjs applyDamageAsGM: sacrificing the holder's Stone Skin
  // Staggers the neighbours the wearer picks (r1064 Kamenná kůže).
  { spec: "geomancer", node: "kamennaKuze" },
  // utils/mancerFollowups.mjs firmStepAdvantage, called by
  // utils/attributeFollowup.mjs rollAttributeFollowup: Advantage on the answer
  // to Roots, Quicksand and a Prone test. The system has no Difficult Terrain
  // to waive (r1087 Pevný krok, lead ruling 2026-11-17).
  { spec: "geomancer", node: "pevnyKrok" },
  // utils/mancerFollowups.mjs fieryAuraBurnBonus, asked by
  // utils/applyDamage.mjs openDamageSelectionDialog: a hostile target near
  // the holder's Fiery Aura takes Burn at +15% instead of +10% (r1501 Ohnivá
  // aura). The aura itself is put on the caster by applyFieryAura, called by
  // utils/castSpell.mjs applyPostCastEffects.
  { spec: "pyromancer", node: "ohnivaAura" },
  // documents/effects.mjs _resolveAntivenomCure: the holder's Antivenom /
  // Antidote cures Poison at +25% (r1012 Protijed). The cast card carries the
  // antivenom effect (utils/magicSkillBonuses.mjs finalizeRollsAndPostChat).
  { spec: "entomancer", node: "protijed" },
  // utils/mancerFollowups.mjs offerPoisonerRedirect, called by
  // utils/applyDamage.mjs applyDamageAsGM and applyEffectsAsGM: Poison from
  // the holder's Earth spell on an already Poisoned target may go to a
  // neighbour instead (r1041 Travič III).
  { spec: "entomancer", node: "travic3" },
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
  // A supportive row skips any spell that hurts: marked offensive, or dealing
  // damage of some type without healing. The pack marks no Body spell
  // offensive, so the damage types are what catch Pressure strike, Shockwave
  // and Shatter bones.
  if (entry.supportive) {
    if (system.isOffensive === true) return false;
    if (types.length && !system.isHealing) return false;
  }
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
 *   armor: Record<string, number>,
 *   dice: string[],
 *   penetration: number,
 *   tags: {spec: string, node: string, kind: string, effect?: string,
 *          chance?: number, stacks?: number, dice?: string, penetration?: number}[],
 * }}
 */
export function getMancerCastBonuses(actor, spell, { strike = false } = {}) {
  const result = { modifiers: {}, stacks: {}, armor: {}, dice: [], penetration: 0, tags: [] };
  if (!actor || spell?.type !== "spell") return result;

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

  for (const entry of MANCER_ARMOR_NODES) {
    if (!entryApplies(actor, spell, entry, { strike })) continue;
    // Only an effect the spell itself rolls or lands.
    const base = authored[entry.effect] ?? 0;
    if (!(base > 0 || base === -1)) continue;
    result.armor[entry.effect] = (result.armor[entry.effect] ?? 0) + entry.armor;
    result.tags.push({ spec: entry.spec, node: entry.node, kind: "node" });
  }

  for (const entry of MANCER_RANGE_NODES) {
    if (!entryApplies(actor, spell, entry, { strike })) continue;
    result.tags.push({ spec: entry.spec, node: entry.node, kind: "range" });
  }

  for (const entry of MANCER_NOTE_NODES) {
    if (!entryApplies(actor, spell, entry, { strike })) continue;
    result.tags.push({ spec: entry.spec, node: entry.node, kind: "node" });
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
      } else if (tag.kind === "damage" || tag.kind === "node") {
        // The node's own label already says it ("Penetration +3, Damage
        // +1d4", "Additional armor damage -2").
        text = node;
      }
      return `<span class="action-tag mancer ">${foundry.utils.escapeHTML(String(text))}</span>`;
    })
    // A space between pills: each pill is nowrap, so without one the whole
    // row is a single unbreakable word that pushes the chat card wider.
    .join(" ");
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

/**
 * Stone Skin's armored test: "An unarmored target gains 15 armor and 1 armor
 * durability. An already armored one gains 2." Armored = equipped gear on the
 * Bottom, Middle or Top layer. Read by documents/effects.mjs _handleStoneSkin
 * (the armor) and utils/mancerFollowups.mjs getStoneSkinDurability (the
 * durability), so the two cannot disagree. Here because both files already
 * import this one.
 */
export function wearsStoneSkinArmor(actor) {
  return (actor?.items?.contents ?? []).some(
    (item) =>
      item.type === "gear" &&
      item.system?.equipped === true &&
      ["Bottom", "Middle", "Top"].includes(item.system?.layer),
  );
}
