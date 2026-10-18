/**
 * Šampion (Champion): shared reads for the tree's off-hand nodes, the two
 * small combat nodes beside them, and the Wind Stance, Feint and Charge
 * follow-ups (end of this header).
 *
 * Every Champion bonus that depends on what is held in the off hand asks here,
 * so the "what counts as dual wielding" rule lives in one place:
 *
 *   - Characters only (actor.type === "character").
 *   - The ACTIVE weapon set holds a weapon in the main hand that is not
 *     two-handed (system.type "heavy", a bow or crossbow, or gripMode "two"),
 *     and a `weapon`-type item in the off hand that is not a shield and not a
 *     handheld light. Mirrors the isDualWield block in documents/actor.mjs and
 *     isDualWieldingMainHand in combatSkillBonuses.mjs, except that the attack
 *     side does not require the attacking weapon to be the main hand: any
 *     melee weapon attack made while dual wielding takes the bonuses.
 *   - Off-hand class is the off-hand weapon's own `system.class` ("axe" |
 *     "blunt" | "sword"; anything else earns no class bonus). Off-hand weight
 *     is its `system.type` ("light" | "medium").
 *   - Obranný katar (Defensive Katar): no pack item exists yet, so an off-hand
 *     weapon whose name, localized name or tags contain "katar" counts for the
 *     Light branch of Off-hand Bonus II.
 *
 * The three Off-hand Bonus nodes (bonusDruhaZbran1..3) are a chain and stack:
 * every unlocked tier applies.
 *
 * Beside them, the tree's attack nodes:
 *
 *   - Větrný postoj (Wind Stance, vetrnyPostoj): weapon attacks against two
 *     different enemies in one round, on or off the Champion's turn, put the
 *     `wind_stance` status on it (helpers/config.mjs: +5 melee Defense as an
 *     Active Effect change). Its +5 Hit is championWindStanceHit, read in
 *     combatSkillBonuses.mjs getAttackRolls. Counted by the createChatMessage
 *     hook in registerChampionHooks, on the active GM only.
 *   - Vylepšený klamavý útok (Improved Feint Attack, klamavyUtok): the
 *     Advantage is in getAttackRolls, the "cannot be answered" half in
 *     actionSuggestions.mjs (no Riposte, Dragon Strike or Retaliation chip),
 *     and the follow-up Attack under Wind Stance is settleChampionFeint,
 *     called from applyDamage.mjs. The rule belongs to the ability, so any
 *     actor using it qualifies, node or not.
 *   - Útok po Zteči (utokPoZteci): grantChargeFollowUp, called from
 *     combatAbilities.mjs right after a charge's first attack card.
 *
 * And the two pushes (end of this file):
 *
 *   - Zatlačení (Push Back, zatlaceni): the modifier's test is not rolled on
 *     the attack card. The card carries `flags.redsteel.pushBack` and a
 *     Push Back button; the click rolls the test, with Advantage when the
 *     attack hit, and the GM hook resolves the defender's answer (push, then
 *     the attacker follows into the vacated hex).
 *   - Bonus za druhou zbraň III, Blunt: offerChampionRestaggerPush, called
 *     from applyDamage.mjs, posts a "Push back" button per target that was
 *     already staggered and got staggered again.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { isCharge } from "./abilityMovement.mjs";
import { grantFreeAttack, trackedCombat } from "./actionTracker.mjs";
import { isHostileSide } from "./movementZones.mjs";
// Circular through forcedMovement.mjs → applyDamage.mjs → this file. Every
// import below is only touched at call time, never while modules evaluate.
import {
  isImmovable,
  pushToken,
  requestForcedMovement,
  teleportToken,
  versusOutcome,
} from "./forcedMovement.mjs";
import { renderMarginFollowupLine } from "./attributeFollowup.mjs";
import { resolveTestRating } from "./testRating.mjs";
import {
  tagRollItemAdvantage,
  tagRollSkill,
  withRollBias,
} from "./rollAdvantage.mjs";

/* -------------------------------------------- */
/*  Rule constants                              */
/* -------------------------------------------- */

const SPEC_ID = "champion";

// Bonus za druhou zbraň I (by off-hand class).
/** Axe: "Krvácení +10%". */
export const CHAMPION_AXE_BLEED = 10;
/** Blunt: "Průbojnost +3". */
export const CHAMPION_BLUNT_PENETRATION = 3;
/** Sword: "Kritická obrana a Kritická šance na Úhyb +3%". */
export const CHAMPION_SWORD_CRIT_DEFENSE_I = 3;

// Bonus za druhou zbraň II (by off-hand weight).
/** Medium: "Průbojnost +1". */
export const CHAMPION_MEDIUM_PENETRATION = 1;
/** Medium: "+1d6 zranění do Zběsilého útoku". */
export const CHAMPION_MEDIUM_RECKLESS_DICE = "1d6";
/** Medium: "+2d4 zranění do Zteče". */
export const CHAMPION_MEDIUM_CHARGE_DICE = "2d4";

