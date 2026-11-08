/**
 * Veneficus (the warrior mage specialisation): the node rules that live
 * outside node passives. Rulebook: docs/rules-source/rules/specializace-wip.md
 * r736-r769.
 *
 * - Zabije-li cíl Soubojem, sleva 2 many na příští kouzlo (slevaMany): a melee
 *   weapon attack whose Apply Damage fells a target leaves 2 Mana off the next
 *   spell, per target felled (settleVeneficusDamage, on the GM applying it).
 * - Navazující kouzlo (navazujiciKouzlo): "Pokud zabije cíl útokem, který byl
 *   magicky posílen, získává bonus +10% na Usměrňování na příští kouzlo ze
 *   stejné Školy." The attack card is stamped, as it is posted, with the
 *   school of every spell empowering the attacker at that moment
 *   (`flags.redsteel.empoweredSchools`, stampEmpoweredSchools): a held strike
 *   (the `consumeOnAttack` effect, castSpell.mjs applyStrikeEffect) and the
 *   spell weapon empowerments in `weaponEnchant` / `weaponEnchant2`
 *   (RedsteelActiveEffect.MAGIC_WEAPON_ENCHANTS). Each effect carries its
 *   casting school as `flags.redsteel.empowerSchool`, written where it is
 *   applied (applyStrikeEffect, and applyDamage.mjs applyEffectsAsGM through
 *   stampEnchantSchool). A kill pays +10% per school, once per card.
 * - Magický veterán (magickyVeteran): the Apply Damage dialog's "give up
 *   degrees" control. The GM re-checks it (settleMagicVeteran) and every
 *   degree actually given up eases the next spell's Difficulty by 10, once
 *   per card.
 * - Soubojové akce za manu (soubojZaManu, user ruling 2026-10-25): a melee
 *   ability's Stamina may be paid with Mana instead, 1:1, chosen per use in
 *   the Combat Abilities dialog (paysStaminaAsMana, read by
 *   combatAbilities.mjs deductAbilityCost).
 * - Lindarův výpad I and II (lindaruvVypad1, lindaruvVypad2): a successful
 *   Lindar spell cast on the holder's own turn grants a free Attack
 *   (grantLindarCharge, from castSpell.mjs applyPostCastEffects) and a hotbar
 *   chip that opens the Attack dialog for it. With II that Attack, if it is a
 *   melee swing, counts as a Charge (takeLindarChargeBonus, read in
 *   basicAttack.mjs): the actor's own Charge item numbers (+10% Hit, +2d4,
 *   +2d4 more with a Heavy weapon; Improved Charge's +3d4 when held) and
 *   Off-hand Bonus II's charge dice (champion.mjs championAbilityDamage).
 * - Magické posílení (magickePosileni): the Magic Reinforcement item. 8 Mana
 *   arms a one-shot actor flag; the next Strength or Dexterity versus Test,
 *   initiating or answering, rolls with Advantage (takeMagicReinforcement,
 *   at each roll site), and the flag is spent.
 * - Magické míření (magickeMireni): the Magic Aiming item. 5 Mana, one Aim on
 *   the one targeted token, once per round in combat (useMagicAiming).
 * - Magické momentum (magickeMomentum, user ruling 2026-10-25: ONE free spell
 *   per round in total): a landed weapon attack (settleVeneficusDamage) or a
 *   target knocked Prone by a melee action (openMagicMomentumOnProne) opens
 *   the round's allowance. It is opt-in ("může"): the hotbar chip arms it
 *   (armMagicMomentum) and only an armed cast is free and halved; an unarmed
 *   cast pays and deals full damage. The allowance itself, its arming, its
 *   consumption and the half damage stamp live in actionTracker.mjs
 *   (openMagicMomentum, hasMagicMomentum, armMagicMomentum, spendForItems,
 *   takeMagicMomentumCast), so that file
 *   imports nothing from here. The cast card is stamped
 *   `flags.redsteel.magicMomentumHalf` (stampMomentumCast) and Apply Damage
 *   forces its half damage box.
 *
 * Kept free of imports from the cast pipeline and Apply Damage, which both
 * import this file.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import {
  getSpent,
  grantFreeAttack,
  armMagicMomentum,
  hasMagicMomentum,
  isMagicMomentumArmed,
  isTrackedTurn,
  markBonusSource,
  openMagicMomentum,
  takeMagicMomentumCast,
  trackedCombat,
} from "./actionTracker.mjs";
import { grantAimStacks } from "./aim.mjs";
import { hasLindarCharge, isLindarChargeSpell } from "./lindarCharge.mjs";
import { addNextSpellBonus } from "./nextSpellBonus.mjs";

const SYSTEM_ID = "redsteel";
const SPEC = "veneficus";

/** Items granted by the nodes (abilityGrants.mjs). */
export const MAGIC_REINFORCEMENT_KEY = "REDSTEEL.Items.MagicReinforcement.name";
export const MAGIC_AIMING_KEY = "REDSTEEL.Items.MagicAiming.name";

