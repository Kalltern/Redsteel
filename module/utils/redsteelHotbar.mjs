/**
 * The Redsteel hotbar: the system's own bar, in the shape of Baldur's Gate 3's.
 *
 * On by default, per client (`redsteel.bg3Hotbar`, reload required). Turning it
 * off hands the bottom of the screen back to Foundry's standard hotbar. The
 * `bg3` naming throughout is historical and kept only so the stored setting and
 * user flags keep resolving.
 * When enabled the core `#hotbar` element is hidden with CSS — the core Hotbar
 * application itself stays instantiated so the 1..0 number-key macro
 * keybindings keep firing against hotbar page 1.
 *
 * Layout, bottom to top:
 *
 *   [ portrait ]   ATTRIBUTES      (7 primaries + 5 rollable secondaries)
 *   [ circular ]   SKILL CHECKS    (10 favourite slots, stored on the actor)
 *   [ HP ring  ]   MACRO ROW 2     (hotbar page 2)      [+] / [-]
 *   [ on LEFT  ]   MACRO ROW 1     (hotbar page 1)
 *
 * Nothing here re-implements the roll maths: attribute and skill cells carry
 * the exact same dataset the character sheet templates use and are handed to
 * `RedsteelActorSheet._onRoll`, so panel rolls are identical to sheet rolls
 * (margin of success, crit shift, Desperate Effort, advantage tagging, trait
 * pills, the clickable versus-Test line and the Herbalism/Survival prompt).
 */

import { RedsteelActorSheet } from "../sheets/actor-sheet.mjs";
import { getActorBaneTags } from "./baneCombat.mjs";
import { postSpeedTest } from "./speedTest.mjs";
import { registerTooltip, ttEscape, ttFrame } from "./tooltips.mjs";
import {
  getRollModifierState,
  openModifierDialog,
} from "./rollModifier.mjs";

const SETTING = "bg3Hotbar";
const TEAM_HEALTH_SETTING = "bg3HotbarTeamHealth";
const BODY_CLASS = "redsteel-bg3-hotbar";
const ROWS_FLAG = "bg3HotbarRows";
const SKILL_ROWS_FLAG = "bg3HotbarSkillRows";
/* Replaces the old bg3HotbarCondFolded, which is dead: the tray always carries
   its numbers now, and the chip beside them switches what is being counted
   rather than whether it is spelled out. A new key rather than a reused one,
   since a stored `true` meant "folded" and would land its owner in the armor
   view for no reason they could see. */
const ARMOR_VIEW_FLAG = "bg3HotbarArmorView";
const CAPACITY_SETTING = "bg3HotbarCapacity";
const SLIM_CHAT_SETTING = "bg3SlimChat";
const TUCK_PLAYERS_FLAG = "bg3PlayersTucked";
const FAVOURITES_FLAG = "favouriteSkills";

/** Favourites are laid out five to a row, one row until you expand it. */
const FAVOURITES_PER_ROW = 5;
const MIN_SKILL_ROWS = 1;
const MAX_SKILL_ROWS = 4;
const DEFAULT_SKILL_ROWS = 1;
/**
 * Slots are always stored at the full capacity, however many rows are on show.
 * Collapsing the row count only hides the tail, so nothing is lost and the
 * picker still knows which skills are spoken for.
 */
const FAVOURITE_SLOTS = MAX_SKILL_ROWS * FAVOURITES_PER_ROW;

/**
 * How long the panel holds its redraw after any portrait is clicked. Windows'
 * own double-click threshold is 500ms, so anything shorter would let a
 * deliberate double-click redraw the panel before its second click arrives.
 */
const PORTRAIT_HOLD_MS = 500;

/**
 * How long a portrait's sheet stays claimed after it has been opened. Both
 * halves of a double-click can reach `#openPortraitSheet`, and this is what
 * keeps the pair from rendering the same sheet twice in one gesture.
 */
const SHEET_OPEN_DEDUPE_MS = 400;

/**
 * How many sockets an empty potion belt draws. One full row of the four-wide
 * grid: enough for the tray to have a shape, few enough that it does not read
 * as a promise of sixteen slots the character does not have.
 */
const EMPTY_POTION_SLOTS = 4;

/**
 * How many condition icons fit in one column of the right-wing tray, which is
 * what the template counts columns off. Stated rather than measured, and it has
 * to agree with the CSS: the tray's content box is 144px tall (--rs-bg3-res-h
 * less the frame's padding and border and the tray's own), and six 20px icons
 * at the 3px gap is 135px. A seventh would be 158px and spill.
 *
 * The count exists because a wrapping flex container's intrinsic width is
 * computed as though every item sat on one line, so the strip cannot size
 * itself — see the note on .rs-bg3-status-strip.
 */
const STATUS_PER_COLUMN = 6;

const SLOTS_PER_ROW = 10;
// Zero is a real setting: the action row covers what the preset macros did, so
// the macro pages stay out of the way until someone asks for them.
const MIN_ROWS = 0;
const MAX_ROWS = 5; // Foundry has exactly 5 hotbar pages of 10 slots.
const DEFAULT_ROWS = 0;

/** Primary attributes, in sheet order. */
const PRIMARY_ATTRIBUTES = ["str", "dex", "end", "int", "wil", "cha", "per"];

/**
 * Rollable secondary attributes. `vis` and `ini` are deliberately excluded —
 * neither has a roll on the character sheet.
 */
const SECONDARY_ATTRIBUTES = ["spd", "lck", "res", "fth", "sin"];

/**
 * The sheet's colour scheme only names the seven primaries, so each secondary
 * borrows the tint of the primary it belongs with: Speed with Dexterity, Luck
 * with Charisma, Resolve with Will, Faith with Perception, Sinfulness with
 * Strength.
 */
const SECONDARY_TINTS = {
  spd: "dex",
  lck: "cha",
  res: "wil",
  fth: "per",
  sin: "str",
};

/**
 * Roll formulas copied verbatim from `templates/actor/header.hbs`. `spd` has no
 * formula: Speed Tests are d12 + Initiative + Speed and go through
 * `postSpeedTest` instead (same as the sheet's `rollSpeed` action).
 */
const SECONDARY_ROLLS = {
  spd: null,
  lck: "(@secondaryAttributes.lck.total*5)+50-1d100",
  res: "(@secondaryAttributes.res.total*10)-1d100",
  fth: "(@secondaryAttributes.fth.total*8)-1d100",
  sin: "(@secondaryAttributes.res.total*10)-(@secondaryAttributes.sin.total*3)-1d100",
};

/**
 * The success chance behind each secondary roll, i.e. the constant half of the
 * matching entry in SECONDARY_ROLLS. Keep the two in step. `spd` returns null:
 * a Speed Test is d12 + Initiative + Speed and has no percentage.
 */
function secondaryChance(actor, key) {
  const sec = actor.system?.secondaryAttributes ?? {};
  const t = (k) => Number(sec[k]?.total ?? 0);
  switch (key) {
    case "lck":
      return t("lck") * 5 + 50;
    case "res":
      return t("res") * 10;
    case "fth":
      return t("fth") * 8;
    case "sin":
      return t("res") * 10 - t("sin") * 3;
    default:
      return null;
  }
}

/**
 * The flat half of a speed test: Speed + Initiative, the part of
 * `1d12 + ini + spd` that does not depend on the die (see utils/speedTest.mjs).
 * This is what the panel's Speed cell prints, since that cell is the button
 * that rolls the test. Prone / Downed flatten the test to 1, but that is a
 * property of the roll rather than of the character, so it is not folded in
 * here — the status strip already says the creature is on the floor.
 */
function speedTestBonus(actor) {
  const sec = actor?.system?.secondaryAttributes ?? {};
  return Number(sec.spd?.total ?? 0) + Number(sec.ini?.total ?? 0);
}

/**
 * Resource bars beside the portrait. Health is not here: it owns the ring.
 *
 * `when` mirrors the character sheet's own visibility guard for each bar
 * (templates/actor/header.hbs) so a pool shows in exactly the same cases, with
 * a `max > 0` fallback because NPC pools are authored by hand rather than
 * derived from specialisations.
 */
/**
 * The action row: the preset hotbar macros as first-class buttons, so the macro
 * rows can stay hidden unless someone actually wants them. Each `api` name is
 * the same `game.redsteel` entry point the matching preset macro calls, so
 * these and the macros cannot drift apart.
 */
const ACTION_BUTTONS = [
  // GM tools first, and set apart in the row. They lead rather than close it so
  // that the far end belongs to Delay and End Turn, which is where the turn
  // controls read best and where they are hardest to hit by accident.
  { key: "rest", api: "longRest", icon: "fa-light fa-moon", gmOnly: true },
  {
    key: "effects",
    api: "statusEffectManager",
    icon: "fa-light fa-folder-bookmark",
    gmOnly: true,
  },
  { key: "attack", api: "attackActions", icon: "fa-light fa-sword" },
  { key: "defense", api: "defenseRoll", icon: "fa-light fa-shield" },
  // A fist: martial and unmistakably not the sword or the shield beside it.
  { key: "ability", api: "combatAbilities", icon: "fa-light fa-hand-fist" },
  { key: "channeling", api: "castSpell", icon: "fa-light fa-sparkles" },
  { key: "firstAid", api: "firstAid", icon: "fa-light fa-staff-snake" },
];

/**
 * The damage types carrying resistance / vulnerability / immunity booleans in
 * `system.armor`, in the order template.json declares them. Read for the NPC
 * tag row; the same table combatSkillBonuses applies damage against.
 */
const DAMAGE_TYPES = [
  "physical",
  "slash",
  "pierce",
  "blunt",
  "acid",
  "fire",
  "frost",
  "lightning",
  "magic",
  "dark",
  "poison",
  "holy",
];

/**
 * `system.effectMods` immunities: effects rather than damage types, but they
 * belong in the same "cannot be" group on the tag row.
 */
const EFFECT_MOD_TYPES = ["stagger", "bleed", "poison"];

/**
 * The damage types that also carry an armor value (`value`/`bonus`/`total`) as
 * well as the booleans. The other four — physical, slash, pierce, blunt — are
 * flags only, so there is no number to show for them. `natural` is left out on
 * purpose: it feeds `armor.total`, which the condition strip already reports,
 * and this group is for the typed armor that is easy to miss.
 */
const ARMOR_VALUE_TYPES = [
  "acid",
  "fire",
  "frost",
  "lightning",
  "magic",
  "dark",
  "poison",
  "holy",
];

/**
 * Resource bars beside the portrait. Health is not here: it owns the ring, and
 * toxicity floods the portrait, which leaves the column at four.
 *
 * `when` decides whether the character has the pool at all. There is
 * deliberately no "show it if it has a maximum" fallback: NPC pools ship with a
 * max of 900 whether the creature casts or not, so that rule handed every NPC a
 * full set of bars.
 *
 * Array order is left-to-right in the strip, so **stamina goes last**: it is
 * the one pool every character has, and putting it at the tail pins it to the
 * same column against the bar frame no matter which of the conditional pools
 * are present. The rest have no meaningful order between them.
 */
const STRIP_RESOURCES = [
  { key: "mana", when: (sys) => !!sys.magicPotential },
  { key: "holyEnergy", when: (sys) => !!sys.priest },
  {
    // Characters earn a blood pool through the Blood School; NPCs get a flag
    // ticked on their sheet, the same way they get Mage and Priest.
    key: "bloodPool",
    when: (sys) =>
      !!sys.bloodMage ||
      !!sys.specialisations?.bloodSchool?.nodes?.apprentice ||
      (sys.schools?.blood?.value ?? 0) > 0,
  },
  { key: "stamina" },
];

/**
 * The character sheet's condition row, mirrored into the panel's status row.
 * Icons and colours are copied verbatim from templates/actor/header.hbs so the
 * two read as the same set of stats, in the sheet's own order.
 *
 * `relevant` is what makes an icon glow: the state is worth your attention
 * right now. Armor and detection have none, they are steady numbers rather
 * than conditions. `derived` entries read straight off system and have no max.
 *
 * `hide` drops a readout the character has nothing to say about — an unwounded,
 * unfatigued, uncorrupted character carries five zeroes, and five zeroes in a
 * row are five things to look past to reach the two numbers that matter. What
 * is left is what is actually going on. Armor and detection have no `hide`:
 * they are always worth reading, and without them the tray could empty out
 * entirely and collapse the row.
 */
const CONDITIONS = [
  {
    key: "graveWounds",
    icon: "fa-light fa-bone-break",
    colour: "rgb(102, 32, 29)",
    relevant: (s) => s.value > 0,
    hide: (s) => s.value <= 0,
  },
  {
    key: "mind",
    icon: "fa-light fa-head-side-brain",
    colour: "rgb(116, 119, 126)",
    relevant: (s) => s.value < s.max,
    // Mind counts down rather than up, so a full one is the quiet state.
    hide: (s) => s.value >= s.max,
  },
  {
    key: "insanity",
    icon: "fa-light fa-hurricane",
    colour: "rgb(104, 40, 73)",
    relevant: (s) => s.max > 0 && s.value > s.max / 2,
    hide: (s) => s.value <= 0,
  },
  {
    key: "corruption",
    icon: "fa-sharp fa-thin fa-galaxy",
    colour: "rgb(70, 35, 118)",
    relevant: (s) => s.value > 0,
    hide: (s) => s.value <= 0,
  },
  {
    key: "fatigue",
    icon: "fa-light fa-tent",
    colour: "rgb(58, 68, 84)",
    relevant: (s) => s.value > 0,
    hide: (s) => s.value <= 0,
  },
  {
    key: "detection",
    icon: "fa-light fa-eye",
    colour: "rgb(116, 119, 126)",
    derived: (sys) => sys.detection,
  },
  // Movement allowance, 1:1 with Speed, and the reason the Speed cell in the
  // attribute row is free to print the speed-test total instead. Read off
  // `spd.total`, so Slow / Root / Haste / Flight are already in the number.
  // No `hide`: a creature that cannot move is exactly when you want to see 0.
  {
    key: "movement",
    icon: "fa-sharp fa-thin fa-foot-wing",
    colour: "rgb(86, 121, 149)",
    derived: (sys) => sys.secondaryAttributes?.spd?.total,
  },
];

