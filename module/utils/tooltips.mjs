/**
 * Crusader Kings 3 style stacked tooltips.
 *
 * Hovering any element carrying `data-tt-kind` shows a tooltip after a short
 * delay. Keep the cursor on it and the tooltip *freezes*: it becomes
 * interactive, so you can move into it and hover the links inside, each of
 * which opens its own tooltip one level deeper. Leaving the whole stack (or
 * pressing Escape, or clicking outside) tears it down.
 *
 * Markup contract:
 *   data-tt-kind   required, selects the registered content provider
 *   data-tt-id     the thing to describe (item id, effect id, keyword id, ...)
 *   data-tt-*      anything else the provider wants, via ctx.dataset
 *
 * Providers are registered with `registerTooltip(kind, fn)` and return an HTML
 * string (or null for "nothing to show"). They may be async.
 *
 * Everything is bound once, delegated on document, so re-rendered sheets,
 * chat cards and dialogs all work with no rebinding.
 */

import { keywordTermIndex } from "./tooltipKeywords.mjs";

const TT = {
  /** Hover this long before a tooltip appears. */
  showDelay: 250,
  /** Extra hold, after it appears, before it freezes and becomes interactive. */
  freezeDelay: 600,
  /** Faster open for links inside an already-frozen tooltip. */
  nestedShowDelay: 120,
  /** Slower open when a frozen stack is up, so crossing icons doesn't steal it. */
  guardedShowDelay: 450,
  /** Grace period for crossing the gap between a tooltip and its parent. */
  closeGrace: 220,
  /** Non-frozen tooltips die almost immediately. */
  closeFast: 60,
  /** Gap between a tooltip and whatever it is anchored to. */
  gap: 10,
  /** Safety rail on runaway link chains. */
  maxDepth: 5,
};

const providers = new Map();

/** @type {HTMLElement|null} */
let root = null;
/** @type {Array<{el: HTMLElement, source: Element, depth: number, kind: string, frozen: boolean}>} */
let stack = [];

let showTimer = null;
let freezeTimer = null;
let closeTimer = null;
let pendingSource = null;
/** Bumped whenever a pending show is abandoned, so async providers can't land late. */
let showToken = 0;

let bound = false;

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

/**
 * @param {string} kind                       matches data-tt-kind
 * @param {(ctx: object) => string|null|Promise<string|null>} fn
 */
export function registerTooltip(kind, fn) {
  providers.set(kind, fn);
}

export function hasTooltipProvider(kind) {
  return providers.has(kind);
}

/* -------------------------------------------- */
/*  Lifecycle                                   */
/* -------------------------------------------- */

export function initTooltips() {
  if (bound) return;
  bound = true;

  root = document.getElementById("rs-tooltip-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "rs-tooltip-root";
    document.body.appendChild(root);
  }

  document.addEventListener("mouseover", onOver, false);
  document.addEventListener("mouseout", onOut, false);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  // Any scroll or resize invalidates every anchor we measured.
  document.addEventListener("scroll", closeAllTooltips, true);
  window.addEventListener("resize", closeAllTooltips);
  window.addEventListener("blur", closeAllTooltips);
}

export function closeAllTooltips() {
  cancelShow();
  cancelClose();
  clearTimeout(freezeTimer);
  freezeTimer = null;
  for (const layer of stack) layer.el.remove();
  stack = [];
}

/* -------------------------------------------- */
/*  Hover handling                              */
/* -------------------------------------------- */

function onOver(ev) {
  const target = ev.target;
  if (!(target instanceof Element)) return;

  // A sheet closed out from under us while its tooltip was up.
  if (stack.some((l) => !l.source.isConnected)) closeAllTooltips();

  const src = target.closest("[data-tt-kind]");
  const layerEl = target.closest(".rs-tooltip");
  const layerIdx = layerEl ? stack.findIndex((l) => l.el === layerEl) : -1;

  // Any movement inside the stack keeps the stack alive.
  if (layerIdx >= 0) cancelClose();

  // Back onto the source that owns an open layer: keep it, drop its children.
  if (src) {
    const owning = stack.findIndex((l) => l.source === src);
    if (owning >= 0) {
      cancelClose();
      cancelShow();
      pruneDeeperThan(owning);
      return;
    }
  }

  // Over tooltip chrome but not over a link: close anything deeper.
  if (!src) {
    if (layerIdx >= 0) {
      cancelShow();
      pruneDeeperThan(layerIdx);
    }
    return;
  }

  // A source inside layer N opens at depth N+1; a source out on the page is 0.
  const depth = layerIdx + 1;
  if (depth > TT.maxDepth) return;
  scheduleShow(src, depth);
}

