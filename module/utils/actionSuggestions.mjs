/**
 * The hotbar's suggestion strip: turn actions that make sense right now,
 * floated above the Redsteel panel.
 *
 * A suggestion is a filter, never a refusal. A chip that is not shown is one
 * the tracker thinks cannot be paid for; nothing here stops the player doing it
 * another way.
 *
 * Each provider takes the bound actor and returns zero or more chips: movement
 * on the actor's own turn, combat abilities (reactions and free follow-ups)
 * whenever they apply. A new provider is one more function in PROVIDERS.
 */

import {
  getActionPools,
  getMovementLock,
  getSpent,
  isMovementTurn,
  isTrackedTurn,
  trackedCombat,
} from "./actionTracker.mjs";
import {
  MOVEMENT_MODES,
  NO_OPPORTUNITY_ATTACK_STATUSES,
  engagingEnemyIds,
  lockRemaining,
  movementBudget,
  tokenForActor,
} from "./movementZones.mjs";
import { areAdjacent } from "./positioning.mjs";
import { EXPLOIT_WEAKNESS_KEY, hasDragonGuard } from "./dragonGuard.mjs";
import { hasDragonSleep } from "./dragonSleep.mjs";
import { hasFreeRiposte } from "./swordServant.mjs";
import { isSlipThrough, pendingSlipThrough } from "./slipThrough.mjs";
import { resolveWeaponContext } from "./weaponResolver.mjs";
import { hasImpaleFollowup, IMPALE_FOLLOWUP_KEY } from "./impaleFollowup.mjs";
import { OVERWATCH_KEY, overwatchTrigger } from "./overwatch.mjs";
import { holdCostLabel, isStanceHeld, maintainedStances } from "./stances.mjs";
import { escapeTargets, liveMessage } from "./escapeFollowup.mjs";
import { LUNGE_STEP_KEY, lungeStepSource } from "./abilityMovement.mjs";
import { findOverpowerContest, OVERPOWER_KEY } from "./overpower.mjs";
import { BRACE_KEY, getBraceEffect } from "./brace.mjs";
import { isHostileSide } from "./movementZones.mjs";
import { hasWeaponMasterNode } from "./weaponMaster.mjs";

const MODE_ORDER = ["move", "slow", "sprint", "disengage"];

function costLabel(actions) {
  return game.i18n.localize(
    actions >= 2
      ? "REDSTEEL.Bg3Hotbar.Suggest.TwoActions"
      : "REDSTEEL.Bg3Hotbar.Suggest.OneAction",
  );
}

/**
 * Movement: Move / Slow Movement / Sprint before the actor has moved, or the
 * one declared mode with what is left of it afterwards.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function movementProvider(actor) {
  // Movement is a turn action: only on the actor's own turn, save an off-turn
  // step an ability granted (Quick Feet), which shows as its locked chip.
  if (!isMovementTurn(actor)) return [];
  const lock = getMovementLock(actor);
  if (lock) {
    const def = MOVEMENT_MODES[lock.mode];
    // Confirmed with the check button: nothing left to suggest.
    if (!def || lock.done) return [];
    const budget = Number(lock.budget) || 0;
    const remaining = lockRemaining(tokenForActor(actor), lock);
    const label = game.i18n.localize(def.labelKey);
    const hexLabel = game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.Remaining", {
      remaining,
      budget,
    });
    return [
      {
        id: `movement-${lock.mode}`,
        mode: lock.mode,
        icon: def.icon,
        label,
        costLabel: "",
        hexLabel,
        locked: true,
        remaining,
        budget,
        ariaLabel: `${game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.Locked")}: ${label}, ${hexLabel}`,
      },
    ];
  }

  const spent = getSpent(actor);
  if (spent.moved) return [];
  const left = getActionPools(actor).actions - spent.actions;

  const chips = [];
  // Disengage is offered only while an enemy stands next to the token.
  const engaged = engagingEnemyIds(tokenForActor(actor)).length > 0;

  for (const mode of MODE_ORDER) {
    const def = MOVEMENT_MODES[mode];
    if (def.actions > left) continue;
    if (mode === "disengage" && !engaged) continue;
    const budget = movementBudget(actor, mode);
    const label = game.i18n.localize(def.labelKey);
    const cost = costLabel(def.actions);
    const hexLabel = game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.Hexes", {
      n: budget,
    });
    chips.push({
      id: `movement-${mode}`,
      mode,
      icon: def.icon,
      label,
      costLabel: cost,
      hexLabel,
      locked: false,
      remaining: budget,
      budget,
      ariaLabel: `${label}, ${cost}, ${hexLabel}`,
    });
  }

  // Move is the one used most, so it stands alone and the rest (Slow
  // Movement, Sprint, Disengage) ride inside it as `more`, rolled out on
  // demand from the strip's drawer (user ruling). Without Move there is
  // nothing to fold behind, so the chips stay as they are.
  const move = chips.find((c) => c.mode === "move");
  const others = chips.filter((c) => c.mode !== "move");
  if (move && others.length) return [{ ...move, more: others }];
  return chips;
}

/* -------------------------------------------------------------------------- */
/*  Combat abilities                                                          */
/* -------------------------------------------------------------------------- */

