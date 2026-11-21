/**
 * Spec pills on a cast card (Mancer passives, Incantator), one per passive
 * (user ruling 2026-11-21): the pill names the passive at the highest level
 * the caster holds ("Wildfire II"), and hovering it lists every benefit of
 * that passive's levels ("Wildfire I: Burn +15%", "Wildfire II: Burn +10%",
 * "Wildfire II: reach +1.5 m"). The hover is the system tooltip kind
 * "specTag" (utils/tooltipProviders.mjs).
 */

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * The passive a benefit belongs to, read off a label: the part before any
 * colon, with a trailing level numeral split off ("Deep Frost II" → Deep
 * Frost, 2). A label with no numeral takes its level from the node id's
 * trailing number (ochromeni2 → 2), so two "School of Spirit" nodes still
 * read as levels of one passive.
 *
 * @param {string} label
 * @param {string} [nodeId]
 * @returns {{group: string, level: number}}
 */
export function pillGroupOf(label, nodeId = "") {
  const head = String(label ?? "").split(":")[0].trim();
  const roman = head.match(/^(.*\S)\s+(I|II|III|IV|V|VI)$/);
  if (roman) return { group: roman[1], level: ROMAN.indexOf(roman[2]) };
  const digit = String(nodeId).match(/(\d+)$/);
  return { group: head, level: digit ? Number(digit[1]) : 0 };
}

/**
 * The pills for a list of benefits, grouped by passive.
 *
 * @param {{group: string, level?: number, text: string}[]} entries
 *   One per benefit, in card order; `text` is the full benefit line.
 * @param {string} cssClass  The pill's colour class ("mancer", "incantator").
 * @returns {string} HTML
 */
export function specPillsHtml(entries, cssClass) {
  const groups = new Map();
  for (const entry of entries ?? []) {
    if (!entry?.text) continue;
    const key = entry.group || entry.text;
    const group = groups.get(key) ?? { name: key, level: 0, lines: [] };
    group.level = Math.max(group.level, Number(entry.level) || 0);
    if (!group.lines.includes(entry.text)) group.lines.push(entry.text);
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const label = group.level
        ? `${group.name} ${ROMAN[group.level] ?? group.level}`
        : group.name;
      return (
        `<span class="action-tag ${cssClass} " data-tt-kind="specTag"` +
        ` data-tt-title="${esc(label)}" data-tt-lines="${esc(group.lines.join("\n"))}">` +
        `${esc(label)}</span>`
      );
    })
    // A space between pills so the row can wrap.
    .join(" ");
}
