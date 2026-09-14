import { PROGRESSION_TRACKS } from "./progression.mjs";
import { FEATURE_PRICES } from "./featurePrices.mjs";
import {
  FEATURE_DISCOUNTS,
  NONCOMBAT_EXCLUDED,
  SPEC_DISCOUNTS,
} from "./rankDiscounts.mjs";
import { actorHasSpecNode } from "./specialisations.mjs";
import {
  SPEC_GROUP_CAPS,
  SPEC_GROUPS,
  SPEC_POINTS_DEFAULT,
  SPEC_PRICES,
} from "./specPrices.mjs";
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
const ADVISORY = new Set(["gm", "raw", "featureTeacher"]);

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
 * are not priced here yet; until they are, the GM covers them with `adjust`.
 */
export function computeSpentOnRanks(actor) {
  const spent = { cp: 0, sp: 0 };
  // Discounts are retroactive (GM ruling 2026-09-11): a held rank costs what it
  // costs this character now, discount included.
  const discounts = getSkillDiscounts(actor);
  for (const [trackId, track] of Object.entries(PROGRESSION_TRACKS)) {
    const held = getTrackRank(actor, track.group, track.key);
    for (let rank = 1; rank <= held; rank++) {
      const price = getRankCost(actor, trackId, rank, discounts);
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
  // Owned features count too, whether bought in the Learn window or dropped on
  // the sheet (GM ruling 2026-09-11): the same derived model as ranks.
  const features = computeSpentOnFeatures(actor);
  const spent = {
    cp: ranks.cp + features.cp + Number(p.adjust?.cp ?? 0),
    sp: ranks.sp + features.sp + Number(p.adjust?.sp ?? 0),
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
 * character's race granted is free.
 *
 * Ownership is matched by name (and former names), never by compendium source:
 * much of the pack was imported from another module and an owned copy's
 * recorded source is often a dead pointer.
 */

/** The compendium every buyable feature comes from. */
export const FEATURE_PACK_ID = "redsteel.redsteel-items";

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

/** Lower-cased name, and every former name, → the price entries carrying it. */
const FEATURES_BY_NAME = (() => {
  const map = new Map();
  for (const [id, entry] of Object.entries(FEATURE_PRICES)) {
    for (const name of [entry.name, ...(entry.aliases ?? [])]) {
      const key = name.toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ id, ...entry });
    }
  }
  return map;
})();

/** The compendium uuid of a priced feature. */
export function getFeatureUuid(featureId) {
  return `Compendium.${FEATURE_PACK_ID}.Item.${featureId}`;
}

/** The price entry for a feature id, or null. */
export function getFeaturePrice(featureId) {
  const entry = FEATURE_PRICES[featureId];
  return entry ? { id: featureId, ...entry } : null;
}

/**
 * The price entry an owned feature item stands for, or null when the table
 * does not price it. Two entries can share a name (the human and the elven
 * Specialization): the one whose race the actor meets wins, and they cost the
 * same either way.
 */
export function getFeaturePriceForItem(actor, item) {
  if (item?.type !== "feature" || item.system?.option !== "feature") return null;
  const matches = FEATURES_BY_NAME.get(String(item.name ?? "").toLowerCase());
  if (!matches?.length) return null;
  if (matches.length === 1) return matches[0];
  return (
    matches.find((match) =>
      (match.requires ?? [])
        .filter((req) => req.t === "race")
        .every((req) => evaluateRequirement(actor, req).met),
    ) ?? matches[0]
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

/** What the character's owned features cost, summed from FEATURE_PRICES. */
export function computeSpentOnFeatures(actor) {
  const spent = { cp: 0, sp: 0 };
  for (const { item, price } of getOwnedFeatures(actor)) {
    if (!price || isRaceGrantedFeature(item)) continue;
    spent[price.currency] += price.cost;
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
  const other = skill ? findOtherDiscountOn(actor, skill, null) : null;
  if (other) return { reason: "discountTaken", item: other.item ?? null, source: other };
  return null;
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
 *     "unavailable"  the table does not price it
 */
export function getFeatureState(actor, featureId) {
  const price = getFeaturePrice(featureId);
  if (!price) {
    return { state: "unavailable", price: null, requirements: null, conflict: null };
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
  if (getWallet(actor).remaining[price.currency] < price.cost) {
    return { state: "poor", price, requirements, conflict: null };
  }
  return { state: "available", price, requirements, conflict: null };
}

/**
 * Buy a feature: copy the compendium item onto the actor. The copy records the
 * uuid it came from, the same way race and ability grants do.
 * @returns {Promise<boolean>} false when the feature was not buyable.
 */
export async function purchaseFeature(actor, featureId) {
  const { state } = getFeatureState(actor, featureId);
  if (state !== "available") return false;
  const uuid = getFeatureUuid(featureId);
  const source = await fromUuid(uuid);
  if (!source || source.type !== "feature") return false;
  const data = source.toObject();
  delete data._id;
  data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
  await actor.createEmbeddedDocuments("Item", [data]);
  return true;
}

/**
 * Give a bought feature back by deleting the owned copy. Only a feature the
 * table prices, and never one the race granted: removing those would not
 * refund anything and the race would put it back.
 */
export async function refundFeature(actor, itemId) {
  const item = actor?.items?.get(itemId);
  if (!item || isRaceGrantedFeature(item)) return false;
  if (!getFeaturePriceForItem(actor, item)) return false;
  await actor.deleteEmbeddedDocuments("Item", [itemId]);
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Rank discounts                                                            */
/* -------------------------------------------------------------------------- */

/*
 * Features and specialisation perks that make every rank of one skill cheaper.
 * The data and the rules behind it live in rankDiscounts.mjs: one discount per
 * skill, retroactive, applied only in its own currency. A "one skill from a
 * list" source stores the player's pick at
 * `system.progression.discountChoices.<sourceId>`, made in the Learn window.
 */

/** The skill keys a choice definition allows, from the price table's skills. */
function discountChoiceSkills(choices) {
  const keys = new Set();
  for (const track of Object.values(PROGRESSION_TRACKS)) {
    if (track.group !== "skills") continue;
    if (choices.noncombat && !NONCOMBAT_EXCLUDED.includes(track.key)) {
      keys.add(track.key);
    }
    if ((choices.sections ?? []).includes(track.section)) keys.add(track.key);
  }
  for (const key of choices.skills ?? []) keys.add(key);
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
 * specialisation perks, with the skill each lands on (null while a choice is
 * still unpicked, or when the stored pick is no longer allowed).
 *
 * @returns {Array<{id: string, kind: "feature"|"spec", amount: number,
 *   currency: string, skill: string|null, choices: string[]|null,
 *   item?: Item, spec?: string, node?: string}>}
 */
export function getDiscountSources(actor) {
  const sources = [];
  const picked = actor?.system?.progression?.discountChoices ?? {};
  const add = (id, def, skill, extra) => {
    const choices = def.choices ? discountChoiceSkills(def.choices) : null;
    let landsOn = skill ?? null;
    if (!landsOn && choices && choices.includes(picked[id])) landsOn = picked[id];
    sources.push({
      id,
      amount: def.amount,
      currency: def.currency,
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
 * The discount each skill carries: skill key → source. One per skill; should an
 * older sheet still hold two (taken before the rule was enforced), the larger
 * one counts, so a character is never charged for the overlap.
 */
export function getSkillDiscounts(actor, sources = getDiscountSources(actor)) {
  const map = new Map();
  for (const source of sources) {
    if (!source.skill) continue;
    const current = map.get(source.skill);
    if (!current || source.amount > current.amount) map.set(source.skill, source);
  }
  return map;
}

/**
 * What one rank of a track costs this character: the book price less its
 * skill's discount, when that discount is in the rank's own currency, never
 * below 0.
 * @returns {{cost: number, base: number, currency: string,
 *            discount: object|null}|null}
 */
export function getRankCost(actor, trackId, rank, discounts = getSkillDiscounts(actor)) {
  const track = PROGRESSION_TRACKS[trackId];
  const price = track?.ranks?.[rank - 1];
  if (!price) return null;
  const source = track.group === "skills" ? discounts.get(track.key) : null;
  const discount = source && source.currency === price.currency ? source : null;
  return {
    base: price.cost,
    cost: discount ? Math.max(0, price.cost - discount.amount) : price.cost,
    currency: price.currency,
    discount,
  };
}

/** Another discount source already landing on this skill, or null. */
function findOtherDiscountOn(actor, skill, exceptId) {
  if (!skill) return null;
  return (
    getDiscountSources(actor).find(
      (source) => source.skill === skill && source.id !== exceptId,
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
  const other = findOtherDiscountOn(actor, def.skill, `spec-${specId}-${nodeId}`);
  return other ? { skill: def.skill, source: other } : null;
}

/**
 * The skills a choice source may pick, each marked `taken` when another
 * source already discounts it.
 * @returns {Array<{key: string, taken: boolean}>}
 */
export function getDiscountChoiceOptions(actor, sourceId, sources = getDiscountSources(actor)) {
  const source = sources.find((entry) => entry.id === sourceId);
  if (!source?.choices) return [];
  const taken = new Set(
    sources
      .filter((entry) => entry.id !== sourceId && entry.skill)
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
 * the same flag the sheet's Specialisations tab reads. Unlocking the nodes
 * inside it stays on the sheet for now; charging CP/SP for them is the next
 * step (user ruling).
 */

/** A specialisation's price entry, or null when the book prices none. */
export function getSpecPrice(specId) {
  return SPEC_PRICES[specId] ?? null;
}

/** True when the character has this specialisation. */
function isSpecActive(actor, specId) {
  return !!actor?.system?.specialisations?.[specId]?.active;
}

/** How many nodes of a specialisation the character has unlocked. */
export function countUnlockedSpecNodes(actor, specId) {
  const nodes = actor?.system?.specialisations?.[specId]?.nodes ?? {};
  return Object.values(nodes).filter(Boolean).length;
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
 * Give a specialisation back. Refused while any of its nodes is unlocked: a
 * node can carry effects that go away with it, and nodes are locked one by one
 * on the sheet. @returns {Promise<boolean>}
 */
export async function refundSpec(actor, specId) {
  if (!isSpecActive(actor, specId)) return false;
  if (countUnlockedSpecNodes(actor, specId) > 0) return false;
  await actor.update({ [`system.specialisations.${specId}.active`]: false });
  return true;
}

/** Grant or revoke a specialisation's teacher. GM only; callers must check. */
export async function setSpecTeacher(actor, specId, found) {
  if (!getSpecPrice(specId)) return false;
  await actor.update({ [`system.specialisations.${specId}.teacher`]: !!found });
  return true;
}
