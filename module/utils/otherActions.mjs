import { tagRollSkill } from "./rollAdvantage.mjs";
import { resetActorRerolls } from "./rerolls.mjs";
import { gainBloodFromBleed, bloodGainNote } from "./bloodPool.mjs";
import { isActorInCombat } from "./combatants.mjs";

export async function delayTurn() {
  const combat = game.combat;
  if (!combat) {
    ui.notifications.warn("No active combat.");
    return;
  }

  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;

  if (token.actor.system.hasty) {
    ui.notifications.warn(
      "Hasty people cannot delay their Turn Order under any circumstances.",
    );
    return;
  }
  const combatant = combat.getCombatantByToken(token.id);
  if (!combatant) {
    ui.notifications.warn("Token not in combat.");
    return;
  }

  if (combatant.id !== combat.combatant?.id) {
    ui.notifications.warn("You can only delay on your own turn.");
    return;
  }

  const currentInit = combatant.initiative;
  if (currentInit === null) {
    ui.notifications.warn("You have not rolled initiative.");
    return;
  }

  // Sorted list for consistent ordering
  const ordered = combat.combatants
    .filter((c) => c.id !== combatant.id && c.initiative !== null)
    .sort((a, b) => b.initiative - a.initiative);

  const options = ordered
    .map((c) => `<option value="${c.id}">${c.name} (${c.initiative})</option>`)
    .join("");

  new Dialog({
    title: "Delay Initiative",
    content: `
<p><strong>Current initiative:</strong> ${currentInit}</p>

<h3>Delay until after</h3>
<select name="afterTarget">
  <option value="">— Choose —</option>
  ${options}
</select>

<hr>

<h3>Advanced: Set initiative value</h3>
<input type="number" name="manualInit" step="0.01"/>
`,
    buttons: {
      cancel: { label: "Cancel" },
      delay: {
        label: "Delay",
        callback: async (html) => {
          const targetId = html.find('[name="afterTarget"]').val();
          const manualRaw = html.find('[name="manualInit"]').val();

          // Enforce exclusivity
          if (!!targetId === !!manualRaw) {
            ui.notifications.warn("Choose exactly one delay option.");
            return;
          }

          let newInit;

          // Option 1: After target
          if (targetId) {
            const target = combat.combatants.get(targetId);
            newInit = target.initiative - 0.1;
          }

          // Option 2: Manual value
          if (manualRaw) {
            newInit = Number(manualRaw);
          }

          if (isNaN(newInit)) {
            ui.notifications.warn("Invalid initiative value.");
            return;
          }

          if (newInit > currentInit) {
            ui.notifications.warn("You can only delay, not act earlier.");
            return;
          }

          // Advance turn first
          await combat.nextTurn();

          // Yield to let Foundry settle turn state
          await new Promise((r) => setTimeout(r, 0));

          // Update initiative
          await combatant.update({ initiative: newInit });
        },
      },
    },
  }).render(true);
}

export async function restAndRecover() {
  // Ensure a token is selected
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;

  // Increase stamina
  const stamina = actor.system.stats.stamina.value ?? 0;
  const newStamina = Math.max(0, stamina + 5);

  await actor.update({
    "system.stats.stamina.value": newStamina,
  });

  // Icon (macro-safe fallback)
  let iconUrl = "icons/consumables/plants/tearthumb-halberd-leaf-green.webp";
  const characterName = actor.name;

  const chatMessage = `
<div style="display:flex; align-items:center; gap:10px;">
  <img src="${iconUrl}" width="36" height="36" style="border-radius:50%;" />
  <div>
    <p style="color:green; font-size:1.2em;">
      <strong>Used Rest action</strong>
    </p>
    <strong>${characterName}</strong> is resting and recovers 5 stamina.
  </div>
</div>
`;

  await ChatMessage.create({
    content: chatMessage,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
}

/* -------------------------------------------- */
/*  Rations                                     */
/* -------------------------------------------- */

/** Food units a normal character eats per day, before traits. */
const BASE_FOOD_PER_DAY = 3;

/**
 * How many food units this actor eats over a Long Rest, or 0 for anyone the
 * ration rules do not cover.
 *
 * Only characters eat out of the party's packs. Mounts, companions and hirelings
 * ride along in the rest roster, and billing them 3 units each would report a
 * famine every single night; their upkeep is a separate line at the stable.
 *
 * `foodPerDayBonus` is a flat extra set by Active Effects, the same shape as
 * `longRestHealthBonus`: Voracious / Gourmand / Yormun add +1, Ascetic −1.
 * Floored at zero so a stack of reducing traits can never feed anyone.
 */
export function foodPerDay(actor) {
  if (actor?.type !== "character") return 0;
  const bonus = Number(actor?.system?.foodPerDayBonus) || 0;
  return Math.max(0, BASE_FOOD_PER_DAY + bonus);
}

/**
 * Every stack the actor carries that is ticked as food. Plain "item"-type
 * documents, so the GM can hand out Bread, Dried Meat or a hunter's catch and
 * have them all count — one document quantity = one food unit.
 */
function rationStacks(actor) {
  return actor.items
    .filter((i) => i.type === "item" && i.system?.rations)
    .sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

/** Total food units carried. */
function rationTotal(actor) {
  return rationStacks(actor).reduce(
    (sum, i) => sum + Math.max(0, Number(i.system.quantity ?? 0)),
    0,
  );
}

/**
 * Eat `needed` food units, draining the actor's ration stacks in sheet order
 * and deleting whatever empties out — the same consume-then-delete shape the
 * first aid kit uses.
 *
 * Going hungry is deliberately not punished here: the rules leave the penalty
 * for missed meals to the GM, so a short rest reports the shortfall on the card
 * and the table decides what it costs.
 *
 * @returns {{needed: number, eaten: number, short: number, left: number}}
 */
async function consumeRations(actor, needed) {
  let remaining = needed;
  const deletions = [];
  const updates = [];

  for (const stack of rationStacks(actor)) {
    if (remaining <= 0) break;
    const have = Math.max(0, Number(stack.system.quantity ?? 0));
    if (have <= 0) continue;

    const take = Math.min(have, remaining);
    remaining -= take;

    if (have - take <= 0) deletions.push(stack.id);
    else updates.push({ _id: stack.id, "system.quantity": have - take });
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  if (deletions.length)
    await actor.deleteEmbeddedDocuments("Item", deletions);

  return {
    needed,
    eaten: needed - remaining,
    short: remaining,
    left: rationTotal(actor),
  };
}

/**
 * Everyone a Long Rest could plausibly cover, in the order they are offered:
 * the characters assigned to real players, then anything flagged into the party
 * (companions, mounts, hirelings), then whatever tokens happen to be selected.
 *
 * Keyed on uuid rather than id, the same way the hotbar's party row is: an
 * unlinked token's actor is synthetic and borrows the base actor's id, so two
 * copies dragged from one sheet would otherwise collapse into a single row.
 *
 * @returns {{actor: Actor, group: string}[]}
 */
function collectLongRestCandidates() {
  const rows = [];
  const seen = new Set();
  const add = (actor, group, sortKey) => {
    // Only what this user can actually write to. A GM owns everything, so this
    // only bites when a player runs the macro: they get themselves and their
    // companions rather than a roster whose updates would be refused.
    if (!actor?.isOwner || seen.has(actor.uuid)) return;
    seen.add(actor.uuid);
    rows.push({ actor, group, sortKey: `${group}${sortKey}` });
  };

  // Players who are not logged in still count: a Long Rest is downtime the
  // whole party takes, and their character rests whether or not they are here.
  for (const user of game.users.contents) {
    if (user.isGM) continue;
    add(user.character, "0", user.name);
  }

  for (const candidate of game.actors.contents) {
    if (candidate.system?.partyMember) add(candidate, "1", candidate.name);
  }

  // Ticking "party member" on an *unlinked* token writes to its ActorDelta and
  // never touches the world actor, so the scene has to be swept as well.
  for (const tokenDoc of canvas?.scene?.tokens?.contents ?? []) {
    const candidate = tokenDoc.actor;
    if (candidate?.system?.partyMember) add(candidate, "1", candidate.name);
  }

  // Selected tokens last, so resting an arbitrary NPC still works the old way.
  for (const token of canvas?.tokens?.controlled ?? []) {
    add(token.actor, "2", token.actor?.name ?? "");
  }

  return rows
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey, game.i18n.lang))
    .map(({ actor, group }) => ({ actor, group }));
}

/**
 * Vertical roster with a checkbox per actor, everyone ticked to start with —
 * a Long Rest normally covers the whole party, and dropping the one person
 * standing watch should be a single click rather than a re-selection.
 *
 * @param {{actor: Actor, group: string}[]} candidates
 * @returns {Promise<{actors: Actor[], eatRations: boolean}|null>} The chosen
 *   actors and whether the meal is being paid for out of packs, or null if
 *   cancelled.
 */
async function promptForLongRestActors(candidates) {
  const label = (key) => game.i18n.localize(`REDSTEEL.LongRest.${key}`);
  const groupLabel = {
    0: label("GroupPlayers"),
    1: label("GroupParty"),
    2: label("GroupSelected"),
  };

  let lastGroup = null;
  const rows = candidates
    .map(({ actor, group }) => {
      const heading =
        group === lastGroup
          ? ""
          : `<div class="rs-rest-group">${groupLabel[group]}</div>`;
      lastGroup = group;

      const hp = actor.system?.stats?.health ?? {};
      const hpText =
        hp.value === undefined ? "" : `${hp.value}/${hp.max ?? "?"}`;

      // Appetite vs. pack, so whoever is running the rest can see who goes
      // hungry before ticking the box rather than after reading the cards.
      // Nothing shown for anyone the ration rules skip (mounts, companions).
      const need = foodPerDay(actor);
      const have = rationTotal(actor);
      const foodChip = !need
        ? ""
        : `<span class="rs-rest-food${have < need ? " short" : ""}"
             title="${label("FoodTooltip")}">
             <i class="fa-light fa-drumstick-bite"></i>${have}/${need}
           </span>`;

      return `
        ${heading}
        <label class="rs-rest-row">
          <input type="checkbox" name="rs-rest-actor" value="${actor.uuid}" checked>
          <img src="${actor.img ?? "icons/svg/mystery-man.svg"}" alt="">
          <span class="rs-rest-name">${foundry.utils.escapeHTML(actor.name)}</span>
          ${foodChip}
          <span class="rs-rest-hp">${hpText}</span>
        </label>`;
    })
    .join("");

  // Camping in the wild runs for days at a time, so the box remembers where it
  // was left: once travel starts it stays ticked until the party reaches a bed.
  const eatDefault = game.settings.get("redsteel", "longRestEatRations");

  const DialogV2 = foundry.applications.api.DialogV2;
  const chosen = await DialogV2.wait({
    window: { title: label("Title"), icon: "fa-light fa-moon" },
    classes: ["redsteel", "rs-longrest-dialog"],
    position: { width: 340 },
    content: `
      <form>
        <label class="rs-rest-row rs-rest-all">
          <input type="checkbox" name="rs-rest-all" checked>
          <span class="rs-rest-name">${label("SelectAll")}</span>
        </label>
        <div class="rs-rest-list">${rows}</div>
        <label class="rs-rest-row rs-rest-rations">
          <input type="checkbox" name="rs-rest-eat" ${eatDefault ? "checked" : ""}>
          <span class="rs-rest-name">${label("EatRations")}</span>
        </label>
      </form>`,
    buttons: [
      {
        action: "rest",
        label: label("Confirm"),
        icon: "fa-light fa-moon",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? button.form;
          return {
            uuids: Array.from(
              root.querySelectorAll('input[name="rs-rest-actor"]:checked'),
            ).map((input) => input.value),
            eatRations: !!root.querySelector('input[name="rs-rest-eat"]')
              ?.checked,
          };
        },
      },
    ],
    render: (_event, dialog) => {
      const root = dialog instanceof HTMLElement ? dialog : dialog?.element;
      if (!root) return;

      const master = root.querySelector('input[name="rs-rest-all"]');
      const boxes = Array.from(
        root.querySelectorAll('input[name="rs-rest-actor"]'),
      );

      master?.addEventListener("change", () => {
        for (const box of boxes) box.checked = master.checked;
      });
      // The master reads as "everyone", so it has to follow the rows back:
      // leaving it ticked after one is cleared would be a standing lie.
      for (const box of boxes) {
        box.addEventListener("change", () => {
          if (!master) return;
          master.checked = boxes.every((b) => b.checked);
          master.indeterminate = !master.checked && boxes.some((b) => b.checked);
        });
      }
    },
    rejectClose: false,
  });

  if (!chosen?.uuids) return null; // cancelled or closed

  await game.settings.set(
    "redsteel",
    "longRestEatRations",
    chosen.eatRations,
  );

  return {
    actors: chosen.uuids.map((uuid) => fromUuidSync(uuid)).filter((a) => a),
    eatRations: chosen.eatRations,
  };
}

export async function longRest() {
  const candidates = collectLongRestCandidates();

  if (!candidates.length) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.LongRest.NoCandidates"));
    return;
  }

  const choice = await promptForLongRestActors(candidates);
  if (choice === null) return; // cancelled

  const { actors, eatRations } = choice;

  if (!actors.length) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.LongRest.NoneChosen"));
    return;
  }

  for (const actor of actors) {
    await applyLongRest(actor, { eatRations });
  }
}

