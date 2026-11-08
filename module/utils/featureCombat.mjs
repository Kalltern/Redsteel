/**
 * Combat Odbornosti (features) that act at roll time.
 *
 * Source: "Pravidla pro ToS V12.1 (WIP)", sheet Odbornosti. The feature items
 * in src/packs carry a capability flag through a transferring Active Effect
 * (system.limbBreaker and friends, see [feature-flag-active-effects]); this
 * file answers "does it fire on this swing" and the roll paths ask.
 *
 * A swing is rolled in three steps that never interleave for one actor:
 * getAttackRolls, getDamageRolls and getCriticalRolls, then getEffectRolls. The
 * aimed part and the margin only exist after the first step, so getAttackRolls
 * notes them here and the later steps read the note, instead of threading two
 * more arguments through every caller. A WeakMap, so it never reaches the
 * document and a stale note can only ever be overwritten by the next swing.
 *
 * Rulings (2026-10-31, the book does not say):
 * - "Hit to the arms, legs or head" (Bijec končetin, Práče) means a landed
 *   Aimed Attack. Nothing else in the system names a location.
 * - Řezník's "Light weapon" is a melee weapon: a hunting bow is Light too and
 *   has no business bleeding like a cleaver.
 * - Šermířská dýka I's Deflect covers Defense and Dodge, the two defenses that
 *   roll Deflect at all.
 */

import { weaponHasTag } from "./weaponResolver.mjs";
import { getTopArmorWeight } from "./weaponMaster.mjs";

/** @type {WeakMap<Actor, {part: string|null, margin: number, critSuccess: boolean}>} */
const SWINGS = new WeakMap();

/** Record the swing getAttackRolls just rolled. */
export function noteSwing(actor, swing) {
  if (actor) SWINGS.set(actor, swing);
}

/** The swing being resolved, or null. */
export function currentSwing(actor) {
  return (actor && SWINGS.get(actor)) ?? null;
}

/** The aimed part this swing actually hit, or null (SU < 0 lands in the torso). */
function landedPart(actor) {
  const swing = currentSwing(actor);
  return swing?.part && swing.margin >= 0 ? swing.part : null;
}

function isShootingClass(ws) {
  return ws?.class === "bow" || ws?.class === "crossbow" || ws?.class === "firearm";
}

/** A blow struck by hand: not a shot and not a throw. */
function isHandStrike(ws) {
  return !isShootingClass(ws) && !ws?.thrown;
}

export function isSling(weapon) {
  return weaponHasTag(weapon, "sling");
}

function offHandOf(actor) {
  const combat = actor?.system?.combat;
  const set = combat?.weaponSets?.[combat?.activeWeaponSet];
  return set?.off ? actor.items.get(set.off) ?? null : null;
}

/* ---- Attack ------------------------------------------------------------ */

/** Práče II: the head penalty on a Sling attack eases by 10%. */
export const SLINGER_HEAD_EASE = 10;

export function slingerHeadEase(actor, weapon, part) {
  return part === "head" && Number(actor?.system?.slinger) >= 2 && isSling(weapon)
    ? SLINGER_HEAD_EASE
    : 0;
}

/** Lovec pikenýrů: the three weapons it names. */
const PIKEMAN_HUNTER_TAGS = ["shortsword", "hatchet", "dagger"];
export const PIKEMAN_HUNTER_HIT = 10;

/** Does this attacker strike with a Lovec pikenýrů weapon at all? */
export function isPikemanHunterWeapon(actor, weapon) {
  return (
    !!actor?.system?.pikemanHunter &&
    PIKEMAN_HUNTER_TAGS.some((tag) => weaponHasTag(weapon, tag))
  );
}

/** Is this actor fighting with a Long Reach weapon in hand? */
export function wieldsLongReach(actor) {
  const items = actor?.items?.contents ?? [];
  if (actor?.type !== "character") {
    return items.some((i) => i.type === "weapon" && i.system?.longReach);
  }
  const combat = actor.system?.combat;
  const set = combat?.weaponSets?.[combat?.activeWeaponSet];
  const main = set?.main ? actor.items.get(set.main) : null;
  return !!main?.system?.longReach;
}

