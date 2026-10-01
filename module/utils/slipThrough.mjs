/**
 * Slip Through (Prosmýknutí, Servant of the Sword).
 *
 * "After a successful Charge, Lindar's Charge or Dragon Strike, call a
 * Dexterity versus Test. On success you move behind the opponent; on failure
 * you take -10% to Defense and Dodge for one turn. After a Critical Hit, Slip
 * Through always succeeds. Choose your facing after the move."
 *
 * - "Successful" = the hit landed: Apply Damage (applyDamage.mjs, on the GM)
 *   stamps the chance on the attacker with offerSlipThrough. Any charge
 *   (abilityMovement.mjs isCharge) and Dragon Strike count. Lindar's Charge
 *   is a Veneficus perk on movement spells, not an attack, and stays at the
 *   table for now (user ruling 2026-10-01).
 * - The hotbar offers a Slip Through chip for the rest of that turn
 *   (actionSuggestions.mjs). Using the ability, from the chip or the sheet,
 *   runs useSlipThrough instead of the plain Dexterity card.
 * - The versus Test is one fresh contest on the slipper's own client, both
 *   sides in one formula like Break Free (escapeFollowup.mjs): the slipper's
 *   Dexterity against the opponent's. A tie goes to the slipper, who called
 *   the test. A Critical Hit skips the roll.
 * - Success: the token is placed on the hex directly behind the opponent as
 *   seen from the slipper (or the nearest free one beside it), with no
 *   Opportunity Attack, and turned to face the opponent. The hotbar's rotate
 *   buttons then pick any other facing (user ruling 2026-10-01).
 * - Failure: the `slip_through_fail` status (config.mjs), -10% Defense and
 *   Dodge until the start of the slipper's next turn.
 */

import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";
import { versusTestBonus } from "./testRating.mjs";
import { renderVersusOutcome } from "./attributeFollowup.mjs";
import { teleportToken } from "./forcedMovement.mjs";
import { isCharge } from "./abilityMovement.mjs";

const SYSTEM_ID = "redsteel";
const FLAG = "slipThrough";
export const SLIP_THROUGH_KEY = "REDSTEEL.Items.SlipThrough.name";
const DRAGON_STRIKE_KEY = "REDSTEEL.Items.DragonsThrust.name";
export const SLIP_THROUGH_FAIL_STATUS = "slip_through_fail";

/** Rotation 0 faces south: the bearing a token looks along is rotation + 90. */
const FACING_OFFSET = 90;

/** Is this the Slip Through ability (by key, or the pack's English name)? */
export function isSlipThrough(ability) {
  return (
    ability?.system?.localizationKey === SLIP_THROUGH_KEY ||
    ability?.name === "Slip Through"
  );
}

/** Does this attack card open a Slip Through: a charge or Dragon Strike? */
function cardOpensSlipThrough(message) {
  const key = message?.flags?.redsteel?.abilityKey ?? null;
  const name = message?.flags?.redsteel?.abilityName ?? null;
  if (key === DRAGON_STRIKE_KEY || name === "Dragon Strike") return true;
  return isCharge({ name, system: { localizationKey: key } });
}

function turnStamp(combat) {
  return { id: combat.id, round: combat.round, turn: combat.turn };
}

/**
 * The Slip Through this actor may still make: stamped this very turn of the
 * running encounter, with the opponent still on the canvas. Null otherwise.
 *
 * @param {Actor} actor
 * @returns {{messageId: string, targetTokenId: string, critical: boolean,
 *   target: Token}|null}
 */
export function pendingSlipThrough(actor) {
  const stored = actor?.getFlag?.(SYSTEM_ID, FLAG);
  const combat = game.combat;
  if (!stored || !combat?.started) return null;
  const stamp = stored.combat ?? {};
  if (
    stamp.id !== combat.id ||
    Number(stamp.round) !== Number(combat.round) ||
    Number(stamp.turn) !== Number(combat.turn)
  ) {
    return null;
  }
  const target = canvas.tokens?.get(stored.targetTokenId);
  if (!target || target.actor?.statuses?.has("dead")) return null;
  return { ...stored, target };
}

/**
 * Apply Damage landed a charge or a Dragon Strike: the attacker may Slip
 * Through, against the first target hit. Runs on the GM client applying the
 * damage, which may write the attacker. Only for an attacker who has the
 * ability, in a started encounter.
 *
 * @param {Actor|null} attacker
 * @param {ChatMessage} message  the attack card
 * @param {string[]} targetIds   token ids the damage landed on
 * @param {string} mode          "normal" | "critical" | "breakthrough"
 */
