// Import document classes.
import { RedsteelActor } from "./documents/actor.mjs";
import { RedsteelItem } from "./documents/item.mjs";
import { RedsteelCombat } from "./documents/combat.mjs";
import { RedsteelActiveEffect } from "./documents/effects.mjs";
import { HelpOverlay } from "./documents/helpOverlay.mjs";
// Import sheet classes.
import { RedsteelActorSheet } from "./sheets/actor-sheet.mjs";
import { RedsteelItemSheet } from "./sheets/item-sheet.mjs";
import { registerEffectSheetExtensions } from "./sheets/effect-sheet.mjs";
// Import helper/utility classes and constants.

import { REDSTEEL } from "./helpers/config.mjs";
import { statusEffectManager } from "./utils/statusEffectManager.mjs";
import { usePotion } from "./utils/usePotion.mjs";
import { defenseRoll } from "./utils/defense.mjs";
import { throwExplosive } from "./utils/throwExplosive.mjs";
import { castSpell } from "./utils/castSpell.mjs";
import { spellDefense } from "./utils/spellDefense.mjs";
import {
  combatAbilities,
  deductAbilityCost,
} from "./utils/combatAbilities.mjs";
import {
  resolveWeaponContext,
  buildWeaponSetView,
} from "./utils/weaponResolver.mjs";
import { attackActions, autoAttack } from "./utils/attackActions.mjs";
import {
  universalAttackLogic,
  rangedAttack,
  throwingAttack,
  meleeAttack,
} from "./utils/basicAttack.mjs";
import {
  delayTurn,
  restAndRecover,
  longRest,
  firstAid,
} from "./utils/otherActions.mjs";

import {
  getNonWeaponAbility,
  getDoctrineBonuses,
  getWeaponSkillBonuses,
  getAttackRolls,
  getDamageRolls,
  getEffectRolls,
  getCriticalRolls,
  evaluateDmgVsArmor,
  getActorCombatModifiers,
} from "./utils/combatSkillBonuses.mjs";
import {
  showSpellSelectionDialogs,
  deductMana,
  calculateAttackBonuses,
  performAttackRoll,
  finalizeRollsAndPostChat,
  resolveChannelingTick,
} from "./utils/magicSkillBonuses.mjs";

/* -------------------------------------------- */
/*  Init Hook                                   */
/* -------------------------------------------- */

// Add key classes to the global scope so they can be more easily used
// by downstream developers
globalThis.redsteel = {
  documents: {
    RedsteelActor,
    RedsteelItem,
    RedsteelCombat,
    RedsteelActiveEffect,
  },
  applications: {
    RedsteelActorSheet,
    RedsteelItemSheet,
  },
  utils: {
    rollItemMacro,
  },
};

Hooks.once("init", function () {
  // Add custom constants for configuration.
  CONFIG.REDSTEEL = REDSTEEL;

  game.redsteel = game.redsteel || {};
  game.redsteel.helpOverlay = HelpOverlay;
  game.redsteel.selectToken = selectToken;
  game.redsteel.statusEffectManager = statusEffectManager;
  game.redsteel.getActorCombatModifiers = getActorCombatModifiers;
  game.redsteel.applyEffect =
    RedsteelActiveEffect.applyEffect.bind(RedsteelActiveEffect);
  game.redsteel.resolveWeaponContext = resolveWeaponContext;
  game.redsteel.deductAbilityCost = deductAbilityCost;
  game.redsteel.buildWeaponSetView = buildWeaponSetView;
  game.redsteel.evaluateDmgVsArmor = evaluateDmgVsArmor;
  game.redsteel.firstAid = firstAid;
  game.redsteel.combatAbilities = combatAbilities;
  game.redsteel.delayTurn = delayTurn;
  game.redsteel.restAndRecover = restAndRecover;
  game.redsteel.longRest = longRest;
  game.redsteel.spellDefense = spellDefense;
  game.redsteel.attackActions = attackActions;
  game.redsteel.meleeAttack = meleeAttack;
  game.redsteel.universalAttackLogic = universalAttackLogic;
  game.redsteel.rangedAttack = rangedAttack;
  game.redsteel.throwingAttack = throwingAttack;
  game.redsteel.castSpell = castSpell;
  game.redsteel.throwExplosive = throwExplosive;
  game.redsteel.usePotion = usePotion;
  game.redsteel.getNonWeaponAbility = getNonWeaponAbility;
  game.redsteel.getDoctrineBonuses = getDoctrineBonuses;
  game.redsteel.getWeaponSkillBonuses = getWeaponSkillBonuses;
  game.redsteel.getAttackRolls = getAttackRolls;
  game.redsteel.getDamageRolls = getDamageRolls;
  game.redsteel.getEffectRolls = getEffectRolls;
  game.redsteel.getCriticalRolls = getCriticalRolls;
  game.redsteel.showSpellSelectionDialogs = showSpellSelectionDialogs;
  game.redsteel.deductMana = deductMana;
  game.redsteel.calculateAttackBonuses = calculateAttackBonuses;
  game.redsteel.performAttackRoll = performAttackRoll;
  game.redsteel.finalizeRollsAndPostChat = finalizeRollsAndPostChat;
  game.redsteel.defenseRoll = defenseRoll;
  game.redsteel.autoAttack = autoAttack;
  game.redsteel.resolveChannelingTick = resolveChannelingTick;
  registerDynamicInitiative();
  registerEffectSheetExtensions();
  registerKeepDialogOpen();

  /**
   * Set an initiative formula for the system
   * @type {String}
   */

  // Define custom Document classes
  CONFIG.Actor.documentClass = RedsteelActor;
  CONFIG.Item.documentClass = RedsteelItem;
  CONFIG.Combat.documentClass = RedsteelCombat;
  CONFIG.ActiveEffect.documentClass = RedsteelActiveEffect;
  CONFIG.statusEffects = REDSTEEL.statusEffects;
  // Active Effects are never copied to the Actor,
  // but will still apply to the Actor from within the Item
  // if the transfer property on the Active Effect is true.
  CONFIG.ActiveEffect.legacyTransferral = false;

  // Register sheet application classes
  foundry.documents.collections.Actors.unregisterSheet(
    "core",
    foundry.appv1.sheets.ActorSheet,
  );
  foundry.documents.collections.Actors.registerSheet(
    "redsteel",
    RedsteelActorSheet,
    {
      makeDefault: true,
      label: "REDSTEEL.SheetLabels.Actor",
    },
  );
  foundry.documents.collections.Items.unregisterSheet(
    "core",
    foundry.appv1.sheets.ItemSheet,
  );
  foundry.documents.collections.Items.registerSheet(
    "redsteel",
    RedsteelItemSheet,
    {
      makeDefault: true,
      label: "REDSTEEL.SheetLabels.Item",
    },
  );

  game.keybindings.register("redsteel-system", "helpScreen", {
    name: "Show Help Screen",
    editable: [{ key: "KeyH" }],
    onDown: () => {
      game.redsteel.helpOverlay.toggle();
      return true;
    },
  });
});

