/**
 * Global roll modifier picker attached to the hotbar.
 *
 * A dice button next to the hotbar page controls lets the user pre-select a
 * flat bonus/penalty AND/OR advantage/disadvantage — the two are independent
 * axes and can be combined. The selection is applied to the next
 * margin-of-success test this client rolls — i.e. any roll whose formula
 * subtracts 1d100. Plain "1d100" effect-chance rolls (bleed, status effects)
 * are never modified.
 *
 * Advantage rolls 2d100 and keeps the lower die (better, since the die is
 * subtracted); disadvantage keeps the higher die. Advantage/disadvantage also
 * applies to d12 speed/initiative tests (tagged `options.redsteel.speedTest`),
 * where the die is added — there advantage keeps the higher d12.
 */

import { getRollBias } from "./rollAdvantage.mjs";

const TEST_DIE_PATTERN = /-\s*1d100\b/i;
// Speed/initiative tests ADD a d12 (higher is better) — the opposite keep
// direction from a subtracted d100. Matches a plain 1d12 and the rogue 2d12kh1.
// Only applied to rolls tagged `options.redsteel.speedTest` so d12 damage rolls
// are never touched.
const D12_DIE_PATTERN = /\b([12])d12(?:k(h|l)1)?\b/i;

const state = {
  die: null, // "advantage" | "disadvantage" | null
  flat: 0, // signed flat modifier: >0 bonus, <0 penalty, 0 none
  desperate: false, // Desperate Effort (S vypětím všech sil)
  sticky: false,
};

/** Whether the manual picker currently holds any modifier. */
function isActive() {
  return state.die !== null || state.flat !== 0 || state.desperate;
}

function describeModifier() {
  const parts = [];
  if (state.desperate) parts.push("Desperate Effort");
  if (state.die) parts.push(state.die);
  if (state.flat > 0) parts.push(`+${state.flat} bonus`);
  else if (state.flat < 0) parts.push(`${state.flat} penalty`);
  return parts.length ? parts.join(" & ") : null;
}

function badgeText() {
  const parts = [];
  if (state.desperate) parts.push("DE");
  if (state.die === "advantage") parts.push("ADV");
  else if (state.die === "disadvantage") parts.push("DIS");
  if (state.flat > 0) parts.push(`+${state.flat}`);
  else if (state.flat < 0) parts.push(`${state.flat}`);
  return parts.join(" ");
}

function refreshButton(root = ui.hotbar?.element) {
  const button = root?.querySelector(".redsteel-roll-modifier");
  if (!button) return;

  const active = isActive();
  button.classList.toggle("active", active);
  button.dataset.tooltip = active
    ? `Roll Modifier: ${describeModifier()}${state.sticky ? " (until cleared)" : " (next roll)"}`
    : "Roll Modifier";

  const badge = button.querySelector(".modifier-badge");
  if (badge) {
    badge.textContent = badgeText();
    badge.style.display = active ? "" : "none";
  }
}

function clearModifier({ silent = false } = {}) {
  const hadModifier = isActive();
  state.die = null;
  state.flat = 0;
  state.desperate = false;
  state.sticky = false;
  refreshButton();
  if (hadModifier && !silent) {
    ui.notifications.info("Roll modifier cleared.");
  }
}

/**
 * Apply the Desperate Effort fatigue cost (one degree) to the acting actor,
 * resolved from the roll's data. Fire-and-forget; clamps to the fatigue max.
 */
function applyDesperateFatigueCost(roll) {
  const uuid = roll.data?.actorUuid;
  if (!uuid) return;
  const actor = fromUuidSync(uuid);
  const fat = actor?.system?.stats?.fatigue;
  if (!fat) return;
  const max = fat.max ?? (fat.value ?? 0) + 1;
  const next = Math.min((fat.value ?? 0) + 1, max);
  if (next !== fat.value) {
    Promise.resolve(
      actor.update({ "system.stats.fatigue.value": next }),
    ).catch(() => {});
  }
}

/**
 * Rewrite the formula of a not-yet-evaluated test roll, combining:
 *   - the manual hotbar picker (state), and
 *   - the rolling actor's automatic advantage/disadvantage bias (fatigue,
 *     features, buffs) read from the roll's data via getRollBias().
 *
 * Advantage/disadvantage is a signed bias: the manual picker contributes ±1,
 * the actor contributes its net bucket value, and they sum. The resulting sign
 * picks the die (advantage → 2d100kl, disadvantage → 2d100kh, zero → 1d100).
 * Bonus/penalty from the picker is a separate flat term. Called from the Roll
 * evaluation wrappers.
 */
