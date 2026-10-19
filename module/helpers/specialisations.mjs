import { REDSTEEL } from "./config.mjs";
import {
  GENERATED_SPECS,
  STATE_GATED_IMMUNITIES,
} from "./specialisations-generated.mjs";
import { SPEC_DISCOUNTS } from "./rankDiscounts.mjs";
import { SPEC_MIRRORS } from "./rankMirrors.mjs";

/* ===========================================================================
 * Specialisation talent-tree definitions
 *
 * Source: "Pravidla pro ToS V12.1 (WIP).xlsx" → sheet "Specializace (WIP)".
 * The sheet's horizontal chains become vertical columns here: each chain is
 * one column, nodes in order top→bottom, every node requiring the previous
 * one. Unchained nodes are scattered into free columns, placed deeper the
 * higher their rank requirement is. Finisher bonuses are not implemented.
 *
 * Node format:
 *  tier     – row in the tree, 1 = top
 *  column   – column in the tree (may be fractional for centering)
 *  requires – ids of nodes that must ALL be unlocked before this one;
 *             every entry is also drawn as a connecting line
 *  hiddenLinks – subset of `requires` that is enforced but NOT drawn. Rank
 *             hubs gate half a tree at once, so on a long chain the tether back
 *             to the hub can cross the whole panel and cut through unrelated
 *             stars. Listing it here keeps the requirement real (unlock, relock
 *             and the description text are all unaffected — they read
 *             `requires`) while letting the figure stay legible. Use sparingly:
 *             a hidden gate is only honest when the node's own description
 *             names it.
 *  icon     – optional image path for future node graphics ("" for now)
 *  passive  – null for manual ("shine up only") nodes, or:
 *               changes         – ActiveEffect changes ({key, mode, value}),
 *                                 applied as a permanent ActiveEffect
 *               combatModifiers – a combat-modifier group written to
 *                                 system.activeCombatEffects (same format the
 *                                 effect definitions in config.mjs use:
 *                                 damageBonus, damageRoll, penetrationBonus,
 *                                 extraEffects {bleed/stun/precision: %}, …)
 *             Both are created on unlock and removed on lock by
 *             syncSpecialisationPassive.
 *  autoUnlock – true for a node that comes with its specialisation instead of
 *             being bought (Magic Blood): unlocked while the specialisation is
 *             active, locked once it is not, never toggled by hand. Kept in
 *             step by syncAutoSpecNodes (progressionEngine.mjs).
 *
 * Label/description localization keys are injected automatically from the
 * spec id and node id (REDSTEEL.Actor.Specialisations.<spec>.nodes.<node>).
 * ======================================================================== */

/** ActiveEffect ADD change. */
const add = (key, value) => ({
  key,
  type: "add",
  value,
});

/** Passive backed by ActiveEffect changes. */
const ae = (...changes) => ({ changes });

/** Passive backed by a combat-modifier group (system.activeCombatEffects). */
const cm = (combatModifiers) => ({ combatModifiers });

/**
 * S3 — crit-degree effect triggers. When a caster owns one of these nodes and
 * their spell scores a critical of degree ≥ minDegree, the named status is
 * added to the attack card's mechanical effects:
 *   mode "boost" — the spell must already cast `effect`; its chance gets +100
 *                  (a rolled effect becomes guaranteed on a large enough crit).
 *   mode "force" — the effect is injected at a guaranteed chance even when the
 *                  spell did not carry it (e.g. geomancer knockdown).
 * The four node ids are globally unique today, but we key by spec for safety.
 * Consumed in utils/magicSkillBonuses.mjs (spell crit path).
 */
export const CRIT_DEGREE_TRIGGERS = [
  { spec: "astramancer", node: "omraceniKrit", effect: "stun", minDegree: 2, mode: "boost" },
  { spec: "cryomancer", node: "zmrazeniKrit", effect: "freeze", minDegree: 4, mode: "boost" },
  { spec: "pyromancer", node: "podpaleniKrit", effect: "burn", minDegree: 3, mode: "boost" },
  { spec: "geomancer", node: "povaleni", effect: "prone", minDegree: 3, mode: "force" },
];

/** True if the actor has `specId`'s tree active AND `nodeId` unlocked. */
export function actorHasSpecNode(actor, specId, nodeId) {
  const spec = actor.system?.specialisations?.[specId];
  return !!(spec?.active && spec.nodes?.[nodeId]);
}

/** School of Blood ranks that each carry the Blood magic attack/defense bonus. */
const BLOOD_SCHOOL_RANK_NODES = ["expert", "master", "grandmaster"];
const BLOOD_SCHOOL_RANK_BONUS = 5;

/**
 * "Škola Krve: Magický útok +5%" and "Magická obrana proti kouzlům Školy Krve
 * +5%", granted by each of Expert, Master and Grandmaster: +5 per rank to Magic
 * ATK when casting a Blood spell, and to Magic Defense against one.
 *
 * Read at roll time instead of stored as an Active Effect, because it only
 * applies to Blood spells, and because a node's passive effect is created once
 * on unlock, so characters already past Expert would never receive it.
 */
export function getBloodSchoolRankBonus(actor) {
  const ranks = BLOOD_SCHOOL_RANK_NODES.filter((node) =>
    actorHasSpecNode(actor, "bloodSchool", node),
  ).length;
  return ranks * BLOOD_SCHOOL_RANK_BONUS;
}

/**
 * True for a node that comes with its specialisation instead of being bought
 * (`autoUnlock` on the definition). See syncAutoSpecNodes.
 */
export function isAutoUnlockNode(specId, nodeId) {
  return REDSTEEL.specialisations?.[specId]?.nodes?.[nodeId]?.autoUnlock === true;
}

/** The subset of CRIT_DEGREE_TRIGGERS the actor actually owns. */
export function getCritDegreeTriggers(actor) {
  return CRIT_DEGREE_TRIGGERS.filter((t) =>
    actorHasSpecNode(actor, t.spec, t.node),
  );
}

/**
 * S3 — "<School>: Critical Range +2". Every mancer tree (plus Maleficarum and
 * the School of Blood) buys the same node.
 *
 * This is crit RANGE, not crit chance: it does nothing to the odds of critting
 * (that band is Luck plus globalCritBonus). It is a flat bonus on the 1d20
 * crit-score roll that buckets a landed critical into its four degrees — the
 * caster's own critRangeCast (from Intelligence) plus this, exactly as a weapon
 * adds critRangeMelee plus its doctrine bonus. So the node makes a critical
 * *worse for the target*, not more frequent: +2 moves the 1-6/7-12/13-18/19+
 * ladder two points up, which is a better degree roughly one roll in ten.
 *
 * Each node counts for its OWN school only: an Astramancer's criticals bite
 * deeper on Air spells and are untouched on anything else. Vitamancer is the
 * one tree covering two schools, because it is the School of Spirit AND Body.
 * Entomancer has no such node in the book, so it gets none here.
 *
 * The schools are disjoint by design, so a caster never collects the same
 * school twice; the lookup sums anyway, so a future tree sharing a school
 * would stack instead of silently dropping one.
 *
 * Read at cast time rather than stored as an ActiveEffect for the same two
 * reasons as getBloodSchoolRankBonus: it is school-scoped, and an AE created
 * once on unlock would miss actors who already own the node.
 * Consumed in utils/magicSkillBonuses.mjs (the crit-score roll).
 */
export const SCHOOL_CRIT_RANGE_NODES = [
  { spec: "astramancer", node: "kritRozsah", schools: ["air"] },
  { spec: "cryomancer", node: "kritRozsah", schools: ["water"] },
  { spec: "geomancer", node: "kritRozsah", schools: ["earth"] },
  { spec: "pyromancer", node: "kritRozsah", schools: ["fire"] },
  { spec: "maleficarum", node: "kritRozsah", schools: ["darkness"] },
  { spec: "vitamancer", node: "kritRozsah", schools: ["spirit", "body"] },
  { spec: "bloodSchool", node: "kritRozsah2", schools: ["blood"] },
];

/** Points of critical range each of those nodes is worth. */
const SCHOOL_CRIT_RANGE_BONUS = 2;

/**
 * Critical range the actor's specialisations add to a cast of `school`.
 *
 * @param {Actor} actor
 * @param {string} school  Spell school key (spell.system.type).
 * @returns {number} Points added to the 1d20 crit-score roll, 0 if none.
 */
export function getSchoolCritRangeBonus(actor, school) {
  if (!school) return 0;
  return SCHOOL_CRIT_RANGE_NODES.reduce(
    (sum, entry) =>
      entry.schools.includes(school) &&
      actorHasSpecNode(actor, entry.spec, entry.node)
        ? sum + SCHOOL_CRIT_RANGE_BONUS
        : sum,
    0,
  );
}

