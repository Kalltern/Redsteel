/* ===========================================================================
 * Specialisation node prices: what unlocking each star of a specialisation
 * costs in CP and/or SP, and what the book asks for beyond the tree's links.
 *
 * Source: "Pravidla pro ToS V12.1 (WIP).xlsx" → sheet "Specializace (WIP)", as
 * carried into each node's description ("15 CP; Tulák VII."). The trailing
 * comment on an entry is that book text. Generated once and HAND-MAINTAINED
 * from here on: the generator lives only in a session scratchpad, so edit the
 * entries directly.
 *
 * Rules (user rulings 2026-09-14):
 *  - A node costs CP, SP, or both (the Priest's blessings).
 *  - Spent is derived: every unlocked node of an ACTIVE specialisation counts,
 *    however it was unlocked, the same model as ranks and features.
 *  - The book's requirements block, like a rank's. `requires` holds only the
 *    clauses the tree does NOT already enforce: a clause naming an ancestor
 *    star ("Čarostřelec: Učedník" under the Apprentice star) is dropped, since
 *    the tree's own link blocks it anyway.
 *  - Two shapes cannot be checked and are GM advisories that never block:
 *      masterFeature  "Alchemie: Mistr" and the like: the pack has no Master
 *                     features
 *      specScore      "Kontramág 6" / "Kontramág 18": the book does not say
 *                     what the number counts
 *
 * Clause shapes are the rank table's (progression.mjs), plus the two above.
 * ======================================================================== */

const rank = (group, key, min) => ({ t: "rank", group, key, min });

/** One node's price: CP, SP, and the book clauses the tree does not cover. */
const node = (cp, sp = 0, requires = []) => ({ cp, sp, requires });

/**
 * Magic Blood (Magická krev): "Usměrňování se počítá jako Manipulace s krví pro
 * požadavky". A School of Blood rank asking for Blood Manipulation N is also met
 * by Channeling N while the node is held (it comes with the specialisation).
 */
const magicBloodChanneling = (min) => ({
  t: "allOf",
  options: [
    { t: "specNode", spec: "bloodSchool", node: "magickaKrev" },
    rank("combatSkills", "channeling", min),
  ],
});

