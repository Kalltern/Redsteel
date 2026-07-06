import { selectAimedPart } from "./aimedStrike.mjs";

export async function attackActions() {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;

  const hasThrownWeapon = actor.items.some(
    (i) => i.type === "weapon" && i.system.thrown === true,
  );

  const hasExplosive = actor.items.some(
    (i) => i.type === "consumable" && i.system.option === "explosive",
  );
  const actions = {};

  if (actor.type === "character") {
    // Characters: single smart attack
    actions["Attack"] = "autoAttack";
  } else {
    // NPCs: explicit intent
    actions["Melee attack"] = "meleeAttack";
    actions["Ranged attack"] = "rangedAttack";
  }

  if (hasThrownWeapon) {
    actions["Throwing"] = "throwingAttack";
  }

  if (hasExplosive) {
    actions["Throw explosive"] = "throwExplosive";
  }

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
  const modifierAbilities = actor.items.filter(
    (i) => i.type === "ability" && i.system.modifiesAttack === true,
  );
  // Pre-select the Aim radio from any stacks already aimed at the current target.
  const preAim = game.redsteel.getAimStacks?.(token) ?? 0;
  const content = `
<form>
  ${activeSetPreview}

  <hr>

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
  <hr>

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


</form>
<hr>
<div class="attack-modifiers">
  ${modifierAbilities
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
    .join("")}
</div>
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
`;

  const buttons = {};

  for (const [label, fnName] of Object.entries(actions)) {
    buttons[label] = {
      label,
      callback: async (html) => {
        const useSneak = html.find('[name="sneakAttack"]').is(":checked");
        const useFlanking = html.find('[name="flanking"]').is(":checked");
        const useAimedStrike = html.find('[name="aimedStrike"]').is(":checked");
        const longReachPenalty = html
          .find('[name="longReachPenalty"]')
          .is(":checked")
          ? -5
          : 0;
        const aimValue =
          parseInt(html.find('input[name="aim"]:checked').val()) || 0;

        // ─── Aimed Strike: ask body part before proceeding ───
        if (useAimedStrike) {
          const part = await selectAimedPart();
          if (part) {
            await actor.setFlag("redsteel", "aimedPart", part);
          } else {
            await actor.unsetFlag("redsteel", "aimedPart");
          }
        } else {
          await actor.unsetFlag("redsteel", "aimedPart");
        }

        // ─── Flags ───
        useSneak
          ? await actor.setFlag("redsteel", "useSneakAttack", true)
          : await actor.unsetFlag("redsteel", "useSneakAttack");

        useFlanking
          ? await actor.setFlag("redsteel", "useFlankingAttack", true)
          : await actor.unsetFlag("redsteel", "useFlankingAttack");

        aimValue > 0
          ? await actor.setFlag("redsteel", "aimCount", aimValue)
          : await actor.unsetFlag("redsteel", "aimCount");

        // ─── Collect Modifiers ───
        const selectedModifierIds = Array.from(
          html[0].querySelectorAll(".attack-modifier-checkbox:checked"),
        ).map((cb) => cb.dataset.abilityId);

        const selectedModifiers = modifierAbilities.filter((mod) =>
          selectedModifierIds.includes(mod.id),
        );

        // ─── Deduct Costs ───
        const paid = await game.redsteel.deductAbilityCost(
          actor,
          selectedModifiers,
        );
        if (!paid) return;

        // ─── Execute Attack ───
        await game.redsteel[fnName]({
          actor,
          token,
          selectedModifiers,
          longReachPenalty,
        });
      },
    };
  }
  // Inject CSS once
  if (!document.getElementById("redsteel-attack-dialog-styles")) {
    const style = document.createElement("style");
    style.id = "redsteel-attack-dialog-styles";

    style.textContent = `
  .attack-options-row {
    display: flex !important;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }

  .attack-options-row label {
    display: flex !important;
    align-items: center;
    gap: 4px;
    margin: 0;
    white-space: nowrap;
  }

  .attack-options-row input[type="checkbox"] {
    margin: 0;
  }
`;

    document.head.appendChild(style);
  }

  const dialog = new Dialog({
    title: "Select Attack Action",
    content,
    buttons,
    default: Object.keys(buttons)[0],

    render: (html) => {
      html.find(".weapon-set-toggle").on("click", async () => {
        await game.redsteel.switchWeaponSet(actor);
        dialog.close();

        // Re-open with refreshed state
        attackActions();
      });
    },
  });

  dialog.render(true);
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

function resolveActiveWeaponForAttack(actor, attackType) {
  if (actor.type !== "character") return null;

  const activeSet = actor.system.combat?.activeWeaponSet;
  if (!activeSet) return null;

  const set = actor.system.combat.weaponSets?.[activeSet];
  if (!set?.main) return null;

  const weapon = actor.items.get(set.main);
  if (!weapon || weapon.type !== "weapon") return null;

  let category = "melee";
  if (["bow", "crossbow"].includes(weapon.system.class)) category = "ranged";
  else if (weapon.system.thrown === true) category = "throwing";

  if (category !== attackType) return null;

  const offItem = set.off ? actor.items.get(set.off) : null;
  const hasShield = !!offItem?.system?.shield;

  return { weapon, hasShield };
}

export async function autoAttack(options = {}) {
  const actor = options.actor ?? canvas.tokens.controlled[0]?.actor;
  if (!actor) return;

  const token = options.token ?? canvas.tokens.controlled[0] ?? null;

  //
  //  Pre-resolved context branch
  //
  if (options.weaponContext?.weapon) {
    const weapon = options.weaponContext.weapon;

    const isThrown = weapon.system.thrown === true;
    const isRanged = ["bow", "crossbow"].includes(weapon.system.class);

    if (isThrown)
      return game.redsteel.throwingAttack({
        context: options.weaponContext,
        selectedModifiers: options.selectedModifiers ?? [],
      });

    if (isRanged)
      return game.redsteel.rangedAttack({
        context: options.weaponContext,
        selectedModifiers: options.selectedModifiers ?? [],
      });

    return game.redsteel.meleeAttack({
      context: options.weaponContext,
      selectedModifiers: options.selectedModifiers ?? [],
      longReachPenalty: options.longReachPenalty ?? 0,
    });
  }

  //
  //  Character smart resolution
  //
  if (actor.type === "character") {
    const activeSet = actor.system.combat?.activeWeaponSet;
    const weaponSets = game.redsteel.buildWeaponSetView(actor);
    const ws = weaponSets[activeSet];

    if (activeSet && ws?.main) {
      const weapon = ws.main;

      const isThrown = weapon.system.thrown === true;
      const isRanged = ["bow", "crossbow"].includes(weapon.system.class);

      const context = {
        weapon,
        offWeapon: ws.off || null,
        isDualWield: ws.isDualWield || false,
        hasShield: ws.offIsShield || false,
      };

      if (isThrown)
        return game.redsteel.throwingAttack({
          context,
          selectedModifiers: options.selectedModifiers ?? [],
        });

      if (isRanged)
        return game.redsteel.rangedAttack({
          context,
          selectedModifiers: options.selectedModifiers ?? [],
        });

      return game.redsteel.meleeAttack({
        context,
        selectedModifiers: options.selectedModifiers ?? [],
        longReachPenalty: options.longReachPenalty ?? 0,
      });
    }

    // 🔥 Fallback if no main weapon
    return game.redsteel.universalAttackLogic({
      attackType: "attack",
      flavorLabel: "Attack",
      showBreakthrough: true,
      weaponFilter: (i) => i.type === "weapon",
      getWeaponSkillData: (actor, weapon) =>
        game.redsteel.getWeaponSkillBonuses(actor, weapon),
      selectedModifiers: options.selectedModifiers ?? [],
    });
  }

  //
  //  NPC fallback
  //
  return game.redsteel.meleeAttack({
    selectedModifiers: options.selectedModifiers ?? [],
    longReachPenalty: options.longReachPenalty ?? 0,
  });
}