/** The pack abilities offered here, by their localisation key. */
const COUNTERATTACK_KEY = "REDSTEEL.Items.Counterattack.name";
const RETALIATORY_KEY = "REDSTEEL.Items.RetaliatoryStrike.name";
/** The Champion's upgrade stands in for the plain strike (abilityGrants.mjs). */
const IMPROVED_RETALIATORY_KEY = "REDSTEEL.Items.ImprovedRetaliatoryStrike.name";
const RIPOSTE_KEY = "REDSTEEL.Items.Riposte.name";
/**
 * Dračí výpad (Dragon Strike, Servant of the Sword): like Riposte it answers
 * an incoming melee attack instead of a Defense, so it is offered beside it.
 */
const DRAGON_STRIKE_KEY = "REDSTEEL.Items.DragonsThrust.name";
/**
 * Odstrčení (Shove), both attribute forms. Granted by Pikeman 5 and Musketeer
 * 8 (abilityGrants.mjs); a retaliation attack "after a successful Defense".
 */
const SHOVE_KEYS = Object.freeze([
  "REDSTEEL.Items.ShoveStrength.name",
  "REDSTEEL.Items.ShoveDexterity.name",
]);

/**
 * The newest chat message when the current turn began. Attack cards carry no
 * combat stamp, so this is what tells this turn's cards from older ones: only
 * messages after it count. Null until the first turn change this session (a
 * reload mid-turn); Riposte then falls back to "the attacker is the combatant
 * whose turn it is".
 */
let turnStartMessageId = null;

/**
 * Attacks that cannot themselves be answered with Counterattack, Retaliatory
 * strike or Shove: the reactions themselves, Riposte, and Shield Bash in both
 * its normal and small-shield form.
 */
const UNANSWERABLE_ATTACK_KEYS = new Set([
  COUNTERATTACK_KEY,
  RETALIATORY_KEY,
  IMPROVED_RETALIATORY_KEY,
  ...SHOVE_KEYS,
  "REDSTEEL.Items.Riposte.name",
  "REDSTEEL.Items.ShieldBash.name",
  "REDSTEEL.Items.ShieldBashSmallShield.name",
]);

/** Every retaliation this strip offers; posting any one answers the defense. */
const RETALIATION_KEYS = new Set([
  COUNTERATTACK_KEY,
  RETALIATORY_KEY,
  IMPROVED_RETALIATORY_KEY,
  ...SHOVE_KEYS,
]);

/** The actor's ability Item carrying this localisation key, or null. */
function abilityByKey(actor, key) {
  return (
    actor.items.find(
      (i) => i.type === "ability" && i.system?.localizationKey === key,
    ) ?? null
  );
}

/**
 * Ids of every token standing in for this actor on the canvas. Matched by
 * token, not actor id: an unlinked NPC's speaker carries the base actor's id,
 * which every copy of that NPC shares.
 */
function actorTokenIds(actor) {
  return new Set(
    actor.isToken
      ? [actor.token?.id].filter(Boolean)
      : actor.getActiveTokens(false, true).map((t) => t.id),
  );
}

/**
 * The newest defense card this actor rolled, and whether they have posted a
 * Counterattack, Retaliatory strike or Shove since. Read off the chat log, nothing
 * stored (the overwhelm.mjs pattern).
 *
 * @param {Set<string>} tokenIds
 * @returns {{defense: object, answered: boolean}|null}
 */
function latestDefense(tokenIds) {
  const messages = game.messages?.contents ?? [];
  let answered = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const flags = message.flags?.redsteel ?? {};
    const defense = flags.defense;
    if (defense && tokenIds.has(defense.defenderTokenId)) {
      return { defense, answered };
    }
    // The reaction is used up once the defender has swung it after the
    // defense card, told apart by the speaker's token.
    // Exploit Weakness under Dragon Guard counts too: its card is tagged.
    const tags = Array.isArray(flags.attackTags) ? flags.attackTags : [];
    if (
      (RETALIATION_KEYS.has(flags.abilityKey) || tags.includes("retaliation")) &&
      tokenIds.has(message.speaker?.token)
    ) {
      answered = true;
    }
  }
  return null;
}

/**
 * A reaction lives only for the turn its defense was rolled in: the card's
 * stamped combat moment must be the encounter's current one, so the chance
 * expires when the turn moves on.
 */
function defenseIsCurrent(defense, combat) {
  const stamp = defense?.combat;
  if (!stamp || !combat) return false;
  return (
    stamp.id === combat.id &&
    Number(stamp.round) === Number(combat.round) &&
    Number(stamp.turn) === Number(combat.turn)
  );
}

/**
 * Does the defender's weapon have Long Reach? Resolved the way the Combat
 * Abilities dialog does it (combatAbilities.mjs, `hasLongReach`): the active
 * set's main weapon, or for a non-character any weapon it carries.
 */
function hasLongReach(actor) {
  const activeWeapon = resolveWeaponContext(actor)?.weapon;
  if (activeWeapon?.system?.longReach) return true;
  if (actor.type !== "character") {
    return actor.items.some((i) => i.type === "weapon" && i.system?.longReach);
  }
  return false;
}