/** Zabije-li cíl Soubojem: Mana off the next spell, per target killed. */
export const MELEE_KILL_MANA_DISCOUNT = 2;
/** Navazující kouzlo: Channeling on the next spell of the school. */
export const FOLLOW_UP_SPELL_CHANNELING = 10;
/** Magický veterán: Difficulty eased per Critical degree given up. */
export const MAGIC_VETERAN_DIFFICULTY_PER_DEGREE = 10;
/** The highest degree the critical tables go to. */
const MAX_DEGREE = 4;

/** Lindarův výpad II, when the actor holds no Charge item to read. */
const CHARGE_FALLBACK = Object.freeze({ attack: 10, dice: "2d4", heavyDice: "2d4" });
const CHARGE_KEY = "REDSTEEL.Items.Charge.name";
const IMPROVED_CHARGE_KEY = "REDSTEEL.Items.ImprovedCharge.name";

/** Actor flags. */
const REINFORCE_FLAG = "magicReinforcement";
const LINDAR_FLAG = "lindarChargeAttack";
/** Card flags. */
const SCHOOLS_FLAG = "empoweredSchools";
const MANA_KILL_PAID = "veneficusManaKillPaid";
const FOLLOW_UP_PAID = "veneficusFollowUpPaid";
const VETERAN_PAID = "magicVeteranPaid";
const MOMENTUM_HALF = "magicMomentumHalf";
/** Effect flag: the school of the spell that put the effect there. */
const EMPOWER_SCHOOL = "empowerSchool";

const LINDAR_ICON = "icons/skills/melee/strike-sword-dagger-runes-red.webp";
const MOMENTUM_ICON = "icons/magic/lightning/fist-unarmed-strike-blue-green.webp";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.Veneficus.${key}`, data)
    : game.i18n.localize(`REDSTEEL.Veneficus.${key}`);

/* -------------------------------------------- */
/*  Shared                                      */
/* -------------------------------------------- */

/** Does this character hold this Veneficus node? */
export function hasVeneficusNode(actor, node) {
  return actor?.type === "character" && actorHasSpecNode(actor, SPEC, node);
}

function isKeyed(item, key, englishName) {
  return item?.system?.localizationKey === key || item?.name === englishName;
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

/** The token standing in for this actor (movementZones.mjs tokenForActor). */
function holderToken(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token?.object ?? null;
  return actor.getActiveTokens?.(false, false)?.[0] ?? null;
}

function schoolLabel(school) {
  const key = `REDSTEEL.Actor.Character.schools.${school}.label`;
  const label = game.i18n.localize(key);
  return label === key ? String(school) : label;
}

async function postLine(actor, title, line, token = null) {
  const doc = token?.document ?? token ?? holderToken(actor)?.document ?? null;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: doc }),
    flavor: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
<p style="text-align:center;">${line}</p>`,
  });
}

function nodeLabel(node) {
  return game.i18n.localize(
    `REDSTEEL.Actor.Specialisations.veneficus.nodes.${node}.label`,
  );
}

/** A weapon item the attacker owns, named by the card. */
function cardWeapon(message, attacker) {
  const owned = attacker?.items?.get(message?.flags?.redsteel?.weaponId ?? "");
  return owned?.type === "weapon" ? owned : null;
}

/** A spell card (cast card or spell automation card)? */
function isSpellCard(message) {
  const flags = message?.flags?.redsteel ?? {};
  return (
    message?.flags?.attack?.isSpell === true ||
    !!flags.spellSchool ||
    !!flags.casterUuid
  );
}

/**
 * A melee action card ("soubojová akce"): an attack card that is not a
 * spell, a shot or a throw. Weapon or not (Trip, Knockdown).
 */
