/**
 * Build the coating descriptor stored on a weapon from a poison consumable.
 * The bonus-damage formula is taken from the poison's own roll (the same
 * `system.formula` prepared in RedsteelItem#prepareData, e.g. "2d6 +3").
 *
 * The poison's combat effects (bleed/stagger/custom effect chances authored on
 * the poison's combatEffects tab) are snapshotted alongside so the coating can
 * fold them into the wielder's attack effect rolls (see getEffectRolls).
 *
 * @param {Item} poison
 * @returns {{name:string, img:string, formula:string, damageType:string,
 *            effects:object, effectType1:string, effectType2:string,
 *            effectType3:string}}
 */
function buildCoating(poison) {
  const ps = poison.system ?? {};
  const roll = ps.roll ?? {};
  const formula =
    ps.formula?.trim() ||
    `${roll.diceNum ?? 0}d${roll.diceSize ?? 0}${
      roll.diceBonus ? ` + ${roll.diceBonus}` : ""
    }`;

  return {
    name: poison.localizedName ?? poison.name,
    img: poison.img,
    formula,
    damageType: "poison",
    // Frozen snapshot: the coating keeps applying these even if the source
    // poison is later edited or consumed.
    effects: foundry.utils.deepClone(ps.effects ?? {}),
    effectType1: ps.effectType1 ?? "",
    effectType2: ps.effectType2 ?? "",
    effectType3: ps.effectType3 ?? "",
  };
}

/**
 * Whether a coating carries any non-damage combat effect worth showing.
 * @param {object} coating
 * @returns {boolean}
 */
function coatingHasEffects(coating) {
  const e = coating?.effects;
  if (!e) return false;
  return [
    e.bleed,
    e.stagger,
    e.extra1,
    e.extra2,
    e.extra3,
  ].some((v) => Number(v) !== 0);
}

/** Consume one dose of a poison, deleting it when it runs out. */
async function consumeOneDose(poison) {
  const qty = poison.system.quantity ?? 1;
  if (qty > 1) {
    await poison.update({ "system.quantity": qty - 1 });
  } else {
    await poison.delete();
  }
}

/** Apply a poison's coating to a weapon, consume a dose, and announce it. */
async function coatWeapon(actor, poison, weapon) {
  const coating = buildCoating(poison);
  await weapon.setFlag("redsteel", "coating", coating);
  await consumeOneDose(poison);

  const effectsRow = coatingHasEffects(coating)
    ? `<tr><td><p>Bonus effects: ${describeCoatingEffects(coating)}</p></td></tr>`
    : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `
      <span style="display:inline-flex; align-items:center;">
        <img src="${poison.img}" title="${coating.name}" width="36" height="36" style="margin-right:8px;">
        <strong style="font-size:20px;">Coating ${weapon.localizedName ?? weapon.name}</strong>
      </span>
      <table style="width: 100%; text-align: center; font-size: 15px;">
        <tr><th>Poison Coating</th></tr>
        <tr><td><b><p>${coating.name}</p><p>Bonus damage: ${coating.formula}</p></b></td></tr>
        ${effectsRow}
      </table>
    `,
  });
}

/**
 * Human-readable summary of a coating's combat effects, e.g. "Bleed +70%".
 * Mirrors the effect-name resolution used by the attack effect rolls.
 * @param {object} coating
 * @returns {string}
 */
function describeCoatingEffects(coating) {
  const e = coating.effects ?? {};
  const parts = [];
  const fmt = (label, value) => {
    const v = Number(value) || 0;
    if (v === 0) return;
    parts.push(`${label} ${v === -1 ? "AUTO" : `+${v}%`}`);
  };

  fmt("Bleed", e.bleed);
  fmt("Stagger", e.stagger);
  for (let i = 1; i <= 3; i++) {
    const type = coating[`effectType${i}`];
    if (!type) continue;
    const name = type === "custom" ? e[`effectName${i}`] || "Custom" : type;
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    fmt(label, e[`extra${i}`]);
  }
  return parts.join(", ") || "—";
}

/**
 * Prompt the actor to choose one of their weapons and coat it with the given
 * poison. Reusable by both the standalone poison flow and the merged potion
 * dialog.
 *
 * @param {Actor} actor
 * @param {Item}  poison   A consumable with `option === "poison"`.
 */
export function applyPoisonToWeapon(actor, poison) {
  const weapons = actor.items.filter((i) => i.type === "weapon");

  if (!weapons.length) {
    ui.notifications.warn("No weapons to coat.");
    return;
  }

  let dialog;
  dialog = new Dialog({
    title: `Coat with ${poison.localizedName ?? poison.name}`,
    content: `
      <form>
        <ul id="poison-weapon-list" style="list-style: none; padding: 0;">
          ${weapons
            .map((w, i) => {
              const coated = w.getFlag("redsteel", "coating");
              const suffix = coated
                ? ` <em style="opacity:.7;">(coated: ${coated.name})</em>`
                : "";
              return `
              <li class="potion-choice" data-value="${i}" style="cursor: pointer; padding: 5px; border-bottom: 1px solid #444;">
                ${w.localizedName ?? w.name}${suffix}
              </li>`;
            })
            .join("")}
        </ul>
      </form>
    `,
    classes: ["potion-dialog"],
    buttons: {},
    render: function (html) {
      html.find("#poison-weapon-list li").click(async (event) => {
        const index = parseInt(event.currentTarget.dataset.value);
        dialog.close();
        await coatWeapon(actor, poison, weapons[index]);
      });
    },
  });

  dialog.render(true);
}

export async function usePoison() {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor } = context;

  const poisons = actor.items.filter(
    (i) => i.type === "consumable" && i.system.option === "poison",
  );

  if (!poisons.length) {
    ui.notifications.warn("No poisons left.");
    return;
  }

  let dialog;
  dialog = new Dialog({
    title: "Select Poison",
    content: `
      <form>
        <ul id="poison-list" style="list-style: none; padding: 0;">
          ${poisons
            .map(
              (p, i) => `
              <li class="potion-choice" data-value="${i}" style="cursor: pointer; padding: 5px; border-bottom: 1px solid #444;">
                ${p.localizedName ?? p.name} (${p.system.quantity ?? 1})
              </li>`,
            )
            .join("")}
        </ul>
      </form>
    `,
    classes: ["potion-dialog"],
    buttons: {},
    render: function (html) {
      html.find("#poison-list li").click((event) => {
        const index = parseInt(event.currentTarget.dataset.value);
        dialog.close();
        applyPoisonToWeapon(actor, poisons[index]);
      });
    },
  });

  dialog.render(true);
}

/**
 * Remove a poison coating from a weapon.
 * @param {Item} weapon
 */
export async function clearWeaponCoating(weapon) {
  if (weapon?.getFlag("redsteel", "coating")) {
    await weapon.unsetFlag("redsteel", "coating");
  }
}
