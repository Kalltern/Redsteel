/**
 * Předvoj (Vanguard), batch 1: the nodes that live outside node passives.
 * Czech rulebook text: docs/rules-source/rules/specializace-wip.md r511-r552.
 * Rozražení (rozrazeni, Bull Charge) is batch 2, in bullCharge.mjs.
 *
 * - Zteč: Pohyb +50% (ztecPohyb50) and Zteč: Pohyb +100% (ztecPohyb100):
 *   every charge's approach budget is Speed x1.5, or Speed x2 with the second
 *   node (user ruling 2026-10-19: +100% replaces +50%), rounded down
 *   (vanguardChargeBudget, read by abilityMovement.mjs declareChargeMove).
 * - Zteč: +1 Zranění za hexu (ztecZraneniHexa): +1 damage for every hex the
 *   charge approach actually walked, added to the charge's damage formula as
 *   its own term (vanguardChargeHexDamage, read by combatAbilities.mjs
 *   runAttackMacro for the weapon charges and by combatSkillBonuses.mjs
 *   getNonWeaponAbility for Shield Charge).
 * - Zatlačení (zatlaceni) and Zteč s rozseknutím (ztecSRozseknutim): the
 *   Champion's Push Back and Charge with Cleave items, granted by
 *   abilityGrants.mjs. Their behaviour is item driven (champion.mjs,
 *   abilityMovement.mjs isCharge), so it needs nothing here.
 * - Momentum: Výdrž -1 (momentumVydrz) and Momentum: Speciální akce
 *   (momentumSpecialni): read by momentum.mjs (MOMENTUM_STAMINA_DISCOUNT,
 *   vanguardMomentumAbilityKeys).
 * - Může 1x za den opakovat hod na Zásah (opakovaniUtoku): a node reroll pool
 *   in rerolls.mjs NODE_REROLL_POOLS on the weapon attack rolls.
 * - Obránce má snížený postih za Přesilu o 5% (presilaPostih): overwhelm.mjs
 *   overwhelmPenaltyFor, the same relief as the Champion's node (one relief
 *   with both).
 * - Triumf / Vylepšený triumf (triumf): "Za každý Kritický zásah nebo zabití
 *   získává 5 (10) Dočasných životů. Chrání pouze před zásahy ze Souboje a
 *   Střelby. Takto lze Dočasné životy zvýšit maximálně na 15. Cena za každý
 *   Triumf zvlášť." The node grants Triumph, or Improved Triumph when the
 *   character already has Triumph from Plenitel IX or Jezdec VII
 *   (abilityGrants.mjs). User ruling 2026-10-19: a chip, never automatic.
 *   Apply Damage counts the triggers (offerTriumph); each chip click pays
 *   the item and raises the physical Temporary Health pool (armoring.mjs
 *   grantArmoring, cap 15).
 * - Rozseknutí: Cíl +1 (rozseknutiCil): Cleave strikes up to three targets
 *   instead of two (cleaveTargetRefusal, asked in combatAbilities.mjs before
 *   anything is paid).
 * - Rozseknutí: Zásah +5% (rozseknutiZasah): vanguardCleaveHit, read in
 *   combatSkillBonuses.mjs getAttackRolls.
 * - Bonus +10% na bojové Testy Síly (bojoveTestySily): testRating.mjs
 *   vanguardStrengthTestBonus, read where the Warden's large-shield bonus is
 *   (versusTestBonus, and combatSkillBonuses.mjs getNonWeaponAbility). It
 *   lives there so that low-level module keeps its small import list.
 * - Za 5 výdrže může opakovat hod na bojový Test Síly (opakovaniTestuSily):
 *   an extra choice in the chat Re-Roll picker on a combat Strength Test
 *   card, paid with 5 Stamina each time, no daily limit
 *   (vanguardStrengthRerollOption, redsteel.mjs handleRerollClick).
 * - Zbroje nesnižují Rychlost ani Iniciativu (zbrojeRychlost): documents/
 *   actor.mjs, where worn armor's Initiative and Speed penalties are summed.
 * - Ocelový stisk (ocelovyStisk): a node passive (system.steelGrip), read by
 *   documents/actor.mjs for the melee Defense rating: the higher of Strength
 *   and Dexterity (user ruling 2026-10-19).
 * - Zbroje nesnižují Rychlost: armor's "Hranice Rychlosti" lowers the hard
 *   Speed cap (spd.max, documents/actor.mjs); the holder's cap is not lowered.
 * - Průbojnost +2 (prubojnost2): already a node passive.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import {
  getMovementLock,
  getSpent,
  markBonusSource,
  trackedCombat,
} from "./actionTracker.mjs";
import { tokenForActor, tokenMovementSpent } from "./movementZones.mjs";
import { isCharge } from "./abilityMovement.mjs";
import { grantArmoring } from "./armoring.mjs";
import { spendResource } from "./itemResources.mjs";

const SYSTEM_ID = "redsteel";
const SPEC_ID = "vanguard";

/** Has this actor unlocked the Vanguard node? */
export function hasVanguardNode(actor, nodeId) {
  return !!actor && actorHasSpecNode(actor, SPEC_ID, nodeId);
}

