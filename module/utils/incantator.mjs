/**
 * Incantator (the focus mage specialisation): the node rules that live
 * outside node passives. Rulebook: docs/rules-source/rules/specializace-wip.md
 * r337-r366; focus items ruzne-info.md r969 (utils/focusItem.mjs).
 *
 * - Incantátor bez Ohniskového předmětu: Postih -10%; Šance na Kritické
 *   selhání +2% (doctrine rank I and up, not a node): a non-Wild spell cast
 *   with no focus in use takes -10 on the cast (calculateAttackBonuses, so the
 *   cast dialog's chance shows it) and a channeling Critical Failure threshold
 *   2 lower (incantatorCastCrit). Tagged on the card.
 * - Ohniskový předmět: Kritický rozsah +5 (ohniskovyPredmet): +5 on the cast's
 *   critical degree d20 while a focus is in use (incantatorCritRange).
 * - Soustředění: Magický útok +5% a Kritický úspěch +1% (soustredeni, user
 *   ruling: per Focus spent on the cast): +5 Magic ATK and +1 to the cast's
 *   Critical Success threshold for each Focus (incantatorMagicAttack,
 *   incantatorCastCrit).
 * - Rychlé soustředění (rychleSoustredeni): the Quick Focus item. 15 Mana
 *   banks one Focus, at most twice a round (useQuickFocus); the next cast adds
 *   what is banked to its Focus (takeQuickFocus, castSpell.mjs performCast).
 *   A Focus banked in combat lapses when the turn it was banked in ends.
 * - Katalyzátor (katalyzator): the cast dialog's Catalyst toggle, the Hastened
 *   Cast pattern: Critical Success threshold +15, Critical Failure threshold
 *   -5 for that cast.
 * - Vlna energie (vlnaEnergie): a cast that is a Critical Success leaves its
 *   own Mana cost (at least 5) off the next spell (settleWaveOfEnergy, into
 *   nextSpellBonus.mjs).
 * - Magické útoky stojí obránce dvakrát více many (dvojnasobnaMana): the
 *   holder's spell card stamps `defenderManaMultiplier: 2`, which the Magic
 *   Defense price in defense.mjs multiplies by.
 * - Dlouhý odpočinek 50 many (dlouhyOdpocinek): the Long Rest restores at
 *   least 50 Mana (longRestMana, otherActions.mjs).
 * - Stabilizace zdroje (stabilizaceZdroje): after Accept on a crit fail
 *   prompt, the holder may roll 1d100 to shift the drawn degree one step
 *   milder (1-50) or worse (51-100), or pay 10% of maximum Mana and pick
 *   (stabilizeCritFail, from redsteel.mjs).
 * - Precizní inkantace (precizniInkantace): pay the spell's cost again to
 *   reroll a failed effect roll on the holder's own spell card, or to force a
 *   target who resisted the spell's versus Test to roll it again (the chat
 *   buttons registered in registerIncantatorHooks). Not for the Mental Duel.
 * - Moudrá kniha (moudraKniha): the grimoire counts as a focus
 *   (focusItem.mjs).
 *
 * Kept free of imports from the cast pipeline and the defense dialog, which
 * import this file. Rerolls go through game.redsteel.executeReroll.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { trackedCombat } from "./actionTracker.mjs";
import { hasFocusItem } from "./focusItem.mjs";
import { getBaseSpellManaCost } from "./lindarCharge.mjs";
import { addNextSpellBonus } from "./nextSpellBonus.mjs";

const SYSTEM_ID = "redsteel";
const SPEC = "incantator";
const SOCKET = "system.redsteel";
const SOCKET_FORCE_REROLL = "incantatorForceReroll";

/** Bez Ohniskového předmětu: Postih -10%; Šance na Kritické selhání +2%. */
const NO_FOCUS_CAST = -10;
const NO_FOCUS_CRIT_FAIL = 2;
/** Ohniskový předmět: Kritický rozsah +5. */
const FOCUS_CRIT_RANGE = 5;
/** Soustředění, per Focus: Magický útok +5%, Kritický úspěch +1%. */
const FOCUS_MAGIC_ATTACK = 5;
const FOCUS_CRIT_SUCCESS = 1;
/** Rychlé soustředění: 15 many, jedno Soustředění, max. dvakrát za kolo. */
export const QUICK_FOCUS_MANA = 15;
const QUICK_FOCUS_MAX = 2;
const QUICK_FOCUS_FLAG = "quickFocus";
/** Katalyzátor: Kritický úspěch +15%, Kritický neúspěch +5%. */
const CATALYST_CRIT_SUCCESS = 15;
const CATALYST_CRIT_FAIL = 5;
/** Vlna energie: vždy minimálně 5 many. */
const WAVE_MIN = 5;
/** Dlouhý odpočinek 50 many. */
const LONG_REST_MANA = 50;
/** Stabilizace zdroje: 10% maximální many. */
const STABILIZE_PCT = 10;

