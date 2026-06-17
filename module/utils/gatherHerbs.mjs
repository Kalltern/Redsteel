/**
 * Herb gathering.
 *
 * Herbalism / Survival skill rolls can be used either to "test the skill"
 * (normal roll-to-chat, handled by the sheet) or to "gather herbs". The
 * gathering flow lives entirely inside a dialog — no chat messages — and uses
 * the roll's margin of success (roll.total of `rating - 1d100`) to decide how
 * much of each substance can be harvested.
 *
 * Margin → yield per substance (síla úspěchu):
 *   crit failure / margin ≤ -60 ............... nothing
 *   -60 < margin ≤ -25 (failure by 25+) ....... 1d6-1
 *   -25 < margin < 0   (plain failure) ........ 1d6+3
 *    0 ≤ margin < 25   (success) .............. 2d6+2
 *   25 ≤ margin < 60   (success by 25+) ....... 4d6+1
 *   crit success / margin ≥ 60 ................ 8d6
 *
 * In the dialog a single "Roll" rolls every herb at once. Each row carries a
 * red ✗ (sacrifice this herb's roll) and a yellow ↑ (boost: this herb gains
 * floor(extraRoll / 2) of one additional roll). Sacrifice/boost are visual
 * toggles that recompute totals from the already-rolled values, so the player
 * can rearrange without re-rolling.
 *
 * The six "Flower (…)" items live in the `redsteel-items` compendium, each
 * flagged with `flags.redsteel.substance`. Gathering adds owned copies of those
 * flowers to the actor. The GM is whispered every skill re-roll (anti-cheat)
 * and the final per-substance totals.
 */

import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";

const PACK_ID = "redsteel.redsteel-items";

/**
 * Map a roll margin (and crit status) to the per-substance dice formula.
 * @returns {{formula: string|null, label: string}}
 */
export function herbYieldForMargin(margin, critSuccess, critFailure) {
  if (critSuccess) return { formula: "8d6", label: "Critical success" };
  if (critFailure) return { formula: null, label: "Critical failure — nothing found" };
  if (margin >= 60) return { formula: "8d6", label: "Success (+60)" };
  if (margin >= 25) return { formula: "4d6+1", label: "Success (+25)" };
  if (margin >= 0) return { formula: "2d6+2", label: "Success" };
  if (margin > -25) return { formula: "1d6+3", label: "Failure" };
  if (margin > -60) return { formula: "1d6-1", label: "Failure (-25)" };
  return { formula: null, label: "Failure (-60) — nothing found" };
}

const fmtMargin = (m) => (m >= 0 ? `+${m}` : `${m}`);

