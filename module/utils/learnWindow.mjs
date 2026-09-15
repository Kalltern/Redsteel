/**
 * Learn window — the level-up screen.
 *
 * A Pathfinder-style grid: rank columns I–X across the top, one full-width
 * block per purchasable track stacked down the page, shown as a full screen
 * rather than a window. Each rank's diamond is its only control: clicking the
 * diamond of an affordable, unlocked rank buys it, and clicking the diamond of
 * the top owned rank refunds it.
 *
 * A block is laid out in one of two modes, chosen by the track's group:
 *
 *   matrix   (combat skills, schools, ordinary skills) — a node track of
 *            diamonds, an optional icon row, one row per stat the track
 *            touches, then a requirements row and a cost row, with the stat
 *            named once in the left
 *            gutter instead of repeated in every rank. These tracks move the
 *            same handful of numbers at nearly every rank, so a row reads as a
 *            progression.
 *
 *   segments (weapon skills, doctrines) — a node track, one content row whose
 *            per-rank segments carry the icons and chips of that rank, then a
 *            requirements row and a cost row. No stat rows: these tracks touch a stat once or twice in
 *            ten ranks, so a full row per stat would be almost entirely blank.
 *
 * This file is presentation only. Every rule — what a rank costs, whether it is
 * buyable, what the wallet holds, what a purchase writes — lives in
 * `helpers/progressionEngine.mjs`. Nothing here decides anything; if a cell
 * reads wrong, the answer is in the engine or in the price table, not here.
 *
 * Two tabs carry a grid: Combat (combat skills, doctrines, weapon trees and
 * schools) and Skills (the ordinary skills). Which tracks appear on each is the
 * player's own choice, made in the picker — see the engine's `isTracked`.
 * Features and Specialisations are declared in the strip and render a
 * placeholder line, so the shape of the finished window is visible while those
 * two are still unpriced.
 */

import { PROGRESSION_TRACKS, SKILL_COST_CLASSES } from "../helpers/progression.mjs";
import { RANK_EFFECTS } from "../helpers/progressionEffects.mjs";
import {
  evaluateRequirements,
  getRankGrants,
  getRankState,
  getUnmetPrerequisites,
  hasTeacher,
  getLearnSection,
  getTrackRank,
  getBestRankInGroup,
  getTrackTab,
  LEARN_SECTION_ORDER,
  getWallet,
  isTracked,
  purchaseRank,
  refundRank,
  setTeacher,
  setTrackedIds,
  FEATURE_PACK_ID,
  getFeatureState,
  getFeatureUuid,
  getOwnedFeatures,
  isRaceGrantedFeature,
  purchaseFeature,
  refundFeature,
  loadFeaturePackData,
  getFeatureCatalogIds,
  getFeaturePrice,
  getFeaturePriceForItem,
  isNativeLanguageFeature,
  LANGUAGE_SLOTS,
  LANGUAGE_FEATURE_IDS,
  getKnownLanguages,
  getLanguageFeatureState,
  purchaseLanguageFeature,
  grantNativeLanguage,
  getDiscountChoiceOptions,
  getDiscountSourceLabel,
  getDiscountSources,
  getForcedSchool,
  getMirrorSources,
  getRankCost,
  setDiscountChoice,
  setMirrorChoice,
  countBoughtSpecNodes,
  countUnlockedSpecNodes,
  getSpecPrice,
  getSpecState,
  getSpecWallet,
  isSpecActive,
  purchaseSpec,
  refundSpec,
  setSpecTeacher,
  getSpecNodeDependents,
  getSpecNodeState,
  purchaseSpecNode,
  refundSpecNode,
} from "../helpers/progressionEngine.mjs";
import { SPEC_GROUPS, SPEC_PRICES } from "../helpers/specPrices.mjs";
import {
  isAutoUnlockNode,
  prepareSpecialisationTree,
} from "../helpers/specialisations.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } =
  foundry.applications.api;

const TEMPLATE = "systems/redsteel/templates/actor/learn-window.hbs";

/* SPEC ICON EDITOR — TEMPORARY (user request 2026-09-11).
 * The GM picks each specialisation's card icon in game. The choices live in a
 * hidden world setting and override SPEC_ICONS (specialisations.mjs). When the
 * icons are final, press "Copy icons" on the Specialisations tab, paste the
 * block over SPEC_ICONS, and delete everything marked SPEC ICON EDITOR: this
 * setting and lookup, the editSpecIcon/copySpecIcons actions and handlers, the
 * card's pencil and the bar button in learn-window.hbs, their CSS, and the
 * REDSTEEL.Learn.Specs.IconEdit lang keys. */
const SPEC_ICON_SETTING = "specIconOverrides";

