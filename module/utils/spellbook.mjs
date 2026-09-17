/**
 * SPELLBOOKS (Grimoáry) AND MEMORISATION
 *
 * The rules (Pravidla, "Učení kouzel" / "Grimoáry") give a caster two ways to
 * hold a spell:
 *
 *   - Written in a grimoire. Free, and the book is a physical object: it can be
 *     lost, sold or stolen, and whoever holds it holds the spells. Casting from
 *     the book costs the Prepare action at the table (1 action, "Vyhledá a
 *     připraví si kouzlo v grimoáru"), which stays a table ruling.
 *   - Memorised, through the Memory knowledge (Paměť): 1 SP per spell, and it
 *     needs the same school rank. A memorised spell is in the caster's head and
 *     stays there when the book is gone.
 *
 * WHERE THE TRUTH LIVES. The book's own `system.spells` list is the record; the
 * spell Items on the actor are a projection of it, so that the whole casting
 * path (showSpellSelectionDialogs, performCast, the sheet's Spells tab) keeps
 * reading owned Items and needs no change. Every copy this module makes carries
 * `flags.redsteel.spellSource.managed`, and only a managed copy is ever removed
 * again — a spell dragged onto the sheet by hand is never touched.
 *
 * WHEN THE BOOK GOES. Deleting or moving the book unprojects the spells it put
 * on the actor (memorised ones stay). Because that is destructive and a delete
 * is easy to do by accident, the book's list is first copied to
 * `flags.redsteel.spellbookArchive` on the actor, where the Learn window shows
 * it and can write the book back.
 */

/** The compendium every learnable spell is read from. */
export const SPELL_PACK_ID = "redsteel.All-Spells";

/** Spell ranks, weakest first — the book's order, and the sheet's. */
export const SPELL_RANKS = ["wild", "apprentice", "expert", "master", "grandmaster"];

/**
 * The schools, in the order template.json declares them on the spell item and
 * the actor. Every list of schools reads in this order, so the Learn window,
 * the grimoire's own sheet and the character sheet agree.
 */
export const SPELL_SCHOOLS = [
  "fire",
  "water",
  "air",
  "earth",
  "spirit",
  "body",
  "darkness",
  "blood",
  "gnosis",
];

/**
 * The school rank a spell of each rank asks for (Pravidla, Dovednosti: the
 * school tracks read "Divoká magie" at I, "Učedník" at IV, "Expert" at VI,
 * "Mistr" at VIII, "Velmistr" at X).
 */
export const SPELL_RANK_MIN_SCHOOL = {
  wild: 1,
  apprentice: 4,
  expert: 6,
  master: 8,
  grandmaster: 10,
};

/**
 * The School of Blood has no rank track: it is bought as a specialisation, and
 * its rank nodes carry the same names as the spell ranks they unlock (see
 * helpers/specialisations.mjs, BLOOD_SCHOOL_RANK_NODES). Apprentice blood magic
 * comes with the specialisation's own apprentice node.
 */
const BLOOD_SPEC = "bloodSchool";

/** What one memorised spell costs, in SP (Pravidla, Paměť: "1 SP"). */
export const MEMORISE_SP = 1;

/** How many lost books an actor keeps, newest first. */
const ARCHIVE_LIMIT = 10;

/** Actors being reconciled right now, so the hooks do not stack a second pass. */
const syncing = new Set();

/* -------------------------------------------------------------------------- */
/*  Reading books                                                             */
/* -------------------------------------------------------------------------- */

/** Every spellbook the actor carries. */
export function getSpellbooks(actor) {
  return (actor?.items?.contents ?? []).filter((item) => item.type === "spellbook");
}

/**
 * A book's written spells as a plain array.
 *
 * Foundry stores an array of objects back as a `{0: …, 1: …}` map often enough
 * (the spell items' own `resources` and `variants` both landed that way) that
 * reading it defensively is cheaper than finding out in play.
 */
export function getBookEntries(book) {
  const raw = book?.system?.spells;
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list
    .filter((entry) => entry && typeof entry === "object" && entry.uuid)
    .map((entry) => ({
      uuid: String(entry.uuid),
      name: String(entry.name ?? ""),
      img: String(entry.img ?? ""),
      school: String(entry.school ?? ""),
      rank: String(entry.rank ?? ""),
    }));
}

