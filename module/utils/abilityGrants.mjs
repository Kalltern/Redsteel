/**
 * Data-driven ability grants.
 *
 * Owning a particular feature / trait / item, having a skill, weapon skill or
 * doctrine at or above a threshold, or having unlocked a specialisation node
 * can grant one or more abilities to a Character or NPC. Granted abilities are
 * copied from a compendium, tagged so we own them, and removed again
 * automatically when the trigger goes away.
 *
 * To add a new grant, append an object to ABILITY_GRANTS below. Each rule has:
 *
 *   when:  the trigger. One of:
 *            { kind: "always" }                             // baseline: everyone
 *            { kind: "item", name: "Berserker" }            // owns an item with this name
 *            { kind: "item", uuid: "Compendium..." }        // owns an item from this source
 *            { kind: "item", uuid: "...", type: "feature" } // ...optionally constrained by type
 *            { kind: "skill", key: "athletics", min: 1 }    // skill value >= min (default 1)
 *            { kind: "doctrine", key: "swordsman", min: 1 } // doctrine value >= min (default 1)
 *            { kind: "weaponSkill", key: "swords", min: 1 } // weapon skill value >= min
 *            { kind: "specNode", spec: "hoplite", node: "nabodnuti" } // node unlocked
 *          For an "item" trigger you must give `name` and/or `uuid`. `type` and
 *          `name` may be combined for extra safety against name collisions.
 *          Feature triggers below match on name + type on purpose: a feature
 *          dragged in from the compendium is identified reliably by its (unique,
 *          always-English) name, while `_stats.compendiumSource` depends on how
 *          the item got onto the actor.
 *
 *   grant: array of ability compendium UUIDs to add while the trigger holds.
 *
 *   replaces: optional array of ability UUIDs this grant supersedes. While the
 *          rule is active those abilities are never granted, and any copy we
 *          previously auto-granted is removed — that is how ability upgrades
 *          work (Reaver 4 turns Reckless strike into Reckless strike (Reaver)).
 *          A copy the player added by hand is left alone and only logged.
 *
 *   label: optional human-readable note (only used for console warnings).
 *
 * Several sources grant the same ability (Cleave comes from Swordsman 2, Reaver 1
 * and the Cleaver Cleave feature). Just write one rule per source — duplicates
 * collapse, and the ability survives as long as any one source still holds.
 *
 * Ability UUIDs look like:
 *   "Compendium.redsteel.redsteel-items.Item.<itemId>"
 *
 * Manual overrides (e.g. for proof-of-concept characters):
 *   - Deleting an auto-granted ability by hand permanently opts that actor out
 *     of that grant (recorded in the `suppressedGrants` flag); it will not come
 *     back on the next reconcile. Use game.redsteel.clearGrantSuppression(actor)
 *     to undo this.
 *   - Set flags.redsteel.disableAbilityGrants = true on an actor to turn the
 *     whole system off for it (existing abilities are left exactly as they are):
 *       actor.setFlag("redsteel", "disableAbilityGrants", true)
 *
 * Source of truth for the table: "Pravidla pro ToS V12.1 (WIP).xlsx", sheets
 * "Dovednosti" (doctrine + weapon skill ranks), "Odbornosti" (features),
 * "Specializace (WIP)" (spec nodes) and "Různé info" (the Bojové akce table,
 * which is what each ability was matched against — several Czech action names
 * do not translate literally to the English item names).
 */

/** Ability compendium UUID from a bare item id. */
const A = (id) => `Compendium.redsteel.redsteel-items.Item.${id}`;

/* --------------------------------------------------------------------------
 * Ability ids. Named after the compendium item, with the rules-Czech action
 * they implement in the comment where the two names do not line up.
 * ----------------------------------------------------------------------- */