/**
 * S3 — spec nodes that make an effect the owner inflicts last longer
 * ("Weaken: Duration +1 turn"). Several trees buy this same kind of small
 * prolongation, so they are declared here as data instead of each one growing
 * its own special case inside the effect code.
 *
 * Entry format:
 *   spec / node  – the star that has to be unlocked
 *   effect       – effect id as it appears in CONFIG.REDSTEEL.effectDefinitions
 *                  (the status id, e.g. "weak", "bleed", "burn")
 *   turns        – extra turns of the TARGET's clock (defaultTurns effects)
 *   rounds       – extra combat rounds (defaultRounds effects)
 *   schools      – optional: only when the effect arrives from a spell of one
 *                  of these schools. Leave it off for a source-agnostic node.
 *                  A manual toggle carries no school, so a school-scoped node
 *                  deliberately does nothing there — the GM types the number.
 *
 * The bonus only ever lengthens a clock that is already running: an effect
 * applied with no duration stays permanent rather than becoming a 1-turn one.
 * Consumed in documents/effects.mjs (_applySingleEffect).
 */
export const EFFECT_DURATION_NODES = [
  // "Oslabení: Trvání +1 kolo" — the School of Blood's Weaken (3 → 4 turns).
  {
    spec: "bloodSchool",
    node: "oslabeniTrvani",
    effect: "weak",
    schools: ["blood"],
    turns: 1,
  },
];

/**
 * Extra duration the actor's specialisations add to an effect they are
 * applying. Both numbers are returned so an effect measured in rounds and one
 * measured in the target's turns can be covered by the same table.
 *
 * @param {Actor} actor         The source of the effect (caster / attacker).
 * @param {string} effectId     Canonical effect id.
 * @param {object} [options]
 * @param {string|null} [options.school]  Spell school the effect arrived from.
 * @returns {{turns: number, rounds: number}}
 */
export function getEffectDurationBonus(actor, effectId, { school = null } = {}) {
  const bonus = { turns: 0, rounds: 0 };
  if (!actor || !effectId) return bonus;

  for (const entry of EFFECT_DURATION_NODES) {
    if (entry.effect !== effectId) continue;
    if (entry.schools && !entry.schools.includes(school)) continue;
    if (!actorHasSpecNode(actor, entry.spec, entry.node)) continue;
    bonus.turns += entry.turns ?? 0;
    bonus.rounds += entry.rounds ?? 0;
  }
  return bonus;
}

/**
 * Nodes that ARE automated but carry no `passive` block of their own, because
 * the code implementing them lives somewhere else entirely. The tree paints a
 * node's status dot from this plus `passive` / `bane` / `automated: true`;
 * anything left over is a table ruling — the sheet tracks the node, the GM
 * applies the rule at the table.
 *
 * Each entry names the file that does the work, so the list can be checked.
 * Wiring a node up in code means adding it here.
 */