/** The record a book keeps of one spell: enough to read it back with no pack. */
function makeEntry(spell, uuid) {
  return {
    uuid,
    name: spell.name ?? "",
    img: spell.img ?? "",
    school: spell.system?.type ?? "",
    rank: spell.system?.rank ?? "",
  };
}

/**
 * Which compendium spell an owned Item is a copy of.
 *
 * Our own copies say so on the flag. A spell dragged onto the sheet from the
 * compendium carries `_stats.compendiumSource` instead, and reading that too is
 * what lets the Learn window recognise the spells a character already had
 * before any of this existed, rather than offering them a second time.
 */
export function getSpellIdentity(item) {
  if (item?.type !== "spell") return null;
  const flagged = item.flags?.redsteel?.spellSource?.uuid;
  if (flagged) return String(flagged);
  const source = item._stats?.compendiumSource;
  return source ? String(source) : null;
}

/** True when the system made this copy and may remove it again. */
function isManaged(item) {
  return item?.flags?.redsteel?.spellSource?.managed === true;
}

/** True when the character knows this spell by heart. */
export function isMemorised(item) {
  return item?.flags?.redsteel?.memorised === true;
}

/**
 * What the character knows, keyed by compendium uuid:
 * `{item, memorised, books}` — `books` are the ids of the owned books that
 * write the spell down, empty for one known only by heart or dragged on by hand.
 */
export function getKnownSpells(actor) {
  const books = new Map();
  for (const book of getSpellbooks(actor)) {
    for (const entry of getBookEntries(book)) {
      if (!books.has(entry.uuid)) books.set(entry.uuid, []);
      books.get(entry.uuid).push(book.id);
    }
  }
  const known = new Map();
  for (const item of actor?.items?.contents ?? []) {
    const uuid = getSpellIdentity(item);
    if (!uuid || known.has(uuid)) continue;
    known.set(uuid, {
      item,
      memorised: isMemorised(item),
      books: books.get(uuid) ?? [],
    });
  }
  // A book may list a spell whose copy is not on the actor yet (the projection
  // runs on the next sync); the browser should still read it as written.
  for (const [uuid, ids] of books) {
    if (known.has(uuid)) continue;
    known.set(uuid, { item: null, memorised: false, books: ids });
  }
  return known;
}

