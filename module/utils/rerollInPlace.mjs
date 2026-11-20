/**
 * A chat Re-Roll that rewrites its own card instead of posting a new one.
 *
 * executeReroll (redsteel.mjs) works out everything a reroll changes: the new
 * roll, its critical headline, the versus and defense verdicts, the attack
 * packet. A card that opts in with `flags.redsteel.inPlaceReroll` then has
 * those written back into the same message here, so its description, panels,
 * damage and buttons stay, and every link to the card (defense claims, versus
 * answers, prompts) keeps pointing at a live id. Card types are converted one
 * by one; a card without the flag still gets the old replacement card.
 *
 * What a card marks as read off the die:
 * - elements with the class `rs-roll-dep` (the sheet card's critical line);
 * - its own Margin of Success panel (an `.rs-vs-test` whose margin line has
 *   no `data-panel`; panels with one belong to a test of their own and
 *   reroll by themselves, marginReroll.mjs);
 * - the previous reroll's `.rs-reroll-live` block.
 * Those are removed and the reroll's fresh output is appended as one
 * `.rs-reroll-live` block, closed by the reroll history.
 *
 * Every client sees the change as an update carrying `rerollHistory`; code
 * that used to react to the replacement card listens for that
 * ({@link isInPlaceRerollUpdate}).
 */

const SYSTEM_ID = "redsteel";

/** The block holding a reroll's verdicts and its history line. */
export const LIVE_CLASS = "rs-reroll-live";

/** How long after a reroll its card flashes, in ms. */
const FLASH_MS = 4000;

/** Whether this card rerolls in place. */
export function rerollsInPlace(message) {
  return message?.flags?.[SYSTEM_ID]?.inPlaceReroll === true;
}

/**
 * Whether an updateChatMessage `changed` diff is an in-place reroll (every
 * client gets it, unlike a hook called on the rerolling client).
 * @param {object} changed
 */
export function isInPlaceRerollUpdate(changed) {
  const diff = changed ?? {};
  return (
    foundry.utils.hasProperty(diff, `flags.${SYSTEM_ID}.rerollHistory`) ||
    // A defense re-judged against its attack's reroll (redsteel.mjs
    // rejudgeDefensesFor): its verdict changed the same way.
    foundry.utils.hasProperty(diff, `flags.${SYSTEM_ID}.rejudgedAt`)
  );
}

/**
 * Versus answers rolled against this card's own margin (not one of its
 * panels) and still standing. A reroll in place moves that margin, so they
 * no longer answer anything.
 * @param {ChatMessage} message
 * @returns {ChatMessage[]}
 */
export function cardMarginAnswers(message) {
  const margin = message?.rolls?.[0]?.total;
  if (!Number.isFinite(margin)) return [];
  return (game.messages?.contents ?? []).filter((m) => {
    const flags = m.flags?.[SYSTEM_ID] ?? {};
    const f = flags.versusFollowup;
    return (
      f &&
      !flags.rerolledAway &&
      !f.panel &&
      f.origin === message.id &&
      Number(f.margin) === margin
    );
  });
}

/**
 * The history line: one sentence per reroll, oldest first. "Rerolled with
 * Muscular II (was −36)." A free reroll names no source.
 * @param {{total: number|null, source: string|null}[]} history
 * @param {string} [kept]  Combat Master's "keeps the reroll" note.
 */
export function renderHistory(history, kept = "") {
  if (!history?.length && !kept) return "";
  const escape = foundry.utils.escapeHTML;
  const lines = history.map((entry) =>
    entry.source
      ? game.i18n.format("REDSTEEL.Reroll.PanelRerolled", {
          source: escape(entry.source),
          old: entry.total ?? "?",
        })
      : game.i18n.format("REDSTEEL.Reroll.PanelRerolledFree", {
          old: entry.total ?? "?",
        }),
  );
  if (kept) lines.push(escape(kept));
  return `<p class="rs-reroll-history"><i class="fa-light fa-rotate"></i> ${lines.join(" ")}</p>`;
}

/**
 * A card's flavor with what the die decided taken out and `liveHtml` put in
 * as one `.rs-reroll-live` block, where the first of those parts stood (so a
 * critical banner under the title is replaced under the title); appended at
 * the end when the card had none.
 *
 * @param {string} flavor
 * @param {string} liveHtml
 * @returns {string}
 */
export function replaceRollRegions(flavor, liveHtml) {
  const template = document.createElement("template");
  template.innerHTML = flavor ?? "";
  const root = template.content;
  const cardPanels = [...root.querySelectorAll(".rs-vs-test")].filter((block) => {
    const line = block.querySelector(".mos-followup");
    return line && !line.dataset.panel;
  });
  const parts = [
    ...root.querySelectorAll(`.${LIVE_CLASS}, .rs-roll-dep`),
    ...cardPanels,
  ];
  // Document order, so the anchor is the earliest part on the card.
  parts.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  const fresh = document.createElement("template");
  fresh.innerHTML = `<div class="${LIVE_CLASS}">${liveHtml}</div>`;
  const block = fresh.content.firstElementChild;
  if (parts.length) parts[0].before(block);
  else root.append(block);
  for (const part of parts) part.remove();
  return template.innerHTML;
}

