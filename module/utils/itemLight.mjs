/**
 * Item-driven token lighting.
 *
 * Gear and weapons may carry a `system.light` block (a Foundry LightData-shaped
 * object). While such an item is equipped, its light is fed into the owning
 * actor's token light. When several equipped items emit light at once, the
 * single strongest source wins (largest bright radius, then largest dim).
 */

/**
 * The "lights off" state — also the set of LightData fields this system
 * manages. Anything not listed here is left untouched on the token so manual
 * tweaks (e.g. luminosity overrides) outside our scope are preserved only when
 * no item drives the light. When an item drives the light, every key here is
 * written from the item.
 */
const MANAGED_DEFAULT = {
  dim: 0,
  bright: 0,
  angle: 360,
  color: null,
  alpha: 0.5,
  coloration: 1,
  attenuation: 0.5,
  luminosity: 0.5,
  negative: false,
  priority: 0,
  animation: { type: null, speed: 5, intensity: 5, reverse: false },
};

/**
 * Convert an item's stored `system.light` into a TokenDocument light update.
 * Empty strings for color / animation type become null so Foundry treats them
 * as "no color" / "no animation".
 * @param {object} light  The item's `system.light`
 * @returns {object}
 */
function itemLightToTokenLight(light) {
  return {
    dim: Number(light.dim) || 0,
    bright: Number(light.bright) || 0,
    angle: Number(light.angle ?? 360),
    color: light.color || null,
    alpha: Number(light.alpha ?? 0.5),
    coloration: Number(light.coloration ?? 1),
    attenuation: Number(light.attenuation ?? 0.5),
    luminosity: Number(light.luminosity ?? 0.5),
    negative: !!light.negative,
    priority: Number(light.priority) || 0,
    animation: {
      type: light.animation?.type || null,
      speed: Number(light.animation?.speed ?? 5),
      intensity: Number(light.animation?.intensity ?? 5),
      reverse: !!light.animation?.reverse,
    },
  };
}

/**
 * Item ids whose light is allowed to shine. This is stricter than the actor's
 * general "equipped" set: a weapon only counts while it sits in the *active*
 * weapon set (a sheathed weapon in the inactive set stays dark). Armor slots,
 * accessory slots, and anything explicitly flagged `system.equipped` (NPC
 * weapons/armor, shields, etc.), count as usual.
 * @param {Actor} actor
 * @returns {Set<string>}
 */
function getLightEligibleIds(actor) {
  const combat = actor.system.combat ?? {};
  const ids = new Set();

  // Characters: only the active weapon set emits light.
  const activeSet = combat.activeWeaponSet ?? 1;
  const set = combat.weaponSets?.[activeSet];
  if (set?.main) ids.add(set.main);
  if (set?.off) ids.add(set.off);

  for (const id of Object.values(combat.armorSlots ?? {})) {
    if (id) ids.add(id);
  }
  for (const id of Object.values(combat.accessorySlots ?? {})) {
    if (id) ids.add(id);
  }
  for (const i of actor.items) {
    if (i.system?.equipped) ids.add(i.id);
  }
  return ids;
}

/**
 * The equipped gear/weapon whose light should drive the token, or null.
 * Strongest wins: largest bright radius, breaking ties on dim radius.
 * @param {Actor} actor
 * @returns {Item|null}
 */
export function getActorLightItem(actor) {
  if (!actor) return null;
  const equipped = getLightEligibleIds(actor);

  let best = null;
  let bestBright = -1;
  let bestDim = -1;

  for (const item of actor.items) {
    if (item.type !== "gear" && item.type !== "weapon") continue;
    if (!equipped.has(item.id)) continue;

    const light = item.system?.light;
    if (!light) continue;

    const bright = Number(light.bright) || 0;
    const dim = Number(light.dim) || 0;
    if (bright <= 0 && dim <= 0) continue;

    if (bright > bestBright || (bright === bestBright && dim > bestDim)) {
      best = item;
      bestBright = bright;
      bestDim = dim;
    }
  }

  return best;
}

/**
 * The light object the actor's tokens should currently show. Falls back to the
 * "off" defaults when no equipped item emits light, so removing a light source
 * also clears its color / animation.
 * @param {Actor} actor
 * @returns {object}
 */
export function computeActorLight(actor) {
  const item = getActorLightItem(actor);
  if (!item) return foundry.utils.deepClone(MANAGED_DEFAULT);
  return itemLightToTokenLight(item.system.light);
}

/**
 * Build the update payload for a single token/prototype doc, or null if nothing
 * needs to change. A `redsteel.itemLight` flag records whether the system is
 * currently driving this doc's light, so that:
 *  - we never stomp a light the user configured manually (flag absent, no item),
 *  - and we still reset our own light back to defaults when the source is gone.
 * @param {TokenDocument|PrototypeToken} doc
 * @param {object} target   The desired managed light values
 * @param {boolean} driving Whether an equipped item is currently emitting light
 * @returns {object|null}
 */
function buildLightUpdate(doc, target, driving) {
  const wasDriving = !!doc.getFlag?.("redsteel", "itemLight");
  // The system has never touched this doc's light and still isn't — leave it be.
  if (!driving && !wasDriving) return null;

  const current = doc.light?.toObject?.() ?? {};
  const lightChanged = !foundry.utils.isEmpty(
    foundry.utils.diffObject(current, target),
  );
  const flagChanged = wasDriving !== driving;
  if (!lightChanged && !flagChanged) return null;

  return {
    light: target,
    flags: { redsteel: { itemLight: driving } },
  };
}

/**
 * Push the actor's computed item-light onto its tokens (and prototype token),
 * updating only when something actually changed to avoid redundant writes and
 * update loops.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {TokenDocument[]} [options.tokenDocs]  Restrict to these token docs
 *   (e.g. a freshly created token) instead of all active tokens.
 */
export async function applyActorLight(actor, { tokenDocs } = {}) {
  if (!actor) return;

  const item = getActorLightItem(actor);
  const driving = !!item;
  const target = driving
    ? itemLightToTokenLight(item.system.light)
    : foundry.utils.deepClone(MANAGED_DEFAULT);

  const docs = tokenDocs ?? actor.getActiveTokens(false, true);
  for (const tokenDoc of docs) {
    if (!tokenDoc?.canUserModify?.(game.user, "update")) continue;
    const update = buildLightUpdate(tokenDoc, target, driving);
    if (update) await tokenDoc.update(update);
  }

  // Keep the prototype token in sync so newly dropped tokens inherit the light.
  const proto = actor.prototypeToken;
  if (proto && actor.canUserModify?.(game.user, "update")) {
    const update = buildLightUpdate(proto, target, driving);
    if (update) await actor.update({ prototypeToken: update });
  }
}
