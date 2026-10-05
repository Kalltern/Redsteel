// General skills ledger: skill names stay on one line, and a name too long
// for its half-width button (long Czech names such as "Odemykání zámků")
// has its font stepped down until it fits, so every button keeps the same
// size. Done in the DOM after render because it depends on the localized
// text and the rendered width. A ResizeObserver reruns it when the tab first
// becomes visible (hidden tabs have no width to measure) and when the sheet
// is resized.

const SECTION_SELECTOR =
  ".skills-container:not(.skills-combat-container) .skill-section";
// Never shrink below this share of the normal size; past it the name is
// allowed to wrap instead of becoming unreadable.
const MIN_SCALE = 0.7;
const STEP_PX = 0.5;
// A name may run this far past its box, into the gap before the number
// (the number is right-aligned, so a short one leaves a little more).
const OVERFLOW_PX = 2;

const observers = new WeakMap();
const lastWidths = new WeakMap();

// The text's own width. The label's scrollWidth cannot be used: the
// ::after that stretches the click area over the whole plate counts towards
// it, so every name would read as overflowing and shrink to the minimum.
function textWidth(label) {
  const range = document.createRange();
  range.selectNodeContents(label);
  return range.getBoundingClientRect().width;
}

function room(label) {
  const style = getComputedStyle(label);
  return (
    label.clientWidth -
    parseFloat(style.paddingLeft || 0) -
    parseFloat(style.paddingRight || 0)
  );
}

function fitLabel(label) {
  label.style.fontSize = "";
  label.style.whiteSpace = "";
  if (!label.clientWidth) return;
  const space = room(label) + OVERFLOW_PX;
  if (textWidth(label) <= space) return;
  const normal = parseFloat(getComputedStyle(label).fontSize);
  let size = normal;
  while (textWidth(label) > space && size > normal * MIN_SCALE) {
    size -= STEP_PX;
    label.style.fontSize = `${size}px`;
  }
  if (textWidth(label) > space) label.style.whiteSpace = "normal";
}

function fitSection(section) {
  if (!section.clientWidth) return;
  for (const label of section.querySelectorAll(".skill-entry .skill-name")) {
    fitLabel(label);
  }
}

/** Fit every General skills name in the sheet and keep it fitted. */
export function bindSkillLedgerLayout(root) {
  if (!root) return;
  for (const section of root.querySelectorAll(SECTION_SELECTOR)) {
    fitSection(section);
    if (observers.has(section)) continue;
    const observer = new ResizeObserver(() => {
      // Shrinking a name changes the section's height, never its width, so
      // reacting to width alone cannot loop.
      const width = section.clientWidth;
      if (width === lastWidths.get(section)) return;
      lastWidths.set(section, width);
      fitSection(section);
    });
    observer.observe(section);
    observers.set(section, observer);
  }
}
