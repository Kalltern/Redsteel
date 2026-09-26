/**
 * SPELL SCROLLS (Svitky)
 *
 * A scroll is one spell somebody else already did the hard work of casting,
 * trapped in ink. Its seal can be broken once, letting that spell loose, or
 * the scroll can be unpicked and copied into a grimoire. Either way the
 * scroll does not survive it.
 *
 * TWO SHAPES, ONE ITEM TYPE. `system.spell` is what tells them apart:
 *
 *   - empty  -> a MASTER scroll, a case holding every scroll of one school and
 *     rank. It is a GM object. Its sheet lists the pool (read live from the
 *     spell compendium), single scrolls can be taken out of it by hand, and
 *     handing the whole case to a character draws one at random.
 *   - a uuid -> a CONCRETE scroll, one readable spell.
 *
 * WHY THE POOL IS NOT A COMPENDIUM. There are 365 non-wild, non-variant arcane
 * spells. Authoring a scroll document for each would be 365 records to keep in
 * step with All-Spells by hand, and they would rot the first time a spell was
 * renamed or re-ranked. So the pool is derived from the spell pack's index and
 * cached for the session; the only authored records are the 28 cases.
 *
 * NO BLOOD. Blood magic is not arcane and is gated behind the bloodSchool
 * specialisation, so it has no scrolls at all (user ruling 2026-09-21). See
 * EXCLUDED_SCHOOLS -- that is the one line to change if it ever should.
 *
 * UNIDENTIFIED MEANS UNIDENTIFIED. A fresh concrete scroll carries the generic
 * scroll art and reads as "Unidentified Scroll" everywhere a name is shown,
 * because the inventory grid renders `item.img` and the tooltip renders
 * `localizedName` -- leaving the spell's own icon on it would give the answer
 * away before anyone rolled. The true name and art are stashed on
 * `flags.redsteel.scroll` and restored when Arcana cracks it.
 *
 * WHAT IS NOT GATED. Copying a scroll into a book ignores the school rank
 * (`writeSpell`'s `ignoreRank`): a scroll is a shortcut past the teacher, not
 * past the school. The spell lands in the book and simply is not projected
 * onto the actor until the rank catches up, which syncSpellbooks already
 * handles on its own. Breaking a seal is open to anybody -- the scroll
 * supplies `system.castBonus` to the roll so its own rank carries the work.
 */

import {
  SPELL_PACK_ID,
  SPELL_SCHOOLS,
  SPELL_RANKS,
  getSpellbooks,
  writeSpell,
  variantChildIds,
} from "./spellbook.mjs";
import { performCast } from "./castSpell.mjs";
import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";
import {
  getRerollTokensForSkill,
  getEligibleRerolls,
  consumeReroll,
  pickRerollPool,
} from "./rerolls.mjs";
import { scheduleRerollRefresh } from "./calendariaIntegration.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } =
  foundry.applications.api;

const APP_ID = "redsteel-spell-scroll";
const TEMPLATE = "systems/redsteel/templates/scroll/scroll-window.hbs";
const ICON = "fa-light fa-scroll";

/** Crossfade timings for the window's in-place body swap, in ms. */
const FADE_MS = 130;
const GROW_MS = 220;

/**
 * Schools that never produce a scroll.
 *
 * Blood is not arcane magic and rides on its specialisation rather than a rank
 * (user ruling 2026-09-21). Gnosis has no spells in the pack at all, so a case
 * for it would always be empty -- drop it from the list here rather than ship
 * four cases nobody can open.
 */
const EXCLUDED_SCHOOLS = new Set(["blood", "gnosis"]);

/** The schools a scroll can belong to, in the system-wide school order. */
export const SCROLL_SCHOOLS = SPELL_SCHOOLS.filter(
  (school) => !EXCLUDED_SCHOOLS.has(school),
);

/**
 * The ranks a scroll can carry. Wild magic is innate -- it arrives with the
 * school rank and costs nothing -- so there is nothing for a scroll to sell.
 */
export const SCROLL_RANKS = SPELL_RANKS.filter((rank) => rank !== "wild");

