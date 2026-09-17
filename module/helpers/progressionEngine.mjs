import { PROGRESSION_TRACKS } from "./progression.mjs";
import { FEATURE_PRICES } from "./featurePrices.mjs";
import {
  FEATURE_DISCOUNTS,
  NONCOMBAT_EXCLUDED,
  SPEC_DISCOUNTS,
  TEMPERAMENT_SCHOOLS,
} from "./rankDiscounts.mjs";
import { SPEC_MIRRORS } from "./rankMirrors.mjs";
import {
  actorHasSpecNode,
  isAutoUnlockNode,
  syncSpecialisationPassive,
} from "./specialisations.mjs";
import {
  SPEC_GROUP_CAPS,
  SPEC_GROUPS,
  SPEC_POINTS_DEFAULT,
  SPEC_PRICES,
} from "./specPrices.mjs";
import { SPEC_NODE_PRICES } from "./specNodePrices.mjs";
import { REDSTEEL } from "./config.mjs";
import { clearBaneChoice } from "./banes.mjs";
import { ABILITY_GRANTS } from "../utils/abilityGrants.mjs";
import { MEMORISE_SP, getMemorisedCount } from "../utils/spellbook.mjs";

/* ===========================================================================
 * Progression engine — the wallet, the level, and the requirement checks the
 * Learn window is built on.
 *
 * Two currencies, both from "Pravidla pro ToS V12.1 (WIP)" → "Tvorba postavy":
 *   cp  Character Points. Buys combat skills, doctrines, schools, channeling
 *       and most features. Total CP earned is what defines the level.
 *   sp  Skill Points. Buys the ordinary skills and the racial features.
 *
 * `earned` is the GM's ledger figure and is typed in. `spent` is NOT stored:
 * it is recomputed from what the character actually owns, so an existing
 * character prices itself correctly the first time this runs and can never
 * drift out of sync with its own sheet. `adjust` is the escape hatch for
 * anything bought off-book (a GM gift, a house ruling, points spent on
 * something this table does not price yet).
 *
 * Level is derived from CP earned and is INFORMATIONAL. The book's rank caps
 * per level ("Dovednost III" at level 1 and so on) apply at character creation
 * only, so nothing here enforces them. The one rank gate that is enforced is
 * the teacher, and a teacher is PER RANK: finding somebody to take you from
 * sword IV to sword V says nothing about who can take you to VIII. The GM
 * records each one at
 * `system.progression.teachers.<group>.<key>.r<rank>`, and a rank whose
 * teacher has not been found stays locked.
 *
 * Specialisations have two more teachers, granted the same way and stored
 * beside the specialisation: `teacher`, one per tree, which the book asks for
 * before the specialisation itself may be bought, and `teachers.<node>`, one
 * per star, for the stars the book only opens with a trainer
 * (specNodePrices.mjs). Neither stands in for the other.
 * ======================================================================== */

/**
 * Total CP earned at each level, index 0 = level 1.
 * Source: "Tvorba postavy" → the Úrovně table, row 273.
 */
export const LEVEL_THRESHOLDS = [
  15, 25, 35, 50, 80, 125, 160, 200, 250, 300,
  350, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200,
];

/** Requirement kinds that describe the fiction rather than the sheet. They are
 *  shown to the player but never block a purchase: only the GM can judge them. */
// masterFeature and specScore are node clauses the system cannot check
// (specNodePrices.mjs): no Master feature exists, and the book does not say
// what "Kontramág 6" counts.
const ADVISORY = new Set(["gm", "raw", "featureTeacher", "masterFeature", "specScore"]);

/* -------------------------------------------------------------------------- */
/*  Tracks                                                                    */
/* -------------------------------------------------------------------------- */

/** The rank a character currently holds in a track, 0 when untrained. */
export function getTrackRank(actor, group, key) {
  return Number(actor?.system?.[group]?.[key]?.value ?? 0);
}

/** The highest rank held across a whole group — what "Doktrína III" asks about. */
export function getBestRankInGroup(actor, group) {
  const bucket = actor?.system?.[group] ?? {};
  let best = 0;
  for (const entry of Object.values(bucket)) {
    const value = Number(entry?.value ?? 0);
    if (value > best) best = value;
  }
  return best;
}

/** The definition for a track id ("doctrines.swordsman"), or null. */
export function getTrack(trackId) {
  return PROGRESSION_TRACKS[trackId] ?? null;
}

/**
 * The price of one rank. `rank` is 1-based, matching the book's I–X.
 * Returns null for a rank the book does not sell.
 */
export function getRankPrice(trackId, rank) {
  return PROGRESSION_TRACKS[trackId]?.ranks?.[rank - 1] ?? null;
}

/* -------------------------------------------------------------------------- */
/*  What a rank hands you                                                     */
/* -------------------------------------------------------------------------- */

/** ABILITY_GRANTS trigger kinds, in the group names this table uses. */
const GRANT_KIND_GROUP = {
  skill: "skills",
  doctrine: "doctrines",
  weaponSkill: "weaponSkills",
};

/**
 * Ability UUIDs a track hands over at exactly this rank, built once from
 * ABILITY_GRANTS so the grid and the grant machinery can never disagree about
 * what a rank is worth. Keyed "<group>.<key>.<rank>".
 *
 * Combat skills and schools grant no abilities by rank — their cells show the
 * price alone.
 */
const RANK_GRANTS = (() => {
  const index = {};
  for (const rule of ABILITY_GRANTS) {
    const group = GRANT_KIND_GROUP[rule.when?.kind];
    if (!group) continue;
    const rank = rule.when.min ?? 1;
    const id = `${group}.${rule.when.key}.${rank}`;
    (index[id] ??= []).push(...(rule.grant ?? []));
  }
  return index;
})();

/** The abilities gained at one rank, as compendium UUIDs. Never null. */
export function getRankGrants(trackId, rank) {
  return RANK_GRANTS[`${trackId}.${rank}`] ?? [];
}

/* -------------------------------------------------------------------------- */
/*  Which tracks a character is training                                      */
/* -------------------------------------------------------------------------- */

/*
 * `system.progression.tracked` is the Learn window's own list of track ids, and
 * it exists ONLY to keep that window's grid down to the handful of tracks a
 * character actually trains. It is deliberately NOT the sheet's `visible` flag:
 * a character can roll a skill they have never bought a rank in, so dropping a
 * track out of the progression tree must never take it off the sheet.
 */

/**
 * Which tab a group belongs to. The rules sheet files tracks by governing
 * attribute, which does not draw a combat line: Cordinas and Blood Manipulation
 * sit under Will beside Meditation and Rituals. Splitting by group instead puts
 * the blood-magic pair with the rest of the fighting kit, where it belongs,
 * while the section headings inside each tab still follow the book.
 */
export const TRACK_TABS = {
  combatSkills: "combat",
  doctrines: "combat",
  weaponSkills: "combat",
  schools: "combat",
  skills: "skills",
};

/** The Learn tab a track appears on. */
export function getTrackTab(trackId) {
  return TRACK_TABS[PROGRESSION_TRACKS[trackId]?.group] ?? "combat";
}

/**
 * How the doctrines divide up. This is the one piece of the Learn window's
 * grouping the rules sheet cannot supply: the book files every doctrine under
 * the same "Boj" heading, and the melee / ranged / magical reading of them is
 * the GM's (2026-09-09). Every doctrine in template.json must appear here, or
 * it falls back to melee and quietly lands in the wrong block.
 */
const DOCTRINE_KINDS = {
  melee: [
    "pikeman",
    "swordsman",
    "reaver",
    "shieldbearer",
    "dimakerus",
    "duelist",
    "monk",
  ],
  ranged: ["archer", "arbalest", "peltast", "juggler"],
  // Hybrids that refuse a clean melee/ranged reading: Rogue works off ranged
  // skills as readily as melee ones, Rider fights from the saddle, and
  // Musketeer straddles both with firearms.
  special: ["rogue", "rider", "musketeer"],
  magical: ["elymas", "incantator", "veneficus", "elementalist", "cordinas"],
};

/** doctrine key → "melee" | "ranged" | "special" | "magical" */
const DOCTRINE_KIND = Object.fromEntries(
  Object.entries(DOCTRINE_KINDS).flatMap(([kind, keys]) =>
    keys.map((key) => [key, kind]),
  ),
);

/**
 * The blocks each tab stacks, in order. The Skills tab keeps the book's own
 * attribute grouping; the Combat tab uses the reading above instead, because
 * one undivided "Boj" list of 35 entries was the redundancy this window exists
 * to fix.
 */
export const LEARN_SECTION_ORDER = {
  combat: [
    "combat",
    "weapons",
    "melee",
    "ranged",
    "special",
    "magical",
    "schools",
  ],
  skills: ["str", "dex", "end", "int", "cha", "per", "wil", "beast"],
};

/** Which block of its tab a track belongs to. */
export function getLearnSection(trackId) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track) return "combat";
  switch (track.group) {
    case "combatSkills":
      return "combat";
    case "weaponSkills":
      return "weapons";
    case "schools":
      return "schools";
    case "doctrines":
      return DOCTRINE_KIND[track.key] ?? "melee";
    default:
      // Ordinary skills keep the governing attribute the book files them under.
      return track.section;
  }
}

/* -------------------------------------------------------------------------- */
/*  Teachers                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * A teacher is unlocked for ONE track at a time. The book gates most ranks on
 * "Učitel I/II/III", and at the table that means the character found somebody
 * who teaches THAT skill — so this is stored per track and only the GM writes
 * it. The stored value is the highest tier unlocked, so tier III also satisfies
 * a rank asking for I.
 *
 * Stored nested as teachers.<group>.<key> rather than under the dotted track id,
 * because Foundry reads a dot in an update key as a path separator.
 */

/* Rank keys are prefixed so the stored object never looks like an array to
   Foundry's merge, which would turn {"3": true} into a sparse list. */
const rankKey = (rank) => `r${Number(rank) || 0}`;

/** True when this exact rank of this track has its teacher. */
export function hasTeacher(actor, trackId, rank) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track) return false;
  const teachers = actor?.system?.progression?.teachers ?? {};
  return !!teachers?.[track.group]?.[track.key]?.[rankKey(rank)];
}

/** Grant or revoke the teacher for ONE rank. GM only; callers must check. */
export async function setTeacher(actor, trackId, rank, found) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track) return false;
  await actor.update({
    [`system.progression.teachers.${track.group}.${track.key}.${rankKey(rank)}`]:
      !!found,
  });
  return true;
}

/** The track ids this character has chosen to see in the Learn grid. */
export function getTrackedIds(actor) {
  const list = actor?.system?.progression?.tracked;
  return Array.isArray(list) ? list : [];
}

/**
 * True before the picker has ever been saved for this character, which is when
 * the defaults below apply instead of the stored list.
 */
function tracksUnset(actor) {
  return !actor?.system?.progression?.tracksSet;
}

