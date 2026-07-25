/**
 * "Resync with ruleset" — replace an owned item's content with a fresh copy of
 * the compendium item it was created from, so a ruleset edit (a changed Active
 * Effect, a downranked spell) can be pulled into characters who already carry
 * the item without deleting and re-adding it.
 *
 * The replacement is deliberately total: `name`, `img`, `system` and the
 * embedded Active Effects all come from the source, including instance state
 * such as spent reroll charges, durability and quantity. The point of the
 * action is "make this exactly the ruleset version", so nothing is merged.
 *
 * Four fields are document plumbing rather than content and are never taken
 * from the source, because overwriting them breaks links that the undo cannot
 * cleanly repair:
 *   - `_id`      weapon-set slots, AE origins and granted abilities point at it
 *   - `ownership` a pack item's block would cut a player off from their own item
 *   - `flags`    the undo snapshot lives here, so importing source flags would
 *                clobber the snapshot in the same write that created it
 *   - `sort`     purely so the item keeps its place in the inventory list
 *
 * Every resync stores a snapshot of the pre-resync content under
 * `flags.redsteel.resyncBackup`, which drives the "Undo re-sync" entry in the
 * sheet's header menu. Undo is single level: resyncing again replaces the
 * snapshot. That covers the misclick case this exists for.
 */

const BACKUP_FLAG = "resyncBackup";

/** The stored undo snapshot, or null when the item has never been resynced. */
export function getResyncBackup(item) {
  return item?.getFlag?.("redsteel", BACKUP_FLAG) ?? null;
}

/**
 * The UUID this item was created from. `_stats.compendiumSource` is the modern
 * pointer; `flags.core.sourceId` is where older items kept the same thing.
 */
export function getResyncSourceUuid(item) {
  return (
    item?._stats?.compendiumSource ||
    item?.getFlag?.("core", "sourceId") ||
    null
  );
}

/**
 * Whether the resync action should be offered for this item at all.
 *
 * Deliberately not gated on a recorded source pointer. Much of this system's
 * pack content was imported from another module and still carries that
 * module's `compendiumSource`, so the recorded pointer is frequently a dead
 * link. The lookup falls back to searching the ruleset packs by name, so the
 * entry is offered whenever the item is a normal owned item and the search
 * happens on click.
 */
export function canResyncItem(item) {
  // Pack items are the source, so resyncing one onto itself is meaningless.
  if (!item || item.pack) return false;
  return !!item.isOwner;
}

/**
 * Item compendia to search, ruleset packs first. "Resync with ruleset" means
 * the system's own content, so `redsteel-items` and `All-Spells` outrank any
 * module or world pack that happens to hold a same-named item.
 */
function candidatePacks() {
  return game.packs
    .filter((pack) => pack.metadata?.type === "Item")
    .sort((a, b) => packRank(a) - packRank(b));
}

function packRank(pack) {
  if (pack.metadata?.packageType === "system") return 0;
  if (pack.metadata?.packageType === "world") return 1;
  return 2;
}

/**
 * Every compendium item matching this one by type and name, ruleset packs
 * first. This is what makes resync work for content whose recorded source
 * points at a module that is no longer installed.
 */
async function findRulesetMatches(item) {
  const matches = [];
  const wanted = item.name?.trim().toLowerCase();
  if (!wanted) return matches;

  for (const pack of candidatePacks()) {
    let index;
    try {
      index = await pack.getIndex({ fields: ["type"] });
    } catch (err) {
      console.warn(`Redsteel | Could not index pack ${pack.collection}:`, err);
      continue;
    }

    for (const entry of index) {
      if (entry.type !== item.type) continue;
      if (entry.name?.trim().toLowerCase() !== wanted) continue;
      matches.push({ pack, id: entry._id, name: entry.name });
    }
  }

  return matches;
}

/**
 * The compendium document to resync from. Prefers the recorded pointer when it
 * still resolves to the right type, and otherwise searches the ruleset packs by
 * name, prompting when more than one pack offers a match.
 */
