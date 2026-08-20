/**
 * Rating breakdowns — "where did this number come from?".
 *
 * Every skill rating in this system is a sum of the same handful of terms: a
 * rank-table lookup, one or two attributes with a multiplier, the occasional
 * secondary attribute, the skill's own bonus and the actor-wide modifier.
 * `prepareDerivedData` records those terms right next to the rating it just
 * computed (`skill.ratingParts`), and the skill tooltip prints them, so a
 * player can see why Persuasion reads 85 without opening the rulebook.
 *
 * Parts are stored as data, never as finished text: labels are localized at
 * render time, so switching language does not need a re-prepare.
 *
 * A part is `{ type, value }` plus whatever its type needs:
 *   rank   {rank, sourceKey}  the rank-table lookup; `sourceKey` names where
 *                             the rank came from when it is not the skill's own
 *                             (Channeling reading the Combat rank, and so on)
 *   attr   {key, mult}   a primary attribute times its multiplier
 *   sec    {key, mult}   a secondary attribute (Visage, Sinfulness)
 *   flat   {labelKey}    a named one-off term
 *   base                 a stored starting number (sub-skills)
 *   bonus                the skill's `bonus` field, where perks and traits land
 *   global               the actor-wide `globalMod`
 *   other                reconciliation, see `reconcileParts`
 */

import { ttEscape } from "./tooltips.mjs";

