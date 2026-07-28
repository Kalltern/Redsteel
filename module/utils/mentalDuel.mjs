import { SOCKET } from "./applyDamage.mjs";
import { actorHasSpecNode } from "../helpers/specialisations.mjs";

// Only a winner who can Dominate may seize control: any NPC, or a player
// character who has unlocked the Mentalist "Domination" (ovladnuti) perk.
function canDominate(actor) {
  return (
    actor?.type === "npc" || actorHasSpecNode(actor, "mentalist", "ovladnuti")
  );
}

/**
 * Mentální souboj (Mind Bending) — an interactive duel window.
 *
 * Two combatants face off. Each may, on their turn, spend a Free Action to
 * invoke a versus Mental Duel test. Winning drains the loser one Mind point
 * (two on a Critical success, or when the winning margin reaches +60). When a
 * side hits 0 Mind, the winner may seize control of the loser.
 *
 * Attack rating = Will×3 + Skill + Expertise + Specialization, which the
 * system already aggregates into `system.skills.mindBending.rating`. Crit
 * thresholds come from the same skill (luck/fatigue-adjusted in actor.mjs).
 */

const { ApplicationV2 } = foundry.applications.api;

// Extra Mind drained when the winner crits / wins decisively.
const CRITICAL_MARGIN = 60;

// One duel window per client at a time (tracked so re-opens don't stack).
let activeDuel = null;

// Rock-Paper-Scissors gamble.
const RPS_CHOICES = ["rock", "paper", "scissors"];
const RPS_BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
const RPS_ICON = {
  rock: '<i class="fas fa-hand-rock"></i>',
  paper: '<i class="fas fa-hand-paper"></i>',
  scissors: '<i class="fas fa-hand-scissors"></i>',
};
const RPS_LABEL = { rock: "Rock", paper: "Paper", scissors: "Scissors" };

/** Stable key identifying which duel pair an RPS state belongs to. */
function rpsPairKey(aUuid, bUuid) {
  return `${aUuid}|${bUuid}`;
}

/** RPS outcome from side "a"'s choices: "a", "b", or "draw". */
function rpsWinner(choiceA, choiceB) {
  if (choiceA === choiceB) return "draw";
  return RPS_BEATS[choiceA] === choiceB ? "a" : "b";
}

/** Resolve a duel side ("a"/"b") in an RPS state to its actor. */
function rpsSideActor(state, side) {
  const uuid = side === "a" ? state.aUuid : state.bUuid;
  return fromUuidSync(uuid)?.actor ?? null;
}

/** Add `delta` Mind to an actor, clamped to [0, max]. */
async function adjustMind(actor, delta) {
  if (!actor) return;
  const mind = actor.system.stats?.mind ?? {};
  const cur = Number(mind.value) || 0;
  const max = Number(mind.max) || 0;
  const cap = max > 0 ? max : Number.MAX_SAFE_INTEGER;
  await actor.update({
    "system.stats.mind.value": Math.max(0, Math.min(cap, cur + delta)),
  });
}

/* -------------------------------------------- */
/*  Styling (injected once)                     */
/* -------------------------------------------- */

const MENTAL_DUEL_CSS = `
.redsteel-mental-duel .window-content {
  background: #141414;
  color: #d8d8d8;
  padding: 10px 12px 14px;
}
.rs-md-arena {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: start;
  gap: 10px;
}
.rs-md-side {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.rs-md-portrait {
  width: 96px;
  height: 96px;
  border-radius: 6px;
  border: 2px solid var(--rs-md-color, #8b6914);
  object-fit: cover;
  background: #000;
  box-shadow: 0 0 10px -2px var(--rs-md-color, #8b6914);
}
.rs-md-name {
  font-weight: bold;
  font-size: 14px;
  text-align: center;
  color: #f0e4b8;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-md-mind {
  font-size: 13px;
  letter-spacing: 0.5px;
}
.rs-md-mind b { color: #fff; font-size: 16px; }
.rs-md-rating { font-size: 11px; opacity: 0.7; }
.rs-md-vs {
  align-self: center;
  font-size: 18px;
  font-weight: bold;
  color: #8b6914;
  padding: 0 2px;
}
.rs-md-bar-wrap { margin: 18px 8px 12px; }
.rs-md-bar {
  position: relative;
  display: flex;
  height: 3px;
  border-radius: 2px;
  overflow: visible; /* let the neon glow spill */
}
.rs-md-bar-fill {
  height: 100%;
  transition: width 0.4s ease;
}
.rs-md-bar-fill.left { border-radius: 2px 0 0 2px; }
.rs-md-bar-fill.right { border-radius: 0 2px 2px 0; }
.rs-md-bar-mid {
  position: absolute;
  top: -3px; bottom: -3px;
  width: 1px;
  left: 50%;
  background: rgba(255,255,255,0.3);
}
.rs-md-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 10px;
}
.rs-md-attack {
  padding: 8px 6px;
  font-weight: bold;
  border-radius: 6px;
  border: 1px solid var(--rs-md-color, #8b6914);
  background: linear-gradient(#2a2620, #1c1a16);
  color: #f0e4b8;
  cursor: pointer;
}
.rs-md-attack:hover:not(:disabled) {
  background: linear-gradient(#3a342a, #221f19);
  box-shadow: 0 0 8px -2px var(--rs-md-color, #8b6914);
}
.rs-md-attack:disabled { opacity: 0.4; cursor: not-allowed; }
.rs-md-banner {
  margin-top: 12px;
  padding: 10px;
  text-align: center;
  font-size: 15px;
  font-weight: bold;
  color: #ffe9a8;
  border: 1px solid #8b6914;
  border-radius: 6px;
  background: radial-gradient(circle, #2c2410, #161208);
}
.rs-md-possess {
  display: inline-block;
  margin-top: 10px;
  padding: 7px 14px;
  font-weight: bold;
  border-radius: 6px;
  border: 1px solid #8b6914;
  background: linear-gradient(#3a2a4a, #1e1626);
  color: #f0d8ff;
  cursor: pointer;
}
.rs-md-possess:hover {
  background: linear-gradient(#4a366a, #251a30);
  box-shadow: 0 0 8px -2px #a06be0;
}
.rs-md-possess-note {
  margin-top: 8px;
  font-size: 12px;
  font-weight: normal;
  color: #d8c6ec;
  opacity: 0.9;
}
.rs-md-start-wrap {
  margin-top: 10px;
  text-align: center;
}
.rs-md-start-duel {
  padding: 9px 18px;
  font-weight: bold;
  font-size: 14px;
  border-radius: 6px;
  border: 1px solid #8b6914;
  background: linear-gradient(#3a3320, #221d10);
  color: #ffe9a8;
  cursor: pointer;
}
.rs-md-start-duel:hover {
  background: linear-gradient(#4a4029, #2a2416);
  box-shadow: 0 0 8px -2px #c9a94b;
}
.rs-md-start-note {
  margin-top: 6px;
  font-size: 12px;
  color: #c9b26b;
  opacity: 0.9;
}
.rs-md-rps {
  margin-top: 12px;
  padding: 8px 10px;
  border: 1px dashed #6b5a2c;
  border-radius: 6px;
  background: #17150f;
}
.rs-md-rps-title {
  text-align: center;
  font-size: 12px;
  color: #c9b26b;
  margin-bottom: 6px;
}
.rs-md-rps-note {
  text-align: center;
  font-size: 12px;
  opacity: 0.85;
  padding: 2px 0;
}
.rs-md-rps-coin {
  width: 100%;
  padding: 7px;
  font-weight: bold;
  border-radius: 6px;
  border: 1px solid #8b6914;
  background: linear-gradient(#2a2620, #1c1a16);
  color: #f0e4b8;
  cursor: pointer;
}
.rs-md-rps-coin:hover { background: linear-gradient(#3a342a, #221f19); }
.rs-md-rps-offer { text-align: center; font-size: 13px; }
.rs-md-rps-buttons {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 6px;
}
.rs-md-rps-accept, .rs-md-rps-decline {
  padding: 5px 12px;
  border-radius: 5px;
  cursor: pointer;
  font-weight: bold;
  border: 1px solid #555;
  color: #f0e4b8;
}
.rs-md-rps-accept { border-color: #3b7a3b; background: #1c2a1c; }
.rs-md-rps-decline { border-color: #9e3030; background: #2a1c1c; }
.rs-md-rps-accept:disabled { opacity: 0.4; cursor: not-allowed; }
.rs-md-rps-arena {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.rs-md-rps-pick {
  text-align: center;
  padding: 6px;
  border: 1px solid var(--rs-md-color, #444);
  border-radius: 6px;
  background: #0e0d0a;
}
.rs-md-rps-pick.committed { opacity: 0.9; }
.rs-md-rps-pick-name { font-size: 12px; color: #d8d8d8; margin-bottom: 4px; }
.rs-md-rps-pick-state { font-size: 16px; color: #f0e4b8; }
.rs-md-rps-choices { display: flex; justify-content: center; gap: 6px; }
.rs-md-rps-choose {
  width: 38px; height: 38px;
  font-size: 18px;
  border-radius: 6px;
  border: 1px solid #8b6914;
  background: #211e18;
  color: #f0e4b8;
  cursor: pointer;
}
.rs-md-rps-choose:hover { background: #322d22; box-shadow: 0 0 6px -1px #8b6914; }
.rs-md-rps-result {
  text-align: center;
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #3a3528;
}
.rs-md-footer {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.rs-md-end {
  font-size: 12px;
  padding: 4px 10px;
  background: #2a2a2a;
  color: #c8c2a1;
  border: 1px solid #444;
  border-radius: 4px;
  cursor: pointer;
}
.rs-md-end:hover:not(:disabled) { background: #3a3a3a; }
.rs-md-end:disabled { opacity: 0.4; cursor: not-allowed; }
`;

