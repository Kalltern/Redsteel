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
import { versusTestBonus } from "./testRating.mjs";

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

/**
 * Parse a comma-separated list of attribute keys ("str, End") into canonical
 * keys, dropping anything that is not one of ATTRIBUTE_KEYS.
 *
 * @param {string|string[]|null|undefined} value
 * @returns {string[]}
 */
export function parseAttributeKeys(value) {
  const parts = Array.isArray(value) ? value : String(value ?? "").split(",");
  const keys = parts
    .map((part) => String(part ?? "").trim().toLowerCase())
    .filter((key) => ATTRIBUTE_KEYS.includes(key));
  return [...new Set(keys)];
}

/**
 * Which attributes this actor may answer a versus Test with.
 *
 * The ruling: the defender's attribute is defined by the test itself. A test
 * posted "versus target's Strength/Endurance" (the item's
 * `system.versusAgainst`, carried onto the card as `data-against`) may only be
 * answered with Strength or Endurance. An empty list means the test names no
 * defender attribute, so every attribute is allowed (the legacy behaviour).
 *
 * The one exception is a feature that specifically allows a different
 * attribute. Features grant that through an Active Effect change on
 * `system.versusAlternates` (mode OVERRIDE), e.g. key
 * `system.versusAlternates.dex`, value `"end"`: wherever Dexterity is allowed,
 * Endurance may be used instead. The key `any` adds its attributes to every
 * versus Test. Values are comma-separated attribute keys; unknown keys are
 * ignored.
 *
 * @param {Actor} actor
 * @param {string[]|string|null} against  Attribute keys the test allows.
 * @returns {{key: string, viaFeature: boolean}[]} In ATTRIBUTE_KEYS order.
 */
export function resolveVersusChoices(actor, against) {
  const restricted = parseAttributeKeys(against);
  const allowed = new Set(restricted.length ? restricted : ATTRIBUTE_KEYS);

  const alternates = actor?.system?.versusAlternates;
  const viaFeature = new Set();
  if (alternates && typeof alternates === "object") {
    for (const [from, value] of Object.entries(alternates)) {
      const source = String(from).trim().toLowerCase();
      if (source !== "any" && !allowed.has(source)) continue;
      for (const key of parseAttributeKeys(value)) {
        if (!allowed.has(key)) viaFeature.add(key);
      }
    }
  }

  return ATTRIBUTE_KEYS.filter(
    (key) => allowed.has(key) || viaFeature.has(key),
  ).map((key) => ({ key, viaFeature: !allowed.has(key) }));
}

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
 * @param {string} [data.against] Attribute keys the defender may answer with
 *   ("str,end", the item's system.versusAgainst). Empty = any attribute.
 * @returns {string} HTML.
 */
export function renderMarginFollowupLine({
  margin,
  source,
  chance = null,
  result = null,
  onLose = null,
  against = null,
}) {
  const tooltip = [
    chance != null ? `Test chance ${chance}%` : null,
    result != null ? `Rolled: ${result}` : null,
    "Click to contest with your own attribute test",
  ]
    .filter(Boolean)
    .join("<br>");

  const loseAttr = onLose ? ` data-on-lose="${onLose}"` : "";
  // The posted chance lets Break Free roll the whole contest again
  // (escapeFollowup.mjs), both sides fresh.
  const chanceAttr = chance != null ? ` data-chance="${chance}"` : "";
  const againstAttr = renderAgainstAttr(against);
  return `<span class="mos-followup" data-margin="${margin}" data-source="${source ?? ""}"${loseAttr}${chanceAttr}${againstAttr} data-tooltip="${tooltip}" style="cursor:pointer; text-decoration:underline dotted;">Margin of Success: [${margin}]</span>`;
}

/**
 * `system.versusAgainst` of every compendium Item that has one, so a copy
 * that predates the field (already on a sheet, or in the world) still reads
 * the defender's attributes without being re-imported. Keyed by compendium
 * uuid (a copy's `_stats.compendiumSource`), and by English name and
 * localized name as the fallback, which is also what an old chat line's
 * `data-source` holds. Filled once on ready (loadVersusIndex).
 */
const PACK_VERSUS = { byUuid: new Map(), byName: new Map() };

/** Build PACK_VERSUS from the Item compendium indexes. Called on ready. */
export async function loadVersusIndex() {
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    let index;
    try {
      index = await pack.getIndex({
        fields: ["system.versusAgainst", "system.localizationKey"],
      });
    } catch (err) {
      console.warn(`Redsteel | versus index skipped ${pack.collection}`, err);
      continue;
    }
    for (const entry of index) {
      const against = parseAttributeKeys(entry.system?.versusAgainst);
      if (!against.length) continue;
      const value = against.join(",");
      if (entry.uuid) PACK_VERSUS.byUuid.set(entry.uuid, value);
      const names = [entry.name];
      const key = entry.system?.localizationKey;
      if (key && game.i18n.has(key)) names.push(game.i18n.localize(key));
      for (const name of names) {
        if (name) PACK_VERSUS.byName.set(name.trim().toLowerCase(), value);
      }
    }
  }
}

