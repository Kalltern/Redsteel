/**
 * Render the damage/penetration/crit block shown on attack chat cards.
 *
 * Shared so the stored "normal" face and the render-time "Bane" face are
 * byte-identical in layout — the Bane face is injected by the chat hook in
 * redsteel.mjs long after the message was created, and any divergence between
 * two copies of this markup would show up as the card visibly changing shape
 * when flipped.
 *
 * The block ends at the grid — the separating rule belongs to the card template
 * that places this, so it isn't doubled up when a card adds its own.
 */
export function renderDamageLine({
  damage,
  penetration,
  breakthrough,
  critDamage,
  critPenetration,
  critScore,
  critScoreResult,
  showBreakthrough = false,
}) {
  const hasBreakthrough =
    showBreakthrough &&
    typeof breakthrough === "string" &&
    breakthrough.trim() !== "";

  return `
<div style="
  display:grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 24px;
  font-size:16px;
  max-width: fit-content;
  margin: 0 auto;
" class="combat-grid">

  <div style="display:grid; grid-template-columns:auto 1fr; column-gap:8px;">
    <div>Damage:</div><div style="text-align:center;">${damage}</div>
    <div>Penetration:</div><div style="text-align:center;">${penetration}</div>
${
  hasBreakthrough
    ? `
      <div>Breakthrough:</div>
      <div style="text-align:center;">
        ${breakthrough}
      </div>
    `
    : `
      <div>&nbsp;</div>
      <div>&nbsp;</div>
    `
}
  </div>

  <div style="display:grid; grid-template-columns:auto 1fr; column-gap:8px;">
    <div>Crit Dmg:</div><div style="text-align:center;">${critDamage}</div>
    <div>Crit Pen:</div><div style="text-align:center;">${critPenetration}</div>
    <div>Crit score:</div>
    <div style="text-align:center;">
      <span title="Crit range result ${critScoreResult}"
        style="text-decoration:underline dotted; cursor:help;">
        [ ${critScore} ]
      </span>
    </div>
  </div>
</div>
`;
}

/**
 * The damage dice box, with a declared Sneak Attack's dice folded into it.
 *
 * The two are separate Roll objects on purpose: utils/applyDamage.mjs adds or
 * removes the sneak total per target, and a contribution buried inside one
 * evaluated Roll cannot be recovered. Players should still see a single damage
 * roll rather than two boxes, so the terms of both are stitched into one
 * display Roll with `Roll.fromTerms`, which reuses the evaluated terms and
 * rolls nothing again. `message.rolls` keeps both originals, so re-rolls and
 * the per-target shift are untouched.
 *
 * Shared by the weapon card and the ability card so the two cannot drift.
 *
 * @param {Roll} damageRoll
 * @param {Roll|null} sneakRoll  the sneak dice, or null when none was declared
 * @returns {Promise<string>} rendered HTML for the damage column
 */
export async function renderDamageWithSneak(damageRoll, sneakRoll = null) {
  if (!damageRoll) return "";
  if (!sneakRoll) return damageRoll.render();

  try {
    const combined = Roll.fromTerms([
      ...damageRoll.terms,
      new foundry.dice.terms.OperatorTerm({ operator: "+" }),
      ...sneakRoll.terms,
    ]);
    return await combined.render();
  } catch (error) {
    // Never swallow the dice. A merge that fails falls back to two boxes,
    // which is ugly but honest; hiding the sneak roll would understate the
    // damage the card is actually doing.
    console.warn(
      "Redsteel | could not merge the Sneak Attack dice into the damage roll",
      error,
    );
    return `${await damageRoll.render()}${await sneakRoll.render()}`;
  }
}
