/**
 * Harcovník (Skirmisher), batch 2: the node rules that live outside node
 * passives and outside the Re-arm family (rearm.mjs) and Aim loss (aim.mjs).
 * Rulebook: docs/rules-source/rules/specializace-wip.md r203-r231, base
 * actions in ruzne-info.md.
 *
 * - Harcovníkův um (harcovnikuvUm): Peltast follows Shieldbearer. A rank
 *   mirror (helpers/rankMirrors.mjs, `auto`), nothing here.
 * - Krycí postoj (kryciPostoj, Covering Stance): "Dokud postoj trvá, může
 *   použít Reakci, aby se v případě nepřátelské střelby pohnul až o
 *   Rychlost*1 hex do dráhy projektilu a následně použil akci Ochrana jako
 *   Volnou akci. Udržování postoje stojí jednu akci." The stance is the
 *   `covering_stance` status, held per turn like any maintained stance
 *   (stances.mjs: 1 Action and 1 Stamina). While it holds, an enemy ranged or
 *   thrown attack card at an ally offers a Cover chip (actionSuggestions.mjs).
 *   The order: useCoverStep pays the Reaction, notes the pending cover on the
 *   actor (flags.redsteel.skirmisherCover) and grants a Speed-long bonus step
 *   that may only END next to the ally (the lock's `around`); the strip's
 *   check button runs completeCoverStep, which applies Guard (`guard`) free
 *   and links it to the ally (protection.mjs startProtection) with the attack
 *   card named, so that card gets its Protect button: the holder answers the
 *   shot with Cover at -10.
 * - Odvetný vrh (odvetnyVrh, Retaliatory Throw): a Reaction chip after the
 *   holder's Cover; full damage after a held Cover, half after a failed one
 *   (retaliatoryThrowHalf, read in combatAbilities.mjs runAttackMacro);
 *   thrown weapons only; tagged "retaliation"; Aim-neutral (aim.mjs).
 * - Navazující vrh (navazujiciVrh, Follow-up Throw): after a kill, a chip
 *   (offerFollowUpThrow from Apply Damage, the Momentum pattern) that pays 3
 *   Stamina, re-arms to a thrown weapon for free and makes the next Attack
 *   this turn a Free action.
 * - Po vrhu získává jedno Míření (mireniPoVrhu): every thrown attack card
 *   with a single target adds one Aim on it (onThrowCard).
 * - Po vrhu může vždy provést Pomalý pohyb (pohybPoVrhu, user ruling
 *   2026-10-19): after a throw on its own turn the holder may declare one
 *   Slow Movement even after moving; it still costs its Action.
 * - Přesný výstřel: -1 akce a -5 Výdrže (presnyVystrel): the cheaper
 *   "Accurate Shot (Skirmisher)" item (abilityGrants.mjs). Accurate Shot's own
 *   rules for everyone: a margin of 30 or more is a Critical Hit, and every
 *   Aim committed to the shot adds +1 Critical Range.
 * - Lehká zbroj: Oddech obnovuje o 1 výdrž více (lehkaZbroj): every Rest
 *   restores 1 more Stamina while the topmost armor layer is light.
 * - Vrh s rozběhem: Pohyb +50% a Průraznost +1d6 (vrhSRozbehem): Run Up
 *   Throw's approach is automated for everyone like a Charge's (a declared
 *   `runUp` move, then the strip's check button throws): at least 2 hexes,
 *   and every hex past the 2 the item's +2d4 already pays adds +1d4. The node
 *   makes the run Speed x1.5 and adds +1d6 Breakthrough.
 * - Zběsilý vrh: Zatížení štítu +25% (zbesilyVrh): Frenzied Throw carries
 *   +25 shield strain on its card (combatSkillBonuses.mjs getEffectRolls).
 * - Zmrzačující výstřel: 50% na zbavení pohybu (zmrzacujiciVystrel) and
 *   Vylepšený zmrzačující výstřel (vylZmrzacujici), with Crippling Shot's own
 *   rules for everyone: cripplingShotEffects (user rulings 2026-10-20).
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import {
  getMovementLock,
  getSpent,
  grantBonusStep,
  grantFreeAttack,
  isTrackedTurn,
  lockMovement,
  markBonusSource,
  trackedCombat,
} from "./actionTracker.mjs";
import { abilityIgnoresAim, grantAimStacks } from "./aim.mjs";
import { notePaidStamina } from "./enduringWarrior.mjs";
import {
  isHostileSide,
  movementBudget,
  tokenForActor,
  tokenMovementSpent,
} from "./movementZones.mjs";
import { attackerTokenIdFromMessage } from "./overwhelm.mjs";
import { areAdjacent } from "./positioning.mjs";
import {
  mainHandWeapon,
  pickRearmWeapon,
  rearmCandidates,
  swapMainWeapon,
} from "./rearm.mjs";
import { getTopArmorWeight } from "./weaponMaster.mjs";

const SYSTEM_ID = "redsteel";
const SPEC = "skirmisher";

export const COVERING_STANCE_STATUS = "covering_stance";
export const RETALIATORY_THROW_KEY = "REDSTEEL.Items.RetaliatoryThrow.name";
export const FOLLOW_UP_THROW_KEY = "REDSTEEL.Items.FollowUpThrow.name";
const DARING_THROW_KEY = "REDSTEEL.Items.DaringThrow.name";

/** Accurate Shot and the Skirmisher's cheaper copy. */
const ACCURATE_SHOT = Object.freeze([
  { key: "REDSTEEL.Items.AccurateShot.name", name: "Accurate Shot" },
  {
    key: "REDSTEEL.Items.AccurateShotSkirmisher.name",
    name: "Accurate Shot (Skirmisher)",
  },
]);
/** "Snižuje hranici pro Kritický zásah na Úspěch o síle +30." */
export const ACCURATE_SHOT_CRIT_MARGIN = 30;

