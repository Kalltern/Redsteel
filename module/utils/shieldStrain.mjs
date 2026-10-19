/**
 * Zatížení štítu (Shield Strain). Rulebook, zbrojnice.md r265 (Speciální
 * vlastnosti zbraní): "Zatížení štítu - Šance při úspěšném Krytu. Zatížený
 * štít ztrácí veškeré bonusy. Efekt lze zrušit za dvě akce (Vyvolává
 * Příležitostné útoky)."
 *
 * Built 2026-10-19 (user rulings, Warden batch 1):
 *
 * - The chance is a weapon property: an effect slot of type `shield_strain`
 *   (the Javelin carries 25%). combatSkillBonuses.mjs getEffectRolls sums
 *   every such slot (weapon, off hand, ability, modifiers, coating) instead of
 *   rolling it, adds Troufalý vrh's +50% (hoplite.mjs
 *   DARING_THROW_SHIELD_STRAIN), and the attack card carries the result as
 *   `flags.attack.shieldStrain`. buildAttackPacket (defense.mjs) copies it into
 *   the packet every defense card keeps as `flags.redsteel.versusAttack`.
 * - Kryt (Cover) is the Ranged Defense roll (`defenseKey: "rangedDefense"`).
 *   The roll happens when a defense card answers such an attack with a
 *   successful Cover while the defender holds a shield (rollShieldStrain, run
 *   from the active GM's createChatMessage queue, so it happens once). A
 *   rerolled defense card rolls only if the card it replaced never did.
 * - Strážce → Zatížení štítu -15% (`zatizeniStitu`): the defender's chance
 *   drops by WARDEN_STRAIN_REDUCTION.
 * - A strained shield is the existing `shield_strain` status
 *   (helpers/config.mjs). It carries no changes: documents/actor.mjs cancels
 *   every bonus the shield grants (defense, Cover, crit defense, armor,
 *   Health, quality, enchantment and an NPC shield's Deflect) while keeping
 *   its penalties.
 * - Uvolnit štít (Free the Shield): 2 Actions, 0 Stamina, removes the status.
 *   Granted to everyone who owns a shield (abilityGrants.mjs), refused while
 *   the shield is not strained (combatAbilities.mjs, before anything is
 *   paid), offered as a hotbar chip while it is (actionSuggestions.mjs). The
 *   system has no mechanism that marks an action as provoking Opportunity
 *   Attacks, so the description says so and the table resolves them.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";

const SYSTEM_ID = "redsteel";

/** The status a strained shield puts on its holder. */
export const SHIELD_STRAIN_STATUS = "shield_strain";

/** Strážce → "Zatížení štítu -15%". */
export const WARDEN_STRAIN_REDUCTION = 15;

/** Uvolnit štít (Free the Shield), by localisation key. */
export const FREE_THE_SHIELD_KEY = "REDSTEEL.Items.FreeTheShield.name";

/** Defense card flag recording the strain roll made against it. */
const ROLL_FLAG = "shieldStrainRoll";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Is this effect slot name the shield strain property? The effect type id is
 * `shield_strain`; a custom slot typed as "Shield strain" lowercases to the
 * spaced form.
 *
 * @param {string} name  a lowercased effect name
 * @returns {boolean}
 */
export function isShieldStrainEffect(name) {
  return name === "shield_strain" || name === "shield strain";
}

/** Does this actor own a shield at all (anywhere in its inventory)? */
export function ownsShield(actor) {
  return !!actor?.items?.some?.(
    (i) => i.type === "gear" && i.system?.shield === true,
  );
}

/**
 * Is a shield in hand right now? A character's active weapon set off hand,
 * an NPC's equipped shield: the same two places documents/actor.mjs reads a
 * shield's bonuses from.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function holdsShield(actor) {
  if (!actor) return false;
  if (actor.type === "character") {
    const combat = actor.system?.combat;
    const setId = combat?.activeWeaponSet;
    const offId = setId ? combat?.weaponSets?.[setId]?.off : null;
    const off = offId ? actor.items.get(offId) : null;
    return !!off?.system?.shield;
  }
  return actor.items.some(
    (i) =>
      i.type === "gear" && i.system?.shield === true && i.system?.equipped,
  );
}

/** Is this actor's shield strained? */
export function isShieldStrained(actor) {
  return !!actor?.statuses?.has?.(SHIELD_STRAIN_STATUS);
}

/**
 * The chance this defender's shield is strained by a blow carrying `base`,
 * after Strážce's -15%. Never below 0.
 *
 * @param {Actor} actor
 * @param {number} base  the attack card's `shieldStrain`
 * @returns {number}
 */
