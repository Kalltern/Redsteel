/**
 * Overwhelm (Přesila) — being pressed by several enemies at once.
 *
 * The rule: every *defense roll* against an attacker you have not yet defended
 * against this round widens the set of people pressing you. The penalty is
 * -5 per attacker beyond the first, so a 1v1 never produces one however many
 * blows are traded, a second attacker costs -5, a fifth costs the -20 cap.
 * Attacks you simply eat without defending contribute nothing: it is the act of
 * defending that splits your guard.
 *
 * Three things are deliberately true here.
 *
 * A. Attacker identity comes off the attack chat card, never from turn order.
 *    This system has ten reaction abilities plus reaction spells, so "whose
 *    turn is it" is wrong often enough to poison a defender's set for a whole
 *    round, and wrong in a way nothing can detect. The card knows who swung.
 *
 * B. The stored record carries the round it was written in, so a stale record
 *    reads as empty rather than as history. The reset hooks below are therefore
 *    housekeeping for the visible marker, not a correctness requirement: a
 *    missed hook, a reload mid-combat or a crashed session cannot leak stacks
 *    into the next round.
 *
 * C. Tracked only while an encounter is running. Out of combat there are no
 *    rounds to reset against, so nothing is recorded and the defense dialog
 *    falls back to a plain manual counter the GM can still dial in.
 *
 * Storage is a TokenDocument flag rather than an actor flag because four
 * unlinked goblins sharing one actor are four distinct attackers. The marker
 * ActiveEffect is pure derived display built from that flag, never a second
 * source of truth, and it carries no `changes`: the penalty is applied by the
 * defense roll formula, not by the effect.
 */

const FLAG_SCOPE = "redsteel";
const FLAG_KEY = "overwhelm";

/** Marker ActiveEffect tag, so the effect can be found again without name matching. */
const MARKER_FLAG = "overwhelmMarker";

/** -5 per attacker beyond the first, capped at five distinct attackers. */
export const OVERWHELM_MAX_STACKS = 4;
export const OVERWHELM_PENALTY_PER_STACK = -5;

const MARKER_IMG = "icons/skills/melee/shield-block-gray-yellow.webp";

/* -------------------------------------------- */
/*  ROUND CONTEXT                               */
/* -------------------------------------------- */

/**
 * The round Overwhelm is currently being tracked against, or null when there is
 * no running encounter. Everything else keys off this: null means "do not track
 * and do not display".
 */
export function currentOverwhelmRound() {
  const combat = game.combat;
  if (!combat?.started) return null;
  return Number(combat.round) || null;
}

/** Is Overwhelm being tracked at all right now? */
export function isOverwhelmTracked() {
  return currentOverwhelmRound() !== null;
}

/* -------------------------------------------- */
/*  READ                                        */
/* -------------------------------------------- */

/**
 * Attacker token ids this token has defended against in the current round.
 * Empty whenever tracking is off or the stored record belongs to an earlier
 * round, which is what makes the reset hooks non-load-bearing.
 * @param {TokenDocument|Token|null} token
 * @returns {string[]}
 */
export function getOverwhelmSources(token) {
  const doc = resolveTokenDocument(token);
  if (!doc) return [];

  const round = currentOverwhelmRound();
  if (round === null) return [];

  const record = doc.getFlag(FLAG_SCOPE, FLAG_KEY);
  if (!record || Number(record.round) !== round) return [];

  return Array.isArray(record.sources) ? [...record.sources] : [];
}

/** Stacks implied by a set of attackers: one per attacker past the first. */
export function stacksFromSources(sources = []) {
  return Math.max(0, Math.min(sources.length - 1, OVERWHELM_MAX_STACKS));
}

/** Current stack count for this token (0 when untracked or unpressed). */
export function getOverwhelmStacks(token) {
  return stacksFromSources(getOverwhelmSources(token));
}

/**
 * The recorded attackers as `{ id, name }`, for the chips in the defense dialog.
 * A token that has since been deleted still gets a row, so removing it is
 * possible rather than being stuck in the set as an unnamed id.
 */
export function describeOverwhelmSources(token) {
  return getOverwhelmSources(token).map((id) => ({
    id,
    name: overwhelmSourceName(id),
  }));
}

/* -------------------------------------------- */
/*  WRITE                                       */
/* -------------------------------------------- */

