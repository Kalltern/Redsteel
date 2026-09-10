/**
 * Progressive collapse for Redsteel chat cards.
 *
 * A card lives at one of three levels:
 *
 *   full       everything the card knows: title, damage/penetration/crit block,
 *              effects table, the roll boxes and every action button.
 *   compact    title + roll boxes + buttons. The outcome detail that lives in
 *              the flavor (crit banner, damage line, effects, description) is
 *              hidden. This is the opt-in "less verbose" reading.
 *   collapsed  the title row, a one-line summary of the outcome, and the action
 *              buttons. Everything else goes.
 *
 * Four rules decide the level, strongest first:
 *
 *   1. A reader who clicked the card. That choice holds for the session.
 *   2. An NPC auto-defense. Nobody is waiting on one and they arrive in bulk,
 *      so they open at `collapsed`.
 *   3. Age: the card is older than the last combat round tick, or older than
 *      the fold-away delay. Either one puts it at `collapsed`.
 *   4. The reader setting "Compact combat cards": `compact` or `full`.
 *
 * A folded card is not bare. What survives the fold is what the table still
 * needs from it:
 *
 *   - `.rs-versus`, the defense card outcome word and its attack-versus-defense
 *     comparison. It is already in the card, so the CSS just carves it out.
 *   - `.rs-card-summary`, built here from `flags.attack`: the critical
 *     announcement if there was one, then the margin, the damage, and the
 *     effects that landed. It is in the card at every level and revealed by CSS
 *     only while folded.
 *   - `.button-container`, so a folded card is still answerable. Defend is the
 *     whole point of an attack card for the person being swung at, and a card
 *     that folds itself on a round tick must not take that away.
 *
 * That is what makes rule 2 worth having rather than merely tidy.
 *
 * The level is never written to the message. A collapse is a per-reader view
 * preference, not a fact about the card: storing it on the document would
 * broadcast one player tidying up to the whole table and mark the message dirty
 * for everyone. Everything here is client-side and, apart from the round mark,
 * lives only in memory. That costs nothing on reload, because rules 2 and 3
 * recompute the same answer from the message timestamp.
 *
 * The levels are applied as classes on the message root and enforced purely in
 * CSS (see "Progressive chat card collapse" in css/redsteel.css). Nothing here
 * restructures the DOM of the card, which is what makes it safe against the
 * dozen other renderChatMessageHTML hooks that inject pills and buttons: it
 * does not matter whether this hook runs before or after any of them, and cards
 * already sitting in an old chat log fold correctly too.
 */

const LEVEL = {
  FULL: "full",
  COMPACT: "compact",
  COLLAPSED: "collapsed",
};

/** messageId -> level the reader picked by clicking. Session-only. */
const manualLevels = new Map();

/** messageId -> pending fold-away timeout. */
const foldTimers = new Map();

/* -------------------------------------------- */
/*  Settings                                     */
/* -------------------------------------------- */

function registerSettings() {
  game.settings.register("redsteel", "chatCardCompact", {
    scope: "client",
    config: true,
    name: "REDSTEEL.Config.CardCompact.name",
    hint: "REDSTEEL.Config.CardCompact.label",
    type: Boolean,
    default: false,
    onChange: () => refreshAll(),
  });

  game.settings.register("redsteel", "chatCardAutoCollapse", {
    scope: "client",
    config: true,
    name: "REDSTEEL.Config.CardAutoCollapse.name",
    hint: "REDSTEEL.Config.CardAutoCollapse.label",
    type: Boolean,
    default: true,
    onChange: () => refreshAll(),
  });

  game.settings.register("redsteel", "chatCardFoldAutoDefense", {
    scope: "client",
    config: true,
    name: "REDSTEEL.Config.CardFoldAutoDefense.name",
    hint: "REDSTEEL.Config.CardFoldAutoDefense.label",
    type: Boolean,
    default: true,
    onChange: () => refreshAll(),
  });

  game.settings.register("redsteel", "chatCardCollapseSeconds", {
    scope: "client",
    config: true,
    name: "REDSTEEL.Config.CardCollapseSeconds.name",
    hint: "REDSTEEL.Config.CardCollapseSeconds.label",
    type: Number,
    range: { min: 0, max: 1800, step: 30 },
    default: 180,
    onChange: () => refreshAll(),
  });

  // When this client last saw a combat round tick over. Anything posted before
  // that belongs to a finished round. Stored rather than kept in memory so the
  // rule survives a page reload mid-fight, which is exactly when a player comes
  // back to a log full of cards they no longer need open.
  game.settings.register("redsteel", "chatCardRoundMark", {
    scope: "client",
    config: false,
    type: Number,
    default: 0,
  });
}

