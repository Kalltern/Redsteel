/**
 * View-model builders for the Spells / Miracles / Abilities feature-card
 * tabs. Cards mirror the `.npc-trait` card style used on the Features tab
 * (see templates/actor/features.hbs), but show a strip of stat pills
 * instead of an inline description; the full description surfaces in a
 * hover panel built from the same view-model.
 */

import { getSpellPower } from "./spellPower.mjs";

/**
 * Matches a spell-power placeholder in stored description prose, in any of the
 * forms the packs actually use: `{{spellPower}}`, `{{math spellPower}}`, and
 * `{{math spellPower "<op>" <n>}}` with an optional trailing `+ n` / `- n`.
 */
const SPELL_POWER_TOKEN = /\{\{\s*(?:math\s+)?spellPower\b([^}]*)\}\}/gi;

/**
 * Evaluate one placeholder's argument string against a spell power value.
 *
 * Multiplication and division floor their result: the rulebook always rounds
 * SK fractions down (the same rule `getSpellPower` documents), so SK 7 with
 * `"/" 2` reads 3, not 3.5. The `"/up"` operator is the opt-out, for the few
 * rules that spell out "rounded up" — SK 7 with `"/up" 2` reads 4.
 *
 * @param {string} rawArgs  Everything between `spellPower` and the closing `}}`.
 * @param {number} spellPower
 * @returns {number}
 */