/** The Hit bonus against the current targets: every one must qualify. */
export function pikemanHunterHit(actor, weapon) {
  if (!isPikemanHunterWeapon(actor, weapon)) return 0;
  const targets = [...(game.user?.targets ?? [])];
  if (!targets.length) return 0;
  return targets.every((t) => wieldsLongReach(t.actor)) ? PIKEMAN_HUNTER_HIT : 0;
}

/** Sekerník: Cleave +5% Hit with a heavy axe. */
export function axemanCleaveHit(actor, weapon, ability) {
  if (!actor?.system?.axeman) return 0;
  const key = ability?.system?.localizationKey;
  const cleave = key === "REDSTEEL.Items.Cleave.name" || ability?.name === "Cleave";
  const ws = weapon?.system ?? {};
  return cleave && ws.class === "axe" && ws.type === "heavy" ? 5 : 0;
}

/** Odbornost Estoc II: Agile Counter strikes for full damage. */
export function agileCounterFullDamage(actor, ability) {
  return (
    ability?.system?.localizationKey === "REDSTEEL.Items.AgileCounter.name" &&
    actor?.items?.some((i) => i.type === "feature" && i.name === "Estoc II")
  );
}

export const MAULING_KEY = "REDSTEEL.Items.Mauling.name";

/** Why Mauling may not ride this attack, or null (the Finishing Blow gate). */
export function maulingRefusal(modifiers = [], targets = []) {
  if (!modifiers.some((m) => m?.system?.localizationKey === MAULING_KEY)) return null;
  const prone = targets.length > 0 && targets.every((t) => t?.actor?.statuses?.has("prone"));
  return prone ? null : game.i18n.localize("REDSTEEL.FeatureAction.MaulingProne");
}

/**
 * Zbloudilá rána: a fumbled flail attack still lands, for half damage, on the
 * target on an odd die and on the attacker on an even one. The GM applies it;
 * a tag on the card says where it went, and the caller halves the packet.
 * @returns {{tag: string}|null}
 */
export function strayBlow(actor, weapon, attackRoll, critFailure) {
  if (!critFailure || !actor?.system?.strayBlow || !weaponHasTag(weapon, "flail")) return null;
  const die = attackRoll.dice.find((d) => d.faces === 100)?.total ?? 0;
  const key = die % 2 ? "strayTarget" : "straySelf";
  return { tag: key };
}

/** Zbloudilá rána: no Riposte against this flail. */
export function noRiposteWeapon(actor, weapon) {
  return !!actor?.system?.strayBlow && weaponHasTag(weapon, "flail");
}

/** Zbojník I: Duelist or Shieldbearer ranks count as Crossbowman ranks. */
export function brigandArbalestRank(actor) {
  if (!(Number(actor?.system?.brigand) >= 1)) return 0;
  const doctrines = actor.system?.doctrines ?? {};
  return Math.max(
    Number(doctrines.duelist?.value) || 0,
    Number(doctrines.shieldbearer?.value) || 0,
  );
}

/** Panoš: a Broadsword held with a shield, an empty hand or a second weapon. */
export const SQUIRE_CRITICAL_GAP = 50;

export function squireCriticalGap(actor, weapon) {
  if (!actor?.system?.squire || !weaponHasTag(weapon, "broadsword")) return null;
  return weapon?.system?.gripMode === "two" ? null : SQUIRE_CRITICAL_GAP;
}

/**
 * Rychlá adaptace: +5% (II: +10%) per attack an enemy defended or dodged, at
 * most +20%, gone after a hit. Counted off this fight's cards rather than kept
 * in a flag: the defender's client is the one that learns the blow was stopped,
 * and it usually cannot write to the attacker. A hit with no defense card at
 * all resets it through `damageApplied` on the attack card.
 */
export const RAPID_ADAPTATION_CAP = 20;

function hasFeatureNamed(actor, name) {
  return actor.items.some((i) => i.type === "feature" && i.name === name);
}

export function rapidAdaptationHit(actor) {
  if (!actor) return 0;
  const step = hasFeatureNamed(actor, "Rapid adaptation II")
    ? 10
    : hasFeatureNamed(actor, "Rapid adaptation I")
      ? 5
      : 0;
  if (!step) return 0;
  const combat = game.combat;
  if (!combat?.started) return 0;
  const since = Number(combat._stats?.createdTime) || 0;
  const isMine = (message) =>
    message?.speaker?.actor === actor.id ||
    (actor.isToken && message?.speaker?.token === actor.token?.id);

  let stacks = 0;
  const messages = game.messages?.contents ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.timestamp < since) break;
    const flags = message.flags?.redsteel;
    if (!flags || flags.rerolledAway) continue;
    if (flags.damageApplied && isMine(message)) break;
    if (!flags.versus || !flags.versusAttack?.messageId) continue;
    if (!isMine(game.messages.get(flags.versusAttack.messageId))) continue;
    if (!flags.versus.blocked) break;
    stacks += 1;
  }
  return Math.min(RAPID_ADAPTATION_CAP, stacks * step);
}

