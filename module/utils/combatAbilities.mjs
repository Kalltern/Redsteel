export async function combatAbilities() {
  // ====================================================================
  // 1. INITIAL SETUP AND FILTERING
  // ====================================================================
  let lockedMultiAttackAbility = null;
  let multiAttackCount = 1;
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;

  // Collect all relevant abilities: (type: ability) AND (type: melee OR class: defense)
  const allAbilities = actor.items.filter((i) => i.type === "ability");

  const modifierAbilities = allAbilities.filter(
    (a) => a.system.modifiesAttack === true,
  );

  const abilities = allAbilities.filter(
    (a) =>
      !a.system.modifiesAttack &&
      (["melee", "ranged", "other"].includes(a.system.type) ||
        a.system.class === "defense"),
  );

  const ABILITY_TABS = [
    { id: "melee", label: "Melee" },
    { id: "ranged", label: "Ranged" },
    { id: "other", label: "Other" },
  ];

  function getAbilityCategory(ability) {
    if (ability.system.type === "ranged") return "ranged";
    if (ability.system.type === "other") return "other";
    if (ability.system.type === "melee" || ability.system.class === "defense") {
      return "melee";
    }
    return null;
  }

  const abilitiesByCategory = {
    melee: [],
    ranged: [],
    other: [],
  };

  for (const ability of abilities) {
    const category = getAbilityCategory(ability);
    if (category && abilitiesByCategory[category]) {
      abilitiesByCategory[category].push(ability);
    }
  }

  let tabHeadersHtml = "";
  let tabContentHtml = "";

  for (const tab of ABILITY_TABS) {
    const list = abilitiesByCategory[tab.id];
    if (!list.length) continue;

    tabHeadersHtml += `
    <div class="tab-item" data-tab="${tab.id}">
      ${tab.label} (${list.length})
    </div>
  `;

    const abilityListHtml = list
      .map(
        (ability) => `
      <li class="spell-choice ability-choice"
          data-ability-id="${ability.id}">
        <img src="${ability.img}"
             class="ability-icon">
        <span class="ability-name">
          ${ability.name}
        </span>
      </li>
    `,
      )
      .join("");

    tabContentHtml += `
    <div class="tab-pane" data-tab="${tab.id}">
      <ul style="list-style:none; padding:0;">
        ${abilityListHtml}
      </ul>
    </div>
  `;
  }

  if (!abilities.length)
    return ui.notifications.warn(
      `No combat or defense abilities found on ${actor.name}.`,
    );

  // ====================================================================
  // 2. CSS INJECTION
  // ====================================================================

  if (!document.getElementById("redsteel-ability-dialog-styles")) {
    const css = `
        .ability-dialog .window-content { max-width: 300px; width: 100%; height: auto; }
        .ability-dialog .window { width: auto; height: auto; }
        #keep-open-container { margin-bottom: 8px; font-size: 14px; }
        #keep-open { margin-right: 5px; }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.id = "redsteel-ability-dialog-styles";
    styleSheet.type = "text/css";
    styleSheet.innerText = css;
    document.head.appendChild(styleSheet);
  }

  const abilityChoices = abilities.map((a, idx) => ({
    label: a.name,
    value: idx,
  }));

  // ====================================================================
  // 3. EXECUTION HANDLER: _onAbilityChosen
  // ====================================================================

  async function onAbilityChosen(ability, container, dialog, actor) {
    const html = $(container);
    const longReachPenalty = container.querySelector(
      '[name="longReachPenalty"]',
    )?.checked
      ? -5
      : 0;
    const aimValue =
      parseInt(html.find('input[name="aim"]:checked').val()) || 0;

    const useSneak = html.find('[name="sneakAttack"]').is(":checked");
    const useFlanking = html.find('[name="flanking"]').is(":checked");
    const selectedModifierIds = Array.from(
      container.querySelectorAll(".attack-modifier-checkbox:checked"),
    ).map((cb) => cb.dataset.abilityId);

    const selectedModifiers = modifierAbilities.filter((mod) =>
      selectedModifierIds.includes(mod.id),
    );
    const intent = {
      aim: aimValue,
      sneak: useSneak,
      flanking: useFlanking,
      modifiers: selectedModifiers,
      longReachPenalty,
    };
    const isDefenseRoll = ability.system.class === "defense";
    const keepOpen = container.querySelector("#keep-open")?.checked;

    let paid;

    if (ability.system.class === "stance") {
      const key = ability.system.key;

      if (!key) {
        ui.notifications.warn("Stance missing key.");
        return;
      }

      const existing = actor.effects.find((e) => e.statuses?.has(key));

      // Turning OFF → free
      if (existing) {
        await existing.delete();
        return;
      }

      // Turning ON → cost will be paid
    }

    if (lockedMultiAttackAbility?.id === ability.id) {
      // Already in multiattack mode → only pay modifiers
      paid = await game.redsteel.deductAbilityCost(actor, selectedModifiers);
    } else {
      // First strike (or normal ability)
      paid = await game.redsteel.deductAbilityCost(actor, [
        ability,
        ...selectedModifiers,
      ]);
    }
    if (!paid) return;
    if (ability.system.class === "stance") {
      await game.redsteel.applyEffect(actor, ability.system.key);
      return;
    }
    const isStandalone = ability.system.standalone;
    if (ability.system.type === "other") {
      await runUtilityAbility(actor, ability, selectedModifiers);

      if (!keepOpen) dialog.close();
      return;
    } else if (isStandalone) {
      console.warn("STANDALONE BRANCH HIT:", ability.name);

      await updateCombatFlags(actor, intent);

      await runAttackMacro(
        actor,
        null,
        ability,
        selectedModifiers,
        ability.system.roll.diceBonusFormula || 0,
        ability.system.attack || 0,
        ability.system.breakthrough || 0,
        ability.system.penetration || 0,
        ability.system.attributeTest || 0,
        ability.system.testModifier || 0,
        ability.system.critRange || 0,
        ability.system.critChance || 0,
        ability.system.critFail || 0,
        ability.system.roll.halfDamage || false,
        ability.system.roll.penCap || false,
      );
    } else if (isDefenseRoll || ability.system.weaponAbility) {
      const mode = isDefenseRoll ? "defense" : "attack";
      await weaponSelectionFlow(actor, ability, mode, intent);
    } else {
      await game.redsteel.getNonWeaponAbility(actor, ability);
    }
    function transformDialogToMultiAttackMode(dialog, ability) {
      const html = dialog.element;

      // Remove ability list
      html.find(".ability-tabs").remove();
      // Hide Keep Open checkbox
      html.find("#keep-open-container").hide();

      // Add header + buttons
      html.find(".ability-dialog-form").prepend(`
    <div class="multiattack-header">
      <h3>⚔ Multi-Attack: ${ability.name} (Strike ${multiAttackCount})</h3>
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <button type="button" id="continue-multiattack">
          ⚔ Attack Again
        </button>
      </div>
      <hr>
    </div>
  `);

      // Continue attack
      html.find("#continue-multiattack").click(async () => {
        multiAttackCount++;
        await onAbilityChosen(
          ability,
          html.find(".ability-dialog-form")[0],
          dialog,
          ability.parent,
        );
      });
    }

    if (
      ability.system.multiAttack &&
      actor.type === "character" &&
      !lockedMultiAttackAbility
    ) {
      lockedMultiAttackAbility = ability;
      transformDialogToMultiAttackMode(abilityDialog, ability, actor);

      return;
    }
    const isMultiContinuation =
      lockedMultiAttackAbility && lockedMultiAttackAbility.id === ability.id;
    if (!keepOpen && !isMultiContinuation) {
      dialog.close();
    }
  }

  // ====================================================================
  // 4. MAIN DIALOG (Unified List)
  // ====================================================================
  const isCharacter = actor.type === "character";
  const hasActiveSet = isCharacter && actor.system.combat?.activeWeaponSet;

  const activeSetPreview = hasActiveSet
    ? renderWeaponLoadoutsDialog(actor)
    : "";

  let hasLongReach = false;

  const contextWeapon = game.redsteel.resolveWeaponContext(actor);
  const activeWeapon = contextWeapon?.weapon;

  if (activeWeapon?.system?.longReach) {
    hasLongReach = true;
  } else if (actor.type !== "character") {
    hasLongReach = actor.items.some(
      (i) => i.type === "weapon" && i.system?.longReach,
    );
  }
  const modifierCheckboxHtml = modifierAbilities
    .map(
      (mod) => `
<label class="pill">
  <input type="checkbox"
         class="attack-modifier-checkbox"
         data-ability-id="${mod.id}" />
  <span>${mod.name}</span>
</label>
  `,
    )
    .join("");
  const keepOpen = game.settings.get("redsteel", "keepAbilityDialogOpen");

  let abilityDialog = new Dialog({
    title: `Choose Combat or Defense Ability`,
    content: `
    <div id="keep-open-container">
      <label>
        <input type="checkbox" id="keep-open" ${keepOpen ? "checked" : ""}>
        Keep this window open
      </label>
    </div>
    <form class="ability-dialog-form">

  ${activeSetPreview}

  ${activeSetPreview ? "<hr>" : ""}

  <div class="form-group">
  <label>Aim:</label><br>
  <div id="aim-selector">
    ${[0, 1, 2, 3, 4]
      .map(
        (n) => `
      <input type="radio" name="aim" value="${n}" ${n === 0 ? "checked" : ""}>
      <label class="aim-dot">${n === 0 ? "–" : n}</label>
    `,
      )
      .join("")}
  </div>
</div>

<div class="form-group">
<div class="form-group attack-options-row">
  <label class="pill">
    <input type="checkbox" name="sneakAttack" />
    <span>Sneak Attack</span>
  </label>

  <label class="pill">
    <input type="checkbox" name="flanking" />
    <span>Flanking</span>
  </label>

  ${
    hasLongReach
      ? `
  <label class="pill penalty" title="Penalty of -5 applies for close combat">
    <input type="checkbox" name="longReachPenalty" />
    <span>Polearm penalty</span>
  </label>
`
      : ""
  }
</div>


</div>
<div class="attack-modifiers">
  ${modifierCheckboxHtml}
</div>
<hr>



  <div class="ability-tabs">
    <div class="tab-headers">${tabHeadersHtml}</div>
    <div class="tab-content">${tabContentHtml}</div>
  </div>

</form>
<style>
.form-group {
  margin-bottom: 8px;
}
.attack-options-row,
.attack-modifiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pill input {
  display: none;
}
  .pill {
  cursor: pointer;
  flex: 0 0 auto; 
}
.pill span:hover {
  border-color: #999;
  color: white;
}  
.pill span {
  display: inline-block;
  padding: 3px 8px;
  border: 1px solid #666;
  border-radius: 999px;
  background: #2b2b2b;
  color: #ccc;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.pill input:checked + span {
  background: #4a6fa5;
  border-color: #6ea8ff;
  color: white;
}

.pill.penalty input:checked + span {
  background: #a54a4a;
  border-color: #ff6e6e;
}
  </style>
`,
    classes: ["ability-dialog"],
    buttons: {},
    render: (html) => {
      const root = html[0];

      const app = abilityDialog.element[0];
      app.style.height = "auto";
      app.style.minHeight = "530px";

      // ✅ ADD THIS PART
      const checkbox = root.querySelector("#keep-open");

      checkbox?.addEventListener("change", async (event) => {
        await game.settings.set(
          "redsteel",
          "keepAbilityDialogOpen",
          event.target.checked,
        );
      });

      // Activate first tab
      const firstTab = html.find(".tab-item").first();
      firstTab.addClass("active");
      html
        .find(`.tab-pane[data-tab="${firstTab.data("tab")}"]`)
        .addClass("active");

      // Switch tabs
      html.find(".tab-item").click(function () {
        const tab = $(this).data("tab");
        html.find(".tab-item").removeClass("active");
        $(this).addClass("active");
        html.find(".tab-pane").removeClass("active");
        html.find(`.tab-pane[data-tab="${tab}"]`).addClass("active");
      });

      // Ability selection
      html.find(".ability-choice").click(async (event) => {
        const abilityId = event.currentTarget.dataset.abilityId;
        const ability = abilities.find((a) => a.id === abilityId);
        if (!ability) return;

        if (
          lockedMultiAttackAbility &&
          ability.id !== lockedMultiAttackAbility.id
        ) {
          ui.notifications.warn("You are continuing a Multi-Attack.");
          return;
        }

        await onAbilityChosen(ability, root, abilityDialog, actor);
      });

      html.find(".weapon-set-toggle").on("click", async () => {
        const next = actor.system.combat.activeWeaponSet === 1 ? 2 : 1;

        await actor.update({
          "system.combat.activeWeaponSet": next,
        });

        abilityDialog.close();
        combatAbilities();
      });
    },
  });

  abilityDialog.render(true);

  // ====================================================================
  // 5. HELPER FUNCTIONS
  // ====================================================================

  /**
   * Handles weapon selection and dispatches to the correct roll function.
   * * @param {object} actor
   * @param {object} ability
   * @param {'attack'|'defense'} mode
   */
  async function weaponSelectionFlow(actor, ability, mode, intent) {
    // ==================================================
    // 1. AUTO-RESOLVE VIA ACTIVE WEAPON SET
    // ==================================================

    const weaponContext = game.redsteel.resolveWeaponContext(actor, ability);

    if (weaponContext) {
      await updateCombatFlags(actor, intent);

      if (mode === "defense") {
        return game.redsteel.defenseRoll({
          actor,
          weapon: weaponContext.weapon,
          ability,
        });
      }

      const abilityDamage = ability.system.roll.diceBonusFormula || 0;
      const halfDamage = ability.system.roll.halfDamage;
      const penCap = ability.system.roll.penCap;
      const abilityAttack = ability.system.attack || 0;
      const abilityBreakthrough = ability.system.breakthrough || 0;
      const abilityPenetration = ability.system.penetration || 0;
      const abilityAttributeTestName = ability.system.attributeTest || 0;
      const abilityTestModifier = ability.system.testModifier || 0;
      const abilityCritRange = ability.system.critRange || 0;
      const abilityCritChance = ability.system.critChance || 0;
      const abilityCritFail = ability.system.critFail || 0;

      return runAttackMacro(
        actor,
        weaponContext,
        ability,
        intent.modifiers,
        abilityDamage,
        abilityAttack,
        abilityBreakthrough,
        abilityPenetration,
        abilityAttributeTestName,
        abilityTestModifier,
        abilityCritRange,
        abilityCritChance,
        abilityCritFail,
        halfDamage,
        penCap,
        intent.longReachPenalty,
      );
    }

    let weapons;

    if (ability.system.type === "melee") {
      weapons = actor.items.filter(
        (i) =>
          i.type === "weapon" &&
          ["axe", "sword", "blunt", "polearm"].includes(i.system.class) &&
          !i.system.thrown,
      );
    }

    if (ability.system.type === "ranged") {
      weapons = actor.items.filter(
        (i) =>
          (i.type === "weapon" &&
            ["bow", "crossbow"].includes(i.system.class)) ||
          (["axe", "sword", "blunt", "polearm"].includes(i.system.class) &&
            i.system.thrown),
      );
    }
    if (!weapons?.length)
      return ui.notifications.warn("This actor has no valid weapons.");
    const weaponChoices = weapons.map((w, idx) => ({
      label: w.name,
      value: idx,
    }));

    const handleWeaponSelection = async (weaponIndex) => {
      const weapon = weapons[weaponIndex];
      const weaponContext = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!weaponContext) return;

      await updateCombatFlags(actor, intent);

      if (mode === "defense") {
        // defenseRoll function
        await game.redsteel.defenseRoll({
          actor,
          weapon: weaponContext.weapon,
          ability,
        });
      } else {
        const abilityDamage = ability.system.roll.diceBonusFormula || 0;
        const halfDamage = ability.system.roll.halfDamage;
        const penCap = ability.system.roll.penCap;
        const abilityAttack = ability.system.attack || 0;
        const abilityBreakthrough = ability.system.breakthrough || 0;
        const abilityPenetration = ability.system.penetration || 0;
        const abilityAttributeTestName = ability.system.attributeTest || 0;
        const abilityTestModifier = ability.system.testModifier || 0;
        const abilityCritRange = ability.system.critRange || 0;
        const abilityCritChance = ability.system.critChance || 0;
        const abilityCritFail = ability.system.critFail || 0;

        await runAttackMacro(
          actor,
          weaponContext,
          ability,
          intent.modifiers,
          abilityDamage,
          abilityAttack,
          abilityBreakthrough,
          abilityPenetration,
          abilityAttributeTestName,
          abilityTestModifier,
          abilityCritRange,
          abilityCritChance,
          abilityCritFail,
          halfDamage,
          penCap,
          intent.longReachPenalty,
        );
      }
    };

    const css = `
    #weapon-list .weapon-choice {
        position: relative;
        font-size: 16px;
        color: black;
    }
    
    #weapon-list .weapon-choice:hover {
        color: black;
        text-shadow: 0 0 1px red, 0 0 2px red;
    }

    .weapon-dialog .window-content {
        max-width: 300px;
        width: 100%;
    }

    .weapon-dialog .window {
        width: auto;
    }
