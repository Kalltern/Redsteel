/**
 * Render the damage/penetration/crit block shown on attack chat cards.
 *
 * Shared so the stored "normal" face and the render-time "Bane" face are
 * byte-identical in layout — the Bane face is injected by the chat hook in
 * redsteel.mjs long after the message was created, and any divergence between
 * two copies of this markup would show up as the card visibly changing shape
 * when flipped.
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
<hr>
`;
}