// Bonus za druhou zbraň III (by off-hand class).
/** Axe: "Kritický rozsah +2". */
export const CHAMPION_AXE_CRIT_RANGE = 2;
/** Axe: "Kritické zranění/Průbojnost +5". */
export const CHAMPION_AXE_CRIT_DAMAGE = 5;
/** Blunt: "Omráčení +5%" (stagger). The push on re-staggering is offerChampionRestaggerPush. */
export const CHAMPION_BLUNT_STAGGER = 5;
/** Sword: "Kritická obrana a Kritická šance na Úhyb +2%". */
export const CHAMPION_SWORD_CRIT_DEFENSE_III = 2;
/** Sword: "Ověření +10%" (precision). */
export const CHAMPION_SWORD_PRECISION = 10;

/** Smršť útoků: Zásah +5%. */
export const CHAMPION_FLURRY_HIT = 5;

/** Melee flurry abilities. Flurry of Throws is deliberately not one. */
const FLURRY_KEYS = new Set(["REDSTEEL.Items.Flurry.name"]);
const RECKLESS_STRIKE_KEY = "REDSTEEL.Items.RecklessStrike.name";

const OFFHAND_CLASSES = ["axe", "blunt", "sword"];

/* -------------------------------------------- */
/*  Node and off-hand reads                     */
/* -------------------------------------------- */

/** True when the character has unlocked this Champion node. */
export function hasChampionNode(actor, nodeId) {
  if (!actor) return false;
  return actorHasSpecNode(actor, SPEC_ID, nodeId);
}

/**
 * Is this off-hand item a Defensive Katar? Matched by name, localized name or
 * tag, since no pack item carries the weapon yet.
 * @param {Item} item
 */
function isKatar(item) {
  const haystack = [item?.name, item?.localizedName, item?.system?.tags]
    .map((s) => String(s ?? "").toLowerCase())
    .join(" ");
  return haystack.includes("katar");
}

/**
 * The off-hand weapon of a genuinely dual-wielding character, or null.
 * @param {Actor} actor
 * @returns {{item: Item, weight: string|null, cls: string|null, katar: boolean}|null}
 */
export function getChampionOffhand(actor) {
  if (actor?.type !== "character") return null;
  const combat = actor.system?.combat ?? {};
  const set = combat.activeWeaponSet
    ? combat.weaponSets?.[combat.activeWeaponSet]
    : null;
  if (!set?.main || !set.off) return null;

  const mainHand = actor.items.get(set.main);
  const offHand = actor.items.get(set.off);
  if (!mainHand || !offHand) return null;
  if (mainHand.type !== "weapon") return null;
  // Only a weapon in the off hand counts: a shield or a handheld light (torch)
  // is gear, and gear never dual wields.
  if (offHand.type !== "weapon") return null;
  if (offHand.system?.shield) return null;

  const mainIsTwoHanded =
    mainHand.system?.type === "heavy" ||
    ["crossbow", "bow"].includes(mainHand.system?.class) ||
    mainHand.system?.gripMode === "two";
  if (mainIsTwoHanded) return null;

  const weight = ["light", "medium"].includes(offHand.system?.type)
    ? offHand.system.type
    : null;
  const cls = OFFHAND_CLASSES.includes(offHand.system?.class)
    ? offHand.system.class
    : null;
  return { item: offHand, weight, cls, katar: isKatar(offHand) };
}

/** A melee weapon attack: a weapon that is not a bow, crossbow or a throw. */
function isMeleeWeaponAttack(weapon) {
  if (!weapon) return false;
  const ws = weapon.system ?? {};
  if (["bow", "crossbow"].includes(ws.class)) return false;
  if (ws.thrown) return false;
  return true;
}

/**
 * Everything the Off-hand Bonus chain grants right now, summed over the
 * unlocked tiers. The attack half (penetration, crit range, crit damage and
 * penetration, extra effects) is zero unless `weapon` is a melee weapon; the
 * defense half (critDefense, critDodge) ignores `weapon`.
 * @param {Actor} actor
 * @param {Item|null} weapon  the weapon making the attack, if any
 */
