import { seedRollAdvantage } from "../utils/rollAdvantage.mjs";

/**
 * Extend the base Actor document by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {Actor}
 */
export class RedsteelActor extends Actor {
  /** @override */
  prepareData() {
    // Prepare data for the actor. Calling the super version of this executes
    // the following, in order: data reset (to clear active effects),
    // prepareBaseData(), prepareEmbeddedDocuments() (including active effects),
    // prepareDerivedData().
    super.prepareData();
  }

  /**
   * Collect the ids of every item that is currently "equipped" and therefore
   * occupies a slot rather than the inventory grid: weapons in weapon sets,
   * armor in layer slots, and any item flagged `system.equipped` (covers NPC
   * weapons/armor, equipped shields, and equipped ammunition).
   * @returns {Set<string>}
   */
  getEquippedItemIds() {
    const equipped = new Set();
    const combat = this.system.combat ?? {};

    for (const set of Object.values(combat.weaponSets ?? {})) {
      if (set?.main) equipped.add(set.main);
      if (set?.off) equipped.add(set.off);
    }
    for (const id of Object.values(combat.armorSlots ?? {})) {
      if (id) equipped.add(id);
    }
    for (const i of this.items) {
      if (i.system?.equipped) equipped.add(i.id);
    }
    return equipped;
  }

  /** @override */
  prepareBaseData() {
    // Ensure core Actor base-data initialization still runs.
    super.prepareBaseData();

    // Data modifications in this step occur before processing embedded
    // documents or derived data.
    const system = this.system;

    system.globalBonus ??= 0;
    system.globalPenalty ??= 0;

    // Seed the advantage/disadvantage buckets before Active Effects apply, so
    // ADD-mode effects from features/buffs accumulate onto numeric leaves.
    seedRollAdvantage(system);
  }

  /**
   * @override
   * Augment the actor source data with additional dynamic data. Typically,
   * you'll want to handle most of your calculated/derived data in this step.
   * Data calculated in this step should generally not exist in template.json
   * (such as attribute modifiers rather than attribute scores) and should be
   * available both inside and outside of character sheets (such as if an actor
   * is queried and has a roll executed directly from it).
   */
  _prepareGlobalMod() {
    const system = this.system;

    system.globalMod = 0;
    // Grave wounds
    const gw = system.stats?.graveWounds ?? {};
    const graveWounds = 5 * (gw.value ?? 0) - 3 * (gw.treated ?? 0);
    if (graveWounds > 0) {
      system.globalMod -= graveWounds;
    }

    // Fatigue
    // The effective fatigue degree drives every penalty. "Dwarven toughness"
    // (system.fatigueResilience) makes fatigue count one degree lower, so the
    // first point becomes degree 0 (no penalties) and death moves to 7 points.
    const rawFatigue = system.stats?.fatigue?.value ?? 0;
    const fatigueDegree = Math.max(0, rawFatigue - (system.fatigueResilience ? 1 : 0));
    system.fatigueDegree = fatigueDegree;
    // Degree 4+: disadvantage on every test. Folded into the actor-wide
    // advantage bucket (seeded in prepareBaseData, already carries any
    // feature/buff effects); the roll layer reads the net bias.
    system.fatigueDisadvantage = fatigueDegree >= 4;
    if (system.fatigueDisadvantage && system.rollAdvantage) {
      system.rollAdvantage.all -= 1;
    }
    // Degree 3+: success chance -10%.
    if (fatigueDegree >= 3) {
      system.globalMod -= 10;
    }

    // Corruption — a permanent background tier read from the corruption stat.
    //   Degree 0: 0-30 (nothing) · 1: 31-60 · 2: 61-90 · 3: 91+.
    // Degree 2+ "counts as Corrupted" (miracles/magic); degree 3 is also
    // Light-vulnerable. The numeric buffs (Magic Attack/Defense, Dark Spell
    // Power) are applied in prepareDerivedData; the token status + defense pill
    // are driven off these flags (effects.mjs sync + traitPills.mjs).
    const corruptionValue = system.stats?.corruption?.value ?? 0;
    const corruptionDegree =
      corruptionValue >= 91
        ? 3
        : corruptionValue >= 61
          ? 2
          : corruptionValue >= 31
            ? 1
            : 0;
    system.corruptionDegree = corruptionDegree;
    system.isCorrupted = corruptionDegree >= 2;
    system.corruptionLightVulnerable = corruptionDegree >= 3;

    system.globalMod += system.globalBonus ?? 0;
    system.globalMod -= system.globalPenalty ?? 0;
  }
  prepareDerivedData() {
    const actorData = this;
    const systemData = actorData.system;

    const flags = actorData.flags.redsteel || {};

    systemData.rerolls = {};
    let skill = systemData.skills;
    let combatSkill = systemData.combatSkills;
    let secondaryAttribute = systemData.secondaryAttributes;

    // Blood Manipulation is a newer combat skill: seed it for actors created
    // before it existed so its rating/visibility compute and the sheet shows it.
    if (combatSkill && !combatSkill.bloodManipulation) {
      combatSkill.bloodManipulation = {
        value: 0,
        rating: 0,
        critbonus: 0,
        critfailpenalty: 0,
        id: 4,
        type: 4,
        visible: false,
        bonus: 0,
        attack: 0,
        defense: 0,
        isSkill: 1,
      };
    }
    // Iterate through gear
    const elementalTypes = [
      "acid",
      "fire",
      "frost",
      "lightning",
      "magic",
      "poison",
      "dark",
      "holy",
    ];

    // Deflect (Odklonění) accumulators. Numeric so armor quality and feature
    // Active Effects (ADD-mode on system.defenseDeflect / system.dodgeDeflect)
    // can stack. Armor counts for both defense and dodge; AE sources may target
    // only one. Seed with any pre-existing (AE-applied) value.
    systemData.defenseDeflect = Number(systemData.defenseDeflect) || 0;
    systemData.dodgeDeflect = Number(systemData.dodgeDeflect) || 0;

    // Veneficus channeling-penalty mitigation, applied per equipped armor
    // piece below (never beyond removing that piece's penalty). The sources
    // stack: the doctrine rank IV perk and the specialisation's "Armor
    // Channeling penalty -5%" node (postihZbroje) each shave 5%.
    let channelPenaltyMitigation = 0;
    if ((systemData.doctrines?.veneficus?.value ?? 0) >= 4) {
      channelPenaltyMitigation += 5;
    }
    if (systemData.specialisations?.veneficus?.nodes?.postihZbroje) {
      channelPenaltyMitigation += 5;
    }

    // possibly to return here in case armor bonuses stack inapropriately
    let totalArmor = 0;
    for (const item of this.items) {
      if (item.type === "gear" && item.system.equipped) {
        // Armor quality (Zbroje column). Shields live in weapon-set slots, not
        // here, so this only ever applies the armor column.
        const q = item.system.qualityMods ?? {};
        for (const type of elementalTypes) {
          systemData.armor[type].bonus += item.system?.armor?.[type].value ?? 0;
        }
        if (actorData.type === "character") {
          skill.acrobacy.bonus += item.system.acroPenalty ?? 0;
          skill.athletics.swimming += item.system.swimPenalty ?? 0;
          skill.stealth.bonus += item.system.stealthPenalty ?? 0;
          secondaryAttribute.ini.bonus +=
            (item.system.iniPenalty ?? 0) + (q.ini ?? 0);
          secondaryAttribute.spd.max += item.system.maxSpeed ?? 0;
        } else {
          secondaryAttribute.ini.bonus += q.ini ?? 0;
        }
        totalArmor += item.system.armor.value;
        combatSkill.meleeDefense.critbonus += item.system.critDefense ?? 0;
        combatSkill.rangedDefense.critbonus +=
          item.system.rangedCritDefense ?? 0;
        combatSkill.dodge.bonus += item.system.dodgePenalty ?? 0;
        // Channeling (cast) penalty from this armor piece, reduced by the
        // stacked Veneficus mitigation — never beyond removing it, so it
        // can't turn into a bonus. Blood Manipulation is unaffected (it is not
        // a focus-based cast), so the penalty only lands on channeling.
        let castPenalty = item.system.castPenalty ?? 0;
        if (castPenalty < 0 && channelPenaltyMitigation > 0) {
          castPenalty = Math.min(0, castPenalty + channelPenaltyMitigation);
        }
        combatSkill.channeling.bonus += castPenalty;
        combatSkill.rangedDefense.bonus +=
          (item.system.rangedDefense ?? 0) + (q.rangedDefense ?? 0);
        combatSkill.meleeDefense.bonus +=
          (item.system.defense ?? 0) + (q.defense ?? 0);

        // Odklonění from armor quality applies to both melee defense and dodge.
        systemData.defenseDeflect += q.deflect ?? 0;
        systemData.dodgeDeflect += q.deflect ?? 0;

        systemData.stats.health.bonus += item.system.healthBonus ?? 0;
      }
    }

    for (const type of elementalTypes) {
      const armor = systemData.armor[type];
      armor.total = armor.value + armor.bonus;
    }

    const armor = systemData.armor;

    const naturalArmor = armor.natural;
    naturalArmor.total = naturalArmor.value + naturalArmor.bonus;
    armor.total = totalArmor + naturalArmor.total;
    armor.total = Math.max(0, armor.total);
    // Iterate through gear (only helmets)
    for (const item of this.items) {
      let combatSkill = systemData.combatSkills;
      if (item.type === "gear" && item.system.equipped && item.system.helmet) {
        combatSkill.archery.rating += item.system.archeryPenalty ?? 0;
        systemData.dodgePenalty += item.system.perPenalty ?? 0;
      }
    }

    this._prepareGlobalMod();
    // Make separate methods for each Actor type (character, npc, etc.) to keep
    // things organized.
    this._prepareCharacterData(actorData);
    this._prepareNpcData(actorData);
  }

