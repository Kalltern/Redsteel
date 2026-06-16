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
import { RedsteelToken } from "./documents/token.mjs";
import { statusEffectManager } from "./utils/statusEffectManager.mjs";
import {
  registerCustomConditions,
  resolveEffectDefinition,
} from "./utils/customConditions.mjs";
import { wireAttributeFollowups } from "./utils/attributeFollowup.mjs";
import { registerRollModifier } from "./utils/rollModifier.mjs";
import { applyTraitStatusEffects } from "./utils/traitStatusEffects.mjs";
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
  registerFirstAidHealing,
  advanceCombatFirstAid,
} from "./utils/otherActions.mjs";
import {
  handleApplyDamage,
  handleApplyEffects,
  applyDamageAsGM,
  applyEffectsAsGM,
  applyZeroHealthState,
  getDurabilityItems,
  getDurabilityReductionPerPoint,
  SOCKET,
} from "./utils/applyDamage.mjs";

import {
  openMentalDuel,
  applyMentalDuelLossAsGM,
  handleRemoteMentalDuel,
  closeMentalDuel,
  requestVoluntaryMentalDuel,
  handleVoluntaryMentalDuel,
  handleMentalDuelRps,
  resumeMentalDuel,
} from "./utils/mentalDuel.mjs";
import { getSpellPower } from "./utils/spellPower.mjs";
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
  getValidSpellVariants,
  showVariantSelectionDialog,
  deductMana,
  calculateAttackBonuses,
  getCastChance,
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

/**
 * Item directory whose search also matches the localized item names that
 * localizeItemDirectoryNames() displays, not just the original document names.
 */
class RedsteelItemDirectory extends foundry.applications.sidebar.tabs.ItemDirectory {
  _matchSearchEntries(query, entryIds, folderIds, autoExpandIds, options) {
    super._matchSearchEntries(query, entryIds, folderIds, autoExpandIds, options);
    const cleanQuery = foundry.applications.ux.SearchFilter.cleanQuery;
    for (const item of this.collection) {
      if (entryIds.has(item.id)) continue;
      if (item.localizedName === item.name) continue;
      if (!query.test(cleanQuery(item.localizedName))) continue;
      entryIds.add(item.id);
      for (let folder = item.folder; folder; folder = folder.folder) {
        folderIds.add(folder.id);
        autoExpandIds.add(folder.id);
      }
    }
  }
}

function localizeItemDirectoryNames(element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;

  const entries = root.querySelectorAll(
    "[data-document-id], [data-entry-id], [data-item-id]",
  );
  for (const entry of entries) {
    const id =
      entry.dataset.documentId ?? entry.dataset.entryId ?? entry.dataset.itemId;
    const item = game.items?.get(id);
    if (!item || item.localizedName === item.name) continue;

    entry.title = entry.title?.replace(item.name, item.localizedName) ?? "";
    const walker = document.createTreeWalker(entry, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeValue.trim() === item.name) {
        node.nodeValue = node.nodeValue.replace(item.name, item.localizedName);
      }
    }
  }
}

