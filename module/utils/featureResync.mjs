/**
 * One-shot refresh of every owned feature and trait (`type: "feature"`) from
 * the ruleset pack, so pack edits (reroll pools, roll triggers, descriptions,
 * Active Effects) reach characters who already carry the item.
 *
 * It is the bulk form of "Resync with ruleset" (itemResync.mjs), with two
 * differences that make it safe to run unattended over a whole world:
 *
 *   1. Per-character state survives. Content comes from the pack; these stay
 *      as the copy has them:
 *        - `flags` (language, native language, Hated Enemy pick, ...)
 *        - `system.cost` (what this character paid, see the per-copy ruling)
 *        - `system.weaponSpec.tag` (the weapon tag picked on acquiring)
 *        - spent reroll charges, carried per pool index, clamped to the new max
 *        - which effect of a trait choice group is enabled (Elder Blood)
 *        - `_id`, `ownership`, `sort`, and the ids of matched Active Effects
 *   2. It never asks. A copy whose source is ambiguous (two pack entries share
 *      its name and the recorded pointer is dead) or missing is left alone.
 *
 * Only copies that actually differ are written, and each one gets the usual
 * `flags.redsteel.resyncBackup` snapshot, so the item sheet's "Undo re-sync"
 * restores any single item that should have kept a hand edit.
 *
 * Bump RESYNC_VERSION to run it again after a later pack change.
 */

const SETTING = "featureResyncVersion";
const RESYNC_VERSION = 1;
const PACK_ID = "redsteel.redsteel-items";

export function registerFeatureResyncSetting() {
  game.settings.register("redsteel", SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
  });
}

/** Pack features by uuid, and by lower-cased name (a list: names can repeat). */
async function loadPackFeatures() {
  const pack = game.packs.get(PACK_ID);
  if (!pack) return null;
  const docs = await pack.getDocuments({ type: "feature" });
  const byUuid = new Map();
  const byName = new Map();
  for (const doc of docs) {
    const data = doc.toObject();
    const entry = { uuid: doc.uuid, data };
    byUuid.set(doc.uuid, entry);
    const key = data.name?.trim().toLowerCase();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(entry);
  }
  return { byUuid, byName };
}

/**
 * The pack entry this copy comes from: the recorded pointer when it resolves
 * into the pack, otherwise a unique name match. Ambiguous names return null.
 */
function resolveSource(item, packData) {
  const uuid =
    item._stats?.compendiumSource || item.getFlag?.("core", "sourceId");
  if (uuid && packData.byUuid.has(uuid)) return packData.byUuid.get(uuid);
  const matches =
    packData.byName.get(item.name?.trim().toLowerCase() ?? "") ?? [];
  return matches.length === 1 ? matches[0] : null;
}

/**
 * A copy of `value` with every HTML-looking string re-serialised by the
 * browser. A saved HTML field comes back cleaned (`<br />` becomes `<br>`),
 * while the compiled pack keeps the raw markup, so without this every
 * description would compare as changed on every run.
 */
function normalizeHtml(value) {
  if (typeof value === "string") {
    if (!value.includes("<")) return value;
    const template = document.createElement("template");
    template.innerHTML = value;
    return template.innerHTML;
  }
  if (Array.isArray(value)) return value.map(normalizeHtml);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeHtml(v)]),
    );
  }
  return value;
}

/** Whether applying `update` on top of `current` would change anything. */
function wouldChange(current, update) {
  const merged = foundry.utils.mergeObject(
    foundry.utils.deepClone(current),
    foundry.utils.deepClone(update),
    { inplace: false },
  );
  return !foundry.utils.objectsEqual(normalizeHtml(merged), normalizeHtml(current));
}

/**
 * The pack's reroll block with this copy's spent charges carried over. Pools
 * carry by index; a legacy `{value, active}` copy feeds its spent count into
 * the first new pool. A pack entry still in the legacy shape keeps the copy's
 * `active[]` slots.
 */
function carryRerollUse(oldReroll, newReroll) {
  const next = foundry.utils.deepClone(newReroll ?? {});
  const oldPools = Array.isArray(oldReroll?.pools) ? oldReroll.pools : [];
  const oldActive = Array.isArray(oldReroll?.active) ? oldReroll.active : [];
  const legacySpent = oldPools.length ? 0 : oldActive.filter(Boolean).length;

  if (Array.isArray(next.pools)) {
    next.pools = next.pools.map((pool, i) => {
      const max = Math.max(0, Number(pool.max) || 0);
      const spent = oldPools.length
        ? Number(oldPools[i]?.used) || 0
        : i === 0
          ? legacySpent
          : 0;
      return { ...pool, used: Math.min(max, Math.max(0, spent)) };
    });
  }
  if (Array.isArray(next.active) && next.active.length) {
    next.active = next.active.map((_, i) => !!oldActive[i]);
  }
  return next;
}

/** The copy's new `system`: pack content plus this copy's own state. */
function buildSystem(current, sourceSystem) {
  const next = foundry.utils.deepClone(sourceSystem);
  if (current.cost !== undefined) next.cost = foundry.utils.deepClone(current.cost);
  if (current.weaponSpec?.tag) {
    next.weaponSpec = { ...(next.weaponSpec ?? {}), tag: current.weaponSpec.tag };
  }
  next.reroll = carryRerollUse(current.reroll, next.reroll);
  return next;
}

