/**
 * Escape (Vyprostit se): a Rooted or Shadowbound creature repeats the versus
 * Test against the card that bound it, from the hotbar instead of chat.
 *
 * Rooted (Impale, Roots, Mass roots) and Shadowbound (Chains) are answered at
 * the table by clicking the binding card's "Margin of Success" line
 * (attributeFollowup.mjs). By the bound creature's next turn that card is
 * usually far up the chat log, so Apply Damage / Apply Effects stamps the
 * applied effect with the id of the card it came from
 * (`flags.redsteel.escapeSourceMessageId`), and the hotbar's Escape chip opens
 * the versus Test for the bound actor. It costs 1 Action, paid only once
 * the roll is actually posted.
 *
 * Every attempt is a fresh contest (user ruling): the binder's side is
 * re-rolled from the chance posted on its card, in the same formula as the
 * bound creature's die, so a chat Re-Roll repeats both sides. A win deletes
 * the effect (settleBreakFree in attributeFollowup.mjs). A card that posted
 * no chance (older inline lines) falls back to beating its old margin.
 */

import {
  promptAttributeFollowup,
  parseAttributeKeys,
  versusAgainstForName,
} from "./attributeFollowup.mjs";
import { spend } from "./actionTracker.mjs";

/** Effect ids a bound creature may try to break free of. */
export const ESCAPABLE_EFFECTS = ["root", "shadowbound"];

const SYSTEM_ID = "redsteel";
const FLAG = "escapeSourceMessageId";

/**
 * Remember which card put an escapable effect on. A re-applied (refreshed)
 * effect is overwritten with the newer card on purpose: that is the roll the
 * creature now has to beat.
 *
 * @param {ActiveEffect|null|undefined} applied  The effect just applied.
 * @param {string} effectId                      Its definition id.
 * @param {ChatMessage|null|undefined} message   The card it came from.
 */
export async function stampEscapeSource(applied, effectId, message) {
  if (!applied || !ESCAPABLE_EFFECTS.includes(effectId) || !message?.id) return;
  await applied.setFlag(SYSTEM_ID, FLAG, message.id);
}

/**
 * The card that currently stands for this one. A reroll replaces a card and
 * marks the old one `rerolledAway` (the replacement's id, or `true`); follow
 * that chain to its end and return the last message that still exists.
 *
 * @param {ChatMessage|null} message
 * @returns {ChatMessage|null}
 */
export function liveMessage(message) {
  let current = message ?? null;
  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const next = current.flags?.redsteel?.rerolledAway;
    if (typeof next !== "string") break;
    const replacement = game.messages.get(next);
    if (!replacement) break;
    current = replacement;
  }
  return current;
}

/**
 * The clickable margin line on a card: the last `.mos-followup` in its flavor
 * and content.
 *
 * @param {ChatMessage|null} message
 * @returns {{margin: number, chance: number|null, source: string, onLose: string|null, against: string[]}|null}
 */
export function readMarginLine(message) {
  if (!message) return null;
  const holder = document.createElement("div");
  holder.innerHTML = `${message.flavor ?? ""}${message.content ?? ""}`;
  const lines = holder.querySelectorAll(".mos-followup");
  const el = lines[lines.length - 1];
  if (!el) return null;
  const margin = Number(el.dataset.margin);
  if (Number.isNaN(margin)) return null;
  // The binder's chance: data-chance, or the tooltip of lines posted before it.
  let chance = Number(el.dataset.chance);
  if (el.dataset.chance == null || Number.isNaN(chance)) {
    const found = /Test chance (-?\d+)%/.exec(el.dataset.tooltip ?? "");
    chance = found ? Number(found[1]) : null;
  }
  return {
    margin,
    chance,
    source: el.dataset.source ?? "",
    onLose: el.dataset.onLose ?? null,
    // Attributes the test lets the bound creature answer with (empty = any).
    against: parseAttributeKeys(
      el.dataset.against || versusAgainstForName(el.dataset.source),
    ),
  };
}

/**
 * Every escapable effect on the actor that knows the card it came from, with
 * that card's live stand-in and the margin to beat. Effects whose card was
 * deleted or carries no margin line are left out.
 *
 * @param {Actor} actor
 * @returns {{effect: ActiveEffect, message: ChatMessage, line: object}[]}
 */
export function escapeTargets(actor) {
  const entries = [];
  for (const effect of actor?.effects?.contents ?? []) {
    const statuses = effect.statuses ?? new Set();
    if (!ESCAPABLE_EFFECTS.some((id) => statuses.has(id))) continue;
    const messageId = effect.getFlag?.(SYSTEM_ID, FLAG);
    if (!messageId) continue;
    const original = game.messages.get(messageId);
    if (!original) continue;
    const live = liveMessage(original);
    // A reroll card may not repeat the margin line; the original still has it.
    const line = readMarginLine(live) ?? readMarginLine(original);
    if (!line) continue;
    entries.push({ effect, message: live, line });
  }
  return entries;
}

/**
 * Open the versus Test against the card that bound the actor with this effect,
 * paying 1 Action once the roll is posted.
 *
 * @param {Actor} actor
 * @param {string} effectId  The ActiveEffect document id.
 */
export async function rollEscape(actor, effectId) {
  if (!actor) return;
  const entry = escapeTargets(actor).find((e) => e.effect.id === effectId);
  if (!entry) {
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.Bg3Hotbar.Suggest.EscapeSourceGone"),
    );
    return;
  }
  const { line } = entry;
  promptAttributeFollowup(line.margin, line.source, {
    onLose: line.onLose,
    against: line.against,
    actor,
    onRolled: () => spend(actor, { actions: 1 }),
    contest:
      line.chance != null
        ? { chance: line.chance, effectUuid: entry.effect.uuid }
        : null,
  });
}