const RUN_UP_THROW = Object.freeze({
  key: "REDSTEEL.Items.RunUpThrow.name",
  name: "Run Up Throw",
});
/** "Musí se pohnout alespoň o dvě hexy." */
export const RUN_UP_MIN_HEXES = 2;
/** Vrh s rozběhem: Pohyb +50%. */
const RUN_UP_NODE_MOVE = 1.5;
/** Vrh s rozběhem: Průraznost +1d6. */
const RUN_UP_NODE_BREAKTHROUGH = "1d6";

const FRENZIED_THROW = Object.freeze({
  key: "REDSTEEL.Items.FrenziedThrow.name",
  name: "Frenzied Throw",
});
/** Zběsilý vrh: Zatížení štítu +25%. */
export const FRENZIED_THROW_STRAIN = 25;

/** Lehká zbroj: one more Stamina per Rest. */
export const LIGHT_ARMOR_REST_BONUS = 1;

/** Actor flags. */
const COVER_FLAG = "skirmisherCover";
const FOLLOW_UP_FLAG = "skirmisherFollowUp";
const THROW_SLOW_FLAG = "skirmisherThrowSlow";
/** Card flag: this card already offered a Follow-up Throw. */
const FOLLOW_UP_OFFERED = "followUpThrowOffered";

const FALLEN_STATUSES = ["dead", "dying", "downed", "unconscious"];

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.Skirmisher.${key}`, data)
    : game.i18n.localize(`REDSTEEL.Skirmisher.${key}`);

/* -------------------------------------------- */
/*  Shared                                      */
/* -------------------------------------------- */

/** Does this character hold this Skirmisher node? */
export function hasSkirmisherNode(actor, node) {
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

function abilityByKey(actor, key, name) {
  return (
    actor?.items?.find((i) => i.type === "ability" && isKeyed(i, key, name)) ??
    null
  );
}

/** A thrown weapon (javelin, throwing knife, throwing axe ...). */
export function isThrownWeapon(item) {
  return item?.type === "weapon" && item.system?.thrown === true && !item.system?.shield;
}

/** Every thrown weapon the actor carries. */
export function thrownWeapons(actor) {
  return actor?.items?.filter(isThrownWeapon) ?? [];
}

/** Ids of every token standing in for this actor on the canvas. */
function actorTokenIds(actor) {
  return new Set(
    actor?.isToken
      ? [actor.token?.id].filter(Boolean)
      : (actor?.getActiveTokens?.(false, true) ?? []).map((t) => t.id),
  );
}

async function postLines(actor, title, lines) {
  const token = tokenForActor(actor);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
    flavor: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
${lines.map((line) => `<p style="text-align:center;">${line}</p>`).join("\n")}`,
  });
}