const ABILITY = {
  ACCURATE_SHOT: A("buuxxJT0wA3vKJNg"), // Přesný výstřel
  ANTI_LARGE: A("yx2pLONxkiwDfWpo"), // Bonus proti velkým tvorům
  BLOOD_PACT: A("blOodPact0000001"), // Krvavý pakt
  CHARGE: A("2jCzZEc3kXL6zglG"), // Zteč — carries its own Heavy-weapon bonus dice
  CLEAVE: A("52NJ0ZhgGrHmrQ8z"), // Rozseknutí
  COMMAND_NERVE: A("cOmmandNerve0001"), // Velení: Nervy +1
  COMMAND_SPEED: A("cOmmandSpeed0001"), // Velení: Rychlost +1
  COMMAND_HIT: A("cOmmandHit000001"), // Velení: Útok +5 %
  COMMAND_DEFENSE: A("cOmmandDefense01"), // Velení: Obrana +5 %
  COMMAND_COVER: A("cOmmandCover0001"), // Velení: Krytí +10 %
  COMMAND_BRACE: A("cOmmandBrace0001"), // Velení: Výhoda na obranu
  COMMAND_STRIKE_NOW: A("cOmmandStrike001"), // Velení: Výhoda na útok
  COMMAND_FALL_BACK: A("cOmmandFallBack1"), // Velení: Odpoutání reakcí
  COMMAND_OPENING: A("cOmmandOpening01"), // Velení: Příležitostný útok reakcí
  COMMAND_MARK: A("cOmmandMark00001"), // Velení: Označení cíle
  COUNTERATTACK: A("JltGA0Wsv6ttCUT6"), // Protiútok
  CRIPPLING_SHOT: A("9WR4lbdssYQVdLoH"), // Zmrzačující výstřel
  CUNNING_STRIKE: A("cUnningStrike001"), // Vypočítavý útok
  DEFENSIVE_STANCE: A("KprSydD2eARqm2QS"), // Obranný postoj
  DISENGAGE: A("Zkket4924S0MClYW"), // Odpoutání
  DISTRACTION_DEX: A("yoaHzPcADWincgO4"), // Rozptýlení
  DISTRACTION_PER: A("gC4G0bkqy7tXghxX"), // Rozptýlení
  DOUBLE_THROW: A("dOubleThrow00001"), // Dvojitý vrh
  DUELISTS_ADVANCE: A("sbgSHiDt2hyptsxy"), // Duelistův krok
  EXPLOIT_WEAKNESS: A("VK73lWQNsMotICbn"), // Útok na slabinu
  EXPLOIT_WEAKNESS_RANGED: A("eXploitWeakRang1"), // Střelba na slabinu
  EXPLOIT_WEAKNESS_THROW: A("WjPXKjMG7790bZfX"), // Vrh na slabinu
  EXTENDED_LUNGE: A("menifXsjGJIzCUqt"), // Daleký výpad
  FEINT_DEX: A("pt6OeaIFk0cAvxla"), // Finta
  FEINT_PER: A("IVNZXVkihp5CK9JV"), // Finta
  FLAMBERGE_CLEAVE: A("LVAgDFzBKadXMU4A"), // Rozseknutí flambergem
  FLURRY: A("zosOTl8qIL3DISsr"), // Smršť útoků
  FUSCINA_ICTUS: A("fUsCinaIctus0001"), // Fuscina Ictus, trojzubec
  FLURRY_OF_THROWS: A("rWVInSjYveJyVonf"), // Vícenásobný vrh
  FRENZIED_THROW: A("RUMZLtefyxVDNA74"), // Zběsilý vrh
  GUARD_STANCE: A("n6cK9hKnV52nwOzh"), // Ochrana
  HALF_PIROUETTE: A("fF5ZDZZ8r1XSGjmP"), // Půlpirueta
  IMBROCCATA_EXPLOIT_WEAKNESS: A("q8A63eX3waqHl4KX"), // Útok na slabinu, rapír
  IMPALE: A("1xrf1lG6yXNgqXRC"), // Nabodnutí
  IMPALE_FOLLOWUP: A("FoRwhcpTYnmuCfQF"), // Nabodnutí: Navazující útok
  IMPROVED_AIMING: A("5t73FrRCJ0N6hdFe"), // Vylepšené míření
  KNOCKDOWN: A("8soGfxXTgjjWZlMq"), // Povalení
  LEG_SWEEP_DEX: A("Z4ZES1CFCCd82YMn"), // Nastrčená noha
  LEG_SWEEP_STR: A("GvpBIkl7tAxx5xrX"), // Nastrčená noha
  MAGIC_WARD: A("jb3WkQ7CKe0E3hW8"), // Magické obrnění
  OVERWATCH: A("9YQu2LgtpfCW0TWk"), // Stráž
  PASSING_STRIKE: A("HrGzgwOiif01bpDi"), // Útok s pohybem
  PERFECT_OPENING: A("6W5C7JvpFUpAbj8l"), // Rafinovaný manévr, 2 akce
  PERFECT_OPENING_HASTENED: A("hIK2uTDXUvO9TeuV"), // Rafinovaný manévr, 1 akce
  PIKEMAN_CHARGE: A("cghhodlLxiU69WLO"), // Zteč: Průbojnost +5 — also carries Heavy dice
  POLEARM_CLEAVE: A("PPV4asgA1ESKgD26"), // Daleké rozseknutí
  RECKLESS_STRIKE: A("CKSRdqAvrm7SOqCs"), // Zběsilý útok
  RECKLESS_STRIKE_REAVER: A("0YDsI6HYQ31hAWHp"), // Zběsilý útok, Plenitel
  REST: A("r0zKDZ0Zs2bMiUAu"), // Odpočinek
  RETALIATORY_STRIKE: A("qaPermZFuHuTg5ni"), // Odvetný úder
  RIPOSTE: A("WX6uJeqZAqeyykJa"), // Riposta
  RUNNING_THROW: A("wNvzvMB5p69CON5c"), // Vrh s rozběhem
  SHIELD_BASH: A("6Q935yGVq7NpUIbE"), // Úder štítem
  SHIELD_BASH_SMALL: A("8lz1hQM7U6yFtmY4"), // Úder štítem, malý štít
  SHIELD_CHARGE: A("rkM1ONas7GM6M97p"), // Zteč štítem
  SHIELD_CHARGE_SMALL: A("lL6kkZUPwQem7PJX"), // Zteč štítem, malý štít
  SHIELDBEARER_DEFENSIVE_STANCE: A("Z5uFEQqLBQXvsjDq"), // Obranný postoj: Ignoruje Průraznost
  SHOVE_DEX: A("eM1CMfrwZeMl1X8O"), // Odstrčení
  SHOVE_STR: A("quN6stREoJF84H84"), // Odstrčení
  SPLINTERING_STRIKE: A("HxHXxA3Mq03dD7ku"), // Rozštěpení
  SPRINT: A("Xc0SM3CwS9pnT5rY"), // Sprint
  STAGGERING_BLOW: A("DFnAqroELNHfbweO"), // Omračující úder
  TRIP_DEX: A("kkHN2VhkuN0wIePo"), // Podseknutí
  TRIP_STR: A("lceDlymn87I1aDNX"), // Podseknutí
};

