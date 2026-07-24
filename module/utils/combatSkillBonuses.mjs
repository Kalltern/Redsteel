import { getTraitPills } from "./traitPills.mjs";
import { withRollBias, applyDesperateCrit, tagRollSkill } from "./rollAdvantage.mjs";
import { AIMED_PARTS } from "./aimedStrike.mjs";
import { getAttackRerollTokens } from "./rerolls.mjs";

async function getSneakDamageFormula(actor, weapon, weaponContext = null) {
  const ws = weapon?.system ?? {};
  const offProps = weaponContext ? getOffhandProps(weaponContext) : null;
  const offhandSneakDamage = offProps?.sneakDamage ?? 0;
  const useSneak = (await actor.getFlag("redsteel", "useSneakAttack")) || false;
  if (!useSneak)
    return { sneakDamage: "", sneakEffect: 0, sneakCritPenetration: 0 };

  let counter = (await actor.getFlag("redsteel", "sneakAccessCounter")) || 0;
  counter++;
  await actor.setFlag("redsteel", "sneakAccessCounter", counter);

  if (counter >= 3) {
    await actor.unsetFlag("redsteel", "useSneakAttack");
    await actor.unsetFlag("redsteel", "sneakAccessCounter");
    //console.log("Sneak attack fully consumed, flags cleared.");
  } else {
    console.log(`Sneak used by ${counter}/3 systems`);
  }

  let sneakEffect = 0;
  let sneakCritPenetration = 0;
  if (actor.type !== "npc") {
    const doctrineRogueLevel = actor.system.doctrines.rogue.value;
    if (doctrineRogueLevel >= 3) sneakEffect = 50;
    if (doctrineRogueLevel >= 4) sneakCritPenetration = 5;
    if (doctrineRogueLevel >= 10) sneakCritPenetration = 10;
  }
  let sneakDamage = `${actor.system.sneakDamage ?? 1}d6 + ${offhandSneakDamage}`;
  if (ws.sneakDamage) {
    sneakDamage = `(${sneakDamage} + ${ws.sneakDamage} )`;
  }

  return {
    sneakDamage: ` + ${sneakDamage}`,
    sneakEffect,
    sneakCritPenetration,
  };
}

export async function getNonWeaponAbility(actor, ability) {
  const abilityAttributeTestName = ability.system.attributeTest || 0;
  const abilityTestModifier = ability.system.testModifier || 0;

  const attributeMap = {
    strength: "str",
    dexterity: "dex",
    endurance: "end",
    intelligence: "int",
    will: "wil",
    charisma: "cha",
    perception: "per",
  };

  let concatRollAndDescription = ability.system.description;
  let attributeTestRoll = null;

  const testName = ability.system.attributeTest?.trim();

  if (testName && testName !== "-- Select a Type --") {
    const lowerTestName = testName.toLowerCase();
    let baseValue = 0;

    // 1️⃣ Leadership special rule FIRST
    if (lowerTestName === "leadership") {
      baseValue =
        actor.type === "npc"
          ? (actor.system.attributes.cha?.value ?? 0)
          : (actor.system.skills?.leadership?.rating ?? 0);
    }

    // 2️⃣ Combat Skills
    else if (actor.system.combatSkills?.[lowerTestName]) {
      baseValue = actor.system.combatSkills[lowerTestName]?.rating ?? 0;
    }

    // 3️⃣ Other Skills
    else if (actor.system.skills?.[lowerTestName]) {
      baseValue = actor.system.skills[lowerTestName]?.rating ?? 0;
    }

    // 4️⃣ Attributes LAST
    else if (attributeMap[lowerTestName]) {
      const shortKey = attributeMap[lowerTestName];

      baseValue =
        actor.type === "npc"
          ? (actor.system.attributes[shortKey]?.mod ?? 0)
          : (actor.system.attributes[shortKey]?.mod ?? 0);
    }
    const totalModifier = Number(baseValue) + Number(abilityTestModifier);
    // Create the Roll
    const attributeRoll = new Roll(
      `(${totalModifier}) - 1d100`,
      withRollBias({}, actor),
    );
    await attributeRoll.evaluate();

    const attributeRollTotal = attributeRoll.total;
    attributeTestRoll = attributeRoll;
  }

  // --- Custom Effects ---
  const { allBleedRollResults, effectsRollResults, mechanicalEffects } =
    await game.redsteel.getEffectRolls(
      actor,
      null, // no weapon
      null, // no weaponContext
      0, // doctrineBleedBonus
      0, // doctrineStaggerBonus
      0, // weaponSkillEffect
      0, // critScore
      false, // critSuccess
      ability,
      [], // selectedModifiers if any
    );

  const system = ability.system || {};

  // DAMAGE ROLL
  let damageRoll = null;
  const rollData = actor.getRollData();
  if (system.roll.diceBonus) {
    damageRoll = new Roll(system.roll.diceBonus, rollData);
    await damageRoll.evaluate();
  }
  const damageProfile = buildDamageProfile(system);
  let rollName = ability.localizedName ?? ability.name;
  const damageTotal = damageRoll ? Math.floor(damageRoll.total) : 0;
  const penetration = system.penetration;
  const halfDamage = system.roll?.halfDamage || false;
  const penCap = system.roll?.penCap || false;
  const validRolls = [];

  if (attributeTestRoll instanceof Roll && attributeTestRoll._evaluated) {
    validRolls.push(attributeTestRoll);
  }

  if (damageRoll instanceof Roll && damageRoll._evaluated) {
    validRolls.push(damageRoll);
  }

  const columns = [];

  // Margin of Success column
  if (attributeTestRoll instanceof Roll && attributeTestRoll._evaluated) {
    const attackHTML = await attributeTestRoll.render();

    columns.push(`
    <div class="roll-column">
      <div class="roll-label">Margin of Success</div>
      ${attackHTML}
    </div>
  `);
  }

  // Damage column
  if (damageRoll instanceof Roll && damageRoll._evaluated) {
    const damageHTML = await damageRoll.render();

    columns.push(`
    <div class="roll-column">
      <div class="roll-label">Damage Roll</div>
      ${damageHTML}
    </div>
  `);
  }

  // Final content
  const content = columns.length
    ? `<div class="dual-roll">${columns.join("")}</div>`
    : "";

  // Send the combined chat message
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker(),
    content,
    rolls: validRolls,
    flags: {
      redsteel: {
        rollName,
        traitPills: getTraitPills(actor, "attack"),
        // Non-weapon ability attack — generic "attack" token only.
        rerollTokens: getAttackRerollTokens(actor, null),
      },
      attack: {
        type: "attack",
        damageProfile,
        effects: mechanicalEffects,
        normal: {
          damage: damageTotal,
          penetration: penetration,
          halfDamage: halfDamage,
          penCap: penCap,
        },
      },
    },
    flavor: `
<div style="display:flex; align-items:center; justify-content:left; gap:8px; font-size:1.3em; font-weight:bold;">
  <img src="${ability.img}" title="${ability.localizedName ?? ability.name}" width="36" height="36">
  <span>${ability.localizedName ?? ability.name}</span>
</div>
<hr>
<table style="width: 100%; text-align: center; font-size: 15px;">
  <tr>    <th>Description:</th>  </tr>
  <tr>    <td>${concatRollAndDescription}</td>  </tr>

  <tr>    <th>Effects:</th>  </tr>

  <tr>    <td>${effectsRollResults}</td>  </tr>

  <tr>    <td><hr></td>  </tr>

</table>
`,
  });
}