/* -------------------------------------------- */
/*  Thrown attack cards (mireniPoVrhu, pohybPoVrhu) */
/* -------------------------------------------- */

/** The token and actor an attack card speaks for, on its own scene. */
function cardAttacker(message) {
  const scene =
    game.scenes?.get(message?.speaker?.scene) ?? canvas?.scene ?? null;
  const tokenId = attackerTokenIdFromMessage(message);
  const token = tokenId ? (scene?.tokens?.get(tokenId) ?? null) : null;
  const actor = token?.actor ?? game.actors?.get(message?.speaker?.actor) ?? null;
  return { scene, token, actor };
}

/**
 * Is this attack card a throw? Thrown attacks (basic or ability), the
 * explosive throw, and the Hoplite's Daring Throw.
 */
function isThrowCard(message, actor) {
  const attack = message?.flags?.attack;
  if (attack?.type !== "attack" || attack.isSpell) return false;
  if (attack.attackType === "throwing") return true;
  const flags = message.flags?.[SYSTEM_ID] ?? {};
  if (flags.abilityKey === DARING_THROW_KEY) return true;
  const weapon = flags.weaponId ? actor?.items?.get(flags.weaponId) : null;
  return isThrownWeapon(weapon);
}

/**
 * A thrown attack card was posted by this client: Po vrhu získává jedno
 * Míření (one Aim on the single target; Aim-neutral throws such as Double
 * Throw and Retaliatory Throw excepted), and Po vrhu může vždy provést Pomalý
 * pohyb (the Slow Movement after it is noted for this turn). Rerolls of a
 * card do not count again.
 */
async function onThrowCard(message, userId) {
  if (userId !== game.user.id) return;
  const flags = message?.flags?.[SYSTEM_ID] ?? {};
  if (flags.rerolledFrom || flags.rerolledAway) return;
  const { scene, token, actor } = cardAttacker(message);
  if (actor?.type !== "character" || !actor.isOwner) return;
  const aimNode = hasSkirmisherNode(actor, "mireniPoVrhu");
  const moveNode = hasSkirmisherNode(actor, "pohybPoVrhu");
  if (!aimNode && !moveNode) return;
  if (!isThrowCard(message, actor)) return;

  if (moveNode && isTrackedTurn(actor)) {
    await actor.setFlag(SYSTEM_ID, THROW_SLOW_FLAG, {
      messageId: message.id,
      combat: turnStamp(trackedCombat(actor)),
    });
  }

  const ability = { name: flags.abilityName ?? "", system: { localizationKey: flags.abilityKey ?? "" } };
  if (!aimNode || !token || abilityIgnoresAim(ability)) return;
  const targets = Array.isArray(message.flags.attack.targets)
    ? message.flags.attack.targets.filter((id) => id && id !== token.id)
    : [];
  if (targets.length !== 1) return;
  const target = scene?.tokens?.get(targets[0]);
  if (!target) return;
  const { after } = await grantAimStacks(token, target, 1);
  await postLines(actor, game.i18n.localize("REDSTEEL.Actor.Specialisations.skirmisher.nodes.mireniPoVrhu.label"), [
    L("AimAfterThrow", { name: esc(actor.name), target: esc(target.name), after }),
  ]);
}

/**
 * The Slow Movement a throw allows this turn, or null: the holder's own turn,
 * a throw noted this turn, the turn's movement already used (the ordinary
 * chips cover a turn that has not moved yet) and no movement still running.
 *
 * @param {Actor} actor
 * @returns {{messageId: string}|null}
 */
