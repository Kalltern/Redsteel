/* ===========================================================================
 * Specialisation prices: what unlocking each specialisation costs in
 * Specialisation points, which group it counts against, and what a character
 * must have first.
 *
 * Source: "Pravidla pro ToS V12.1 (WIP).xlsx" → sheet "Specializace (WIP)".
 * The line under each specialisation's name reads "N SB, requirement, …";
 * `bookRow` is that line. Combat specialisations are listed from row 17,
 * Support ones from row 780.
 *
 * Rules (user rulings 2026-09-11):
 *  - Every character has 6 Specialisation points by default (the book's "SB",
 *    written out in full because SP already means Skill Points). The GM may
 *    change the total in the Learn window's ledger.
 *  - At most 4 points may go to Combat specialisations; Support is uncapped.
 *    The book caps every group at four; the GM ruling caps Combat only.
 *  - Every active specialisation counts, including ones switched on through
 *    the config checkboxes before points existed.
 *  - The teacher ("Učitel II/III") is granted per specialisation by the GM and
 *    blocks until granted (`specTeacher`). "Zvláštní příležitost" (a special
 *    occasion) is a GM advisory and never blocks.
 *
 * Pátrač (Seeker, 2 SB, row 1475, no requirements written) has no
 * specialisation tree in the system, so it is left out until it has one.
 * ======================================================================== */

/** Specialisation points every character starts with. */
export const SPEC_POINTS_DEFAULT = 6;

/** The groups, in the order the Learn window shows them. */
export const SPEC_GROUPS = ["combat", "support"];

/** Most points a group may hold. A group not listed is uncapped. */
export const SPEC_GROUP_CAPS = { combat: 4 };

const rank = (group, key, min) => ({ t: "rank", group, key, min });
const anyOfRank = (group, keys, min) => ({
  t: "anyOf",
  options: keys.map((key) => rank(group, key, min)),
});
const attr = (key, min) => ({ t: "attr", key, min });
const occasion = { t: "gm", note: "specialOccasion" };

/** The book's "Meče/Sekery/Tupé/Dřevcové": any of the four weapon skills. */
const WEAPONS = ["swords", "axes", "blunt", "polearms"];

/**
 * One price entry. A teacher tier adds the clause that the GM's per
 * specialisation teacher satisfies; it carries the spec id so it can be read
 * without any other context.
 */
function entry(id, group, cost, bookRow, requires, teacher = 0) {
  const all = teacher
    ? [...requires, { t: "specTeacher", spec: id, tier: teacher }]
    : requires;
  return [id, { group, cost, bookRow, requires: all }];
}

