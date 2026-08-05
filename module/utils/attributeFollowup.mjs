/**
 * Follow-up attribute test triggered from a chat "Margin of Success" line —
 * the system's "versus Test".
 *
 * When an attack/spell, or a plain attribute roll from a sheet, posts a
 * "Margin of Success: [x]" line, that line is clickable. The acting player
 * picks an attribute, then we roll:
 *
 *   <attribute rating> - 1d100 - <original margin of success>
 *
 * Subtracting the opposing margin makes the result *the difference between the
 * two margins*, which is what the rules key off ("rozdíl 25 a více", "méně než
 * 30", …). Positive means the contester came out ahead; a dead tie goes to
 * whoever posted the original roll, as in a Mental Duel.
 *
 * Note the picked attribute need not match the one that was posted — versus
 * Tests are routinely cross-attribute ("Test Síly versus Test Síly/Odolnosti").
 */

import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";

const ATTRIBUTE_KEYS = ["str", "dex", "end", "int", "wil", "cha", "per"];

/** Localized attribute name, matching the labels on the sheets. */
function attributeLabel(key) {
  const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
  const path = `REDSTEEL.Actor.Character.Attribute.${capitalized}.long`;
  const localized = game.i18n.localize(path);
  return localized === path ? key : localized;
}

/**
 * The clickable "Margin of Success" line that opens a versus Test. Kept here
 * next to its click handler so the markup and the handler cannot drift apart.
 *
 * @param {object} data
 * @param {number} data.margin    The posted margin the contester has to beat.
 * @param {string} data.source    Name of the originating roll (for flavor).
 * @param {number} [data.chance]  Success chance of the posted roll, for the tooltip.
 * @param {string} [data.result]  Dice breakdown of the posted roll, for the tooltip.
 * @returns {string} HTML.
 */
export function renderMarginFollowupLine({
  margin,
  source,
  chance = null,
  result = null,
}) {
  const tooltip = [
    chance != null ? `Test chance ${chance}%` : null,
    result != null ? `Rolled: ${result}` : null,
    "Click to contest with your own attribute test",
  ]
    .filter(Boolean)
    .join("<br>");

  return `<span class="mos-followup" data-margin="${margin}" data-source="${source ?? ""}" data-tooltip="${tooltip}" style="cursor:pointer; text-decoration:underline dotted;">Margin of Success: [${margin}]</span>`;
}

/**
 * Attach click handlers to any margin-of-success follow-up triggers found in a
 * rendered chat message.
 *
 * @param {HTMLElement} html  The rendered chat message element.
 */
export function wireAttributeFollowups(html) {
  for (const el of html.querySelectorAll(".mos-followup")) {
    el.addEventListener("click", () => {
      const margin = Number(el.dataset.margin);
      if (Number.isNaN(margin)) return;
      promptAttributeFollowup(margin, el.dataset.source ?? "");
    });
  }
}

/**
 * Open the attribute-choice dialog and roll the chosen attribute against the
 * supplied margin of success.
 *
 * @param {number} margin  The original margin of success to subtract.
 * @param {string} source  Name of the originating ability/spell (for flavor).
 */
export function promptAttributeFollowup(margin, source = "") {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;
  const { actor } = context;

  const buttons = {};
  for (const key of ATTRIBUTE_KEYS) {
    const attr = actor.system.attributes?.[key];
    if (!attr) continue;
    const label = attributeLabel(key);

    // `mod` is the success chance both sheets roll against (character: 15 +
    // attribute*10 + globalMod; NPC: value + modBonus + globalMod). Reading
    // the raw NPC `value` here used to drop its globalMod, so an NPC contested
    // a roll with a different number than its own sheet would have used.
    const rating = attr.mod ?? 0;
    buttons[key] = {
      label: `${label} (${rating})`,
      callback: () => rollAttributeFollowup(actor, key, rating, margin, source),
    };
  }

  if (!Object.keys(buttons).length) {
    ui.notifications.warn("This actor has no attributes to roll.");
    return;
  }

  new Dialog(
    {
      title: "Attribute Test",
      content: `<p style="text-align:center;">Roll which attribute against margin <b>${margin}</b>?</p>`,
      buttons,
    },
    { classes: ["dialog", "attribute-followup-dialog"] },
  ).render(true);
}

/**
 * Perform and post the follow-up attribute roll.
 *
 * @param {Actor}  actor   The rolling actor.
 * @param {string} key     Attribute key (str, dex, …).
 * @param {number} rating  The attribute rating used in the formula.
 * @param {number} margin  The original margin of success.
 */
async function rollAttributeFollowup(actor, key, rating, margin, source = "") {
  const label = attributeLabel(key);
  const vsLabel = source ? source : `Margin ${margin}`;

  const roll = new Roll(
    `${rating} - 1d100 - ${margin}`,
    withRollBias({}, actor),
  );
  tagRollSkill(roll, key);
  await roll.evaluate();

  // Primary attribute rolls honour critical thresholds (based on the raw d100).
  const attr = actor.system.attributes[key];
  const d100 = roll.dice[0]?.total;
  let criticalMessage = "";
  if (d100 != null) {
    if (
      attr?.criticalSuccessThreshold != null &&
      d100 <= attr.criticalSuccessThreshold
    ) {
      criticalMessage = "Critical Success!";
    } else if (
      attr?.criticalFailureThreshold != null &&
      d100 >= attr.criticalFailureThreshold
    ) {
      criticalMessage = "Critical Failure!";
    }
  }

  // The total already *is* the gap between the two margins, so report it as
  // such — several rules read that difference (Odstrčení at 25+, jousting at
  // 30 and 60). A dead tie goes to whoever posted the original roll.
  const gap = Math.abs(roll.total);
  const outcome =
    roll.total > 0
      ? `<b>Wins</b> the contest by ${gap}.`
      : roll.total < 0
        ? `<b>Loses</b> the contest by ${gap}.`
        : "<b>Tie</b>, so the initiator wins.";

  let flavor = `<p style="text-align:center; font-size:18px;"><b>${label} Test vs ${vsLabel}</b></p>
<p style="text-align:center;">${outcome}</p>`;
  if (criticalMessage) {
    flavor += `<hr><p style="text-align:center; font-size:20px;"><b>${criticalMessage}</b></p>`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    rollMode: game.settings.get("core", "rollMode"),
  });
}