const CODE_AUTOMATED_NODES = {
  // utils/alchemy.mjs — the craft roll (advantage, critical-failure relief,
  // duplication, guaranteed success, ingredient discount) and the crafted
  // potion's stored numbers (toxicity, healing dice, stop-bleed chance).
  alchemist: [
    ...["lek", "jed", "pet", "olej", "mast", "droga"].flatMap((fam) => [
      `${fam}Duplikace1`,
      `${fam}Duplikace2`,
      `${fam}Duplikace3`,
      `${fam}Vyhoda`,
      `${fam}KritNeuspech`,
    ]),
    "lekToxicita",
    "lecZivoty1",
    "lecZivoty2",
    "lecZastaveni1",
    "lecZastaveni2",
    "garantovanyUspech",
    "meneIngredienci",
  ],
  // utils/combatSkillBonuses.mjs reads the node when the attack is rolled (the
  // sneak dice are pre-rolled and parked on the card even with the box
  // unticked), and utils/applyDamage.mjs spends it: a blow applied as a critical
  // is promoted to a Sneak Attack against any target whose once-per-round
  // allowance is still free, tracked in utils/sneakLedger.mjs.
  // (weakSpotMastery is utils/abilityGrants.mjs: it grants Improved Exploit
  // Weakness and its throwing version, replacing the ordinary pair.
  // backDodge is utils/defense.mjs: a Blindside Dodge button in the defense
  // dialog, which rolls the ordinary dodge at -20%.)
  // (outnumberSneak is utils/sneakTriggers.mjs: it adds the "outnumbered 2:1"
  // promotion clause to the trigger list stamped on the attack card, which
  // utils/applyDamage.mjs answers against each victim as damage is applied.)
  // (calculation is utils/aim.mjs, getCalculationCritHit/-CritDefense, read by
  // utils/combatSkillBonuses.mjs (attack crit range) and utils/defense.mjs
  // (weapon defense crit range) while an Aim points at the other side.
  // aimedAttack is utils/combatSkillBonuses.mjs: +5 against the aimed-strike
  // penalty. speedTests is utils/speedTest.mjs: advantage on every
  // rollSpeedTest, the versus Speed Test path. daggerDefense is
  // documents/actor.mjs: a main-hand dagger's Defense penalty cancelled in the
  // derived melee defense. quickFeet is utils/abilityMovement.mjs
  // (declareQuickFeetStep) with utils/combatAbilities.mjs and
  // utils/redsteelHotbar.mjs: the step around the opponent, then the swing.)
  shadow: [
    "critAsSneak",
    "weakSpotMastery",
    "backDodge",
    "outnumberSneak",
    "calculation",
    "aimedAttack",
    "speedTests",
    "daggerDefense",
    "quickFeet",
  ],
  // utils/weakSpot.mjs — weakSpotPen adds 10 Penetration to every action in the
  // Exploit Weakness family, folded in by utils/basicAttack.mjs (the throwing
  // versions, which ride an ordinary attack) and utils/combatAbilities.mjs.
  // utils/weaponMaster.mjs holds the shared reads (topmost armor layer's
  // class, active main weapon's class) for the rest of the tree:
  // mistrZbrani is helpers/progressionEngine.mjs (further weapon skills priced
  // in the Learn window, free Weapon Specialization copies). vycvikSeZbrani is
  // documents/actor.mjs (light: Dex melee crit range), combatSkillBonuses.mjs
  // (medium crit hit, heavy crit damage/penetration) and utils/defense.mjs
  // (medium crit defense). primaryDamage is documents/item.mjs (the attribute
  // term of the weapon formula x1.5). zbrojnos1 is utils/applyDamage.mjs
  // (light: durability sacrifice) and utils/rerolls.mjs NODE_REROLL_POOLS
  // (heavy: the node's own once a day reroll). zbrojnos2 is utils/defense.mjs
  // (light: dodge crit and cost; heavy: Deflect). veteran1 is
  // utils/applyDamage.mjs (the Veteran toggle), veteran2 utils/veteranRest.mjs
  // (Free rest on a Critical Defense). presileni is utils/overpower.mjs,
  // odrazeni utils/brace.mjs, bdelyOchrance the Vigilant chip, all three
  // offered by utils/actionSuggestions.mjs. rychlaReakce is
  // utils/combatAbilities.mjs (the improved_fast_reaction +1 Reaction).
  // vytrvalyValecnik is utils/enduringWarrior.mjs: the "Missed" button on
  // the attack card, fed the Stamina paid by deductAbilityCost.
  // vylZbranoveDovednosti is utils/abilityGrants.mjs
  // (IMPROVED_WEAPON_SKILL_PAIRS): each base Feint / Splintering Strike /
  // Staggering Blow / Trip the actor holds is swapped for its improved item.
  // utils/grimm.mjs: metlaIniciativa is the +3 in documents/combat.mjs
  // rollInitiative when a Bane (or an Expose Weakness mark) is among the
  // enemies; metlaOpakovani is a node reroll pool in utils/rerolls.mjs
  // NODE_REROLL_POOLS, gated on the `bane` token redsteel.mjs
  // handleRerollClick adds. metlaVnimani and tkane1/2 stay table rulings.
  grimm: ["metlaIniciativa", "metlaOpakovani"],
  weaponMaster: [
    "weakSpotPen",
    "vytrvalyValecnik",
    "mistrZbrani",
    "vycvikSeZbrani",
    "primaryDamage",
    "zbrojnos1",
    "zbrojnos2",
    "veteran1",
    "veteran2",
    "presileni",
    "odrazeni",
    "bdelyOchrance",
    "rychlaReakce",
    "vylZbranoveDovednosti",
  ],
  // utils/abilityGrants.mjs — unlocking the node grants an ability item.
  // (improvedAim and aimReduction are also read by utils/aim.mjs: the first for
  // the +10 penetration and Advanced Aim, the second for aim reduction on a hit
  // plus the Sneak Attack grant.)
  // (vyhodnyManevr is utils/aim.mjs + utils/advantageousManeuver.mjs: the same
  // defense-card button as the Sword Dancer's, gated on a two-handed sword.)
  // (chargeDamage grants Improved Charge, the +1d4 Charge, in place of Charge.
  // priskok is also utils/actionSuggestions.mjs + utils/abilityMovement.mjs:
  // the off-turn hotbar chip against a melee attack from beyond the next hex,
  // and the free hex toward the attacker. presneRozseknuti is utils/aim.mjs:
  // Cleave stops being Aim-neutral. dexTests is utils/testRating.mjs:
  // +10 on both sides of a Dexterity versus Test. vylUtokSPohybem is
  // utils/abilityMovement.mjs, grantPassingStrikeStep: the step after an
  // off-turn retaliation; the same node on swordDancer and champion.
  // draciStraz is utils/dragonGuard.mjs: the Hit bonus read in
  // utils/combatSkillBonuses.mjs getAttackRolls, Exploit Weakness as a
  // retaliation in utils/actionTracker.mjs (Reaction cost) and
  // utils/actionSuggestions.mjs (hotbar chip). draciSpanek is
  // utils/dragonSleep.mjs, run from the stance branch of
  // utils/combatAbilities.mjs; the hotbar drops Riposte while it holds.
  // ripostaFree / ripostaStamina / ripostaCrit and chargeDistance are
  // utils/swordServant.mjs: read by utils/actionTracker.mjs (the free
  // Riposte), utils/combatAbilities.mjs deductAbilityCost (Stamina -4) and
  // the charge declaration, and utils/combatSkillBonuses.mjs (the crit).
  // draciVypad is utils/actionSuggestions.mjs: the hotbar chip beside
  // Riposte; its card already rolls the Speed contest. prosmyknuti is
  // utils/slipThrough.mjs, stamped in utils/applyDamage.mjs.)
  swordServant: [
    "draciStraz",
    "draciSpanek",
    "ripostaFree",
    "ripostaStamina",
    "ripostaCrit",
    "chargeDistance",
    "draciVypad",
    "prosmyknuti",
    "odvetnyUder",
    "improvedAim",
    "aimReduction",
    "utokSPohybem",
    "vyhodnyManevr",
    "chargeDamage",
    "priskok",
    "presneRozseknuti",
    "dexTests",
    "vylUtokSPohybem",
  ],
  // (hoplite: nabodnuti and velkeTvory are the grants above. The rest is
  // utils/hoplite.mjs, the Hoplite batch 1 rules. silaObratnost is the
  // Strength + Dexterity attribute term in utils/weaponFormula.mjs
  // weaponDamageFormula. hexAttack lets the line pass an opponent in
  // utils/positioning.mjs checkMeleeReach. troufalyVrh: the refusals
  // (adjacent enemy, beyond 5 hexes, no spear/trident/javelin) in
  // utils/combatAbilities.mjs onAbilityChosen, the melee spear thrown as a
  // polearm throw (utils/hoplite.mjs asDaringThrowView, routed by
  // weaponSelectionFlow), the +40 margin crit in utils/combatSkillBonuses.mjs
  // getAttackRolls, the "Draw a light weapon" chip in
  // utils/actionSuggestions.mjs hopliteChips, and its shield strain +50% in
  // utils/combatSkillBonuses.mjs getEffectRolls (DARING_THROW_SHIELD_STRAIN,
  // rolled by utils/shieldStrain.mjs). momentum and postup are stamped by
  // utils/applyDamage.mjs applyDamageAsGM (offerMomentum in
  // utils/momentum.mjs, shared with the doctrine Momentum, and
  // offerHopliteAdvance) and used from their chips; postup's step is the
  // `advance` mode in utils/movementZones.mjs. raznyPostup is
  // completeHopliteAdvance, from utils/redsteelHotbar.mjs _onConfirmMovement
  // and documents/token.mjs endWalkedBonusStep, through
  // utils/actionTracker.mjs grantFreeAbility. napor1 and napor2 are
  // utils/hoplite.mjs offerHopliteOnslaught, called from utils/applyDamage.mjs
  // applyDamageAsGM with the push results utils/forcedMovement.mjs
  // resolvePushOnHit returns and the newly Prone targets, plus the active GM
  // queue registerHopliteHooks (lost versus Test or Defense, Onslaught II);
  // the chip's attack or weapon switch is useHopliteOnslaught.
  // prilezitostnyUtok is utils/hoplite.mjs claimHopliteFreeOpportunity, called
  // from utils/attackActions.mjs where the plain Attack pays its Reaction.
  // pripravnyPostoj is the prepared_stance status (helpers/config.mjs), set in
  // utils/combatAbilities.mjs runUtilityAbility, spent or broken by
  // utils/hoplite.mjs settlePreparedStance in utils/combatSkillBonuses.mjs
  // getAttackRolls and by the moveToken hook in registerHopliteHooks.
  // obranaProtiZteci: filterChargeDefense and hopliteModifierCosts in
  // utils/attackActions.mjs and utils/combatAbilities.mjs, and
  // settleChargeDefense from utils/applyDamage.mjs, which ends the charge
  // through utils/actionTracker.mjs stopMovementLock.)
  // (warden batch 1: redukceBoku is utils/positioning.mjs flanksReduced,
  // applied inside attackSector, so the Flanking pill, the Sneak Attack flank
  // clause and the sector stamped on attack cards all read a flank blow as a
  // front one. zatizeniStitu is utils/shieldStrain.mjs effectiveStrainChance,
  // -15 on the Zatížení štítu roll after a successful Cover. opakovaniKrytu is
  // a NODE_REROLL_POOLS entry in utils/rerolls.mjs, once a day on a Cover.
  // Batch 2: uderZraneniA, uderZraneniB, uderZraneniSila and uderSila10 are
  // utils/warden.mjs shieldBlowDamageExtra / shieldBlowTestBonus, read in
  // utils/combatSkillBonuses.mjs getNonWeaponAbility for the four shield
  // blows. bonusZaStit is utils/wardenShield.mjs wardenShieldBonus: the Shield
  // Bash discount (utils/combatAbilities.mjs deductAbilityCost), Stagger
  // (getNonWeaponAbility), Critical Defense and Deflect (utils/defense.mjs),
  // Strength Tests (utils/testRating.mjs versusTestBonus and
  // getNonWeaponAbility). spolehlivyStit1 is the per-point sacrifice in
  // utils/applyDamage.mjs getDurabilityReductionPerPoint; spolehlivyStit2 is
  // wardenShieldDurabilityMax, read by sheets/actor-sheet.mjs and the Apply
  // Damage dialog. uderStitemOdveta: the chip in utils/actionSuggestions.mjs
  // reactionChips, the Reaction cost in warden.mjs wardenActionCostItems and
  // the "retaliation" tag in getNonWeaponAbility. dvojityUder: the Double
  // Strike grant above plus warden.mjs doubleStrikeRefusal (from
  // combatAbilities.mjs) and the per-defender answer in
  // utils/forcedMovement.mjs resolvePushOnHit. obrannyPostojSpojenci is the
  // aura warden.mjs wardenAllyDefenseBonus in utils/defense.mjs
  // buildDefenseProfile. vylObrannyPostoj: the item grant above plus the
  // shared free Armoring (wardenActionCostItems) or Slow Movement
  // (claimWardenFreeSlowMovement from utils/redsteelHotbar.mjs). ochranaVolna
  // is wardenActionCostItems on the Guard (utils/protection.mjs).
  // protiutokZasah is counterattackHitBonus in combatSkillBonuses.mjs
  // getAttackRolls. vylObrneni: the item grant above plus warden.mjs
  // useImprovedArmoring through utils/armoring.mjs.)
  warden: [
    "redukceBoku",
    "zatizeniStitu",
    "opakovaniKrytu",
    "uderZraneniA",
    "uderZraneniB",
    "uderZraneniSila",
    "uderSila10",
    "bonusZaStit",
    "spolehlivyStit1",
    "spolehlivyStit2",
    "uderStitemOdveta",
    "dvojityUder",
    "obrannyPostojSpojenci",
    "vylObrannyPostoj",
    "ochranaVolna",
    "protiutokZasah",
    "vylObrneni",
  ],
  hoplite: [
    "nabodnuti",
    "velkeTvory",
    "silaObratnost",
    "hexAttack",
    "troufalyVrh",
    "momentum",
    "postup",
    "raznyPostup",
    "napor1",
    "napor2",
    "prilezitostnyUtok",
    "pripravnyPostoj",
    "obranaProtiZteci",
  ],
  // (vylUtokSPohybem: see swordServant.)
  // utils/champion.mjs — the off-hand reads. stredniZbran is the off-hand
  // equip gate in sheets/actor-sheet.mjs (_offhandMediumRefused).
  // bonusDruhaZbran1 folds into utils/combatSkillBonuses.mjs
  // getActorCombatModifiers (axe bleed, blunt penetration) and utils/defense.mjs
  // buildDefenseProfile (sword crit Defense / crit Dodge). bonusDruhaZbran2:
  // the Light / Katar branch is a NODE_REROLL_POOLS entry in utils/rerolls.mjs
  // (requiresOffhand), the Medium branch is the penetration in
  // getActorCombatModifiers and the Reckless Strike / Charge dice in
  // utils/combatAbilities.mjs runAttackMacro. smrstUtoku is the Flurry Hit
  // bonus in utils/combatSkillBonuses.mjs getAttackRolls. presilaPostih is
  // utils/overwhelm.mjs overwhelmPenaltyFor, read by utils/defense.mjs and the
  // Overwhelm marker. bonusDruhaZbran3 is wired the same way (crit range,
  // crit damage / penetration in getCriticalRolls, stagger, precision, crit
  // Defense / Dodge); its blunt push on re-staggering a staggered target is
  // utils/champion.mjs offerChampionRestaggerPush, called from
  // utils/applyDamage.mjs applyDamageAsGM (a "Push back" button per target,
  // through utils/forcedMovement.mjs). zatlaceni is utils/champion.mjs too:
  // the modifier's test is skipped on the card in utils/combatAbilities.mjs
  // and utils/basicAttack.mjs, the card's Push Back button rolls it with
  // Advantage on a hit, and the registerChampionHooks GM queue pushes the
  // target and moves the attacker into the vacated hex on a won contest.
  // vetrnyPostoj is utils/champion.mjs registerChampionHooks (the two-enemy
  // count, on the active GM) applying the wind_stance status from
  // helpers/config.mjs (+5 melee Defense); its +5 Hit is
  // championWindStanceHit in utils/combatSkillBonuses.mjs getAttackRolls.
  // klamavyUtok: the Advantage in getAttackRolls, no Riposte / Dragon Strike /
  // Retaliation chip in utils/actionSuggestions.mjs, and the follow-up Attack
  // under Wind Stance is utils/champion.mjs settleChampionFeint, called from
  // utils/applyDamage.mjs. utokPoZteci is utils/champion.mjs
  // grantChargeFollowUp, called from utils/combatAbilities.mjs after a
  // charge's first attack card. ztecSRozseknutim is the charge approach in
  // utils/abilityMovement.mjs (isCharge, declareChargeMove) launched from the
  // hotbar's check button, whose swing opens the Multi-Attack chain in
  // utils/combatAbilities.mjs for the second target.
  champion: [
    "odvetnyUder",
    "riposta",
    "vylUtokSPohybem",
    "stredniZbran",
    "bonusDruhaZbran1",
    "bonusDruhaZbran2",
    "smrstUtoku",
    "presilaPostih",
    "vetrnyPostoj",
    "klamavyUtok",
    "utokPoZteci",
    "ztecSRozseknutim",
    "zatlaceni",
    "bonusDruhaZbran3",
  ],
  // utils/vanguard.mjs, the Vanguard batch 1 rules (prubojnost2 and
  // ocelovyStisk are node passives). rozrazeni (batch 2) is the Bull Charge
  // grant above plus utils/bullCharge.mjs: the refusal and payment in
  // utils/combatAbilities.mjs, the lock stamp in utils/abilityMovement.mjs
  // declareChargeMove, the zone in utils/movementZones.mjs, the contests in
  // its preMoveToken hook, the Opportunity Attack chip in
  // utils/actionSuggestions.mjs.
  // ztecPohyb50 / ztecPohyb100 are vanguardChargeBudget, read by
  // utils/abilityMovement.mjs declareChargeMove. ztecZraneniHexa is
  // vanguardChargeHexDamage, read by utils/combatAbilities.mjs runAttackMacro
  // and utils/combatSkillBonuses.mjs getNonWeaponAbility (Shield Charge).
  // zatlaceni and ztecSRozseknutim are the grants above (Push Back, Charge
  // with Cleave), item driven like the Champion's. momentumVydrz and
  // momentumSpecialni are utils/momentum.mjs (momentumStaminaCost in
  // utils/combatAbilities.mjs deductAbilityCost; useMomentum's paired
  // free-ability grant, utils/actionTracker.mjs grantFreeAbility).
  // opakovaniUtoku is a NODE_REROLL_POOLS entry in utils/rerolls.mjs.
  // presilaPostih is utils/overwhelm.mjs overwhelmPenaltyFor, shared with the
  // Champion. triumf: the Triumph / Improved Triumph grants above, the
  // offer in utils/applyDamage.mjs (offerTriumph), the hotbar chip in
  // utils/actionSuggestions.mjs and useTriumph from utils/combatAbilities.mjs.
  // rozseknutiCil is cleaveTargetRefusal (utils/combatAbilities.mjs),
  // rozseknutiZasah vanguardCleaveHit (utils/combatSkillBonuses.mjs
  // getAttackRolls). bojoveTestySily is utils/testRating.mjs
  // vanguardStrengthTestBonus. opakovaniTestuSily is the Stamina reroll in
  // redsteel.mjs handleRerollClick (vanguardStrengthRerollOption).
  // zbrojeRychlost is documents/actor.mjs (worn armor's Initiative and Speed
  // penalties dropped).
  vanguard: [
    "ztecPohyb50",
    "ztecZraneniHexa",
    "ztecPohyb100",
    "zatlaceni",
    "ztecSRozseknutim",
    "momentumVydrz",
    "momentumSpecialni",
    "opakovaniUtoku",
    "presilaPostih",
    "triumf",
    "rozseknutiCil",
    "rozseknutiZasah",
    "bojoveTestySily",
    "opakovaniTestuSily",
    "zbrojeRychlost",
    "rozrazeni",
  ],
  // (oddechMireni on skirmisher and sharpshooter: see swordDancer.)
  skirmisher: ["utokSPohybem", "oddechMireni"],
  sharpshooter: ["oddechMireni"],
  // utils/aim.mjs — duelistuvPostoj is the stance itself (one-handed sword,
  // off hand free or holding a fencing dagger), which aimPerks tests as `blade`
  // and every perk below gates on; mireniRedukce upgrades the Duelist II aim
  // reduction; krvaveBodnuti is Laceration, offered in the Apply Damage dialog
  // (utils/applyDamage.mjs); postojMireni carries stacks across a target switch;
  // vyhodnyManevr buys an Aim off a defense that held, offered as a button on
  // the defense card (utils/advantageousManeuver.mjs).
  // vylUtokSPohybem is utils/abilityGrants.mjs + utils/abilityMovement.mjs:
  // Improved Passing Strike, whose step also follows an off-turn retaliation.
  // posileniObrany is utils/defense.mjs: the Aim sacrifice in the defense
  // dialog, paid through utils/aim.mjs sacrificeAim.
  // oddechMireni is utils/aim.mjs grantRespiteAim, called from
  // utils/combatAbilities.mjs runUtilityAbility, utils/otherActions.mjs
  // restAndRecover, utils/veteranRest.mjs grantFreeRest and
  // utils/dragonSleep.mjs (the same node on skirmisher and sharpshooter).
  // akrobatickeOdpoutani is utils/actionSuggestions.mjs (the hotbar chip
  // after a successful Defense) + utils/abilityMovement.mjs
  // declareAcrobaticDisengage (the off-turn Disengage).
  // rafinovanyManevr is utils/abilityGrants.mjs + utils/aim.mjs: the Aim on a
  // hit, and on a miss through the end-of-turn sweep.
  // posledniVypad is utils/aim.mjs (the four-Aim gate and its price),
  // utils/combatSkillBonuses.mjs (the crit and the Advantage),
  // utils/combatAbilities.mjs (the Sneak Attack) and utils/swordDancer.mjs
  // settleFinalStrikeKill (on a kill or Downed: the Action back, and the two
  // Aim placed from a card button instead of on the body).
  // vylDuelistuvKrok is utils/abilityMovement.mjs (the target exempt from the
  // threat rules), utils/swordDancer.mjs completeDuelistsAdvance (the Aim) and
  // utils/actionTracker.mjs grantFreeAttack (the free Attack).
  // brilantniProtiutok is utils/actionSuggestions.mjs: the Counterattack chip
  // after a Critical Dodge, and the Surprise chips with the modifier ticked.
  swordDancer: [
    "duelistuvPostoj",
    "krvaveBodnuti",
    "mireniRedukce",
    "postojMireni",
    "vyhodnyManevr",
    "vylUtokSPohybem",
    "posileniObrany",
    "oddechMireni",
    "akrobatickeOdpoutani",
    "rafinovanyManevr",
    "posledniVypad",
    "vylDuelistuvKrok",
    "brilantniProtiutok",
  ],
  // utils/mentalDuel.mjs — ovladnuti unlocks "Seize control" on the winner's
  // banner; vysati unlocks "Drain" (+2 Mind to the victor, ends the duel);
  // soubojMZ1 puts the "Nápor" button beside the attack button and soubojMZ2
  // upgrades what a landed Nápor drains.
  // The soubojZahajeni chain feeds the initiation chance rolled in
  // utils/castSpell.mjs, and mentalniZtec is the Mind-burning prompt that runs
  // just before that roll.
  mentalist: [
    "ovladnuti",
    "vysati",
    "mentalniZtec",
    "soubojZahajeni1",
    "soubojZahajeni2",
    "soubojZahajeni3",
    "soubojZahajeni4",
    "soubojMZ1",
    "soubojMZ2",
  ],
  // documents/actor.mjs (armour penalty, Lindar) + utils/castSpell.mjs
  // (Lindar's strikes) + utils/lindarCharge.mjs with
  // utils/magicSkillBonuses.mjs (Lindar's Charge: 6 Mana off the cast cost and
  // +10% Channeling on the nine named movement spells).
  veneficus: ["postihZbroje", "lindar", "lindarovyUdery", "lindaruvVypad1"],
  // utils/magicSkillBonuses.mjs — the curse path.
  maleficarum: ["zakleti"],
  // utils/abilityGrants.mjs (Blood Pact) + utils/applyDamage.mjs (Blood Shield)
  // + utils/wrathOfBlood.mjs (Wrath of Blood — Spell Power and pool capacity
  // that follow the caster's own Bleeding stacks) + utils/castSpell.mjs with
  // utils/magicSkillBonuses.mjs (Blood Payment — the Blood spell dialog's
  // toggle that buys 15 points of Difficulty for 5 Life from the Reserve).
  // utils/giftOfBlood.mjs holds Gift of Blood (darKrve): killing a living
  // target with a Blood spell heals the caster SK, paid from the spell card's
  // Apply Damage (utils/applyDamage.mjs) and from the DoT / Bleeding ticks of
  // effects the spell stamped (documents/effects.mjs).
  // The rank nodes carry passives, and expert/master/grandmaster are also read
  // by getBloodSchoolRankBonus: utils/magicSkillBonuses.mjs (Magic ATK on a
  // Blood cast) and utils/defense.mjs (Magic Defense against a Blood spell).
  // magickaKrev comes with the specialisation (helpers/progressionEngine.mjs,
  // syncAutoSpecNodes); documents/actor.mjs lets Channeling stand in for Blood
  // Manipulation, and helpers/specNodePrices.mjs lets Channeling ranks meet the
  // rank nodes' Blood Manipulation requirements.
  bloodSchool: ["krvavyPakt", "krvavyStit", "hnevKrve", "krvavaPlatba", "darKrve", "expert", "master", "grandmaster", "magickaKrev"],
};