/* -------------------------------------------- */
/*  Redsteel Specific Game settings                  */
/* -------------------------------------------- */

function registerDynamicInitiative() {
  game.settings.register("redsteel", "registerDynamicInitiative", {
    config: true,
    scope: "world",
    name: "REDSTEEL.Config.Initiative.name",
    hint: "REDSTEEL.Config.Initiative.label",
    type: Boolean,
    default: true,
  });
}

function registerKeepDialogOpen() {
  game.settings.register("redsteel", "keepAbilityDialogOpen", {
    name: "Keep Ability Dialog Open",
    scope: "client", // per user
    config: false,
    type: Boolean,
    default: false,
  });
}
/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

// If you need to add Handlebars helpers, here is a useful example:
Handlebars.registerHelper("toLowerCase", function (str) {
  return str.toLowerCase();
});

Handlebars.registerHelper("or", function () {
  return Array.from(arguments).slice(0, -1).some(Boolean);
});

Handlebars.registerHelper("eq", function (a, b) {
  return a === b;
});

Handlebars.registerHelper("hasVisibleSkillsOfId", function (skills, id) {
  if (!skills) return false;

  const targetId = Number(id);

  return Object.values(skills).some(
    (skill) => skill.id === targetId && skill.visible,
  );
});

Handlebars.registerHelper(
  "filterSkillsByAbility",
  function (skills, abilityId) {
    return Object.entries(skills).filter(
      ([key, skill]) => skill.id === abilityId,
    );
  },
);
Handlebars.registerHelper("range", function (start, end) {
  var range = [];
  for (var i = start; i <= end; i++) {
    range.push(i);
  }
  return range;
});

Handlebars.registerHelper("gt", function (a, b) {
  return a > b;
});

Handlebars.registerHelper("hasValue", function (value) {
  return value !== null && value !== undefined && value !== "";
});
Handlebars.registerHelper("array-lookup", function (array, index) {
  return array && array[index] !== undefined ? array[index] : false;
});
Handlebars.registerHelper("math", function (left, operator, right) {
  left = parseFloat(left);
  right = parseFloat(right);
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right !== 0 ? left / right : 0;
    case "%":
      return left % right;
    default:
      return 0;
  }
});
Handlebars.registerHelper("groupSpellsBySchool", function (spells) {
  const grouped = {};

  for (const spell of spells) {
    // Only include spells where system.option is "magic" but it does not work
    if (spell.system.option === "magic") {
      const school = spell.system?.type;

      // Ensure school is defined and not empty
      if (school) {
        if (!grouped[school]) {
          grouped[school] = [];
        }

        grouped[school].push(spell);
      }
    }
  }

  console.log("Final grouped spells:", grouped);

  // Return grouped spells as an array of objects with school and spells
  return Object.entries(grouped).map(([school, spells]) => ({
    school,
    spells,
  }));
});

Handlebars.registerHelper("groupBySchool", function (spells, options) {
  const schools = {};

  // Group spells by school type
  spells.forEach((spell) => {
    const school = spell.system.type; // Assuming `type` is the school field
    if (!schools[school]) {
      schools[school] = [];
    }
    schools[school].push(spell);
  });

  // Convert into an array to loop over in Handlebars
  return Object.entries(schools).map(([school, spells]) => ({
    school,
    spells,
  }));
});

Handlebars.registerHelper("groupByRank", function (spells, options) {
  if (!Array.isArray(spells)) spells = []; // safeguard
  const ranks = ["wild", "apprentice", "expert", "master", "grandmaster"];
  // Map each rank to an object containing the spells of that rank
  return ranks.map((rank) => ({
    rank,
    spells: spells.filter((s) => s.system?.rank === rank),
  }));
});

Handlebars.registerHelper("healthPercentage", function (current, max) {
  if (max === 0) return 0; // Avoid division by zero
  return (current / max) * 100;
});

/* -------------------------------------------- */
/*  Ready Hook                                  */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  ui.controls.render({
    controls: ui.controls.controls,
    tool: ui.controls.tool.name,
  });
  RedsteelActiveEffect.registerStatusCounterIntegration();
});

Hooks.once("ready", function () {
  // Wait to register hotbar drop hook on ready so that modules could register earlier if they want to
  Hooks.on("hotbarDrop", (bar, data, slot) => createDocMacro(data, slot));
});
const SOCKET = "system.redsteel";

Hooks.once("ready", () => {
  console.log("REDSTEEL | Socket Listener Registered");

  game.socket.on(SOCKET, async (data) => {
    console.log("REDSTEEL | GM Received Socket Data:", data);
    if (!game.user.isGM) return;

    if (data.type === "applyDamage") {
      await applyDamageAsGM(data);
    }

    if (data.type === "applyEffects") {
      await applyEffectsAsGM(data);
    }
  });
});

Hooks.once("ready", () => {
  RedsteelActiveEffect.registerHooks();
});

