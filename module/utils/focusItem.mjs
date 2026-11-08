/**
 * Ohniskové předměty (focus items), docs/rules-source/rules/ruzne-info.md
 * r969: "předměty skrze které může čaroděj bezpečněji usměrňovat magii."
 *
 * A focus is any gear, weapon or plain item whose sheet has "Focus item"
 * ticked (`system.focus`, template.json). Calibration (the Arcana Test and
 * two rounds) is a table matter, and so is sacrificing one to escape a
 * Critical Failure: this module only answers "is a focus in use right now".
 *
 * Read by utils/incantator.mjs (the Incantator penalty without a focus, and
 * the ohniskovyPredmet Critical Range). Imports nothing but the node read, so
 * the cast pipeline can import it freely.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";

/**
 * Ids of the weapons in the actor's active weapon set (main and off hand).
 * Characters hold weapons through their sets rather than `system.equipped`.
 *
 * @param {Actor} actor
 * @returns {Set<string>}
 */
function activeSetWeaponIds(actor) {
  const combat = actor?.system?.combat;
  const slots = combat?.weaponSets?.[combat?.activeWeaponSet] ?? {};
  return new Set([slots.main, slots.off].filter(Boolean));
}

/**
 * Does this actor have a focus item in use?
 *
 * - gear with `system.focus`, equipped;
 * - a weapon with `system.focus`, equipped or in the active weapon set (a
 *   staff in hand);
 * - a plain item with `system.focus` that is carried (quantity above 0 when
 *   the item counts one);
 * - with Incantator's Moudrá kniha (moudraKniha), any grimoire the actor owns
 *   ("Může používat Grimoár jako Ohniskový předmět").
 *
 * Two foci at once (Moudrá kniha) change nothing further mechanically.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasFocusItem(actor) {
  const items = actor?.items?.contents ?? [];
  if (!items.length) return false;
  const inHand = activeSetWeaponIds(actor);
  for (const item of items) {
    const sys = item.system ?? {};
    if (sys.focus !== true) continue;
    if (item.type === "gear" && sys.equipped) return true;
    if (item.type === "weapon" && (sys.equipped || inHand.has(item.id))) {
      return true;
    }
    if (item.type === "item") {
      const quantity = sys.quantity;
      if (quantity == null || Number(quantity) > 0) return true;
    }
  }
  if (actorHasSpecNode(actor, "incantator", "moudraKniha")) {
    return items.some((i) => i.type === "spellbook");
  }
  return false;
}