function isMeleeActionCard(message) {
  const attack = message?.flags?.attack;
  if (attack?.type !== "attack" || isSpellCard(message)) return false;
  return attack.attackType !== "ranged" && attack.attackType !== "throwing";
}

/**
 * A melee weapon attack ("Souboj"): a melee action swung with a weapon the
 * attacker owns. A bow or crossbow only when swung as a makeshift weapon
 * (attackType "melee"), which rolls on Combat like any melee blow.
 */
function isMeleeWeaponCard(message, attacker) {
  if (!isMeleeActionCard(message)) return false;
  const weapon = cardWeapon(message, attacker);
  if (!weapon) return false;
  const ws = weapon.system ?? {};
  if (message.flags.attack.attackType === "melee") return true;
  return ws.thrown !== true && !["bow", "crossbow", "firearm"].includes(ws.class);
}

/* -------------------------------------------- */
/*  Navazující kouzlo: the empowering schools   */
/* -------------------------------------------- */

/**
 * Record the casting school on a spell weapon empowerment applied from a
 * spell card (applyDamage.mjs applyEffectsAsGM). Whetstone and anything
 * outside MAGIC_WEAPON_ENCHANTS are left alone, as is an apply with no
 * school (a manual toggle).
 *
 * @param {ActiveEffect|null} applied
 * @param {string} effectId
 * @param {string|null} school
 */
export async function stampEnchantSchool(applied, effectId, school) {
  if (!applied || !school) return;
  const enchants = CONFIG.ActiveEffect?.documentClass?.MAGIC_WEAPON_ENCHANTS;
  if (!enchants?.has(effectId)) return;
  if (applied.getFlag(SYSTEM_ID, EMPOWER_SCHOOL) === school) return;
  await applied.setFlag(SYSTEM_ID, EMPOWER_SCHOOL, school);
}

/**
 * The schools of every spell empowering this actor's attack right now: the
 * held strike, and the spell weapon empowerments in both slots. An effect
 * whose school was never recorded (applied before this was built, or by
 * hand) counts for nothing: no school is guessed from the effect id.
 *
 * @param {Actor} actor
 * @returns {string[]}
 */
export function empoweringSchools(actor) {
  const out = new Set();
  const strike = actor?.effects?.find((e) =>
    e.getFlag(SYSTEM_ID, "consumeOnAttack"),
  );
  const strikeSchool = strike?.getFlag(SYSTEM_ID, EMPOWER_SCHOOL);
  if (strikeSchool) out.add(String(strikeSchool));

  const enchants = CONFIG.ActiveEffect?.documentClass?.MAGIC_WEAPON_ENCHANTS;
  const groups = actor?.system?.activeCombatEffects ?? {};
  for (const key of ["weaponEnchant", "weaponEnchant2"]) {
    const source = groups[key]?.sourceEffect;
    if (!source || !enchants?.has(source)) continue;
    const effect = actor.effects.find((e) => e.statuses?.has(source));
    const school = effect?.getFlag(SYSTEM_ID, EMPOWER_SCHOOL);
    if (school) out.add(String(school));
  }
  return [...out];
}

/**
 * preCreateChatMessage, on the client posting the card: a weapon attack card
 * by a Navazující kouzlo holder carries the schools empowering it, read
 * before the strike-consume hook (redsteel.mjs, createChatMessage) spends
 * the strike. A reroll card is the same blow and carries the stamp over
 * (redsteel.mjs REROLL_CARRIED_FLAGS) instead of reading it again.
 */
function stampEmpoweredSchools(message) {
  const attack = message.flags?.attack;
  if (attack?.type !== "attack" || attack.isSpell) return;
  const flags = message.flags?.redsteel ?? {};
  if (flags.rerolledFrom || flags.spellSchool || flags.casterUuid) return;
  const actor = ChatMessage.getSpeakerActor(message.speaker ?? {});
  if (!hasVeneficusNode(actor, "navazujiciKouzlo")) return;
  const schools = empoweringSchools(actor);
  if (!schools.length) return;
  message.updateSource({ [`flags.${SYSTEM_ID}.${SCHOOLS_FLAG}`]: schools });
}

/**
 * preCreateChatMessage: the cast card of the spell Magic Momentum made free
 * (actionTracker.mjs spendForItems noted it a moment ago on this client) is
 * stamped for half damage.
 */