function injectMentalDuelCSS() {
  if (document.getElementById("redsteel-mental-duel-css")) return;
  const style = document.createElement("style");
  style.id = "redsteel-mental-duel-css";
  style.textContent = MENTAL_DUEL_CSS;
  document.head.appendChild(style);
}

/* -------------------------------------------- */
/*  Helpers                                      */
/* -------------------------------------------- */

/**
 * Colour used to identify a token's owner. Prefers an owning player's user
 * colour, then the token's disposition tint, then a neutral gold.
 */
function getOwnerColor(token) {
  const actor = token.actor;
  const owner = game.users.find(
    (u) => !u.isGM && actor?.testUserPermission(u, "OWNER"),
  );
  if (owner?.color) return String(owner.color);

  const disposition = token.document?.disposition;
  if (disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY) return "#3b7a3b";
  if (disposition === CONST.TOKEN_DISPOSITIONS.HOSTILE) return "#9e3030";
  return "#8b6914";
}

/** Snapshot the live duel-relevant data for one side. */
function buildSide(token) {
  const actor = token.actor;
  const skill = actor.system.skills?.mindBending ?? {};
  const mind = actor.system.stats?.mind ?? { value: 0, max: 0 };
  return {
    token,
    tokenDoc: token.document,
    actor,
    actorUuid: actor.uuid,
    name: token.document.name ?? actor.name,
    // Prefer the (linked) actor's portrait over the token artwork.
    img: actor.img ?? token.document.texture?.src,
    color: getOwnerColor(token),
    mindValue: Math.max(0, Number(mind.value) || 0),
    mindMax: Math.max(0, Number(mind.max) || 0),
    rating: Number(skill.rating) || 0,
    critSuccess: Number(skill.criticalSuccessThreshold) || 5,
    critFailure: Number(skill.criticalFailureThreshold) || 96,
  };
}

/** Roll one side's Mental Duel test: rating − 1d100. */
async function rollSide(side) {
  const roll = new Roll("@rating - 1d100", { rating: side.rating });
  await roll.evaluate();
  const raw = roll.dice[0].total;
  return {
    roll,
    raw,
    margin: roll.total,
    critSuccess: raw <= side.critSuccess,
    critFailure: raw >= side.critFailure,
  };
}

/**
 * Resolve a versus test from the attacker's (invoker's) perspective. Critical
 * interaction mirrors Combat: a Critical success outranks a normal result, a
 * Critical failure is outranked by any non-crit-failure, ties go to the
 * attacker, and otherwise the higher margin wins.
 * @returns {{attackerWins: boolean, critical: boolean}}
 */
function resolveVersus(att, def) {
  const tier = (r) => (r.critSuccess ? 2 : r.critFailure ? 0 : 1);
  const at = tier(att);
  const dt = tier(def);

  const attackerWins = at !== dt ? at > dt : att.margin >= def.margin;

  // Decisive win → drains an extra Mind point.
  const critical =
    attackerWins &&
    (att.critSuccess || def.critFailure || att.margin - def.margin >= CRITICAL_MARGIN);

  return { attackerWins, critical };
}

/**
 * Reduce an actor's Mind by `amount`. Done directly when the current user can
 * edit the actor, otherwise routed to the GM over the system socket.
 */
async function applyMindLoss(actorUuid, amount) {
  if (amount <= 0) return;
  const actor = fromUuidSync(actorUuid);
  if (actor?.isOwner) {
    const cur = Number(actor.system.stats?.mind?.value) || 0;
    await actor.update({ "system.stats.mind.value": Math.max(0, cur - amount) });
  } else {
    game.socket.emit(SOCKET, { type: "mentalDuelApply", actorUuid, amount });
  }
}

