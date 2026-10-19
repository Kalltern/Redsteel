/**
 * Strážce (Warden), batch 2: the node rules that act on abilities, action
 * costs and targets. The plain shield reads (size, Bonus za štít numbers,
 * durability, sacrifice) are in wardenShield.mjs. Rulebook:
 * specializace-wip.md r653-r675.
 *
 * - Úder štítem a Zteč štítem: Zranění +1d4 (uderZraneniA, uderZraneniB, each
 *   +1d4) and Zranění +Síla/2 (uderZraneniSila, + floor(Strength / 2)) on the
 *   four shield blows: shieldBlowDamageExtra, added to the damage formula in
 *   combatSkillBonuses.mjs getNonWeaponAbility.
 * - ...: Síla +10% (uderSila10): +10 on the versus Test the four shield blows
 *   roll (Strength, or Dexterity for the small-shield forms):
 *   shieldBlowTestBonus, same place.
 * - Bonus za štít (bonusZaStit): Shield Bash's Stamina discount (small,
 *   wardenAbilityCost from combatAbilities.mjs deductAbilityCost) and its
 *   Stagger chance (medium, shieldBlowStaggerBonus in getNonWeaponAbility).
 *   Critical Defense, Deflect and Strength Tests are wardenShield.mjs.
 * - Úder štítem se počítá jako Odvetná akce (uderStitemOdveta): Shield Bash
 *   swung off the Warden's own turn is a Retaliation action. It is offered on
 *   the hotbar after a successful Defense (the Counterattack gate,
 *   actionSuggestions.mjs), costs the Reaction instead of its Action
 *   (wardenActionCostItems) and its card is tagged "retaliation" so it
 *   answers the defense and cannot itself be answered (getNonWeaponAbility).
 * - Dvojitý úder (dvojityUder): the Double Strike modifier on Shield Bash
 *   needs exactly two targeted opponents, both next to the Warden and next to
 *   each other (doubleStrikeRefusal, before anything is paid). The card names
 *   both; Apply Damage pushes each one and forcedMovement.mjs reads each
 *   defender's own versus answer for the Prone at a gap of 50.
 * - Obranný postoj: Sousedící spojenci +5% do Obrany (obrannyPostojSpojenci):
 *   an aura read at roll time (wardenAllyDefenseBonus in defense.mjs
 *   buildDefenseProfile), never an Active Effect on the allies.
 * - Vylepšený obranný postoj (vylObrannyPostoj): "Jednou za kolo může použít
 *   Obrnění nebo Pomalý pohyb jako Volnou akci". One allowance a round,
 *   shared: Armoring (or Improved Armoring) costs no Action
 *   (wardenActionCostItems), or Slow Movement is declared for no Action
 *   (claimWardenFreeSlowMovement, from redsteelHotbar.mjs). Only while the
 *   stance holds and only for the owner of the Improved Defensive Stance item.
 * - Ochrana: Jednou za kolo jako Volná akce (ochranaVolna): once a round the
 *   Guard (Ochrana) costs no Reaction; its Stamina is still paid.
 * - Protiútok: Zásah +10% (protiutokZasah): counterattackHitBonus, read in
 *   getAttackRolls.
 * - Vylepšené obrnění (vylObrneni): 15 Temporary Health up to 15, on the
 *   user or on one adjacent targeted token (useImprovedArmoring, through
 *   armoring.mjs grantArmoring).
 *
 * Once-per-round allowances are bonus sources in the action tracker's
 * round-stamped record (actionTracker.mjs markBonusSource), so they expire
 * with the round and need no cleanup.
 */

import {
  costOf,
  getSpent,
  isTrackedTurn,
  markBonusSource,
  trackedCombat,
} from "./actionTracker.mjs";
import { areAdjacent } from "./positioning.mjs";
import { isHostileSide, tokenForActor } from "./movementZones.mjs";
import { isProtectionAbility } from "./protection.mjs";
import { grantArmoring, isArmoring } from "./armoring.mjs";
import {
  hasWardenNode,
  heldShield,
  shieldSize,
  wardenShieldBonus,
} from "./wardenShield.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const docOf = (token) => token?.document ?? token ?? null;

/* -------------------------------------------- */
/*  Identities                                  */
/* -------------------------------------------- */

export const SHIELD_BASH_KEYS = Object.freeze([
  "REDSTEEL.Items.ShieldBash.name",
  "REDSTEEL.Items.ShieldBashSmallShield.name",
]);
export const SHIELD_CHARGE_KEYS = Object.freeze([
  "REDSTEEL.Items.ShieldCharge.name",
  "REDSTEEL.Items.ShieldChargeSmallShield.name",
]);
const SHIELD_BASH_NAMES = ["Shield Bash", "Shield Bash (small shield)"];
const SHIELD_CHARGE_NAMES = ["Shield Charge", "Shield Charge (small shield)"];