Hooks.once("ready", async () => {
  // Prevent re-adding macros every load
  if (game.user.getFlag("redsteel", "hotbarInitialized")) return;

  // Define preset macros
  const macroData = [
    {
      name: "Attack actions",
      command: `game.redsteel.attackActions();`,
      img: "icons/skills/melee/hand-grip-sword-white-brown.webp",
      slot: 1,
      shared: true,
    },
    {
      name: "Defense actions",
      command: `game.redsteel.defenseRoll();`,
      img: "icons/equipment/shield/shield-round-boss-wood-brown.webp",
      slot: 2,
      shared: true,
    },
    {
      name: "Combat abilities",
      command: `game.redsteel.combatAbilities();`,
      img: "icons/skills/melee/weapons-crossed-swords-yellow.webp",
      slot: 3,
      shared: true,
    },
    {
      name: "Channeling",
      command: `game.redsteel.castSpell();`,
      img: "icons/magic/lightning/orb-ball-spiral-blue.webp",
      slot: 4,
      shared: true,
    },
    {
      name: "First aid",
      command: `game.redsteel.firstAid();`,
      img: "icons/magic/life/cross-yellow-green.webp",
      slot: 8,
      shared: true,
    },
    {
      name: "Potions",
      command: `game.redsteel.usePotion();`,
      img: "icons/consumables/potions/bottle-round-label-cork-red.webp",
      slot: 9,
      shared: true,
    },
    {
      name: "Delay turn",
      command: `game.redsteel.delayTurn();`,
      img: "icons/magic/time/hourglass-brown-orange.webp",
      slot: 10,
      shared: true,
    },
  ];

  // GM-only macro
  if (game.user.isGM) {
    macroData.push({
      name: "Long Rest",
      scope: "global",
      command: `game.redsteel.longRest();`,
      img: "icons/magic/time/day-night-sunset-sunrise.webp",
      slot: 6,
      shared: false,
    });
    macroData.push({
      name: "Effect manager",
      command: `await game.redsteel.statusEffectManager();`,
      img: "icons/sundries/documents/document-sealed-signatures-red.webp",
      slot: 7,
      shared: false,
    });
  }

  for (const data of macroData) {
    let macro = game.macros.getName(data.name);

    if (!macro) {
      macro = await Macro.create({
        name: data.name,
        type: "script",
        command: data.command,
        img: data.img,
      });
    }
    if (game.user.isGM && data.shared) {
      await macro.update({
        ownership: { default: 2 },
      });
    }
    await game.user.assignHotbarMacro(macro, data.slot);
  }

  await game.user.setFlag("redsteel", "hotbarInitialized", true);
});

/* -------------------------------------------- */
/*  Hooks for Dynamic initiative if enabled     */
/* -------------------------------------------- */
Hooks.once("ready", () => {
  game.socket.on("system.redsteel", async (data) => {
    if (!game.user.isGM) return;

    if (data.type === "dynamicInitiativeNextRound") {
      const combat = game.combats.get(data.combatId);
      if (!combat) return;

      // GM advances round
      await combat.nextRound();
    }
  });
});

Hooks.on("ready", () => {
  const SYS_ID = "redsteel";
  const SETTING_KEY = "registerDynamicInitiative";
  const isDynamicInitEnabled = () => game.settings.get(SYS_ID, SETTING_KEY);

  //Next Round Wrapper - Reroll Initiative
  if (
    typeof Combat.prototype.nextRound === "function" &&
    !Combat.prototype.nextRound.hasOwnProperty("_wrapped_by_" + SYS_ID)
  ) {
    const originalNextRound = Combat.prototype.nextRound;
    originalNextRound["_wrapped_by_" + SYS_ID] = true;

    Combat.prototype.nextRound = async function () {
      if (isDynamicInitEnabled()) {
        if (!game.user.isGM) {
          game.socket.emit("system.redsteel", {
            type: "dynamicInitiativeNextRound",
            combatId: this.id,
          });
          return;
        } else {
          const combat = this;

          const combatantUpdates = combat.combatants.map((c) => ({
            _id: c.id,
            flags: { redsteel: { PreviousRoundInitiative: c.initiative } },
          }));

          await Combatant.updateDocuments(combatantUpdates, { parent: combat });
          await combat.resetAll();
          await combat.rollAll();
        }
      }

      return originalNextRound.call(this);
    };
  }

  //Previous Round Wrapper - Restore Initiative
  if (
    typeof Combat.prototype.previousRound === "function" &&
    !Combat.prototype.previousRound.hasOwnProperty("_wrapped_by_" + SYS_ID)
  ) {
    const originalPreviousRound = Combat.prototype.previousRound;
    originalPreviousRound["_wrapped_by_" + SYS_ID] = true;

    Combat.prototype.previousRound = async function () {
      if (isDynamicInitEnabled()) {
        try {
          const combat = this;
          const combatantUpdates = [];

          for (const combatant of combat.combatants) {
            const previousInit = combatant.getFlag(
              SYS_ID,
              "PreviousRoundInitiative",
            );

            if (previousInit !== undefined && previousInit !== null) {
              combatantUpdates.push({
                _id: combatant.id,
                initiative: previousInit,
              });

              await combatant.unsetFlag(SYS_ID, "PreviousRoundInitiative");
            }
          }

          if (combatantUpdates.length > 0) {
            await Combatant.updateDocuments(combatantUpdates, {
              parent: combat,
            });
          }

          await combat.update({ turn: combat.turns.length - 1 });
        } catch (err) {
          // Translate permission error for players
          if (!game.user.isGM) {
            game.socket.emit("system.redsteel", {
              type: "dynamicInitiativeNextRound",
              combatId: this.id,
            });

            return; // IMPORTANT: stop player from advancing the round
          }

          throw err;
        }
      }

      //Call original function to decrement the round
      return originalPreviousRound.call(this);
    };
  }
});

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} data     The dropped data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */

async function createDocMacro(data, slot) {
  // First, determine if this is a valid owned item.
  if (data.type !== "Item") return;
  if (!data.uuid.includes("Actor.") && !data.uuid.includes("Token.")) {
    return ui.notifications.warn(
      "You can only create macro buttons for owned Items",
    );
  }
  // If it is, retrieve it based on the uuid.
  const item = await Item.fromDropData(data);

  // Create the macro command using the uuid.
  const command = `game.redsteel.rollItemMacro("${data.uuid}");`;
  let macro = game.macros.find(
    (m) => m.name === item.name && m.command === command,
  );
  if (!macro) {
    macro = await Macro.create({
      name: item.name,
      type: "script",
      img: item.img,
      command: command,
      flags: { "redsteel.itemMacro": true },
    });
  }
  game.user.assignHotbarMacro(macro, slot);
  return false;
}

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {string} itemUuid
 */
