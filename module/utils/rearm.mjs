/**
 * The Re-arm family (Přezbrojení): switching the weapon in the main hand.
 *
 * Rulebook (docs/rules-source/rules):
 * - Přezbrojení, ruzne-info.md r105: "Cena: 1 / Volná akce · Výdrž: 0 / 12 ·
 *   Přezbrojí z právě držené zbraně na jinou zbraň." The basic Re-arm every
 *   actor has (abilityGrants.mjs baseline). The picker asks which carried
 *   weapon goes into the ACTIVE weapon set's main hand, and how it is paid:
 *   one Action, or a Free action for 12 Stamina (useRearm).
 * - "Přezbrojení: -6 Výdrže" (Harcovník prezbrojeni, specializace-wip.md
 *   r206; Hraničář prezbrojeni, r300): the Free action costs 6 Stamina
 *   (rearmFreeStaminaCost).
 * - Rychlé ruce (Quick Hands, odbornosti.md r132) and Volná ruka II (Free
 *   hand II, r166): "jednou za kolo použít Volnou akci na přezbrojení nebo na
 *   vypití lektvaru". The picker offers a third, free option once per round,
 *   noted in the action tracker's round record (quickHandsSource). Free hand
 *   II only while a hand is free. The potion half is not wired here.
 * - Náhlé přezbrojení (Sudden Re-arm), ruzne-info.md r192: "1 reakce · 4
 *   výdrže · Vyvolá Test Rychlosti versus Test Rychlosti, aby přezbrojil z
 *   luku či kuše na zbraň. Jako Reakci lze použít pokud je napaden." Granted
 *   by Lukostřelec, Kušník, Peltast and Kejklíř II (abilityGrants.mjs).
 *   Offered by the hotbar (actionSuggestions.mjs) against the newest melee
 *   attack aimed at the actor while a bow or crossbow is in the main hand.
 *   The melee weapon is picked first, the Reaction and Stamina are paid, then
 *   both sides' Speed Tests are rolled here and posted on one card; a tie
 *   goes to the re-armer, who called the test (house rule). A win swaps.
 * - Vylepšené náhlé přezbrojení (Improved Sudden Re-arm, Hraničář
 *   vylPrezbrojeni, specializace-wip.md r324): "Garantovaná Reakce (Bez Testu
 *   Rychlosti). Okamžitě přezbrojí z držené zbraně na jinou zbraň." Replaces
 *   Sudden Re-arm: no contest, any held weapon to any other, 2 Stamina.
 *
 * swapMainWeapon moved here from hoplite.mjs (Draw a light weapon, Onslaught
 * II), which imports it back. Characters only: NPCs carry no weapon sets.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { getSpent, markBonusSource, trackedCombat } from "./actionTracker.mjs";
import { notePaidStamina } from "./enduringWarrior.mjs";
import { isHandheldLight } from "./itemLight.mjs";
import { tokenForActor } from "./movementZones.mjs";
import { rollSpeedTest } from "./speedTest.mjs";

const SYSTEM_ID = "redsteel";

export const REARM_KEY = "REDSTEEL.Items.Rearm.name";
export const SUDDEN_REARM_KEY = "REDSTEEL.Items.SuddenRearm.name";
export const IMPROVED_SUDDEN_REARM_KEY = "REDSTEEL.Items.ImprovedSuddenRearm.name";

/** Re-arm as a Free action: "Výdrž 0 / 12". */
export const REARM_FREE_STAMINA = 12;
/** "Přezbrojení: -6 Výdrže". */
export const REARM_NODE_DISCOUNT = 6;
/** The nodes that buy the discount, as [spec, node]. */
const REARM_DISCOUNT_NODES = Object.freeze([
  ["skirmisher", "prezbrojeni"],
  ["ranger", "prezbrojeni"],
]);

/** Rychlé ruce / Volná ruka II, by key and by the pack's English name. */
const QUICK_HANDS = Object.freeze({ key: "REDSTEEL.Items.QuickHands.name", name: "Quick Hands" });
const FREE_HAND_II = Object.freeze({ key: "REDSTEEL.Items.FreeHandII.name", name: "Free hand II" });

/** What Sudden Re-arm switches FROM: "z luku či kuše". */
const SUDDEN_FROM_CLASSES = Object.freeze(["bow", "crossbow"]);
/** What it switches TO: a melee weapon. */
const MELEE_CLASSES = Object.freeze(["axe", "sword", "blunt", "polearm"]);

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const L = (key, data) =>
  data
    ? game.i18n.format(`REDSTEEL.Rearm.${key}`, data)
    : game.i18n.localize(`REDSTEEL.Rearm.${key}`);

