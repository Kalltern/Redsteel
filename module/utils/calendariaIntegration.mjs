/**
 * Optional integration with the Calendaria module (world calendar).
 *
 * When enabled (world setting + Calendaria active), two things become
 * calendar-driven instead of manual:
 *  - Spent reroll pools refresh automatically after N calendar days (1 by
 *    default, or 7/5 for a Lucky pool spent on a Critical Failure — see
 *    {@link scheduleRerollRefresh}).
 *  - Grave wounds heal automatically after `system.woundHealDays` calendar
 *    days each (see {@link getWoundHealDays}).
 *
 * Everything Calendaria-specific goes through `globalThis.CALENDARIA` and its
 * hooks, always optional-chained, so the system behaves identically to today
 * when Calendaria is absent or the setting is off.
 *
 * Pending work is tracked per-actor as a flag (scope "redsteel", key
 * "calendariaPending") rather than a template.json field — it's an implicit,
 * best-effort schedule, not core character data. Each entry:
 *   { id, type: "rerollRefresh"|"woundHeal", due, lockout, itemId?, poolIndex?,
 *     poolLabel?, noteId }
 * `due` is a worldTime timestamp (seconds). `lockout` (rerollRefresh only)
 * marks a pool that must NOT be reset by Long Rest until `due` passes — this
 * is how Lucky's crit-failure lockout survives Long Rest by design.
 *
 * Calendar notes created for these entries are purely cosmetic flavour — the
 * actor flag is the source of truth. If no GM is online when a note request
 * is made, the note simply never appears; the schedule still fires normally.
 */

/** Guards overlapping "day changed" processing runs. */
let processing = false;

/* -------------------------------------------- */
/*  Setting registration                         */
/* -------------------------------------------- */

/**
 * Whether the Calendaria integration is currently usable: the module must be
 * active AND the world setting enabled. Safe to call before the setting is
 * registered (returns false instead of throwing).
 * @returns {boolean}
 */
export function isCalendariaEnabled() {
  if (game.modules.get("calendaria")?.active !== true) return false;
  try {
    return game.settings.get("redsteel", "calendariaIntegration") === true;
  } catch (_err) {
    return false;
  }
}

/**
 * Register the world setting, the settings-UI guard, and every hook the
 * integration relies on. Call once from the system's `init` hook.
 */
export function registerCalendariaIntegration() {
  game.settings.register("redsteel", "calendariaIntegration", {
    config: true,
    scope: "world",
    name: "REDSTEEL.Config.Calendaria.name",
    hint: "REDSTEEL.Config.Calendaria.label",
    type: Boolean,
    default: false,
    onChange: (value) => {
      // Guard against a settings-set-triggered re-entrant onChange loop: only
      // ever force it back off, never force it on.
      if (value === true && game.modules.get("calendaria")?.active !== true) {
        ui.notifications.warn(
          game.i18n.localize("REDSTEEL.Config.Calendaria.missing"),
        );
        game.settings.set("redsteel", "calendariaIntegration", false);
      }
    },
  });

  // Disable (with an explanatory tooltip) the checkbox in the settings UI
  // when Calendaria isn't active, so GMs aren't left wondering why toggling
  // it does nothing.
  Hooks.on("renderSettingsConfig", (app, element) => {
    if (game.modules.get("calendaria")?.active === true) return;
    const root = element?.querySelector ? element : app.element;
    const input = root?.querySelector?.(
      'input[name="redsteel.calendariaIntegration"]',
    );
    if (!input) return;
    input.disabled = true;
    input.title = game.i18n.localize("REDSTEEL.Config.Calendaria.missing");
  });

  // Both hooks funnel into the same idempotent pass so a fresh Calendaria
  // "ready" (e.g. after a module update) catches up on anything missed.
  Hooks.on("calendaria.dayChange", () => processDueEntries());
  Hooks.on("calendaria.ready", () => processDueEntries());

  Hooks.on("updateActor", onUpdateActor);

  Hooks.once("ready", () => {
    game.socket.on("system.redsteel", async (data) => {
      if (data?.type !== "calendariaCreateNote") return;
      if (game.user !== game.users.activeGM) return;
      await handleCreateNoteSocket(data);
    });
  });
}