/**
 * The plain armor total. It heads the armor view rather than sitting among the
 * conditions, where it was the one steady number in a row of things that had
 * just changed. Always rendered, so the armor view has something to say about
 * a character with no elemental armor at all.
 */
const ARMOR_BASE = {
  key: "armor",
  icon: "fa-light fa-shield-quartered",
  colour: "rgb(96, 74, 48)",
};

/**
 * The other reading of the same tray: armor by damage type. Icons and colours
 * are the NPC sheet's armor row from templates/actor/header.hbs, so a creature
 * reads the same on the panel as it does on its own sheet.
 *
 * Totals, not the sheet's editable `value`: gear counts, and the total is the
 * number a hit is actually measured against. A type the character has no armor
 * against is dropped, so what is left is what a hit of that kind runs into.
 *
 * The acid flask is duotone on the sheet, with a dark body and a lighter
 * liquid; here it takes the liquid's colour, since a single flat colour at
 * 17px is all the tray has room to say.
 */
const ARMOR_TYPES = [
  { key: "acid", icon: "fa-duotone fa-light fa-flask", colour: "rgb(80, 107, 41)" },
  { key: "fire", icon: "fa-sharp fa-light fa-fire", colour: "rgb(123, 83, 30)" },
  { key: "frost", icon: "fa-solid fa-snowflake", colour: "rgb(46, 70, 92)" },
  {
    key: "lightning",
    icon: "fa-light fa-bolt-lightning",
    colour: "rgb(109, 93, 38)",
  },
  {
    key: "poison",
    icon: "fa-solid fa-skull-crossbones",
    colour: "rgb(61, 89, 86)",
  },
  { key: "dark", icon: "fa-sharp fa-thin fa-galaxy", colour: "rgb(44, 0, 172)" },
  { key: "holy", icon: "fa-regular fa-sun", colour: "rgb(105, 105, 105)" },
  { key: "magic", icon: "fa-sharp fa-light fa-sparkle", colour: "rgb(0, 68, 124)" },
];

/**
 * Waterline height in a circle, as a fraction of its diameter, for a given
 * fraction of the circle's *area*.
 *
 * Filling a circle to a quarter of its height covers far less than a quarter of
 * its area, so mapping a percentage straight to a height makes a pool look
 * emptier than it is at exactly the moment you are squinting at it. Newton on
 * the circular-segment area gets the honest height instead; the derivative of
 * the segment area works out to 2*sqrt(1-y^2), which keeps this to a few
 * iterations.
 *
 * Only the toxicity flood needs this. The resource bars are rectangles, where
 * filled height and filled area are the same thing.
 *
 * @param {number} fraction  Filled area, 0..1.
 * @returns {number}         Waterline height, 0..1 of the diameter.
 */
function circleFillHeight(fraction) {
  if (!(fraction > 0)) return 0;
  if (fraction >= 1) return 1;

  const target = fraction * Math.PI;
  let y = 0; // chord offset from the centre, -1 (empty) .. 1 (full)
  for (let i = 0; i < 12; i++) {
    const root = Math.sqrt(Math.max(1 - y * y, 1e-9));
    const area = y * root + Math.asin(Math.clamp(y, -1, 1)) + Math.PI / 2;
    const step = (area - target) / (2 * root);
    y = Math.clamp(y - step, -1, 1);
    if (Math.abs(step) < 1e-6) break;
  }
  return (y + 1) / 2;
}

/**
 * The panel's own stat tooltip: the thing's name and its current value, and
 * nothing else. The sheet's `stat` tooltip carries the rules text and a note
 * link, which is more than a bar or an icon you are glancing at mid-combat
 * needs. Used by the resource columns and the condition rows alike.
 *
 * Where a resource palette exists, the name takes that colour, keyed off the
 * same `data-rs-res` attribute that paints the column.
 */
/**
 * The absorb shields and retaliation auras, as a ring around the portrait.
 * They are mutually exclusive (see SHIELD exclusivity in effects.mjs), so at
 * most one is ever showing. `b` is the second band an elemental ward gets.
 */
const SHIELD_AURAS = {
  shield_physical: { a: "#c8a24a" },
  shield_magic: { a: "#5aa8e0" },
  shield_elemental: { a: "#c8a24a", elemental: true },
  flame_shield: { a: "#c8a24a", b: "#d4622a" },
  lightning_shield: { a: "#c8a24a", b: "#e0d05a" },
};

/** Second band colours for an elemental ward, by the element it was set to. */
const ELEMENT_COLOURS = {
  fire: "#d4622a",
  frost: "#6fc4dc",
  lightning: "#e0d05a",
  acid: "#6faa3a",
  poison: "#6faa3a",
};

/** Neutral band for an actor with no player and no creature-type tag. */
const NO_PLAYER_COLOUR = "#8a8272";

/**
 * The metal band's colour by creature type, for an actor no player has
 * claimed — which in practice means every NPC on the party row.
 *
 * Keyed off the Bane tag registry (`BANE_TYPES`), so anything already tagged
 * for Bane purposes is coloured with no extra bookkeeping. Most tags get
 * their own colour; only the mortal ancestries share one.
 *
 * **Order is precedence.** A zombie wolf carries both `undead` and `beast`;
 * the more supernatural read wins, so the list runs from most to least.
 *
 * The mortal ancestries (human, dwarf, halfling, elf, argos, avesan, yormun,
 * seraphar, cambion — every tag on the `shadow` Bane tree) are deliberately
 * absent: they fall through to `NO_PLAYER_COLOUR`, the tarnished steel the
 * panel has always used, so a person looks like a person.
 *
 * These are inputs, not painted values. The frame mixes each one 55% into
 * `#0a0a09` (see `.rs-bg3-portrait-frame` in css/redsteel.css), so what you
 * pick is not what you see. Saturating one to make it "pop" only turns it to
 * mud after the mix, and two colours that look distinct in a picker can land
 * on top of each other once darkened. **Check a replacement by computing the
 * mix, not by eye** — an early draft put corrupt and draconic close enough to
 * be one colour at band size.
 *
 * Sixteen bands is a lot for a dark, low-saturation ring, and five of them
 * are reds. The set below was searched for the widest minimum separation
 * (redmean distance 38.6, necrophage against draconic) rather than picked
 * hue by hue, so **changing one value in isolation will usually collide with
 * a neighbour.** Re-run the search instead. Painted bands land between #10
 * and #76 per channel.
 */
const RACE_BANDS = [
  { colour: "#7FA8B5", tags: ["specter"] }, //         pale cold grey-blue
  { colour: "#141118", tags: ["undead"] }, //                  near-black
  { colour: "#6B4E8C", tags: ["vampire"] }, //                     violet
  { colour: "#7E2A2E", tags: ["necrophage"] }, //         dark blood red
  { colour: "#CE5820", tags: ["demon"] }, //                        ember
  { colour: "#A83A2E", tags: ["draconic"] }, //                     brick
  { colour: "#B4527E", tags: ["corrupt"] }, //                    bruised
  { colour: "#B08A8E", tags: ["lycanthrope"] }, //           silvered red
  { colour: "#4E8578", tags: ["relict"] }, //                   verdigris
  { colour: "#4A6FA5", tags: ["magical"] }, //                arcane blue
  { colour: "#4A9E4A", tags: ["sylvan"] }, //                vivid green
  { colour: "#3E6B4A", tags: ["orcoid"] }, //               forest green
  { colour: "#9A8028", tags: ["insectoid"] }, //         chitinous olive
  { colour: "#84582E", tags: ["ogroid"] }, //                     brown
  { colour: "#7A6A55", tags: ["beast"] }, //                      taupe
];

/**
 * The band colour for an actor's creature type, or null for an untagged
 * actor or a mortal ancestry. Tags in `RACE_BANDS` are written in the same
 * normalized form `getActorBaneTags` returns (lowercase, no diacritics).
 */
function raceColourFor(actor) {
  const tags = getActorBaneTags(actor);
  if (!tags.size) return null;
  for (const band of RACE_BANDS) {
    if (band.tags.some((tag) => tags.has(tag))) return band.colour;
  }
  return null;
}

/**
 * The colour of the portrait's metal band: whose character it is, or failing
 * that, what it is.
 *
 * The player colour is keyed off who has the actor assigned, not off who is
 * looking at it: a GM selecting a player's token should see that player's
 * colour, not their own. A non-GM owner wins, so an actor a GM also has
 * assigned still bands in the player's colour.
 *
 * Only when nobody has claimed the actor does creature type get a say, so a
 * PC never loses their own colour to their ancestry. An unclaimed actor with
 * no creature-type tag keeps the neutral steel rather than borrowing one.
 */
function playerColourFor(actor) {
  if (!actor) return NO_PLAYER_COLOUR;
  const owners = game.users.contents.filter(
    (user) => user.character?.id === actor.id,
  );
  const owner = owners.find((user) => !user.isGM) ?? owners[0];
  if (owner) return owner.color?.css ?? owner.color ?? NO_PLAYER_COLOUR;
  return raceColourFor(actor) ?? NO_PLAYER_COLOUR;
}

/**
 * The Health Estimate module's wording for how hurt an actor looks, or null.
 *
 * Its API works off a placeable token, so a character with nobody on the scene
 * has no estimate. Both of the module's own visibility gates are honoured, so
 * whatever the GM has configured there governs here too rather than the panel
 * quietly becoming a second way to read the party's health.
 */
function healthEstimate(actor) {
  const he = game.healthEstimate;
  if (!game.modules.get("healthEstimate")?.active || !he) return null;

  const token = actor?.getActiveTokens?.()?.[0];
  if (!token) return null;

  try {
    if (he.breakOverlayRender?.(token) || he.hideEstimate?.(token)) return null;

    const fraction = Number(he.getFraction(token));
    const { estimate } = he.getStage(token, fraction) ?? {};
    if (!estimate) return null;
    if (he.isDead?.(token, estimate.value)) {
      return he.deathStateName || estimate.label || null;
    }
    return estimate.label || null;
  } catch (err) {
    console.warn("Redsteel | Health Estimate lookup failed", err);
    return null;
  }
}

/** The first of these keys the lang files actually carry, or null. */
function localizeFirst(...keys) {
  for (const key of keys) {
    const text = game.i18n.localize(key);
    if (text && text !== key) return text;
  }
  return null;
}

function registerPanelStatTooltip() {
  registerTooltip("bg3Stat", ({ id, dataset }) => {
    if (!id) return null;

    // The three key shapes: pools live under `stats`, armor and detection
    // under `Condition`, and the tray's armor view asks for damage types,
    // which the panel already names for the NPC tag row. Foundry hands back
    // the key itself when it has no entry, which is what makes the fallback
    // detectable. Damage types come last so nothing that already had a name
    // can be shadowed by one.
    const name = localizeFirst(
      `REDSTEEL.Actor.Character.stats.${id}.value.label`,
      `REDSTEEL.Actor.Character.Condition.${id}`,
      `REDSTEEL.Bg3Hotbar.DamageType.${id}`,
    );

    return `<div class="rs-bg3-tip" data-rs-res="${ttEscape(id)}">
      <span class="rs-bg3-tip-name">${ttEscape(name ?? id)}</span>
      <span class="rs-bg3-tip-value">${ttEscape(dataset.ttCurrent ?? "")}</span>
    </div>`;
  });
}

/**
 * The NPC tag row's race and feature tags: hovering one reads out what it
 * actually does.
 *
 * A tag carries the item's uuid rather than its id, so this resolves without
 * the panel having to hand the provider an actor. `localizedDescription` and
 * not `system.description`, because the packs store the English prose on the
 * document and the Czech under the localization key — the same rule the tag's
 * name already follows. The prose is HTML from the editor, so it goes in
 * unescaped exactly as the shared `item` provider does; only the fallback,
 * which is plain text, is escaped.
 */
function registerNpcTagTooltip() {
  registerTooltip("bg3NpcTag", ({ dataset }) => {
    if (!dataset.ttUuid) return null;

    let item = null;
    try {
      item = fromUuidSync(dataset.ttUuid);
    } catch (err) {
      item = null;
    }
    if (!item) return null;

    // An emptied editor leaves "<p></p>" behind rather than "", so the test for
    // "has a description" has to be on the text, not on the markup.
    const desc = String(item.localizedDescription ?? "");
    const hasText = !!desc
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    const body = hasText
      ? desc
      : ttEscape(game.i18n.localize("REDSTEEL.Bg3Hotbar.NoDescription"));

    return ttFrame({
      title: item.localizedName ?? item.name,
      img: item.img,
      body: `<div class="tt-desc">${body}</div>`,
    });
  });
}

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/**
 * Right-click has its own meaning on every slot here (clear the slot), so the
 * left-click actions bail out if a future ApplicationV2 build ever routes
 * contextmenu events through the same `data-action` dispatch.
 */
function isRightClick(event) {
  return event?.type === "contextmenu" || event?.button === 2;
}

/**
 * The placeable token an actor is standing on in the current scene, or null.
 *
 * An unlinked token's actor is synthetic and owns exactly one token, which
 * `getActiveTokens` does not reliably speak for, so that case is read off the
 * actor's own TokenDocument instead.
 */
function tokenForActor(actor) {
  if (!actor) return null;
  if (actor.isToken) return actor.token?.object ?? null;
  return actor.getActiveTokens(false, false)?.[0] ?? null;
}

/**
 * The key codes that target a hovered portrait: whatever core's Target keybind
 * is set to, so rebinding it on the canvas rebinds it here too. Bindings that
 * carry a modifier are dropped, since shift here already means "add to targets",
 * and T stands in if core has nothing to say.
 */
