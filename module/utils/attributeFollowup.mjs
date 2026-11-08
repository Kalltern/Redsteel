/**
 * Follow-up attribute test triggered from a chat "Margin of Success" line —
 * the system's "versus Test".
 *
 * When an attack/spell, or a plain attribute roll from a sheet, posts a
 * gilded "Margin of Success" panel, its margin is clickable. The acting player
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

import {
  withRollBias,
  tagRollSkill,
  forfeitAdvantageOnCritFail,
  capHopelessNatural,
  markHopelessNatural,
} from "./rollAdvantage.mjs";
import { spend, getSpent, setSpent } from "./actionTracker.mjs";
import { versusTestBonus } from "./testRating.mjs";
import { takeMagicReinforcement } from "./veneficus.mjs";
import { resolveVersus, CRITICAL_GAP } from "./defenseOdds.mjs";

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
 * The natural critical range of whatever an actor tested. A natural 1 and a
 * natural 100 are absolute (book), so those are the floor for anything without
 * a range of its own.
 *
 * @param {Actor} actor
 * @param {string|null} skillKey  The bucket from resolveTestRating, or an
 *   attribute key.
 * @returns {{success: number, failure: number}}
 */
export function testCritBounds(actor, skillKey) {
  const system = actor?.system ?? {};
  const stat =
    system.combatSkills?.[skillKey] ??
    system.skills?.[skillKey] ??
    system.attributes?.[skillKey];
  return {
    success: stat?.criticalSuccessThreshold ?? 1,
    failure: stat?.criticalFailureThreshold ?? 100,
  };
}

/**
 * A posted roll's natural reading, for `natural` on renderMarginFollowupLine.
 * Call it straight after evaluating and before reading the margin: a natural
 * critical on a negative chance sets the margin to 0 (capHopelessNatural), and
 * the line then carries a range that no die can reach.
 *
 * @param {Actor} actor
 * @param {string|null} skillKey
 * @param {Roll} roll  The evaluated test.
 * @returns {{die: number|null, success: number, failure: number}}
 */
export function versusNatural(actor, skillKey, roll) {
  const bounds = testCritBounds(actor, skillKey);
  return {
    die: roll.dice?.[0]?.total ?? null,
    success: capHopelessNatural(roll, bounds.success) ? 0 : bounds.success,
    failure: bounds.failure,
  };
}

/** Which natural critical a die is, read against a range. */
export function naturalCritical(die, { success = 1, failure = 100 } = {}) {
  return {
    success: die != null && die <= success,
    failure: die != null && die >= failure,
  };
}

/**
 * One side of a contest rolled in a shared formula, from its chance and die: a
 * natural critical on a negative chance is a common success with a margin of 0.
 *
 * @param {number} chance
 * @param {number|null} die
 * @param {{success?: number, failure?: number}} [bounds]
 * @returns {{margin: number, success: boolean, failure: boolean,
 *   hopeless: boolean}}
 */
export function contestSide(chance, die, bounds = {}) {
  const critical = naturalCritical(die, bounds);
  const hopeless = chance < 0 && critical.success;
  return {
    margin: hopeless ? 0 : chance - die,
    success: critical.success && !hopeless,
    failure: critical.failure,
    hopeless,
  };
}

/**
 * Settle two sides that each rolled their own `chance - 1d100` by the combat
 * rule, the initiator in the attacker's place. For a contest the system rolls
 * whole (the spell contests), where nobody clicks a margin line.
 *
 * @param {{roll: Roll, actor: Actor|null, skillKey: string}} initiator
 * @param {{roll: Roll, actor: Actor|null, skillKey: string}} contester
 * @returns {object} The resolveVersus verdict. `blocked` means the contester won.
 */
export function settleOpposedRolls(initiator, contester) {
  const read = ({ roll, actor, skillKey }) => {
    const natural = versusNatural(actor, skillKey, roll);
    return { natural, ...naturalCritical(natural.die, natural) };
  };
  const mine = read(initiator);
  const theirs = read(contester);
  return resolveVersus(
    {
      margin: initiator.roll.total,
      d100: mine.natural.die,
      criticalSuccess: mine.success,
      criticalFailure: mine.failure,
    },
    {
      defenseTotal: contester.roll.total,
      defenseD100: theirs.natural.die,
      defenseCrit: theirs.success,
      defenseCritFailure: theirs.failure,
    },
  );
}