function onOut(ev) {
  const target = ev.target;
  if (!(target instanceof Element)) return;

  const to = ev.relatedTarget instanceof Element ? ev.relatedTarget : null;
  const src = target.closest("[data-tt-kind]");
  const layerEl = target.closest(".rs-tooltip");

  // Moving between children of the same source or the same tooltip is not a leave.
  if (to) {
    if (src && to.closest("[data-tt-kind]") === src) return;
    if (layerEl && to.closest(".rs-tooltip") === layerEl) return;
  }

  if (src && src === pendingSource) cancelShow();
  if (!stack.length) return;
  scheduleClose();
}

function onMouseDown(ev) {
  const target = ev.target;
  if (!(target instanceof Element)) return;
  // Clicks inside a frozen tooltip belong to the tooltip.
  if (target.closest(".rs-tooltip.frozen")) return;
  closeAllTooltips();
}

function onKeyDown(ev) {
  if (ev.key === "Escape" && stack.length) closeAllTooltips();
}

/* -------------------------------------------- */
/*  Show / freeze / close                       */
/* -------------------------------------------- */

function scheduleShow(src, depth) {
  if (pendingSource === src) return;
  cancelShow();
  pendingSource = src;

  let delay = TT.showDelay;
  if (depth > 0) delay = TT.nestedShowDelay;
  else if (stack.some((l) => l.frozen)) delay = TT.guardedShowDelay;

  const token = showToken;
  showTimer = setTimeout(() => showTooltip(src, depth, token), delay);
}

function cancelShow() {
  clearTimeout(showTimer);
  showTimer = null;
  pendingSource = null;
  showToken++;
}

async function showTooltip(src, depth, token) {
  showTimer = null;
  pendingSource = null;

  const kind = src.dataset.ttKind;
  const provider = providers.get(kind);
  if (!provider) return;

  let html = null;
  try {
    html = await provider({
      id: src.dataset.ttId ?? null,
      kind,
      source: src,
      dataset: src.dataset,
      depth,
      actor: resolveActor(src),
    });
  } catch (err) {
    console.error(`Redsteel | tooltip provider "${kind}" failed`, err);
    return;
  }

  // The cursor moved on while the provider was awaiting, or the source is gone.
  if (token !== showToken || !html || !src.isConnected) return;

  // Opening at this depth replaces everything at this level and below.
  pruneDeeperThan(depth - 1);

  const el = document.createElement("div");
  el.className = "rs-tooltip";
  el.dataset.depth = String(depth);
  el.innerHTML = `<div class="rs-tooltip-inner">${html}</div>`;
  linkifyKeywords(el);
  root.appendChild(el);

  // Links inside an already-frozen tooltip are born interactive: the player is
  // in inspect mode already and should not have to hold a second time.
  const frozen = depth > 0;
  const layer = { el, source: src, depth, kind, frozen };
  if (frozen) el.classList.add("frozen");
  stack.push(layer);

  positionLayer(layer);

  clearTimeout(freezeTimer);
  freezeTimer = null;
  if (!frozen) freezeTimer = setTimeout(() => freezeLayer(layer), TT.freezeDelay);
}

function freezeLayer(layer) {
  freezeTimer = null;
  if (!stack.includes(layer)) return;
  layer.frozen = true;
  layer.el.classList.add("frozen");
}

function scheduleClose() {
  cancelClose();
  const delay = stack.some((l) => l.frozen) ? TT.closeGrace : TT.closeFast;
  closeTimer = setTimeout(closeStaleLayers, delay);
}

function cancelClose() {
  clearTimeout(closeTimer);
  closeTimer = null;
}

/**
 * Keep the stack up to the deepest layer the cursor is actually touching —
 * either the tooltip itself (frozen ones accept the pointer) or its source.
 * Everything past that is stale.
 */
function closeStaleLayers() {
  closeTimer = null;
  let deepestAlive = -1;
  for (let i = 0; i < stack.length; i++) {
    const l = stack[i];
    if (!l.source.isConnected) break;
    if (l.el.matches(":hover") || l.source.matches(":hover")) deepestAlive = i;
  }
  pruneDeeperThan(deepestAlive);
}

/** Remove every layer with an index greater than `idx`. */
function pruneDeeperThan(idx) {
  while (stack.length - 1 > idx) {
    const layer = stack.pop();
    layer.el.remove();
    if (!stack.length) {
      clearTimeout(freezeTimer);
      freezeTimer = null;
    }
  }
}

