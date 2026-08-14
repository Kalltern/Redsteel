import {
  buildSpeedTestFormula,
  tagSpeedTest,
} from "../utils/speedTest.mjs";
import {
  collectRoundEntry,
  openRoundDigest,
  finishRoundDigest,
} from "../utils/roundDigest.mjs";

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

    // Rolling for the whole tracker at once — "Roll All" at combat start, or
    // the dynamic-initiative reroll — is exactly the burst the round card
    // exists to absorb, so open one if the rollover has not already. Rolling a
    // single combatant from the tracker mid-round is left alone: that is one
    // message, and it should read as its own.
    // GM-gated: the round card speaks for the table, so a player who happens to
    // own two PCs must not be the one posting it.
    const openedDigest =
      game.user.isGM && ids.length > 1 && openRoundDigest(this.round || 1);

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
      // Round digest
      // -----------------------------------------
      // During a round rollover the digest swallows every initiative roll and
      // posts them as one card. Turn order is public: only a combatant hidden
      // in the tracker goes to the card's GM-only section, since showing it
      // would announce an enemy the table has not seen yet. The GM's chat roll
      // mode deliberately does NOT route this — leaving that dropdown on
      // "Private GM Roll" would otherwise hide the whole turn order from the
      // players. Outside a rollover (a single combatant rerolled from the
      // tracker) the digest is closed and the message below is posted as
      // before, roll mode and all.

      const rollMode =
        "rollMode" in messageOptions
          ? messageOptions.rollMode
          : combatant.hidden
            ? CONST.DICE_ROLL_MODES.PRIVATE
            : chatRollMode;

      const collected = collectRoundEntry(actor, {
        kind: "initiative",
        label: game.i18n.localize("REDSTEEL.RoundDigest.Initiative"),
        roll,
        initiative: roll.total,
        // `img`/`name` are schema fields that may sit empty on a combatant the
        // tracker fills in from the token — fall through rather than render a
        // broken portrait.
        name: combatant.name || combatant.token?.name || actor.name,
        img: combatant.img || combatant.token?.texture?.src || actor.img,
        gm: !!combatant.hidden,
      });

      if (collected) continue;

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

      chatData.rollMode = rollMode;

      // -----------------------------------------
      // Only first roll makes sound
      // -----------------------------------------

      if (i > 0) {
        chatData.sound = null;
      }

      messages.push(chatData);
    }

    if (!updates.length) {
      if (openedDigest) finishRoundDigest();
      return this;
    }

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

    // Empty whenever the digest took every roll.
    if (messages.length) await ChatMessage.implementation.create(messages);

    // Only close what this call opened. When the rollover opened it, the
    // round-start handler still has its effect ticks to add.
    if (openedDigest) finishRoundDigest();

    return this;
  }
}
