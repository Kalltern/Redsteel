/**
 * Materials (Materiály): a creatable Item type whose bonuses ride on a weapon,
 * armour piece or shield next to its quality and enchantments.
 *
 * Reference model: the host item stores the material's stable `key` in
 * `system.material` and a frozen snapshot of the whole material in
 * `flags.redsteel.material`. Combat maths only ever reads the snapshot, so a
 * deleted material or a disabled module never strips a sword of its bonuses.
 *
 * The snapshot is fed into the existing enchantment summing in
 * documents/item.mjs as one extra entry, so every combat read site that honours
 * `enchantMods` honours materials with no change of its own. The off-hand
 * column is folded into the derived `system.offhandTotals` block instead.
 *
 * This file must NOT import documents/item.mjs: item.mjs imports it, and the
 * helpers here are called during prepareData.
 */

/** The three columns a material can carry bonuses for, plus the off hand. */
const COLUMNS = ["weapon", "offhand", "armor", "shield"];

/** Signed "chance to be affected" keys on the armour column. */
const EFFECT_RESIST_KEYS = [
  "stagger",
  "stun",
  "bleed",
  "slow",
  "poison",
  "burn",
  "freeze",
];

const RESIST_KEYS = [
  "acid",
  "fire",
  "frost",
  "lightning",
  "magic",
  "dark",
  "poison",
  "holy",
];

/** Off-hand numbers that add straight onto offhandProperties. */
const OFFHAND_NUMERIC_KEYS = [
  "attack",
  "defense",
  "penetration",
  "critRange",
  "critDefense",
  "critDodge",
  "dodge",
];

/* -------------------------------------------------------------------------- */
/*  Snapshot                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The material snapshot stored on a weapon or gear item, or null.
 * Tolerates a null item so callers can chain it straight off a lookup
 * (`readMaterialSnapshot(heldShield(actor))`).
 * @param {Item|null} item
 * @returns {object|null}
 */
export function readMaterialSnapshot(item) {
  const raw = item?.flags?.redsteel?.material;
  return raw && typeof raw === "object" ? raw : null;
}

function clone(value) {
  return value && typeof value === "object"
    ? foundry.utils.deepClone(value)
    : {};
}

/**
 * Freeze a material Item into the snapshot shape items carry.
 * @param {Item} materialDoc
 * @returns {object}
 */
export function buildMaterialSnapshot(materialDoc) {
  const s = materialDoc?.system ?? {};
  const appliesTo = s.appliesTo ?? {};
  return {
    key: String(s.key ?? "").trim(),
    name: materialDoc?.localizedName ?? materialDoc?.name ?? "",
    img: materialDoc?.img ?? "",
    uuid: materialDoc?.uuid ?? "",
    category: s.category ?? "",
    appliesTo: {
      weapon: !!appliesTo.weapon,
      offhand: !!appliesTo.offhand,
      armor: !!appliesTo.armor,
      shield: !!appliesTo.shield,
    },
    effectType1: s.effectType1 ?? "",
    effectType2: s.effectType2 ?? "",
    effectType3: s.effectType3 ?? "",
    effectName1: s.effectName1 ?? "",
    effectName2: s.effectName2 ?? "",
    effectName3: s.effectName3 ?? "",
    weapon: clone(s.weapon),
    offhand: clone(s.offhand),
    armor: clone(s.armor),
    shield: clone(s.shield),
  };
}

/* -------------------------------------------------------------------------- */
/*  Entries for the enchantment summing                                       */
/* -------------------------------------------------------------------------- */

/**
 * The weapon column as an entry `weaponEnchantMods` can sum. The custom effect
 * names travel inside `effects`, because getEffectName (combatSkillBonuses.mjs)
 * reads them from the effects map.
 * @param {object|null} snap
 * @returns {object|null}
 */
export function materialWeaponEntry(snap) {
  if (!snap?.appliesTo?.weapon) return null;
  const { effects = {}, ...mods } = clone(snap.weapon);
  return {
    name: snap.name ?? "",
    mods,
    effects: {
      ...effects,
      effectName1: snap.effectName1 ?? "",
      effectName2: snap.effectName2 ?? "",
      effectName3: snap.effectName3 ?? "",
    },
    effectType1: snap.effectType1 ?? "",
    effectType2: snap.effectType2 ?? "",
    effectType3: snap.effectType3 ?? "",
  };
}