/**
 * The skills every character's grid starts with (GM ruling 2026-09-10): the
 * everyday skills nearly anyone ends up rolling. Everything else, skill or
 * combat track, starts hidden until it is picked or a rank in it is bought.
 */
export const DEFAULT_TRACKED = new Set([
  "skills.athletics",
  "skills.muscles",
  "skills.acrobacy",
  "skills.nimbleness",
  "skills.stealth",
  "skills.drinking",
  "skills.arcana",
  "skills.firstAid",
  "skills.persuasion",
  "skills.survival",
]);

/**
 * True when a track belongs in the grid.
 *
 * A track with any rank bought is always shown, whatever the list says: hiding
 * something already paid for would strand it with no way back. That is also
 * what carries an existing character's skills into the grid.
 *
 * Until the picker is saved for the first time, the grid shows the
 * DEFAULT_TRACKED preset and nothing from the combat side. Once the picker is
 * saved the stored list is authoritative, even when it is empty — which is
 * what `tracksSet` distinguishes from "never configured".
 */
export function isTracked(actor, trackId) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track) return false;
  if (getTrackRank(actor, track.group, track.key) > 0) return true;
  if (tracksUnset(actor)) return DEFAULT_TRACKED.has(trackId);
  return getTrackedIds(actor).includes(trackId);
}

/**
 * Replace the tracked list for ONE tab, leaving the other tab's choices alone:
 * the picker only ever shows the tab it was opened from, so a save must not
 * silently drop everything the player picked on the other one.
 *
 * Ids the price table does not know are dropped.
 */
export async function setTrackedIds(actor, tab, ids) {
  const kept = getTrackedIds(actor).filter(
    (id) => PROGRESSION_TRACKS[id] && getTrackTab(id) !== tab,
  );

  // First save has to freeze the defaults for the tab that was NOT edited,
  // otherwise switching `tracksSet` on would silently wipe them. The preset is
  // all skills, so only a first save from the Combat tab has anything to keep.
  const frozen =
    tracksUnset(actor) && tab !== "skills"
      ? [...DEFAULT_TRACKED].filter((id) => getTrackTab(id) !== tab)
      : [];

  const clean = [
    ...new Set([
      ...kept,
      ...frozen,
      ...ids.filter((id) => PROGRESSION_TRACKS[id]),
    ]),
  ];
  await actor.update({
    "system.progression.tracked": clean,
    "system.progression.tracksSet": true,
  });
  return clean;
}

/* -------------------------------------------------------------------------- */
/*  Wallet                                                                    */
/* -------------------------------------------------------------------------- */

/** Level from total CP earned. Below the level-1 threshold is still level 1. */
export function levelFromCp(cp) {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (cp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

/**
 * What the character's current ranks cost to buy, summed from the price table.
 *
 * Only ranks this table prices are counted. Features and specialisation nodes
 * have sums of their own (computeSpentOnFeatures, computeSpentOnSpecNodes).
 */
export function computeSpentOnRanks(actor) {
  const spent = { cp: 0, sp: 0 };
  // Discounts are retroactive (GM ruling 2026-09-11): a held rank costs what it
  // costs this character now, discount included.
  const discounts = getSkillDiscounts(actor);
  // A rank copied from another track (rankMirrors.mjs) is free.
  const mirrors = getActiveMirrors(actor);
  // So is rank I of the first school of magic.
  const freeSchool = getFreeSchool(actor);
  for (const [trackId, track] of Object.entries(PROGRESSION_TRACKS)) {
    const held = getTrackRank(actor, track.group, track.key);
    for (let rank = 1; rank <= held; rank++) {
      const price = getRankCost(actor, trackId, rank, discounts, mirrors, freeSchool);
      if (!price) continue;
      spent[price.currency] += price.cost;
    }
  }
  return spent;
}

const LEDGER_CURRENCIES = ["cp", "sp"];

/** A stored starting figure that was never written down. */
function isUnsetStarting(value) {
  return value === null || value === undefined || value === "";
}

/**
 * Where earned CP/SP comes from (user ruling 2026-09-14, Party Management):
 * total = starting + bonus + every award. The total is never typed, so it
 * cannot drift from the ledger the GM keeps.
 *
 * `starting` is null on characters from before the ledger. Their old typed
 * `earned` already held every award granted so far (the first Party Management
 * build added awards straight onto it), so starting is recovered as
 * `earned - awards`, which leaves their total exactly where it was. Party
 * Management writes that figure down the first time it touches the character
 * (`getLedgerMaterializeUpdate`), after which the old `earned` is unused.
 *
 * @returns {{starting: {cp:number,sp:number}, bonus: {cp:number,sp:number},
 *            awards: {cp:number,sp:number}, total: {cp:number,sp:number},
 *            legacy: {cp:boolean,sp:boolean}}}
 */
export function getLedger(actor) {
  const p = actor?.system?.progression ?? {};
  const ledger = {
    starting: {},
    bonus: {},
    awards: { cp: 0, sp: 0 },
    total: {},
    legacy: {},
  };
  for (const award of Array.isArray(p.awards) ? p.awards : []) {
    for (const c of LEDGER_CURRENCIES) ledger.awards[c] += Number(award?.[c]) || 0;
  }
  for (const c of LEDGER_CURRENCIES) {
    const legacy = isUnsetStarting(p.starting?.[c]);
    ledger.legacy[c] = legacy;
    ledger.bonus[c] = Number(p.bonus?.[c]) || 0;
    ledger.starting[c] = legacy
      ? (Number(p.earned?.[c]) || 0) - ledger.awards[c]
      : Number(p.starting[c]) || 0;
    ledger.total[c] = ledger.starting[c] + ledger.bonus[c] + ledger.awards[c];
  }
  return ledger;
}

/**
 * Update keys that write a legacy character's recovered starting figure down.
 * Merge them into ANY update that changes awards, starting or bonus: once the
 * awards change, `earned - awards` no longer recovers the right number.
 * Empty for a character whose ledger is already written.
 */
export function getLedgerMaterializeUpdate(actor) {
  const ledger = getLedger(actor);
  const update = {};
  for (const c of LEDGER_CURRENCIES) {
    if (ledger.legacy[c]) {
      update[`system.progression.starting.${c}`] = ledger.starting[c];
    }
  }
  return update;
}

/**
 * The full wallet for the sheet header and the Learn window.
 * @returns {{earned: {cp:number,sp:number}, spent: {cp:number,sp:number},
 *            remaining: {cp:number,sp:number}, level: number}}
 */
export function getWallet(actor) {
  const p = actor?.system?.progression ?? {};
  const earned = getLedger(actor).total;
  const ranks = computeSpentOnRanks(actor);
  // Owned features count too, whether bought in the Learn window or dropped on
  // the sheet (GM ruling 2026-09-11): the same derived model as ranks.
  const features = computeSpentOnFeatures(actor);
  // So do unlocked specialisation nodes (user ruling 2026-09-14), whether
  // unlocked in the Learn window or on the sheet.
  const nodes = computeSpentOnSpecNodes(actor);
  // And every spell learnt by heart: the Memory knowledge costs 1 SP a spell
  // (Pravidla, Dovednosti → Paměť). Spells only written in a grimoire are free,
  // and a spell dragged onto the sheet by hand carries no memorised flag, so
  // nothing is charged for it in arrears.
  const memorised = getMemorisedCount(actor) * MEMORISE_SP;
  const spent = {
    cp: ranks.cp + features.cp + nodes.cp + Number(p.adjust?.cp ?? 0),
    sp: ranks.sp + features.sp + nodes.sp + memorised + Number(p.adjust?.sp ?? 0),
  };
  return {
    earned,
    spent,
    remaining: { cp: earned.cp - spent.cp, sp: earned.sp - spent.sp },
    level: levelFromCp(earned.cp),
  };
}

/* -------------------------------------------------------------------------- */
/*  Requirements                                                              */
/* -------------------------------------------------------------------------- */

/**
 * True when the actor owns a feature item with this (always English) name, or
 * a copy still carrying one of its former names: renaming a compendium feature
 * does not rename the copies characters already own.
 */
function hasFeature(actor, name) {
  const wanted = new Set([name.toLowerCase()]);
  for (const entry of FEATURES_BY_NAME.get(name.toLowerCase()) ?? []) {
    for (const alias of entry.aliases ?? []) wanted.add(alias.toLowerCase());
  }
  return actor.items.some(
    (i) => i.type === "feature" && wanted.has(i.name?.toLowerCase()),
  );
}

/**
 * Test one requirement.
 *
 * @returns {{met: boolean, advisory: boolean, req: object}} `advisory` marks a
 *   requirement that is displayed but must never block: the fiction ones the
 *   system cannot see.
 */
export function evaluateRequirement(actor, req, trackId, rank) {
  let advisory = ADVISORY.has(req.t);
  let met = false;

  switch (req.t) {
    case "teacher":
      met = hasTeacher(actor, trackId, rank);
      break;
    case "attr":
      met = Number(actor.system?.attributes?.[req.key]?.total ?? 0) >= req.min;
      break;
    case "rank":
      met = getTrackRank(actor, req.group, req.key) >= req.min;
      break;
    case "anyRank":
      met = getBestRankInGroup(actor, req.group) >= req.min;
      break;
    case "feature":
      met = hasFeature(actor, req.name);
      break;
    case "flag":
      met = !!actor.system?.[req.key];
      break;
    case "specNode":
      met = actorHasSpecNode(actor, req.spec, req.node);
      break;
    // The clause kinds below come from the feature price table (featurePrices.mjs).
    case "race": {
      const race = actor.items.find((i) => i.type === "race");
      met = !!race && (req.races ?? []).includes(race.name);
      break;
    }
    case "attrCompare":
      met =
        Number(actor.system?.attributes?.[req.greater]?.total ?? 0) >
        Number(actor.system?.attributes?.[req.lesser]?.total ?? 0);
      break;
    case "secAttr":
      met =
        Number(actor.system?.secondaryAttributes?.[req.key]?.total ?? 0) >=
        req.min;
      break;
    case "notFlag":
      met = !actor.system?.[req.key];
      break;
    case "spec":
      met = !!actor.system?.specialisations?.[req.spec]?.active;
      break;
    case "countRank": {
      const bucket = actor.system?.[req.group] ?? {};
      const reached = Object.values(bucket).filter(
        (entry) => Number(entry?.value ?? 0) >= req.min,
      ).length;
      met = reached >= req.count;
      break;
    }
    case "featurePrefix": {
      const prefix = String(req.prefix ?? "").toLowerCase();
      met = actor.items.some(
        (i) => i.type === "feature" && i.name?.toLowerCase().startsWith(prefix),
      );
      break;
    }
    // The clause kinds below come from the specialisation price table (specPrices.mjs).
    case "specTeacher":
      // Granted by the GM once per specialisation, not per rank.
      met = !!actor.system?.specialisations?.[req.spec]?.teacher;
      break;
    case "nodeTeacher":
      // Granted by the GM star by star, the way a rank's teacher is: the
      // specialisation's own teacher taught the tree, not this one trick.
      met = !!actor.system?.specialisations?.[req.spec]?.teachers?.[req.node];
      break;
    case "noRank":
      // "Nesmí mít Doktrínu: …": no rank at all in any of the named tracks.
      met = (req.keys ?? []).every((key) => getTrackRank(actor, req.group, key) <= 0);
      break;
    case "allOf":
      // An advisory inside (Vardur's GM clause) never blocks the group.
      met = (req.options ?? []).every(
        (o) =>
          ADVISORY.has(o.t) || evaluateRequirement(actor, o, trackId, rank).met,
      );
      break;
    case "anyOf": {
      const options = (req.options ?? []).map((o) =>
        evaluateRequirement(actor, o, trackId, rank),
      );
      met = options.some((o) => o.met);
      // "A / Zvláštní příležitost": when the sheet cannot show A, the GM may
      // still rule the other way in, so the group is shown but never blocks.
      if (!met && options.some((o) => o.advisory)) advisory = true;
      break;
    }
    default:
      // "gm", "raw", and anything a later rules revision adds: shown, not enforced.
      met = false;
      break;
  }

  return { met, advisory, req };
}

/**
 * Test a whole requirement list.
 * @returns {{met: boolean, results: Array}} `met` ignores advisory entries.
 */
export function evaluateRequirements(actor, requires = [], trackId, rank) {
  const results = requires.map((r) =>
    evaluateRequirement(actor, r, trackId, rank),
  );
  return {
    met: results.every((r) => r.met || r.advisory),
    results,
  };
}

/**
 * A track's prerequisites the character has not met: the clauses on its rank I
 * marked `pre` (progression.mjs). Until they are, the track cannot be added to
 * the Learn tree, since no rank of it could be bought (Channeling without magic
 * potential, a school without Channeling or Veneficus).
 * @returns {object[]} the unmet clauses, empty when the track may be added.
 */
export function getUnmetPrerequisites(actor, trackId) {
  const requires = PROGRESSION_TRACKS[trackId]?.ranks?.[0]?.requires ?? [];
  return requires.filter(
    (req) => req.pre && !evaluateRequirement(actor, req, trackId, 1).met,
  );
}

/* -------------------------------------------------------------------------- */
/*  Rank state                                                                */
/* -------------------------------------------------------------------------- */

/**
 * How one cell of the Learn grid should read.
 *
 * @returns {{state: string, price: object|null, requirements: object|null}}
 *   state is one of:
 *     "owned"        already bought
 *     "unavailable"  the book sells no such rank
 *     "blocked"      an earlier rank is still missing (ranks are bought in order)
 *     "locked"       requirements not met
 *     "poor"         requirements met, not enough points
 *     "available"    buyable right now
 */
export function getRankState(actor, trackId, rank) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track) return { state: "unavailable", price: null, requirements: null };

  const price = track.ranks[rank - 1] ?? null;
  const held = getTrackRank(actor, track.group, track.key);

  if (rank <= held) return { state: "owned", price, requirements: null };
  if (!price) return { state: "unavailable", price: null, requirements: null };
  // A track a mirror perk copies is never bought: it follows its source
  // (rankMirrors.mjs), so every rank above the one held stays locked.
  const mirror = getActiveMirrors(actor).get(trackId);
  if (mirror) return { state: "locked", price, requirements: null, mirror };
  if (rank > held + 1) return { state: "blocked", price, requirements: null };

  const requirements = evaluateRequirements(
    actor,
    price.requires,
    trackId,
    rank,
  );
  if (!requirements.met) return { state: "locked", price, requirements };

  const wallet = getWallet(actor);
  if (wallet.remaining[price.currency] < getRankCost(actor, trackId, rank).cost) {
    return { state: "poor", price, requirements };
  }
  return { state: "available", price, requirements };
}