export function pendingThrowSlowMove(actor) {
  if (!hasSkirmisherNode(actor, "pohybPoVrhu") || !isTrackedTurn(actor)) return null;
  const stored = actor.getFlag(SYSTEM_ID, THROW_SLOW_FLAG);
  if (!stored || !stampIsThisTurn(stored.combat, game.combat)) return null;
  const lock = getMovementLock(actor);
  if (lock && !lock.done) return null;
  if (!getSpent(actor).moved) return null;
  return stored;
}

/** Declare the Slow Movement the throw allows: one Action, as ever. */
async function useThrowSlowMove(actor) {
  if (!pendingThrowSlowMove(actor)) return;
  const token = tokenForActor(actor);
  if (!token) return;
  await actor.unsetFlag(SYSTEM_ID, THROW_SLOW_FLAG);
  await lockMovement(actor, {
    mode: "slow",
    budget: movementBudget(actor, "slow"),
    startSpent: tokenMovementSpent(token),
    charge: 1,
  });
}

/* -------------------------------------------- */
/*  Krycí postoj (Covering Stance)              */
/* -------------------------------------------- */

/** Is the Covering Stance held? */
export function hasCoveringStance(actor) {
  return !!actor?.statuses?.has(COVERING_STANCE_STATUS);
}

/** One cover per attack card. */
export function coverSource(messageId) {
  return `coveringStance.${messageId}`;
}

/**
 * Cover chip clicked: pay the Reaction, note the cover, grant the step. The
 * step may only end next to the ally; Guard follows on the check button
 * (completeCoverStep).
 */
async function useCoverStep(actor, { messageId, allyId }) {
  const combat = trackedCombat(actor);
  const token = tokenForActor(actor);
  const message = game.messages?.get(messageId);
  const ally = token?.document?.parent?.tokens?.get(allyId);
  if (!combat || !token || !message || !ally || !hasCoveringStance(actor)) return;
  if (getSpent(actor).bonusSources.includes(coverSource(messageId))) return;

  const reaction = {
    name: L("CoverLabel", { ally: ally.name }),
    system: { class: "", costType: "stamina", cost: 0, resources: {}, actionCost: "Reaction" },
  };
  if (!(await game.redsteel.deductAbilityCost(actor, [reaction]))) return;
  await actor.setFlag(SYSTEM_ID, COVER_FLAG, {
    messageId,
    allyTokenId: ally.id,
    combat: turnStamp(combat),
  });
  await grantBonusStep(actor, {
    mode: "coverStep",
    budget: movementBudget(actor, "coverStep"),
    startSpent: tokenMovementSpent(token),
    source: coverSource(messageId),
    around: ally.id,
  });
  await postLines(actor, game.i18n.localize("REDSTEEL.Items.CoveringStance.name"), [
    L("CoverStarted", { name: esc(actor.name), ally: esc(ally.name) }),
  ]);
}

/**
 * The cover step is over (the strip's check button): Guard on the ally, free,
 * linked to the attack card that called for it. Nothing when the holder did
 * not end next to the ally.
 *
 * @param {Actor} actor
 */
export async function completeCoverStep(actor) {
  const stored = actor?.getFlag(SYSTEM_ID, COVER_FLAG);
  if (!stored) return;
  await actor.unsetFlag(SYSTEM_ID, COVER_FLAG);
  const token = tokenForActor(actor);
  const ally = token?.document?.parent?.tokens?.get(stored.allyTokenId);
  if (!token || !ally) return;
  const title = game.i18n.localize("REDSTEEL.Items.CoveringStance.name");
  if (!stampIsThisTurn(stored.combat, game.combat) || !areAdjacent(token, ally)) {
    await postLines(actor, title, [
      L("CoverNotAdjacent", { name: esc(actor.name), ally: esc(ally.name) }),
    ]);
    return;
  }
  // Loaded at call time: protection.mjs reaches defense.mjs, and this file is
  // imported by veteranRest.mjs and dragonSleep.mjs, which defense.mjs uses.
  const { PROTECTION_STATUS, startProtection } = await import("./protection.mjs");
  const effect = await game.redsteel.applyEffect(actor, PROTECTION_STATUS);
  if (!effect) return;
  await startProtection(actor, token, effect, ally, {
    coverMessageId: stored.messageId,
  });
}

