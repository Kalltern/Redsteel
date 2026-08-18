/**
 * Dead tokens fade out and drop behind the living.
 *
 * A corpse left at full opacity and full sort order is indistinguishable from a
 * combatant at a glance, and worse, it sits *on top* of whoever walks over it —
 * so the living token stepping onto the square disappears under the body and
 * can no longer be clicked. Both problems are pure presentation, so both are
 * fixed on the TokenDocument rather than anywhere near the damage pipeline:
 *
 *   alpha  → DEAD_ALPHA, so the corpse reads as scenery.
 *   sort   → DEAD_SORT, far below any hand-set value, so every living token
 *            renders (and picks up clicks) above it.
 *
 * `elevation` is deliberately left alone: it is a game-mechanical property
 * (flight, ledges, reach) and lowering it would change rules answers, not just
 * the picture.
 *
 * The previous values are stashed in a token flag before they are overwritten,
 * so a resurrection — or the GM simply un-ticking the skull — restores exactly
 * what the token had, including a deliberately faded or deliberately raised
 * token. Nothing here reads actor type: anything wearing the `dead` status gets
 * the treatment, which in practice means NPCs (characters go Dying + Downed at
 * 0 health, see applyZeroHealthState in applyDamage.mjs) plus whatever the GM
 * marks dead by hand.
 */

/** Opacity of a dead token. 1 = opaque, 0 = invisible. */
const DEAD_ALPHA = 0.5;

/**
 * Sort value pushing a corpse under everything else. Tokens default to 0 and
 * the field is only ever raised by hand, so a large negative constant is safely
 * out of the way without needing to scan the scene.
 */
const DEAD_SORT = -1000;

/** Token flag holding the pre-death alpha/sort, and the marker that we changed them. */
const PRE_DEATH_FLAG = "preDeathToken";

/**
 * Whether an effect is the one carrying the `dead` status. Read off `statuses`
 * rather than the id: the status effect is created with a hashed static id, so
 * `effect.id` is not "dead".
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
function isDeadEffect(effect) {
  return effect?.statuses?.has("dead") === true;
}

/**
 * Whether the actor is dead, read from the effect collection so a caller can
 * exclude an effect that is mid-deletion — at `deleteActiveEffect` time the
 * actor's derived `statuses` set has not necessarily been rebuilt yet (same
 * reason `isFloored` in floorInitiative.mjs does this).
 * @param {Actor}  actor
 * @param {object} [options]
 * @param {string} [options.ignoreId] Effect id to treat as already gone.
 * @returns {boolean}
 */
function isActorDead(actor, { ignoreId = null } = {}) {
  if (!actor) return false;
  return actor.effects.some((e) => e.id !== ignoreId && isDeadEffect(e));
}

/**
 * Every TokenDocument representing this actor on the active scene. Covers both
 * cases: for an unlinked NPC the effect's parent is the synthetic token actor
 * and this resolves back to its own token; for a linked actor it returns each
 * placed copy.
 * @param {Actor} actor
 * @returns {TokenDocument[]}
 */
function tokensFor(actor) {
  return actor?.getActiveTokens(false, true) ?? [];
}

/**
 * Fade a token and drop it behind the living. No-op if it is already flagged,
 * so repeat calls (a second damage application, a re-applied status) cannot
 * overwrite the stashed originals with the dead values.
 * @param {TokenDocument} token
 */
async function fadeToken(token) {
  if (!token) return;
  if (token.getFlag("redsteel", PRE_DEATH_FLAG)) return;

  await token.update({
    alpha: DEAD_ALPHA,
    sort: DEAD_SORT,
    [`flags.redsteel.${PRE_DEATH_FLAG}`]: {
      alpha: token.alpha,
      sort: token.sort,
    },
  });
}

/**
 * Restore a token that was faded by `fadeToken`. Tokens without the flag are
 * left untouched — a GM who hand-faded a living token and then killed and
 * revived it keeps their own setting.
 * @param {TokenDocument} token
 */
async function restoreToken(token) {
  const stashed = token?.getFlag("redsteel", PRE_DEATH_FLAG);
  if (!stashed) return;

  await token.update({
    alpha: stashed.alpha ?? 1,
    sort: stashed.sort ?? 0,
    [`flags.redsteel.-=${PRE_DEATH_FLAG}`]: null,
  });
}

/**
 * Bring every token of this actor in line with whether it is dead.
 * @param {Actor}   actor
 * @param {boolean} dead
 */
async function syncActorTokens(actor, dead) {
  for (const token of tokensFor(actor)) {
    if (dead) await fadeToken(token);
    else await restoreToken(token);
  }
}

/**
 * Fade and lower dead tokens, restore them when the status comes off.
 *
 * Token updates run on the active GM alone: every client sees the status
 * effect appear, and letting each of them fire the same update would mean N
 * redundant writes (and a permission error from any player who does not own the
 * token). Token *creation* is the exception — `preCreateToken` amends the data
 * in flight on whichever client is doing the dropping, which costs no update at
 * all and avoids a frame of the corpse at full opacity.
 */
export function registerDeadTokenAppearance() {
  const isActiveGM = () => game.users.activeGM?.id === game.user.id;

  Hooks.on("createActiveEffect", async (effect) => {
    if (!isDeadEffect(effect)) return;
    if (!(effect.parent instanceof Actor)) return;
    if (!isActiveGM()) return;
    await syncActorTokens(effect.parent, true);
  });

  Hooks.on("deleteActiveEffect", async (effect) => {
    if (!isDeadEffect(effect)) return;
    const actor = effect.parent;
    if (!(actor instanceof Actor)) return;
    if (!isActiveGM()) return;
    // A second source of `dead` may still be on the actor; only the last one
    // coming off brings the token back.
    if (isActorDead(actor, { ignoreId: effect.id })) return;
    await syncActorTokens(actor, false);
  });

  // Dropping an already-dead actor onto the scene should place a corpse, not a
  // combatant that fades a moment later.
  Hooks.on("preCreateToken", (token) => {
    if (!isActorDead(token.actor)) return;
    if (token.getFlag("redsteel", PRE_DEATH_FLAG)) return;
    token.updateSource({
      alpha: DEAD_ALPHA,
      sort: DEAD_SORT,
      [`flags.redsteel.${PRE_DEATH_FLAG}`]: {
        alpha: token.alpha,
        sort: token.sort,
      },
    });
  });
}
