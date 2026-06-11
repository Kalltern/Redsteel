import { getTraitPills } from "./traitPills.mjs";

export async function defenseRoll({ actor, weapon, ability = null } = {}) {
  if (!actor) {
    const context = game.redsteel.selectToken();
    if (!context) return;

    actor = context.actor;
  }

  const hasGuard = actor.effects.some(
    (e) =>
      e.getFlag("core", "statusId") === "guard" || e.statuses?.has("guard"),
  );

  /* -------------------------------------------- */
  /*  SHARED CSS                                  */
  /* -------------------------------------------- */

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

/* Defense dialog buttons */
.dialog .dialog-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.dialog .dialog-buttons button {
  width: 100%;
  min-width: 0;
}
`;

  if (!document.getElementById("redsteel-defense-css")) {
    const styleSheet = document.createElement("style");
    styleSheet.id = "redsteel-defense-css";
    styleSheet.type = "text/css";
    styleSheet.innerText = css;
    document.head.appendChild(styleSheet);
  }

  /* -------------------------------------------- */
  /*  Overwrite the logic if the ability is given */
  /* -------------------------------------------- */
  if (ability) {
    if (ability.system?.rangedDefense != null) {
      return rangedDefense({ ability, weapon });
    }

    if (ability.system?.dodge != null) {
      return dodgeDefense({ ability, weapon });
    }

    if (ability.system?.defense != null) {
      return meleeDefense({ ability, weapon });
    }
  }

  /* -------------------------------------------- */
  /*  DEFENSE SELECTOR                            */
  /* -------------------------------------------- */

  const isCharacter = actor.type === "character";
  const hasActiveSet = isCharacter && actor.system.combat?.activeWeaponSet;

  const activeSetPreview = hasActiveSet
    ? renderWeaponLoadoutsDialog(actor)
    : "";

  let hasLongReach = false;

  // Try active weapon first (PC flow)
  const context = game.redsteel.resolveWeaponContext(actor, ability);
  const activeWeapon = context?.weapon;

  if (activeWeapon?.system?.longReach) {
    hasLongReach = true;
  } else if (actor.type !== "character") {
    hasLongReach = actor.items.some(
      (i) => i.type === "weapon" && i.system?.longReach,
    );
  }

  if (!ability) {
    const buttons = {
      melee: {
        label: "Melee Defense",
        callback: (html) => {
          const overwhelm = Number(
            html.find('input[name="overwhelm"]:checked').val(),
          );
          const longReachPenalty = html
            .find('[name="longReachPenalty"]')
            .is(":checked")
            ? -5
            : 0;

          meleeDefense({ overwhelm, longReachPenalty });
        },
      },

      ranged: {
        label: "Ranged Defense",
        callback: (html) => {
          const overwhelm = Number(
            html.find('input[name="overwhelm"]:checked').val(),
          );
          rangedDefense({ overwhelm });
        },
      },
    };

    if (hasGuard) {
      buttons.guardMelee = {
        label: "Melee Guard",
        callback: (html) => {
          const overwhelm = Number(
            html.find('input[name="overwhelm"]:checked').val(),
          );

          meleeDefense({
            overwhelm,
            ability: { system: { defense: -10 } },
          });
        },
      };

      buttons.guardRanged = {
        label: "Ranged Guard",
        callback: (html) => {
          const overwhelm = Number(
            html.find('input[name="overwhelm"]:checked').val(),
          );

          rangedDefense({
            overwhelm,
            ability: { system: { rangedDefense: -10 } },
          });
        },
      };
    }

    buttons.dodge = {
      label: "Dodge",
      callback: (html) => {
        const overwhelm = Number(
          html.find('input[name="overwhelm"]:checked').val(),
        );
        dodgeDefense({ overwhelm });
      },
    };
    // Add spell defense if actor can use magic
    if (actor.system.magicPotential || actor.system.priest) {
      buttons.spell = {
        label: "Magic defense",
        callback: (html) => {
          const overwhelm = Number(
            html.find('input[name="overwhelm"]:checked').val(),
          );
          spellDefense({ overwhelm });
        },
      };
    }

    const dialog = new Dialog({
      title: "Select Defense Type",
      content: `
      ${activeSetPreview}
      <hr>
      <div style="margin-bottom:8px;">
        <label style="font-weight:bold;margin-right:6px;">Overwhelm:</label>
        ${[0, 1, 2, 3, 4]
          .map(
            (i) => `
          <label style="margin-right:6px;">
            <input type="radio" name="overwhelm" value="${i}" ${i === 0 ? "checked" : ""}>
            ${i}
          </label>
        `,
          )
          .join("")}
      </div>

        ${
          hasLongReach
            ? `
      <div style="margin-top:6px;">
        <label>
          <input type="checkbox" name="longReachPenalty">
          Long Reach penalty (-5)
        </label>
      </div>
    `
            : ""
        }
    `,
      buttons: buttons,
      default: "melee",
      render: (html) => {
        html.find(".weapon-set-toggle").on("click", async () => {
          await game.redsteel.switchWeaponSet(actor);

          dialog.close();
          defenseRoll({ actor }); // 🔁 reopen with updated preview
        });
      },
    });

    dialog.render(true);
  }

  /* -------------------------------------------- */
  /*  WEAPON DIALOG                               */
  /* -------------------------------------------- */

  function showWeaponDialog(weapons, onSelect) {
    new Dialog({
      title: "Select Weapon",
      content: `
      <form>
        <fieldset>
          <ul id="weapon-list" style="list-style:none;padding:0;">
            ${weapons
              .map(
                (weapon, index) => `
                <li class="weapon-choice"
                    data-value="${index}"
                    style="cursor:pointer;padding:5px;border-bottom:1px solid #444;">
                  ${weapon.localizedName ?? weapon.name}
                </li>`,
              )
              .join("")}
          </ul>
        </fieldset>
      </form>
      `,
      buttons: {},
      resizable: true,
      width: 200,
      height: 100,
      render: (html) => {
        html.find("#weapon-list li").click(async (event) => {
          const index = Number(event.currentTarget.dataset.value);
          await onSelect(index);
        });
      },
    }).render(true);
  }
  /* -------------------------------------------- */
  /*  MELEE DEFENSE                               */
  /* -------------------------------------------- */
  async function meleeDefense({
    ability = null,
    weapon = null,
    overwhelm = 0,
    longReachPenalty = 0,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;
      const offProps = getOffhandProps(context);
      const rollName = `Defense with ${weapon.localizedName ?? weapon.name}`;
      const mainDefense = Number(weapon.system.defense) || 0;
      const offDefense = Number(offProps?.defense) || 0;
      const mainCrit = Number(weapon.system.critDefense) || 0;
      const offCrit = Number(offProps?.critDefense) || 0;
      const overwhelmPenalty = overwhelm * -5;
      console.log("DEFENSE CONTEXT:", context);

      const { doctrineCritDefenseBonus, doctrineDefenseBonus } =
        await game.redsteel.getDoctrineBonuses(actor, weapon);

      const defense = actor.system.combatSkills.meleeDefense;
      const defenseRating = defense.rating;
      const abilityDefense = Number(ability?.system?.defense) || 0;

      const criticalSuccessThreshold =
        defense.criticalSuccessThreshold +
        mainCrit +
        offCrit +
        doctrineCritDefenseBonus;

      const criticalFailureThreshold = defense.criticalFailureThreshold;

      const rollData = {
        defenseRating,
        weaponDefense: mainDefense + offDefense,
        doctrineDefenseBonus,
        abilityDefense,
        overwhelmPenalty,
        longReachPenalty,
      };

      const roll = new Roll(
        "@defenseRating + @weaponDefense + @doctrineDefenseBonus + @abilityDefense + @overwhelmPenalty + @longReachPenalty - 1d100",
        rollData,
      );

      await roll.evaluate();

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelm,
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) {
        return resolveWithContext(context);
      }
    }
    /* -------------------------------------------- */
    /*  IF WEAPON ALREADY KNOWN → SKIP DIALOG       */
    /* -------------------------------------------- */
    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    /* -------------------------------------------- */
    /*  OTHERWISE → ASK PLAYER                     */
    /* -------------------------------------------- */
    const weapons = actor.items.filter(
      (i) =>
        i.type === "weapon" &&
        ["axe", "sword", "blunt", "polearm"].includes(i.system.class) &&
        i.system.thrown !== true,
    );

    if (!weapons.length) {
      ui.notifications.warn("This actor has no melee weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  /* -------------------------------------------- */
  /*  RANGED DEFENSE                              */
  /* -------------------------------------------- */
  async function rangedDefense({
    ability = null,
    weapon = null,
    overwhelm = 0,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;
      const offProps = getOffhandProps(context);

      const rollName = `Ranged defense with ${weapon.localizedName ?? weapon.name}`;

      const { doctrineCritDefenseBonus, doctrineRangedDefenseBonus } =
        await game.redsteel.getDoctrineBonuses(actor, weapon);

      const defense = actor.system.combatSkills.rangedDefense;
      const overwhelmPenalty = overwhelm * -5;
      const abilityDefense = Number(ability?.system?.rangedDefense) || 0;

      const criticalSuccessThreshold =
        defense.criticalSuccessThreshold + doctrineCritDefenseBonus;

      const criticalFailureThreshold = defense.criticalFailureThreshold;

      const rollData = {
        defenseRating: defense.rating,
        doctrineRangedDefenseBonus,
        abilityDefense,
        overwhelmPenalty,
      };

      const roll = new Roll(
        "@defenseRating + @doctrineRangedDefenseBonus + @abilityDefense + @overwhelmPenalty - 1d100",
        rollData,
      );

      await roll.evaluate();

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelm,
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) return resolveWithContext(context);
    }

    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    const weapons = actor.items.filter((i) => i.type === "weapon");

    if (!weapons.length) {
      ui.notifications.warn("This actor has no weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  /* -------------------------------------------- */
  /*  DODGE DEFENSE                               */
  /* -------------------------------------------- */

  async function dodgeDefense({
    ability = null,
    weapon = null,
    overwhelm = 0,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;
      const offProps = getOffhandProps(context);

      const rollName = `Dodge with ${weapon.localizedName ?? weapon.name}`;

      const mainDodge = Number(weapon.system.dodge) || 0;
      const offDodge = Number(offProps?.dodge) || 0;
      const offCritDodge = Number(offProps?.critDodge) || 0;

      const dodge = actor.system.combatSkills.dodge;
      const abilityDefense = Number(ability?.system?.dodge) || 0;
      const overwhelmPenalty = overwhelm * -5;

      const criticalSuccessThreshold =
        dodge.criticalSuccessThreshold +
        (Number(weapon.system.critDodge) || 0) +
        offCritDodge;

      const criticalFailureThreshold = dodge.criticalFailureThreshold;

      const staminaCost = 4;
      const stamina = actor.system.stats.stamina.value ?? 0;

      if (stamina < staminaCost) {
        ui.notifications.warn("Not enough stamina!");
        return;
      }

      await actor.update({
        "system.stats.stamina.value": stamina - staminaCost,
      });

      const rollData = {
        dodgeRating: dodge.rating,
        weaponDodge: mainDodge + offDodge,
        abilityDefense,
        overwhelmPenalty,
      };

      const roll = new Roll(
        "@dodgeRating + @weaponDodge + @abilityDefense + @overwhelmPenalty - 1d100",
        rollData,
      );

      await roll.evaluate();
      const d100 = roll.dice.find((d) => d.faces === 100);
      const d100Result = d100?.total;
      const dodgeFailed =
        d100Result > actor.system.dodgeLimit.total && roll.total >= 0;
      console.log("dodgeFailed", dodgeFailed);

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelm,
        { dodgeFailed },
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) return resolveWithContext(context);
    }

    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    const weapons = actor.items.filter((i) => i.type === "weapon");

    if (!weapons.length) {
      ui.notifications.warn("This actor has no weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  async function spellDefense({ overwhelm = 0 } = {}) {
    const overwhelmPenalty = overwhelm * -5;
    // ─────────────────────────────
    // Priest: Holy Defense
    // ─────────────────────────────
    if (actor.system.priest) {
      let holyEnergy = actor.system.stats.holyEnergy.value ?? 0;
      let holyEnergyCast = actor.system.stats.holyEnergy.cast ?? 0;

      if (holyEnergy <= 0) {
        ui.notifications.warn("Not enough Holy Energy!");
        return;
      }

      await actor.update({
        "system.stats.holyEnergy.value": holyEnergy - 1,
      });

      const faith = actor.system.secondaryAttributes.fth.total ?? 0;

      const roll = new Roll(
        "@holyEnergyCast + @faithBonus + @overwhelmPenalty - 1d100",
        {
          holyEnergyCast,
          faithBonus: faith * 8,
          overwhelmPenalty,
        },
      );

      await roll.evaluate();

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<strong>Holy Defense</strong>`,
        flags: {
          redsteel: { traitPills: getTraitPills(actor, "defense") },
        },
      });

      return;
    }

    // ─────────────────────────────
    // Magic Defense (non-priests)
    // ─────────────────────────────

    const defenseLevels = {
      Wild: 0,
      Apprentice: 1,
      Expert: 2,
      Master: 3,
      Grandmaster: 5,
    };

    new Dialog({
      title: "Magic defense",
      content: `<p>Select your Magic defense level:</p>`,
      buttons: Object.entries(defenseLevels).reduce(
        (buttons, [level, cost]) => {
          buttons[level] = {
            label: `${level} (-${cost} Mana)`,
            callback: async () => {
              const mana = actor.system.stats.mana.value ?? 0;

              if (mana < cost) {
                ui.notifications.warn("Not enough Mana!");
                return;
              }

              await actor.update({
                "system.stats.mana.value": mana - cost,
              });

              const rating =
                actor.system.combatSkills.channeling.rating +
                actor.system.combatSkills.channeling.defense;

              const roll = new Roll("@rating + @overwhelmPenalty - 1d100", {
                rating,
                overwhelmPenalty,
              });

              await roll.evaluate();

              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `
                <div style="display:flex;align-items:center;gap:8px;font-size:1.3em;font-weight:bold;">
                  <img src="icons/magic/defensive/shield-barrier-blades-teal.webp" width="36" height="36">
                  <span>Magic Defense (${level})</span>
                </div>

                ${overwhelm > 0 ? `<p style="text-align:center">Overwhelm: -${overwhelm * 5}</p>` : ""}
                `,
                flags: {
                  redsteel: { traitPills: getTraitPills(actor, "defense") },
                },
              });
            },
          };

          return buttons;
        },
        {},
      ),
      default: "Wild",
    }).render(true);
  }
  /* -------------------------------------------- */
  /*  CHAT MESSAGE                                */
  /* -------------------------------------------- */

  async function createDefenseChatMessage(
    roll,
    weapon,
    rollName,
    criticalSuccessThreshold,
    criticalFailureThreshold,
    overwhelm,
    { dodgeFailed = false } = {},
  ) {
    const rollResult = roll.dice[0].total;

    const critSuccess = rollResult <= criticalSuccessThreshold;
    const critFailure = rollResult >= criticalFailureThreshold;

    const armor = actor.system.armor;

    const armorRows = [
      ["Armor", armor.total],
      ["Acid Armor", armor.acid.total],
      ["Fire Armor", armor.fire.total],
      ["Frost Armor", armor.frost.total],
      ["Lightning Armor", armor.lightning.total],
      ["Magic Armor", armor.magic.total],
    ].filter(([label, value]) => {
      if (label === "Armor") return true;
      return value > 0;
    });

    const armorTable = `
      <table style="width:100%;text-align:center;font-size:15px;">
        <tr><th>Type</th><th>Value</th></tr>
        ${armorRows
          .map(
            ([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`,
          )
          .join("")}
      </table>
    `;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: [roll],
      flavor: `
        <div style="display:flex;align-items:center;gap:8px;font-size:1.3em;font-weight:bold;">
          <img src="${weapon.img}" width="36" height="36">
          <span>${rollName}</span>
        </div>
        <hr>
        <p style="text-align:center;font-size:20px;"><b>
          ${
            critSuccess
              ? "Critical Success!"
              : critFailure
                ? "Critical Failure!"
                : dodgeFailed
                  ? "Bad Dodge!"
                  : ""
          }

        </b></p>
          <div style="display:flex;justify-content:center;align-items:center;gap:8px;font-size:1.3em;font-weight:bold;">
            ${overwhelm > 0 ? `<p>Overwhelm: -${overwhelm * 5}</p>` : ""}
          </div>
       ${armorTable}        
      `,
      flags: {
        redsteel: {
          rollName,
          criticalSuccessThreshold,
          criticalFailureThreshold,
          traitPills: getTraitPills(actor, "defense"),
        },
      },
    });
  }
}

function buildWeaponSetView(actor) {
  const sets = actor.system.combat.weaponSets;
  const result = {};

  for (const setId of [1, 2]) {
    const slots = sets?.[setId] ?? {};
    const main = slots.main ? actor.items.get(slots.main) : null;
    const off = slots.off ? actor.items.get(slots.off) : null;

    const mainIsTwoHanded = main
      ? main.system.type === "heavy" ||
        ["crossbow", "box"].includes(main.system.class) ||
        main.system.gripMode === "two"
      : false;

    const offIsShield = !!off?.system?.shield;

    result[setId] = {
      main,
      off,
      mainIsTwoHanded,
      offIsShield,
    };
  }

  return result;
}
function renderWeaponLoadoutsDialog(actor) {
  const weaponSets = buildWeaponSetView(actor);
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

function getOffhandProps(weaponContext) {
  if (!weaponContext?.isDualWield || !weaponContext.offWeapon) {
    return null;
  }
  return weaponContext.offWeapon.system.offhandProperties ?? null;
}
