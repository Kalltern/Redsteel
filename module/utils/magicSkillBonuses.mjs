import { getTraitPills } from "./traitPills.mjs";

// --- Helper for Dialogs (CSS Injection) ---
function _injectDialogCSS() {
  const css = `
            .spell-dialog-form {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }

          .casting-options {
            border: 1px solid #5b4a2c;
            border-radius: 4px;
            padding: 8px;
            background: #1f1f1f;
            color: #d0d0d0;
          }

          .casting-options .option-row {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
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

        /* General Dialog styling */
        .spell-dialog .window-content {
            max-width: 520px;
            max-height: 620px;
            width: 100%;
            overflow: hidden;
            background: #1d1d1d;
            color: #d0d0d0;
        }
        .spell-dialog .window{
            width: auto;
            background: #141414;
            border: 1px solid #8b6914;
        }
        .spell-dialog .tab-content {
          max-height: 420px;
          overflow-y: auto;
        }
        
        /* Compact table-style spell list */
        .spell-tabs table {
          width: 100%;
          border-collapse: collapse;
          background: #222121;
          color: #d0d0d0;
          font-size: 12px;
          margin-top: 4px;
        }
        
        .spell-tabs thead tr {
          border-bottom: 2px solid #8b6914;
          background: #1a1a1a;
        }
        
        .spell-tabs th {
          text-align: left;
          padding: 4px 6px;
          color: #c9b26b;
          font-weight: bold;
          text-transform: uppercase;
          font-size: 10px;
          letter-spacing: 0.5px;
        }
        
        .spell-tabs tbody tr {
          border-bottom: 1px solid #444;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        
        .spell-tabs tbody tr:hover {
          background: #3a3a3a;
        }
        
        .spell-tabs td {
          padding: 4px 6px;
          vertical-align: middle;
        }
        
        .icon-cell {
          padding: 2px 4px;
          text-align: center;
        }
        
        .spell-icon {
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
        
        .spell-choice.table-row {
          display: table-row;
        }
    `;

  // Prevent re-injection if already present
  if (!document.getElementById("macro-spell-css")) {
    const styleSheet = document.createElement("style");
    styleSheet.id = "macro-spell-css";
    styleSheet.type = "text/css";
    styleSheet.innerText = css;
    document.head.appendChild(styleSheet);
  }
}

// --- 1. Spell/School Selection Dialog Flow ---

/**
 * Gathers all unique spell schools from the actor's owned spells.
 * @param {object} actor - The Foundry actor object.
 * @returns {Set<string>} - A Set of unique spell school names (e.g., {'earth', 'fire'}).
 */
export function getUniqueSpellSchools(actor) {
  const spellSchools = new Set();
  // Assuming spell school is stored in spell.system.type
  actor.items
    .filter((i) => i.type === "spell")
    .forEach((spell) => {
      if (spell.system.type) {
        spellSchools.add(spell.system.type);
      }
    });
  return spellSchools;
}

/**
 * Handles the complete dialog flow: School Selection -> Spell Selection (with Ranks/Tabs).
 * @param {object} actor - The Foundry actor object.
 * @returns {Promise<object | null>} - A promise that resolves with the selected spell item, or null if canceled.
 */
