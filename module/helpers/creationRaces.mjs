/**
 * The playable races offered by the Character Creation window, in the order
 * they are listed.
 *
 * Source: "Pravidla pro ToS V12.1 (WIP).xlsx" → "Tvorba postavy". Each entry is
 * one row of that sheet (the Czech row name is in the comment beside it).
 *
 *   raceId       compendium Item id in the pack `redsteel.redsteel-items`.
 *   limits       the attribute's physical limit (Fyzická hranice). These
 *                already include the subrace's FIXED "Úprava a Fyzická hranice
 *                +1" bumps; bumps the player picks come from the chosen choice
 *                Active Effects flagged `flags.redsteel.raisesLimit` at runtime.
 *   traitPoints  Rysové body.
 *   requires     optional; `{ trait: <compendium id> }` = that trait must be
 *                among the drafted traits.
 */

/** Race groups, in the order the window lists them. */
export const CREATION_RACE_GROUPS = [
  { key: "human", labelKey: "REDSTEEL.Creation.Group.Human" },
  { key: "halfling", labelKey: "REDSTEEL.Creation.Group.Halfling" },
  { key: "dwarf", labelKey: "REDSTEEL.Creation.Group.Dwarf" },
  { key: "elf", labelKey: "REDSTEEL.Creation.Group.Elf" },
];

export const CREATION_RACES = [
  // Člověk
  {
    key: "human",
    group: "human",
    raceId: "5W0g2di0AJM8BUWb",
    labelKey: "REDSTEEL.Items.Human.name",
    limits: { str: 5, dex: 5, end: 5, int: 5, wil: 5, cha: 6, per: 5 },
    traitPoints: 15,
  },
  // Půlčík
  {
    key: "halfling",
    group: "halfling",
    raceId: "h8G02phV3FNnBhYR",
    labelKey: "REDSTEEL.Items.Halfling.name",
    limits: { str: 3, dex: 5, end: 5, int: 5, wil: 6, cha: 6, per: 5 },
    traitPoints: 14,
  },
  // Trpaslík — Vardur (the compendium item named "Dwarf" is Vardur: it carries
  // Odolnost +2 and Magic armor +4)
  {
    key: "vardur",
    group: "dwarf",
    raceId: "y55VtH5VHmRhEN7M",
    labelKey: "REDSTEEL.Creation.Race.Vardur",
    limits: { str: 5, dex: 4, end: 6, int: 5, wil: 5, cha: 4, per: 4 },
    traitPoints: 13,
  },
  // Trpaslík — Borgor
  {
    key: "borgor",
    group: "dwarf",
    raceId: "fFamUml1zbguq5eM",
    labelKey: "REDSTEEL.Items.Borgor.name",
    limits: { str: 5, dex: 4, end: 5, int: 5, wil: 5, cha: 4, per: 4 },
    traitPoints: 13,
  },
  // Elf — Eldarai
  {
    key: "eldarai",
    group: "elf",
    raceId: "0dQIAnM4kbu73iFK",
    labelKey: "REDSTEEL.Items.Eldarai.name",
    limits: { str: 4, dex: 5, end: 4, int: 5, wil: 4, cha: 5, per: 5 },
    traitPoints: 14,
  },
  // Elf — Lomerai
  {
    key: "lomerai",
    group: "elf",
    raceId: "Bl4MMx535ZNfHvAn",
    labelKey: "REDSTEEL.Items.Lomerai.name",
    limits: { str: 4, dex: 5, end: 4, int: 5, wil: 4, cha: 4, per: 5 },
    traitPoints: 12,
  },
  // Elf — Ornerai
  {
    key: "ornerai",
    group: "elf",
    raceId: "mMPzUz5nEa8x31XW",
    labelKey: "REDSTEEL.Items.Ornerai.name",
    limits: { str: 4, dex: 6, end: 4, int: 5, wil: 4, cha: 4, per: 6 },
    traitPoints: 12,
  },
  // Elf — Zephyrai
  {
    key: "zephyrai",
    group: "elf",
    raceId: "QH37E1ItDo6HyrXr",
    labelKey: "REDSTEEL.Items.Zephyrai.name",
    limits: { str: 4, dex: 5, end: 4, int: 5, wil: 4, cha: 4, per: 5 },
    traitPoints: 13,
  },
  // Elf — Ikarai
  {
    key: "ikarai",
    group: "elf",
    raceId: "NXCZfKM3SONZ9xfj",
    labelKey: "REDSTEEL.Items.Ikarai.name",
    limits: { str: 5, dex: 5, end: 4, int: 5, wil: 4, cha: 4, per: 5 },
    traitPoints: 12,
  },
  // Elf — Mornerai
  {
    key: "mornerai",
    group: "elf",
    raceId: "HFeilqvhvFlIfh3c",
    labelKey: "REDSTEEL.Items.Mornerai.name",
    limits: { str: 4, dex: 5, end: 4, int: 5, wil: 5, cha: 4, per: 5 },
    traitPoints: 11,
  },
  // Elf — Kernerai
  {
    key: "kernerai",
    group: "elf",
    raceId: "EjGoPXmraUqCLguB",
    labelKey: "REDSTEEL.Items.Kernerai.name",
    limits: { str: 4, dex: 5, end: 5, int: 5, wil: 4, cha: 4, per: 5 },
    traitPoints: 11,
  },
  // Elf — Arenai (Podmínka: musí mít rys Magický potenciál)
  {
    key: "arenai",
    group: "elf",
    raceId: "PUR690WSGiUyVtXl",
    labelKey: "REDSTEEL.Items.Arenai.name",
    limits: { str: 4, dex: 5, end: 4, int: 6, wil: 5, cha: 4, per: 5 },
    traitPoints: 11,
    requires: { trait: "abUe5QntVOFVUDgC" },
  },
];