/* -------------------------------------------------------------------------- */
/*  Purchasing                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Buy the next rank of a track.
 *
 * Nothing is deducted here: `spent` is derived from the ranks the character
 * holds, so raising the rank IS the payment. A track bought up from 0 is also
 * made visible, since an untrained track is hidden on the sheet.
 *
 * @returns {Promise<boolean>} false when the rank was not buyable.
 */
export async function purchaseRank(actor, trackId, rank) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track) return false;

  const { state } = getRankState(actor, trackId, rank);
  if (state !== "available") return false;

  const path = `system.${track.group}.${track.key}`;
  const update = { [`${path}.value`]: rank };
  if (rank === 1 && actor.system?.[track.group]?.[track.key]?.visible === false) {
    update[`${path}.visible`] = true;
  }
  await actor.update(update);
  return true;
}

/**
 * Give a rank back. Used by the window's undo, and only ever from the top of a
 * track: refunding a middle rank would leave the ranks above it unpaid for.
 */
export async function refundRank(actor, trackId) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track) return false;

  const held = getTrackRank(actor, track.group, track.key);
  if (held < 1) return false;
  // A copied track is given back through its source, never on its own.
  if (getActiveMirrors(actor).has(trackId)) return false;
  // Rank I of a temperament's school stays while the character can channel.
  if (held === 1 && track.group === "schools" && getForcedSchool(actor) === track.key) {
    return false;
  }

  await actor.update({
    [`system.${track.group}.${track.key}.value`]: held - 1,
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Features                                                                  */
/* -------------------------------------------------------------------------- */

/*
 * A feature is bought as a whole item from the redsteel-items compendium and
 * priced by FEATURE_PRICES (featurePrices.mjs). As with ranks nothing is
 * deducted: `spent` is derived from the features the character owns, so an
 * owned feature costs its price however it got onto the sheet. A feature the
 * character's race granted is free, and so is a native language the GM granted.
 *
 * Ownership is matched by name (and former names), never by compendium source:
 * much of the pack was imported from another module and an owned copy's
 * recorded source is often a dead pointer.
 */

/** The compendium every buyable feature comes from. */
export const FEATURE_PACK_ID = "redsteel.redsteel-items";

/** The Learn window's feature sections, in the book's order. */
export const FEATURE_SECTION_IDS = ["combat", "general", "magic", "trait", "racial"];

/**
 * The families where one feature closes a skill to the others (GM ruling
 * 2026-09-11): a skill taken by a Specialization or a Talented feature cannot
 * take another of these.
 */
const SKILL_EXCLUSIVE_GROUPS = new Set([
  "specialization",
  "talented1",
  "talented2",
  "talented3",
]);

/**
 * A table entry's price as the two amounts every feature consumer reads. The
 * table names one currency per feature; `cost` and `currency` stay on the
 * entry for anything that still reads them.
 * @returns {{cp: number, sp: number}}
 */
function tablePoints(entry) {
  const cost = Number(entry?.cost) || 0;
  return {
    cp: entry?.currency === "cp" ? cost : 0,
    sp: entry?.currency === "sp" ? cost : 0,
  };
}

/** Lower-cased name, and every former name, → the price entries carrying it. */
const FEATURES_BY_NAME = (() => {
  const map = new Map();
  for (const [id, entry] of Object.entries(FEATURE_PRICES)) {
    for (const name of [entry.name, ...(entry.aliases ?? [])]) {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ id, ...entry, ...tablePoints(entry) });
    }
  }
  return map;
})();

/** The compendium uuid of a priced feature. */
export function getFeatureUuid(featureId) {
  return `Compendium.${FEATURE_PACK_ID}.Item.${featureId}`;
}

/*
 * EDITABLE COSTS (user rulings 2026-09-14). Every feature item carries its own
 * price at `system.cost.cp` / `system.cost.sp`, edited on the item sheet, and a
 * feature may cost both at once. Every price this engine hands out carries
 * `cp` and `sp`.
 *   - An owned copy's own cost is what that character paid. A copy whose cost
 *     is empty (both null) falls back to FEATURE_PRICES, which is how every copy
 *     bought before costs lived on the item keeps pricing itself.
 *   - The compendium item's cost is what a NEW purchase costs. The Learn window
 *     reads it once per window from the pack index (loadFeaturePackData), so
 *     editing a compendium item reprices nobody who already owns it.
 *   - `system.learnSection` moves a feature to another Learn section, and a
 *     non-empty `system.requirementsNote` adds a GM clause, which never blocks.
 *   - A pack feature the table does not price becomes buyable once its item
 *     has a cost.
 */

/**
 * An item's, or a pack index entry's, own cost. 0 is a price (free); a missing
 * or null amount is not.
 * @returns {{cp: number, sp: number}|null} null when neither amount is set
 */
export function readItemFeatureCost(itemOrIndexEntry) {
  const cost = itemOrIndexEntry?.system?.cost;
  const amount = (value) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const cp = amount(cost?.cp);
  const sp = amount(cost?.sp);
  if (cp === null && sp === null) return null;
  return { cp: cp ?? 0, sp: sp ?? 0 };
}

/** A price with a feature item's Learn section and requirements note applied. */
function applyFeatureOverrides(price, learnSection, requirementsNote) {
  const out = { ...price };
  const section = String(learnSection ?? "").trim();
  if (FEATURE_SECTION_IDS.includes(section)) out.section = section;
  const text = String(requirementsNote ?? "").trim();
  if (text) out.requires = [...(out.requires ?? []), { t: "gm", note: "custom", text }];
  return out;
}

/** The entry of a feature only its own item prices (no FEATURE_PRICES row). */
function customFeatureEntry(id, name, learnSection) {
  const section = String(learnSection ?? "").trim();
  return {
    id,
    name,
    section: FEATURE_SECTION_IDS.includes(section) ? section : "general",
    folder: "",
    requires: [],
    custom: true,
  };
}

/** Compendium id → {id, name, cost, learnSection, requirementsNote}, from the pack index. */
const FEATURE_PACK_DATA = new Map();

/**
 * Read the feature pack's index and remember every feature's own cost, Learn
 * section and requirements note, which price NEW purchases (getFeaturePrice).
 * The Learn window calls this once per window, so a compendium edit shows up
 * the next time a window opens.
 * @returns {Promise<Collection|null>} the index, or null when the pack is missing
 */
export async function loadFeaturePackData() {
  const pack = game.packs?.get(FEATURE_PACK_ID);
  if (!pack) return null;
  const index = await pack.getIndex({
    fields: [
      "type",
      "img",
      "system.option",
      "system.cost",
      "system.learnSection",
      "system.requirementsNote",
      "system.localizationKey",
      "system.description",
    ],
  });
  FEATURE_PACK_DATA.clear();
  // .contents, not for...of: iterating a Collection yields [key, value].
  for (const entry of index.contents) {
    if (entry.type !== "feature" || entry.system?.option !== "feature") continue;
    FEATURE_PACK_DATA.set(entry._id, {
      id: entry._id,
      name: entry.name,
      cost: readItemFeatureCost(entry),
      learnSection: entry.system?.learnSection ?? "",
      requirementsNote: entry.system?.requirementsNote ?? "",
    });
  }
  return index;
}