export async function getDoctrineBonuses(actor, weapon) {
  // Doctrine bonuses
  const doctrine = actor.system.doctrines;
  const ws = weapon?.system ?? {};
  let doctrineBonus = 0;
  let doctrineCritBonus = 0;
  let doctrineCritRangeBonus = 0;
  let doctrineStaggerBonus = 0;
  let doctrineBleedBonus = 0;
  let doctrineCritDefenseBonus = 0;
  let doctrineDefenseBonus = 0;
  let doctrineRangedDefenseBonus = 0;
  let doctrineCritDmg = 0;
  let doctrineSkillCritPen = 0;
  if (actor.type === "npc") {
    return {
      doctrineBonus: 0,
      doctrineCritBonus: 0,
      doctrineCritRangeBonus: 0,
      doctrineStaggerBonus: 0,
      doctrineBleedBonus: 0,
      doctrineCritDefenseBonus: 0,
      doctrineDefenseBonus: 0,
      doctrineRangedDefenseBonus: 0,
      doctrineCritDmg: 0,
      doctrineSkillCritPen: 0,
    };
  }
  for (const [doctrineName, doctrineValue] of Object.entries(
    ws.doctrines ?? 0,
  )) {
    if (doctrineValue === true) {
      if (doctrineName === "pikeman" && doctrine.pikeman.value >= 3) {
        doctrineBonus = 10;
        if (doctrine.pikeman.value >= 7) {
          doctrineBonus = 15;
        }
      }
      if (doctrineName === "swordsman" && doctrine.swordsman.value >= 3) {
        doctrineBonus = 10;
        if (doctrine.swordsman.value >= 5) {
          doctrineBleedBonus = 25;
        }
      }
      if (doctrineName === "reaver" && doctrine.reaver.value >= 2) {
        doctrineBonus = 10;
        if (doctrine.reaver.value >= 4) {
          doctrineCritRangeBonus = 2;
        }
        if (doctrine.reaver.value >= 7) {
          doctrineBleedBonus = 15;
          doctrineStaggerBonus = 10;
        }
        if (doctrine.reaver.value >= 8) {
          doctrineBonus = 15;
        }
      }
      if (doctrineName === "shieldbearer" && doctrine.shieldbearer.value >= 3) {
        doctrineCritDefenseBonus = 3;
        if (doctrine.shieldbearer.value >= 7) {
          doctrineDefenseBonus = 5;
          doctrineRangedDefenseBonus = 10;
        }
      }
      if (doctrineName === "dimakerus" && doctrine.dimakerus.value >= 2) {
        doctrineDefenseBonus = 5;
        doctrineRangedDefenseBonus = 5;
        if (doctrine.dimakerus.value >= 4) {
          doctrineBleedBonus = 10;
          doctrineStaggerBonus = 5;
        }
        if (doctrine.dimakerus.value >= 7) {
          doctrineDefenseBonus = 10;
        }
        if (doctrine.dimakerus.value >= 9) {
          doctrineBonus = 5;
        }
      }

      if (doctrineName === "duelist" && doctrine.duelist.value >= 4) {
        doctrineBonus = 5;
        doctrineCritBonus = 2;
        if (doctrine.dimakerus.value >= 8) {
          doctrineCritDefenseBonus = 1;
        }
      }
      if (doctrineName === "monk" && doctrine.monk.value >= 1) {
        doctrineBonus = 5;
        doctrineDefenseBonus = 5;
        if (doctrine.monk.value >= 5) {
          doctrineCritDefenseBonus = 2;
        }
        if (doctrine.monk.value >= 6) {
          doctrineBonus = 8;
          doctrineDefenseBonus = 8;
        }
      }
      if (doctrineName === "archer" && doctrine.archer.value >= 1) {
        doctrineBonus = 10;
        if (doctrine.archer.value >= 4) {
          doctrineBleedBonus = 10;
          doctrineSkillCritPen = 5;
          doctrineCritDmg = 5;
        }
        if (doctrine.archer.value >= 6) {
          doctrineCritBonus = 3;
        }
        if (doctrine.archer.value >= 7) {
          doctrineSkillCritPen = 10;
          doctrineCritDmg = 10;
        }
      }
      if (doctrineName === "arbalest" && doctrine.arbalest.value >= 1) {
        doctrineBonus = 10;
        if (doctrine.arbalest.value >= 4) {
          doctrineSkillCritPen = 5;
          doctrineCritDmg = 5;
        }
        if (doctrine.arbalest.value >= 6) {
          doctrineBleedBonus = 10;
          doctrineBonus = 15;
        }
        if (doctrine.arbalest.value >= 7) {
          doctrineSkillCritPen = 10;
          doctrineCritDmg = 10;
        }
        if (doctrine.arbalest.value >= 8) {
          doctrineCritBonus = 5;
        }
      }
      if (doctrineName === "peltast" && doctrine.peltast.value >= 1) {
        doctrineBleedBonus = 20;
        doctrineStaggerBonus = 10;
        if (doctrine.peltast.value >= 4) {
          doctrineSkillCritPen = 5;
          doctrineCritDmg = 5;
        }
        if (doctrine.peltast.value >= 6) {
          doctrineCritBonus = 3;
        }
        if (doctrine.peltast.value >= 7) {
          doctrineSkillCritPen = 10;
          doctrineCritDmg = 10;
        }
        if (doctrine.peltast.value >= 9) {
          // add zatizeni stitu
          doctrineCritRangeBonus = 2;
        }
      }
      if (doctrineName === "juggler" && doctrine.juggler.value >= 3) {
        doctrineBonus = 5;
        if (doctrine.juggler.value >= 2) {
          doctrineCritBonus = 3;
        }
        if (doctrine.juggler.value >= 4) {
          doctrineBleedBonus = 10;
          doctrineSkillCritPen = 5;
          doctrineCritDmg = 5;
        }
        if (doctrine.juggler.value >= 7) {
          doctrineSkillCritPen = 10;
          doctrineCritDmg = 10;
        }
      }
    }
  }
  /* console.log(
    `Doctrine Bonus: ${doctrineBonus}, ${doctrineCritBonus}, ${doctrineCritRangeBonus}, ${doctrineStaggerBonus}, ${doctrineBleedBonus}`,
  );*/

  return {
    doctrineBonus,
    doctrineCritBonus,
    doctrineCritRangeBonus,
    doctrineStaggerBonus,
    doctrineBleedBonus,
    doctrineRangedDefenseBonus,
    doctrineDefenseBonus,
    doctrineCritDefenseBonus,
    doctrineSkillCritPen,
    doctrineCritDmg,
  };
}

export async function getWeaponSkillBonuses(actor, weapon) {
  // weapon skill bonuses
  const ws = weapon?.system ?? {};
  const weaponSkill = actor.system.weaponSkills;
  let weaponSkillEffect = 0;
  let weaponSkillCrit = 0;
  let weaponSkillCritDmg = 0;
  let weaponSkillCritPen = 0;

  if (actor.type === "npc") {
    return {
      weaponSkillEffect: 0,
      weaponSkillCrit: 0,
      weaponSkillCritDmg: 0,
      weaponSkillCritPen: 0,
    };
  }
  for (const [skillName, skillValue] of Object.entries(weaponSkill)) {
    // Match singular weapon class to plural skill name
    const className = ws.class ?? 0;
    // Does the weapon's class match this skill name (e.g. "axe" vs "axes")?
    const matches = skillName === className + "s";

    if (
      (className === skillName && weaponSkill[skillName].value >= 5) ||
      (matches && weaponSkill[skillName].value >= 5)
    ) {
      weaponSkillEffect = 10;
      weaponSkillCritDmg = 5;
      weaponSkillCritPen = 5;
      if (weaponSkill[skillName].value >= 7) {
        weaponSkillCrit = 3;
      }
      if (weaponSkill[skillName].value >= 8) {
        weaponSkillEffect = 20;
        weaponSkillCritDmg = 10;
        weaponSkillCritPen = 10;
      }
    }
  }

  return {
    weaponSkillEffect,
    weaponSkillCrit,
    weaponSkillCritDmg,
    weaponSkillCritPen,
  };
}