async function resolveResyncSource(item) {
  const uuid = getResyncSourceUuid(item);

  if (uuid) {
    let recorded = null;
    try {
      recorded = await fromUuid(uuid);
    } catch (err) {
      console.warn("Redsteel | Recorded resync source did not resolve:", err);
    }
    if (recorded && recorded.type === item.type) return recorded;
  }

  const matches = await findRulesetMatches(item);
  if (!matches.length) return null;
  if (matches.length === 1) {
    return matches[0].pack.getDocument(matches[0].id);
  }

  const options = matches
    .map(
      (m, i) =>
        `<option value="${i}">${m.name} (${m.pack.metadata.label})</option>`,
    )
    .join("");

  const chosen = await new Promise((resolve) => {
    new Dialog({
      title: game.i18n.localize("REDSTEEL.Resync.PickTitle"),
      content: `
<p>${game.i18n.format("REDSTEEL.Resync.PickBody", { item: item.name })}</p>
<select name="resyncSource" style="width:100%;">${options}</select>
`,
      buttons: {
        ok: {
          label: game.i18n.localize("REDSTEEL.Resync.PickConfirm"),
          callback: (html) =>
            resolve(Number(html.find('[name="resyncSource"]').val())),
        },
        cancel: {
          label: game.i18n.localize("REDSTEEL.Resync.PickCancel"),
          callback: () => resolve(null),
        },
      },
      default: "ok",
      close: () => resolve(null),
    }).render(true);
  });

  if (chosen === null || Number.isNaN(chosen)) return null;
  return matches[chosen].pack.getDocument(matches[chosen].id);
}

/**
 * Content taken from a document for a resync or an undo. Mirrors the field
 * policy documented above: content only, never plumbing.
 */
function contentOf(document) {
  const data = document.toObject();
  return {
    name: data.name,
    img: data.img,
    system: data.system,
    effects: data.effects ?? [],
  };
}

/**
 * Replace the item's Active Effects with the given effect data. Embedded
 * collections are managed explicitly rather than through a plain update, and
 * the source ids are kept so anything referencing an effect stays valid.
 */
async function replaceEffects(item, effects) {
  const existing = item.effects.map((e) => e.id);
  if (existing.length) {
    await item.deleteEmbeddedDocuments("ActiveEffect", existing);
  }
  if (effects?.length) {
    await item.createEmbeddedDocuments("ActiveEffect", effects, {
      keepId: true,
    });
  }
}

/**
 * Pull a fresh copy of this item from the compendium entry it came from,
 * stashing the current content so the change can be undone.
 */
export async function resyncItemFromSource(item) {
  if (!item?.isOwner) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Resync.NoPermission"));
    return;
  }

  const source = await resolveResyncSource(item);
  if (!source) {
    ui.notifications.error(
      game.i18n.format("REDSTEEL.Resync.NotFound", { item: item.name }),
    );
    return;
  }

  const confirmed = await Dialog.confirm({
    title: game.i18n.localize("REDSTEEL.Resync.ConfirmTitle"),
    content: `<p>${game.i18n.format("REDSTEEL.Resync.ConfirmBody", {
      item: item.name,
      source: source.name,
      pack: source.compendium?.metadata?.label ?? source.pack ?? "",
    })}</p>`,
    defaultYes: false,
  });
  if (!confirmed) return;

  const backup = { at: Date.now(), sourceUuid: source.uuid, ...contentOf(item) };
  const incoming = contentOf(source);

  // The snapshot is written first and on its own, so an interruption partway
  // through the content replacement still leaves a usable undo point.
  await item.update({ [`flags.redsteel.${BACKUP_FLAG}`]: backup });

  await item.update({
    name: incoming.name,
    img: incoming.img,
    system: incoming.system,
    // Record what it was *actually* synced from. Much of this system's pack
    // content still carries a `compendiumSource` pointing at the long-gone
    // import module it originally came from, so writing the resolved uuid here
    // lets the pointer self-heal: the next resync resolves directly instead of
    // falling back to a name search.
    "_stats.compendiumSource": source.uuid,
  });

  await replaceEffects(item, incoming.effects);

  ui.notifications.info(
    game.i18n.format("REDSTEEL.Resync.Done", { item: incoming.name }),
  );
}

/** Restore the content stashed by the most recent resync. */
export async function undoItemResync(item) {
  if (!item?.isOwner) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Resync.NoPermission"));
    return;
  }

  const backup = getResyncBackup(item);
  if (!backup) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Resync.NoBackup"));
    return;
  }

  const when = backup.at
    ? new Date(backup.at).toLocaleString()
    : game.i18n.localize("REDSTEEL.Resync.UnknownTime");

  const confirmed = await Dialog.confirm({
    title: game.i18n.localize("REDSTEEL.Resync.UndoTitle"),
    content: `<p>${game.i18n.format("REDSTEEL.Resync.UndoBody", {
      item: backup.name ?? item.name,
      when,
    })}</p>`,
    defaultYes: false,
  });
  if (!confirmed) return;

  await item.update({
    name: backup.name,
    img: backup.img,
    system: backup.system,
    [`flags.redsteel.-=${BACKUP_FLAG}`]: null,
  });

  await replaceEffects(item, backup.effects);

  ui.notifications.info(
    game.i18n.format("REDSTEEL.Resync.UndoDone", { item: backup.name }),
  );
}