/** GM-side handler for socket-routed Mind loss (wired in redsteel.mjs). */
export async function applyMentalDuelLossAsGM(data) {
  const actor = await fromUuid(data.actorUuid);
  if (!actor) return;
  const cur = Number(actor.system.stats?.mind?.value) || 0;
  await actor.update({
    "system.stats.mind.value": Math.max(0, cur - data.amount),
  });
}

/* -------------------------------------------- */
/*  The duel window                             */
/* -------------------------------------------- */

export class MentalDuelApp extends ApplicationV2 {
  constructor(attackerToken, defenderToken, options = {}) {
    super(options);
    this._aUuid = attackerToken.document.uuid;
    this._bUuid = defenderToken.document.uuid;
    this._hookIds = {};
  }

  static DEFAULT_OPTIONS = {
    id: "redsteel-mental-duel",
    classes: ["redsteel", "redsteel-mental-duel"],
    window: {
      title: "Mentální souboj — Mind Bending",
      icon: "fas fa-brain",
      resizable: false,
    },
    position: { width: 440, height: "auto" },
  };

  /** Resolve a stored token uuid to a live placeable token. */
  _token(uuid) {
    const doc = fromUuidSync(uuid);
    return doc?.object ?? canvas.tokens.get(doc?.id);
  }

  /* ---- ApplicationV2 render plumbing ---- */

  async _renderHTML() {
    const aTok = this._token(this._aUuid);
    const bTok = this._token(this._bUuid);
    if (!aTok?.actor || !bTok?.actor) {
      return `<div class="rs-md-banner">A combatant token is no longer on the scene.</div>
        <div class="rs-md-footer"><button type="button" class="rs-md-end rs-md-close">Close</button></div>`;
    }
    return this._buildHTML(buildSide(aTok), buildSide(bTok));
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    this._activateListeners(content);
  }

  _buildHTML(a, b) {
    const total = a.mindValue + b.mindValue;
    const aPct = total > 0 ? (a.mindValue / total) * 100 : 50;
    const bPct = 100 - aPct;

    const ended = a.mindValue <= 0 || b.mindValue <= 0;
    // The GM must officially start the Mind Bending before either side may
    // attack. Until then the arena shows but the attack buttons stay locked.
    const started = this._isStarted();
    let banner = "";
    if (ended) {
      const winner = a.mindValue > 0 ? a : b.mindValue > 0 ? b : null;
      const loser = winner === a ? b : a;
      if (!winner) {
        banner = `<div class="rs-md-banner">Both minds collapse — a draw.</div>`;
      } else {
        const possessed = !!loser.actor.getFlag("redsteel", "possession");
        let action = "";
        if (possessed) {
          action = `<div class="rs-md-possess-note">
            <i class="fas fa-hand-sparkles"></i> ${loser.name} is possessed by ${winner.name}.
            Remove the “Possessed” token status to release them.</div>`;
        } else if (game.user.isGM) {
          // Seizing control is a GM-only action, and only for a winner who can
          // Dominate (any NPC, or a PC with the Domination perk).
          action = canDominate(winner.actor)
            ? `<button type="button" class="rs-md-possess"
                data-winner-uuid="${winner.tokenDoc.uuid}"
                data-loser-uuid="${loser.tokenDoc.uuid}">
                <i class="fas fa-hand-sparkles"></i> Seize control</button>`
            : `<div class="rs-md-possess-note">
                ${winner.name} lacks the Domination perk and cannot seize control.</div>`;
        }
        banner = `<div class="rs-md-banner"><i class="fas fa-crown"></i>
             ${winner.name} breaks ${loser.name}'s will.
             ${action}</div>`;
      }
    }

    const sideHtml = (s) => `
      <div class="rs-md-side" style="--rs-md-color:${s.color}">
        <img class="rs-md-portrait" src="${s.img}" alt="${s.name}">
        <div class="rs-md-name" title="${s.name}">${s.name}</div>
        <div class="rs-md-mind">Mind <b>${s.mindValue}</b> / ${s.mindMax}</div>
        <div class="rs-md-rating">Duel ${s.rating >= 0 ? "+" : ""}${s.rating}%</div>
      </div>`;

    const attackBtn = (s, role) => {
      const canControl = s.actor.isOwner || game.user.isGM;
      const ready = this._canAttack(s);
      const disabled = ended || !started || !canControl || !ready;
      const reason = !canControl
        ? "You don't control this combatant"
        : ended
          ? "The duel is over"
          : !started
            ? "The GM has not started the Mind Bending yet"
            : !ready
              ? "Already attacked this round"
              : "Spend a Free Action to attack";
      return `<button type="button" class="rs-md-attack" data-role="${role}"
        ${disabled ? "disabled" : ""} title="${reason}"
        style="--rs-md-color:${s.color}">
        <i class="fas fa-bolt"></i> ${s.name} attacks
      </button>`;
    };

    return `
      <div class="rs-md-arena">
        ${sideHtml(a)}
        <div class="rs-md-vs">VS</div>
        ${sideHtml(b)}
      </div>

      <div class="rs-md-bar-wrap">
        <div class="rs-md-bar">
          <div class="rs-md-bar-fill left" style="width:${aPct}%;background:${a.color};box-shadow:0 0 8px ${a.color},0 0 4px ${a.color}"></div>
          <div class="rs-md-bar-fill right" style="width:${bPct}%;background:${b.color};box-shadow:0 0 8px ${b.color},0 0 4px ${b.color}"></div>
          <div class="rs-md-bar-mid"></div>
        </div>
      </div>

      ${!ended && !started ? this._buildStartHTML() : ""}

      <div class="rs-md-actions">
        ${attackBtn(a, "a")}
        ${attackBtn(b, "b")}
      </div>

      ${ended || !started ? "" : this._buildRpsHTML(a, b)}

      ${banner}

      <div class="rs-md-footer">
        <button type="button" class="rs-md-end rs-md-end-duel"
          ${game.user.isGM ? "" : "disabled"}
          title="${
            game.user.isGM
              ? "End the duel for everyone"
              : "You do not posses the power to end the duel prematurely"
          }">End duel</button>
      </div>`;
  }

  /**
   * True once the GM has officially started this duel. The marker lives on the
   * anchor (attacker) token as the pair key, so a stale flag from a previous
   * pairing never counts as started for a different duel.
   */
  _isStarted() {
    const anchor = this._token(this._aUuid)?.document;
    return (
      anchor?.getFlag("redsteel", "mdStarted") ===
      rpsPairKey(this._aUuid, this._bUuid)
    );
  }

  /** Pre-start panel: a GM start button, or a waiting note for players. */
  _buildStartHTML() {
    if (game.user.isGM) {
      return `<div class="rs-md-start-wrap">
        <button type="button" class="rs-md-start-duel">
          <i class="fas fa-play"></i> Start Mind Bending
        </button>
        <div class="rs-md-start-note">Neither side can attack until you start.</div>
      </div>`;
    }
    return `<div class="rs-md-start-wrap">
      <div class="rs-md-start-note"><i class="fas fa-hourglass-half"></i>
        Waiting for the GM to start the Mind Bending…</div>
    </div>`;
  }

