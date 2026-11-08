/**
 * Elymas (the defensive mage specialisation): the node rules that live
 * outside node passives. Rulebook: docs/rules-source/rules/specializace-wip.md
 * r173-r199; Magic Defense itself is ruzne-info.md r864.
 *
 * - Magická obrana: Nestojí manu a Kritický úspěch +3% (magObranaMana): the
 *   holder's Magic Defense costs no Mana whatever the spell's rank, and its
 *   Critical Success threshold is 3 higher (magicDefenseManaCost and
 *   elymasMagicDefense, read by defense.mjs).
 * - Soustředěná obrana (soustredenaObrana, user ruling: lasts until the start
 *   of the holder's next turn): "1 akce, Mana 0: Bonus +15% na Magickou
 *   obranu. Ruší boky pro účely Magické obrany. Umožňuje obranu proti kouzlům
 *   seslaným do zad, avšak bez bonusu." The `focused_defense` status
 *   (config.mjs, defaultTurns 1), taken from an on-turn hotbar chip that pays
 *   1 Action (takeFocusedDefense). While it holds, the magic profile
 *   (defense.mjs buildDefenseProfile) takes +15 unless the spell came from
 *   behind, gives back the flank bonus a single-target spell baked into its
 *   Magic ATK, and the defense dialog keeps the Magic Defense button against
 *   a spell from behind (focusedBackSpellDefense). "Zamezuje použití akce
 *   Soustředěný útok": Focused Attack is not built, nothing to prevent.
 *   - soKrit: Critical Success +10 on Magic Defense while focused.
 *   - soReakce: +1 Reaction while focused, as its own one-turn status
 *     (`focused_defense_reaction`, the improved_fast_reaction pattern) that is
 *     tagged to end with the stance (flags.redsteel.conditionParent).
 *   - soRedukce: a spell card's damage is halved once more on a focused holder
 *     (focusedMagicHalving, read by applyDamage.mjs at the stage the spell
 *     half damage box acts; the two multiply).
 * - Magická ozvěna (magickaOzvena): a Critical Magic Defense leaves 50% off
 *   the next spell's Mana (settleMagicEcho → nextSpellBonus.mjs
 *   manaDiscountPct).
 * - Může 1x za den opakovat hod na Usměrňování (opakovaniUsmernovani): a node
 *   reroll pool in rerolls.mjs, reached from cast and Magic Defense cards
 *   through the "channeling" token (rerolls.mjs channelingRerollTokens).
 * - Magický protiútok (magProtiutok, r188): "1 reakce, Mana X: Po úspěšné
 *   Magické obraně může na útočníka seslat útočné kouzlo Učednického stupně,
 *   které stojí jednu akci." A hotbar chip after a Magic Defense card that
 *   held against a spell (magicCounterattackChips); the cast dialog lists only
 *   the spells that fit (counterattackSpellFits), and performCast
 *   (castSpell.mjs) pays the Reaction here (payMagicCounterattack) instead of
 *   the spell's own action cost.
 *   - mpExpert / mpMistr: the rank cap becomes Expert / Master.
 *   - mpUtok10: Magic ATK +10 when the counterattack spell is Apprentice.
 *   - mpVolnaAkce: the first counterattack each round is a Free action.
 *   - mpKritNeuspech: the counterattack cast's channeling Critical Failure
 *     threshold is 5 higher (counterattackCastMods).
 * - Rozšiřuje rozsah Magické obrany o 1,5m (rozsahObrany), read the same as
 *   the "Area defense" feature (odbornosti.md r344): one Magic Defense roll
 *   also answers the card for every ally standing next to the holder that the
 *   same spell targeted (areaDefenseCovers). Apply Damage reads the covered
 *   ids off the defense card (applyDamage.mjs findAnsweringDefense).
 *
 * Kept free of imports from the cast pipeline, the defense dialog and Apply
 * Damage, which all import this file. The cast is launched through
 * game.redsteel.castSpell.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import {
  getActionPools,
  getSpent,
  isTrackedTurn,
  markBonusSource,
  spend,
  spendForItems,
  trackedCombat,
} from "./actionTracker.mjs";
import { SECTOR, areAdjacent } from "./positioning.mjs";
import { parseActionCost } from "./spellbook.mjs";
import { addNextSpellBonus } from "./nextSpellBonus.mjs";

const SYSTEM_ID = "redsteel";
const SPEC = "elymas";

/** Statuses (helpers/config.mjs). */
export const FOCUSED_DEFENSE_STATUS = "focused_defense";
export const FOCUSED_DEFENSE_REACTION_STATUS = "focused_defense_reaction";

