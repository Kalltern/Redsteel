/**
 * Reroll one versus Test panel inside a bigger card, in place.
 *
 * An attack with a Trip modifier, an ability with a Test Type and a spell with
 * a versus Test all post their attribute test as a gilded Margin of Success
 * panel inside the card (renderMarginFollowupLine). The card's own Re-Roll
 * repeats the card's first roll, so the test could not be rerolled on its own.
 *
 * Each such panel carries what rolling it again needs (`data-panel`,
 * `data-chance`, `data-skill`, `data-bucket`, `data-item-bias`) and a small
 * reroll icon. The icon spends a reroll through the usual picker (redsteel.mjs
 * handleRerollClick, `inPlace` mode), rolls the test fresh and rewrites that
 * one panel in the same message. Nothing is pre-rolled: a hidden spare die
 * would sit in the message data every client receives.
 *
 * What hangs off the old margin is moved across: the Trip flag
 * (`flags.redsteel.tripTest`), the card's stored roll when the test is one of
 * its `rolls`, and answers already given to the old margin, which are marked
 * superseded (`rerolledAway`) so the contester answers the new one.
 */

import {
  marginPanelData,
  renderMarginFollowupLine,
  testCritBounds,
  versusNatural,
} from "./attributeFollowup.mjs";
import { getRerollTokensForSkill } from "./rerolls.mjs";
import {
  forfeitAdvantageOnCritFail,
  withRollBias,
} from "./rollAdvantage.mjs";

const SYSTEM_ID = "redsteel";

/** Message fields a panel can live in. */
const PANEL_FIELDS = ["flavor", "content"];

/** Panels being rerolled right now, so a double click spends one reroll. */
const busy = new Set();

/**
 * Hold a panel for the whole click (picker, payment, roll). False when it is
 * already held; release it with {@link releasePanel}.
 * @param {string} panelId
 */
export function holdPanel(panelId) {
  if (!panelId || busy.has(panelId)) return false;
  busy.add(panelId);
  return true;
}

/** @param {string} panelId */
export function releasePanel(panelId) {
  busy.delete(panelId);
}

/**
 * Locate a panel in a message's stored HTML (not the rendered copy, which
 * other hooks decorate).
 *
 * @param {ChatMessage} message
 * @param {string} panelId
 * @returns {{field: string, template: HTMLTemplateElement,
 *   span: HTMLElement, block: HTMLElement}|null}
 */
function findPanel(message, panelId) {
  for (const field of PANEL_FIELDS) {
    const html = message?.[field];
    if (typeof html !== "string" || !html.includes(panelId)) continue;
    const template = document.createElement("template");
    template.innerHTML = html;
    const span = template.content.querySelector(
      `.mos-followup[data-panel="${CSS.escape(panelId)}"]`,
    );
    const block = span?.closest(".rs-vs-test");
    if (span && block) return { field, template, span, block };
  }
  return null;
}

/** The test a panel posted, read back from its data attributes. */
function readPanel(span, block) {
  const d = span.dataset;
  const num = (v) => (v == null || v === "" ? null : Number(v));
  return {
    margin: Number(d.margin),
    source: d.source ?? "",
    chance: num(d.chance),
    onLose: d.onLose ?? null,
    against: d.against ?? null,
    mirror: d.mirror ?? null,
    skill: d.skill || null,
    bucket: d.bucket || null,
    itemBias: Number(d.itemBias) || 0,
    die: num(d.die),
    critFailure: num(d.critFailure),
    heading: block.querySelector(".rs-vs-test__heading")?.innerHTML ?? "",
  };
}

/**
 * Answers already rolled against this panel's margin and still standing.
 * Newer answers name the panel; older ones are matched by card, margin and
 * source.
 */