  /** GM-only: mark the duel started (unlocks attacks + kicks off the coin toss). */
  async _onStartDuel() {
    if (!game.user.isGM) return;
    const anchor = this._token(this._aUuid)?.document;
    if (!anchor) return;
    await anchor.setFlag(
      "redsteel",
      "mdStarted",
      rpsPairKey(this._aUuid, this._bUuid),
    );
    // Now that the duel is live, roll the opening coin toss.
    this._maybeAutoCoinToss();
  }

  /** Reads + validates the RPS state stored on the anchor (attacker) token. */
  _rpsState() {
    const anchor = this._token(this._aUuid)?.document;
    const state = anchor?.getFlag("redsteel", "mdRps") ?? null;
    if (!state) return null;
    return state.pairKey === rpsPairKey(this._aUuid, this._bUuid) ? state : null;
  }

  _buildRpsHTML(a, b) {
    const sides = { a, b };
    const rps = this._rpsState();

    // No state yet → the GM auto-rolls the coin toss on open / each new round.
    if (!rps) {
      return `<div class="rs-md-rps"><div class="rs-md-rps-note">
        <i class="fas fa-coins"></i> Coin toss pending…
      </div></div>`;
    }

    // Used / unavailable this round → show the outcome; replenishes next round.
    if (["resolved", "declined", "skipped"].includes(rps.phase)) {
      let summary;
      if (rps.phase === "resolved") summary = this._rpsResultSummary(sides, rps);
      else if (rps.phase === "declined")
        summary = `<div class="rs-md-rps-note">${sides[rps.initiator].name} declined the gamble.</div>`;
      else
        summary = `<div class="rs-md-rps-note">Coin toss decided ${sides[rps.initiator].name}, but they cannot afford the stake.</div>`;
      return `<div class="rs-md-rps">${summary}
        <div class="rs-md-rps-note" style="opacity:.7;">The gamble replenishes next round.</div>
      </div>`;
    }

    const initiator = sides[rps.initiator];
    const initControls = initiator.actor.isOwner || game.user.isGM;

    // Offer → the chosen side accepts or declines. Staking your last point
    // would drop you to 0 (a loss), so accepting needs more than 1 Mind.
    if (rps.phase === "offer") {
      const tooLow = initiator.mindValue <= 1;
      const body = initControls
        ? `<div class="rs-md-rps-offer">
             <span>You were chosen — accept the gamble?</span>
             <div class="rs-md-rps-buttons">
               <button type="button" class="rs-md-rps-accept" ${tooLow ? "disabled" : ""}
                 title="${tooLow ? "You need more than 1 Mind to stake the gamble" : "Accept and pay 1 Mind — losing costs a second point"}">Accept (pay 1 Mind)</button>
               <button type="button" class="rs-md-rps-decline">Decline</button>
             </div>
           </div>`
        : `<div class="rs-md-rps-note">Waiting for <b>${initiator.name}</b> to decide…</div>`;
      return `<div class="rs-md-rps">
        <div class="rs-md-rps-title"><i class="fas fa-coins"></i> Coin toss chose <b>${initiator.name}</b></div>
        ${body}
      </div>`;
    }

    // Playing → both sides commit a choice (hidden until both are in).
    if (rps.phase === "playing") {
      const pick = (key) => {
        const s = sides[key];
        const mine = s.actor.isOwner || game.user.isGM;
        const committed = !!rps.choices[key];
        if (committed) {
          const reveal = mine
            ? `${RPS_ICON[rps.choices[key]]} committed`
            : "committed";
          return `<div class="rs-md-rps-pick committed" style="--rs-md-color:${s.color}">
            <div class="rs-md-rps-pick-name">${s.name}</div>
            <div class="rs-md-rps-pick-state">${reveal}</div>
          </div>`;
        }
        if (mine) {
          return `<div class="rs-md-rps-pick" style="--rs-md-color:${s.color}">
            <div class="rs-md-rps-pick-name">${s.name} — choose:</div>
            <div class="rs-md-rps-choices">
              ${RPS_CHOICES.map(
                (c) =>
                  `<button type="button" class="rs-md-rps-choose" data-side="${key}" data-choice="${c}" title="${RPS_LABEL[c]}">${RPS_ICON[c]}</button>`,
              ).join("")}
            </div>
          </div>`;
        }
        return `<div class="rs-md-rps-pick" style="--rs-md-color:${s.color}">
          <div class="rs-md-rps-pick-name">${s.name}</div>
          <div class="rs-md-rps-pick-state">choosing…</div>
        </div>`;
      };
      return `<div class="rs-md-rps">
        <div class="rs-md-rps-title"><b>${initiator.name}</b> staked 1 Mind (2 lost if they lose) — pick once, you can't change it</div>
        <div class="rs-md-rps-arena">${pick("a")}${pick("b")}</div>
      </div>`;
    }

    return "";
  }

  _rpsResultSummary(sides, rps) {
    const { winner } = rps.result;
    const a = sides.a;
    const b = sides.b;
    const picks = `${a.name} ${RPS_ICON[rps.choices.a]} &nbsp;vs&nbsp; ${RPS_ICON[rps.choices.b]} ${b.name}`;

    let verdict;
    if (winner === "draw") {
      verdict = "Draw — no Mind lost. The staked Mind is forfeit.";
    } else {
      const w = sides[winner];
      const l = sides[winner === "a" ? "b" : "a"];
      verdict =
        winner === rps.initiator
          ? `${w.name} wins — regains the staked Mind; ${l.name} loses 1 Mind.`
          : `${w.name} wins — ${l.name} (initiator) loses 2 Mind: the stake and the loss.`;
    }
    return `<div class="rs-md-rps-result"><div>${picks}</div><div><b>${verdict}</b></div></div>`;
  }

  _activateListeners(content) {
    content.querySelectorAll(".rs-md-attack").forEach((btn) =>
      btn.addEventListener("click", (ev) => {
        const role = ev.currentTarget.dataset.role;
        this._onAttack(role);
      }),
    );
    content
      .querySelector(".rs-md-start-duel")
      ?.addEventListener("click", () => this._onStartDuel());
    content
      .querySelector(".rs-md-end-duel")
      ?.addEventListener("click", () => this._onEndDuel());
    content
      .querySelector(".rs-md-close")
      ?.addEventListener("click", () => this.close());

    // Seize control: the winner (or GM) claims ownership of the broken mind.
    content.querySelector(".rs-md-possess")?.addEventListener("click", (ev) => {
      const { winnerUuid, loserUuid } = ev.currentTarget.dataset;
      requestPossession(loserUuid, winnerUuid);
    });

    // --- RPS gamble controls (coin toss auto-rolls; no manual trigger) ---
    const anchorUuid = this._aUuid;
    content
      .querySelector(".rs-md-rps-accept")
      ?.addEventListener("click", () =>
        dispatchRps(anchorUuid, { kind: "accept" }),
      );
    content
      .querySelector(".rs-md-rps-decline")
      ?.addEventListener("click", () =>
        dispatchRps(anchorUuid, { kind: "decline" }),
      );
    content.querySelectorAll(".rs-md-rps-choose").forEach((btn) =>
      btn.addEventListener("click", (ev) => {
        const { side, choice } = ev.currentTarget.dataset;
        dispatchRps(anchorUuid, { kind: "choose", side, choice });
      }),
    );
  }