const QUICK_FOCUS_KEY = "REDSTEEL.Items.QuickFocus.name";
const PRECISE_KEY = "REDSTEEL.Items.PreciseIncantation.name";
const STABILIZATION_KEY = "REDSTEEL.Items.SourceStabilization.name";
const CATALYST_KEY = "REDSTEEL.Items.Catalyst.name";

const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.Incantator.${key}`, data)
    : game.i18n.localize(`REDSTEEL.Incantator.${key}`);

const nodeLabel = (node) =>
  game.i18n.localize(
    `REDSTEEL.Actor.Specialisations.${SPEC}.nodes.${node}.label`,
  );

const esc = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/* -------------------------------------------- */
/*  Shared                                      */
/* -------------------------------------------- */

/** Does this actor hold this Incantator node? */
export function hasIncantatorNode(actor, node) {
  return !!actor && actorHasSpecNode(actor, SPEC, node);
}

function isMiracleSpell(spell) {
  return spell?.type === "spell" && spell.system?.option === "divine";
}

function isKeyed(item, key, englishName) {
  return item?.system?.localizationKey === key || item?.name === englishName;
}

/**
 * Does this cast take the Incantator penalty for casting without a focus?
 * An actor with the Incantator doctrine (rank I and up), a spell that is
 * neither Wild nor a miracle, and no focus in use.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {boolean}
 */
export function castsWithoutFocus(actor, spell) {
  if ((Number(actor?.system?.doctrines?.incantator?.value) || 0) < 1) return false;
  if (!spell || isMiracleSpell(spell)) return false;
  if (String(spell.system?.rank || "wild").toLowerCase() === "wild") return false;
  return !hasFocusItem(actor);
}

/* -------------------------------------------- */
/*  The cast (magicSkillBonuses.mjs)            */
/* -------------------------------------------- */

/**
 * The cast-roll bonus, read inside calculateAttackBonuses so the cast and the
 * dialog's Cast Chance agree: -10 without a focus.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {number}
 */
export function incantatorCastBonus(actor, spell) {
  return castsWithoutFocus(actor, spell) ? NO_FOCUS_CAST : 0;
}

/**
 * Shifts on the cast's critical thresholds for this cast.
 *
 * - successBonus: Soustředění +1 per Focus, Katalyzátor +15.
 * - failEase: added to the Critical Failure threshold (negative = fumbles
 *   more often): -2 without a focus, -5 with Katalyzátor.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {{focusSpent?: number, catalyst?: boolean}} [options]
 * @returns {{successBonus: number, failEase: number}}
 */
export function incantatorCastCrit(
  actor,
  spell,
  { focusSpent = 0, catalyst = false } = {},
) {
  if (!actor || isMiracleSpell(spell)) return { successBonus: 0, failEase: 0 };
  const focus = Math.max(0, Number(focusSpent) || 0);
  const catalysing = catalyst && hasIncantatorNode(actor, "katalyzator");
  const successBonus =
    (hasIncantatorNode(actor, "soustredeni") ? focus * FOCUS_CRIT_SUCCESS : 0) +
    (catalysing ? CATALYST_CRIT_SUCCESS : 0);
  const failEase =
    -(castsWithoutFocus(actor, spell) ? NO_FOCUS_CRIT_FAIL : 0) -
    (catalysing ? CATALYST_CRIT_FAIL : 0);
  return { successBonus, failEase };
}

/**
 * Soustředění: Magic ATK +5 per Focus spent on the cast.
 *
 * @param {Actor} actor
 * @param {{focusSpent?: number}} [options]
 * @returns {number}
 */
export function incantatorMagicAttack(actor, { focusSpent = 0 } = {}) {
  if (!hasIncantatorNode(actor, "soustredeni")) return 0;
  return Math.max(0, Number(focusSpent) || 0) * FOCUS_MAGIC_ATTACK;
}

/**
 * Ohniskový předmět: Critical Range +5 on the cast's degree d20 while a
 * focus is in use.
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function incantatorCritRange(actor) {
  return hasIncantatorNode(actor, "ohniskovyPredmet") && hasFocusItem(actor)
    ? FOCUS_CRIT_RANGE
    : 0;
}

/** Is the Catalyst toggle offered to this actor? */
export function hasCatalyst(actor) {
  return hasIncantatorNode(actor, "katalyzator");
}

/**
 * The Incantator tags for a cast card: no focus, Catalyst, and Soustředění's
 * per-Focus bonus.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {{focusSpent?: number, catalyst?: boolean}} [options]
 * @returns {string} HTML
 */
export function incantatorCastTags(
  actor,
  spell,
  { focusSpent = 0, catalyst = false } = {},
) {
  if (!actor || isMiracleSpell(spell)) return "";
  const tags = [];
  if (castsWithoutFocus(actor, spell)) {
    tags.push(L("TagNoFocus", { penalty: NO_FOCUS_CAST, fail: NO_FOCUS_CRIT_FAIL }));
  }
  if (catalyst && hasCatalyst(actor)) {
    tags.push(
      L("TagCatalyst", { success: CATALYST_CRIT_SUCCESS, fail: CATALYST_CRIT_FAIL }),
    );
  }
  const focus = Math.max(0, Number(focusSpent) || 0);
  if (focus && hasIncantatorNode(actor, "soustredeni")) {
    tags.push(
      L("TagFocus", {
        attack: focus * FOCUS_MAGIC_ATTACK,
        crit: focus * FOCUS_CRIT_SUCCESS,
      }),
    );
  }
  if (incantatorCritRange(actor)) {
    tags.push(L("TagFocusRange", { range: FOCUS_CRIT_RANGE }));
  }
  return tags
    .map((t) => `<span class="action-tag incantator ">${esc(t)}</span>`)
    .join("");
}

/**
 * Magické útoky stojí obránce dvakrát více many: the multiplier the holder's
 * spell card carries for the defender's Magic Defense price.
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function defenderManaMultiplier(actor) {
  return hasIncantatorNode(actor, "dvojnasobnaMana") ? 2 : 1;
}

/**
 * The Mana Precise Incantation costs on this spell, stamped on the holder's
 * cast card, or null when it is not offered (no node, a miracle, a Blood
 * spell, whose cost is Life rather than Mana).
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {number|null}
 */
export function preciseIncantationCost(actor, spell) {
  if (!hasIncantatorNode(actor, "precizniInkantace")) return null;
  if (isMiracleSpell(spell) || spell?.system?.type === "blood") return null;
  return getBaseSpellManaCost(actor, spell);
}

/**
 * Vlna energie: a cast that is a real Critical Success (judged on its
 * Channeling, never "No Channeling Evaluation") leaves the spell's own Mana
 * cost off the next spell, at least 5. Returns the card line, or "".
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {{critSuccess?: boolean}} attackResults
 * @returns {Promise<string>}
 */
export async function settleWaveOfEnergy(actor, spell, attackResults) {
  if (!hasIncantatorNode(actor, "vlnaEnergie")) return "";
  if (attackResults?.critSuccess !== true || isMiracleSpell(spell)) return "";
  if (!actor.isOwner) return "";
  const amount = Math.max(WAVE_MIN, Number(spell?.system?.cost) || 0);
  await addNextSpellBonus(actor, { manaDiscount: amount });
  return `<p class="rs-incantator-note" style="text-align:center">${esc(
    L("WaveEarned", { amount }),
  )}</p>`;
}

/**
 * Dlouhý odpočinek 50 many: the Long Rest restores at least 50 Mana.
 *
 * @param {Actor} actor
 * @param {number} mana  what the doctrine rest would restore
 * @returns {number}
 */
export function longRestMana(actor, mana) {
  return hasIncantatorNode(actor, "dlouhyOdpocinek")
    ? Math.max(Number(mana) || 0, LONG_REST_MANA)
    : mana;
}

/* -------------------------------------------- */
/*  Quick Focus                                 */
/* -------------------------------------------- */

function quickFocusState(actor) {
  return actor?.getFlag?.(SYSTEM_ID, QUICK_FOCUS_FLAG) ?? {};
}

/**
 * Focus banked by Quick Focus and still good. In combat it is good for the
 * turn it was banked in; banked outside combat it waits for the next cast.
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function bankedQuickFocus(actor) {
  const state = quickFocusState(actor);
  const banked = Math.max(0, Math.min(QUICK_FOCUS_MAX, Number(state.banked) || 0));
  if (!banked) return 0;
  const stamp = state.bankedAt;
  if (!stamp) return banked;
  const combat = trackedCombat(actor);
  if (
    !combat ||
    stamp.combat !== combat.id ||
    Number(stamp.round) !== Number(combat.round) ||
    Number(stamp.turn) !== Number(combat.turn)
  ) {
    return 0;
  }
  return banked;
}

/** Quick Focus uses this round, 0 outside combat. */
function quickFocusUsesThisRound(actor) {
  const combat = trackedCombat(actor);
  if (!combat) return 0;
  const uses = quickFocusState(actor).uses;
  if (!uses || uses.combat !== combat.id) return 0;
  if (Number(uses.round) !== Number(combat.round)) return 0;
  return Math.max(0, Number(uses.count) || 0);
}

/**
 * Use Quick Focus: 15 Mana for one banked Focus. Refused (with a
 * notification, nothing paid) without the Mana, after two uses this round,
 * or with two Focus already banked.
 *
 * @param {Actor} actor
 * @param {Item|null} ability
 * @returns {Promise<boolean>} whether it was used
 */
export async function useQuickFocus(actor, ability = null) {
  if (!actor?.isOwner) return false;
  const mana = Number(actor.system?.stats?.mana?.value) || 0;
  if (mana < QUICK_FOCUS_MANA) {
    ui.notifications.warn(L("QuickFocusNoMana", { cost: QUICK_FOCUS_MANA }));
    return false;
  }
  const combat = trackedCombat(actor);
  const used = quickFocusUsesThisRound(actor);
  const banked = bankedQuickFocus(actor);
  if (used >= QUICK_FOCUS_MAX || banked >= QUICK_FOCUS_MAX) {
    ui.notifications.warn(L("QuickFocusCap", { max: QUICK_FOCUS_MAX }));
    return false;
  }
  await actor.update({
    "system.stats.mana.value": mana - QUICK_FOCUS_MANA,
    [`flags.${SYSTEM_ID}.${QUICK_FOCUS_FLAG}`]: {
      banked: banked + 1,
      bankedAt: combat
        ? { combat: combat.id, round: combat.round, turn: combat.turn }
        : null,
      uses: combat
        ? { combat: combat.id, round: combat.round, count: used + 1 }
        : null,
    },
  });
  const label = ability?.localizedName ?? ability?.name ?? nodeLabel("rychleSoustredeni");
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<div style="display:flex;align-items:center;gap:8px;font-weight:bold;">
        ${ability?.img ? `<img src="${ability.img}" width="36" height="36">` : ""}
        <span>${esc(label)}</span>
      </div>
      <hr>
      <p style="text-align:center;">${esc(
        L("QuickFocusBanked", {
          name: actor.name,
          cost: QUICK_FOCUS_MANA,
          banked: banked + 1,
        }),
      )}</p>`,
  });
  return true;
}

