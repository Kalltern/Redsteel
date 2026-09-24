import { getMovementLock, isTrackedTurn } from "../utils/actionTracker.mjs";
import {
  MOVEMENT_MODES,
  DRAG_PATH_LAYER,
  clearLockedZone,
  clearZone,
  computeMovementZone,
  refreshLockedZone,
  pathSwordHexes,
  renderSwords,
  lockRemaining,
  renderZone,
} from "../utils/movementZones.mjs";

// Foundry's drag callbacks are SYNCHRONOUS and their return value is part of
// the contract: `_onDragLeftDrop` returning false keeps the drag alive (that is
// how core turns a CTRL+Click into a ruler waypoint instead of a drop), and
// `_onDragLeftCancel` returning false prevents the cancellation (right-click
// removing the last waypoint). Declaring these overrides `async` wraps every
// return value in a Promise, which is never `=== false`, so core ended the drag
// on the first CTRL+Click and waypoint planning stopped working. Keep them
// sync, return super's value verbatim, and run our own side effects
// fire-and-forget.
// Track mutation observers per token to avoid leaks across interrupted drags.
const _labelObservers = new Map();


export class RedsteelToken extends Token {
  // Runtime-only: observers are tracked in `_labelObservers` map above.

  _onDragLeftMove(event) {
    const result = super._onDragLeftMove(event);

    // The route's swords follow the cursor, CTRL planning included: the
    // waypoints being placed are exactly the route being judged.
    if (this.#isInCombat()) this.#refreshPathSwords();

    // Let Foundry handle CTRL path planning normally
    if (this.#isPlanningMovement(event)) return result;

    // No movement overlay outside of combat
    if (!this.#isInCombat()) return result;

    // Core writes the waypoint label during its own refresh, so touching the
    // DOM in this same tick finds nothing (or gets overwritten straight after).
    // Defer by one microtask - the exact timing the old `await super(...)`
    // gave us, minus the Promise-wrapped return value that broke waypoints.
    this.#afterCore(result, () => {
      this.#ensureMovementLabel();
      this.#updateMovementLabel();
    });

    return result;
  }

  /**
   * Run our own DOM / side-effect work one microtask after core's handler has
   * finished, without making the handler async. These callbacks return a value
   * core reads (`false` keeps a drag alive), so they must stay synchronous.
   */
  #afterCore(result, fn) {
    Promise.resolve(result)
      .then(fn)
      .catch((err) =>
        console.error("REDSTEEL: token drag side effect failed", err),
      );
  }

