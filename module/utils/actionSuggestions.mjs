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
  isTrackedTurn,
  trackedCombat,
} from "./actionTracker.mjs";
import {
  MOVEMENT_MODES,
  engagingEnemyIds,
  lockRemaining,
  movementBudget,
  tokenForActor,
} from "./movementZones.mjs";
import { areAdjacent } from "./positioning.mjs";
import { resolveWeaponContext } from "./weaponResolver.mjs";
import { hasImpaleFollowup, IMPALE_FOLLOWUP_KEY } from "./impaleFollowup.mjs";

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
  // Movement is a turn action: only on the actor's own turn.
  if (!isTrackedTurn(actor)) return [];
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
const RIPOSTE_KEY = "REDSTEEL.Items.Riposte.name";

/**
 * The newest chat message when the current turn began. Attack cards carry no
 * combat stamp, so this is what tells this turn's cards from older ones: only
 * messages after it count. Null until the first turn change this session (a
 * reload mid-turn); Riposte then falls back to "the attacker is the combatant
 * whose turn it is".
 */
let turnStartMessageId = null;

/**
 * Attacks that cannot themselves be answered with Counterattack or
 * Retaliatory strike: the two reactions, Riposte, and Shield Bash in both its
 * normal and small-shield form.
 */
const UNANSWERABLE_ATTACK_KEYS = new Set([
  COUNTERATTACK_KEY,
  RETALIATORY_KEY,
  "REDSTEEL.Items.Riposte.name",
  "REDSTEEL.Items.ShieldBash.name",
  "REDSTEEL.Items.ShieldBashSmallShield.name",
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
 * Counterattack or Retaliatory strike since. Read off the chat log, nothing
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
    if (
      (flags.abilityKey === COUNTERATTACK_KEY ||
        flags.abilityKey === RETALIATORY_KEY) &&
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
  return !tags.includes("opportunity");
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

/** One ability chip: the ability's own icon and name, and what it costs. */
function abilityChip(item, costKey, targetTokenId) {
  const label = item.localizedName ?? item.name;
  const cost = game.i18n.localize(costKey);
  return {
    id: `ability-${item.id}`,
    kind: "ability",
    abilityId: item.id,
    img: item.img,
    label,
    costLabel: cost,
    targetTokenId,
    ariaLabel: `${label}, ${cost}`,
  };
}

/**
 * Reactions to the defense this actor just rolled: Counterattack and
 * Retaliatory strike, aimed back at the attacker.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function reactionChips(actor) {
  const counter = abilityByKey(actor, COUNTERATTACK_KEY);
  const retaliatory = abilityByKey(actor, RETALIATORY_KEY);
  if (!counter && !retaliatory) return [];

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
  const riposte = abilityByKey(actor, RIPOSTE_KEY);
  if (!riposte) return [];
  if (getSpent(actor).reactions >= getActionPools(actor).reactions) return [];

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
    if (
      flags.redsteel?.abilityKey === RIPOSTE_KEY &&
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

    return [
      abilityChip(riposte, "REDSTEEL.Bg3Hotbar.Suggest.Reaction", attackerToken.id),
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
 * A spell held in a sustained cast can be let go. The held cast is the caster's
 * Channeling effect (magicSkillBonuses.mjs startChannelingForSpell): it carries
 * the spell and its per-round upkeep, pays the upkeep and re-rolls the spell
 * each round (effects.mjs). Deleting it ends all three at once, which is
 * exactly what the system itself does when the mana runs out.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function sustainChips(actor) {
  const chips = [];
  for (const effect of actor.effects ?? []) {
    const data = effect.getFlag?.("redsteel", "channelingData");
    if (!data) continue;
    const spell =
      actor.items.get(data.spellId) ?? game.items.get(data.spellId) ?? null;
    const spellName = spell?.localizedName ?? spell?.name ?? effect.name;
    const label = game.i18n.format("REDSTEEL.Bg3Hotbar.Suggest.StopSustain", {
      spell: spellName,
    });
    chips.push({
      id: `sustain-${effect.id}`,
      kind: "sustain",
      effectId: effect.id,
      img: spell?.img || STOP_SUSTAIN_ICON,
      label,
      ariaLabel: label,
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
 * Combat abilities the actor may use right now, on or off its turn.
 * Suggestions only: an ability missing here can still be used from the
 * Combat Abilities dialog.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function combatProvider(actor) {
  if (!canvas?.ready) return [];
  return [...riposteChips(actor),
    ...reactionChips(actor), ...impaleFollowupChips(actor),
    ...sustainChips(actor)];
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
  // The first chip of each later group opens with a divider, so movement and
  // combat read as two sets.
  const chips = [];
  for (const provider of PROVIDERS) {
    const group = provider(actor) ?? [];
    if (group.length && chips.length) group[0] = { ...group[0], groupStart: true };
    chips.push(...group);
  }
  return chips;
}
