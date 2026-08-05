import { buildSpeedTestFormula } from "../utils/speedTest.mjs";

/**
 * Turn order is the Speed Test: "Pořadí, ve kterém účastníci souboje v tahu
 * konají, se rozhoduje podle Pořadí tahu, které se určuje za pomoci Testu
 * Rychlosti (1d12 + Rychlost + Iniciativa)".
 *
 * RedsteelCombat.rollInitiative builds that formula itself for the tracker's
 * roll buttons and for the dynamic-initiative round reroll. This override
 * covers every *other* route into initiative — Combatant#rollInitiative, a
 * module asking for the formula, anything calling getInitiativeRoll() — which
 * would otherwise fall through to the core default, since the system sets
 * neither `CONFIG.Combat.initiative.formula` nor `initiative` in system.json.
 *
 * @extends {Combatant}
 */
export class RedsteelCombatant extends Combatant {
  /** @override */
  _getInitiativeFormula() {
    if (!this.actor) return super._getInitiativeFormula();
    return buildSpeedTestFormula(this.actor);
  }
}
