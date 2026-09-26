import { prepareActiveEffectCategories } from "../helpers/effects.mjs";
import {
  SUBSTANCES,
  BASES,
  MAX_BATCH,
  RECIPE_PURPOSES,
} from "../utils/alchemy.mjs";
import {
  canResyncItem,
  getResyncBackup,
  resyncItemFromSource,
  undoItemResync,
} from "../utils/itemResync.mjs";
import {
  readEnchantments,
  weaponEnchantMods,
  gearEnchantMods,
} from "../documents/item.mjs";
import {
  isItemUnidentified,
  hasHiddenCurse,
  visibleEnchantments,
  identifyDifficulty,
  derivedIdentifyDifficulty,
  identifyDifficultyOverride,
  isItemIdentifyLocked,
  openIdentifyWindow,
} from "../utils/itemIdentify.mjs";
import { resourceLabel } from "../utils/itemResources.mjs";
import {
  FEATURE_SECTION_IDS,
  getBookFeaturePrice,
} from "../helpers/progressionEngine.mjs";
import {
  SPELL_RANKS,
  SPELL_SCHOOLS,
  getBookEntries,
} from "../utils/spellbook.mjs";
import {
  SCROLL_SCHOOLS,
  SCROLL_RANKS,
  isMasterScroll,
  isScrollIdentified,
  getScrollPool,
  createConcreteScroll,
} from "../utils/spellScrolls.mjs";

const { api, sheets } = foundry.applications;

/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheetV2}
 */