/* Shorthand trigger builders — the table is long enough without the noise. */
const always = () => ({ kind: "always" });
const skill = (key, min) => ({ kind: "skill", key, min });
const doctrine = (key, min) => ({ kind: "doctrine", key, min });
const weaponSkill = (key, min) => ({ kind: "weaponSkill", key, min });
const specNode = (spec, node) => ({ kind: "specNode", spec, node });
const feature = (name) => ({ kind: "item", name, type: "feature" });

/** Every weapon skill grants the same actions at ranks 1-3. */
const WEAPON_SKILLS = ["swords", "axes", "blunt", "polearms"];

/**
 * @type {Array<{label?: string, when: object, grant: string[], replaces?: string[]}>}
 */
export const ABILITY_GRANTS = [
  /* ======================================================================
   * Baseline — every Character and NPC has these, no trigger required.
   * These used to be copied by a separate createActor hook in redsteel.mjs.
   * They live here instead so one mechanism owns baseline abilities: it
   * dedupes against copies the actor already has, respects a manual delete,
   * and — the reason it matters for Defensive Stance — lets Shieldbearer 6
   * actually replace the base stance with its upgrade.
   * ==================================================================== */
  {
    label: "Baseline actions every character has",
    when: always(),
    grant: [
      ABILITY.DISENGAGE,
      ABILITY.SPRINT,
      ABILITY.REST,
      ABILITY.DEFENSIVE_STANCE,
    ],
  },

  /* ======================================================================
   * Weapon skills — Meče / Sekery / Tupé / Dřevcové
   * Ranks 1-3 are identical across all four; rank 6 is the skill's own action.
   * ==================================================================== */
  ...WEAPON_SKILLS.flatMap((key) => [
    {
      label: `${key} 1 → Charge`,
      when: weaponSkill(key, 1),
      grant: [ABILITY.CHARGE],
    },
    {
      label: `${key} 2 → Reckless strike`,
      when: weaponSkill(key, 2),
      grant: [ABILITY.RECKLESS_STRIKE],
    },
    {
      label: `${key} 3 → Exploit Weakness`,
      when: weaponSkill(key, 3),
      grant: [ABILITY.EXPLOIT_WEAKNESS],
    },
  ]),
  {
    label: "Swords 6 → Feint",
    when: weaponSkill("swords", 6),
    grant: [ABILITY.FEINT_DEX, ABILITY.FEINT_PER],
  },
  {
    label: "Axes 6 → Splintering strike",
    when: weaponSkill("axes", 6),
    grant: [ABILITY.SPLINTERING_STRIKE],
  },
  {
    label: "Blunt 6 → Staggering blow",
    when: weaponSkill("blunt", 6),
    grant: [ABILITY.STAGGERING_BLOW],
  },
  {
    label: "Polearms 6 → Trip",
    when: weaponSkill("polearms", 6),
    grant: [ABILITY.TRIP_STR, ABILITY.TRIP_DEX],
  },

  /* ======================================================================
   * Pikenýr (pikeman)
   * ==================================================================== */
  {
    label: "Pikeman 1 → Impale",
    when: doctrine("pikeman", 1),
    grant: [ABILITY.IMPALE],
  },
  {
    label: "Pikeman 2 → Anti-Large, Impale: Follow-up Attack",
    when: doctrine("pikeman", 2),
    grant: [ABILITY.ANTI_LARGE, ABILITY.IMPALE_FOLLOWUP],
  },
  {
    label: "Pikeman 4 → Polearm Cleave",
    when: doctrine("pikeman", 4),
    grant: [ABILITY.POLEARM_CLEAVE],
  },
  {
    label: "Pikeman 5 → Shove; Charge upgrades to Pikeman charge",
    when: doctrine("pikeman", 5),
    grant: [
      ABILITY.SHOVE_STR,
      ABILITY.SHOVE_DEX,
      ABILITY.PIKEMAN_CHARGE,
    ],
    replaces: [ABILITY.CHARGE],
  },

  /* ======================================================================
   * Šermíř (swordsman)
   * ==================================================================== */
  {
    label: "Swordsman 1 → Extended Lunge",
    when: doctrine("swordsman", 1),
    grant: [ABILITY.EXTENDED_LUNGE],
  },
  {
    label: "Swordsman 2 → Cleave",
    when: doctrine("swordsman", 2),
    grant: [ABILITY.CLEAVE],
  },
  {
    label: "Swordsman 4 → Half Pirouette",
    when: doctrine("swordsman", 4),
    grant: [ABILITY.HALF_PIROUETTE],
  },
  {
    label: "Swordsman 5 → Counterattack",
    when: doctrine("swordsman", 5),
    grant: [ABILITY.COUNTERATTACK],
  },
  {
    label: "Swordsman 6 → Flurry",
    when: doctrine("swordsman", 6),
    grant: [ABILITY.FLURRY],
  },
  {
    label: "Swordsman 10 → Riposte",
    when: doctrine("swordsman", 10),
    grant: [ABILITY.RIPOSTE],
  },

  /* ======================================================================
   * Plenitel (reaver)
   * ==================================================================== */
  {
    label: "Reaver 1 → Cleave",
    when: doctrine("reaver", 1),
    grant: [ABILITY.CLEAVE],
  },
  {
    label: "Reaver 3 → Extended Lunge",
    when: doctrine("reaver", 3),
    grant: [ABILITY.EXTENDED_LUNGE],
  },
  {
    label: "Reaver 4 → Reckless strike upgrades to Reckless strike (Reaver)",
    when: doctrine("reaver", 4),
    grant: [ABILITY.RECKLESS_STRIKE_REAVER],
    replaces: [ABILITY.RECKLESS_STRIKE],
  },
  {
    label: "Reaver 5 → Knockdown",
    when: doctrine("reaver", 5),
    grant: [ABILITY.KNOCKDOWN],
  },

  /* ======================================================================
   * Štítonoš (shieldbearer)
   * ==================================================================== */
  {
    label: "Shieldbearer 1 → Shield Bash",
    when: doctrine("shieldbearer", 1),
    grant: [ABILITY.SHIELD_BASH, ABILITY.SHIELD_BASH_SMALL],
  },
  {
    label: "Shieldbearer 2 → Guard (Stance)",
    when: doctrine("shieldbearer", 2),
    grant: [ABILITY.GUARD_STANCE],
  },
  {
    label: "Shieldbearer 4 → Counterattack",
    when: doctrine("shieldbearer", 4),
    grant: [ABILITY.COUNTERATTACK],
  },
  {
    label: "Shieldbearer 5 → Shield Charge",
    when: doctrine("shieldbearer", 5),
    grant: [ABILITY.SHIELD_CHARGE, ABILITY.SHIELD_CHARGE_SMALL],
  },
  {
    label: "Shieldbearer 6 → Defensive Stance upgrades (ignores Breakthrough)",
    when: doctrine("shieldbearer", 6),
    grant: [ABILITY.SHIELDBEARER_DEFENSIVE_STANCE],
    replaces: [ABILITY.DEFENSIVE_STANCE],
  },

  /* ======================================================================
   * Dimakerus
   * ==================================================================== */
  {
    label: "Dimakerus 2 → Flurry",
    when: doctrine("dimakerus", 2),
    grant: [ABILITY.FLURRY],
  },
  {
    label: "Dimakerus 3 → Retaliatory strike",
    when: doctrine("dimakerus", 3),
    grant: [ABILITY.RETALIATORY_STRIKE],
  },
  {
    label: "Dimakerus 6 → Counterattack, Half Pirouette",
    when: doctrine("dimakerus", 6),
    grant: [ABILITY.COUNTERATTACK, ABILITY.HALF_PIROUETTE],
  },
  {
    label: "Dimakerus 9 → Passing Strike",
    when: doctrine("dimakerus", 9),
    grant: [ABILITY.PASSING_STRIKE],
  },

  /* ======================================================================
   * Duelista (duelist)
   * ==================================================================== */
  {
    label: "Duelist 1 → Improved Aiming",
    when: doctrine("duelist", 1),
    grant: [ABILITY.IMPROVED_AIMING],
  },
  {
    label: "Duelist 3 → Duelist's Advance",
    when: doctrine("duelist", 3),
    grant: [ABILITY.DUELISTS_ADVANCE],
  },
  {
    label: "Duelist 5 → Passing Strike",
    when: doctrine("duelist", 5),
    grant: [ABILITY.PASSING_STRIKE],
  },
  {
    label: "Duelist 6 → Perfect Opening (both action costs)",
    when: doctrine("duelist", 6),
    grant: [ABILITY.PERFECT_OPENING, ABILITY.PERFECT_OPENING_HASTENED],
  },
  {
    label: "Duelist 8 → Counterattack",
    when: doctrine("duelist", 8),
    grant: [ABILITY.COUNTERATTACK],
  },
  {
    label: "Duelist 9 → Half Pirouette",
    when: doctrine("duelist", 9),
    grant: [ABILITY.HALF_PIROUETTE],
  },

  /* ======================================================================
   * Mnich (monk)
   * ==================================================================== */
  {
    label: "Monk 2 → Feint",
    when: doctrine("monk", 2),
    grant: [ABILITY.FEINT_DEX, ABILITY.FEINT_PER],
  },
  {
    label: "Monk 3 → Flurry",
    when: doctrine("monk", 3),
    grant: [ABILITY.FLURRY],
  },
  {
    label: "Monk 4 → Staggering blow",
    when: doctrine("monk", 4),
    grant: [ABILITY.STAGGERING_BLOW],
  },
  {
    label: "Monk 5 → Counterattack",
    when: doctrine("monk", 5),
    grant: [ABILITY.COUNTERATTACK],
  },
  {
    label: "Monk 8 → Passing Strike",
    when: doctrine("monk", 8),
    grant: [ABILITY.PASSING_STRIKE],
  },
  {
    label: "Monk 9 → Half Pirouette",
    when: doctrine("monk", 9),
    grant: [ABILITY.HALF_PIROUETTE],
  },

  /* ======================================================================
   * Tulák (rogue)
   * Rank 1 only raises Sneak Attack damage — Sneak Attack itself is a base
   * action every character has, so there is nothing to grant there.
   * ==================================================================== */
  {
    label: "Rogue 4 → Distraction",
    when: doctrine("rogue", 4),
    grant: [ABILITY.DISTRACTION_DEX, ABILITY.DISTRACTION_PER],
  },
  {
    label: "Rogue 10 → Cunning Strike",
    when: doctrine("rogue", 10),
    grant: [ABILITY.CUNNING_STRIKE],
  },

  /* ======================================================================
   * Lukostřelec (archer)
   * ==================================================================== */
  {
    label: "Archer 2 → Crippling Shot",
    when: doctrine("archer", 2),
    grant: [ABILITY.CRIPPLING_SHOT],
  },
  {
    label: "Archer 3 → Exploit Weakness (Ranged)",
    when: doctrine("archer", 3),
    grant: [ABILITY.EXPLOIT_WEAKNESS_RANGED],
  },
  {
    label: "Archer 5 → Accurate Shot",
    when: doctrine("archer", 5),
    grant: [ABILITY.ACCURATE_SHOT],
  },
  {
    label: "Archer 7 → Overwatch",
    when: doctrine("archer", 7),
    grant: [ABILITY.OVERWATCH],
  },

  /* ======================================================================
   * Kušník (arbalest)
   * ==================================================================== */
  {
    label: "Arbalest 2 → Exploit Weakness (Ranged)",
    when: doctrine("arbalest", 2),
    grant: [ABILITY.EXPLOIT_WEAKNESS_RANGED],
  },
  {
    label: "Arbalest 3 → Crippling Shot",
    when: doctrine("arbalest", 3),
    grant: [ABILITY.CRIPPLING_SHOT],
  },
  {
    label: "Arbalest 4 → Overwatch",
    when: doctrine("arbalest", 4),
    grant: [ABILITY.OVERWATCH],
  },
  {
    label: "Arbalest 7 → Accurate Shot",
    when: doctrine("arbalest", 7),
    grant: [ABILITY.ACCURATE_SHOT],
  },

  /* ======================================================================
   * Peltast
   * ==================================================================== */
  {
    label: "Peltast 2 → Running Throw",
    when: doctrine("peltast", 2),
    grant: [ABILITY.RUNNING_THROW],
  },
  {
    label: "Peltast 3 → Exploit Weakness",
    when: doctrine("peltast", 3),
    grant: [ABILITY.EXPLOIT_WEAKNESS],
  },
  {
    label: "Peltast 4 → Frenzied Throw",
    when: doctrine("peltast", 4),
    grant: [ABILITY.FRENZIED_THROW],
  },
  {
    label: "Peltast 5 → Crippling Shot",
    when: doctrine("peltast", 5),
    grant: [ABILITY.CRIPPLING_SHOT],
  },
  {
    label: "Peltast 7 → Accurate Shot",
    when: doctrine("peltast", 7),
    grant: [ABILITY.ACCURATE_SHOT],
  },
  {
    label: "Peltast 8 → Overwatch",
    when: doctrine("peltast", 8),
    grant: [ABILITY.OVERWATCH],
  },
  {
    label: "Peltast 10 → Double Throw",
    when: doctrine("peltast", 10),
    grant: [ABILITY.DOUBLE_THROW],
  },

  /* ======================================================================
   * Kejklíř (juggler)
   * ==================================================================== */
  {
    label: "Juggler 3 → Exploit Weakness, Exploit Weakness (Throw)",
    when: doctrine("juggler", 3),
    grant: [ABILITY.EXPLOIT_WEAKNESS, ABILITY.EXPLOIT_WEAKNESS_THROW],
  },
  {
    label: "Juggler 5 → Overwatch",
    when: doctrine("juggler", 5),
    grant: [ABILITY.OVERWATCH],
  },
  {
    label: "Juggler 7 → Crippling Shot",
    when: doctrine("juggler", 7),
    grant: [ABILITY.CRIPPLING_SHOT],
  },
  {
    label: "Juggler 9 → Flurry of Throws",
    when: doctrine("juggler", 9),
    grant: [ABILITY.FLURRY_OF_THROWS],
  },

  /* ======================================================================
   * Mušketýr (musketeer)
   * ==================================================================== */
  {
    label: "Musketeer 2 → Extended Lunge",
    when: doctrine("musketeer", 2),
    grant: [ABILITY.EXTENDED_LUNGE],
  },
  {
    label: "Musketeer 4 → Overwatch",
    when: doctrine("musketeer", 4),
    grant: [ABILITY.OVERWATCH],
  },
  {
    label: "Musketeer 6 → Staggering blow",
    when: doctrine("musketeer", 6),
    grant: [ABILITY.STAGGERING_BLOW],
  },
  {
    label: "Musketeer 8 → Shove",
    when: doctrine("musketeer", 8),
    grant: [ABILITY.SHOVE_STR, ABILITY.SHOVE_DEX],
  },

  /* ======================================================================
   * Magic doctrines — Magické obrnění / Magic Ward
   * ==================================================================== */
  {
    label: "Elymas 2 → Magic Ward",
    when: doctrine("elymas", 2),
    grant: [ABILITY.MAGIC_WARD],
  },
  {
    label: "Incantator 2 → Magic Ward",
    when: doctrine("incantator", 2),
    grant: [ABILITY.MAGIC_WARD],
  },
  {
    label: "Elementalist 3 → Magic Ward",
    when: doctrine("elementalist", 3),
    grant: [ABILITY.MAGIC_WARD],
  },
  {
    label: "Veneficus 6 → Magic Ward",
    when: doctrine("veneficus", 6),
    grant: [ABILITY.MAGIC_WARD],
  },

  /* ======================================================================
   * Odbornosti (features)
   * Weapon-restricted feats grant unconditionally; the ability's own text
   * names the weapon it requires.
   * ==================================================================== */
  {
    label: "Swift Retaliation (Rychlá odveta) → Retaliatory strike",
    when: feature("Swift Retaliation"),
    grant: [ABILITY.RETALIATORY_STRIKE],
  },
  {
    label: "Cleaver Cleave (Rozseknutí sekáčkem) → Cleave",
    when: feature("Cleaver Cleave"),
    grant: [ABILITY.CLEAVE],
  },
  {
    label: "Polearm master (Dřevcový mistr) → Feint, Splintering strike, Staggering blow",
    when: feature("Polearm master"),
    grant: [
      ABILITY.FEINT_DEX,
      ABILITY.FEINT_PER,
      ABILITY.SPLINTERING_STRIKE,
      ABILITY.STAGGERING_BLOW,
    ],
  },
  {
    label: "Leg Sweep (Nastrčená noha) → Leg Sweep",
    when: feature("Leg Sweep"),
    grant: [ABILITY.LEG_SWEEP_STR, ABILITY.LEG_SWEEP_DEX],
  },
  {
    label: "Flamberge Cleave → Cleave upgrades to Flamberge Cleave",
    when: feature("Flamberge Cleave"),
    grant: [ABILITY.FLAMBERGE_CLEAVE],
    replaces: [ABILITY.CLEAVE],
  },
  {
    // Additive, not a replacement: Imbroccata only works with a rapier in hand
    // (system.requiredWeaponTag), so the fencer still needs the ordinary
    // Exploit Weakness for every other weapon.
    label: "Imbroccata → Imbroccata: Exploit Weakness (rapier only)",
    when: feature("Imbroccata"),
    grant: [ABILITY.IMBROCCATA_EXPLOIT_WEAKNESS],
  },
  {
    label: "Fuscina Ictus → Fuscina Ictus (trident-only attack modifier)",
    when: feature("Fuscina Ictus"),
    grant: [ABILITY.FUSCINA_ICTUS],
  },

  /* ======================================================================
   * Specializace (specialisation nodes)
   * Only nodes that unlock a whole action are listed. Nodes that merely tune
   * an action ("Riposta: Výdrž -4", "Ochrana jako Volná akce") are not grants.
   * ==================================================================== */
  {
    label: "Servant of the Sword: Odvetný úder → Retaliatory strike",
    when: specNode("swordServant", "odvetnyUder"),
    grant: [ABILITY.RETALIATORY_STRIKE],
  },
  {
    label: "Servant of the Sword: Vylepšené míření → Improved Aiming",
    when: specNode("swordServant", "improvedAim"),
    grant: [ABILITY.IMPROVED_AIMING],
  },
  {
    label: "Servant of the Sword: Útok s pohybem → Passing Strike",
    when: specNode("swordServant", "utokSPohybem"),
    grant: [ABILITY.PASSING_STRIKE],
  },
  {
    label: "Hoplite: Nabodnutí → Impale",
    when: specNode("hoplite", "nabodnuti"),
    grant: [ABILITY.IMPALE],
  },
  {
    label: "Hoplite: Bonus proti velkým tvorům → Anti-Large, Impale: Follow-up",
    when: specNode("hoplite", "velkeTvory"),
    grant: [ABILITY.ANTI_LARGE, ABILITY.IMPALE_FOLLOWUP],
  },
  {
    label: "Champion: Odvetný úder → Retaliatory strike",
    when: specNode("champion", "odvetnyUder"),
    grant: [ABILITY.RETALIATORY_STRIKE],
  },
  {
    label: "Champion: Riposta → Riposte",
    when: specNode("champion", "riposta"),
    grant: [ABILITY.RIPOSTE],
  },
  {
    label: "Skirmisher: Útok s pohybem → Passing Strike",
    when: specNode("skirmisher", "utokSPohybem"),
    grant: [ABILITY.PASSING_STRIKE],
  },
  {
    label: "School of Blood: Krvavý pakt → Blood Pact",
    when: specNode("bloodSchool", "krvavyPakt"),
    grant: [ABILITY.BLOOD_PACT],
  },

  /* ======================================================================
   * Velení (Leadership) — the Commands
   * The Leadership skill is the only trigger: every rank unlocks the next
   * Command, and a commander keeps every Command they have already earned.
   * Ranks 1-5 are the Passive Commands (the aura the commander sustains),
   * ranks 6-10 the Active ones (a single order shouted at one ally).
   * ==================================================================== */
  ...[
    [1, ABILITY.COMMAND_NERVE],
    [2, ABILITY.COMMAND_SPEED],
    [3, ABILITY.COMMAND_HIT],
    [4, ABILITY.COMMAND_DEFENSE],
    [5, ABILITY.COMMAND_COVER],
    [6, ABILITY.COMMAND_BRACE],
    [7, ABILITY.COMMAND_STRIKE_NOW],
    [8, ABILITY.COMMAND_FALL_BACK],
    [9, ABILITY.COMMAND_OPENING],
    [10, ABILITY.COMMAND_MARK],
  ].map(([rank, id]) => ({
    label: `Leadership ${rank} → Command`,
    when: skill("leadership", rank),
    grant: [id],
  })),
];