export function showSpellSelectionDialogs(actor) {
  _injectDialogCSS();
  const schools = Array.from(getUniqueSpellSchools(actor));

  if (schools.length === 0) {
    ui.notifications.warn("This actor has no spells with defined schools.");
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    // --- Inner function to show the second (spell) dialog with Ranks as Tabs ---

    const showSpellDialog = (schoolName, schoolDialog) => {
      if (schoolDialog) schoolDialog.close();

      const allSpells = actor.items.filter(
        (i) => i.type === "spell" && i.system.type === schoolName,
      );

      // Define Ranks (now lowercase) and Group Spells
      const RANK_ORDER = [
        "wild",
        "apprentice",
        "expert",
        "master",
        "grandmaster",
      ];
      const spellsByRank = {};

      // Initialize groups (to ensure order) and populate
      RANK_ORDER.forEach((rank) => (spellsByRank[rank] = []));
      allSpells.forEach((spell) => {
        // Ensure rank is lowercase and default to 'wild'
        const rank = (spell.system.rank || "wild").toLowerCase();
        if (RANK_ORDER.includes(rank)) {
          spellsByRank[rank].push(spell);
        } else {
          // Put unlisted ranks in 'wild' as a fallback
          spellsByRank["wild"].push(spell);
        }
      });

      // --- Generate Tab HTML ---
      let tabHeadersHtml = "";
      let tabContentHtml = "";

      RANK_ORDER.forEach((rank) => {
        const spells = spellsByRank[rank];
        if (spells && spells.length > 0) {
          const tabId = rank;

          // Tab Header (Capitalize the rank name for display)
          tabHeadersHtml += `<div class="tab-item" data-tab="${tabId}">
                        ${rank.charAt(0).toUpperCase() + rank.slice(1)} (${
                          spells.length
                        })
                    </div>`;

          // Tab Content (List of spells) - as table rows
          const spellTableRows = spells
            .map((spell) => {
              const actionCost = spell.system.actionCost || "-";
              const manaCost = spell.system.cost || 0;
              const resources = Array.isArray(spell.system.resources)
                ? spell.system.resources
                : Object.values(spell.system.resources || {});

              let resourceCosts = manaCost > 0 ? `${manaCost} Mana` : "";
              resources.forEach((res) => {
                if (res && res.type && res.amount) {
                  resourceCosts +=
                    (resourceCosts ? ", " : "") + `${res.amount} ${res.type}`;
                }
              });
              resourceCosts = resourceCosts || "-";

              return `
                <tr class="spell-choice ability-choice table-row" data-spell-id="${spell.id}">
                  <td class="icon-cell"><img src="${spell.img}" class="spell-icon" title="${spell.localizedName ?? spell.name}"></td>
                  <td>${spell.localizedName ?? spell.name}</td>
                  <td style="text-align: center;">${actionCost}</td>
                  <td style="text-align: center;">${resourceCosts}</td>
                </tr>
              `;
            })
            .join("");

          tabContentHtml += `
                        <div class="tab-pane" data-tab="${tabId}">
                            <table>
                              <thead>
                                <tr>
                                  <th style="width: 32px;"></th>
                                  <th>Name</th>
                                  <th style="text-align: center; width: 80px;">Action Cost</th>
                                  <th style="text-align: center; width: 100px;">Resource Cost</th>
                                </tr>
                              </thead>
                              <tbody>
                                ${spellTableRows}
                              </tbody>
                            </table>
                        </div>
                    `;
        }
      });

      if (!tabHeadersHtml) {
        ui.notifications.warn(
          `No spells found in the selected school: ${schoolName}`,
        );
        return;
      }

      const dialogContent = `
  <form class="spell-dialog-form">

    <!-- CASTING OPTIONS (ABOVE TABS) -->
    <div class="casting-options">
      <div class="option-row">
        <label>
           Focus:
   <input type="number"
          name="focus"
          value="0"
          min="0"
          step="1"
          style="width: 60px;">
        </label>
       <label>
          <input type="checkbox" name="freeCast">
          Free Cast
        </label>
        <label>
          <input type="checkbox" name="ignoreChanneling">
          No Channeling Evaluation
        </label>

        <label>
          <input type="checkbox" name="maintainChanneling">
          Maintain spell
        </label>
           </div>
       </div>

    <!-- SPELL TABS -->
    <div class="spell-tabs">
      <div class="tab-headers">${tabHeadersHtml}</div>
      <div class="tab-content">${tabContentHtml}</div>
    </div>

  </form>
            `;

      const spellDialog = new Dialog({
        title: `Select ${schoolName} Spell`,
        content: dialogContent,
        buttons: {},
        render: (html) => {
          const app = spellDialog.element[0];
          app.style.height = "auto";
          app.style.minHeight = "360px";
          // 1. Activate initial tab
          const firstTab = html.find(".tab-item").first();
          firstTab.addClass("active");
          html
            .find(`.tab-pane[data-tab="${firstTab.data("tab")}"]`)
            .addClass("active");

          // 2. Handle tab switching
          html.find(".tab-item").click(function () {
            const tab = $(this).data("tab");
            html.find(".tab-item").removeClass("active");
            $(this).addClass("active");
            html.find(".tab-pane").removeClass("active");
            html.find(`.tab-pane[data-tab="${tab}"]`).addClass("active");
          });

          // Spell icon tooltip hover
          html
            .find(".spell-icon")
            .on("mouseenter", function (e) {
              const spellId = $(this).closest(".spell-choice").data("spell-id");
              const spell = allSpells.find((s) => s.id === spellId);
              if (!spell) return;

              const tooltipData = spell.getTooltipData?.();
              if (!tooltipData) {
                $(this).attr("title", spell.localizedName ?? spell.name);
                return;
              }

              const actionCost = spell.system.actionCost || "-";
              const manaCost = Number(spell.system.cost) || 0;
              const resources = Array.isArray(spell.system.resources)
                ? spell.system.resources
                : Object.values(spell.system.resources || {});
              let resourceCosts = manaCost > 0 ? `${manaCost} Mana` : "";
              resources.forEach((res) => {
                if (res && res.type && res.amount) {
                  resourceCosts +=
                    (resourceCosts ? ", " : "") + `${res.amount} ${res.type}`;
                }
              });
              resourceCosts = resourceCosts || "-";

              let tooltipHtml = `<div class="tooltip-title">${tooltipData.title ?? spell.localizedName ?? spell.name}</div>`;
              tooltipHtml += `<div class="tooltip-section"><strong>Action Cost:</strong> ${actionCost}</div>`;
              tooltipHtml += `<div class="tooltip-section"><strong>Resource Cost:</strong> ${resourceCosts}</div>`;
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

              const tooltip = $(
                `<div class="tooltip-popup">${tooltipHtml}</div>`,
              );
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

          // 3. Handle spell selection
          html.find(".spell-choice").click(async (event) => {
            if ($(event.target).hasClass("spell-icon")) return; // Don't select if clicking icon
            const selectedId = $(event.currentTarget).data("spell-id");
            // Find the spell item object using its ID
            const selectedSpell = allSpells.find((s) => s.id === selectedId);
            // Check if the cast is for free
            const freeCast = html.find('input[name="freeCast"]').is(":checked");
            const ignoreChanneling = html
              .find('input[name="ignoreChanneling"]')
              .is(":checked");
            const maintainChanneling = html
              .find('input[name="maintainChanneling"]')
              .is(":checked");
            const focusSpent = Number(
              html.find('input[name="focus"]').val() || 0,
            );

            spellDialog.close();
            resolve({
              spell: selectedSpell,
              freeCast,
              focusSpent,
              ignoreChanneling,
              maintainChanneling,
            });
          });
        },
        close: () => {
          // If the user closes the dialog, resolve with null
          if (!spellDialog.rendered) resolve(null);
        },
      });
      spellDialog.render(true);
    };

    if (schools.length === 1) {
      showSpellDialog(schools[0], null);
      return;
    }

    // --- First Dialog (School Selection - Unchanged) ---
    const schoolDialog = new Dialog({
      title: "Select Spell School",
      content: `<form><fieldset><ul id="school-list" style="list-style: none; padding: 0;">
                ${schools
                  .map(
                    (school) =>
                      `<li class="spell-choice ability-choice"
    data-value="${school}">
  <span class="ability-name">
    ${school.charAt(0).toUpperCase() + school.slice(1)}
  </span>
</li>`,
                  )
                  .join("")}
            </ul></fieldset></form>`,
      buttons: {},
      render: (html) => {
        html.find("#school-list li").click(async (event) => {
          const schoolName = $(event.currentTarget).data("value");
          // Move to the second dialog, passing the first dialog instance to close it
          showSpellDialog(schoolName, schoolDialog);
        });
      },
      close: () => {
        // If the user closes the dialog, resolve with null
        if (!schoolDialog.rendered) resolve(null);
      },
    });
    schoolDialog.render(true);
  });
}

// --- 1.b Spell Variant Selection ---

/**
 * Resolves a spell's variant IDs into valid spell Items.
 * Invalid IDs, missing Items, and non-spell Items are silently ignored.
 * @param {object} spell - The parent spell item.
 * @returns {object[]} - An array of valid variant spell Items (world Items).
 */
export function getValidSpellVariants(spell) {
  const raw = spell.system?.variants;
  const ids = Array.isArray(raw) ? raw : Object.values(raw ?? {});

  const seen = new Set();
  const variants = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || trimmed === spell.id || seen.has(trimmed)) continue;
    const item = game.items.get(trimmed);
    if (!item || item.type !== "spell") continue;
    seen.add(trimmed);
    variants.push(item);
  }
  return variants;
}