  #isPlanningMovement(event) {
    return event?.interactionData?.originalEvent?.ctrlKey === true;
  }

  // The movement-range overlay is only meaningful during an active encounter.
  #isInCombat() {
    return game.combat?.started === true;
  }

  _onDragLeftDrop(event) {
    const result = super._onDragLeftDrop(event);

    // `false` means core is NOT ending the drag: a CTRL+Click just placed a
    // ruler waypoint and the path is still being planned. Nothing to commit,
    // and the overlay must stay up.
    if (result === false) return result;

    // CTRL drag is only measurement/planning
    if (this.#isPlanningMovement(event)) return result;

    // Outside combat there is no movement budget to track
    if (!this.#isInCombat()) {
      this.#clearMovementRange();
      return result;
    }

    this.#afterCore(result, () => this.#commitMovement());

    return result;
  }

  /**
   * Read the hex distance off the ruler's own waypoint label and charge it to
   * this token's movement budget. Runs one microtask after core's drop so the
   * label still carries the final cumulative distance.
   */
  /**
   * The drop is over: take the overlay down. Hexes are no longer charged
   * here. They are counted from the `moveToken` hook at the bottom of this
   * file, which reports the spaces the token really moved.
   */
  #commitMovement() {
    this.#clearMovementRange();
  }

  _onDragLeftCancel(event) {
    const result = super._onDragLeftCancel(event);

    // `false` means core is keeping the drag alive (the last waypoint was
    // removed rather than the whole drag cancelled), so leave our overlay and
    // label observer in place.
    if (result === false) return result;

    this.#afterCore(result, () => {
      try {
        const obs = _labelObservers.get(this.document?.id);
        if (obs) {
          obs.disconnect();
          _labelObservers.delete(this.document.id);
        }
      } catch (err) {}

      this.#clearMovementRange();
    });

    return result;
  }

  #walkLayerId = "redsteel-walk";
  #movementLayerId = "redsteel-movement";
  #sprintLayerId = "redsteel-sprint";

  /**
   * Hexes left of a movement declared from the hotbar's suggestion strip, read
   * when the drag started. Null when no movement is locked, and then the label
   * caps at full Speed as before.
   */
  #lockedCap = null;

  /** Canvas centre of the token when the current drag began. */
  #dragOriginPoint = null;

  /** Waypoint centres placed during the current drag (CTRL+Click). */
  #dragWaypoints = [];

  /** Enemy ids a declared Disengage broke free from, for the route swords. */
  #pathIgnore = [];

  /** Origin, waypoints and cursor hex the path swords were last drawn for. */
  #pathKey = null;

  /**
   * Record each waypoint core places, snapped to its hex centre, so the path
   * swords judge the same route the ruler shows. Return value passed through
   * untouched, as with every drag override here.
   */
  _addDragWaypoint(point, options) {
    const result = super._addDragWaypoint(point, options);
    try {
      if (point) this.#dragWaypoints.push(canvas.grid.getCenterPoint(point));
    } catch (err) {
      console.error("REDSTEEL: failed to record drag waypoint", err);
    }
    return result;
  }

  _removeDragWaypoint(...args) {
    const result = super._removeDragWaypoint(...args);
    this.#dragWaypoints.pop();
    return result;
  }

  /**
   * Swords on the dragged route: every hex entered by a step that starts next
   * to a threatening enemy. Redrawn only when the cursor's hex or the waypoint
   * list changes, since this runs on every mouse move.
   */
  #refreshPathSwords() {
    try {
      const origin = this.#dragOriginPoint;
      const cursor = canvas.mousePosition;
      if (!origin || !cursor) return;
      const cursorHex = canvas.grid.getOffset(cursor);
      const points = [
        origin,
        ...this.#dragWaypoints,
        canvas.grid.getCenterPoint(cursorHex),
      ];
      const key = points.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join("|");
      if (key === this.#pathKey) return;
      this.#pathKey = key;
      renderSwords(DRAG_PATH_LAYER, pathSwordHexes(this, points, { ignore: this.#pathIgnore }));
    } catch (err) {
      console.error("REDSTEEL: failed to draw route swords", err);
    }
  }

  _onDragLeftStart(event) {
    this.#dragWaypoints = [];
    this.#pathKey = null;
    // A declared Disengage: the enemies it broke from put no swords on the
    // route either.
    const dragLock =
      this.actor && isTrackedTurn(this.actor) ? getMovementLock(this.actor) : null;
    this.#pathIgnore = dragLock?.ignore ?? [];
    this.#dragOriginPoint = this.center
      ? { x: this.center.x, y: this.center.y }
      : null;
    const result = super._onDragLeftStart(event);
    this.#lockedCap = null;

    // Don't interfere with Foundry ruler planning
    if (this.#isPlanningMovement(event)) return result;

    // No movement overlay outside of combat
    if (!this.#isInCombat()) return result;

    this.#clearMovementRange();

    // A declared movement replaces the three bands with the one it allows,
    // shrunk by what has been walked since it was declared.
    const actor = this.actor;
    const lock = actor && isTrackedTurn(actor) ? getMovementLock(actor) : null;
    const lockMode = lock ? MOVEMENT_MODES[lock.mode] : null;
    if (lockMode) {
      // The drag band stands in for the locked zone while the token is held;
      // #clearMovementRange puts the locked zone back when the drag ends.
      clearLockedZone();
      const remaining = lockRemaining(this, lock);
      this.#lockedCap = remaining;
      renderZone(
        this.#movementLayerId,
        computeMovementZone(this, remaining, { ignore: lock.ignore ?? [] }),
        { color: lockMode.color, alpha: 0.15 },
        this.document?.id ?? null,
        { swords: false },
      );
      this.#afterCore(result, () => this.#ensureMovementLabel());
      return result;
    }

    const state = this.#getMovementState();

    const selfId = this.document?.id ?? null;
    const walkRange = computeMovementZone(this, Math.floor(state.remaining / 2));
    const movementRange = computeMovementZone(this, state.remaining);
    const sprintRange = computeMovementZone(
      this,
      Math.max(0, state.sprintRemaining),
    );

    // The red tint comes from the outer (sprint) band alone, so three stacked
    // layers do not triple it. The inner bands draw only their unthreatened
    // hexes. No zone swords while dragging: the swords follow the dragged
    // route instead (#refreshPathSwords).
    renderZone(
      this.#sprintLayerId,
      sprintRange,
      { color: 0xffff66, alpha: 0.15 },
      selfId,
      { swords: false },
    );

    renderZone(
      this.#movementLayerId,
      movementRange,
      { color: 0x66ff99, alpha: 0.15 },
      selfId,
      { threatened: "skip", swords: false },
    );

    renderZone(
      this.#walkLayerId,
      walkRange,
      { color: 0x66ccff, alpha: 0.15 },
      selfId,
      { threatened: "skip", swords: false },
    );

    this.#afterCore(result, () => this.#ensureMovementLabel());

    return result;
  }

  // Highlights and their sword markers together.
  #clearMovementRange() {
    renderSwords(DRAG_PATH_LAYER, []);
    this.#pathKey = null;
    clearZone(this.#walkLayerId);
    clearZone(this.#movementLayerId);
    clearZone(this.#sprintLayerId);
    // Hidden for the drag; a no-op when the hotbar has no lock to draw.
    refreshLockedZone();
  }

  #updateMovementLabel() {
    const labels = document.querySelectorAll(
      "#measurement .token-ruler-labels .waypoint-label",
    );

    if (!labels.length) return;

    const state = this.#getMovementState();

    // Full movement allowance as the cap, unless a declared movement is in
    // force: then what was left of it when the drag started.
    const cap = this.#lockedCap ?? state.max;

    labels.forEach((label, index) => {
      const distanceText = label.textContent || "";

      const meters =
        Number(distanceText.match(/[\d.,]+/)?.[0]?.replace(",", ".") ?? 0) || 0;

      // Foundry labels are already cumulative.
      const traversed = Math.round(meters / 1.5);

      let movement = label.querySelector(".redsteel-movement");

      if (!movement) {
        movement = document.createElement("span");
        movement.classList.add("redsteel-movement");
        label.appendChild(movement);
      }

      const isPlanned = index === labels.length - 1;

      if (isPlanned) {
        movement.textContent = ` (Planned: ${traversed}/${cap} Hex)`;

        movement.style.color = traversed > cap ? "red" : "white";
      } else {
        movement.textContent = ` (Passed: ${traversed} Hex)`;

        movement.style.color = "#999999";
      }
    });
  }

  #ensureMovementLabel() {
    // Try to append immediately. If Foundry hasn't created the waypoint-label
    // yet, observe the measurement container for additions and append when it
    // appears.
    const measurement = document.querySelector("#measurement");
    const tryAppend = (root) => {
      const l = root?.querySelector?.(".token-ruler-labels .waypoint-label");
      if (!l) return false;
      if (!l.querySelector(".redsteel-movement")) {
        const mv = document.createElement("span");
        mv.classList.add("redsteel-movement");
        l.appendChild(mv);
      }
      return true;
    };

    if (tryAppend(document)) {
      return;
    }

    if (!_labelObservers.has(this.document?.id)) {
      try {
        const obs = new MutationObserver(() => tryAppend(document));
        if (measurement)
          obs.observe(measurement, { childList: true, subtree: true });
        else obs.observe(document.body, { childList: true, subtree: true });
        _labelObservers.set(this.document?.id, obs);
      } catch (err) {
        /* ignore observer failures */
      }
    }
  }

  #getMovementAllowance() {
    const actor = this.actor;
    if (!actor) return 0;
    // Characters and NPCs both carry `spd`; movement is its total.
    return actor.system.secondaryAttributes?.spd?.total ?? 0;
  }

  #isActiveCombatant() {
    const active = game.combat?.combatant;
    if (!active) return false;
    return this.combatant?.id === active.id;
  }

  #getMovementState() {
    const max = this.#getMovementAllowance();
    const spent =
      (this.document?.getFlag("redsteel", "movementSpent") ?? 0) || 0;
    const remaining = Math.max(0, max - spent);
    const sprintRemaining = Math.max(0, max * 2 - spent);
    return { max, spent, remaining, sprintRemaining };
  }
}

// Movement is committed on drop using the ruler traversal; preUpdateToken
// handler removed to avoid undercounting (straight-line distance).

// Count the hexes walked this round from the move itself. `moveToken` fires on
// every client once a movement update is processed; `movement.passed.spaces`
// is the number of grid spaces the token moved along its path (V14
// TokenMovementOperation / TokenMovementSectionData). This replaces reading
// the ruler label at drop, which charged a drag released on the token's own
// hex and raced core's own drop handling. It also counts arrow-key moves.
// Only the user who made the move writes, the same single-writer rule as the
// action tracker's updateToken hook.
Hooks.on("moveToken", (tokenDoc, movement, _operation, user) => {
  if (user?.id !== game.user.id) return;
  if (!game.combat?.started) return;
  const hexes = Math.round(Number(movement?.passed?.spaces) || 0);
  if (hexes <= 0) return;
  addMovementSpent(tokenDoc, hexes);
});

function addMovementSpent(tokenDoc, hexes) {
  const spent = (tokenDoc.getFlag("redsteel", "movementSpent") ?? 0) || 0;
  tokenDoc
    .setFlag("redsteel", "movementSpent", spent + hexes)
    .catch((err) =>
      console.error("REDSTEEL: Failed to commit movement on drop", err),
    );
}

// Reset movementSpent at the start of a new round. Use the canvas tokens
// when available to only touch tokens present in the scene.
Hooks.on("updateCombat", async (combat, changed) => {
  if (!changed || !("round" in changed)) return;
  // This hook fires on every connected client, but only the GM may update
  // tokens they do not own. Let a single authoritative GM do the writing.
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  try {
    const scene = combat.scene ?? game.scenes.get(combat.sceneId);
    if (!scene) return;
    const updates = [];
    for (const c of combat.combatants.contents) {
      const tokenId = c.tokenId ?? c.token?.id;
      if (!tokenId) continue;
      const tokenDoc = scene.tokens.get(tokenId);
      if (!tokenDoc) continue;
      if (!(tokenDoc.getFlag("redsteel", "movementSpent") ?? 0)) continue;
      updates.push({ _id: tokenId, "flags.redsteel.movementSpent": 0 });
    }
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  } catch (err) {
    console.error(
      "REDSTEEL: Failed to reset movementSpent on round change",
      err,
    );
  }
});
