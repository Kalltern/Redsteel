/**
 * Learn window — the level-up screen.
 *
 * A Pathfinder-style grid: rank columns I–X across the top, one full-width
 * block per purchasable track stacked down the page. The whole column is the
 * click target: clicking an affordable, unlocked column buys that rank.
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

import { PROGRESSION_TRACKS } from "../helpers/progression.mjs";
import { RANK_EFFECTS } from "../helpers/progressionEffects.mjs";
import {
  evaluateRequirements,
  getRankGrants,
  getRankState,
  hasTeacher,
  getLearnSection,
  getTrackRank,
  getTrackTab,
  LEARN_SECTION_ORDER,
  getWallet,
  isTracked,
  purchaseRank,
  refundRank,
  setTeacher,
  setTrackedIds,
} from "../helpers/progressionEngine.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } =
  foundry.applications.api;

const TEMPLATE = "systems/redsteel/templates/actor/learn-window.hbs";

/**
 * The whole viewport. Ten rank columns plus a label gutter need the width, and
 * the point of the window is comparing tracks down the page, so it opens at
 * screen size. It stays movable and resizable; this only decides where it
 * starts and keeps it whole across a browser resize.
 *
 * Note the z-index is deliberately left to Foundry: forcing this window above
 * everything would put its own refund confirmation underneath it.
 */
const VIEWPORT_POSITION = () => ({
  left: 0,
  top: 0,
  width: window.innerWidth,
  height: window.innerHeight,
});

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

/** The groups an `anyRank` requirement can name, and the label each one uses. */
/* The book writes a "any track of this group" gate as a bare singular:
   "Doktrína III", "Škola IV", "Zbraň III". The chip copies that wording; the
   sentence explaining it lives in the tooltip. */
const GROUP_LABELS = {
  doctrines: "REDSTEEL.Learn.Group.doctrine",
  schools: "REDSTEEL.Learn.Group.school",
  weaponSkills: "REDSTEEL.Learn.Group.weapon",
};

