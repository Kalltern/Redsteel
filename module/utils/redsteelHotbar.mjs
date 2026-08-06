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
import { registerTooltip, ttEscape } from "./tooltips.mjs";
import {
  getRollModifierState,
  openModifierDialog,
} from "./rollModifier.mjs";

const SETTING = "bg3Hotbar";
const TEAM_HEALTH_SETTING = "bg3HotbarTeamHealth";
const BODY_CLASS = "redsteel-bg3-hotbar";
const ROWS_FLAG = "bg3HotbarRows";
const SKILL_ROWS_FLAG = "bg3HotbarSkillRows";
const COND_FOLDED_FLAG = "bg3HotbarCondFolded";
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
  { key: "attack", api: "attackActions", icon: "fa-light fa-sword" },
  { key: "defense", api: "defenseRoll", icon: "fa-light fa-shield" },
  // A fist: martial and unmistakably not the sword or the shield beside it.
  { key: "ability", api: "combatAbilities", icon: "fa-light fa-hand-fist" },
  { key: "channeling", api: "castSpell", icon: "fa-light fa-sparkles" },
  { key: "firstAid", api: "firstAid", icon: "fa-light fa-staff-snake" },
  // GM tools last, and set apart in the row.
  { key: "rest", api: "longRest", icon: "fa-light fa-moon", gmOnly: true },
  {
    key: "effects",
    api: "statusEffectManager",
    icon: "fa-light fa-folder-bookmark",
    gmOnly: true,
  },
];

/**
 * Resource bars beside the portrait. Health is not here: it owns the ring, and
 * toxicity floods the portrait, which leaves the column at four.
 *
 * `when` decides whether the character has the pool at all. There is
 * deliberately no "show it if it has a maximum" fallback: NPC pools ship with a
 * max of 900 whether the creature casts or not, so that rule handed every NPC a
 * full set of bars.
 */
const STRIP_RESOURCES = [
  { key: "stamina" },
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
];

/**
 * The character sheet's condition row, mirrored into the panel's right-hand
 * extension. Icons and colours are copied verbatim from templates/actor/
 * header.hbs so the two read as the same set of stats, and the sheet's three
 * groups (resources, status, defense) become the three columns.
 *
 * `relevant` is what makes an icon glow: the state is worth your attention
 * right now. Armor and detection have none, they are steady numbers rather
 * than conditions. `derived` entries read straight off system and have no max.
 */