/** The natural reading a margin line carries, or null on an older line. */
export function readLineNatural(el) {
  const die = Number(el.dataset.die);
  if (el.dataset.die == null || !Number.isFinite(die)) return null;
  return {
    die,
    success: Number(el.dataset.critSuccess),
    failure: Number(el.dataset.critFailure),
  };
}

/**
 * The gilded versus Test panel with the clickable margin that opens the
 * contest. Kept here next to its click handler so the markup and the handler
 * cannot drift apart. Every margin a card posts (ability, modifier, spell,
 * sheet attribute roll, reroll) comes through here, so they all read the same.
 *
 * @param {object} data
 * @param {number} data.margin    The posted margin the contester has to beat.
 * @param {string} data.source    Name of the originating roll (for flavor).
 * @param {number} [data.chance]  Success chance of the posted roll, for the tooltip.
 * @param {string} [data.result]  Dice breakdown of the posted roll, for the tooltip.
 * @param {string} [data.against] Attribute keys the defender may answer with
 *   ("str,end", the item's system.versusAgainst). Empty = any attribute.
 * @param {string} [data.mirror]  The attribute the posted roll tested (a sheet
 *   attribute roll). A left click answers with the same attribute instead of
 *   the defender's best, so Strength vs Strength stays a Strength test and
 *   Muscular can reroll it. Right click still offers every allowed attribute.
 * @param {string} [data.heading] Optional line above the margin, only to
 *   tell several panels on one card apart (a modifier's name). Never the
 *   test name or chance: the roller already knows both.
 * @param {{die: number|null, success: number, failure: number}} [data.natural]
 *   The posted die and its critical range (versusNatural). A natural critical
 *   settles the contest as it does in combat, and the contester's client only
 *   has this line to read it from.
 * @returns {string} HTML.
 */
