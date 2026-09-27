/**
 * Initiative tie-break — no two combatants share a turn-order slot.
 *
 * When several combatants roll the same turn order, each of them makes a
 * secondary Speed Test. The winner takes the highest fraction of that slot and
 * the loser the lowest: three combatants tied at 10 become 10.3, 10.2 and 10.1,
 * and 10.1 acts last. A tie on the secondary test is rolled again between the
 * combatants still level, until every one of them is separated.
 *
 * The secondary results are stored on the combatant (`flags.redsteel.
 * initTiebreak = { base, scores }`), so a combatant joining an already-resolved
 * slot mid-round only rolls for itself and slots in among the others without
 * reshuffling them. The stash is valid only while the combatant still sits in
 * that slot (`Math.floor(initiative) === base`); RedsteelCombat.rollInitiative
 * clears it on every fresh roll.
 *
 * Group membership is deliberately narrow: an exact integer (a fresh roll that
 * has not been separated yet) or a valid stash for the slot. A combatant parked
 * at 9.95 by Delay Turn is not "tied at 9" and keeps its place.
 *
 * Combatant writes need GM authority. A player rolling their own initiative
 * hands the resolution to the active GM over the socket.
 */

import { buildSpeedTestFormula, tagSpeedTest } from "./speedTest.mjs";
import { collectRoundEntry } from "./roundDigest.mjs";

const SOCKET = "system.redsteel";
const SOCKET_TYPE = "resolveInitiativeTies";

/** Combatant flag holding the secondary results for the current slot. */
export const TIEBREAK_FLAG = "initTiebreak";

/** Safety net against a pathological run of identical rerolls. */
const MAX_REROLLS = 20;

/**
 * The stored secondary results, if they still belong to the slot the combatant
 * is sitting in.
 * @param {Combatant} combatant
 * @returns {number[]|null}
 */
function storedScores(combatant) {
  const stash = combatant.getFlag("redsteel", TIEBREAK_FLAG);
  if (!stash || !Array.isArray(stash.scores) || !stash.scores.length) return null;
  if (Math.floor(Number(combatant.initiative)) !== stash.base) return null;
  return stash.scores;
}

/**
 * Lexicographic comparison of two score lists, higher first. A shorter list
 * that matches the longer one's prefix counts as level, so the pair is rolled
 * again.
 * @returns {number} Negative when `a` ranks higher.
 */