/* -------------------------------------------- */
/*  Identity                                    */
/* -------------------------------------------- */

function isKeyed(item, key, englishName) {
  return item?.system?.localizationKey === key || item?.name === englishName;
}

/** The basic Re-arm action. */
export function isRearm(ability) {
  return isKeyed(ability, REARM_KEY, "Re-arm");
}

/** Sudden Re-arm (the contested one). */
export function isSuddenRearm(ability) {
  return isKeyed(ability, SUDDEN_REARM_KEY, "Sudden Re-arm");
}

/** Improved Sudden Re-arm (no contest). */
export function isImprovedSuddenRearm(ability) {
  return isKeyed(ability, IMPROVED_SUDDEN_REARM_KEY, "Improved Sudden Re-arm");
}

/** Either Sudden Re-arm item. */
export function isAnySuddenRearm(ability) {
  return isSuddenRearm(ability) || isImprovedSuddenRearm(ability);
}

/* -------------------------------------------- */
/*  Weapon sets                                 */
/* -------------------------------------------- */

/** Two-handed the way the sheet reads it (actor-sheet.mjs _isEffectivelyTwoHanded). */
function isTwoHanded(item) {
  if (!item) return false;
  return (
    item.system?.type === "heavy" ||
    item.system?.gripMode === "two" ||
    ["crossbow", "bow"].includes(item.system?.class)
  );
}

/** The active set's slots, or null when the actor has no active set. */
function activeSlots(actor) {
  if (actor?.type !== "character") return null;
  const set = actor.system.combat?.activeWeaponSet;
  if (!set) return null;
  return actor.system.combat?.weaponSets?.[set] ?? {};
}

/** The weapon in the active set's main hand, or null. */
function mainWeapon(actor) {
  const slots = activeSlots(actor);
  return slots?.main ? (actor.items.get(slots.main) ?? null) : null;
}

/**
 * Put a weapon into the ACTIVE weapon set's main hand, by the sheet's own
 * rules (actor-sheet.mjs _assignWeaponDirect): shields and torches never go
 * in the main hand, a weapon taken from the off hand leaves it, and a
 * two-handed weapon clears the off hand. Characters only. No Action is
 * charged here; the caller decides what the swap costs. Used by Re-arm and
 * by the Hoplite's Draw a light weapon and Onslaught II (hoplite.mjs).
 *
 * @param {Actor} actor
 * @param {string} itemId
 * @returns {Promise<boolean>} whether the set changed
 */
export async function swapMainWeapon(actor, itemId) {
  if (actor?.type !== "character" || !actor.isOwner) return false;
  const item = actor.items.get(itemId);
  if (!item || item.type !== "weapon") return false;
  if (item.system?.shield || isHandheldLight(item)) return false;
  const set = actor.system.combat?.activeWeaponSet;
  if (!set) return false;
  const slots = actor.system.combat?.weaponSets?.[set] ?? {};
  if (slots.main === itemId) return false;

  const updates = {};
  if (slots.off === itemId || isTwoHanded(item)) {
    updates[`system.combat.weaponSets.${set}.off`] = null;
  }
  updates[`system.combat.weaponSets.${set}.main`] = itemId;
  await actor.update(updates);
  return true;
}

/**
 * The weapons a Re-arm may put in the main hand: every carried weapon that is
 * not a shield and not already there. `melee` keeps melee weapons only (Sudden
 * Re-arm: "na zbraň", from a bow or crossbow to a weapon to fight with).
 *
 * @param {Actor} actor
 * @param {{melee?: boolean}} [options]
 * @returns {Item[]}
 */
export function rearmCandidates(actor, { melee = false } = {}) {
  const slots = activeSlots(actor);
  if (!slots) return [];
  return actor.items.filter(
    (i) =>
      i.type === "weapon" &&
      i.id !== slots.main &&
      !i.system?.shield &&
      !isHandheldLight(i) &&
      (!melee ||
        (MELEE_CLASSES.includes(i.system?.class) && i.system?.thrown !== true)),
  );
}

/* -------------------------------------------- */
/*  Costs                                       */
/* -------------------------------------------- */

/**
 * Stamina Re-arm costs as a Free action: 12, or 6 with "Přezbrojení: -6
 * Výdrže" (Skirmisher or Ranger node).
 *
 * @param {Actor} actor
 * @returns {number}
 */