function stampMomentumCast(message) {
  const flags = message.flags?.redsteel ?? {};
  if (flags.rerolledFrom || !flags.casterUuid || !flags.spellId) return;
  if (!takeMagicMomentumCast(flags.casterUuid, flags.spellId)) return;
  message.updateSource({ [`flags.${SYSTEM_ID}.${MOMENTUM_HALF}`]: true });
}

/** Does this card's damage have to apply at half (Magic Momentum)? */
export function isMagicMomentumHalf(message) {
  return message?.getFlag?.(SYSTEM_ID, MOMENTUM_HALF) === true;
}

/* -------------------------------------------- */
/*  Apply Damage (GM)                           */
/* -------------------------------------------- */

/**
 * Apply Damage landed (applyDamage.mjs applyDamageAsGM, on the GM). Pays
 * Zabije-li cíl Soubojem and Navazující kouzlo on a kill, and opens Magic
 * Momentum on a weapon hit. A "kill" is the felled test every kill rule
 * reads (felledIds: dead, or newly Downed or Unconscious), the attacker's
 * own token aside.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message
 * @param {{felledIds?: string[]}} [options]
 */
export async function settleVeneficusDamage(attacker, message, { felledIds = [] } = {}) {
  if (attacker?.type !== "character" || !message?.flags?.attack) return;
  if (isSpellCard(message)) return;
  const selfId = message.speaker?.token ?? null;
  const killed = [...new Set(felledIds.filter((id) => id && id !== selfId))];

  // Zabije-li cíl Soubojem: 2 Mana per target, each target paid once.
  if (
    killed.length &&
    hasVeneficusNode(attacker, "slevaMany") &&
    isMeleeWeaponCard(message, attacker)
  ) {
    const paid = message.getFlag(SYSTEM_ID, MANA_KILL_PAID) ?? [];
    const fresh = killed.filter((id) => !paid.includes(id));
    if (fresh.length) {
      await message.setFlag(SYSTEM_ID, MANA_KILL_PAID, [...paid, ...fresh]);
      const amount = MELEE_KILL_MANA_DISCOUNT * fresh.length;
      await addNextSpellBonus(attacker, { manaDiscount: amount });
      await postLine(
        attacker,
        nodeLabel("slevaMany"),
        L("ManaKill", { name: esc(attacker.name), amount }),
      );
    }
  }

  // Navazující kouzlo: +10% per empowering school, once per card.
  if (
    killed.length &&
    hasVeneficusNode(attacker, "navazujiciKouzlo") &&
    !message.getFlag(SYSTEM_ID, FOLLOW_UP_PAID)
  ) {
    const raw = message.getFlag(SYSTEM_ID, SCHOOLS_FLAG);
    const schools = (Array.isArray(raw) ? raw : [])
      .map((s) => String(s ?? "").trim())
      .filter((s) => /^[a-z]+$/i.test(s));
    if (schools.length) {
      await message.setFlag(SYSTEM_ID, FOLLOW_UP_PAID, true);
      for (const school of [...new Set(schools)]) {
        await addNextSpellBonus(attacker, {
          channeling: { school, bonus: FOLLOW_UP_SPELL_CHANNELING },
        });
      }
      await postLine(
        attacker,
        nodeLabel("navazujiciKouzlo"),
        L("FollowUpSpell", {
          name: esc(attacker.name),
          bonus: FOLLOW_UP_SPELL_CHANNELING,
          schools: esc([...new Set(schools)].map(schoolLabel).join(", ")),
        }),
      );
    }
  }

  // Magické momentum: a landed weapon attack opens the round's free spell.
  if (hasVeneficusNode(attacker, "magickeMomentum") && cardWeapon(message, attacker)) {
    await openMomentumFor(attacker);
  }
}

/**
 * A melee action knocked a target Prone (Apply Damage, the lost-contest push
 * in forcedMovement.mjs, a Trip or shield push answered in hoplite.mjs):
 * Magic Momentum's second trigger. On the GM.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message  the attack card
 * @param {string[]} knockedDownIds  tokens newly Prone
 */
export async function openMagicMomentumOnProne(attacker, message, knockedDownIds = []) {
  if (!hasVeneficusNode(attacker, "magickeMomentum")) return;
  if (!isMeleeActionCard(message)) return;
  const selfId = message.speaker?.token ?? null;
  if (!knockedDownIds.some((id) => id && id !== selfId)) return;
  await openMomentumFor(attacker);
}