export class RedsteelItemSheet extends api.HandlebarsApplicationMixin(
  sheets.ItemSheetV2,
) {
  constructor(options = {}) {
    super(options);
    this.#dragDrop = this.#createDragDropHandlers();
  }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["redsteel", "item"],
    actions: {
      onEditImage: this._onEditImage,
      viewDoc: this._viewEffect,
      createDoc: this._createEffect,
      deleteDoc: this._deleteEffect,
      toggleEffect: this._toggleEffect,
      addVariant: this._addVariant,
      removeVariant: this._removeVariant,
      openVariant: this._openVariant,
      addRerollPool: this._addRerollPool,
      removeRerollPool: this._removeRerollPool,
      clearRecipeResult: this._clearRecipeResult,
      clearRecipeSpecial: this._clearRecipeSpecial,
      addRaceChoice: this._addRaceChoice,
      removeRaceChoice: this._removeRaceChoice,
      toggleRaceChoiceEffect: this._toggleRaceChoiceEffect,
      removeRaceGrant: this._removeRaceGrant,
      removeEnchantment: this._removeEnchantment,
      identifyItem: this._identifyItem,
      removeBookSpell: this._removeBookSpell,
      takeOutScroll: this._takeOutScroll,
      resyncItem: this._resyncItem,
      undoResync: this._undoResync,
    },
    form: {
      submitOnChange: true,
    },
    // Custom property that's merged into `this.options`
    dragDrop: [{ dragSelector: "[data-drag]", dropSelector: null }],
  };

  /* -------------------------------------------- */

  /**
   * Add the ruleset-resync entries to the header menu (the one holding "Configure
   * Sheet" and "Configure Ownership").
   *
   * `super` may hand back the array stored on the application's options, so it
   * is copied before pushing — mutating it directly would append a duplicate
   * entry on every re-render. Both entries are decided fresh here on each
   * render, which is what makes "Undo re-sync" appear only while a snapshot
   * exists and vanish again once it is used.
   *
   * @override
   */
  _getHeaderControls() {
    const controls = [...super._getHeaderControls()];

    if (canResyncItem(this.document)) {
      controls.push({
        icon: "fa-solid fa-rotate",
        label: game.i18n.localize("REDSTEEL.Resync.Action"),
        action: "resyncItem",
      });
    }

    if (this.document?.isOwner && getResyncBackup(this.document)) {
      controls.push({
        icon: "fa-solid fa-rotate-left",
        label: game.i18n.localize("REDSTEEL.Resync.Undo"),
        action: "undoResync",
      });
    }

    return controls;
  }

  static async _resyncItem() {
    await resyncItemFromSource(this.document);
    this.render();
  }

  static async _undoResync() {
    await undoItemResync(this.document);
    this.render();
  }

  /* -------------------------------------------- */

  /** @override */
  static PARTS = {
    header: {
      template: "systems/redsteel/templates/item/header.hbs",
    },
    tabs: {
      // Foundry-provided generic template
      template: "templates/generic/tab-navigation.hbs",
    },
    description: {
      template: "systems/redsteel/templates/item/description.hbs",
    },
    doctrines: {
      template: "systems/redsteel/templates/item/doctrines.hbs",
    },
    combatEffects: {
      template: "systems/redsteel/templates/item/combatEffects.hbs",
    },
    attributesFeature: {
      template: "systems/redsteel/templates/item/attribute-parts/feature.hbs",
    },
    attributesGear: {
      template: "systems/redsteel/templates/item/attribute-parts/gear.hbs",
    },
    attributesAmmunition: {
      template:
        "systems/redsteel/templates/item/attribute-parts/ammunition.hbs",
    },
    attributesItem: {
      template: "systems/redsteel/templates/item/attribute-parts/item.hbs",
    },
    attributesRace: {
      template: "systems/redsteel/templates/item/attribute-parts/race.hbs",
    },
    attributesConsumable: {
      template:
        "systems/redsteel/templates/item/attribute-parts/consumable.hbs",
    },
    attributesWeapon: {
      template: "systems/redsteel/templates/item/attribute-parts/weapon.hbs",
    },
    attributesLight: {
      template: "systems/redsteel/templates/item/attribute-parts/light.hbs",
    },
    attributesOffhand: {
      template: "systems/redsteel/templates/item/attribute-parts/offhand.hbs",
    },
    attributesSpell: {
      template: "systems/redsteel/templates/item/attribute-parts/spell.hbs",
    },
    attributesVariants: {
      template: "systems/redsteel/templates/item/attribute-parts/variants.hbs",
    },
    attributesAbility: {
      template: "systems/redsteel/templates/item/attribute-parts/ability.hbs",
    },
    attributesCondition: {
      template: "systems/redsteel/templates/item/attribute-parts/condition.hbs",
    },
    attributesRecipe: {
      template: "systems/redsteel/templates/item/attribute-parts/recipe.hbs",
    },
    attributesSpellbook: {
      template: "systems/redsteel/templates/item/attribute-parts/spellbook.hbs",
    },
    attributesScroll: {
      template: "systems/redsteel/templates/item/attribute-parts/scroll.hbs",
    },
    attributesEnchantment: {
      template:
        "systems/redsteel/templates/item/attribute-parts/enchantment.hbs",
    },
    enchantments: {
      template: "systems/redsteel/templates/item/enchantments.hbs",
    },
    effects: {
      template: "systems/redsteel/templates/item/effects.hbs",
    },
  };

  /** @override */
  get title() {
    return super.title.replace(this.document.name, this.document.localizedName);
  }

  /** @override */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    // Not all parts always render
    options.parts = ["header", "tabs", "description"];
    // Don't show the other tabs if only limited view
    if (this.document.limited) return;
    // Control which parts show based on document subtype
    switch (this.document.type) {
      case "feature":
        options.parts.push("attributesFeature", "effects");
        break;
      case "gear":
        options.parts.push(
          "attributesGear",
          "attributesLight",
          "enchantments",
          "effects",
        );
        break;
      case "ammunition":
        options.parts.push("attributesAmmunition", "effects");
        break;
      case "race":
        options.parts.push("attributesRace", "effects");
        break;
      case "consumable":
        // Potions/poisons carry authored Active Effects (buffs) applied on use.
        options.parts.push("effects");
        // Poisons can also carry combat effects (bleed/stagger/custom) that the
        // coating contributes to the wielder's attack rolls (see usePoison).
        // Explosives use the same tab for anything the header's burn/freeze/
        // stagger fields cannot express — Stun, Slow, Root … (see throwExplosive).
        if (["poison", "explosive"].includes(this.item.system.option)) {
          options.parts.push("combatEffects");
        }
        break;
      case "ability":
        options.parts.push("attributesAbility", "combatEffects");
        break;
      case "weapon":
        options.parts.push("attributesWeapon", "doctrines", "combatEffects");
        if (this.item.system.offhand) {
          options.parts.push("attributesOffhand");
        }
        options.parts.push("attributesLight", "enchantments");
        break;
      case "enchantment":
        options.parts.push("attributesEnchantment", "combatEffects");
        break;
      case "spell":
        options.parts.push("attributesSpell", "combatEffects", "attributesVariants");
        break;
      case "condition":
        options.parts.push("attributesCondition", "effects");
        break;
      case "recipe":
        options.parts.push("attributesRecipe");
        break;
      // A grimoire carries the spells written in it (system.spells); the copies
      // on its owner are projected from that list by utils/spellbook.mjs.
      case "spellbook":
        options.parts.push("attributesSpellbook");
        break;
      // A master scroll (system.spell empty) is a case of scrolls for one
      // school and rank; a concrete scroll is one sheet bound to one spell.
      // Both live on the same part (see utils/spellScrolls.mjs).
      case "scroll":
        options.parts.push("attributesScroll");
        break;
    }
  }

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = {
      // Validates both permissions and compendium status
      editable: this.isEditable,
      owner: this.document.isOwner,
      limited: this.document.limited,
      // Add the item document.
      item: this.item,
      itemDisplayName: this.item.localizedName,
      hasLocalizedName: this.item.localizedName !== this.item.name,
      isGM: game.user.isGM,
      // A player looking at an unidentified magic item sees only its disguise
      // (see utils/itemIdentify.mjs). The GM always sees the real thing.
      isUnidentified: isItemUnidentified(this.item),
      identifyHidden: isItemUnidentified(this.item) && !game.user.isGM,
      // Adding system and flags for easier access
      system: this.item.system,
      flags: this.item.flags,
      // Adding a pointer to CONFIG.REDSTEEL
      config: CONFIG.REDSTEEL,
      // You can factor out context construction to helper functions
      tabs: this._getTabs(options.parts),
    };

    // A feature's Learn window block (feature.hbs): the book's price shows
    // faintly in empty cost boxes, and the section select lists the Learn
    // window's sections after "Book default" (empty).
    if (this.item.type === "feature") {
      const book = getBookFeaturePrice(this.item.actor ?? null, this.item);
      context.featureBookPrice = {
        cp: book ? book.cp : "",
        sp: book ? book.sp : "",
      };
      const section = this.item.system.learnSection ?? "";
      context.featureSectionOptions = [
        {
          value: "",
          label: game.i18n.localize("REDSTEEL.Learn.ItemFields.sectionDefault"),
          selected: !section,
        },
        ...FEATURE_SECTION_IDS.map((id) => ({
          value: id,
          label: game.i18n.localize(`REDSTEEL.Learn.Features.Sections.${id}`),
          selected: section === id,
        })),
      ];
    }

    return context;
  }

  /**
   * A feature's cost boxes: an emptied box stores null (use the book price) and
   * 0 stores 0 (free). The value is read from the input itself, so the result
   * does not depend on how the form data casts an empty number field.
   * @override
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    // The GM's identify difficulty override (enchantments.hbs): an emptied box
    // stores null (use the tier-derived value), never "" or 0. Read from the
    // input itself, like the feature cost boxes below.
    const identifyInput = form?.elements?.namedItem?.(
      "flags.redsteel.identify.difficulty",
    );
    if (identifyInput) {
      const raw = String(identifyInput.value ?? "").trim();
      const value = raw === "" ? null : Number(raw);
      delete data["flags.redsteel.identify.difficulty"];
      foundry.utils.setProperty(
        data,
        "flags.redsteel.identify.difficulty",
        Number.isFinite(value) ? value : null,
      );
    }
    if (this.item.type !== "feature") return data;
    for (const key of ["cp", "sp"]) {
      const input = form?.elements?.namedItem?.(`system.cost.${key}`);
      if (!input) continue;
      const raw = String(input.value ?? "").trim();
      const value = raw === "" ? null : Number(raw);
      delete data[`system.cost.${key}`];
      data.system ??= {};
      data.system.cost ??= {};
      data.system.cost[key] = Number.isFinite(value) ? Math.max(0, value) : null;
    }
    return data;
  }

  /** @override */
  async _preparePartContext(partId, context) {
    switch (partId) {
      case "attributesFeature":
        context.tab = context.tabs[partId];
        // One entry per reroll pool, normalized with its array index for the
        // pool editor inputs (system.reroll.pools.<index>.*).
        context.rerollPoolEntries = this._getRerollPoolArray().map(
          (pool, index) => ({
            index,
            label: pool.label ?? "",
            skillsRaw: pool.skillsRaw ?? "",
            max: Number(pool.max) || 0,
            used: Number(pool.used) || 0,
          }),
        );
        break;
      case "attributesRace": {
        context.tab = context.tabs[partId];
        context.raceChoiceEntries = this._getRaceChoiceArray().map(
          (group, index) => ({
            index,
            label: group.label,
            count: group.count,
            effectRows: this.item.effects.map((effect) => ({
              effectId: effect.id,
              name: effect.name,
              img: effect.img,
              member: group.effectIds.includes(effect.id),
            })),
          }),
        );
        context.hasRaceEffects = this.item.effects.size > 0;
        context.raceGrantEntries = this._getRaceGrantArray().map(
          (entry, index) => ({
            index,
            uuid: entry.uuid,
            name: entry.name,
            img: entry.img,
          }),
        );
        break;
      }
      case "attributesItem":
      case "attributesGear":
      case "attributesAmmunition":
      case "attributesConsumable":
      case "attributesAbility":
      case "attributesCondition":
      case "doctrines":
      case "combatEffects":
      case "attributesWeapon":
      case "attributesOffhand":
      case "attributesSpell":
        // Necessary for preserving active tab on re-render
        context.tab = context.tabs[partId];
        break;
      case "attributesEnchantment": {
        context.tab = context.tabs[partId];
        // Three fixed damage-type slots. Stored as an array, but a sheet submit
        // can hand it back as an index-keyed object, so it is normalized here
        // (and again when the mods are summed in documents/item.mjs).
        const raw = this.item.system.weaponMods?.damageTypes;
        const stored = Array.isArray(raw) ? raw : Object.values(raw ?? {});
        context.enchantDamageTypeSlots = [0, 1, 2].map((index) => ({
          index,
          value: stored[index] ?? "",
        }));
        break;
      }
      case "enchantments":
        context.tab = context.tabs[partId];
        // The applied snapshots, plus the derived total the combat math reads,
        // so the tab can show both the list and what it all adds up to.
        context.enchantmentEntries = this._getEnchantmentArray();
        context.enchantMods = this.item.system.enchantMods ?? {};
        context.enchantSlot = this.item.type === "weapon" ? "weapon" : "gear";
        if (game.user.isGM) {
          // The GM identification block. Display only: the real numbers the
          // combat math reads are never touched by identification.
          const flag = this.item.flags?.redsteel?.identify ?? {};
          context.identifyFlags = {
            unidentified: flag.unidentified === true,
            appearsAs: String(flag.appearsAs ?? ""),
            difficulty: identifyDifficultyOverride(this.item) ?? "",
            curseRevealed: flag.curseRevealed === true,
          };
          context.hasBound = readEnchantments(this.item).some(
            (entry) => !!entry?.bound,
          );
          context.derivedDifficulty = fmtSigned(
            derivedIdentifyDifficulty(this.item),
          );
        } else if (isItemUnidentified(this.item)) {
          context.identifyHidden = true;
          context.enchantmentEntries = [];
          context.enchantMods = {};
          context.identifyDifficulty = fmtSigned(identifyDifficulty(this.item));
          context.identifyLocked = isItemIdentifyLocked(
            this.item.actor,
            this.item,
          );
          context.identifyActorName = this.item.actor?.name ?? "";
        } else if (hasHiddenCurse(this.item)) {
          // A hidden curse must not show up in the totals either, so they are
          // re-summed from the visible entries only.
          const visible = visibleEnchantments(this.item, { isGM: false });
          const ids = new Set(visible.map((entry) => entry?.id ?? ""));
          context.enchantmentEntries = context.enchantmentEntries.filter(
            (entry) => ids.has(entry.id),
          );
          context.enchantMods =
            this.item.type === "weapon"
              ? weaponEnchantMods(visible)
              : gearEnchantMods(visible);
        }
        break;
      case "attributesLight":
        context.tab = context.tabs[partId];
        // Choices for the animation type select.
        context.lightAnimations = this._getLightAnimationChoices();
        break;
      case "attributesRecipe": {
        context.tab = context.tabs[partId];
        // Resolve the linked result item for display (may live in a
        // compendium, so the async lookup is required).
        context.resultItem = this.item.system.resultUuid
          ? await fromUuid(this.item.system.resultUuid)
          : null;
        context.substanceRows = SUBSTANCES.map((def) => ({
          key: def.key,
          label: def.name,
          icon: def.icon,
          value: Number(this.item.system.substances?.[def.key]) || 0,
        }));
        context.baseChoices = [
          {
            key: "none",
            label: game.i18n.localize("REDSTEEL.Alchemy.Base.None"),
            selected: (this.item.system.base ?? "none") === "none",
          },
          ...Object.entries(BASES).map(([key, def]) => ({
            key,
            label: game.i18n.localize(def.labelKey),
            selected: this.item.system.base === key,
          })),
        ];
        // Order matches the Alchemist tree's node families (see ALCHEMIST_FAMILIES).
        context.outputTypeChoices = Object.keys(MAX_BATCH).map((key) => ({
          key,
          label: game.i18n.localize(
            `REDSTEEL.Alchemy.OutputType.${key.capitalize()}`,
          ),
          selected: (this.item.system.outputType ?? "potion") === key,
        }));
        // Purpose drives the recipe card's border tint on the Alchemy tab.
        // "" is a real choice: an untagged recipe keeps the default border.
        context.purposeChoices = [
          {
            key: "",
            label: game.i18n.localize("REDSTEEL.Alchemy.Purpose.None"),
            selected: !this.item.system.purpose,
          },
          ...RECIPE_PURPOSES.map((def) => ({
            key: def.key,
            label: game.i18n.localize(def.labelKey),
            selected: this.item.system.purpose === def.key,
          })),
        ];
        break;
      }
      case "attributesSpellbook": {
        context.tab = context.tabs[partId];
        // What the book holds, grouped by school in the sheet's own order, so
        // a stolen grimoire reads the way the Spells tab does. The records are
        // the book's own snapshot, so this reads with no compendium lookup.
        const entries = getBookEntries(this.item);
        const order = (key) => {
          const at = SPELL_SCHOOLS.indexOf(key);
          return at === -1 ? SPELL_SCHOOLS.length : at;
        };
        const groups = new Map();
        for (const entry of entries) {
          if (!groups.has(entry.school)) groups.set(entry.school, []);
          groups.get(entry.school).push({
            ...entry,
            index: entries.indexOf(entry),
            rankLabel: entry.rank
              ? game.i18n.localize(`REDSTEEL.Item.Spell.FIELDS.${entry.rank}.label`)
              : "",
          });
        }
        context.bookGroups = [...groups.entries()]
          .sort((a, b) => order(a[0]) - order(b[0]))
          .map(([school, spells]) => ({
            school,
            label: game.i18n.localize(
              `REDSTEEL.Actor.Character.schools.${school}.label`,
            ),
            spells: spells.sort((a, b) =>
              SPELL_RANKS.indexOf(a.rank) - SPELL_RANKS.indexOf(b.rank)
              || a.name.localeCompare(b.name, game.i18n.lang),
            ),
          }));
        context.bookCount = entries.length;
        context.bookCapacity = Number(this.item.system?.capacity) || 0;
        break;
      }
      case "attributesScroll": {
        context.tab = context.tabs[partId];
        // A case of scrolls versus one readable sheet. The case lists every
        // spell of its school and rank that the compendium knows; the single
        // sheet names its spell only once someone has identified it.
        const master = isMasterScroll(this.item);
        context.isMaster = master;
        context.identified = isScrollIdentified(this.item);
        // Drawing a scroll out of the case creates a document, so it stays a
        // GM tool; players read the case but cannot help themselves.
        context.canTakeOut = game.user.isGM && this.isEditable;
        const school = this.item.system?.school ?? "";
        const rank = this.item.system?.rank ?? "";
        context.schoolOptions = SCROLL_SCHOOLS.map((key) => ({
          key,
          label: game.i18n.localize(
            `REDSTEEL.Actor.Character.schools.${key}.label`,
          ),
          selected: school === key,
        }));
        context.rankOptions = SCROLL_RANKS.map((key) => ({
          key,
          label: game.i18n.localize(`REDSTEEL.Item.Spell.FIELDS.${key}.label`),
          selected: rank === key,
        }));
        if (master) {
          context.pool = await getScrollPool(school, rank);
        } else {
          const spell = this.item.system?.spell
            ? await fromUuid(this.item.system.spell)
            : null;
          context.spellName = spell
            ? (spell.localizedName ?? spell.name)
            : "";
          context.spellImg = spell?.img ?? "";
        }
        break;
      }
      case "attributesVariants": {
        context.tab = context.tabs[partId];
        // One entry per stored variant ID, with the resolved world Item (if any)
        context.variantEntries = this._getVariantArray().map((id, index) => {
          const item = typeof id === "string" ? game.items.get(id.trim()) : null;
          const valid = !!item && item.type === "spell";
          let name = "";
          if (valid) name = item.localizedName ?? item.name;
          else if (id) name = "— invalid —";
          return { index, id, name, valid };
        });
        break;
      }
      case "description":
        context.tab = context.tabs[partId];
        // An unidentified item shows players a hint instead of its prose.
        if (context.identifyHidden) {
          context.enrichedDescription = "";
          break;
        }
        // Enrich description info for display
        // Enrichment turns text like `[[/r 1d20]]` into buttons
        context.enrichedDescription = await TextEditor.enrichHTML(
          this.item.system.description,
          {
            // Whether to show secret blocks in the finished html
            secrets: this.document.isOwner,
            // Data to fill in for inline rolls
            rollData: this.item.getRollData(),
            // Relative UUID resolution
            relativeTo: this.item,
          },
        );
        break;
      case "effects":
        context.tab = context.tabs[partId];
        // Prepare active effects for easier access
        context.effects = prepareActiveEffectCategories(this.item.effects);
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
    // Default tab for first time it's rendered this session
    if (!this.tabGroups[tabGroup]) this.tabGroups[tabGroup] = "description";
    return parts.reduce((tabs, partId) => {
      const tab = {
        cssClass: "",
        group: tabGroup,
        // Matches tab property to
        id: "",
        // FontAwesome Icon, if you so choose
        icon: "",
        // Run through localization
        label: "REDSTEEL.Item.Tabs.",
      };
      switch (partId) {
        case "header":
        case "tabs":
          return tabs;
        case "description":
          tab.id = "description";
          tab.label += "Description";
          break;
        case "attributesFeature":
        case "attributesItem":
        case "attributesRace":
        case "attributesAbility":
        case "attributesConsumable":
        case "attributesGear":
        case "attributesAmmunition":
        case "attributesWeapon":
        case "attributesCondition":
        case "attributesRecipe":
        case "attributesEnchantment":
        case "attributesSpellbook":
        case "attributesScroll":
          tab.id = "attributes";
          tab.label += "Attributes";
          break;
        case "enchantments":
          tab.id = "enchantments";
          tab.label += "Enchantments";
          break;
        case "attributesOffhand":
          tab.id = "offhand";
          tab.label += "OffHand";
          break;
        case "attributesLight":
          tab.id = "light";
          tab.label += "Light";
          break;
        case "attributesSpell":
          tab.id = "attributes";
          tab.label += "Attributes";
          break;
        case "attributesVariants":
          tab.id = "variants";
          tab.label += "Variants";
          break;
        case "effects":
          tab.id = "effects";
          tab.label += "Effects";
          break;
        case "doctrines":
          tab.id = "doctrines";
          tab.label += "Doctrines";
          break;
        case "combatEffects":
          tab.id = "combatEffects";
          tab.label += "combatEffects";
          break;
      }
      if (this.tabGroups[tabGroup] === tab.id) tab.cssClass = "active";
      tabs[partId] = tab;
      return tabs;
    }, {});
  }

  /**
   * Actions performed after any render of the Application.
   * Post-render steps are not awaited by the render process.
   * @param {ApplicationRenderContext} context      Prepared context data
   * @param {RenderOptions} options                 Provided render options
   * @protected
   */
  _onRender(context, options) {
    this.#dragDrop.forEach((d) => d.bind(this.element));

    // Marks the window box for the tooltip engine, which parks its panels in
    // the free margin beside this rectangle instead of over the sheet.
    const root =
      this.element instanceof HTMLElement ? this.element : this.element?.[0];
    if (root) root.dataset.ttWindow = "";

    // You may want to add other special handling here
    // Foundry comes with a large number of utility classes, e.g. SearchFilter
    // That you may want to implement yourself.
  }

  /**************
   *
   *   ACTIONS
   *
   **************/

  /**
   * Handle changing a Document's image.
   *
   * @this RedsteelItemSheet
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
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _viewEffect(event, target) {
    const effect = this._getEffect(target);
    effect.sheet.render(true);
  }

  /**
   * Handles item deletion
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _deleteEffect(event, target) {
    const effect = this._getEffect(target);
    await effect.delete();
  }

  /**
   * Handle creating a new Owned Item or ActiveEffect for the actor using initial data defined in the HTML dataset
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _createEffect(event, target) {
    // Retrieve the configured document class for ActiveEffect
    const aeCls = getDocumentClass("ActiveEffect");
    // Prepare the document creation data by initializing it a default name.
    // As of v12, you can define custom Active Effect subtypes just like Item subtypes if you want
    const effectData = {
      name: aeCls.defaultName({
        // defaultName handles an undefined type gracefully
        type: target.dataset.type,
        parent: this.item,
      }),
    };
    // Loop through the dataset and add it to our effectData
    for (const [dataKey, value] of Object.entries(target.dataset)) {
      // These data attributes are reserved for the action handling
      if (["action", "documentClass"].includes(dataKey)) continue;
      // Nested properties require dot notation in the HTML, e.g. anything with `system`
      // An example exists in spells.hbs, with `data-system.spell-level`
      // which turns into the dataKey 'system.spellLevel'
      foundry.utils.setProperty(effectData, dataKey, value);
    }

    // Finally, create the embedded document!
    await aeCls.create(effectData, { parent: this.item });
  }

  /**
   * Determines effect parent to pass to helper
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @private
   */
  static async _toggleEffect(event, target) {
    const effect = this._getEffect(target);
    await effect.update({ disabled: !effect.disabled });
  }

  /**
   * Adds a new empty variant ID input to a spell
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _addVariant(event, target) {
    const variants = this._getVariantArray();
    variants.push("");
    await this.item.update({ "system.variants": variants });
  }

  /**
   * Removes a variant ID input from a spell
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  /**
   * Strike one spell out of a grimoire. The copies on the owner follow through
   * the update hook in utils/spellbook.mjs, which is what keeps the book the
   * record of truth.
   */
  static async _removeBookSpell(event, target) {
    const index = Number(target.dataset.index);
    const entries = getBookEntries(this.item);
    if (Number.isNaN(index) || index < 0 || index >= entries.length) return;
    entries.splice(index, 1);
    await this.item.update({ "system.spells": entries });
  }

  /**
   * Draw one scroll out of a master scroll (the case). The new concrete scroll
   * is created beside the case — on the same actor, or in the world Items
   * directory if the case is unowned — by utils/spellScrolls.mjs.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _takeOutScroll(event, target) {
    if (!game.user.isGM) return;
    const uuid = target.dataset.uuid;
    if (!uuid) return;
    await createConcreteScroll(this.item, uuid);
    this.render();
  }

  static async _removeVariant(event, target) {
    const index = Number(target.dataset.index);
    const variants = this._getVariantArray();
    if (Number.isNaN(index) || index < 0 || index >= variants.length) return;
    variants.splice(index, 1);
    await this.item.update({ "system.variants": variants });
  }

  /**
   * Append a new empty reroll pool to a feature.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _addRerollPool(event, target) {
    const pools = this._getRerollPoolArray();
    pools.push({ label: "", skillsRaw: "", max: 1, used: 0 });
    await this.item.update({ "system.reroll.pools": pools });
  }

  /**
   * Remove a reroll pool from a feature by index.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _removeRerollPool(event, target) {
    const index = Number(target.dataset.index);
    const pools = this._getRerollPoolArray();
    if (Number.isNaN(index) || index < 0 || index >= pools.length) return;
    pools.splice(index, 1);
    await this.item.update({ "system.reroll.pools": pools });
  }

  /**
   * Opens the sheet of the world spell Item a variant ID points to
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _openVariant(event, target) {
    const index = Number(target.dataset.index);
    const id = this._getVariantArray()[index];
    const item = typeof id === "string" ? game.items.get(id.trim()) : null;
    if (!item) {
      ui.notifications.warn("No world Item found for this variant ID.");
      return;
    }
    item.sheet.render(true);
  }

  /**
   * Unlink the recipe's crafting result.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _clearRecipeResult(event, target) {
    await this.item.update({ "system.resultUuid": "" });
  }

  /**
   * Unlink the recipe's special ingredient.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _clearRecipeSpecial(event, target) {
    await this.item.update({
      "system.specialIngredient": { name: "", uuid: "" },
    });
  }

  /**
   * Append a new empty choice group to a race Item.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _addRaceChoice(event, target) {
    const groups = this._getRaceChoiceArray();
    groups.push({ label: "", count: 1, effectIds: [] });
    await this.item.update({ "system.choices": groups });
  }

  /**
   * Remove a choice group from a race Item by index.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _removeRaceChoice(event, target) {
    const index = Number(target.dataset.index);
    const groups = this._getRaceChoiceArray();
    if (Number.isNaN(index) || index < 0 || index >= groups.length) return;
    groups.splice(index, 1);
    await this.item.update({ "system.choices": groups });
  }

  /**
   * Toggle whether an Active Effect belongs to a choice group's effectIds.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _toggleRaceChoiceEffect(event, target) {
    const groupIndex = Number(target.dataset.groupIndex);
    const effectId = target.dataset.effectId;
    if (Number.isNaN(groupIndex) || !effectId) return;

    const groups = this._getRaceChoiceArray();
    const group = groups[groupIndex];
    if (!group) return;

    const memberIndex = group.effectIds.indexOf(effectId);
    if (target.checked) {
      if (memberIndex === -1) group.effectIds.push(effectId);
    } else if (memberIndex !== -1) {
      group.effectIds.splice(memberIndex, 1);
    }

    await this.item.update({ "system.choices": groups });
  }

  /**
   * Remove a granted feature from a race Item by index.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _removeRaceGrant(event, target) {
    const index = Number(target.dataset.index);
    const groups = this._getRaceGrantArray();
    if (Number.isNaN(index) || index < 0 || index >= groups.length) return;
    groups.splice(index, 1);
    await this.item.update({ "system.grants": groups });
  }

  /** Open the Arcana identify window for this item's owner. */
  static async _identifyItem() {
    const actor = this.item.actor;
    if (!actor) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Identify.Warn.NoActor"));
      return;
    }
    await openIdentifyWindow(actor, this.item);
  }

  /**
   * Strip one applied enchantment off this weapon / gear item. Identified by
   * the random id stored with the snapshot, not by index, so removing one row
   * cannot shift another out from under the click.
   *
   * @this RedsteelItemSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @protected
   */
  static async _removeEnchantment(event, target) {
    const id = target.dataset.enchantmentId;
    if (!id) return;
    const entries = readEnchantments(this.item);
    const next = entries.filter((entry) => entry?.id !== id);
    if (next.length === entries.length) return;
    const removed = entries.find((entry) => entry?.id === id);
    await this.item.setFlag("redsteel", "enchantments", next);
    ui.notifications.info(
      game.i18n.format("REDSTEEL.Enchantment.Removed", {
        name: removed?.name ?? "",
      }),
    );
  }

  /** Helper Functions */

  /**
   * Light animation type choices, sourced from Foundry's registered light
   * animations. The leading blank entry represents "None".
   * @returns {{value: string, label: string}[]}
   */
  _getLightAnimationChoices() {
    const anims = CONFIG.Canvas?.lightAnimations ?? {};
    const choices = Object.entries(anims).map(([value, cfg]) => ({
      value,
      label: game.i18n.localize(cfg.label ?? value),
    }));
    choices.sort((a, b) => a.label.localeCompare(b.label));
    return choices;
  }

  /**
   * Returns the spell's variant IDs as a plain array.
   * Form submission can store the list as an object, so normalize.
   * @returns {string[]}
   */
  _getVariantArray() {
    const raw = this.item.system.variants;
    const ids = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    return ids.map((id) => (typeof id === "string" ? id : ""));
  }

  /**
   * Reroll pools as a normalized array. Tolerates the array becoming an indexed
   * object after a form submit (same quirk as {@link _getVariantArray}).
   * @returns {{label:string, skillsRaw:string, max:number, used:number}[]}
   */
  _getRerollPoolArray() {
    const raw = this.item.system?.reroll?.pools;
    const pools = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    return pools.map((p) => ({
      label: p?.label ?? "",
      skillsRaw: p?.skillsRaw ?? "",
      max: Number(p?.max) || 0,
      used: Number(p?.used) || 0,
    }));
  }

  /**
   * Race choice groups as a normalized array. Tolerates the array becoming an
   * indexed object after a form submit (same quirk as {@link _getRerollPoolArray}).
   * Unlike the runtime resolver in utils/race.mjs, empty groups are kept so the
   * author can add a group before assigning any effects to it.
   * @returns {{label:string, count:number, effectIds:string[]}[]}
   */
  _getRaceChoiceArray() {
    const raw = this.item.system?.choices;
    const groups = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    return groups.map((group) => {
      const rawIds = group?.effectIds;
      const ids = Array.isArray(rawIds) ? rawIds : Object.values(rawIds ?? {});
      return {
        label: group?.label ?? "",
        count: Math.max(1, Number(group?.count) || 1),
        effectIds: ids.filter((id) => typeof id === "string" && id),
      };
    });
  }

  /**
   * The enchantments applied to this weapon / gear item, each with a short
   * human-readable summary of what it grants, for the Enchantments tab. Reads
   * the stored snapshots — nothing here resolves the source Item, which is the
   * whole point of snapshotting them at drop time.
   * @returns {{id: string, name: string, img: string, tier: number, summary: string}[]}
   */
  _getEnchantmentArray() {
    return readEnchantments(this.item).map((entry) => ({
      id: entry?.id ?? "",
      name: entry?.name ?? "",
      img: entry?.img ?? "",
      tier: Number(entry?.tier) || 0,
      summary: this._summarizeEnchantment(entry),
    }));
  }

  /**
   * Compact "+5 Attack, +1d4 fire, Bleed 25%" line for one applied
   * enchantment. Display only — the real numbers come from system.enchantMods.
   * @param {object} entry
   * @returns {string}
   */
  _summarizeEnchantment(entry) {
    const mods = entry?.mods ?? {};
    const effects = entry?.effects ?? {};
    const parts = [];
    const signed = (value) => (value > 0 ? `+${value}` : `${value}`);
    const numeric = (key, labelKey) => {
      const value = Number(mods[key]) || 0;
      if (value) parts.push(`${signed(value)} ${game.i18n.localize(labelKey)}`);
    };

    // The costs lead. An item that eats Mind, gates on Faith or spends a
    // resource should say so before it lists everything it gives back.
    const reserve = Number(entry?.mindReserve) || 0;
    if (reserve) {
      parts.push(
        `-${reserve} ${game.i18n.localize(
          "REDSTEEL.Enchantment.FIELDS.mindReserve.label",
        )}`,
      );
    }
    const faithGate = Number(entry?.requiredFaith) || 0;
    if (faithGate) {
      parts.push(
        `${game.i18n.localize(
          "REDSTEEL.Enchantment.FIELDS.requiredFaith.label",
        )} ${faithGate}`,
      );
    }
    const costAmount = Number(entry?.cost?.amount) || 0;
    if (entry?.cost?.resource && costAmount) {
      parts.push(`${costAmount} ${resourceLabel(entry.cost.resource)}`);
    }
    const chargeMax = Number(entry?.charges?.max) || 0;
    if (chargeMax) {
      const held = Number(entry?.charges?.value) || 0;
      parts.push(
        `${game.i18n.localize(
          "REDSTEEL.Enchantment.FIELDS.chargesMax.label",
        )} ${held}/${chargeMax}`,
      );
    }
    if (entry?.bound) {
      parts.push(game.i18n.localize("REDSTEEL.Enchantment.FIELDS.bound.label"));
    }

    // Weapon side
    numeric("attack", "REDSTEEL.Item.Weapon.FIELDS.attack.label");
    numeric("damageBonus", "REDSTEEL.Enchantment.FIELDS.damageBonus.label");
    if (mods.damageRoll) parts.push(`+${mods.damageRoll}`);
    numeric("penetration", "REDSTEEL.Item.Weapon.FIELDS.penetration.label");
    numeric("critRange", "REDSTEEL.Item.Weapon.FIELDS.critRange.label");
    numeric("critChance", "REDSTEEL.Item.Weapon.FIELDS.critChance.label");
    numeric("critDamage", "REDSTEEL.Item.Weapon.FIELDS.critDamage.label");
    numeric("dodge", "REDSTEEL.Item.Weapon.FIELDS.dodge.label");
    if (mods.breakthroughRoll) {
      parts.push(
        `${game.i18n.localize("REDSTEEL.Item.Weapon.FIELDS.breakthrough.label")} ${mods.breakthroughRoll}`,
      );
    }
    const damageTypes = Array.isArray(mods.damageTypes) ? mods.damageTypes : [];
    if (damageTypes.length) parts.push(damageTypes.join(" / "));

    // Gear side
    numeric("armorValue", "REDSTEEL.Enchantment.FIELDS.armorValue.label");
    numeric("defense", "REDSTEEL.Item.Weapon.FIELDS.defense.label");
    numeric("rangedDefense", "REDSTEEL.Item.Gear.FIELDS.rangedDefense.label");
    numeric("critDefense", "REDSTEEL.Item.Weapon.FIELDS.critDefense.label");
    numeric(
      "rangedCritDefense",
      "REDSTEEL.Item.Gear.FIELDS.rangedCritDefense.label",
    );
    numeric("healthBonus", "REDSTEEL.Item.Gear.FIELDS.healthBonus.label");
    for (const [type, value] of Object.entries(mods.resist ?? {})) {
      const amount = Number(value) || 0;
      if (!amount) continue;
      parts.push(
        `${signed(amount)} ${game.i18n.localize(
          `REDSTEEL.Item.Gear.FIELDS.${type}.label`,
        )}`,
      );
    }

    // Combat effects, named the same way the attack card names them.
    const chance = (value) => (Number(value) === -1 ? "AUTO" : `${value}%`);
    if (Number(effects.stagger)) {
      parts.push(
        `${game.i18n.localize("REDSTEEL.Item.Weapon.FIELDS.stagger.label")} ${chance(effects.stagger)}`,
      );
    }
    if (Number(effects.bleed)) {
      parts.push(
        `${game.i18n.localize("REDSTEEL.Item.Weapon.FIELDS.bleed.label")} ${chance(effects.bleed)}`,
      );
    }
    for (let i = 1; i <= 3; i++) {
      const value = Number(effects[`extra${i}`]) || 0;
      if (!value) continue;
      const type = entry?.[`effectType${i}`] ?? "";
      const name =
        type === "custom" ? (effects[`effectName${i}`] ?? "") : type;
      if (!name) continue;
      parts.push(`${name} ${chance(value)}`);
    }

    return parts.join(", ");
  }

  /**
   * Race grant entries as a normalized array. Tolerates the array becoming an
   * indexed object after a form submit (same quirk as {@link _getRerollPoolArray}).
   * @returns {{uuid: string, name: string, img: string}[]}
   */
  _getRaceGrantArray() {
    const raw = this.item.system?.grants;
    const entries = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    return entries
      .map((entry) => ({
        uuid: entry?.uuid ?? "",
        name: entry?.name ?? "",
        img: entry?.img ?? "",
      }))
      .filter((entry) => typeof entry.uuid === "string" && entry.uuid);
  }

  /**
   * Fetches the row with the data for the rendered embedded document
   *
   * @param {HTMLElement} target  The element with the action
   * @returns {HTMLLIElement} The document's row
   */
  _getEffect(target) {
    const li = target.closest(".effect");
    return this.item.effects.get(li?.dataset?.effectId);
  }

  /**
   *
   * DragDrop
   *
   */

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
    const li = event.currentTarget;
    if ("link" in event.target.dataset) return;

    let dragData = null;

    // Active Effect
    if (li.dataset.effectId) {
      const effect = this.item.effects.get(li.dataset.effectId);
      dragData = effect.toDragData();
    }

    if (!dragData) return;

    // Set data transfer
    event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
  }

  /**
   * Callback actions which occur when a dragged element is over a drop target.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  _onDragOver(event) {}

  /**
   * Callback actions which occur when a dragged element is dropped on a target.
   * @param {DragEvent} event       The originating DragEvent
   * @protected
   */
  async _onDrop(event) {
    const data = TextEditor.getDragEventData(event);
    const item = this.item;
    const allowed = Hooks.call("dropItemSheetData", item, this, data);
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

  /* -------------------------------------------- */

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
    if (!this.item.isOwner || !effect) return false;

    if (this.item.uuid === effect.parent?.uuid)
      return this._onEffectSort(event, effect);
    return aeCls.create(effect, { parent: this.item });
  }

  /**
   * Sorts an Active Effect based on its surrounding attributes
   *
   * @param {DragEvent} event
   * @param {ActiveEffect} effect
   */
  _onEffectSort(event, effect) {
    const effects = this.item.effects;
    const dropTarget = event.target.closest("[data-effect-id]");
    if (!dropTarget) return;
    const target = effects.get(dropTarget.dataset.effectId);

    // Don't sort on yourself
    if (effect.id === target.id) return;

    // Identify sibling items based on adjacent HTML elements
    const siblings = [];
    for (let el of dropTarget.parentElement.children) {
      const siblingId = el.dataset.effectId;
      if (siblingId && siblingId !== effect.id)
        siblings.push(effects.get(el.dataset.effectId));
    }

    // Perform the sort
    const sortUpdates = SortingHelpers.performIntegerSort(effect, {
      target,
      siblings,
    });
    const updateData = sortUpdates.map((u) => {
      const update = u.update;
      update._id = u.target._id;
      return update;
    });

    // Perform the update
    return this.item.updateEmbeddedDocuments("ActiveEffect", updateData);
  }

  /* -------------------------------------------- */

  /**
   * Handle dropping of an Actor data onto another Actor sheet
   * @param {DragEvent} event            The concluding DragEvent which contains drop data
   * @param {object} data                The data transfer extracted from the event
   * @returns {Promise<object|boolean>}  A data object which describes the result of the drop, or false if the drop was
   *                                     not permitted.
   * @protected
   */
  async _onDropActor(event, data) {
    if (!this.item.isOwner) return false;
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
    if (!this.item.isOwner) return false;

    // Races accept feature drops: the feature is listed in system.grants and
    // copied onto every actor owning the race (see utils/raceGrants.mjs).
    if (this.item.type === "race") {
      const dropped = await Item.implementation.fromDropData(data);
      if (!dropped) return false;

      if (dropped.type !== "feature") {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Race.Grants.DropRejected"),
        );
        return false;
      }
      // A grant must resolve on every actor, so it has to point at a world or
      // compendium Item — an actor-owned copy's UUID is meaningless elsewhere.
      if (dropped.parent?.documentName === "Actor") {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Race.Grants.DropNotGlobal"),
        );
        return false;
      }

      const next = this._getRaceGrantArray();
      if (next.some((entry) => entry.uuid === dropped.uuid)) {
        ui.notifications.info(
          game.i18n.format("REDSTEEL.Race.Grants.DropDuplicate", {
            name: dropped.name,
          }),
        );
        return false;
      }

      next.push({ uuid: dropped.uuid, name: dropped.name, img: dropped.img });
      await this.item.update({ "system.grants": next });
      ui.notifications.info(
        game.i18n.format("REDSTEEL.Race.Grants.Added", { name: dropped.name }),
      );
      return true;
    }

    // A grimoire accepts spell drops: the spell is written into system.spells
    // and the owner's copies follow (see utils/spellbook.mjs). The record keeps
    // the compendium uuid, so an actor-owned copy is no use here.
    if (this.item.type === "spellbook") {
      const dropped = await Item.implementation.fromDropData(data);
      if (!dropped) return false;
      if (dropped.type !== "spell") {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Spellbook.DropRejected"),
        );
        return false;
      }
      if (dropped.parent?.documentName === "Actor") {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Spellbook.DropNotGlobal"),
        );
        return false;
      }
      const entries = getBookEntries(this.item);
      if (entries.some((entry) => entry.uuid === dropped.uuid)) {
        ui.notifications.info(
          game.i18n.format("REDSTEEL.Spellbook.DropDuplicate", {
            name: dropped.name,
          }),
        );
        return false;
      }
      entries.push({
        uuid: dropped.uuid,
        name: dropped.name,
        img: dropped.img,
        school: dropped.system?.type ?? "",
        rank: dropped.system?.rank ?? "",
      });
      await this.item.update({ "system.spells": entries });
      ui.notifications.info(
        game.i18n.format("REDSTEEL.Spellbook.DropAdded", { name: dropped.name }),
      );
      return true;
    }

    // Weapons and gear accept enchantment drops: the enchantment is copied
    // onto the item as a frozen snapshot (see the comment on the push below)
    // and summed into system.enchantMods by documents/item.mjs.
    if (this.item.type === "weapon" || this.item.type === "gear") {
      const dropped = await Item.implementation.fromDropData(data);
      if (!dropped) return false;

      if (dropped.type !== "enchantment") {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Enchantment.DropRejected"),
        );
        return false;
      }

      // A weapon enchantment cannot be hammered into a breastplate.
      const slot = dropped.system.slot === "gear" ? "gear" : "weapon";
      if (slot !== this.item.type) {
        ui.notifications.warn(
          game.i18n.format("REDSTEEL.Enchantment.WrongSlot", {
            name: dropped.localizedName ?? dropped.name,
          }),
        );
        return false;
      }

      // Optional weapon-class gate (axe / bow / …). Blank means any.
      const requiredClass = String(dropped.system.requiredClass ?? "").trim();
      if (requiredClass && requiredClass !== this.item.system.class) {
        ui.notifications.warn(
          game.i18n.format("REDSTEEL.Enchantment.WrongClass", {
            name: dropped.localizedName ?? dropped.name,
            class: requiredClass,
          }),
        );
        return false;
      }

      // Cloned before pushing: mutating the stored flag array in place would
      // leave nothing for the update to diff against, and the write would be
      // silently dropped.
      const entries = foundry.utils.deepClone(readEnchantments(this.item));
      if (entries.some((entry) => entry?.uuid === dropped.uuid)) {
        ui.notifications.info(
          game.i18n.format("REDSTEEL.Enchantment.Duplicate", {
            name: dropped.localizedName ?? dropped.name,
          }),
        );
        return false;
      }

      // Frozen snapshot, never a live link: the sword stays enchanted even if
      // the source enchantment is later edited, deleted, or its pack goes
      // missing. Mirrors the poison coating in utils/usePoison.mjs.
      entries.push({
        id: foundry.utils.randomID(),
        name: dropped.localizedName ?? dropped.name,
        img: dropped.img,
        uuid: dropped.uuid,
        tier: Number(dropped.system.tier) || 0,
        // Mind points this enchantment locks away while its host item is
        // equipped. Snapshotted like everything else here, so re-costing the
        // source enchantment never silently re-costs swords already made.
        mindReserve: Number(dropped.system.mindReserve) || 0,

        // Itemisation group and everything that hangs off it. All snapshotted,
        // so editing the source enchantment later never changes a sword that
        // was already forged with it.
        group: dropped.system.group ?? "",
        bound: !!dropped.system.bound,
        requiredFaith: Number(dropped.system.requiredFaith) || 0,
        activation: foundry.utils.deepClone(dropped.system.activation ?? {}),
        cost: foundry.utils.deepClone(dropped.system.cost ?? {}),
        risk: foundry.utils.deepClone(dropped.system.risk ?? {}),
        // The ceiling and the refill rule are authored on the enchantment, but
        // the charges *remaining* belong to this host item: two amulets made
        // from the same enchantment are spent independently. A fresh item
        // arrives full.
        charges: {
          max: Math.max(0, Number(dropped.system.charges?.max) || 0),
          value: Math.max(0, Number(dropped.system.charges?.max) || 0),
          recharge: dropped.system.charges?.recharge ?? "",
        },

        mods: foundry.utils.deepClone(
          (slot === "gear"
            ? dropped.system.gearMods
            : dropped.system.weaponMods) ?? {},
        ),
        effects: foundry.utils.deepClone(dropped.system.effects ?? {}),
        effectType1: dropped.system.effectType1 ?? "",
        effectType2: dropped.system.effectType2 ?? "",
        effectType3: dropped.system.effectType3 ?? "",
      });
      await this.item.setFlag("redsteel", "enchantments", entries);
      ui.notifications.info(
        game.i18n.format("REDSTEEL.Enchantment.Added", {
          name: dropped.localizedName ?? dropped.name,
          target: this.item.localizedName ?? this.item.name,
        }),
      );
      return true;
    }

    // Recipes accept drops: a consumable becomes the crafting result, an
    // "item"-type document becomes the linked special ingredient.
    if (this.item.type !== "recipe") return false;
    const dropped = await Item.implementation.fromDropData(data);
    if (!dropped) return false;

    if (dropped.type === "consumable") {
      await this.item.update({ "system.resultUuid": dropped.uuid });
      ui.notifications.info(
        game.i18n.format("REDSTEEL.Alchemy.Recipe.ResultLinked", {
          name: dropped.name,
        }),
      );
      return true;
    }
    // A craftable base is an "item", not a consumable — Dream dew has to be
    // findable by the base lookup, which only reads that type. It is the
    // recipe RESULT, never the special ingredient.
    if (dropped.type === "item" && dropped.getFlag?.("redsteel", "alchBase")) {
      await this.item.update({ "system.resultUuid": dropped.uuid });
      ui.notifications.info(
        game.i18n.format("REDSTEEL.Alchemy.Recipe.ResultLinked", {
          name: dropped.name,
        }),
      );
      return true;
    }
    if (dropped.type === "item") {
      await this.item.update({
        "system.specialIngredient": { name: dropped.name, uuid: dropped.uuid },
      });
      ui.notifications.info(
        game.i18n.format("REDSTEEL.Alchemy.Recipe.SpecialLinked", {
          name: dropped.name,
        }),
      );
      return true;
    }
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.Alchemy.Recipe.DropRejected"),
    );
    return false;
  }

  /* -------------------------------------------- */

  /**
   * Handle dropping of a Folder on an Actor Sheet.
   * The core sheet currently supports dropping a Folder of Items to create all items as owned items.
   * @param {DragEvent} event     The concluding DragEvent which contains drop data
   * @param {object} data         The data transfer extracted from the event
   * @returns {Promise<Item[]>}
   * @protected
   */
  async _onDropFolder(event, data) {
    if (!this.item.isOwner) return [];
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
}

/** "+10" / "0" / "-30", the way every difficulty in the system is printed. */
function fmtSigned(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : String(n);
}