/** Hexes between two token centres, along the grid. */
function hexDistance(a, b) {
  const path = canvas.grid.getDirectPath([a.center, b.center]);
  return Math.max(0, (path?.length ?? 1) - 1);
}

/**
 * Within reach: the attacker stands next to the defender, or two hexes off
 * when the defender's weapon has Long Reach.
 */
function withinReach(actor, defenderToken, attackerToken) {
  if (areAdjacent(defenderToken, attackerToken)) return true;
  if (!hasLongReach(actor)) return false;
  return hexDistance(defenderToken, attackerToken) <= 2;
}

/**
 * The attacker a reaction would answer: still on the canvas, visible to this
 * user and not dead. Null otherwise.
 */
function answerableAttacker(tokenId) {
  const token = tokenId ? canvas.tokens?.get(tokenId) : null;
  if (!token) return null;
  if (!token.visible && !game.user.isGM) return null;
  if (token.actor?.statuses?.has("dead")) return null;
  return token;
}

/**
 * Neither reaction answers another reaction, a Riposte, a Shield Bash or an
 * Opportunity Attack.
 */
function attackIsAnswerable(defense) {
  if (UNANSWERABLE_ATTACK_KEYS.has(defense.attackAbilityKey)) return false;
  const tags = Array.isArray(defense.attackTags) ? defense.attackTags : [];
  // "retaliation": Exploit Weakness swung as one under Dragon Guard.
  return !tags.includes("opportunity") && !tags.includes("retaliation");
}

/**
 * Counterattack (Protiútok): only after a SUCCESSFUL Defense. Dodge does not
 * count.
 */
function counterattackFits(defense) {
  return defense.defenseKey === "meleeDefense" && defense.succeeded === true;
}

/**
 * Retaliatory strike (Odvetný úder): after a Defense or a Dodge, whether it
 * held or not.
 */
function retaliatoryFits(defense) {
  return defense.defenseKey === "meleeDefense" || defense.defenseKey === "dodge";
}

/**
 * Shove (Odstrčení): "Can be performed after a successful Defense", the same
 * gate as Counterattack. Dodge does not count.
 */
function shoveFits(defense) {
  return counterattackFits(defense);
}

/**
 * One ability chip: the ability's own icon and name, and what it costs. Its
 * theme picks the plate it sits on: a ranged ability goes on the yellow one,
 * anything else (melee, other) on the red.
 */
function abilityChip(item, costKey, targetTokenId) {
  const label = item.localizedName ?? item.name;
  const cost = game.i18n.localize(costKey);
  // An attack can be aimed at a body part, the Combat Abilities dialog's
  // Aimed Attack pill: right-click on the chip.
  const aimable = ["melee", "ranged"].includes(item.system?.type);
  return {
    id: `ability-${item.id}`,
    kind: "ability",
    theme: item.system?.type === "ranged" ? "ranged" : "melee",
    // The tooltip reads the ability's prose off the item, and draws a
    // Reaction as the action tracker's blue star rather than spelling it out.
    uuid: item.uuid,
    costKind: costKey === "REDSTEEL.Bg3Hotbar.Suggest.Reaction" ? "reaction" : "free",
    abilityId: item.id,
    img: item.img,
    label,
    costLabel: cost,
    targetTokenId,
    aimable,
    hint: aimable ? game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.AimedHint") : "",
    ariaLabel: `${label}, ${cost}`,
  };
}