function targetKeyCodes() {
  const bound = game.keybindings?.get?.("core", "target") ?? [];
  const keys = bound
    .filter((binding) => !binding?.modifiers?.length)
    .map((binding) => binding?.key)
    .filter(Boolean);
  return keys.length ? keys : ["KeyT"];
}

/** Localize a key through one of the CONFIG.REDSTEEL label maps. */
function fromMap(map, key, fallback = key.toUpperCase()) {
  const path = map?.[key];
  return path ? game.i18n.localize(path) : fallback;
}


/** The localized display name of a skill key. */
function skillLabel(key) {
  return game.i18n.localize(`REDSTEEL.Actor.Character.skills.${key}.label`);
}

/**
 * Read the actor's favourite-skill slots as a padded array of 10 entries,
 * each either a skill key string or null.
 */
function readFavourites(actor) {
  const raw = actor?.getFlag("redsteel", FAVOURITES_FLAG);
  const list = Array.isArray(raw) ? raw.slice(0, FAVOURITE_SLOTS) : [];
  while (list.length < FAVOURITE_SLOTS) list.push(null);
  return list.map((key) => (typeof key === "string" && key ? key : null));
}

/**
 * Resolve the sheet instance used as the `this` context for `_onRoll`.
 *
 * `Document#sheet` is a lazy getter: it constructs the sheet without rendering
 * it. If a world has swapped the actor sheet for something else we fall back to
 * a detached RedsteelActorSheet so `evaluateCriticalSuccess` still exists.
 */
function getRollSheet(actor) {
  const sheet = actor.sheet;
  if (typeof sheet?.evaluateCriticalSuccess === "function") return sheet;
  return new RedsteelActorSheet({ document: actor });
}

/**
 * Run the character sheet's roll handler against a detached element carrying
 * the dataset a sheet cell would have had.
 */
function dispatchSheetRoll(actor, dataset, event) {
  const el = document.createElement("div");
  Object.assign(el.dataset, dataset);
  return RedsteelActorSheet._onRoll.call(getRollSheet(actor), event, el);
}

/**
 * Skill picker. Lists every skill the actor has, sorted by localized name,
 * with a live text filter. Keys already parked in another favourite slot are
 * shown greyed out and cannot be chosen.
 *
 * @returns {Promise<string|null>} The chosen skill key, or null.
 */
async function promptForSkill(actor, favourites, index) {
  const skills = actor.system?.skills ?? {};
  const taken = new Set(favourites.filter((k, i) => k && i !== index));

  const rows = Object.keys(skills)
    .map((key) => ({
      key,
      label: skillLabel(key),
      rating: Number(skills[key]?.rating ?? 0),
      disabled: taken.has(key),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang))
    .map(
      (s) => `
        <label class="rs-bg3-pick-row${s.disabled ? " disabled" : ""}"
               data-skill-name="${s.label.toLowerCase()}">
          <input type="radio" name="rs-bg3-skill" value="${s.key}" ${
            s.disabled ? "disabled" : ""
          }>
          <span class="rs-bg3-pick-name">${s.label}</span>
          <span class="rs-bg3-pick-rating">${s.rating}</span>
        </label>`,
    )
    .join("");

  const DialogV2 = foundry.applications.api.DialogV2;
  const chosen = await DialogV2.wait({
    window: { title: game.i18n.localize("REDSTEEL.Bg3Hotbar.PickerTitle") },
    classes: ["redsteel", "rs-bg3-skill-picker"],
    content: `
      <form>
        <input type="text" name="rs-bg3-filter" autocomplete="off"
               placeholder="${game.i18n.localize("REDSTEEL.Bg3Hotbar.PickerSearch")}">
        <div class="rs-bg3-pick-list">${rows}</div>
      </form>`,
    // Clicking a row picks and submits, and the window's own close button
    // cancels, so the footer is redundant and is hidden in CSS. DialogV2 still
    // needs one button to submit through, which is what the row click drives.
    buttons: [
      {
        action: "select",
        label: game.i18n.localize("REDSTEEL.Bg3Hotbar.PickSkill"),
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? button.form;
          return (
            root.querySelector('input[name="rs-bg3-skill"]:checked')?.value ??
            null
          );
        },
      },
    ],
    // V12 hands the HTMLDialogElement here, later versions the application —
    // accept either.
    render: (_event, dialog) => {
      const root = dialog instanceof HTMLElement ? dialog : dialog?.element;
      if (!root) return;

      const filter = root.querySelector('input[name="rs-bg3-filter"]');
      const listRows = root.querySelectorAll(".rs-bg3-pick-row");
      filter?.focus();
      filter?.addEventListener("input", () => {
        const needle = filter.value.trim().toLowerCase();
        for (const row of listRows) {
          const hit = !needle || row.dataset.skillName?.includes(needle);
          row.classList.toggle("hidden", !hit);
        }
      });

      // One click on a row picks it and submits. A <label> click also forwards
      // a synthetic click to its radio, so guard against submitting twice.
      let submitted = false;
      for (const row of listRows) {
        row.addEventListener("click", () => {
          if (submitted || row.classList.contains("disabled")) return;
          const radio = row.querySelector("input[type=radio]");
          if (!radio) return;
          radio.checked = true;
          const confirm = root.querySelector('button[data-action="select"]');
          if (!confirm) return; // fall back to the Select button below the list
          submitted = true;
          confirm.click();
        });
      }
    },
    rejectClose: false,
  });

  if (!chosen || chosen === "cancel") return null;
  return chosen;
}

/**
 * Bar settings, opened from the wrench in the corner. Everything about the
 * shape of the panel lives here rather than as controls scattered along its
 * edge, so the bar itself stays given over to what you actually click in play.
 *
 * @returns {Promise<{skillRows: number, macroRows: number}|null>}
 */
async function promptForBarSettings({ skillRows, macroRows }) {
  const label = (key) => game.i18n.localize(`REDSTEEL.Bg3Hotbar.${key}`);

  // A stepper rather than a number field: the ranges are tiny, so clicking an
  // arrow beats selecting a digit and typing over it.
  const field = (name, value, min, max, hint) => `
    <div class="rs-bg3-set-row">
      <label>${label(hint)}</label>
      <div class="rs-bg3-stepper" data-min="${min}" data-max="${max}">
        <button type="button" class="rs-bg3-step" data-step="-1"
                aria-label="&minus;"><i class="fas fa-chevron-down"></i></button>
        <span class="rs-bg3-step-value">${value}</span>
        <button type="button" class="rs-bg3-step" data-step="1"
                aria-label="+"><i class="fas fa-chevron-up"></i></button>
        <input type="hidden" name="${name}" value="${value}">
      </div>
    </div>`;

  const DialogV2 = foundry.applications.api.DialogV2;
  const result = await DialogV2.wait({
    window: { title: label("SettingsTitle"), icon: "fas fa-wrench" },
    classes: ["redsteel", "rs-bg3-bar-settings"],
    content: `
      <form>
        ${field("skillRows", skillRows, MIN_SKILL_ROWS, MAX_SKILL_ROWS, "SkillRows")}
        ${field("macroRows", macroRows, MIN_ROWS, MAX_ROWS, "MacroRows")}
      </form>`,
    buttons: [
      {
        action: "save",
        label: label("SettingsSave"),
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? button.form;
          const read = (name, min, max, fallback) => {
            const raw = Number(root.querySelector(`[name="${name}"]`)?.value);
            if (!Number.isFinite(raw)) return fallback;
            return Math.clamp(Math.round(raw), min, max);
          };
          return {
            skillRows: read(
              "skillRows",
              MIN_SKILL_ROWS,
              MAX_SKILL_ROWS,
              skillRows,
            ),
            macroRows: read("macroRows", MIN_ROWS, MAX_ROWS, macroRows),
          };
        },
      },
      { action: "cancel", label: game.i18n.localize("Cancel") },
    ],
    render: (_event, dialog) => {
      const root = dialog instanceof HTMLElement ? dialog : dialog?.element;
      if (!root) return;

      for (const stepper of root.querySelectorAll(".rs-bg3-stepper")) {
        const min = Number(stepper.dataset.min);
        const max = Number(stepper.dataset.max);
        const input = stepper.querySelector("input");
        const display = stepper.querySelector(".rs-bg3-step-value");

        const apply = (next) => {
          const clamped = Math.clamp(next, min, max);
          input.value = String(clamped);
          display.textContent = String(clamped);
          for (const button of stepper.querySelectorAll(".rs-bg3-step")) {
            const step = Number(button.dataset.step);
            button.disabled = clamped + step < min || clamped + step > max;
          }
        };

        for (const button of stepper.querySelectorAll(".rs-bg3-step")) {
          button.addEventListener("click", () => {
            apply(Number(input.value) + Number(button.dataset.step));
          });
        }
        apply(Number(input.value));
      }
    },
    rejectClose: false,
  });

  return result && result !== "cancel" ? result : null;
}

/* -------------------------------------------- */
/*  The panel                                   */
/* -------------------------------------------- */

