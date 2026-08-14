/**
 * Temporary Health granted by a defense roll.
 *
 * Two independent sources let a defender convert a defense into a small ward,
 * and they stack:
 *
 *   - Weapon Skill rank 4+ in the class of the weapon being defended with (+5).
 *   - Swordsman doctrine rank 3+, defending with a weapon that carries the
 *     swordsman doctrine flag (+5).
 *
 * The grant is never automatic. Melee and Ranged Defense cards get a gold
 * shield-heart button showing the amount; clicking it applies the temporary HP
 * and posts a public confirmation line so the table sees a misclick happen.
 * The button is one-shot: the click writes `consumed` back onto the message
 * flag, so it stays spent for every client and across a reload.
 *
 * Dodge and Magic defense deliberately have no button — the sources above are
 * both weapon-bound.
 */

/** Defense cards that may carry the button, keyed by `defenseKey`. */
const ELIGIBLE_DEFENSE_KEYS = new Set(["meleeDefense", "rangedDefense"]);

/** Temporary HP each qualifying source is worth. */
const GRANT_PER_SOURCE = 5;

/**
 * Ceiling on Temporary Health earned by defending.
 *
 * Deliberately far below the actor's Temporary Health pool max (50 + bonus):
 * defense grants are a small rolling ward, not a stockpile. Temporary HP handed
 * out by a feature, ability or spell writes the pool directly and is bound only
 * by the pool max, so it may sit above this line — a defender already over the
 * cap simply earns nothing more from defending until the pool drains back down.
 */
const DEFENSE_TEMP_HEALTH_CAP = 10;

/**
 * Resolve the weapon-skill entry that governs a weapon.
 *
 * Weapon classes are singular ("sword") while the skills are mostly plural
 * ("swords"), except "blunt" which matches straight across. Same pairing rule
 * as getWeaponSkillBonuses — kept in step with it deliberately.
 *
 * @param {Actor} actor
 * @param {Item}  weapon
 * @returns {object|null} The weapon-skill entry, or null when nothing matches.
 */
function getMatchingWeaponSkill(actor, weapon) {
  const weaponSkills = actor?.system?.weaponSkills;
  const className = weapon?.system?.class;
  if (!weaponSkills || !className) return null;

  for (const [skillName, skill] of Object.entries(weaponSkills)) {
    if (skillName === className || skillName === `${className}s`) return skill;
  }
  return null;
}

/**
 * How much temporary HP this actor may claim from a defense with this weapon.
 *
 * @param {Actor} actor
 * @param {Item}  weapon
 * @returns {{amount: number, sources: string[]}} Amount and the localized
 *   source labels shown in the button tooltip. `amount` is 0 when nothing
 *   qualifies, which is the signal to render no button at all.
 */
export function getDefenseTempHealth(actor, weapon) {
  const result = { amount: 0, sources: [] };
  // Weapon skills and doctrines are character-only data; NPCs get nothing,
  // exactly as they do from getDoctrineBonuses / getWeaponSkillBonuses.
  if (!actor || actor.type !== "character" || !weapon) return result;

  const weaponSkill = getMatchingWeaponSkill(actor, weapon);
  if (Number(weaponSkill?.value ?? 0) >= 4) {
    result.amount += GRANT_PER_SOURCE;
    result.sources.push(game.i18n.localize("REDSTEEL.TempHealth.SourceSkill"));
  }

  // The doctrine only pays out on a weapon that belongs to it, like every
  // other doctrine bonus in getDoctrineBonuses.
  const swordsmanWeapon = weapon.system?.doctrines?.swordsman === true;
  const swordsmanRank = Number(actor.system?.doctrines?.swordsman?.value ?? 0);
  if (swordsmanWeapon && swordsmanRank >= 3) {
    result.amount += GRANT_PER_SOURCE;
    result.sources.push(
      game.i18n.localize("REDSTEEL.TempHealth.SourceSwordsman"),
    );
  }

  return result;
}

/**
 * Build the chat-message flag payload for a defense card, or null when the
 * defender has no claim on temporary HP.
 *
 * @param {Actor}  actor
 * @param {Item}   weapon
 * @param {string} defenseKey  "meleeDefense" | "rangedDefense" | …
 * @returns {object|null}
 */