/**
 * Reactions to the defense this actor just rolled: Counterattack, Retaliatory
 * strike and Shove, aimed back at the attacker.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function reactionChips(actor) {
  const counter = abilityByKey(actor, COUNTERATTACK_KEY);
  const retaliatory =
    abilityByKey(actor, IMPROVED_RETALIATORY_KEY) ??
    abilityByKey(actor, RETALIATORY_KEY);
  const shoves = SHOVE_KEYS.map((key) => abilityByKey(actor, key)).filter(Boolean);
  // Dragon Guard lets Exploit Weakness be swung as a Retaliation action.
  const exploit = hasDragonGuard(actor)
    ? abilityByKey(actor, EXPLOIT_WEAKNESS_KEY)
    : null;
  if (!counter && !retaliatory && !shoves.length && !exploit) return [];

  // A Reaction left to pay with.
  if (getSpent(actor).reactions >= getActionPools(actor).reactions) return [];

  const tokenIds = actorTokenIds(actor);
  if (!tokenIds.size) return [];
  const found = latestDefense(tokenIds);
  if (!found || found.answered) return [];
  const { defense } = found;
  if (!defenseIsCurrent(defense, game.combat)) return [];
  if (!attackIsAnswerable(defense)) return [];

  const defenderToken = canvas.tokens?.get(defense.defenderTokenId);
  const attackerToken = answerableAttacker(defense.attackerTokenId);
  if (!defenderToken || !attackerToken) return [];
  if (!withinReach(actor, defenderToken, attackerToken)) return [];

  const chips = [];
  if (counter && counterattackFits(defense)) {
    chips.push(
      abilityChip(counter, "REDSTEEL.Bg3Hotbar.Suggest.Reaction", attackerToken.id),
    );
  }
  if (retaliatory && retaliatoryFits(defense)) {
    chips.push(
      abilityChip(retaliatory, "REDSTEEL.Bg3Hotbar.Suggest.Reaction", attackerToken.id),
    );
  }
  if (shoveFits(defense)) {
    for (const shove of shoves) {
      chips.push(
        abilityChip(shove, "REDSTEEL.Bg3Hotbar.Suggest.Reaction", attackerToken.id),
      );
    }
  }
  // Offered wherever Retaliatory strike would be: after a Defense or a Dodge.
  if (exploit && retaliatoryFits(defense)) {
    chips.push(
      abilityChip(exploit, "REDSTEEL.Bg3Hotbar.Suggest.Reaction", attackerToken.id),
    );
  }
  return chips;
}

/**
 * Riposte: "Instead of defending, make an attack roll against your opponent's
 * Margin of Success." So it answers an incoming attack BEFORE any defense:
 * offered for the newest melee attack card this turn that names this actor's
 * token as a target, from an attacker within reach, until the actor has
 * defended against that attacker or riposted since. Costs the Reaction, so
 * one must be left.
 *
 * Contested cards (Shield Bash, Knockdown ...) are answered by a vs Test, not
 * a defense, so there is nothing to riposte there. Ranged, thrown and magic
 * attacks are not melee exchanges.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function riposteChips(actor) {
  // Dragon Sleep: "You cannot use Riposte for one round."
  const riposte = hasDragonSleep(actor) ? null : abilityByKey(actor, RIPOSTE_KEY);
  const dragonStrike = abilityByKey(actor, DRAGON_STRIKE_KEY);
  if (!riposte && !dragonStrike) return [];
  const reactionLeft =
    getSpent(actor).reactions < getActionPools(actor).reactions;
  // Servant of the Sword: the round's first Riposte is a Free action.
  const freeRiposte = !!riposte && hasFreeRiposte(actor);
  const offers = [];
  if (riposte && (reactionLeft || freeRiposte)) {
    offers.push({
      item: riposte,
      costKey: freeRiposte
        ? "REDSTEEL.Bg3Hotbar.Suggest.FreeAction"
        : "REDSTEEL.Bg3Hotbar.Suggest.Reaction",
    });
  }
  if (dragonStrike && reactionLeft) {
    offers.push({ item: dragonStrike, costKey: "REDSTEEL.Bg3Hotbar.Suggest.Reaction" });
  }
  if (!offers.length) return [];

  const tokenIds = actorTokenIds(actor);
  if (!tokenIds.size) return [];
  const combat = game.combat;

  const messages = game.messages?.contents ?? [];
  // Newer-than-the-attack answers seen while walking back: defenses by this
  // actor (keyed by the attacker they answered) and this actor's ripostes.
  const defendedAgainst = new Set();
  let riposted = false;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (turnStartMessageId && message.id === turnStartMessageId) break;
    const flags = message.flags ?? {};

    const defense = flags.redsteel?.defense;
    if (defense && tokenIds.has(defense.defenderTokenId)) {
      if (defense.attackerTokenId) defendedAgainst.add(defense.attackerTokenId);
      continue;
    }
    // Either answer uses the chance up: one swing instead of a Defense.
    if (
      (flags.redsteel?.abilityKey === RIPOSTE_KEY ||
        flags.redsteel?.abilityKey === DRAGON_STRIKE_KEY) &&
      tokenIds.has(message.speaker?.token)
    ) {
      riposted = true;
      continue;
    }

    const attack = flags.attack;
    if (attack?.type !== "attack" || attack.contested) continue;
    const targets = Array.isArray(attack.targets) ? attack.targets : [];
    if (!targets.some((id) => tokenIds.has(id))) continue;

    // The newest attack aimed at this actor this turn decides; older ones
    // were already answered one way or another.
    if (riposted) return [];
    // Not a melee exchange: the same split autoDefense.mjs defenseCategory
    // makes (ranged, thrown and magic are answered at range).
    if (["ranged", "throwing", "magic"].includes(attack.attackType)) return [];
    const attackerId = message.speaker?.token ?? null;
    if (!attackerId || tokenIds.has(attackerId)) return [];
    if (defendedAgainst.has(attackerId)) return [];
    // Reload mid-turn: no turn boundary known, so only the attacker whose
    // turn it is can be riposted.
    if (!turnStartMessageId && combat?.combatant?.tokenId !== attackerId) return [];

    const attackerToken = answerableAttacker(attackerId);
    const defenderToken = [...tokenIds]
      .map((id) => canvas.tokens?.get(id))
      .find((t) => t && targets.includes(t.id));
    if (!attackerToken || !defenderToken) return [];
    if (!withinReach(actor, defenderToken, attackerToken)) return [];

    return offers.map(({ item, costKey }) =>
      abilityChip(item, costKey, attackerToken.id),
    );
  }
  return [];
}

/**
 * Lunge Step (Přískok, Servant of the Sword): "When targeted by an attack, may
 * move one hex toward the attacker ... before the attack resolves." Offered
 * for the newest melee attack card this turn that names this actor's token,
 * when the attacker struck from beyond the next hex, which only Long Reach or
 * Extended Lunge allow. Gone once the actor has defended against that
 * attacker (the attack has resolved), has stepped toward it this turn, or
 * stands next to it. Ranged, thrown and magic attacks do not count. A Free
 * action: no Reaction needed, the Stamina is paid when it is used.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function lungeStepChips(actor) {
  const lunge = abilityByKey(actor, LUNGE_STEP_KEY);
  if (!lunge) return [];
  const combat = trackedCombat(actor);
  if (!combat || isTrackedTurn(actor)) return [];

  const tokenIds = actorTokenIds(actor);
  if (!tokenIds.size) return [];

  const messages = game.messages?.contents ?? [];
  const defendedAgainst = new Set();
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (turnStartMessageId && message.id === turnStartMessageId) break;
    const flags = message.flags ?? {};

    const defense = flags.redsteel?.defense;
    if (defense && tokenIds.has(defense.defenderTokenId)) {
      if (defense.attackerTokenId) defendedAgainst.add(defense.attackerTokenId);
      continue;
    }

    const attack = flags.attack;
    if (attack?.type !== "attack") continue;
    const targets = Array.isArray(attack.targets) ? attack.targets : [];
    if (!targets.some((id) => tokenIds.has(id))) continue;

    // The newest attack aimed at this actor this turn decides.
    if (["ranged", "throwing", "magic"].includes(attack.attackType)) return [];
    const attackerId = message.speaker?.token ?? null;
    if (!attackerId || tokenIds.has(attackerId)) return [];
    if (defendedAgainst.has(attackerId)) return [];
    // Reload mid-turn: no turn boundary known, so only the attacker whose
    // turn it is counts.
    if (!turnStartMessageId && combat.combatant?.tokenId !== attackerId) return [];
    if (getSpent(actor).bonusSources.includes(lungeStepSource(combat, attackerId))) {
      return [];
    }

    const attackerToken = answerableAttacker(attackerId);
    const defenderToken = [...tokenIds]
      .map((id) => canvas.tokens?.get(id))
      .find((t) => t && targets.includes(t.id));
    if (!attackerToken || !defenderToken) return [];
    // Struck from the next hex: nothing to close in on.
    if (hexDistance(defenderToken, attackerToken) < 2) return [];

    return [
      abilityChip(lunge, "REDSTEEL.Bg3Hotbar.Suggest.FreeAction", attackerToken.id),
    ];
  }
  return [];
}

/**
 * The newest melee attack card of this turn aimed at one of these tokens that
 * has not been defended against yet: the blow a Brace answers. Same walk and
 * same rules as Riposte's (contested cards, ranged, thrown and magic attacks
 * are not melee exchanges).
 *
 * @param {Set<string>} tokenIds
 * @returns {{attackerToken: Token}|null}
 */
