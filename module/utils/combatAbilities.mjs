import { getTraitPills } from "./traitPills.mjs";
import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";
import { selectAimedPart, AIMED_PARTS } from "./aimedStrike.mjs";
import { getImprovedAimPenetration } from "./aim.mjs";
import { getAttackRerollTokens } from "./rerolls.mjs";
import { buildBanePacket } from "./baneCombat.mjs";
import { hasHtmlContent } from "./chatBlocks.mjs";
import { appendHeavyWeaponDamage } from "./weaponResolver.mjs";
import {
  isSpeedTest,
  rollSpeedTest,
  renderSpeedTestLine,
} from "./speedTest.mjs";
import { mindBurnUpdates } from "./mindPoints.mjs";
import { resolveTestRating } from "./testRating.mjs";

export async function combatAbilities() {
  // ====================================================================
  // 1. INITIAL SETUP AND FILTERING
  // ====================================================================
  let lockedMultiAttackAbility = null;
  let multiAttackCount = 1;
  // Tracks whether the one-time ability cost has been paid for the current
  // multi-attack chain. Subsequent strikes only pay modifier costs.
  let multiAttackFirstStrikePaid = false;
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

    const abilityTableRows = list
      .map((ability) => {
        const actionCost = ability.system.actionCost || "-";

        // Build resource cost from cost and costType
        const cost = ability.system.cost || 0;
        const costType = ability.system.costType || "";
        let resourceCosts = "-";

        if (cost > 0 && costType) {
          resourceCosts = `${cost} ${costType}`;
        }

        return `
        <tr class="spell-choice ability-choice table-row" data-ability-id="${ability.id}">
          <td class="icon-cell"><img src="${ability.img}" class="ability-icon" title="${ability.localizedName ?? ability.name}"></td>
          <td>${ability.localizedName ?? ability.name}</td>
          <td style="text-align: center;">${actionCost}</td>
          <td style="text-align: center;">${resourceCosts}</td>
        </tr>
      `;
      })
      .join("");

    tabContentHtml += `
    <div class="tab-pane" data-tab="${tab.id}">
      <table>
        <thead>
          <tr>
            <th style="width: 44px;"></th>
            <th>Name</th>
            <th style="text-align: center; width: 80px;">Action Cost</th>
            <th style="text-align: center; width: 100px;">Resource Cost</th>
          </tr>
        </thead>
        <tbody>
          ${abilityTableRows}
        </tbody>
      </table>
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
        .ability-dialog .window-content { max-width: 540px; max-height: 620px; width: 100%; overflow: hidden; background: #1d1d1d; color: #d0d0d0; }
        .ability-dialog .window { width: auto; height: auto; background: #141414; border: 1px solid #8b6914; }
        #keep-open-container { margin-bottom: 8px; font-size: 14px; }
        #keep-open { margin-right: 5px; }
        .ability-dialog .tab-content { max-height: 420px; overflow-y: auto; }
        
        /* Compact table-style ability list */
        .ability-tabs table {
          width: 100%;
          border-collapse: collapse;
          background: #222121;
          color: #d0d0d0;
          font-size: 12px;
          margin-top: 4px;
        }
        
        .ability-tabs thead tr {
          border-bottom: 2px solid #8b6914;
          background: #1a1a1a;
        }
        
        .ability-tabs th {
          text-align: left;
          padding: 4px 6px;
          color: #c9b26b;
          font-weight: bold;
          text-transform: uppercase;
          font-size: 10px;
          letter-spacing: 0.5px;
        }
        
        .ability-tabs tbody tr {
          border-bottom: 1px solid #444;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        
        .ability-tabs tbody tr:hover {
          background: #3a3a3a;
        }
        
        .ability-tabs td {
          padding: 4px 6px;
          vertical-align: middle;
        }
        
        .icon-cell {
          padding: 2px 4px;
          text-align: center;
        }
        
        .ability-icon {
          width: 44px;
          height: 44px;
          border-radius: 3px;
          vertical-align: middle;
          cursor: help;
        }
        
        .tooltip-popup {
          position: absolute;
          background: #1a1a1a;
          border: 2px solid #8b6914;
          border-radius: 4px;
          padding: 8px;
          max-width: 340px;
          color: #d0d0d0;
          font-size: 11px;
          z-index: 1000;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        }
        
        .tooltip-popup .tooltip-title {
          color: #c9b26b;
          font-size: 16px;
          font-weight: bold;
          margin-bottom: 4px;
          border-bottom: 1px solid #8b6914;
          padding-bottom: 4px;
        }
        
        .tooltip-popup .tooltip-section {
          margin-bottom: 4px;
        }
        
        .tooltip-popup .tooltip-section-title {
          color: #c9b26b;
          font-weight: bold;
          font-size: 10px;
          text-transform: uppercase;
        }
        
        .ability-choice.table-row {
          display: table-row;
        }
    `;
    const styleSheet = document.createElement("style");
    styleSheet.id = "redsteel-ability-dialog-styles";
    styleSheet.type = "text/css";
    styleSheet.innerText = css;
    document.head.appendChild(styleSheet);
  }

  const abilityChoices = abilities.map((a, idx) => ({
    label: a.localizedName ?? a.name,
    value: idx,
  }));

  // ====================================================================
  // 3. EXECUTION HANDLER: _onAbilityChosen
  // ====================================================================

  async function onAbilityChosen(
    ability,
    container,
    dialog,
    actor,
    { preselectedWeapon = null } = {},
  ) {
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
    const useAimedStrike = html.find('[name="aimedStrike"]').is(":checked");
    const selectedModifierIds = Array.from(
      container.querySelectorAll(".attack-modifier-checkbox:checked"),
    ).map((cb) => cb.dataset.abilityId);

    const selectedModifiers = modifierAbilities.filter((mod) =>
      selectedModifierIds.includes(mod.id),
    );

    // Aimed Strike: resolve body part choice before proceeding.
    let aimedStrikePart = null;
    if (useAimedStrike) {
      aimedStrikePart = await selectAimedPart();
    }

    const intent = {
      aim: aimValue,
      sneak: useSneak,
      flanking: useFlanking,
      aimedStrikePart,
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

    // Does this ability route through the weapon-selection flow, and can a weapon
    // be auto-resolved (e.g. a character's active set)? When no weapon can be
    // auto-resolved, the weapon must be picked manually.
    const goesThroughWeaponFlow = isDefenseRoll || ability.system.weaponAbility;
    const autoWeaponContext = goesThroughWeaponFlow
      ? game.redsteel.resolveWeaponContext(actor, ability)
      : null;

    // Multi-attack that needs a manual weapon pick (e.g. NPCs): merge the weapon
    // picker into THIS dialog instead of opening a second "Select Weapon" dialog.
    // Defer cost + attack to the weapon-button click below.
    if (
      ability.system.multiAttack &&
      (actor.type === "character" || actor.type === "npc") &&
      !lockedMultiAttackAbility &&
      !preselectedWeapon &&
      goesThroughWeaponFlow &&
      !autoWeaponContext
    ) {
      lockedMultiAttackAbility = ability;
      multiAttackFirstStrikePaid = false;
      transformDialogToMultiAttackMode(dialog, ability, actor);
      return;
    }

    const isMultiStrike =
      ability.system.multiAttack && lockedMultiAttackAbility?.id === ability.id;

    if (isMultiStrike && multiAttackFirstStrikePaid) {
      // Subsequent multi-attack strike → only pay modifiers
      paid = await game.redsteel.deductAbilityCost(actor, selectedModifiers);
    } else {
      // First strike (or normal ability) → pay ability + modifiers once
      paid = await game.redsteel.deductAbilityCost(actor, [
        ability,
        ...selectedModifiers,
      ]);
      if (isMultiStrike) multiAttackFirstStrikePaid = true;
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
      await weaponSelectionFlow(actor, ability, mode, intent, preselectedWeapon);
    } else {
      await game.redsteel.getNonWeaponAbility(actor, ability);
    }
    function transformDialogToMultiAttackMode(dialog, ability, actor) {
      const html = dialog.element;

      // Remove ability list
      html.find(".ability-tabs").remove();
      // Hide Keep Open checkbox
      html.find("#keep-open-container").hide();

      // When a weapon auto-resolves (e.g. a character's active set), keep the
      // single "Attack Again" button. Otherwise (e.g. NPCs) merge the weapon
      // picker inline: one button per valid weapon, each one a strike.
      const autoWeapon = goesThroughWeaponFlow
        ? game.redsteel.resolveWeaponContext(actor, ability)
        : null;

      let promptHtml = "";
      let controlsHtml;
      if (autoWeapon) {
        controlsHtml = `
        <button type="button" id="continue-multiattack" class="multiattack-strike-btn">
          Attack Again
        </button>`;
      } else {
        const weapons = getAbilityWeapons(actor, ability);
        if (weapons.length) {
          promptHtml = `<p class="multiattack-prompt" style="margin:0 0 6px;">Choose a weapon to strike with:</p>`;
          controlsHtml = weapons
            .map(
              (w) =>
                `<button type="button" class="multiattack-weapon-btn multiattack-strike-btn" data-weapon-id="${w.id}">${w.localizedName ?? w.name}</button>`,
            )
            .join("");
        } else {
          controlsHtml = `<em>No valid weapons.</em>`;
        }
      }

      // Add header + buttons
      html.find(".ability-dialog-form").prepend(`
    <div class="multiattack-header">
      <h3>Multi-Attack: ${ability.localizedName ?? ability.name} (Strike <span class="multiattack-strike-count">${multiAttackCount}</span>)</h3>
      ${promptHtml}
      <div class="multiattack-controls" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
        ${controlsHtml}
      </div>
      <hr>
    </div>
  `);

      const formEl = html.find(".ability-dialog-form")[0];
      const bumpStrikeCount = () => {
        multiAttackCount++;
        html.find(".multiattack-strike-count").text(multiAttackCount);
      };

      // Auto-resolve: re-run the whole ability (weapon resolves automatically)
      html.find("#continue-multiattack").click(async () => {
        bumpStrikeCount();
        await onAbilityChosen(ability, formEl, dialog, actor);
      });

      // Manual: each weapon button performs one strike with that weapon
      html.find(".multiattack-weapon-btn").click(async (event) => {
        const weaponId = event.currentTarget.dataset.weaponId;
        const weapon = actor.items.get(weaponId);
        if (!weapon) return;
        await onAbilityChosen(ability, formEl, dialog, actor, {
          preselectedWeapon: weapon,
        });
        bumpStrikeCount();
      });
    }

    if (
      ability.system.multiAttack &&
      (actor.type === "character" || actor.type === "npc") &&
      !lockedMultiAttackAbility
    ) {
      // The first strike already fired above using an auto-resolved weapon, so
      // the ability cost has been paid for this chain.
      lockedMultiAttackAbility = ability;
      multiAttackFirstStrikePaid = true;
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
  <span>${mod.localizedName ?? mod.name}</span>
</label>
  `,
    )
    .join("");
  const keepOpen = game.settings.get("redsteel", "keepAbilityDialogOpen");
  // Pre-select the Aim radio from any stacks already aimed at the current target.
  const preAim = game.redsteel.getAimStacks?.(token) ?? 0;

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
      <input type="radio" name="aim" value="${n}" ${n === preAim ? "checked" : ""}>
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

  <label class="pill">
    <input type="checkbox" name="aimedStrike" />
    <span>Aimed Attack</span>
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

.tab-headers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.tab-item {
  padding: 6px 10px;
  background: #252525;
  border: 1px solid #444;
  border-radius: 4px;
  cursor: pointer;
  color: #c8c2a1;
  font-size: 12px;
}

.tab-item.active {
  background: #2f2b24;
  border-color: #8b6914;
  color: #f0e4b8;
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
        if ($(event.target).hasClass("ability-icon")) return; // Don't select if clicking icon
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

      // Ability icon tooltip hover
      html
        .find(".ability-icon")
        .on("mouseenter", function (e) {
          const abilityId = $(this)
            .closest(".ability-choice")
            .data("ability-id");
          const ability = abilities.find((a) => a.id === abilityId);
          if (!ability) return;

          const tooltipData = ability.getTooltipData?.();
          const actionCost = ability.system.actionCost || "-";
          const cost = ability.system.cost || 0;
          const costType = ability.system.costType || "";
          let resourceCosts = "-";
          if (cost > 0 && costType) {
            resourceCosts = `${cost} ${costType}`;
          }

          let tooltipHtml = `<div class="tooltip-title">${tooltipData?.title ?? ability.localizedName ?? ability.name}</div>`;
          tooltipHtml += `<div class="tooltip-section"><strong>Action Cost:</strong> ${actionCost}</div>`;
          tooltipHtml += `<div class="tooltip-section"><strong>Resource Cost:</strong> ${resourceCosts}</div>`;

          if (tooltipData) {
            if (tooltipData.sections) {
              tooltipData.sections.forEach((section) => {
                if (section.label && section.value) {
                  tooltipHtml += `<div class="tooltip-section"><strong>${section.label}:</strong> ${section.value}</div>`;
                }
              });
            }
            if (tooltipData.stats) {
              tooltipData.stats.forEach((stat) => {
                if (stat.label && stat.value) {
                  tooltipHtml += `<div class="tooltip-section"><strong>${stat.label}:</strong> ${stat.value}</div>`;
                }
              });
            }
            if (tooltipData.description) {
              tooltipHtml += `<div class="tooltip-section" style="border-top: 1px solid #8b6914; padding-top: 4px; margin-top: 4px;">${tooltipData.description}</div>`;
            }
          }

          const tooltip = $(`<div class="tooltip-popup">${tooltipHtml}</div>`);
          $("body").append(tooltip);

          const offset = $(this).offset();
          tooltip.css({
            left: offset.left + 50 + "px",
            top: offset.top + "px",
          });

          $(this).data("tooltip", tooltip);
        })
        .on("mouseleave", function () {
          const tooltip = $(this).data("tooltip");
          if (tooltip) tooltip.remove();
        });

      html.find(".weapon-set-toggle").on("click", async () => {
        await game.redsteel.switchWeaponSet(actor);
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
   * Returns the weapons an actor may use for the given ability. Off-hand NPC
   * weapons are excluded (they are consumed automatically as the off hand).
   * @param {object} actor
   * @param {object} ability
   * @returns {object[]}
   */
  function getAbilityWeapons(actor, ability) {
    const isNpcOffhand = (i) => actor.type === "npc" && i.system.npcOffhand;

    if (ability.system.type === "melee") {
      return actor.items.filter(
        (i) =>
          i.type === "weapon" &&
          ["axe", "sword", "blunt", "polearm"].includes(i.system.class) &&
          !i.system.thrown &&
          !isNpcOffhand(i),
      );
    }

    if (ability.system.type === "ranged") {
      return actor.items.filter(
        (i) =>
          ((i.type === "weapon" &&
            ["bow", "crossbow"].includes(i.system.class)) ||
            (["axe", "sword", "blunt", "polearm"].includes(i.system.class) &&
              i.system.thrown)) &&
          !isNpcOffhand(i),
      );
    }

    return [];
  }

  /**
   * Handles weapon selection and dispatches to the correct roll function.
   * * @param {object} actor
   * @param {object} ability
   * @param {'attack'|'defense'} mode
   * @param {object} [preselectedWeapon] - skip the picker and roll with this weapon
   */
  async function weaponSelectionFlow(
    actor,
    ability,
    mode,
    intent,
    preselectedWeapon = null,
  ) {
    // Roll an attack/defense once a weapon context is known.
    const runWithWeaponContext = async (weaponContext) => {
      if (!weaponContext) return;

      await updateCombatFlags(actor, intent);

      if (mode === "defense") {
        return game.redsteel.defenseRoll({
          actor,
          weapon: weaponContext.weapon,
          ability,
        });
      }

      return runAttackMacro(
        actor,
        weaponContext,
        ability,
        intent.modifiers,
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
        intent.longReachPenalty,
      );
    };

    // ==================================================
    // 0. PRESELECTED WEAPON (e.g. multi-attack inline picker)
    // ==================================================
    if (preselectedWeapon) {
      return runWithWeaponContext(
        game.redsteel.resolveWeaponContext(actor, ability, preselectedWeapon),
      );
    }

    // ==================================================
    // 1. AUTO-RESOLVE VIA ACTIVE WEAPON SET
    // ==================================================
    const weaponContext = game.redsteel.resolveWeaponContext(actor, ability);
    if (weaponContext) {
      return runWithWeaponContext(weaponContext);
    }

    // ==================================================
    // 2. MANUAL WEAPON SELECTION DIALOG
    // ==================================================
    const weapons = getAbilityWeapons(actor, ability);
    if (!weapons?.length)
      return ui.notifications.warn("This actor has no valid weapons.");
    const weaponChoices = weapons.map((w, idx) => ({
      label: w.localizedName ?? w.name,
      value: idx,
    }));

    const handleWeaponSelection = async (weaponIndex) => {
      const weapon = weapons[weaponIndex];
      return runWithWeaponContext(
        game.redsteel.resolveWeaponContext(actor, ability, weapon),
      );
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
      title: `Select Weapon - ${ability.localizedName ?? ability.name} (${
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

    if (intent.aimedStrikePart) {
      await actor.setFlag("redsteel", "aimedPart", intent.aimedStrikePart);
    } else {
      await actor.unsetFlag("redsteel", "aimedPart");
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
    criticalOptions,
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
    aimedStrike = null,
    banePacket = null,
    baneRoll = null,
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

    // Skip the Description table entirely when there is nothing to put in it —
    // an attack with no description and no test rolls shouldn't show an empty
    // header with a blank row under it.
    const hasDescription = hasHtmlContent(concatRollAndDescription);
    const descriptionTable =
      hasDescription || attributeTestHTML.trim()
        ? `
<div style="text-align:center; font-size:16px;">
<table style="width:100%; text-align:center; font-size:16px;">
  ${hasDescription ? `<tr><th>Description</th></tr>\n  <tr><td>${concatRollAndDescription}</td></tr>` : ""}
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
      rolls: banePacket ? [attackRoll, damageRoll, baneRoll] : [attackRoll, damageRoll],
      flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">
    ${rollName}
  </strong>
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
          // Reroll tokens for the chat reroll picker: "attack" + combat skill +
          // governing attribute (finesse-aware), so e.g. Brawny (str) can reroll
          // a strength melee attack and Nimble (dex) a finesse attack.
          rerollTokens: getAttackRerollTokens(actor, weapon),
        },
        attack: {
          type: "attack",
          damageProfile,
          effects: mechanicalEffects,
          aimedStrike,
          normal: { damage: damageTotal, penetration, halfDamage, penCap },
          critical: {
            damage: critDamageTotal,
            penetration: critBonusPenetration,
            halfDamage,
            penCap,
            degree: critScore,
            options: criticalOptions,
          },
          breakthrough: {
            damage: breakthroughRollResult,
            penetration,
            halfDamage,
            penCap,
          },
          bane: banePacket,
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
    // Conditional dice that only land with a Heavy weapon (Charge's extra 2d4).
    abilityDamage = appendHeavyWeaponDamage(abilityDamage, weapon, [
      ability,
      ...selectedModifiers,
    ]);
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
    // Improved Aim: read before getAttackRolls consumes the aim flag.
    const improvedAimPen = getImprovedAimPenetration(
      actor,
      weapon,
      weaponContext,
    );
    const penetration =
      mainPen +
      offPen +
      abilityPenetration +
      actorMods.penetrationBonus +
      improvedAimPen;
    // S2: fold passive weapon crit-range bonuses (spec nodes) into the crit-range
    // input that getCriticalRolls buckets into critScore.
    doctrineCritRangeBonus += actorMods.critRangeBonus;

    let {
      attackRoll,
      rollName,
      critSuccess,
      critFailure,
      criticalSuccessThreshold,
      criticalFailureThreshold,
      aimedPart,
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
      criticalOptions,
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

    // Head aimed attack injects stagger +20% and precision +10% as a synthetic
    // modifier so both bonuses appear in the roll results and chat message.
    const effectModifiers = aimedPart === "head"
      ? [...selectedModifiers, {
          system: {
            effectType1: "stagger",
            effectType2: "precision",
            effects: {
              extra1: AIMED_PARTS.head.staggerBonus,
              extra2: AIMED_PARTS.head.precisionBonus,
            },
          },
        }]
      : selectedModifiers;

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
        effectModifiers,
      );

    // ─── Bane ("Metla") packet ───
    // A second reading of the same dice: never re-roll the attack or crit
    // range roll, only re-bucket them under the attacker's Bane bonuses. The
    // only new randomness is the bonus damage die, rolled exactly once.
    const { packet: banePacket, roll: baneRoll } = await buildBanePacket({
      actor,
      attackRoll,
      criticalSuccessThreshold,
      critScoreResult,
      criticalOptions,
      damageTotal,
      penetration,
      breakthroughRollResult,
      halfDamage: totalHalfDamage,
      penCap,
      baseCritSuccess: critSuccess,
    });

    let concatRollAndDescription = ability.system.description || "";

    for (const mod of selectedModifiers) {
      if (mod.system.description) {
        if (concatRollAndDescription) concatRollAndDescription += "<br>";
        concatRollAndDescription += `<b>${mod.localizedName ?? mod.name}</b><br>${mod.system.description}`;
      }
    }

    if (aimedPart) {
      const aimedPartDef = AIMED_PARTS[aimedPart];
      if (aimedPartDef) {
        if (concatRollAndDescription) concatRollAndDescription += "<br>";
        concatRollAndDescription += `Aimed attack: ${aimedPartDef.label}`;
      }
    }

    let attributeTestHTML = "";

    // Append modifier attribute tests
    for (const mod of selectedModifiers) {
      const testName = mod.system.attributeTest;
      const testModifier = Number(mod.system.testModifier) || 0;

      if (!testName || testName === "-- Select a Type --") continue;

      // Speed test: d12 + Initiative + Speed, higher is better.
      if (isSpeedTest(testName)) {
        const speedRoll = await rollSpeedTest(actor, { modifier: testModifier });
        attributeTestHTML += `
<tr>
<td>
<span>
<b>${mod.localizedName ?? mod.name}</b><br>
${renderSpeedTestLine({
  actor,
  roll: speedRoll,
  source: ability.localizedName ?? ability.name,
  modifier: testModifier,
})}
</span>
</td>
</tr>
`;
        continue;
      }

      const { value: attributeValue, skillKey } = resolveTestRating(
        actor,
        testName,
      );

      const attributeTotalValue = attributeValue + testModifier;

      const attributeRoll = new Roll(
        `(${attributeTotalValue}) - 1d100`,
        withRollBias({}, actor),
      );
      tagRollSkill(attributeRoll, skillKey);
      await attributeRoll.evaluate({ async: true });

      attributeTestHTML += `
<tr>
<td>
<span>
<b>${mod.localizedName ?? mod.name} — ${testName} Test ${attributeTotalValue}%</b><br>
<span class="mos-followup" data-margin="${attributeRoll.total}" data-source="${ability.localizedName ?? ability.name}" data-tooltip="Test chance ${attributeTotalValue}%<br>Rolled: ${attributeRoll.result}<br>Click to roll an attribute against this margin" style="cursor:pointer; text-decoration:underline dotted;">Margin of Success: [${attributeRoll.total}]</span>
</span>
</td>
</tr>
`;
    }

    // Ability test
    if (isSpeedTest(abilityAttributeTestName)) {
      // Speed test: d12 + Initiative + Speed, higher is better.
      const speedRoll = await rollSpeedTest(actor, {
        modifier: abilityTestModifier,
      });

      concatRollAndDescription += `

${renderSpeedTestLine({
  actor,
  roll: speedRoll,
  source: ability.localizedName ?? ability.name,
  modifier: abilityTestModifier,
})}
`;
    } else if (
      abilityAttributeTestName &&
      abilityAttributeTestName !== "-- Select a Type --"
    ) {
      // Leadership → combat skills → skills → attributes (keeps .mod for characters).
      const { value: baseValue, skillKey: testSkillKey } = resolveTestRating(
        actor,
        abilityAttributeTestName,
      );

      const totalModifier = Number(baseValue) + Number(abilityTestModifier);

      const attributeRoll = new Roll(
        `(${totalModifier}) - 1d100`,
        withRollBias({}, actor),
      );
      // Tag whichever bucket the test resolved against so per-skill advantage
      // applies; null (unresolved test name) falls back to the actor-wide bucket.
      tagRollSkill(attributeRoll, testSkillKey);

      await attributeRoll.evaluate({ async: true });

      concatRollAndDescription += `

<b>${abilityAttributeTestName} Test ${totalModifier}%</b><br>
<span class="mos-followup" data-margin="${attributeRoll.total}" data-source="${ability.localizedName ?? ability.name}" data-tooltip="Test chance ${totalModifier}%<br>Rolled: ${attributeRoll.result}<br>Click to roll an attribute against this margin" style="cursor:pointer; text-decoration:underline dotted;">Margin of Success: ${attributeRoll.total}</span>
`;
    }
    const modifierLabel = selectedModifiers.length
      ? ` + ${selectedModifiers.map((m) => m.localizedName ?? m.name).join(", ")}`
      : "";

    rollName = weapon
      ? `${ability.localizedName ?? ability.name}${modifierLabel} with ${weapon.localizedName ?? weapon.name}`
      : `${ability.localizedName ?? ability.name}${modifierLabel}`;
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
      criticalOptions,
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
      aimedStrike: aimedPart
        ? { part: aimedPart, su: attackRoll.total }
        : null,
      banePacket,
      baneRoll,
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
    if (stat === "temporaryhealthmagic") return "temporaryHealthMagic";
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
          ? `<img src="${ws.main.img}" title="${ws.main.localizedName ?? ws.main.name}">`
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
                   title="${ws.main.localizedName ?? ws.main.name} (Two-handed)"
                   width="44" height="44">
            </div>
          `
          : ws.off
            ? `<img src="${ws.off.img}" title="${ws.off.localizedName ?? ws.off.name}" width="44" height="44">`
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

/**
 * Roll the Test Type of a utility (type: "other") ability or one of its
 * modifiers. Handles both the d12 speed test and the standard d100 margin of
 * success, and returns the clickable chat line for it.
 * @returns {Promise<{roll: Roll, html: string, label: string}|null>} null when
 *   the item has no Test Type selected.
 */
async function rollUtilityTest(actor, item) {
  const testName = item.system.attributeTest;
  const testModifier = Number(item.system.testModifier) || 0;
  const source = item.localizedName ?? item.name;

  if (isSpeedTest(testName)) {
    const roll = await rollSpeedTest(actor, { modifier: testModifier });
    // No bold heading here: the rendered line and the roll column both already
    // say "Speed Test".
    return {
      roll,
      label: "Speed Test",
      html: renderSpeedTestLine({ actor, roll, source, modifier: testModifier }),
    };
  }

  if (!testName || testName === "-- Select a Type --") return null;

  const { value, skillKey } = resolveTestRating(actor, testName);
  const total = value + testModifier;

  const roll = new Roll(`(${total}) - 1d100`, withRollBias({}, actor));
  tagRollSkill(roll, skillKey);
  await roll.evaluate();

  return {
    roll,
    label: "Margin of Success",
    html: `<b>${testName} Test ${total}%</b><br>
<span class="mos-followup" data-margin="${roll.total}" data-source="${source}" data-tooltip="Test chance ${total}%<br>Rolled: ${roll.result}<br>Click to roll an attribute against this margin" style="cursor:pointer; text-decoration:underline dotted;">Margin of Success: [${roll.total}]</span>`,
  };
}

async function runUtilityAbility(actor, ability, modifiers = []) {
  // Vstřebání krve (Blood Absorption): cancel the entire Blood Reserve and heal
  // Life equal to the Blood School's Maximum Transfer, but never more Life than
  // was cancelled from the Reserve. Keyed off `system.key` the same way stances
  // are, so a single pack item drives the whole action.
  if (ability.system.key === "absorbBlood") {
    await runAbsorbBlood(actor, ability);
    return;
  }

  // Krvavý pakt (Blood Pact): burn a Mind point to fill the Blood Reserve by
  // the Maximum Transfer. Once per round, Free Action.
  if (ability.system.key === "bloodPact") {
    await runBloodPact(actor, ability);
    return;
  }

  let description = ability.system.description || "";

  // Utility abilities honour the Test Type field the same way attack abilities
  // do — both the ability's own test and any selected modifier's test.
  const testRolls = [];

  const abilityTest = await rollUtilityTest(actor, ability);
  if (abilityTest) {
    description += `<hr>${abilityTest.html}`;
    testRolls.push(abilityTest);
  }

  for (const mod of modifiers) {
    const modTest = await rollUtilityTest(actor, mod);
    if (!mod.system.description && !modTest) continue;

    description += `
<hr>
<b>${mod.localizedName ?? mod.name}</b><br>
${mod.system.description ?? ""}
`;
    if (modTest) {
      description += `${modTest.html}`;
      testRolls.push(modTest);
    }
  }

  // Utility (type: "other") abilities can define effects the same way attack
  // abilities do (e.g. Odhalení slabiny's expose_weakness). Roll them here so
  // they aren't silently dropped, and expose an Apply Effects button on the
  // card via the flags.effects convention (no flags.attack, so the existing
  // chat-button hook in redsteel.mjs skips the Apply Damage button).
  const { allBleedRollResults, effectsRollResults, mechanicalEffects } =
    await game.redsteel.getEffectRolls(
      actor,
      null,
      null,
      0,
      0,
      0,
      0,
      false,
      ability,
      modifiers,
    );

  const hasEffects = Object.keys(mechanicalEffects).length > 0;
  const effectsTable = hasEffects
    ? `
<table style="width:100%; text-align:center; font-size:15px;">
  <tr><th>Effects</th></tr>
  <tr>
    <td><b>${allBleedRollResults}</b> ${effectsRollResults}</td>
  </tr>
</table>
`
    : "";

  // Render the test rolls into the message body so the dice are visible (and
  // animated), the same way the non-weapon ability card does.
  const columns = [];
  for (const test of testRolls) {
    columns.push(`
    <div class="roll-column">
      <div class="roll-label">${test.label}</div>
      ${await test.roll.render()}
    </div>
  `);
  }
  const content = columns.length
    ? `<div class="dual-roll">${columns.join("")}</div>`
    : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: testRolls.map((t) => t.roll),
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">${ability.localizedName ?? ability.name}</strong>
</span>
<hr>
${
  hasHtmlContent(description)
    ? `<div style="text-align:center; font-size:16px;">
${description}
</div>`
    : ""
}
${effectsTable}
`,
    flags: {
      ...(hasEffects && { effects: mechanicalEffects }),
    },
  });
}

// Vstřebání krve — discard the caster's whole Blood Reserve and heal Life equal
// to the Maximum Transfer, capped by both the amount discarded and missing Life.
async function runAbsorbBlood(actor, ability) {
  const reserve = Number(actor.system.stats.bloodPool?.value) || 0;
  if (reserve <= 0) {
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.Items.AbsorbBlood.noReserve"),
    );
    return;
  }

  const transfer = Number(actor.system.stats.bloodPool?.transfer) || 0;
  const health = Number(actor.system.stats.health?.value) || 0;
  const healthMax = Number(actor.system.stats.health?.max) || 0;

  // Heal the Max Transfer, but never more than what was cancelled from the
  // Reserve, and never past the Life ceiling.
  const wanted = Math.min(reserve, transfer);
  const newHealth = Math.min(healthMax, health + wanted);
  const healed = newHealth - health;

  await actor.update({
    "system.stats.bloodPool.value": 0,
    "system.stats.health.value": newHealth,
  });

  const label = ability.localizedName ?? ability.name;
  const summary = game.i18n.format("REDSTEEL.Items.AbsorbBlood.result", {
    discarded: reserve,
    healed,
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">${label}</strong>
</span>
<hr>
<div style="text-align:center; font-size:16px; color:#a01818;">
  ${summary}
</div>
`,
  });
}

// Krvavý pakt — the mirror image of Blood Absorption: burn one Mind point (the
// point is spent AND the Mind maximum permanently shrinks, see mindPoints.mjs)
// to fill the Blood Reserve by the Maximum Transfer. Free Action, once a round.
async function runBloodPact(actor, ability) {
  const combat = game.combat;
  const roundKey = combat ? `${combat.id}:${combat.round}` : null;

  // "Jednou za kolo" only bites inside combat — out of combat there are no
  // rounds to limit, so the check is skipped entirely.
  if (
    roundKey &&
    actor.getFlag("redsteel", "bloodPactLastRound") === roundKey
  ) {
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.Items.BloodPact.alreadyUsed"),
    );
    return;
  }

  const pool = actor.system.stats.bloodPool ?? {};
  const poolMax = Number(pool.max) || 0;
  const poolValue = Number(pool.value) || 0;
  if (poolMax <= 0 || poolValue >= poolMax) {
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.Items.BloodPact.reserveFull"),
    );
    return;
  }

  const { burnt, updates } = mindBurnUpdates(actor, 1);
  if (burnt <= 0) {
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.Items.BloodPact.noMind"),
    );
    return;
  }

  const transfer = Number(pool.transfer) || 0;
  const newPool = Math.min(poolMax, poolValue + transfer);
  const gained = newPool - poolValue;

  // One update so the burn and the blood it bought land together.
  await actor.update({
    ...updates,
    "system.stats.bloodPool.value": newPool,
  });
  if (roundKey) await actor.setFlag("redsteel", "bloodPactLastRound", roundKey);

  const label = ability.localizedName ?? ability.name;
  const summary = game.i18n.format("REDSTEEL.Items.BloodPact.result", {
    gained,
    mindValue: Number(actor.system.stats.mind.value) || 0,
    mindMax: Number(actor.system.stats.mind.max) || 0,
  });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">${label}</strong>
</span>
<hr>
<div style="text-align:center; font-size:16px; color:#a01818;">
  ${summary}
</div>
`,
  });
}