  /**
   * Prepare Character type specific data
   */
  _prepareCharacterData(actorData) {
    if (actorData.type !== "character") return;

    // Make modifications to data here. For example:
    const systemData = actorData.system; //everything else

    // Loop through attribute scores, and add their modifiers to our sheet output.
    for (let [key, attribute] of Object.entries(systemData.attributes)) {
      attribute.total = attribute.value + attribute.bonus;
    }
    for (let [key, attribute] of Object.entries(
      systemData.secondaryAttributes,
    )) {
      // Calculate the attribute rating using redsteel rules.
      attribute.total = attribute.value + (attribute.bonus ?? 0);
    }
    for (let [key, stat] of Object.entries(systemData.stats)) {
      // Calculate the attribute rating using redsteel rules.
      stat.max = (stat.base ?? 0) + (stat.bonus ?? 0);
    }

    //Loop through skill groups and add their ratings depending on their level and attribute score
    const skillset1 = [0, 15, 25, 30, 35, 45, 50, 55, 65, 75, 85];
    const skillset2 = [0, 5, 10, 15, 20, 30]; // muscles, nimbleness
    const skillset3 = [0, 25, 40, 55, 70, 85]; //riding and sailing and herbalism
    const skillset4 = [0, 40, 65, 90]; //dancing
    const skillset5 = [0, 10, 20, 30, 40, 50]; //drinking
    const skillset6 = [0, 5, 10, 15, 20, 25]; //social
    const skillset7 = [0, 20, 30, 40, 50, 60]; //survival, meditation
    const skillsetLeadership = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]; //survival, meditation
    const combatset1 = [0, 15, 20, 30, 35, 45, 50, 60, 65, 75, 80]; // combat + archery
    const channeling1 = [0, 20, 25, 30, 35, 45, 50, 55, 65, 70, 80];
    const channeling2 = [0, 16, 22, 28, 34, 40, 46, 52, 58, 64, 70];
    // Blood Manipulation (Manipulace s krví): the Willpower-based casting skill
    // for Blood magic, ranks 1-10.
    const bloodManipSet = [0, 25, 30, 35, 40, 50, 55, 60, 70, 75, 85];
    const throwing = [0, 20, 25, 30, 35, 40, 45, 50, 55, 65, 70];
    const dodge = [0, 20, 25, 35, 40, 50, 55, 60, 65, 75, 85];
    const rangedDefenseSet = [0, 10, 20, 25, 30, 35, 40, 45, 50, 55, 60];
    const rangerGroup = [0, 15, 19, 28, 32, 42, 46, 56, 60, 70, 75];
    const ranger = systemData.combatSkills.ranger.value;
    const hasFinesse = systemData.finesse;
    const rangeddef = systemData.combatSkills.rangedDefense;
    const stat = systemData.stats;
    // Effective fatigue degree (after "Dwarven toughness"), set in _prepareGlobalMod.
    const fatigueDegree = systemData.fatigueDegree ?? 0;
    const globalMod = systemData.globalMod;
    const visage = systemData.secondaryAttributes.vis.total;
    const sin = systemData.secondaryAttributes.sin.total;
    const archery = systemData.combatSkills.archery;
    const combat = systemData.combatSkills.combat;
    const melee = combat.value; //Adding melee skill for better calculation of defense/throw/ranged defense
    const brawler = systemData.skills.brawler;

