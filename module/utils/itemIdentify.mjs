/**
 * MAGIC ITEM IDENTIFICATION (Arcana)
 *
 * The weapon / gear counterpart of the spell scroll's identify step (see
 * utils/spellScrolls.mjs, which this mirrors on purpose).
 *
 * HIDDEN, NOT DISABLED. An unidentified item's enchantments work exactly as
 * they always do: system.enchantMods, the Mind reserve and every combat read
 * are untouched. Only what is SHOWN changes. The name reads as the GM's
 * "appears as" text (or "Unidentified Weapon / Gear"), the description is
 * replaced, and the Enchantments tab hides its list and totals from players.
 *
 * DATA. Flags only, no template.json change:
 *   item  flags.redsteel.identify = { unidentified, appearsAs, difficulty,
 *                                     curseRevealed }
 *   actor flags.redsteel.itemIdentifyFails.<itemId> = true
 * A missing flag, or `unidentified !== true`, means identified, so every item
 * that existed before this file keeps behaving as it did.
 *
 * CURSES. A successful Arcana test reveals everything except bound (cursed)
 * enchantments. Those stay hidden until the GM ticks "Curse revealed", which
 * stands in for the Identify Curse ritual (a table ruling).
 *
 * THE ROLL. Same rules as the scroll: the test is PARKED, can be re-rolled
 * with a real Arcana re-roll charge, and a failure is only written on Accept.
 * A success commits itself. An accepted failure locks this actor out of this
 * item until a long rest (otherActions.mjs applyLongRest clears the flag).
 *
 * IMPORT CYCLE. documents/item.mjs imports this file (localizedName needs the
 * display name) and this file imports readEnchantments back from item.mjs.
 * ES modules tolerate that because neither side touches the other's bindings
 * while the module is being evaluated: every use sits inside a function body
 * that only runs after both modules have finished loading. Keep it that way;
 * a top-level call into item.mjs from here would read an uninitialised binding.
 */

import { readEnchantments } from "../documents/item.mjs";
import { rollArcana, spendArcanaReroll } from "./spellScrolls.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const APP_ID = "redsteel-item-identify";
const TEMPLATE = "systems/redsteel/templates/item/identify-window.hbs";
const ICON = "fa-solid fa-circle-question";

/** Actor flag holding the items this character has already failed to identify. */
const LOCK_FLAG = "itemIdentifyFails";

/** The item types that can be unidentified. */
const IDENTIFIABLE_TYPES = new Set(["weapon", "gear"]);

/**
 * Identify difficulty by the highest enchantment tier on the item.
 *
 * Signed modifier, system convention: higher is easier, same as a scroll's
 * identifyDifficulty. The numbers mirror SCROLL_RANK_CAST_BONUS negated
 * (apprentice 0, expert -10, master -30, grandmaster -60). This is a default
 * until the itemisation tier ladder is decided; the GM can override it per
 * item. Tiers above 4 use the tier 4 value, a missing tier uses tier 1.
 */
export const IDENTIFY_TIER_DIFFICULTY = { 1: 0, 2: -10, 3: -30, 4: -60 };

/* -------------------------------------------------------------------------- */
/*  State                                                                     */
/* -------------------------------------------------------------------------- */

/** The raw identify flag block, or an empty object. */
function identifyFlag(item) {
  return item?.flags?.redsteel?.identify ?? {};
}

/** True when the GM has marked this weapon / gear item unidentified. */
export function isItemUnidentified(item) {
  if (!IDENTIFIABLE_TYPES.has(item?.type)) return false;
  return identifyFlag(item).unidentified === true;
}

/** True while the item carries a bound enchantment the GM has not revealed. */
export function hasHiddenCurse(item) {
  if (identifyFlag(item).curseRevealed === true) return false;
  return readEnchantments(item).some((entry) => !!entry?.bound);
}

/** The identify difficulty the tier table gives this item, ignoring the override. */
export function derivedIdentifyDifficulty(item) {
  const tier = readEnchantments(item).reduce(
    (max, entry) => Math.max(max, Math.floor(Number(entry?.tier) || 0)),
    0,
  );
  if (tier < 1) return 0;
  return IDENTIFY_TIER_DIFFICULTY[Math.min(tier, 4)] ?? 0;
}

/**
 * The GM's per-item override, or null when none is set.
 *
 * `Number("")` is 0, so an emptied field must be caught before the cast or a
 * blank box would read as an explicit 0 and hide the derived value.
 */
export function identifyDifficultyOverride(item) {
  const raw = identifyFlag(item).difficulty;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** The difficulty the Arcana test actually uses. */
export function identifyDifficulty(item) {
  return identifyDifficultyOverride(item) ?? derivedIdentifyDifficulty(item);
}

/**
 * What an unidentified item is called on screen.
 *
 * Returns null for an identified item (or any other type), which item.mjs
 * reads as "not mine" and falls back to the normal name.
 */
export function unidentifiedDisplayName(item) {
  if (!isItemUnidentified(item)) return null;
  const appearsAs = String(identifyFlag(item).appearsAs ?? "").trim();
  if (appearsAs) return appearsAs;
  return game.i18n.format("REDSTEEL.Identify.UnidentifiedName", {
    type: game.i18n.localize(`TYPES.Item.${item.type}`),
  });
}

/** True when this character has already failed to identify this item. */
export function isItemIdentifyLocked(actor, item) {
  return actor?.flags?.redsteel?.[LOCK_FLAG]?.[item?.id] === true;
}

/**
 * The enchantment snapshots a viewer may see.
 *
 * The GM sees everything. A player sees nothing while the item is
 * unidentified, and everything but the bound entries while a curse is hidden.
 */
export function visibleEnchantments(item, { isGM = false } = {}) {
  const entries = readEnchantments(item);
  if (isGM) return entries;
  if (isItemUnidentified(item)) return [];
  if (hasHiddenCurse(item)) return entries.filter((entry) => !entry?.bound);
  return entries;
}

/* -------------------------------------------------------------------------- */
/*  The window                                                                */
/* -------------------------------------------------------------------------- */

/** Open the identify window for one item carried by `actor`. */
export async function openIdentifyWindow(actor, item) {
  if (!actor || !item) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Identify.Warn.NoActor"));
    return null;
  }
  if (!actor.isOwner) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Identify.Warn.NotOwner"));
    return null;
  }
  // Nothing left to identify (the GM may have cleared the flag meanwhile).
  if (!isItemUnidentified(item)) return null;
  const app = new ItemIdentifyWindow({ actor, item });
  return app.render(true);
}

