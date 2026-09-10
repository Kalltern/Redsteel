import { PROGRESSION_TRACKS } from "./progression.mjs";
import { actorHasSpecNode } from "./specialisations.mjs";
import { ABILITY_GRANTS } from "../utils/abilityGrants.mjs";

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
const ADVISORY = new Set(["gm", "raw"]);

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
 * True when a track belongs in the grid.
 *
 * A track with any rank bought is always shown, whatever the list says: hiding
 * something already paid for would strand it with no way back.
 *
 * Until the picker is saved for the first time, the ordinary skills are all on
 * and the combat side is all off. A character can attempt any skill untrained,
 * so a full skill list is the honest starting point, while nobody wants 25
 * doctrines and 7 schools they will never train. Once the picker is saved the
 * stored list is authoritative, even when it is empty — which is what
 * `tracksSet` distinguishes from "never configured".
 */
export function isTracked(actor, trackId) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track) return false;
  if (getTrackRank(actor, track.group, track.key) > 0) return true;
  if (tracksUnset(actor)) return getTrackTab(trackId) === "skills";
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
  // otherwise switching `tracksSet` on would silently wipe it.
  const frozen =
    tracksUnset(actor) && tab !== "skills"
      ? Object.keys(PROGRESSION_TRACKS).filter(
          (id) => getTrackTab(id) === "skills",
        )
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
 * are not priced here yet; until they are, the GM covers them with `adjust`.
 */
export function computeSpentOnRanks(actor) {
  const spent = { cp: 0, sp: 0 };
  for (const [trackId, track] of Object.entries(PROGRESSION_TRACKS)) {
    const held = getTrackRank(actor, track.group, track.key);
    for (let rank = 1; rank <= held; rank++) {
      const price = track.ranks[rank - 1];
      if (!price) continue;
      spent[price.currency] += price.cost;
    }
  }
  return spent;
}

/**
 * The full wallet for the sheet header and the Learn window.
 * @returns {{earned: {cp:number,sp:number}, spent: {cp:number,sp:number},
 *            remaining: {cp:number,sp:number}, level: number}}
 */
export function getWallet(actor) {
  const p = actor?.system?.progression ?? {};
  const earned = {
    cp: Number(p.earned?.cp ?? 0),
    sp: Number(p.earned?.sp ?? 0),
  };
  const ranks = computeSpentOnRanks(actor);
  const spent = {
    cp: ranks.cp + Number(p.adjust?.cp ?? 0),
    sp: ranks.sp + Number(p.adjust?.sp ?? 0),
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

/** True when the actor owns a feature item with this (always English) name. */
function hasFeature(actor, name) {
  const wanted = name.toLowerCase();
  return actor.items.some(
    (i) => i.type === "feature" && i.name?.toLowerCase() === wanted,
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
  const advisory = ADVISORY.has(req.t);
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
    case "anyOf":
      met = (req.options ?? []).some(
        (o) => evaluateRequirement(actor, o, trackId, rank).met,
      );
      break;
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
  if (rank > held + 1) return { state: "blocked", price, requirements: null };

  const requirements = evaluateRequirements(
    actor,
    price.requires,
    trackId,
    rank,
  );
  if (!requirements.met) return { state: "locked", price, requirements };

  const wallet = getWallet(actor);
  if (wallet.remaining[price.currency] < price.cost) {
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

  await actor.update({
    [`system.${track.group}.${track.key}.value`]: held - 1,
  });
  return true;
}
