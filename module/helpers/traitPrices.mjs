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
  asceticTrait001A: { name: "Ascetic", kind: "positive", cost: 2 }, // Asketa
  u7OMz0kR9SPLIZ68: { name: "Brave", kind: "positive", cost: 2 }, // Statečný
  H4pZqZHzqIWOpB3d: { name: "Brawny", kind: "positive", cost: 6, raisesLimit: "str" }, // Urostlý
  Gk0iezzwdvMrv6dP: { name: "Craftsman", kind: "positive", cost: 3 }, // Řemeslník
  gndcrqXnPdKzyVIn: { name: "Diehard", kind: "positive", cost: 6, raisesLimit: "end" }, // Tuhý kořínek
  V7cOxcepdkkaUlwH: { name: "Eagle senses", kind: "positive", cost: 7, raisesLimit: "per" }, // Orlí smysly
  hbtroo8V1h0rtMnJ: { name: "Genius", kind: "positive", cost: 6, raisesLimit: "int" }, // Génius
  NAy5FTVv6r4k3hPg: { name: "Gorgeous", kind: "positive", cost: 3 }, // Nádherný
  huGJXB9xZLLMmDLU: { name: "Guardian Angel", kind: "positive", cost: 2 }, // Strážný anděl
  OReI0ocGxLtRYDTy: { name: "Inconspicuous", kind: "positive", cost: 2 }, // Nenápadný
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

  // Negative
  KbllJsRHnZcz5HbU: { name: "Asthmatic", kind: "negative", cost: -3 }, // Astmatik
  BVbFDrdWqVGAsXns: { name: "Choleric", kind: "negative", cost: -3 }, // Cholerik
  ZDprpUSZNmVK0Tm1: { name: "Disfigured", kind: "negative", cost: -3 }, // Znetvořený
  "3vf7UkENBQYRiFdN": { name: "Fatso", kind: "negative", cost: -3 }, // Tlouštík
  IpcrxMaQUnADWk0t: { name: "Fragile", kind: "negative", cost: -6 }, // Křehký
  ZFLVGxwXojaM7spD: { name: "Ham fisted", kind: "negative", cost: -3 }, // Nemotora
  gXJV66eTdvGcuKhY: { name: "Hasty", kind: "negative", cost: -2 }, // Ukvapený
  UEXLga8AqCBzqjZV: { name: "Hemophobia", kind: "negative", cost: -2 }, // Hemofobie
  "3PuTYDFBMSLukDl8": { name: "Hemophylia!", kind: "negative", cost: -6 }, // Hemofilie!
  SNtcIyb2dq4ElwLD: { name: "Magical conduit", kind: "negative", cost: -6 }, // Magický vodič
  hz7mdCsLrhHp9CLm: { name: "Melancholic", kind: "negative", cost: -3 }, // Melancholik
  QQn9ZHcnWfFAbHqj: { name: "Scarred", kind: "negative", cost: -1 }, // Zjizvený
  Enh0xElGM5rnDjBy: { name: "Shy", kind: "negative", cost: -3 }, // Plachý
  ICyYoTvkaWH37aQk: { name: "Slowpoke", kind: "negative", cost: -2 }, // Loudal
  ZrbhKpIzpQsd21G4: { name: "Soft bones", kind: "negative", cost: -4 }, // Měkké kosti
  voraciousTrait1A: { name: "Voracious", kind: "negative", cost: -2 }, // Obžera

  // Neutral
  N7ZXnNAwchbWdQOY: { name: "Arcane affinity", kind: "neutral", cost: 0 }, // Arkánová afinita
  mnmpF2cKyy9zuuWT: { name: "Arcane essence !", kind: "neutral", cost: 0 }, // Arkánová esence!
  MfiFohK0I9UYHPLf: { name: "Giant", kind: "neutral", cost: 0 }, // Obr
  lacLHjwgLEPVVvpd: { name: "Imp", kind: "neutral", cost: 0 }, // Prcek
  "4NPQGMNOAFrcQagK": { name: "Kleptomaniac", kind: "neutral", cost: 0 }, // Kleptoman
  DJSPrsVoJ3TN1GBl: { name: "Luck's edge", kind: "neutral", cost: 0 }, // Ostří štěstěny
  rgCdbab1R2pw7Cuo: { name: "Ugly", kind: "neutral", cost: 0 }, // Ošklivý
};
