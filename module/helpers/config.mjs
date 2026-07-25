export const REDSTEEL = {};

/**
 * The set of Attribute Scores used within the system.
 * @type {Object}
 */
REDSTEEL.attributes = {
  str: "REDSTEEL.Actor.Character.Attribute.Str.long",
  dex: "REDSTEEL.Actor.Character.Attribute.Dex.long",
  end: "REDSTEEL.Actor.Character.Attribute.End.long",
  int: "REDSTEEL.Actor.Character.Attribute.Int.long",
  wil: "REDSTEEL.Actor.Character.Attribute.Wil.long",
  cha: "REDSTEEL.Actor.Character.Attribute.Cha.long",
  per: "REDSTEEL.Actor.Character.Attribute.Per.long",
};

REDSTEEL.attributeAbbreviations = {
  str: "REDSTEEL.Actor.Character.Attribute.Str.abbr",
  dex: "REDSTEEL.Actor.Character.Attribute.Dex.abbr",
  end: "REDSTEEL.Actor.Character.Attribute.End.abbr",
  int: "REDSTEEL.Actor.Character.Attribute.Int.abbr",
  wil: "REDSTEEL.Actor.Character.Attribute.Wil.abbr",
  cha: "REDSTEEL.Actor.Character.Attribute.Cha.abbr",
  per: "REDSTEEL.Actor.Character.Attribute.Per.abbr",
};

REDSTEEL.secondaryAttributes = {
  spd: "REDSTEEL.Actor.Character.SecondaryAttribute.Spd.long",
  lck: "REDSTEEL.Actor.Character.SecondaryAttribute.Lck.long",
  res: "REDSTEEL.Actor.Character.SecondaryAttribute.Res.long",
  fth: "REDSTEEL.Actor.Character.SecondaryAttribute.Fth.long",
  sin: "REDSTEEL.Actor.Character.SecondaryAttribute.Sin.long",
  vis: "REDSTEEL.Actor.Character.SecondaryAttribute.Vis.long",
  ini: "REDSTEEL.Actor.Character.SecondaryAttribute.Ini.long",
};

REDSTEEL.secondaryAttributeAbbreviations = {
  spd: "REDSTEEL.Actor.Character.SecondaryAttribute.Spd.abbr",
  lck: "REDSTEEL.Actor.Character.SecondaryAttribute.Lck.abbr",
  res: "REDSTEEL.Actor.Character.SecondaryAttribute.Res.abbr",
  fth: "REDSTEEL.Actor.Character.SecondaryAttribute.Fth.abbr",
  sin: "REDSTEEL.Actor.Character.SecondaryAttribute.Sin.abbr",
  vis: "REDSTEEL.Actor.Character.SecondaryAttribute.Vis.abbr",
  ini: "REDSTEEL.Actor.Character.SecondaryAttribute.Ini.abbr",
};