/* The same three groups in running-text form, for the explaining tooltip. */
const GROUP_LABELS_LOWER = {
  doctrines: "REDSTEEL.Learn.Group.doctrineLower",
  schools: "REDSTEEL.Learn.Group.schoolLower",
  weaponSkills: "REDSTEEL.Learn.Group.weaponLower",
};

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
      return game.i18n.format("REDSTEEL.Learn.Req.feature", { name: req.name });
    case "flag":
      return game.i18n.format("REDSTEEL.Learn.Req.flag", {
        name: flagLabel(req.key),
      });
    case "specNode": {
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
    case "gm": {
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
        name: req.name,
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
      return game.i18n.format("REDSTEEL.Learn.Req.Tip.specNode", { spec });
    }
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
function describeRankChips(trackId, rank) {
  const entries = RANK_EFFECTS[trackId]?.[rank - 1] ?? [];
  const out = [];
  const byShape = new Map();

  for (const entry of entries) {
    if (!entry) continue;
    if (entry.t === "text") {
      out.push({ text: game.i18n.localize(entry.key), prose: true });
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
          cells: Array.from({ length: 10 }, (_, i) => ({
            rank: i + 1,
            col: i + 2,
            text: "",
          })),
        };
        byLabel.set(entry.label, row);
        rows.push(row);
      }
      if (entry.t !== "pct") row.rating = false;
      row.cells[rank - 1].text = formatValue(entry);
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
      icon: "fa-solid fa-graduation-cap",
      resizable: true,
    },
    position: { width: 1180, height: 760 },
    actions: {
      switchTab: LearnWindow._onSwitchTab,
      buyRank: LearnWindow._onBuyRank,
      toggleTeacher: LearnWindow._onToggleTeacher,
      refundRank: LearnWindow._onRefundRank,
      openPicker: LearnWindow._onOpenPicker,
      savePicker: LearnWindow._onSavePicker,
      cancelPicker: LearnWindow._onCancelPicker,
    },
  };

  static PARTS = {
    body: {
      template: TEMPLATE,
      // Buying a rank re-renders the whole part, which would otherwise throw
      // the reader back to the top of a long list of tracks. Naming the
      // scroller here has ApplicationV2 carry its position across the render.
      scrollable: [".rs-learn-grid", ".rs-learn-picker"],
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
    const initial = super._initializeApplicationOptions(options);
    // Sized here rather than after the first render, so the window is never
    // painted at the fallback size and then snapped to full screen.
    Object.assign(initial.position, VIEWPORT_POSITION());
    return initial;
  }

  /** Which tab is showing. Transient — never written to the actor. */
  #tab = "combat";

  /** True while the track picker replaces the grid. Also transient. */
  #picking = false;

  /** Resolved ability documents, keyed by UUID. Survives re-renders. */
  #grantCache = new Map();

  /** The updateActor hook id, so it can be released on close. */
  #hookId = null;

  /** Bound change listener for the wallet fields. */
  #boundChange = null;

  /** Bound viewport listener, so a browser resize keeps the window full. */
  #boundResize = null;

  /* ---------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;

    const isContentTab = this.#tab === "combat" || this.#tab === "skills";
    const sections =
      isContentTab && !this.#picking ? await this.#buildSections() : [];
    const picker = this.#picking ? this.#buildPicker() : [];

    return Object.assign(context, {
      actorId: actor?.id ?? "",
      editable: !!actor?.isOwner,
      isGM: game.user.isGM,
      tab: this.#tab,
      isContentTab,
      picking: this.#picking,
      picker,
      wallet: getWallet(actor),
      adjust: {
        cp: Number(actor?.system?.progression?.adjust?.cp ?? 0),
        sp: Number(actor?.system?.progression?.adjust?.sp ?? 0),
      },
      rankHeaders: RANK_HEADERS,
      sections,
    });
  }

  /**
   * The whole grid: blocks in this tab's order, tracks inside each block in
   * the order the price table declares them (which is the rules sheet's own
   * order — sorting it would scramble the book's layout).
   */
  async #buildSections() {
    const actor = this.actor;
    const buckets = new Map();

    for (const [trackId, track] of Object.entries(PROGRESSION_TRACKS)) {
      // Each tab owns its own half of the price table, and inside a tab the
      // grid is only the tracks this character trains. Everything else is
      // still buyable, it just has to be picked first — see #buildPicker.
      if (getTrackTab(trackId) !== this.#tab) continue;
      if (!isTracked(actor, trackId)) continue;
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
      });
      const section = getLearnSection(trackId);
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
      cell.isHeld = held > 0 && cell.rank === held;
      cell.showProse = !cell.grants.length && cell.prose.length > 0;
      cell.showIcons = cell.grants.length > 0 || cell.showProse;
      cell.hitStyle = `grid-row: ${nodeRow} / span ${costRow - nodeRow + 1}; grid-column: ${cell.col}`;
      cell.nodeStyle = `grid-row:${nodeRow};grid-column:${cell.col}`;
      cell.iconStyle = iconRow ? `grid-row:${iconRow};grid-column:${cell.col}` : "";
      cell.segStyle = segRow ? `grid-row:${segRow};grid-column:${cell.col}` : "";
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
      // Two ledger rules, each its own grid item spanning every column so the
      // line runs unbroken across the block instead of restarting in each rank.
      // They sit behind the cards; see .rs-learn-rule.
      ruleStyles: [
        `grid-row:${reqRow};grid-column:1 / -1`,
        `grid-row:${costRow};grid-column:1 / -1`,
      ],
      costLabel: priceLabel(cells),
    });
  }

  /**
   * The track picker: every track in the book, grouped the same way the grid
   * groups them, each with a checkbox.
   *
   * A track with a rank already bought is checked and locked — unpicking it
   * would hide a purchase from the only screen that can refund it.
   */
  #buildPicker() {
    const actor = this.actor;
    const buckets = new Map();

    for (const [trackId, track] of Object.entries(PROGRESSION_TRACKS)) {
      if (getTrackTab(trackId) !== this.#tab) continue;
      const held = getTrackRank(actor, track.group, track.key);
      const section = getLearnSection(trackId);
      if (!buckets.has(section)) buckets.set(section, []);
      buckets.get(section).push({
        id: trackId,
        label: trackLabel(track.group, track.key),
        held,
        checked: isTracked(actor, trackId),
        locked: held > 0,
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
    const { state, price, requirements } = getRankState(
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

    const currency = price?.currency ?? null;
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

    return {
      rank,
      // Column two is rank I: column one is the label gutter.
      col: rank + 1,
      state,
      // A rank the book does not sell gets no node on the track and no line
      // running into it.
      exists: state !== "unavailable",
      cost: price?.cost ?? null,
      currency,
      // Every clause of this rank as a chip, for the Requirements row.
      reqChips: requirementChips(trackId, rank, results),
      grants: await this.#resolveGrants(getRankGrants(trackId, rank)),
      // Prose has no stat to sit under, so it never becomes a row. It shows as
      // a chip in the icon row when the rank has no ability icon of its own.
      prose: effects.filter((e) => e.prose).map((e) => e.text),
      // Segment mode's chips: everything this rank does, merged where several
      // stats move by the same step. Built for every cell and used only by the
      // segment layout, which costs nothing and keeps the cell shape uniform.
      chips: describeRankChips(trackId, rank),
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
          if (doc) entry = { uuid, name: doc.name, img: doc.img };
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
   * Fill the viewport.
   *
   * Ten rank columns plus a label gutter need the width, and the whole point of
   * the window is comparing tracks down the page, so it opens at screen size
   * rather than in a box. Still movable and resizable afterwards; this only
   * decides where it starts and keeps it whole across a browser resize.
   */
  #fillScreen() {
    this.setPosition(VIEWPORT_POSITION());
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender?.(context, options);
    this.#fillScreen();
    this.#boundResize = () => this.#fillScreen();
    window.addEventListener("resize", this.#boundResize);
    // Buying a rank writes to the actor, and so does the sheet next to this
    // window. Both must repaint the grid, so the window follows the document
    // rather than only its own clicks.
    this.#hookId = Hooks.on("updateActor", (doc) => {
      if (doc?.id === this.actor?.id) this.render();
    });
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender?.(context, options);
    const root = this.element;
    if (!(root instanceof HTMLElement)) return;

    // Re-render replaces the part but keeps this root, so the previous
    // listener is removed instead of a second copy being stacked on it.
    if (this.#boundChange) root.removeEventListener("change", this.#boundChange);
    this.#boundChange = (event) => this.#onFieldChange(event);
    root.addEventListener("change", this.#boundChange);
  }

  /** @override */
  _onClose(options) {
    if (this.#boundResize) {
      window.removeEventListener("resize", this.#boundResize);
      this.#boundResize = null;
    }
    if (this.#hookId !== null) {
      Hooks.off("updateActor", this.#hookId);
      this.#hookId = null;
    }
    const root = this.element;
    if (this.#boundChange && root instanceof HTMLElement) {
      root.removeEventListener("change", this.#boundChange);
    }
    this.#boundChange = null;
    super._onClose?.(options);
  }

  /**
   * The wallet bar's fields. ApplicationV2 submits nothing here (this window is
   * not a form application), so each field writes itself.
   */
  #onFieldChange(event) {
    const el = event.target;
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
    // the grid rather than on a half-finished selection.
    this.#picking = false;
    this.render();
  }

  /** @this {LearnWindow} */
  static async _onBuyRank(event, target) {
    event.preventDefault();
    if (!this.actor?.isOwner) return;
    const trackId = target?.dataset?.trackId;
    const rank = Number(target?.dataset?.rank);
    if (!trackId || !rank) return;

    const bought = await purchaseRank(this.actor, trackId, rank);
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
   * Give the top rank of a track back. Confirmed first: a mis-click here would
   * silently hand points back and drop an ability, and the player would not
   * necessarily notice which track moved.
   *
   * @this {LearnWindow}
   */
  static async _onRefundRank(event, target) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.actor?.isOwner) return;
    const trackId = target?.dataset?.trackId;
    if (!trackId) return;

    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("REDSTEEL.Learn.refund") },
      content: `<p>${game.i18n.localize("REDSTEEL.Learn.refundConfirm")}</p>`,
      modal: true,
      rejectClose: false,
    });
    if (!confirmed) return;

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