/**
 * The armour or shield column as an entry `gearEnchantMods` can sum. The
 * armour entry carries `effectResist` inside `mods`.
 * @param {object|null} snap
 * @param {boolean} isShield
 * @returns {object|null}
 */
export function materialGearEntry(snap, isShield) {
  const column = isShield ? "shield" : "armor";
  if (!snap?.appliesTo?.[column]) return null;
  const mods = clone(snap[column]);
  // Shield Bash effects are injected at the Shield Bash roll, never summed.
  delete mods.bashEffects;
  return { name: snap.name ?? "", mods };
}

/* -------------------------------------------------------------------------- */
/*  Off hand                                                                  */
/* -------------------------------------------------------------------------- */

function joinDice(a, b) {
  return [a, b]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" + ");
}

/**
 * `offhandProperties` plus the material's off-hand column, the block the
 * off-hand combat read sites use. The custom effect slots (extra1..3) are left
 * out on purpose: their names live on the material, so they are collected on
 * their own from `offhandMaterialExtras`. Doctrine flags pass through.
 * @param {object|undefined} offhandProperties
 * @param {object|null} snap
 * @returns {object|null}
 */
export function buildOffhandTotals(offhandProperties, snap) {
  const hasBase = offhandProperties && typeof offhandProperties === "object";
  if (!snap?.appliesTo?.offhand) {
    return hasBase ? foundry.utils.deepClone(offhandProperties) : null;
  }

  const out = hasBase ? foundry.utils.deepClone(offhandProperties) : {};
  const m = snap.offhand ?? {};

  for (const key of OFFHAND_NUMERIC_KEYS) {
    const add = Number(m[key]) || 0;
    if (add) out[key] = (Number(out[key]) || 0) + add;
  }

  const dice = joinDice(out.diceBonus, m.damageRoll);
  if (dice !== String(out.diceBonus ?? "").trim()) out.diceBonus = dice;
  const breakthrough = joinDice(out.breakthrough, m.breakthroughRoll);
  if (breakthrough !== String(out.breakthrough ?? "").trim()) {
    out.breakthrough = breakthrough;
  }

  for (const key of ["stagger", "bleed"]) {
    const add = Number(m.effects?.[key]) || 0;
    if (!add) continue;
    out.effects ??= {};
    out.effects[key] = (Number(out.effects[key]) || 0) + add;
  }

  return out;
}

/**
 * The off-hand column's custom effect slots, in the shape
 * collectExtrasFromSource reads (`effectTypeN` on top, chances and custom names
 * inside `effects`). Null unless the material applies to the off hand.
 * @param {object|null} snap
 * @returns {object|null}
 */