const ROMAN = ["-", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** `str` -> `Str`, the casing the lang files use for attribute blocks. */
function capitalize(key) {
  const text = String(key ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function localizeOrNull(key) {
  const out = game.i18n.localize(key);
  return out === key ? null : out;
}

/* -------------------------------------------- */
/*  Recording                                   */
/* -------------------------------------------- */

/**
 * Build the part constructors for one `prepareDerivedData` pass.
 *
 * The constructors recompute each term from the same operands the rating
 * itself is built from, rather than being handed a finished number, so a
 * breakdown row cannot drift from the sum it belongs to.
 *
 * @param {object} opts
 * @param {object} opts.attributes  `system.attributes`, read for key order
 * @param {Array<{total:number}>} opts.attributeScore  value+bonus per attribute
 * @param {object} opts.secondaryAttributes  `system.secondaryAttributes`
 * @param {number} opts.globalMod   the actor-wide test modifier
 */
export function partBuilder({
  attributes,
  attributeScore,
  secondaryAttributes,
  globalMod,
}) {
  const attrKeys = Object.keys(attributes ?? {});
  const attrTotal = (i) => Number(attributeScore?.[i]?.total) || 0;
  const secTotal = (key) => Number(secondaryAttributes?.[key]?.total) || 0;

  return {
    rank: (rank, value, sourceKey = null) => ({
      type: "rank",
      rank: Number(rank) || 0,
      value: Number(value) || 0,
      sourceKey,
    }),
    attr: (index, mult) => ({
      type: "attr",
      key: attrKeys[index],
      mult,
      value: attrTotal(index) * mult,
    }),
    sec: (key, mult = 1) => ({
      type: "sec",
      key,
      mult,
      value: secTotal(key) * mult,
    }),
    flat: (labelKey, value) => ({
      type: "flat",
      labelKey,
      value: Number(value) || 0,
    }),
    base: (value) => ({ type: "base", value: Number(value) || 0 }),
    bonus: (value) => ({ type: "bonus", value: Number(value) || 0 }),
    global: () => ({ type: "global", value: Number(globalMod) || 0 }),
  };
}

/**
 * Make a recorded breakdown add up to the rating it describes.
 *
 * Ratings are adjusted after they are first computed: helmet penalties,
 * Active Effects replayed onto the derived number, one-off doctrine tweaks.
 * Rather than teach every one of those to push a part, the difference is
 * folded into a single "Other" row here. The tooltip then always sums to the
 * number printed on the sheet, and a term nobody recorded shows up as an
 * unexplained remainder instead of a silently wrong total.
 *
 * @param {object} target      the skill entry
 * @param {string} ratingKey   field holding the finished rating
 * @param {string} partsKey    field holding the recorded parts
 */
export function reconcileParts(
  target,
  ratingKey = "rating",
  partsKey = "ratingParts",
) {
  const parts = target?.[partsKey];
  if (!Array.isArray(parts) || !parts.length) return;

  const kept = parts.filter((p) => p.type !== "other");
  const sum = kept.reduce((total, p) => total + (Number(p.value) || 0), 0);
  const rest = Math.round(((Number(target[ratingKey]) || 0) - sum) * 100) / 100;

  target[partsKey] = rest ? [...kept, { type: "other", value: rest }] : kept;
}

/* -------------------------------------------- */
/*  Rendering                                   */
/* -------------------------------------------- */

/** Human label for one part. */
function partLabel(part) {
  // A part may carry its own finished label — the weapon row names the weapon.
  if (part.label) return part.label;
  switch (part.type) {
    case "rank": {
      const rank = game.i18n.format("REDSTEEL.Tooltip.Part.rank", {
        rank: ROMAN[part.rank] ?? part.rank,
      });
      const from = part.sourceKey ? localizeOrNull(part.sourceKey) : null;
      return from ? `${rank} (${from})` : rank;
    }
    case "attr": {
      const name =
        localizeOrNull(
          `REDSTEEL.Actor.Character.Attribute.${capitalize(part.key)}.long`,
        ) ?? part.key;
      return part.mult === 1 ? name : `${name} ×${part.mult}`;
    }
    case "sec": {
      const name =
        localizeOrNull(
          `REDSTEEL.Actor.Character.SecondaryAttribute.${capitalize(part.key)}.long`,
        ) ?? part.key;
      return part.mult === 1 ? name : `${name} ×${part.mult}`;
    }
    case "flat":
      return localizeOrNull(part.labelKey) ?? part.labelKey;
    case "base":
      return game.i18n.localize("REDSTEEL.Tooltip.Part.base");
    case "bonus":
      return game.i18n.localize("REDSTEEL.Tooltip.Part.bonus");
    case "global":
      return game.i18n.localize("REDSTEEL.Tooltip.Part.global");
    case "other":
      return game.i18n.localize("REDSTEEL.Tooltip.Part.other");
    default:
      return "";
  }
}

/** `+5` / `-5` / `0`, so the rows read as a sum. */
function signed(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : String(n);
}

/**
 * Named Active Effect contributions to one numeric field.
 *
 * Perks, traits and buffs all reach a skill through an ADD change on its
 * `bonus`, which is exactly the "+ potential traits or perks" line a player
 * wants named. Only ADD changes are listed: any other mode is not a term of a
 * sum and would be a lie inside a breakdown.
 *
 * @param {Actor} actor
 * @param {string} key  full change key, e.g. "system.skills.persuasion.bonus"
 * @returns {Array<{name: string, value: number}>}
 */
export function bonusSources(actor, key) {
  if (!actor || !key) return [];
  const out = [];
  for (const effect of actor.appliedEffects ?? []) {
    for (const change of effect.changes ?? []) {
      if (change.key !== key) continue;
      if (change.mode !== CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD) continue;
      const value = Number(change.value) || 0;
      if (!value) continue;
      out.push({ name: effect.name ?? effect.label ?? "", value });
    }
  }
  return out;
}

/**
 * Render a recorded breakdown as tooltip HTML.
 *
 * Zero rows are dropped, except the rank and attribute terms: those are the
 * skeleton of the formula, and a player reading "Charisma x5 -> 0" learns
 * something where "Bonus -> 0" is just noise.
 *
 * Pass no `total` to render a bare list with no sum, which is how the terms
 * that only apply when the dice are rolled are shown.
 *
 * @param {object} opts
 * @param {Array<object>} opts.parts
 * @param {number} [opts.total]      the number printed on the sheet; omit for
 *                                   a list with no total row
 * @param {string} [opts.totalLabel]
 * @param {string} [opts.label]      section heading, defaults to "Calculation"
 * @param {Actor}  [opts.actor]      enables naming the effects behind `bonus`
 * @param {string} [opts.bonusKey]   change key those effects target
 * @param {Array<{name: string, value: number}>} [opts.extraSources]
 *   further named contributions to `bonus` that no Active Effect accounts for
 *   — a shield, a weapon's own defense, a dual-wield penalty
 * @returns {string} HTML, or "" when there is nothing worth printing
 */
export function renderBreakdown({
  parts,
  total,
  totalLabel,
  label,
  actor,
  bonusKey,
  extraSources,
} = {}) {
  if (!Array.isArray(parts) || !parts.length) return "";
  const hasTotal = total !== undefined && total !== null;

  const rows = [];
  for (const part of parts) {
    const value = Number(part.value) || 0;
    const structural = part.type === "rank" || part.type === "attr";
    if (!value && !structural) continue;

    // Split an anonymous "Bonus" into the perks, traits and gear that made it.
    // Whatever the named sources do not account for stays behind as a plain
    // "Bonus" row, so the column still adds up to the same number.
    if (part.type === "bonus") {
      const named = [
        ...bonusSources(actor, bonusKey),
        ...(extraSources ?? []),
      ].filter((s) => s.value);
      if (named.length) {
        for (const source of named) {
          rows.push([source.name || partLabel(part), signed(source.value)]);
        }
        const rest = value - named.reduce((t, s) => t + s.value, 0);
        if (rest) rows.push([partLabel(part), signed(rest)]);
        continue;
      }
    }

    rows.push([partLabel(part), signed(value)]);
  }
  // A single row is a restatement of the number the player is already looking
  // at, not a breakdown — unless there is no total, where the list is the point.
  if (rows.length < (hasTotal ? 2 : 1)) return "";

  const body = rows
    .map(
      ([rowLabel, value]) =>
        `<div class="tt-calc-row"><span class="tt-calc-label">${ttEscape(rowLabel)}</span><span class="tt-calc-value">${ttEscape(value)}</span></div>`,
    )
    .join("");

  const totalRow = hasTotal
    ? `<div class="tt-calc-row tt-calc-total"><span class="tt-calc-label">${ttEscape(
        totalLabel ?? game.i18n.localize("REDSTEEL.Tooltip.Part.total"),
      )}</span><span class="tt-calc-value">${ttEscape(Number(total) || 0)}</span></div>`
    : "";

  return [
    `<div class="tt-section">`,
    `<div class="tt-section-label">${ttEscape(label ?? game.i18n.localize("REDSTEEL.Tooltip.Calculation"))}</div>`,
    `<div class="tt-calc">${body}${totalRow}</div>`,
    `</div>`,
  ].join("");
}
