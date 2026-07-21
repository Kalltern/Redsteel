/**
 * Chat-card roll formula display.
 *
 * Damage formulas are assembled by string concatenation across many sources
 * (weapon dice, offhand, sneak, doctrines, quality, coatings, two-hand grip),
 * so they render as long chains like "(2d6 + 2 + 7 + 1 + 1d6)". This module
 * collapses that into "3d6 + 10" for display and clamps the line to one row
 * until the player clicks it.
 *
 * Only the rendered text changes. The Roll objects, their totals, and the
 * dice tooltip breakdown are left untouched and stay authoritative.
 */

const DICE_RE = /^(\d*)d(\d+)$/i;
const NUMBER_RE = /^\d+(?:\.\d+)?$/;

/**
 * Split a formula into signed top-level terms.
 * @param {string} formula
 * @returns {Array<{sign: number, text: string}>|null} null if the formula is
 *   not a plain sum (contains multiplication, division, or unbalanced parens).
 */
function splitTerms(formula) {
  const terms = [];
  let depth = 0;
  let sign = 1;
  let buf = "";

  const push = () => {
    const text = buf.trim();
    if (text) terms.push({ sign, text });
    buf = "";
  };

  for (const ch of formula) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return null;

    if (depth === 0 && (ch === "*" || ch === "/" || ch === "%")) return null;

    if (depth === 0 && (ch === "+" || ch === "-")) {
      const s = ch === "-" ? -1 : 1;
      // A sign with nothing before it is the term's own sign, not a separator.
      if (buf.trim()) {
        push();
        sign = s;
      } else sign *= s;
      continue;
    }
    buf += ch;
  }
  if (depth !== 0) return null;
  push();
  return terms;
}

/** True when the whole string is one parenthetical group. */
function isWrapped(text) {
  if (!text.startsWith("(") || !text.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i === text.length - 1;
    }
  }
  return false;
}

/** Recursively flatten nested parenthetical sums into one signed term list. */
function flatten(formula) {
  const terms = splitTerms(formula);
  if (!terms) return null;

  const out = [];
  for (const term of terms) {
    if (isWrapped(term.text)) {
      const inner = flatten(term.text.slice(1, -1));
      // A group we cannot flatten stays intact rather than being mangled.
      if (!inner) {
        out.push(term);
        continue;
      }
      for (const t of inner) out.push({ sign: t.sign * term.sign, text: t.text });
      continue;
    }
    out.push(term);
  }
  return out;
}

/**
 * Collapse a rendered roll formula: sum the flat numbers, merge dice of the
 * same size, and drop redundant parentheses. Order follows first appearance,
 * so "66 - 1d100" is left alone while "2d6 + 2 + 7 + 1 + 1d6" becomes
 * "3d6 + 10".
 * @param {string} formula
 * @returns {string} the simplified formula, or the input if it cannot be parsed
 */
export function simplifyRollFormula(formula) {
  if (typeof formula !== "string" || !formula.trim()) return formula;

  const terms = flatten(formula);
  if (!terms?.length) return formula;

  // Slots keep first-appearance order so the reading order stays familiar.
  const slots = [];
  const diceSlots = new Map();
  let constSlot = null;

  for (const { sign, text } of terms) {
    const dice = DICE_RE.exec(text);
    if (dice) {
      const faces = dice[2];
      const count = (dice[1] === "" ? 1 : Number(dice[1])) * sign;
      let slot = diceSlots.get(faces);
      if (!slot) {
        slot = { kind: "dice", faces, count: 0 };
        diceSlots.set(faces, slot);
        slots.push(slot);
      }
      slot.count += count;
      continue;
    }

    if (NUMBER_RE.test(text)) {
      if (!constSlot) {
        constSlot = { kind: "const", value: 0 };
        slots.push(constSlot);
      }
      constSlot.value += Number(text) * sign;
      continue;
    }

    slots.push({ kind: "raw", sign, text });
  }

  // Damage formulas lead with the weapon dice, so the merged flat bonus reads
  // best at the end ("3d6 + 10"). Formulas that already lead with a number
  // keep their order ("66 - 1d100").
  if (constSlot && slots[0]?.kind === "dice") {
    slots.splice(slots.indexOf(constSlot), 1);
    slots.push(constSlot);
  }

  const rendered = [];
  for (const slot of slots) {
    if (slot.kind === "dice") {
      if (!slot.count) continue;
      rendered.push({
        sign: Math.sign(slot.count),
        text: `${Math.abs(slot.count)}d${slot.faces}`,
      });
    } else if (slot.kind === "const") {
      if (!slot.value) continue;
      rendered.push({ sign: Math.sign(slot.value), text: `${Math.abs(slot.value)}` });
    } else {
      rendered.push(slot);
    }
  }

  if (!rendered.length) return "0";

  return rendered
    .map(({ sign, text }, i) => {
      if (i === 0) return sign < 0 ? `-${text}` : text;
      return `${sign < 0 ? " - " : " + "}${text}`;
    })
    .join("");
}

/**
 * Rewrite every roll formula in chat cards: simplified text, clamped to one
 * line, click to toggle the full expression.
 */
export function registerFormulaDisplay() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    for (const el of html.querySelectorAll(".dice-roll .dice-formula")) {
      if (el.dataset.rsFormula) continue;
      const original = el.textContent.trim();
      el.dataset.rsFormula = "1";
      el.textContent = simplifyRollFormula(original);
      el.title = original;
      el.classList.add("rs-formula-clamp");
      el.addEventListener("click", () => {
        el.classList.toggle("rs-formula-expanded");
      });
    }
  });
}