async function openMomentumFor(attacker) {
  if (!(await openMagicMomentum(attacker))) return;
  await postLine(
    attacker,
    nodeLabel("magickeMomentum"),
    L("MomentumOpened", { name: esc(attacker.name) }),
  );
}

/* -------------------------------------------- */
/*  Magický veterán                             */
/* -------------------------------------------- */

/** May this attacker give up Critical degrees (the dialog's control)? */
export function canMagicVeteran(attacker) {
  return hasVeneficusNode(attacker, "magickyVeteran");
}

/**
 * The degrees asked for, as the GM trusts them: a whole number 0-4, and 0
 * unless the attacker holds the node and the damage goes in as a Critical.
 *
 * @param {Actor|null} attacker
 * @param {*} requested  the socket payload's value
 * @param {string} mode
 * @returns {number}
 */
export function sanitizeMagicVeteran(attacker, requested, mode) {
  if (mode !== "critical" || !canMagicVeteran(attacker)) return 0;
  const n = Math.round(Number(requested) || 0);
  return Math.max(0, Math.min(MAX_DEGREE, n));
}

/**
 * Pay Magic Veteran for an apply that gave up `given` degrees (the most any
 * one target lost: one choice on one blow, however many it caught). Once per
 * card: a re-apply or a later target lowers the degree as asked but pays
 * nothing more.
 *
 * @param {Actor} attacker
 * @param {ChatMessage} message
 * @param {number} given
 */
export async function settleMagicVeteran(attacker, message, given) {
  if (!(given > 0) || !attacker) return;
  if (message.getFlag(SYSTEM_ID, VETERAN_PAID)) {
    ui.notifications.info(L("VeteranAlreadyPaid"));
    return;
  }
  await message.setFlag(SYSTEM_ID, VETERAN_PAID, true);
  const amount = MAGIC_VETERAN_DIFFICULTY_PER_DEGREE * given;
  await addNextSpellBonus(attacker, { difficulty: amount });
  await postLine(
    attacker,
    nodeLabel("magickyVeteran"),
    L("VeteranPaid", { name: esc(attacker.name), degrees: given, amount }),
  );
}

/* -------------------------------------------- */
/*  Soubojové akce za manu                      */
/* -------------------------------------------- */

/** Does the Combat Abilities dialog offer the Stamina-as-Mana toggle? */
export function offersStaminaAsMana(actor) {
  return hasVeneficusNode(actor, "soubojZaManu");
}

/**
 * Is this ability's Stamina paid in Mana when the toggle is on? A melee
 * ability (system.type "melee", the Combat Abilities dialog's Melee kind) of
 * a node holder.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {boolean}
 */
export function paysStaminaAsMana(actor, ability) {
  return offersStaminaAsMana(actor) && ability?.system?.type === "melee";
}

/* -------------------------------------------- */
/*  Lindarův výpad                              */
/* -------------------------------------------- */

/**
 * A Lindar spell landed (castSpell.mjs applyPostCastEffects, already gated
 * on a successful cast): on the caster's own turn in a tracked combat, the
 * next plain Attack this turn is a Free action (actionTracker.mjs
 * grantFreeAttack), held for the spell's target when there is one. With
 * Lindarův výpad II that Attack counts as a Charge. The free Attack shares
 * its one slot with every other grant of it (Champion's Útok po Zteči,
 * Momentum ...): a newer grant takes the slot, and the Charge with it.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {Token|TokenDocument|null} [casterToken]
 */
export async function grantLindarCharge(actor, spell, casterToken = null) {
  if (actor?.type !== "character" || !hasLindarCharge(actor)) return;
  if (!isLindarChargeSpell(spell) || spell?.system?.option === "divine") return;
  const combat = trackedCombat(actor);
  if (!combat || !isTrackedTurn(actor)) return;

  const selfDoc =
    casterToken?.document ?? casterToken ?? holderToken(actor)?.document ?? null;
  const selfId = selfDoc?.id ?? null;
  const target =
    [...(game.user?.targets ?? [])].find((t) => t.id && t.id !== selfId) ?? null;
  const holderId = target?.id || selfId || actor.id;
  await grantFreeAttack(actor, holderId);

  const charge = hasVeneficusNode(actor, "lindaruvVypad2");
  const spellName = spell.localizedName ?? spell.name;
  await actor.setFlag(SYSTEM_ID, LINDAR_FLAG, {
    combat: turnStamp(combat),
    holderId,
    targetTokenId: target?.id ?? null,
    spellName,
    charge,
    armed: false,
  });
  await postLine(
    actor,
    L("LindarChargeLabel"),
    L(charge ? "LindarChargeReadyCharge" : "LindarChargeReady", {
      name: esc(actor.name),
      spell: esc(spellName),
    }),
    casterToken,
  );
}