export function renderMarginFollowupLine({
  margin,
  source,
  chance = null,
  result = null,
  onLose = null,
  against = null,
  mirror = null,
  heading = "",
  natural = null,
}) {
  const tooltip = [
    chance != null ? `Test chance ${chance}%` : null,
    result != null ? `Rolled: ${result}` : null,
  ]
    .filter(Boolean)
    .join("<br>");

  const loseAttr = onLose ? ` data-on-lose="${onLose}"` : "";
  // The posted chance lets Break Free roll the whole contest again
  // (escapeFollowup.mjs), both sides fresh.
  const chanceAttr = chance != null ? ` data-chance="${chance}"` : "";
  const againstAttr = renderAgainstAttr(against);
  const mirrorAttr = ATTRIBUTE_KEYS.includes(mirror)
    ? ` data-mirror="${mirror}"`
    : "";
  const naturalAttr = Number.isFinite(natural?.die)
    ? ` data-die="${natural.die}" data-crit-success="${natural.success ?? 1}" data-crit-failure="${natural.failure ?? 100}"`
    : "";
  const line = `<span class="mos-followup" data-margin="${margin}" data-source="${source ?? ""}"${loseAttr}${chanceAttr}${againstAttr}${mirrorAttr}${naturalAttr} data-tooltip="${tooltip}"><span class="rs-vs-test__label">Margin of Success</span><span class="rs-vs-test__value">${margin}</span></span>`;
  return renderVersusTestBlock({ heading, line });
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
 * The gilded "versus Test" panel around a clickable contest number.
 *
 * A versus Test is decided by this one number, so it gets its own block
 * rather than a line of prose: the margin is what the defender has to beat,
 * and it is the only thing on the card anyone clicks. Wraps either kind of
 * contest (the attribute `.mos-followup` or the speed `.speed-followup`); the
 * two renderers call this themselves, so callers never wrap their output.
 *
 * @param {object} data
 * @param {string} data.heading  Optional, e.g. a modifier's name.
 * @param {string} data.line     The clickable contest span.
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
  // Left click rolls the highest chance straight away; right click opens the
  // picker, for when a lower number is the better roll (a disadvantage on the
  // best attribute, or a reroll that only another attribute can use).
  for (const el of html.querySelectorAll(".mos-followup")) {
    // The click hint is added here, not baked into the card, so cards posted
    // before a change (or in another language) still explain both clicks.
    const baked = (el.dataset.tooltip ?? "")
      .split("<br>")
      .filter((part) => part && !part.startsWith("Click to contest"));
    baked.push(
      game.i18n.localize(
        el.dataset.mirror
          ? "REDSTEEL.Versus.ClickHintMirror"
          : "REDSTEEL.Versus.ClickHint",
      ),
    );
    el.dataset.tooltip = baked.join("<br>");
    // The card the line sits on, so the answer can name what it answered
    // (Incantator's Precise Incantation forces a resisted spell's answer to
    // be rerolled, utils/incantator.mjs).
    const origin = el.closest("[data-message-id]")?.dataset?.messageId ?? null;
    const open = (autoPick) => {
      const margin = Number(el.dataset.margin);
      if (Number.isNaN(margin)) return;
      promptAttributeFollowup(margin, el.dataset.source ?? "", {
        origin,
        onLose: el.dataset.onLose ?? null,
        against: parseAttributeKeys(
          el.dataset.against || versusAgainstForName(el.dataset.source),
        ),
        mirror: el.dataset.mirror ?? null,
        natural: readLineNatural(el),
        autoPick,
      });
    };
    el.addEventListener("click", () => open(true));
    el.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      open(false);
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
 * @param {boolean} [options.autoPick]  Roll the highest-rated choice without
 *   asking (a left click on the chat margin). A single choice never asks.
 * @param {string|null} [options.mirror]  The attribute the posted roll tested
 *   (data-mirror). autoPick rolls it instead of the highest when allowed.
 * @param {{die: number, success: number, failure: number}|null} [options.natural]
 *   The posted roll's natural reading, from the line. A `contest` rolls a new
 *   die for that side and only reads the range from it.
 * @param {string|null} [options.origin]  Id of the card whose line was
 *   answered, stamped on the answer's `versusFollowup.origin`.
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
    mirror = null,
    natural = null,
    autoPick = false,
    origin = null,
  } = {},
) {
  if (!actor) {
    const context = game.redsteel.selectToken({ notifyFallback: true });
    if (!context) return;
    actor = context.actor;
  }

  // Only the attributes the test names (plus feature alternates).
  const buttons = {};
  let best = null;
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
    // Ties keep the earlier, test-named attribute over a feature alternate.
    if (!best || rating > best.rating) best = { key, rating };
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
          natural,
          origin,
        ),
    };
  }

  const keys = Object.keys(buttons);
  if (!keys.length) {
    ui.notifications.warn("This actor has no attributes to roll.");
    return;
  }

  // Nothing to choose, or the player asked for their best chance: roll now.
  if (keys.length === 1 || autoPick) {
    (buttons[mirror] ?? buttons[best.key]).callback();
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
 * @param {object|null} [natural]  See promptAttributeFollowup.
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
  natural = null,
  origin = null,
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
  // Veneficus → Magické posílení: Advantage on answering a Strength or
  // Dexterity versus Test, spent by it (veneficus.mjs).
  await takeMagicReinforcement(actor, roll, key);
  await roll.evaluate();

  // Primary attribute rolls honour critical thresholds (based on the raw d100).
  const attr = actor.system.attributes[key];
  // A fumbling first die forfeits advantage; read the die only after.
  forfeitAdvantageOnCritFail(roll, attr?.criticalFailureThreshold);

  const rollName = `${label} Test vs ${vsLabel}`;
  // The verdict says what a critical did, so the card prints no separate
  // Critical line: two natural criticals deny each other and neither stands.
  const judged = judgeVersusAnswer(
    roll,
    {
      margin,
      source,
      ...(onLose && { onLose }),
      ...(fresh && { chance: contest.chance }),
      ...(contest?.effectUuid && { breakFree: contest.effectUuid }),
      ...(natural && { natural }),
      ...(origin && { origin }),
    },
    {
      success: attr?.criticalSuccessThreshold,
      failure: attr?.criticalFailureThreshold,
    },
  );
  const settled = await settleVersusLoss(actor, judged.followup, roll.total);
  const freedNote = await settleBreakFree(settled.followup, roll.total);
  const flavor = `<p class="rs-card-headline"><b>${rollName}</b></p>
${renderVersusOutcome(judged.verdict, {
  detail: renderOwnMargin(roll, settled.followup),
})}${settled.note}${freedNote}`;

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
 * Settle a contester's answer exactly as a defense is settled (user ruling
 * 2026-10-31): the initiator stands where the attacker does, so a tie is theirs,
 * a natural critical is absolute, two opposing naturals fall to the lower die,
 * and a gap of 60 is critical. The verdict is defenseOdds.mjs resolveVersus,
 * which is what stops combat and versus Tests drifting apart.
 *
 * A line posted before it carried a die reads as a plain margin on that side,
 * so the contester's own natural still counts.
 *
 * A natural critical on a negative chance is read here rather than in the roll
 * layer, because this formula also subtracts the opposing margin. The total is
 * then rewritten to the real gap, so everything reading it afterwards agrees.
 *
 * @param {Roll} roll         The contester's evaluated roll.
 * @param {object} followup   The `versusFollowup` flag.
 * @param {{success?: number, failure?: number}} [own]  Contester's critical range.
 * @returns {{verdict: object, followup: object}} The flag with `won` and
 *   `critical` stamped, which is what every reader of the result goes by.
 */