function undefendedMeleeAttack(tokenIds) {
  const combat = game.combat;
  const messages = game.messages?.contents ?? [];
  const defendedAgainst = new Set();
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (turnStartMessageId && message.id === turnStartMessageId) break;
    const flags = message.flags ?? {};

    const defense = flags.redsteel?.defense;
    if (defense && tokenIds.has(defense.defenderTokenId)) {
      if (defense.attackerTokenId) defendedAgainst.add(defense.attackerTokenId);
      continue;
    }

    const attack = flags.attack;
    if (attack?.type !== "attack" || attack.contested) continue;
    if (flags.redsteel?.rerolledAway) continue;
    const targets = Array.isArray(attack.targets) ? attack.targets : [];
    if (!targets.some((id) => tokenIds.has(id))) continue;

    // The newest attack aimed at this actor this turn decides.
    if (["ranged", "throwing", "magic"].includes(attack.attackType)) return null;
    const attackerId = message.speaker?.token ?? null;
    if (!attackerId || tokenIds.has(attackerId)) return null;
    if (defendedAgainst.has(attackerId)) return null;
    if (!turnStartMessageId && combat?.combatant?.tokenId !== attackerId) return null;

    const attackerToken = answerableAttacker(attackerId);
    return attackerToken ? { attackerToken } : null;
  }
  return null;
}