Hooks.once("init", () => {
  game.settings.register("redsteel", SPEC_ICON_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
});

/** SPEC ICON EDITOR: the GM's chosen icons, specId → image path. */
function specIconOverrides() {
  try {
    return game.settings.get("redsteel", SPEC_ICON_SETTING) ?? {};
  } catch (err) {
    return {};
  }
}

/**
 * The system's own tooltip root (#rs-tooltip-root in redsteel.css). The screen
 * has to stay under it, and under Foundry's core tooltip too, so every
 * requirement and effect it explains can still be read over the screen.
 */
const SYSTEM_TOOLTIP_LAYER = 10000;

/**
 * A refund click this soon after buying a rank on the same track is taken as the
 * second half of a double-click, not as a refund. Refund is a single click, so
 * without this a double-click on a diamond would buy the rank and hand it
 * straight back.
 */
const DOUBLE_CLICK_MS = 400;

/** Ranks are always written I–X, never as digits, everywhere in this window. */
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

const roman = (n) => ROMAN[Number(n)] ?? String(n ?? "");

/** The ten column headers. */
const RANK_HEADERS = ROMAN.slice(1);

/** Attribute sections borrow the sheet's own attribute names. */
const ATTRIBUTE_SECTIONS = new Set([
  "str",
  "dex",
  "end",
  "int",
  "cha",
  "per",
  "wil",
]);

/**
 * The groups whose blocks print their numbers inside the rank segments instead
 * of in stat rows. A weapon skill or a doctrine touches a given stat once or
 * twice in ten ranks, so a full-width row per stat would be nine tenths blank.
 */
const SEGMENT_GROUPS = new Set(["weaponSkills", "doctrines"]);

/**
 * The tabs whose blocks are switched on and off from a ribbon: Skills, whose
 * forty tracks sit under eight attributes, and Combat, whose combat skills,
 * weapon skills, doctrines and schools make as long a scroll (user ruling).
 * A reader rarely wants every block at once. Every block starts switched on.
 */
const RIBBON_TABS = new Set(["combat", "skills"]);

/**
 * Where a trait's kind comes from. The pack files creation traits into
 * Positive, Neutral and Negative folders, and every trait in those folders
 * carries its folder as `flags.redsteel.traitPolarity`. An owned copy made
 * before that flag existed is matched by its (unique, English) name against
 * the pack index instead.
 */
const TRAIT_PACK_ID = "redsteel.redsteel-items";
const TRAIT_POLARITY_FLAG = "traitPolarity";

/**
 * The hero header's trait rows, in display order. Starsign traits sit in their
 * own pack folder with no polarity of their own, and are shown as neutral.
 */
const TRAIT_GROUPS = ["positive", "neutral", "negative"];

/** The groups an `anyRank` requirement can name, and the label each one uses. */
/* The book writes a "any track of this group" gate as a bare singular:
   "Doktrína III", "Škola IV", "Zbraň III". The chip copies that wording; the
   sentence explaining it lives in the tooltip. */
const GROUP_LABELS = {
  doctrines: "REDSTEEL.Learn.Group.doctrine",
  schools: "REDSTEEL.Learn.Group.school",
  weaponSkills: "REDSTEEL.Learn.Group.weapon",
  skills: "REDSTEEL.Learn.Group.skill",
};

/* The same three groups in running-text form, for the explaining tooltip. */
const GROUP_LABELS_LOWER = {
  doctrines: "REDSTEEL.Learn.Group.doctrineLower",
  schools: "REDSTEEL.Learn.Group.schoolLower",
  weaponSkills: "REDSTEEL.Learn.Group.weaponLower",
  skills: "REDSTEEL.Learn.Group.skillLower",
};

/**
 * Localized names of compendium features, keyed by their English name. Filled
 * from the pack index when the Features tab first builds (see
 * LearnWindow#loadFeatureIndex); until then a requirement names the feature in
 * English, as it always did.
 */
const FEATURE_LABELS = new Map();

/** A feature's player-facing name. */
function featureLabel(name) {
  return FEATURE_LABELS.get(name) ?? name;
}

/** "lck" → "REDSTEEL.Actor.Character.SecondaryAttribute.Lck.long" */
function secondaryAttributeLabel(key) {
  const cap = `${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}`;
  return game.i18n.localize(
    `REDSTEEL.Actor.Character.SecondaryAttribute.${cap}.long`,
  );
}

/** A specialisation's name, falling back to its key. */
function specialisationLabel(spec) {
  const key = `REDSTEEL.Actor.Specialisations.${spec}.label`;
  return game.i18n.has(key, false) ? game.i18n.localize(key) : spec;
}

/** A specialisation node's name, or null when it has none. */
function specNodeLabel(spec, node) {
  const key = `REDSTEEL.Actor.Specialisations.${spec}.nodes.${node}.label`;
  return node && game.i18n.has(key, false) ? game.i18n.localize(key) : null;
}

/**
 * A race requirement's name: the family (Elf, Dwarf) when the book names one,
 * otherwise the races themselves, each through its race item's lang key.
 */
function raceRequirementLabel(req) {
  if (req.family) {
    return game.i18n.localize(`REDSTEEL.Learn.Req.Family.${req.family}`);
  }
  return (req.races ?? [])
    .map((name) => {
      const key = `REDSTEEL.Items.${String(name).replace(/\s+/g, "")}.name`;
      return game.i18n.has(key, false) ? game.i18n.localize(key) : name;
    })
    .join(" / ");
}

/** Feature-name prefixes a requirement can name, and their lang keys. */
const FEATURE_PREFIX_LABELS = {
  "Talented I:": "REDSTEEL.Learn.Req.Prefix.talented1",
};

/** "Talented I:" → "Talented I", in the active language. */
function featurePrefixLabel(prefix) {
  const key = FEATURE_PREFIX_LABELS[prefix];
  return key ? game.i18n.localize(key) : String(prefix).replace(/:\s*$/, "");
}

/** The Features tab's blocks, in the book's order. */
const FEATURE_SECTIONS = ["combat", "general", "magic", "trait", "racial"];

/**
 * The per-skill feature families that collapse into one row in the Features
 * tab, each opening a skill picker (user ruling 2026-09-11). Talented I and II
 * stay two rows, because each tier lands on a different skill.
 */
const FEATURE_FAMILIES = new Set([
  "specialization",
  "talented1",
  "talented2",
  "adept",
  "expert",
  "master",
  "elvenTalent",
  "elvenPerfection",
]);

/** A priced feature's family, or null when it stands on its own. */
function featureFamilyOf(price) {
  const family = price.family ?? price.group ?? null;
  return FEATURE_FAMILIES.has(family) && price.skill ? family : null;
}

/**
 * Whether a priced feature builds on a track the character already trains:
 * its family skill is held at rank I or more, or one of its rank clauses
 * (nested ones included) names a track, or a group, they hold a rank in. The
 * "Have skill" filter: Drinking I suggests Drinker, which asks for Drinking III.
 */
function buildsOnHeldTrack(actor, price) {
  if (price.skill && getTrackRank(actor, "skills", price.skill) > 0) return true;
  const walk = (requires) =>
    (requires ?? []).some((req) => {
      switch (req.t) {
        case "rank":
          return getTrackRank(actor, req.group, req.key) > 0;
        case "anyRank":
        case "countRank":
          return getBestRankInGroup(actor, req.group) > 0;
        case "anyOf":
        case "allOf":
          return walk(req.options);
        default:
          return false;
      }
    });
  return walk(price.requires);
}

/** The skill picker's columns, in order. */
const SKILL_CLASS_ORDER = ["A", "B", "C"];

/** Lower-cased and accent-free, so "zasah" finds "Přesný zásah". */
function normalizeSearch(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** "str" → "REDSTEEL.Actor.Character.Attribute.Str.long" */
function attributeLabel(key) {
  const cap = `${String(key).charAt(0).toUpperCase()}${String(key).slice(1)}`;
  return game.i18n.localize(`REDSTEEL.Actor.Character.Attribute.${cap}.long`);
}

/**
 * Capability flags are code keys, and a requirement that reads "Requires:
 * magicPotential" is a leak, not a sentence. Each flag names the thing that
 * grants it, which the system already localizes.
 */
const FLAG_LABELS = {
  magicPotential: "REDSTEEL.Items.MagicPotential.name",
  ironMuscles: "REDSTEEL.Items.IronMuscles.name",
};

/** A capability flag's player-facing name, falling back to the bare key. */
function flagLabel(key) {
  const lang = FLAG_LABELS[key];
  return lang && game.i18n.has(lang, false) ? game.i18n.localize(lang) : key;
}

/** The sheet's own name for a track id ("doctrines.swordsman"). */
function trackLabel(group, key) {
  return game.i18n.localize(`REDSTEEL.Actor.Character.${group}.${key}.label`);
}

/** The heading for one block of the grid. */
function sectionLabel(section) {
  if (ATTRIBUTE_SECTIONS.has(section)) return attributeLabel(section);
  return game.i18n.localize(`REDSTEEL.Learn.Sections.${section}`);
}

/**
 * One requirement as a line of player-facing text.
 *
 * Anything the price table could not model arrives as `raw` and is printed
 * verbatim: it is book text, and a half-parsed version of it would be worse
 * than the sentence the GM can read.
 */
function describeRequirement(req) {
  switch (req?.t) {
    case "teacher":
      return game.i18n.format("REDSTEEL.Learn.Req.teacher", {
        tier: roman(req.tier),
      });
    case "attr":
      return game.i18n.format("REDSTEEL.Learn.Req.attr", {
        attr: attributeLabel(req.key),
        min: req.min,
      });
    case "rank":
      return game.i18n.format("REDSTEEL.Learn.Req.rank", {
        track: trackLabel(req.group, req.key),
        min: roman(req.min),
      });
    case "anyRank":
      return game.i18n.format("REDSTEEL.Learn.Req.anyRank", {
        group: game.i18n.localize(GROUP_LABELS[req.group] ?? req.group),
        min: roman(req.min),
      });
    case "feature":
      return game.i18n.format("REDSTEEL.Learn.Req.feature", {
        name: featureLabel(req.name),
      });
    case "flag":
      return game.i18n.format("REDSTEEL.Learn.Req.flag", {
        name: flagLabel(req.key),
      });
    case "specNode": {
      // The node itself ("School of Blood - Expert"): the specialisation alone
      // would not say which star is missing.
      const node = specNodeLabel(req.spec, req.node);
      if (node) return node;
      const key = `REDSTEEL.Actor.Specialisations.${req.spec}.label`;
      const spec = game.i18n.has(key, false)
        ? game.i18n.localize(key)
        : req.spec;
      return game.i18n.format("REDSTEEL.Learn.Req.specNode", { spec });
    }
    case "anyOf":
      return (req.options ?? [])
        .map((o) => describeRequirement(o))
        .filter(Boolean)
        .join(game.i18n.localize("REDSTEEL.Learn.Req.or"));
    // The clause kinds below come from the feature price table.
    case "race":
      return game.i18n.format("REDSTEEL.Learn.Req.race", {
        race: raceRequirementLabel(req),
      });
    case "attrCompare":
      return game.i18n.format("REDSTEEL.Learn.Req.attrCompare", {
        greater: attributeLabel(req.greater),
        lesser: attributeLabel(req.lesser),
      });
    case "secAttr":
      return game.i18n.format("REDSTEEL.Learn.Req.attr", {
        attr: secondaryAttributeLabel(req.key),
        min: req.min,
      });
    case "notFlag":
      return game.i18n.format("REDSTEEL.Learn.Req.notFlag", {
        name: flagLabel(req.key),
      });
    case "spec":
      return game.i18n.format("REDSTEEL.Learn.Req.specNode", {
        spec: specialisationLabel(req.spec),
      });
    case "countRank":
      return game.i18n.format("REDSTEEL.Learn.Req.countRank", {
        count: req.count,
        group: game.i18n.localize(GROUP_LABELS[req.group] ?? req.group),
        min: roman(req.min),
      });
    case "featurePrefix":
      return game.i18n.format("REDSTEEL.Learn.Req.featurePrefix", {
        name: featurePrefixLabel(req.prefix),
      });
    case "featureTeacher":
      return game.i18n.format("REDSTEEL.Learn.Req.teacher", {
        tier: roman(req.tier),
      });
    case "allOf":
      return (req.options ?? [])
        .map((o) => describeRequirement(o))
        .filter(Boolean)
        .join(` ${game.i18n.localize("REDSTEEL.Learn.and")} `);
    // The clause kinds below come from the specialisation price table.
    case "specTeacher":
      return game.i18n.format("REDSTEEL.Learn.Req.teacher", {
        tier: roman(req.tier),
      });
    case "noRank":
      return game.i18n.format("REDSTEEL.Learn.Req.noRank", {
        tracks: (req.keys ?? [])
          .map((key) => trackLabel(req.group, key))
          .join(game.i18n.localize("REDSTEEL.Learn.Req.or")),
      });
    // The clause kinds below come from the node price table (specNodePrices.mjs).
    case "masterFeature":
      return game.i18n.format("REDSTEEL.Learn.Req.masterFeature", {
        skill: trackLabel("skills", req.skill),
      });
    case "specScore":
      return game.i18n.format("REDSTEEL.Learn.Req.specScore", {
        spec: specialisationLabel(req.spec),
        min: req.min,
      });
    case "gm": {
      // A requirements note typed on the feature item reads as written.
      if (req.text) return String(req.text);
      const key = `REDSTEEL.Learn.Req.gm.${req.note}`;
      return game.i18n.has(key, false)
        ? game.i18n.localize(key)
        : game.i18n.localize("REDSTEEL.Learn.Req.gmGeneric");
    }
    case "raw":
      return String(req.text ?? "");
    default:
      return "";
  }
}

/**
 * One rank's requirements as the chips the Requirements row prints.
 *
 * A teacher clause gets a badge of its own — a cap and its numeral — because
 * "somebody teaches you this" is a fact about the table, not something the
 * sheet can work out, and it is the one requirement the GM hands over by
 * clicking. Every other clause is the same sentence the column tooltip uses.
 *
 * A clause the character already satisfies is dimmed and one still blocking
 * stays bright, so a locked column shows at a glance what is missing.
 * Advisory clauses (the GM ones, and book text the price table could not
 * model) never block, so they are dimmed whatever they say.
 */
function requirementChips(trackId, rank, results) {
  const isGM = game.user.isGM;
  const out = [];

  for (const result of results ?? []) {
    const req = result?.req;
    if (!req) continue;

    if (req.t === "teacher") {
      const tier = Number(req.tier) || 0;
      const unlocked = !!result.met;
      // The badge's own colour already says whether the teacher has been found,
      // so a sentence repeating it is noise. What the reader needs is what the
      // requirement means — plus, for a GM, that the badge is a control.
      const why = game.i18n.format("REDSTEEL.Learn.Req.Tip.teacher", {
        tier: roman(tier),
      });
      const hint = isGM
        ? game.i18n.localize(
            unlocked
              ? "REDSTEEL.Learn.Teacher.revoke"
              : "REDSTEEL.Learn.Teacher.grant",
          )
        : "";
      out.push({
        teacher: true,
        trackId,
        rank,
        tier,
        roman: roman(tier),
        cls: `${unlocked ? "is-unlocked" : "is-locked"}${isGM ? " is-gm" : ""}`,
        tooltip: [why, hint].filter(Boolean).join(" "),
      });
      continue;
    }

    // A requirements note typed on the feature item: advisory like every GM
    // clause, and its own text is both the chip and its tooltip.
    if (req.t === "gm" && req.text) {
      const note = String(req.text);
      out.push({ teacher: false, text: note, tooltip: note, cls: "is-advisory" });
      continue;
    }

    const text = describeRequirement(req);
    if (!text) continue;
    out.push({
      teacher: false,
      text,
      tooltip: explainRequirement(req),
      cls: result.advisory ? "is-advisory" : result.met ? "is-met" : "is-unmet",
    });
  }

  return out;
}

/**
 * A specialisation's requirements as chips: the same chips a rank prints,
 * except that the teacher badge belongs to the specialisation, which is
 * unlocked once rather than rank by rank. Only the GM's badge is a control.
 */
function specRequirementChips(specId, results) {
  const isGM = game.user.isGM;
  const out = [];
  for (const result of results ?? []) {
    const req = result?.req;
    if (!req) continue;
    if (req.t === "specTeacher") {
      const unlocked = !!result.met;
      const why = game.i18n.format("REDSTEEL.Learn.Req.Tip.teacher", {
        tier: roman(req.tier),
      });
      const hint = isGM
        ? game.i18n.localize(
            unlocked ? "REDSTEEL.Learn.Teacher.revoke" : "REDSTEEL.Learn.Teacher.grant",
          )
        : "";
      out.push({
        teacher: true,
        specId,
        roman: roman(req.tier),
        cls: `${unlocked ? "is-unlocked" : "is-locked"}${isGM ? " is-gm" : ""}`,
        tooltip: [why, hint].filter(Boolean).join(" "),
      });
      continue;
    }
    const text = describeRequirement(req);
    if (!text) continue;
    out.push({
      teacher: false,
      text,
      tooltip: explainRequirement(req),
      cls: result.advisory ? "is-advisory" : result.met ? "is-met" : "is-unmet",
    });
  }
  return out;
}

/**
 * A price in CP and SP: "15 CP", "5 SP", or "5 CP + 15 SP" (the Priest's
 * blessings, or a feature priced in both). A price of 0 reads "Free".
 */
function pointsCostLabel({ cp = 0, sp = 0 }) {
  if (!cp && !sp) return game.i18n.localize("REDSTEEL.Learn.Specs.Node.free");
  const cpLabel = game.i18n.format("REDSTEEL.Learn.Specs.Node.cp", { n: cp });
  const spLabel = game.i18n.format("REDSTEEL.Learn.Specs.Node.sp", { n: sp });
  if (cp && sp) {
    return game.i18n.format("REDSTEEL.Learn.Specs.Node.both", { cp: cpLabel, sp: spLabel });
  }
  return cp ? cpLabel : spLabel;
}

/**
 * One label for several prices, for a feature family row: "20–30 SP" when
 * every price is in the same single currency, otherwise the cheapest price's
 * own label.
 */
function rangeCostLabel(prices) {
  const list = (prices ?? []).filter(Boolean);
  if (!list.length) return "";
  const currencyOf = (price) => {
    const cp = Number(price.cp) || 0;
    const sp = Number(price.sp) || 0;
    if (cp > 0 && !sp) return "cp";
    if (sp > 0 && !cp) return "sp";
    return null;
  };
  const currencies = new Set(list.map(currencyOf));
  if (currencies.size === 1 && !currencies.has(null)) {
    const [currency] = currencies;
    const amounts = list.map((price) => Number(price[currency]) || 0);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    if (min === max) return pointsCostLabel({ [currency]: min });
    return game.i18n.format(`REDSTEEL.Learn.Specs.Node.${currency}`, { n: `${min}–${max}` });
  }
  const total = (price) => (Number(price.cp) || 0) + (Number(price.sp) || 0);
  return pointsCostLabel(list.reduce((best, price) => (total(price) < total(best) ? price : best)));
}

/** Text a player typed, made safe to sit inside tooltip HTML. */
function escapeText(text) {
  return String(text ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

/**
 * "2 Specialisation points". The name is written out in full (user ruling),
 * since SP already means Skill Points. Czech counts in three forms (1, 2 to 4,
 * 0 and 5 up), so the lang files carry one, few and many.
 */
function specPointsLabel(n) {
  const count = Number(n) || 0;
  const form = count === 1 ? "one" : count >= 2 && count <= 4 ? "few" : "many";
  return game.i18n.format(`REDSTEEL.Learn.Specs.Points.${form}`, { n: count });
}

/**
 * The sentence behind a chip.
 *
 * The chip itself is deliberately terse ("Doctrine II") because it has to fit a
 * column; this is what the reader gets on hover, spelled out in full.
 */
function explainRequirement(req) {
  switch (req?.t) {
    case "teacher":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.teacher", {
        tier: roman(req.tier),
      });
    case "attr":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.attr", {
        attr: attributeLabel(req.key),
        min: req.min,
      });
    case "rank":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.rank", {
        track: trackLabel(req.group, req.key),
        min: roman(req.min),
      });
    case "anyRank":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.anyRank", {
        group: game.i18n.localize(GROUP_LABELS_LOWER[req.group] ?? req.group),
        min: roman(req.min),
      });
    case "feature":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.feature", {
        name: featureLabel(req.name),
      });
    case "flag":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.flag", {
        name: flagLabel(req.key),
      });
    case "specNode": {
      const key = `REDSTEEL.Actor.Specialisations.${req.spec}.label`;
      const spec = game.i18n.has(key, false)
        ? game.i18n.localize(key)
        : req.spec;
      const node = specNodeLabel(req.spec, req.node);
      if (node) return game.i18n.format("REDSTEEL.Learn.Req.Tip.specNodeNamed", { node, spec });
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.specNode", { spec });
    }
    case "race":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.race", {
        race: raceRequirementLabel(req),
      });
    case "attrCompare":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.attrCompare", {
        greater: attributeLabel(req.greater),
        lesser: attributeLabel(req.lesser),
      });
    case "secAttr":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.attr", {
        attr: secondaryAttributeLabel(req.key),
        min: req.min,
      });
    case "notFlag":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.notFlag", {
        name: flagLabel(req.key),
      });
    case "spec":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.specNode", {
        spec: specialisationLabel(req.spec),
      });
    case "countRank":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.countRank", {
        count: req.count,
        group: game.i18n.localize(GROUP_LABELS_LOWER[req.group] ?? req.group),
        min: roman(req.min),
      });
    case "featurePrefix":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.featurePrefix", {
        name: featurePrefixLabel(req.prefix),
      });
    case "featureTeacher":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.featureTeacher", {
        tier: roman(req.tier),
      });
    case "specTeacher":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.teacher", {
        tier: roman(req.tier),
      });
    case "noRank":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.noRank", {
        tracks: (req.keys ?? [])
          .map((key) => trackLabel(req.group, key))
          .join(game.i18n.localize("REDSTEEL.Learn.Req.or")),
      });
    case "masterFeature":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.masterFeature", {
        skill: trackLabel("skills", req.skill),
      });
    case "specScore":
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.specScore", {
        spec: specialisationLabel(req.spec),
        min: req.min,
      });
    case "allOf":
      return (req.options ?? [])
        .map((o) => explainRequirement(o))
        .filter(Boolean)
        .join(` ${game.i18n.localize("REDSTEEL.Learn.and")} `);
    case "anyOf":
      return (req.options ?? [])
        .map((o) => explainRequirement(o))
        .filter(Boolean)
        .join(game.i18n.localize("REDSTEEL.Learn.Req.or"));
    default:
      // "gm" and "raw" already read as sentences; the chip text IS the sentence.
      return describeRequirement(req);
  }
}

/* -------------------------------------------- */
/*  Rank effects                                */
/* -------------------------------------------- */


/** "+2" / "-2" — a delta always shows its sign. */
const signed = (value) => (Number(value) < 0 ? String(value) : `+${value}`);

/**
 * "A", "A and B", "A, B and C".
 *
 * Used everywhere several stats share one number: a merged matrix row's gutter
 * label, and a segment chip that stands for more than one stat. The conjunction
 * is a lang key because Czech puts a bare "a" where English wants "and".
 */
function joinLabels(labels) {
  const list = (labels ?? []).filter((l) => l !== "" && l != null);
  if (list.length <= 1) return list[0] ?? "";
  const and = game.i18n.localize("REDSTEEL.Learn.and");
  return `${list.slice(0, -1).join(", ")} ${and} ${list[list.length - 1]}`;
}

/** Which "REDSTEEL.Learn.Effect.*" pattern writes one entry as a sentence. */
function effectKey(entry) {
  if (entry?.t === "pct") return "REDSTEEL.Learn.Effect.pct";
  if (entry?.t === "mod") {
    return entry.pct
      ? "REDSTEEL.Learn.Effect.modPct"
      : "REDSTEEL.Learn.Effect.mod";
  }
  return "REDSTEEL.Learn.Effect.val";
}

/**
 * One entry as the bare number that belongs in a matrix cell.
 *
 * The stat it applies to is named once, by the row, so the cell carries only
 * the figure: "15%", "+2", "12".
 */
function formatValue(entry) {
  switch (entry?.t) {
    case "pct":
      return `${entry.value}%`;
    case "mod":
      return entry.pct ? `${signed(entry.value)}%` : signed(entry.value);
    case "val":
      return String(entry.value);
    default:
      return "";
  }
}

/**
 * What one rank does, as full sentences for the column's tooltip.
 *
 * The grid itself says this in the matrix — a row per stat, a number per rank.
 * The tooltip repeats it in words because the matrix cannot show book prose,
 * and because "15%" on its own is only readable next to its row label.
 */
function describeEffects(trackId, rank) {
  const entries = RANK_EFFECTS[trackId]?.[rank - 1] ?? [];
  const out = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.t === "text") {
      out.push({ text: game.i18n.localize(entry.key), prose: true });
      continue;
    }
    out.push({
      text: game.i18n.format(effectKey(entry), {
        label: game.i18n.localize(entry.label),
        value: entry.value,
      }),
    });
  }
  return out;
}

/**
 * One rank's effects as the chips a segment-mode column prints.
 *
 * A segment carries no row label, so every chip is a full sentence: "Hit +10%",
 * "Bleed +25%", or a line of book prose verbatim. Entries of the same kind
 * carrying the same number are merged into one chip — the book routinely raises
 * two or three stats by the same step at once, and three chips reading "+1"
 * stacked under each other are three times the height for no extra information.
 */
/**
 * Book lines whose wording differs from the ability item they describe, so no
 * name comparison can link them. Each pairing is the one abilityGrants.mjs
 * records in its ABILITY map comments, keyed here by effect key so it holds in
 * either language:
 *   straz                  "Stráž"                  OVERWATCH
 *   magickeObrneni         "Magické obrnění"        MAGIC_WARD
 *   vicenasobnyVrh         "Vícenásobný vrh"        FLURRY_OF_THROWS
 *   obrannyPostoj          "Obranný postoj"         SHIELDBEARER_DEFENSIVE_STANCE
 *   utokNaSlabinu          "Útok na slabinu"        EXPLOIT_WEAKNESS (ranged tracks grant its ranged variant)
 *   bonusProtiVelkymTvorum "Bonus proti velkým tvorům" ANTI_LARGE
 *   ztecPrubojnost5        "Zteč: Průbojnost +5"    PIKEMAN_CHARGE
 * A new ability whose book line is worded unlike its item belongs here too.
 */