/* -------------------------------------------- */
/*  Calendar helpers                             */
/* -------------------------------------------- */

/** Seconds in one in-world day, per the active Calendaria calendar (or a 24h fallback). */
function secondsPerDay() {
  const calendar =
    globalThis.CALENDARIA?.managers?.CalendarManager?.getActiveCalendar?.();
  const days = calendar?.days;
  if (!days) return 86400;
  const hoursPerDay = days.hoursPerDay ?? 24;
  const minutesPerHour = days.minutesPerHour ?? 60;
  const secondsPerMinute = days.secondsPerMinute ?? 60;
  return hoursPerDay * minutesPerHour * secondsPerMinute;
}

/** worldTime timestamp for midnight of the current Calendaria day. */
function startOfTodayTs() {
  const api = globalThis.CALENDARIA?.api;
  const now = api.getCurrentDateTime();
  return api.dateToTimestamp({ year: now.year, month: now.month, day: now.day });
}

/** worldTime timestamp `days` calendar-days from the start of today. */
function dueTimestamp(days) {
  return startOfTodayTs() + days * secondsPerDay();
}

/**
 * Days a single grave wound takes to heal on its own. Future healing buffs
 * (e.g. a Regeneration feature) set `system.woundHealDays` via an Active
 * Effect change — this is a feature-flag key, deliberately not part of
 * template.json, so it's read with a safe fallback.
 * @param {Actor} actor
 * @returns {number}
 */
function getWoundHealDays(actor) {
  const d = Number(actor.system.woundHealDays);
  return Number.isFinite(d) && d > 0 ? d : 30;
}

/* -------------------------------------------- */
/*  Pending-flag accessors                       */
/* -------------------------------------------- */

/**
 * The actor's pending Calendaria entries (rerollRefresh / woundHeal).
 * @param {Actor} actor
 * @returns {object[]}
 */
export function getPendingCalendariaEntries(actor) {
  return actor?.getFlag?.("redsteel", "calendariaPending") ?? [];
}

/**
 * Every character-type actor that can carry pending entries: world actors plus
 * the synthetic actors of **unlinked** tokens on every scene. Scheduling writes
 * to whatever actor made the roll / took the wound — for an unlinked token
 * that is a synthetic actor that never appears in `game.actors`, so the
 * processing sweep must look at scene tokens too. Linked tokens resolve to
 * their world actor and are skipped to avoid double-processing.
 * @yields {Actor}
 */
function* iterCharacterActors() {
  for (const actor of game.actors) {
    if (actor.type === "character") yield actor;
  }
  for (const scene of game.scenes) {
    for (const tokenDoc of scene.tokens) {
      if (tokenDoc.actorLink) continue;
      const actor = tokenDoc.actor;
      if (actor?.type === "character") yield actor;
    }
  }
}

/* -------------------------------------------- */
/*  Reroll scheduling                            */
/* -------------------------------------------- */

/**
 * Schedule the calendar-driven refresh of one just-spent reroll pool. No-ops
 * silently (never throws) when the integration is off, Calendaria isn't
 * ready, or the actor isn't a character.
 *
 * @param {Actor} actor
 * @param {{itemId:string, poolIndex:number, label:string}} pool  Descriptor
 *   from {@link module:utils/rerolls.getEligibleRerolls}.
 * @param {{critFailure?:boolean}} [options]  Whether the roll this reroll is
 *   replacing was itself a natural Critical Failure (Lucky's long lockout).
 */