export function getChampionOffhandMods(actor, weapon = null) {
  const out = {
    penetrationBonus: 0,
    critRangeBonus: 0,
    critDamage: 0,
    critPenetration: 0,
    extraEffects: {},
    critDefense: 0,
    critDodge: 0,
  };
  const tier1 = hasChampionNode(actor, "bonusDruhaZbran1");
  const tier2 = hasChampionNode(actor, "bonusDruhaZbran2");
  const tier3 = hasChampionNode(actor, "bonusDruhaZbran3");
  if (!tier1 && !tier2 && !tier3) return out;

  const off = getChampionOffhand(actor);
  if (!off) return out;

  const melee = isMeleeWeaponAttack(weapon);
  const addEffect = (key, value) => {
    out.extraEffects[key] = (out.extraEffects[key] ?? 0) + value;
  };

  if (tier1) {
    if (off.cls === "axe" && melee) addEffect("bleed", CHAMPION_AXE_BLEED);
    if (off.cls === "blunt" && melee)
      out.penetrationBonus += CHAMPION_BLUNT_PENETRATION;
    if (off.cls === "sword") {
      out.critDefense += CHAMPION_SWORD_CRIT_DEFENSE_I;
      out.critDodge += CHAMPION_SWORD_CRIT_DEFENSE_I;
    }
  }

  // The Light / Katar branch of tier II is the reroll pool (rerolls.mjs) and
  // the dice are championAbilityDamage below; only the penetration is here.
  if (tier2 && off.weight === "medium" && melee) {
    out.penetrationBonus += CHAMPION_MEDIUM_PENETRATION;
  }

  if (tier3) {
    if (off.cls === "axe" && melee) {
      out.critRangeBonus += CHAMPION_AXE_CRIT_RANGE;
      out.critDamage += CHAMPION_AXE_CRIT_DAMAGE;
      out.critPenetration += CHAMPION_AXE_CRIT_DAMAGE;
    }
    if (off.cls === "blunt" && melee)
      addEffect("stagger", CHAMPION_BLUNT_STAGGER);
    if (off.cls === "sword") {
      out.critDefense += CHAMPION_SWORD_CRIT_DEFENSE_III;
      out.critDodge += CHAMPION_SWORD_CRIT_DEFENSE_III;
      if (melee) addEffect("precision", CHAMPION_SWORD_PRECISION);
    }
  }

  return out;
}

/**
 * Is the Light branch of Off-hand Bonus II live: a Light weapon or a
 * Defensive Katar in the off hand while dual wielding? Read at reroll time.
 * @param {Actor} actor
 */
export function championLightOffhand(actor) {
  const off = getChampionOffhand(actor);
  return !!off && (off.weight === "light" || off.katar);
}

/**
 * Extra damage dice an ability earns from Off-hand Bonus II, Medium branch:
 * "+1d6" on Reckless Strike, "+2d4" on any charge. "" otherwise.
 * @param {Actor} actor
 * @param {Item|null} ability
 * @returns {string}
 */
export function championAbilityDamage(actor, ability) {
  if (!ability) return "";
  if (!hasChampionNode(actor, "bonusDruhaZbran2")) return "";
  if (getChampionOffhand(actor)?.weight !== "medium") return "";
  if (ability.system?.localizationKey === RECKLESS_STRIKE_KEY) {
    return CHAMPION_MEDIUM_RECKLESS_DICE;
  }
  if (isCharge(ability)) return CHAMPION_MEDIUM_CHARGE_DICE;
  return "";
}

/**
 * Smršť útoků: Zásah +5% on each attack of the melee Flurry.
 * @param {Actor} actor
 * @param {Item|null} ability
 * @returns {number}
 */
export function championFlurryHit(actor, ability) {
  if (!ability) return 0;
  if (!FLURRY_KEYS.has(ability.system?.localizationKey)) return 0;
  return hasChampionNode(actor, "smrstUtoku") ? CHAMPION_FLURRY_HIT : 0;
}

/* -------------------------------------------- */
/*  Wind Stance, Feint, Charge follow-ups       */
/* -------------------------------------------- */

const SYSTEM_ID = "redsteel";

/** Status id of Wind Stance (helpers/config.mjs effectDefinitions). */
export const WIND_STANCE_STATUS = "wind_stance";
/** Větrný postoj: Zásah +5% (the Defense half is the status's own change). */
export const CHAMPION_WIND_STANCE_HIT = 5;
/** Distinct enemies attacked in one round that bring the stance on. */
const WIND_STANCE_TARGETS = 2;

/** Both action costs of Improved Feint Attack. */
export const FEINT_ATTACK_KEYS = Object.freeze([
  "REDSTEEL.Items.ImprovedFeintAttack.name",
  "REDSTEEL.Items.ImprovedFeintAttackHastened.name",
]);

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * Is this an Improved Feint Attack? Takes the ability Item or its bare
 * localisation key (what an attack card carries as `abilityKey`).
 * @param {Item|string|null} abilityOrKey
 */
export function isFeintAttack(abilityOrKey) {
  const key =
    typeof abilityOrKey === "string"
      ? abilityOrKey
      : abilityOrKey?.system?.localizationKey;
  return FEINT_ATTACK_KEYS.includes(key);
}

/**
 * Větrný postoj: Zásah +5% on every attack while the stance holds.
 * @param {Actor} actor
 * @returns {number}
 */
export function championWindStanceHit(actor) {
  return actor?.statuses?.has(WIND_STANCE_STATUS) ? CHAMPION_WIND_STANCE_HIT : 0;
}

/**
 * Wind Stance bookkeeping for one new chat message. Only weapon attack cards
 * count: `flags.attack.type` "attack" and not a spell card (`isSpell`). A
 * rerolled card is the same attack again. The enemies it names are added to
 * the Champion's record for this round (actor flag `windStance`, reset when
 * the combat or round differs); the second distinct enemy applies the stance,
 * once per round.
 *
 * @param {ChatMessage} message
 */
