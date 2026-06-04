import { getTraitPills } from "./traitPills.mjs";

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

  const weapons = actor.items.filter(weaponFilter);

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
        concatDescription += `<b>${mod.localizedName ?? mod.name}</b><br>${mod.system.description}`;
      }
    }

    let attributeTestHTML = "";

    for (const mod of selectedModifiers) {
      const testName = mod.system.attributeTest;
      const testModifier = Number(mod.system.testModifier) || 0;

      if (!testName || testName === "-- Select a Type --") continue;

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
      const attributeRoll = new Roll(`(${attributeTotalValue}) - 1d100`);

      await attributeRoll.evaluate({ async: true });

      attributeTestHTML += `
    
    <tr>
    <hr>
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
    const penetration =
      mainPen + offPen + customPenetration + actorMods.penetrationBonus;
    const totalDoctrineBonus = doctrine.doctrineBonus;
    const totalDoctrineCritBonus =
      doctrine.doctrineCritBonus + customCritChance;
    const totalCritRangeBonus =
      doctrine.doctrineCritRangeBonus + customCritRange;
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
    } = attackData;

    // ─── Damage Roll ───
    const { damageRoll, damageTotal, breakthroughRollResult } =
      await game.redsteel.getDamageRolls(
        actor,
        weapon,
        resolvedContext,
        customDamage,
        customBreakthrough,
      );
    const hasBreakthrough =
      showBreakthrough &&
      typeof breakthroughRollResult === "string" &&
      breakthroughRollResult.trim() !== "";
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
      selectedModifiers,
    );

    const { allBleedRollResults, effectsRollResults, mechanicalEffects } =
      effects;
    // ─── Damage Line ───
    const damageLine = `
<div style="
  display:grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
  font-size:16px;
  max-width: fit-content;
  margin: 0 auto;
" class="combat-grid">

  <div style="display:grid; grid-template-columns:auto 1fr; column-gap:8px;">
    <div>Damage:</div><div style="text-align:center;">${damageTotal}</div>
    <div>Penetration:</div><div style="text-align:center;">${penetration}</div>
${
  hasBreakthrough
    ? `
      <div>Breakthrough:</div>
      <div style="text-align:center;">
        ${breakthroughRollResult}
      </div>
    `
    : `
      <div>&nbsp;</div>
      <div>&nbsp;</div>
    `
}
  </div>

  <div style="display:grid; grid-template-columns:auto 1fr; column-gap:8px;">
    <div>Crit Dmg:</div><div style="text-align:center;">${critDamageTotal}</div>
    <div>Crit Pen:</div><div style="text-align:center;">${critBonusPenetration}</div>
    <div>Crit score:</div>
    <div style="text-align:center;">
      <span title="Crit range result ${critScoreResult}"
        style="text-decoration:underline dotted; cursor:help;">
        [ ${critScore} ]
      </span>
    </div>
  </div>
</div>
<hr>
`;

    const attackHTML = await attackRoll.render();
    const damageHTML = await damageRoll.render();
    const modifierLabel = selectedModifiers.length
      ? ` + ${selectedModifiers.map((m) => m.localizedName ?? m.name).join(", ")}`
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
      rolls: [attackRoll, damageRoll],
      flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${weapon.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">${resolvedFlavor}${modifierLabel}</strong>
</span>
<div style="text-align:center; font-size:16px;">
  ${concatDescription}
  ${attributeTestHTML}
 </div>
 <hr>


<p style="text-align:center; font-size:20px;">
  <b>${critSuccess ? "Critical Success!" : critFailure ? "Critical Failure!" : ""}</b>
</p>
 <hr>
${damageLine}

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
