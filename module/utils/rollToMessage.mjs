// Work in progress

export function buildMeleeFlavor({
  weapon,
  critSuccess,
  critFailure,
  damageTotal,
  critDamageTotal,
  breakthroughRollResult,
  penetration,
  critBonusPenetration,
  critScore,
  critScoreResult,
  allBleedRollResults,
  effectsRollResults,
}) {
  const hasBreakthrough = weapon.system.breakthrough === true;

  const damageTable =
    hasBreakthrough && breakthroughRollResult != null
      ? `
<table style="width:100%; text-align:center; font-size:15px;">
  <tr>
    <th>Normal</th>
    <th>Crit</th>
    <th>Breakthrough</th>
  </tr>
  <tr>
    <td>${damageTotal}</td>
    <td>${critDamageTotal}</td>
    <td>${breakthroughRollResult}</td>
  </tr>
</table>`
      : `
<table style="width:100%; text-align:center; font-size:15px;">
  <tr>
    <th>Normal</th>
    <th>Crit</th>
  </tr>
  <tr>
    <td>${damageTotal}</td>
    <td>${critDamageTotal}</td>
  </tr>
</table>`;

  return `
<span style="display:inline-flex; align-items:center;">
  <img src="${weapon.img}" width="36" height="36" style="margin-right:8px;">
  <strong>Melee attack</strong>
</span>

<hr>

<p class="rs-card-headline">
  <b>${
    critSuccess ? "Critical Success!" : critFailure ? "Critical Failure!" : ""
  }</b>
</p>

${damageTable}

<hr>

<table style="width:100%; text-align:center; font-size:15px;">
  <tr>
    <th>Penetration</th>
    <th>Critical Score</th>
  </tr>
  <tr>
    <td>${penetration}/${critBonusPenetration}</td>
    <td title="Crit range result ${critScoreResult}">[${critScore}]</td>
  </tr>
</table>

<hr>

<table style="width:100%; text-align:center; font-size:15px;">
  <tr><th>Effects</th></tr>
  <tr>
    <td><b>${allBleedRollResults}</b> ${effectsRollResults}</td>
  </tr>
</table>
`;
}
