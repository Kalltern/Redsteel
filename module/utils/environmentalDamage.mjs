/**
 * GM-only "environmental damage" tray: a small DialogV2 where the GM enters a
 * dice expression, a flat bonus, penetration and optional damage types, rolls
 * it, and posts a normal damage chat card. The card carries `flags.attack`
 * with no attacker actor/token behind its speaker, so it runs through the
 * existing Apply Damage pipeline (armor, penetration, shields, resistances,
 * temp HP, Dying) exactly like a weapon or explosive card, while every
 * attacker-side perk (Open Wound, Laceration, Blood Harvest, Blood Strike,
 * sneak, …) resolves against a null attacker and becomes a no-op. See
 * module/redsteel.mjs (applyDamageAsGM, ~renderChatMessageHTML hooks) for how
 * the card is picked up; nothing there needed to change.
 *
 * Deliberately tagged `type: "environment"` rather than `"attack"`, so this
 * card stays out of the Defend button, NPC auto-defense, Overwhelm inference
 * and strike-consumption gates, all of which key off `attack.type ===
 * "attack"`.
 */

/**
 * The damage-type vocabulary weapons emit and `evaluateDmgVsArmor` reads (see
 * module/documents/item.mjs ~619, `system.dmgTypes`). Each entry must match a
 * `system.armor.<type>` key in template.json exactly, or resistances against
 * it never apply. Ordered like the item list, not the hotbar's DAMAGE_TYPES.
 */
const DAMAGE_TYPES = [
  "blunt",
  "piercing",
  "slash",
  "physical",
  "acid",
  "dark",
  "fire",
  "frost",
  "holy",
  "lightning",
  "magic",
  "poison",
  "psychic",
];

const FACE_OPTIONS = [4, 6, 8, 10, 12, 20];

const DEFAULT_LAST_USED = {
  label: "",
  count: 1,
  faces: 6,
  bonus: 0,
  penetration: 0,
  types: [],
  connector: "and",
};

