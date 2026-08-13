/**
 * Turning an owned Item into a hotbar macro.
 *
 * Two ways in, one implementation:
 *   - dragging the item onto the bar (the `hotbarDrop` handler in redsteel.mjs)
 *   - the star on the sheet's spell cards, which picks the slot for you
 *
 * Both produce the same macro, so a spell added either way is the same document
 * in the same folder and never doubles up.
 */

import {
  actorMacroFolderName,
  getOrCreateMacroFolder,
  fileMacroIfLoose,
} from "./macroFolders.mjs";
import { revealHotbarSlot } from "./redsteelHotbar.mjs";

/** Foundry has exactly 5 hotbar pages of 10 slots. */
const HOTBAR_SLOTS = 50;

/**
 * The macro command for an item. Spells quick-cast (no dialogs); everything
 * else keeps the generic item roll.
 * @param {Item} item
 * @param {string} uuid
 * @returns {string}
 */
function macroCommand(item, uuid) {
  // The spell's name rides along so the macro can re-find it if the item is
  // ever replaced — see quickCastSpell.
  return item.type === "spell"
    ? `game.redsteel.quickCastSpell(${JSON.stringify(uuid)}, ${JSON.stringify(item.name)});`
    : `game.redsteel.rollItemMacro(${JSON.stringify(uuid)});`;
}

/**
 * Find (or create) the macro for an owned item, filed under its actor's folder.
 * Does not touch the hotbar — the caller decides which slot it goes in.
 *
 * @param {Item} item - An owned item (its actor names the folder).
 * @param {string} uuid - The item UUID the macro should point at.
 * @returns {Promise<Macro|null>}
 */
export async function buildItemHotbarMacro(item, uuid) {
  if (!item || !uuid) return null;

  const isSpell = item.type === "spell";
  const name = isSpell ? (item.localizedName ?? item.name) : item.name;
  const command = macroCommand(item, uuid);

  let macro = game.macros.find((m) => m.name === name && m.command === command);

  // Only resolve a folder when one is actually needed — a new macro, or an
  // existing one still loose in the root — so re-adding a filed macro never
  // creates a stray folder.
  let folder = null;
  if (!macro || !macro.folder) {
    folder = await getOrCreateMacroFolder(actorMacroFolderName(item.actor));
  }

  if (macro) {
    await fileMacroIfLoose(macro, folder);
    return macro;
  }

  return Macro.create({
    name,
    type: "script",
    img: item.img,
    command,
    folder: folder?.id ?? null,
    flags: isSpell
      ? { "redsteel.spellMacro": true }
      : { "redsteel.itemMacro": true },
  });
}

/**
 * The lowest hotbar slot with nothing in it, counting across all five pages.
 * @returns {number|null} 1-50, or null when every slot is taken.
 */
export function findFirstEmptyHotbarSlot() {
  const filled = game.user.hotbar ?? {};
  for (let slot = 1; slot <= HOTBAR_SLOTS; slot++) {
    if (!filled[slot]) return slot;
  }
  return null;
}

/**
 * The star on a spell card: build the macro, drop it in the first free slot,
 * and make that slot visible so the player can see where it landed. Same result
 * as dragging the item onto the bar, minus having to find a gap yourself —
 * which matters because the Redsteel panel shows no macro rows by default, so
 * there may be nothing to drag onto.
 *
 * @param {Item} item - An owned item.
 * @returns {Promise<number|null>} The slot used, or null if nothing was added.
 */
export async function addItemToHotbar(item) {
  if (!item?.uuid) return null;

  const slot = findFirstEmptyHotbarSlot();
  if (!slot) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.UI.hotbarSlotTaken"));
    return null;
  }

  const macro = await buildItemHotbarMacro(item, item.uuid);
  if (!macro) return null;

  await game.user.assignHotbarMacro(macro, slot);
  await revealHotbarSlot(slot);

  ui.notifications.info(
    game.i18n.format("REDSTEEL.UI.addedToHotbar", { name: macro.name, slot }),
  );
  return slot;
}