// Crit-degree triggers and state-gated immunities are already declared as data
// elsewhere in the system, so read their node ids straight off those tables
// instead of repeating them here where they could drift.
for (const t of [...CRIT_DEGREE_TRIGGERS, ...STATE_GATED_IMMUNITIES]) {
  (CODE_AUTOMATED_NODES[t.spec] ??= []).push(t.node);
}

// utils/magicSkillBonuses.mjs — the school-scoped "Critical Range +2" node each
// mancer tree (plus Maleficarum and the School of Blood) buys. Node ids come
// straight from SCHOOL_CRIT_RANGE_NODES above.
for (const entry of SCHOOL_CRIT_RANGE_NODES) {
  (CODE_AUTOMATED_NODES[entry.spec] ??= []).push(entry.node);
}

// documents/effects.mjs — the "duration +N" nodes, applied when the owner
// inflicts the named effect. Node ids come straight from
// EFFECT_DURATION_NODES above.
for (const entry of EFFECT_DURATION_NODES) {
  (CODE_AUTOMATED_NODES[entry.spec] ??= []).push(entry.node);
}

// helpers/progressionEngine.mjs — the rank discount perks ("Sleva 3 SP za
// stupeň …"): the Learn window prices every rank of the skill lower, counts it
// in the CP/SP wallet, and offers the pick on a "one skill from a list" perk.
// The node ids come straight from the data table in helpers/rankDiscounts.mjs.
for (const [spec, nodes] of Object.entries(SPEC_DISCOUNTS)) {
  for (const node of Object.keys(nodes)) {
    (CODE_AUTOMATED_NODES[spec] ??= []).push(node);
  }
}

