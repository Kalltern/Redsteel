# Specialisations — Automation Development Plan

Assessment + roadmap for automating the specialisation talent trees.
Companion to [SPECIALISATIONS.md](SPECIALISATIONS.md) (which is the *how to add a
spec* build guide) and modelled on
[SPELL_EFFECTS_DEV_PLAN.md](SPELL_EFFECTS_DEV_PLAN.md). Written 2026-07-10 after
auditing every node in `module/helpers/specialisations.mjs` +
`specialisations-generated.mjs`, both lang files, and the combat-roll pipeline
(`utils/attackActions.mjs`, `utils/combatSkillBonuses.mjs`,
`utils/basicAttack.mjs`, `documents/actor.mjs`).

Scope: **35 specialisations, ~780 nodes.** Roughly 90 nodes are already
automated (real Active Effects or combat-modifier groups). The rest are tagged
*Manual — resolved at the table* today. This document sorts every remaining node
into **solution buckets** — nodes that need the same engine change are grouped so
one build unlocks many.

**Rating method** (same scale as the spell doc): **NEW = how many new engine
capabilities a bucket needs.** `D0` = data/config only, `D1` = small extension of
an existing function, `D2` = one self-contained subsystem, `D3` = touches the
attack/damage pipeline or AE/flag/hook ordering (fragile), `D4` = new framework
or GM-adjudicated by design (don't automate). Coverage (nodes unlocked) breaks
ties. Fewer new capabilities → higher priority.

**The golden rule from the spell pass applies here too:** the moment a bucket
lands, do the matching lang-description pass — flip *Manual* → *Automated* and
delete the "not automated yet" caveats, so nothing is double-applied at the
table.

---

## 0. The toolbox — what is ALREADY built (reuse, never rebuild)

Verified in code. Every item below composes from these.

**Passive application (two mechanisms, both driven by `syncSpecialisationPassive`
on node toggle):**
- **A — ActiveEffect `changes`** (`ae(add(path, value))`): plain additive stat
  buffs. Works ONLY on fields the derived math *adds* (`.bonus`, `.critbonus`,
  `.critfailpenalty`). Fields that `_prepareCharacterData` *overwrites* silently
  swallow AE (proven). See §5 of SPECIALISATIONS.md for the verified field map.
- **B — Combat-modifier groups** (`cm({...})`): writes a permanent group into
  `system.activeCombatEffects`, aggregated by `getActorCombatModifiers`
  (`combatSkillBonuses.mjs`). Supports `damageBonus`, `damageRoll`,
  `penetrationBonus` (+melee/ranged variants), and `extraEffects: {<id>: chance}`.
  This is the same pipeline as weapon enchants and is how every automated
  Bleeding/Stun/Precision/Penetration node already works.

**Combat-roll plumbing the harder buckets will hook into (all verified):**
- **Crit degree** is `critScore` 1–4, bucketed from `critRange + 1d20`
  (`combatSkillBonuses.mjs:748–757`: ≤6→1, ≤12→2, ≤18→3, else 4). `critScore`
  and the raw `critScoreResult` are both carried onto the attack card
  (`attackActions.mjs` ~L487, L816). **This is the single hook point for every
  "on Nth-degree crit" node.**
- **Crit range is already injectable at roll time.** `attackActions.mjs:197`
  does `customCritRange += Number(mod.system.critRange)` over selected modifier
  abilities, then feeds it into the bucket above. The *plumbing* to raise crit
  range exists — only the passive/spec *source* isn't wired into it yet.
  (The derived `critRangeMelee/Ranged/Cast` at `actor.mjs:805–807` are overwritten
  and cannot take an AE — that is why the injection must ride the combat-modifier
  path, not an AE.)
- **Sneak attack is a consumable flag.** The pre-attack dialog sets
  `flags.redsteel.useSneakAttack` (`attackActions.mjs:200`); `getSneakDamageFormula`
  (`combatSkillBonuses.mjs:5–39`) reads it, appends `{actor.system.sneakDamage}d6`
  + sneak effect chance + sneak crit-penetration, then **unsets the flag**. Sneak
  dice count = `system.sneakDamage` = `1 + system.sneakDamageBonus` (`actor.mjs:761`).
- **Precision merges from all sources.** Weapon quality + spec/ability precision
  contributions are pooled into the crit-confirm effect
  (`combatSkillBonuses.mjs:990–994`); `critScore > 1` gates confirmation. So
  every `overeni`/`precision` node already works — the only unmodelled part is
  *school-scoping* it.
- **Aim** — `module/utils/aim.mjs`: token-flag stacks (+10 %/stack, max 4),
  consumed on attack. The many "keeps Aim / Aim after hit / Aim +1" nodes are
  rule tweaks on top of this, not new tech.
- **Effect engine** — status immunity, `stackBehavior`, and per-status
  `effectMods.<id>.applyChance` already exist; several nodes already push
  `applyChance` negatives defensively.
- **Reroll pools** (`[[feature-reroll-trigger-model]]`) and **Mental Duel**
  (`mentalDuel.mjs`) and **Alchemy crafting** (`alchemy.mjs`) are live subsystems
  that several buckets below plug into rather than rebuild.

---

## Priority list

### S1 — Status-immunity passives — **D0–D1, NEW = 0–1**
Cleanest untapped win. Several nodes grant flat immunity to a status the effect
engine already models. Implement as an AE that adds the status to an immunity
set (or drives `effectMods.<id>.applyChance` to a large negative, mirroring the
existing defensive nodes).
**Covers:** berserk `imunitaPanika` (Panic/Fear/Terror), berserk
`mentalniOdolnost` (Disorientation), cryomancer `imunitaZpomaleni` (Slow),
countermage `magickaImunita` / `odolnostMagii` (as chance modifiers).
**Build:** confirm the engine's immunity storage; extend the passive DSL with
`immune(statusId)` → AE change into the immunity set. If immunity is only a
runtime check, add an `effectMods.<id>.immune` boolean read at apply time.
**Risk:** low, but it touches the effect layer → Lead reviews.

### S2 — Critical Range +X (weapon) — **D1, NEW = 1 — very high coverage**
The most-repeated unautomated bonus in the whole tree. The bucket exists in
*almost every caster and martial spec*.
**Covers (~15):** `kritRozsah`/`kritRozsah2` in skirmisher, sharpshooter,
astramancer, cryomancer, geomancer, maleficarum, pyromancer, vitamancer,
bloodSchool; ranger `metlaKritRozsah`; weaponMaster `critDefRange` (the +1 half);
shadow `sneakAttack` (the +3 half); incantator `ohniskovyPredmet` (+5 focus).
**Build:** teach `getActorCombatModifiers` to aggregate a `critRange` field from
`activeCombatEffects`, and have `attackActions.mjs` add that aggregate into
`customCritRange` alongside the existing per-ability read (L197). Then extend the
`cm()` DSL with `critRangeBonus`. Weapon (melee/ranged) crit range is fully
solved by this; **cast crit range** needs the same aggregate read inside the
magic pipeline (pair with S9).
**Note:** this supersedes the "needs a new input field first" caveat in
SPECIALISATIONS.md §5 — the combat-modifier path reaches `critScore` without
touching the overwritten derived fields.
**Risk:** medium — it shifts crit frequency; test degree distribution before/after.

### S3 — On-crit-degree guaranteed / boosted effects — **D2, NEW = 1**
"On a crit of degree ≥ N, force / add status X." Single hook: right after
`critScore` is known (`combatSkillBonuses.mjs:752`).
**Covers:** geomancer `povaleni` (knockdown from 3rd-degree), geomancer
`omracujiciRany1–3`, cryomancer `zmrazeniKrit` (Freeze +100 % from 4th),
pyromancer `podpaleniKrit` (Ignite +100 % from 3rd), astramancer `omraceniKrit`
(Stun +100 % from 2nd-degree).
**Build:** a node-keyed table `critDegreeTriggers[node] = { minDegree, effectId,
mode }` where `mode` is `force` (chance→100 %) or `boost` (+100 % to the rolled
chance). On attack finalize, if the actor owns the node and `critScore >=
minDegree`, inject/raise the matching entry in the card's `mechanicalEffects`.
Reuses the existing chance-effect UI — only the trigger is new.
**Risk:** touches the finalize path; Lead-owned. Pilot on `povaleni`.

### S4 — Sneak-attack source resolution (crit / outnumber / mental-strain) — **D2, NEW = 2**
**The user's flagship example.** Today sneak is opt-in and self-consuming (§0).
These nodes make a hit *count as* a sneak attack under a condition — and must
**not stack** with a deliberately-selected sneak.
**Covers:** shadow `critAsSneak` (crit ⇒ sneak), shadow `outnumberSneak` (2:1 ⇒
sneak), mentalist `vytizeniZakerne` (mental-strain attacks count as sneak).
**Build:** centralise into a `resolveSneakSource(actor, ctx)` called from
`getSneakDamageFormula`, returning a single source with strict precedence:
`manual (useSneakAttack) > auto-crit > auto-outnumber`. If `useSneakAttack` was
set, honour it and skip auto entirely (no double dice). For `critAsSneak` the
call must run *after* `critScore` exists, so the sneak formula append moves to
(or is recomputed at) the post-crit stage — flag this ordering explicitly in the
spec. Outnumber needs a target count: reuse the existing `useFlankingAttack`
signal or add a one-click confirm; don't try to derive board adjacency now.
**Risk:** high — ordering + flag lifecycle + no-stack invariant. Lead designs;
build `critAsSneak` first, then generalise.

### S5 — Post-roll crit adjustment (Veteran) — **D3, NEW = 2**
The other inevitable combat-workflow mechanic: **change crit range on a roll
that already happened.** Because degree is `f(critRange + storedD20)`, "Veteran"
= re-bucket the *stored* `critScoreResult` with extra crit range, possibly
promoting the degree.
**Covers:** weaponMaster `veteran1`/`veteran2`, sharpshooter `presnyVystrel`
(crit-range advantage on a shot), swordServant `presneRozseknuti`.
**Build:** carry `critScoreResult` + the crit-range used onto the card (already
carried, `attackActions.mjs:816`). Add a post-roll **"Veteran"** button that
recomputes `critScore` with `+N` crit range and re-renders the crit block +
downstream damage/effects. Integrate with the reroll-pool UI so it shares the
"modify a resolved combat roll" surface rather than inventing a new one.
**Risk:** highest in this doc — rewrites a resolved card's crit + damage +
effects. Lead-only; throwaway-world crit/penetration/half-damage regression pass.

### S6 — Maneuver-gated combat toggles — **D2, NEW = 2 — high coverage**
A large family of nodes is "when you Charge / Cleave / Attack-on-the-Move /
Shield-Bash / are outnumbered, get +damage / +hit / smaller penalty." The
attack dialog already has opt-in checkboxes (Sneak, Flanking, Aimed) that inject
context — extend that pattern with **maneuver toggles** that inject a `cm`-style
rider for that one attack.
**Covers (~25):** Charge damage/movement (swordServant `chargeDamage`, vanguard
`ztec*`, hoplite, warden `uderZraneni*` shield-bash), Cleave (vanguard
`rozseknuti*`, champion/vanguard `ztecSRozseknutim`), Attack-on-the-Move
(swordServant/skirmisher/champion `utokSPohybem`), outnumber-penalty reduction
(vanguard/champion `presilaPostih`), Overpower (weaponMaster `presileni`),
Momentum (hoplite/vanguard).
**Build:** a data table `maneuverRiders[node] = { maneuver, cm:{…} }`; render a
toggle per available maneuver in the attack dialog; on select, merge the rider
into that attack's modifiers (same merge point selected modifiers already use).
Movement/positioning stays GM-adjudicated — only the *numeric rider* is
automated.
**Risk:** medium; additive to an existing dialog. Good D2 pilot: Charge damage.

### S7 — Primary-attribute damage scaling — **D2, NEW = 2**
"Damage +50 % from Primary Attributes" / "+Str and Dex to damage."
**Covers:** weaponMaster `primaryDamage`, berserk `primarniZraneni`,
sharpshooter `primarniZraneni`, hoplite `silaObratnost`, warden
`uderZraneniSila` (+Str/2).
**Build:** a conditional damage-pipeline addend computed from the actor's primary
attribute(s) at roll time (a `cm`-flavoured `primaryDamageScale` the damage
formula reads). Must define rounding + which attribute per weapon class in the
spec.
**Risk:** medium — edits the damage formula; verify vs crit multipliers.

### S8 — Bane target system — **D2–D3, NEW = 2**
Ranger/Grimm/Shadow "Bane" nodes grant bonuses **only against a chosen creature
type** (penetration, crit range, crit hit/defense, precision, crit damage vs the
Bane).
**Covers:** ranger `metla*` (Penetration/CritRange/CritDef/CritHit/Precision/
CritDamage), grimm banes + `metla*`, shadow/ranger/grimm/mystic/countermage
`bane*` unlock slots.
**Build:** a per-actor "active Bane target type" selector (flag) + conditional
combat modifiers that only merge when the current target's type matches. Needs a
lightweight creature-type tag on actors/tokens. The `bane1/2/3` "unlocks one
Bane" slots stay narrative (which creature) — only the *mechanical rider* vs the
tagged type is automated.
**Risk:** needs target typing; medium-hard. Defer behind S2/S6 (it reuses both).

### S9 — School-scoped magic attack / defense — **D2, NEW = 2**
Per-school channeling attack/defense %, currently only global fields exist.
Already flagged "tackle later properly" in code — do it once, centrally.
**Covers:** bloodSchool `magicAttack1–3`/`magicDefense1–3`, bard
`magUtokObrana1–3`, elymas MC/FD cluster, incantator `soustredeni`, priest
`testViry1–5` (faith test on attack/defense), veneficus, all the `overeni`
"applies to all attacks for now" school-scoping.
**Build:** add `schools.<school>.attackBonus/.defenseBonus` fields; read them in
`magicSkillBonuses.mjs` when the cast's `spellSchool` matches; scope the existing
precision nodes to their school here too. Also delivers **cast crit range** for
S2.
**Risk:** medium; magic pipeline. Design the field shape with the user (mirrors
the SK/spellPower map).

### S10 — Node-conditional spell modifiers — **D1 per node after infra, NEW = 2 (shared with spells)**
"If the caster owns node X, spell Y gains +Z." Overlaps the spell dev plan.
**Covers (~40, the biggest raw count):** spellslinger's entire animal roster
(`salamander/zabak/jiskra/harpuna/slepice/termit/…` ignite/slow/stun/penetration/
chaining +%), colored/wild fire (pyromancer `barevnyOhen*`, `divokyOhen*`),
cryomancer `ledoveUlomky`/`ledoveKopi`/`ostryLed`, entomancer acid/poison-spray,
gnostic slow-damage, astramancer chain/ball lightning, geomancer stone/regen,
vitamancer restoration riders.
**Build:** a `spellNodeModifiers` lookup consulted in the cast pipeline:
`{spellId or spellTag} × ownedNode → {chanceDelta, damageDelta, durationDelta,
targetDelta}`. This is mostly a **data table** once the one lookup hook exists;
it rides the spell-effects infrastructure (chance fields, duration SK-block,
target count). **Coordinate with SPELL_EFFECTS_DEV_PLAN** — build the hook there,
populate the table here.
**Risk:** low-medium once the hook lands; pure data thereafter.

### S11 — Kill / round resource triggers — **D2, NEW = 2 (shares spell on-death infra)**
"On kill / per round, restore a resource."
**Covers:** berserk `obnovaVydrze` (kill → +4 Stamina), veneficus `slevaMany`
(melee kill → −2 mana next spell), mentalist `mentalniUder` (kill → +1 MH),
maleficarum `vysaniDuse` (per round → drain 1 MH), mentalist duel drains.
**Build:** reuse the spell plan's `onDeath` dispatch point
(SPELL_EFFECTS_DEV_PLAN P11) + an `onRoundStart` for the per-round ones; a
node-keyed handler adjusts the owner's resource. Until that infra exists, these
are **trigger reminders** (S-Reminders below).
**Risk:** medium; ordering with death resolution. Shares the spell death hook.

### S12 — Aim-rule extensions — **D1–D2, NEW = 1**
Tweaks to `aim.mjs` consumption/retention rules.
**Covers:** "keeps Aim while moving/slow-move" (skirmisher `mireniPohyb`,
sharpshooter `mireniPomalyPohyb`), "Aim after hit/miss/throw" (sharpshooter
`redukceMireni`/`mireniPoMinuti`, skirmisher `mireniPoVrhu`), "Respite: Aim +1"
(the many `oddechMireni`), "Precision from Aiming" (sharpshooter `mireniOvereni`,
veneficus `magickeMireni`), target lock, keep-Aim-in-stance.
**Build:** per-node flags read by aim.mjs at move/attack/respite time; several
are just "don't consume Aim on event E." Group and batch.
**Risk:** low; localized to aim.mjs.

### S13 — Alchemy crafting node hooks — **D1–D2, NEW = 1**
Feed `alchemy.mjs` the many crafting modifiers.
**Covers:** all Alchemist duplication +% / crit-fail −3 / advantage-on-crafting /
toxicity / addiction / ingredient & tissue reduction / guaranteed-success nodes;
plus mutation-guidance and the `tkane*` tissue-yield nodes (grimm/entomancer).
**Build:** read owned nodes in the craft-roll + yield math (advantage & crit-fail
map to the roll engine that already exists; duplication/yield are output
multipliers). Bounded to the crafting subsystem.
**Risk:** low; no combat surface.

### S14 — Mental-duel node modifiers — **D1, NEW = 1**
Extend `mentalDuel.mjs` with the mentalist/countermage duel bonuses.
**Covers:** mentalist `soubojZahajeni1–4`/`soubojDotek`/`soubojUdrzovani`/
`soubojPostih`/`soubojMZ1–2`/`mentalniSouboj10a/b`, countermage
`vynucenySouboj`/`soubojDemoni`.
**Build:** initiation %, upkeep-action, success-penalty, drain deltas read from
owned nodes at the duel's roll/upkeep points. Mostly additive numbers into an
existing subsystem.
**Risk:** low-medium; contained.

---

## Trigger reminders — announce, don't automate (**D1 infra, then D0 per node**)

A large class of nodes is a **conditional ability the player chooses to use**,
not a passive. Automating the *decision* is wrong, but the system should
**remind** the player when the trigger condition is live — a whisper/toast on the
relevant card, like the spell cards' follow-up prompts. Build one lightweight
"specialisation reminder" surface, then attach reminders as data.

Good reminder candidates (fire on a detectable event, resolution stays manual):
- **On kill:** berserk `masakr1/2` (Terrifying Massacre), `obnovaVydrze`,
  veneficus `slevaMany`, mentalist `mentalniUder` — "You killed a target: <node>
  is available."
- **On being hit / defending:** all Riposte/Retaliation/Counterattack nodes
  (swordServant `riposta*`, warden `uderStitemOdveta`, champion `riposta`/
  `odvetnyUder`, sharpshooter `odvetnyVystrel`, skirmisher `odvetnyVrh`, elymas
  Magic Counterattack) — "Reaction available." (Full automation = the deferred
  reaction engine, S-Defer.)
- **On crit / on hit:** hoplite `velkeTvory` (Impale follow-up), swordServant
  `draci*`, shadow `weakSpotMastery`.
- **On low HP / grave wound:** berserk/vitamancer `rychlaLecba`, warden defensive
  stances.
- **On charge declared:** every Charge/Advance/Onslaught node not covered by S6.

Implementation: a `reminders[node] = { on: <event>, text }` table + one hook per
event that whispers to the owner. Zero risk to state; high table-experience win.

---

## Defer / never-automate

- **S-Defer — Reaction/interrupt engine.** Riposte, Retaliatory throw/shot,
  Counterattack, Magic Counterattack, Shield Bash retaliation, Opportunity
  attacks. Same fragile hook-ordering problem as spell P13 — until then, S-Reminders
  cover them. Revisit only after S4/S5 stabilise the attack-card rewrite surface.
- **Summons / doubles / guardians / familiars** — elementalist `familiar`/
  `privolaniFamiliara`, illusionist `dvojnik`/`mysterinStrazce`, spellslinger
  familiars. Separate actor-template framework (spell P14). Out of scope.
- **Illusions, Court, Prayer/Miracles/Blessings, Telepathy/Mind Reading/
  Domination, Bane narrative** — GM-adjudicated by design. Markers only.
- **SP/CP discounts & requirement reductions** (`sleva*`, `skillDiscount*`,
  `pozadavkyLuku`, bow-requirement, re-arm stamina) — character-build / GM
  bookkeeping, not runtime. Leave as tooltip text.
- **"Damage +50 %"-style situational one-offs already inside S6/S7** — don't
  double-handle.

---

## How to tackle it (process)

1. **Order by leverage:** S1 → S2 → S12 → S10-infra(with spell team) → S6-pilot
   (Charge) → S3-pilot (`povaleni`) → S9 → S13 → S14 → S7 → S4 (`critAsSneak`) →
   S11 → S8 → S5 (Veteran) → reminders infra. Never two combat-pipeline
   subsystems in flight at once — S3/S4/S5/S7 each touch attack finalize and are
   **Lead-designed, never delegated** (per CLAUDE.md).
2. **Per bucket:** Lead writes a settled spec (goal, exact files + changes, what
   NOT to touch, new lang keys with Czech drafts, verification commands, in-game
   test steps, pinned API signatures) → `foundry-builder` implements D1/D2 from
   the spec → Lead reviews the diff → user commits as one unit. D0 data passes
   (populating the S10 table, wiring immunities) can be inline.
3. **Data + description ride along:** every bucket lands with its node-JSON/
   `SPEC_DEFS` wiring **and** the lang-description cleanup (flip *Manual* →
   *Automated* / *Partially automated*, delete "not automated yet" caveats).
   Double-application is worse than no automation.
4. **Testing:** throwaway world, try to break it — crit degrees 1–4, sneak +
   auto-sneak no-stack, crit-range promotion, immune targets, NPC-vs-PC owner
   (socket routing), and the adv/dis + Desperate Effort + Aim interactions.
5. **After each bucket:** update this file's checklist and re-run the node dump
   to confirm the *Automated* count moved.

## Status checklist

- [x] Baseline passives (~90 nodes): flat stat AEs, bleed/stun/burn/poison/freeze/
      precision `extraEffects`, penetration, skill/advantage/crit-fail, mana/
      health/stamina/spellPower/bloodPool/holyEnergy/mind/wil — **DONE** (wired in
      `specialisations.mjs` + `specialisations-generated.mjs`).
- [ ] S1 status-immunity passives
- [ ] S2 crit range +X (weapon)
- [ ] S3 on-crit-degree effects
- [ ] S4 sneak-source resolution (pilot: critAsSneak)
- [ ] S5 post-roll crit adjustment (Veteran)
- [ ] S6 maneuver-gated toggles (pilot: Charge)
- [ ] S7 primary-attribute damage scaling
- [ ] S8 bane target system
- [ ] S9 school-scoped magic attack/defense (+ cast crit range)
- [ ] S10 node-conditional spell modifiers (with spell team)
- [ ] S11 kill/round resource triggers (shares spell on-death hook)
- [ ] S12 aim-rule extensions
- [ ] S13 alchemy crafting hooks
- [ ] S14 mental-duel node modifiers
- [ ] Reminders infra + data
