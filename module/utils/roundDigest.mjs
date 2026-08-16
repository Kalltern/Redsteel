/**
 * Round digest — one Announcer card per round instead of twenty.
 *
 * A round rollover fires a burst of independent chat messages: an initiative
 * roll for every combatant, then a damage/healing roll for every DoT tick on
 * every actor, then the GM's Dying countdowns. With a dozen tokens on the map
 * that is thirty messages the table has to scroll past to find anything.
 *
 * This module is a buffer. `openRoundDigest()` is called at the top of the
 * rollover; while it is open, every call site that would have posted its own
 * message calls `postRoundEntry()` instead and the roll is collected. When the
 * burst goes quiet the buffer flushes as one collapsed card for the table.
 *
 * Entries marked `gm` (a hidden combatant's turn order, a Dying countdown) ride
 * along in that same card inside `.rd-gm-only` blocks which the render hook
 * deletes on non-GM clients. That is presentation, not secrecy: one chat
 * message means one `content` string, and it reaches every client. Anything
 * that genuinely must not leak needs its own whispered message instead.
 *
 * Two invariants make this safe to bolt onto existing call sites:
 *
 *  1. `postRoundEntry()` falls back to the exact message the call site used to
 *     post whenever no digest is open. Every one of those handlers also runs
 *     outside a round rollover (on apply, on turn start, from a macro), and
 *     those paths must look and behave exactly as they did before.
 *
 *  2. Flushing is driven by a debounce plus a hard watchdog, never by a single
 *     "we are done now" call. Round processing is a long await-chain spread
 *     across two different entry points (the nextRound wrapper rolls
 *     initiative, the updateCombat hook ticks effects) whose ordering depends
 *     on a world setting, and any of it can throw. A buffer that only flushed
 *     on an explicit signal would eat the round's rolls the first time an
 *     effect handler raised. This one always posts.
 *
 * Rolls ride on the card as a real `rolls` array, so dice tooltips and Dice So
 * Nice keep working. Core renders those roll boxes after our content; the
 * render hook at the bottom moves each one into its line inside the card.
 */

/** Quiet period after the last entry before the card posts. */
const DEBOUNCE_MS = 1500;

/** Shorter quiet period once round processing reports itself finished. */
const FINISH_MS = 250;

/** Hard ceiling: the card posts this long after opening no matter what. */
const WATCHDOG_MS = 15000;

/**
 * The open buffer, or null when closed.
 * @type {{round: number|null, entries: object[], timer: number|null,
 *         watchdog: number|null, flushing: boolean}|null}
 */
let digest = null;

/**
 * Live while the card is being written to chat. `digest` is already null by
 * then, so this is what tells "no card coming" apart from "card in flight".
 * @type {Promise|null}
 */
let flushInFlight = null;

/**
 * Work parked until the round card has landed.
 * @type {Function[]}
 */
let afterFlush = [];

/* -------------------------------------------- */
/*  Buffer lifecycle                            */
/* -------------------------------------------- */

export function isRoundDigestOpen() {
  return !!digest && !digest.flushing;
}

/**
 * Open the buffer for a round. Idempotent: the second caller in a rollover
 * (initiative rolls first, then the effect ticks — or the other way round when
 * dynamic initiative is off) just refreshes the round number.
 * @param {number|null} round
 * @returns {boolean} True if this call opened it.
 */
export function openRoundDigest(round = null) {
  if (digest) {
    if (round != null) digest.round = round;
    return false;
  }

  digest = {
    round,
    entries: [],
    timer: null,
    watchdog: null,
    flushing: false,
  };

  digest.watchdog = setTimeout(() => {
    console.warn("Redsteel | Round digest watchdog fired — posting early.");
    flushRoundDigest();
  }, WATCHDOG_MS);

  _arm(DEBOUNCE_MS);
  return true;
}

/**
 * Correct the round number after opening. The nextRound wrapper opens the
 * buffer before the round has actually advanced, so it guesses; the round-start
 * handler knows the real value.
 */
export function setRoundDigestRound(round) {
  if (digest && round != null) digest.round = round;
}

/**
 * Round processing has finished its await-chain. Collapses the quiet period so
 * the card lands promptly instead of a second and a half later — and so a
 * bleed applied by an attack moments after the round started is not swept into
 * the round's card.
 */
