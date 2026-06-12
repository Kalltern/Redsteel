/**
 * Custom Conditions
 *
 * Lets users define their own status effects in-game without touching system
 * code. A "condition" Item created in the world Items directory acts as the
 * *definition* of a status effect:
 *
 *   - name / image  → token icon and display name
 *   - system.rounds / system.turns → duration (uses the existing
 *     flags.redsteel.rounds / actorTurns decrement machinery)
 *   - embedded Active Effects → the stat changes applied to the target
 *
 * Conditions are never copied onto actors as items. Instead they are resolved
 * into effect definitions (the same shape as CONFIG.REDSTEEL.effectDefinitions
 * entries) and applied through the regular `game.redsteel.applyEffect`
 * pipeline, so durations, status counters, "Remove All" and trait statuses all
 * work identically to built-in effects.
 *
 * Each world condition is also registered into CONFIG.statusEffects (v13
 * array / v14 dictionary both supported) so `Actor#toggleStatusEffect` works
 * and the condition shows up in the Token HUD.
 */

/* -------------------------------------------- */
/*  ID handling                                 */
/* -------------------------------------------- */

/**
 * Normalize a condition / effect name into a status id.
 * Uses "_" (never "-") so ids survive the `name.split("-")` parsing used by
 * the chat-card effect selection dialog.
 *
 * @param {string} name
 * @returns {string}
 */