/**
 * The price of a feature id for a NEW purchase, or null. The table's entry,
 * with the compendium item's own cost in its place when it has one; for a pack
 * feature the table does not price, an entry built from its item.
 */
export function getFeaturePrice(featureId) {
  const entry = FEATURE_PRICES[featureId];
  const packed = FEATURE_PACK_DATA.get(featureId);
  let price;
  if (entry) {
    price = { id: featureId, ...entry, ...tablePoints(entry), ...(packed?.cost ?? {}) };
  } else if (packed?.cost) {
    price = { ...customFeatureEntry(featureId, packed.name, packed.learnSection), ...packed.cost };
  } else {
    return null;
  }
  return applyFeatureOverrides(price, packed?.learnSection, packed?.requirementsNote);
}

/**
 * Every feature id the Learn window lists: the table's, then each pack feature
 * the table does not price but whose item has a cost (known once
 * loadFeaturePackData has run).
 */
export function getFeatureCatalogIds() {
  const ids = Object.keys(FEATURE_PRICES);
  for (const data of FEATURE_PACK_DATA.values()) {
    if (data.cost && !FEATURE_PRICES[data.id]) ids.push(data.id);
  }
  return ids;
}

/**
 * The book's price entry for a feature item, from FEATURE_PRICES alone, or null.
 * Matched by name. Two entries can share a name (the human and the elven
 * Specialization): the one whose race the actor meets wins, and they cost the
 * same either way. Without an actor (a world or compendium item) the first.
 */
export function getBookFeaturePrice(actor, item) {
  if (item?.type !== "feature" || item.system?.option !== "feature") return null;
  const matches = FEATURES_BY_NAME.get(String(item.name ?? "").toLowerCase());
  if (!matches?.length) return null;
  if (matches.length === 1 || !actor) return { ...matches[0] };
  const match =
    matches.find((candidate) =>
      (candidate.requires ?? [])
        .filter((req) => req.t === "race")
        .every((req) => evaluateRequirement(actor, req).met),
    ) ?? matches[0];
  return { ...match };
}

/**
 * The price entry an owned feature item stands for, or null when neither the
 * item nor the table prices it. The copy's own cost is what this character
 * paid; a copy with none falls back to the book.
 */
export function getFeaturePriceForItem(actor, item) {
  if (item?.type !== "feature" || item.system?.option !== "feature") return null;
  const book = getBookFeaturePrice(actor, item);
  const own = readItemFeatureCost(item);
  let price;
  if (own) {
    price = { ...(book ?? customFeatureEntry(null, item.name, item.system?.learnSection)), ...own };
  } else if (book) {
    price = book;
  } else {
    return null;
  }
  return applyLinguistDiscount(
    actor,
    applyFeatureOverrides(price, item.system?.learnSection, item.system?.requirementsNote),
  );
}

/** Every owned feature item, with the price entry it stands for (or null). */
export function getOwnedFeatures(actor) {
  return (actor?.items?.contents ?? [])
    .filter((item) => item.type === "feature" && item.system?.option === "feature")
    .map((item) => ({ item, price: getFeaturePriceForItem(actor, item) }));
}

/** True when the actor's race put this feature on the sheet, which makes it free. */
export function isRaceGrantedFeature(item) {
  return !!item?.getFlag?.("redsteel", "raceGranted");
}

/** True for a language copy the GM granted as the native language, which is free. */
export function isNativeLanguageFeature(item) {
  return !!item?.flags?.redsteel?.nativeLanguage;
}

/** What the character's owned features cost: each copy's own price, else the book's. */
export function computeSpentOnFeatures(actor) {
  const spent = { cp: 0, sp: 0 };
  for (const { item, price } of getOwnedFeatures(actor)) {
    if (!price || isRaceGrantedFeature(item) || isNativeLanguageFeature(item)) continue;
    spent.cp += Number(price.cp) || 0;
    spent.sp += Number(price.sp) || 0;
  }
  return spent;
}

/**
 * What keeps this feature from being taken, if anything: another owned feature
 * of the same pick-once group, a Specialization / Talented feature already on
 * the same skill, or a discount the skill already carries from another source
 * (discounts on one skill do not stack, see rankDiscounts.mjs).
 * @returns {{reason: "pickOnce"|"skillTaken"|"discountTaken", item: Item|null,
 *            source?: object}|null}
 */
function findFeatureConflict(actor, owned, price) {
  if (price.group) {
    for (const { item, price: other } of owned) {
      if (!other?.group) continue;
      if (other.group === price.group) return { reason: "pickOnce", item };
      if (
        SKILL_EXCLUSIVE_GROUPS.has(price.group) &&
        SKILL_EXCLUSIVE_GROUPS.has(other.group) &&
        other.skill === price.skill
      ) {
        return { reason: "skillTaken", item };
      }
    }
  }
  const skill = fixedDiscountSkill(price);
  const other = skill
    ? findOtherDiscountOn(actor, discountGroup(featureDiscountDef(price)), skill, null)
    : null;
  if (other) return { reason: "discountTaken", item: other.item ?? null, source: other };
  return null;
}

/**
 * Whether the wallet covers a price. Each currency the price actually asks for
 * is checked, so an overdrawn CP balance does not block an SP-only feature.
 */
function canAfford(actor, price) {
  const cp = Number(price?.cp) || 0;
  const sp = Number(price?.sp) || 0;
  const { remaining } = getWallet(actor);
  return !((cp > 0 && remaining.cp < cp) || (sp > 0 && remaining.sp < sp));
}

/**
 * How one feature reads in the Learn window.
 *
 * @returns {{state: string, price: object|null, requirements: object|null,
 *            conflict: object|null}}
 *   state is one of:
 *     "owned"        the character has it
 *     "taken"        its pick-once group or its skill is already used
 *     "locked"       requirements not met
 *     "poor"         requirements met, not enough points
 *     "available"    buyable right now
 *     "unavailable"  nothing prices it, or it is a language feature, which is
 *                    learnt per language instead (getLanguageFeatureState)
 */
export function getFeatureState(actor, featureId) {
  const price = getFeaturePrice(featureId);
  if (!price) {
    return { state: "unavailable", price: null, requirements: null, conflict: null };
  }
  if (price.language) {
    return { state: "unavailable", price, requirements: null, conflict: null };
  }
  const owned = getOwnedFeatures(actor);
  const names = new Set(
    [price.name, ...(price.aliases ?? [])].map((name) => name.toLowerCase()),
  );
  if (owned.some(({ item }) => names.has(String(item.name).toLowerCase()))) {
    return { state: "owned", price, requirements: null, conflict: null };
  }
  const requirements = evaluateRequirements(actor, price.requires);
  const conflict = findFeatureConflict(actor, owned, price);
  if (conflict) return { state: "taken", price, requirements, conflict };
  if (!requirements.met) {
    return { state: "locked", price, requirements, conflict: null };
  }
  if (!canAfford(actor, price)) {
    return { state: "poor", price, requirements, conflict: null };
  }
  return { state: "available", price, requirements, conflict: null };
}

/** A compendium feature's data, ready to create on an actor, or null. */
async function featureCopyData(featureId) {
  if (!featureId) return null;
  const uuid = getFeatureUuid(featureId);
  const source = await fromUuid(uuid);
  if (!source || source.type !== "feature") return null;
  const data = source.toObject();
  delete data._id;
  data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
  return data;
}

/**
 * Buy a feature: copy the compendium item onto the actor. The copy records the
 * uuid it came from, the same way race and ability grants do, and keeps the
 * compendium item's own cost, which is then what this character paid.
 * @returns {Promise<boolean>} false when the feature was not buyable.
 */
export async function purchaseFeature(actor, featureId) {
  const { state } = getFeatureState(actor, featureId);
  if (state !== "available") return false;
  const data = await featureCopyData(featureId);
  if (!data) return false;
  await actor.createEmbeddedDocuments("Item", [data]);
  return true;
}

/**
 * Give a bought feature back by deleting the owned copy. Only a priced feature,
 * and never one the race granted: removing those would not refund anything and
 * the race would put it back. A language copy follows the language rules
 * (checkLanguageRefund), and giving back a native language removes its pair.
 * @returns {Promise<{ok: boolean, reason: string|null, language?: string}>}
 *   `reason` names why a language copy was refused, for the window's warning;
 *   null when there is nothing to explain.
 */
export async function refundFeature(actor, itemId) {
  const item = actor?.items?.get(itemId);
  if (!item || isRaceGrantedFeature(item)) return { ok: false, reason: null };
  const price = getFeaturePriceForItem(actor, item);
  if (!price) return { ok: false, reason: null };
  let ids = [itemId];
  if (price.language) {
    const check = checkLanguageRefund(actor, item);
    if (!check.ok) return check;
    ids = check.ids;
  }
  await actor.deleteEmbeddedDocuments("Item", ids);
  return { ok: true, reason: null };
}

/* -------------------------------------------------------------------------- */
/*  Languages                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * LANGUAGES (user rulings 2026-09-14). The four language features are bought
 * once PER LANGUAGE, in the Learn window's Languages panel, never as ordinary
 * feature rows. The language is free text the player types, stored trimmed on
 * each owned copy at `flags.redsteel.language` and compared case-insensitively
 * after trimming and NFC normalization (languageKey).
 *   - A language is known once the character has its Basic communication, and
 *     Fluent speech, Sign language and Reading and writing need that first.
 *   - The first Reading and writing is the full-price feature; reading any
 *     further language is the cheaper "Additional language" one.
 *   - The GM may grant a native language per character: free Basic
 *     communication and Fluent speech copies, also flagged
 *     `flags.redsteel.nativeLanguage`. The wallet does not count them, and only
 *     the GM can give them back, as a pair. One per character, two with the
 *     Linguist trait (getNativeLanguageLimit).
 */

/*
 * LINGUIST (positive trait, user ruling 2026-09-16). Its Active Effect sets
 * `system.linguist`, the way Magic potential sets `system.magicPotential`.
 * Two clauses:
 *   - every language slot except Sign language costs nothing. The wallet
 *     derives what a character spent, so this is retroactive: taking the trait
 *     gives back the points already paid for its languages.
 *   - the GM may grant it a second native language ("+1 začáteční jazyk").
 * Sign language is paid for as usual (user ruling).
 */

/** True when the character carries the Linguist trait. */
export function hasLinguist(actor) {
  return !!actor?.system?.linguist;
}

/** How many native languages the GM may grant this character. */
export function getNativeLanguageLimit(actor) {
  return hasLinguist(actor) ? 2 : 1;
}

/**
 * A price with Linguist applied. Only a language feature's price changes, and
 * never Sign language's; everything else is handed back untouched.
 */