/**
 * Record that `token` has defended against `attackerTokenId` this round, and
 * return the stack count that defense should be rolled at.
 *
 * The attacker is added *before* the count is taken, which is the rule as
 * written: the very first defense against a second attacker is already at -5.
 * Re-defending against someone already in the set is a no-op, so a Flurry of
 * six blows costs the same as one, and a rerolled defense cannot double-count.
 *
 * @param {TokenDocument|Token|null} token          the defender
 * @param {string|null} attackerTokenId             attacker's token id
 * @returns {Promise<number>} stacks after recording
 */
export async function recordOverwhelmDefense(token, attackerTokenId) {
  const doc = resolveTokenDocument(token);
  const round = currentOverwhelmRound();

  if (!doc || round === null || !attackerTokenId) {
    return getOverwhelmStacks(token);
  }

  // Defending against yourself is not a thing; a bad attacker id must never
  // silently inflate the set.
  if (attackerTokenId === doc.id) return getOverwhelmStacks(token);

  const sources = getOverwhelmSources(doc);
  if (sources.includes(attackerTokenId)) return stacksFromSources(sources);

  const next = [...sources, attackerTokenId];
  await writeRecord(doc, round, next);
  return stacksFromSources(next);
}

/**
 * Drop one attacker from the record. This is the correction that matters: it
 * fixes the rest of the round, where overriding the number on the dialog only
 * fixes the roll in front of you.
 * @returns {Promise<number>} stacks after removal
 */
export async function forgetOverwhelmSource(token, attackerTokenId) {
  const doc = resolveTokenDocument(token);
  const round = currentOverwhelmRound();
  if (!doc || round === null) return 0;

  const sources = getOverwhelmSources(doc);
  const next = sources.filter((id) => id !== attackerTokenId);
  if (next.length === sources.length) return stacksFromSources(sources);

  await writeRecord(doc, round, next);
  return stacksFromSources(next);
}

/** Wipe one token's record and its marker. */
export async function clearOverwhelm(token) {
  const doc = resolveTokenDocument(token);
  if (!doc) return;

  if (doc.getFlag(FLAG_SCOPE, FLAG_KEY) !== undefined && canWrite(doc)) {
    await doc.unsetFlag(FLAG_SCOPE, FLAG_KEY);
  }
  await syncOverwhelmMarker(doc, 0);
}

/** Persist the record and bring the visible marker in line with it. */
async function writeRecord(doc, round, sources) {
  if (!canWrite(doc)) return;
  await doc.setFlag(FLAG_SCOPE, FLAG_KEY, { round, sources });
  await syncOverwhelmMarker(doc, stacksFromSources(sources));
}

/* -------------------------------------------- */
/*  VISIBLE MARKER                              */
/* -------------------------------------------- */

/**
 * Bring the token's marker effect in line with `stacks`.
 *
 * Nothing is shown at 0, which is the whole point: a 1v1 stays clean and the
 * icon appearing *is* the signal that a second enemy has committed. The effect
 * is built directly rather than through the effect-definition table because it
 * has no mechanics to inherit from it — no duration, no stacking rules, no
 * combat modifiers — and routing a display-only marker through the expiry
 * machinery would put it at the mercy of countdown bookkeeping it does not use.
 */
async function syncOverwhelmMarker(doc, stacks) {
  const actor = doc?.actor;
  if (!actor?.isOwner) return;

  const existing = actor.effects.find(
    (e) => e.getFlag(FLAG_SCOPE, MARKER_FLAG) === true,
  );

  if (stacks < 1) {
    if (existing) await existing.delete();
    return;
  }

  const label = game.i18n.format("REDSTEEL.Overwhelm.MarkerName", {
    penalty: stacks * OVERWHELM_PENALTY_PER_STACK,
  });

  if (existing) {
    if (
      existing.getFlag("statuscounter", "value") === stacks &&
      existing.name === label
    ) {
      return;
    }
    await existing.update({
      name: label,
      "flags.statuscounter.value": stacks,
      "flags.statuscounter.visible": true,
    });
    return;
  }

  await ActiveEffect.create(
    {
      name: label,
      img: MARKER_IMG,
      changes: [],
      flags: {
        [FLAG_SCOPE]: { [MARKER_FLAG]: true },
        statuscounter: { value: stacks, visible: true },
      },
    },
    { parent: actor },
  );
}

/* -------------------------------------------- */
/*  HELPERS                                     */
/* -------------------------------------------- */

/** Accepts a placeable Token or a TokenDocument and always yields the document. */
function resolveTokenDocument(token) {
  if (!token) return null;
  return token.document ?? token;
}