`;
    const styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = css;
    document.head.appendChild(styleSheet);

    const weaponDialog = new Dialog({
      title: `Select Weapon - ${ability.name} (${
        mode === "defense" ? "Defense" : "Attack"
      })`,
      content: `
        <form>
            <p>Choose Weapon for ${mode} roll:</p>
           
        </form>

        <form>
        <fieldset>
        <ul id="weapon-list" style="list-style: none; padding: 0;">
            ${weaponChoices
              .map(
                (c) =>
                  `<li class="weapon-choice" data-value="${c.value}" style="cursor: pointer; padding: 5px; border-bottom: 1px solid #444;">${c.label}</li>`,
              )
              .join("")}
        </ul>
        </fieldset>
        </form>
    `,
      classes: ["weapon-dialog"],
      buttons: {},
      render: (html) => {
        html.find(".weapon-choice").click(async (event) => {
          const selectedValue = $(event.currentTarget).data("value");

          await updateCombatFlags(actor, html);

          await handleWeaponSelection(selectedValue);
        });
      },
    });

    weaponDialog.render(true);
  }

  // runAttackMacro, updateCombatFlags, and deductAbilityCost functions

  async function updateCombatFlags(actor, intent) {
    if (!actor) return;

    if (intent.sneak) {
      await actor.setFlag("redsteel", "useSneakAttack", true);
      await actor.setFlag("redsteel", "sneakAccessCounter", 0);
    } else {
      await actor.unsetFlag("redsteel", "useSneakAttack");
      await actor.unsetFlag("redsteel", "sneakAccessCounter");
    }

    if (intent.flanking) {
      await actor.setFlag("redsteel", "useFlankingAttack", true);
    } else {
      await actor.unsetFlag("redsteel", "useFlankingAttack");
    }

    if (intent.aim > 0) {
      await actor.setFlag("redsteel", "aimCount", intent.aim);
    } else {
      await actor.unsetFlag("redsteel", "aimCount");
    }
  }

  async function postUniversalStyleAttackChat({
    actor,
    weapon,
    ability,
    attackRoll,
    damageRoll,
    critSuccess,
    critFailure,
    damageTotal,
    penetration,
    critDamageTotal,
    critBonusPenetration,
    critScore,
    critScoreResult,
    breakthroughRollResult,
    showBreakthrough,
    allBleedRollResults,
    effectsRollResults,
    rollName,
    criticalSuccessThreshold,
    criticalFailureThreshold,
    halfDamage = 0,
    penCap = false,
    concatRollAndDescription,
    mechanicalEffects,
    damageProfile = [],
    attributeTestHTML = "",
  }) {
    let attackHTML = "";
    let damageHTML = "";
    let critHTML = "";

    if (critScore !== undefined) {
      critHTML = `
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
`;
    }

    if (attackRoll) {
      attackHTML = await attackRoll.render();
    }

    if (damageRoll) {
      damageHTML = await damageRoll.render();
    }
    const hasBreakthrough =
      showBreakthrough &&
      typeof breakthroughRollResult === "string" &&
      breakthroughRollResult.trim() !== "";

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
          <div style="text-align:center;">${breakthroughRollResult}</div>
        `
        : `
          <div>&nbsp;</div><div>&nbsp;</div>
        `
    }
  </div>

