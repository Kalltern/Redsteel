/**
 * Follow-up attribute test triggered from a chat "Margin of Success" line.
 *
 * When an attack/spell posts an "<Attribute> Test — Margin of Success: [x]"
 * line, that line is clickable. The acting player picks an attribute, then we
 * roll:   <attribute rating> - 1d100 - <original margin of success>
 *
 * This lets the second roll be modified directly by the previous margin.
 */

const ATTRIBUTE_LABELS = {
  str: "Strength",
  dex: "Dexterity",
  end: "Endurance",
  int: "Intelligence",
  wil: "Will",
  cha: "Charisma",
  per: "Perception",
};

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
  for (const [key, label] of Object.entries(ATTRIBUTE_LABELS)) {
    const attr = actor.system.attributes?.[key];
    if (!attr) continue;

    const rating = actor.type === "npc" ? (attr.value ?? 0) : (attr.mod ?? 0);
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
  const label = ATTRIBUTE_LABELS[key] ?? key;
  const vsLabel = source ? source : `Margin ${margin}`;

  const roll = new Roll(`${rating} - 1d100 - ${margin}`);
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

  let flavor = `<p style="text-align:center; font-size:18px;"><b>${label} Test vs ${vsLabel}</b></p>`;
  if (criticalMessage) {
    flavor += `<hr><p style="text-align:center; font-size:20px;"><b>${criticalMessage}</b></p>`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    rollMode: game.settings.get("core", "rollMode"),
  });
}