export async function getAttackRolls(
  actor,
  weapon,
  doctrineBonus,
  doctrineCritBonus,
  weaponSkillCrit,
  abilityAttack = 0,
  weaponContext = null,
  customCritFail = 0,
  longReachPenalty = 0,
) {
  const ws = weapon?.system ?? {};
  // Weapon quality (Zbraň column): attack + critical-hit chance bonuses.
  const qualityAttack = Number(ws.qualityMods?.attack || 0);
  const qualityCritChance = Number(ws.qualityMods?.critChance || 0);
  let totalWeaponAttack =
    Number(doctrineBonus || 0) +
    Number(ws.attack || 0) +
    qualityAttack +
    Number(longReachPenalty || 0);
  let criticalSuccessThreshold = 0;
  let criticalFailureThreshold = 0;
  const offProps = getOffhandProps(weaponContext);
  if (offProps?.attack) {
    totalWeaponAttack += offProps.attack;
  }
  if (offProps) {
    criticalSuccessThreshold += offProps?.critChance || 0;
    criticalFailureThreshold -= offProps?.critFail || 0;
  }

  const specBonus = getWeaponSpecBonuses(actor, weapon);
  totalWeaponAttack += specBonus.attack;

  const finesse = actor.system.combatSkills.combat.finesseRating;
  const normalCombat = actor.system.combatSkills.combat.rating;
  let attackRollFormula = 0;
  const useFlanking = actor.getFlag("redsteel", "useFlankingAttack");
  if (useFlanking) {
    abilityAttack += 10;
    await actor.unsetFlag("redsteel", "useFlankingAttack");
  }
  const aimValue = actor.getFlag("redsteel", "aimCount");
  if (aimValue > 0) {
    abilityAttack += aimValue * 10;
    await actor.unsetFlag("redsteel", "aimCount");
  }
  // Aimed Strike: consume the part flag and apply the hit penalty.
  const aimedPart = actor.getFlag("redsteel", "aimedPart") ?? null;
  if (aimedPart) {
    const partDef = AIMED_PARTS[aimedPart];
    if (partDef) abilityAttack += partDef.attackPenalty;
    await actor.unsetFlag("redsteel", "aimedPart");
  }

  if (ws.class === "bow" || ws.class === "crossbow") {
    // Critical success and failure thresholds
    criticalSuccessThreshold =
      actor.system.combatSkills.archery.criticalSuccessThreshold +
      doctrineCritBonus +
      (ws.critChance ?? 0) +
      qualityCritChance;
    criticalFailureThreshold =
      actor.system.combatSkills.archery.criticalFailureThreshold -
      (ws.critFail ?? 0) -
      customCritFail;
    // ATTACK ROLL
    attackRollFormula = `@combatSkills.archery.rating + ${totalWeaponAttack} - 1d100`;
    if (abilityAttack) {
      attackRollFormula = `@combatSkills.archery.rating + ${totalWeaponAttack} + ${abilityAttack} - 1d100`;
    }
  } else if (ws.thrown) {
    const knifeMasterCrit = knifeMasterCheck(actor, weapon) ? 2 : 0;
    criticalSuccessThreshold =
      actor.system.combatSkills.combat.criticalSuccessThreshold +
      (ws.critChance ?? 0) +
      qualityCritChance +
      knifeMasterCrit +
      doctrineCritBonus +
      (weaponSkillCrit ?? 0);
    criticalFailureThreshold =
      actor.system.combatSkills.combat.criticalFailureThreshold -
      (ws.critFail ?? 0) -
      customCritFail;
    // ATTACK ROLL
    //  console.log("Aim value", aimValue);
    attackRollFormula =
      finesse > normalCombat && ws.finesse
        ? `@combatSkills.throwing.finesseRating + ${totalWeaponAttack} - 1d100`
        : `@combatSkills.throwing.rating + ${totalWeaponAttack} - 1d100`;
    if (abilityAttack) {
      attackRollFormula =
        finesse > normalCombat && ws.finesse
          ? `@combatSkills.throwing.finesseRating + ${totalWeaponAttack} + ${abilityAttack} - 1d100`
          : `@combatSkills.throwing.rating + ${totalWeaponAttack} + ${abilityAttack} - 1d100`;
    }
  } else {
    criticalSuccessThreshold =
      actor.system.combatSkills.combat.criticalSuccessThreshold +
      ((ws.critChance ?? 0) +
        qualityCritChance +
        doctrineCritBonus +
        weaponSkillCrit || 0);
    criticalFailureThreshold =
      actor.system.combatSkills.combat.criticalFailureThreshold -
      (ws.critFail ?? 0) -
      customCritFail;
    // ATTACK ROLL
    //  console.log("Aim value", aimValue);
    attackRollFormula =
      finesse > normalCombat && ws.finesse
        ? `@combatSkills.combat.finesseRating + ${totalWeaponAttack} - 1d100`
        : `@combatSkills.combat.rating + ${totalWeaponAttack} - 1d100`;
    if (abilityAttack) {
      attackRollFormula =
        finesse > normalCombat && ws.finesse
          ? `@combatSkills.combat.finesseRating + ${totalWeaponAttack} + ${abilityAttack} - 1d100`
          : `@combatSkills.combat.rating + ${totalWeaponAttack} + ${abilityAttack} - 1d100`;
    }
  }

  criticalSuccessThreshold += specBonus.critChance;

  // Roll data setup

  let rollName = weapon
    ? `${weapon.localizedName ?? weapon.name} Attack`
    : "Ability Attack";
  if (aimedPart) {
    rollName += ` → ${AIMED_PARTS[aimedPart]?.label ?? aimedPart}`;
  }
  const rollData = {
    combatSkills: actor.system.combatSkills,
    weaponAttack: ws.attack || 0,
    str: actor.system.attributes.str.total,
    dex: actor.system.attributes.dex.total,
    per: actor.system.attributes.per.total,
  };

  const attackRoll = new Roll(attackRollFormula, withRollBias(rollData, actor));
  if (ws?.gripMode === "two") tagRollSkill(attackRoll, "twoHanded");
  await attackRoll.evaluate();
  const rollResult = attackRoll.dice[0].total;

  // Desperate Effort shifts the crit thresholds for this attack.
  const { successThreshold: critSuccessThreshold, failureThreshold: critFailThreshold } =
    applyDesperateCrit(
      attackRoll,
      criticalSuccessThreshold,
      criticalFailureThreshold,
    );
  const critSuccess = rollResult <= critSuccessThreshold;
  const critFailure = rollResult >= critFailThreshold;

  return {
    attackRoll,
    critSuccess,
    critFailure,
    criticalSuccessThreshold: critSuccessThreshold,
    criticalFailureThreshold: critFailThreshold,
    rollName,
    aimedPart,
  };
}