/**
 * The cast takes what Quick Focus banked (castSpell.mjs performCast). The
 * round's use count stays; only the bank is emptied.
 *
 * @param {Actor} actor
 * @returns {Promise<number>} Focus added to the cast
 */
export async function takeQuickFocus(actor) {
  const state = quickFocusState(actor);
  if (!state.banked) return 0;
  const banked = bankedQuickFocus(actor);
  if (actor.isOwner) {
    await actor.update({
      [`flags.${SYSTEM_ID}.${QUICK_FOCUS_FLAG}.banked`]: 0,
      [`flags.${SYSTEM_ID}.${QUICK_FOCUS_FLAG}.bankedAt`]: null,
    });
  }
  return banked;
}

/* -------------------------------------------- */
/*  The granted items (combatAbilities.mjs)     */
/* -------------------------------------------- */

/**
 * The Incantator items used from the Combat Abilities dialog or the hotbar.
 * Quick Focus is paid and banked here; Catalyst opens the cast dialog with
 * its toggle ticked; Precise Incantation and Source Stabilization are used
 * from the chat cards they act on, so they only say where.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @param {Token|null} _token
 * @returns {Promise<boolean>} true when handled here
 */
export async function useIncantatorAbility(actor, ability, _token = null) {
  if (isKeyed(ability, QUICK_FOCUS_KEY, "Quick Focus")) {
    await useQuickFocus(actor, ability);
    return true;
  }
  if (isKeyed(ability, CATALYST_KEY, "Catalyst")) {
    await game.redsteel.castSpell({ catalyst: true });
    return true;
  }
  if (isKeyed(ability, PRECISE_KEY, "Precise Incantation")) {
    ui.notifications.info(L("PreciseWhere"));
    return true;
  }
  if (isKeyed(ability, STABILIZATION_KEY, "Source Stabilization")) {
    ui.notifications.info(L("StabilizeWhere"));
    return true;
  }
  return false;
}

