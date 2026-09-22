/**
 * Sneak Attack triggers (Zákeřný útok) — the situations that promote a hit.
 *
 * The base action is a free action worth +1d6 that a player declares, and the
 * allowance it spends is utils/sneakLedger.mjs: once per victim per round,
 * however many blows land. None of that is this file's business.
 *
 * This file is the growing list of "after a hit, X counts as a Sneak Attack"
 * clauses — Rogue II's condition list, Rogue V, Rogue IX, the Exploit Weakness
 * ruling, and the two Shadow nodes. Every one of them is the same shape as the
 * critAsSneak promotion that already existed, and they are resolved the same
 * way and for the same reason:
 *
 *   **A trigger is a question about the TARGET, answered when the blow lands.**
 *
 * Not at roll time. At roll time a cleave has not yet picked which of three
 * people it caught, the defense roll has not yet decided whether the blow was
 * critical, and nobody has been knocked prone by it. So the attack card carries
 * only what the ATTACKER is capable of — the trigger keys their doctrine, nodes
 * and chosen action unlock — and utils/applyDamage.mjs evaluates them against
 * each victim as it applies damage, inside the same loop that spends the
 * allowance.
 *
 * Two consequences worth stating plainly.
 *
 * A. A promoted sneak costs the victim's allowance exactly as a declared one
 *    does, and is refused when that allowance is already spent. A Rogue cannot
 *    sneak the same guard twice in a round by finding a second reason.
 *
 * B. Triggers never stack. Three of them being true is still one Sneak Attack.
 *    The first match in SNEAK_TRIGGERS order is the one reported, which is why
 *    the list is ordered from most specific to most incidental: it decides only
 *    which reason the chat card names, never how much damage is dealt.
 *
 * Přesila is read as the system already defines it everywhere else: the
 * attackers this target has *defended against* this round (utils/overwhelm.mjs).
 * A victim that never defends is therefore never outnumbered, which is the
 * same rule the -5/-10 defense penalty follows.
 */

import { ruleActive } from "./abilityGrants.mjs";
import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { SECTOR, areAdjacent, attackSector } from "./positioning.mjs";
import { isWeakSpotAttack } from "./weakSpot.mjs";
import { getOverwhelmSources } from "./overwhelm.mjs";

/** Shorthand for a Rogue doctrine gate. */
const ROGUE = (min) => ({ when: { kind: "doctrine", key: "rogue", min } });

/** Shorthand for a specialisation node gate. */
const NODE = (spec, node) => ({ spec, node });

/**
 * Every promotion clause, most specific first.
 *
 * `capability` says whether the attacker owns the clause at all, and is checked
 * once at roll time. `test` says whether it fired against this particular
 * victim, and is checked at apply time against a context object. A clause with
 * `status` is sugar for "the target carries this status effect".
 *
 * `weakSpot: true` additionally requires the attack in progress to be an
 * Exploit Weakness action, which is a fact about the swing rather than about
 * the attacker, so it is resolved at roll time alongside the capability.
 */
