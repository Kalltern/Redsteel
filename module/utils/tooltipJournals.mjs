/**
 * Rules notes that tooltips can link out to.
 *
 * Ids point at the shipped `redsteel-rules` compendium. A GM who imported the
 * notes into the world edits those copies, so the resolver prefers a world
 * entry with the same name and only falls back to the compendium.
 */

import { ttEscape } from "./tooltips.mjs";

const PACK = "redsteel.redsteel-rules";

export const RULE_NOTES = {
  attributes: {
    entry: "t6IgexxAhW9aYIdL", page: "mBZO1xfoi7frRbxd",
    entryName: "Attributes", pageName: "Attributes",
    labelKey: "REDSTEEL.Note.attributes",
  },
  vitals: {
    entry: "5SMf4Yv0h4mMO4P8", page: "ZfVyD2E9hMCMamUL",
    entryName: "Health, Stamina, Mana, Holy Power, Spell Power, Grave Wounds and Fate",
    pageName: "Health, Stamina, Mana, Holy Power, Spell Power, Grave Wounds and Fate",
    labelKey: "REDSTEEL.Note.vitals",
  },
  madness: {
    entry: "Y3k8x9hnG2KFM7aK", page: "KkxdEMpZwDmGpA3N",
    entryName: "Madness", pageName: "Madness",
    labelKey: "REDSTEEL.Note.madness",
  },
  fatigue: {
    entry: "dffAuj5NeJNEOOVV", page: "0QzL98TxWXsmeHEz",
    entryName: "Desperate Effort and Fatigue", pageName: "Desperate Effort and Fatigue",
    labelKey: "REDSTEEL.Note.fatigue",
  },
  damageTypes: {
    entry: "Bum5XVMyLSyj2P2D", page: "G0ovJBNaaPoZA1k5",
    entryName: "Damage Types, Vulnerability, Resistance and Immunity",
    pageName: "Damage Types, Vulnerability, Resistance and Immunity",
    labelKey: "REDSTEEL.Note.damageTypes",
  },
  traps: {
    entry: "c0Menerns8O9dVIu", page: "XvXyp7hnsDnjE1q9",
    entryName: "Locks, Traps and Pickpocketing", pageName: "Locks, Traps and Pickpocketing",
    labelKey: "REDSTEEL.Note.traps",
  },
  channeling: {
    entry: "twxMJoS2EwXOQhET", page: "XJ3AMG8AYaT2WOTv",
    entryName: "Channeling, Wild Magic, Magic Attack and Defense, Blood Magic, Transmutation and Divination",
    pageName: "Channeling, Wild Magic, Magic Attack and Defense, Blood Magic, Transmutation and Divination",
    labelKey: "REDSTEEL.Note.channeling",
  },
  effects: {
    entry: "ZTu8LcUgZDatwPLA", page: "WAvKYaaWvpBN14uX",
    entryName: "Effects", pageName: "Effects",
    labelKey: "REDSTEEL.Note.effects",
  },
  banes: {
    entry: "2qSS1ZuC1N3j9YXW", page: "z5j1uKj9FogPlJF5",
    entryName: "Banes", pageName: "Banes",
    labelKey: "REDSTEEL.Note.banes",
  },
  criticals: {
    entry: "7ltSwR88w4D6d7sr", page: "ZbwpiNK9UjRNx6YU",
    entryName: "Critical Successes, Failures, Success Chance, Rerolls and Difficulty",
    pageName: "Critical Successes, Failures, Success Chance, Rerolls and Difficulty",
    labelKey: "REDSTEEL.Note.criticals",
  },
  combatActions: {
    entry: "4R2Zm8QIe4yzB2ZQ", page: "GjcixRwz4Keq0jY9",
    entryName: "Combat Actions", pageName: "Combat Actions",
    labelKey: "REDSTEEL.Note.combatActions",
  },
  // Sourced from the Temnota sheet of the spell book, not the rules book.
  corruption: {
    entry: "Cq3RtVn7ZbK2wLxP", page: "Hm8sPd4YuT6QnJrE",
    entryName: "Corruption", pageName: "Corruption",
    labelKey: "REDSTEEL.Note.corruption",
  },
  medicine: {
    entry: "462DyEejK5hlG67D", page: "SGvZM8cxdcjC52bJ",
    entryName: "Medicine, Research, Bleeding, Mental Duels and Herbalism",
    pageName: "Medicine, Research, Bleeding, Mental Duels and Herbalism",
    labelKey: "REDSTEEL.Note.medicine",
  },
  // The next three sit in the Armory folder of the pack rather than General
  // Rules. The resolver does not care: `game.journal.getName` searches every
  // folder, and the compendium fallback addresses the entry by id.
  armoryRules: {
    entry: "Pjtk6KX91JdE1Ddo", page: "8hef50CheIWvbBa0",
    entryName: "Selected Armory Rules", pageName: "Selected Armory Rules",
    labelKey: "REDSTEEL.Note.armoryRules",
  },
  weaponQuality: {
    entry: "BhrQOjytUBNdAvCJ", page: "yG1ytRXL6oSSdmJm",
    entryName: "Weapon and Armor Quality", pageName: "Weapon and Armor Quality",
    labelKey: "REDSTEEL.Note.weaponQuality",
  },
  weaponMaterials: {
    entry: "CqTOwQ8E06JBTYmy", page: "414xhiUrhmOFcZtN",
    entryName: "Materials: Weapons", pageName: "Materials: Weapons",
    labelKey: "REDSTEEL.Note.weaponMaterials",
  },
  criticalHits: {
    entry: "38JFyImWV6BjIgFZ", page: "M7I6l3OoV2lOotKA",
    entryName: "Critical Hits", pageName: "Critical Hits",
    labelKey: "REDSTEEL.Note.criticalHits",
  },
  specialActions: {
    entry: "TKwof6lPydQQuddU", page: "gbH03Pki6ZtS9Ucp",
    entryName: "Special Actions", pageName: "Special Actions",
    labelKey: "REDSTEEL.Note.specialActions",
  },
};

