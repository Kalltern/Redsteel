/**
 * View-model builders for the Spells / Miracles / Abilities feature-card
 * tabs. Cards mirror the `.npc-trait` card style used on the Features tab
 * (see templates/actor/features.hbs), but show a strip of stat pills
 * instead of an inline description; the full description surfaces in a
 * hover panel built from the same view-model.
 */

import { getSpellPower } from "./spellPower.mjs";
import { normalizeResourceKey, resourceLabel } from "./itemResources.mjs";
import { ARMOR_IGNORING_PENETRATION } from "./combatSkillBonuses.mjs";
import { ttEscape } from "./tooltips.mjs";

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
  return describeSpellPowerArgs(rawArgs, spellPower).value;
}

/** How each operator is written out in the hover text. */
const SPELL_POWER_GLYPH = { "*": "×", "/": "÷", "/up": "÷", "+": "+", "-": "-" };

/**
 * `"/up"` is the opt-out that rounds a SK division UP, against the rulebook's
 * default of rounding down. It shares the division glyph, so without saying so
 * the hover reads as an arithmetic mistake: SK 7 "÷ 4 = 2" looks wrong until
 * you know it ceils. The flag rides back out so the hover can spell it out.
 */

/**
 * The same evaluation as {@link evaluateSpellPowerArgs}, but it also hands
 * back the arithmetic in words, so a reader hovering the number can see where
 * it came from: "Spell Power 8 × 2 = 16". `expr` is everything after the SK
 * value and is empty for a bare `{{spellPower}}`, and for the malformed
 * placeholders that fall back to plain SK.
 *
 * @param {string} rawArgs
 * @param {number} spellPower
 * @returns {{value: number, expr: string}}
 */