export function buildTempHealthGrantFlag(actor, weapon, defenseKey) {
  if (!ELIGIBLE_DEFENSE_KEYS.has(defenseKey)) return null;

  const { amount, sources } = getDefenseTempHealth(actor, weapon);
  if (amount <= 0) return null;

  return { amount, sources, actorUuid: actor.uuid, consumed: false };
}

/**
 * Apply the grant and post the public confirmation.
 *
 * @param {ChatMessage} message
 * @param {object}      grant  The `tempHealthGrant` flag payload.
 */
async function claimTempHealth(message, grant) {
  const actor = grant.actorUuid ? await fromUuid(grant.actorUuid) : null;
  if (!actor) {
    ui.notifications.warn(
      game.i18n.localize("REDSTEEL.TempHealth.ActorMissing"),
    );
    return;
  }

  const temp = actor.system.stats?.temporaryHealth;
  const current = Number(temp?.value ?? 0);
  // The pool max still wins if it is ever configured below the defense cap.
  const cap = Math.min(DEFENSE_TEMP_HEALTH_CAP, Number(temp?.max ?? 50));
  const next = Math.min(current + Number(grant.amount ?? 0), cap);
  const gained = next - current;

  // Already at or over the cap: nothing lands, so leave the button unspent —
  // the defender can claim it later once the ward has been chewed through.
  if (gained <= 0) {
    ui.notifications.info(
      game.i18n.format("REDSTEEL.TempHealth.AtCap", { max: cap }),
    );
    return;
  }

  // Burn the button first: a second click while the update is in flight would
  // otherwise grant twice.
  await message.setFlag("redsteel", "tempHealthGrant", {
    ...grant,
    consumed: true,
  });

  await actor.update({ "system.stats.temporaryHealth.value": next });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="rs-temp-hp-notice">
        <i class="fa-sharp fa-thin fa-shield-heart"></i>
        <span>${game.i18n.format("REDSTEEL.TempHealth.Granted", {
          name: actor.name,
          amount: gained,
        })}</span>
      </div>`,
  });

  // Capped out: say so rather than letting the card claim points that never
  // landed.
  if (gained < Number(grant.amount ?? 0)) {
    ui.notifications.info(
      game.i18n.format("REDSTEEL.TempHealth.Capped", { max: cap }),
    );
  }
}

/**
 * Inject the shield-heart button onto qualifying defense cards.
 */
export function registerTempHealthGrant() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const grant = message.flags?.redsteel?.tempHealthGrant;
    if (!grant?.amount) return;

    // Only the roller (or the GM) can spend it — the same gate the First Aid
    // buttons use, and the only two users allowed to write the message flag.
    const isController =
      game.user.id === message.author?.id || game.user.isGM;
    if (!isController) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    // The hook can fire more than once against the same element; never stack
    // two claim buttons on one card.
    if (buttonContainer.querySelector(".rs-temp-hp-button")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rs-temp-hp-button";
    button.innerHTML = `<i class="fa-sharp fa-thin fa-shield-heart"></i><span>+${grant.amount}</span>`;
    button.dataset.tooltip = [
      game.i18n.localize("REDSTEEL.TempHealth.ButtonTooltip"),
      ...(grant.sources ?? []),
    ].join("<br>");

    // The defense did not hold, so the claim is almost certainly not owed.
    // Dimmed rather than disabled: the table may still rule that it applies.
    if (grant.defenseFailed) button.classList.add("is-inert");

    if (grant.consumed) {
      button.disabled = true;
      button.classList.add("is-consumed");
      button.dataset.tooltip = game.i18n.localize(
        "REDSTEEL.TempHealth.AlreadyClaimed",
      );
    }

    buttonContainer.appendChild(button);

    const buttonCount = buttonContainer.querySelectorAll(
      "button, a.button",
    ).length;
    buttonContainer.classList.toggle("single", buttonCount <= 1);

    if (grant.consumed) return;

    button.addEventListener("click", async () => {
      button.disabled = true;
      button.classList.add("is-consumed");
      try {
        await claimTempHealth(message, grant);
      } catch (err) {
        console.error("REDSTEEL | Temporary Health grant failed", err);
        button.disabled = false;
        button.classList.remove("is-consumed");
      }
    });
  });
}