  /** GM-only: terminate the duel for everyone (broadcast + local close). */
  _onEndDuel() {
    if (!game.user.isGM) return; // button is disabled for players; guard anyway
    // Clear any lingering RPS gamble + started state on the anchor token.
    const anchorDoc = this._token(this._aUuid)?.document;
    anchorDoc?.unsetFlag("redsteel", "mdRps");
    anchorDoc?.unsetFlag("redsteel", "mdStarted");
    // Clear the persisted "active duel" marker so it won't resume.
    game.settings.set("redsteel", "mentalDuelActive", null);
    game.socket.emit(SOCKET, { type: "closeMentalDuel" });
    this.close();
  }

  /* ---- Per-round availability ---- */

  /** One invocation per round, refreshed each new round (i.e. each turn). */
  _canAttack(side) {
    const combat = game.combat;
    if (!combat) return true;
    return side.tokenDoc.getFlag("redsteel", "mentalDuelLastRound") !== combat.round;
  }

  async _consumeAttack(side) {
    const combat = game.combat;
    if (!combat) return;
    if (side.tokenDoc.isOwner || game.user.isGM) {
      await side.tokenDoc.setFlag("redsteel", "mentalDuelLastRound", combat.round);
    }
  }

  /* ---- Attack resolution ---- */

  async _onAttack(role) {
    const aTok = this._token(this._aUuid);
    const bTok = this._token(this._bUuid);
    if (!aTok?.actor || !bTok?.actor) return this.render();

    const attacker = buildSide(role === "a" ? aTok : bTok);
    const defender = buildSide(role === "a" ? bTok : aTok);

    // "Ochrana mysli" (Mind ward) — +20 % to Mind Bending, but only when
    // defending. Applied here rather than as an Active Effect change on
    // system.skills.mindBending.bonus, which would also boost the warded
    // actor's own attacks.
    if (defender.actor.statuses?.has("mind_ward")) defender.rating += 20;

    if (!this._canAttack(attacker)) {
      ui.notifications.warn(`${attacker.name} has already attacked this round.`);
      return;
    }
    if (!(attacker.actor.isOwner || game.user.isGM)) {
      ui.notifications.warn(`You don't control ${attacker.name}.`);
      return;
    }

    const attRoll = await rollSide(attacker);
    const defRoll = await rollSide(defender);
    const { attackerWins, critical } = resolveVersus(attRoll, defRoll);

    const drain = attackerWins ? (critical ? 2 : 1) : 0;
    await this._consumeAttack(attacker);
    if (drain > 0) await applyMindLoss(defender.actorUuid, drain);

    await this._postResult(attacker, defender, attRoll, defRoll, {
      attackerWins,
      critical,
      drain,
    });

    // updateActor/updateToken hooks re-render, but render now for snappiness.
    this.render();
  }

  async _postResult(attacker, defender, attRoll, defRoll, outcome) {
    const { attackerWins, critical, drain } = outcome;
    const label = (s, r) =>
      `${s.name}: <b>${r.margin}</b>` +
      (r.critSuccess ? " ⚡crit" : r.critFailure ? " ✖fumble" : "");

    const verdict = attackerWins
      ? `${attacker.name} prevails — ${defender.name} loses <b>${drain}</b> Mind${critical ? " (decisive!)" : ""}.`
      : `${attacker.name} fails to break through.`;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker.actor }),
      flavor: `<b>Mentální souboj</b> — ${attacker.name} vs ${defender.name}`,
      rolls: [attRoll.roll, defRoll.roll],
      content: `
        <div style="font-size:13px;line-height:1.5;">
          <div>${label(attacker, attRoll)}</div>
          <div>${label(defender, defRoll)}</div>
          <hr>
          <div style="text-align:center;">${verdict}</div>
        </div>`,
    });
  }

  /* ---- Lifecycle: live updates ---- */

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const rerender = () => {
      if (this.rendered) this.render();
    };
    this._hookIds.updateActor = Hooks.on("updateActor", rerender);
    this._hookIds.updateToken = Hooks.on("updateToken", rerender);
    this._hookIds.updateCombat = Hooks.on("updateCombat", (combat, changed) => {
      rerender();
      // A new round replenishes the coin toss with a fresh gamble.
      if ("round" in changed) this._maybeAutoCoinToss();
    });
    this._hookIds.deleteCombat = Hooks.on("deleteCombat", rerender);

    // Roll the opening coin toss immediately (no manual initiation).
    this._maybeAutoCoinToss();
  }

  /**
   * Active-GM only: ensure a fresh RPS coin toss exists for the current round.
   * Idempotent — does nothing if this round already has one (the stored
   * `round` matches), so renders/hook spam can't re-roll mid-round.
   */
  _maybeAutoCoinToss() {
    if (game.user.id !== game.users.activeGM?.id) return;
    // The gamble does not begin until the GM has started the duel.
    if (!this._isStarted()) return;
    const round = game.combat?.round ?? 0;
    const state = this._rpsState();
    if (state?.round === round) return;
    if (this._tossingRound === round) return; // in-flight guard
    this._tossingRound = round;
    dispatchRps(this._aUuid, { kind: "coinToss", bUuid: this._bUuid, round });
  }

  /** True once either side has been reduced to 0 Mind. */
  _isEnded() {
    const a = this._token(this._aUuid)?.actor;
    const b = this._token(this._bUuid)?.actor;
    if (!a || !b) return false;
    return (
      (Number(a.system.stats?.mind?.value) || 0) <= 0 ||
      (Number(b.system.stats?.mind?.value) || 0) <= 0
    );
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    // When a side hits 0 Mind the duel is decided — the active-GM clears the
    // persisted marker so a reload won't auto-resume a finished duel. The
    // window stays open (showing the result) until someone closes it.
    if (game.user.id !== game.users.activeGM?.id) return;
    if (!this._isEnded()) return;
    if (game.settings.get("redsteel", "mentalDuelActive")) {
      game.settings.set("redsteel", "mentalDuelActive", null);
    }
  }

  _onClose(options) {
    super._onClose?.(options);
    Hooks.off("updateActor", this._hookIds.updateActor);
    Hooks.off("updateToken", this._hookIds.updateToken);
    Hooks.off("updateCombat", this._hookIds.updateCombat);
    Hooks.off("deleteCombat", this._hookIds.deleteCombat);
    if (activeDuel === this) activeDuel = null;
  }
}

