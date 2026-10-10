/**
 * Character Creation window, a full screen in steps:
 *   1. Origin: name, race (and its racial choices), the attribute point buy,
 *      the trait buy.
 *   2. Doctrine: the combat doctrine(s) the character trains in, and one
 *      magical doctrine for a character with Magic potential. A sub-step of
 *      step 2 ("details", shown as 2.5) then shows the combat skill each
 *      doctrine fights with (the Peltast chooses), asks for the weapon skill
 *      each combat doctrine trains with and, with a magical doctrine, the
 *      school of magic (user ruling 2026-10-10: magical doctrine first, then
 *      its school; a temperament sets it). Further schools are bought in
 *      step 3.
 *   3. Skills and features: NOT this window. It is the Learn window running in
 *      creation mode (isCreationSkillsStep), which carries Back and Finish.
 * An info panel beside them describes whatever the player last hovered or
 * clicked. Rules: "Pravidla pro ToS V12.1 (WIP).xlsx" → "Tvorba postavy".
 *
 * Everything the player picks is a DRAFT kept at `flags.redsteel.creationDraft`
 * on the actor, so closing the screen loses nothing. Nothing touches the
 * character's real data until Next on step 2 (#applyOrigin), which in one go:
 * swaps in the race item (choice effects enabled/disabled in the data itself),
 * copies the traits, writes the attribute values and the name, pays unspent
 * trait points out as SP, adds the chosen doctrines to the character's skills
 * (shown on the sheet, tracked in the Learn window, and rank I bought with its
 * teacher: user ruling 2026-10-10, refunded in step 3 if unwanted), and moves
 * the draft to step 3. The race and the
 * trait copies carry `flags.redsteel.creationOrigin`, and the draft records
 * what was paid out (`applied`), so Back and Next again replaces exactly what
 * the previous apply wrote. Finish in the Learn window
 * (finishCharacterCreation) clears both the draft and `creationPending`.
 *
 * Draft shape (fixed, no deletable keys):
 *   { step: number,             the step on screen (1..STEP_COUNT)
 *     name: string|null,
 *     race: string|null,        CREATION_RACES key
 *     choices: string[][],      per choice group index: chosen effect ids
 *                               in the order taken (the oldest gives way)
 *     spend: {str..per},        points bought on top of the base 1
 *     traits: string[],         compendium ids from TRAIT_PRICES
 *     doctrines: string[],      doctrine keys (system.doctrines), the
 *                               magical one (picked on 2.5) included
 *     school: string|null,      CREATION_SCHOOLS key, picked on 2.5
 *     weapons: {doctrine: weaponSkill},  the free weapon picks (fixed ones,
 *                               FIXED_WEAPONS, are never stored)
 *     combatSkill: "combat"|"archery"|null,  the Peltast's combat skill
 *     stage: "doctrines"|"details",  which half of step 2 is on screen
 *     applied: null|{           what the last origin apply wrote:
 *       traitSp: number,          SP paid out for unspent trait points
 *       doctrines: string[],      doctrine keys it made visible
 *       schools: string[],        school keys it made visible
 *       weapons: string[],        weapon skill keys it made visible
 *       combatSkills: string[],   combat skill keys it made visible
 *                                 (Channeling has its own flag)
 *       channeling: boolean,      whether it made Channeling visible
 *       autoRanks: string[] } }   track ids whose rank I it bought
 */

import { CREATION_RACES, CREATION_RACE_GROUPS } from "../helpers/creationRaces.mjs";
import { TRAIT_PRICES } from "../helpers/traitPrices.mjs";
import { FEATURE_PRICES } from "../helpers/featurePrices.mjs";
import {
  FEATURE_PACK_ID,
  getFeatureUuid,
  getLearnSection,
  getLedgerMaterializeUpdate,
  getRankGrants,
  getRankPrice,
  getTrackedIds,
  getTrackRank,
  getTrackTab,
  getWallet,
  hasTeacher,
  isInCreation,
  purchaseRank,
  readItemFeatureCost,
  refundRank,
  setTeacher,
  setTrackedIds,
} from "../helpers/progressionEngine.mjs";
import { PROGRESSION_TRACKS } from "../helpers/progression.mjs";
import { TEMPERAMENT_SCHOOLS } from "../helpers/rankDiscounts.mjs";
// Import cycle with learnWindow.mjs (it imports this module's creation
// exports): fine, as neither module uses the other's exports at top level.
import { describeRankChips, explainUnbuyable, markAbilityChips, openLearnWindow } from "./learnWindow.mjs";
import { SPEC_ICONS } from "../helpers/specialisations.mjs";
import { getRaceChoiceGroups } from "./race.mjs";
import { registerTooltip, ttFrame } from "./tooltips.mjs";
import { compatibleWeaponsPill, loadCompatibleWeapons } from "./compatibleWeapons.mjs";

/**
 * Racial features listed in the info panel, by compendium id → {title, img,
 * description}, filled as a window loads them. The "creationFeature" tooltip
 * reads from here, so a hover never has to fetch the compendium item.
 */
const FEATURE_TIPS = new Map();

/**
 * What the window reads from the compendium (race documents, traits, racial
 * features, doctrine ladders), loaded once per session and shared by every
 * window: the promises live here, so a second open, or a second character,
 * costs nothing. Nothing in it depends on the actor. A compendium edit shows
 * after a reload.
 */
const CACHE = {
  // Set once the step-1 data (races, traits, racial features) is in.
  done: false,
  races: null,
  traits: null,
  racialFeatures: null,
  ladders: null,
  // The same ladders for the skills 2.5 offers, by track id.
  skillLadders: null,
  weapons: null,
};

/** A description as HTML (enrichHTML), or "" when there is none. */
async function enrichText(text) {
  if (!text) return "";
  try {
    return await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, {
      secrets: false,
    });
  } catch (err) {
    return text;
  }
}

/**
 * The work behind #loadDoctrineLadders, run once per session: every ability
 * the doctrines' ranks hand over, fetched all at once, then laid out rank by
 * rank per doctrine. Each ability's tooltip goes into FEATURE_TIPS under its
 * uuid.
 * @param {string[]} keys  the doctrines offered
 * @returns {Promise<Map<string, object[]>>}
 */
async function buildDoctrineLadders(keys) {
  const ladders = await buildTrackLadders(keys.map((key) => `doctrines.${key}`));
  return new Map(keys.map((key) => [key, ladders.get(`doctrines.${key}`)]));
}

/**
 * The ladder builder behind buildDoctrineLadders, for any tracks: track id →
 * the abilities its ranks hand over, rank by rank.
 * @param {string[]} trackIds
 * @returns {Promise<Map<string, object[]>>}
 */
async function buildTrackLadders(trackIds) {
  // Every (track, rank, uuid) first, so the fetches can run together.
  const plan = trackIds.map((key) => {
    const trackId = key;
    const grants = [];
    for (let rank = 1; getRankPrice(trackId, rank); rank++) {
      for (const uuid of getRankGrants(trackId, rank)) grants.push({ rank, uuid });
    }
    return { key, grants };
  });
  const uuids = [...new Set(plan.flatMap((p) => p.grants.map((g) => g.uuid)))];
  const docs = new Map(
    await Promise.all(
      uuids.map(async (uuid) => {
        let doc = null;
        try {
          doc = await fromUuid(uuid);
        } catch (err) {
          doc = null;
        }
        if (doc && !FEATURE_TIPS.has(uuid)) {
          const { name, text } = localizedNameAndText(doc);
          FEATURE_TIPS.set(uuid, { title: name, img: doc.img, description: await enrichText(text) });
        }
        return [uuid, doc];
      }),
    ),
  );
  const ladders = new Map();
  for (const { key, grants } of plan) {
    ladders.set(
      key,
      grants
        .filter(({ uuid }) => docs.get(uuid))
        .map(({ rank, uuid }) => ({
          rank,
          numeral: ROMAN_RANKS[rank - 1] ?? String(rank),
          id: uuid,
          name: FEATURE_TIPS.get(uuid)?.title ?? docs.get(uuid).name,
          // The document's own name, for matching the book's rank lines.
          docName: docs.get(uuid).name,
          img: docs.get(uuid).img,
        })),
    );
  }
  return ladders;
}

/**
 * What a trait's own Active Effects add to the primary attributes (Imp:
 * Strength -1), so the attribute totals count a drafted trait the way the
 * sheet will once Finish puts it on the character. Only enabled ADD changes
 * to system.attributes.<k>.bonus count; modBonus (a test bonus, like Giant's
 * +5% Strength) is not the attribute itself.
 * @returns {Promise<Object<string, number>>} attribute key → amount
 */
async function traitAttributeBonus(id) {
  const out = {};
  let doc = null;
  try {
    doc = await fromUuid(getFeatureUuid(id));
  } catch (err) {
    return out;
  }
  for (const effect of doc?.effects?.contents ?? []) {
    if (effect.disabled) continue;
    for (const change of effectChanges(effect)) {
      const match = ATTRIBUTE_BONUS_KEY.exec(change?.key ?? "");
      if (!match || !ATTRIBUTE_KEYS.includes(match[1]) || !isAddChange(change)) continue;
      out[match[1]] = (out[match[1]] ?? 0) + (Number(change.value) || 0);
    }
  }
  return out;
}

/** An item's (or index entry's) name and description in the active language. */
function localizedNameAndText(entry) {
  const key = entry?.system?.localizationKey?.trim();
  const name = key && game.i18n.has(key, false) ? game.i18n.localize(key) : entry?.name ?? "";
  const descKey = key?.replace(/\.name$/, ".description");
  const text =
    descKey && game.i18n.has(descKey, false)
      ? game.i18n.localize(descKey)
      : (entry?.system?.description ?? "");
  return { name, text };
}

registerTooltip("creationFeature", ({ id }) => {
  const tip = FEATURE_TIPS.get(id);
  if (!tip) return null;
  return ttFrame({
    title: tip.title,
    img: tip.img,
    body: tip.description ? `<div class="tt-desc">${tip.description}</div>` : "",
  });
});

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TEMPLATE = "systems/redsteel/templates/actor/character-creation.hbs";

/** The seven primary attributes, in the book's order. */
const ATTRIBUTE_KEYS = ["str", "dex", "end", "int", "wil", "cha", "per"];

/** Attribute points at level 1 (Tvorba postavy). */
const BASE_ATTRIBUTE_BUDGET = 15;

/** At most this many traits on a new character. */
const MAX_TRAITS = 15;

/** Every unspent trait point is worth this many SP at Finish. */
const SP_PER_TRAIT_POINT = 5;

/** The steps: 1 Origin, 2 Doctrine, 3 Skills and features (the Learn window). */
const STEP_COUNT = 3;

/** The steps this window renders itself; the last one lives in the Learn window. */
const WINDOW_STEPS = 2;

/** The Magic potential trait: it opens the magical doctrines. */
const MAGIC_POTENTIAL_ID = "abUe5QntVOFVUDgC";

/** Doctrine blocks on step 2, in the Learn window's order. */
const DOCTRINE_KIND_ORDER = ["melee", "ranged", "special", "magical"];

/**
 * Doctrines creation does not offer. Cordinas needs the Blood School
 * specialisation, which no new character has; Musketeer, Rider, Monk and
 * Elementalist are held back from new characters for now (user ruling
 * 2026-09-30).
 */
const HIDDEN_DOCTRINES = new Set(["cordinas", "musketeer", "rider", "monk", "elementalist"]);

/** A doctrine card with no ability to show as its crest. */
const DOCTRINE_FALLBACK_CREST = "icons/svg/sword.svg";

/** The schools of magic 2.5 offers a magical doctrine (user ruling 2026-10-01). */
const CREATION_SCHOOLS = ["fire", "water", "air", "earth", "spirit", "body", "darkness"];

/**
 * Each school's crest on its card: a Font Awesome glyph, since no school has
 * an image of its own anywhere in the system.
 */
const SCHOOL_GLYPHS = {
  fire: "fa-fire",
  water: "fa-droplet",
  air: "fa-wind",
  earth: "fa-mountain",
  spirit: "fa-ghost",
  body: "fa-heart-pulse",
  darkness: "fa-moon",
};

/** The weapon skills a combat doctrine may train with, in the sheet's order. */
const WEAPON_SKILL_KEYS = ["swords", "axes", "blunt", "polearms"];

/** Doctrines whose weapon skill is fixed (user ruling 2026-10-01). */
const FIXED_WEAPONS = { pikeman: "polearms", swordsman: "swords", duelist: "swords" };

/**
 * Each skill card's crest on 2.5 and in the info panel (core Foundry icons
 * the item packs already use), with the doctrine kind whose accent it wears.
 */
const SKILL_CARDS = {
  "weaponSkills.swords": { img: "icons/weapons/swords/greatsword-crossguard-steel.webp", kind: "melee" },
  "weaponSkills.axes": { img: "icons/weapons/axes/axe-broad-grey.webp", kind: "melee" },
  "weaponSkills.blunt": { img: "icons/weapons/maces/mace-studded-steel.webp", kind: "melee" },
  "weaponSkills.polearms": { img: "icons/weapons/polearms/halberd-crescent-small-spiked.webp", kind: "melee" },
  "combatSkills.combat": { img: "icons/skills/melee/swords-triple-orange.webp", kind: "melee" },
  "combatSkills.archery": { img: "icons/skills/ranged/target-bullseye-arrow-glowing.webp", kind: "ranged" },
  "combatSkills.channeling": { img: "icons/magic/symbols/runes-star-pentagon-blue.webp", kind: "magical" },
};

/**
 * Combat doctrines that ask no weapon question: Archer and Arbalest fight
 * with Archery, and Rogue's rank IV takes any doctrine III instead.
 */
const NO_WEAPON_DOCTRINES = new Set(["archer", "arbalest", "rogue"]);

/**
 * The combat skill a doctrine fights with (user ruling 2026-10-02): melee
 * doctrines Combat; Archer, Arbalest and Juggler Archery; the Peltast picks
 * one of the two (COMBAT_SKILL_CHOICE). Rogue adds none, and a magical
 * doctrine brings Channeling.
 */
const ARCHERY_DOCTRINES = new Set(["archer", "arbalest", "juggler"]);
const COMBAT_SKILL_CHOICE = "peltast";
const COMBAT_SKILL_KEYS = ["combat", "archery"];

/** A doctrine's fixed combat skill key, or null (none, or the Peltast's pick). */
function fixedCombatSkill(key) {
  if (getLearnSection(`doctrines.${key}`) === "melee") return "combat";
  if (ARCHERY_DOCTRINES.has(key)) return "archery";
  return null;
}

/** The drafted doctrines that come with a combat skill, fixed or picked. */
function combatSkillDoctrines(doctrines) {
  return doctrines.filter((key) => key === COMBAT_SKILL_CHOICE || fixedCombatSkill(key));
}