/**
 * The Long Rest itself for a single actor: regeneration, one Mind, one fatigue
 * degree off, rerolls back to ready, and a card saying so.
 *
 * @param {Actor} actor
 * @param {{eatRations?: boolean}} [options]
 */
async function applyLongRest(actor, { eatRations = false } = {}) {
  const system = actor.system;

  const nourishingEffect = actor.effects.find((e) =>
    e.statuses?.has("nourishing_rest"),
  );

  const regenMultiplier = nourishingEffect ? 2 : 1;

  // ─── Stamina ───
  const stamina = system.stats.stamina.value ?? 0;
  const newStamina = Math.max(0, stamina + system.stats.stamina.max);

  // ─── Health ───
  // `longRestHealthBonus` is a flat extra set by Active Effects — Starsign:
  // Rock grants +2. It is added after the Nourishing Rest multiplier, so the
  // starsign is worth the same 2 health whether or not the rest was nourishing.
  const health = system.stats.health.value ?? 0;
  const longRestHealthBonus = Number(system.longRestHealthBonus) || 0;
  const healthRegen =
    (10 + system.attributes.end.total * 2) * regenMultiplier +
    longRestHealthBonus;

  const newHealth = Math.max(0, health + healthRegen);

  // ─── Toxicity ───
  const toxicity = system.stats.toxicity.value ?? 0;

  const toxicityReduction =
    (5 + system.attributes.end.total * 2) * regenMultiplier;

  const newToxicity = Math.max(0, toxicity - toxicityReduction);

  // ─── Fatigue ───
  const fatigue = system.stats.fatigue.value ?? 0;
  const newFatigue = Math.max(0, fatigue - 1);

  // ─── Mind ───
  const mind = Number(system.stats.mind.value ?? 0);
  const newMind = Math.max(0, mind + 1);
  // ─── Mana ───
  const mana = system.stats.mana.value ?? 0;
  const maxMana = system.stats.mana.max ?? 0;

  const elementalistRank = system.doctrines.elementalist.value ?? 0;
  const elymasRank = system.doctrines.elymas.value ?? 0;
  const incantatorRank = system.doctrines.incantator.value ?? 0;
  const veneficusRank = system.doctrines.veneficus.value ?? 0;

  let newMana = 0;

  if (elementalistRank > 0) {
    newMana = elementalistRank >= 7 ? 50 : elementalistRank >= 5 ? 35 : 25;
  } else if (elymasRank > 0) {
    newMana = elymasRank >= 5 ? maxMana : Math.floor(maxMana / 2);
  } else if (incantatorRank > 0) {
    newMana = incantatorRank >= 9 ? 40 : incantatorRank >= 5 ? 30 : 20;
  } else if (veneficusRank > 0) {
    newMana = maxMana;
  }

  const manaText = newMana > 0 ? `, Mana +${newMana}` : "";

  if (nourishingEffect) {
    await nourishingEffect.delete();
  }

  const updates = {
    "system.stats.stamina.value": newStamina,
    "system.stats.health.value": newHealth,
    "system.stats.toxicity.value": newToxicity,
    "system.stats.fatigue.value": newFatigue,
    "system.stats.mind.value": newMind,
    "system.stats.mana.value": Math.min(maxMana, mana + newMana),
  };
  await actor.update(updates);

  // ─── Rerolls ─── restore every feature reroll to ready.
  const rerollsRestored = await resetActorRerolls(actor);

  // ─── Food ─── only when the party is camping rather than paying an innkeeper.
  const appetite = foodPerDay(actor);
  const meal =
    eatRations && appetite > 0 ? await consumeRations(actor, appetite) : null;
  const mealText = !meal
    ? ""
    : meal.short
      ? `<br><em style="color:#b34a4a;">${game.i18n.format(
          "REDSTEEL.LongRest.WentHungry",
          { eaten: meal.eaten, needed: meal.needed },
        )}</em>`
      : `<br><em>${game.i18n.format("REDSTEEL.LongRest.AteRations", {
          eaten: meal.eaten,
          left: meal.left,
        })}</em>`;

  // ─── Chat Message ───
  const iconUrl = "icons/magic/time/day-night-sunset-sunrise.webp";

  const chatMessage = `
<div style="display:flex; align-items:center; gap:10px;">
  <img src="${iconUrl}" width="36" height="36"
       style="border-radius:50%;" />
  <div>
    <p style="color:#007ba9; font-size:1.2em;">
      <strong>Used Long Rest action</strong>
    </p>
    <strong>${actor.name}</strong>
    had a long rest that soothes body and soul.
    <br>
    <em>
      Health +${healthRegen},
      Stamina +${system.stats.stamina.max}
      ${manaText},
      Mind +1,
      Fatigue -1,
      Toxicity -${toxicityReduction}.
    </em>
    ${rerollsRestored ? "<br><em>Rerolls restored.</em>" : ""}
    ${mealText}
  </div>
</div>
`;

  await ChatMessage.create({
    content: chatMessage,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
}

// Spend one charge of the actor's first aid kit (a "first aid" consumable),
// deleting the stack when it runs out — mirrors the potion-consume pattern.
async function consumeFirstAidKit(actor) {
  const kit = actor.items.find(
    (i) =>
      i.type === "consumable" &&
      i.system?.option === "first aid" &&
      Number(i.system?.quantity ?? 1) > 0,
  );
  if (!kit) return;

  const newQty = Number(kit.system.quantity ?? 1) - 1;
  if (newQty > 0) {
    await kit.update({ "system.quantity": newQty });
  } else {
    await kit.delete();
  }
}

// A Healing salve spent on a First Aid attempt adds +1d6 to the heal. Crafted
// copies come from the compendium item via the recipe's resultUuid, so they
// carry the same localizationKey — the name check only catches hand-made ones.
const SALVE_LOC_KEY = "REDSTEEL.Items.HealingSalve.name";

function findHealingSalve(actor) {
  return actor.items.find(
    (i) =>
      i.type === "consumable" &&
      Number(i.system?.quantity ?? 1) > 0 &&
      (i.system?.localizationKey === SALVE_LOC_KEY ||
        /^\s*(healing salve|hojivá mast)\s*$/i.test(i.name ?? "")),
  );
}

// Spend one dose of the actor's Healing salve — same stack pattern as the kit.
async function consumeHealingSalve(actor) {
  const salve = findHealingSalve(actor);
  if (!salve) return;

  const newQty = Number(salve.system.quantity ?? 1) - 1;
  if (newQty > 0) {
    await salve.update({ "system.quantity": newQty });
  } else {
    await salve.delete();
  }
}

/**
 * First Aid heal formula. Margin tiers add flat dice on top of the base heal
 * (they used to multiply the whole roll); Feldsher and a spent Healing salve
 * stack their own dice on top.
 */
function buildFirstAidHealFormula(actor, total, { useSalve = false, critSuccess = false } = {}) {
  const parts = ["3d6+3"];

  if (critSuccess || total >= 60) parts.push("2d6");
  else if (total >= 25) parts.push("1d6");

  if (actor.system.feldsher2) parts.push("2d6");
  else if (actor.system.feldsher1) parts.push("1d6");

  if (useSalve) parts.push("1d6");

  return parts.join(" + ");
}

// Builds the Medical Action dialog buttons. In combat every action requires a
// target and starts the 4-action commit process (Treat Wound is unavailable);
// out of combat the actions roll immediately (and Treat Wound is offered).
// The salve is only ever spent on First Aid — it does nothing for the others.
function buildMedicalButtons({
  actor,
  token,
  getExtraPenalty,
  getUseSalve,
  consumeKitIfUsed,
  consumeSalveIfUsed,
}) {
  const immediate = (actionType, perform, { salve = false } = {}) => async (html) => {
    const useSalve = salve && getUseSalve(html);
    const done = await perform(actor, token, getExtraPenalty(html, actionType), {
      useSalve,
    });
    if (done) {
      await consumeKitIfUsed(html);
      if (useSalve) await consumeSalveIfUsed();
    }
  };

  const combatStart = (actionType) => async (html) => {
    const useSalve = actionType === "firstAid" && getUseSalve(html);
    const started = await startCombatFirstAid(
      actor,
      actionType,
      getExtraPenalty(html, actionType),
      useSalve,
    );
    if (started) {
      await consumeKitIfUsed(html);
      if (useSalve) await consumeSalveIfUsed();
    }
  };

  if (isCombatActive(actor)) {
    return {
      firstAid: { label: "First Aid", callback: combatStart("firstAid") },
      stopBleeding: {
        label: "Stop Bleeding",
        callback: combatStart("stopBleeding"),
      },
      stabilise: { label: "Stabilise", callback: combatStart("stabilise") },
    };
  }

  return {
    firstAid: {
      label: "First Aid",
      callback: immediate("firstAid", performFirstAid, { salve: true }),
    },
    stopBleeding: {
      label: "Stop Bleeding",
      callback: immediate("stopBleeding", performStopBleeding),
    },
    stabilise: {
      label: "Stabilise",
      callback: immediate("stabilise", performStabilise),
    },
    treatWound: {
      label: "Treat Wound",
      callback: immediate("treatWound", performTreatWound),
    },
  };
}

export async function firstAid() {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;

  // A "first aid" consumable in the inventory counts as having a kit on hand.
  const hasKit = actor.items.some(
    (i) =>
      i.type === "consumable" &&
      i.system?.option === "first aid" &&
      Number(i.system?.quantity ?? 1) > 0,
  );

  // A Healing salve may be spent to boost a First Aid heal by +1d6.
  const salve = findHealingSalve(actor);
  const salveQty = Number(salve?.system?.quantity ?? 0);

  // −30% per ticked modifier, shared by every medical action below. Stop
  // Bleeding is the exception: binding your own wound is no harder than
  // binding someone else's, so it never takes the self-heal penalty.
  const getExtraPenalty = (html, actionType) => {
    const selfHeal =
      actionType !== "stopBleeding" &&
      html.find('[name="selfHeal"]').is(":checked");
    const noKit = html.find('[name="noKit"]').is(":checked");
    return (selfHeal ? 30 : 0) + (noKit ? 30 : 0);
  };

  const getUseSalve = (html) =>
    !!salve && html.find('[name="useSalve"]').is(":checked");

  // Spend one kit charge — but only when a kit is actually used (the player
  // has one and didn't tick "No first aid kit").
  const consumeKitIfUsed = async (html) => {
    if (!hasKit) return;
    if (html.find('[name="noKit"]').is(":checked")) return;
    await consumeFirstAidKit(actor);
  };

  const consumeSalveIfUsed = async () => {
    if (!salve) return;
    await consumeHealingSalve(actor);
  };

  new Dialog(
    {
      title: "Medical Action",

      content: `
      <p>Select medical action:</p>
      <div class="redsteel-medical-options">
        <label>
          <input type="checkbox" name="selfHeal">
          Self heal (−30%, not applied to Stop Bleeding)
        </label>
        <label>
          <input type="checkbox" name="noKit" ${hasKit ? "" : "checked disabled"}>
          No first aid kit (−30%)${hasKit ? "" : " — none in inventory"}
        </label>
        <label>
          <input type="checkbox" name="useSalve" ${salve ? "" : "disabled"}>
          Use healing salve (+1d6 heal, First Aid only)${
            salve ? ` — ${salveQty} left` : " — none in inventory"
          }
        </label>
      </div>
    `,

      buttons: buildMedicalButtons({
        actor,
        token,
        getExtraPenalty,
        getUseSalve,
        consumeKitIfUsed,
        consumeSalveIfUsed,
      }),

      default: "firstAid",
    },
    { classes: ["dialog", "redsteel-medical-dialog"] },
  ).render(true);
}

async function performFirstAid(actor, token, extraPenalty = 0, { useSalve = false } = {}) {
  let firstAidData =
    actor.type === "npc"
      ? actor.system.attributes.int.mod
      : actor.system.skills.firstAid;

  let healbonus = "";

  const criticalFailureThreshold =
    actor.type === "npc" ? 96 : firstAidData.criticalFailureThreshold;

  const criticalSuccessThreshold =
    actor.type === "npc" ? 5 : firstAidData.criticalSuccessThreshold;

  if (actor.system.feldsher2) healbonus = "+2d6";
  else if (actor.system.feldsher1) healbonus = "+1d6";

  const rollFormula =
    actor.type === "npc"
      ? `@attributes.int.mod - ${extraPenalty} - 1d100`
      : `@skills.firstAid.rating - ${extraPenalty} - 1d100`;

  const firstAidRoll = new Roll(rollFormula, actor.getRollData());

  await firstAidRoll.evaluate({ async: true });

  const d100 = firstAidRoll.dice[0]?.total;

  const bonus = healbonus ? `${healbonus}` : "";

  let critStatus = "";
  let rollName = "firstAid";
  let healRoll = null;

  const isCritFail = d100 >= criticalFailureThreshold;
  const isCritSuccess = d100 <= criticalSuccessThreshold;

  if (isCritFail) {
    critStatus =
      "<br><strong style='color: red;'>Critical Failure! Injury caused!</strong>";

    // The injury never benefits from a salve — only from the botcher's reach.
    healRoll = new Roll(`2d4${bonus}`);
  } else if (firstAidRoll.total <= 0) {
    healRoll = null;
  } else {
    if (isCritSuccess || firstAidRoll.total >= 60) {
      critStatus = "<br><strong style='color: green;'>Critical Success!</strong>";
    }

    healRoll = new Roll(
      buildFirstAidHealFormula(actor, firstAidRoll.total, {
        useSalve,
        critSuccess: isCritSuccess,
      }),
    );
  }

  if (healRoll) {
    await healRoll.evaluate({ async: true });
  }

  const iconUrl = "icons/magic/life/cross-yellow-green.webp";

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({
      actor,
      token: token?.document,
    }),

    flavor: `
<div style="display:flex; align-items:center; gap:10px;">
  <img src="${iconUrl}" width="36" height="36" style="border-radius:50%;" />
  <div>
    <p style="color:#007ba9; font-size:1.2em;">
      <strong>Used first aid action</strong>
      ${critStatus}
    </p>
    ${
      useSalve
        ? `<p style="font-size:0.85em; opacity:0.8;">Healing salve spent (+1d6).</p>`
        : ""
    }
  </div>
</div>
    `,

    flags: {
      redsteel: {
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        ...(healRoll && !isCritFail
          ? { firstAidHeal: { amount: healRoll.total } }
          : {}),
        // Critical failure injures the patient — armor-ignoring damage applied
        // via the Apply Injury button (see registerFirstAidHealing).
        ...(isCritFail && healRoll
          ? { firstAidInjury: { amount: healRoll.total } }
          : {}),
      },
    },

    rolls: healRoll ? [firstAidRoll, healRoll] : [firstAidRoll],

    type: CONST.CHAT_MESSAGE_STYLES.ROLL,
  });

  return true;
}
async function performStopBleeding(actor, token, extraPenalty = 0) {
  // A First Aid test at +30%. The self-heal penalty never reaches here — the
  // dialog strips it for this action (see getExtraPenalty).
  const skillBase =
    actor.type === "npc"
      ? Number(actor.system.attributes.int.mod ?? 0)
      : Number(actor.system.skills.firstAid.rating ?? 0);

  // Hemophylia makes stopping the bleeding 20% harder.
  const hemophiliaPenalty = actor.system?.hemophilia ? 20 : 0;

  const stopBleedingRoll = new Roll(
    `${skillBase + 30} - ${extraPenalty} - ${hemophiliaPenalty} - 1d100`,
  );

  await stopBleedingRoll.evaluate({ async: true });

  const success = stopBleedingRoll.total >= 0;

  const resultText = success
    ? "<strong style='color: green;'>Success!</strong>"
    : "<strong style='color: red;'>Failure!</strong>";

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({
      actor,
      token: token?.document,
    }),

    flavor: `
<div style="display:flex; align-items:center; gap:10px;">
  <div>
    <p style="color:#007ba9; font-size:1.2em;">
      <strong>Attempted to stop bleeding</strong><br>
      ${resultText}
    </p>
  </div>
</div>
    `,

    rolls: [stopBleedingRoll],

    type: CONST.CHAT_MESSAGE_STYLES.ROLL,

    flags: {
      redsteel: {
        rollName: "stopBleeding",
        // A successful test offers a "Remove Bleeding" button on the card
        // (wired in registerFirstAidHealing).
        ...(success
          ? { stopBleedingResult: { success: true, actorUuid: actor.uuid } }
          : {}),
      },
    },
  });

  return true;
}

