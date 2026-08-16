/**
 * Aimed Attack system.
 *
 * Modifies any attack to target a specific body part (head, hands, or legs).
 * The attack roll already includes the hit penalty; if the resulting margin of
 * success (SU) is ≥ 0, the aimed part was hit and its special effect applies.
 * If SU < 0 the attack still lands but in the torso — no special effect.
 *
 * Head:  -15% hit, +20% stagger chance, +10% precision chance on hit
 * Hands: -10% hit, applies maimed_hands (disadvantage on every attack, 2t)
 * Legs:  -10% hit, applies maimed_legs  (disadvantage on dodge, 2t)
 *
 * Both wounds work through the advantage buckets in utils/rollAdvantage.mjs:
 * maimed_hands adds -1 to `attack` (tagged on every attack roll), maimed_legs
 * adds -1 to `dodge` (tagged on the dodge defense roll).
 *
 * NPC body-part overrides live as actor flags:
 *   flags.redsteel.bodyParts = {
 *     head:  { armorMod: -999, staggerMod: 20, bleedMod: 0, precisionMod: 0 },
 *     hands: { armorMod: 0, ... },
 *     legs:  { armorMod: 0, ... },
 *   }
 * These are read at apply-damage time per target.
 */

export const AIMED_PARTS = {
  head: {
    label: "Head",
    attackPenalty: -15,
    effectId: null,
    staggerBonus: 20,
    precisionBonus: 10,
  },
  hands: {
    label: "Hands",
    attackPenalty: -10,
    effectId: "maimed_hands",
    staggerBonus: 0,
    precisionBonus: 0,
  },
  legs: {
    label: "Legs",
    attackPenalty: -10,
    effectId: "maimed_legs",
    staggerBonus: 0,
    precisionBonus: 0,
  },
};

/**
 * Show the Aimed Attack body-part selection dialog.
 * Returns "head", "hands", or "legs". Resolves to null only if closed
 * without a selection (Escape key).
 *
 * IMPORTANT: resolve() must be called BEFORE dialog.close() because the
 * Dialog `close` hook fires synchronously inside close() and would otherwise
 * resolve the promise with null first.
 */
export function selectAimedPart() {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const style = `
      <style>
        .aimed-part-list { list-style:none; padding:0; margin:4px 0 0; }
        .aimed-part-list li {
          padding: 7px 8px;
          border-bottom: 1px solid #555;
          cursor: pointer;
          font-size: 14px;
          border-radius: 3px;
        }
        .aimed-part-list li:last-child { border-bottom: none; }
        .aimed-part-list li:hover { background: rgba(255,255,255,0.09); }
        .aimed-part-list li b { display: inline-block; min-width: 55px; }
        .aimed-part-list .penalty { color: #e88; font-size: 12px; }
        .aimed-part-list .bonus  { color: #8e8; font-size: 12px; }
      </style>
    `;

    const content = `
      ${style}
      <ul class="aimed-part-list">
        <li data-part="head">
          <b>Head</b>
          <span class="penalty">−15% hit</span>
          <span class="bonus"> | +20% stun, +10% precision</span>
        </li>
        <li data-part="hands">
          <b>Hands</b>
          <span class="penalty">−10% hit</span>
          <span class="bonus"> | Disadv. on all attacks (2t)</span>
        </li>
        <li data-part="legs">
          <b>Legs</b>
          <span class="penalty">−10% hit</span>
          <span class="bonus"> | Disadv. dodge (2t)</span>
        </li>
      </ul>
    `;

    const dialog = new Dialog({
      title: "Aimed Attack — Choose Target",
      content,
      buttons: {},
      render: (html) => {
        html.find("[data-part]").each((_, el) => {
          el.addEventListener("click", () => {
            settle(el.dataset.part);
            dialog.close();
          });
        });
      },
      // Escape / window X — no part chosen, cancel the aimed attack
      close: () => settle(null),
    });
    dialog.render(true);
  });
}

/**
 * Get NPC body-part overrides for a target actor and part.
 * Returns safe defaults (all zeros) if no overrides are set.
 */
export function getBodyPartOverrides(targetActor, part) {
  const defaults = {
    armorMod: 0,
    staggerMod: 0,
    bleedMod: 0,
    precisionMod: 0,
  };
  if (!targetActor || !part) return defaults;
  const bodyParts = targetActor.getFlag?.("redsteel", "bodyParts") ?? {};
  return { ...defaults, ...(bodyParts[part] ?? {}) };
}
