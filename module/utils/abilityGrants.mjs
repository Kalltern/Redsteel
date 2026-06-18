/**
 * Data-driven ability grants.
 *
 * Owning a particular feature / trait / item — or having a skill at or above a
 * threshold — can grant one or more abilities to a Character or NPC. Granted
 * abilities are copied from a compendium, tagged so we own them, and removed
 * again automatically when the triggering item/skill goes away.
 *
 * To add a new grant, append an object to ABILITY_GRANTS below. Each rule has:
 *
 *   when:  the trigger. One of:
 *            { kind: "item", name: "Berserker" }            // owns an item with this name
 *            { kind: "item", uuid: "Compendium..." }        // owns an item from this source
 *            { kind: "item", uuid: "...", type: "feature" } // ...optionally constrained by type
 *            { kind: "skill", key: "athletics", min: 1 }    // skill value >= min (default 1)
 *            { kind: "doctrine", key: "swordsman", min: 1 } // doctrine value >= min (default 1)
 *          For an "item" trigger you must give `name` and/or `uuid`. `type` and
 *          `name` may be combined for extra safety against name collisions.
 *
 *   grant: array of ability compendium UUIDs to add while the trigger holds.
 *
 *   label: optional human-readable note (only used for console warnings).
 *
 * Ability UUIDs look like:
 *   "Compendium.redsteel.redsteel-items.Item.<itemId>"
 *
 * Manual overrides (e.g. for proof-of-concept characters):
 *   - Deleting an auto-granted ability by hand permanently opts that actor out
 *     of that grant (recorded in the `suppressedGrants` flag); it will not come
 *     back on the next reconcile. Use game.redsteel.clearGrantSuppression(actor)
 *     to undo this.
 *   - Set flags.redsteel.disableAbilityGrants = true on an actor to turn the
 *     whole system off for it (existing abilities are left exactly as they are):
 *       actor.setFlag("redsteel", "disableAbilityGrants", true)
 *
 * @type {Array<{label?: string, when: object, grant: string[]}>}
 */
export const ABILITY_GRANTS = [
  // --- Swordsman doctrine (cumulative: each level keeps the lower ones) -------
  {
    label: "Swordsman 1 → Extended Lunge",
    when: { kind: "doctrine", key: "swordsman", min: 1 },
    grant: ["Compendium.redsteel.redsteel-items.Item.menifXsjGJIzCUqt"],
  },
  {
    label: "Swordsman 2 → Cleave",
    when: { kind: "doctrine", key: "swordsman", min: 2 },
    grant: ["Compendium.redsteel.redsteel-items.Item.52NJ0ZhgGrHmrQ8z"],
  },
  {
    label: "Swordsman 4 → Half Pirouette",
    when: { kind: "doctrine", key: "swordsman", min: 4 },
    grant: ["Compendium.redsteel.redsteel-items.Item.fF5ZDZZ8r1XSGjmP"],
  },
  {
    label: "Swordsman 5 → Counterattack",
    when: { kind: "doctrine", key: "swordsman", min: 5 },
    grant: ["Compendium.redsteel.redsteel-items.Item.JltGA0Wsv6ttCUT6"],
  },
  {
    label: "Swordsman 6 → Flurry",
    when: { kind: "doctrine", key: "swordsman", min: 6 },
    grant: ["Compendium.redsteel.redsteel-items.Item.zosOTl8qIL3DISsr"],
  },
];

const GRANT_FLAG_SCOPE = "redsteel";
const GRANTED_FLAG = "grantedAbility"; // boolean: this item was auto-granted
const GRANT_SOURCE_FLAG = "grantSource"; // string: the compendium UUID it came from

// Actor-level flags:
//   suppressedGrants     string[]  grant UUIDs the player manually removed; never re-add
//   disableAbilityGrants boolean   skip the whole grant system for this actor (PoC chars)
const SUPPRESSED_FLAG = "suppressedGrants";
const DISABLE_FLAG = "disableAbilityGrants";

const GRANTABLE_ACTOR_TYPES = new Set(["character", "npc"]);

// Re-entrancy guard: syncing creates/deletes embedded items, which fire the very
// hooks that call this; skip overlapping runs for the same actor.
const _syncing = new Set();

/**
 * Does the actor currently satisfy a rule's trigger?
 * @param {Actor} actor
 * @param {object} rule
 * @returns {boolean}
 */
function ruleActive(actor, rule) {
  const w = rule?.when;
  if (!w) return false;

  if (w.kind === "skill") {
    const skill = actor.system?.skills?.[w.key];
    if (!skill) return false;
    return Number(skill.value ?? 0) >= Number(w.min ?? 1);
  }

  if (w.kind === "doctrine") {
    const doctrine = actor.system?.doctrines?.[w.key];
    if (!doctrine) return false;
    return Number(doctrine.value ?? 0) >= Number(w.min ?? 1);
  }

  if (w.kind === "item") {
    if (!w.uuid && !w.name) return false; // need at least one identifier
    return actor.items.some(
      (i) =>
        (w.uuid ? i._stats?.compendiumSource === w.uuid : true) &&
        (w.name ? i.name === w.name : true) &&
        (w.type ? i.type === w.type : true),
    );
  }

  return false;
}

/**
 * Reconcile an actor's auto-granted abilities against ABILITY_GRANTS.
 * Adds abilities whose trigger is now satisfied and removes previously-granted
 * abilities whose trigger no longer holds. Manually-added items are untouched.
 * @param {Actor} actor
 */