/**
 * What the scroll's own inscription is worth on the cast roll, by rank.
 *
 * These are the negated median difficulties of the spells at each rank in the
 * pack (expert -10, master -30, grandmaster -60; apprentice sits at +25 and
 * needs no help). The scroll carries the original caster's work, so it offsets
 * the spell's own difficulty rather than the reader's ignorance. Seeded onto
 * the 28 cases as data -- this map is the default, not the authority.
 */
export const SCROLL_RANK_CAST_BONUS = {
  apprentice: 0,
  expert: 10,
  master: 30,
  grandmaster: 60,
};

/**
 * The art every concrete scroll wears until Arcana has cracked it.
 *
 * Deliberately NOT the case's own art: a drawn scroll has to read as a single
 * sheet, and identifying it swaps this for the spell's own icon.
 */
export const SCROLL_UNKNOWN_IMG =
  "icons/sundries/scrolls/scroll-bound-green.webp";

/** Actor flag holding the scrolls this character has already failed to read. */
const LOCK_FLAG = "scrollIdentifyFails";

/* -------------------------------------------------------------------------- */
/*  The pool                                                                  */
/* -------------------------------------------------------------------------- */

/** `${school}|${rank}` -> [{uuid, name, img}], read once per session. */
let catalogue = null;

/**
 * Every spell a scroll could carry, grouped by school and rank.
 *
 * Mirrors loadWildSpells in utils/spellbook.mjs: one indexed read of the pack,
 * variants and miracles filtered out, cached because the pack only changes
 * when it is rebuilt and that needs a reload anyway.
 */
export async function loadScrollCatalogue() {
  if (catalogue) return catalogue;
  const bySlot = new Map();
  const pack = game.packs.get(SPELL_PACK_ID);
  if (pack) {
    try {
      const index = await pack.getIndex({
        fields: [
          "type",
          "img",
          "system.type",
          "system.rank",
          "system.option",
          "system.variants",
          "system.localizationKey",
        ],
      });
      // .contents, not for...of: iterating a Collection yields [key, value].
      const rows = index.contents.filter((entry) => entry.type === "spell");
      // A variant is a version of its parent, resolved in the cast dialog, and
      // never a thing of its own -- so it is never its own scroll either.
      const children = variantChildIds(rows);
      for (const entry of rows) {
        if (entry.system?.option === "divine") continue;
        if (children.has(entry._id)) continue;
        const school = String(entry.system?.type ?? "");
        const rank = String(entry.system?.rank ?? "").toLowerCase();
        if (!SCROLL_SCHOOLS.includes(school)) continue;
        if (!SCROLL_RANKS.includes(rank)) continue;
        const slot = `${school}|${rank}`;
        if (!bySlot.has(slot)) bySlot.set(slot, []);
        bySlot.get(slot).push({
          uuid: entry.uuid ?? `Compendium.${SPELL_PACK_ID}.Item.${entry._id}`,
          name: spellIndexName(entry),
          img: entry.img ?? SCROLL_UNKNOWN_IMG,
        });
      }
      for (const list of bySlot.values()) {
        list.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
      }
    } catch (err) {
      console.warn(`Redsteel | Scrolls: could not index ${SPELL_PACK_ID}`, err);
    }
  }
  catalogue = bySlot;
  return catalogue;
}

/** A pack spell's name in the active language, the way the Learn window reads it. */
function spellIndexName(entry) {
  const key = entry.system?.localizationKey?.trim();
  if (key && game.i18n.has(key, false)) return game.i18n.localize(key);
  return String(entry.name ?? "");
}

/**
 * The scrolls one case holds.
 * @returns {Promise<{uuid: string, name: string, img: string}[]>}
 */
export async function getScrollPool(school, rank) {
  const bySlot = await loadScrollCatalogue();
  return bySlot.get(`${school}|${String(rank ?? "").toLowerCase()}`) ?? [];
}

/**
 * The same read, without awaiting -- for preCreateItem, which cannot be async.
 * Empty until loadScrollCatalogue has run; registerScrollHooks warms it on
 * ready so that window never opens in practice.
 */
