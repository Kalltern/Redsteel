/**
 * Copies each spell's placement area (`system.area`, see spellArea.mjs) from
 * the `redsteel.All-Spells` pack onto spell copies that already exist in the
 * world: world items, actors, then unlinked tokens.
 *
 * An actor's spell is a copy of the compendium entry, so area data added to
 * the pack never reaches it on its own. Copies are matched by name (the pack's
 * area spells all have unique names), and only spells whose pack entry has a
 * shape are touched, so a pack spell with no area never wipes a copy.
 *
 * Runs once per AREA_SYNC_VERSION on the GM's `ready`. Bump the version after
 * a later area data pass to push the new values onto every copy. A pack with
 * no area data yet (the JSON not compiled) writes nothing and leaves the
 * version unset, so the next load tries again.
 */

const SETTING = "spellAreaSyncVersion";
// 2: zone movement (move, moveHexes) and the halved-duration rounds fix.
// 3: traps (shape "trap", stops, mayBorder, decoy).
const AREA_SYNC_VERSION = 3;
/** template.json's `Item.spell.area` defaults, in a fixed key order. */
const AREA_DEFAULTS = {
  shape: "",
  size: 0,
  angle: 0,
  targets: "all",
  includeCaster: false,
  linger: false,
  rounds: "",
  move: "",
  moveHexes: 0,
  stops: false,
  mayBorder: false,
  decoy: false,
};

export function registerSpellAreaSyncSetting() {
  game.settings.register("redsteel", SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });
}

/** An area reduced to its known keys, in a fixed order, for comparing. */
function normalize(area) {
  const out = {};
  for (const [key, fallback] of Object.entries(AREA_DEFAULTS)) {
    out[key] = area?.[key] ?? fallback;
  }
  return out;
}

/** The pack's spells that carry an area, keyed by name. */
async function loadPackAreas() {
  const pack = game.packs.get("redsteel.All-Spells");
  const index = await pack?.getIndex({ fields: ["system.area"] });
  const areas = new Map();
  for (const entry of index?.contents ?? []) {
    if (entry.type !== "spell") continue;
    const area = entry.system?.area;
    if (!String(area?.shape ?? "").trim()) continue;
    areas.set(entry.name, normalize(area));
  }
  return areas;
}

/** The updates that bring one collection of items in line with the pack. */
function buildUpdates(items, areas) {
  const updates = [];
  for (const item of items) {
    if (item.type !== "spell" || !areas.has(item.name)) continue;
    const want = areas.get(item.name);
    if (JSON.stringify(normalize(item.system.area)) === JSON.stringify(want)) continue;
    updates.push({ _id: item.id, "system.area": want });
  }
  return updates;
}

async function syncActor(actor, areas) {
  const updates = buildUpdates(actor?.items?.contents ?? [], areas);
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return updates.length;
}

/**
 * Run the sync once per world and version, GM only.
 *
 * @param {{force?: boolean}} [options]  `force` runs it again regardless.
 * @returns {Promise<number>} How many spell copies were written.
 */
export async function syncSpellAreas({ force = false } = {}) {
  if (!game.user.isGM) return 0;
  if (!force && game.settings.get("redsteel", SETTING) >= AREA_SYNC_VERSION) return 0;

  const areas = await loadPackAreas();
  if (!areas.size) return 0;

  let written = 0;
  const worldUpdates = buildUpdates(game.items.contents, areas);
  if (worldUpdates.length) await Item.updateDocuments(worldUpdates);
  written += worldUpdates.length;

  // Base actors first, so unlinked tokens that merely inherit a spell already
  // read the new area and only genuine token-level copies get written.
  for (const actor of game.actors.contents) written += await syncActor(actor, areas);
  for (const scene of game.scenes.contents) {
    for (const token of scene.tokens.contents) {
      if (!token.actorLink) written += await syncActor(token.actor, areas);
    }
  }

  await game.settings.set("redsteel", SETTING, AREA_SYNC_VERSION);
  if (written) console.log(`Redsteel | Spell areas copied onto ${written} spell copies`);
  return written;
}
