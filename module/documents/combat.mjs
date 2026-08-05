import {
  buildSpeedTestFormula,
  tagSpeedTest,
} from "../utils/speedTest.mjs";

/**
 * Extend the basic Combat with custom initiative handling.
 * @extends {Combat}
 */
export class RedsteelCombat extends Combat {
  async rollInitiative(
    ids,
    { formula = null, updateTurn = true, messageOptions = {} } = {},
  ) {
    console.log("Rolling initiative for IDs:", ids);

    ids = typeof ids === "string" ? [ids] : ids;

    const currentId = this.combatant?.id;
    const chatRollMode = game.settings.get("core", "rollMode");

    const updates = [];
    const messages = [];

    for (let [i, id] of ids.entries()) {
      const combatant = this.combatants.get(id);
      const actor = combatant?.actor;

      if (!combatant?.isOwner || !actor) continue;

      // -----------------------------------------
      // Initiative formula
      // -----------------------------------------
      // Turn order IS the Speed Test: 1d12 + Speed + Initiative, for characters
      // and NPCs alike. Shared with ability "speed" tests (prone override, the
      // rogue doctrine-7 two-die upgrade) so the two can never drift apart, and
      // so a plain Speed debuff lowers turn order with no extra wiring.

      const rollFormula = buildSpeedTestFormula(actor);

      // -----------------------------------------
      // Roll initiative
      // -----------------------------------------

      const roll = new Roll(rollFormula, actor.getRollData());
      // Mark as a d12 speed test so the roll-modifier layer can apply
      // advantage/disadvantage (keeping the higher/lower d12). Tagged with the
      // "spd" skill so speed-specific advantage buckets apply too.
      tagSpeedTest(roll);

      await roll.evaluate();

      // -----------------------------------------
      // Store initiative update
      // -----------------------------------------

      updates.push({
        _id: id,
        initiative: roll.total,
      });

      // -----------------------------------------
      // Chat message data
      // -----------------------------------------

      const messageData = foundry.utils.mergeObject(
        {
          speaker: ChatMessage.getSpeaker({
            actor,
            token: combatant.token,
            alias: combatant.name,
          }),

          flavor: game.i18n.format("COMBAT.RollsInitiative", {
            name: combatant.name,
          }),

          flags: {
            "core.initiativeRoll": true,
          },
        },
        messageOptions,
      );

      // -----------------------------------------
      // Create chat data
      // -----------------------------------------

      const chatData = await roll.toMessage(messageData, {
        create: false,
      });

      // -----------------------------------------
      // Roll mode
      // -----------------------------------------

      chatData.rollMode =
        "rollMode" in messageOptions
          ? messageOptions.rollMode
          : combatant.hidden
            ? CONST.DICE_ROLL_MODES.PRIVATE
            : chatRollMode;

      // -----------------------------------------
      // Only first roll makes sound
      // -----------------------------------------

      if (i > 0) {
        chatData.sound = null;
      }

      messages.push(chatData);
    }

    if (!updates.length) return this;

    // -----------------------------------------
    // Apply initiative updates
    // -----------------------------------------

    await this.updateEmbeddedDocuments("Combatant", updates);

    // -----------------------------------------
    // Preserve current turn
    // -----------------------------------------

    if (updateTurn && currentId) {
      await this.update({
        turn: this.turns.findIndex((t) => t.id === currentId),
      });
    }

    // -----------------------------------------
    // Create chat messages
    // -----------------------------------------

    await ChatMessage.implementation.create(messages);

    return this;
  }
}
