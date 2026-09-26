import { getTraitPills } from "./traitPills.mjs";
import {
  withRollBias,
  applyDesperateCrit,
  tagRollSkill,
} from "./rollAdvantage.mjs";
import { getDefenseRerollTokens } from "./rerolls.mjs";
import { getBaneProfile } from "./baneCombat.mjs";
import { buildTempHealthGrantFlag } from "./tempHealthGrant.mjs";
import { buildManeuverFlag } from "./advantageousManeuver.mjs";
import { getAimDefenseBonus } from "./aim.mjs";
import { getBloodSchoolRankBonus } from "../helpers/specialisations.mjs";
import {
  SECTOR,
  deniesDefense,
  hasLongReachExemption,
  longReachPenaltyAgainst,
  resolveDefenseSector,
  sectorLabel,
} from "./positioning.mjs";
import {
  OVERWHELM_MAX_STACKS,
  OVERWHELM_PENALTY_PER_STACK,
  attackerTokenIdFromMessage,
  getOverwhelmSources,
  inferAttackerTokenId,
  isOverwhelmTracked,
  overwhelmSourceName,
  forgetOverwhelmSource,
  recordOverwhelmDefense,
  resolveDefenderToken,
  stacksFromSources,
} from "./overwhelm.mjs";
// The verdict itself lives in a Foundry-free module so NPC auto-defense can
// ask the same question a hundred times without drawing a card for it.
import { resolveVersus } from "./defenseOdds.mjs";

/** Shadow → Úhyb do zad: the flat penalty for dodging a blow from behind. */
const BLINDSIDE_DODGE_PENALTY = -20;

/**
 * Whether a dodge came out as a Bad Dodge (Špatný úhyb): the raw d100 beat the
 * defender's dodge limit (`system.dodgeLimit.total`, 50 by default, 80 with
 * Acrobatic Defense). The evasion still happened, but badly.
 *
 * Read off the *raw die*, not the margin. A high die can still clear a big
 * dodge rating, which is exactly the case the limit exists to catch: the skill
 * says the dodge worked, the die says it was ugly.
 *
 * @param {Actor} actor
 * @param {number|null} d100Result  the raw d100 of the dodge test
 * @returns {boolean}
 */
export function isBadDodge(actor, d100Result) {
  const limit = Number(actor?.system?.dodgeLimit?.total);
  const die = Number(d100Result);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  if (!Number.isFinite(die)) return false;
  return die > limit;
}

/**
 * The margin a Bad Dodge takes into the versus Test: capped at 0, never above.
 *
 * This is the whole penalty. A bad dodge cannot win the contest on its own
 * strength any more — a positive margin collapses to 0 — but it still answers a
 * worse attack, and a margin that was already negative is left alone (the dodge
 * was failing regardless, and inflating it to 0 would *reward* the bad die).
 *
 * @param {number} margin  the roll's own margin of success
 * @param {boolean} badDodge
 * @returns {number}
 */
export function badDodgeMargin(margin, badDodge) {
  return badDodge ? Math.min(0, margin) : margin;
}

/**
 * The defender's armor, as the block every defense card ends with. Typed armor
 * is listed only where it exists, so a plain leather jerkin shows one row.
 *
 * Exported because a rerolled defense card has to redraw it — the numbers are
 * read live off the actor, which is where they were read from the first time.
 *
 * @param {Actor} actor
 * @returns {string} HTML, or "" when the actor carries no armor block.
 */
