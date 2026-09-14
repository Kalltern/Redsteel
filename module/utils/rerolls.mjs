import {
  isCalendariaEnabled,
  getPendingCalendariaEntries,
} from "./calendariaIntegration.mjs";

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
 * - An attribute may be listed in two different scopes, and they are not the
 *   same: `str` is the raw **Strength test** only (Muscular: "reroll a Strength
 *   test"), while `str-based` is every non-combat roll governed by Strength —
 *   the raw test plus Athletics, Smithing, … (Brawny: "reroll a strength based
 *   skill"). Neither reaches combat: see {@link getEligibleRerolls}.
 * - A "critfail" keyword (also "crit fail" / "critical failure") in the list
 *   marks the pool as able to reroll **Critical Failures** (e.g. Lucky:
 *   "universal, critfail"). It is not a skill: "critfail" alone is still a
 *   universal pool. Pools without it can only reroll non-crit-failure tests.
 * - `max` rerolls are available; `used` have been spent. A Long Rest resets
 *   `used` to 0 (see {@link resetActorRerolls}).
 *
 * Legacy features (no `pools`, only `system.reroll.{name,value,active}`) are read
 * transparently as a single universal pool so they keep working until re-saved.
 */

/**
 * Normalize a trigger for comparison: lowercase, strip everything that
 * isn't a letter or digit. Item sheets store triggers lowercased
 * ("animalhandling") while skill keys are camelCase ("animalHandling"),
 * so "firstAid", "first aid", "first-aid" and "firstaid" must all match.
 * Shared with the trait pills (traitPills.mjs imports it from here).
 */
export function normalizeTrigger(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Skill tokens that mark a pool as usable on any roll. */
const UNIVERSAL_KEYS = new Set(["universal", "any", "all"]);

/** Trigger tokens that mark a pool as able to reroll Critical Failures. */
const CRITFAIL_KEYS = new Set(["critfail", "critfails", "criticalfailure"]);

/**
 * Attribute short keys, in the order attributes are stored (Object.entries on
 * system.attributes). This index is what every skill carries as its `id` (its
 * governing attribute), so `ATTR_BY_INDEX[skill.id]` is the attribute a skill
 * roll is "based on".
 */
const ATTR_BY_INDEX = ["str", "dex", "end", "int", "wil", "cha", "per"];
const ATTR_SET = new Set(ATTR_BY_INDEX);

/** Long attribute spellings accepted in a pool's skill list. */
const ATTR_ALIASES = {
  strength: "str",
  dexterity: "dex",
  endurance: "end",
  intelligence: "int",
  will: "wil",
  willpower: "wil",
  charisma: "cha",
  perception: "per",
};

/**
 * Suffix marking an **attribute group** scope: `str-based` (also written
 * "strength based" or "strBased") covers every non-combat roll governed by
 * Strength, where a bare `str` covers only the raw Strength test.
 */
const ATTR_GROUP_SUFFIX = "based";

/** The group token for an attribute short key: "str" → "strbased". */
function attrGroupToken(attr) {
  return `${attr}${ATTR_GROUP_SUFFIX}`;
}

/** The attribute a group token stands for, or null when it isn't one. */
function attrFromGroupToken(token) {
  if (!token.endsWith(ATTR_GROUP_SUFFIX)) return null;
  const stem = token.slice(0, -ATTR_GROUP_SUFFIX.length);
  const attr = ATTR_ALIASES[stem] ?? stem;
  return ATTR_SET.has(attr) ? attr : null;
}

/** Reroll tokens every combat roll emits, used to detect combat rolls for the cap. */
const COMBAT_TOKENS = new Set(["attack", "defense"]);

/** Match a `combatcapN` keyword — a per-pool cap on combat (attack/defense) rerolls. */
const COMBAT_CAP_RE = /^combatcap(\d+)$/;

/** Whether a normalized token is a pool keyword rather than a real skill key. */
function isPoolKeyword(token) {
  return (
    UNIVERSAL_KEYS.has(token) ||
    CRITFAIL_KEYS.has(token) ||
    COMBAT_CAP_RE.test(token)
  );
}

/**
 * Normalize one entry of a pool's skill list. On top of the shared trigger
 * normalization this resolves attribute spellings, so "strength", "str",
 * "str-based", "strength based" and "strBased" all land on `str` / `strbased`.
 */
function normalizePoolToken(value) {
  const token = normalizeTrigger(value);
  if (!token) return "";
  const groupAttr = attrFromGroupToken(token);
  if (groupAttr) return attrGroupToken(groupAttr);
  return ATTR_ALIASES[token] ?? token;
}

/** Parse a comma-separated skill string into normalized skill keys (keywords excluded). */
function parseSkillList(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => normalizePoolToken(s))
    .filter((s) => s && !isPoolKeyword(s));
}

/**
 * Whether a roll-trigger scope (a trait pill's triggers, as a comma-separated
 * string or an array of entries) reaches a roll emitting `tokens`. Entries are
 * read like a pool's skill list: "universal" / "any" / "all" match every roll,
 * and attribute spellings resolve, so "str-based" or "strength based" meet the
 * "strbased" token a Strength-governed roll emits. Unlike a pool, an empty
 * scope matches nothing, and the other pool keywords (critfail, combatcapN)
 * are ignored.
 * @param {string|string[]} entries
 * @param {string[]} tokens  Normalized roll tokens.
 * @returns {boolean}
 */
export function scopeMatchesTokens(entries, tokens) {
  const list = Array.isArray(entries)
    ? entries
    : String(entries ?? "").split(",");
  const tokenSet = new Set(tokens);
  return list.some((entry) => {
    const token = normalizePoolToken(entry);
    return UNIVERSAL_KEYS.has(token) || tokenSet.has(token);
  });
}

/** Whether a comma-separated skill string contains a crit-failure keyword. */
function hasCritFailKey(raw) {
  return String(raw ?? "")
    .split(",")
    .map((s) => normalizeTrigger(s))
    .some((s) => CRITFAIL_KEYS.has(s));
}

/**
 * The combat cap encoded in a `combatcapN` keyword: at most N of this pool's
 * charges may be spent on combat (attack/defense) rerolls. Returns Infinity
 * (no cap) when absent.
 */
function parseCombatMax(raw) {
  for (const token of String(raw ?? "").split(",")) {
    const m = COMBAT_CAP_RE.exec(normalizeTrigger(token));
    if (m) return Math.max(0, Number(m[1]) || 0);
  }
  return Infinity;
}

/**
 * The reroll tokens a plain skill / attribute / combat-skill test emits.
 *
 * - an **attribute** test emits the attribute and its group ("str",
 *   "strbased"), so both Muscular and Brawny can reroll it;
 * - a **skill** test emits the skill key and its governing attribute's *group*
 *   ("smithing", "strbased") — never the bare attribute, so Muscular (scoped
 *   "str") cannot reroll Smithing while Brawny ("str-based") can;
 * - a **combat skill** test emits only its own key: attribute scopes never
 *   reach combat (see {@link getEligibleRerolls}).
 *
 * @param {Actor} actor
 * @param {string} skillKey
 * @returns {string[]}
 */
export function getRerollTokensForSkill(actor, skillKey) {
  const key = String(skillKey ?? "");
  const norm = normalizeTrigger(key);
  if (!norm) return [];

  // Direct attribute test — reachable from the attribute and from its group.
  if (ATTR_SET.has(norm)) return [norm, attrGroupToken(norm)];

  const skill = actor?.system?.skills?.[key];
  if (skill && Number.isFinite(Number(skill.id))) {
    const attr = ATTR_BY_INDEX[Number(skill.id)] ?? null;
    if (attr) return [norm, attrGroupToken(attr)];
  }
  return [norm];
}

/**
 * The reroll tokens a weapon attack card emits: "attack" and the combat skill
 * it uses (combat/archery/throwing). No attribute token is emitted — an
 * attribute-scoped pool must never pay for an attack; the pool has to be
 * universal or list "attack" / the combat skill itself.
 * @param {Item|null} weapon
 * @returns {string[]}
 */
export function getAttackRerollTokens(weapon = null) {
  if (!weapon) return ["attack"];
  const cls = weapon.system?.class;
  let combatKey = "combat";
  if (cls === "bow" || cls === "crossbow") combatKey = "archery";
  else if (weapon.system?.thrown === true) combatKey = "throwing";
  return ["attack", combatKey];
}

/**
 * The regular skill a combat skill is derived from, so pools scoped to that
 * skill also reroll the combat action. Dodge is rated off Acrobatics, so an
 * "acrobacy"-tied reroll applies to a dodge.
 */
const COMBAT_BASE_SKILL = { dodge: "acrobacy" };

/**
 * The reroll tokens a defense card emits: "defense", the defense skill used
 * (dodge/meleeDefense/rangedDefense) and — for dodge — the Acrobatics skill it
 * is rated from. As with attacks there is no attribute token: attribute-scoped
 * pools never reroll a defense.
 * @param {string} defenseKey
 * @returns {string[]}
 */
export function getDefenseRerollTokens(defenseKey) {
  const tokens = ["defense", defenseKey];
  const baseSkill = COMBAT_BASE_SKILL[defenseKey];
  if (baseSkill) tokens.push(baseSkill);
  return tokens;
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
      const combatMax = parseCombatMax(pool?.skillsRaw);
      const combatUsed = Math.min(
        used,
        Math.max(0, Number(pool?.combatUsed) || 0),
      );
      return {
        itemId: item.id,
        poolIndex,
        key: `${item.id}:${poolIndex}`,
        label: pool?.label || (universal ? "Universal" : item.name),
        img: item.img,
        skills,
        universal,
        critFail: hasCritFailKey(pool?.skillsRaw),
        max,
        used,
        remaining: Math.max(0, max - used),
        combatMax,
        combatUsed,
        combatRemaining: Math.max(0, combatMax - combatUsed),
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
      key: `${item.id}:-1`,
      label: reroll.name || item.name,
      img: item.img,
      skills: [],
      universal: true,
      // Legacy items predate the "critfail" keyword and could always reroll
      // crit failures (Lucky is the archetype) — keep that until re-saved
      // with pools, which opts into the explicit keyword.
      critFail: true,
      max,
      used,
      remaining: Math.max(0, max - used),
      // Legacy pools predate the combat cap — never restricted.
      combatMax: Infinity,
      combatUsed: 0,
      combatRemaining: Infinity,
    },
  ];
}

/**
 * Actor flag holding the player's own ordering of reroll pools: an array of
 * pool keys ("<itemId>:<poolIndex>"), best-first. Keys that no longer resolve
 * to a pool are ignored, and pools missing from the list (a feature gained
 * after the last reorder) fall in behind the ordered ones in item order.
 */
export const REROLL_ORDER_FLAG = "rerollOrder";

/** The stored ordering, or an empty array when the actor has never reordered. */
export function getActorRerollOrder(actor) {
  const order = actor?.getFlag?.("redsteel", REROLL_ORDER_FLAG);
  return Array.isArray(order) ? order.filter((k) => typeof k === "string") : [];
}

/**
 * Persist a new ordering of reroll pools.
 * @param {Actor} actor
 * @param {string[]} keys  Pool keys in display order.
 */
export async function setActorRerollOrder(actor, keys) {
  if (!actor) return;
  await actor.setFlag("redsteel", REROLL_ORDER_FLAG, [...keys]);
}

/**
 * Apply the actor's stored ordering to a list of pools. Stable: pools with no
 * stored rank keep their relative order at the end of the list.
 * @param {Actor} actor
 * @param {object[]} pools
 */
function sortByActorOrder(actor, pools) {
  const order = getActorRerollOrder(actor);
  if (!order.length) return pools;
  const rank = new Map(order.map((key, i) => [key, i]));
  return pools
    .map((pool, i) => ({ pool, i, rank: rank.get(pool.key) ?? Infinity }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((entry) => entry.pool);
}

/**
 * All reroll pools an actor owns, flattened across its feature items and put in
 * the player's own order (see {@link setActorRerollOrder}). The Features tab and
 * the reroll prompt both read this, so a reorder is also a priority order.
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
  return sortByActorOrder(actor, out);
}

/**
 * Pools that can be spent to reroll a test emitting the given tokens: any pool
 * with `remaining > 0` that is universal or lists one of the (normalized)
 * tokens. A skill roll emits its key plus its governing attribute's *group*
 * token (see {@link getRerollTokensForSkill}); attacks and defenses emit
 * "attack" / "defense" and their combat-skill key and no attribute token at
 * all — so rerolling combat takes a universal pool, or one that names "attack",
 * "defense" or the combat skill.
 *
 * Rerolling a Critical Failure additionally requires the pool's `critFail`
 * capability. A combat roll (tokens include "attack"/"defense") additionally
 * requires the pool to have combat-cap charges left (`combatRemaining > 0`) —
 * this is how Eagle senses is limited to one archery/ranged-defense reroll.
 *
 * @param {Actor} actor
 * @param {string|string[]} [tokens]  One or more roll tokens (a bare skill key
 *   is accepted for backward compatibility, e.g. "alchemy").
 * @param {{critFailure?: boolean}} [options]  Whether the test being rerolled
 *   was a natural Critical Failure.
 */
export function getEligibleRerolls(actor, tokens, { critFailure = false } = {}) {
  const list = Array.isArray(tokens) ? tokens : [tokens];
  const normalized = list.map((t) => normalizeTrigger(t)).filter(Boolean);
  const tokenSet = new Set(normalized);
  const isCombat = normalized.some((t) => COMBAT_TOKENS.has(t));

  return getActorRerollPools(actor).filter((pool) => {
    if (pool.remaining <= 0) return false;
    if (critFailure && !pool.critFail) return false;
    if (isCombat && pool.combatRemaining <= 0) return false;
    if (pool.universal) return true;
    return pool.skills.some((s) => tokenSet.has(s));
  });
}

/**
 * Spend one reroll from a pool, persisting on the owning feature item.
 * @param {Actor} actor
 * @param {string} itemId
 * @param {number} poolIndex  Pool index, or -1 for a legacy `{value,active}` pool.
 * @param {{combat?: boolean}} [options]  Whether this reroll is spent on a
 *   combat (attack/defense) roll — counts against the pool's `combatcap`.
 * @returns {Promise<boolean>} true when a charge was consumed.
 */
export async function consumeReroll(actor, itemId, poolIndex, { combat = false } = {}) {
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
  // Track combat-spent charges so the combatcap can gate future combat rerolls.
  if (combat) {
    pool.combatUsed = Math.max(0, Number(pool.combatUsed) || 0) + 1;
  }
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
 * Human-readable scope of a pool, for the picker: "Universal", or its skill
 * list with group tokens spelled out ("str-based, archery").
 */
function formatPoolScope(pool) {
  if (pool.universal) return "Universal";
  return pool.skills
    .map((s) => {
      const attr = attrFromGroupToken(s);
      return attr ? `${attr}-based` : s;
    })
    .join(", ");
}

/**
 * Prompt the user to choose one of several eligible reroll pools.
 *
 * Shared by every reroll entry point (chat cards, the Alchemy panel, the Mental
 * Duel) so a pool always looks the same wherever it is spent.
 *
 * @param {object[]} eligible  Pool descriptors from {@link getEligibleRerolls}.
 * @returns {Promise<object|null>} the chosen pool descriptor, or null if cancelled.
 */
export async function pickRerollPool(eligible) {
  const rows = eligible
    .map((pool, i) => {
      const remaining = `${pool.remaining}/${pool.max}`;
      const tag = [
        formatPoolScope(pool),
        pool.critFail ? "crit fail" : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `
        <label class="reroll-pick-row" style="display:flex; align-items:center; gap:8px; padding:4px 2px; cursor:pointer;">
          <input type="radio" name="reroll-pick" value="${i}" ${i === 0 ? "checked" : ""}>
          <img src="${pool.img}" width="28" height="28" style="border:none; flex:0 0 auto;">
          <span style="flex:1;"><b>${pool.label}</b> <span style="opacity:0.7;">(${tag})</span></span>
          <span style="opacity:0.7;">${remaining}</span>
        </label>`;
    })
    .join("");

  const DialogV2 = foundry.applications.api.DialogV2;
  const result = await DialogV2.wait({
    window: { title: "Choose a Reroll" },
    content: `<form><p>Select which reroll to spend:</p>${rows}</form>`,
    buttons: [
      {
        action: "confirm",
        label: "Reroll",
        default: true,
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? button.form;
          return root.querySelector('input[name="reroll-pick"]:checked')?.value;
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
    rejectClose: false,
  });

  if (result === null || result === "cancel" || result === undefined) return null;
  return eligible[Number(result)] ?? null;
}

/**
 * Restore every reroll the actor owns to ready (used = 0). Called on Long Rest.
 *
 * When the Calendaria integration is enabled, a pool under an active Lucky
 * crit-failure lockout (spent rerolling a natural Critical Failure — 7 days,
 * 5 with Untiring Luck) is skipped here: Lucky's crit-failure lockout
 * survives Long Rest by design, and only clears when the scheduled Calendaria
 * refresh fires. With the integration disabled, behavior is unchanged.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>} true when any feature was changed.
 */
export async function resetActorRerolls(actor) {
  if (!actor) return false;

  const locked = new Set();
  if (isCalendariaEnabled()) {
    const now = game.time.worldTime;
    for (const entry of getPendingCalendariaEntries(actor)) {
      if (entry.type === "rerollRefresh" && entry.lockout && entry.due > now) {
        locked.add(`${entry.itemId}:${entry.poolIndex}`);
      }
    }
  }

  const updates = [];
  for (const item of actor.items) {
    if (item.type !== "feature") continue;
    const reroll = item.system?.reroll ?? {};
    const update = { _id: item.id };
    let changed = false;

    const rawPools = poolsArray(reroll);
    if (rawPools.length) {
      const pools = rawPools.map((p) => ({ ...p }));
      pools.forEach((pool, i) => {
        if (locked.has(`${item.id}:${i}`)) return;
        if (Number(pool.used) > 0) {
          pool.used = 0;
          changed = true;
        }
        if (Number(pool.combatUsed) > 0) {
          pool.combatUsed = 0;
          changed = true;
        }
      });
      if (changed) update["system.reroll.pools"] = pools;
    }

    if (
      !locked.has(`${item.id}:-1`) &&
      Array.isArray(reroll.active) &&
      reroll.active.some(Boolean)
    ) {
      update["system.reroll.active"] = reroll.active.map(() => false);
      changed = true;
    }

    if (changed) updates.push(update);
  }

  if (!updates.length) return false;
  await actor.updateEmbeddedDocuments("Item", updates);
  return true;
}
