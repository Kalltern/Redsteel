# Redsteel

A grimdark medieval fantasy tabletop RPG system for **Foundry VTT V14**.

Redsteel is a full, standalone game system built around d100 rolls read by their
margin of success. It is played at a real table every week, and the Foundry
system automates as much of the bookkeeping as possible so the GM and players
can stay in the fiction: attacks resolve from roll to applied damage, wounds
bleed, armour wears down, fatigue piles up and spells carry their effects
onto their targets.

> **Status:** active development, version 0.x. The system is played in live
> sessions, but rules and data still change between releases. The rulebook is
> currently written in Czech and is not yet public; an English quickstart is
> planned.

## Features

**Core engine**
- d100 margin of success rolls with critical successes and failures,
  Desperate Effort, signed advantage and disadvantage, and rerolls
- Versus Tests for every contest, resolved from a single clickable line on the
  chat card
- Character and NPC sheets built on ApplicationV2, with an optional
  hotbar panel for quick actions

**Combat**
- Melee, ranged and thrown attacks chained from hit roll to damage to Apply
  Damage on the target, with defend, dodge and deflect
- Hit locations, aimed strikes, layered armour with durability, shields and
  weapon sets
- Action and reaction economy, initiative tie breaks, facing and positioning,
  sneak attacks, overwhelm, opportunity attacks and forced movement
- Combat abilities, stances, Aim and Overwatch
- Downed, Dying and Prone states with a Cheat Death flow

**Magic and faith**
- Hundreds of spells across many schools, cast through a Channeling flow with
  automated effects, sustained spells, reactions and critical failure tables
- Blood magic, mental duels, possession and miracles

**Survival and attrition**
- Bleeding, grave wounds, fatigue degrees, toxicity, corruption and addiction
- First aid, rest and long rest, herbalism, alchemy and spell scrolls

**Progression**
- Guided character creation with point buy
- Skills, features and fourteen star sign specialisation constellations,
  bought through a Learn window with teachers and lesson tracking
- Party management for earned experience

**Content**
- Compendiums with roughly a thousand items, the full spell list, rules
  journals and magic critical failure tables
- English and Czech interface

## Installation

In Foundry VTT, open **Game Systems → Install System** and paste this manifest
URL:

```
https://raw.githubusercontent.com/Kalltern/Redsteel/refs/heads/main/system.json
```

### Required modules

Install these before launching a Redsteel world:

- [Bar Brawl](https://foundryvtt.com/packages/barbrawl) (1.8.13 or newer)
- [Status Icon Counters](https://foundryvtt.com/packages/statuscounter) (3.0.4 or newer)

## Reporting bugs

Please open an issue at
[github.com/Kalltern/Redsteel/issues](https://github.com/Kalltern/Redsteel/issues).
Include your Foundry version, the Redsteel version and, if possible, the
browser console output (F12).

## Development

Compendium sources live as JSON in `src/packs`. With Foundry closed, compile
them into the LevelDB packs with:

```
npm install
npm run pullJSONtoLDB
```

`npm run pushLDBtoJSON` does the reverse after editing packs inside Foundry.
Releases are built by GitHub Actions when a `release-*` tag is pushed.

## Credits

- Redsteel ruleset: the Redsteel Team (Karkan, Kalltern, Fafner)
- Foundry system: Kalltern
- Built on the
  [Foundry VTT Boilerplate](https://github.com/asacolips-projects/boilerplate)
  by Asacolips Projects
- Thanks to Adrian Haberecht for Bar Brawl and Status Icon Counters

## Legal

The system code is provided under the terms in [LICENSE.txt](LICENSE.txt).
Code derived from the Foundry VTT Boilerplate is MIT licensed.

All original game content (rules, text, setting and compendium content) is
© Redsteel Team, all rights reserved. The Redsteel ruleset (working title ToS)
is an original, unpublished tabletop RPG created by the Redsteel Team.