    /* -------------------------------------------- */
    /* Shield bonuses from active weapon set  + Dimakerus logic       */
    /* -------------------------------------------- */

    const combatData = systemData.combat;
    const combatSkills = systemData.combatSkills;
    const secondary = systemData.secondaryAttributes;

    const activeSetId = combatData?.activeWeaponSet;
    if (activeSetId) {
      const activeSet = combatData.weaponSets?.[activeSetId];
      if (activeSet?.off) {
        const offHand = actorData.items.get(activeSet.off);
        const mainHand = actorData.items.get(activeSet.main);

        if (offHand?.system?.shield) {
          // Broken shields (0 durability) grant improvised shield stats instead
          const shield = offHand.getShieldStats();
          // Defense bonuses
          combatSkills.meleeDefense.bonus += shield.defense;
          combatSkills.rangedDefense.bonus += shield.rangedDefense;

          combatSkills.meleeDefense.critbonus += shield.critDefense;

          combatSkills.rangedDefense.critbonus += shield.rangedCritDefense;

          // Dodge penalty
          combatSkills.dodge.bonus += shield.dodgePenalty;
          // Initiative / speed penalties
          secondary.ini.bonus += shield.iniPenalty;
          secondary.spd.bonus += shield.maxSpeed;
        }
        if (!offHand?.system?.shield) {
          const weaponClass = mainHand?.system?.weapon?.class;
          if (systemData.doctrines.dimakerus.value >= 1) {
            if (weaponClass === "axe") {
              combatSkills.combat.bonus += 5;
            }
            if (weaponClass === "blunt") {
              combatSkills.combat.bonus += 8;
            }
            if (weaponClass === "sword") {
              combatSkills.combat.bonus += 5;
              systemData.effects.bleed += 3;
            }
          } else if (systemData.doctrines.duelist.value >= 1) {
            if (weaponClass === "sword") {
              // no penalty
            }
          } else {
            combatSkills.combat.bonus -= 10;
            combatSkills.dodge.bonus -= 10;
            combatSkills.rangedDefense.bonus -= 10;
            combatSkills.meleeDefense.bonus -= 10;
          }
        }
      }
    }

    const dodgeLimit = systemData.dodgeLimit;
    dodgeLimit.total = dodgeLimit.value + dodgeLimit.bonus;

    const meleeOrRanged = Math.max(throwing[melee], combatset1[archery.value]);

    const attributeScore = Object.entries(systemData.attributes).map(
      ([key, attribute]) => ({
        total: attribute.value + (attribute.bonus ?? 0), // Combine value and bonus
      }),
    );

    // Iterate through skills
    for (let [key, skill] of Object.entries(systemData.skills)) {
      // Ensure skill type is valid and matches your criteria
      if (skill.type === 1) {
        // Use skill.id to find the corresponding attribute
        if (key === "athletics") {
          skill.swimming +=
            skillset1[skill.value] +
            attributeScore[skill.id].total * 3 +
            skill.bonus +
            globalMod;
        }

        if (key === "acting") {
          skill.blend +=
            skillset1[skill.value] +
            attributeScore[skill.id].total * 3 +
            skill.bonus +
            globalMod;
        }
        skill.rating =
          skillset1[skill.value] +
          attributeScore[skill.id].total * 3 +
          skill.bonus +
          globalMod;
      } else if (skill.type === 2) {
        skill.rating = skillset2[skill.value];
      } else if (skill.type === 3) {
        skill.rating =
          skillset3[skill.value] +
          attributeScore[skill.id].total * 3 +
          skill.bonus +
          globalMod;
      } else if (skill.type === 4) {
        skill.rating =
          skillset4[skill.value] +
          attributeScore[skill.id].total * 3 +
          skill.bonus +
          globalMod;
      } else if (skill.type === 5) {
        skill.rating =
          skillset5[skill.value] +
          attributeScore[skill.id].total * 3 +
          skill.bonus +
          globalMod;
      } else if (skill.type === 6) {
        if (key === "deception") {
          skill.rating =
            skillset6[skill.value] +
            attributeScore[skill.id].total * 5 +
            attributeScore[3].total * 3 +
            visage +
            skill.bonus +
            globalMod;
        }
        if (key === "intimidation") {
          skill.rating =
            skillset6[skill.value] +
            attributeScore[skill.id].total * 5 +
            attributeScore[0].total * 3 +
            -Math.min(0, visage * 2) +
            skill.bonus +
            globalMod;
        }
        if (key === "persuasion") {
          skill.rating =
            skillset6[skill.value] +
            attributeScore[skill.id].total * 5 +
            attributeScore[4].total * 3 +
            visage +
            skill.bonus +
            globalMod;
        }
        if (key === "temptation") {
          skill.rating =
            skillset6[skill.value] +
            attributeScore[skill.id].total * 5 +
            Math.max(attributeScore[6].total, visage) * 3 +
            sin +
            skill.bonus +
            globalMod;
        }
        if (key === "insight") {
          skill.rating =
            skillset6[skill.value] +
            attributeScore[skill.id].total * 5 +
            attributeScore[5].total * 4 +
            skill.bonus +
            globalMod;
        }
      } else if (skill.type === 7) {
        skill.rating =
          skillset7[skill.value] +
          attributeScore[skill.id].total * 3 +
          skill.bonus +
          globalMod;
      }
    }
    // Calculate the attribute rating using redsteel rules. Rework calculations for stun effects
    for (let [key, attribute] of Object.entries(systemData.attributes)) {
      attribute.mod = Math.floor(
        15 +
          attribute.modBonus +
          (systemData.globalMod ?? 0) +
          (attribute.bonus + attribute.value) * 10,
      );
      if (key === "str") {
        attribute.mod = Math.floor(
          15 +
            attribute.modBonus +
            (systemData.globalMod ?? 0) +
            systemData.skills.muscles.rating +
            (attribute.bonus + attribute.value) * 10,
        );
      }
      if (key === "dex") {
        attribute.mod = Math.floor(
          15 +
            attribute.modBonus +
            (systemData.globalMod ?? 0) +
            systemData.skills.nimbleness.rating +
            (attribute.bonus + attribute.value) * 10,
        );
      }
    }

