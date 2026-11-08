/**
 * Mancer signature spells: the rank nodes of the six mancer specialisations
 * that lock the spells they name.
 *
 * Source: docs/rules-source/rules/specializace-wip.md, e.g. "Pyromancer:
 * Expert · Pasivní · Odemyká možnost naučit se a sesílat expertní kouzla:
 * Ochrana před žárem, Roztavení a Stravující oheň".
 *
 * Rules (user ruling 2026-11-03, rules as written):
 *   - Without the node a character can neither learn nor cast the spell. The
 *     grimoire entry stays, but its copy is not projected onto the actor
 *     (utils/spellbook.mjs), the Learn window shows the spell as out of reach
 *     (utils/learnWindow.mjs), and a cast is refused before anything is paid
 *     (utils/castSpell.mjs).
 *   - The node gates the spell on top of the school rank its own spell rank
 *     asks for (checkSpellRank); it never replaces that gate.
 *   - NPCs have no specialisations and are never locked.
 *
 * The book names the spells in Czech and the pack in English, so every entry
 * was matched by its description, mana, difficulty and range in
 * docs/rules-source/spells/*.md, not by translating the name. Each spell keeps
 * its Czech book name in the trailing comment. `id` is the document id in the
 * All-Spells pack; `name` is the English pack name, used to recognise a copy
 * that carries no compendium source. `variants` are versions of the spell the
 * pack lists under its `system.variants` (cast through the parent), gated with
 * the parent.
 *
 * Pure data plus one read: helpers/specialisations.mjs reads MANCER_SPELLS to
 * paint these nodes as automated.
 */

