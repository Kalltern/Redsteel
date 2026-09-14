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
 * Every definition carries `amount` and `currency`, and either
 *   skill    a fixed skill key ("own" on a feature: the feature's own skill), or
 *   choices  what the player may pick in the Learn window:
 *              sections   governing attributes whose ordinary skills all qualify
 *              skills     single skills added to the list
 *              noncombat  every ordinary skill except NONCOMBAT_EXCLUDED
 *
 * Pure data: the engine (progressionEngine.mjs) applies it, and
 * specialisations.mjs reads SPEC_DISCOUNTS to paint these perks as automated.
 */

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
};