/**
 * Odražení (Brace, Weapon Master): "When attacked, may spend a Reaction to
 * gain Advantage on the next Defense." Offered against the newest undefended
 * melee attack aimed at this actor, while a Reaction is left and no Brace is
 * already held (utils/brace.mjs).
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function braceChips(actor) {
  const brace = abilityByKey(actor, BRACE_KEY);
  if (!brace || getBraceEffect(actor)) return [];
  if (getSpent(actor).reactions >= getActionPools(actor).reactions) return [];
  const tokenIds = actorTokenIds(actor);
  if (!tokenIds.size) return [];
  const found = undefendedMeleeAttack(tokenIds);
  if (!found) return [];
  const chip = abilityChip(
    brace,
    "REDSTEEL.Bg3Hotbar.Suggest.Reaction",
    found.attackerToken.id,
  );
  chip.hint = game.i18n.format("REDSTEEL.WeaponMaster.BraceHint", {
    attacker: found.attackerToken.name,
  });
  return [chip];
}

/**
 * Přesílení (Overpower, Weapon Master): a combat contest of this turn that the
 * actor lost by 10 or less, on either side of it, not yet Overpowered by them
 * (utils/overpower.mjs decides all of that). One chip: rerolls the actor's own
 * die and restates the contest.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function overpowerChips(actor) {
  const ability = abilityByKey(actor, OVERPOWER_KEY);
  if (!ability) return [];
  const found = findOverpowerContest(actorTokenIds(actor), trackedCombat(actor));
  if (!found) return [];
  const label = ability.localizedName ?? ability.name;
  const hint = game.i18n.format(
    found.side === "defender"
      ? "REDSTEEL.WeaponMaster.OverpowerDefenseHint"
      : "REDSTEEL.WeaponMaster.OverpowerAttackHint",
    { gap: found.gap },
  );
  return [
    {
      id: `overpower-${found.message.id}`,
      kind: "overpower",
      theme: "melee",
      uuid: ability.uuid,
      costKind: "free",
      img: ability.img,
      label,
      hint,
      messageId: found.message.id,
      ariaLabel: `${label}: ${hint}`,
    },
  ];
}

/** Icon of the Vigilant Protector chip (user's pick). */
const VIGILANT_ICON = "icons/skills/melee/swords-parry-block-yellow.webp";

/** The once-per-round allowance Vigilant Protector notes in the tracker. */
export function vigilantSource(combat) {
  return `vigilant.${combat.id}.${combat.round}`;
}

/**
 * Bdělý ochránce (Vigilant Protector, Weapon Master): "May make an Opportunity
 * Attack even when an ally is attacked, as long as the attacker is in reach.
 * Only once per round." Offered off the actor's turn for the newest attack of
 * this turn aimed at an ally by an enemy standing within the actor's reach.
 * Costs the Reaction (the Attack dialog's Opportunity Attack pays it); the
 * allowance is noted in the tracker when the chip is used.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function vigilantChips(actor) {
  if (!hasWeaponMasterNode(actor, "bdelyOchrance")) return [];
  const combat = trackedCombat(actor);
  if (!combat || isTrackedTurn(actor)) return [];
  const spent = getSpent(actor);
  if (spent.reactions >= getActionPools(actor).reactions) return [];
  if (spent.bonusSources.includes(vigilantSource(combat))) return [];
  if (CANNOT_SHOOT.some((s) => actor.statuses?.has(s))) return [];
  // A melee Opportunity Attack: a bow in hand reaches nobody.
  const weapon = resolveWeaponContext(actor)?.weapon;
  if (["bow", "crossbow"].includes(weapon?.system?.class)) return [];

  const tokenIds = actorTokenIds(actor);
  const myToken = [...tokenIds].map((id) => canvas.tokens?.get(id)).find(Boolean);
  if (!myToken) return [];
  const mySide = isHostileSide(myToken.document);

  const messages = game.messages?.contents ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (turnStartMessageId && message.id === turnStartMessageId) break;
    const flags = message.flags ?? {};
    const attack = flags.attack;
    if (attack?.type !== "attack") continue;
    if (flags.redsteel?.rerolledAway) continue;

    const attackerId = message.speaker?.token ?? null;
    if (!attackerId || tokenIds.has(attackerId)) continue;
    if (!turnStartMessageId && combat.combatant?.tokenId !== attackerId) return [];
    const attackerToken = answerableAttacker(attackerId);
    if (!attackerToken) return [];
    if (isHostileSide(attackerToken.document) === mySide) return [];

    const targets = Array.isArray(attack.targets) ? attack.targets : [];
    const ally = targets
      .filter((id) => !tokenIds.has(id))
      .map((id) => canvas.tokens?.get(id))
      .find((t) => t && isHostileSide(t.document) === mySide);
    // The newest attack decides; one on the actor itself is Riposte's.
    if (!ally) return [];
    if (!withinReach(actor, myToken, attackerToken)) return [];

    const label = game.i18n.localize("REDSTEEL.WeaponMaster.VigilantLabel");
    const hint = game.i18n.format("REDSTEEL.WeaponMaster.VigilantHint", {
      attacker: attackerToken.name,
      ally: ally.name,
    });
    return [
      {
        id: `vigilant-${message.id}`,
        kind: "vigilant",
        theme: "melee",
        costKind: "reaction",
        img: VIGILANT_ICON,
        label,
        hint,
        targetTokenId: attackerToken.id,
        ariaLabel: `${label}: ${hint}`,
      },
    ];
  }
  return [];
}

/**
 * Fallback icon of the "stop sustaining" chip, for a held spell whose Item can
 * no longer be found. Normally the chip shows the spell's own icon, so several
 * held spells can be told apart (user ruling).
 */
const STOP_SUSTAIN_ICON = "icons/magic/light/projectile-smoke-blue-light.webp";