// helpers/progressionEngine.mjs: the rank mirror perks. The Learn window offers
// the pick under the star sign, and the chosen track copies the rank of its
// source for free (the Hoplite's Swords, Axes or Blunt follow Polearms). The
// node ids come straight from the data table in helpers/rankMirrors.mjs.
for (const [spec, nodes] of Object.entries(SPEC_MIRRORS)) {
  for (const node of Object.keys(nodes)) {
    (CODE_AUTOMATED_NODES[spec] ??= []).push(node);
  }
}

/** True if the node is automated by code outside its own definition. */
function isCodeAutomated(specId, nodeId) {
  return !!CODE_AUTOMATED_NODES[specId]?.includes(nodeId);
}

const SPEC_DEFS = {
  /* ----------------------------------------------------------------- */
  /* Stín (Shadow)                                                     */
  /* ----------------------------------------------------------------- */
  shadow: {
    // Constellation layout (prototype): nodes carry x/y as PERCENTAGES of the
    // canvas (0–100), so the figure stretches to fill whatever space the panel
    // gives it; the `requires` chains become the connecting lines. tier/column
    // are kept only as a grid fallback.
    layout: "constellation",
    nodes: {
      // Chain: sneak attack mastery (the central spine)
      sneakAttack: {
        tier: 1,
        column: 1,
        x: 16,
        y: 20,
        passive: {
          ...ae(add("system.sneakDamageBonus", 1)),
          ...cm({ critRangeBonus: 3 }),
        },
      },
      critAsSneak: { tier: 2, column: 1, x: 30, y: 33, requires: ["sneakAttack"] },
      outnumberSneak: { tier: 3, column: 1, x: 43, y: 19, requires: ["critAsSneak"] },
      // Chain: bleeding (left descending arm)
      bleed1: { tier: 1, column: 2, x: 13, y: 45, passive: cm({ extraEffects: { bleed: 10 } }) },
      bleed2: {
        tier: 2,
        column: 2,
        x: 25,
        y: 59,
        requires: ["bleed1"],
        passive: cm({ extraEffects: { bleed: 10 } }),
      },
      bleed3: {
        tier: 3,
        column: 2,
        x: 37,
        y: 72,
        requires: ["bleed2"],
        passive: cm({ extraEffects: { bleed: 10 } }),
      },
      // Chain: calculation (upper-right arm)
      calculation: { tier: 1, column: 3, x: 62, y: 25 },
      aimedAttack: { tier: 2, column: 3, x: 77, y: 17, requires: ["calculation"] },
      // Chain: stealth (center-right)
      stealthAdvantage: {
        tier: 1,
        column: 4,
        x: 57,
        y: 50,
        passive: ae(add("system.rollAdvantage.stealth", 1)),
      },
      stealthCritFail: {
        tier: 2,
        column: 4,
        x: 71,
        y: 46,
        requires: ["stealthAdvantage"],
        passive: ae(add("system.skills.stealth.critfailpenalty", -3)),
      },
      // Chain: banes (lower-right arm)
      bane1: { tier: 1, column: 5, x: 61, y: 73, bane: 1 },
      bane2: { tier: 2, column: 5, x: 74, y: 67, requires: ["bane1"], bane: 1 },
      bane3: { tier: 3, column: 5, x: 85, y: 80, requires: ["bane2"], bane: 1 },
      // Unchained (scattered field stars)
      quickFeet: { tier: 1, column: 6, x: 8, y: 31 },
      backDodge: { tier: 2, column: 6, x: 47, y: 54 },
      weakSpotMastery: { tier: 3, column: 6, x: 47, y: 83 },
      speedTests: { tier: 4, column: 6, x: 88, y: 31 },
      daggerDefense: { tier: 1, column: 7, x: 87, y: 54 },
      skillDiscount1: { tier: 2, column: 7, x: 22, y: 83 },
      skillDiscount2: { tier: 3, column: 7, x: 9, y: 66 },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Služebník meče (Servant of the Sword)                             */
  /* ----------------------------------------------------------------- */
  swordServant: {
    // Constellation layout: a sword lying point-right across the panel. The
    // panel is roughly 2.2:1 wide, so an upright blade would waste most of the
    // width and crowd the labels; laid flat it fills the space. The figure is
    // drawn entirely by the real `requires` chains — no prerequisite was
    // invented to make the picture work:
    //   grip + pommel  the riposte chain, running left off the guard
    //   crossguard     prosmyknuti -> dexTests as a tall vertical bar, with
    //                  three unchained nodes sitting on it
    //   blade spine    the five-node blade-mastery chain out to the tip
    //   blade edges    the aim / charge / movement-attack pairs, converging
    // tier/column stay only as a grid fallback.
    layout: "constellation",
    nodes: {
      // Chain: blade mastery — the blade spine, hilt to point
      bleedA: {
        tier: 1,
        column: 1,
        x: 41,
        y: 50,
        passive: cm({ extraEffects: { bleed: 10 } }),
      },
      critHitDef: {
        tier: 2,
        column: 1,
        x: 52,
        y: 50,
        requires: ["bleedA"],
        passive: ae(
          add("system.combatSkills.combat.critbonus", 3),
          add("system.combatSkills.meleeDefense.critbonus", 3),
        ),
      },
      bleedB: {
        tier: 3,
        column: 1,
        x: 63,
        y: 50,
        requires: ["critHitDef"],
        passive: cm({ extraEffects: { bleed: 10 } }),
      },
      initiative: {
        tier: 4,
        column: 1,
        x: 74,
        y: 50,
        requires: ["bleedB"],
        passive: ae(add("system.secondaryAttributes.ini.bonus", 2)),
      },
      // The point of the sword
      hitBonus: {
        tier: 5,
        column: 1,
        x: 92,
        y: 50,
        requires: ["initiative"],
        passive: ae(add("system.combatSkills.combat.bonus", 5)),
      },
      // Chain: riposte — the grip, ending in the pommel
      ripostaFree: { tier: 1, column: 2, x: 24, y: 50 },
      ripostaStamina: { tier: 2, column: 2, x: 15, y: 50, requires: ["ripostaFree"] },
      ripostaCrit: { tier: 3, column: 2, x: 6, y: 50, requires: ["ripostaStamina"] },
      // Sits on the crossguard bar
      odvetnyUder: { tier: 4, column: 2, x: 32, y: 30 },
      // Chain: aiming — lower blade edge
      improvedAim: { tier: 1, column: 3, x: 43, y: 69 },
      aimReduction: { tier: 2, column: 3, x: 52, y: 71, requires: ["improvedAim"] },
      // Upper blade edge
      draciSpanek: { tier: 3, column: 3, x: 70, y: 31 },
      draciStraz: { tier: 4, column: 3, x: 61, y: 29 },
      // Chain: charge — lower blade edge
      chargeDamage: { tier: 1, column: 4, x: 61, y: 71 },
      chargeDistance: { tier: 2, column: 4, x: 70, y: 69, requires: ["chargeDamage"] },
      // Upper edge, nearest the point
      priskok: { tier: 3, column: 4, x: 82, y: 40 },
      // Sits on the crossguard bar, where the blade meets the hilt
      draciVypad: { tier: 4, column: 4, x: 32, y: 50 },
      // Chain: slip through — draws the crossguard bar itself
      prosmyknuti: { tier: 1, column: 5, x: 32, y: 16 },
      dexTests: { tier: 2, column: 5, x: 32, y: 84, requires: ["prosmyknuti"] },
      // Lower edge, nearest the point
      presneRozseknuti: { tier: 3, column: 5, x: 82, y: 60 },
      // Sits on the crossguard bar
      vyhodnyManevr: { tier: 4, column: 5, x: 32, y: 70 },
      // Chain: movement attack — upper blade edge, nearest the hilt
      utokSPohybem: { tier: 1, column: 6, x: 43, y: 31 },
      vylUtokSPohybem: {
        tier: 2,
        column: 6,
        x: 52,
        y: 29,
        requires: ["utokSPohybem"],
      },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Mistr zbraní (Weapon Master)                                      */
  /* ----------------------------------------------------------------- */
  weaponMaster: {
    // Constellation layout: two crossed weapons (a saltire). Only two short
    // `requires` chains exist here, so the figure rests almost entirely on
    // placement — which is how a real star sign works anyway. Four arms of
    // four stars radiate from a single rivet star at the centre, and the
    // crossing itself is left empty so the two weapons read as separate
    // rather than as one blob:
    //   NW + SE  one weapon, hilt upper-left (Mistr zbraní at the pommel),
    //            point lower-right (Útok na slabinu at the tip)
    //   SW + NE  the other, butt lower-left, head upper-right (Průbojnost)
    // The two chains each lie along an arm so their links reinforce a
    // diagonal: zbrojnoš on the NW arm, veterán on the NE arm.
    //
    // The arms are symmetric about y=50 (24/76, 30/70, 36/64, 42/58). The two
    // innermost upper stars sit 16 y-units above their lower counterparts at
    // the same x, which is the tightest gap in the tree — keep one-line labels
    // on `odrazeni` and `presileni` if these ever get renamed.
    layout: "constellation",
    nodes: {
      // NW arm, outermost first — the hilt of the first weapon
      mistrZbrani: { tier: 1, column: 1, x: 13, y: 24 },
      // SW arm — the butt of the second weapon
      vytrvalyValecnik: { tier: 2, column: 1, x: 22, y: 70 },
      vycvikSeZbrani: { tier: 3, column: 1, x: 31, y: 64 },
      bdelyOchrance: { tier: 4, column: 1, x: 13, y: 76 },
      // Chain: armiger — draws the NW arm
      zbrojnos1: { tier: 1, column: 2, x: 22, y: 30 },
      zbrojnos2: { tier: 2, column: 2, x: 31, y: 36, requires: ["zbrojnos1"] },
      // Innermost NW star (one-line label: it sits above vylZbranoveDovednosti)
      odrazeni: { tier: 3, column: 2, x: 40, y: 42 },
      // Chain: veteran — draws the NE arm
      veteran1: { tier: 1, column: 3, x: 78, y: 30 },
      veteran2: { tier: 2, column: 3, x: 69, y: 36, requires: ["veteran1"] },
      // Innermost SW star
      vylZbranoveDovednosti: { tier: 3, column: 3, x: 40, y: 58 },
      // Unchained passives — the SE arm, running out to the point
      bleedStun: {
        tier: 1,
        column: 4,
        x: 60,
        y: 58,
        // "Krvácení +10% / Omráčení +6%": Omráčení is stagger here.
        passive: cm({ extraEffects: { bleed: 10, stagger: 6 } }),
      },
      critDefRange: {
        tier: 2,
        column: 4,
        x: 69,
        y: 64,
        passive: {
          ...ae(add("system.combatSkills.meleeDefense.critbonus", 2)),
          ...cm({ critRangeBonus: 1 }),
        },
      },
      precision: {
        tier: 3,
        column: 4,
        x: 78,
        y: 70,
        passive: cm({ extraEffects: { precision: 10 } }),
      },
      // Outermost NE star — the head of the second weapon
      penetration: {
        tier: 1,
        column: 5,
        x: 87,
        y: 24,
        passive: cm({ penetrationBonus: 2 }),
      },
      // Innermost NE star (one-line label: it sits above bleedStun)
      presileni: { tier: 2, column: 5, x: 60, y: 42 },
      // The rivet where the two weapons cross
      rychlaReakce: { tier: 3, column: 5, x: 50, y: 50 },
      // The point of the first weapon
      weakSpotPen: { tier: 1, column: 6, x: 87, y: 76 },
      // Fills the upper wedge between the arms
      primaryDamage: { tier: 2, column: 6, x: 50, y: 26 },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Hoplita (Hoplite)                                                 */
  /* ----------------------------------------------------------------- */
  hoplite: {
    // Constellation layout: a round shield with a spear laid across it. The
    // shield rim is walked by the brutality / advance / onslaught chains so the
    // rim itself lights up as they are taken; the five-node impale chain is the
    // spear shaft, with the daring throw sitting at the tip.
    layout: "constellation",
    coords: {
      bleedStun: [43, 50],
      kritZasah: [38, 26],
      momentum: [26, 16],
      postup: [14, 26],
      raznyPostup: [9, 50],
      napor1: [14, 74],
      napor2: [26, 84],
      hoplitaStance: [38, 74],
      nabodnuti: [48, 12],
      velkeTvory: [57.2, 20.8],
      prilezitostnyUtok: [66.4, 29.6],
      pripravnyPostoj: [75.6, 38.4],
      obranaProtiZteci: [84.8, 47.2],
      troufalyVrh: [94, 56],
      damage1d6: [52, 74],
      penetration2: [66, 79],
      hexAttack: [80, 84],
      silaObratnost: [92, 74],
    },
    nodes: {
      // Chain: impale line
      nabodnuti: { tier: 1, column: 1 },
      velkeTvory: { tier: 2, column: 1, requires: ["nabodnuti"] },
      prilezitostnyUtok: { tier: 3, column: 1, requires: ["velkeTvory"] },
      pripravnyPostoj: { tier: 4, column: 1, requires: ["prilezitostnyUtok"] },
      obranaProtiZteci: { tier: 5, column: 1, requires: ["pripravnyPostoj"] },
      // Chain: brutality
      bleedStun: {
        tier: 1,
        column: 2,
        // "Krvácení +20% / Omráčení +10%": Omráčení is stagger here.
        passive: cm({ extraEffects: { bleed: 20, stagger: 10 } }),
      },
      kritZasah: {
        tier: 2,
        column: 2,
        requires: ["bleedStun"],
        passive: ae(add("system.combatSkills.combat.critbonus", 3)),
      },
      momentum: { tier: 3, column: 2, requires: ["kritZasah"] },
      // Chain: advance
      postup: { tier: 1, column: 3 },
      raznyPostup: { tier: 2, column: 3, requires: ["postup"] },
      // Chain: onslaught
      napor1: { tier: 1, column: 4 },
      napor2: { tier: 2, column: 4, requires: ["napor1"] },
      // Unchained
      hoplitaStance: { tier: 1, column: 5 },
      damage1d6: { tier: 2, column: 5, passive: cm({ damageRoll: "1d6" }) },
      troufalyVrh: { tier: 3, column: 5 },
      penetration2: { tier: 1, column: 6, passive: cm({ penetrationBonus: 2 }) },
      hexAttack: { tier: 2, column: 6 },
      silaObratnost: { tier: 4, column: 6 },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Mečový tanečník (Sword Dancer)                                    */
  /* ----------------------------------------------------------------- */
  swordDancer: {
    // Constellation layout: a dancer's fan — two nested sweeping arcs with two
    // stars held above them. The seven-node duellist chain draws the outer hem,
    // so the sweep itself is the line that lights up.
    layout: "constellation",
    coords: {
      duelistuvPostoj: [12.4, 62.3],
      krvaveBodnuti: [20.9, 74.7],
      mireniRedukce: [34.2, 83.1],
      vyhodnyManevr: [50, 86],
      posileniObrany: [65.8, 83.1],
      postojMireni: [79.1, 74.7],
      precision10: [87.6, 62.3],
      oddechMireni: [25.6, 56.8],
      akrobatickeOdpoutani: [35.1, 66.4],
      vylUtokSPohybem: [50, 70],
      rafinovanyManevr: [64.9, 66.4],
      posledniVypad: [74.4, 56.8],
      vylDuelistuvKrok: [28, 28],
      brilantniProtiutok: [72, 28],
    },
    nodes: {
      // Chain: the duelist's path (full tier-1 row of the sheet)
      duelistuvPostoj: { tier: 1, column: 1 },
      krvaveBodnuti: { tier: 2, column: 1, requires: ["duelistuvPostoj"] },
      mireniRedukce: { tier: 3, column: 1, requires: ["krvaveBodnuti"] },
      vyhodnyManevr: { tier: 4, column: 1, requires: ["mireniRedukce"] },
      posileniObrany: { tier: 5, column: 1, requires: ["vyhodnyManevr"] },
      postojMireni: { tier: 6, column: 1, requires: ["posileniObrany"] },
      precision10: {
        tier: 7,
        column: 1,
        requires: ["postojMireni"],
        passive: cm({ extraEffects: { precision: 10 } }),
      },
      // Unchained, sorted by rank requirement
      oddechMireni: { tier: 1, column: 2 },
      akrobatickeOdpoutani: { tier: 2, column: 2 },
      vylUtokSPohybem: { tier: 3, column: 2 },
      rafinovanyManevr: { tier: 5, column: 2 },
      posledniVypad: { tier: 2, column: 3 },
      vylDuelistuvKrok: { tier: 4, column: 3 },
      brilantniProtiutok: { tier: 6, column: 3 },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Škola Krve (School of Blood)                                      */
  /* ----------------------------------------------------------------- */
  bloodSchool: {
    // Constellation layout: a blood drop with straight edges (a kite) — apex at
    // the top, widest across the middle, point at the bottom. Straight edges are
    // deliberate: a curved outline eats label clearance in both axes at once and
    // would not close at this node count. The eight-node rank chain walks the
    // whole left edge, the blood pool pair and five loose stars mirror it down
    // the right edge, one star holds the centre, and two field stars sit off to
    // the left. Every position is a slot of the earlier 25-star layout, so its
    // label clearances still hold.
    layout: "constellation",
coords: {
      apprentice: [50, 6],
      spellPower1: [41.5, 17],
      expert: [33, 28],
      spellPower2: [24.5, 39],
      master: [16, 50],
      spellPower3: [24.5, 60],
      grandmaster: [33, 70],
      spellPower4: [41.5, 80],
      darKrve: [50, 90],
      magickaKrev: [58.5, 17],
      krvavyPakt: [67, 28],
      bloodPool1: [75.5, 39],
      bloodPool2: [84, 50],
      precision15: [75.5, 60],
      hnevKrve: [67, 70],
      krvavyStit: [58.5, 80],
      krvavaPlatba: [50, 50],
      kritRozsah2: [8, 30],
      oslabeniTrvani: [8, 70],
    },
    nodes: {
      // Chain: ranks alternating with spell power. Each rank also grows the
      // blood pool capacity (+10/+10/+20/+50). Expert, Master and Grandmaster
      // each also carry "Škola Krve: Magický útok +5%" and "Magická obrana proti
      // kouzlům Školy Krve +5%", read at roll time by getBloodSchoolRankBonus.
      apprentice: {
        tier: 1,
        column: 1,
        passive: ae(add("system.stats.bloodPool.bonus", 10)),
      },
      spellPower1: {
        tier: 2,
        column: 1,
        requires: ["apprentice"],
        passive: ae(add("system.schools.blood.bonus", 2)),
      },
      expert: {
        tier: 3,
        column: 1,
        requires: ["spellPower1"],
        passive: ae(add("system.stats.bloodPool.bonus", 10)),
      },
      spellPower2: {
        tier: 4,
        column: 1,
        requires: ["expert"],
        passive: ae(add("system.schools.blood.bonus", 2)),
      },
      master: {
        tier: 5,
        column: 1,
        requires: ["spellPower2"],
        passive: ae(add("system.stats.bloodPool.bonus", 20)),
      },
      spellPower3: {
        tier: 6,
        column: 1,
        requires: ["master"],
        passive: ae(add("system.schools.blood.bonus", 2)),
      },
      grandmaster: {
        tier: 7,
        column: 1,
        requires: ["spellPower3"],
        passive: ae(add("system.stats.bloodPool.bonus", 50)),
      },
      spellPower4: {
        tier: 8,
        column: 1,
        requires: ["grandmaster"],
        passive: ae(add("system.schools.blood.bonus", 2)),
      },
      // Chain: blood pool capacity
      bloodPool1: {
        tier: 1,
        column: 2,
        passive: ae(add("system.stats.bloodPool.bonus", 15)),
      },
      bloodPool2: {
        tier: 2,
        column: 2,
        requires: ["bloodPool1"],
        passive: ae(add("system.stats.bloodPool.bonus", 15)),
      },
      // Unchained
      // Magic Blood comes with the specialisation: a free, automatic star that
      // lets Channeling stand in for Blood Manipulation.
      magickaKrev: { tier: 1, column: 5, autoUnlock: true },
      krvavyPakt: { tier: 2, column: 5 },
      precision15: {
        tier: 3,
        column: 5,
        passive: cm({ extraEffects: { precision: 15 } }),
      },
      hnevKrve: { tier: 4, column: 5 },
      krvavaPlatba: { tier: 5, column: 5 },
      kritRozsah2: { tier: 1, column: 6 },
      oslabeniTrvani: { tier: 2, column: 6 },
      krvavyStit: { tier: 3, column: 6 },
      darKrve: { tier: 4, column: 6 },
    },
  },
};

// Bulk specialisations generated from the rules workbook (see
// scripts/gen_specs_batch2.py) — merged alongside the handwritten ones.
Object.assign(SPEC_DEFS, GENERATED_SPECS);

/**
 * Each specialisation's token art for the Learn window's cards. Core Foundry
 * icons, every one already used elsewhere in the system, as a stand-in until
 * the specialisations get art of their own (user ruling 2026-09-11).
 */
export const SPEC_ICONS = {
  berserk: "icons/skills/melee/strike-axe-blood-red.webp",
  champion: "icons/skills/melee/weapons-crossed-swords-yellow.webp",
  elementalist: "icons/magic/fire/orb-vortex.webp",
  elymas: "icons/magic/symbols/runes-star-pentagon-blue.webp",
  hoplite: "icons/weapons/polearms/spear-flared-blue.webp",
  incantator: "icons/sundries/books/book-symbol-reverse-blue.webp",
  ranger: "icons/weapons/bows/longbow-leather-green.webp",
  swordServant: "icons/weapons/swords/greatsword-crossguard-steel.webp",
  shadow: "icons/magic/perception/silhouette-stealth-shadow.webp",
  sharpshooter: "icons/skills/ranged/target-bullseye-arrow-glowing.webp",
  skirmisher: "icons/skills/melee/shield-block-bash-yellow.webp",
  spellslinger: "icons/magic/fire/dagger-rune-enchant-flame-blue.webp",
  swordDancer: "icons/skills/melee/sword-twirl-orange.webp",
  vanguard: "icons/equipment/shield/heater-steel-boss-red.webp",
  veneficus: "icons/skills/melee/strike-sword-dagger-runes-red.webp",
  warden: "icons/magic/defensive/shield-barrier-glowing-triangle-blue.webp",
  weaponMaster: "icons/skills/melee/swords-triple-orange.webp",
  alchemist: "icons/consumables/potions/bottle-conical-bubbling-blue.webp",
  astramancer: "icons/environment/cosmos/astronomy-planetary-orbits.webp",
  bard: "icons/tools/instruments/bell-brass-brown.webp",
  cryomancer: "icons/magic/water/snowflake-ice-blue.webp",
  entomancer: "icons/commodities/biological/legs-insect-brown.webp",
  geomancer: "icons/magic/earth/projectile-stone-landslide.webp",
  gnostic: "icons/magic/perception/third-eye-blue-red.webp",
  grimm: "icons/magic/death/weapon-sword-skull-purple.webp",
  illusionist: "icons/magic/defensive/illusion-evasion-echo-purple.webp",
  priest: "icons/magic/life/cross-yellow-green.webp",
  countermage: "icons/magic/defensive/barrier-shield-dome-deflect-blue.webp",
  maleficarum: "icons/magic/unholy/silhouette-robe-evil-power.webp",
  mentalist: "icons/magic/control/hypnosis-mesmerism-swirl.webp",
  mystic: "icons/magic/perception/orb-crystal-ball-scrying.webp",
  pyromancer: "icons/magic/fire/flame-burning-hand-white.webp",
  runeWarrior: "icons/magic/symbols/runes-carved-stone-yellow.webp",
  vitamancer: "icons/magic/nature/root-vine-caduceus-healing.webp",
  bloodSchool: "icons/skills/wounds/blood-cells-vessel-red.webp",
};

// Inject localization keys and defaults derived from spec/node ids
for (const [specId, spec] of Object.entries(SPEC_DEFS)) {
  spec.label = `REDSTEEL.Actor.Specialisations.${specId}.label`;
  spec.img ??= SPEC_ICONS[specId] ?? "icons/svg/mystery-man.svg";
  for (const [nodeId, node] of Object.entries(spec.nodes)) {
    node.label = `REDSTEEL.Actor.Specialisations.${specId}.nodes.${nodeId}.label`;
    node.description = `REDSTEEL.Actor.Specialisations.${specId}.nodes.${nodeId}.description`;
    // Constellation coordinates may be written either inline on the node
    // (`x`/`y`, as shadow / swordServant / weaponMaster do) or collected in a
    // `coords: { nodeId: [x, y] }` map on the spec. The map keeps big trees
    // readable — the node objects stay about mechanics, the figure lives in
    // one block. Inline coords win if a node somehow has both.
    const coords = spec.coords?.[nodeId];
    if (coords) {
      node.x ??= coords[0];
      node.y ??= coords[1];
    }
    node.requires ??= [];
    node.hiddenLinks ??= [];
    node.icon ??= "";
    node.passive ??= null;
  }
}

REDSTEEL.specialisations = SPEC_DEFS;

/** Pixel size of one tree grid cell. Node visuals are sized in CSS. */
const NODE_CELL = 96;

/**
 * Build the view data for every specialisation tree the actor has active.
 * Returns an array of trees with absolutely positioned nodes (top-down:
 * tier 1 renders at the top) and the connection lines between them.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
export function prepareSpecialisationTrees(actor) {
  const trees = [];
  const owned = actor.system.specialisations ?? {};

  for (const specId of Object.keys(REDSTEEL.specialisations)) {
    if (!owned[specId]?.active) continue;
    trees.push(buildSpecialisationTree(actor, specId));
  }
  return trees;
}

/**
 * The view data for ONE specialisation tree, whether or not the actor has it:
 * the Learn window browses every star sign, including ones not bought yet.
 * Same shape as an entry of prepareSpecialisationTrees; null for an unknown id.
 *
 * @param {Actor} actor
 * @param {string} specId
 * @returns {object|null}
 */
export function prepareSpecialisationTree(actor, specId) {
  if (!REDSTEEL.specialisations[specId]) return null;
  return buildSpecialisationTree(actor, specId);
}

/** One tree's nodes and connecting lines; see prepareSpecialisationTrees. */
function buildSpecialisationTree(actor, specId) {
  const def = REDSTEEL.specialisations[specId];
  const unlockedNodes = actor?.system?.specialisations?.[specId]?.nodes ?? {};

  // A constellation tree positions nodes by x/y PERCENTAGES (0–100) so the
  // figure stretches to fill the panel. A grid tree positions by the
  // tier/column pixel grid. Any node missing coords falls back to its grid
  // slot, so a half-authored tree still renders.
  const constellation = def.layout === "constellation";

  let maxTier = 1;
  let maxColumn = 1;
  const nodes = [];
  const byId = {};

  for (const [nodeId, node] of Object.entries(def.nodes)) {
    maxTier = Math.max(maxTier, node.tier);
    maxColumn = Math.max(maxColumn, node.column);

    // Constellation: x/y are already percentages, pass straight through.
    // Grid: derive pixel centre from the tier/column slot.
    const x = constellation
      ? (node.x ?? 50)
      : (node.column - 1) * NODE_CELL + NODE_CELL / 2;
    const y = constellation
      ? (node.y ?? 50)
      : (node.tier - 1) * NODE_CELL + NODE_CELL / 2;

    const unlocked = !!unlockedNodes[nodeId];
    const available = (node.requires ?? []).every(
      (r) => !!unlockedNodes[r],
    );
    const view = {
      id: nodeId,
      label: node.label,
      description: node.description,
      icon: node.icon || "",
      // Status dot: blue when the node's effect is automated, red when it is
      // a table ruling. `passive` covers nodes whose buff is a real Active
      // Effect; `bane` covers Bane slot nodes (their effect is the picker
      // plus the combat maths in baneCombat.mjs); `automated: true` is the
      // explicit opt-in on the definition; CODE_AUTOMATED_NODES lists the
      // ones implemented in code somewhere else.
      automated:
        !!node.passive ||
        !!node.bane ||
        node.automated === true ||
        isCodeAutomated(specId, nodeId),
      x,
      y,
      unlocked,
      state: unlocked ? "unlocked" : available ? "available" : "locked",
    };
    byId[nodeId] = view;
    nodes.push(view);
  }

  const links = [];
  for (const [nodeId, node] of Object.entries(def.nodes)) {
    for (const reqId of node.requires ?? []) {
      // Enforced but deliberately undrawn — see `hiddenLinks` in the node
      // format notes at the top of this file.
      if ((node.hiddenLinks ?? []).includes(reqId)) continue;
      const from = byId[reqId];
      const to = byId[nodeId];
      if (!from || !to) continue;
      links.push({
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        active: from.unlocked && to.unlocked,
      });
    }
  }

  return {
    id: specId,
    label: def.label,
    nodes,
    links,
    constellation,
    // Grid trees size the canvas from their slot count; constellation trees
    // fill the panel via CSS, so no fixed pixel size is emitted.
    width: constellation ? null : maxColumn * NODE_CELL,
    height: constellation ? null : maxTier * NODE_CELL,
  };
}

/**
 * Create or remove the permanent effects backing a node's passive buff.
 *
 * Stat changes ride the regular ActiveEffect pipeline (the same one
 * conditions use) and show up on the Effects tab. Combat modifiers
 * (damage, penetration, bleed/stun/precision chances, …) are written to
 * system.activeCombatEffects, where getActorCombatModifiers picks them up
 * for every attack — exactly like weapon-enchant effects do.
 *
 * @param {Actor} actor
 * @param {string} specId
 * @param {string} nodeId
 * @param {boolean} unlocked  The node's new unlock state
 */
export async function syncSpecialisationPassive(actor, specId, nodeId, unlocked) {
  const nodeDef = REDSTEEL.specialisations[specId]?.nodes?.[nodeId];
  if (!nodeDef) return;

  const flag = `${specId}.${nodeId}`;
  const groupKey = `spec_${specId}_${nodeId}`;
  const passive = nodeDef.passive;

  const existing = actor.effects.filter(
    (e) => e.getFlag("redsteel", "specNode") === flag,
  );

  if (!unlocked || !passive) {
    if (existing.length) {
      await actor.deleteEmbeddedDocuments(
        "ActiveEffect",
        existing.map((e) => e.id),
      );
    }
    if (actor.system.activeCombatEffects?.[groupKey]) {
      await actor.update({
        [`system.activeCombatEffects.-=${groupKey}`]: null,
      });
    }
    return;
  }

  if (passive.changes?.length && !existing.length) {
    await actor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: game.i18n.localize(nodeDef.label),
        img: nodeDef.icon || "icons/svg/upgrade.svg",
        changes: foundry.utils.deepClone(passive.changes),
        disabled: false,
        transfer: false,
        flags: { redsteel: { specNode: flag } },
      },
    ]);
  }

  if (
    passive.combatModifiers &&
    !actor.system.activeCombatEffects?.[groupKey]
  ) {
    await actor.update({
      [`system.activeCombatEffects.${groupKey}`]: foundry.utils.deepClone(
        passive.combatModifiers,
      ),
    });
  }
}