export function slugifyConditionName(name) {
  return String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/* -------------------------------------------- */
/*  CONFIG.statusEffects shape helpers           */
/*  (array in v13, {[id]: config} dict in v14)   */
/* -------------------------------------------- */

function registerStatusEffectEntry(entry) {
  const cfg = CONFIG.statusEffects;
  if (Array.isArray(cfg)) {
    const idx = cfg.findIndex((e) => e.id === entry.id);
    if (idx >= 0) cfg[idx] = entry;
    else cfg.push(entry);
  } else {
    cfg[entry.id] = entry;
  }
}

function unregisterStatusEffectEntry(id) {
  const cfg = CONFIG.statusEffects;
  if (Array.isArray(cfg)) {
    const idx = cfg.findIndex((e) => e.id === id);
    if (idx >= 0) cfg.splice(idx, 1);
  } else {
    delete cfg[id];
  }
}

function hasStatusEffectEntry(id) {
  const cfg = CONFIG.statusEffects;
  if (Array.isArray(cfg)) return cfg.some((e) => e.id === id);
  return id in cfg;
}

/* -------------------------------------------- */
/*  Condition lookup                            */
/* -------------------------------------------- */

/**
 * All condition items defined in the world Items directory.
 * @returns {Item[]}
 */
export function getConditionItems() {
  return game.items?.filter((i) => i.type === "condition") ?? [];
}

/**
 * The status id a condition item registers under.
 * @param {Item} item
 * @returns {string}
 */
export function conditionStatusId(item) {
  return slugifyConditionName(item.name);
}

/**
 * Collect the Active Effect changes a condition item grants. All enabled
 * embedded Active Effects contribute their changes.
 *
 * @param {Item} item
 * @returns {object[]}
 */
function collectConditionChanges(item) {
  const changes = [];
  for (const effect of item.effects) {
    if (effect.disabled) continue;
    changes.push(...effect.toObject().changes);
  }
  return changes;
}

/**
 * Build the damage type expression a condition's per-round damage is
 * evaluated against (same token format as weapons / spells / abilities:
 * type strings joined by "and" / "or").
 *
 * @param {object} system  The condition item's system data
 * @returns {{expression: string[]}}
 */
function buildConditionDamageProfile(system) {
  const expression = [
    system.dmgType1,
    system.bool2,
    system.dmgType2,
    system.bool3,
    system.dmgType3,
    system.bool4,
    system.dmgType4,
  ]
    .filter(Boolean)
    .map((e) => e.toLowerCase());

  return { expression };
}

/**
 * Build an effect definition (same shape as a
 * CONFIG.REDSTEEL.effectDefinitions entry) from a condition item.
 *
 * @param {Item} item
 * @returns {object}
 */
export function buildConditionDefinition(item) {
  const id = conditionStatusId(item);
  const rounds = Number(item.system.rounds) || 0;
  const turns = Number(item.system.turns) || 0;
  const damage = String(item.system.damage ?? "").trim();

  const def = {
    name: item.name,
    img: item.img,
    statuses: [id],
    changes: collectConditionChanges(item),
    // Re-applying an existing condition refreshes its duration.
    stackBehavior: "refresh",
    isCustomCondition: true,
    conditionUuid: item.uuid,
  };

  if (rounds > 0) {
    def.defaultRounds = rounds;
    def.useDuration = true;
  }
  if (turns > 0) {
    def.defaultTurns = turns;
    def.useDuration = true;
  }

  // Per-round damage, mitigated by armor / resistances / vulnerabilities
  // (handled by the "conditionDamage" custom trigger in effects.mjs).
  if (damage) {
    def.triggers = {
      onRoundStart: {
        custom: "conditionDamage",
        damage,
        damageProfile: buildConditionDamageProfile(item.system),
      },
    };
  }

  return def;
}

/**
 * Resolve an effect id (or a free-typed effect name from a weapon / spell /
 * ability effects section) into a definition.
 *
 * Built-in CONFIG.REDSTEEL.effectDefinitions always win over conditions with
 * the same name. Returns the canonical status id alongside the definition so
 * callers can normalize (e.g. "Curse of Doom" → "curse_of_doom").
 *
 * @param {string} effectId
 * @returns {{id: string, def: object}|null}
 */
export function resolveEffectDefinition(effectId) {
  if (!effectId) return null;

  const builtIn = CONFIG.REDSTEEL.effectDefinitions[effectId];
  if (builtIn) return { id: effectId, def: builtIn };

  const slug = slugifyConditionName(effectId);
  if (!slug) return null;

  const builtInBySlug = CONFIG.REDSTEEL.effectDefinitions[slug];
  if (builtInBySlug) return { id: slug, def: builtInBySlug };

  const item = getConditionItems().find(
    (i) => conditionStatusId(i) === slug,
  );
  if (!item) return null;

  return { id: slug, def: buildConditionDefinition(item) };
}

/**
 * True when the actor is immune to the given effect/status
 * (system.effectMods.<id>.immune). The id is normalized the same way
 * applyEffect normalizes it, so display names match too
 * ("Bleeding" → "bleed"). The flag is usually granted by an Active Effect
 * change on `system.effectMods.<id>.immune`, so truthy string/number
 * values count as immune as well.
 */
export function isImmuneToEffect(actor, effectId) {
  if (!actor || !effectId) return false;

  const id =
    resolveEffectDefinition(effectId)?.id ??
    slugifyConditionName(effectId) ??
    effectId;

  const immune = actor.system?.effectMods?.[id]?.immune;
  return immune === true || immune === 1 || immune === "true" || immune === "1";
}

/* -------------------------------------------- */
/*  CONFIG.statusEffects synchronization        */
/* -------------------------------------------- */

/** Ids of custom condition entries currently registered by this client. */
const registeredConditionIds = new Set();

/**
 * Sync world condition items into CONFIG.statusEffects so
 * `Actor#toggleStatusEffect` accepts them and they appear in the Token HUD.
 * Runs on every client (hooks fire everywhere for world items).
 */
export function syncConditionStatusEffects() {
  // Remove entries from a previous sync (handles renamed / deleted items).
  for (const id of registeredConditionIds) {
    unregisterStatusEffectEntry(id);
  }
  registeredConditionIds.clear();

  for (const item of getConditionItems()) {
    const id = conditionStatusId(item);
    if (!id) continue;

    // Never shadow a built-in status effect.
    if (CONFIG.REDSTEEL.effectDefinitions[id]) {
      console.warn(
        `Redsteel | Condition "${item.name}" collides with built-in status effect "${id}" and was skipped.`,
      );
      continue;
    }
    if (registeredConditionIds.has(id)) {
      console.warn(
        `Redsteel | Duplicate condition name "${item.name}" — only the first is registered.`,
      );
      continue;
    }
    if (hasStatusEffectEntry(id)) continue;

    // Carry the redsteel flags in the status entry so an effect toggled via
    // the Token HUD behaves like one applied through applyEffect (duration
    // countdown, per-round damage trigger, status counter).
    const def = buildConditionDefinition(item);
    const redsteelFlags = { triggers: def.triggers ?? {} };
    if (def.defaultRounds > 0) redsteelFlags.rounds = def.defaultRounds;
    if (def.defaultTurns > 0) redsteelFlags.actorTurns = def.defaultTurns;

    registerStatusEffectEntry({
      id,
      name: item.name,
      img: item.img,
      changes: def.changes,
      hud: true,
      flags: {
        core: { statusId: id },
        redsteel: redsteelFlags,
      },
    });
    registeredConditionIds.add(id);
  }
}

/**
 * Register the hooks that keep CONFIG.statusEffects in sync with world
 * condition items. Call once from the system's init hook.
 */
export function registerCustomConditions() {
  Hooks.once("ready", syncConditionStatusEffects);

  const resyncIfCondition = (item) => {
    // Only world items (not embedded on actors, not compendium content).
    if (item.type !== "condition" || item.parent || item.pack) return;
    syncConditionStatusEffects();
  };

  Hooks.on("createItem", resyncIfCondition);
  Hooks.on("updateItem", resyncIfCondition);
  Hooks.on("deleteItem", resyncIfCondition);

  // Embedded Active Effects edited on a world condition item also change its
  // definition (the `changes` registered in CONFIG.statusEffects).
  const resyncIfConditionEffect = (effect) => {
    const item = effect.parent;
    if (!(item instanceof Item)) return;
    resyncIfCondition(item);
  };

  Hooks.on("createActiveEffect", resyncIfConditionEffect);
  Hooks.on("updateActiveEffect", resyncIfConditionEffect);
  Hooks.on("deleteActiveEffect", resyncIfConditionEffect);
}
