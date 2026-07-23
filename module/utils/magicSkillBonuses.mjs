import { getTraitPills } from "./traitPills.mjs";
import { getSpellPower } from "./spellPower.mjs";
import { withRollBias, applyDesperateCrit } from "./rollAdvantage.mjs";
import { getCritDegreeTriggers } from "../helpers/specialisations.mjs";

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
            flex-wrap: wrap;
            align-items: center;
            gap: 6px 8px;
            font-size: 14px;
          }

          .focus-stepper {
            display: inline-flex;
            align-items: center;
            gap: 2px;
          }

          .focus-stepper input[name="focus"] {
            width: 34px;
            text-align: center;
          }

          .focus-btn {
            width: 20px;
            height: 20px;
            line-height: 1;
            padding: 0;
            flex: 0 0 auto;
            background: #2f2b24;
            border: 1px solid #8b6914;
            border-radius: 4px;
            color: #f0e4b8;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
          }

          .focus-btn:hover {
            background: #3d3729;
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
            max-height: 620px;
            width: 100%;
            box-sizing: border-box;
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

              const difficulty = Number(spell.system.difficulty) || 0;
              // Initial chance assumes 0 focus; the focus input recalculates
              // this live (see recalcCastChances in the render handler).
              const castChance = getCastChance(actor, spell, 0);

              return `
                <tr class="spell-choice ability-choice table-row" data-spell-id="${spell.id}">
                  <td class="icon-cell"><img src="${spell.img}" class="spell-icon" title="${spell.localizedName ?? spell.name}"></td>
                  <td>${spell.localizedName ?? spell.name}</td>
                  <td style="text-align: center;">${actionCost}</td>
                  <td style="text-align: center;">${resourceCosts}</td>
                  <td style="text-align: center;">${difficulty}</td>
                  <td class="cast-chance-cell" style="text-align: center;">${castChance}%</td>
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
                                  <th style="text-align: center; width: 70px;">Difficulty</th>
                                  <th style="text-align: center; width: 80px;">Cast Chance</th>
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
        </label>
        <div class="focus-stepper">
          <button type="button" class="focus-btn focus-minus" tabindex="-1">−</button>
          <input type="number"
          name="focus"
          value="0"
          min="0"
          step="1">
          <button type="button" class="focus-btn focus-plus" tabindex="-1">+</button>
        </div>
       <label>
          <input type="checkbox" name="freeCast">
          Free Cast
        </label>
        <label>
          <input type="checkbox" name="ignoreChanneling">
          No Channeling Evaluation
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

      const spellDialog = new Dialog(
        {
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

          // 2.b Recalculate the Cast Chance column whenever Focus changes, so
          // it always reflects the value that will go into the roll.
          const recalcCastChances = () => {
            const focus = Number(html.find('input[name="focus"]').val() || 0);
            html.find(".cast-chance-cell").each(function () {
              const spellId = $(this)
                .closest(".spell-choice")
                .data("spell-id");
              const spell = allSpells.find((s) => s.id === spellId);
              if (!spell) return;
              $(this).text(`${getCastChance(actor, spell, focus)}%`);
            });
          };
          html
            .find('input[name="focus"]')
            .on("input change", recalcCastChances);

          // 2.c +/- stepper buttons for quick Focus adjustment.
          const stepFocus = (delta) => {
            const input = html.find('input[name="focus"]');
            const next = Math.max(0, (Number(input.val()) || 0) + delta);
            input.val(next);
            recalcCastChances();
          };
          html.find(".focus-plus").click(() => stepFocus(1));
          html.find(".focus-minus").click(() => stepFocus(-1));

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
            const focusSpent = Number(
              html.find('input[name="focus"]').val() || 0,
            );

            spellDialog.close();
            resolve({
              spell: selectedSpell,
              freeCast,
              focusSpent,
              ignoreChanneling,
            });
          });
        },
        close: () => {
          // If the user closes the dialog, resolve with null
          if (!spellDialog.rendered) resolve(null);
        },
        },
        { classes: ["dialog", "spell-dialog"], width: 480 },
      );
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
 * Resolves a single variant id into a spell Item. Compendiums are searched
 * first (variant ids are stored as compendium document ids, e.g. the All-Spells
 * pack), then world items as a fallback. Non-spell / missing ids resolve null.
 * @param {string} id - A bare document id (no "Compendium.…Item." prefix).
 * @returns {Promise<Item|null>}
 */
async function resolveVariantItem(id) {
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    // Indexes are normally built at world init; rebuild only if this pack's is
    // empty so a cold pack still resolves.
    let entry = pack.index.get(id);
    if (!entry && pack.index.size === 0) {
      await pack.getIndex();
      entry = pack.index.get(id);
    }
    if (!entry) continue;
    const doc = await pack.getDocument(id);
    if (doc?.type === "spell") return doc;
  }
  const worldItem = game.items.get(id);
  return worldItem?.type === "spell" ? worldItem : null;
}

/**
 * Resolves a spell's variant IDs into valid spell Items. Each id is looked up
 * in compendiums first, then world items. Invalid IDs, missing Items, and
 * non-spell Items are silently ignored.
 * @param {object} spell - The parent spell item.
 * @returns {Promise<object[]>} - Valid variant spell Items (compendium or world).
 */
export async function getValidSpellVariants(spell) {
  const raw = spell.system?.variants;
  const ids = Array.isArray(raw) ? raw : Object.values(raw ?? {});

  const seen = new Set();
  const variants = [];
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed || trimmed === spell.id || seen.has(trimmed)) continue;
    const item = await resolveVariantItem(trimmed);
    if (!item) continue;
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
export async function showVariantSelectionDialog(spell) {
  const variants = await getValidSpellVariants(spell);
  if (!variants.length) return spell;

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

  // Blood school spells cost blood from the blood pool instead of mana
  const isBloodSpell = spell.system.type === "blood";

  if (spellCost) {
    if (isBloodSpell) {
      const currentBlood = actor.system.stats.bloodPool?.value ?? 0;

      if (currentBlood < spellCost) {
        ui.notifications.warn(
          `Not enough blood to cast ${spell.localizedName ?? spell.name} (Cost: ${spellCost}).`,
        );
        return false;
      }

      updates["system.stats.bloodPool.value"] = Math.max(
        currentBlood - spellCost,
        0,
      );
    } else {
      const currentMana = actor.system.stats.mana?.value ?? 0;

      if (currentMana < spellCost) {
        ui.notifications.warn(
          `Not enough mana to cast ${spell.localizedName ?? spell.name} (Cost: ${spellCost}).`,
        );
        return false;
      }

      updates["system.stats.mana.value"] = Math.max(
        currentMana - spellCost,
        0,
      );
    }
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

/**
 * Calculates the chance (0-100) that a spell cast will succeed for the given
 * actor. This mirrors the margin-of-success roll in performAttackRoll
 * (`rating + difficulty + bonus - 1d100 >= 0`), so the value shown in the
 * selection dialog is exactly the chance that goes into the roll.
 *
 * Focus is applied via getEffectiveDifficulty: each focus point reduces a
 * negative difficulty by 10 toward zero, but never improves the chance past
 * the 0-difficulty baseline.
 * @param {object} actor - The casting actor.
 * @param {object} spell - The spell item being cast.
 * @param {number} [focusSpent=0] - Focus points committed to the cast.
 * @returns {number} - Cast chance, clamped to the 0-100 range.
 */
/**
 * Resolve the cast rating used for a spell. Blood spells (school `blood`) cast
 * off the higher of the Intelligence-based channeling rating and the
 * Willpower-based Blood Manipulation rating (Manipulace s krví); every other
 * school uses channeling.
 * @param {object} actor - The casting actor.
 * @param {object} spell - The spell item being cast.
 * @returns {number} - The effective cast rating.
 */
export function getCastRating(actor, spell) {
  const channeling = actor.system.combatSkills?.channeling?.rating ?? 0;
  if (spell?.system?.type === "blood") {
    const bloodManipulation =
      actor.system.combatSkills?.bloodManipulation?.rating ?? 0;
    return Math.max(channeling, bloodManipulation);
  }
  return channeling;
}

export function getCastChance(actor, spell, focusSpent = 0) {
  const rating = getCastRating(actor, spell);
  const effectiveDifficulty = getEffectiveDifficulty(spell, focusSpent);
  const { attackBonus } = calculateAttackBonuses(actor, spell);
  const chance = rating + effectiveDifficulty + attackBonus;
  return Math.max(0, Math.min(100, chance));
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

  // Blood spells cast off the higher of channeling and Blood Manipulation; all
  // other schools use channeling. Resolve to a number so the chosen rating
  // drives the roll.
  const castRating = getCastRating(actor, spell);
  const attackRollFormula = `${castRating} + @difficulty + ${bonus} - 1d100`;

  const rollData = {
    combatSkills: actor.system.combatSkills,
    difficulty: effectiveDifficulty,
  };

  const attackRoll = new Roll(attackRollFormula, withRollBias(rollData, actor));
  await attackRoll.evaluate();
  const rollResult = attackRoll.dice[0].total;
  // Desperate Effort shifts crit thresholds for this spell attack.
  const { successThreshold: critSuccessT, failureThreshold: critFailT } =
    applyDesperateCrit(attackRoll, critSuccessThreshold, critFailureThreshold);
  const displayCritSuccess = rollResult <= critSuccessT;
  const displayCritFailure = rollResult >= critFailT;

  let critSuccess = false;
  let critFailure = false;

  if (!ignoreChanneling) {
    critSuccess = rollResult <= critSuccessT;
    critFailure = rollResult >= critFailT;
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
  // The cast landed when the margin of success is ≥ 0. Everything the cast
  // imposes on the *caster* (channeling upkeep, caster effects, Mental Duel)
  // hangs off this — a botched cast must not sustain or self-debuff.
  const castSucceeded = spellCastSucceeded(attackResults);

  // --- Roll Data Setup (needed for Damage/Description) ---
  const rollData = {
    combatSkills: actor.system.combatSkills,
    difficulty: spell.system.difficulty,
    int: actor.system.attributes.int.total,
    wil: actor.system.attributes.wil.total,
    spellPower: getSpellPower(actor, spell.system.type),
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
      withRollBias({ ...rollData }, actor),
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

  // 1.a Start channeling automatically for any spell with a per-round upkeep,
  // but only when the cast actually landed — a failed cast has nothing to
  // sustain. A reroll that turns the failure into a success starts it late
  // (see applyPostCastEffects in castSpell.mjs).
  if (castSucceeded && !fromChanneling) {
    await startChannelingForSpell(actor, spell, { focusSpent });
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
  // Healing spells reuse the damage roll as the heal amount but post a Heal
  // card (Apply Healing button) instead of an attack card. No crit bonus.
  const isHealing = !!spell.system.isHealing && hasDamage;
  const hasCritDamage = effectiveCritSuccess === true && !isHealing;

  // --- S3: crit-degree effect triggers (spec nodes) ---
  // On a spell critical of sufficient degree, owned nodes either boost an
  // effect the spell already casts (+100% chance) or force a new one onto the
  // card. Runs before the flags/effects table are built so it flows through the
  // normal Apply-Effects UI unchanged (only the trigger is new).
  if (effectiveCritSuccess && critScore > 0 && !isHealing) {
    for (const trig of getCritDegreeTriggers(actor)) {
      if (critScore < trig.minDegree) continue;
      const existing = mechanicalEffects[trig.effect];

      if (trig.mode === "boost") {
        // Boost only lifts an effect the spell already rolled.
        if (!existing) continue;
        const base = existing.chance < 0 ? 100 : existing.chance;
        existing.chance = base + 100;
        existing.roll = existing.roll ?? 1;
        existing.auto = false;
        existing.critBoosted = trig.node;
      } else {
        // Force: guarantee the effect even if the spell did not roll it.
        mechanicalEffects[trig.effect] = {
          chance: 100,
          roll: 1,
          critForced: trig.node,
        };
      }

      effectsRollResults += `
    <p><b>|${trig.effect}|</b> — critical ${critScore}° ${
      trig.mode === "force" ? "guaranteed" : "+100%"
    }</p>
  `;
    }
  }

  const showDamageTable = hasDamage;
  const damageHeaders = [
    `<th>${isHealing ? "Healing" : "Damage"}</th>`,
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
    <div class="roll-label">${isHealing ? "Healing Roll" : "Damage Roll"}</div>
    ${damageHTML}
  </div>
  `
      : ""
  }