const COUNTERATTACK_KEY = "REDSTEEL.Items.Counterattack.name";
const DOUBLE_STRIKE_KEY = "REDSTEEL.Items.DoubleStrike.name";
const IMPROVED_ARMORING_KEY = "REDSTEEL.Items.ImprovedArmoring.name";
const IMPROVED_STANCE_KEY = "REDSTEEL.Items.ImprovedDefensiveStance.name";

/** Uder štítem a Zteč štítem: Zranění +1d4, per node. */
const SHIELD_BLOW_DIE = "1d4";
/** ...: Síla +10%. */
export const SHIELD_BLOW_TEST_BONUS = 10;
/** Protiútok: Zásah +10%. */
export const COUNTERATTACK_HIT_BONUS = 10;
/** Obranný postoj: Sousedící spojenci +5% do Obrany. */
export const STANCE_ALLY_DEFENSE_BONUS = 5;
/** Vylepšené obrnění: "Získá 15 ... maximálně na 15". */
export const IMPROVED_ARMORING_AMOUNT = 15;
export const IMPROVED_ARMORING_CAP = 15;

/** A creature in one of these is not a living opponent or ally. */
const FALLEN_STATUSES = ["dead", "dying", "downed", "unconscious"];

const keyOf = (ability) => ability?.system?.localizationKey ?? null;

/** Úder štítem, either form. */
export function isShieldBash(ability) {
  return (
    SHIELD_BASH_KEYS.includes(keyOf(ability)) ||
    SHIELD_BASH_NAMES.includes(ability?.name)
  );
}

/** Úder štítem or Zteč štítem, either form: the four "shield blows". */
export function isShieldBlow(ability) {
  return (
    isShieldBash(ability) ||
    SHIELD_CHARGE_KEYS.includes(keyOf(ability)) ||
    SHIELD_CHARGE_NAMES.includes(ability?.name)
  );
}

/** Dvojitý úder, the Shield Bash modifier. */
export function isDoubleStrike(mod) {
  return keyOf(mod) === DOUBLE_STRIKE_KEY || mod?.name === "Double Strike";
}

function isCounterattack(ability) {
  return keyOf(ability) === COUNTERATTACK_KEY || ability?.name === "Counterattack";
}

function isImprovedArmoring(ability) {
  return (
    keyOf(ability) === IMPROVED_ARMORING_KEY ||
    ability?.name === "Improved Armoring"
  );
}

/* -------------------------------------------- */
/*  Shield blows                                */
/* -------------------------------------------- */

/**
 * Extra damage terms on a shield blow, as a formula tail (" + 1d4 + 2"), or
 * "" when none apply. Strength is the attribute total a character's weapon
 * damage reads; an NPC has no such total and gets no Strength term.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {string}
 */
export function shieldBlowDamageExtra(actor, ability) {
  if (!isShieldBlow(ability)) return "";
  const terms = [];
  if (hasWardenNode(actor, "uderZraneniA")) terms.push(SHIELD_BLOW_DIE);
  if (hasWardenNode(actor, "uderZraneniB")) terms.push(SHIELD_BLOW_DIE);
  if (hasWardenNode(actor, "uderZraneniSila")) {
    const str = Math.floor((Number(actor.system?.attributes?.str?.total) || 0) / 2);
    if (str > 0) terms.push(String(str));
  }
  return terms.length ? ` + ${terms.join(" + ")}` : "";
}

/** ...: Síla +10% on the shield blow's own versus Test. */
export function shieldBlowTestBonus(actor, ability) {
  return isShieldBlow(ability) && hasWardenNode(actor, "uderSila10")
    ? SHIELD_BLOW_TEST_BONUS
    : 0;
}

/** Bonus za štít, medium: Shield Bash Stagger chance +10. */
export function shieldBlowStaggerBonus(actor, ability) {
  if (!isShieldBash(ability)) return 0;
  return wardenShieldBonus(actor)?.bashStagger ?? 0;
}

/**
 * Bonus za štít, small: "Úder štítem levnější o 3 Výdrže". The Stamina an
 * ability costs after the Warden's discount, never below 0.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {number} cost  the cost before this discount
 */
export function wardenAbilityCost(actor, ability, cost) {
  if (!isShieldBash(ability)) return cost;
  if ((ability.system?.costType || "stamina") !== "stamina") return cost;
  const discount = wardenShieldBonus(actor)?.bashDiscount ?? 0;
  return discount ? Math.max(0, cost - discount) : cost;
}

