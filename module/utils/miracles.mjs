/**
 * MIRACLES (Zázraky)
 *
 * A miracle is a spell Item with `system.option === "divine"`. It is granted,
 * not channeled: casting one takes no test and always happens. What it does
 * roll is its Magic ATK, the number a defender contests:
 *
 *     holyEnergy.cast + Faith * 8 - 1d100
 *
 * `system.stats.holyEnergy.cast` is the Priest tree's "Faith Test on
 * Attack/Defense +10%" (Test Víry na Útok/Obranu), carried as one Active
 * Effect per node. Holy Defense in defense.mjs reads the same field, so the
 * nodes lift the priest's miracles and their defense against magic together.
 *
 * Everything after the roll (the card, Apply Damage, effects, versus, rerolls)
 * is the spell pipeline unchanged: castSpell.mjs#performCast branches on
 * isMiracle for the cost and the roll only.
 */

import { getStrikeId } from "./strikes.mjs";
import { withRollBias } from "./rollAdvantage.mjs";

/** Miracle ranks, lowest first: template.json `miracleRanks`. */
export const MIRACLE_RANKS = ["novice", "acolyte", "cleric"];

/**
 * The school key a miracle card is stamped with. Spell readers test the card's
 * `spellSchool` for truthiness to tell a spell from a weapon (applyDamage.mjs),
 * and an empty school would make a miracle read as a sword cut.
 */
export const DIVINE_SCHOOL = "divine";

/** @param {Item} spell */
export function isMiracle(spell) {
  return spell?.type === "spell" && spell.system?.option === "divine";
}

/**
 * @param {Actor} actor
 * @returns {Item[]} The actor's miracles, in sheet order.
 */
export function getMiracles(actor) {
  return actor?.items?.contents.filter(isMiracle) ?? [];
}

/**
 * The flat part of the Faith attack: Faith * 8 plus the Priest tree's
 * holyEnergy.cast. NPCs carry no `cast` key, hence the coercion.
 *
 * @param {Actor} actor
 */
export function getMiracleAttackParts(actor) {
  const faith = Number(actor?.system?.secondaryAttributes?.fth?.total) || 0;
  const holyEnergyCast = Number(actor?.system?.stats?.holyEnergy?.cast) || 0;
  return { faithBonus: faith * 8, holyEnergyCast };
}

/**
 * The miracle's stand in for performAttackRoll, returning the same shape.
 *
 * `miracle: true` marks the cast as landed for spellCastSucceeded whatever the
 * margin, since there is no test to fail. Faith knows no critical success or
 * failure ("vyjma Víry, Rychlosti a Mentálního souboje"), so the crit fields
 * are all false. A miracle nobody defends against (uncontested, or a heal)
 * rolls nothing, exactly like an uncontested spell under No Channeling
 * Evaluation.
 *
 * @param {Actor} actor
 * @param {Item} spell
 */
export async function rollMiracleAttack(actor, spell) {
  const result = {
    attackRoll: null,
    miracle: true,
    critSuccess: false,
    critFailure: false,
    displayCritSuccess: false,
    displayCritFailure: false,
  };
  // isUncontestedSpell's test, inlined: magicSkillBonuses imports this module.
  const uncontested =
    spell.system.uncontested === true || !!getStrikeId(spell);
  if (uncontested || spell.system.isHealing) return result;

  const attackRoll = new Roll(
    "@holyEnergyCast + @faithBonus - 1d100",
    withRollBias(getMiracleAttackParts(actor), actor),
  );
  await attackRoll.evaluate();
  result.attackRoll = attackRoll;
  return result;
}

/**
 * The miracle picker: every miracle the actor holds, lowest rank first, with
 * its Holy Energy cost. One click on a row casts it.
 *
 * @param {Actor} actor
 * @returns {Promise<Item|null>}
 */
export async function pickMiracle(actor) {
  const miracles = getMiracles(actor);
  if (!miracles.length) {
    ui.notifications.warn(
      game.i18n.format("REDSTEEL.Miracle.NoneKnown", { name: actor.name }),
    );
    return null;
  }

  const rankOf = (m) => {
    const i = MIRACLE_RANKS.indexOf(String(m.system.rank || "").toLowerCase());
    return i === -1 ? MIRACLE_RANKS.length : i;
  };
  const sorted = [...miracles].sort((a, b) => rankOf(a) - rankOf(b));
  const energy = Number(actor.system.stats?.holyEnergy?.value) || 0;

  const rows = sorted
    .map((m) => {
      const cost = Number(m.system.cost) || 0;
      const name = foundry.utils.escapeHTML(m.localizedName ?? m.name);
      return `
        <label class="rs-bg3-pick-row${cost > energy ? " disabled" : ""}">
          <input type="radio" name="rs-miracle" value="${m.id}"${
            cost > energy ? " disabled" : ""
          }>
          <img src="${m.img}" width="24" height="24">
          <span class="rs-bg3-pick-name">${name}</span>
          <span class="rs-bg3-pick-rating">${game.i18n.format(
            "REDSTEEL.Miracle.Cost",
            { cost },
          )}</span>
        </label>`;
    })
    .join("");

  const DialogV2 = foundry.applications.api.DialogV2;
  const chosen = await DialogV2.wait({
    window: {
      title: game.i18n.format("REDSTEEL.Miracle.PickerTitle", {
        energy,
      }),
      icon: "fa-light fa-hands-praying",
    },
    classes: ["redsteel", "rs-bg3-skill-picker", "rs-miracle-picker"],
    content: `<form><div class="rs-bg3-pick-list">${rows}</div></form>`,
    // Same contract as the hotbar's skill picker: a row click submits through
    // this button, and the window's close button cancels.
    buttons: [
      {
        action: "select",
        label: game.i18n.localize("REDSTEEL.Miracle.Cast"),
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? button.form;
          return (
            root.querySelector('input[name="rs-miracle"]:checked')?.value ??
            null
          );
        },
      },
    ],
    render: (_event, dialog) => {
      const root = dialog instanceof HTMLElement ? dialog : dialog?.element;
      if (!root) return;
      let submitted = false;
      for (const row of root.querySelectorAll(".rs-bg3-pick-row")) {
        row.addEventListener("click", () => {
          if (submitted || row.classList.contains("disabled")) return;
          const radio = row.querySelector("input[type=radio]");
          if (!radio) return;
          radio.checked = true;
          const confirm = root.querySelector('button[data-action="select"]');
          if (!confirm) return;
          submitted = true;
          confirm.click();
        });
      }
    },
    rejectClose: false,
  });

  if (!chosen || chosen === "cancel" || chosen === "select") return null;
  return actor.items.get(chosen) ?? null;
}
