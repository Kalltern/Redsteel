/**
 * Bonuses owed to the caster's NEXT spell (Veneficus and Elymas
 * specialisations).
 *
 * Three nodes leave something behind for the spell that comes after a fight
 * action:
 *   Magický veterán (magickyVeteran) — each Critical degree given up eases the
 *     next spell's Difficulty by 10.
 *   Zabije-li cíl Soubojem, sleva 2 many (slevaMany) — a melee kill takes 2
 *     Mana off the next spell.
 *   Navazující kouzlo (navazujiciKouzlo) — a kill with a magically empowered
 *     attack gives +10% Channeling to the next spell of that school.
 *   Magická ozvěna (Elymas magickaOzvena) — a Critical Magic Defense takes
 *     50% off the next spell's Mana.
 *
 * The producers live in utils/veneficus.mjs and utils/elymas.mjs; this module
 * only stores and reads. Kept standalone, importing nothing from the cast pipeline, for the
 * same reason lindarCharge.mjs is: castSpell.mjs and magicSkillBonuses.mjs
 * already import each other.
 *
 * State is one actor flag, `nextSpell`:
 *   { manaDiscount: number, manaDiscountPct: number, difficulty: number,
 *     channeling: [{ school: string, bonus: number }] }
 * `manaDiscountPct` is a percentage off what is left of the cost after the
 * flat discount; two of them do not add up, the larger one stands (at most
 * MAX_MANA_DISCOUNT_PCT).
 * The discounts and the Difficulty go to whichever spell is cast next; a
 * Channeling entry waits for a spell of its own school. All of it is spent by
 * consumeNextSpellBonus when a cast actually happens (castSpell.mjs
 * performCast). Miracles are not spells for any of this and never touch it.
 */

const SYSTEM_ID = "redsteel";
const FLAG = "nextSpell";

/** The largest percentage discount the next spell can be owed. */
const MAX_MANA_DISCOUNT_PCT = 50;

/** A percentage clamped to 0..MAX_MANA_DISCOUNT_PCT. */
function clampPct(value) {
  return Math.min(MAX_MANA_DISCOUNT_PCT, Math.max(0, Number(value) || 0));
}

/**
 * Miracles are paid in Holy Energy and rolled on Faith: none of this applies.
 * Same test as miracles.mjs isMiracle, inlined to keep this module free of
 * imports.
 */
function isMiracleSpell(spell) {
  return spell?.type === "spell" && spell.system?.option === "divine";
}

/**
 * The stored record, normalised.
 *
 * @param {Actor} actor
 * @returns {{manaDiscount: number, manaDiscountPct: number, difficulty: number,
 *   channeling: {school: string, bonus: number}[]}}
 */
export function readNextSpellBonus(actor) {
  const raw = actor?.getFlag?.(SYSTEM_ID, FLAG) ?? {};
  return {
    manaDiscount: Math.max(0, Number(raw.manaDiscount) || 0),
    manaDiscountPct: clampPct(raw.manaDiscountPct),
    difficulty: Math.max(0, Number(raw.difficulty) || 0),
    channeling: (Array.isArray(raw.channeling) ? raw.channeling : [])
      .filter((c) => c?.school && Number(c.bonus) > 0)
      .map((c) => ({ school: String(c.school), bonus: Number(c.bonus) })),
  };
}

/**
 * Add to what the next spell is owed. Amounts accumulate: two melee kills
 * before casting are 4 Mana off. A percentage discount does not: the larger
 * of the stored and the new one stands.
 *
 * @param {Actor} actor
 * @param {{manaDiscount?: number, manaDiscountPct?: number,
 *   difficulty?: number,
 *   channeling?: {school: string, bonus: number}}} add
 */
export async function addNextSpellBonus(
  actor,
  {
    manaDiscount = 0,
    manaDiscountPct = 0,
    difficulty = 0,
    channeling = null,
  } = {},
) {
  if (!actor) return;
  const current = readNextSpellBonus(actor);
  const next = {
    manaDiscount: current.manaDiscount + Math.max(0, Number(manaDiscount) || 0),
    manaDiscountPct: Math.max(current.manaDiscountPct, clampPct(manaDiscountPct)),
    difficulty: current.difficulty + Math.max(0, Number(difficulty) || 0),
    channeling: [...current.channeling],
  };
  if (channeling?.school && Number(channeling.bonus) > 0) {
    next.channeling.push({
      school: String(channeling.school),
      bonus: Number(channeling.bonus),
    });
  }
  await actor.setFlag(SYSTEM_ID, FLAG, next);
}

/**
 * Mana taken off this spell's cast cost. Blood spells pay from the blood pool
 * and miracles in Holy Energy, so neither is discounted.
 *
 * The flat discount first, then the percentage off what is left of `cost`,
 * rounded down. Without `cost` only the flat discount can be worked out.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @param {number|null} [cost]  the cost before this discount (other discounts
 *   such as Lindar's Charge already taken off)
 * @returns {number}
 */
export function nextSpellManaDiscount(actor, spell, cost = null) {
  if (isMiracleSpell(spell) || spell?.system?.type === "blood") return 0;
  const { manaDiscount, manaDiscountPct } = readNextSpellBonus(actor);
  if (!manaDiscountPct || cost === null) return manaDiscount;
  const remaining = Math.max(0, (Number(cost) || 0) - manaDiscount);
  return manaDiscount + Math.floor((remaining * manaDiscountPct) / 100);
}

/**
 * Channeling bonus this spell collects: every entry of its own school.
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {number}
 */
export function nextSpellChanneling(actor, spell) {
  if (isMiracleSpell(spell)) return 0;
  const school = spell?.system?.type ?? null;
  if (!school) return 0;
  return readNextSpellBonus(actor)
    .channeling.filter((c) => c.school === school)
    .reduce((sum, c) => sum + c.bonus, 0);
}

/**
 * Difficulty eased on this spell (added to the cast's difficultyBonus, which
 * getEffectiveDifficulty clamps at 0 like every other reduction).
 *
 * @param {Actor} actor
 * @param {Item} spell
 * @returns {number}
 */
export function nextSpellDifficulty(actor, spell) {
  if (isMiracleSpell(spell)) return 0;
  return readNextSpellBonus(actor).difficulty;
}

/**
 * A spell was cast: spend what it collected. The discounts and the Difficulty
 * always go; Channeling entries only for this spell's school.
 *
 * @param {Actor} actor
 * @param {Item} spell
 */
export async function consumeNextSpellBonus(actor, spell) {
  if (!actor || isMiracleSpell(spell)) return;
  if (!actor.getFlag(SYSTEM_ID, FLAG)) return;
  const current = readNextSpellBonus(actor);
  const school = spell?.system?.type ?? null;
  const channeling = current.channeling.filter((c) => c.school !== school);
  if (!channeling.length) {
    await actor.unsetFlag(SYSTEM_ID, FLAG);
    return;
  }
  await actor.setFlag(SYSTEM_ID, FLAG, {
    manaDiscount: 0,
    manaDiscountPct: 0,
    difficulty: 0,
    channeling,
  });
}