/** Load the substance-flagged flower items from the redsteel-items compendium. */
async function loadFlowers() {
  const pack = game.packs.get(PACK_ID);
  if (!pack) {
    ui.notifications.error(`Compendium "${PACK_ID}" not found.`);
    return [];
  }
  const docs = await pack.getDocuments();
  return docs
    .filter((d) => d.getFlag("redsteel", "substance"))
    .map((d) => ({
      substance: d.getFlag("redsteel", "substance"),
      name: d.name,
      img: d.img,
      source: d,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function whisperGM(actor, content) {
  const gms = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  if (!gms.length) return;
  return ChatMessage.create({
    content,
    whisper: gms,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
}

/**
 * Ask whether a Herbalism/Survival roll is a plain skill test or a herb
 * gathering attempt.
 * @returns {Promise<"test"|"gather"|null>} null if dismissed.
 */
export function promptHerbMode(skillName) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (v) => {
      resolved = true;
      resolve(v);
    };
    new Dialog({
      title: `${skillName}`,
      content: `<p style="text-align:center;">Are you testing the skill, or gathering herbs?</p>`,
      buttons: {
        test: {
          icon: '<i class="fas fa-dice-d20"></i>',
          label: "Test skill",
          callback: () => finish("test"),
        },
        gather: {
          icon: '<i class="fas fa-seedling"></i>',
          label: "Gather herbs",
          callback: () => finish("gather"),
        },
      },
      default: "test",
      close: () => {
        if (!resolved) resolve(null);
      },
    }).render(true);
  });
}

/**
 * Open the herb-gathering dialog for an actor.
 * @param {Actor}  actor      The gathering actor.
 * @param {string} skillKey   "herbalism" | "survival".
 * @param {object} skillData  actor.system.skills[skillKey] (rating + thresholds).
 */
export async function gatherHerbs(actor, skillKey, skillData) {
  const flowers = await loadFlowers();
  if (!flowers.length) {
    ui.notifications.warn("No herb (Flower) items are available to gather.");
    return;
  }

  const skillName = game.i18n.localize(
    `REDSTEEL.Actor.Character.skills.${skillKey}.label`,
  );
  const rating = Number(skillData?.rating ?? 0);
  const critSucc = Number(skillData?.criticalSuccessThreshold ?? 0);
  const critFail = Number(skillData?.criticalFailureThreshold ?? 101);

  const state = {
    flowers,
    d100: 0,
    margin: 0,
    critSuccess: false,
    critFailure: false,
    formula: null,
    category: "",
    rerolls: 0,
    rolled: false,
    results: {}, // substance -> base rolled number
    extraRoll: 0, // the single additional roll (for the boosted herb)
    sacrificeFrom: null, // substance crossed out (✗)
    sacrificeTo: null, // substance boosted (↑)
  };

  const resetResults = () => {
    state.rolled = false;
    state.results = {};
    state.extraRoll = 0;
    state.sacrificeFrom = null;
    state.sacrificeTo = null;
  };

  const rollSkill = async () => {
    const skillRoll = new Roll(`${rating} - 1d100`, withRollBias({}, actor));
    tagRollSkill(skillRoll, skillKey);
    const roll = await skillRoll.evaluate();
    const d100 = roll.dice?.[0]?.total ?? rating - roll.total;
    state.d100 = d100;
    state.margin = roll.total;
    state.critSuccess = d100 <= critSucc;
    state.critFailure = d100 >= critFail;
    const y = herbYieldForMargin(
      state.margin,
      state.critSuccess,
      state.critFailure,
    );
    state.formula = y.formula;
    state.category = y.label;
  };

  const boostActive = () =>
    state.sacrificeFrom &&
    state.sacrificeTo &&
    state.sacrificeFrom !== state.sacrificeTo;

  const totalFor = (sub) => {
    if (!state.rolled) return 0;
    if (state.sacrificeFrom === sub) return 0;
    let base = state.results[sub] ?? 0;
    if (boostActive() && state.sacrificeTo === sub) {
      base += Math.floor(state.extraRoll / 2);
    }
    return Math.max(0, base);
  };

  await rollSkill();

  // ---- rendering -----------------------------------------------------------
  const bodyHtml = () => {
    const critTxt = state.critSuccess
      ? " · Critical success"
      : state.critFailure
        ? " · Critical failure"
        : "";

    const header = `
      <div style="text-align:center;margin-bottom:6px;">
        <div style="font-size:12px;opacity:.75;">${skillName} — herb gathering</div>
        <div style="font-size:22px;font-weight:bold;">d100: ${state.d100} → Margin ${fmtMargin(state.margin)}<span style="font-size:12px;font-weight:normal;opacity:.8;">${critTxt}</span></div>
        <div style="opacity:.85;font-size:13px;">${state.category}${
          state.formula ? ` — <b>${state.formula}</b> per herb` : ""
        }</div>
        <button type="button" class="rs-reroll" style="margin-top:6px;width:auto;">
          <i class="fas fa-rotate"></i> Re-roll skill${state.rerolls ? ` (×${state.rerolls})` : ""}
        </button>
      </div>`;

    if (state.formula == null) {
      return `<div class="rs-gather">${header}<hr>
        <p style="text-align:center;opacity:.7;margin:8px 0;"><em>Nothing can be gathered with this result.</em></p>
      </div>`;
    }

    const hint = `
      <div style="font-size:11px;opacity:.75;text-align:center;margin:4px 0;">
        <i class="fas fa-xmark" style="color:#e74c3c;"></i> sacrifice a herb&nbsp;·&nbsp;
        <i class="fas fa-arrow-up" style="color:#f1c40f;"></i> boost another (+½ of an extra roll)
      </div>
      <hr>`;

    const rows = state.flowers
      .map((f) => {
        const sub = f.substance;
        const isFrom = state.sacrificeFrom === sub;
        const isTo = state.sacrificeTo === sub;
        const base = state.results[sub];

        const crossStyle = isFrom
          ? "color:#e74c3c;text-shadow:0 0 8px #e74c3c;"
          : "color:#888;";
        const arrowStyle = isTo
          ? "color:#f1c40f;text-shadow:0 0 8px #f1c40f;"
          : "color:#888;";

        let result;
        if (!state.rolled) {
          result = `<span style="opacity:.45;">—</span>`;
        } else if (isFrom) {
          result = `<span style="text-decoration:line-through;opacity:.6;">${base ?? 0}</span> <em style="font-size:11px;">sacrificed</em>`;
        } else {
          const total = totalFor(sub);
          const boosted = boostActive() && isTo;
          result = `<b style="font-size:18px;">${total}</b>${
            boosted
              ? ` <small style="opacity:.7;">(${base}+${Math.floor(state.extraRoll / 2)})</small>`
              : ""
          }`;
        }

        return `
        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #4444;">
          <img src="${f.img}" width="34" height="34" style="flex:0 0 auto;border:none;">
          <span style="flex:1;">${f.name}</span>
          <a class="rs-sac-cross" data-sub="${sub}" title="Sacrifice this herb's roll" style="cursor:pointer;font-size:18px;padding:0 4px;${crossStyle}"><i class="fas fa-xmark"></i></a>
          <a class="rs-sac-boost" data-sub="${sub}" title="Boost this herb with an extra ½ roll" style="cursor:pointer;font-size:18px;padding:0 4px;${arrowStyle}"><i class="fas fa-arrow-up"></i></a>
          <span class="rs-flower-result" style="min-width:78px;text-align:right;">${result}</span>
        </div>`;
      })
      .join("");

    const rollBtn = `
      <div style="text-align:center;margin-top:8px;">
        <button type="button" class="rs-roll-all" style="width:auto;" ${state.rolled ? "disabled" : ""}>
          <i class="fas fa-dice"></i> ${state.rolled ? "Rolled" : "Roll"}
        </button>
      </div>`;

    return `<div class="rs-gather">${header}${hint}${rows}${rollBtn}</div>`;
  };

  // ---- dialog --------------------------------------------------------------
  let $root = null;

  const refresh = () => {
    if (!$root) return;
    $root.find(".rs-gather").replaceWith(bodyHtml());
    activate();
  };

  const activate = () => {
    if (!$root) return;

    $root.find(".rs-reroll").on("click", async (ev) => {
      ev.preventDefault();
      await rollSkill();
      state.rerolls += 1;
      resetResults();
      refresh();
      await whisperGM(
        actor,
        `<b>${actor.name}</b> re-rolled <b>${skillName}</b> for herb gathering → d100 ${state.d100}, margin <b>${fmtMargin(
          state.margin,
        )}</b> (re-roll #${state.rerolls}).`,
      );
    });

    $root.find(".rs-roll-all").on("click", async (ev) => {
      ev.preventDefault();
      if (state.formula == null || state.rolled) return;
      for (const f of state.flowers) {
        const r = await new Roll(state.formula).evaluate();
        state.results[f.substance] = Math.max(0, r.total);
      }
      const extra = await new Roll(state.formula).evaluate();
      state.extraRoll = Math.max(0, extra.total);
      state.rolled = true;
      refresh();
    });

    $root.find(".rs-sac-cross").on("click", (ev) => {
      ev.preventDefault();
      const sub = ev.currentTarget.dataset.sub;
      state.sacrificeFrom = state.sacrificeFrom === sub ? null : sub;
      if (state.sacrificeTo === sub) state.sacrificeTo = null;
      refresh();
    });

    $root.find(".rs-sac-boost").on("click", (ev) => {
      ev.preventDefault();
      const sub = ev.currentTarget.dataset.sub;
      state.sacrificeTo = state.sacrificeTo === sub ? null : sub;
      if (state.sacrificeFrom === sub) state.sacrificeFrom = null;
      refresh();
    });
  };

  const collect = async () => {
    const gathered = state.flowers
      .map((f) => ({ f, qty: totalFor(f.substance) }))
      .filter((g) => g.qty > 0);

    if (!gathered.length) {
      ui.notifications.info("No herbs gathered.");
      await whisperGM(
        actor,
        `<b>${actor.name}</b> gathered <b>no</b> herbs (${skillName}, d100 ${state.d100}, margin ${fmtMargin(
          state.margin,
        )}).<br><small>Re-rolls used: ${state.rerolls}</small>`,
      );
      return;
    }

    for (const { f, qty } of gathered) {
      const existing = actor.items.find(
        (i) => i.getFlag("redsteel", "substance") === f.substance,
      );
      if (existing) {
        await existing.update({
          "system.quantity": (existing.system.quantity ?? 0) + qty,
        });
      } else {
        const data = f.source.toObject();
        delete data._id;
        foundry.utils.setProperty(data, "system.quantity", qty);
        await actor.createEmbeddedDocuments("Item", [data]);
      }
    }

    ui.notifications.info(
      `Gathered ${gathered.reduce((s, g) => s + g.qty, 0)} herbs.`,
    );

    const lines = gathered.map((g) => `${g.f.name}: <b>${g.qty}</b>`).join("<br>");
    await whisperGM(
      actor,
      `<b>${actor.name}</b> gathered herbs (${skillName}, d100 ${state.d100}, margin ${fmtMargin(
        state.margin,
      )}):<br>${lines}<br><small>Re-rolls used: ${state.rerolls}</small>`,
    );
  };

  new Dialog(
    {
      title: "Gather Herbs",
      content: bodyHtml(),
      buttons: {
        collect: {
          icon: '<i class="fas fa-basket-shopping"></i>',
          label: "Collect",
          callback: () => {
            if (state.formula != null && !state.rolled) {
              ui.notifications.warn("Roll the herbs first.");
              return false; // keep the dialog open
            }
            return collect();
          },
        },
        cancel: {
          icon: '<i class="fas fa-xmark"></i>',
          label: "Cancel",
        },
      },
      default: "collect",
      render: (html) => {
        $root = html;
        activate();
      },
    },
    { classes: ["dialog", "rs-gather-dialog"], width: 420 },
  ).render(true);
}
