/**
 * Strážce (Warden), batch 2: the shield reads. Kept import-light (only the
 * node check and the strain status) because the roll layer reads them from
 * low-level files: testRating.mjs, documents/item.mjs consumers,
 * applyDamage.mjs and defense.mjs. Everything that spends actions, opens
 * dialogs or writes documents lives in warden.mjs.
 *
 * Rulebook: specializace-wip.md r653-r675.
 *
 * - Bonus za štít (bonusZaStit): "Získává bonus za držený štít. Malý štít -
 *   Úder štítem levnější o 3 Výdrže, Kritická obrana +1%, Odklonění +15%;
 *   Střední štít - Úder štítem má o 10% větší šanci na Omráčení, Odklonění
 *   +10%; Velký štít - Bonus do soubojových Testů Síly +10%, Odklonění +10%".
 *   Read off the shield in hand (shieldSize), never while it is strained
 *   ("Zatížený štít ztrácí veškeré bonusy").
 * - Spolehlivý štít I (spolehlivyStit1): "Obětování Života zbroje/štítu
 *   snižuje zranění o dalších 5" (applyDamage.mjs per-point value).
 * - Spolehlivý štít II (spolehlivyStit2): "Držené štíty mají o jeden život
 *   zbroje více" (wardenShieldDurabilityMax, read where the max is read).
 *
 * Shield size (user data, 2026-10-19 pack): the system has no size field. The
 * four pack shields map by localisation key, then by English name:
 *   Small shield (Malý štít)          → small
 *   Heater shield ("Heather shield")  → medium (Střední štít)
 *   Tower shield (Velký štít)         → large
 *   Improvised shield                 → none
 * A shield with neither a known key nor a known name has no size, so
 * bonusZaStit gives it nothing.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { isShieldStrained } from "./shieldStrain.mjs";

const SPEC = "warden";

const SIZE_BY_KEY = Object.freeze({
  "REDSTEEL.Items.SmallShield.name": "small",
  "REDSTEEL.Items.HeaterShield.name": "medium",
  "REDSTEEL.Items.TowerShield.name": "large",
});
const SIZE_BY_NAME = Object.freeze({
  "small shield": "small",
  "heather shield": "medium",
  "heater shield": "medium",
  "tower shield": "large",
});

/** Bonus za štít, per size. */
export const SHIELD_BONUS = Object.freeze({
  small: { bashDiscount: 3, critDefense: 1, deflect: 15, bashStagger: 0, strength: 0 },
  medium: { bashDiscount: 0, critDefense: 0, deflect: 10, bashStagger: 10, strength: 0 },
  large: { bashDiscount: 0, critDefense: 0, deflect: 10, bashStagger: 0, strength: 10 },
});

/** Spolehlivý štít I: damage removed per sacrificed point, on top. */
export const RELIABLE_SHIELD_SACRIFICE_BONUS = 5;

/** Has this actor unlocked the Warden node? */
export function hasWardenNode(actor, node) {
  return !!actor && actorHasSpecNode(actor, SPEC, node);
}

/**
 * The shield in hand: a character's active weapon set off hand, an NPC's
 * first equipped shield. The same two places documents/actor.mjs reads a
 * shield's bonuses from.
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function heldShield(actor) {
  if (!actor?.items) return null;
  if (actor.type === "character") {
    const combat = actor.system?.combat;
    const setId = combat?.activeWeaponSet;
    const offId = setId ? combat?.weaponSets?.[setId]?.off : null;
    const off = offId ? actor.items.get(offId) : null;
    return off?.system?.shield ? off : null;
  }
  return (
    actor.items.find(
      (i) =>
        i.type === "gear" && i.system?.shield === true && i.system?.equipped,
    ) ?? null
  );
}

/**
 * Small, medium or large, or null when the shield is not one of the known
 * pack shields.
 *
 * @param {Item|null} item
 * @returns {"small"|"medium"|"large"|null}
 */
export function shieldSize(item) {
  if (!item?.system?.shield) return null;
  const byKey = SIZE_BY_KEY[item.system.localizationKey];
  if (byKey) return byKey;
  return SIZE_BY_NAME[String(item.name ?? "").trim().toLowerCase()] ?? null;
}

/**
 * Bonus za štít for the shield in hand right now, or null: no node, no
 * shield, an unknown size, or a strained shield.
 *
 * @param {Actor} actor
 * @returns {{size: string, bashDiscount: number, critDefense: number,
 *   deflect: number, bashStagger: number, strength: number}|null}
 */
export function wardenShieldBonus(actor) {
  if (!hasWardenNode(actor, "bonusZaStit")) return null;
  if (isShieldStrained(actor)) return null;
  const size = shieldSize(heldShield(actor));
  return size ? { size, ...SHIELD_BONUS[size] } : null;
}

/** Bonus za štít, Deflect on Defense and Cover. 0 when none applies. */
export function wardenShieldDeflect(actor) {
  return wardenShieldBonus(actor)?.deflect ?? 0;
}

/** Bonus za štít, small: Critical Defense +1 (melee Defense). */
export function wardenShieldCritDefense(actor) {
  return wardenShieldBonus(actor)?.critDefense ?? 0;
}

/**
 * Bonus za štít, large: "Bonus do soubojových Testů Síly +10%". Every
 * Strength versus Test, called or answered (testRating.mjs versusTestBonus),
 * and the Strength test of a non-weapon ability card (combatSkillBonuses.mjs
 * getNonWeaponAbility).
 *
 * @param {Actor} actor
 * @param {string} key  attribute key ("str", "dex", ...)
 */
export function wardenStrengthTestBonus(actor, key) {
  if (key !== "str") return 0;
  return wardenShieldBonus(actor)?.strength ?? 0;
}

/** Spolehlivý štít I: extra damage removed per sacrificed durability point. */
export function wardenSacrificeBonus(actor) {
  return hasWardenNode(actor, "spolehlivyStit1")
    ? RELIABLE_SHIELD_SACRIFICE_BONUS
    : 0;
}

/**
 * Spolehlivý štít II: a shield the Warden owns has one more point of
 * durability. Read wherever durabilityMax is read for display or clamping,
 * never written: the item sheet binds the stored field, so a derived value
 * written back on submit would grow by one each time. A shield that tracks
 * no durability (max 0, the improvised shield) stays at 0.
 *
 * @param {Item|null} item
 * @returns {number}
 */
export function wardenShieldDurabilityMax(item) {
  const max = Number(item?.system?.armor?.durabilityMax ?? 0) || 0;
  if (max <= 0 || item?.type !== "gear" || !item.system?.shield) return max;
  return hasWardenNode(item.actor ?? item.parent, "spolehlivyStit2")
    ? max + 1
    : max;
}
