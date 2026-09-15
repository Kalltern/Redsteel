/**
 * Party Management: the GM's one window over every player character.
 *
 * One row per character (level, CP/SP left of earned, purse, resources), a
 * grant bar that awards CP/SP to everyone ticked on a chosen day, a per-row
 * grant, the CP/SP ledger, and a Long Rest button that runs the existing
 * `game.redsteel.longRest()` rather than a copy of it.
 *
 * The ledger is laid out like the GM's own spreadsheet: characters across the
 * top with CP and SP under each, then Total earned, Starting, Bonus and one row
 * per award. Earned CP/SP is derived from it (progressionEngine `getLedger`):
 * total = starting + bonus + every award. Nothing here writes
 * `system.progression.earned`. Every update that changes awards, starting or
 * bonus spreads `getLedgerMaterializeUpdate(actor)` first, computed from the
 * actor before the change, so a character from before the ledger keeps the
 * starting figure recovered from their old typed total.
 */

import {
  getLedger,
  getLedgerMaterializeUpdate,
  getWallet,
} from "../helpers/progressionEngine.mjs";
import { purseTotal, summarisePurse, formatPrice } from "./currency.mjs";
import { openLearnWindow } from "./learnWindow.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } =
  foundry.applications.api;

const APP_ID = "redsteel-party-management";
const TEMPLATE = "systems/redsteel/templates/party/party-management.hbs";
const ICON = "fa-light fa-users";

const LEDGER_FIELDS = ["starting", "bonus"];
const LEDGER_CURRENCIES = ["cp", "sp"];

const label = (key) => game.i18n.localize(`REDSTEEL.PartyManagement.${key}`);

/* -------------------------------------------- */
/*  Ledger helpers                              */
/* -------------------------------------------- */
// Pure: no Foundry globals from here to the Party section, so the day and
// grouping rules can be tested outside Foundry.

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEDGER_LABEL_WIDTH = 170;
const LEDGER_FIGURE_WIDTH = 64;

function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

/** A Date's LOCAL calendar day as YYYY-MM-DD (toISOString would be UTC). */
function localDay(date = new Date()) {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The key that ties the entries of one grant together, or null. */
function grantKeyOf(award) {
  const key = award?.grantId ?? award?.date;
  return key === undefined || key === null || key === "" ? null : String(key);
}

/**
 * Read an award in the current shape. Entries from the first build carry no
 * grantId or created stamp, and their date is a full ISO timestamp: the grant
 * is keyed by that timestamp and the day is its local calendar day.
 */
function normaliseAward(award) {
  const raw = String(award?.date ?? "");
  let day = "";
  if (DAY_PATTERN.test(raw)) {
    day = raw;
  } else if (raw) {
    const when = new Date(raw);
    if (!Number.isNaN(when.getTime())) day = localDay(when);
  }
  return {
    grantKey: grantKeyOf(award),
    day,
    created: String(award?.created ?? award?.date ?? ""),
  };
}

/** YYYY-MM-DD as DD.MM.YYYY, straight from the digits (no Date, no UTC). */
function formatDay(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ""));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "";
}

/** grid-template-columns for the ledger: the label, then CP and SP per character. */
function ledgerColumns(count) {
  return count > 0
    ? `${LEDGER_LABEL_WIDTH}px repeat(${count * 2}, ${LEDGER_FIGURE_WIDTH}px)`
    : `${LEDGER_LABEL_WIDTH}px`;
}

/**
 * One row per grant, oldest on top (by day, then by when it was recorded),
 * with one cell per character in column order.
 *
 * @param {{uuid: string, awards: object[]}[]} characters  In column order.
 * @returns {{grantKey: string, day: string, created: string, note: string,
 *            by: string, cells: object[]}[]}
 */