/**
 * One item, one window: roll Arcana, optionally re-roll, then accept.
 *
 * The same parked-roll flow as the scroll window, without its body-morph
 * animation: every step simply re-renders.
 */
class ItemIdentifyWindow extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["redsteel", "rs-item-identify"],
    window: { title: "REDSTEEL.Identify.Window.Title", icon: ICON },
    position: { width: 420, height: "auto" },
    actions: {
      identify: ItemIdentifyWindow._onIdentify,
      reroll: ItemIdentifyWindow._onReroll,
      accept: ItemIdentifyWindow._onAccept,
    },
  };

  static PARTS = { body: { template: TEMPLATE } };

  constructor({ actor, item, ...options } = {}) {
    // One window per item. The `{id}` placeholder in DEFAULT_OPTIONS only
    // substitutes for document sheets, so a shared literal id would make the
    // second item re-render the first one's window instead of opening.
    super({ id: `${APP_ID}-${item?.id ?? foundry.utils.randomID()}`, ...options });
    this.actor = actor;
    this.item = item;
  }

  /** The parked outcome of a failed test, or null. */
  #pending = null;

  /** The last committed outcome, kept on screen under the locked hint. */
  #last = null;

  /** Set while a test is resolving, so a double click cannot spend twice. */
  #busy = false;

  async _prepareContext() {
    const item = this.item;
    const shown = this.#pending ?? this.#last;
    return {
      locked: isItemIdentifyLocked(this.actor, item),
      actorName: this.actor.name,
      name: unidentifiedDisplayName(item) ?? item.localizedName ?? item.name,
      img: item.img,
      identifyDifficulty: fmtSigned(identifyDifficulty(item)),
      result: shown ? { ...shown, marginText: fmtSigned(shown.margin) } : null,
      pending: !!this.#pending,
    };
  }

  /** Roll a test. A success commits itself; a failure is parked. */
  async #roll() {
    if (this.#busy) return;
    this.#busy = true;
    let outcome;
    try {
      outcome = await rollArcana(this.actor, identifyDifficulty(this.item));
      if (outcome.success) {
        // Nobody spends a re-roll on an item they have already read, so a
        // success has nothing left to decide.
        this.#pending = null;
        await this.#commit(outcome);
        this.close();
        return;
      }
      this.#pending = outcome;
    } finally {
      this.#busy = false;
    }
    await this.render();
  }

  static async _onIdentify() {
    if (this.#pending || this.#busy) return;
    if (isItemIdentifyLocked(this.actor, this.item)) {
      ui.notifications.warn(
        game.i18n.format("REDSTEEL.Identify.Locked", { name: this.actor.name }),
      );
      return;
    }
    await this.#roll();
  }

  static async _onReroll() {
    if (!this.#pending || this.#busy) return;
    this.#busy = true;
    let spent = false;
    try {
      spent = await spendArcanaReroll(this.actor, {
        critFailure: this.#pending.critFailure,
      });
    } finally {
      this.#busy = false;
    }
    if (!spent) return;
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: game.i18n.localize("REDSTEEL.Identify.Chat.Reroll"),
    });
    await this.#roll();
  }

  /** Accept the parked failure. This is where the lockout is written. */
  static async _onAccept() {
    if (!this.#pending || this.#busy) return;
    this.#busy = true;
    const outcome = this.#pending;
    try {
      await this.#commit(outcome);
      this.#pending = null;
      this.#last = outcome;
    } finally {
      this.#busy = false;
    }
    await this.render();
  }

  /** Write the outcome and post the public chat line. */
  async #commit(outcome) {
    const speaker = ChatMessage.getSpeaker({ actor: this.actor });
    // Read before the update: the line names what the reader was holding.
    const line = game.i18n.format("REDSTEEL.Identify.Chat.Identify", {
      actor: this.actor.name,
      item: unidentifiedDisplayName(this.item) ?? this.item.localizedName,
      d100: outcome.d100,
      margin: fmtSigned(outcome.margin),
    });

    if (!outcome.success) {
      await this.actor.setFlag("redsteel", `${LOCK_FLAG}.${this.item.id}`, true);
      // The lock lives on the actor, so an open item sheet would not notice it.
      if (this.item.sheet?.rendered) this.item.sheet.render();
      await ChatMessage.create({
        speaker,
        content: `${line} ${game.i18n.localize("REDSTEEL.Identify.Chat.Failure")}`,
      });
      return;
    }

    await this.item.update({ "flags.redsteel.identify.unidentified": false });
    // After the update the item is identified, so localizedName is the true
    // name (its localization key if it has one, else item.name).
    await ChatMessage.create({
      speaker,
      content: `${line} ${game.i18n.format("REDSTEEL.Identify.Chat.Success", {
        name: this.item.localizedName ?? this.item.name,
      })}`,
    });
  }
}

/** "+10" / "0" / "-30", the way every difficulty in the system is printed. */
function fmtSigned(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : String(n);
}