function panelAnswers(message, panelId, panel) {
  return (game.messages?.contents ?? []).filter((m) => {
    const flags = m.flags?.[SYSTEM_ID] ?? {};
    const f = flags.versusFollowup;
    if (!f || flags.rerolledAway) return false;
    if (f.panel) return f.panel === panelId;
    return (
      f.origin === message.id &&
      Number(f.margin) === panel.margin &&
      (f.source ?? "") === panel.source
    );
  });
}

/**
 * Everything the reroll picker needs about a panel, or null (with a warning)
 * when it cannot be rerolled.
 *
 * @param {ChatMessage} message
 * @param {string} panelId
 * @returns {{actor: Actor, panel: object, tokens: string[],
 *   critFailure: boolean, combatStrength: boolean,
 *   answers: ChatMessage[]}|null}
 */
export function panelRerollContext(message, panelId) {
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  const found = findPanel(message, panelId);
  if (!actor || !found) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Reroll.PanelMissing"));
    return null;
  }
  const panel = readPanel(found.span, found.block);
  if (!Number.isFinite(panel.chance)) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Reroll.PanelMissing"));
    return null;
  }
  const flags = message.flags?.[SYSTEM_ID] ?? {};
  const onAttackCard =
    message.flags?.attack?.type === "attack" ||
    (Array.isArray(flags.rerollTokens) && flags.rerollTokens.includes("attack"));
  return {
    actor,
    panel,
    tokens: getRerollTokensForSkill(actor, panel.skill),
    critFailure:
      Number.isFinite(panel.die) &&
      Number.isFinite(panel.critFailure) &&
      panel.die >= panel.critFailure,
    // Předvoj's Stamina reroll answers a combat Strength Test (vanguard.mjs).
    combatStrength: panel.skill === "str" && onAttackCard,
    answers: panelAnswers(message, panelId, panel),
  };
}

/**
 * Ask before rerolling a panel someone already answered. Their answer is
 * marked superseded and they roll again; what it already did stays done.
 *
 * @param {number} count
 * @returns {Promise<boolean>}
 */
export async function confirmSupersede(count) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("REDSTEEL.Reroll.PanelAnsweredTitle") },
    content: `<p>${game.i18n.format("REDSTEEL.Reroll.PanelAnsweredContent", { count })}</p>`,
    rejectClose: false,
  });
  return confirmed === true;
}

/**
 * The roll a card stored for this test, when the test is one of its `rolls`
 * (an ability whose only roll is its Test Type): same chance, total and die.
 */
function storedRollIndex(message, panel) {
  const lead = new RegExp(`^\\(?\\s*${panel.chance}\\s*\\)?\\s*-`);
  return (message.rolls ?? []).findIndex(
    (r) =>
      r.total === panel.margin &&
      (r.dice?.[0]?.total ?? null) === panel.die &&
      lead.test(String(r.formula ?? "")),
  );
}

/**
 * The panel whose test is the card's own first roll (an ability whose only
 * roll is its Test Type, Shield Bash style), or null. The card's Re-Roll on
 * such a card is that panel's reroll.
 * @param {ChatMessage} message
 * @returns {string|null}
 */
export function primaryPanelId(message) {
  if (!message?.rolls?.length) return null;
  for (const field of PANEL_FIELDS) {
    const html = message[field];
    if (typeof html !== "string" || !html.includes("data-panel")) continue;
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const span of template.content.querySelectorAll(".mos-followup[data-panel]")) {
      const block = span.closest(".rs-vs-test");
      if (!block) continue;
      if (storedRollIndex(message, readPanel(span, block)) === 0) {
        return span.dataset.panel;
      }
    }
  }
  return null;
}

/**
 * Roll the panel's test again and rewrite it in place. Called by the reroll
 * picker once a reroll has been paid for.
 *
 * @param {ChatMessage} message
 * @param {string} panelId
 * @param {string|null} sourceLabel  What paid for it (the pool's label).
 * @param {{onCritSuccess?: Function|null}} [options]  Combat Master's
 *   refund hook; returns a note when it gave the charge back.
 * @returns {Promise<boolean>} true when the panel was rewritten.
 */