const autoCollapseOn = () =>
  game.settings.get("redsteel", "chatCardAutoCollapse") === true;

const compactOn = () =>
  game.settings.get("redsteel", "chatCardCompact") === true;

const foldAutoDefenceOn = () =>
  game.settings.get("redsteel", "chatCardFoldAutoDefense") === true;

const foldSeconds = () =>
  Number(game.settings.get("redsteel", "chatCardCollapseSeconds")) || 0;

const roundMark = () =>
  Number(game.settings.get("redsteel", "chatCardRoundMark")) || 0;

/* -------------------------------------------- */
/*  Which cards take part                        */
/* -------------------------------------------- */

/**
 * A card folds only if it is ours, carries a roll, and has a title row to fold
 * down to. The title row is the first element child of the flavor, which every
 * Redsteel roll card builds as an icon plus a name.
 *
 * The round digest is deliberately left out: it is posted at the round boundary
 * and read during the round after, so the round rule would fold it away at the
 * exact moment it becomes worth reading.
 */
function isCandidate(message) {
  if (!message?.rolls?.length) return false;
  if (message.getFlag?.("redsteel", "roundDigest")) return false;
  const flags = message.flags ?? {};
  return Boolean(flags.redsteel || flags.attack || flags.heal);
}

function titleRow(root) {
  return root.querySelector(".flavor-text")?.firstElementChild ?? null;
}

/* -------------------------------------------- */
/*  Keeping a folded card answerable             */
/* -------------------------------------------- */

/**
 * Everything on a card that a reader can act on.
 *
 * Actions only. A dice formula toggles between its short and long form on
 * click, and the Bane pill flips a damage block that is folded away anyway;
 * neither changes the state of the game, and keeping the blocks they sit in
 * would unfold most of the card for nothing.
 *
 * The versus-test lines are the reason this exists at all. A contested card
 * (Shield Bash, Knockdown, an attribute test) is answered by clicking its
 * margin rather than by a button, so hiding it would leave that card with no
 * way to answer it whatsoever.
 *
 * Kept deliberately tight. Every `data-action` on a chat card sits on a
 * `<button>` already, so listing the attribute as well would buy nothing and
 * would risk a `data-action` of Foundry's own, inside a dice box, dragging the
 * whole roll block into the folded view.
 */
const ACTIONABLE = [
  "button",
  "a.button",
  ".mos-followup",
  ".speed-followup",
].join(", ");

/**
 * Mark every actionable control and each of its ancestors, so the CSS can carve
 * the whole chain out of the fold by class.
 *
 * Marking the ancestors is what makes this work at any depth: a margin line
 * sits inside a bare `<p>` on one card, a `<span>` on another, and a
 * `<table><tr><td>` on a third, and no one selector reaches all three. The cost
 * is that a kept container brings its own contents along, so a folded contested
 * card shows the name of the test beside the margin. That is the right trade:
 * you cannot answer a margin you cannot read.
 *
 * Order against the other render hooks does not matter. Every control listed in
 * ACTIONABLE is written into the card's stored HTML when it is posted, not
 * injected later; the buttons, which ARE injected, are carved out by their
 * container's own class instead and need no marking.
 */