/** The combat skills the draft's doctrines bring, each once. */
function draftCombatSkills(draft) {
  return [
    ...new Set(
      combatSkillDoctrines(draft.doctrines)
        .map((key) => (key === COMBAT_SKILL_CHOICE ? draft.combatSkill : fixedCombatSkill(key)))
        .filter(Boolean),
    ),
  ];
}

/**
 * True for a temperament trait (Choleric, Phlegmatic, Sanguine, Melancholic):
 * a character has one temperament at most (user ruling 2026-10-10).
 */
function isTemperament(traitId) {
  return Object.hasOwn(TEMPERAMENT_SCHOOLS, TRAIT_PRICES[traitId]?.name ?? "");
}

/** True for a magical doctrine. */
function isMagicalDoctrine(key) {
  return getLearnSection(`doctrines.${key}`) === "magical";
}

/** The drafted doctrines that train with a weapon skill (fixed or picked). */
function weaponDoctrines(doctrines) {
  return doctrines.filter((key) => !isMagicalDoctrine(key) && !NO_WEAPON_DOCTRINES.has(key));
}

/**
 * True when step 2's details half (2.5) has something to ask: a weapon pick
 * that is not fixed, the Peltast's combat skill, or a magical doctrine's
 * school. Fixed combat skills alone ask nothing.
 */
function draftHasDetails(draft) {
  return (
    draft.doctrines.some((key) => isMagicalDoctrine(key)) ||
    draft.doctrines.includes(COMBAT_SKILL_CHOICE) ||
    weaponDoctrines(draft.doctrines).some((key) => !FIXED_WEAPONS[key])
  );
}

/** The weapon skill a doctrine trains with: fixed, picked, or null. */
function weaponFor(draft, key) {
  return FIXED_WEAPONS[key] ?? draft.weapons[key] ?? null;
}

/**
 * Every track id the draft's step 2 picks bring into step 3, in buying order:
 * Channeling and the school (with a magical doctrine; Channeling first, so a
 * temperament's school has already come with it), the weapon and combat
 * skills, then the doctrines (a doctrine's rank may ask for a skill's).
 */
function draftTrackIds(draft) {
  const weapons = new Set(weaponDoctrines(draft.doctrines).map((key) => weaponFor(draft, key)).filter(Boolean));
  const magical = draft.doctrines.some((key) => isMagicalDoctrine(key));
  return [
    ...(magical ? ["combatSkills.channeling"] : []),
    ...(magical && draft.school ? [`schools.${draft.school}`] : []),
    ...[...weapons].map((key) => `weaponSkills.${key}`),
    ...draftCombatSkills(draft).map((key) => `combatSkills.${key}`),
    ...draft.doctrines.map((key) => `doctrines.${key}`),
  ];
}

/**
 * Each doctrine's crest on its card and in the info panel (user picks,
 * 2026-09-30; core Foundry icons). The magical doctrines are not listed: they
 * wear their specialisation's card art (#doctrineCrest). A doctrine found
 * nowhere falls back to the first ability it teaches.
 */
const DOCTRINE_CRESTS = {
  dimakerus: "icons/weapons/swords/swords-short.webp",
  swordsman: "icons/weapons/swords/sword-hilt-steel-green.webp",
  arbalest: "icons/weapons/crossbows/crossbow-blue.webp",
  pikeman: "icons/weapons/polearms/spear-hooked-double-engraved.webp",
  reaver: "icons/weapons/axes/axe-broad-engraved-chipped-blue.webp",
  shieldbearer: "icons/equipment/shield/shield-round-boss-wood-brown.webp",
  peltast: "icons/equipment/shield/buckler-boss-iron-wood-brown.webp",
  juggler: "icons/weapons/thrown/daggers-guard-green.webp",
  duelist: "icons/weapons/swords/scimitar-worn-blue.webp",
  archer: "icons/weapons/bows/longbow-leather-green.webp",
  rogue: "icons/equipment/head/hood-red.webp",
};

/**
 * The magical doctrines that share a key with a specialisation, whose card
 * art they wear.
 */
const SPEC_CREST_DOCTRINES = new Set(["elymas", "incantator", "veneficus"]);

/**
 * SPEC ICON EDITOR — TEMPORARY, remove with the editor (learnWindow.mjs):
 * the GM's in-game picks for the specialisation cards (hidden world setting
 * "specIconOverrides", specId → image), which win over SPEC_ICONS the same
 * way they do in the Learn window. Once the picks are baked into SPEC_ICONS,
 * delete this and read SPEC_ICONS alone in #doctrineCrest.
 */
function specIconOverrides() {
  try {
    return game.settings.get("redsteel", "specIconOverrides") ?? {};
  } catch (err) {
    return {};
  }
}

/** The one doctrine the book lets sit beside another (the hybrid Rogue). */
const COMPANION_DOCTRINE = "rogue";

/** A melee or ranged doctrine: not Rogue, not magical. Creation takes one. */
function isMainDoctrine(key) {
  return key !== COMPANION_DOCTRINE && !isMagicalDoctrine(key);
}

/**
 * The system's own tooltip root (#rs-tooltip-root in redsteel.css). Like the
 * Learn window, the screen sits just under it and under Foundry's tooltip.
 */
const SYSTEM_TOOLTIP_LAYER = 10000;

const RACE_BY_KEY = new Map(CREATION_RACES.map((entry) => [entry.key, entry]));

const ATTRIBUTE_BONUS_KEY = /^system\.attributes\.(\w+)\.bonus$/;

/** Rank numerals for the doctrine ladders (ranks run to X). */
const ROMAN_RANKS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** Escape text destined for HTML built in code. */
function escapeHtml(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** "+2", "-3", "0". */
function signed(n) {
  const value = Number(n) || 0;
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Extra attribute points by level: +1 at level 8, +1 more at 15, +1 more at 20.
 */
function levelBudgetBonus(level) {
  return (level >= 8 ? 1 : 0) + (level >= 15 ? 1 : 0) + (level >= 20 ? 1 : 0);
}

/** An Active Effect's changes: V14 keeps them under system.changes. */
function effectChanges(effect) {
  const changes = effect?.system?.changes ?? effect?.changes ?? [];
  return Array.isArray(changes) ? changes : [];
}

/** True for an ADD change (V14 `type: "add"`, or legacy mode 2). */
function isAddChange(change) {
  if (change?.type !== undefined && change?.type !== null) return change.type === "add";
  return change?.mode === undefined || change?.mode === null || Number(change.mode) === 2;
}

/** A blank draft. */
function emptyDraft() {
  return {
    step: 1,
    // Identity: null keeps the actor's own name.
    name: null,
    race: null,
    choices: [],
    spend: Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 0])),
    traits: [],
    doctrines: [],
    school: null,
    weapons: {},
    combatSkill: null,
    stage: "doctrines",
    // What the last origin apply wrote; null until step 2's Next.
    applied: null,
  };
}

/** The stored draft, tidied into the fixed shape. */
function readDraft(actor) {
  const raw = actor?.getFlag?.("redsteel", "creationDraft") ?? {};
  const draft = emptyDraft();
  const step = Math.floor(Number(raw.step));
  if (step >= 1 && step <= STEP_COUNT) draft.step = step;
  if (typeof raw.name === "string" && raw.name.trim()) draft.name = raw.name.trim();
  const doctrines = Array.isArray(raw.doctrines) ? raw.doctrines : Object.values(raw.doctrines ?? {});
  draft.doctrines = [
    ...new Set(
      doctrines.filter(
        (key) => typeof key === "string" && !HIDDEN_DOCTRINES.has(key) && getRankPrice(`doctrines.${key}`, 1),
      ),
    ),
  ];
  if (typeof raw.race === "string" && RACE_BY_KEY.has(raw.race)) draft.race = raw.race;
  const choices = Array.isArray(raw.choices) ? raw.choices : Object.values(raw.choices ?? {});
  draft.choices = choices.map((group) => {
    const ids = Array.isArray(group) ? group : Object.values(group ?? {});
    // Picks in the order they were taken (the oldest gives way first). Drafts
    // from the old pick-column layout may still hold "" for an empty column.
    return ids.filter((id) => typeof id === "string" && id);
  });
  for (const k of ATTRIBUTE_KEYS) {
    draft.spend[k] = Math.max(0, Math.floor(Number(raw.spend?.[k]) || 0));
  }
  const traits = Array.isArray(raw.traits) ? raw.traits : Object.values(raw.traits ?? {});
  draft.traits = [...new Set(traits.filter((id) => typeof id === "string" && TRAIT_PRICES[id]))];
  // A pick only counts for a drafted doctrine that asks the question.
  const asked = new Set(weaponDoctrines(draft.doctrines).filter((key) => !FIXED_WEAPONS[key]));
  if (raw.weapons && typeof raw.weapons === "object") {
    for (const [key, weapon] of Object.entries(raw.weapons)) {
      if (asked.has(key) && WEAPON_SKILL_KEYS.includes(weapon)) draft.weapons[key] = weapon;
    }
  }
  // The Peltast's pick only counts while the Peltast is drafted.
  if (draft.doctrines.includes(COMBAT_SKILL_CHOICE) && COMBAT_SKILL_KEYS.includes(raw.combatSkill)) {
    draft.combatSkill = raw.combatSkill;
  }
  if (typeof raw.school === "string" && CREATION_SCHOOLS.includes(raw.school)) draft.school = raw.school;
  if (raw.stage === "details") draft.stage = "details";
  const applied = raw.applied;
  if (applied && typeof applied === "object") {
    const list = (value) =>
      [...new Set((Array.isArray(value) ? value : Object.values(value ?? {})).filter((key) => typeof key === "string"))];
    draft.applied = {
      traitSp: Math.max(0, Math.floor(Number(applied.traitSp) || 0)),
      doctrines: list(applied.doctrines),
      schools: list(applied.schools),
      weapons: list(applied.weapons),
      combatSkills: list(applied.combatSkills),
      channeling: applied.channeling === true,
      autoRanks: list(applied.autoRanks),
    };
  }
  return draft;
}

/**
 * A compendium feature's data, ready to create on an actor, or null. The same
 * copy progressionEngine.mjs makes when a feature is bought: the copy records
 * the uuid it came from.
 */
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
 * The attribute values the origin writes (flat update keys): each attribute
 * starts at 1, plus the points bought. Racial and trait bonuses arrive through
 * their Active Effects, not here. Shared by the apply and the footer preview.
 */
function originAttributeUpdate(draft) {
  const update = {};
  for (const k of ATTRIBUTE_KEYS) {
    update[`system.attributes.${k}.value`] = 1 + draft.spend[k];
  }
  return update;
}

/**
 * Everything creation writes carries this flag, so a later apply (Back, then
 * Next again) finds and replaces it.
 */