export function effectiveStrainChance(actor, base) {
  let chance = Math.floor(Number(base) || 0);
  if (actorHasSpecNode(actor, "warden", "zatizeniStitu")) {
    chance -= WARDEN_STRAIN_REDUCTION;
  }
  return Math.max(0, chance);
}

/** Is this the Free the Shield ability (by key, or the pack's English name)? */
export function isFreeTheShield(ability) {
  return (
    ability?.system?.localizationKey === FREE_THE_SHIELD_KEY ||
    ability?.name === "Free the Shield"
  );
}

/**
 * Why Free the Shield cannot be used right now, or null when it can. Asked
 * before anything is paid.
 *
 * @param {Actor} actor
 * @returns {string|null}
 */
export function freeTheShieldRefusal(actor) {
  if (isShieldStrained(actor)) return null;
  return game.i18n.localize("REDSTEEL.Warden.FreeShieldNotStrained");
}

/**
 * Free the Shield: remove the strain. Paid by the caller (the Combat
 * Abilities flow), which also posts the ability's own card.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>} true when a strain was removed
 */
export async function freeTheShield(actor) {
  const ids = actor.effects.contents
    .filter((e) => e.statuses?.has(SHIELD_STRAIN_STATUS))
    .map((e) => e.id);
  if (!ids.length) return false;
  await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  return true;
}

/** The defending token's document, from the card's stamp. */
function defenderTokenDoc(message, defense) {
  const id = defense?.defenderTokenId;
  if (!id) return null;
  const scene =
    game.scenes?.get(message.speaker?.scene) ?? canvas?.scene ?? null;
  return scene?.tokens?.get(id) ?? null;
}

/**
 * The strain roll for one defense card. Active GM only (see
 * registerShieldStrainHooks), so it runs once whoever rolled the defense.
 *
 * Conditions, all required: the card answered an attack card (it keeps the
 * attack packet), the defense was a Cover (Ranged Defense) and it held, the
 * blow carries a strain chance, the defender holds a shield that is not
 * already strained, and the chance after Strážce is above 0.
 *
 * @param {ChatMessage} message  a freshly created chat message
 */
export async function rollShieldStrain(message) {
  const flags = message?.flags?.[SYSTEM_ID];
  const defense = flags?.defense;
  const packet = flags?.versusAttack;
  if (!defense || !packet) return;
  if (defense.defenseKey !== "rangedDefense" || defense.succeeded !== true) {
    return;
  }
  const base = Number(packet.shieldStrain) || 0;
  if (base <= 0) return;

  // A reroll of a defense that already rolled the strain does not get a
  // second roll: the strain belongs to the blow, not to the die.
  if (flags.rerolledFrom) {
    const source = game.messages?.get(flags.rerolledFrom);
    if (source?.flags?.[SYSTEM_ID]?.[ROLL_FLAG]) return;
  }
  if (flags[ROLL_FLAG]) return;

  const tokenDoc = defenderTokenDoc(message, defense);
  const actor =
    tokenDoc?.actor ?? ChatMessage.getSpeakerActor(message.speaker ?? {});
  if (!actor) return;
  if (!holdsShield(actor) || isShieldStrained(actor)) return;

  const chance = effectiveStrainChance(actor, base);
  if (chance <= 0) return;

  const roll = await new Roll("1d100").evaluate();
  const strained = roll.total <= chance;

  await message.setFlag(SYSTEM_ID, ROLL_FLAG, {
    roll: roll.total,
    chance,
    strained,
  });
  if (strained) {
    await game.redsteel.applyEffect(actor, SHIELD_STRAIN_STATUS);
  }

  const key = strained
    ? "REDSTEEL.Warden.StrainApplied"
    : "REDSTEEL.Warden.StrainHeld";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: tokenDoc ?? undefined }),
    content: `<div style="text-align:center;">${game.i18n.format(key, {
      name: esc(tokenDoc?.name ?? actor.name),
      effect: esc(game.i18n.localize("REDSTEEL.Effect.Name.shield_strain")),
      roll: roll.total,
      chance,
    })}</div>`,
  });
}

/**
 * Register the strain roll. Every client sees createChatMessage; only the
 * active GM acts, one card at a time.
 */
export function registerShieldStrainHooks() {
  let queue = Promise.resolve();
  Hooks.on("createChatMessage", (message) => {
    if (!game.users.activeGM?.isSelf) return;
    queue = queue
      .then(() => rollShieldStrain(message))
      .catch((err) => console.error("Redsteel | Shield strain roll failed", err));
  });
}