async function noteWindStanceAttack(message) {
  const attack = message?.flags?.attack;
  if (attack?.type !== "attack" || attack.isSpell) return;
  if (message.flags?.redsteel?.rerolledFrom) return;
  const combat = game.combat;
  if (!combat?.started) return;

  const speaker = message.speaker ?? {};
  const scene =
    game.scenes?.get(speaker.scene) ?? combat.scene ?? canvas?.scene ?? null;
  const speakerToken = speaker.token ? (scene?.tokens.get(speaker.token) ?? null) : null;
  const actor = speakerToken?.actor ?? game.actors?.get(speaker.actor) ?? null;
  if (actor?.type !== "character") return;
  if (!hasChampionNode(actor, "vetrnyPostoj")) return;

  const targets = Array.isArray(attack.targets) ? attack.targets : [];
  // Enemies only: hostile tokens, seen from a character's side
  // (movementZones.mjs isHostileSide).
  const enemies = targets.filter((id) => {
    if (!id || id === speaker.token) return false;
    const doc = scene?.tokens.get(id);
    return !!doc && isHostileSide(doc);
  });
  if (!enemies.length) return;

  const stored = actor.getFlag(SYSTEM_ID, "windStance");
  const current =
    stored?.combatId === combat.id && Number(stored.round) === Number(combat.round)
      ? stored
      : null;
  const seen = [...new Set([...(current?.targets ?? []), ...enemies])];
  const alreadyApplied = !!current?.applied;
  const reached = !alreadyApplied && seen.length >= WIND_STANCE_TARGETS;

  await actor.setFlag(SYSTEM_ID, "windStance", {
    combatId: combat.id,
    round: combat.round,
    targets: seen,
    applied: alreadyApplied || reached,
  });
  if (!reached) return;

  const effect = await game.redsteel.applyEffect(actor, WIND_STANCE_STATUS);
  if (!effect) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: speakerToken }),
    content: `<div style="text-align:center;">${game.i18n.format(
      "REDSTEEL.Champion.WindStanceGained",
      { name: esc(actor.name) },
    )}</div>`,
  });
}

/**
 * Wind Stance watches every attack card. Single writer: the active GM, so the
 * record and the status are written once however many clients are connected.
 * Cards are handled one after another, never interleaved, so two attack cards
 * arriving together cannot both read the record before either wrote it.
 */
export function registerChampionHooks() {
  let queue = Promise.resolve();
  Hooks.on("createChatMessage", (message) => {
    if (!game.users.activeGM?.isSelf) return;
    queue = queue
      .then(() => noteWindStanceAttack(message))
      .catch((err) => console.error("Redsteel | Wind Stance tracking failed", err))
      // Same single writer, same queue: a defender's answer to a Push Back
      // test is settled after any card that arrived before it.
      .then(() => resolvePushBackAnswer(message))
      .catch((err) => console.error("Redsteel | Push Back resolution failed", err));
  });

  // Rendered at ready, after the hooks that build the card's Apply Damage and
  // Defend buttons, so the Push Back button lands beside them.
  Hooks.once("ready", () => {
    Hooks.on("renderChatMessageHTML", (message, html) => {
      renderPushBackButton(message, html);
      wireRestaggerButtons(message, html);
    });
    game.socket.on(SOCKET, (data) => {
      if (data?.type !== RESTAGGER_SOCKET_TYPE) return;
      if (!game.users.activeGM?.isSelf) return;
      runRestaggerPush(data).catch((err) =>
        console.error("Redsteel | Re-stagger push failed", err),
      );
    });
  });
}

/**
 * Improved Feint Attack: "Pokud má aktivní Větrný postoj a zasáhne, může ihned
 * provést Útok na stejný cíl." Apply Damage landed a feint card while the
 * attacker holds Wind Stance: the next plain Attack this round is free
 * (actionTracker.mjs grantFreeAttack), aimed at the target that was hit.
 * Once per card, stamped on the message, so applying it again grants nothing.
 * Runs on the GM applying the damage.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message   the attack card
 * @param {string[]} targetIds    token ids the damage was applied to
 * @param {Scene|null} scene
 */
export async function settleChampionFeint(attacker, message, targetIds = [], scene = null) {
  if (!attacker || !message) return;
  if (!isFeintAttack(message.flags?.redsteel?.abilityKey ?? null)) return;
  // "Pokud má aktivní Větrný postoj": the stance must already hold when the
  // feint is made, so a feint that is itself the second enemy (and so earns
  // the stance) does not buy its own follow-up. A refresh keeps the effect's
  // creation time, so an older stance still counts.
  const stance = attacker.effects.find((e) =>
    e.statuses?.has(WIND_STANCE_STATUS),
  );
  const stanceSince = Number(stance?._stats?.createdTime) || 0;
  if (!stance || !(stanceSince < (Number(message.timestamp) || 0))) return;
  if (message.getFlag(SYSTEM_ID, "feintFollowUp")) return;
  if (!trackedCombat(attacker)) return;

  const selfId = message.speaker?.token ?? null;
  const targetDoc = targetIds
    .filter((id) => id && id !== selfId)
    .map((id) => scene?.tokens.get(id))
    .find((doc) => doc?.actor);
  if (!targetDoc) return;

  await message.setFlag(SYSTEM_ID, "feintFollowUp", true);
  await grantFreeAttack(attacker, targetDoc.id);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker }),
    content: `<div style="text-align:center;">${game.i18n.format(
      "REDSTEEL.Champion.FeintFollowUp",
      { name: esc(attacker.name), target: esc(targetDoc.name) },
    )}</div>`,
  });
}