/**
 * Apply advantage/disadvantage to a d12 speed/initiative test. The d12 is added
 * (higher is better), so advantage keeps the higher die (2d12kh1) and
 * disadvantage the lower (2d12kl1). Any keep already baked into the formula
 * (e.g. the rogue 2d12kh1) is folded in, so sources combine and cancel like a
 * signed bias. Flat bonus/penalty and Desperate Effort never apply here.
 */
function applyD12SpeedBias(roll, formula, bias, autoBias) {
  // No advantage/disadvantage to apply — leave the roll and the picker alone
  // (a flat/Desperate-only picker is meant for a later d100 test).
  if (bias === 0) return;

  const m = formula.match(D12_DIE_PATTERN);
  if (!m) return;

  const existing = m[2] === "h" ? 1 : m[2] === "l" ? -1 : 0;
  const net = existing + bias;
  const dieTerm = net > 0 ? "2d12kh1" : net < 0 ? "2d12kl1" : "1d12";

  if (dieTerm !== m[0]) {
    const modified = formula.replace(m[0], dieTerm);
    roll.terms = roll.constructor.parse(modified, roll.data);
    roll._formula = roll.constructor.getFormula(roll.terms);
  }
  roll._redsteelModifierApplied = true;

  // The manual die selection is consumed (non-sticky) only when it was set;
  // an actor-only bias applies every time and leaves the picker untouched.
  let label = state.die;
  if (!label && autoBias !== 0) label = autoBias > 0 ? "advantage" : "disadvantage";
  if (state.die && !state.sticky) clearModifier({ silent: true });
  if (label) ui.notifications.info(`Applied ${label} to speed roll.`);
}

function applyModifier(roll) {
  if (roll._redsteelModifierApplied) return;

  const formula = roll.formula;
  const isD100 = TEST_DIE_PATTERN.test(formula);
  const isD12Speed =
    !isD100 && !!roll.options?.redsteel?.speedTest && D12_DIE_PATTERN.test(formula);
  if (!isD100 && !isD12Speed) return;

  // Actor-driven bias: actor-wide `all` bucket plus, when the call site tagged
  // a skill, that skill's bucket.
  const skillKey = roll.options?.redsteel?.skill;
  let bias = getRollBias(roll.data, skillKey);
  const autoBias = bias; // for messaging: was anything contributed by the actor?

  // Manual picker contribution — die mode and flat modifier are independent.
  const manualActive = isActive();
  if (state.die === "advantage") bias += 1;
  else if (state.die === "disadvantage") bias -= 1;

  // Speed/initiative d12 test: only advantage/disadvantage applies (higher die
  // is better) — never the flat bonus/penalty or Desperate Effort.
  if (isD12Speed) {
    applyD12SpeedBias(roll, formula, bias, autoBias);
    return;
  }

  let flat = state.flat;

  // Desperate Effort: +20% success, ignores fatigue penalties (restore the
  // -10 globalMod at degree 3+ and cancel the degree-4 disadvantage die),
  // costs one degree of Fatigue, and tags the roll so crit thresholds shift
  // downstream (crit success +5%, crit failure -5%, fatigue crit penalty
  // ignored — see applyDesperateCrit).
  if (state.desperate) {
    roll.options ??= {};
    roll.options.redsteel = { ...(roll.options.redsteel ?? {}), desperate: true };
    flat += 20;
    const fatigueDegree = roll.data?.fatigueDegree ?? 0;
    if (fatigueDegree >= 3) flat += 10;
    if (roll.data?.fatigueDisadvantage) bias += 1;
    applyDesperateFatigueCost(roll);
  }

  // Nothing to do — leave the plain roll untouched.
  if (bias === 0 && flat === 0) {
    if (manualActive && !state.sticky) clearModifier({ silent: true });
    return;
  }

  let modified = formula;
  if (bias > 0) modified = modified.replace(/\b1d100\b/i, "2d100kl");
  else if (bias < 0) modified = modified.replace(/\b1d100\b/i, "2d100kh");
  if (flat > 0) modified = `${modified} + ${flat}`;
  else if (flat < 0) modified = `${modified} - ${Math.abs(flat)}`;

  roll.terms = roll.constructor.parse(modified, roll.data);
  roll._formula = roll.constructor.getFormula(roll.terms);
  roll._redsteelModifierApplied = true;

  // Describe what landed. Prefer the explicit manual label; otherwise report
  // the automatic advantage/disadvantage so players see why the die changed.
  let label = describeModifier();
  if (!label && autoBias !== 0) {
    label = autoBias > 0 ? "advantage" : "disadvantage";
  }

  if (manualActive && !state.sticky) clearModifier({ silent: true });
  if (label) ui.notifications.info(`Applied ${label} to roll.`);
}

