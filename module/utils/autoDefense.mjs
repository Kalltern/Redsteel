import {
  autoDefenseLongReachPenalty,
  buildDefenseProfile,
  defenseRoll,
} from "./defense.mjs";
import { defenseWinChance } from "./defenseOdds.mjs";
import {
  attackerTokenIdFromMessage,
  getOverwhelmSources,
  isOverwhelmTracked,
  stacksFromSources,
} from "./overwhelm.mjs";
import { getRollBias, withRollBias } from "./rollAdvantage.mjs";

/**
 * NPC auto-defense: an attack card posted against a targeted NPC answers itself.
 *
 * The GM's hands are the bottleneck in a fight — every blow at an NPC is a
 * Defend click before the table learns anything. An NPC with `system.autoDefense`
 * set rolls its own best defense the moment the attack card lands, so the versus
 * line is already on the card by the time anyone reads it. It is a per-actor
 * toggle rather than a world setting precisely because the exceptions are real:
 * an NPC that is surrendering, bound, or being coup-de-grâced gets the switch
 * flipped off and the GM takes the wheel back.
 *
 * Two facts are load-bearing and both come off the attack card:
 *
 * 1. *Who was attacked* — the attacker's targets, captured into
 *    `flags.attack.targets` at card creation (see {@link captureAttackTargets}).
 *    An attack thrown without targeting anything auto-defends nobody, which is
 *    the honest answer: nothing on the card says who was swung at.
 * 2. *What kind of attack* — `flags.attack.attackType`, because a bolt and a
 *    sword are not answered by the same skill.
 */

/** Must match the cost `dodgeDefense` actually deducts in defense.mjs. */
const DODGE_STAMINA_COST = 4;

/** The classes the melee-defense weapon dialog offers, so auto picks the same pool. */
const MELEE_CLASSES = ["axe", "sword", "blunt", "polearm"];

/**
 * A defender in one of these states is not parrying anything, and rolling for
 * it would quietly spend their stamina and their Overwhelm slot. The GM finishes
 * these by hand.
 */
const BLOCKING_STATUSES = ["dying", "downed", "incapacitated", "dead"];

/**
 * Token ids the attacking user had targeted, for the card being posted.
 *
 * Read on the attacker's client at card-creation time — targets are per-user and
 * live, so this is the only moment the information exists. Every attack card
 * that can be defended against stores it.
 *
 * @returns {string[]}
 */
export function captureAttackTargets() {
  return [...(game.user?.targets ?? [])].map((t) => t?.id).filter(Boolean);
}

/**
 * Which defense skill answers this attack.
 *
 * Ranged, thrown and direct magic are all answered by Ranged Defense or a dodge;
 * everything else is a melee exchange. An older card with no `attackType` reads
 * as melee, which is what the overwhelming majority of them were.
 *
 * @param {string|null|undefined} attackType
 * @returns {"melee"|"ranged"}
 */
export function defenseCategory(attackType) {
  return ["ranged", "throwing", "magic"].includes(attackType)
    ? "ranged"
    : "melee";
}

/* -------------------------------------------- */
/*  PICKING THE BEST DEFENSE                    */
/* -------------------------------------------- */

const weaponsOf = (actor) => actor.items.filter((i) => i.type === "weapon");

/**
 * The weapons that may *lead* a defense. An NPC's off-hand weapon is folded in
 * automatically by `resolveWeaponContext` (through its off-hand properties, not
 * its main-hand stats), so offering it here would both double-count it and roll
 * it with the wrong column. An NPC whose only weapon is flagged as the off-hand
 * still gets to use it rather than being left with nothing.
 */
function candidateWeapons(actor) {
  const weapons = weaponsOf(actor);
  const main = weapons.filter((w) => w.system?.npcOffhand !== true);
  return main.length ? main : weapons;
}

const meleeWeaponsOf = (actor) =>
  candidateWeapons(actor).filter(
    (w) => MELEE_CLASSES.includes(w.system?.class) && w.system?.thrown !== true,
  );

/** What a weapon adds to a parry. NPCs pick this up at roll time, so it counts here. */
const weaponDefenseValue = (weapon) =>
  (Number(weapon?.system?.defense) || 0) +
  (Number(weapon?.system?.qualityMods?.defense) || 0) +
  (Number(weapon?.system?.enchantMods?.defense) || 0);

/**
 * The weapon a card should be drawn with when the roll itself does not care
 * which one it is (Ranged Defense reads nothing off the weapon, but the card
 * still shows one). The off-hand is skipped: `resolveWeaponContext` picks that
 * up on its own, and showing it as the main weapon reads as an error.
 */
function mainWeapon(actor) {
  const pool = candidateWeapons(actor);
  if (!pool.length) return null;

  return pool.reduce((best, w) =>
    weaponDefenseValue(w) > weaponDefenseValue(best) ? w : best,
  );
}