export async function applyPanelReroll(
  message,
  panelId,
  sourceLabel,
  { onCritSuccess = null } = {},
) {
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  const found = findPanel(message, panelId);
  if (!actor || !found) return false;
  const panel = readPanel(found.span, found.block);

  // The same test as posted: its chance, the advantage bucket it was tagged
  // with and the item's own advantage. The actor-wide bias is read now.
  const roll = new Roll(`(${panel.chance}) - 1d100`, withRollBias({}, actor));
  roll.options ??= {};
  roll.options.redsteel = {
    ...(panel.bucket ? { skill: panel.bucket } : {}),
    ...(panel.itemBias ? { itemBias: panel.itemBias } : {}),
  };
  await roll.evaluate();
  const bounds = testCritBounds(actor, panel.skill);
  forfeitAdvantageOnCritFail(roll, bounds.failure);
  const natural = versusNatural(actor, panel.skill, roll);
  try {
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);
  } catch (err) {
    console.warn("Redsteel | Dice So Nice could not show the panel reroll", err);
  }

  let extra = "";
  if (
    onCritSuccess &&
    Number.isFinite(natural.die) &&
    natural.die <= natural.success
  ) {
    extra = (await onCritSuccess()) || "";
  }
  const escape = foundry.utils.escapeHTML;
  const note = [
    sourceLabel
      ? game.i18n.format("REDSTEEL.Reroll.PanelRerolled", {
          source: escape(sourceLabel),
          old: panel.margin,
        })
      : game.i18n.format("REDSTEEL.Reroll.PanelRerolledFree", {
          old: panel.margin,
        }),
    extra ? escape(extra) : "",
  ]
    .filter(Boolean)
    .join(" ");

  const html = renderMarginFollowupLine({
    margin: roll.total,
    source: panel.source,
    chance: panel.chance,
    result: roll.result,
    onLose: panel.onLose,
    against: panel.against,
    mirror: panel.mirror,
    heading: panel.heading,
    natural,
    panel: {
      ...marginPanelData(roll, panel.skill),
      id: panelId,
      bucket: panel.bucket,
      itemBias: panel.itemBias,
    },
    note,
  });
  const fresh = document.createElement("template");
  fresh.innerHTML = html.trim();
  found.block.replaceWith(...fresh.content.childNodes);

  const updates = { [found.field]: found.template.innerHTML };
  // The test is the card's stored roll too (an ability with only a Test
  // Type): keep `rolls` in step, or the dice and the digest read the old one.
  const index = storedRollIndex(message, panel);
  if (index >= 0) {
    updates.rolls = message.rolls.map((r, i) =>
      JSON.stringify(i === index ? roll : r),
    );
  }
  // Podseknutí's line, which the answer queue matches by margin
  // (forcedMovement.mjs resolveVersusAnswer).
  const trip = message.flags?.[SYSTEM_ID]?.tripTest;
  if (
    trip &&
    Number(trip.margin) === panel.margin &&
    (trip.source ?? "") === panel.source
  ) {
    updates[`flags.${SYSTEM_ID}.tripTest.margin`] = roll.total;
  }

  // Answers to the old margin no longer stand: their contester rolls again.
  const answers = panelAnswers(message, panelId, panel);
  if (answers.length && message.flags?.[SYSTEM_ID]?.tripResolved) {
    updates[`flags.${SYSTEM_ID}.tripResolved`] = false;
  }
  await message.update(updates);

  let unreachable = 0;
  for (const answer of answers) {
    if (!answer.canUserModify(game.user, "update")) {
      unreachable += 1;
      continue;
    }
    await answer.setFlag(SYSTEM_ID, "rerolledAway", message.id);
  }
  if (unreachable) {
    ui.notifications.warn(
      game.i18n.format("REDSTEEL.Reroll.PanelAnswersUnreachable", {
        count: unreachable,
      }),
    );
  }
  return true;
}