function applyLinguistDiscount(actor, price) {
  if (!price?.language || price.language === "sign") return price;
  if (!hasLinguist(actor)) return price;
  return { ...price, cp: 0, sp: 0 };
}

/** A language feature's price for a NEW purchase, with Linguist applied. */
export function getLanguageFeaturePrice(actor, featureId) {
  const price = featureId ? getFeaturePrice(featureId) : null;
  return price ? applyLinguistDiscount(actor, price) : null;
}

/** The slots a language is learnt in, in the panel's column order. */
export const LANGUAGE_SLOTS = ["basic", "fluent", "sign", "reading"];

/** The table's language features: slot → id, with reading split by tier. */
export const LANGUAGE_FEATURE_IDS = (() => {
  const ids = { basic: null, fluent: null, sign: null, reading: null, readingAdditional: null };
  for (const [id, entry] of Object.entries(FEATURE_PRICES)) {
    if (!entry.language) continue;
    if (entry.language !== "reading") ids[entry.language] = id;
    else if (entry.readingTier === "additional") ids.readingAdditional = id;
    else ids.reading = id;
  }
  return Object.freeze(ids);
})();

/** " Landea " and "landea" compare equal: trimmed, NFC-normalized, lower-cased. */
export function languageKey(name) {
  return String(name ?? "").trim().normalize("NFC").toLowerCase();
}

/**
 * Every owned language copy, whatever its language.
 * @returns {Array<{item: Item, price: object, slot: string, tier: string|null,
 *   name: string, key: string, native: boolean}>}
 */
function getLanguageCopies(actor) {
  const copies = [];
  for (const { item, price } of getOwnedFeatures(actor)) {
    if (!price?.language) continue;
    const flag = item.flags?.redsteel?.language;
    const name = typeof flag === "string" ? flag.trim() : "";
    copies.push({
      item,
      price,
      slot: price.language,
      tier:
        price.language === "reading"
          ? price.readingTier === "additional"
            ? "additional"
            : "first"
          : null,
      name,
      key: languageKey(name),
      native: isNativeLanguageFeature(item),
    });
  }
  return copies;
}

/**
 * The languages the character knows (those with Basic communication), the
 * native one first, then by name.
 * @returns {Array<{name: string, key: string, native: boolean,
 *   slots: {basic: Item|null, fluent: Item|null, sign: Item|null, reading: Item|null}}>}
 *   `reading` is either tier of Reading and writing.
 */
export function getKnownLanguages(actor) {
  const byKey = new Map();
  for (const copy of getLanguageCopies(actor)) {
    if (!copy.key) continue;
    if (!byKey.has(copy.key)) {
      byKey.set(copy.key, {
        name: copy.name,
        key: copy.key,
        native: false,
        slots: { basic: null, fluent: null, sign: null, reading: null },
      });
    }
    const language = byKey.get(copy.key);
    language.slots[copy.slot] ??= copy.item;
    // The name as it was typed when Basic communication was learnt.
    if (copy.slot === "basic" && language.slots.basic === copy.item) language.name = copy.name;
    if (copy.native) language.native = true;
  }
  const lang = game.i18n?.lang;
  return [...byKey.values()]
    .filter((language) => language.slots.basic)
    .sort((a, b) =>
      a.native === b.native ? a.name.localeCompare(b.name, lang) : a.native ? -1 : 1,
    );
}

/**
 * Which feature a slot is learnt with for a language. Reading and writing is
 * the "Additional language" feature once the character reads a different
 * language with the first one; every other slot has a single feature.
 */
export function getLanguageSlotFeatureId(actor, slot, language) {
  if (slot !== "reading") return LANGUAGE_FEATURE_IDS[slot] ?? null;
  const key = languageKey(language);
  const readsAnother = getLanguageCopies(actor).some(
    (copy) => copy.slot === "reading" && copy.tier === "first" && copy.key !== key,
  );
  return readsAnother && LANGUAGE_FEATURE_IDS.readingAdditional
    ? LANGUAGE_FEATURE_IDS.readingAdditional
    : LANGUAGE_FEATURE_IDS.reading;
}

/**
 * How one language slot reads in the Languages panel.
 * @returns {{state: string, featureId: string|null, price: object|null,
 *            requirements: object|null, reason?: string}}
 *   state is one of:
 *     "taken"        Basic communication in a language already known (reason
 *                    "alreadyKnown"). Checked before "owned": for Basic, owning
 *                    the copy and knowing the language are the same thing.
 *     "owned"        a copy for this slot and language exists
 *     "blocked"      no Basic communication in that language yet (reason "needsBasic")
 *     "locked"       requirements not met
 *     "poor"         requirements met, not enough points
 *     "available"    buyable right now
 *     "unavailable"  no such slot, or its feature is not priced
 */
export function getLanguageFeatureState(actor, slot, language) {
  const name = String(language ?? "").trim();
  const key = languageKey(name);
  const featureId = LANGUAGE_SLOTS.includes(slot)
    ? getLanguageSlotFeatureId(actor, slot, name)
    : null;
  const price = getLanguageFeaturePrice(actor, featureId);
  if (!price) return { state: "unavailable", featureId, price: null, requirements: null };
  const copies = key ? getLanguageCopies(actor).filter((copy) => copy.key === key) : [];
  const known = copies.some((copy) => copy.slot === "basic");
  if (slot === "basic" && known) {
    return { state: "taken", featureId, price, requirements: null, reason: "alreadyKnown" };
  }
  if (copies.some((copy) => copy.slot === slot)) {
    return { state: "owned", featureId, price, requirements: null };
  }
  const requirements = evaluateRequirements(actor, price.requires);
  if (slot !== "basic" && !known) {
    return { state: "blocked", featureId, price, requirements, reason: "needsBasic" };
  }
  if (!requirements.met) return { state: "locked", featureId, price, requirements };
  if (!canAfford(actor, price)) return { state: "poor", featureId, price, requirements };
  return { state: "available", featureId, price, requirements };
}

/** Mark a compendium feature copy with its language (and as native). */
function flagLanguageCopy(data, language, native = false) {
  data.flags = {
    ...(data.flags ?? {}),
    redsteel: {
      ...(data.flags?.redsteel ?? {}),
      language,
      ...(native ? { nativeLanguage: true } : {}),
    },
  };
  return data;
}

/**
 * Learn one language slot: copy its compendium feature onto the actor, flagged
 * with the trimmed language name.
 * @returns {Promise<boolean>} false when the name is empty or the slot is not buyable
 */
export async function purchaseLanguageFeature(actor, slot, language) {
  const name = String(language ?? "").trim();
  if (!actor || !name) return false;
  const { state, featureId } = getLanguageFeatureState(actor, slot, name);
  if (state !== "available") return false;
  const data = await featureCopyData(featureId);
  if (!data) return false;
  await actor.createEmbeddedDocuments("Item", [flagLanguageCopy(data, name)]);
  return true;
}

/**
 * GM only: grant the character a native language, a free Basic communication
 * and Fluent speech in it. Up to getNativeLanguageLimit(actor) of them, and
 * never a language the character already knows.
 * @returns {Promise<{ok: boolean, reason: string|null}>} reason is one of
 *   "gmOnly", "nameRequired", "nativeTaken", "alreadyKnown", or null
 */
export async function grantNativeLanguage(actor, language) {
  if (!game.user?.isGM) return { ok: false, reason: "gmOnly" };
  const name = String(language ?? "").trim();
  if (!actor || !name) return { ok: false, reason: "nameRequired" };
  const copies = getLanguageCopies(actor);
  // Counted by language, not by copy: one grant is a Basic + Fluent pair.
  const natives = new Set(
    copies.filter((copy) => copy.native && copy.key).map((copy) => copy.key),
  );
  if (natives.size >= getNativeLanguageLimit(actor)) {
    return { ok: false, reason: "nativeTaken" };
  }
  const key = languageKey(name);
  if (copies.some((copy) => copy.key === key && copy.slot === "basic")) {
    return { ok: false, reason: "alreadyKnown" };
  }
  const data = [];
  for (const slot of ["basic", "fluent"]) {
    const copy = await featureCopyData(LANGUAGE_FEATURE_IDS[slot]);
    if (!copy) return { ok: false, reason: null };
    data.push(flagLanguageCopy(copy, name, true));
  }
  await actor.createEmbeddedDocuments("Item", data);
  return { ok: true, reason: null };
}

/**
 * Whether a language copy may be given back, and which copies go with it.
 *   - A native copy only by the GM, and it takes its native Basic + Fluent
 *     pair with it; refused while that language still has Sign language or
 *     Reading and writing.
 *   - Basic communication is refused while that language has any other slot.
 *   - The first Reading and writing is refused while any additional-language
 *     reading exists.
 * @returns {{ok: true, ids: string[]}|{ok: false, reason: string, language?: string}}
 */
function checkLanguageRefund(actor, item) {
  const copies = getLanguageCopies(actor);
  const self = copies.find((copy) => copy.item.id === item.id);
  if (!self) return { ok: true, ids: [item.id] };
  const others = copies.filter((copy) => copy.item.id !== item.id);
  const sameLanguage = self.key ? others.filter((copy) => copy.key === self.key) : [];
  if (self.native) {
    if (!game.user?.isGM) return { ok: false, reason: "nativeGmOnly" };
    if (sameLanguage.some((copy) => copy.slot === "sign" || copy.slot === "reading")) {
      return { ok: false, reason: "refundDependents", language: self.name };
    }
    const pair = sameLanguage.filter(
      (copy) => copy.native && (copy.slot === "basic" || copy.slot === "fluent"),
    );
    return { ok: true, ids: [item.id, ...pair.map((copy) => copy.item.id)] };
  }
  if (self.slot === "basic" && sameLanguage.some((copy) => copy.slot !== "basic")) {
    return { ok: false, reason: "refundDependents", language: self.name };
  }
  if (
    self.tier === "first" &&
    others.some((copy) => copy.slot === "reading" && copy.tier === "additional")
  ) {
    return { ok: false, reason: "refundReadingFirst" };
  }
  return { ok: true, ids: [item.id] };
}

/* -------------------------------------------------------------------------- */
/*  Rank discounts                                                            */
/* -------------------------------------------------------------------------- */

/*
 * Features and specialisation perks that make every rank of one skill (or one
 * doctrine) cheaper. The data and the rules behind it live in rankDiscounts.mjs:
 * one discount per track, retroactive, applied only in its own currency. A "one
 * from a list" source stores the player's pick at
 * `system.progression.discountChoices.<sourceId>`, made in the Learn window.
 */

/** The track group a discount definition lands in. */
function discountGroup(def) {
  return def?.group ?? "skills";
}

/**
 * The keys a choice definition allows, from the price table's tracks (and,
 * for a `specialisations` choice, from the character's own owned
 * specialisations that price at least one node in the discount's currency).
 */
