import { prepareActiveEffectCategories } from "../helpers/effects.mjs";
import {
  prepareSpecialisationTrees,
  syncSpecialisationPassive,
} from "../helpers/specialisations.mjs";
import { getTraitPills } from "../utils/traitPills.mjs";
import { gatherHerbs, promptHerbMode } from "../utils/gatherHerbs.mjs";
import { tagRollSkill, applyDesperateCrit } from "../utils/rollAdvantage.mjs";
import {
  getActorRerollPools,
  toggleRerollCharge,
  getEligibleRerolls,
  consumeReroll,
} from "../utils/rerolls.mjs";
import { scheduleRerollRefresh } from "../utils/calendariaIntegration.mjs";
import {
  SUBSTANCES,
  STATIONS,
  MAX_BATCH,
  SUBSTANCE_HERB_COST,
  SUBSTANCE_CRAFT_MOD,
  SUBSTANCE_BATCH_MOD,
  getSubstanceCount,
  getHerbCount,
  getMaxSubstanceBatch,
  getAlchemistSubstanceModifiers,
  getAlchemistCraftModifiers,
  describeCraftBoons,
  brewSubstance,
  craftRecipe,
  rerollCraft,
} from "../utils/alchemy.mjs";
import {
  getRaceChoiceGroups,
  openRacePicker,
  openRaceChoicesDialog,
  initializeRaceChoices,
} from "../utils/race.mjs";
import { openWeaponSpecDialog } from "../utils/weaponSpec.mjs";
import { postSpeedTest } from "../utils/speedTest.mjs";
import { renderMarginFollowupLine } from "../utils/attributeFollowup.mjs";
import { openBanePicker, clearBaneChoice } from "../helpers/banes.mjs";
import { buildSpellCard, buildRankGroups } from "../utils/spellCards.mjs";

const { api, sheets } = foundry.applications;

// Maps the gear "layer" select values to armor slot keys on the actor
const ARMOR_LAYER_SLOTS = { Bottom: "bottom", Middle: "middle", Top: "top" };

// Accessory slots are generic and interchangeable: any gear whose layer marks
// it as an accessory fits any of the ten slots.
const ACCESSORY_SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
// "Not Armor" is the pre-rename value; accept it so live worlds keep working.
const ACCESSORY_LAYERS = new Set(["Accessory", "Not Armor"]);

/** @returns {boolean} whether this item can occupy an accessory slot. */
function isAccessory(item) {
  return (
    item?.type === "gear" &&
    !item.system?.shield &&
    ACCESSORY_LAYERS.has(item.system?.layer)
  );
}

// Inventory grid category filters. `all` shows everything; the rest map a
// display category to the underlying item types (ammunition rides with the
// alchemy/supplies bucket, matching the old "supplies" grouping).
const INVENTORY_CATEGORIES = {
  all: {
    labelKey: "REDSTEEL.Actor.Inventory.Filter.All",
    types: ["weapon", "gear", "consumable", "ammunition", "item"],
  },
  weapon: {
    labelKey: "REDSTEEL.Actor.Inventory.Filter.Weapons",
    types: ["weapon"],
  },
  gear: {
    labelKey: "REDSTEEL.Actor.Inventory.Filter.Gear",
    types: ["gear"],
  },
  alchemy: {
    labelKey: "REDSTEEL.Actor.Inventory.Filter.Alchemy",
    types: ["consumable", "ammunition"],
  },
  item: {
    labelKey: "REDSTEEL.Actor.Inventory.Filter.Items",
    types: ["item"],
  },
};

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheetV2}
 */