const GRANT_FLAG_SCOPE = "redsteel";
const GRANTED_FLAG = "grantedAbility"; // boolean: this item was auto-granted
const GRANT_SOURCE_FLAG = "grantSource"; // string: the compendium UUID it came from

// Actor-level flags:
//   suppressedGrants     string[]  grant UUIDs the player manually removed; never re-add
//   disableAbilityGrants boolean   skip the whole grant system for this actor (PoC chars)
const SUPPRESSED_FLAG = "suppressedGrants";
const DISABLE_FLAG = "disableAbilityGrants";

const GRANTABLE_ACTOR_TYPES = new Set(["character", "npc"]);

// Re-entrancy guard: syncing creates/deletes embedded items, which fire the very
// hooks that call this; skip overlapping runs for the same actor.
const _syncing = new Set();

/**
 * Does the actor currently satisfy a rule's trigger?
 * Exported because opportunityAttacks.mjs reuses this trigger evaluator for its
 * own permission table.
 * @param {Actor} actor
 * @param {object} rule
 * @returns {boolean}
 */
export function ruleActive(actor, rule) {
  const w = rule?.when;
  if (!w) return false;

  if (w.kind === "always") return true;

  if (w.kind === "skill") {
    const skill = actor.system?.skills?.[w.key];
    if (!skill) return false;
    return Number(skill.value ?? 0) >= Number(w.min ?? 1);
  }

  if (w.kind === "doctrine") {
    const doc = actor.system?.doctrines?.[w.key];
    if (!doc) return false;
    return Number(doc.value ?? 0) >= Number(w.min ?? 1);
  }

  if (w.kind === "weaponSkill") {
    const ws = actor.system?.weaponSkills?.[w.key];
    if (!ws) return false;
    return Number(ws.value ?? 0) >= Number(w.min ?? 1);
  }

  if (w.kind === "specNode") {
    const spec = actor.system?.specialisations?.[w.spec];
    return !!(spec?.active && spec.nodes?.[w.node]);
  }

  if (w.kind === "item") {
    if (!w.uuid && !w.name) return false; // need at least one identifier
    return actor.items.some(
      (i) =>
        (w.uuid ? i._stats?.compendiumSource === w.uuid : true) &&
        (w.name ? i.name === w.name : true) &&
        (w.type ? i.type === w.type : true),
    );
  }

  return false;
}

