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
];

/**
 * @param {object} state
 * @param {boolean} state.sneak        Sneak Attack opens ticked.
 * @param {boolean} state.flank        Flanking opens ticked.
 * @param {boolean} state.opportunity  Show the Opportunity Attack toggle at all.
 * @param {boolean} state.longReach    Show the polearm penalty toggle at all.
 * @param {boolean} state.longReachClose  Polearm penalty opens ticked.
 * @returns {string}
 */
export function attackOptionIconsHtml({
  sneak,
  flank,
  opportunity,
  longReach,
  longReachClose,
}) {
  const checked = {
    sneakAttack: sneak,
    flanking: flank,
    longReachPenalty: longReachClose,
  };
  const shown = { opportunityAttack: opportunity, longReachPenalty: longReach };
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
