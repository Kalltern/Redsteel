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

export class RedsteelToken extends Token {
  async _onDragLeftMove(event) {
    await super._onDragLeftMove(event);

    this.#updateMovementLabel();
  }

  async _onDragLeftDrop(event) {
    this.#clearMovementRange();

    return super._onDragLeftDrop(event);
  }

  async _onDragLeftCancel(event) {
    this.#clearMovementRange();

    return super._onDragLeftCancel(event);
  }

  #walkLayerId = "redsteel-walk";
  #movementLayerId = "redsteel-movement";
  #sprintLayerId = "redsteel-sprint";
  async _onDragLeftStart(event) {
    await super._onDragLeftStart(event);

    const movement = this.#getMovementAllowance();

    const walkRange = this.#getReachableHexes(Math.floor(movement / 2));

    const movementRange = this.#getReachableHexes(movement);

    const sprintRange = this.#getReachableHexes(movement * 2);

    // largest first
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
  }
  #getReachableHexes(maxDistance) {
    const origin = canvas.grid.getOffset({
      x: this.center.x,
      y: this.center.y,
    });

    const visited = new Set();

    const reachable = [];

    const queue = [
      {
        i: origin.i,
        j: origin.j,
        distance: 0,
      },
    ];

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

    for (const cell of cells) {
      const point = canvas.grid.getTopLeftPoint({
        i: cell.i,
        j: cell.j,
      });

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
    const label = document.querySelector(
      "#measurement .token-ruler-labels .waypoint-label",
    );

    if (!label) return;
    const distanceText = label.textContent;

    const meters = parseFloat(distanceText) || 0;

    const distance = Math.round(meters / 1.5);

    const max = this.#getMovementAllowance();

    let movement = label.querySelector(".redsteel-movement");

    if (!movement) {
      movement = document.createElement("span");

      movement.classList.add("redsteel-movement");

      label.appendChild(movement);
    }

    movement.textContent = ` (${distance}/${max} Hex)`;

    movement.style.color = distance > max ? "red" : "white";
  }

  #getMovementAllowance() {
    const actor = this.actor;

    if (!actor) return 0;

    switch (actor.type) {
      case "character":
        return actor.system.secondaryAttributes.spd.total ?? 0;

      case "npc":
        return actor.system.secondaryAttributes.mov.total ?? 0;

      default:
        return 0;
    }
  }
}