/**
 * Stabilise a Dying target: a First Aid roll penalised by −10% plus −20% per
 * negative round of the target's dying counter (roundsUntilDeath). On success
 * the target is brought back to 1 health and the Dying effect is removed
 * (which, via the effect's _onDelete, applies the +1 Wound and resolve test).
 */
function getStabilisePenalty(roundsUntilDeath) {
  const negativeRounds = Math.max(0, -Number(roundsUntilDeath || 0));
  // −10% base, plus −20% for every negative round of the dying counter.
  return { negativeRounds, penalty: 10 + 20 * negativeRounds };
}

async function performStabilise(actor, token, extraPenalty = 0) {
  void token;
  const targets = Array.from(game.user.targets);
  if (targets.length !== 1) {
    ui.notifications.warn("Target exactly one dying token to stabilise.");
    return false;
  }

  const targetToken = targets[0];
  const targetActor = targetToken.actor;
  if (!targetActor) return false;

  const dying = targetActor.effects.find(
    (e) => e.getFlag("core", "statusId") === "dying",
  );
  // A target at 0 health always warrants a stabilise attempt, even if it lacks
  // the Dying effect (e.g. an NPC, or a character whose Dying was cleared).
  const atZeroHealth = Number(targetActor.system.stats.health?.value ?? 0) <= 0;
  if (!dying && !atZeroHealth) {
    ui.notifications.warn(`${targetActor.name} is not Dying.`);
    return false;
  }

  const { penalty } = getStabilisePenalty(
    dying?.getFlag("redsteel", "roundsUntilDeath"),
  );

  const base =
    actor.type === "npc"
      ? Number(actor.system.attributes.int.mod ?? 0)
      : Number(actor.system.skills.firstAid.rating ?? 0);

  await rollAndPostStabilise({
    sceneId: canvas.scene.id,
    targetId: targetToken.id,
    base,
    penalty: penalty + extraPenalty,
    aiderUuid: actor.uuid,
  });

  return true;
}

