/**
 * Stat block of the "Improvised shield" compendium item
 * (src/packs/redsteel-items/.../gear_Improvised_shield_cfblSb9uigt23fRA.json).
 * A shield broken down to 0 durability ignores its own stat block and
 * behaves like an improvised shield instead.
 */
export const IMPROVISED_SHIELD_STATS = {
  defense: 5,
  rangedDefense: 10,
  critDefense: 0,
  rangedCritDefense: 0,
  dodgePenalty: -5,
  iniPenalty: 0,
  maxSpeed: 0,
};

/**
 * Item quality (Kvalita) modifiers, applied on top of an item's hand-entered
 * base stats. The active column depends on how the item is used:
 *   weapon  → main-hand weapon       (Zbraň)
 *   offhand → weapon used off-hand   (Druhá ruka)
 *   shield  → gear flagged as shield (Štít)
 *   armor   → all other gear         (Zbroje)
 * Stat keys map to: attack/defense/critChance/critDefense/critDodge/rangedDefense/
 * rangedCritDefense (weapon system fields), precision (an attack extra effect),
 * deflect (Odklonění, a defender effect) and ini (initiative, via iniPenalty).
 */
export const QUALITY_MODS = {
  weapon: {
    bad: { attack: -5, defense: -5 },
    normal: {},
    expert: { attack: 3, defense: 3 },
    master: { attack: 5, defense: 5, precision: 5 },
    legendary: { attack: 8, defense: 8, precision: 10, critChance: 3 },
  },
  offhand: {
    bad: { defense: -3, rangedDefense: -5 },
    normal: {},
    expert: { critDefense: 1 },
    master: { critDefense: 2, critDodge: 1 },
    legendary: { critDefense: 3, critDodge: 3 },
  },
  shield: {
    bad: { defense: -3, rangedDefense: -5 },
    normal: {},
    expert: { critDefense: 2, rangedCritDefense: 2 },
    master: { critDefense: 3, rangedCritDefense: 3 },
    legendary: { critDefense: 5, rangedCritDefense: 5 },
  },
  armor: {
    bad: { ini: -1 },
    normal: {},
    expert: { rangedDefense: 3 },
    master: { deflect: 3, rangedDefense: 5 },
    legendary: { deflect: 5, rangedDefense: 5, defense: 3 },
  },
};

const QUALITY_KEYS = ["bad", "normal", "expert", "master", "legendary"];

/**
 * Resolve the quality modifiers for an item slot, falling back to the empty
 * `normal` block for unknown values so callers can always spread the result.
 */
function qualityModsFor(slot, quality) {
  const column = QUALITY_MODS[slot] ?? {};
  return column[quality] ?? column.normal ?? {};
}

/**
 * Extend the basic Item with some very simple modifications.
 * @extends {Item}
 */
export class RedsteelItem extends Item {
  get localizedName() {
    const key = this.system.localizationKey?.trim();
    if (!key || !game.i18n.has(key)) return this.name;
    return game.i18n.localize(key);
  }

  /**
   * The description in the active language. Mirrors {@link localizedName}: the
   * pack stores the English prose in `system.description` (that is what the
   * item sheet edits) and the translation lives under the item's localization
   * key with `.name` swapped for `.description`. Items with no translation —
   * which is most of them — fall back to the stored text unchanged.
   */
  get localizedDescription() {
    const raw = this.system.description ?? "";
    const key = this.system.localizationKey?.trim();
    if (!key) return raw;
    const descriptionKey = key.replace(/\.name$/, ".description");
    if (!game.i18n.has(descriptionKey)) return raw;
    return game.i18n.localize(descriptionKey);
  }

