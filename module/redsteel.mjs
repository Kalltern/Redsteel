// Import document classes.
import { RedsteelActor } from "./documents/actor.mjs";
import { RedsteelItem } from "./documents/item.mjs";
import { RedsteelCombat } from "./documents/combat.mjs";
import { RedsteelCombatant } from "./documents/combatant.mjs";
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
import {
  wireAttributeFollowups,
  renderMarginFollowupLine,
} from "./utils/attributeFollowup.mjs";
import { wireSpeedFollowups } from "./utils/speedTest.mjs";
import { registerDrugHooks } from "./utils/drugs.mjs";
import {
  registerCurrency,
  getRoster,
  getPrices,
  getPrice,
  purseTotal,
  canAfford,
  chargeActor,
  creditActor,
  formatPrice,
} from "./utils/currency.mjs";
import { registerRollModifier } from "./utils/rollModifier.mjs";
import { initTooltips } from "./utils/tooltips.mjs";
import { registerCoreTooltipProviders } from "./utils/tooltipProviders.mjs";
import { registerFormulaDisplay } from "./utils/formulaDisplay.mjs";
import { registerEndTurnButton } from "./utils/endTurnButton.mjs";
import { registerCombatAutoSelect } from "./utils/combatAutoSelect.mjs";
import { registerTempHealthGrant } from "./utils/tempHealthGrant.mjs";
import { registerAdvantageousManeuver } from "./utils/advantageousManeuver.mjs";
import { registerRedsteelHotbar } from "./utils/redsteelHotbar.mjs";
import { applyTraitStatusEffects } from "./utils/traitStatusEffects.mjs";
import { applyActorLight } from "./utils/itemLight.mjs";
import {
  registerAbilityGrants,
  syncGrantedAbilities,
  clearGrantSuppression,
  resyncGrantedAbilities,
} from "./utils/abilityGrants.mjs";
import { registerRaceGrants } from "./utils/raceGrants.mjs";
import {
  registerCalendariaIntegration,
  scheduleRerollRefresh,
  processDueEntries,
  diagnoseCalendaria,
  getPendingCalendariaEntries,
} from "./utils/calendariaIntegration.mjs";
import { usePotion } from "./utils/usePotion.mjs";
import { usePoison, clearWeaponCoating } from "./utils/usePoison.mjs";
import {
  defenseRoll,
  registerDefendButton,
  renderArmorTable,
  renderVersusBlock,
} from "./utils/defense.mjs";
import { registerOverwhelmHooks } from "./utils/overwhelm.mjs";
import { registerAutoDefense } from "./utils/autoDefense.mjs";
import { registerWrathOfBlood, syncWrathOfBlood } from "./utils/wrathOfBlood.mjs";
import {
  registerCommandHooks,
  applyCommandAsGM,
  clearCommandsBy,
} from "./utils/commands.mjs";
import {
  registerRoundDigest,
  openRoundDigest,
} from "./utils/roundDigest.mjs";
import { throwExplosive } from "./utils/throwExplosive.mjs";
import {
  castSpell,
  quickCastSpell,
  applyPostCastEffects,
} from "./utils/castSpell.mjs";
import { ensureSystemMacros } from "./utils/macroFolders.mjs";
import { buildItemHotbarMacro } from "./utils/hotbarMacros.mjs";
import {
  resolveWoundExchangeAsGM,
  resolveBloodGiftAsGM,
  resolveMagicRopeAsGM,
  sendMagicRope,
} from "./utils/spellAutomation.mjs";
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
import { registerCanvasZoom } from "./utils/canvasZoom.mjs";
import { registerDeadTokenAppearance } from "./utils/deadTokens.mjs";
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
  addAimStack,
  removeAimStack,
  consumeAim,
  registerAimOverlay,
  ensureAimMacros,
  showAimButtons,
  refreshAimOverlay,
  getAimStacks,
} from "./utils/aim.mjs";
import {
  handleApplyDamage,
  handleApplyEffects,
  handleApplyHealing,
  applyDamageAsGM,
  applyEffectsAsGM,
  applyHealingAsGM,
  applyZeroHealthState,
  endDyingIfHealed,
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
  handleMentalDuelRound,
  handleMentalDuelPossess,
  handleMentalDuelDrain,
  handlePossessionRender,
  refreshPossessedActorTokens,
  resumeMentalDuel,
} from "./utils/mentalDuel.mjs";
import { getSpellPower } from "./utils/spellPower.mjs";
import {
  getBaneProfile,
  actorMatchesBane,
  clearMarksBy,
  getDisplayBaneVariants,
} from "./utils/baneCombat.mjs";
import { renderDamageLine } from "./utils/damageLine.mjs";
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
  getWeaponSpecBonuses,
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
  spellCastSucceeded,
} from "./utils/magicSkillBonuses.mjs";
import {
  getEligibleRerolls,
  consumeReroll,
  getRerollTokensForSkill,
  pickRerollPool,
} from "./utils/rerolls.mjs";
import {
  openRacePicker,
  openRaceChoicesDialog,
  initializeRaceChoices,
} from "./utils/race.mjs";
import { effectiveCombatRating } from "./utils/testRating.mjs";

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
    calendaria: {
      diagnose: diagnoseCalendaria,
      processDueEntries,
      getPendingEntries: getPendingCalendariaEntries,
    },
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
  game.redsteel.getWeaponSpecBonuses = getWeaponSpecBonuses;
  game.redsteel.applyEffect =
    RedsteelActiveEffect.applyEffect.bind(RedsteelActiveEffect);
  game.redsteel.adjustEffectAmount =
    RedsteelActiveEffect.adjustEffectAmount.bind(RedsteelActiveEffect);
  game.redsteel.applyZeroHealthState = applyZeroHealthState;
  game.redsteel.endDyingIfHealed = endDyingIfHealed;
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
  game.redsteel.quickCastSpell = quickCastSpell;
  game.redsteel.throwExplosive = throwExplosive;
  game.redsteel.usePotion = usePotion;
  game.redsteel.usePoison = usePoison;
  game.redsteel.clearWeaponCoating = clearWeaponCoating;
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
  game.redsteel.addAimStack = addAimStack;
  game.redsteel.removeAimStack = removeAimStack;
  game.redsteel.consumeAim = consumeAim;
  game.redsteel.getBaneProfile = getBaneProfile;
  game.redsteel.actorMatchesBane = actorMatchesBane;
  game.redsteel.clearMarksBy = clearMarksBy;
  // Velení: manual sweep, e.g. when a fight ends without deleting the combat.
  game.redsteel.clearCommands = clearCommandsBy;
  // Hněv krve: manual resync, e.g. after a bleed was edited around the hooks.
  game.redsteel.syncWrathOfBlood = syncWrathOfBlood;
  game.redsteel.showAimButtons = showAimButtons; // debug: force-show buttons
  game.redsteel.refreshAimOverlay = refreshAimOverlay; // debug: redraw arrows
  game.redsteel.getAimStacks = getAimStacks;
  game.redsteel.syncGrantedAbilities = syncGrantedAbilities;
  game.redsteel.clearGrantSuppression = clearGrantSuppression;
  game.redsteel.resyncGrantedAbilities = resyncGrantedAbilities;
  game.redsteel.openRacePicker = openRacePicker;
  game.redsteel.openRaceChoicesDialog = openRaceChoicesDialog;
  game.redsteel.initializeRaceChoices = initializeRaceChoices;
  game.redsteel.convertNpcMovement = convertNpcMovement;
  // Coinage: the roster is the GM's, and these are how anything charges it.
  game.redsteel.currency = {
    roster: getRoster,
    prices: getPrices,
    price: getPrice,
    total: purseTotal,
    afford: canAfford,
    charge: chargeActor,
    credit: creditActor,
    format: formatPrice,
  };
  registerAimOverlay();
  registerDynamicInitiative();
  registerRollModifier();
  registerFormulaDisplay();
  registerEndTurnButton();
  registerCombatAutoSelect();
  registerTempHealthGrant();
  registerAdvantageousManeuver();
  registerDefendButton();
  registerOverwhelmHooks();
  registerAutoDefense();
  registerWrathOfBlood();
  registerCommandHooks();
  registerRoundDigest();
  registerEffectSheetExtensions();
  registerKeepDialogOpen();
  registerCustomConditions();
  registerFirstAidHealing();
  registerMentalDuelSetting();
  registerLongRestRations();
  registerCurrency();
  registerAbilityGrants();
  registerRaceGrants();
  registerCalendariaIntegration();
  registerCanvasZoom();
  registerDeadTokenAppearance();
  registerRedsteelHotbar();

  /**
   * Set an initiative formula for the system
   * @type {String}
   */

  // Define custom Document classes
  CONFIG.Actor.documentClass = RedsteelActor;
  CONFIG.Token.objectClass = RedsteelToken;
  CONFIG.Item.documentClass = RedsteelItem;
  CONFIG.Combat.documentClass = RedsteelCombat;
  // Turn order is the Speed Test — see documents/combatant.mjs for why the
  // formula is pinned on the Combatant as well as in RedsteelCombat.
  CONFIG.Combatant.documentClass = RedsteelCombatant;
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

