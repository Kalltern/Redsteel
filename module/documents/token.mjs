const EVEN_NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [1, -1],
  [0, 1],
  [1, 1],
];

const ODD_NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [-1, -1],
  [0, -1],
  [-1, 1],
  [0, 1],
];
// Planning movement with CTRL is supported by Foundry's built-in pathing and this code does interfere with it and make it crash.
// Track mutation observers per token to avoid leaks across interrupted drags.
const _labelObservers = new Map();

// Helpers for hex distance only. Traversal continues to use offset coords and
// parity-aware neighbor tables as requested.
function offsetToCube({ i, j }) {
  const x = i - Math.floor((j - (j & 1)) / 2);
  const z = j;
  const y = -x - z;
  return { x, y, z };
}

function getHexDistance(a, b) {
  const A = offsetToCube(a);
  const B = offsetToCube(b);
  return Math.max(
    Math.abs(A.x - B.x),
    Math.abs(A.y - B.y),
    Math.abs(A.z - B.z),
  );
}

export class RedsteelToken extends Token {
  // Runtime-only: observers are tracked in `_labelObservers` map above.

  async _onDragLeftMove(event) {
    await super._onDragLeftMove(event);

    // Let Foundry handle CTRL path planning normally
    if (this.#isPlanningMovement(event)) return;

    // No movement overlay outside of combat
    if (!this.#isInCombat()) return;

    this.#ensureMovementLabel();
    this.#updateMovementLabel();
  }
  #isPlanningMovement(event) {
    return event?.interactionData?.originalEvent?.ctrlKey === true;
  }

  // The movement-range overlay is only meaningful during an active encounter.
  #isInCombat() {
    return game.combat?.started === true;
  }

  async _onDragLeftDrop(event) {
    const result = await super._onDragLeftDrop(event);

    // CTRL drag is only measurement/planning
    if (this.#isPlanningMovement(event)) return result;

    // Outside combat there is no movement budget to track
    if (!this.#isInCombat()) {
      this.#clearMovementRange();
      return result;
    }

    try {
      const label = document.querySelector(
        "#measurement .token-ruler-labels .waypoint-label",
      );

      let meters = 0;

      if (label) {
        const text = label.textContent || "";
        const match = text.match(/[\d.,]+/);
        meters = Number(match?.[0]?.replace(",", ".") ?? 0) || 0;
      }

      const hexMoved = Math.round(meters / 1.5) || 0;

      if (hexMoved > 0 && this.document) {
        const spent =
          (this.document.getFlag("redsteel", "movementSpent") ?? 0) || 0;

        await this.document.setFlag(
          "redsteel",
          "movementSpent",
          spent + hexMoved,
        );
      }
    } catch (err) {
      console.error("REDSTEEL: Failed to commit movement on drop", err);
    }

    this.#clearMovementRange();

    return result;
  }

  async _onDragLeftCancel(event) {
    const result = await super._onDragLeftCancel(event);
    try {
      const obs = _labelObservers.get(this.document?.id);
      if (obs) {
        obs.disconnect();
        _labelObservers.delete(this.document.id);
      }
    } catch (err) {}

    this.#clearMovementRange();
    return result;
  }

  #walkLayerId = "redsteel-walk";
  #movementLayerId = "redsteel-movement";
  #sprintLayerId = "redsteel-sprint";

  async _onDragLeftStart(event) {
    await super._onDragLeftStart(event);

    // Don't interfere with Foundry ruler planning
    if (this.#isPlanningMovement(event)) return;

    // No movement overlay outside of combat
    if (!this.#isInCombat()) return;

    this.#clearMovementRange();

    const state = this.#getMovementState();

    const walkRange = this.#getReachableHexes(Math.floor(state.remaining / 2));
    const movementRange = this.#getReachableHexes(state.remaining);
    const sprintRange = this.#getReachableHexes(
      Math.max(0, state.sprintRemaining),
    );

    this.#renderRange(this.#sprintLayerId, sprintRange, {
      color: 0xffff66,
      alpha: 0.15,
    });

    this.#renderRange(this.#movementLayerId, movementRange, {
      color: 0x66ff99,
      alpha: 0.15,
    });

    this.#renderRange(this.#walkLayerId, walkRange, {
      color: 0x66ccff,
      alpha: 0.15,
    });

    this.#ensureMovementLabel();
  }

  #getReachableHexes(maxDistance) {
    const origin = canvas.grid.getOffset({
      x: this.center.x,
      y: this.center.y,
    });

    const visited = new Set();
    const reachable = [];

    const queue = [{ i: origin.i, j: origin.j, distance: 0 }];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head++];
      const key = `${current.i},${current.j}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (current.distance > maxDistance) continue;
      reachable.push(current);

      const neighbors = current.j % 2 === 0 ? EVEN_NEIGHBORS : ODD_NEIGHBORS;
      for (const [di, dj] of neighbors) {
        queue.push({
          i: current.i + di,
          j: current.j + dj,
          distance: current.distance + 1,
        });
      }
    }

    return reachable;
  }

  #renderRange(layer, cells, style) {
    canvas.interface.grid.addHighlightLayer(layer);
    const shape = canvas.grid.getShape();

    // Build an occupied set of i,j offsets (exclude this token's own cell).
    // Exclude tokens that are not visible so hidden/invisible tokens don't
    // block the overlay visually.
    const occupied = new Set();
    for (const t of canvas.tokens.placeables) {
      if (!t?.center) continue;
      if (!t.visible) continue;
      if (this.document && t.document?.id === this.document.id) continue;
      const off = canvas.grid.getOffset({ x: t.center.x, y: t.center.y });
      occupied.add(`${off.i},${off.j}`);
    }

    for (const cell of cells) {
      const key = `${cell.i},${cell.j}`;
      if (occupied.has(key)) continue;
      const point = canvas.grid.getTopLeftPoint({ i: cell.i, j: cell.j });
      canvas.interface.grid.highlightPosition(layer, {
        x: point.x,
        y: point.y,
        shape,
        color: style.color,
        alpha: style.alpha,
      });
    }
  }

  #clearMovementRange() {
    canvas.interface.grid.clearHighlightLayer(this.#walkLayerId);
    canvas.interface.grid.clearHighlightLayer(this.#movementLayerId);
    canvas.interface.grid.clearHighlightLayer(this.#sprintLayerId);
  }

  #updateMovementLabel() {
    const labels = document.querySelectorAll(
      "#measurement .token-ruler-labels .waypoint-label",
    );

    if (!labels.length) return;

    const state = this.#getMovementState();

    // Always use full movement allowance as the cap.
    const cap = state.max;

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