function compareScores(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

/**
 * Roll one secondary Speed Test. A combatant on the floor sits at a flat 1
 * whatever their speed, so the tie among floored combatants is settled on the
 * real test instead of a flat 1 that would tie forever.
 * @param {Actor} actor
 * @returns {Promise<Roll>}
 */
async function rollSecondary(actor) {
  const roll = new Roll(
    buildSpeedTestFormula(actor, { ignoreFloor: true }),
    actor.getRollData(),
  );
  tagSpeedTest(roll);
  await roll.evaluate();
  return roll;
}

/**
 * Settle one tied slot.
 * @param {Combatant[]} members  Two or more combatants sharing the slot.
 * @param {number} base          The shared whole-number turn order.
 * @returns {Promise<{updates: object[], lines: object[]}>}
 */
async function resolveGroup(members, base) {
  const entries = members.map((combatant) => ({
    combatant,
    scores: [...(storedScores(combatant) ?? [])],
    rolls: [],
  }));

  // Everyone without a stash rolls once. After that only combatants still level
  // with somebody roll again, and only they get a new score appended.
  for (const entry of entries) {
    if (entry.scores.length) continue;
    const roll = await rollSecondary(entry.combatant.actor);
    entry.scores.push(roll.total);
    entry.rolls.push(roll);
  }

  for (let pass = 0; pass < MAX_REROLLS; pass++) {
    const level = entries.filter((a) =>
      entries.some((b) => a !== b && compareScores(a.scores, b.scores) === 0),
    );
    if (!level.length) break;
    for (const entry of level) {
      const roll = await rollSecondary(entry.combatant.actor);
      entry.scores.push(roll.total);
      entry.rolls.push(roll);
    }
  }

  // Anything still level after the cap falls back to a stable name order.
  entries.sort(
    (a, b) =>
      compareScores(a.scores, b.scores) ||
      a.combatant.name.localeCompare(b.combatant.name),
  );

  // Ten or more in one slot would run 10.1 … 11.0 into the next slot, so the
  // step shrinks to hundredths.
  const step = entries.length < 10 ? 0.1 : 0.01;
  const updates = [];
  const lines = [];

  entries.forEach((entry, index) => {
    const initiative =
      Math.round((base + (entries.length - index) * step) * 100) / 100;
    updates.push({
      _id: entry.combatant.id,
      initiative,
      [`flags.redsteel.${TIEBREAK_FLAG}`]: { base, scores: entry.scores },
    });
    lines.push({ combatant: entry.combatant, rolls: entry.rolls, initiative });
  });

  return { updates, lines };
}

/**
 * Find every tied slot in the combat and separate it. Only the slots touched by
 * `ids` are examined, so a single late roll never re-litigates the rest of the
 * tracker.
 * @param {Combat} combat
 * @param {string[]} ids  Combatants that just rolled.
 * @returns {Promise<void>}
 */
export async function resolveInitiativeTies(combat, ids) {
  if (!combat || !ids?.length) return;

  if (!game.user.isGM) {
    game.socket.emit(SOCKET, { type: SOCKET_TYPE, combatId: combat.id, ids });
    return;
  }

  const bases = new Set();
  for (const id of ids) {
    const value = combat.combatants.get(id)?.initiative;
    if (Number.isInteger(value)) bases.add(value);
  }
  if (!bases.size) return;

  const updates = [];
  const lines = [];

  for (const base of [...bases].sort((a, b) => b - a)) {
    const members = combat.combatants.contents.filter((c) => {
      if (!c.actor || c.initiative == null) return false;
      if (c.initiative === base) return true;
      return storedScores(c) != null && Math.floor(c.initiative) === base;
    });
    if (members.length < 2) continue;

    const result = await resolveGroup(members, base);
    updates.push(...result.updates);
    lines.push(...result.lines);
  }

  if (!updates.length) return;

  // Re-sorting inside a slot must not move the turn pointer off whoever is
  // acting right now.
  const currentId = combat.combatant?.id;
  await combat.updateEmbeddedDocuments("Combatant", updates);
  if (combat.started && currentId) {
    const turn = combat.turns.findIndex((t) => t.id === currentId);
    if (turn >= 0 && turn !== combat.turn) await combat.update({ turn });
  }

  await reportTies(lines);
}

/**
 * Put the secondary rolls on the round card when one is open, or post them as
 * their own message. Hidden combatants go to the GM only, so a tie-break never
 * announces an enemy the table has not seen.
 * @param {object[]} lines
 */
async function reportTies(lines) {
  const label = game.i18n.localize("REDSTEEL.RoundDigest.Tiebreak");
  const leftover = [];

  for (const line of lines) {
    const { combatant } = line;
    const actor = combatant.actor;
    const name = combatant.name || combatant.token?.name || actor.name;
    const img = combatant.img || combatant.token?.texture?.src || actor.img;

    // A combatant that kept its stash rolled nothing new; its slot still moves
    // on the card, so it gets a note-only line carrying the new value.
    const rolls = line.rolls.length ? line.rolls : [null];
    let collected = true;
    for (const roll of rolls) {
      collected &&= collectRoundEntry(actor, {
        kind: "tiebreak",
        label,
        roll,
        initiative: line.initiative,
        name,
        img,
        gm: !!combatant.hidden,
      });
    }
    if (!collected) leftover.push({ ...line, name });
  }

  if (!leftover.length) return;

  const render = (subset) =>
    subset
      .map((line) => {
        const scores = line.rolls.map((r) => r.total).join(" / ") || "—";
        return `<li>${game.i18n.format("REDSTEEL.RoundDigest.TiebreakLine", {
          name: line.name,
          scores,
          initiative: line.initiative,
        })}</li>`;
      })
      .join("");

  const speaker = {
    alias: game.i18n.localize("REDSTEEL.RoundDigest.Announcer"),
  };
  const messages = [];
  const publicLines = leftover.filter((l) => !l.combatant.hidden);
  const gmLines = leftover.filter((l) => l.combatant.hidden);

  for (const [subset, whisper] of [
    [publicLines, null],
    [gmLines, ChatMessage.getWhisperRecipients("GM").map((u) => u.id)],
  ]) {
    if (!subset.length) continue;
    const rolls = subset.flatMap((l) => l.rolls);
    const data = {
      speaker,
      content: `<p class="rs-card-headline"><b>${label}</b></p><ul>${render(subset)}</ul>`,
    };
    if (rolls.length) data.rolls = rolls;
    if (whisper) data.whisper = whisper;
    messages.push(data);
  }

  if (messages.length) await ChatMessage.implementation.create(messages);
}

/**
 * Active GM side of a player's roll. Registered once at ready.
 */
export function registerInitiativeTiebreakSocket() {
  game.socket.on(SOCKET, async (data) => {
    if (data?.type !== SOCKET_TYPE) return;
    if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;
    const combat = game.combats.get(data.combatId);
    if (!combat) return;
    await resolveInitiativeTies(combat, data.ids);
  });
}