function groupGrants(characters) {
  const groups = new Map();
  for (const character of characters) {
    for (const award of character.awards ?? []) {
      if (!award?.id) continue;
      const { grantKey, day, created } = normaliseAward(award);
      if (grantKey === null) continue;
      let group = groups.get(grantKey);
      if (!group) {
        group = {
          grantKey,
          day,
          created,
          note: String(award.note ?? ""),
          by: String(award.by ?? ""),
          shares: new Map(),
        };
        groups.set(grantKey, group);
      }
      if (!group.shares.has(character.uuid)) {
        group.shares.set(character.uuid, {
          has: true,
          cp: Number(award.cp) || 0,
          sp: Number(award.sp) || 0,
          awardId: award.id,
          uuid: character.uuid,
        });
      }
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || a.created.localeCompare(b.created))
    .map(({ shares, ...group }) => ({
      ...group,
      cells: characters.map((c) => shares.get(c.uuid) ?? { has: false }),
    }));
}

/* -------------------------------------------- */
/*  Party                                       */
/* -------------------------------------------- */

/**
 * The same membership rule as the Long Rest roster (non-GM users' assigned
 * characters, then world actors ticked as party members), narrowed to player
 * characters: no scene tokens, no selected tokens, no NPCs.
 *
 * @returns {Actor[]} Deduped by uuid, sorted by name.
 */
function collectPartyCharacters() {
  const seen = new Set();
  const party = [];
  const add = (actor) => {
    if (!actor || actor.type !== "character" || seen.has(actor.uuid)) return;
    seen.add(actor.uuid);
    party.push(actor);
  };

  for (const user of game.users.contents) {
    if (user.isGM) continue;
    add(user.character);
  }
  for (const actor of game.actors.contents) {
    if (actor.system?.partyMember) add(actor);
  }

  return party.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
}

/**
 * The colour of the player who has this character assigned, or null. Only a
 * non-GM player counts; a party member nobody plays gets no tint.
 */
function playerColourOf(actor) {
  const owners = game.users.contents.filter(
    (user) => user.character?.id === actor.id,
  );
  const owner = owners.find((user) => !user.isGM);
  return owner ? (owner.color?.css ?? owner.color ?? null) : null;
}

/** The actor's stored awards, tolerant of actors created before the field. */
function readAwards(actor) {
  const awards = actor?.system?.progression?.awards ?? [];
  return Array.isArray(awards) ? awards : [];
}

/** Draft map key for one Starting/Bonus cell. */
function ledgerKey(uuid, field, currency) {
  return `${uuid}|${field}|${currency}`;
}

/* -------------------------------------------- */
/*  Awards                                      */
/* -------------------------------------------- */

/**
 * Record one grant on each actor's ledger, and post one public chat card for
 * it when the award is dated today. A backfilled past session posts nothing.
 *
 * @param {Actor[]} actors
 * @param {{cp: number|string, sp: number|string, note: string, day: string}} award
 * @returns {Promise<boolean>} True when anything was granted.
 */
async function grantAward(actors, { cp, sp, note, day }) {
  const cpAmount = Math.trunc(Number(cp) || 0);
  const spAmount = Math.trunc(Number(sp) || 0);
  if (cpAmount < 0 || spAmount < 0 || (cpAmount === 0 && spAmount === 0)) {
    ui.notifications.warn(label("NothingToGrant"));
    return false;
  }
  const awardDay = String(day ?? "");
  if (!DAY_PATTERN.test(awardDay)) {
    ui.notifications.warn(label("InvalidDate"));
    return false;
  }
  if (!actors.length) return false;

  const text = String(note ?? "").trim();
  const grantId = foundry.utils.randomID();
  const created = new Date().toISOString();

  // One at a time: each update is its own round trip, and a failure part way
  // through should leave the earlier actors granted rather than half-written.
  for (const actor of actors) {
    const entry = {
      id: foundry.utils.randomID(),
      grantId,
      date: awardDay,
      created,
      cp: cpAmount,
      sp: spAmount,
      note: text,
      by: game.user.name,
    };
    await actor.update({
      ...getLedgerMaterializeUpdate(actor),
      "system.progression.awards": [...readAwards(actor), entry],
    });
  }

  if (awardDay !== localDay()) return true;

  const escape = foundry.utils.escapeHTML;
  const amount = [
    cpAmount ? `+${cpAmount} ${label("ColCp")}` : null,
    spAmount ? `+${spAmount} ${label("ColSp")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lines = actors
    .map(
      (actor) =>
        `<li style="margin: 2px 0;"><b>${escape(actor.name)}:</b> ${amount}</li>`,
    )
    .join("");
  const noteHtml = text
    ? `<p style="margin: 4px 0 0; font-size: 12px; opacity: 0.8;"><i>${escape(text)}</i></p>`
    : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ user: game.user }),
    content: `<p class="rs-card-headline"><b><i class="${ICON}"></i> ${label("CardTitle")}</b></p><ul style="list-style: none; margin: 4px 0; padding: 0;">${lines}</ul>${noteHtml}`,
  });

  return true;
}

/** Ask a yes/no question; true only on an explicit yes. */
async function confirmDelete(message) {
  const answer = await DialogV2.confirm({
    window: { title: label("DeleteTitle"), icon: "fa-light fa-trash" },
    content: `<p>${foundry.utils.escapeHTML(message)}</p>`,
    modal: true,
    rejectClose: false,
  });
  return answer === true;
}

/**
 * Take one character's share of a grant back. No chat card.
 *
 * @param {Actor} actor
 * @param {string} awardId
 * @returns {Promise<boolean>} True when the entry was removed.
 */
async function deleteAward(actor, awardId) {
  const entry = readAwards(actor).find((a) => a?.id === awardId);
  if (!entry) return false;

  const confirmed = await confirmDelete(
    game.i18n.format("REDSTEEL.PartyManagement.DeleteConfirm", {
      cp: Math.trunc(Number(entry.cp) || 0),
      sp: Math.trunc(Number(entry.sp) || 0),
      name: actor.name,
    }),
  );
  if (!confirmed) return false;

  // Read again after the dialog: the entry may already be gone (a second
  // click on the same cell, or another GM).
  const awards = readAwards(actor);
  if (!awards.some((a) => a?.id === awardId)) return false;

  await actor.update({
    ...getLedgerMaterializeUpdate(actor),
    "system.progression.awards": awards.filter((a) => a?.id !== awardId),
  });
  return true;
}

/**
 * Take a whole grant back from every party character holding a share of it.
 *
 * @param {string} grantKey
 * @param {string} dateText  The date as the ledger displays it.
 * @returns {Promise<boolean>} True when anything was removed.
 */
async function deleteGrant(grantKey, dateText) {
  if (!grantKey) return false;
  const holders = () =>
    collectPartyCharacters().filter((actor) =>
      readAwards(actor).some((a) => grantKeyOf(a) === grantKey),
    );
  if (!holders().length) return false;

  const confirmed = await confirmDelete(
    game.i18n.format("REDSTEEL.PartyManagement.DeleteGrantConfirm", {
      date: dateText,
    }),
  );
  if (!confirmed) return false;

  // Re-read after the dialog, for the same reason as deleteAward.
  let removed = false;
  for (const actor of holders()) {
    const awards = readAwards(actor);
    const keep = awards.filter((a) => grantKeyOf(a) !== grantKey);
    if (keep.length === awards.length) continue;
    await actor.update({
      ...getLedgerMaterializeUpdate(actor),
      "system.progression.awards": keep,
    });
    removed = true;
  }
  return removed;
}

/* -------------------------------------------- */
/*  The window                                  */
/* -------------------------------------------- */

class PartyManagement extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: APP_ID,
    classes: ["redsteel", "rs-party"],
    window: {
      title: "REDSTEEL.PartyManagement.Title",
      icon: ICON,
      resizable: true,
    },
    position: { width: 1180, height: "auto" },
    actions: {
      openSheet: PartyManagement._onOpenSheet,
      openLearn: PartyManagement._onOpenLearn,
      grantParty: PartyManagement._onGrantParty,
      grantRow: PartyManagement._onGrantRow,
      deleteAward: PartyManagement._onDeleteAward,
      deleteGrant: PartyManagement._onDeleteGrant,
      longRest: PartyManagement._onLongRest,
    },
  };

  static PARTS = {
    body: {
      template: TEMPLATE,
      // The ledger's own sideways scroller is named too, so a re-render while
      // the GM works through a wide party keeps its place.
      scrollable: [".rs-party-ledger", ".rs-party-ledger-rows"],
    },
  };

  /**
   * What the GM has typed but not applied yet. Kept here rather than read off
   * the inputs so it survives a re-render: a player changing their own HP
   * redraws this window, and that must not wipe a half-typed award.
   */
  #draft = {
    cp: "",
    sp: "",
    note: "",
    date: localDay(),
    unticked: new Set(),
    rows: new Map(),
    ledger: new Map(),
  };

  /** [hookName, id] pairs, removed on close. */
  #hooks = [];

  /** Set while a grant is being written, so a double click cannot grant twice. */
  #busy = false;

  /** Starting/Bonus cells whose write is in flight. */
  #committing = new Set();

  /** The input that had focus when a render began: {key, start, end}. */
  #focus = null;

  /**
   * True from _preRender until _onRender. Replacing the part removes the
   * focused input, and Chromium can fire blur/change on a removed element; a
   * half-typed Starting figure ("2" of "200") must not be committed by that.
   */
  #rendering = false;

  #queueRender;

  constructor(options = {}) {
    super(options);
    this.#queueRender = foundry.utils.debounce(() => {
      if (this.rendered) this.render();
    }, 100);
    this.#hooks = [
      [
        "updateActor",
        Hooks.on("updateActor", (actor) => {
          if (actor?.type === "character") this.#queueRender();
        }),
      ],
      ["updateUser", Hooks.on("updateUser", () => this.#queueRender())],
      // Spent CP/SP is priced off owned items, and buying or refunding a
      // feature fires no updateActor, so CP left would otherwise go stale.
      ...["createItem", "updateItem", "deleteItem"].map((hook) => [
        hook,
        Hooks.on(hook, (item) => {
          if (item?.parent?.type === "character") this.#queueRender();
        }),
      ]),
    ];
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const draft = this.#draft;
    const party = collectPartyCharacters();

    const pool = (system, key) => {
      const stat = system?.stats?.[key] ?? {};
      return { value: Number(stat.value) || 0, max: Number(stat.max) || 0 };
    };

    const rows = party.map((actor) => {
      const system = actor.system ?? {};
      const wallet = getWallet(actor);
      const total = purseTotal(actor);
      const rowDraft = draft.rows.get(actor.uuid) ?? { cp: "", sp: "" };
      const hasMana = !!system.magicPotential;
      return {
        uuid: actor.uuid,
        name: actor.name,
        img: actor.img || "icons/svg/mystery-man.svg",
        playerColour: playerColourOf(actor),
        level: wallet.level,
        cp: { left: wallet.remaining.cp, earned: wallet.earned.cp },
        sp: { left: wallet.remaining.sp, earned: wallet.earned.sp },
        purse: summarisePurse(total),
        purseTitle: formatPrice(total),
        health: pool(system, "health"),
        graveWounds: pool(system, "graveWounds"),
        mind: pool(system, "mind"),
        insanity: pool(system, "insanity"),
        fatigue: pool(system, "fatigue"),
        hasMana,
        mana: hasMana ? pool(system, "mana") : null,
        ticked: !draft.unticked.has(actor.uuid),
        draftCp: rowDraft.cp,
        draftSp: rowDraft.sp,
      };
    });

    // Ledger columns follow the party table's order.
    const fromDraft = (uuid, field, currency, stored) => {
      const key = ledgerKey(uuid, field, currency);
      return draft.ledger.has(key) ? draft.ledger.get(key) : stored;
    };
    const characters = party.map((actor) => {
      const ledger = getLedger(actor);
      const cell = (field) => ({
        cp: fromDraft(actor.uuid, field, "cp", ledger[field].cp),
        sp: fromDraft(actor.uuid, field, "sp", ledger[field].sp),
      });
      return {
        uuid: actor.uuid,
        name: actor.name,
        playerColour: playerColourOf(actor),
        total: { cp: ledger.total.cp, sp: ledger.total.sp },
        starting: cell("starting"),
        bonus: cell("bonus"),
      };
    });

    const createdFormat = new Intl.DateTimeFormat(game.i18n.lang, {
      dateStyle: "medium",
      timeStyle: "short",
    });
    const ledgerRows = groupGrants(
      party.map((actor) => ({ uuid: actor.uuid, awards: readAwards(actor) })),
    ).map((grant) => {
      const when = new Date(grant.created);
      const createdText = Number.isNaN(when.getTime())
        ? grant.created
        : createdFormat.format(when);
      return {
        grantKey: grant.grantKey,
        dateText: formatDay(grant.day),
        note: grant.note,
        hasNote: grant.note.length > 0,
        tooltip: game.i18n.format("REDSTEEL.PartyManagement.GrantTooltip", {
          by: grant.by,
          created: createdText,
        }),
        cells: grant.cells,
      };
    });

    return {
      ...context,
      draft: { cp: draft.cp, sp: draft.sp, note: draft.note, date: draft.date },
      rows,
      hasRows: rows.length > 0,
      allTicked: rows.length > 0 && rows.every((r) => r.ticked),
      ledger: {
        cols: ledgerColumns(party.length),
        characters,
        rows: ledgerRows,
        hasRows: ledgerRows.length > 0,
      },
    };
  }

  /**
   * Remember which input had focus. The part is rebuilt on every render, and
   * the GM tabbing through the Starting cells re-renders on each change.
   * @override
   */
  async _preRender(context, options) {
    await super._preRender(context, options);
    this.#rendering = true;
    const active = document.activeElement;
    if (
      !(active instanceof HTMLElement) ||
      !this.element?.contains(active) ||
      !active.dataset.focusKey
    ) {
      this.#focus = null;
      return;
    }
    const focus = { key: active.dataset.focusKey, start: null, end: null };
    if (active instanceof HTMLInputElement && active.type === "text") {
      try {
        focus.start = active.selectionStart;
        focus.end = active.selectionEnd;
      } catch (err) {
        // No caret on this kind of input.
      }
    }
    this.#focus = focus;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#rendering = false;

    // The part element is replaced on every render, so listeners bound inside
    // it never stack. `this.element` outlives renders and is left alone.
    const root = this.element.querySelector(".rs-party-body");
    if (!root) return;
    const draft = this.#draft;

    for (const input of root.querySelectorAll("input[data-draft]")) {
      const keep = () => {
        draft[input.dataset.draft] = input.value;
      };
      input.addEventListener("input", keep);
      input.addEventListener("change", keep);
    }

    for (const input of root.querySelectorAll("input[data-row-draft]")) {
      input.addEventListener("input", () => {
        const uuid = input.dataset.actorUuid;
        const row = draft.rows.get(uuid) ?? { cp: "", sp: "" };
        row[input.dataset.rowDraft] = input.value;
        draft.rows.set(uuid, row);
      });
    }

    for (const input of root.querySelectorAll("input[data-ledger-field]")) {
      const { actorUuid, ledgerField, currency } = input.dataset;
      const key = ledgerKey(actorUuid, ledgerField, currency);
      input.addEventListener("input", () => draft.ledger.set(key, input.value));
      // A render while the GM is typing rebuilds this input with the draft
      // already in it, and leaving an input whose value has not changed since
      // it took focus fires no change event. Leaving it commits as well, or
      // the typed figure would show but never be saved. Neither commits while
      // a render is removing the input (see #rendering).
      const commit = () => {
        if (!this.#rendering) this.#commitLedger(input);
      };
      input.addEventListener("change", commit);
      input.addEventListener("focusout", commit);
    }

    const master = root.querySelector("input.rs-party-tick-all");
    const boxes = Array.from(root.querySelectorAll("input.rs-party-tick"));

    // The master reads as "everyone", so it follows the rows back: ticked when
    // all are, half-state when some are.
    const syncMaster = () => {
      if (!master) return;
      const all = boxes.length > 0 && boxes.every((b) => b.checked);
      master.checked = all;
      master.indeterminate = !all && boxes.some((b) => b.checked);
    };

    for (const box of boxes) {
      box.addEventListener("change", () => {
        if (box.checked) draft.unticked.delete(box.dataset.actorUuid);
        else draft.unticked.add(box.dataset.actorUuid);
        syncMaster();
      });
    }

    master?.addEventListener("change", () => {
      for (const box of boxes) {
        box.checked = master.checked;
        if (master.checked) draft.unticked.delete(box.dataset.actorUuid);
        else draft.unticked.add(box.dataset.actorUuid);
      }
      syncMaster();
    });

    syncMaster();

    const focus = this.#focus;
    this.#focus = null;
    if (focus) {
      const target = Array.from(root.querySelectorAll("[data-focus-key]")).find(
        (el) => el.dataset.focusKey === focus.key,
      );
      if (target && document.activeElement !== target) {
        target.focus();
        if (target.type === "text" && focus.start !== null) {
          try {
            target.setSelectionRange(focus.start, focus.end ?? focus.start);
          } catch (err) {
            // No caret on this kind of input.
          }
        }
      }
    }
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    for (const [hook, id] of this.#hooks) Hooks.off(hook, id);
    this.#hooks = [];
  }

  /**
   * Write one typed Starting or Bonus figure. Blank or non-numeric input is
   * dropped, a negative Starting is refused, an unchanged figure writes
   * nothing.
   */
  async #commitLedger(input) {
    const { actorUuid, ledgerField: field, currency } = input.dataset;
    if (!LEDGER_FIELDS.includes(field) || !LEDGER_CURRENCIES.includes(currency)) {
      return;
    }
    const key = ledgerKey(actorUuid, field, currency);
    const drafts = this.#draft.ledger;
    if (!drafts.has(key) || this.#committing.has(key)) return;

    const raw = String(drafts.get(key)).trim();
    const value = Math.trunc(Number(raw));
    const actor = actorUuid ? fromUuidSync(actorUuid) : null;

    if (!actor || raw === "" || !Number.isFinite(value)) {
      drafts.delete(key);
      this.#queueRender();
      return;
    }
    if (field === "starting" && value < 0) {
      ui.notifications.warn(label("StartingInvalid"));
      drafts.delete(key);
      this.#queueRender();
      return;
    }
    if (value === getLedger(actor)[field][currency]) {
      drafts.delete(key);
      this.#queueRender();
      return;
    }

    this.#committing.add(key);
    try {
      await actor.update({
        ...getLedgerMaterializeUpdate(actor),
        [`system.progression.${field}.${currency}`]: value,
      });
    } finally {
      this.#committing.delete(key);
      drafts.delete(key);
    }
    this.#queueRender();
  }

  /** The actor a clicked row or button belongs to, or null. */
  static _actorFrom(target) {
    const uuid = target?.closest("[data-actor-uuid]")?.dataset.actorUuid;
    return uuid ? fromUuidSync(uuid) : null;
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /** @this PartyManagement */
  static _onOpenSheet(event, target) {
    event?.preventDefault?.();
    PartyManagement._actorFrom(target)?.sheet?.render(true);
  }

  /** @this PartyManagement */
  static _onOpenLearn(event, target) {
    event?.preventDefault?.();
    const actor = PartyManagement._actorFrom(target);
    if (actor) openLearnWindow(actor);
  }

  /** @this PartyManagement */
  static async _onGrantParty(event) {
    event?.preventDefault?.();
    if (this.#busy) return;
    const draft = this.#draft;
    const actors = collectPartyCharacters().filter(
      (actor) => !draft.unticked.has(actor.uuid),
    );
    if (!actors.length) {
      ui.notifications.warn(label("NobodyTicked"));
      return;
    }

    this.#busy = true;
    try {
      const granted = await grantAward(actors, {
        cp: draft.cp,
        sp: draft.sp,
        note: draft.note,
        day: draft.date,
      });
      if (!granted) return;
      // The date stays: a backfill usually covers several grants of one day.
      draft.cp = "";
      draft.sp = "";
      draft.note = "";
    } finally {
      this.#busy = false;
    }
    this.render();
  }

  /** @this PartyManagement */
  static async _onGrantRow(event, target) {
    event?.preventDefault?.();
    if (this.#busy) return;
    const actor = PartyManagement._actorFrom(target);
    if (!actor) return;
    const draft = this.#draft;
    const rowDraft = draft.rows.get(actor.uuid) ?? { cp: "", sp: "" };

    this.#busy = true;
    try {
      const granted = await grantAward([actor], {
        cp: rowDraft.cp,
        sp: rowDraft.sp,
        note: draft.note,
        day: draft.date,
      });
      if (!granted) return;
      // The bar's note and date are kept: the GM may be handing the same
      // reason out row by row.
      draft.rows.delete(actor.uuid);
    } finally {
      this.#busy = false;
    }
    this.render();
  }

  /** @this PartyManagement */
  static async _onDeleteAward(event, target) {
    event?.preventDefault?.();
    const actor = PartyManagement._actorFrom(target);
    const awardId = target?.dataset.awardId;
    if (!actor || !awardId) return;
    if (await deleteAward(actor, awardId)) this.render();
  }

  /** @this PartyManagement */
  static async _onDeleteGrant(event, target) {
    event?.preventDefault?.();
    const grantKey = target?.dataset.grantKey;
    if (!grantKey) return;
    if (await deleteGrant(grantKey, target.dataset.grantDate ?? "")) this.render();
  }

  /** @this PartyManagement */
  static _onLongRest(event) {
    event?.preventDefault?.();
    game.redsteel.longRest();
  }
}

/* -------------------------------------------- */
/*  Entry point                                 */
/* -------------------------------------------- */

/** Open (or focus) Party Management. GM only. */
export function openPartyManagement() {
  if (!game.user.isGM) {
    ui.notifications.warn(label("GmOnly"));
    return null;
  }
  const existing = foundry.applications.instances.get(APP_ID);
  if (existing) {
    existing.bringToFront();
    return existing;
  }
  return new PartyManagement().render(true);
}
