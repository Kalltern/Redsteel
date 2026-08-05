/**
 * Glossary of rule keywords that auto-link inside tooltips.
 *
 * `terms` are the literal strings matched in tooltip text. They are markup
 * config, not player-facing content, so both the Czech and English spellings
 * (including the inflected Czech forms we actually write) live here. The
 * player-facing label and description come from the lang files via
 * `labelKey` / `descKey`.
 *
 * `note` is optional and names an entry in `RULE_NOTES` (tooltipJournals.mjs).
 * When present, the keyword tooltip grows a footer link that opens the full
 * rules note; keywords with no written-up rule simply leave it off.
 *
 * Matching is first-occurrence-per-keyword, longest-term-first, and never
 * reaches inside an existing link.
 */
export const TOOLTIP_KEYWORDS = {
  stun: {
    labelKey: "REDSTEEL.Keyword.stun.label",
    descKey: "REDSTEEL.Keyword.stun.desc",
    terms: ["Ochromení", "Ochromený", "Ochromená", "Ochromeni", "Stun", "Stunned"],
    note: "effects",
  },
  stagger: {
    labelKey: "REDSTEEL.Keyword.stagger.label",
    descKey: "REDSTEEL.Keyword.stagger.desc",
    terms: ["Omráčení", "Omráčený", "Omráčená", "Stagger", "Staggered"],
    note: "effects",
  },
  prone: {
    labelKey: "REDSTEEL.Keyword.prone.label",
    descKey: "REDSTEEL.Keyword.prone.desc",
    terms: ["Na zemi", "Prone"],
    note: "effects",
  },
  dying: {
    labelKey: "REDSTEEL.Keyword.dying.label",
    descKey: "REDSTEEL.Keyword.dying.desc",
    terms: ["Umírající", "Dying"],
    note: "vitals",
  },
  downed: {
    labelKey: "REDSTEEL.Keyword.downed.label",
    descKey: "REDSTEEL.Keyword.downed.desc",
    terms: ["Downed"],
    note: "effects",
  },
  bleeding: {
    labelKey: "REDSTEEL.Keyword.bleeding.label",
    descKey: "REDSTEEL.Keyword.bleeding.desc",
    terms: ["Krvácení", "Krvácející", "Bleed", "Bleeding"],
    note: "medicine",
  },
  rooted: {
    labelKey: "REDSTEEL.Keyword.rooted.label",
    descKey: "REDSTEEL.Keyword.rooted.desc",
    terms: ["Zakořeněný", "Rooted"],
    note: "effects",
  },
  fatigue: {
    labelKey: "REDSTEEL.Keyword.fatigue.label",
    descKey: "REDSTEEL.Keyword.fatigue.desc",
    terms: ["Únava", "Únavy", "Únavu", "Fatigue"],
    note: "fatigue",
  },
  corruption: {
    labelKey: "REDSTEEL.Keyword.corruption.label",
    descKey: "REDSTEEL.Keyword.corruption.desc",
    terms: ["Zkaženost", "Zkaženosti", "Corruption"],
    note: "corruption",
  },
  aim: {
    labelKey: "REDSTEEL.Keyword.aim.label",
    descKey: "REDSTEEL.Keyword.aim.desc",
    terms: ["Míření", "Zamíření", "Aim", "Aiming"],
    note: "combatActions",
  },
  spellPower: {
    labelKey: "REDSTEEL.Keyword.spellPower.label",
    descKey: "REDSTEEL.Keyword.spellPower.desc",
    terms: ["Síla kouzla", "Spell Power", "SK"],
    note: "vitals",
  },
  bane: {
    labelKey: "REDSTEEL.Keyword.bane.label",
    descKey: "REDSTEEL.Keyword.bane.desc",
    terms: ["Metla", "Metly", "Bane"],
    note: "banes",
  },
  desperateEffort: {
    labelKey: "REDSTEEL.Keyword.desperateEffort.label",
    descKey: "REDSTEEL.Keyword.desperateEffort.desc",
    terms: ["Zoufalé úsilí", "Desperate Effort"],
    note: "fatigue",
  },
  advantage: {
    labelKey: "REDSTEEL.Keyword.advantage.label",
    descKey: "REDSTEEL.Keyword.advantage.desc",
    terms: ["Výhoda", "Advantage"],
    note: "criticals",
  },
  disadvantage: {
    labelKey: "REDSTEEL.Keyword.disadvantage.label",
    descKey: "REDSTEEL.Keyword.disadvantage.desc",
    terms: ["Nevýhoda", "Disadvantage"],
    note: "criticals",
  },
  deflect: {
    labelKey: "REDSTEEL.Keyword.deflect.label",
    descKey: "REDSTEEL.Keyword.deflect.desc",
    terms: ["Odklonění", "Deflect"],
    note: "combatActions",
  },
  precision: {
    labelKey: "REDSTEEL.Keyword.precision.label",
    descKey: "REDSTEEL.Keyword.precision.desc",
    terms: ["Ověření", "Precision"],
    note: "combatActions",
  },
  sustained: {
    labelKey: "REDSTEEL.Keyword.sustained.label",
    descKey: "REDSTEEL.Keyword.sustained.desc",
    terms: ["Udržované", "Udržování", "Sustained"],
    note: "channeling",
  },
  graveWound: {
    labelKey: "REDSTEEL.Keyword.graveWound.label",
    descKey: "REDSTEEL.Keyword.graveWound.desc",
    terms: ["Těžké zranění", "Grave Wound"],
    note: "vitals",
  },
};

/** Terms sorted longest-first so "Spell Power" wins over "SK" style overlaps. */
export function keywordTermIndex() {
  const entries = [];
  for (const [id, def] of Object.entries(TOOLTIP_KEYWORDS)) {
    for (const term of def.terms ?? []) entries.push({ id, term });
  }
  entries.sort((a, b) => b.term.length - a.term.length);
  return entries;
}
