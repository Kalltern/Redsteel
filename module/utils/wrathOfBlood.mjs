/**
 * Hněv krve (Wrath of Blood) — School of Blood, Expert node.
 *
 * "Získává Sílu kouzla +1 do Školy Krve a kapacitu Zásoby krve +10 za druhé,
 * třetí a čtvrté Krvácení." The caster's own wounds feed their magic: the
 * SECOND, THIRD and FOURTH stack of Bleeding each grant +1 Blood Spell Power
 * and +10 Blood Pool capacity. The first stack pays nothing and stacks five and
 * six add nothing more, so the whole reward curve is:
 *
 *   0-1 Bleeding → +0 SP / +0 pool
 *     2 Bleeding → +1 SP / +10 pool
 *     3 Bleeding → +2 SP / +20 pool
 *    4+ Bleeding → +3 SP / +30 pool   (the cap; Bleeding itself caps at 6)
 *
 * The bonus is a *state*, not an event: it follows the current stack count in
 * both directions, so a bleed ticking away or being stopped takes the Spell
 * Power back with it. That is why it is carried by one owned ActiveEffect
 * rewritten in place (the system's hard rule — stat buffs are effect documents,
 * never prepareDerivedData mutations) rather than by a one-shot bonus written
 * at cast time. It lands on `system.schools.blood.bonus` and
 * `system.stats.bloodPool.bonus`, the same two fields the tree's own passives
 * use, so both the mage and the non-mage Blood Spell Power formulas in
 * documents/actor.mjs pick it up for free, and the pool's current value is
 * clamped to the new capacity there as well when the bonus shrinks.
 *
 * The marker flag stores the tier currently baked into the effect, so a sync
 * that changes nothing costs no document write and cannot loop against its own
 * createActiveEffect / updateActiveEffect hooks.
 */

/** Effect flag holding the tier (0-3) currently granted. Also the marker tag. */
const MARKER_FLAG = "wrathOfBlood";

/** Localization key of the node label, used to name the effect. */
const NODE_LABEL = "REDSTEEL.Actor.Specialisations.bloodSchool.nodes.hnevKrve.label";

/** Bleeding stacks that pay: the 2nd, 3rd and 4th. */
const FIRST_PAYING_STACK = 2;
const MAX_TIER = 3;

/** Blood Pool capacity granted per tier. */
const POOL_PER_TIER = 10;

/**
 * Whether an effect is Bleeding. Reads both the modern `statuses` set and the
 * legacy `core.statusId` flag, so effects made by the system and ones toggled
 * from the core Token HUD both count.
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function isBleedEffect(effect) {
  if (!effect) return false;
  return effect.statuses?.has("bleed") || effect.getFlag?.("core", "statusId") === "bleed";
}

/**
 * The actor's current Bleeding stacks.
 *
 * Summed across every Bleeding effect rather than read off the first one:
 * applyEffect merges into a single stacking effect, but a status toggled from
 * the Token HUD arrives as its own document with no `stacks` flag (counted as
 * one). `ignoreId` exists for `deleteActiveEffect` time, where the effect being
 * removed is still in the collection.
 *
 * @param {Actor}  actor
 * @param {object} [options]
 * @param {string} [options.ignoreId]  Effect id to treat as already gone.
 * @returns {number}
 */
export function getBleedStacks(actor, { ignoreId = null } = {}) {
  if (!actor) return 0;
  let total = 0;
  for (const effect of actor.effects.contents) {
    if (effect.id === ignoreId) continue;
    if (!isBleedEffect(effect)) continue;
    total += Number(effect.getFlag("redsteel", "stacks") ?? 1) || 1;
  }
  return total;
}

/**
 * Tier earned by a stack count: 0 for the first stack, then one per stack up to
 * the fourth.
 * @param {number} stacks
 * @returns {number} 0-3
 */
export function wrathTier(stacks) {
  const n = Number(stacks) || 0;
  return Math.min(Math.max(n - (FIRST_PAYING_STACK - 1), 0), MAX_TIER);
}