/**
 * A spell held in a sustained cast, as ONE chip (user ruling: two identical
 * icons read as the same thing). Click applies this round's card of the spell
 * to whoever is targeted now, so a creature entering the area late still gets
 * hit; right-click lets the spell go.
 *
 * The held cast is the caster's Channeling effect (magicSkillBonuses.mjs
 * startChannelingForSpell): it carries the spell and its per-round upkeep,
 * pays the upkeep and re-rolls the spell each round (effects.mjs). Deleting it
 * ends all three at once, which is exactly what the system itself does when
 * the mana runs out.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function sustainChips(actor) {
  const combat = trackedCombat(actor);
  const chips = [];
  for (const effect of actor.effects ?? []) {
    const data = effect.getFlag?.("redsteel", "channelingData");
    if (!data) continue;
    const spell =
      actor.items.get(data.spellId) ?? game.items.get(data.spellId) ?? null;
    const spellName = spell?.localizedName ?? spell?.name ?? effect.name;
    const card = data.isSustained ? thisRoundCard(actor, data, combat) : null;
    const hint = card
      ? game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.SustainApply", {
          spell: spellName,
        })
      : game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.SustainNoCard");
    const hint2 = game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.StopSustain", {
      spell: spellName,
    });
    chips.push({
      id: `sustain-${effect.id}`,
      kind: "sustain",
      theme: "magic",
      effectId: effect.id,
      messageId: card?.id ?? "",
      spellName,
      img: spell?.img || STOP_SUSTAIN_ICON,
      hint,
      hint2,
      ariaLabel: `${spellName}: ${hint} ${hint2}`,
    });
  }
  return chips;
}

/**
 * This round's card of a held sustained spell. The re-rolled card
 * (resolveChannelingTick → finalizeRollsAndPostChat) is found by the
 * `spellId` / `casterUuid` / `castRound` it carries; only the newest card of
 * the spell is looked at, and a rerolled card is followed to its replacement.
 *
 * @param {Actor} actor
 * @param {object} data     The Channeling effect's channelingData.
 * @param {Combat|null} combat
 * @returns {ChatMessage|null}
 */
function thisRoundCard(actor, data, combat) {
  if (!combat) return null;
  const messages = game.messages?.contents ?? [];
  let match = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const flags = messages[i].flags?.redsteel ?? {};
    if (flags.spellId === data.spellId && flags.casterUuid === actor.uuid) {
      match = messages[i];
      break;
    }
  }
  const stamp = match?.flags?.redsteel?.castRound;
  if (
    !stamp ||
    stamp.combat !== combat.id ||
    Number(stamp.round) !== Number(combat.round)
  ) {
    return null;
  }
  const live = liveMessage(match);
  if (!live || !(live.flags?.attack || live.flags?.effects)) return null;
  return live;
}

/**
 * Break free of a Rooted or Shadowbound effect (escapeFollowup.mjs): repeat
 * the versus Test against the card that bound the actor, for 1 Action on its
 * own turn. One chip per binding effect whose card is still in chat.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function escapeChips(actor) {
  if (!isTrackedTurn(actor)) return [];
  if (getActionPools(actor).actions - getSpent(actor).actions < 1) return [];
  return escapeTargets(actor).map(({ effect, message, line }) => {
    const label = game.i18n.localize(effect.name);
    const hint =
      line.chance != null
        ? game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.EscapeFresh", {
            source: line.source,
            chance: line.chance,
          })
        : game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.Escape", {
            source: line.source,
            margin: line.margin,
          });
    return {
      id: `escape-${effect.id}`,
      kind: "escape",
      theme: "recall",
      effectId: effect.id,
      img: effect.img,
      label,
      hint,
      costKind: "action",
      ariaLabel: `${label}: ${hint}`,
    };
  });
}

/**
 * A stance with upkeep, on its holder's own turn and not yet paid for this
 * turn (stances.mjs), as ONE chip with the ability's icon, the way a held
 * sustained spell is (user ruling): click holds it (its action cost plus the
 * upkeep), right-click drops it. The chip leaves once either is done; a turn
 * ended without Hold drops the stance on its own.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function stanceChips(actor) {
  if (!isTrackedTurn(actor)) return [];
  const combat = trackedCombat(actor);
  const chips = [];
  for (const { effect, ability } of maintainedStances(actor)) {
    if (isStanceHeld(effect, combat)) continue;
    const label = ability.localizedName ?? ability.name;
    const hint = game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.HoldStance", {
      cost: holdCostLabel(ability),
    });
    const hint2 = game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.DropStance");
    chips.push({
      id: `stance-${effect.id}`,
      kind: "stance",
      theme: ability.system?.type === "ranged" ? "ranged" : "melee",
      effectId: effect.id,
      uuid: ability.uuid,
      img: ability.img,
      label,
      hint,
      hint2,
      ariaLabel: `${label}: ${hint} ${hint2}`,
    });
  }
  return chips;
}

/**
 * Keep the turn boundary Riposte reads. Registered once at init.
 */
export function registerSuggestionHooks() {
  Hooks.on("updateCombat", (_combat, changed) => {
    if (!("turn" in (changed ?? {})) && !("round" in (changed ?? {}))) return;
    turnStartMessageId = game.messages?.contents?.at(-1)?.id ?? null;
  });
  Hooks.on("deleteCombat", () => {
    turnStartMessageId = null;
  });
}