function poolSync(school, rank) {
  return catalogue?.get(`${school}|${String(rank ?? "").toLowerCase()}`) ?? [];
}

/** The catalogue row for one spell uuid, or null. */
function poolEntry(uuid) {
  if (!catalogue || !uuid) return null;
  for (const list of catalogue.values()) {
    const hit = list.find((entry) => entry.uuid === uuid);
    if (hit) return hit;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Reading a scroll item                                                     */
/* -------------------------------------------------------------------------- */

/** True for a case: a scroll item that names no spell yet. */
export function isMasterScroll(item) {
  return item?.type === "scroll" && !String(item.system?.spell ?? "").trim();
}

/** True once Arcana has read the scroll. A case is never a mystery. */
export function isScrollIdentified(item) {
  if (item?.type !== "scroll") return false;
  if (isMasterScroll(item)) return true;
  return item.flags?.redsteel?.scroll?.identified === true;
}

/**
 * What a concrete scroll is called on screen.
 *
 * Prefers the live catalogue over the name stashed at creation, so switching
 * language (or renaming the spell in the pack) follows through. Returns null
 * for anything that should keep its own name -- item.mjs treats that as "not
 * mine" and falls back.
 */
export function scrollDisplayName(item) {
  if (item?.type !== "scroll" || isMasterScroll(item)) return null;
  if (!isScrollIdentified(item)) {
    return game.i18n.localize("REDSTEEL.Scroll.Unidentified");
  }
  const stash = item.flags?.redsteel?.scroll ?? {};
  const spell = poolEntry(item.system?.spell)?.name || stash.name || "";
  return game.i18n.format("REDSTEEL.Scroll.Name", { spell });
}

/** The fields that turn a case into one readable scroll. Dotted, for updateSource. */
function concretePatch(pick) {
  return {
    // The stored name keeps the spell so the GM can read the sidebar; every
    // player-facing surface goes through scrollDisplayName instead.
    name: `Scroll: ${pick.name}`,
    img: SCROLL_UNKNOWN_IMG,
    "system.spell": pick.uuid,
    // A case carries a localization key for its OWN name. A scroll taken out
    // of it must not inherit it, or it would render as the case again.
    "system.localizationKey": "",
    "flags.redsteel.scroll": {
      identified: false,
      img: pick.img,
      name: pick.name,
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Drawing a scroll out of a case                                            */
/* -------------------------------------------------------------------------- */

/**
 * Handing a case to a character draws one scroll out of it.
 *
 * A preCreateItem hook rather than a branch in the sheet's `_onDropItem`, so
 * the draw happens for a drop onto the sheet, a drop onto a token and a
 * scripted create alike, and the case is never stored on the actor at all.
 * A case dropped anywhere that is not an Actor (the Items directory, a folder)
 * stays a case, which is what keeps the library intact.
 */
function onPreCreateItem(item, _data, _options, _userId) {
  if (item.type !== "scroll") return;
  if (!(item.parent instanceof Actor)) return;
  if (!isMasterScroll(item)) return;

  const school = String(item.system?.school ?? "");
  const rank = String(item.system?.rank ?? "").toLowerCase();
  const pool = poolSync(school, rank);
  if (!pool.length) {
    // Better a case the GM can see and fix than a silently swallowed drop.
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Scroll.Warn.Empty"));
    return;
  }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  item.updateSource(concretePatch(pick));
}

/**
 * Take one named scroll out of a case by hand (the case sheet's Take out).
 *
 * The copy is created wherever the case lives: on the same actor if it is
 * owned, otherwise in the world Items directory beside it. A case sitting in a
 * compendium yields into the world, since a pack is not writable from here.
 *
 * @param {Item} master  The case.
 * @param {string} uuid  The pack spell to bind.
 * @returns {Promise<Item|null>}
 */
export async function createConcreteScroll(master, uuid) {
  if (!game.user.isGM) return null;
  if (!isMasterScroll(master)) return null;

  const pool = await getScrollPool(master.system?.school, master.system?.rank);
  const pick = pool.find((entry) => entry.uuid === uuid);
  if (!pick) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Scroll.Warn.NoSpell"));
    return null;
  }

  const data = master.toObject();
  delete data._id;
  data.system.quantity = 1;
  // Expanded rather than merged: concretePatch is dotted for updateSource.
  for (const [path, value] of Object.entries(concretePatch(pick))) {
    foundry.utils.setProperty(data, path, value);
  }

  const actor = master.parent instanceof Actor ? master.parent : null;
  if (actor) {
    const [created] = await actor.createEmbeddedDocuments("Item", [data]);
    return created ?? null;
  }
  // A case in a pack has no world folder to land beside.
  return Item.create(data, {
    folder: master.pack ? null : (master.folder?.id ?? null),
  });
}

/* -------------------------------------------------------------------------- */
/*  The Arcana test                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One Arcana margin test, the same shape as every other skill test in the
 * system (`rating + difficulty - 1d100`, roll-advantage bias applied to a
 * copy of the roll data, never to the actor's live bias object).
 *
 * @param {Actor} actor
 * @param {number} difficulty  Signed, system convention: higher is easier.
 */
export async function rollArcana(actor, difficulty) {
  const skill = actor.system.skills?.arcana ?? {};
  const rating = Number(skill.rating) || 0;
  const critSuccess = Number(skill.criticalSuccessThreshold ?? 0);
  // A natural 100 always fumbles; no relief may carry the window past it.
  const critFailure = Math.min(
    100,
    Number(skill.criticalFailureThreshold ?? 101),
  );

  const total = rating + (Number(difficulty) || 0);
  const roll = new Roll(`${total} - 1d100`, withRollBias({}, actor));
  tagRollSkill(roll, "arcana");
  await roll.evaluate();
  const d100 = roll.dice?.[0]?.total ?? total - roll.total;

  return {
    d100,
    margin: roll.total,
    rating,
    difficulty: Number(difficulty) || 0,
    critSuccess: d100 <= critSuccess,
    critFailure: d100 >= critFailure,
    success: roll.total >= 0 && !(d100 >= critFailure),
  };
}

/**
 * Spend one Arcana re-roll charge, Calendaria refresh included.
 * Mirrors the Alchemy craft re-roll (actor-sheet `_rerollCraft`).
 * @returns {Promise<boolean>} whether a charge was actually spent.
 */
export async function spendArcanaReroll(actor, { critFailure = false } = {}) {
  const eligible = getEligibleRerolls(
    actor,
    getRerollTokensForSkill(actor, "arcana"),
    { critFailure },
  );
  if (!eligible.length) {
    ui.notifications.info(game.i18n.localize("REDSTEEL.Scroll.Warn.NoRerolls"));
    return false;
  }
  const chosen =
    eligible.length === 1 ? eligible[0] : await pickRerollPool(eligible);
  if (!chosen) return false;
  if (!(await consumeReroll(actor, chosen.itemId, chosen.poolIndex))) return false;
  try {
    await scheduleRerollRefresh(actor, chosen, { critFailure });
  } catch (err) {
    console.warn("Redsteel | Calendaria scheduling failed", err);
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/*  Identify lockout                                                          */
/* -------------------------------------------------------------------------- */

/**
 * True when this character has already failed to read this scroll.
 *
 * One attempt per long rest (user ruling 2026-09-21). Recorded on the ACTOR
 * rather than the scroll, so the lockout follows the reader: handing a scroll
 * you could not crack to somebody else lets them try today, not tomorrow.
 * applyLongRest clears the whole flag, the way it clears firstAidProgress.
 */
export function isIdentifyLocked(actor, scroll) {
  return actor?.flags?.redsteel?.[LOCK_FLAG]?.[scroll?.id] === true;
}

/* -------------------------------------------------------------------------- */
/*  Consuming a scroll                                                        */
/* -------------------------------------------------------------------------- */

/** Spend one scroll off a stack, or destroy the last of them. */
async function consumeScroll(scroll) {
  const quantity = Number(scroll.system?.quantity) || 1;
  if (quantity > 1) return scroll.update({ "system.quantity": quantity - 1 });
  return scroll.delete();
}

/** The spell a concrete scroll carries, or null with a warning. */
async function scrollSpell(scroll) {
  const uuid = String(scroll?.system?.spell ?? "").trim();
  const source = uuid ? await fromUuid(uuid) : null;
  if (!source || source.type !== "spell") {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Scroll.Warn.NoSpell"));
    return null;
  }
  return source;
}

/* -------------------------------------------------------------------------- */
/*  Breaking the seal                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Cast the scroll's spell: no mana, no channelling evaluation, scroll spent.
 *
 * `freeCast` skips the mana deduction and `ignoreChanneling` suppresses the
 * channelling evaluation, both already honoured the whole way down the cast
 * pipeline. The spell is built as a NON-PERSISTED owned Item so `spell.actor`
 * resolves for performCast without writing anything to the pack or the actor.
 *
 * Open to any character, caster or not (user ruling 2026-09-21): an offensive
 * spell still rolls to hit, but `system.castBonus` puts the original scribe's
 * work behind it so the reader's own Channeling is not the whole story.
 *
 * @returns {Promise<boolean>} whether the seal was broken.
 */
export async function castFromScroll(actor, scroll, { confirm = true } = {}) {
  if (!actor?.isOwner) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Scroll.Warn.NotOwner"));
    return false;
  }
  if (isMasterScroll(scroll)) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Scroll.Warn.NoSpell"));
    return false;
  }
  const source = await scrollSpell(scroll);
  if (!source) return false;

  // Breaking the seal burns the scroll, and an unidentified one is a gamble
  // taken blind -- neither is something to do on a stray right-click.
  if (confirm) {
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("REDSTEEL.Scroll.Window.Cast") },
      content: `<p>${game.i18n.localize("REDSTEEL.Scroll.Window.CastHint")}</p>`,
    });
    if (!ok) return false;
  }

  // The compendium `_id` is KEPT on purpose. A sustained spell parks its
  // upkeep on a channeling effect carrying `spellId`, and resolveChannelingTick
  // resolves that id against the actor, the world, and then every Item pack
  // (resolveVariantItem). Strip the id and the tick finds nothing and silently
  // deletes the effect, so a sustained spell read off a scroll would end after
  // one round. The document is never added to a collection, so a live id here
  // collides with nothing.
  const data = source.toObject();
  const spell = new Item.implementation(data, { parent: actor });

  const controlled = canvas?.tokens?.controlled?.[0] ?? null;
  const token =
    controlled?.actor?.id === actor.id
      ? controlled
      : (actor.getActiveTokens()[0] ?? null);

  const cast = await performCast(actor, spell, {
    token,
    freeCast: true,
    ignoreChanneling: true,
    extraAttackBonus: Number(scroll.system?.castBonus) || 0,
  });
  if (cast === false) return false;

  const spellName = poolEntry(scroll.system?.spell)?.name ?? source.name;
  await consumeScroll(scroll);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: game.i18n.format("REDSTEEL.Scroll.Chat.Cast", {
      actor: actor.name,
      spell: spellName,
    }),
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/*  The window                                                                */
/* -------------------------------------------------------------------------- */

/** Open the scroll's own small window. */
export async function openScrollWindow(actor, scroll) {
  if (!actor?.isOwner) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Scroll.Warn.NotOwner"));
    return null;
  }
  await loadScrollCatalogue();
  const app = new ScrollWindow({ actor, scroll });
  return app.render(true);
}

/**
 * One scroll, one window: identify it, copy it into a grimoire, or read it.
 *
 * The roll is PARKED rather than applied. A test is rolled, shown, and can be
 * re-rolled with a real charge; nothing is written and no scroll is destroyed
 * until Accept. Copying destroys the scroll whether the test landed or not
 * (user ruling 2026-09-21), so committing it on the roll itself would take the
 * re-roll away from the player who needed it most.
 */
class ScrollWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["redsteel", "rs-scroll"],
    window: { title: "REDSTEEL.Scroll.Window.Title", icon: ICON },
    position: { width: 420, height: "auto" },
    actions: {
      identify: ScrollWindow._onIdentify,
      write: ScrollWindow._onWrite,
      cast: ScrollWindow._onCast,
      reroll: ScrollWindow._onReroll,
      accept: ScrollWindow._onAccept,
    },
  };

  static PARTS = { body: { template: TEMPLATE } };

  constructor({ actor, scroll, ...options } = {}) {
    // One window per scroll. The `{id}` placeholder in DEFAULT_OPTIONS only
    // substitutes for document sheets, so a shared literal id would make the
    // second scroll re-render the first one's window instead of opening.
    super({ id: `${APP_ID}-${scroll?.id ?? foundry.utils.randomID()}`, ...options });
    this.actor = actor;
    this.scroll = scroll;
    this.bookId = getSpellbooks(actor)[0]?.id ?? "";
  }

  /** The parked test: {mode: "identify"|"write", outcome} or null. */
  #pending = null;

  /** A committed identify roll, kept on screen after the body has morphed. */
  #revealed = null;

  /** Set while a test is resolving, so a double click cannot spend twice. */
  #busy = false;

  /** Set while #morph is swapping the body, so _onRender can hide the new one. */
  #morphing = false;

  async _prepareContext() {
    const scroll = this.scroll;
    const identified = isScrollIdentified(scroll);
    const shown = this.#pending?.outcome ?? this.#revealed;
    const entry = poolEntry(scroll.system?.spell);
    const stash = scroll.flags?.redsteel?.scroll ?? {};
    const books = getSpellbooks(this.actor).map((book) => ({
      id: book.id,
      name: book.localizedName ?? book.name,
      selected: book.id === this.bookId,
    }));

    return {
      identified,
      locked: isIdentifyLocked(this.actor, scroll),
      actorName: this.actor.name,
      name: scrollDisplayName(scroll) ?? scroll.localizedName,
      img: scroll.img,
      spellName: identified ? (entry?.name ?? stash.name ?? "") : "",
      spellImg: identified ? (entry?.img ?? stash.img ?? scroll.img) : scroll.img,
      schoolLabel: game.i18n.localize(
        `REDSTEEL.Actor.Character.schools.${scroll.system?.school}.label`,
      ),
      rankLabel: game.i18n.localize(
        `REDSTEEL.Item.Spell.FIELDS.${scroll.system?.rank}.label`,
      ),
      identifyDifficulty: fmtSigned(scroll.system?.identifyDifficulty),
      writeDifficulty: fmtSigned(scroll.system?.writeDifficulty),
      // Both shapes: the number decides whether the pill shows at all (a
      // formatted "0" is a truthy string and would always render), the text
      // is what it prints.
      castBonus: Number(scroll.system?.castBonus) || 0,
      castBonusText: fmtSigned(scroll.system?.castBonus),
      books,
      hasBooks: books.length > 0,
      // The readout outlives the parked test. A successful identify commits
      // itself, so its roll has to stay on screen above the scroll it cracked
      // rather than vanish with the buttons that were waiting on it.
      result: shown ? { ...shown, marginText: fmtSigned(shown.margin) } : null,
      pending: this.#pending ? { mode: this.#pending.mode } : null,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    // Mid-morph the new body arrives already hidden, so the crossfade never
    // shows a frame of it at the old size.
    if (this.#morphing) {
      this.element
        .querySelector(".rs-scroll-window")
        ?.classList.add("is-entering");
    }
    const select = this.element.querySelector("[name=book]");
    if (select) {
      select.addEventListener("change", (ev) => {
        this.bookId = ev.target.value;
      });
    }
  }

  /** Roll a test and park it. A cracked scroll settles itself. */
  async #park(mode, difficulty) {
    if (this.#busy) return;
    this.#busy = true;
    let outcome;
    try {
      outcome = await rollArcana(this.actor, difficulty);
      this.#pending = { mode, outcome };
    } finally {
      this.#busy = false;
    }
    // A successful identify has nothing left to decide -- nobody spends a
    // re-roll charge on a scroll they have already read -- so it commits
    // itself and the window becomes the identified scroll in place, instead
    // of parking behind an Accept that would never be declined.
    if (mode === "identify" && outcome.success) return this.#reveal(outcome);
    await this.#morph();
  }

  /** Commit a successful identify and morph into the identified scroll. */
  async #reveal(outcome) {
    this.#busy = true;
    try {
      await this.#commitIdentify(outcome);
    } finally {
      this.#busy = false;
    }
    this.#pending = null;
    this.#revealed = outcome;
    await this.#morph();
  }

  /**
   * Re-render the body in place, crossfading the old content into the new.
   *
   * The window is never closed and reopened: ApplicationV2 swaps the part's
   * HTML inside the live frame, so all this has to do is hide the seam. The
   * old body fades out, the content box is pinned to the height it had, and
   * the new body fades in while that height eases to its own. The pin is what
   * matters -- a `height: "auto"` window otherwise snaps to the new size in a
   * single frame, which is the jump this exists to avoid.
   */
  async #morph() {
    const box = this.element?.querySelector(".window-content");
    const body = box?.querySelector(".rs-scroll-window");
    // Nothing on screen to animate: first render, or closed mid-roll.
    if (!box || !body) {
      await this.render();
      return;
    }

    const from = box.getBoundingClientRect().height;
    // Pinned BEFORE the render, not after: the swap happens inside render, and
    // an unpinned box would be free to resize for the frame in between.
    box.classList.add("rs-scroll-morphing");
    box.style.height = `${from}px`;
    body.classList.add("is-fading");
    await wait(FADE_MS);

    this.#morphing = true;
    try {
      await this.render();
    } finally {
      this.#morphing = false;
    }

    // Re-queried: _replaceHTML swaps the part element, so `body` is detached.
    const grown = this.element?.querySelector(".window-content");
    const next = grown?.querySelector(".rs-scroll-window");
    if (!grown) return;
    if (!next) {
      grown.style.height = "";
      grown.classList.remove("rs-scroll-morphing");
      return;
    }

    // Measure the new body's own height and put the pin straight back, all in
    // one task: the browser reflows but never paints the intermediate size.
    // The transition is muted across the measurement, so releasing the pin to
    // `auto` for that one reflow cannot start an animation of its own.
    grown.style.transition = "none";
    grown.style.height = "";
    const to = grown.getBoundingClientRect().height;
    grown.style.height = `${from}px`;
    grown.style.transition = "";
    await nextFrame();

    grown.style.height = `${to}px`;
    next.classList.remove("is-entering");
    await wait(GROW_MS);
    grown.style.height = "";
    grown.classList.remove("rs-scroll-morphing");
  }

  static async _onIdentify() {
    if (isIdentifyLocked(this.actor, this.scroll)) {
      ui.notifications.warn(
        game.i18n.format("REDSTEEL.Scroll.Warn.IdentifyLocked", {
          name: this.actor.name,
        }),
      );
      return;
    }
    await this.#park("identify", this.scroll.system?.identifyDifficulty);
  }

  static async _onWrite() {
    if (!isScrollIdentified(this.scroll)) {
      ui.notifications.warn(
        game.i18n.localize("REDSTEEL.Scroll.Warn.NotIdentified"),
      );
      return;
    }
    if (!this.bookId) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Scroll.Warn.NoBook"));
      return;
    }
    await this.#park("write", this.scroll.system?.writeDifficulty);
  }

  static async _onReroll() {
    if (!this.#pending || this.#busy) return;
    const { mode, outcome } = this.#pending;
    const spent = await spendArcanaReroll(this.actor, {
      critFailure: outcome.critFailure,
    });
    if (!spent) return;
    const difficulty =
      mode === "identify"
        ? this.scroll.system?.identifyDifficulty
        : this.scroll.system?.writeDifficulty;
    await this.#park(mode, difficulty);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: game.i18n.localize("REDSTEEL.Scroll.Chat.Reroll"),
    });
  }

  /** Commit the parked test. This is where anything is finally written. */
  static async _onAccept() {
    if (!this.#pending || this.#busy) return;
    this.#busy = true;
    const { mode, outcome } = this.#pending;
    try {
      if (mode === "identify") await this.#commitIdentify(outcome);
      else await this.#commitWrite(outcome);
    } finally {
      this.#busy = false;
    }
    this.#pending = null;
    // Copying spends the scroll, so there may be nothing left to show.
    if (this.scroll?.id && !this.actor.items.get(this.scroll.id)) this.close();
    else await this.#morph();
  }

  async #commitIdentify(outcome) {
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const line = game.i18n.format("REDSTEEL.Scroll.Chat.Identify", {
      actor: this.actor.name,
      d100: outcome.d100,
      margin: fmtSigned(outcome.margin),
    });

    if (!outcome.success) {
      await this.actor.setFlag(
        "redsteel",
        `${LOCK_FLAG}.${this.scroll.id}`,
        true,
      );
      await ChatMessage.create({
        speaker,
        content: `${line} ${game.i18n.localize(
          "REDSTEEL.Scroll.Chat.IdentifyFailure",
        )}`,
      });
      return;
    }

    // Success restores the spell's own art and lets the name through.
    const stash = this.scroll.flags?.redsteel?.scroll ?? {};
    const entry = poolEntry(this.scroll.system?.spell);
    await this.scroll.update({
      img: entry?.img ?? stash.img ?? this.scroll.img,
      "flags.redsteel.scroll.identified": true,
    });
    await ChatMessage.create({
      speaker,
      content: `${line} ${game.i18n.format(
        "REDSTEEL.Scroll.Chat.IdentifySuccess",
        { spell: entry?.name ?? stash.name ?? "" },
      )}`,
    });
  }

  async #commitWrite(outcome) {
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    const book = this.actor.items.get(this.bookId);
    if (!book) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Scroll.Warn.NoBook"));
      return;
    }

    const entry = poolEntry(this.scroll.system?.spell);
    const stash = this.scroll.flags?.redsteel?.scroll ?? {};
    const spellName = entry?.name ?? stash.name ?? "";
    const uuid = this.scroll.system?.spell;

    // The scroll is spent either way -- a steady hand only decides whether the
    // ink ends up in the book or on the floor.
    if (outcome.success) {
      const written = await writeSpell(this.actor, book, uuid, {
        ignoreRank: true,
      });
      // A refusal here is bookkeeping, not a botched hand: the book is full,
      // or it went missing mid-roll. Say so and keep the scroll, rather than
      // burning it and announcing a copy that never happened.
      if (!written.ok) {
        ui.notifications.warn(
          game.i18n.localize(
            `REDSTEEL.Learn.Spells.Warn.${written.reason ?? "noBook"}`,
          ),
        );
        return;
      }
    }
    await consumeScroll(this.scroll);

    await ChatMessage.create({
      speaker,
      content: game.i18n.format(
        outcome.success
          ? "REDSTEEL.Scroll.Chat.Write"
          : "REDSTEEL.Scroll.Chat.WriteFailure",
        {
          actor: this.actor.name,
          spell: spellName,
          book: book.localizedName ?? book.name,
          d100: outcome.d100,
          margin: fmtSigned(outcome.margin),
        },
      ),
    });
  }

  static async _onCast() {
    const read = await castFromScroll(this.actor, this.scroll);
    if (read) this.close();
  }
}

/** Sleep, so a fade has time to run before the DOM under it is replaced. */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Two frames: long enough for a style written now to animate, not jump. */
function nextFrame() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
}

/** "+12" / "-7", the way every other margin in the system prints. */
function fmtSigned(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : String(n);
}

/* -------------------------------------------------------------------------- */
/*  Wiring                                                                    */
/* -------------------------------------------------------------------------- */

export function registerScrollHooks() {
  Hooks.on("preCreateItem", onPreCreateItem);
  // Warm the pool so the draw hook, which cannot await, always has one.
  Hooks.once("ready", () => {
    loadScrollCatalogue().catch((err) =>
      console.warn("Redsteel | Scrolls: catalogue warm-up failed", err),
    );
  });
}
