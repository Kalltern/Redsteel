/**
 * The versus verdict and the odds of a defense winning it.
 *
 * Pure on purpose: no `game`, no `ui`, no `Roll`. The verdict is the one rule
 * both the defense card (defense.mjs → renderVersusBlock) and NPC auto-defense
 * (autoDefense.mjs → pickBestDefense) read, and keeping it here is what stops
 * the two from drifting apart. It also means the whole thing can be exercised
 * in plain Node without a Foundry world.
 */

/** "Úspěšný zásah, který je o 60 silnější než protivníkova obrana." */
export const CRITICAL_GAP = 60;

/**
 * Settle a defense against the attack it is answering.
 *
 * Defense is a versus Test ("Alternativní forma obrany, versus Test Úhybu
 * proti Zásahu oponenta"), so the two margins are compared directly and the
 * gap between them is the number the rules read. Two things outrank that plain
 * comparison, in this order:
 *
 * 1. A *natural* critical roll is absolute. It settles the contest on its own
 *    and the margins stop mattering. Only the *other side's* natural critical
 *    can deny one; denied criticals fall back to whoever rolled closer to 1 on
 *    the d100, with a tie going to the attacker as every versus Test does.
 * 2. Failing any natural critical, a side that is 60 clear on margin is
 *    critical, and below that the plain margin comparison decides. A tied
 *    margin is not blocked: the attacker wins ties.
 *
 * Rendering lives in defense.mjs; this is only the verdict, so a caller that
 * wants to ask "would this hold?" a hundred times does not build HTML for it.
 *
 * @param {object|null} attack  `{margin, criticalSuccess, criticalFailure, d100,
 *   criticalGap}`. A null/absent margin means "not answering a card".
 * @param {object} params
 * @param {number} params.defenseTotal   this defense's own (contested) margin
 * @param {number|null} params.defenseD100 the raw die, for the crit tiebreak
 * @param {boolean} params.defenseCrit   natural critical success on defense
 * @param {boolean} params.defenseCritFailure natural critical failure on defense
 * @returns {{attackMargin: number, gap: number, blocked: boolean,
 *   critical: "defense"|"hit"|null, onDice: boolean}|null}
 */
export function resolveVersus(
  attack,
  {
    defenseTotal,
    defenseD100 = null,
    defenseCrit = false,
    defenseCritFailure = false,
  } = {},
) {
  // `== null` catches both null and undefined before the cast, because
  // Number(null) is 0 and a hotbar defense would otherwise contest a phantom
  // attack of margin zero.
  const parsedMargin = attack?.margin == null ? NaN : Number(attack.margin);
  if (!Number.isFinite(parsedMargin)) return null;
  const attackMargin = parsedMargin;

  const attackCrit = attack?.criticalSuccess === true;
  const attackCritFailure = attack?.criticalFailure === true;
  const attackD100 = attack?.d100 ?? null;

  // Tulák IX → "Útok/Vrh na slabinu: snížená hranice". A Weak Spot action by a
  // rank-9 Rogue crits on a margin of 40 rather than 60, so the threshold is a
  // property of the blow rather than a constant. It moves the ATTACK side only:
  // the defense still needs a full 60 to turn the guard into a Critical
  // Defense, because nothing lowered that.
  const attackCriticalGap = Number(attack?.criticalGap) || CRITICAL_GAP;

  const gap = defenseTotal - attackMargin;

  // Which side each natural critical favours. A fumble helps the other guy.
  const naturalForDefense = defenseCrit || attackCritFailure;
  const naturalForAttack = defenseCritFailure || attackCrit;

  let blocked;
  let critical = null; // "defense" | "hit" | null
  let onDice = false;

  if (naturalForDefense && naturalForAttack) {
    // Two natural criticals pulling opposite ways deny each other, and the
    // margins are ignored entirely: whoever rolled closer to 1 takes it.
    if (attackD100 != null && defenseD100 != null) {
      blocked = defenseD100 < attackD100;
      onDice = true;
    } else {
      blocked = gap > 0;
    }
  } else if (naturalForDefense) {
    blocked = true;
    critical = "defense";
  } else if (naturalForAttack) {
    blocked = false;
    critical = "hit";
  } else if (gap >= CRITICAL_GAP) {
    blocked = true;
    critical = "defense";
  } else if (-gap >= attackCriticalGap) {
    blocked = false;
    critical = "hit";
  } else {
    blocked = gap > 0;
  }

  return { attackMargin, gap, blocked, critical, onDice };
}