function markActionable(root) {
  for (const scope of [
    root.querySelector(".flavor-text"),
    root.querySelector(".message-content"),
  ]) {
    if (!scope) continue;
    for (const el of scope.querySelectorAll(ACTIONABLE)) {
      for (let node = el; node && node !== scope; node = node.parentElement) {
        node.classList.add("rs-fold-keep");
      }
    }
  }
}

/* -------------------------------------------- */
/*  Level resolution                             */
/* -------------------------------------------- */

function isFoldedByAge(message) {
  if (!autoCollapseOn()) return false;
  const posted = Number(message.timestamp) || 0;
  if (!posted) return false;

  const mark = roundMark();
  if (mark && posted < mark) return true;

  const seconds = foldSeconds();
  if (seconds > 0 && Date.now() - posted >= seconds * 1000) return true;

  return false;
}

/**
 * An NPC defense the system rolled on its own. Nobody is waiting on these and
 * they arrive in bulk, so they open folded: the outcome line survives the fold
 * (see the .rs-versus exception in the CSS), which is the whole of what they
 * have to say.
 *
 * Cards posted before this flag existed open at the ordinary level. They are
 * still one click from folded, and the age rules catch them anyway.
 */
function isAutoDefence(message) {
  return message.getFlag?.("redsteel", "autoDefense") === true;
}

function levelFor(message) {
  const chosen = manualLevels.get(message.id);
  if (chosen) return chosen;
  if (foldAutoDefenceOn() && isAutoDefence(message)) return LEVEL.COLLAPSED;
  if (isFoldedByAge(message)) return LEVEL.COLLAPSED;
  return compactOn() ? LEVEL.COMPACT : LEVEL.FULL;
}

/* -------------------------------------------- */
/*  The line a folded attack card keeps          */
/* -------------------------------------------- */

/**
 * Build the short summary a folded attack card shows under its title: the
 * critical announcement if there was one, then the margin and the damage, then
 * the effects that landed if any did.
 *
 * It is built here from the flags rather than carved out of the card's own
 * markup for two reasons. The critical banner the card prints is an unclassed
 * `<p>` emitted from several files, so there is nothing to carve out by name;
 * and the damage block is the whole five-cell table, which is exactly the
 * verbosity a fold is meant to remove. Everything needed is on `flags.attack`
 * already, and both attack emitters (basicAttack, combatAbilities) store it in
 * the same shape.
 *
 * Only attack cards get one. A spell card stores its critical thresholds but
 * not the outcome, and a defense card already keeps its versus block, which
 * says the same thing better.
 */
/**
 * Name an effect for display.
 *
 * The hotbar already keeps translations for the effects it shows, so that table
 * is reused rather than a second one being started that would have to be kept
 * in step with it. Anything it does not name falls back to its own id, which
 * covers the freeform custom effects an item is allowed to define and can never
 * be translated in advance. Adding a Czech name for one more effect is a pair
 * of lang entries under REDSTEEL.Bg3Hotbar.EffectMod, no code change.
 */