/* -------------------------------------------- */
/*  Zteč (Charge)                               */
/* -------------------------------------------- */

/** "Zteč: Pohyb +50%" and "Zteč: Pohyb +100%". */
const CHARGE_MOVE_50 = 1.5;
const CHARGE_MOVE_100 = 2;

/**
 * The charge approach budget for this actor, from the plain one (Speed).
 *
 * @param {Actor} actor
 * @param {number} base  movementZones.mjs movementBudget(actor, "charge")
 * @returns {number}
 */
export function vanguardChargeBudget(actor, base) {
  const n = Math.max(0, Number(base) || 0);
  if (hasVanguardNode(actor, "ztecPohyb100")) return Math.floor(n * CHARGE_MOVE_100);
  if (hasVanguardNode(actor, "ztecPohyb50")) return Math.floor(n * CHARGE_MOVE_50);
  return n;
}

/**
 * "+1 Zranění za hexu": the hexes the charge approach walked, as flat damage
 * for this charge's swing. Read off the round's movement lock: hexes walked
 * since the charge was declared (the token's drop counter minus the lock's
 * start), never more than the lock's budget. Zero for anything that is not a
 * charge swinging out of a charge approach (a charge made after an ordinary
 * Move just attacks, and walked nothing as a charge).
 *
 * One approach pays once: after the charge's first card the round is marked
 * (spendChargeHexDamage), and a later charge swing this round reads 0, so a
 * second Charge made free by Momentum does not cash the same hexes again.
 * The further strikes of a Charge with Cleave chain (`chainStrike`) are the
 * same charge and keep the bonus.
 *
 * @param {Actor} actor
 * @param {Item|null} ability
 * @param {{chainStrike?: boolean}} [options]
 * @returns {number}
 */
export function vanguardChargeHexDamage(actor, ability, { chainStrike = false } = {}) {
  if (!actor || !isCharge(ability)) return 0;
  if (!hasVanguardNode(actor, "ztecZraneniHexa")) return 0;
  const lock = getMovementLock(actor);
  if (lock?.mode !== "charge" || lock.stopped) return 0;
  const combat = trackedCombat(actor);
  if (
    !chainStrike &&
    combat &&
    getSpent(actor).bonusSources.includes(chargeHexSource(combat))
  ) {
    return 0;
  }
  const token = tokenForActor(actor);
  if (!token) return 0;
  const walked = tokenMovementSpent(token) - (Number(lock.startSpent) || 0);
  return Math.max(0, Math.min(Number(lock.budget) || 0, walked));
}

/** The round's charge approach, once its hexes were added to a swing. */
function chargeHexSource(combat) {
  return `vanguardChargeHex.${combat.id}.${combat.round}`;
}

/**
 * A charge card carrying the hex bonus is out: note the approach as cashed
 * for the round (see vanguardChargeHexDamage). Called after the first card of
 * a charge only.
 *
 * @param {Actor} actor
 * @param {Item|null} ability
 * @param {number} hexes  what the card added
 */
export async function spendChargeHexDamage(actor, ability, hexes) {
  if (!(hexes > 0) || !isCharge(ability)) return;
  const combat = trackedCombat(actor);
  if (!combat) return;
  await markBonusSource(actor, chargeHexSource(combat));
}

/* -------------------------------------------- */
/*  Momentum                                    */
/* -------------------------------------------- */

