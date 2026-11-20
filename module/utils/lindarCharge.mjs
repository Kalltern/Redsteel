/**
 * Lindar's Charge (veneficus specialisation node `lindaruvVypad1`).
 *
 * The perk names nine movement / pull spells. While the node is unlocked they
 * cost 6 Mana less to cast and roll Channeling at +10%.
 *
 * The nine spells as the rules name them (Czech book terms, mapped to the
 * English item names the system stores):
 *   Přitáhnutí            → "Pull"
 *   Rychlé přitáhnutí     → "Quick pull"
 *   Přemístění            → "Relocation"
 *   Teleportace           → "Teleportation"
 *   Temné přitáhnutí      → "Dark pull"
 *   Stínokrok             → "Shadowstep"
 *   Posunutí              → "Shift"
 *   Výměna                → "Swap"
 *   Prostorový skok       → "Spatial leap"
 *
 * "Relocation" deliberately matches BOTH pack items carrying that name (the Air
 * expert spell and the Spirit expert spell) — confirmed correct by the GM.
 *
 * Shift / Swap / Spatial leap are Gnosis-school spells that do not exist in the
 * packs yet. They are pre-registered here so the perk starts working the moment
 * those items are created under those exact English names.
 *
 * Keyed on the item's raw (English) name so this resolves on spell copies that
 * are already owned by live actors, without needing a re-import to pick up a
 * flag. A `flags.redsteel.lindarCharge` override wins when present.
 *
 * Lives in its own module because both the cast pipeline (castSpell.mjs) and
 * the spell bonus pipeline (magicSkillBonuses.mjs) already import from each
 * other, the same reason strikes.mjs stands alone.
 */
import { nextSpellManaDiscount } from "./nextSpellBonus.mjs";
import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { matchesPackSpell } from "../helpers/mancerSpells.mjs";

/** The pack spell Telepathic link (Telepatické pouto), for Telepat II. */
const TELEPATHIC_LINK = { id: "Ee95pq1nkqjsvM3Y", name: "Telepathic link" };

export const LINDAR_CHARGE_SPELLS = new Set([
  "Pull",
  "Quick pull",
  "Relocation",
  "Teleportation",
  "Dark pull",
  "Shadowstep",
  // Not yet authored in the packs (Gnosis school) — pre-registered by name.
  "Shift",
  "Swap",
  "Spatial leap",
]);

/** Flat Mana taken off the cast cost of a named spell. */
export const LINDAR_CHARGE_MANA_DISCOUNT = 6;

/** Flat bonus added to the Channeling test of a named spell. */
export const LINDAR_CHARGE_CHANNELING_BONUS = 10;

/**
 * @param {Actor} actor
 * @returns {boolean} true when the actor has unlocked the node.
 */
export function hasLindarCharge(actor) {
  return (
    actor?.system?.specialisations?.veneficus?.nodes?.lindaruvVypad1 === true
  );
}

/**
 * @param {Item} spell
 * @returns {boolean} true when this spell is one of the nine the perk names.
 */
export function isLindarChargeSpell(spell) {
  const flag = spell?.getFlag?.("redsteel", "lindarCharge");
  if (flag) return true;
  return LINDAR_CHARGE_SPELLS.has(String(spell?.name ?? "").trim());
}

/**
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {number} the Channeling test bonus this perk grants, or 0.
 */
export function getLindarChannelingBonus(actor, spell) {
  if (hasLindarCharge(actor) && isLindarChargeSpell(spell)) {
    return LINDAR_CHARGE_CHANNELING_BONUS;
  }
  return 0;
}

/**
 * A spell's cast cost for this actor before anything the NEXT spell is owed:
 * its own cost less Lindar's Charge where that applies. Incantator's Precise
 * Incantation pays this again ("zaplatit cenu kouzla", utils/incantator.mjs).
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {number}
 */
export function getBaseSpellManaCost(actor, spell) {
  const baseCost = Number(spell?.system?.cost) || 0;
  // Mentalist → Telepat II (telepat2, book r1404): "Kouzlo Telepatické pouto
  // je o polovinu levnější a lze ho seslat na více cílů zároveň (cena za každý
  // cíl)." Half the cost, rounded up, once per token the casting user targets
  // (at least one). The cost shown (the cast dialog row, the tooltip) and the
  // cost spent (deductMana) agree because all three Mana sites read this
  // function through getLindarSpellCost. What the extra targets get is
  // narrative; only the price is counted here.
  if (
    actorHasSpecNode(actor, "mentalist", "telepat2") &&
    matchesPackSpell(spell, TELEPATHIC_LINK)
  ) {
    const targets = Math.max(1, Number(game.user?.targets?.size) || 0);
    return Math.ceil(baseCost / 2) * targets;
  }
  const lindarCut =
    spell?.system?.type !== "blood" &&
    hasLindarCharge(actor) &&
    isLindarChargeSpell(spell)
      ? LINDAR_CHARGE_MANA_DISCOUNT
      : 0;
  return Math.max(0, baseCost - lindarCut);
}

/**
 * Effective Mana cost of a spell for this actor.
 *
 * The discount applies to the CAST cost only ("sleva 6 many na seslání") and
 * never to `system.perRound` channeling upkeep. Blood-school spells are
 * excluded because they pay from the blood pool rather than Mana — none of the
 * nine is a Blood spell, and the guard keeps it that way if one is ever
 * reskinned.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {number} the cost to charge, floored at 0.
 */
export function getLindarSpellCost(actor, spell) {
  const cost = getBaseSpellManaCost(actor, spell);
  // Veneficus → "Zabije-li cíl Soubojem, sleva 2 many na příští kouzlo" and
  // Elymas → Magická ozvěna's 50% (nextSpellBonus.mjs), taken off what Lindar
  // left. Read here because this is the one cost every Mana site reads
  // (dialog row, tooltip, deductMana).
  const owed = nextSpellManaDiscount(actor, spell, cost);
  return Math.max(0, cost - owed);
}