export const SPEC_PRICES = Object.fromEntries([
  /* ---------------- Combat (Bojové specializace) ---------------- */
  // Berserk: Meče/Sekery/Tupé/Dřevcové II, Vůle 4, Zvláštní příležitost
  entry("berserk", "combat", 2, 22, [anyOfRank("weaponSkills", WEAPONS, 2), attr("wil", 4), occasion]),
  // Čarostřelec: Arcana I, Magický potenciál/Zvláštní příležitost, Učitel III
  entry("spellslinger", "combat", 2, 71, [rank("skills", "arcana", 1), { t: "anyOf", options: [{ t: "flag", key: "magicPotential" }, occasion] }], 3),
  // Elementalista: Škola Ohně/Vody/Vzduchu/Země I, Nesmí mít Doktrínu: Elymas/Incantator/Veneficus, Zvláštní příležitost
  entry("elementalist", "combat", 3, 138, [anyOfRank("schools", ["fire", "water", "air", "earth"], 1), { t: "noRank", group: "doctrines", keys: ["elymas", "incantator", "veneficus"] }, occasion]),
  // Elymas: Elymas III, Učitel III
  entry("elymas", "combat", 2, 175, [rank("doctrines", "elymas", 3)], 3),
  // Harcovník: Štítonoš I, Učitel III
  entry("skirmisher", "combat", 2, 205, [rank("doctrines", "shieldbearer", 1)], 3),
  // Hoplita: Štítonoš III, Dřevcové III, Učitel III
  entry("hoplite", "combat", 2, 244, [rank("doctrines", "shieldbearer", 3), rank("weaponSkills", "polearms", 3)], 3),
  // Hraničář: Vnímání 4, Odolnost 3, Učitel II
  entry("ranger", "combat", 2, 290, [attr("per", 4), attr("end", 3)], 2),
  // Incantator: Incantator III, Učitel III
  entry("incantator", "combat", 2, 339, [rank("doctrines", "incantator", 3)], 3),
  // Mečový tanečník: Duelista III, Meče III, Učitel III
  entry("swordDancer", "combat", 2, 372, [rank("doctrines", "duelist", 3), rank("weaponSkills", "swords", 3)], 3),
  // Mistr zbraní: Specializace na zbraň I, Učitel III
  entry("weaponMaster", "combat", 2, 416, [{ t: "feature", name: "Weapon Specialization I" }], 3),
  // Ostrostřelec: Lukostřelec/Kušník III, Učitel III
  entry("sharpshooter", "combat", 2, 478, [anyOfRank("doctrines", ["archer", "arbalest"], 3)], 3),
  // Předvoj: Pikenýr/Plenitel/Šermíř III, Meče/Tupé/Sekery/Dřevcové III, Učitel III
  entry("vanguard", "combat", 2, 513, [anyOfRank("doctrines", ["pikeman", "reaver", "swordsman"], 3), anyOfRank("weaponSkills", WEAPONS, 3)], 3),
  // Služebník meče: Šermíř III, Meče III, Učitel III
  entry("swordServant", "combat", 2, 558, [rank("doctrines", "swordsman", 3), rank("weaponSkills", "swords", 3)], 3),
  // Stín: Tulák III, Učitel III
  entry("shadow", "combat", 2, 611, [rank("doctrines", "rogue", 3)], 3),
  // Strážce: Štítonoš III, Meče/Tupé/Sekery/Dřevcové III, Učitel III
  entry("warden", "combat", 2, 652, [rank("doctrines", "shieldbearer", 3), anyOfRank("weaponSkills", WEAPONS, 3)], 3),
  // Šampion: Dimakerus/Mnich III, Meče/Tupé/Sekery III, Učitel III
  entry("champion", "combat", 2, 690, [anyOfRank("doctrines", ["dimakerus", "monk"], 3), anyOfRank("weaponSkills", ["swords", "blunt", "axes"], 3)], 3),
  // Veneficus: Veneficus I, Učitel III
  entry("veneficus", "combat", 2, 738, [rank("doctrines", "veneficus", 1)], 3),

  /* ---------------- Support (Podpůrné specializace) ---------------- */
  // Alchemista: Alchemie: Adept, Inteligence 4, Učitel III
  entry("alchemist", "support", 1, 786, [{ t: "feature", name: "Adept: Alchemy" }, attr("int", 4)], 3),
  // Astramancer: Škola Vzduchu IV, Učitel III
  entry("astramancer", "support", 1, 852, [rank("schools", "air", 4)], 3),
  // Bard: Hudba III, Charisma 3, Krev Sylvanů / Zvláštní příležitost, Učitel III
  entry("bard", "support", 2, 892, [rank("skills", "music", 3), attr("cha", 3), { t: "anyOf", options: [{ t: "race", races: ["Sylvan"] }, occasion] }], 3),
  // Cryomancer: Škola Vody IV, Učitel III
  entry("cryomancer", "support", 1, 966, [rank("schools", "water", 4)], 3),
  // Entomancer: Odolnost 4, Škola Země IV, Učitel III
  entry("entomancer", "support", 1, 1008, [attr("end", 4), rank("schools", "earth", 4)], 3),
  // Geomancer: Škola Země IV, Učitel III
  entry("geomancer", "support", 1, 1060, [rank("schools", "earth", 4)], 3),
  // Gnostik: Elymas/Incantator/Veneficus IV, Učitel III
  entry("gnostic", "support", 1, 1102, [anyOfRank("doctrines", ["elymas", "incantator", "veneficus"], 4)], 3),
  // Grimm: Doktrína IV (any doctrine), Učitel III
  entry("grimm", "support", 1, 1136, [{ t: "anyRank", group: "doctrines", min: 4 }], 3),
  // Iluzionista: Škola Ducha IV, Učitel III
  entry("illusionist", "support", 1, 1154, [rank("schools", "spirit", 4)], 3),
  // Kněz: Víra 3, Zvláštní příležitost
  entry("priest", "support", 2, 1209, [{ t: "secAttr", key: "fth", min: 3 }, occasion]),
  // Kontramág: Odolnost 3, Vůle 4, Zvláštní příležitost, Učitel III
  entry("countermage", "support", 2, 1260, [attr("end", 3), attr("wil", 4), occasion], 3),
  // Maleficarum: Škola Temnoty IV, Učitel III
  entry("maleficarum", "support", 1, 1307, [rank("schools", "darkness", 4)], 3),
  // Mentalista: Vůle 4, Škola Ducha IV, Mentální souboj I, Učitel III
  entry("mentalist", "support", 1, 1357, [attr("wil", 4), rank("schools", "spirit", 4), rank("skills", "mindBending", 1)], 3),
  // Mystik: Rituály III, Vůle 3, Učitel III
  entry("mystic", "support", 1, 1425, [rank("skills", "rituals", 3), attr("wil", 3)], 3),
  // Pyromancer: Škola Ohně IV, Učitel III
  entry("pyromancer", "support", 1, 1495, [rank("schools", "fire", 4)], 3),
  // Runový válečník: Arcana III, Zvláštní příležitost
  entry("runeWarrior", "support", 2, 1539, [rank("skills", "arcana", 3), occasion]),
  // Vitamancer: Škola Ducha / Těla IV, Učitel III
  entry("vitamancer", "support", 1, 1567, [anyOfRank("schools", ["spirit", "body"], 4)], 3),
  // Škola Krve: Usměrňování I / Zvláštní příležitost, Učitel III
  entry("bloodSchool", "support", 0, 1620, [{ t: "anyOf", options: [rank("combatSkills", "channeling", 1), occasion] }], 3),
]);