/** Protiútok: Zásah +10% on Counterattack. */
export function counterattackHitBonus(actor, ability) {
  return isCounterattack(ability) && hasWardenNode(actor, "protiutokZasah")
    ? COUNTERATTACK_HIT_BONUS
    : 0;
}

/* -------------------------------------------- */
/*  Retaliation                                 */
/* -------------------------------------------- */

/** Fighting in a started encounter, during somebody else's turn. */
function isOffTurn(actor) {
  return !!trackedCombat(actor) && !isTrackedTurn(actor);
}

/**
 * Úder štítem se počítá jako Odvetná akce: Shield Bash swung off the
 * Warden's own turn.
 */
export function isShieldBashAsRetaliation(actor, ability) {
  return (
    isShieldBash(ability) &&
    hasWardenNode(actor, "uderStitemOdveta") &&
    isOffTurn(actor)
  );
}

/**
 * The Shield Bash a retaliation chip offers: the small-shield form while a
 * small shield is in hand, the ordinary one otherwise, whichever the actor
 * owns. Null without the node or without either ability.
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function retaliationShieldBash(actor) {
  if (!hasWardenNode(actor, "uderStitemOdveta")) return null;
  const bashes = actor.items.filter((i) => i.type === "ability" && isShieldBash(i));
  if (!bashes.length) return null;
  const small = shieldSize(heldShield(actor)) === "small";
  const preferred = bashes.find(
    (i) =>
      (keyOf(i) === "REDSTEEL.Items.ShieldBashSmallShield.name" ||
        i.name === "Shield Bash (small shield)") === small,
  );
  return preferred ?? bashes[0];
}

/* -------------------------------------------- */
/*  Action costs                                */
/* -------------------------------------------- */

function freeGuardSource(combat) {
  return `wardenFreeGuard.${combat.id}.${combat.round}`;
}

function stanceFreeSource(combat) {
  return `wardenStanceFree.${combat.id}.${combat.round}`;
}

/** Holds Improved Defensive Stance right now. */
function holdsImprovedStance(actor) {
  if (!actor?.statuses?.has?.("defensive_stance")) return false;
  return actor.items.some(
    (i) =>
      i.type === "ability" &&
      (keyOf(i) === IMPROVED_STANCE_KEY || i.name === "Improved Defensive Stance"),
  );
}

/** Is the stance's free Armoring / Slow Movement still unused this round? */
function stanceFreeAvailable(actor) {
  const combat = trackedCombat(actor);
  if (!combat || !holdsImprovedStance(actor)) return false;
  return !getSpent(actor).bonusSources.includes(stanceFreeSource(combat));
}

/** A cost line the tracker reads as one Reaction. */
const REACTION_COST = Object.freeze({ system: Object.freeze({ actionCost: "Reaction" }) });

/**
 * The items the action tracker should charge for, after the Warden's free
 * uses and swaps. Called by combatAbilities.mjs deductAbilityCost right
 * before spendForItems, once everything has been paid; marks the round's
 * allowances it uses.
 *
 * - Shield Bash as a retaliation: charged as one Reaction.
 * - Ochrana with ochranaVolna: the round's first off-turn use is free.
 * - Armoring or Improved Armoring under Improved Defensive Stance: the
 *   round's shared allowance makes it free.
 *
 * @param {Actor} actor
 * @param {Item[]} items
 * @returns {Promise<Item[]>}
 */
export async function wardenActionCostItems(actor, items) {
  const combat = trackedCombat(actor);
  if (!combat) return items;
  const out = [];
  for (const item of items) {
    if (isShieldBashAsRetaliation(actor, item)) {
      out.push(REACTION_COST);
      continue;
    }
    const cost = costOf(actor, item);
    if (
      isProtectionAbility(item) &&
      cost.reactions > 0 &&
      hasWardenNode(actor, "ochranaVolna") &&
      (await markBonusSource(actor, freeGuardSource(combat)))
    ) {
      ui.notifications.info(game.i18n.localize("REDSTEEL.Warden.FreeGuard"));
      continue;
    }
    if (
      (isArmoring(item) || isImprovedArmoring(item)) &&
      cost.actions > 0 &&
      stanceFreeAvailable(actor) &&
      (await markBonusSource(actor, stanceFreeSource(combat)))
    ) {
      ui.notifications.info(game.i18n.localize("REDSTEEL.Warden.FreeStanceAction"));
      continue;
    }
    out.push(item);
  }
  return out;
}

/**
 * Vylepšený obranný postoj: Slow Movement declared for no Action, using the
 * round's shared allowance. Called by the hotbar right before it locks Slow
 * Movement; true when the Action is waived.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export async function claimWardenFreeSlowMovement(actor) {
  const combat = trackedCombat(actor);
  if (!combat || !isTrackedTurn(actor) || !stanceFreeAvailable(actor)) return false;
  if (!(await markBonusSource(actor, stanceFreeSource(combat)))) return false;
  ui.notifications.info(game.i18n.localize("REDSTEEL.Warden.FreeStanceAction"));
  return true;
}

/* -------------------------------------------- */
/*  Double Strike                               */
/* -------------------------------------------- */