/* -------------------------------------------- */
/*  Odvetný vrh (Retaliatory Throw)             */
/* -------------------------------------------- */

/** Is this Retaliatory Throw? */
export function isRetaliatoryThrow(ability) {
  return isKeyed(ability, RETALIATORY_THROW_KEY, "Retaliatory Throw");
}

/**
 * The newest defense card this actor rolled, when it was a Cover; null when
 * the newest was anything else (or there is none).
 */
export function latestCoverDefense(actor) {
  const tokenIds = actorTokenIds(actor);
  if (!tokenIds.size) return null;
  const messages = game.messages?.contents ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const flags = messages[i].flags?.[SYSTEM_ID] ?? {};
    const defense = flags.defense;
    if (!defense || flags.rerolledAway) continue;
    if (!tokenIds.has(defense.defenderTokenId)) continue;
    return defense.defenseKey === "rangedDefense" ? defense : null;
  }
  return null;
}

/**
 * "plné (Úspěšný Kryt) nebo poloviční (Neúspěšný Kryt) zranění": half damage
 * when the Cover this throw answers failed.
 */
export function retaliatoryThrowHalf(actor, ability) {
  if (!isRetaliatoryThrow(ability)) return false;
  const cover = latestCoverDefense(actor);
  return !!cover && cover.succeeded !== true;
}

/** Refused before anything is paid when there is nothing to throw. */
export function retaliatoryThrowRefusal(actor, ability) {
  if (!isRetaliatoryThrow(ability)) return null;
  return thrownWeapons(actor).length ? null : L("RetaliatoryNoThrown");
}

/** The item, when the actor owns it. */
export function retaliatoryThrowItem(actor) {
  return abilityByKey(actor, RETALIATORY_THROW_KEY, "Retaliatory Throw");
}

/* -------------------------------------------- */
/*  Navazující vrh (Follow-up Throw)            */
/* -------------------------------------------- */

/** Is this Follow-up Throw? */
export function isFollowUpThrow(ability) {
  return isKeyed(ability, FOLLOW_UP_THROW_KEY, "Follow-up Throw");
}

/** The item, when the actor owns it. */
export function followUpThrowItem(actor) {
  return abilityByKey(actor, FOLLOW_UP_THROW_KEY, "Follow-up Throw");
}

/**
 * Apply Damage felled someone: stamp the Follow-up Throw chance on the
 * attacker for this turn. Own turn only (its free attack is the plain
 * Attack's, which is an own-turn grant), once per card. Runs on the GM
 * applying the damage.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message
 * @param {string[]} felledIds
 */
export async function offerFollowUpThrow(attacker, message, felledIds = []) {
  if (!attacker || !message) return;
  if (!hasSkirmisherNode(attacker, "navazujiciVrh")) return;
  if (!followUpThrowItem(attacker)) return;
  const combat = trackedCombat(attacker);
  if (!combat || !isTrackedTurn(attacker)) return;
  if (message.getFlag(SYSTEM_ID, FOLLOW_UP_OFFERED)) return;
  const selfId = message.speaker?.token ?? null;
  const killed = felledIds.find((id) => id && id !== selfId) ?? null;
  if (!killed) return;
  await message.setFlag(SYSTEM_ID, FOLLOW_UP_OFFERED, true);
  await attacker.setFlag(SYSTEM_ID, FOLLOW_UP_FLAG, {
    messageId: message.id,
    killedTokenId: killed,
    combat: turnStamp(combat),
  });
}

/** The Follow-up Throw this actor may still take this turn, or null. */
export function pendingFollowUpThrow(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, FOLLOW_UP_FLAG);
  if (!stored || !stampIsThisTurn(stored.combat, game.combat)) return null;
  return stored;
}