/**
 * The Lindar's Charge this actor may still take: granted this turn, the free
 * Attack it put in the slot still there, not yet swung. Null otherwise.
 *
 * @param {Actor} actor
 */
export function pendingLindarCharge(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, LINDAR_FLAG);
  if (!stored || stored.armed) return null;
  if (!stampIsThisTurn(stored.combat, game.combat) || !isTrackedTurn(actor)) return null;
  if (getSpent(actor).freeAttack !== stored.holderId) return null;
  return stored;
}

/**
 * The plain Attack spent its Action (attackActions.mjs, right after
 * spendForAttack): when the free Attack Lindar's Charge put in the slot is
 * what paid for it, the swing that follows is Lindar's Charge.
 *
 * @param {Actor} actor
 * @param {object|null} before  pendingLindarCharge, read before the spend
 */
export async function armLindarChargeAttack(actor, before) {
  if (!before) return;
  if (getSpent(actor).freeAttack === before.holderId) return;
  await actor.setFlag(SYSTEM_ID, LINDAR_FLAG, { ...before, armed: true });
}

/** A melee swing: neither a shot nor a throw (a makeshift bow swing is one). */
function isMeleeSwing(weapon, attackType) {
  if (attackType === "ranged" || attackType === "throwing") return false;
  if (weapon?.isMakeshiftView === true) return true;
  const ws = weapon?.system ?? {};
  if (ws.thrown === true && attackType !== "melee") return false;
  return !["bow", "crossbow", "firearm"].includes(ws.class);
}

/** The actor's own Charge item: Improved Charge first, then Charge. */
function chargeItem(actor) {
  const abilities = actor?.items?.filter((i) => i.type === "ability") ?? [];
  return (
    abilities.find((i) => isKeyed(i, IMPROVED_CHARGE_KEY, "Improved Charge")) ??
    abilities.find((i) => isKeyed(i, CHARGE_KEY, "Charge")) ??
    null
  );
}

/**
 * The attack being rolled (basicAttack.mjs universalAttackLogic) is the one
 * Lindar's Charge armed: spend the flag and say what it adds. With II and a
 * melee swing it counts as a Charge: the Charge item's Hit and dice (its
 * Heavy weapon dice on a heavy weapon), and Off-hand Bonus II's charge
 * dice. Without II, or on a shot or a throw, only the card tag.
 *
 * @param {Actor} actor
 * @param {Item} weapon
 * @param {string} attackType
 * @returns {Promise<{attack: number, damage: string, tag: string}|null>}
 */
export async function takeLindarChargeBonus(actor, weapon, attackType) {
  const stored = actor?.getFlag?.(SYSTEM_ID, LINDAR_FLAG);
  if (!stored?.armed) return null;
  await actor.unsetFlag(SYSTEM_ID, LINDAR_FLAG);
  if (!stampIsThisTurn(stored.combat, game.combat)) return null;
  const plain = { attack: 0, damage: "", tag: "lindarCharge" };
  if (!stored.charge || !hasVeneficusNode(actor, "lindaruvVypad2")) return plain;
  if (!isMeleeSwing(weapon, attackType)) return plain;

  const item = chargeItem(actor);
  const roll = item?.system?.roll ?? {};
  const attack = item ? Number(item.system.attack) || 0 : CHARGE_FALLBACK.attack;
  const parts = [item ? roll.diceBonusFormula : CHARGE_FALLBACK.dice];
  if (weapon?.system?.type === "heavy") {
    parts.push(item ? roll.heavyDiceBonusFormula : CHARGE_FALLBACK.heavyDice);
  }
  // Šampion → Bonus za druhou zbraň II, Medium: +2d4 on any charge. Loaded at
  // call time: champion.mjs sits high in the import graph.
  const { championAbilityDamage } = await import("./champion.mjs");
  parts.push(
    championAbilityDamage(actor, {
      name: "Charge",
      system: { localizationKey: CHARGE_KEY },
    }),
  );
  const damage = parts
    .map((p) => String(p ?? "").trim())
    .filter((p) => p && p !== "0")
    .map((p) => `(${p})`)
    .join(" + ");
  return { attack, damage, tag: "lindarChargeCharge" };
}

