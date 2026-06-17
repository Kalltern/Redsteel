/**
 * Global roll modifier picker attached to the hotbar.
 *
 * A dice button next to the hotbar page controls lets the user pre-select a
 * bonus, penalty, advantage or disadvantage. The selection is applied to the
 * next margin-of-success test this client rolls — i.e. any roll whose formula
 * subtracts 1d100. Plain "1d100" effect-chance rolls (bleed, status effects)
 * are never modified.
 *
 * Advantage rolls 2d100 and keeps the lower die (better, since the die is
 * subtracted); disadvantage keeps the higher die.
 */

import { getRollBias } from "./rollAdvantage.mjs";

const TEST_DIE_PATTERN = /-\s*1d100\b/i;

const state = {
  type: null, // "bonus" | "penalty" | "advantage" | "disadvantage" | null
  value: 10,
  sticky: false,
};

function describeModifier() {
  switch (state.type) {
    case "bonus":
      return `+${state.value} bonus`;
    case "penalty":
      return `-${state.value} penalty`;
    case "advantage":
      return "advantage";
    case "disadvantage":
      return "disadvantage";
    default:
      return null;
  }
}

function badgeText() {
  switch (state.type) {
    case "bonus":
      return `+${state.value}`;
    case "penalty":
      return `-${state.value}`;
    case "advantage":
      return "ADV";
    case "disadvantage":
      return "DIS";
    default:
      return "";
  }
}

function refreshButton(root = ui.hotbar?.element) {
  const button = root?.querySelector(".redsteel-roll-modifier");
  if (!button) return;

  button.classList.toggle("active", state.type !== null);
  button.dataset.tooltip = state.type
    ? `Roll Modifier: ${describeModifier()}${state.sticky ? " (until cleared)" : " (next roll)"}`
    : "Roll Modifier";

  const badge = button.querySelector(".modifier-badge");
  if (badge) {
    badge.textContent = badgeText();
    badge.style.display = state.type ? "" : "none";
  }
}

function clearModifier({ silent = false } = {}) {
  const hadModifier = state.type !== null;
  state.type = null;
  state.sticky = false;
  refreshButton();
  if (hadModifier && !silent) {
    ui.notifications.info("Roll modifier cleared.");
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
function applyModifier(roll) {
  if (roll._redsteelModifierApplied) return;

  const formula = roll.formula;
  if (!TEST_DIE_PATTERN.test(formula)) return;

  // Actor-driven bias: actor-wide `all` bucket plus, when the call site tagged
  // a skill, that skill's bucket.
  const skillKey = roll.options?.redsteel?.skill;
  let bias = getRollBias(roll.data, skillKey);
  const autoBias = bias; // for messaging: was anything contributed by the actor?

  // Manual picker contribution.
  let flat = 0;
  switch (state.type) {
    case "advantage":
      bias += 1;
      break;
    case "disadvantage":
      bias -= 1;
      break;
    case "bonus":
      flat += state.value;
      break;
    case "penalty":
      flat -= state.value;
      break;
  }

  // Nothing to do — leave the plain roll untouched.
  if (bias === 0 && flat === 0) {
    if (state.type && !state.sticky) clearModifier({ silent: true });
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

  if (state.type && !state.sticky) clearModifier({ silent: true });
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
  const checked = (type) => (state.type === type ? "checked" : "");

  new Dialog({
    title: "Roll Modifier",
    content: `
      <form class="redsteel-roll-modifier-form">
        <p style="margin-top:0;">
          Pick a modifier for your margin-of-success tests (rolls against 1d100).
        </p>
        <fieldset>
          <legend>Modifier</legend>
          <label><input type="radio" name="modifier-type" value="bonus" ${checked("bonus")}> Bonus</label><br>
          <label><input type="radio" name="modifier-type" value="penalty" ${checked("penalty")}> Penalty</label><br>
          <label><input type="radio" name="modifier-type" value="advantage" ${checked("advantage")}> Advantage — roll 2d100, keep the better</label><br>
          <label><input type="radio" name="modifier-type" value="disadvantage" ${checked("disadvantage")}> Disadvantage — roll 2d100, keep the worse</label>
        </fieldset>
        <div class="form-group">
          <label>Bonus / penalty amount</label>
          <input type="number" name="modifier-value" value="${state.value}" min="1" step="1">
        </div>
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
          const type = html.find('input[name="modifier-type"]:checked').val();
          if (!type) {
            clearModifier();
            return;
          }

          state.type = type;
          state.value = Math.max(
            1,
            Math.floor(
              Number(html.find('input[name="modifier-value"]').val()) || 10,
            ),
          );
          state.sticky = html
            .find('input[name="modifier-sticky"]')
            .is(":checked");

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