/**
 * Use Follow-up Throw on the pending chance: pick a thrown weapon (or keep
 * the thrown one in hand), pay the item, re-arm free, and make the next
 * Attack this turn a Free action. False with nothing pending, so the plain
 * card posts.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function useFollowUpThrow(actor, ability) {
  if (!pendingFollowUpThrow(actor)) return false;
  const title = ability.localizedName ?? ability.name;
  const main = mainHandWeapon(actor);
  const keep = isThrownWeapon(main);
  const candidates = rearmCandidates(actor).filter(isThrownWeapon);
  if (!candidates.length && !keep) {
    ui.notifications.warn(L("FollowUpNoThrown"));
    return true;
  }
  const picked = candidates.length
    ? await pickRearmWeapon(candidates, {
        title,
        prompt: L("FollowUpPrompt"),
        confirmLabel: L("FollowUpConfirm", { cost: Number(ability.system?.cost) || 0 }),
        keepLabel: keep ? L("FollowUpKeep") : null,
      })
    : "keep";
  if (!picked) return true;

  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return true;
  notePaidStamina(actor, 0);
  await actor.unsetFlag(SYSTEM_ID, FOLLOW_UP_FLAG);
  const weapon = picked === "keep" ? main : picked;
  if (picked !== "keep") await swapMainWeapon(actor, picked.id);
  const self = tokenForActor(actor);
  // grantFreeAttack needs some id to hold the grant; nothing reads it back.
  await grantFreeAttack(actor, self?.id || actor.id);
  await postLines(actor, title, [
    L(picked === "keep" ? "FollowUpReadyKeep" : "FollowUpReady", {
      name: esc(actor.name),
      weapon: esc(weapon?.localizedName ?? weapon?.name ?? ""),
    }),
  ]);
  return true;
}

/* -------------------------------------------- */
/*  Přesný výstřel (Accurate Shot)              */
/* -------------------------------------------- */

/** Is this Accurate Shot (either copy)? */
export function isAccurateShot(ability) {
  return ACCURATE_SHOT.some(({ key, name }) => isKeyed(ability, key, name));
}

/** A margin of 30 or more is a Critical Hit (never on a fumble). */
export function accurateShotMarginCrit(ability, margin, critFailure) {
  return (
    isAccurateShot(ability) &&
    !critFailure &&
    Number(margin) >= ACCURATE_SHOT_CRIT_MARGIN
  );
}

/**
 * "+1 za každé Míření": the Aim committed to this shot (the actor's
 * `aimCount`, read before getAttackRolls consumes it) as Critical Range.
 */
export function accurateShotAimCritRange(actor, ability) {
  if (!isAccurateShot(ability)) return 0;
  return Math.max(0, Number(actor?.getFlag?.(SYSTEM_ID, "aimCount")) || 0);
}

/* -------------------------------------------- */
/*  Lehká zbroj                                 */
/* -------------------------------------------- */

/** Extra Stamina one Rest restores for this actor. */
export function lightArmorRestBonus(actor) {
  return hasSkirmisherNode(actor, "lehkaZbroj") && getTopArmorWeight(actor) === "light"
    ? LIGHT_ARMOR_REST_BONUS
    : 0;
}

/**
 * Add Lehká zbroj's Stamina for `rests` Rests whose own Stamina was already
 * paid elsewhere (the Rest ability, the Rest macro), with a line in chat.
 *
 * @param {Actor} actor
 * @param {number} [rests=1]
 */
export async function grantLightArmorRest(actor, rests = 1) {
  const bonus = lightArmorRestBonus(actor) * Math.max(0, rests);
  if (!(bonus > 0)) return;
  const stamina = actor.system?.stats?.stamina ?? {};
  const current = Number(stamina.value) || 0;
  const max = Number(stamina.max);
  const next = Number.isFinite(max) && max > 0 ? Math.min(max, current + bonus) : current + bonus;
  if (next === current) return;
  await actor.update({ "system.stats.stamina.value": next });
  await postLines(actor, game.i18n.localize("REDSTEEL.Actor.Specialisations.skirmisher.nodes.lehkaZbroj.label"), [
    L("LightArmorRest", { name: esc(actor.name), amount: next - current }),
  ]);
}

/* -------------------------------------------- */
/*  Vrh s rozběhem (Run Up Throw)               */
/* -------------------------------------------- */

