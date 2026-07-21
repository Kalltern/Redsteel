import { REDSTEEL } from "./config.mjs";
import { GENERATED_SPECS } from "./specialisations-generated.mjs";

/* ===========================================================================
 * Specialisation talent-tree definitions
 *
 * Source: "Pravidla pro ToS V12.1 (WIP).xlsx" → sheet "Specializace (WIP)".
 * The sheet's horizontal chains become vertical columns here: each chain is
 * one column, nodes in order top→bottom, every node requiring the previous
 * one. Unchained nodes are scattered into free columns, placed deeper the
 * higher their rank requirement is. Finisher bonuses are not implemented.
 *
 * Node format:
 *  tier     – row in the tree, 1 = top
 *  column   – column in the tree (may be fractional for centering)
 *  requires – ids of nodes that must ALL be unlocked before this one;
 *             every entry is also drawn as a connecting line
 *  icon     – optional image path for future node graphics ("" for now)
 *  passive  – null for manual ("shine up only") nodes, or:
 *               changes         – ActiveEffect changes ({key, mode, value}),
 *                                 applied as a permanent ActiveEffect
 *               combatModifiers – a combat-modifier group written to
 *                                 system.activeCombatEffects (same format the
 *                                 effect definitions in config.mjs use:
 *                                 damageBonus, damageRoll, penetrationBonus,
 *                                 extraEffects {bleed/stun/precision: %}, …)
 *             Both are created on unlock and removed on lock by
 *             syncSpecialisationPassive.
 *
 * Label/description localization keys are injected automatically from the
 * spec id and node id (REDSTEEL.Actor.Specialisations.<spec>.nodes.<node>).
 * ======================================================================== */

/** ActiveEffect ADD change. */
const add = (key, value) => ({
  key,
  mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
  value,
});

/** Passive backed by ActiveEffect changes. */
const ae = (...changes) => ({ changes });

/** Passive backed by a combat-modifier group (system.activeCombatEffects). */
const cm = (combatModifiers) => ({ combatModifiers });

/**
 * S3 — crit-degree effect triggers. When a caster owns one of these nodes and
 * their spell scores a critical of degree ≥ minDegree, the named status is
 * added to the attack card's mechanical effects:
 *   mode "boost" — the spell must already cast `effect`; its chance gets +100
 *                  (a rolled effect becomes guaranteed on a large enough crit).
 *   mode "force" — the effect is injected at a guaranteed chance even when the
 *                  spell did not carry it (e.g. geomancer knockdown).
 * The four node ids are globally unique today, but we key by spec for safety.
 * Consumed in utils/magicSkillBonuses.mjs (spell crit path).
 */
export const CRIT_DEGREE_TRIGGERS = [
  { spec: "astramancer", node: "omraceniKrit", effect: "stun", minDegree: 2, mode: "boost" },
  { spec: "cryomancer", node: "zmrazeniKrit", effect: "freeze", minDegree: 4, mode: "boost" },
  { spec: "pyromancer", node: "podpaleniKrit", effect: "burn", minDegree: 3, mode: "boost" },
  { spec: "geomancer", node: "povaleni", effect: "prone", minDegree: 3, mode: "force" },
];

/** True if the actor has `specId`'s tree active AND `nodeId` unlocked. */
export function actorHasSpecNode(actor, specId, nodeId) {
  const spec = actor.system?.specialisations?.[specId];
  return !!(spec?.active && spec.nodes?.[nodeId]);
}

/** The subset of CRIT_DEGREE_TRIGGERS the actor actually owns. */
export function getCritDegreeTriggers(actor) {
  return CRIT_DEGREE_TRIGGERS.filter((t) =>
    actorHasSpecNode(actor, t.spec, t.node),
  );
}