export async function getDamageRolls(
  actor,
  weapon,
  weaponContext = null,
  abilityDamage = 0,
  abilityBreakthrough = 0,
) {
  const ws = weapon?.system ?? {};
  const rollData = {
    combatSkills: actor.system.combatSkills,
    weaponAttack: ws.attack ?? 0,
    str: actor.system.attributes.str.total,
    dex: actor.system.attributes.dex.total,
    end: actor.system.attributes.end.total,
    int: actor.system.attributes.int.total,
    wil: actor.system.attributes.wil.total,
    cha: actor.system.attributes.cha.total,
    per: actor.system.attributes.per.total,
  };
  // Surface each magic school's spell power so modifier-ability damage
  // formulas can use @spellPowerFire, @spellPowerDarkness, etc. — matching
  // the tokens the actor/item roll data expose.
  for (const [key, school] of Object.entries(actor.system.schools ?? {})) {
    const name = key.charAt(0).toUpperCase() + key.slice(1);
    rollData[`spellPower${name}`] = school?.spellPower ?? 0;
  }
  const offProps = getOffhandProps(weaponContext);
  const actorMods = getActorCombatModifiers(actor, weapon);
  const specDamage = getWeaponSpecBonuses(actor, weapon);
  const { sneakDamage } = await getSneakDamageFormula(
    actor,
    weapon,
    weaponContext ?? null,
  );
  let damageFormula = `(${ws.formula ?? 0}`;
  if (offProps?.diceBonus) {
    damageFormula += ` + ${offProps.diceBonus}`;
  }
  if (sneakDamage) damageFormula += `+ ${sneakDamage}`;
  if (abilityDamage) damageFormula += `+ ${abilityDamage}`;
  if (actorMods) damageFormula += `+ ${actorMods.damageBonus}`;
  if (qualifiesForFreehand(actor, weapon)) {
    const freehandDice = getFreehandDice(actor);

    if (freehandDice > 0) {
      damageFormula += ` + ${freehandDice}d6`;
    }
  }
  if (knifeMasterCheck(actor, weapon)) {
    damageFormula += ` + (1d4 + 1)`;
  }
  if (ws.gripMode === "two") {
    damageFormula += ` + ${ws.twoHandDice ?? "1d6"}`;
  }
  for (const roll of actorMods.damageRolls) {
    damageFormula += ` + ${roll}`;
  }
  // Poison/coating applied to this specific weapon (see usePoison). It adds a
  // flat bonus to this weapon's damage and persists until removed.
  const coating = weapon?.getFlag?.("redsteel", "coating");
  if (coating?.formula) {
    damageFormula += ` + (${coating.formula})`;
  }
  if (specDamage.damageDice > 0) damageFormula += ` + ${specDamage.damageDice}d4`;
  damageFormula += ")";
  damageFormula = damageFormula.replace(/\s*\+\s*$/, "");
  damageFormula = damageFormula.replace(/@([\w.]+)/g, (_, key) => {
    return foundry.utils.getProperty(rollData, key) ?? 0;
  });

  const damageRoll = new Roll(damageFormula, actor.system);
  await damageRoll.evaluate();

  //console.log("enchant damage", actorMods.damageBonus);
  const damageTotal = Math.floor(damageRoll.total ?? 0);

  // If the weapon has breakthrough, roll it
  let breakthroughRollResult = "";
  if (ws.breakthrough) {
    let breakthroughFormula = `${ws.breakthrough}`;
    if (abilityBreakthrough) breakthroughFormula += ` + ${abilityBreakthrough}`;
    if (offProps?.breakthrough) {
      breakthroughFormula += ` + ${offProps.breakthrough}`;
    }
    breakthroughFormula = breakthroughFormula.replace(/\s*\+\s*$/, "");
    breakthroughFormula = breakthroughFormula.replace(
      /@([\w.]+)/g,
      (_, key) => {
        return foundry.utils.getProperty(rollData, key) ?? 0;
      },
    );
    const breakthroughRoll = new Roll(breakthroughFormula, actor.system);
    await breakthroughRoll.evaluate();
    breakthroughRollResult = `${breakthroughRoll.total}`; // Customize as needed
  }
  return {
    damageRoll,
    damageTotal,
    breakthroughRollResult,
  };
}

/**
 * Bucket a crit-range roll total (critRange + 1d20) into a crit degree 0-4.
 * Exported so the Bane packet can re-bucket the same d20 under a shifted
 * crit range without re-rolling.
 */
export function critScoreToDegree(critScoreResult) {
  let critScore = 0;
  if (critScoreResult >= 1) {
    if (critScoreResult <= 6) critScore = 1;
    else if (critScoreResult <= 12) critScore = 2;
    else if (critScoreResult <= 18) critScore = 3;
    else critScore = 4;
  }
  return critScore;
}

export async function getCriticalRolls(
  actor,
  weapon,
  weaponContext = null,
  doctrineCritRangeBonus,
  attackRoll,
  weaponSkillCritDmg,
  weaponSkillCritPen,
  damageTotal,
  penetration,
  doctrineCritDmg,
  doctrineSkillCritPen,
) {
  // CRITICAL SCORE ROLL (only in flavor text)
  const offProps = getOffhandProps(weaponContext);
  const failedAttack = attackRoll.total < 0 ? -5 : 0;
  const ws = weapon?.system ?? {};
  const { sneakCritPenetration } = await getSneakDamageFormula(
    actor,
    weapon,
    weaponContext ?? null,
  );
  let actorCritRange;
  if (ws.class === "crossbow" || ws.class === "bow" || ws.thrown) {
    actorCritRange = actor.system.critRangeRanged;
  } else {
    actorCritRange = actor.system.critRangeMelee;
  }
  const critRange =
    (ws.critRange ?? 0) +
      actorCritRange +
      doctrineCritRangeBonus +
      (offProps?.critRange || 0) +
      failedAttack || 0;
  const critScoreRollFormula = `${critRange} + 1d20`;
  const critScoreRoll = new Roll(critScoreRollFormula);
  await critScoreRoll.evaluate();
  const critScoreResult = critScoreRoll.total;
  const critScore = critScoreToDegree(critScoreResult);

  // Crit Damage Calculation:
  // Mapping crit scores to bonus damage: 0 → 0, 1 → 5, 2 → 5, 3 → 10, 4 → 20
  const perBonus = Number(actor.system.attributes.per.total) || 0;
  const critDamageMapping = [0, 5, 5, 10, 20];
  const critPenetrationMapping = [5, 5, 10, 10, 15];
  const actorCritBonus = Number(actor.system.critDamage) || 0;
  const weaponDamageTypes = [ws.dmgType1, ws.dmgType2, ws.dmgType3, ws.dmgType4]
    .filter((e) => typeof e === "string")
    .map((e) => e.toLowerCase());
  let deadlyLungeBonus = 0;
  if (actor.system.deadlyLunge) {
    // Not allowed for thrown weapons
    if (ws.thrown) return;
    // Not allowed for bows/crossbows
    if (["crossbow", "bow"].includes(ws.class)) return;
    if (weaponDamageTypes.includes("piercing")) {
      deadlyLungeBonus = 5;
    }
  }
  const buildCriticalTotals = (degree) => {
    const critDamageTotal =
      (critDamageMapping[degree] ?? 0) +
      weaponSkillCritDmg +
      deadlyLungeBonus +
      perBonus +
      actorCritBonus +
      (weapon?.system.critDamage || 0) +
      damageTotal +
      doctrineCritDmg;

    const critBonusPenetration =
      (critPenetrationMapping[degree] ?? 0) +
        perBonus +
        actorCritBonus +
        sneakCritPenetration +
        deadlyLungeBonus +
        penetration +
        (weapon?.system.critPenetration || 0) +
        weaponSkillCritPen +
        doctrineSkillCritPen || 0;

    return {
      degree,
      damage: critDamageTotal,
      penetration: critBonusPenetration,
    };
  };

  const criticalOptions = [0, 1, 2, 3, 4].map(buildCriticalTotals);
  const selectedCritical = criticalOptions[critScore] ?? criticalOptions[0];
  const critBonusPenetration = selectedCritical.penetration;

  let critDamageTotal = selectedCritical.damage;

  return {
    critScore,
    critScoreResult,
    critBonusPenetration,
    critDamageTotal,
    criticalOptions,
  };
}

function getEffectName(systemMap, effectMap, index) {
  const primaryNameKey = `effectType${index}`;
  const customNameKey = `effectName${index}`;

  // 1. Get the primary system name (e.g., "Bleed", "Stagger", or "Custom")
  const primaryName = systemMap[primaryNameKey] || "";

  if (primaryName.toLowerCase() === "custom") {
    // If it's custom, return the user-typed name from the effects data
    return effectMap[customNameKey] || "";
  }

  // 3. Otherwise, return the primary system name
  return primaryName;
}

