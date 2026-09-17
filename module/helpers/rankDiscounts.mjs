/**
 * Rank discounts: the features and specialisation perks that make every rank of
 * one skill cheaper ("Sleva 3 SP za stupeň …").
 *
 * Source: "Pravidla pro ToS V12.1 (WIP)" → "Odbornosti" (Specializace:
 * *Dovednost*, Učenec I/II) and "Specializace (WIP)" (the perks). The skills a
 * "one skill from a list" perk may pick are written only in the comment on that
 * perk's cell in the workbook; they are copied here.
 *
 * Rules (the comment on every discount cell, and the GM's ruling 2026-09-11):
 *   - Discounts on one skill do not stack ("Slevy na dovednost z odborností a
 *     specializací se nesčítají"). A skill carries one discount at most, and a
 *     second source for a skill that already has one cannot be taken.
 *   - A discount is retroactive: it lowers the price of ranks already held,
 *     because the wallet derives what was spent from what the character owns.
 *   - A discount applies only to a rank priced in its own currency.
 *
 * Every definition carries `amount` and `currency`, an optional `group` (the
 * track group it lands in, "skills" when absent; "doctrines" for a doctrine
 * discount), and either
 *   skill    a fixed key in that group ("own" on a feature: its own skill), or
 *   choices  what the player may pick in the Learn window:
 *              sections   price-table sections whose tracks of the group all
 *                         qualify (a skill's governing attribute; "combat" or
 *                         "magic" for a doctrine)
 *              skills     single keys added to the list
 *              noncombat  every ordinary skill except NONCOMBAT_EXCLUDED
 *              specialisations  every specialisation the character owns that
 *                         prices at least one node in the discount's currency
 *                         (group "specialisations"; the discount then lowers
 *                         every such node of the picked one)
 *            A section track with no rank priced in the discount's currency is
 *            left off the list, since the discount could never apply to it.
 *
 * Pure data: the engine (progressionEngine.mjs) applies it, and
 * specialisations.mjs reads SPEC_DISCOUNTS to paint these perks as automated.
 */

/**
 * The first school of magic ("10/0 CP" on every school's rank I): one school's
 * rank I costs no CP. A temperament trait decides which, and a character with
 * that trait and Channeling is handed its rank I (progressionEngine.mjs, "First
 * school of magic"). Rules journal, Usměrňování: "První Škola magie je určena
 * temperamentem … Cholerik - Oheň, Flegmatik - Voda, Sangvinik - Vzduch,
 * Melancholik - Země". Keyed by the trait's English item name.
 */
export const TEMPERAMENT_SCHOOLS = {
  Choleric: "fire",
  Phlegmatic: "water",
  Sanguine: "air",
  Melancholic: "earth",
};

/**
 * Skills a "non-combat skill" discount can never land on: Svaly and Hbitost
 * (book comment on Učenec and on every Specializace row).
 */
export const NONCOMBAT_EXCLUDED = ["muscles", "nimbleness"];

/** Feature discounts, by pick-once group or by the feature's English name. */
export const FEATURE_DISCOUNTS = {
  groups: {
    // Specializace: *Dovednost* (Human, Eldarai, Seraphar): its own skill.
    specialization: { skill: "own", amount: 3, currency: "sp" },
  },
  names: {
    // Učenec I / II: any non-combat skill but Svaly and Hbitost.
    "Scholar I": { choices: { noncombat: true }, amount: 3, currency: "sp" },
    "Scholar II": { choices: { noncombat: true }, amount: 3, currency: "sp" },
    // Specialista (Human): one of the character's own specialisations; every
    // stupeň (node) of it priced in SP costs 3 SP less.
    Specialist: { group: "specialisations", choices: { specialisations: true }, amount: 3, currency: "sp" },
  },
};

// "Vybrat si lze z dovednosti kategorie Charisma (Herectví, Hudba, etc),
// Kapsářství nebo Umělecká tvorba."
const BARD_CHOICES = { sections: ["cha"], skills: ["pickpocketing", "art"] };

// "Vybrat si lze z dovednosti Plížení, Kapsářství, Odemykání zámků nebo Pasti."
const SHADOW_CHOICES = { skills: ["stealth", "pickpocketing", "lockpicking", "traps"] };

// "Vybrat si lze z dovednosti kategorie Inteligence (Alchemie, Výzkum, etc)."
const ALCHEMIST_CHOICES = { sections: ["int"] };

// "Vybrat si lze z dovednosti kategorie Inteligence (Alchemie, Výzkum, etc),
// Rituály, Chodec ve snu nebo Věštění."
const MYSTIC_CHOICES = { sections: ["int"], skills: ["rituals", "dreamwalker", "augury"] };

/** Specialisation perk discounts: specialisation id → node id → discount. */
export const SPEC_DISCOUNTS = {
  // Hraničář: Sleva 3 SP za stupeň Plížení / Přežití / Ranhojičství.
  ranger: {
    slevaPlizeni: { skill: "stealth", amount: 3, currency: "sp" },
    slevaPreziti: { skill: "survival", amount: 3, currency: "sp" },
    slevaRanhojicstvi: { skill: "firstAid", amount: 3, currency: "sp" },
  },
  // Kontramág: Sleva 3 SP za stupeň Arcany.
  countermage: {
    slevaArcana: { skill: "arcana", amount: 3, currency: "sp" },
  },
  // Bard: Sleva 5 SP za stupeň Umělecké tvorby, and four "z výběru" perks.
  bard: {
    slevaUmtvorba: { skill: "art", amount: 5, currency: "sp" },
    sleva1: { choices: BARD_CHOICES, amount: 3, currency: "sp" },
    sleva2: { choices: BARD_CHOICES, amount: 3, currency: "sp" },
    sleva3: { choices: BARD_CHOICES, amount: 3, currency: "sp" },
    sleva4: { choices: BARD_CHOICES, amount: 3, currency: "sp" },
  },
  // Stín (Tulák): two "z výběru" perks.
  shadow: {
    skillDiscount1: { choices: SHADOW_CHOICES, amount: 3, currency: "sp" },
    skillDiscount2: { choices: SHADOW_CHOICES, amount: 3, currency: "sp" },
  },
  // Alchymista: two "z výběru" perks.
  alchemist: {
    sleva1: { choices: ALCHEMIST_CHOICES, amount: 3, currency: "sp" },
    sleva2: { choices: ALCHEMIST_CHOICES, amount: 3, currency: "sp" },
  },
  // Mystik: two "z výběru" perks.
  mystic: {
    sleva1: { choices: MYSTIC_CHOICES, amount: 3, currency: "sp" },
    sleva2: { choices: MYSTIC_CHOICES, amount: 3, currency: "sp" },
  },
  // Veneficus, Lindar: "Zvolí si jednu bojovou Doktrínu, která získává slevu
  // 3 CP na každý stupeň." A combat doctrine is one the price table files under
  // "combat" (melee, ranged, special), never a magic one. Rider is priced in SP,
  // so the currency rule keeps it off the list.
  veneficus: {
    lindar: {
      group: "doctrines",
      choices: { sections: ["combat"] },
      amount: 3,
      currency: "cp",
    },
  },
};
