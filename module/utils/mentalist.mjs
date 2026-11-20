/**
 * Mentalist specialisation: the nodes that act around a cast rather than
 * inside it. Each is one call site in a shared file plus the code here.
 *
 * Source: docs/rules-source/rules/specializace-wip.md
 *   Mentální úder (mentalist `mentalniUder`): "Mentální úder: Zabití cíle
 *   obnoví 1 MŽ". A kill with the Mental strike spell gives the caster 1 Mind
 *   back, once per card.
 *
 *   Vytrvalá snaha (mentalist `vytrvalaSnaha`): "Jednou za kolo může vyčerpat
 *   jeden Mentální život a opakovat šanci na zahájení Mentálního souboje." A
 *   failed initiation roll may be thrown again for 1 Mind, once a round.
 *
 * Callers:
 *   - settleMentalStrikeKill: utils/applyDamage.mjs applyDamageAsGM, in the
 *     post-apply block beside offerIceShards. GM only, so the card's flag is
 *     written by the GM, the way mancerFollowups.mjs writes its own.
 *   - offerPersistentEffort: utils/castSpell.mjs maybeStartMentalDuel, after a
 *     failed initiation roll and before the voluntary acceptance request. Runs
 *     on the caster's client, which owns the caster.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { matchesPackSpell } from "../helpers/mancerSpells.mjs";

const SYSTEM_ID = "redsteel";

/** The pack spell Mental strike (Mentální úder). */
const MENTAL_STRIKE = { id: "FX5L3udPT0TM49af", name: "Mental strike" };

/** Flag on the spell card: its kill refund was already paid. */
const MENTAL_STRIKE_REFUNDED = "mentalStrikeRefunded";

/** Was the card a cast of Mental strike? */
function isMentalStrikeCard(caster, message) {
  const spellId = message?.flags?.redsteel?.spellId;
  if (!spellId) return false;
  const spell = caster?.items?.get?.(spellId) ?? null;
  // A scroll's spell is never embedded; it keeps the pack id it was cast as
  // (the same fallback as mancerFollowups.mjs isFirmStepSpellCard).
  if (!spell) return spellId === MENTAL_STRIKE.id;
  return matchesPackSpell(spell, MENTAL_STRIKE);
}

/**
 * Apply Damage landed a spell: when it was the holder's Mental strike and it
 * killed someone, the caster regains 1 Mind, clamped to the derived maximum.
 * Once per card, however many targets fell and however often the GM
 * re-applies it.
 *
 * @param {{caster: Actor|null, school: string|null}} castingContext  the
 *   card's casting context (applyDamage.mjs getCastingContext)
 * @param {ChatMessage} message  the spell card
 * @param {string[]} killedIds  token ids this Apply Damage killed
 */
export async function settleMentalStrikeKill(castingContext, message, killedIds = []) {
  if (!message || !killedIds?.length) return;
  const caster = castingContext?.caster ?? null;
  if (!caster || !actorHasSpecNode(caster, "mentalist", "mentalniUder")) return;
  if (!isMentalStrikeCard(caster, message)) return;
  if (message.getFlag(SYSTEM_ID, MENTAL_STRIKE_REFUNDED)) return;
  await message.setFlag(SYSTEM_ID, MENTAL_STRIKE_REFUNDED, true);

  const mind = caster.system?.stats?.mind ?? {};
  const before = Number(mind.value) || 0;
  const max = Number(mind.max) || 0;
  const after = Math.max(before, Math.min(max, before + 1));
  if (after !== before) {
    await caster.update({ "system.stats.mind.value": after });
  }

  const name = foundry.utils.escapeHTML(caster.name ?? "");
  const key =
    after > before
      ? "REDSTEEL.Mentalist.MentalStrike.Card"
      : "REDSTEEL.Mentalist.MentalStrike.CardFull";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<p class="rs-card-headline"><b>${foundry.utils.escapeHTML(
      game.i18n.localize("REDSTEEL.Mentalist.MentalStrike.Title"),
    )}</b></p>
<p style="text-align:center;">${game.i18n.format(key, { name })}</p>`,
  });
}

/* -------------------------------------------- */
/*  Vytrvalá snaha (Persistent Effort)          */
/* -------------------------------------------- */

/** Actor flag: the combat and round Persistent Effort was last used in. */
const PERSISTENT_EFFORT_FLAG = "persistentEffort";

/** Mind exhausted (not burned) for the reroll. */
const PERSISTENT_EFFORT_COST = 1;

/** True when the caster already used Persistent Effort this combat round. */
function persistentEffortUsedThisRound(actor) {
  const combat = game.combat;
  if (!combat?.started) return false;
  const used = actor.getFlag(SYSTEM_ID, PERSISTENT_EFFORT_FLAG);
  return used?.combat === combat.id && used?.round === combat.round;
}

/**
 * Offer Persistent Effort after a failed initiation roll: spend 1 Mind to roll
 * the initiation again against the same chance. Once a round inside a started
 * combat (stamped on the caster); outside combat the caller offers it at most
 * once per cast, so no stamp is needed there.
 *
 * The Mind is exhausted, a plain decrease of the current value; the maximum is
 * untouched (a burn would also lower it, see mindPoints.mjs).
 *
 * @param {Actor} actor  the caster
 * @param {number} chance  the initiation chance the reroll is thrown against
 * @returns {Promise<boolean>} true when the Mind was spent and the caller
 *   should roll again
 */
export async function offerPersistentEffort(actor, chance) {
  if (!actor || !actorHasSpecNode(actor, "mentalist", "vytrvalaSnaha")) {
    return false;
  }
  const mind = Number(actor.system?.stats?.mind?.value) || 0;
  if (mind < PERSISTENT_EFFORT_COST) return false;
  if (persistentEffortUsedThisRound(actor)) return false;

  const DialogV2 = foundry.applications.api.DialogV2;
  const answer = await DialogV2.wait({
    window: {
      title: game.i18n.localize("REDSTEEL.Mentalist.PersistentEffort.Title"),
    },
    content: `
      <p style="margin-top:0;">
        ${game.i18n.format("REDSTEEL.Mentalist.PersistentEffort.Intro", {
          chance,
          mind,
        })}
      </p>`,
    buttons: [
      {
        action: "reroll",
        label: game.i18n.format("REDSTEEL.Mentalist.PersistentEffort.Reroll", {
          chance,
        }),
        icon: "fas fa-brain",
        default: true,
      },
      {
        action: "skip",
        label: game.i18n.localize("REDSTEEL.Mentalist.PersistentEffort.Skip"),
      },
    ],
    rejectClose: false,
  });
  if (answer !== "reroll") return false;

  // Re-read: the Mind may have moved while the dialog was open.
  const now = Number(actor.system?.stats?.mind?.value) || 0;
  if (now < PERSISTENT_EFFORT_COST) return false;
  await actor.update({
    "system.stats.mind.value": Math.max(0, now - PERSISTENT_EFFORT_COST),
  });

  const combat = game.combat;
  if (combat?.started) {
    await actor.setFlag(SYSTEM_ID, PERSISTENT_EFFORT_FLAG, {
      combat: combat.id,
      round: combat.round,
    });
  }
  return true;
}