    // Iterate through combat skills
    for (let [key, combatSkill] of Object.entries(systemData.combatSkills)) {
      // Ensure skill type is valid and matches your criteria
      if (combatSkill.type === 0) {
        // Looking for finesse=true to use dexterity, otherwise use strength
        // looking for ranger=true to use ranger skills instead of classic skills
        // Hotfixed for Finesse added
        if (hasFinesse && attributeScore[0] <= attributeScore[1]) {
          if (ranger > 0) {
            combat.finesseRating =
              rangerGroup[ranger] +
              attributeScore[1].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else if (
            archery.value > 0 &&
            rangedDefenseSet[archery.value] > combatset1[melee]
          ) {
            combat.finesseRating =
              rangedDefenseSet[archery.value] +
              attributeScore[1].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else {
            combat.finesseRating =
              combatset1[melee] +
              attributeScore[1].total * 3 +
              combatSkill.bonus +
              globalMod;
          }
        }
        if (combatSkill === combat) {
          // Apply ranger bonus if applicable
          if (ranger > 0) {
            combatSkill.rating =
              rangerGroup[ranger] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else if (
            archery.value > 0 &&
            rangedDefenseSet[archery.value] > combatset1[melee]
          ) {
            combatSkill.rating =
              rangedDefenseSet[archery.value] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else {
            combatSkill.rating =
              combatset1[melee] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          }
        }
        if (combatSkill === rangeddef) {
          if (archery.value > melee && archery.value != 0) {
            combatSkill.rating =
              rangedDefenseSet[archery.value] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else if (ranger > 0) {
            combatSkill.rating =
              rangedDefenseSet[ranger] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else {
            combatSkill.rating =
              rangedDefenseSet[melee] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          }
        }

        if (combatSkill === archery) {
          if (ranger > 0) {
            archery.rating =
              combatset1[ranger] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else {
            archery.rating =
              combatset1[archery.value] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          }
        }

        // Assuming steelGrip and predatorySenses are properties directly on the actor
        if (combatSkill === systemData.combatSkills.meleeDefense) {
          // Check if the actor has steelGrip enabled
          if (systemData.steelGrip) {
            combatSkill.rating =
              combatset1[melee] +
              attributeScore[0].total * 3 +
              combatSkill.bonus +
              globalMod;
          }
          // Check if the actor has predatorySenses enabled
          else if (systemData.predatorySenses) {
            combatSkill.rating =
              rangerGroup[ranger] +
              attributeScore[6].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else if (ranger > 0) {
            combatSkill.rating =
              rangerGroup[ranger] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          } else {
            combatSkill.rating =
              combatset1[melee] +
              attributeScore[combatSkill.id].total * 3 +
              combatSkill.bonus +
              globalMod;
          }
        }
      }
      if (combatSkill.type === 1) {
        //setting ratings for dodge
        combatSkill.rating =
          dodge[systemData.skills.acrobacy.value] +
          attributeScore[combatSkill.id].total * 3 +
          combatSkill.bonus +
          globalMod;
      }
      if (combatSkill.type === 2) {
        if (ranger > 0) {
          combatSkill.rating =
            combatset1[ranger] +
            attributeScore[combatSkill.id].total * 3 +
            combatSkill.bonus +
            globalMod;
        } else if (hasFinesse && attributeScore[6] <= attributeScore[1]) {
          combatSkill.finesseRating =
            meleeOrRanged +
            attributeScore[1].total * 3 +
            combatSkill.bonus +
            globalMod;
        } else {
          combatSkill.rating =
            meleeOrRanged +
            attributeScore[combatSkill.id].total * 3 +
            combatSkill.bonus +
            globalMod;
        }
      }
      if (combatSkill.type === 3) {
        // The Veneficus doctrine channels through martial combat: the
        // channeling rating derives from the Combat skill rank (via the
        // channeling2 table) instead of a channeling rank of its own,
        // keeping Intelligence as the parent attribute. The Lindar
        // specialisation node then switches that parent to the higher of
        // Strength/Dexterity.
        const veneficusRank = systemData.doctrines?.veneficus?.value ?? 0;
        const martialChanneling = veneficusRank > 0;
        const lindar =
          combatSkill.lindar ||
          !!systemData.specialisations?.veneficus?.nodes?.lindar;
        combatSkill.lindar = lindar;
        if (martialChanneling) {
          const attrBonus = lindar
            ? Math.max(
                attributeScore[0].total, // Strength
                attributeScore[1].total, // Dexterity
              )
            : attributeScore[combatSkill.id].total; // Intelligence
          combatSkill.rating =
            channeling2[melee] +
            attrBonus * 3 +
            combatSkill.bonus +
            globalMod;
        } else {
          combatSkill.rating =
            channeling1[combatSkill.value] +
            attributeScore[combatSkill.id].total * 3 +
            combatSkill.bonus +
            globalMod;
        }
      }
      if (combatSkill.type === 4) {
        // Blood Manipulation (Manipulace s krví): a Willpower-based casting
        // skill. Unlike channeling it is immune to the armor cast penalty (it
        // channels through the body, not focus), so no castPenalty is applied.
        const wilScore = attributeScore[4].total; // Willpower
        let rating =
          bloodManipSet[combatSkill.value] +
          wilScore * 3 +
          combatSkill.bonus +
          globalMod;

        // Cordinas (rank 1+) lets the caster channel blood magic through their
        // martial prowess: the raw Combat-rank rating (combat table + Will×3)
        // may stand in for the blood-manipulation rating when it is higher. The
        // bonus comes from Blood Manipulation's own bonus, not the Combat skill.
        const cordinasRank = systemData.doctrines?.cordinas?.value ?? 0;
        if (cordinasRank > 0) {
          const combatRating =
            combatset1[melee] + wilScore * 3 + combatSkill.bonus + globalMod;
          rating = Math.max(rating, combatRating);
        }

        combatSkill.rating = rating;
      }
    }

    //Calculate brawler
    if (hasFinesse && attributeScore[0] <= attributeScore[1]) {
      brawler.rating =
        skillset1[brawler.value] +
        attributeScore[1].total * 3 +
        brawler.bonus +
        globalMod;
      if (skillset1[brawler.value] < rangedDefenseSet[melee]) {
        rangedDefenseSet[melee] +
          attributeScore[1].total * 3 +
          brawler.bonus +
          globalMod;
      }
    } else {
      brawler.rating =
        skillset1[brawler.value] +
        attributeScore[0].total * 3 +
        brawler.bonus +
        globalMod;
      if (skillset1[brawler.value] < rangedDefenseSet[melee]) {
        brawler.rating =
          rangedDefenseSet[melee] +
          attributeScore[0].total * 3 +
          brawler.bonus +
          globalMod;
      }
    }

    // Prepare secondary attributes and stat calculations
    const secAttribute = systemData.secondaryAttributes;

    const attribute = systemData.attributes;
    const str = attribute.str.total;
    const dex = attribute.dex.total;
    const end = attribute.end.total;
    const int = attribute.int.total;
    const wil = attribute.wil.total;
    const per = attribute.per.total;
    const cha = attribute.cha.total;

    // Calculate sneak damage
    const calcRogueSneakDamage = [1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4];
    systemData.sneakDamage =
      calcRogueSneakDamage[systemData.doctrines.rogue.value] +
      systemData.sneakDamageBonus;
    // Calculate initiative — capped at 15 for characters.
    const calcIni = [0, 0, 0, 1, 2, 3, 4, 5, 5, 5, 5];
    secAttribute.ini.total = Math.min(
      15,
      calcIni[per] + secAttribute.ini.value + secAttribute.ini.bonus,
    );

    // Calculate speed
    // Fatigue: degree 5+ sets speed to 1; degree 2+ applies a flat -1.
    const calcSpd = [0, 3, 3, 4, 4, 4, 5, 6, 6, 6, 6];
    secAttribute.spd.total =
      fatigueDegree >= 5
        ? 1
        : calcSpd[dex] +
          secAttribute.spd.value +
          secAttribute.spd.bonus -
          (fatigueDegree >= 2 ? 1 : 0);
    Math.floor(secAttribute.spd.total);

    // Calculate resolve from endurance and will
    const calcResEnd = [0, 0, 0, 1, 1, 2, 2, 3, 3, 3, 3];
    const calcResWill = [0, 0, 0, 1, 2, 2, 3, 3, 3, 3, 3];
    secAttribute.res.total =
      calcResEnd[end] +
      calcResWill[wil] +
      secAttribute.res.value +
      secAttribute.res.bonus;

    // Calculate wounds cap
    const calcWounds = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 2];
    stat.graveWounds.max =
      calcWounds[end] + stat.graveWounds.base + stat.graveWounds.bonus;

    // Treated wounds can never exceed the actual wound count (dynamic cap).
    stat.graveWounds.treatedMax = stat.graveWounds.value;
    if (stat.graveWounds.treated > stat.graveWounds.value) {
      stat.graveWounds.treated = stat.graveWounds.value;
    }

    // Calculate critRanges
    const calcCritRange = [0, 0, 0, 0, 1, 1, 2, 3, 3, 3, 3];
    systemData.critRangeMelee = calcCritRange[str] + calcCritRange[per];
    systemData.critRangeRanged = calcCritRange[per];
    systemData.critRangeCast = calcCritRange[int] ?? 0;
    // Calculate misc
    secAttribute.lck.total = secAttribute.lck.value + secAttribute.lck.bonus;
    secAttribute.vis.total = secAttribute.vis.value + secAttribute.vis.bonus;
    secAttribute.sin.total = secAttribute.sin.value + secAttribute.sin.bonus;
    secAttribute.fth.total = secAttribute.fth.value + secAttribute.fth.bonus;
    stat.corruption.max = stat.corruption.base + stat.corruption.bonus;
    // Death by exhaustion happens at the final degree; resilience pushes the
    // raw point cap from 6 to 7 so the same degree is reached one point later.
    stat.fatigue.max =
      stat.fatigue.base +
      stat.fatigue.bonus +
      (systemData.fatigueResilience ? 1 : 0);

    // persuasion temptation deception intimidation insight ; shepherds will
    if (systemData.priest) {
      stat.holyEnergy.max =
        stat.holyEnergy.base +
        stat.holyEnergy.bonus +
        secAttribute.fth.total * 5;
      stat.holyEnergy.power =
        secAttribute.fth.total + (stat.holyEnergy.power.bonus || 0);
      let chosenSkill = systemData.shepherdsWill.skill;

      // Check if the chosen skill is valid
      if (systemData.shepherdsWill.shepherdOptions.includes(chosenSkill)) {
        let skill = systemData.skills[chosenSkill];
        if (skill.id === 5) {
          // Replace its core attribute with Willpower (Wil)
          skill.rating += (-cha + wil) * 6;
        }
        if (skill.id === 6) {
          // Replace its core attribute with Perception (Per)
          skill.rating += (-per + wil) * 6;
        }
      }
    }

    stat.mind.max = wil + stat.mind.bonus + stat.mind.base;
    stat.insanity.max = wil + stat.insanity.bonus + stat.insanity.base;

    // Calculate trap detection skill
    systemData.detection = per + systemData.skills.traps.value * 2;

    // Calculate Health, systemData.healthBonus comes from Armor
    const ironMuscles = systemData.ironMuscles ? str : 0;
    systemData.stats.health.max =
      end * attribute.end.rank +
      stat.health.base +
      stat.health.bonus +
      str +
      ironMuscles;

    // Calculate toxicity
    systemData.stats.toxicity.max =
      end * 2 + stat.toxicity.bonus + stat.toxicity.base;

    // Calculate stamina. Fatigue drains -5 per degree, but the maximum never
    // drops below 5 no matter how exhausted the character is.
    systemData.stats.stamina.max = Math.max(
      5,
      end * 5 +
        stat.stamina.bonus +
        stat.stamina.base +
        2 * systemData.skills.athletics.value -
        5 * fatigueDegree,
    );
    // Calculate temporaryHealth
    systemData.stats.temporaryHealth.max =
      50 + systemData.stats.temporaryHealth.bonus;

    // Calculate mana
    if (systemData.magicPotential) {
      const channeling = systemData.combatSkills.channeling.value;
      const calcCast = [0, 0, 3, 6, 9, 9, 9, 9, 9, 9, 9];
      const calcSchool = [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1];
      let schoolBonus = 0;
      const spellPowerSchool = [0, 0, 1, 2, 3, 4, 4, 5, 5, 6, 8];

      // Corruption grants bonus Dark Spell Power: +1 at degree 2, +3 at degree 3.
      const corruptionDarkSP =
        systemData.corruptionDegree >= 3
          ? 3
          : systemData.corruptionDegree >= 2
            ? 1
            : 0;
      if (corruptionDarkSP && systemData.schools?.dark) {
        systemData.schools.dark.bonus += corruptionDarkSP;
      }

      for (const [key, school] of Object.entries(systemData.schools)) {
        if (key !== "blood") {
          schoolBonus += calcSchool[school.value]; // Add based on school value
          school.spellPower =
            spellPowerSchool[school.value] +
            school.bonus +
            (systemData.baseSpellPower || 0) +
            Math.floor(int / 2);
        }
        if (key === "blood") {
          schoolBonus += calcSchool[school.value]; // Add based on school value
          school.spellPower =
            spellPowerSchool[school.value] +
            school.bonus +
            Math.max(Math.floor(int / 2), Math.floor(wil / 2));
        }
      }
      let magicDoctrine = systemData.doctrines;
      const maxValue = Math.max(
        magicDoctrine.elymas.value || 0,
        magicDoctrine.incantator.value || 0,
        magicDoctrine.veneficus.value || 0,
        magicDoctrine.elementalist.value || 0,
      );
      const doctrineValues = {
        elymas: magicDoctrine.elymas.value || 0,
        incantator: magicDoctrine.incantator.value || 0,
        elementalist: magicDoctrine.elementalist.value || 0,
      };
      const SKILL_TREES = {
        elymas: {
          attack: [{ min: 4, bonus: 5 }],
          defense: [
            { min: 2, bonus: 5 },
            { min: 6, bonus: 10 },
          ],
        },
        incantator: {
          attack: [
            { min: 2, bonus: 5 },
            { min: 6, bonus: 10 },
          ],
          defense: [{ min: 4, bonus: 5 }],
        },
        elementalist: {
          attack: [{ min: 5, bonus: 5 }],
          defense: [{ min: 3, bonus: 5 }],
        },
      };

      function calculateTreeBonus(magicDoctrineType, type, level) {
        if (doctrineValues[magicDoctrineType] !== maxValue) return 0;

        let bonus = 0;
        const rules = SKILL_TREES[magicDoctrineType][type];
        if (!rules) return 0;

        for (const rule of rules) {
          if (level >= rule.min && rule.bonus > bonus) {
            bonus = rule.bonus;
          }
        }
        return bonus;
      }

      // Hypothetical switching magic doctrine will not prevent from getting better skill bonus from the higher doctrine
      const magicAttackBonus =
        calculateTreeBonus("elymas", "attack", maxValue) +
        calculateTreeBonus("incantator", "attack", maxValue) +
        calculateTreeBonus("elementalist", "attack", maxValue);

      const magicDefenseBonus =
        calculateTreeBonus("elymas", "defense", maxValue) +
        calculateTreeBonus("incantator", "defense", maxValue) +
        calculateTreeBonus("elementalist", "defense", maxValue);
      systemData.combatSkills.channeling.attack += magicAttackBonus;
      systemData.combatSkills.channeling.defense += magicDefenseBonus;

      const calcElymas = [1, 2.5, 2.5, 2.5, 3, 3, 3.5, 3.5, 4, 4, 4];
      const calcIncantator = [1, 5, 5, 5, 8, 8, 10, 10, 12, 12, 12];
      const calcElementalist = [1, 2, 2, 2, 2, 4, 4, 6, 6, 6, 8];
      const calcVeneficus = [1, 1, 1, 1, 1, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5];

      if (magicDoctrine.elymas.value === maxValue) {
        systemData.stats.mana.max = Math.floor(
          (calcCast[channeling] +
            int +
            wil +
            schoolBonus +
            stat.mana.bonus +
            stat.mana.base -
            3 * fatigueDegree) *
            calcElymas[magicDoctrine.elymas.value],
        );
      } else if (magicDoctrine.incantator.value === maxValue) {
        systemData.stats.mana.max = Math.floor(
          (calcCast[channeling] +
            int +
            wil +
            schoolBonus +
            stat.mana.bonus +
            stat.mana.base -
            3 * fatigueDegree) *
            calcIncantator[magicDoctrine.incantator.value],
        );
      } else if (magicDoctrine.elementalist.value === maxValue) {
        systemData.stats.mana.max = Math.floor(
          (calcCast[channeling] +
            int +
            wil +
            schoolBonus +
            stat.mana.bonus +
            stat.mana.base -
            3 * fatigueDegree) *
            calcElementalist[magicDoctrine.elementalist.value],
        );
      } else if (magicDoctrine.veneficus.value === maxValue) {
        systemData.stats.mana.max = Math.floor(
          (calcCast[melee] +
            int +
            wil +
            schoolBonus +
            stat.mana.bonus +
            stat.mana.base -
            3 * fatigueDegree) *
            calcVeneficus[magicDoctrine.veneficus.value],
        );
      } else {
        console.log("No matching doctrine, using default calculation.");
        systemData.stats.mana.max =
          calcCast[melee] +
          int +
          wil +
          schoolBonus +
          stat.mana.bonus +
          stat.mana.base -
          3 * fatigueDegree;
      }

      // prevent mana to go below 0
      systemData.stats.mana.max = Math.max(
        systemData.stats.mana.max,
        systemData.stats.mana.min,
      );
    }

    // Corruption raises Magic Attack & Defense by +5% per degree. Channeling is
    // the magic combat skill (attack = spell rolls, defense = defending vs
    // magic). Applied outside the magicPotential guard so a corrupted non-caster
    // still gets the magic-defense bonus.
    const corruptionMagicMod = 5 * (systemData.corruptionDegree ?? 0);
    if (corruptionMagicMod) {
      const ch = systemData.combatSkills?.channeling;
      if (ch) {
        ch.attack = (ch.attack ?? 0) + corruptionMagicMod;
        ch.defense = (ch.defense ?? 0) + corruptionMagicMod;
      }
    }

    // Blood magic is its own path: the Blood School specialisation grants
    // access to Blood Spell Power independent of magicPotential. Blood is no
    // longer a progressable school (no school rank), so its Spell Power comes
    // from the specialisation's `schools.blood.bonus` passives plus INT/WIL.
    // When magicPotential is set the loop above already computed it identically
    // (spellPowerSchool[0] = 0), so only fill it in for the non-mage case here.
    if (
      systemData.specialisations?.bloodSchool?.active &&
      !systemData.magicPotential
    ) {
      const blood = systemData.schools.blood;
      blood.spellPower =
        (blood.bonus || 0) +
        Math.max(Math.floor(int / 2), Math.floor(wil / 2));
    }

    // Surface the Blood Manipulation casting skill on the sheet only for Blood
    // casters: a Blood School specialist, or a Cordinas doctrine holder who can
    // channel blood magic through martial prowess.
    if (systemData.combatSkills?.bloodManipulation) {
      systemData.combatSkills.bloodManipulation.visible =
        !!systemData.specialisations?.bloodSchool?.active ||
        (systemData.doctrines?.cordinas?.value ?? 0) > 0;
    }

    // Blood Pool capacity is granted entirely by the Blood School
    // specialisation: the apprentice node and the bloodPool nodes add to
    // `bloodPool.bonus`. A character with no Blood specialisation has no pool
    // (max 0 → hidden). NPCs keep their own freely-editable max.
    systemData.stats.bloodPool.max = systemData.stats.bloodPool.bonus || 0;

    // Prevent current stat exceed max
    systemData.stats.health.value = Math.min(
      systemData.stats.health.value,
      systemData.stats.health.max,
    );
    systemData.stats.stamina.value = Math.min(
      systemData.stats.stamina.value,
      systemData.stats.stamina.max,
    );
    // Toxicity is intentionally NOT clamped to its max: exceeding the maximum
    // is what triggers Toxic Shock (see _syncResourceStateEffects).
    systemData.stats.mana.value = Math.min(
      systemData.stats.mana.value,
      systemData.stats.mana.max,
    );
    systemData.stats.mind.value = Math.min(
      systemData.stats.mind.value,
      systemData.stats.mind.max,
    );
    systemData.stats.bloodPool.value = Math.min(
      systemData.stats.bloodPool.value,
      systemData.stats.bloodPool.max,
    );

    // Define critical thresholds influenced by luck
    const luck = secAttribute.lck.total;
    const baseCriticalSuccess = 5; // Base critical success threshold
    const baseCriticalFailure = 96 - fatigueDegree; // Base critical failure threshold

    // Function to calculate thresholds for each skill type (e.g., skills, combatSkills)
    function calculateSkillThresholds(skillsObject) {
      for (const [key, anySkill] of Object.entries(skillsObject)) {
        // Ensure skillData is defined and contains critical bonus properties
        const critBonus = anySkill.critbonus || 0;
        const critFailPenalty = anySkill.critfailpenalty || 0;

        // Calculate critical success threshold for each skill
        anySkill.criticalSuccessThreshold = Math.max(
          1,
          baseCriticalSuccess + Math.max(0, luck) + critBonus,
        );

        // Calculate critical failure threshold for each skill
        anySkill.criticalFailureThreshold = Math.min(
          100,
          baseCriticalFailure - Math.max(0, -luck) - critFailPenalty,
        );
      }
    }

    // Calculate thresholds for regular skills and combat skills and attributes
    calculateSkillThresholds(systemData.skills);
    calculateSkillThresholds(systemData.combatSkills);
    calculateSkillThresholds(systemData.attributes);

    // Global thresholds based on luck.value
    this.criticalSuccessThreshold = Math.max(
      1,
      baseCriticalSuccess + Math.max(0, luck),
    );

    this.criticalFailureThreshold = Math.min(
      100,
      baseCriticalFailure - Math.max(0, -luck),
    );

    // Store thresholds in actor data if needed
    actorData.criticalSuccessThreshold = this.criticalSuccessThreshold;
    actorData.criticalFailureThreshold = this.criticalFailureThreshold;
  }

  /**
   * Prepare NPC type specific data.
   */
  _prepareNpcData(actorData) {
    if (actorData.type !== "npc") return;
    const systemData = actorData.system;
    // Make modifications to data here. For example:
    for (let [key, combatSkill] of Object.entries(systemData.combatSkills)) {
      combatSkill.rating =
        Number(combatSkill.value ?? 0) +
        Number(combatSkill.bonus ?? 0) +
        Number(systemData.globalMod ?? 0);

      //console.log("After:", key, combatSkill.rating);
    }

    for (let [key, attribute] of Object.entries(systemData.attributes)) {
      attribute.mod =
        (attribute.value ?? 0) +
        (attribute.modBonus ?? 0) +
        (systemData.globalMod ?? 0);
    }

    for (let [key, attribute] of Object.entries(
      systemData.secondaryAttributes,
    )) {
      attribute.total = (attribute.value ?? 0) + (attribute.bonus ?? 0);
    }
    const initiative = systemData.secondaryAttributes.ini;
    initiative.total = initiative.value + initiative.bonus;
    const hp = systemData.stats.health;
    const stamina = systemData.stats.stamina;
    const holyEnergy = systemData.stats.holyEnergy;
    const mana = systemData.stats.mana;
    const res = systemData.attributes.wil.value;
    systemData.secondaryAttributes.res.total =
      (+res + +systemData.secondaryAttributes.res.bonus) / 10;
    mana.value = Number(mana.value) || 0;
    mana.max = Number(mana.max) || 0;
    const dodgeLimit = systemData.dodgeLimit;
    dodgeLimit.total = dodgeLimit.value + dodgeLimit.bonus;

    holyEnergy.value = Number(holyEnergy.value) || 0;
    holyEnergy.max = Number(holyEnergy.max) || 0;

    stamina.value = Number(stamina.value) || 0;
    stamina.max = Number(stamina.max) || 0;

    hp.value = Number(hp.value) || 0;
    hp.max = Number(hp.max) || 0;
    systemData.xp = systemData.cr * systemData.cr * 100;

    const baseCriticalSuccess = 5; // Base critical success threshold
    const baseCriticalFailure = 96; // Base critical failure threshold

    // Function to calculate thresholds for each skill type (e.g., skills, combatSkills)
    function calculateSkillThresholds(skillsObject) {
      for (const [key, anySkill] of Object.entries(skillsObject)) {
        // Ensure skillData is defined and contains critical bonus properties
        const critBonus = anySkill.critbonus || 0;
        const critFailPenalty = anySkill.critfailpenalty || 0;

        // Calculate critical success threshold for each skill
        anySkill.criticalSuccessThreshold = Math.max(
          1,
          baseCriticalSuccess + critBonus,
        );

        // Calculate critical failure threshold for each skill
        anySkill.criticalFailureThreshold = Math.min(
          100,
          baseCriticalFailure + critFailPenalty,
        );
      }
    }

    // Calculate thresholds for regular skills and combat skills and attributes
    calculateSkillThresholds(systemData.combatSkills);
    calculateSkillThresholds(systemData.attributes);

    // Store thresholds in actor data if needed
    actorData.criticalSuccessThreshold = this.criticalSuccessThreshold;
    actorData.criticalFailureThreshold = this.criticalFailureThreshold;

    systemData.stats.health.value = Math.min(
      systemData.stats.health.value,
      systemData.stats.health.max,
    );
    systemData.stats.stamina.value = Math.min(
      systemData.stats.stamina.value,
      systemData.stats.stamina.max,
    );
    // Toxicity is intentionally NOT clamped to its max: exceeding the maximum
    // is what triggers Toxic Shock (see _syncResourceStateEffects).
    systemData.stats.mana.value = Math.min(
      systemData.stats.mana.value,
      systemData.stats.mana.max,
    );
  }

  /**
   * Override getRollData() that's supplied to rolls.
   */
  getRollData() {
    // Starts off by populating the roll data with a shallow copy of `this.system`
    const data = { ...this.system };

    // Identify the acting actor so the roll layer can apply effects that touch
    // the document itself (e.g. the Desperate Effort fatigue cost).
    data.actorUuid = this.uuid;

    // Prepare character roll data.
    this._getCharacterRollData(data);
    this._getNpcRollData(data);

    // Expose each magic school's spell power as a flat roll token so item
    // and ability formulas can reference it directly (e.g. @spellPowerFire,
    // @spellPowerDarkness). There is no per-ability school selector, so we
    // surface every school separately.
    if (data.schools) {
      for (const [key, school] of Object.entries(data.schools)) {
        const name = key.charAt(0).toUpperCase() + key.slice(1);
        data[`spellPower${name}`] = school?.spellPower ?? 0;
      }
    }

    return data;
  }

  /**
   * Prepare character roll data.
   */
  _getCharacterRollData(data) {
    if (this.type !== "character") return;

    // Copy the attribute scores to the top level, so that rolls can use
    // formulas like `@str.mod + 4`.
    if (data.attributes) {
      for (let [k, v] of Object.entries(data.attributes)) {
        data[k] = foundry.utils.deepClone(v);
      }
    }
  }

  /**
   * Prepare NPC roll data.
   */
  _getNpcRollData(data) {
    if (this.type !== "npc") return;

    // Process additional NPC data here.
  }
  getRequiredAmmoOption(weapon) {
    const wClass = weapon.system.class;
    const isThrown = weapon.system.thrown;

    if (wClass === "bow") return "arrows";
    if (wClass === "crossbow") return "bolts";

    if (isThrown) {
      if (wClass === "sword") return "knives";
      if (wClass === "axe") return "axes";
      if (wClass === "polearm") return "javelins";
    }

    return null;
  }

  getEquippedAmmo(option) {
    return this.items.find(
      (i) =>
        i.type === "ammunition" &&
        i.system.option === option &&
        i.system.equipped === true,
    );
  }

  async deductAmmo(ammoItem) {
    const qty = Number(ammoItem.system.quantity ?? 0);

    if (qty <= 0) return false;

    if (qty === 1) {
      await ammoItem.delete();
    } else {
      await ammoItem.update({
        "system.quantity": qty - 1,
      });
    }

    return true;
  }
}