/** Is this Run Up Throw? */
export function isRunUpThrow(ability) {
  return isKeyed(ability, RUN_UP_THROW.key, RUN_UP_THROW.name);
}

/** How far the run may go: Speed, x1.5 with the node. */
export function runUpBudget(actor) {
  const base = movementBudget(actor, "runUp");
  return hasSkirmisherNode(actor, "vrhSRozbehem")
    ? Math.floor(base * RUN_UP_NODE_MOVE)
    : base;
}

/** Would picking Run Up Throw now declare its run (as a Charge does)? */
export function runUpWouldDeclare(actor) {
  if (!actor || !isTrackedTurn(actor)) return false;
  if (getMovementLock(actor) || getSpent(actor).moved) return false;
  return !!tokenForActor(actor);
}

/**
 * Declare Run Up Throw's run: a `runUp` movement lock that launches the
 * throw from the strip's check button. Nothing is paid here; the throw pays
 * the item.
 *
 * @param {Actor} actor
 * @param {Item} ability
 */
export async function declareRunUp(actor, ability) {
  const token = tokenForActor(actor);
  if (!token) return;
  const targets = [...(game.user?.targets ?? [])].filter((t) => t !== token);
  await lockMovement(actor, {
    mode: "runUp",
    budget: runUpBudget(actor),
    startSpent: tokenMovementSpent(token),
    charge: 0,
    launch: {
      abilityId: ability.id,
      targetId: targets.length === 1 ? targets[0].id : null,
    },
  });
}

/** The round's run, once its hexes were added to a throw. */
function runUpSource(combat) {
  return `runUpHex.${combat.id}.${combat.round}`;
}

/** Hexes this round's declared run walked, or null when there is none to cash. */
function runUpWalked(actor) {
  const lock = getMovementLock(actor);
  if (lock?.mode !== "runUp" || lock.stopped) return null;
  const combat = trackedCombat(actor);
  if (combat && getSpent(actor).bonusSources.includes(runUpSource(combat))) return null;
  const token = tokenForActor(actor);
  if (!token) return null;
  const walked = tokenMovementSpent(token) - (Number(lock.startSpent) || 0);
  return Math.max(0, Math.min(Number(lock.budget) || 0, walked));
}

/** Refused before anything is paid: a declared run shorter than two hexes. */
export function runUpRefusal(actor, ability) {
  if (!isRunUpThrow(ability)) return null;
  const walked = runUpWalked(actor);
  if (walked === null || walked >= RUN_UP_MIN_HEXES) return null;
  return L("RunUpTooShort", { min: RUN_UP_MIN_HEXES, walked });
}

/**
 * What the run adds to the throw: +1d4 for every hex past the two the item's
 * own +2d4 pays for, and the node's +1d6 Breakthrough.
 *
 * @returns {{dice: string, breakthrough: string, hexes: number}|null}
 */
export function runUpThrowBonus(actor, ability) {
  if (!isRunUpThrow(ability)) return null;
  const walked = runUpWalked(actor) ?? 0;
  const extra = Math.max(0, walked - RUN_UP_MIN_HEXES);
  return {
    dice: extra > 0 ? `${extra}d4` : "",
    breakthrough: hasSkirmisherNode(actor, "vrhSRozbehem") ? RUN_UP_NODE_BREAKTHROUGH : "",
    hexes: walked,
  };
}

/** The throw is out: the run is cashed for the round. */
export async function spendRunUp(actor, ability, bonus) {
  if (!isRunUpThrow(ability) || !(bonus?.hexes > 0)) return;
  const combat = trackedCombat(actor);
  if (combat) await markBonusSource(actor, runUpSource(combat));
}

/* -------------------------------------------- */
/*  Zběsilý vrh (Frenzied Throw)                */
/* -------------------------------------------- */

/** Zatížení štítu +25% on a Frenzied Throw with the node. */
export function frenziedThrowStrain(actor, ability) {
  return isKeyed(ability, FRENZIED_THROW.key, FRENZIED_THROW.name) &&
    hasSkirmisherNode(actor, "zbesilyVrh")
    ? FRENZIED_THROW_STRAIN
    : 0;
}

