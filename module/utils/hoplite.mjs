/**
 * Hoplita (Hoplite), batch 1: the pieces that live outside the node passives.
 * Czech rulebook text: docs/rules-source/rules/specializace-wip.md r242-r277.
 *
 * - Zranění se počítá za Sílu i Obratnost (silaObratnost): weapon damage adds
 *   Strength AND Dexterity (user ruling 2026-10-18). Built into
 *   weaponFormula.mjs weaponDamageFormula, reading hasHopliteNode here.
 * - Může útočit přes oponentem okupovaný hex (hexAttack): positioning.mjs
 *   checkMeleeReach lets the line pass an opponent. Reckless Strike and
 *   Exploit Weakness still refuse any occupied hex (their own rule).
 * - Troufalý vrh (Daring Throw): "Vrhne kopí/trojzubec na cíl max 5 hex ...
 *   Snižuje hranici pro Kritický zásah na Úspěch o síle +40. Může jako Volnou
 *   akci přezbrojit na lehkou zbraň. Nelze použít, sousedí-li s nepřítelem."
 *   Refused next to a living enemy, at a target beyond DARING_THROW_MAX_RANGE
 *   hexes, and without a spear, trident or javelin to throw
 *   (daringThrowRefusal, called from combatAbilities.mjs before anything is
 *   paid). The melee Spear or Trident is thrown as it is (user ruling
 *   2026-10-18): asDaringThrowView marks it thrown for this one attack, so it
 *   rolls the Throwing skill under the thrown range rules and spends no ammo,
 *   while it stays a polearm for every class and tag read (doctrines, weapon
 *   skill, weapon specialisation; user ruling 2026-10-18: "a polearm throw"). A margin of DARING_THROW_CRIT_MARGIN or more counts as
 *   a Critical Hit (daringThrowMarginCrit, read in combatSkillBonuses.mjs
 *   getAttackRolls). After the card the hotbar offers "Draw a light weapon"
 *   for that turn (noteDaringThrow, useDrawLightWeapon, swapMainWeapon).
 *   Zatížení štítu +50%: DARING_THROW_SHIELD_STRAIN, added to the strain
 *   chance the attack card carries (combatSkillBonuses.mjs getEffectRolls,
 *   rolled on a successful Cover in shieldStrain.mjs).
 * - Momentum (Hoplite): "Při zabití oponenta útokem Krátkým mečem, Sekerkou,
 *   Palcátem, Kopím, Trojzubcem nebo akcí Troufalý vrh může jednou za kolo
 *   ihned znovu zaútočit. Při kritickém zásahu ... může jednou za kolo ihned
 *   znovu zaútočit." Apply Damage stamps the chance and the chip pays the
 *   item and makes the next plain Attack free (actionTracker.mjs
 *   grantFreeAttack). Own turn only. The flow is shared with the doctrine
 *   Momentum in momentum.mjs; the weapon list stays here (isMomentumWeapon).
 * - Postup (Advance): "Zabije-li libovolným útokem nepřítele, může se okamžitě
 *   pohnout ve směru útoku až o dvě hexy. Zabije-li cíl vzdálený maximálně
 *   tři hexy akcí Troufalý vrh, může se pohnout ve směru vrhu ... Tento pohyb
 *   nevyvolává Příležitostné útoky." Apply Damage stamps it
 *   (offerHopliteAdvance); the chip pays and grants a two hex `advance` bonus
 *   step (movementZones.mjs), free of threat, kept to the line of the attack
 *   by the lock's `along`. Also off turn, like Half Pirouette.
 * - Rázný postup (Forceful Advance): "Pohne-li se akcí Postup, může jednou za
 *   kolo udělat Úder štítem nebo Zteč štítem jako Volnou akci." When an
 *   Advance step ends having moved (completeHopliteAdvance, from the strip's
 *   ✓ in redsteelHotbar.mjs or the walked-out step in documents/token.mjs),
 *   the shield abilities cost no Action for the rest of that turn
 *   (actionTracker.mjs grantFreeAbility). Their Stamina is still paid. The
 *   "target in the direction of the movement" is left to the table.
 *
 * - Nápor I (Onslaught I): "Pokud Úder štítem, Zteč štítem či Podseknutí
 *   odsunou či povalí cíl, může jednou za kolo ihned znovu zaútočit. Před
 *   provedením útoku může za Volnou akci přezbrojit na Kopí/Trojzubec za 5
 *   Výdrže." Apply Damage stamps it (offerHopliteOnslaught) when a shield
 *   blow's push moved the target (forcedMovement.mjs resolvePushOnHit), or a
 *   shield blow or a Trip card left the target newly Prone.
 * - Nápor II (Onslaught II): "Pokud Úder štítem či Zteč štítem neodsunou cíl,
 *   může jednou za kolo ihned znovu zaútočit. Před provedením útoku může za
 *   Volnou akci přezbrojit na Krátký meč/Sekerku/Palcát za 5 Výdrže." Stamped
 *   when a shield blow's pushes moved nothing (collided, Rooted), or when the
 *   defender won the versus Test or a Defense against a Shield Bash (the
 *   active GM queue in registerHopliteHooks). A lost Shield Charge contest
 *   still pushes its first hex, so only its collisions count.
 *   Shield Charge's pushes, Shield Bash's and Charge's Prone at a gap of 50,
 *   and Trip's knockdown on a won answer live in forcedMovement.mjs, for
 *   every character; their results feed both Onslaughts.
 *   Both: the chip asks "attack" or "switch to <weapon> and attack" (user
 *   ruling 2026-10-18, "offer the swap"), pays 3 or 3 + 5 Stamina, swaps with
 *   swapMainWeapon and makes the next plain Attack free (grantFreeAttack).
 *   Own turn only, once per round each, once per card.
 *
 * - Příležitostný útok za kolo (prilezitostnyUtok, user ruling 2026-10-18):
 *   once per round, the Long Reach polearm Opportunity Attack at an enemy
 *   that closed the distance costs no Reaction (claimHopliteFreeOpportunity,
 *   called from attackActions.mjs). "Closed" = its last move this turn ended
 *   nearer the Hoplite than it began and within reach (the moveToken hook's
 *   TokenMovementData origin and destination, kept in recentMoves).
 * - Přípravný postoj (Prepared Stance): the `prepared_stance` status (no
 *   clock). The next Opportunity Attack with a spear or trident takes +20 Hit
 *   and spends it; any other weapon attack, or the holder's own move, breaks
 *   it (settlePreparedStance in combatSkillBonuses.mjs getAttackRolls,
 *   breakPreparedStanceOnMove).
 * - Obrana proti zteči (Charge Defense): legal only on a spear or trident
 *   Opportunity Attack at a charging or sprinting target (filterChargeDefense),
 *   Impale free beside it (hopliteModifierCosts), and on a hit the charge is
 *   stopped and the charger kept two hexes off (settleChargeDefense, from
 *   applyDamage.mjs).
 *
 * A "kill" is the user ruling of 2026-10-12/14: the victim ended the Apply
 * Damage dead, or newly Downed, Dying or Unconscious (applyDamage.mjs
 * felledIds).
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import {
  getMovementLock,
  getSpent,
  grantBonusStep,
  grantFreeAbility,
  grantFreeAttack,
  isTrackedTurn,
  liveFreeAbility,
  markBonusSource,
  stopMovementLock,
  trackedCombat,
} from "./actionTracker.mjs";
import { isForcedMove } from "./forcedMoveRegistry.mjs";
import {
  isHostileSide,
  tokenForActor,
  tokenMovementSpent,
} from "./movementZones.mjs";
import { areAdjacent, tokenHexDistance, weaponReach } from "./positioning.mjs";
import {
  buildWeaponSetView,
  getWeaponTags,
  resolveWeaponContext,
} from "./weaponResolver.mjs";
import { isHandheldLight } from "./itemLight.mjs";
import { swapMainWeapon } from "./rearm.mjs";
import { weaponDamageFormula } from "./weaponFormula.mjs";
import { canSpendResource } from "./itemResources.mjs";
// Call time only: forcedMovement.mjs reaches this file through applyDamage.mjs.
import {
  pushToken,
  resolveVersusAnswer,
  TRIP_KEYS,
  versusOutcome,
} from "./forcedMovement.mjs";

/* -------------------------------------------- */
/*  Rule constants                              */
/* -------------------------------------------- */