export function judgeVersusAnswer(roll, followup, own = {}) {
  const theirs = opposingSide(roll, followup);
  const base = Number.isFinite(theirs.margin) ? theirs.margin : 0;
  // The formula holds the opposing margin as it rolled, not as it was settled.
  const rolled = Number.isFinite(theirs.rolled) ? theirs.rolled : base;
  const myDie = roll.dice?.[0]?.total ?? null;
  const mine = contestSide(rolled + roll.total + myDie, myDie, {
    success: own.success ?? undefined,
    failure: own.failure ?? undefined,
  });
  if (mine.hopeless) markHopelessNatural(roll);
  if (mine.hopeless || theirs.hopeless) roll._total = mine.margin - base;
  const verdict = resolveVersus(
    {
      margin: base,
      d100: theirs.die,
      criticalSuccess: theirs.success,
      criticalFailure: theirs.failure,
    },
    {
      defenseTotal: mine.margin,
      defenseD100: myDie,
      defenseCrit: mine.success,
      defenseCritFailure: mine.failure,
    },
  );
  return {
    verdict,
    followup: {
      ...followup,
      won: verdict.blocked,
      critical: verdict.critical !== null,
    },
  };
}

/**
 * Who took a versus answer, and by how much, for everything downstream that
 * reads the result rather than the card. A card posted before `won` was stamped
 * falls back on the margins.
 *
 * A natural critical counts as the full 60 it stands level with, so a push that
 * wants a gap of 50 still gets it. A natural that overturned the margins leaves
 * no gap worth quoting: the winner was behind.
 *
 * @param {object} followup  The `versusFollowup` flag.
 * @param {number} total     The contester's roll total.
 * @returns {{attackerWon: boolean, gap: number}}
 */
export function versusAnswerOutcome(followup, total) {
  const won = typeof followup?.won === "boolean" ? followup.won : total > 0;
  const margins = Math.abs(total);
  const agrees = won === total > 0;
  const gap = followup?.critical
    ? Math.max(margins, CRITICAL_GAP)
    : agrees
      ? margins
      : 0;
  return { attackerWon: !won, gap };
}

/**
 * The "Won by 18 MoS" block under a versus Test, or the die when a natural
 * critical made the margins irrelevant. Several rules read the gap (Odstrčení
 * at 25+, jousting at 30 and 60). A dead tie goes to whoever posted the roll.
 *
 * Built as a `.rs-versus` block so it reads like a defense card and survives
 * the chat card fold the same way.
 *
 * @param {object} verdict  From resolveVersus.
 * @param {object} [options]
 * @param {"attack"|"defense"} [options.side]  Whose card this is. The contester
 *   answering a line is "defense"; Slip Through's card is the initiator's.
 * @param {string} [options.detail]  Line under the outcome, see renderOwnMargin.
 * @returns {string} HTML.
 */