/** Whether the actor has the node unlocked. */
function hasWrathNode(actor) {
  const spec = actor?.system?.specialisations?.bloodSchool;
  return !!spec?.active && !!spec?.nodes?.hnevKrve;
}

/**
 * Bring the Wrath of Blood effect in line with the actor's current Bleeding.
 * Idempotent — safe to call from every path that can move a bleed.
 *
 * Effect writes on someone else's actor need GM authority, so non-GM clients
 * no-op and the authoritative GM's own call does the work for everyone.
 *
 * @param {Actor}  actor
 * @param {object} [options]
 * @param {string} [options.ignoreId]  Effect id to treat as already gone.
 * @returns {Promise<void>}
 */
export async function syncWrathOfBlood(actor, { ignoreId = null } = {}) {
  if (!actor) return;
  if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;

  const existing = actor.effects.find(
    (e) => e.id !== ignoreId && e.getFlag("redsteel", MARKER_FLAG) != null,
  );
  const current = existing ? Number(existing.getFlag("redsteel", MARKER_FLAG)) || 0 : 0;
  const tier = hasWrathNode(actor)
    ? wrathTier(getBleedStacks(actor, { ignoreId }))
    : 0;

  // Nothing to write when the effect already says exactly this. The second
  // clause is the cleanup case: a stale marker sitting at tier 0 must still be
  // removed even though the numbers agree.
  if (tier === current && !!existing === (tier > 0)) return;

  if (!tier) {
    if (existing) {
      await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
      ui.notifications.info(`${actor.name}: Wrath of Blood fades.`);
    }
    return;
  }

  const label = game.i18n.localize(NODE_LABEL);
  const changes = [
    {
      key: "system.schools.blood.bonus",
      mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
      value: tier,
    },
    {
      key: "system.stats.bloodPool.bonus",
      mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
      value: tier * POOL_PER_TIER,
    },
  ];
  const name = `${label} +${tier}`;

  if (existing) {
    await existing.update({
      name,
      changes,
      disabled: false,
      [`flags.redsteel.${MARKER_FLAG}`]: tier,
    });
  } else {
    await actor.createEmbeddedDocuments("ActiveEffect", [
      {
        name,
        img: "icons/skills/wounds/blood-drip-droplet-red.webp",
        changes,
        disabled: false,
        transfer: false,
        flags: {
          redsteel: { [MARKER_FLAG]: tier },
          statuscounter: { visible: false },
        },
      },
    ]);
  }

  ui.notifications.info(
    `${actor.name}: Wrath of Blood — Blood Spell Power +${tier}, Blood Pool capacity +${tier * POOL_PER_TIER}.`,
  );
}

/**
 * Watch every path that can move a Bleeding stack, plus the one that can move
 * the node itself.
 *
 * Bleeding changes reach the effect document three ways — created, stacks
 * updated (apply, round-tick decrement, the sheet's counter, first aid), and
 * deleted — and all three are covered here rather than at the call sites, so a
 * status toggled straight from the Token HUD counts exactly like an automated
 * one. The actor hook catches the node being bought or refunded while the
 * character is already bleeding.
 */
export function registerWrathOfBlood() {
  Hooks.on("createActiveEffect", async (effect) => {
    if (!isBleedEffect(effect)) return;
    if (!(effect.parent instanceof Actor)) return;
    await syncWrathOfBlood(effect.parent);
  });

  Hooks.on("updateActiveEffect", async (effect) => {
    if (!isBleedEffect(effect)) return;
    if (!(effect.parent instanceof Actor)) return;
    await syncWrathOfBlood(effect.parent);
  });

  Hooks.on("deleteActiveEffect", async (effect) => {
    if (!isBleedEffect(effect)) return;
    if (!(effect.parent instanceof Actor)) return;
    // At delete time the actor's effect collection may still hold this one, so
    // tell the count to treat it as already gone.
    await syncWrathOfBlood(effect.parent, { ignoreId: effect.id });
  });

  Hooks.on("updateActor", async (actor, changed) => {
    if (!foundry.utils.hasProperty(changed, "system.specialisations")) return;
    await syncWrathOfBlood(actor);
  });
}