export async function scheduleRerollRefresh(actor, pool, { critFailure = false } = {}) {
  try {
    if (!isCalendariaEnabled()) return;
    if (actor?.type !== "character") return;
    const api = globalThis.CALENDARIA?.api;
    if (!api) return;

    const item = actor.items.get(pool.itemId);
    const isLucky =
      item?.system?.localizationKey === "REDSTEEL.Items.Lucky.name" ||
      item?.name === "Lucky";
    const isUntiring = actor.items.some(
      (i) => i.system?.localizationKey === "REDSTEEL.Items.UntiringLuck.name",
    );

    let days = 1;
    let lockout = false;
    if (critFailure && isLucky) {
      days = isUntiring ? 5 : 7;
      lockout = true;
    }

    const due = dueTimestamp(days);
    const entry = {
      id: foundry.utils.randomID(),
      type: "rerollRefresh",
      due,
      lockout,
      itemId: pool.itemId,
      poolIndex: pool.poolIndex,
      poolLabel: pool.label,
      noteId: null,
    };

    const pending = [...getPendingCalendariaEntries(actor), entry];
    await actor.setFlag("redsteel", "calendariaPending", pending);

    const name = game.i18n.format("REDSTEEL.Calendaria.RerollNote.name", {
      actor: actor.name,
      label: pool.label,
    });
    const content = game.i18n.format("REDSTEEL.Calendaria.RerollNote.content", {
      actor: actor.name,
      label: pool.label,
    });
    const icon = "fas fa-rotate";
    const color = "#b8860b";

    if (game.user.isGM) {
      const date = api.timestampToDate(due);
      const note = await api.createNote({
        name,
        content,
        startDate: { year: date.year, month: date.month, day: date.day },
        allDay: true,
        icon,
        color,
        visibility: "visible",
        openSheet: false,
      });
      if (note) await setEntryNoteId(actor, entry.id, note.id ?? note._id);
    } else {
      game.socket.emit("system.redsteel", {
        type: "calendariaCreateNote",
        actorUuid: actor.uuid,
        entryId: entry.id,
        name,
        content,
        icon,
        color,
        due,
      });
    }
  } catch (err) {
    console.warn("Redsteel | Calendaria reroll scheduling failed", err);
  }
}

/** Write back the noteId of one pending entry, identified by its own id. */
async function setEntryNoteId(actor, entryId, noteId) {
  const pending = getPendingCalendariaEntries(actor).map((e) =>
    e.id === entryId ? { ...e, noteId } : e,
  );
  await actor.setFlag("redsteel", "calendariaPending", pending);
}

/**
 * GM-side handler for a player-originated note creation request (players
 * cannot call `createNote` directly without the Calendaria "addNotes"
 * permission). Recomputes the note's startDate from the raw timestamp so it
 * lands on the correct day regardless of who is asking.
 */
async function handleCreateNoteSocket(data) {
  try {
    const api = globalThis.CALENDARIA?.api;
    if (!api) return;
    const actor = await fromUuid(data.actorUuid);
    if (!actor) return;
    const date = api.timestampToDate(data.due);
    const note = await api.createNote({
      name: data.name,
      content: data.content,
      startDate: { year: date.year, month: date.month, day: date.day },
      allDay: true,
      icon: data.icon,
      color: data.color,
      visibility: "visible",
      openSheet: false,
    });
    if (note) await setEntryNoteId(actor, data.entryId, note.id ?? note._id);
  } catch (err) {
    console.warn("Redsteel | Calendaria note creation (socket) failed", err);
  }
}

/* -------------------------------------------- */
/*  Grave wound reconciliation                   */
/* -------------------------------------------- */

/**
 * Keep the actor's pending `woundHeal` entries in sync with its actual grave
 * wound count whenever that count changes (a wound is taken, or one is
 * removed/treated away by other means than the Calendaria healing pass
 * itself — that pass writes graveWounds and the trimmed flag array in a
 * single update, so it never re-triggers this).
 */