export function rearmFreeStaminaCost(actor) {
  const discounted =
    actor?.type === "character" &&
    REARM_DISCOUNT_NODES.some(([spec, node]) => actorHasSpecNode(actor, spec, node));
  return Math.max(0, REARM_FREE_STAMINA - (discounted ? REARM_NODE_DISCOUNT : 0));
}

/**
 * A hand is free (Volná ruka II): the active set's off hand is empty and the
 * main hand holds nothing two-handed.
 */
function hasFreeHand(actor) {
  const slots = activeSlots(actor);
  if (!slots) return false;
  if (slots.off) return false;
  return !isTwoHanded(mainWeapon(actor));
}

/**
 * The feature that buys this round's free Re-arm, or null: Quick Hands, or
 * Free hand II while a hand is free. Both feed the same once-per-round
 * allowance.
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
function quickHandsFeature(actor) {
  const features = actor?.items?.filter((i) => i.type === "feature") ?? [];
  const quick = features.find((i) => isKeyed(i, QUICK_HANDS.key, QUICK_HANDS.name));
  if (quick) return quick;
  const freeHand = features.find((i) => isKeyed(i, FREE_HAND_II.key, FREE_HAND_II.name));
  return freeHand && hasFreeHand(actor) ? freeHand : null;
}

/** The round's free Re-arm allowance, noted in the action tracker's record. */
function quickHandsSource(combat) {
  return `rearmQuickHands.${combat.id}.${combat.round}`;
}

/** Is this round's free Re-arm still there? Always, outside an encounter. */
function quickHandsLeft(actor) {
  const combat = trackedCombat(actor);
  if (!combat) return true;
  return !getSpent(actor).bonusSources.includes(quickHandsSource(combat));
}

/**
 * Stand-in cost line for one Re-arm: what the tracker and the Stamina pool are
 * charged. Carries the ability's key, so it reads as Re-arm wherever an item is
 * inspected on the way (aim.mjs counts a one-Action Re-arm as a non-attack
 * action).
 */
function rearmCostLine(ability, { actionCost, stamina }) {
  return {
    name: ability?.name ?? "Re-arm",
    system: {
      localizationKey: REARM_KEY,
      class: "",
      costType: "stamina",
      cost: stamina,
      resources: {},
      actionCost,
    },
  };
}

/* -------------------------------------------- */
/*  Pickers                                     */
/* -------------------------------------------- */

function weaponOptions(candidates) {
  return candidates
    .map(
      (w, n) =>
        `<option value="${esc(w.id)}"${n === 0 ? " selected" : ""}>${esc(
          w.localizedName ?? w.name,
        )}</option>`,
    )
    .join("");
}

function pickerContent(prompt, candidates) {
  return `<form class="rs-rearm-picker">
  <p>${prompt}</p>
  <div class="form-group">
    <label>${L("WeaponLabel")}</label>
    <select name="rearm-weapon">${weaponOptions(candidates)}</select>
  </div>
</form>`;
}

/** The weapon picked in a picker dialog. */
function pickedWeapon(button, dialog) {
  const root = dialog?.element ?? button.form;
  return root?.querySelector('select[name="rearm-weapon"]')?.value ?? null;
}

/**
 * The Re-arm weapon picker on its own, for a re-arm another action grants
 * (Navazující vrh, skirmisher.mjs): one confirm button, plus an optional
 * "keep" button when the weapon in hand would do. Nothing is paid or swapped
 * here.
 *
 * @param {Item[]} candidates
 * @param {{title: string, prompt: string, confirmLabel: string,
 *   keepLabel?: string|null}} options
 * @returns {Promise<Item|"keep"|null>} the weapon, "keep", or null (closed)
 */
export async function pickRearmWeapon(
  candidates,
  { title, prompt, confirmLabel, keepLabel = null },
) {
  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title },
    classes: ["redsteel"],
    content: pickerContent(prompt, candidates),
    buttons: [
      {
        action: "rearm",
        label: confirmLabel,
        default: true,
        callback: (_event, button, dialog) => pickedWeapon(button, dialog),
      },
      ...(keepLabel ? [{ action: "keep", label: keepLabel }] : []),
    ],
    rejectClose: false,
  });
  if (picked === "keep") return "keep";
  return candidates.find((w) => w.id === picked) ?? null;
}

/** The weapon in the active set's main hand, or null (characters only). */
export function mainHandWeapon(actor) {
  return mainWeapon(actor);
}

/* -------------------------------------------- */
/*  Re-arm                                      */
/* -------------------------------------------- */