export class RedsteelActorSheet extends api.HandlebarsApplicationMixin(
  sheets.ActorSheetV2,
) {
  constructor(options = {}) {
    super(options);
    console.log("Actor sheet loaded");
    this.#dragDrop = this.#createDragDropHandlers();
    this._boundRightClick = this._onRightClick.bind(this);
    this._skillsEditMode = false;
    this._inventoryFilter = "all";
    // Spells/Miracles tab rank filters — transient, never persisted on the
    // actor. null means "use the first available rank for the active school".
    this._spellRankFilter = null;
    this._miracleRankFilter = null;
    // Alchemy tab state — transient, never persisted on the actor.
    this._alchemyStation = "foldable";
    this._alchemySelectedRecipe = null;
    this._alchemyAmount = 1;
    this._alchemyLastOutcome = null;
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["redsteel", "actor"],
    position: {
      width: 860,
      height: 1200,
    },
    actions: {
      onEditImage: this._onEditImage,
      viewDoc: this._viewDoc,
      createDoc: this._createDoc,
      deleteDoc: this._deleteDoc,
      adjustNumericField: this._adjustNumericField,
      adjustActorNumber: this._adjustActorNumber,
      toggleSkillsEdit: this._toggleSkillsEdit,
      toggleEffect: this._toggleEffect,
      roll: this._onRoll,
      rollSpeed: this._onRollSpeed,
      toggleEquipped: this._toggleEquipped,
      toggleReroll: this._toggleReroll,
      toggleSchool: this._toggleSchool,
      setActiveWeaponSet: this._setActiveWeaponSet,
      toggleTwoHandGrip: this._toggleTwoHandGrip,
      toggleNpcOffhand: this._toggleNpcOffhand,
      toggleAmmoEquipped: this._toggleAmmoEquipped,
      toggleArmorDurability: this._toggleArmorDurability,
      toggleSpecNode: this._toggleSpecNode,
      addCurrency: this._addCurrency,
      deleteCurrency: this._deleteCurrency,
      setInventoryFilter: this._setInventoryFilter,
      setSpellRank: this._setSpellRank,
      setMiracleRank: this._setMiracleRank,
      selectRecipe: this._selectRecipe,
      brewSubstance: this._brewSubstance,
      craftRecipe: this._craftRecipe,
      rerollCraft: this._rerollCraft,
      selectRace: this._selectRace,
      chooseWeaponSpec: this._chooseWeaponSpec,
    },
    // Custom property that's merged into `this.options`
    dragDrop: [{ dragSelector: "[data-drag]", dropSelector: null }],
    form: {
      submitOnChange: true,
    },
  };

  static async _toggleReroll(event) {
    // Ensure we get the element with the correct data attributes
    const target = event.target.closest("[data-action='toggleReroll']");

    if (!target) {
      console.debug("Click did not occur on a valid reroll icon.");
      return;
    }

    const itemId = target.dataset.itemId;
    const poolIndex = parseInt(target.dataset.poolIndex, 10);
    if (!itemId || Number.isNaN(poolIndex)) {
      console.debug("Invalid itemId or poolIndex.");
      return;
    }

    // Spend/restore one charge of this pool (cycles full → spend → ... → full).
    await toggleRerollCharge(this.actor, itemId, poolIndex);
  }
  /**
   * Toggle a specialisation talent-tree node. Unlocking requires all linked
   * prerequisite nodes to be unlocked; locking is blocked while another
   * unlocked node still depends on this one.
   */
  static async _toggleSpecNode(event) {
    const target = event.target.closest("[data-action='toggleSpecNode']");
    if (!target || !this.isEditable) return;

    const specId = target.dataset.spec;
    const nodeId = target.dataset.node;
    const specDef = CONFIG.REDSTEEL.specialisations?.[specId];
    const nodeDef = specDef?.nodes?.[nodeId];
    if (!nodeDef) return;

    const unlockedNodes =
      this.actor.system.specialisations?.[specId]?.nodes ?? {};
    const unlocked = !!unlockedNodes[nodeId];

    if (!unlocked) {
      const requirementsMet = (nodeDef.requires ?? []).every(
        (r) => !!unlockedNodes[r],
      );
      if (!requirementsMet) {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Actor.Specialisations.warnLocked"),
        );
        return;
      }
    } else {
      const hasUnlockedDependent = Object.entries(specDef.nodes).some(
        ([id, n]) => unlockedNodes[id] && (n.requires ?? []).includes(nodeId),
      );
      if (hasUnlockedDependent) {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Actor.Specialisations.warnDependents"),
        );
        return;
      }
    }

    const baneCount = Number(nodeDef.bane) || 0;

    // An already-unlocked bane node with no stored pick means the player
    // unlocked it, then cancelled the picker. Clicking it again should
    // re-open the picker, not lock the node back in — this is the "you
    // cancelled the picker, click the node again" recovery path.
    if (unlocked && baneCount) {
      const stored =
        this.actor.system.specialisations?.[specId]?.baneChoices?.[nodeId] ?? [];
      if (!stored.length) {
        await openBanePicker(this.actor, specId, nodeId, baneCount);
        return;
      }
    }

    await this.actor.update({
      [`system.specialisations.${specId}.nodes.${nodeId}`]: !unlocked,
    });

    // Passive buffs are real ActiveEffects — create/remove alongside the node
    await syncSpecialisationPassive(this.actor, specId, nodeId, !unlocked);

    if (baneCount) {
      if (!unlocked) {
        const applied = await openBanePicker(this.actor, specId, nodeId, baneCount);
        if (!applied) {
          ui.notifications.info(game.i18n.localize("REDSTEEL.Banes.PickLater"));
        }
      } else {
        await clearBaneChoice(this.actor, specId, nodeId);
      }
    }
  }

  static async _chooseWeaponSpec(event) {
    const target = event.target.closest("[data-action='chooseWeaponSpec']");
    if (!target || !this.isEditable) return;
    const itemId = target.dataset.itemId;
    const item = this.actor.items.get(itemId);
    if (!item) return;
    await openWeaponSpecDialog(item);
  }

  static async _toggleNpcOffhand(event, target) {
    const actor = this.actor;
    if (!actor || actor.type !== "npc") return;

    const itemId = target.dataset.itemId;
    const item = actor.items.get(itemId);
    if (!item || item.type !== "weapon") return;

    const isCurrentlyOffhand = item.system.npcOffhand;

    const updates = [];

    // Clear all existing npcOffhand flags
    for (const w of actor.items.filter((i) => i.type === "weapon")) {
      if (w.system.npcOffhand) {
        updates.push({
          _id: w.id,
          "system.npcOffhand": false,
        });
      }
    }

    // If this weapon wasn't active, activate it
    if (!isCurrentlyOffhand) {
      updates.push({
        _id: item.id,
        "system.npcOffhand": true,
      });
    }

    if (updates.length) {
      await actor.updateEmbeddedDocuments("Item", updates);
    }
  }

  static _toggleSchool(event) {
    const header = event.target;
    const list = header.closest(".items-list");
    list.classList.toggle("collapsed");
    header.classList.toggle("collapsed");
  }

  static async _toggleAmmoEquipped(event, target) {
    const doc = this._getEmbeddedDocument(target);
    if (!doc) return;

    const actor = doc.actor;
    const option = doc.system.option;

    const currentlyEquipped = doc.system.equipped ?? false;

    // If turning ON
    if (!currentlyEquipped) {
      // Unequip other ammo of same option
      const others = actor.items.filter(
        (i) =>
          i.type === "ammunition" &&
          i.system.option === option &&
          i._id !== doc._id,
      );

      for (let other of others) {
        if (other.system.equipped) {
          await other.update({ "system.equipped": false });
        }
      }
    }

    await doc.update({
      "system.equipped": !currentlyEquipped,
    });
  }

  /**
   * Equip/unequip an ammunition item. Equipping clears any other ammo sharing
   * the same `option` (one equipped ammo per ammo type).
   * @param {Item} item       The ammunition item
   * @param {boolean} equipped Desired equipped state
   */
  async _equipAmmo(item, equipped) {
    if (!item || item.type !== "ammunition") return;

    if (equipped) {
      const others = this.actor.items.filter(
        (i) =>
          i.type === "ammunition" &&
          i.system.option === item.system.option &&
          i.id !== item.id &&
          i.system.equipped,
      );
      for (const other of others) {
        await other.update({ "system.equipped": false });
      }
    }

    await item.update({ "system.equipped": equipped });
  }

  static _toggleEquipped(event) {
    const target = event.target;
    const isChecked = target.checked;
    const itemId = target.dataset.itemId; // Get the item ID from the data attribute
    const actor = this.actor;

    console.log("Item ID:", itemId); // Log the item ID

    // Fetch the item using the ID
    const item = actor.items.get(itemId); // Use the ID to fetch the actual item object

    if (item) {
      // Update the item's 'equipped' status
      item.update({ "system.equipped": isChecked });

      console.log(`Item is now ${isChecked ? "equipped" : "unequipped"}`);

      // Handle the item's effects (enable/disable based on equip status)
      if (item.effects) {
        // Loop through each individual effect
        for (let effect of item.effects) {
          // Disable effect if unequipped, enable it if equipped
          effect.disabled = !isChecked; // Set disabled state based on equip status

          // Update the individual effect
          effect.update({ disabled: effect.disabled });
          console.log(
            `Effect ${effect.name} updated: ${
              isChecked ? "equipped" : "unequipped"
            }`,
          );
        }
      }
    } else {
      console.log("Item not found!");
    }
  }

  static async _setActiveWeaponSet(event, target) {
    if (this.actor.type !== "character") return;

    await game.redsteel.switchWeaponSet(this.actor);
  }

  _assignWeaponDirect(itemId, set, slot) {
    if (this.actor.type !== "character") return;
    if (!itemId || !set || !slot) return;

    const item = this.actor.items.get(itemId);
    if (!item) return;

    const weaponSets = foundry.utils.deepClone(
      this.actor.system.combat.weaponSets,
    ) ?? {
      1: { main: null, off: null },
      2: { main: null, off: null },
    };

    const updates = {};

    const isShield = item.system.shield;

    // Shields ONLY in off-hand
    if (isShield && slot !== "off") return;

    const currentMain = weaponSets?.[set]?.main;
    const currentOff = weaponSets?.[set]?.off;

    // Prevent same item in both hands (same set only)
    if (slot === "main" && currentOff === itemId) {
      updates[`system.combat.weaponSets.${set}.off`] = null;
    }

    if (slot === "off" && currentMain === itemId) {
      updates[`system.combat.weaponSets.${set}.main`] = null;
    }

    // Two-handed weapon blocks off-hand
    if (slot === "off") {
      const mainId = weaponSets?.[set]?.main;
      if (mainId) {
        const mainItem = this.actor.items.get(mainId);
        const mainIsTwoHanded = this._isEffectivelyTwoHanded(mainItem);

        if (mainIsTwoHanded) return;
      }
    }

    // Two-handed weapon clears off-hand
    if (slot === "main") {
      const isTwoHanded = this._isEffectivelyTwoHanded(item);

      if (isTwoHanded) {
        updates[`system.combat.weaponSets.${set}.off`] = null;
      }
    }

    updates[`system.combat.weaponSets.${set}.${slot}`] = itemId;
    return this.actor.update(updates);
  }

  static async _toggleTwoHandGrip(event, target) {
    const button = target;
    const itemId = button.dataset.itemId;

    const actor = this.actor;
    if (!actor) return;

    const item = actor.items.get(itemId);
    if (!item) return;

    // Capability guard
    if (!item.system.twoHandGrip) return;

    const newMode = item.system.gripMode === "two" ? "one" : "two";

    await item.update({
      "system.gripMode": newMode,
    });
  }

  _isEffectivelyTwoHanded(item) {
    if (!item) return false;
    if (item.system.type === "heavy") return true;
    if (item.system.gripMode === "two") return true;
    if (["crossbow", "bow"].includes(item.system.class)) return true;
    return false;
  }

  _openWeaponEquipMenuFromItem(itemId) {
    const item = this.actor.items.get(itemId);
    if (!item) return;

    const isShield = item.system?.shield === true;
    const isTwoHanded = this._isEffectivelyTwoHanded(item);

    // Determine availability
    const allowMain = !isShield;
    const allowOff = !isTwoHanded;

    // Safety check
    if (!allowMain && !allowOff) return;

    const content = `
  <div class="equip-dialog">
    <div class="equip-header">
      <div></div>
      <div>Set 1</div>
      <div>Set 2</div>
    </div>

    ${
      allowMain
        ? `
    <div class="equip-row">
      <div>Main hand</div>
      <button data-action="equip" data-set="1" data-hand="main">Main</button>
      <button data-action="equip" data-set="2" data-hand="main">Main</button>
    </div>
    `
        : ""
    }

    ${
      allowOff
        ? `
    <div class="equip-row">
      <div>Off hand</div>
      <button data-action="equip" data-set="1" data-hand="off">Off</button>
      <button data-action="equip" data-set="2" data-hand="off">Off</button>
    </div>
    `
        : ""
    }
  </div>
  `;

    new Dialog({
      title: isShield ? "Equip Shield" : "Equip Weapon",
      content,
      buttons: {}, // IMPORTANT: no default buttons
      render: (html) => {
        html[0].addEventListener("click", (event) => {
          const button = event.target.closest("button[data-action='equip']");
          if (!button) return;

          const set = Number(button.dataset.set);
          const hand = button.dataset.hand;

          this._assignWeaponDirect(itemId, set, hand);
        });
      },
    }).render(true);
  }

  _onRightClick(event) {
    // NPCs have no equipment slots — right-clicking gear, a shield or ammo
    // just toggles its equipped state (and effects), lighting it up in the
    // grid. Equipped ammo is what getEquippedAmmo() feeds to ranged attacks.
    if (this.actor.type !== "character") {
      const itemRow = event.target.closest(".item[data-item-id]");
      if (!itemRow) return;
      const item = this.actor.items.get(itemRow.dataset.itemId);
      if (!item) return;

      if (item.type === "ammunition") {
        event.preventDefault();
        this._equipAmmo(item, !item.system.equipped);
        return;
      }

      if (item.type !== "gear") return;
      event.preventDefault();
      this._setArmorEquipped(item, !item.system.equipped);
      return;
    }

    /* ---------------------------------- */
    /* 1️⃣ WEAPON SLOT RIGHT-CLICK (CLEAR) */
    /* ---------------------------------- */
    const slot = event.target.closest(".weapon-slot");
    if (slot) {
      event.preventDefault();

      const set = slot.dataset.set;
      const hand = slot.dataset.slot;

      if (!set || !hand) return;

      this._clearWeaponSlot(set, hand);
      return;
    }

    /* ---------------------------------- */
    /* 2️⃣ ARMOR SLOT RIGHT-CLICK (CLEAR)  */
    /* ---------------------------------- */
    const armorSlot = event.target.closest(".armor-slot");
    if (armorSlot) {
      event.preventDefault();

      const layer = armorSlot.dataset.layer;
      if (!layer) return;

      this._clearArmorSlot(layer);
      return;
    }

    /* ------------------------------------- */
    /* 3️⃣ ACCESSORY SLOT RIGHT-CLICK (CLEAR) */
    /* ------------------------------------- */
    const accessorySlot = event.target.closest(".accessory-slot");
    if (accessorySlot) {
      event.preventDefault();
      const slotKey = accessorySlot.dataset.slotKey;
      if (!slotKey) return;
      this._clearAccessorySlot(slotKey);
      return;
    }

    /* ---------------------------------- */
    /* 4️⃣ AMMO SLOT RIGHT-CLICK (CLEAR)   */
    /* ---------------------------------- */
    const ammoSlot = event.target.closest(".ammo-slot[data-item-id]");
    if (ammoSlot) {
      event.preventDefault();
      const ammo = this.actor.items.get(ammoSlot.dataset.itemId);
      if (ammo) this._equipAmmo(ammo, false);
      return;
    }

    /* ---------------------------------- */
    /* 5️⃣ INVENTORY ITEM RIGHT-CLICK      */
    /* ---------------------------------- */
    const itemRow = event.target.closest(".item[data-item-id]");
    if (!itemRow) return;

    event.preventDefault();

    const itemId = itemRow.dataset.itemId;
    if (!itemId) return;

    const item = this.actor.items.get(itemId);
    if (!item) return;

    if (item.type === "weapon") {
      this._openWeaponEquipMenuFromItem(itemId);
      return;
    }

    // Ammunition equips into the ammo slot; right-click toggles it
    if (item.type === "ammunition") {
      this._equipAmmo(item, !item.system.equipped);
      return;
    }

    // Layered armor equips straight into its slot; right-click toggles it
    if (item.type === "gear" && !item.system.shield) {
      if (isAccessory(item)) {
        const slots = this.actor.system.combat.accessorySlots ?? {};
        const held = ACCESSORY_SLOT_KEYS.find((key) => slots[key] === itemId);
        if (held) this._clearAccessorySlot(held);
        else {
          const free = this._firstFreeAccessorySlot();
          if (free) this._assignAccessoryDirect(itemId, free);
          else ui.notifications.warn(game.i18n.localize("REDSTEEL.Actor.Inventory.AccessorySlotsFull"));
        }
        return;
      }

      const layer = ARMOR_LAYER_SLOTS[item.system.layer];
      if (!layer) return;

      const slots = this.actor.system.combat.armorSlots ?? {};
      if (slots[layer] === itemId) this._clearArmorSlot(layer);
      else this._assignArmorDirect(itemId, layer);
    }
  }

  _clearWeaponSlot(set, hand) {
    if (this.actor.type !== "character") return;
    if (!set || !hand) return;

    const path = `system.combat.weaponSets.${set}.${hand}`;

    console.log("Clearing slot:", path);

    return this.actor.update({
      [path]: null,
    });
  }

  /**
   * Keep `system.equipped` (and the item's effects) in sync with the armor
   * slots, since derived armor data on the actor is driven by `equipped`.
   */
  async _setArmorEquipped(item, equipped) {
    if (!item) return;

    await item.update({ "system.equipped": equipped });

    for (const effect of item.effects) {
      await effect.update({ disabled: !equipped });
    }
  }

  async _assignArmorDirect(itemId, layer) {
    if (this.actor.type !== "character") return;
    if (!itemId || !layer) return;

    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "gear" || item.system.shield) return;

    // Armor only fits the slot matching its own layer
    if (ARMOR_LAYER_SLOTS[item.system.layer] !== layer) return;

    const slots = this.actor.system.combat.armorSlots ?? {};
    if (slots[layer] === itemId) return;

    const current = slots[layer] ? this.actor.items.get(slots[layer]) : null;
    if (current) await this._setArmorEquipped(current, false);
    await this._setArmorEquipped(item, true);

    return this.actor.update({
      [`system.combat.armorSlots.${layer}`]: itemId,
    });
  }

  async _clearArmorSlot(layer) {
    if (this.actor.type !== "character") return;
    if (!layer) return;

    const slots = this.actor.system.combat.armorSlots ?? {};
    const item = slots[layer] ? this.actor.items.get(slots[layer]) : null;
    if (item) await this._setArmorEquipped(item, false);

    return this.actor.update({
      [`system.combat.armorSlots.${layer}`]: null,
    });
  }

  async _assignAccessoryDirect(itemId, slotKey) {
    if (this.actor.type !== "character") return;
    if (!itemId || !ACCESSORY_SLOT_KEYS.includes(slotKey)) return;

    const item = this.actor.items.get(itemId);
    if (!isAccessory(item)) return;

    const slots = this.actor.system.combat.accessorySlots ?? {};
    if (slots[slotKey] === itemId) return;

    const update = {};

    // Slots are interchangeable, so the same item could otherwise sit in two of
    // them at once — vacate whichever slot already holds it.
    for (const key of ACCESSORY_SLOT_KEYS) {
      if (slots[key] === itemId) update[`system.combat.accessorySlots.${key}`] = null;
    }

    // Whatever occupied the target slot goes back to the inventory grid.
    const current = slots[slotKey] ? this.actor.items.get(slots[slotKey]) : null;
    if (current) await this._setArmorEquipped(current, false);
    await this._setArmorEquipped(item, true);

    update[`system.combat.accessorySlots.${slotKey}`] = itemId;
    return this.actor.update(update);
  }

  async _clearAccessorySlot(slotKey) {
    if (this.actor.type !== "character") return;
    if (!ACCESSORY_SLOT_KEYS.includes(slotKey)) return;

    const slots = this.actor.system.combat.accessorySlots ?? {};
    const item = slots[slotKey] ? this.actor.items.get(slots[slotKey]) : null;
    if (item) await this._setArmorEquipped(item, false);

    return this.actor.update({
      [`system.combat.accessorySlots.${slotKey}`]: null,
    });
  }

  /** First empty accessory slot, or null when all ten are full. */
  _firstFreeAccessorySlot() {
    const slots = this.actor.system.combat.accessorySlots ?? {};
    return ACCESSORY_SLOT_KEYS.find((key) => !slots[key]) ?? null;
  }

  /**
   * Golden shield pips under an armor slot, one per point of durabilityMax.
   * Pips 0..durability-1 are lit; toggling a lit pip spends 1 durability,
   * toggling a dim one restores 1, clamped to [0, durabilityMax].
   */
  static async _toggleArmorDurability(event, target) {
    const itemId = target.dataset.itemId;
    const index = Number(target.dataset.index ?? 0);
    const item = this.actor.items.get(itemId);
    if (!item || item.type !== "gear") return;

    const armor = item.system.armor ?? {};
    const current = Number(armor.durability ?? 0);
    const max = Number(armor.durabilityMax ?? 0);

    const active = index < current;
    const durability = Math.max(
      0,
      Math.min(active ? current - 1 : current + 1, max),
    );

    await item.update({ "system.armor.durability": durability });
  }

  /* -------------------------------------------- */
  /*  Currencies (free-form list on the divider)  */
  /* -------------------------------------------- */

  /** Default text color applied to a currency when none is set. */
  static DEFAULT_CURRENCY_COLOR = "#e6c878";

  /**
   * Coerce the stored currencies into a real array. Foundry's form submission
   * expands the `system.currencies.<index>.<field>` inputs into an indexed
   * object ({0:…, 1:…}), so the persisted value may not be an array.
   */
  static _normalizeCurrencies(raw) {
    let list;
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === "object") list = Object.values(raw);
    else list = [];
    // Backfill the text color so older rows (and the template) always have one.
    return list.map((c) => ({ color: RedsteelActorSheet.DEFAULT_CURRENCY_COLOR, ...c }));
  }

  /** Append a new, empty currency row to the actor. */
  static async _addCurrency(event, target) {
    if (!this.isEditable) return;
    const currencies = RedsteelActorSheet._normalizeCurrencies(
      foundry.utils.deepClone(this.actor.system.currencies ?? []),
    );
    currencies.push({
      label: "",
      value: 0,
      color: RedsteelActorSheet.DEFAULT_CURRENCY_COLOR,
    });
    await this.actor.update({ "system.currencies": currencies });
  }

  /** Remove the currency row at data-index. */
  static async _deleteCurrency(event, target) {
    if (!this.isEditable) return;
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) return;
    const currencies = RedsteelActorSheet._normalizeCurrencies(
      foundry.utils.deepClone(this.actor.system.currencies ?? []),
    );
    if (index < 0 || index >= currencies.length) return;
    currencies.splice(index, 1);
    await this.actor.update({ "system.currencies": currencies });
  }

  /**
   * Set the inventory grid category filter (all / weapon / gear / alchemy /
   * item) and re-render to show only that category.
   */
  static _setInventoryFilter(event, target) {
    const filter = target.dataset.filter ?? "all";
    if (!INVENTORY_CATEGORIES[filter]) return;
    this._inventoryFilter = filter;
    this.render();
  }

  /** Set the active rank filter pill on the Spells tab and re-render. */
  static _setSpellRank(event, target) {
    const rank = target.dataset.rank;
    if (!rank) return;
    this._spellRankFilter = rank;
    this.render();
  }

  /** Set the active rank filter pill on the Miracles tab and re-render. */
  static _setMiracleRank(event, target) {
    const rank = target.dataset.rank;
    if (!rank) return;
    this._miracleRankFilter = rank;
    this.render();
  }

  /** Select a recipe row in the Alchemy tab (transient sheet state). */
  static _selectRecipe(event, target) {
    const itemId = target.closest("[data-item-id]")?.dataset.itemId;
    if (!itemId) return;
    this._alchemySelectedRecipe =
      this._alchemySelectedRecipe === itemId ? null : itemId;
    this.render();
  }

  /**
   * Boil herbs down into a substance. Opens a small dialog showing the herbs
   * on hand and how many doses they buy, then rolls once for the whole batch.
   */
  static async _brewSubstance(event, target) {
    this.#readAlchemyControls();
    const key = target.closest("[data-substance]")?.dataset.substance;
    const def = SUBSTANCES.find((s) => s.key === key);
    if (!def) return;

    const i18n = game.i18n;
    const mods = getAlchemistSubstanceModifiers(this.actor, key);
    const herbCost = Math.max(
      1,
      SUBSTANCE_HERB_COST - (Number(mods.herbDiscount) || 0),
    );
    const herbs = getHerbCount(this.actor, key);
    const max = getMaxSubstanceBatch(this.actor, key, herbCost);
    if (max < 1) {
      ui.notifications.warn(
        i18n.format("REDSTEEL.Alchemy.Substance.NoHerbs", {
          name: def.name,
          cost: herbCost,
          have: herbs,
        }),
      );
      return;
    }

    const station = STATIONS.find((s) => s.key === this._alchemyStation);
    const stationName = i18n.localize(station?.labelKey ?? "");
    const stationMod = station?.mod ?? 0;
    const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);

    const DialogV2 = foundry.applications.api.DialogV2;
    const amount = await DialogV2.wait({
      window: { title: i18n.format("REDSTEEL.Alchemy.Substance.DialogTitle", { name: def.name }) },
      content: `
        <form>
          <p style="display:flex; align-items:center; gap:8px;">
            <img src="${def.icon}" width="36" height="36" style="border:none; flex:0 0 auto;">
            <span>${i18n.format("REDSTEEL.Alchemy.Substance.Have", { count: herbs, cost: herbCost })}</span>
          </p>
          <label style="display:flex; align-items:center; gap:8px;">
            <span style="flex:1;">${i18n.localize("REDSTEEL.Alchemy.Substance.Doses")} (max ${max})</span>
            <input type="number" name="brew-amount" value="1" min="1" max="${max}" step="1" style="width:70px;">
          </label>
          <p style="font-size:12px; opacity:0.8; margin-top:6px;">
            ${i18n.localize("REDSTEEL.Alchemy.Chat.UsedStation")}: ${stationName} (${fmt(stationMod)}%)<br>
            ${i18n.localize("REDSTEEL.Alchemy.Chat.Difficulty")}: ${fmt(SUBSTANCE_CRAFT_MOD)}%
            (${fmt(SUBSTANCE_BATCH_MOD)}% ${i18n.localize("REDSTEEL.Alchemy.Substance.BatchNote")})
          </p>
          <p style="font-size:12px; opacity:0.8;">${
            mods.guaranteed
              ? i18n.localize("REDSTEEL.Alchemy.Chat.Boon.Guaranteed")
              : i18n.localize("REDSTEEL.Alchemy.Substance.WasteWarning")
          }</p>
        </form>`,
      buttons: [
        {
          action: "brew",
          label: i18n.localize("REDSTEEL.Alchemy.Substance.Brew"),
          icon: "fas fa-mortar-pestle",
          default: true,
          callback: (ev, button, dialog) => {
            const root = dialog?.element ?? button.form;
            return root.querySelector('input[name="brew-amount"]')?.value ?? "1";
          },
        },
        { action: "cancel", label: i18n.localize("Cancel") },
      ],
      rejectClose: false,
    });
    if (!amount || amount === "cancel") return;

    const outcome = await brewSubstance(this.actor, key, {
      amount: Math.min(Number(amount) || 1, max),
      stationKey: this._alchemyStation,
    });
    if (!outcome.ok) {
      ui.notifications.warn(outcome.reason);
      return;
    }
    this._alchemyLastOutcome = outcome;
    this.render();
  }

  /** Read station + amount from the Alchemy tab controls into sheet state. */
  #readAlchemyControls() {
    const station = this.element.querySelector(".alch-station")?.value;
    if (station) this._alchemyStation = station;
    const amount = Number(this.element.querySelector(".alch-amount")?.value);
    if (Number.isFinite(amount) && amount >= 1) {
      this._alchemyAmount = Math.floor(amount);
    }
  }

  /** Craft the selected recipe with the chosen station and amount. */
  static async _craftRecipe(event, target) {
    this.#readAlchemyControls();
    const recipe = this.actor.items.get(this._alchemySelectedRecipe);
    if (!recipe) {
      ui.notifications.warn(
        game.i18n.localize("REDSTEEL.Alchemy.Warn.NoRecipeSelected"),
      );
      return;
    }
    const maxBatch = MAX_BATCH[recipe.system.outputType ?? "potion"] ?? 5;
    const amount = Math.min(this._alchemyAmount, maxBatch);

    const outcome = await craftRecipe(this.actor, recipe, {
      amount,
      stationKey: this._alchemyStation,
    });
    if (!outcome.ok) {
      ui.notifications.warn(outcome.reason);
      return;
    }
    this._alchemyLastOutcome = outcome;
    this.render();
  }

  /**
   * Spend an alchemy/universal reroll to re-roll the last FAILED craft.
   * Ingredients are not consumed again; a new success delivers the potions.
   */
  static async _rerollCraft(event, target) {
    this.#readAlchemyControls();
    const last = this._alchemyLastOutcome;
    if (!last?.ok || last.success) return;
    const recipe = this.actor.items.get(last.recipeId);
    if (!recipe) return;

    const eligible = getEligibleRerolls(this.actor, "alchemy");
    if (!eligible.length) {
      ui.notifications.info(
        game.i18n.localize("REDSTEEL.Alchemy.Warn.NoRerolls"),
      );
      return;
    }
    const spent = await consumeReroll(
      this.actor,
      eligible[0].itemId,
      eligible[0].poolIndex,
    );
    if (!spent) return;

    try {
      await scheduleRerollRefresh(this.actor, eligible[0], { critFailure: false });
    } catch (err) {
      console.warn("Redsteel | Calendaria scheduling failed", err);
    }

    this._alchemyLastOutcome = await rerollCraft(this.actor, recipe, last, {
      stationKey: this._alchemyStation,
    });
    this.render();
  }

  /**
   * Clicking the race field in the header. With no race yet, opens the race
   * picker. With a race already present, opens its choice-resolution dialog
   * if it has choice groups; otherwise re-opens the picker so a choice-less
   * race can be swapped directly.
   */
  static async _selectRace(event, target) {
    const raceItem = this.actor.items.find((i) => i.type === "race");
    if (!raceItem) {
      await openRacePicker(this.actor);
      return;
    }
    if (getRaceChoiceGroups(raceItem).length) {
      await openRaceChoicesDialog(raceItem);
    } else {
      await openRacePicker(this.actor);
    }
  }

  /** @override */
  static PARTS = {
    header: {
      template: "systems/redsteel/templates/actor/header.hbs",
    },
    tabs: {
      // Foundry-provided generic template
      template: "templates/generic/tab-navigation.hbs",
    },
    skills: {
      template: "systems/redsteel/templates/actor/skills.hbs",
    },
    features: {
      template: "systems/redsteel/templates/actor/features.hbs",
    },
    specialisations: {
      template: "systems/redsteel/templates/actor/specialisations.hbs",
    },
    biography: {
      template: "systems/redsteel/templates/actor/biography.hbs",
    },
    inventory: {
      template: "systems/redsteel/templates/actor/inventory.hbs",
    },
    alchemy: {
      template: "systems/redsteel/templates/actor/alchemy.hbs",
    },
    abilities: {
      template: "systems/redsteel/templates/actor/abilities.hbs",
    },
    spells: {
      template: "systems/redsteel/templates/actor/spells.hbs",
    },
    miracles: {
      template: "systems/redsteel/templates/actor/miracles.hbs",
    },
    effects: {
      template: "systems/redsteel/templates/actor/effects.hbs",
    },
    config: {
      template: "systems/redsteel/templates/actor/config.hbs",
    },
  };

  /** @override */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    options.parts = ["header", "tabs"];
    // Don't show the other tabs if only limited view
    if (this.document.limited) {
      options.parts.push("biography");
      return;
    }
    // Control which parts show based on document subtype
    switch (this.document.type) {
      case "character":
        options.parts.push(
          "skills",
          "features",
          "specialisations",
          "inventory",
          "alchemy",
          "abilities",
          "spells",
          "miracles",
          "biography",
          "effects",
          "config",
        );
        break;
      case "npc":
        options.parts.push(
          "biography",
          "inventory",
          "abilities",
          "spells",
          "miracles",
          "effects",
        );
        break;
    }
  }

  /* -------------------------------------------- */

  /**
   * @override
   * Foundry expands the `system.currencies.<index>.<field>` inputs into an
   * indexed object on submit. Coerce it back to an array so the stored value
   * stays array-shaped (otherwise add/delete via splice/push break).
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const submitData = super._prepareSubmitData(
      event,
      form,
      formData,
      updateData,
    );
    const currencies = submitData?.system?.currencies;
    if (currencies && !Array.isArray(currencies)) {
      submitData.system.currencies =
        RedsteelActorSheet._normalizeCurrencies(currencies);
    }
    return submitData;
  }

  /** @override */
  async _prepareContext(options) {
    // Output initialization
    const context = {
      // Validates both permissions and compendium status
      editable: this.isEditable,
      owner: this.document.isOwner,
      limited: this.document.limited,
      // Add the actor document.
      actor: this.actor,
      // Add the actor's data to context.data for easier access, as well as flags.
      system: this.actor.system,
      flags: this.actor.flags,
      // Adding a pointer to CONFIG.REDSTEEL
      config: CONFIG.REDSTEEL,
      skillsEditMode: this.isEditable && this._skillsEditMode,
      tabs: this._getTabs(options.parts),
    };

    // Offloading context prep to a helper function
    this._prepareItems(context);

    // Absorb pools for the Config tab. Read straight off the effects so the
    // rows always reflect the live pool (`flags.redsteel.stacks`).
    context.shields = this.actor.effects
      .filter((e) => e.getFlag("redsteel", "shield"))
      .map((e) => {
        const cfg = e.getFlag("redsteel", "shield");
        return {
          id: e.id,
          name: e.name,
          img: e.img,
          value: Number(e.getFlag("redsteel", "stacks")) || 0,
          max: Number(cfg.max) || 0,
          matchClass: cfg.matchClass ?? "",
          matchTypes: (cfg.matchTypes ?? []).join(", "),
          // Only Elementární štít offers a swap; the picker is hidden otherwise.
          elementChoices: (cfg.elementChoices ?? []).map((types) => ({
            value: types.join(","),
            label: types.join(" / "),
            selected:
              types.join(",") === (cfg.matchTypes ?? []).join(","),
          })),
        };
      });
    context.weaponSets = {};
    // Resolve weapon sets -> Item documents (VIEW DATA ONLY)
    if (this.actor.type === "character") {
      for (const [setId, slots] of Object.entries(
        this.actor.system.combat.weaponSets ?? {},
      )) {
        const mainItem = slots.main
          ? (this.actor.items.get(slots.main) ?? null)
          : null;

        const offItem = slots.off
          ? (this.actor.items.get(slots.off) ?? null)
          : null;

        const mainIsTwoHanded = this._isEffectivelyTwoHanded(mainItem);

        const offIsShield = !!offItem && offItem.system?.shield;

        // Equipped shields get the same durability pips as layered armor
        const offDurability = offIsShield
          ? Number(offItem.system.armor?.durability ?? 0)
          : 0;
        const offDurabilityMax = offIsShield
          ? Number(offItem.system.armor?.durabilityMax ?? 0)
          : 0;
        const offDurabilityPips = [];
        for (let i = 0; i < offDurabilityMax; i++) {
          offDurabilityPips.push({ index: i, active: i < offDurability });
        }

        context.weaponSets[setId] = {
          main: mainItem,
          off: offItem,
          mainIsTwoHanded,
          offIsShield,
          offDurability,
          offDurabilityMax,
          offDurabilityPips,
          offHasDurability:
            offIsShield && !mainIsTwoHanded && offDurabilityMax > 0,
        };
      }
    }

    // Resolve armor slots -> Item documents (VIEW DATA ONLY)
    context.armorSlots = {};
    if (this.actor.type === "character") {
      const slots = this.actor.system.combat.armorSlots ?? {};
      for (const [label, layer] of Object.entries(ARMOR_LAYER_SLOTS)) {
        const item = slots[layer]
          ? (this.actor.items.get(slots[layer]) ?? null)
          : null;

        const durability = Number(item?.system.armor?.durability ?? 0);
        const durabilityMax = Number(item?.system.armor?.durabilityMax ?? 0);

        // One shield pip per point of max durability; lit pips = current value
        const durabilityPips = [];
        for (let i = 0; i < durabilityMax; i++) {
          durabilityPips.push({ index: i, active: i < durability });
        }

        context.armorSlots[layer] = {
          item,
          label,
          durability,
          durabilityMax,
          durabilityPips,
          hasDurability: !!item && durabilityMax > 0,
        };
      }
    }

    // Resolve accessory slots -> Item documents (VIEW DATA ONLY)
    context.accessorySlots = [];
    if (this.actor.type === "character") {
      const slots = this.actor.system.combat.accessorySlots ?? {};
      context.accessorySlots = ACCESSORY_SLOT_KEYS.map((key) => ({
        key,
        item: slots[key] ? (this.actor.items.get(slots[key]) ?? null) : null,
      }));
    }

    // Inventory grid: everything carried that isn't currently equipped.
    // Equipped weapons/armor/shields/ammo live in the slots above and take
    // no space in the grid (RPG-style).
    const STACKABLE_TYPES = ["consumable", "ammunition", "item"];
    // Only characters have equipment slots to hold equipped gear; NPCs keep
    // everything in the grid so it stays reachable.
    const equippedIds =
      this.actor.type === "character"
        ? this._getEquippedItemIds()
        : new Set();

    // Category filter (defaults to "all"); the active category decides which
    // item types show in the grid.
    const filter = INVENTORY_CATEGORIES[this._inventoryFilter]
      ? this._inventoryFilter
      : "all";
    const GRID_TYPES = INVENTORY_CATEGORIES[filter].types;
    context.inventoryFilter = filter;
    context.inventoryFilters = Object.entries(INVENTORY_CATEGORIES).map(
      ([key, def]) => ({
        key,
        label: game.i18n.localize(def.labelKey),
        active: key === filter,
      }),
    );

    context.inventory = this.actor.items
      .filter((i) => GRID_TYPES.includes(i.type) && !equippedIds.has(i.id))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0))
      .map((i) => {
        const stackable = STACKABLE_TYPES.includes(i.type);
        const quantity = Number(i.system.quantity ?? 0);
        return {
          item: i,
          stackable,
          quantity,
          showQty: stackable && quantity > 1,
          equipped: !!i.system.equipped,
        };
      });

    // Pad the grid with empty slots: fill to a multiple of the column count
    // with at least one spare row, minimum 32 cells.
    const GRID_COLS = 12;
    const occupied = context.inventory.length;
    const totalCells = Math.max(
      GRID_COLS * 4,
      (Math.ceil(occupied / GRID_COLS) + 1) * GRID_COLS,
    );
    context.inventoryEmptySlots = Array.from({
      length: Math.max(0, totalCells - occupied),
    });

    // Equipped ammo surfaced as slot(s) in the top loadout area.
    context.equippedAmmo = this.actor.items
      .filter((i) => i.type === "ammunition" && i.system.equipped)
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));

    // Free-form currency list shown on the equipment / inventory divider.
    context.currencies = RedsteelActorSheet._normalizeCurrencies(
      this.actor.system.currencies,
    );

    return context;
  }

  /**
   * Collect the ids of every item that is currently "equipped" and therefore
   * occupies a slot rather than the inventory grid: weapons in weapon sets,
   * armor in layer slots, equipped shields, and any item flagged
   * `system.equipped` (covers NPC weapons/armor and equipped ammunition).
   * @returns {Set<string>}
   */
  _getEquippedItemIds() {
    return this.actor.getEquippedItemIds();
  }

  /** @override */
  async _preparePartContext(partId, context) {
    switch (partId) {
      case "features":
      case "skills":
        context.activeSkillsSubtab = this.tabGroups["skills-subtabs"] ?? null;
        context.tab = context.tabs[partId];
        break;
      case "specialisations":
        context.tab = context.tabs[partId];
        context.specTrees = prepareSpecialisationTrees(this.actor);
        context.activeSpecSubtab =
          this.tabGroups["specialisations-subtabs"] ?? null;
        break;
      case "alchemy": {
        context.tab = context.tabs[partId];
        // Substance strip: current stock of the six substances, plus the herbs
        // held for each — the tile doubles as the "boil herbs down" button.
        const subMods = getAlchemistSubstanceModifiers(this.actor, null);
        const herbCost = Math.max(
          1,
          SUBSTANCE_HERB_COST - (Number(subMods.herbDiscount) || 0),
        );
        context.alchSubstances = SUBSTANCES.map((def) => ({
          key: def.key,
          label: def.name,
          code: def.code,
          icon: def.icon,
          color: def.color,
          qty: getSubstanceCount(this.actor, def.key),
          herbs: getHerbCount(this.actor, def.key),
          herbCost,
          canBrew: getMaxSubstanceBatch(this.actor, def.key, herbCost) > 0,
        }));
        // Owned recipes, with the transient selection restored.
        const recipes = [...(this.actor.itemTypes.recipe ?? [])].sort(
          (a, b) => (a.sort || 0) - (b.sort || 0),
        );
        if (
          this._alchemySelectedRecipe &&
          !recipes.some((r) => r.id === this._alchemySelectedRecipe)
        ) {
          this._alchemySelectedRecipe = null;
        }
        context.alchRecipes = recipes.map((item) => ({
          item,
          selected: item.id === this._alchemySelectedRecipe,
        }));
        const selected =
          recipes.find((r) => r.id === this._alchemySelectedRecipe) ?? null;
        context.alchStations = STATIONS.map((s) => ({
          key: s.key,
          label: game.i18n.localize(s.labelKey),
          modLabel: `${s.mod >= 0 ? "+" : ""}${s.mod}%`,
          selected: s.key === this._alchemyStation,
        }));
        context.alchMaxAmount =
          MAX_BATCH[selected?.system.outputType ?? "potion"] ?? 5;
        context.alchAmount = Math.min(
          Math.max(1, this._alchemyAmount),
          context.alchMaxAmount,
        );
        context.alchCanCraft = !!selected && !!selected.system.resultUuid;
        // Alchemist boons for the selected recipe's family, shown before the
        // roll so the player can see what the tree is actually contributing.
        context.alchBoons = selected
          ? describeCraftBoons(getAlchemistCraftModifiers(this.actor, selected))
          : [];
        // Reroll only re-opens a FAILED craft, and only with an eligible pool.
        const last = this._alchemyLastOutcome;
        context.alchCanReroll =
          !!last?.ok &&
          !last.success &&
          !last.isSubstance &&
          getEligibleRerolls(this.actor, "alchemy").length > 0;
        if (last?.ok) {
          context.alchAnnouncement = {
            success: last.success,
            text: last.success
              ? `${game.i18n.localize("REDSTEEL.Alchemy.Chat.Success")} — ${game.i18n.format(
                  "REDSTEEL.Alchemy.Chat.Created",
                  { count: last.created, name: last.resultName },
                )}`
              : `${game.i18n.localize("REDSTEEL.Alchemy.Chat.Failure")} — ${game.i18n.localize(
                  "REDSTEEL.Alchemy.Chat.IngredientsWasted",
                )}`,
            detail: `d100: ${last.d100} · ${game.i18n.localize(
              "REDSTEEL.Alchemy.Chat.Margin",
            )} ${last.margin >= 0 ? "+" : ""}${last.margin}`,
          };
        } else {
          context.alchAnnouncement = null;
        }
        break;
      }
      case "abilities":
        context.tab = context.tabs[partId];
        context.abilityCards = context.ability.map((i) =>
          buildSpellCard(i, "ability"),
        );
        break;
      case "spells": {
        context.tab = context.tabs[partId];
        context.activeSpellSubtab = this.tabGroups["spells-subtabs"] ?? null;

        const SPELL_RANKS = [
          "wild",
          "apprentice",
          "expert",
          "master",
          "grandmaster",
        ];
        const bySchool = {};
        for (const spell of context.spells) {
          const school = spell.system?.type;
          if (!school) continue;
          (bySchool[school] ??= []).push(spell);
        }
        // Note: switching between school sub-tabs only toggles DOM classes
        // (ApplicationV2#changeTab does not re-render — verified against the
        // V14 API docs), so every school section must carry its own correct
        // default active rank rather than relying on a single value computed
        // only for whichever school happened to be active at render time.
        context.spellSchools = Object.entries(bySchool)
          .map(([school, spellsInSchool]) => {
            const rankGroups = buildRankGroups(
              spellsInSchool,
              SPELL_RANKS,
              "spell",
            );
            const activeRank = rankGroups.some(
              (rg) => rg.rank === this._spellRankFilter,
            )
              ? this._spellRankFilter
              : (rankGroups[0]?.rank ?? null);
            return {
              school,
              label: game.i18n.localize(
                `REDSTEEL.Actor.Character.schools.${school}.label`,
              ),
              rankGroups,
              activeRank,
            };
          })
          .filter((entry) => entry.rankGroups.length > 0);

        const activeSchool =
          context.spellSchools.find(
            (s) => s.school === context.activeSpellSubtab,
          ) ?? context.spellSchools[0];
        context.activeSpellRank = activeSchool?.activeRank ?? null;
        break;
      }
      case "miracles": {
        context.tab = context.tabs[partId];

        const MIRACLE_RANKS = ["novice", "acolyte", "cleric"];
        const miracleSpells = context.spells.filter(
          (s) => s.system?.option === "divine",
        );
        context.miracleRankGroups = buildRankGroups(
          miracleSpells,
          MIRACLE_RANKS,
          "miracle",
        );
        context.activeMiracleRank = context.miracleRankGroups.length
          ? (context.miracleRankGroups.some(
              (rg) => rg.rank === this._miracleRankFilter,
            )
              ? this._miracleRankFilter
              : context.miracleRankGroups[0].rank)
          : null;
        break;
      }
      case "inventory":
      case "config":
        context.tab = context.tabs[partId];
        break;
      case "biography":
        context.tab = context.tabs[partId];
        // Enrich biography info for display
        // Enrichment turns text like `[[/r 1d20]]` into buttons
        context.enrichedBiography = await TextEditor.enrichHTML(
          this.actor.system.biography,
          {
            // Whether to show secret blocks in the finished html
            secrets: this.document.isOwner,
            // Data to fill in for inline rolls
            rollData: this.actor.getRollData(),
            // Relative UUID resolution
            relativeTo: this.actor,
          },
        );
        break;
      case "effects":
        context.tab = context.tabs[partId];
        // Prepare active effects
        context.effects = prepareActiveEffectCategories(
          // A generator that returns all effects stored on the actor
          // as well as any items
          this.actor.allApplicableEffects(),
        );
        break;
    }
    return context;
  }

  /**
   * Generates the data for the generic tab navigation template
   * @param {string[]} parts An array of named template parts to render
   * @returns {Record<string, Partial<ApplicationTab>>}
   * @protected
   */
  _getTabs(parts) {
    // If you have sub-tabs this is necessary to change
    const tabGroup = "primary";
    const tabSpellGroup = "spells-subtabs";
    // Default tab for first time it's rendered this session
    if (!this.tabGroups[tabGroup]) {
      this.tabGroups[tabGroup] = parts.includes("skills")
        ? "skills"
        : "biography";
    }
    return parts.reduce((tabs, partId) => {
      const tab = {
        cssClass: "",
        group: tabGroup,
        // Matches tab property to
        id: "",
        // FontAwesome Icon, if you so choose
        icon: "",
        // Run through localization
        label: "REDSTEEL.Actor.Tabs.",
      };
      switch (partId) {
        case "header":
        case "tabs":
          return tabs;
        case "biography":
          tab.id = "biography";
          tab.label += "Biography";
          break;
        case "config":
          tab.id = "config";
          tab.label += "Config";
          break;
        case "skills":
          tab.id = "skills";
          tab.label += "Skills";
          break;
        case "specialisations": {
          tab.id = "specialisations";
          tab.label += "Specialisations";
          // Only show the tab when at least one specialisation is active
          const specs = this.actor.system.specialisations ?? {};
          const anyActive = Object.keys(
            CONFIG.REDSTEEL.specialisations ?? {},
          ).some((id) => specs[id]?.active);
          if (!anyActive) tab.cssClass += " hidden";
          break;
        }
        case "features":
          tab.id = "features";
          tab.label += "Features";
          break;
        case "abilities":
          tab.id = "abilities";
          tab.label += "Abilities";
          break;
        case "inventory":
          tab.id = "inventory";
          tab.label += "Inventory";
          break;
        case "alchemy":
          tab.id = "alchemy";
          tab.label += "Alchemy";
          // Only characters trained in Alchemy see the tab.
          if (!(Number(this.actor.system.skills?.alchemy?.value) > 0)) {
            tab.cssClass += " hidden";
          }
          break;
        case "spells":
          tab.id = "spells";
          tab.label += "Spells";

          // Shown for mages (magicPotential) and for Blood mages — the Blood
          // School specialisation is its own path to spellcasting, independent
          // of magicPotential.
          {
            const hasMagic =
              this.actor.system.magicPotential &&
              this.actor.system.magicPotential > 0;
            const bloodActive =
              !!this.actor.system.specialisations?.bloodSchool?.active;
            if (!hasMagic && !bloodActive) {
              tab.cssClass += " hidden"; // Add 'hidden' class to tab
            }
          }
          break;
        case "miracles":
          tab.id = "miracles";
          tab.label += "Miracles";
          // Check if Priest exists and is greater than 0
          if (!this.actor.system.priest || this.actor.system.priest <= 0) {
            tab.cssClass += " hidden"; // Add 'hidden' class to tab
          }
          break;
        case "effects":
          tab.id = "effects";
          tab.label += "Effects";
          break;

        case "fire":
          tab.id = "fire";
          tab.label += "Fire";
          tab.group = tabSpellGroup;
          break;

        case "earth":
          tab.id = "earth";
          tab.label += "Earth";
          tab.group = tabSpellGroup;
          break;

        case "water":
          tab.id = "water";
          tab.label += "Water";
          tab.group = tabSpellGroup;
          break;

        case "air":
          tab.id = "air";
          tab.label += "Air";
          tab.group = tabSpellGroup;
          break;

        case "spirit":
          tab.id = "spirit";
          tab.label += "Spirit";
          tab.group = tabSpellGroup;
          break;

        case "body":
          tab.id = "body";
          tab.label += "Body";
          tab.group = tabSpellGroup;
          break;

        case "dark":
          tab.id = "dark";
          tab.label += "Dark";
          tab.group = tabSpellGroup;
          break;
      }
      if (this.tabGroups[tab.group] === tab.id) {
        tab.cssClass = `${tab.cssClass} active`.trim();
      }

      tabs[partId] = tab;
      return tabs;
    }, {});
  }

  /**
   * Organize and classify Items for Actor sheets.
   *
   * @param {object} context The context object to mutate
   */
  _prepareItems(context) {
    // Initialize containers.
    // You can just use `this.document.itemTypes` instead
    // if you don't need to subdivide a given type like
    // this sheet does with spells
    const features = [];
    const weapon = [];
    const race = [];
    const gear = [];
    const ammunition = [];
    const ability = [];
    const consumables = [];
    const items = [];
    const spells = [];
    const supplies = [];

    // Iterate through items, allocating to containers
    for (let i of this.document.items) {
      // Append to weapon.
      if (i.type === "weapon") {
        weapon.push(i);
      }
      // Append to features.
      else if (i.type === "feature") {
        features.push(i);
      }
      // Append to gear.
      else if (i.type === "gear") {
        gear.push(i);
      }
      // Append to consumable.
      else if (i.type === "consumable") {
        consumables.push(i);
        supplies.push(i);
      }
      // Append to item.
      else if (i.type === "item") {
        items.push(i);
      }
      // Append to ammunition.
      else if (i.type === "ammunition") {
        ammunition.push(i);
        supplies.push(i);
      }
      // Append to abilities.
      else if (i.type === "ability") {
        ability.push(i);
      }
      // Append to spells.
      else if (i.type === "spell") {
        spells.push(i);
      }
      // Append to race.
      else if (i.type === "race") {
        race.push(i);
      }
    }

    // Sort then assign
    context.weapon = weapon.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.gear = gear.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.features = features.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.consumables = consumables.sort(
      (a, b) => (a.sort || 0) - (b.sort || 0),
    );
    context.items = items.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.ammunition = ammunition.sort(
      (a, b) => (a.sort || 0) - (b.sort || 0),
    );
    context.ability = ability.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.spells = spells.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.supplies = supplies.sort((a, b) => (a.sort || 0) - (b.sort || 0));
    context.race = race.sort((a, b) => (a.sort || 0) - (b.sort || 0));

    // Flattened reroll pools across all features, one entry per pool, for the
    // merged reroll display on the Features tab.
    context.rerollPools = getActorRerollPools(this.actor);
  }

  /**
   * Sheet height (px) used while the Specialisations tab is active. The
   * constellation tree fills the panel better at a slightly shorter sheet than
   * the default; every other primary tab restores DEFAULT_OPTIONS height.
   */
  static SPEC_TAB_HEIGHT = 1100;

  /** Resize the sheet to suit the active primary tab. */
  #syncPrimaryTabHeight(tab) {
    const height =
      tab === "specialisations"
        ? this.constructor.SPEC_TAB_HEIGHT
        : this.constructor.DEFAULT_OPTIONS.position.height;
    if (this.position.height !== height) this.setPosition({ height });
  }

  /** @override */
  changeTab(tab, group, options) {
    super.changeTab(tab, group, options);
    if (group === "primary") this.#syncPrimaryTabHeight(tab);
  }

  /**
   * Actions performed after any render of the Application.
   * Post-render steps are not awaited by the render process.
   * @param {ApplicationRenderContext} context      Prepared context data
   * @param {RenderOptions} options                 Provided render options
   * @protected
   * @override
   */
  /**
   * Config-tab shield rows. These cannot be declarative `name="system…"`
   * inputs or ApplicationV2 click actions: the pool lives on an Active Effect
   * flag, and the controls are `change` events on a number input and two
   * selects. Everything writes through the effect document.
   */
  #bindShieldControls(root) {
    const effectFor = (el) =>
      this.actor.effects.get(el.dataset.effectId ?? "");

    // Absorb remaining. Mirrored to the status counter so the token matches.
    root
      .querySelectorAll('[data-action="shieldValue"]')
      .forEach((el) =>
        el.addEventListener("change", async (event) => {
          const effect = effectFor(event.currentTarget);
          if (!effect) return;
          const value = Math.max(0, Number(event.currentTarget.value) || 0);
          if (value <= 0) return effect.delete();
          await effect.update({
            "flags.redsteel.stacks": value,
            "flags.statuscounter.value": value,
          });
        }),
      );

    // Elementární štít: Free Action element swap.
    root
      .querySelectorAll('[data-action="shieldElement"]')
      .forEach((el) =>
        el.addEventListener("change", async (event) => {
          const effect = effectFor(event.currentTarget);
          if (!effect) return;
          const types = String(event.currentTarget.value)
            .split(",")
            .filter(Boolean);
          const config = effect.getFlag("redsteel", "shield") ?? {};
          await effect.setFlag("redsteel", "shield", {
            ...config,
            matchTypes: types,
          });
        }),
      );

    root
      .querySelectorAll('[data-action="shieldRemove"]')
      .forEach((el) =>
        el.addEventListener("click", async (event) => {
          event.preventDefault();
          await effectFor(event.currentTarget)?.delete();
        }),
      );

    // Grant one by hand. Goes through applyEffect so the pool is still baked
    // from Spell Power and the shields still override one another.
    root
      .querySelectorAll('[data-action="shieldAdd"]')
      .forEach((el) =>
        el.addEventListener("change", async (event) => {
          const id = event.currentTarget.value;
          event.currentTarget.value = "";
          if (!id) return;
          await game.redsteel.applyEffect(this.actor, id, {
            caster: this.actor,
          });
        }),
      );
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    // Keep the sheet height in step with the active tab across re-renders
    // (e.g. reopening on, or toggling a node within, the Specialisations tab).
    if (this.tabGroups?.primary)
      this.#syncPrimaryTabHeight(this.tabGroups.primary);

    this.#dragDrop.forEach((d) => d.bind(this.element));
    this.#disableOverrides();

    const root =
      this.element instanceof HTMLElement ? this.element : this.element[0];
    if (root) {
      root.removeEventListener("contextmenu", this._boundRightClick);
      root.addEventListener("contextmenu", this._boundRightClick);
      this.#bindShieldControls(root);
      // Lets the delegated tooltip engine resolve the owning actor without
      // reaching into application-registry internals.
      root.dataset.ttActorUuid = this.actor.uuid;
      // Marks the window box for the tooltip engine, which parks its panels in
      // the free margin beside this rectangle instead of over the sheet.
      root.dataset.ttWindow = "";
    }

    // You may want to add other special handling here
    // Foundry comes with a large number of utility classes, e.g. SearchFilter
    // That you may want to implement yourself.
    // Use standard DOM method to select input elements
    console.log("Restoring scroll:", this._skillsScrollTop);

    const scrollable = this.element.querySelector(".tab.skills");
    if (scrollable) {
      scrollable.scrollTop = this._skillsScrollTop ?? 0;
    }
  }

  /**************
   *
   *   ACTIONS
   *
   **************/

  /**
   * Handle changing a Document's image.
   *
   * @this RedsteelActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @returns {Promise}
   * @protected
   */
  static async _onEditImage(event, target) {
    const attr = target.dataset.edit;
    const current = foundry.utils.getProperty(this.document, attr);
    const { img } =
      this.document.constructor.getDefaultArtwork?.(this.document.toObject()) ??
      {};
    const fp = new FilePicker({
      current,
      type: "image",
      redirectToRoot: img ? [img] : [],
      callback: (path) => {
        this.document.update({ [attr]: path });
      },
      top: this.position.top + 40,
      left: this.position.left + 10,
    });
    return fp.browse();
  }

  /**
   * Renders an embedded document's sheet
   *
   * @this RedsteelActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _viewDoc(event, target) {
    const doc = this._getEmbeddedDocument(target);
    doc.sheet.render(true);
  }

  /**
   * Handles item deletion
   *
   * @this RedsteelActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _deleteDoc(event, target) {
    const doc = this._getEmbeddedDocument(target);
    await doc.delete();
  }

  /**
   * Handles item add and subtract
   *
   * @this RedsteelActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _adjustNumericField(event, target) {
    const doc = this._getEmbeddedDocument(target);
    if (!doc) return;

    const path = target.dataset.path;
    let delta = Number(target.dataset.delta ?? 1);

    if (!path) return;

    // Hold Shift to adjust in steps of 5
    if (event.shiftKey) delta *= 5;

    const current = Number(foundry.utils.getProperty(doc, path) ?? 0);
    let newValue = Math.max(0, current + delta);

    // Optional cap, e.g. armor durability capped at durabilityMax (0 = no cap)
    const max = Number(target.dataset.max);
    if (Number.isFinite(max) && max > 0) newValue = Math.min(newValue, max);

    // 🧠 SPECIAL CASE: Supplies (quantity)
    if (path === "system.quantity" && newValue === 0) {
      await doc.delete();
      return;
    }

    // ✅ Default behavior (durability, etc.)
    await doc.update({ [path]: newValue });
  }

  static async _adjustActorNumber(event, target) {
    console.log("Sheet id:", this.id);
    const path = target.dataset.path;
    if (!path) return;

    console.log(
      "scrollable-tab",
      this.element.querySelector(".scrollable-tab"),
    );
    console.log("tab.skills", this.element.querySelector(".tab.skills"));
    console.log(
      "window-content",
      this.element.querySelector(".window-content"),
    );
    // Save scroll position
    const scrollable = this.element.querySelector(".tab.skills");
    this._skillsScrollTop = scrollable?.scrollTop ?? 0;

    console.log("Saving scroll:", this._skillsScrollTop);

    const delta = Number(target.dataset.delta ?? 1);
    const min = Number(target.dataset.min ?? 0);
    const max = Number(target.dataset.max ?? Number.MAX_SAFE_INTEGER);
    const current = Number(foundry.utils.getProperty(this.actor, path) ?? 0);
    const newValue = Math.min(max, Math.max(min, current + delta));

    await this.actor.update({ [path]: newValue });
  }

  static _toggleSkillsEdit() {
    if (!this.isEditable) return;
    this._skillsEditMode = !this._skillsEditMode;
    this.render();
  }

  /**
   * Handle creating a new Owned Item or ActiveEffect for the actor using initial data defined in the HTML dataset
   *
   * @this RedsteelActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _createDoc(event, target) {
    // Retrieve the configured document class for Item or ActiveEffect
    const docCls = getDocumentClass(target.dataset.documentClass);
    // Prepare the document creation data by initializing it a default name.
    const docData = {
      name: docCls.defaultName({
        // defaultName handles an undefined type gracefully
        type: target.dataset.type,
        parent: this.actor,
      }),
    };
    // Loop through the dataset and add it to our docData
    for (const [dataKey, value] of Object.entries(target.dataset)) {
      // These data attributes are reserved for the action handling
      if (["action", "documentClass"].includes(dataKey)) continue;
      // Nested properties require dot notation in the HTML, e.g. anything with `system`
      // An example exists in spells.hbs, with `data-system.spell-level`
      // which turns into the dataKey 'system.spellLevel'
      foundry.utils.setProperty(docData, dataKey, value);
    }

    // Finally, create the embedded document!
    await docCls.create(docData, { parent: this.actor });
  }

  /**
   * Determines effect parent to pass to helper
   *
   * @this RedsteelActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _toggleEffect(event, target) {
    const effect = this._getEmbeddedDocument(target);
    await effect.update({ disabled: !effect.disabled });
  }

  /**
   * Handle a click on the Speed stat (both sheets).
   *
   * Speed tests are not d100 margin-of-success rolls, so they never went
   * through the generic roll path: they use the shared d12 + Initiative +
   * Speed formula (prone, rogue doctrine and advantage included) and post a
   * contestable card. See module/utils/speedTest.mjs.
   *
   * @this RedsteelActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _onRollSpeed(event, target) {
    event.preventDefault();
    await postSpeedTest(this.actor);
  }

  /**
   * Handle clickable rolls.
   *
   * @this RedsteelActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _onRoll(event, target) {
    event.preventDefault();
    const dataset = target.dataset;

    // Handle item rolls.
    switch (dataset.rollType) {
      case "item":
        const item = this._getEmbeddedDocument(target);
        if (item) return item.roll();
    }

    // Herbalism / Survival can either test the skill or gather herbs. Ask first;
    // gathering takes over entirely via its own dialog (no chat roll message).
    if (
      dataset.roll &&
      dataset.rollType === "skill" &&
      (dataset.label === "herbalism" || dataset.label === "survival")
    ) {
      const skillName = game.i18n.localize(
        `REDSTEEL.Actor.Character.skills.${dataset.label}.label`,
      );
      const mode = await promptHerbMode(skillName);
      if (mode === null) return; // dismissed
      if (mode === "gather") {
        return gatherHerbs(
          this.actor,
          dataset.label,
          this.actor.system.skills[dataset.label],
        );
      }
      // mode === "test" → fall through to the normal skill roll below.
    }

    if (dataset.roll) {
      const attributeMap = {
        Strength: "Str",
        Dexterity: "Dex",
        Endurance: "End",
        Intelligence: "Int",
        Will: "Wil",
        Charism: "Cha",
        Perception: "Per",
        Speed: "Spd",
        Luck: "Lck",
        Resolve: "Res",
        Faith: "Fth",
        Sinfulness: "Sin",
        Visage: "Vis",
        Initiative: "Ini",
      };
      // Determine if this is a skill or attribute. Combat skills unrollable without macro, left here in case of change
      const isSkillRoll =
        dataset.rollType === "skill" ||
        dataset.rollType === "combat-skill" ||
        dataset.rollType === "attribute" ||
        dataset.rollType === "secondaryAttribute";

      const skillKey = dataset.label;
      // Use dataset.label directly as the key for localization
      const mappedKey =
        dataset.rollType === "attribute" || "secondaryAttribute"
          ? attributeMap[skillKey] || skillKey
          : skillKey;

      // Use game.i18n to get the localized label for the skill, looking under the correct path in your structure
      let label = dataset.label
        ? ` ${game.i18n.localize(
            dataset.rollType === "combat-skill"
              ? `REDSTEEL.Actor.Character.skills.${skillKey}.label`
              : dataset.rollType === "attribute"
                ? `REDSTEEL.Actor.Character.Attribute.${
                    skillKey.charAt(0).toUpperCase() + skillKey.slice(1)
                  }.long`
                : dataset.rollType === "secondaryAttribute"
                  ? `REDSTEEL.Actor.Character.SecondaryAttribute.${
                      skillKey.charAt(0).toUpperCase() + skillKey.slice(1)
                    }.long`
                  : `REDSTEEL.Actor.Character.skills.${skillKey}.label`,
          )}`
        : "";
      const rollName = label;

      const roll = new Roll(dataset.roll, this.actor.getRollData());
      // Tag the roll with its skill/attribute key so per-skill advantage
      // buckets (features/buffs) apply on top of the actor-wide bias.
      if (isSkillRoll) tagRollSkill(roll, skillKey);
      await roll.evaluate();

      const d100Result = roll.dice[0]?.total; // Extract the d100 result
      let skillData = null;
      // Only evaluate critical status if it's a skill or combat skill roll
      if (isSkillRoll) {
        // Retrieve the skill data based on the roll type

        console.log("Roll Type:", dataset.rollType);
        console.log("Skill Key:", skillKey);
        if (dataset.rollType === "skill") {
          skillData = this.actor.system.skills[skillKey];

          // Subskill fallback
          const subskillParents = {
            swimming: "athletics",
            blend: "acting",
          };

          if (!skillData && subskillParents[skillKey]) {
            skillData = this.actor.system.skills[subskillParents[skillKey]];
          }
        } else if (dataset.rollType === "combat-skill") {
          skillData = this.actor.system.combatSkills[skillKey];
        } else if (dataset.rollType === "attribute") {
          skillData = this.actor.system.attributes[skillKey];
        } else if (dataset.rollType === "secondaryAttribute") {
          skillData = this.actor.system.secondaryAttributes[skillKey];
        }

        if (skillData) {
          // Desperate Effort shifts the crit thresholds for this roll.
          const { successThreshold, failureThreshold } = applyDesperateCrit(
            roll,
            skillData.criticalSuccessThreshold,
            skillData.criticalFailureThreshold,
          );
          const criticalMessage = this.evaluateCriticalSuccess(
            d100Result,
            successThreshold,
            failureThreshold,
          );
          console.log(
            "Rolled:",
            d100Result,
            "Crit chance:",
            successThreshold,
            "Crit fail chance:",
            failureThreshold,
          );

          // Modify the label to include critical success/failure indication
          if (criticalMessage) {
            label += `<hr><p style="text-align: center; font-size: 20px;"><b>${criticalMessage}</b></p>`;
          }
          console.log(`Critical Message: ${criticalMessage}`);
        } else {
          console.error("No skill data found for:", skillKey);
        }
      }

      if (skillData) {
        // Deconstruct the critical thresholds from skillData, applying any
        // Desperate Effort shift so the chat card matches the rolled outcome.
        const {
          successThreshold: criticalSuccessThreshold,
          failureThreshold: criticalFailureThreshold,
        } = applyDesperateCrit(
          roll,
          skillData.criticalSuccessThreshold,
          skillData.criticalFailureThreshold,
        );

        const traitPills = getTraitPills(this.actor, skillKey);

        // Attribute rolls are the ones routinely made as versus Tests, so the
        // posted margin is clickable: the opponent selects a token, picks an
        // attribute (often a different one — "Test Síly versus Test
        // Síly/Odolnosti") and rolls against this number. Same mechanism the
        // ability and spell cards already use.
        const isVersusTest = dataset.rollType === "attribute";
        let flavorBody = `<p style="text-align: center; font-size: 20px;"><b>${label}</b></p>`;
        if (isVersusTest) {
          flavorBody += `<p style="text-align:center;">${renderMarginFollowupLine({
            margin: roll.total,
            source: rollName.trim(),
            chance: skillData.mod,
            result: roll.result,
          })}</p>`;
        }

        // Now, pass only the deconstructed values in the flags
        await roll.toMessage({
          // Stamp the rolling actor so the chat reroll button can resolve who
          // spends the charge — without this, a GM rolling with no token
          // controlled produces a speaker with no actor.
          speaker: ChatMessage.getSpeaker({ actor: this.actor }),
          flavor: flavorBody,
          rollMode: game.settings.get("core", "rollMode"),
          flags: {
            redsteel: {
              rollName,
              skill: skillKey, // Skill key so the chat reroll picker can match pools
              criticalSuccessThreshold, // Store critical success threshold
              criticalFailureThreshold, // Store critical failure threshold
              traitPills,
              // Lets a reroll rebuild the clickable versus-Test line for the
              // new margin instead of dropping it (see executeReroll).
              ...(isVersusTest && {
                versusTest: true,
                versusChance: skillData.mod,
              }),
            },
          },
        });
      } else {
        console.error("No skill data found for:", skillKey);
      }
      return roll;
    }
  }

  evaluateCriticalSuccess(d100Result, successThreshold, failureThreshold) {
    if (d100Result <= successThreshold) {
      return "Critical Success"; // Return this message for a critical success
    } else if (d100Result >= failureThreshold) {
      return "Critical Failure"; // Return this message for a critical failure
    }
    return ""; // Return an empty string for normal outcomes
  }
  /** Helper Functions */

  /**
   * Fetches the embedded document representing the containing HTML element
   *
   * @param {HTMLElement} target    The element subject to search
   * @returns {Item | ActiveEffect} The embedded Item or ActiveEffect
   */
  _getEmbeddedDocument(target) {
    const docRow = target.closest("li[data-document-class]");
    if (docRow.dataset.documentClass === "Item") {
      return this.actor.items.get(docRow.dataset.itemId);
    } else if (docRow.dataset.documentClass === "ActiveEffect") {
      const parent =
        docRow.dataset.parentId === this.actor.id
          ? this.actor
          : this.actor.items.get(docRow?.dataset.parentId);
      return parent.effects.get(docRow?.dataset.effectId);
    } else return console.warn("Could not find document class");
  }

  /***************
   *
   * Drag and Drop
   *
   ***************/

  /**
   * Define whether a user is able to begin a dragstart workflow for a given drag selector
   * @param {string} selector       The candidate HTML selector for dragging
   * @returns {boolean}             Can the current user drag this selector?
   * @protected
   */
  _canDragStart(selector) {
    // game.user fetches the current user
    return this.isEditable;
  }

  /**
   * Define whether a user is able to conclude a drag-and-drop workflow for a given drop selector
   * @param {string} selector       The candidate HTML selector for the drop target
   * @returns {boolean}             Can the current user drop on this selector?
   * @protected
   */
  _canDragDrop(selector) {
    // game.user fetches the current user
    return this.isEditable;
  }

  /**
   * Callback actions which occur at the beginning of a drag start workflow.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  _onDragStart(event) {
    const slotEl = event.currentTarget.closest(".weapon-slot");

    // 🔹 CASE 1: Dragging from a weapon slot
    if (slotEl) {
      const itemId = slotEl.dataset.itemId;
      const set = Number(slotEl.dataset.set);
      const slot = slotEl.dataset.slot;

      if (!itemId || !set || !slot) return;

      const dragData = {
        type: "WeaponSlot",
        itemId,
        fromSet: set,
        fromSlot: slot,
        actorId: this.actor.id,
      };

      event.dataTransfer.setData("text/plain", JSON.stringify(dragData));

      return;
    }

    // 🔹 CASE 2: Accessory slot (a <div>, not an <li>). Plain Item drag data is
    // enough: dropping on another slot routes to _assignAccessoryDirect, which
    // vacates the slot the item came from.
    const accessoryEl = event.currentTarget.closest(
      ".accessory-slot[data-item-id]",
    );
    if (accessoryEl) {
      const accessory = this.actor.items.get(accessoryEl.dataset.itemId);
      const dragData = accessory?.toDragData();
      if (dragData)
        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
      return;
    }

    // 🔹 CASE 3: Equipped ammo slot (a <div>, not an <li>)
    const ammoEl = event.currentTarget.closest(".ammo-slot[data-item-id]");
    if (ammoEl) {
      const ammo = this.actor.items.get(ammoEl.dataset.itemId);
      const dragData = ammo?.toDragData();
      if (dragData)
        event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
      return;
    }

    // 🔹 CASE 4: Normal inventory item drag (existing behavior)
    const docRow = event.currentTarget.closest("li");
    if (!docRow) return;

    const dragData = this._getEmbeddedDocument(docRow)?.toDragData();
    if (!dragData) return;

    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  /**
   * Callback actions which occur when a dragged element is over a drop target.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  _onDragOver(event) {
    const slot = event.target.closest(
      ".weapon-slot, .armor-slot, .accessory-slot, .ammo-loadout",
    );
    if (!slot) return;

    event.preventDefault();
    slot.classList.add("drop-hover");
  }

  /**
   * Callback actions which occur when a dragged element is dropped on a target.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  async _onDrop(event) {
    const slot = event.target.closest(".weapon-slot");
    if (slot) slot.classList.remove("drop-hover");
    const data = TextEditor.getDragEventData(event);
    const actor = this.actor;
    const dropTarget = event.target.closest(".weapon-slot");
    if (dropTarget) {
      return this._onDropWeaponSlot(event, dropTarget);
    }
    const armorTarget = event.target.closest(".armor-slot");
    if (armorTarget) {
      armorTarget.classList.remove("drop-hover");
      return this._onDropArmorSlot(event, armorTarget);
    }
    const accessoryTarget = event.target.closest(".accessory-slot");
    if (accessoryTarget) {
      accessoryTarget.classList.remove("drop-hover");
      return this._onDropAccessorySlot(event, accessoryTarget);
    }
    const ammoTarget = event.target.closest(".ammo-loadout");
    if (ammoTarget) {
      ammoTarget.classList.remove("drop-hover");
      return this._onDropAmmoSlot(event, ammoTarget);
    }
    const allowed = Hooks.call("dropActorSheetData", actor, this, data);
    if (allowed === false) return;

    // Handle different data types
    switch (data.type) {
      case "ActiveEffect":
        return this._onDropActiveEffect(event, data);
      case "Actor":
        return this._onDropActor(event, data);
      case "Item":
        return this._onDropItem(event, data);
      case "Folder":
        return this._onDropFolder(event, data);
    }
  }

  /**
   * Handle the dropping of ActiveEffect data onto an Actor Sheet
   * @param {DragEvent} event                  The concluding DragEvent which contains drop data
   * @param {object} data                      The data transfer extracted from the event
   * @returns {Promise<ActiveEffect|boolean>}  The created ActiveEffect object or false if it couldn't be created.
   * @protected
   */
  async _onDropActiveEffect(event, data) {
    const aeCls = getDocumentClass("ActiveEffect");
    const effect = await aeCls.fromDropData(data);
    if (!this.actor.isOwner || !effect) return false;
    if (effect.target === this.actor)
      return this._onSortActiveEffect(event, effect);
    return aeCls.create(effect, { parent: this.actor });
  }

  /**
   * Handle a drop event for an existing embedded Active Effect to sort that Active Effect relative to its siblings
   *
   * @param {DragEvent} event
   * @param {ActiveEffect} effect
   */
  async _onSortActiveEffect(event, effect) {
    /** @type {HTMLElement} */
    const dropTarget = event.target.closest("[data-effect-id]");
    if (!dropTarget) return;
    const target = this._getEmbeddedDocument(dropTarget);

    // Don't sort on yourself
    if (effect.uuid === target.uuid) return;

    // Identify sibling items based on adjacent HTML elements
    const siblings = [];
    for (const el of dropTarget.parentElement.children) {
      const siblingId = el.dataset.effectId;
      const parentId = el.dataset.parentId;
      if (
        siblingId &&
        parentId &&
        (siblingId !== effect.id || parentId !== effect.parent.id)
      )
        siblings.push(this._getEmbeddedDocument(el));
    }

    // Perform the sort
    const sortUpdates = SortingHelpers.performIntegerSort(effect, {
      target,
      siblings,
    });

    // Split the updates up by parent document
    const directUpdates = [];

    const grandchildUpdateData = sortUpdates.reduce((items, u) => {
      const parentId = u.target.parent.id;
      const update = { _id: u.target.id, ...u.update };
      if (parentId === this.actor.id) {
        directUpdates.push(update);
        return items;
      }
      if (items[parentId]) items[parentId].push(update);
      else items[parentId] = [update];
      return items;
    }, {});

    // Effects-on-items updates
    for (const [itemId, updates] of Object.entries(grandchildUpdateData)) {
      await this.actor.items
        .get(itemId)
        .updateEmbeddedDocuments("ActiveEffect", updates);
    }

    // Update on the main actor
    return this.actor.updateEmbeddedDocuments("ActiveEffect", directUpdates);
  }

  /**
   * Handle dropping of an Actor data onto another Actor sheet
   * @param {DragEvent} event            The concluding DragEvent which contains drop data
   * @param {object} data                The data transfer extracted from the event
   * @returns {Promise<object|boolean>}  A data object which describes the result of the drop, or false if the drop was
   *                                     not permitted.
   * @protected
   */
  async _onDropActor(event, data) {
    if (!this.actor.isOwner) return false;
  }

  /* -------------------------------------------- */

  /**
   * Handle dropping of an item reference or item data onto an Actor Sheet
   * @param {DragEvent} event            The concluding DragEvent which contains drop data
   * @param {object} data                The data transfer extracted from the event
   * @returns {Promise<Item[]|boolean>}  The created or updated Item instances, or false if the drop was not permitted.
   * @protected
   */
  async _onDropItem(event, data) {
    if (!this.actor.isOwner) return false;
    const item = await Item.implementation.fromDropData(data);

    // Prevent adding multiple races
    if (item.type === "race") {
      let existingRace = this.actor.items.find((i) => i.type === "race");
      if (existingRace) {
        ui.notifications.warn("This character already has a race!");
        return false; // Stop item from being added
      }
    }
    // Handle item sorting within the same Actor
    if (this.actor.uuid === item.parent?.uuid)
      return this._onSortItem(event, item);

    // Only one Starsign (Hvězda) per character. Checked after the sort branch
    // so re-ordering the one already owned still works.
    if (item.type === "feature" && item.system?.starsign) {
      const existing = this.actor.items.find(
        (i) => i.type === "feature" && i.system?.starsign,
      );
      if (existing) {
        ui.notifications.warn(
          game.i18n.format("REDSTEEL.Starsign.OnlyOne", {
            starsign: existing.localizedName ?? existing.name,
          }),
        );
        return false;
      }
    }
    // Check if the item is a consumable
    if (item.type === "consumable") {
      // Look for an existing stackable consumable with the same name
      let existingItem = this.actor.items.find(
        (i) => i.name === item.name && i.type === "consumable",
      );

      if (existingItem) {
        // Increase the quantity instead of creating a new item
        let newQuantity =
          (existingItem.system.quantity || 1) + (item.system.quantity || 1);
        return existingItem.update({ "system.quantity": newQuantity });
      }
    }

    // Race drops: after creation, disable any choice-group effects until the
    // player resolves them, then open the choices dialog if there are any.
    if (item.type === "race") {
      const created = await this._onDropItemCreate(item, event);
      const createdRace = created.find((i) => i.type === "race") ?? created[0];
      if (createdRace) {
        await initializeRaceChoices(createdRace);
        if (getRaceChoiceGroups(createdRace).length) {
          await openRaceChoicesDialog(createdRace);
        }
      }
      return created;
    }

    // Create the owned item
    return this._onDropItemCreate(item, event);
  }

  /**
   * Handle dropping of a Folder on an Actor Sheet.
   * The core sheet currently supports dropping a Folder of Items to create all items as owned items.
   * @param {DragEvent} event     The concluding DragEvent which contains drop data
   * @param {object} data         The data transfer extracted from the event
   * @returns {Promise<Item[]>}
   * @protected
   */
  async _onDropFolder(event, data) {
    if (!this.actor.isOwner) return [];
    const folder = await Folder.implementation.fromDropData(data);
    if (folder.type !== "Item") return [];
    const droppedItemData = await Promise.all(
      folder.contents.map(async (item) => {
        if (!(document instanceof Item)) item = await fromUuid(item.uuid);
        return item;
      }),
    );
    return this._onDropItemCreate(droppedItemData, event);
  }

  /**
   * Handle the final creation of dropped Item data on the Actor.
   * This method is factored out to allow downstream classes the opportunity to override item creation behavior.
   * @param {object[]|object} itemData      The item data requested for creation
   * @param {DragEvent} event               The concluding DragEvent which provided the drop data
   * @returns {Promise<Item[]>}
   * @private
   */
  async _onDropItemCreate(itemData, event) {
    itemData = itemData instanceof Array ? itemData : [itemData];
    // Items dragged off another actor (e.g. an NPC's equipped armor/weapon)
    // carry that source's `system.equipped` flag. On this actor that flag
    // hides the item from the inventory grid while still contributing its
    // armor value in prepareDerivedData — an invisible, stacking equipped
    // item. A freshly dropped item is never legitimately pre-equipped, so
    // strip the flag and let it land visibly in the inventory grid.
    const sanitized = itemData.map((i) => {
      const obj = typeof i?.toObject === "function" ? i.toObject() : i;
      if (obj.system?.equipped) obj.system.equipped = false;
      return obj;
    });
    return this.actor.createEmbeddedDocuments("Item", sanitized);
  }

  /**
   * Handle the final creation of dropped Item data on the weapon slot.
   * This method is factored out to allow downstream classes the opportunity to override item creation behavior.
   * @param {object[]|object} itemData      The item data requested for creation
   * @param {DragEvent} event               The concluding DragEvent which provided the drop data
   * @returns {Promise<Item[]>}
   * @private
   */
  async _onDropWeaponSlot(event, slotEl) {
    if (this.actor.type !== "character") return;
    event.preventDefault();

    const data = TextEditor.getDragEventData(event);
    if (!data) return;

    const toSet = Number(slotEl.dataset.set);
    const toSlot = slotEl.dataset.slot;
    if (!toSet || !toSlot) return;

    const weaponSets = this.actor.system.combat.weaponSets ?? {};

    // Slot → slot drag
    if (data.type === "WeaponSlot") {
      this._assignWeaponDirect(data.itemId, toSet, toSlot);
      return;
    }

    if (data.type !== "Item") return;

    const item = await Item.implementation.fromDropData(data);
    if (!item?.isOwned) return;

    const isShield = item.system.shield;

    // Shields only in off-hand
    if (isShield && toSlot !== "off") return;

    // Two-handed blocks off-hand
    if (toSlot === "off") {
      const mainId = weaponSets?.[toSet]?.main;
      if (mainId) {
        const mainItem = this.actor.items.get(mainId);
        const mainIsTwoHanded =
          mainItem?.system.type === "heavy" ||
          ["crossbow", "bow"].includes(mainItem?.system.class);

        if (mainIsTwoHanded) return;
      }
    }

    // Weapons only
    if (item.type !== "weapon" && !isShield) return;

    this._assignWeaponDirect(item.id, toSet, toSlot);
  }

  /**
   * Handle dropping an owned armor (gear) item onto one of the layered
   * armor slots. Layer validation happens in _assignArmorDirect.
   * @param {DragEvent} event       The concluding DragEvent
   * @param {HTMLElement} slotEl    The armor slot element dropped on
   * @private
   */
  async _onDropArmorSlot(event, slotEl) {
    if (this.actor.type !== "character") return;
    event.preventDefault();

    const data = TextEditor.getDragEventData(event);
    if (data?.type !== "Item") return;

    const layer = slotEl.dataset.layer;
    if (!layer) return;

    const item = await Item.implementation.fromDropData(data);
    if (!item?.isOwned) return;

    return this._assignArmorDirect(item.id, layer);
  }

  /**
   * Handle dropping an owned accessory (gear) item onto one of the ten
   * generic, interchangeable accessory slots.
   * @param {DragEvent} event       The concluding DragEvent
   * @param {HTMLElement} slotEl    The accessory slot element dropped on
   * @private
   */
  async _onDropAccessorySlot(event, slotEl) {
    if (this.actor.type !== "character") return;
    event.preventDefault();

    const data = TextEditor.getDragEventData(event);
    if (data?.type !== "Item") return;

    const slotKey = slotEl.dataset.slotKey;
    if (!slotKey) return;

    const item = await Item.implementation.fromDropData(data);
    if (!item?.isOwned) return;

    return this._assignAccessoryDirect(item.id, slotKey);
  }

  /**
   * Handle dropping an owned ammunition item onto the equipped-ammo slot.
   * @param {DragEvent} event       The concluding DragEvent
   * @param {HTMLElement} slotEl    The ammo loadout element dropped on
   * @private
   */
  async _onDropAmmoSlot(event, slotEl) {
    event.preventDefault();

    const data = TextEditor.getDragEventData(event);
    if (data?.type !== "Item") return;

    const item = await Item.implementation.fromDropData(data);
    if (!item?.isOwned || item.type !== "ammunition") return;

    return this._equipAmmo(item, true);
  }

  /**
   * Handle a drop event for an existing embedded Item to sort that Item relative to its siblings
   * @param {Event} event
   * @param {Item} item
   * @private
   */
  _onSortItem(event, item) {
    // Get the drag source and drop target
    const items = this.actor.items;
    const dropTarget = event.target.closest("[data-item-id]");
    if (!dropTarget) return;
    const target = items.get(dropTarget.dataset.itemId);

    // Don't sort on yourself
    if (item.id === target.id) return;

    // Identify sibling items based on adjacent HTML elements
    const siblings = [];
    for (let el of dropTarget.parentElement.children) {
      const siblingId = el.dataset.itemId;
      if (siblingId && siblingId !== item.id)
        siblings.push(items.get(el.dataset.itemId));
    }

    // Perform the sort
    const sortUpdates = SortingHelpers.performIntegerSort(item, {
      target,
      siblings,
    });
    const updateData = sortUpdates.map((u) => {
      const update = u.update;
      update._id = u.target._id;
      return update;
    });

    // Perform the update
    return this.actor.updateEmbeddedDocuments("Item", updateData);
  }

  /** The following pieces set up drag handling and are unlikely to need modification  */

  /**
   * Returns an array of DragDrop instances
   * @type {DragDrop[]}
   */
  get dragDrop() {
    return this.#dragDrop;
  }

  // This is marked as private because there's no real need
  // for subclasses or external hooks to mess with it directly
  #dragDrop;

  /**
   * Create drag-and-drop workflow handlers for this Application
   * @returns {DragDrop[]}     An array of DragDrop handlers
   * @private
   */
  #createDragDropHandlers() {
    return this.options.dragDrop.map((d) => {
      d.permissions = {
        dragstart: this._canDragStart.bind(this),
        drop: this._canDragDrop.bind(this),
      };
      d.callbacks = {
        dragstart: this._onDragStart.bind(this),
        dragover: this._onDragOver.bind(this),
        drop: this._onDrop.bind(this),
      };
      return new DragDrop(d);
    });
  }

  /********************
   *
   * Actor Override Handling
   *
   ********************/

  /**
   * Submit a document update based on the processed form data.
   * @param {SubmitEvent} event                   The originating form submission event
   * @param {HTMLFormElement} form                The form element that was submitted
   * @param {object} submitData                   Processed and validated form data to be used for a document update
   * @returns {Promise<void>}
   * @protected
   * @override
   */
  async _processSubmitData(event, form, submitData) {
    const overrides = foundry.utils.flattenObject(this.actor.overrides);
    for (let k of Object.keys(overrides)) delete submitData[k];
    await this.document.update(submitData);
  }

  /**
   * Disables inputs subject to active effects
   */
  #disableOverrides() {
    const flatOverrides = foundry.utils.flattenObject(this.actor.overrides);
    for (const override of Object.keys(flatOverrides)) {
      const input = this.element.querySelector(`[name="${override}"]`);
      if (input) {
        input.disabled = true;
      }
    }
  }
}
