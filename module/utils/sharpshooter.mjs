/**
 * Ostrostřelec (Sharpshooter): the node rules that live outside aim.mjs, and
 * the base action Střelecký postoj (Shooting Stance). Rulebook:
 * docs/rules-source/rules/specializace-wip.md r476-r498, Shooting Stance in
 * ruzne-info.md r270, cover in zbrojnice.md r248 (Střelba) and r257 (Vrh:
 * "podléhá stejným situačním postihům, jako Střelba").
 *
 * Every node needs a bow or crossbow in hand (user ruling 2026-10-24):
 * aim.mjs sharpshooterNode is the one gate, used everywhere below.
 *
 * - Zmrzačující výstřel: 35% na zbavení pohybu (zmrzacujiciVystrel):
 *   skirmisher.mjs cripplingShotEffects.
 * - Zranění +50% za Primární Vlastnosti (primarniZraneni): weaponFormula.mjs.
 * - Míření: Ověření +5% (mireniOvereni, user ruling: per Aim committed to the
 *   shot): aimPrecisionModifier, read by basicAttack.mjs and
 *   combatAbilities.mjs before getAttackRolls clears the `aimCount` flag.
 * - Stráž: Střelba +10% (strazStrelba): overwatchShotBonus, added in
 *   combatSkillBonuses.mjs getAttackRolls to an Opportunity Attack shot while
 *   the `overwatch` status holds.
 * - Přesný výstřel: Kritický rozsah Výhoda a Hranice -5% (presnyVystrel):
 *   skirmisher.mjs accurateShotCritAdvantage and accurateShotMarginCrit.
 * - Ignoruje poloviční kryt a plný kryt se počítá jako poloviční
 *   (ignorujeKryt): the cover a target stands behind is declared in both
 *   attack dialogs for everyone (Poloviční kryt -30%, Plný kryt -60%),
 *   stored as the one-shot actor flag `attackCover` and consumed by
 *   consumeAttackCover (getAttackRolls, and throwExplosive.mjs for an
 *   explosive throw). With the node a half cover costs nothing and a full
 *   cover counts as half.
 * - Odvetný výstřel (odvetnyVystrel): the Retaliatory Shot item
 *   (abilityGrants.mjs), the hotbar chip (actionSuggestions.mjs
 *   retaliatoryShotChips), tagged "retaliation" on its card
 *   (combatAbilities.mjs) so nothing answers it.
 * - Těsný zásah (tesnyZasah): a node reroll pool (rerolls.mjs
 *   NODE_REROLL_POOLS) with no daily limit, 1 Stamina a use, offered only
 *   when the margins were 10 or less apart.
 * - Zacílení (zacileni): the Target Lock item and chip, useTargetLock below.
 * - Střelecký postoj (the base action, Archer X / Arbalest X) and the node
 *   streleckyPostoj: the `shooting_stance` status (helpers/config.mjs, Cover
 *   +10), Dodge +10 against Shooting and the node's extra Cover +10 / Dodge
 *   +5 read at roll time (shootingStanceDefense, defense.mjs), held per turn
 *   with a free upkeep (stances.mjs), broken by the holder's own move (the
 *   moveToken hook below), Overwatch free once a round (actionTracker.mjs).
 *   "Míření se počítá na všechny útoky provedené ve stejném kole" is
 *   aim.mjs. Mounted combat is not modelled, so "Tuto akci nelze použít při
 *   boji ze sedla" is a table ruling.
 */

import {
  grantAimStacks,
  isShootingWeapon,
  lastAimAction,
  sharpshooterNode,
  abilityIgnoresAim,
  isFinalStrike,
} from "./aim.mjs";
import { isForcedMove } from "./forcedMoveRegistry.mjs";
import { tokenForActor } from "./movementZones.mjs";
import { postStanceCard, stanceAbilityFor } from "./stances.mjs";

const SYSTEM_ID = "redsteel";

export const SHOOTING_STANCE_STATUS = "shooting_stance";
export const RETALIATORY_SHOT_KEY = "REDSTEEL.Items.RetaliatoryShot.name";
export const TARGET_LOCK_KEY = "REDSTEEL.Items.TargetLock.name";
const RETALIATORY_THROW_KEY = "REDSTEEL.Items.RetaliatoryThrow.name";