/**
 * Reconcile an actor's auto-granted abilities against ABILITY_GRANTS.
 * Adds abilities whose trigger is now satisfied, removes previously-granted
 * abilities whose trigger no longer holds, and removes granted abilities that
 * an active upgrade supersedes. Manually-added items are untouched.
 * @param {Actor} actor
 */
export async function syncGrantedAbilities(actor) {
  if (!actor?.id || !GRANTABLE_ACTOR_TYPES.has(actor.type)) return;
  if (_syncing.has(actor.id)) return;
  // Fully hand-curated actor: never touch its abilities.
  if (actor.getFlag(GRANT_FLAG_SCOPE, DISABLE_FLAG)) return;

  _syncing.add(actor.id);
  try {
    // Grants the player has manually opted out of — never re-add these.
    const suppressed = new Set(
      actor.getFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG) ?? [],
    );

    // Every ability UUID that should currently be granted, and every ability
    // an active upgrade supersedes.
    const desired = new Set();
    const replaced = new Set();
    for (const rule of ABILITY_GRANTS) {
      if (!ruleActive(actor, rule)) continue;
      for (const uuid of rule.grant ?? []) {
        if (!suppressed.has(uuid)) desired.add(uuid);
      }
      for (const uuid of rule.replaces ?? []) replaced.add(uuid);
    }
    // An upgrade wins over its base even when another source still grants it.
    for (const uuid of replaced) desired.delete(uuid);

    // Abilities we previously auto-granted, keyed by their source UUID.
    const granted = actor.items.filter((i) =>
      i.getFlag(GRANT_FLAG_SCOPE, GRANTED_FLAG),
    );
    const grantedByUuid = new Map(
      granted.map((i) => [i.getFlag(GRANT_FLAG_SCOPE, GRANT_SOURCE_FLAG), i]),
    );

    // Anything the actor already owns (manually, by default, or granted) so we
    // never create a duplicate of an ability that's already present.
    const ownedSources = new Set(
      actor.items.map((i) => i._stats?.compendiumSource).filter(Boolean),
    );

    // A hand-added base ability is the player's to keep — say so rather than
    // silently leaving a superseded ability on the sheet.
    for (const uuid of replaced) {
      if (grantedByUuid.has(uuid)) continue;
      if (ownedSources.has(uuid)) {
        console.warn(
          `Redsteel | ${actor.name} owns a manual copy of a superseded ability (${uuid}); leaving it in place.`,
        );
      }
    }

    // Remove granted abilities whose trigger is gone or that an upgrade replaced.
    const toDelete = granted
      .filter((i) => !desired.has(i.getFlag(GRANT_FLAG_SCOPE, GRANT_SOURCE_FLAG)))
      .map((i) => i.id);

    // Add newly-satisfied grants we don't already have.
    const toAdd = [];
    for (const uuid of desired) {
      if (grantedByUuid.has(uuid) || ownedSources.has(uuid)) continue;
      const source = await fromUuid(uuid);
      if (!source) {
        console.warn(`Redsteel | granted ability not found: ${uuid}`);
        continue;
      }
      const data = source.toObject();
      delete data._id;
      data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
      foundry.utils.setProperty(data, `flags.${GRANT_FLAG_SCOPE}.${GRANTED_FLAG}`, true);
      foundry.utils.setProperty(
        data,
        `flags.${GRANT_FLAG_SCOPE}.${GRANT_SOURCE_FLAG}`,
        uuid,
      );
      toAdd.push(data);
    }

    if (toDelete.length)
      await actor.deleteEmbeddedDocuments("Item", toDelete);
    if (toAdd.length) await actor.createEmbeddedDocuments("Item", toAdd);
  } finally {
    _syncing.delete(actor.id);
  }
}