/* -------------------------------------------- */
/*  Positioning                                 */
/* -------------------------------------------- */

/**
 * Depth 0 sits beside its source. Deeper layers sit beside the *parent
 * tooltip* so the chain cascades sideways instead of covering what spawned it,
 * while still lining up vertically with the link that opened them.
 */
function positionLayer(layer) {
  const pad = 4;
  const srcRect = layer.source.getBoundingClientRect();
  const anchor =
    layer.depth === 0
      ? srcRect
      : stack[layer.depth - 1]?.el.getBoundingClientRect() ?? srcRect;

  const el = layer.el;
  el.style.left = "0px";
  el.style.top = "0px";
  const rect = el.getBoundingClientRect();

  let left = anchor.right + TT.gap;
  if (left + rect.width > window.innerWidth - pad) {
    left = anchor.left - rect.width - TT.gap;
  }
  left = Math.max(pad, Math.min(left, window.innerWidth - rect.width - pad));

  let top = srcRect.top;
  if (top + rect.height > window.innerHeight - pad) {
    top = window.innerHeight - rect.height - pad;
  }
  top = Math.max(pad, top);

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

/* -------------------------------------------- */
/*  Keyword auto-linking                        */
/* -------------------------------------------- */

let keywordPattern = null;
let keywordLookup = null;

function buildKeywordPattern() {
  const entries = keywordTermIndex();
  keywordLookup = new Map();
  const alts = [];
  for (const { id, term } of entries) {
    keywordLookup.set(term.toLowerCase(), id);
    alts.push(escapeRegex(term));
  }
  // \b is ASCII-only and would break on Czech diacritics, so bound the match
  // with explicit "not a letter or digit" lookarounds instead.
  keywordPattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${alts.join("|")})(?![\\p{L}\\p{N}])`,
    "iu",
  );
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SKIP_LINKIFY = new Set(["A", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "CODE"]);

/**
 * Wrap the first occurrence of each glossary term in `container` with a
 * tooltip link. Walks text nodes only, so it can never corrupt attributes, and
 * never reaches inside something that is already a link or a tooltip source.
 */
export function linkifyKeywords(container) {
  if (!keywordPattern) buildKeywordPattern();
  if (!keywordLookup?.size) return;

  const used = new Set();
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      for (let el = node.parentElement; el && el !== container; el = el.parentElement) {
        if (SKIP_LINKIFY.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (el.hasAttribute("data-tt-kind")) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets = [];
  while (walker.nextNode()) targets.push(walker.currentNode);

  for (const node of targets) {
    const match = keywordPattern.exec(node.nodeValue);
    if (!match) continue;
    const id = keywordLookup.get(match[1].toLowerCase());
    if (!id || used.has(id)) continue;
    used.add(id);

    const after = node.splitText(match.index);
    after.nodeValue = after.nodeValue.slice(match[1].length);

    const link = document.createElement("span");
    link.className = "tt-link";
    link.dataset.ttKind = "keyword";
    link.dataset.ttId = id;
    link.textContent = match[1];
    after.parentNode.insertBefore(link, after);
  }
}

/* -------------------------------------------- */
/*  Helpers for providers                       */
/* -------------------------------------------- */

/**
 * Best-effort actor for a hovered element. Explicit `data-tt-actor-uuid`
 * anywhere up the tree wins; sheets stamp that on their root element on
 * render, which keeps us off undocumented application-registry internals.
 */
export function resolveActor(el) {
  const holder = el.closest?.("[data-tt-actor-uuid]");
  const uuid = holder?.dataset.ttActorUuid;
  if (!uuid) return null;
  try {
    const doc = fromUuidSync(uuid);
    return doc?.actor ?? doc ?? null;
  } catch (err) {
    return null;
  }
}

/** Escape text destined for tooltip HTML. */
export function ttEscape(str) {
  return String(str ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/** Standard tooltip shell: icon + title, then arbitrary body HTML. */
export function ttFrame({ title, img, subtitle, body, footer }) {
  return [
    `<div class="tt-head">`,
    img ? `<img class="tt-icon" src="${ttEscape(img)}" alt="">` : "",
    `<div class="tt-headings"><div class="tt-title">${ttEscape(title ?? "")}</div>`,
    subtitle ? `<div class="tt-subtitle">${ttEscape(subtitle)}</div>` : "",
    `</div></div>`,
    body ? `<div class="tt-body">${body}</div>` : "",
    footer ? `<div class="tt-footer">${footer}</div>` : "",
  ].join("");
}