export function finishRoundDigest() {
  if (digest && !digest.flushing) _arm(FINISH_MS);
}

function _arm(ms) {
  if (!digest) return;
  if (digest.timer) clearTimeout(digest.timer);
  digest.timer = setTimeout(() => flushRoundDigest(), ms);
}

/**
 * Run `fn` once the round card has been posted, or straight away when no card
 * is buffering or in flight.
 *
 * For round-start work that posts its own chat message instead of a digest
 * line: a sustained spell re-rolls at the top of the round and needs a full
 * spell card, and posting that from inside round processing lands it above the
 * Announcer, which is still collecting its lines at the time.
 *
 * Callbacks run in the order they were queued, and their errors are logged
 * rather than rethrown — by then the flush has no caller left to catch them.
 *
 * @param {Function} fn
 */
export function afterRoundDigest(fn) {
  if (typeof fn !== "function") return;
  if (digest || flushInFlight) {
    afterFlush.push(fn);
    return;
  }
  _runQueued(fn);
}

async function _runQueued(fn) {
  try {
    await fn();
  } catch (err) {
    console.error("Redsteel | Post-digest callback failed", err);
  }
}

async function _drainAfterFlush() {
  while (afterFlush.length) {
    const queued = afterFlush;
    afterFlush = [];
    for (const fn of queued) await _runQueued(fn);
  }
}

/* -------------------------------------------- */
/*  Collection                                  */
/* -------------------------------------------- */

/**
 * Add one line to the open digest.
 *
 * @param {Actor} actor                  Who the line is about.
 * @param {object} entry
 * @param {string} [entry.kind]          Line flavour: initiative | damage |
 *                                       healing | test | note.
 * @param {string} [entry.label]         Left-hand label ("Bleeding").
 * @param {Roll|null} [entry.roll]       Roll to show (and to carry on the card).
 * @param {string} [entry.note]          Extra HTML after the roll box.
 * @param {boolean} [entry.gm]           Hide the line from non-GM clients.
 * @param {number|null} [entry.initiative] Sorts the actor into turn order.
 * @param {string} [entry.name]          Name override (token name).
 * @param {string} [entry.img]           Portrait override (token art).
 * @returns {boolean} True if collected; false means the caller must post.
 */
export function collectRoundEntry(actor, entry = {}) {
  if (!isRoundDigestOpen()) return false;
  if (!actor) return false;

  digest.entries.push({
    key: actor.uuid,
    name: entry.name ?? actor.token?.name ?? actor.name,
    img:
      entry.img ??
      actor.token?.texture?.src ??
      actor.prototypeToken?.texture?.src ??
      actor.img,
    kind: entry.kind ?? "note",
    label: entry.label ?? "",
    roll: entry.roll ?? null,
    note: entry.note ?? "",
    gm: !!entry.gm,
    initiative: entry.initiative ?? null,
  });

  _arm(DEBOUNCE_MS);
  return true;
}

/**
 * Collect into the round card, or post the message the call site would have
 * posted on its own.
 *
 * `label`/`note` describe the digest line; `flavor`/`content`/`messageData`
 * describe the standalone fallback and must reproduce the old message exactly.
 *
 * @param {Actor} actor
 * @param {object} options
 * @returns {Promise<boolean>} True if the entry was collected.
 */
export async function postRoundEntry(actor, options = {}) {
  const {
    kind,
    label = "",
    roll = null,
    note = "",
    gm = false,
    initiative = null,
    name,
    img,
    flavor,
    content,
    messageData = {},
  } = options;

  if (
    collectRoundEntry(actor, {
      kind,
      label,
      roll,
      note,
      gm,
      initiative,
      name,
      img,
    })
  ) {
    return true;
  }

  const base = {
    speaker: ChatMessage.getSpeaker({ actor }),
    ...messageData,
  };
  const resolvedFlavor = flavor ?? label;
  if (resolvedFlavor) base.flavor = resolvedFlavor;

  if (roll) await roll.toMessage(base);
  else await ChatMessage.create({ ...base, content: content ?? note });

  return false;
}

/* -------------------------------------------- */
/*  Flush                                       */
/* -------------------------------------------- */

