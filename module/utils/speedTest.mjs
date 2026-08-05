/**
 * Speed tests (d12 + Initiative + Speed).
 *
 * A "speed" Test Type on an ability/spell/weapon/modifier rolls the same dice as
 * initiative instead of a d100 margin of success:
 *
 *   Any actor      : 1d12 + ini.total + spd.total  (rogue doctrine 7+ → 2d12kh1)
 *   Prone / Downed : flat 1
 *
 * NPCs carry the same `spd` secondary attribute as characters (it used to be a
 * separate `mov`), so a plain Speed debuff lands on their tests with no extra
 * wiring.
 *
 * Higher is better. The posted result is clickable: another player selects their
 * token, rolls the same kind of test, and the two totals are compared. The
 * initiator wins ties — the contester has to beat the number.
 */

import { withRollBias } from "./rollAdvantage.mjs";

/** The Test Type dropdown value that selects a speed test. */
export const SPEED_TEST_NAME = "speed";

/**
 * Whether a Test Type selection is the speed test.
 * @param {string} testName  Raw value from `system.attributeTest`.
 * @returns {boolean}
 */
export function isSpeedTest(testName) {
  return String(testName ?? "").trim().toLowerCase() === SPEED_TEST_NAME;
}

/**
 * Whether a status that flattens the speed test is on the actor.
 *
 * `Actor#statuses` is the canonical set, so this also catches a status toggled
 * straight from the Token HUD, which never stamps the legacy `core.statusId`
 * flag the system writes on its own effects.
 * @param {Actor}  actor
 * @param {string} statusId
 * @returns {boolean}
 */
function hasFloorStatus(actor, statusId) {
  return (
    !!actor.statuses?.has(statusId) ||
    actor.effects.some((e) => e.getFlag("core", "statusId") === statusId)
  );
}

/**
 * Build the initiative-style d12 formula for an actor. Kept in one place so
 * initiative rolls and ability speed tests can never drift apart.
 * @param {Actor} actor
 * @returns {string} A formula for `actor.getRollData()`.
 */
export function buildSpeedTestFormula(actor) {
  // "Povalení: Pořadí tahu dočasně sníženo na 1." Downed (0 health) is on the
  // floor too, so it takes the same flat 1 — and it does so independently of
  // Prone, since Downed can be applied on its own.
  if (hasFloorStatus(actor, "prone") || hasFloorStatus(actor, "downed")) {
    return "1";
  }

  // Rogue doctrine 7+ rolls two d12 and keeps the higher. NPCs have no
  // doctrines, so they always roll the single die.
  const die = actor.system.doctrines?.rogue?.value >= 7 ? "2d12kh1" : "1d12";
  return `${die} + @secondaryAttributes.ini.total + @secondaryAttributes.spd.total`;
}

/**
 * Tag a not-yet-evaluated roll as a d12 speed test so the roll-modifier layer
 * applies advantage/disadvantage by keeping the higher/lower d12.
 * @param {Roll} roll
 */
export function tagSpeedTest(roll) {
  roll.options ??= {};
  roll.options.redsteel = {
    ...(roll.options.redsteel ?? {}),
    skill: "spd",
    speedTest: true,
  };
}

/**
 * Roll a speed test for an actor.
 * @param {Actor}  actor
 * @param {object} [options]
 * @param {number} [options.modifier]  Flat bonus from the item's Test Modifier.
 * @returns {Promise<Roll>} The evaluated roll.
 */
export async function rollSpeedTest(actor, { modifier = 0 } = {}) {
  const mod = Number(modifier) || 0;
  let formula = buildSpeedTestFormula(actor);
  if (mod > 0) formula += ` + ${mod}`;
  else if (mod < 0) formula += ` - ${Math.abs(mod)}`;

  const roll = new Roll(formula, withRollBias(actor.getRollData(), actor));
  tagSpeedTest(roll);
  await roll.evaluate();
  return roll;
}

/**
 * Human-readable breakdown of the actor's speed-test bonuses, for the tooltip.
 * @param {Actor}  actor
 * @param {number} [modifier]
 * @returns {string}
 */
function describeSpeedParts(actor, modifier = 0) {
  const sec = actor.system.secondaryAttributes ?? {};
  const parts = [
    `Initiative ${sec.ini?.total ?? 0}`,
    `Speed ${sec.spd?.total ?? 0}`,
  ];
  const mod = Number(modifier) || 0;
  if (mod) parts.push(`Modifier ${mod > 0 ? `+${mod}` : mod}`);
  return parts.join(" + ");
}

/**
 * The clickable chat line for a posted speed test. Clicking it opens a contest
 * with the clicker's own speed test.
 * @param {object} data
 * @param {Actor}  data.actor     The actor that rolled.
 * @param {Roll}   data.roll      The evaluated speed roll.
 * @param {string} data.source    Name of the originating ability/spell.
 * @param {number} [data.modifier]
 * @returns {string} HTML.
 */
export function renderSpeedTestLine({ actor, roll, source, modifier = 0 }) {
  const tooltip = [
    describeSpeedParts(actor, modifier),
    `Rolled: ${roll.result}`,
    "Click to contest with your own speed test",
  ].join("<br>");

  return `<span class="speed-followup" data-speed="${roll.total}" data-source="${source ?? ""}" data-tooltip="${tooltip}" style="cursor:pointer; text-decoration:underline dotted;">Speed Test: [${roll.total}]</span>`;
}

/**
 * Roll a speed test straight from a sheet and post it as a contestable card.
 * Used by the Speed stat click on both the character and the NPC sheet so the
 * two never drift apart — same formula, same tag, same clickable result.
 * @param {Actor}  actor
 * @param {object} [options]
 * @param {number} [options.modifier]
 * @returns {Promise<Roll>} The evaluated roll.
 */
export async function postSpeedTest(actor, { modifier = 0 } = {}) {
  const roll = await rollSpeedTest(actor, { modifier });

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<p style="text-align:center; font-size:18px;"><b>Speed Test</b></p>
<p style="text-align:center;">${renderSpeedTestLine({ actor, roll, source: "", modifier })}</p>`,
    rollMode: game.settings.get("core", "rollMode"),
  });

  return roll;
}

/**
 * Attach click handlers to any speed-test contest triggers in a rendered chat
 * message.
 * @param {HTMLElement} html  The rendered chat message element.
 */
export function wireSpeedFollowups(html) {
  for (const el of html.querySelectorAll(".speed-followup")) {
    el.addEventListener("click", () => {
      const target = Number(el.dataset.speed);
      if (Number.isNaN(target)) return;
      contestSpeedTest(target, el.dataset.source ?? "");
    });
  }
}

/**
 * Roll the selected token's speed test against a posted total and post the
 * comparison. The contester must beat the target number; ties go to whoever
 * posted the original test.
 * @param {number} target  The posted speed total to beat.
 * @param {string} source  Name of the originating ability/spell (for flavor).
 */
export async function contestSpeedTest(target, source = "") {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;
  const { actor } = context;

  const roll = await rollSpeedTest(actor);
  const won = roll.total > target;
  const vsLabel = source ? source : `Speed ${target}`;

  const outcome = won
    ? `<b>Wins</b> the contest (${roll.total} vs ${target}).`
    : `<b>Loses</b> the contest (${roll.total} vs ${target}).`;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<p style="text-align:center; font-size:18px;"><b>Speed Test vs ${vsLabel}</b></p>
<p style="text-align:center;">${outcome}</p>`,
    rollMode: game.settings.get("core", "rollMode"),
  });
}
