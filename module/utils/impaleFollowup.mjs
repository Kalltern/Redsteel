/**
 * Impale: Follow-up Attack (Nabodnutí: Navazující útok) — who gets it, when.
 *
 * Book: "If the target of Impale or under effect of Impale dies, may
 * immediately attack a target in range as a free action once per round." User
 * ruling 2026-09-24: it is the IMPALER's, whoever lands the killing blow — the
 * impaler killing the target with the Impale attack itself, or an ally killing
 * a target the impaler holds impaled.
 *
 * HOW THE IMPALER IS KNOWN
 * ------------------------
 * Impale applies the ordinary Rooted effect (see weapon-tags notes in
 * combatSkillBonuses.mjs "3b"). getEffectRolls marks the Root packet with
 * `impale: true` when the attack used Impale, and applyDamage stamps the
 * applied Root with `flags.redsteel.impaledBy` = the attacker's token id, read
 * off the attack card's speaker.
 *
 * THE GRANT
 * ---------
 * When a creature carrying such a Root is dead (the `dead` status arriving
 * after the Root, or the Root and its stamp arriving on an already dead
 * creature — Apply Damage can land either order), each impaler's actor gets
 * `flags.redsteel.impaleFollowup = {combat, round, at}`. Written by the active
 * GM only (every hook here fires on every client), so there is one writer and
 * it can write any actor.
 *
 * Round-stamped like the action tracker: a grant from an earlier round or
 * another combat reads as nothing, so there is no clean-up. "Once per round"
 * is read off the chat log: the grant is spent once this actor has posted a
 * Follow-up Attack card since `at`.
 */

const SYSTEM_ID = "redsteel";
const FLAG = "impaleFollowup";

/** The pack ability's localisation key, the same identity the attack card stores. */
export const IMPALE_FOLLOWUP_KEY = "REDSTEEL.Items.ImpaleFollowUpAttack.name";

/** Is this one of the Roots an Impale put on, and by whom? */
function impalerOf(effect) {
  if (!effect?.statuses?.has?.("root")) return null;
  return effect.getFlag?.(SYSTEM_ID, "impaledBy") ?? null;
}

/** The token document with this id on any scene, preferring the active one. */
function findTokenDoc(tokenId, preferScene = null) {
  if (!tokenId) return null;
  const scenes = [preferScene, canvas?.scene, ...game.scenes.contents].filter(Boolean);
  for (const scene of scenes) {
    const doc = scene.tokens?.get(tokenId);
    if (doc) return doc;
  }
  return null;
}

/**
 * Is the creature dead? Read off the effect collection, not the derived
 * `statuses` set: inside a createActiveEffect hook the set is not reliably
 * rebuilt yet (the deadTokens.mjs `isActorDead` reasoning), so the `dead`
 * status arriving last, which is the order Apply Damage lands it in, read as
 * alive and the grant was silently skipped.
 *
 * @param {Actor} actor
 */
function isDead(actor) {
  if (actor?.statuses?.has?.("dead")) return true;
  return actor?.effects?.some?.((e) => e.statuses?.has?.("dead")) === true;
}

/** Only the active GM writes, so there is one writer and it can write any actor. */
function isGrantWriter() {
  return game.user.isGM && game.users.activeGM?.id === game.user.id;
}

/**
 * Hand these impalers this round's follow-up. Once per round: an impaler
 * already granted this round is left alone.
 *
 * @param {Iterable<string>} tokenIds
 * @param {Actor} victim
 */
async function grantTo(tokenIds, victim) {
  const combat = game.combat;
  if (!combat?.started) return;
  const scene = victim?.token?.parent ?? null;
  for (const tokenId of tokenIds) {
    const impaler = findTokenDoc(tokenId, scene)?.actor;
    if (!impaler || impaler === victim) continue;
    const current = impaler.getFlag(SYSTEM_ID, FLAG);
    // Already granted this round: a second impaled victim dying does not
    // hand out a second attack ("once per round").
    if (current?.combat === combat.id && Number(current.round) === Number(combat.round)) {
      continue;
    }
    await impaler.setFlag(SYSTEM_ID, FLAG, {
      combat: combat.id,
      round: combat.round,
      at: Date.now(),
    });
  }
}