export async function flushRoundDigest() {
  if (!digest || digest.flushing) return;

  const buffer = digest;
  buffer.flushing = true;
  if (buffer.timer) clearTimeout(buffer.timer);
  if (buffer.watchdog) clearTimeout(buffer.watchdog);
  digest = null;

  // Assigned with no await in between, so `afterRoundDigest` can never see a
  // gap where neither a buffer nor a flush is live and fire its callback early.
  // Posts even when empty: the round banner is the point.
  flushInFlight = _postCard(buffer.round, buffer.entries);

  try {
    await flushInFlight;
  } catch (err) {
    console.error("Redsteel | Failed to post the round digest", err);
  } finally {
    flushInFlight = null;
  }

  // Even after a failed card: the queued work is the round's, not the card's.
  await _drainAfterFlush();
}

async function _postCard(round, entries) {
  const groups = _group(entries);

  // Line order and roll order must match one-for-one — the render hook zips
  // core's roll boxes onto the slots by index.
  const rolls = [];
  for (const group of groups) {
    for (const line of group.lines) {
      if (line.roll) {
        line.rollIndex = rolls.length;
        rolls.push(line.roll);
      }
    }
  }

  const data = {
    speaker: { alias: game.i18n.localize("REDSTEEL.RoundDigest.Announcer") },
    content: _renderContent(round, groups),
    flags: { redsteel: { roundDigest: true } },
  };

  if (rolls.length) {
    data.rolls = rolls;
    data.sound = CONFIG.sounds?.dice;
  }

  await ChatMessage.create(data);
}

/**
 * One group per actor, ordered by the round's turn order (highest initiative
 * first) with anyone who did not roll listed after, alphabetically.
 */
function _group(entries) {
  const byKey = new Map();

  for (const entry of entries) {
    let group = byKey.get(entry.key);
    if (!group) {
      group = {
        key: entry.key,
        name: entry.name,
        img: entry.img,
        initiative: null,
        lines: [],
      };
      byKey.set(entry.key, group);
    }

    // A token name/portrait beats the base actor's — initiative entries carry
    // the combatant's, effect ticks only know the actor.
    if (entry.initiative != null && group.initiative == null) {
      group.initiative = entry.initiative;
      group.name = entry.name;
      group.img = entry.img;
    }

    group.lines.push({
      kind: entry.kind,
      label: entry.label,
      roll: entry.roll,
      note: entry.note,
      gm: entry.gm,
      rollIndex: null,
    });
  }

  // A group is GM-only when every line in it is — a hidden combatant's whole
  // block disappears for players, rather than leaving them a nameless stub.
  for (const group of byKey.values()) {
    group.gm = group.lines.every((line) => line.gm);
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.initiative != null && b.initiative != null) {
      return b.initiative - a.initiative;
    }
    if (a.initiative != null) return -1;
    if (b.initiative != null) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Czech needs three plural forms where English needs two (1 bojovník / 2–4
 * bojovníci / 5+ bojovníků), so the form is picked here rather than left to a
 * single format string.
 */
function _combatantCount(count) {
  const form = count === 1 ? "One" : count <= 4 ? "Few" : "Many";
  return game.i18n.format(`REDSTEEL.RoundDigest.Combatants${form}`, { count });
}

/**
 * Collapsed summary: how many combatants took the field, and a count per effect
 * that ticked. Enough to tell at a glance whether the round did anything.
 */
function _tally(groups, gm) {
  let initiative = 0;
  const labels = new Map();

  for (const group of groups) {
    for (const line of group.lines) {
      if (!!line.gm !== gm) continue;
      if (line.kind === "initiative") {
        initiative += 1;
        continue;
      }
      const label =
        line.label || game.i18n.localize("REDSTEEL.RoundDigest.Other");
      labels.set(label, (labels.get(label) ?? 0) + 1);
    }
  }

  const parts = [];
  if (initiative) parts.push(_combatantCount(initiative));
  for (const [label, count] of labels) {
    parts.push(count > 1 ? `${label} ×${count}` : label);
  }

  return parts.join(" · ");
}

function _renderContent(round, groups) {
  const publicTally = _tally(groups, false);
  const gmTally = _tally(groups, true);
  const allGm = groups.length > 0 && groups.every((group) => group.gm);

  const rows = groups
    .map(
      (group) => `
      <li class="rd-actor${group.gm ? " rd-gm-only" : ""}">
        <div class="rd-actor-head">
          <img class="rd-portrait" src="${group.img}" alt="">
          <span class="rd-name">${group.name}</span>
          ${
            group.initiative != null
              ? `<span class="rd-init-badge" data-tooltip="${game.i18n.localize(
                  "REDSTEEL.RoundDigest.Initiative",
                )}">${group.initiative}</span>`
              : ""
          }
        </div>
        <ul class="rd-lines">
          ${group.lines
            .map(
              (line) => `
            <li class="rd-line rd-line--${line.kind}${
              line.gm && !group.gm ? " rd-gm-only" : ""
            }">
              ${line.label ? `<span class="rd-label">${line.label}</span>` : ""}
              ${
                line.rollIndex != null
                  ? `<span class="rd-roll" data-rd-roll="${line.rollIndex}">
                       <span class="rd-fallback">${line.roll.formula} → <b>${line.roll.total}</b></span>
                     </span>`
                  : ""
              }
              ${line.note ? `<span class="rd-note">${line.note}</span>` : ""}
            </li>`,
            )
            .join("")}
        </ul>
      </li>`,
    )
    .join("");

  // The quiet line is what a player sees when the whole round was GM-only, so
  // it is marked players-only: the GM reads their own tally in its place.
  const quiet = `<span class="${
    gmTally ? "rd-players-only " : ""
  }rd-tally--empty">${game.i18n.localize("REDSTEEL.RoundDigest.Quiet")}</span>`;

  return `
    <div class="redsteel-round-digest">
      <div class="rd-banner">
        <span class="rd-round-label">${game.i18n.localize(
          "REDSTEEL.RoundDigest.Round",
        )}</span>
        <span class="rd-round-number">${round ?? "?"}</span>
      </div>
      <div class="rd-tally">
        ${publicTally ? `<span>${publicTally}</span>` : quiet}
        ${
          gmTally
            ? `<span class="rd-gm-only rd-tally-gm">${
                publicTally ? " · " : ""
              }<span class="rd-gm-tag">${game.i18n.localize(
                "REDSTEEL.RoundDigest.GmOnly",
              )}</span> ${gmTally}</span>`
            : ""
        }
      </div>
      ${
        groups.length
          ? `<details class="rd-details${allGm ? " rd-gm-only" : ""}">
               <summary class="rd-summary">${game.i18n.localize(
                 "REDSTEEL.RoundDigest.Details",
               )}</summary>
               <ol class="rd-actors">${rows}</ol>
             </details>`
          : ""
      }
    </div>`;
}