/* -------------------------------------------- */
/*  Launcher                                     */
/* -------------------------------------------- */

/**
 * Open the Mental Duel window between two tokens. With no arguments it uses the
 * controlled token as attacker and the current target (or a second controlled
 * token) as defender.
 *
 * By default the open is broadcast over the system socket so the window also
 * appears for the target's (and attacker's) owners and the GM. Set
 * `broadcast: false` to open only locally (used by the socket receiver).
 * @param {Token|TokenDocument} [attacker]
 * @param {Token|TokenDocument} [defender]
 * @param {{broadcast?: boolean}} [options]
 */
export async function openMentalDuel(attacker, defender, { broadcast = true } = {}) {
  injectMentalDuelCSS();

  const asToken = (t) => (t?.object ? t.object : t); // accept Token or TokenDocument

  let aTok = asToken(attacker);
  let bTok = asToken(defender);

  if (!aTok) aTok = canvas.tokens.controlled[0];
  if (!bTok) {
    bTok =
      asToken([...(game.user.targets ?? [])][0]) ??
      canvas.tokens.controlled.find((t) => t !== aTok);
  }

  if (!aTok || !bTok) {
    ui.notifications.warn(
      "Select your token and target an opponent (or select both tokens) to start a Mental Duel.",
    );
    return null;
  }
  if (aTok === bTok) {
    ui.notifications.warn("A combatant cannot duel themselves.");
    return null;
  }

  // Tell other clients to open it too — each decides if it's relevant to them.
  if (broadcast) {
    game.socket.emit(SOCKET, {
      type: "openMentalDuel",
      attackerUuid: aTok.document.uuid,
      defenderUuid: bTok.document.uuid,
    });
  }

  // Persist which duel is active so it survives a refresh / accidental close
  // (see resumeMentalDuel). Only the authority writes the world setting.
  if (game.user.id === game.users.activeGM?.id) {
    const next = {
      attackerUuid: aTok.document.uuid,
      defenderUuid: bTok.document.uuid,
    };
    const cur = game.settings.get("redsteel", "mentalDuelActive");
    if (
      cur?.attackerUuid !== next.attackerUuid ||
      cur?.defenderUuid !== next.defenderUuid
    ) {
      await game.settings.set("redsteel", "mentalDuelActive", next);
    }
  }

  if (activeDuel?.rendered) await activeDuel.close();
  const app = new MentalDuelApp(aTok, bTok);
  activeDuel = app;
  await app.render(true);
  return app;
}

/**
 * Socket receiver: open the duel window for this client when it is a
 * participant's owner or the GM (so the GM can always watch). Non-participants
 * ignore it. Never re-broadcasts.
 *
 * If the viewer is on a different scene than the combatants', it pulls them to
 * the duel's scene first so the token placeables (and the window) can resolve.
 * @param {{attackerUuid: string, defenderUuid: string}} data
 */
export async function handleRemoteMentalDuel(data) {
  const aDoc = fromUuidSync(data.attackerUuid);
  const bDoc = fromUuidSync(data.defenderUuid);
  if (!aDoc?.actor || !bDoc?.actor) return;

  const shouldOpen =
    game.user.isGM || aDoc.actor.isOwner || bDoc.actor.isOwner;
  if (!shouldOpen) return;

  // Pull the viewer onto the duel's scene if they're looking elsewhere.
  const scene = aDoc.parent ?? bDoc.parent;
  if (scene && canvas.scene?.id !== scene.id) {
    await scene.view();
  }

  const aTok = aDoc.object;
  const bTok = bDoc.object;
  if (!aTok || !bTok) return;

  openMentalDuel(aTok, bTok, { broadcast: false });
}

/**
 * Re-open the currently active Mental Duel (after a browser refresh or an
 * accidental close). Reads the persisted world setting and reuses the remote
 * open path so the same owner/GM permission and scene-pull logic applies.
 * @param {{notify?: boolean}} [options] - notify when no duel is in progress.
 */
export async function resumeMentalDuel({ notify = true } = {}) {
  const active = game.settings.get("redsteel", "mentalDuelActive");
  if (!active?.attackerUuid || !active?.defenderUuid) {
    if (notify) ui.notifications.info("There is no Mental Duel in progress.");
    return;
  }
  await handleRemoteMentalDuel(active);
}

/**
 * Socket receiver: close this client's duel window. Triggered when a GM ends
 * the duel, so it terminates for everyone.
 */
export function closeMentalDuel() {
  if (activeDuel?.rendered) activeDuel.close();
}

/* -------------------------------------------- */
/*  Rock-Paper-Scissors gamble (GM-authoritative) */
/* -------------------------------------------- */

/**
 * Route an RPS action to the single authority (the active GM), who mutates the
 * canonical state stored on the anchor (attacker) token. All clients re-render
 * off the resulting token-flag update.
 * @param {string} anchorUuid - The attacker token's uuid (state lives here).
 * @param {object} action - { kind, ... }
 */
async function dispatchRps(anchorUuid, action) {
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn("A GM must be connected to run the RPS gamble.");
    return;
  }
  const data = { anchorUuid, action };
  if (game.user.id === gm.id) await applyRpsAction(data);
  else game.socket.emit(SOCKET, { type: "mentalDuelRps", ...data });
}

/**
 * Socket entry point for RPS — only the active GM applies it (single
 * authority), so concurrent clients can't double-resolve.
 */
export async function handleMentalDuelRps(data) {
  if (game.user.id !== game.users.activeGM?.id) return;
  await applyRpsAction(data);
}

/**
 * Authoritative RPS state machine. Runs on the active GM. Mutates the anchor
 * token's `flags.redsteel.mdRps` and applies Mind changes on resolution.
 */
