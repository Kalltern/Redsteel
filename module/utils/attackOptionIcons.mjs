// Round icon toggles for the attack option flags (Sneak Attack, Flanking,
// Opportunity Attack), shared by the weapon attack dialog and the combat
// ability dialog. Each is still a hidden checkbox under the same name, so the
// dialogs' callbacks read them exactly as they read the old pills. Styling
// lives in css/redsteel.css under .rs-atk-icon.

const OPTIONS = [
  {
    name: "sneakAttack",
    img: "icons/weapons/daggers/dagger-double-skull-pink.webp",
    label: "REDSTEEL.AttackDialog.SneakAttack",
    cls: "sneak",
  },
  {
    name: "flanking",
    img: "icons/skills/melee/strike-sword-stabbed-brown.webp",
    label: "REDSTEEL.AttackDialog.Flanking",
  },
  {
    name: "opportunityAttack",
    img: "icons/creatures/mammals/wolf-shadow-black.webp",
    label: "REDSTEEL.AttackDialog.OpportunityAttack",
    hint: "REDSTEEL.AttackDialog.OpportunityHint",
  },
  {
    name: "longReachPenalty",
    img: "icons/skills/melee/spear-tips-quintuple-orange.webp",
    label: "REDSTEEL.AttackDialog.PolearmPenalty",
    hint: "REDSTEEL.AttackDialog.PolearmPenaltyHint",
    cls: "penalty",
  },
  {
    // Hraničář → Dravčí smysly: Advantage on the attack in the first round
    // of an ambush or a fight in the wild (rangerCombat.mjs).
    name: "predatorySenses",
    img: "icons/magic/nature/stealth-hide-eyes-green.webp",
    label: "REDSTEEL.AttackDialog.PredatorySenses",
    hint: "REDSTEEL.AttackDialog.PredatorySensesHint",
  },
  {
    // Cover the target stands behind (zbrojnice.md r248, sharpshooter.mjs):
    // a shot or a throw only. Half and full are two toggles of which at most
    // one is on (wireCoverToggles); neither on is no cover.
    name: "halfCover",
    img: "icons/environment/wilderness/terrain-rocks-brown.webp",
    label: "REDSTEEL.AttackDialog.HalfCover",
    hint: "REDSTEEL.AttackDialog.HalfCoverHint",
    cls: "penalty",
  },
  {
    name: "fullCover",
    img: "icons/magic/lightning/barrier-wall-shield-gray.webp",
    label: "REDSTEEL.AttackDialog.FullCover",
    hint: "REDSTEEL.AttackDialog.FullCoverHint",
    cls: "penalty",
  },
];

/**
 * @param {object} state
 * @param {boolean} state.sneak        Sneak Attack opens ticked.
 * @param {boolean} state.flank        Flanking opens ticked.
 * @param {boolean} state.opportunity  Show the Opportunity Attack toggle at all.
 * @param {boolean} [state.opportunityChecked]  Opportunity Attack opens ticked.
 * @param {boolean} state.longReach    Show the polearm penalty toggle at all.
 * @param {boolean} state.longReachClose  Polearm penalty opens ticked.
 * @param {boolean} [state.predatorySenses]  Show the Ambush / In nature toggle
 *   (rangerCombat.mjs predatorySensesAvailable). Never opens ticked.
 * @param {boolean} [state.cover]  Show the Half cover / Full cover toggles
 *   (sharpshooter.mjs coverOptionAvailable). Never open ticked.
 * @returns {string}
 */
export function attackOptionIconsHtml({
  sneak,
  flank,
  opportunity,
  opportunityChecked = false,
  longReach,
  longReachClose,
  predatorySenses = false,
  cover = false,
}) {
  const checked = {
    sneakAttack: sneak,
    flanking: flank,
    opportunityAttack: opportunityChecked,
    longReachPenalty: longReachClose,
  };
  const shown = {
    opportunityAttack: opportunity,
    longReachPenalty: longReach,
    predatorySenses,
    halfCover: cover,
    fullCover: cover,
  };
  return OPTIONS.filter((o) => shown[o.name] ?? true)
    .map((o) => {
      const label = game.i18n.localize(o.label);
      const tip = o.hint ? `${label}: ${game.i18n.localize(o.hint)}` : label;
      return `
  <label class="rs-atk-icon ${o.cls ?? ""}" data-tooltip="${tip}" aria-label="${label}">
    <input type="checkbox" name="${o.name}"${checked[o.name] ? " checked" : ""} />
    <span class="rs-atk-icon-face"><img src="${o.img}" alt="" /></span>
  </label>`;
    })
    .join("");
}

/**
 * Keep the two cover toggles exclusive: ticking one unticks the other, and
 * clicking the ticked one again clears the cover. Call from the dialog's
 * render with its root element.
 *
 * @param {HTMLElement|null} root
 */
export function wireCoverToggles(root) {
  const boxes = ["halfCover", "fullCover"]
    .map((name) => root?.querySelector(`input[name="${name}"]`))
    .filter(Boolean);
  for (const box of boxes) {
    box.addEventListener("change", () => {
      if (!box.checked) return;
      for (const other of boxes) if (other !== box) other.checked = false;
    });
  }
}

/**
 * The cover the dialog declares: "full", "half" or null.
 *
 * @param {HTMLElement|null} root
 * @returns {"half"|"full"|null}
 */
export function readAttackCover(root) {
  if (root?.querySelector('input[name="fullCover"]')?.checked) return "full";
  if (root?.querySelector('input[name="halfCover"]')?.checked) return "half";
  return null;
}