async function switchWeaponSet(actor) {
  if (!actor || actor.type !== "character") return null;

  const current = actor.system.combat?.activeWeaponSet ?? 1;
  const next = current === 1 ? 2 : 1;
  const weaponSets = buildWeaponSetView(actor);
  const nextSet = weaponSets[next] ?? {};

  const renderWeaponPreview = (label, item) => {
    const name = item?.localizedName ?? item?.name ?? "Empty";
    const image = item?.img
      ? `<img src="${item.img}" width="32" height="32" style="vertical-align:middle; margin-left:6px;">`
      : "";

    return `<div><strong>${label}:</strong> ${name} ${image}</div>`;
  };

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: ChatMessage.getWhisperRecipients("GM"),
    content: `
      <div class="redsteel-weapon-switch">
        <strong>${actor.name}</strong> switches to weapon set ${next}.
        <hr>
        Default cost is 1 action, but this can be reduced with certain feats or abilities.
        <hr>
        ${renderWeaponPreview("Main", nextSet.main)}
        ${renderWeaponPreview("Off", nextSet.off)}
      </div>
    `,
  });

  await actor.update({
    "system.combat.activeWeaponSet": next,
  });

  return next;
}

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
  game.redsteel.applyZeroHealthState = applyZeroHealthState;
  game.redsteel.advanceCombatFirstAid = advanceCombatFirstAid;
  game.redsteel.resolveEffectDefinition = resolveEffectDefinition;
  game.redsteel.resolveWeaponContext = resolveWeaponContext;
  game.redsteel.switchWeaponSet = switchWeaponSet;
  game.redsteel.deductAbilityCost = deductAbilityCost;
  game.redsteel.buildWeaponSetView = buildWeaponSetView;
  game.redsteel.evaluateDmgVsArmor = evaluateDmgVsArmor;
  game.redsteel.getSpellPower = getSpellPower;
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
  game.redsteel.getValidSpellVariants = getValidSpellVariants;
  game.redsteel.showVariantSelectionDialog = showVariantSelectionDialog;
  game.redsteel.deductMana = deductMana;
  game.redsteel.calculateAttackBonuses = calculateAttackBonuses;
  game.redsteel.getCastChance = getCastChance;
  game.redsteel.performAttackRoll = performAttackRoll;
  game.redsteel.finalizeRollsAndPostChat = finalizeRollsAndPostChat;
  game.redsteel.defenseRoll = defenseRoll;
  game.redsteel.openMentalDuel = openMentalDuel;
  game.redsteel.handleRemoteMentalDuel = handleRemoteMentalDuel;
  game.redsteel.closeMentalDuel = closeMentalDuel;
  game.redsteel.requestVoluntaryMentalDuel = requestVoluntaryMentalDuel;
  game.redsteel.resumeMentalDuel = resumeMentalDuel;
  game.redsteel.autoAttack = autoAttack;
  game.redsteel.resolveChannelingTick = resolveChannelingTick;
  game.redsteel.getDurabilityItems = getDurabilityItems;
  game.redsteel.getDurabilityReductionPerPoint = getDurabilityReductionPerPoint;
  registerDynamicInitiative();
  registerRollModifier();
  registerEffectSheetExtensions();
  registerKeepDialogOpen();
  registerCustomConditions();
  registerFirstAidHealing();
  registerMentalDuelSetting();

  /**
   * Set an initiative formula for the system
   * @type {String}
   */

  // Define custom Document classes
  CONFIG.Actor.documentClass = RedsteelActor;
  CONFIG.Token.objectClass = RedsteelToken;
  CONFIG.Item.documentClass = RedsteelItem;
  CONFIG.Combat.documentClass = RedsteelCombat;
  CONFIG.ActiveEffect.documentClass = RedsteelActiveEffect;
  CONFIG.ui.items = RedsteelItemDirectory;
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

Hooks.on("renderItemDirectory", (_app, element) => {
  localizeItemDirectoryNames(element);
});