export async function syncGrantedAbilities(actor) {
  if (!actor?.id || !GRANTABLE_ACTOR_TYPES.has(actor.type)) return;
  if (_syncing.has(actor.id)) return;
  // Fully hand-curated actor: never touch its abilities.
  if (actor.getFlag(GRANT_FLAG_SCOPE, DISABLE_FLAG)) return;

  _syncing.add(actor.id);
  try {
    // Grants the player has manually opted out of — never re-add these.
    const suppressed = new Set(
      actor.getFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG) ?? [],
    );

    // Every ability UUID that should currently be granted.
    const desired = new Set();
    for (const rule of ABILITY_GRANTS) {
      if (ruleActive(actor, rule)) {
        for (const uuid of rule.grant ?? []) {
          if (!suppressed.has(uuid)) desired.add(uuid);
        }
      }
    }

    // Abilities we previously auto-granted, keyed by their source UUID.
    const granted = actor.items.filter((i) =>
      i.getFlag(GRANT_FLAG_SCOPE, GRANTED_FLAG),
    );
    const grantedByUuid = new Map(
      granted.map((i) => [i.getFlag(GRANT_FLAG_SCOPE, GRANT_SOURCE_FLAG), i]),
    );

    // Anything the actor already owns (manually, by default, or granted) so we
    // never create a duplicate of an ability that's already present.
    const ownedSources = new Set(
      actor.items.map((i) => i._stats?.compendiumSource).filter(Boolean),
    );

    // Remove granted abilities whose trigger is gone.
    const toDelete = granted
      .filter((i) => !desired.has(i.getFlag(GRANT_FLAG_SCOPE, GRANT_SOURCE_FLAG)))
      .map((i) => i.id);

    // Add newly-satisfied grants we don't already have.
    const toAdd = [];
    for (const uuid of desired) {
      if (grantedByUuid.has(uuid) || ownedSources.has(uuid)) continue;
      const source = await fromUuid(uuid);
      if (!source) {
        console.warn(`Redsteel | granted ability not found: ${uuid}`);
        continue;
      }
      const data = source.toObject();
      delete data._id;
      data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
      foundry.utils.setProperty(data, `flags.${GRANT_FLAG_SCOPE}.${GRANTED_FLAG}`, true);
      foundry.utils.setProperty(
        data,
        `flags.${GRANT_FLAG_SCOPE}.${GRANT_SOURCE_FLAG}`,
        uuid,
      );
      toAdd.push(data);
    }

    if (toDelete.length)
      await actor.deleteEmbeddedDocuments("Item", toDelete);
    if (toAdd.length) await actor.createEmbeddedDocuments("Item", toAdd);
  } finally {
    _syncing.delete(actor.id);
  }
}

/**
 * Clear an actor's manual opt-outs so qualifying grants apply again, then
 * reconcile. Pass a specific grant UUID to un-suppress just that one.
 * @param {Actor} actor
 * @param {string} [uuid] grant UUID to re-enable; omit to clear all opt-outs
 */
export async function clearGrantSuppression(actor, uuid) {
  if (!actor?.id) return;
  const current = actor.getFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG) ?? [];
  const next = uuid ? current.filter((u) => u !== uuid) : [];
  await actor.setFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG, next);
  await syncGrantedAbilities(actor);
}

/**
 * Register the hooks that keep granted abilities in sync. Call once at init/ready.
 */
export function registerAbilityGrants() {
  // New actor: evaluate all grants.
  Hooks.on("createActor", (actor, options, userId) => {
    if (game.user.id !== userId) return;
    syncGrantedAbilities(actor);
  });

  // Owning a new item may satisfy a trigger. Ignore our own granted abilities
  // (their creation during reconcile would otherwise loop).
  Hooks.on("createItem", (item, options, userId) => {
    if (game.user.id !== userId) return;
    if (item.getFlag?.(GRANT_FLAG_SCOPE, GRANTED_FLAG)) return;
    if (item.parent?.documentName === "Actor") syncGrantedAbilities(item.parent);
  });

  // Removing an item may break a trigger — reconcile. But if the removed item is
  // an auto-granted ability that the *player* deleted (not our own reconcile),
  // record it as suppressed so it is never re-granted.
  Hooks.on("deleteItem", async (item, options, userId) => {
    if (game.user.id !== userId) return;
    const parent = item.parent;
    if (parent?.documentName !== "Actor") return;

    if (item.getFlag?.(GRANT_FLAG_SCOPE, GRANTED_FLAG)) {
      // Our own reconcile removed it (trigger gone) — nothing to remember.
      if (_syncing.has(parent.id)) return;
      // Manual removal: opt this grant out permanently for this actor.
      const src = item.getFlag(GRANT_FLAG_SCOPE, GRANT_SOURCE_FLAG);
      if (src) {
        const current = parent.getFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG) ?? [];
        if (!current.includes(src)) {
          await parent.setFlag(GRANT_FLAG_SCOPE, SUPPRESSED_FLAG, [
            ...current,
            src,
          ]);
        }
      }
      return; // the manual removal stands
    }

    // A non-granted (trigger) item was removed.
    syncGrantedAbilities(parent);
  });

  // Skill / doctrine values changing can cross a threshold.
  Hooks.on("updateActor", (actor, changes, options, userId) => {
    if (game.user.id !== userId) return;
    if (changes.system?.skills || changes.system?.doctrines)
      syncGrantedAbilities(actor);
  });
}