const ABILITY_NAME_LINES = new Set([
  "REDSTEEL.Learn.Effect.straz",
  "REDSTEEL.Learn.Effect.magickeObrneni",
  "REDSTEEL.Learn.Effect.vicenasobnyVrh",
  "REDSTEEL.Learn.Effect.obrannyPostoj",
  "REDSTEEL.Learn.Effect.utokNaSlabinu",
  "REDSTEEL.Learn.Effect.bonusProtiVelkymTvorum",
  "REDSTEEL.Learn.Effect.ztecPrubojnost5",
]);

/**
 * Mark the chips that name an ability the rank grants, so they can be set in
 * bold apart from bonuses and rules. Only in a rank that grants something.
 *
 * A line names an ability when its text, or the part before a rider's colon
 * ("Reckless Strike: Bleed +50%"), equals a granted item's localized or
 * document name, compared with any trailing variant in brackets dropped
 * ("Feint (Dexterity)" is still Feint). Lines the book words differently from
 * their item are listed in ABILITY_NAME_LINES.
 */
function markAbilityChips(chips, grants) {
  const key = (text) => String(text ?? "").trim().toLocaleLowerCase();
  const stripVariant = (text) => String(text ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  const names = new Set();
  for (const grant of grants ?? []) {
    for (const name of [grant?.localizedName, grant?.name]) {
      if (!name) continue;
      names.add(key(name));
      names.add(key(stripVariant(name)));
    }
  }
  const grantsSomething = names.size > 0;
  return chips.map((chip) => {
    if (!chip.prose || !grantsSomething) return { ...chip, ability: false };
    const text = String(chip.text ?? "");
    const colon = text.indexOf(":");
    const candidates = colon > 0 ? [text, text.slice(0, colon)] : [text];
    const ability =
      ABILITY_NAME_LINES.has(chip.key) ||
      candidates.some((candidate) => names.has(key(candidate)));
    return { ...chip, ability };
  });
}

function describeRankChips(trackId, rank) {
  const entries = RANK_EFFECTS[trackId]?.[rank - 1] ?? [];
  const out = [];
  const byShape = new Map();

  for (const entry of entries) {
    if (!entry) continue;
    if (entry.t === "text") {
      out.push({ text: game.i18n.localize(entry.key), key: entry.key, prose: true });
      continue;
    }
    // Kind, percent flag and value together: "Hit +10%" and "Hit +10" are not
    // the same statement and must never collapse into one chip.
    const shape = `${entry.t}|${entry.pct ? 1 : 0}|${entry.value}`;
    const found = byShape.get(shape);
    if (found) {
      found.labels.push(game.i18n.localize(entry.label));
      continue;
    }
    const chip = { entry, labels: [game.i18n.localize(entry.label)] };
    byShape.set(shape, chip);
    out.push(chip);
  }

  return out.map((chip) =>
    chip.prose
      ? chip
      : {
          text: game.i18n.format(effectKey(chip.entry), {
            label: joinLabels(chip.labels),
            value: chip.entry.value,
          }),
          prose: false,
        },
  );
}

/**
 * The stat rows of one track's matrix.
 *
 * Ranks are walked I→X and every distinct stat label is collected in the order
 * the book first mentions it — that ordering is the rulebook's own and is never
 * sorted. Each row then holds ten cells, empty at the ranks that leave that
 * stat alone. Book prose carries no label and so can never become a row.
 *
 * Rows that turn out to hold the SAME ten cells are then merged into one row
 * naming every stat in it. combatSkills.combat moves Hit and Melee Defense in
 * lockstep at all ten ranks, and printing that twice says nothing the first row
 * did not. A merged row keeps the position of the first row of its group, so
 * the book's own ordering survives the merge.
 *
 * Only the matrix layout calls this; segment-mode tracks (weapon skills and
 * doctrines) print their numbers inside the rank columns instead.
 */
function buildStatRows(trackId, trackLabelText) {
  const ranks = RANK_EFFECTS[trackId] ?? [];
  const rows = [];
  const byLabel = new Map();

  for (let rank = 1; rank <= 10; rank++) {
    for (const entry of ranks[rank - 1] ?? []) {
      if (!entry || entry.t === "text" || !entry.label) continue;
      let row = byLabel.get(entry.label);
      if (!row) {
        row = {
          labels: [game.i18n.localize(entry.label)],
          // A row of percentages is a rating; a row of flat bonuses is not, and
          // must not be labelled as one.
          rating: true,
          // A rating or a plain value is printed as the figure reached by that
          // rank; a bonus is printed as what that one rank adds. The gutter
          // total reads the two differently (see statRowTotal).
          additive: true,
          cells: Array.from({ length: 10 }, (_, i) => ({
            rank: i + 1,
            col: i + 2,
            text: "",
            entry: null,
          })),
        };
        byLabel.set(entry.label, row);
        rows.push(row);
      }
      if (entry.t !== "pct") row.rating = false;
      if (entry.t !== "mod") row.additive = false;
      row.cells[rank - 1].text = formatValue(entry);
      row.cells[rank - 1].entry = entry;
    }
  }

  // The merge key is the ten formatted cells in order, blanks included: two
  // stats that agree wherever they both appear but differ in WHERE they are
  // blank are not the same row and stay apart.
  const merged = [];
  const byShape = new Map();
  for (const row of rows) {
    const shape = row.cells.map((c) => c.text).join("\u0000");
    const first = byShape.get(shape);
    if (first) {
      first.labels.push(...row.labels);
      continue;
    }
    byShape.set(shape, row);
    merged.push(row);
  }
  for (const row of merged) row.label = joinLabels(row.labels);

  // The book names a skill's own rating row after the skill, which on the sheet
  // just prints the track's name twice. When that row is the only rating the
  // track has, it is simply "Skill rating"; when there are several, each says
  // which rating it is ("Acrobacy rating", "Dodge rating").
  const ratings = merged.filter((row) => row.rating);
  for (const row of ratings) {
    row.label =
      ratings.length === 1 && row.label === trackLabelText
        ? game.i18n.localize("REDSTEEL.Learn.skillRating")
        : game.i18n.format("REDSTEEL.Learn.ratingOf", { label: row.label });
  }
  return merged;
}

/**
 * "Price in CP" / "Price in SP" for one track's cost row.
 *
 * No track mixes currencies, so the word is picked once from the first rank
 * that names one and printed in the gutter, leaving the cells the bare number.
 */
function priceLabel(cells) {
  const currency = cells.find((c) => c.currency)?.currency ?? "";
  if (currency === "cp") return game.i18n.localize("REDSTEEL.Learn.priceCp");
  if (currency === "sp") return game.i18n.localize("REDSTEEL.Learn.priceSp");
  return "";
}

/**
 * What the character holds on one stat row at their current rank, for the
 * row's gutter. A rating or a plain value is already the running figure, so
 * the total is the last one at or below the rank held; a bonus is per rank, so
 * the total is their sum. Empty when no held rank touches the row.
 */
function statRowTotal(row, held) {
  const reached = row.cells.filter((cell) => cell.entry && cell.rank <= held);
  if (!reached.length) return "";
  const last = reached[reached.length - 1].entry;
  if (!row.additive) return formatValue(last);
  const sum = reached.reduce((n, cell) => n + Number(cell.entry.value ?? 0), 0);
  return formatValue({ ...last, value: sum });
}

/**
 * What the character has paid for one track so far, for its price gutter: every
 * held rank at the price this character pays, discount included, so the tracks
 * add up to the wallet's spent. Null at rank 0.
 */
function paidTotal(cells, held) {
  if (!held) return null;
  const currency = cells.find((c) => c.currency)?.currency ?? "";
  let sum = 0;
  for (const cell of cells) {
    if (cell.rank <= held && Number.isFinite(cell.cost)) sum += cell.cost;
  }
  return {
    text: game.i18n.format("REDSTEEL.Learn.paid", { n: sum }),
    tooltip: game.i18n.format("REDSTEEL.Learn.paidTooltip", {
      n: sum,
      currency: currency.toUpperCase(),
    }),
  };
}

/**
 * The "(Discounted)" note on a skill's price label, or null when no rank of the
 * track is discounted. A skill carries one discount at most, so the first
 * discounted rank names it for the whole track (user ruling: once per skill,
 * not a tooltip on every price). A feature source shows its own card; a perk
 * shows its specialisation and name as the title and its text as the body.
 */
function discountNote(cells) {
  const source = cells.find((cell) => cell.discountSource)?.discountSource;
  if (!source) return null;
  if (source.kind === "feature" && source.item?.uuid) return { uuid: source.item.uuid };
  // Rank I of the first school of magic, named by the temperament that chose it.
  if (source.kind === "freeSchool") {
    return {
      uuid: null,
      title: game.i18n.localize("REDSTEEL.Learn.FreeSchool.title"),
      text: source.trait
        ? game.i18n.format("REDSTEEL.Learn.FreeSchool.temperament", {
            trait: source.trait.localizedName ?? source.trait.name,
            school: trackLabel("schools", source.school),
          })
        : game.i18n.localize("REDSTEEL.Learn.FreeSchool.first"),
    };
  }
  const title = `${specialisationLabel(source.spec)}: ${getDiscountSourceLabel(source)}`;
  const key = `REDSTEEL.Actor.Specialisations.${source.spec}.nodes.${source.node}.description`;
  return {
    uuid: null,
    title,
    text: game.i18n.has(key, false) ? game.i18n.localize(key) : title,
  };
}

/** Which of the two block layouts a track uses. Decided by group, never by id. */
function getTrackMode(trackId) {
  const group = PROGRESSION_TRACKS[trackId]?.group;
  return SEGMENT_GROUPS.has(group) ? "segments" : "matrix";
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

export class LearnWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "redsteel-learn-{id}",
    classes: ["redsteel", "rs-learn"],
    window: {
      title: "REDSTEEL.Learn.title",
      // A full screen, not a window: no frame, and no JavaScript positioning,
      // so CSS owns the geometry outright (see .rs-learn in redsteel.css).
      frame: false,
      positioned: false,
    },
    actions: {
      switchTab: LearnWindow._onSwitchTab,
      toggleSection: LearnWindow._onToggleSection,
      buyFeature: LearnWindow._onBuyFeature,
      refundFeature: LearnWindow._onRefundFeature,
      toggleFeatureFilters: LearnWindow._onToggleFeatureFilters,
      resetFeatureFilters: LearnWindow._onResetFeatureFilters,
      toggleFeatureDescription: LearnWindow._onToggleFeatureDescription,
      openFeatureFamily: LearnWindow._onOpenFeatureFamily,
      closeFeatureFamily: LearnWindow._onCloseFeatureFamily,
      buyLanguage: LearnWindow._onBuyLanguage,
      grantNativeLanguage: LearnWindow._onGrantNativeLanguage,
      openSpec: LearnWindow._onOpenSpec,
      openHeroSpec: LearnWindow._onOpenHeroSpec,
      closeSpec: LearnWindow._onCloseSpec,
      openSpecPicker: LearnWindow._onOpenSpecPicker,
      closeSpecPicker: LearnWindow._onCloseSpecPicker,
      buySpec: LearnWindow._onBuySpec,
      refundSpec: LearnWindow._onRefundSpec,
      buySpecNode: LearnWindow._onBuySpecNode,
      refundSpecNode: LearnWindow._onRefundSpecNode,
      toggleSpecTeacher: LearnWindow._onToggleSpecTeacher,
      toggleSpecWip: LearnWindow._onToggleSpecWip,
      toggleSpecView: LearnWindow._onToggleSpecView,
      // SPEC ICON EDITOR (temporary)
      editSpecIcon: LearnWindow._onEditSpecIcon,
      copySpecIcons: LearnWindow._onCopySpecIcons,
      buyRank: LearnWindow._onBuyRank,
      toggleTeacher: LearnWindow._onToggleTeacher,
      refundRank: LearnWindow._onRefundRank,
      openPicker: LearnWindow._onOpenPicker,
      savePicker: LearnWindow._onSavePicker,
      cancelPicker: LearnWindow._onCancelPicker,
      closeScreen: LearnWindow._onCloseScreen,
    },
  };

  static PARTS = {
    body: {
      template: TEMPLATE,
      // Buying a rank re-renders the whole part, which would otherwise throw
      // the reader back to the top of a long list of tracks. Naming the
      // scroller here has ApplicationV2 carry its position across the render.
      scrollable: [
        ".rs-learn-grid",
        ".rs-learn-picker",
        ".rs-learn-features-owned",
        ".rs-learn-features-list",
        ".rs-learn-family-columns",
        ".rs-learn-language-panel",
        ".rs-learn-spec-group.is-combat",
        ".rs-learn-spec-group.is-support",
        ".rs-learn-spec-view-body",
        ".rs-learn-spec-gallery",
      ],
    },
  };

  constructor(options = {}) {
    super(options);
    this.actor = options.actor ?? null;
  }

  /**
   * One window per actor. `{id}` in DEFAULT_OPTIONS.id is substituted with
   * `uniqueId` by ApplicationV2, so this must be set before super() runs the
   * substitution — hence the assignment on the incoming options.
   */
  _initializeApplicationOptions(options) {
    options.uniqueId = options.actor?.id ?? "none";
    return super._initializeApplicationOptions(options);
  }

  /** Which tab is showing. Transient — never written to the actor. */
  #tab = "combat";

  /**
   * The blocks switched off on each ribbon tab: tab → Set of section ids. A
   * section missing from its set is on, so a fresh window shows everything.
   * Also transient.
   */
  #hiddenSections = new Map();

  /** True while the track picker replaces the grid. Also transient. */
  #picking = false;

  /** Resolved ability documents, keyed by UUID. Survives re-renders. */
  #grantCache = new Map();

  /** Pack trait name → polarity, read once from the pack index. */
  #traitPolarity = null;

  /** Compendium feature English name → {label, img}, read once per window. */
  #featureIndex = null;

  /** The Features tab's filters. Transient, like the tab itself. */
  #featureOnlyMet = false;
  #featureQuery = "";
  /** The book sections the Features tab shows: all five by default. */
  #featureSections = new Set(FEATURE_SECTIONS);
  #featureAllRaces = false;
  /**
   * Off by default: magic features stay hidden for a character with neither
   * Magic Potential nor the School of Blood (user ruling), as other races'
   * features are.
   */
  #featureAllMagic = false;
  /** On: only features that build on a track the character holds a rank in. */
  #featureHaveSkill = false;

  /** True while the Features tab's filter pop-up is open. Transient. */
  #featureFiltersOpen = false;

  /** Bound pointerdown listener that closes the filter pop-up on an outside click. */
  #boundPopupDismiss = null;

  /**
   * The feature family whose skill picker is open, "languages" while the
   * Languages panel is open, or null. Transient.
   */
  #featureFamily = null;

  /** The name typed in the Languages panel, kept across re-renders. Transient. */
  #languageDraft = "";

  /** True while a language purchase is on its way, so a double click buys once. */
  #languageBusy = false;

  /**
   * Keys of the traits and features whose description is rolled out, so a
   * purchase's re-render leaves them open. Transient.
   */
  #expandedFeatures = new Set();

  /** The specialisation whose star sign is open in place of the lists, or null. */
  #specOpen = null;

  /**
   * Whether the Specialisations tab shows the picker (every specialisation the
   * character does not own yet, opened from the Learn Specialisation card)
   * instead of the owned cards. Transient. Closing a star sign leaves it alone,
   * so a star sign opened from the picker goes back to the picker.
   */
  #specPicking = false;

  /**
   * Whether the specialisations whose star sign is not drawn yet show. Off by
   * default (user ruling); a work-in-progress one the character owns always
   * shows. Transient.
   */
  #specShowWip = false;

  /** GM only: the plain list instead of the cards, for checking the table. */
  #specListView = false;

  /** [hook name, id] for the item hooks, so feature changes repaint the screen. */
  #itemHookIds = [];

  /** The updateActor hook id, so it can be released on close. */
  #hookId = null;

  /** Bound change listener for the wallet fields. */
  #boundChange = null;

  /** The last purchase made here, so a double-click cannot refund it. */
  #lastPurchase = null;

  /** The last node bought ("spec.node") and when, for the same double-click guard. */
  #lastNodePurchase = null;

  /* ---------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;

    const isContentTab = this.#tab === "combat" || this.#tab === "skills";
    const showGrid = isContentTab && !this.#picking;
    const ribbon = showGrid ? this.#buildRibbon() : [];
    const shown = ribbon.length
      ? new Set(ribbon.filter((entry) => entry.active).map((entry) => entry.id))
      : null;
    const sections = showGrid ? await this.#buildSections(shown) : [];
    const isFeaturesTab = this.#tab === "features";
    const features = isFeaturesTab ? await this.#buildFeatures() : null;
    const isSpecsTab = this.#tab === "specialisations";
    const specs = isSpecsTab ? this.#buildSpecs() : null;
    const picker = this.#picking ? this.#buildPicker() : [];

    return Object.assign(context, {
      actorId: actor?.id ?? "",
      editable: !!actor?.isOwner,
      isGM: game.user.isGM,
      tab: this.#tab,
      isContentTab,
      isFeaturesTab,
      features,
      isSpecsTab,
      specs,
      // Specialisation points: what is left shows on the Specialisations tab's
      // bar (user ruling), and the GM's ledger edits the total.
      specWallet: getSpecWallet(actor),
      // The picker button stands in the middle of the toggle row (user
      // ruling), and only while the grid it feeds is showing; while the picker
      // is open, Done and Cancel take its place.
      showAcquire: showGrid && !!actor?.isOwner,
      // The toggle row shows whenever it has something to hold: toggles, the
      // picker button, or the picker's own controls. So a character with no
      // track picked yet still reaches Add skills.
      showBar:
        isContentTab && (ribbon.length > 0 || this.#picking || !!actor?.isOwner),
      picking: this.#picking,
      picker,
      hero: await this.#buildHero(),
      wallet: getWallet(actor),
      adjust: {
        cp: Number(actor?.system?.progression?.adjust?.cp ?? 0),
        sp: Number(actor?.system?.progression?.adjust?.sp ?? 0),
      },
      rankHeaders: RANK_HEADERS,
      ribbon,
      sections,
    });
  }

  /**
   * The hero header: the character this screen levels up.
   *
   * The attribute tiles use the sheet's own abbreviations
   * (CONFIG.REDSTEEL.attributeAbbreviations) and show the same `total` the
   * sheet header does, falling back to `value` for an actor without one. The
   * race is found the way the sheet finds it, as the actor's race item.
   *
   * Under the name, the doctrines the character trains stand in for the level
   * (user ruling: they say more about who the character is). Every doctrine
   * with a rank bought, most advanced first, without the numbers.
   */
  async #buildHero() {
    const actor = this.actor;
    const img = actor?.img ?? "";
    const race = actor?.items?.find((item) => item.type === "race");
    const abbr = CONFIG.REDSTEEL?.attributeAbbreviations ?? {};
    const attributes = Object.entries(actor?.system?.attributes ?? {}).map(
      ([key, attr]) => ({
        key,
        label: abbr[key] ? game.i18n.localize(abbr[key]) : key.toUpperCase(),
        value: Number(attr?.total ?? attr?.value ?? 0),
      }),
    );

    // Array.prototype.sort is stable, so doctrines of equal rank keep the
    // order template.json declares them in.
    const doctrines = Object.entries(actor?.system?.doctrines ?? {})
      .map(([key, entry]) => ({ key, rank: Number(entry?.value ?? 0) }))
      .filter((entry) => entry.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .map((entry) => trackLabel("doctrines", entry.key));

    // The owned specialisations as small tokens under the attributes (user
    // request 2026-09-15), in the order of the Specialisations tab's cards:
    // Combat before Support, alphabetical within each. A click opens the star
    // sign; the one open right now is marked.
    const known = CONFIG.REDSTEEL?.specialisations ?? {};
    // SPEC ICON EDITOR: the GM's pick wins over SPEC_ICONS while it exists.
    const iconOverrides = specIconOverrides();
    const openSpec = this.#tab === "specialisations" ? this.#specOpen : null;
    const specs = SPEC_GROUPS.flatMap((group) =>
      Object.keys(SPEC_PRICES)
        .filter(
          (specId) =>
            SPEC_PRICES[specId].group === group &&
            known[specId] &&
            isSpecActive(actor, specId),
        )
        .map((specId) => ({
          id: specId,
          label: specialisationLabel(specId),
          img: iconOverrides[specId] || known[specId].img || "icons/svg/mystery-man.svg",
          open: specId === openSpec,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
    );

    return {
      name: actor?.name ?? "",
      img,
      // Handed to the stylesheet as a variable, so the band can lay a faded
      // copy of the portrait behind itself without a rule per character.
      portraitStyle: img ? `--rs-learn-portrait: url("${img}")` : "",
      race: race ? (race.localizedName ?? race.name) : "",
      doctrines: doctrines.join(" / "),
      attributes,
      specs,
    };
  }

  /**
   * Pack trait name → polarity, from the trait pack's index. Read once per
   * window: the index only changes when the pack is rebuilt, which needs a
   * reload anyway. A missing pack or a failed read leaves the map empty, so
   * the header still renders, with every unflagged trait unsorted.
   */
  async #loadTraitPolarity() {
    if (this.#traitPolarity) return this.#traitPolarity;
    const map = new Map();
    const pack = game.packs.get(TRAIT_PACK_ID);
    if (pack) {
      try {
        const index = await pack.getIndex({
          fields: [`flags.redsteel.${TRAIT_POLARITY_FLAG}`],
        });
        // .contents, not for...of: iterating a Collection directly yields
        // [key, value] pairs.
        for (const entry of index.contents) {
          const polarity = entry.flags?.redsteel?.[TRAIT_POLARITY_FLAG];
          if (polarity) map.set(entry.name, polarity);
        }
      } catch (err) {
        console.warn(`Redsteel | Learn: could not index ${TRAIT_PACK_ID}`, err);
      }
    }
    this.#traitPolarity = map;
    return map;
  }

  /**
   * The traits the character carries, for the top of the Features tab's owned
   * panel: three columns, positive, neutral, negative (user ruling), each trait
   * with its name and description. See TRAIT_PACK_ID for where the grouping
   * comes from; a trait the pack cannot classify lands in an unsorted group
   * below the columns rather than in a wrong one.
   */
  async #buildTraits() {
    const actor = this.actor;
    const polarityByName = await this.#loadTraitPolarity();
    const groups = new Map(TRAIT_GROUPS.map((polarity) => [polarity, []]));
    const unsorted = [];
    const owned = (actor?.items?.contents ?? [])
      .filter((item) => item.type === "feature" && item.system?.option === "trait")
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    for (const item of owned) {
      const polarity =
        item.getFlag?.("redsteel", TRAIT_POLARITY_FLAG) ??
        polarityByName.get(item.name) ??
        (item.system?.starsign ? "neutral" : null);
      const expandKey = `trait-${item.id}`;
      const entry = {
        uuid: item.uuid,
        name: item.localizedName ?? item.name,
        img: item.img,
        description: item.localizedDescription ?? "",
        expandKey,
        expanded: this.#expandedFeatures.has(expandKey),
      };
      if (groups.has(polarity)) groups.get(polarity).push(entry);
      else unsorted.push(entry);
    }
    return {
      any: owned.length > 0,
      // All three columns always show, so a kind the character has none of
      // still reads as an empty column rather than a missing one.
      columns: TRAIT_GROUPS.map((polarity) => ({
        polarity,
        label: game.i18n.localize(`REDSTEEL.Learn.Features.Polarity.${polarity}`),
        items: groups.get(polarity),
      })),
      unsorted: unsorted.length
        ? {
            label: game.i18n.localize("REDSTEEL.Learn.Features.Polarity.unsorted"),
            items: unsorted,
          }
        : null,
    };
  }

  /**
   * The discount picks: every discount that lands on a skill (or a doctrine)
   * of the player's choosing, with its picker. A fixed-skill discount needs no
   * pick and is only noted on its skill's price label. A skill another source
   * already discounts is offered but disabled, since discounts on one skill do
   * not stack. The Features tab lists them all, named by the feature, or by the
   * specialisation for a perk. An open star sign passes its `spec` and lists
   * only that specialisation's perks, named by the node, since the
   * specialisation is already the page (user ruling 2026-09-15: Lindar's
   * doctrine is picked on Veneficus).
   */
  #buildDiscounts({ spec = null } = {}) {
    const actor = this.actor;
    const sources = getDiscountSources(actor);
    return sources
      .filter((source) => source.choices && (!spec || source.spec === spec))
      .map((source) => ({
        id: source.id,
        label:
          source.kind !== "spec" || spec
            ? getDiscountSourceLabel(source)
            : specialisationLabel(source.spec),
        amount: source.amount,
        currency: source.currency.toUpperCase(),
        skill: source.skill,
        chooseLabel: game.i18n.localize(
          source.group === "doctrines"
            ? "REDSTEEL.Learn.Discounts.chooseDoctrine"
            : "REDSTEEL.Learn.Discounts.choose",
        ),
        options: getDiscountChoiceOptions(actor, source.id, sources)
          .map((option) => ({
            key: option.key,
            label: trackLabel(source.group, option.key),
            taken: option.taken,
            selected: option.key === source.skill,
          }))
          .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
      }));
  }

  /**
   * The mirror picks of one specialisation: every unlocked perk that makes a
   * track of the player's choosing copy the rank of another (the Hoplite's
   * Swords, Axes or Blunt following Polearms), with its picker. Listed under
   * the star sign, named by the node.
   */
  #buildMirrorPicks(spec) {
    return getMirrorSources(this.actor, spec).map((source) => ({
      id: source.id,
      label: specNodeLabel(source.spec, source.node) ?? source.node,
      badge: game.i18n.format("REDSTEEL.Learn.Mirror.badge", {
        skill: trackLabel(source.group, source.from),
      }),
      skill: source.skill,
      chooseLabel: game.i18n.localize("REDSTEEL.Learn.Discounts.choose"),
      options: source.choices
        .map((key) => ({
          key,
          label: trackLabel(source.group, key),
          selected: key === source.skill,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang)),
    }));
  }

  /**
   * The Specialisations tab (user rulings 2026-09-11, 2026-09-14). The main
   * view is the character's owned cards (`ownedCards`) plus a Learn
   * Specialisation card; that card opens the picker (#specPicking): Combat
   * specialisations with their four-point cap and Support specialisations,
   * each with a buy diamond, requirement chips and a price, and with what the
   * character owns left out. Clicking one opens its star sign in place of the
   * view (#specOpen), where an owned specialisation's nodes are bought and
   * given back (#learnSpecTree).
   */
  #buildSpecs() {
    const wallet = getSpecWallet(this.actor);
    const known = CONFIG.REDSTEEL?.specialisations ?? {};
    const picking = this.#specPicking;
    let wipCount = 0;
    // Group order, alphabetical within a group. The work in progress filter
    // never hides a specialisation the character owns.
    const ownedCards = [];
    const groups = SPEC_GROUPS.map((group) => {
      const all = Object.keys(SPEC_PRICES)
        .filter((specId) => SPEC_PRICES[specId].group === group && known[specId])
        .map((specId) => this.#specRow(specId, wallet))
        .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
      ownedCards.push(...all.filter((row) => row.owned));
      // A specialisation whose star sign is not drawn yet is work in progress:
      // hidden unless switched on (user ruling), or unless the character has it.
      const wip = all.filter((row) => row.wip && !row.owned);
      wipCount += wip.length;
      let rows = this.#specShowWip ? all : all.filter((row) => !row.wip || row.owned);
      // The picker lists only what is left to learn (user ruling); the owned
      // cards live on the main view.
      if (picking) rows = rows.filter((row) => !row.owned);
      const cap = wallet.caps[group];
      const spent = wallet.byGroup[group] ?? 0;
      return {
        id: group,
        label: game.i18n.localize(`REDSTEEL.Learn.Specs.Groups.${group}`),
        capLabel:
          cap === undefined
            ? ""
            : game.i18n.format("REDSTEEL.Learn.Specs.capSpent", { spent, cap }),
        overCap: cap !== undefined && spent > cap,
        rows,
      };
    }).filter((group) => !picking || group.rows.length > 0);
    const open =
      this.#specOpen && known[this.#specOpen]
        ? {
            ...this.#specRow(this.#specOpen, wallet),
            tree: this.#learnSpecTree(this.#specOpen),
            // The picks of this specialisation's owned "one from a list"
            // perks, under its star sign (Lindar's doctrine, a Bard's skills).
            discountPicks: this.#buildDiscounts({ spec: this.#specOpen }),
            // The Hoplite's weapon skill that copies Polearms.
            mirrorPicks: this.#buildMirrorPicks(this.#specOpen),
          }
        : null;
    return {
      groups,
      open,
      picking,
      ownedCards,
      // The Learn Specialisation card leaves the main view once every point is
      // spent (user ruling 2026-09-14).
      canLearn: wallet.remaining > 0,
      nothingToLearn: picking && groups.length === 0,
      wipCount,
      showWip: this.#specShowWip,
      // Players always get the cards; the list is the GM's check on the table.
      listView: game.user.isGM && this.#specListView,
    };
  }

  /** One specialisation as a row of the lists, or as the head of its star sign. */
  #specRow(specId, wallet) {
    const actor = this.actor;
    const { state, price, requirements } = getSpecState(actor, specId);
    const results = requirements?.results ?? [];
    const reasons = [];
    if (state === "locked") {
      for (const result of results) {
        if (result.met || result.advisory) continue;
        const line = describeRequirement(result.req);
        if (line) reasons.push(line);
      }
    } else if (state === "capped") {
      reasons.push(
        game.i18n.format("REDSTEEL.Learn.Specs.capped", {
          cap: wallet.caps[price.group],
        }),
      );
    } else if (state === "poor") {
      reasons.push(game.i18n.localize("REDSTEEL.Learn.Specs.poor"));
    }
    const owned = state === "owned";
    const editable = !!actor?.isOwner;
    const unlocked = countUnlockedSpecNodes(actor, specId);
    // Nodes that come with the specialisation never block giving it back.
    const bought = countBoughtSpecNodes(actor, specId);
    const total = Object.keys(
      CONFIG.REDSTEEL?.specialisations?.[specId]?.nodes ?? {},
    ).length;
    const def = CONFIG.REDSTEEL?.specialisations?.[specId];
    const summaryKey = `REDSTEEL.Actor.Specialisations.${specId}.summary`;
    return {
      id: specId,
      label: specialisationLabel(specId),
      // The card: token art, and a short description once the star sign exists.
      // SPEC ICON EDITOR: the GM's pick wins over SPEC_ICONS while it exists.
      img: specIconOverrides()[specId] || def?.img || "icons/svg/mystery-man.svg",
      wip: def?.layout !== "constellation",
      summary: game.i18n.has(summaryKey, false) ? game.i18n.localize(summaryKey) : "",
      state,
      // The diamond has no "capped" look of its own: it reads as short of points.
      nodeState: state === "capped" ? "poor" : state,
      owned,
      costLabel: specPointsLabel(price?.cost ?? 0),
      canBuy: editable && state === "available",
      refundable: editable && owned && bought === 0,
      refundBlocked: owned && bought > 0,
      showLock: state === "locked" || state === "capped",
      reasons,
      reasonsTitle: game.i18n.localize(
        state === "locked"
          ? "REDSTEEL.Learn.unmetRequirements"
          : "REDSTEEL.Learn.Specs.cannotBuyTitle",
      ),
      reqChips: specRequirementChips(specId, results),
      nodeSummary: owned
        ? game.i18n.format("REDSTEEL.Learn.Specs.nodes", { unlocked, total })
        : "",
    };
  }

  /**
   * The open star sign, every node priced and, on an owned specialisation,
   * wired to be bought or given back (user ruling 2026-09-14). A node lights
   * as available only when it can be bought right now; anything else reads as
   * locked, and its tooltip lists what stands in the way: the linked nodes
   * still locked, the unmet book requirements, a discount clash or a short
   * wallet. Advisory clauses get their own list and never block.
   */
  #learnSpecTree(specId) {
    const actor = this.actor;
    const tree = prepareSpecialisationTree(actor, specId);
    if (!tree) return null;
    const editable = !!actor?.isOwner;
    const wallet = getWallet(actor);
    const nameOf = (nodeId) => specNodeLabel(specId, nodeId) ?? nodeId;
    for (const node of tree.nodes) {
      const { state, price, requirements, missing, conflict } = getSpecNodeState(
        actor,
        specId,
        node.id,
        wallet,
      );
      const owned = state === "owned";
      const reasons = [];
      const advisory = [];
      let reasonsTitle = game.i18n.localize("REDSTEEL.Learn.unmetRequirements");
      let action = "";
      if (owned) {
        const dependents = getSpecNodeDependents(actor, specId, node.id);
        if (dependents.length) {
          reasonsTitle = game.i18n.localize("REDSTEEL.Learn.Specs.Node.refundFirst");
          reasons.push(...dependents.map(nameOf));
        } else if (editable && !isAutoUnlockNode(specId, node.id)) {
          // A node that comes with the specialisation is given back with it.
          action = "refundSpecNode";
        }
      } else {
        for (const id of missing) {
          reasons.push(game.i18n.format("REDSTEEL.Learn.Specs.Node.needsNode", { node: nameOf(id) }));
        }
        for (const result of requirements?.results ?? []) {
          if (result.met) continue;
          const line = describeRequirement(result.req);
          if (line) (result.advisory ? advisory : reasons).push(line);
        }
        if (conflict) {
          reasons.push(
            game.i18n.format("REDSTEEL.Learn.Discounts.alreadyDiscounted", {
              skill: trackLabel("skills", conflict.skill),
              source: getDiscountSourceLabel(conflict.source),
            }),
          );
        }
        if (state === "poor") reasons.push(game.i18n.localize("REDSTEEL.Learn.Specs.Node.poor"));
        if (editable && state === "available") action = "buySpecNode";
      }
      node.state = owned ? "unlocked" : state === "available" ? "available" : "locked";
      node.action = action;
      node.costLabel = price ? pointsCostLabel(price) : "";
      node.tipReasons = reasons.join("\n");
      node.tipReasonsTitle = reasonsTitle;
      node.tipAdvisory = advisory.join("\n");
    }
    return tree;
  }

  /**
   * Localized names and artwork of every compendium feature, keyed by English
   * name, read once per window. Also fills FEATURE_LABELS, so a requirement
   * that names a feature reads in the active language everywhere.
   */
  async #loadFeatureIndex() {
    if (this.#featureIndex) return this.#featureIndex;
    const map = new Map();
    const pack = game.packs.get(FEATURE_PACK_ID);
    if (pack) {
      try {
        // One index read serves this map and the engine's pack prices (the
        // costs, sections and notes that price new purchases).
        const index = (await loadFeaturePackData()) ?? { contents: [] };
        // .contents, not for...of: iterating a Collection yields [key, value].
        for (const entry of index.contents) {
          if (entry.type !== "feature") continue;
          const key = entry.system?.localizationKey?.trim();
          const label =
            key && game.i18n.has(key, false) ? game.i18n.localize(key) : entry.name;
          // The description in the active language, the way an item's
          // localizedDescription reads it: the translation under the item's
          // key with .name swapped for .description, else the stored text.
          const descriptionKey = key?.replace(/\.name$/, ".description");
          const description =
            descriptionKey && game.i18n.has(descriptionKey, false)
              ? game.i18n.localize(descriptionKey)
              : (entry.system?.description ?? "");
          map.set(entry.name, { label, img: entry.img, description });
          FEATURE_LABELS.set(entry.name, label);
        }
      } catch (err) {
        console.warn(`Redsteel | Learn: could not index ${FEATURE_PACK_ID}`, err);
      }
    }
    this.#featureIndex = map;
    return map;
  }

  /**
   * The Features tab: what the character already has (traits, then features)
   * and every priced feature still to take, grouped by the book's sections.
   *
   * Same-named entries (the human and the elven Specialization) collapse to the
   * one whose race the character has. When neither fits, both stay, each with
   * its own race requirement showing.
   *
   * The per-skill families (FEATURE_FAMILIES) collapse into one row each, and
   * the row opens a skill picker in A/B/C columns (user ruling 2026-09-11).
   * Only classed skills appear there: the unclassed ones are left out on
   * purpose (GM ruling).
   */
  async #buildFeatures() {
    const actor = this.actor;
    const index = await this.#loadFeatureIndex();
    const traits = await this.#buildTraits();
    const isGM = game.user.isGM;

    const owned = getOwnedFeatures(actor)
      .sort((a, b) => (a.item.sort || 0) - (b.item.sort || 0))
      .map(({ item, price }) => {
        const racial = isRaceGrantedFeature(item);
        // A native language is the GM's free grant: it reads "Native" where a
        // price would be, and only the GM can give it back.
        const native = isNativeLanguageFeature(item);
        return {
          itemId: item.id,
          uuid: item.uuid,
          name: item.localizedName ?? item.name,
          img: item.img,
          costLabel: price ? pointsCostLabel(price) : "",
          racial,
          native,
          unpriced: !price && !racial,
          refundable: !!price && !racial && !!actor?.isOwner && (!native || isGM),
          description: item.localizedDescription ?? "",
          expandKey: `owned-${item.id}`,
          expanded: this.#expandedFeatures.has(`owned-${item.id}`),
        };
      });

    // Every priced feature with its state for this character, owned ones too:
    // the skill picker shows those as taken. The table's features come first,
    // then pack features priced only on their item. Language features come
    // back "unavailable": they are learnt per language in the Languages panel.
    const entries = [];
    for (const id of getFeatureCatalogIds()) {
      const { state, price, requirements, conflict } = getFeatureState(actor, id);
      if (state === "unavailable") continue;
      const results = requirements?.results ?? [];
      const reasons = [];
      if (conflict) {
        const other = conflict.source
          ? getDiscountSourceLabel(conflict.source)
          : (conflict.item?.localizedName ?? conflict.item?.name ?? "");
        const key =
          { skillTaken: "skillTaken", discountTaken: "discountTaken" }[conflict.reason] ??
          "pickOnce";
        reasons.push(
          game.i18n.format(`REDSTEEL.Learn.Features.${key}`, {
            skill: trackLabel("skills", conflict.source?.skill ?? price.skill),
            name: other,
          }),
        );
      }
      for (const result of results) {
        if (result.met || result.advisory) continue;
        const line = describeRequirement(result.req);
        if (line) reasons.push(line);
      }
      const known = index.get(price.name);
      entries.push({
        id,
        price,
        state,
        results,
        reasons,
        englishName: price.name,
        uuid: getFeatureUuid(id),
        name: known?.label ?? price.name,
        img: known?.img ?? "icons/svg/mystery-man.svg",
        description: known?.description ?? "",
        section: price.section,
        costLabel: pointsCostLabel(price),
        family: featureFamilyOf(price),
        meets: state === "available" || state === "poor",
        showLock: state === "locked" || state === "taken",
        raceFits: results
          .filter((result) => result.req.t === "race")
          .every((result) => result.met),
        // A magic feature's gate clause (featurePrices.mjs, MAGIC GATE).
        magicFits: results
          .filter((result) => result.req.gate === "magic")
          .every((result) => result.met),
        skillFits: buildsOnHeldTrack(actor, price),
      });
    }

    // Features that stand on their own, not yet owned.
    const byName = new Map();
    for (const entry of entries) {
      if (entry.family || entry.state === "owned") continue;
      if (!byName.has(entry.englishName)) byName.set(entry.englishName, []);
      byName.get(entry.englishName).push(entry);
    }
    const rows = [];
    for (const group of byName.values()) {
      const fitting = group.filter((entry) => entry.raceFits);
      for (const entry of fitting.length ? fitting.slice(0, 1) : group) {
        rows.push({
          id: entry.id,
          uuid: entry.uuid,
          name: entry.name,
          img: entry.img,
          section: entry.section,
          costLabel: entry.costLabel,
          state: entry.state,
          meets: entry.meets,
          showLock: entry.showLock,
          raceFits: entry.raceFits,
          magicFits: entry.magicFits,
          skillFits: entry.skillFits,
          reqChips: requirementChips(null, null, entry.results),
          reasons: entry.reasons,
          search: normalizeSearch(`${entry.name} ${entry.englishName}`),
          description: entry.description,
          expandKey: `feature-${entry.id}`,
          expanded: this.#expandedFeatures.has(`feature-${entry.id}`),
        });
      }
    }

    // One row per family, summing up its skills.
    const families = new Map();
    for (const entry of entries) {
      if (!entry.family) continue;
      if (!families.has(entry.family)) families.set(entry.family, []);
      families.get(entry.family).push(entry);
    }
    for (const [family, members] of families) {
      const skills = this.#familySkills(members);
      if (!skills.size) continue;
      const chosen = [...skills.values()];
      const open = chosen.filter((entry) => entry.state !== "owned");
      const states = new Set(open.map((entry) => entry.state));
      const label = game.i18n.localize(`REDSTEEL.Learn.Features.Families.${family}`);
      rows.push({
        isFamily: true,
        family,
        name: label,
        img: chosen[0].img,
        section: chosen[0].section,
        costLabel: rangeCostLabel(chosen.map((entry) => entry.price)),
        state: !open.length
          ? "owned"
          : ["available", "poor", "locked"].find((state) => states.has(state)) ?? "taken",
        meets: open.some((entry) => entry.meets),
        raceFits: chosen.some((entry) => entry.raceFits),
        magicFits: chosen.some((entry) => entry.magicFits),
        skillFits: chosen.some((entry) => entry.skillFits),
        summary: game.i18n.format("REDSTEEL.Learn.Features.familyCount", {
          available: open.filter((entry) => entry.state === "available").length,
          total: skills.size,
        }),
        search: normalizeSearch(
          [
            label,
            ...[...skills.keys()].map((skill) => trackLabel("skills", skill)),
            ...members.map((entry) => entry.englishName),
          ].join(" "),
        ),
      });
    }

    // Languages: one row in General that opens the Languages panel.
    const languageRow = this.#buildLanguageRow(index);
    if (languageRow) rows.push(languageRow);

    const lang = game.i18n.lang;
    const sections = FEATURE_SECTIONS.map((sectionId) => ({
      id: sectionId,
      label: game.i18n.localize(`REDSTEEL.Learn.Features.Sections.${sectionId}`),
      // A section's families come first, then its features, each by name.
      rows: rows
        .filter((row) => row.section === sectionId)
        .sort((a, b) =>
          !!a.isFamily === !!b.isFamily
            ? a.name.localeCompare(b.name, lang)
            : a.isFamily
              ? -1
              : 1,
        ),
    })).filter((section) => section.rows.length);

    // What replaces the list: the Languages panel, or the open family's skill
    // picker, one column per skill class. The Languages panel is checked
    // first, because the family lookup finds no "languages" family and would
    // close it.
    let picker = null;
    let languages = null;
    if (this.#featureFamily === "languages") {
      languages = this.#buildLanguages();
    } else {
      const pickerMembers = this.#featureFamily ? families.get(this.#featureFamily) : null;
      if (pickerMembers?.length) {
        const skills = this.#familySkills(pickerMembers);
        picker = {
          family: this.#featureFamily,
          label: game.i18n.localize(`REDSTEEL.Learn.Features.Families.${this.#featureFamily}`),
          columns: SKILL_CLASS_ORDER.map((skillClass) => ({
            label: game.i18n.format("REDSTEEL.Learn.Features.className", {
              class: skillClass,
            }),
            skills: [...skills.entries()]
              .filter(([skill]) => SKILL_COST_CLASSES[skill] === skillClass)
              .map(([skill, entry]) => ({
                id: entry.id,
                uuid: entry.uuid,
                skillLabel: trackLabel("skills", skill),
                costLabel: entry.costLabel,
                state: entry.state,
                owned: entry.state === "owned",
                showLock: entry.showLock,
                reasons: entry.reasons,
                description: entry.description,
                expandKey: `feature-${entry.id}`,
                expanded: this.#expandedFeatures.has(`feature-${entry.id}`),
              }))
              .sort((a, b) => a.skillLabel.localeCompare(b.skillLabel, lang)),
          })),
        };
      } else {
        this.#featureFamily = null;
      }
    }

    return {
      traits,
      owned,
      sections,
      picker,
      languages,
      discountPicks: this.#buildDiscounts(),
      onlyMet: this.#featureOnlyMet,
      allRaces: this.#featureAllRaces,
      allMagic: this.#featureAllMagic,
      haveSkill: this.#featureHaveSkill,
      filtersOpen: this.#featureFiltersOpen,
      activeFilters: this.#activeFeatureFilterCount(),
      query: this.#featureQuery,
      allSections: this.#featureSections.size === FEATURE_SECTIONS.length,
      sectionChecks: FEATURE_SECTIONS.map((id) => ({
        id,
        label: game.i18n.localize(`REDSTEEL.Learn.Features.Sections.${id}`),
        checked: this.#featureSections.has(id),
      })),
    };
  }

  /**
   * The Languages row of the General section (user ruling 2026-09-14): a
   * family-style row that opens the Languages panel. It reads as Basic
   * communication does, since that is what learns a new language, and never
   * shows as owned.
   */
  #buildLanguageRow(index) {
    const actor = this.actor;
    const basicPrice = LANGUAGE_FEATURE_IDS.basic
      ? getFeaturePrice(LANGUAGE_FEATURE_IDS.basic)
      : null;
    if (!basicPrice) return null;
    const basic = getLanguageFeatureState(actor, "basic", "");
    const known = getKnownLanguages(actor);
    const title = game.i18n.localize("REDSTEEL.Learn.Languages.title");
    const prices = Object.values(LANGUAGE_FEATURE_IDS)
      .filter(Boolean)
      .map((id) => getFeaturePrice(id))
      .filter(Boolean);
    return {
      isFamily: true,
      family: "languages",
      name: title,
      img: index.get(basicPrice.name)?.img ?? "icons/svg/mystery-man.svg",
      section: "general",
      costLabel: rangeCostLabel(prices),
      state: basic.state,
      meets: basic.state === "available" || basic.state === "poor",
      raceFits: true,
      magicFits: true,
      skillFits: false,
      summary: game.i18n.format("REDSTEEL.Learn.Languages.known", { n: known.length }),
      search: normalizeSearch(
        [
          title,
          ...LANGUAGE_SLOTS.map((slot) =>
            game.i18n.localize(`REDSTEEL.Learn.Languages.slots.${slot}`),
          ),
          ...known.map((language) => language.name),
        ].join(" "),
      ),
    };
  }

  /**
   * The Languages panel, in place of the features list (user rulings
   * 2026-09-14): an add row that learns Basic communication in a newly typed
   * language, and one table row per known language with a diamond per slot.
   * Every rule is the engine's (progressionEngine.mjs, Languages).
   */
  #buildLanguages() {
    const actor = this.actor;
    // The family picker's tooltip lines: what blocks the slot, never the
    // advisory clauses.
    const reasonsOf = (slotState, languageName) => {
      const reasons = [];
      if (slotState.reason === "needsBasic") {
        reasons.push(
          game.i18n.format("REDSTEEL.Learn.Languages.needsBasic", {
            language: escapeText(languageName),
          }),
        );
      }
      for (const result of slotState.requirements?.results ?? []) {
        if (result.met || result.advisory) continue;
        const line = describeRequirement(result.req);
        if (line) reasons.push(line);
      }
      return reasons;
    };

    const add = getLanguageFeatureState(actor, "basic", "");
    const rows = getKnownLanguages(actor).map((language) => ({
      name: language.name,
      native: language.native,
      cells: LANGUAGE_SLOTS.map((slot) => {
        const item = language.slots[slot];
        const slotState = getLanguageFeatureState(actor, slot, language.name);
        // An owned slot shows what was paid for it; a native copy was free.
        let price = slotState.price;
        if (item) {
          price = isNativeLanguageFeature(item)
            ? { cp: 0, sp: 0 }
            : getFeaturePriceForItem(actor, item);
        }
        const state = item ? "owned" : slotState.state;
        return {
          slot,
          language: language.name,
          state,
          owned: !!item,
          buyable: !item && slotState.state === "available",
          showLock: state === "locked" || state === "blocked",
          costLabel: price ? pointsCostLabel(price) : "",
          reasons: item ? [] : reasonsOf(slotState, language.name),
        };
      }),
    }));

    return {
      title: game.i18n.localize("REDSTEEL.Learn.Languages.title"),
      headers: LANGUAGE_SLOTS.map((slot) => ({
        slot,
        label: game.i18n.localize(`REDSTEEL.Learn.Languages.slots.${slot}`),
        // Reading and writing shows the first tier's card.
        uuid: LANGUAGE_FEATURE_IDS[slot] ? getFeatureUuid(LANGUAGE_FEATURE_IDS[slot]) : "",
      })),
      rows,
      add: {
        state: add.state,
        buyable: add.state === "available",
        showLock: add.state === "locked",
        costLabel: add.price ? pointsCostLabel(add.price) : "",
        reasons: reasonsOf(add, ""),
      },
      draft: this.#languageDraft,
      editable: !!actor?.isOwner,
      canGrantNative: game.user.isGM && !rows.some((row) => row.native),
    };
  }

  /**
   * One entry per skill of a feature family: skill key → entry. Unclassed skills
   * are left out (GM ruling). Where a skill has several entries (the human and
   * the elven Specialization), the owned one wins, then the one whose race
   * fits, then the first.
   */
  #familySkills(members) {
    const rank = (entry) =>
      entry.state === "owned" ? 0 : entry.raceFits ? 1 : 2;
    const bySkill = new Map();
    for (const entry of members) {
      const skill = entry.price.skill;
      if (!SKILL_COST_CLASSES[skill]) continue;
      const current = bySkill.get(skill);
      if (!current || rank(entry) < rank(current)) bySkill.set(skill, entry);
    }
    return bySkill;
  }

  /**
   * Apply the Features tab's filters to the rendered rows, in place: typing
   * must never re-render the screen and throw the caret out of the field.
   *   - sections: the book's sections ticked in the filter pop-up
   *   - races: by default a row the character's race cannot take is hidden
   *   - requirements met: only rows the character qualifies for
   *   - have skill: only rows that build on a track the character holds
   *   - search: the row's names, accent-free
   * A section with nothing left to show hides with its heading.
   */
  #applyFeatureFilters() {
    const list = this.element?.querySelector?.(".rs-learn-features-list");
    if (!list) return;
    const query = normalizeSearch(this.#featureQuery);
    let visible = 0;
    for (const section of list.querySelectorAll(".rs-learn-feature-section")) {
      const sectionOn = this.#featureSections.has(section.dataset.section);
      let shown = 0;
      for (const row of section.querySelectorAll(".rs-learn-feature")) {
        const hide =
          !sectionOn ||
          (this.#featureOnlyMet && row.dataset.meets !== "true") ||
          (this.#featureHaveSkill && row.dataset.skillFits !== "true") ||
          (!this.#featureAllRaces && row.dataset.raceFits === "false") ||
          (!this.#featureAllMagic && row.dataset.magicFits === "false") ||
          (!!query && !String(row.dataset.search ?? "").includes(query));
        row.hidden = hide;
        if (!hide) shown++;
      }
      section.hidden = shown === 0;
      visible += shown;
    }
    const none = list.querySelector(".rs-learn-features-none");
    if (none) none.hidden = visible > 0;
  }

  /**
   * The ribbon over a toggled tab: one switch per block this character trains
   * in, in the tab's own order. Empty on a tab without one.
   */
  #buildRibbon() {
    if (!RIBBON_TABS.has(this.#tab)) return [];
    const present = new Set();
    for (const trackId of Object.keys(PROGRESSION_TRACKS)) {
      if (getTrackTab(trackId) !== this.#tab) continue;
      if (!isTracked(this.actor, trackId)) continue;
      present.add(getLearnSection(trackId));
    }
    const ids = (LEARN_SECTION_ORDER[this.#tab] ?? []).filter((id) =>
      present.has(id),
    );
    const hidden = this.#hiddenSections.get(this.#tab);
    return ids.map((id) => ({
      id,
      label: sectionLabel(id),
      active: !hidden?.has(id),
    }));
  }

  /**
   * The whole grid: blocks in this tab's order, tracks inside each block in
   * the order the price table declares them (which is the rules sheet's own
   * order — sorting it would scramble the book's layout).
   *
   * @param {Set<string>|null} [shown]  On a ribbon tab, the blocks switched
   *   on. A block switched off never has its cells built, which also keeps a
   *   purchase's re-render down to what is on screen.
   */
  async #buildSections(shown = null) {
    const actor = this.actor;
    const buckets = new Map();
    // The school a temperament hands out: its rank I cannot be given back.
    const forcedSchool = getForcedSchool(actor);

    for (const [trackId, track] of Object.entries(PROGRESSION_TRACKS)) {
      // Each tab owns its own half of the price table, and inside a tab the
      // grid is only the tracks this character trains. Everything else is
      // still buyable, it just has to be picked first — see #buildPicker.
      if (getTrackTab(trackId) !== this.#tab) continue;
      if (!isTracked(actor, trackId)) continue;
      const section = getLearnSection(trackId);
      if (shown && !shown.has(section)) continue;
      const held = getTrackRank(actor, track.group, track.key);
      const cells = [];
      for (let rank = 1; rank <= 10; rank++) {
        cells.push(await this.#buildCell(trackId, rank));
      }
      const entry = this.#layoutTrack({
        id: trackId,
        label: trackLabel(track.group, track.key),
        held,
        cells,
        // A track a mirror perk copies has no refund diamond: it follows its
        // source. Every rank above the one held says so on its lock.
        mirrored: getMirrorSources(actor).some(
          (source) => `${source.group}.${source.skill}` === trackId,
        ),
        forced: trackId === `schools.${forcedSchool}`,
      });
      if (!buckets.has(section)) buckets.set(section, []);
      buckets.get(section).push(entry);
    }

    const sections = [];
    for (const id of LEARN_SECTION_ORDER[this.#tab] ?? []) {
      const tracks = buckets.get(id);
      if (!tracks?.length) continue;
      sections.push({ id, label: sectionLabel(id), tracks });
    }
    return sections;
  }

  /**
   * Turn one track's ten cells into the block the template prints.
   *
   * The block is a single CSS grid, `140px repeat(10, 1fr)`, in both modes, and
   * every item in it is placed by hand: an auto-placed item would be pushed out
   * of its column by the ten full-height hover columns, so row and column are
   * stated on each one. Both modes share that grid, so every block on the page
   * still lines up with the sticky rank header and with each other.
   *
   * Matrix rows are fixed: title, node track, icons, one row per stat,
   * requirements, cost.
   * The icon row is dropped entirely when no rank in the track has either an
   * ability or a line of prose to put in it.
   *
   * Segment rows are fixed too, and shorter: title, node track, one content row
   * carrying every rank's icons and chips, requirements, cost. No stat rows at
   * all.
   */
  #layoutTrack(entry) {
    const { cells, held } = entry;
    const mode = getTrackMode(entry.id);
    const segments = mode === "segments";
    const rows = segments ? [] : buildStatRows(entry.id, entry.label);

    // The track name sits in the gutter of the node row rather than on a row
    // of its own: it is one line of text beside ten diamonds, and giving it a
    // whole row only made every block taller.
    const nodeRow = 1;
    const hasIcons = cells.some((c) => c.grants.length || c.prose.length);
    let next = nodeRow + 1;
    // Segment mode always keeps its content row: it is the only place those
    // tracks have to print a number, so it is never conditional.
    const segRow = segments ? next++ : 0;
    const iconRow = !segments && hasIcons ? next++ : 0;
    for (const row of rows) {
      row.row = next++;
      for (const cell of row.cells) {
        cell.state = cells[cell.rank - 1]?.state ?? "unavailable";
        cell.style = `grid-row:${row.row};grid-column:${cell.col}`;
      }
      row.labelStyle = `grid-row:${row.row};grid-column:1`;
      row.total = statRowTotal(row, held);
      row.totalTooltip = row.total
        ? game.i18n.format("REDSTEEL.Learn.currentTotal", {
            label: row.label,
            value: row.total,
          })
        : "";
    }
    // Directly above the price: what the rank asks for, then what it costs.
    const reqRow = next++;
    const costRow = next;

    for (const cell of cells) {
      const prev = cells[cell.rank - 2];
      const nextCell = cells[cell.rank];
      // The connecting line is drawn as two half-segments on each node, so a
      // track that stops short of X simply stops drawing them.
      const classes = [];
      if (cell.exists) {
        if (prev?.exists) classes.push("has-left");
        if (nextCell?.exists) classes.push("has-right");
        // Owned ranks are a run from I upwards, so the segment below a rank is
        // lit exactly when that rank is held.
        if (held >= cell.rank) classes.push("lit-left");
        if (held >= cell.rank + 1) classes.push("lit-right");
        if (cell.state === "owned") classes.push("is-owned");
      }
      cell.nodeClass = classes.join(" ");
      cell.isHeld =
        held > 0 && cell.rank === held && !entry.mirrored && !(entry.forced && held === 1);
      cell.showProse = !cell.grants.length && cell.prose.length > 0;
      cell.showIcons = cell.grants.length > 0 || cell.showProse;
      cell.hitStyle = `grid-row: ${nodeRow} / span ${costRow - nodeRow + 1}; grid-column: ${cell.col}`;
      cell.nodeStyle = `grid-row:${nodeRow};grid-column:${cell.col}`;
      cell.iconStyle = iconRow ? `grid-row:${iconRow};grid-column:${cell.col}` : "";
      cell.segStyle = segRow ? `grid-row:${segRow};grid-column:${cell.col}` : "";
      // Segment mode's engraved card top: one recessed band per rank behind its
      // diamond and its content, so icons and text read as set into the card.
      // Only on ranks the book sells, so a track that stops short of X does not
      // leave empty sockets behind.
      cell.engraveStyle =
        segments && cell.exists
          ? `grid-row:${nodeRow} / span ${segRow - nodeRow + 1};grid-column:${cell.col}`
          : "";
      cell.hasSegment = segments && (cell.grants.length > 0 || cell.chips.length > 0);
      cell.reqStyle = `grid-row:${reqRow};grid-column:${cell.col}`;
      cell.costStyle = `grid-row:${costRow};grid-column:${cell.col}`;
    }

    return Object.assign(entry, {
      mode,
      segments,
      rows,
      iconRow,
      segRow,
      titleStyle: `grid-row:${nodeRow};grid-column:1`,
      reqLabelStyle: `grid-row:${reqRow};grid-column:1`,
      costLabelStyle: `grid-row:${costRow};grid-column:1`,
      // The progress band: one translucent fill running from the left edge of
      // the block through the last rank bought, so how far the track is trained
      // reads as a bar rather than as ten separately outlined cards. Spanned by
      // row count rather than `1 / -1`, because every row here is implicit and
      // -1 would resolve to line 1.
      // Always drawn: at rank 0 it sits behind the gutter alone, stopping just
      // short of rank I, and each rank bought pushes its right edge one column
      // further. Column 1 is the gutter and the ranks are columns 2..11, so a
      // track at rank N ends the fill at line N + 2.
      fillStyle: `grid-row:1 / span ${costRow};grid-column:1 / ${held + 2}`,
      // At rank X the band reaches the last column, so it bleeds through the
      // right padding too and closes the panel off.
      fillClass: held >= 10 ? "is-full" : "",
      // Ledger rules: one above every stat row (user ruling: each percentage
      // row is ruled off like the requirements), then above the requirements
      // and the price, so the last stat row is underlined by the requirements'
      // rule. Each is its own grid item spanning every column, so the line runs
      // unbroken across the block instead of restarting in each rank. They sit
      // behind the cards; see .rs-learn-rule. Segment mode has no stat rows, so
      // it keeps just the two.
      ruleStyles: [
        ...rows.map((row) => `grid-row:${row.row};grid-column:1 / -1`),
        `grid-row:${reqRow};grid-column:1 / -1`,
        `grid-row:${costRow};grid-column:1 / -1`,
      ],
      costLabel: priceLabel(cells),
      paid: paidTotal(cells, held),
      discount: discountNote(cells),
    });
  }

  /**
   * The track picker: every track in the book, grouped the same way the grid
   * groups them, each with a checkbox.
   *
   * A track with a rank already bought is checked and locked — unpicking it
   * would hide a purchase from the only screen that can refund it.
   *
   * A track whose prerequisite is missing (getUnmetPrerequisites: Channeling
   * without magic potential, a school without Channeling or Veneficus) is unchecked and
   * locked, so saving the picker also drops it from the tree.
   */
  #buildPicker() {
    const actor = this.actor;
    const buckets = new Map();

    for (const [trackId, track] of Object.entries(PROGRESSION_TRACKS)) {
      if (getTrackTab(trackId) !== this.#tab) continue;
      const held = getTrackRank(actor, track.group, track.key);
      const section = getLearnSection(trackId);
      const unmet = held > 0 ? [] : getUnmetPrerequisites(actor, trackId);
      const gated = unmet.length > 0;
      let lockTip = "";
      if (gated) {
        lockTip = game.i18n.format("REDSTEEL.Learn.pickerGated", {
          requirements: unmet.map(describeRequirement).filter(Boolean).join(", "),
        });
      } else if (held > 0) {
        lockTip = game.i18n.localize("REDSTEEL.Learn.pickerLocked");
      }
      if (!buckets.has(section)) buckets.set(section, []);
      buckets.get(section).push({
        id: trackId,
        label: trackLabel(track.group, track.key),
        held,
        checked: !gated && isTracked(actor, trackId),
        locked: held > 0 || gated,
        gated,
        lockTip,
      });
    }

    const sections = [];
    for (const id of LEARN_SECTION_ORDER[this.#tab] ?? []) {
      const tracks = buckets.get(id);
      if (!tracks?.length) continue;
      sections.push({ id, label: sectionLabel(id), tracks });
    }
    return sections;
  }

  /** One rank column of a track. */
  async #buildCell(trackId, rank) {
    const { state, price, requirements, mirror } = getRankState(
      this.actor,
      trackId,
      rank,
    );

    // The Requirements row prints every rank's clauses, including the ranks
    // `getRankState` never gets as far as testing: an owned or a blocked rank
    // comes back with `requirements: null`, so the list is evaluated here.
    const results =
      requirements?.results ??
      (price?.requires?.length
        ? evaluateRequirements(this.actor, price.requires, trackId, rank)
            .results
        : []);

    const reasons = [];
    const advisories = [];
    for (const result of requirements?.results ?? []) {
      if (result.met) continue;
      const line = describeRequirement(result.req);
      if (!line) continue;
      (result.advisory ? advisories : reasons).push(line);
    }
    // A track a mirror perk copies is never bought: it follows its source.
    if (mirror) {
      reasons.push(
        game.i18n.format("REDSTEEL.Learn.Mirror.locked", {
          skill: trackLabel(mirror.group, mirror.from),
        }),
      );
    }

    const currency = price?.currency ?? null;
    // The price this character pays, a skill's discount included. The discount
    // is named once on the track's price label (see discountNote), not on
    // every rank.
    const rankCost = getRankCost(this.actor, trackId, rank);
    const effects = describeEffects(trackId, rank);

    // The cell's tooltip, as groups the template separates with a rule: what
    // the rank does, then what is still missing, then the clauses only the GM
    // can rule on. Advisories belong here rather than nowhere — a rank gated on
    // "a special occasion" never blocks, so the tooltip is the only place a
    // player would ever learn that the book asks for one.
    const tooltipGroups = [
      effects.map((e) => e.text),
      reasons,
      advisories,
    ].filter((group) => group.length);

    const grants = await this.#resolveGrants(getRankGrants(trackId, rank));

    return {
      rank,
      // Column two is rank I: column one is the label gutter.
      col: rank + 1,
      state,
      // A rank the book does not sell gets no node on the track and no line
      // running into it.
      exists: state !== "unavailable",
      cost: rankCost?.cost ?? price?.cost ?? null,
      discountSource: rankCost?.discount ?? null,
      currency,
      // Every clause of this rank as a chip, for the Requirements row.
      reqChips: requirementChips(trackId, rank, results),
      grants,
      // Prose has no stat to sit under, so it never becomes a row. It shows as
      // a chip in the icon row when the rank has no ability icon of its own.
      prose: effects.filter((e) => e.prose).map((e) => e.text),
      // Segment mode's chips: everything this rank does, merged where several
      // stats move by the same step. Built for every cell and used only by the
      // segment layout, which costs nothing and keeps the cell shape uniform.
      chips: markAbilityChips(describeRankChips(trackId, rank), grants),
      reasons,
      advisories,
      tooltipGroups,
    };
  }

  /**
   * Ability icons for a rank. A UUID that no longer resolves (a compendium
   * entry renamed or removed) is dropped rather than thrown on: a broken link
   * in the price table must not take the whole window down.
   */
  async #resolveGrants(uuids) {
    const out = [];
    for (const uuid of uuids) {
      if (!this.#grantCache.has(uuid)) {
        let entry = null;
        try {
          const doc = await fromUuid(uuid);
          if (doc) {
            entry = {
              uuid,
              name: doc.name,
              localizedName: doc.localizedName ?? doc.name,
              img: doc.img,
            };
          }
        } catch (err) {
          console.warn(`Redsteel | Learn: could not resolve ${uuid}`, err);
        }
        this.#grantCache.set(uuid, entry);
      }
      const entry = this.#grantCache.get(uuid);
      if (entry) out.push(entry);
    }
    return out;
  }

  /* ---------------------------------------- */

  /** @override */
  /**
   * Put the screen above Foundry's interface but under every tooltip.
   *
   * It covers the sidebar, the hotbar and the scene controls, so it has to sit
   * above them; the tooltips explaining each requirement and effect have to sit
   * above it. Foundry's core tooltip layer is read off the live element rather
   * than assumed, and the screen takes the highest value under both that and
   * the system's own tooltip root. Written inline with !important because
   * Foundry raises a focused application's z-index inline, which would
   * otherwise lift the screen back over the tooltips.
   */
  #applyLayer() {
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    let ceiling = SYSTEM_TOOLTIP_LAYER;
    const tip = game.tooltip?.tooltip;
    // A popover tooltip lives in the browser's top layer, above any z-index.
    if (tip instanceof HTMLElement && !tip.hasAttribute("popover")) {
      const z = Number.parseInt(getComputedStyle(tip).zIndex, 10);
      if (Number.isFinite(z)) ceiling = Math.min(ceiling, z);
    }
    root.style.setProperty("z-index", String(ceiling - 1), "important");
  }


  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    // Buying a rank writes to the actor, and so does the sheet next to this
    // window. Both must repaint the grid, so the window follows the document
    // rather than only its own clicks.
    this.#hookId = Hooks.on("updateActor", (doc) => {
      if (doc?.id === this.actor?.id) this.render();
    });
    // Buying, refunding or dropping a feature changes the actor's items, not the
    // actor itself, so updateActor alone would never see it.
    const onItem = (item) => {
      if (item?.parent?.id === this.actor?.id) this.render();
    };
    this.#itemHookIds = ["createItem", "updateItem", "deleteItem"].map(
      (name) => [name, Hooks.on(name, onItem)],
    );
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender?.(context, options);
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    this.#applyLayer();

    // Re-render replaces the part but keeps this root, so the previous
    // listener is removed instead of a second copy being stacked on it.
    if (this.#boundChange) root.removeEventListener("change", this.#boundChange);
    this.#boundChange = (event) => this.#onFieldChange(event);
    root.addEventListener("change", this.#boundChange);

    // The Features tab filters in place (see #applyFeatureFilters). The search
    // field is new on every render, so its listener never stacks.
    const search = root.querySelector(".rs-learn-feature-search");
    if (search) {
      search.addEventListener("input", () => {
        this.#featureQuery = search.value;
        this.#applyFeatureFilters();
      });
    }

    // The Languages panel's name field: its text survives a re-render, and
    // Enter learns the language as the add diamond does. Like the search field
    // it is new on every render, so these listeners never stack.
    const languageName = root.querySelector(".rs-learn-language-name");
    if (languageName) {
      languageName.addEventListener("input", () => {
        this.#languageDraft = languageName.value;
      });
      languageName.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!this.actor?.isOwner) return;
        this.#buyLanguage("basic", languageName.value);
      });
    }

    // Every tick in the filter pop-up filters the list at once. Like the search
    // field the pop-up is new on every render, so its listener never stacks.
    const popup = root.querySelector(".rs-learn-filter-popup");
    if (popup) {
      popup.addEventListener("change", (event) => this.#onFilterPopupChange(popup, event.target));
      this.#syncFilterPopup(popup);
    }

    // A click anywhere outside the pop-up (other than its own button) closes
    // it. The root survives re-renders, so this is bound once and released in
    // _onClose.
    if (!this.#boundPopupDismiss) {
      this.#boundPopupDismiss = (event) => {
        if (!this.#featureFiltersOpen) return;
        if (event.target?.closest?.(".rs-learn-filter-popup, [data-action='toggleFeatureFilters']")) return;
        this.#setFeatureFiltersOpen(false);
      };
      root.addEventListener("pointerdown", this.#boundPopupDismiss);
    }

    this.#applyFeatureFilters();
  }

  /**
   * Always close instantly (`animate: false`, ApplicationClosingOptions).
   *
   * Foundry's close animation is built for a floating window. On this full
   * screen it left the tab strip, the wallet bar and the rank header painted
   * over the canvas for a few seconds after closing, and for those seconds the
   * instance was still registered, so reopening Learn would have found the one
   * on its way out. Every way of closing goes through here: the close button,
   * Escape, and anything else that calls close().
   *
   * @override
   */
  async close(options = {}) {
    return super.close({ ...options, animate: false });
  }

  /** @override */
  _onClose(options) {
    if (this.#hookId !== null) {
      Hooks.off("updateActor", this.#hookId);
      this.#hookId = null;
    }
    for (const [name, id] of this.#itemHookIds) Hooks.off(name, id);
    this.#itemHookIds = [];
    const root = this.element;
    if (this.#boundChange && root instanceof HTMLElement) {
      root.removeEventListener("change", this.#boundChange);
    }
    this.#boundChange = null;
    if (this.#boundPopupDismiss && root instanceof HTMLElement) {
      root.removeEventListener("pointerdown", this.#boundPopupDismiss);
    }
    this.#boundPopupDismiss = null;
    super._onClose?.(options);
  }

  /**
   * The wallet bar's fields. ApplicationV2 submits nothing here (this window is
   * not a form application), so each field writes itself.
   */
  #onFieldChange(event) {
    const el = event.target;
    // A discount pick is a skill key, not a number, so it has its own writer.
    if (el?.dataset?.discountSource !== undefined) {
      if (!this.actor?.isOwner) return;
      setDiscountChoice(this.actor, el.dataset.discountSource, el.value);
      return;
    }
    // So is a mirror pick (the Hoplite's weapon skill).
    if (el?.dataset?.mirrorSource !== undefined) {
      if (!this.actor?.isOwner) return;
      setMirrorChoice(this.actor, el.dataset.mirrorSource, el.value);
      return;
    }
    const name = el?.name;
    if (!name || !name.startsWith("system.progression")) return;
    if (!this.actor?.isOwner) return;
    const value = Number(el.value) || 0;
    this.actor.update({ [name]: value });
  }

  /* ---------------------------------------- */

  /**
   * ApplicationV2 binds `this` to the application instance when it calls an
   * action handler, which is why these statics may reach instance state.
   * @this {LearnWindow}
   */
  static _onSwitchTab(event, target) {
    event.preventDefault();
    const tab = target?.dataset?.tab;
    if (!tab || tab === this.#tab) return;
    this.#tab = tab;
    // Leaving the Skills tab abandons an open picker, so coming back lands on
    // the grid rather than on a half-finished selection. An open feature
    // family picker is abandoned the same way, and so are an open star sign and
    // the specialisation picker.
    this.#picking = false;
    this.#featureFamily = null;
    this.#specOpen = null;
    this.#specPicking = false;
    this.render();
  }

  /**
   * Switch one block of a ribbon tab on or off. The scroll position is left
   * alone, so the reader stays where they were among the blocks still showing.
   *
   * @this {LearnWindow}
   */
  static _onToggleSection(event, target) {
    event.preventDefault();
    const section = target?.dataset?.section;
    if (!section) return;
    let hidden = this.#hiddenSections.get(this.#tab);
    if (!hidden) {
      hidden = new Set();
      this.#hiddenSections.set(this.#tab, hidden);
    }
    if (hidden.has(section)) hidden.delete(section);
    else hidden.add(section);
    this.render();
  }

  /**
   * Open or close the filter pop-up. Every tick in it applies at once (user
   * ruling), so closing has nothing to confirm and nothing to undo.
   *
   * @this {LearnWindow}
   */
  static _onToggleFeatureFilters(event) {
    event.preventDefault();
    this.#setFeatureFiltersOpen(!this.#featureFiltersOpen);
  }

  /**
   * Reset: every section, no switch. Applies at once, like any tick.
   *
   * @this {LearnWindow}
   */
  static _onResetFeatureFilters(event) {
    event.preventDefault();
    this.#featureSections = new Set(FEATURE_SECTIONS);
    this.#featureOnlyMet = false;
    this.#featureAllRaces = false;
    this.#featureAllMagic = false;
    this.#featureHaveSkill = false;
    this.#writeFilterPopup();
    this.#applyFeatureFilters();
    this.#refreshFeatureFilterCount();
  }

  /** Show or hide the pop-up and light the Filters button to match. */
  #setFeatureFiltersOpen(open) {
    this.#featureFiltersOpen = open;
    const popup = this.element?.querySelector?.(".rs-learn-filter-popup");
    if (popup) popup.hidden = !open;
    const button = this.element?.querySelector?.("[data-action='toggleFeatureFilters']");
    if (button) {
      button.classList.toggle("active", open);
      button.setAttribute("aria-expanded", String(open));
    }
  }

  /** Tick the pop-up's boxes to match the filters. */
  #writeFilterPopup() {
    const popup = this.element?.querySelector?.(".rs-learn-filter-popup");
    if (!popup) return;
    for (const box of popup.querySelectorAll("[data-filter-section]")) {
      box.checked = this.#featureSections.has(box.dataset.filterSection);
    }
    const onlyMet = popup.querySelector("[data-filter-only-met]");
    if (onlyMet) onlyMet.checked = this.#featureOnlyMet;
    const allRaces = popup.querySelector("[data-filter-all-races]");
    if (allRaces) allRaces.checked = this.#featureAllRaces;
    const allMagic = popup.querySelector("[data-filter-all-magic]");
    if (allMagic) allMagic.checked = this.#featureAllMagic;
    const haveSkill = popup.querySelector("[data-filter-have-skill]");
    if (haveSkill) haveSkill.checked = this.#featureHaveSkill;
    this.#syncFilterPopup(popup);
  }

  /**
   * A box in the pop-up changed: keep "(Select all)" in step, then take the
   * boxes as the filters and filter the list straight away. With no section
   * ticked the list is simply empty, and says so.
   */
  #onFilterPopupChange(popup, changed) {
    this.#syncFilterPopup(popup, changed);
    this.#featureSections = new Set(
      [...popup.querySelectorAll("[data-filter-section]")]
        .filter((box) => box.checked)
        .map((box) => box.dataset.filterSection),
    );
    this.#featureOnlyMet = !!popup.querySelector("[data-filter-only-met]")?.checked;
    this.#featureAllRaces = !!popup.querySelector("[data-filter-all-races]")?.checked;
    this.#featureAllMagic = !!popup.querySelector("[data-filter-all-magic]")?.checked;
    this.#featureHaveSkill = !!popup.querySelector("[data-filter-have-skill]")?.checked;
    this.#applyFeatureFilters();
    this.#refreshFeatureFilterCount();
  }

  /**
   * Keep "(Select all)" in step with the section boxes: ticking it ticks them
   * all, and it shows ticked, half-ticked or clear to match them.
   */
  #syncFilterPopup(popup, changed = null) {
    const all = popup.querySelector("[data-filter-all-sections]");
    const boxes = [...popup.querySelectorAll("[data-filter-section]")];
    if (all && changed === all) {
      for (const box of boxes) box.checked = all.checked;
    }
    const ticked = boxes.filter((box) => box.checked).length;
    if (all) {
      all.checked = ticked === boxes.length;
      all.indeterminate = ticked > 0 && ticked < boxes.length;
    }
  }

  /** How many Features tab filters are away from their default. */
  #activeFeatureFilterCount() {
    return (
      (this.#featureSections.size < FEATURE_SECTIONS.length ? 1 : 0) +
      (this.#featureOnlyMet ? 1 : 0) +
      (this.#featureAllRaces ? 1 : 0) +
      (this.#featureAllMagic ? 1 : 0) +
      (this.#featureHaveSkill ? 1 : 0)
    );
  }

  /** Update the count on the Filters button after the filters change. */
  #refreshFeatureFilterCount() {
    const badge = this.element?.querySelector?.(".rs-learn-filter-count");
    if (!badge) return;
    const count = this.#activeFeatureFilterCount();
    badge.textContent = String(count);
    badge.hidden = count === 0;
  }

  /**
   * Roll a trait's or a feature's description out under it, or back in. The
   * buy diamond and the give-back button inside the row keep their own
   * actions (the nearest data-action wins), and a click inside the description
   * itself leaves it open so its text can be selected.
   *
   * @this {LearnWindow}
   */
  static _onToggleFeatureDescription(event, target) {
    if (event.target?.closest?.(".rs-learn-feature-desc")) return;
    const key = target?.dataset?.expandKey;
    const description = target?.querySelector?.(":scope > .rs-learn-feature-desc");
    if (!key || !description) return;
    const open = description.hidden;
    description.hidden = !open;
    target.classList.toggle("is-expanded", open);
    if (open) this.#expandedFeatures.add(key);
    else this.#expandedFeatures.delete(key);
  }

  /** Open a feature family's skill picker in place of the list. @this {LearnWindow} */
  static _onOpenFeatureFamily(event, target) {
    event.preventDefault();
    const family = target?.dataset?.family;
    if (!family) return;
    this.#featureFamily = family;
    this.render();
  }

  /** Close the skill picker and return to the list. @this {LearnWindow} */
  static _onCloseFeatureFamily(event) {
    event.preventDefault();
    this.#featureFamily = null;
    this.render();
  }

  /**
   * Learn a language slot from the Languages panel. A table diamond names its
   * language; the add row's diamond reads the typed name.
   *
   * @this {LearnWindow}
   */
  static async _onBuyLanguage(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const slot = target?.dataset?.slot;
    if (!slot) return;
    const language =
      target.dataset.language ??
      this.element?.querySelector?.(".rs-learn-language-name")?.value ??
      "";
    await this.#buyLanguage(slot, language);
  }

  /** Buy one language slot, warning in place of a silent refusal. */
  async #buyLanguage(slot, language) {
    if (this.#languageBusy) return;
    const name = String(language ?? "").trim();
    if (!name) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Languages.nameRequired"));
      return;
    }
    const { state } = getLanguageFeatureState(this.actor, slot, name);
    if (state === "taken") {
      ui.notifications.warn(
        game.i18n.format("REDSTEEL.Learn.Languages.alreadyKnown", { language: name }),
      );
      return;
    }
    this.#languageBusy = true;
    try {
      const bought = await purchaseLanguageFeature(this.actor, slot, name);
      if (!bought) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Features.cannotBuy"));
      } else if (slot === "basic") {
        this.#languageDraft = "";
      }
    } finally {
      this.#languageBusy = false;
    }
    this.render();
  }

  /**
   * GM only: grant the typed language as the character's native language.
   *
   * @this {LearnWindow}
   */
  static async _onGrantNativeLanguage(event) {
    event.preventDefault();
    if (!game.user.isGM || this.#languageBusy) return;
    const name = String(
      this.element?.querySelector?.(".rs-learn-language-name")?.value ?? "",
    ).trim();
    if (!name) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Languages.nameRequired"));
      return;
    }
    this.#languageBusy = true;
    let result;
    try {
      result = await grantNativeLanguage(this.actor, name);
    } finally {
      this.#languageBusy = false;
    }
    if (result.ok) {
      this.#languageDraft = "";
    } else {
      const message =
        result.reason === "nativeTaken"
          ? game.i18n.localize("REDSTEEL.Learn.Languages.nativeTaken")
          : result.reason === "alreadyKnown"
            ? game.i18n.format("REDSTEEL.Learn.Languages.alreadyKnown", { language: name })
            : game.i18n.localize("REDSTEEL.Learn.Features.cannotBuy");
      ui.notifications.warn(message);
    }
    this.render();
  }

  /** @this {LearnWindow} */
  static async _onBuyFeature(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const featureId = target?.dataset?.featureId;
    if (!featureId) return;
    const bought = await purchaseFeature(this.actor, featureId);
    if (!bought) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Features.cannotBuy"));
    }
    this.render();
  }

  /**
   * Give a bought feature back, from its row's give-back control. As with a
   * rank, refunds are rare, so it asks nothing.
   *
   * @this {LearnWindow}
   */
  static async _onRefundFeature(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.actor?.isOwner) return;
    const itemId = target?.dataset?.itemId;
    if (!itemId) return;
    const result = await refundFeature(this.actor, itemId);
    // A language copy can be refused (progressionEngine.mjs, Languages): say why.
    if (!result?.ok && result?.reason) {
      ui.notifications.warn(
        game.i18n.format(`REDSTEEL.Learn.Languages.${result.reason}`, {
          language: result.language ?? "",
        }),
      );
    }
    this.render();
  }

  /** Open a specialisation's star sign in place of the lists. @this {LearnWindow} */
  static _onOpenSpec(event, target) {
    event.preventDefault();
    const spec = target?.dataset?.spec;
    if (!spec || !getSpecPrice(spec)) return;
    this.#specOpen = spec;
    this.render();
  }

  /**
   * From a token under the hero's attributes straight to that star sign, from
   * any tab. The pickers are abandoned as a tab switch abandons them, so Back
   * lands on the owned cards. @this {LearnWindow}
   */
  static _onOpenHeroSpec(event, target) {
    event.preventDefault();
    const spec = target?.dataset?.spec;
    if (!spec || !getSpecPrice(spec)) return;
    if (this.#tab === "specialisations" && this.#specOpen === spec) return;
    this.#tab = "specialisations";
    this.#picking = false;
    this.#featureFamily = null;
    this.#specPicking = false;
    this.#specOpen = spec;
    this.render();
  }

  /**
   * Back from a star sign. The picker flag is left alone, so a star sign opened
   * from the picker goes back to the picker. @this {LearnWindow}
   */
  static _onCloseSpec(event) {
    event.preventDefault();
    this.#specOpen = null;
    this.render();
  }

  /** From the Learn Specialisation card to the picker. @this {LearnWindow} */
  static _onOpenSpecPicker(event) {
    event.preventDefault();
    this.#specPicking = true;
    this.render();
  }

  /** Back from the picker to the owned cards. @this {LearnWindow} */
  static _onCloseSpecPicker(event) {
    event.preventDefault();
    this.#specPicking = false;
    this.render();
  }

  /**
   * Buy a specialisation with Specialisation points. A purchase goes back to
   * the owned cards, where the new card shows (user ruling), whether it was made
   * from a picker card or from a star sign opened from the picker. A refused
   * one leaves the view as it was.
   * @this {LearnWindow}
   */
  static async _onBuySpec(event, target) {
    event.preventDefault();
    // The diamond sits inside a row that opens the star sign.
    event.stopPropagation();
    if (!this.actor?.isOwner) return;
    const spec = target?.dataset?.spec;
    if (!spec) return;
    const bought = await purchaseSpec(this.actor, spec);
    if (bought) {
      this.#specPicking = false;
      this.#specOpen = null;
    } else {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Specs.cannotBuy"));
    }
    this.render();
  }

  /**
   * Give a specialisation back from its owned diamond. As with ranks and
   * features it asks nothing. It is refused while any of its nodes is still
   * unlocked.
   *
   * @this {LearnWindow}
   */
  static async _onRefundSpec(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.actor?.isOwner) return;
    const spec = target?.dataset?.spec;
    if (!spec) return;
    const refunded = await refundSpec(this.actor, spec);
    if (!refunded) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Specs.refundBlocked"));
    }
    this.render();
  }

  /**
   * Unlock a node of an owned specialisation, paying its CP and/or SP (user
   * ruling 2026-09-14). A Bane node's picker is a dialog, which would open
   * underneath this full screen, so the pick is left to the sheet: clicking
   * the unlocked node there opens the picker.
   *
   * @this {LearnWindow}
   */
  static async _onBuySpecNode(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.actor?.isOwner) return;
    const { spec, node } = target?.dataset ?? {};
    if (!spec || !node) return;
    const bought = await purchaseSpecNode(this.actor, spec, node);
    if (bought) {
      this.#lastNodePurchase = { key: `${spec}.${node}`, at: Date.now() };
      if (Number(CONFIG.REDSTEEL?.specialisations?.[spec]?.nodes?.[node]?.bane) > 0) {
        ui.notifications.info(game.i18n.localize("REDSTEEL.Learn.Specs.Node.pickBane"));
      }
    } else {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Specs.Node.cannotBuy"));
    }
    this.render();
  }

  /**
   * Give a node back in one click, as ranks are (no dialog may open over this
   * screen). Refused while another unlocked node builds on it. A click right
   * after buying the same node is a double click, not a refund.
   *
   * @this {LearnWindow}
   */
  static async _onRefundSpecNode(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.actor?.isOwner) return;
    const { spec, node } = target?.dataset ?? {};
    if (!spec || !node) return;
    const last = this.#lastNodePurchase;
    if (last?.key === `${spec}.${node}` && Date.now() - last.at < DOUBLE_CLICK_MS) return;
    const refunded = await refundSpecNode(this.actor, spec, node);
    if (!refunded) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Specs.Node.refundBlocked"));
    }
    this.render();
  }

  /**
   * GM only: grant or revoke a specialisation's teacher. Once per
   * specialisation (user ruling), unlike a rank's teacher.
   *
   * @this {LearnWindow}
   */
  static async _onToggleSpecTeacher(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!game.user.isGM) return;
    const spec = target?.dataset?.spec;
    if (!spec || !this.actor) return;
    const found = !!this.actor.system?.specialisations?.[spec]?.teacher;
    await setSpecTeacher(this.actor, spec, !found);
    this.render();
  }

  /** Show or hide the work-in-progress specialisations. @this {LearnWindow} */
  static _onToggleSpecWip(event) {
    event.preventDefault();
    this.#specShowWip = !this.#specShowWip;
    this.render();
  }

  /** GM only: switch the Specialisations tab between cards and the list. @this {LearnWindow} */
  static _onToggleSpecView(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    this.#specListView = !this.#specListView;
    this.render();
  }

  /**
   * SPEC ICON EDITOR (temporary): pick a specialisation's card icon with core's
   * FilePicker, as the sheets pick an image. GM only; stored world-wide.
   *
   * @this {LearnWindow}
   */
  static async _onEditSpecIcon(event, target) {
    event.preventDefault();
    // The pencil sits on a card that opens the star sign.
    event.stopPropagation();
    if (!game.user.isGM) return;
    const spec = target?.dataset?.spec;
    if (!spec) return;
    const current =
      specIconOverrides()[spec] || CONFIG.REDSTEEL?.specialisations?.[spec]?.img || "";
    const fp = new FilePicker({
      current,
      type: "image",
      callback: async (path) => {
        await game.settings.set("redsteel", SPEC_ICON_SETTING, {
          ...specIconOverrides(),
          [spec]: path,
        });
        this.render();
      },
    });
    await fp.browse();
    // This screen sits just under the tooltip layer, above every window, so
    // the picker is lifted over it by a class (.rs-learn-icon-picker).
    fp.element?.classList?.add("rs-learn-icon-picker");
  }

  /**
   * SPEC ICON EDITOR (temporary): copy every specialisation's current icon as
   * a ready SPEC_ICONS block, to paste into specialisations.mjs. It is also
   * written to the console, in case the clipboard is refused.
   *
   * @this {LearnWindow}
   */
  static async _onCopySpecIcons(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    const overrides = specIconOverrides();
    const known = CONFIG.REDSTEEL?.specialisations ?? {};
    const lines = Object.keys(known).map(
      (id) => `  ${id}: "${overrides[id] || known[id]?.img || ""}",`,
    );
    const text = `export const SPEC_ICONS = {\n${lines.join("\n")}\n};`;
    console.log(text);
    try {
      await navigator.clipboard.writeText(text);
      ui.notifications.info(game.i18n.localize("REDSTEEL.Learn.Specs.IconEdit.copied"));
    } catch (err) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.Specs.IconEdit.copyFailed"));
    }
  }

  /** @this {LearnWindow} */
  static async _onBuyRank(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const trackId = target?.dataset?.trackId;
    const rank = Number(target?.dataset?.rank);
    if (!trackId || !rank) return;

    const bought = await purchaseRank(this.actor, trackId, rank);
    if (bought) this.#lastPurchase = { trackId, at: Date.now() };
    if (!bought) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Learn.cannotBuy"));
    }
    this.render();
  }

  /**
   * Grant or revoke this track's teacher.
   *
   * GM only: which trainers a character has found is a table fact, and a
   * player handing themselves one would unlock half the price table. Clicking
   * a badge that is already satisfied revokes back to just below it, so the
   * same chip both gives and takes away.
   *
   * @this {LearnWindow}
   */
  static async _onToggleTeacher(event, target) {
    event.preventDefault();
    // The badge is painted over the column's own click target, and a click on
    // it means "this trainer", never "buy this rank".
    event.stopPropagation();
    if (!game.user.isGM) return;
    const trackId = target?.dataset?.trackId;
    const rank = Number(target?.dataset?.rank);
    if (!trackId || !rank) return;

    await setTeacher(
      this.actor,
      trackId,
      rank,
      !hasTeacher(this.actor, trackId, rank),
    );
    this.render();
  }

  /** @this {LearnWindow} */
  static _onOpenPicker(event) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    this.#picking = true;
    this.render();
  }

  /**
   * Read the checkboxes and store the chosen tracks.
   *
   * Read straight off the DOM rather than tracked per click: the picker is a
   * plain list of checkboxes and the only moment that matters is Done.
   *
   * @this {LearnWindow}
   */
  static async _onSavePicker(event) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const boxes = this.element.querySelectorAll(
      ".rs-learn-pick input[type=checkbox]",
    );
    const ids = [];
    for (const box of boxes) {
      if (box.checked && box.dataset.trackId) ids.push(box.dataset.trackId);
    }
    await setTrackedIds(this.actor, this.#tab, ids);
    this.#picking = false;
    this.render();
  }

  /** @this {LearnWindow} */
  static _onCancelPicker(event) {
    event.preventDefault();
    this.#picking = false;
    this.render();
  }

  /**
   * Leave the screen. It has no window frame, so it carries its own close.
   *
   * @this {LearnWindow}
   */
  static _onCloseScreen(event) {
    event.preventDefault();
    this.close();
  }

  /**
   * Give the top rank of a track back, from one click on that rank's own
   * diamond. Refunding is rare, so it carries no confirmation and no tooltip.
   * The only guard is against a double-click on an available diamond, which
   * would otherwise buy the rank and refund it on the second click.
   *
   * @this {LearnWindow}
   */
  static async _onRefundRank(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.actor?.isOwner) return;
    const trackId = target?.dataset?.trackId;
    if (!trackId) return;

    const last = this.#lastPurchase;
    if (last?.trackId === trackId && Date.now() - last.at < DOUBLE_CLICK_MS) {
      return;
    }

    await refundRank(this.actor, trackId);
    this.render();
  }
}

/* -------------------------------------------- */
/*  Entry point                                 */
/* -------------------------------------------- */

/** Open (or focus) the Learn window for one actor. */
export function openLearnWindow(actor) {
  if (!actor) return null;
  const existing = foundry.applications.instances.get(
    `redsteel-learn-${actor.id}`,
  );
  if (existing) {
    existing.bringToFront();
    return existing;
  }
  return new LearnWindow({ actor }).render(true);
}