/**
 * Grant the follow-up to everyone holding this dead creature impaled.
 *
 * @param {Actor} victim
 * @param {object} [options]
 * @param {boolean} [options.dead] The caller already knows it is dead (the
 *   hook fired for the `dead` effect itself).
 */
async function grantFor(victim, { dead = false } = {}) {
  if (!isGrantWriter()) return;
  if (!dead && !isDead(victim)) return;

  const impalers = new Set();
  for (const effect of victim.effects ?? []) {
    const id = impalerOf(effect);
    if (id) impalers.add(id);
  }
  await grantTo(impalers, victim);
}

/**
 * The Impale attack itself was the killing blow. "The target of Impale dies"
 * does not need the Root to have landed: an immune target, an unticked Root
 * box or a Magic Shield leaves no stamped Root behind, and the impaler is
 * still owed the attack. Called by applyDamage once the target's zero-health
 * state is in.
 *
 * @param {Actor} victim
 * @param {object|null} rootPacket     The card's root entry (getEffectRolls).
 * @param {string|null} attackerTokenId From the attack card's speaker.
 */
export async function grantImpaleKill(victim, rootPacket, attackerTokenId) {
  if (!rootPacket?.impale || !attackerTokenId) return;
  if (!isGrantWriter() || !isDead(victim)) return;
  await grantTo([attackerTokenId], victim);
}

/**
 * The actor's follow-up for this round, if one was granted and not yet used.
 *
 * @param {Actor} actor
 * @returns {boolean}
 */
export function hasImpaleFollowup(actor) {
  const combat = game.combat;
  const grant = actor?.getFlag?.(SYSTEM_ID, FLAG);
  if (!grant || !combat?.started) return false;
  if (grant.combat !== combat.id || Number(grant.round) !== Number(combat.round)) {
    return false;
  }
  // Spent once this actor has posted a Follow-up Attack card since the grant.
  // Matched by token first: an unlinked NPC's speaker carries the base actor's
  // id, which every copy of that NPC shares.
  const tokenIds = new Set(
    actor.isToken
      ? [actor.token?.id]
      : actor.getActiveTokens(false, true).map((t) => t.id),
  );
  const messages = game.messages?.contents ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if ((message.timestamp ?? 0) < grant.at) break;
    if (message.flags?.redsteel?.abilityKey !== IMPALE_FOLLOWUP_KEY) continue;
    const speaker = message.speaker ?? {};
    if (speaker.token ? tokenIds.has(speaker.token) : speaker.actor === actor.id) {
      return false;
    }
  }
  return true;
}

/**
 * Stamp an Impale Root with its impaler. Called by applyDamage right after the
 * Root is applied, with the packet getEffectRolls built.
 *
 * @param {ActiveEffect|null} applied   The Root just applied.
 * @param {object} packet               The root entry of the effects packet.
 * @param {string|null} attackerTokenId From the attack card's speaker.
 */
export async function stampImpaleRoot(applied, packet, attackerTokenId) {
  if (!applied || !packet?.impale || !attackerTokenId) return;
  await applied.setFlag(SYSTEM_ID, "impaledBy", attackerTokenId);
}

export function registerImpaleFollowupHooks() {
  const effectActor = (effect) =>
    effect?.parent instanceof Actor ? effect.parent : null;

  // The victim dies while impaled.
  Hooks.on("createActiveEffect", (effect) => {
    const actor = effectActor(effect);
    if (!actor) return;
    if (effect.statuses?.has("dead")) grantFor(actor, { dead: true });
    else if (impalerOf(effect)) grantFor(actor);
  });

  // The stamp lands on a Root after the fact (setFlag is an update), on a
  // victim the same Apply Damage already killed.
  Hooks.on("updateActiveEffect", (effect, changed) => {
    const actor = effectActor(effect);
    if (!actor) return;
    if (changed?.flags?.[SYSTEM_ID]?.impaledBy === undefined) return;
    grantFor(actor);
  });
}