/**
 * Re-read every auto-granted ability from its compendium source and write the
 * current stats back onto the actor's copy.
 *
 * A grant is a snapshot: syncGrantedAbilities only ever adds or removes items,
 * so an ability edited in the pack after it was handed out keeps its old
 * numbers on every sheet that already had it (Shield Bash sat at penetration 0
 * for exactly this reason). Deleting the stale copy is not the fix — the
 * deleteItem hook reads a manual delete as an opt-out and suppresses the grant
 * for good.
 *
 * Every `system` field the pack entry defines is written back, so hand-tuning
 * of a granted ability on the sheet is intentionally overwritten. This is a
 * merge, so a field the pack entry no longer defines keeps its old value —
 * fine for refreshing numbers, which is all this is for. Flags, ownership and
 * the item id are left alone, so the grant bookkeeping survives.
 *
 * @param {Actor} actor
 * @returns {Promise<number>} How many abilities were refreshed.
 */
export async function resyncGrantedAbilities(actor) {
  if (!actor?.items) return 0;

  const updates = [];
  // `.contents` — iterating a Collection directly is the bug that keeps
  // costing us silent empty loops.
  for (const item of actor.items.contents) {
    if (!item.getFlag(GRANT_FLAG_SCOPE, GRANTED_FLAG)) continue;
    const uuid = item.getFlag(GRANT_FLAG_SCOPE, GRANT_SOURCE_FLAG);
    if (!uuid) continue;

    const source = await fromUuid(uuid);
    if (!source) {
      console.warn(
        `Redsteel | resync: source missing for "${item.name}" (${uuid})`,
      );
      continue;
    }

    const data = source.toObject();
    updates.push({
      _id: item.id,
      name: data.name,
      img: data.img,
      system: data.system,
    });
  }

  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return updates.length;
}

