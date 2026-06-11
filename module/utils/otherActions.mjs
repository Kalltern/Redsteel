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

  const isCritFail = d100 >= criticalFailureThreshold;

  if (isCritFail) {
    critStatus =
      "<br><strong style='color: red;'>Critical Failure! Injury caused!</strong>";

    healRoll = new Roll(`2d4${bonus}`);
  } else if (firstAidRoll.total <= 0) {
    healRoll = null;
  } else if (d100 <= criticalSuccessThreshold || firstAidRoll.total >= 60) {
    critStatus = "<br><strong style='color: green;'>Critical Success!</strong>";

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
        ...(healRoll && !isCritFail
          ? { firstAidHeal: { amount: healRoll.total } }
          : {}),
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

  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
      if (data.type !== "applyFirstAidHeal") return;
      if (!game.user.isGM) return;

      await applyFirstAidHealAsGM(data);
    });
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
    <strong>${actor.name}</strong> is healed for ${applied} HP${capNote}.
  </div>
</div>
`,
  });
}