/**
 * Rolls (or re-rolls) a stabilisation attempt and posts the result. On success
 * the target is brought to 1 HP and Dying is removed (via GM). On failure the
 * posted card carries a dedicated Re-Roll button (see registerFirstAidHealing)
 * that re-runs this same attempt — so a re-roll can actually succeed and apply.
 */
async function rollAndPostStabilise({
  sceneId,
  targetId,
  base,
  penalty,
  aiderUuid,
}) {
  const targetActor = game.scenes.get(sceneId)?.tokens.get(targetId)?.actor;
  if (!targetActor) return;

  const aider = aiderUuid ? fromUuidSync(aiderUuid) : null;
  const aiderName = aider?.name ?? "The healer";

  const roll = new Roll(`${base} - ${penalty} - 1d100`);
  await roll.evaluate();
  const success = roll.total >= 0;

  const resultText = success
    ? `<strong style="color:green;">Success!</strong> ${targetActor.name} is stabilised — brought back to <strong>1 health</strong> and the <strong>Dying</strong> effect is removed.`
    : `<strong style="color:red;">Failure!</strong> ${aiderName} is having grave difficulties saving the dying ${targetActor.name}.`;

  const iconUrl = "icons/magic/life/cross-yellow-green.webp";

  await ChatMessage.create({
    speaker: aider
      ? ChatMessage.getSpeaker({ actor: aider })
      : ChatMessage.getSpeaker(),
    flavor: `
<div style="display:flex; align-items:center; gap:10px;">
  <img src="${iconUrl}" width="36" height="36" style="border-radius:50%;" />
  <div>
    <p style="color:#007ba9; font-size:1.2em;">
      <strong>Attempted to stabilise ${targetActor.name}</strong><br>
      ${resultText}
    </p>
    <p style="font-size:0.85em; opacity:0.8;">Stabilisation penalty: −${penalty}%.</p>
  </div>
</div>`,
    rolls: [roll],
    type: CONST.CHAT_MESSAGE_STYLES.ROLL,
    flags: {
      redsteel: {
        rollName: "Stabilise",
        stabilise: {
          sceneId,
          targetId,
          base,
          penalty,
          aiderUuid,
          failed: !success,
        },
      },
    },
  });

  if (success) {
    await requestApplyStabilise(sceneId, targetId);
  }
}