/**
 * If the spell has valid variants, prompts the user to choose which version
 * to cast ("Normal" = the parent spell itself, or any linked variant).
 * If no valid variants exist, resolves immediately with the parent spell.
 * @param {object} spell - The parent spell item.
 * @returns {Promise<object | null>} - The spell Item to cast, or null if canceled.
 */
export function showVariantSelectionDialog(spell) {
  const variants = getValidSpellVariants(spell);
  if (!variants.length) return Promise.resolve(spell);

  _injectDialogCSS();

  const parentName = spell.localizedName ?? spell.name;
  const optionsHtml = [
    { id: spell.id, name: "Normal" },
    ...variants.map((v) => ({ id: v.id, name: v.localizedName ?? v.name })),
  ]
    .map(
      (opt, index) => `
        <div class="option-row">
          <label>
            <input type="radio" name="variantChoice" value="${opt.id}"
              ${index === 0 ? "checked" : ""}>
            ${opt.name}
          </label>
        </div>`,
    )
    .join("");

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    new Dialog(
      {
        title: `Cast ${parentName}`,
        content: `
          <form class="spell-dialog-form">
            <p>Choose version:</p>
            <div class="casting-options">
              ${optionsHtml}
            </div>
          </form>`,
        buttons: {
          cast: {
            label: "Cast",
            callback: (html) => {
              const selectedId = html
                .find('input[name="variantChoice"]:checked')
                .val();
              if (selectedId === spell.id) return finish(spell);
              finish(variants.find((v) => v.id === selectedId) ?? spell);
            },
          },
          cancel: {
            label: "Cancel",
            callback: () => finish(null),
          },
        },
        default: "cast",
        close: () => finish(null),
      },
      { classes: ["dialog", "spell-dialog"] },
    ).render(true);
  });
}

