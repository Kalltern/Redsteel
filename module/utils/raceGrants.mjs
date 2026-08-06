/**
 * Race-granted features.
 *
 * A race Item may list feature Items in `system.grants` (each entry is
 * {uuid, name, img}). Every actor owning that race receives a copy of those
 * features as owned Items, tagged so we know we created them. The copies carry
 * their own transfer-mode Active Effects, so racial buffs apply through the
 * normal effect pipeline — there is deliberately no derived-data logic here.
 *
 * Sync runs only when the race Item itself is created/updated/deleted on an
 * actor (plus once on actor creation). A feature the GM deletes by hand
 * therefore stays deleted until the race changes — deliberate, so hand-tuned
 * NPCs are not fought over.
 */

const FLAG_SCOPE = "redsteel";
const GRANTED_FLAG = "raceGranted"; // boolean: this item came from a race
const SOURCE_FLAG = "raceGrantSource"; // string: the UUID it was copied from

// Re-entrancy guard, keyed by actor id: our own createEmbeddedDocuments /
// deleteEmbeddedDocuments calls fire the very hooks that call this.
const _syncing = new Set();

// Actors whose sync arrived while another run was still in flight. Replacing a
// race deletes the old Item and creates the new one back to back, so the
// clean-up triggered by the delete can still be running when the new race's
// createItem fires. Dropping that call would silently leave the new race with
// none of its traits, so it is deferred and replayed instead.
const _pending = new Set();

/**
 * Normalize a race Item's `system.grants` into a clean array.
 * Tolerates the array arriving as an indexed object after a form submit —
 * same tolerance as getRaceChoiceGroups in utils/race.mjs.
 * @param {Item} raceItem
 * @returns {{uuid: string, name: string, img: string}[]}
 */
export function getRaceGrants(raceItem) {
  const raw = raceItem?.system?.grants;
  const entries = Array.isArray(raw) ? raw : Object.values(raw ?? {});

  return entries
    .map((entry) => ({
      uuid: entry?.uuid ?? "",
      name: entry?.name ?? "",
      img: entry?.img ?? "",
    }))
    .filter((entry) => typeof entry.uuid === "string" && entry.uuid);
}

/**
 * Reconcile an actor's race-granted features against its race Item.
 * @param {Actor} actor
 */
export async function syncRaceGrants(actor) {
  if (!actor?.id) return;
  if (_syncing.has(actor.id)) {
    _pending.add(actor.id);
    return;
  }

  _syncing.add(actor.id);
  try {
    // Every feature UUID the actor's race should currently grant. No race at
    // all means an empty set, which removes any leftover copies.
    const race = actor.items.find((i) => i.type === "race");
    const desired = new Set(getRaceGrants(race).map((entry) => entry.uuid));

    // Features we previously granted, keyed by the UUID they came from.
    const granted = actor.items.filter((i) =>
      i.getFlag(FLAG_SCOPE, GRANTED_FLAG),
    );
    const grantedByUuid = new Map(
      granted.map((i) => [i.getFlag(FLAG_SCOPE, SOURCE_FLAG), i]),
    );

    // Anything the actor already owns from the same source, so a manually
    // added copy is never duplicated by us.
    const ownedSources = new Set(
      actor.items.map((i) => i._stats?.compendiumSource).filter(Boolean),
    );

    // Drop granted features the race no longer lists.
    const toDelete = granted
      .filter((i) => !desired.has(i.getFlag(FLAG_SCOPE, SOURCE_FLAG)))
      .map((i) => i.id);

    // Add the ones that are missing.
    const toAdd = [];
    for (const uuid of desired) {
      if (grantedByUuid.has(uuid) || ownedSources.has(uuid)) continue;
      const source = await fromUuid(uuid);
      if (!source) {
        console.warn(`Redsteel | race-granted feature not found: ${uuid}`);
        continue;
      }
      if (source.type !== "feature") {
        console.warn(
          `Redsteel | race grant is not a feature Item (${source.type}): ${uuid}`,
        );
        continue;
      }
      const data = source.toObject();
      delete data._id;
      data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
      foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.${GRANTED_FLAG}`, true);
      foundry.utils.setProperty(data, `flags.${FLAG_SCOPE}.${SOURCE_FLAG}`, uuid);
      toAdd.push(data);
    }

    if (toDelete.length) await actor.deleteEmbeddedDocuments("Item", toDelete);
    if (toAdd.length) await actor.createEmbeddedDocuments("Item", toAdd);
  } finally {
    _syncing.delete(actor.id);
  }

  // A call that arrived mid-run reconciles against the final state now.
  if (_pending.delete(actor.id)) await syncRaceGrants(actor);
}

/**
 * Remove every race-granted feature from an actor.
 *
 * Used when the race Item itself is deleted: at deleteItem time the race may
 * still be present in actor.items, so relying on syncRaceGrants finding "no
 * race" is not safe. The granted ids are collected directly instead.
 * @param {Actor} actor
 */
async function clearRaceGrants(actor) {
  if (!actor?.id) return;

  // Snapshot the ids synchronously, before anything else can add to the actor:
  // a copy granted by a race that replaced this one must not be caught here.
  const ids = actor.items
    .filter((i) => i.getFlag(FLAG_SCOPE, GRANTED_FLAG))
    .map((i) => i.id);
  if (!ids.length) return;

  if (_syncing.has(actor.id)) {
    _pending.add(actor.id);
    return;
  }

  _syncing.add(actor.id);
  try {
    await actor.deleteEmbeddedDocuments("Item", ids);
  } finally {
    _syncing.delete(actor.id);
  }

  if (_pending.delete(actor.id)) await syncRaceGrants(actor);
}

/**
 * Register the hooks that keep race grants in sync. Call once at ready.
 */
export function registerRaceGrants() {
  // New actor (e.g. duplicated or imported with a race already on it).
  Hooks.on("createActor", (actor, options, userId) => {
    if (game.user.id !== userId) return;
    syncRaceGrants(actor);
  });

  // A race landing on an actor grants its features. Feature copies we create
  // fire this hook too; ignoring anything that is not a race keeps that quiet,
  // while still letting abilityGrants.mjs react to the new feature.
  Hooks.on("createItem", (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.type !== "race") return;
    if (item.parent?.documentName !== "Actor") return;
    syncRaceGrants(item.parent);
  });

  // Editing the grant list on a race an actor already owns.
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.type !== "race") return;
    if (item.parent?.documentName !== "Actor") return;
    if (changes.system?.grants === undefined) return;
    syncRaceGrants(item.parent);
  });

  // Losing the race takes its features with it.
  Hooks.on("deleteItem", (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.type !== "race") return;
    if (item.parent?.documentName !== "Actor") return;
    clearRaceGrants(item.parent);
  });
}
