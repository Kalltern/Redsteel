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
   * Augment the basic Item data model with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

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
    }

    // Only initialize effectTypes for relevant items (e.g., spells, consumables)

    if (
      this.type === "spell" ||
      this.type === "ability" ||
      this.type === "weapon"
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
      ];

      if (this.type === "spell" || this.type === "ability") {
        this.system.resourceOptions = {
          modes: ["add", "drain"],
          types: [
            "Health",
            "Stamina",
            "Mana",
            "Toxicity",
            "Corruption",
            "TemporaryHealth",
          ],
        };
      }

      if (this.type === "ability") {
        this.system.typeOptions = ["melee", "ranged", "other"];
        this.system.classOptions = ["movement", "attack", "defense", "stance"];
      }
    }

    if (this.system.roll) {
      const { diceNum, diceSize } = this.system.roll;
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
        { label: "Damage", value: data.roll.diceBonus },
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
    return {
      icon: this.img,
      title: this.localizedName,
      stats: [
        { label: "Defense", value: data.defense },
        { label: "Ranged defense", value: data.rangedDefense },
        { label: "Critical defense", value: data.critDefense },
        { label: "Critical ranged defense", value: data.rangedCritDefense },
        { label: "Dodge penalty", value: data.dodgePenalty },
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
    return {
      icon: this.img,
      title: this.localizedName,
      stats: [
        { label: "Type:", value: data.option },
        { label: "Number of rerolls", value: data.reroll.value },
      ].filter(
        (stat) =>
          stat.value !== 0 && stat.value !== false && stat.value != null,
      ),
      description: data.description,
    };
  }
}