const CONDITION_GROUPS = [
  [
    {
      key: "graveWounds",
      icon: "fa-light fa-bone-break",
      colour: "rgb(102, 32, 29)",
      relevant: (s) => s.value > 0,
    },
    {
      key: "mind",
      icon: "fa-light fa-head-side-brain",
      colour: "rgb(116, 119, 126)",
      relevant: (s) => s.value < s.max,
    },
  ],
  [
    {
      key: "insanity",
      icon: "fa-light fa-hurricane",
      colour: "rgb(104, 40, 73)",
      relevant: (s) => s.max > 0 && s.value > s.max / 2,
    },
    {
      key: "corruption",
      icon: "fa-sharp fa-thin fa-galaxy",
      colour: "rgb(70, 35, 118)",
      relevant: (s) => s.value > 0,
    },
    {
      key: "fatigue",
      icon: "fa-light fa-tent",
      colour: "rgb(58, 68, 84)",
      relevant: (s) => s.value > 0,
    },
  ],
  [
    {
      key: "armor",
      icon: "fa-light fa-shield-quartered",
      colour: "rgb(96, 74, 48)",
      derived: (sys) => sys.armor?.total,
    },
    {
      key: "detection",
      icon: "fa-light fa-eye",
      colour: "rgb(116, 119, 126)",
      derived: (sys) => sys.detection,
    },
  ],
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

    // The two key shapes the sheet uses: pools live under `stats`, armor and
    // detection under `Condition`. Foundry hands back the key itself when it
    // has no entry, which is what makes the fallback detectable.
    const name = localizeFirst(
      `REDSTEEL.Actor.Character.stats.${id}.value.label`,
      `REDSTEEL.Actor.Character.Condition.${id}`,
    );

    return `<div class="rs-bg3-tip" data-rs-res="${ttEscape(id)}">
      <span class="rs-bg3-tip-name">${ttEscape(name ?? id)}</span>
      <span class="rs-bg3-tip-value">${ttEscape(dataset.ttCurrent ?? "")}</span>
    </div>`;
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
    this.#rerender = foundry.utils.debounce(() => this.render(), 100);
    // Bound copies so the delegated listeners can be removed again on re-render
    // (private methods themselves are not writable).
    this.#boundContextMenu = this.#onContextMenu.bind(this);
    this.#boundDblClick = this.#onDblClick.bind(this);
    this.#boundResourceEdit = this.#onResourceEdit.bind(this);
    this.#boundDragStart = this.#onDragStart.bind(this);
    this.#boundDragOver = this.#onDragOver.bind(this);
    this.#boundDrop = this.#onDrop.bind(this);
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
      toggleConditions: this._onToggleConditions,
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
  #boundDblClick;
  #boundResourceEdit;
  #boundDragStart;
  #boundDragOver;
  #boundDrop;

  /* -------------------------------------------- */

  /**
   * The actor the attribute and skill rows describe: the user's assigned
   * character, otherwise whatever token they have selected, otherwise null.
   */
  get actor() {
    return (
      game.user.character ?? canvas.tokens?.controlled?.[0]?.actor ?? null
    );
  }

  /** How many macro rows this user wants (1..5). One until they press `+`. */
  get rowCount() {
    const raw = Number(game.user.getFlag("redsteel", ROWS_FLAG) ?? DEFAULT_ROWS);
    if (!Number.isFinite(raw)) return DEFAULT_ROWS;
    return Math.clamp(Math.round(raw), MIN_ROWS, MAX_ROWS);
  }

  /**
   * Whether the condition extension is folded down to bare icons. Folded by
   * default: the glow already says which states want attention, and the exact
   * numbers are a click or a hover away.
   */
  get condFolded() {
    const raw = game.user.getFlag("redsteel", COND_FOLDED_FLAG);
    return raw === undefined ? true : !!raw;
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
      portraitImg: actor?.img ?? "icons/svg/mystery-man.svg",
      portraitName: actor?.name ?? game.i18n.localize("REDSTEEL.Bg3Hotbar.NoActor"),
      statuses: this.#prepareStatuses(actor),
      modifier: this.#prepareModifier(actor),
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
          // A gap before the first GM tool, so the two sets read apart.
          groupStart: a.gmOnly && !all[i - 1]?.gmOnly,
        }),
      ),
      resourceBars: this.#prepareResourceBars(actor),
      conditions: this.#prepareConditions(actor),
      condFolded: this.condFolded,
      teammates: this.#prepareTeammates(actor),
      attributes,
      hasAttributes: !!(attributes.primary.length || attributes.secondary.length),
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
    // The Set stops a flagged PC appearing twice when their player is on.
    const members = [];
    const seen = new Set();
    const add = (mate, sortKey) => {
      if (!mate || mate.id === actor?.id || seen.has(mate.id)) return;
      seen.add(mate.id);
      members.push({ mate, sortKey });
    };

    for (const user of game.users.contents) {
      if (user.active && user.id !== game.user.id) add(user.character, `0${user.name}`);
    }
    for (const candidate of game.actors.contents) {
      if (candidate.system?.partyMember) add(candidate, `1${candidate.name}`);
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
   * The sheet's condition row as a single stacked column, with a rule between
   * each of the sheet's three groups. Anything the actor does not carry is
   * skipped, and a group left with nothing in it takes its divider with it: an
   * NPC has mind and armor but none of the status group.
   */
  #prepareConditions(actor) {
    const sys = actor?.system;
    if (!sys) return [];

    const out = [];
    for (const group of CONDITION_GROUPS) {
      const rows = [];
      for (const entry of group) {
        if (entry.derived) {
          const value = entry.derived(sys);
          if (value === undefined || value === null) continue;
          rows.push({ ...entry, value: Number(value) || 0, ratio: false });
          continue;
        }

        const stat = sys.stats?.[entry.key];
        if (!stat) continue;
        const value = Number(stat.value ?? 0);
        const max = Number(stat.max ?? 0);
        rows.push({
          ...entry,
          value,
          max,
          ratio: true,
          relevant: !!entry.relevant?.({ value, max }),
        });
      }
      if (!rows.length) continue;
      if (out.length) out.push({ divider: true });
      out.push(...rows);
    }
    return out;
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
   */
  #preparePotions(actor) {
    const items = (actor?.items ?? []).filter(
      (item) => item.type === "consumable" && item.system?.option === "potion",
    );
    if (!items.length) return null;

    return {
      cols: Math.max(4, Math.ceil(items.length / 4)),
      items: items.map((item) => ({
        id: item.id,
        name: item.localizedName ?? item.name,
        img: item.img,
        qty: Number(item.system?.quantity ?? 1),
      })),
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
      if (!attr) continue;
      const chance = secondaryChance(actor, key);
      groups.secondary.push({
        key,
        tint: SECONDARY_TINTS[key] ?? null,
        label: fromMap(CONFIG.REDSTEEL?.secondaryAttributeAbbreviations, key),
        // Speed has no percentage to show, so it keeps printing its total:
        // that number is the movement allowance and is worth seeing anyway.
        display: chance ?? Number(attr.total ?? 0),
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

    // A race Item carries creature-type tags, which pick the portrait's band
    // colour. Gaining, losing or retagging one repaints it.
    for (const hook of ["createItem", "deleteItem", "updateItem"]) {
      add(hook, (item) => {
        if (item?.type !== "race") return;
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

    // GM token-following mode only: with an assigned character the panel is
    // pinned to it and selection changes are irrelevant.
    add("controlToken", () => {
      if (!game.user.character) this.#rerender();
    });
  }

  /** @override */
  _onClose(options) {
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
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
   * Fold the condition extension down to bare values, or open it back up to
   * value and max.
   *
   * @this {Bg3Hotbar}
   */
  static async _onToggleConditions(event) {
    if (isRightClick(event)) return;
    await game.user.setFlag("redsteel", COND_FOLDED_FLAG, !this.condFolded);
    this.render();
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
   * Double-clicking the portrait opens the character sheet, the same gesture
   * that opens an actor from a token. ApplicationV2's `actions` map only routes
   * clicks, so this is delegated by hand.
   */
  #onDblClick(event) {
    const frame = event.target.closest?.(".rs-bg3-portrait-frame");
    if (!frame) return;
    event.preventDefault();
    // Teammate portraits name their actor; yours falls back to the bound one.
    const uuid = frame.dataset.actorUuid;
    const actor = uuid ? fromUuidSync(uuid) : this.actor;
    // Foundry hides the sheet from users below LIMITED anyway; bailing here
    // keeps a GM-selected token from throwing a permission warning at a player.
    if (!actor?.testUserPermission(game.user, "LIMITED")) return;
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

  Hooks.once("ready", () => {
    document.body.classList.add(BODY_CLASS);
    const panel = new Bg3Hotbar();
    ui.redsteelHotbar = panel;
    panel.registerHooks();
    panel.render(true);
  });
}