export async function getEffectRolls(
  actor,
  weapon,
  weaponContext = null,
  doctrineBleedBonus,
  doctrineStaggerBonus,
  weaponSkillEffect,
  critScore,
  critSuccess,
  ability = {},
  selectedModifiers = [],
) {
  // --- Initial Setup ---

  const mechanicalEffects = {};
  let totalBleedChance = 0;

  let bleedRollResult = null;
  const ws = weapon?.system ?? {};
  let deepSlash =
    critSuccess &&
    actor.system.deepSlash &&
    ws.type === "light" &&
    ws.dmgType2 === "slash" &&
    (qualifiesForFreehand || shieldEquipped(actor))
      ? 100
      : 0;
  const { sneakEffect } = await getSneakDamageFormula(
    actor,
    weapon,
    weaponContext ?? null,
  );
  // console.log("sneakEffect", sneakEffect);
  let effectsRollResults = "";

  const offProps = getOffhandProps(weaponContext);
  const weaponEffects = ws.effects || {};
  const actorEffects = actor.system.effects || {};
  const actorMods = getActorCombatModifiers(actor, weapon);

  // Poison coating applied to this weapon (see usePoison). Its authored combat
  // effects fold into this attack the same way the weapon's own effects do:
  // dedicated bleed/stagger below, custom slots via collectExtrasFromSource.
  const coating = weapon?.getFlag?.("redsteel", "coating");
  const coatingEffects = coating?.effects || {};

  const weaponSystem = ws || {};
  let abilityEffects = {};
  let abilitySystem = {};
  if (ability?.system) {
    abilityEffects = ability.system.effects || {};
    abilitySystem = ability.system || {};
  }
  let critBleeds = 0;
  let normalBleeds = 0;
  let totalBleeds = 0;
  let regularBleedRolls = [];
  let sharpBleedRolls = [];
  if (critScore > 1) {
    critBleeds += 1;
  }

  // --- 1. Process Fixed Effects (Stagger) ---

  const fixedEffectNames = ["stagger"];

  for (const effectName of fixedEffectNames) {
    let modifierBonus = 0;
    for (const mod of selectedModifiers) {
      if (!mod?.system?.effects) continue;

      for (let i = 1; i <= 3; i++) {
        const name = getEffectName(mod.system, mod.system.effects, i);
        const value = mod.system.effects[`extra${i}`] ?? 0;

        if (!name) continue;

        if (name.toLowerCase() === effectName) {
          if (value === -1) {
            modifierBonus = -1; // auto overrides everything
            break;
          }

          modifierBonus += value;
        }
      }
    }
    const baseValue = weaponEffects[effectName] || 0;
    const modifier = actorEffects[effectName] || 0;
    const abilityBonus = abilityEffects[effectName] || 0;
    const offValue = offProps?.effects?.[effectName] || 0;
    const coatingValue = coatingEffects[effectName] || 0;
    let totalBaseValue =
      baseValue + offValue + abilityBonus + modifierBonus + coatingValue;

    let isAuto =
      baseValue === -1 ||
      offValue === -1 ||
      abilityBonus === -1 ||
      coatingValue === -1;

    let shouldProcess = isAuto || totalBaseValue > 0;

    if (shouldProcess) {
      let modifiedEffectValue =
        offValue +
        baseValue +
        modifier +
        abilityBonus +
        modifierBonus +
        coatingValue;

      if (effectName === "stagger") {
        modifiedEffectValue =
          modifiedEffectValue +
          doctrineStaggerBonus +
          sneakEffect +
          weaponSkillEffect +
          (critScore > 1 && critSuccess ? 100 : 0);
        if (isAuto) {
          effectsRollResults += `<p><b>|Stagger| </b></p>`;

          mechanicalEffects["stagger"] = {
            chance: null,
            roll: null,
            auto: true,
          };

          continue;
        }

        const d100Roll = new Roll("1d100");
        await d100Roll.evaluate();
        const roundedModifiedValue = Math.floor(modifiedEffectValue);
        const displayName =
          effectName.charAt(0).toUpperCase() + effectName.slice(1);
        const successText =
          d100Roll.total <= roundedModifiedValue
            ? `<i class="fa-regular fa-star" style="--fa-primary-color: #c4c700; --fa-secondary-color: #5c5400;"></i> SUCCESS`
            : ``;

        effectsRollResults += `<p><b>| ${displayName}: </b>${d100Roll.total} | < ${roundedModifiedValue}% ${successText}</p>`;
        mechanicalEffects["stagger"] = {
          chance: roundedModifiedValue,
          roll: d100Roll.total,
        };
      }
    }
  }

  const effectContributions = [];
  // Weapon quality (Ověření) contributes a precision extra effect that merges
  // with any precision granted by specialisations/abilities below.
  const qualityPrecision = Number(weaponSystem.qualityMods?.precision || 0);
  if (qualityPrecision) {
    effectContributions.push({ name: "precision", value: qualityPrecision });
  }
  if (actorMods?.extraEffects) {
    for (const [name, value] of Object.entries(actorMods.extraEffects)) {
      if (value !== 0) {
        effectContributions.push({ name, value });
      }
    }
  }
  collectExtrasFromSource(weaponSystem, weaponEffects, effectContributions);
  if (
    offProps?.effects &&
    weaponContext?.offWeapon?.system?.offhandProperties
  ) {
    collectExtrasFromSource(
      weaponContext.offWeapon.system.offhandProperties,
      offProps.effects,
      effectContributions,
    );
  }
  if (ability?.system?.effects) {
    collectExtrasFromSource(
      ability.system,
      ability.system.effects,
      effectContributions,
    );
  }
  if (coating?.effects) {
    // The coating stores effectType1..3 at the top level of the flag and the
    // matching extra/effectName values inside `effects`, mirroring item.system.
    collectExtrasFromSource(
      {
        effectType1: coating.effectType1,
        effectType2: coating.effectType2,
        effectType3: coating.effectType3,
      },
      coating.effects,
      effectContributions,
    );
  }
  for (const mod of selectedModifiers) {
    if (!mod?.system?.effects) continue;

    collectExtrasFromSource(
      mod.system,
      mod.system.effects,
      effectContributions,
    );
  }
  const customEffectRolls = new Map();

  for (const { name, value } of effectContributions) {
    const key = name.toLowerCase();
    if (fixedEffectNames.includes(key)) continue;
    if (customEffectRolls.has(name)) {
      const existing = customEffectRolls.get(name);

      // If either side is AUTO, result is AUTO
      if (existing === -1 || value === -1) {
        customEffectRolls.set(name, -1);
      } else {
        customEffectRolls.set(name, existing + value);
      }
    } else {
      customEffectRolls.set(name, value);
    }
  }

  // 3. Process and Display ALL Merged Effects from the Map
  for (const [name, value] of customEffectRolls.entries()) {
    if (value === 0) continue;

    if (value === -1) {
      effectsRollResults += `<p><b>|${name}|</b></p>`;

      mechanicalEffects[name] = {
        chance: null,
        roll: null,
        auto: true,
      };

      continue;
    }

    if (value <= 0) continue;

    const d100Roll = new Roll("1d100");
    await d100Roll.evaluate();

    const roundedModifiedValue = Math.floor(value);
    const successText = d100Roll.total <= roundedModifiedValue ? "SUCCESS" : "";

    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    effectsRollResults += `<p><b>${displayName}:</b> ${d100Roll.total} < ${roundedModifiedValue}% ${successText}</p>`;

    mechanicalEffects[name] = {
      chance: roundedModifiedValue,
      roll: d100Roll.total,
      auto: false,
    };
  }

  // --- 3b. Wounding Impale ---
  // Impale applies the ordinary Rooted effect. When the attacker has the
  // Wounding Impale feature AND this attack actually used the Impale ability,
  // tag that Root with how many Bleeding stacks to inflict when it is torn
  // free: 2, or 3 with a Trident-tagged weapon. The tag rides on the Root via
  // flags.redsteel.impaleBleeds (set in applyDamage) and fires in effects.mjs
  // on removal. A plain Root (no Impale, or no feature) carries no tag and so
  // never bleeds.
  if (mechanicalEffects["root"] && actor.system.woundingImpale) {
    const isImpale = (item) =>
      item?.system?.localizationKey === "REDSTEEL.Items.Impale.name" ||
      item?.name === "Impale";
    const usedImpale =
      isImpale(ability) || selectedModifiers.some((m) => isImpale(m));

    if (usedImpale) {
      const weaponTags = String(ws.tags ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase());
      const bleeds = 2 + (weaponTags.includes("trident") ? 1 : 0);
      mechanicalEffects["root"].bleedStacks = bleeds;
    }
  }

  // --- 4. Sharp Bleed Logic ---

  if (ws.sharp && (weaponEffects.bleed > 0 || (coatingEffects.bleed || 0) > 0)) {
    if (critScore > 1) {
      critBleeds += 1;
    }
    const abilityBleed = abilityEffects["bleed"] || 0;
    const modifier = actorEffects["bleed"] || 0;
    const modifiedBleedValue =
      (weaponEffects.bleed || 0) +
      modifier +
      (abilityBleed || 0) +
      weaponSkillEffect +
      doctrineBleedBonus +
      (offProps?.effects?.bleed || 0) +
      (coatingEffects.bleed || 0) +
      sneakEffect;
    const bleedChance = modifiedBleedValue % 100;
    const sharpBleedRoll = new Roll("1d100");
    await sharpBleedRoll.evaluate();
    let sharpStacks = Math.floor(modifiedBleedValue / 100);
    if (sharpBleedRoll.total <= bleedChance) sharpStacks++;
    normalBleeds += sharpStacks;
    sharpBleedRolls.push(sharpBleedRoll.total);
  }

  // --- 5. Combine All Bleed Rolls and Final Return ---

  let bleedChanceDisplay = 0;

  // Gate only: the actual chance is summed independently below. Actor-level
  // bleed (doctrines such as Dimakerus, or Active Effects on system.effects)
  // has to count here too, otherwise it is silently dropped whenever the
  // weapon itself carries no intrinsic bleed.
  const bleedBaseValue =
    (weaponEffects.bleed || 0) +
    (offProps?.effects?.bleed || 0) +
    (abilityEffects["bleed"] || 0) +
    (coatingEffects.bleed || 0) +
    (actorEffects["bleed"] || 0);

  const bleedIsAuto =
    weaponEffects.bleed === -1 ||
    offProps?.effects?.bleed === -1 ||
    abilityEffects["bleed"] === -1 ||
    coatingEffects.bleed === -1;

  // --- COMPUTE ONLY ---
  if (bleedIsAuto) {
    normalBleeds += 1;
    bleedChanceDisplay = "AUTO";
  } else if (bleedBaseValue > 0) {
    const abilityBleed = abilityEffects["bleed"] || 0;
    const actorBleed = actorEffects["bleed"] || 0;
    const offBleed = offProps?.effects?.bleed || 0;
    const coatingBleed = coatingEffects.bleed || 0;

    totalBleedChance =
      (weaponEffects.bleed || 0) +
      deepSlash +
      actorBleed +
      abilityBleed +
      weaponSkillEffect +
      sneakEffect +
      offBleed +
      coatingBleed +
      doctrineBleedBonus;

    bleedChanceDisplay = totalBleedChance;

    const bleedRoll = new Roll("1d100");
    await bleedRoll.evaluate();

    bleedRollResult = bleedRoll.total;
    regularBleedRolls.push(bleedRollResult);

    const bleedBase = Math.floor(totalBleedChance / 100);
    const bleedChance = totalBleedChance % 100;

    let regularStacks = bleedBase;
    if (bleedRollResult <= bleedChance) regularStacks++;

    normalBleeds += regularStacks;
  }

  // --- FINAL RESULT (single source of truth) ---
  totalBleeds = critBleeds + normalBleeds;

  // --- ASSIGN ONCE ---
  if (bleedIsAuto || bleedBaseValue > 0) {
    mechanicalEffects["bleed"] = {
      critStacks: critBleeds,
      normalStacks: normalBleeds,
      chance: bleedIsAuto ? null : totalBleedChance,
      roll: bleedIsAuto ? null : bleedRollResult,
      rolls: {
        regular: regularBleedRolls,
        sharp: sharpBleedRolls,
      },
      auto: bleedIsAuto,
    };
  }

  // --- DISPLAY (unchanged logic, now consistent) ---
  let allBleedRollResults = "";
  if (mechanicalEffects["bleed"] || bleedChanceDisplay === "AUTO") {
    allBleedRollResults = `|Bleed: ${[
      ...regularBleedRolls,
      ...sharpBleedRolls,
    ].join("| |Sharp: ")}| < ${bleedChanceDisplay}% 
  <span title="Normal Bleed Applied: ${normalBleeds}
In total :(${totalBleeds}) due to Crit score: ${critScore}">
    ${normalBleeds}
    <i class="fa-regular fa-droplet fa-lg" style="color: #bd0000;"></i>
    (${totalBleeds})
  </span>`;
  }

  return {
    allBleedRollResults,
    effectsRollResults,
    mechanicalEffects,
  };
}