/** How many spells the character pays SP for (Paměť: 1 SP each). */
export function getMemorisedCount(actor) {
  let count = 0;
  for (const item of actor?.items?.contents ?? []) {
    if (item.type === "spell" && isMemorised(item)) count += 1;
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/*  Reading a spell's action cost                                             */
/* -------------------------------------------------------------------------- */

/**
 * What a spell's `system.actionCost` says, as something a filter can read.
 *
 * The field is free text and the pack writes it a dozen ways: "1", "2 | C",
 * "Reaction", "Free action | Reaction | C", "2 + 4", and one Czech "2 | K"
 * (Koncentrace). Tokens are split on the separators the pack uses and read one
 * by one; the action count is the largest number named, which is what a spell
 * with a staged cost ("2 + 4") really asks of a caster's turn.
 *
 * Concentration is true for a "C"/"K" token *or* for a sustained spell: 60
 * spells in the pack mark it only in the action cost and one only on the
 * sustained flag, so a filter that reads one of them alone misses spells.
 *
 * @returns {{actions: number|null, free: boolean, reaction: boolean,
 *            concentration: boolean}}
 */
export function parseActionCost(raw, sustained = false) {
  const text = String(raw ?? "").toLowerCase();
  const tokens = text.split(/[|/+,]/).map((token) => token.trim()).filter(Boolean);
  let actions = null;
  let free = false;
  let reaction = false;
  let concentration = !!sustained;
  for (const token of tokens) {
    if (token.includes("reaction") || token.includes("reakce")) reaction = true;
    else if (token.includes("free") || token.includes("volná")) free = true;
    else if (token === "c" || token === "k" || token.startsWith("conc") || token.startsWith("konc")) {
      concentration = true;
    }
    const number = Number.parseInt(token, 10);
    if (Number.isInteger(number) && (actions === null || number > actions)) actions = number;
  }
  return { actions, free, reaction, concentration };
}

/* -------------------------------------------------------------------------- */
/*  The school rank gate                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether this character may write or memorise a spell of `rank` in `school`.
 *
 * Reads the school rank straight off the actor rather than through
 * progressionEngine's getTrackRank, which would import this module back.
 *
 * @returns {{ok: boolean, required: number, held: number, blood: boolean}}
 *   `required` is the school rank the spell asks for; for Blood it is the
 *   specialisation node instead, and `blood` says so.
 */
export function checkSpellRank(actor, school, rank) {
  const key = String(rank ?? "").toLowerCase();
  const required = SPELL_RANK_MIN_SCHOOL[key] ?? SPELL_RANK_MIN_SCHOOL.wild;

  if (school === "blood") {
    const spec = actor?.system?.specialisations?.[BLOOD_SPEC];
    const active = !!spec?.active;
    // Wild blood magic (none in the pack today) rides on the specialisation
    // itself; every other rank has a node of the same name.
    const node = key === "wild" ? active : !!spec?.nodes?.[key];
    return { ok: active && node, required, held: active ? 1 : 0, blood: true };
  }

  const held = Number(actor?.system?.schools?.[school]?.value ?? 0);
  return { ok: held >= required, required, held, blood: false };
}

/* -------------------------------------------------------------------------- */
/*  Projection                                                                */
/* -------------------------------------------------------------------------- */

/** A compendium spell's data, ready to create on an actor, or null. */
async function spellCopyData(uuid, { book = null, memorised = false } = {}) {
  const source = await fromUuid(uuid);
  if (!source || source.type !== "spell") return null;
  const data = source.toObject();
  delete data._id;
  data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
  data.flags = foundry.utils.mergeObject(data.flags ?? {}, {
    redsteel: {
      spellSource: { uuid, book, managed: true },
      memorised: !!memorised,
    },
  });
  return data;
}

/**
 * Bring the actor's spell Items back in line with the books it carries:
 * create a copy for every written spell that has none, drop every managed copy
 * no book writes down any more, and keep each copy pointing at the book it
 * came from. A memorised copy is never dropped — it is in the caster's head,
 * not in the book — it only loses its book link.
 *
 * Idempotent, and guarded against re-entry: writing a spell calls it, and the
 * item hooks it fires would otherwise call it a second time.
 */
export async function syncSpellbooks(actor) {
  if (!actor?.isOwner || syncing.has(actor.id)) return;
  syncing.add(actor.id);
  try {
    /**
     * uuid → the first owned book that writes it down.
     *
     * A spell the character cannot reach yet stays in the book but is not
     * copied onto the actor: holding a grandmaster's stolen grimoire does not
     * make a grandmaster of the thief. The entry is untouched, so the spell
     * appears the moment the school rank catches up (the updateActor hook in
     * registerSpellbookHooks runs this again when it does).
     */
    const written = new Map();
    for (const book of getSpellbooks(actor)) {
      for (const entry of getBookEntries(book)) {
        if (written.has(entry.uuid)) continue;
        if (!checkSpellRank(actor, entry.school, entry.rank).ok) continue;
        written.set(entry.uuid, { entry, bookId: book.id });
      }
    }

    /** uuid → the copy already on the actor. */
    const owned = new Map();
    for (const item of actor.items.contents) {
      const uuid = getSpellIdentity(item);
      if (uuid && !owned.has(uuid)) owned.set(uuid, item);
    }

    const creates = [];
    for (const [uuid, { bookId }] of written) {
      if (owned.has(uuid)) continue;
      const data = await spellCopyData(uuid, { book: bookId });
      if (data) creates.push(data);
    }

    const updates = [];
    const deletes = [];
    for (const [uuid, item] of owned) {
      const source = item.flags?.redsteel?.spellSource ?? null;
      const record = written.get(uuid);
      if (record) {
        // Adopt a hand-dragged copy rather than making a second one, and follow
        // the spell when it is erased from one book and written in another.
        if (source?.book !== record.bookId || source?.uuid !== uuid) {
          updates.push({
            _id: item.id,
            "flags.redsteel.spellSource": {
              uuid,
              book: record.bookId,
              managed: source?.managed === true,
            },
          });
        }
        continue;
      }
      if (!source?.book) continue;
      if (isMemorised(item)) {
        // Known by heart: the book link goes, the spell stays.
        updates.push({
          _id: item.id,
          "flags.redsteel.spellSource": { uuid, book: null, managed: source.managed === true },
        });
        continue;
      }
      if (isManaged(item)) deletes.push(item.id);
    }

    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
    if (deletes.length) await actor.deleteEmbeddedDocuments("Item", deletes);
    if (creates.length) await actor.createEmbeddedDocuments("Item", creates);
  } finally {
    syncing.delete(actor.id);
  }
}

/* -------------------------------------------------------------------------- */
/*  Writing, erasing, memorising                                              */
/* -------------------------------------------------------------------------- */

/**
 * Write a spell into one of the character's books.
 *
 * @returns {Promise<{ok: boolean, reason: string|null, required?: number}>}
 *   `reason` is a lang key suffix under REDSTEEL.Learn.Spells.Warn.
 */
export async function writeSpell(actor, book, uuid) {
  if (!actor?.isOwner || book?.type !== "spellbook") {
    return { ok: false, reason: "noBook" };
  }
  const source = await fromUuid(uuid);
  if (!source || source.type !== "spell") return { ok: false, reason: "notFound" };

  const gate = checkSpellRank(actor, source.system?.type, source.system?.rank);
  if (!gate.ok && !game.user.isGM) {
    return { ok: false, reason: "rank", required: gate.required };
  }

  const entries = getBookEntries(book);
  if (entries.some((entry) => entry.uuid === uuid)) return { ok: true, reason: null };

  // Capacity 0 is an unbound book, which is what an ordinary grimoire is.
  const capacity = Number(book.system?.capacity) || 0;
  if (capacity > 0 && entries.length >= capacity) return { ok: false, reason: "full" };

  entries.push(makeEntry(source, uuid));
  await book.update({ "system.spells": entries });
  await syncSpellbooks(actor);
  return { ok: true, reason: null };
}

/**
 * Strike a spell out of a book. The copy on the actor goes with it unless the
 * spell is memorised or another book still writes it down.
 */
export async function eraseSpell(actor, book, uuid) {
  if (!actor?.isOwner || book?.type !== "spellbook") return { ok: false, reason: "noBook" };
  const entries = getBookEntries(book).filter((entry) => entry.uuid !== uuid);
  await book.update({ "system.spells": entries });
  await syncSpellbooks(actor);
  return { ok: true, reason: null };
}

/**
 * Learn a spell by heart: 1 SP, the same school rank as writing it, and the
 * copy on the actor stops depending on the book.
 */
export async function memoriseSpell(actor, uuid, { book = null } = {}) {
  if (!actor?.isOwner) return { ok: false, reason: "notOwner" };
  const source = await fromUuid(uuid);
  if (!source || source.type !== "spell") return { ok: false, reason: "notFound" };

  const gate = checkSpellRank(actor, source.system?.type, source.system?.rank);
  if (!gate.ok && !game.user.isGM) {
    return { ok: false, reason: "rank", required: gate.required };
  }

  const existing = actor.items.contents.find((item) => getSpellIdentity(item) === uuid);
  if (existing) {
    if (isMemorised(existing)) return { ok: true, reason: null };
    await existing.update({ "flags.redsteel.memorised": true });
    return { ok: true, reason: null };
  }

  const data = await spellCopyData(uuid, { book, memorised: true });
  if (!data) return { ok: false, reason: "notFound" };
  await actor.createEmbeddedDocuments("Item", [data]);
  return { ok: true, reason: null };
}

/**
 * Give a memorised spell back (refunding its SP, which is derived from the
 * count). A spell still written in a book stays on the actor as a book copy;
 * one held only in the head is removed, but only when the system put it there.
 */
export async function forgetSpell(actor, uuid) {
  if (!actor?.isOwner) return { ok: false, reason: "notOwner" };
  const item = actor.items.contents.find(
    (candidate) => getSpellIdentity(candidate) === uuid,
  );
  if (!item) return { ok: true, reason: null };

  // A book the character cannot read at this rank does not hold the spell for
  // them, so forgetting it takes the copy away — the same rule the projection
  // follows, which keeps the two from disagreeing on the next sync.
  const inBook = getSpellbooks(actor).some((book) =>
    getBookEntries(book).some(
      (entry) => entry.uuid === uuid && checkSpellRank(actor, entry.school, entry.rank).ok,
    ),
  );
  if (inBook || !isManaged(item)) {
    await item.update({ "flags.redsteel.memorised": false });
    return { ok: true, reason: null };
  }
  await actor.deleteEmbeddedDocuments("Item", [item.id]);
  return { ok: true, reason: null };
}

/* -------------------------------------------------------------------------- */
/*  The lost-book archive                                                     */
/* -------------------------------------------------------------------------- */

/** The books this character has lost, newest first. */
export function getSpellbookArchive(actor) {
  const raw = actor?.flags?.redsteel?.spellbookArchive;
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list.filter((record) => record && typeof record === "object");
}

/**
 * Remember what a book held before it leaves the character, so a delete by
 * accident costs a click rather than an evening of rewriting. Empty books are
 * not worth a record.
 */
async function archiveSpellbook(actor, book) {
  const entries = getBookEntries(book);
  if (!entries.length || !actor?.isOwner) return;
  const record = {
    id: book.id,
    name: book.name,
    img: book.img,
    capacity: Number(book.system?.capacity) || 0,
    entries,
    time: Date.now(),
  };
  const archive = [record, ...getSpellbookArchive(actor).filter((r) => r.id !== book.id)];
  await actor.setFlag("redsteel", "spellbookArchive", archive.slice(0, ARCHIVE_LIMIT));
}

/** Write a lost book back onto the character, spells and all. */
export async function restoreSpellbook(actor, bookId) {
  if (!actor?.isOwner) return { ok: false, reason: "notOwner" };
  const record = getSpellbookArchive(actor).find((entry) => entry.id === bookId);
  if (!record) return { ok: false, reason: "notFound" };

  await actor.createEmbeddedDocuments("Item", [
    {
      name: record.name || game.i18n.localize("TYPES.Item.spellbook"),
      type: "spellbook",
      img: record.img || "icons/sundries/books/book-purple-illuminated.webp",
      system: {
        capacity: Number(record.capacity) || 0,
        spells: Array.isArray(record.entries) ? record.entries : [],
      },
    },
  ]);
  await dropArchived(actor, bookId);
  return { ok: true, reason: null };
}

/** Forget a lost book for good. */
export async function dropArchived(actor, bookId) {
  if (!actor?.isOwner) return;
  const archive = getSpellbookArchive(actor).filter((entry) => entry.id !== bookId);
  await actor.setFlag("redsteel", "spellbookArchive", archive);
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Keep the projection in step with the books. Registered once at init.
 *
 * Every handler runs only for the client that made the change and only on a
 * spellbook, so the copies this module creates (spell Items) never feed back
 * into it.
 */
export function registerSpellbookHooks() {
  const isOwnedBook = (item) =>
    item?.type === "spellbook" && item.parent?.documentName === "Actor";

  Hooks.on("createItem", (item, options, userId) => {
    if (game.user.id !== userId || !isOwnedBook(item)) return;
    syncSpellbooks(item.parent);
  });

  // The list also changes from the item sheet, not only through writeSpell.
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (game.user.id !== userId || !isOwnedBook(item)) return;
    if (changes.system?.spells === undefined) return;
    syncSpellbooks(item.parent);
  });

  // Sold, stolen, or deleted by accident: keep the list, then unproject.
  Hooks.on("deleteItem", async (item, options, userId) => {
    if (game.user.id !== userId || !isOwnedBook(item)) return;
    const actor = item.parent;
    await archiveSpellbook(actor, item);
    await syncSpellbooks(actor);
  });

  // A school rank bought (or a Blood node unlocked) brings the spells already
  // written in the book within reach, and losing the rank puts them back out of
  // it. Nothing else on the actor can change what is projected.
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (changes.system?.schools === undefined
      && changes.system?.specialisations === undefined) return;
    if (!getSpellbooks(actor).length) return;
    syncSpellbooks(actor);
  });
}