async function requestApplyStabilise(sceneId, targetId) {
  const data = { type: "applyStabilise", sceneId, targetId };

  if (game.user.isGM) {
    await applyStabiliseAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
    ui.notifications.info("Stabilisation sent to GM.");
  }
}

async function applyStabiliseAsGM(data) {
  const { sceneId, targetId } = data;

  const tokenDoc = game.scenes.get(sceneId)?.tokens.get(targetId);
  const actor = tokenDoc?.actor;
  if (!actor) return;

  // Back to 1 health, then drop Dying (its _onDelete handles +1 Wound and the
  // resolve test). Downed is intentionally left in place.
  //
  // The removal goes through the shared helper rather than a local find/delete:
  // the GM's updateActor hook reacts to this very health write with the same
  // deletion, and two unguarded deletes race into one failing on an
  // already-deleted document.
  await actor.update({ "system.stats.health.value": 1 });
  await game.redsteel.endDyingIfHealed?.(actor);

  // A successful Stabilise also stops all bleeding.
  await clearBleedEffects(actor);
}

/**
 * Treat Wound: a First Aid roll at −30%. On success it marks one more grave
 * wound as treated on the target, capped so treated never exceeds the actual
 * wound count.
 */
async function performTreatWound(actor, token, extraPenalty = 0) {
  const targets = Array.from(game.user.targets);
  if (targets.length !== 1) {
    ui.notifications.warn("Target exactly one token to treat a wound.");
    return false;
  }

  const targetToken = targets[0];
  const targetActor = targetToken.actor;
  if (!targetActor) return false;

  const gw = targetActor.system.stats?.graveWounds ?? {};
  const wounds = Number(gw.value ?? 0);
  const treated = Number(gw.treated ?? 0);

  if (treated >= wounds) {
    ui.notifications.warn(
      `${targetActor.name} has no untreated wounds to treat.`,
    );
    return false;
  }

  const penalty = 30 + extraPenalty;
  const base =
    actor.type === "npc"
      ? Number(actor.system.attributes.int.mod ?? 0)
      : Number(actor.system.skills.firstAid.rating ?? 0);

  const roll = new Roll(`${base} - ${penalty} - 1d100`);
  await roll.evaluate();
  const success = roll.total >= 0;

  const resultText = success
    ? `<strong style="color:green;">Success!</strong> One of ${targetActor.name}'s wounds is treated.`
    : `<strong style="color:red;">Failure!</strong> ${actor.name} fails to treat ${targetActor.name}'s wound.`;

  const iconUrl = "icons/magic/life/cross-yellow-green.webp";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
    flavor: `
<div style="display:flex; align-items:center; gap:10px;">
  <img src="${iconUrl}" width="36" height="36" style="border-radius:50%;" />
  <div>
    <p style="color:#007ba9; font-size:1.2em;">
      <strong>Attempted to treat ${targetActor.name}'s wound</strong><br>
      ${resultText}
    </p>
    <p style="font-size:0.85em; opacity:0.8;">Treat Wound penalty: −${penalty}%.</p>
  </div>
</div>`,
    rolls: [roll],
    type: CONST.CHAT_MESSAGE_STYLES.ROLL,
    flags: { redsteel: { rollName: "Treat Wound" } },
  });

  if (success) {
    await requestApplyTreatWound(canvas.scene.id, targetToken.id);
  }

  return true;
}

async function requestApplyTreatWound(sceneId, targetId) {
  const data = { type: "applyTreatWound", sceneId, targetId };

  if (game.user.isGM) {
    await applyTreatWoundAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
    ui.notifications.info("Wound treatment sent to GM.");
  }
}

async function applyTreatWoundAsGM(data) {
  const { sceneId, targetId } = data;

  const actor = game.scenes.get(sceneId)?.tokens.get(targetId)?.actor;
  if (!actor) return;

  const gw = actor.system.stats?.graveWounds ?? {};
  const wounds = Number(gw.value ?? 0);
  const treated = Number(gw.treated ?? 0);

  // Never treat more wounds than the target actually has.
  const newTreated = Math.min(treated + 1, wounds);
  if (newTreated === treated) return;

  await actor.update({ "system.stats.graveWounds.treated": newTreated });
}

/* -------------------------------------------- */
/*  In-combat First Aid (4-action commitment)   */
/* -------------------------------------------- */
//
// In combat a medical action costs 4 actions, so it is committed across
// rounds: starting it sets a `firstAidProgress` flag on the aider and pauses
// the target's bleeding (collecting the dice). Each round at the aider's turn
// a counter card is posted; the aider rolls when 4 actions are spent (or
// aborts). All state lives on the GM — player clicks just emit a socket.

const FA_STEP_LABELS = [
  "1 – 2 / 4 actions spent",
  "2 – 4 / 4 actions spent",
  "3 – 4 / 4 actions spent",
  "4 / 4 actions spent",
];

const FA_LABELS = {
  firstAid: "First Aid",
  stopBleeding: "Stop Bleeding",
  stabilise: "Stabilise",
};

const FA_APPLY_LABELS = {
  firstAid: "Apply Heal",
  stopBleeding: "Stop Bleeding",
  stabilise: "Stabilise",
};

// True only when the actor is a participant in the running combat — otherwise
// the per-turn counter advance would never fire and the attempt would stall.
function isCombatActive(actor) {
  if (!game.combat?.started) return false;
  return isActorInCombat(actor, game.combat);
}

// Routes a combat-first-aid request to the GM (all mutations happen GM-side).
async function faRequest(data) {
  if (game.user.isGM) await faHandleAsGM(data);
  else game.socket.emit(SOCKET, data);
}

async function faHandleAsGM(data) {
  switch (data.type) {
    case "faStart":
      return faStartAsGM(data);
    case "faClearProgress":
      return faClearProgressAsGM(data);
    case "faAbort":
      return abortCombatFirstAid(fromUuidSync(data.actorUuid), false);
    case "faResume":
      return resumeBleeds(
        game.scenes.get(data.sceneId)?.tokens.get(data.targetId)?.actor,
      );
    case "faApply":
      return faApplyAsGM(data);
  }
}

// Client-side: validate the target, then ask the GM to begin the attempt.
async function startCombatFirstAid(actor, actionType, extraPenalty, useSalve = false) {
  const targets = Array.from(game.user.targets);
  if (targets.length !== 1) {
    ui.notifications.warn("Target exactly one token first.");
    return false;
  }

  const targetActor = targets[0].actor;
  if (!targetActor) return false;

  if (actionType === "stabilise") {
    const dying = targetActor.effects.find(
      (e) => e.getFlag("core", "statusId") === "dying",
    );
    // Allow the attempt on any 0-health target, not only those carrying the
    // Dying effect (mirrors performStabilise).
    const atZeroHealth =
      Number(targetActor.system.stats.health?.value ?? 0) <= 0;
    if (!dying && !atZeroHealth) {
      ui.notifications.warn(`${targetActor.name} is not Dying.`);
      return false;
    }
  }

  if (actor.getFlag("redsteel", "firstAidProgress")) {
    ui.notifications.warn(`${actor.name} is already performing a medical action.`);
    return false;
  }

  await faRequest({
    type: "faStart",
    actorUuid: actor.uuid,
    actionType,
    sceneId: canvas.scene.id,
    targetId: targets[0].id,
    extraPenalty,
    useSalve,
  });
  return true;
}

async function faStartAsGM(data) {
  const actor = fromUuidSync(data.actorUuid);
  const targetActor = game.scenes
    .get(data.sceneId)
    ?.tokens.get(data.targetId)?.actor;
  if (!actor || !targetActor) return;

  const attemptId = foundry.utils.randomID();
  await actor.setFlag("redsteel", "firstAidProgress", {
    attemptId,
    actionType: data.actionType,
    sceneId: data.sceneId,
    targetId: data.targetId,
    extraPenalty: Number(data.extraPenalty) || 0,
    // The dose is already spent at start — it boosts the heal whenever the
    // committed attempt finally resolves, re-rolls included.
    useSalve: !!data.useSalve,
    step: 1,
  });

  // Pause the target's bleeding and start collecting dice.
  await targetActor.setFlag("redsteel", "firstAidPause", {
    dice: 0,
    aiderUuid: data.actorUuid,
  });

  await postFaCounterCard(actor, 1);
}

