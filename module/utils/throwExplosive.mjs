import { getTraitPills } from "./traitPills.mjs";
import {
  withRollBias,
  tagRollSkill,
  applyDesperateCrit,
} from "./rollAdvantage.mjs";

/** Local copy of the damage-profile builder used across the attack pipeline. */
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

export async function throwExplosive(options = {}) {
  let actor = options.actor ?? null;
  let token = options.token ?? null;

  if (!actor) {
    const context = game.redsteel.selectToken({ notifyFallback: true });
    if (!context) return;
    actor = context.actor;
    token = context.token;
  }

  const consumables = actor.items.filter(
    (i) => i.type === "consumable" && i.system.option === "explosive",
  );

  if (!consumables.length) {
    ui.notifications.warn("This actor has no explosives.");
    return;
  }

  const explosiveChoices = consumables.map((consumable) => ({
    label: consumable.localizedName ?? consumable.name,
    id: consumable.id,
    quantity: consumable.system.quantity ?? 0,
  }));

  const handleExplosiveSelection = async (itemId) => {
    // Re-resolve the live item: the picker's snapshot goes stale once a throw
    // consumes (or deletes) the explosive.
    const consumable = actor.items.get(itemId);
    if (!consumable || (consumable.system.quantity ?? 0) <= 0) {
      ui.notifications.warn("No more of this explosive remaining.");
      return;
    }
    const s = consumable.system;

    // ─── Consume attack-modifying flags (before the formula is built) ───
    let attackBonus = 0;

    const aimValue = actor.getFlag("redsteel", "aimCount");
    if (aimValue > 0) {
      attackBonus += aimValue * 10;
      await actor.unsetFlag("redsteel", "aimCount");
    }

    if (actor.getFlag("redsteel", "useFlankingAttack")) {
      attackBonus += 10;
      await actor.unsetFlag("redsteel", "useFlankingAttack");
    }

    // Sneak attack and aimed-part targeting don't apply to explosives, but
    // clear them so they can't leak into a later attack.
    await actor.unsetFlag("redsteel", "useSneakAttack");
    await actor.unsetFlag("redsteel", "sneakAccessCounter");
    await actor.unsetFlag("redsteel", "aimedPart");

    // ─── Attack roll (always built — aimed or area) ───
    const throwing = actor.system.combatSkills.throwing;
    const useFinesse = throwing.finesseRating > throwing.rating;

    const formula = `@combatSkills.throwing.${useFinesse ? "finesseRating" : "rating"} + ${attackBonus} - 1d100`;

    const attackRoll = new Roll(
      formula,
      withRollBias({ combatSkills: actor.system.combatSkills }, actor),
    );
    tagRollSkill(attackRoll, "throwing");
    await attackRoll.evaluate();
    const rollResult = attackRoll.dice[0].total;

    const criticalSuccessThreshold = throwing.criticalSuccessThreshold;
    const criticalFailureThreshold = throwing.criticalFailureThreshold;

    const {
      successThreshold: critSuccessThreshold,
      failureThreshold: critFailThreshold,
    } = applyDesperateCrit(
      attackRoll,
      criticalSuccessThreshold,
      criticalFailureThreshold,
    );
    const critSuccess = rollResult <= critSuccessThreshold;
    const critFailure = rollResult >= critFailThreshold;

    // ─── Damage roll ───
    const damageRoll = new Roll(s.formula || "1d6");
    await damageRoll.evaluate();
    const damageTotal = Math.floor(damageRoll.total);

    // ─── Mechanical effects (burn / freeze / stagger) ───
    const mechanicalEffects = {};
    let effectResults = "";

    const effectLabels = {
      burn: "Burn",
      freeze: "Freeze",
      stagger: "Stagger",
    };

    for (const name of ["burn", "freeze", "stagger"]) {
      const value = Number(s[name]) || 0;
      if (value === -1) {
        mechanicalEffects[name] = { chance: null, roll: null, auto: true };
        effectResults += `<p><b>|${effectLabels[name]}|</b></p>`;
        continue;
      }

      if (value <= 0) continue;

      const d100Roll = new Roll("1d100");
      await d100Roll.evaluate();

      const roundedValue = Math.floor(value);
      const success = d100Roll.total <= roundedValue;
      const successText = success
        ? `<i class="fa-regular fa-star" style="--fa-primary-color: #c4c700; --fa-secondary-color: #5c5400;"></i> SUCCESS`
        : "";

      mechanicalEffects[name] = {
        chance: roundedValue,
        roll: d100Roll.total,
        auto: false,
      };

      effectResults += `<p><b>| ${effectLabels[name]}: </b>${d100Roll.total} | < ${roundedValue}% ${successText}</p>`;
    }

    // ─── Damage profile from the explosive's damage-type fields ───
    const damageProfile = buildDamageProfile(s);

    // ─── Chat card ───
    const damageLine = `
<div style="
  display:grid;
  column-gap: 24px;
  font-size:16px;
  max-width: fit-content;
  margin: 0 auto;
">

  <div style="
    display:grid;
    grid-template-columns: auto 1fr;
    column-gap: 8px;
  ">
    <div>Damage:</div>
    <div style="text-align:center;">
      ${damageTotal}
    </div>

    <div>Penetration:</div>
    <div style="text-align:center;">
      ${Number(s.penetration) || 0}
    </div>

<div></div>
</div>
`;

    const attackHTML = await attackRoll.render();
    const damageHTML = await damageRoll.render();
    const content = `
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
`;

    const rollName = `Threw ${consumable.localizedName ?? consumable.name}`;
    const flavor = `
<div style="display:flex; align-items:center; gap:8px; font-size:1.3em; font-weight:bold;">
  <img src="${consumable.img}" width="36" height="36">
  <span>${rollName}</span>
</div>

<p style="text-align:center; font-size:14px;">
  ${s.aimed ? "Single target" : "Area effect"}
</p>

<p style="text-align:center; font-size:20px;"><b>
  ${critSuccess ? "Critical Success!" : critFailure ? "Critical Failure!" : ""}
</b></p>
<hr>
${damageLine}
<hr>
<table style="width:100%; text-align:center; font-size:15px;">
  <tr>
    <th>Explosive Effects</th>
    <td>${effectResults}</td>
  </tr>
</table>
`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      content,
      rolls: [attackRoll, damageRoll],
      flavor,

      flags: {
        redsteel: {
          rollName,
          criticalSuccessThreshold: critSuccessThreshold,
          criticalFailureThreshold: critFailThreshold,
          traitPills: getTraitPills(actor, "attack"),
        },

        attack: {
          type: "attack",
          damageProfile,
          effects: mechanicalEffects,
          normal: {
            damage: damageTotal,
            penetration: Number(s.penetration) || 0,
          },
        },
      },
    });

    // ─── Consume quantity only after the chat card is safely created ───
    if (s.quantity > 0) {
      const newQty = s.quantity - 1;
      if (newQty > 0) {
        await consumable.update({ "system.quantity": newQty });
      } else {
        await consumable.delete();
      }
    }
  };

  // Inject CSS (once per session, guarded by element id)
  if (!document.getElementById("redsteel-explosive-dialog-styles")) {
    const style = document.createElement("style");
    style.id = "redsteel-explosive-dialog-styles";
    style.textContent = `
    #explosive-list .explosive-choice {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 16px;
      cursor: pointer;
      padding: 5px;
      border-bottom: 1px solid #444;
    }

    #explosive-list .explosive-qty {
      color: #c8a84b;
      font-weight: bold;
    }

    #explosive-list .explosive-choice:hover {
      text-shadow: 0 0 2px red;
    }

    .explosive-dialog .window-content {
      max-width: 300px;
    }
  `;
    document.head.appendChild(style);
  }

  const dialog = new Dialog({
    title: "Select Explosive",
    content: `
      <ul id="explosive-list" style="list-style:none; padding:0;">
        ${explosiveChoices
          .map(
            (c) =>
              `<li class="explosive-choice" data-item-id="${c.id}">
                <span>${c.label}</span>
                <span class="explosive-qty">×${c.quantity}</span>
              </li>`,
          )
          .join("")}
      </ul>
    `,
    buttons: {},
    render: (html) => {
      html.find(".explosive-choice").each((_, el) => {
        el.addEventListener("click", async () => {
          // Close first so the list can't hand out stale quantities.
          dialog.close();
          await handleExplosiveSelection(el.dataset.itemId);
        });
      });
    },
  });
  dialog.render(true);
}