/** Every mancer rank node and the spells it unlocks. */
export const MANCER_SPELLS = [
  // Astramancer (School of Air)
  { spec: "astramancer", node: "ucednik", spells: [
    { id: "3SJzeNijFq0zTHV5", name: "Rune of discharge" }, // Rozbuška
  ] },
  { spec: "astramancer", node: "expert", spells: [
    { id: "yFeIjAuGhhQt93VP", name: "Lightning rune" }, // Blesková runa
    { id: "bbPpilRVR0Xsa0Wd", name: "Red lightning" }, // Červený blesk
    { id: "fz49BBDFXiTihukp", name: "Green lightning" }, // Zelený blesk
  ] },
  { spec: "astramancer", node: "mistr", spells: [
    { id: "2nLvqnLLPE5y8JVm", name: "Lightning orb" }, // Bleskový orb
    { id: "ay8WpY15QHkZCP9g", name: "Blue lightning" }, // Modrý blesk
    // Modrý blesk's bonus against magical creatures, which the pack keeps as
    // a spell of its own rather than as a variant.
    { id: "jknCFkhR2n7K1hTm", name: "Blue lightning (against magical creatures)" }, // Modrý blesk (proti magickým tvorům)
  ] },
  { spec: "astramancer", node: "velmistr", spells: [
    { id: "xiEROCcIUX58hyWe", name: "Harold's quiver" }, // Haroldův toulec
  ] },

  // Cryomancer (School of Water)
  { spec: "cryomancer", node: "ucednik", spells: [
    { id: "2scXWlOuxAwCdQCX", name: "Hypothermia" }, // Podchlazení
  ] },
  { spec: "cryomancer", node: "expert", spells: [
    { id: "9MjBRNYC3O1Fk5Ev", name: "Ice barrage" }, // Ledová salva
    { id: "YxBIyhVpBStk1Pdk", name: "Ice armor" }, // Ledová zbroj
    { id: "bRiFAj3jDWQOLXWK", name: "Sapphira's fist" }, // Saphiřina pěst
  ] },
  { spec: "cryomancer", node: "mistr", spells: [
    { id: "T6CD5w0zf07Wnvsa", name: "Ice block" }, // Ledová kostka
    { id: "ws5B2c9dFMFqYnFk", name: "Ice orb" }, // Ledový orb
    { id: "x3kENZ91rEjQtq41", name: "Sapphira's kiss" }, // Saphiřin polibek
  ] },
  { spec: "cryomancer", node: "velmistr", spells: [
    { id: "5pcx8fcFjQIXSfvv", name: "Blizzard" }, // Blizard
    { id: "RXu3Zen7oR6YQT2o", name: "Ice wall" }, // Ledová stěna
  ] },

  // Entomancer (School of Earth)
  { spec: "entomancer", node: "ucednik", spells: [
    { id: "R6Imbr1xlXhQfzak", name: "Repellent" }, // Repelent
    { id: "r8OHptEllv2BzEYU", name: "Acid spit" }, // Kyselinový plivanec
  ] },
  { spec: "entomancer", node: "expert", spells: [
    { id: "bWyejPiHoUXBX9xq", name: "Insect swarm" }, // Roj hmyzu
    { id: "hD4BxdLlsRs6ECav", name: "Insectile adhesion" }, // Hmyzí přilnavost
    { id: "7s2sSl0AJPDiBACb", name: "Poisoned weapon" }, // Otrávená zbraň
    { id: "jdtpGPbaXV05Bw8V", name: "Cobweb" }, // Pavučina
  ] },
  { spec: "entomancer", node: "mistr", spells: [
    { id: "N8vIKlNxkA8yf2R4", name: "Greater Swarm of insects" }, // Hejno hmyzu
    { id: "7nrcxgOx4l65oEgx", name: "Stinger" }, // Žihadlo
    { id: "x3n8M5gAR3bRCoDX", name: "Cocoon" }, // Kukla
  ] },
  { spec: "entomancer", node: "velmistr", spells: [
    { id: "ODDbWcMph5XxYqaz", name: "Metamorphosis" }, // Metamorfóza
  ] },

  // Geomancer (School of Earth)
  { spec: "geomancer", node: "ucednik", spells: [
    { id: "dNXGD2D5K7VNIMZS", name: "Shattering rock" }, // Tříštivý kámen
  ] },
  { spec: "geomancer", node: "expert", spells: [
    { id: "m7PlxR4PDPll41ap", name: "Stalagmite" }, // Stalagmit
    { id: "iJArC599VDFeu3bM", name: "Tremor", variants: [
      { id: "gA066BfxyAbCJVSh", name: "Tremor (Reaction)" }, // Otřes (Reakce)
    ] }, // Otřes
    { id: "ob5tSBfvXvv1oOxB", name: "Devouring Earth" }, // Hlad země
  ] },
  { spec: "geomancer", node: "mistr", spells: [
    { id: "qPNyxBYSQEefXad0", name: "Stone circle" }, // Kamenný kruh
    { id: "lMBd8QeUfFLwu8YE", name: "Urhan's sight" }, // Urhanův zrak
    { id: "7rkPzk027gVAnaRj", name: "Steelskin" }, // Ocelová kůže
  ] },
  { spec: "geomancer", node: "velmistr", spells: [
    { id: "D53Q9rVDjnmywx2J", name: "Earthquake" }, // Zemětřesení
    { id: "gmaEjUlw6Di0USM5", name: "Flower of death" }, // Květ smrti
  ] },

  // Pyromancer (School of Fire)
  { spec: "pyromancer", node: "ucednik", spells: [
    { id: "nOn7KC7lZ1JSWACV", name: "Fan of sparks" }, // Vějíř jisker
  ] },
  { spec: "pyromancer", node: "expert", spells: [
    { id: "CpfSBd8owYdMIrKd", name: "Protection from Heat" }, // Ochrana před žárem
    { id: "m7BHAnEYQnnbKXBg", name: "Melt Metal" }, // Roztavení
    { id: "nIXKNpZjoW4dR5G3", name: "Devouring Fire" }, // Stravující oheň
  ] },
  { spec: "pyromancer", node: "mistr", spells: [
    { id: "Px0F0gyEQSC4JSnO", name: "Relgar's Wrath" }, // Relgarův hněv
    { id: "BAim0xXR7ZbDK4v7", name: "Glowing Heat" }, // Rozžhavení
    { id: "cwowqv8wL6VAQsRD", name: "Relgar's Rune" }, // Relgarova runa
  ] },
  { spec: "pyromancer", node: "velmistr", spells: [
    { id: "DYrcyqN1wbQ7ibpR", name: "Meteor Shower" }, // Déšť meteorů
    { id: "ZTLzM0qJelBAkEzQ", name: "Magmatic Shield" }, // Magmatický štít
  ] },

  // Vitamancer (Schools of Spirit and Body)
  { spec: "vitamancer", node: "ucednik", spells: [
    { id: "Hn3sjzJ7YHfKQzI3", name: "Disorientation" }, // Dezorientace
    { id: "kC8ivAu54ZmUDWc1", name: "Stabilization" }, // Stabilizace
  ] },
  { spec: "vitamancer", node: "expert", spells: [
    { id: "OpZ4E5fzRwXTlEnf", name: "Mass disorientation" }, // Plošná dezorientace
    { id: "qGNeobHmMEgunMZA", name: "Lorina's guard" }, // Lořina stráž
  ] },
  { spec: "vitamancer", node: "mistr", spells: [
    { id: "HlfP2GdyjvqvGui3", name: "Lorik's arrows" }, // Lorikovy šípy
    { id: "TNSdSFAUN8G3FJnb", name: "Lorina's bond" }, // Lořino pouto
  ] },
  { spec: "vitamancer", node: "velmistr", spells: [
    { id: "vvtE2FCrJPrS2IK6", name: "Lorik's rune" }, // Lorikova runa
    { id: "ZZfOeEDQo37rQoI0", name: "Cycle of life" }, // Kolo života
  ] },
];