function rollItemMacro(itemUuid) {
  // Reconstruct the drop data so that we can load the item.
  const dropData = {
    type: "Item",
    uuid: itemUuid,
  };
  // Load the item from the uuid.
  Item.fromDropData(dropData).then((item) => {
    // Determine if the item loaded and if it's an owned item.
    if (!item || !item.parent) {
      const itemName = item?.name ?? itemUuid;
      return ui.notifications.warn(
        `Could not find item ${itemName}. You may need to delete and recreate this macro.`,
      );
    }

    // Trigger the item roll
    item.roll();
  });
}

Hooks.on("createChatMessage", async (message) => {
  try {
    if (!message.isRoll) return;
    if (!game.user.isGM && message.user.id !== game.user.id) return;
    const flavor = message.flavor ?? "";

    // Read existing rollName from flags.redsteel (macro or previous messages)
    const existing = message.getFlag("redsteel", "rollName");

    let shouldSet = !existing;

    // If complex HTML (macro message), just use the macro-provided rollName
    if (/<(div|table|img|hr)/i.test(flavor)) {
      if (existing) {
        console.log("Macro Roll Name:", existing); // Already set by macro
      }
      shouldSet = false;
      // don’t try to infer
    }

    // If no existing rollName, infer from flavor or first roll formula
    if (shouldSet) {
      let rollName = "Roll";

      if (flavor.trim()) {
        rollName = flavor.replace(/<[^>]*>/g, "").trim();
      } else if (message.rolls?.length) {
        rollName = message.rolls[0].formula;
      }

      await message.setFlag("redsteel", "rollName", rollName);
    }

    // Determine rollName to use (macro flag or inferred)
    const rollNameToUse =
      existing || (await message.getFlag("redsteel", "rollName"));
    console.log("Roll Name:", rollNameToUse);
  } catch (err) {
    console.error("redsteel rollName hook error", err);
  }
});
async function handleApplyDamage(messageId) {
  const message = game.messages.get(messageId);
  if (!message?.flags?.attack) return;

  const checkTargetsAndContinue = () => {
    const targets = Array.from(game.user.targets);
    if (!targets.length) {
      ui.notifications.warn("Please select at least one target.");
      return false;
    }
    continueApplyDamage(message, targets);
    return true;
  };
  function continueApplyDamage(message, targets) {
    openDamageSelectionDialog(message, targets);
  }

  // Initial check
  if (!Array.from(game.user.targets).length) {
    new Dialog({
      title: "No Targets Selected",
      content: "<p>Please select one or more targets, then press OK.</p>",
      buttons: {
        ok: {
          label: "OK",
          callback: checkTargetsAndContinue,
        },
      },
      default: "ok",
    }).render(true);
    return;
  }

  // Targets already selected
  checkTargetsAndContinue();
}
async function applyDamageToTargets(message, targets, mode, selectedEffects) {
  const data = {
    type: "applyDamage",
    messageId: message.id,
    mode: mode,
    sceneId: canvas.scene.id,
    targetIds: targets.map((t) => t.id),
    selectedEffects: selectedEffects,
  };

  if (game.user.isGM) {
    await applyDamageAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
  }
}
async function applyDamageAsGM(data) {
  const { messageId, mode, targetIds, sceneId, selectedEffects } = data;
  const message = game.messages.get(messageId);

  const attack = message.flags.attack;

  const scene = game.scenes.get(sceneId);
  const combat = game.combat;
  for (const tokenId of targetIds) {
    const tokenDoc = scene.tokens.get(tokenId);
    if (!tokenDoc) {
      console.warn(`GM: Token ${tokenId} not found in scene ${sceneId}`);
      continue;
    }

    const actor = tokenDoc.actor;
    if (!actor) continue;

    const currentHp = foundry.utils.getProperty(
      actor,
      "system.stats.health.value",
    );
    const currentTemporaryHp = foundry.utils.getProperty(
      actor,
      "system.stats.temporaryHealth.value",
    );
    const damageProfile = attack.damageProfile ?? { expression: [] };

    const result = evaluateDmgVsArmor({
      damage: attack[mode].damage,
      penetration: attack[mode].penetration ?? 0,
      damageProfile,
      armor: actor.system.armor,
      hp: currentHp,
      tempHp: currentTemporaryHp,
      halfDamage: attack[mode].halfDamage ?? false,
      penCap: attack[mode].penCap ?? false,
    });
    const author = [message.author, message.user, message.userId]
      .map((candidate) =>
        typeof candidate === "string" ? game.users.get(candidate) : candidate,
      )
      .find((user) => user?.name);
    const authorIsGM = author?.isGM;

    if (game.user.isGM && author && !authorIsGM) {
      ui.notifications.info(
        `${author.name} applied ${result.totalHpLoss} damage to ${actor.name}`,
      );
    }
    console.log(
      `GM: Applying ${result.totalHpLoss} damage to ${actor.name}. New HP: ${result.newHp}`,
    );

    await actor.update({
      "system.stats.temporaryHealth.value": Number(result.newTempHp),
      "system.stats.health.value": Number(result.newHp),
    });

    const effects = message.flags.attack.effects || {};
    for (const [name, effect] of Object.entries(effects)) {
      const targetMod = actor.system.effectMods?.[name]?.applyChance || 0;
      const stackMod = actor.system.effectMods?.[name]?.stackMod || 0;

      const allowedEffectsForTarget = selectedEffects?.[tokenId] || [];

      if (!allowedEffectsForTarget.includes(name)) continue;

      let stacks = 1;

      if (name === "bleed") {
        const normal = effect.normalStacks ?? 0;
        const crit = effect.critStacks ?? 0;

        stacks = normal;

        if (mode === "critical") {
          stacks += crit;
        }
      }

      stacks += stackMod;

      if (name === "bleed") {
      }
      await applyEffectToActor(actor, name, stacks);
    }

    const combatant = combat?.combatants.find((c) => c.tokenId === tokenDoc.id);
    await handlePostDamageStatus({ actor, combatant });
  }
}

