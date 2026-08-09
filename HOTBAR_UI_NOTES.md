# Redsteel hotbar — UI notes

Hard-won notes for anyone changing the Redsteel hotbar panel
(`module/utils/redsteelHotbar.mjs`, `templates/hotbar/redsteel-hotbar.hbs`, and
the panel section at the end of `css/redsteel.css`). Most of these cost a round
trip to discover. Read before touching layout.

## Naming

The files and the user-facing setting say **Redsteel**. Everything internal
still says `bg3`: the setting key `redsteel.bg3Hotbar`, the user flags
(`bg3HotbarRows`, `bg3HotbarSkillRows`, `bg3HotbarArmorView`,
`bg3PlayersTucked`), the `Bg3Hotbar` class, the `rs-bg3-` CSS prefix and the
`REDSTEEL.Bg3Hotbar.*` lang block.

**Do not rename those.** The setting key and the flags are stored per user, so a
rename silently orphans everyone's choices. The class name generates the
`renderBg3Hotbar` hook that `endTurnButton.mjs` listens for.

The one flag that was replaced rather than kept is `bg3HotbarCondFolded`, whose
chip now switches the stat tray between conditions and armor instead of folding
it. A new key (`bg3HotbarArmorView`) rather than a reused one, because a stored
`true` used to mean "folded" and would have put its owner in the armor view for
no reason they could see. Orphaning a flag is the right move only when its
meaning changes under it; otherwise the rule above stands.

## Architecture, and why

- **The core hotbar is hidden, not replaced.** `CONFIG.ui.hotbar` is untouched
  and core's Hotbar stays instantiated behind `display: none`. That is the only
  reason the 1–0 number keys still fire page-1 macros. Subclassing core's Hotbar
  was rejected because its template and drag handlers are undocumented and
  reading the installed app source is off-limits.
- **No roll maths is reimplemented.** Cells carry the character sheet's exact
  `data-roll` / `data-roll-type` / `data-label`, and clicks call
  `RedsteelActorSheet._onRoll.call(actor.sheet, event, detachedEl)`. That static
  only touches `this.actor`, `this.evaluateCriticalSuccess` and `target.dataset`,
  so an unrendered sheet is a valid context. This is what keeps margin of
  success, crit shift, Desperate Effort, roll advantage, trait pills and the
  versus-Test line identical to sheet rolls. Never fork it.
- **Visibility guards mirror the sheet.** Which resource bars and conditions
  appear is copied from `templates/actor/header.hbs`, not invented. If the sheet
  changes, change both.
- **`renderBg3Hotbar` is fired by hand** in `_onRender`. ApplicationV2's
  `render<ClassName>` convention is not documented for V14, and the End Turn
  button depends on it. The listener is idempotent, so a duplicate core-fired
  hook is harmless.

## Fighting core CSS

Three separate bugs in this session came from the same root: **core's selectors
outrank bare class selectors.**

- `#players button` is `(1,0,1)`; `.rs-players-peek` is `(0,1,0)`. The class
  loses. Scope under the id, or set the property inline from JS when it simply
  has to win. The player-list toggle sets `position` / `top` / `right` inline
  for exactly this reason.
- `#players` is **not** the element that paints the visible panel; it is a larger
  transparent container. Anything prepended to it lands *above* the box. Find the
  painted panel structurally (`playerPanel()` walks up from the latency readout),
  never by guessing a class name.
- Core gives every `button` a fixed height. Any button of ours holding an icon
  larger than that needs `height: auto` with a `min-height`, or the icon bursts
  out of its border. The weapon-set rows hit this.

Related: **`#ui-bottom` is `pointer-events: none`** and every bar inside it opts
back in. The whole panel was inert to the mouse until `pointer-events: auto` was
added to its root.

## Layout rules that bit

- **`max-width` caps a width, it does not set one.** A flex child with only a cap
  still shrinks toward zero. Pin `width`, `min-width` and `flex` together. The
  slim chat input collapsed to an unclickable sliver from this.
- **A wrapping flex box inside a shrink-to-fit parent** can resolve to its full
  cap rather than its contents, padding empty space onto the far side and
  dragging the whole wing outward. Add `width: max-content` alongside the cap.
- **A wrapping flex container cannot size itself.** Its intrinsic width is
  computed as though every item sat on one line, so a column-wrap box in a wing
  comes out as wide as all its contents in a row. State the width instead: the
  condition strip takes a column count from the template (`statusCols`, six
  icons per column) and computes its own width from it. The count lives in both
  `redsteelHotbar.mjs` and the CSS comment, and the two must agree.