function discountChoiceSkills(def, actor) {
  const { choices, currency } = def;
  const group = discountGroup(def);
  const keys = new Set();
  for (const track of Object.values(PROGRESSION_TRACKS)) {
    if (track.group !== group) continue;
    if (!track.ranks?.some((rank) => rank.currency === currency)) continue;
    if (
      choices.noncombat &&
      group === "skills" &&
      !NONCOMBAT_EXCLUDED.includes(track.key)
    ) {
      keys.add(track.key);
    }
    if ((choices.sections ?? []).includes(track.section)) keys.add(track.key);
  }
  for (const key of choices.skills ?? []) keys.add(key);
  if (choices.specialisations) {
    for (const specId of Object.keys(actor?.system?.specialisations ?? {})) {
      if (!isSpecActive(actor, specId)) continue;
      const priced = Object.values(SPEC_NODE_PRICES[specId] ?? {}).some(
        (price) => (Number(price[currency]) || 0) > 0,
      );
      if (priced) keys.add(specId);
    }
  }
  return [...keys];
}

/** The discount definition a priced feature carries, or null. */
function featureDiscountDef(price) {
  return (
    FEATURE_DISCOUNTS.groups[price?.group] ??
    FEATURE_DISCOUNTS.names[price?.name] ??
    null
  );
}

/** The fixed skill a feature's discount lands on, or null (none, or a choice). */
function fixedDiscountSkill(price) {
  const def = featureDiscountDef(price);
  if (!def?.skill) return null;
  return def.skill === "own" ? (price.skill ?? null) : def.skill;
}

/**
 * Every discount the character has, from owned features and unlocked
 * specialisation perks, with the key each lands on (null while a choice is
 * still unpicked, or when the stored pick is no longer allowed). `skill` is a
 * key of `group`: a skill, or a doctrine for a doctrine discount.
 *
 * @returns {Array<{id: string, kind: "feature"|"spec", amount: number,
 *   currency: string, group: string, skill: string|null,
 *   choices: string[]|null, item?: Item, spec?: string, node?: string}>}
 */
export function getDiscountSources(actor) {
  const sources = [];
  const picked = actor?.system?.progression?.discountChoices ?? {};
  const add = (id, def, skill, extra) => {
    const choices = def.choices ? discountChoiceSkills(def, actor) : null;
    let landsOn = skill ?? null;
    if (!landsOn && choices && choices.includes(picked[id])) landsOn = picked[id];
    sources.push({
      id,
      amount: def.amount,
      currency: def.currency,
      group: discountGroup(def),
      skill: landsOn,
      choices,
      ...extra,
    });
  };
  for (const { item, price } of getOwnedFeatures(actor)) {
    const def = featureDiscountDef(price);
    if (!def) continue;
    add(`feature-${item.id}`, def, fixedDiscountSkill(price), { kind: "feature", item });
  }
  for (const [spec, nodes] of Object.entries(SPEC_DISCOUNTS)) {
    for (const [node, def] of Object.entries(nodes)) {
      if (!actorHasSpecNode(actor, spec, node)) continue;
      add(`spec-${spec}-${node}`, def, def.skill ?? null, { kind: "spec", spec, node });
    }
  }
  return sources;
}

/**
 * The discount each track carries: track id ("skills.stealth",
 * "doctrines.duelist") → source. One per track; should an older sheet still
 * hold two (taken before the rule was enforced), the larger one counts, so a
 * character is never charged for the overlap.
 */
export function getSkillDiscounts(actor, sources = getDiscountSources(actor)) {
  const map = new Map();
  for (const source of sources) {
    if (!source.skill) continue;
    const trackId = `${source.group}.${source.skill}`;
    const current = map.get(trackId);
    if (!current || source.amount > current.amount) map.set(trackId, source);
  }
  return map;
}

/**
 * What one rank of a track costs this character: the book price less the
 * track's discount, when that discount is in the rank's own currency, never
 * below 0. A rank copied from another track by a mirror perk costs 0; the
 * ranks paid for before the pick keep their price. Rank I of the first school
 * of magic costs 0 too (getFreeSchool), and says so as a `freeSchool` discount.
 * @returns {{cost: number, base: number, currency: string,
 *            discount: object|null}|null}
 */
export function getRankCost(
  actor,
  trackId,
  rank,
  discounts = getSkillDiscounts(actor),
  mirrors = getActiveMirrors(actor),
  freeSchool = getFreeSchool(actor),
) {
  const track = PROGRESSION_TRACKS[trackId];
  const price = track?.ranks?.[rank - 1];
  if (!price) return null;
  const mirror = mirrors.get(trackId);
  if (mirror && rank > mirror.own) {
    return { base: price.cost, cost: 0, currency: price.currency, discount: null };
  }
  // With no school held yet, whichever school is learned first is the free one.
  if (
    track.group === "schools" &&
    rank === 1 &&
    (freeSchool.school ?? track.key) === track.key
  ) {
    return {
      base: price.cost,
      cost: 0,
      currency: price.currency,
      discount: { kind: "freeSchool", school: track.key, trait: freeSchool.trait },
    };
  }
  const source = discounts.get(trackId) ?? null;
  const discount = source && source.currency === price.currency ? source : null;
  return {
    base: price.cost,
    cost: discount ? Math.max(0, price.cost - discount.amount) : price.cost,
    currency: price.currency,
    discount,
  };
}

/** Another discount source already landing on this track, or null. */
function findOtherDiscountOn(actor, group, skill, exceptId) {
  if (!skill) return null;
  return (
    getDiscountSources(actor).find(
      (source) =>
        source.group === group &&
        source.skill === skill &&
        source.id !== exceptId,
    ) ?? null
  );
}

/** A discount source's player-facing name: the feature's, or the perk's. */
export function getDiscountSourceLabel(source) {
  if (source?.kind === "feature") {
    return source.item?.localizedName ?? source.item?.name ?? "";
  }
  const key = `REDSTEEL.Actor.Specialisations.${source?.spec}.nodes.${source?.node}.label`;
  return game.i18n.has(key, false) ? game.i18n.localize(key) : String(source?.node ?? "");
}

/**
 * The discount that already covers the skill a fixed-skill perk would
 * discount, if any; unlocking that perk is refused. A "from a list" perk never
 * clashes: its picker simply offers the skills that are still free.
 * @returns {{skill: string, source: object}|null}
 */
export function getSpecNodeDiscountConflict(actor, specId, nodeId) {
  const def = SPEC_DISCOUNTS[specId]?.[nodeId];
  if (!def?.skill) return null;
  const other = findOtherDiscountOn(
    actor,
    discountGroup(def),
    def.skill,
    `spec-${specId}-${nodeId}`,
  );
  return other ? { skill: def.skill, source: other } : null;
}

/**
 * The keys a choice source may pick (skills, or doctrines for a doctrine
 * discount), each marked `taken` when another source already discounts it.
 * @returns {Array<{key: string, taken: boolean}>}
 */
export function getDiscountChoiceOptions(actor, sourceId, sources = getDiscountSources(actor)) {
  const source = sources.find((entry) => entry.id === sourceId);
  if (!source?.choices) return [];
  const taken = new Set(
    sources
      .filter(
        (entry) =>
          entry.id !== sourceId && entry.skill && entry.group === source.group,
      )
      .map((entry) => entry.skill),
  );
  return source.choices.map((key) => ({ key, taken: taken.has(key) }));
}

/**
 * Store (or clear, with an empty skill) the pick of a choice source. A skill
 * outside the list, or one another source already discounts, is refused.
 * @returns {Promise<boolean>}
 */