/** "Momentum: Výdrž -1" (the doctrine Momentum, momentum.mjs). */
export const MOMENTUM_STAMINA_DISCOUNT = 1;

/**
 * "Momentum: Speciální akce": the localisation keys of the weapon attack
 * abilities this actor holds, which Momentum's extra attack may be instead of
 * a plain Attack. Attack modifiers are left out (they ride on an attack, and
 * cost no Action anyway). Empty without the node.
 *
 * @param {Actor} actor
 * @returns {string[]}
 */
export function vanguardMomentumAbilityKeys(actor) {
  if (!hasVanguardNode(actor, "momentumSpecialni")) return [];
  const keys = actor.items
    .filter(
      (i) =>
        i.type === "ability" &&
        i.system?.class === "attack" &&
        i.system?.weaponAbility === true &&
        !i.system?.modifiesAttack &&
        i.system?.localizationKey,
    )
    .map((i) => i.system.localizationKey);
  return [...new Set(keys)];
}

/* -------------------------------------------- */
/*  Rozseknutí (Cleave)                         */
/* -------------------------------------------- */

/** The Cleave family: Cleave, Polearm Cleave and the Flamberge Cleave upgrade. */
const CLEAVE_KEYS = new Set([
  "REDSTEEL.Items.Cleave.name",
  "REDSTEEL.Items.PolearmCleave.name",
  "REDSTEEL.Items.FlambergeCleaveAbility.name",
]);
const CLEAVE_NAMES = new Set([
  "Cleave",
  "Polearm Cleave",
  "Flamberge Cleave (Ability)",
]);

/** "Zasahuje dva vedle sebe se nacházející nepřátele." */
const CLEAVE_BASE_TARGETS = 2;
/** "Rozseknutí: Zásah +5%". */
export const CLEAVE_HIT_BONUS = 5;

/** Is this one of the Cleave actions (not Charge with Cleave)? */
export function isCleave(ability) {
  return (
    CLEAVE_KEYS.has(ability?.system?.localizationKey) ||
    CLEAVE_NAMES.has(ability?.name)
  );
}

/** How many targets this actor's Cleave may strike. */
export function cleaveMaxTargets(actor) {
  return CLEAVE_BASE_TARGETS + (hasVanguardNode(actor, "rozseknutiCil") ? 1 : 0);
}

/**
 * Why this Cleave cannot be swung at the current targets, localized, or null.
 * A Cleave is one roll against every targeted token, so the number of targets
 * is the number of opponents struck. Asked before anything is paid. Whether
 * the targets stand next to each other is left to the table.
 *
 * @param {Actor} actor
 * @param {Token|null} token  the attacker's token
 * @param {Item} ability
 * @param {Token[]} targets
 * @returns {string|null}
 */
export function cleaveTargetRefusal(actor, token, ability, targets = []) {
  if (!isCleave(ability)) return null;
  const count = targets.filter(
    (t) => t && t !== token && t.id !== token?.id,
  ).length;
  const max = cleaveMaxTargets(actor);
  if (count <= max) return null;
  return game.i18n.format("REDSTEEL.Vanguard.CleaveTooManyTargets", {
    ability: ability.localizedName ?? ability.name,
    count,
    max,
  });
}

/** "Rozseknutí: Zásah +5%" on a Cleave action. */
export function vanguardCleaveHit(actor, ability) {
  return isCleave(ability) && hasVanguardNode(actor, "rozseknutiZasah")
    ? CLEAVE_HIT_BONUS
    : 0;
}

/* -------------------------------------------- */
/*  Bojový Test Síly (combat Strength Test)     */
/* -------------------------------------------- */

/** "Za 5 výdrže může opakovat hod na bojový Test Síly." */
export const STRENGTH_REROLL_STAMINA = 5;
const STRENGTH_REROLL_ID = "vanguard-strength-stamina";

/**
 * Is this chat card a combat Strength Test? The same coverage as the combat
 * Strength Test bonus (testRating.mjs versusTestBonus): the answering side of
 * a versus Test (attributeFollowup.mjs, which stamps `versusFollowup`), the
 * Push Back test (champion.mjs, `pushBackTest`), and a non-weapon ability
 * whose own test is Strength (Shield Bash and friends: an attack card whose
 * reroll tokens carry both "attack" and "str"). A Strength test rolled from
 * the sheet is not a combat test.
 *
 * @param {ChatMessage} message
 */