const SYSTEM_ID = "redsteel";
const SPEC_ID = "hoplite";

export const DARING_THROW_KEY = "REDSTEEL.Items.DaringThrow.name";
export const HOPLITE_MOMENTUM_KEY = "REDSTEEL.Items.HopliteMomentum.name";
export const ADVANCE_KEY = "REDSTEEL.Items.Advance.name";

/** Daring Throw: "Kritický zásah na Úspěch o síle +40". */
export const DARING_THROW_CRIT_MARGIN = 40;
/** Daring Throw: "Zatížení štítu +50%" (shieldStrain.mjs rolls it). */
export const DARING_THROW_SHIELD_STRAIN = 50;
/** Daring Throw: "na cíl vzdálený maximálně 5 hex". */
export const DARING_THROW_MAX_RANGE = 5;
/** Advance: "až o dvě hexy". */
export const ADVANCE_STEP_HEXES = 2;
/** Advance after Daring Throw: "cíl vzdálený maximálně tři hexy". */
export const ADVANCE_THROW_RANGE = 3;

/**
 * What Daring Throw may throw: "kopí/trojzubec". The pack's thrown spear is
 * the Javelin, so it counts too. Matched against the weapon's tags and its
 * English name.
 */
const DARING_THROW_WEAPONS = new Set(["spear", "trident", "javelin"]);
/** Momentum's weapons: "Krátkým mečem, Sekerkou, Palcátem, Kopím, Trojzubcem". */
const MOMENTUM_WEAPONS = new Set([
  "shortsword",
  "hatchet",
  "mace",
  "spear",
  "trident",
]);

/** Forceful Advance: "Úder štítem nebo Zteč štítem", both shield sizes. */
export const FORCEFUL_ADVANCE_KEYS = Object.freeze([
  "REDSTEEL.Items.ShieldBash.name",
  "REDSTEEL.Items.ShieldBashSmallShield.name",
  "REDSTEEL.Items.ShieldCharge.name",
  "REDSTEEL.Items.ShieldChargeSmallShield.name",
]);

/** Melee weapon classes (bows and crossbows are not swung). */
const MELEE_CLASSES = ["axe", "sword", "blunt", "polearm"];

/** A creature in one of these is neither a threat nor a target. */
const FALLEN_STATUSES = ["dead", "dying", "downed", "unconscious"];

/** Actor flags (all turn-stamped, a stale one reads as nothing pending).
 * Momentum's own flag lives in momentum.mjs. */
const ADVANCE_FLAG = "hopliteAdvance";
const DRAW_LIGHT_FLAG = "hopliteDrawLight";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/* -------------------------------------------- */
/*  Shared reads                                */
/* -------------------------------------------- */

/** Has this actor unlocked the Hoplite node? */
export function hasHopliteNode(actor, nodeId) {
  return !!actor && actorHasSpecNode(actor, SPEC_ID, nodeId);
}

function isKeyed(ability, key, englishName) {
  if (typeof ability === "string") return ability === key;
  return (
    ability?.system?.localizationKey === key || ability?.name === englishName
  );
}

/** Is this the Daring Throw ability (an item, or a card's ability key)? */
export function isDaringThrow(ability) {
  return isKeyed(ability, DARING_THROW_KEY, "Daring Throw");
}

/** Is this Momentum (Hoplite)? */
export function isHopliteMomentum(ability) {
  return isKeyed(ability, HOPLITE_MOMENTUM_KEY, "Momentum (Hoplite)");
}

/** Is this Advance (Postup)? */
export function isHopliteAdvance(ability) {
  return isKeyed(ability, ADVANCE_KEY, "Advance");
}

/** Was this card a Daring Throw? */
export function cardIsDaringThrow(message) {
  const flags = message?.flags?.redsteel ?? {};
  return (
    flags.abilityKey === DARING_THROW_KEY || flags.abilityName === "Daring Throw"
  );
}

/**
 * The names a weapon answers to, lower-cased with spaces dropped: its tags
 * and its English name, less a trailing " melee" ("Javelin melee").
 */
function weaponNames(weapon) {
  if (!weapon) return new Set();
  const squash = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, "");
  const name = String(weapon.name ?? "").replace(/\s+melee$/i, "");
  return new Set([...getWeaponTags(weapon).map(squash), squash(name)]);
}

function weaponIn(weapon, set) {
  for (const name of weaponNames(weapon)) if (set.has(name)) return true;
  return false;
}

/** May Daring Throw throw this weapon? */
export function isDaringThrowWeapon(weapon) {
  return weapon?.type === "weapon" && weaponIn(weapon, DARING_THROW_WEAPONS);
}