export function renderArmorTable(actor) {
  const armor = actor?.system?.armor;
  if (!armor) return "";

  const armorRows = [
    ["Armor", armor.total],
    ["Acid Armor", armor.acid?.total],
    ["Fire Armor", armor.fire?.total],
    ["Frost Armor", armor.frost?.total],
    ["Lightning Armor", armor.lightning?.total],
    ["Magic Armor", armor.magic?.total],
  ].filter(([label, value]) => {
    if (label === "Armor") return true;
    return value > 0;
  });

  return `
      <table style="width:100%;text-align:center;font-size:15px;">
        <tr><th>Type</th><th>Value</th></tr>
        ${armorRows
          .map(
            ([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`,
          )
          .join("")}
      </table>
    `;
}

/**
 * Resolve a defense against the attack it is answering.
 *
 * Defense is a versus Test ("Alternativní forma obrany, versus Test Úhybu
 * proti Zásahu oponenta"), so the two margins are compared directly and the
 * gap between them is the number the rules read. Two things outrank that plain
 * comparison, in this order:
 *
 * 1. A *natural* critical roll is absolute. It settles the contest on its own
 *    and the margins stop mattering, so a natural 1 on defense is a Critical
 *    Defense even against an attack that was 69 ahead. A natural critical
 *    failure on defense reads the same way from the other end: the guard came
 *    apart, so the blow lands critically whatever the margins said.
 *    Only the *other side's* natural critical can deny one. A 60-clear margin
 *    cannot, which is the whole point of calling the natural roll absolute.
 *    Denied criticals fall back to whoever rolled closer to 1 on the d100,
 *    with a tie going to the attacker as every versus Test does.
 * 2. Failing any natural critical, a side that is 60 clear on margin is
 *    critical ("Úspěšný zásah, který je o 60 silnější než protivníkova
 *    obrana"), and below that the plain margin comparison decides.
 *
 * Advisory only: the attack card keeps its Apply Damage buttons, because
 * whether a blow lands is still the GM's call.
 *
 * Module-level (rather than a closure inside `defenseRoll`) because a rerolled
 * defense card has to redraw this block from the answered attack stored on the
 * card it was rerolled from — see `flags.redsteel.versusAttack`.
 *
 * @param {object|null} attack  the answered attack: `{margin, criticalSuccess,
 *   criticalFailure, d100}`. A null/absent margin means "not answering a card",
 *   and yields an empty block.
 * @param {object} params
 * @param {number} params.defenseTotal   this defense's own margin
 * @param {number|null} params.defenseD100 the raw die, for the crit tiebreak
 * @param {boolean} params.defenseCrit   natural critical success on defense
 * @param {boolean} params.defenseCritFailure natural critical failure on defense
 * @returns {{html: string, versus: object|null}}
 */
export function renderVersusBlock(
  attack,
  {
    defenseTotal,
    defenseD100 = null,
    defenseCrit = false,
    defenseCritFailure = false,
  } = {},
) {
  // The verdict is decided in defenseOdds.mjs (the rules above live there in
  // full); this function only draws it. Null is the "not answering a card"
  // case, which has nothing to draw.
  const verdict = resolveVersus(attack, {
    defenseTotal,
    defenseD100,
    defenseCrit,
    defenseCritFailure,
  });
  if (!verdict) return { html: "", versus: null };

  const { attackMargin: knownAttackMargin, gap, blocked, critical, onDice } =
    verdict;
  const attackD100 = attack?.d100 ?? null;

  const outcome = critical
    ? game.i18n.localize(
        critical === "defense"
          ? "REDSTEEL.Versus.CriticalDefense"
          : "REDSTEEL.Versus.CriticalHit",
      )
    : !onDice && gap === 0
      ? game.i18n.localize("REDSTEEL.Versus.Tie")
      : game.i18n.localize(
          blocked ? "REDSTEEL.Versus.Blocked" : "REDSTEEL.Versus.Hit",
        );

  const detail = game.i18n.format("REDSTEEL.Versus.Detail", {
    attack: knownAttackMargin,
    defense: defenseTotal,
    gap: gap > 0 ? `+${gap}` : gap,
  });

  // The margin line is actively misleading when the dice decided it, so say
  // so rather than leaving a +53 sitting under a "Hit".
  const diceNote = onDice
    ? `<div class="rs-versus-note">${game.i18n.format(
        "REDSTEEL.Versus.DeniedOnDice",
        { attack: attackD100, defense: defenseD100 },
      )}</div>`
    : "";

  // Coloured from the defender's point of view, because this is the
  // defender's card: gold only for their own critical, red for a critical
  // landing on them.
  const state =
    critical === "defense"
      ? "is-critical-defense"
      : critical === "hit"
        ? "is-critical-hit"
        : blocked
          ? "is-blocked"
          : "is-hit";

  const html = `
      <div class="rs-versus ${state}">
        <div class="rs-versus-outcome">${outcome}</div>
        <div class="rs-versus-detail">${detail}</div>
        ${diceNote}
      </div>`;

  return {
    html,
    versus: {
      attackMargin: knownAttackMargin,
      gap,
      blocked,
      critical,
      onDice,
    },
  };
}

/**
 * The card for a blow that could not be answered at all.
 *
 * An attack from behind is a critical failure on defense "bez možnosti hodu" —
 * without the chance to roll — so there is no Roll here and none is faked. The
 * versus block is handed `defenseCritFailure: true` with a margin of zero,
 * which is all it needs: a natural critical for the attacker settles the
 * contest on its own and never looks at the margins.
 *
 * Carries none of the claims a real defense card does. There is no roll to
 * re-roll, no successful guard to buy Temporary Health with, and no parry to
 * spend on an Advantageous Maneuver.
 */
async function postDeniedDefense({ actor, token = null, attack = null } = {}) {
  const versus = renderVersusBlock(attack, {
    defenseTotal: 0,
    defenseD100: null,
    defenseCrit: false,
    defenseCritFailure: true,
  });

  const title = game.i18n.localize("REDSTEEL.Positioning.BackstabTitle");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({
      actor,
      token: token?.document ?? token,
    }),
    flavor: `
        <div style="display:flex;align-items:center;gap:8px;font-weight:bold;">
          <i class="fa-light fa-shield-slash"></i>
          <span>${title}</span>
        </div>
        <hr>
        <p class="rs-card-headline"><b>${game.i18n.localize(
          "REDSTEEL.Positioning.DeniedHeadline",
        )}</b></p>
        <p class="rs-position-note">${game.i18n.localize(
          "REDSTEEL.Positioning.BackstabDenied",
        )}</p>
        ${versus.html}
      `,
    flags: {
      redsteel: {
        rollName: title,
        positioning: { sector: SECTOR.BACK, denied: true },
      },
    },
  });
}

/* -------------------------------------------- */
/*  DEFENSE PROFILE                             */
/* -------------------------------------------- */

/**
 * The token actually swinging, as a document on the defender's own scene.
 * Null when there is no id, no defender, or the defender is answering itself.
 *
 * @param {TokenDocument|Token|null} defenderToken
 * @param {string|null} attackerTokenId
 * @returns {TokenDocument|null}
 */
export function attackerTokenDocFor(defenderToken, attackerTokenId) {
  const defender = defenderToken?.document ?? defenderToken ?? null;
  if (!attackerTokenId || !defender || attackerTokenId === defender.id) {
    return null;
  }
  return defender.parent?.tokens?.get(attackerTokenId) ?? null;
}

/**
 * Whether this defender parries with a long-reach weapon in hand.
 *
 * A character is judged by the weapon it is actually holding. An NPC has no
 * weapon sets to say which one that is, so any long-reach weapon it carries
 * counts: the safe reading for a spear-armed guard.
 *
 * @param {Actor} actor
 * @param {Item|null} activeWeapon  the weapon `resolveWeaponContext` settled on
 * @returns {boolean}
 */
export function hasDefenseLongReach(actor, activeWeapon) {
  if (activeWeapon?.system?.longReach) return true;
  if (actor.type === "character") return false;
  return actor.items.some((i) => i.type === "weapon" && i.system?.longReach);
}

/**
 * The Long Reach close-quarters penalty an automatic melee defense takes.
 *
 * Exactly what the auto-defense branch of {@link defenseRoll} hands to
 * `meleeDefense`, exported so auto-defense can score a parry with the number
 * it would really be rolled at. The penalty is a property of the defender and
 * where the attacker stands, not of the parrying weapon, which is why it reads
 * the default weapon context rather than the candidate being scored.
 *
 * @param {Actor} actor
 * @param {TokenDocument|Token|null} defenderToken
 * @param {string|null} attackerTokenId
 * @returns {number} 0 or a negative modifier
 */
export function autoDefenseLongReachPenalty(
  actor,
  defenderToken,
  attackerTokenId,
) {
  const activeWeapon = game.redsteel.resolveWeaponContext(actor, null)?.weapon;
  if (!hasDefenseLongReach(actor, activeWeapon)) return 0;
  return longReachPenaltyAgainst(
    actor,
    defenderToken,
    attackerTokenDocFor(defenderToken, attackerTokenId),
  );
}

/**
 * Everything a defense roll is made of, up to but not including the die.
 *
 * One builder for both uses: the defense closures in {@link defenseRoll} roll
 * `formula` against `rollData`, and NPC auto-defense (autoDefense.mjs) feeds
 * `rating` and the thresholds to defenseOdds.mjs to ask which defense would
 * hold. A second copy of these sums anywhere else is how the two would come to
 * disagree, so they live here and nowhere else.
 *
 * Reads only; writes nothing. Overwhelm is taken as a number rather than
 * committed here, because committing is the roll's business and scoring a
 * defense must not record an attacker.
 *
 * @param {object} params
 * @param {Actor} params.actor
 * @param {"melee"|"ranged"|"dodge"} params.mode
 * @param {object} params.context  from `game.redsteel.resolveWeaponContext`
 * @param {object|null} [params.ability]  reaction ability or a bare
 *   `{system: {defense|rangedDefense|dodge}}` modifier (Guard, Blindside)
 * @param {TokenDocument|Token|null} [params.defenderToken]  for the Aim perk
 * @param {string|null} [params.attackerTokenId]  who is swinging, for the Aim perk
 * @param {number} [params.overwhelmStacks=0]
 * @param {number} [params.longReachPenalty=0]  melee only
 * @param {boolean} [params.useBane=false]
 * @returns {Promise<{formula: string, rollData: object, rating: number,
 *   critSuccess: number, critFailure: number,
 *   skillKey: "meleeDefense"|"rangedDefense"|"dodge",
 *   dodgeLimit: number|null, aimDefense: object|null}>}
 */
export async function buildDefenseProfile({
  actor,
  mode,
  context,
  ability = null,
  defenderToken = null,
  attackerTokenId = null,
  overwhelmStacks = 0,
  longReachPenalty = 0,
  useBane = false,
} = {}) {
  const weapon = context.weapon;
  const offProps = getOffhandProps(context);
  const baneProfile = getBaneProfile(actor);
  const overwhelmPenalty = overwhelmStacks * OVERWHELM_PENALTY_PER_STACK;

  let formula;
  let rollData;
  let critSuccess;
  let critFailure;
  let skillKey;
  let dodgeLimit = null;
  let aimDefense = null;

  if (mode === "melee") {
    // Weapon quality: main hand uses the Zbraň column, off-hand the Druhá ruka column.
    const mainQuality = weapon.system.qualityMods ?? {};
    // Enchantments applied to the main-hand weapon, read beside its quality.
    const mainEnchant = weapon.system.enchantMods ?? {};
    const offQuality = getOffhandQualityMods(context);
    const mainDefense =
      (Number(weapon.system.defense) || 0) +
      (Number(mainQuality.defense) || 0) +
      (Number(mainEnchant.defense) || 0);
    const offDefense =
      (Number(offProps?.defense) || 0) + (Number(offQuality.defense) || 0);
    // Characters fold weapon defense into meleeDefense.bonus during
    // prepareDerivedData so the sheet shows the real number, which means it
    // already sits inside defenseRating here. NPCs have no weapon sets, so
    // they still pick it up at roll time.
    const weaponDefense =
      actor.type === "character" ? 0 : mainDefense + offDefense;
    const mainCrit =
      (Number(weapon.system.critDefense) || 0) +
      (Number(mainQuality.critDefense) || 0);
    const offCrit =
      (Number(offProps?.critDefense) || 0) +
      (Number(offQuality.critDefense) || 0);

    const weaponSpec = game.redsteel.getWeaponSpecBonuses(actor, weapon);

    const { doctrineCritDefenseBonus, doctrineDefenseBonus } =
      await game.redsteel.getDoctrineBonuses(actor, weapon);

    const defense = actor.system.combatSkills.meleeDefense;
    const defenseRating = defense.rating;
    const abilityDefense = Number(ability?.system?.defense) || 0;

    // Duelist VII: parrying the opponent you are aiming at is worth +5% per
    // stack. Passive — the aim is not spent, so it is still there to attack
    // with on the duellist's own turn.
    aimDefense = getAimDefenseBonus({
      actor,
      token: defenderToken,
      weapon,
      context,
      attackerTokenId,
    });

    critSuccess =
      defense.criticalSuccessThreshold +
      mainCrit +
      offCrit +
      doctrineCritDefenseBonus +
      weaponSpec.critDefense +
      (useBane ? baneProfile.critDefense : 0);

    critFailure = defense.criticalFailureThreshold;

    rollData = {
      defenseRating,
      weaponDefense,
      doctrineDefenseBonus,
      abilityDefense,
      overwhelmPenalty,
      longReachPenalty,
      specDefense: weaponSpec.defense,
      baneDefense: useBane ? baneProfile.defense : 0,
      aimDefense: aimDefense.bonus,
    };

    formula =
      "@defenseRating + @weaponDefense + @doctrineDefenseBonus + @abilityDefense + @overwhelmPenalty + @longReachPenalty + @specDefense + @baneDefense + @aimDefense - 1d100";
    skillKey = "meleeDefense";
  } else if (mode === "ranged") {
    const { doctrineCritDefenseBonus, doctrineRangedDefenseBonus } =
      await game.redsteel.getDoctrineBonuses(actor, weapon);

    const defense = actor.system.combatSkills.rangedDefense;
    const abilityDefense = Number(ability?.system?.rangedDefense) || 0;

    critSuccess =
      defense.criticalSuccessThreshold +
      doctrineCritDefenseBonus +
      (useBane ? baneProfile.critDefense : 0);

    critFailure = defense.criticalFailureThreshold;

    rollData = {
      defenseRating: defense.rating,
      doctrineRangedDefenseBonus,
      abilityDefense,
      overwhelmPenalty,
      baneDefense: useBane ? baneProfile.defense : 0,
    };

    formula =
      "@defenseRating + @doctrineRangedDefenseBonus + @abilityDefense + @overwhelmPenalty + @baneDefense - 1d100";
    skillKey = "rangedDefense";
  } else if (mode === "dodge") {
    const offQuality = getOffhandQualityMods(context);
    const mainDodge = Number(weapon.system.dodge) || 0;
    const offDodge = Number(offProps?.dodge) || 0;
    const offCritDodge =
      (Number(offProps?.critDodge) || 0) + (Number(offQuality.critDodge) || 0);

    const dodge = actor.system.combatSkills.dodge;
    const abilityDefense = Number(ability?.system?.dodge) || 0;

    critSuccess =
      dodge.criticalSuccessThreshold +
      (Number(weapon.system.critDodge) || 0) +
      offCritDodge +
      (useBane ? baneProfile.critDefense : 0);

    critFailure = dodge.criticalFailureThreshold;

    rollData = {
      dodgeRating: dodge.rating,
      weaponDodge: mainDodge + offDodge,
      abilityDefense,
      overwhelmPenalty,
      baneDefense: useBane ? baneProfile.defense : 0,
    };

    formula =
      "@dodgeRating + @weaponDodge + @abilityDefense + @overwhelmPenalty + @baneDefense - 1d100";
    skillKey = "dodge";
    // Read the same way isBadDodge reads it; a limit of 0 or less means none.
    dodgeLimit = Number(actor.system?.dodgeLimit?.total);
  } else {
    throw new Error(`Redsteel | unknown defense mode "${mode}"`);
  }

  // Every rollData term is a flat addend in the formula (they are all "+ @x"),
  // so their sum is the number the die is subtracted from. Taken here, before
  // the caller runs withRollBias, which adds keys that are not terms.
  const rating = Object.values(rollData).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );

  return {
    formula,
    rollData,
    rating,
    critSuccess,
    critFailure,
    skillKey,
    dodgeLimit,
    aimDefense,
  };
}

/**
 * Mark a defense roll as rolled by NPC auto-defense, so the roll layer keeps
 * the GM's manual modifier picker out of it (see rollModifier.mjs →
 * applyModifier). Merged, never replacing: `skill` is already on the options.
 *
 * @param {Roll} roll
 */
function tagAutoDefenseRoll(roll) {
  roll.options ??= {};
  roll.options.redsteel = {
    ...(roll.options.redsteel ?? {}),
    autoDefense: true,
  };
}

export async function defenseRoll({
  actor,
  token = null,
  weapon,
  ability = null,
  attackerTokenId = null,
  attack = null,
  auto = null,
} = {}) {
  // Named by the caller whenever it knows which token is defending. Auto-defense
  // does: it was told by the attack card, and four goblins off one base actor
  // must not be collapsed into whichever one the scene lists first.
  let defenderToken = token;

  if (!actor) {
    const context = game.redsteel.selectToken();
    if (!context) return;

    actor = context.actor;
    defenderToken = context.token ?? null;
  }

  defenderToken = resolveDefenderToken(actor, defenderToken);

  /* -------------------------------------------- */
  /*  OVERWHELM                                   */
  /* -------------------------------------------- */

  // Who is swinging. An explicit id from a Defend button is a fact; the
  // newest-attack-card guess is a fallback for hotbar-launched defenses and is
  // the reason the dialog lets you take a name back out again.
  let pendingAttackerId = isOverwhelmTracked()
    ? (attackerTokenId ?? inferAttackerTokenId(defenderToken?.id))
    : null;

  // Answering your own attack card (a GM holding both sides) must not put the
  // defender in their own set, or show them as a chip they cannot remove.
  if (pendingAttackerId && pendingAttackerId === defenderToken?.id) {
    pendingAttackerId = null;
  }

  /** Recorded attackers plus the one about to be recorded by this defense. */
  const projectedSources = () => {
    const sources = getOverwhelmSources(defenderToken);
    if (pendingAttackerId && !sources.includes(pendingAttackerId)) {
      sources.push(pendingAttackerId);
    }
    return sources;
  };

  /**
   * Write the attacker into the record and settle the number this roll uses.
   *
   * Called at roll time, never when the dialog opens, so cancelling out leaves
   * no phantom attacker behind. `override` is the value the GM dialled on the
   * counter: it changes this roll only and deliberately does not rewrite the
   * record, because the record is corrected by removing a chip instead.
   */
  const commitOverwhelm = async (override = null) => {
    if (!isOverwhelmTracked()) return Number(override) || 0;

    const stacks = await recordOverwhelmDefense(
      defenderToken,
      pendingAttackerId,
    );
    return override === null ? stacks : Number(override) || 0;
  };

  /**
   * The token this defense is answering, for perks that care who is swinging
   * (today: the Duelist VII aim bonus). Read at roll time, not dialog time.
   *
   * Deliberately independent of combat state. `pendingAttackerId` is only ever
   * populated while Overwhelm is tracking, which means a started encounter — so
   * borrowing it wholesale silently switched the perk off outside combat, and
   * off for anyone the tracker was not following. Who is swinging at you is a
   * fact about the attack, not about the initiative order, so the last branch
   * asks the chat log directly rather than giving up.
   *
   * Order is strongest evidence first: an id handed over by a Defend button is
   * the card naming its own author. Failing that, and only while the chips are
   * live to override it, the attacker the Overwhelm block settled on — which
   * respects a chip the GM took back out, their way of saying "not that one".
   */
  const defendingAgainstId = () => {
    if (attackerTokenId) return attackerTokenId;
    if (isOverwhelmTracked()) return pendingAttackerId;
    return inferAttackerTokenId(defenderToken?.id);
  };

  /* -------------------------------------------- */
  /*  VERSUS THE ATTACK                           */
  /* -------------------------------------------- */

  // `== null` catches both null and undefined before the cast, because
  // Number(null) is 0 and a hotbar defense would otherwise contest a phantom
  // attack of margin zero.
  const parsedAttackMargin =
    attack?.margin == null ? NaN : Number(attack.margin);
  const knownAttackMargin = Number.isFinite(parsedAttackMargin)
    ? parsedAttackMargin
    : null;

  /** This defense against the attack it is answering. See {@link renderVersusBlock}. */
  const resolveVersusAttack = (defense) => renderVersusBlock(attack, defense);

  const baneProfile = getBaneProfile(actor);

  const hasGuard = actor.effects.some(
    (e) =>
      e.getFlag("core", "statusId") === "guard" || e.statuses?.has("guard"),
  );

  /* -------------------------------------------- */
  /*  POSITIONING                                 */
  /* -------------------------------------------- */

  // Which arc this blow comes from (utils/positioning.mjs). The card's own
  // stamp when it has one, live token facing otherwise. Null means the arc
  // cannot be read at all — a hotbar defense answering no card, an attack that
  // named no target — and every branch below treats null as "say nothing and
  // behave exactly as this dialog did before positioning existed".
  const positionSector = resolveDefenseSector({
    defenderToken,
    attackerTokenId: defendingAgainstId(),
    attack,
  });

  /**
   * The token actually swinging, as a document on the defender's own scene.
   * Needed on top of the arc because the polearm's close-quarters penalty is a
   * question about live distance, which no card stamps: where the attacker
   * stands NOW is what a spear has to cope with.
   */
  const attackerTokenDoc = attackerTokenDocFor(
    defenderToken,
    defendingAgainstId(),
  );

  // A blow from behind that this defender has nothing to answer with. There is
  // no roll to make and no choice to offer, so no dialog opens: the card is
  // posted outright as the critical failure the rules say it is. Deliberately
  // before the ability and auto-defense branches, so a reaction ability and an
  // NPC defending itself are denied on the same terms a player is.
  if (deniesDefense(positionSector, actor)) {
    await postDeniedDefense({ actor, token: defenderToken, attack });
    return;
  }

  // Shadow → Úhyb do zad (Blindside Dodge): the one thing that does answer a
  // blow from behind, at -20%. Now that facing is tracked the button appears
  // when the blow actually came from behind, and the arc-less case keeps the
  // old behaviour of offering it for the defender to declare by hand.
  const shadowSpec = actor.system?.specialisations?.shadow;
  const hasBackDodgeNode = !!(
    shadowSpec?.active && shadowSpec.nodes?.backDodge
  );
  const isBackAttack = positionSector === SECTOR.BACK;
  const hasBlindsideDodge =
    hasBackDodgeNode && (isBackAttack || positionSector === null);

  /* -------------------------------------------- */
  /*  SHARED CSS                                  */
  /* -------------------------------------------- */

  const css = `
