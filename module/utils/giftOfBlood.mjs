/**
 * Dar krve (Gift of Blood) — School of Blood, Master-tier node.
 *
 * "Zabije-li živý cíl kouzlem Školy Krve, vyléčí si SK*1 Životů." Killing a
 * living target with a School of Blood spell heals the caster for their Blood
 * Spell Power.
 *
 * "Killed" is the drop to 0 Life — the same line every other kill trigger in
 * the system reads (Blood Strike, Blood Harvest): an NPC dies, a character
 * starts Dying. The target must have been above 0 before the damage landed, so
 * finishing off a corpse pays nothing.
 *
 * Three damage routes can carry a Blood spell's kill, and all three are wired:
 *
 *  1. The spell card's own Apply Damage (utils/applyDamage.mjs). The card
 *     carries `flags.redsteel.spellSchool` and `casterUuid`, which is all the
 *     attribution needed.
 *  2. A damage-over-time effect the spell applied — Poisoned Blood, Skin
 *     Cracking, Demonic Grasp, Blight Bomb, or a GM condition with a damage
 *     trigger. The effect is stamped at apply time with the caster who made it,
 *     and every later tick pays that caster.
 *  3. Bleeding, but only a Bleed the spell itself created or fed. A Bleed from
 *     a sword carries no stamp and pays nothing, which is the rule as written.
 *     A Blood spell that adds stacks to an existing Bleed takes the stamp over:
 *     from then on that caster owns the wound.
 *
 * Routes 2 and 3 are the same code. The stamp is written by
 * documents/effects.mjs for any effect applied with `school === "blood"`, and
 * read back here off the effect that lands the killing tick.
 *
 * Each kill pays separately, so an area Blood spell that drops three targets
 * heals three times SK.
 */

import { getSpellPower } from "./spellPower.mjs";
import { postRoundEntry } from "./roundDigest.mjs";

/**
 * Effect flag holding the uuid of the Blood caster whose spell created (or
 * last fed) this effect. Also read by the DoT and Bleeding ticks.
 */
export const BLOOD_SOURCE_FLAG = "bloodSpellCaster";

/** Localization key of the node label, used to name the chat line. */
const NODE_LABEL = "REDSTEEL.Actor.Specialisations.bloodSchool.nodes.darKrve.label";

/**
 * The NPC trait that marks a creature as not alive. Names are English
 * everywhere in this system (the Czech comes from `localizationKey`), so the
 * trait item's own name is a safe key.
 */
const UNLIVING_TRAIT = "Unliving";

/** True when the actor owns the Gift of Blood node. */
export function hasGiftOfBlood(actor) {
  const spec = actor?.system?.specialisations?.bloodSchool;
  return !!spec?.active && !!spec?.nodes?.darKrve;
}

/**
 * Is this target alive for the purposes of the node?
 *
 * The only "not alive" marker the system has is the Unliving NPC trait
 * (undead, constructs — anything the GM tags with it). Read as a capability
 * flag first, so a future `system.unliving = true` Active Effect change on the
 * trait just works, then by the trait item's name, which is what every actor
 * carrying the trait today actually has.
 *
 * @param {Actor|null} actor
 * @returns {boolean}
 */
export function isLivingTarget(actor) {
  if (!actor) return false;
  if (actor.system?.unliving) return false;
  return !actor.items.contents.some(
    (item) => item.type === "feature" && item.name === UNLIVING_TRAIT,
  );
}

/** Life healed per kill: Blood Spell Power ×1. */
export function giftOfBloodHeal(caster) {
  return getSpellPower(caster, "blood");
}

/**
 * Did this instance of damage kill the target outright?
 *
 * @param {Actor} victim
 * @param {number} hpBefore Life before the damage landed.
 * @returns {boolean}
 */
export function damageKilled(victim, hpBefore) {
  if (!victim) return false;
  if (!(Number(hpBefore) > 0)) return false;
  return Number(victim.system?.stats?.health?.value ?? 0) <= 0;
}

/**
 * Whether a kill by `caster` on `victim` earns the Gift. Split from the payment
 * so the Apply Damage loop can collect several victims off one area spell and
 * settle them in a single write.
 *
 * @param {Actor|null} caster
 * @param {Actor|null} victim
 * @returns {boolean}
 */
export function giftOfBloodApplies(caster, victim) {
  if (!caster || !victim) return false;
  if (caster === victim) return false;
  if (!hasGiftOfBlood(caster)) return false;
  return isLivingTarget(victim);
}

/**
 * Resolve the Blood caster stamped on an effect, but only when they still own
 * the node. Returns null for every effect that did not come from a Blood spell.
 *
 * @param {ActiveEffect|null} effect
 * @returns {Actor|null}
 */
export function giftCasterFromEffect(effect) {
  const uuid = effect?.getFlag?.("redsteel", BLOOD_SOURCE_FLAG);
  if (!uuid) return null;
  const caster = fromUuidSync(uuid);
  if (!(caster instanceof Actor)) return null;
  return hasGiftOfBlood(caster) ? caster : null;
}

/**
 * Heal the caster for one Spell Power per kill and announce it.
 *
 * Clamped to the caster's Life maximum, so a caster already at full simply
 * gains nothing and says nothing — the same shape as `gainBlood`. Healing a
 * Dying caster back above 0 ends Dying by itself (see `_syncDyingOnHeal`).
 *
 * The line goes through `postRoundEntry` rather than `ChatMessage.create`, so a
 * kill landed by a round-start DoT tick joins that round's digest card instead
 * of racing it.
 *
 * @param {Actor} caster
 * @param {string[]} victimNames Names of the targets killed, for the chat line.
 * @returns {Promise<number>} Life actually restored.
 */
export async function payGiftOfBlood(caster, victimNames = []) {
  const kills = victimNames.length;
  if (!caster || kills <= 0) return 0;

  const perKill = giftOfBloodHeal(caster);
  if (perKill <= 0) return 0;

  const health = caster.system?.stats?.health ?? {};
  const current = Number(health.value) || 0;
  const max = Number(health.max);
  const next = Number.isFinite(max)
    ? Math.min(max, current + perKill * kills)
    : current + perKill * kills;
  const healed = next - current;
  if (healed <= 0) return 0;

  await caster.update({ "system.stats.health.value": next });

  const line = game.i18n.format("REDSTEEL.GiftOfBlood.Healed", {
    name: caster.name,
    targets: victimNames.join(", "),
    amount: healed,
  });

  await postRoundEntry(caster, {
    kind: "note",
    label: game.i18n.localize(NODE_LABEL),
    note: line,
    flavor: line,
    content: `<div style="text-align:center; color:#a01818;">${line}</div>`,
  });

  return healed;
}

/**
 * The whole rule for one effect tick: if this effect came from a Blood spell
 * whose caster owns the node, and the tick just killed a living target, pay.
 *
 * Called from documents/effects.mjs at each of its damage-writing handlers,
 * right after the zero-health state is settled.
 *
 * @param {ActiveEffect} effect  The effect that dealt the tick.
 * @param {number} hpBefore      The victim's Life before the tick.
 * @returns {Promise<number>} Life restored to the caster.
 */
export async function creditGiftOfBloodFromEffect(effect, hpBefore) {
  const victim = effect?.parent;
  if (!(victim instanceof Actor)) return 0;
  if (!damageKilled(victim, hpBefore)) return 0;

  const caster = giftCasterFromEffect(effect);
  if (!giftOfBloodApplies(caster, victim)) return 0;

  return payGiftOfBlood(caster, [victim.name]);
}