/** Pack id → {spec, node}, and lowercased English name → {spec, node}. */
const BY_ID = new Map();
const BY_NAME = new Map();
for (const { spec, node, spells } of MANCER_SPELLS) {
  for (const spell of spells) {
    for (const entry of [spell, ...(spell.variants ?? [])]) {
      BY_ID.set(entry.id, { spec, node });
      BY_NAME.set(entry.name.toLowerCase(), { spec, node });
    }
  }
}

/** The trailing document id of a compendium uuid, or null. */
function compendiumId(uuid) {
  if (typeof uuid !== "string" || !uuid.startsWith("Compendium.")) return null;
  const match = /\.Item\.([A-Za-z0-9]+)$/.exec(uuid);
  return match ? match[1] : null;
}

/**
 * Which mancer node a spell needs, whoever is casting it, or null.
 *
 * Reads the compendium source first: the `uuid` of a book entry or a Learn
 * window row, the spellbook module's `flags.redsteel.spellSource.uuid`, the
 * copy's `_stats.compendiumSource`, or the uuid of a document still in a pack
 * (a variant resolved at cast time). An owned copy's own uuid names the actor,
 * not the pack, so it is never read. A copy that names no table spell falls
 * back to its English name, case-insensitively, which is what catches one
 * dragged in from somewhere else.
 *
 * @param {Item|object} spell  A spell Item, or plain data with `uuid`/`name`.
 * @returns {{spec: string, node: string}|null}
 */
export function getMancerGate(spell) {
  if (!spell) return null;
  const sources = [
    spell.uuid,
    spell.flags?.redsteel?.spellSource?.uuid,
    spell._stats?.compendiumSource,
  ];
  for (const uuid of sources) {
    const id = compendiumId(uuid);
    if (id && BY_ID.has(id)) return BY_ID.get(id);
  }
  const name = typeof spell.name === "string" ? spell.name.trim().toLowerCase() : "";
  return (name && BY_NAME.get(name)) || null;
}

/**
 * Whether a spell is the pack spell `entry` names ({id, name}), read the same
 * way getMancerGate reads it: compendium source id first, English name second.
 *
 * @param {Item|object} spell
 * @param {{id: string, name: string}} entry
 * @returns {boolean}
 */
export function matchesPackSpell(spell, entry) {
  if (!spell || !entry) return false;
  const sources = [
    spell.uuid,
    spell.flags?.redsteel?.spellSource?.uuid,
    spell._stats?.compendiumSource,
  ];
  if (sources.some((uuid) => compendiumId(uuid) === entry.id)) return true;
  const name = typeof spell.name === "string" ? spell.name.trim().toLowerCase() : "";
  return !!name && name === String(entry.name ?? "").toLowerCase();
}

/**
 * Whether this actor is locked out of a spell by a mancer rank node.
 *
 * @param {Actor} actor
 * @param {Item|object} spell  A spell Item, or plain data with `uuid`/`name`.
 * @returns {{spec: string, node: string}|null}  null when the spell is
 *   allowed: an NPC, a spell no mancer node names, or the node is unlocked on
 *   an active specialisation.
 */
export function mancerSpellLock(actor, spell) {
  if (!actor || actor.type !== "character") return null;
  const gate = getMancerGate(spell);
  if (!gate) return null;
  const spec = actor.system?.specialisations?.[gate.spec];
  if (spec?.active && spec?.nodes?.[gate.node]) return null;
  return gate;
}

/** The node a lock names, in the reader's language ("Pyromancer: Expert"). */
export function mancerLockLabel(lock) {
  if (!lock) return "";
  return game.i18n.localize(
    `REDSTEEL.Actor.Specialisations.${lock.spec}.nodes.${lock.node}.label`,
  );
}