/**
 * UUID of the page a note id points at, world copy first.
 *
 * The world lookup is wrapped defensively: a tooltip can fire while
 * `game.journal` is still settling (early render, mid-migration), and a note
 * link is never important enough to let that throw. Any trouble simply falls
 * through to the read-only compendium page.
 *
 * @param {string} noteId  key of RULE_NOTES
 * @returns {string|null}  a document uuid, or null for an unknown note id
 */
export function ruleNoteUuid(noteId) {
  const def = RULE_NOTES[noteId];
  if (!def) return null;

  try {
    const worldEntry = game.journal?.getName(def.entryName);
    if (worldEntry) {
      // A GM may have renamed or reordered pages after importing; fall back to
      // the entry's first page, and to the entry itself, rather than nothing.
      const page =
        worldEntry.pages.find((p) => p.name === def.pageName) ??
        worldEntry.pages.contents[0];
      return page?.uuid ?? worldEntry.uuid;
    }
  } catch (err) {
    /* fall through to the compendium uuid */
  }

  return `Compendium.${PACK}.JournalEntry.${def.entry}.JournalEntryPage.${def.page}`;
}

/**
 * Footer HTML linking out to a note, or "" when the note id is unknown.
 *
 * Callers pass `def.note` straight through, which is often undefined, so an
 * empty string is the normal "this stat has no rules note" answer.
 *
 * @param {string} [noteId]
 * @returns {string}
 */
export function ruleNoteFooter(noteId) {
  const def = RULE_NOTES[noteId];
  if (!def) return "";

  const uuid = ruleNoteUuid(noteId);
  if (!uuid) return "";

  const label = game.i18n.localize(def.labelKey);
  return `<a class="tt-journal" data-tt-open-uuid="${ttEscape(uuid)}"><i class="fa-light fa-book-open"></i><span>${ttEscape(label)}</span></a>`;
}