/**
 * Which temporary-HP pool a damage packet drains.
 *
 * **A packet is physical only if EVERY OR branch of its expression contains
 * the `physical` token.** If any branch lacks it the packet is magical and
 * bypasses physical temporary HP entirely.
 *
 * An OR branch is an *alternative* the attack can route through, so a ward
 * that only stops physical damage can be walked around; an AND chain is one
 * packet that must include `physical` to be stopped. This needs no damage-type
 * table: every weapon carries `physical AND <type>`, spells carry no
 * `physical` token, and an enchanted weapon is flattened to an OR chain by
 * basicAttack.mjs before it reaches here.
 *
 *   physical AND slash          → "physical"  (any weapon)
 *   magic AND fire              → "magical"   (fireball)
 *   physical OR slash OR magic  → "magical"   (enchanted weapon, bypasses)
 *
 * An empty/unknown expression is treated as physical: untyped damage should
 * still be stopped by the ordinary ward rather than silently bypassing it.
 *
 * @param {string[]} expression - damageProfile.expression tokens.
 * @returns {"physical"|"magical"}
 */
// Kinetic damage types that count as "physical" for shield matching and the
// physical/magical temporary-HP split. The `physical` keyword plus its three
// weapon sub-types — a mace (blunt), an arrow (piercing) and a sword (slash)
// are all physical, so a physical ward must stop them even when the expression
// names only the sub-type (e.g. "piercing", or "physical OR slash").
const PHYSICAL_DAMAGE_TYPES = new Set([
  "physical",
  "blunt",
  "piercing",
  "slash",
]);

export function classifyDamagePacket(expression) {
  const tokens = Array.isArray(expression) ? expression : [];
  if (!tokens.length) return "physical";

  // Split on "or" into AND-branches, mirroring evaluateDmgVsArmor step 6.
  const branches = [];
  let current = [];
  for (const token of tokens) {
    if (token === "or") {
      if (current.length) branches.push(current);
      current = [];
    } else if (token !== "and") {
      current.push(token);
    }
  }
  if (current.length) branches.push(current);
  if (!branches.length) return "physical";

  // Physical only when every OR-alternative is physical: a branch that carries
  // any kinetic type is physical, so "physical AND fire" stays physical while
  // "physical OR magic" (an alternative that is purely magical) bypasses.
  const branchIsPhysical = (b) => b.some((t) => PHYSICAL_DAMAGE_TYPES.has(t));
  return branches.every(branchIsPhysical) ? "physical" : "magical";
}

