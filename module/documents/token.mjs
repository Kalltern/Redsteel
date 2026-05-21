export class RedsteelToken extends Token {
  async _onDragLeftMove(event) {
    await super._onDragLeftMove(event);

    this.#updateMovementLabel();
  }

  #updateMovementLabel() {
    const label = document.querySelector(
      "#measurement .token-ruler-labels .waypoint-label",
    );

    if (!label) return;

    const distanceText = label.textContent;

    const distance = parseFloat(distanceText) || 0;

    const max = 6;

    let movement = label.querySelector(".redsteel-movement");

    if (!movement) {
      movement = document.createElement("span");

      movement.classList.add("redsteel-movement");

      label.appendChild(movement);
    }

    movement.textContent = ` (${distance}/${max} MP)`;

    movement.style.color = distance > max ? "red" : "white";
  }
}