/**
 * Útok po Zteči: after the attack card of any charge, hit or miss, the
 * Champion's next plain Attack this round is a Free action. The caller
 * (combatAbilities.mjs) calls this for a charge's first card only, so a
 * Charge with Cleave grants and posts once.
 *
 * @param {Actor} actor
 * @param {Item|null} ability
 * @param {ChatMessage|null} message  the charge's attack card
 */
export async function grantChargeFollowUp(actor, ability, message) {
  if (!actor || !isCharge(ability)) return;
  if (!hasChampionNode(actor, "utokPoZteci")) return;
  if (!trackedCombat(actor)) return;
  const selfId = message?.speaker?.token ?? null;
  const targets = Array.isArray(message?.flags?.attack?.targets)
    ? message.flags.attack.targets
    : [];
  const targetId = targets.find((id) => id && id !== selfId);
  if (!targetId) return;

  await grantFreeAttack(actor, targetId);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div style="text-align:center;">${game.i18n.format(
      "REDSTEEL.Champion.ChargeFollowUp",
      { name: esc(actor.name) },
    )}</div>`,
  });
}

/* -------------------------------------------- */
/*  Zatlačení (Push Back)                       */
/* -------------------------------------------- */

const SOCKET = "system.redsteel";

/** Both Push Back modifiers, by localisation key. */
const PUSH_BACK_KEYS = Object.freeze([
  "REDSTEEL.Items.PushBackStrength.name",
  "REDSTEEL.Items.PushBackDexterity.name",
]);
/** English pack names, the fallback for a hand-made copy with no key. */
const PUSH_BACK_NAMES = Object.freeze({
  "Push Back (Strength)": "REDSTEEL.Items.PushBackStrength.name",
  "Push Back (Dexterity)": "REDSTEEL.Items.PushBackDexterity.name",
});
/** Who the Push Back test may be answered with when the item names nobody. */
const PUSH_BACK_AGAINST = "str,dex";

/**
 * Is this attack modifier one of the Push Back abilities? Its test is not
 * rolled on the attack card (see pushBackStampFor).
 * @param {Item|null} mod
 */
export function isPushBackModifier(mod) {
  const key = mod?.system?.localizationKey || PUSH_BACK_NAMES[mod?.name] || null;
  return !!key && PUSH_BACK_KEYS.includes(key);
}

/**
 * What the attack card stores for a selected Push Back modifier
 * (`flags.redsteel.pushBack`), or null when none is selected. The test waits
 * for the button, because the Advantage depends on whether the blow hit and
 * that is only known once the attack is resolved.
 *
 * @param {Item[]} modifiers   the selected attack modifiers
 * @param {(item: Item) => string} [againstFor]  attributeFollowup.mjs versusAgainstFor
 * @returns {{attribute:string, testModifier:number, source:string, against:string}|null}
 */
export function pushBackStampFor(modifiers = [], againstFor = null) {
  const mod = modifiers.find((m) => isPushBackModifier(m));
  if (!mod) return null;
  return {
    attribute: String(mod.system?.attributeTest ?? ""),
    testModifier: Number(mod.system?.testModifier) || 0,
    source: mod.localizedName ?? mod.name,
    against: (againstFor ? againstFor(mod) : "") || PUSH_BACK_AGAINST,
  };
}

/** A token document's centre, from its footprint (forcedMovement.mjs reads it the same way). */
function centerOfToken(doc) {
  const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
  const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
  return {
    // Stored position, not the animated one (see resolvePushBackAnswer).
    x: Number(doc._source?.x ?? doc.x) + (Number(doc.width ?? 1) * sizeX) / 2,
    y: Number(doc._source?.y ?? doc.y) + (Number(doc.height ?? 1) * sizeY) / 2,
  };
}

/**
 * Did this attack hit the target? The newest defense card after the attack
 * card, by this defender against this attacker, decides: a failed defense is
 * a hit. A defense card that names the attack it answered
 * (`versusAttack.messageId`) only counts for that card. With no defense on
 * record, the attack's own margin decides (0 or more is a hit).
 *
 * @param {ChatMessage} message  the attack card
 * @param {string} attackerTokenId
 * @param {string} targetTokenId
 */
function pushBackHit(message, attackerTokenId, targetTokenId) {
  const messages = game.messages?.contents ?? [];
  const start = messages.findIndex((m) => m.id === message.id);
  for (let i = messages.length - 1; i > start; i--) {
    const flags = messages[i].flags?.redsteel;
    const defense = flags?.defense;
    if (!defense || flags.rerolledAway) continue;
    if (defense.attackerTokenId !== attackerTokenId) continue;
    if (defense.defenderTokenId !== targetTokenId) continue;
    const answered = flags.versusAttack?.messageId;
    if (answered && answered !== message.id) continue;
    return !defense.succeeded;
  }
  return Number(message.flags?.attack?.margin) >= 0;
}

/**
 * The Push Back button on the attack card: the attacker's owner rolls the
 * test. Once per card: `flags.redsteel.pushBackRolled` is stamped on the
 * attack card before the roll, by the card's author (who may update their own
 * message) or the GM, the same way Enduring Warrior marks its claim.
 *
 * @param {ChatMessage} message  the attack card
 */
async function rollPushBack(message) {
  const stamp = message.flags?.redsteel?.pushBack;
  if (!stamp || message.flags?.redsteel?.rerolledAway) return;
  if (message.flags?.redsteel?.pushBackRolled) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Champion.PushBackUsed"));
    return;
  }

  const speaker = message.speaker ?? {};
  const scene = game.scenes?.get(speaker.scene) ?? canvas?.scene ?? null;
  const attackerDoc = speaker.token ? (scene?.tokens.get(speaker.token) ?? null) : null;
  const actor = attackerDoc?.actor ?? null;
  if (!attackerDoc || !actor) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.ForcedMovement.NoAttacker"));
    return;
  }
  if (!actor.isOwner) return;

  const targets = Array.isArray(message.flags?.attack?.targets)
    ? message.flags.attack.targets
    : [];
  const targetId = targets.find((id) => id && id !== attackerDoc.id) ?? null;
  const targetDoc = targetId ? (scene.tokens.get(targetId) ?? null) : null;
  if (!targetDoc) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Champion.PushBackNoTarget"));
    return;
  }

  // Mark first: a double click must not roll twice.
  try {
    await message.setFlag(SYSTEM_ID, "pushBackRolled", true);
  } catch (err) {
    console.warn("Redsteel | Could not mark the Push Back roll", err);
    return;
  }

  const hit = pushBackHit(message, attackerDoc.id, targetDoc.id);

  // Rolled exactly as the attack card's modifier tests are (combatAbilities.mjs
  // "Append modifier attribute tests"), with the Advantage of a hit.
  const { value, skillKey } = resolveTestRating(actor, stamp.attribute);
  const chance = Number(value) + (Number(stamp.testModifier) || 0);
  const roll = new Roll(`(${chance}) - 1d100`, withRollBias({}, actor));
  tagRollSkill(roll, skillKey);
  tagRollItemAdvantage(roll, hit ? "advantage" : null);
  await roll.evaluate();

  const source = stamp.source ?? "";
  const advantageLine = game.i18n.localize(
    hit ? "REDSTEEL.Champion.PushBackAdvantage" : "REDSTEEL.Champion.PushBackNoAdvantage",
  );
  const flavor = `<p class="rs-card-headline"><b>${esc(
    game.i18n.localize("REDSTEEL.Champion.PushBackTitle"),
  )}</b></p>
<p style="text-align:center;">${esc(advantageLine)}</p>
${renderMarginFollowupLine({
  margin: roll.total,
  source,
  chance,
  result: roll.result,
  against: stamp.against || PUSH_BACK_AGAINST,
  heading: esc(source),
})}`;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor, token: attackerDoc }),
    flavor,
    flags: {
      redsteel: {
        // The reroll (redsteel.mjs executeReroll) rebuilds the margin line
        // from rollName + versusTest, so its data-source stays the same and
        // an answer to the rerolled card still matches. pushBackTest rides
        // across on REROLL_CARRIED_FLAGS.
        rollName: source,
        skill: skillKey,
        versusTest: true,
        versusChance: chance,
        pushBackTest: {
          attackMessageId: message.id,
          attackerTokenId: attackerDoc.id,
          targetTokenId: targetDoc.id,
          sceneId: scene.id,
        },
      },
    },
  });
}

/**
 * Put the Push Back button on an attack card that carries the stamp. Same
 * audience as the card's own Apply Damage button: whoever posted it, plus the
 * GM. Grey once rolled.
 */
function renderPushBackButton(message, html) {
  const flags = message.flags?.redsteel ?? {};
  if (!flags.pushBack || flags.rerolledAway) return;
  if (message.flags?.attack?.type !== "attack") return;
  if (!game.user.isGM && message.author?.id !== game.user.id) return;
  if (html.querySelector(".rs-push-back-button")) return;

  let container = html.querySelector(".button-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "button-container";
    html.querySelector(".message-content")?.appendChild(container);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rs-push-back-button";
  button.dataset.messageId = message.id;
  button.textContent = game.i18n.localize("REDSTEEL.Champion.PushBackButton");
  button.dataset.tooltip = game.i18n.localize("REDSTEEL.Champion.PushBackTooltip");
  button.disabled = !!flags.pushBackRolled;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    button.disabled = true;
    await rollPushBack(message);
  });
  container.appendChild(button);
  container.classList.toggle(
    "single",
    container.querySelectorAll("button, a.button").length <= 1,
  );
}

/** The margin and source a card's `.mos-followup` line posts, or null. */
function marginLineOf(message) {
  const html = `${message?.flavor ?? ""}${message?.content ?? ""}`;
  const span = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector(".mos-followup");
  if (!span) return null;
  const margin = Number(span.dataset.margin);
  if (!Number.isFinite(margin)) return null;
  return { margin, source: span.dataset.source ?? "" };
}

/** How far back in the log an answer looks for its Push Back test. */
const PUSH_BACK_LOOKBACK = 200;

/**
 * A defender's versus answer arrived (`flags.redsteel.versusFollowup`). If it
 * answers a Push Back test card, settle the contest: once per test card,
 * stamped `pushBackResolved` before anything moves. Active GM only, through
 * the registerChampionHooks queue.
 *
 * The test card is the newest earlier one with `pushBackTest` (not retired by
 * a reroll) whose margin line matches the answer's margin and source. Its
 * outcome is read with forcedMovement.mjs versusOutcome, so the same tie rule
 * holds as for Shove: an answer total of 0 or below is the attacker's win.
 *
 * @param {ChatMessage} message
 */
async function resolvePushBackAnswer(message) {
  const followup = message?.flags?.redsteel?.versusFollowup;
  if (!followup) return;
  const messages = game.messages?.contents ?? [];
  const index = messages.findIndex((m) => m.id === message.id);
  if (index < 0) return;

  let test = null;
  const stop = Math.max(0, index - PUSH_BACK_LOOKBACK);
  for (let i = index - 1; i >= stop; i--) {
    const flags = messages[i].flags?.redsteel;
    if (!flags?.pushBackTest || flags.rerolledAway) continue;
    const line = marginLineOf(messages[i]);
    if (!line) continue;
    if (line.margin !== Number(followup.margin)) continue;
    if (line.source !== (followup.source ?? "")) continue;
    test = messages[i];
    break;
  }
  // Already settled: a rerolled answer arrives too late to change the push.
  if (!test || test.flags.redsteel.pushBackResolved) return;
  const outcome = versusOutcome(test);
  if (!outcome) return;

  await test.setFlag(SYSTEM_ID, "pushBackResolved", true);

  const pb = test.flags.redsteel.pushBackTest;
  const scene = game.scenes?.get(pb.sceneId) ?? null;
  const targetDoc = scene?.tokens.get(pb.targetTokenId) ?? null;
  const attackerDoc = scene?.tokens.get(pb.attackerTokenId) ?? null;
  if (!targetDoc || !attackerDoc) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.ForcedMovement.NoAttacker"));
    return;
  }
  const attacker = attackerDoc.actor ?? null;
  const names = { target: esc(targetDoc.name), attacker: esc(attackerDoc.name) };
  const post = (key) =>
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker, token: attackerDoc }),
      content: `<div style="text-align:center;">${game.i18n.format(key, names)}</div>`,
    });

  if (!outcome.attackerWon) {
    await post("REDSTEEL.Champion.PushBackLost");
    return;
  }

  // The vacated hex, read before the push.
  const oldCenter = centerOfToken(targetDoc);
  // Stored position: the live x/y trail the canvas animation, which stalls
  // while the GM's Foundry tab is in the background.
  const before = { x: Number(targetDoc._source.x), y: Number(targetDoc._source.y) };
  const label = marginLineOf(test)?.source ?? "";
  const pushed = await pushToken(targetDoc, attackerDoc, {
    distance: 1,
    label,
    sourceActor: attacker,
  });
  const moved = Number(pushed?.moved) || 0;
  const left =
    moved > 0 ||
    Number(targetDoc._source.x) !== before.x ||
    Number(targetDoc._source.y) !== before.y;
  if (!left) {
    await post("REDSTEEL.Champion.PushBackBlocked");
    return;
  }

  // "Útočník se musí pohnout rovněž": the attacker steps into the vacated hex.
  // teleportToken lands exactly on that hex and moves through withForcedFlag,
  // so no Opportunity Attack and no movement spent. A Rooted attacker stays.
  const followed =
    !isImmovable(attackerDoc) &&
    (await teleportToken(attackerDoc, oldCenter, { ignoreIds: [targetDoc.id] }));
  await post(
    followed ? "REDSTEEL.Champion.PushBackWon" : "REDSTEEL.Champion.PushBackNoFollow",
  );
}

/* -------------------------------------------- */
/*  Bonus za druhou zbraň III, Blunt            */
/* -------------------------------------------- */

const RESTAGGER_SOCKET_TYPE = "championRestaggerPush";

/** Status id of Stagger ("Omráčení", helpers/config.mjs effectDefinitions). */
export const STAGGER_STATUS = "stagger";

/**
 * Does this attack earn the Blunt re-stagger push? "Omráčí-li omráčený cíl,
 * může ho odsunout o jednu hexu." A weapon attack card, swung in melee, by a
 * Champion with Off-hand Bonus III and a blunt weapon in the off hand (the
 * attack-side condition of the +5% Stagger, read at Apply Damage time).
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message  the attack card
 */
function earnsRestaggerPush(attacker, message) {
  const attack = message?.flags?.attack;
  if (attack?.type !== "attack" || attack.isSpell) return false;
  if (attack.attackType !== "melee") return false;
  if (!hasChampionNode(attacker, "bonusDruhaZbran3")) return false;
  return getChampionOffhand(attacker)?.cls === "blunt";
}

/**
 * Apply Damage staggered targets that were already staggered: offer the
 * Champion a one-hex push for each, as a chat card with one button per
 * target. Runs on the GM applying the damage (applyDamage.mjs). The attacker
 * does not follow.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message       the attack card
 * @param {string[]} restaggeredIds   targets staggered again by this apply
 * @param {Scene|null} scene
 */
export async function offerChampionRestaggerPush(
  attacker,
  message,
  restaggeredIds = [],
  scene = null,
) {
  if (!attacker || !message || !scene || !restaggeredIds.length) return;
  if (!earnsRestaggerPush(attacker, message)) return;
  const attackerTokenId = message.speaker?.token ?? null;
  const attackerDoc = attackerTokenId ? (scene.tokens.get(attackerTokenId) ?? null) : null;
  if (!attackerDoc) return;
  const targets = [...new Set(restaggeredIds)]
    .filter((id) => id && id !== attackerTokenId)
    .map((id) => scene.tokens.get(id))
    .filter(Boolean);
  if (!targets.length) return;

  const attackerName = esc(attackerDoc.name);
  const title = game.i18n.localize("REDSTEEL.Champion.RestaggerPushTitle");
  const buttonLabel = esc(game.i18n.localize("REDSTEEL.Champion.RestaggerPushButton"));
  const rows = targets
    .map(
      (t) => `<p style="text-align:center;">${game.i18n.format(
        "REDSTEEL.Champion.RestaggerPush",
        { target: esc(t.name), attacker: attackerName },
      )}</p>
<div class="button-container single"><button type="button" class="rs-restagger-push-button" data-token-id="${esc(t.id)}">${buttonLabel}</button></div>`,
    )
    .join("");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: attacker, token: attackerDoc }),
    content: `<p class="rs-card-headline"><b>${esc(title)}</b></p>${rows}`,
    flags: {
      redsteel: {
        restaggerPush: {
          sceneId: scene.id,
          attackerTokenId,
          targets: targets.map((t) => t.id),
          pushed: {},
        },
      },
    },
  });
}

/**
 * Wire the per-target buttons on a re-stagger card. Usable by the GM and the
 * attacker's owners; removed for everyone else. A pushed target's button
 * stays grey (`restaggerPush.pushed.<tokenId>`).
 */
function wireRestaggerButtons(message, html) {
  const data = message.flags?.redsteel?.restaggerPush;
  if (!data) return;
  const scene = game.scenes?.get(data.sceneId) ?? null;
  const attackerActor = scene?.tokens.get(data.attackerTokenId)?.actor ?? null;
  const allowed = game.user.isGM || !!attackerActor?.isOwner;
  for (const button of html.querySelectorAll(".rs-restagger-push-button")) {
    if (!allowed) {
      button.closest(".button-container")?.remove();
      continue;
    }
    const tokenId = button.dataset.tokenId;
    button.disabled = !!data.pushed?.[tokenId];
    button.addEventListener("click", (event) => {
      event.preventDefault();
      button.disabled = true;
      const payload = {
        type: RESTAGGER_SOCKET_TYPE,
        messageId: message.id,
        tokenId,
        userId: game.user.id,
      };
      if (game.users.activeGM?.isSelf) {
        runRestaggerPush(payload).catch((err) =>
          console.error("Redsteel | Re-stagger push failed", err),
        );
      } else {
        game.socket.emit(SOCKET, payload);
      }
    });
  }
}

/**
 * The GM end of a re-stagger button: once per target, stamp the card, then
 * push one hex away from the attacker through the forced movement relay.
 */
async function runRestaggerPush({ messageId, tokenId, userId }) {
  const message = game.messages?.get(messageId);
  const data = message?.flags?.redsteel?.restaggerPush;
  if (!data || !tokenId || !data.targets?.includes(tokenId)) return;
  if (data.pushed?.[tokenId]) return;
  const scene = game.scenes?.get(data.sceneId) ?? null;
  const attackerDoc = scene?.tokens.get(data.attackerTokenId) ?? null;
  const user = game.users.get(userId);
  if (!user) return;
  if (!user.isGM && !attackerDoc?.actor?.testUserPermission(user, "OWNER")) return;

  await message.update({ [`flags.redsteel.restaggerPush.pushed.${tokenId}`]: true });
  await requestForcedMovement({
    op: "push",
    sceneId: data.sceneId,
    tokenId,
    fromTokenId: data.attackerTokenId,
    distance: 1,
    label: game.i18n.localize("REDSTEEL.Champion.RestaggerPushTitle"),
  });
}