REDSTEEL.effectDefinitions = {
  stagger: {
    name: "Staggered",
    img: "icons/svg/daze.svg",
    statuses: ["stagger"],
    defaultTurns: 2,
    useDuration: true,
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -10,
      },
    ],
  },

  bleed: {
    name: "Bleeding",
    img: "icons/skills/wounds/blood-drip-droplet-red.webp",
    statuses: ["bleed"],
    maxStacks: 6,
    stackBehavior: "stack",
    triggers: {
      onApply: {
        formula: "{appliedStacks}d4",
        target: "system.stats.health.value",
      },
      onRoundStart: {
        formula: "{stacks}d4",
        target: "system.stats.health.value",
      },
    },
  },
  burn: {
    name: "Burning",
    img: "icons/magic/fire/flame-burning-campfire-rocks.webp",
    statuses: ["burn"],
    triggers: {
      onApply: {
        formula: "3d6",
        target: "system.stats.health.value",
        panic: true,
      },
      onRoundStart: {
        formula: "3d6",
        target: "system.stats.health.value",
        panic: true,
      },
    },
  },

  panic: {
    name: "Panicked",
    img: "icons/magic/control/fear-fright-white.webp",
    statuses: ["panic"],
    defaultTurns: 2,
    useDuration: true,
    changes: [
      {
        key: "system.globalMod",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -10,
      },
    ],
  },
  wet: {
    name: "Wet",
    img: "icons/magic/water/water-drop-swirl-blue.webp",
    statuses: ["wet"],
    changes: [
      {
        key: "system.effectMods.slow.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 40,
      },
      {
        key: "system.effectMods.freeze.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 25,
      },
      {
        key: "system.effectMods.burn.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -40,
      },
      {
        key: "system.effectMods.chain.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 35,
      },
    ],
  },
  // needs upgrade for suffocation and the existence of a ice block health
  freeze: {
    name: "Freeze",
    img: "icons/magic/water/barrier-ice-crystal-wall-faceted.webp",
    statuses: ["freeze"],
    triggers: {
      onApply: {
        formula: "4d6",
        target: "system.stats.health.value",
      },
      onRoundStart: {
        formula: "4d6",
        target: "system.stats.health.value",
      },
    },
    changes: [
      {
        key: "system.effectMods.slow.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 40,
      },
      {
        key: "system.effectMods.freeze.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 25,
      },
      {
        key: "system.effectMods.burn.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -40,
      },
      {
        key: "system.effectMods.chain.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 35,
      },
    ],
  },
  slow: {
    name: "Slow",
    img: "icons/magic/movement/chevrons-down-yellow.webp",
    statuses: ["slow"],
    defaultTurns: 3,
    useDuration: true,
    changes: [
      {
        key: "system.secondaryAttributes.spd.total",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.MULTIPLY,
        value: 0.5,
      },
      {
        key: "system.combatSkills.throwing.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -5,
      },
      {
        key: "system.combatSkills.meleeDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -5,
      },
      {
        key: "system.combatSkills.rangedDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -5,
      },
      {
        key: "system.combatSkills.dodge.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -30,
      },
      {
        key: "system.combatSkills.combat.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -5,
      },
      {
        key: "system.combatSkills.archery.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -5,
      },
    ],
  },
  root: {
    name: "Root",
    img: "icons/magic/nature/root-vine-entwined-thorns.webp",
    statuses: ["root"],
    changes: [
      {
        key: "system.secondaryAttributes.spd.total",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.MULTIPLY,
        value: 0.5,
      },
      {
        key: "system.combatSkills.meleeDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.rangedDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.dodge.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.combat.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
    ],
  },
  shadowbound: {
    name: "Shadowbound",
    img: "icons/magic/control/debuff-chains-purple.webp",
    statuses: ["shadowbound"],
    triggers: {
      onApply: {
        formula: "2d6",
        target: "system.stats.health.value",
      },
      onRoundStart: {
        formula: "2d6",
        target: "system.stats.health.value",
      },
    },
    changes: [
      {
        key: "system.combatSkills.meleeDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.rangedDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.dodge.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.combat.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
    ],
  },
  poison: {
    name: "Poison",
    img: "icons/magic/acid/dissolve-drip-droplet-smoke.webp",
    statuses: ["poison"],
    defaultRounds: 3,
    useDuration: true,
    maxStacks: 3,
    triggers: {
      onApply: {
        formula: "2d6",
        target: "system.stats.health.value",
      },
      onRoundStart: {
        formula: "2d6",
        target: "system.stats.health.value",
      },
    },
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -5,
      },
    ],
  },
  corrosion: {
    name: "Corrosion",
    img: "icons/skills/melee/shield-damaged-broken-gold.webp",
    statuses: ["corrosion"],
    maxStacks: 99,
    stackBehavior: "stack",
    changes: [
      {
        key: "system.armor.natural.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 0,
      },
    ],
  },
  soul_mark: {
    name: "Soul Mark",
    img: "icons/magic/unholy/orb-contained-pink.webp",
    statuses: ["soul_mark"],
  },
  fear: {
    name: "Fear",
    img: "icons/magic/death/undead-ghost-scream-teal.webp",
    statuses: ["fear"],
    defaultRounds: 3,
    maxStacks: 99,
    useDuration: false,
    stackBehavior: "stack",
    triggers: {
      onApply: {
        custom: "fearTest",
      },
      onRoundStart: {
        custom: "fearRound",
      },
    },
    changes: [
      {
        key: "system.armor.natural.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -4,
      },
    ],
  },
  stun: {
    name: "Stun",
    img: "icons/magic/movement/abstract-ribbons-red-orange.webp",
    statuses: ["stun"],
    defaultTurns: 2,
    useDuration: true,
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -25,
      },
    ],
    stackBehavior: "refresh",
  },
  resist_acid: {
    name: "Resist Acid",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-green.webp",
    statuses: ["resist_acid"],
    changes: [
      {
        key: "system.armor.acid.resistance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  resist_fire: {
    name: "Resist Fire",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-orange.webp",
    statuses: ["resist_fire"],
    changes: [
      {
        key: "system.armor.fire.resistance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  resist_frost: {
    name: "Resist Frost",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-teal-purple.webp",
    statuses: ["resist_frost"],
    changes: [
      {
        key: "system.armor.frost.resistance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  resist_lightning: {
    name: "Resist Lightning",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue-yellow.webp",
    statuses: ["resist_lightning"],
    changes: [
      {
        key: "system.armor.lightning.resistance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  resist_magic: {
    name: "Resist Magic",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue.webp",
    statuses: ["resist_magic"],
    changes: [
      {
        key: "system.armor.magic.resistance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  resist_dark: {
    name: "Resist Dark",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-magenta.webp",
    statuses: ["resist_dark"],
    changes: [
      {
        key: "system.armor.dark.resistance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  ice_weapon: {
    name: "Ice Weapon",
    img: "icons/magic/fire/dagger-rune-enchant-flame-teal.webp",
    statuses: ["ice_weapon"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",

      damageBonus: 2,
      penetrationBonus: 1,

      damageTypeMode: "expand",
      damageTypes: ["magic", "frost"],

      extraEffects: {
        slow: 15,
      },
    },
    stackBehavior: "ignore",
  },
  lightning_weapon: {
    name: "Lightning Weapon",
    img: "icons/magic/fire/dagger-rune-enchant-flame-blue-yellow.webp",
    statuses: ["lightning_weapon"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      penetrationBonus: 4,

      damageTypeMode: "expand",
      damageTypes: ["magic", "lightning"],

      extraEffects: {
        stagger: 10,
      },
    },
    stackBehavior: "ignore",
  },
  fire_weapon: {
    name: "Fire Weapon",
    img: "icons/magic/fire/dagger-rune-enchant-flame-orange.webp",
    statuses: ["fire_weapon"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",

      damageBonus: 3,
      damageTypeMode: "expand",
      damageTypes: ["magic", "fire"],

      extraEffects: {
        burning: 5,
      },
    },
    stackBehavior: "ignore",
  },
  poisoned_weapon: {
    name: "Poisoned Weapon",
    img: "icons/magic/fire/dagger-rune-enchant-green.webp",
    statuses: ["poisoned_weapon"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",

      damageTypeMode: "expand",
      damageTypes: ["poison"],

      extraEffects: {
        poison: 10,
      },
    },
    stackBehavior: "ignore",
  },
  acid_weapon: {
    name: "Acid Weapon",
    img: "icons/magic/fire/dagger-rune-enchant-flame-green.webp",
    statuses: ["acid_weapon"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",

      damageBonus: 1,

      damageTypeMode: "expand",
      damageTypes: ["acid"],

      extraEffects: {
        corrosion: 35,
      },
    },
    stackBehavior: "ignore",
  },
  dark_weapon: {
    name: "Dark Weapon",
    img: "icons/magic/fire/dagger-rune-enchant-flame-purple.webp",
    statuses: ["dark_weapon"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",

      damageBonus: 2,
      penetrationBonus: 2,

      damageTypeMode: "expand",
      damageTypes: ["magic", "dark"],
    },
    stackBehavior: "ignore",
  },
  whetstone: {
    name: "Whetstone",
    img: "icons/commodities/stone/paver-cobble-white.webp",
    statuses: ["whetstone"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      extraEffects: {
        bleed: 10,
      },
    },
    stackBehavior: "ignore",
  },

  /* -------------------------------------------- */
  /*  Strike spells (Lindarovy údery)             */
  /*                                              */
  /*  Free-action caster buffs that ride the next */
  /*  weapon attack. They share the weaponEnchant */
  /*  exclusive group (so a new strike overwrites */
  /*  the previous one, and none stacks with a    */
  /*  weapon enchant), and carry consumeOnAttack  */
  /*  so the createChatMessage hook in redsteel.  */
  /*  mjs removes them after one attack lands or   */
  /*  misses. Unlike the *_weapon enchants these   */
  /*  REPLACE the damage type (damageTypeMode      */
  /*  "override"), matching each spell's           */
  /*  "changes its damage type to ..." wording.    */
  /*  dark_strike / binding_strike carry SK-scaled */
  /*  values baked at cast time in                 */
  /*  applyStrikeEffect (castSpell.mjs).           */
  /* -------------------------------------------- */
  lightning_strike: {
    name: "Lightning Strike",
    img: "icons/magic/lightning/fist-unarmed-strike-blue-green.webp",
    statuses: ["lightning_strike"],
    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      consumeOnAttack: true,
      damageTypeMode: "override",
      damageTypes: ["magic", "lightning"],
      extraEffects: {
        chain: 30,
      },
    },
    stackBehavior: "ignore",
  },
  fire_strike: {
    name: "Fire Strike",
    img: "icons/magic/fire/projectile-smoke-swirl-red.webp",
    statuses: ["fire_strike"],
    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      consumeOnAttack: true,
      damageTypeMode: "override",
      damageTypes: ["magic", "fire"],
      extraEffects: {
        burn: 25,
      },
    },
    stackBehavior: "ignore",
  },
  frost_strike: {
    name: "Frost Strike",
    img: "icons/magic/water/strike-weapon-blade-ice-blue.webp",
    statuses: ["frost_strike"],
    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      consumeOnAttack: true,
      damageTypeMode: "override",
      damageTypes: ["magic", "frost"],
      extraEffects: {
        freeze: 30,
      },
    },
    stackBehavior: "ignore",
  },
  venomous_strike: {
    name: "Venomous Strike",
    img: "icons/magic/acid/projectile-stream-bubbles.webp",
    statuses: ["venomous_strike"],
    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      consumeOnAttack: true,
      damageTypeMode: "override",
      damageTypes: ["magic", "poison"],
      extraEffects: {
        poison: 25,
      },
    },
    stackBehavior: "ignore",
  },
  enchanted_strike: {
    name: "Enchanted Strike",
    img: "icons/magic/fire/dagger-rune-enchant-blue-gray.webp",
    statuses: ["enchanted_strike"],
    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      consumeOnAttack: true,
      damageTypeMode: "override",
      damageTypes: ["magic"],
      extraEffects: {
        paralyze: 15,
      },
    },
    stackBehavior: "ignore",
  },
  dark_strike: {
    name: "Dark Strike",
    img: "icons/magic/death/weapon-sword-skull-purple.webp",
    statuses: ["dark_strike"],
    // damageRoll (1d4 + SK/2) is baked per-cast in applyStrikeEffect; the caster
    // also takes Corruption +2 there. Only the static parts live here.
    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      consumeOnAttack: true,
      penetrationBonus: 2,
      damageTypeMode: "override",
      damageTypes: ["magic", "dark"],
    },
    stackBehavior: "ignore",
  },
  binding_strike: {
    name: "Binding Strike",
    img: "icons/magic/nature/root-vine-hand-strike.webp",
    statuses: ["binding_strike"],
    // Binding Strike has no passive attack modifier — its whole effect is a
    // contested Will+SK*2 vs Str/End test resolved when the attack is consumed
    // (see resolveBindingStrike in redsteel.mjs). It still occupies the
    // weaponEnchant slot so it can't stack with other enhancements.
    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      consumeOnAttack: true,
    },
    stackBehavior: "ignore",
  },
  empower_strike: {
    name: "Empower Strike",
    img: "icons/magic/control/buff-strength-muscle-damage-orange.webp",
    statuses: ["empower_strike"],
    // No damage-type change — keeps the weapon's own type. damageRoll (1d4 +
    // Body SK/2) is baked per-cast in applyStrikeEffect.
    combatModifiers: {
      exclusiveGroup: "weaponEnchant",
      consumeOnAttack: true,
      extraEffects: {
        stun: 15,
      },
    },
    stackBehavior: "ignore",
  },

  defensive_stance: {
    name: "Defensive stance",
    img: "icons/skills/melee/shield-block-gray-yellow.webp",
    statuses: ["defensive_stance"],
    triggers: {
      onRoundStart: {
        formula: "1",
        target: "system.stats.stamina.value",
        custom: "staminaDrain",
      },
    },
    changes: [
      {
        key: "system.combatSkills.meleeDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 20,
      },
      {
        key: "system.combatSkills.rangedDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 10,
      },
    ],
    stackBehavior: "ignore",
  },

  guard: {
    name: "Guard",
    img: "icons/skills/melee/shield-block-gray-yellow.webp",
    statuses: ["guard"],
    defaultTurns: 1,
    useDuration: true,
    stackBehavior: "ignore",
  },

  stone_skin: {
    name: "Stone Skin",
    img: "icons/magic/defensive/armor-stone-skin.webp",
    statuses: ["stone_skin"],
    changes: [
      {
        key: "system.armor.natural.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 0,
      },
      {
        key: "system.dodge.limit.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 0, // dynamic negative penalty
      },
    ],
    triggers: {
      onApply: { custom: "stoneSkinUpdate" },
    },
    stackBehavior: "ignore",
  },

  channeling: {
    name: "Channeling",
    img: "icons/magic/lightning/orb-ball-spiral-blue.webp",
    statuses: ["channeling"],

    triggers: {
      onRoundStart: {
        custom: "channelingDrain",
      },
    },
    stackBehavior: "ignore",
  },

  // Wild magic spells DoTs

  iceStrike: {
    name: "Ice Strike",
    img: "icons/magic/lightning/orb-ball-spiral-blue.webp",
    statuses: ["iceStrike"],

    triggers: {
      onApply: {
        formula: "icestrikeDamage",
        target: "system.stats.health.value",
      },
      onRoundStart: {
        formula: "icestrikeDamage",
        target: "system.stats.health.value",
      },
    },
  },

  regeneration: {
    name: "Regeneration",
    img: "icons/magic/life/heart-cross-green.webp",
    statuses: ["regeneration"],

    triggers: {
      onApply: {
        formula: "2d4 + 2",
        custom: "regenerationHeal",
      },
      onRoundStart: {
        formula: "2d4 + 2",
        custom: "regenerationHeal",
      },
    },
  },
  cyclone: {
    name: "Cyclone",
    img: "icons/magic/air/wind-tornado-cyclone-white.webp",
    statuses: ["cyclone"],
    defaultTurns: 3,
    useDuration: true,
  },
  sleep: {
    name: "Sleep",
    img: "icons/magic/control/sleep-bubble-purple.webp",
    statuses: ["sleep"],
    defaultTurns: 3,
    useDuration: true,
  },
  nourishing_rest: {
    name: "Nourishing rest",
    img: "icons/magic/nature/cornucopia-orange.webp",
    statuses: ["nourishing_rest"],
  },
  dead: {
    name: "Dead",
    img: "icons/svg/skull.svg",
  },
  prone: {
    name: "Prone",
    img: "icons/svg/falling.svg",
    statuses: ["prone"],

    triggers: {
      onApply: {
        custom: "proneInitiative",
      },
    },
    changes: [
      {
        key: "system.combatSkills.meleeDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -20,
      },
      {
        key: "system.combatSkills.rangedDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -20,
      },
      {
        key: "system.combatSkills.dodge.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -25,
      },
      {
        key: "system.combatSkills.combat.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -20,
      },
    ],
  },
  // Applied (together with Downed) when a character is reduced to 0 health.
  // See effects.mjs: _handleDyingStart / _handleDyingCountdown and the
  // dying-removal resolve message in _onDelete.
  dying: {
    name: "Dying",
    img: "icons/svg/blood.svg",
    statuses: ["dying"],
    // No stacking: re-applying (e.g. taking more damage while already dying)
    // must not re-roll the bleed-out countdown.
    stackBehavior: "ignore",
    triggers: {
      onApply: { custom: "dyingStart" },
      onRoundStart: { custom: "dyingCountdown" },
    },
  },
  // Applied (together with Dying) when a character is reduced to 0 health.
  // See effects.mjs: _handleDownedStart (Mind loss + Endurance/Will prompt).
  downed: {
    name: "Downed",
    img: "icons/svg/daze.svg",
    statuses: ["downed"],
    // No stacking: the Mind-point loss must only happen once.
    stackBehavior: "ignore",
    triggers: {
      onApply: { custom: "downedStart" },
    },
  },
  crippled: {
    name: "Crippled",
    img: "icons/skills/ranged/arrow-strike-apple-orange.webp",
    statuses: ["crippled"],
    defaultTurns: 3,
    useDuration: true,

    changes: [
      {
        key: "system.combatSkills.dodge.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -20,
      },
    ],
  },

  // ==========================================================
  // Physiological states driven by resource thresholds. These are
  // auto-applied / removed by RedsteelActiveEffect._syncResourceStateEffects
  // (effects.mjs) on every actor update — not toggled by hand.
  // ==========================================================

  // "Unavený" — occurs while Stamina (Výdrž) is at 0. The character loses one
  // action (a minimum of one always remains) — surfaced via the roll pill,
  // since the action economy is not data-modelled — takes −5% to every Success
  // roll, and has Speed halved.
  fatigued: {
    name: "Fatigued",
    img: "icons/svg/degen.svg",
    statuses: ["fatigued"],
    // Re-applying (e.g. spending the last stamina again) must not stack.
    stackBehavior: "ignore",
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -5,
      },
      {
        key: "system.secondaryAttributes.spd.total",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.MULTIPLY,
        value: 0.5,
      },
    ],
  },

  // "Toxický šok" — occurs the moment Toxicity exceeds its maximum. Each round
  // the victim suffers 25 raw damage (bypassing armor) and tests Endurance
  // (−40) or is Stunned (Ochromení = stun). See effects.mjs _handleToxicShock.
  toxic_shock: {
    name: "Toxic Shock",
    img: "icons/svg/poison.svg",
    statuses: ["toxic_shock"],
    // Re-applying while still over the threshold must not re-stack.
    stackBehavior: "ignore",
    triggers: {
      onApply: { custom: "toxicShock" },
      onRoundStart: { custom: "toxicShock" },
    },
  },

  // "Zkažený" — a token marker synced to Corruption degree 2+ (61+). The
  // numeric buffs (Magic Attack/Defense, Dark Spell Power) come from the derived
  // corruptionDegree in actor.mjs, so this carries no `changes`; it exists so
  // the corrupted state is visible on the token and readable by other systems.
  // The defense-roll reminder pill is emitted directly in traitPills.mjs.
  corrupted: {
    name: "Corrupted (Zkažený)",
    img: "icons/svg/blood.svg",
    statuses: ["corrupted"],
    stackBehavior: "ignore",
    changes: [],
  },

  // "Posednutí" — the losing side of a Mental Duel (Mind Bending) is possessed
  // by the winner. This is purely a visible token marker with no numeric
  // changes: the actual mechanic is an ownership grant recorded in
  // flags.redsteel.possession on the possessed actor (see mentalDuel.mjs).
  // Removing this status is the canonical way to END possession — the effect's
  // _onDelete (documents/effects.mjs) restores the original ownership.
  possessed: {
    name: "Possessed (Posednutí)",
    img: "icons/svg/terror.svg",
    statuses: ["possessed"],
    stackBehavior: "ignore",
    changes: [],
  },

  // ==========================================================
  // Effects referenced by spells (Kniha kouzel) and the spell
  // sheet effectTypes vocabulary that previously had no
  // definition. Penalty values are provisional — tune to the
  // rulebook where it specifies exact numbers.
  // ==========================================================

  // Not used by spells (Ochromení in the spell book = stun) — reserved
  // for other sources (abilities, conditions, monsters).
  paralyze: {
    name: "Paralyzed",
    img: "icons/svg/paralysis.svg",
    statuses: ["paralyze"],
    defaultTurns: 2,
    useDuration: true,
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -40,
      },
    ],
    stackBehavior: "refresh",
  },

  blind: {
    name: "Blinded",
    img: "icons/svg/blind.svg",
    statuses: ["blind"],
    changes: [
      {
        key: "system.combatSkills.combat.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -30,
      },
      {
        key: "system.combatSkills.archery.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -50,
      },
      {
        key: "system.combatSkills.throwing.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -50,
      },
      {
        key: "system.combatSkills.meleeDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.rangedDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.dodge.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
    ],
    stackBehavior: "refresh",
  },

  dazzled: {
    name: "Dazzled",
    img: "icons/svg/daze.svg",
    statuses: ["dazzled"],
    defaultTurns: 2,
    useDuration: true,
    changes: [
      {
        key: "system.combatSkills.combat.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -10,
      },
      {
        key: "system.combatSkills.archery.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -20,
      },
      {
        key: "system.combatSkills.throwing.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -20,
      },
    ],
    stackBehavior: "refresh",
  },

  disorientation: {
    name: "Disoriented",
    img: "icons/magic/control/hypnosis-mesmerism-swirl.webp",
    statuses: ["disorientation"],
    defaultTurns: 3,
    useDuration: true,
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -10,
      },
    ],
    stackBehavior: "refresh",
  },

  // Grease ("Tuk") — inverse of Wet: easier to set on fire.
  flammable: {
    name: "Flammable",
    img: "icons/svg/fire.svg",
    statuses: ["flammable"],
    changes: [
      {
        key: "system.effectMods.burn.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 40,
      },
    ],
    stackBehavior: "ignore",
  },

  // Stronger Fear — reuses the fear resolve-test machinery.
  terror: {
    name: "Terror",
    img: "icons/svg/terror.svg",
    statuses: ["terror"],
    defaultRounds: 3,
    maxStacks: 99,
    useDuration: false,
    stackBehavior: "stack",
    triggers: {
      onApply: {
        custom: "fearTest",
      },
      onRoundStart: {
        custom: "fearRound",
      },
    },
    changes: [
      {
        key: "system.armor.natural.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -8,
      },
    ],
  },

  weak: {
    name: "Weakened",
    img: "icons/svg/downgrade.svg",
    statuses: ["weak"],
    defaultTurns: 3,
    useDuration: true,
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -10,
      },
    ],
    stackBehavior: "refresh",
  },

  // "Zranitelnost" / Hex — while active, every ORIGINAL instance of damage the
  // target takes deals an extra 1d8 that ignores armor (Kz). Each distinct
  // damage source counts separately (a hit + its Bleeding + its poison = three
  // separate 1d8 riders, each rolled when that source actually deals damage);
  // a single combined Bleeding tick is one instance, so "3 Krvácení = 1d8".
  // The rider is applied at a single chokepoint in effects.mjs
  // (preUpdateActor/updateActor → _applyHexRider). Lasts 3 rounds.
  hex: {
    name: "Hex",
    img: "icons/svg/target.svg",
    statuses: ["hex"],
    defaultRounds: 3,
    useDuration: true,
    stackBehavior: "refresh",
  },

  // Like corrosion but -8 Az per stack (updateCorrosionChange).
  corrosion_severe: {
    name: "Severe Corrosion",
    img: "icons/skills/melee/shield-damaged-broken-gold.webp",
    statuses: ["corrosion_severe"],
    maxStacks: 99,
    stackBehavior: "stack",
    changes: [
      {
        key: "system.armor.natural.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 0,
      },
    ],
  },

  // "Zkamenění" / "Odkamenění" — Petrification spells.
  petrify: {
    name: "Petrified",
    img: "icons/magic/earth/strike-body-stone-crumble.webp",
    statuses: ["petrify"],
    stackBehavior: "ignore",
  },

  // "Vyřazen" — knocked out / out of the fight.
  incapacitated: {
    name: "Incapacitated",
    img: "icons/svg/unconscious.svg",
    statuses: ["incapacitated"],
    stackBehavior: "ignore",
  },

  // "Utišení", "Morganin bič" — school/spellcasting disabled.
  silenced: {
    name: "Silenced",
    img: "icons/svg/silenced.svg",
    statuses: ["silenced"],
    defaultRounds: 3,
    useDuration: true,
    stackBehavior: "refresh",
  },

  // "Splývání", "Neviditelnost", "Dokonalá neviditelnost".
  invisible: {
    name: "Invisible",
    img: "icons/svg/invisible.svg",
    statuses: ["invisible"],
    stackBehavior: "ignore",
  },

  // "Okouzlení" — marker; behaviour is adjudicated manually.
  charm: {
    name: "Charmed",
    img: "icons/magic/control/hypnosis-mesmerism-eye.webp",
    statuses: ["charm"],
    stackBehavior: "ignore",
  },

  // "Běsnění", "Krvavá mlha" — marker; forced attacks are manual.
  frenzy: {
    name: "Frenzy",
    img: "icons/svg/explosion.svg",
    statuses: ["frenzy"],
    defaultTurns: 3,
    useDuration: true,
    stackBehavior: "refresh",
  },

  // "Mentální vytížení" — prerequisite for Rozkaz / mental duel.
  mental_strain: {
    name: "Mental Strain",
    img: "icons/svg/aura.svg",
    statuses: ["mental_strain"],
    stackBehavior: "ignore",
  },

  // "Rychlost" — the +1 Action part is not automated.
  haste: {
    name: "Haste",
    img: "icons/svg/upgrade.svg",
    statuses: ["haste"],
    changes: [
      {
        key: "system.secondaryAttributes.spd.total",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 1,
      },
      {
        key: "system.secondaryAttributes.ini.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 4,
      },
    ],
    stackBehavior: "ignore",
  },

  // "Létání" — movement speed 8 while flying.
  flight: {
    name: "Flying",
    img: "icons/svg/wing.svg",
    statuses: ["flight"],
    changes: [
      {
        key: "system.secondaryAttributes.spd.total",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: 8,
      },
    ],
    stackBehavior: "ignore",
  },

  // "Obnovení" — heal over time with a fixed duration.
  restoration: {
    name: "Restoration",
    img: "icons/svg/regen.svg",
    statuses: ["restoration"],
    defaultRounds: 2,
    useDuration: true,
    stackBehavior: "refresh",
    triggers: {
      onRoundStart: {
        formula: "2d6 + 1",
        custom: "regenerationHeal",
      },
      onApply: {
        formula: "2d6 + 1",
        custom: "regenerationHeal",
      },
    },
  },

  // "Odolnost na Omráčení" — the +SK% part is not automated.
  resist_stun: {
    name: "Resist Stuns",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue.webp",
    statuses: ["resist_stun"],
    changes: [
      {
        key: "system.effectMods.stun.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.effectMods.stagger.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
    ],
    stackBehavior: "ignore",
  },

  // "Ochrana před Krvácením", "Milost Eluviel" — stops current
  // bleeds on apply and blocks new ones for the duration.
  resist_bleed: {
    name: "Bleed Ward",
    img: "icons/svg/blood.svg",
    statuses: ["resist_bleed"],
    defaultRounds: 3,
    useDuration: true,
    triggers: {
      onApply: {
        custom: "clearBleeds",
      },
    },
    changes: [
      {
        key: "system.effectMods.bleed.applyChance",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -1000,
      },
    ],
    stackBehavior: "refresh",
  },

  // "Ochrana před teplem / chladem / bouří" — +2 elemental Az.
  protection_warmth: {
    name: "Protection from Warmth",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-orange.webp",
    statuses: ["protection_warmth"],
    changes: [
      {
        key: "system.armor.fire.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 2,
      },
    ],
    stackBehavior: "ignore",
  },

  protection_cold: {
    name: "Protection from Cold",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-teal-purple.webp",
    statuses: ["protection_cold"],
    changes: [
      {
        key: "system.armor.frost.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 2,
      },
    ],
    stackBehavior: "ignore",
  },

  protection_storm: {
    name: "Protection from Storm",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-blue-yellow.webp",
    statuses: ["protection_storm"],
    changes: [
      {
        key: "system.armor.lightning.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 2,
      },
    ],
    stackBehavior: "ignore",
  },

  // "Ochrana před žárem" (Protection from Heat) — the Expert-rank upgrade of
  // Protection from Warmth: +10 Fire armor and outright immunity to Burning.
  // The two never coexist ("Není slučitelné s Ochranou před teplem"), which is
  // enforced by EFFECT_OVERRIDES in effects.mjs.
  protection_heat: {
    name: "Protection from Heat",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-orange.webp",
    statuses: ["protection_heat"],
    changes: [
      {
        key: "system.armor.fire.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 10,
      },
      {
        key: "system.effectMods.burn.immune",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  // "Voděodolnost" (Waterproofing) — cast on a creature it grants immunity to
  // the Wet effect for SK × 5 minutes. Out-of-combat duration, so no rounds.
  waterproof: {
    name: "Waterproof",
    img: "icons/magic/water/water-drop-swirl-blue.webp",
    statuses: ["waterproof"],
    changes: [
      {
        key: "system.effectMods.wet.immune",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  // "Odkamenění" (Depetrification) — after reverting the target it grants
  // immunity to Petrification for SK turns. The duration is baked from the
  // caster's Earth Spell Power in applyEffect's dynamic block.
  petrify_ward: {
    name: "Petrification Ward",
    img: "icons/commodities/stone/paver-cobble-white.webp",
    statuses: ["petrify_ward"],
    useDuration: true,
    defaultTurns: 1, // fallback only — overwritten with SK at apply time
    changes: [
      {
        key: "system.effectMods.petrify.immune",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "refresh",
  },

  // "Ochrana mysli" (Mind ward) — immunity to Disorientation, plus +20 % to
  // Mind Bending while DEFENDING a Mental Duel. The defence bonus is read off
  // this status in mentalDuel.mjs (it must not help the warded actor when they
  // attack, so it cannot live in `changes`). The −20 % to an enemy's chance of
  // starting a Mental combat stays manual.
  mind_ward: {
    name: "Mind Ward",
    img: "icons/magic/control/hypnosis-mesmerism-eye.webp",
    statuses: ["mind_ward"],
    changes: [
      {
        key: "system.effectMods.disorientation.immune",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.OVERRIDE,
        value: true,
      },
    ],
    stackBehavior: "ignore",
  },

  // "Čistý vzduch" (Clean air) — protection from poisonous and intoxicating
  // gases for SK hours. Environmental, with no combat numbers of its own, so
  // the status is purely a marker the GM adjudicates against. Deliberately NOT
  // full Poison immunity — the spell wards gases, not venom.
  clean_air: {
    name: "Clean Air",
    img: "icons/magic/air/wind-tornado-cyclone-white.webp",
    statuses: ["clean_air"],
    stackBehavior: "ignore",
  },

  // "Odpuzovač" (Repellent) — repels insects for SK hours. Marker only; what
  // it turns away is a GM call, and it carries no combat modifier.
  insect_repellent: {
    name: "Insect Repellent",
    img: "icons/svg/aura.svg",
    statuses: ["insect_repellent"],
    stackBehavior: "ignore",
  },

  // "Ohnivý štít" (Flame Shield) — the aura hurts anyone attacking its bearer
  // for 1d4 + SK/2. The retaliation is rolled manually (recast the spell for
  // 0 mana when the bearer is attacked), so this is a marker that makes the
  // aura visible and locks out the other shields.
  flame_shield: {
    name: "Flame Shield",
    img: "icons/svg/fire.svg",
    statuses: ["flame_shield"],
    stackBehavior: "ignore",
  },

  // "Bleskový štít" (Lightning shield) — anyone who hits the bearer is
  // Staggered (100 %, applied by hand from the Stagger status). Marker +
  // shield exclusivity, same as Flame Shield.
  lightning_shield: {
    name: "Lightning Shield",
    img: "icons/magic/lightning/orb-ball-spiral-blue.webp",
    statuses: ["lightning_shield"],
    stackBehavior: "ignore",
  },

  // "Vzdušný štít" (Air shield) — 30 + SK % to deflect projectiles and half
  // damage from Ranged/Thrown attacks. Both are rolled manually when the
  // bearer is shot at; the rules do not make it exclusive with the shields.
  air_shield: {
    name: "Air Shield",
    img: "icons/magic/air/wind-tornado-cyclone-white.webp",
    statuses: ["air_shield"],
    stackBehavior: "ignore",
  },

  // "Krvavá zbraň" / "Sanguine blade" — Bleeding chance +50%.
  sanguine_blade: {
    name: "Sanguine blade",
    img: "icons/skills/wounds/blood-drip-droplet-red.webp",
    statuses: ["sanguine_blade"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",

      extraEffects: {
        bleed: 50,
      },
    },
    stackBehavior: "ignore",
  },

  // "Koagulace" / "Coagulation" — while active, Bleeding effects on the target
  // last only one round. Duration (in rounds) scales with the caster's Blood
  // Spell Power (SK) — baked in applyEffect's dynamic block. The per-round
  // `clampBleeds` trigger caps every Bleeding effect to a single remaining
  // round so the engine's own round decrement removes them.
  coagulation: {
    name: "Coagulation",
    img: "icons/skills/wounds/blood-cells-disease-green.webp",
    statuses: ["coagulation"],
    defaultRounds: 1, // overwritten with SK at apply time
    useDuration: true,
    stackBehavior: "refresh",
    triggers: {
      onApply: { custom: "clampBleeds" },
      onRoundStart: { custom: "clampBleeds" },
    },
  },

  // "Otrávená krev" / "Poisoned blood" — Dark + Poison DoT equal to
  // 1d6 + SK for four rounds, ignoring base armor. The SK term is baked into
  // the damage formula in applyEffect's dynamic block.
  poisoned_blood: {
    name: "Poisoned blood",
    img: "icons/magic/death/skull-poison-green.webp",
    statuses: ["poisoned_blood"],
    // 1 tick onApply + 3 onRoundStart ticks = four rounds of damage.
    defaultRounds: 3,
    useDuration: true,
    stackBehavior: "refresh",
    triggers: {
      onApply: {
        custom: "conditionDamage",
        damage: "1d6", // SK appended at apply time → "1d6 + <SK>"
        damageProfile: { expression: ["dark", "and", "poison"] },
      },
      onRoundStart: {
        custom: "conditionDamage",
        damage: "1d6",
        damageProfile: { expression: ["dark", "and", "poison"] },
      },
    },
  },

  // "Spárů démona" / "Demonic grasp" — Dark + Blunt DoT equal to SK × 4 per
  // round for up to four rounds, ignoring base armor; also applies two
  // Bleeding effects each round and Roots the target for the duration.
  // The SK × 4 damage is baked into the trigger in applyEffect's dynamic block;
  // the Root portion is bundled into `changes` so it ends with the effect.
  demonic_grasp: {
    name: "Demonic grasp",
    img: "icons/magic/unholy/strike-hand-glow-pink.webp",
    statuses: ["demonic_grasp"],
    // 1 tick onApply + 3 onRoundStart ticks = "up to four rounds" of damage
    // and Bleeding application; Root lasts until the effect is removed.
    defaultRounds: 3,
    useDuration: true,
    stackBehavior: "refresh",
    triggers: {
      onApply: {
        custom: "demonicGrasp",
        damage: "0", // overwritten with SK × 4 at apply time
        bleedStacks: 2,
        damageProfile: { expression: ["dark", "and", "blunt"] },
      },
      onRoundStart: {
        custom: "demonicGrasp",
        damage: "0",
        bleedStacks: 2,
        damageProfile: { expression: ["dark", "and", "blunt"] },
      },
    },
    // Rooted: same penalties as the built-in `root` effect.
    changes: [
      {
        key: "system.secondaryAttributes.spd.total",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.MULTIPLY,
        value: 0.5,
      },
      {
        key: "system.combatSkills.meleeDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.rangedDefense.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.dodge.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
      {
        key: "system.combatSkills.combat.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -15,
      },
    ],
  },

  // "Přízračná zbraň" — damage type becomes Magic.
  spectral_weapon: {
    name: "Spectral Weapon",
    img: "icons/svg/sword.svg",
    statuses: ["spectral_weapon"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",

      damageTypeMode: "expand",
      damageTypes: ["magic"],
    },
    stackBehavior: "ignore",
  },

  // "Roj hmyzu" / "Hejno hmyzu" — DoT + per-round panic test.
  // -1 Reaction / no Aim / Perception penalty are not automated.
  insect_swarm: {
    name: "Insect Swarm",
    img: "icons/svg/hazard.svg",
    statuses: ["insect_swarm"],
    defaultRounds: 3,
    useDuration: true,
    stackBehavior: "refresh",
    triggers: {
      onRoundStart: {
        formula: "1d4",
        custom: "insectSwarm",
      },
    },
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -5,
      },
      {
        key: "system.combatSkills.archery.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -50,
      },
      {
        key: "system.combatSkills.throwing.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -50,
      },
    ],
  },

  // "Entropie" — the "1 damage per reduced Az" part is manual.
  entropy: {
    name: "Entropy",
    img: "icons/svg/degen.svg",
    statuses: ["entropy"],
    defaultRounds: 3,
    useDuration: true,
    changes: [
      {
        key: "system.armor.natural.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -10,
      },
    ],
    stackBehavior: "refresh",
  },

  // "Stínová forma" — the 20% physical-damage avoidance is manual.
  shadow_form: {
    name: "Shadow Form",
    img: "icons/svg/cowled.svg",
    statuses: ["shadow_form"],
    changes: [
      {
        key: "system.skills.stealth.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 10,
      },
    ],
    stackBehavior: "ignore",
  },

  // "Flicker" — drops the target's Initiative by 3 for SK rounds
  // (full Spell Power of the casting school). The −3 is fixed, so it
  // lives here; the SK-scaled duration is set in effects.mjs.
  flicker: {
    name: "Flicker",
    img: "icons/magic/lightning/bolt-strike-blue.webp",
    statuses: ["flicker"],
    useDuration: true,
    defaultRounds: 1, // fallback only — real duration = SK rounds
    changes: [
      {
        key: "system.secondaryAttributes.ini.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -3,
      },
    ],
    stackBehavior: "refresh",
  },

  // ==========================================================
  // DEMO / TEMPLATE — Spell Power (SK) scaled effect.
  // A worked example of an effect whose magnitude AND duration
  // derive from the caster's Spell Power in the spell's school.
  // The numbers are filled in at apply-time in effects.mjs
  // (applyEffect → dynamic block, case "sk_demo"); copy that
  // block + this entry as the starting point for new SK effects.
  // ==========================================================
  sk_demo: {
    name: "Spell Power Demo",
    img: "icons/magic/control/energy-stream-link-blue.webp",
    statuses: ["sk_demo"],
    useDuration: true,
    // Fallback only — the real duration is computed from SK in effects.mjs.
    defaultTurns: 1,
    // `changes` stays empty: the SK-scaled change is pushed dynamically so it
    // can read the live caster value at the moment of casting.
    changes: [],
    stackBehavior: "refresh",
  },

  // ==========================================================
  // "Mentální souboj" (Mind Bending) — CASTER side.
  // ----------------------------------------------------------
  // Applied to the *caster* (not the target) when Mind Bending is
  // cast. The rule: while the duel lasts the caster is forced into
  // Slow Movement and takes −20% to Success, EXCEPT Will Tests and
  // the Mental Duel itself.
  //
  // Encoded so the net effect matches the rule:
  //   • system.globalBonus −20  → −20% to every Success roll
  //     (all skill ratings + attribute mods read globalMod).
  //   • system.attributes.wil.modBonus +20 → cancels the −20 on
  //     Will Tests (mod = 15 + modBonus + globalMod + …).
  //   • system.skills.mindBending.bonus +20 → cancels the −20 on
  //     the Mental Duel skill (rating = … + bonus + globalMod).
  //
  // No defaultRounds/Turns: lasts "po dobu trvání" → removed by
  // hand (or by the GM) when the duel ends. `refresh` so re-casting
  // doesn't stack the penalty. Slow Movement is applied alongside
  // as the separate `slow_movement` marker (see castSpell.mjs).
  // ==========================================================
  mind_bending_caster: {
    name: "Mind Bending (Caster)",
    img: "icons/magic/control/hypnosis-mesmerism-eye.webp",
    statuses: ["mind_bending_caster"],
    stackBehavior: "refresh",
    changes: [
      {
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -20,
      },
      {
        key: "system.attributes.wil.modBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 20,
      },
      {
        key: "system.skills.mindBending.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 20,
      },
    ],
  },

  // "Pomalý pohyb" — forced Slow Movement marker. Pure visual/manual
  // marker (the action restriction is adjudicated at the table); no
  // changes. Applied to the Mind Bending caster alongside the debuff.
  slow_movement: {
    name: "Slow Movement",
    img: "icons/magic/movement/chevrons-down-yellow.webp",
    statuses: ["slow_movement"],
    stackBehavior: "ignore",
  },

  // Aimed Strike — applied to the TARGET when an aimed hit lands on Hands.
  // Grants disadvantage on all attacks made with a two-handed weapon grip.
  maimed_hands: {
    name: "Zranění rukou",
    img: "icons/skills/wounds/injury-hand-blood-red.webp",
    statuses: ["maimed_hands"],
    defaultTurns: 2,
    useDuration: true,
    changes: [
      {
        key: "system.rollAdvantage.twoHanded",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -1,
      },
    ],
    stackBehavior: "refresh",
  },

  // Aimed Strike — applied to the TARGET when an aimed hit lands on Legs.
  // Grants disadvantage on dodge rolls.
  maimed_legs: {
    name: "Zranění nohou",
    img: "icons/skills/wounds/injury-foot-blood-red.webp",
    statuses: ["maimed_legs"],
    defaultTurns: 2,
    useDuration: true,
    changes: [
      {
        key: "system.rollAdvantage.dodge",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -1,
      },
    ],
    stackBehavior: "refresh",
  },

  // Ranger's Odhalení slabiny ("Expose Weakness"): marks one target as a Bane
  // shared by every ally attacking it, using the marking Ranger's own Bane
  // profile. Carries no changes of its own — the bonuses are resolved
  // per-target live in baneCombat.mjs. Cleared when that Ranger marks someone
  // else or when combat ends.
  expose_weakness: {
    name: "REDSTEEL.Banes.ExposeEffect",
    img: "icons/svg/target.svg",
    statuses: ["expose_weakness"],
    stackBehavior: "refresh",
  },

  // ==========================================================
  // SHIELDS — absorb pools spent before armor.
  // ----------------------------------------------------------
  // The remaining pool lives in `flags.redsteel.stacks`, so the
  // token counter shows it for free and the GM can edit it the
  // same way as any other stacking effect. `shield` holds the
  // matching rules; the pool size is baked from the caster's SK
  // at apply time (see the dynamic block in effects.mjs).
  //
  // Matching (SPELL_EFFECTS_DEV_PLAN.md B.4): a packet is soaked
  // when its class equals `matchClass` OR its damage expression
  // contains one of `matchTypes`. The OR is what lets Elementární
  // štít stop both `physical AND fire` and `magic AND fire`.
  //
  // All three are "Není slučitelný s dalšími Štíty" → they
  // override each other (see EFFECT_OVERRIDES in effects.mjs),
  // so at most one is ever active.
  // ==========================================================

  // "Štít" — absorbs physical damage, can be dispelled.
  shield_physical: {
    name: "Shield",
    img: "icons/svg/shield.svg",
    statuses: ["shield_physical"],
    stackBehavior: "reset", // recasting replaces the pool, never adds
    maxStacks: 9999,
    shield: {
      matchClass: "physical",
      matchTypes: [],
      absorbFullHit: false,
      blocksMagicEffects: false,
      dispellable: true,
      pool: { base: 15, perSpellPower: 4 },
    },
  },

  // "Magický štít" — absorbs magical damage, eats an oversized hit
  // whole ("pohltí jednorázově i větší zranění"), blocks magical
  // effects while up, immune to Protikouzlo.
  shield_magic: {
    name: "Magic Shield",
    img: "icons/magic/defensive/shield-hex-blue.webp",
    statuses: ["shield_magic"],
    stackBehavior: "reset",
    maxStacks: 9999,
    shield: {
      matchClass: "magical",
      matchTypes: [],
      absorbFullHit: true,
      blocksMagicEffects: true,
      dispellable: false,
      pool: { base: 15, perSpellPower: 4 },
    },
  },

  // "Elementární štít" — absorbs physical damage AND one chosen
  // element, in both its magical and non-magical form. The element
  // is swappable as a Free Action for 3 mana (edit the row on the
  // Config tab); the mana is NOT deducted automatically. Note the
  // spell's "25 / 3" cost is 25 to cast plus 3 per switch — it has
  // no per-round upkeep, so it never starts Channeling.
  shield_elemental: {
    name: "Elemental Shield",
    img: "icons/svg/daze.svg",
    statuses: ["shield_elemental"],
    stackBehavior: "reset",
    maxStacks: 9999,
    shield: {
      matchClass: "physical",
      matchTypes: ["fire"], // default pick; swapped per cast
      absorbFullHit: false,
      blocksMagicEffects: false,
      dispellable: false,
      pool: { base: 20, perSpellPower: 5 },
      // Offered in the Config-tab element picker. Acid and poison are one
      // choice per the rules ("Kyselinové/Jedovaté").
      elementChoices: [
        ["fire"],
        ["frost"],
        ["lightning"],
        ["acid", "poison"],
      ],
    },
  },

  // "Krvavý štít" (Blood Shield) — the Blood School talent-tree perk. Every time
  // its bearer loses Life to a hit, they gain a physical-absorbing shield worth
  // half the Life lost, lasting until the end of the round. It is applied
  // reactively from the damage pipeline (see applyDamage.mjs) with an explicit
  // pool via `poolOverride`, so the SK formula below is never used. Unlike the
  // three cast shields it is NOT in EFFECT_OVERRIDES, so it coexists with them,
  // and it stacks: repeated hits in the same round build one growing pool.
  blood_shield: {
    name: "Krvavý štít",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-red.webp",
    statuses: ["blood_shield"],
    stackBehavior: "stack", // repeated hits in a round add to the same pool
    maxStacks: 9999,
    defaultRounds: 1, // "do konce kola" — cleared at the start of the next round
    shield: {
      matchClass: "physical",
      matchTypes: [],
      absorbFullHit: false,
      blocksMagicEffects: false,
      dispellable: false,
      pool: { base: 0, perSpellPower: 0 },
    },
  },
};

/** Effect ids that carry an absorb pool, in the order they are drained. */
REDSTEEL.shieldEffectIds = Object.entries(REDSTEEL.effectDefinitions)
  .filter(([, def]) => def.shield)
  .map(([id]) => id);

REDSTEEL.statusEffects = Object.entries(REDSTEEL.effectDefinitions).map(
  ([id, def]) => ({
    id,
    name: def.name,
    img: def.img,
  }),
);
