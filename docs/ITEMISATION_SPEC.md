# Redsteel Itemisation System

Darkest-Dungeon-style magic items: every item trades something from the
character for a benefit. Seven groups, differing in what is spent, when, and
what risk comes with it.

This is the build spec. It records what is settled, what is built, and what is
still open. Design rationale that does not change code lives in the game notes,
not here.

## Settled decisions

| Question | Decision |
| --- | --- |
| Faith gate | Gates on the **`fth` rating** (`secondaryAttributes.fth.total`), not on the `holyEnergy` pool. |
| Faith test on use | Reuses the existing test, `fth.total * 8 - 1d100`. Nothing new to build. |
| Resolve test (Insanity-Risk) | Existing `res.total * 10 - 1d100`. |
| Insanity-Risk failure | Failure still grants the stronger effect **and** costs 1 Insanity. Withholding the effect too would make the safe option dominate and nobody would ever roll. |
| Passive stat trades | **Gear and accessories only.** Weapons cannot carry Active Effects yet (see "Deferred" below). |
| Mind reserve | Its own mechanic, separate from `mind.burned`. Reserved Mind returns when the item comes off; burned Mind needs a ritual or potion. |
| Mind reserve release | Unspent reserved points return immediately on unequip; points actually spent while the item was worn do not. This falls out of the data model rather than needing bookkeeping. |
| Mana-Charged recharge | Consumes a gem item to refill. Hoard-and-ration. |
| Soul-Charged recharge | Gains a charge on a killing blow by the wielder. Self-sustaining but combat-gated. |
| Group 2 power budget | Fatigue and Mind costs stay the most rewarding, justified by how hard they are to restore, **not** by a resource conversion chain. No such chain exists in the system and none is being built. |
| Pursuit encounters | Automate the roll and the escalation state, whispered to the GM. Do not generate encounters. |
| Curse removal | A `bound` flag that refuses unequip without GM override. The ritual itself stays a table ruling. |

## Still open

- Mind-Reserved pursuit trigger: concrete percentage, and whether it accumulates
  per use, per rest, or per total uses.
- Fatigue-Spend flavour tag. Every other Resource-Spend type has one (Mana =
  elemental spirit, Stamina = beast spirit, Health = vampiric or demonic, Mind =
  specter). Nothing mechanical depends on it.
- Tier ladder for the content pack. Check the rules xlsx before inventing one.

## What already existed (do not rebuild)

- **Faith**: `secondaryAttributes.fth` plus the `stats.holyEnergy` priest pool
  (`power` derives from `fth.total`, gated on the `priest` capability flag).
- **Resolve and Insanity**: `secondaryAttributes.res`, `stats.insanity`
  (`max = wil + bonus + base`), and `_addInsanity` in `redsteel.mjs`.
- **Effect payloads**: `CONFIG` effect definitions with `combatModifiers`
  blocks, applied through `game.redsteel.applyEffect`.
- **Enchantment carrier**: `enchantment` Item type, dropped onto a weapon or
  gear item, stored as a frozen snapshot in `flags.redsteel.enchantments` and
  summed into the derived `system.enchantMods`. See the memory note
  `enchantment-magic-item-system`.

## Deferred: the wielded-weapon AE gate

Foundry pushes an item's Active Effects onto the actor whenever the item is
owned, so systems gate them on "equipped". Redsteel already does this for
consumables by overriding `Item#transferredEffects`.

Gear works because it has a real `system.equipped` boolean. Weapons do not:
their equipped state is "is this id in `system.combat.weaponSets[set]` and is
that the `activeWeaponSet`", which means the actor has to re-prepare effects on
every weapon-set swap. That is genuine AE-timing work in the fragile layer, so
it is its own change, taken after the rest is proven in play.

Until then, weapon-slot enchantments stay stat-only through `enchantMods`, and
passive stat trades (groups 1 and 6) ship for gear and accessories.

## Phases

### Phase 1 — Resource foundations — DONE

- `module/utils/itemResources.mjs`: one direction-aware resource layer.
  Down-pools (health, mana, stamina, mind, blood, holy energy, …) subtract and
  block at 0. Fatigue **adds**, because `fatigue.value` counts up from rested
  toward `max` and drives every penalty, and it blocks at the ceiling.
  Callers get update payloads so an activation can pay and act in one atomic
  `actor.update`, following `mindPoints.mjs`.
