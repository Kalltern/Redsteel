/**
 * Obrnění (Armoring). Rulebook, ruzne-info.md r202 (Bojové akce): "Obrnění ·
 * 1 akce · 10 výdrže · Získá 10 Dočasných životů. Chrání pouze před zásahy ze
 * Souboje a Střelby. Takto lze Dočasné životy zvýšit maximálně na 10."
 * Granted by Štítonoš IX (abilityGrants.mjs).
 *
 * Temporary Health already comes in two pools (combatSkillBonuses.mjs
 * applyToHp): `system.stats.temporaryHealth` is drained only by physical
 * packets, which is every weapon hit, and `temporaryHealthMagic` only by
 * magical ones. "Only against Melee and Shooting hits" is the physical pool,
 * so Armoring writes there and needs no marker of its own. The cap is the
 * book's "raise to at most N": the pool rises by `amount` but never past
 * `cap`, and a pool already at or over `cap` gains nothing (ruzne-info.md
 * r475, sources add up but never past the limit each source sets).
 *
 * grantArmoring is shared with Vylepšené obrnění (Improved Armoring, Warden
 * `vylObrneni`: 15, up to 15, may target an adjacent ally), so it can write an
 * actor this client does not own through the active GM (socket
 * `wardenArmoring`).
 */

const SOCKET = "system.redsteel";
const SOCKET_TYPE = "wardenArmoring";

/** Obrnění, by localisation key. */
export const ARMORING_KEY = "REDSTEEL.Items.Armoring.name";
/** "Získá 10 Dočasných životů ... maximálně na 10." */
export const ARMORING_AMOUNT = 10;
export const ARMORING_CAP = 10;

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** Is this the Armoring ability (by key, or the pack's English name)? */
export function isArmoring(ability) {
  return (
    ability?.system?.localizationKey === ARMORING_KEY ||
    ability?.name === "Armoring"
  );
}

/**
 * Raise a target's physical Temporary Health by `amount`, never past `cap`
 * (nor past the pool's own max). Posts the result line.
 *
 * @param {Actor} actor  who uses the ability (the speaker of the line)
 * @param {object} options
 * @param {number} options.amount
 * @param {number} options.cap
 * @param {Actor|null} [options.targetActor]  defaults to `actor`
 * @returns {Promise<number>} Temporary Health gained (0 when at the cap or
 *   relayed to the GM)
 */
export async function grantArmoring(
  actor,
  { amount = ARMORING_AMOUNT, cap = ARMORING_CAP, targetActor = null } = {},
) {
  const target = targetActor ?? actor;
  if (!target) return 0;
  if (!target.isOwner) {
    if (!game.users.activeGM) {
      ui.notifications.warn(game.i18n.localize("REDSTEEL.Warden.ArmoringNoGM"));
      return 0;
    }
    game.socket.emit(SOCKET, {
      type: SOCKET_TYPE,
      actorUuid: actor?.uuid ?? null,
      targetUuid: target.uuid,
      amount,
      cap,
    });
    return 0;
  }
  return applyArmoring(actor, target, amount, cap);
}

async function applyArmoring(actor, target, amount, cap) {
  const pool = target.system?.stats?.temporaryHealth;
  if (!pool) return 0;
  const current = Math.max(0, Number(pool.value) || 0);
  const ceiling = Math.min(Number(cap) || 0, Number(pool.max ?? 50) || 0);
  const next = Math.max(current, Math.min(current + (Number(amount) || 0), ceiling));
  const gained = next - current;
  const name = esc(target.name);

  if (gained <= 0) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actor ?? target }),
      content: `<div style="text-align:center;">${game.i18n.format(
        "REDSTEEL.Warden.ArmoringAtCap",
        { name, max: ceiling },
      )}</div>`,
    });
    return 0;
  }

  await target.update({ "system.stats.temporaryHealth.value": next });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: actor ?? target }),
    content: `
      <div class="rs-temp-hp-notice">
        <i class="fa-sharp fa-thin fa-shield-heart"></i>
        <span>${game.i18n.format("REDSTEEL.TempHealth.Granted", {
          name,
          amount: gained,
        })}</span>
      </div>`,
  });
  return gained;
}

/** Armoring itself: 10, up to 10, on the user. Paid by the caller. */
export async function useArmoring(actor, _ability) {
  return grantArmoring(actor, {
    amount: ARMORING_AMOUNT,
    cap: ARMORING_CAP,
  });
}

/** The GM end of a grant to an actor the user does not own. */
export function registerArmoringHooks() {
  Hooks.once("ready", () => {
    game.socket.on(SOCKET, async (data) => {
      if (data?.type !== SOCKET_TYPE) return;
      if (!game.users.activeGM?.isSelf) return;
      try {
        const target = await fromUuid(data.targetUuid ?? "");
        const actor = data.actorUuid ? await fromUuid(data.actorUuid) : null;
        if (target) await applyArmoring(actor, target, data.amount, data.cap);
      } catch (err) {
        console.error("Redsteel | Armoring relay failed", err);
      }
    });
  });
}