function evaluateSpellPowerArgs(rawArgs, spellPower) {
  // Some stored descriptions have editor markup spliced into the middle of the
  // token (e.g. `"*" 2 </span>+ 1<span ...>`), so strip tags and decode the
  // entities the editor leaves behind before parsing.
  const args = String(rawArgs ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();

  if (!args) return spellPower;

  // `/up` is matched before the single-character operators so the "/" branch
  // cannot claim it and leave "up" stranded in the operand.
  const parsed = args.match(
    /^["']?(\/up|[*/+-])["']?\s*(-?\d+(?:\.\d+)?)(.*)$/,
  );
  // No usable operator — a handful of packs store `"" 2`, where the intended
  // operation was never recorded. Fall back to plain SK rather than inventing.
  if (!parsed) return spellPower;

  const [, op, operandRaw, tail] = parsed;
  const operand = Number(operandRaw);
  let value;
  switch (op) {
    case "*":
      value = Math.floor(spellPower * operand);
      break;
    case "/":
      value = operand === 0 ? 0 : Math.floor(spellPower / operand);
      break;
    // Opt-in round-up, for the rules that say so explicitly.
    case "/up":
      value = operand === 0 ? 0 : Math.ceil(spellPower / operand);
      break;
    case "+":
      value = spellPower + operand;
      break;
    case "-":
      value = spellPower - operand;
      break;
    default:
      return spellPower;
  }

  // Trailing terms, e.g. `{{math spellPower "/" 2 + 1}}`. Applied after the
  // floor above, so the SK fraction rounds down before anything is added.
  for (const term of tail.matchAll(/([+-])\s*(\d+(?:\.\d+)?)/g)) {
    value += term[1] === "-" ? -Number(term[2]) : Number(term[2]);
  }
  return value;
}

/**
 * Replace every spell-power placeholder in a description with its computed
 * value, so the reader sees "1d4 + 3" instead of `1d4 + {{math spellPower "/" 2}}`.
 * Returns the text unchanged when it holds no placeholders.
 * @param {string} html
 * @param {number} spellPower
 * @returns {string}
 */
export function resolveSpellPowerTokens(html, spellPower) {
  const text = String(html ?? "");
  if (!text.includes("spellPower")) return text;
  return text.replace(SPELL_POWER_TOKEN, (_match, args) =>
    String(evaluateSpellPowerArgs(args, spellPower)),
  );
}

/**
 * Split an actionCost string into its display text and a concentration flag.
 * Concentration is encoded as a standalone "C" (or Czech "K") token, e.g.
 * "1 | C" or "1 + C" — never as a substring, since "Reaction" contains a c.
 * @param {string} raw
 * @returns {{display: string, concentration: boolean}}
 */
export function parseActionCost(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return { display: "", concentration: false };

  let concentration = false;
  const segments = [];

  for (const segment of text.split("|")) {
    // Keep the segment's internal separators so "1 + C" -> "1 +" -> "1".
    const kept = [];
    for (const token of segment.trim().split(/\s+/)) {
      if (/^[ck]$/i.test(token)) concentration = true;
      else kept.push(token);
    }
    // Drop a separator left dangling by a removed token ("1 +" -> "1").
    while (kept.length && /^[+/]$/.test(kept[kept.length - 1])) kept.pop();
    const rebuilt = kept.join(" ").trim();
    if (rebuilt) segments.push(rebuilt);
  }

  return { display: segments.join(" | "), concentration };
}

/** @returns {boolean} whether a pill value should be omitted. */
function isEmptyPillValue(value) {
  return value === "" || value === null || value === undefined || value === 0;
}

/**
 * Build a single stat pill, or null if its value is empty and it isn't
 * exempt (the caller filters nulls out).
 * @param {string} key
 * @param {string} labelKey  Localization key for the pill label.
 * @param {*} value
 * @param {boolean} [always=false]  Keep the pill even if value is falsy.
 * @param {boolean} [positive]  Optional flag (concentration pill only) so the
 *   template/CSS can style a "Yes" value without matching localized text.
 */
function pill(key, labelKey, value, always = false, positive) {
  if (!always && isEmptyPillValue(value)) return null;
  const built = { key, label: game.i18n.localize(labelKey), value };
  if (positive !== undefined) built.positive = positive;
  return built;
}

/**
 * Build the view-model for one item's feature card.
 * @param {Item} item
 * @param {"spell"|"miracle"|"ability"} kind
 * @returns {object} plain view-data object — the source Item is never mutated.
 */
export function buildSpellCard(item, kind) {
  const system = item.system ?? {};
  // Descriptions store SK references as placeholders; resolve them against the
  // owning actor's spell power in this spell's own school so the reader sees a
  // number. Non-spell kinds carry no placeholders, so this is a no-op there.
  const spellPower = getSpellPower(item.actor, system.type);
  const card = {
    id: item.id,
    img: item.img,
    name: item.localizedName,
    description: resolveSpellPowerTokens(item.localizedDescription, spellPower),
    concentration: false,
    pills: [],
  };

  const pills = [];

  if (kind === "spell" || kind === "miracle") {
    const { display, concentration } = parseActionCost(system.actionCost);
    card.concentration = concentration;

    if (kind === "spell") {
      pills.push(
        pill("difficulty", "REDSTEEL.Item.Spell.FIELDS.difficulty.label", system.difficulty),
      );
    } else {
      pills.push(
        pill("domain", "REDSTEEL.Item.Spell.FIELDS.domain.label", system.domain),
      );
    }

    pills.push(
      pill("cost", "REDSTEEL.Item.Spell.FIELDS.cost.label", system.cost),
      pill("perRound", "REDSTEEL.Item.Spell.FIELDS.perRound.label", system.perRound),
      pill("actionCost", "REDSTEEL.Item.Spell.FIELDS.actionCost.label", display),
      pill(
        "concentration",
        "REDSTEEL.Actor.Spells.Concentration.Label",
        concentration
          ? game.i18n.localize("REDSTEEL.Actor.Spells.Concentration.Yes")
          : game.i18n.localize("REDSTEEL.Actor.Spells.Concentration.No"),
        true,
        concentration,
      ),
      pill("range", "REDSTEEL.Item.Spell.FIELDS.headerRange.label", system.range),
    );
  } else if (kind === "ability") {
    const { display } = parseActionCost(system.actionCost);
    pills.push(
      pill("costType", "REDSTEEL.Item.Ability.FIELDS.costType.label", system.costType),
      pill("cost", "REDSTEEL.Item.Ability.FIELDS.cost.label", system.cost),
      pill("perRound", "REDSTEEL.Item.Spell.FIELDS.perRound.label", system.perRound),
      pill("actionCost", "REDSTEEL.Item.Ability.FIELDS.actionCost.label", display),
      pill("damage", "REDSTEEL.Item.Ability.FIELDS.damage.label", system.roll?.diceBonus),
      pill("attributeTest", "REDSTEEL.Item.Ability.FIELDS.attributeTest.label", system.attributeTest),
    );
  }

  card.pills = pills.filter(Boolean);
  return card;
}

/**
 * Render a card view-model as the floating "chat card" inspector panel shown
 * on hover beside the actor sheet. Presentation only — returns an HTML string.
 * @param {object} card  Output of buildSpellCard.
 * @returns {string}
 */
export function renderInspectorCard(card) {
  const boxes = (card.pills ?? [])
    .map(
      (p) => `
      <div class="spell-inspector-box${p.positive ? " is-positive" : ""}" data-pill="${p.key}">
        <div class="spell-inspector-box-label">${p.label}</div>
        <div class="spell-inspector-box-value">${p.value}</div>
      </div>`,
    )
    .join("");

  return `
    <div class="spell-inspector-header">
      <img class="spell-inspector-icon" src="${card.img}" />
      <div class="spell-inspector-title">${card.name}</div>
    </div>
    <div class="spell-inspector-boxes">${boxes}</div>
    <div class="spell-inspector-desc">${card.description ?? ""}</div>
  `;
}

/**
 * Group items into per-rank card lists, skipping ranks with no items.
 * @param {Item[]} items
 * @param {string[]} ranks  Rank keys in display order.
 * @param {"spell"|"miracle"|"ability"} kind
 * @returns {{rank: string, label: string, cards: object[]}[]}
 */
export function buildRankGroups(items, ranks, kind) {
  const groups = [];
  for (const rank of ranks) {
    const rankItems = items.filter((item) => item.system?.rank === rank);
    if (!rankItems.length) continue;
    groups.push({
      rank,
      label: game.i18n.localize(`REDSTEEL.Item.Spell.FIELDS.${rank}.label`),
      cards: rankItems.map((item) => buildSpellCard(item, kind)),
    });
  }
  return groups;
}