- `deductAbilityCost` (`utils/combatAbilities.mjs`) routed through it. This
  fixed two live bugs: fatigue costs previously made a character *less* tired
  and refused outright at full rest, and the cost options `mental`,
  `inspiration` and `holy energy` pointed at stats that do not exist, so any
  ability using them could never fire. Audited: no shipped or world content used
  them, so nothing changed behaviour in practice.
- `template.json` ability `costOptions` corrected to
  `stamina, mana, health, mind, fatigue, holy energy, blood`. The normalizer
  still accepts the old spellings, so stragglers keep working.
- **Mind reserve**: `enchantment.mindReserve` field, snapshotted on drop, summed
  into `enchantMods.mindReserve`, and totalled by `Actor#getMindReserve()` over
  equipped items. Subtracted from `mind.max` on both the character and NPC
  paths, beside `burned`. Derived rather than stored, so nothing can drift and
  deleting an item cannot strand a reservation.

Down-pool *adds* deliberately kept their old behaviour of clamping only at 0.
Several pools carry an unauthored `max` on NPCs and clamping to it would quietly
empty them.

### Phase 2 — Enchantment schema — DONE

The `enchantment` type now carries everything the later phases read. Fields are
authored on the enchantment, snapshotted onto the host at drop time, and
aggregated into `enchantMods` by `itemisationMods()`.

```
group            ""|mind_reserved|resource_spend|mana_charged|soul_charged
                 |insanity_risk|mixed|faith_gated      ("" = plain, as today)
mindReserve      number      Mind held while worn (Phase 1)
requiredFaith    number      equip gate on fth.total; 0 = no gate
bound            boolean     refuses unequip without the GM
activation       { enabled, actionCost, range, summary,
                   useEffects[] / useEffectsRaw,
                   safeEffects[] / safeEffectsRaw }
cost             { resource, amount }        "" resource = free to use
charges          { max, recharge }           max 0 = not a charged item
risk             { test, insanity, pursuitChance }
```

Decisions worth remembering:

- **No `cost.type` discriminator.** The spec's draft had one, but resource cost,
  charge cost, test and gate are independent and can co-exist on one item.
  Presence of the field is the switch; `group` only picks flavour and labels.
- **`mindReserve` stays separate from `cost`.** A Mind-Reserved item pays a
  standing reserve to be *worn* and may additionally cost something to *use*.
  Folding them together would have lost that.
- **Charges live on the host item, not the enchantment.** `max` and `recharge`
  are authored; the charges *remaining* are written into the snapshot entry at
  drop time, so two amulets made from one enchantment deplete independently.
- **`requiredFaith` aggregates as a max, not a sum.** Two items each needing
  Faith 4 do not together need Faith 8. One `bound` entry binds the whole item.
- **Activation effects reuse the potion route**: `effectDefinitions` ids applied
  through `game.redsteel.applyEffect`, authored as a comma-separated string
  mirrored into an array, exactly like the feature sheet's `statusEffectsRaw`.
- **`enchantMods.activations[]`** collects the usable enchantments on an item
  with everything the resolver needs, so Phase 4 reads one array instead of
  digging back through raw snapshots.

Also fixed here: `costOptions` is now rebuilt in `item.mjs` prepareData. Every
stored document carries its own copy of an option array, so the Phase 1
template.json edit alone would only ever have reached newly created abilities.
All four new enchantment option lists are rebuilt for the same reason.

### Phase 3 — Passive groups (1 and 6)

Enchantments carry real Active Effects. On drop onto gear or an accessory, copy
them onto the host item so the `equipped` toggle handles transfer. Weapon-slot
passives stay `enchantMods`-only.

### Phase 4 — Active use path

The largest single piece, shared by groups 2, 3, 4, 5 and the active half of 7.
A use button on the inventory row, a chat card, and one `useEnchantment()`
resolver dispatching on group: resource spend, charge consumption, the
Insanity-Risk choice dialog, and the Faith gate plus test. There is no
activation path for weapons or gear today; `item.roll()` posts a description
card and nothing else.

### Phase 5 — Pursuit system

Mind-Reserved escalation. Roll on use, track state on the actor, whisper to the
GM. Archivists first, Warriors of Hades second, never both at once.

### Phase 6 — Content pack

The tier ladder and the items themselves. English-authored, Czech through
`localizationKey` in both lang files. See the memory notes
`compendium-pack-workflow` and `feedback-english-first-content`.