${critHTML}
</div>
`;

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
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">
    ${rollName}
  </strong>
</span>
<hr>
<div style="text-align:center; font-size:16px;">
<table style="width:100%; text-align:center; font-size:16px;">
<tr>
  <td>
    ${concatRollAndDescription}
    ${attributeTestHTML}
  </td>
</tr>
</table>
 </div>
 <hr>
<p style="text-align:center; font-size:20px;">
  <b>${critSuccess ? "Critical Success!" : critFailure ? "Critical Failure!" : ""}</b>
</p>
<table style="width:100%; text-align:center; font-size:15px;">
  <tr><th>Effects</th></tr>
  <tr>
    <td><b>${allBleedRollResults}</b> ${effectsRollResults}</td>
  </tr>
</table>
<hr>
${damageLine}
<hr>
`,
      flags: {
        redsteel: {
          rollName,
          criticalSuccessThreshold,
          criticalFailureThreshold,
        },
        attack: {
          type: "attack",
          damageProfile,
          effects: mechanicalEffects,
          normal: { damage: damageTotal, penetration, halfDamage, penCap },
          critical: {
            damage: critDamageTotal,
            penetration: critBonusPenetration,
            halfDamage,
            penCap,
          },
          breakthrough: {
            damage: breakthroughRollResult,
            penetration,
            halfDamage,
            penCap,
          },
        },
      },
    });
  }
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

    // 1️⃣ Modifier authority (highest)
    for (const mod of selectedModifiers) {
      const modProfile = buildDamageProfile(mod.system);
      if (modProfile.expression.length > 0) {
        return modProfile;
      }
    }

    // 2️⃣ Ability authority
    if (abilityProfile.expression.length > 0) {
      return abilityProfile;
    }

    // 3️⃣ Actor enchant authority
    if (actor) {
      const actorMods = game.redsteel.getActorCombatModifiers(actor, weapon);

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
          // expand
          finalTypes = [...baseTypes];
          for (const type of enchantTypes) {
            if (!finalTypes.includes(type)) {
              finalTypes.push(type);
            }
          }
        }

        const newExpression = [];
        finalTypes.forEach((type, index) => {
          if (index > 0) newExpression.push("or");
          newExpression.push(type);
        });

        return { expression: newExpression };
      }
    }

    // 4️⃣ Weapon fallback
    return weaponProfile;
  }

  async function runAttackMacro(
    actor,
    weaponContext,
    ability,
    selectedModifiers = [],
    abilityDamage,
    abilityAttack,
    abilityBreakthrough,
    abilityPenetration,
    abilityAttributeTestName,
    abilityTestModifier,
    abilityCritRange,
    abilityCritChance,
    abilityCritFail,
    halfDamage,
    penCap,
    longReachPenalty = 0,
  ) {
    let totalHalfDamage = Boolean(halfDamage);
    for (const mod of selectedModifiers) {
      if (mod.system?.roll?.halfDamage) {
        totalHalfDamage = true;
      }
    }
    for (const mod of selectedModifiers) {
      if (mod.system?.roll?.penCap) {
        penCap = true;
      }
    }
    const weapon = weaponContext?.weapon ?? null;
    // ─── AMMO CHECK ───
    let ammo = null;

    if (weapon) {
      const ammoOption = actor.getRequiredAmmoOption?.(weapon);

      if (ammoOption) {
        ammo = actor.getEquippedAmmo?.(ammoOption);

        if (!ammo) {
          ui.notifications.warn(`No equipped ${ammoOption}!`);
          return;
        }

        if ((ammo.system.quantity ?? 0) <= 0) {
          ui.notifications.warn(`Out of ${ammoOption}!`);
          return;
        }
      }
    }
    const damageProfile = resolveDamageProfile(
      weapon,
      ability,
      selectedModifiers,
      actor,
    );

    abilityAttack = Number(abilityAttack) || 0;
    abilityPenetration = Number(abilityPenetration) || 0;
    abilityTestModifier = Number(abilityTestModifier) || 0;
    abilityCritRange = Number(abilityCritRange) || 0;
    abilityCritChance = Number(abilityCritChance) || 0;
    abilityCritFail = Number(abilityCritFail) || 0;
    let doctrineBonus = 0;
    let doctrineCritBonus = 0;
    let doctrineCritRangeBonus = 0;
    let doctrineStaggerBonus = 0;
    let doctrineSkillCritPen = 0;
    let doctrineCritDmg = 0;
    let doctrineBleedBonus = 0;
    for (const mod of selectedModifiers) {
      abilityAttack += Number(mod.system.attack) || 0;
      abilityBreakthrough += Number(mod.system.breakthrough) || 0;
      abilityPenetration += Number(mod.system.penetration) || 0;
      abilityCritRange += Number(mod.system.critRange) || 0;
      abilityCritChance += Number(mod.system.critChance) || 0;

      const modDamage = mod.system.roll?.diceBonusFormula;

      if (modDamage) {
        abilityDamage = abilityDamage
          ? `(${abilityDamage}) + (${modDamage})`
          : modDamage;
      }
    }
    if (weapon) {
      ({
        doctrineBonus,
        doctrineCritBonus,
        doctrineCritRangeBonus,
        doctrineStaggerBonus,
        doctrineSkillCritPen,
        doctrineCritDmg,
        doctrineBleedBonus,
      } = await game.redsteel.getDoctrineBonuses(actor, weapon));
    }

    doctrineBonus += abilityCritChance;
    doctrineCritRangeBonus += abilityCritRange;

    let weaponSkillEffect = 0;
    let weaponSkillCrit = 0;
    let weaponSkillCritDmg = 0;
    let weaponSkillCritPen = 0;

    if (weapon) {
      ({
        weaponSkillEffect,
        weaponSkillCrit,
        weaponSkillCritDmg,
        weaponSkillCritPen,
      } = await game.redsteel.getWeaponSkillBonuses(actor, weapon));
    }

    const mainPen = weapon ? Number(weapon.system.penetration) || 0 : 0;

    const offPen = weaponContext?.isDualWield
      ? Number(
          weaponContext.offWeapon?.system?.offhandProperties?.penetration,
        ) || 0
      : 0;
    const actorMods = game.redsteel.getActorCombatModifiers(actor, weapon);
    const penetration =
      mainPen + offPen + abilityPenetration + actorMods.penetrationBonus;

    let {
      attackRoll,
      rollName,
      critSuccess,
      critFailure,
      criticalSuccessThreshold,
      criticalFailureThreshold,
    } = await game.redsteel.getAttackRolls(
      actor,
      weapon,
      doctrineBonus,
      doctrineCritBonus,
      weaponSkillCrit,
      abilityAttack,
      weaponContext,
      abilityCritFail,
      longReachPenalty,
    );

    const { damageRoll, damageTotal, breakthroughRollResult } =
      await game.redsteel.getDamageRolls(
        actor,
        weapon,
        weaponContext,
        abilityDamage,
        abilityBreakthrough,
      );

    const {
      critScore,
      critScoreResult,
      critBonusPenetration,
      critDamageTotal,
    } = await game.redsteel.getCriticalRolls(
      actor,
      weapon,
      weaponContext,
      doctrineCritRangeBonus,
      attackRoll,
      weaponSkillCritDmg,
      weaponSkillCritPen,
      damageTotal,
      penetration,
      doctrineCritDmg,
      doctrineSkillCritPen,
    );

    const { allBleedRollResults, effectsRollResults, mechanicalEffects } =
      await game.redsteel.getEffectRolls(
        actor,
        weapon,
        weaponContext,
        doctrineBleedBonus,
        doctrineStaggerBonus,
        weaponSkillEffect,
        critScore,
        critSuccess,
        ability,
        selectedModifiers,
      );

    const attributeMap = {
      strength: "str",
      endurance: "end",
      dexterity: "dex",
      intelligence: "int",
      wisdom: "wis",
      charisma: "cha",
    };

    let concatRollAndDescription = ability.system.description || "";

    let attributeTestHTML = "";

    // Append modifier descriptions
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
<td>
<span
title="Test chance ${attributeTotalValue}%&#10;Rolled: ${attributeRoll.result}">
<b>${mod.name} — ${testName} Test ${attributeTotalValue}%</b><br>
Margin of Success: [${attributeRoll.total}]
</span>
</td>
</tr>
`;
    }

    // Ability test
    if (
      abilityAttributeTestName &&
      abilityAttributeTestName !== "-- Select a Type --"
    ) {
      const lowerTestName = abilityAttributeTestName.trim().toLowerCase();
      let baseValue = 0;

      // 1️⃣ Leadership special case FIRST
      if (lowerTestName === "leadership") {
        baseValue =
          actor.type === "npc"
            ? (actor.system.attributes.cha?.value ?? 0)
            : (actor.system.skills?.leadership?.rating ?? 0);
      }

      // 2️⃣ Combat skills
      else if (actor.system.combatSkills?.[lowerTestName]) {
        baseValue = actor.system.combatSkills[lowerTestName]?.rating ?? 0;
      }

      // 3️⃣ Other skills
      else if (actor.system.skills?.[lowerTestName]) {
        baseValue = actor.system.skills[lowerTestName]?.rating ?? 0;
      }

      // 4️⃣ Attributes LAST (keep .mod for characters!)
      else if (attributeMap[lowerTestName]) {
        const shortKey = attributeMap[lowerTestName];

        baseValue =
          actor.type === "npc"
            ? (actor.system.attributes[shortKey]?.value ?? 0)
            : (actor.system.attributes[shortKey]?.mod ?? 0); // ✅ .mod preserved
      }

      const totalModifier = Number(baseValue) + Number(abilityTestModifier);

      const attributeRoll = new Roll(`(${totalModifier}) - 1d100`);

      await attributeRoll.evaluate({ async: true });

      concatRollAndDescription += `

<b>${abilityAttributeTestName} Test ${totalModifier}%</b><br>
Margin of Success: ${attributeRoll.total}
`;
    }
    const modifierLabel = selectedModifiers.length
      ? ` + ${selectedModifiers.map((m) => m.name).join(", ")}`
      : "";

    rollName = weapon
      ? `${ability.name}${modifierLabel} with ${weapon.name}`
      : `${ability.name}${modifierLabel}`;
    await postUniversalStyleAttackChat({
      actor,
      weapon,
      ability,
      attackRoll,
      damageRoll,
      critSuccess,
      critFailure,
      damageTotal,
      penetration,
      critDamageTotal,
      critBonusPenetration,
      critScore,
      critScoreResult,
      breakthroughRollResult,
      showBreakthrough: weapon
        ? weapon.system.breakthrough
        : abilityBreakthrough,
      allBleedRollResults,
      effectsRollResults,
      rollName,
      criticalSuccessThreshold,
      criticalFailureThreshold,
      concatRollAndDescription,
      mechanicalEffects,
      damageProfile,
      halfDamage: totalHalfDamage,
      penCap,
      attributeTestHTML,
    });
    // ─── AMMO DEDUCTION ───
    if (ammo) {
      await actor.deductAmmo(ammo);
    }
  }
}

export async function deductAbilityCost(actor, abilities = []) {
  if (!Array.isArray(abilities)) abilities = [abilities];

  const drainTotals = {};
  const addTotals = {};
  const updates = {};
  function resolveStatKey(stat) {
    if (stat === "temporaryhealth") return "temporaryHealth";
    return stat;
  }
  // ---------------------------------
  // 1. Collect all drains and adds
  // ---------------------------------
  for (const ability of abilities) {
    // Simple costType system
    const costType = ability.system.costType;
    const normalizedType = costType?.toLowerCase();
    const costValue = Number(ability.system.cost) || 0;

    if (normalizedType && costValue > 0) {
      drainTotals[normalizedType] =
        (drainTotals[normalizedType] || 0) + costValue;
    }

    const resources = Array.isArray(ability.system.resources)
      ? ability.system.resources
      : Object.values(ability.system.resources ?? {});

    for (const res of resources) {
      const { type, mode, amount } = res;
      if (!type || !mode) continue;
      const stat = type.toLowerCase();

      const value = Number(amount) || 0;

      if (mode === "drain") {
        drainTotals[stat] = (drainTotals[stat] || 0) + value;
      }

      if (mode === "add") {
        addTotals[stat] = (addTotals[stat] || 0) + value;
      }
    }
  }

  // ---------------------------------
  // 2. Validate drains
  // ---------------------------------
  for (const [stat, totalDrain] of Object.entries(drainTotals)) {
    const actorStat = resolveStatKey(stat);
    const currentValue = actor.system.stats[actorStat]?.value ?? 0;

    if (currentValue < totalDrain) {
      ui.notifications.warn(`Not enough ${stat.replace(/([A-Z])/g, " $1")}`);
      return false;
    }
  }

  // ---------------------------------
  // 3. Apply final changes
  // ---------------------------------
  const affectedStats = new Set([
    ...Object.keys(drainTotals),
    ...Object.keys(addTotals),
  ]);

  for (const stat of affectedStats) {
    const actorStat = resolveStatKey(stat);

    const currentValue = actor.system.stats[actorStat]?.value ?? 0;
    const drain = drainTotals[stat] || 0;
    const add = addTotals[stat] || 0;

    updates[`system.stats.${actorStat}.value`] = Math.max(
      currentValue - drain + add,
      0,
    );
  }

  if (Object.keys(updates).length) {
    await actor.update(updates);
  }

  return true;
}

function renderWeaponLoadoutsDialog(actor) {
  const weaponSets = game.redsteel.buildWeaponSetView(actor);
  const activeSet = actor.system.combat.activeWeaponSet;

  return `
<section class="weapon-loadouts horizontal active-set-${activeSet}">

  ${[1, 2]
    .map((setId) => {
      const ws = weaponSets[setId];

      return `
<div class="weapon-set-block">
  <div class="weapon-loadout-label">Set ${setId}</div>

  <div class="weapon-slot-row">

    <!-- MAIN -->
    <div class="weapon-slot main ${ws.main ? "filled" : "empty"}"
         data-set="${setId}" data-slot="main">
      ${
        ws.main
          ? `<img src="${ws.main.img}" title="${ws.main.name}">`
          : `<span>Main</span>`
      }
    </div>

    <!-- OFF -->
    <div class="weapon-slot off
      ${ws.mainIsTwoHanded ? "blocked" : ws.off ? "filled" : "empty"}
      ${ws.offIsShield ? "shield" : ""}"
      data-set="${setId}" data-slot="off">

      ${
        ws.mainIsTwoHanded
          ? `
            <div class="two-handed-ghost">
              <img src="${ws.main.img}"
                   title="${ws.main.name} (Two-handed)"
                   width="44" height="44">
            </div>
          `
          : ws.off
            ? `<img src="${ws.off.img}" title="${ws.off.name}" width="44" height="44">`
            : `<span>Off</span>`
      }

    </div>

  </div>
</div>
`;
    })
    .join("")}

  <div class="weapon-set-switcher">
    <button type="button"
      class="weapon-set-toggle set-${activeSet}"
      title="Switch Weapon Set">
      <i class="fa-sharp fa-regular fa-arrows-repeat"></i>
    </button>
  </div>

</section>
`;
}

// non attack ability resolution

async function runUtilityAbility(actor, ability, modifiers = []) {
  let description = ability.system.description || "";

  for (const mod of modifiers) {
    if (mod.system.description) {
      description += `
<hr>
<b>${mod.name}</b><br>
${mod.system.description}
`;
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">${ability.name}</strong>
</span>
<hr>
<div style="text-align:center; font-size:16px;">
${description}
</div>
`,
  });
}