/**
 * The actor's active absorb pool, or null. Shields override one another
 * (EFFECT_OVERRIDES), so there is normally at most one; if a GM force-applies
 * several, the most specific wins — a typed pool (Elementární štít) before a
 * plain class pool, so the narrow one is not left unused.
 *
 * @param {Actor} actor
 * @returns {{effect: ActiveEffect, value: number, config: object}|null}
 */
export function getActiveShield(actor) {
  const found = [];
  for (const effect of actor?.effects ?? []) {
    const config = effect.getFlag?.("redsteel", "shield");
    if (!config) continue;
    const value = Number(effect.getFlag("redsteel", "stacks")) || 0;
    if (value <= 0) continue;
    found.push({ effect, value, config });
  }
  if (!found.length) return null;
  found.sort(
    (a, b) => (b.config.matchTypes?.length ?? 0) - (a.config.matchTypes?.length ?? 0),
  );
  return found[0];
}

/**
 * Whether a shield soaks this packet: its class matches, OR the packet carries
 * one of the shield's damage types regardless of class. The OR is what lets
 * Elementární štít stop both `physical AND fire` and `magic AND fire`
 * ("funguje proti magické i nemagické formě vybraného poškození").
 *
 * @param {object} config - flags.redsteel.shield
 * @param {"physical"|"magical"} damageClass
 * @param {string[]} expression - damageProfile.expression
 */
export function shieldAbsorbs(config, damageClass, expression) {
  if (!config) return false;
  if (config.matchClass && config.matchClass === damageClass) return true;
  const types = config.matchTypes ?? [];
  if (!types.length) return false;
  const tokens = Array.isArray(expression) ? expression : [];
  return types.some((t) => tokens.includes(t));
}

/**
 * How much of a hit a shield eats, and how much pool that costs.
 *
 * These differ only for `absorbFullHit` (Magický štít, "pohltí jednorázově i
 * větší zranění"): an oversized hit is absorbed **in full** and the shield
 * breaks, rather than spilling the excess through. The other two shields
 * absorb only what they have left.
 *
 * @returns {{damageAbsorbed: number, poolSpent: number}}
 */
export function resolveShieldAbsorb(config, pool, damage) {
  const available = Math.max(0, Number(pool) || 0);
  const incoming = Math.max(0, Number(damage) || 0);
  const poolSpent = Math.min(available, incoming);
  const damageAbsorbed = config?.absorbFullHit ? incoming : poolSpent;
  return { damageAbsorbed, poolSpent };
}

/**
 * Spend temporary HP then health.
 *
 * Temporary HP is two independent pools. `tempHp` is the PHYSICAL pool
 * (`system.stats.temporaryHealth`), `tempHpMagic` the magical one
 * (`system.stats.temporaryHealthMagic`); `damageClass` picks which one this
 * packet is allowed to touch. A packet never falls through from one pool to
 * the other — bypassing the physical ward is the whole point of magical
 * damage.
 *
 * @param {number} damage - Fully mitigated damage.
 * @param {number} hp
 * @param {number} tempHp - Physical temporary HP.
 * @param {number} [tempHpMagic] - Magical temporary HP.
 * @param {"physical"|"magical"} [damageClass]
 */
export function applyToHp(
  damage,
  hp,
  tempHp,
  tempHpMagic = 0,
  damageClass = "physical",
) {
  const magical = damageClass === "magical";
  const pool = magical ? Number(tempHpMagic) || 0 : Number(tempHp) || 0;

  const poolLoss = Math.min(pool, damage);
  damage -= poolLoss;

  const hpLoss = Math.min(hp, damage);

  // `tempHpLoss` stays the physical figure so existing callers and chat
  // output keep their meaning; the magical pool reports separately.
  const tempHpLoss = magical ? 0 : poolLoss;
  const tempHpMagicLoss = magical ? poolLoss : 0;

  return {
    finalDamage: damage,
    hpLoss,
    tempHpLoss,
    tempHpMagicLoss,
    damageClass,
    totalHpLoss: hpLoss + poolLoss,
    newHp: Math.max(hp - hpLoss, 0),
    newTempHp: (Number(tempHp) || 0) - tempHpLoss,
    newTempHpMagic: (Number(tempHpMagic) || 0) - tempHpMagicLoss,
  };
}

function getOffhandProps(weaponContext) {
  if (!weaponContext?.isDualWield || !weaponContext.offWeapon) {
    return null;
  }
  return weaponContext.offWeapon.system.offhandProperties ?? null;
}

function collectExtrasFromSource(systemMap, effectMap, collector) {
  if (!systemMap || !effectMap) return;

  for (let i = 1; i <= 3; i++) {
    const value = effectMap[`extra${i}`] ?? 0;

    if (value === 0) continue;

    const rawName = getEffectName(systemMap, effectMap, i);
    const name = rawName?.toLowerCase();
    if (!name || name.trim() === "") continue;

    collector.push({ name, value });
  }
}
// copypasted function from combatAbilities, will be fixed later
function buildDamageProfile(systemData) {
  if (!systemData) return { expression: [] };

  const raw = [
    systemData.dmgType1,
    systemData.bool2,
    systemData.dmgType2,
    systemData.bool3,
    systemData.dmgType3,
    systemData.bool4,
    systemData.dmgType4,
  ]
    .filter(Boolean)
    .map((e) => e.toLowerCase());

  return { expression: raw };
}

export function getActorCombatModifiers(actor, weapon = null) {
  const effects = actor.system.activeCombatEffects ?? {};
  const ws = weapon?.system ?? {};
  const isArchery = ws.class === "bow" || ws.class === "crossbow";
  const isMelee = !isArchery;

  let result = {
    damageBonus: 0,
    damageRolls: [],
    penetrationBonus: 0,
    critRangeBonus: 0,
    damageTypeMode: null,
    damageTypes: [],
    extraEffects: {},
  };

  for (const group of Object.values(effects)) {
    if (!group) continue;

    result.damageBonus += group.damageBonus ?? 0;

    // Melee-only / ranged-only flat damage, mirroring the penetration split
    // below. Starsign: Warrior grants melee damage, Starsign: Marksman ranged.
    // "Melee" here means anything that is not a bow or crossbow, so a thrown
    // weapon counts as melee — the same convention the penetration split uses.
    if (isMelee) result.damageBonus += group.meleeDamageBonus ?? 0;
    if (isArchery) result.damageBonus += group.rangedDamageBonus ?? 0;

    if (group.damageRoll) {
      result.damageRolls.push(group.damageRoll);
    }

    // Weapon crit range (S2): universal, feeds getCriticalRolls' crit-range
    // input alongside doctrine/ability contributions.
    result.critRangeBonus += group.critRangeBonus ?? 0;

    // Universal penetration
    result.penetrationBonus += group.penetrationBonus ?? 0;

    // Melee-only penetration
    if (isMelee) {
      result.penetrationBonus += group.meleePenetrationBonus ?? 0;
    }

    // Ranged-only penetration
    if (isArchery) {
      result.penetrationBonus += group.rangedPenetrationBonus ?? 0;
    }

    if (group.damageTypes?.length) {
      result.damageTypes.push(...group.damageTypes);
      result.damageTypeMode = group.damageTypeMode ?? result.damageTypeMode;
    }

    if (group.extraEffects) {
      for (const [k, v] of Object.entries(group.extraEffects)) {
        const key = k.toLowerCase();
        result.extraEffects[key] = (result.extraEffects[key] ?? 0) + v;
      }
    }
  }

  return result;
}

