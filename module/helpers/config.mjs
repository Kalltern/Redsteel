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

  // Marker only — the damage-amplification part must be resolved
  // in the damage pipeline (see harder-to-implement list).
  vulnerable: {
    name: "Vulnerable",
    img: "icons/svg/target.svg",
    statuses: ["vulnerable"],
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
    defaultRounds: 3,
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
  protection_heat: {
    name: "Protection from Heat",
    img: "icons/magic/defensive/shield-barrier-glowing-triangle-orange.webp",
    statuses: ["protection_heat"],
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

  // "Krvavá zbraň" — Bleeding chance +50%.
  blood_weapon: {
    name: "Blood Weapon",
    img: "icons/skills/wounds/blood-drip-droplet-red.webp",
    statuses: ["blood_weapon"],

    combatModifiers: {
      exclusiveGroup: "weaponEnchant",

      extraEffects: {
        bleed: 50,
      },
    },
    stackBehavior: "ignore",
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
};

REDSTEEL.statusEffects = Object.entries(REDSTEEL.effectDefinitions).map(
  ([id, def]) => ({
    id,
    name: def.name,
    img: def.img,
  }),
);