function openDamageSelectionDialog(message, targets) {
  const attack = message.flags.attack;
  const effects = attack.effects || {};
  let mode = "normal";
  const hasCritical = attack.critical !== "" && attack.critical !== undefined;
  const hasBreakthrough =
    attack.breakthrough?.damage !== "" &&
    attack.breakthrough?.damage !== undefined;

  const renderPreview = () =>
    targets
      .map((t) => {
        const damageProfile = attack.damageProfile ?? { expression: [] };
        console.log("attack[mode]:", attack[mode]);
        const result = evaluateDmgVsArmor({
          damage: attack[mode].damage,
          penetration: attack[mode].penetration ?? 0,
          damageProfile,
          armor: t.actor.system.armor,
          hp: t.actor.system.stats.health.value,
          tempHp: t.actor.system.stats.temporaryHealth.value,
          halfDamage: attack[mode].halfDamage ?? false,
          penCap: attack[mode].penCap ?? false,
        });

        const effectPreview = Object.entries(effects)
          .map(([name, effect]) => {
            const targetMod =
              t.actor.system.effectMods?.[name]?.applyChance || 0;

            const modifiedChance = effect.chance + targetMod;

            let displayChance = modifiedChance;
            let extraInfo = "";

            if (name === "bleed") {
              if (mode === "critical" && effect.critStacks > 0) {
                extraInfo = ` + ${effect.critStacks} crit stack(s)`;
              }
            }

            const success = effect.roll <= modifiedChance;

            return `
      <div style="margin-left:15px;">
        <label>
          <input type="checkbox"
                 name="effect-${t.id}-${name}"
                 ${success ? "checked" : ""}>
          ${name.toUpperCase()} →
          ${effect.roll} < ${displayChance}%${extraInfo}
        </label>
      </div>
    `;
          })
          .join("");

        return `
    <li>
      ${t.name} →
      <strong>${result.finalDamage} HP</strong>
      ${effectPreview}
    </li>
  `;
      })
      .join("");

  new Dialog({
    title: "Apply Damage",
    content: `
      <form>
        <fieldset>
          <legend>Damage Type</legend>
          <label><input type="radio" name="mode" value="normal" checked> Normal</label>
         ${
           hasCritical
             ? ` <label> <input type="radio" name="mode" value="critical"> Critical </label> `
             : ""
         }
          ${
            hasBreakthrough
              ? ` <label> <input type="radio" name="mode" value="breakthrough"> Breakthrough </label> `
              : ""
          }
        </fieldset>

        <ul class="damage-preview">
          ${renderPreview()}
        </ul>
      </form>
    `,
    buttons: {
      apply: {
        label: "Apply",
        callback: (html) => {
          const selectedEffects = {};

          html.find('input[type="checkbox"]').each((_, el) => {
            if (!el.checked) return;

            const parts = el.name.split("-");
            const tokenId = parts[1];
            const effectName = parts[2];

            if (!selectedEffects[tokenId]) {
              selectedEffects[tokenId] = [];
            }

            selectedEffects[tokenId].push(effectName);
          });

          applyDamageToTargets(message, targets, mode, selectedEffects);
        },
      },
      cancel: { label: "Cancel" },
    },
    render: (html) => {
      html.find('input[name="mode"]').on("change", (ev) => {
        mode = ev.target.value;
        html.find(".damage-preview").html(renderPreview());
      });
    },
  }).render(true);
}

async function handlePostDamageStatus({ actor, combatant }) {
  console.log("Actor", actor);
  console.log("combatant", combatant);
  const hp = actor.system.stats.health.value;
  if (hp > 0) return;

  // Characters fall prone
  if (actor.type === "character") {
    if (!actor.statuses.has("prone")) {
      await actor.toggleStatusEffect("prone", { active: true });
    }
    return;
  }

  // NPCs die
  if (!actor.statuses.has("dead")) {
    await actor.toggleStatusEffect("dead", {
      active: true,
      overlay: true,
    });
  }

  // Remove from combat if applicable
  if (combatant) {
    await combatant.parent.deleteEmbeddedDocuments("Combatant", [combatant.id]);
  }
}
async function applyEffectToActor(actor, effectId, stacks = 1) {
  if (!CONFIG.REDSTEEL.effectDefinitions[effectId]) {
    console.warn(
      `Effect ${effectId} not defined in CONFIG.REDSTEEL.effectDefinitions`,
    );
    return;
  }

  return await game.redsteel.applyEffect(actor, effectId, { stacks });
}

const TOKEN_BAR_RESOURCE_PATHS = [
  "system.stats.health",
  "system.stats.stamina",
  "system.stats.mana",
  "system.stats.temporaryHealth",
  "system.stats.toxicity",
];

function changesTokenBarResource(changes) {
  const flattened = foundry.utils.flattenObject(changes);
  const flattenedKeys = Object.keys(flattened);
  return TOKEN_BAR_RESOURCE_PATHS.some((path) => {
    return (
      foundry.utils.hasProperty(changes, path) ||
      flattenedKeys.some(
        (key) => key === path || key.startsWith(`${path}.`),
      )
    );
  });
}

function refreshActorTokenBars(actor) {
  for (const tokenOrDocument of actor.getActiveTokens(false)) {
    const token = tokenOrDocument.object ?? tokenOrDocument;
    token.renderFlags?.set({ refreshBars: true });
    if (!token.renderFlags) token.drawBars?.();
  }
}

Hooks.on("updateActor", (actor, changes) => {
  if (changesTokenBarResource(changes)) refreshActorTokenBars(actor);
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  // Only apply to your attack messages
  const attackFlag = message.flags?.attack;
  if (!attackFlag?.damageProfile) return;

  const expression = attackFlag.damageProfile.expression || [];
  if (!expression.length) return;

  const formatted = expression
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");

  const footer = document.createElement("div");
  footer.classList.add("redsteel-damage-footer");
  footer.innerHTML = `${formatted}`;

  const content = html.querySelector(".message-content");
  if (content) content.after(footer);
});