</div>
`;
  let attackFlag = null;
  let effectsFlag = null;
  let healFlag = null;

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

  if (hasDamage && !isHealing) {
    attackFlag = {
      type: "attack",
      // Lets the Apply Damage dialog offer the spell half-damage toggle.
      isSpell: true,
      damageProfile,
      normal: {
        damage: damageTotal,
        penetration: spell.system.penetration,
      },

      effects: mechanicalEffects,
    };

    if (!ignoreChanneling && critSuccess) {
      attackFlag.critical = {
        damage: critDamageTotal,
        penetration: critBonusPenetration,
      };
    }
  }
  // Healing spells: the rolled amount is restored, not dealt. Posts a Heal
  // card that renders an Apply Healing button (see redsteel.mjs render hook).
  if (isHealing) {
    healFlag = { total: damageTotal };
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
        casterUuid: actor.uuid,
        criticalSuccessThreshold:
          actor.system.combatSkills.channeling.criticalSuccessThreshold,
        criticalFailureThreshold:
          actor.system.combatSkills.channeling.criticalFailureThreshold,
        traitPills: getTraitPills(actor, "attack"),
        // A failed cast applied nothing to the caster. Carry enough context to
        // redo that side if a reroll turns the margin positive — the reroll
        // re-evaluates this card's own margin formula, so the new total is
        // directly comparable (see executeReroll).
        ...(!castSucceeded &&
          !fromChanneling && {
            pendingCast: {
              spellUuid: spell.uuid,
              spellId: spell.id,
              casterUuid: actor.uuid,
              focusSpent,
              ignoreChanneling,
            },
          }),
      },
      ...(attackFlag && { attack: attackFlag }),
      ...(effectsFlag && { effects: effectsFlag }),
      ...(healFlag && { heal: healFlag }),
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

/**
 * Whether a spell cast landed: the margin-of-success roll
 * (`rating + difficulty + bonus - 1d100`) came out at 0 or better.
 *
 * Shared by the cast pipeline and the chat reroll handler so "did it work?"
 * is answered the same way in both, including for a reroll whose margin is
 * re-derived from the same formula.
 *
 * @param {object} attackResults - Result of performAttackRoll (or a reroll
 *   shaped the same way).
 * @returns {boolean}
 */
export function spellCastSucceeded(attackResults) {
  // A margin of exactly 0 is a success, so this must not lean on falsiness.
  const total = Number(attackResults?.attackRoll?.total);
  return Number.isFinite(total) && total >= 0;
}

/**
 * Start (or restart) the Channeling effect that carries a spell's per-round
 * upkeep. That mana-per-round cost is what marks a spell as "kept going" after
 * the initial cast (concentration/sustained); `sustained` then decides whether
 * each round re-rolls the spell (see {@link resolveChannelingTick}). No opt-in:
 * the player cancels the Channeling effect whenever they want.
 *
 * Spells without an upkeep are a no-op, so callers don't need to pre-check.
 *
 * @param {Actor} actor - The casting actor.
 * @param {Item} spell - The spell being sustained.
 * @param {{focusSpent?: number}} [options]
 * @returns {Promise<ActiveEffect|null>} The channeling effect, if one started.
 */
export async function startChannelingForSpell(
  actor,
  spell,
  { focusSpent = 0 } = {},
) {
  const costPerRound = Number(spell.system.perRound) || 0;
  if (costPerRound <= 0) return null;

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
      isSustained: spell.system.sustained,
    });

    await effect.setFlag("redsteel", "costPerRound", costPerRound);
  }

  return effect;
}

export async function resolveChannelingTick(actor, effect) {
  const data = effect.getFlag("redsteel", "channelingData");
  if (!data) return;

  // ✅ behavior decision lives here
  if (!data.isSustained) return;

  // Variant spells may live on the actor, in the world, or (when cast straight
  // from a pack) in a compendium — resolve in that order.
  const spell =
    actor.items.get(data.spellId) ??
    game.items.get(data.spellId) ??
    (await resolveVariantItem(data.spellId));
  if (!spell) {
    await effect.delete();
    return;
  }

  const focusSpent = data.rollContext?.focusSpent ?? 0;

  const options = {
    freeCast: true,
    ignoreChanneling: true,
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