export class Bg3Hotbar extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  constructor(options = {}) {
    super(options);
    this.#rerender = foundry.utils.debounce(() => this.#renderUnheld(), 100);
    // Bound copies so the delegated listeners can be removed again on re-render
    // (private methods themselves are not writable).
    this.#boundContextMenu = this.#onContextMenu.bind(this);
    this.#boundClick = this.#onClick.bind(this);
    this.#boundDblClick = this.#onDblClick.bind(this);
    this.#boundResourceEdit = this.#onResourceEdit.bind(this);
    this.#boundDragStart = this.#onDragStart.bind(this);
    this.#boundDragOver = this.#onDragOver.bind(this);
    this.#boundDrop = this.#onDrop.bind(this);
    this.#boundCanvasPointerUp = this.#onCanvasPointerUp.bind(this);
    this.#boundPointerOver = this.#onPointerOver.bind(this);
    this.#boundPointerLeave = this.#onPointerLeave.bind(this);
    this.#boundKeyDown = this.#onKeyDown.bind(this);
  }

  static DEFAULT_OPTIONS = {
    id: "redsteel-bg3-hotbar",
    classes: ["redsteel", "redsteel-bg3-hotbar"],
    window: { frame: false, positioned: false },
    actions: {
      rollAttribute: this._onRollAttribute,
      rollSkill: this._onRollSkill,
      pickSkill: this._onPickSkill,
      clearSkill: this._onClearSkill,
      executeMacro: this._onExecuteMacro,
      runAction: this._onRunAction,
      openSettings: this._onOpenSettings,
      editEffect: this._onEditEffect,
      openRollModifier: this._onOpenRollModifier,
      toggleWeaponSets: this._onToggleWeaponSets,
      togglePotions: this._onTogglePotions,
      usePotionItem: this._onUsePotionItem,
      pickWeaponSet: this._onPickWeaponSet,
      toggleTrayView: this._onToggleTrayView,
      toggleAutoDefense: this._onToggleAutoDefense,
    },
  };

  static PARTS = {
    main: { template: "systems/redsteel/templates/hotbar/redsteel-hotbar.hbs" },
  };

  /** Debounced re-render, shared by every hook below. */
  #rerender;

  /** Registered hook ids, torn down in `_onClose`. */
  #hooks = [];

  /** Bound delegated DOM listeners. */
  #boundContextMenu;
  #boundClick;
  #boundDblClick;
  #boundResourceEdit;
  #boundDragStart;
  #boundDragOver;
  #boundDrop;
  #boundCanvasPointerUp;
  #boundPointerOver;
  #boundPointerLeave;
  #boundKeyDown;

  /** The board element the deselect listener is on, so `_onClose` can undo it. */
  #board = null;

  /**
   * The character whose portrait the cursor is over, for the target key. Kept as
   * a uuid rather than the element so it survives a re-render replacing the
   * node the cursor happens to be resting on.
   */
  #hoveredPortraitUuid = null;

  /**
   * The actor whose portrait the current gesture started on. Whichever half of
   * a double-click gets through names this actor rather than whatever frame the
   * cursor ended up over, which may belong to somebody else once the row has
   * reshuffled.
   */
  #lastPortraitUuid = null;

  /** The sheet opened by the gesture in progress, and until when it counts. */
  #lastSheetOpen = { uuid: null, until: 0 };

  /**
   * While this is in the future the panel does not redraw. Any redraw between
   * the two clicks of a double-click replaces the frame the first one landed
   * on: the browser is then pairing clicks made on two different nodes, which
   * it may report against the panel root or decline to pair at all (no sheet),
   * and clicking a teammate reshuffles the row on top of that, so the second
   * click can fall through to the canvas as well (lost selection).
   *
   * So the redraw waits out the double-click window. Controlling the token is
   * not held back, so the canvas still answers the first click at once.
   */
  #portraitHoldUntil = 0;

  /** The pending held redraw, so a second click does not queue a second one. */
  #heldRenderTimer = null;

  /**
   * The actor picked by clicking a portrait, which outranks the usual binding
   * until the canvas selection moves elsewhere. Not persisted: a reload should
   * put everyone back on their own character.
   */
  #pinnedUuid = null;

  /* -------------------------------------------- */

  /**
   * The actor the attribute and skill rows describe: a portrait the user
   * clicked, otherwise their assigned character, otherwise whatever token they
   * have selected, otherwise null.
   *
   * The pin comes first because it is the only one of the three the user states
   * outright. It is dropped as soon as it stops resolving — a pinned actor can
   * be deleted, and a token actor's uuid is scene-bound, so it dies when the
   * scene changes.
   */
  get actor() {
    if (this.#pinnedUuid) {
      const pinned = fromUuidSync(this.#pinnedUuid);
      if (pinned?.isOwner) return pinned;
      this.#pinnedUuid = null;
    }
    return (
      game.user.character ?? canvas.tokens?.controlled?.[0]?.actor ?? null
    );
  }

  /**
   * Render, unless a portrait double-click window is still open, in which case
   * the whole redraw waits for it. Every hook in this class renders through
   * `#rerender`, so holding it here holds all of them.
   */
  #renderUnheld() {
    const wait = this.#portraitHoldUntil - Date.now();
    clearTimeout(this.#heldRenderTimer);
    if (wait > 0) {
      this.#heldRenderTimer = setTimeout(() => this.render(), wait + 10);
      return;
    }
    this.render();
  }

  /**
   * Bind the panel to a clicked portrait. Ownership is required: driving the
   * bar means rolling and spending resources, which a non-owner cannot do.
   */
  #pinActor(actor) {
    if (!actor?.isOwner) return false;
    this.#pinnedUuid = actor.uuid;
    return true;
  }

  /** How many macro rows this user wants (1..5). One until they press `+`. */
  get rowCount() {
    const raw = Number(game.user.getFlag("redsteel", ROWS_FLAG) ?? DEFAULT_ROWS);
    if (!Number.isFinite(raw)) return DEFAULT_ROWS;
    return Math.clamp(Math.round(raw), MIN_ROWS, MAX_ROWS);
  }

  /**
   * Whether the status-row tray is showing armor by damage type rather than
   * the character's conditions. Conditions by default: that is the reading you
   * want every round, where the armor breakdown is something you check once
   * when you meet a creature and then remember.
   */
  get armorView() {
    return !!game.user.getFlag("redsteel", ARMOR_VIEW_FLAG);
  }

  /** How many favourite-skill rows are on show (1..4). */
  get skillRowCount() {
    const raw = Number(
      game.user.getFlag("redsteel", SKILL_ROWS_FLAG) ?? DEFAULT_SKILL_ROWS,
    );
    if (!Number.isFinite(raw)) return DEFAULT_SKILL_ROWS;
    return Math.clamp(Math.round(raw), MIN_SKILL_ROWS, MAX_SKILL_ROWS);
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * Park the panel in the bottom UI, directly above the (hidden) core hotbar.
   * V14 signature: `_insertElement(element, options?)`. Deliberately does not
   * call super, which would append to `#interface`.
   */
  async _insertElement(element, _options) {
    const uiBottom = document.getElementById("ui-bottom");
    const hotbar = document.getElementById("hotbar");

    if (uiBottom && hotbar && hotbar.parentElement === uiBottom) {
      uiBottom.insertBefore(element, hotbar);
    } else if (hotbar?.parentElement) {
      hotbar.parentElement.insertBefore(element, hotbar);
    } else if (uiBottom) {
      uiBottom.append(element);
    } else {
      console.warn(
        "Redsteel |",
        "Neither #ui-bottom nor #hotbar were found — appending the BG3 hotbar to the document body.",
      );
      document.body.append(element);
    }
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const attributes = this.#prepareAttributes(actor);
    // NPCs carry only spd, ini and res, so the secondary group can come back
    // shorter than the character list. hasAttributes covers an empty pair.
    const statuses = this.#prepareStatuses(actor);

    return Object.assign(context, {
      hasActor: !!actor,
      isOwner: !!actor?.isOwner,
      // Stamped on the panel root so the system's tooltip framework can resolve
      // the actor for its `attribute` / `secondaryAttribute` / `skill` providers
      // exactly as it does from a sheet (see resolveActor in tooltips.mjs).
      actorUuid: actor?.uuid ?? "",
      showCapacity: game.settings.get("redsteel", CAPACITY_SETTING),
      // The colour of whoever owns this character, so a GM following a token
      // sees that player's band rather than their own.
      playerColour: playerColourFor(actor),
      // A die rather than a silhouette: with nothing bound, the panel is not
      // showing an anonymous character, it is showing no character at all.
      // Teammate portraits keep the silhouette, where it does mean "this
      // actor has no art".
      portraitImg: actor?.img ?? "icons/svg/d20-black.svg",
      portraitName: actor?.name ?? game.i18n.localize("REDSTEEL.Bg3Hotbar.NoActor"),
      statuses,
      // The width of the right-wing strip, in columns. Never zero: with no
      // conditions up the box still draws, one column wide, holding the empty
      // glyph.
      statusCols: Math.max(1, Math.ceil(statuses.length / STATUS_PER_COLUMN)),
      modifier: this.#prepareModifier(actor),
      // NPC-only, and only for whoever can write to it: `autoDefends` in
      // autoDefense.mjs refuses anything that is not an NPC, so offering the
      // switch on a character would be a button that does nothing.
      autoDefense: {
        available: actor?.type === "npc" && !!actor.isOwner,
        // "On unless switched off", matching `autoDefends` in autoDefense.mjs.
        // An NPC predating the field has no key stored, and it still defends.
        active: actor?.system?.autoDefense !== false,
      },
      weaponSets: this.#prepareWeaponSets(actor),
      potions: this.#preparePotions(actor),
      editableResources: this.#prepareEditableResources(actor),
      hp: this.#prepareHealth(actor),
      toxicity: this.#prepareToxicity(actor),
      aura: this.#prepareAura(actor),
      actions: ACTION_BUTTONS.filter((a) => !a.gmOnly || game.user.isGM).map(
        (a, i, all) => ({
          ...a,
          label: game.i18n.localize(`REDSTEEL.Bg3Hotbar.Action.${a.key}`),
          // A gap at the boundary between the GM tools and the abilities, so
          // the two sets read apart. Written as a boundary test rather than
          // "before the first GM tool" so it survives the order changing, and
          // so a player, who sees no GM tools at all, gets no stray gap.
          groupStart: i > 0 && !!a.gmOnly !== !!all[i - 1].gmOnly,
        }),
      ),
      resourceBars: this.#prepareResourceBars(actor),
      // One tray, two readings on a character and both at once on an NPC. The
      // flag is per user rather than per actor, so a player who switched to
      // armor stays there as the panel rebinds.
      trayRows: this.#prepareTrayRows(actor),
      armorView: this.armorView,
      // No chip on an NPC: with both readings already in the tray there is
      // nothing behind it.
      showTrayToggle: !!actor && actor.type !== "npc",
      teammates: this.#prepareTeammates(actor),
      attributes,
      hasAttributes: !!(attributes.primary.length || attributes.secondary.length),
      npcTags: this.#prepareNpcTags(actor),
      skillRows: this.#prepareSkills(actor),
      hasSkills: !!actor && !!actor.system?.skills,
      macroRows: this.#prepareMacroRows(),
    });
  }

  /**
   * The other connected players who have a character assigned, rendered as
   * small portraits to the left of yours.
   *
   * A GM always sees the party's health; they can read it off the tokens
   * anyway. For everyone else it is off unless the GM turns the world setting
   * on, because whether players can read each other's HP at a glance is a table
   * rule rather than a personal preference.
   */
  #prepareTeammates(actor) {
    const showRing =
      game.user.isGM || game.settings.get("redsteel", TEAM_HEALTH_SETTING);

    // Connected players first, then anything flagged into the party: a
    // companion, a mount, a combat pet, or a PC whose player is not logged in.
    //
    // Keyed on uuid, not id. An unlinked token's actor is synthetic and borrows
    // the base actor's id, so two zombies dragged from the same sheet would
    // collapse into one entry, and selecting either would hide both. Their
    // uuids differ (Scene.x.Token.y.Actor.z), and a linked token's actor *is*
    // the world actor, so uuid still dedupes that case correctly.
    const members = [];
    const seen = new Set();
    const add = (mate, sortKey) => {
      if (!mate || mate.uuid === actor?.uuid || seen.has(mate.uuid)) return;
      seen.add(mate.uuid);
      members.push({ mate, sortKey });
    };

    for (const user of game.users.contents) {
      if (user.active && user.id !== game.user.id) add(user.character, `0${user.name}`);
    }
    // Your own character, but only while the panel is bound to something else:
    // `add` drops it when it is the bound actor. Without this, clicking a
    // companion's portrait would strand you there with nothing to click back to.
    add(game.user.character, `0${game.user.name}`);
    for (const candidate of game.actors.contents) {
      if (candidate.system?.partyMember) add(candidate, `1${candidate.name}`);
    }

    // Tokens on the scene as well as the world directory. An NPC dragged onto a
    // scene is normally *unlinked*, so ticking "party member" on the token's
    // sheet writes to the token's ActorDelta and never touches the world actor
    // — which is why flagged NPCs were not turning up here at all.
    //
    // `.contents`, not the Collection: iterating one directly with for...of has
    // silently yielded nothing in this codebase before.
    for (const tokenDoc of canvas?.scene?.tokens?.contents ?? []) {
      // A hidden token is off the canvas for players; listing it in the roster
      // would announce a companion the GM has deliberately not revealed.
      if (tokenDoc.hidden && !game.user.isGM) continue;
      const candidate = tokenDoc.actor;
      if (candidate?.system?.partyMember) add(candidate, `1${candidate.name}`);
    }

    return members
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey, game.i18n.lang))
      .map(({ mate }) => ({
        uuid: mate.uuid,
        img: mate.img ?? "icons/svg/mystery-man.svg",
        name: mate.name,
        colour: playerColourFor(mate),
        showRing,
        hp: this.#prepareHealth(mate),
        // How hurt they look, if Health Estimate can say. Falls back to the
        // open-sheet hint so the portrait is never silent on hover.
        tip: healthEstimate(mate) ?? "REDSTEEL.Bg3Hotbar.OpenSheet",
      }));
  }

  /**
   * Everything the portrait says about the character beyond health: the shield
   * ring around it, the corruption bleeding inward, and the two temporary
   * health pools sitting over it.
   */
  #prepareAura(actor) {
    const sys = actor?.system;
    if (!sys) return null;

    // Blood Shield is absent from the exclusivity table, so it can be up
    // alongside one of the others and gets its own outer ring.
    let bloodShield = false;

    // At most one of the rest can be up, so the first match is the answer.
    let shield = null;
    for (const effect of actor.appliedEffects ?? actor.effects ?? []) {
      if (effect.statuses?.has("blood_shield")) bloodShield = true;
      if (shield) continue;

      for (const id of Object.keys(SHIELD_AURAS)) {
        if (!effect.statuses?.has(id)) continue;
        const def = SHIELD_AURAS[id];
        let b = def.b ?? null;
        if (def.elemental) {
          // The element is chosen per cast and lives on the effect, not in the
          // config default (see the Config tab's element picker).
          const types = effect.getFlag("redsteel", "shield")?.matchTypes ?? [];
          b = ELEMENT_COLOURS[types[0]] ?? null;
        }
        shield = { id, a: def.a, b };
        break;
      }
    }

    // Degree drives the glow rather than the raw number, so it steps with the
    // tiers the rules already use (31 / 61 / 91) instead of creeping.
    const degree = Math.clamp(Number(sys.corruptionDegree ?? 0), 0, 3);

    const temp = Number(sys.stats?.temporaryHealth?.value ?? 0);
    const tempMagic = Number(sys.stats?.temporaryHealthMagic?.value ?? 0);

    return {
      shield,
      bloodShield,
      // Explicit per tier rather than a formula: degree 3 is meant to look
      // consumed, so the top step goes all the way rather than to 0.86.
      corruption:
        degree > 0 ? { degree, opacity: [0, 0.55, 0.8, 1][degree] } : null,
      temp: temp > 0 ? temp : null,
      tempMagic: tempMagic > 0 ? tempMagic : null,
    };
  }

  /**
   * Toxicity floods the portrait from the bottom like a bulb filling with
   * water, reaching the top at the character's ceiling. Same area correction as
   * the orbs, because the portrait is a circle too: a waterline at a quarter of
   * its height covers nowhere near a quarter of the face.
   */
  #prepareToxicity(actor) {
    const stat = actor?.system?.stats?.toxicity;
    if (!stat) return null;

    const value = Number(stat.value ?? 0);
    const max = Number(stat.max ?? 0);
    if (max <= 0) return null;

    const fraction = Math.clamp(value / max, 0, 1);
    return {
      value,
      max,
      fill: Math.round(circleFillHeight(fraction) * 1000) / 10,
      any: value > 0,
    };
  }

  /**
   * Every pool this character actually has, apart from health, as a vertical
   * bar. One bar fills the strip's height on its own, so a character with only
   * stamina does not get a lone token floating in an empty box.
   */
  #prepareResourceBars(actor) {
    const sys = actor?.system;
    const stats = sys?.stats;
    if (!sys || !stats) return [];

    const bars = [];
    for (const { key, when } of STRIP_RESOURCES) {
      const stat = stats[key];
      if (!stat) continue;
      if (when && !when(sys)) continue;

      const max = Number(stat.max ?? 0);
      const value = Number(stat.value ?? 0);
      const fraction = max > 0 ? Math.clamp(value / max, 0, 1) : 0;
      // A rectangle's filled height is its filled area, so this is the raw
      // percentage. No tag: the colour and the tooltip say which pool it is.
      bars.push({
        key,
        value,
        max,
        fill: Math.round(fraction * 1000) / 10,
      });
    }
    return bars;
  }

  /**
   * The sheet's condition row as a run of readouts for the status-row tray,
   * with a rule between every two of them rather than only at the sheet's group
   * boundaries: once the quiet ones drop out, whichever are left are a set of
   * unrelated numbers and each wants its own compartment.
   *
   * Skipped: anything the actor does not carry (an NPC has mind and detection
   * but none of the status group) and anything its own `hide` calls quiet.
   */
  #prepareConditions(actor) {
    const sys = actor?.system;
    if (!sys) return [];

    const out = [];
    for (const entry of CONDITIONS) {
      let row;

      if (entry.derived) {
        const value = entry.derived(sys);
        if (value === undefined || value === null) continue;
        row = { ...entry, value: Number(value) || 0, ratio: false };
      } else {
        const stat = sys.stats?.[entry.key];
        if (!stat) continue;
        const value = Number(stat.value ?? 0);
        const max = Number(stat.max ?? 0);
        if (entry.hide?.({ value, max })) continue;
        row = {
          ...entry,
          value,
          max,
          ratio: true,
          relevant: !!entry.relevant?.({ value, max }),
        };
      }

      if (out.length) out.push({ divider: true });
      out.push(row);
    }
    return out;
  }

  /**
   * The tray's other reading: armor by damage type, in the same row shape the
   * conditions use so the two are interchangeable in the template.
   *
   * The plain total leads, then the eight types, each only if it has something
   * to say. Nothing here is `relevant`: armor is a steady number, and a glow
   * would be claiming a threshold the rules do not have.
   */
  #prepareArmorRows(actor) {
    const armor = actor?.system?.armor;
    if (!armor) return [];

    const out = [{ ...ARMOR_BASE, value: Number(armor.total) || 0, ratio: false }];

    for (const entry of ARMOR_TYPES) {
      const total = Number(armor[entry.key]?.total ?? 0);
      if (!total) continue;
      out.push({ divider: true });
      out.push({ ...entry, value: total, ratio: false });
    }
    return out;
  }

  /**
   * What the status-row tray is showing, for whichever kind of actor is bound.
   *
   * A character gets one reading at a time, because a player is watching their
   * own conditions change round by round and the armor breakdown is something
   * they already know; the chip switches between the two.
   *
   * An NPC gets both at once and no chip. A GM reads an NPC to answer one
   * question — what happens if I hit it with this — and the answer is spread
   * across both halves. There is no round-by-round watching to protect, most
   * of the condition half is missing on an NPC anyway, and a per-user switch
   * would be at odds with clicking through a dozen tokens in a turn.
   */
  #prepareTrayRows(actor) {
    if (!actor) return [];
    if (actor.type !== "npc") {
      return this.armorView
        ? this.#prepareArmorRows(actor)
        : this.#prepareConditions(actor);
    }

    const conditions = this.#prepareConditions(actor);
    const armor = this.#prepareArmorRows(actor);
    if (!conditions.length) return armor;
    if (!armor.length) return conditions;
    return [...conditions, { divider: true }, ...armor];
  }

  /**
   * The status conditions on the character: the token statuses, not every
   * Active Effect it happens to carry. A condition is an effect with a status
   * id on it, which is how the rest of the system finds them too (see
   * customConditions.mjs).
   *
   * `appliedEffects` rather than `effects` so an item-granted condition shows,
   * but only ones the actor itself owns can be managed: the rest live on an
   * item and have to be dealt with there. Adding is deliberately not offered.
   */
  #prepareStatuses(actor) {
    if (!actor) return [];
    const list = actor.appliedEffects ?? actor.effects?.contents ?? [];

    return list
      .filter((effect) => effect.statuses?.size)
      .map((effect) => ({
        uuid: effect.uuid,
        name: effect.name,
        img: effect.img ?? "icons/svg/aura.svg",
        disabled: !!effect.disabled,
        canManage: game.user.isGM && effect.parent === actor,
      }));
  }

  /**
   * Every pool the viewer may edit, for the right-click panel on the portrait:
   * health and toxicity, plus whichever of the caster pools this character
   * actually has, gated exactly as the bars beside it are. Ownership is the
   * same test the token HUD applies, so this offers nothing extra, just a
   * closer place to reach it.
   */
  #prepareEditableResources(actor) {
    if (!actor?.isOwner) return [];
    const sys = actor.system;
    const stats = sys?.stats;
    if (!stats) return [];

    const keys = ["health", "toxicity", ...STRIP_RESOURCES.map((r) => r.key)];
    const gate = new Map(STRIP_RESOURCES.map((r) => [r.key, r.when]));

    const seen = new Set();
    const rows = [];
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);

      const stat = stats[key];
      if (!stat) continue;
      const when = gate.get(key);
      if (when && !when(sys)) continue;

      rows.push({
        key,
        label: localizeFirst(
          `REDSTEEL.Actor.Character.stats.${key}.value.label`,
        ),
        value: Number(stat.value ?? 0),
        max: Number(stat.max ?? 0),
      });
    }
    return rows;
  }

  /**
   * The character's potions, for the grid popover. Same filter the potion
   * dialog uses (`consumable` with option `potion`), so the two always agree
   * on what counts.
   *
   * Four to a column; more than sixteen and it grows sideways rather than
   * becoming a tall list.
   *
   * Every actor gets the tray, carrying potions or not. A belt you can see is
   * empty is worth knowing, and a button that appears and disappears as the
   * last flask is drunk shifts everything sitting beside it in the row. Only
   * an unbound panel, with no actor at all, has no tray.
   */
  #preparePotions(actor) {
    if (!actor) return null;

    const items = (actor.items ?? []).filter(
      (item) => item.type === "consumable" && item.system?.option === "potion",
    );

    const slots = items.map((item) => ({
      id: item.id,
      name: item.localizedName ?? item.name,
      img: item.img,
      qty: Number(item.system?.quantity ?? 1),
    }));

    // With nothing in it the grid would collapse to a sliver of padding, so an
    // empty belt is drawn as a row of sockets instead.
    while (slots.length < EMPTY_POTION_SLOTS) slots.push({ empty: true });

    return {
      // Off the real potions, not the padding: four empties are still one row.
      cols: Math.max(4, Math.ceil(items.length / 4)),
      items: slots,
    };
  }

  /**
   * The character's two weapon sets, for the swap popover. Only characters
   * have them, so an NPC or an empty panel gets nothing and the button hides.
   */
  #prepareWeaponSets(actor) {
    if (actor?.type !== "character") return null;
    const view = game.redsteel?.buildWeaponSetView?.(actor);
    if (!view) return null;

    const active = Number(actor.system.combat?.activeWeaponSet ?? 1);
    const slot = (item) => ({
      name: item?.localizedName ?? item?.name ?? null,
      img: item?.img ?? null,
    });

    return {
      active,
      sets: [1, 2].map((id) => ({
        id,
        active: id === active,
        main: slot(view[id]?.main),
        off: slot(view[id]?.off),
        twoHanded: !!view[id]?.mainIsTwoHanded,
      })),
    };
  }

  /**
   * Traits, resistances and immunities, as tags for the NPC-only row under the
   * attributes.
   *
   * Characters get nothing: this is the "what am I fighting" line, and a PC's
   * own traits are on their sheet in front of them. Every NPC gets the row
   * though, empty or not — "this creature has no resistances" is an answer, and
   * a row that comes and goes would move everything under it as you click
   * between tokens.
   *
   * Resistance and immunity are the same twelve booleans from `system.armor`
   * that combatSkillBonuses reads when it applies damage, so the row cannot
   * disagree with what the maths actually does. Immunity wins where both are
   * set on one type, matching that code: immunity short-circuits to x0 and the
   * x0.5 never runs, so showing both would claim a reduction that never
   * happens. Vulnerability is deliberately not shown — it is the same shape and
   * a one-line addition, but it was not asked for.
   *
   * `effectMods` immunities are folded into the same immunity group. They are a
   * different table (stagger, bleed, poison as *effects* rather than damage
   * types) but they say the same thing to whoever is reading the row.
   */
  #prepareNpcTags(actor) {
    if (actor?.type !== "npc") return null;

    const sys = actor.system ?? {};
    const label = (key) => game.i18n.localize(`REDSTEEL.Bg3Hotbar.DamageType.${key}`);

    // `.contents`, not the Collection: iterating one directly with for...of has
    // silently yielded nothing in this codebase before.
    const raceItem = actor.items.contents.find((item) => item.type === "race");
    const race = raceItem
      ? [{ name: raceItem.localizedName ?? raceItem.name, uuid: raceItem.uuid }]
      : [];

    // Every feature, not just `option === "trait"`. New NPCs can only be given
    // traits (Item#_preCreate rejects the rest), but NPCs built before that
    // guard can still be carrying a plain "special feature", and one that is on
    // the creature should be on the row that says what the creature is.
    const traits = actor.items.contents
      .filter((item) => item.type === "feature")
      .map((item) => ({
        name: item.localizedName ?? item.name,
        // The uuid, not the name: the tooltip shows the item's description.
        uuid: item.uuid,
      }));

    // Typed armor, value included, and only where there is one. A zero here is
    // the default for every NPC, so showing it would bury the two that matter
    // under six that do not.
    const armor = [];
    for (const key of ARMOR_VALUE_TYPES) {
      const total = Number(actor.system?.armor?.[key]?.total ?? 0);
      if (total) armor.push({ name: `${label(key)} ${total}` });
    }

    const resistances = [];
    const immunities = [];

    for (const key of DAMAGE_TYPES) {
      const row = sys.armor?.[key];
      if (!row) continue;
      if (row.immunity) immunities.push({ name: label(key) });
      else if (row.resistance) resistances.push({ name: label(key) });
    }

    for (const key of EFFECT_MOD_TYPES) {
      if (sys.effectMods?.[key]?.immune) {
        immunities.push({
          name: game.i18n.localize(`REDSTEEL.Bg3Hotbar.EffectMod.${key}`),
        });
      }
    }

    // Groups are dropped rather than rendered empty, so a creature with only
    // immunities shows one label and not three. If all three drop, the row
    // still renders and the template says so.
    // Order runs from what the creature IS to how it takes damage: race, then
    // traits, then the armor numbers, then the two damage modifiers.
    const groups = [
      { kind: "race", label: "REDSTEEL.Bg3Hotbar.Race", tags: race },
      { kind: "trait", label: "REDSTEEL.Bg3Hotbar.Traits", tags: traits },
      { kind: "armor", label: "REDSTEEL.Bg3Hotbar.Armor", tags: armor },
      { kind: "resist", label: "REDSTEEL.Bg3Hotbar.Resistances", tags: resistances },
      { kind: "immune", label: "REDSTEEL.Bg3Hotbar.Immunities", tags: immunities },
    ].filter((group) => group.tags.length);

    return { groups, empty: !groups.length };
  }

  /**
   * What the Roll Modifier picker currently has armed, as a short badge. The
   * actor's standing advantage bias counts too: a character under permanent
   * disadvantage should not read as unmodified just because the picker is
   * empty.
   */
  #prepareModifier(actor) {
    const state = getRollModifierState();
    const parts = [];
    if (state.desperate) parts.push("DE");
    if (state.flat > 0) parts.push(`+${state.flat}`);
    else if (state.flat < 0) parts.push(String(state.flat));

    let die = state.die;
    if (!die) {
      const bias = Number(actor?.system?.rollAdvantage?.all) || 0;
      if (bias > 0) die = "advantage";
      else if (bias < 0) die = "disadvantage";
    }
    if (die === "advantage") parts.push("ADV");
    else if (die === "disadvantage") parts.push("DIS");

    const tone =
      die === "advantage" || (!die && state.flat > 0)
        ? "good"
        : die === "disadvantage" || (!die && state.flat < 0)
          ? "bad"
          : "none";

    // Nothing armed shows a die instead of a value: the window is the way in
    // to the picker, so it should look like something you press.
    return { text: parts.join(" "), empty: !parts.length, tone };
  }

  /** Portrait ring data. `pct` drives the conic-gradient in CSS. */
  #prepareHealth(actor) {
    const health = actor?.system?.stats?.health ?? {};
    const value = Number(health.value ?? 0);
    const max = Number(health.max ?? 0);
    const pct = max > 0 ? Math.clamp((value / max) * 100, 0, 100) : 0;
    return { value, max, pct: Math.round(pct * 10) / 10 };
  }

  /**
   * Attribute cells, each carrying the sheet's roll dataset. Primaries and
   * secondaries stay in separate groups so the template can rule a divider
   * between them.
   */
  #prepareAttributes(actor) {
    const groups = { primary: [], secondary: [] };
    if (!actor) return groups;

    for (const key of PRIMARY_ATTRIBUTES) {
      const attr = actor.system?.attributes?.[key];
      if (!attr) continue;
      groups.primary.push({
        key,
        // Drives the per-attribute tint in CSS.
        tint: key,
        label: fromMap(CONFIG.REDSTEEL?.attributeAbbreviations, key),
        // The rating is what you actually roll against, and it is the only
        // number NPCs carry: their attributes have a `mod` but no `total`.
        display: Number(attr.mod ?? 0),
        rollType: "attribute",
        roll: `(@attributes.${key}.mod)-1d100`,
      });
    }

    for (const key of SECONDARY_ATTRIBUTES) {
      const attr = actor.system?.secondaryAttributes?.[key];
      // A spacer, not a skip. NPCs carry only spd, res and ini, so three of the
      // five are missing on them; dropping the cells would pull every cell
      // after them leftward and change the row's width, which sets the panel's
      // width, which moves both wings. The panel must not move as you click
      // from a character to a creature.
      if (!attr) {
        groups.secondary.push({ key, spacer: true });
        continue;
      }
      const chance = secondaryChance(actor, key);
      groups.secondary.push({
        key,
        tint: SECONDARY_TINTS[key] ?? null,
        label: fromMap(CONFIG.REDSTEEL?.secondaryAttributeAbbreviations, key),
        // Speed has no percentage, but the cell is still the speed-test button,
        // so it prints what that test is rolled against: Speed + Initiative,
        // the constant half of `1d12 + ini + spd`. The plain movement allowance
        // is the winged-foot readout in the status tray.
        display:
          key === "spd"
            ? speedTestBonus(actor)
            : (chance ?? Number(attr.total ?? 0)),
        rollType: "secondaryAttribute",
        roll: SECONDARY_ROLLS[key] ?? null,
      });
    }

    return groups;
  }

  /** The visible favourite-skill slots, five to a row. */
  #prepareSkills(actor) {
    const skills = actor?.system?.skills;
    if (!actor || !skills) return [];
    const favourites = readFavourites(actor);

    // A skill's governing attribute is stored as an index into the attribute
    // list, the same lookup the sheet's tooltips use. Type 2 (muscles,
    // nimbleness) derives purely from rank and governs under nothing.
    const attributeKeys = Object.keys(actor.system?.attributes ?? {});
    const tintFor = (skill) =>
      skill.type === 2 ? null : (attributeKeys[skill.id] ?? null);

    const visible = favourites.slice(
      0,
      this.skillRowCount * FAVOURITES_PER_ROW,
    );

    const slots = visible.map((key, index) => {
      const skill = key ? skills[key] : null;
      if (!key || !skill) {
        return { index, filled: false, canPick: !!actor.isOwner };
      }
      const rating = Number(skill.rating ?? 0);
      return {
        index,
        filled: true,
        key,
        tint: tintFor(skill),
        label: skillLabel(key),
        rating,
        roll: `${rating}-1d100`,
      };
    });

    const rows = [];
    for (let i = 0; i < slots.length; i += FAVOURITES_PER_ROW) {
      rows.push(slots.slice(i, i + FAVOURITES_PER_ROW));
    }
    return rows;
  }

  /**
   * Macro rows, ordered for the DOM: highest page first so page 1 renders at
   * the bottom of the stack.
   */
  #prepareMacroRows() {
    const rows = [];
    const total = this.rowCount;

    for (let page = total; page >= 1; page--) {
      const slots = game.user.getHotbarMacros(page).map(({ macro, slot }) => ({
        slot,
        filled: !!macro,
        macroId: macro?.id ?? "",
        img: macro?.img ?? null,
        name: macro?.name ?? "",
        // Only page 1 answers to the number keys, so only it gets key hints.
        keyLabel: page === 1 ? String(slot % SLOTS_PER_ROW) : "",
      }));
      // The +/- controls live outside the bar frame, so rows carry no flag.
      rows.push({ page, slots });
    }

    return rows;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;

    // Re-render replaces the part content but keeps this root element, so the
    // delegated listeners are removed first to avoid stacking duplicates.
    root.removeEventListener("contextmenu", this.#boundContextMenu);
    root.addEventListener("contextmenu", this.#boundContextMenu);
    root.removeEventListener("click", this.#boundClick);
    root.addEventListener("click", this.#boundClick);
    root.removeEventListener("dblclick", this.#boundDblClick);
    root.addEventListener("dblclick", this.#boundDblClick);
    root.removeEventListener("change", this.#boundResourceEdit);
    root.addEventListener("change", this.#boundResourceEdit);
    root.removeEventListener("dragstart", this.#boundDragStart);
    root.addEventListener("dragstart", this.#boundDragStart);
    root.removeEventListener("dragover", this.#boundDragOver);
    root.addEventListener("dragover", this.#boundDragOver);
    root.removeEventListener("drop", this.#boundDrop);
    root.addEventListener("drop", this.#boundDrop);
    root.removeEventListener("pointerover", this.#boundPointerOver);
    root.addEventListener("pointerover", this.#boundPointerOver);
    root.removeEventListener("pointerleave", this.#boundPointerLeave);
    root.addEventListener("pointerleave", this.#boundPointerLeave);

    // The target key is pressed with the cursor on a portrait, so nothing inside
    // the panel has focus and the event never reaches this element: it has to be
    // caught on the document. Removed first, since the document outlives a
    // re-render, and again in `_onClose`.
    document.removeEventListener("keydown", this.#boundKeyDown);
    document.addEventListener("keydown", this.#boundKeyDown);

    // Deselecting on the canvas clears a pinned portrait; the board is outside
    // this element, so it is attached separately and idempotently.
    this.#attachCanvasListener();

    this.#measureCapacity(root);

    // The floating End Turn / Delay Turn buttons attach on `renderBg3Hotbar`.
    // ApplicationV2's `render<ClassName>` convention is not documented for V14,
    // so fire it ourselves rather than depend on it. If core fires it too the
    // listener simply no-ops: `injectButton` bails when the container exists.
    Hooks.callAll("renderBg3Hotbar", this, root);
  }

  /**
   * How many party portraits still fit to the left of the bar, measured off
   * the rendered panel rather than computed from the stylesheet, so it stays
   * honest as sizes and breakpoints change. Reports only; it does not lay
   * anything out.
   */
  #measureCapacity(root) {
    const wing = root.querySelector(".rs-bg3-left");
    const team = root.querySelector(".rs-bg3-team");
    const anchor = root.querySelector(".rs-bg3-anchor");
    if (!wing || !anchor) return;

    const wingBox = wing.getBoundingClientRect();
    const gap = 6;

    let limit = 8;
    for (const selector of ["#players", "#ui-left"]) {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      if (!box?.width) continue;
      // Only counts as an obstacle if it shares the wing's band of the screen.
      if (box.bottom <= wingBox.top || box.top >= wingBox.bottom) continue;
      limit = Math.max(limit, box.right + gap);
    }

    const readout = root.querySelector(".rs-bg3-capacity");
    if (!readout) return;

    const shown = team?.childElementCount ?? 0;
    const teamBox = team?.getBoundingClientRect();
    const styles = getComputedStyle(anchor);
    const fallback = Number.parseFloat(
      styles.getPropertyValue("--rs-bg3-portrait-team"),
    );
    // One portrait plus its gap: from a rendered row where there is one, from
    // the variable that sizes them where there is not.
    const each =
      shown && teamBox?.width
        ? teamBox.width / shown
        : (Number.isFinite(fallback) ? fallback : 84) + 14 + gap;

    const free = Math.max(0, wingBox.left - limit);
    const spare = each > 0 ? Math.floor(free / each) : 0;

    readout.textContent =
      `${shown} shown · ${spare} more fit · ${Math.round(each)}px each · ${Math.round(free)}px free`;
    readout.classList.toggle("tight", spare <= 0);
  }

  /* -------------------------------------------- */
  /*  Re-render triggers                          */
  /* -------------------------------------------- */

  /**
   * None of these hooks can be fired by the render itself, so there is no
   * render loop: rendering writes no documents and sets no flags.
   */
  registerHooks() {
    const add = (hook, fn) => this.#hooks.push([hook, Hooks.on(hook, fn)]);
    const affectsMe = (doc) => !!doc && doc === this.actor;
    const effectActor = (effect) => {
      const parent = effect?.parent;
      if (parent instanceof Actor) return parent;
      return parent?.parent instanceof Actor ? parent.parent : null;
    };

    /** Any actor currently drawn on the panel, mine or a teammate's. */
    const isDrawn = (actor) => {
      if (!actor) return false;
      if (actor === this.actor) return true;
      // Mirror #prepareTeammates exactly: the row is connected players'
      // characters *plus* anything flagged into the party. Without the flag
      // test a companion's HP, tags or effects changed while it is on screen
      // leave a stale portrait behind.
      if (actor.system?.partyMember) return true;
      return game.users.contents.some(
        (user) => user.active && user.character?.id === actor.id,
      );
    };

    add("updateUser", (user, changed) => {
      // Someone else picking a different character changes the teammate row.
      if (user.id !== game.user.id) {
        if ("character" in changed) this.#rerender();
        return;
      }
      if ("hotbar" in changed || "character" in changed) this.#rerender();
    });

    // Covers HP for the rings, attribute totals, skill ratings and the
    // favourite-skill flag.
    add("updateActor", (actor, changed) => {
      // An actor being flagged into the party is not drawn yet, so the
      // "already on screen" test would miss the change that adds it.
      if ("partyMember" in (changed?.system ?? {})) return this.#rerender();
      if (isDrawn(actor)) this.#rerender();
    });

    // Players joining or leaving add and remove teammate portraits.
    add("userConnected", () => this.#rerender());

    // The roster reads the scene's tokens as well as the world directory, so a
    // party-member token arriving, leaving or being hidden changes it.
    for (const hook of ["createToken", "deleteToken"]) {
      add(hook, () => this.#rerender());
    }

    add("updateToken", (_tokenDoc, changed) => {
      // Dragging a token fires this continuously. Only these can alter the
      // roster; everything else is movement and appearance.
      if (!("hidden" in changed) && !("delta" in changed) && !("actorLink" in changed)) {
        return;
      }
      this.#rerender();
    });

    // Ticking "party member" on an *unlinked* token's sheet writes to its
    // ActorDelta, not to the world actor, so `updateActor` alone can miss it.
    add("updateActorDelta", (delta) => {
      if (delta?.parent?.actor?.system?.partyMember || isDrawn(delta?.parent?.actor)) {
        this.#rerender();
      }
    });

    // A different scene means a different set of tokens to read, and a board
    // element that may have been rebuilt under the deselect listener.
    add("canvasReady", () => {
      this.#attachCanvasListener();
      this.#rerender();
    });

    // A race Item carries the creature-type tags that pick the portrait's band
    // colour; a consumable may be a potion on the belt. The potion tray is on
    // screen whether or not it holds anything, so a quantity going stale now
    // shows. `#rerender` is debounced, so looting a pile is one render.
    // `feature` joins them for the NPC tag row: a trait is a feature Item.
    const ITEM_TYPES = new Set(["race", "consumable", "feature"]);
    for (const hook of ["createItem", "deleteItem", "updateItem"]) {
      add(hook, (item) => {
        if (!ITEM_TYPES.has(item?.type)) return;
        const parent = item.parent;
        if (parent instanceof Actor && isDrawn(parent)) this.#rerender();
      });
    }

    // The Roll Modifier picker being armed, changed or cleared.
    add("redsteelRollModifier", () => this.#rerender());

    for (const hook of [
      "createActiveEffect",
      "updateActiveEffect",
      "deleteActiveEffect",
    ]) {
      add(hook, (effect) => {
        if (affectsMe(effectActor(effect))) this.#rerender();
      });
    }

    // Selecting a different token on the canvas outranks a clicked portrait:
    // the canvas is the more direct statement of "this one now". Selecting the
    // pinned actor's own token leaves the pin alone, which is what lets the
    // click below control a token without immediately undoing itself.
    add("controlToken", (token, controlled) => {
      const hadPin = !!this.#pinnedUuid;
      if (controlled && hadPin && token?.actor?.uuid !== this.#pinnedUuid) {
        this.#pinnedUuid = null;
      }
      // With an assigned character and no pin either way, selection is
      // irrelevant; losing the pin is a rebind and always needs the redraw.
      if (!game.user.character || hadPin !== !!this.#pinnedUuid) this.#rerender();
    });
  }

  /** @override */
  _onClose(options) {
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
    this.#board?.removeEventListener("pointerup", this.#boundCanvasPointerUp);
    this.#board = null;
    document.removeEventListener("keydown", this.#boundKeyDown);
    this.#hoveredPortraitUuid = null;
    super._onClose?.(options);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this {Bg3Hotbar} */
  static async _onRollAttribute(event, target) {
    if (isRightClick(event)) return;
    const actor = this.actor;
    if (!actor) return;
    const { label, rollType, roll } = target.dataset;
    if (!label) return;

    // Speed has no d100 formula — it posts the shared Speed Test card.
    if (label === "spd") return postSpeedTest(actor);
    if (!roll) return;
    return dispatchSheetRoll(actor, { rollType, label, roll }, event);
  }

  /** @this {Bg3Hotbar} */
  static async _onRollSkill(event, target) {
    if (isRightClick(event)) return;
    const actor = this.actor;
    if (!actor) return;
    const { label, roll } = target.dataset;
    if (!label || !roll) return;
    return dispatchSheetRoll(actor, { rollType: "skill", label, roll }, event);
  }

  /** @this {Bg3Hotbar} */
  static async _onPickSkill(event, target) {
    if (isRightClick(event)) return;
    const actor = this.actor;
    if (!actor?.isOwner || !actor.system?.skills) return;
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) return;

    const favourites = readFavourites(actor);
    const chosen = await promptForSkill(actor, favourites, index);
    if (!chosen) return;

    favourites[index] = chosen;
    await actor.setFlag("redsteel", FAVOURITES_FLAG, favourites);
  }

  /** @this {Bg3Hotbar} */
  static async _onClearSkill(event, target) {
    const actor = this.actor;
    if (!actor?.isOwner) return;
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) return;

    const favourites = readFavourites(actor);
    if (!favourites[index]) return;
    favourites[index] = null;
    await actor.setFlag("redsteel", FAVOURITES_FLAG, favourites);
  }

  /**
   * Run one of the action row's buttons. The name is matched against the
   * button list rather than taken from the DOM directly, so nothing but those
   * eight entry points can ever be called from here.
   *
   * @this {Bg3Hotbar}
   */
  static async _onRunAction(event, target) {
    if (isRightClick(event)) return;
    const button = ACTION_BUTTONS.find((a) => a.key === target.dataset.act);
    if (!button || (button.gmOnly && !game.user.isGM)) return;

    const fn = game.redsteel?.[button.api];
    if (typeof fn !== "function") {
      console.warn("Redsteel |", `game.redsteel.${button.api} is missing`);
      return;
    }
    return fn();
  }

  /** @this {Bg3Hotbar} */
  static async _onExecuteMacro(event, target) {
    if (isRightClick(event)) return;
    const macro = game.macros.get(target.dataset.macroId);
    if (!macro) return;
    return macro.execute();
  }

  /**
   * Show or hide the weapon set popover. Kept in the DOM and toggled by class
   * rather than re-rendered, so opening it costs nothing and closing it cannot
   * fight the panel's own render.
   *
   * @this {Bg3Hotbar}
   */
  static _onToggleWeaponSets(event) {
    if (isRightClick(event)) return;
    this.element?.querySelector(".rs-bg3-potions")?.classList.remove("open");
    this.element
      ?.querySelector(".rs-bg3-weaponsets")
      ?.classList.toggle("open");
  }

  /**
   * Show or hide the potion grid. Toggled by class for the same reason the
   * weapon sets are, and it closes the other popover so the two cannot overlap.
   *
   * @this {Bg3Hotbar}
   */
  static _onTogglePotions(event) {
    if (isRightClick(event)) return;
    this.element?.querySelector(".rs-bg3-weaponsets")?.classList.remove("open");
    this.element?.querySelector(".rs-bg3-potions")?.classList.toggle("open");
  }

  /**
   * Drink the potion that was clicked. `usePotion` does the drinking, including
   * toxicity, effects and the chat card; passing the item only skips its
   * picker, so nothing about consumption is duplicated here.
   *
   * @this {Bg3Hotbar}
   */
  static async _onUsePotionItem(event, target) {
    if (isRightClick(event)) return;
    const item = this.actor?.items?.get(target.dataset.itemId);
    if (!item) return;
    this.element?.querySelector(".rs-bg3-potions")?.classList.remove("open");
    return game.redsteel?.usePotion?.(item);
  }

  /**
   * Switch to the set that was clicked. `switchWeaponSet` toggles between the
   * two and posts the cost reminder to the GM, so clicking the set already in
   * hand does nothing rather than swapping away from it.
   *
   * @this {Bg3Hotbar}
   */
  static async _onPickWeaponSet(event, target) {
    if (isRightClick(event)) return;
    const actor = this.actor;
    if (!actor?.isOwner) return;

    const wanted = Number(target.dataset.set);
    const current = Number(actor.system?.combat?.activeWeaponSet ?? 1);
    this.element?.querySelector(".rs-bg3-weaponsets")?.classList.remove("open");
    if (!Number.isInteger(wanted) || wanted === current) return;

    await game.redsteel?.switchWeaponSet?.(actor);
  }

  /**
   * The same picker the core hotbar's dice button opens, so a player can arm
   * their own modifier without the core bar being on screen.
   *
   * @this {Bg3Hotbar}
   */
  static async _onOpenRollModifier(event) {
    if (isRightClick(event)) return;
    openModifierDialog();
  }

  /**
   * Open an effect's sheet. GM only, and only for effects the actor owns:
   * item-granted ones have to be edited on the item they came from.
   *
   * @this {Bg3Hotbar}
   */
  static async _onEditEffect(event, target) {
    if (isRightClick(event) || !game.user.isGM) return;
    const effect = fromUuidSync(target.dataset.uuid);
    if (effect?.parent !== this.actor) return;
    effect.sheet?.render(true);
  }

  /**
   * Swap the status-row tray between the character's conditions and its armor
   * by damage type. Two readings of the same strip of numbers, and which one
   * you want depends on whether you are about to take a hit or about to spend
   * a turn recovering.
   *
   * @this {Bg3Hotbar}
   */
  static async _onToggleTrayView(event) {
    if (isRightClick(event)) return;
    await game.user.setFlag("redsteel", ARMOR_VIEW_FLAG, !this.armorView);
    this.render();
  }

  /**
   * Flip whether this NPC answers attack cards on its own.
   *
   * The same switch as the one on the NPC sheet, put where the GM already is
   * mid-fight: the exceptions it exists for — a creature that surrenders, gets
   * bound, or is being finished off — all turn up in the middle of a round,
   * when opening a sheet to find a checkbox is the whole cost being avoided.
   *
   * No re-render here: writing to the actor fires `updateActor`, which the
   * panel already redraws on.
   *
   * @this {Bg3Hotbar}
   */
  static async _onToggleAutoDefense(event) {
    if (isRightClick(event)) return;

    const actor = this.actor;
    if (actor?.type !== "npc" || !actor.isOwner) return;

    // Read the current state the way everything else does — an NPC with no key
    // stored is on, so the first click on one has to write `false`, not `true`.
    const on = actor.system?.autoDefense !== false;
    await actor.update({ "system.autoDefense": !on });
  }

  /**
   * The wrench in the corner. Both row counts are set in one dialog, written in
   * one user update so the panel redraws once rather than twice.
   *
   * @this {Bg3Hotbar}
   */
  static async _onOpenSettings(event) {
    if (isRightClick(event)) return;

    const result = await promptForBarSettings({
      skillRows: this.skillRowCount,
      macroRows: this.rowCount,
    });
    if (!result) return;
    if (
      result.skillRows === this.skillRowCount &&
      result.macroRows === this.rowCount
    ) {
      return;
    }

    await game.user.update({
      flags: {
        redsteel: {
          [SKILL_ROWS_FLAG]: result.skillRows,
          [ROWS_FLAG]: result.macroRows,
        },
      },
    });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Manual listeners                            */
  /* -------------------------------------------- */

  /**
   * Right-click clears a favourite skill slot, or empties a macro slot without
   * ever deleting the Macro document.
   */
  async #onContextMenu(event) {
    // Right-clicking your own portrait opens the resource editor, the same way
    // right-clicking your token opens the HUD. Teammate portraits are excluded:
    // that is someone else's character.
    const ownFrame = event.target.closest?.(
      ".rs-bg3-portrait-frame:not(.rs-bg3-portrait-frame--team)",
    );
    if (ownFrame) {
      event.preventDefault();
      event.stopPropagation();
      ownFrame.querySelector(".rs-bg3-resedit")?.classList.toggle("open");
      return;
    }

    // Removing an effect is a GM action, and only for effects the actor owns.
    const effectEl = event.target.closest?.(".rs-bg3-effect.manageable");
    if (effectEl) {
      event.preventDefault();
      event.stopPropagation();
      if (!game.user.isGM) return;
      const effect = fromUuidSync(effectEl.dataset.uuid);
      if (effect?.parent === this.actor) await effect.delete();
      return;
    }

    const skillSlot = event.target.closest?.(".rs-bg3-skill-slot.filled");
    if (skillSlot) {
      event.preventDefault();
      event.stopPropagation();
      return Bg3Hotbar._onClearSkill.call(this, event, skillSlot);
    }

    const macroSlot = event.target.closest?.(".rs-bg3-macro-slot.filled");
    if (!macroSlot) return;
    event.preventDefault();
    event.stopPropagation();
    const slot = Number(macroSlot.dataset.slot);
    if (!Number.isInteger(slot)) return;
    await game.user.assignHotbarMacro(null, slot);
  }

  /**
   * Left-clicking a portrait selects that character's token on the canvas, the
   * way clicking a party member in a CRPG switches to them: the portrait
   * becomes the main one and the whole bar rebinds to it.
   *
   * The bind is a pin on this panel, not a side effect of controlling the
   * token, because a party member may have no token on this scene at all and
   * the click still has to do something. Where there is a token it is selected
   * as well, with shift adding to the selection as it would on the canvas.
   *
   * The way back out is on the canvas rather than here: deselecting everything
   * clears the pin (see `#onCanvasPointerUp`). Double-click belongs to the
   * sheet — which is why every portrait click defers the redraw
   * (`#portraitHoldUntil`) instead of pulling the frame out from under a second
   * click that has not arrived yet.
   */
  #onClick(event) {
    if (isRightClick(event)) return;
    const frame = event.target.closest?.(".rs-bg3-portrait-frame");
    if (!frame) return;
    // The resource editor lives inside the frame and owns its own clicks.
    if (event.target.closest?.(".rs-bg3-resedit")) return;
    event.preventDefault();
    // The second click of a double-click belongs to the sheet, not to selection.
    // It is answered here as well as in `#onDblClick` because either one can be
    // the only half that survives: a `dblclick` needs both clicks to pair,
    // while `detail` is counted off the pointer and holds up whatever the DOM
    // did in between.
    if (event.detail > 1) {
      // The gesture is resolved, so the redraw the first click deferred can run.
      this.#portraitHoldUntil = 0;
      this.#rerender();
      this.#openPortraitSheet(this.#lastPortraitUuid);
      return;
    }

    // Teammate portraits name their actor; the main one is whoever is bound.
    const teamUuid = frame.dataset.actorUuid ?? null;
    const uuid = teamUuid ?? this.actor?.uuid ?? null;
    const actor = uuid ? fromUuidSync(uuid) : null;
    // Remembered for the second click, which cannot always see the frame itself.
    this.#lastPortraitUuid = actor?.uuid ?? null;
    // Every portrait holds the redraw, including your own: a teammate click
    // moves the row, but even a redraw to an identical layout swaps out the
    // frame this click landed on, which is enough to cost the double-click.
    this.#portraitHoldUntil = Date.now() + PORTRAIT_HOLD_MS;
    // Binding the panel is the point of the click and must not depend on the
    // canvas: a party member with no token on this scene still becomes the
    // character the bar is driving.
    if (!this.#pinActor(actor)) return;

    // Selecting the token as well, where there is one, so the click does what
    // clicking the token would have. Shift keeps the existing selection, the
    // same as on the canvas.
    const token = tokenForActor(actor);
    if (token?.isOwner) token.control({ releaseOthers: !event.shiftKey });

    this.#rerender();
  }

  /**
   * Track which portrait the cursor is on, so the target key knows who it means.
   * Moving onto anything else in the panel clears it, the same as leaving.
   */
  #onPointerOver(event) {
    const frame = event.target.closest?.(".rs-bg3-portrait-frame");
    // Teammate portraits name their actor; the main one is whoever is bound.
    this.#hoveredPortraitUuid = frame
      ? (frame.dataset.actorUuid ?? this.actor?.uuid ?? null)
      : null;
  }

  /** The cursor left the panel entirely, so no portrait is under it. */
  #onPointerLeave() {
    this.#hoveredPortraitUuid = null;
  }

  /**
   * Pressing the target key over a portrait targets that character's token, the
   * same gesture as pressing it over the token on the canvas: toggle, and shift
   * adds to the existing targets instead of replacing them.
   *
   * Core's own handler cannot fire here — it reads the token the cursor is over,
   * and the cursor is on the panel — so the two never fight over the keypress.
   *
   * The portrait is read from the live `:hover` where the DOM can still answer,
   * and from the last pointer event otherwise: a re-render replaces the node the
   * cursor is resting on, and the browser only recomputes `:hover` once the
   * mouse moves again.
   */
  #onKeyDown(event) {
    if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
    if (!targetKeyCodes().includes(event.code)) return;
    // Typing a resource into the portrait's right-click panel is not a keybind.
    if (event.target?.closest?.("input, textarea, select, [contenteditable]")) return;

    const root = this.element;
    if (!(root instanceof HTMLElement)) return;
    const hovered = root.querySelector(".rs-bg3-portrait-frame:hover");
    const uuid = hovered
      ? (hovered.dataset.actorUuid ?? this.actor?.uuid ?? null)
      : this.#hoveredPortraitUuid;
    if (!uuid) return;

    // A party member with no token on this scene has nothing to target, and a
    // token the user cannot see is one the GM has not revealed.
    const token = tokenForActor(fromUuidSync(uuid));
    if (!token || (!token.visible && !game.user.isGM)) return;

    event.preventDefault();
    const targeted = token.isTargeted;
    token.setTarget(!targeted, {
      releaseOthers: !targeted && !event.shiftKey,
    });
  }

  /**
   * Clearing a portrait is done on the canvas, not on the panel: a left-click
   * or a drag-select that lands on empty ground deselects everything, and the
   * bar goes back to its default with it. That is the gesture the canvas
   * already has for "nothing selected", so the panel borrows it rather than
   * inventing a second one.
   *
   * Read after the event settles, because Foundry resolves the marquee inside
   * its own handler for the same pointerup, and `controlToken` alone cannot
   * speak for a pinned character with no token on the scene: nothing is ever
   * released, so nothing would fire.
   */
  #onCanvasPointerUp(event) {
    if (event.button !== 0 || !this.#pinnedUuid) return;
    // A double-click on a portrait whose row has already moved can put its
    // second click on the canvas. That is the panel's gesture misfiring, not a
    // deselect, so the window a portrait click opens is ignored here.
    if (Date.now() < this.#portraitHoldUntil) return;
    setTimeout(() => {
      if (!this.#pinnedUuid) return;
      if (canvas.tokens?.controlled?.length) return;
      this.#pinnedUuid = null;
      this.#rerender();
    }, 0);
  }

  /**
   * The board is not part of this application, and it outlives a re-render, so
   * the listener is attached idempotently rather than in `_onRender` alone.
   */
  #attachCanvasListener() {
    const board = canvas?.app?.view ?? document.getElementById("board");
    if (!(board instanceof HTMLElement)) return;
    board.removeEventListener("pointerup", this.#boundCanvasPointerUp);
    board.addEventListener("pointerup", this.#boundCanvasPointerUp);
    this.#board = board;
  }

  /**
   * Double-clicking the portrait opens the character sheet, the same gesture
   * that opens an actor from a token. ApplicationV2's `actions` map only routes
   * clicks, so this is delegated by hand.
   *
   * This is the second half of a pair: the `click` handler answers the same
   * gesture off `event.detail`, and `#openPortraitSheet` keeps them from both
   * opening the sheet. It is worth having both, because a redraw slipping
   * between the two clicks leaves the browser with no common element for the
   * pair, and it then reports the `dblclick` against the panel root or drops
   * it entirely. The root is accepted here for exactly that reason.
   */
  #onDblClick(event) {
    const frame = event.target.closest?.(".rs-bg3-portrait-frame");
    if (!frame && event.target !== this.element) return;
    event.preventDefault();
    // The gesture is resolved, so the redraw the first click deferred can run.
    this.#portraitHoldUntil = 0;
    this.#rerender();
    this.#openPortraitSheet(this.#lastPortraitUuid);
  }

  /**
   * Open a portrait's sheet, once per gesture. Both halves of a double-click
   * route here, since either may be the only one to arrive, so the pair is
   * deduplicated on the way in instead of trusting exactly one of them.
   *
   * The actor is named by the click that started the gesture, never by the
   * frame under the cursor: if the row did reshuffle, the frame there now
   * belongs to a different teammate.
   */
  #openPortraitSheet(uuid) {
    const actor = (uuid ? fromUuidSync(uuid) : null) ?? this.actor;
    // Foundry hides the sheet from users below LIMITED anyway; bailing here
    // keeps a GM-selected token from throwing a permission warning at a player.
    if (!actor?.testUserPermission(game.user, "LIMITED")) return;
    const now = Date.now();
    const open = this.#lastSheetOpen;
    if (open.uuid === actor.uuid && now < open.until) return;
    this.#lastSheetOpen = { uuid: actor.uuid, until: now + SHEET_OPEN_DEDUPE_MS };
    actor.sheet.render(true);
  }

  /**
   * Commit a resource typed into the portrait's right-click panel. Ownership is
   * rechecked here rather than trusted from the render: the field only exists
   * for owners, but a stale panel should not be able to write.
   */
  async #onResourceEdit(event) {
    const input = event.target.closest?.(".rs-bg3-resedit-input");
    if (!input) return;

    const actor = this.actor;
    const key = input.dataset.stat;
    if (!actor?.isOwner || !key) return;

    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    await actor.update({ [`system.stats.${key}.value`]: value });
  }

  #onDragStart(event) {
    const slotEl = event.target.closest?.(".rs-bg3-macro-slot.filled");
    if (!slotEl) return;
    const macro = game.macros.get(slotEl.dataset.macroId);
    if (!macro) return;
    event.dataTransfer?.setData(
      "text/plain",
      JSON.stringify({
        type: "Macro",
        uuid: macro.uuid,
        slot: Number(slotEl.dataset.slot),
      }),
    );
  }

  #onDragOver(event) {
    if (!event.target.closest?.(".rs-bg3-macro-slot")) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  /**
   * Mirrors the core hotbar's drop behaviour so the system's own `hotbarDrop`
   * handler (which turns dropped Items into macros) keeps working unchanged.
   */
  async #onDrop(event) {
    const slotEl = event.target.closest?.(".rs-bg3-macro-slot");
    if (!slotEl) return;
    event.preventDefault();
    event.stopPropagation();

    const slot = Number(slotEl.dataset.slot);
    if (!Number.isInteger(slot)) return;

    let data;
    try {
      data = TextEditor.getDragEventData(event);
    } catch (err) {
      return;
    }
    if (!data) return;
    if (Hooks.call("hotbarDrop", ui.hotbar, data, slot) === false) return;
    if (data.type !== "Macro") return;

    const macro = await Macro.implementation.fromDropData(data);
    if (!macro) return;
    await game.user.assignHotbarMacro(macro, slot, data.slot);
  }
}

/* -------------------------------------------- */
/*  Slim chat input                             */
/* -------------------------------------------- */

/**
 * Core keeps the message box docked at full width whatever sidebar tab you are
 * on, which eats the space the bar's right wing wants. This narrows it to a
 * stub while you are on some other tab, and gives the width back on focus or
 * whenever the chat tab itself is open.
 *
 * The class goes on the input element itself, never on a container: the
 * notification stack and the input share one, so classing the parent narrowed
 * the whole popped-out message column with it. Styling our own class rather
 * than a core selector also means a change to core's markup makes this do
 * nothing rather than something wrong.
 *
 * @returns {boolean} Whether the input was found and wired.
 */
function applySlimChat() {
  const input = document.querySelector(
    "#chat-message, textarea[name='chat-message']",
  );
  if (!input) return false;

  // Only the box docked over another sidebar tab is in the way. On the chat
  // tab itself it is the thing you came for, so it keeps its full width.
  const active = ui.sidebar?.activeTab ?? ui.sidebar?.tabGroups?.primary;
  if (active === undefined) return true; // cannot tell: leave core alone

  input.classList.toggle("rs-slim-chat", active !== "chat");
  return true;
}

function registerSlimChat() {
  game.settings.register("redsteel", SLIM_CHAT_SETTING, {
    config: true,
    scope: "client",
    name: "REDSTEEL.Config.Bg3SlimChat.name",
    hint: "REDSTEEL.Config.Bg3SlimChat.label",
    type: Boolean,
    default: true,
    requiresReload: true,
  });

  if (!game.settings.get("redsteel", SLIM_CHAT_SETTING)) return;

  // The chat log is re-rendered on tab changes, so re-apply rather than
  // assuming the element found at startup is the one still on screen.
  const apply = () => applySlimChat();
  Hooks.once("ready", () => {
    if (!apply()) {
      console.warn(
        "Redsteel |",
        "Chat input not found; the slim chat setting is doing nothing.",
      );
    }
  });
  Hooks.on("renderChatLog", apply);
  Hooks.on("changeSidebarTab", apply);
  Hooks.on("collapseSidebar", apply);
  Hooks.on("renderSidebar", apply);
}

/* -------------------------------------------- */
/*  Tucked player list                          */
/* -------------------------------------------- */

/**
 * The player list holds the bottom-left corner permanently, which is exactly
 * where the party row wants to grow, and its latency and FPS readouts are not
 * something you need every second. This tucks it into a puck you click to open.
 *
 * Everything is done by adding a class and one button, so turning the setting
 * off leaves core's own list untouched.
 *
 * @returns {boolean} Whether the list was found and wired.
 */
/**
 * Paint the puck's icon in whatever colour core is currently using for the
 * latency readout, rather than reimplementing its thresholds. Copying the
 * computed colour means the puck tracks core's own ping code exactly, and
 * keeps tracking it if those thresholds ever change.
 */
/**
 * Lift the player list above the bar.
 *
 * A z-index on `#players` alone does nothing if an ancestor creates its own
 * stacking context: the whole subtree is then painted at the ancestor's level,
 * however high the child goes. Which ancestor that is depends on core's markup,
 * so rather than guess a selector, walk up and raise every element on the way
 * that establishes a context, stopping at the interface root.
 */
function raisePlayersAbovePanel(players) {
  for (let el = players; el && el !== document.body; el = el.parentElement) {
    const styles = getComputedStyle(el);
    const establishesContext =
      (styles.position !== "static" && styles.zIndex !== "auto") ||
      styles.transform !== "none" ||
      styles.filter !== "none" ||
      styles.isolation === "isolate" ||
      styles.willChange.includes("transform");

    if (establishesContext) el.style.zIndex = "200";
    if (el.id === "interface" || el.id === "ui-left") break;
  }
}

/**
 * The element that actually paints the player panel, which is not `#players`
 * itself: that is a larger transparent container, so anything prepended to it
 * lands above the visible box. The latency line is inside the panel, so the
 * direct child of `#players` holding it is the panel.
 */
function playerPanel(players) {
  return findLatencyEl(players)?.closest("#players > *") ?? players;
}

/** The latency readout, by class where core offers one, by content otherwise. */
function findLatencyEl(players) {
  const byClass = players.querySelector(
    "[class*='latency'], [class*='ping'], [data-tooltip*='atency']",
  );
  if (byClass) return byClass;

  for (const el of players.querySelectorAll("span, b, strong, em, div")) {
    if (el.children.length) continue;
    if (/^\s*\d+\s*ms\s*$/i.test(el.textContent ?? "")) return el;
  }
  return null;
}

function refreshPeekColour(players, peek) {
  // The icon comes from the button, which may have left the list; the colour
  // comes from the list, which is still styled even while it is hidden.
  const icon = peek?.querySelector("i");
  if (!icon) return;
  const source = findLatencyEl(players);
  icon.style.color = source ? getComputedStyle(source).color : "";
}

/**
 * The player list holds the bottom-left corner permanently, which is exactly
 * where the party row wants to grow, and its latency and FPS readouts are not
 * something you need every second. This adds one button that collapses it to a
 * puck and expands it again, remembering which you chose.
 *
 * Everything is done by adding a class and one button, so core's own list is
 * never rewritten.
 *
 * @returns {boolean} Whether the list was found and wired.
 */
function applyPlayerListToggle() {
  const players = document.getElementById("players");
  if (!players) return false;

  let peek = document.querySelector(".rs-players-peek");
  if (!peek) {
    peek = document.createElement("button");
    peek.type = "button";
    peek.className = "rs-players-peek";
    peek.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const tucked = !players.classList.contains("rs-players-tucked");
      game.user.setFlag("redsteel", TUCK_PLAYERS_FLAG, tucked);
      placePeek(players, peek, tucked);
    });
  }

  // Collapsed by default: the list holds the corner the party row grows into,
  // and latency is not something you need every second.
  const stored = game.user.getFlag("redsteel", TUCK_PLAYERS_FLAG);
  placePeek(players, peek, stored === undefined ? true : !!stored);
  return true;
}

/**
 * Put the button where the state needs it. Tucked, it leaves the list entirely
 * and stands on its own in the corner: shrinking `#players` to a puck instead
 * meant fighting core for the box's size, and losing. Expanded, it sits in the
 * list's top-right.
 */
function placePeek(players, peek, tucked) {
  players.classList.toggle("rs-players-tucked", tucked);
  peek.classList.toggle("standalone", tucked);

  const panel = playerPanel(players);
  const host = tucked ? document.body : panel;
  if (peek.parentElement !== host) host.append(peek);

  // Set inline: core styles its own buttons by id and element, which outranks
  // any class rule we could write, and this has to win outright.
  Object.assign(peek.style, {
    position: tucked ? "fixed" : "absolute",
    top: tucked ? "auto" : "4px",
    right: tucked ? "auto" : "4px",
    left: tucked ? "10px" : "auto",
    bottom: tucked ? "10px" : "auto",
  });

  if (!tucked && panel !== players) panel.style.position = "relative";
  if (!tucked) raisePlayersAbovePanel(players);
  syncPeek(players, peek);
}

/** Icon and label follow the state: wifi to expand, compress to collapse. */
function syncPeek(players, peek) {
  if (!peek) return;

  const tucked = players.classList.contains("rs-players-tucked");
  peek.innerHTML = `<i class="fa-light fa-${tucked ? "wifi" : "compress"}"></i>`;
  // Labelled for screen readers only. No tooltip: the icon is self-evident and
  // one hovering over the corner of the screen is just in the way.
  peek.setAttribute(
    "aria-label",
    game.i18n.localize(
      `REDSTEEL.Bg3Hotbar.${tucked ? "PlayersExpand" : "PlayersCollapse"}`,
    ),
  );
  refreshPeekColour(players, peek);
}

function registerPlayerListToggle() {
  Hooks.once("ready", () => {
    if (!applyPlayerListToggle()) {
      console.warn(
        "Redsteel |",
        "Player list not found; its collapse button was not added.",
      );
    }
  });
  // Rebuilt whenever someone connects, and re-rendered as latency updates.
  for (const hook of ["renderPlayers", "renderPlayerList", "userConnected"]) {
    Hooks.on(hook, () => applyPlayerListToggle());
  }

  // Latency is refreshed on core's own timer without re-rendering the list, so
  // the colour is resampled periodically rather than only on render.
  setInterval(() => {
    const players = document.getElementById("players");
    const peek = document.querySelector(".rs-players-peek");
    if (players && peek) refreshPeekColour(players, peek);
  }, 5000);
}

/* -------------------------------------------- */
/*  Slot visibility                             */
/* -------------------------------------------- */

/**
 * Bring a hotbar slot into view, whichever bar the player is using.
 *
 * The panel starts with zero macro rows, so a macro dropped into slot 1 lands
 * somewhere the player cannot see. Raising the row count to cover the slot's
 * page is the panel's equivalent of the core bar's page switch — and it is
 * exactly what the `+` control does, so nothing new is being taught here.
 *
 * The row count is only ever raised, never lowered: a player who has expanded
 * their bar keeps the rows they chose.
 *
 * @param {number} slot - Hotbar slot, 1-50.
 */
export async function revealHotbarSlot(slot) {
  const page = Math.ceil(Number(slot) / SLOTS_PER_ROW);
  if (!Number.isInteger(page) || page < 1 || page > MAX_ROWS) return;

  const panel = ui.redsteelHotbar;
  if (panel) {
    if (panel.rowCount < page) {
      await game.user.setFlag("redsteel", ROWS_FLAG, page);
    }
    // The updateUser hook re-renders on `hotbar` changes but not on flags, so
    // the row-count change needs saying out loud.
    panel.render();
    return;
  }

  // Core hotbar: show the page the slot lives on.
  await ui.hotbar?.changePage?.(page);
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

/**
 * Register the client setting and, when it is on, build the panel on `ready`.
 * Call from the `init` hook.
 */
export function registerRedsteelHotbar() {
  game.settings.register("redsteel", SETTING, {
    config: true,
    scope: "client", // each player opts in for themselves
    name: "REDSTEEL.Config.Bg3Hotbar.name",
    hint: "REDSTEEL.Config.Bg3Hotbar.label",
    type: Boolean,
    default: true,
    // Swapping the whole bar mid-session is not worth the teardown paths.
    requiresReload: true,
  });

  // World-scoped and restricted: whether players can read each other's health
  // is a table rule, not a personal preference, so only GM-level users may set
  // it. Registered even when the panel is off, so it can be set ahead of the
  // reload that turns the panel on.
  game.settings.register("redsteel", TEAM_HEALTH_SETTING, {
    config: true,
    scope: "world",
    restricted: true,
    name: "REDSTEEL.Config.Bg3TeamHealth.name",
    hint: "REDSTEEL.Config.Bg3TeamHealth.label",
    type: Boolean,
    default: false,
    onChange: () => ui.redsteelHotbar?.render(),
  });

  // A measuring aid rather than a feature: prints how many party portraits
  // still fit beside the bar, so the roster can be sized before it overflows.
  game.settings.register("redsteel", CAPACITY_SETTING, {
    config: true,
    scope: "client",
    name: "REDSTEEL.Config.Bg3Capacity.name",
    hint: "REDSTEEL.Config.Bg3Capacity.label",
    type: Boolean,
    default: false,
    onChange: () => ui.redsteelHotbar?.render(),
  });

  registerSlimChat();
  registerPlayerListToggle();

  if (!game.settings.get("redsteel", SETTING)) return;

  registerPanelStatTooltip();
  registerNpcTagTooltip();

  Hooks.once("ready", () => {
    document.body.classList.add(BODY_CLASS);
    const panel = new Bg3Hotbar();
    ui.redsteelHotbar = panel;
    panel.registerHooks();
    panel.render(true);
  });
}