async function onUpdateActor(actor, changed, _options, _userId) {
  try {
    if (game.users.activeGM !== game.user) return;
    if (!isCalendariaEnabled()) return;
    if (actor.type !== "character") return;
    if (
      foundry.utils.getProperty(changed, "system.stats.graveWounds.value") ===
      undefined
    )
      return;

    const api = globalThis.CALENDARIA?.api;
    const wounds = Number(actor.system.stats.graveWounds?.value ?? 0);
    const pending = getPendingCalendariaEntries(actor);
    const woundEntries = pending.filter((e) => e.type === "woundHeal");
    const otherEntries = pending.filter((e) => e.type !== "woundHeal");

    if (wounds > woundEntries.length) {
      const missing = wounds - woundEntries.length;
      for (let i = 0; i < missing; i++) {
        const due = dueTimestamp(getWoundHealDays(actor));
        const entry = {
          id: foundry.utils.randomID(),
          type: "woundHeal",
          due,
          lockout: false,
          noteId: null,
        };
        if (api) {
          try {
            const name = game.i18n.format("REDSTEEL.Calendaria.WoundNote.name", {
              actor: actor.name,
            });
            const content = game.i18n.format(
              "REDSTEEL.Calendaria.WoundNote.content",
              { actor: actor.name },
            );
            const date = api.timestampToDate(due);
            const note = await api.createNote({
              name,
              content,
              startDate: { year: date.year, month: date.month, day: date.day },
              allDay: true,
              icon: "fas fa-heart-crack",
              color: "#8b1a1a",
              visibility: "visible",
              openSheet: false,
            });
            if (note) entry.noteId = note.id ?? note._id;
          } catch (err) {
            console.warn("Redsteel | Calendaria wound note creation failed", err);
          }
        }
        woundEntries.push(entry);
      }
    } else if (wounds < woundEntries.length) {
      // A wound was treated away outside this system's own healing pass —
      // drop the surplus entries with the earliest due date first.
      woundEntries.sort((a, b) => a.due - b.due);
      const surplus = woundEntries.length - wounds;
      const removed = woundEntries.splice(0, surplus);
      for (const entry of removed) {
        if (!entry.noteId) continue;
        try {
          await api?.deleteNote(entry.noteId);
        } catch (err) {
          console.warn("Redsteel | Calendaria note deletion failed", err);
        }
      }
    }

    await actor.setFlag("redsteel", "calendariaPending", [
      ...otherEntries,
      ...woundEntries,
    ]);
  } catch (err) {
    console.error("Redsteel | Calendaria wound reconciliation failed", err);
  }
}

/* -------------------------------------------- */
/*  Due-entry processing                         */
/* -------------------------------------------- */

/**
 * Console diagnostics for the integration — run `redsteel.utils.calendaria.diagnose()`
 * in the console (as GM) to see why scheduled entries are or aren't processing.
 */
export function diagnoseCalendaria() {
  const moduleActive = game.modules.get("calendaria")?.active === true;
  let setting = null;
  try {
    setting = game.settings.get("redsteel", "calendariaIntegration");
  } catch (_e) {
    /* not registered */
  }
  const api = globalThis.CALENDARIA?.api;
  const now = game.time.worldTime;
  const dayLen = secondsPerDay();
  const report = {
    moduleActive,
    setting,
    isEnabled: isCalendariaEnabled(),
    isActiveGM: game.users.activeGM === game.user,
    activeGMName: game.users.activeGM?.name ?? null,
    apiPresent: !!api,
    worldTime: now,
    secondsPerDay: dayLen,
    startOfTodayTs: api ? startOfTodayTs() : null,
    currentDate: api?.getCurrentDateTime?.() ?? null,
    dayChangeListeners: Hooks.events["calendaria.dayChange"]?.length ?? 0,
    processingMutex: processing,
    actors: [],
  };
  for (const actor of iterCharacterActors()) {
    const pending = getPendingCalendariaEntries(actor);
    if (!pending.length) continue;
    report.actors.push({
      name: actor.name,
      uuid: actor.uuid,
      isUnlinkedToken: !!actor.token,
      graveWounds: actor.system.stats?.graveWounds?.value ?? null,
      entries: pending.map((e) => {
        const item = e.itemId ? actor.items.get(e.itemId) : null;
        return {
          ...e,
          isDue: e.due <= now,
          daysUntilDue: Math.round(((e.due - now) / dayLen) * 100) / 100,
          itemFound: e.itemId ? !!item : undefined,
          poolUsed:
            item && e.poolIndex >= 0
              ? (Array.isArray(item.system.reroll?.pools)
                  ? item.system.reroll.pools
                  : Object.values(item.system.reroll?.pools ?? {}))[e.poolIndex]
                  ?.used
              : undefined,
        };
      }),
    });
  }
  console.log("Redsteel | Calendaria diagnostics", report);
  return report;
}

/**
 * Process every actor's due Calendaria entries (reroll refreshes and grave
 * wound healing). Only the active GM's client runs this — called from the
 * `calendaria.dayChange` / `calendaria.ready` hooks.
 */
