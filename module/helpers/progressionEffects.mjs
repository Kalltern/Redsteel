/**
 * What every rank of every track actually does.
 *
 * Extracted once from "Pravidla pro ToS V12.1 (WIP).xlsx" → sheet "Dovednosti",
 * from the rank row itself (the costs two rows below it live in
 * progression.mjs). HAND-MAINTAINED from here on.
 *
 * Two thirds of the book's rank text is a stat and a number, so it is stored
 * structurally and rendered from labels the system already owns — no
 * translation, and the wording can never drift from the sheet's own names.
 * Only the genuinely prose entries carry a lang key.
 *
 * Entry shapes, per rank, in the order the book prints them:
 *   { t: "pct",  label, value }        "Athletics 15%"
 *   { t: "mod",  label, value }        "Stamina +2"
 *   { t: "mod",  label, value, pct }   "Hit +5%"
 *   { t: "val",  label, value }        "Detection 12" (a flat rating, not a delta)
 *   { t: "text", key }                 book prose, authored in both lang files
 *
 * `label` is a localization key that already exists (a track's own label, or an
 * attribute), or one under REDSTEEL.Learn.Stat for the stat words that are not
 * tracks. Ranks are ordered I→X; an empty array is a rank the book leaves blank.
 */

export const RANK_EFFECTS = {
  "combatSkills.combat": [
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 15 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 15 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 10 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 10 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 20 }], // II
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 25 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 25 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 40 }], // V
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 40 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 40 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 45 }], // VI
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 50 }], // VII
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 65 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 65 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 55 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 75 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 75 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 55 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 55 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 65 }], // IX
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 80 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 80 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.throwing.label", value: 70 }], // X
  ],
  "doctrines.pikeman": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.nabodnuti" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.bonusProtiVelkymTvorum" }, { t: "text", key: "REDSTEEL.Learn.Effect.nabodnutiNavazujiciUtok" }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 10, pct: true }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.prilezitostnyUtokZaKolo" }, { t: "text", key: "REDSTEEL.Learn.Effect.dalekeRozseknuti" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ztecPrubojnost5" }, { t: "text", key: "REDSTEEL.Learn.Effect.odstrceni" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.obranaProtiZteci" }, { t: "text", key: "REDSTEEL.Learn.Effect.pripravnyPostoj" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.pomalyPohybVeVnejsiZone" }, { t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 5, pct: true }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.prilezitostnyUtokZbesilyUtokNabodnutiKritickyZasah" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokSOdstupem" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.momentum" }], // X
  ],
  "doctrines.swordsman": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dalekyVypad" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.rozseknuti" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.kritickaObranaKrytZvysujeDocasneZivotyO5" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.pulpirueta" }, { t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 10, pct: true }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.protiutok" }, { t: "mod", label: "REDSTEEL.Learn.Stat.bleed", value: 25, pct: true }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.smrstUtoku" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.protiutokCilenyZasahPostihSnizenO10" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.momentum" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.cilenyUtokZpusobujeJednoKrvaceniNavic" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.riposta" }], // X
  ],
  "doctrines.reaver": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.rozseknuti" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 10, pct: true }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dalekyVypad" }, { t: "mod", label: "REDSTEEL.Learn.Stat.criticalRange", value: 2 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtokKrvaceni50Omraceni25" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.povaleni" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ztecZraneni1d4" }, { t: "text", key: "REDSTEEL.Learn.Effect.pruraznost2d6" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.bleed", value: 15, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.stagger", value: 10, pct: true }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.momentum" }, { t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 5, pct: true }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.triumf" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zmrzacujiciUder" }], // X
  ],
  "doctrines.shieldbearer": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.uderStitem" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ochrana" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.redukceBoku" }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickaObranaKryt3" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.protiutok" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ztecStitem" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.obrannyPostoj" }, { t: "text", key: "REDSTEEL.Learn.Effect.ignorujePruraznost" }], // VI
    [{ t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 10, pct: true }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 5, pct: true }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.jednaOdvetnaAkceZaKoloJakoVolnaAkce" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.obrneni" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.volnyUderStitem" }], // X
  ],
  "doctrines.dimakerus": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.vycvikSeDvemaZbranemi" }, { t: "text", key: "REDSTEEL.Learn.Effect.bonusZaZbran" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.smrstUtoku" }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 5, pct: true }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 5, pct: true }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.odvetnyUder" }], // III
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.bleed", value: 10, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.stagger", value: 5, pct: true }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.protiutok" }, { t: "text", key: "REDSTEEL.Learn.Effect.pulpirueta" }], // VI
    [{ t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 5, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.vetrnyPostoj" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.klamavyUtok" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 5, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.utokSPohybem" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.jedenOdvetnyUderZaKoloJakoVolnaAkce" }], // X
  ],
  "doctrines.duelist": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.vylepseneMireni" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.redukceMireniPoZasahu" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.duelistuvKrok" }], // III
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 5, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 2, pct: true }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokSPohybem" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.rafinovanyManevr" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mireniZarovenZvysujeObranuO5ProtiCili" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.protiutok" }, { t: "mod", label: "REDSTEEL.Learn.Stat.criticalDefense", value: 2, pct: true }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.navazujiciUtok" }, { t: "text", key: "REDSTEEL.Learn.Effect.pulpirueta" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.brilantniProtiutok" }], // X
  ],
  "doctrines.monk": [
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 5, pct: true }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 5, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.mnich" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.finta" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.smrstUtoku" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.omracujiciUder" }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalDefense", value: 2, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.protiutok" }], // V
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 3, pct: true }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 3, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.utokSOdstupem" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.vetrnyPostoj" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokSPohybem" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }, { t: "text", key: "REDSTEEL.Learn.Effect.pulpirueta" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mnichuvUder" }], // X
  ],
  "doctrines.rogue": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zakernyUtok1d6" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.nasledujiciSePoZasahuPocitaJakoZakernyUtok" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zakernyUtok1d6" }, { t: "text", key: "REDSTEEL.Learn.Effect.zakernyUtokEfekt50" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.rozptyleni" }, { t: "text", key: "REDSTEEL.Learn.Effect.zakernyUtokPrubojnost5" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.nasledujiciSePoZasahuPocitaJakoZakernyUtok" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zakernyUtok1d6ANevyvolavaPrilezitostnyUtok" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.uskok" }, { t: "text", key: "REDSTEEL.Learn.Effect.vyhodaNaPoradiTahu" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.presilaBokZasahStrelbaAVrh5" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokVrhNaSlabinuZakernySnizenaHranice" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.vypocitavyUtok" }, { t: "text", key: "REDSTEEL.Learn.Effect.zakernyUtokPrubojnost5" }], // X
  ],
  "doctrines.rider": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.jezdeckaZtec" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.jezdeckaOchrana" }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.initiative", value: 3 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.synergieSeStitonosem" }, { t: "text", key: "REDSTEEL.Learn.Effect.zraneni2d4" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.jezdeckeRozseknuti" }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.combat.label", value: 10, pct: true }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.odsunuti" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.triumf" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.jezdeckaOdveta" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.jezdeckeObrneni" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.momentum" }], // X
  ],
  "weaponSkills.swords": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ztec" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtok" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokNaSlabinu" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.kritickaObranaKrytZvysujeDocasneZivotyO5" }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.effect", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.finta" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 3, pct: true }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 3, pct: true }], // VII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.effect", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtokAUtokNaSlabinu1Akce" }], // IX
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 5 }], // X
  ],
  "weaponSkills.axes": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ztec" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtok" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokNaSlabinu" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.kritickaObranaKrytZvysujeDocasneZivotyO5" }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.effect", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.rozstepeni" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 3, pct: true }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 3, pct: true }], // VII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.effect", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtokAUtokNaSlabinu1Akce" }], // IX
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 5 }], // X
  ],
  "weaponSkills.blunt": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ztec" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtok" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokNaSlabinu" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.kritickaObranaKrytZvysujeDocasneZivotyO5" }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.effect", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.omracujiciUder" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 3, pct: true }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 3, pct: true }], // VII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.effect", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtokAUtokNaSlabinu1Akce" }], // IX
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 5 }], // X
  ],
  "weaponSkills.polearms": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ztec" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtok" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokNaSlabinu" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.kritickaObranaKrytZvysujeDocasneZivotyO5" }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.effect", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.podseknuti" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 3, pct: true }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 3, pct: true }], // VII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.effect", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyUtokAUtokNaSlabinu1Akce" }], // IX
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 5 }], // X
  ],
  "combatSkills.archery": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 15 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 10 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 10 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 10 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 20 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 20 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 25 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 25 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 25 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 30 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 30 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 35 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 35 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 40 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 40 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 40 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 45 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 45 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 65 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 50 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 50 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 75 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 55 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 55 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 55 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 80 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 60 }, { t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 60 }], // X
  ],
  "doctrines.archer": [
    [{ t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 10, pct: true }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zmrzacujiciVystrel" }, { t: "text", key: "REDSTEEL.Learn.Effect.nahlePrezbrojeni" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokNaSlabinu" }], // III
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.bleed", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.presnyVystrel" }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 10, pct: true }], // V
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 3, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.dlouhyLukBezPostihu" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.straz" }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.salva" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.streleckyPostoj" }, { t: "text", key: "REDSTEEL.Learn.Effect.dlouhyLukViceUtoku" }], // X
  ],
  "doctrines.arbalest": [
    [{ t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 10, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokNaSlabinu" }, { t: "text", key: "REDSTEEL.Learn.Effect.nahlePrezbrojeni" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zmrzacujiciVystrel" }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 10, pct: true }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.straz" }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mireniStrelba10" }], // V
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 5, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.bleed", value: 10, pct: true }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.presnyVystrel" }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // VII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 5, pct: true }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.rychlePrebijeni" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.streleckyPostoj" }], // X
  ],
  "doctrines.peltast": [
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.bleed", value: 20, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.stagger", value: 10, pct: true }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.vrhSRozbehem" }, { t: "text", key: "REDSTEEL.Learn.Effect.nahlePrezbrojeni" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokNaSlabinu" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbesilyVrh" }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zmrzacujiciVystrel" }], // V
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 3, pct: true }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.presnyVystrel" }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.straz" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.shieldLoad", value: 25, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.criticalRange", value: 2 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dvojityVrh" }], // X
  ],
  "doctrines.juggler": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.strelbaVrh5" }, { t: "text", key: "REDSTEEL.Learn.Effect.utok1ProLehkeZbrane" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 3, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.nahlePrezbrojeni" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.utokNaSlabinu" }, { t: "text", key: "REDSTEEL.Learn.Effect.vrhNaSlabinu" }], // III
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.bleed", value: 10, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.straz" }], // V
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.attack", value: 1 }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zmrzacujiciVystrel" }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickeZraneniPrubojnost5" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.vrhZaBehu" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.vicenasobnyVrh" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.odveta" }, { t: "text", key: "REDSTEEL.Learn.Effect.vylepsenyZmrzacujiciVystrel" }], // X
  ],
  "doctrines.musketeer": [
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 5, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.gunnery", value: 5, pct: true }, { t: "text", key: "REDSTEEL.Learn.Effect.ztecZraneni2d4" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dalekyVypad" }, { t: "mod", label: "REDSTEEL.Learn.Stat.bleed", value: 10, pct: true }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zakernyUtok1d6" }, { t: "mod", label: "REDSTEEL.Learn.Stat.criticalHit", value: 2, pct: true }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.straz" }, { t: "mod", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 5, pct: true }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zakernyUtok2d6" }, { t: "mod", label: "REDSTEEL.Learn.Stat.hit", value: 5, pct: true }, { t: "mod", label: "REDSTEEL.Learn.Stat.gunnery", value: 5, pct: true }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.rychlePrebijeni" }, { t: "text", key: "REDSTEEL.Learn.Effect.omracujiciUder" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.presilaBokZasah5" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.odstrceni" }, { t: "mod", label: "REDSTEEL.Learn.Stat.stagger", value: 10, pct: true }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.nasledujiciSePoZasahuPocitaJakoZakernyUtok" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.poprava" }], // X
  ],
  "combatSkills.ranger": [
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 15 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 15 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 15 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 10 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 10 }], // I
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 20 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 20 }], // II
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 25 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 25 }], // III
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 30 }], // IV
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 35 }], // V
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 40 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 40 }], // VI
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 45 }], // VII
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 65 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 65 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 65 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 50 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 75 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 75 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 75 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 55 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 55 }], // IX
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.hit", value: 80 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.meleeDefense.label", value: 80 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.archery.label", value: 80 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.rangedDefense.label", value: 60 }, { t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 60 }], // X
  ],
  "doctrines.elymas": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany25" }, { t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek50Many" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.magickeObrneni" }, { t: "mod", label: "REDSTEEL.Learn.Stat.magicDefense", value: 5, pct: true }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.soustredenyUtok" }, { t: "text", key: "REDSTEEL.Learn.Effect.nestabilita1" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany3" }, { t: "mod", label: "REDSTEEL.Learn.Stat.magicAttack", value: 5, pct: true }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek100Many" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany35" }, { t: "mod", label: "REDSTEEL.Learn.Stat.magicDefense", value: 5, pct: true }], // VI
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.shortRest", value: 25 }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany4" }], // VIII
    [{ t: "pct", label: "REDSTEEL.Learn.Stat.shortRest", value: 50 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.udrzovaniKouzelJeO2ManyLevnejsi" }], // X
  ],
  "doctrines.incantator": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany5" }, { t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek20Many" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.magickeObrneni" }, { t: "mod", label: "REDSTEEL.Learn.Stat.magicAttack", value: 5, pct: true }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.soustredenyUtok" }, { t: "text", key: "REDSTEEL.Learn.Effect.nestabilita1" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany8" }, { t: "mod", label: "REDSTEEL.Learn.Stat.magicDefense", value: 5, pct: true }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek30Many" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany10" }, { t: "mod", label: "REDSTEEL.Learn.Stat.magicAttack", value: 5, pct: true }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zesileniKouzla" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany12" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek40Many" }], // IX
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.concentration", value: 1 }], // X
  ],
  "doctrines.veneficus": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany1" }, { t: "text", key: "REDSTEEL.Learn.Effect.kratkyOdpocinek100Many" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.soubojStrelbaDavaSanceDoUsmernovaniAManu" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.obnoveni" }, { t: "text", key: "REDSTEEL.Learn.Effect.nestabilita1" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.snizujePostihNaUsmernovaniZaZbrojO5" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.opatrneCarovani" }, { t: "text", key: "REDSTEEL.Learn.Effect.utokACarovaniVJednomTahu" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany15" }, { t: "text", key: "REDSTEEL.Learn.Effect.magickeObrneni" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.oddech5Many" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.bojoveTestyRychlostiIniciativa3" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.opatrneCarovaniObrana10" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.obnoveni6Many" }], // X
  ],
  "doctrines.elementalist": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany2" }, { t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek25Many" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zakladniDivokaMagie" }, { t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie2sk" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.magickeObrneni" }, { t: "mod", label: "REDSTEEL.Learn.Stat.magicDefense", value: 5, pct: true }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.soustredenyUtok" }, { t: "text", key: "REDSTEEL.Learn.Effect.nestabilita1" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany4" }, { t: "mod", label: "REDSTEEL.Learn.Stat.magicAttack", value: 5, pct: true }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek35Many" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany6" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek50Many" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.rychlaDivokaMagie" }, { t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie2sk" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.modifikatorMany8" }], // X
  ],
  "combatSkills.channeling": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 20 }, { t: "text", key: "REDSTEEL.Learn.Effect.dlouhyOdpocinek100Many" }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 25 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 3 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 30 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 3 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 35 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 3 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 45 }, { t: "text", key: "REDSTEEL.Learn.Effect.soustredeni" }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 70 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.channeling.label", value: 80 }], // X
  ],
  "schools.fire": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 1 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ucednik" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.expert" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mistr" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.velmistr" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 2 }], // X
  ],
  "schools.water": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 1 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ucednik" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.expert" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mistr" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.velmistr" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 2 }], // X
  ],
  "schools.air": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 1 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ucednik" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.expert" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mistr" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.velmistr" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 2 }], // X
  ],
  "schools.earth": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 1 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ucednik" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.expert" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mistr" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.velmistr" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 2 }], // X
  ],
  "schools.spirit": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 1 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ucednik" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.expert" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mistr" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.velmistr" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 2 }], // X
  ],
  "schools.body": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 1 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ucednik" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.expert" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mistr" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.velmistr" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 2 }], // X
  ],
  "schools.darkness": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.divokaMagie" }], // I
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // II
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }, { t: "mod", label: "REDSTEEL.Learn.Stat.manaBase", value: 1 }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.ucednik" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IV
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.expert" }], // VI
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.mistr" }], // VIII
    [{ t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 1 }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.velmistr" }, { t: "mod", label: "REDSTEEL.Learn.Stat.spellPower", value: 2 }], // X
  ],
  "skills.athletics": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 15 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 25 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 30 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 35 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 45 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 50 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 55 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 65 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 75 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.athletics.label", value: 85 }, { t: "mod", label: "REDSTEEL.Learn.Stat.stamina", value: 2 }], // X
  ],
  "skills.smithing": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.smithing.label", value: 85 }], // X
  ],
  "skills.brawler": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 30 }, { t: "text", key: "REDSTEEL.Learn.Effect.popadnuti" }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 45 }, { t: "text", key: "REDSTEEL.Learn.Effect.podpasovka" }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 55 }, { t: "text", key: "REDSTEEL.Learn.Effect.rychlyUder" }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 75 }, { t: "text", key: "REDSTEEL.Learn.Effect.chvat" }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.brawler.label", value: 85 }], // X
  ],
  "skills.muscles": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Str.long", value: 5 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Str.long", value: 10 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Str.long", value: 15 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Str.long", value: 20 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Str.long", value: 30 }], // V
  ],
  "skills.acrobacy": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 15 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 20 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 25 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 30 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 35 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 35 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 40 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 45 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 50 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 50 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 55 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 55 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 60 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 65 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 75 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acrobacy.label", value: 85 }, { t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.dodge.label", value: 85 }], // X
  ],
  "skills.nimbleness": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Dex.long", value: 5 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Dex.long", value: 10 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Dex.long", value: 15 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Dex.long", value: 20 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.Attribute.Dex.long", value: 30 }], // V
  ],
  "skills.riding": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.riding.label", value: 25 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.riding.label", value: 40 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.riding.label", value: 55 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.riding.label", value: 70 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.riding.label", value: 85 }], // V
  ],
  "skills.pickpocketing": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.pickpocketing.label", value: 85 }], // X
  ],
  "skills.sailing": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.sailing.label", value: 25 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.sailing.label", value: 40 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.sailing.label", value: 55 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.sailing.label", value: 70 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.sailing.label", value: 85 }], // V
  ],
  "skills.lockpicking": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.lockpicking.label", value: 85 }], // X
  ],
  "skills.stealth": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.stealth.label", value: 85 }], // X
  ],
  "skills.craft": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.craft.label", value: 85 }], // X
  ],
  "skills.dancing": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dancing.label", value: 40 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dancing.label", value: 65 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dancing.label", value: 90 }, { t: "text", key: "REDSTEEL.Learn.Effect.kritickyNeuspech3" }], // III
  ],
  "skills.drinking": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.drinking.label", value: 10 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.drinking.label", value: 20 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.drinking.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.drinking.label", value: 40 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.drinking.label", value: 50 }], // V
  ],
  "skills.alchemy": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.alchemy.label", value: 85 }], // X
  ],
  "skills.arcana": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.arcana.label", value: 85 }], // X
  ],
  "skills.engineering": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.engineering.label", value: 85 }], // X
  ],
  "skills.logic": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.logic.label", value: 85 }], // X
  ],
  "skills.firstAid": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.firstAid.label", value: 85 }], // X
  ],
  "skills.tactics": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.tactics.label", value: 85 }], // X
  ],
  "skills.art": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.art.label", value: 85 }], // X
  ],
  "skills.research": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.research.label", value: 85 }], // X
  ],
  "skills.deception": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.deception.label", value: 5 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.deception.label", value: 10 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.deception.label", value: 15 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.deception.label", value: 20 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.deception.label", value: 25 }], // V
  ],
  "skills.acting": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.acting.label", value: 85 }], // X
  ],
  "skills.music": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 15 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 20 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 25 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 30 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 35 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 45 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 50 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 55 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 65 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 75 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 70 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.music.label", value: 85 }, { t: "pct", label: "REDSTEEL.Learn.Stat.melody", value: 80 }], // X
  ],
  "skills.painting": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.painting.label", value: 85 }], // X
  ],
  "skills.persuasion": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.persuasion.label", value: 5 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.persuasion.label", value: 10 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.persuasion.label", value: 15 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.persuasion.label", value: 20 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.persuasion.label", value: 25 }], // V
  ],
  "skills.temptation": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.temptation.label", value: 5 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.temptation.label", value: 10 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.temptation.label", value: 15 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.temptation.label", value: 20 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.temptation.label", value: 25 }], // V
  ],
  "skills.leadership": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 5 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 10 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 15 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 20 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 25 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 30 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 35 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 40 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 45 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.leadership.label", value: 50 }], // X
  ],
  "skills.intimidation": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.intimidation.label", value: 5 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.intimidation.label", value: 10 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.intimidation.label", value: 15 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.intimidation.label", value: 20 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.intimidation.label", value: 25 }], // V
  ],
  "skills.herbalism": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.herbalism.label", value: 25 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.herbalism.label", value: 40 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.herbalism.label", value: 55 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.herbalism.label", value: 70 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.herbalism.label", value: 85 }], // V
  ],
  "skills.traps": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 15 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 2 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 25 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 4 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 30 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 6 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 35 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 8 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 45 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 10 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 50 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 12 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 55 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 14 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 65 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 16 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 75 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 18 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.traps.label", value: 85 }, { t: "val", label: "REDSTEEL.Learn.Stat.detection", value: 20 }], // X
  ],
  "skills.survival": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.survival.label", value: 20 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.survival.label", value: 30 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.survival.label", value: 40 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.survival.label", value: 50 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.survival.label", value: 60 }], // V
  ],
  "skills.insight": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.insight.label", value: 5 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.insight.label", value: 10 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.insight.label", value: 15 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.insight.label", value: 20 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.insight.label", value: 25 }], // V
  ],
  "skills.animalHandling": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.animalHandling.label", value: 85 }], // X
  ],
  "doctrines.cordinas": [
    [{ t: "text", key: "REDSTEEL.Learn.Effect.zbranJeOhniskovyPredmet" }, { t: "text", key: "REDSTEEL.Learn.Effect.prolevaniKrve" }], // I
    [{ t: "text", key: "REDSTEEL.Learn.Effect.vstrebaniKrve" }, { t: "text", key: "REDSTEEL.Learn.Effect.utokACarovaniVJednomTahu" }], // II
    [{ t: "text", key: "REDSTEEL.Learn.Effect.soustredeni" }, { t: "text", key: "REDSTEEL.Learn.Effect.magickeObrneni" }], // III
    [{ t: "text", key: "REDSTEEL.Learn.Effect.krvavyUder" }], // IV
    [{ t: "text", key: "REDSTEEL.Learn.Effect.opatrneCarovani" }], // V
    [{ t: "text", key: "REDSTEEL.Learn.Effect.magickeMomentum" }], // VI
    [{ t: "text", key: "REDSTEEL.Learn.Effect.bojoveTestyRychlostiIniciativa3" }], // VII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.krvaceniSousedicichNepratelSePridavaDoZasoby" }], // VIII
    [{ t: "text", key: "REDSTEEL.Learn.Effect.opatrneCarovaniObrana10" }], // IX
    [{ t: "text", key: "REDSTEEL.Learn.Effect.skolaKrveObtiznost10" }, { t: "text", key: "REDSTEEL.Learn.Effect.zesileniKouzla" }], // X
  ],
  "skills.dreamwalker": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.dreamwalker.label", value: 85 }], // X
  ],
  "combatSkills.bloodManipulation": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 25 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 30 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 35 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 40 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 50 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 55 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 60 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 70 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.combatSkills.bloodManipulation.label", value: 85 }], // X
  ],
  "skills.meditation": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.meditation.label", value: 20 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.meditation.label", value: 30 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.meditation.label", value: 40 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.meditation.label", value: 50 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.meditation.label", value: 60 }, { t: "mod", label: "REDSTEEL.Learn.Stat.mindPoints", value: 1 }], // V
  ],
  "skills.mindBending": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.mindBending.label", value: 85 }], // X
  ],
  "skills.rituals": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.rituals.label", value: 85 }], // X
  ],
  "skills.augury": [
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 15 }], // I
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 25 }], // II
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 30 }], // III
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 35 }], // IV
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 45 }], // V
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 50 }], // VI
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 55 }], // VII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 65 }], // VIII
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 75 }], // IX
    [{ t: "pct", label: "REDSTEEL.Actor.Character.skills.augury.label", value: 85 }], // X
  ],
};