// --- 2. Mana Deduction ---

/**
 * Checks mana cost, deducts it from the actor, and updates the actor sheet.
 * @param {object} actor - The Foundry actor object.
 * @param {object} spell - The selected spell item object.
 * @returns {Promise<boolean>} - True if mana was deducted successfully, false otherwise.
 */
export async function deductMana(actor, spell) {
  const updates = {};

  const spellCost = Number(spell.system.cost) || 0;

  if (spellCost) {
    const currentMana = actor.system.stats.mana?.value ?? 0;

    if (currentMana < spellCost) {
      ui.notifications.warn(
        `Not enough mana to cast ${spell.localizedName ?? spell.name} (Cost: ${spellCost}).`,
      );
      return false;
    }

    updates["system.stats.mana.value"] = Math.max(currentMana - spellCost, 0);
  }

  const resources = Array.isArray(spell.system.resources)
    ? spell.system.resources
    : Object.values(spell.system.resources ?? {});

  for (const res of resources) {
    const { type, mode, amount } = res ?? {};
    const amt = Number(amount);

    if (!type || !mode || !amt) continue;

    const statKey = type.toLowerCase();
    const rawBase =
      updates[`system.stats.${statKey}.value`] ??
      actor.system.stats[statKey]?.value ??
      0;

    const baseValue = Number(rawBase);

    let newValue = baseValue;

    if (mode === "drain") {
      newValue = Math.max(baseValue - amt, 0);
    }

    if (mode === "add") {
      newValue = baseValue + amt;
    }

    updates[`system.stats.${statKey}.value`] = newValue;
  }

  /* -------- APPLY -------- */

  if (Object.keys(updates).length) {
    await actor.update(updates);
  }

  return true;
}

// --- 3. Bonus Calculation (Scalable) ---

/**
 * Calculates and aggregates all relevant bonuses for the attack, damage, and effects.
 * This is the central function for making bonuses scalable.
 * NOTE: This function now accepts the spell object to allow for school-based bonuses.
 * @param {object} actor - The Foundry actor object.
 * @param {object} spell - The selected spell item object. (NEW)
 * @returns {object} - An object containing aggregated bonus values.
 */
export function calculateAttackBonuses(actor, spell) {
  let attackBonus = 0;
  let damageBonus = 0;
  let effectModifiers = {};

  // --- Temperament Bonus (Conditional) ---
  const temperamentBonusMap = {
    Melancholic: "earth",
    Choleric: "fire",
    Sanguine: "air",
    Phlegmatic: "water",
    // Add more temperaments and their associated spell schools here
  };

  const spellSchool = spell.system.type; // Get the school of the spell being cast

  // Check if the actor has a matching temperament for the spell's school
  for (const [temperamentName, requiredSchool] of Object.entries(
    temperamentBonusMap,
  )) {
    // Find the item by name AND check if the spell's school matches the required school
    if (
      actor.items.find((i) => i.name === temperamentName) &&
      spellSchool === requiredSchool
    ) {
      // Apply +5 bonus to the attack roll formula
      attackBonus += 5;
      break; // Assuming only one temperament bonus applies
    }
  }

  const rankBonusTables = {
    fire: {
      apprentice: 5,
      expert: 10,
      master: 15,
      grandmaster: 20,
    },

    water: {
      apprentice: 10,
      expert: 15,
      master: 20,
      grandmaster: 30,
    },

    air: {
      apprentice: 10,
      expert: 15,
      master: 20,
      grandmaster: 25,
    },
  };
  const schoolEffects = {
    fire: "burn",
    water: "slow",
    air: "stagger",
  };

  function applyEffect(effectModifiers, effect, value) {
    effectModifiers[effect] = (effectModifiers[effect] || 0) + value;
  }

  function applySchoolTraitBonus(actor, spell, effectModifiers) {
    const school = spell.system.type;
    const damageTypes = [
      spell.system.dmgType1,
      spell.system.dmgType2,
      spell.system.dmgType3,
      spell.system.dmgType4,
    ].filter(Boolean);
    const rank = spell.system.rank;

    if (!spell.system.isOffensive) return;

    // FIRE
    if (actor.system.effects?.fire?.improvedBurn) {
      if (school === "fire" && damageTypes.includes("fire")) {
        const bonus = rankBonusTables.fire[rank];
        if (bonus) applyEffect(effectModifiers, schoolEffects.fire, bonus);
      }
    }

    // WATER
    if (actor.system.effects?.water?.improvedSlow) {
      if (school === "water" && damageTypes.includes("frost")) {
        const bonus = rankBonusTables.water[rank];
        if (bonus) applyEffect(effectModifiers, schoolEffects.water, bonus);
      }
    }

    // AIR
    if (actor.system.effects?.air?.improvedStagger) {
      if (school === "air" && damageTypes.includes("lightning")) {
        const bonus = rankBonusTables.air[rank];
        if (bonus) applyEffect(effectModifiers, schoolEffects.air, bonus);
      }
    }
  }

  // --- Future Addon Example: "Focus" Trait ---
  // if (actor.items.find(i => i.name === "Focus")) {
  //     // Add +10 to all damage rolls (flat number)
  //     damageBonus += 10;
  //     // Add +10 to the 'stagger' effect check
  //     effectModifiers['stagger'] = (effectModifiers['stagger'] || 0) + 10;
  // }

  // --- Future Addon Example: "Bonus Damage" Field ---
  // damageBonus += actor.system.bonusDamage || 0;

  // Combine actor's base effects modifiers (which are always applied)
  const actorEffects = actor.system.effects || {};
  for (const [key, value] of Object.entries(actorEffects)) {
    if (typeof value === "number" && value !== 0) {
      effectModifiers[key] = (effectModifiers[key] || 0) + value;
    }
  }

  applySchoolTraitBonus(actor, spell, effectModifiers);

  return {
    attackBonus,
    damageBonus,
    effectModifiers,
  };
}

