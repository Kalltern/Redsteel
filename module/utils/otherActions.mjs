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

export async function longRest() {
  const controlled = canvas.tokens.controlled;

  if (!controlled.length) {
    ui.notifications.warn("Select at least one token.");
    return;
  }

  for (const token of controlled) {
    const actor = token.actor;
    if (!actor) continue;

    const system = actor.system;

    const nourishingEffect = actor.effects.find((e) =>
      e.statuses?.has("nourishing_rest"),
    );

    const regenMultiplier = nourishingEffect ? 2 : 1;

    // ─── Stamina ───
    const stamina = system.stats.stamina.value ?? 0;
    const newStamina = Math.max(0, stamina + system.stats.stamina.max);

    // ─── Health ───
    const health = system.stats.health.value ?? 0;
    const healthRegen =
      (10 + system.attributes.end.total * 2) * regenMultiplier;

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
  </div>
</div>
`;

    await ChatMessage.create({
      content: chatMessage,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
  }
}

export async function firstAid() {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;

  new Dialog({
    title: "Medical Action",

    content: `
      <p>Select medical action:</p>
    `,

    buttons: {
      firstAid: {
        label: "First Aid",

        callback: async () => {
          await performFirstAid(actor, token);
        },
      },

      stopBleeding: {
        label: "Stop Bleeding",

        callback: async () => {
          await performStopBleeding(actor, token);
        },
      },
    },

    default: "firstAid",
  }).render(true);
}

async function performFirstAid(actor, token) {
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
      ? "@attributes.int.mod - 1d100"
      : "@skills.firstAid.rating - 1d100";

  const firstAidRoll = new Roll(rollFormula, actor.getRollData());

  await firstAidRoll.evaluate({ async: true });

  const d100 = firstAidRoll.dice[0]?.total;

  const bonus = healbonus ? `${healbonus}` : "";

  let critStatus = "";
  let rollName = "firstAid";
  let healRoll = null;

  if (d100 >= criticalFailureThreshold) {
    critStatus =
      "<strong style='color: red;'>Critical Failure! Injury caused!</strong>";

    healRoll = new Roll(`2d4${bonus}`);
  } else if (firstAidRoll.total <= 0) {
    healRoll = null;
  } else if (d100 <= criticalSuccessThreshold || firstAidRoll.total >= 60) {
    critStatus = "<strong style='color: green;'>Critical Success!</strong>";

    healRoll = new Roll(`(3d6+3${bonus})*2`);
  } else if (firstAidRoll.total >= 25) {
    healRoll = new Roll(`(3d6+3${bonus})*1.5`);
  } else {
    healRoll = new Roll(`3d6+3${bonus}`);
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
  </div>
</div>
    `,

    flags: {
      redsteel: {
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
      },
    },

    rolls: healRoll ? [firstAidRoll, healRoll] : [firstAidRoll],

    type: CONST.CHAT_MESSAGE_STYLES.ROLL,
  });
}
async function performStopBleeding(actor, token) {
  const dex = actor.system.attributes.dex.mod;
  const int = actor.system.attributes.int.mod;

  const bestAttribute = Math.max(dex, int);

  const stopBleedingRoll = new Roll(`30 + ${bestAttribute} - 1d100`);

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
  });
}