Hooks.on("renderChatMessageHTML", (message, html, data) => {
  function updateButtonContainerLayout(container) {
    const buttonCount = container.querySelectorAll("button, a.button").length;

    if (buttonCount <= 1) {
      container.classList.add("single");
    } else {
      container.classList.remove("single");
    }
  }

  // Check if the current user is the one who made the roll
  if (game.user.id === message.author?.id) {
    // Add logic to check if the message is a roll message and create a reroll button
    const hasTestRoll = message.rolls?.some((r) => r.formula.includes("1d100"));

    if (hasTestRoll) {
      const rerollButton = document.createElement("button");
      rerollButton.className = "reroll-button";
      rerollButton.type = "button";
      rerollButton.textContent = "Re-Roll";

      let buttonContainer = html.querySelector(".button-container");
      if (!buttonContainer) {
        buttonContainer = document.createElement("div");
        buttonContainer.className = "button-container";
        html.querySelector(".message-content")?.appendChild(buttonContainer);
      }

      buttonContainer.appendChild(rerollButton);
      updateButtonContainerLayout(buttonContainer);
      rerollButton.addEventListener("click", async (event) => {
        event.preventDefault();
        console.log("Re-roll button clicked");

        const rollFormula = message.rolls[0].formula;
        const roll = new Roll(rollFormula);
        await roll.evaluate();
        const d100Result = roll.dice?.[0]?.results?.[0]?.result ?? roll.total; // Extract the d100 result
        const criticalSuccessThreshold =
          message.flags.redsteel.criticalSuccessThreshold;
        const criticalFailureThreshold =
          message.flags.redsteel.criticalFailureThreshold;
        const critSuccess = d100Result <= criticalSuccessThreshold;
        const rollName = message.getFlag("redsteel", "rollName");

        let flavorText = "";

        if (critSuccess) {
          flavorText = "Critical Success!";
        } else if (d100Result >= criticalFailureThreshold) {
          flavorText = "Critical Failure!";
        } else {
          flavorText = "";
        }

        roll.toMessage({
          speaker: ChatMessage.getSpeaker({ user: game.user }),
          flavor: `<p style="text-align: center; font-size: 20px;"><b><i class="fa-light fa-dice-d20"></i> ${rollName} <i class="fa-light fa-dice-d20"></i><hr></b></p>
          <p style="text-align: center; font-size: 20px;"><b>${flavorText}</b></p>`,
          flags: {
            redsteel: {
              rollName,
              criticalSuccessThreshold, // Store critical success threshold
              criticalFailureThreshold, // Store critical failure threshold
            },
          },
        });
      });
    }

    // Only create Apply Damage if this is an attack message
    if (message.flags?.attack) {
      let buttonContainer = html.querySelector(".button-container");

      if (!buttonContainer) {
        buttonContainer = document.createElement("div");
        buttonContainer.className = "button-container";
        html.querySelector(".message-content")?.appendChild(buttonContainer);
      }

      const applyDamageButton = document.createElement("button");
      applyDamageButton.type = "button";
      applyDamageButton.className = "redsteel-apply-damage";
      applyDamageButton.dataset.messageId = message.id;
      applyDamageButton.textContent = "Apply Damage";

      buttonContainer.appendChild(applyDamageButton);
      updateButtonContainerLayout(buttonContainer);
      applyDamageButton.addEventListener("click", async () => {
        console.log("Apply Damage clicked", message);
        await handleApplyDamage(message.id);
      });
    }
    // --- Apply Effects (ONLY if no attack but has effects) ---
    if (!message.flags?.attack && message.flags?.effects) {
      const effects = message.flags.effects;

      if (Object.keys(effects).length > 0) {
        let buttonContainer = html.querySelector(".button-container");

        if (!buttonContainer) {
          buttonContainer = document.createElement("div");
          buttonContainer.className = "button-container";
          html.querySelector(".message-content")?.appendChild(buttonContainer);
        }

        const applyEffectsButton = document.createElement("button");
        applyEffectsButton.type = "button";
        applyEffectsButton.className = "redsteel-apply-effects";
        applyEffectsButton.dataset.messageId = message.id;
        applyEffectsButton.textContent = "Apply Effects";

        buttonContainer.appendChild(applyEffectsButton);
        updateButtonContainerLayout(buttonContainer);

        applyEffectsButton.addEventListener("click", async () => {
          await handleApplyEffects(message.id);
        });
      }
    }
  }
});
async function handleApplyEffects(messageId) {
  const message = game.messages.get(messageId);
  if (!message?.flags?.effects) return;

  const checkTargetsAndContinue = () => {
    const targets = Array.from(game.user.targets);
    if (!targets.length) {
      ui.notifications.warn("Please select at least one target.");
      return false;
    }
    openEffectSelectionDialog(message, targets);
    return true;
  };

  if (!Array.from(game.user.targets).length) {
    new Dialog({
      title: "No Targets Selected",
      content: "<p>Please select one or more targets, then press OK.</p>",
      buttons: {
        ok: {
          label: "OK",
          callback: checkTargetsAndContinue,
        },
      },
      default: "ok",
    }).render(true);
    return;
  }

  checkTargetsAndContinue();
}
function openEffectSelectionDialog(message, targets) {
  const effects = message.flags.effects || {};

  const renderPreview = () =>
    targets
      .map((t) => {
        const effectList = Object.entries(effects)
          .map(([name, effect]) => {
            const baseChance = effect?.chance;
            const roll = effect?.roll;

            let previewText = "";

            if (typeof baseChance === "number" && typeof roll === "number") {
              previewText = ` → ${roll} < ${baseChance}%`;
            }

            return `
              <div style="margin-left:15px;">
                <label>
                  <input type="checkbox"
                         name="effect-${t.id}-${name}">
                  ${name.toUpperCase()}${previewText}
                </label>
              </div>
            `;
          })
          .join("");

        return `
          <li>
            <strong>${t.name}</strong>
            ${effectList}
          </li>
        `;
      })
      .join("");

  new Dialog({
    title: "Apply Effects",
    content: `
      <form>
        <ul class="effect-preview">
          ${renderPreview()}
        </ul>
      </form>
    `,
    buttons: {
      apply: {
        label: "Apply",
        callback: (html) => {
          const selectedEffects = {};

          html.find('input[type="checkbox"]').each((_, el) => {
            if (!el.checked) return;

            const parts = el.name.split("-");
            const tokenId = parts[1];
            const effectName = parts[2];

            if (!selectedEffects[tokenId]) {
              selectedEffects[tokenId] = [];
            }

            selectedEffects[tokenId].push(effectName);
          });

          applyEffectsToTargets(message, targets, selectedEffects);
        },
      },
      cancel: { label: "Cancel" },
    },
  }).render(true);
}
async function applyEffectsToTargets(message, targets, selectedEffects) {
  const data = {
    type: "applyEffects",
    messageId: message.id,
    sceneId: canvas.scene.id,
    targetIds: targets.map((t) => t.id),
    selectedEffects: selectedEffects,
  };

  if (game.user.isGM) {
    await applyEffectsAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
    ui.notifications.info("Effect request sent to GM.");
  }
}
async function applyEffectsAsGM(data) {
  const { messageId, targetIds, sceneId, selectedEffects } = data;

  const message = game.messages.get(messageId);
  const effects = message.flags?.effects || {};
  const scene = game.scenes.get(sceneId);

  for (const tokenId of targetIds) {
    const tokenDoc = scene.tokens.get(tokenId);
    if (!tokenDoc) continue;

    const actor = tokenDoc.actor;
    if (!actor) continue;

    const allowedEffects = selectedEffects?.[tokenId] || [];
    for (const effectId of allowedEffects) {
      const effectData = effects[effectId];
      if (!effectData) continue;

      let stacks = 1;

      if (effectId === "bleed") {
        stacks = effectData.stacks ?? 0;
      }

      await applyEffectToActor(actor, effectId, stacks);
    }
  }
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!message.flags?.attack) return;

  html.querySelectorAll(".dice-formula").forEach((el) => {
    let formula = el.textContent;

    // Remove + 0 or - 0
    formula = formula.replace(/([\+\-]\s*0)(?!\d)/g, "");

    // Optional: clean extra whitespace
    formula = formula.replace(/\s{2,}/g, " ").trim();

    // Optional: clean leading +
    formula = formula.replace(/^\+\s*/, "");

    el.textContent = formula;
  });
});
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  console.log("Running effectType normalization migration...");

  const effectMap = {
    Custom: "custom",
    Bleeding: "bleed",
    Blinded: "blind",
    Burning: "burn",
    burning: "burn",
    Chain: "chain",
    Corrosion: "corrosion",
    "Corrosion-severe": "corrosion-severe",
    Dazzled: "dazzled",
    Disorientation: "disorientation",
    Dispell: "dispell",
    Fear: "fear",
    Flammable: "flammable",
    Frozen: "freeze",
    "Heavy stun": "heavy stun",
    Paralyzed: "paralyze",
    Poisoned: "poison",
    Precision: "precision",
    Rooted: "root",
    "Shield strain": "shield strain",
    "Shield break": "shield break",
    Slowed: "slow",
    "Soul mark": "soul mark",
    Stun: "stun",
    Terror: "terror",
    Vulnerable: "vulnerable",
    Weakened: "weak",
    Wet: "wet",
  };

  const items = game.items.filter((i) =>
    ["spell", "ability", "weapon"].includes(i.type),
  );

  for (const item of items) {
    const updates = {};

    for (let i = 1; i <= 3; i++) {
      const key = `effectType${i}`;
      const current = item.system[key];

      if (!current || typeof current !== "string") continue;

      const mapped = effectMap[current];

      if (mapped && mapped !== current) {
        console.log(`Updating ${item.name} ${key}: ${current} → ${mapped}`);
        updates[`system.${key}`] = mapped;
      }
    }

    if (Object.keys(updates).length > 0) {
      await item.update(updates);
    }
  }

  console.log("EffectType normalization complete.");
});
Hooks.once("ready", async () => {
  for (const actor of game.actors) {
    const natural = actor.system.armor?.natural;

    if (typeof natural === "number") {
      console.log(`Migrating armor for ${actor.name}`);

      await actor.update({
        "system.armor.natural": {
          value: natural,
          bonus: 0,
          total: 0,
        },
      });
    }
  }
});