// --- 4. Attack Roll ---

/**
 * Performs the magic attack roll.
 * @param {object} actor - The Foundry actor object.
 * @param {object} spell - The selected spell item object.
 * @param {number} bonus - The calculated total bonus for the attack roll formula.
 * @returns {Promise<{attackRoll: object, critSuccess: boolean, critFailure: boolean}>}
 */

function getEffectiveDifficulty(spell, focusSpent) {
  const base = spell.system.difficulty || 0;
  const focusBonus = focusSpent * 10;
  console.log(`base Difficulty`, base);
  console.log(`focus Bonus`, focusBonus);
  return base > 0 ? base : Math.min(0, base + focusBonus);
}

export async function performAttackRoll(
  actor,
  spell,
  bonus,
  focusSpent,
  options = {},
) {
  const effectiveDifficulty = getEffectiveDifficulty(spell, focusSpent);
  const { ignoreChanneling = false } = options;
  const critSuccessThreshold =
    actor.system.combatSkills.channeling.criticalSuccessThreshold;
  const critFailureThreshold =
    actor.system.combatSkills.channeling.criticalFailureThreshold;

  const attackRollFormula = `@combatSkills.channeling.rating + @difficulty + ${bonus} - 1d100`;

  const rollData = {
    combatSkills: actor.system.combatSkills,
    difficulty: effectiveDifficulty,
  };

  const attackRoll = new Roll(attackRollFormula, rollData);
  await attackRoll.evaluate();
  const rollResult = attackRoll.dice[0].results[0].result;
  const displayCritSuccess = rollResult <= critSuccessThreshold;
  const displayCritFailure = rollResult >= critFailureThreshold;

  let critSuccess = false;
  let critFailure = false;

  if (!ignoreChanneling) {
    critSuccess = rollResult <= critSuccessThreshold;
    critFailure = rollResult >= critFailureThreshold;
  }

  return {
    attackRoll,
    critSuccess,
    critFailure,
    displayCritSuccess,
    displayCritFailure,
  };
}

// --- 5. Final Roll and Chat Posting (Centralized) ---

/**
 * Performs Damage, Crit Score, and Effect rolls, and posts the final chat message.
 * @param {object} actor - The Foundry actor object.
 * @param {object} spell - The selected spell item object.
 * @param {object} bonuses - The results from calculateAttackBonuses.
 * @param {object} attackResults - The results from performAttackRoll.
 */