/**
 * Clear an actor's manual opt-outs so qualifying grants apply again, then
 * reconcile. Pass a specific grant UUID to un-suppress just that one.
 * @param {Actor} actor
 * @param {string} [uuid] grant UUID to re-enable; omit to clear all opt-outs
 */
export async function clearGrantSuppression(actor, uuid) {
  if (!actor?.id) return;
  const current = actor.getFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG) ?? [];
  const next = uuid ? current.filter((u) => u !== uuid) : [];
  await actor.setFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG, next);
  await syncGrantedAbilities(actor);
}

/**
 * Register the hooks that keep granted abilities in sync. Call once at init/ready.
 */
export function registerAbilityGrants() {
  // New actor: evaluate all grants.
  Hooks.on("createActor", (actor, options, userId) => {
    if (game.user.id !== userId) return;
    syncGrantedAbilities(actor);
  });

  // Owning a new item may satisfy a trigger. Ignore our own granted abilities
  // (their creation during reconcile would otherwise loop).
  Hooks.on("createItem", (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.getFlag?.(GRANT_FLAG_SCOPE, GRANTED_FLAG)) return;
    if (item.parent?.documentName === "Actor") syncGrantedAbilities(item.parent);
  });

  // Removing an item may break a trigger — reconcile. But if the removed item is
  // an auto-granted ability that the *player* deleted (not our own reconcile),
  // record it as suppressed so it is never re-granted.
  Hooks.on("deleteItem", async (item, options, userId) => {
    if (game.user.id !== userId) return;
    const parent = item.parent;
    if (parent?.documentName !== "Actor") return;

    if (item.getFlag?.(GRANT_FLAG_SCOPE, GRANTED_FLAG)) {
      // Our own reconcile removed it (trigger gone) — nothing to remember.
      if (_syncing.has(parent.id)) return;
      // Manual removal: opt this grant out permanently for this actor.
      const src = item.getFlag(GRANT_FLAG_SCOPE, GRANT_SOURCE_FLAG);
      if (src) {
        const current = parent.getFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG) ?? [];
        if (!current.includes(src)) {
          await parent.setFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG, [
            ...current,
            src,
          ]);
        }
      }
      return; // the manual removal stands
    }

    // A non-granted (trigger) item was removed.
    syncGrantedAbilities(parent);
  });

  // Skill / weapon skill / doctrine values changing can cross a threshold, and
  // unlocking a specialisation node can satisfy a specNode trigger.
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (
      changes.system?.skills ||
      changes.system?.doctrines ||
      changes.system?.weaponSkills ||
      changes.system?.specialisations
    )
      syncGrantedAbilities(actor);
  });
}