/* -------------------------------------------- */
/*  Rendering                                   */
/* -------------------------------------------- */

/**
 * Core appends a full `.dice-roll` box per entry in `message.rolls`, after our
 * content. Left alone that is the message spam we just merged, stacked inside
 * one card. Move each box into the line that owns it instead — the roll boxes
 * are the only place the formula, tooltip and total are shown, so the lines
 * carry no duplicated numbers of their own.
 *
 * Each slot ships with a plain "1d12+3 → 10" fallback baked into the content,
 * dropped only once its box actually lands. So the card still shows every
 * number if core ever declines to render the rolls (a blind card, a future
 * version that renders them elsewhere) — worst case it looks plainer.
 */
export function registerRoundDigest() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!message.getFlag("redsteel", "roundDigest")) return;

    const root = html.querySelector(".redsteel-round-digest");
    if (!root) return;

    const slots = [...root.querySelectorAll("[data-rd-roll]")];
    const boxes = [...html.querySelectorAll(".dice-roll")].filter(
      (box) => !root.contains(box),
    );

    if (slots.length) {
      // Zip as far as both go. Any slot left over keeps its text fallback, any
      // box left over stays where core put it — nothing is ever dropped.
      const paired = Math.min(slots.length, boxes.length);
      for (let index = 0; index < paired; index++) {
        slots[index].querySelector(".rd-fallback")?.remove();
        slots[index].appendChild(boxes[index]);
      }
    } else {
      // A card of pure notes; core's boxes would be strays under it.
      for (const box of boxes) box.remove();
    }

    // Audience trim, strictly after the zip above: dropping a GM-only line
    // first would shorten the slot list and misalign every roll after it.
    const drop = game.user.isGM ? ".rd-players-only" : ".rd-gm-only";
    for (const node of root.querySelectorAll(drop)) node.remove();

    // A details block whose every row was just dropped is an empty expander.
    const details = root.querySelector(".rd-details");
    if (details && !details.querySelector(".rd-actor")) details.remove();
  });
}
