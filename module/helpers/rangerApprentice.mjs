/**
 * Hraničář (Ranger) → Hraničář - Učedník (ucednik), specializace-wip.md r306.
 *
 * "Odemyká dovednost Hraničář, která se pro účely požadavků dovedností a
 * odborností počítá coby Souboj a Střelba. Znemožňuje získávat stupně
 * dovedností Souboj a Střelba a vyruší všechny stávající stupně Souboje a
 * Střelby. Pokud má dvě Doktríny, nižší Doktrína získává slevu 3 CP na každý
 * stupeň."
 *
 * User rulings 2026-10-22:
 * - Unlocking the node sets Combat and Archery to 0 and posts a chat line
 *   naming what was cleared. The CP comes back on its own: the wallet derives
 *   what was spent from the ranks held (progressionEngine.mjs
 *   computeSpentOnRanks). Locking the node again restores nothing. Called
 *   from specialisations.mjs syncSpecialisationPassive, the one path the
 *   Learn window purchase and the sheet's toggle share.
 * - While the node is unlocked, Combat and Archery ranks cannot be bought
 *   (progressionEngine.mjs getRankState), and a rank requirement on either
 *   reads the better of the track's own rank and the Ranger rank
 *   (requirementRank, used by evaluateRequirement's "rank" clause, which the
 *   rank, feature and specialisation price tables all go through).
 * - Doctrine discount: with two or more doctrines at rank I or more, the one
 *   with the lowest rank gets 3 CP off each of its CP ranks; a tie goes to
 *   the first in template.json order (the order of system.doctrines). It is
 *   derived like every other discount, so it moves when ranks change and is
 *   retroactive (progressionEngine.mjs getDiscountSources). A track that
 *   already carries a discount keeps only the larger one (getSkillDiscounts).
 */

import { actorHasSpecNode } from "./specialisations.mjs";

const SPEC = "ranger";
const NODE = "ucednik";
/** The tracks the Ranger skill replaces. */
const REPLACED = Object.freeze({
  "combatSkills.combat": "combat",
  "combatSkills.archery": "archery",
});
/** "slevu 3 CP na každý stupeň" */
const DOCTRINE_DISCOUNT_CP = 3;
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Has the actor unlocked Ranger - Apprentice? */
export function hasRangerApprentice(actor) {
  return actor?.type === "character" && actorHasSpecNode(actor, SPEC, NODE);
}

/** Is this track ("combatSkills.combat") closed to purchase by the Ranger? */
export function isReplacedByRanger(actor, trackId) {
  return trackId in REPLACED && hasRangerApprentice(actor);
}

/**
 * The rank a requirement clause reads for a track: the track's own value,
 * except that with the node unlocked Combat and Archery read at least the
 * Ranger rank ("se pro účely požadavků … počítá coby Souboj a Střelba").
 *
 * @param {Actor} actor
 * @param {string} group
 * @param {string} key
 * @returns {number}
 */
export function requirementRank(actor, group, key) {
  const own = Number(actor?.system?.[group]?.[key]?.value ?? 0);
  if (!(`${group}.${key}` in REPLACED) || !hasRangerApprentice(actor)) return own;
  const ranger = Number(actor.system?.combatSkills?.ranger?.value ?? 0);
  return Math.max(own, ranger);
}

/**
 * The doctrine the Apprentice discount lands on right now, or null: with two
 * or more doctrines at rank I or more, the lowest of them, a tie going to the
 * first in key order.
 *
 * @param {Actor} actor
 * @returns {{key: string, amount: number, currency: "cp"}|null}
 */
export function rangerDoctrineDiscount(actor) {
  if (!hasRangerApprentice(actor)) return null;
  const held = Object.entries(actor.system?.doctrines ?? {})
    .map(([key, entry]) => ({ key, value: Number(entry?.value ?? 0) }))
    .filter((d) => d.value >= 1);
  if (held.length < 2) return null;
  let lowest = held[0];
  for (const d of held) if (d.value < lowest.value) lowest = d;
  return { key: lowest.key, amount: DOCTRINE_DISCOUNT_CP, currency: "cp" };
}

/**
 * The node was just unlocked: clear Combat and Archery, with the ledger's
 * starting figures written down in the same update (Party Management rule),
 * and post one chat line naming what was cleared. Does nothing when both are
 * already 0, so it is safe to call again.
 *
 * @param {Actor} actor
 */
export async function clearRangerReplacedRanks(actor) {
  if (!hasRangerApprentice(actor) || !actor.isOwner) return;
  const cleared = [];
  const update = {};
  for (const [trackId, key] of Object.entries(REPLACED)) {
    const value = Number(actor.system?.combatSkills?.[key]?.value ?? 0);
    if (value <= 0) continue;
    update[`system.${trackId}.value`] = 0;
    const label = game.i18n.localize(
      `REDSTEEL.Actor.Character.combatSkills.${key}.label`,
    );
    cleared.push(`${label} ${ROMAN[value] ?? value}`);
  }
  if (!cleared.length) return;

  // Loaded here rather than at the top: progressionEngine.mjs imports this
  // file (and specialisations.mjs), so a static import would close a cycle.
  const { getLedgerMaterializeUpdate } = await import("./progressionEngine.mjs");
  await actor.update({ ...getLedgerMaterializeUpdate(actor), ...update });

  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const title = game.i18n.localize(
    `REDSTEEL.Actor.Specialisations.${SPEC}.nodes.${NODE}.label`,
  );
  const line = game.i18n.format("REDSTEEL.RangerApprentice.Cleared", {
    name: esc(actor.name),
    ranks: esc(cleared.join(", ")),
  });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
<p style="text-align:center;">${line}</p>`,
  });
}