export async function finalizeRollsAndPostChat(
  actor,
  spell,
  bonuses,
  attackResults,
  options = {},
) {
  const {
    ignoreChanneling = false,
    maintainChanneling = false,
    fromChanneling = false,
    focusSpent = 0,
  } = options;
  const {
    attackRoll,
    critSuccess,
    critFailure,
    displayCritSuccess,
    displayCritFailure,
  } = attackResults;
  const { damageBonus, effectModifiers } = bonuses;
  const showCrit = ignoreChanneling
    ? displayCritSuccess || displayCritFailure
    : critSuccess || critFailure;

  // --- Roll Data Setup (needed for Damage/Description) ---
  const rollData = {
    combatSkills: actor.system.combatSkills,
    difficulty: spell.system.difficulty,
    int: actor.system.attributes.int.total,
    wil: actor.system.attributes.wil.total,
    spellPower: actor.system.schools[spell.system.type]?.spellPower || 0,
  };

  const spellAttributeTestName = spell.system.attributeTest || 0;
  const spellTestModifier = spell.system.testModifier || 0;
  const effectiveCritSuccess = ignoreChanneling ? false : critSuccess;
  const isInvalid =
    !spellAttributeTestName || spellAttributeTestName === "--select a type--";

  const capitalizedName = isInvalid
    ? null // or "" depending on your UI needs
    : spellAttributeTestName.charAt(0).toUpperCase() +
      spellAttributeTestName.slice(1);

  const attributeMap = {
    strength: "str",
    dexterity: "dex",
    endurance: "end",
    intelligence: "int",
    will: "wil",
    charisma: "cha",
    perception: "per",
  };
  let concatRollAndDescription = spell.system.description;
  console.log(`Spell Description:`, concatRollAndDescription);
  let attributeTestRoll = null;
  if (
    spellAttributeTestName &&
    spellAttributeTestName !== "-- Select a Type --"
  ) {
    const shortKey =
      attributeMap[spellAttributeTestName.toLowerCase()] ??
      spellAttributeTestName;

    let selectedAttributeModifier = actor.system.attributes[shortKey]?.mod ?? 0;
    if (actor.type === "npc") {
      selectedAttributeModifier = actor.system.attributes[shortKey]?.value ?? 0;
    }

    const attributeRoll = new Roll(
      `(${selectedAttributeModifier} + ${spellTestModifier}) - 1d100`,
      rollData,
    );
    await attributeRoll.evaluate({ async: true });

    // Roll modifier separately for display
    const modifierRoll = new Roll(
      `${selectedAttributeModifier} + ${spellTestModifier || 0}`,
      rollData,
    );
    await modifierRoll.evaluate({ async: true });

    const attributeString = `
    <hr>
  <span style="display:inline-block;">
    ${capitalizedName} Test <span class="mos-followup" data-margin="${attributeRoll.total}" data-source="${spell.localizedName ?? spell.name}" data-tooltip="Test chance ${modifierRoll.total}%<br>Rolled: ${attributeRoll.result}<br>Click to roll an attribute against this margin" style="cursor:pointer; text-decoration:underline dotted;">Margin of Success: [${attributeRoll.total}]</span>
  </span>

`;

    concatRollAndDescription += attributeString;
    attributeTestRoll = attributeRoll;
  }
  // --- DAMAGE ROLL ---
  let damageFormula = spell.system.formula || "1d6";
  damageFormula = damageFormula.replace(
    /@(\w+\.\w+\.\w+|\w+)/g,
    (_, key) => rollData[key] || 0,
  );

  const damageRoll = new Roll(damageFormula, actor.system);
  await damageRoll.evaluate();
  // Add the flat damage bonus from Function 3

  const damageTotal = Math.floor(damageRoll.total + damageBonus);
  damageRoll._total = damageTotal;

  // --- EFFECT ROLLS ---
  const spellEffects = foundry.utils.deepClone(spell.system.effects || {});
  const perkEffects = bonuses.effectModifiers || {};

  const mechanicalEffects = {};
  let effectsRollResults = "";

  // ensure perk effects exist in spellEffects
  for (const effect in perkEffects) {
    if (!(effect in spellEffects)) {
      spellEffects[effect] = 0;
    }
  }

  const spellSchool = spell.system.type;
  const actorEffects = actor.system.effects?.[spellSchool] || {};
  const normalizedActorEffects = Object.fromEntries(
    Object.entries(actorEffects).map(([k, v]) => [k.toLowerCase(), v]),
  );

  const aggregatedEffects = {};

  for (const [key, effectValue] of Object.entries(spellEffects)) {
    let finalEffectName = "";

    const builtinEffects = ["burn", "slow", "stagger", "bleed"];

    if (builtinEffects.includes(key)) {
      finalEffectName = key.toLowerCase();
    } else if (key.startsWith("extra")) {
      const index = key.replace("extra", "");
      const typeValue = spell.system[`effectType${index}`] || "";

      if (typeValue.toLowerCase() === "custom") {
        finalEffectName =
          spell.system.effects[`effectName${index}`] || `custom${index}`;
      } else {
        finalEffectName = typeValue.toLowerCase();
      }
    }

    if (!finalEffectName) continue;

    // ONLY base values here
    aggregatedEffects[finalEffectName] =
      (aggregatedEffects[finalEffectName] || 0) + effectValue;
  }

  for (const [effectName, baseValue] of Object.entries(aggregatedEffects)) {
    const actorBonus = normalizedActorEffects[effectName] || 0;
    const bonusModifier = effectModifiers?.[effectName] || 0;

    const totalEffectValue = baseValue + actorBonus + bonusModifier;

    // --- AUTO SUCCESS CASE ---
    if (totalEffectValue === -1) {
      effectsRollResults += `
    <p><b>|${effectName}|</b></p>
  `;

      mechanicalEffects[effectName] = {
        chance: -1,
        roll: null,
        auto: true,
      };

      continue;
    }

    // --- NORMAL SKIP ---
    if (totalEffectValue <= 0) continue;

    // --- NORMAL ROLL ---
    const d100Roll = new Roll("1d100");
    await d100Roll.evaluate();

    const rollValue = d100Roll.total;
    const successText = rollValue <= totalEffectValue ? " SUCCESS" : "";

    effectsRollResults += `
    <p><b>|${effectName}|</b>
    ${rollValue} < ${totalEffectValue}% ${successText}</p>
  `;

    mechanicalEffects[effectName] = {
      chance: totalEffectValue,
      roll: rollValue,
    };
  }

  // 1.a Handle Mana deduction effect
  const costPerRound = Number(spell.system.perRound) || 0;
  if (maintainChanneling && costPerRound > 0 && !fromChanneling) {
    const existing = actor.effects.find(
      (e) => e.getFlag("core", "statusId") === "channeling",
    );

    if (existing) {
      await existing.delete();
    }

    const effect = await game.redsteel.applyEffect(actor, "channeling");

    if (effect) {
      await effect.setFlag("redsteel", "channelingData", {
        spellId: spell.id,
        rollContext: {
          focusSpent,
        },
        isSustained: spell.system.sustained, // ✅ ADD THIS
      });

      await effect.setFlag("redsteel", "costPerRound", costPerRound);
    }
  }

  if (maintainChanneling && costPerRound <= 0) {
    ui.notifications.warn(
      `${spell.localizedName ?? spell.name} does not allow prolonged channeling.`,
    );
    return;
  }
  // --- CRITICAL SCORE ROLL ---
  const critScoreRoll = new Roll(`1d20`);
  await critScoreRoll.evaluate();
  const critScoreResult =
    critScoreRoll.total + (actor.system.critRangeCast || 0);

  let critScore = 0;
  if (critScoreResult > 1) {
    if (critScoreResult <= 6) critScore = 1;
    else if (critScoreResult <= 12) critScore = 2;
    else if (critScoreResult <= 18) critScore = 3;
    else critScore = 4;
  }

  const critDamageMapping = [0, 5, 5, 10, 20];
  const critBonusDamage = critDamageMapping[critScore] || 0;
  const critBonusPenetration =
    critDamageMapping[critScore] + spell.system.penetration;
  const actorCritBonus = Number(actor.system.critDamage) || 0;
  const critDamageTotal = critBonusDamage + actorCritBonus + damageTotal;

  // --- CHAT MESSAGE CONSTRUCTION ---
  const attack =
    attackRoll.total + (actor.system.combatSkills.channeling.attack || 0);
  const rawTemplate = concatRollAndDescription;
  const compiled = Handlebars.compile(rawTemplate);
  const renderedDescription = compiled(rollData);
  const tags = rollData.difficulty
    ? `<span class="action-tag difficulty ">Difficulty ${rollData.difficulty} </span>
      <span class="action-tag range ">Range ${spell.system.range} </span>
      <span class="action-tag spellClass ">${spell.system.spellClass} Spell</span>
      <span class="action-tag rank ">${spell.system.rank} rank</span>
      <span class="action-tag magicAttack ">Magic ATK ${attack}</span>
      <span class="action-tag actionCost ">Actions:${spell.system.actionCost}</span>
      `
    : "";

  const hasDamage = typeof damageTotal === "number" && damageTotal > 0;
  const hasCritDamage = effectiveCritSuccess === true;
  const showDamageTable = hasDamage;
  const damageHeaders = [
    "<th>Damage</th>",
    hasCritDamage && hasDamage ? "<th>Critical Damage</th>" : "",
  ].join("");

  const damageValues = [
    `<td>${damageTotal}</td>`,
    hasCritDamage && hasDamage ? `<td>${critDamageTotal}</td>` : "",
  ].join("");

  const damageTable = showDamageTable
    ? `
<table style="width: 100%; text-align: center; font-size: 15px;">
  <tr>${damageHeaders}</tr>
  <tr>${damageValues}</tr>
</table>
`
    : "";

  let rollName = spell.localizedName ?? spell.name;
  const hasEffects = effectsRollResults.trim().length > 0;
  const effectsTable = hasEffects
    ? `
  <table style="width: 100%; text-align: center; font-size: 15px;">
    <tr><th>Effects</th></tr>
    <tr><td>${effectsRollResults}</td></tr>
  </table>
  `
    : "";

  const hasPenetration = spell.system.penetration > 0;
  // Critical Score is only meaningful on a critical success (not on failures)
  const hasCrit = (ignoreChanneling ? displayCritSuccess : critSuccess) === true;
  const showTable = hasPenetration || hasCrit;
  const headers = [
    hasPenetration ? "<th>Penetration</th>" : "",
    hasCrit ? "<th>Critical Score</th>" : "",
  ].join("");
  const values = [
    hasPenetration ? `<td>${spell.system.penetration}</td>` : "",
    hasCrit
      ? `<td title="Crit range result ${critScoreResult}">[${critScore}]</td>`
      : "",
  ].join("");
  const critPenTable = showTable
    ? `
<table style="width: 100%; text-align: center; font-size: 15px;">
  <tr>${headers}</tr>
  <tr>${values}</tr>
</table>
`
    : "";

  const rolls = [attackRoll];

  if (hasDamage && damageRoll instanceof Roll) {
    rolls.push(damageRoll);
  }

  const attackHTML = await attackRoll.render();
  const damageHTML = hasDamage ? await damageRoll.render() : "";
  const content = `
<div class="${hasDamage ? "dual-roll" : "single-roll"}">

  <div class="roll-column">
    <div class="roll-label">Margin of Success</div>
    ${attackHTML}
  </div>

  ${
    hasDamage
      ? `
  <div class="roll-column">
    <div class="roll-label">Damage Roll</div>
    ${damageHTML}
  </div>
  `
      : ""
  }

</div>
`;
  let attackFlag = null;
  let effectsFlag = null;

  const damageProfile = {
    expression: [
      spell.system.dmgType1,
      spell.system.bool2,
      spell.system.dmgType2,
      spell.system.bool3,
      spell.system.dmgType3,
      spell.system.bool4,
      spell.system.dmgType4,
    ]
      .filter(Boolean)
      .map((e) => e.toLowerCase()),
  };

  if (hasDamage) {
    attackFlag = {
      type: "attack",
      damageProfile,
      normal: {
        damage: damageTotal,
        penetration: spell.system.penetration,
        halfDamage: spell.system.halfDamage ?? false,
      },

      effects: mechanicalEffects,
    };

    if (!ignoreChanneling && critSuccess) {
      attackFlag.critical = {
        damage: critDamageTotal,
        penetration: critBonusPenetration,
        halfDamage: spell.system.halfDamage ?? false,
      };
    }
  }
  if (Object.keys(mechanicalEffects).length > 0) {
    effectsFlag = mechanicalEffects;
  }

  console.log("Attack Flag:", attackFlag);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    rolls: rolls,
    flavor: `
          <div style="display:flex; align-items:center; justify-content:left; gap:8px; font-size:1.3em; font-weight:bold;">
            <img src="${spell.img}" title="${
              spell.localizedName ?? spell.name
            }" width="36" height="36">
            <span>${spell.localizedName ?? spell.name}</span>
        </div>
        ${tags}
        <hr>
        <p style="text-align: center; font-size: 20px;"><b>
        ${
          ignoreChanneling
            ? displayCritSuccess
              ? "Critical Success!"
              : displayCritFailure
                ? "Critical Failure!"
                : ""
            : critSuccess
              ? "Critical Success!"
              : critFailure
                ? "Critical Failure!"
                : ""
        }
        </b></p>
        <hr>
        <table style="width: 100%; text-align: center;font-size: 15px;">
            <tr><th>Description:</th></tr>
            <tr><td>${renderedDescription}</td></tr>
        </table>
        ${damageTable}
        ${critPenTable}
        ${effectsTable}
        `,
    flags: {
      redsteel: {
        rollName,
        spellSchool: spell.system.type,
        criticalSuccessThreshold:
          actor.system.combatSkills.channeling.criticalSuccessThreshold,
        criticalFailureThreshold:
          actor.system.combatSkills.channeling.criticalFailureThreshold,
        traitPills: getTraitPills(actor, "attack"),
      },
      ...(attackFlag && { attack: attackFlag }),
      ...(effectsFlag && { effects: effectsFlag }),
    },
  });

  if (!ignoreChanneling && critFailure && spell.system.type) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `
<div class="crit-warning">
  <p><b>${actor.name}'s channeling is becoming unstable...</b></p>
  <button class="crit-fail-accept" data-action="acceptCritFail">
    Accept Critical Failure
  </button>
</div>
    `,
      flags: {
        redsteel: {
          type: "critFailPrompt",
          actorId: actor.id,
          spellId: spell.id,
          spellType: spell.system.type,
          spellRank: spell.system.rank,
        },
      },
    });
  }
  //tables -> Flag: "redsteel.critTable: fire"
}

export async function resolveChannelingTick(actor, effect) {
  const data = effect.getFlag("redsteel", "channelingData");
  if (!data) return;

  // ✅ behavior decision lives here
  if (!data.isSustained) return;

  // Variant spells live in the world, not on the actor, so fall back there
  const spell = actor.items.get(data.spellId) ?? game.items.get(data.spellId);
  if (!spell) {
    await effect.delete();
    return;
  }

  const focusSpent = data.rollContext?.focusSpent ?? 0;

  const options = {
    freeCast: true,
    ignoreChanneling: true,
    maintainChanneling: true,
    fromChanneling: true,
  };

  const bonuses = calculateAttackBonuses(actor, spell);

  const attackResults = await performAttackRoll(
    actor,
    spell,
    bonuses.attackBonus,
    focusSpent,
    options,
  );

  await finalizeRollsAndPostChat(actor, spell, bonuses, attackResults, {
    ...options,
    focusSpent,
  });
}
