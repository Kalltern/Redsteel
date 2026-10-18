/**
 * Grimm (Grimm): the two Bane nodes the combat code answers.
 *
 * - metlaIniciativa "Metla: Iniciativa +3": +3 to the initiative roll when at
 *   least one enemy in the encounter is one of the Grimm's Banes, or carries
 *   an Expose Weakness mark (user ruling 2026-10-14). Read by
 *   documents/combat.mjs rollInitiative.
 * - metlaOpakovani "Metla: 1x opakování hodu na Souboj/Střelbu/Vrh/Kryt": a
 *   node reroll pool (rerolls.mjs NODE_REROLL_POOLS), one charge back on a
 *   Long Rest like every other pool (user ruling 2026-10-14). It needs the
 *   `bane` roll token, which handleRerollClick (redsteel.mjs) adds when
 *   rollIsAgainstBane says the card was against a Bane.
 *
 * metlaVnimani and the two tkane nodes stay table rulings (user, 2026-10-14).
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { actorMatchesBane, getBaneProfile } from "./baneCombat.mjs";
import { isHostileSide } from "./movementZones.mjs";

const SPEC = "grimm";
/** Initiative bonus of metlaIniciativa. */
const BANE_INITIATIVE = 3;
/** The roll token a card against a Bane emits for the reroll picker. */
export const BANE_REROLL_TOKEN = "bane";

/**
 * Is `target` one of `actor`'s Banes? Its own Bane categories, or an Expose
 * Weakness mark from anyone: being marked is the qualification (the Bane
 * rules share a mark with every ally).
 *
 * @param {Actor} actor
 * @param {Actor|null} target
 */
export function isBaneFoe(actor, target) {
  if (!actor || !target || target === actor) return false;
  if (target.effects?.some((e) => e.statuses?.has("expose_weakness"))) return true;
  const { keys } = getBaneProfile(actor);
  return keys.length > 0 && actorMatchesBane(target, keys);
}

/**
 * Bane: Initiative +3, or 0. An enemy is a combatant on the other side
 * (isHostileSide, the split the movement zones use) that is not defeated.
 *
 * @param {Actor} actor
 * @param {Combat} combat
 * @param {Combatant} self  the combatant rolling
 * @returns {number}
 */
export function grimmInitiativeBonus(actor, combat, self) {
  if (!actorHasSpecNode(actor, SPEC, "metlaIniciativa")) return 0;
  const side = isHostileSide(self?.token);
  const foe = combat.combatants.contents.some(
    (c) =>
      c !== self &&
      !c.isDefeated &&
      isHostileSide(c.token) !== side &&
      isBaneFoe(actor, c.actor),
  );
  return foe ? BANE_INITIATIVE : 0;
}

/**
 * Was this roll card against a Bane of `actor`? An attack card: any token it
 * targeted. A defense card: the attacker it answered.
 *
 * @param {Actor} actor
 * @param {ChatMessage} message
 */
export function rollIsAgainstBane(actor, message) {
  const scene = game.scenes?.get(message?.speaker?.scene) ?? canvas?.scene;
  const actorOf = (id) => (id ? (scene?.tokens?.get(id)?.actor ?? null) : null);

  const attack = message?.flags?.attack;
  if (attack?.type === "attack") {
    const targets = Array.isArray(attack.targets) ? attack.targets : [];
    return targets.some((id) => isBaneFoe(actor, actorOf(id)));
  }
  const defense = message?.flags?.redsteel?.defense;
  if (defense) return isBaneFoe(actor, actorOf(defense.attackerTokenId));
  return false;
}