async function applyRpsAction({ anchorUuid, action }) {
  const anchor = fromUuidSync(anchorUuid);
  if (!anchor) return;

  const get = () => anchor.getFlag("redsteel", "mdRps") ?? null;
  const set = (s) => anchor.setFlag("redsteel", "mdRps", s);
  const clear = () => anchor.unsetFlag("redsteel", "mdRps");

  let state = get();

  switch (action.kind) {
    case "coinToss": {
      // Randomly choose which side is offered the gamble.
      const initiator = Math.random() < 0.5 ? "a" : "b";
      state = {
        pairKey: rpsPairKey(anchorUuid, action.bUuid),
        aUuid: anchorUuid,
        bUuid: action.bUuid,
        round: action.round ?? (game.combat?.round ?? 0),
        initiator,
        phase: "offer",
        staked: false,
        choices: { a: null, b: null },
        result: null,
      };
      // Staking costs 1 Mind, and dropping to 0 loses the duel — a side with
      // only 1 Mind can't afford it, so the gamble is skipped this round.
      const initActor = rpsSideActor(state, initiator);
      const canAfford =
        (Number(initActor?.system.stats?.mind?.value) || 0) > 1;
      if (!canAfford) state.phase = "skipped";

      await set(state);

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: initActor }),
        content: canAfford
          ? `<p style="text-align:center;"><i class="fas fa-coins"></i> Coin toss: <b>${initActor?.name ?? "A combatant"}</b> is offered a Rock-Paper-Scissors gamble.</p>`
          : `<p style="text-align:center;"><i class="fas fa-coins"></i> Coin toss decided <b>${initActor?.name ?? "a combatant"}</b>, but they cannot afford the stake.</p>`,
      });
      return;
    }

    case "decline": {
      if (!state || state.phase !== "offer") return;
      await set({ ...state, phase: "declined" });
      return;
    }

    case "reset": {
      await clear();
      return;
    }

    case "accept": {
      if (!state || state.phase !== "offer") return;
      const initActor = rpsSideActor(state, state.initiator);
      if (!initActor) return;
      if ((Number(initActor.system.stats?.mind?.value) || 0) <= 1) {
        ui.notifications.warn(
          `${initActor.name} needs more than 1 Mind to stake on the gamble.`,
        );
        return;
      }
      await adjustMind(initActor, -1); // pay the stake up front
      await set({ ...state, phase: "playing", staked: true });
      return;
    }

    case "choose": {
      if (!state || state.phase !== "playing") return;
      if (!["a", "b"].includes(action.side)) return;
      if (!RPS_CHOICES.includes(action.choice)) return;
      if (state.choices[action.side]) return; // already committed — locked

      const choices = { ...state.choices, [action.side]: action.choice };
      state = { ...state, choices };

      if (choices.a && choices.b) state = await resolveRps(state);
      await set(state);
      return;
    }
  }
}

/**
 * Resolve a completed RPS round and apply the stake economics:
 *   • Initiator wins → regains the staked Mind, opponent loses 1.
 *   • Initiator loses → forfeits the stake and loses 1 more (2 Mind total).
 *   • Draw → no extra loss, but the stake is not refunded.
 * @returns {object} the resolved state (phase "resolved", with result).
 */
async function resolveRps(state) {
  const winner = rpsWinner(state.choices.a, state.choices.b);
  const initiator = state.initiator;
  const opponent = initiator === "a" ? "b" : "a";

  let refund = 0;
  let drain = 0;
  let penalty = 0;
  if (winner === initiator) {
    refund = 1;
    drain = 1;
    await adjustMind(rpsSideActor(state, initiator), +1); // refund stake
    await adjustMind(rpsSideActor(state, opponent), -1); // opponent loses
  } else if (winner === opponent) {
    // Losing the gamble costs a second point on top of the forfeit stake.
    penalty = 1;
    await adjustMind(rpsSideActor(state, initiator), -1);
  }

  const resolved = {
    ...state,
    phase: "resolved",
    result: { winner, refund, drain, penalty },
  };

  const aName = rpsSideActor(state, "a")?.name ?? "A";
  const bName = rpsSideActor(state, "b")?.name ?? "B";
  let verdict;
  if (winner === "draw") verdict = "Draw — the staked Mind is forfeit.";
  else {
    const wName = winner === "a" ? aName : bName;
    const lName = winner === "a" ? bName : aName;
    verdict =
      winner === initiator
        ? `${wName} wins the gamble — regains the stake; ${lName} loses 1 Mind.`
        : `${wName} wins the gamble — ${lName} (initiator) loses 2 Mind: the staked point and the loss.`;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: rpsSideActor(state, initiator) }),
    content: `
      <p style="text-align:center;">
        ${aName} ${RPS_ICON[state.choices.a]} vs ${RPS_ICON[state.choices.b]} ${bName}
      </p>
      <p style="text-align:center;"><b>${verdict}</b></p>`,
  });

  return resolved;
}

/* -------------------------------------------- */
/*  Voluntary acceptance (asked of the target)  */
/* -------------------------------------------- */

/**
 * Choose who is asked to voluntarily accept a duel: an active player owner of
 * the defender, otherwise the active GM.
 * @returns {string|null} a user id, or null if nobody is available.
 */
function pickVoluntaryResponder(defenderActor) {
  const owner = game.users.find(
    (u) => u.active && !u.isGM && defenderActor.testUserPermission(u, "OWNER"),
  );
  if (owner) return owner.id;
  return game.users.activeGM?.id ?? null;
}

/**
 * The 35% initiation failed — ask the TARGET's owner whether they voluntarily
 * accept the Mental Duel. Resolves on the responder's client (locally if that
 * is the current user, otherwise over the socket).
 * @param {Token|TokenDocument} attacker
 * @param {Token|TokenDocument} defender
 * @param {{chance?: number, roll?: number}} [info]
 */
export function requestVoluntaryMentalDuel(attacker, defender, info = {}) {
  const aDoc = attacker?.document ?? attacker;
  const bDoc = defender?.document ?? defender;
  const defenderActor = bDoc?.actor;
  if (!aDoc?.uuid || !bDoc?.uuid || !defenderActor) return;

  const responderId = pickVoluntaryResponder(defenderActor);
  if (!responderId) {
    ui.notifications.warn(
      "No active player or GM can accept the Mental Duel for the target.",
    );
    return;
  }

  const payload = {
    type: "mentalDuelVoluntary",
    attackerUuid: aDoc.uuid,
    defenderUuid: bDoc.uuid,
    responderId,
    chance: info.chance ?? null,
    roll: info.roll ?? null,
  };

  if (responderId === game.user.id) {
    handleVoluntaryMentalDuel(payload);
  } else {
    const responder = game.users.get(responderId);
    ui.notifications.info(
      `Awaiting ${responder?.name ?? "the target's owner"} to accept the Mental Duel…`,
    );
    game.socket.emit(SOCKET, payload);
  }
}

/**
 * Socket receiver: show the voluntary-acceptance prompt to the designated
 * responder only. On accept, opens the duel for everyone; on decline, posts a
 * short chat note so the caster knows.
 * @param {object} data
 */
export async function handleVoluntaryMentalDuel(data) {
  if (game.user.id !== data.responderId) return;

  const aDoc = fromUuidSync(data.attackerUuid);
  const bDoc = fromUuidSync(data.defenderUuid);
  if (!aDoc?.actor || !bDoc?.actor) return;

  const rollNote =
    data.chance != null && data.roll != null
      ? `<p style="opacity:.8;font-size:12px;">Forced initiation failed (${data.chance}% → rolled ${data.roll}).</p>`
      : "";

  const accept = await Dialog.confirm({
    title: "Mentální souboj",
    content: `
      <p><b>${aDoc.name}</b> reaches into <b>${bDoc.name}</b>'s mind, inviting a Mental Duel.</p>
      ${rollNote}
      <p>Do you voluntarily accept the duel?</p>`,
    defaultYes: false,
  });

  if (!accept) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: bDoc.actor }),
      content: `<p style="text-align:center;"><b>${bDoc.name}</b> refuses the Mental Duel.</p>`,
    });
    return;
  }

  // Pull onto the duel's scene if needed, then open (broadcasts to all).
  const scene = aDoc.parent ?? bDoc.parent;
  if (scene && canvas.scene?.id !== scene.id) await scene.view();

  const aTok = aDoc.object;
  const bTok = bDoc.object;
  if (!aTok || !bTok) return;

  openMentalDuel(aTok, bTok);
}