- **Only the bar is in flow.** `.rs-bg3-anchor` is the bar; the left wing
  (portraits, resource strip), the right wing (condition icons, wrench) and the
  capacity readout are all absolutely positioned off its edges. Nothing in the
  wings may take layout space, or gaining a teammate shifts the bar under the
  user's cursor.
- **Prefer a stated rule over a measured budget.** A measured max-width feeds
  back on the thing it constrains and oscillates. "Five portraits per row" is
  better than "as many as fit". Derive the *thresholds* from one real
  measurement, then verify with a table (see below).

## Verify layout arithmetic before claiming it works

Three of this session's layout estimates were wrong and were caught by checking,
not by looking. When changing sizes or breakpoints, print a table:

```
viewport  cols  leftmost portrait   clears the player list (230px)?
   2560     5               288px   yes
   1940     2               290px   yes
   1500     2               181px   overlaps by 49px
```

The party-row thresholds were derived from a single measured fact (at 2560 with
five columns the leftmost portrait sits 330px from the edge), which gives 149px
fixed plus 104px per column. That reproduced an independently observed fact —
that 1920 only ever fits two — which is what made it trustworthy.

## Handlebars

- The system registers its own helpers in `redsteel.mjs`: `or`, `eq`, `range`,
  `percentOf`, `math` and others. **Verify a helper exists before using it.**
  `concat` was assumed once and had to be replaced by localizing in the context.
- **`{{#if 0}}` is falsy.** Any numeric field that can legitimately be zero needs
  a separate boolean (`hasChance`, `any`), or a debuffed stat silently vanishes.

## Visual conventions

- **Grimdark, not neon.** Cells are sockets cut into the panel: dark flat fill,
  inner shadow from the top, no radius. A 1px light edge on the top-left plus a
  shadow bottom-right is the recipe for moulded plastic and reads as a Mario
  button. Do not add one.
- **Never dim the default state to make the active one stand out.** Relevant
  conditions brighten with `filter: brightness()`; the rest render in the sheet's
  own colours untouched.
- **Colours come from the sheet.** Attribute tints are the seven from
  `.skill-section.attribute-*`, resource palettes are the `--bar-hi/mid/lo` sets
  from `.resource-bar.*`, condition icons and colours are copied verbatim from
  `header.hbs`. Never pick a new colour when the sheet already has one.
- **The portrait's metal band is the one place with its own palette.** It is
  the player's colour where there is a player, and otherwise the creature-type
  colour from `RACE_BANDS` in `redsteelHotbar.mjs`. No sheet palette covers
  creature types, so those ten are picked here rather than borrowed. They are
  *inputs*: the frame mixes each 55% into `#0a0a09`, so verify a replacement by
  computing the mix. Sixteen bands is a lot for a dark low-saturation ring and
  five of them are reds, so the set was searched for the widest minimum
  separation rather than picked hue by hue. **Changing one value alone will
  usually collide with a neighbour** — re-run the search.
- **Filling a circle: map percentage to *area*, not height.** A circle filled to
  a quarter of its height covers about 19.6% of it. `circleFillHeight()` inverts
  the circular-segment area with Newton. Rectangles need no correction — the
  resource bars deliberately use the raw percentage.
- **For "darker", use `mix-blend-mode: multiply`,** not a translucent overlay. A
  film greys everything evenly; multiplying drives the darks down and keeps the
  highlights, which is what reads as consumed rather than dimmed.

## Line endings

`css/redsteel.css`, `lang/en.json` and `lang/cs.json` are **CRLF on disk**. A
Python rewrite flattened both lang files to LF once and it went unnoticed until
checked. After any scripted edit:

```bash
python -c "d=open('css/redsteel.css','rb').read(); c=d.count(b'\r\n'); print(c, d.count(b'\n')-c)"
```

The second number must be `0`. `specialisations-generated.mjs` is CRLF too.

## Third-party integration

`healthEstimate` supplies the teammate hover text. Call its API
(`getFraction`, `getStage`, `isDead`, `deathStateName`) rather than
reimplementing the thresholds, and **honour its own visibility gates**
(`breakOverlayRender`, `hideEstimate`). Without them the panel becomes a second
channel for reading party health that bypasses the GM's configuration. Guard the
whole thing on the module being active.

## Settings and flags

Client settings: `bg3Hotbar` (on by default, reload required), `bg3SlimChat`,
`bg3HotbarCapacity` (debug readout). World setting, GM-restricted:
`bg3HotbarTeamHealth` — whether players may read each other's health, which is a
table rule rather than a preference. GMs always see it.

Actor flags: `favouriteSkills` (20 slots, always stored at full capacity so
collapsing a row hides rather than clears). Free-form actor fields, matching how
`magicPotential` and `priest` already work with no `template.json` entry:
`bloodMage`, `partyMember`.