/** Strip the bookkeeping fields that never take part in a comparison. */
function effectContent(data) {
  const copy = foundry.utils.deepClone(data);
  delete copy._stats;
  return copy;
}

/**
 * Effect operations that bring the copy's effects in line with the pack.
 * Pack effects match an existing effect by id, then by name; a match keeps
 * its id and origin, and a trait choice keeps the pick that was made.
 */
function planEffects(item, sourceEffects) {
  const existing = item.effects.contents;
  const existingIds = new Set(existing.map((e) => e.id));
  const matched = new Set();
  const updates = [];
  const creates = [];

  for (const src of sourceEffects) {
    const match =
      existing.find((e) => e.id === src._id && !matched.has(e.id)) ??
      existing.find((e) => !matched.has(e.id) && e.name === src.name);

    if (!match) {
      const data = effectContent(src);
      if (existingIds.has(data._id)) delete data._id;
      creates.push(data);
      continue;
    }

    matched.add(match.id);
    const current = effectContent(match.toObject());
    const data = effectContent(src);
    data._id = match.id;
    data.origin = current.origin ?? data.origin ?? null;
    if (src.flags?.redsteel?.traitChoice) data.disabled = current.disabled;
    if (wouldChange(current, data)) updates.push(data);
  }

  const deletes = existing.filter((e) => !matched.has(e.id)).map((e) => e.id);
  return { updates, creates, deletes };
}

/**
 * Plan one copy. Returns null when the copy has no unique source or already
 * matches it.
 */
function planItem(item, packData) {
  const source = resolveSource(item, packData);
  if (!source) return null;

  const current = item.toObject();
  const system = buildSystem(current.system ?? {}, source.data.system ?? {});
  const content = { name: source.data.name, img: source.data.img, system };
  const effects = planEffects(item, source.data.effects ?? []);

  const contentChanged = wouldChange(
    { name: current.name, img: current.img, system: current.system },
    content,
  );
  const effectsChanged =
    effects.updates.length || effects.creates.length || effects.deletes.length;
  if (!contentChanged && !effectsChanged) return null;

  return {
    item,
    effects,
    update: {
      _id: item.id,
      ...content,
      "_stats.compendiumSource": source.uuid,
      "flags.redsteel.resyncBackup": {
        at: Date.now(),
        sourceUuid: source.uuid,
        name: current.name,
        img: current.img,
        system: current.system,
        effects: current.effects ?? [],
      },
    },
  };
}

/** Refresh one actor's features. Returns how many copies were written. */
async function resyncActor(actor, packData) {
  const plans = (actor?.items?.contents ?? [])
    .filter((item) => item.type === "feature")
    .map((item) => planItem(item, packData))
    .filter(Boolean);
  if (!plans.length) return 0;

  await actor.updateEmbeddedDocuments(
    "Item",
    plans.map((p) => p.update),
  );

  for (const { item, effects } of plans) {
    if (effects.deletes.length) {
      await item.deleteEmbeddedDocuments("ActiveEffect", effects.deletes);
    }
    if (effects.updates.length) {
      await item.updateEmbeddedDocuments("ActiveEffect", effects.updates);
    }
    if (effects.creates.length) {
      await item.createEmbeddedDocuments("ActiveEffect", effects.creates, {
        keepId: true,
      });
    }
  }

  console.log(
    `Redsteel | Feature resync: ${actor.name}: ${plans
      .map((p) => p.item.name)
      .join(", ")}`,
  );
  return plans.length;
}

/**
 * Run the refresh once per world (per RESYNC_VERSION), GM only. A missing or
 * empty pack writes nothing and leaves the setting unset, so the next load
 * tries again. Also reachable as `game.redsteel.resyncOwnedFeatures({force: true})`.
 * @param {{force?: boolean}} [options] force re-runs regardless of the setting
 */
export async function resyncOwnedFeatures({ force = false } = {}) {
  if (!game.user.isGM) return;
  if (!force && game.settings.get("redsteel", SETTING) >= RESYNC_VERSION) return;

  const packData = await loadPackFeatures();
  if (!packData?.byUuid.size) return;

  let items = 0;
  let actors = 0;
  let failed = 0;
  const run = async (actor) => {
    try {
      const written = await resyncActor(actor, packData);
      if (written) {
        items += written;
        actors += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`Redsteel | Feature resync failed for ${actor?.name}:`, err);
    }
  };

  // Base actors first, so unlinked tokens that merely inherit a feature
  // already read the new version and only genuine token-level copies differ.
  for (const actor of game.actors.contents) await run(actor);
  for (const scene of game.scenes.contents) {
    for (const token of scene.tokens.contents) {
      if (!token.actorLink && token.actor) await run(token.actor);
    }
  }

  // A failed actor leaves the setting unset, so the next load retries; the
  // copies already written match the pack by then and are skipped.
  if (!failed) await game.settings.set("redsteel", SETTING, RESYNC_VERSION);
  if (items) {
    ui.notifications.info(
      game.i18n.format("REDSTEEL.FeatureResync.Done", { items, actors }),
    );
  }
}
