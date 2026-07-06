import { normalizeTrigger } from "./traitPills.mjs";

/**
 * Reroll resource model.
 *
 * A feature item can grant one or more independent **reroll pools**. Each pool
 * binds to zero or more skills and carries a count:
 *   system.reroll.pools = [{ label, skillsRaw, max, used }, ...]
 *
 * - `skillsRaw` is a comma-separated list of skill shortcuts ("perception,
 *   archery"), normalized the same way as roll triggers. A pool whose skill list
 *   is empty — or that explicitly lists a universal keyword ("universal", "any",
 *   "all") — is **universal**: usable to reroll any test.
 * - `max` rerolls are available; `used` have been spent. A Long Rest resets
 *   `used` to 0 (see {@link resetActorRerolls}).
 *
 * Legacy features (no `pools`, only `system.reroll.{name,value,active}`) are read
 * transparently as a single universal pool so they keep working until re-saved.
 */

/** Skill tokens that mark a pool as usable on any roll. */
const UNIVERSAL_KEYS = new Set(["universal", "any", "all"]);

/** Parse a comma-separated skill string into normalized, non-universal keys. */
function parseSkillList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => normalizeTrigger(s))
    .filter((s) => s && !UNIVERSAL_KEYS.has(s));
}

/**
 * Read `system.reroll.pools` as a plain array. A form submit can turn the array
 * into an index-keyed object ({0:{…},1:{…}}) — tolerate that like variants do.
 */
function poolsArray(reroll) {
  const raw = reroll?.pools;
  return Array.isArray(raw) ? raw : Object.values(raw ?? {});
}

/**
 * Normalize one feature item's rerolls into a flat list of pool descriptors.
 * Falls back to the legacy `{name, value, active}` shape as a single universal
 * pool when no `pools` are defined.
 *
 * @param {Item} item  A feature item.
 * @returns {{itemId:string, poolIndex:number, label:string, img:string,
 *            skills:string[], universal:boolean, max:number, used:number,
 *            remaining:number}[]}
 */
export function getFeatureRerollPools(item) {
  if (!item || item.type !== "feature") return [];
  const reroll = item.system?.reroll ?? {};
  const pools = poolsArray(reroll);

  if (pools.length > 0) {
    return pools.map((pool, poolIndex) => {
      const max = Math.max(0, Number(pool?.max) || 0);
      const used = Math.min(max, Math.max(0, Number(pool?.used) || 0));
      const skills = parseSkillList(pool?.skillsRaw);
      const universal = skills.length === 0;
      return {
        itemId: item.id,
        poolIndex,
        label: pool?.label || (universal ? "Universal" : item.name),
        img: item.img,
        skills,
        universal,
        max,
        used,
        remaining: Math.max(0, max - used),
      };
    });
  }

  // Legacy fallback: one universal pool from {name, value, active}.
  const max = Math.max(0, Number(reroll.value) || 0);
  if (max <= 0) return [];
  const active = Array.isArray(reroll.active) ? reroll.active : [];
  const used = Math.min(max, active.filter(Boolean).length);
  return [
    {
      itemId: item.id,
      poolIndex: -1, // sentinel: legacy pool, persisted via `active[]`
      label: reroll.name || item.name,
      img: item.img,
      skills: [],
      universal: true,
      max,
      used,
      remaining: Math.max(0, max - used),
    },
  ];
}

/**
 * All reroll pools an actor owns, flattened across its feature items.
 * @param {Actor} actor
 */
export function getActorRerollPools(actor) {
  if (!actor) return [];
  const out = [];
  for (const item of actor.items) {
    if (item.type !== "feature") continue;
    // Skip empty pools (max 0) so the display only shows real reroll sources.
    out.push(...getFeatureRerollPools(item).filter((pool) => pool.max > 0));
  }
  return out;
}

/**
 * Pools that can be spent to reroll a test of the given skill: any pool with
 * `remaining > 0` that is universal or lists the (normalized) skill key.
 * @param {Actor} actor
 * @param {string} [skillKey]
 */
