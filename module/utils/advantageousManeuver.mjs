/**
 * Advantageous Maneuver (Výhodný manévr, Sword Dancer).
 *
 * Turning a blow aside with the duellist's blade opens the opponent up: a
 * successful Melee Defense may be spent on one Aim stack against the very token
 * that swung, for 3 Stamina.
 *
 * Never automatic. A qualifying defense card gets an amber crosshair button; the
 * click spends the Stamina, adds the stack and posts a public line so the table
 * sees what was bought. The button is one-shot — the click writes `consumed` back
 * onto the message flag, so it stays spent for every client and across a reload,
 * exactly like the Temporary Health claim it is modelled on.
 *
 * Everything the click touches (the defender's token flag, their Stamina, their
 * own chat card) belongs to the defender, so this runs on the clicking client
 * with no GM relay.
 *
 * Gates, all of them checked when the card is built rather than when it is
 * clicked, since that is when the weapon and the attacker are known facts:
 *   - Melee Defense only. A dodge is not a fencing maneuver.
 *   - The duellist's blade in hand (one-handed sword, off hand free or holding a
 *     fencing dagger) — the same gate every Aim perk on this tree reads.
 *   - An attacker the card can actually name. Answering a Defend button names it
 *     outright; a hotbar defense falls back to the newest attack card.
 * The defense also has to have held: the button is not rendered on a card whose
 * guard failed.
 */

import {
  grantManeuverAim,
  hasAdvantageousManeuver,
  previewManeuverAim,
} from "./aim.mjs";

/** Stamina the maneuver costs. */
const STAMINA_COST = 3;

/** Defense cards that may carry the button, keyed by `defenseKey`. */
const ELIGIBLE_DEFENSE_KEYS = new Set(["meleeDefense"]);

/**
 * Build the chat-message flag payload for a defense card, or null when this
 * defense cannot buy the maneuver.
 *
 * @param {object} opts
 * @param {Actor}  opts.actor            the defender
 * @param {TokenDocument|Token|null} opts.token  the defender's token (holds the aim)
 * @param {Item}   [opts.weapon]         weapon defended with — gates the perk
 * @param {object} [opts.context]        resolved weapon context (grip, off hand)
 * @param {string} [opts.attackerTokenId] the token being defended against
 * @param {string} [opts.defenseKey]     "meleeDefense" | "dodge" | …
 * @returns {object|null}
 */
export function buildManeuverFlag({
  actor,
  token,
  weapon = null,
  context = null,
  attackerTokenId = null,
  defenseKey = "meleeDefense",
} = {}) {
  if (!ELIGIBLE_DEFENSE_KEYS.has(defenseKey)) return null;
  if (!hasAdvantageousManeuver(actor, weapon, context)) return null;

  const defender = token?.document ?? token ?? null;
  if (!defender || !attackerTokenId) return null;

  // The attacker is looked up on the defender's own scene: the aim flag stores a
  // bare token id, which only means anything within one scene.
  const attacker = defender.parent?.tokens?.get(attackerTokenId) ?? null;
  if (!attacker || attacker.id === defender.id) return null;

  return {
    actorUuid: actor.uuid,
    aimerUuid: defender.uuid,
    targetUuid: attacker.uuid,
    targetName: attacker.name,
    cost: STAMINA_COST,
    consumed: false,
  };
}

/**
 * Spend the Stamina, add the stack, and post the public confirmation.
 *
 * @param {ChatMessage} message
 * @param {object}      offer  The `advantageousManeuver` flag payload.
 * @returns {Promise<boolean>} Whether the maneuver was actually bought.
 */
