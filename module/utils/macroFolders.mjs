/**
 * Macro folders.
 *
 * The Macros sidebar is a flat list, and this system puts things in it from two
 * directions: the macros the system itself generates (Aim, Resume Duel), and
 * one macro per item or spell a player drags onto the hotbar. Left alone that
 * turns into an unreadable wall within a session or two, so both are filed:
 *
 *   "Redsteel Macros"        — everything the system pregenerates.
 *   "<Actor name> Macros"    — the item/spell macros made from that actor's sheet.
 *
 * Folder creation can fail (a player without permission to create world
 * folders), and that must never cost anyone their macro. Every failure here
 * resolves to null, and the callers fall back to creating the macro in the root
 * exactly as they did before — the folder is tidying, not a dependency.
 */

/** Folder holding the macros the system generates for everyone. */
export const SYSTEM_MACRO_FOLDER = "Redsteel Macros";

/**
 * The per-actor folder name. Kept in one place so the drop handler and any
 * future caller agree on it — the name is the only key we have for finding a
 * folder again.
 * @param {Actor} actor
 * @returns {string|null}
 */
export function actorMacroFolderName(actor) {
  const name = actor?.name?.trim();
  return name ? `${name} Macros` : null;
}

/**
 * Find a Macro folder by name, creating it if it does not exist yet.
 *
 * Matching is by name because that is what survives a world reload and what the
 * user sees. A folder the user has moved or nested is found and reused as-is;
 * we never create a second one alongside it.
 *
 * @param {string|null} name
 * @returns {Promise<Folder|null>} The folder, or null if it could not be made.
 */
export async function getOrCreateMacroFolder(name) {
  if (!name) return null;

  const existing = game.folders.find(
    (f) => f.type === "Macro" && f.name === name,
  );
  if (existing) return existing;

  // Document.canUserCreate is the documented check for "should this user be
  // offered the option to create this document type" — asking it first is what
  // keeps a player without folder permission from getting a red error every
  // time they drop an item. Only an explicit false bails; anything else tries,
  // and the catch below is the backstop.
  if (Folder.canUserCreate?.(game.user) === false) return null;

  try {
    return (await Folder.create({ name, type: "Macro" })) ?? null;
  } catch (err) {
    console.warn(
      `Redsteel | could not create the "${name}" macro folder; the macro will go in the root instead.`,
      err,
    );
    return null;
  }
}

/**
 * File a macro into a folder, but only if it is still loose in the root — a
 * macro the user has deliberately moved somewhere else stays where they put it.
 * @param {Macro} macro
 * @param {Folder|null} folder
 */
export async function fileMacroIfLoose(macro, folder) {
  if (!macro || !folder || macro.folder) return;
  try {
    await macro.update({ folder: folder.id });
  } catch (err) {
    console.warn(`Redsteel | could not file the macro "${macro.name}".`, err);
  }
}

/**
 * Ensure a set of system macros exists in the "Redsteel Macros" folder, GM only.
 *
 * These are never pinned to anyone's hotbar — the bar belongs to the player.
 * They exist so that every automated action has a plain, clickable fallback
 * sitting in the sidebar when a panel button misbehaves mid-session, and so
 * players can drag the ones they use onto their own bar.
 *
 * Matched by name, so a macro the GM has deleted comes back on the next load
 * (that is the point of a failsafe) while one they have edited or moved is left
 * alone. Existing copies loose in the root are filed on the way past.
 *
 * @param {Array<{name: string, command: string, img: string, shared?: boolean}>}
 *   macros - `shared` defaults to true: readable by every player. Pass false for
 *   GM tools.
 */
export async function ensureSystemMacros(macros) {
  if (!game.user.isGM) return;

  const folder = await getOrCreateMacroFolder(SYSTEM_MACRO_FOLDER);

  for (const data of macros) {
    const existing = game.macros.getName(data.name);
    if (existing) {
      await fileMacroIfLoose(existing, folder);
      continue;
    }

    const macro = await Macro.create({
      name: data.name,
      type: "script",
      command: data.command,
      img: data.img,
      folder: folder?.id ?? null,
    });

    // Ownership is set after creation rather than in the payload, matching how
    // every other shared macro in this system has always been made.
    if (data.shared !== false) {
      await macro?.update({ ownership: { default: 2 } }); // observer
    }
  }
}