/** Soustředěná obrana: +15% na Magickou obranu. */
export const FOCUSED_DEFENSE_BONUS = 15;
/** soKrit: Kritický úspěch Magické obrany +10%. */
const FOCUSED_DEFENSE_CRIT = 10;
/** magObranaMana: Kritický úspěch +3%. */
const MAGIC_DEFENSE_MANA_CRIT = 3;
/** Magická ozvěna: sleva 50% na příští Usměrňování. */
const MAGIC_ECHO_PCT = 50;
/** mpUtok10: Magický útok +10% pro Učedníka. */
const COUNTER_APPRENTICE_ATTACK = 10;
/** mpKritNeuspech: Kritický neúspěch -5%. */
const COUNTER_CRIT_FAIL_EASE = 5;

/** The "Area defense" feature, the same rule as rozsahObrany. */
const AREA_DEFENSE_KEY = "REDSTEEL.Items.AreaDefense.name";
const AREA_DEFENSE_NAME = "Area defense";

/** The round's free counterattack (mpVolnaAkce), in the tracker's record. */
const FREE_COUNTER_SOURCE = "elymasFreeCounterattack";

const FOCUSED_DEFENSE_ICON = "icons/magic/defensive/shield-barrier-deflect-teal.webp";
const COUNTERATTACK_ICON =
  "icons/magic/defensive/shield-barrier-flaming-pentagon-blue-yellow.webp";