Hooks.on("renderApplicationV2", (app, element) => {
  if (app instanceof foundry.applications.sidebar.tabs.ItemDirectory) {
    localizeItemDirectoryNames(element);
  }
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

function registerMentalDuelSetting() {
  // Stores { attackerUuid, defenderUuid } for the in-progress Mental Duel so it
  // can be re-opened after a refresh / accidental close. Cleared on End duel.
  game.settings.register("redsteel", "mentalDuelActive", {
    scope: "world",
    config: false,
    type: Object,
    default: null,
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

// Percentage of value within max, clamped to 0-100 (for resource bar fills)
Handlebars.registerHelper("percentOf", function (value, max) {
  const v = Number(value);
  const m = Number(max);
  if (!m || isNaN(v)) return 0;
  return Math.max(0, Math.min(100, (v / m) * 100));
});

Handlebars.registerHelper("gt", function (a, b) {
  return a > b;
});

Handlebars.registerHelper("skillRankMax", function (skill, fallbackOrOptions) {
  const fallback =
    typeof fallbackOrOptions === "number" ? fallbackOrOptions : 10;

  if (!skill) return fallback;
  if (Number.isFinite(Number(skill.max))) return Number(skill.max);

  const typeCaps = {
    0: 10,
    1: 10,
    2: 5,
    3: 5,
    4: 3,
    5: 5,
    6: 5,
    7: 5,
  };

  return typeCaps[skill.type] ?? fallback;
});

Handlebars.registerHelper("romanRank", function (value) {
  if (!value) return "-";

  const romans = [
    "",
    "I",
    "II",
    "III",
    "IV",
    "V",
    "VI",
    "VII",
    "VIII",
    "IX",
    "X",
  ];

  return romans[value] ?? value;
});

Handlebars.registerHelper("combatSkillRating", function (skill, key) {
  if (!skill) return 0;
  if (key === "combat" || key === "throwing") {
    return Math.max(
      Number(skill.rating) || 0,
      Number(skill.finesseRating) || 0,
    );
  }
  return skill.rating ?? 0;
});

Handlebars.registerHelper("hasVisibleEntries", function (entries) {
  if (!entries) return false;
  return Object.values(entries).some((entry) => entry.visible);
});

// True if any entry has at least one level (value > 0)
Handlebars.registerHelper("hasLeveledEntries", function (entries) {
  if (!entries) return false;
  return Object.values(entries).some((entry) => Number(entry?.value) > 0);
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
Hooks.once("ready", () => {
  RedsteelActiveEffect.registerHooks();
});

Hooks.once("ready", () => {
  // Re-open an in-progress Mental Duel after a reload (silent if none).
  game.redsteel.resumeMentalDuel?.({ notify: false });
});

Hooks.once("ready", () => {
  console.log("REDSTEEL | Socket Listener Registered");

  game.socket.on(SOCKET, async (data) => {
    console.log("REDSTEEL | Socket Data:", data);

    // ------------------------
    // GM AUTHORITY ACTIONS
    // ------------------------

    if (data.type === "applyDamage") {
      if (!game.user.isGM) return;
      await applyDamageAsGM(data);
    }

    if (data.type === "applyEffects") {
      if (!game.user.isGM) return;
      await applyEffectsAsGM(data);
    }

    if (data.type === "mentalDuelApply") {
      if (!game.user.isGM) return;
      await applyMentalDuelLossAsGM(data);
    }

    // Not GM-gated: every client decides for itself whether to show the duel.
    if (data.type === "openMentalDuel") {
      handleRemoteMentalDuel(data);
    }

    // Not GM-gated: the GM ended the duel — every client closes its window.
    if (data.type === "closeMentalDuel") {
      closeMentalDuel();
    }

    // Not GM-gated: only the designated responder (target's owner) prompts.
    if (data.type === "mentalDuelVoluntary") {
      await handleVoluntaryMentalDuel(data);
    }

    // RPS gamble — only the active GM (single authority) mutates the state.
    if (data.type === "mentalDuelRps") {
      await handleMentalDuelRps(data);
    }

    // ------------------------
    // PLAYER-OWNED CHANNELING
    // ------------------------

    if (data.type === "sustainSpell") {
      const actor = game.actors.get(data.actorId);
      if (!actor) return;

      // only owners execute
      if (!actor.isOwner) return;

      // prevent GM duplicate execution
      if (game.user.isGM && actor.hasPlayerOwner) return;

      const effect = actor.effects.get(data.effectId);
      if (!effect) return;

      await resolveChannelingTick(actor, effect);
    }
  });
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

// Ensure a single shared "Mind Bending — Resume Duel" macro exists in the
// Macros directory (not on any hotbar). It's an ultra-niche tool, so it lives
// in the directory for the one player who needs it to drag onto their own bar.
// Runs independently of the hotbar-init flag so it appears on existing worlds.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  const name = "Mind Bending — Resume Duel";
  if (game.macros.getName(name)) return;
  const macro = await Macro.create({
    name,
    type: "script",
    command: `game.redsteel.resumeMentalDuel();`,
    img: "icons/magic/control/hypnosis-mesmerism-eye.webp",
  });
  await macro?.update({ ownership: { default: 2 } }); // shared (observer)
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
      flattenedKeys.some((key) => key === path || key.startsWith(`${path}.`))
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

// Tint spell-cast chat messages by school (styled per school in CSS,
// e.g. .chat-message.spell-msg-water)
Hooks.on("renderChatMessageHTML", (message, html) => {
  const school = message.getFlag("redsteel", "spellSchool");
  if (!school) return;
  html.classList.add(`spell-msg-${school}`);
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
    // Match 1d100 tests as well as advantage/disadvantage variants (2d100kl/kh)
    const hasTestRoll = message.rolls?.some((r) => /\d+d100/i.test(r.formula));

    // Stabilise messages carry their own Re-Roll button (which re-applies the
    // outcome); the generic one can't, so skip it for those.
    if (hasTestRoll && !message.getFlag("redsteel", "stabilise")) {
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
        const d100Result = roll.dice?.[0]?.total ?? roll.total; // Kept d100 result (works with 2d100kl/kh)
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

// Bar brawl integration
Hooks.on("preCreateToken", function (document, data) {
  const actor = document.actor;
  if (!actor) return;
  document.updateSource({
    "flags.barbrawl.resourceBars": {
      bar1: {
        order: 0,
        id: "bar1",
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
      bar2: {
        order: 1,
        id: "bar2",
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
      bar3: {
        order: 2,
        id: "bar3",
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
      bar4: {
        order: 3,
        id: "bar4",
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
        bar5: {
          order: 4,
          id: "bar5",
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

  // Blood Pool bar, only for blood mages (at least one level in the school)
  if (actor.system.schools?.blood?.value > 0) {
    document.updateSource({
      "flags.barbrawl.resourceBars": {
        bar6: {
          order: 5,
          id: "bar6",
          attribute: "stats.bloodPool",
          mincolor: "#2e0508",
          maxcolor: "#9e1b35",
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

/* -------------------------------------------- */
/*  Dying / Downed chat-button handlers         */
/* -------------------------------------------- */

function _resolveButtonActor(message) {
  const uuid = message.getFlag("redsteel", "actorUuid");
  return uuid ? fromUuidSync(uuid) : null;
}

function _disableChatButton(button) {
  button.disabled = true;
  button.dataset.disabled = "true";
}

async function _addInsanity(actor, amount = 1) {
  const current = Number(actor.system.stats.insanity?.value ?? 0);
  const max = Number(actor.system.stats.insanity?.max ?? Infinity);
  await actor.update({
    "system.stats.insanity.value": Math.min(current + amount, max),
  });
}

// Downed self-control test: standard attribute test (mod% − 1d100 ≥ 0).
async function _rollDownedTest(actor, attr) {
  const label = attr === "wil" ? "Will" : "Endurance";
  const mod = Number(actor.system.attributes?.[attr]?.mod ?? 0);
  const roll = await new Roll(`${mod} - 1d100`).evaluate();
  return { roll, label, success: roll.total >= 0 };
}

async function _postDownedResult(actor, attr, { roll, label, success }) {
  // On failure the character is knocked unconscious.
  if (!success) {
    await game.redsteel.applyEffect(actor, "incapacitated");
  }

  const outcome = success
    ? `<p><b>${label} Test — Success.</b></p>
       <p>${actor.name} may move only <b>1 hex</b> and has only <b>1 action</b>
       per turn. They cannot stand up, defend themselves, nor attack. If they
       move, they must move away from enemies (this does not provoke an Attack
       of Opportunity).</p>`
    : `<p><b>${label} Test — Failure.</b></p>
       <p>${actor.name} falls <b>unconscious</b> and cannot act.</p>`;

  const rollHTML = await roll.render();

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="redsteel-downed">
        ${outcome}
        ${rollHTML}
        <div class="redsteel-action-buttons">
          <button type="button" data-action="downedReroll" data-attr="${attr}">Reroll (+1 Insanity)</button>
        </div>
      </div>`,
    rolls: [roll],
    flags: { redsteel: { type: "downedResult", actorUuid: actor.uuid, attr } },
  });
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  const wire = (action, handler) => {
    html.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
      button.addEventListener("click", async (event) => {
        const target = event.currentTarget;
        const actor = _resolveButtonActor(message);
        if (!actor) return;
        if (!actor.isOwner) {
          ui.notifications.warn("You don't control this character.");
          return;
        }
        _disableChatButton(target);
        await handler(actor, target);
      });
    });
  };

  // Downed → choose Endurance or Will test.
  wire("downedTest", async (actor, target) => {
    const attr = target.dataset.attr ?? "end";
    await _postDownedResult(actor, attr, await _rollDownedTest(actor, attr));
  });

  // Downed → reroll the same test, taking 1 Insanity point.
  wire("downedReroll", async (actor, target) => {
    const attr = target.dataset.attr ?? "end";
    await _addInsanity(actor, 1);
    await _postDownedResult(actor, attr, await _rollDownedTest(actor, attr));
  });

  // Dying ended → resolve test or gain an Insanity point. Penalised by
  // −10 per (grave) wound.
  wire("dyingResolveTest", async (actor) => {
    const res = Number(actor.system.secondaryAttributes?.res?.total ?? 0);
    const wounds = Number(actor.system.stats.graveWounds?.value ?? 0);
    const penalty = 10 * wounds;
    const roll = await new Roll(`${res * 10} - ${penalty} - 1d100`).evaluate();
    const success = roll.total >= 0;

    // Critical failure (same convention as Fear/Burning resolve tests): a
    // margin of −60 or worse, or a natural d100 of 96+. It costs 2 Insanity.
    const d100 = roll.dice.find((d) => d.faces === 100)?.total ?? 0;
    const critFailure = !success && (roll.total <= -60 || d100 >= 96);

    let outcome;
    if (success) {
      outcome = `<p><b>Resolve Test — Success.</b> ${actor.name} holds on to their sanity; no Insanity gained.</p>`;
    } else if (critFailure) {
      await _addInsanity(actor, 2);
      outcome = `<p><b>Resolve Test — Critical Failure!</b> ${actor.name} gains <b>2 Insanity points</b>.</p>`;
    } else {
      await _addInsanity(actor, 1);
      outcome = `<p><b>Resolve Test — Failure.</b> ${actor.name} gains <b>1 Insanity point</b>.</p>`;
    }

    const rollHTML = await roll.render();

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
        <div class="redsteel-dying">
          ${outcome}
          ${rollHTML}
          <p style="font-size:11px;opacity:.75;">Resolve ${res} ×10 − ${penalty} penalty (10 × ${wounds} wound${wounds === 1 ? "" : "s"})</p>
        </div>`,
      rolls: [roll],
      flags: { redsteel: { type: "dyingResolveResult", actorUuid: actor.uuid } },
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

Hooks.once("ready", async () => {
  console.log("Redsteel | Migrating crit table flags");

  for (const table of game.tables) {
    const oldValue = table.flags?.tos?.critTable;

    if (!oldValue) continue;

    // Create new flag if missing
    if (!table.flags?.redsteel?.critTable) {
      await table.setFlag("redsteel", "critTable", oldValue);
    }

    // Remove old namespace
    await table.update({
      flags: {
        tos: new foundry.data.operators.ForcedDeletion(),
      },
    });

    console.log(`Migrated ${table.name}: ${oldValue}`);
  }

  console.log("Redsteel | Migration complete");
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  const pills = message.getFlag("redsteel", "traitPills");
  if (!pills?.length) return;

  const container = document.createElement("div");
  container.classList.add("trait-pills");

  for (const pill of pills) {
    const span = document.createElement("span");
    span.classList.add("trait-pill");
    span.dataset.tooltip = pill.description;
    span.textContent = pill.name;
    container.appendChild(span);
  }

  // Place pills right after the name/icon header in the flavor — the same
  // spot the magic action-tags occupy. Fall back to the roll card.
  const flavor = html.querySelector(".flavor-text");
  if (flavor) {
    const header = flavor.firstElementChild;
    if (header) header.after(container);
    else flavor.prepend(container);
    return;
  }

  const rollCard = html.querySelector(".dice-roll");
  if (rollCard) rollCard.prepend(container);
});

// Make "Margin of Success" lines clickable → follow-up attribute test
Hooks.on("renderChatMessageHTML", (message, html) => {
  wireAttributeFollowups(html);
});

// On token deploy, apply status effects granted by the actor's trait features.
// Only the creating user runs this, to avoid duplicate application.
Hooks.on("createToken", async (tokenDoc, options, userId) => {
  if (game.user.id !== userId) return;
  await applyTraitStatusEffects(tokenDoc);
});