Hooks.once("ready", () => {
  if (!document.getElementById("item-tooltip")) {
    const tooltip = document.createElement("div");
    tooltip.id = "item-tooltip";
    tooltip.classList.add("item-tooltip", "hidden");
    document.body.appendChild(tooltip);
  }
});

Hooks.once("ready", () => {
  // Listen for checkbox changes to update skill visibility
  $(document).on("change", ".toggle-skill-visibility", function () {
    let skillKey = $(this).attr("data-skill");
    let isChecked = $(this).prop("checked");

    console.log(
      `Toggling visibility for skill: ${skillKey}, Checked: ${isChecked}`,
    );

    // Target the specific skill entry
    let skillEntry = $(`.skill-entry[data-skill="${skillKey}"]`); // Ensure uniqueness with section-based targeting

    // Reverse the logic: if checked, hide the skill, else show the skill
    if (isChecked) {
      skillEntry.addClass("hidden-skill");
    } else {
      skillEntry.removeClass("hidden-skill");
    }
  });
});

// Bar brawl integration, first three bars 0-2 are reserved for ingame customisation
Hooks.on("preCreateToken", function (document, data) {
  const actor = document.actor;
  if (!actor) return;
  document.updateSource({
    "flags.barbrawl.resourceBars": {
      bar4: {
        order: 3,
        id: "bar4",
        attribute: "stats.health",
        mincolor: "#3e1e1e",
        maxcolor: "#a80000",
        position: "bottom-outer",
        otherVisibility: 0,
        ownerVisibility: 50,
        gmVisibility: -1,
        hideFull: false,
        hideEmpty: false,
        hideCombat: false,
        hideNoCombat: false,
        hideHud: false,
        indentLeft: null,
        indentRight: null,
        shareHeight: false,
        style: "user",
        label: "",
        invert: false,
        invertDirection: false,
        subdivisions: null,
        subdivisionsOwner: false,
        fgImage: "",
        bgImage: "",
        opacity: null,
      },
      bar5: {
        order: 4,
        id: "bar5",
        attribute: "stats.stamina",
        mincolor: "#a3a3a3",
        maxcolor: "#e6d200",
        position: "bottom-inner",
        otherVisibility: 0,
        ownerVisibility: 50,
        gmVisibility: -1,
        hideFull: true,
        hideEmpty: false,
        hideCombat: false,
        hideNoCombat: false,
        hideHud: false,
        indentLeft: null,
        indentRight: 50,
        shareHeight: true,
        style: "user",
        label: "",
        invert: false,
        invertDirection: false,
        subdivisions: null,
        subdivisionsOwner: false,
        fgImage: "",
        bgImage: "",
        opacity: null,
      },
      bar6: {
        order: 5,
        id: "bar6",
        attribute: "stats.toxicity",
        mincolor: "#83ff7a",
        maxcolor: "#2e9900",
        position: "bottom-inner",
        otherVisibility: 0,
        ownerVisibility: 50,
        gmVisibility: -1,
        hideFull: false,
        hideEmpty: true,
        hideCombat: false,
        hideNoCombat: false,
        hideHud: false,
        indentLeft: 50,
        indentRight: null,
        shareHeight: true,
        style: "user",
        label: "",
        invert: false,
        invertDirection: false,
        subdivisions: null,
        subdivisionsOwner: false,
        fgImage: "",
        bgImage: "",
        opacity: null,
      },
      bar7: {
        order: 6,
        id: "bar7",
        attribute: "stats.temporaryHealth",
        mincolor: "#C8C8C8",
        maxcolor: "#C8C8C8",
        position: "top-inner",
        otherVisibility: 0,
        ownerVisibility: 50,
        gmVisibility: -1,
        hideFull: false,
        hideEmpty: true,
        hideCombat: false,
        hideNoCombat: false,
        hideHud: false,
        indentLeft: 25,
        indentRight: 25,
        shareHeight: true,
        style: "user",
        label: "",
        invert: false,
        invertDirection: false,
        subdivisions: null,
        subdivisionsOwner: false,
        fgImage: "",
        bgImage: "",
        opacity: null,
      },
    },
  });

  if (actor.system.magicPotential) {
    document.updateSource({
      "flags.barbrawl.resourceBars": {
        bar8: {
          order: 7,
          id: "bar8",
          attribute: "stats.mana",
          mincolor: "#001547",
          maxcolor: "#004ddd",
          position: "bottom-outer",
          otherVisibility: 0,
          ownerVisibility: 50,
          gmVisibility: -1,
          hideFull: false,
          hideEmpty: false,
          hideCombat: false,
          hideNoCombat: false,
          hideHud: false,
          indentLeft: null,
          indentRight: null,
          shareHeight: false,
          style: "user",
          label: "",
          invert: false,
          invertDirection: false,
          subdivisions: null,
          subdivisionsOwner: false,
          fgImage: "",
          bgImage: "",
          opacity: null,
        },
      },
    });
  }
});