export function getEligibleRerolls(actor, skillKey) {
  const normalized = normalizeTrigger(skillKey);
  return getActorRerollPools(actor).filter((pool) => {
    if (pool.remaining <= 0) return false;
    if (pool.universal) return true;
    return normalized ? pool.skills.includes(normalized) : false;
  });
}

/**
 * Spend one reroll from a pool, persisting on the owning feature item.
 * @param {Actor} actor
 * @param {string} itemId
 * @param {number} poolIndex  Pool index, or -1 for a legacy `{value,active}` pool.
 * @returns {Promise<boolean>} true when a charge was consumed.
 */
export async function consumeReroll(actor, itemId, poolIndex) {
  const item = actor?.items?.get(itemId);
  if (!item) return false;
  const reroll = item.system?.reroll ?? {};
  const rawPools = poolsArray(reroll);

  // Legacy pool: flip the next free `active[]` slot to used.
  if (poolIndex === -1 || !rawPools.length) {
    const max = Math.max(0, Number(reroll.value) || 0);
    const active = Array.isArray(reroll.active) ? [...reroll.active] : [];
    const freeIndex = (() => {
      for (let i = 0; i < max; i++) if (!active[i]) return i;
      return -1;
    })();
    if (freeIndex === -1) return false;
    active[freeIndex] = true;
    await item.update({ "system.reroll.active": active });
    return true;
  }

  const pools = rawPools.map((p) => ({ ...p }));
  const pool = pools[poolIndex];
  if (!pool) return false;
  const max = Math.max(0, Number(pool.max) || 0);
  const used = Math.max(0, Number(pool.used) || 0);
  if (used >= max) return false;
  pool.used = used + 1;
  await item.update({ "system.reroll.pools": pools });
  return true;
}

/**
 * Toggle a single charge of a pool between ready and used (manual sheet control).
 * @param {Actor} actor
 * @param {string} itemId
 * @param {number} poolIndex
 */
export async function toggleRerollCharge(actor, itemId, poolIndex) {
  const item = actor?.items?.get(itemId);
  if (!item) return;
  const reroll = item.system?.reroll ?? {};
  const rawPools = poolsArray(reroll);

  if (poolIndex === -1 || !rawPools.length) {
    const max = Math.max(0, Number(reroll.value) || 0);
    const active = Array.isArray(reroll.active) ? [...reroll.active] : [];
    // If anything is ready, spend one; otherwise restore one.
    const usedCount = active.filter(Boolean).length;
    if (usedCount < max) {
      for (let i = 0; i < max; i++) {
        if (!active[i]) {
          active[i] = true;
          break;
        }
      }
    } else {
      for (let i = 0; i < max; i++) {
        if (active[i]) {
          active[i] = false;
          break;
        }
      }
    }
    await item.update({ "system.reroll.active": active });
    return;
  }

  const pools = rawPools.map((p) => ({ ...p }));
  const pool = pools[poolIndex];
  if (!pool) return;
  const max = Math.max(0, Number(pool.max) || 0);
  const used = Math.max(0, Number(pool.used) || 0);
  pool.used = used < max ? used + 1 : 0; // cycle: spend one, wrap back to full
  await item.update({ "system.reroll.pools": pools });
}

/**
 * Restore every reroll the actor owns to ready (used = 0). Called on Long Rest.
 * @param {Actor} actor
 * @returns {Promise<boolean>} true when any feature was changed.
 */
export async function resetActorRerolls(actor) {
  if (!actor) return false;
  const updates = [];
  for (const item of actor.items) {
    if (item.type !== "feature") continue;
    const reroll = item.system?.reroll ?? {};
    const update = { _id: item.id };
    let changed = false;

    const rawPools = poolsArray(reroll);
    if (rawPools.length) {
      const pools = rawPools.map((p) => ({ ...p }));
      for (const pool of pools) {
        if (Number(pool.used) > 0) {
          pool.used = 0;
          changed = true;
        }
      }
      if (changed) update["system.reroll.pools"] = pools;
    }

    if (Array.isArray(reroll.active) && reroll.active.some(Boolean)) {
      update["system.reroll.active"] = reroll.active.map(() => false);
      changed = true;
    }

    if (changed) updates.push(update);
  }

  if (!updates.length) return false;
  await actor.updateEmbeddedDocuments("Item", updates);
  return true;
}