export const SNEAK_TRIGGERS = [
  // Exploit Weakness, the ability's own ruling: no doctrine needed, but the
  // target has to be slower. Ahead of the Rogue IX clause so a character who
  // has both is told the more interesting reason.
  {
    key: "weakSpotOrder",
    weakSpot: true,
    capability: null,
    test: (ctx) => ctx.targetActsLater === true,
  },
  // Rogue IX — a Weak Spot hit is a Sneak Attack outright, whoever it lands on.
  { key: "weakSpot", weakSpot: true, capability: ROGUE(9), test: () => true },
  // Shadow → Kritický zásah se počítá jako Zákeřný útok.
  {
    key: "critical",
    capability: NODE("shadow", "critAsSneak"),
    test: (ctx) => ctx.mode === "critical",
  },
  // Shadow → Přesila 2:1 se po zásahu počítá jako Zákeřný útok. Ahead of the
  // Rogue II 3:1 clause because it is the rarer, bought-for thing.
  {
    key: "outnumbered2",
    capability: NODE("shadow", "outnumberSneak"),
    test: (ctx) => ctx.overwhelmSources >= 2,
  },
  // Rogue II — Boky a Záda, now that facing is tracked (utils/positioning.mjs).
  {
    key: "back",
    capability: ROGUE(2),
    test: (ctx) => ctx.sector === SECTOR.BACK,
  },
  {
    key: "flank",
    capability: ROGUE(2),
    test: (ctx) => ctx.sector === SECTOR.FLANK,
  },
  // Rogue II — Přesila 3:1, 4:1, 5:1, which is simply three or more.
  {
    key: "outnumbered3",
    capability: ROGUE(2),
    test: (ctx) => ctx.overwhelmSources >= 3,
  },
  // Rogue V — the target hemmed in by three or more of its enemies, the Rogue
  // included. The only clause in this file that needs to know whose side a
  // token is on.
  //
  // This one counts BODIES ON THE MAP while the Přesila clauses count attackers
  // the target defended against, and the difference is the whole point of the
  // rank rather than an inconsistency to iron out. Přesila cannot exist until
  // the victim has defended against somebody, so a Rogue striking first in the
  // round has no Přesila to read. Rank V is what buys them the sneak anyway,
  // off the formation alone. Do not "align" the two.
  {
    key: "surrounded",
    capability: ROGUE(5),
    test: (ctx) => ctx.adjacentEnemies >= 3,
  },
  // Rogue V — Zpomalení.
  { key: "slow", capability: ROGUE(5), status: "slow" },
  // Rogue II — the condition list. Oslepení is the lighter Dazzled, Slepota the
  // full Blinded; the rulebook names both and they are different effects here.
  { key: "prone", capability: ROGUE(2), status: "prone" },
  { key: "stun", capability: ROGUE(2), status: "stun" },
  { key: "root", capability: ROGUE(2), status: "root" },
  { key: "blind", capability: ROGUE(2), status: "blind" },
  { key: "dazzled", capability: ROGUE(2), status: "dazzled" },
  { key: "panic", capability: ROGUE(2), status: "panic" },
];

/** Every trigger keyed by its key, for reading one back off a card. */
const BY_KEY = new Map(SNEAK_TRIGGERS.map((t) => [t.key, t]));

/* -------------------------------------------- */
/*  CAPABILITY, AT ROLL TIME                    */
/* -------------------------------------------- */

/** Does this attacker own this clause? */
function hasCapability(actor, trigger) {
  const capability = trigger.capability;
  if (!capability) return true;
  if (capability.spec) {
    return actorHasSpecNode(actor, capability.spec, capability.node);
  }
  return ruleActive(actor, capability);
}

/**
 * The trigger keys this attacker could promote with on this swing.
 *
 * Stamped onto the attack card, because Apply Damage often runs on the GM's
 * client where the attacker's sheet is not the one being read, and because a
 * card answered next round must be judged by what was true when it was thrown.
 *
 * @param {Actor} actor                the attacker
 * @param {object} [opts]
 * @param {Item|null} [opts.ability]   the ability being used, if any
 * @param {Item[]} [opts.modifiers]    attack modifiers ticked in the dialog
 * @returns {string[]}
 */
export function attackerSneakTriggers(
  actor,
  { ability = null, modifiers = [] } = {},
) {
  if (!actor) return [];

  // The throwing versions of Exploit Weakness arrive as a ticked modifier on an
  // ordinary attack rather than as the ability itself, so both are asked — the
  // same pair getWeakSpotPenetration checks.
  const isWeakSpot =
    isWeakSpotAttack(ability) ||
    (modifiers ?? []).some((mod) => isWeakSpotAttack(mod));

  return SNEAK_TRIGGERS.filter((trigger) => {
    if (trigger.weakSpot && !isWeakSpot) return false;
    return hasCapability(actor, trigger);
  }).map((trigger) => trigger.key);
}

/* -------------------------------------------- */
/*  EVALUATION, AT APPLY TIME                   */
/* -------------------------------------------- */

/**
 * The first trigger that fired against this victim, or null.
 *
 * @param {object} ctx
 * @param {string[]} ctx.triggers        keys stamped on the card
 * @param {Actor|null} ctx.targetActor   the victim, for its statuses
 * @param {string|null} ctx.sector       "front"|"flank"|"back" from the card
 * @param {number} ctx.overwhelmSources  attackers the victim defended against
 * @param {number} ctx.adjacentEnemies   enemies in the victim's neighbouring hexes
 * @param {boolean} ctx.targetActsLater  victim's initiative is below the attacker's
 * @param {string} ctx.mode              "normal" | "critical" | "breakthrough"
 * @returns {string|null} the trigger key
 */