export function getWeaponSpecBonuses(actor, weapon) {
  const result = { attack: 0, critChance: 0, damageDice: 0, defense: 0, critDefense: 0 };
  if (!actor || !weapon) return result;
  const candidates = new Set();
  const addCandidate = (raw) => {
    const v = String(raw ?? "").trim().toLowerCase();
    if (!v) return;
    candidates.add(v);
    // Thrown and melee versions of one weapon are separate items sharing a base
    // name ("Javelin" / "Javelin melee"). Strip the " melee" suffix so a single
    // specialization covers both modes.
    if (v.endsWith(" melee")) candidates.add(v.slice(0, -6).trim());
  };
  String(weapon.system?.tags ?? "").split(",").forEach(addCandidate);
  addCandidate(weapon.name);
  addCandidate(weapon.localizedName);
  if (!candidates.size) return result;

  for (const item of actor.items) {
    if (item.type !== "feature") continue;
    const spec = item.system?.weaponSpec;
    if (!spec) continue;
    const tag = String(spec.tag ?? "").trim().toLowerCase();
    if (!tag || !candidates.has(tag)) continue;
    const tier = Number(spec.tier) || 0;
    if (tier === 1) {
      result.critDefense += 1;
      result.damageDice += 1;
    } else if (tier === 2) {
      result.attack += 5;
      result.defense += 5;
      result.critChance += 3;
      result.damageDice += 1;
    }
  }
  return result;
}

function getFreehandDice(actor) {
  const freehand = actor.system.freehand ?? {};

  let dice = 0;

  for (const value of Object.values(freehand)) {
    if (value === true) dice++;
  }

  return dice;
}

function qualifiesForFreehand(actor, weapon) {
  const combatData = actor.system.combat;
  const activeSetId = combatData?.activeWeaponSet;

  if (!activeSetId) return false;

  const activeSet = combatData.weaponSets?.[activeSetId];
  if (!activeSet) return false;

  // Offhand must be empty
  if (activeSet.off) return false;

  const ws = weapon?.system ?? {};

  // Two-handed weapons do NOT qualify
  if (ws.type === "heavy") return false;

  // Two-hand grip also blocks the bonus
  if (ws.gripMode === "two") return false;

  // No thrown weapons
  if (ws.thrown) return false;
  // bows and crossbows blocked too
  if (["crossbow", "bow"].includes(weapon?.system.class)) return false;

  return true;
}

function shieldEquipped(actor) {
  const combatData = actor.system.combat;
  const activeSetId = combatData?.activeWeaponSet;
  if (!activeSetId) return false;

  const activeSet = combatData.weaponSets?.[activeSetId];
  const offHandId = activeSet?.off;
  if (!offHandId) return false;

  const offHand = actor.items.get(offHandId);
  return !!offHand?.system?.shield;
}
function knifeMasterCheck(actor, weapon) {
  const ws = weapon?.system ?? {};

  return (
    ws.thrown === true &&
    ws.class === "sword" &&
    actor.system.knifemaster === true
  );
}

export function evaluateDmgVsArmor({
  damage,
  penetration,
  damageProfile = { expression: [] },
  armor,
  hp,
  tempHp,
  tempHpMagic = 0,
  halfDamage = false,
  shield = 0,
  penCap = false,
  ignoreBaseArmor = false,
}) {
  const { expression } = damageProfile;
  const armorTable = armor ?? {};
  const damageClass = classifyDamagePacket(expression);

  /* 1️. Shields — spent before armor, on raw damage.
     `shield` is either a plain number (legacy/manual) or
     {value, config} from getActiveShield. A typed shield only soaks packets
     it matches; a non-matching shield is left untouched. */
  let baseDamage = damage;
  const shieldPool =
    typeof shield === "number" ? shield : (Number(shield?.value) || 0);
  const shieldConfig = typeof shield === "number" ? null : (shield?.config ?? null);
  const shieldApplies =
    shieldPool > 0 &&
    (!shieldConfig || shieldAbsorbs(shieldConfig, damageClass, expression));

  const { damageAbsorbed, poolSpent } = shieldApplies
    ? resolveShieldAbsorb(shieldConfig, shieldPool, baseDamage)
    : { damageAbsorbed: 0, poolSpent: 0 };

  baseDamage -= damageAbsorbed;
  // `shieldLoss` keeps its original meaning (damage removed) for existing
  // callers and chat output; `shieldPoolSpent` is what the effect loses.
  const shieldLoss = damageAbsorbed;
  // What the shield let through. The penetration floor is capped by this so it
  // cannot restore absorbed damage (step 3).
  const damageAfterShield = Math.max(0, baseDamage);

  /* 2. Normal Armor (skipped e.g. for condition damage ticks, which are
     only mitigated by specialized armor / resistances / vulnerabilities) */
  if (!ignoreBaseArmor) {
    const normalArmor = armorTable?.total ?? 0;
    baseDamage = Math.max(baseDamage - normalArmor, 0);
  }

  /* 3. Penetration Floor
     Capped by what actually survived the shield, not the raw damage.
     Penetration bypasses ARMOR, not an absorb pool — flooring against the
     original number would resurrect damage a shield had already eaten (a
     30-damage pen-12 bolt fully absorbed by a Magic Shield still dealt 12).
     With no shield `damageAfterShield === damage`, so this is unchanged. */
  const effectivePenetration = Math.min(penetration ?? 0, damageAfterShield);
  if (penCap) {
    baseDamage = Math.min(baseDamage, effectivePenetration);
  } else {
    baseDamage = Math.max(baseDamage, effectivePenetration);
  }

  /* 4. Specialized Armor Reduction */
  let specializedReduction = 0;

  for (const token of expression) {
    if (token === "and" || token === "or") continue;

    const typeArmor = armorTable?.[token]?.total ?? 0;

    // Option B (recommended): take highest protection
    specializedReduction = Math.max(specializedReduction, typeArmor);
  }

  baseDamage = Math.max(baseDamage - specializedReduction, 0);

  /* 5. Build damage type modifiers */
  const modifiers = {};

  for (const token of expression) {
    if (token === "and" || token === "or") continue;

    let modifier = 1;

    if (armorTable?.[token]?.immunity) {
      modifier = 0;
    } else {
      if (armorTable?.[token]?.resistance) {
        modifier *= 0.5;
      }

      if (armorTable?.[token]?.vulnerability) {
        modifier *= 1.5;
      }
    }

    modifiers[token] = modifier;
  }

  /* 6. Split into OR branches */
  const branches = [];
  let currentBranch = [];

  for (const token of expression) {
    if (token === "or") {
      if (currentBranch.length > 0) {
        branches.push(currentBranch);
        currentBranch = [];
      }
    } else if (token !== "and") {
      currentBranch.push(token);
    }
  }

  if (currentBranch.length > 0) {
    branches.push(currentBranch);
  }

  /* 7. Multiply modifiers inside each AND branch */
  const branchResults = branches.map((branch) =>
    branch.reduce((product, token) => {
      return product * (modifiers[token] ?? 1);
    }, 1),
  );

  /* 8. OR chooses highest branch */
  const finalModifier =
    branchResults.length > 0 ? Math.max(...branchResults) : 1;

  /* 9. Apply modifier to base damage */
  let finalDamage = Math.floor(baseDamage * finalModifier);

  /* 10. External half damage */
  if (halfDamage) {
    finalDamage = Math.floor(finalDamage * 0.5);
  }

  /* 11. Apply to HP — physical or magical temporary HP per the expression */
  return {
    shieldLoss,
    shieldPoolSpent: poolSpent,
    shieldBroke: shieldApplies && poolSpent >= shieldPool,
    ...applyToHp(finalDamage, hp, tempHp, tempHpMagic, damageClass),
  };
}