function effectLabel(id) {
  const key = `REDSTEEL.Bg3Hotbar.EffectMod.${id}`;
  if (game.i18n.has?.(key)) return game.i18n.localize(key);
  const words = id.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Which effects this attack landed, as `{id, count}`.
 *
 * Nothing is re-resolved here. `flags.attack.effects` is what getEffectRolls
 * already decided, and the criticality rule the table plays by is baked into
 * those numbers rather than being a special case at this end: a critical of
 * degree 2 or better adds +100 to the stagger chance and an extra wound to the
 * bleed count, at roll time, and only to those two. So a guaranteed stagger
 * arrives here as a roll that simply passed.
 *
 * This is the attack's own reading, before any target is chosen. The defender's
 * bleed resistance and a degree the GM moves in the Apply Damage dialog are
 * settled later, in applyDamage, and can still change what actually lands.
 */
function landedEffects(attack) {
  const effects = attack?.effects;
  if (!effects) return [];

  const critSuccess = attack.criticalSuccess === true;
  const landed = [];

  for (const [id, effect] of Object.entries(effects)) {
    if (!effect) continue;

    if (id === "bleed") {
      // Bleeding is counted rather than merely flagged: "2× Bleed" is worth
      // saying and "Bleed" alone is not the same claim. Crit stacks ride
      // along only on a critical, the same rule the damage figure follows.
      const stacks =
        (Number(effect.normalStacks) || 0) +
        (Number(effect.bonusStacks) || 0) +
        (critSuccess ? Number(effect.critStacks) || 0 : 0);
      if (stacks > 0) landed.push({ id, count: stacks });
      continue;
    }

    const chance = Number(effect.chance);
    const roll = Number(effect.roll);
    const passed =
      effect.auto === true ||
      (Number.isFinite(chance) && Number.isFinite(roll) && roll <= chance);
    if (passed) landed.push({ id, count: 1 });
  }

  return landed;
}

function buildFoldSummary(message) {
  const attack = message.flags?.attack;
  if (!attack) return null;

  const margin = attack.margin;
  if (margin == null) return null;

  const critSuccess = attack.criticalSuccess === true;
  const critFailure = attack.criticalFailure === true;

  // A critical lands the critical packet, so that is the number worth carrying:
  // printing the ordinary damage under a "Critical Success!" would understate
  // the blow by the whole crit bonus.
  const damage = critSuccess
    ? (attack.critical?.damage ?? attack.normal?.damage)
    : attack.normal?.damage;

  // Deliberately shaped like the versus block a defense card carries: a state
  // class on the root, an outcome line and a detail line. The two sit next to
  // each other in the log all the time, so they are styled as one pair (see
  // .rs-card-summary in the CSS, which mirrors .rs-versus rule for rule).
  const state = critSuccess
    ? " is-critical-success"
    : critFailure
      ? " is-critical-failure"
      : "";

  const summary = document.createElement("div");
  summary.className = `rs-card-summary${state}`;

  if (critSuccess || critFailure) {
    const outcome = document.createElement("div");
    outcome.className = "rs-card-summary-outcome";
    outcome.textContent = game.i18n.localize(
      critSuccess
        ? "REDSTEEL.Fold.CriticalSuccess"
        : "REDSTEEL.Fold.CriticalFailure",
    );
    summary.appendChild(outcome);
  }

  const detail = document.createElement("div");
  detail.className = "rs-card-summary-detail";
  detail.textContent = game.i18n.format("REDSTEEL.Fold.AttackSummary", {
    margin,
    damage: damage ?? "?",
  });
  summary.appendChild(detail);

  const landed = landedEffects(attack);
  if (landed.length) {
    const line = document.createElement("div");
    line.className = "rs-card-summary-effects";
    line.textContent = landed
      .map(({ id, count }) =>
        count > 1
          ? game.i18n.format("REDSTEEL.Fold.EffectStacks", {
              count,
              name: effectLabel(id),
            })
          : effectLabel(id),
      )
      .join(" · ");
    summary.appendChild(line);
  }

  return summary;
}

function applyLevel(root, level) {
  root.classList.toggle("rs-card--compact", level === LEVEL.COMPACT);
  root.classList.toggle("rs-card--collapsed", level === LEVEL.COLLAPSED);
}

/* -------------------------------------------- */
/*  Re-applying without a re-render              */
/* -------------------------------------------- */

/**
 * The same message can be on screen more than once (chat log plus a popped-out
 * card), so every copy is updated, not just the first.
 *
 * The id is read off our own `data-rs-card` stamp rather than off Foundry's
 * `data-message-id`, so a timer firing minutes later does not quietly do
 * nothing if that attribute ever moves.
 */
function elementsFor(messageId) {
  return document.querySelectorAll(`[data-rs-card="${messageId}"]`);
}

function foldableElements() {
  return document.querySelectorAll(".rs-card--foldable[data-rs-card]");
}

function refresh(messageId) {
  const message = game.messages?.get(messageId);
  if (!message) return;
  const level = levelFor(message);
  for (const el of elementsFor(messageId)) applyLevel(el, level);
}

function refreshAll() {
  // A changed delay moves every pending fold, so the old timers are all wrong.
  for (const timer of foldTimers.values()) clearTimeout(timer);
  foldTimers.clear();

  for (const el of foldableElements()) {
    const message = game.messages?.get(el.dataset.rsCard);
    if (!message) continue;
    applyLevel(el, levelFor(message));
    scheduleFold(message);
  }
}

/* -------------------------------------------- */
/*  The delay                                    */
/* -------------------------------------------- */

function scheduleFold(message) {
  const id = message.id;
  if (manualLevels.has(id)) return;
  if (foldTimers.has(id)) return;
  if (!autoCollapseOn()) return;
  // Already folded by a stronger rule, so there is nothing for a timer to do.
  if (levelFor(message) === LEVEL.COLLAPSED) return;

  const seconds = foldSeconds();
  if (seconds <= 0) return;

  const posted = Number(message.timestamp) || 0;
  const remaining = posted + seconds * 1000 - Date.now();
  // Already past due: levelFor has folded it, there is nothing to wait for.
  if (remaining <= 0) return;

  foldTimers.set(
    id,
    setTimeout(() => {
      foldTimers.delete(id);
      refresh(id);
    }, remaining),
  );
}

function forget(messageId) {
  const timer = foldTimers.get(messageId);
  if (timer) clearTimeout(timer);
  foldTimers.delete(messageId);
  manualLevels.delete(messageId);
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

export function registerChatCardCollapse() {
  registerSettings();

  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (!isCandidate(message)) return;

    const root = html.closest?.(".chat-message") ?? html;
    const title = titleRow(root);
    if (!title) return;

    root.classList.add("rs-card--foldable");
    root.dataset.rsCard = message.id;
    markActionable(root);
    applyLevel(root, levelFor(message));

    // Sits in the card at every level and is revealed by CSS only while folded,
    // so a fold and an unfold stay pure class flips with nothing to rebuild.
    // The guard is for the hook firing twice against one element, not across
    // renders: the element is rebuilt each time.
    if (!root.querySelector(".rs-card-summary")) {
      const summary = buildFoldSummary(message);
      if (summary) title.after(summary);
    }

    // The element is rebuilt on every render, so the guard only has to stop a
    // second binding within one element, not across renders.
    if (!title.classList.contains("rs-card-toggle")) {
      title.classList.add("rs-card-toggle");
      title.addEventListener("click", (event) => {
        // The title row carries the attack tag pills and can carry links; those
        // keep their own meaning.
        if (event.target.closest("a, button, .trait-pill, [data-action]"))
          return;
        event.preventDefault();

        const next =
          levelFor(message) === LEVEL.COLLAPSED ? LEVEL.FULL : LEVEL.COLLAPSED;
        manualLevels.set(message.id, next);

        // A deliberate choice outranks the delay: once the reader has said what
        // they want, the card must not fold itself back up under them.
        const timer = foldTimers.get(message.id);
        if (timer) clearTimeout(timer);
        foldTimers.delete(message.id);

        refresh(message.id);
      });
    }

    scheduleFold(message);
  });

  // A round ticking over is the primary fold trigger. Everything posted before
  // this moment answered a question that has now been settled.
  Hooks.on("updateCombat", (combat, changed) => {
    if (changed?.round === undefined) return;
    if (!autoCollapseOn()) return;
    game.settings.set("redsteel", "chatCardRoundMark", Date.now());
    // Cards a reader opened by hand keep their level, because levelFor consults
    // the manual choice before it looks at the age.
    for (const el of foldableElements()) {
      const message = game.messages?.get(el.dataset.rsCard);
      if (message) applyLevel(el, levelFor(message));
    }
  });

  Hooks.on("deleteChatMessage", (message) => forget(message.id));
}