/* -------------------------------------------- */
/*  Possession (seize control after the duel)   */
/* -------------------------------------------- */

/**
 * The winner claims control of the loser's token. Ownership changes require GM
 * authority, so this routes to the active GM (locally if we are the GM,
 * otherwise over the system socket). Both arguments are TOKEN document uuids.
 * @param {string} loserUuid  - token uuid of the mind that broke.
 * @param {string} winnerUuid - token uuid of the victor.
 */
function requestPossession(loserUuid, winnerUuid) {
  const gm = game.users.activeGM;
  if (!gm) {
    ui.notifications.warn("A GM must be connected to seize control.");
    return;
  }
  const data = { loserUuid, winnerUuid };
  if (game.user.id === gm.id) applyPossessionAsGM(data);
  else game.socket.emit(SOCKET, { type: "mentalDuelPossess", ...data });
}

/** Socket entry point: only the active GM (single authority) applies it. */
export async function handleMentalDuelPossess(data) {
  if (game.user.id !== game.users.activeGM?.id) return;
  await applyPossessionAsGM(data);
}

/**
 * Authoritative possession grant. Runs on the active GM.
 *
 * Grants every non-GM owner of the WINNER actor OWNER permission on the LOSER
 * actor (shared control — the loser's own owners keep their access), records
 * the exact prior levels so removal can restore them, and applies the
 * "possessed" token marker. Removing that status effect ends the possession and
 * restores ownership (see documents/effects.mjs `_onDelete`).
 * @param {{loserUuid: string, winnerUuid: string}} data - TOKEN document uuids.
 */
async function applyPossessionAsGM({ loserUuid, winnerUuid }) {
  const loserTok = fromUuidSync(loserUuid);
  const winnerTok = fromUuidSync(winnerUuid);
  const loserActor = loserTok?.actor;
  const winnerActor = winnerTok?.actor;
  if (!loserActor || !winnerActor) return;

  // Idempotent — don't stack a second possession on an already-possessed mind.
  if (loserActor.getFlag("redsteel", "possession")) {
    ui.notifications.info(`${loserActor.name} is already possessed.`);
    return;
  }

  // Enforce the seize rule server-side too: only a winner who can Dominate.
  if (!canDominate(winnerActor)) {
    ui.notifications.warn(
      `${winnerActor.name} lacks the Domination perk to seize control.`,
    );
    return;
  }

  const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;

  // Every non-GM player who owns the winner becomes an owner of the loser.
  const userIds = game.users
    .filter((u) => !u.isGM && winnerActor.testUserPermission(u, "OWNER"))
    .map((u) => u.id);

  // Snapshot the exact prior level per granted user (null = key was absent), so
  // ending possession restores it precisely without disturbing other owners.
  // A partial merge is fine when adding keys (Foundry merges ownership); the
  // wholesale replace is only needed on release, where keys must be deleted.
  const ownership = loserActor.ownership ?? {};
  const grants = {};
  const update = {};
  for (const id of userIds) {
    grants[id] = id in ownership ? ownership[id] : null;
    update[`ownership.${id}`] = OWNER;
  }

  await loserActor.setFlag("redsteel", "possession", {
    possessorActorUuid: winnerActor.uuid,
    possessorName: winnerActor.name,
    grants,
  });

  // Apply the visible token marker BEFORE the ownership change so that the
  // ownership update lands last: the updateActor→redraw hook (redsteel.mjs)
  // then rebuilds the newly-owned token's mesh with the effect icon already in
  // place, avoiding a broken sprite on the possessing player's client.
  await game.redsteel.applyEffect(loserActor, "possessed");

  if (userIds.length) await loserActor.update(update);

  // Force every client to rebuild the possessed token's sprite. On the client
  // that just gained ownership the mesh can be left unrendered (the placeable
  // is still there — moving/selecting it redraws it); the reactive updateActor
  // hook does not always catch it, so broadcast an explicit redraw that runs
  // after all the possession updates have propagated.
  broadcastPossessionRender(loserActor.uuid);

  const controlNote = userIds.length
    ? `<p style="opacity:.85;font-size:12px;">Control of <b>${loserActor.name}</b> passes to ${winnerActor.name}'s player(s) until the “Possessed” status is removed.</p>`
    : `<p style="opacity:.85;font-size:12px;">No player owns ${winnerActor.name}; the marker is applied for the GM to puppet.</p>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: winnerActor }),
    content: `
      <div style="text-align:center;">
        <p><i class="fas fa-hand-sparkles"></i> <b>${winnerActor.name}</b> seizes control of <b>${loserActor.name}</b>.</p>
        ${controlNote}
      </div>`,
  });
}

/**
 * Un-stick the rendering of a token whose ownership just changed on this client.
 * A token you have just gained ownership of (especially an UNLINKED one, whose
 * synthetic actor is rebuilt from its ActorDelta on the change) can be left
 * invisible until the next canvas interaction — a plain
 * `CanvasVisibility#restrictVisibility` / `perception.update` does NOT fix it;
 * only re-controlling the token does (verified in play). So imitate the click:
 * synchronously control then release each owned token (net-zero on the player's
 * selection, no visible flicker) which kicks the vision-source machinery. Run a
 * few times so a pass lands after the delta rebuild that re-hides it settles.
 * @param {string} actorUuid
 */
export function refreshPossessedActorTokens(actorUuid) {
  const kick = () => {
    if (!canvas?.ready) return;
    canvas.perception?.update({ initializeVision: true, refreshVision: true });
    canvas.visibility?.restrictVisibility?.();
    const actor = fromUuidSync(actorUuid);
    for (const token of actor?.getActiveTokens?.() ?? []) {
      if (!token.document?.isOwner) continue; // only owners can control it
      const wasControlled = token.controlled;
      token.control({ releaseOthers: false });
      if (!wasControlled) token.release();
    }
  };
  kick();
  setTimeout(kick, 250);
  setTimeout(kick, 700);
}

/** GM helper: tell every other client to redraw the tokens, and do it locally. */
function broadcastPossessionRender(actorUuid) {
  game.socket.emit(SOCKET, { type: "possessionRender", actorUuid });
  refreshPossessedActorTokens(actorUuid);
}

/** Socket receiver: rebuild the possessed actor's token sprites on this client. */
export function handlePossessionRender(data) {
  refreshPossessedActorTokens(data.actorUuid);
}
