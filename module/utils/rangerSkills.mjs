/**
 * Hraničář (Ranger) and Grimm skill-test nodes, rolled from the sheet
 * (sheets/actor-sheet.mjs _onRoll).
 *
 * - Vnímání a Stopování +15% (ranger vnimaniStopovani, specializace-wip.md
 *   r297) and Metla: Vnímání a Stopování +10% (grimm metlaVnimani, r1140).
 *   User ruling 2026-10-22: always on a raw Perception attribute test; on
 *   Survival only when the test is rolled as Tracking, a third choice the
 *   Survival prompt offers to a holder of either node. Grimm's +10 counts
 *   only when exactly one token is targeted and it is one of the roller's
 *   Banes (grimm.mjs isBaneFoe). The bonuses are baked into the formula
 *   before it is evaluated, so the margin, the versus line and every reroll
 *   carry them; each is named on the card.
 * - Pohyb v přírodě: Plížení +15% (ranger pohybVPrirode, r297). User ruling:
 *   "make it a pill". A Stealth card by a holder carries
 *   `flags.redsteel.situational`, a list of toggles that start off. The
 *   roller or the GM clicks the pill to switch it; the render hook below
 *   draws the margin with the active toggles added and says whether that
 *   succeeds. The roll itself is never changed: its total stays the base
 *   margin, and a Critical Success or Failure stays what the die rolled. A
 *   reroll carries the toggles across (redsteel.mjs REROLL_CARRIED_FLAGS).
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { isBaneFoe } from "./grimm.mjs";

const SYSTEM_ID = "redsteel";
/** "Vnímání a Stopování +15%" */
const RANGER_TRACKING_BONUS = 15;
/** "Metla: Vnímání a Stopování +10%" */
const GRIMM_TRACKING_BONUS = 10;
/** "Pohyb v přírodě: Plížení +15%" */
const IN_NATURE_BONUS = 15;
/** The card flag holding the toggles. */
export const SITUATIONAL_FLAG = "situational";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

function nodeLine(spec, node) {
  const specLabel = game.i18n.localize(`REDSTEEL.Actor.Specialisations.${spec}.label`);
  const nodeLabel = game.i18n.localize(
    `REDSTEEL.Actor.Specialisations.${spec}.nodes.${node}.label`,
  );
  return `${specLabel}: ${nodeLabel}`;
}

/** May this actor roll Survival as Tracking (either node)? */
export function canTrack(actor) {
  return (
    actorHasSpecNode(actor, "ranger", "vnimaniStopovani") ||
    actorHasSpecNode(actor, "grimm", "metlaVnimani")
  );
}

/** The one targeted token's actor, or null with none or several targeted. */
function soleTargetActor() {
  const targets = [...(game.user?.targets ?? [])];
  return targets.length === 1 ? (targets[0].actor ?? null) : null;
}

/**
 * The Perception and Tracking bonuses a sheet test gets.
 *
 * @param {Actor} actor
 * @param {{rollType: string, key: string, tracking?: boolean}} test
 * @returns {Array<{label: string, value: number}>}
 */
export function perceptionTrackingBonuses(actor, { rollType, key, tracking = false }) {
  const perception = rollType === "attribute" && key === "per";
  const track = rollType === "skill" && key === "survival" && tracking;
  if (!perception && !track) return [];
  const out = [];
  if (actorHasSpecNode(actor, "ranger", "vnimaniStopovani")) {
    out.push({ label: nodeLine("ranger", "vnimaniStopovani"), value: RANGER_TRACKING_BONUS });
  }
  if (actorHasSpecNode(actor, "grimm", "metlaVnimani")) {
    const target = soleTargetActor();
    if (target && isBaneFoe(actor, target)) {
      out.push({ label: nodeLine("grimm", "metlaVnimani"), value: GRIMM_TRACKING_BONUS });
    }
  }
  return out;
}

/**
 * The card lines naming each baked-in bonus. The node labels already carry
 * the number ("Perception and Tracking +15%"), so it is not repeated.
 */
export function bonusLinesHtml(bonuses) {
  return bonuses
    .map(
      (b) =>
        `<p style="text-align:center; font-size:12px; opacity:0.85;">${esc(b.label)}</p>`,
    )
    .join("");
}

/**
 * The situational toggles a sheet test's card carries, or null.
 *
 * @param {Actor} actor
 * @param {{rollType: string, key: string}} test
 * @returns {Array<{id: string, label: string, hint: string, value: number,
 *   active: boolean}>|null}
 */
export function situationalToggles(actor, { rollType, key }) {
  if (rollType !== "skill" || key !== "stealth") return null;
  if (!actorHasSpecNode(actor, "ranger", "pohybVPrirode")) return null;
  return [
    {
      id: "inNature",
      label: "REDSTEEL.Situational.InNature",
      hint: "REDSTEEL.Situational.InNatureHint",
      value: IN_NATURE_BONUS,
      active: false,
    },
  ];
}

/**
 * Draw the toggles on a card that carries them, and the margin they make.
 * Registered once from redsteel.mjs.
 */
export function registerSituationalPills() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const list = message.getFlag(SYSTEM_ID, SITUATIONAL_FLAG);
    if (!Array.isArray(list) || !list.length) return;
    const roll = message.rolls?.[0];
    if (!roll) return;

    const canToggle = game.user.isGM || message.isAuthor;
    const pills = list.map((entry, index) => {
      const pill = document.createElement("span");
      pill.classList.add("trait-pill", "rs-situational-pill");
      pill.classList.toggle("is-active", !!entry.active);
      pill.textContent = game.i18n.format(entry.label, { value: entry.value });
      pill.dataset.tooltip = game.i18n.localize(entry.hint ?? "");
      if (canToggle) {
        pill.classList.add("is-toggle");
        pill.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const next = list.map((e, i) =>
            i === index ? { ...e, active: !e.active } : { ...e },
          );
          await message.update({ [`flags.${SYSTEM_ID}.${SITUATIONAL_FLAG}`]: next });
        });
      }
      return pill;
    });

    let container = html.querySelector(".trait-pills");
    if (!container) {
      container = document.createElement("div");
      container.classList.add("trait-pills");
      const flavor = html.querySelector(".flavor-text");
      const header = flavor?.firstElementChild;
      if (header) header.after(container);
      else if (flavor) flavor.prepend(container);
      else html.querySelector(".dice-roll")?.prepend(container);
    }
    for (const pill of pills) container.appendChild(pill);

    // The active toggles' margin. The roll's own total is the base margin;
    // the die (and so any Critical) is untouched.
    const active = list.filter((e) => e.active);
    if (!active.length) return;
    const base = Number(roll.total) || 0;
    const adjusted = base + active.reduce((sum, e) => sum + (Number(e.value) || 0), 0);
    const totalEl = html.querySelector(".dice-total");
    if (totalEl) {
      totalEl.textContent = String(adjusted);
      totalEl.classList.add("rs-situational-total");
    }
    const note = document.createElement("p");
    note.classList.add("rs-situational-note");
    note.textContent = game.i18n.format("REDSTEEL.Situational.Adjusted", {
      base,
      adjusted,
      result: game.i18n.localize(
        adjusted >= 0 ? "REDSTEEL.Situational.Success" : "REDSTEEL.Situational.Failure",
      ),
    });
    container.after(note);
  });
}