export function materialOffhandExtras(snap) {
  if (!snap?.appliesTo?.offhand) return null;
  const effects = snap.offhand?.effects ?? {};
  return {
    effectType1: snap.effectType1 ?? "",
    effectType2: snap.effectType2 ?? "",
    effectType3: snap.effectType3 ?? "",
    effects: {
      extra1: Number(effects.extra1) || 0,
      extra2: Number(effects.extra2) || 0,
      extra3: Number(effects.extra3) || 0,
      effectName1: snap.effectName1 ?? "",
      effectName2: snap.effectName2 ?? "",
      effectName3: snap.effectName3 ?? "",
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  Shield Bash                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The shield column's Shield Bash effects as synthetic modifiers, the same
 * shape the Warden's Shield Bash stagger bonus uses (combatSkillBonuses.mjs).
 * Empty when there is no shield, no material or the material skips shields.
 * @param {object|null} snap
 * @returns {object[]}
 */
export function materialBashModifiers(snap) {
  if (!snap?.appliesTo?.shield) return [];
  const bash = snap.shield?.bashEffects ?? {};
  const out = [];

  for (let n = 1; n <= 3; n++) {
    const value = Number(bash[`extra${n}`]) || 0;
    const type = snap[`effectType${n}`] ?? "";
    if (!value || !type) continue;
    out.push({
      system: {
        [`effectType${n}`]: type,
        effects: {
          [`extra${n}`]: value,
          [`effectName${n}`]: snap[`effectName${n}`] ?? "",
        },
      },
    });
  }

  for (const fixed of ["stagger", "bleed"]) {
    const value = Number(bash[fixed]) || 0;
    if (!value) continue;
    out.push({ system: { effectType1: fixed, effects: { extra1: value } } });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  Effect resistance                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The signed "chance to be affected" an actor's worn body gear adds for one
 * effect id (`stagger`, `slow` ...). Shields are not body gear and are skipped.
 * @param {Actor} actor
 * @param {string} name  Lowercase effect id.
 * @returns {number}
 */
export function getGearEffectResist(actor, name) {
  if (!actor?.items || !name) return 0;
  let total = 0;
  for (const item of actor.items.contents) {
    if (item.type !== "gear") continue;
    if (!item.system?.equipped) continue;
    if (item.system?.shield === true) continue;
    total += Number(item.system?.enchantMods?.effectResist?.[name]) || 0;
  }
  return total;
}

/* -------------------------------------------------------------------------- */
/*  Registry                                                                  */
/* -------------------------------------------------------------------------- */

/** Every known material entry, world first, never deduped. A Promise. */
let registryCache = null;

export function invalidateMaterialCache() {
  registryCache = null;
}

function registryEntry(doc) {
  const s = doc?.system ?? {};
  const key = String(s.key ?? "").trim();
  if (!key) return null;
  const appliesTo = s.appliesTo ?? {};
  return {
    key,
    name: doc.localizedName ?? doc.name ?? key,
    img: doc.img ?? "",
    uuid: doc.uuid ?? "",
    appliesTo: {
      weapon: !!appliesTo.weapon,
      offhand: !!appliesTo.offhand,
      armor: !!appliesTo.armor,
      shield: !!appliesTo.shield,
    },
    category: s.category ?? "",
  };
}

async function loadRegistry() {
  const out = [];
  for (const item of game.items?.contents ?? []) {
    if (item.type !== "material") continue;
    const entry = registryEntry(item);
    if (entry) out.push(entry);
  }
  for (const pack of game.packs?.contents ?? []) {
    if (pack.documentName !== "Item") continue;
    try {
      const docs = await pack.getDocuments({ type: "material" });
      for (const doc of docs) {
        const entry = registryEntry(doc);
        if (entry) out.push(entry);
      }
    } catch (err) {
      console.warn(`Redsteel | Materials: could not read ${pack.collection}`, err);
    }
  }
  return out;
}

function allMaterials() {
  if (!registryCache) {
    registryCache = loadRegistry().catch((err) => {
      registryCache = null;
      throw err;
    });
  }
  return registryCache;
}

/**
 * Every material the world knows, world Items first, then every Item
 * compendium of every enabled package. Deduped by key, the world copy wins.
 * @returns {Promise<{key: string, name: string, img: string, uuid: string,
 *   appliesTo: object, category: string}[]>}
 */
export async function getMaterialChoices() {
  const all = await allMaterials();
  const seen = new Set();
  const out = [];
  for (const entry of all) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(entry);
  }
  return out;
}

/**
 * The source material Item for a key, world first, then packs, or null.
 * @param {string} key
 * @returns {Promise<Item|null>}
 */
export async function findMaterialByKey(key) {
  const wanted = String(key ?? "").trim();
  if (!wanted) return null;
  const world = (game.items?.contents ?? []).find(
    (item) =>
      item.type === "material" &&
      String(item.system?.key ?? "").trim() === wanted,
  );
  if (world) return world;
  for (const pack of game.packs?.contents ?? []) {
    if (pack.documentName !== "Item") continue;
    try {
      const docs = await pack.getDocuments({ type: "material" });
      const hit = docs.find(
        (doc) => String(doc.system?.key ?? "").trim() === wanted,
      );
      if (hit) return hit;
    } catch (err) {
      console.warn(`Redsteel | Materials: could not read ${pack.collection}`, err);
    }
  }
  return null;
}

/**
 * Re-snapshot every weapon and gear item that points at this material: world
 * Items, every actor's items and every unlinked token actor's items. Only the
 * flag is written, never `system.material`. Items whose snapshot already
 * matches are skipped, so an unlinked token that inherits a refreshed base
 * actor is not written twice. GM only.
 * @param {Item} materialDoc
 */
export async function refreshMaterialCopies(materialDoc) {
  if (!game.user.isGM) return;
  const key = String(materialDoc?.system?.key ?? "").trim();
  if (!key) return;
  const snapshot = buildMaterialSnapshot(materialDoc);
  const json = JSON.stringify(snapshot);

  const updatesFor = (items) =>
    items
      .filter(
        (item) =>
          (item.type === "weapon" || item.type === "gear") &&
          item.system?.material === key &&
          JSON.stringify(readMaterialSnapshot(item)) !== json,
      )
      .map((item) => ({ _id: item.id, "flags.redsteel.material": snapshot }));

  try {
    const worldUpdates = updatesFor(game.items?.contents ?? []);
    if (worldUpdates.length) await Item.updateDocuments(worldUpdates);
  } catch (err) {
    console.error("Redsteel | Materials: world item refresh failed", err);
  }

  const refreshActor = async (actor) => {
    if (!actor?.items) return;
    try {
      const updates = updatesFor(actor.items.contents);
      if (updates.length) {
        await actor.updateEmbeddedDocuments("Item", updates);
      }
    } catch (err) {
      console.error(`Redsteel | Materials: refresh failed on ${actor.name}`, err);
    }
  };

  for (const actor of game.actors?.contents ?? []) await refreshActor(actor);

  for (const scene of game.scenes?.contents ?? []) {
    for (const token of scene.tokens?.contents ?? []) {
      if (token.actorLink || !token.actor) continue;
      await refreshActor(token.actor);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Sheet summary                                                             */
/* -------------------------------------------------------------------------- */

function signed(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : String(n);
}

function fieldLabel(field) {
  return game.i18n.localize(`REDSTEEL.Material.FIELDS.${field}.label`);
}

/**
 * Display name of an effect id: the material's own effect names first, then
 * the effect definition's name (localized when it is a key), then the hotbar's
 * effect names, then the id itself.
 */
export function materialEffectLabel(id) {
  const raw = String(id ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  const own = `REDSTEEL.Material.Effect.${lower}`;
  if (game.i18n.has(own)) return game.i18n.localize(own);
  const defName = CONFIG.REDSTEEL?.effectDefinitions?.[lower]?.name;
  if (defName) return game.i18n.localize(defName);
  const hotbar = `REDSTEEL.Bg3Hotbar.EffectMod.${lower}`;
  if (game.i18n.has(hotbar)) return game.i18n.localize(hotbar);
  const words = raw.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Display name of effect slot N: a custom name, or the chosen effect. */
export function materialSlotLabel(source, n) {
  const type = String(source?.[`effectType${n}`] ?? "").trim();
  if (!type) return "";
  if (type.toLowerCase() === "custom") {
    return String(source?.[`effectName${n}`] ?? "").trim();
  }
  return materialEffectLabel(type);
}

function effectParts(snap, effects) {
  const parts = [];
  for (const fixed of ["stagger", "bleed"]) {
    const value = Number(effects?.[fixed]) || 0;
    if (value) parts.push(`${materialEffectLabel(fixed)} ${value}%`);
  }
  for (let n = 1; n <= 3; n++) {
    const value = Number(effects?.[`extra${n}`]) || 0;
    const label = materialSlotLabel(snap, n);
    if (value && label) parts.push(`${label} ${value}%`);
  }
  return parts;
}

/**
 * A short localized summary of one column of a snapshot, such as
 * "Penetration +1, Slow 5%". Non-zero fields only; "" when the material does
 * not apply to the column or adds nothing there.
 * @param {object|null} snap
 * @param {"weapon"|"offhand"|"armor"|"shield"} column
 * @returns {string}
 */
export function describeMaterialColumn(snap, column) {
  if (!snap || !COLUMNS.includes(column)) return "";
  if (!snap.appliesTo?.[column]) return "";
  const c = snap[column] ?? {};
  const parts = [];

  const numbers = {
    weapon: [
      "attack",
      "defense",
      "damageBonus",
      "penetration",
      "critRange",
      "critChance",
      "critDefense",
      "critDamage",
      "dodge",
    ],
    offhand: [
      "attack",
      "defense",
      "penetration",
      "critRange",
      "critDefense",
      "critDodge",
      "dodge",
    ],
    armor: [
      "armorValue",
      "defense",
      "rangedDefense",
      "critDefense",
      "rangedCritDefense",
      "healthBonus",
    ],
    shield: ["defense", "rangedDefense", "critDefense", "rangedCritDefense"],
  }[column];

  for (const field of numbers) {
    const value = Number(c[field]) || 0;
    if (value) parts.push(`${fieldLabel(field)} ${signed(value)}`);
  }

  if (column === "weapon" || column === "offhand") {
    for (const field of ["damageRoll", "breakthroughRoll"]) {
      const dice = String(c[field] ?? "").trim();
      if (dice) parts.push(`${fieldLabel(field)} ${dice}`);
    }
  }

  if (column === "weapon") {
    const types = Array.isArray(c.damageTypes)
      ? c.damageTypes
      : Object.values(c.damageTypes ?? {});
    const list = types.map((t) => String(t ?? "").trim()).filter(Boolean);
    if (list.length) parts.push(`${fieldLabel("damageTypes")}: ${list.join("/")}`);
  }

  if (column === "weapon" || column === "offhand") {
    parts.push(...effectParts(snap, c.effects));
  }

  if (column === "armor") {
    for (const type of RESIST_KEYS) {
      const value = Number(c.resist?.[type]) || 0;
      if (value) {
        parts.push(
          `${game.i18n.localize(`REDSTEEL.Material.Resist.${type}`)} ${signed(value)}`,
        );
      }
    }
    const resists = [];
    for (const key of EFFECT_RESIST_KEYS) {
      const value = Number(c.effectResist?.[key]) || 0;
      if (value) resists.push(`${materialEffectLabel(key)} ${signed(value)}%`);
    }
    if (resists.length) {
      parts.push(`${fieldLabel("effectResist")}: ${resists.join(", ")}`);
    }
  }

  if (column === "shield") {
    const bash = effectParts(snap, c.bashEffects);
    if (bash.length) parts.push(`${fieldLabel("bashEffects")}: ${bash.join(", ")}`);
  }

  return parts.join(", ");
}

/* -------------------------------------------------------------------------- */
/*  Wiring                                                                    */
/* -------------------------------------------------------------------------- */

/** "Test Metal" -> "test-metal". Diacritics dropped, anything else dashed. */
function slugifyKey(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Warn (never block) when another known material already uses this key. */
async function warnDuplicateKey(item) {
  if (item.parent instanceof Actor) return;
  const key = String(item.system?.key ?? "").trim();
  if (!key) return;
  try {
    const all = await allMaterials();
    const other = all.find((entry) => entry.key === key && entry.uuid !== item.uuid);
    if (!other) return;
    ui.notifications.warn(
      game.i18n.format("REDSTEEL.Material.DuplicateKey", {
        key,
        other: other.name,
      }),
    );
  } catch (err) {
    console.warn("Redsteel | Materials: duplicate key check failed", err);
  }
}

export function registerMaterialHooks() {
  // A material created with no key gets one from its English name.
  Hooks.on("preCreateItem", (item) => {
    if (item.type !== "material") return;
    if (String(item.system?.key ?? "").trim()) return;
    const slug = slugifyKey(item.name);
    if (slug) item.updateSource({ "system.key": slug });
  });

  // These fire for compendium documents too, which is what keeps a pack
  // material's appearance or removal in step with the dropdown.
  Hooks.on("createItem", (item, _options, userId) => {
    if (item.type !== "material") return;
    invalidateMaterialCache();
    if (userId === game.user.id) warnDuplicateKey(item);
  });

  Hooks.on("updateItem", (item, changes, _options, userId) => {
    if (item.type !== "material") return;
    invalidateMaterialCache();
    if (
      userId === game.user.id &&
      foundry.utils.hasProperty(changes, "system.key")
    ) {
      warnDuplicateKey(item);
    }
    // Once per edit: only the active GM writes the copies.
    if (game.user.isGM && game.users.activeGM?.isSelf) {
      refreshMaterialCopies(item).catch((err) =>
        console.error("Redsteel | Materials: refresh failed", err),
      );
    }
  });

  Hooks.on("deleteItem", (item) => {
    if (item.type !== "material") return;
    invalidateMaterialCache();
  });
}
