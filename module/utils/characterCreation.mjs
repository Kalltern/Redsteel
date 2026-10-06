/**
 * Character Creation window, a full screen in steps:
 *   1. Origin: name, race (and its racial choices), the attribute point buy,
 *      the trait buy.
 *   2. Doctrine: the combat doctrine(s) the character trains in, and one
 *      school of magic for a character with Magic potential. A sub-step of
 *      step 2 ("details", shown as 2.5) then shows the combat skill each
 *      doctrine fights with (the Peltast chooses), asks for the weapon skill
 *      each combat doctrine trains with and, with a school, the magical
 *      doctrine.
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
 * (shown on the sheet and tracked in the Learn window, no ranks bought: points
 * are distributed in step 3), and moves the draft to step 3. The race and the
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
 *                               ("" keeps an empty pick column in place)
 *     spend: {str..per},        points bought on top of the base 1
 *     traits: string[],         compendium ids from TRAIT_PRICES
 *     doctrines: string[],      doctrine keys (system.doctrines), the
 *                               magical one (picked on 2.5) included
 *     school: string|null,      CREATION_SCHOOLS key
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
 *       channeling: boolean } }   whether it made Channeling visible
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
  getTrackTab,
  getWallet,
  isInCreation,
  readItemFeatureCost,
  setTrackedIds,
} from "../helpers/progressionEngine.mjs";
// Import cycle with learnWindow.mjs (it imports this module's creation
// exports): fine, as neither module uses the other's exports at top level.
import { describeRankChips, markAbilityChips, openLearnWindow } from "./learnWindow.mjs";
import { SPEC_ICONS } from "../helpers/specialisations.mjs";
import { TEMPERAMENT_SCHOOLS } from "../helpers/rankDiscounts.mjs";
import { getRaceChoiceGroups } from "./race.mjs";
import { registerTooltip, ttFrame } from "./tooltips.mjs";

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
 * The skill a weapon class is fought with (the sheet's weapon skills; bows and
 * crossbows fall to Archery), as "<group>.<key>" under system.
 */
const WEAPON_CLASS_SKILL = {
  axe: "weaponSkills.axes",
  blunt: "weaponSkills.blunt",
  sword: "weaponSkills.swords",
  polearm: "weaponSkills.polearms",
  bow: "combatSkills.archery",
  crossbow: "combatSkills.archery",
};

/**
 * Ranged doctrines whose weapons are fought with a combat skill, whatever the
 * weapon's class (a thrown axe is still a Throwing weapon).
 */
const DOCTRINE_WEAPON_SKILL = {
  archer: "combatSkills.archery",
  arbalest: "combatSkills.archery",
  peltast: "combatSkills.throwing",
  juggler: "combatSkills.throwing",
};

/** How a weapon can be held (weaponGrip), plus weapons for the off hand only. */
const WEAPON_GRIPS = ["two", "versatile", "one", "offhand"];

/**
 * How each doctrine fights, which decides what its weapons are shown as in
 * the info panel (user ruling 2026-09-30). A weapon's own doctrine flags are
 * not enough on their own: the Two handed flail names Shieldbearer, but a
 * shield leaves one hand free, so a one-handed style never lists two-handed
 * weapons, and a weapon that goes in one hand or both is shown the way the
 * style holds it.
 *   oneHand  one weapon in one hand (a shield or nothing in the other)
 *   dual     a one-handed weapon in each hand
 *   twoHand  both hands on one weapon
 *   ranged   bows and crossbows
 *   thrown   thrown weapons
 *   mixed    anything goes (Rogue)
 * A doctrine not named here is shown as "mixed".
 */
const DOCTRINE_STYLE = {
  shieldbearer: "oneHand",
  duelist: "oneHand",
  dimakerus: "dual",
  reaver: "twoHand",
  pikeman: "twoHand",
  swordsman: "twoHand",
  archer: "ranged",
  arbalest: "ranged",
  peltast: "thrown",
  juggler: "thrown",
  rogue: "mixed",
};

/**
 * Per style: the info panel's weapon groups, in order. Each takes the weapons
 * of the listed grips and shows them under its label
 * (REDSTEEL.Creation.Doctrine.Group.<label>). Grips a style leaves out are
 * not shown at all.
 */
const STYLE_GROUPS = {
  oneHand: [
    { label: "oneChoice", grips: ["one", "versatile"] },
    { label: "offhand", grips: ["offhand"] },
  ],
  dual: [
    { label: "dualChoice", grips: ["one", "versatile"] },
    { label: "offhand", grips: ["offhand"] },
  ],
  twoHand: [
    { label: "twoChoice", grips: ["two"] },
    { label: "bothHands", grips: ["versatile"] },
    { label: "oneChoice", grips: ["one"] },
    { label: "offhand", grips: ["offhand"] },
  ],
  ranged: [{ label: "anyChoice", grips: ["two", "versatile", "one"] }],
  thrown: [{ label: "thrownChoice", grips: ["two", "versatile", "one"] }],
  mixed: [
    { label: "twoChoice", grips: ["two"] },
    { label: "oneChoice", grips: ["versatile", "one"] },
    { label: "offhand", grips: ["offhand"] },
  ],
};