async function postFaCounterCard(actor, step) {
  const prog = actor.getFlag("redsteel", "firstAidProgress");
  if (!prog) return;

  const label = FA_STEP_LABELS[Math.min(step, FA_STEP_LABELS.length) - 1];

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="redsteel-firstaid">
        <p><b>${actor.name}</b> is performing <b>${FA_LABELS[prog.actionType]}</b> — ${label}.</p>
        <div class="redsteel-action-buttons">
          <button type="button" data-action="faRoll">Roll the test</button>
          <button type="button" data-action="faAbort">Abort</button>
        </div>
      </div>`,
    flags: {
      redsteel: {
        firstAidCounter: { attemptId: prog.attemptId, actorUuid: actor.uuid },
      },
    },
  });
}

// Called at the aider's turn start (GM, from effects.mjs _onTurnStart).
export async function advanceCombatFirstAid(actor) {
  const prog = actor?.getFlag?.("redsteel", "firstAidProgress");
  if (!prog) return;

  const newStep = prog.step + 1;

  // Past the 4/4 card without resolving → the attempt is abandoned.
  if (newStep > FA_STEP_LABELS.length) {
    await abortCombatFirstAid(actor, true);
    return;
  }

  await actor.setFlag("redsteel", "firstAidProgress", { ...prog, step: newStep });
  await postFaCounterCard(actor, newStep);
}

async function abortCombatFirstAid(actor, timedOut) {
  const prog = actor?.getFlag?.("redsteel", "firstAidProgress");
  if (!prog) return;

  await actor.unsetFlag("redsteel", "firstAidProgress");

  const targetActor = game.scenes
    .get(prog.sceneId)
    ?.tokens.get(prog.targetId)?.actor;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><b>${actor.name}</b> abandons the medical action${
      timedOut ? " (ran out of time)" : ""
    }. Collected bleeding resumes.</p>`,
  });

  // Interruption rolls the collected bleeding immediately and resumes it.
  await resumeBleeds(targetActor);
}

// The roll itself now happens on the aider's client (so the hotbar roll
// modifier and the actor's advantage bias apply, and the dice are shown). The
// GM only clears the committed-progress flag so the attempt can't be re-rolled
// or re-advanced. Validated against the attemptId to ignore stale cards.
async function faClearProgressAsGM(data) {
  const actor = fromUuidSync(data.actorUuid);
  const prog = actor?.getFlag?.("redsteel", "firstAidProgress");
  if (!prog || prog.attemptId !== data.attemptId) return; // stale card

  await actor.unsetFlag("redsteel", "firstAidProgress");
}

function computeFaTest(actor, targetActor, actionType, extraPenalty) {
  const skillBase =
    actor.type === "npc"
      ? Number(actor.system.attributes.int.mod ?? 0)
      : Number(actor.system.skills.firstAid.rating ?? 0);

  if (actionType === "stopBleeding") {
    // First Aid at +30%. extraPenalty already excludes the self-heal −30%.
    // Hemophylia makes stopping the bleeding 20% harder.
    const hemophiliaPenalty = actor.system?.hemophilia ? 20 : 0;
    return { base: skillBase + 30, penalty: extraPenalty + hemophiliaPenalty };
  }

  if (actionType === "stabilise") {
    const dying = targetActor?.effects.find(
      (e) => e.getFlag("core", "statusId") === "dying",
    );
    const { penalty } = getStabilisePenalty(
      dying?.getFlag("redsteel", "roundsUntilDeath"),
    );
    return { base: skillBase, penalty: penalty + extraPenalty };
  }

  return { base: skillBase, penalty: extraPenalty }; // firstAid
}

async function computeFaHeal(actor, total, useSalve = false) {
  const roll = new Roll(buildFirstAidHealFormula(actor, total, { useSalve }));
  await roll.evaluate();
  return Math.floor(roll.total);
}