export const SPEC_NODE_PRICES = {
  shadow: {
    sneakAttack: node(15, 0, [rank("doctrines", "rogue", 7)]), // Tulák VII
    critAsSneak: node(10, 0, [rank("doctrines", "rogue", 8)]), // Tulák VIII
    outnumberSneak: node(20, 0, [rank("doctrines", "rogue", 10)]), // Tulák X
    bleed1: node(5),
    bleed2: node(5),
    bleed3: node(5),
    calculation: node(5),
    aimedAttack: node(10),
    stealthAdvantage: node(0, 5, [{ t: "feature", name: "Adept: Stealth" }]), // Plížení: Adept
    stealthCritFail: node(0, 10),
    bane1: node(5),
    bane2: node(5),
    bane3: node(5),
    quickFeet: node(10),
    backDodge: node(10),
    weakSpotMastery: node(20, 0, [rank("doctrines", "rogue", 7)]), // Tulák VII
    speedTests: node(10, 0, [rank("doctrines", "rogue", 7)]), // Tulák VII
    daggerDefense: node(0),
    skillDiscount1: node(0),
    skillDiscount2: node(0),
  },
  swordServant: {
    bleedA: node(5),
    critHitDef: node(5),
    bleedB: node(5),
    initiative: node(5),
    hitBonus: node(5),
    ripostaFree: node(10, 0, [rank("doctrines", "swordsman", 10)]), // Šermíř X
    ripostaStamina: node(15),
    ripostaCrit: node(10, 0, [rank("weaponSkills", "swords", 10)]), // Meče X
    odvetnyUder: node(10, 0, [rank("weaponSkills", "swords", 4)]), // Meče IV
    improvedAim: node(5),
    aimReduction: node(5),
    draciSpanek: node(10, 0, [rank("doctrines", "swordsman", 4)]), // Šermíř IV
    draciStraz: node(10, 0, [rank("doctrines", "swordsman", 5)]), // Šermíř V
    chargeDamage: node(10, 0, [rank("weaponSkills", "swords", 7)]), // Meče VII
    chargeDistance: node(10, 0, [rank("weaponSkills", "swords", 8)]), // Meče VIII
    priskok: node(5, 0, [rank("weaponSkills", "swords", 4)]), // Meče IV
    draciVypad: node(10, 0, [rank("doctrines", "swordsman", 4)]), // Šermíř IV
    prosmyknuti: node(5, 0, [rank("weaponSkills", "swords", 4)]), // Meče IV
    dexTests: node(5),
    presneRozseknuti: node(0),
    vyhodnyManevr: node(5, 0, [rank("doctrines", "swordsman", 5)]), // Šermíř V
    utokSPohybem: node(10, 0, [rank("weaponSkills", "swords", 4)]), // Meče IV
    vylUtokSPohybem: node(10, 0, [rank("doctrines", "swordsman", 7)]), // Šermíř VII
  },
  weaponMaster: {
    mistrZbrani: node(0),
    vytrvalyValecnik: node(15, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5), rank("weaponSkills", "polearms", 5)] }]), // M/T/S/D V
    vycvikSeZbrani: node(0, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 6), rank("weaponSkills", "blunt", 6), rank("weaponSkills", "axes", 6), rank("weaponSkills", "polearms", 6)] }]), // M/T/S/D VI
    bdelyOchrance: node(25, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 8), rank("weaponSkills", "blunt", 8), rank("weaponSkills", "axes", 8), rank("weaponSkills", "polearms", 8)] }]), // M/T/S/D VIII
    zbrojnos1: node(10),
    zbrojnos2: node(10),
    odrazeni: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 6), rank("weaponSkills", "blunt", 6), rank("weaponSkills", "axes", 6), rank("weaponSkills", "polearms", 6)] }]), // M/T/S/D VI
    veteran1: node(5),
    veteran2: node(5, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5), rank("weaponSkills", "polearms", 5)] }]), // M/T/S/D V
    vylZbranoveDovednosti: node(15, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 8), rank("weaponSkills", "blunt", 8), rank("weaponSkills", "axes", 8), rank("weaponSkills", "polearms", 8)] }]), // M/T/S/D VIII
    bleedStun: node(10),
    critDefRange: node(5),
    precision: node(10),
    penetration: node(5),
    presileni: node(5),
    rychlaReakce: node(5, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5), rank("weaponSkills", "polearms", 5)] }]), // M/T/S/D V
    weakSpotPen: node(5),
    primaryDamage: node(10),
  },
  hoplite: {
    nabodnuti: node(5),
    velkeTvory: node(10),
    prilezitostnyUtok: node(15, 0, [rank("doctrines", "shieldbearer", 5)]), // Štítonoš V
    pripravnyPostoj: node(10, 0, [rank("weaponSkills", "polearms", 4)]), // Dřevcová IV
    obranaProtiZteci: node(5, 0, [rank("doctrines", "shieldbearer", 6)]), // Štítonoš VI
    bleedStun: node(15),
    kritZasah: node(5),
    momentum: node(15, 0, [rank("doctrines", "shieldbearer", 8)]), // Štítonoš VIII
    postup: node(5),
    raznyPostup: node(10, 0, [rank("doctrines", "shieldbearer", 4)]), // Štítonoš IV
    napor1: node(15, 0, [rank("doctrines", "shieldbearer", 5)]), // Štítonoš V
    napor2: node(15, 0, [rank("doctrines", "shieldbearer", 6)]), // Štítonoš VI
    hoplitaStance: node(0),
    damage1d6: node(5, 0, [rank("weaponSkills", "polearms", 5)]), // Dřevcové V
    troufalyVrh: node(15, 0, [rank("weaponSkills", "polearms", 7)]), // Dřevcové VII
    penetration2: node(5),
    hexAttack: node(10, 0, [rank("weaponSkills", "polearms", 5)]), // Dřevcové V
    silaObratnost: node(10, 0, [rank("doctrines", "shieldbearer", 10), rank("weaponSkills", "polearms", 10)]), // Štítonoš X, Dřevcové X
  },
  swordDancer: {
    duelistuvPostoj: node(5),
    krvaveBodnuti: node(5),
    mireniRedukce: node(10, 0, [rank("doctrines", "duelist", 5)]), // Duelista V
    vyhodnyManevr: node(15, 0, [rank("doctrines", "duelist", 7)]), // Duelista VII
    posileniObrany: node(10, 0, [rank("doctrines", "duelist", 8)]), // Duelista VIII
    postojMireni: node(10, 0, [rank("doctrines", "duelist", 9)]), // Duelista IX
    precision10: node(10, 0, [rank("weaponSkills", "swords", 10)]), // Meče X
    oddechMireni: node(15, 0, [rank("weaponSkills", "swords", 5)]), // Meče V
    akrobatickeOdpoutani: node(15, 0, [rank("weaponSkills", "swords", 6)]), // Meče VI
    vylUtokSPohybem: node(10, 0, [rank("doctrines", "duelist", 7)]), // Duelista VII
    rafinovanyManevr: node(15, 0, [rank("doctrines", "duelist", 9)]), // Duelista IX
    posledniVypad: node(20, 0, [rank("doctrines", "duelist", 6), rank("weaponSkills", "swords", 6)]), // Duelista VI, Meče VI
    vylDuelistuvKrok: node(15, 0, [rank("doctrines", "duelist", 7)]), // Duelista VII
    brilantniProtiutok: node(15, 0, [rank("doctrines", "duelist", 10)]), // Duelista X
  },
  bloodSchool: {
    apprentice: node(5),
    spellPower1: node(10),
    expert: node(20, 0, [{ t: "anyOf", options: [rank("combatSkills", "bloodManipulation", 5), rank("doctrines", "cordinas", 5), magicBloodChanneling(5)] }]), // MsK/D:C V
    spellPower2: node(10),
    master: node(25, 0, [{ t: "anyOf", options: [rank("combatSkills", "bloodManipulation", 7), rank("doctrines", "cordinas", 7), magicBloodChanneling(7)] }]), // MsK/D:C VII
    spellPower3: node(10),
    grandmaster: node(30, 0, [{ t: "anyOf", options: [rank("combatSkills", "bloodManipulation", 9), rank("doctrines", "cordinas", 9), magicBloodChanneling(9)] }]), // MsK/D:C IX
    spellPower4: node(15), // Škola Krve - Velmistr
    bloodPool1: node(10, 0, [{ t: "specNode", spec: "bloodSchool", node: "expert" }]), // Škola Krve - Expert
    bloodPool2: node(10, 0, [{ t: "specNode", spec: "bloodSchool", node: "master" }]), // Škola Krve - Mistr
    magickaKrev: node(0),
    krvavyPakt: node(5, 0, [{ t: "specNode", spec: "bloodSchool", node: "apprentice" }]), // Škola Krve - Učedník
    precision15: node(5, 0, [{ t: "specNode", spec: "bloodSchool", node: "expert" }]), // Škola Krve - Expert
    hnevKrve: node(10, 0, [{ t: "specNode", spec: "bloodSchool", node: "expert" }]), // Škola Krve - Expert
    krvavaPlatba: node(10, 0, [{ t: "specNode", spec: "bloodSchool", node: "expert" }]), // Škola Krve - Expert
    kritRozsah2: node(0, 5),
    oslabeniTrvani: node(5, 0, [{ t: "specNode", spec: "bloodSchool", node: "expert" }]), // Škola Krve - Expert
    krvavyStit: node(15, 0, [{ t: "specNode", spec: "bloodSchool", node: "expert" }]), // Škola Krve - Expert
    darKrve: node(20, 0, [{ t: "specNode", spec: "bloodSchool", node: "master" }]), // Škola Krve - Mistr
  },
  berserk: {
    zbesilost: node(0),
    imunitaPanika: node(10),
    obnovaVydrze: node(10),
    nezastavitelny: node(15, 0, [{ t: "anyRank", group: "doctrines", min: 4 }]), // Doktrína IV
    mentalniOdolnost: node(5),
    divokyVypad: node(10),
    pevnaVule: node(10, 0, [{ t: "anyRank", group: "doctrines", min: 6 }]), // Doktrína VI
    zbesilyUtokPostih: node(15, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5), rank("weaponSkills", "polearms", 5)] }]), // M/S/T/D V
    zbesilyUtokVyhoda: node(15, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 10), rank("weaponSkills", "blunt", 10), rank("weaponSkills", "axes", 10), rank("weaponSkills", "polearms", 10)] }]), // M/S/T/D X
    zurivyUder: node(20, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 6), rank("weaponSkills", "blunt", 6), rank("weaponSkills", "axes", 6), rank("weaponSkills", "polearms", 6)] }]), // M/S/T/D VI
    zurivyUderZasah: node(5),
    zurivaNezdolnost: node(20, 0, [{ t: "anyRank", group: "doctrines", min: 5 }]), // Doktrína V
    odolnostStun: node(5),
    desiveVzezreni: node(5, 0, [rank("skills", "intimidation", 1)]), // Zastrašování I
    masakr1: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 8), rank("weaponSkills", "blunt", 8), rank("weaponSkills", "axes", 8), rank("weaponSkills", "polearms", 8)] }]), // M/S/T/D VIII
    masakr2: node(5),
    rychlaLecba: node(0, 15),
    zivotyVydrz: node(10),
    primarniZraneni: node(10),
  },
  spellslinger: {
    ucednik: node(0),
    expert: node(15, 0, [{ t: "anyRank", group: "doctrines", min: 5 }]), // Doktrína V
    mistr: node(15, 0, [{ t: "anyRank", group: "doctrines", min: 10 }]), // Doktrína X
    salamander: node(5), // Čarostřelec: Učedník
    salamander2: node(5), // Čarostřelec: Expert
    salamander3: node(5), // Čarostřelec: Mistr
    zabak: node(5), // Čarostřelec: Učedník
    zabak2: node(5), // Čarostřelec: Expert
    zabak3: node(5), // Čarostřelec: Mistr
    jiskra: node(5), // Čarostřelec: Učedník
    jiskra2: node(5), // Čarostřelec: Expert
    jiskra3: node(5), // Čarostřelec: Mistr
    harpuna: node(5), // Čarostřelec: Učedník
    harpuna2: node(5), // Čarostřelec: Expert
    harpuna3: node(5), // Čarostřelec: Mistr
    slepice: node(5), // Čarostřelec: Učedník
    slepice2: node(5), // Čarostřelec: Expert
    slepice3: node(5), // Čarostřelec: Mistr
    termit: node(5), // Čarostřelec: Učedník
    termit2: node(5), // Čarostřelec: Expert
    termit3: node(5), // Čarostřelec: Mistr
    svetluska: node(5), // Čarostřelec: Expert
    svetluska2: node(5), // Čarostřelec: Mistr
    jezek: node(5), // Čarostřelec: Expert
    netopyr: node(5), // Čarostřelec: Expert
    netopyr2: node(5), // Čarostřelec: Mistr
    beran: node(5), // Čarostřelec: Expert
    beran2: node(5), // Čarostřelec: Mistr
    inkvizitor: node(5), // Čarostřelec: Expert
    intZraneni: node(5), // Čarostřelec: Expert
    polarka: node(5), // Čarostřelec: Mistr
    posel: node(5), // Čarostřelec: Mistr
    sokol: node(5), // Čarostřelec: Mistr
  },
  elementalist: {
    familiar: node(0),
    magickyPomocnik: node(5, 0, [rank("doctrines", "elementalist", 5)]), // Elementalista V
    dar1a: node(5, 0, [rank("doctrines", "elementalist", 1)]), // Elementalista I
    dar2a: node(10, 0, [rank("doctrines", "elementalist", 2)]), // Elementalista II
    dar1b: node(10, 0, [rank("doctrines", "elementalist", 3)]), // Elementalista III
    dar2b: node(15, 0, [rank("doctrines", "elementalist", 4)]), // Elementalista IV
    dar3a: node(20, 0, [rank("doctrines", "elementalist", 5)]), // Elementalista V
    dar4: node(15, 0, [rank("doctrines", "elementalist", 6)]), // Elementalista VI
    dar2c: node(15, 0, [rank("doctrines", "elementalist", 7)]), // Elementalista VII
    dar1c: node(10, 0, [rank("doctrines", "elementalist", 7)]), // Elementalista VII
    dar2d: node(15, 0, [rank("doctrines", "elementalist", 8)]), // Elementalista VIII
    dar5: node(20, 0, [rank("doctrines", "elementalist", 9)]), // Elementalista IX
    dar3b: node(20, 0, [rank("doctrines", "elementalist", 10)]), // Elementalista X
    znalosti: node(0, 5, [rank("doctrines", "elementalist", 1)]), // Elementalista I
    vznesenaObet: node(0, 10, [rank("doctrines", "elementalist", 4)]), // Elementalista IV
    privolaniFamiliara: node(0, 10, [rank("doctrines", "elementalist", 4)]), // Elementalista IV
  },
  elymas: {
    magProtiutok: node(10, 0, [{ t: "anyRank", group: "schools", min: 4 }]), // Škola IV
    mpExpert: node(10, 0, [{ t: "anyRank", group: "schools", min: 6 }]), // Škola VI
    mpUtok10: node(5),
    mpVolnaAkce: node(10, 0, [rank("doctrines", "elymas", 5)]), // Elymas V
    mpKritNeuspech: node(5),
    mpMistr: node(10, 0, [{ t: "anyRank", group: "schools", min: 9 }]), // Škola IX
    soustredenaObrana: node(10),
    soKrit: node(5),
    soReakce: node(5),
    soRedukce: node(10, 0, [rank("doctrines", "elymas", 5)]), // Elymas V
    magObranaMana: node(5),
    opakovaniUsmernovani: node(5),
    rozsahObrany: node(5),
    magickaOzvena: node(5, 0, [rank("doctrines", "elymas", 5)]), // Elymas V
    modifikatorMany: node(10, 0, [rank("doctrines", "elymas", 10)]), // Elymas X
  },
  skirmisher: {
    harcovnikuvUm: node(10),
    kryciPostoj: node(5, 0, [rank("doctrines", "shieldbearer", 2)]), // Štítonoš II
    odvetnyVrh: node(10, 0, [rank("doctrines", "shieldbearer", 5)]), // Štítonoš V
    navazujiciVrh: node(10),
    vrh5: node(10, 0, [rank("doctrines", "shieldbearer", 10)]), // Štítonoš X
    prezbrojeni: node(5),
    mireniPohyb: node(5),
    oddechMireni: node(10),
    mireniPoVrhu: node(10, 0, [rank("doctrines", "shieldbearer", 4)]), // Štítonoš IV
    pohybPoVrhu: node(10),
    presnyVystrel: node(10, 0, [rank("doctrines", "shieldbearer", 8)]), // Štítonoš VIII
    lehkaZbroj: node(5),
    bleedStun: node(10),
    kritRozsah: node(5),
    kritKryt: node(5),
    zmrzacujiciVystrel: node(10, 0, [rank("doctrines", "shieldbearer", 6)]), // Štítonoš VI
    vylZmrzacujici: node(10, 0, [rank("doctrines", "shieldbearer", 8)]), // Štítonoš VIII
    vrhSRozbehem: node(5, 0, [rank("doctrines", "shieldbearer", 4)]), // Štítonoš IV
    utokSPohybem: node(10, 0, [rank("doctrines", "shieldbearer", 4)]), // Štítonoš IV
    zbesilyVrh: node(5, 0, [rank("doctrines", "shieldbearer", 5)]), // Štítonoš V
  },
  ranger: {
    ucednik: node(0),
    zast: node(10, 0, [rank("combatSkills", "ranger", 2)]), // Hraničář II
    lovcuvVystrel: node(10),
    expert: node(15, 0, [rank("combatSkills", "ranger", 5)]), // Hraničář V
    utokDravce: node(15, 0, [rank("combatSkills", "ranger", 8)]), // Hraničář VIII
    dorazeni: node(15),
    mistr: node(5, 0, [rank("combatSkills", "ranger", 10), { t: "anyRank", group: "doctrines", min: 10 }]), // Hraničář a Doktrína X
    metlaPrubojnost: node(5, 0, [rank("combatSkills", "ranger", 4)]), // Hraničář IV
    metlaKritRozsah: node(5),
    odhaleniSlabiny: node(15, 0, [rank("skills", "survival", 3)]), // Přežití III
    metlaKritObrana: node(5),
    metlaKritZasah: node(5),
    metlaOvereni: node(10),
    metlaKritZraneni: node(10),
    bane1: node(5),
    bane2: node(5),
    bane3: node(5),
    vnimaniStopovani: node(0, 10, [rank("skills", "survival", 2)]), // Přežití II
    dravciSmysly: node(10),
    pohybVPrirode: node(0, 5, [rank("skills", "stealth", 4)]), // Plížení IV
    slevaPlizeni: node(0),
    slevaPreziti: node(0),
    slevaRanhojicstvi: node(0),
    prezbrojeni: node(5),
    vylPrezbrojeni: node(10),
  },
  incantator: {
    ohniskovyPredmet: node(5),
    soustredeni: node(5),
    rychleSoustredeni: node(10, 0, [rank("doctrines", "incantator", 5)]), // Incantator V
    precizniInkantace: node(15, 0, [rank("doctrines", "incantator", 5)]), // Incantator V
    moudraKniha: node(5),
    vlnaEnergie: node(10, 0, [rank("doctrines", "incantator", 4)]), // Incantator IV
    dvojnasobnaMana: node(0),
    stabilizaceZdroje: node(15),
    katalyzator: node(10),
    dlouhyOdpocinek: node(15, 0, [rank("doctrines", "incantator", 10)]), // Incantator X
    modifikatorMany: node(15, 0, [rank("doctrines", "incantator", 10)]), // Incantator X
  },
  sharpshooter: {
    mireniPomalyPohyb: node(5),
    zmenaCile: node(5, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 5), rank("doctrines", "arbalest", 5)] }]), // Lukostřelec/Kušník V
    zacileni: node(10),
    redukceMireni: node(5),
    mireniPoMinuti: node(5),
    zmrzacujiciVystrel: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 7), rank("doctrines", "arbalest", 7)] }]), // Lukostřelec/Kušník VII
    bleed1: node(5),
    bleed2: node(5),
    bleed3: node(5),
    presnyVystrel: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 7), rank("doctrines", "arbalest", 7)] }]), // Lukostřelec/Kušník VII
    strazStrelba: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 8), rank("doctrines", "arbalest", 8)] }]), // Lukostřelec/Kušník VIII
    streleckyPostoj: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 10), rank("doctrines", "arbalest", 10)] }]), // Lukostřelec/Kušník X
    ignorujeKryt: node(5, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 10), rank("doctrines", "arbalest", 10)] }]), // Lukostřelec/Kušník X
    strelba5: node(10),
    iniciativa2: node(5),
    mireniOvereni: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 6), rank("doctrines", "arbalest", 6)] }]), // Lukostřelec/Kušník VI
    pozadavkyLuku: node(5),
    oddechMireni: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 5), rank("doctrines", "arbalest", 5)] }]), // Lukostřelec/Kušník V
    odvetnyVystrel: node(20, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 8), rank("doctrines", "arbalest", 8)] }]), // Lukostřelec/Kušník VIII
    tesnyZasah: node(5),
    kritRozsah: node(5),
    prubojnost2: node(5),
    primarniZraneni: node(10),
    kryt10: node(5, 0, [{ t: "anyOf", options: [rank("doctrines", "archer", 6), rank("doctrines", "arbalest", 6)] }]), // Lukostřelec/Kušník VI
  },
  vanguard: {
    ztecPohyb50: node(5),
    ztecZraneniHexa: node(10),
    ztecPohyb100: node(5, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 4), rank("weaponSkills", "blunt", 4), rank("weaponSkills", "axes", 4), rank("weaponSkills", "polearms", 4)] }]), // M/T/S/D IV
    rozrazeni: node(10),
    zatlaceni: node(10),
    ztecSRozseknutim: node(15, 0, [{ t: "anyOf", options: [rank("doctrines", "pikeman", 5), rank("doctrines", "reaver", 5), rank("doctrines", "swordsman", 5)] }]), // P/P/Š V
    momentumVydrz: node(5, 0, [{ t: "anyOf", options: [rank("doctrines", "pikeman", 10), rank("doctrines", "reaver", 10), rank("doctrines", "swordsman", 10)] }]), // P/P/Š X
    momentumSpecialni: node(20, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 10), rank("weaponSkills", "blunt", 10), rank("weaponSkills", "axes", 10), rank("weaponSkills", "polearms", 10)] }]), // M/T/S/D X
    opakovaniUtoku: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "pikeman", 5), rank("doctrines", "reaver", 5), rank("doctrines", "swordsman", 5)] }]), // P/P/Š V
    presilaPostih: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5), rank("weaponSkills", "polearms", 5)] }]), // M/T/S/D V
    triumf: node(15, 0, [{ t: "anyOf", options: [rank("doctrines", "pikeman", 10), rank("doctrines", "reaver", 10), rank("doctrines", "swordsman", 10)] }]), // P/P/Š X
    prubojnost2: node(5),
    rozseknutiCil: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "pikeman", 5), rank("doctrines", "reaver", 5), rank("doctrines", "swordsman", 5)] }]), // P/P/Š V
    rozseknutiZasah: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "pikeman", 7), rank("doctrines", "reaver", 7), rank("doctrines", "swordsman", 7)] }]), // P/P/Š VII
    bojoveTestySily: node(5),
    opakovaniTestuSily: node(10),
    zbrojeRychlost: node(10),
    ocelovyStisk: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5), rank("weaponSkills", "polearms", 5)] }]), // M/T/S/D V
  },
  warden: {
    kritObranaKryt: node(5),
    redukceBoku: node(5, 0, [rank("doctrines", "shieldbearer", 5)]), // Štítonoš V
    zatizeniStitu: node(5),
    spolehlivyStit1: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5), rank("weaponSkills", "polearms", 5)] }]), // M/T/S/D V
    spolehlivyStit2: node(15, 0, [rank("doctrines", "shieldbearer", 10)]), // Štítonoš X
    uderStitemOdveta: node(10, 0, [rank("doctrines", "shieldbearer", 6)]), // Štítonoš VI
    uderZraneniA: node(10),
    uderZraneniSila: node(10, 0, [rank("doctrines", "shieldbearer", 4)]), // Štítonoš IV
    bonusZaStit: node(10),
    uderZraneniB: node(10, 0, [rank("doctrines", "shieldbearer", 6)]), // Štítonoš VI
    uderSila10: node(10),
    dvojityUder: node(10, 0, [rank("doctrines", "shieldbearer", 8)]), // Štítonoš VIII
    obrannyPostojSpojenci: node(5),
    vylObrannyPostoj: node(10, 0, [rank("doctrines", "shieldbearer", 6)]), // Štítonoš VI
    ochranaVolna: node(20, 0, [rank("doctrines", "shieldbearer", 8)]), // Štítonoš VIII
    protiutokZasah: node(15, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 10), rank("weaponSkills", "blunt", 10), rank("weaponSkills", "axes", 10), rank("weaponSkills", "polearms", 10)] }]), // M/T/S/D X
    vylObrneni: node(20, 0, [rank("doctrines", "shieldbearer", 10)]), // Štítonoš X
  },
  champion: {
    stredniZbran: node(5),
    bonusDruhaZbran1: node(5),
    bonusDruhaZbran2: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5)] }]), // M/T/S V
    bonusDruhaZbran3: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 7), rank("weaponSkills", "blunt", 7), rank("weaponSkills", "axes", 7)] }]), // M/T/S VII
    smrstUtoku: node(15, 0, [{ t: "anyOf", options: [rank("doctrines", "dimakerus", 5), rank("doctrines", "monk", 5)] }]), // D/M V
    uhyb5: node(10),
    zatlaceni: node(10),
    utokPoZteci: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5)] }]), // M/T/S V
    presilaPostih: node(10, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5)] }]), // M/T/S V
    vylUtokSPohybem: node(10, 0, [{ t: "anyOf", options: [rank("doctrines", "dimakerus", 8), rank("doctrines", "monk", 8)] }]), // D/M VIII
    vetrnyPostoj: node(15, 0, [{ t: "anyOf", options: [rank("doctrines", "dimakerus", 7), rank("doctrines", "monk", 7)] }]), // D/M VII
    ztecSRozseknutim: node(15, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 5), rank("weaponSkills", "blunt", 5), rank("weaponSkills", "axes", 5)] }]), // M/T/S V
    odvetnyUder: node(15, 0, [{ t: "anyOf", options: [rank("doctrines", "dimakerus", 5), rank("doctrines", "monk", 5)] }]), // D/M V
    klamavyUtok: node(15, 0, [{ t: "anyOf", options: [rank("doctrines", "dimakerus", 10), rank("doctrines", "monk", 10)] }]), // D/M X
    riposta: node(25, 0, [{ t: "anyOf", options: [rank("weaponSkills", "swords", 10), rank("weaponSkills", "blunt", 10), rank("weaponSkills", "axes", 10)] }]), // M/T/S X
  },
  veneficus: {
    lindar: node(0),
    navazujiciKouzlo: node(5),
    postihZbroje: node(5),
    magickyVeteran: node(5),
    slevaMany: node(5, 0, [rank("doctrines", "veneficus", 5)]), // Veneficus V
    magickeKz: node(5),
    soubojZaManu: node(5, 0, [rank("doctrines", "veneficus", 7)]), // Veneficus VII
    lindaruvVypad1: node(10, 0, [{ t: "anyRank", group: "schools", min: 6 }]), // Škola VI
    lindaruvVypad2: node(10, 0, [rank("doctrines", "veneficus", 5)]), // Veneficus V
    usmernovani5: node(0, 0, [rank("doctrines", "veneficus", 10)]), // Veneficus X
    magickaZbran: node(10, 0, [rank("doctrines", "veneficus", 5)]), // Veneficus V
    magickePosileni: node(10),
    modifikatorMany: node(15, 0, [rank("doctrines", "veneficus", 10)]), // Veneficus X
    magickeMireni: node(10),
    mireniObtiznost: node(0, 0, [rank("doctrines", "veneficus", 7)]), // Veneficus VII
    magickeMomentum: node(15),
    lindarovyUdery: node(5, 0, [rank("doctrines", "veneficus", 4)]), // Veneficus IV
  },
  alchemist: {
    lecZastaveni1: node(0, 5),
    lecZivoty1: node(0, 5),
    lecZastaveni2: node(0, 10, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    lecZivoty2: node(0, 10),
    lekToxicita: node(0, 10),
    kombinaceLektvaru: node(0, 20, [{ t: "masterFeature", skill: "alchemy" }]), // Alchemie: Mistr
    lekTrvani: node(0, 5),
    lekDuplikace1: node(0, 10, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    lekDuplikace2: node(0, 5),
    lekDuplikace3: node(0, 10),
    lekVyhoda: node(0, 5),
    lekKritNeuspech: node(0, 5),
    jedSance1: node(0, 5),
    jedZraneni1: node(0, 5),
    jedSance2: node(0, 5, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    jedZraneni2: node(0, 10),
    jedSance3: node(0, 10),
    kombinaceJedu: node(0, 20, [{ t: "masterFeature", skill: "alchemy" }]), // Alchemie: Mistr
    jedTrvani: node(0, 5),
    jedDuplikace1: node(0, 5, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    jedDuplikace2: node(0, 5),
    jedDuplikace3: node(0, 5),
    jedVyhoda: node(0, 5),
    jedKritNeuspech: node(0, 5),
    petTrvani: node(0, 5),
    traskavice: node(0, 5, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    acidum: node(0, 10),
    ignum: node(0, 5),
    draciSen: node(0, 10, [{ t: "masterFeature", skill: "alchemy" }]), // Alchemie: Mistr
    pavouciObjeti: node(0, 5),
    dablovaPecka: node(0, 20),
    petDuplikace1: node(0, 10, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    petDuplikace2: node(0, 5),
    petDuplikace3: node(0, 10),
    petVyhoda: node(0, 5),
    petKritNeuspech: node(0, 5),
    olejDuplikace1: node(0, 5, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    olejDuplikace2: node(0, 5),
    olejDuplikace3: node(0, 5),
    olejZraneni1: node(0, 5),
    olejZranitelnost: node(0, 10, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    olejZraneni2: node(0, 10),
    olejVyhoda: node(0, 5),
    olejKritNeuspech: node(0, 5),
    sleva1: node(0),
    sleva2: node(0),
    mastTrvani: node(0, 5),
    mastDuplikace1: node(0, 5),
    mastDuplikace2: node(0, 5),
    mastDuplikace3: node(0, 5),
    mastVyhoda: node(0, 5),
    mastKritNeuspech: node(0, 5),
    drogaDuplikace1: node(0, 5, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    drogaDuplikace2: node(0, 5),
    drogaDuplikace3: node(0, 5),
    drogaNavykovostPlus: node(0, 10),
    drogaNavykovostMinus: node(0, 10),
    garantovanyUspech: node(0, 10),
    meneIngredienci: node(0, 15, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    meneTkane: node(0, 10, [{ t: "feature", name: "Expert: Alchemy" }]), // Alchemie: Expert
    vedeniMutace: node(0, 10),
    drogaVyhoda: node(0, 5),
    drogaKritNeuspech: node(0, 5),
  },
  astramancer: {
    ucednik: node(5),
    expert: node(5, 0, [rank("schools", "air", 6)]), // Škola Vzduchu VI
    mistr: node(5, 0, [rank("schools", "air", 8)]), // Škola Vzduchu VIII
    velmistr: node(5, 0, [rank("schools", "air", 10)]), // Škola Vzduchu X
    stunResist: node(0, 15),
    bleskovaOdolnost: node(10), // Astramancer: Mistr
    bleskovySok: node(15), // Astramancer: Expert
    omraceniKrit: node(5),
    padPirka: node(0, 5), // Astramancer: Expert
    kulovyBlesk: node(5), // Astramancer: Mistr
    retezovyBlesk: node(5), // Astramancer: Mistr
    overeni: node(5), // Astramancer: Expert
    retezeni: node(10), // Astramancer: Učedník
    dvojiteRetezeni: node(15), // Astramancer: Velmistr
    bleskoveTornado: node(5), // Astramancer: Mistr
    kritRozsah: node(0, 5),
    cyklonPohyb: node(0, 15), // Astramancer: Expert
  },
  bard: {
    inspiracePisne: node(0),
    magUtokObrana1: node(2),
    inspirace3a: node(6),
    magUtokObrana2: node(2), // Bard: Expert
    inspirace3b: node(6),
    magUtokObrana3: node(2), // Bard: Mistr
    inspirace3c: node(6),
    bardUcednik: node(5), // Písně
    silaMelodie2: node(6),
    bardExpert: node(20, 0, [rank("skills", "music", 6)]), // Hudba VI
    silaMelodie3: node(9),
    bardMistr: node(30, 0, [rank("skills", "music", 8)]), // Hudba VIII
    silaMelodie1: node(6, 0, [{ t: "masterFeature", skill: "music" }]), // Hudba: Mistr
    bardskaOdolnost: node(0), // Písně
    sylvanskaPohotovost: node(5),
    bardskaObrana: node(5), // Bard: Mistr
    sylvanskyOdpocinek1: node(0, 10),
    sylvanskyOdpocinek2: node(0, 10, [rank("skills", "music", 5)]), // Hudba V
    sylvanskyOdpocinek3: node(0, 15, [rank("skills", "music", 7)]), // Hudba VII
    dvur1: node(0), // Bard: Učedník
    dvur2: node(5),
    dvur3: node(10), // Bard: Expert
    dvur4: node(10), // Bard: Mistr
    slovaMoci: node(15), // Bard: Expert
    tanecVyhoda: node(0, 5, [rank("skills", "dancing", 1)]), // Tanec I
    umtvorbaVyhoda: node(0, 5, [{ t: "feature", name: "Adept: Art" }]), // Umělecká tvorba: Adept
    umtvorbaKritNeuspech: node(0, 5, [{ t: "feature", name: "Expert: Art" }]), // Umělecká tvorba: Expert
    umtvorbaKrit: node(0, 5, [{ t: "masterFeature", skill: "art" }]), // Umělecká tvorba: Mistr
    slevaUmtvorba: node(0),
    pokouseni5: node(0, 5),
    klamani5: node(0, 5),
    hudbaVyhoda: node(0, 5, [{ t: "feature", name: "Adept: Music" }]), // Hudba: Adept
    hudbaKritNeuspech: node(0, 10, [{ t: "masterFeature", skill: "music" }]), // Hudba: Mistr
    herectviVyhoda: node(0, 5, [{ t: "feature", name: "Adept: Acting" }]), // Herectví: Adept
    herectviKritNeuspech: node(0, 10),
    presvedcovani5: node(0, 5),
    sleva1: node(0),
    sleva2: node(0),
    sleva3: node(0),
    sleva4: node(0),
  },
  cryomancer: {
    ucednik: node(5),
    expert: node(5, 0, [rank("schools", "water", 6)]), // Škola Vody VI
    mistr: node(5, 0, [rank("schools", "water", 8)]), // Škola Vody VIII
    velmistr: node(5, 0, [rank("schools", "water", 10)]), // Škola Vody X
    ledoveUlomky: node(10), // Cryomancer: Expert
    ledoveKopi: node(5), // Cryomancer: Mistr
    freezeResist: node(0, 15),
    imunitaZpomaleni: node(0, 20), // Cryomancer: Mistr
    kritRozsah: node(0, 5),
    overeni: node(5), // Cryomancer: Expert
    zmrazeniKrit: node(5), // Hluboký mráz I
    hlubokyMraz1: node(15), // Cryomancer: Expert
    hlubokyMraz2: node(15), // Cryomancer: Mistr
    hlubokyMraz3: node(15), // Cryomancer: Velmistr
    ostryLed: node(5), // Cryomancer: Expert
  },
  entomancer: {
    ucednik: node(5),
    expert: node(5, 0, [rank("schools", "earth", 6)]), // Škola Země VI
    mistr: node(5, 0, [rank("schools", "earth", 8)]), // Škola Země VIII
    velmistr: node(5, 0, [rank("schools", "earth", 10)]), // Škola Země X
    feromony: node(0, 5),
    jedovatyHmyz: node(0, 15), // Travič II
    jedResist1: node(0, 5),
    jedResist2: node(0, 5),
    leptavaKyselina1: node(5), // Entomancer: Expert
    leptavaKyselina2: node(10),
    protijed: node(0, 5), // Entomancer: Expert
    pavouciSplh: node(0, 10), // Entomancer: Expert
    travic1: node(10), // Entomancer: Učedník
    travic2: node(15), // Entomancer: Expert
    travic3: node(10),
    toxiny: node(15), // Entomancer: Mistr
    kyselinovaStrela: node(5), // Entomancer: Expert
    jedovaSprska: node(5), // Entomancer: Expert
  },
  geomancer: {
    ucednik: node(5),
    expert: node(5, 0, [rank("schools", "earth", 6)]), // Škola Země VI
    mistr: node(5, 0, [rank("schools", "earth", 8)]), // Škola Země VIII
    velmistr: node(5, 0, [rank("schools", "earth", 10)]), // Škola Země X
    kz2: node(0, 10), // Geomancer: Expert
    kritRozsah: node(0, 5),
    maskovani: node(0, 10), // Geomancer: Učedník
    regeneraceVydrze: node(5), // Geomancer: Expert
    kamennaKuze: node(5), // Geomancer: Expert
    kamennaZed: node(5), // Geomancer: Mistr
    overeni: node(5), // Geomancer: Expert
    povaleni: node(5),
    omracujiciRany1: node(15), // Geomancer: Expert
    omracujiciRany2: node(15), // Geomancer: Mistr
    omracujiciRany3: node(20), // Geomancer: Velmistr
    pevnyKrok: node(0, 25), // Geomancer: Mistr
    urhanovaSila: node(10), // Geomancer: Expert
  },
  gnostic: {
    adept: node(15),
    gsp1: node(10),
    mistr: node(25, 0, [{ t: "anyOf", options: [rank("doctrines", "elymas", 6), rank("doctrines", "incantator", 6), rank("doctrines", "veneficus", 6)] }]), // E/I/V VI
    gsp2: node(10),
    velmistr: node(35, 0, [{ t: "anyOf", options: [rank("doctrines", "elymas", 10), rank("doctrines", "incantator", 10), rank("doctrines", "veneficus", 10)] }]), // E/I/V X
    gsp3: node(5),
    zpomaleniZraneni1: node(10),
    zpomaleniZraneni2: node(15), // Gnostik: Mistr
    casovaDisonance: node(15), // Gnostik: Adept
    isadurovaTechnika: node(10), // Gnostik: Adept
    nekonecnaCesta: node(5), // Gnostik: Adept
    prostorovaKlec: node(0, 5), // Gnostik: Mistr
    meditaceMZ2: node(0, 5, [rank("skills", "meditation", 1)]), // Meditace I
    meditaceMZ3: node(0, 10),
    mzMeditace: node(0, 10),
    isaduruvKruh: node(5), // Gnostik: Mistr
    posunutiDezorientace: node(5), // Gnostik: Mistr
    overeni: node(5), // Gnostik: Adept
  },
  grimm: {
    bane1: node(5),
    bane2: node(5),
    bane3: node(5),
    bane4: node(5),
    bane5: node(5),
    bane6: node(5),
    bane7: node(5),
    metlaVnimani: node(0, 10, [rank("skills", "survival", 2)]), // Přežití II
    metlaIniciativa: node(10),
    metlaOpakovani: node(15),
    tkane1: node(0, 10, [rank("skills", "survival", 3)]), // Přežití III
    tkane2: node(0, 10),
  },
  illusionist: {
    ucednik: node(5),
    expert: node(5, 0, [rank("schools", "spirit", 6)]), // Škola Ducha VI
    mistr: node(5, 0, [rank("schools", "spirit", 8)]), // Škola Ducha VIII
    velmistr: node(5, 0, [rank("schools", "spirit", 10)]), // Škola Ducha X
    kapesniIluze: node(0, 5), // Iluzionista: Expert
    mysterinoOko: node(0, 10), // Iluzionista: Expert
    dokonalaIluze1: node(0, 5), // Iluzionista: Expert
    obtiznostPopreni1: node(0, 5),
    dokonalaIluze2: node(0, 10), // Iluzionista: Mistr
    dokonalaIluze3: node(0, 10),
    obtiznostPopreni2: node(0, 5), // Iluzionista: Velmistr
    prohlednutiIluzi: node(0, 5, [rank("skills", "arcana", 4)]), // Arcana IV
    malaIluzeZvuky: node(0), // Iluzionista: Expert
    mysterinKrok: node(5), // Iluzionista: Expert
    udrzovaneIluze: node(0, 10), // Iluzionista: Mistr
    duplikaceKouzla: node(5), // Iluzionista: Mistr
    mzitky: node(10), // Iluzionista: Mistr
    dvojnik: node(20), // Iluzionista: Velmistr
    skrytaMagie1: node(0, 15), // Iluzionista: Mistr
    skrytaMagie2: node(10), // Iluzionista: Velmistr
    mysterinStrazce: node(10), // Iluzionista: Velmistr
  },
  priest: {
    modlitba: node(0),
    testViry1: node(3),
    testViry2: node(3),
    testViry3: node(3, 0, [{ t: "secAttr", key: "fth", min: 5 }]), // Víra 5
    testViry4: node(3, 0, [{ t: "secAttr", key: "fth", min: 8 }]), // Víra 8
    testViry5: node(3),
    zazraky: node(0),
    novic: node(5),
    svataEnergie1: node(10, 0, [{ t: "secAttr", key: "fth", min: 4 }]), // Víra 4
    akolyta: node(20, 0, [{ t: "secAttr", key: "fth", min: 5 }]), // Víra 5
    svataEnergie2: node(15, 0, [{ t: "secAttr", key: "fth", min: 6 }]), // Víra 6
    klerik: node(40, 0, [{ t: "secAttr", key: "fth", min: 8 }]), // Víra 8
    svataEnergie3: node(20, 0, [{ t: "secAttr", key: "fth", min: 9 }]), // Víra 9
    pozehnani1a: node(5, 15),
    pozehnani1b: node(5, 15, [{ t: "secAttr", key: "fth", min: 4 }]), // Víra 4
    pozehnani2a: node(10, 30, [{ t: "secAttr", key: "fth", min: 5 }]), // Víra 5
    pozehnani1c: node(5, 15, [{ t: "secAttr", key: "fth", min: 6 }]), // Víra 6
    pozehnani2b: node(10, 30, [{ t: "secAttr", key: "fth", min: 7 }]), // Víra 7
    pozehnani3a: node(15, 40, [{ t: "secAttr", key: "fth", min: 8 }]), // Víra 8
    pozehnani3b: node(15, 40, [{ t: "secAttr", key: "fth", min: 10 }]), // Víra 10
    ranhojicstvi1d6: node(0, 10, [{ t: "feature", name: "Adept: First aid" }]), // Ranhojičství: Adept
    felcaruvDotek: node(0, 20, [{ t: "feature", name: "Expert: First Aid" }]), // Ranhojičství: Expert
    ranhojicstviVyhoda: node(0, 5, [{ t: "feature", name: "Adept: First aid" }]), // Ranhojičství: Adept
    ranhojicstviKritNeuspech: node(0, 10),
    presvedcovani3: node(0, 5),
    pastyrovaVule: node(0),
  },
  countermage: {
    ucednik: node(0),
    mz1: node(10),
    mz2: node(10),
    expert: node(25, 0, [{ t: "specScore", spec: "countermage", min: 6 }]), // Kontramág 6
    mz3: node(10),
    mz4: node(10),
    mistr: node(35, 0, [{ t: "specScore", spec: "countermage", min: 18 }]), // Kontramág 18
    meditace2: node(0, 5, [rank("skills", "meditation", 1)]), // Meditace I
    meditace3: node(0, 15),
    meditace4: node(0, 15), // Kontramág: Expert
    vynucenySouboj: node(0, 15, [rank("skills", "mindBending", 1)]), // Mentální souboj I
    soubojDemoni: node(0, 20, [rank("skills", "mindBending", 4)]), // Mentální souboj IV
    cistaMysl: node(0, 10),
    antimagickaZbran: node(5),
    bane1: node(5),
    magickyKryt: node(5),
    bane2: node(10),
    magickaImunita: node(10),
    odolnostMagii: node(15), // Kontramág: Mistr
    citiMagii: node(0, 10, [{ t: "feature", name: "Adept: Arcana" }]), // Arcana: Adept
    popreniIluze: node(0, 10),
    horlivost: node(10),
    nezlomnaMysl: node(0, 10), // Čistá mysl
    vhled5: node(0, 5),
    slevaArcana: node(0),
  },
  maleficarum: {
    ucednik: node(5),
    expert: node(5, 0, [rank("schools", "darkness", 6)]), // Škola Temnoty VI
    mistr: node(5, 0, [rank("schools", "darkness", 8)]), // Škola Temnoty VIII
    velmistr: node(5, 0, [rank("schools", "darkness", 10)]), // Škola Temnoty X
    vysaniDuse: node(0, 5), // Maleficarum: Expert
    kritRozsah: node(0, 5),
    stoparDusi: node(0, 5), // Maleficarum: Učedník
    drzitelDusi: node(0, 10),
    lapeniDuse: node(0, 5),
    poziracDusi: node(10), // Maleficarum: Mistr
    hraniceKorupce: node(0, 10), // Maleficarum: Expert
    zastaveniMutace: node(0, 20), // Maleficarum: Mistr
    oslabeni: node(10), // Maleficarum: Učedník
    temnaObet: node(10), // Maleficarum: Učedník
    overeni: node(5), // Maleficarum: Expert
    zakleti: node(10), // Maleficarum: Učedník
    kontrolovanaMutace: node(0, 15), // Maleficarum: Mistr
    pozehnaniKozula: node(25), // Maleficarum: Velmistr
  },
  mentalist: {
    ucednik: node(5),
    expert: node(5, 0, [rank("schools", "spirit", 6)]), // Škola Ducha VI
    mistr: node(5, 0, [rank("schools", "spirit", 8)]), // Škola Ducha VIII
    velmistr: node(5, 0, [rank("schools", "spirit", 10)]), // Škola Ducha X
    mentalniUder: node(10), // Mentalist: Grandmaster
    vytrvalaSnaha: node(5), // Mentalist: Apprentice
    mentalniZtec: node(0), // Mentalist: Apprentice
    soubojDotek: node(0, 5), // Mental Charge
    soubojZahajeni1: node(5), // Touch: +30% to initiate
    soubojZahajeni2: node(5), // Initiation +10% I + Mentalist: Expert
    soubojZahajeni3: node(5), // Initiation +10% II + Mentalist: Master
    soubojZahajeni4: node(5), // Initiation +10% III + Mentalist: Grandmaster
    mentalistuvUprk: node(5), // Mentalist: Apprentice
    vybojMysli: node(5), // Mentalist's Escape + Mentalist: Expert
    zoufalyVzdor: node(10), // Mind Burst + Mentalist: Grandmaster
    vytizeniKoncentrace: node(5), // Mentalist: Apprentice
    vytizeniReakce: node(5), // Strain: cancels Conc
    vytizeniZakerne: node(5), // Strain: -1 Reaction
    vytizeniAkce: node(5), // Strain: attacks are Sneak + Mentalist: Master
    vysati: node(5), // Mentalist: Apprentice
    ovladnuti: node(10), // Drain + Mentalist: Expert
    cteniMysli: node(0, 15), // Domination + Mentalist: Master
    pokrocileCteni: node(0, 10), // Mind Reading
    meditace2: node(0, 5, [rank("skills", "meditation", 1)]), // Meditation I
    meditace3: node(0, 15), // Meditation +2 MH
    mzMeditace: node(0, 15), // Meditation +3 MH + Mentalist: Expert
    soubojUdrzovani: node(10), // Mentalist: Expert
    soubojPostih: node(10), // Upkeep: -1 Action + Mentalist: Master
    telepat1: node(0, 15), // Mentalist: Expert
    telepat2: node(0, 5), // Telepath I + Mentalist: Master
    mentalniSouboj10a: node(0, 15),
    soubojMZ1: node(10), // Mental Duel +10% I + Mentalist: Expert
    mentalniSouboj10b: node(0, 15), // Mental Assault
    soubojMZ2: node(10), // Mental Duel +10% II + Mentalist: Grandmaster
  },
  mystic: {
    ucednik: node(5),
    expert: node(10, 0, [rank("skills", "rituals", 6)]), // Rituály VI
    mistr: node(15, 0, [rank("skills", "rituals", 8)]), // Rituály VIII
    kapacitaOvladani: node(20, 0, [{ t: "masterFeature", skill: "rituals" }]), // Rituály: Mistr
    podmaneni1: node(0, 20, [rank("skills", "arcana", 5)]), // Arcana V
    podmaneni2: node(0, 10),
    mesicniStudna: node(0, 15, [{ t: "feature", name: "Adept: Rituals" }]), // Rituály: Adept
    studna15a: node(0, 10),
    studna15b: node(0, 10),
    podmineneRitualy: node(0, 10),
    mystickaObet: node(0, 15, [rank("skills", "rituals", 6)]), // Rituály VI
    bane1: node(5),
    ritualyVyhoda: node(0, 5),
    ritualyKritNeuspech: node(0, 5),
    sleva1: node(0),
    sleva2: node(0),
  },
  pyromancer: {
    ucednik: node(5),
    expert: node(5, 0, [rank("schools", "fire", 6)]), // Škola Ohně VI
    mistr: node(5, 0, [rank("schools", "fire", 8)]), // Škola Ohně VIII
    velmistr: node(5, 0, [rank("schools", "fire", 10)]), // Škola Ohně X
    overeni: node(5), // Pyromancer: Expert
    kritRozsah: node(0, 5),
    burnResist1: node(0, 10),
    burnResist2: node(0, 10), // Pyromancer: Expert
    podpaleniPanika: node(0, 15),
    ohnivaAura: node(5), // Pyromancer: Expert
    ohnivyStit: node(5), // Pyromancer: Expert
    podpaleniKrit: node(5), // Divoký oheň I
    divokyOhen1: node(15), // Pyromancer: Expert
    divokyOhen2: node(15), // Pyromancer: Mistr
    barevnyOhen1: node(5), // Pyromancer: Učedník
    barevnyOhen2: node(5), // Pyromancer: Expert
    barevnyOhen3: node(5), // Pyromancer: Mistr
    barevnyOhen4: node(15), // Pyromancer: Velmistr
  },
  runeWarrior: {
    obnoveniRun1: node(0),
    obnoveniRun2: node(0, 25, [rank("skills", "arcana", 5)]), // Arcana V
    nohyRunaA: node(10),
    nohyRunaB: node(10, 0, [rank("skills", "arcana", 5)]), // Arcana V
    zadaRuna: node(10, 0, [rank("skills", "arcana", 5)]), // Arcana V
    hlavaRuna: node(20, 0, [rank("skills", "arcana", 7)]), // Arcana VII
    pravaRuka1: node(5),
    pravaRuka2: node(15, 0, [rank("skills", "arcana", 6)]), // Arcana VI
    pravaRuka3: node(20, 0, [rank("skills", "arcana", 10)]), // Arcana X
    levaRuka1: node(5),
    levaRuka2: node(15, 0, [rank("skills", "arcana", 6)]), // Arcana VI
    levaRuka3: node(20, 0, [rank("skills", "arcana", 10)]), // Arcana X
    hrud1: node(10, 0, [rank("skills", "arcana", 4)]), // Arcana IV
    hrud2: node(15, 0, [rank("skills", "arcana", 6)]), // Arcana VI
    hrud3: node(20, 0, [rank("skills", "arcana", 10)]), // Arcana X
  },
  vitamancer: {
    ucednik: node(5),
    expert: node(5, 0, [{ t: "anyOf", options: [rank("schools", "spirit", 6), rank("schools", "body", 6)] }]), // Škola Ducha/Těla VI
    mistr: node(5, 0, [{ t: "anyOf", options: [rank("schools", "spirit", 8), rank("schools", "body", 8)] }]), // Škola Ducha/Těla VIII
    velmistr: node(5, 0, [{ t: "anyOf", options: [rank("schools", "spirit", 10), rank("schools", "body", 10)] }]), // Škola Ducha/Těla X
    kritRozsah: node(0, 5),
    overeni: node(5), // Vitamancer: Expert
    ochromeni1: node(5), // Vitamancer: Expert
    ochromeni2: node(5), // Vitamancer: Mistr
    zivoty5: node(10), // Vitamancer: Mistr
    rychlaLecba: node(0, 15),
    bleedResist: node(0, 10),
    obnoveniKrvaceni: node(5), // Vitamancer: Expert
    stabilizace: node(0, 10), // Vitamancer: Expert
    lorikovoKopi: node(5), // Vitamancer: Mistr
    lorinoPouto: node(5), // Vitamancer: Mistr
    maguvOdpocinek: node(10), // Vitamancer: Učedník
    sdilenaOchrana: node(20), // Vitamancer: Expert
    sebekontrola: node(5), // Vitamancer: Mistr
    ochrance: node(30), // Vitamancer: Expert
    rusivaKouzla: node(15), // Vitamancer: Mistr
    hibernace: node(15), // Vitamancer: Velmistr
    magickyStit: node(5), // Vitamancer: Mistr
    magickaStena: node(5), // Vitamancer: Mistr
  },
};