/**
 * Write a reroll back into its own card.
 *
 * @param {ChatMessage} message  The card being rerolled.
 * @param {Roll} roll  The new, evaluated roll; it replaces `rolls[0]`.
 * @param {object} parts
 * @param {string|null} parts.sourceLabel  What paid for it, or null (free).
 * @param {string} [parts.kept]  Combat Master's refund note.
 * @param {string} [parts.live]  The reroll's verdict HTML (critical headline,
 *   versus outcome, defense verdict, the card's own margin panel, notes).
 * @param {object} [parts.flags]  `flags.redsteel` keys to set.
 * @param {object|null} [parts.attackFlag]  The rebuilt `flags.attack`.
 * @param {number|null} [parts.magicAttack]  A spell card's new Magic ATK,
 *   written into its tag.
 * @returns {Promise<ChatMessage>} The same message.
 */
export async function writeRerollInPlace(
  message,
  roll,
  {
    sourceLabel = null,
    kept = "",
    live = "",
    flags = {},
    attackFlag = null,
    magicAttack = null,
  } = {},
) {
  const previous = message.rolls?.[0] ?? null;
  // Read before the update moves the margin.
  const answers = cardMarginAnswers(message);
  const history = [
    ...(message.getFlag(SYSTEM_ID, "rerollHistory") ?? []),
    {
      total: previous?.total ?? null,
      die: previous?.dice?.[0]?.total ?? null,
      // An attack's critical as it stood, so the card can say when the
      // reroll moved it away from what its damage line was rolled for.
      crit: message.flags?.attack ? !!message.flags.attack.criticalSuccess : null,
      source: sourceLabel ?? null,
      at: Date.now(),
    },
  ];

  // The damage line was rolled once, for the first roll's critical result.
  const firstCrit = history[0].crit;
  const critNote =
    attackFlag && firstCrit !== null && firstCrit !== !!attackFlag.criticalSuccess
      ? `<p class="rs-reroll-history">${game.i18n.localize("REDSTEEL.Reroll.CritChanged")}</p>`
      : "";

  let flavor = replaceRollRegions(
    message.flavor,
    `${live}${critNote}${renderHistory(history, kept)}`,
  );
  // A spell card prints its Magic ATK in the tag row, a number off the die.
  if (Number.isFinite(magicAttack) && flavor.includes("magicAttack")) {
    const template = document.createElement("template");
    template.innerHTML = flavor;
    const tag = template.content.querySelector(".action-tag.magicAttack");
    if (tag) {
      tag.textContent = `Magic ATK ${magicAttack} `;
      flavor = template.innerHTML;
    }
  }

  const update = {
    flavor,
    rolls: (message.rolls ?? []).map((r, i) =>
      JSON.stringify(i === 0 ? roll : r),
    ),
    [`flags.${SYSTEM_ID}.rerollHistory`]: history,
  };
  // A card that prints its own roll box (an attack card's Margin of Success
  // column, marked `rs-roll-html`) has it drawn again for the new roll.
  if (String(message.content ?? "").includes("rs-roll-html")) {
    const content = document.createElement("template");
    content.innerHTML = message.content;
    const box = content.content.querySelector(".rs-roll-html");
    if (box) {
      box.innerHTML = await roll.render();
      update.content = content.innerHTML;
    }
  }

  // Show the dice before the number changes, as a new card would.
  try {
    if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);
  } catch (err) {
    console.warn("Redsteel | Dice So Nice could not show the reroll", err);
  }
  if (!message.rolls?.length) update.rolls = [JSON.stringify(roll)];
  for (const [key, value] of Object.entries(flags)) {
    update[`flags.${SYSTEM_ID}.${key}`] = value;
  }
  if (attackFlag) update["flags.attack"] = attackFlag;
  await message.update(update);

  // Answers to the old margin are superseded: their contester rolls again.
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
  return message;
}

/**
 * Flash a card that was just rerolled in place, on every client. Called from
 * the renderChatMessageHTML hook.
 * @param {ChatMessage} message
 * @param {HTMLElement} html
 */
export function flashRecentReroll(message, html) {
  const history = message?.flags?.[SYSTEM_ID]?.rerollHistory;
  const last = Array.isArray(history) ? history.at(-1) : null;
  if (!last?.at || Date.now() - last.at > FLASH_MS) return;
  html.classList.add("rs-reroll-flash");
}