export function isCombatStrengthTest(message) {
  const flags = message?.flags?.redsteel ?? {};
  if (flags.skill === "str" && (flags.versusFollowup || flags.pushBackTest)) {
    return true;
  }
  const tokens = Array.isArray(flags.rerollTokens) ? flags.rerollTokens : [];
  return tokens.includes("attack") && tokens.includes("str");
}

/**
 * The Stamina-paid reroll as one more choice for the Re-Roll picker
 * (rerolls.mjs pickRerollPool reads `costLabel` in place of a charge count),
 * or null when it does not apply. Never on a natural Critical Failure: like
 * every pool without the critfail keyword.
 *
 * @param {Actor} actor
 * @param {ChatMessage} message
 * @param {{critFailure?: boolean}} [options]
 * @returns {object|null}
 */
export function vanguardStrengthRerollOption(actor, message, { critFailure = false } = {}) {
  if (critFailure) return null;
  if (!hasVanguardNode(actor, "opakovaniTestuSily")) return null;
  if (!isCombatStrengthTest(message)) return null;
  return {
    itemId: STRENGTH_REROLL_ID,
    poolIndex: 0,
    key: `${STRENGTH_REROLL_ID}:0`,
    label: game.i18n.localize(
      "REDSTEEL.Actor.Specialisations.vanguard.nodes.opakovaniTestuSily.label",
    ),
    img: "icons/skills/melee/unarmed-punch-fist.webp",
    skills: ["str"],
    universal: false,
    critFail: false,
    max: Infinity,
    used: 0,
    remaining: Infinity,
    costLabel: game.i18n.format("REDSTEEL.Vanguard.StrengthRerollCost", {
      cost: STRENGTH_REROLL_STAMINA,
    }),
    staminaCost: STRENGTH_REROLL_STAMINA,
  };
}

/** Is this Re-Roll choice the Stamina-paid one? */
export function isVanguardStrengthReroll(choice) {
  return choice?.itemId === STRENGTH_REROLL_ID;
}

/** Pay the Stamina reroll. False (and a warning) when it cannot be paid. */
export async function payVanguardStrengthReroll(actor) {
  return spendResource(actor, "stamina", STRENGTH_REROLL_STAMINA);
}

/* -------------------------------------------- */
/*  Triumf (Triumph)                            */
/* -------------------------------------------- */

export const TRIUMPH_KEY = "REDSTEEL.Items.Triumph.name";
export const IMPROVED_TRIUMPH_KEY = "REDSTEEL.Items.ImprovedTriumph.name";
/** "získává 5 Dočasných životů" / Vylepšený: 10; "maximálně na 15". */
export const TRIUMPH_AMOUNT = 5;
export const IMPROVED_TRIUMPH_AMOUNT = 10;
export const TRIUMPH_CAP = 15;

/** Actor flag: triggers waiting this turn, {count, combat}. */
const TRIUMPH_FLAG = "vanguardTriumph";
/** Card flag: token ids already counted, {crit: [], kill: []}. */
const TRIUMPH_CARD_FLAG = "vanguardTriumphCounted";

/** Is this Triumph (by key, or the pack's English name)? */
export function isTriumph(ability) {
  return (
    ability?.system?.localizationKey === TRIUMPH_KEY ||
    ability?.name === "Triumph"
  );
}

/** Is this Improved Triumph? */
export function isImprovedTriumph(ability) {
  return (
    ability?.system?.localizationKey === IMPROVED_TRIUMPH_KEY ||
    ability?.name === "Improved Triumph"
  );
}

/** Either Triumph item. */
export function isAnyTriumph(ability) {
  return isTriumph(ability) || isImprovedTriumph(ability);
}

function turnStamp(combat) {
  return { id: combat.id, round: combat.round, turn: combat.turn };
}

function stampIsThisTurn(stamp, combat) {
  return (
    !!stamp &&
    !!combat?.started &&
    stamp.id === combat.id &&
    Number(stamp.round) === Number(combat.round) &&
    Number(stamp.turn) === Number(combat.turn)
  );
}