#weapon-list .weapon-choice {
  position: relative;
  font-size: 16px;
  color: black;
}

#weapon-list .weapon-choice:hover {
  color: black;
  text-shadow: 0 0 1px red, 0 0 2px red;
}

.weapon-dialog .window-content {
  max-width: 300px;
  width: 100%;
}

.weapon-dialog .window {
  width: auto;
}

/* Defense dialog buttons */
.dialog .dialog-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.dialog .dialog-buttons button {
  width: 100%;
  min-width: 0;
}
`;

  if (!document.getElementById("redsteel-defense-css")) {
    const styleSheet = document.createElement("style");
    styleSheet.id = "redsteel-defense-css";
    styleSheet.type = "text/css";
    styleSheet.innerText = css;
    document.head.appendChild(styleSheet);
  }

  /* -------------------------------------------- */
  /*  Overwrite the logic if the ability is given */
  /* -------------------------------------------- */
  if (ability) {
    if (ability.system?.rangedDefense != null) {
      return rangedDefense({ ability, weapon });
    }

    if (ability.system?.dodge != null) {
      return dodgeDefense({ ability, weapon });
    }

    if (ability.system?.defense != null) {
      return meleeDefense({ ability, weapon });
    }
  }

  /* -------------------------------------------- */
  /*  DEFENSE SELECTOR                            */
  /* -------------------------------------------- */

  const isCharacter = actor.type === "character";
  const hasActiveSet = isCharacter && actor.system.combat?.activeWeaponSet;

  const activeSetPreview = hasActiveSet
    ? renderWeaponLoadoutsDialog(actor)
    : "";

  // Try active weapon first (PC flow)
  const context = game.redsteel.resolveWeaponContext(actor, ability);
  const activeWeapon = context?.weapon;

  const hasLongReach = hasDefenseLongReach(actor, activeWeapon);

  // Parrying with a long-reach weapon is as awkward as attacking with one: the
  // penalty applies when the attacker is in a neighbouring hex. Computed from
  // where they stand now rather than from the card, and 0 whenever the weapon
  // has no long reach, so the number is safe to pass unconditionally.
  const longReachClosePenalty = hasLongReach
    ? longReachPenaltyAgainst(actor, defenderToken, attackerTokenDoc)
    : 0;
  // A feature that cancels the penalty hides the checkbox rather than leaving
  // an unticked box that would silently do nothing if clicked.
  const showLongReach = hasLongReach && !hasLongReachExemption(actor);

  /* -------------------------------------------- */
  /*  AUTO-DEFENSE                                */
  /* -------------------------------------------- */

  // An NPC answering an attack card on its own (see autoDefense.mjs). The
  // defense and the weapon are already chosen, so this skips the dialog and
  // nothing else:
  // Overwhelm still records the attacker, the versus block still contests the
  // attack, and the card comes out identical bar the auto marker.
  if (auto) {
    // An NPC with Blindside Dodge being hit from behind has exactly one legal
    // answer, whatever the card asked for. Everything without the node was
    // already turned away by the deny gate above — bar a future
    // `backstabDefense` feature, which must not be charged the node's -20% for
    // a dodge it never bought.
    if (isBackAttack && hasBackDodgeNode) {
      return dodgeDefense({
        weapon,
        blindside: true,
        ability: { system: { dodge: BLINDSIDE_DODGE_PENALTY } },
      });
    }
    if (auto === "ranged") return rangedDefense({ weapon });
    if (auto === "dodge") return dodgeDefense({ weapon });
    // An NPC never sees the checkbox, so the penalty has to be handed to it
    // outright or a spear-armed guard would parry at close quarters for free.
    return meleeDefense({ weapon, longReachPenalty: longReachClosePenalty });
  }

  if (!ability) {
    /** The counter's current value: what this one roll is taken at. */
    const readOverwhelm = (html) =>
      Number(html.find('input[name="overwhelm"]').val()) || 0;

    const buttons = {
      melee: {
        label: "Melee Defense",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const longReachPenalty = html
            .find('[name="longReachPenalty"]')
            .is(":checked")
            ? -5
            : 0;
          const useBane = html.find('[name="baneDefense"]').is(":checked");

          meleeDefense({ overwhelm, longReachPenalty, useBane });
        },
      },

      ranged: {
        label: "Ranged Defense",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const useBane = html.find('[name="baneDefense"]').is(":checked");
          rangedDefense({ overwhelm, useBane });
        },
      },
    };

    if (hasGuard) {
      buttons.guardMelee = {
        label: "Melee Guard",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const useBane = html.find('[name="baneDefense"]').is(":checked");

          meleeDefense({
            overwhelm,
            useBane,
            ability: { system: { defense: -10 } },
          });
        },
      };

      buttons.guardRanged = {
        label: "Ranged Guard",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const useBane = html.find('[name="baneDefense"]').is(":checked");

          rangedDefense({
            overwhelm,
            useBane,
            ability: { system: { rangedDefense: -10 } },
          });
        },
      };
    }

    buttons.dodge = {
      label: "Dodge",
      callback: (html) => {
        const overwhelm = readOverwhelm(html);
        const useBane = html.find('[name="baneDefense"]').is(":checked");
        dodgeDefense({ overwhelm, useBane });
      },
    };

    if (hasBlindsideDodge) {
      buttons.blindsideDodge = {
        label: game.i18n.localize("REDSTEEL.Defense.BlindsideDodge"),
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const useBane = html.find('[name="baneDefense"]').is(":checked");

          // Carried as a bare ability the same way the Guard buttons are: the
          // dodge roll already folds `ability.system.dodge` in, so the node
          // needs no path of its own.
          dodgeDefense({
            overwhelm,
            useBane,
            blindside: true,
            ability: { system: { dodge: BLINDSIDE_DODGE_PENALTY } },
          });
        },
      };
    }
    // Add spell defense if actor can use magic
    if (actor.system.magicPotential || actor.system.priest) {
      buttons.spell = {
        label: "Magic defense",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          spellDefense({ overwhelm });
        },
      };
    }

    // A blow from behind leaves the Blindside Dodge and nothing else. The node
    // buys a dodge, not a guard: parrying, shielding and warding a blade you
    // never saw are all still off the table.
    //
    // Conditional on the button existing, not merely on the blow coming from
    // behind. A future feature that grants `system.backstabDefense` without
    // Shadow's node passes the deny gate and arrives here with no blindside
    // button to keep, and stripping the rest would hand it an empty dialog.
    // Such a defender keeps the full set until the feature says otherwise.
    if (isBackAttack && buttons.blindsideDodge) {
      for (const key of Object.keys(buttons)) {
        if (key !== "blindsideDodge") delete buttons[key];
      }
    }

    const dialog = new Dialog({
      title: "Select Defense Type",
      content: `
      ${activeSetPreview}
      <hr>
      ${
        knownAttackMargin === null
          ? ""
          : `<div class="rs-versus-target">${game.i18n.format(
              "REDSTEEL.Versus.DialogAttackMargin",
              { margin: knownAttackMargin },
            )}</div>`
      }
      ${
        positionSector && positionSector !== SECTOR.FRONT
          ? `<div class="rs-position-note">${game.i18n.format(
              "REDSTEEL.Positioning.DialogNote",
              { arc: sectorLabel(positionSector) },
            )}</div>`
          : ""
      }
      <div class="rs-overwhelm"></div>
      <div class="rs-aim-defense"></div>

        ${
          showLongReach
            ? `
      <div style="margin-top:6px;">
        <label>
          <input type="checkbox" name="longReachPenalty"${
            longReachClosePenalty ? " checked" : ""
          }>
          Long Reach penalty (-5)
        </label>
      </div>
    `
            : ""
        }

        ${
          baneProfile.active
            ? `
      <div style="margin-top:6px;">
        <label>
          <input type="checkbox" name="baneDefense">
          ${game.i18n.localize("REDSTEEL.Banes.DefenseToggle")}
        </label>
      </div>
    `
            : ""
        }
    `,
      buttons: buttons,
      default: "melee",
      render: (html) => {
        html.find(".weapon-set-toggle").on("click", async () => {
          await game.redsteel.switchWeaponSet(actor);

          dialog.close();
          defenseRoll({ actor, attackerTokenId, attack }); // 🔁 reopen with updated preview
        });

        renderOverwhelmBlock(html);
      },
    });

    dialog.render(true);
  }

  /* -------------------------------------------- */
  /*  OVERWHELM BLOCK                             */
  /* -------------------------------------------- */

  /**
   * Counter plus one removable chip per attacker.
   *
   * The two controls have deliberately different reach. The −/+ counter moves
   * the number this roll is taken at and stores nothing, which is also the only
   * control shown out of combat where there is nothing to track. Taking a chip
   * out edits the record itself, so it fixes every remaining defense this round
   * rather than just the roll in front of you.
   *
   * Chips are the recorded attackers, never the encounter roster: the list is
   * bounded by how many things have swung at *this* token, so a twenty-token
   * battle still shows at most a handful of names.
   */
  function renderOverwhelmBlock(html) {
    const container = html.find(".rs-overwhelm");
    if (!container.length) return;

    const tracked = isOverwhelmTracked();
    const sources = tracked ? projectedSources() : [];
    const auto = stacksFromSources(sources);

    // A value the user already dialled survives a chip removal; only the
    // untouched counter follows the record.
    const input = container.find('input[name="overwhelm"]');
    const dirty = input.data("dirty") === true;
    const current = dirty
      ? Math.min(Number(input.val()) || 0, OVERWHELM_MAX_STACKS)
      : auto;

    const penalty = current * OVERWHELM_PENALTY_PER_STACK;
    const label = game.i18n.localize("REDSTEEL.Overwhelm.Label");

    const chips = sources
      .map(
        (id) => `
        <span class="rs-overwhelm-chip" data-attacker-id="${id}">
          ${overwhelmSourceName(id)}
          <a class="rs-overwhelm-remove" data-attacker-id="${id}"
             data-tooltip="${game.i18n.localize("REDSTEEL.Overwhelm.RemoveTooltip")}">×</a>
        </span>`,
      )
      .join("");

    container.html(`
      <div class="rs-overwhelm-row">
        <label>${label}</label>
        <button type="button" class="rs-overwhelm-step" data-step="-1">−</button>
        <span class="rs-overwhelm-value">${current}</span>
        <button type="button" class="rs-overwhelm-step" data-step="1">+</button>
        <span class="rs-overwhelm-penalty">${penalty === 0 ? "" : penalty}</span>
        <input type="hidden" name="overwhelm" value="${current}">
      </div>
      ${
        chips
          ? `<div class="rs-overwhelm-sources-label">${game.i18n.localize(
              "REDSTEEL.Overwhelm.SourcesLabel",
            )}</div>
             <div class="rs-overwhelm-chips">${chips}</div>`
          : ""
      }
    `);

    container.find('input[name="overwhelm"]').data("dirty", dirty);

    container.find(".rs-overwhelm-step").on("click", (event) => {
      const step = Number(event.currentTarget.dataset.step);
      const field = container.find('input[name="overwhelm"]');
      const next = Math.max(
        0,
        Math.min((Number(field.val()) || 0) + step, OVERWHELM_MAX_STACKS),
      );

      field.val(next).data("dirty", true);
      container.find(".rs-overwhelm-value").text(next);
      container
        .find(".rs-overwhelm-penalty")
        .text(next === 0 ? "" : next * OVERWHELM_PENALTY_PER_STACK);
    });

    container.find(".rs-overwhelm-remove").on("click", async (event) => {
      const id = event.currentTarget.dataset.attackerId;

      // The attacker this defense is about to add is not in the record yet, so
      // dropping it is just a matter of not adding it.
      if (id === pendingAttackerId) pendingAttackerId = null;
      else await forgetOverwhelmSource(defenderToken, id);

      renderOverwhelmBlock(html);
    });

    // Taking a chip out can change who this defense believes it is answering,
    // which is the one thing the Aim hint below is keyed on — so it is redrawn
    // from here rather than once when the dialog opens, and never claims a
    // bonus the roll will not actually take.
    renderAimDefenseHint(html);
  }

  /**
   * Duelist VII, announced before the player picks a defense type: the bonus is
   * melee-only, so knowing it is live is exactly what decides parry over dodge.
   * Silent whenever there is nothing to claim.
   */
  function renderAimDefenseHint(html) {
    const container = html.find(".rs-aim-defense");
    if (!container.length) return;

    const {
      perk,
      aimTargetId,
      held,
      attackerTokenId: against,
      stacks,
      bonus,
    } = getAimDefenseBonus({
      actor,
      token: defenderToken,
      weapon: activeWeapon,
      context,
      attackerTokenId: defendingAgainstId(),
    });

    // Nothing to report for a defender who has no aim out, or no perk to spend
    // it on. Everyone else gets a straight answer either way.
    if (!perk || !aimTargetId || !held) return container.html("");

    const name = (id) =>
      (id ? tokenName(id) : null) ??
      game.i18n.localize("REDSTEEL.Aim.UnknownTarget");

    container.html(
      bonus > 0
        ? `<div class="rs-versus-target">${game.i18n.format(
            "REDSTEEL.Aim.DefenseHint",
            { stacks, bonus },
          )}</div>`
        : `<div class="rs-versus-target rs-aim-mismatch">${game.i18n.format(
            "REDSTEEL.Aim.DefenseMismatch",
            { target: name(aimTargetId), attacker: name(against) },
          )}</div>`,
    );
  }

  /** A token's name, looked up in the scene this defense is happening on. */
  function tokenName(tokenId) {
    const scene = defenderToken?.parent ?? canvas?.scene ?? null;
    return scene?.tokens?.get(tokenId)?.name ?? null;
  }

  /* -------------------------------------------- */
  /*  WEAPON DIALOG                               */
  /* -------------------------------------------- */

  function showWeaponDialog(weapons, onSelect) {
    new Dialog({
      title: "Select Weapon",
      content: `
      <form>
        <fieldset>
          <ul id="weapon-list" style="list-style:none;padding:0;">
            ${weapons
              .map(
                (weapon, index) => `
                <li class="weapon-choice"
                    data-value="${index}"
                    style="cursor:pointer;padding:5px;border-bottom:1px solid #444;">
                  ${weapon.localizedName ?? weapon.name}
                </li>`,
              )
              .join("")}
          </ul>
        </fieldset>
      </form>
      `,
      buttons: {},
      resizable: true,
      width: 200,
      height: 100,
      render: (html) => {
        html.find("#weapon-list li").click(async (event) => {
          const index = Number(event.currentTarget.dataset.value);
          await onSelect(index);
        });
      },
    }).render(true);
  }
  /* -------------------------------------------- */
  /*  MELEE DEFENSE                               */
  /* -------------------------------------------- */
  async function meleeDefense({
    ability = null,
    weapon = null,
    overwhelm = null,
    longReachPenalty = 0,
    useBane = false,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;
      const rollName = `Defense with ${weapon.localizedName ?? weapon.name}`;
      // Records the attacker and settles the number in one step. Null means the
      // caller passed no override (an ability-driven defense that never showed
      // the dialog), so the tracked value stands.
      const overwhelmStacks = await commitOverwhelm(overwhelm);
      console.log("DEFENSE CONTEXT:", context);

      // Weapon, off-hand, doctrine, spec, Aim and Bane terms: see
      // buildDefenseProfile, which auto-defense scores from as well.
      const profile = await buildDefenseProfile({
        actor,
        mode: "melee",
        context,
        ability,
        defenderToken,
        attackerTokenId: defendingAgainstId(),
        overwhelmStacks,
        longReachPenalty,
        useBane,
      });
      const aimDefense = profile.aimDefense;

      // Advantageous Maneuver: a parry that holds may be turned into an Aim on
      // the attacker for Stamina. Built here rather than in the card, because
      // this is the only scope that knows both the weapon context that gates it
      // and the attacker it would point at.
      const maneuver = buildManeuverFlag({
        actor,
        token: defenderToken,
        weapon,
        context,
        attackerTokenId: defendingAgainstId(),
        defenseKey: "meleeDefense",
      });

      const criticalSuccessThreshold = profile.critSuccess;
      const criticalFailureThreshold = profile.critFailure;

      const roll = new Roll(
        profile.formula,
        withRollBias(profile.rollData, actor),
      );
      tagRollSkill(roll, profile.skillKey);
      if (auto) tagAutoDefenseRoll(roll);

      await roll.evaluate();

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelmStacks,
        {
          deflectValue: Number(actor.system.defenseDeflect) || 0,
          defenseKey: "meleeDefense",
          useBane,
          aimDefense,
          maneuver,
        },
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) {
        return resolveWithContext(context);
      }
    }
    /* -------------------------------------------- */
    /*  IF WEAPON ALREADY KNOWN → SKIP DIALOG       */
    /* -------------------------------------------- */
    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    /* -------------------------------------------- */
    /*  OTHERWISE → ASK PLAYER                     */
    /* -------------------------------------------- */
    const weapons = actor.items.filter(
      (i) =>
        i.type === "weapon" &&
        ["axe", "sword", "blunt", "polearm"].includes(i.system.class) &&
        i.system.thrown !== true,
    );

    if (!weapons.length) {
      ui.notifications.warn("This actor has no melee weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  /* -------------------------------------------- */
  /*  RANGED DEFENSE                              */
  /* -------------------------------------------- */
  async function rangedDefense({
    ability = null,
    weapon = null,
    overwhelm = null,
    useBane = false,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;

      const rollName = `Ranged defense with ${weapon.localizedName ?? weapon.name}`;

      // Records the attacker and settles the number in one step. Null means the
      // caller passed no override (an ability-driven defense that never showed
      // the dialog), so the tracked value stands.
      const overwhelmStacks = await commitOverwhelm(overwhelm);

      // Doctrine, ability and Bane terms: see buildDefenseProfile, which
      // auto-defense scores from as well.
      const profile = await buildDefenseProfile({
        actor,
        mode: "ranged",
        context,
        ability,
        defenderToken,
        attackerTokenId: defendingAgainstId(),
        overwhelmStacks,
        useBane,
      });

      const criticalSuccessThreshold = profile.critSuccess;
      const criticalFailureThreshold = profile.critFailure;

      const roll = new Roll(
        profile.formula,
        withRollBias(profile.rollData, actor),
      );
      tagRollSkill(roll, profile.skillKey);
      if (auto) tagAutoDefenseRoll(roll);

      await roll.evaluate();

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelmStacks,
        { defenseKey: "rangedDefense", useBane },
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) return resolveWithContext(context);
    }

    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    const weapons = actor.items.filter((i) => i.type === "weapon");

    if (!weapons.length) {
      ui.notifications.warn("This actor has no weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  /* -------------------------------------------- */
  /*  DODGE DEFENSE                               */
  /* -------------------------------------------- */

  async function dodgeDefense({
    ability = null,
    weapon = null,
    overwhelm = null,
    useBane = false,
    blindside = false,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;

      const rollName = blindside
        ? game.i18n.format("REDSTEEL.Defense.BlindsideDodgeRoll", {
            weapon: weapon.localizedName ?? weapon.name,
          })
        : `Dodge with ${weapon.localizedName ?? weapon.name}`;

      // Records the attacker and settles the number in one step. Null means the
      // caller passed no override (an ability-driven defense that never showed
      // the dialog), so the tracked value stands.
      const overwhelmStacks = await commitOverwhelm(overwhelm);

      // Weapon, off-hand, ability and Bane terms: see buildDefenseProfile,
      // which auto-defense scores from as well. Built before the stamina is
      // spent, which is when the old inline sums were read too.
      const profile = await buildDefenseProfile({
        actor,
        mode: "dodge",
        context,
        ability,
        defenderToken,
        attackerTokenId: defendingAgainstId(),
        overwhelmStacks,
        useBane,
      });

      const criticalSuccessThreshold = profile.critSuccess;
      const criticalFailureThreshold = profile.critFailure;

      const staminaCost = 4;
      const stamina = actor.system.stats.stamina.value ?? 0;

      if (stamina < staminaCost) {
        ui.notifications.warn("Not enough stamina!");
        return;
      }

      await actor.update({
        "system.stats.stamina.value": stamina - staminaCost,
      });

      const roll = new Roll(
        profile.formula,
        withRollBias(profile.rollData, actor),
      );
      tagRollSkill(roll, profile.skillKey);
      if (auto) tagAutoDefenseRoll(roll);
      await roll.evaluate();
      const d100 = roll.dice.find((d) => d.faces === 100);
      const d100Result = d100?.total;
      // Read off the raw die alone: the margin has no say in it, and gating on
      // a successful margin here used to hide the label on every roll that
      // actually needed it.
      const badDodge = isBadDodge(actor, d100Result);

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelmStacks,
        {
          badDodge,
          deflectValue: Number(actor.system.dodgeDeflect) || 0,
          defenseKey: "dodge",
          useBane,
        },
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) return resolveWithContext(context);
    }

    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    const weapons = actor.items.filter((i) => i.type === "weapon");

    if (!weapons.length) {
      ui.notifications.warn("This actor has no weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  async function spellDefense({ overwhelm = null } = {}) {
    // Settled only once the defense has actually paid its resource cost. Both
    // branches below can bail out on "not enough Holy Energy / Mana", and a
    // defense that never rolled must not leave a phantom attacker in the set.
    let overwhelmStacks = 0;
    let overwhelmPenalty = 0;

    const settleOverwhelm = async () => {
      overwhelmStacks = await commitOverwhelm(overwhelm);
      overwhelmPenalty = overwhelmStacks * OVERWHELM_PENALTY_PER_STACK;
    };

    // ─────────────────────────────
    // Priest: Holy Defense
    // ─────────────────────────────
    if (actor.system.priest) {
      let holyEnergy = actor.system.stats.holyEnergy.value ?? 0;
      let holyEnergyCast = actor.system.stats.holyEnergy.cast ?? 0;

      if (holyEnergy <= 0) {
        ui.notifications.warn("Not enough Holy Energy!");
        return;
      }

      await actor.update({
        "system.stats.holyEnergy.value": holyEnergy - 1,
      });

      await settleOverwhelm();

      const faith = actor.system.secondaryAttributes.fth.total ?? 0;

      const roll = new Roll(
        "@holyEnergyCast + @faithBonus + @overwhelmPenalty - 1d100",
        withRollBias(
          {
            holyEnergyCast,
            faithBonus: faith * 8,
            overwhelmPenalty,
          },
          actor,
        ),
      );

      await roll.evaluate();

      // Faith tests know no critical success or failure ("vyjma Víry, Rychlosti
      // a Mentálního souboje"), so this contest is decided on margins alone.
      const versus = resolveVersusAttack({
        defenseTotal: roll.total,
        defenseD100: roll.dice.find((d) => d.faces === 100)?.total ?? null,
        defenseCrit: false,
      });

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<strong>Holy Defense</strong>${versus.html}`,
        flags: {
          redsteel: {
            traitPills: getTraitPills(actor, "defense"),
            versus: versus.versus,
          },
        },
      });

      return;
    }

    // ─────────────────────────────
    // Magic Defense (non-priests)
    // ─────────────────────────────

    const defenseLevels = {
      Wild: 0,
      Apprentice: 1,
      Expert: 2,
      Master: 3,
      Grandmaster: 5,
    };

    new Dialog({
      title: "Magic defense",
      content: `<p>Select your Magic defense level:</p>`,
      buttons: Object.entries(defenseLevels).reduce(
        (buttons, [level, cost]) => {
          buttons[level] = {
            label: `${level} (-${cost} Mana)`,
            callback: async () => {
              const mana = actor.system.stats.mana.value ?? 0;

              if (mana < cost) {
                ui.notifications.warn("Not enough Mana!");
                return;
              }

              await actor.update({
                "system.stats.mana.value": mana - cost,
              });

              await settleOverwhelm();

              // School of Blood ranks only harden the defender against Blood
              // spells, so the bonus needs the card being answered.
              const bloodSchoolBonus =
                attack?.spellSchool === "blood"
                  ? getBloodSchoolRankBonus(actor)
                  : 0;

              const rating =
                actor.system.combatSkills.channeling.rating +
                actor.system.combatSkills.channeling.defense +
                bloodSchoolBonus;

              const roll = new Roll(
                "@rating + @overwhelmPenalty - 1d100",
                withRollBias({ rating, overwhelmPenalty }, actor),
              );

              await roll.evaluate();

              // Channeling defense posts no crit thresholds of its own, so the
              // contest rests on margins here too.
              const versus = resolveVersusAttack({
                defenseTotal: roll.total,
                defenseD100:
                  roll.dice.find((d) => d.faces === 100)?.total ?? null,
                defenseCrit: false,
              });

              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `
                <div style="display:flex;align-items:center;gap:8px;font-weight:bold;">
                  <img src="icons/magic/defensive/shield-barrier-blades-teal.webp" width="36" height="36">
                  <span>Magic Defense (${level})</span>
                </div>

                ${overwhelmStacks > 0 ? `<p style="text-align:center">${game.i18n.localize("REDSTEEL.Overwhelm.Label")}: ${overwhelmPenalty}</p>` : ""}
                ${bloodSchoolBonus > 0 ? `<p style="text-align:center">${game.i18n.format("REDSTEEL.Defense.BloodSchoolBonus", { bonus: bloodSchoolBonus })}</p>` : ""}
                ${versus.html}
                `,
                flags: {
                  redsteel: {
                    traitPills: getTraitPills(actor, "defense"),
                    versus: versus.versus,
                  },
                },
              });
            },
          };

          return buttons;
        },
        {},
      ),
      default: "Wild",
    }).render(true);
  }
  /* -------------------------------------------- */
  /*  CHAT MESSAGE                                */
  /* -------------------------------------------- */

  async function createDefenseChatMessage(
    roll,
    weapon,
    rollName,
    criticalSuccessThreshold,
    criticalFailureThreshold,
    overwhelm,
    {
      badDodge = false,
      deflectValue = 0,
      defenseKey = "meleeDefense",
      useBane = false,
      aimDefense = null,
      maneuver = null,
    } = {},
  ) {
    const rollResult = roll.dice[0].total;

    // Deflect (Odklonění): auto-roll the chance and surface it on the card,
    // mirroring how attack "precision" is displayed. Manual beyond the roll.
    let deflectHTML = "";
    const deflectChance = Math.floor(Number(deflectValue) || 0);
    if (deflectChance > 0) {
      const deflectRoll = new Roll("1d100");
      await deflectRoll.evaluate();
      const deflectLabel = game.i18n.localize("REDSTEEL.UI.deflect");
      const successText =
        deflectRoll.total <= deflectChance
          ? `<i class="fa-regular fa-star" style="--fa-primary-color: #c4c700; --fa-secondary-color: #5c5400;"></i> SUCCESS`
          : ``;
      deflectHTML = `<p style="text-align:center;"><b>${deflectLabel}:</b> ${deflectRoll.total} < ${deflectChance}% ${successText}</p>`;
    }

    // Desperate Effort shifts the crit thresholds for this defense roll.
    const { successThreshold, failureThreshold } = applyDesperateCrit(
      roll,
      criticalSuccessThreshold,
      criticalFailureThreshold,
    );
    const critSuccess = rollResult <= successThreshold;
    const critFailure = rollResult >= failureThreshold;

    const armorTable = renderArmorTable(actor);

    const traitPills = getTraitPills(actor, "defense");
    if (useBane) {
      traitPills.push({
        name: game.i18n.localize("REDSTEEL.Banes.Label"),
        description: game.i18n.localize("REDSTEEL.Banes.DefenseToggle"),
      });
    }

    // Weapon Skill 4+ / Swordsman 3+ let the defender claim temporary HP off
    // this defense. Null on every card that has no claim, which is the signal
    // for the button not to render.
    const tempHealthGrant = buildTempHealthGrantFlag(actor, weapon, defenseKey);

    // The Bad Dodge penalty: the margin this defense contests with is capped at
    // 0, so a dodge that beat its limit can no longer out-margin the blow, only
    // tie a blow that was itself a failure.
    const contestedTotal = badDodgeMargin(roll.total, badDodge);

    // Nothing when the defense was launched from the hotbar: the margin only
    // arrives when a Defend button names the attack being answered.
    const versus = resolveVersusAttack({
      defenseTotal: contestedTotal,
      defenseD100: rollResult,
      defenseCrit: critSuccess,
      defenseCritFailure: critFailure,
    });

    // Whether the guard actually held. The contested result is the truth when
    // this defense answered an attack card; otherwise the roll's own margin is
    // all there is to go on. Only ever dims the Temporary Health claim, never
    // blocks it: the rule is the GM's to apply, not the card's to enforce.
    const defenseFailed = versus.versus
      ? !versus.versus.blocked
      : contestedTotal < 0;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: [roll],
      flavor: `
        <div style="display:flex;align-items:center;gap:8px;font-weight:bold;">
          <img src="${weapon.img}" width="36" height="36">
          <span>${rollName}</span>
        </div>
        <hr>
        <p class="rs-card-headline"><b>
          ${
            critSuccess
              ? "Critical Success!"
              : critFailure
                ? "Critical Failure!"
                : badDodge
                  ? game.i18n.localize("REDSTEEL.Defense.BadDodge")
                  : ""
          }

        </b></p>
          ${
            badDodge && roll.total > 0
              ? `<p class="rs-bad-dodge-note">${game.i18n.format(
                  "REDSTEEL.Defense.BadDodgeNote",
                  { limit: Number(actor.system?.dodgeLimit?.total) || 0 },
                )}</p>`
              : ""
          }
          ${
            auto
              ? `<p class="rs-auto-defense-note"><i class="fa-light fa-bolt-auto"></i> ${game.i18n.localize(
                  "REDSTEEL.AutoDefense.CardNote",
                )}</p>`
              : ""
          }
          <div style="display:flex;justify-content:center;align-items:center;gap:8px;font-size:1.3em;font-weight:bold;">
            ${overwhelm > 0 ? `<p>${game.i18n.localize("REDSTEEL.Overwhelm.Label")}: ${overwhelm * OVERWHELM_PENALTY_PER_STACK}</p>` : ""}
            ${
              aimDefense?.bonus > 0
                ? `<p>${game.i18n.format("REDSTEEL.Aim.DefenseBonus", {
                    stacks: aimDefense.stacks,
                    bonus: aimDefense.bonus,
                  })}</p>`
                : ""
            }
          </div>
       ${versus.html}
       ${deflectHTML}
       ${armorTable}
      `,
      flags: {
        redsteel: {
          rollName,
          criticalSuccessThreshold,
          criticalFailureThreshold,
          traitPills,
          // Reroll tokens for the chat reroll picker: "defense" + the defense
          // skill + its governing attribute (dodge→dex, ranged→per, melee→dex
          // unless steelGrip/predatorySenses flips it).
          rerollTokens: getDefenseRerollTokens(defenseKey),
          // Rolled by the NPC itself rather than by a person clicking Defend.
          // The card already says so in words (rs-auto-defense-note); the flag
          // is what lets the chat log fold these away by default, since nobody
          // is waiting on them (utils/chatCardCollapse.mjs).
          ...(auto ? { autoDefense: true } : {}),
          // The attack this card answered, kept whole rather than only as the
          // resolved `versus` below: a reroll of this defense has to contest
          // the same attack again from a different die, and the crit flags and
          // raw die are part of that contest.
          ...(versus.versus ? { versusAttack: attack ?? null } : {}),
          ...(versus.versus ? { versus: versus.versus } : {}),
          ...(tempHealthGrant
            ? { tempHealthGrant: { ...tempHealthGrant, defenseFailed } }
            : {}),
          // Carries `defenseFailed` for the same reason the grant above does:
          // the card is the only place that knows whether the guard held, and
          // the button hook has nothing else to read it from.
          ...(maneuver
            ? { advantageousManeuver: { ...maneuver, defenseFailed } }
            : {}),
          // Who defended against whom, with what, and whether it held. The
          // hotbar's reaction suggestions (Counterattack, Retaliatory strike)
          // read this back off the chat log rather than storing anything, so
          // the card stamps the combat moment it belongs to: a suggestion
          // lives only for the turn its defense was rolled in.
          defense: {
            defenderTokenId: defenderToken?.id ?? null,
            attackerTokenId: defendingAgainstId() ?? null,
            defenseKey,
            succeeded: !defenseFailed,
            attackAbilityKey: attack?.abilityKey ?? null,
            attackTags: Array.isArray(attack?.attackTags) ? attack.attackTags : [],
            combat: game.combat?.started
              ? {
                  id: game.combat.id,
                  round: game.combat.round,
                  turn: game.combat.turn,
                }
              : null,
          },
        },
      },
    });
  }
}

