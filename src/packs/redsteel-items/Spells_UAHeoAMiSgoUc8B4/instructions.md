# Spell localization instructions

Goal: give every spell in this folder a `system.localizationKey` and add the matching
English + Czech entries to `lang/en.json` / `lang/cs.json`, exactly like it was already
done for Armor, Races, Weapons, Abilities, Alchemy, Features and Traits (405 items done,
the 127 spells in this folder are the only items left).

This file is safe to keep here: `tools/pullJSONtoLDB.mjs` (foundryvtt-cli `compilePack`)
only picks up `.json` source files.

## Scope

127 spell items in 5 schools x 3 ranks:

| School | Apprentice | Expert | Wild |
|--------|-----------|--------|------|
| Air    | 4         | 14     | 7    |
| Dark   | 7         | 11     | 4    |
| Earth  | 6         | 13     | 6    |
| Fire   | 6         | 11     | 7    |
| Water  | 7         | 15     | 9    |

Item files are `spell_*.json`; skip `Folder_*.json` files.

## Key convention (already established — do not invent a new one)

- Pack item: `"system.localizationKey": "REDSTEEL.Items.<PascalCaseKey>.name"`
  - The field already exists in `template.json` base template; just set it. Appending it
    at the end of the `system` object is fine.
- Lang files: entries live in the `REDSTEEL.Items` section, **sorted alphabetically**,
  shape `"<Key>": { "name": "<translation>" }`. There are 388 entries already.
- Key = PascalCase of the English name, parentheses/punctuation dropped:
  `"Fear (reaction)"` → `FearReaction`, `"Ice strike (wet + ice)"` → `IceStrikeWetIce`,
  `"Acid attack (medium)"` → `AcidAttackMedium`.
- Do **not** change the item `name` fields in the pack JSON. English lang values may
  tidy capitalization/typos (e.g. `"Dark bolt"` → `"Dark Bolt"`); that is the display name.
- Watch for curly apostrophes (’) in item names — copy them exactly into the script map,
  but use straight apostrophes in the English lang value.
- Display works via `localizedName` in `module/documents/item.mjs`
  (`game.i18n.has(key)` fallback to `item.name`), shown through `itemDisplayName` /
  `hasLocalizedName` in the sheets. The compendium list still shows the source name.

## Established Czech terminology (reuse, do not retranslate)

From `lang/cs.json` — verify with a lookup before use, the file is the source of truth:

- Schools (`Actor.Character.schools.*.label`): Fire = **Oheň**, Water = **Voda**,
  Earth = **Země**, Air = **Vzduch**. Dark: check `Actor.Character.schools.dark.label`
  (gear resist label uses *Temnotné*, so likely **Temnota**).
- Ranks (`Item.Spell.FIELDS.*`): Apprentice = **Učedník**, Expert = **Expert**,
  Wild = **Divoká**, Sustained = **Udržovací**.
- Effects: Stagger = **Omráčení**, Burn = **Podpálení**, Slow = **Zpomalení**,
  Channeling = **Usměrňování**, Bleed = look up `Item.Weapon.FIELDS.bleed.label`.
- Stun terminology: Ochromení = Omráčení = stun; there is **no** paralyze effect in
  this system.
- Skills/attributes if referenced: Strength = Síla, Dexterity = Obratnost,
  Perception = Vnímání (`Actor.Character.Attribute.*.long`).
- `Actor.Specialisations.*.nodes.*.label` in cs.json already translates many spell
  names in passing (e.g. Frog = Žabák, Slow = Zpomalení) — grep there first for any
  spell name before inventing a translation.

Variant suffix suggestions (keep consistent across all spells):
`(reaction)` → `(reakce)`, `(wet)` → `(mokro)`, `(ice)` → `(led)`,
`(storm)` → `(bouře)`, `(small/medium/large)` → `(malý/střední/velký)`.

## Process (mirror the previous batches)

1. List all spell names: walk this folder, read each non-`Folder_` JSON, print
   `j.name`. Names duplicated across files must map to the same key.
2. Build a `name -> [Key, English, Czech]` map (a temp Node script in `tools/`,
   e.g. `tools/tmp_add_locKeys.mjs`; delete it afterwards).
3. For each item file:
   - Detect EOL (`\r\n` vs `\n`) from the raw file.
   - **Roundtrip check**: `JSON.stringify(parsed, null, 2)` + trailing newline must equal
     the raw file (with EOL normalization) *before* writing; abort on mismatch so
     formatting is never mangled.
   - Set `system.localizationKey` and write back with the same EOL + trailing newline.
4. Update both lang files by replacing the whole Items block with regex
   `/    "Items": \{[\s\S]*?\r?\n    \}/` (must match exactly once): parse existing
   `REDSTEEL.Items`, abort on key collisions with the 388 existing keys, merge, sort
   keys alphabetically, rebuild the block with 6/8-space indentation and the file's EOL.
   Write UTF-8 **without BOM** (Node default) so the diacritics survive.
5. Verify: re-walk the folder, every `system.localizationKey` must resolve to a string
   in **both** lang files (split key on `.` and reduce); also `require()` both lang
   files to prove they are valid JSON. Expected total after spells: 405 + 127 files
   (minus any shared keys) resolved, lang entries 388 + unique new keys.
6. Recompile packs: `npm run pullJSONtoLDB`, then a fresh world load in Foundry
   (`.mjs`/pack changes do not hot-reload).

## Gotchas seen in previous batches

- PowerShell 5.1 mangles quotes in `node -e` here-strings — write temp `.mjs` scripts
  instead of inline one-liners.
- Some names repeat in different folders (Features had 17 duplicates); they must share
  one key — dedupe before the lang merge and only flag a clash if the same key maps to
  different translations.
- `lang/en.json` and `lang/cs.json` carry uncommitted user edits — never reformat the
  whole file, only replace the Items block.