/* -------------------------------------------- */
/*  Zmrzačující výstřel (Crippling Shot)        */
/* -------------------------------------------- */

const CRIPPLING_SHOT = Object.freeze({
  key: "REDSTEEL.Items.CripplingShot.name",
  name: "Crippling Shot",
});
const IMPROVED_CRIPPLING_SHOT = Object.freeze({
  key: "REDSTEEL.Items.ImprovedCripplingShot.name",
  name: "Improved Crippling Shot",
});
/** "šance 50% na zbavení veškerého pohybu". */
export const IMMOBILIZE_CHANCE = 50;

/** Is this Crippling Shot (the action)? */
export function isCripplingShot(ability) {
  return isKeyed(ability, CRIPPLING_SHOT.key, CRIPPLING_SHOT.name);
}

/** Is this the Improved Crippling Shot modifier? */
export function isImprovedCripplingShot(ability) {
  return isKeyed(ability, IMPROVED_CRIPPLING_SHOT.key, IMPROVED_CRIPPLING_SHOT.name);
}

/**
 * The effects a Crippling Shot carries to its target, as effect contributions
 * for combatSkillBonuses.mjs getEffectRolls (`value` -1 = automatic on a hit,
 * otherwise a percent chance rolled on the card). Built in code rather than
 * in the items' effect slots, so copies already on actors get them too.
 * User rulings 2026-10-20:
 * - Crippling Shot (ruzne-info.md r312), for everyone: `crippled` (Speed
 *   halved rounded up, Dodge -20%, three turns) and `crippled_initiative`
 *   (turn order 1 for one round).
 * - Harcovník → Zmrzačující výstřel: 50% na zbavení pohybu: with the node, a
 *   Crippling Shot also rolls 50% for `immobilized` (Speed 0 to the end of the
 *   target's next turn).
 * - Vylepšený zmrzačující výstřel (specializace-wip.md r229), the modifier:
 *   `crippled` and the 50% `immobilized` roll on any attack it rides on. Its
 *   text has no turn order part.
 *
 * @param {Actor} actor
 * @param {Item|null} ability
 * @param {Item[]} [modifiers]
 * @returns {Array<{name: string, value: number}>}
 */
export function cripplingShotEffects(actor, ability, modifiers = []) {
  const base = isCripplingShot(ability);
  const improved =
    isImprovedCripplingShot(ability) ||
    (modifiers ?? []).some((mod) => isImprovedCripplingShot(mod));
  if (!base && !improved) return [];
  const out = [{ name: "crippled", value: -1 }];
  if (base) out.push({ name: "crippled_initiative", value: -1 });
  if (improved || hasSkirmisherNode(actor, "zmrzacujiciVystrel")) {
    out.push({ name: "immobilized", value: IMMOBILIZE_CHANCE });
  }
  return out;
}

/* -------------------------------------------- */
/*  Hotbar chips                                */
/* -------------------------------------------- */

/** Is this token down or dead? */
export function isFallenToken(doc) {
  return FALLEN_STATUSES.some((s) => doc?.actor?.statuses?.has(s));
}

/** Same side as the holder (an ally) by the movement rules' reading. */
export function sameSide(a, b) {
  return isHostileSide(a) === isHostileSide(b);
}

/**
 * A Skirmisher chip was clicked on the hotbar (redsteelHotbar.mjs).
 *
 * @param {Actor} actor
 * @param {DOMStringMap} data  the chip's dataset: `op`, `messageId`,
 *   `targetTokenId`
 */
export async function useSkirmisherChip(actor, data = {}) {
  if (data.op === "cover") {
    await useCoverStep(actor, {
      messageId: data.messageId,
      allyId: data.targetTokenId,
    });
  } else if (data.op === "throwSlow") {
    await useThrowSlowMove(actor);
  }
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerSkirmisherHooks() {
  Hooks.on("createChatMessage", (message, _options, userId) => {
    onThrowCard(message, userId).catch((err) =>
      console.error("Redsteel | Skirmisher throw card failed", err),
    );
  });
}