/** Can this client actually write to the token? Players own their own PCs. */
function canWrite(doc) {
  return !!(doc?.isOwner || game.user.isGM);
}

/** Best-effort display name for an attacker token id. */
export function overwhelmSourceName(id) {
  const fromScene = canvas.scene?.tokens?.get(id);
  if (fromScene) return fromScene.name;

  const combatant = game.combat?.combatants?.contents.find(
    (c) => c.tokenId === id,
  );
  if (combatant) return combatant.name;

  return game.i18n.localize("REDSTEEL.Overwhelm.UnknownAttacker");
}

/**
 * The defender's token for a defense that was launched without one (hotbar,
 * macro). Falls back the same way `selectToken` does so the two agree.
 */
export function resolveDefenderToken(actor, token = null) {
  const doc = resolveTokenDocument(token);
  if (doc) return doc;

  // An unlinked token's actor *is* that token's actor, so it names the token
  // outright. This is the case that matters: four goblins off one base actor
  // are four attackers, and `getActiveTokens()[0]` would answer with whichever
  // one the scene happens to list first.
  if (actor?.token) return actor.token;

  const controlled = canvas.tokens?.controlled?.[0];
  if (controlled && controlled.actor?.id === actor?.id) {
    return controlled.document;
  }

  return actor?.getActiveTokens?.()[0]?.document ?? null;
}

/* -------------------------------------------- */
/*  ATTACKER FROM A CHAT CARD                   */
/* -------------------------------------------- */

/**
 * The attacking token id carried by an attack card. Token first: four unlinked
 * goblins share one actor, so an actor id cannot tell them apart.
 *
 * The speaker only carries a token id when the card was posted with one, and an
 * actor on its own supplies one only when it *is* a token actor — true of every
 * unlinked NPC, false of every linked player character. So a PC attack card can
 * name its actor and nothing else, which is why the actor is worth a second look
 * rather than being treated as a dead end: it is resolved back to a token
 * through the scene the card was spoken on.
 *
 * That fallback is deliberately refused when the actor has more than one token
 * in that scene. Ambiguity here is exactly the four-goblins case above, and
 * picking whichever one the scene happens to list first would file the blow
 * under the wrong attacker — worse than admitting we do not know.
 */
export function attackerTokenIdFromMessage(message) {
  const speaker = message?.speaker;
  if (speaker?.token) return speaker.token;
  if (!speaker?.actor) return null;

  const scene = game.scenes?.get(speaker.scene) ?? game.scenes?.current ?? null;
  const actor = game.actors?.get(speaker.actor);
  if (!scene || !actor) return null;

  const tokens = scene.tokens.contents.filter((t) => t.actorId === actor.id);
  return tokens.length === 1 ? tokens[0].id : null;
}

/**
 * Fallback binding for a defense launched from the hotbar rather than from a
 * card: the newest attack card that this defender did not author.
 *
 * Weaker than the Defend button and knowingly so. A GM who rolls three NPC
 * attacks back to back before anyone defends will have them all attributed to
 * the last roller. That is what the removable chips in the dialog are for.
 */
export function inferAttackerTokenId(defenderTokenId) {
  const messages = game.messages?.contents ?? [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.flags?.attack?.type !== "attack") continue;

    const attackerId = attackerTokenIdFromMessage(message);
    if (!attackerId || attackerId === defenderTokenId) continue;

    return attackerId;
  }

  return null;
}

/* -------------------------------------------- */
/*  RESET                                       */
/* -------------------------------------------- */

/**
 * Sweep every combatant's record and marker. Active-GM only so it runs once
 * however many clients are connected, mirroring the Aim sweep.
 */
async function sweepOverwhelm() {
  if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;

  for (const combatant of game.combat?.combatants?.contents ?? []) {
    const doc = combatant.token;
    if (doc) await clearOverwhelm(doc);
  }
}

/**
 * Round rollover clears everyone. The stored round stamp already makes stale
 * records read as empty, so this exists to retire the *visible* markers: without
 * it a token would wear a -10 icon into a round where it no longer applies.
 */
export function registerOverwhelmHooks() {
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!("round" in changed)) return;
    await sweepOverwhelm();
  });

  // Combat over: nothing is tracked outside an encounter, so no marker may
  // survive it into the next scene.
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;
    for (const combatant of combat.combatants?.contents ?? []) {
      const doc = combatant.token;
      if (doc) await clearOverwhelm(doc);
    }
  });
}