/**
 * How a weapon is held, by the sheet's own reading (actor-sheet.mjs
 * _isEffectivelyTwoHanded): heavy weapons, bows and crossbows need both hands;
 * a weapon with the two-hand grip option goes in one hand or both; the rest
 * in one.
 * @returns {"two"|"versatile"|"one"}
 */
function weaponGrip(system) {
  if (system?.type === "heavy" || ["bow", "crossbow"].includes(system?.class)) return "two";
  if (system?.twoHandGrip) return "versatile";
  return "one";
}

/**
 * The weapon browser's stat lines for one weapon, labelled the way the weapon
 * sheet labels its fields: damage dice and types, Attack, Defense,
 * Penetration, Crit chance, Bleed and Stagger. Zero values are left out.
 * @returns {[string, string][]} label → value
 */
function weaponStats(system) {
  const i18n = game.i18n;
  const field = (key) => i18n.localize(`REDSTEEL.Item.Weapon.FIELDS.${key}.label`);
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const out = [];
  const roll = system?.roll ?? {};
  const dice = Number(roll.diceNum) || 0;
  if (dice) {
    const bonus = String(roll.diceBonus ?? "").trim();
    const extra = bonus && bonus !== "0" ? (/^[-+]/.test(bonus) ? bonus : `+${bonus}`) : "";
    out.push([i18n.localize("REDSTEEL.Creation.Doctrine.damage"), `${dice}d${roll.diceSize}${extra}`]);
  }
  const types = [system?.dmgType1, system?.dmgType2, system?.dmgType3, system?.dmgType4]
    .filter(Boolean)
    .map((type) => {
      const key = `REDSTEEL.Bg3Hotbar.DamageType.${type}`;
      return i18n.has(key, false) ? i18n.localize(key) : type;
    });
  if (types.length) out.push([i18n.localize("REDSTEEL.Creation.Doctrine.damageType"), types.join(", ")]);
  for (const key of ["attack", "defense"]) {
    const n = Number(system?.[key]) || 0;
    if (n) out.push([field(key), `${signed(n)}%`]);
  }
  const penetration = Number(system?.penetration) || 0;
  if (penetration) out.push([field("penetration"), String(penetration)]);
  const crit = Number(system?.critChance) || 0;
  if (crit) out.push([field("critChance"), `${signed(crit)}%`]);
  for (const key of ["bleed", "stagger"]) {
    const n = Number(system?.effects?.[key]) || 0;
    if (n) out.push([field(key), `${n}%`]);
  }
  return out;
}

/**
 * The weapons each doctrine fights with, read from the weapons themselves:
 * a weapon names its doctrines at system.doctrines.<key> (and, for the off
 * hand only, at system.offhandProperties.doctrines.<key>). Per doctrine, the
 * weapons shown in its info panel, grouped the way its style holds them
 * (DOCTRINE_STYLE / STYLE_GROUPS), and the skills those shown weapons are
 * fought with. Each weapon's tooltip goes into FEATURE_TIPS under its id. Run
 * once per session.
 * @param {string[]} keys  the doctrines offered
 * @returns {Promise<Map<string, {skills: string[], groups: {label: string, weapons: object[]}[]}>>}
 */