/* -------------------------------------------- */
/*  Magické posílení (Magic Reinforcement)      */
/* -------------------------------------------- */

/** Is this the Magic Reinforcement item? */
export function isMagicReinforcement(ability) {
  return isKeyed(ability, MAGIC_REINFORCEMENT_KEY, "Magic Reinforcement");
}

/** Is Magic Reinforcement armed on this actor? */
export function hasMagicReinforcement(actor) {
  return !!actor?.getFlag?.(SYSTEM_ID, REINFORCE_FLAG);
}

/**
 * Use Magic Reinforcement: refused, without charging, while one is already
 * armed. Otherwise pay the item (8 Mana) and arm the flag.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {Token|null} [token]
 */
export async function useMagicReinforcement(actor, ability, token = null) {
  if (hasMagicReinforcement(actor)) {
    ui.notifications.warn(L("ReinforceAlready"));
    return;
  }
  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return;
  await actor.setFlag(SYSTEM_ID, REINFORCE_FLAG, true);
  await postLine(
    actor,
    ability.localizedName ?? ability.name,
    L("ReinforceArmed", { name: esc(actor.name) }),
    token,
  );
}

/**
 * A Strength or Dexterity versus Test is about to be rolled by this actor
 * (an ability's own test, an attack modifier's, a Shield Bash's, Push
 * Back's, or the answer to a .mos-followup line): with Magic Reinforcement
 * armed, the roll takes Advantage as one more item bias (rollAdvantage.mjs,
 * summed by the evaluate wrapper so it cancels against disadvantage), and
 * the flag is spent. Call after tagRollItemAdvantage, which overwrites the
 * item bias, and before evaluate. A plain sheet attribute roll is no contest
 * and does not come here.
 *
 * @param {Actor} actor
 * @param {Roll} roll
 * @param {string|null} skillKey  the attribute key the roll tests
 * @returns {Promise<boolean>} whether it applied
 */
export async function takeMagicReinforcement(actor, roll, skillKey) {
  if (skillKey !== "str" && skillKey !== "dex") return false;
  if (!roll || !hasMagicReinforcement(actor) || !actor.isOwner) return false;
  await actor.unsetFlag(SYSTEM_ID, REINFORCE_FLAG);
  roll.options ??= {};
  const tags = roll.options.redsteel ?? {};
  roll.options.redsteel = {
    ...tags,
    itemBias: (Number(tags.itemBias) || 0) + 1,
  };
  return true;
}

/* -------------------------------------------- */
/*  Magické míření (Magic Aiming)               */
/* -------------------------------------------- */

/** Is this the Magic Aiming item? */
export function isMagicAiming(ability) {
  return isKeyed(ability, MAGIC_AIMING_KEY, "Magic Aiming");
}

/** The round's use of Magic Aiming, in the action tracker's round record. */
function magicAimingSource(combat) {
  return `magicAiming.${combat.id}.${combat.round}`;
}

/**
 * Use Magic Aiming: exactly one targeted token other than the user's own,
 * once per round in combat (no limit outside one). Refused without charging
 * otherwise; else pay the item (5 Mana) and place one Aim.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {Token|null} [token]  the user's token (the dialog's)
 */
export async function useMagicAiming(actor, ability, token = null) {
  const self = token ?? holderToken(actor);
  const targets = [...(game.user?.targets ?? [])].filter(
    (t) => t !== self && t.id !== self?.id,
  );
  if (!self || targets.length !== 1) {
    ui.notifications.warn(L("AimNeedsTarget"));
    return;
  }
  const combat = trackedCombat(actor);
  if (combat && getSpent(actor).bonusSources.includes(magicAimingSource(combat))) {
    ui.notifications.warn(L("AimUsedThisRound"));
    return;
  }
  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return;
  if (combat) await markBonusSource(actor, magicAimingSource(combat));
  const target = targets[0];
  const { after } = await grantAimStacks(self, target, 1);
  await postLine(
    actor,
    ability.localizedName ?? ability.name,
    L("AimGained", { name: esc(actor.name), target: esc(target.name), after }),
    self,
  );
}

/* -------------------------------------------- */
/*  Combat Abilities dialog                     */
/* -------------------------------------------- */