/* ---- Damage ------------------------------------------------------------ */

/** Extra dice this swing earns from where it landed, as formula terms. */
export function locationDamageTerms(actor, weapon) {
  const part = landedPart(actor);
  if (!part) return [];
  const terms = [];
  if (actor.system?.limbBreaker) terms.push("2d4");
  if (part === "head" && Number(actor.system?.slinger) >= 1 && isSling(weapon)) {
    terms.push("4d4");
  }
  return terms;
}

/** Kovářova rána's Penetration +1, by hand only. */
export function smithsBlowPenetration(actor, weapon) {
  return actor?.system?.smithsBlow && isHandStrike(weapon?.system) ? 1 : 0;
}

/** Smrtící výpad II: Light and Medium piercing weapons, Crit Damage/Pen +5. */
export function deadlyLungeTwoBonus(actor, ws, damageTypes) {
  if (!actor?.system?.deadlyLunge2 || !isHandStrike(ws)) return 0;
  if (ws.type !== "light" && ws.type !== "medium") return 0;
  return damageTypes.includes("piercing") ? 5 : 0;
}

/* ---- Effects ----------------------------------------------------------- */

/** Řezník: +100% Bleed on a Critical Hit with a cleaver or a Light weapon. */
export function butcherBleed(actor, weapon, critSuccess) {
  if (!critSuccess || !actor?.system?.butcher) return 0;
  const ws = weapon?.system ?? {};
  if (!isHandStrike(ws)) return 0;
  const cleaver = weaponHasTag(weapon, "military cleaver") || weaponHasTag(weapon, "two handed cleaver");
  return cleaver || ws.type === "light" ? 100 : 0;
}

/** Stagger chance a Sling adds through Práče I and II, on top of the weapon's. */
export function slingerStagger(actor, weapon) {
  const rank = Number(actor?.system?.slinger) || 0;
  if (!rank || !isSling(weapon)) return 0;
  return (rank >= 2 ? 10 : 0) + (rank >= 1 && landedPart(actor) === "head" ? 20 : 0);
}

/** Kovářova rána: Advantage on the Stagger chance of a head hit, by hand only. */
export function smithsBlowStaggerAdvantage(actor, weapon) {
  return (
    !!actor?.system?.smithsBlow &&
    isHandStrike(weapon?.system) &&
    landedPart(actor) === "head"
  );
}

/* ---- Defense ----------------------------------------------------------- */

export function hasFencingDagger(actor) {
  return !!offHandOf(actor) && weaponHasTag(offHandOf(actor), "fencing dagger");
}

/** Šermířská dýka I: Deflect +10% with the dagger in the off hand. */
export function fencingDaggerDeflect(actor) {
  return Number(actor?.system?.fencingDagger) >= 1 && hasFencingDagger(actor) ? 10 : 0;
}

/** Akrobatická obrana II: Dodge Deflect +20% under a Light top layer. */
export function acrobaticDeflect(actor) {
  return actor?.system?.acrobaticDeflect && getTopArmorWeight(actor) === "light" ? 20 : 0;
}

/** Temporary Health a Critical Defense earns from Šermířská dýka I. */
export const FENCING_DAGGER_TEMP_HEALTH = 5;

/** Šermířská dýka II: retaliation actions, Hit +10%. */
const RETALIATION_KEYS = new Set([
  "REDSTEEL.Items.Counterattack.name",
  "REDSTEEL.Items.RetaliatoryStrike.name",
  "REDSTEEL.Items.ImprovedRetaliatoryStrike.name",
  "REDSTEEL.Items.AgileCounter.name",
]);

export function fencingDaggerRetaliationHit(actor, ability) {
  if (Number(actor?.system?.fencingDagger) < 2 || !hasFencingDagger(actor)) return 0;
  return RETALIATION_KEYS.has(ability?.system?.localizationKey) ? 10 : 0;
}