/** Střelecký postoj: "+10% na Úhyb proti Střelbě". */
const STANCE_DODGE = 10;
/** Ostrostřelec → Střelecký postoj: Úhyb +5% (against Shooting, as the stance's own). */
const STANCE_NODE_DODGE = 5;
/** Ostrostřelec → Střelecký postoj: Kryt +10%, on top of the stance's own +10. */
const STANCE_NODE_COVER = 10;
/** Stráž: Střelba +10%. */
export const OVERWATCH_SHOT_BONUS = 10;
/** Míření: Ověření +5%, per Aim committed to the shot (user ruling). */
export const AIM_PRECISION_PER_STACK = 5;
/** Zacílení: "Testovat Vnímání (-30%)". */
const TARGET_LOCK_TEST_MODIFIER = -30;

/** Zbrojnice r248: "Poloviční kryt: -30%, Plný kryt: -60%". */
export const COVER_PENALTY = Object.freeze({ half: -30, full: -60 });
/** Actor flag: the cover declared for the next attack ("half" | "full"). */
const COVER_FLAG = "attackCover";
/** Token flag: the aim stamp Target Lock was last tried on. */
const TARGET_LOCK_FLAG = "targetLockTried";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.Sharpshooter.${key}`, data)
    : game.i18n.localize(`REDSTEEL.Sharpshooter.${key}`);

function isKeyed(item, key, englishName) {
  return item?.system?.localizationKey === key || item?.name === englishName;
}

function abilityByKey(actor, key, name) {
  return (
    actor?.items?.find((i) => i.type === "ability" && isKeyed(i, key, name)) ??
    null
  );
}

/* -------------------------------------------- */
/*  Shooting attack cards                       */
/* -------------------------------------------- */

/**
 * Is this chat card a Shooting (Střelba) attack: a weapon attack rolled with
 * a bow or crossbow? Read off the card's reroll tokens, which every attack
 * card builds from the weapon that fired (rerolls.mjs getAttackRerollTokens:
 * "archery" for a bow or crossbow and nothing else). Contested cards and
 * spells are not attacks of that kind.
 *
 * @param {ChatMessage} message
 * @returns {boolean}
 */
export function isShootingAttackCard(message) {
  const attack = message?.flags?.attack;
  if (attack?.type !== "attack" || attack.isSpell || attack.contested) return false;
  const tokens = message.flags?.redsteel?.rerollTokens;
  return Array.isArray(tokens) && tokens.includes("archery");
}

/* -------------------------------------------- */
/*  Cover (Kryt): every ranged attack           */
/* -------------------------------------------- */

/**
 * Should the attack dialogs offer the cover toggles at all: something to
 * shoot or throw with in hand, or carried (the dialog's buttons may throw a
 * weapon other than the one in hand, or an explosive).
 *
 * @param {Actor} actor
 * @param {Item|null} [activeWeapon]
 * @returns {boolean}
 */
export function coverOptionAvailable(actor, activeWeapon = null) {
  const ranged = (w) =>
    ["bow", "crossbow", "firearm"].includes(w?.system?.class) ||
    w?.system?.thrown === true;
  if (ranged(activeWeapon)) return true;
  return (
    actor?.items?.some(
      (i) =>
        (i.type === "weapon" && ranged(i)) ||
        (i.type === "consumable" && i.system?.option === "explosive"),
    ) ?? false
  );
}

/**
 * Write (or clear) the cover declared for the next attack. Same one-shot
 * lifecycle as the dialogs' other flags (useFlankingAttack, aimCount): set on
 * confirm, consumed by the attack.
 *
 * @param {Actor} actor
 * @param {"half"|"full"|null} level
 */
export async function setAttackCover(actor, level) {
  if (!actor) return;
  if (level === "half" || level === "full") {
    await actor.setFlag(SYSTEM_ID, COVER_FLAG, level);
  } else if (actor.getFlag(SYSTEM_ID, COVER_FLAG)) {
    await actor.unsetFlag(SYSTEM_ID, COVER_FLAG);
  }
}

/** A shot (bow, crossbow, firearm) or a throw: the attacks cover spoils. */
function coverApplies(weapon, rangedSkill = "") {
  const ws = weapon?.system ?? {};
  return (
    ["bow", "crossbow", "firearm"].includes(ws.class) ||
    ws.thrown === true ||
    rangedSkill === "archery" ||
    rangedSkill === "throwing"
  );
}

/**
 * Consume the declared cover and say what it costs this attack. The flag is
 * cleared whatever the attack, so it can never leak into the next one; a
 * melee swing (a bow used as a makeshift club included) takes no penalty.
 *
 * Ostrostřelec → Ignoruje poloviční kryt a plný kryt se počítá jako
 * poloviční: a bow or crossbow shot ignores half cover and takes full cover
 * at the half cover penalty.
 *
 * @param {Actor} actor
 * @param {Item|null} weapon  the weapon of the roll (null for a weaponless
 *   ability or an explosive)
 * @param {string} [rangedSkill]  a weaponless ability's own ranged skill
 *   ("archery" | "throwing")
 * @returns {Promise<{penalty: number, tag: string|null}>}
 */
export async function consumeAttackCover(actor, weapon, rangedSkill = "") {
  const level = actor?.getFlag?.(SYSTEM_ID, COVER_FLAG) ?? null;
  if (level) await actor.unsetFlag(SYSTEM_ID, COVER_FLAG);
  if (!(level in COVER_PENALTY) || !coverApplies(weapon, rangedSkill)) {
    return { penalty: 0, tag: null };
  }
  // A weaponless Shooting ability shoots whatever is in hand; an explosive
  // (no weapon, a throw) never counts as the bow.
  const nodeWeapon = weapon ?? (rangedSkill === "archery" ? undefined : null);
  if (sharpshooterNode(actor, "ignorujeKryt", nodeWeapon)) {
    return level === "half"
      ? { penalty: 0, tag: "halfCoverIgnored" }
      : { penalty: COVER_PENALTY.half, tag: "fullCoverAsHalf" };
  }
  return {
    penalty: COVER_PENALTY[level],
    tag: level === "half" ? "halfCover" : "fullCover",
  };
}

/* -------------------------------------------- */
/*  Stráž: Střelba +10% (strazStrelba)          */
/* -------------------------------------------- */

/**
 * +10 on an Opportunity Attack shot with a bow or crossbow while the
 * Overwatch status holds (the Overwatch reaction shot).
 *
 * @param {Actor} actor
 * @param {Item|null} weapon
 * @param {boolean} opportunity
 * @returns {number}
 */
export function overwatchShotBonus(actor, weapon, opportunity) {
  if (!opportunity || !actor?.statuses?.has("overwatch")) return 0;
  return sharpshooterNode(actor, "strazStrelba", weapon) ? OVERWATCH_SHOT_BONUS : 0;
}

/* -------------------------------------------- */
/*  Míření: Ověření +5% (mireniOvereni)         */
/* -------------------------------------------- */

/**
 * +5% Precision for every Aim committed to this shot, as a synthetic attack
 * modifier for getEffectRolls (the same shape the head Aimed Attack's
 * precision rides in), or null when there is none.
 *
 * Reads the actor's `aimCount` flag: the Aim radio value the attack dialog
 * wrote on confirm. getAttackRolls banks the hit bonus from it and then
 * clears it, and getEffectRolls runs after that, so this has to be called
 * BEFORE getAttackRolls (next to getImprovedAimPenetration, which reads the
 * same flag at the same point). An Aim-neutral ability and Final Strike bank
 * nothing from the stacks, so they get nothing here either.
 *
 * @param {Actor} actor
 * @param {Item|null} weapon
 * @param {Item|null} [ability]
 * @returns {object|null}
 */
export function aimPrecisionModifier(actor, weapon, ability = null) {
  if (abilityIgnoresAim(ability) || isFinalStrike(ability)) return null;
  const stacks = Math.max(0, Number(actor?.getFlag?.(SYSTEM_ID, "aimCount")) || 0);
  if (!(stacks > 0)) return null;
  if (!sharpshooterNode(actor, "mireniOvereni", weapon)) return null;
  return {
    system: {
      effectType1: "precision",
      effects: { extra1: stacks * AIM_PRECISION_PER_STACK },
    },
  };
}

/* -------------------------------------------- */
/*  Střelecký postoj (Shooting Stance)          */
/* -------------------------------------------- */

/** Is the Shooting Stance held? */
export function hasShootingStance(actor) {
  return !!actor?.statuses?.has(SHOOTING_STANCE_STATUS);
}

/**
 * What the Shooting Stance adds to a defense roll beyond its status change
 * (Cover +10 is the `shooting_stance` status itself): Dodge +10 against a
 * Shooting attack, and with the node a further Cover +10 and Dodge +5
 * against Shooting while a bow or crossbow is in hand. Read at roll time so
 * the node follows the weapon gate.
 *
 * @param {Actor} actor
 * @param {"ranged"|"dodge"|string} mode  the defense being rolled
 * @param {object} [opts]
 * @param {boolean} [opts.shootingAttack]  the attack answered is a Shooting
 *   one (unknown, e.g. a hotbar defense answering no card, reads as false)
 * @param {Item|null} [opts.weapon]  the defender's weapon in hand
 * @returns {number}
 */
export function shootingStanceDefense(
  actor,
  mode,
  { shootingAttack = false, weapon = null } = {},
) {
  if (!hasShootingStance(actor)) return 0;
  const node = sharpshooterNode(actor, "streleckyPostoj", weapon);
  if (mode === "ranged") return node ? STANCE_NODE_COVER : 0;
  if (mode === "dodge" && shootingAttack) {
    return STANCE_DODGE + (node ? STANCE_NODE_DODGE : 0);
  }
  return 0;
}

/**
 * "Postoj se dá zrušit ... pohybem": the holder's own move ends the stance
 * (a forced move does not). Runs on the client that moved the token.
 */
function breakShootingStanceOnMove(tokenDoc, user) {
  if (user?.id !== game.user.id) return;
  if (isForcedMove(tokenDoc)) return;
  const actor = tokenDoc?.actor;
  if (!hasShootingStance(actor) || !actor.isOwner) return;
  const effects = actor.effects.filter((e) =>
    e.statuses?.has(SHOOTING_STANCE_STATUS),
  );
  if (!effects.length) return;
  const ability = stanceAbilityFor(actor, effects[0]);
  actor
    .deleteEmbeddedDocuments(
      "ActiveEffect",
      effects.map((e) => e.id),
    )
    .then(() => (ability ? postStanceCard(actor, ability, "dropped") : null))
    .catch((err) => console.error("Redsteel | Shooting Stance break failed", err));
}

/* -------------------------------------------- */
/*  Odvetný výstřel (Retaliatory Shot)          */
/* -------------------------------------------- */

/** Is this Retaliatory Shot? */
export function isRetaliatoryShot(ability) {
  return isKeyed(ability, RETALIATORY_SHOT_KEY, "Retaliatory Shot");
}

/** The item, when the actor owns it. */
export function retaliatoryShotItem(actor) {
  return abilityByKey(actor, RETALIATORY_SHOT_KEY, "Retaliatory Shot");
}

/**
 * May a Retaliatory Shot answer this attack card? "Nevztahuje se na jiný
 * Odvetný výstřel, Odvetu nebo Odvetný vrh": not a card tagged as a
 * retaliation (every retaliation, this shot included, carries the tag), nor
 * a Retaliatory Shot or Retaliatory Throw by key.
 *
 * @param {ChatMessage} message
 * @returns {boolean}
 */
export function retaliatoryShotAnswers(message) {
  const flags = message?.flags?.redsteel ?? {};
  const tags = Array.isArray(flags.attackTags) ? flags.attackTags : [];
  if (tags.includes("retaliation")) return false;
  return (
    flags.abilityKey !== RETALIATORY_SHOT_KEY &&
    flags.abilityKey !== RETALIATORY_THROW_KEY &&
    flags.abilityName !== "Retaliatory Shot" &&
    flags.abilityName !== "Retaliatory Throw"
  );
}

/** Refused before anything is paid without a bow or crossbow in hand. */
export function retaliatoryShotRefusal(actor, ability) {
  if (!isRetaliatoryShot(ability)) return null;
  const held = game.redsteel?.resolveWeaponContext?.(actor)?.weapon ?? null;
  return isShootingWeapon(held) ? null : L("RetaliatoryNoBow");
}

/* -------------------------------------------- */
/*  Zacílení (Target Lock)                      */
/* -------------------------------------------- */

/** Is this Target Lock? */
export function isTargetLock(ability) {
  return isKeyed(ability, TARGET_LOCK_KEY, "Target Lock");
}

/** The item, when the actor owns it. */
export function targetLockItem(actor) {
  return abilityByKey(actor, TARGET_LOCK_KEY, "Target Lock");
}

/**
 * The Target Lock this actor may make now, or null: the node and the item,
 * a bow or crossbow in hand, an Aim action the token still holds untouched
 * (aim.mjs lastAimAction), and no Target Lock tried on it yet.
 *
 * @param {Actor} actor
 * @returns {{item: Item, token: Token, targetId: string, stacks: number,
 *   stamp: number}|null}
 */
export function pendingTargetLock(actor) {
  const item = targetLockItem(actor);
  if (!item || !sharpshooterNode(actor, "zacileni")) return null;
  const token = tokenForActor(actor);
  const action = token ? lastAimAction(token) : null;
  if (!action) return null;
  if (token.document?.getFlag(SYSTEM_ID, TARGET_LOCK_FLAG) === action.stamp) {
    return null;
  }
  return { item, token, ...action };
}

/**
 * Use Target Lock: pay it (Free action, 2 Stamina), test Perception at -30%
 * through the ability Test Type path (`rollTest`, combatAbilities.mjs
 * rollUtilityTest), and on a success add one Aim on the aimed target. One try
 * per Aim action, success or not. Always handled: with nothing to lock onto
 * it is refused with a notification and nothing is paid.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {(actor: Actor, item: object) => Promise<{roll: Roll, html: string,
 *   label: string}|null>} rollTest
 * @returns {Promise<boolean>}
 */
export async function useTargetLock(actor, ability, rollTest) {
  const pending = pendingTargetLock(actor);
  const target = pending
    ? (pending.token.document?.parent?.tokens?.get(pending.targetId) ?? null)
    : null;
  if (!pending || !target) {
    ui.notifications.warn(L("TargetLockNothing"));
    return true;
  }
  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return true;
  await pending.token.document.setFlag(SYSTEM_ID, TARGET_LOCK_FLAG, pending.stamp);

  const title = ability.localizedName ?? ability.name;
  // The book's test, whatever the item copy says.
  const test = await rollTest(actor, {
    name: ability.name,
    localizedName: title,
    system: {
      attributeTest: "Perception",
      testModifier: TARGET_LOCK_TEST_MODIFIER,
      testAdvantage: "",
    },
  });
  const success = !!test && Number(test.roll.total) >= 0;

  let line;
  if (success) {
    const { after } = await grantAimStacks(pending.token, target, 1);
    line = L("TargetLockSuccess", {
      name: esc(actor.name),
      target: esc(target.name),
      after,
    });
  } else {
    line = L("TargetLockFail", { name: esc(actor.name), target: esc(target.name) });
  }

  // The roll is drawn into the card rather than attached, so the generic
  // Re-Roll button does not appear: a reroll could not take the Aim back.
  const rollHtml = test ? await test.roll.render() : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: pending.token.document }),
    content: rollHtml
      ? `<div class="dual-roll"><div class="roll-column"><div class="roll-label">${esc(test.label)}</div>${rollHtml}</div></div>`
      : "",
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong>${esc(title)}</strong>
</span>
<hr>
<div style="text-align:center; font-size:16px;">
${test?.html ?? ""}
<p style="text-align:center;">${line}</p>
</div>
`,
  });
  return true;
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerSharpshooterHooks() {
  // Every client: the holder's own move breaks the Shooting Stance (gated on
  // the mover inside).
  Hooks.on("moveToken", (tokenDoc, _movement, _operation, user) => {
    breakShootingStanceOnMove(tokenDoc, user);
  });
  // Target Lock's "tried" marker belongs to one aim. Once the aim is gone
  // entirely its stamp count starts over at 1, so a stale marker would block
  // the first Aim action of the next aim: drop it with the aim. Written by
  // the user whose update removed the aim, who could write the token.
  Hooks.on("updateToken", (doc, _changes, _options, userId) => {
    if (userId !== game.user.id) return;
    if (doc.getFlag(SYSTEM_ID, TARGET_LOCK_FLAG) === undefined) return;
    if (doc.getFlag(SYSTEM_ID, "aim")) return;
    doc
      .unsetFlag(SYSTEM_ID, TARGET_LOCK_FLAG)
      .catch((err) => console.error("Redsteel | Target Lock marker failed", err));
  });
}