  /**
   * NPCs may only ever carry *trait* features. Plain features and priest
   * features are character progression items — the NPC sheet never offers a
   * button to create them, but a drag from the sidebar or a compendium would
   * otherwise slip one in. Guarding here catches every route: sheet drop,
   * folder drop, the create buttons, and API calls.
   * @param {Actor|null} actor   The prospective owner
   * @param {Item} item          The feature being placed / retyped
   * @param {string} option      The `system.option` it would end up with
   * @returns {boolean}          True when this actor may not hold it
   */
  static #rejectsFeature(actor, item, option) {
    if (actor?.type !== "npc") return false;
    if (item.type !== "feature") return false;
    return option !== "trait";
  }

  /** @override */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    if (
      RedsteelItem.#rejectsFeature(this.parent, this, this.system?.option)
    ) {
      ui.notifications?.warn(
        game.i18n.format("REDSTEEL.Feature.NpcTraitOnly", { name: this.name }),
      );
      return false;
    }
  }

  /** @override */
  async _preUpdate(changed, options, user) {
    const allowed = await super._preUpdate(changed, options, user);
    if (allowed === false) return false;

    // Flat (`{"system.option": ...}`) and expanded (sheet submit) update shapes.
    const nextOption = changed["system.option"] ?? changed.system?.option;
    if (
      nextOption !== undefined &&
      RedsteelItem.#rejectsFeature(this.parent, this, nextOption)
    ) {
      ui.notifications?.warn(
        game.i18n.format("REDSTEEL.Feature.NpcTraitOnly", { name: this.name }),
      );
      return false;
    }
  }

  /**
   * Active Effects authored on a consumable (potion / poison) are *blueprints*:
   * they only take hold when the item is actually used — at which point they
   * are copied onto the drinker (see usePotion). Suppress Foundry's default
   * behaviour of auto-applying an item's effects to its owner just by carrying
   * it, so a potion in the backpack does nothing until consumed.
   * @override
   */
  get transferredEffects() {
    if (this.type === "consumable") return [];
    return super.transferredEffects;
  }

  /**
   * A shield only counts as broken when it tracks durability
   * (durabilityMax > 0) and has been reduced to 0.
   */
  get isBrokenShield() {
    if (this.type !== "gear" || !this.system.shield) return false;
    const max = Number(this.system.armor?.durabilityMax ?? 0);
    return max > 0 && Number(this.system.armor?.durability ?? 0) <= 0;
  }

  /**
   * Combat stats this shield currently grants. Broken shields fall back
   * to the improvised shield stat block instead of their own.
   * @returns {typeof IMPROVISED_SHIELD_STATS}
   */
  getShieldStats() {
    if (this.isBrokenShield) return { ...IMPROVISED_SHIELD_STATS };

    // Shield quality (Štít column) is layered on top of the base stat block.
    const q = this.system.qualityMods ?? {};

    return {
      defense: (this.system.defense ?? 0) + (q.defense ?? 0),
      rangedDefense: (this.system.rangedDefense ?? 0) + (q.rangedDefense ?? 0),
      critDefense: (this.system.critDefense ?? 0) + (q.critDefense ?? 0),
      rangedCritDefense:
        (this.system.rangedCritDefense ?? 0) + (q.rangedCritDefense ?? 0),
      dodgePenalty: this.system.dodgePenalty ?? 0,
      iniPenalty: this.system.iniPenalty ?? 0,
      maxSpeed: this.system.maxSpeed ?? 0,
    };
  }

  /**
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

    // Item quality (Kvalita): expose the option list + localized choices for the
    // sheet dropdown, and derive the active modifier blocks. Stored separately
    // from the base stat fields so sheet inputs keep showing/saving raw values.
    if (this.type === "weapon" || this.type === "gear") {
      this.system.quality ??= "normal";
      this.system.qualityOptions = [...QUALITY_KEYS];
      this.system.qualityChoices = Object.fromEntries(
        QUALITY_KEYS.map((key) => [
          key,
          game.i18n.localize(`REDSTEEL.Quality.${key}`),
        ]),
      );

      const q = this.system.quality;
      if (this.type === "weapon") {
        this.system.qualityMods = qualityModsFor("weapon", q);
        this.system.offhandQualityMods = qualityModsFor("offhand", q);
      } else {
        this.system.qualityMods = qualityModsFor(
          this.system.shield ? "shield" : "armor",
          q,
        );
      }
    }

    if (this.type === "ammunition") {
      this.system.options = [
        "arrows",
        "bolts",
        "stones",
        "axes",
        "javelins",
        "knives",
      ];
    }

    // Sync rollTriggersRaw (comma-separated string) ↔ rollTriggers (array)
    // This lets the item sheet use a plain text input for editing triggers.
    if (this.type === "feature") {
      const raw = this.system.rollTriggersRaw ?? "";
      if (raw) {
        this.system.rollTriggers = raw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
      } else if (Array.isArray(this.system.rollTriggers)) {
        this.system.rollTriggersRaw = this.system.rollTriggers.join(", ");
      }

      // Sync statusEffectsRaw (comma-separated string) ↔ statusEffects (array).
      // Status effect ids are case-sensitive (e.g. "iceStrike"), so preserve case.
      const statusRaw = this.system.statusEffectsRaw ?? "";
      if (statusRaw) {
        this.system.statusEffects = statusRaw
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (Array.isArray(this.system.statusEffects)) {
        this.system.statusEffectsRaw = this.system.statusEffects.join(", ");
      }
    }

    // Only initialize effectTypes for relevant items (e.g., spells, consumables)

    if (
      this.type === "spell" ||
      this.type === "ability" ||
      this.type === "weapon" ||
      this.type === "consumable"
    ) {
      this.system.effectTypes = [
        "custom",
        "bleed",
        "blind",
        "burn",
        "chain",
        "corrosion",
        "corrosion_severe",
        "crippled",
        "dazzled",
        "disorientation",
        "dispell",
        "fear",
        "flammable",
        "freeze",
        "paralyze",
        "poison",
        "precision",
        "root",
        "shadowbound",
        "shield_strain",
        "shield_break",
        "slow",
        "soul_mark",
        "stagger",
        "stun",
        "terror",
        "vulnerable",
        "weak",
        "wet",
      ];

      this.system.dmgTypes = [
        "blunt",
        "piercing",
        "slash",
        "physical",
        "acid",
        "dark",
        "fire",
        "frost",
        "lightning",
        "magic",
        "poison",
        "psychic",
      ];

      this.system.testOptions = [
        "strength",
        "dexterity",
        "endurance",
        "inteligence",
        "will",
        "charisma",
        "perception",
        "leadership",
        "channeling",
        // Rolls d12 + Initiative + Speed instead of a d100
        // margin of success — see module/utils/speedTest.mjs.
        "speed",
      ];

      if (this.type === "spell" || this.type === "ability") {
        this.system.resourceOptions = {
          modes: ["add", "drain"],
          types: [
            "Health",
            "Stamina",
            "Mana",
            // Spirit spells reserve or drain Mind points. The consumption code
            // resolves `type.toLowerCase()` against `system.stats`, and
            // `stats.mind` already exists on both actor types, so listing it
            // here is all that is needed.
            "Mind",
            "Toxicity",
            "Corruption",
            "TemporaryHealth",
            "TemporaryHealthMagic",
          ],
        };
      }

      if (this.type === "ability") {
        this.system.typeOptions = ["melee", "ranged", "other"];
        this.system.classOptions = ["movement", "attack", "defense", "stance"];
      }
    }

    if (this.system.roll) {
      // A spell that deals no direct damage (Poisoned blood, Coagulation …) can
      // have these left null/empty by the sheet. Coerce to 0 so the formula is
      // always a valid one — "nulld" reaches Roll as an unresolvable term and
      // throws on evaluate, taking the whole cast down with it.
      const diceNum = Number(this.system.roll.diceNum) || 0;
      const diceSize = Number(this.system.roll.diceSize) || 0;
      const diceBonus = this.system.roll.diceBonus ?? 0;

      let formula = "";

      if (this.type === "consumable" || this.type === "spell") {
        // Define a unique formula for consumables
        formula = `${diceNum}d${diceSize} ${diceBonus ? `+${diceBonus}` : ""}`;
      } else {
        // Default to Strength
        let attr = "str";

        if (this.actor) {
          let str = this.actor.system.attributes.str.total;
          let dex = this.actor.system.attributes.dex.total;
          let per = this.actor.system.attributes.per.total;

          // Check if the actor owns an item named "Finesse"
          const hasFinesse = this.actor.items.some(
            (item) => item.name.toLowerCase() === "finesse",
          );
          // Check if the actor owns an item named "Giant"
          const hasGiant = this.actor.items.some(
            (item) => item.name.toLowerCase() === "giant",
          );

          // Check if *this* weapon has finesse
          if (this.system.finesse === true && hasFinesse && str <= dex) {
            attr = "dex"; // Use Dexterity if all conditions are met
          }

          // Check if *this* weapon is bow or crossbow
          if (this.system.class === "crossbow" || this.system.class === "bow") {
            attr = "per"; // Use Perception if ranged weapon
          }

          // Check if *this* weapon is throwing and compare str with per
          if (this.system.thrown && str <= per) {
            attr = "per";
            // Check if *this* weapon has finesse
            if (
              this.system.finesse === true &&
              hasFinesse &&
              str <= dex &&
              str <= per
            ) {
              attr = "dex"; // Use Dexterity if all conditions are met
            }
          }
          if (
            hasGiant &&
            this.system.class !== "crossbow" &&
            this.system.class !== "bow"
          ) {
            formula = `${diceNum}d${diceSize} + 1d4 ${diceBonus ? `+${diceBonus}` : ""} + @${attr}`;
          } else {
            formula = `${diceNum}d${diceSize} ${diceBonus ? `+${diceBonus}` : ""} + @${attr}`;
          }
          if (this.actor.type === "npc") {
            formula = `${diceNum}d${diceSize}  ${
              diceBonus ? `+${diceBonus}` : ""
            } + ${this.actor.system.combatSkills.damageBonus.value}`;
          }
        }
      }

      // Store the formula in system.formula
      this.system.formula = formula;

      // Potentially possible to add roll.total and roll.toMessage
    }

    if (this.type === "ability") {
      this._prepareAbilityRollData();
    }
  }

  _prepareAbilityRollData() {
    const raw = this.system.roll?.diceBonus;

    const parsed = this._parseAbilityDiceBonus(raw);

    // Roll-safe value
    this.system.roll.diceBonusFormula = parsed.formula;

    // Semantic flags
    this.system.roll.halfDamage = parsed.half;
    this.system.roll.penCap = parsed.penCap;

    // Extra damage that only applies when the attack is made with a Heavy
    // weapon (Zteč: "Dodatečné zranění +2d4, pokud používá Těžkou zbraň").
    // Applied in runAttackMacro / basicAttack once the weapon is resolved.
    this.system.roll.heavyDiceBonusFormula = this._parseAbilityDiceBonus(
      this.system.roll?.heavyDiceBonus,
    ).formula;
  }

  _parseAbilityDiceBonus(input) {
    if (!input) {
      return { formula: "", half: false, penCap: false };
    }

    let half = false;
    let penCap = false;
    let formula = input;

    if (typeof formula === "string") {
      if (formula.includes("@Half")) {
        half = true;
        formula = formula.replace("@Half", "");
      }

      if (formula.includes("@penCap")) {
        penCap = true;
        formula = formula.replace("@penCap", "");
      }
    }

    return {
      formula: formula.trim(),
      half,
      penCap,
    };
  }
  /**
   * Prepare a data object which defines the data schema used by dice roll commands against this Item
   * @override
   */
  getRollData() {
    // Starts off by populating the roll data with a shallow copy of `this.system`
    const rollData = { ...this.system };

    // Quit early if there's no parent actor
    if (!this.actor) return rollData;
    // If present, add the actor's roll data
    rollData.actor = this.actor.getRollData();

    // Check if the item is owned by an actor
    if (this.actor) {
      rollData.actor = this.actor.getRollData();

      // Include specific actor attributes in rollData
      rollData.str = this.actor.system.attributes.str.total;
      rollData.dex = this.actor.system.attributes.dex.total;

      // Surface each school's spell power flat so ability formulas can use
      // @spellPowerFire, @spellPowerDarkness, etc. directly.
      for (const [key, value] of Object.entries(rollData.actor)) {
        if (key.startsWith("spellPower")) rollData[key] = value;
      }
    }

    return rollData;
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  async roll(event) {
    const item = this;

    // Initialize chat data.
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const rollMode = game.settings.get("core", "rollMode");
    const label = `[${item.type}] ${item.localizedName}`;

    // If there's no roll data, send a chat message.
    if (!this.system.formula) {
      ChatMessage.create({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
        content: item.system.description ?? "",
      });
    }
    // Otherwise, create a roll and send a chat message from it.
    else {
      // Retrieve roll data.
      const rollData = this.getRollData();
      // Invoke the roll and submit it to chat.
      const roll = new Roll(rollData.formula, rollData);
      // If you need to store the value first, uncomment the next line.
      // const result = await roll.evaluate();
      roll.toMessage({
        speaker: speaker,
        rollMode: rollMode,
        flavor: label,
      });
      return roll;
    }
  }
  // Handle tooltip data
  getTooltipData() {
    const data = this.system;

    console.log("Tooltip data:", this.system);

    if (this.type === "spell") {
      return this._getMagicTooltipData(data);
    }

    if (this.type === "ability") {
      return this._getAbilityTooltipData(data);
    }
    if (this.type === "weapon") {
      return this._getWeaponTooltipData(data);
    }
    if (this.type === "gear" && !data.shield) {
      return this._getGearTooltipData(data);
    }
    if (this.type === "gear" && data.shield) {
      return this._getShieldTooltipData(data);
    }
    if (data.option === "potion") {
      return this._getPotionTooltipData(data);
    }
    if (this.type === "feature") {
      return this._getFeatureTooltipData(data);
    }
    // fallback for other item types
    return {
      title: this.localizedName,
      img: this.img,
      sections: [],
      stats: [],
      description: data.description,
    };
  }
  _getMagicTooltipData(data) {
    const damageLines = [
      data.dmgType1 && `${data.dmgType1} ${data.bool2 ?? ""}`,
      data.dmgType2 && `${data.dmgType2} ${data.bool3 ?? ""}`,
      data.dmgType3 && `${data.dmgType3} ${data.bool4 ?? ""}`,
      data.dmgType4,
    ].filter(Boolean);

    const effectLines = [
      data.effectType1 &&
        `${data.effectType1} ${data.effects?.extra1 ? data.effects.extra1 + "%" : ""}`,
      data.effectType2 &&
        `${data.effectType2} ${data.effects?.extra2 ? data.effects.extra2 + "%" : ""}`,
      data.effectType3 &&
        `${data.effectType3} ${data.effects?.extra3 ? data.effects.extra3 + "%" : ""}`,
    ].filter(Boolean);

    return {
      icon: this.img,
      title: this.localizedName,
      sections: [
        { label: "Damage types", lines: [damageLines.join(" ")] },
        { label: "Effect types", lines: effectLines },
      ],
      stats: [
        { label: "Difficulty", value: data.difficulty },
        {
          label: "Cost",
          value: data.perRound ? `${data.cost} / ${data.perRound}` : data.cost,
        },
        { label: "Actions", value: data.actionCost },
        { label: "Range", value: data.range },
      ],
      description: data.description,
    };
  }

  _getAbilityTooltipData(data) {
    const effectLines = [
      data.effects.bleed && `Bleed ${data.effects.bleed}%`,
      data.effects.stagger && `Stagger ${data.effects.stagger}%`,
      data.effectType1 &&
        `${data.effectType1} ${data.effects?.extra1 ? data.effects.extra1 + "%" : ""}`,
      data.effectType2 &&
        `${data.effectType2} ${data.effects?.extra2 ? data.effects.extra2 + "%" : ""}`,
      data.effectType3 &&
        `${data.effectType3} ${data.effects?.extra3 ? data.effects.extra3 + "%" : ""}`,
    ].filter(Boolean);

    return {
      icon: this.img,
      title: this.localizedName,
      sections: [{ label: "Effect types", lines: effectLines }],
      stats: [
        { label: "Difficulty", value: data.difficulty },
        { label: "Cost", value: `${data.cost} ${data.costType}` },
        {
          label: "Damage",
          value: data.roll.heavyDiceBonus
            ? `${data.roll.diceBonus} (${data.roll.heavyDiceBonus} heavy)`
            : data.roll.diceBonus,
        },
        { label: "Test Type", value: data.attributeTest },
        { label: "Actions", value: data.actionCost },
        { label: "Range", value: data.range },
      ],
      description: data.description,
    };
  }
  _getWeaponTooltipData(data) {
    const effectLines = [
      data.effects.bleed && `Bleed ${data.effects.bleed}%`,
      data.effects.stagger && `Stagger ${data.effects.stagger}%`,
      data.effectType1 &&
        `${data.effectType1} ${data.effects?.extra1 ? data.effects.extra1 + "%" : ""}`,
      data.effectType2 &&
        `${data.effectType2} ${data.effects?.extra2 ? data.effects.extra2 + "%" : ""}`,
      data.effectType3 &&
        `${data.effectType3} ${data.effects?.extra3 ? data.effects.extra3 + "%" : ""}`,
    ].filter(Boolean);

    return {
      icon: this.img,
      title: this.localizedName,
      sections: [{ label: "Effect types", lines: effectLines }],
      stats: [
        { label: "Weapon Type", value: `${data.type} ${data.class}` },
        {
          label: "Coating",
          value: this.getFlag("redsteel", "coating")
            ? `${this.getFlag("redsteel", "coating").name} (+${this.getFlag("redsteel", "coating").formula})`
            : null,
        },
        {
          label: "Damage",
          value: `${data.roll.diceNum}d${data.roll.diceSize}+${data.roll.diceBonus}`,
        },
        { label: "Penetration", value: `${data.penetration}` },
        { label: "Attack", value: data.attack },
        { label: "Defense", value: data.defense },
        { label: "Crit range", value: data.critRange },
        { label: "Crit chance", value: data.critChance },
        { label: "Crit fail", value: data.critFail },
        { label: "Crit defense", value: data.critDefense },
        { label: "Crit dodge", value: data.critDodge },
        { label: "Dodge", value: data.dodge },
        { label: "Breakthrough", value: data.breakthrough },
        { label: "Sneak damage", value: data.sneakDamage },
        { label: "Finesse", value: data.finesse },
        { label: "Sharp", value: data.sharp },
        { label: "Thrown", value: data.thrown },
        { label: "Can be held in offhand", value: data.offhand },
      ].filter(
        (stat) =>
          stat.value !== 0 && stat.value !== false && stat.value != null,
      ),
      description: data.description,
    };
  }
  _getGearTooltipData(data) {
    return {
      icon: this.img,
      title: this.localizedName,
      stats: [
        { label: "Armor layer", value: data.layer },
        { label: "Armor", value: data.armor.value },
        { label: "Acid armor", value: data.armor.acid.value },
        { label: "Fire armor", value: data.armor.fire.value },
        { label: "Frost armor", value: data.armor.frost.value },
        { label: "Lightning armor", value: data.armor.lightning.value },
        { label: "Magic armor", value: data.armor.magic.value },
        { label: "Dark armor", value: data.armor.dark.value },
        { label: "Poison armor", value: data.armor.poison.value },
        { label: "Holy armor", value: data.armor.holy.value },
        { label: "Durability", value: data.armor.durability },
        { label: "Defense", value: data.defense },
        { label: "Ranged defense", value: data.rangedDefense },
        { label: "Critical defense", value: data.critDefense },
        { label: "Critical ranged defense", value: data.rangedCritDefense },
        { label: "Max speed reduction", value: data.maxSpeed },
        { label: "Max health bonus", value: data.healthBonus },
        { label: "Initiative penalty", value: data.iniPenalty },
        { label: "Perception penalty", value: data.perPenalty },
        { label: "Acrobacy penalty", value: data.acroPenalty },
        { label: "Dodge penalty", value: data.dodgePenalty },
        { label: "Archery penalty", value: data.archeryPenalty },
        { label: "Channeling penalty", value: data.castPenalty },
        { label: "Swimming penalty", value: data.swimPenalty },
      ].filter(
        (stat) =>
          stat.value !== 0 && stat.value !== false && stat.value != null,
      ),
      description: data.description,
    };
  }
  _getShieldTooltipData(data) {
    // Broken shields report improvised shield stats (and no armor values)
    const broken = this.isBrokenShield;
    const shield = this.getShieldStats();

    const armorStats = broken
      ? []
      : [
          { label: "Armor", value: data.armor.value },
          { label: "Acid armor", value: data.armor.acid.value },
          { label: "Fire armor", value: data.armor.fire.value },
          { label: "Frost armor", value: data.armor.frost.value },
          { label: "Lightning armor", value: data.armor.lightning.value },
          { label: "Magic armor", value: data.armor.magic.value },
          { label: "Dark armor", value: data.armor.dark.value },
          { label: "Poison armor", value: data.armor.poison.value },
          { label: "Holy armor", value: data.armor.holy.value },
        ];

    return {
      icon: this.img,
      title: broken ? `${this.localizedName} (broken)` : this.localizedName,
      stats: [
        { label: "Defense", value: shield.defense },
        { label: "Ranged defense", value: shield.rangedDefense },
        { label: "Critical defense", value: shield.critDefense },
        { label: "Critical ranged defense", value: shield.rangedCritDefense },
        { label: "Dodge penalty", value: shield.dodgePenalty },
        ...armorStats,
        { label: "Durability", value: data.armor.durability },
      ].filter(
        (stat) =>
          stat.value !== 0 && stat.value !== false && stat.value != null,
      ),
      description: data.description,
    };
  }
  _getPotionTooltipData(data) {
    const effectLines = [
      data.effectType1 &&
        `${data.effectType1} ${data.effects?.extra1 ? data.effects.extra1 + "%" : ""}`,
      data.effectType2 &&
        `${data.effectType2} ${data.effects?.extra2 ? data.effects.extra2 + "%" : ""}`,
    ].filter(Boolean);

    return {
      icon: this.img,
      title: this.localizedName,
      sections: [{ label: "Effect types", lines: effectLines }],
      stats: [
        { label: "Potion Type", value: `${data.type} ${data.option}` },
        { label: "Toxicity", value: data.toxicity },
        {
          label: "Replenishes",
          value: `${data.roll.diceNum}d${data.roll.diceSize}+${data.roll.diceBonus}`,
        },
      ].filter(
        (stat) =>
          stat.value !== 0 && stat.value !== false && stat.value != null,
      ),
      description: data.description,
    };
  }
  _getFeatureTooltipData(data) {
    // Total rerolls = sum of pool maxima, falling back to the legacy value.
    const rawPools = data.reroll?.pools;
    const pools = Array.isArray(rawPools)
      ? rawPools
      : Object.values(rawPools ?? {});
    const rerollTotal = pools.length
      ? pools.reduce((sum, p) => sum + (Number(p?.max) || 0), 0)
      : Number(data.reroll?.value) || 0;
    return {
      icon: this.img,
      title: this.localizedName,
      stats: [
        { label: "Type:", value: data.option },
        { label: "Number of rerolls", value: rerollTotal },
      ].filter(
        (stat) =>
          stat.value !== 0 && stat.value !== false && stat.value != null,
      ),
      description: data.description,
    };
  }
}