export function matchSneakTrigger(ctx) {
  const owned = new Set(ctx?.triggers ?? []);
  if (!owned.size) return null;

  for (const trigger of SNEAK_TRIGGERS) {
    if (!owned.has(trigger.key)) continue;
    if (trigger.status) {
      if (ctx.targetActor?.statuses?.has(trigger.status)) return trigger.key;
      continue;
    }
    if (trigger.test?.(ctx) === true) return trigger.key;
  }

  return null;
}

/**
 * How many of this token's enemies stand in a neighbouring hex.
 *
 * Sides are the flat two-group model the table rules by: HOSTILE is one side,
 * everything else — party, friendly, neutral — is the other. Subgroups of
 * hostiles are not modelled, and neutrals currently count with the party.
 *
 * @param {TokenDocument|Token|null} token
 * @returns {number}
 */
export function countAdjacentEnemies(token) {
  const doc = token?.document ?? token ?? null;
  const scene = doc?.parent ?? null;
  if (!doc || !scene) return 0;

  const hostileSide = (t) =>
    Number(t?.disposition) === CONST.TOKEN_DISPOSITIONS.HOSTILE;
  const mySide = hostileSide(doc);

  let count = 0;
  for (const other of scene.tokens.contents) {
    if (other.id === doc.id) continue;
    if (hostileSide(other) === mySide) continue;
    if (areAdjacent(doc, other)) count++;
  }
  return count;
}

/**
 * Does this victim act after the attacker in the turn order?
 *
 * "Nižší Pořadí tahu" for the Exploit Weakness ruling: the target is slower, so
 * it is further down the initiative list. Null-safe in every direction, because
 * out of combat, or against a token not in the encounter, there is no order to
 * be lower in and the clause simply does not fire.
 */
export function targetActsLaterThanAttacker(targetTokenId, attackerTokenId) {
  const combat = game.combat;
  if (!combat?.started || !attackerTokenId || !targetTokenId) return false;

  const initiativeOf = (id) => {
    const combatant = combat.combatants.find((c) => c.tokenId === id);
    const value = Number(combatant?.initiative);
    return Number.isFinite(value) ? value : null;
  };

  const target = initiativeOf(targetTokenId);
  const attacker = initiativeOf(attackerTokenId);
  if (target === null || attacker === null) return false;
  return target < attacker;
}

/**
 * The clause that WOULD promote this swing, for the attack dialog to show.
 *
 * Advisory only, and deliberately not the same thing as ticking the Sneak
 * Attack box. A declared sneak is folded into the damage for every target the
 * blow catches; a promotion is judged per victim, so a cleave into one prone
 * guard and one standing one sneaks only the prone one. Ticking the box on the
 * player's behalf would quietly turn that into both.
 *
 * `mode` is "normal" here because a critical is unknowable until the defense
 * has rolled, so the Shadow critAsSneak clause never previews. It still fires
 * at Apply Damage.
 *
 * @returns {string|null} the trigger key
 */
export function previewSneakTrigger(
  actor,
  attackerToken,
  targetToken,
  { ability = null, modifiers = [] } = {},
) {
  if (!actor || !attackerToken || !targetToken) return null;

  const triggers = attackerSneakTriggers(actor, { ability, modifiers });
  if (!triggers.length) return null;

  const targetDoc = targetToken.document ?? targetToken;
  const attackerDoc = attackerToken.document ?? attackerToken;

  return matchSneakTrigger({
    triggers,
    targetActor: targetDoc?.actor ?? null,
    sector: attackSector(targetToken, attackerToken),
    overwhelmSources: getOverwhelmSources(targetDoc).length,
    adjacentEnemies: countAdjacentEnemies(targetDoc),
    targetActsLater: targetActsLaterThanAttacker(
      targetDoc?.id,
      attackerDoc?.id,
    ),
    mode: "normal",
  });
}

/** Localized name of a trigger, for the chat line that names the reason. */
export function sneakTriggerLabel(key) {
  if (!BY_KEY.has(key)) return "";
  return game.i18n.localize(`REDSTEEL.Sneak.Trigger.${key}`);
}