const SPEC_DEFS = {
  /* ----------------------------------------------------------------- */
  /* Stín (Shadow)                                                     */
  /* ----------------------------------------------------------------- */
  shadow: {
    // Constellation layout (prototype): nodes carry x/y as PERCENTAGES of the
    // canvas (0–100), so the figure stretches to fill whatever space the panel
    // gives it; the `requires` chains become the connecting lines. tier/column
    // are kept only as a grid fallback.
    layout: "constellation",
    nodes: {
      // Chain: sneak attack mastery (the central spine)
      sneakAttack: {
        tier: 1,
        column: 1,
        x: 16,
        y: 20,
        passive: {
          ...ae(add("system.sneakDamageBonus", 1)),
          ...cm({ critRangeBonus: 3 }),
        },
      },
      critAsSneak: { tier: 2, column: 1, x: 30, y: 33, requires: ["sneakAttack"] },
      outnumberSneak: { tier: 3, column: 1, x: 43, y: 19, requires: ["critAsSneak"] },
      // Chain: bleeding (left descending arm)
      bleed1: { tier: 1, column: 2, x: 13, y: 45, passive: cm({ extraEffects: { bleed: 10 } }) },
      bleed2: {
        tier: 2,
        column: 2,
        x: 25,
        y: 59,
        requires: ["bleed1"],
        passive: cm({ extraEffects: { bleed: 10 } }),
      },
      bleed3: {
        tier: 3,
        column: 2,
        x: 37,
        y: 72,
        requires: ["bleed2"],
        passive: cm({ extraEffects: { bleed: 10 } }),
      },
      // Chain: calculation (upper-right arm)
      calculation: { tier: 1, column: 3, x: 62, y: 25 },
      aimedAttack: { tier: 2, column: 3, x: 77, y: 17, requires: ["calculation"] },
      // Chain: stealth (center-right)
      stealthAdvantage: {
        tier: 1,
        column: 4,
        x: 57,
        y: 50,
        passive: ae(add("system.rollAdvantage.stealth", 1)),
      },
      stealthCritFail: {
        tier: 2,
        column: 4,
        x: 71,
        y: 46,
        requires: ["stealthAdvantage"],
        passive: ae(add("system.skills.stealth.critfailpenalty", -3)),
      },
      // Chain: banes (lower-right arm)
      bane1: { tier: 1, column: 5, x: 61, y: 73, bane: 1 },
      bane2: { tier: 2, column: 5, x: 74, y: 67, requires: ["bane1"], bane: 1 },
      bane3: { tier: 3, column: 5, x: 85, y: 80, requires: ["bane2"], bane: 1 },
      // Unchained (scattered field stars)
      quickFeet: { tier: 1, column: 6, x: 8, y: 31 },
      backDodge: { tier: 2, column: 6, x: 47, y: 54 },
      weakSpotMastery: { tier: 3, column: 6, x: 47, y: 83 },
      speedTests: { tier: 4, column: 6, x: 88, y: 31 },
      daggerDefense: { tier: 1, column: 7, x: 87, y: 54 },
      skillDiscount1: { tier: 2, column: 7, x: 22, y: 83 },
      skillDiscount2: { tier: 3, column: 7, x: 9, y: 66 },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Služebník meče (Servant of the Sword)                             */
  /* ----------------------------------------------------------------- */
  swordServant: {
    nodes: {
      // Chain: blade mastery
      bleedA: { tier: 1, column: 1, passive: cm({ extraEffects: { bleed: 10 } }) },
      critHitDef: {
        tier: 2,
        column: 1,
        requires: ["bleedA"],
        passive: ae(
          add("system.combatSkills.combat.critbonus", 3),
          add("system.combatSkills.meleeDefense.critbonus", 3),
        ),
      },
      bleedB: {
        tier: 3,
        column: 1,
        requires: ["critHitDef"],
        passive: cm({ extraEffects: { bleed: 10 } }),
      },
      initiative: {
        tier: 4,
        column: 1,
        requires: ["bleedB"],
        passive: ae(add("system.secondaryAttributes.ini.bonus", 2)),
      },
      hitBonus: {
        tier: 5,
        column: 1,
        requires: ["initiative"],
        passive: ae(add("system.combatSkills.combat.bonus", 5)),
      },
      // Chain: riposte
      ripostaFree: { tier: 1, column: 2 },
      ripostaStamina: { tier: 2, column: 2, requires: ["ripostaFree"] },
      ripostaCrit: { tier: 3, column: 2, requires: ["ripostaStamina"] },
      odvetnyUder: { tier: 4, column: 2 },
      // Chain: aiming
      improvedAim: { tier: 1, column: 3 },
      aimReduction: { tier: 2, column: 3, requires: ["improvedAim"] },
      draciSpanek: { tier: 3, column: 3 },
      draciStraz: { tier: 4, column: 3 },
      // Chain: charge
      chargeDamage: { tier: 1, column: 4 },
      chargeDistance: { tier: 2, column: 4, requires: ["chargeDamage"] },
      priskok: { tier: 3, column: 4 },
      draciVypad: { tier: 4, column: 4 },
      // Chain: slip through
      prosmyknuti: { tier: 1, column: 5 },
      dexTests: { tier: 2, column: 5, requires: ["prosmyknuti"] },
      presneRozseknuti: { tier: 3, column: 5 },
      vyhodnyManevr: { tier: 4, column: 5 },
      // Chain: movement attack
      utokSPohybem: { tier: 1, column: 6 },
      vylUtokSPohybem: { tier: 2, column: 6, requires: ["utokSPohybem"] },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Mistr zbraní (Weapon Master)                                      */
  /* ----------------------------------------------------------------- */
  weaponMaster: {
    nodes: {
      mistrZbrani: { tier: 1, column: 1 },
      vytrvalyValecnik: { tier: 2, column: 1 },
      vycvikSeZbrani: { tier: 3, column: 1 },
      bdelyOchrance: { tier: 4, column: 1 },
      // Chain: armiger
      zbrojnos1: { tier: 1, column: 2 },
      zbrojnos2: { tier: 2, column: 2, requires: ["zbrojnos1"] },
      odrazeni: { tier: 3, column: 2 },
      // Chain: veteran
      veteran1: { tier: 1, column: 3 },
      veteran2: { tier: 2, column: 3, requires: ["veteran1"] },
      vylZbranoveDovednosti: { tier: 3, column: 3 },
      // Unchained passives
      bleedStun: {
        tier: 1,
        column: 4,
        passive: cm({ extraEffects: { bleed: 10, stun: 6 } }),
      },
      critDefRange: {
        tier: 2,
        column: 4,
        passive: {
          ...ae(add("system.combatSkills.meleeDefense.critbonus", 2)),
          ...cm({ critRangeBonus: 1 }),
        },
      },
      precision: {
        tier: 3,
        column: 4,
        passive: cm({ extraEffects: { precision: 10 } }),
      },
      penetration: { tier: 1, column: 5, passive: cm({ penetrationBonus: 2 }) },
      presileni: { tier: 2, column: 5 },
      rychlaReakce: { tier: 3, column: 5 },
      weakSpotPen: { tier: 1, column: 6 },
      primaryDamage: { tier: 2, column: 6 },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Hoplita (Hoplite)                                                 */
  /* ----------------------------------------------------------------- */
  hoplite: {
    nodes: {
      // Chain: impale line
      nabodnuti: { tier: 1, column: 1 },
      velkeTvory: { tier: 2, column: 1, requires: ["nabodnuti"] },
      prilezitostnyUtok: { tier: 3, column: 1, requires: ["velkeTvory"] },
      pripravnyPostoj: { tier: 4, column: 1, requires: ["prilezitostnyUtok"] },
      obranaProtiZteci: { tier: 5, column: 1, requires: ["pripravnyPostoj"] },
      // Chain: brutality
      bleedStun: {
        tier: 1,
        column: 2,
        passive: cm({ extraEffects: { bleed: 20, stun: 10 } }),
      },
      kritZasah: {
        tier: 2,
        column: 2,
        requires: ["bleedStun"],
        passive: ae(add("system.combatSkills.combat.critbonus", 3)),
      },
      momentum: { tier: 3, column: 2, requires: ["kritZasah"] },
      // Chain: advance
      postup: { tier: 1, column: 3 },
      raznyPostup: { tier: 2, column: 3, requires: ["postup"] },
      // Chain: onslaught
      napor1: { tier: 1, column: 4 },
      napor2: { tier: 2, column: 4, requires: ["napor1"] },
      // Unchained
      hoplitaStance: { tier: 1, column: 5 },
      damage1d6: { tier: 2, column: 5, passive: cm({ damageRoll: "1d6" }) },
      troufalyVrh: { tier: 3, column: 5 },
      penetration2: { tier: 1, column: 6, passive: cm({ penetrationBonus: 2 }) },
      hexAttack: { tier: 2, column: 6 },
      silaObratnost: { tier: 4, column: 6 },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Mečový tanečník (Sword Dancer)                                    */
  /* ----------------------------------------------------------------- */
  swordDancer: {
    nodes: {
      // Chain: the duelist's path (full tier-1 row of the sheet)
      duelistuvPostoj: { tier: 1, column: 1 },
      krvaveBodnuti: { tier: 2, column: 1, requires: ["duelistuvPostoj"] },
      mireniRedukce: { tier: 3, column: 1, requires: ["krvaveBodnuti"] },
      vyhodnyManevr: { tier: 4, column: 1, requires: ["mireniRedukce"] },
      posileniObrany: { tier: 5, column: 1, requires: ["vyhodnyManevr"] },
      postojMireni: { tier: 6, column: 1, requires: ["posileniObrany"] },
      precision10: {
        tier: 7,
        column: 1,
        requires: ["postojMireni"],
        passive: cm({ extraEffects: { precision: 10 } }),
      },
      // Unchained, sorted by rank requirement
      oddechMireni: { tier: 1, column: 2 },
      akrobatickeOdpoutani: { tier: 2, column: 2 },
      vylUtokSPohybem: { tier: 3, column: 2 },
      rafinovanyManevr: { tier: 5, column: 2 },
      posledniVypad: { tier: 2, column: 3 },
      vylDuelistuvKrok: { tier: 4, column: 3 },
      brilantniProtiutok: { tier: 6, column: 3 },
    },
  },

  /* ----------------------------------------------------------------- */
  /* Škola Krve (School of Blood)                                      */
  /* ----------------------------------------------------------------- */
  bloodSchool: {
    nodes: {
      // Chain: ranks alternating with spell power. Each rank also grows the
      // blood pool capacity (+10/+10/+20/+50).
      apprentice: {
        tier: 1,
        column: 1,
        passive: ae(add("system.stats.bloodPool.bonus", 10)),
      },
      spellPower1: {
        tier: 2,
        column: 1,
        requires: ["apprentice"],
        passive: ae(add("system.schools.blood.bonus", 2)),
      },
      expert: {
        tier: 3,
        column: 1,
        requires: ["spellPower1"],
        passive: ae(add("system.stats.bloodPool.bonus", 10)),
      },
      spellPower2: {
        tier: 4,
        column: 1,
        requires: ["expert"],
        passive: ae(add("system.schools.blood.bonus", 2)),
      },
      master: {
        tier: 5,
        column: 1,
        requires: ["spellPower2"],
        passive: ae(add("system.stats.bloodPool.bonus", 20)),
      },
      spellPower3: {
        tier: 6,
        column: 1,
        requires: ["master"],
        passive: ae(add("system.schools.blood.bonus", 2)),
      },
      grandmaster: {
        tier: 7,
        column: 1,
        requires: ["spellPower3"],
        passive: ae(add("system.stats.bloodPool.bonus", 50)),
      },
      spellPower4: {
        tier: 8,
        column: 1,
        requires: ["grandmaster"],
        passive: ae(add("system.schools.blood.bonus", 2)),
      },
      // Chain: blood pool capacity
      bloodPool1: {
        tier: 1,
        column: 2,
        passive: ae(add("system.stats.bloodPool.bonus", 15)),
      },
      bloodPool2: {
        tier: 2,
        column: 2,
        requires: ["bloodPool1"],
        passive: ae(add("system.stats.bloodPool.bonus", 15)),
      },
      // Chain: magic attack (school-specific — manual until a per-school
      // attack bonus exists in the system)
      magicAttack1: { tier: 1, column: 3 },
      magicAttack2: { tier: 2, column: 3, requires: ["magicAttack1"] },
      magicAttack3: { tier: 3, column: 3, requires: ["magicAttack2"] },
      // Chain: magic defense vs Blood spells (manual — same reason)
      magicDefense1: { tier: 1, column: 4 },
      magicDefense2: { tier: 2, column: 4, requires: ["magicDefense1"] },
      magicDefense3: { tier: 3, column: 4, requires: ["magicDefense2"] },
      // Unchained
      magickaKrev: { tier: 1, column: 5 },
      krvavyPakt: { tier: 2, column: 5 },
      precision15: {
        tier: 3,
        column: 5,
        passive: cm({ extraEffects: { precision: 15 } }),
      },
      hnevKrve: { tier: 4, column: 5 },
      krvavaPlatba: { tier: 5, column: 5 },
      kritRozsah2: { tier: 1, column: 6 },
      oslabeniTrvani: { tier: 2, column: 6 },
      krvavyStit: { tier: 3, column: 6 },
      darKrve: { tier: 4, column: 6 },
    },
  },
};

// Bulk specialisations generated from the rules workbook (see
// scripts/gen_specs_batch2.py) — merged alongside the handwritten ones.
Object.assign(SPEC_DEFS, GENERATED_SPECS);

// Inject localization keys and defaults derived from spec/node ids
for (const [specId, spec] of Object.entries(SPEC_DEFS)) {
  spec.label = `REDSTEEL.Actor.Specialisations.${specId}.label`;
  for (const [nodeId, node] of Object.entries(spec.nodes)) {
    node.label = `REDSTEEL.Actor.Specialisations.${specId}.nodes.${nodeId}.label`;
    node.description = `REDSTEEL.Actor.Specialisations.${specId}.nodes.${nodeId}.description`;
    node.requires ??= [];
    node.icon ??= "";
    node.passive ??= null;
  }
}

REDSTEEL.specialisations = SPEC_DEFS;

/** Pixel size of one tree grid cell. Node visuals are sized in CSS. */
const NODE_CELL = 96;

/**
 * Build the view data for every specialisation tree the actor has active.
 * Returns an array of trees with absolutely positioned nodes (top-down:
 * tier 1 renders at the top) and the connection lines between them.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
export function prepareSpecialisationTrees(actor) {
  const trees = [];
  const owned = actor.system.specialisations ?? {};

  for (const [specId, def] of Object.entries(REDSTEEL.specialisations)) {
    if (!owned[specId]?.active) continue;
    const unlockedNodes = owned[specId]?.nodes ?? {};

    // A constellation tree positions nodes by x/y PERCENTAGES (0–100) so the
    // figure stretches to fill the panel. A grid tree positions by the
    // tier/column pixel grid. Any node missing coords falls back to its grid
    // slot, so a half-authored tree still renders.
    const constellation = def.layout === "constellation";

    let maxTier = 1;
    let maxColumn = 1;
    const nodes = [];
    const byId = {};

    for (const [nodeId, node] of Object.entries(def.nodes)) {
      maxTier = Math.max(maxTier, node.tier);
      maxColumn = Math.max(maxColumn, node.column);

      // Constellation: x/y are already percentages, pass straight through.
      // Grid: derive pixel centre from the tier/column slot.
      const x = constellation
        ? (node.x ?? 50)
        : (node.column - 1) * NODE_CELL + NODE_CELL / 2;
      const y = constellation
        ? (node.y ?? 50)
        : (node.tier - 1) * NODE_CELL + NODE_CELL / 2;

      const unlocked = !!unlockedNodes[nodeId];
      const available = (node.requires ?? []).every(
        (r) => !!unlockedNodes[r],
      );
      const view = {
        id: nodeId,
        label: node.label,
        description: node.description,
        icon: node.icon || "",
        automated: !!node.passive,
        x,
        y,
        unlocked,
        state: unlocked ? "unlocked" : available ? "available" : "locked",
      };
      byId[nodeId] = view;
      nodes.push(view);
    }

    const links = [];
    for (const [nodeId, node] of Object.entries(def.nodes)) {
      for (const reqId of node.requires ?? []) {
        const from = byId[reqId];
        const to = byId[nodeId];
        if (!from || !to) continue;
        links.push({
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          active: from.unlocked && to.unlocked,
        });
      }
    }

    trees.push({
      id: specId,
      label: def.label,
      nodes,
      links,
      constellation,
      // Grid trees size the canvas from their slot count; constellation trees
      // fill the panel via CSS, so no fixed pixel size is emitted.
      width: constellation ? null : maxColumn * NODE_CELL,
      height: constellation ? null : maxTier * NODE_CELL,
    });
  }
  return trees;
}

/**
 * Create or remove the permanent effects backing a node's passive buff.
 *
 * Stat changes ride the regular ActiveEffect pipeline (the same one
 * conditions use) and show up on the Effects tab. Combat modifiers
 * (damage, penetration, bleed/stun/precision chances, …) are written to
 * system.activeCombatEffects, where getActorCombatModifiers picks them up
 * for every attack — exactly like weapon-enchant effects do.
 *
 * @param {Actor} actor
 * @param {string} specId
 * @param {string} nodeId
 * @param {boolean} unlocked  The node's new unlock state
 */
export async function syncSpecialisationPassive(actor, specId, nodeId, unlocked) {
  const nodeDef = REDSTEEL.specialisations[specId]?.nodes?.[nodeId];
  if (!nodeDef) return;

  const flag = `${specId}.${nodeId}`;
  const groupKey = `spec_${specId}_${nodeId}`;
  const passive = nodeDef.passive;

  const existing = actor.effects.filter(
    (e) => e.getFlag("redsteel", "specNode") === flag,
  );

  if (!unlocked || !passive) {
    if (existing.length) {
      await actor.deleteEmbeddedDocuments(
        "ActiveEffect",
        existing.map((e) => e.id),
      );
    }
    if (actor.system.activeCombatEffects?.[groupKey]) {
      await actor.update({
        [`system.activeCombatEffects.-=${groupKey}`]: null,
      });
    }
    return;
  }

  if (passive.changes?.length && !existing.length) {
    await actor.createEmbeddedDocuments("ActiveEffect", [
      {
        name: game.i18n.localize(nodeDef.label),
        img: nodeDef.icon || "icons/svg/upgrade.svg",
        changes: foundry.utils.deepClone(passive.changes),
        disabled: false,
        transfer: false,
        flags: { redsteel: { specNode: flag } },
      },
    ]);
  }

  if (
    passive.combatModifiers &&
    !actor.system.activeCombatEffects?.[groupKey]
  ) {
    await actor.update({
      [`system.activeCombatEffects.${groupKey}`]: foundry.utils.deepClone(
        passive.combatModifiers,
      ),
    });
  }
}