async function claimManeuver(message, offer) {
  const [actor, aimer, target] = await Promise.all([
    offer.actorUuid ? fromUuid(offer.actorUuid) : null,
    offer.aimerUuid ? fromUuid(offer.aimerUuid) : null,
    offer.targetUuid ? fromUuid(offer.targetUuid) : null,
  ]);

  if (!actor || !aimer || !target) {
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.Aim.ManeuverTokenMissing"),
    );
    return false;
  }

  // Already at full aim on this attacker: nothing to buy. Left unspent rather
  // than burnt, since the aim may well be spent before the button goes stale.
  if (previewManeuverAim(aimer, target).capped) {
    ui.notifications.info(game.i18n.localize("REDSTEEL.Aim.ManeuverCapped"));
    return false;
  }

  const cost = Number(offer.cost ?? STAMINA_COST);
  const stamina = Number(actor.system.stats?.stamina?.value ?? 0);
  if (stamina < cost) {
    ui.notifications.warn(
      game.i18n.format("REDSTEEL.Aim.ManeuverNoStamina", { cost }),
    );
    return false;
  }

  // Burn the button first: a second click while the updates are in flight would
  // otherwise pay twice.
  await message.setFlag("redsteel", "advantageousManeuver", {
    ...offer,
    consumed: true,
  });

  await actor.update({ "system.stats.stamina.value": stamina - cost });

  const { before, after } = await grantManeuverAim(aimer, target);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="rs-aim-maneuver-notice">
        <i class="fa-sharp fa-thin fa-crosshairs"></i>
        <span>${game.i18n.format("REDSTEEL.Aim.ManeuverBought", {
          name: actor.name,
          target: target.name,
          cost,
          after,
        })}</span>
      </div>`,
  });

  // Switching the aim off somebody else costs stacks. The numbers above already
  // say so, but a duellist who has just watched three stacks evaporate deserves
  // to be told to their face.
  if (before > 0 && after <= before) {
    ui.notifications.info(
      game.i18n.format("REDSTEEL.Aim.ManeuverSwitched", { before, after }),
    );
  }

  return true;
}

/**
 * Inject the crosshair button onto qualifying defense cards.
 */
export function registerAdvantageousManeuver() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const offer = message.flags?.redsteel?.advantageousManeuver;
    if (!offer?.aimerUuid) return;

    // The guard did not hold, so there is no opening to exploit. Hidden rather
    // than dimmed: unlike the Temporary Health claim, pressing this one spends
    // resources, so a card that cannot honour it should not offer it at all.
    if (offer.defenseFailed) return;

    // Only the roller (or the GM) can spend it — the same gate the Temporary
    // Health claim uses, and the only two users allowed to write the flag.
    const isController = game.user.id === message.author?.id || game.user.isGM;
    if (!isController) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    // The hook can fire more than once against the same element; never stack two
    // maneuver buttons on one card.
    if (buttonContainer.querySelector(".rs-aim-maneuver-button")) return;

    const cost = Number(offer.cost ?? STAMINA_COST);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rs-aim-maneuver-button";
    // The label is the name alone — the cost lives in the tooltip, where it does
    // not have to fit next to the other buttons on the card.
    button.innerHTML = `<i class="fa-sharp fa-thin fa-crosshairs"></i><span>${game.i18n.localize(
      "REDSTEEL.Aim.ManeuverButton",
    )}</span>`;
    button.dataset.tooltip = game.i18n.format("REDSTEEL.Aim.ManeuverTooltip", {
      target: offer.targetName ?? game.i18n.localize("REDSTEEL.Aim.UnknownTarget"),
      cost,
    });

    if (offer.consumed) {
      button.disabled = true;
      button.classList.add("is-consumed");
      button.dataset.tooltip = game.i18n.localize(
        "REDSTEEL.Aim.ManeuverAlreadyUsed",
      );
    }

    buttonContainer.appendChild(button);

    const buttonCount = buttonContainer.querySelectorAll(
      "button, a.button",
    ).length;
    buttonContainer.classList.toggle("single", buttonCount <= 1);

    if (offer.consumed) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.classList.add("is-consumed");
      try {
        // A refusal (capped aim, empty Stamina) leaves the offer standing, so
        // the button has to come back to life.
        const bought = await claimManeuver(message, offer);
        if (!bought) {
          button.disabled = false;
          button.classList.remove("is-consumed");
        }
      } catch (err) {
        console.error("REDSTEEL | Advantageous Maneuver failed", err);
        button.disabled = false;
        button.classList.remove("is-consumed");
      }
    });
  });
}