async function buildDoctrineWeapons(keys) {
  const pack = game.packs.get(FEATURE_PACK_ID);
  let index = null;
  try {
    index = pack
      ? await pack.getIndex({
          fields: [
            "img",
            "system.class",
            "system.type",
            "system.twoHandGrip",
            "system.doctrines",
            "system.offhandProperties.doctrines",
            "system.localizationKey",
            "system.description",
            // The weapon browser's stat block (weaponStats).
            "system.roll",
            "system.attack",
            "system.defense",
            "system.penetration",
            "system.critChance",
            "system.effects",
            "system.dmgType1",
            "system.dmgType2",
            "system.dmgType3",
            "system.dmgType4",
          ],
        })
      : null;
  } catch (err) {
    console.warn(`Redsteel | Creation: could not index ${FEATURE_PACK_ID}`, err);
  }
  const weapons = (index?.contents ?? []).filter((entry) => entry.type === "weapon");
  const lang = game.i18n.lang;
  const skillLabel = (path) => {
    const [group, key] = path.split(".");
    const labelKey = `REDSTEEL.Actor.Character.${group}.${key}.label`;
    return game.i18n.has(labelKey, false) ? game.i18n.localize(labelKey) : key;
  };

  // Every weapon's tooltip, enriched together.
  await Promise.all(
    weapons.map(async (entry) => {
      if (FEATURE_TIPS.has(entry._id)) return;
      const { name, text } = localizedNameAndText(entry);
      FEATURE_TIPS.set(entry._id, { title: name, img: entry.img, description: await enrichText(text) });
    }),
  );

  const out = new Map();
  for (const key of keys) {
    // Every weapon naming this doctrine, with how it can be held.
    const byGrip = Object.fromEntries(WEAPON_GRIPS.map((grip) => [grip, []]));
    for (const entry of weapons) {
      const system = entry.system ?? {};
      const main = !!system.doctrines?.[key];
      const offhand = !main && !!system.offhandProperties?.doctrines?.[key];
      if (!main && !offhand) continue;
      byGrip[offhand ? "offhand" : weaponGrip(system)].push({
        id: entry._id,
        name: FEATURE_TIPS.get(entry._id)?.title ?? entry.name,
        img: entry.img,
        skill: DOCTRINE_WEAPON_SKILL[key] ?? WEAPON_CLASS_SKILL[system.class] ?? null,
        stats: weaponStats(system),
      });
    }
    // The style decides which of them show, and under which heading.
    const groups = (STYLE_GROUPS[DOCTRINE_STYLE[key] ?? "mixed"] ?? STYLE_GROUPS.mixed)
      .map(({ label, grips }) => ({
        label,
        weapons: grips
          .flatMap((grip) => byGrip[grip])
          .sort((a, b) => a.name.localeCompare(b.name, lang)),
      }))
      .filter((group) => group.weapons.length);
    for (const group of groups) {
      for (const weapon of group.weapons) weapon.skillLabel = weapon.skill ? skillLabel(weapon.skill) : "";
    }
    const skills = new Set(
      groups.flatMap((group) => group.weapons.map((w) => w.skillLabel)).filter(Boolean),
    );
    out.set(key, { skills: [...skills].sort((a, b) => a.localeCompare(b, lang)), groups });
  }
  return out;
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

/** The schools of magic step 2 offers (user ruling 2026-10-01). */
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
 * doctrine's Channeling comes with the school.
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
 * that is not fixed, the Peltast's combat skill, or the magical doctrine of a
 * drafted school. Fixed combat skills alone ask nothing.
 */
function draftHasDetails(draft) {
  return (
    !!draft.school ||
    draft.doctrines.includes(COMBAT_SKILL_CHOICE) ||
    weaponDoctrines(draft.doctrines).some((key) => !FIXED_WEAPONS[key])
  );
}

/** The weapon skill a doctrine trains with: fixed, picked, or null. */
function weaponFor(draft, key) {
  return FIXED_WEAPONS[key] ?? draft.weapons[key] ?? null;
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

/**
 * The system's own tooltip root (#rs-tooltip-root in redsteel.css). Like the
 * Learn window, the screen sits just under it and under Foundry's tooltip.
 */
const SYSTEM_TOOLTIP_LAYER = 10000;

const RACE_BY_KEY = new Map(CREATION_RACES.map((entry) => [entry.key, entry]));

const ATTRIBUTE_BONUS_KEY = /^system\.attributes\.(\w+)\.bonus$/;

/** Column marks for the racial choice groups on the attribute rows. */
const ROMAN = ["I", "II", "III", "IV", "V"];

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
    // "" keeps an empty column slot in place (a two-pick group's first
    // column cleared while the second stays).
    return ids.map((id) => (typeof id === "string" ? id : ""));
  });
  for (const k of ATTRIBUTE_KEYS) {
    draft.spend[k] = Math.max(0, Math.floor(Number(raw.spend?.[k]) || 0));
  }
  const traits = Array.isArray(raw.traits) ? raw.traits : Object.values(raw.traits ?? {});
  draft.traits = [...new Set(traits.filter((id) => typeof id === "string" && TRAIT_PRICES[id]))];
  if (typeof raw.school === "string" && CREATION_SCHOOLS.includes(raw.school)) draft.school = raw.school;
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
      pickSchool: CharacterCreationWindow._onPickSchool,
      pickWeapon: CharacterCreationWindow._onPickWeapon,
      pickCombatSkill: CharacterCreationWindow._onPickCombatSkill,
      pickMagicDoctrine: CharacterCreationWindow._onPickMagicDoctrine,
      pageWeapon: CharacterCreationWindow._onPageWeapon,
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
   * {skills, groups: {two, versatile, one, offhand}} (buildDoctrineWeapons).
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
    CACHE.skillLadders ??= buildTrackLadders(Object.keys(SKILL_CARDS));
    CACHE.weapons ??= buildDoctrineWeapons(keys);
    [this.#doctrineLadders, this.#doctrineWeapons, this.#skillLadders] = await Promise.all([
      CACHE.ladders,
      CACHE.weapons,
      CACHE.skillLadders,
    ]);
    return this.#doctrineLadders;
  }

  /**
   * The info panel's opening for one doctrine: what it is about, then its
   * weapon requirements in words (REDSTEEL.Creation.Doctrine.Info.<key>) and
   * the weapon skills its weapons are fought with. "" for a doctrine with no
   * text written.
   */
  #doctrineAboutHtml(key) {
    const i18n = game.i18n;
    const title = (labelKey) =>
      `<h4 class="rs-create-info-subtitle">${escapeHtml(i18n.localize(labelKey))}</h4>`;
    const text = (labelKey) =>
      i18n.has(labelKey, false) ? `<p class="rs-create-doctrine-text">${escapeHtml(i18n.localize(labelKey))}</p>` : "";
    const about = text(`REDSTEEL.Creation.Doctrine.Info.${key}.about`);
    const weapons = text(`REDSTEEL.Creation.Doctrine.Info.${key}.weapons`);
    const skills = this.#doctrineWeapons?.get(key)?.skills ?? [];
    let html = about ? title("REDSTEEL.Creation.Doctrine.about") + about : "";
    if (weapons || skills.length) {
      html += title("REDSTEEL.Creation.Doctrine.requirements") + weapons;
      if (skills.length) {
        html += `<div class="rs-create-skill-chips">${skills
          .map((skill) => `<span class="rs-create-skill-chip">${escapeHtml(skill)}</span>`)
          .join("")}</div>`;
      }
    }
    return html;
  }

  /**
   * The info panel's weapon browser for one doctrine: one weapon at a time
   * (icon, name, how it is held, skill, stats), paged with the arrows, and
   * below it every weapon by name, grouped by how they are held, each one
   * jumping the browser to it (_onPageWeapon). "" when the doctrine names no
   * weapon.
   */
  #doctrineWeaponsHtml(key) {
    const data = this.#doctrineWeapons?.get(key);
    if (!data?.groups.length) return "";
    const i18n = game.i18n;
    const all = data.groups.flatMap(({ label, weapons: list }) => list.map((weapon) => ({ label, weapon })));
    const pages = all
      .map(({ label, weapon }, index) => {
        const facts = [
          ...(weapon.skillLabel ? [[i18n.localize("REDSTEEL.Creation.Doctrine.skill"), weapon.skillLabel]] : []),
          ...weapon.stats,
        ];
        return (
          `<div class="rs-create-weapon-page${index ? "" : " is-current"}" data-index="${index}">` +
          `<div class="rs-create-weapon-head">` +
          `<img class="rs-create-weapon-icon" src="${escapeHtml(weapon.img)}" alt="">` +
          `<div class="rs-create-weapon-name">${escapeHtml(weapon.name)}` +
          `<span class="rs-create-weapon-grip">${escapeHtml(i18n.localize(`REDSTEEL.Creation.Doctrine.Group.${label}`))}</span>` +
          `</div></div>` +
          (facts.length
            ? `<dl class="rs-create-info-facts">${facts
                .map(([dt, dd]) => `<dt>${escapeHtml(dt)}</dt><dd>${escapeHtml(dd)}</dd>`)
                .join("")}</dl>`
            : "") +
          `</div>`
        );
      })
      .join("");
    const step = (dir, icon, labelKey) =>
      `<button type="button" class="rs-create-weapon-step" data-action="pageWeapon" data-step="${dir}" ` +
      `aria-label="${escapeHtml(i18n.localize(labelKey))}" data-tooltip="${escapeHtml(i18n.localize(labelKey))}">` +
      `<i class="fa-solid ${icon}"></i></button>`;
    let index = 0;
    const list = data.groups
      .map(
        ({ label, weapons: group }) =>
          `<div class="rs-create-weapon-group">` +
          `<span class="rs-create-weapon-grip">${escapeHtml(i18n.localize(`REDSTEEL.Creation.Doctrine.Group.${label}`))}</span>` +
          `<div class="rs-create-weapon-index">${group
            .map((weapon) => {
              const i = index++;
              return (
                `<button type="button" class="rs-create-weapon-jump${i ? "" : " is-current"}" data-action="pageWeapon" data-index="${i}">` +
                `<img src="${escapeHtml(weapon.img)}" alt="">${escapeHtml(weapon.name)}</button>`
              );
            })
            .join("")}</div></div>`,
      )
      .join("");
    return (
      `<h4 class="rs-create-info-subtitle">${escapeHtml(i18n.localize("REDSTEEL.Creation.Doctrine.browse"))}</h4>` +
      `<div class="rs-create-weapon-browser" data-count="${all.length}">` +
      `<div class="rs-create-weapon-nav">` +
      step(-1, "fa-chevron-left", "REDSTEEL.Creation.Doctrine.prev") +
      `<span class="rs-create-weapon-count">${escapeHtml(
        i18n.format("REDSTEEL.Creation.Doctrine.page", { n: 1, total: all.length }),
      )}</span>` +
      step(1, "fa-chevron-right", "REDSTEEL.Creation.Doctrine.next") +
      `</div>` +
      pages +
      list +
      `</div>`
    );
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
      limits[k] = entry
        ? entry.limits[k] + limitBumps[k] + (level >= 15 ? 1 : 0)
        : 0;
      totals[k] = 1 + draft.spend[k] + bonus[k];
    }

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

    // The chosen race's choice groups.
    const choiceGroups = state.groups.map((group, index) => {
      const picked = draft.choices[index] ?? [];
      const options = group.effectIds
        .map((id) => {
          const effect = state.doc.effects.get(id);
          if (!effect) return null;
          let label = effect.name;
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
      const groupLabel = i18n.localize(group.label);
      const pick = i18n.format("REDSTEEL.Race.Choices.PickCount", { count: group.count });
      return {
        index,
        numeral: ROMAN[index] ?? String(index + 1),
        label: groupLabel,
        pick,
        tooltip: `${groupLabel} (${pick})`,
        complete: picked.filter((id) => group.effectIds.includes(id)).length === group.count,
        options,
        // Options that raise no attribute have no square to sit in; they
        // keep a row of their own under the attributes.
        loose: options.filter((option) => !option.attr),
      };
    });

    // Square columns: one per pick, so a group taking two (Human extra
    // attribute selection) gets two columns of one pick each. Column `slot`
    // holds draft.choices[group][slot].
    const choiceColumns = choiceGroups.flatMap((group) => {
      const picked = draft.choices[group.index] ?? [];
      const count = state.groups[group.index]?.count ?? 1;
      return Array.from({ length: count }, (_, slot) => ({
        group,
        slot,
        label: count > 1 ? `${group.label} ${ROMAN[slot] ?? slot + 1}` : group.label,
        pick: count > 1 ? i18n.format("REDSTEEL.Race.Choices.PickCount", { count: 1 }) : group.pick,
        chosen: group.options.some((o) => o.id === picked[slot]) ? picked[slot] : null,
        picked,
      }));
    });

    // Attributes. Each row carries one square per pick column: the group's
    // option for this attribute, or an empty cell when it offers none.
    const attributes = ATTRIBUTE_KEYS.map((k) => ({
      key: k,
      label: i18n.localize(CONFIG.REDSTEEL.attributes?.[k] ?? k),
      total: state.totals[k],
      limit: state.limits[k],
      canUp: editable && hasRace && state.remaining > 0 && state.totals[k] < state.limits[k],
      canDown: editable && hasRace && draft.spend[k] > 0,
      // A picked trait raises this attribute's cap (Brawny, Nimble, ...): the
      // row's ribbon then burns bright.
      capRaised: draft.traits.some((id) => TRAIT_PRICES[id]?.raisesLimit === k),
      // A racial pick is on this attribute (the total is then drawn in gold).
      hasChoice: choiceGroups.some((group) =>
        group.options.some((option) => option.attr === k && option.selected),
      ),
      choices: choiceColumns.map((column) => {
        const option = column.group.options.find((o) => o.attr === k) ?? null;
        return {
          group: column.group.index,
          slot: column.slot,
          option,
          selected: !!option && column.chosen === option.id,
          // Picked in the group's other column: clicking here moves it over.
          elsewhere: !!option && column.chosen !== option.id && column.picked.includes(option.id),
          tooltip: option
            ? `${column.label}: ${option.label}${
                option.raisesLimit ? ` · ${i18n.localize("REDSTEEL.Creation.raisesLimit")}` : ""
              }`
            : "",
        };
      }),
    }));
    // The row grid: the name flush left in a flexible track, then − total +
    // and one square column per pick (wide enough for the column's name above
    // it), then a matching flexible spacer so those controls sit centred.
    const attrGrid = `grid-template-columns: minmax(110px, 1fr) 28px 64px 28px${" 84px".repeat(
      choiceColumns.length,
    )} minmax(0, 1fr);`;
    const choiceHeads = choiceColumns.map((column) => ({
      label: column.label,
      pick: column.pick,
      complete: !!column.chosen,
    }));

    // Traits, in three sections, each sorted by name.
    const lang = i18n.lang;
    const traitTile = (trait) => {
      const selected = draft.traits.includes(trait.id);
      const unaffordable =
        !selected && trait.kind === "positive" && trait.cost > state.traitRemaining;
      const full = !selected && state.traitCount >= MAX_TRAITS;
      return {
        id: trait.id,
        kind: trait.kind,
        label: trait.label,
        img: trait.img,
        // Plain cost: a positive trait reads "6", a negative one "-3".
        price: String(trait.cost),
        selected,
        disabled: !editable || !hasRace || unaffordable || full,
      };
    };
    // Left: the traits still to pick, by kind. A picked trait leaves this
    // list for the centre column's picked list.
    const sections = ["positive", "neutral", "negative"].map((kind) => {
      const traits = [...this.#traits.values()]
        .filter((trait) => trait.kind === kind && !draft.traits.includes(trait.id))
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

    // Step 2: the doctrines, in blocks by kind. The magical block offers the
    // schools of magic instead of doctrines (the magical doctrine is picked on
    // 2.5); they need the Magic potential trait (drafted, or already on the
    // character) and stay listed but greyed out without it.
    const step = draft.step;
    const isDetails = step === 2 && draft.stage === "details";
    const magicOpen = this.#hasMagicPotential();
    const doctrineKinds = DOCTRINE_KIND_ORDER.map((kind) => ({
      kind,
      label:
        kind === "magical"
          ? i18n.localize("REDSTEEL.Creation.Doctrine.schoolsHeading")
          : i18n.localize(`REDSTEEL.Learn.Sections.${kind}`),
      needsMagic: kind === "magical" && !magicOpen,
      doctrines:
        kind === "magical"
          ? this.#schoolCards(editable, magicOpen)
          : this.#doctrineKeys()
              .filter((key) => getLearnSection(`doctrines.${key}`) === kind)
              .map((key) => this.#doctrineCard(key, { editable }))
              .sort((a, b) => a.label.localeCompare(b.label, i18n.lang)),
    })).filter((block) => block.doctrines.length);
    // The magical doctrine comes from 2.5, so only combat doctrines count.
    const mainDoctrines = draft.doctrines.filter(
      (key) => key !== COMPANION_DOCTRINE && !isMagicalDoctrine(key),
    );
    const details = isDetails ? this.#buildDetails(editable) : null;

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
      // More than one doctrine besides Rogue: advised against, not blocked.
      doctrineWarning: mainDoctrines.length > 1,
      selectedDoctrines: draft.doctrines.map((key) => this.#doctrineLabel(key)),
      raceOptions,
      subraceOptions,
      raceRequirement,
      choiceGroups,
      hasLooseChoices: choiceGroups.some((group) => group.loose.length),
      attributes,
      attrGrid,
      choiceHeads,
      pointsRemaining: i18n.format("REDSTEEL.Creation.pointsRemaining", {
        remaining: state.remaining,
        budget: state.budget,
      }),
      traitPointsRemaining: i18n.format("REDSTEEL.Creation.traitPointsRemaining", {
        remaining: state.traitRemaining,
        total: state.traitPoints,
      }),
      traitCount: i18n.format("REDSTEEL.Creation.traitCount", {
        count: state.traitCount,
        max: MAX_TRAITS,
      }),
      traitOverspent: state.traitRemaining < 0,
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
        // What the doctrine is and what it fights with first, then the
        // weapon browser, then the ranks.
        head +
          frame(
            this.#doctrineLabel(key),
            meta,
            requirement + this.#doctrineAboutHtml(key) + this.#doctrineWeaponsHtml(key) + path,
          ),
      );
    }

    // Schools (step 2): the name, and what gates it. No rules prose exists
    // for the schools, so none is written here.
    const temperament = this.#temperamentSchool();
    for (const key of CREATION_SCHOOLS) {
      const head =
        `<div class="rs-create-info-crest is-magical">` +
        `<span class="rs-dc-crest is-glyph"><i class="fa-solid ${SCHOOL_GLYPHS[key]}"></i></span></div>`;
      const notes =
        `<p class="rs-create-info-req">${escapeHtml(i18n.localize("REDSTEEL.Creation.Doctrine.needsMagic"))}</p>` +
        (temperament === key
          ? `<p class="rs-create-info-req">${escapeHtml(i18n.localize("REDSTEEL.Creation.Doctrine.temperamentSchool"))}</p>`
          : "");
      map.set(
        `school:${key}`,
        head + frame(this.#schoolLabel(key), escapeHtml(i18n.localize("REDSTEEL.Creation.Doctrine.Kind.magical")), notes),
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
        head + frame(this.#skillLabel(trackId), meta, this.#rankPathHtml(trackId, this.#skillLadders?.get(trackId) ?? [])),
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
    const ladder = this.#skillLadders?.get(trackId) ?? [];
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
      ladder,
      ladderCols: Math.max(1, Math.min(5, ladder.length)),
      selected,
      locked: false,
      fixed: !!fixedText,
      fixedText,
      shut,
      disabled: !editable || !!fixedText || shut,
    };
  }

  /**
   * One doctrine card for the step 2 grid or the 2.5 magical doctrine pick.
   * `action` is the click it carries; `locked` greys it out under a padlock.
   */
  #doctrineCard(key, { editable, action = "toggleDoctrine", selected, locked = false } = {}) {
    const i18n = game.i18n;
    const kind = getLearnSection(`doctrines.${key}`);
    const ladder = this.#doctrineLadders?.get(key) ?? [];
    return {
      key,
      kind,
      action,
      keyAttr: "doctrine",
      info: `doctrine:${key}`,
      label: this.#doctrineLabel(key),
      kindLabel: i18n.localize(`REDSTEEL.Creation.Doctrine.Kind.${kind}`),
      crest: this.#doctrineCrest(key),
      ladder,
      // Ladder columns: one per ability, five at most.
      ladderCols: Math.max(1, Math.min(5, ladder.length)),
      selected: selected ?? this.#draft.doctrines.includes(key),
      locked,
      lockText: locked ? i18n.localize("REDSTEEL.Creation.Doctrine.needsMagic") : "",
      disabled: !editable || locked,
    };
  }

  /**
   * The school cards for step 2's magical block. Without Magic potential all
   * are locked; with a temperament its school is taken and the rest are shut.
   */
  #schoolCards(editable, magicOpen) {
    const i18n = game.i18n;
    const temperament = magicOpen ? this.#temperamentSchool() : null;
    const school = this.#school();
    return CREATION_SCHOOLS.map((key) => {
      const selected = key === school;
      const shut = !!temperament && !selected;
      return {
        key,
        kind: "magical",
        action: "pickSchool",
        keyAttr: "school",
        info: `school:${key}`,
        label: this.#schoolLabel(key),
        kindLabel: i18n.localize("REDSTEEL.Creation.Doctrine.Kind.magical"),
        glyph: SCHOOL_GLYPHS[key],
        ladder: [],
        selected,
        locked: !magicOpen,
        lockText: !magicOpen ? i18n.localize("REDSTEEL.Creation.Doctrine.needsMagic") : "",
        // The temperament's school: taken, and it cannot be put down.
        fixed: selected && !!temperament,
        fixedText: selected && temperament ? i18n.localize("REDSTEEL.Creation.Doctrine.temperamentSchool") : "",
        shut,
        disabled: !editable || !magicOpen || !!temperament,
      };
    });
  }

  /**
   * Step 2.5, one plate of cards in blocks: per combat doctrine that trains
   * with a weapon skill, the four weapon skills (a fixed one taken, the rest
   * greyed out); per doctrine with a combat skill, Combat and Archery the same
   * way (the Peltast chooses); Channeling alone for a school; then the
   * school's magical doctrines.
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
          return this.#skillCard(trackId, {
            owner: key,
            action: "pickWeapon",
            selected: weapon === chosen,
            fixedText:
              fixed === weapon
                ? i18n.format("REDSTEEL.Creation.Details.fixedWeapon", { doctrine, weapon: this.#skillLabel(trackId) })
                : "",
            shut: !!fixed && fixed !== weapon,
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
    const school = this.#school();
    if (school) {
      // A school brings Channeling (applied with it): its one card, taken.
      const trackId = "combatSkills.channeling";
      groups.push({
        label: i18n.format("REDSTEEL.Creation.Details.combatSkillFor", { doctrine: this.#schoolLabel(school) }),
        cards: [
          this.#skillCard(trackId, {
            owner: school,
            action: "",
            selected: true,
            fixedText: i18n.format("REDSTEEL.Creation.Details.fixedChanneling", {
              school: this.#schoolLabel(school),
              skill: this.#skillLabel(trackId),
            }),
            editable,
          }),
        ],
      });
      groups.push({
        label: i18n.format("REDSTEEL.Creation.Details.magicHeading", { school: this.#schoolLabel(school) }),
        cards: this.#doctrineKeys()
          .filter((key) => isMagicalDoctrine(key))
          .map((key) => this.#doctrineCard(key, { editable, action: "pickMagicDoctrine" }))
          .sort((a, b) => a.label.localeCompare(b.label, i18n.lang)),
      });
    }
    return { groups: groups.filter((group) => group.cards.length) };
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
   * The school the character takes: none without Magic potential, the
   * temperament's when there is one, else the drafted pick.
   */
  #school() {
    if (!this.#hasMagicPotential()) return null;
    return this.#temperamentSchool() ?? this.#draft.school;
  }

  /**
   * Bring the draft's school and magical doctrine in line before step 2 is
   * left: the school as #school() reads it, no magical doctrine without one,
   * and at most one with it. Weapon picks for doctrines no longer drafted go,
   * and so does the Peltast's combat skill without the Peltast.
   */
  #settleMagic() {
    const draft = this.#draft;
    draft.school = this.#school();
    const magical = draft.doctrines.filter((key) => isMagicalDoctrine(key));
    const keep = draft.school ? magical.slice(0, 1) : [];
    draft.doctrines = draft.doctrines.filter((key) => !isMagicalDoctrine(key) || keep.includes(key));
    const asked = new Set(weaponDoctrines(draft.doctrines).filter((key) => !FIXED_WEAPONS[key]));
    draft.weapons = Object.fromEntries(Object.entries(draft.weapons).filter(([key]) => asked.has(key)));
    if (!draft.doctrines.includes(COMBAT_SKILL_CHOICE)) draft.combatSkill = null;
  }

  /** What 2.5 still lacks, as true when something is unanswered. */
  #detailsIncomplete() {
    const draft = this.#draft;
    if (weaponDoctrines(draft.doctrines).some((key) => !weaponFor(draft, key))) return true;
    if (draft.doctrines.includes(COMBAT_SKILL_CHOICE) && !draft.combatSkill) return true;
    if (this.#school() && !draft.doctrines.some((key) => isMagicalDoctrine(key))) return true;
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
    const slotAttr = Number(el?.dataset.slot);

    if (Number.isInteger(slotAttr) && slotAttr >= 0 && slotAttr < group.count) {
      // A square in pick column `slot`: that column holds exactly one pick.
      const picked = Array.from({ length: group.count }, (_, i) => {
        const id = choices[index]?.[i];
        return group.effectIds.includes(id) ? id : "";
      });
      if (picked[slotAttr] === effectId) {
        picked[slotAttr] = "";
      } else {
        // Already the other column's pick: it moves here.
        for (let i = 0; i < picked.length; i++) if (picked[i] === effectId) picked[i] = "";
        picked[slotAttr] = effectId;
      }
      choices[index] = picked;
    } else {
      // A loose option (no attribute column): toggle, oldest pick gives way.
      let picked = (choices[index] ?? []).filter((id) => group.effectIds.includes(id));
      if (picked.includes(effectId)) {
        picked = picked.filter((id) => id !== effectId);
      } else {
        picked.push(effectId);
        while (picked.length > group.count) picked.shift();
      }
      choices[index] = picked;
    }
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
    if (!state.entry || state.remaining <= 0 || state.totals[k] >= state.limits[k]) return;
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
      // Taking back a negative trait takes back the points it gave.
      if (price.cost < 0 && state.traitRemaining + price.cost < 0) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Creation.Warn.negativeRemove"));
        return;
      }
      this.#draft.traits = traits.filter((t) => t !== id);
    } else {
      if (traits.length >= MAX_TRAITS) {
        ui.notifications.warn(
          game.i18n.format("REDSTEEL.Creation.Warn.traitLimit", { max: MAX_TRAITS }),
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
        this.#draft.school = null;
      }
      this.#draft.stage = "doctrines";
    }
    this.#draft.step += 1;
    this.#info = null;
    await this.#commit();
  }

  /**
   * Take or drop a doctrine. Any number may be taken (the screen advises one,
   * Rogue aside); a magical one only with Magic potential.
   * @this {CharacterCreationWindow}
   */
  static async _onToggleDoctrine(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const key = target?.closest?.("[data-doctrine]")?.dataset.doctrine;
    if (!key || !this.#doctrineKeys().includes(key)) return;
    // The magical doctrine is picked on 2.5 (_onPickMagicDoctrine).
    if (isMagicalDoctrine(key)) return;
    this.#info = `doctrine:${key}`;
    const doctrines = this.#draft.doctrines;
    if (doctrines.includes(key)) {
      this.#draft.doctrines = doctrines.filter((k) => k !== key);
    } else {
      if (getLearnSection(`doctrines.${key}`) === "magical" && !this.#hasMagicPotential()) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Creation.Doctrine.needsMagic"));
        return;
      }
      this.#draft.doctrines = [...doctrines, key];
    }
    await this.#commit();
  }

  /**
   * Take a school (exactly one: another replaces it, the taken one clears).
   * A temperament's school cannot be changed.
   * @this {CharacterCreationWindow}
   */
  static async _onPickSchool(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const key = target?.closest?.("[data-school]")?.dataset.school;
    if (!CREATION_SCHOOLS.includes(key)) return;
    this.#info = `school:${key}`;
    if (!this.#hasMagicPotential()) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Creation.Doctrine.needsMagic"));
      return;
    }
    if (this.#temperamentSchool()) return;
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

  /** 2.5: the one magical doctrine of the school. @this {CharacterCreationWindow} */
  static async _onPickMagicDoctrine(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner || !this.#school()) return;
    const key = target?.closest?.("[data-doctrine]")?.dataset.doctrine;
    if (!key || !isMagicalDoctrine(key) || !this.#doctrineKeys().includes(key)) return;
    this.#info = `doctrine:${key}`;
    this.#draft.doctrines = [...this.#draft.doctrines.filter((k) => !isMagicalDoctrine(k)), key];
    await this.#commit();
  }

  /**
   * The info panel's weapon browser: page by an arrow (data-step, wrapping
   * round) or jump to a weapon by name (data-index). Only the panel's DOM
   * changes, so nothing re-renders and the panel keeps its scroll.
   * @this {CharacterCreationWindow}
   */
  static _onPageWeapon(event, target) {
    event.preventDefault();
    const browser = target?.closest?.(".rs-create-weapon-browser");
    const count = Number(browser?.dataset.count) || 0;
    if (!count) return;
    const current = Number(browser.querySelector(".rs-create-weapon-page.is-current")?.dataset.index) || 0;
    const index =
      target.dataset.index !== undefined
        ? Number(target.dataset.index)
        : (current + Number(target.dataset.step) + count) % count;
    if (!Number.isInteger(index) || index < 0 || index >= count) return;
    for (const el of browser.querySelectorAll(".rs-create-weapon-page, .rs-create-weapon-jump")) {
      el.classList.toggle("is-current", Number(el.dataset.index) === index);
    }
    const label = browser.querySelector(".rs-create-weapon-count");
    if (label) label.textContent = game.i18n.format("REDSTEEL.Creation.Doctrine.page", { n: index + 1, total: count });
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
    // aborts with the character untouched.
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
    const traitData = await Promise.all(draft.traits.map((id) => featureCopyData(id)));
    const missing = draft.traits.find((id, i) => !traitData[i]);
    if (missing) {
      return warn("REDSTEEL.Creation.Warn.traitMissing", {
        name: this.#traits?.get(missing)?.label ?? TRAIT_PRICES[missing]?.name ?? missing,
      });
    }

    // Everything creation wrote carries this flag, so a later apply (Back,
    // then Next again) finds and replaces it.
    const markOrigin = (data) => {
      data.flags = data.flags ?? {};
      data.flags.redsteel = { ...(data.flags.redsteel ?? {}), creationOrigin: true };
      return data;
    };
    markOrigin(raceData);
    for (const data of traitData) markOrigin(data);

    // 1. The old race, and whatever a previous apply wrote, go in one call.
    const oldIds = actor.items.contents
      .filter((i) => i.type === "race" || i.getFlag("redsteel", "creationOrigin"))
      .map((i) => i.id);
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
    // Doctrines a previous apply showed that are no longer drafted go hidden
    // again, unless a rank was bought in them since.
    const unranked = (group, key) => (Number(actor.system?.[group]?.[key]?.value) || 0) === 0;
    const dropped = (previous?.doctrines ?? []).filter(
      (key) => !draft.doctrines.includes(key) && unranked("doctrines", key),
    );
    // The school, Channeling with it, the weapon skills the doctrines train
    // with and the combat skills they fight with: shown and tracked, no rank
    // bought. Whatever a previous
    // apply showed that is no longer chosen goes the same way as a doctrine.
    const school = draft.school;
    const schools = school ? [school] : [];
    const weapons = [
      ...new Set(weaponDoctrines(draft.doctrines).map((key) => weaponFor(draft, key)).filter(Boolean)),
    ];
    const channeling = !!school;
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
    };
    for (const k of ATTRIBUTE_KEYS) {
      update[`system.attributes.${k}.value`] = 1 + draft.spend[k];
    }
    // The chosen doctrines join the character's skills: shown on the sheet
    // (no rank bought, points are distributed in step 3).
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
    const addedIds = [
      ...draft.doctrines.map((key) => `doctrines.${key}`),
      ...schools.map((key) => `schools.${key}`),
      ...(channeling ? ["combatSkills.channeling"] : []),
      ...weapons.map((key) => `weaponSkills.${key}`),
      ...combatSkills.map((key) => `combatSkills.${key}`),
    ];
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

    // 6. On to step 3: the Learn window, on the Combat tab.
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