function wrapRollEvaluation() {
  const proto = Roll.prototype;
  if (proto._redsteelModifierWrapped) return;
  proto._redsteelModifierWrapped = true;

  const originalEvaluate = proto.evaluate;
  proto.evaluate = function (...args) {
    applyModifier(this);
    return originalEvaluate.apply(this, args);
  };

  // Some call sites use the legacy Roll#roll alias.
  if (typeof proto.roll === "function") {
    const originalRoll = proto.roll;
    proto.roll = function (...args) {
      applyModifier(this);
      return originalRoll.apply(this, args);
    };
  }
}

function openModifierDialog() {
  const dieChecked = (mode) => (state.die === mode ? "checked" : "");

  new Dialog({
    title: "Roll Modifier",
    content: `
      <form class="redsteel-roll-modifier-form">
        <p style="margin-top:0;">
          Set a modifier for your margin-of-success tests (rolls against 1d100).
          The flat bonus/penalty and advantage/disadvantage are independent — use
          either or both. Advantage/disadvantage also applies to d12
          speed/initiative tests (flat bonus/penalty does not).
        </p>
        <fieldset>
          <legend>Advantage / Disadvantage</legend>
          <label><input type="radio" name="die-mode" value="" ${dieChecked(null)}> None</label><br>
          <label><input type="radio" name="die-mode" value="advantage" ${dieChecked("advantage")}> Advantage — keep the better die</label><br>
          <label><input type="radio" name="die-mode" value="disadvantage" ${dieChecked("disadvantage")}> Disadvantage — keep the worse die</label>
        </fieldset>
        <div class="form-group">
          <label>Flat modifier (positive = bonus, negative = penalty, 0 = none)</label>
          <input type="number" name="modifier-flat" value="${state.flat}" step="1">
        </div>
        <fieldset>
          <legend>Special</legend>
          <label>
            <input type="checkbox" name="modifier-desperate" ${state.desperate ? "checked" : ""}>
            Desperate Effort — +20% success, +5% crit success, -5% crit failure,
            ignores Fatigue penalties; costs one degree of Fatigue.
          </label>
        </fieldset>
        <div class="form-group">
          <label>
            <input type="checkbox" name="modifier-sticky" ${state.sticky ? "checked" : ""}>
            Keep active for all rolls until cleared (otherwise applies to the next roll only)
          </label>
        </div>
      </form>
    `,
    buttons: {
      set: {
        label: "Set",
        callback: (html) => {
          const die = html.find('input[name="die-mode"]:checked').val() || null;
          const flat = Math.trunc(
            Number(html.find('input[name="modifier-flat"]').val()) || 0,
          );

          state.die = die;
          state.flat = flat;
          state.desperate = html
            .find('input[name="modifier-desperate"]')
            .is(":checked");
          state.sticky = html
            .find('input[name="modifier-sticky"]')
            .is(":checked");

          if (!isActive()) {
            clearModifier();
            return;
          }

          refreshButton();
          ui.notifications.info(
            `Roll modifier set: ${describeModifier()}${state.sticky ? " (until cleared)" : " (next roll)"}.`,
          );
        },
      },
      clear: {
        label: "Clear",
        callback: () => clearModifier(),
      },
      cancel: { label: "Cancel" },
    },
    default: "set",
  }).render(true);
}

function injectHotbarButton(element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root || root.querySelector(".redsteel-roll-modifier")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "ui-control redsteel-roll-modifier";
  button.setAttribute("aria-label", "Roll Modifier");
  button.innerHTML =
    '<i class="fa-solid fa-dice"></i><span class="modifier-badge"></span>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    openModifierDialog();
  });

  const container = document.createElement("div");
  container.className = "redsteel-roll-modifier-controls";
  container.appendChild(button);

  // Anchor next to the right-side controls column (lock / clear buttons),
  // falling back to the hotbar root if core ever changes that markup.
  const clearButton = root.querySelector('[data-action="clear"]');
  const rightControls = clearButton?.parentElement;
  if (rightControls) rightControls.insertAdjacentElement("afterend", container);
  else root.appendChild(container);

  refreshButton(root);
}

export function registerRollModifier() {
  Hooks.on("renderHotbar", (_app, element) => injectHotbarButton(element));

  Hooks.once("ready", () => {
    wrapRollEvaluation();
    game.redsteel.rollModifier = {
      open: openModifierDialog,
      clear: clearModifier,
      state,
    };
    // Fallback in case the hotbar rendered before this hook was registered.
    if (ui.hotbar?.element) injectHotbarButton(ui.hotbar.element);
  });
}
