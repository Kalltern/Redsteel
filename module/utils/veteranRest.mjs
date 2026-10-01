/**
 * Mistr zbraní → Veterán I / II: the free Rest.
 *
 * Both nodes pay out the Rest action's 5 Stamina as a Free action:
 *   - Veterán I: "Při Kritickém zásahu může snížit stupeň Kritického zásahu o
 *     jeden, aby mohl ihned použít Oddech jako Volnou akci." Taken in the Apply
 *     Damage dialog (applyDamage.mjs), which calls {@link grantFreeRest}.
 *   - Veterán II: "Při Kritické obraně může místo získání Dočasných životů
 *     okamžitě použít akci Oddech jako Volnou akci." A "Free rest" button on
 *     the defense card, built from the `veteranRest` flag stamped in
 *     defense.mjs.
 *
 * "Instead of Temporary Health": when the card also carries the Temporary
 * Health claim (tempHealthGrant.mjs), spending either one spends both. Both
 * flags are written together onto the message, so the choice survives a
 * reload and reads the same on every client.
 *
 * Imports nothing from defense.mjs or tempHealthGrant.mjs, so both may import
 * from here without a cycle.
 */

import { hasWeaponMasterNode } from "./weaponMaster.mjs";

/** Stamina one Rest restores: the Rest action's amount (otherActions.mjs). */
export const REST_STAMINA = 5;

/**
 * Give the actor one Rest's worth of Stamina, clamped at the pool max the way
 * Dragon Sleep's free Rests are. Returns the Stamina actually gained.
 *
 * @param {Actor} actor
 * @returns {Promise<number>}
 */
export async function grantFreeRest(actor) {
  if (!actor) return 0;
  const stamina = actor.system.stats?.stamina ?? {};
  const current = Number(stamina.value) || 0;
  const max = Number(stamina.max);
  const next =
    Number.isFinite(max) && max > 0
      ? Math.min(max, current + REST_STAMINA)
      : current + REST_STAMINA;
  if (next !== current) {
    await actor.update({ "system.stats.stamina.value": next });
  }
  return next - current;
}

/**
 * The `veteranRest` flag for a defense card that was a Critical Defense, or
 * null when the defender does not have Veterán II.
 *
 * @param {Actor} actor  the defender
 * @returns {{actorUuid: string, consumed: boolean}|null}
 */
export function buildVeteranRestFlag(actor) {
  if (!hasWeaponMasterNode(actor, "veteran2")) return null;
  return { actorUuid: actor.uuid, consumed: false };
}

/**
 * The message update that spends the card's Rest-or-Temporary-Health choice:
 * both claims, whichever of them the card carries.
 *
 * @param {ChatMessage} message
 * @returns {object}
 */
export function consumeRestOrTempHealthUpdate(message) {
  const update = {};
  if (message.flags?.redsteel?.veteranRest) {
    update["flags.redsteel.veteranRest.consumed"] = true;
  }
  if (message.flags?.redsteel?.tempHealthGrant) {
    update["flags.redsteel.tempHealthGrant.consumed"] = true;
  }
  return update;
}

/**
 * Spend the claim and pay the Rest, with a public line so the table sees it.
 *
 * @param {ChatMessage} message
 * @param {object} claim  the `veteranRest` flag payload
 */
async function claimVeteranRest(message, claim) {
  const actor = claim.actorUuid ? await fromUuid(claim.actorUuid) : null;
  if (!actor) {
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.VeteranRest.ActorMissing"),
    );
    return;
  }

  // Burn the button (and the Temporary Health one with it) first: a second
  // click while the update is in flight would otherwise pay twice.
  await message.update(consumeRestOrTempHealthUpdate(message));

  const gained = await grantFreeRest(actor);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="rs-temp-hp-notice">
        <img src="icons/sundries/flags/banner-sword-blue.webp" width="20" height="20" style="border:none;">
        <span>${game.i18n.format("REDSTEEL.VeteranRest.Granted", {
          name: foundry.utils.escapeHTML(actor.name),
          amount: gained,
        })}</span>
      </div>`,
  });
}

/**
 * Inject the "Free rest" button onto defense cards carrying `veteranRest`.
 * Called from registerTempHealthGrant, after its own hook, so the Temporary
 * Health button keeps its place on the card and this one sits beside it.
 */
export function registerVeteranRestButton() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const claim = message.flags?.redsteel?.veteranRest;
    if (!claim?.actorUuid) return;

    // The defender's owner or the GM. The roller (author) is the one allowed
    // to write the message flag besides the GM, so ownership alone is not
    // enough: a co-owner who did not roll could not spend it.
    const actor = fromUuidSync(claim.actorUuid);
    const isController =
      game.user.isGM ||
      (game.user.id === message.author?.id && !!actor?.isOwner);
    if (!isController) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    // The hook can fire more than once against the same element.
    if (buttonContainer.querySelector(".rs-veteran-rest-button")) return;

    const button = document.createElement("button");
    button.type = "button";
    // Styled as the Temporary Health button (css/redsteel.css), with its own
    // class so neither hook mistakes one button for the other.
    button.className = "rs-temp-hp-button rs-veteran-rest-button";
    button.innerHTML = `<span>${game.i18n.localize(
      "REDSTEEL.VeteranRest.Button",
    )}</span>`;
    button.dataset.tooltip = game.i18n.format(
      "REDSTEEL.VeteranRest.Tooltip",
      { amount: REST_STAMINA },
    );

    if (claim.consumed) {
      button.disabled = true;
      button.classList.add("is-consumed");
      button.dataset.tooltip = game.i18n.localize(
        "REDSTEEL.VeteranRest.AlreadyUsed",
      );
    }

    buttonContainer.appendChild(button);

    const buttonCount = buttonContainer.querySelectorAll(
      "button, a.button",
    ).length;
    buttonContainer.classList.toggle("single", buttonCount <= 1);

    if (claim.consumed) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.classList.add("is-consumed");
      try {
        await claimVeteranRest(message, claim);
      } catch (err) {
        console.error("REDSTEEL | Veteran free Rest failed", err);
        button.disabled = false;
        button.classList.remove("is-consumed");
      }
    });
  });
}