export function renderVersusOutcome(
  verdict,
  { side = "defense", detail = "" } = {},
) {
  const { gap, blocked, critical, onDice, natural } = verdict;
  const won = side === "defense" ? blocked : !blocked;
  const result = game.i18n.localize(
    critical
      ? won
        ? "REDSTEEL.Versus.CriticalWin"
        : "REDSTEEL.Versus.CriticalLoss"
      : won
        ? "REDSTEEL.Versus.Won"
        : "REDSTEEL.Versus.Lost",
  );
  const tied = !natural && gap === 0;

  const outcome = natural
    ? game.i18n.format("REDSTEEL.Versus.ByNatural", {
        outcome: result,
        die: natural.die,
      })
    : tied
      ? game.i18n.localize("REDSTEEL.Versus.TieInitiator")
      : game.i18n.format("REDSTEEL.Versus.ByMargin", {
          outcome: result,
          mos: Math.abs(gap),
        });

  const mine = natural?.side === side;
  const noteText = !natural
    ? ""
    : !onDice
      ? game.i18n.format(
          mine ? "REDSTEEL.Versus.NaturalOwn" : "REDSTEEL.Versus.NaturalOpposing",
          { die: natural.die },
        )
      : natural.die === natural.other
        ? game.i18n.format("REDSTEEL.Versus.DeniedOnDiceInitiator", {
            die: natural.die,
          })
        : game.i18n.format("REDSTEEL.Versus.DeniedOnDiceOwn", {
            own: mine ? natural.die : natural.other,
            opposing: mine ? natural.other : natural.die,
          });
  const note = noteText
    ? `<div class="rs-versus-note">${noteText}</div>`
    : "";

  const state = critical
    ? won
      ? "is-critical-defense"
      : "is-critical-hit"
    : tied
      ? "is-tied"
      : won
        ? "is-won"
        : "is-lost";
  return `<div class="rs-versus ${state}"><div class="rs-versus-outcome">${outcome}</div>${detail}${note}</div>`;
}

/**
 * The side the contester answered. A fresh contest rolled the initiator's die
 * in the same formula (its second 1d100), so their side is read off that die.
 *
 * @param {Roll} roll         The contester's evaluated roll.
 * @param {object} followup   The `versusFollowup` flag ({margin, chance?, natural?}).
 * @returns {{margin: number, die: number|null, success: boolean,
 *   failure: boolean, hopeless?: boolean, rolled?: number}} A NaN margin when
 *   it cannot be read. `rolled` is a fresh contest's margin before settling.
 */
function opposingSide(roll, followup) {
  const natural = followup?.natural ?? {};
  if (Number.isFinite(followup?.chance)) {
    const die = roll.dice?.[1]?.total;
    if (!Number.isFinite(die)) {
      return { margin: NaN, die: null, success: false, failure: false };
    }
    return {
      die,
      rolled: followup.chance - die,
      ...contestSide(followup.chance, die, natural),
    };
  }
  const die = natural.die ?? null;
  return {
    margin: Number(followup?.margin),
    die,
    ...naturalCritical(die, natural),
  };
}

/**
 * The contester's own margin beside the one they answered, so a later reroll
 * by the initiator can be read against it at a glance instead of being worked
 * back out of the gap.
 *
 * @param {Roll} roll         The contester's evaluated roll.
 * @param {object} followup   The `versusFollowup` flag ({margin, chance?}).
 * @returns {string} HTML, or "" when the opposing margin cannot be read.
 */
export function renderOwnMargin(roll, followup) {
  const opposing = opposingSide(roll, followup).margin;
  if (!Number.isFinite(opposing)) return "";
  const text = game.i18n.format("REDSTEEL.Versus.OwnMargin", {
    own: roll.total + opposing,
    opposing,
  });
  return `<div class="rs-versus-detail">${text}</div>`;
}

/**
 * Charge (or hand back) what the loser of a versus Test forfeits.
 *
 * Runs on the contester's own client against their own actor, so ordinary
 * ownership covers the tracker write. The contester is the target, and whether
 * they lost is the settled answer, not just the margins (versusAnswerOutcome).
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
  const lost = versusAnswerOutcome(followup, total).attackerWon;
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
  if (!followup?.breakFree) return "";
  if (versusAnswerOutcome(followup, total).attackerWon) return "";
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