/**
 * The defender's attributes for this item's versus Test: its own field, else
 * its compendium original's, else a compendium item of the same name.
 *
 * @param {Item|null|undefined} item
 * @returns {string} "str,end", or "" when unrestricted.
 */
export function versusAgainstFor(item) {
  const own = parseAttributeKeys(item?.system?.versusAgainst);
  if (own.length) return own.join(",");
  const source = item?._stats?.compendiumSource;
  if (source && PACK_VERSUS.byUuid.has(source)) {
    return PACK_VERSUS.byUuid.get(source);
  }
  return versusAgainstForName(item?.name) || versusAgainstForName(item?.localizedName);
}

/**
 * A compendium item's defender attributes by name ("" when none). Old chat
 * lines posted without `data-against` are resolved through their
 * `data-source`.
 *
 * @param {string|null|undefined} name
 * @returns {string}
 */
export function versusAgainstForName(name) {
  if (!name) return "";
  return PACK_VERSUS.byName.get(String(name).trim().toLowerCase()) ?? "";
}

/**
 * The ` data-against="…"` attribute for a margin line, or "" when the test
 * names no defender attribute. Shared by every emitter of `.mos-followup`.
 *
 * @param {string|string[]|null|undefined} against
 * @returns {string}
 */
export function renderAgainstAttr(against) {
  const keys = parseAttributeKeys(against);
  if (!keys.length) return "";
  return ` data-against="${foundry.utils.escapeHTML(keys.join(","))}"`;
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
        against: parseAttributeKeys(
          el.dataset.against || versusAgainstForName(el.dataset.source),
        ),
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
 * @param {object} [options]
 * @param {string|null} [options.onLose]  What the contester forfeits on a
 *   loss, from the line's data-on-lose (see versusLossFor).
 * @param {Actor|null} [options.actor]  Who contests. Given, it skips the token
 *   pick (the hotbar's Escape chip already knows who is bound).
 * @param {Function|null} [options.onRolled]  Awaited once the roll is posted,
 *   never on a cancelled dialog (the Escape chip pays its Action here).
 * @param {{chance: number, effectUuid?: string}|null} [options.contest]
 *   Roll the whole contest again instead of beating a posted margin: the
 *   initiator's side is re-rolled from its posted chance inside the same
 *   formula, so a chat Re-Roll repeats both sides too. With `effectUuid`
 *   (Break Free), a win deletes that effect (settleBreakFree).
 * @param {string[]|null} [options.against]  Attribute keys the test lets the
 *   defender answer with (from data-against). Empty = any attribute. Feature
 *   alternates are added on top (resolveVersusChoices).
 */
export function promptAttributeFollowup(
  margin,
  source = "",
  {
    onLose = null,
    actor = null,
    onRolled = null,
    contest = null,
    against = null,
  } = {},
) {
  if (!actor) {
    const context = game.redsteel.selectToken({ notifyFallback: true });
    if (!context) return;
    actor = context.actor;
  }

  // Only the attributes the test names (plus feature alternates). A single
  // remaining button still opens the dialog so the player confirms the roll.
  const buttons = {};
  for (const { key, viaFeature } of resolveVersusChoices(actor, against)) {
    const attr = actor.system.attributes?.[key];
    if (!attr) continue;
    const label = attributeLabel(key);

    // `mod` is the success chance both sheets roll against (character: 15 +
    // attribute*10 + globalMod; NPC: value + modBonus + globalMod). Reading
    // the raw NPC `value` here used to drop its globalMod, so an NPC contested
    // a roll with a different number than its own sheet would have used.
    // Plus the answering side's versus Test bonus (Servant of the Sword's
    // Combat Dexterity Tests), shown in the button's number.
    const rating = (attr.mod ?? 0) + versusTestBonus(actor, key);
    buttons[key] = {
      label: viaFeature
        ? game.i18n.format("REDSTEEL.Versus.ViaFeature", { label, rating })
        : `${label} (${rating})`,
      callback: () =>
        rollAttributeFollowup(
          actor,
          key,
          rating,
          margin,
          source,
          onLose,
          onRolled,
          contest,
        ),
    };
  }

  if (!Object.keys(buttons).length) {
    ui.notifications.warn("This actor has no attributes to roll.");
    return;
  }

  new Dialog(
    {
      title: "Attribute Test",
      content: contest
        ? `<p style="text-align:center;">${game.i18n.format(
            "REDSTEEL.Bg3Hotbar.Suggest.EscapePick",
            {
              source: foundry.utils.escapeHTML(source),
              chance: contest.chance,
            },
          )}</p>`
        : `<p style="text-align:center;">Roll which attribute against margin <b>${margin}</b>?</p>`,
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
 * @param {Function|null} [onRolled]  Awaited after the card is posted.
 * @param {object|null} [contest]  See promptAttributeFollowup.
 */
async function rollAttributeFollowup(
  actor,
  key,
  rating,
  margin,
  source = "",
  onLose = null,
  onRolled = null,
  contest = null,
) {
  const label = attributeLabel(key);
  const fresh = Number.isFinite(contest?.chance);
  const vsLabel = fresh
    ? `${source} ${contest.chance}%`
    : source
      ? source
      : `Margin ${margin}`;

  // A fresh contest rolls the initiator's side in the same formula. The roll
  // bias rewrites only the first 1d100, which is the contester's own die, and
  // a chat Re-Roll re-evaluates the whole formula, so both sides roll again.
  const roll = new Roll(
    fresh
      ? `${rating} - 1d100 - (${contest.chance} - 1d100)`
      : `${rating} - 1d100 - ${margin}`,
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
    {
      margin,
      source,
      ...(onLose && { onLose }),
      ...(fresh && { chance: contest.chance }),
      ...(contest?.effectUuid && { breakFree: contest.effectUuid }),
    },
    roll.total,
  );
  const freedNote = await settleBreakFree(settled.followup, roll.total);
  let flavor = `<p class="rs-card-headline"><b>${rollName}</b></p>
${renderVersusOutcome(roll.total)}${settled.note}${freedNote}`;
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
  if (onRolled) await onRolled();
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

/**
 * Break Free: a won contest removes the effect that bound the contester. Runs
 * on the contester's own client (their own effect, so ordinary ownership
 * covers the delete), both after the first roll and after every chat Re-Roll
 * (executeReroll). A Re-Roll only ever follows a loss, and an effect already
 * gone is left alone, so nothing is ever put back.
 *
 * @param {object} followup  The `versusFollowup` flag.
 * @param {number} total     The contester's roll total (a tie is a loss).
 * @returns {Promise<string>} The note for the card, or "".
 */
export async function settleBreakFree(followup, total) {
  if (!followup?.breakFree || total <= 0) return "";
  const effect = fromUuidSync(followup.breakFree);
  if (!effect) return "";
  const name = game.i18n.localize(effect.name);
  const actorName = effect.parent?.name ?? "";
  await effect.delete();
  return `<p style="text-align:center;">${game.i18n.format(
    "REDSTEEL.Bg3Hotbar.Suggest.BrokeFree",
    {
      name: foundry.utils.escapeHTML(actorName),
      effect: foundry.utils.escapeHTML(name),
    },
  )}</p>`;
}