export async function setDiscountChoice(actor, sourceId, skill) {
  if (skill) {
    const option = getDiscountChoiceOptions(actor, sourceId).find(
      (entry) => entry.key === skill,
    );
    if (!option || option.taken) return false;
  }
  await actor.update({
    [`system.progression.discountChoices.${sourceId}`]: skill || "",
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Rank mirrors                                                              */
/* -------------------------------------------------------------------------- */

/*
 * Perks that make one track copy the rank of another (rankMirrors.mjs). The
 * pick is stored at `system.progression.skillMirrors.<sourceId>` as
 * {skill, own}: `skill` the chosen key ("" while unpicked), `own` the ranks the
 * character had paid for in it when it was picked. While the node holds, the
 * chosen track's stored rank is the higher of `own` and the source's rank, so
 * every reader sees a real rank. syncSkillMirrors keeps it there, on the
 * client that made the change.
 */

/** A mirror definition by its source id ("spec-hoplite-hoplitaStance"), or null. */
function findMirrorDef(sourceId) {
  for (const [spec, nodes] of Object.entries(SPEC_MIRRORS)) {
    for (const [node, def] of Object.entries(nodes)) {
      if (`spec-${spec}-${node}` === sourceId) return { spec, node, def };
    }
  }
  return null;
}

/** The track groups any mirror lives in, for the update hook's filter. */
const MIRROR_GROUPS = new Set(
  Object.values(SPEC_MIRRORS).flatMap((nodes) =>
    Object.values(nodes).map((def) => def.group),
  ),
);

/**
 * The mirror perks the character has unlocked, with their picks (`skill` null
 * while unpicked), optionally only one specialisation's.
 * @returns {Array<{id: string, spec: string, node: string, group: string,
 *   from: string, choices: string[], skill: string|null}>}
 */
export function getMirrorSources(actor, specId = null) {
  const stored = actor?.system?.progression?.skillMirrors ?? {};
  const sources = [];
  for (const [spec, nodes] of Object.entries(SPEC_MIRRORS)) {
    if (specId && spec !== specId) continue;
    for (const [node, def] of Object.entries(nodes)) {
      if (!actorHasSpecNode(actor, spec, node)) continue;
      const id = `spec-${spec}-${node}`;
      const picked = stored[id]?.skill;
      sources.push({
        id,
        spec,
        node,
        group: def.group,
        from: def.from,
        choices: [...def.choices],
        skill: def.choices.includes(picked) ? picked : null,
      });
    }
  }
  return sources;
}

/**
 * Every picked mirror whose node still holds, by the track it copies onto
 * ("weaponSkills.swords").
 * @returns {Map<string, {id: string, group: string, from: string,
 *   skill: string, own: number}>}
 */
export function getActiveMirrors(actor) {
  const map = new Map();
  const stored = actor?.system?.progression?.skillMirrors ?? {};
  for (const source of getMirrorSources(actor)) {
    if (!source.skill) continue;
    map.set(`${source.group}.${source.skill}`, {
      id: source.id,
      group: source.group,
      from: source.from,
      skill: source.skill,
      own: Number(stored[source.id]?.own) || 0,
    });
  }
  return map;
}

/**
 * Store (or clear, with an empty skill) a mirror's pick, in one update so the
 * ability grants see every rank it moves together. The track given up goes back
 * to the ranks paid for in it; the track picked keeps its own ranks as `own`
 * and takes the source's rank when that is higher.
 * @returns {Promise<boolean>} false for a pick outside the list, or a node
 *   that is not unlocked.
 */
export async function setMirrorChoice(actor, sourceId, skill) {
  const found = findMirrorDef(sourceId);
  if (!found) return false;
  const { spec, node, def } = found;
  if (!actorHasSpecNode(actor, spec, node)) return false;
  if (skill && !def.choices.includes(skill)) return false;

  const record = actor.system?.progression?.skillMirrors?.[sourceId];
  const previous = def.choices.includes(record?.skill) ? record.skill : "";
  if (previous === (skill || "")) return true;

  const update = {};
  if (previous) {
    update[`system.${def.group}.${previous}.value`] = Number(record.own) || 0;
  }
  if (skill) {
    const path = `system.${def.group}.${skill}`;
    const own = getTrackRank(actor, def.group, skill);
    const rank = Math.max(own, getTrackRank(actor, def.group, def.from));
    update[`${path}.value`] = rank;
    // An untrained track is hidden on the sheet; the copy trains it.
    if (rank > 0 && actor.system?.[def.group]?.[skill]?.visible === false) {
      update[`${path}.visible`] = true;
    }
    update[`system.progression.skillMirrors.${sourceId}`] = { skill, own };
  } else {
    update[`system.progression.skillMirrors.${sourceId}`] = { skill: "", own: 0 };
  }
  await actor.update(update);
  return true;
}

/**
 * Keep every picked mirror in step: its track at the higher of its own ranks
 * and the source's rank while the node holds, and back at its own ranks with
 * the pick dropped once the node is locked or the specialisation is gone.
 * Writes only what differs, so its own update finds nothing left to do.
 */
export async function syncSkillMirrors(actor) {
  const stored = actor?.system?.progression?.skillMirrors;
  if (!stored) return;
  const update = {};
  for (const [spec, nodes] of Object.entries(SPEC_MIRRORS)) {
    for (const [node, def] of Object.entries(nodes)) {
      const id = `spec-${spec}-${node}`;
      const record = stored[id];
      if (!record?.skill || !def.choices.includes(record.skill)) continue;
      const own = Number(record.own) || 0;
      const held = getTrackRank(actor, def.group, record.skill);
      const valuePath = `system.${def.group}.${record.skill}.value`;
      if (!actorHasSpecNode(actor, spec, node)) {
        if (held !== own) update[valuePath] = own;
        update[`system.progression.skillMirrors.${id}`] = { skill: "", own: 0 };
        continue;
      }
      const rank = Math.max(own, getTrackRank(actor, def.group, def.from));
      if (held !== rank) update[valuePath] = rank;
    }
  }
  if (Object.keys(update).length) await actor.update(update);
}

/**
 * Re-sync the mirrors whenever something that moves them changes: a rank in a
 * mirrored group (the source, or a hand edit of the copy on the sheet), a node
 * or specialisation, or the pick itself. Only the client that made the change
 * writes.
 */
export function registerSkillMirrors() {
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (game.user.id !== userId) return;
    const system = changes.system;
    if (!system) return;
    if (
      [...MIRROR_GROUPS].some((group) => system[group]) ||
      system.specialisations ||
      system.progression?.skillMirrors
    ) {
      syncSkillMirrors(actor);
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  Nodes that come with their specialisation                                 */
/* -------------------------------------------------------------------------- */

/**
 * Keep every autoUnlock node (Magic Blood) in step with its specialisation:
 * unlocked, for free, while the specialisation is active, and locked once it is
 * not. Writes only what differs, so its own update finds nothing left to do.
 */
export async function syncAutoSpecNodes(actor) {
  if (actor?.type !== "character") return;
  const update = {};
  const changed = [];
  for (const [specId, def] of Object.entries(REDSTEEL.specialisations ?? {})) {
    const active = isSpecActive(actor, specId);
    for (const nodeId of Object.keys(def.nodes ?? {})) {
      if (!isAutoUnlockNode(specId, nodeId)) continue;
      const held = !!actor.system?.specialisations?.[specId]?.nodes?.[nodeId];
      if (held === active) continue;
      update[`system.specialisations.${specId}.nodes.${nodeId}`] = active;
      changed.push({ specId, nodeId, active });
    }
  }
  if (!changed.length) return;
  await actor.update(update);
  for (const { specId, nodeId, active } of changed) {
    await syncSpecialisationPassive(actor, specId, nodeId, active);
  }
}

/**
 * Sync autoUnlock nodes whenever a specialisation or node changes, on the
 * client that made the change (a Learn window purchase, a refund, or the GM's
 * config checkbox), and once at start-up on the active GM, so characters who
 * already had the specialisation receive the node too.
 */
export function registerAutoSpecNodes() {
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (!changes.system?.specialisations) return;
    syncAutoSpecNodes(actor);
  });
  Hooks.once("ready", async () => {
    if (game.user.id !== game.users.activeGM?.id) return;
    // .contents, not for...of: iterating a Collection yields [key, value].
    for (const actor of game.actors.contents) {
      await syncAutoSpecNodes(actor);
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  First school of magic                                                     */
/* -------------------------------------------------------------------------- */

/*
 * One school's rank I costs no CP (the book's "10/0 CP"). A temperament trait
 * decides which school that is (TEMPERAMENT_SCHOOLS), and a character with the
 * trait and Channeling I is handed that rank I: syncTemperamentSchool writes
 * it, and it cannot be refunded while both hold. The school the sync wrote is
 * recorded at `system.progression.temperamentSchool`, so losing the trait or
 * Channeling takes back only a rank the sync gave, never one the player paid
 * for or built on.
 */

/** The character's temperament trait and the school it names, or null. */
function findTemperament(actor) {
  for (const [name, school] of Object.entries(TEMPERAMENT_SCHOOLS)) {
    const wanted = name.toLowerCase();
    const item = actor?.items?.find(
      (i) => i.type === "feature" && i.name?.toLowerCase() === wanted,
    );
    if (item) return { item, school };
  }
  return null;
}

/**
 * The school whose rank I is free: the temperament's once the character has
 * Channeling I, else the first school held in price table order. `school` is
 * null while no school is held, meaning whichever is learned first; `trait` is
 * the temperament item when it decided.
 * @returns {{school: string|null, trait: Item|null}}
 */
export function getFreeSchool(actor) {
  const temperament = findTemperament(actor);
  if (temperament && getTrackRank(actor, "combatSkills", "channeling") >= 1) {
    return { school: temperament.school, trait: temperament.item };
  }
  for (const track of Object.values(PROGRESSION_TRACKS)) {
    if (track.group !== "schools") continue;
    if (getTrackRank(actor, "schools", track.key) >= 1) {
      return { school: track.key, trait: null };
    }
  }
  return { school: null, trait: null };
}

/** The school a temperament hands its rank I to right now, or null. */
export function getForcedSchool(actor) {
  const free = getFreeSchool(actor);
  return free.trait ? free.school : null;
}

/**
 * Keep the temperament's school at rank I or above while the trait and
 * Channeling hold. Once they do not, a rank I the sync wrote goes back to 0;
 * ranks bought on top of it stay. Writes only what differs, so its own update
 * finds nothing left to do.
 */
export async function syncTemperamentSchool(actor) {
  if (actor?.type !== "character") return;
  const forced = getForcedSchool(actor);
  const record = actor.system?.progression?.temperamentSchool || "";
  const update = {};
  if (record && record !== forced) {
    if (getTrackRank(actor, "schools", record) === 1) {
      update[`system.schools.${record}.value`] = 0;
    }
    update["system.progression.temperamentSchool"] = "";
  }
  if (forced && getTrackRank(actor, "schools", forced) < 1) {
    update[`system.schools.${forced}.value`] = 1;
    // An untrained track is hidden on the sheet; the grant trains it.
    if (actor.system?.schools?.[forced]?.visible === false) {
      update[`system.schools.${forced}.visible`] = true;
    }
    update["system.progression.temperamentSchool"] = forced;
  }
  if (Object.keys(update).length) await actor.update(update);
}

/** True for an item whose arrival or removal can change the temperament. */
function isTemperamentItem(item) {
  if (item?.type !== "feature" || item.parent?.documentName !== "Actor") return false;
  const name = item.name?.toLowerCase();
  return Object.keys(TEMPERAMENT_SCHOOLS).some((key) => key.toLowerCase() === name);
}

/**
 * Re-sync on the client that made the change: a school or Channeling rank
 * moving (a purchase, a refund, a hand edit on the sheet), or a temperament
 * trait added or removed. Once at start-up on the active GM too, so characters
 * who already had a temperament and Channeling receive their school.
 */
export function registerTemperamentSchools() {
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (game.user.id !== userId) return;
    const system = changes.system;
    if (system?.schools || system?.combatSkills?.channeling) {
      syncTemperamentSchool(actor);
    }
  });
  Hooks.on("createItem", (item, options, userId) => {
    if (game.user.id !== userId || !isTemperamentItem(item)) return;
    syncTemperamentSchool(item.parent);
  });
  Hooks.on("deleteItem", (item, options, userId) => {
    if (game.user.id !== userId || !isTemperamentItem(item)) return;
    syncTemperamentSchool(item.parent);
  });
  Hooks.once("ready", async () => {
    if (game.user.id !== game.users.activeGM?.id) return;
    // .contents, not for...of: iterating a Collection yields [key, value].
    for (const actor of game.actors.contents) {
      await syncTemperamentSchool(actor);
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  Specialisations                                                           */
/* -------------------------------------------------------------------------- */

/*
 * Specialisations cost Specialisation points, a third currency beside CP and
 * SP (user ruling 2026-09-11). Every character has SPEC_POINTS_DEFAULT unless
 * the GM sets `system.progression.specPoints`. Spent is derived the way CP and
 * SP are: the price of every active specialisation, so one switched on through
 * the GM's config checkboxes counts too (user ruling). A capped group
 * (SPEC_GROUP_CAPS: Combat, 4) may hold no more than its cap.
 *
 * Buying a specialisation switches on `system.specialisations.<id>.active`,
 * the same flag the sheet's Specialisations tab reads. Its nodes are then
 * bought one by one with CP and SP (see "Specialisation nodes" below).
 */

/** A specialisation's price entry, or null when the book prices none. */
export function getSpecPrice(specId) {
  return SPEC_PRICES[specId] ?? null;
}

/** True when the character has this specialisation. */
export function isSpecActive(actor, specId) {
  return !!actor?.system?.specialisations?.[specId]?.active;
}

/** How many nodes of a specialisation the character has unlocked. */
export function countUnlockedSpecNodes(actor, specId) {
  const nodes = actor?.system?.specialisations?.[specId]?.nodes ?? {};
  return Object.values(nodes).filter(Boolean).length;
}

/**
 * How many nodes of a specialisation the character bought: the unlocked ones
 * minus those that come with it (autoUnlock). Those go away with the
 * specialisation, so they never stand in the way of giving it back.
 */
export function countBoughtSpecNodes(actor, specId) {
  const nodes = actor?.system?.specialisations?.[specId]?.nodes ?? {};
  return Object.entries(nodes).filter(
    ([nodeId, unlocked]) => unlocked && !isAutoUnlockNode(specId, nodeId),
  ).length;
}

/**
 * The Specialisation points wallet.
 * @returns {{earned: number, spent: number, remaining: number,
 *            byGroup: Record<string, number>, caps: Record<string, number>}}
 */
export function getSpecWallet(actor) {
  const stored = actor?.system?.progression?.specPoints;
  const earned =
    stored === undefined || stored === null || stored === ""
      ? SPEC_POINTS_DEFAULT
      : Number(stored) || 0;
  const byGroup = Object.fromEntries(SPEC_GROUPS.map((group) => [group, 0]));
  for (const [specId, price] of Object.entries(SPEC_PRICES)) {
    if (!isSpecActive(actor, specId)) continue;
    byGroup[price.group] = (byGroup[price.group] ?? 0) + price.cost;
  }
  const spent = Object.values(byGroup).reduce((sum, n) => sum + n, 0);
  return {
    earned,
    spent,
    remaining: earned - spent,
    byGroup,
    caps: { ...SPEC_GROUP_CAPS },
  };
}

/**
 * Whether a specialisation can be bought right now.
 *
 * @returns {{state: string, price: object|null, requirements: object|null}}
 *   state is one of:
 *     "owned"        the character has it
 *     "unavailable"  the book prices no such specialisation
 *     "locked"       requirements not met
 *     "capped"       its group would go over the group's cap
 *     "poor"         not enough Specialisation points left
 *     "available"    buyable right now
 */
export function getSpecState(actor, specId) {
  const price = getSpecPrice(specId);
  if (!price) return { state: "unavailable", price: null, requirements: null };
  const requirements = evaluateRequirements(actor, price.requires);
  if (isSpecActive(actor, specId)) return { state: "owned", price, requirements };
  if (!requirements.met) return { state: "locked", price, requirements };
  const wallet = getSpecWallet(actor);
  const cap = wallet.caps[price.group];
  if (cap !== undefined && (wallet.byGroup[price.group] ?? 0) + price.cost > cap) {
    return { state: "capped", price, requirements };
  }
  if (wallet.remaining < price.cost) return { state: "poor", price, requirements };
  return { state: "available", price, requirements };
}

/** Buy a specialisation. @returns {Promise<boolean>} */
export async function purchaseSpec(actor, specId) {
  if (getSpecState(actor, specId).state !== "available") return false;
  await actor.update({ [`system.specialisations.${specId}.active`]: true });
  return true;
}

/**
 * Give a specialisation back. Refused while any node bought in it is unlocked:
 * a node can carry effects that go away with it, so nodes are given back one by
 * one first. Nodes that come with it are locked by syncAutoSpecNodes once the
 * specialisation is gone. @returns {Promise<boolean>}
 */
export async function refundSpec(actor, specId) {
  if (!isSpecActive(actor, specId)) return false;
  if (countBoughtSpecNodes(actor, specId) > 0) return false;
  await actor.update({ [`system.specialisations.${specId}.active`]: false });
  return true;
}

/** Grant or revoke a specialisation's teacher. GM only; callers must check. */
export async function setSpecTeacher(actor, specId, found) {
  if (!getSpecPrice(specId)) return false;
  await actor.update({ [`system.specialisations.${specId}.teacher`]: !!found });
  return true;
}

/**
 * Grant or revoke the teacher for ONE node of a specialisation. GM only;
 * callers must check. Stored beside the specialisation's own `teacher` flag as
 * `teachers.<nodeId>`, so the tree's trainer and a single star's trainer never
 * stand in for each other.
 */
export async function setSpecNodeTeacher(actor, specId, nodeId, found) {
  if (!getSpecNodePrice(specId, nodeId)?.teacher) return false;
  await actor.update({
    [`system.specialisations.${specId}.teachers.${nodeId}`]: !!found,
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Specialisation nodes                                                      */
/* -------------------------------------------------------------------------- */

/*
 * A node costs CP and/or SP (SPEC_NODE_PRICES, user ruling 2026-09-14). As
 * with ranks and features nothing is deducted: `spent` is derived from the
 * unlocked nodes of every active specialisation, so a node unlocked on the
 * sheet costs the same as one bought in the Learn window.
 *
 * A node is buyable once its specialisation is owned, the nodes its tree links
 * to are unlocked, the book's requirements are met, no skill discount clashes
 * and the points are there.
 */

/** A node's price entry ({cp, sp, requires}), or null when none is priced. */
export function getSpecNodePrice(specId, nodeId) {
  return SPEC_NODE_PRICES[specId]?.[nodeId] ?? null;
}

/**
 * What this character pays for one node: the book price less a Specialist-
 * style specialisation discount (rankDiscounts.mjs), never below 0. Only the
 * currency the discount is in is touched (a Priest blessing's CP stays put).
 * @returns {{cp: number, sp: number, base: {cp: number, sp: number},
 *            discount: object|null}|null}
 */
export function getSpecNodeCost(actor, specId, nodeId, discounts = getSkillDiscounts(actor)) {
  const price = getSpecNodePrice(specId, nodeId);
  if (!price) return null;
  const base = { cp: price.cp, sp: price.sp };
  const source = discounts.get(`specialisations.${specId}`) ?? null;
  const discount = source && price[source.currency] > 0 ? source : null;
  const cost = { ...base };
  if (discount) cost[discount.currency] = Math.max(0, base[discount.currency] - discount.amount);
  return { cp: cost.cp, sp: cost.sp, base, discount };
}

/** What the character's unlocked nodes cost, over active specialisations. */
export function computeSpentOnSpecNodes(actor) {
  const spent = { cp: 0, sp: 0 };
  const discounts = getSkillDiscounts(actor);
  for (const [specId, spec] of Object.entries(actor?.system?.specialisations ?? {})) {
    if (!spec?.active) continue;
    for (const [nodeId, unlocked] of Object.entries(spec.nodes ?? {})) {
      if (!unlocked) continue;
      const cost = getSpecNodeCost(actor, specId, nodeId, discounts);
      if (!cost) continue;
      spent.cp += cost.cp;
      spent.sp += cost.sp;
    }
  }
  return spent;
}

/**
 * Whether a node can be bought right now.
 *
 * @param {object} [wallet]  getWallet(actor), when the caller already has it
 * @returns {{state: string, price: object|null, cost: object|null,
 *            requirements: object|null, missing: string[], conflict: object|null}}
 *   `price` is the book price, `cost` what this character pays after any
 *   Specialist-style discount. `missing` lists the linked nodes still locked,
 *   `conflict` the discount that blocks it. state is one of:
 *     "owned"        unlocked
 *     "unavailable"  no such node, or the table prices none
 *     "unowned"      the specialisation is not the character's
 *     "blocked"      a node it links to is still locked
 *     "locked"       the book's requirements are not met
 *     "conflict"     it discounts a skill another source already discounts
 *     "poor"         not enough CP or SP left
 *     "available"    buyable right now
 */
export function getSpecNodeState(actor, specId, nodeId, wallet = null) {
  const nodeDef = REDSTEEL.specialisations?.[specId]?.nodes?.[nodeId];
  const price = getSpecNodePrice(specId, nodeId);
  if (!nodeDef || !price) {
    return {
      state: "unavailable",
      price: null,
      cost: null,
      requirements: null,
      missing: [],
      conflict: null,
    };
  }
  const cost = getSpecNodeCost(actor, specId, nodeId);
  const spec = actor?.system?.specialisations?.[specId];
  const unlocked = spec?.nodes ?? {};
  const requirements = evaluateRequirements(actor, price.requires);
  const missing = (nodeDef.requires ?? []).filter((id) => !unlocked[id]);
  const result = { price, cost, requirements, missing, conflict: null };
  if (unlocked[nodeId]) return { ...result, state: "owned" };
  if (!spec?.active) return { ...result, state: "unowned" };
  if (missing.length) return { ...result, state: "blocked" };
  if (!requirements.met) return { ...result, state: "locked" };
  const conflict = getSpecNodeDiscountConflict(actor, specId, nodeId);
  if (conflict) return { ...result, conflict, state: "conflict" };
  // Only a currency the node costs is checked, so a free node stays buyable
  // for a character already over budget.
  const { remaining } = wallet ?? getWallet(actor);
  if ((cost.cp > 0 && remaining.cp < cost.cp) || (cost.sp > 0 && remaining.sp < cost.sp)) {
    return { ...result, state: "poor" };
  }
  return { ...result, state: "available" };
}

/**
 * The unlocked nodes that build on this one: through a tree link, or through a
 * book clause naming it (School of Blood's tier stars). While any remain, the
 * node cannot be given back.
 */
export function getSpecNodeDependents(actor, specId, nodeId) {
  const unlocked = actor?.system?.specialisations?.[specId]?.nodes ?? {};
  return Object.entries(REDSTEEL.specialisations?.[specId]?.nodes ?? {})
    .filter(([id, def]) => {
      if (!unlocked[id]) return false;
      if ((def.requires ?? []).includes(nodeId)) return true;
      return (getSpecNodePrice(specId, id)?.requires ?? []).some(
        (req) => req.t === "specNode" && req.spec === specId && req.node === nodeId,
      );
    })
    .map(([id]) => id);
}

/**
 * Unlock a node. Its passive buff is created as a real Active Effect in the
 * same order the sheet's toggle uses: the flag first, then the effects.
 * A Bane node's picker is NOT opened here; see the Learn window's handler.
 * @returns {Promise<boolean>} false when the node was not buyable.
 */
export async function purchaseSpecNode(actor, specId, nodeId) {
  if (getSpecNodeState(actor, specId, nodeId).state !== "available") return false;
  await actor.update({ [`system.specialisations.${specId}.nodes.${nodeId}`]: true });
  await syncSpecialisationPassive(actor, specId, nodeId, true);
  return true;
}

/**
 * Give a node back: the flag, then its effects, then any Bane picked for it,
 * the sheet's order. Refused while another unlocked node builds on it.
 * @returns {Promise<boolean>}
 */
export async function refundSpecNode(actor, specId, nodeId) {
  if (!actor?.system?.specialisations?.[specId]?.nodes?.[nodeId]) return false;
  // Comes with the specialisation, so it goes only with the specialisation.
  if (isAutoUnlockNode(specId, nodeId)) return false;
  if (getSpecNodeDependents(actor, specId, nodeId).length) return false;
  await actor.update({ [`system.specialisations.${specId}.nodes.${nodeId}`]: false });
  await syncSpecialisationPassive(actor, specId, nodeId, false);
  if (Number(REDSTEEL.specialisations?.[specId]?.nodes?.[nodeId]?.bane) > 0) {
    await clearBaneChoice(actor, specId, nodeId);
  }
  return true;
}
