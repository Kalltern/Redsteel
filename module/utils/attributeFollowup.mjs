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
import { spend, getSpent, setSpent } from "./actionTracker.mjs";

/**
 * Abilities whose versus Test costs the loser something, keyed by
 * localizationKey. Rozptýlení: "On attacker's success, the target loses 1
 * Reaction." The English names are the fallback for copies predating the key.
 */
const VERSUS_LOSS = Object.freeze({
  "REDSTEEL.Items.DistractionDexterity.name": "reaction",
  "REDSTEEL.Items.DistractionPerception.name": "reaction",
});
const VERSUS_LOSS_NAMES = Object.freeze({
  "Distraction (Dexterity)": "REDSTEEL.Items.DistractionDexterity.name",
  "Distraction (Perception)": "REDSTEEL.Items.DistractionPerception.name",
});

/** What the loser of this item's versus Test forfeits ("reaction"), or null. */
export function versusLossFor(item) {
  const key =
    item?.system?.localizationKey || VERSUS_LOSS_NAMES[item?.name] || null;
  return (key && VERSUS_LOSS[key]) || null;
}

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
  onLose = null,
}) {
  const tooltip = [
    chance != null ? `Test chance ${chance}%` : null,
    result != null ? `Rolled: ${result}` : null,
    "Click to contest with your own attribute test",
  ]
    .filter(Boolean)
    .join("<br>");

  const loseAttr = onLose ? ` data-on-lose="${onLose}"` : "";
  return `<span class="mos-followup" data-margin="${margin}" data-source="${source ?? ""}"${loseAttr} data-tooltip="${tooltip}" style="cursor:pointer; text-decoration:underline dotted;">Margin of Success: [${margin}]</span>`;
}

/**
 * The gilded "versus Test" panel that closes out a contested ability's
 * description.
 *
 * A versus Test ability is decided by this one number, so it gets its own
 * block at the very bottom of the description rather than a line of prose in
 * the middle of it: the margin is what the defender has to beat, and it is the
 * only thing on the card anyone clicks. Takes either margin line (the attribute
 * `.mos-followup` or the speed `.speed-followup`), so both kinds of contest
 * read the same on a card.
 *
 * @param {object} data
 * @param {string} data.heading  e.g. "Strength Test 45%".
 * @param {string} data.line     The rendered clickable contest line.
 * @returns {string} HTML.
 */
export function renderVersusTestBlock({ heading, line }) {
  return `<div class="rs-vs-test">
  <div class="rs-vs-test__eyebrow">Versus Test</div>
  ${heading ? `<div class="rs-vs-test__heading">${heading}</div>` : ""}
  <div class="rs-vs-test__line">${line}</div>
</div>`;
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
      promptAttributeFollowup(margin, el.dataset.source ?? "", {
        onLose: el.dataset.onLose ?? null,
      });
    });
  }
}

/**
 * Open the attribute-choice dialog and roll the chosen attribute against the
 * supplied margin of success.
 *
 * @param {number} margin  The original margin of success to subtract.
 * @param {string} source  Name of the originating ability/spell (for flavor).
 * @param {{onLose?: string|null}} [options]  What the contester forfeits on a
 *   loss, from the line's data-on-lose (see versusLossFor).
 */
export function promptAttributeFollowup(margin, source = "", { onLose = null } = {}) {
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
      callback: () =>
        rollAttributeFollowup(actor, key, rating, margin, source, onLose),
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
async function rollAttributeFollowup(
  actor,
  key,
  rating,
  margin,
  source = "",
  onLose = null,
) {
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

  const rollName = `${label} Test vs ${vsLabel}`;
  const settled = await settleVersusLoss(
    actor,
    { margin, source, ...(onLose && { onLose }) },
    roll.total,
  );
  let flavor = `<p class="rs-card-headline"><b>${rollName}</b></p>
${renderVersusOutcome(roll.total)}${settled.note}`;
  if (criticalMessage) {
    flavor += `<hr><p class="rs-card-headline"><b>${criticalMessage}</b></p>`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    rollMode: game.settings.get("core", "rollMode"),
    flags: {
      redsteel: {
        // An explicit name, or the createChatMessage hook infers one from the
        // flavor and bakes this roll's "Loses the contest by …" into it, which
        // a reroll would then print over a result that went the other way.
        rollName,
        // Routes the chat Re-Roll through the pool picker (a Strength versus
        // Test is a Strength test) instead of the free reroll.
        skill: key,
        criticalSuccessThreshold: attr?.criticalSuccessThreshold,
        criticalFailureThreshold: attr?.criticalFailureThreshold,
        // Lets a reroll restate who won against the new total (see executeReroll).
        versusFollowup: settled.followup,
      },
    },
  });
}

/**
 * The "Wins / Loses the contest by N" line under a versus Test. The total
 * already *is* the gap between the two margins, so it is reported as such;
 * several rules read that difference (Odstrčení at 25+, jousting at 30 and
 * 60). A dead tie goes to whoever posted the original roll.
 *
 * @param {number} total  The contester's roll total.
 * @returns {string} HTML.
 */
export function renderVersusOutcome(total) {
  const gap = Math.abs(total);
  const outcome =
    total > 0
      ? `<b>Wins</b> the contest by ${gap}.`
      : total < 0
        ? `<b>Loses</b> the contest by ${gap}.`
        : "<b>Tie</b>, so the initiator wins.";
  return `<p style="text-align:center;">${outcome}</p>`;
}

/**
 * Charge (or hand back) what the loser of a versus Test forfeits.
 *
 * Runs on the contester's own client against their own actor, so ordinary
 * ownership covers the tracker write. The contester is the target, and a
 * total at or below 0 means the initiator won (a tie goes to the initiator).
 * `reactionLost` on the followup flag remembers the charge, so a reroll that
 * flips the result refunds it and one that flips it back charges again, never
 * twice.
 *
 * @param {Actor} actor       The contester.
 * @param {object} followup   The `versusFollowup` flag ({margin, source, onLose?, reactionLost?}).
 * @param {number} total      The contester's roll total.
 * @returns {Promise<{followup: object, note: string}>}
 */
export async function settleVersusLoss(actor, followup, total) {
  if (followup?.onLose !== "reaction") return { followup, note: "" };
  const lost = total <= 0;
  const was = !!followup.reactionLost;
  if (actor && lost && !was) await spend(actor, { reactions: 1 });
  if (actor && !lost && was) {
    await setSpent(actor, "reactions", getSpent(actor).reactions - 1);
  }
  const note = lost
    ? `<p style="text-align:center;">${game.i18n.format(
        "REDSTEEL.Distraction.ReactionLost",
        { name: foundry.utils.escapeHTML(actor?.name ?? "") },
      )}</p>`
    : "";
  return { followup: { ...followup, reactionLost: lost }, note };
}