export async function environmentalDamage() {
  const localize = (key) =>
    game.i18n.localize(`REDSTEEL.EnvironmentalDamage.${key}`);

  if (!game.user.isGM) {
    ui.notifications.warn(localize("GMOnly"));
    return;
  }

  // Sticky per-GM tray state: a hazard (a trap, a burning room) is usually
  // rolled several times per scene, so the tray should reopen where it left
  // off rather than back at 1d6 every time.
  let last = DEFAULT_LAST_USED;
  try {
    const stored = game.settings.get("redsteel", "environmentalDamageLast");
    if (stored && typeof stored === "object") {
      last = { ...DEFAULT_LAST_USED, ...stored };
    }
  } catch (err) {
    console.warn(
      "Redsteel |",
      "Failed to read environmentalDamageLast setting",
      err,
    );
  }

  const facesOptions = FACE_OPTIONS.map(
    (faces) =>
      `<option value="${faces}" ${last.faces === faces ? "selected" : ""}>${faces}</option>`,
  ).join("");

  const typeCheckboxes = DAMAGE_TYPES.map((type) => {
    const checked = last.types.includes(type) ? "checked" : "";
    const typeLabel = game.i18n.localize(
      `REDSTEEL.EnvironmentalDamage.Type.${type}`,
    );
    return `
      <label class="rs-envdmg-type">
        <input type="checkbox" name="rs-envdmg-type" value="${type}" ${checked}>
        <span>${typeLabel}</span>
      </label>`;
  }).join("");

  const escapedLabel = foundry.utils.escapeHTML(last.label ?? "");

  const DialogV2 = foundry.applications.api.DialogV2;
  const result = await DialogV2.wait({
    window: { title: localize("Title"), icon: "fa-light fa-fire" },
    classes: ["redsteel", "rs-envdmg-dialog"],
    position: { width: 320 },
    content: `
      <form>
        <div class="rs-envdmg-row rs-envdmg-source">
          <label>${localize("Source")}</label>
          <input type="text" name="rs-envdmg-label" value="${escapedLabel}"
            placeholder="${localize("SourcePlaceholder")}">
        </div>

        <div class="rs-envdmg-row rs-envdmg-dice">
          <label>${localize("Dice")}</label>
          <div class="rs-envdmg-dice-line">
            <input type="number" name="rs-envdmg-count" min="0" max="100" step="1" value="${last.count}">
            <span>d</span>
            <select name="rs-envdmg-faces">${facesOptions}</select>
            <span>+</span>
            <input type="number" name="rs-envdmg-bonus" step="1" value="${last.bonus}">
          </div>
        </div>

        <div class="rs-envdmg-row rs-envdmg-pen">
          <label>${localize("Penetration")}</label>
          <input type="number" name="rs-envdmg-pen" min="0" step="1" value="${last.penetration}">
        </div>

        <div class="rs-envdmg-types">
          <div class="rs-envdmg-heading">${localize("DamageTypes")}</div>
          <div class="rs-envdmg-hint">${localize("TypesHint")}</div>
          <div class="rs-envdmg-type-grid">${typeCheckboxes}</div>
        </div>

        <div class="rs-envdmg-row rs-envdmg-connector">
          <label>${localize("Connector")}</label>
          <select name="rs-envdmg-connector">
            <option value="and" ${last.connector === "and" ? "selected" : ""}>${localize("ConnectorAnd")}</option>
            <option value="or" ${last.connector === "or" ? "selected" : ""}>${localize("ConnectorOr")}</option>
          </select>
        </div>
      </form>`,
    buttons: [
      {
        action: "roll",
        label: localize("Roll"),
        icon: "fa-light fa-dice",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? button.form;
          return {
            label: root.querySelector('input[name="rs-envdmg-label"]')?.value ?? "",
            count: root.querySelector('input[name="rs-envdmg-count"]')?.value,
            faces: root.querySelector('select[name="rs-envdmg-faces"]')?.value,
            bonus: root.querySelector('input[name="rs-envdmg-bonus"]')?.value,
            penetration: root.querySelector('input[name="rs-envdmg-pen"]')?.value,
            types: Array.from(
              root.querySelectorAll('input[name="rs-envdmg-type"]:checked'),
            ).map((input) => input.value),
            connector: root.querySelector('select[name="rs-envdmg-connector"]')
              ?.value,
          };
        },
      },
    ],
    rejectClose: false,
  });

  if (!result) return; // cancelled or closed

  // ─── Sanitize ───
  let count = Math.floor(Number(result.count));
  if (!Number.isFinite(count)) count = 0;
  count = Math.min(100, Math.max(0, count));

  const facesNum = Number(result.faces);
  const faces = FACE_OPTIONS.includes(facesNum) ? facesNum : 6;

  let bonus = Math.trunc(Number(result.bonus));
  if (!Number.isFinite(bonus)) bonus = 0;

  let penetration = Math.trunc(Number(result.penetration));
  if (!Number.isFinite(penetration)) penetration = 0;
  penetration = Math.max(0, penetration);

  // Keep DAMAGE_TYPES order regardless of tick order, so the expression and
  // the footer pill read consistently every time.
  const types = DAMAGE_TYPES.filter((type) => result.types.includes(type));
  const connector = result.connector === "or" ? "or" : "and";
  const label = String(result.label ?? "").trim();

  try {
    await game.settings.set("redsteel", "environmentalDamageLast", {
      label,
      count,
      faces,
      bonus,
      penetration,
      types,
      connector,
    });
  } catch (err) {
    console.warn(
      "Redsteel |",
      "Failed to save environmentalDamageLast setting",
      err,
    );
  }

  if (count === 0 && bonus === 0) {
    ui.notifications.warn(localize("NothingToRoll"));
    return;
  }

  // ─── Roll ───
  const dicePart = count > 0 ? `${count}d${faces}` : null;
  const parts = [];
  if (dicePart) parts.push(dicePart);
  if (bonus !== 0) {
    parts.push(
      parts.length === 0
        ? String(bonus)
        : bonus > 0
          ? `+ ${bonus}`
          : `- ${Math.abs(bonus)}`,
    );
  }
  const formula = parts.join(" ");

  const roll = new Roll(formula);
  await roll.evaluate();
  const damage = Math.max(0, Math.floor(roll.total));

  // ─── Expression, types interleaved with the chosen connector ───
  const expression = [];
  types.forEach((type, index) => {
    if (index > 0) expression.push(connector);
    expression.push(type);
  });

  // ─── Card ───
  const title = label || localize("Title");
  const escapedTitle = foundry.utils.escapeHTML(title);

  // Copied in shape from throwExplosive.mjs's damageLine block (~198-224),
  // with localized labels instead of hardcoded English.
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
    <div>${localize("DamageLabel")}</div>
    <div style="text-align:center;">
      ${damage}
    </div>

    <div>${localize("PenetrationLabel")}</div>
    <div style="text-align:center;">
      ${penetration}
    </div>

<div></div>
</div>
`;

  const flavor = `
<div style="display:flex; align-items:center; gap:8px; font-weight:bold;">
  <i class="fa-light fa-fire" style="font-size:28px;"></i>
  <span>${escapedTitle}</span>
</div>
<hr>
${damageLine}
`;

  const content = `
<div class="roll-column">
  <div class="roll-label">${localize("DamageRoll")}</div>
  ${await roll.render()}
</div>`;

  await ChatMessage.create({
    speaker: {
      scene: canvas?.scene?.id ?? null,
      actor: null,
      token: null,
      alias: localize("Speaker"),
    },
    content,
    flavor,
    rolls: [roll],
    flags: {
      redsteel: {
        environmentalDamage: true,
      },
      attack: {
        type: "environment",
        damageProfile: { expression },
        normal: {
          damage,
          penetration,
        },
      },
    },
  });
}