export async function processDueEntries() {
  if (game.users.activeGM !== game.user) return;
  if (!isCalendariaEnabled()) return;
  const api = globalThis.CALENDARIA?.api;
  if (!api) return;
  if (processing) return;
  processing = true;

  try {
    const now = game.time.worldTime;
    for (const actor of iterCharacterActors()) {
      const pending = getPendingCalendariaEntries(actor);
      if (!pending.length) continue;

      try {
        await processActorEntries(actor, pending, now, api);
      } catch (err) {
        console.error(
          `Redsteel | Calendaria processing failed for actor ${actor.name}`,
          err,
        );
      }
    }
  } finally {
    processing = false;
  }
}

/** Process one actor's due entries; see {@link processDueEntries}. */
async function processActorEntries(actor, pending, now, api) {
  const due = pending.filter((e) => e.due <= now);
  const remaining = pending.filter((e) => e.due > now);
  if (!due.length) return;

  const rerollDue = due.filter((e) => e.type === "rerollRefresh");
  const woundDue = due.filter((e) => e.type === "woundHeal");

  for (const entry of rerollDue) {
    await processRerollRefresh(actor, entry);
  }

  let woundUpdate = null;
  if (woundDue.length) {
    woundUpdate = await buildWoundHealUpdate(actor, woundDue.length);
  }

  if (woundUpdate) {
    await actor.update({
      ...woundUpdate.changes,
      "flags.redsteel.calendariaPending": remaining,
    });
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: game.i18n.format("REDSTEEL.Calendaria.Chat.woundHealed", {
        actor: actor.name,
        remaining: woundUpdate.newValue,
      }),
    });
  } else {
    await actor.setFlag("redsteel", "calendariaPending", remaining);
  }

  for (const entry of due) {
    if (!entry.noteId) continue;
    try {
      await api.deleteNote(entry.noteId);
    } catch (err) {
      console.warn("Redsteel | Calendaria note deletion failed", err);
    }
  }
}

/** Reset one pool's `used` count and post a refresh chat card, if it had spent charges. */
async function processRerollRefresh(actor, entry) {
  const item = actor.items.get(entry.itemId);
  if (!item) return;
  const reroll = item.system?.reroll ?? {};

  if (entry.poolIndex === -1) {
    const active = Array.isArray(reroll.active) ? reroll.active : [];
    if (!active.some(Boolean)) return;
    await item.update({ "system.reroll.active": active.map(() => false) });
  } else {
    const rawPools = Array.isArray(reroll.pools)
      ? reroll.pools
      : Object.values(reroll.pools ?? {});
    const pools = rawPools.map((p) => ({ ...p }));
    const pool = pools[entry.poolIndex];
    if (!pool) return;
    if (!(Number(pool.used) > 0)) return;
    pool.used = 0;
    await item.update({ "system.reroll.pools": pools });
  }

  const isLucky =
    item.system?.localizationKey === "REDSTEEL.Items.Lucky.name" ||
    item.name === "Lucky";
  const img = isLucky ? "icons/commodities/flowers/clover.webp" : item.img;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
<div style="display:flex; align-items:center; gap:10px;">
  <img src="${img}" width="36" height="36" style="border-radius:50%;" />
  <div>
    <p style="font-size:1.1em;">
      ${game.i18n.format("REDSTEEL.Calendaria.Chat.rerollRefreshed", {
        actor: actor.name,
        label: entry.poolLabel ?? item.name,
      })}
    </p>
  </div>
</div>`,
  });
}

/** Compute (but don't apply) the graveWounds update for `count` due heals. */
async function buildWoundHealUpdate(actor, count) {
  const gw = actor.system.stats.graveWounds;
  const value = Number(gw?.value ?? 0);
  const healed = Math.min(count, value);
  if (healed <= 0) return null;
  const newValue = value - healed;
  const newTreated = Math.min(Number(gw?.treated ?? 0), newValue);
  return {
    newValue,
    changes: {
      "system.stats.graveWounds.value": newValue,
      "system.stats.graveWounds.treated": newTreated,
    },
  };
}