// seduction to temptation conversion and removal of seduction
Hooks.once("ready", async () => {
  for (let actor of game.actors) {
    const seduction = actor.system.skills?.seduction;
    const temptation = actor.system.skills?.temptation;

    if (seduction && !temptation) {
      await actor.update({
        "system.skills.temptation": seduction,
        "system.skills.-=seduction": null,
      });
    }
  }
});
Hooks.once("ready", async () => {
  for (const actor of game.actors) {
    const seduction = actor.system.skills?.seduction;

    if (seduction) {
      await actor.update({
        "system.skills.temptation": seduction,
        "system.skills.-=seduction": null,
      });
    }
  }
});
Hooks.once("ready", async () => {
  async function migrateItem(item) {
    const updates = {};

    const stunEffect = item.system.effects?.stun;
    const stunOffhand = item.system.offhandProperties?.stun;

    // effects.stun → effects.stagger
    if (stunEffect !== undefined) {
      updates["system.effects.stagger"] = stunEffect;
      updates["system.effects.-=stun"] = null;
    }

    // offhandProperties.stun → offhandProperties.stagger
    if (stunOffhand !== undefined) {
      updates["system.offhandProperties.effects.stagger"] = stunOffhand;
      updates["system.offhandProperties.effects.-=stun"] = null;
    }

    if (Object.keys(updates).length) {
      console.log(`Migrating stun → stagger on item: ${item.name}`);
      await item.update(updates);
    }
  }

  /* Actor items */
  for (const actor of game.actors) {
    for (const item of actor.items) {
      await migrateItem(item);
    }
  }

  /* Independent world items */
  for (const item of game.items) {
    await migrateItem(item);
  }

  console.log("Stun → Stagger migration complete");
});
// Magic crit fails evaluation
Hooks.on("renderChatMessageHTML", (message, html) => {
  html.querySelectorAll(".crit-fail-accept").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) return;

      const msg = game.messages.get(message.id);
      const data = msg.flags.redsteel;

      if (!data || data.type !== "critFailPrompt") return;

      const actor = game.actors.get(data.actorId);
      const spellType = data.spellType;
      const spellRank = data.spellRank;

      // --- EXISTING LOGIC ---
      const table = game.tables.find(
        (t) => t.getFlag("redsteel", "critTable") === spellType,
      );

      if (!table) return;

      const rankModifier = {
        wild: -10,
        apprentice: -2,
        expert: 2,
        master: 4,
        grandmaster: 5,
      };

      const modifier = rankModifier[spellRank] ?? 0;
      const formula = `1d20 + ${modifier}`;
      const roll = await new Roll(formula).evaluate();

      await table.draw({ roll });

      // Disable button after use
      target.dataset.disabled = "true";
      if (target instanceof HTMLButtonElement) {
        target.disabled = true;
      }
      target.innerText = "Resolved";
    });
  });
});

export function selectToken({ warn = true, notifyFallback = false } = {}) {
  let actor = null;
  let token = null;

  const controlled = canvas.tokens.controlled[0];

  if (controlled) {
    actor = controlled.actor;
    token = controlled;
  } else if (game.user.character) {
    actor = game.user.character;
    token = actor.getActiveTokens()[0] ?? null;

    if (notifyFallback) {
      ui.notifications.info("No token selected — using assigned character.");
    }
  }

  if (!actor) {
    if (warn) {
      ui.notifications.warn("Select a token or assign a character.");
    }
    return null;
  }

  return { actor, token };
}