/** Does Momentum fire for this weapon? */
export function isMomentumWeapon(weapon) {
  return weapon?.type === "weapon" && weaponIn(weapon, MOMENTUM_WEAPONS);
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

function isFallen(actor) {
  return FALLEN_STATUSES.some((s) => actor?.statuses?.has(s));
}

/** Living enemies standing next to this token (isHostileSide sides). */
function adjacentEnemies(token) {
  if (!token?.document) return [];
  const hostile = isHostileSide(token.document);
  return (canvas.tokens?.placeables ?? []).filter((t) => {
    if (t === token || !t.actor) return false;
    if (!t.visible && !game.user.isGM) return false;
    if (isFallen(t.actor)) return false;
    if (isHostileSide(t.document) === hostile) return false;
    return areAdjacent(token, t);
  });
}

/** Grid offset key "i,j" under a token document's stored position. */
function hexKeyOf(doc) {
  if (!doc || !canvas?.grid) return null;
  const src = doc._source ?? doc;
  const center = {
    x: Number(src.x) + (Number(doc.width ?? 1) * canvas.grid.sizeX) / 2,
    y: Number(src.y) + (Number(doc.height ?? 1) * canvas.grid.sizeY) / 2,
  };
  const { i, j } = canvas.grid.getOffset(center);
  return `${i},${j}`;
}

function postLines(actor, title, lines) {
  const token = tokenForActor(actor);
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
    flavor: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
${lines.map((l) => `<p style="text-align:center;">${l}</p>`).join("")}`,
  });
}

/* -------------------------------------------- */
/*  Daring Throw                                */
/* -------------------------------------------- */

/**
 * Why Daring Throw cannot be used right now, localized, or null when it can.
 * Asked before anything is paid.
 *
 * - Next to a living enemy: "Nelze použít, sousedí-li s nepřítelem."
 * - Nothing to throw: the active set's weapon (when the ranged flow resolves
 *   one) must be a spear, trident or javelin; without one resolved (an NPC,
 *   or a character holding a melee spear) the actor must carry a thrown one,
 *   which the weapon picker then offers alone (combatAbilities.mjs).
 *
 * @param {Actor} actor
 * @param {Token|null} token
 * @param {Item} ability
 * @returns {string|null}
 */
export function daringThrowRefusal(actor, token, ability) {
  if (!isDaringThrow(ability)) return null;
  const live = token ?? tokenForActor(actor);
  if (live && adjacentEnemies(live).length) {
    return game.i18n.localize("REDSTEEL.Hoplite.DaringThrowAdjacent");
  }
  // "max 5 hex": measured to the farthest current target. No target, nothing
  // to measure, like every other range check.
  if (live) {
    let farthest = 0;
    for (const target of game.user?.targets ?? []) {
      if (target === live) continue;
      farthest = Math.max(farthest, tokenHexDistance(live, target));
    }
    if (farthest > DARING_THROW_MAX_RANGE) {
      return game.i18n.format("REDSTEEL.Hoplite.DaringThrowTooFar", {
        distance: farthest,
        max: DARING_THROW_MAX_RANGE,
      });
    }
  }
  const context = daringThrowContext(actor, ability);
  const ok = context?.weapon
    ? isDaringThrowWeapon(context.weapon)
    : actor.items.some((i) => isDaringThrowWeapon(i));
  return ok ? null : game.i18n.localize("REDSTEEL.Hoplite.DaringThrowNoSpear");
}

/** Is this object a Daring Throw view built by asDaringThrowView? */
export function isDaringThrowView(weapon) {
  return weapon?.isDaringThrowView === true;
}

/**
 * The weapon as Daring Throw throws it. A weapon already thrown (the
 * Javelin) comes back unchanged. A melee spear or trident comes back as a
 * Proxy over the real Item, the makeshift.mjs pattern: only `system` differs,
 * a clone with `thrown: true` (Throwing skill, thrown range penalty, the
 * thrown crit range and reroll pool, no reach check) and `daringThrow: true`
 * (no ammo, and getAttackCritThresholds keeps the weapon skill crit a thrown
 * weapon otherwise drops). Class, type, tags, doctrines and the rest are the
 * spear's own, so polearm reads all still see a polearm. The damage formula
 * is rebuilt on the thrown block, so it takes the thrown attribute rule
 * (weaponFormula.mjs). Everything else, id included, is the real Item's.
 *
 * @param {Item|null} weapon
 * @returns {Item|null}
 */
export function asDaringThrowView(weapon) {
  if (!weapon || weapon.system?.thrown === true || isDaringThrowView(weapon)) {
    return weapon;
  }
  let system = foundry.utils.deepClone(weapon.system);
  if (system === weapon.system) system = foundry.utils.deepClone({ ...weapon.system });
  system.thrown = true;
  system.daringThrow = true;
  system.formula = weaponDamageFormula(weapon.actor, system);
  return new Proxy(weapon, {
    get(target, prop) {
      if (prop === "system") return system;
      if (prop === "isDaringThrowView") return true;
      const v = Reflect.get(target, prop, target);
      if (prop === "constructor") return v;
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

/**
 * The weapon context Daring Throw throws with: what the ranged flow resolves
 * (a thrown weapon in the active set, or the picked one), else, for a
 * character, the active set's melee spear or trident. The weapon comes back
 * as asDaringThrowView. Null with neither.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {Item|null} [selected]  a weapon picked in the dialog
 */
export function daringThrowContext(actor, ability, selected = null) {
  let context = resolveWeaponContext(actor, ability, selected);
  if (!context && !selected && actor?.type === "character") {
    const plain = resolveWeaponContext(actor);
    if (plain?.weapon && isDaringThrowWeapon(plain.weapon)) context = plain;
  }
  if (!context?.weapon) return null;
  return { ...context, weapon: asDaringThrowView(context.weapon) };
}

/**
 * Daring Throw: a success of +40 or better is a Critical Hit. A fumble stays
 * a fumble.
 *
 * @param {Item|null} ability
 * @param {number} margin       the attack roll's total (margin of success)
 * @param {boolean} critFailure
 */
export function daringThrowMarginCrit(ability, margin, critFailure) {
  return (
    !critFailure &&
    isDaringThrow(ability) &&
    Number(margin) >= DARING_THROW_CRIT_MARGIN
  );
}

/**
 * The Daring Throw card is out: "Může jako Volnou akci přezbrojit na lehkou
 * zbraň." Stamps the offer for the rest of this turn. Characters only (NPCs
 * have no weapon sets). Runs on the thrower's client.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {ChatMessage} message
 */
export async function noteDaringThrow(actor, ability, message) {
  if (!actor?.isOwner || actor.type !== "character") return;
  if (!isDaringThrow(ability)) return;
  const combat = trackedCombat(actor);
  if (!combat) return;
  await actor.setFlag(SYSTEM_ID, DRAW_LIGHT_FLAG, {
    messageId: message?.id ?? null,
    combat: turnStamp(combat),
  });
}

/**
 * The light weapons this character could draw into the main hand: Light,
 * swung (not thrown, not a bow), not a shield or a torch, not already the
 * active main hand.
 *
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function lightWeaponCandidates(actor) {
  if (actor?.type !== "character") return [];
  const activeSet = actor.system.combat?.activeWeaponSet;
  const mainId = activeSet
    ? actor.system.combat?.weaponSets?.[activeSet]?.main
    : null;
  return actor.items.filter(
    (i) =>
      i.type === "weapon" &&
      i.system?.type === "light" &&
      MELEE_CLASSES.includes(i.system?.class) &&
      i.system?.thrown !== true &&
      !i.system?.shield &&
      !isHandheldLight(i) &&
      i.id !== mainId,
  );
}

/** The pending "Draw a light weapon" offer, or null. */
export function pendingDrawLightWeapon(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, DRAW_LIGHT_FLAG);
  if (!stored || !stampIsThisTurn(stored.combat, game.combat)) return null;
  const candidates = lightWeaponCandidates(actor);
  if (!candidates.length) return null;
  return { ...stored, candidates };
}

// swapMainWeapon (put a weapon in the active set's main hand) lives in
// rearm.mjs now, shared with the Re-arm family; imported above and
// re-exported from here so older imports keep working.
export { swapMainWeapon };

/**
 * The "Draw a light weapon" chip: the only candidate, or the player's pick,
 * goes into the active set's main hand. A Free action, so nothing is spent.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export async function useDrawLightWeapon(actor) {
  const pending = pendingDrawLightWeapon(actor);
  if (!pending) return false;
  let weapon = pending.candidates[0];
  if (pending.candidates.length > 1) {
    const picked = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("REDSTEEL.Hoplite.DrawLightWeapon") },
      content: `<p>${game.i18n.localize("REDSTEEL.Hoplite.DrawLightWeaponPrompt")}</p>`,
      buttons: pending.candidates.map((w, n) => ({
        action: w.id,
        label: w.localizedName ?? w.name,
        default: n === 0,
      })),
      rejectClose: false,
    });
    weapon = pending.candidates.find((w) => w.id === picked) ?? null;
  }
  if (!weapon) return false;
  if (!(await swapMainWeapon(actor, weapon.id))) return false;
  await actor.unsetFlag(SYSTEM_ID, DRAW_LIGHT_FLAG);
  await postLines(actor, game.i18n.localize(DARING_THROW_KEY), [
    game.i18n.format("REDSTEEL.Hoplite.DrewWeapon", {
      name: esc(actor.name),
      weapon: esc(weapon.localizedName ?? weapon.name),
    }),
  ]);
  return true;
}

/* -------------------------------------------- */
/*  Momentum (Hoplite)                          */
/* -------------------------------------------- */

// The offer, the chip's pending read and the use moved to momentum.mjs, which
// runs Momentum (Hoplite) and the doctrine Momentum down one path (one
// Momentum per round across both). This file keeps the Hoplite qualifier:
// hasHopliteNode, isHopliteMomentum, isMomentumWeapon and cardIsDaringThrow.

/** Does the actor carry an ability passing `test`? */
function ownsAbility(actor, test) {
  return actor.items.some((i) => i.type === "ability" && test(i));
}

/* -------------------------------------------- */
/*  Advance (Postup) and Forceful Advance       */
/* -------------------------------------------- */

/**
 * Apply Damage felled someone: stamp Advance for that turn (on or off the
 * Hoplite's turn). Any attack card counts; a Daring Throw only when the victim
 * stood at most ADVANCE_THROW_RANGE hexes away. The victim's hex is stored
 * now, so the step's line holds even if the body is moved. GM side.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message
 * @param {string[]} felledIds
 * @param {Scene|null} scene
 */
export async function offerHopliteAdvance(
  attacker,
  message,
  felledIds = [],
  scene = null,
) {
  if (!attacker || !message) return;
  if (!hasHopliteNode(attacker, "postup")) return;
  if (!ownsAbility(attacker, isHopliteAdvance)) return;
  const combat = trackedCombat(attacker);
  if (!combat) return;
  if (message.getFlag(SYSTEM_ID, "hopliteAdvanceOffered")) return;

  const selfId = message.speaker?.token ?? null;
  const victimId = felledIds.find((id) => id && id !== selfId);
  if (!victimId) return;
  const victimDoc = scene?.tokens?.get(victimId) ?? null;
  if (!victimDoc) return;
  if (cardIsDaringThrow(message)) {
    const selfDoc =
      (selfId ? scene?.tokens?.get(selfId) : null) ??
      tokenForActor(attacker)?.document ??
      null;
    if (!selfDoc) return;
    if (tokenHexDistance(selfDoc, victimDoc) > ADVANCE_THROW_RANGE) return;
  }
  const victimHex = hexKeyOf(victimDoc);
  if (!victimHex) return;

  await message.setFlag(SYSTEM_ID, "hopliteAdvanceOffered", true);
  await attacker.setFlag(SYSTEM_ID, ADVANCE_FLAG, {
    messageId: message.id,
    victimTokenId: victimId,
    victimHex,
    combat: turnStamp(combat),
  });
}

/** The Advance this actor may still take this turn, or null. */
export function pendingHopliteAdvance(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, ADVANCE_FLAG);
  if (!stored?.victimHex || !stampIsThisTurn(stored.combat, game.combat)) {
    return null;
  }
  return stored;
}

/**
 * Use Advance on the pending kill: pay the item, then a two hex bonus step,
 * mode `advance` (free: no enemy threatens it), whose zone keeps only hexes
 * along the line from where the Hoplite stands through the victim's hex
 * (movementZones.mjs `along`). False with nothing pending.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function useHopliteAdvance(actor, ability) {
  const pending = pendingHopliteAdvance(actor);
  if (!pending) return false;
  const token = tokenForActor(actor);
  const combat = trackedCombat(actor);
  if (!token || !combat) return false;
  const from = hexKeyOf(token.document);
  if (!from) return false;
  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return true;
  await actor.unsetFlag(SYSTEM_ID, ADVANCE_FLAG);

  const granted = await grantBonusStep(actor, {
    mode: "advance",
    budget: ADVANCE_STEP_HEXES,
    startSpent: tokenMovementSpent(token),
    source: `hopliteAdvance.${combat.id}.${pending.messageId}`,
    along: { from, to: pending.victimHex },
  });
  const victim = canvas.tokens?.get(pending.victimTokenId);
  await postLines(actor, ability.localizedName ?? ability.name, [
    game.i18n.format(
      granted ? "REDSTEEL.Hoplite.AdvanceStep" : "REDSTEEL.Hoplite.AdvanceNoStep",
      { name: esc(actor.name), target: esc(victim?.name ?? "") },
    ),
  ]);
  return true;
}

function forcefulSource(combat) {
  return `hopliteForcefulAdvance.${combat.id}.${combat.round}`;
}

/** Is a shield in hand: the active set's off hand, or any shield for an NPC. */
function holdsShield(actor) {
  if (actor.type === "character") {
    const set = actor.system.combat?.activeWeaponSet;
    return !!(set && buildWeaponSetView(actor)?.[set]?.offIsShield);
  }
  return actor.items.some((i) => !!i.system?.shield);
}

/** The shield abilities this actor owns that Forceful Advance makes free. */
function forcefulAbilities(actor) {
  return actor.items.filter(
    (i) =>
      i.type === "ability" &&
      FORCEFUL_ADVANCE_KEYS.includes(i.system?.localizationKey),
  );
}

/**
 * An Advance step has ended (the strip's ✓, or walked out on the actor's own
 * turn). Having moved at least one hex, Rázný postup makes the shield
 * abilities free of their Action for the rest of this turn, once per round.
 *
 * @param {Actor} actor
 * @param {number} walked  hexes the step walked
 */
export async function completeHopliteAdvance(actor, walked) {
  if (!actor?.isOwner || !(Number(walked) >= 1)) return;
  if (!hasHopliteNode(actor, "raznyPostup")) return;
  const combat = trackedCombat(actor);
  if (!combat) return;
  const owned = forcefulAbilities(actor);
  if (!owned.length || !holdsShield(actor)) return;
  if (!(await markBonusSource(actor, forcefulSource(combat)))) return;

  const keys = [...new Set(owned.map((i) => i.system.localizationKey))];
  if (!(await grantFreeAbility(actor, { keys }))) return;
  await postLines(
    actor,
    game.i18n.localize("REDSTEEL.Items.ForcefulAdvance.name"),
    [
      game.i18n.format("REDSTEEL.Hoplite.ForcefulAdvance", {
        name: esc(actor.name),
      }),
    ],
  );
}

/**
 * The shield abilities to chip right now: Forceful Advance's free grant is
 * live this turn, a shield is in hand, and the ability is owned.
 *
 * @param {Actor} actor
 * @returns {Item[]}
 */
export function forcefulAdvanceItems(actor) {
  const free = liveFreeAbility(actor);
  if (!free) return [];
  if (!free.keys.some((k) => FORCEFUL_ADVANCE_KEYS.includes(k))) return [];
  if (!holdsShield(actor)) return [];
  return forcefulAbilities(actor).filter((i) =>
    free.keys.includes(i.system.localizationKey),
  );
}

/* -------------------------------------------- */
/*  Onslaught I and II (Nápor)                  */
/* -------------------------------------------- */

export const ONSLAUGHT_KEYS = Object.freeze({
  1: "REDSTEEL.Items.OnslaughtI.name",
  2: "REDSTEEL.Items.OnslaughtII.name",
});
const ONSLAUGHT_NAMES = Object.freeze({ 1: "Onslaught I", 2: "Onslaught II" });
const ONSLAUGHT_NODES = Object.freeze({ 1: "napor1", 2: "napor2" });
/** "přezbrojit ... za 5 Výdrže", on top of the item's own cost. */
export const ONSLAUGHT_SWAP_STAMINA = 5;
/** What each Onslaught may switch to before the attack. */
const ONSLAUGHT_SWAP_WEAPONS = Object.freeze({
  1: new Set(["spear", "trident"]),
  2: new Set(["shortsword", "hatchet", "mace"]),
});

/** Úder štítem / Zteč štítem, both shield sizes. */
const SHIELD_BLOW_KEYS = new Set(FORCEFUL_ADVANCE_KEYS);
const SHIELD_BLOW_NAMES = new Set([
  "Shield Bash",
  "Shield Bash (small shield)",
  "Shield Charge",
  "Shield Charge (small shield)",
]);
/** Úder štítem only: the blow whose lost contest means no push at all. */
const SHIELD_BASH_KEYS = new Set([
  "REDSTEEL.Items.ShieldBash.name",
  "REDSTEEL.Items.ShieldBashSmallShield.name",
]);
const SHIELD_BASH_NAMES = new Set(["Shield Bash", "Shield Bash (small shield)"]);
/** Podseknutí, plain and Improved, ticked as a modifier on an attack card. */
const TRIP_NAMES = [
  "Trip (Strength)",
  "Trip (Dexterity)",
  "Improved Trip (Strength)",
  "Improved Trip (Dexterity)",
];

/** Is this Onslaught I (1) or II (2)? 0 otherwise. */
export function onslaughtKind(ability) {
  for (const kind of [1, 2]) {
    if (isKeyed(ability, ONSLAUGHT_KEYS[kind], ONSLAUGHT_NAMES[kind])) return kind;
  }
  return 0;
}

function cardIsShieldBlow(message) {
  const flags = message?.flags?.redsteel ?? {};
  return (
    SHIELD_BLOW_KEYS.has(flags.abilityKey) || SHIELD_BLOW_NAMES.has(flags.abilityName)
  );
}

function cardIsShieldBash(message) {
  const flags = message?.flags?.redsteel ?? {};
  return (
    SHIELD_BASH_KEYS.has(flags.abilityKey) || SHIELD_BASH_NAMES.has(flags.abilityName)
  );
}

function cardHasTrip(message) {
  const keys = message?.flags?.redsteel?.modifierKeys;
  return (
    Array.isArray(keys) &&
    keys.some((k) => TRIP_KEYS.includes(k) || TRIP_NAMES.includes(k))
  );
}

function onslaughtFlag(kind) {
  return `hopliteOnslaught${kind}`;
}

function onslaughtSource(kind, combat) {
  return `hopliteOnslaught${kind}.${combat.id}.${combat.round}`;
}

/**
 * Stamp Onslaught I or II on the Hoplite for this turn, if it qualifies:
 * node held, item owned, its own turn, not used this round, and this card
 * has not offered this kind before. GM side.
 */
async function stampOnslaught(attacker, message, kind, targetTokenId) {
  if (!attacker || !message) return;
  if (!hasHopliteNode(attacker, ONSLAUGHT_NODES[kind])) return;
  if (!ownsAbility(attacker, (i) => onslaughtKind(i) === kind)) return;
  const combat = trackedCombat(attacker);
  if (!combat || !isTrackedTurn(attacker)) return;
  const offered = `hopliteOnslaught${kind}Offered`;
  if (message.getFlag(SYSTEM_ID, offered)) return;
  if (getSpent(attacker).bonusSources.includes(onslaughtSource(kind, combat))) return;
  await message.setFlag(SYSTEM_ID, offered, true);
  await attacker.setFlag(SYSTEM_ID, onslaughtFlag(kind), {
    messageId: message.id,
    targetTokenId: targetTokenId ?? null,
    combat: turnStamp(combat),
  });
}

/**
 * A shield blow's push or a Trip settled (applyDamage.mjs after the push,
 * forcedMovement.mjs for Shield Charge's lost-contest push and for an
 * answer). Onslaught I: a shield blow that has moved a target (`moved` counts
 * every stage of a Shield Charge so far), or a shield blow or Trip that left
 * a target newly Prone. Onslaught II: a shield blow that has moved a target
 * nowhere (every push collided, or Rooted). GM side.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message
 * @param {{pushResults?: {tokenId: string, moved: number}[],
 *   knockedDownIds?: string[]}} outcome
 */
export async function offerHopliteOnslaught(
  attacker,
  message,
  { pushResults = [], knockedDownIds = [] } = {},
) {
  if (!attacker || !message) return;
  const shield = cardIsShieldBlow(message);
  const trip = cardHasTrip(message);
  if (!shield && !trip) return;
  const selfId = message.speaker?.token ?? null;

  const pushed = shield ? pushResults.find((r) => r.moved > 0) : null;
  const downed = knockedDownIds.find((id) => id && id !== selfId) ?? null;
  const first = pushed?.tokenId ?? downed;
  if (first) await stampOnslaught(attacker, message, 1, first);

  const stuck = shield ? pushResults.find((r) => !(r.moved > 0)) : null;
  if (stuck) await stampOnslaught(attacker, message, 2, stuck.tokenId);
}

/** How far back a versus answer or Defense looks for its shield blow. */
const ONSLAUGHT_LOOKBACK = 100;

function speakerActor(message) {
  const speaker = message?.speaker ?? {};
  const scene = game.scenes?.get(speaker.scene) ?? null;
  const doc = speaker.token ? scene?.tokens?.get(speaker.token) : null;
  return doc?.actor ?? game.actors?.get(speaker.actor) ?? null;
}

function firstTargetOf(message) {
  const targets = message?.flags?.attack?.targets;
  const first = Array.isArray(targets) ? targets[0] : null;
  if (typeof first === "string") return first;
  return first?.tokenId ?? first?.id ?? null;
}

/**
 * Onslaught II's lost contest: a new chat card is a defender's versus answer
 * that beat a Hoplite's Shield Bash, or a successful Defense against one. A
 * Shield Charge is left to its pushes: its first hex lands whatever the
 * contest, so it "did not push" only when that push collided. Active GM
 * only, one card at a time (registerHopliteHooks).
 *
 * @param {ChatMessage} message
 */
async function noteOnslaughtAnswer(message) {
  const flags = message?.flags?.redsteel ?? {};
  const followup = flags.versusFollowup;
  const defense = flags.defense?.succeeded === true ? flags.defense : null;
  if (!followup && !defense) return;
  if (defense && !SHIELD_BASH_KEYS.has(defense.attackAbilityKey)) return;

  const messages = game.messages?.contents ?? [];
  const index = messages.findIndex((m) => m.id === message.id);
  if (index < 0) return;
  const stop = Math.max(0, index - ONSLAUGHT_LOOKBACK);
  for (let i = index - 1; i >= stop; i--) {
    const card = messages[i];
    if (!cardIsShieldBash(card) || card.flags?.redsteel?.rerolledAway) continue;
    if (defense) {
      if (card.speaker?.token !== defense.attackerTokenId) continue;
      await stampOnslaught(
        speakerActor(card),
        card,
        2,
        defense.defenderTokenId ?? firstTargetOf(card),
      );
      return;
    }
    const outcome = versusOutcome(card);
    if (!outcome) continue;
    // The newest shield blow this answer belongs to. A win for the attacker
    // is Apply Damage's business (the push), not this.
    if (!outcome.attackerWon) {
      // The answer is rolled by the defender, so its speaker is the target.
      await stampOnslaught(
        speakerActor(card),
        card,
        2,
        message.speaker?.token ?? firstTargetOf(card),
      );
    }
    return;
  }
}

/**
 * A versus answer settled a Trip or a pushing card's waiting stages
 * (forcedMovement.mjs resolveVersusAnswer): feed Onslaught what it did.
 */
async function settleVersusAnswer(message) {
  const settled = await resolveVersusAnswer(message);
  if (!settled?.attacker) return;
  await offerHopliteOnslaught(settled.attacker, settled.card, {
    pushResults: settled.pushResults,
    knockedDownIds: settled.knockedDownIds,
  });
}

/**
 * The active GM watches new chat cards, one after another: versus answers
 * that settle a Trip's knockdown or a shield push's waiting stages (for every
 * character), then Onslaught II's lost contests. Registered once from
 * redsteel.mjs.
 */
export function registerHopliteHooks() {
  // Every client: the last move each token made this turn (Příležitostný
  // útok za kolo reads it), and the holder's own move breaks Prepared Stance.
  Hooks.on("moveToken", (tokenDoc, movement, _operation, user) => {
    noteRecentMove(tokenDoc, movement);
    breakPreparedStanceOnMove(tokenDoc, user);
  });
  let queue = Promise.resolve();
  Hooks.on("createChatMessage", (message) => {
    if (!game.users.activeGM?.isSelf) return;
    queue = queue
      .then(() => settleVersusAnswer(message))
      .catch((err) => console.error("Redsteel | Versus push or Trip failed", err))
      .then(() => noteOnslaughtAnswer(message))
      .catch((err) => console.error("Redsteel | Onslaught tracking failed", err));
  });
}

/** The Onslaught (1 or 2) this actor may still take this turn, or null. */
export function pendingHopliteOnslaught(actor, kind) {
  const stored = actor?.getFlag?.(SYSTEM_ID, onslaughtFlag(kind));
  const combat = game.combat;
  if (!stored || !stampIsThisTurn(stored.combat, combat)) return null;
  if (getSpent(actor).bonusSources.includes(onslaughtSource(kind, combat))) return null;
  return stored;
}

/** The weapons this Onslaught may switch to: carried, not already in hand. */
function onslaughtSwapWeapons(actor, kind) {
  if (actor?.type !== "character") return [];
  const set = actor.system.combat?.activeWeaponSet;
  const mainId = set ? actor.system.combat?.weaponSets?.[set]?.main : null;
  return actor.items.filter(
    (i) =>
      i.type === "weapon" &&
      i.id !== mainId &&
      i.system?.thrown !== true &&
      !i.system?.shield &&
      weaponIn(i, ONSLAUGHT_SWAP_WEAPONS[kind]),
  );
}

/**
 * Use Onslaught I or II on the pending chance. The player picks a plain
 * attack, or a switch to one of the carried weapons first (offered only when
 * the Stamina covers both). Pays the item, and 5 more Stamina for a switch,
 * in one deductAbilityCost call, swaps, notes the round's use and makes the
 * next plain Attack free. False with nothing pending, so the plain card posts.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function useHopliteOnslaught(actor, ability) {
  const kind = onslaughtKind(ability);
  const pending = kind ? pendingHopliteOnslaught(actor, kind) : null;
  if (!pending) return false;
  const combat = trackedCombat(actor);
  if (!combat) return false;
  const label = ability.localizedName ?? ability.name;
  const costType = ability.system?.costType || "stamina";
  const base = Number(ability.system?.cost) || 0;
  if (!canSpendResource(actor, costType, base)) {
    ui.notifications.warn(
      game.i18n.format("REDSTEEL.Hoplite.OnslaughtNoStamina", { cost: base }),
    );
    return true;
  }

  const swaps = canSpendResource(actor, costType, base + ONSLAUGHT_SWAP_STAMINA)
    ? onslaughtSwapWeapons(actor, kind)
    : [];
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: label },
    content: `<p>${game.i18n.localize("REDSTEEL.Hoplite.OnslaughtPrompt")}</p>`,
    buttons: [
      {
        action: "attack",
        label: game.i18n.format("REDSTEEL.Hoplite.OnslaughtAttack", { cost: base }),
        default: true,
      },
      ...swaps.map((w) => ({
        action: w.id,
        label: game.i18n.format("REDSTEEL.Hoplite.OnslaughtSwap", {
          weapon: w.localizedName ?? w.name,
          cost: base + ONSLAUGHT_SWAP_STAMINA,
        }),
      })),
    ],
    rejectClose: false,
  });
  if (!picked) return true;
  const weapon = picked === "attack" ? null : swaps.find((w) => w.id === picked);
  if (picked !== "attack" && !weapon) return true;

  // The switch is its own Free action priced in Stamina: a stand-in cost
  // line, so one payment covers both and a shortfall refuses the lot.
  const swapCost = {
    name: "",
    system: {
      costType,
      cost: ONSLAUGHT_SWAP_STAMINA,
      resources: {},
      actionCost: "Free Action",
    },
  };
  const items = weapon ? [ability, swapCost] : [ability];
  if (!(await game.redsteel.deductAbilityCost(actor, items))) return true;
  await actor.unsetFlag(SYSTEM_ID, onslaughtFlag(kind));
  await markBonusSource(actor, onslaughtSource(kind, combat));
  if (weapon) await swapMainWeapon(actor, weapon.id);

  const self = tokenForActor(actor);
  // grantFreeAttack needs some id to hold the grant; nothing reads it back.
  await grantFreeAttack(actor, pending.targetTokenId || self?.id || actor.id);
  const target = canvas.tokens?.get(pending.targetTokenId);
  const names = {
    name: esc(actor.name),
    target: esc(target?.name ?? ""),
    weapon: esc(weapon?.localizedName ?? weapon?.name ?? ""),
  };
  await postLines(actor, label, [
    game.i18n.format(
      weapon ? "REDSTEEL.Hoplite.OnslaughtSwapped" : "REDSTEEL.Hoplite.OnslaughtFreeAttack",
      names,
    ),
  ]);
  return true;
}

/* -------------------------------------------- */
/*  Opportunity Attack side (batch 3)           */
/* -------------------------------------------- */

/** What the polearm OA nodes accept: "kopím/trojzubcem". */
const SPEAR_WEAPONS = new Set(["spear", "trident"]);

/** Is this a spear or trident (tags or English name, no javelin)? */
export function isSpearOrTrident(weapon) {
  return weapon?.type === "weapon" && weaponIn(weapon, SPEAR_WEAPONS);
}

/** The weapon a character's plain Attack swings: the active set's main hand. */
function mainWeapon(actor) {
  return resolveWeaponContext(actor)?.weapon ?? null;
}

/** Canvas centre of a token's STORED position (token-position memory). */
function sourceCenter(doc) {
  const src = doc?._source ?? doc;
  if (!src || !canvas?.grid) return null;
  return {
    x: Number(src.x) + (Number(doc.width ?? src.width ?? 1) * canvas.grid.sizeX) / 2,
    y: Number(src.y) + (Number(doc.height ?? src.height ?? 1) * canvas.grid.sizeY) / 2,
  };
}

/** Centre of a V14 TokenPosition ({x, y, width, height}, top-left based). */
function positionCenter(pos) {
  if (!pos || !canvas?.grid) return null;
  return {
    x: Number(pos.x) + (Number(pos.width ?? 1) * canvas.grid.sizeX) / 2,
    y: Number(pos.y) + (Number(pos.height ?? 1) * canvas.grid.sizeY) / 2,
  };
}

/** Hexes between two canvas points along the grid. */
function pointDistance(a, b) {
  if (!a || !b) return Infinity;
  const path = canvas.grid.getDirectPath([a, b]);
  return Math.max(0, (path?.length ?? 1) - 1);
}

/**
 * The last move each token made during the running combat turn, kept from
 * the V14 `moveToken` hook (TokenMovementData: `origin` and `destination` are
 * TokenPositions). Every client records its own copy, so whoever declares an
 * Opportunity Attack can read it. A forced move is not the token's own
 * movement and is not recorded. Memory only; a reload forgets it.
 */
const recentMoves = new Map();

function noteRecentMove(tokenDoc, movement) {
  const combat = game.combat;
  if (!combat?.started || !tokenDoc?.id) return;
  if (isForcedMove(tokenDoc)) return;
  if (!movement?.origin || !movement?.destination) return;
  recentMoves.set(tokenDoc.id, {
    origin: { ...movement.origin },
    destination: { ...movement.destination },
    combat: turnStamp(combat),
  });
}

/**
 * Did this token's last move this turn close the distance to `toward`: it
 * ended nearer than it started, and within `reach` hexes of it?
 */
function closedDistance(targetDoc, towardDoc, reach) {
  const move = recentMoves.get(targetDoc?.id);
  if (!move || !stampIsThisTurn(move.combat, game.combat)) return false;
  const here = sourceCenter(towardDoc);
  const before = pointDistance(positionCenter(move.origin), here);
  const after = pointDistance(positionCenter(move.destination), here);
  const now = pointDistance(sourceCenter(targetDoc), here);
  return after < before && now <= reach;
}

function freeOpportunitySource(combat) {
  return `hopliteFreeOpportunity.${combat.id}.${combat.round}`;
}

/**
 * Příležitostný útok za kolo (user ruling 2026-10-18): "once per round the
 * pikeman attack of opportunity from enemy closing distance to the pikeman
 * can be done for no cost." A character with the node, off its own turn,
 * swinging a Long Reach polearm from the active set, at targets that each
 * closed the distance this turn and stand within reach: the Opportunity
 * Attack spends no Reaction. Claims the round's use and posts a line. Called
 * by attackActions.mjs where the plain Attack pays (spendForAttack).
 *
 * @param {Actor} actor
 * @param {Token|null} token
 * @returns {Promise<boolean>} true when the Reaction is waived
 */
export async function claimHopliteFreeOpportunity(actor, token = null) {
  if (actor?.type !== "character") return false;
  if (!hasHopliteNode(actor, "prilezitostnyUtok")) return false;
  const combat = trackedCombat(actor);
  if (!combat || isTrackedTurn(actor)) return false;
  if (getSpent(actor).bonusSources.includes(freeOpportunitySource(combat))) return false;
  const weapon = mainWeapon(actor);
  if (!weapon?.system?.longReach || weapon.system?.class !== "polearm") return false;
  const self = token ?? tokenForActor(actor);
  if (!self?.document) return false;
  const targets = [...(game.user?.targets ?? [])].filter((t) => t !== self);
  if (!targets.length) return false;
  const reach = weaponReach(actor, weapon);
  if (!targets.every((t) => closedDistance(t.document, self.document, reach))) {
    return false;
  }
  if (!(await markBonusSource(actor, freeOpportunitySource(combat)))) return false;
  await postLines(
    actor,
    game.i18n.localize("REDSTEEL.Actor.Specialisations.hoplite.nodes.prilezitostnyUtok.label"),
    [
      game.i18n.format("REDSTEEL.Hoplite.FreeOpportunity", {
        name: esc(actor.name),
        target: esc(targets.map((t) => t.name).join(", ")),
      }),
    ],
  );
  return true;
}

/* ---- Přípravný postoj (Prepared Stance) ---- */

export const PREPARED_STANCE_KEY = "REDSTEEL.Items.PreparedStance.name";
export const PREPARED_STANCE_STATUS = "prepared_stance";
/** "Příští Příležitostný útok kopím/trojzubcem získává +20% na Zásah." */
export const PREPARED_STANCE_HIT = 20;

/** Is this the Prepared Stance ability? */
export function isPreparedStance(ability) {
  return isKeyed(ability, PREPARED_STANCE_KEY, "Prepared Stance");
}

async function dropPreparedStance(actor) {
  const effects = actor?.effects?.filter((e) => e.statuses?.has(PREPARED_STANCE_STATUS)) ?? [];
  if (!effects.length || !actor.isOwner) return;
  await actor.deleteEmbeddedDocuments(
    "ActiveEffect",
    effects.map((e) => e.id),
  );
}

/**
 * A weapon attack is being rolled (combatSkillBonuses.mjs getAttackRolls).
 * Under Prepared Stance, an Opportunity Attack with a spear or trident takes
 * +20 Hit and spends the stance; any other attack breaks it. Returns the
 * bonus (0 when none).
 *
 * @param {Actor} actor
 * @param {Item|null} weapon
 * @param {boolean} opportunity
 * @returns {Promise<number>}
 */
export async function settlePreparedStance(actor, weapon, opportunity) {
  if (!actor?.statuses?.has(PREPARED_STANCE_STATUS)) return 0;
  const bonus = opportunity && isSpearOrTrident(weapon) ? PREPARED_STANCE_HIT : 0;
  await dropPreparedStance(actor);
  return bonus;
}

/** "Pohyb ... postoj přeruší": the holder's own move ends it. */
function breakPreparedStanceOnMove(tokenDoc, user) {
  if (user?.id !== game.user.id) return;
  if (isForcedMove(tokenDoc)) return;
  const actor = tokenDoc?.actor;
  if (!actor?.statuses?.has(PREPARED_STANCE_STATUS)) return;
  dropPreparedStance(actor).catch((err) =>
    console.error("Redsteel | Prepared Stance break failed", err),
  );
}

/* ---- Obrana proti zteči (Charge Defense) ---- */

export const CHARGE_DEFENSE_KEY = "REDSTEEL.Items.ChargeDefense.name";
const IMPALE_KEY = "REDSTEEL.Items.Impale.name";
/** "udržuje mezeru 1 hexa": the charger ends two hexes off. */
const CHARGE_DEFENSE_GAP = 2;

/** Is this the Charge Defense modifier? */
export function isChargeDefense(mod) {
  return isKeyed(mod, CHARGE_DEFENSE_KEY, "Charge Defense");
}

function isImpale(mod) {
  return isKeyed(mod, IMPALE_KEY, "Impale");
}

/** Is this actor charging or sprinting right now (its movement lock)? */
function isChargingOrSprinting(actor) {
  if (!actor) return false;
  if (actor.statuses?.has("sprint")) return true;
  const mode = getMovementLock(actor)?.mode;
  return mode === "charge" || mode === "sprint";
}

/**
 * Charge Defense is legal only on an Opportunity Attack with a spear or
 * trident, at targets who are all charging or sprinting. Otherwise it is
 * dropped from the attack with a notice, the way the multi-attack picker
 * drops modifiers it cannot carry. Other modifiers are returned untouched.
 *
 * @param {Actor} actor
 * @param {Item[]} modifiers
 * @param {{opportunity: boolean, weapon?: Item|null}} context
 * @returns {Item[]}
 */
export function filterChargeDefense(actor, modifiers = [], { opportunity = false, weapon } = {}) {
  if (!modifiers.some((m) => isChargeDefense(m))) return modifiers;
  const swung =
    weapon === undefined
      ? (actor?.type === "character"
          ? mainWeapon(actor)
          : (actor?.items?.find((i) => isSpearOrTrident(i)) ?? null))
      : weapon;
  const targets = [...(game.user?.targets ?? [])];
  let reason = null;
  if (!opportunity) reason = "REDSTEEL.Hoplite.ChargeDefenseNotOpportunity";
  else if (!isSpearOrTrident(swung)) reason = "REDSTEEL.Hoplite.ChargeDefenseNoSpear";
  else if (!targets.length || !targets.every((t) => isChargingOrSprinting(t.actor))) {
    reason = "REDSTEEL.Hoplite.ChargeDefenseNotCharging";
  }
  if (!reason) return modifiers;
  ui.notifications.warn(game.i18n.localize(reason));
  return modifiers.filter((m) => !isChargeDefense(m));
}

/**
 * "Tento útok může být zdarma modifikován akcí Nabodnutí": the cost list a
 * modifier set pays. With Charge Defense ticked, Impale's Stamina is waived
 * (a zero-cost stand-in keeps its action line and key). The attack itself
 * still uses the real modifiers.
 *
 * @param {Item[]} modifiers
 * @returns {object[]}
 */
export function hopliteModifierCosts(modifiers = []) {
  if (!modifiers.some((m) => isChargeDefense(m))) return modifiers;
  return modifiers.map((m) =>
    isImpale(m)
      ? {
          name: m.name,
          system: {
            costType: m.system?.costType,
            cost: 0,
            resources: {},
            actionCost: m.system?.actionCost,
            localizationKey: m.system?.localizationKey,
          },
        }
      : m,
  );
}

/**
 * Apply Damage landed a Charge Defense Opportunity Attack: "Při zásahu
 * zastaví Zteč a udržuje mezeru 1 hexa" (user ruling: full stop). For each
 * target that is charging or sprinting: its movement lock ends, the Charge's
 * swing will not fire (actionTracker.mjs stopMovementLock), and a charger
 * standing nearer than two hexes is pushed straight back from the Hoplite
 * until two hexes stand between their centres (no collision damage; a
 * blocked or Rooted charger stays). Once per card. GM side.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message
 * @param {string[]} targetIds
 * @param {Scene|null} scene
 */
export async function settleChargeDefense(attacker, message, targetIds = [], scene = null) {
  if (!attacker || !message || !scene) return;
  const keys = message.flags?.redsteel?.modifierKeys;
  if (!Array.isArray(keys) || !keys.some((k) => k === CHARGE_DEFENSE_KEY || k === "Charge Defense")) {
    return;
  }
  if (message.getFlag(SYSTEM_ID, "chargeDefenseSettled")) return;
  await message.setFlag(SYSTEM_ID, "chargeDefenseSettled", true);
  const selfDoc =
    scene.tokens.get(message.speaker?.token ?? "") ?? tokenForActor(attacker)?.document ?? null;
  if (!selfDoc) return;
  const label = game.i18n.localize(CHARGE_DEFENSE_KEY);

  for (const id of targetIds) {
    const doc = scene.tokens.get(id);
    const charger = doc?.actor;
    if (!doc || doc.id === selfDoc.id || !isChargingOrSprinting(charger)) continue;
    await stopMovementLock(charger);
    const gap = pointDistance(sourceCenter(selfDoc), sourceCenter(doc));
    if (gap < CHARGE_DEFENSE_GAP && !charger.statuses?.has("dead")) {
      await pushToken(doc, selfDoc, {
        distance: CHARGE_DEFENSE_GAP - gap,
        collide: false,
        label,
        sourceActor: attacker,
      });
    }
    await postLines(attacker, label, [
      game.i18n.format("REDSTEEL.Hoplite.ChargeStopped", {
        name: esc(attacker.name),
        target: esc(doc.name),
      }),
    ]);
  }
}

/** A charge Charge Defense stopped: its swing may not be made this round. */
export function chargeWasStopped(actor) {
  return getMovementLock(actor)?.stopped === true;
}