/**
 * Apply Damage landed: count the Triumph triggers this card gave its owner.
 * "Za každý Kritický zásah nebo zabití": every target the card was applied to
 * as a Critical Hit with a weapon counts once, and every target it felled
 * counts once, so a critical that kills counts twice. Each target counts
 * once per kind per card, however often the card is applied. The count
 * belongs to the combat turn it was earned in (on or off the holder's own
 * turn); a new turn starts it again. Runs on the GM applying the damage.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message
 * @param {string[]} targetIds
 * @param {string[]} felledIds  applyDamage.mjs: dead, or newly Downed,
 *   Dying or Unconscious
 * @param {string} mode   "normal" | "critical" | "breakthrough"
 */
export async function offerTriumph(
  attacker,
  message,
  targetIds = [],
  felledIds = [],
  mode = "normal",
) {
  if (!attacker || !message) return;
  if (!attacker.items.some((i) => i.type === "ability" && isAnyTriumph(i))) return;
  const combat = trackedCombat(attacker);
  if (!combat?.started) return;

  const selfId = message.speaker?.token ?? null;
  const owned = attacker.items.get(message.flags?.redsteel?.weaponId ?? "") ?? null;
  const weaponCard = owned?.type === "weapon";
  const counted = message.getFlag(SYSTEM_ID, TRIUMPH_CARD_FLAG) ?? {};
  const doneCrit = Array.isArray(counted.crit) ? counted.crit : [];
  const doneKill = Array.isArray(counted.kill) ? counted.kill : [];
  const others = (ids) => [...new Set(ids)].filter((id) => id && id !== selfId);

  const newCrit =
    mode === "critical" && weaponCard
      ? others(targetIds).filter((id) => !doneCrit.includes(id))
      : [];
  const newKill = others(felledIds).filter((id) => !doneKill.includes(id));
  const gained = newCrit.length + newKill.length;
  if (!gained) return;

  await message.setFlag(SYSTEM_ID, TRIUMPH_CARD_FLAG, {
    crit: [...doneCrit, ...newCrit],
    kill: [...doneKill, ...newKill],
  });
  const stored = attacker.getFlag(SYSTEM_ID, TRIUMPH_FLAG);
  const base = stampIsThisTurn(stored?.combat, combat)
    ? Math.max(0, Number(stored.count) || 0)
    : 0;
  await attacker.setFlag(SYSTEM_ID, TRIUMPH_FLAG, {
    count: base + gained,
    combat: turnStamp(combat),
  });
}

/** Triumph triggers this actor may still cash in this turn (0 when none). */
export function pendingTriumph(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, TRIUMPH_FLAG);
  if (!stored || !stampIsThisTurn(stored.combat, game.combat)) return 0;
  return Math.max(0, Number(stored.count) || 0);
}

/**
 * Use Triumph on one waiting trigger: pay the item ("Cena za každý Triumf
 * zvlášť"), spend the trigger and raise the physical Temporary Health pool by
 * 5 (Improved: 10), never past 15. False with nothing waiting, so the caller
 * posts the ability's plain card instead.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function useTriumph(actor, ability) {
  const count = pendingTriumph(actor);
  if (!count) return false;
  // "Takto lze Dočasné životy zvýšit maximálně na 15": a pool already there
  // gains nothing, so nothing is paid or spent.
  const pool = actor.system?.stats?.temporaryHealth;
  const ceiling = Math.min(TRIUMPH_CAP, Number(pool?.max ?? 50) || 0);
  if (pool && (Number(pool.value) || 0) >= ceiling) {
    ui.notifications.warn(
      game.i18n.format("REDSTEEL.Vanguard.TriumphAtCap", {
        name: actor.name,
        max: ceiling,
      }),
    );
    return true;
  }
  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return true;
  if (count > 1) {
    const stored = actor.getFlag(SYSTEM_ID, TRIUMPH_FLAG);
    await actor.setFlag(SYSTEM_ID, TRIUMPH_FLAG, {
      count: count - 1,
      combat: stored.combat,
    });
  } else {
    await actor.unsetFlag(SYSTEM_ID, TRIUMPH_FLAG);
  }
  const amount = isImprovedTriumph(ability)
    ? IMPROVED_TRIUMPH_AMOUNT
    : TRIUMPH_AMOUNT;
  // Posts its own "gains N Temporary Health" line.
  await grantArmoring(actor, { amount, cap: TRIUMPH_CAP });
  return true;
}