/* -------------------------------------------- */
/*  Source Stabilization (redsteel.mjs)         */
/* -------------------------------------------- */

/**
 * Resolve a crit fail table draw for a Source Stabilization holder: show what
 * the die drew, then take it, roll 1d100 (1-50 one step milder, 51-100 one
 * step worse), or pay 10% of maximum Mana and choose. The table's higher
 * results are the worse ones (the rank modifier adds to the d20), so milder
 * is the result below the drawn one's range.
 *
 * Returns false (nothing done) for anyone without the node, so the caller
 * keeps its own draw.
 *
 * @param {Actor|null} actor
 * @param {RollTable} table
 * @param {Roll} roll  the evaluated `1d20 + rank modifier`
 * @returns {Promise<boolean>}
 */
export async function stabilizeCritFail(actor, table, given) {
  if (!actor || !hasIncantatorNode(actor, "stabilizaceZdroje")) return false;
  const draw = await table.roll({ roll: given });
  // V14 keeps the formula (rank modifier included) but rolls the dice afresh,
  // so the Roll that actually picked the row is the draw's, not the one
  // handed in. Everything shown below reads that one.
  const roll = draw?.roll ?? given;
  const original = Array.isArray(draw?.results) ? draw.results : [];
  const drawn = original[0];
  if (!drawn) {
    await table.draw({ roll });
    return true;
  }

  const maxMana = Number(actor.system?.stats?.mana?.max) || 0;
  const mana = Number(actor.system?.stats?.mana?.value) || 0;
  const price = Math.ceil((maxMana * STABILIZE_PCT) / 100);
  const canPay = actor.isOwner && mana >= price;
  const drawnHtml = await drawn.getHTML();

  let choice = null;
  try {
    choice = await foundry.applications.api.DialogV2.wait({
      window: { title: nodeLabel("stabilizaceZdroje") },
      classes: ["redsteel"],
      position: { width: 420 },
      content: `<p>${esc(L("StabilizeDrawn", { roll: roll.total }))}</p>
        <div class="rs-incantator-drawn">${drawnHtml}</div>
        <p>${esc(L("StabilizeAsk"))}</p>`,
      buttons: [
        { action: "accept", label: L("StabilizeAccept"), default: true },
        { action: "roll", label: L("StabilizeRoll") },
        {
          action: "payLower",
          label: L("StabilizePayLower", { cost: price }),
          disabled: !canPay,
        },
        {
          action: "payRaise",
          label: L("StabilizePayRaise", { cost: price }),
          disabled: !canPay,
        },
      ],
      rejectClose: false,
    });
  } catch (_err) {
    choice = null;
  }

  let direction = 0;
  let note = "";
  if (choice === "roll") {
    const d100 = await new Roll("1d100").evaluate();
    direction = d100.total <= 50 ? -1 : 1;
    note = L(direction < 0 ? "StabilizeRolledLower" : "StabilizeRolledRaise", {
      name: actor.name,
      die: d100.total,
    });
  } else if (choice === "payLower" || choice === "payRaise") {
    // Read again: the dialog may have stood open while Mana moved.
    const now = Number(actor.system?.stats?.mana?.value) || 0;
    if (now >= price) {
      await actor.update({ "system.stats.mana.value": now - price });
      direction = choice === "payLower" ? -1 : 1;
      note = L(direction < 0 ? "StabilizePaidLower" : "StabilizePaidRaise", {
        name: actor.name,
        cost: price,
      });
    } else {
      ui.notifications.warn(L("StabilizeNoMana", { cost: price }));
    }
  }

  let results = original;
  if (direction) {
    const range = Array.isArray(drawn.range) ? drawn.range : [];
    const edge = direction < 0 ? Number(range[0]) - 1 : Number(range[1]) + 1;
    const shifted = Number.isFinite(edge) ? table.getResultsForRoll(edge) : [];
    if (shifted?.length) results = shifted;
    else note += ` ${L("StabilizeEdge")}`;
  }

  await table.toMessage(results, { roll });
  if (note) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<p style="text-align:center;"><b>${esc(
        nodeLabel("stabilizaceZdroje"),
      )}</b></p><p style="text-align:center;">${esc(note)}</p>`,
    });
  }
  return true;
}

/* -------------------------------------------- */
/*  Precise Incantation (chat buttons)          */
/* -------------------------------------------- */

function buttonContainer(html) {
  let container = html.querySelector(".button-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "button-container";
    html.querySelector(".message-content")?.appendChild(container);
  }
  return container;
}

/** The cast card's effect rows Precise Incantation may reroll. */
function rerollableEffects(message) {
  const effects = message.flags?.effects ?? message.flags?.attack?.effects ?? {};
  const done = message.flags?.redsteel?.preciseRerolled ?? [];
  return Object.entries(effects)
    .filter(
      ([name, e]) =>
        !done.includes(name) &&
        !e?.auto &&
        !e?.critForced &&
        typeof e?.roll === "number" &&
        typeof e?.chance === "number" &&
        e.roll > e.chance,
    )
    .map(([name, e]) => ({ name, effect: e }));
}

async function payMana(actor, cost) {
  const mana = Number(actor?.system?.stats?.mana?.value) || 0;
  if (mana < cost) {
    ui.notifications.warn(L("PreciseNoMana", { cost }));
    return false;
  }
  if (cost > 0) await actor.update({ "system.stats.mana.value": mana - cost });
  return true;
}

/**
 * (a) Reroll one failed effect roll on the holder's own cast card: pay the
 * spell's cost, roll the d100 again against the same chance, write it where
 * Apply Damage and Apply Effects read it (`flags.attack.effects`,
 * `flags.effects`) and redraw the row. Once per effect row.
 */
async function rerollEffect(message, name) {
  const live = game.messages.get(message.id);
  if (!live) return;
  const data = live.flags?.redsteel ?? {};
  const cost = Number(data.preciseIncantation?.cost) || 0;
  if ((data.preciseRerolled ?? []).includes(name)) return;
  const caster = data.casterUuid ? await fromUuid(data.casterUuid) : null;
  if (!caster) return;
  if (!(await payMana(caster, cost))) return;

  const effect =
    live.flags?.effects?.[name] ?? live.flags?.attack?.effects?.[name] ?? {};
  const roll = await new Roll("1d100").evaluate();
  const value = roll.total;
  const success = value <= Number(effect.chance);

  const update = {
    [`flags.${SYSTEM_ID}.preciseRerolled`]: [...(data.preciseRerolled ?? []), name],
  };
  if (live.flags?.effects?.[name]) update[`flags.effects.${name}.roll`] = value;
  if (live.flags?.attack?.effects?.[name]) {
    update[`flags.attack.effects.${name}.roll`] = value;
  }
  // The row is tagged when the card is built (magicSkillBonuses.mjs); a card
  // from before the tag gets a line instead.
  const rowText = `<b>|${esc(name)}|</b> ${value} < ${effect.chance}%${
    success ? " SUCCESS" : ""
  } <em>(${esc(L("PreciseRowNote", { from: effect.roll }))})</em>`;
  const doc = new DOMParser().parseFromString(live.flavor ?? "", "text/html");
  const row = doc.querySelector(`[data-rs-effect="${CSS.escape(name)}"]`);
  if (row) {
    row.innerHTML = rowText;
    update.flavor = doc.body.innerHTML;
  } else {
    update.flavor = `${live.flavor ?? ""}<p style="text-align:center;">${rowText}</p>`;
  }
  await live.update(update);
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    flavor: `<p style="text-align:center;">${esc(
      L("PreciseRerolled", {
        name: caster.name,
        effect: name,
        cost,
        from: effect.roll,
        to: value,
      }),
    )}</p>`,
  });
}

/**
 * The spell card a versus answer resisted, when it is a Precise Incantation
 * holder's cast card (it carries the stamp). Null otherwise, and always for
 * a Mental Duel.
 */
function resistedHolderCard(message) {
  const flags = message.flags?.redsteel ?? {};
  const followup = flags.versusFollowup;
  if (!followup?.origin || flags.mentalDuel) return null;
  const origin = game.messages.get(followup.origin);
  const data = origin?.flags?.redsteel ?? {};
  if (!data.preciseIncantation || !data.casterUuid || data.mentalDuel) return null;
  return origin;
}

/**
 * (b) Force the resisting side to reroll its test: the caster pays the
 * spell's cost, then the answer card is rerolled the way any chat Re-Roll
 * rerolls a versus answer (executeReroll restates who won). The card belongs
 * to whoever answered, so a caster who cannot write it hands the reroll to
 * the GM.
 */
async function forceReroll(message) {
  const live = game.messages.get(message.id);
  const origin = live ? resistedHolderCard(live) : null;
  if (!origin || live.flags?.redsteel?.preciseForced) return;
  const caster = await fromUuid(origin.flags.redsteel.casterUuid);
  if (!caster) return;
  const cost = Number(origin.flags.redsteel.preciseIncantation?.cost) || 0;
  const direct = game.user.isGM || live.author?.id === game.user.id;
  // Checked before anything is paid: with no GM to relay to, nothing happens.
  if (!direct && !game.users.activeGM) {
    ui.notifications.warn(L("NoGM"));
    return;
  }
  if (!(await payMana(caster, cost))) return;
  const source = game.i18n.localize(PRECISE_KEY);
  if (direct) {
    await runForcedReroll(live.id, source);
    return;
  }
  game.socket.emit(SOCKET, {
    type: SOCKET_FORCE_REROLL,
    messageId: live.id,
    source,
  });
}

async function runForcedReroll(messageId, source) {
  const message = game.messages.get(messageId);
  if (!message || message.flags?.redsteel?.preciseForced) return;
  if (message.flags?.redsteel?.rerolledAway) return;
  await game.redsteel.executeReroll(message, source, {
    extraFlags: { preciseForced: true },
  });
}

/** May this user spend the caster's Mana from a card button? */
function mayActFor(casterUuid) {
  if (game.user.isGM) return true;
  const caster = casterUuid ? fromUuidSync(casterUuid) : null;
  return !!caster?.isOwner;
}

function addButton(html, label, onClick) {
  const container = buttonContainer(html);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "rs-precise-incantation";
  button.textContent = label;
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      await onClick();
    } finally {
      button.disabled = false;
    }
  });
  container.appendChild(button);
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

export function registerIncantatorHooks() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    try {
      const flags = message.flags?.redsteel ?? {};
      if (flags.rerolledAway) return;
      if (html.querySelector(".rs-precise-incantation")) return;

      // (a) The holder's own cast card: one button per failed effect roll.
      if (flags.preciseIncantation && flags.casterUuid && !flags.mentalDuel) {
        const isAuthor = message.author?.id === game.user.id;
        if (isAuthor || game.user.isGM) {
          const cost = Number(flags.preciseIncantation.cost) || 0;
          for (const { name } of rerollableEffects(message)) {
            addButton(html, L("PreciseEffectButton", { effect: name, cost }), () =>
              rerollEffect(message, name),
            );
          }
        }
      }

      // (b) A versus answer that resisted the holder's spell.
      if (flags.versusFollowup?.won === true && !flags.preciseForced) {
        const origin = resistedHolderCard(message);
        if (origin && mayActFor(origin.flags.redsteel.casterUuid)) {
          const cost = Number(origin.flags.redsteel.preciseIncantation.cost) || 0;
          addButton(html, L("PreciseForceButton", { cost }), () =>
            forceReroll(message),
          );
        }
      }
    } catch (err) {
      console.error("Redsteel | Precise Incantation buttons failed", err);
    }
  });

  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
      if (data?.type !== SOCKET_FORCE_REROLL) return;
      if (!game.users.activeGM?.isSelf) return;
      await runForcedReroll(data.messageId, data.source);
    });
  });
}