// Rolls the committed (or re-rolled) test and posts the success/fail card.
// Runs on the aider's client: building the roll with the actor's roll data and
// tagging it with the First Aid skill lets the global roll-modifier wrapper
// apply the hotbar picker and the actor's advantage/disadvantage bias — exactly
// like every other margin-of-success test — and the dice are shown in the card.
async function faResolveAndPost(actor, ctx) {
  if (!actor) return;
  const targetActor = game.scenes
    .get(ctx.sceneId)
    ?.tokens.get(ctx.targetId)?.actor;
  if (!targetActor) return;

  const extraPenalty = Number(ctx.extraPenalty) || 0;
  const { base, penalty } = computeFaTest(
    actor,
    targetActor,
    ctx.actionType,
    extraPenalty,
  );

  const roll = new Roll(`${base} - ${penalty} - 1d100`, actor.getRollData());
  // Every medical action, Stop Bleeding included, is a First Aid test.
  tagRollSkill(roll, "firstAid");
  await roll.evaluate();
  const success = roll.total >= 0;

  const useSalve = !!ctx.useSalve && ctx.actionType === "firstAid";

  let healAmount = 0;
  if (success && ctx.actionType === "firstAid") {
    healAmount = await computeFaHeal(actor, roll.total, useSalve);
  }

  const label = FA_LABELS[ctx.actionType];
  let body;
  let buttons;

  if (success) {
    const removal =
      ctx.actionType === "firstAid"
        ? `Heals <b>${healAmount}</b> HP and removes`
        : "Removes";
    body = `<p><b>${label} — Success.</b> ${removal} all bleeding from ${targetActor.name}.</p>`;
    buttons = `<button type="button" data-action="faApply">${FA_APPLY_LABELS[ctx.actionType]}</button>`;
  } else {
    body = `<p><b>${label} — Failure.</b> ${actor.name} fails to help ${targetActor.name}.</p>`;
    buttons = `
      <button type="button" data-action="faReroll">Re-Roll</button>
      <button type="button" data-action="faResume">Resume bleeds</button>`;
  }

  // Custom content suppresses Foundry's automatic dice rendering, so embed the
  // rendered roll ourselves to show the test (formula, total, expandable dice).
  const rollHTML = await roll.render();

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="redsteel-firstaid">
        ${body}
        ${rollHTML}
        <p style="font-size:0.85em; opacity:0.8;">Penalty: −${penalty}%.${
          useSalve ? " Healing salve spent (+1d6)." : ""
        }</p>
        <div class="redsteel-action-buttons">${buttons}</div>
      </div>`,
    rolls: [roll],
    type: CONST.CHAT_MESSAGE_STYLES.ROLL,
    flags: {
      redsteel: {
        rollName: label,
        firstAidResult: {
          actorUuid: actor.uuid,
          actionType: ctx.actionType,
          sceneId: ctx.sceneId,
          targetId: ctx.targetId,
          extraPenalty,
          useSalve,
          success,
          healAmount,
        },
      },
    },
  });
}

// Resume paused bleeding: roll the collected dice, apply, and clear the pause
// so normal bleed ticks continue next round.
async function resumeBleeds(targetActor) {
  if (!targetActor) return;
  const pause = targetActor.getFlag("redsteel", "firstAidPause");
  if (!pause) return;

  const dice = Number(pause.dice ?? 0);
  await targetActor.unsetFlag("redsteel", "firstAidPause");

  if (dice > 0) {
    const roll = new Roll(`${dice}d4`);
    await roll.evaluate();
    const current = Number(targetActor.system.stats.health.value ?? 0);
    await targetActor.update({
      "system.stats.health.value": current - roll.total,
    });
    // Held bleed damage is still Life lost to Bleeding, so it feeds a Blood
    // caster's Reserve exactly like a normal tick.
    const gained = await gainBloodFromBleed(targetActor, roll.total);
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      flavor: `Collected bleeding resumes (${dice}d4)${bloodGainNote(
        targetActor,
        gained,
      )}`,
    });
    await game.redsteel.applyZeroHealthState?.(targetActor);
  }
}

async function faApplyAsGM(data) {
  const targetActor = game.scenes
    .get(data.sceneId)
    ?.tokens.get(data.targetId)?.actor;
  if (!targetActor) return;

  // Guard against double-apply: the pause flag is the marker that the
  // (successful) attempt is still awaiting resolution.
  if (!targetActor.getFlag("redsteel", "firstAidPause")) return;
  await targetActor.unsetFlag("redsteel", "firstAidPause");

  // Every successful action clears all bleeding (the collected dice are
  // discarded — no damage on success).
  const bleeds = targetActor.effects.filter(
    (e) => e.getFlag("core", "statusId") === "bleed",
  );
  for (const bleed of bleeds) await bleed.delete();

  let note = "bleeding stopped";

  if (data.actionType === "stabilise") {
    await targetActor.update({ "system.stats.health.value": 1 });
    // Shared guarded removal — see applyStabiliseAsGM for why this must not be
    // a local find/delete.
    await game.redsteel.endDyingIfHealed?.(targetActor);
    note = "stabilised (1 HP) and bleeding stopped";
  } else if (data.actionType === "firstAid") {
    const heal = Math.floor(Number(data.healAmount) || 0);
    if (heal > 0) {
      const current = Number(targetActor.system.stats.health.value ?? 0);
      await targetActor.update({
        "system.stats.health.value": current + heal,
      });
    }
    note = `healed for ${Math.floor(Number(data.healAmount) || 0)} HP and bleeding stopped`;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content: `<p><b>${targetActor.name}</b> — ${note}.</p>`,
  });
}

/* -------------------------------------------- */
/*  First Aid Healing                           */
/* -------------------------------------------- */

const SOCKET = "system.redsteel";
const FLAG_SCOPE = "redsteel";
const HEALTH_SNAPSHOT_FLAG = "combatStartHealth";

// First aid may not heal above the health the target had when the last
// combat started — only recently received damage can be patched up.
async function snapshotCombatHealth(combatant) {
  const actor = combatant?.actor;
  if (!actor) return;

  const hp = actor.system?.stats?.health?.value;
  if (typeof hp !== "number") return;

  await actor.setFlag(FLAG_SCOPE, HEALTH_SNAPSHOT_FLAG, hp);
}

function getFirstAidHealContext(actor, healAmount, force) {
  const amount = Math.floor(Number(healAmount) || 0);
  const currentHp = Number(actor.system.stats.health.value ?? 0);
  const cap = actor.getFlag(FLAG_SCOPE, HEALTH_SNAPSHOT_FLAG);
  const hasCap = typeof cap === "number";

  const applied =
    force || !hasCap ? amount : Math.max(0, Math.min(amount, cap - currentHp));

  return { amount, currentHp, cap, hasCap, applied };
}

export function registerFirstAidHealing() {
  // Snapshot every combatant's health when combat actually begins
  Hooks.on("combatStart", async (combat) => {
    if (!game.users.activeGM?.isSelf) return;

    for (const combatant of combat.combatants) {
      await snapshotCombatHealth(combatant);
    }
  });

  // Combatants joining an already running combat get snapshotted on entry
  Hooks.on("createCombatant", async (combatant) => {
    if (!game.users.activeGM?.isSelf) return;
    if (!combatant.parent?.started) return;

    await snapshotCombatHealth(combatant);
  });

  Hooks.on("renderChatMessageHTML", (message, html) => {
    const heal = message.flags?.redsteel?.firstAidHeal;
    if (!heal) return;
    if (game.user.id !== message.author?.id && !game.user.isGM) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    const applyHealButton = document.createElement("button");
    applyHealButton.type = "button";
    applyHealButton.className = "redsteel-apply-heal";
    applyHealButton.dataset.messageId = message.id;
    applyHealButton.textContent = "Apply Heal";

    buttonContainer.appendChild(applyHealButton);

    const buttonCount = buttonContainer.querySelectorAll(
      "button, a.button",
    ).length;
    buttonContainer.classList.toggle("single", buttonCount <= 1);

    applyHealButton.addEventListener("click", () => {
      handleApplyHeal(message.id);
    });
  });

  // "Remove Bleeding" button on a successful out-of-combat Stop Bleeding card.
  // (In-combat Stop Bleeding already clears bleeds via its own faApply button.)
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const result = message.flags?.redsteel?.stopBleedingResult;
    if (!result?.success) return;
    if (game.user.id !== message.author?.id && !game.user.isGM) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "redsteel-remove-bleeding";
    removeButton.dataset.messageId = message.id;
    removeButton.textContent = "Remove Bleeding";

    buttonContainer.appendChild(removeButton);

    const buttonCount = buttonContainer.querySelectorAll(
      "button, a.button",
    ).length;
    buttonContainer.classList.toggle("single", buttonCount <= 1);

    removeButton.addEventListener("click", () => {
      handleRemoveBleeding(message.id);
    });
  });

  // Apply Injury button (First Aid critical failure → armor-ignoring damage).
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const injury = message.flags?.redsteel?.firstAidInjury;
    if (!injury) return;
    if (game.user.id !== message.author?.id && !game.user.isGM) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    const applyInjuryButton = document.createElement("button");
    applyInjuryButton.type = "button";
    applyInjuryButton.className = "redsteel-apply-injury";
    applyInjuryButton.dataset.messageId = message.id;
    applyInjuryButton.textContent = "Apply Injury (ignores armor)";

    buttonContainer.appendChild(applyInjuryButton);

    const buttonCount = buttonContainer.querySelectorAll(
      "button, a.button",
    ).length;
    buttonContainer.classList.toggle("single", buttonCount <= 1);

    applyInjuryButton.addEventListener("click", () => {
      handleApplyInjury(message.id);
    });
  });

  // Dedicated Re-Roll for a failed Stabilise attempt. The generic Re-Roll is
  // suppressed for these messages (it can't re-apply the stabilisation), so
  // this re-runs the whole attempt and applies on success.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const stab = message.flags?.redsteel?.stabilise;
    if (!stab || !stab.failed) return;
    if (game.user.id !== message.author?.id && !game.user.isGM) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    const rerollButton = document.createElement("button");
    rerollButton.type = "button";
    rerollButton.className = "reroll-button";
    rerollButton.textContent = "Re-Roll Stabilisation";
    buttonContainer.appendChild(rerollButton);

    const buttonCount = buttonContainer.querySelectorAll(
      "button, a.button",
    ).length;
    buttonContainer.classList.toggle("single", buttonCount <= 1);

    rerollButton.addEventListener("click", async () => {
      rerollButton.disabled = true;
      await rollAndPostStabilise(stab);
    });
  });

  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
      if (!game.user.isGM) return;

      if (data.type === "applyFirstAidHeal") {
        await applyFirstAidHealAsGM(data);
      } else if (data.type === "applyFirstAidInjury") {
        await applyFirstAidInjuryAsGM(data);
      } else if (data.type === "applyStabilise") {
        await applyStabiliseAsGM(data);
      } else if (data.type === "applyTreatWound") {
        await applyTreatWoundAsGM(data);
      } else if (data.type === "applyRemoveBleeding") {
        await applyRemoveBleedingAsGM(data);
      } else if (typeof data.type === "string" && data.type.startsWith("fa")) {
        await faHandleAsGM(data);
      }
    });
  });

  // Buttons on the in-combat First Aid counter / result cards. Only the aider
  // (or GM) wires them. The actual test roll (Roll the test / Re-Roll) runs on
  // this client so the roll modifier and advantage bias apply and the dice are
  // shown; the other buttons just emit a socket for the GM to mutate state.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const counter = message.flags?.redsteel?.firstAidCounter;
    const result = message.flags?.redsteel?.firstAidResult;
    if (!counter && !result) return;

    const actorUuid = counter?.actorUuid ?? result?.actorUuid;
    const actor = actorUuid ? fromUuidSync(actorUuid) : null;
    if (!actor?.isOwner) return;

    const wire = (action, build) => {
      html.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          await faRequest(build());
        });
      });
    };

    // Local handler for the buttons that roll the test on this client.
    const wireRoll = (action, run) => {
      html.querySelectorAll(`[data-action="${action}"]`).forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          await run();
        });
      });
    };

    if (counter) {
      // Roll the committed test here, then ask the GM to clear the progress flag
      // so the attempt can't be re-rolled or re-advanced.
      wireRoll("faRoll", async () => {
        const prog = actor.getFlag("redsteel", "firstAidProgress");
        if (!prog || prog.attemptId !== counter.attemptId) return; // stale card
        await faRequest({
          type: "faClearProgress",
          actorUuid,
          attemptId: prog.attemptId,
        });
        await faResolveAndPost(actor, prog);
      });
      wire("faAbort", () => ({ type: "faAbort", actorUuid }));
    }

    if (result && result.success) {
      wire("faApply", () => ({
        type: "faApply",
        actorUuid,
        actionType: result.actionType,
        sceneId: result.sceneId,
        targetId: result.targetId,
        healAmount: result.healAmount,
      }));
    }

    if (result && !result.success) {
      // Re-roll re-runs the whole test on this client (no progress flag left).
      wireRoll("faReroll", () =>
        faResolveAndPost(actor, {
          actionType: result.actionType,
          sceneId: result.sceneId,
          targetId: result.targetId,
          extraPenalty: result.extraPenalty,
          useSalve: result.useSalve,
        }),
      );
      wire("faResume", () => ({
        type: "faResume",
        sceneId: result.sceneId,
        targetId: result.targetId,
      }));
    }
  });
}

function handleApplyInjury(messageId) {
  const message = game.messages.get(messageId);
  if (!message?.flags?.redsteel?.firstAidInjury) return;

  const targets = Array.from(game.user.targets);
  if (targets.length !== 1) {
    ui.notifications.warn("Target exactly one token to apply the injury.");
    return;
  }

  requestApplyFirstAidInjury(message, targets[0]);
}

async function requestApplyFirstAidInjury(message, target) {
  const data = {
    type: "applyFirstAidInjury",
    messageId: message.id,
    sceneId: canvas.scene.id,
    targetId: target.id,
  };

  if (game.user.isGM) {
    await applyFirstAidInjuryAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
    ui.notifications.info("Injury request sent to GM.");
  }
}

async function applyFirstAidInjuryAsGM(data) {
  const { messageId, sceneId, targetId } = data;

  const message = game.messages.get(messageId);
  const injury = message?.flags?.redsteel?.firstAidInjury;
  if (!injury) return;

  const tokenDoc = game.scenes.get(sceneId)?.tokens.get(targetId);
  const actor = tokenDoc?.actor;
  if (!actor) return;

  const amount = Math.floor(Number(injury.amount) || 0);
  const currentHp = Number(actor.system.stats.health.value ?? 0);
  // Ignores armor completely — the damage is subtracted straight from health.
  const newHp = currentHp - amount;

  await actor.update({ "system.stats.health.value": newHp });

  // A botched treatment can drop the patient to 0 (Dying/Downed or death).
  await game.redsteel.applyZeroHealthState?.(actor);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
<div style="display:flex; align-items:center; gap:10px;">
  <div>
    <p style="color:#a30000; font-size:1.2em;">
      <strong>Botched first aid!</strong>
    </p>
    <strong>${actor.name}</strong> takes <strong>${amount}</strong> damage (ignores armor).
  </div>
</div>`,
  });
}