/**
 * The Veneficus items the Combat Abilities dialog hands over before it pays
 * anything (combatAbilities.mjs onAbilityChosen). True when handled.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {Token|null} token
 * @returns {Promise<boolean>}
 */
export async function useVeneficusAbility(actor, ability, token) {
  if (isMagicReinforcement(ability)) {
    await useMagicReinforcement(actor, ability, token);
    return true;
  }
  if (isMagicAiming(ability)) {
    await useMagicAiming(actor, ability, token);
    return true;
  }
  return false;
}

/* -------------------------------------------- */
/*  Hotbar chips                                */
/* -------------------------------------------- */

/**
 * The Veneficus chips for the hotbar's suggestion strip
 * (actionSuggestions.mjs): Lindar's Charge while its free Attack waits, and
 * Magic Momentum while the round's free spell is open (its hint says when
 * it is already armed). Own turn only.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
export function veneficusChips(actor) {
  if (actor?.type !== "character" || !isTrackedTurn(actor)) return [];
  const chips = [];
  const lindar = pendingLindarCharge(actor);
  if (lindar) {
    const label = L("LindarChargeLabel");
    const target = lindar.targetTokenId
      ? canvas.tokens?.get(lindar.targetTokenId)
      : null;
    const hint = target
      ? L(lindar.charge ? "LindarChargeHintChargeTarget" : "LindarChargeHintTarget", {
          spell: lindar.spellName ?? "",
          target: target.name,
        })
      : L(lindar.charge ? "LindarChargeHintCharge" : "LindarChargeHint", {
          spell: lindar.spellName ?? "",
        });
    chips.push({
      id: "veneficus-lindar-charge",
      kind: "veneficus",
      op: "lindarCharge",
      theme: "melee",
      costKind: "free",
      img: LINDAR_ICON,
      label,
      hint,
      targetTokenId: target?.id ?? null,
      ariaLabel: `${label}: ${hint}`,
    });
  }
  if (hasVeneficusNode(actor, "magickeMomentum") && hasMagicMomentum(actor)) {
    const label = nodeLabel("magickeMomentum");
    // Armed from this chip already (a cast dialog closed unused): say so.
    const hint = L(isMagicMomentumArmed(actor) ? "MomentumHintArmed" : "MomentumHint");
    chips.push({
      id: "veneficus-magic-momentum",
      kind: "veneficus",
      op: "momentum",
      theme: "magic",
      costKind: "free",
      img: MOMENTUM_ICON,
      label,
      hint,
      ariaLabel: `${label}: ${hint}`,
    });
  }
  return chips;
}

/**
 * A Veneficus chip was clicked (redsteelHotbar.mjs). Lindar's Charge opens
 * the Attack dialog at the spell's target, whose plain Attack spends the free
 * one; Magic Momentum arms the round's free spell and opens the cast dialog.
 * The token is taken into control first, since both dialogs read the acting
 * token from it.
 *
 * @param {Actor} actor
 * @param {DOMStringMap} data  the chip's dataset (`op`, `targetTokenId`)
 */
export async function useVeneficusChip(actor, data = {}) {
  const token = holderToken(actor);
  if (!token?.isOwner) return;
  if (data.op === "lindarCharge") {
    const pending = pendingLindarCharge(actor);
    if (!pending) return;
    const target = pending.targetTokenId
      ? canvas.tokens?.get(pending.targetTokenId)
      : null;
    if (target) target.setTarget(true, { releaseOthers: true });
    takeControl(token);
    await game.redsteel.attackActions();
  } else if (data.op === "momentum") {
    // Opt-in: the chip arms the round's free spell (actionTracker.mjs); the
    // cast that follows spends it. Nothing is spent by arming.
    if (!(await armMagicMomentum(actor))) return;
    takeControl(token);
    await game.redsteel.castSpell();
  }
}

function takeControl(token) {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length !== 1 || controlled[0] !== token) {
    token.control({ releaseOthers: true });
  }
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerVeneficusHooks() {
  // Runs on the client creating the card only, before the card exists, so
  // the stamps ride in on the creation itself.
  Hooks.on("preCreateChatMessage", (message) => {
    try {
      stampEmpoweredSchools(message);
      stampMomentumCast(message);
    } catch (err) {
      console.error("Redsteel | Veneficus card stamp failed", err);
    }
  });
}