/**
 * How often each face of the kept d100 comes up, as integer weights out of
 * 10000 (index 1..100; index 0 is unused and 0).
 *
 * Integers rather than probabilities so two defenses that are exactly as good
 * compare as exactly equal, which is what lets the tie-break rule in
 * autoDefense.mjs actually fire. The sign of `bias` picks the die the roll
 * layer (rollModifier.mjs → applyModifier) would roll: 0 → one d100, advantage
 * (> 0) → 2d100kl, disadvantage (< 0) → 2d100kh. The size of the bias never
 * matters there, so it does not matter here either.
 *
 * - kh (max of two): P(max = k) = (2k − 1) / 10000
 * - kl (min of two): P(min = k) = (201 − 2k) / 10000
 *
 * @param {number} bias
 * @returns {number[]}
 */
export function dieWeights(bias) {
  const weights = new Array(101).fill(0);
  for (let k = 1; k <= 100; k++) {
    if (bias < 0) weights[k] = 2 * k - 1;
    else if (bias > 0) weights[k] = 201 - 2 * k;
    else weights[k] = 100;
  }
  return weights;
}

/**
 * The exact chance this defense beats an attack that has already been rolled,
 * as an integer out of 10000.
 *
 * Walks every face the kept die can show and asks {@link resolveVersus} the
 * same question the card will ask, with the same inputs the card will have.
 * That is the point: the non-linear parts (natural criticals, the 60 gap, the
 * attacker's tie, a Bad Dodge's capped margin) are the rules' own, not an
 * approximation of them, so a higher rating that still cannot clear a known
 * margin, or a dodge whose limit throws away its good dice, scores for what
 * it is actually worth.
 *
 * Every rule involved is monotonic in the kept die, so advantage really is
 * "better complete outcome" and weighting the faces is enough.
 *
 * @param {object} profile
 * @param {number} profile.rating       sum of every flat term in the formula
 * @param {number} profile.critSuccess  die <= this is a natural critical
 * @param {number} profile.critFailure  die >= this is a natural fumble
 * @param {number|null} [profile.dodgeLimit] dodge only: a die above it is a
 *   Bad Dodge, whose margin is capped at 0
 * @param {object} attack  the rolled attack, as {@link resolveVersus} reads it
 * @param {number} [bias=0] net advantage bias for this roll
 * @returns {number} 0..10000
 */
export function defenseWinChance(profile, attack, bias = 0) {
  const weights = dieWeights(bias);
  const rating = Number(profile?.rating) || 0;
  const critSuccess = Number(profile?.critSuccess);
  const critFailure = Number(profile?.critFailure);
  const dodgeLimit = Number(profile?.dodgeLimit);

  let won = 0;
  for (let die = 1; die <= 100; die++) {
    let margin = rating - die;
    // Same rule as defense.mjs → isBadDodge / badDodgeMargin: read off the raw
    // die, and only ever pulls a margin down to 0, never up.
    if (dodgeLimit > 0 && die > dodgeLimit) margin = Math.min(0, margin);

    const verdict = resolveVersus(attack, {
      defenseTotal: margin,
      defenseD100: die,
      defenseCrit: die <= critSuccess,
      defenseCritFailure: die >= critFailure,
    });
    if (verdict?.blocked) won += weights[die];
  }
  return won;
}
