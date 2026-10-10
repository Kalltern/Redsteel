/**
 * Trait prices at character creation (Rysy), keyed by compendium Item id in
 * the pack `redsteel.redsteel-items`.
 *
 * Source: "Pravidla pro ToS V12.1 (WIP).xlsx" → "Tvorba postavy". Only these
 * traits are offered by the Character Creation window.
 *
 *   kind  "positive" costs trait points, "negative" has a negative price (it
 *         gives points back), "neutral" is free.
 *   cost  signed price in trait points.
 *   raisesLimit  the attribute whose physical limit (Fyzická hranice) the
 *         trait raises by 1 ("Strength attribute cap +1" and so on). Only the
 *         creation window reads it; nothing enforces limits after creation.
 */
export const TRAIT_PRICES = {
  // Positive
  NyEeUlpGinzsfVtA: { name: "Ambidextrous", kind: "positive", cost: 1 }, // Ambidextrie
  asceticTrait001A: { name: "Ascetic", kind: "positive", cost: 2 }, // Asketa
  MtjJE5Li9c02H0Sq: { name: "Born in the Saddle", kind: "positive", cost: 2 }, // Narozen v sedle
  u7OMz0kR9SPLIZ68: { name: "Brave", kind: "positive", cost: 2 }, // Statečný
  H4pZqZHzqIWOpB3d: { name: "Brawny", kind: "positive", cost: 6, raisesLimit: "str" }, // Urostlý
  E8sstZDkrPmo4fs2: { name: "Child of the Night", kind: "positive", cost: 2 }, // Dítě noci
  ixnuw8hWbLxMIpS3: { name: "Child of the Sea", kind: "positive", cost: 2 }, // Dítě moře
  Gk0iezzwdvMrv6dP: { name: "Craftsman", kind: "positive", cost: 3 }, // Řemeslník
  gndcrqXnPdKzyVIn: { name: "Diehard", kind: "positive", cost: 6, raisesLimit: "end" }, // Tuhý kořínek
  nv6Yk3Ujc1PuuSU2: { name: "Dragon Eyes", kind: "positive", cost: 2 }, // Dračí oči
  V7cOxcepdkkaUlwH: { name: "Eagle senses", kind: "positive", cost: 7, raisesLimit: "per" }, // Orlí smysly
  "6uLqm8bNLVkZMxjc": { name: "Elder Blood", kind: "positive", cost: 8 }, // Starší krev
  hbtroo8V1h0rtMnJ: { name: "Genius", kind: "positive", cost: 6, raisesLimit: "int" }, // Génius
  BVTnhEiAapGG80Cb: { name: "Gift: Empath", kind: "positive", cost: 4 }, // Nadání: Empat
  GgqsUWxBpe83Ap6V: { name: "Gift: Nature Bond", kind: "positive", cost: 4 }, // Nadání: Spojení s přírodou
  COAAE4giyrsyD6Cn: { name: "Gift: Seer", kind: "positive", cost: 4 }, // Nadání: Věštec
  o1kMj1iBFO7WU9yC: { name: "Gift: Spiritualist", kind: "positive", cost: 4 }, // Nadání: Spiritualista
  NAy5FTVv6r4k3hPg: { name: "Gorgeous", kind: "positive", cost: 3 }, // Nádherný
  huGJXB9xZLLMmDLU: { name: "Guardian Angel", kind: "positive", cost: 2 }, // Strážný anděl
  iif4yKvCnrlMyYcR: { name: "Callous", kind: "positive", cost: 2 }, // Otrlý
  oDTHHuoXQgIWEwR2: { name: "Hated Enemy", kind: "positive", cost: 2 }, // Nenáviděný nepřítel
  OReI0ocGxLtRYDTy: { name: "Inconspicuous", kind: "positive", cost: 2 }, // Nenápadný
  TBVfRt36ICsBUW2c: { name: "Iron Stomach", kind: "positive", cost: 5 }, // Železný žaludek
  F5dOSq8SWuMiqne1: { name: "Iron Will", kind: "positive", cost: 7, raisesLimit: "wil" }, // Železná vůle
  linguistTrait01A: { name: "Linguist", kind: "positive", cost: 3 }, // Lingvista
  eDm5BSp5OtLfg0pm: { name: "Lucky", kind: "positive", cost: 4 }, // Šťastlivec
  abUe5QntVOFVUDgC: { name: "Magic potential", kind: "positive", cost: 4 }, // Magický potenciál
  Je4WhO6ZS4jjKORT: { name: "Magic resistance", kind: "positive", cost: 5 }, // Odolnost vůči magii
  Gtf0thMF9Ffvc3A7: { name: "Nimble", kind: "positive", cost: 7, raisesLimit: "dex" }, // Mrštný
  IUPADlsAjj4QO9P8: { name: "Phlegmatic", kind: "positive", cost: 1 }, // Flegmatik
  GvNvyDHIZrbC6bKa: { name: "Pretty", kind: "positive", cost: 1 }, // Pohledný
  QdoyVmfpNCWh0arN: { name: "Sanguine", kind: "positive", cost: 1 }, // Sangvinik
  "927rRKJ5IAFRQGZK": { name: "Silver tongue", kind: "positive", cost: 6, raisesLimit: "cha" }, // Stříbrný jazyk
  ui5eUoggBV2A1XbK: { name: "Sylvan Blood", kind: "positive", cost: 3 }, // Krev Sylvanů

  // Negative
  KbllJsRHnZcz5HbU: { name: "Asthmatic", kind: "negative", cost: -3 }, // Astmatik
  BVbFDrdWqVGAsXns: { name: "Choleric", kind: "negative", cost: -3 }, // Cholerik
  ZDprpUSZNmVK0Tm1: { name: "Disfigured", kind: "negative", cost: -3 }, // Znetvořený
  IQWNOLEsVN9raS22: { name: "Endless Seasickness", kind: "negative", cost: -4 }, // Nekončící mořská nemoc
  "3vf7UkENBQYRiFdN": { name: "Fatso", kind: "negative", cost: -3 }, // Tlouštík
  IpcrxMaQUnADWk0t: { name: "Fragile", kind: "negative", cost: -6 }, // Křehký
  cE5Ds8RqOgv8PE0d: { name: "Godless", kind: "negative", cost: -2 }, // Neznaboh
  Q60jjwnxfBf6u4x0: { name: "Guardian Devil", kind: "negative", cost: -3 }, // Ďábel strážný
  ZFLVGxwXojaM7spD: { name: "Ham fisted", kind: "negative", cost: -3 }, // Nemotora
  gXJV66eTdvGcuKhY: { name: "Hasty", kind: "negative", cost: -2 }, // Ukvapený
  UEXLga8AqCBzqjZV: { name: "Hemophobia", kind: "negative", cost: -2 }, // Hemofobie
  "3PuTYDFBMSLukDl8": { name: "Hemophylia!", kind: "negative", cost: -6 }, // Hemofilie!
  o8WKx4iKPN62qXhX: { name: "Hunchback", kind: "negative", cost: -6 }, // Hrbáč
  "8ONNJyidNzPmUcRy": { name: "Illiterate", kind: "negative", cost: -5 }, // Negramot
  RRTkAG4V4PQA2WHW: { name: "Latent Magic Potential", kind: "negative", cost: -2 }, // Latentní magický potenciál
  SNtcIyb2dq4ElwLD: { name: "Magical conduit", kind: "negative", cost: -6 }, // Magický vodič
  hz7mdCsLrhHp9CLm: { name: "Melancholic", kind: "negative", cost: -3 }, // Melancholik
  zG8b8B53WnaIVNvs: { name: "Nemesis", kind: "negative", cost: -2 }, // Nemesis
  DcVkKp7LVpoGHTt2: { name: "Potion Allergy", kind: "negative", cost: -5 }, // Alergický na lektvary
  QQn9ZHcnWfFAbHqj: { name: "Scarred", kind: "negative", cost: -1 }, // Zjizvený
  Enh0xElGM5rnDjBy: { name: "Shy", kind: "negative", cost: -3 }, // Plachý
  ICyYoTvkaWH37aQk: { name: "Slowpoke", kind: "negative", cost: -2 }, // Loudal
  ZrbhKpIzpQsd21G4: { name: "Soft bones", kind: "negative", cost: -4 }, // Měkké kosti
  cfsD2xzk7GA23uBb: { name: "Traumatic Experience", kind: "negative", cost: -1 }, // Traumatický zážitek
  voraciousTrait1A: { name: "Voracious", kind: "negative", cost: -2 }, // Obžera
  VCl3RZQQuMRUFBel: { name: "Weak Liver", kind: "negative", cost: -4 }, // Slabá játra

  // Neutral
  N7ZXnNAwchbWdQOY: { name: "Arcane affinity", kind: "neutral", cost: 0 }, // Arkánová afinita
  mnmpF2cKyy9zuuWT: { name: "Arcane essence !", kind: "neutral", cost: 0 }, // Arkánová esence!
  MfiFohK0I9UYHPLf: { name: "Giant", kind: "neutral", cost: 0 }, // Obr
  lacLHjwgLEPVVvpd: { name: "Imp", kind: "neutral", cost: 0 }, // Prcek
  "4NPQGMNOAFrcQagK": { name: "Kleptomaniac", kind: "neutral", cost: 0 }, // Kleptoman
  DJSPrsVoJ3TN1GBl: { name: "Luck's edge", kind: "neutral", cost: 0 }, // Ostří štěstěny
  rgCdbab1R2pw7Cuo: { name: "Ugly", kind: "neutral", cost: 0 }, // Ošklivý
};
