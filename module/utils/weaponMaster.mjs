/**
 * Mistr zbraní (Weapon Master) — shared reads for the tree's automated nodes.
 *
 * Every node that depends on what the character is wearing or wielding asks
 * here, so the "which armor counts" and "which weapon counts" rules live in one
 * place:
 *
 *   - Armor: only the TOPMOST equipped layer counts (Top, then Middle, then
 *     Bottom). Layers beneath it are ignored, and shields and accessories are
 *     never a layer. The class is the item's own `system.armorWeight`
 *     ("light" | "heavy"). No armor, or a top layer with no class set, means
 *     neither Armiger branch applies.
 *   - Weapon: the main hand of the ACTIVE weapon set, classed by the weapon's
 *     own `system.type` ("light" | "medium" | "heavy").
 */

/** Armor layers from the outside in. Keys of `system.combat.armorSlots`. */
const ARMOR_LAYERS_TOP_DOWN = ["top", "middle", "bottom"];

/** True when the character has unlocked this Weapon Master node. */
export function hasWeaponMasterNode(actor, nodeId) {
  const spec = actor?.system?.specialisations?.weaponMaster;
  return !!(spec?.active && spec.nodes?.[nodeId]);
}

/**
 * The item in the topmost equipped armor layer, or null when no layer holds a
 * live item.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function getTopArmorItem(actor) {
  const slots = actor?.system?.combat?.armorSlots ?? {};
  for (const layer of ARMOR_LAYERS_TOP_DOWN) {
    const id = slots[layer];
    if (!id) continue;
    const item = actor.items.get(id);
    if (item) return item;
  }
  return null;
}

/**
 * "light" | "heavy" for the topmost equipped armor layer, or null when nothing
 * is worn or the item carries no class.
 * @param {Actor} actor
 * @returns {"light"|"heavy"|null}
 */
export function getTopArmorWeight(actor) {
  const weight = getTopArmorItem(actor)?.system?.armorWeight;
  return weight === "light" || weight === "heavy" ? weight : null;
}

/**
 * The main-hand weapon of the active weapon set, or null.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function getActiveMainWeapon(actor) {
  if (actor?.type !== "character") return null;
  const activeSet = actor.system.combat?.activeWeaponSet;
  if (!activeSet) return null;
  const id = actor.system.combat.weaponSets?.[activeSet]?.main;
  const weapon = id ? actor.items.get(id) : null;
  return weapon?.type === "weapon" ? weapon : null;
}

/**
 * "light" | "medium" | "heavy" for the active main weapon, or null.
 * @param {Actor} actor
 * @returns {"light"|"medium"|"heavy"|null}
 */
export function getActiveMainWeaponWeight(actor) {
  const type = getActiveMainWeapon(actor)?.system?.type;
  return ["light", "medium", "heavy"].includes(type) ? type : null;
}

/**
 * Which Armiger branch applies right now: "light" | "heavy" | null.
 * @param {Actor} actor
 * @param {"zbrojnos1"|"zbrojnos2"} nodeId
 */
export function getArmigerBranch(actor, nodeId) {
  if (!hasWeaponMasterNode(actor, nodeId)) return null;
  return getTopArmorWeight(actor);
}

/**
 * Which Weapon Training bonus applies right now: "light" | "medium" | "heavy"
 * | null (node not unlocked, or no classed main weapon in the active set).
 * @param {Actor} actor
 */
export function getWeaponTrainingClass(actor) {
  if (!hasWeaponMasterNode(actor, "vycvikSeZbrani")) return null;
  return getActiveMainWeaponWeight(actor);
}

/* -------------------------------------------- */
/*  Rule constants                              */
/* -------------------------------------------- */

/** Armiger I, light: extra damage removed per durability point sacrificed. */
export const ARMIGER_LIGHT_SACRIFICE_BONUS = 5;
/** Armiger II, light: Dodge critical-success chance, in d100 points. */
export const ARMIGER_LIGHT_DODGE_CRIT = 3;
/** Armiger II, light: Stamina knocked off the Dodge action. */
export const ARMIGER_LIGHT_DODGE_COST = 1;
/** Armiger II, heavy: Deflect chance on Defense and Ranged Defense. */
export const ARMIGER_HEAVY_DEFLECT = 20;
/** Weapon Training, medium: Critical Hit and Critical Defense chance. */
export const WEAPON_TRAINING_MEDIUM_CRIT = 1;
/** Weapon Training, heavy: critical damage and critical penetration. */
export const WEAPON_TRAINING_HEAVY_CRIT = 5;
/** Damage +50% from Primary Attributes: multiplier on the attribute's share. */
export const PRIMARY_DAMAGE_MULTIPLIER = 1.5;