function handleApplyHeal(messageId) {
  const message = game.messages.get(messageId);
  if (!message?.flags?.redsteel?.firstAidHeal) return;

  const targets = Array.from(game.user.targets);
  if (targets.length !== 1) {
    ui.notifications.warn("Target exactly one token to apply the heal.");
    return;
  }

  openHealDialog(message, targets[0]);
}

// Stop Bleeding — remove all Bleeding from the patient. The patient is the one
// targeted token, or (with nothing targeted) the actor who made the test, so
// self-bandaging works without having to target your own token.
function handleRemoveBleeding(messageId) {
  const message = game.messages.get(messageId);
  const result = message?.flags?.redsteel?.stopBleedingResult;
  if (!result?.success) return;

  const targets = Array.from(game.user.targets);
  if (targets.length > 1) {
    ui.notifications.warn("Target at most one token to stop its bleeding.");
    return;
  }

  const data =
    targets.length === 1
      ? {
          type: "applyRemoveBleeding",
          sceneId: canvas.scene.id,
          targetId: targets[0].id,
        }
      : { type: "applyRemoveBleeding", actorUuid: result.actorUuid };

  requestRemoveBleeding(data);
}

async function requestRemoveBleeding(data) {
  if (game.user.isGM) {
    await applyRemoveBleedingAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
    ui.notifications.info("Stop-bleeding request sent to GM.");
  }
}

// Delete every Bleeding effect on an actor; returns how many were removed.
export async function clearBleedEffects(actor) {
  const bleeds = actor.effects.filter(
    (e) => e.getFlag("core", "statusId") === "bleed",
  );
  for (const bleed of bleeds) await bleed.delete();
  return bleeds.length;
}

async function applyRemoveBleedingAsGM(data) {
  const actor = data.targetId
    ? game.scenes.get(data.sceneId)?.tokens.get(data.targetId)?.actor
    : data.actorUuid
      ? fromUuidSync(data.actorUuid)
      : null;
  if (!actor) return;

  const removed = await clearBleedEffects(actor);
  if (!removed) {
    ui.notifications.info(`${actor.name} has no bleeding to stop.`);
    return;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><b>${actor.name}</b> — bleeding stopped.</p>`,
  });
}

function openHealDialog(message, target) {
  const heal = message.flags.redsteel.firstAidHeal;
  const actor = target.actor;
  if (!actor) return;

  const normal = getFirstAidHealContext(actor, heal.amount, false);
  const forced = getFirstAidHealContext(actor, heal.amount, true);

  const capInfo = normal.hasCap
    ? `<p>Heal cap (health at combat start): <strong>${normal.cap}</strong></p>`
    : `<p><em>No combat snapshot found for this target — cap not applied.</em></p>`;

  const previewText = (force) =>
    `Will heal: <strong>${force ? forced.applied : normal.applied}</strong> HP`;

  new Dialog({
    title: "Apply First Aid Heal",
    content: `
      <form>
        <p><strong>${target.name}</strong> — current health: ${normal.currentHp}</p>
        <p>Heal rolled: <strong>${normal.amount}</strong></p>
        ${capInfo}
        <label>
          <input type="checkbox" name="forceHeal">
          Force heal (bypass cap)
        </label>
        <p class="heal-preview">${previewText(false)}</p>
      </form>
    `,
    buttons: {
      apply: {
        label: "Apply",
        callback: (html) => {
          const force = html.find('[name="forceHeal"]').is(":checked");
          requestApplyFirstAidHeal(message, target, force);
        },
      },
      cancel: { label: "Cancel" },
    },
    default: "apply",
    render: (html) => {
      html.find('[name="forceHeal"]').on("change", (ev) => {
        html.find(".heal-preview").html(previewText(ev.target.checked));
      });
    },
  }).render(true);
}

async function requestApplyFirstAidHeal(message, target, force) {
  const data = {
    type: "applyFirstAidHeal",
    messageId: message.id,
    sceneId: canvas.scene.id,
    targetId: target.id,
    force,
  };

  if (game.user.isGM) {
    await applyFirstAidHealAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
    ui.notifications.info("Heal request sent to GM.");
  }
}

async function applyFirstAidHealAsGM(data) {
  const { messageId, sceneId, targetId, force } = data;

  const message = game.messages.get(messageId);
  const heal = message?.flags?.redsteel?.firstAidHeal;
  if (!heal) return;

  const tokenDoc = game.scenes.get(sceneId)?.tokens.get(targetId);
  const actor = tokenDoc?.actor;
  if (!actor) return;

  const { amount, currentHp, cap, hasCap, applied } = getFirstAidHealContext(
    actor,
    heal.amount,
    force,
  );

  if (applied <= 0) {
    ui.notifications.warn(
      `${actor.name} is already at or above their combat-start health (${cap}). Use Force heal to bypass the cap.`,
    );
    return;
  }

  await actor.update({
    "system.stats.health.value": currentHp + applied,
  });

  // A successful First Aid also stops all bleeding.
  const bleedNote = (await clearBleedEffects(actor))
    ? " Bleeding stopped."
    : "";

  const capNote = force
    ? " <em>(force heal — cap bypassed)</em>"
    : hasCap && applied < amount
      ? ` <em>(capped at combat-start health ${cap})</em>`
      : "";

  const iconUrl = "icons/magic/life/cross-yellow-green.webp";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
<div style="display:flex; align-items:center; gap:10px;">
  <img src="${iconUrl}" width="36" height="36" style="border-radius:50%;" />
  <div>
    <p style="color:green; font-size:1.2em;">
      <strong>First aid applied</strong>
    </p>
    <strong>${actor.name}</strong> is healed for ${applied} HP${capNote}.${bleedNote}
  </div>
</div>
`,
  });
}
