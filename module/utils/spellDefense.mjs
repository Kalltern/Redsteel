import { getTraitPills } from "./traitPills.mjs";
import { withRollBias } from "./rollAdvantage.mjs";

export async function spellDefense() {
  // Ensure a token is selected
  const token = canvas.tokens.controlled[0];
  if (!token) {
    ui.notifications.warn("Select a token first!");
    return;
  }

  const actor = token.actor;
  if (!actor) {
    ui.notifications.warn("Token has no actor!");
    return;
  }

  // ─────────────────────────────
  // Priest: Holy Defense
  // ─────────────────────────────
  if (actor.system.priest) {
    let holyEnergy = actor.system.stats.holyEnergy.value ?? 0;
    let holyEnergyCast = actor.system.stats.holyEnergy.cast ?? 0;
    let newHolyEnergy = Math.max(0, holyEnergy - 1);

    await actor.update({
      "system.stats.holyEnergy.value": newHolyEnergy,
    });

    const faith = actor.system.secondaryAttributes.fth.total ?? 0;
    const rollFormula = `${holyEnergyCast} + ${faith * 8} - 1d100`;
    const roll = new Roll(rollFormula, withRollBias({}, actor));

    await roll.evaluate();

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `<strong>Holy Defense</strong>`,
      flags: {
        redsteel: { traitPills: getTraitPills(actor, "defense") },
      },
    });

    return;
  }

  // ─────────────────────────────
  // Non-Priest: Magic Defense
  // ─────────────────────────────
  const defenseLevels = {
    Wild: 0,
    Apprentice: 1,
    Expert: 2,
    Master: 3,
    Grandmaster: 5,
  };

  new Dialog({
    title: "Magic Defense",
    content: `<p>Select your Magic Defense level:</p>`,
    buttons: Object.entries(defenseLevels).reduce((buttons, [level, cost]) => {
      buttons[level] = {
        label: `${level} (-${cost} Mana)`,
        callback: async () => {
          const mana = actor.system.stats?.mana?.value ?? 0;
          const newMana = Math.max(0, mana - cost);

          await actor.update({
            "system.stats.mana.value": newMana,
          });

          const rating =
            actor.system.combatSkills.channeling.rating +
            actor.system.combatSkills.channeling.defense;

          const roll = new Roll(`${rating} - 1d100`, withRollBias({}, actor));
          await roll.evaluate();

          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `<strong>Magic Defense (${level})</strong>`,
            flags: {
              redsteel: { traitPills: getTraitPills(actor, "defense") },
            },
          });
        },
      };
      return buttons;
    }, {}),
    default: "Wild",
  }).render(true);
}