function isLiving(doc) {
  return !FALLEN_STATUSES.some((s) => doc?.actor?.statuses?.has(s));
}

/**
 * Why Shield Bash with Double Strike cannot go ahead, or null when it can:
 * exactly two targeted, living opponents, each next to the Warden and next
 * to each other ("dva vedle sebe se nacházející oponenty").
 *
 * @param {Actor} actor
 * @param {Token|TokenDocument|null} token  the Warden
 * @param {Item} ability
 * @param {Token[]} targets  the user's current targets
 * @returns {string|null}
 */
export function doubleStrikeRefusal(actor, token, ability, targets) {
  if (!isShieldBash(ability)) {
    return game.i18n.localize("REDSTEEL.Warden.DoubleStrikeBashOnly");
  }
  const self = docOf(token);
  const docs = (targets ?? []).map(docOf).filter((d) => d && d.id !== self?.id);
  if (!self || docs.length !== 2) {
    return game.i18n.localize("REDSTEEL.Warden.DoubleStrikeTwoTargets");
  }
  const mySide = isHostileSide(self);
  const [a, b] = docs;
  const valid =
    docs.every((d) => isLiving(d) && isHostileSide(d) !== mySide && areAdjacent(self, d)) &&
    areAdjacent(a, b);
  return valid
    ? null
    : game.i18n.localize("REDSTEEL.Warden.DoubleStrikeAdjacency");
}

/* -------------------------------------------- */
/*  Defensive Stance aura                       */
/* -------------------------------------------- */

/**
 * Obranný postoj: Sousedící spojenci +5% do Obrany. +5 when a Warden with the
 * node, holding `defensive_stance`, stands next to this defender on the same
 * side. Never the Warden itself, and several Wardens do not stack.
 *
 * @param {TokenDocument|Token|null} defenderToken
 * @returns {number}
 */
export function wardenAllyDefenseBonus(defenderToken) {
  const doc = docOf(defenderToken);
  const scene = doc?.parent;
  if (!doc || !scene) return 0;
  const side = isHostileSide(doc);
  const found = scene.tokens.contents.some((other) => {
    if (other.id === doc.id || !other.actor) return false;
    const actor = other.actor;
    if (!actor.statuses?.has("defensive_stance")) return false;
    if (!hasWardenNode(actor, "obrannyPostojSpojenci")) return false;
    if (isHostileSide(other) !== side || !isLiving(other)) return false;
    return areAdjacent(doc, other);
  });
  return found ? STANCE_ALLY_DEFENSE_BONUS : 0;
}

/* -------------------------------------------- */
/*  Improved Armoring                           */
/* -------------------------------------------- */

/** Is this the Improved Armoring ability? */
export { isImprovedArmoring };

/**
 * Vylepšené obrnění: 15 Temporary Health up to 15, on the user or on an
 * adjacent target. Targets are read off the user's targets: one adjacent
 * target takes it, none (or only non-adjacent ones, with a notice) means
 * the user, several adjacent ones open a pick. Paid by the caller.
 *
 * @param {Actor} actor
 */
export async function useImprovedArmoring(actor) {
  const self = docOf(tokenForActor(actor));
  const targeted = [...(game.user?.targets ?? [])]
    .map(docOf)
    .filter((d) => d?.actor && d.id !== self?.id);
  const adjacent = self ? targeted.filter((d) => areAdjacent(self, d)) : [];
  if (targeted.length && !adjacent.length) {
    ui.notifications.info(game.i18n.localize("REDSTEEL.Warden.ArmoringNotAdjacent"));
  }

  let target = actor;
  if (adjacent.length === 1) {
    target = adjacent[0].actor;
  } else if (adjacent.length > 1) {
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize(IMPROVED_ARMORING_KEY) },
      content: `<p>${game.i18n.localize("REDSTEEL.Warden.ArmoringPick")}</p>`,
      buttons: [
        { action: "self", label: esc(self?.name ?? actor.name), default: true },
        ...adjacent.map((d) => ({ action: d.id, label: esc(d.name) })),
      ],
      rejectClose: false,
    });
    const doc = adjacent.find((d) => d.id === picked);
    if (doc) target = doc.actor;
  }

  return grantArmoring(actor, {
    amount: IMPROVED_ARMORING_AMOUNT,
    cap: IMPROVED_ARMORING_CAP,
    targetActor: target,
  });
}