/**
 * Put a Defend button on every attack card.
 *
 * This is the binding that makes Overwhelm exact. The card already knows who
 * swung (its speaker), so answering the card carries the attacker's identity
 * into the defense roll as a fact, where a defense launched from the hotbar can
 * only fall back to guessing from the newest attack card.
 *
 * Shown to everyone except the attacker's own player. The GM keeps it on their
 * own cards because NPC-versus-NPC is a normal thing to have to roll.
 */
export function registerDefendButton() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.flags?.attack?.type !== "attack") return;
    // A versus Test card (Shield Bash, Shield Charge, Knockdown …) is answered
    // by clicking its margin, not by rolling a defense. Offering a Defend
    // button there would burn a defense on a contest it cannot resolve.
    if (message.flags.attack.contested) return;

    const attackerTokenId = attackerTokenIdFromMessage(message);
    if (!attackerTokenId) return;

    // `rolls[0]` is the fallback for cards posted before the margin was stored
    // on the flag, so older chat history stays answerable. Those cards carry no
    // crit flag or raw die, which degrades to a plain margin contest.
    const attack = {
      margin: message.flags.attack.margin ?? message.rolls?.[0]?.total ?? null,
      criticalSuccess: message.flags.attack.criticalSuccess === true,
      // A fumbled attack is a natural critical for the defender, so it belongs
      // in the packet the versus block reads — without it the defense contests
      // the fumble on margins alone.
      criticalFailure: message.flags.attack.criticalFailure === true,
      d100: message.flags.attack.d100 ?? null,
      // Magic Defense against a Blood spell takes the School of Blood rank bonus.
      spellSchool: message.flags?.redsteel?.spellSchool ?? null,
      // Where each target stood when the blow was thrown, keyed by token id
      // (utils/positioning.mjs). Absent on cards written before positioning
      // existed and on attacks that named no target, and the defense falls back
      // to live token facing in both cases.
      positioning: message.flags.attack.positioning ?? null,
      // Tulák IX lowers the attacker's critical threshold on a Weak Spot
      // action. Absent on every other card, where the versus block falls back
      // to the usual 60.
      criticalGap: message.flags.attack.criticalGap ?? null,
      // Which ability swung and its tags ("opportunity"), carried onto the
      // defense card so the reaction suggestions can tell a Counterattack or
      // an Opportunity Attack (which cannot be answered in kind) from a blow.
      abilityKey: message.flags?.redsteel?.abilityKey ?? null,
      attackTags: message.flags?.redsteel?.attackTags ?? [],
    };

    const isAuthor = game.user.id === message.author?.id;
    if (isAuthor && !game.user.isGM) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    // The hook can fire more than once against the same element.
    if (buttonContainer.querySelector(".rs-defend-button")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rs-defend-button";
    button.innerHTML = `<i class="fa-light fa-shield"></i><span>${game.i18n.localize(
      "REDSTEEL.Overwhelm.Defend",
    )}</span>`;
    button.dataset.tooltip = game.i18n.localize(
      "REDSTEEL.Overwhelm.DefendTooltip",
    );

    // The defender is resolved at click time, not render time: which token you
    // control changes long after the card was drawn.
    button.addEventListener("click", () =>
      defenseRoll({ attackerTokenId, attack }),
    );

    buttonContainer.appendChild(button);
    // Lays the container out as one flex row: the Defend button is the last
    // thing appended to an attack card, so this puts Re-Roll / Apply Damage /
    // Defend side by side with Defend rightmost, rather than on a second row.
    buttonContainer.classList.add("has-defend");
  });
}