function markOrigin(data) {
  data.flags = data.flags ?? {};
  data.flags.redsteel = { ...(data.flags.redsteel ?? {}), creationOrigin: true };
  return data;
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

export class CharacterCreationWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "redsteel-creation-{id}",
    classes: ["redsteel", "rs-create"],
    window: {
      title: "REDSTEEL.Creation.title",
      // A full screen, not a window: no frame and no JavaScript positioning,
      // so CSS owns the geometry (see .rs-create in redsteel.css).
      frame: false,
      positioned: false,
    },
    actions: {
      pickRace: CharacterCreationWindow._onPickRace,
      pickChoice: CharacterCreationWindow._onPickChoice,
      attrUp: CharacterCreationWindow._onAttrUp,
      attrDown: CharacterCreationWindow._onAttrDown,
      toggleTrait: CharacterCreationWindow._onToggleTrait,
      back: CharacterCreationWindow._onBack,
      next: CharacterCreationWindow._onNext,
      toggleDoctrine: CharacterCreationWindow._onToggleDoctrine,
      pickWeapon: CharacterCreationWindow._onPickWeapon,
      pickCombatSkill: CharacterCreationWindow._onPickCombatSkill,
      pickSchool: CharacterCreationWindow._onPickSchool,
      closeScreen: CharacterCreationWindow._onCloseScreen,
    },
  };

  static PARTS = {
    body: {
      template: TEMPLATE,
      // Each column scrolls on its own; naming them keeps their positions
      // across a re-render.
      scrollable: [
        ".rs-create-origin .rs-create-scroll",
        ".rs-create-build .rs-create-scroll",
        ".rs-create-info .rs-create-scroll",
        ".rs-create-details .rs-create-scroll",
      ],
    },
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
    this.#draft = readDraft(this.actor);
    // Step 3 is the Learn window (openCharacterCreation routes there); should
    // this window be opened on it anyway, it shows its own last step.
    if (this.#draft.step > WINDOW_STEPS) this.#draft.step = WINDOW_STEPS;
  }

  /**
   * One window per actor. `{id}` in DEFAULT_OPTIONS.id is substituted with
   * `uniqueId`, so it is set before super() runs the substitution.
   */
  _initializeApplicationOptions(options) {
    options.uniqueId = options.actor?.id ?? "none";
    return super._initializeApplicationOptions(options);
  }

  /** The working copy of the draft; every change is also written to the actor. */
  #draft;

  /** Writes to the actor, chained so they land in click order. */
  #saving = Promise.resolve();

  /** Race documents by CREATION_RACES key, loaded once. */
  #raceDocs = null;

  /** Enriched race descriptions by CREATION_RACES key. */
  #raceDescriptions = new Map();

  /** Trait entries by compendium id, loaded once. */
  #traits = null;

  /** The compendium data is in: the screen proper can render. */
  #ready = false;

  /** The load under way while the loading card shows. */
  #loading = null;

  /** Racial features by CREATION_RACES key ({features, granted}), loaded once. */
  #racialFeatures = null;

  /**
   * Each offered doctrine's ability ladder, by doctrine key: the abilities its
   * ranks unlock ({rank, numeral, id, name, img}), loaded once.
   */
  #doctrineLadders = null;

  /**
   * The weapons each offered doctrine fights with, by doctrine key:
   * {skills, weaponSkills, groups} (compatibleWeapons.mjs).
   * Loaded with the ladders.
   */
  #doctrineWeapons = null;

  /** The same ladders for the SKILL_CARDS skills, by track id. */
  #skillLadders = null;

  /** Info panel HTML by "kind:id", rebuilt every render. */
  #infoHtml = new Map();

  /** The info panel's current subject ("race:human", "trait:<id>", "attr:str"). */
  #info = null;

  /** Delegated hover/click listener for the info panel, bound once. */
  #boundInfo = null;

  /** Delegated change listener for the name field, bound once. */
  #boundChange = null;
  /** Guards the origin apply (Next on step 2) against a double click. */
  #applying = false;

  /**
   * Trait copies (featureCopyData) by trait id, each a promise fetched once:
   * the footer preview builds them on every render, the apply once more.
   */
  #traitCopies = new Map();

  /** The footer preview has already warned about a failure this session. */
  #previewWarned = false;

  /* ---------------------------------------- */
  /*  Loading                                 */
  /* ---------------------------------------- */

  /**
   * Every creation race from the compendium, with its description: all
   * fetched at once, once per session (CACHE.races).
   */
  async #loadRaces() {
    if (this.#raceDocs) return this.#raceDocs;
    CACHE.races ??= (async () => {
      const pack = game.packs.get(FEATURE_PACK_ID);
      const loaded = await Promise.all(
        CREATION_RACES.map(async (entry) => {
          let doc = null;
          try {
            doc = pack ? await pack.getDocument(entry.raceId) : null;
          } catch (err) {
            doc = null;
          }
          if (!doc || doc.type !== "race") {
            console.warn(
              `Redsteel | Creation: race ${entry.key} (${entry.raceId}) not found in ${FEATURE_PACK_ID}; skipped.`,
            );
            return null;
          }
          return { key: entry.key, doc, description: await enrichText(localizedNameAndText(doc).text) };
        }),
      );
      return loaded.filter(Boolean);
    })();
    const races = await CACHE.races;
    this.#raceDocs = new Map(races.map((race) => [race.key, race.doc]));
    this.#raceDescriptions = new Map(races.map((race) => [race.key, race.description]));
    return this.#raceDocs;
  }

  /**
   * Each race's own features, for the info panel: the Learn window's racial
   * features (FEATURE_PRICES, section "racial") whose race clause this race
   * meets, by item name or by bane family (the same test as
   * progressionEngine's evaluateRequirement), plus what the race item grants.
   * Only features that exist in the compendium are listed; a priced row with
   * no item behind it is not built yet and stays hidden. Per-skill families
   * ("Specialization: Acrobacy", ...) collapse into one line.
   */
  async #loadRacialFeatures() {
    if (this.#racialFeatures) return this.#racialFeatures;
    const raceDocs = this.#raceDocs;
    CACHE.racialFeatures ??= this.#buildRacialFeatures(raceDocs);
    this.#racialFeatures = await CACHE.racialFeatures;
    return this.#racialFeatures;
  }

  /** The work behind #loadRacialFeatures, run once per session. */
  async #buildRacialFeatures(raceDocs) {
    const map = new Map();
    const pack = game.packs.get(FEATURE_PACK_ID);
    let index = null;
    try {
      index = pack
        ? await pack.getIndex({
            fields: ["img", "system.localizationKey", "system.cost", "system.description"],
          })
        : null;
    } catch (err) {
      console.warn(`Redsteel | Creation: could not index ${FEATURE_PACK_ID}`, err);
    }
    const labelOf = (entry) => localizedNameAndText(entry).name;
    // Each feature's tooltip (title, icon, description in the active
    // language) is remembered once; the descriptions are all enriched
    // together at the end rather than one by one.
    const pending = new Map();
    const remember = (id, entry) => {
      if (FEATURE_TIPS.has(id) || pending.has(id)) return;
      const { name, text } = localizedNameAndText(entry);
      pending.set(
        id,
        enrichText(text).then((description) => {
          FEATURE_TIPS.set(id, { title: name, img: entry.img, description });
        }),
      );
    };
    for (const race of CREATION_RACES) {
      const doc = raceDocs?.get(race.key);
      if (!doc) continue;
      const families = String(doc.system?.baneTypes ?? "").split(/[\s,]+/).filter(Boolean);
      const meets = (req) =>
        req?.t === "race" &&
        ((req.races ?? []).includes(doc.name) || (!!req.family && families.includes(req.family)));

      const rows = new Map();
      for (const [id, price] of Object.entries(FEATURE_PRICES)) {
        if (price.section !== "racial" || !(price.requires ?? []).some(meets)) continue;
        const entry = index?.get(id);
        if (!entry) continue;
        const label = labelOf(entry);
        const colon = label.indexOf(": ");
        const family = colon > 0 ? label.slice(0, colon) : null;
        const key = family ?? label;
        // A family's row shows and describes its first member.
        const row = rows.get(key) ?? {
          label: key,
          family: !!family,
          count: 0,
          prices: new Set(),
          id,
          img: entry.img,
        };
        remember(row.id, index.get(row.id));
        // The compendium item's own cost wins over the book's, as in the Learn window.
        const own = readItemFeatureCost(entry);
        const cp = own ? own.cp : price.currency === "cp" ? Number(price.cost) || 0 : 0;
        const sp = own ? own.sp : price.currency === "sp" ? Number(price.cost) || 0 : 0;
        const text = [
          cp ? game.i18n.format("REDSTEEL.Creation.Info.priceCp", { n: cp }) : null,
          sp ? game.i18n.format("REDSTEEL.Creation.Info.priceSp", { n: sp }) : null,
        ]
          .filter(Boolean)
          .join(" + ");
        if (text) row.prices.add(text);
        row.count += 1;
        rows.set(key, row);
      }

      const granted = [];
      for (const grant of doc.system?.grants ?? []) {
        const id = String(grant?.uuid ?? "").split(".").pop();
        const entry = id ? index?.get(id) : null;
        if (!entry) continue;
        remember(id, entry);
        granted.push({ id, label: labelOf(entry), img: entry.img });
      }

      const lang = game.i18n.lang;
      map.set(race.key, {
        features: [...rows.values()].sort((a, b) => a.label.localeCompare(b.label, lang)),
        granted,
      });
    }
    await Promise.all(pending.values());
    return map;
  }

  /**
   * What each offered doctrine teaches: the abilities its ranks hand over
   * (abilityGrants.mjs, through getRankGrants), rank by rank. The cards and
   * the info panel draw on this, and each ability's tooltip is remembered in
   * FEATURE_TIPS under its uuid.
   */
  async #loadDoctrineLadders() {
    if (this.#doctrineLadders && this.#doctrineWeapons && this.#skillLadders) return this.#doctrineLadders;
    const keys = this.#doctrineKeys();
    CACHE.ladders ??= buildDoctrineLadders(keys);
    CACHE.skillLadders ??= buildTrackLadders([
      ...Object.keys(SKILL_CARDS),
      ...CREATION_SCHOOLS.map((key) => `schools.${key}`),
    ]);
    // By doctrine key, as #doctrineWeapons reads it.
    CACHE.weapons ??= loadCompatibleWeapons().then(
      (catalog) => new Map(keys.map((key) => [key, catalog.get(`doctrines.${key}`)]).filter(([, v]) => v)),
    );
    [this.#doctrineLadders, this.#doctrineWeapons, this.#skillLadders] = await Promise.all([
      CACHE.ladders,
      CACHE.weapons,
      CACHE.skillLadders,
    ]);
    return this.#doctrineLadders;
  }

  /**
   * The info panel's opening for one doctrine: what it is about, then its
   * weapon requirements in words (REDSTEEL.Creation.Doctrine.Info.<key>), the
   * weapon skills its weapons are fought with, and the "Compatible weapons"
   * pill, which on click lists the weapons in a tooltip (compatibleWeapons).
   * "" for a doctrine with nothing to say.
   */
  #doctrineAboutHtml(key) {
    const i18n = game.i18n;
    const title = (labelKey) =>
      `<h4 class="rs-create-info-subtitle">${escapeHtml(i18n.localize(labelKey))}</h4>`;
    const text = (labelKey) =>
      i18n.has(labelKey, false) ? `<p class="rs-create-doctrine-text">${escapeHtml(i18n.localize(labelKey))}</p>` : "";
    const about = text(`REDSTEEL.Creation.Doctrine.Info.${key}.about`);
    const weapons = text(`REDSTEEL.Creation.Doctrine.Info.${key}.weapons`);
    const data = this.#doctrineWeapons?.get(key);
    const skills = data?.skills ?? [];
    const pill = data?.groups.length ? compatibleWeaponsPill(`doctrines.${key}`, "rs-create-skill-chip") : "";
    let html = about ? title("REDSTEEL.Creation.Doctrine.about") + about : "";
    if (weapons || skills.length || pill) {
      html += title("REDSTEEL.Creation.Doctrine.requirements") + weapons;
      if (skills.length || pill) {
        html += `<div class="rs-create-skill-chips">${skills
          .map((skill) => `<span class="rs-create-skill-chip">${escapeHtml(skill)}</span>`)
          .join("")}${pill}</div>`;
      }
    }
    return html;
  }

  /** The info panel's "Racial features" block for one race, or "". */
  #racialFeaturesHtml(key) {
    const data = this.#racialFeatures?.get(key);
    if (!data || (!data.features.length && !data.granted.length)) return "";
    const i18n = game.i18n;
    // One row: the feature's icon and name, hovering shows its description
    // (the "creationFeature" tooltip, filled by #loadRacialFeatures).
    const item = (id, img, body) =>
      `<li class="rs-create-feature" data-tt-kind="creationFeature" data-tt-id="${escapeHtml(id)}">` +
      (img ? `<img class="rs-create-feature-icon" src="${escapeHtml(img)}" alt="">` : "") +
      `<span class="rs-create-feature-text">${body}</span></li>`;
    const rows = [];
    for (const grant of data.granted) {
      rows.push(
        item(
          grant.id,
          grant.img,
          `${escapeHtml(grant.label)} <em>(${escapeHtml(i18n.localize("REDSTEEL.Creation.Info.granted"))})</em>`,
        ),
      );
    }
    for (const row of data.features) {
      const count = row.family
        ? ` <em>(${escapeHtml(i18n.format("REDSTEEL.Creation.Info.skillCount", { n: row.count }))})</em>`
        : "";
      const price = row.prices.size
        ? ` <span class="rs-create-feature-price">${escapeHtml([...row.prices].join(" / "))}</span>`
        : "";
      rows.push(item(row.id, row.img, `${escapeHtml(row.label)}${count}${price}`));
    }
    return (
      `<h4 class="rs-create-info-subtitle">${escapeHtml(
        i18n.localize("REDSTEEL.Creation.Info.racialFeatures"),
      )}</h4><ul class="rs-create-features">${rows.join("")}</ul>`
    );
  }

  /**
   * The offered traits from the pack index, label and description localized
   * the way the Learn window's feature index does it, plus what each one does
   * to the attributes. Every trait is read at once, once per session.
   */
  async #loadTraits() {
    if (this.#traits) return this.#traits;
    CACHE.traits ??= (async () => {
      const pack = game.packs.get(FEATURE_PACK_ID);
      let index = null;
      try {
        index = pack
          ? await pack.getIndex({ fields: ["img", "system.localizationKey", "system.description"] })
          : null;
      } catch (err) {
        console.warn(`Redsteel | Creation: could not index ${FEATURE_PACK_ID}`, err);
      }
      const loaded = await Promise.all(
        Object.entries(TRAIT_PRICES).map(async ([id, price]) => {
          const entry = index?.get(id);
          if (!entry) {
            console.warn(`Redsteel | Creation: trait ${price.name} (${id}) not found; skipped.`);
            return null;
          }
          const { name, text } = localizedNameAndText(entry);
          const [description, attrBonus] = await Promise.all([
            enrichText(text),
            traitAttributeBonus(id),
          ]);
          return [id, { id, label: name, img: entry.img, kind: price.kind, cost: price.cost, description, attrBonus }];
        }),
      );
      // In TRAIT_PRICES order, as before.
      return new Map(loaded.filter(Boolean));
    })();
    this.#traits = await CACHE.traits;
    return this.#traits;
  }

  /* ---------------------------------------- */
  /*  Rules                                   */
  /* ---------------------------------------- */

  /** The character's level (a fresh character is 1). */
  #level() {
    try {
      return Number(getWallet(this.actor).level) || 1;
    } catch (err) {
      return 1;
    }
  }

  /**
   * Everything the rules derive from a draft: racial bonuses, limits, totals,
   * budgets and trait points.
   */
  #compute(draft = this.#draft) {
    const level = this.#level();
    const entry = draft.race ? RACE_BY_KEY.get(draft.race) : null;
    const doc = entry ? this.#raceDocs?.get(entry.key) ?? null : null;
    const groups = doc ? getRaceChoiceGroups(doc) : [];

    const bonus = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 0]));
    const limitBumps = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 0]));
    // The part of `bonus` that comes from drafted traits (the rest is racial).
    const traitBonus = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 0]));

    if (doc) {
      const choiceIds = new Set(groups.flatMap((g) => g.effectIds));
      const chosen = new Set();
      groups.forEach((group, index) => {
        for (const id of draft.choices[index] ?? []) {
          if (group.effectIds.includes(id)) chosen.add(id);
        }
      });
      // .contents, not for...of: iterating a Collection yields [key, value].
      for (const effect of doc.effects.contents) {
        const isChoice = choiceIds.has(effect.id);
        const active = isChoice ? chosen.has(effect.id) : !effect.disabled;
        if (!active) continue;
        const raises = isChoice && effect.flags?.redsteel?.raisesLimit === true;
        for (const change of effectChanges(effect)) {
          const match = ATTRIBUTE_BONUS_KEY.exec(change?.key ?? "");
          if (!match || !ATTRIBUTE_KEYS.includes(match[1]) || !isAddChange(change)) continue;
          bonus[match[1]] += Number(change.value) || 0;
          if (raises) limitBumps[match[1]] += 1;
        }
      }
    }

    // Traits such as Brawny ("Strength attribute cap +1") raise a limit too,
    // and a trait's own effects can move an attribute (Imp: Strength -1).
    for (const id of draft.traits) {
      const k = TRAIT_PRICES[id]?.raisesLimit;
      if (k && k in limitBumps) limitBumps[k] += 1;
      for (const [attr, amount] of Object.entries(this.#traits?.get(id)?.attrBonus ?? {})) {
        if (!(attr in bonus)) continue;
        bonus[attr] += amount;
        traitBonus[attr] += amount;
      }
    }

    const limits = {};
    const totals = {};
    for (const k of ATTRIBUTE_KEYS) {
      limits[k] = entry ? entry.limits[k] + limitBumps[k] : 0;
      totals[k] = 1 + draft.spend[k] + bonus[k];
    }
    // Level 15 ("Primární vlastnost a Fyzická hranice +1"): the point it gives
    // also raises the limit of the ONE attribute it goes into (user ruling
    // 2026-10-06). Derived, not stored: the attribute already over its limit
    // holds the raise; while none is, any attribute may still take it.
    let levelLimitKey = null;
    if (entry && level >= 15) {
      levelLimitKey = ATTRIBUTE_KEYS.find((k) => totals[k] > limits[k]) ?? null;
      if (levelLimitKey) limits[levelLimitKey] += 1;
    }
    const canRaise = Object.fromEntries(
      ATTRIBUTE_KEYS.map((k) => [
        k,
        totals[k] < limits[k] || (level >= 15 && !levelLimitKey && totals[k] < limits[k] + 1),
      ]),
    );

    const budget = BASE_ATTRIBUTE_BUDGET + levelBudgetBonus(level);
    const spent = ATTRIBUTE_KEYS.reduce((sum, k) => sum + draft.spend[k], 0);

    const traitPoints = entry?.traitPoints ?? 0;
    const traitSpent = draft.traits.reduce((sum, id) => sum + (TRAIT_PRICES[id]?.cost ?? 0), 0);

    return {
      level,
      entry,
      doc,
      groups,
      bonus,
      traitBonus,
      limits,
      totals,
      canRaise,
      budget,
      spent,
      remaining: budget - spent,
      traitPoints,
      traitRemaining: traitPoints - traitSpent,
      traitCount: draft.traits.length,
      requirementMet: !entry?.requires?.trait || draft.traits.includes(entry.requires.trait),
    };
  }

  /** Lower bought points until no total is over its limit. */
  #clampSpend(draft) {
    const state = this.#compute(draft);
    if (!state.entry) return;
    for (const k of ATTRIBUTE_KEYS) {
      const room = state.limits[k] - 1 - state.bonus[k];
      draft.spend[k] = Math.max(0, Math.min(draft.spend[k], room));
    }
  }

  /** Keep the working copy, write it to the actor, then repaint. */
  async #commit() {
    const draft = foundry.utils.deepClone(this.#draft);
    const actor = this.actor;
    this.#saving = this.#saving
      .then(() => actor.update({ "flags.redsteel.creationDraft": draft, ...this.#weaponDeletions(draft) }))
      .catch((err) => console.error("Redsteel | Creation: could not save the draft", err));
    await this.#saving;
    this.render();
  }

  /**
   * An object update merges, so a weapon pick dropped from the draft would
   * stay in the stored flag. These keys delete the ones it no longer holds.
   */
  #weaponDeletions(draft) {
    const stored = this.actor?.getFlag?.("redsteel", "creationDraft")?.weapons ?? {};
    const out = {};
    for (const key of Object.keys(stored)) {
      if (!(key in draft.weapons)) out[`flags.redsteel.creationDraft.weapons.-=${key}`] = null;
    }
    return out;
  }

  /* ---------------------------------------- */
  /*  Rendering                               */
  /* ---------------------------------------- */

  /**
   * Every compendium read the screen needs, side by side (and once per
   * session, CACHE). The doctrine ladders are only needed on step 2:
   * elsewhere they keep loading in the background, and a step-2 render waits
   * for them.
   */
  async #loadAll() {
    const ladders = this.#loadDoctrineLadders();
    await Promise.all([
      this.#loadRaces().then(() => this.#loadRacialFeatures()),
      this.#loadTraits(),
    ]);
    if (this.#draft.step === 2) await ladders;
    else ladders.catch((err) => console.warn("Redsteel | Creation: doctrine ladders failed", err));
    CACHE.done = true;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // Until the compendium data is in, the screen shows the loading card
    // (a rotating die) at once instead of appearing only when everything is
    // read; the load then re-renders it. Once loaded this session (CACHE.done)
    // a window skips the card altogether.
    if (!this.#ready && CACHE.done) this.#ready = true;
    if (!this.#ready) {
      this.#loading ??= this.#loadAll()
        .catch((err) => console.error("Redsteel | Creation: loading failed", err))
        .finally(() => {
          this.#ready = true;
          if (this.rendered) this.render();
        });
      return Object.assign(context, {
        loading: true,
        loadingText: game.i18n.localize("REDSTEEL.Creation.loading"),
      });
    }
    // Everything is cached by now, so these return at once; the step-2 render
    // still waits for the doctrine ladders if they are the last thing out.
    await this.#loadAll();

    const draft = this.#draft;
    const state = this.#compute();
    const editable = !!this.actor?.isOwner;
    const hasRace = !!state.doc;
    const i18n = game.i18n;

    // Races: one dropdown for the race, a second for the subrace when the
    // race has any (Dwarf, Elf). Human and Halfling are their own only entry.
    const selectedGroup = state.entry?.group ?? null;
    const raceOptions = CREATION_RACE_GROUPS.filter((group) =>
      CREATION_RACES.some((entry) => entry.group === group.key && this.#raceDocs.has(entry.key)),
    ).map((group) => ({
      key: group.key,
      label: i18n.localize(group.labelKey),
      selected: group.key === selectedGroup,
    }));
    const subraceEntries = selectedGroup
      ? CREATION_RACES.filter(
          (entry) => entry.group === selectedGroup && this.#raceDocs.has(entry.key),
        )
      : [];
    const hasSubraces = subraceEntries.length > 1 || subraceEntries[0]?.key !== selectedGroup;
    const subraceOptions = hasSubraces
      ? subraceEntries.map((entry) => ({
          key: entry.key,
          label: i18n.localize(entry.labelKey),
          selected: entry.key === draft.race,
        }))
      : [];
    const requiresTrait = state.entry?.requires?.trait ?? null;
    const raceRequirement =
      requiresTrait && !draft.traits.includes(requiresTrait)
        ? i18n.localize(`REDSTEEL.Creation.Requires.${state.entry.key}`)
        : null;

    // The chosen race's choice groups: one row of chips per group, above the
    // attribute table. A chip reads the option's attribute change ("Dexterity
    // +1"), not the effect's name; an option that moves no attribute falls
    // back to its effect name.
    const choiceGroups = state.groups.map((group, index) => {
      const picked = (draft.choices[index] ?? []).filter((id) => group.effectIds.includes(id));
      const options = group.effectIds
        .map((id) => {
          const effect = state.doc.effects.get(id);
          if (!effect) return null;
          let label = i18n.localize(effect.name ?? "");
          const change = effectChanges(effect).find((c) => ATTRIBUTE_BONUS_KEY.test(c?.key ?? ""));
          const attr = change ? ATTRIBUTE_BONUS_KEY.exec(change.key)[1] : null;
          const onAttr = !!attr && !!CONFIG.REDSTEEL.attributes?.[attr];
          if (onAttr) {
            label = `${i18n.localize(CONFIG.REDSTEEL.attributes[attr])} ${signed(change.value)}`;
          }
          return {
            id,
            label,
            attr: onAttr ? attr : null,
            raisesLimit: effect.flags?.redsteel?.raisesLimit === true,
            selected: picked.includes(id),
          };
        })
        .filter(Boolean);
      return {
        index,
        label: i18n.localize(group.label),
        pick: i18n.format("REDSTEEL.Race.Choices.PickCount", { count: group.count }),
        picked: picked.length,
        count: group.count,
        complete: picked.length === group.count,
        options,
      };
    });

    // Attributes: value / limit, racial bonuses included.
    const attributes = ATTRIBUTE_KEYS.map((k) => ({
      key: k,
      label: i18n.localize(CONFIG.REDSTEEL.attributes?.[k] ?? k),
      total: state.totals[k],
      limit: state.limits[k],
      canUp: editable && hasRace && state.remaining > 0 && state.canRaise[k],
      canDown: editable && hasRace && draft.spend[k] > 0,
      // A picked trait raises this attribute's cap (Brawny, Nimble, ...): the
      // row's ribbon then burns bright.
      capRaised: draft.traits.some((id) => TRAIT_PRICES[id]?.raisesLimit === k),
      // A racial pick is on this attribute (the total is then drawn in gold).
      hasChoice: choiceGroups.some((group) =>
        group.options.some((option) => option.attr === k && option.selected),
      ),
    }));

    // Traits, in three sections, each sorted by name.
    const lang = i18n.lang;
    const traitTile = (trait) => {
      const selected = draft.traits.includes(trait.id);
      const unaffordable =
        !selected && trait.kind === "positive" && trait.cost > state.traitRemaining;
      const full = !selected && state.traitCount >= MAX_TRAITS;
      // One temperament: with one taken, the others are out of reach.
      const otherTemperament =
        !selected && isTemperament(trait.id) && draft.traits.some((t) => t !== trait.id && isTemperament(t));
      return {
        id: trait.id,
        kind: trait.kind,
        label: trait.label,
        img: trait.img,
        // Plain cost: a positive trait reads "6", a negative one "-3".
        price: String(trait.cost),
        selected,
        disabled: !editable || !hasRace || unaffordable || full || otherTemperament,
      };
    };
    // Left: every trait, by kind. A picked trait stays in its place, drawn
    // see-through (clicking it gives it back), so the list never reflows; the
    // centre column's picked list shows it as well.
    const sections = ["positive", "neutral", "negative"].map((kind) => {
      const traits = [...this.#traits.values()]
        .filter((trait) => trait.kind === kind)
        .sort((a, b) => a.label.localeCompare(b.label, lang))
        .map(traitTile);
      return {
        kind,
        label: i18n.localize(`REDSTEEL.Creation.TraitKind.${kind}`),
        traits,
      };
    });

    // Info panel: every subject's HTML, so a hover can swap it in without a
    // re-render.
    this.#infoHtml = this.#buildInfo(state);
    if (!this.#info || !this.#infoHtml.has(this.#info)) {
      this.#info =
        draft.step === 2 && draft.doctrines.length
          ? `doctrine:${draft.doctrines[0]}`
          : draft.race
            ? `race:${draft.race}`
            : null;
    }

    // Step 2: the doctrines, in blocks by kind. The magical doctrines need the
    // Magic potential trait (drafted, or already on the character) and stay
    // listed but greyed out without it.
    const step = draft.step;
    const isDetails = step === 2 && draft.stage === "details";
    const magicOpen = this.#hasMagicPotential();
    const doctrineKinds = DOCTRINE_KIND_ORDER.map((kind) => ({
      kind,
      label: i18n.localize(`REDSTEEL.Learn.Sections.${kind}`),
      needsMagic: kind === "magical" && !magicOpen,
      doctrines: this.#doctrineKeys()
        .filter((key) => getLearnSection(`doctrines.${key}`) === kind)
        .map((key) => this.#doctrineCard(key, { editable, locked: kind === "magical" && !magicOpen }))
        .sort((a, b) => a.label.localeCompare(b.label, i18n.lang)),
    })).filter((block) => block.doctrines.length);
    const details = isDetails ? this.#buildDetails(editable) : null;
    // 2.5's info row opens on what was picked there (the first taken card),
    // never on a step 2 doctrine left over from the card before.
    if (details && !/^(skill|school):/.test(this.#info ?? "")) {
      const cards = details.groups.flatMap((group) => group.cards);
      const first = cards.find((card) => card.selected) ?? cards[0];
      if (first?.info && this.#infoHtml.has(first.info)) this.#info = first.info;
    }

    return Object.assign(context, {
      actor: this.actor,
      identity: this.#identity(),
      editable,
      hasRace,
      step,
      isStep1: step === 1,
      // Step 2's first half (the doctrine and school cards); isDetails is 2.5.
      isStep2: step === 2 && !isDetails,
      isDetails,
      details,
      stepTitle: i18n.localize(isDetails ? "REDSTEEL.Creation.Step2b.title" : `REDSTEEL.Creation.Step${step}.title`),
      stepOf: i18n.format("REDSTEEL.Creation.stepOf", { n: step, total: STEP_COUNT }),
      // 2.5 sits halfway between steps 2 and 3.
      progress: Math.round(((isDetails ? step + 0.5 : step) / STEP_COUNT) * 100),
      isFirstStep: step === 1,
      doctrineKinds,
      magicOpen,
      selectedDoctrines: draft.doctrines.map((key) => this.#doctrineLabel(key)),
      raceOptions,
      subraceOptions,
      raceRequirement,
      choiceGroups,
      attributes,
      pointsRemaining: i18n.format("REDSTEEL.Creation.pointsRemaining", {
        remaining: state.remaining,
        budget: state.budget,
      }),
      // HTML: only the remaining number turns red when it is below zero.
      traitPointsRemaining: (() => {
        const mark = "\u0000";
        const text = escapeHtml(
          i18n.format("REDSTEEL.Creation.traitPointsRemaining", { remaining: mark, total: state.traitPoints }),
        );
        const number = `<span class="rs-create-num${state.traitRemaining < 0 ? " is-over" : ""}">${
          state.traitRemaining
        }</span>`;
        return text.includes(mark) ? text.replace(mark, number) : text;
      })(),
      // Steps 1 and 2: what the character will have (null hides the strip).
      preview: await this.#preview(state),
      traitCount: i18n.format("REDSTEEL.Creation.traitCount", {
        count: state.traitCount,
        max: MAX_TRAITS,
      }),
      traitSections: sections,
      // Centre: the picked traits in three columns by kind, each in the order
      // its traits were taken.
      hasPickedTraits: draft.traits.some((id) => this.#traits.has(id)),
      pickedColumns: ["positive", "neutral", "negative"].map((kind) => ({
        kind,
        label: i18n.localize(`REDSTEEL.Creation.TraitKind.${kind}`),
        traits: draft.traits
          .map((id) => this.#traits.get(id))
          .filter((trait) => trait?.kind === kind)
          .map(traitTile),
      })),
      infoHtml: (this.#info && this.#infoHtml.get(this.#info)) ?? "",
    });
  }

  /** Info panel HTML for every race, trait and attribute. */
  #buildInfo(state) {
    const i18n = game.i18n;
    const map = new Map();
    const frame = (title, meta, body) =>
      `<h3 class="rs-create-info-title">${escapeHtml(title)}</h3>` +
      (meta ? `<div class="rs-create-info-meta">${meta}</div>` : "") +
      (body ? `<div class="rs-create-info-desc">${body}</div>` : "");

    for (const entry of CREATION_RACES) {
      if (!this.#raceDocs.has(entry.key)) continue;
      const requirement = entry.requires?.trait
        ? `<p class="rs-create-info-req">${escapeHtml(
            i18n.localize(`REDSTEEL.Creation.Requires.${entry.key}`),
          )}</p>`
        : "";
      map.set(
        `race:${entry.key}`,
        frame(
          i18n.localize(entry.labelKey),
          "",
          requirement +
            this.#racialBonusesHtml(entry, this.#raceDocs.get(entry.key)) +
            this.#racialFeaturesHtml(entry.key) +
            (this.#raceDescriptions.get(entry.key) ?? ""),
        ),
      );
    }

    for (const trait of this.#traits.values()) {
      const meta = escapeHtml(
        `${i18n.localize(`REDSTEEL.Creation.TraitKind.${trait.kind}`)} · ${trait.cost}`,
      );
      map.set(`trait:${trait.id}`, frame(trait.label, meta, trait.description));
    }

    for (const k of ATTRIBUTE_KEYS) {
      const facts = [
        [i18n.localize("REDSTEEL.Creation.Info.base"), 1],
        [i18n.localize("REDSTEEL.Creation.Info.racialBonus"), signed(state.bonus[k] - state.traitBonus[k])],
        ...(state.traitBonus[k]
          ? [[i18n.localize("REDSTEEL.Creation.Info.traitBonus"), signed(state.traitBonus[k])]]
          : []),
        [i18n.localize("REDSTEEL.Creation.Info.spent"), this.#draft.spend[k]],
        [i18n.localize("REDSTEEL.Creation.Info.limit"), state.entry ? state.limits[k] : "—"],
      ];
      const meta =
        `<dl class="rs-create-info-facts">` +
        facts
          .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
          .join("") +
        `</dl>`;
      const descKey = `REDSTEEL.StatInfo.${k}`;
      const desc = i18n.has(descKey, false) ? `<p>${escapeHtml(i18n.localize(descKey))}</p>` : "";
      map.set(
        `attr:${k}`,
        frame(
          i18n.localize(CONFIG.REDSTEEL.attributes?.[k] ?? k),
          meta,
          desc + this.#derivedSkillsHtml(k),
        ),
      );
    }

    // Doctrines (step 2): kind, what rank I costs once points are handed out,
    // and for a magical one, that it needs Magic potential.
    for (const key of this.#doctrineKeys()) {
      const trackId = `doctrines.${key}`;
      const kind = getLearnSection(trackId);
      const rank1 = getRankPrice(trackId, 1);
      const facts = [[i18n.localize("REDSTEEL.Creation.Doctrine.kind"), i18n.localize(`REDSTEEL.Learn.Sections.${kind}`)]];
      if (rank1?.cost) {
        facts.push([
          i18n.localize("REDSTEEL.Creation.Doctrine.rank1"),
          i18n.localize(
            rank1.currency === "sp" ? "REDSTEEL.Creation.Info.priceSp" : "REDSTEEL.Creation.Info.priceCp",
          ).replace("{n}", rank1.cost),
        ]);
      }
      const meta =
        `<dl class="rs-create-info-facts">` +
        facts
          .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
          .join("") +
        `</dl>`;
      const requirement =
        kind === "magical"
          ? `<p class="rs-create-info-req">${escapeHtml(i18n.localize("REDSTEEL.Creation.Doctrine.needsMagic"))}</p>`
          : "";
      // All ten ranks: the abilities each hands over, and the book's other
      // rank effects.
      const path = this.#rankPathHtml(trackId, this.#doctrineLadders?.get(key) ?? []);
      const crest = this.#doctrineCrest(key);
      const head =
        `<div class="rs-create-info-crest is-${escapeHtml(kind)}">` +
        `<span class="rs-dc-crest"><img src="${escapeHtml(crest)}" alt=""></span></div>`;
      map.set(
        `doctrine:${key}`,
        // What the doctrine is and what it fights with first, then the ranks.
        head +
          frame(
            this.#doctrineLabel(key),
            meta,
            requirement + this.#doctrineAboutHtml(key) + path,
          ),
      );
    }

    // Schools (2.5): the crest, what sets or gates it, and all ten ranks.
    const temperament = this.#temperamentSchool();
    for (const key of CREATION_SCHOOLS) {
      const head =
        `<div class="rs-create-info-crest is-magical">` +
        `<span class="rs-dc-crest is-glyph"><i class="fa-solid ${SCHOOL_GLYPHS[key]}"></i></span></div>`;
      const notes =
        temperament === key
          ? `<p class="rs-create-info-req">${escapeHtml(i18n.localize("REDSTEEL.Creation.Doctrine.temperamentSchool"))}</p>`
          : "";
      map.set(
        `school:${key}`,
        head +
          frame(
            this.#schoolLabel(key),
            escapeHtml(i18n.localize("REDSTEEL.Creation.Details.schoolKind")),
            notes + this.#rankPathHtml(`schools.${key}`, this.#skillLadders?.get(`schools.${key}`) ?? []),
          ),
      );
    }

    // The skills 2.5 offers as cards: kind, what rank I costs, all ten ranks.
    for (const [trackId, card] of Object.entries(SKILL_CARDS)) {
      const [group] = trackId.split(".");
      const facts = [
        [
          i18n.localize("REDSTEEL.Creation.Doctrine.kind"),
          i18n.localize(group === "weaponSkills" ? "REDSTEEL.Creation.Details.weaponSkill" : "REDSTEEL.Creation.Details.combatSkill"),
        ],
      ];
      const rank1 = getRankPrice(trackId, 1);
      if (rank1?.cost) {
        facts.push([
          i18n.localize("REDSTEEL.Creation.Doctrine.rank1"),
          i18n.localize(
            rank1.currency === "sp" ? "REDSTEEL.Creation.Info.priceSp" : "REDSTEEL.Creation.Info.priceCp",
          ).replace("{n}", rank1.cost),
        ]);
      }
      const meta =
        `<dl class="rs-create-info-facts">` +
        facts
          .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
          .join("") +
        `</dl>`;
      const head =
        `<div class="rs-create-info-crest is-${escapeHtml(card.kind)}">` +
        `<span class="rs-dc-crest"><img src="${escapeHtml(card.img)}" alt=""></span></div>`;
      map.set(
        `skill:${trackId}`,
        // A weapon skill's weapons (the "Compatible weapons" pill), then its ranks.
        head +
          frame(
            this.#skillLabel(trackId),
            meta,
            this.#skillWeaponsHtml(trackId) + this.#rankPathHtml(trackId, this.#skillLadders?.get(trackId) ?? []),
          ),
      );
    }
    return map;
  }

  /**
   * The info panel's ranks block: all ten ranks of a track, each with the
   * abilities it hands over (icon and name, description on hover) and the
   * book's other effects for it (RANK_EFFECTS, worded as the Learn window
   * words them). A book line that only names a granted ability is left to that
   * ability's row; one carrying a rider after a colon stays. A rank that does
   * nothing shows a dash.
   */
  #rankPathHtml(trackId, ladder) {
    const rows = [];
    for (let rank = 1; rank <= ROMAN_RANKS.length; rank++) {
      const grants = ladder.filter((step) => step.rank === rank);
      const chips = markAbilityChips(
        describeRankChips(trackId, rank),
        grants.map((step) => ({ localizedName: step.name, name: step.docName })),
      ).filter((chip) => !chip.ability || String(chip.text ?? "").includes(":"));
      const body = [
        ...grants.map(
          (step) =>
            `<span class="rs-create-rank-ability" data-tt-kind="creationFeature" data-tt-id="${escapeHtml(step.id)}">` +
            `<img class="rs-create-feature-icon" src="${escapeHtml(step.img)}" alt="">` +
            `<span class="rs-create-feature-text">${escapeHtml(step.name)}</span></span>`,
        ),
        ...chips.map((chip) => `<span class="rs-create-rank-effect">${escapeHtml(chip.text)}</span>`),
      ];
      rows.push(
        `<li class="rs-create-rank">` +
          `<span class="rs-create-feature-rank">${escapeHtml(ROMAN_RANKS[rank - 1])}</span>` +
          `<div class="rs-create-rank-body">${
            body.join("") || `<span class="rs-create-rank-effect is-empty">&mdash;</span>`
          }</div></li>`,
      );
    }
    return (
      `<h4 class="rs-create-info-subtitle">${escapeHtml(game.i18n.localize("REDSTEEL.Creation.Doctrine.ranks"))}</h4>` +
      `<ul class="rs-create-ranks">${rows.join("")}</ul>`
    );
  }

  /**
   * The info panel's weapons block for a 2.5 skill card: the "Compatible
   * weapons" pill, which lists on click every weapon the skill covers
   * (compatibleWeapons.mjs; the catalog is in by step 2). "" for a skill with
   * no weapons of its own (Combat, Archery, Channeling).
   */
  #skillWeaponsHtml(trackId) {
    const pill = compatibleWeaponsPill(trackId, "rs-create-skill-chip");
    if (!pill) return "";
    return (
      `<h4 class="rs-create-info-subtitle">${escapeHtml(game.i18n.localize("REDSTEEL.Creation.Doctrine.weapons"))}</h4>` +
      `<div class="rs-create-skill-chips">${pill}</div>`
    );
  }

  /** A combat or weapon skill's localized name, by track id. */
  #skillLabel(trackId) {
    const [group, key] = trackId.split(".");
    return game.i18n.localize(`REDSTEEL.Actor.Character.${group}.${key}.label`);
  }

  /**
   * One skill card for 2.5: a weapon skill or a combat skill, picked for
   * `owner` (the doctrine, or the school for Channeling). `fixedText` marks the
   * one the owner is bound to; `shut` greys out the others beside it.
   */
  #skillCard(trackId, { owner, action, selected, fixedText = "", shut = false, editable }) {
    const i18n = game.i18n;
    const [group, key] = trackId.split(".");
    const card = SKILL_CARDS[trackId];
    return {
      key,
      kind: card.kind,
      action,
      keyAttr: group === "weaponSkills" ? "weapon" : "skill",
      owner,
      info: `skill:${trackId}`,
      label: this.#skillLabel(trackId),
      kindLabel: i18n.localize(
        group === "weaponSkills" ? "REDSTEEL.Creation.Details.weaponSkill" : "REDSTEEL.Creation.Details.combatSkill",
      ),
      crest: card.img,
      selected,
      locked: false,
      fixed: !!fixedText,
      fixedText,
      shut,
      disabled: !editable || !!fixedText || shut,
    };
  }

  /**
   * One doctrine card for the step 2 grid.
   * `action` is the click it carries; `locked` greys it out under a padlock.
   */
  #doctrineCard(key, { editable, action = "toggleDoctrine", selected, locked = false } = {}) {
    const i18n = game.i18n;
    const kind = getLearnSection(`doctrines.${key}`);
    return {
      key,
      kind,
      action,
      keyAttr: "doctrine",
      info: `doctrine:${key}`,
      label: this.#doctrineLabel(key),
      kindLabel: i18n.localize(`REDSTEEL.Creation.Doctrine.Kind.${kind}`),
      crest: this.#doctrineCrest(key),
      selected: selected ?? this.#draft.doctrines.includes(key),
      locked,
      lockText: locked ? i18n.localize("REDSTEEL.Creation.Doctrine.needsMagic") : "",
      disabled: !editable || locked,
    };
  }

  /**
   * Step 2.5, one plate of cards in blocks: per combat doctrine that trains
   * with a weapon skill, the four weapon skills (a fixed one taken, the rest
   * greyed out); per doctrine with a combat skill, Combat and Archery the same
   * way (the Peltast chooses); Channeling alone for a magical doctrine.
   */
  #buildDetails(editable) {
    const i18n = game.i18n;
    const draft = this.#draft;
    const groups = [];
    for (const key of weaponDoctrines(draft.doctrines)) {
      const fixed = FIXED_WEAPONS[key] ?? null;
      const chosen = weaponFor(draft, key);
      const doctrine = this.#doctrineLabel(key);
      groups.push({
        label: i18n.format("REDSTEEL.Creation.Details.weaponFor", { doctrine }),
        cards: WEAPON_SKILL_KEYS.map((weapon) => {
          const trackId = `weaponSkills.${weapon}`;
          const allowed = this.#weaponAllowed(key, weapon);
          return this.#skillCard(trackId, {
            owner: key,
            action: "pickWeapon",
            selected: weapon === chosen && allowed,
            fixedText:
              fixed === weapon
                ? i18n.format("REDSTEEL.Creation.Details.fixedWeapon", { doctrine, weapon: this.#skillLabel(trackId) })
                : "",
            shut: (!!fixed && fixed !== weapon) || !allowed,
            editable,
          });
        }),
      });
    }
    for (const key of combatSkillDoctrines(draft.doctrines)) {
      const fixed = fixedCombatSkill(key);
      const chosen = fixed ?? draft.combatSkill;
      const doctrine = this.#doctrineLabel(key);
      groups.push({
        label: i18n.format("REDSTEEL.Creation.Details.combatSkillFor", { doctrine }),
        // The Peltast's choice carries the book's comparison.
        advice: fixed ? "" : i18n.localize("REDSTEEL.Creation.Details.peltastAdvice"),
        cards: COMBAT_SKILL_KEYS.map((skill) => {
          const trackId = `combatSkills.${skill}`;
          return this.#skillCard(trackId, {
            owner: key,
            action: "pickCombatSkill",
            selected: skill === chosen,
            fixedText:
              fixed === skill
                ? i18n.format("REDSTEEL.Creation.Details.fixedCombatSkill", { doctrine, skill: this.#skillLabel(trackId) })
                : "",
            shut: !!fixed && fixed !== skill,
            editable,
          });
        }),
      });
    }
    const magical = draft.doctrines.find((key) => isMagicalDoctrine(key));
    if (magical) {
      // A magical doctrine casts through a school (user ruling 2026-10-10):
      // pick one, or take the temperament's. Channeling comes with it.
      groups.push({
        label: i18n.format("REDSTEEL.Creation.Details.schoolFor", { doctrine: this.#doctrineLabel(magical) }),
        cards: this.#schoolCards(editable),
      });
    }
    return { groups: groups.filter((group) => group.cards.length) };
  }

  /**
   * The school cards for 2.5: with a temperament its school is taken and the
   * rest are shut, else exactly one may be picked.
   */
  #schoolCards(editable) {
    const i18n = game.i18n;
    const temperament = this.#temperamentSchool();
    const school = this.#school();
    return CREATION_SCHOOLS.map((key) => {
      const selected = key === school;
      return {
        key,
        kind: "magical",
        action: "pickSchool",
        keyAttr: "school",
        info: `school:${key}`,
        label: this.#schoolLabel(key),
        kindLabel: i18n.localize("REDSTEEL.Creation.Details.schoolKind"),
        glyph: SCHOOL_GLYPHS[key],
        selected,
        // The temperament's school: taken, and it cannot be put down.
        fixed: selected && !!temperament,
        fixedText: selected && temperament ? i18n.localize("REDSTEEL.Creation.Doctrine.temperamentSchool") : "",
        shut: !!temperament && !selected,
        disabled: !editable || !!temperament,
      };
    });
  }

  /** A school's localized name. */
  #schoolLabel(key) {
    return game.i18n.localize(`REDSTEEL.Actor.Character.schools.${key}.label`);
  }

  /**
   * The school a temperament sets (TEMPERAMENT_SCHOOLS, by English trait
   * name): from a drafted trait, or before the origin was ever applied, from
   * a temperament the character already owns. Null without one.
   */
  #temperamentSchool() {
    for (const id of this.#draft.traits) {
      const school = TEMPERAMENT_SCHOOLS[TRAIT_PRICES[id]?.name];
      if (school && CREATION_SCHOOLS.includes(school)) return school;
    }
    if (this.#draft.applied) return null;
    for (const [name, school] of Object.entries(TEMPERAMENT_SCHOOLS)) {
      const wanted = name.toLowerCase();
      const owned = this.actor?.items?.contents?.some(
        (i) => i.type === "feature" && i.name?.toLowerCase() === wanted,
      );
      if (owned && CREATION_SCHOOLS.includes(school)) return school;
    }
    return null;
  }

  /**
   * The school the character takes: none without Magic potential and a
   * magical doctrine, the temperament's when there is one, else the pick.
   */
  #school() {
    if (!this.#hasMagicPotential()) return null;
    if (!this.#draft.doctrines.some((key) => isMagicalDoctrine(key))) return null;
    return this.#temperamentSchool() ?? this.#draft.school;
  }

  /**
   * Bring the draft's magical doctrine and school in line before step 2 is
   * left: no magical doctrine without Magic potential, at most one with it,
   * and the school as #school() reads it (none without a magical doctrine).
   * Weapon picks for doctrines no longer drafted go, and so does the
   * Peltast's combat skill without the Peltast.
   */
  #settleMagic() {
    const draft = this.#draft;
    const magical = draft.doctrines.filter((key) => isMagicalDoctrine(key));
    const keep = this.#hasMagicPotential() ? magical.slice(0, 1) : [];
    draft.doctrines = draft.doctrines.filter((key) => !isMagicalDoctrine(key) || keep.includes(key));
    draft.school = this.#school();
    const asked = new Set(weaponDoctrines(draft.doctrines).filter((key) => !FIXED_WEAPONS[key]));
    draft.weapons = Object.fromEntries(
      Object.entries(draft.weapons).filter(([key, weapon]) => asked.has(key) && this.#weaponAllowed(key, weapon)),
    );
    if (!draft.doctrines.includes(COMBAT_SKILL_CHOICE)) draft.combatSkill = null;
  }

  /**
   * A weapon skill the doctrine can train with: one its weapons are fought
   * with (user ruling 2026-10-06: a Reaver takes no Swords or Polearms). Read
   * off the weapons naming the doctrine (compatibleWeapons.mjs). A doctrine
   * with no weapon skill found, or data not loaded, allows every skill rather
   * than locking the player out.
   */
  #weaponAllowed(doctrine, weapon) {
    const allowed = this.#doctrineWeapons?.get(doctrine)?.weaponSkills;
    return !allowed?.size || allowed.has(weapon);
  }

  /** What 2.5 still lacks, as true when something is unanswered. */
  #detailsIncomplete() {
    const draft = this.#draft;
    if (
      weaponDoctrines(draft.doctrines).some((key) => {
        const weapon = weaponFor(draft, key);
        return !weapon || !this.#weaponAllowed(key, weapon);
      })
    ) {
      return true;
    }
    if (draft.doctrines.includes(COMBAT_SKILL_CHOICE) && !draft.combatSkill) return true;
    if (draft.doctrines.some((key) => isMagicalDoctrine(key)) && !this.#school()) return true;
    return false;
  }

  /**
   * The skills an attribute governs, as a list for the info panel. A skill's
   * `id` indexes system.attributes (the same reading as the skill tooltip in
   * tooltipProviders.mjs); type 2 skills (muscles, nimbleness) derive from
   * their rank alone and have no governing attribute.
   */
  #derivedSkillsHtml(k) {
    const system = this.actor?.system ?? {};
    const index = Object.keys(system.attributes ?? {}).indexOf(k);
    if (index < 0) return "";
    const lang = game.i18n.lang;
    const names = Object.entries(system.skills ?? {})
      .filter(([, skill]) => Number(skill?.id) === index && skill?.type !== 2)
      .map(([key]) => {
        const labelKey = `REDSTEEL.Actor.Character.skills.${key}.label`;
        return game.i18n.has(labelKey, false) ? game.i18n.localize(labelKey) : key;
      })
      .sort((a, b) => a.localeCompare(b, lang));
    if (!names.length) return "";
    return (
      `<h4 class="rs-create-info-subtitle">${escapeHtml(
        game.i18n.localize("REDSTEEL.Creation.Info.derivedSkills"),
      )}</h4>` +
      `<ul class="rs-create-info-skills">${names
        .map((name) => `<li>${escapeHtml(name)}</li>`)
        .join("")}</ul>`
    );
  }

  /** Swap the info panel to one subject without re-rendering. */
  #showInfo(key) {
    if (!key || key === this.#info || !this.#infoHtml.has(key)) return;
    this.#info = key;
    const body = this.element?.querySelector?.(".rs-create-info .rs-create-scroll");
    if (body) {
      body.innerHTML = this.#infoHtml.get(key);
      body.scrollTop = 0;
    }
  }

  /**
   * Put the screen above Foundry's interface but under every tooltip (the
   * Learn window's rule; see LearnWindow#applyLayer).
   */
  #applyLayer() {
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    let ceiling = SYSTEM_TOOLTIP_LAYER;
    const tip = game.tooltip?.tooltip;
    if (tip instanceof HTMLElement && !tip.hasAttribute("popover")) {
      const z = Number.parseInt(getComputedStyle(tip).zIndex, 10);
      if (Number.isFinite(z)) ceiling = Math.min(ceiling, z);
    }
    root.style.setProperty("z-index", String(ceiling - 1), "important");
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender?.(context, options);
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    this.#applyLayer();

    // The root survives re-renders, so the listener is bound once and
    // released in _onClose.
    if (!this.#boundInfo) {
      this.#boundInfo = (event) => {
        // Step 2 (and 2.5) describes only what is clicked (user ruling
        // 2026-10-06): sweeping the pointer over the cards must not swap it.
        if (event.type === "pointerover" && this.#draft.step === 2) return;
        const source = event.target?.closest?.("[data-info]");
        if (source && root.contains(source)) this.#showInfo(source.dataset.info);
      };
      root.addEventListener("pointerover", this.#boundInfo);
      root.addEventListener("focusin", this.#boundInfo);
    }
    if (!this.#boundChange) {
      this.#boundChange = (event) => {
        const input = event.target?.closest?.("input[data-draft='name']");
        if (input && root.contains(input)) this.#onNameChange(input.value);
      };
      root.addEventListener("change", this.#boundChange);
    }
  }

  /** Always close instantly, as the Learn window does. @override */
  async close(options = {}) {
    return super.close({ ...options, animate: false });
  }

  /** @override */
  _onClose(options) {
    const root = this.element;
    if (this.#boundInfo && root instanceof HTMLElement) {
      root.removeEventListener("pointerover", this.#boundInfo);
      root.removeEventListener("focusin", this.#boundInfo);
    }
    if (this.#boundChange && root instanceof HTMLElement) {
      root.removeEventListener("change", this.#boundChange);
    }
    this.#boundInfo = null;
    this.#boundChange = null;
    super._onClose?.(options);
  }

  /* ---------------------------------------- */
  /*  Actions                                 */
  /* ---------------------------------------- */

  /** The doctrines creation offers: every doctrine the price table knows, bar the hidden ones. */
  #doctrineKeys() {
    return Object.keys(this.actor?.system?.doctrines ?? {}).filter(
      (key) => !HIDDEN_DOCTRINES.has(key) && getRankPrice(`doctrines.${key}`, 1),
    );
  }

  /**
   * A doctrine's crest: a magical doctrine wears its specialisation's card
   * art (the GM's pick, else SPEC_ICONS); the rest their chosen icon; else
   * the first ability the doctrine teaches.
   */
  #doctrineCrest(key) {
    if (SPEC_CREST_DOCTRINES.has(key)) {
      const art = specIconOverrides()[key] || SPEC_ICONS[key];
      if (art) return art;
    }
    return (
      DOCTRINE_CRESTS[key] ?? this.#doctrineLadders?.get(key)?.[0]?.img ?? DOCTRINE_FALLBACK_CREST
    );
  }

  /** A doctrine's localized name. */
  #doctrineLabel(key) {
    const labelKey = `REDSTEEL.Actor.Character.doctrines.${key}.label`;
    return game.i18n.has(labelKey, false) ? game.i18n.localize(labelKey) : key;
  }

  /**
   * Magic potential is drafted, or the character already has it. Once the
   * origin was applied, the actor's own flag may come from a trait creation
   * wrote and the player has dropped since, so only the draft counts.
   */
  #hasMagicPotential() {
    const draft = this.#draft;
    return draft.traits.includes(MAGIC_POTENTIAL_ID) || (!draft.applied && !!this.actor?.system?.magicPotential);
  }

  /** The name the character will have: the draft's, else the actor's own. */
  #identity() {
    return { name: this.#draft.name ?? this.actor?.name ?? "" };
  }

  /** The name field lost focus with new text. */
  async #onNameChange(value) {
    if (!this.actor?.isOwner) return;
    this.#draft.name = String(value ?? "").trim() || null;
    await this.#commit();
  }

  /**
   * One Active Effect change as a readable bonus ("Charisma +1", "Mana +3",
   * "Stealth +10%"), or null for a key this panel has no name for.
   */
  #changeLabel(change) {
    const i18n = game.i18n;
    const key = change?.key ?? "";
    const value = Number(change?.value);
    if (!Number.isFinite(value) || !isAddChange(change)) return null;
    const loc = (k) => (i18n.has(k, false) ? i18n.localize(k) : null);
    let m;
    let name = null;
    let percent = false;
    if ((m = /^system\.attributes\.(\w+)\.bonus$/.exec(key))) {
      name = CONFIG.REDSTEEL.attributes?.[m[1]] ? i18n.localize(CONFIG.REDSTEEL.attributes[m[1]]) : null;
    } else if ((m = /^system\.secondaryAttributes\.(\w+)\.bonus$/.exec(key))) {
      name = CONFIG.REDSTEEL.secondaryAttributes?.[m[1]]
        ? i18n.localize(CONFIG.REDSTEEL.secondaryAttributes[m[1]])
        : null;
    } else if ((m = /^system\.skills\.(\w+)\.bonus$/.exec(key))) {
      name = loc(`REDSTEEL.Actor.Character.skills.${m[1]}.label`);
      percent = true;
    } else if ((m = /^system\.combatSkills\.(\w+)\.bonus$/.exec(key))) {
      name = loc(`REDSTEEL.Actor.Character.combatSkills.${m[1]}.label`);
      percent = true;
    } else if ((m = /^system\.stats\.(\w+)\.base$/.exec(key))) {
      name = loc(`REDSTEEL.Actor.Character.stats.${m[1]}.value.label`);
    } else if ((m = /^system\.armor\.(\w+)\.bonus$/.exec(key))) {
      name = loc(`REDSTEEL.Item.Gear.FIELDS.${m[1]}.label`);
    }
    if (!name) return null;
    return `${name} ${signed(value)}${percent ? "%" : ""}`;
  }

  /**
   * A race's bonuses, read straight off its Active Effects so the panel can
   * never disagree with what Finish applies: the fixed ones, then each choice
   * group with its options (a * marks an option that also raises the limit),
   * then the trait points.
   */
  #racialBonusesHtml(entry, doc) {
    const i18n = game.i18n;
    const groups = getRaceChoiceGroups(doc);
    const choiceIds = new Set(groups.flatMap((g) => g.effectIds));
    const fixed = [];
    for (const effect of doc.effects.contents) {
      if (choiceIds.has(effect.id) || effect.disabled) continue;
      for (const change of effectChanges(effect)) {
        const label = this.#changeLabel(change);
        if (label) fixed.push(label);
      }
    }
    const rows = [];
    if (fixed.length) {
      rows.push(
        `<li><b>${escapeHtml(i18n.localize("REDSTEEL.Creation.Info.fixedBonuses"))}:</b> ${escapeHtml(
          fixed.join(", "),
        )}</li>`,
      );
    }
    for (const group of groups) {
      const options = group.effectIds
        .map((id) => doc.effects.get(id))
        .filter(Boolean)
        .map((effect) => {
          const labels = effectChanges(effect).map((c) => this.#changeLabel(c)).filter(Boolean);
          const text = labels.length ? labels.join(", ") : effect.name;
          return effect.flags?.redsteel?.raisesLimit === true ? `${text}*` : text;
        });
      const pick = i18n.format("REDSTEEL.Race.Choices.PickCount", { count: group.count });
      rows.push(
        `<li><b>${escapeHtml(i18n.localize(group.label))}</b> <em>(${escapeHtml(pick)})</em>: ${escapeHtml(
          options.join(" / "),
        )}</li>`,
      );
    }
    rows.push(
      `<li><b>${escapeHtml(i18n.localize("REDSTEEL.Creation.Info.traitPoints"))}:</b> ${entry.traitPoints}</li>`,
    );
    const note = groups.some((g) =>
      g.effectIds.some((id) => doc.effects.get(id)?.flags?.redsteel?.raisesLimit === true),
    )
      ? `<p class="rs-create-info-note">${escapeHtml(i18n.localize("REDSTEEL.Creation.Info.raisesLimitNote"))}</p>`
      : "";
    return (
      `<h4 class="rs-create-info-subtitle">${escapeHtml(
        i18n.localize("REDSTEEL.Creation.Info.racialBonuses"),
      )}</h4><ul class="rs-create-info-bonuses">${rows.join("")}</ul>${note}`
    );
  }

  /**
   * The race and subrace buttons. A race button (data-group) with subraces
   * takes its first subrace, which the subrace row then shows and can change;
   * a subrace button (data-race) names its entry outright.
   * @this {CharacterCreationWindow}
   */
  static async _onPickRace(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    let key = target?.dataset.race ?? null;
    const group = target?.dataset.group;
    if (!key && group) {
      if (RACE_BY_KEY.get(this.#draft.race)?.group === group) return;
      const available = CREATION_RACES.filter(
        (entry) => entry.group === group && this.#raceDocs?.has(entry.key),
      );
      key = (available.find((entry) => entry.key === group) ?? available[0])?.key ?? null;
    }
    if (!key) return;
    await this.#pickRace(key);
  }

  /** Make one CREATION_RACES entry the draft's race. */
  async #pickRace(key) {
    if (!key || !RACE_BY_KEY.has(key) || !this.#raceDocs?.has(key)) return;
    this.#info = `race:${key}`;
    if (this.#draft.race === key) {
      this.render();
      return;
    }
    this.#draft.race = key;
    this.#draft.choices = [];
    this.#clampSpend(this.#draft);
    await this.#commit();
  }

  /** @this {CharacterCreationWindow} */
  static async _onPickChoice(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const el = target?.closest?.("[data-effect]");
    const index = Number(el?.dataset.group);
    const effectId = el?.dataset.effect;
    const state = this.#compute();
    const group = state.groups[index];
    if (!group || !group.effectIds.includes(effectId)) return;

    const choices = this.#draft.choices;
    while (choices.length < state.groups.length) choices.push([]);

    // A chip toggles: a picked one is given back; an unpicked one is taken,
    // and when the group then holds more than it allows, its oldest pick
    // gives way.
    let picked = (choices[index] ?? []).filter((id) => group.effectIds.includes(id));
    if (picked.includes(effectId)) {
      picked = picked.filter((id) => id !== effectId);
    } else {
      picked.push(effectId);
      while (picked.length > group.count) picked.shift();
    }
    choices[index] = picked;
    this.#clampSpend(this.#draft);
    await this.#commit();
  }

  /** @this {CharacterCreationWindow} */
  static async _onAttrUp(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const k = target?.closest?.("[data-attr]")?.dataset.attr;
    if (!ATTRIBUTE_KEYS.includes(k)) return;
    const state = this.#compute();
    if (!state.entry || state.remaining <= 0 || !state.canRaise[k]) return;
    this.#info = `attr:${k}`;
    this.#draft.spend[k] += 1;
    await this.#commit();
  }

  /** @this {CharacterCreationWindow} */
  static async _onAttrDown(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const k = target?.closest?.("[data-attr]")?.dataset.attr;
    if (!ATTRIBUTE_KEYS.includes(k) || this.#draft.spend[k] <= 0) return;
    this.#info = `attr:${k}`;
    this.#draft.spend[k] -= 1;
    await this.#commit();
  }

  /** @this {CharacterCreationWindow} */
  static async _onToggleTrait(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const id = target?.closest?.("[data-trait]")?.dataset.trait;
    const price = TRAIT_PRICES[id];
    if (!price || !this.#traits?.has(id)) return;
    this.#info = `trait:${id}`;
    const state = this.#compute();
    if (!state.entry) return;

    const traits = this.#draft.traits;
    if (traits.includes(id)) {
      // Taking back a negative trait takes back the points it gave. That may
      // leave the budget negative (user ruling 2026-10-06): allowed here, and
      // Next refuses until it is settled (#originProblem, Warn.traitOverspent).
      if (id === MAGIC_POTENTIAL_ID && !(await this.#confirmDropMagic())) return;
      this.#draft.traits = traits.filter((t) => t !== id);
      if (id === MAGIC_POTENTIAL_ID) {
        this.#draft.doctrines = this.#draft.doctrines.filter((k) => !isMagicalDoctrine(k));
      }
    } else {
      if (traits.length >= MAX_TRAITS) {
        ui.notifications.warn(
          game.i18n.format("REDSTEEL.Creation.Warn.traitLimit", { max: MAX_TRAITS }),
        );
        return;
      }
      const held = isTemperament(id) ? traits.find((t) => isTemperament(t)) : null;
      if (held) {
        ui.notifications.warn(
          game.i18n.format("REDSTEEL.Creation.Warn.oneTemperament", {
            name: this.#traits?.get(held)?.label ?? TRAIT_PRICES[held]?.name ?? held,
          }),
        );
        return;
      }
      if (price.cost > 0 && price.cost > state.traitRemaining) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Creation.Warn.traitUnaffordable"));
        return;
      }
      this.#draft.traits = [...traits, id];
    }
    // Dropping a cap-raising trait lowers that limit again.
    // A trait can move a limit (Brawny) or an attribute itself (Imp), so
    // bought points are re-checked against the limits either way.
    this.#clampSpend(this.#draft);
    await this.#commit();
  }

  /**
   * Dropping Magic potential loses the drafted magical doctrine. Asks first,
   * but only when one is drafted (user ruling 2026-10-06).
   * The dialog carries rs-create-confirm, which lifts it above this screen.
   * @returns {Promise<boolean>} true to go ahead.
   */
  async #confirmDropMagic() {
    const draft = this.#draft;
    const magical = draft.doctrines.filter((k) => isMagicalDoctrine(k));
    if (!magical.length) return true;
    const i18n = game.i18n;
    const lost = magical.map((k) => this.#doctrineLabel(k)).join(", ");
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["rs-create-confirm"],
      window: { title: i18n.localize("REDSTEEL.Creation.Confirm.dropMagicTitle") },
      content: `<p>${escapeHtml(i18n.format("REDSTEEL.Creation.Confirm.dropMagicContent", { lost }))}</p>`,
      rejectClose: false,
    });
    return confirmed === true;
  }

  /** One step back (none from step 1). @this {CharacterCreationWindow} */
  static async _onBack(event) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    // From 2.5 back to the doctrine cards.
    if (this.#draft.step === 2 && this.#draft.stage === "details") {
      this.#draft.stage = "doctrines";
      this.#info = null;
      await this.#commit();
      return;
    }
    if (this.#draft.step <= 1) return;
    this.#draft.step -= 1;
    this.#info = null;
    await this.#commit();
  }

  /**
   * On to the next step, once the current one is in order. Leaving Origin
   * also lets go of any magical doctrine the character can no longer take
   * (Magic potential dropped since). Next on this window's last step writes
   * the origin to the character and opens step 3 in the Learn window.
   * @this {CharacterCreationWindow}
   */
  static async _onNext(event) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    // Step 2's doctrine cards: on to 2.5 when it has something to ask, else
    // straight to the apply.
    if (this.#draft.step === WINDOW_STEPS && this.#draft.stage !== "details") {
      if (this.#draft.doctrines.filter(isMainDoctrine).length !== 1) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Creation.Doctrine.pickOne"));
        return;
      }
      this.#settleMagic();
      if (draftHasDetails(this.#draft)) {
        this.#draft.stage = "details";
        this.#info = null;
        await this.#commit();
        return;
      }
    } else if (this.#draft.step >= WINDOW_STEPS && this.#detailsIncomplete()) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Creation.Warn.detailsIncomplete"));
      return;
    }
    if (this.#draft.step >= WINDOW_STEPS) {
      if (this.#applying) return;
      this.#applying = true;
      try {
        await this.#saving;
        await this.#applyOrigin();
      } finally {
        this.#applying = false;
      }
      return;
    }
    if (this.#draft.step === 1) {
      const problem = this.#originProblem(this.#compute());
      if (problem) {
        ui.notifications.warn(
          problem.data ? game.i18n.format(problem.key, problem.data) : game.i18n.localize(problem.key),
        );
        return;
      }
      if (!this.#hasMagicPotential()) {
        this.#draft.doctrines = this.#draft.doctrines.filter(
          (key) => getLearnSection(`doctrines.${key}`) !== "magical",
        );
      }
      this.#draft.stage = "doctrines";
    }
    this.#draft.step += 1;
    this.#info = null;
    await this.#commit();
  }

  /**
   * Take or drop a doctrine. Exactly one melee or ranged doctrine (user ruling
   * 2026-10-06: a second comes later, through the Learn window): taking
   * another replaces it. Rogue toggles on its own and may sit beside it. At
   * most one magical doctrine, the same way, and only with Magic potential.
   * @this {CharacterCreationWindow}
   */
  static async _onToggleDoctrine(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const key = target?.closest?.("[data-doctrine]")?.dataset.doctrine;
    if (!key || !this.#doctrineKeys().includes(key)) return;
    this.#info = `doctrine:${key}`;
    const doctrines = this.#draft.doctrines;
    if (doctrines.includes(key)) {
      this.#draft.doctrines = doctrines.filter((k) => k !== key);
    } else if (isMagicalDoctrine(key)) {
      if (!this.#hasMagicPotential()) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Creation.Doctrine.needsMagic"));
        await this.#commit();
        return;
      }
      this.#draft.doctrines = [...doctrines.filter((k) => !isMagicalDoctrine(k)), key];
    } else if (key === COMPANION_DOCTRINE) {
      this.#draft.doctrines = [...doctrines, key];
    } else {
      this.#draft.doctrines = [...doctrines.filter((k) => !isMainDoctrine(k)), key];
    }
    await this.#commit();
  }

  /**
   * 2.5: the school of the magical doctrine (exactly one: another replaces
   * it, the taken one clears). A temperament's school cannot be changed.
   * @this {CharacterCreationWindow}
   */
  static async _onPickSchool(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const key = target?.closest?.("[data-school]")?.dataset.school;
    if (!CREATION_SCHOOLS.includes(key)) return;
    this.#info = `school:${key}`;
    if (this.#temperamentSchool()) {
      await this.#commit();
      return;
    }
    this.#draft.school = this.#draft.school === key ? null : key;
    await this.#commit();
  }

  /** 2.5: the weapon skill one doctrine trains with. @this {CharacterCreationWindow} */
  static async _onPickWeapon(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const el = target?.closest?.("[data-weapon]");
    const doctrine = el?.dataset.owner;
    const weapon = el?.dataset.weapon;
    if (!WEAPON_SKILL_KEYS.includes(weapon) || FIXED_WEAPONS[doctrine]) return;
    if (!weaponDoctrines(this.#draft.doctrines).includes(doctrine)) return;
    if (!this.#weaponAllowed(doctrine, weapon)) return;
    this.#info = `skill:weaponSkills.${weapon}`;
    this.#draft.weapons = { ...this.#draft.weapons, [doctrine]: weapon };
    await this.#commit();
  }

  /** 2.5: the Peltast's combat skill. @this {CharacterCreationWindow} */
  static async _onPickCombatSkill(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const el = target?.closest?.("[data-skill]");
    const skill = el?.dataset.skill;
    if (!COMBAT_SKILL_KEYS.includes(skill)) return;
    // Only the Peltast's cards choose; a fixed doctrine's are shut.
    if (el.dataset.owner !== COMBAT_SKILL_CHOICE) return;
    if (!this.#draft.doctrines.includes(COMBAT_SKILL_CHOICE)) return;
    this.#info = `skill:combatSkills.${skill}`;
    this.#draft.combatSkill = skill;
    await this.#commit();
  }

  /**
   * What stops the Origin step from being done, as a lang key (+ format data),
   * or null when it is in order.
   * @returns {{key: string, data?: object}|null}
   */
  #originProblem(state) {
    const draft = this.#draft;
    if (!state.entry) return { key: "REDSTEEL.Creation.Warn.noRace" };
    if (!state.doc) return { key: "REDSTEEL.Creation.Warn.raceMissing" };
    for (let i = 0; i < state.groups.length; i++) {
      const group = state.groups[i];
      const picked = (draft.choices[i] ?? []).filter((id) => group.effectIds.includes(id));
      if (picked.length !== group.count) {
        return {
          key: "REDSTEEL.Creation.Warn.choicesIncomplete",
          data: { label: game.i18n.localize(group.label), count: group.count },
        };
      }
    }
    if (!state.requirementMet) return { key: `REDSTEEL.Creation.Requires.${state.entry.key}` };
    if (state.traitRemaining < 0) return { key: "REDSTEEL.Creation.Warn.traitOverspent" };
    if (draft.traits.length > MAX_TRAITS) {
      return { key: "REDSTEEL.Creation.Warn.traitLimit", data: { max: MAX_TRAITS } };
    }
    return null;
  }

  /** Leave the screen; the draft stays on the actor. @this {CharacterCreationWindow} */
  static _onCloseScreen(event) {
    event.preventDefault();
    this.close();
  }

  /* ---------------------------------------- */
  /*  Applying the origin                     */
  /* ---------------------------------------- */

  /**
   * One trait's copy, fetched once per window and handed out as a fresh
   * object each time (the callers mark and mutate it). A failed fetch is not
   * kept, so the next call tries again.
   * @returns {Promise<object|null>}
   */
  async #traitCopy(id) {
    let pending = this.#traitCopies.get(id);
    if (!pending) {
      pending = featureCopyData(id);
      this.#traitCopies.set(id, pending);
    }
    const data = await pending.catch(() => null);
    if (!data) {
      this.#traitCopies.delete(id);
      return null;
    }
    return foundry.utils.deepClone(data);
  }

  /**
   * The item data the origin creates: the race (its choice effects enabled
   * for the picks, disabled otherwise) and a copy of every drafted trait, all
   * marked creationOrigin. Used by the apply and by the footer preview, so
   * the two cannot drift.
   * @returns {Promise<{raceData: object, traitData: object[], missing: string|null}>}
   *   `missing`: the first drafted trait whose copy could not be made
   *   (traitData then leaves it out).
   */
  async #buildOriginItems(state, draft = this.#draft) {
    const raceData = state.doc.toObject();
    delete raceData._id;
    raceData._stats = { ...(raceData._stats ?? {}), compendiumSource: state.doc.uuid };
    const chosen = new Set();
    state.groups.forEach((group, i) => {
      for (const id of draft.choices[i] ?? []) if (group.effectIds.includes(id)) chosen.add(id);
    });
    const choiceIds = new Set(state.groups.flatMap((g) => g.effectIds));
    for (const effect of raceData.effects ?? []) {
      if (choiceIds.has(effect._id)) effect.disabled = !chosen.has(effect._id);
    }

    // All trait copies fetched at once.
    const copies = await Promise.all(draft.traits.map((id) => this.#traitCopy(id)));
    const missing = draft.traits.find((id, i) => !copies[i]) ?? null;
    const traitData = copies.filter(Boolean);

    markOrigin(raceData);
    for (const data of traitData) markOrigin(data);
    return { raceData, traitData, missing };
  }

  /** The items an apply replaces: any race, and whatever creation wrote before. */
  #originReplacedIds(actor = this.actor) {
    return actor.items.contents
      .filter((i) => i.type === "race" || i.getFlag("redsteel", "creationOrigin"))
      .map((i) => i.id);
  }

  /**
   * The footer strip: the character as the draft would make it, read off a
   * temporary, unsaved clone of the actor carrying the drafted attributes,
   * race and traits (the same documents the apply writes), so every number
   * comes from the system's own formulas. Null (no strip) before a race is
   * chosen, or on any failure (warned once).
   */
  async #preview(state) {
    if (!state.doc || !this.actor) return null;
    try {
      const { raceData, traitData } = await this.#buildOriginItems(state);
      const replaced = new Set(this.#originReplacedIds());
      // Fresh ids: the clone's item collection is keyed by id.
      const added = [raceData, ...traitData].map((data) => ({ ...data, _id: foundry.utils.randomID() }));
      const items = [
        ...this.actor.items.contents.filter((i) => !replaced.has(i.id)).map((i) => i.toObject()),
        ...added,
      ];
      const data = foundry.utils.expandObject(originAttributeUpdate(this.#draft));
      data.items = items;
      const clone = this.actor.clone(data, { save: false });
      const system = clone?.system;
      if (!system) return null;

      const i18n = game.i18n;
      const number = (value) => {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
      };
      const entries = [
        ["health", "REDSTEEL.Actor.Character.stats.health.value.label", system.stats?.health?.max],
        ["stamina", "REDSTEEL.Actor.Character.stats.stamina.value.label", system.stats?.stamina?.max],
        ...(this.#hasMagicPotential()
          ? [["mana", "REDSTEEL.Actor.Character.stats.mana.value.label", system.stats?.mana?.max]]
          : []),
        ["mind", "REDSTEEL.Actor.Character.stats.mind.value.label", system.stats?.mind?.max],
        ["spd", CONFIG.REDSTEEL.secondaryAttributes.spd, system.secondaryAttributes?.spd?.total],
        ["ini", CONFIG.REDSTEEL.secondaryAttributes.ini, system.secondaryAttributes?.ini?.total],
        ["res", CONFIG.REDSTEEL.secondaryAttributes.res, system.secondaryAttributes?.res?.total],
        ["lck", CONFIG.REDSTEEL.secondaryAttributes.lck, system.secondaryAttributes?.lck?.total],
      ];
      return entries.map(([key, labelKey, value]) => ({
        key,
        label: i18n.localize(labelKey),
        value: number(value),
        tooltip: i18n.localize(`REDSTEEL.Creation.Preview.${key}`),
      }));
    } catch (err) {
      if (!this.#previewWarned) {
        this.#previewWarned = true;
        console.warn("Redsteel | Creation: the character preview could not be built", err);
      }
      return null;
    }
  }

  /**
   * Validate the draft, then write the origin to the actor and open step 3.
   * Safe to run again after Back: it replaces exactly what the previous run
   * wrote (the creationOrigin items, the trait SP payout, the doctrines it
   * made visible), and leaves ranks and features bought in step 3 alone.
   */
  async #applyOrigin() {
    const i18n = game.i18n;
    const warn = (key, data) =>
      ui.notifications.warn(data ? i18n.format(key, data) : i18n.localize(key));
    const actor = this.actor;
    // School and magical doctrine squared with Magic potential first.
    this.#settleMagic();
    const draft = this.#draft;
    const state = this.#compute();

    const problem = this.#originProblem(state);
    if (problem) return warn(problem.key, problem.data);
    // A magical doctrine still drafted without Magic potential.
    const magical = draft.doctrines.filter((key) => getLearnSection(`doctrines.${key}`) === "magical");
    if (magical.length && !this.#hasMagicPotential()) {
      return warn("REDSTEEL.Creation.Doctrine.needsMagic");
    }
    // Every weapon question answered, and the school's magical doctrine.
    if (this.#detailsIncomplete()) return warn("REDSTEEL.Creation.Warn.detailsIncomplete");

    if (state.remaining > 0) {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        classes: ["rs-create-confirm"],
        window: { title: i18n.localize("REDSTEEL.Creation.Confirm.unspentTitle") },
        content: `<p>${escapeHtml(
          i18n.format("REDSTEEL.Creation.Confirm.unspentContent", { n: state.remaining }),
        )}</p>`,
        rejectClose: false,
      });
      if (confirmed !== true) return;
    }

    // Build every document before anything is written, so a missing trait
    // aborts with the character untouched. The footer preview builds the
    // same documents with the same helper (#buildOriginItems).
    const { raceData, traitData, missing } = await this.#buildOriginItems(state, draft);
    if (missing) {
      return warn("REDSTEEL.Creation.Warn.traitMissing", {
        name: this.#traits?.get(missing)?.label ?? TRAIT_PRICES[missing]?.name ?? missing,
      });
    }

    // 1. The old race, and whatever a previous apply wrote, go in one call.
    const oldIds = this.#originReplacedIds(actor);
    if (oldIds.length) await actor.deleteEmbeddedDocuments("Item", oldIds);

    // 2–3. The race and the traits land together.
    await actor.createEmbeddedDocuments("Item", [raceData, ...traitData]);

    // 4. Attributes, the SP payout for unspent trait points, and the draft
    // moved on to step 3. The payout replaces the previous apply's, so it
    // never stacks.
    const leftover = Math.max(0, state.traitRemaining);
    const traitSp = leftover * SP_PER_TRAIT_POINT;
    const currentBonusSp = Number(actor.system?.progression?.bonus?.sp) || 0;
    const previous = draft.applied;
    const identity = this.#identity();
    // A pick a previous apply bought rank I in and that is no longer chosen
    // gives that rank back (and the teacher with it), so it reads as unranked
    // below. Only when rank I is all it holds: a rank bought on top in step 3
    // keeps the track. Doctrines first, as they may ask for a skill's rank.
    const wanted = new Set(draftTrackIds(draft));
    const stale = (previous?.autoRanks ?? [])
      .filter((id) => !wanted.has(id) && PROGRESSION_TRACKS[id])
      .sort((a, b) => Number(b.startsWith("doctrines.")) - Number(a.startsWith("doctrines.")));
    for (const id of stale) {
      const track = PROGRESSION_TRACKS[id];
      if (getTrackRank(actor, track.group, track.key) !== 1) continue;
      if (await refundRank(actor, id)) await releaseCreationTeacher(actor, id);
    }
    // Doctrines a previous apply showed that are no longer drafted go hidden
    // again, unless a rank was bought in them since.
    const unranked = (group, key) => (Number(actor.system?.[group]?.[key]?.value) || 0) === 0;
    const dropped = (previous?.doctrines ?? []).filter(
      (key) => !draft.doctrines.includes(key) && unranked("doctrines", key),
    );
    // The school and Channeling (with a magical doctrine), the weapon skills
    // the doctrines train with and the combat skills they fight with: shown
    // and tracked, rank I bought in step 6. Whatever a previous apply showed
    // that is no longer chosen goes the same way as a doctrine.
    const schools = draft.school ? [draft.school] : [];
    const weapons = [
      ...new Set(weaponDoctrines(draft.doctrines).map((key) => weaponFor(draft, key)).filter(Boolean)),
    ];
    const channeling = draft.doctrines.some((key) => isMagicalDoctrine(key));
    const droppedSchools = (previous?.schools ?? []).filter(
      (key) => !schools.includes(key) && unranked("schools", key),
    );
    const droppedWeapons = (previous?.weapons ?? []).filter(
      (key) => !weapons.includes(key) && unranked("weaponSkills", key),
    );
    const dropChanneling = !!previous?.channeling && !channeling && unranked("combatSkills", "channeling");
    // The combat skills the doctrines fight with (Combat, Archery).
    const combatSkills = draftCombatSkills(draft);
    const droppedCombatSkills = (previous?.combatSkills ?? []).filter(
      (key) => !combatSkills.includes(key) && unranked("combatSkills", key),
    );
    const nextDraft = foundry.utils.deepClone(draft);
    nextDraft.step = STEP_COUNT;
    nextDraft.applied = { traitSp, doctrines: [...draft.doctrines], schools, weapons, combatSkills, channeling };
    const update = {
      ...getLedgerMaterializeUpdate(actor),
      name: identity.name,
      "prototypeToken.name": identity.name,
      "system.progression.bonus.sp": currentBonusSp - (previous?.traitSp ?? 0) + traitSp,
      "flags.redsteel.creationDraft": nextDraft,
      ...this.#weaponDeletions(nextDraft),
      ...originAttributeUpdate(draft),
    };
    // The chosen doctrines join the character's skills: shown on the sheet
    // (rank I is bought in step 6, once the wallet below is written).
    for (const key of draft.doctrines) {
      update[`system.doctrines.${key}.visible`] = true;
    }
    for (const key of dropped) {
      update[`system.doctrines.${key}.visible`] = false;
    }
    for (const key of schools) update[`system.schools.${key}.visible`] = true;
    for (const key of droppedSchools) update[`system.schools.${key}.visible`] = false;
    for (const key of weapons) update[`system.weaponSkills.${key}.visible`] = true;
    for (const key of droppedWeapons) update[`system.weaponSkills.${key}.visible`] = false;
    for (const key of combatSkills) update[`system.combatSkills.${key}.visible`] = true;
    for (const key of droppedCombatSkills) update[`system.combatSkills.${key}.visible`] = false;
    if (channeling) update["system.combatSkills.channeling.visible"] = true;
    else if (dropChanneling) update["system.combatSkills.channeling.visible"] = false;
    await actor.update(update);
    this.#draft = nextDraft;

    // 5. ...and tracked in the Learn window, beside whatever combat tracks the
    // character already follows (setTrackedIds replaces the Combat tab's list).
    // Anything dropped leaves the list.
    const addedIds = draftTrackIds(draft);
    const droppedIds = new Set([
      ...dropped.map((key) => `doctrines.${key}`),
      ...droppedSchools.map((key) => `schools.${key}`),
      ...(dropChanneling ? ["combatSkills.channeling"] : []),
      ...droppedWeapons.map((key) => `weaponSkills.${key}`),
      ...droppedCombatSkills.map((key) => `combatSkills.${key}`),
    ]);
    if (addedIds.length || droppedIds.size) {
      const combat = getTrackedIds(actor).filter(
        (id) => getTrackTab(id) === "combat" && !droppedIds.has(id),
      );
      await setTrackedIds(actor, "combat", [...combat, ...addedIds]);
    }

    // 6. Rank I in every pick, with its teacher (acquireCreationRank). The
    // ones bought here are recorded, so a later apply that drops the pick
    // gives that rank back. A rank the points cannot cover is left to the
    // roster in step 3, and said so.
    const { bought, failed } = await acquireCreationRanks(actor, addedIds);
    const autoRanks = [...new Set([...(previous?.autoRanks ?? []).filter((id) => wanted.has(id)), ...bought])];
    await actor.update({ "flags.redsteel.creationDraft.applied.autoRanks": autoRanks });
    nextDraft.applied.autoRanks = autoRanks;
    if (failed.length) {
      ui.notifications.warn(
        i18n.format("REDSTEEL.Creation.Skills.startingRankFailed", {
          // Each pick with what stood in the way (its Teacher was unlocked).
          names: failed
            .map((id) => {
              const track = PROGRESSION_TRACKS[id];
              const name = i18n.localize(`REDSTEEL.Actor.Character.${track.group}.${track.key}.label`);
              const reasons = explainUnbuyable(actor, id, 1, { teacherGiven: true });
              return reasons.length ? `${name} (${reasons.join("; ")})` : name;
            })
            .join(", "),
        }),
      );
    }

    // 7. On to step 3: the Learn window, on the Combat tab.
    await this.close();
    openLearnWindow(actor, { tab: "combat" });
  }
}

/* -------------------------------------------- */
/*  Entry point                                 */
/* -------------------------------------------- */

/**
 * Open (or focus) the Character Creation window for one actor.
 * @param {Actor} actor
 */
export function openCharacterCreation(actor) {
  if (!actor) return null;
  // Step 3 is the Learn window in creation mode.
  if (isCreationSkillsStep(actor)) return openLearnWindow(actor, { tab: "combat" });
  const existing = foundry.applications.instances.get(`redsteel-creation-${actor.id}`);
  if (existing) {
    existing.bringToFront();
    return existing;
  }
  return new CharacterCreationWindow({ actor }).render(true);
}

/* -------------------------------------------- */
/*  Step 3: the Learn window's creation mode    */
/* -------------------------------------------- */

/**
 * True while the character is in creation and on step 3, the Learn window.
 * The Learn window reads this on every render to show its creation banner.
 * @param {Actor} actor
 */
export function isCreationSkillsStep(actor) {
  return isInCreation(actor) && Number(actor.getFlag("redsteel", "creationDraft")?.step) === 3;
}

/**
 * The track ids whose rank I teacher creation unlocked (step 2's picks and
 * step 3's acquire button), so giving rank I back takes the teacher back too.
 * Kept beside the draft, not in it: readDraft keeps only the draft's own keys.
 */
const CREATION_TEACHERS_FLAG = "creationTeachers";

function creationTeachers(actor) {
  const list = actor?.getFlag("redsteel", CREATION_TEACHERS_FLAG);
  return Array.isArray(list) ? list.filter((id) => typeof id === "string") : [];
}

/**
 * Buy rank I of a track during creation (user ruling 2026-10-10: a skill
 * taken at creation comes with its first trainer): unlock the rank I teacher
 * if missing, then buy through the engine's own purchaseRank. A rank the
 * engine still refuses (other requirements, the wallet) takes the teacher
 * back. True when the track holds rank I afterwards.
 * @param {Actor} actor
 * @param {string} trackId
 */
export async function acquireCreationRank(actor, trackId) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track || !actor?.isOwner) return false;
  if (getTrackRank(actor, track.group, track.key) >= 1) return true;
  const granted = !hasTeacher(actor, trackId, 1);
  if (granted) await setTeacher(actor, trackId, 1, true);
  const bought = await purchaseRank(actor, trackId, 1);
  if (!bought) {
    if (granted) await setTeacher(actor, trackId, 1, false);
    return false;
  }
  if (granted) {
    await actor.setFlag("redsteel", CREATION_TEACHERS_FLAG, [...new Set([...creationTeachers(actor), trackId])]);
  }
  return true;
}

/**
 * After ranks were given back in creation: a track left with no rank loses
 * the rank I teacher creation unlocked for it. No-op for a track that still
 * holds a rank or whose teacher came from elsewhere.
 * @param {Actor} actor
 * @param {string} trackId
 */
export async function releaseCreationTeacher(actor, trackId) {
  const track = PROGRESSION_TRACKS[trackId];
  if (!track || !actor?.isOwner) return;
  if (getTrackRank(actor, track.group, track.key) >= 1) return;
  const list = creationTeachers(actor);
  if (!list.includes(trackId)) return;
  await setTeacher(actor, trackId, 1, false);
  await actor.setFlag("redsteel", CREATION_TEACHERS_FLAG, list.filter((id) => id !== trackId));
}

/**
 * Buy rank I in each track, in passes, so a rank whose requirement is another
 * track's rank I (a doctrine on its weapon skill) lands once that one has.
 * @returns {Promise<{bought: string[], failed: string[]}>}
 */
async function acquireCreationRanks(actor, trackIds) {
  let pending = [...new Set(trackIds)].filter((id) => PROGRESSION_TRACKS[id]);
  const bought = [];
  let progress = true;
  while (pending.length && progress) {
    progress = false;
    const next = [];
    for (const id of pending) {
      const track = PROGRESSION_TRACKS[id];
      const had = getTrackRank(actor, track.group, track.key) >= 1;
      if (await acquireCreationRank(actor, id)) {
        if (!had) bought.push(id);
        progress = true;
      } else {
        next.push(id);
      }
    }
    pending = next;
  }
  return { bought, failed: pending };
}

/**
 * Back from step 3: the draft returns to step 2 (its 2.5 half when that has
 * questions) and the creation window opens on it. Nothing step 3 bought is
 * undone.
 * @param {Actor} actor
 */
export async function returnToOrigin(actor) {
  if (!actor?.isOwner) return;
  const draft = readDraft(actor);
  await actor.update({
    "flags.redsteel.creationDraft.step": WINDOW_STEPS,
    // Back lands on 2.5 when it has something to ask, else on the cards.
    "flags.redsteel.creationDraft.stage": draftHasDetails(draft) ? "details" : "doctrines",
  });
  openCharacterCreation(actor);
}

/** Pools Finish fills to their maximum. */
const FINISH_REFILLED_POOLS = ["health", "stamina", "mana", "mind"];

/**
 * Finish from step 3: the character leaves creation. Refused while more points
 * are spent than the character has; unspent points are fine (book rule).
 * Notifications only, never a dialog: the Learn window is a full screen and a
 * dialog would open underneath it.
 * @param {Actor} actor
 * @returns {Promise<boolean>} true when the character was finished.
 */
export async function finishCharacterCreation(actor) {
  if (!actor?.isOwner || !isInCreation(actor)) return false;
  const { remaining } = getWallet(actor);
  if (remaining.cp < 0 || remaining.sp < 0) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Creation.Warn.overspent"));
    return false;
  }
  // The character steps out rested (user ruling 2026-10-06): every pool full
  // at the maximum its race, attributes and traits now give it. The starting
  // CP/SP the ledger read from the GM's default is written down in the same
  // update, since it reads as the legacy figure once creationPending is gone.
  const pools = {};
  for (const key of FINISH_REFILLED_POOLS) {
    const max = Number(actor.system?.stats?.[key]?.max);
    if (Number.isFinite(max)) pools[`system.stats.${key}.value`] = Math.max(max, 0);
  }
  await actor.update({
    ...getLedgerMaterializeUpdate(actor),
    ...pools,
    "flags.redsteel.-=creationDraft": null,
    "flags.redsteel.-=creationPending": null,
  });
  ui.notifications.info(game.i18n.format("REDSTEEL.Creation.Learn.finished", { name: actor.name }));
  return true;
}
