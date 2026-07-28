import { getTraitPills } from "./traitPills.mjs";
import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";
import { AIMED_PARTS } from "./aimedStrike.mjs";
import { getImprovedAimPenetration } from "./aim.mjs";
import { getAttackRerollTokens } from "./rerolls.mjs";
import { buildBanePacket } from "./baneCombat.mjs";
import { renderDamageLine } from "./damageLine.mjs";
import { hasHtmlContent } from "./chatBlocks.mjs";
import { appendHeavyWeaponDamage } from "./weaponResolver.mjs";
import {
  isSpeedTest,
  rollSpeedTest,
  renderSpeedTestLine,
} from "./speedTest.mjs";

export async function universalAttackLogic({
  attackType,
  weaponFilter,
  getWeaponSkillData = null,
  flavorLabel,
  showBreakthrough = false,
  context: preResolvedContext = null,
  selectedModifiers = [],
  longReachPenalty = 0,
}) {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;

  // Weapons assigned to the off hand (NPCs) are consumed automatically as the
  // off-hand weapon and must not be offered as the attacking weapon.
  const weapons = actor.items.filter(
    (i) => weaponFilter(i) && !(actor.type === "npc" && i.system.npcOffhand),
  );

  if (!weapons.length) {
    ui.notifications.warn(`This actor has no ${attackType} weapons.`);
    return;
  }

  const weaponChoices = weapons.map((weapon, index) => ({
    label: weapon.localizedName ?? weapon.name,
    value: index,
  }));
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

  function resolveDamageProfile(
    weapon,
    ability = null,
    selectedModifiers = [],
    actor = null,
  ) {
    const weaponProfile = buildDamageProfile(weapon?.system);
    const abilityProfile = buildDamageProfile(ability?.system);

    // Modifier authority (highest)
    for (const mod of selectedModifiers) {
      const modProfile = buildDamageProfile(mod.system);
      if (modProfile.expression.length > 0) {
        return modProfile;
      }
    }

    // ACTOR ENCHANT OVERRIDE
    if (actor) {
      const actorMods = game.redsteel.getActorCombatModifiers(actor);
      console.log("Actor enchant mods:", actorMods);
      if (actorMods?.damageTypes?.length) {
        const baseExpression = weaponProfile.expression ?? [];

        const baseTypes = baseExpression.filter(
          (t) => t !== "and" && t !== "or",
        );
        const enchantTypes = actorMods.damageTypes.map((t) => t.toLowerCase());
        let finalTypes;
        if (actorMods.damageTypeMode === "override") {
          finalTypes = enchantTypes;
        } else {
          // default to expand
          finalTypes = [...baseTypes];
          for (const type of enchantTypes) {
            if (!finalTypes.includes(type)) {
              finalTypes.push(type);
            }
          }
        }

        // Always convert to OR chain
        const newExpression = [];
        finalTypes.forEach((type, index) => {
          if (index > 0) newExpression.push("or");
          newExpression.push(type);
        });

        return { expression: newExpression };
      }
    }

    // Ability authority
    if (abilityProfile.expression.length > 0) {
      return abilityProfile;
    }

    // Weapon fallback
    return weaponProfile;
  }

  const handleWeaponSelection = async (weaponIndex) => {
    let customAttack = 0;
    let customDamage = "";
    let customBreakthrough = "";
    let customPenetration = 0;
    let customCritRange = 0;
    let customCritChance = 0;
    let concatDescription = "";
    let halfDamage = false;
    let penCap = false;

    for (const mod of selectedModifiers) {
      if (mod.system?.roll?.halfDamage) {
        halfDamage = true;
      }
    }
    for (const mod of selectedModifiers) {
      if (mod.system?.roll?.penCap) {
        penCap = true;
      }
    }
    for (const mod of selectedModifiers) {
      if (mod.system.description) {
        if (concatDescription) concatDescription += "<br>";
        concatDescription += `<b>${mod.localizedName ?? mod.name}</b><br>${mod.system.description}`;
      }
    }

    let attributeTestHTML = "";

    for (const mod of selectedModifiers) {
      const testName = mod.system.attributeTest;
      const testModifier = Number(mod.system.testModifier) || 0;

      if (!testName || testName === "-- Select a Type --") continue;

      // Speed test: d12 + Initiative (+ Speed), higher is better.
      if (isSpeedTest(testName)) {
        const speedRoll = await rollSpeedTest(actor, { modifier: testModifier });
        attributeTestHTML += `
    <tr>
    <td>
    <span style="display:inline-block;">
    <b>${mod.localizedName ?? mod.name}</b><br>
    ${renderSpeedTestLine({
      actor,
      roll: speedRoll,
      source: mod.localizedName ?? mod.name,
      modifier: testModifier,
    })}
    </span>
    </td>
    </tr>
  `;
        continue;
      }

      const attributeMap = {
        strength: "str",
        endurance: "end",
        dexterity: "dex",
        intelligence: "int",
        wisdom: "wis",
        charisma: "cha",
      };

      const shortKey = attributeMap[testName.toLowerCase()] ?? testName;

      let attributeValue = actor.system.attributes[shortKey]?.mod ?? 0;

      if (actor.type === "npc") {
        attributeValue = actor.system.attributes[shortKey]?.value ?? 0;
      }
      const attributeTotalValue = attributeValue + testModifier;
      const attributeRoll = new Roll(
        `(${attributeTotalValue}) - 1d100`,
        withRollBias({}, actor),
      );
      tagRollSkill(attributeRoll, shortKey);

      await attributeRoll.evaluate({ async: true });

      attributeTestHTML += `

    <tr>
    <td>
    <span
    title="Test chance ${attributeTotalValue}%&#10;Rolled: ${attributeRoll.result}"
    style="display:inline-block;">
    <b>${mod.localizedName ?? mod.name} — ${testName} Test ${attributeTotalValue}%</b><br>
    Margin of Success: [${attributeRoll.total}]<br>
      </span>
    </td>
    </tr>
    
 
  `;
    }

    for (const mod of selectedModifiers) {
      customAttack += Number(mod.system.attack) || 0;
      customBreakthrough += Number(mod.system.breakthrough) || 0;
      customPenetration += Number(mod.system.penetration) || 0;
      customCritRange += Number(mod.system.critRange) || 0;
      customCritChance += Number(mod.system.critChance) || 0;
      const modDamage = mod.system.roll?.diceBonusFormula;
      if (modDamage) {
        customDamage = customDamage
          ? `(${customDamage}) + (${modDamage})`
          : modDamage;
      }
    }
    const weapon = weapons[weaponIndex];
    // Conditional dice that only land with a Heavy weapon.
    customDamage = appendHeavyWeaponDamage(
      customDamage,
      weapon,
      selectedModifiers,
    );
    // ─── AMMO CHECK ───
    const ammoOption = actor.getRequiredAmmoOption(weapon);
    let ammo = null;

    if (ammoOption) {
      ammo = actor.getEquippedAmmo(ammoOption);

      if (!ammo) {
        ui.notifications.warn(`No equipped ${ammoOption}!`);
        return;
      }

      if ((ammo.system.quantity ?? 0) <= 0) {
        ui.notifications.warn(`Out of ${ammoOption}!`);
        return;
      }
    }
    console.log(
      "Raw damage fields:",
      weapon.system.dmgType1,
      weapon.system.bool2,
      weapon.system.dmgType2,
      weapon.system.bool3,
      weapon.system.dmgType3,
      weapon.system.bool4,
      weapon.system.dmgType4,
    );
    const damageProfile = resolveDamageProfile(
      weapon,
      null, // no ability layer here
      selectedModifiers,
      actor,
    );

    const resolvedFlavor =
      typeof flavorLabel === "function" ? flavorLabel(weapon) : flavorLabel;

    const resolvedContext =
      preResolvedContext ??
      game.redsteel.resolveWeaponContext(actor, null, weapon);

    if (!resolvedContext) return;

    const doctrine = await game.redsteel.getDoctrineBonuses(actor, weapon);

    const skillData = getWeaponSkillData
      ? await getWeaponSkillData(actor, weapon, resolvedContext)
      : {};

    const weaponSkillEffect = Number(skillData.weaponSkillEffect) || 0;
    const weaponSkillCrit = Number(skillData.weaponSkillCrit) || 0;
    const weaponSkillCritDmg = Number(skillData.weaponSkillCritDmg) || 0;
    const weaponSkillCritPen = Number(skillData.weaponSkillCritPen) || 0;

    const mainPen = Number(weapon.system.penetration) || 0;
    const offPen = resolvedContext?.isDualWield
      ? Number(
          resolvedContext.offWeapon?.system?.offhandProperties?.penetration,
        ) || 0
      : 0;
    const actorMods = game.redsteel.getActorCombatModifiers(actor, weapon);
    // Improved Aim: read before getAttackRolls consumes the aim flag.
    const improvedAimPen = getImprovedAimPenetration(
      actor,
      weapon,
      resolvedContext,
    );
    const penetration =
      mainPen +
      offPen +
      customPenetration +
      actorMods.penetrationBonus +
      improvedAimPen;
    const totalDoctrineBonus = doctrine.doctrineBonus;
    const totalDoctrineCritBonus =
      doctrine.doctrineCritBonus + customCritChance;
    const totalCritRangeBonus =
      doctrine.doctrineCritRangeBonus + customCritRange + actorMods.critRangeBonus;
    // ─── Attack Roll ───
    const attackData = await game.redsteel.getAttackRolls(
      actor,
      weapon,
      totalDoctrineBonus,
      totalDoctrineCritBonus,
      weaponSkillCrit,
      customAttack,
      resolvedContext,
      0,
      longReachPenalty,
    );

    const {
      attackRoll,
      critSuccess,
      critFailure,
      rollName,
      criticalSuccessThreshold,
      criticalFailureThreshold,
      aimedPart,
    } = attackData;
    const aimedPartDef = aimedPart ? AIMED_PARTS[aimedPart] : null;
    if (aimedPartDef) {
      if (concatDescription) concatDescription += "<br>";
      concatDescription += `Aimed attack: ${aimedPartDef.label}`;
    }

    // ─── Damage Roll ───
    const { damageRoll, damageTotal, breakthroughRollResult } =
      await game.redsteel.getDamageRolls(
        actor,
        weapon,
        resolvedContext,
        customDamage,
        customBreakthrough,
      );
    // ─── Critical Roll ───
    const critData = await game.redsteel.getCriticalRolls(
      actor,
      weapon,
      resolvedContext,
      totalCritRangeBonus,
      attackRoll,
      weaponSkillCritDmg,
      weaponSkillCritPen,
      damageTotal,
      penetration,
      doctrine.doctrineCritDmg,
      doctrine.doctrineSkillCritPen,
    );

    const {
      critScore,
      critScoreResult,
      critBonusPenetration,
      critDamageTotal,
      criticalOptions,
    } = critData;

    // ─── Effects Roll ───
    // Head aimed attack injects stagger +20% and precision +10% as a synthetic
    // modifier so both bonuses appear in the roll results and chat message.
    const effectModifiers = aimedPart === "head"
      ? [...selectedModifiers, {
          system: {
            effectType1: "stagger",
            effectType2: "precision",
            effects: { extra1: AIMED_PARTS.head.staggerBonus, extra2: AIMED_PARTS.head.precisionBonus },
          },
        }]
      : selectedModifiers;

    const effects = await game.redsteel.getEffectRolls(
      actor,
      weapon,
      resolvedContext,
      doctrine.doctrineBleedBonus,
      doctrine.doctrineStaggerBonus,
      weaponSkillEffect,
      critScore,
      critSuccess,
      null, // no ability
      effectModifiers,
    );

    const { allBleedRollResults, effectsRollResults, mechanicalEffects } =
      effects;

    // ─── Bane ("Metla") packet ───
    // A second reading of the same dice: never re-roll the attack or crit
    // range roll, only re-bucket them under the attacker's Bane bonuses. The
    // only new randomness is the bonus damage die, rolled exactly once.
    const { packet: banePacket, roll: baneDamageRoll } = await buildBanePacket({
      actor,
      attackRoll,
      criticalSuccessThreshold,
      critScoreResult,
      criticalOptions,
      damageTotal,
      penetration,
      breakthroughRollResult,
      halfDamage,
      penCap,
      baseCritSuccess: critSuccess,
    });

    // ─── Damage Line ───
    const damageLine = renderDamageLine({
      damage: damageTotal,
      penetration,
      breakthrough: breakthroughRollResult,
      critDamage: critDamageTotal,
      critPenetration: critBonusPenetration,
      critScore,
      critScoreResult,
      showBreakthrough,
    });

    const attackHTML = await attackRoll.render();
    const damageHTML = await damageRoll.render();
    const modifierLabel = selectedModifiers.length
      ? ` + ${selectedModifiers.map((m) => m.localizedName ?? m.name).join(", ")}`
      : "";

    // Crit banner carries its own trailing separator, so an ordinary hit doesn't
    // leave an empty paragraph sandwiched between two rules.
    const critLabel = critSuccess
      ? "Critical Success!"
      : critFailure
        ? "Critical Failure!"
        : "";
    const critBanner = critLabel
      ? `<p style="text-align:center; font-size:20px;"><b>${critLabel}</b></p>
 <hr>`
      : "";

    // Skip the Description table entirely when there is nothing to put in it.
    const hasDescription = hasHtmlContent(concatDescription);
    const descriptionTable =
      hasDescription || attributeTestHTML.trim()
        ? `
<div style="text-align:center; font-size:16px;">
<table style="width:100%; text-align:center; font-size:16px;">
  ${hasDescription ? `<tr><th>Description</th></tr>\n  <tr><td>${concatDescription}</td></tr>` : ""}
  ${attributeTestHTML}
</table>
 </div>`
        : "";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content: `
<div class="dual-roll">
  <div class="roll-column">
    <div class="roll-label">Margin of Success</div>
    ${attackHTML}
  </div>
  <div class="roll-column">
    <div class="roll-label">Damage Roll</div>
    ${damageHTML}
  </div>
</div>
`,
      rolls: banePacket ? [attackRoll, damageRoll, baneDamageRoll] : [attackRoll, damageRoll],
      flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${weapon.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">${resolvedFlavor}${modifierLabel}</strong>
</span>
 <hr>
${critBanner}
<div class="rs-attack-face" data-face-normal>${damageLine}</div>
<hr>
${descriptionTable}

<table style="width:100%; text-align:center; font-size:15px;">
  <tr><th>Effects</th></tr>
  <tr>
    <td><b>${allBleedRollResults}</b> ${effectsRollResults}</td>
  </tr>
</table>

`,
      flags: {
        redsteel: {
          rollName,
          criticalSuccessThreshold,
          criticalFailureThreshold,
          traitPills: getTraitPills(actor, "attack"),
          rerollTokens: getAttackRerollTokens(actor, weapon),
        },
        attack: {
          type: "attack",
          damageProfile,
          effects: mechanicalEffects,
          aimedStrike: aimedPart
            ? { part: aimedPart, su: attackRoll.total }
            : null,
          normal: {
            damage: damageTotal,
            penetration: penetration,
            halfDamage: halfDamage,
            penCap: penCap,
          },

          critical: {
            damage: critDamageTotal,
            penetration: critBonusPenetration,
            halfDamage: halfDamage,
            penCap: penCap,
            degree: critScore,
            result: critScoreResult,
            options: criticalOptions,
          },
          breakthrough: {
            damage: breakthroughRollResult,
            penetration: penetration,
            halfDamage: halfDamage,
            penCap: penCap,
          },
          bane: banePacket,
        },
      },
    });
    if (ammo) {
      await actor.deductAmmo(ammo);
    }
  };

  if (preResolvedContext?.weapon) {
    const index = weapons.findIndex(
      (w) => w.id === preResolvedContext.weapon.id,
    );
    if (index !== -1) {
      return handleWeaponSelection(index);
    }
  }

  // ─── CSS ───
  const style = document.createElement("style");
  style.textContent = `
#weapon-list .weapon-choice { font-size:16px; color:black; }
#weapon-list .weapon-choice:hover { text-shadow:0 0 2px red; }
.weapon-dialog .window-content { max-width:300px; }
`;
  document.head.appendChild(style);

  new Dialog({
    title: "Select Weapon",
    content: `
<ul id="weapon-list" style="list-style:none; padding:0;">
${weaponChoices
  .map(
    (c) => `
<li class="weapon-choice" data-value="${c.value}"
  style="cursor:pointer; padding:5px; border-bottom:1px solid #444;">
  ${c.label}
</li>`,
  )
  .join("")}
</ul>
`,
    buttons: {},
    render: (html) => {
      html.find("#weapon-list li").each((_, el) => {
        el.addEventListener("click", () =>
          handleWeaponSelection(Number(el.dataset.value)),
        );
      });
    },
  }).render(true);
}

export async function rangedAttack(options = {}) {
  return universalAttackLogic({
    attackType: "ranged",
    flavorLabel: (weapon) =>
      `Ranged attack with ${weapon.localizedName ?? weapon.name}`,
    showBreakthrough: false,
    weaponFilter: (i) =>
      i.type === "weapon" && ["bow", "crossbow"].includes(i.system.class),
    context: options.context ?? null,
    selectedModifiers: options.selectedModifiers ?? [],
  });
}

export async function throwingAttack(options = {}) {
  return universalAttackLogic({
    attackType: "throwing",
    flavorLabel: (weapon) =>
      `Throwing attack with ${weapon.localizedName ?? weapon.name}`,
    showBreakthrough: true,
    weaponFilter: (i) => i.type === "weapon" && i.system.thrown === true,
    getWeaponSkillData: (actor, weapon) =>
      game.redsteel.getWeaponSkillBonuses(actor, weapon),
    context: options.context ?? null,
    selectedModifiers: options.selectedModifiers ?? [],
  });
}

export async function meleeAttack(options = {}) {
  return universalAttackLogic({
    attackType: "melee",
    flavorLabel: (weapon) =>
      `Melee attack with ${weapon.localizedName ?? weapon.name}`,
    showBreakthrough: true,
    weaponFilter: (i) =>
      i.type === "weapon" &&
      ["axe", "sword", "blunt", "polearm"].includes(i.system.class) &&
      i.system.thrown !== true,
    getWeaponSkillData: (actor, weapon) =>
      game.redsteel.getWeaponSkillBonuses(actor, weapon),
    context: options.context ?? null,
    selectedModifiers: options.selectedModifiers ?? [],
    longReachPenalty: options.longReachPenalty ?? 0,
  });
}