async function postCard(actor, title, lines, { rolls = [], content = "", flags = {} } = {}) {
  const token = tokenForActor(actor);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
    flavor: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
${lines.map((line) => `<p style="text-align:center;">${line}</p>`).join("\n")}`,
    ...(content ? { content } : {}),
    ...(rolls.length ? { rolls } : {}),
    flags: { [SYSTEM_ID]: flags },
  });
}

/**
 * Use Re-arm: pick a carried weapon and how to pay, pay it, swap the main
 * hand. Always handles the click (true), so the Combat Abilities dialog never
 * posts the plain card for it.
 *
 * @param {Actor} actor
 * @param {Item} ability  the Re-arm item clicked
 * @returns {Promise<boolean>}
 */
export async function useRearm(actor, ability) {
  if (actor?.type !== "character") {
    ui.notifications.warn(L("CharactersOnly"));
    return true;
  }
  const candidates = rearmCandidates(actor);
  if (!candidates.length) {
    ui.notifications.warn(L("NoWeapons"));
    return true;
  }

  const title = ability?.localizedName ?? ability?.name ?? L("Title");
  const freeStamina = rearmFreeStaminaCost(actor);
  const quick = quickHandsLeft(actor) ? quickHandsFeature(actor) : null;
  const choose = (mode) => (_event, button, dialog) => ({
    mode,
    weaponId: pickedWeapon(button, dialog),
  });

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title },
    classes: ["redsteel"],
    content: pickerContent(L("Prompt"), candidates),
    buttons: [
      {
        action: "action",
        label: L("CostAction"),
        default: true,
        callback: choose("action"),
      },
      {
        action: "free",
        label: L("CostFree", { cost: freeStamina }),
        callback: choose("free"),
      },
      ...(quick
        ? [
            {
              action: "quick",
              label: L("CostQuick", { feature: quick.localizedName ?? quick.name }),
              callback: choose("quick"),
            },
          ]
        : []),
    ],
    rejectClose: false,
  });
  if (!choice?.weaponId) return true;
  const weapon = candidates.find((w) => w.id === choice.weaponId);
  if (!weapon) return true;

  const line =
    choice.mode === "action"
      ? rearmCostLine(ability, { actionCost: "1 Action", stamina: 0 })
      : rearmCostLine(ability, {
          actionCost: "Free Action",
          stamina: choice.mode === "free" ? freeStamina : 0,
        });
  if (!(await game.redsteel.deductAbilityCost(actor, [line]))) return true;
  // Enduring Warrior: a Re-arm's Stamina is no attack's to refund.
  notePaidStamina(actor, 0);
  if (choice.mode === "quick") {
    const combat = trackedCombat(actor);
    if (combat) await markBonusSource(actor, quickHandsSource(combat));
  }
  if (!(await swapMainWeapon(actor, weapon.id))) return true;

  const cost =
    choice.mode === "action"
      ? L("CostAction")
      : choice.mode === "free"
        ? L("CostFree", { cost: freeStamina })
        : L("CostQuick", { feature: quick?.localizedName ?? quick?.name ?? "" });
  await postCard(
    actor,
    title,
    [
      L("Rearmed", {
        name: esc(actor.name),
        weapon: esc(weapon.localizedName ?? weapon.name),
        cost: esc(cost),
      }),
    ],
    { flags: { abilityKey: REARM_KEY } },
  );
  return true;
}

/* -------------------------------------------- */
/*  Sudden Re-arm                               */
/* -------------------------------------------- */

/** Once per turn: the Sudden Re-arm already used against this turn's attack. */
function suddenRearmSource(combat) {
  return `suddenRearm.${combat.id}.${combat.round}.${combat.turn}`;
}

/**
 * The Sudden Re-arm item this actor would use, the Improved one first, or
 * null when it has neither.
 *
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function suddenRearmItem(actor) {
  const items = actor?.items?.filter((i) => i.type === "ability") ?? [];
  return (
    items.find((i) => isImprovedSuddenRearm(i)) ??
    items.find((i) => isSuddenRearm(i)) ??
    null
  );
}

/**
 * Should the hotbar offer this Sudden Re-arm item right now (the attack gate
 * aside, which actionSuggestions.mjs reads off the chat log)? Not yet used this
 * turn, and a weapon to draw. Sudden Re-arm needs a bow or crossbow in the
 * main hand. The Improved one may switch any held weapon, but the chip is only
 * a suggestion: it is offered while the main hand holds no melee weapon (a bow,
 * crossbow, firearm, a thrown weapon or nothing), and stays in the Combat
 * Abilities dialog for any other switch.
 *
 * @param {Actor} actor
 * @param {Item} item
 * @returns {boolean}
 */
export function suddenRearmFits(actor, item) {
  if (actor?.type !== "character" || !item) return false;
  const combat = trackedCombat(actor);
  if (combat && getSpent(actor).bonusSources.includes(suddenRearmSource(combat))) {
    return false;
  }
  const main = mainWeapon(actor);
  if (isImprovedSuddenRearm(item)) {
    const meleeInHand =
      !!main && MELEE_CLASSES.includes(main.system?.class) && main.system?.thrown !== true;
    return !meleeInHand && rearmCandidates(actor).length > 0;
  }
  if (!SUDDEN_FROM_CLASSES.includes(main?.system?.class)) return false;
  return rearmCandidates(actor, { melee: true }).length > 0;
}

/**
 * Use Sudden Re-arm or Improved Sudden Re-arm. The attacker is the one token
 * the user has targeted (the hotbar chip targets it). Pick the weapon first,
 * so the card can name it, then pay the item (its Reaction and Stamina), then
 * roll the versus Speed Test (Sudden only) and swap on a win. Always handles
 * the click (true).
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function useSuddenRearm(actor, ability) {
  const improved = isImprovedSuddenRearm(ability);
  if (actor?.type !== "character") {
    ui.notifications.warn(L("CharactersOnly"));
    return true;
  }
  const self = tokenForActor(actor);
  const targets = [...(game.user?.targets ?? [])].filter(
    (t) => t.document?.id !== self?.document?.id,
  );
  const attacker = targets.length === 1 ? targets[0] : null;
  if (!improved && !attacker?.actor) {
    ui.notifications.warn(L("SuddenNeedsTarget"));
    return true;
  }
  const old = mainWeapon(actor);
  if (!improved && !SUDDEN_FROM_CLASSES.includes(old?.system?.class)) {
    ui.notifications.warn(L("SuddenNeedsBow"));
    return true;
  }
  const candidates = rearmCandidates(actor, { melee: !improved });
  if (!candidates.length) {
    ui.notifications.warn(L(improved ? "NoWeapons" : "SuddenNoWeapons"));
    return true;
  }

  const title = ability.localizedName ?? ability.name;
  const stamina = Number(ability.system?.cost) || 0;
  const weaponId = await foundry.applications.api.DialogV2.wait({
    window: { title },
    classes: ["redsteel"],
    content: pickerContent(L(improved ? "Prompt" : "SuddenPrompt"), candidates),
    buttons: [
      {
        action: "rearm",
        label: L("SuddenConfirm", { cost: stamina }),
        default: true,
        callback: (_event, button, dialog) => pickedWeapon(button, dialog),
      },
    ],
    rejectClose: false,
  });
  const weapon = candidates.find((w) => w.id === weaponId);
  if (!weapon) return true;

  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return true;
  notePaidStamina(actor, 0);
  const combat = trackedCombat(actor);
  if (combat) await markBonusSource(actor, suddenRearmSource(combat));

  const names = {
    name: esc(actor.name),
    attacker: esc(attacker?.name ?? ""),
    weapon: esc(weapon.localizedName ?? weapon.name),
    old: esc(old?.localizedName ?? old?.name ?? ""),
  };
  const key = improved ? IMPROVED_SUDDEN_REARM_KEY : SUDDEN_REARM_KEY;

  if (improved) {
    await swapMainWeapon(actor, weapon.id);
    await postCard(actor, title, [L("ImprovedRearmed", names)], {
      flags: { abilityKey: key },
    });
    return true;
  }

  // Test Rychlosti versus Test Rychlosti: both sides rolled here, the
  // re-armer called the test and takes a tie.
  const mine = await rollSpeedTest(actor, {
    modifier: Number(ability.system?.testModifier) || 0,
    advantage: ability.system?.testAdvantage ?? "",
  });
  const theirs = await rollSpeedTest(attacker.actor);
  const won = mine.total >= theirs.total;
  if (won) await swapMainWeapon(actor, weapon.id);

  const column = async (label, roll) => `
    <div class="roll-column">
      <div class="roll-label">${esc(label)}</div>
      ${await roll.render()}
    </div>`;
  const content = `<div class="dual-roll">${await column(actor.name, mine)}${await column(
    attacker.name,
    theirs,
  )}</div>`;
  await postCard(
    actor,
    title,
    [
      L("SuddenVersus", { ...names, mine: mine.total, theirs: theirs.total }),
      `<b>${L(won ? "SuddenWin" : "SuddenLose", names)}</b>`,
    ],
    { rolls: [mine, theirs], content, flags: { abilityKey: key } },
  );
  return true;
}