/**
 * The defense this NPC is most likely to make hold against the blow already on
 * the card, as `{mode, weapon, score}`.
 *
 * Every legal (defense, weapon) pair is scored and the best one wins, rather
 * than picking a weapon first and a defense after — a shield is a better parry
 * than the sword next to it, and the point of the toggle is that the GM does not
 * have to notice that.
 *
 * The score is the exact chance, out of 10000, that this defense wins the
 * versus Test against *this* attack (defenseOdds.mjs → defenseWinChance). The
 * attack is already rolled, so its margin and crit flags are facts, not
 * averages, and each option is scored with the numbers its real roll would be
 * made of (defense.mjs → buildDefenseProfile): Overwhelm as it will stand once
 * this attacker is recorded, the Long Reach penalty, the NPC's own advantage
 * bias, crit thresholds and, for a dodge, the Bad Dodge limit. A higher rating
 * is therefore not automatically better: a dodge whose limit throws away the
 * dice it would need scores only for the dice it can still win on, and against
 * a blow that is already a critical hit only a natural critical defense counts.
 * Those rules are not linear in the rating, which is also why Overwhelm has to
 * be counted even though it lands on every option alike.
 *
 * Nothing is written while scoring: the Overwhelm projection reads the record
 * and adds the attacker in memory only. The roll itself commits it.
 *
 * A dodge that cannot be paid for is not an option at all.
 *
 * @param {Actor} actor
 * @param {"melee"|"ranged"} category
 * @param {object} params
 * @param {object} params.attack  the rolled attack, as resolveAutoDefense builds it
 * @param {TokenDocument} params.defenderToken
 * @param {string|null} params.attackerTokenId
 * @returns {Promise<{mode: "melee"|"ranged"|"dodge", weapon: Item, score: number}|null>}
 */
export async function pickBestDefense(
  actor,
  category,
  { attack, defenderToken = null, attackerTokenId = null } = {},
) {
  // Every defense path builds its card around a weapon, so an NPC with none has
  // no automatic answer to give.
  if (!weaponsOf(actor).length) return null;

  const candidates = [];

  const stamina = Number(actor.system?.stats?.stamina?.value) || 0;
  if (stamina >= DODGE_STAMINA_COST) {
    for (const weapon of candidateWeapons(actor)) {
      candidates.push({ mode: "dodge", weapon });
    }
  }

  if (category === "melee") {
    for (const weapon of meleeWeaponsOf(actor)) {
      candidates.push({ mode: "melee", weapon });
    }
  } else {
    const weapon = mainWeapon(actor);
    if (weapon) candidates.push({ mode: "ranged", weapon });
  }

  if (!candidates.length) return null;

  // Overwhelm as it will stand after this defense records the attacker — the
  // same projection the defense dialog shows, read without writing.
  let overwhelmStacks = 0;
  if (isOverwhelmTracked()) {
    const sources = getOverwhelmSources(defenderToken);
    if (
      attackerTokenId &&
      attackerTokenId !== defenderToken?.id &&
      !sources.includes(attackerTokenId)
    ) {
      sources.push(attackerTokenId);
    }
    overwhelmStacks = stacksFromSources(sources);
  }

  // Same for every parry, so read once. Only the melee roll takes it.
  const longReachPenalty =
    category === "melee"
      ? autoDefenseLongReachPenalty(actor, defenderToken, attackerTokenId)
      : 0;

  // The actor's buckets exactly as the roll layer will see them.
  const biasData = withRollBias({}, actor);

  const options = [];
  for (const { mode, weapon } of candidates) {
    const context = game.redsteel.resolveWeaponContext(actor, null, weapon);
    if (!context) continue;

    const profile = await buildDefenseProfile({
      actor,
      mode,
      context,
      defenderToken,
      attackerTokenId,
      overwhelmStacks,
      longReachPenalty: mode === "melee" ? longReachPenalty : 0,
    });
    const bias = getRollBias(biasData, profile.skillKey);

    options.push({
      mode,
      weapon,
      score: defenseWinChance(profile, attack, bias),
    });
  }

  if (!options.length) return null;

  console.debug(
    "Redsteel | auto-defense odds",
    defenderToken?.name ?? actor.name,
    options.map(({ mode, weapon, score }) => ({
      mode,
      weapon: weapon.name,
      pct: score / 100,
    })),
  );

  // Ties go to the option that costs nothing: an equal dodge is a worse deal
  // than a parry, because it is paid for in stamina. Any other tie keeps the
  // first option listed.
  return options.reduce((best, option) => {
    if (option.score !== best.score) {
      return option.score > best.score ? option : best;
    }
    if (best.mode === "dodge" && option.mode !== "dodge") return option;
    return best;
  });
}

/* -------------------------------------------- */
/*  RESOLUTION                                  */
/* -------------------------------------------- */