export async function offerSlipThrough(attacker, message, targetIds, mode) {
  if (!attacker || !cardOpensSlipThrough(message)) return;
  const combat = game.combat;
  if (!combat?.started) return;
  if (!attacker.items.some((i) => i.type === "ability" && isSlipThrough(i))) return;
  const targetTokenId = targetIds?.[0];
  if (!targetTokenId) return;
  await attacker.setFlag(SYSTEM_ID, FLAG, {
    messageId: message.id,
    targetTokenId,
    critical: mode === "critical",
    combat: turnStamp(combat),
  });
}

/** The Dexterity a versus Test is rolled against, with its versus bonus. */
function dexRating(actor) {
  const attr = actor?.system?.attributes?.dex;
  return (Number(attr?.mod) || 0) + versusTestBonus(actor, "dex");
}

/**
 * Hexes next to the opponent, the one straight behind it (seen from the
 * slipper) first, then by how near they lie to that line. The slipper's own
 * hex is never one of them.
 */
function behindCandidates(token, target) {
  const grid = canvas.grid;
  const from = token.center;
  const to = target.center;
  const behind = Math.atan2(to.y - from.y, to.x - from.x);
  const own = grid.getOffset(from);
  return (grid.getAdjacentOffsets(grid.getOffset(to)) ?? [])
    .filter((o) => !(o.i === own.i && o.j === own.j))
    .map((o) => {
      const c = grid.getCenterPoint(o);
      const angle = Math.atan2(c.y - to.y, c.x - to.x);
      let delta = Math.abs(angle - behind);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      return { center: c, delta };
    })
    .sort((a, b) => a.delta - b.delta)
    .map((c) => c.center);
}

/**
 * Put the slipper behind the opponent and turn it to face them. Tries the hex
 * straight behind, then the two beside it; false when all three are taken.
 */
async function moveBehind(token, target) {
  const doc = token.document;
  const candidates = behindCandidates(token, target).slice(0, 3);
  for (const point of candidates) {
    if (!(await teleportToken(doc, point))) continue;
    const bearing =
      (Math.atan2(target.center.y - point.y, target.center.x - point.x) * 180) /
      Math.PI;
    const rotation = (((bearing - FACING_OFFSET) % 360) + 360) % 360;
    await doc.update({ rotation: Math.round(rotation / 60) * 60 % 360 });
    return true;
  }
  return false;
}

/**
 * Use Slip Through against the pending opponent. Returns false when nothing
 * is pending, so the caller runs the ability's plain card instead.
 *
 * @param {Actor} actor
 * @param {Item} ability
 * @returns {Promise<boolean>}
 */
export async function useSlipThrough(actor, ability) {
  const pending = pendingSlipThrough(actor);
  if (!pending) return false;
  const token = actor.isToken
    ? actor.token?.object
    : actor.getActiveTokens(false, false)?.[0];
  if (!token) return false;
  if (!(await game.redsteel.deductAbilityCost(actor, [ability]))) return true;
  await actor.unsetFlag(SYSTEM_ID, FLAG);

  const target = pending.target;
  const label = ability.localizedName ?? ability.name;
  const lines = [];
  let roll = null;
  let won = true;

  if (pending.critical) {
    lines.push(game.i18n.localize("REDSTEEL.SlipThrough.CriticalAuto"));
  } else {
    const mine = dexRating(actor);
    const theirs = dexRating(target.actor);
    roll = new Roll(`${mine} - 1d100 - (${theirs} - 1d100)`, withRollBias({}, actor));
    tagRollSkill(roll, "dex");
    await roll.evaluate();
    // A tie goes to the slipper, who called the test.
    won = roll.total >= 0;
    lines.push(renderVersusOutcome(roll.total));
  }

  if (won) {
    const moved = await moveBehind(token, target);
    lines.push(
      game.i18n.format(
        moved ? "REDSTEEL.SlipThrough.Moved" : "REDSTEEL.SlipThrough.Blocked",
        { name: actor.name, target: target.name },
      ),
    );
  } else {
    await game.redsteel.applyEffect(actor, SLIP_THROUGH_FAIL_STATUS);
    lines.push(
      game.i18n.format("REDSTEEL.SlipThrough.Failed", { name: actor.name }),
    );
  }

  const flavor = `<p class="rs-card-headline"><b>${label} vs ${foundry.utils.escapeHTML(
    target.name,
  )}</b></p>
${lines.map((l) => (l.startsWith("<p") ? l : `<p style="text-align:center;">${l}</p>`)).join("")}`;
  const speaker = ChatMessage.getSpeaker({ actor, token: token.document });
  if (roll) {
    await roll.toMessage({
      speaker,
      flavor,
      flags: { redsteel: { rollName: `${label} vs ${target.name}`, skill: "dex" } },
    });
  } else {
    await ChatMessage.create({ speaker, flavor });
  }
  return true;
}