function registerLongRestRations() {
  // Sticky state for the Long Rest dialog's "eat rations" box. Client-scoped
  // because whoever runs the rest is the one who knows whether the party is
  // camping; a stretch of travel then keeps it ticked without re-checking.
  game.settings.register("redsteel", "longRestEatRations", {
    scope: "client",
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
  return effectiveCombatRating(skill, key);
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
    // Multiplication and division floor their result: the rulebook always
    // rounds SK fractions down, so SK 7 with "/" 2 reads 3, not 3.5. Kept in
    // step with evaluateSpellPowerArgs in utils/spellCards.mjs, the other
    // renderer of the same stored placeholders.
    case "*":
      return Math.floor(left * right);
    case "/":
      return right !== 0 ? Math.floor(left / right) : 0;
    // Division that rounds UP. SK fractions round down everywhere by default,
    // so a rule that says "rounded up" (Skin cracking) has to ask for it.
    case "/up":
      return right !== 0 ? Math.ceil(left / right) : 0;
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
  // Returning false has to happen synchronously — createDocMacro is async, so
  // awaiting it here would let the core hotbar carry on and try to build a
  // Macro out of Item drop data (which throws). We take ownership of Item
  // drops and leave everything else (Macro drops, other systems) alone.
  Hooks.on("hotbarDrop", (bar, data, slot) => {
    if (data?.type !== "Item") return true;
    createDocMacro(data, slot);
    return false;
  });
});
Hooks.once("ready", () => {
  RedsteelActiveEffect.registerHooks();
});

Hooks.once("ready", () => {
  // Records a cure when an addiction effect is removed, so a later relapse
  // rolls at the harder difficulty.
  registerDrugHooks();
});

Hooks.once("ready", () => {
  // Re-open an in-progress Mental Duel after a reload (silent if none).
  game.redsteel.resumeMentalDuel?.({ notify: false });
});

Hooks.once("ready", () => {
  // When a token's actor ownership changes (e.g. a Mind Bending possession
  // grant/release), a client that just gained ownership can be left with the
  // token invisible until the next canvas interaction. Re-control the token to
  // un-stick it (see refreshPossessedActorTokens). Fires on every client; only
  // the one that owns the token acts, so the GM is unaffected.
  Hooks.on("updateActor", (actor, changed) => {
    if (!("ownership" in changed) || !canvas?.ready) return;
    refreshPossessedActorTokens(actor.uuid);
  });
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

    // Velení: a Commander buffing allies they do not own.
    if (data.type === "commandApply") {
      if (!game.user.isGM) return;
      await applyCommandAsGM(data);
    }

    if (data.type === "applyHealing") {
      if (!game.user.isGM) return;
      await applyHealingAsGM(data);
    }

    if (data.type === "mentalDuelApply") {
      if (!game.user.isGM) return;
      await applyMentalDuelLossAsGM(data);
    }

    if (data.type === "bindingStrike") {
      if (!game.user.isGM) return;
      await _resolveBindingStrikeAsGM(data);
    }

    // Scripted spells that touch actors the caster may not own.
    if (data.type === "woundExchange") {
      if (!game.user.isGM) return;
      await resolveWoundExchangeAsGM(data);
    }

    if (data.type === "bloodGift") {
      if (!game.user.isGM) return;
      await resolveBloodGiftAsGM(data);
    }

    if (data.type === "magicRope") {
      if (!game.user.isGM) return;
      await resolveMagicRopeAsGM(data);
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

    // Pending exchange (rerolls) — only the active GM mutates + resolves it.
    if (data.type === "mentalDuelRound") {
      await handleMentalDuelRound(data);
    }

    // Seize control — only the active GM applies the ownership grant + marker.
    if (data.type === "mentalDuelPossess") {
      await handleMentalDuelPossess(data);
    }

    // Drain — only the active GM restores the Mind and ends the duel.
    if (data.type === "mentalDuelDrain") {
      await handleMentalDuelDrain(data);
    }

    // Not GM-gated: every client rebuilds the possessed token's sprite locally.
    if (data.type === "possessionRender") {
      handlePossessionRender(data);
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

/**
 * The system's macros. These are generated in the "Redsteel Macros" folder but
 * are never pinned to a hotbar slot — the bar is the player's to fill, and the
 * Redsteel panel's action row already drives the same `game.redsteel` entry
 * points these call. They exist as the failsafe: when a panel button misbehaves
 * mid-session there is always a plain macro to click, and players can drag the
 * ones they use onto their own bar.
 *
 * `shared` (default true) makes a macro readable by every player. Long Rest and
 * the Effect manager stay GM-only.
 */
const SYSTEM_MACROS = [
  {
    name: "Attack actions",
    command: `game.redsteel.attackActions();`,
    img: "icons/skills/melee/hand-grip-sword-white-brown.webp",
  },
  {
    name: "Defense actions",
    command: `game.redsteel.defenseRoll();`,
    img: "icons/equipment/shield/shield-round-boss-wood-brown.webp",
  },
  {
    name: "Combat abilities",
    command: `game.redsteel.combatAbilities();`,
    img: "icons/skills/melee/weapons-crossed-swords-yellow.webp",
  },
  {
    name: "Channeling",
    command: `game.redsteel.castSpell();`,
    img: "icons/magic/lightning/orb-ball-spiral-blue.webp",
  },
  {
    name: "First aid",
    command: `game.redsteel.firstAid();`,
    img: "icons/magic/life/cross-yellow-green.webp",
  },
  {
    name: "Potions",
    command: `game.redsteel.usePotion();`,
    img: "icons/consumables/potions/bottle-round-label-cork-red.webp",
  },
  // Delay turn is a floating button on the bar rather than an action-row entry,
  // which makes it the one action with no second way in — so it earns a macro
  // here more than most.
  {
    name: "Delay turn",
    command: `game.redsteel.delayTurn();`,
    img: "icons/magic/time/clock-stopwatch-white-blue.webp",
  },
  // Ultra-niche: only the one player mid-duel ever needs it, but losing a duel
  // to a reload with no way back is exactly what a failsafe is for.
  {
    name: "Mind Bending — Resume Duel",
    command: `game.redsteel.resumeMentalDuel();`,
    img: "icons/magic/control/hypnosis-mesmerism-eye.webp",
  },
  {
    name: "Long Rest",
    command: `game.redsteel.longRest();`,
    img: "icons/magic/time/day-night-sunset-sunrise.webp",
    shared: false,
  },
  {
    name: "Effect manager",
    command: `await game.redsteel.statusEffectManager();`,
    img: "icons/sundries/documents/document-sealed-signatures-red.webp",
    shared: false,
  },
];

Hooks.once("ready", () => ensureSystemMacros(SYSTEM_MACROS));

// The three Aim macros are generated the same way, from aim.mjs where they live.
Hooks.once("ready", () => ensureAimMacros());

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

          // Open the round card before the reroll so every initiative roll is
          // collected into it. The round has not advanced yet, hence the +1 —
          // the round-start handler corrects it once it knows the real value.
          openRoundDigest(combat.round + 1);

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
  if (!data.uuid?.includes("Actor.") && !data.uuid?.includes("Token.")) {
    return ui.notifications.warn(
      "You can only create macro buttons for owned Items",
    );
  }
  // If it is, retrieve it based on the uuid.
  const item = await Item.fromDropData(data);
  if (!item) return;

  // Spells get a quick-cast macro instead of the generic item roll, and both
  // land in the actor's own macro folder — see utils/hotbarMacros.mjs, which
  // the sheet's star button shares so either route produces the same macro.
  const macro = await buildItemHotbarMacro(item, data.uuid);
  if (!macro) return false;

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
    if (!game.user.isGM && message.author?.id !== game.user.id) return;
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

/* -------------------------------------------- */
/*  Strike spells — consume on the next attack  */
/* -------------------------------------------- */

/** Resolve the acting actor from a chat message's speaker. */
function _redsteelSpeakerActor(message) {
  const s = message.speaker ?? {};
  if (s.scene && s.token) {
    const tok = game.scenes?.get(s.scene)?.tokens?.get(s.token);
    if (tok?.actor) return tok.actor;
  }
  if (s.token) {
    const tok = canvas.tokens?.get(s.token);
    if (tok?.actor) return tok.actor;
  }
  return s.actor ? game.actors.get(s.actor) : null;
}

/**
 * Binding Strike, resolved on the GM client (the only one that may Root a
 * target the attacker does not own). Runs the caster's baked Will + SK*2 test
 * against each target's better Strength/Endurance test; on the caster's success
 * (ties go to the caster) the target is Rooted. Target token ids + the caster's
 * test value are captured on the attacking client and relayed here.
 */
async function _resolveBindingStrikeAsGM({
  actorUuid,
  targetIds = [],
  sceneId,
  testValue,
}) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  if (!scene) return;
  const caster = actorUuid ? await fromUuid(actorUuid) : null;
  const casterTest = Number(testValue ?? 0);

  for (const tokenId of targetIds) {
    const target = scene.tokens.get(tokenId)?.actor;
    if (!target) continue;

    const isNpc = target.type === "npc";
    const attr = (key) =>
      Number(
        (isNpc
          ? target.system.attributes?.[key]?.value
          : target.system.attributes?.[key]?.mod) ?? 0,
      );
    const targetMod = Math.max(attr("str"), attr("end"));

    const casterRoll = await new Roll(`${casterTest} - 1d100`).evaluate();
    const targetRoll = await new Roll(`${targetMod} - 1d100`).evaluate();
    const casterWins = casterRoll.total >= targetRoll.total;

    if (casterWins) {
      await game.redsteel.applyEffect(target, "root", { caster });
    }

    const casterHTML = await casterRoll.render();
    const targetHTML = await targetRoll.render();

    await ChatMessage.create({
      speaker: caster ? ChatMessage.getSpeaker({ actor: caster }) : undefined,
      flavor: `<b>Binding Strike — ${target.name}</b>`,
      rolls: [casterRoll, targetRoll],
      content: `
        <div class="dual-roll">
          <div class="roll-column">
            <div class="roll-label">Caster — Will + SK×2 (${casterTest}%)</div>
            ${casterHTML}
          </div>
          <div class="roll-column">
            <div class="roll-label">${target.name} — Str/End (${targetMod}%)</div>
            ${targetHTML}
          </div>
        </div>
        <p style="text-align:center; font-size:16px;">
          <b>${casterWins ? `${target.name} is Rooted!` : `${target.name} resists.`}</b>
        </p>`,
    });
  }
}

Hooks.on("createChatMessage", async (message) => {
  try {
    // Only weapon/throw attacks consume a strike — spell attacks carry
    // isSpell, defense/effect cards carry no attack flag at all.
    const atk = message.flags?.attack;
    if (atk?.type !== "attack" || atk.isSpell) return;

    // One client resolves this: the one that authored the attack card. It owns
    // the acting actor (player's own PC, or GM's NPC), so it may delete the
    // strike effect and read the attacker's current targets.
    const authorId = message.author?.id ?? message.user?.id;
    if (authorId !== game.user.id) return;

    const actor = _redsteelSpeakerActor(message);
    if (!actor) return;

    // Krvavý úder (Cordinas IV): the charge is spent by the next attack whether
    // it lands or not, so it goes the moment the card is posted — the packet is
    // built at roll time, so a miss burns it too. Gated on the card actually
    // carrying the bonus rather than on "any attack card": paths that build
    // their own effects without getEffectRolls (a thrown explosive) never got
    // the extra Bleeding, and must not eat the charge. Kept separate from the
    // strike lookup below — an actor can hold both, each spent on its own
    // terms.
    if (Number(atk.effects?.bleed?.bonusStacks) > 0) {
      const bloodStrike = actor.effects.find((e) =>
        e.statuses?.has("blood_strike"),
      );
      if (bloodStrike) await bloodStrike.delete();
    }

    const strike = actor.effects.find((e) =>
      e.getFlag("redsteel", "consumeOnAttack"),
    );
    if (!strike) return;

    const binding = strike.getFlag("redsteel", "strikeBinding");
    // Delete first so the strike is spent even on a miss (or if the test path
    // throws). Read the flag beforehand so its value survives the delete.
    await strike.delete();
    if (!binding) return;

    const targetIds = [...(game.user.targets ?? [])]
      .map((t) => t.id)
      .filter(Boolean);
    if (!targetIds.length) {
      ui.notifications.warn(
        "Binding Strike: target the struck creature to resolve the Rooted test.",
      );
      return;
    }

    const payload = {
      type: "bindingStrike",
      actorUuid: actor.uuid,
      targetIds,
      sceneId: canvas.scene?.id,
      testValue: binding.testValue,
    };
    // Only the GM may Root a target the attacker does not own; relay when the
    // attacking client isn't already the GM.
    if (game.user.isGM) await _resolveBindingStrikeAsGM(payload);
    else game.socket.emit(SOCKET, payload);
  } catch (err) {
    console.error("redsteel strike-consume hook error", err);
  }
});

const TOKEN_BAR_RESOURCE_PATHS = [
  "system.stats.health",
  "system.stats.stamina",
  "system.stats.mana",
  "system.stats.temporaryHealth",
  "system.stats.temporaryHealthMagic",
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

/**
 * Flags that describe the card rather than the roll — who swung, what it was
 * called, what the picker may spend on it. A reroll replaces the dice, not the
 * card, so these are carried over verbatim.
 */
const REROLL_CARRIED_FLAGS = [
  "traitPills",
  "attackTags",
  "rerollTokens",
  "abilityKey",
  "abilityName",
  // Who cast it and from which school: the Apply Effects dialog scales durations
  // off these, and the school also tints the card.
  "casterUuid",
  "spellSchool",
];

/**
 * Rebuild an attack card's stored packet for a rerolled attack roll.
 *
 * Only the attack roll is rerolled: the damage, the crit-range roll and the
 * Bane bonus die all stand. What changes is every number read off the dice that
 * were just thrown away — the contested margin, the crit flags and the raw die
 * — so the new card contests, applies damage and flips its Bane face exactly
 * like the card it replaces.
 *
 * The card itself stays a plain reroll card — margin and dice, nothing else.
 * The damage was never rerolled, so it belongs to the attack card it was rolled
 * on; repeating it here would only invite the table to read it twice.
 *
 * @returns {object|null} the packet for `flags.attack`.
 */
function buildAttackRerollFlag(message, roll, { critSuccess, critFailure }) {
  const source = message.flags?.attack;
  if (!source) return null;

  const d100 = roll.dice.find((d) => d.faces === 100)?.total ?? null;

  const attack = foundry.utils.deepClone(source);
  attack.margin = roll.total;
  attack.criticalSuccess = critSuccess;
  attack.criticalFailure = critFailure;
  attack.d100 = d100;
  // Same blow, new die: the defense that already answered it is rerolled from
  // its own card. Without this an auto-defending NPC would roll a second, fresh
  // defense against one attack (see autoDefense.mjs).
  attack.suppressAutoDefense = true;

  if (attack.aimedStrike) {
    attack.aimedStrike = { ...attack.aimedStrike, su: roll.total };
  }

  // The Bane packet is a second reading of the same dice, so it re-reads the
  // new ones. `critScoreResult` and the base damage stay: those dice were not
  // rerolled.
  if (attack.bane?.dice) {
    attack.bane = {
      ...attack.bane,
      baseCritSuccess: critSuccess,
      dice: {
        ...attack.bane.dice,
        su: roll.total,
        ...(d100 != null ? { die: d100 } : {}),
      },
    };
  }

  // A spell card stores a crit face only when the cast actually crit, so the
  // face has to go when the reroll does not. The other direction cannot be
  // rebuilt — the crit damage was never rolled — and is left to the GM rather
  // than invented here.
  if (attack.isSpell && !critSuccess) delete attack.critical;

  return attack;
}

/**
 * Rebuild a defense card's contested outcome for a rerolled defense roll.
 *
 * The attack being answered has not changed, so it is contested again from the
 * new die — which is also what decides whether the defender may still claim
 * Temporary Health or buy an Advantageous Maneuver off this card.
 *
 * @returns {{flags: object, html: string}}
 */
function buildDefenseRerollParts(
  message,
  roll,
  { critSuccess, critFailure, d100 },
) {
  const flags = message.flags?.redsteel ?? {};
  const isDefense =
    Array.isArray(flags.rerollTokens) && flags.rerollTokens.includes("defense");
  if (!isDefense) return { flags: {}, html: "" };

  const versus = renderVersusBlock(flags.versusAttack ?? null, {
    defenseTotal: roll.total,
    defenseD100: d100,
    defenseCrit: critSuccess,
    defenseCritFailure: critFailure,
  });

  // Same rule the original card used: the contest when this defense answered an
  // attack card, the roll's own margin when it was launched from the hotbar.
  const defenseFailed = versus.versus ? !versus.versus.blocked : roll.total < 0;

  const out = {};
  if (flags.versusAttack) out.versusAttack = flags.versusAttack;
  if (versus.versus) out.versus = versus.versus;
  // `consumed` rides along untouched: a claim already spent on the old card
  // stays spent, since rerolling the die does not hand the points back.
  if (flags.tempHealthGrant) {
    out.tempHealthGrant = { ...flags.tempHealthGrant, defenseFailed };
  }
  if (flags.advantageousManeuver) {
    out.advantageousManeuver = { ...flags.advantageousManeuver, defenseFailed };
  }

  // The armor block belongs to the defender, not to the die, so it is redrawn
  // live. The deflect roll deliberately is not: it was its own chance roll and
  // rerolling the defense test does not buy a second one.
  const defender = ChatMessage.getSpeakerActor(message.speaker ?? {});
  const armor = defender ? renderArmorTable(defender) : "";

  return { flags: out, html: `${versus.html}${armor}` };
}

/**
 * Retire the card a reroll replaced: its margin is no longer the one in play,
 * so its Defend / Apply Damage / claim buttons would resolve a roll that has
 * been thrown away. Rendering-side only — the card and its dice stay in the log.
 */
async function markRerolledAway(source, replacement) {
  // Only cards that carry buttons are worth retiring; a plain skill test has
  // nothing to mislead anyone with.
  const carriesButtons =
    !!source.flags?.attack ||
    !!source.flags?.heal ||
    !!source.flags?.effects ||
    Array.isArray(source.flags?.redsteel?.rerollTokens);
  if (!carriesButtons) return;
  const isAuthor = source.isAuthor ?? source.author?.id === game.user.id;
  if (!isAuthor && !game.user.isGM) return;

  try {
    await source.setFlag("redsteel", "rerolledAway", replacement?.id ?? true);
  } catch (err) {
    console.warn("Redsteel | Could not retire the rerolled card", err);
  }
}

/**
 * Re-roll a skill-test chat message after spending one reroll charge. Reuses the
 * original (post-advantage) formula so any advantage/disadvantage already applied
 * is preserved, and re-applies the same crit thresholds, rollName and skill flag.
 *
 * Attack and defense cards are rebuilt rather than reduced to a bare test: the
 * new card carries the same attack packet / defense claims, so it is answerable,
 * appliable and rerollable exactly like the card it replaces.
 */
async function executeReroll(message, sourceLabel) {
  const rollFormula = message.rolls[0].formula;
  const roll = new Roll(rollFormula);
  await roll.evaluate();
  const d100Result = roll.dice?.[0]?.total ?? roll.total; // works with 2d100kl/kh
  const criticalSuccessThreshold =
    message.flags?.redsteel?.criticalSuccessThreshold;
  const criticalFailureThreshold =
    message.flags?.redsteel?.criticalFailureThreshold;
  const critSuccess = d100Result <= criticalSuccessThreshold;
  const critFailure = d100Result >= criticalFailureThreshold;
  const rollName = message.getFlag("redsteel", "rollName");
  const skill = message.getFlag("redsteel", "skill");

  // A spell card whose cast failed carries `pendingCast`: nothing was applied
  // to the caster, so a reroll that lands has to apply it late. The reroll
  // reuses the card's own margin formula, so this roll's total is the new
  // margin of success.
  const pendingCast = message.getFlag("redsteel", "pendingCast");
  const rescued = pendingCast
    ? await applyPendingCast(pendingCast, roll, critSuccess)
    : false;

  let flavorText = "";
  if (critSuccess) flavorText = "Critical Success!";
  else if (critFailure) flavorText = "Critical Failure!";

  // Combat cards keep being combat cards after a reroll: the attack packet and
  // the defense claims move across with the numbers the new die changed.
  const attackFlag = buildAttackRerollFlag(message, roll, {
    critSuccess,
    critFailure,
  });
  const defenseParts = buildDefenseRerollParts(message, roll, {
    critSuccess,
    critFailure,
    d100: d100Result,
  });

  const carried = {};
  for (const key of REROLL_CARRIED_FLAGS) {
    const value = message.flags?.redsteel?.[key];
    if (value !== undefined) carried[key] = value;
  }

  const sourceNote = sourceLabel
    ? `<p style="text-align:center; font-size:12px; opacity:0.8;"><i class="fa-light fa-rotate"></i> Reroll — ${sourceLabel}</p>`
    : "";
  const rescuedNote = rescued
    ? `<p style="text-align:center; font-size:12px; opacity:0.8;"><i class="fa-light fa-sparkles"></i> Cast succeeded on the reroll — caster effects applied.</p>`
    : "";

  // An attribute card posts a clickable versus-Test line. The reroll builds a
  // fresh flavor, so rebuild that line against the new margin — otherwise the
  // only clickable number left in chat is the one that was just rerolled away.
  const versusTest = message.getFlag("redsteel", "versusTest");
  const versusChance = message.getFlag("redsteel", "versusChance");
  const versusNote = versusTest
    ? `<p style="text-align:center;">${renderMarginFollowupLine({
        margin: roll.total,
        source: rollName ?? "",
        chance: versusChance ?? null,
        result: roll.result,
      })}</p>`
    : "";

  const created = await roll.toMessage({
    speaker: message.speaker ?? ChatMessage.getSpeaker({ user: game.user }),
    flavor: `<p style="text-align: center; font-size: 20px;"><b><i class="fa-light fa-dice-d20"></i> ${rollName} <i class="fa-light fa-dice-d20"></i><hr></b></p>
          <p style="text-align: center; font-size: 20px;"><b>${flavorText}</b></p>${defenseParts.html}${versusNote}${sourceNote}${rescuedNote}`,
    flags: {
      redsteel: {
        rollName,
        skill,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        ...carried,
        ...defenseParts.flags,
        ...(versusTest && { versusTest, versusChance }),
        // Still failed? Keep the context alive so the next reroll can rescue
        // it too. Once applied, drop it so nothing double-applies.
        ...(pendingCast && !rescued && { pendingCast }),
      },
      ...(attackFlag && { attack: attackFlag }),
      // Neither the healed amount nor the effect chances were rerolled — only
      // the test in front of them — so a heal / Apply Effects card keeps its
      // button on the card that now holds the live result.
      ...(message.flags?.heal && { heal: message.flags.heal }),
      ...(message.flags?.effects && { effects: message.flags.effects }),
    },
  });

  await markRerolledAway(message, created);
}

/**
 * Apply the caster side of a spell whose original cast failed, now that a
 * reroll has landed. No-op when the reroll still missed.
 *
 * @param {object} pendingCast - `flags.redsteel.pendingCast` from the card.
 * @param {Roll} roll - The evaluated reroll (its total is the new margin).
 * @param {boolean} critSuccess - Whether the reroll was a Critical Success.
 * @returns {Promise<boolean>} true when the caster side was applied.
 */
async function applyPendingCast(pendingCast, roll, critSuccess) {
  if (!spellCastSucceeded({ attackRoll: roll })) return false;

  const actor = await fromUuid(pendingCast.casterUuid);
  if (!actor) return false;

  // Variant spells may live on the actor, in the world, or in a compendium —
  // the uuid covers all three, with the id as a fallback for older cards.
  const spell =
    (pendingCast.spellUuid ? await fromUuid(pendingCast.spellUuid) : null) ??
    actor.items.get(pendingCast.spellId) ??
    game.items.get(pendingCast.spellId);
  if (!spell) {
    ui.notifications.warn(
      "Reroll succeeded, but the spell could not be found to apply its caster effects.",
    );
    return false;
  }

  // `ignoreChanneling` suppresses crit evaluation exactly as it does on the
  // original cast (see performAttackRoll).
  await applyPostCastEffects(
    actor,
    spell,
    {
      attackRoll: roll,
      critSuccess: pendingCast.ignoreChanneling ? false : critSuccess,
      displayCritSuccess: critSuccess,
    },
    { focusSpent: pendingCast.focusSpent ?? 0 },
  );
  return true;
}

/**
 * Handle a click on a chat reroll button: resolve the rolling actor and the
 * test's skill, gather eligible reroll pools, let the user pick one when there
 * are several, then spend the charge and re-roll.
 */
async function handleRerollClick(message) {
  // Who spends the reroll: the actor who made the roll when the message
  // carries one. Older/actorless messages fall back to the clicking user's
  // controlled token (must be owned — this is how a GM picks the character),
  // then to the user's assigned character.
  const actor =
    ChatMessage.getSpeakerActor(message.speaker) ??
    canvas.tokens?.controlled
      ?.map((t) => t.actor)
      .find((a) => a?.isOwner) ??
    game.user.character;

  if (!actor) {
    ui.notifications.warn(
      "No actor found for this roll — select the character's token and try again.",
    );
    return;
  }

  // Roll tokens this card can be rerolled against. Attack/defense cards carry a
  // precomputed `rerollTokens` array (combat skill + governing attribute, worked
  // out when the weapon/finesse state was known). Skill cards carry a `skill`
  // flag, from which the skill key + its governing attribute are derived.
  const stored = message.getFlag("redsteel", "rerollTokens");
  const skillKey =
    message.getFlag("redsteel", "skill") ??
    message.rolls?.[0]?.options?.redsteel?.skill;
  const tokens = Array.isArray(stored)
    ? stored
    : getRerollTokensForSkill(actor, skillKey);
  const isCombat = tokens.some((t) => t === "attack" || t === "defense");

  // A natural Critical Failure can only be rerolled by pools carrying the
  // "critfail" trigger keyword (or legacy-shape pools like an un-resaved
  // Lucky) — see getEligibleRerolls.
  const d100 = message.rolls?.[0]?.dice?.[0]?.total ?? message.rolls?.[0]?.total;
  const cft = Number(message.flags?.redsteel?.criticalFailureThreshold);
  const wasCritFailure = Number.isFinite(cft) && d100 >= cft;

  const eligible = getEligibleRerolls(actor, tokens, {
    critFailure: wasCritFailure,
  });
  if (!eligible.length) {
    ui.notifications.info(
      wasCritFailure
        ? "No rerolls available that can reroll a Critical Failure."
        : "No eligible rerolls available.",
    );
    return;
  }

  let chosen = eligible[0];
  if (eligible.length > 1) {
    chosen = await pickRerollPool(eligible);
    if (!chosen) return; // cancelled
  }

  const spent = await consumeReroll(actor, chosen.itemId, chosen.poolIndex, {
    combat: isCombat,
  });
  if (!spent) {
    ui.notifications.warn("That reroll is already spent.");
    return;
  }

  try {
    await scheduleRerollRefresh(actor, chosen, { critFailure: wasCritFailure });
  } catch (err) {
    console.warn("Redsteel | Calendaria scheduling failed", err);
  }

  await executeReroll(message, chosen.label);
}

// A card that has been rerolled away keeps its dice in the log but loses its
// controls: answering, applying or re-rerolling it would resolve a margin that
// is no longer the one in play. Registered at `ready` on purpose — this has to
// run after every hook that *adds* a button, whichever file registered it.
Hooks.once("ready", () => {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!message.getFlag("redsteel", "rerolledAway")) return;

    html.classList.add("rs-rerolled-away");

    for (const button of html.querySelectorAll(
      ".button-container button, .button-container a.button",
    )) {
      button.remove();
    }
    const container = html.querySelector(".button-container");
    if (container && !container.childElementCount) container.remove();

    // The hook can fire more than once against the same element.
    if (html.querySelector(".rs-rerolled-note")) return;
    const note = document.createElement("div");
    note.className = "rs-rerolled-note";
    note.textContent = game.i18n.localize("REDSTEEL.Reroll.Superseded");
    html.querySelector(".message-content")?.appendChild(note);
  });
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
    // outcome); the generic one can't, so skip it for those. Mental Duel cards
    // are posted only after both sides locked their dice in — the reroll step
    // lives in the duel window, so the generic button would be a lie here.
    if (
      hasTestRoll &&
      !message.getFlag("redsteel", "stabilise") &&
      !message.getFlag("redsteel", "mentalDuel")
    ) {
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
        // Skill/attribute/combat-skill test cards carry a `skill` flag; weapon
        // attack and defense cards carry a `rerollTokens` array. Both go through
        // the reroll-resource picker. Anything else (spell/magic defense cards)
        // keeps the existing free Re-Roll.
        if (
          message.getFlag("redsteel", "skill") ||
          message.getFlag("redsteel", "rerollTokens")
        ) {
          await handleRerollClick(message);
        } else {
          await executeReroll(message, null);
        }
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
    // --- Apply Healing (heal cards carry a `heal` flag, never an `attack`) ---
    if (message.flags?.heal) {
      let buttonContainer = html.querySelector(".button-container");
      if (!buttonContainer) {
        buttonContainer = document.createElement("div");
        buttonContainer.className = "button-container";
        html.querySelector(".message-content")?.appendChild(buttonContainer);
      }

      const applyHealingButton = document.createElement("button");
      applyHealingButton.type = "button";
      applyHealingButton.className = "redsteel-apply-healing";
      applyHealingButton.dataset.messageId = message.id;
      applyHealingButton.textContent = "Apply Healing";

      buttonContainer.appendChild(applyHealingButton);
      updateButtonContainerLayout(buttonContainer);
      applyHealingButton.addEventListener("click", async () => {
        await handleApplyHealing(message.id);
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
  registerCoreTooltipProviders();
  initTooltips();
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
      // No temporary-health bar: temp HP is read off the sheet and the hotbar
      // portrait band instead, and it never survives the end of a fight.
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

  // Blood Pool bar, only for blood mages: characters who have acquired the
  // Blood School specialisation's "apprentice" node, or NPCs with a blood
  // school rank.
  if (
    actor.system.specialisations?.bloodSchool?.nodes?.apprentice ||
    actor.system.schools?.blood?.value > 0
  ) {
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

// The temporary-health bar (barbrawl `bar4`) is gone for good, but tokens and
// prototype tokens created before that still carry its config. Strip it so old
// tokens stop drawing it. GM-only, and a no-op once every token is clean.
Hooks.once("ready", async () => {
  if (!game.user.isGM) return;

  const hasTempBar = (doc) =>
    !!doc?.flags?.barbrawl?.resourceBars?.bar4 ||
    !!doc?.getFlag?.("barbrawl", "resourceBars")?.bar4;

  const actorUpdates = game.actors.contents
    .filter((actor) => hasTempBar(actor.prototypeToken))
    .map((actor) => ({
      _id: actor.id,
      "prototypeToken.flags.barbrawl.resourceBars.-=bar4": null,
    }));

  if (actorUpdates.length) await Actor.updateDocuments(actorUpdates);

  for (const scene of game.scenes.contents) {
    const tokenUpdates = scene.tokens.contents
      .filter((token) => hasTempBar(token))
      .map((token) => ({
        _id: token.id,
        "flags.barbrawl.resourceBars.-=bar4": null,
      }));

    if (tokenUpdates.length) {
      await scene.updateEmbeddedDocuments("Token", tokenUpdates);
    }
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
/** Spell school keys that can own a crit-fail table (mirrors template.json). */
const MAGIC_SCHOOLS = [
  "fire",
  "water",
  "air",
  "earth",
  "spirit",
  "body",
  "darkness",
  "blood",
  "gnosis",
];

/** Name a school's crit-fail table carries in the compendium, e.g. "Blood crit fails". */
function _critTableName(school) {
  return `${school.charAt(0).toUpperCase()}${school.slice(1)} crit fails`;
}

/**
 * Find the crit-fail RollTable for a magic school.
 *
 * The tables ship in the `redsteel-magic-crit-fails` compendium and that is the
 * authoritative copy, so it is searched first: a stale or hand-edited world
 * import can no longer shadow the shipped table. Every shipped table has
 * `replacement: true`, so drawing from the pack document never writes back.
 *
 * Only if the pack is missing the school do we fall back to the world, matched
 * by the `redsteel.critTable` flag, then the legacy `tos` namespace, then the
 * table's name. World copies imported before the flag existed carry no flag at
 * all, so the flag is stamped on whatever world table answered and the next
 * lookup is a straight flag hit.
 *
 * @param {string} school - Spell school key, e.g. "blood".
 * @returns {Promise<RollTable|null>}
 */
async function _resolveCritFailTable(school) {
  if (!school) return null;

  const expected = _critTableName(school).toLowerCase();

  const pack = game.packs.get("redsteel.redsteel-magic-crit-fails");
  if (pack) {
    const index = await pack.getIndex({
      fields: ["flags.redsteel.critTable", "flags.tos.critTable"],
    });
    const entry =
      index.find((e) => e.flags?.redsteel?.critTable === school) ??
      index.find((e) => e.flags?.tos?.critTable === school) ??
      index.find((e) => e.name?.toLowerCase() === expected);

    if (entry) {
      const doc = await pack.getDocument(entry._id);
      if (doc) return doc;
    }
  }

  const byFlag =
    game.tables.find((t) => t.getFlag("redsteel", "critTable") === school) ??
    game.tables.find((t) => t.getFlag("tos", "critTable") === school);

  if (byFlag) {
    if (game.user.isGM && byFlag.getFlag("redsteel", "critTable") !== school) {
      await byFlag.setFlag("redsteel", "critTable", school);
    }
    return byFlag;
  }

  const byName = game.tables.find((t) => t.name?.toLowerCase() === expected);

  if (byName) {
    if (game.user.isGM) await byName.setFlag("redsteel", "critTable", school);
    return byName;
  }

  return null;
}

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

      const table = await _resolveCritFailTable(spellType);

      if (!table) {
        ui.notifications.warn(
          `No critical failure table found for the "${spellType}" school, in the Redsteel magic crit fails compendium or in the world.`,
        );
        return;
      }

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

  // Magic rope → send the summoned rope at the current target. The card is
  // re-posted after each resolution the rope survives, so the start-of-round
  // retest is the same button on the newest card.
  wire("magicRopeSend", async (actor) => {
    await sendMagicRope(actor);
  });

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
  if (!game.user.isGM) return;

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

  // Blood, Spirit and Body were added after the flag convention was settled and
  // their world copies can be missing it entirely, which left their Accept
  // Critical Failure button dead. Match those by name and stamp the flag.
  for (const school of MAGIC_SCHOOLS) {
    const flagged = game.tables.find(
      (t) => t.getFlag("redsteel", "critTable") === school,
    );
    if (flagged) continue;

    const expected = _critTableName(school).toLowerCase();
    const table = game.tables.find((t) => t.name?.toLowerCase() === expected);
    if (!table) continue;

    await table.setFlag("redsteel", "critTable", school);
    console.log(`Flagged ${table.name}: ${school}`);
  }

  console.log("Redsteel | Migration complete");
});

/**
 * NPC movement (`secondaryAttributes.mov`) was folded into the same Speed
 * attribute characters use (`secondaryAttributes.spd`), so speed debuffs and
 * the d12 speed test work on NPCs with no extra wiring. Carry the stored value
 * across and drop the old key. Idempotent: once `mov` is gone this no-ops.
 */
/**
 * Build the mov → spd update for one stored system object.
 *
 * Reads `_source` data, never prepared data: `prepareDerivedData` rebuilds
 * `secondaryAttributes` totals and a converter that trusts the prepared object
 * can end up copying a recomputed value instead of the stored one.
 *
 * A stored Speed the user has already typed in wins over the legacy value, so
 * re-running this can never walk a real number back to an old one. `mov` is
 * only dropped in the same update that carries its value across, so a failed
 * write leaves the old key intact for the next attempt.
 *
 * @param {object} source - Raw `_source.system` of an NPC (or a token delta).
 * @returns {object|null} Update payload, or null when there is nothing to do.
 */
function buildSpeedConversion(source) {
  const mov = source?.secondaryAttributes?.mov;
  if (!mov) return null;

  const update = { "system.secondaryAttributes.-=mov": null };

  // A token delta only stores what differs from its base actor, so a missing
  // sub-key there means "inherited", not "zero" — leave those alone.
  const spd = source?.secondaryAttributes?.spd;
  const movValue = Number(mov.value) || 0;
  const movBonus = Number(mov.bonus) || 0;

  if (movValue && !(Number(spd?.value) || 0)) {
    update["system.secondaryAttributes.spd.value"] = movValue;
  }
  if (movBonus && !(Number(spd?.bonus) || 0)) {
    update["system.secondaryAttributes.spd.bonus"] = movBonus;
  }

  return update;
}

/**
 * Same conversion for a document that has not been created yet.
 *
 * `updateSource` merges rather than replaces, so the `-=` deletion syntax that
 * `Document#update` understands cannot be relied on to drop the stale key here.
 * Write the values through the API and delete the key on the source object,
 * which is still plain, unsaved data at this point.
 *
 * @param {Actor} actor - The pending document from a preCreate hook.
 * @param {object} source - Its `_source.system`.
 * @returns {boolean} Whether anything was converted.
 */
function applySpeedConversionToSource(actor, source) {
  const update = buildSpeedConversion(source);
  if (!update) return false;

  delete update["system.secondaryAttributes.-=mov"];
  if (Object.keys(update).length) actor.updateSource(update);
  delete actor._source?.system?.secondaryAttributes?.mov;

  return true;
}

/**
 * Fold legacy NPC movement (`secondaryAttributes.mov`) into the Speed attribute
 * characters already use (`secondaryAttributes.spd`), so speed debuffs and the
 * d12 speed test work on NPCs with no extra wiring.
 *
 * Covers world actors, unlinked token deltas, and — with `packs: true` —
 * unlocked Actor compendiums, which is where an NPC imported from an older
 * world shows up. Idempotent: once `mov` is gone every pass is a no-op.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Report what would change, write nothing.
 * @param {boolean} [options.packs=false]  - Also convert unlocked Actor compendiums.
 * @returns {Promise<object[]>} One row per converted actor.
 */
async function convertNpcMovement({ dryRun = false, packs = false } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can convert NPC movement.");
    return [];
  }

  const converted = [];

  /** @param {Actor} actor @param {object} source @param {string} where */
  const convert = async (actor, source, where) => {
    const update = buildSpeedConversion(source);
    if (!update) return;

    converted.push({
      name: actor?.name ?? "(unknown)",
      where,
      speed: update["system.secondaryAttributes.spd.value"] ?? "unchanged",
    });

    if (!dryRun) await actor?.update(update);
  };

  for (const actor of game.actors.contents) {
    if (actor.type !== "npc") continue;
    await convert(actor, actor._source.system, "world");
  }

  // Unlinked tokens keep their own copy of the data in the actor delta.
  for (const scene of game.scenes.contents) {
    for (const token of scene.tokens.contents) {
      if (token.actorLink || token.actor?.type !== "npc") continue;
      await convert(token.actor, token.delta?._source?.system, scene.name);
    }
  }

  if (packs) {
    for (const pack of game.packs) {
      if (pack.documentName !== "Actor" || pack.locked) continue;
      for (const actor of await pack.getDocuments()) {
        if (actor.type !== "npc") continue;
        await convert(actor, actor._source.system, pack.collection);
      }
    }
  }

  const label = dryRun ? "would convert" : "converted";
  console.log(
    `Redsteel | NPC movement → Speed: ${label} ${converted.length} actors`,
    converted,
  );
  if (converted.length && !dryRun) {
    ui.notifications.info(
      `Converted movement → Speed on ${converted.length} NPCs.`,
    );
  }

  return converted;
}

/**
 * NPC Mind used to have no authored ceiling — `stats.mind.max` sat at 0 while
 * only `value` was filled in. Once the burn rules started clamping Mind to its
 * maximum, that 0 pinned every NPC's Mind at 0 and made the field impossible to
 * edit. Seed a real ceiling from the stored current value.
 *
 * Reads `_source` data, never prepared data: `prepareDerivedData` now falls back
 * to the current value when the ceiling is unauthored, so a converter that
 * trusted the prepared object could never tell a real max from the fallback.
 *
 * An authored max always wins, so re-running this can never walk a hand-typed
 * ceiling back down.
 *
 * @param {object} source - Raw `_source.system` of an NPC (or a token delta).
 * @param {boolean} isDelta - True for token deltas, where a missing sub-key
 *   means "inherited from the base actor" rather than "zero".
 * @returns {object|null} Update payload, or null when there is nothing to do.
 */
function buildMindMaxSeed(source, isDelta = false) {
  const mind = source?.stats?.mind;
  if (!mind) return null;
  if (Number(mind.max) || 0) return null;

  // A delta that never stored a ceiling inherits the base actor's, which the
  // world pass fixes. Only an explicitly stored 0 needs overriding here.
  if (isDelta && mind.max === undefined) return null;

  // A sheet submit made while Mind was pinned could have persisted value 0, so
  // fall back to the template default rather than seeding another 0.
  const seed = Number(mind.value) || 3;
  return { "system.stats.mind.max": seed };
}

/**
 * Give every legacy NPC a real Mind ceiling so the stat stops being clamped to
 * 0 and becomes editable again.
 *
 * Covers world actors, unlinked token deltas, and — with `packs: true` —
 * unlocked Actor compendiums. Idempotent: once a non-zero max is stored every
 * pass is a no-op.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun=false] - Report what would change, write nothing.
 * @param {boolean} [options.packs=false]  - Also convert unlocked Actor compendiums.
 * @returns {Promise<object[]>} One row per seeded actor.
 */
async function seedNpcMindMax({ dryRun = false, packs = false } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn("Only the GM can repair NPC Mind.");
    return [];
  }

  const seeded = [];

  /** @param {Actor} actor @param {object} source @param {string} where */
  const seed = async (actor, source, where, isDelta = false) => {
    const update = buildMindMaxSeed(source, isDelta);
    if (!update) return;

    seeded.push({
      name: actor?.name ?? "(unknown)",
      where,
      mindMax: update["system.stats.mind.max"],
    });

    if (!dryRun) await actor?.update(update);
  };

  for (const actor of game.actors.contents) {
    if (actor.type !== "npc") continue;
    await seed(actor, actor._source.system, "world");
  }

  for (const scene of game.scenes.contents) {
    for (const token of scene.tokens.contents) {
      if (token.actorLink || token.actor?.type !== "npc") continue;
      await seed(token.actor, token.delta?._source?.system, scene.name, true);
    }
  }

  if (packs) {
    for (const pack of game.packs) {
      if (pack.documentName !== "Actor" || pack.locked) continue;
      for (const actor of await pack.getDocuments()) {
        if (actor.type !== "npc") continue;
        await seed(actor, actor._source.system, pack.collection);
      }
    }
  }

  const label = dryRun ? "would seed" : "seeded";
  console.log(
    `Redsteel | NPC Mind maximum: ${label} ${seeded.length} actors`,
    seeded,
  );
  if (seeded.length && !dryRun) {
    ui.notifications.info(`Restored the Mind maximum on ${seeded.length} NPCs.`);
  }

  return seeded;
}

Hooks.once("ready", async () => {
  if (!game.user.isGM) return;
  await convertNpcMovement();
  await seedNpcMindMax();
});

// An NPC imported or dragged in from an older world arrives after the startup
// pass, so fold its movement in before the document is ever stored.
Hooks.on("preCreateActor", (actor) => {
  if (actor.type !== "npc") return;

  const source = actor._source?.system;
  const mindSeed = buildMindMaxSeed(source);
  if (mindSeed) actor.updateSource(mindSeed);

  if (!applySpeedConversionToSource(actor, source)) return;

  console.log(`Redsteel | Converted movement → Speed on import: ${actor.name}`);
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

// Bane ("Metla") pill: attack chat cards that carry flags.attack.bane get a
// single accent pill next to the trait pills. Clicking it flips the card's
// damage block in place between the stored "normal" face and one face per
// Bane variant that could apply — no pop-up window, so the card never shows
// numbers that don't come from the same shared renderer as the normal face.
//
// Since Phase 4 the stored packet no longer carries a finished result for the
// attacker alone — a target may also benefit from an ally Ranger's Odhalení
// slabiny mark, granting that Ranger's Bane bonuses to whoever lands the hit.
// Since Phase 5 the pill therefore cycles through every variant that COULD
// apply (`getDisplayBaneVariants`) — the attacker's own Bane, if any, plus one
// entry per Ranger who currently has some target Exposed — since the card
// cannot know in advance which target will be picked.
//
// Bane values are computed at render time (not stored on the message) because
// they depend on which Expose Weakness marks exist right now, so both the
// normal and Bane faces are built from the same `renderDamageLine` helper to
// keep the flip visually seamless.
Hooks.on("renderChatMessageHTML", (message, html) => {
  const bane = message.flags?.attack?.bane;
  if (!bane) return;

  const variants = getDisplayBaneVariants(bane);
  if (!variants.length) return;

  const pill = document.createElement("span");
  pill.classList.add("trait-pill", "bane-pill");
  pill.textContent = game.i18n.localize("REDSTEEL.Banes.Label");
  pill.dataset.tooltip = `${game.i18n.localize("REDSTEEL.Banes.PillTooltip")} ${variants.map((v) => v.label).join("; ")}`;

  // Cards created before this change have no `.rs-attack-face` wrapper to
  // swap — leave the pill inert (no cursor, no handler) rather than error.
  const faceEl = html.querySelector(".rs-attack-face");
  const alreadyWired = faceEl?.dataset.baneWired === "true";

  if (faceEl && !alreadyWired) {
    faceEl.dataset.baneWired = "true";
    pill.style.cursor = "pointer";

    // Face 0 is the stored normal markup, captured before any swap so a
    // later flip back is always byte-identical to what the card opened with.
    const normalFaceHTML = faceEl.innerHTML;

    const normalBreakthrough = message.flags?.attack?.breakthrough?.damage;
    const showBreakthrough =
      typeof normalBreakthrough === "string" &&
      normalBreakthrough.trim() !== "";

    const baneFaces = variants.map(({ label, variant: v }) => {
      const grid = renderDamageLine({
        damage: v.normal.damage,
        penetration: v.normal.penetration,
        breakthrough: v.breakthrough.damage,
        critDamage: v.critical.damage,
        critPenetration: v.critical.penetration,
        critScore: v.critical.degree,
        critScoreResult: v.critical.result,
        showBreakthrough,
      });

      const critChanged = v.critSuccess !== bane.baseCritSuccess;
      const critNote = critChanged
        ? `<div style="text-align:center; font-style:italic; margin-top:6px;">
             ${game.i18n.localize(
               v.critSuccess
                 ? "REDSTEEL.Banes.CritOnlyWithBane"
                 : "REDSTEEL.Banes.CritLostWithBane",
             )}
           </div>`
        : "";

      // The crit roll succeeds when the die lands at or under the threshold,
      // so state the outcome outright rather than leaving the reader to work
      // out which direction the comparison runs.
      const critHit = v.critSuccess
        ? ` <strong style="color:#c8a84b;">${game.i18n.localize("REDSTEEL.Banes.CritHit")}</strong>`
        : "";

      // Ověření (precision) sits directly under the crit roll because that is
      // all a procced precision does: announce eligibility for a critical
      // strike. Threshold is the attacker-side chance plus this profile's
      // metlaOvereni bonus — the target's own effect mods and any aimed-hit
      // body-part modifier are not known here, so the Apply Damage dialog
      // remains the authority on what actually lands.
      const precisionEffect = message.flags?.attack?.effects?.precision;
      let precisionLine = "";
      if (precisionEffect) {
        const threshold =
          (Number(precisionEffect.chance) || 0) + (v.precision || 0);
        const procced = Number(precisionEffect.roll) <= threshold;
        const proc = procced
          ? ` <strong style="color:#c8a84b;">${game.i18n.localize("REDSTEEL.Banes.PrecisionProc")}</strong>`
          : "";
        precisionLine = `
<div style="text-align:center; font-size:14px;">
  ${game.i18n.localize("REDSTEEL.Banes.DetailPrecision")}:
  ${game.i18n.format("REDSTEEL.Banes.CritRoll", { die: precisionEffect.roll, threshold })}${proc}
</div>`;
      }

      return `
${grid}
<div style="text-align:center; font-weight:bold; margin-top:-4px;">
  ${label}
</div>
<div style="text-align:center; font-size:14px;">
  ${game.i18n.localize("REDSTEEL.Banes.DetailCritChance")}:
  ${game.i18n.format("REDSTEEL.Banes.CritRoll", { die: bane.dice.die, threshold: v.critThreshold })}${critHit}
</div>
${precisionLine}
${critNote}
`;
    });

    const faces = [normalFaceHTML, ...baneFaces];
    let currentIndex = 0;

    pill.addEventListener("click", () => {
      currentIndex = (currentIndex + 1) % faces.length;
      faceEl.innerHTML = faces[currentIndex];
      pill.classList.toggle("is-active", currentIndex !== 0);
    });
  }

  const existingContainer = html.querySelector(".trait-pills");
  if (existingContainer) {
    existingContainer.appendChild(pill);
    return;
  }

  const container = document.createElement("div");
  container.classList.add("trait-pills");
  container.appendChild(pill);

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

// Odhalení slabiny marks end with the combat, not just the marking Ranger's
// next mark. Only the active GM's client performs the deletions, since most
// players are not GM.
Hooks.on("deleteCombat", async () => {
  if (!game.user.isGM) return;
  await clearMarksBy(null);
});

/* -------------------------------------------- */
/*  Temporary health fizzles out of combat      */
/* -------------------------------------------- */

// Both pools are combat-only: whatever is left when the encounter ends is lost
// rather than carried into the next fight.
async function clearTemporaryHealth(actors) {
  const seen = new Set();

  for (const actor of actors) {
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);

    const temp = Number(actor.system?.stats?.temporaryHealth?.value ?? 0);
    const tempMagic = Number(
      actor.system?.stats?.temporaryHealthMagic?.value ?? 0,
    );
    if (!temp && !tempMagic) continue;

    const update = {};
    if (temp) update["system.stats.temporaryHealth.value"] = 0;
    if (tempMagic) update["system.stats.temporaryHealthMagic.value"] = 0;

    try {
      await actor.update(update);
    } catch (err) {
      console.error("redsteel | failed to clear temporary health", actor, err);
    }
  }
}

// Only the GM clears, since players cannot update other actors. Combatants of
// the ending encounter always drop their temp HP; when that was the world's
// last encounter, sweep every other actor too so nothing hangs on to a pool it
// picked up while someone else was fighting.
Hooks.on("deleteCombat", async (combat) => {
  if (!game.user.isGM) return;

  const actors = combat.combatants.contents.map((c) => c.actor);
  const otherCombats = game.combats.contents.some((c) => c.id !== combat.id);
  if (!otherCombats) actors.push(...game.actors.contents);

  await clearTemporaryHealth(actors);
});

// Make "Margin of Success" lines clickable → follow-up attribute test, and
// "Speed Test" lines clickable → contested speed test.
Hooks.on("renderChatMessageHTML", (message, html) => {
  wireAttributeFollowups(html);
  wireSpeedFollowups(html);
});

// On token deploy, apply status effects granted by the actor's trait features.
// Only the creating user runs this, to avoid duplicate application.
Hooks.on("createToken", async (tokenDoc, options, userId) => {
  if (game.user.id !== userId) return;
  await applyTraitStatusEffects(tokenDoc);
});

/* -------------------------------------------- */
/*  Item-driven token lighting                  */
/* -------------------------------------------- */

// Gear/weapons carrying a `system.light` block drive the owning actor's token
// light while equipped (strongest source wins). Recompute whenever the relevant
// state changes. Only the acting user runs this to avoid duplicate updates.
const LIGHT_ITEM_TYPES = new Set(["gear", "weapon"]);

function isLightCapableItem(item) {
  return !!item?.parent && LIGHT_ITEM_TYPES.has(item.type);
}

Hooks.on("createItem", (item, options, userId) => {
  if (game.user.id !== userId || !isLightCapableItem(item)) return;
  applyActorLight(item.parent);
});

Hooks.on("deleteItem", (item, options, userId) => {
  if (game.user.id !== userId || !isLightCapableItem(item)) return;
  applyActorLight(item.parent);
});

Hooks.on("updateItem", (item, changes, options, userId) => {
  if (game.user.id !== userId || !isLightCapableItem(item)) return;
  // Only react to changes that can alter the emitted light.
  const sys = changes.system;
  if (!sys || (!("equipped" in sys) && !("light" in sys))) return;
  applyActorLight(item.parent);
});

// Weapon/armor equipping — and switching the active weapon set — is recorded on
// the actor (not on the item), so watch for those changes too.
Hooks.on("updateActor", (actor, changes, options, userId) => {
  if (game.user.id !== userId) return;
  const combat = changes.system?.combat;
  if (
    !combat ||
    (!("weaponSets" in combat) &&
      !("armorSlots" in combat) &&
      !("accessorySlots" in combat) &&
      !("activeWeaponSet" in combat))
  )
    return;
  applyActorLight(actor);
});

// A freshly placed token should immediately reflect its actor's item-light.
Hooks.on("createToken", (tokenDoc, options, userId) => {
  if (game.user.id !== userId || !tokenDoc.actor) return;
  applyActorLight(tokenDoc.actor, { tokenDocs: [tokenDoc] });
});

/* -------------------------------------------- */
/*  Default actor abilities                     */
/* -------------------------------------------- */

// Baseline abilities (Disengage, Sprint, Rest, Defensive Stance) are no longer
// copied here. They are the `kind: "always"` rule at the top of ABILITY_GRANTS
// in utils/abilityGrants.mjs, so the grant system owns every ability an actor
// gets for free — including letting Shieldbearer 6 replace the base Defensive
// Stance with its upgrade rather than leaving both on the sheet.
