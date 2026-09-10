/**
 * Sneak Attack allowance (Zákeřný útok) — one per victim, per round.
 *
 * The rule: you cannot Sneak Attack the same person twice in the same round.
 * You may attack them as often as you like; only the *sneak* is spent. And it
 * is spent per victim, not per attacker, so one blow that catches three people
 * can sneak all three, and two blows on one person can sneak only once.
 *
 * That makes the ledger target-side: each token records who has already sneaked
 * it this round. The mirror image of Overwhelm, which records who a defender has
 * already defended against — and this module is deliberately built to the same
 * shape, so the two read alike.
 *
 * Four things are true here, three of them for Overwhelm's reasons.
 *
 * A. Attacker identity comes off the attack chat card, never from turn order —
 *    reaction abilities and reaction spells make "whose turn is it" wrong often
 *    enough to poison a victim's set for a whole round. `attackerTokenIdFromMessage`
 *    (utils/overwhelm.mjs) is shared rather than reimplemented.
 *
 * B. The record carries the round it was written in, so a stale record reads as
 *    empty rather than as history. Nothing has to reset it for it to be correct.
 *
 * C. Tracked only while an encounter is running. Out of combat there are no
 *    rounds for "once per round" to mean anything, so nothing is recorded and
 *    nothing is refused — the GM rules it at the table, as they do today.
 *
 * D. **The allowance is spent where the blow lands, not where it is declared.**
 *    A missed Sneak Attack sneaked nobody, so the write happens in the Apply
 *    Damage loop (utils/applyDamage.mjs) once a target is actually being hit,
 *    not at roll time when the card is posted.
 *
 * Storage is a TokenDocument flag, not an actor flag, because four unlinked
 * goblins sharing one actor are four separate victims with four allowances.
 *
 * Unlike Overwhelm there is no marker ActiveEffect and no reset hook. Overwhelm
 * needs both only to retire its *visible* icon at round rollover; this ledger
 * shows nothing, and point B already makes a stale record harmless. The
 * asymmetry is deliberate — do not "restore" the missing hooks.
 */

import { attackerTokenIdFromMessage } from "./overwhelm.mjs";

const FLAG_SCOPE = "redsteel";
const FLAG_KEY = "sneakLedger";

/* -------------------------------------------- */
/*  ROUND CONTEXT                               */
/* -------------------------------------------- */

/**
 * The round the allowance is currently being tracked against, or null when no
 * encounter is running. Null means "do not track and do not refuse".
 */
export function currentSneakRound() {
  const combat = game.combat;
  if (!combat?.started) return null;
  return Number(combat.round) || null;
}

/** Is the allowance being enforced at all right now? */
export function isSneakLedgerTracked() {
  return currentSneakRound() !== null;
}

/* -------------------------------------------- */
/*  READ                                        */
/* -------------------------------------------- */

function resolveTokenDocument(token) {
  if (!token) return null;
  return token.document ?? token;
}

/** Can this client actually write to the token? The GM apply path always can. */
function canWrite(doc) {
  return !!(doc?.isOwner || game.user.isGM);
}

/**
 * Attacker token ids that have already sneaked this token in the current round.
 * Empty whenever tracking is off or the record belongs to an earlier round,
 * which is what makes this correct without any reset.
 * @param {TokenDocument|Token|null} token the victim
 * @returns {string[]}
 */
export function getSneakSources(token) {
  const doc = resolveTokenDocument(token);
  if (!doc) return [];

  const round = currentSneakRound();
  if (round === null) return [];

  const record = doc.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!record || Number(record.round) !== round) return [];

  return Array.isArray(record.sources) ? [...record.sources] : [];
}

/**
 * Has this attacker already spent their Sneak Attack on this victim this round?
 *
 * False out of combat and false when the attacker cannot be identified: both are
 * "we do not know", and the caller's fallback for not knowing must be to allow
 * the sneak, never to swallow one the player is owed.
 *
 * @param {TokenDocument|Token|null} token the victim
 * @param {string|null} attackerTokenId
 */
export function hasSneakedThisRound(token, attackerTokenId) {
  if (!attackerTokenId) return false;
  return getSneakSources(token).includes(attackerTokenId);
}

/**
 * The recorded attackers as `{ id, name }`. Debug-only for now — the ledger has
 * no UI — so an unresolvable token falls back to its raw id rather than needing
 * a localised "unknown" string.
 */
export function describeSneakSources(token) {
  return getSneakSources(token).map((id) => ({
    id,
    name:
      canvas.scene?.tokens?.get(id)?.name ??
      game.combat?.combatants?.contents.find((c) => c.tokenId === id)?.name ??
      id,
  }));
}

/* -------------------------------------------- */
/*  WRITE                                       */
/* -------------------------------------------- */

/**
 * Record that `attackerTokenId` has Sneak Attacked this victim this round.
 *
 * Re-recording the same attacker is a no-op, so re-opening Apply Damage on the
 * same card, or applying it to a target twice, cannot corrupt the set.
 *
 * @param {TokenDocument|Token|null} token the victim
 * @param {string|null} attackerTokenId
 * @returns {Promise<boolean>} true when this call is what spent the allowance
 */
export async function recordSneakAttack(token, attackerTokenId) {
  const doc = resolveTokenDocument(token);
  const round = currentSneakRound();

  if (!doc || round === null || !attackerTokenId) return false;
  // Sneaking yourself is not a thing; a bad attacker id must never enter the set.
  if (attackerTokenId === doc.id) return false;
  if (!canWrite(doc)) return false;

  const sources = getSneakSources(doc);
  if (sources.includes(attackerTokenId)) return false;

  await doc.setFlag(FLAG_SCOPE, FLAG_KEY, {
    round,
    sources: [...sources, attackerTokenId],
  });
  return true;
}

/**
 * Give one attacker their allowance back against this victim. The correction
 * that matters: it fixes the rest of the round, not just the blow in front of
 * you. Exposed for the GM console, and for whatever undo the dialog grows later.
 */
export async function forgetSneakSource(token, attackerTokenId) {
  const doc = resolveTokenDocument(token);
  const round = currentSneakRound();
  if (!doc || round === null || !canWrite(doc)) return;

  const sources = getSneakSources(doc);
  const next = sources.filter((id) => id !== attackerTokenId);
  if (next.length === sources.length) return;

  await doc.setFlag(FLAG_SCOPE, FLAG_KEY, { round, sources: next });
}

/** Wipe one victim's record outright. */
export async function clearSneakLedger(token) {
  const doc = resolveTokenDocument(token);
  if (!doc || !canWrite(doc)) return;
  if (doc.getFlag(FLAG_SCOPE, FLAG_KEY) === undefined) return;
  await doc.unsetFlag(FLAG_SCOPE, FLAG_KEY);
}

/* -------------------------------------------- */
/*  CARD BINDING                                */
/* -------------------------------------------- */

/**
 * Was this attack card a declared Sneak Attack? Read from the card rather than
 * from the actor, because the declaration flag is long consumed by the time
 * Apply Damage runs — and because the GM applying the damage may not be the
 * player who declared it.
 */
export function cardDeclaredSneak(message) {
  return message?.flags?.attack?.sneak?.declared === true;
}

/** The attacker token behind an attack card. Shared with Overwhelm. */
export function sneakAttackerTokenId(message) {
  return attackerTokenIdFromMessage(message);
}