function describeSpellPowerArgs(rawArgs, spellPower) {
  // Some stored descriptions have editor markup spliced into the middle of the
  // token (e.g. `"*" 2 </span>+ 1<span ...>`), so strip tags and decode the
  // entities the editor leaves behind before parsing.
  const args = String(rawArgs ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();

  if (!args) return { value: spellPower, expr: "", roundedUp: false };

  // `/up` is matched before the single-character operators so the "/" branch
  // cannot claim it and leave "up" stranded in the operand.
  const parsed = args.match(
    /^["']?(\/up|[*/+-])["']?\s*(-?\d+(?:\.\d+)?)(.*)$/,
  );
  // No usable operator — a handful of packs store `"" 2`, where the intended
  // operation was never recorded. Fall back to plain SK rather than inventing.
  if (!parsed) return { value: spellPower, expr: "", roundedUp: false };

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
      return { value: spellPower, expr: "", roundedUp: false };
  }

  let expr = `${SPELL_POWER_GLYPH[op] ?? op} ${operandRaw}`;

  // Trailing terms, e.g. `{{math spellPower "/" 2 + 1}}`. Applied after the
  // floor above, so the SK fraction rounds down before anything is added.
  for (const term of tail.matchAll(/([+-])\s*(\d+(?:\.\d+)?)/g)) {
    value += term[1] === "-" ? -Number(term[2]) : Number(term[2]);
    expr += ` ${term[1]} ${term[2]}`;
  }
  return { value, expr, roundedUp: op === "/up" };
}

/**
 * Replace every spell-power placeholder in a description with its computed
 * value, so the reader sees "1d4 + 3" instead of `1d4 + {{math spellPower "/" 2}}`.
 * Returns the text unchanged when it holds no placeholders.
 *
 * With `markup`, each resolved number is wrapped in a `.rs-sk` span carrying
 * the shared tooltip engine's attributes, so the reader can hover it and see
 * that it moves with Spell Power, and by what arithmetic. It is opt-in
 * because the same text is also used where it gets escaped rather than
 * rendered (manual notes) or fed to something that is not the DOM at all —
 * those callers must keep getting the bare number.
 *
 * @param {string} html
 * @param {number} spellPower
 * @param {object} [options]
 * @param {boolean} [options.markup=false]  Wrap each value in a hoverable span.
 * @returns {string}
 */
export function resolveSpellPowerTokens(html, spellPower, { markup = false } = {}) {
  const text = String(html ?? "");
  if (!text.includes("spellPower")) return text;
  return text.replace(SPELL_POWER_TOKEN, (_match, args) => {
    const { value, expr, roundedUp } = describeSpellPowerArgs(args, spellPower);
    const shown = String(value);
    if (!markup) return shown;
    // The hover sentence is composed from lang keys, never built in English
    // here; the `text` tooltip provider localizes the title key and prints
    // this already-composed body as it stands.
    const shownExpr = roundedUp
      ? `${expr} (${game.i18n.localize("REDSTEEL.Item.Spell.SpellPower.roundedUp")})`
      : expr;
    const tip = expr
      ? game.i18n.format("REDSTEEL.Item.Spell.SpellPower.tipMath", {
          sk: spellPower,
          expr: shownExpr,
          result: shown,
        })
      : game.i18n.format("REDSTEEL.Item.Spell.SpellPower.tipPlain", {
          sk: spellPower,
        });
    return (
      `<span class="rs-sk" data-tt-kind="text"` +
      ` data-tt-text="${ttEscape(tip)}"` +
      ` data-tt-title="REDSTEEL.Item.Spell.SpellPower.tipTitle">${shown}</span>`
    );
  });
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

/**
 * A stored range as the table reads it (user ruling 2026-09-20).
 *
 * The pack writes "Caster" for a spell that lands on the caster, which the
 * rules call Self, and it writes a bare number for a distance, which is
 * counted in hexes (one hex is 1.5 m). Both are spelled out here so every
 * surface reading a spell says the same thing. "Touch" and anything else the
 * pack holds is passed through untouched.
 *
 * @param {*} raw  The stored `system.range`.
 * @returns {string}
 */
export function formatSpellRange(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (/^(caster|self)$/i.test(text)) {
    return game.i18n.localize("REDSTEEL.Item.Spell.Range.self");
  }
  // A distance, whether one number or a span like "6 - 80".
  if (/^\d+(\s*[-–]\s*\d+)?$/.test(text)) {
    return game.i18n.format("REDSTEEL.Item.Spell.Range.hexes", { n: text });
  }
  return text;
}

/** One hex on the grid, in metres, for the ranges the hover card converts. */
const METRES_PER_HEX = 1.5;

/**
 * The same range in metres, for the hover card's own box (user ruling
 * 2026-09-20). Only a distance converts: Self and Touch have no length, so
 * they come back empty and the caller drops the box.
 *
 * @param {*} raw  The stored `system.range`.
 * @returns {string}  "12", "7,5", "9 - 120", or "" when there is nothing to
 *   convert. Decimals read in the player's own language.
 */
export function spellRangeMeters(raw) {
  const text = String(raw ?? "").trim();
  const span = text.match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!span) return "";
  const metres = (hexes) =>
    (Number(hexes) * METRES_PER_HEX).toLocaleString(game.i18n.lang, {
      maximumFractionDigits: 1,
    });
  return span[2] ? `${metres(span[1])} - ${metres(span[2])}` : metres(span[1]);
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
 * Name the glossary subject a pill stands for, so the inspector card can hand
 * it to the shared tooltip engine (`data-tt-kind` / `data-tt-id`). Optional:
 * every other consumer of a pill simply ignores the extra property, and it is
 * null-safe so it can wrap a `pill()` call that came back empty.
 *
 * @param {object|null} built  A pill, or null.
 * @param {string} kind  A registered tooltip kind, e.g. "keyword".
 * @param {string} id
 * @returns {object|null} the same pill.
 */
function withTip(built, kind, id) {
  if (built) built.tip = { kind, id };
  return built;
}

/**
 * What a cast takes from the caster besides its mana, as pills: the
 * Corruption a Dark spell heaps on, the Mind a Spirit spell burns, the Health
 * Remove corruption pays with. The pack keeps these on `system.resources` —
 * the item sheet writes them as an object keyed "0", "1", older data as an
 * array, and a compendium index hands over whichever shape was stored.
 *
 * A "drain" reads with a minus and an "add" with a plus: Corruption rising is
 * the price, Corruption falling is the point of Remove corruption. The blank
 * rows the sheet keeps for the next entry carry no type and are skipped.
 *
 * @param {object|Array|null} resources  An item's `system.resources`.
 * @returns {object[]} Pills, in the order the item stores them.
 */
function spellResourcePills(resources) {
  const list = Array.isArray(resources)
    ? resources
    : resources && typeof resources === "object"
      ? Object.values(resources)
      : [];
  const pills = [];
  for (const res of list) {
    const key = normalizeResourceKey(res?.type);
    const amount = Number(res?.amount);
    if (!key || !amount || !Number.isFinite(amount)) continue;
    const sign = String(res?.mode ?? "").toLowerCase() === "drain" ? "-" : "+";
    pills.push({
      key: `resource-${key}`,
      label: resourceLabel(res.type),
      value: `${sign}${Math.abs(amount)}`,
    });
  }
  return pills;
}

/**
 * Localize one stored damage type key (e.g. "dark") through the shared
 * damage-type map. Falls back to the raw stored string when the key has no
 * translation, rather than printing a key path.
 * @param {string} type
 * @returns {string}
 */
function damageTypeLabel(type) {
  if (!type) return "";
  const key = `REDSTEEL.Bg3Hotbar.DamageType.${type}`;
  const localized = game.i18n.localize(key);
  return localized === key ? type : localized;
}

/**
 * Localize an "and"/"or" connector stored in `system.bool2` .. `bool4`.
 * Anything else stored there (blank included) reads as "and", the sheet's
 * default.
 * @param {string} bool
 * @returns {string}
 */
function dmgJoinLabel(bool) {
  const key =
    bool === "or" ? "REDSTEEL.Item.Spell.dmgJoin.or" : "REDSTEEL.Item.Spell.dmgJoin.and";
  return game.i18n.localize(key);
}

/**
 * The spell's damage types, joined by their stored and/or connectors, e.g.
 * "Magic and Dark". Stops at the first empty slot, since the sheet fills the
 * four dmgType/bool pairs in order and never leaves a gap before the end.
 * @param {object} system
 * @returns {string} Empty when `dmgType1` is empty.
 */
function spellDamageTypesLabel(system) {
  const types = [system.dmgType1, system.dmgType2, system.dmgType3, system.dmgType4];
  const joins = [null, system.bool2, system.bool3, system.bool4];
  if (!types[0]) return "";

  let label = damageTypeLabel(types[0]);
  for (let i = 1; i < types.length; i++) {
    if (!types[i]) break;
    label += ` ${dmgJoinLabel(joins[i])} ${damageTypeLabel(types[i])}`;
  }
  return label;
}

/**
 * The strip of stat pills for one spell, miracle or ability.
 *
 * Split out of {@link buildSpellCard} so a caller with no Item in hand can
 * build the same strip from plain system data: the Learn window's Spells tab
 * reads compendium index entries, and its rows have to say exactly what the
 * hover card says.
 *
 * @param {object} system  An item's `system` data, or the same fields read off
 *   a compendium index entry.
 * @param {"spell"|"miracle"|"ability"} kind
 * @returns {object[]} The pills, empty entries already dropped.
 */
export function buildSpellPills(system = {}, kind = "spell") {
  const pills = [];

  if (kind === "spell" || kind === "miracle") {
    const { display, concentration } = parseActionCost(system.actionCost);

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
    );
    // What the cast takes on top of the mana: the Corruption a Dark spell
    // heaps on, chiefly. `system.resources` already drives the cast path
    // (deductMana in magicSkillBonuses.mjs), and the number used to be
    // repeated in the prose as well — it now lives on the resource alone
    // (user ruling 2026-09-21), so the card has to print it. It stands with
    // the costs, before the pills that describe the spell rather than price
    // it.
    pills.push(...spellResourcePills(system.resources));
    pills.push(
      pill(
        "concentration",
        "REDSTEEL.Actor.Spells.Concentration.Label",
        concentration
          ? game.i18n.localize("REDSTEEL.Actor.Spells.Concentration.Yes")
          : game.i18n.localize("REDSTEEL.Actor.Spells.Concentration.No"),
        true,
        concentration,
      ),
      // Direct or Indirect. Only Indirect says anything worth a box: Direct
      // is the default every spell would otherwise carry a pill for. An
      // Indirect spell cannot be dodged or blocked with a shield, which the
      // hovered glossary entry spells out.
      withTip(
        pill(
          "delivery",
          "REDSTEEL.Item.Spell.FIELDS.delivery.label",
          system.delivery === "indirect"
            ? game.i18n.localize("REDSTEEL.Item.Spell.Delivery.indirect")
            : "",
        ),
        "keyword",
        "indirect",
      ),
      pill(
        "vsTest",
        "REDSTEEL.Item.Spell.FIELDS.vsTest.label",
        system.vsTest ? game.i18n.localize("REDSTEEL.Item.Spell.vsTestYes") : "",
      ),
      // A cone or beam spell is Breath shaped, and its stored range is not
      // its reach: it is how far from the caster the cone's origin may be
      // placed. The pill says Breath so the number is not misread, and the
      // hovered glossary entry says the rest.
      system.breath
        ? withTip(
            pill(
              "range",
              "REDSTEEL.Item.Spell.FIELDS.headerRange.label",
              game.i18n
                .format("REDSTEEL.Item.Spell.Range.breath", {
                  n: formatSpellRange(system.range),
                })
                .trim(),
            ),
            "keyword",
            "breath",
          )
        : pill(
            "range",
            "REDSTEEL.Item.Spell.FIELDS.headerRange.label",
            formatSpellRange(system.range),
          ),
      // The hexes again in metres, for a table that wants the distance in
      // the world rather than on the grid. Empty for Self and Touch, and the
      // caller drops an empty pill.
      pill(
        "rangeMeters",
        "REDSTEEL.Item.Spell.Range.metresLabel",
        spellRangeMeters(system.range),
      ),
    );
    // Penetration, and the armour bypass read off it. 100 IS "Ignores Armor"
    // (see ARMOR_IGNORING_PENETRATION in combatSkillBonuses.mjs), which the
    // prose used to repeat in words (user ruling 2026-09-21) — so at 100 the
    // box prints the words instead of a number that means nothing on its own.
    // A spell with no penetration says nothing, as every other pill does.
    const penetration = Number(system.penetration) || 0;
    if (penetration > 0) {
      pills.push(
        pill(
          "penetration",
          "REDSTEEL.Item.Weapon.FIELDS.penetration.label",
          penetration >= ARMOR_IGNORING_PENETRATION
            ? game.i18n.localize("REDSTEEL.Item.Spell.ignoresArmor")
            : penetration,
        ),
      );
    }
    // The spell's damage types, joined by their stored and/or connectors.
    // Emits nothing when dmgType1 is empty, same as every other pill.
    pills.push(
      pill(
        "dmgTypes",
        "REDSTEEL.Item.Spell.FIELDS.headerType.label",
        spellDamageTypesLabel(system),
      ),
    );
  } else if (kind === "ability") {
    const { display } = parseActionCost(system.actionCost);
    pills.push(
      pill("costType", "REDSTEEL.Item.Ability.FIELDS.costType.label", system.costType),
      pill("cost", "REDSTEEL.Item.Ability.FIELDS.cost.label", system.cost),
      pill("perRound", "REDSTEEL.Item.Spell.FIELDS.perRound.label", system.perRound),
      pill("actionCost", "REDSTEEL.Item.Ability.FIELDS.actionCost.label", display),
      // diceBonusFormula, not diceBonus: the raw field carries the @Half /
      // @penCap markers, which are rules flags and not something to print as
      // a damage value.
      pill(
        "damage",
        "REDSTEEL.Item.Ability.FIELDS.damage.label",
        system.roll?.diceBonusFormula ?? system.roll?.diceBonus,
      ),
      pill("attributeTest", "REDSTEEL.Item.Ability.FIELDS.attributeTest.label", system.attributeTest),
    );
  }

  return pills.filter(Boolean);
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
    // `markup: true`: the description is rendered as HTML, so each resolved
    // number can be a hoverable `.rs-sk` span. The manual notes below are
    // escaped by renderInspectorCard, so they must stay bare.
    description: resolveSpellPowerTokens(item.localizedDescription, spellPower, {
      markup: true,
    }),
    // A sentence the prose used to bury: "the table resolves this manually."
    // Plain text, not HTML, but still carries SK placeholders like the
    // description does.
    manualNotes: resolveSpellPowerTokens(system.manualNotes, spellPower),
    concentration: false,
    pills: [],
  };

  // The strip itself is shared with the Learn window's spell rows.
  card.concentration = parseActionCost(system.actionCost).concentration;
  card.pills = buildSpellPills(system, kind);
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
    .map((p) => {
      // A pill may name a glossary entry (Indirect, Breath). The shared
      // tooltip engine reads these two attributes off any element, and opens
      // the keyword panel on top of this one.
      const tip = p.tip
        ? ` data-tt-kind="${p.tip.kind}" data-tt-id="${p.tip.id}"`
        : "";
      return `
      <div class="spell-inspector-box${p.positive ? " is-positive" : ""}" data-pill="${p.key}"${tip}>
        <div class="spell-inspector-box-label">${p.label}</div>
        <div class="spell-inspector-box-value">${p.value}</div>
      </div>`;
    })
    .join("");

  // The chip row and the description both carry their own separator rule, so an
  // empty one would draw a stray line under the header. Omit them instead.
  // An editor-authored "empty" description is usually `<p></p>`, so test the
  // text it would actually render, keeping anything with an image in it.
  const desc = String(card.description ?? "").trim();
  const hasDesc =
    /<img\b/i.test(desc) ||
    desc.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim() !== "";

  // Plain text, not HTML, so it has to be escaped rather than trusted like
  // the description above it.
  const manualNotes = String(card.manualNotes ?? "").trim();
  const manualBlock = manualNotes
    ? `<div class="spell-inspector-manual">
        <div class="spell-inspector-manual-heading">${game.i18n.localize("REDSTEEL.Item.Spell.manualNotesHeading")}</div>
        <div class="spell-inspector-manual-text">${foundry.utils.escapeHTML(manualNotes)}</div>
      </div>`
    : "";

  return `
    <div class="spell-inspector-header">
      <img class="spell-inspector-icon" src="${card.img}" />
      <div class="spell-inspector-title">${card.name}</div>
    </div>
    ${boxes ? `<div class="spell-inspector-boxes">${boxes}</div>` : ""}
    ${hasDesc ? `<div class="spell-inspector-desc">${desc}</div>` : ""}
    ${manualBlock}
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