function buildWeaponSetView(actor) {
  const sets = actor.system.combat.weaponSets;
  const result = {};

  for (const setId of [1, 2]) {
    const slots = sets?.[setId] ?? {};
    const main = slots.main ? actor.items.get(slots.main) : null;
    const off = slots.off ? actor.items.get(slots.off) : null;

    const mainIsTwoHanded = main
      ? main.system.type === "heavy" ||
        ["crossbow", "bow"].includes(main.system.class) ||
        main.system.gripMode === "two"
      : false;

    const offIsShield = !!off?.system?.shield;

    result[setId] = {
      main,
      off,
      mainIsTwoHanded,
      offIsShield,
    };
  }

  return result;
}
function renderWeaponLoadoutsDialog(actor) {
  const weaponSets = buildWeaponSetView(actor);
  const activeSet = actor.system.combat.activeWeaponSet;

  return `
<section class="weapon-loadouts horizontal active-set-${activeSet}">

  ${[1, 2]
    .map((setId) => {
      const ws = weaponSets[setId];

      return `
<div class="weapon-set-block">
  <div class="weapon-loadout-label">Set ${setId}</div>

  <div class="weapon-slot-row">

    <!-- MAIN -->
    <div class="weapon-slot main ${ws.main ? "filled" : "empty"}"
         data-set="${setId}" data-slot="main">
      ${
        ws.main
          ? `<img src="${ws.main.img}" title="${ws.main.localizedName ?? ws.main.name}">`
          : `<span>Main</span>`
      }
    </div>

    <!-- OFF -->
    <div class="weapon-slot off
      ${ws.mainIsTwoHanded ? "blocked" : ws.off ? "filled" : "empty"}
      ${ws.offIsShield ? "shield" : ""}"
      data-set="${setId}" data-slot="off">

      ${
        ws.mainIsTwoHanded
          ? `
            <div class="two-handed-ghost">
              <img src="${ws.main.img}"
                   title="${ws.main.localizedName ?? ws.main.name} (Two-handed)"
                   width="44" height="44">
            </div>
          `
          : ws.off
            ? `<img src="${ws.off.img}" title="${ws.off.localizedName ?? ws.off.name}" width="44" height="44">`
            : `<span>Off</span>`
      }

    </div>

  </div>
</div>
`;
    })
    .join("")}

  <div class="weapon-set-switcher">
    <button type="button"
      class="weapon-set-toggle set-${activeSet}"
      title="Switch Weapon Set">
      <i class="fa-sharp fa-regular fa-arrows-repeat"></i>
    </button>
  </div>

</section>
`;
}

function getOffhandProps(weaponContext) {
  if (!weaponContext?.isDualWield || !weaponContext.offWeapon) {
    return null;
  }
  return weaponContext.offWeapon.system.offhandProperties ?? null;
}

/**
 * Quality modifiers (Druhá ruka column) of the off-hand weapon, when dual
 * wielding. Returns an empty object otherwise so callers can read keys safely.
 */
function getOffhandQualityMods(weaponContext) {
  if (!weaponContext?.isDualWield || !weaponContext.offWeapon) {
    return {};
  }
  return weaponContext.offWeapon.system.offhandQualityMods ?? {};
}