/**
 * Is this actor set to answer attacks on its own?
 *
 * On by default, and read as "on unless explicitly switched off" rather than
 * as "on when the field says true". Two reasons, and the second is the load-
 * bearing one:
 *
 * - answering for itself is what an NPC should do; the exceptions listed above
 *   are the rare case, so the switch is there to turn the behaviour *off*;
 * - every NPC that predates this field has no `autoDefense` key stored at all.
 *   A `true` default in template.json only reaches documents created after it,
 *   so testing `=== true` would leave an existing bestiary silently opted out
 *   while the sheet claimed otherwise. `!== false` covers both.
 *
 * Anything reading this state for display must use the same test — see the
 * hotbar chip and the NPC sheet checkbox.
 */
function autoDefends(actor) {
  return actor?.type === "npc" && actor.system?.autoDefense !== false;
}

/**
 * Roll a defense for every auto-defending NPC this attack card was aimed at.
 *
 * Sequential on purpose: each defense writes the attacker into the defender's
 * Overwhelm record, and two of them racing on the same token would lose one of
 * the writes.
 *
 * @param {ChatMessage} message
 */
export async function resolveAutoDefense(message) {
  const flag = message.flags?.attack;
  if (flag?.type !== "attack") return;

  // A versus Test is answered by clicking the margin, not by a defense roll —
  // the same reason the Defend button stays off those cards.
  if (flag.contested) return;

  // A rerolled attack is the same blow with a different die. The defense that
  // already answered it is rerolled from its own card; rolling a second one here
  // would defend twice against one attack.
  if (flag.suppressAutoDefense) return;

  // A fumble is blocked by the versus rules whatever the defender rolls, so the
  // roll can only cost them stamina and an Overwhelm slot for nothing.
  if (flag.criticalFailure === true) return;

  const targets = [...new Set(flag.targets ?? [])];
  if (!targets.length) return;

  const scene =
    game.scenes?.get(message.speaker?.scene) ?? game.scenes?.current ?? null;
  if (!scene) return;

  const attackerTokenId = attackerTokenIdFromMessage(message);

  // The margin this defense is answering. A card that stores the key is
  // believed even when it says null — that is an uncontested cast that never
  // rolled — while `rolls[0]` is the fallback for cards predating the flag,
  // where the first roll is the attack roll.
  const margin =
    "margin" in flag ? flag.margin : (message.rolls?.[0]?.total ?? null);

  // Nothing to contest means nothing to answer: an automatic defense here would
  // post a card with no versus line and charge the NPC stamina for it.
  if (!Number.isFinite(Number(margin))) return;

  // Same shape the Defend button hands over. The crit flags matter because
  // natural criticals outrank the margins.
  const attack = {
    margin: Number(margin),
    criticalSuccess: flag.criticalSuccess === true,
    criticalFailure: flag.criticalFailure === true,
    d100: flag.d100 ?? null,
    spellSchool: message.flags?.redsteel?.spellSchool ?? null,
    // Where each target stood when the blow was thrown (utils/positioning.mjs).
    positioning: flag.positioning ?? null,
    // Tulák IX's lowered critical threshold on a Weak Spot action, if any.
    criticalGap: flag.criticalGap ?? null,
  };

  const category = defenseCategory(flag.attackType);

  for (const tokenId of targets) {
    if (tokenId === attackerTokenId) continue;

    const tokenDoc = scene.tokens.get(tokenId);
    const actor = tokenDoc?.actor;
    if (!actor || !autoDefends(actor)) continue;

    if (BLOCKING_STATUSES.some((status) => actor.statuses?.has(status))) {
      continue;
    }

    // No weapon to defend with, or nothing left to pay a dodge with. Said out
    // loud rather than passed over: the GM is counting on this NPC to answer
    // for itself, and silence would read as "the attack missed".
    const choice = await pickBestDefense(actor, category, {
      attack,
      defenderToken: tokenDoc,
      attackerTokenId,
    });
    if (!choice) {
      ui.notifications.warn(
        game.i18n.format("REDSTEEL.AutoDefense.NoOption", {
          name: tokenDoc.name,
        }),
      );
      continue;
    }

    await defenseRoll({
      actor,
      token: tokenDoc,
      weapon: choice.weapon,
      attackerTokenId,
      attack,
      auto: choice.mode,
    });
  }
}

/**
 * Watch every attack card for targets that answer themselves.
 *
 * Active-GM only, mirroring the Overwhelm and Aim sweeps: the hook fires on
 * every connected client, and NPC defenses must be rolled once rather than once
 * per logged-in user.
 */
export function registerAutoDefense() {
  Hooks.on("createChatMessage", async (message) => {
    if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;

    try {
      await resolveAutoDefense(message);
    } catch (error) {
      console.error("Redsteel | auto-defense failed", error);
    }
  });
}