const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.Elymas.${key}`, data)
    : game.i18n.localize(`REDSTEEL.Elymas.${key}`);

const nodeLabel = (node) =>
  game.i18n.localize(
    `REDSTEEL.Actor.Specialisations.${SPEC}.nodes.${node}.label`,
  );

/* -------------------------------------------- */
/*  Shared                                      */
/* -------------------------------------------- */

/** Does this actor hold this Elymas node? */
export function hasElymasNode(actor, node) {
  return !!actor && actorHasSpecNode(actor, SPEC, node);
}

/** Is Focused Defense up on this actor? */
export function hasFocusedDefense(actor) {
  return !!actor?.statuses?.has(FOCUSED_DEFENSE_STATUS);
}

function holderToken(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token?.object ?? null;
  return actor.getActiveTokens?.(false, false)?.[0] ?? null;
}

function actorTokenIds(actor) {
  return new Set(
    actor.isToken
      ? [actor.token?.id].filter(Boolean)
      : actor.getActiveTokens(false, true).map((t) => t.id),
  );
}

function takeControl(token) {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length !== 1 || controlled[0] !== token) {
    token.control({ releaseOthers: true });
  }
}

/** A packet (defense.mjs buildAttackPacket) or card answering a spell. */
export function isSpellPacket(attack) {
  return attack?.isSpell === true || attack?.spellRank != null;
}

/* -------------------------------------------- */
/*  Magic Defense (defense.mjs)                 */
/* -------------------------------------------- */

/**
 * Mana this actor pays for Magic Defense at a price of `cost`
 * (magObranaMana: none).
 *
 * @param {Actor} actor
 * @param {number} cost  the price by the answered spell's rank
 * @returns {number}
 */
export function magicDefenseManaCost(actor, cost) {
  if (hasElymasNode(actor, "magObranaMana")) return 0;
  return Math.max(0, Number(cost) || 0);
}

/**
 * What the Elymas nodes and Focused Defense add to one Magic Defense, read by
 * the magic profile (defense.mjs buildDefenseProfile) for the roll and for
 * NPC auto-defense scoring alike.
 *
 * - focusedBonus: Focused Defense's +15, not against a spell from behind.
 * - flankCancel: Focused Defense "ruší boky": the flank bonus the spell card
 *   stamped into its Magic ATK (`magicFlankBonus`, only ever set on a single
 *   positioned target) is added back onto the defense when this defender is
 *   the one stood in the flank.
 * - critBonus: magObranaMana's +3, and soKrit's +10 while focused.
 *
 * @param {Actor} actor
 * @param {{attack?: object|null, sector?: string|null}} params
 * @returns {{focusedBonus: number, flankCancel: number, critBonus: number}}
 */
export function elymasMagicDefense(actor, { attack = null, sector = null } = {}) {
  const focused = hasFocusedDefense(actor);
  const focusedBonus =
    focused && sector !== SECTOR.BACK ? FOCUSED_DEFENSE_BONUS : 0;
  const flankCancel =
    focused && sector === SECTOR.FLANK
      ? Math.max(0, Number(attack?.magicFlankBonus) || 0)
      : 0;
  const critBonus =
    (hasElymasNode(actor, "magObranaMana") ? MAGIC_DEFENSE_MANA_CRIT : 0) +
    (focused && hasElymasNode(actor, "soKrit") ? FOCUSED_DEFENSE_CRIT : 0);
  return { focusedBonus, flankCancel, critBonus };
}

/**
 * Focused Defense lets Magic Defense answer a spell cast into the back
 * ("Umožňuje obranu proti kouzlům seslaným do zad"). True only for a spell,
 * only while the stance holds.
 *
 * @param {Actor} actor
 * @param {object|null} attack  the packet being answered
 */
export function focusedBackSpellDefense(actor, attack) {
  return hasFocusedDefense(actor) && isSpellPacket(attack);
}

/**
 * Magická ozvěna: a Critical Magic Defense leaves 50% off the next spell's
 * Mana. Returns the card line, or "" when nothing was earned.
 *
 * @param {Actor} actor
 * @returns {Promise<string>}
 */
export async function settleMagicEcho(actor) {
  if (!hasElymasNode(actor, "magickaOzvena") || !actor.isOwner) return "";
  await addNextSpellBonus(actor, { manaDiscountPct: MAGIC_ECHO_PCT });
  return `<p class="rs-elymas-note" style="text-align:center">${L("EchoEarned", {
    pct: MAGIC_ECHO_PCT,
  })}</p>`;
}

/**
 * Does this actor cover adjacent allies with one Magic Defense (rozsahObrany
 * or the Area defense feature)?
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasAreaDefense(actor) {
  if (hasElymasNode(actor, "rozsahObrany")) return true;
  return !!actor?.items?.some(
    (i) =>
      i.type === "feature" &&
      (i.system?.localizationKey === AREA_DEFENSE_KEY ||
        i.name === AREA_DEFENSE_NAME),
  );
}

/**
 * The allies one Magic Defense also answers for: every other token the same
 * spell card targeted that stands next to the defender and shares its
 * disposition. Empty when the defender has no Area Defense, the card is not
 * a spell, or it named nobody else.
 *
 * @param {Actor} actor
 * @param {TokenDocument|Token|null} defenderToken
 * @param {object|null} attack  the packet being answered (needs messageId)
 * @param {string|null} attackerTokenId
 * @returns {string[]} token ids
 */
export function areaDefenseCovers(actor, defenderToken, attack, attackerTokenId = null) {
  if (!hasAreaDefense(actor) || !isSpellPacket(attack)) return [];
  const defender = defenderToken?.document ?? defenderToken;
  if (!defender) return [];
  const message = attack?.messageId ? game.messages.get(attack.messageId) : null;
  const targets = message?.flags?.attack?.targets;
  if (!Array.isArray(targets) || targets.length < 2) return [];
  const scene = defender.parent;
  const covered = [];
  for (const id of new Set(targets)) {
    if (!id || id === defender.id || id === attackerTokenId) continue;
    const other = scene?.tokens?.get(id);
    if (!other?.actor) continue;
    if (other.disposition !== defender.disposition) continue;
    if (!areAdjacent(defender.object ?? defender, other.object ?? other)) continue;
    covered.push(id);
  }
  return covered;
}

/** Names for the covered-allies card line. */
export function coveredNames(defenderToken, ids) {
  const defender = defenderToken?.document ?? defenderToken;
  const scene = defender?.parent ?? canvas.scene;
  return ids
    .map((id) => scene?.tokens?.get(id)?.name)
    .filter(Boolean)
    .map((name) => foundry.utils.escapeHTML(name))
    .join(", ");
}

/* -------------------------------------------- */
/*  Apply Damage (applyDamage.mjs)              */
/* -------------------------------------------- */

/**
 * soRedukce: "Redukce magického zranění 50%" while focused. One halving for a
 * spell card's damage (never a weapon's enchant damage, never a miracle),
 * applied at the spell half damage box's stage so the two multiply.
 *
 * @param {Actor} actor  the target
 * @param {ChatMessage|null} message  the attack card
 * @returns {0|1}
 */
export function focusedMagicHalving(actor, message) {
  if (message?.flags?.attack?.isSpell !== true) return 0;
  if (message.flags?.redsteel?.spellSchool === "divine") return 0;
  if (!hasFocusedDefense(actor) || !hasElymasNode(actor, "soRedukce")) return 0;
  return 1;
}

/* -------------------------------------------- */
/*  Focused Defense (the chip)                  */
/* -------------------------------------------- */

/**
 * Take up Focused Defense: 1 Action (a non-attack action, so a normal Aim is
 * lost the way any other is), then the stance, and with soReakce the extra
 * Reaction tagged to end with it.
 *
 * @param {Actor} actor
 */
export async function takeFocusedDefense(actor) {
  if (!actor?.isOwner || !hasElymasNode(actor, "soustredenaObrana")) return;
  if (hasFocusedDefense(actor)) return;
  // A bare cost line rather than an item: the tracker reads only that.
  await spendForItems(actor, {
    type: "ability",
    name: nodeLabel("soustredenaObrana"),
    system: { actionCost: "1 Action" },
  });
  const stance = await game.redsteel.applyEffect(actor, FOCUSED_DEFENSE_STATUS);
  if (!stance) return;
  if (hasElymasNode(actor, "soReakce")) {
    const extra = await game.redsteel.applyEffect(
      actor,
      FOCUSED_DEFENSE_REACTION_STATUS,
    );
    // Ends with the stance (documents/effects.mjs deleteActiveEffect hook).
    if (extra && actor.effects.has(stance.id)) {
      await extra.setFlag(SYSTEM_ID, "conditionParent", stance.id);
    }
  }
  const lines = [L("FocusedTaken", { name: actor.name, bonus: FOCUSED_DEFENSE_BONUS })];
  if (hasElymasNode(actor, "soKrit")) lines.push(L("FocusedCrit"));
  if (hasElymasNode(actor, "soReakce")) lines.push(L("FocusedReaction"));
  if (hasElymasNode(actor, "soRedukce")) lines.push(L("FocusedReduction"));
  const token = holderToken(actor);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
    flavor: `<div style="display:flex;align-items:center;gap:8px;font-weight:bold;">
        <img src="${FOCUSED_DEFENSE_ICON}" width="36" height="36">
        <span>${nodeLabel("soustredenaObrana")}</span>
      </div>
      <hr>
      ${lines.map((l) => `<p style="text-align:center;">${l}</p>`).join("")}`,
  });
}

/* -------------------------------------------- */
/*  Magic Counterattack                         */
/* -------------------------------------------- */

/** Spell ranks a counterattack may use with this actor's nodes. */
function counterattackRanks(actor) {
  const ranks = ["wild", "apprentice"];
  if (hasElymasNode(actor, "mpExpert")) ranks.push("expert");
  if (hasElymasNode(actor, "mpMistr")) ranks.push("expert", "master");
  return new Set(ranks);
}

/** The highest rank the counterattack reaches, for the chip's hint. */
function counterattackRankLabel(actor) {
  const rank = hasElymasNode(actor, "mpMistr")
    ? "master"
    : hasElymasNode(actor, "mpExpert")
      ? "expert"
      : "apprentice";
  return game.i18n.localize(`REDSTEEL.Item.Spell.FIELDS.${rank}.label`);
}

/**
 * Can this spell be a Magic Counterattack for this actor? "útočné kouzlo
 * Učednického stupně, které stojí jednu akci": an offensive spell (not a heal,
 * not a miracle) of an allowed rank whose action cost is one Action.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {boolean}
 */
export function counterattackSpellFits(actor, spell) {
  if (spell?.type !== "spell") return false;
  const sys = spell.system ?? {};
  if (sys.option === "divine") return false;
  if (sys.isOffensive !== true || sys.isHealing) return false;
  const rank = String(sys.rank || "wild").toLowerCase();
  if (!counterattackRanks(actor).has(rank)) return false;
  return parseActionCost(sys.actionCost, sys.sustained).actions === 1;
}

/** Is this round's free counterattack (mpVolnaAkce) still there? */
function hasFreeCounterattack(actor) {
  if (!hasElymasNode(actor, "mpVolnaAkce") || !trackedCombat(actor)) return false;
  return !getSpent(actor).bonusSources.includes(FREE_COUNTER_SOURCE);
}

/**
 * Pay for a counterattack cast (castSpell.mjs performCast, in place of the
 * spell's own action cost): the round's free one, or 1 Reaction.
 *
 * @param {Actor} actor
 * @returns {Promise<{free: boolean}>}
 */
export async function payMagicCounterattack(actor) {
  if (hasFreeCounterattack(actor)) {
    await markBonusSource(actor, FREE_COUNTER_SOURCE);
    return { free: true };
  }
  await spend(actor, { reactions: 1 });
  return { free: false };
}

/**
 * What the counterattack nodes change on this cast (magicSkillBonuses.mjs).
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {object|null} counterattack  the cast's counterattack option
 * @returns {{attackBonus: number, critFailEase: number}}
 */
export function counterattackCastMods(actor, spell, counterattack) {
  if (!counterattack) return { attackBonus: 0, critFailEase: 0 };
  const rank = String(spell?.system?.rank || "wild").toLowerCase();
  return {
    attackBonus:
      rank === "apprentice" && hasElymasNode(actor, "mpUtok10")
        ? COUNTER_APPRENTICE_ATTACK
        : 0,
    critFailEase: hasElymasNode(actor, "mpKritNeuspech")
      ? COUNTER_CRIT_FAIL_EASE
      : 0,
  };
}

function stampIsCurrent(stamp, combat) {
  if (!stamp || !combat) return false;
  return (
    stamp.id === combat.id &&
    Number(stamp.round) === Number(combat.round) &&
    Number(stamp.turn) === Number(combat.turn)
  );
}

/**
 * The Magic Defense that opens a counterattack right now, or null: this
 * actor's newest Magic Defense card, rolled this turn, that held against a
 * spell whose caster is still on the canvas, with no counterattack cast off
 * it yet. The Riposte / Counterattack staleness rules (actionSuggestions.mjs
 * defenseIsCurrent): it lapses when the turn moves on.
 *
 * @param {Actor} actor
 * @returns {{messageId: string, attackerTokenId: string,
 *   defenderTokenId: string}|null}
 */
export function pendingMagicCounterattack(actor) {
  if (!hasElymasNode(actor, "magProtiutok")) return null;
  const combat = trackedCombat(actor);
  if (!combat) return null;
  const tokenIds = actorTokenIds(actor);
  if (!tokenIds.size) return null;
  const messages = game.messages?.contents ?? [];
  const answered = new Set();
  for (let i = messages.length - 1; i >= 0; i--) {
    const flags = messages[i].flags?.redsteel ?? {};
    if (flags.magicCounterattack?.defenseMessageId) {
      answered.add(flags.magicCounterattack.defenseMessageId);
    }
    const record = flags.magicDefense;
    if (!record || flags.rerolledAway) continue;
    if (!tokenIds.has(record.defenderTokenId)) continue;
    // The newest Magic Defense is the only one that can open it.
    if (!stampIsCurrent(record.combat, combat)) return null;
    if (record.succeeded !== true || record.spellAttack !== true) return null;
    // A reroll replaced an earlier card: a counterattack off either one
    // spends it.
    const ids = [messages[i].id, flags.rerolledFrom].filter(Boolean);
    if (ids.some((id) => answered.has(id))) return null;
    const attacker = record.attackerTokenId
      ? canvas.tokens?.get(record.attackerTokenId)
      : null;
    if (!attacker || attacker.actor?.statuses?.has("dead")) return null;
    if (!attacker.visible && !game.user.isGM) return null;
    return {
      messageId: messages[i].id,
      attackerTokenId: attacker.id,
      defenderTokenId: record.defenderTokenId,
    };
  }
  return null;
}

/* -------------------------------------------- */
/*  Hotbar chips (actionSuggestions.mjs)        */
/* -------------------------------------------- */

/**
 * The Elymas chips for the hotbar's suggestion strip: Focused Defense on the
 * holder's own turn while an Action is left and the stance is not up, and
 * Magic Counterattack after a Magic Defense that held (a Reaction, or the
 * round's Free one with mpVolnaAkce).
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
export function elymasChips(actor) {
  if (actor?.type !== "character") return [];
  const chips = [];
  if (
    hasElymasNode(actor, "soustredenaObrana") &&
    !hasFocusedDefense(actor) &&
    isTrackedTurn(actor) &&
    getSpent(actor).actions < getActionPools(actor).actions
  ) {
    const label = nodeLabel("soustredenaObrana");
    const hint = L("FocusedDefenseDescription", { bonus: FOCUSED_DEFENSE_BONUS });
    const cost = game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.OneAction");
    chips.push({
      id: "elymas-focused-defense",
      kind: "elymas",
      op: "focusedDefense",
      theme: "magic",
      costKind: "action",
      img: FOCUSED_DEFENSE_ICON,
      label,
      hint: cost,
      hint2: hint,
      ariaLabel: `${label}, ${cost}: ${hint}`,
    });
  }
  const pending = pendingMagicCounterattack(actor);
  if (pending) {
    const free = hasFreeCounterattack(actor);
    const reactionLeft =
      getSpent(actor).reactions < getActionPools(actor).reactions;
    if (free || reactionLeft) {
      const label = nodeLabel("magProtiutok");
      const target = canvas.tokens?.get(pending.attackerTokenId);
      const hint = L(free ? "CounterHintFree" : "CounterHint", {
        target: target?.name ?? "",
        rank: counterattackRankLabel(actor),
      });
      chips.push({
        id: `elymas-counterattack-${pending.messageId}`,
        kind: "elymas",
        op: "counterattack",
        theme: "magic",
        costKind: free ? "free" : "reaction",
        img: COUNTERATTACK_ICON,
        label,
        hint,
        messageId: pending.messageId,
        targetTokenId: pending.attackerTokenId,
        ariaLabel: `${label}: ${hint}`,
      });
    }
  }
  return chips;
}

/**
 * An Elymas chip was clicked (redsteelHotbar.mjs). Focused Defense is taken
 * at once; Magic Counterattack targets the attacker and opens the cast dialog
 * with only the spells that fit.
 *
 * @param {Actor} actor
 * @param {DOMStringMap} data  the chip's dataset (`op`, `messageId`)
 */
export async function useElymasChip(actor, data = {}) {
  const token = holderToken(actor);
  if (!token?.isOwner) return;
  if (data.op === "focusedDefense") {
    await takeFocusedDefense(actor);
    return;
  }
  if (data.op !== "counterattack") return;
  const pending = pendingMagicCounterattack(actor);
  if (!pending || (data.messageId && pending.messageId !== data.messageId)) {
    return;
  }
  const spellFilter = (spell) => counterattackSpellFits(actor, spell);
  if (!actor.items.some(spellFilter)) {
    ui.notifications.warn(
      L("CounterNoSpell", { rank: counterattackRankLabel(actor) }),
    );
    return;
  }
  const target = canvas.tokens?.get(pending.attackerTokenId);
  if (target) target.setTarget(true, { releaseOthers: true });
  takeControl(token);
  await game.redsteel.castSpell({
    spellFilter,
    counterattack: {
      defenseMessageId: pending.messageId,
      attackerTokenId: pending.attackerTokenId,
    },
  });
}