/**
 * Impale: Follow-up Attack (Nabodnutí: Navazující útok): a free attack once
 * this round's grant is in (impaleFollowup.mjs), on or off the actor's turn.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function impaleFollowupChips(actor) {
  const followup = abilityByKey(actor, IMPALE_FOLLOWUP_KEY);
  if (!followup || !hasImpaleFollowup(actor)) return [];
  return [abilityChip(followup, "REDSTEEL.Bg3Hotbar.Suggest.FreeAction", null)];
}

/**
 * Slip Through (Prosmýknutí, Servant of the Sword): offered for the rest of
 * the turn a charge or Dragon Strike landed in (slipThrough.mjs), aimed at
 * the opponent it hit. A Free action; the Stamina is paid when it is used.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function slipThroughChips(actor) {
  const pending = pendingSlipThrough(actor);
  if (!pending) return [];
  const slip = actor.items.find((i) => i.type === "ability" && isSlipThrough(i));
  if (!slip) return [];
  return [
    abilityChip(slip, "REDSTEEL.Bg3Hotbar.Suggest.FreeAction", pending.target.id),
  ];
}

/** Fallback icon of the Overwatch shot, for a status set without the ability. */
const OVERWATCH_ICON = "icons/skills/ranged/arrows-triple-yellow-red.webp";

/** States that take an archer's Opportunity Attacks away (movementZones.mjs). */
const CANNOT_SHOOT = [
  ...NO_OPPORTUNITY_ATTACK_STATUSES,
  "dead",
  "dying",
  "downed",
  "unconscious",
];

/**
 * Something to shoot with: the active set's main weapon for a character, any
 * weapon for anyone else. Bows, crossbows and thrown weapons count.
 */
function hasRangedWeapon(actor) {
  const ranged = (w) =>
    ["bow", "crossbow"].includes(w?.system?.class) || w?.system?.thrown === true;
  if (actor.type === "character") return ranged(resolveWeaponContext(actor)?.weapon);
  return actor.items.some((i) => i.type === "weapon" && ranged(i));
}

/**
 * Stráž (Overwatch): an enemy moved or cast inside the watched area this turn
 * (overwatch.mjs stamps it), so the archer may shoot them as an Opportunity
 * Attack. Costs the Reaction; gone once the shot is posted or the turn moves.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function overwatchChips(actor) {
  const trigger = overwatchTrigger(actor);
  if (!trigger) return [];
  if (getSpent(actor).reactions >= getActionPools(actor).reactions) return [];
  if (CANNOT_SHOOT.some((s) => actor.statuses?.has(s))) return [];
  if (!hasRangedWeapon(actor)) return [];
  const target = answerableAttacker(trigger.tokenId);
  if (!target) return [];

  const ability = abilityByKey(actor, OVERWATCH_KEY);
  const label = ability?.localizedName ?? game.i18n.localize(OVERWATCH_KEY);
  const hint = game.i18n.format(
    trigger.reason === "cast"
      ? "REDSTEEL.Overwatch.ShootCast"
      : "REDSTEEL.Overwatch.ShootMove",
    { target: target.name },
  );
  return [
    {
      id: `overwatch-${target.id}`,
      kind: "overwatch",
      theme: "ranged",
      uuid: ability?.uuid ?? "",
      costKind: "reaction",
      img: ability?.img || OVERWATCH_ICON,
      label,
      hint,
      targetTokenId: target.id,
      ariaLabel: `${label}: ${hint}`,
    },
  ];
}

/**
 * Combat abilities the actor may use right now, on or off its turn.
 * Suggestions only: an ability missing here can still be used from the
 * Combat Abilities dialog.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function combatProvider(actor) {
  if (!canvas?.ready) return [];
  return [...riposteChips(actor), ...braceChips(actor), ...lungeStepChips(actor),
    ...reactionChips(actor), ...overpowerChips(actor), ...vigilantChips(actor),
    ...overwatchChips(actor), ...impaleFollowupChips(actor),
    ...escapeChips(actor), ...sustainChips(actor), ...stanceChips(actor),
    ...slipThroughChips(actor)];
}

const PROVIDERS = [movementProvider, combatProvider];

/**
 * Every chip for the strip, or an empty array when the strip should not show:
 * no actor, not the viewer's to drive, or no started encounter it is in.
 * Whose turn it is is left to each provider: movement is own-turn only,
 * reactions happen on other people's turns.
 *
 * @param {Actor|null} actor
 * @returns {object[]}
 */
export function prepareSuggestions(actor, { facing = false } = {}) {
  if (!actor?.isOwner || !trackedCombat(actor)) return [];
  // Slow Movement's facing step: the player turns the token and confirms
  // before the move is declared. Only while nothing is locked yet, and only
  // on the actor's own turn (the strip dropping it is what ends the step).
  if (
    facing &&
    isTrackedTurn(actor) &&
    !getMovementLock(actor) &&
    !getSpent(actor).moved
  ) {
    const def = MOVEMENT_MODES.slow;
    const label = game.i18n.localize(def.labelKey);
    const hint = game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.SetFacing");
    return [
      {
        id: "movement-slow-facing",
        mode: "slow",
        icon: def.icon,
        label,
        hexLabel: hint,
        facing: true,
        ariaLabel: `${label}: ${hint}`,
      },
    ];
  }
  return PROVIDERS.flatMap((provider) => provider(actor) ?? []);
}
