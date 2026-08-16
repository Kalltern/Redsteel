/**
 * Aim system.
 *
 * A token can "aim" at a single target, stacking up to 4 times for a cumulative
 * +10% hit chance per stack (+10 / +20 / +30 / +40 %). State lives entirely on a
 * token flag — `flags.redsteel.aim = { targetId, stacks, stamp }` — so the flags
 * are the single source of truth. "Who is aiming at whom" is answered by
 * iterating the scene's tokens and filtering on that flag; no lookup table is
 * kept. `stamp` counts mutations, and exists so the end-of-turn sweep below can
 * tell "nobody has touched this since the attack" from "the player already
 * re-aimed".
 *
 * How an attack spends it (resolveAimOnAttack, below):
 *   • Attacking the aimed target burns every stack, hit or miss. That is the
 *     default, and for a character with no duellist perk it is the whole story —
 *     the outcome cannot change the answer, so nothing needs deferring.
 *   • Attacking anybody else breaks the aim outright, unless Advanced Aim is
 *     live, in which case the aim is neither spent nor depleted.
 *   • A handful of abilities (Counterattack, Cleave, Cunning Strike…) have no
 *     interaction with Aiming at all and skip the whole thing.
 *   • Aim reduction (Duelist II, and the two spec nodes) is the one case the
 *     attack cannot settle on its own: a hit costs one stack, a critical hit
 *     none, a miss the lot. Those attacks park a pending record instead, which
 *     Apply Damage settles as a hit, and the end-of-turn sweep settles as a miss.
 *   • A landed attack can also hand Aim back: Perfect Opening grants two on a
 *     hit and three on a critical (grantAimOnDamage, below), read off the
 *     ability recorded on the attack card once damage is actually applied.
 *
 * Aim also answers back on defense (Duelist VII): when the token swinging at you
 * is the one you are aiming at, every stack is worth +5% melee defense. That is
 * purely passive — the stacks are neither spent nor reduced by defending — and it
 * only reads the aim you already hold, so it never fights the attack path above.
 *
 * Every one of those perks is weapon-gated: the duellist's blade has to be in
 * hand for any of them to be live. See aimPerks().
 *
 * Two ways to drive the aim itself, both manual (aim is never granted or burned
 * on roll hooks):
 *   1. Hold ALT with your aimer token selected — a square button appears over
 *      every other token. Left-click adds a stack toward it, right-click removes
 *      one. The aimer is the currently controlled token.
 *   2. Three macros (Add / Remove / Consume) for hotbar use.
 *
 * A PIXI overlay on `canvas.interface` visualises the current state.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { ensureSystemMacros } from "./macroFolders.mjs";

const SYSTEM_ID = "redsteel";
const FLAG = "aim";
/** Actor flag: attacks whose aim cost is not known until damage is applied. */
const PENDING_FLAG = "aimPending";
const MAX_STACKS = 4;
const PER_STACK = 10; // % hit chance per stack
const IMPROVED_AIM_PEN = 10; // Improved Aim: penetration at full aim
const DEFENSE_PER_STACK = 5; // Duelist VII: % melee defense per stack held

const COLOR_AMBER = 0xffb300; // stacks 1–3
const COLOR_RED = 0xff3030; // stack 4 (capped)
const COLOR_IDLE = 0x9aa0a6; // a target with no aim on it yet

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

/** The token the user is acting with (controlled token, else assigned char). */
function getActingToken() {
  const sel = game.redsteel?.selectToken?.({ warn: false });
  return sel?.token ?? null;
}

function stackColor(stacks) {
  if (stacks >= MAX_STACKS) return COLOR_RED;
  if (stacks > 0) return COLOR_AMBER;
  return COLOR_IDLE;
}

/** Arrow/badge colour: the actor's player-owner colour, else the active GM's. */
function ownerColor(token) {
  const actor = token?.actor;
  let user = null;
  if (actor) {
    const owners = game.users.filter(
      (u) => !u.isGM && actor.testUserPermission(u, "OWNER"),
    );
    user = owners.find((u) => u.active) ?? owners[0] ?? null;
  }
  if (!user) user = game.users.activeGM ?? game.user;
  try {
    return Number(foundry.utils.Color.from(user?.color ?? "#ffffff"));
  } catch {
    return 0xffffff;
  }
}

/**
 * The number of Aim stacks `token` currently holds. The aim flag already stores
 * its own target, so this does NOT require a separate Foundry target reticle.
 * If the user happens to have a target reticle set on a DIFFERENT token than the
 * aimed one, the bonus is suppressed (they're aiming elsewhere). Used to
 * pre-select the "Aim" radio in the attack / combat-ability dialogs so a stacked
 * aim carries into the roll automatically.
 */
export function getAimStacks(token, target = game.user?.targets?.first?.() ?? null) {
  const aim = token?.document?.getFlag(SYSTEM_ID, FLAG);
  if (!aim?.targetId) return 0;
  // Only suppress when an explicit reticle target differs from the aimed token.
  if (target && aim.targetId !== target.id) return 0;
  return Math.min(MAX_STACKS, Math.max(0, aim.stacks ?? 0));
}

/**
 * A one-handed sword: sword class, not a heavy blade (longsword, flamberge) and
 * not currently gripped in two hands. Mirrors buildWeaponSetView's two-hander
 * test, so flipping the grip toggle on the sheet flips eligibility live.
 */
function isOneHandedSword(weapon) {
  const ws = weapon?.system ?? {};
  return ws.class === "sword" && ws.type !== "heavy" && ws.gripMode !== "two";
}

/**
 * A broadsword-type blade actually gripped in two hands: sword class, not a
 * light blade (dagger, sabre, shortsword), and either heavy — longswords and
 * flamberges are two-handed whatever the toggle says, same as
 * buildWeaponSetView reads them — or switched to the two-hand grip.
 */
function isTwoHandedSword(weapon) {
  const ws = weapon?.system ?? {};
  if (ws.class !== "sword" || ws.type === "light") return false;
  return ws.type === "heavy" || ws.gripMode === "two";
}

/**
 * The duelling stance: the off hand is free, or holds an off-hand weapon whose
 * off-hand profile is duelist-flagged (`offhandProperties.doctrines.duelist`).
 * Today that is the fencing dagger; a one-handed crossbow or pistol qualifies
 * the day it is added with that flag set, no code change needed. A shield never
 * qualifies.
 */
function hasDuelistOffHand(context) {
  if (context?.hasShield) return false;
  const off = context?.offWeapon;
  if (!off) return true; // empty hand
  return off.system?.offhandProperties?.doctrines?.duelist === true;
}

/**
 * Aim-reduction profiles. All three share the same base — a hit on the aimed
 * target costs one stack instead of the whole bonus, a critical hit costs none —
 * and differ only in what they add on top. `missLoss` is what a failed attack
 * costs: "all" burns the lot, "half" takes half the stacks rounded up (4 → 2).
 */
const REDUCTION_BASE = {
  hitLoss: 1,
  critLoss: 0,
  sneakHitLoss: 1,
  missLoss: "all",
  sneakGrant: false,
};
/** Servant of the Sword: a Sneak Attack grants one Aim on the token that took it. */
const REDUCTION_SERVANT = { ...REDUCTION_BASE, sneakGrant: true };
/** Sword Dancer: a miss costs only half, and a Sneak Attack that lands costs nothing. */
const REDUCTION_DANCER = { ...REDUCTION_BASE, sneakHitLoss: 0, missLoss: "half" };

/**
 * Fold several live profiles into one, taking the most generous clause of each.
 * In practice the blade tests below are mutually exclusive, so at most one node
 * profile can be live at a time — this only ever merges a node with the bare
 * doctrine rank, and exists so stacking sources can never come out worse than
 * either source alone.
 */
function mergeReduction(profiles) {
  if (!profiles.length) return null;
  return profiles.reduce((a, b) => ({
    hitLoss: Math.min(a.hitLoss, b.hitLoss),
    critLoss: Math.min(a.critLoss, b.critLoss),
    sneakHitLoss: Math.min(a.sneakHitLoss, b.sneakHitLoss),
    missLoss: a.missLoss === "half" || b.missLoss === "half" ? "half" : "all",
    sneakGrant: a.sneakGrant || b.sneakGrant,
  }));
}

/**
 * Which Aim perks are live for this actor with this weapon in hand, right now.
 *
 * Every duellist Aim perk is weapon-gated, and each source gates on its own
 * blade: the Duelist doctrine and the Sword Dancer chain want a one-handed sword
 * with the off hand free (or holding a fencing dagger), while Servant of the
 * Sword works uniquely off a two-handed broadsword. Sheathe the blade and every
 * one of these switches off, which is why they are recomputed per attack rather
 * than cached.
 *
 *   improved  — Improved Aim. Worth +10 armour penetration at full aim, and
 *               Advanced Aim: attacking a different target neither spends nor
 *               depletes the aim.
 *   reduction — the profile above, or null when no source is live.
 *   keepsAim  — Duelist's Stance. Moving the aim to a new target carries all but
 *               one of the old stacks across instead of burning them.
 *   defense   — Duelist VII. Melee defense against the aimed target is worth
 *               +5% per stack held.
 *   laceration— Laceration. A landed hit can sacrifice Aim for Bleeding, offered
 *               in the Apply Damage dialog. See getLacerationOffer().
 *   maneuver  — Advantageous Maneuver. A successful melee defense can buy one Aim
 *               on the attacker for Stamina, offered on the defense card. See
 *               utils/advantageousManeuver.mjs.
 */
function aimPerks(actor, weapon, context = null) {
  if (!actor || !weapon) return {};

  // The duellist's blade: a one-handed sword with a free or duelist off hand.
  const blade = isOneHandedSword(weapon) && hasDuelistOffHand(context);
  const broadsword = isTwoHandedSword(weapon);
  const rank = Number(actor.system?.doctrines?.duelist?.value ?? 0);
  const node = (spec, id) => actorHasSpecNode(actor, spec, id);

  const profiles = [];
  if (blade && rank >= 2) profiles.push(REDUCTION_BASE);
  if (broadsword && node("swordServant", "aimReduction"))
    profiles.push(REDUCTION_SERVANT);
  if (blade && node("swordDancer", "mireniRedukce"))
    profiles.push(REDUCTION_DANCER);

  return {
    improved:
      (blade && rank >= 1) || (broadsword && node("swordServant", "improvedAim")),
    reduction: mergeReduction(profiles),
    keepsAim: blade && node("swordDancer", "postojMireni"),
    defense: blade && rank >= 7,
    laceration: blade && node("swordDancer", "krvaveBodnuti"),
    maneuver: blade && node("swordDancer", "vyhodnyManevr"),
  };
}

/**
 * Advantageous Maneuver (Sword Dancer) — is the perk live for this defense?
 *
 * Weapon-gated like every other Aim perk on the tree: the duellist's blade has to
 * be the thing that turned the blow aside. Character-only, as spec nodes are.
 */
export function hasAdvantageousManeuver(actor, weapon = null, context = null) {
  if (actor?.type !== "character") return false;
  return !!aimPerks(actor, weapon, context).maneuver;
}

/**
 * Duelist VII — the defensive half of Aiming: parrying the very opponent you are
 * aiming at is worth +5% melee defense per stack you hold.
 *
 * Passive. Nothing here writes a flag, so the stacks survive the defense intact
 * and are still there for the attack that follows.
 *
 * `attackerTokenId` is the token actually swinging, which the defense roll takes
 * from the Defend button (a fact) or from the attacker it inferred for Overwhelm.
 * With no attacker to name, there is nothing to compare the aim against and the
 * bonus is simply zero — a defense cannot claim it on the strength of an aim
 * pointed somewhere else entirely.
 *
 * @param {object} opts
 * @param {Actor}  opts.actor            the defender
 * @param {TokenDocument|Token|null} opts.token  the defender's token (holds the aim)
 * @param {Item}   [opts.weapon]         weapon in hand — gates the perk
 * @param {object} [opts.context]        resolved weapon context (grip, off hand)
 * @param {string} [opts.attackerTokenId] the token being defended against
 * @returns {{stacks: number, bonus: number}}
 */
export function getAimDefenseBonus({
  actor,
  token,
  weapon = null,
  context = null,
  attackerTokenId = null,
} = {}) {
  const perk = actor ? !!aimPerks(actor, weapon, context).defense : false;

  const aim = readAim(token);
  const aimTargetId = aim?.targetId ?? null;
  const held = Math.min(MAX_STACKS, Math.max(0, aim?.stacks ?? 0));

  // Both halves are reported even when they disagree, so the dialog can say
  // *why* there is no bonus instead of going quiet. A silent zero here is
  // indistinguishable from the perk not existing, and reads at the table as
  // "the automation is broken" when the real answer is usually that the
  // defense is answering somebody other than the one being aimed at.
  const matched = !!attackerTokenId && aimTargetId === attackerTokenId;
  const stacks = perk && matched ? held : 0;

  return {
    perk,
    aimTargetId,
    held,
    attackerTokenId,
    stacks,
    bonus: stacks * DEFENSE_PER_STACK,
  };
}

/**
 * Improved Aim — armour penetration granted at full (4-stack) aim.
 *
 * Reads the actor `aimCount` flag — the stack count the attack dialog actually
 * committed to this roll, i.e. the same number that pays the +40% hit bonus.
 * That flag is consumed later, inside getAttackRolls, so callers must fold this
 * in while assembling penetration (which happens before the attack roll).
 */
export function getImprovedAimPenetration(actor, weapon, context = null) {
  const stacks = Number(actor?.getFlag(SYSTEM_ID, "aimCount")) || 0;
  if (stacks < MAX_STACKS) return 0;
  return aimPerks(actor, weapon, context).improved ? IMPROVED_AIM_PEN : 0;
}

/* -------------------------------------------- */
/*  Core aim mutations (token → target)         */
/* -------------------------------------------- */

/**
 * The TokenDocument behind either a Token placeable or a TokenDocument, so the
 * aim helpers work off-canvas too: Apply Damage and the end-of-turn sweep run on
 * the GM, who may well be looking at a different scene than the fight.
 */
function tokenDoc(token) {
  return token?.document ?? token ?? null;
}

/** The live aim record on a token, or null. */
function readAim(token) {
  return tokenDoc(token)?.getFlag(SYSTEM_ID, FLAG) ?? null;
}

/**
 * Write an aim of `stacks` toward `targetId`, capped at MAX_STACKS, clearing the
 * flag instead when nothing is left. Every write bumps `stamp` so the end-of-turn
 * sweep can recognise an aim that has been touched since an attack was rolled.
 */
async function setAim(token, targetId, stacks) {
  const doc = tokenDoc(token);
  if (!doc || !targetId) return;

  const capped = Math.min(MAX_STACKS, Math.max(0, Math.round(stacks)));
  if (capped <= 0) return clearAim(token);

  const stamp = (doc.getFlag(SYSTEM_ID, FLAG)?.stamp ?? 0) + 1;
  await doc.setFlag(SYSTEM_ID, FLAG, { targetId, stacks: capped, stamp });
}

/** Drop the aim entirely. */
async function clearAim(token) {
  const doc = tokenDoc(token);
  if (!doc?.getFlag(SYSTEM_ID, FLAG)) return;
  await doc.unsetFlag(SYSTEM_ID, FLAG);
}

/**
 * Add one Aim stack from `token` toward `target`.
 * - No existing aim → set at 1 stack.
 * - Same target → increment (max 4).
 * - Different target → switching burns all prior stacks; reset to 1. Duelist's
 *   Stance carries all but one across instead, so a switch costs a single stack.
 */
async function addAimStackOn(token, target, perks = null) {
  if (!token || !target) return;
  if (target.id === token.id) return; // a token cannot aim at itself

  const aim = readAim(token);

  if (aim?.targetId === target.id) {
    if (aim.stacks >= MAX_STACKS) return; // already capped
    await setAim(token, target.id, aim.stacks + 1);
    return;
  }

  // Switching targets: 1 fresh stack, plus whatever Duelist's Stance carries.
  const carried =
    aim?.targetId && perks?.keepsAim ? Math.max(0, (aim.stacks ?? 0) - 1) : 0;
  await setAim(token, target.id, 1 + carried);
}

/**
 * Remove one Aim stack from `token`; clear the flag entirely at 0.
 * When `target` is given (button right-click), only acts if `token` is actually
 * aiming at that target. When null (macro), decrements the current aim.
 */
async function removeAimStackOn(token, target = null) {
  const aim = readAim(token);
  if (!aim) return;
  if (target && aim.targetId !== target.id) return;

  await setAim(token, aim.targetId, aim.stacks - 1);
}

/**
 * Advantageous Maneuver — where the aim stands before the button is pressed, so
 * the defense card can dress the button and refuse to charge for nothing.
 *
 * `held` counts only stacks already pointed at this attacker: an aim aimed
 * somewhere else is worth zero here, because pressing the button would burn it.
 *
 * @param {TokenDocument|Token} aimerToken   the defender
 * @param {TokenDocument|Token} targetToken  the attacker being aimed at
 * @returns {{held: number, capped: boolean, switching: boolean}}
 */
export function previewManeuverAim(aimerToken, targetToken) {
  const aim = readAim(aimerToken);
  const targetId = tokenDoc(targetToken)?.id ?? null;
  const onTarget = !!targetId && aim?.targetId === targetId;
  const held = Math.min(MAX_STACKS, Math.max(0, aim?.stacks ?? 0));

  return {
    held: onTarget ? held : 0,
    capped: onTarget && held >= MAX_STACKS,
    switching: !!aim?.targetId && !onTarget,
  };
}

/**
 * Add the maneuver's single stack toward the attacker, reporting what the
 * defender held before and after.
 *
 * Deliberately routed through addAimStackOn rather than writing the flag
 * directly: switching an aim onto a new target costs stacks, and Duelist's Stance
 * changes what a switch costs. The maneuver has no business having its own
 * opinion about either — it buys one stack, on the same terms as any other.
 *
 * @param {TokenDocument|Token} aimerToken
 * @param {TokenDocument|Token} targetToken
 * @returns {Promise<{before: number, after: number}>}
 */
export async function grantManeuverAim(aimerToken, targetToken) {
  const aimer = tokenDoc(aimerToken);
  const target = tokenDoc(targetToken);
  if (!aimer || !target) return { before: 0, after: 0 };

  const { held } = previewManeuverAim(aimer, target);
  await addAimStackOn(aimer, target, livePerks(aimer.actor));

  return { before: held, after: readAim(aimer)?.stacks ?? 0 };
}

/* -------------------------------------------- */
/*  Attack interaction                          */
/* -------------------------------------------- */

/**
 * Abilities with no interaction with Aiming whatsoever: using one neither spends
 * the aim nor breaks it, whoever it is pointed at. Matched on localizationKey,
 * which is stable across renames and identical in both languages, with the
 * English name as a fallback for hand-made copies that never got a key.
 */
const AIM_NEUTRAL_ABILITIES = new Map([
  ["REDSTEEL.Items.Counterattack.name", "Counterattack"],
  ["REDSTEEL.Items.RetaliatoryStrike.name", "Retaliatory strike"],
  ["REDSTEEL.Items.Cleave.name", "Cleave"],
  ["REDSTEEL.Items.PolearmCleave.name", "Polearm Cleave"],
  ["REDSTEEL.Items.FlambergeCleaveAbility.name", "Flamberge Cleave (Ability)"],
  ["REDSTEEL.Items.DoubleThrow.name", "Double Throw"],
  ["REDSTEEL.Items.CunningStrike.name", "Cunning Strike"],
]);

/** True when this ability is one the rules exempt from Aiming entirely. */
export function abilityIgnoresAim(ability) {
  if (!ability) return false;
  const key = ability.system?.localizationKey;
  if (key && AIM_NEUTRAL_ABILITIES.has(key)) return true;
  for (const name of AIM_NEUTRAL_ABILITIES.values()) {
    if (ability.name === name) return true;
  }
  return false;
}

/**
 * Abilities that GRANT Aim when their attack lands, keyed exactly like
 * AIM_NEUTRAL_ABILITIES above: the localisation key first, the English name as a
 * fallback for a hand-made copy that never got one.
 *
 * Perfect Opening (Rafinovaný manévr, in both its action costs) is the whole
 * list. The blow is a set-up rather than a finisher, so landing it leaves the
 * duellist better aimed than they started: two Aim on the target for an ordinary
 * hit, three when it lands as a critical.
 */
const AIM_GRANT_ABILITIES = new Map([
  [
    "REDSTEEL.Items.PerfectOpening.name",
    { name: "Perfect Opening", normal: 2, critical: 3 },
  ],
  [
    "REDSTEEL.Items.PerfectOpeningHastened.name",
    { name: "Perfect Opening (Hastened)", normal: 2, critical: 3 },
  ],
]);

/** What an ability grants for a landed hit, or null when it grants nothing. */
function aimGrantForAbility(key = null, name = null) {
  if (key && AIM_GRANT_ABILITIES.has(key)) return AIM_GRANT_ABILITIES.get(key);
  if (!name) return null;
  for (const grant of AIM_GRANT_ABILITIES.values()) {
    if (grant.name === name) return grant;
  }
  return null;
}

/**
 * The token doing the aiming. Prefers a controlled token belonging to the actor
 * — the one the player is actually acting with — and falls back to the actor's
 * first token on the canvas for macro and socket paths where nothing is selected.
 */
function getAimerToken(actor) {
  if (!actor) return null;
  const controlled = canvas?.tokens?.controlled?.find(
    (t) => t.actor?.id === actor.id,
  );
  if (controlled) return controlled;
  return actor.getActiveTokens?.()?.[0] ?? null;
}

/** Perks for whatever the actor currently has in hand (manual/macro paths). */
function livePerks(actor) {
  const context = game.redsteel?.resolveWeaponContext?.(actor) ?? null;
  return aimPerks(actor, context?.weapon ?? null, context);
}

/**
 * Pending aim resolutions parked on the actor, oldest first. Copied out of the
 * flag rather than handed over live, so callers can splice their entry out
 * without editing the stored document data underneath themselves.
 */
function readPending(actor) {
  const queue = actor?.getFlag(SYSTEM_ID, PENDING_FLAG);
  return Array.isArray(queue) ? [...queue] : [];
}

/**
 * The aimer's TokenDocument for a parked entry, resolved through the scene it
 * was recorded on rather than the canvas — the GM settling this may be looking
 * at a different scene entirely.
 */
function pendingToken(entry) {
  return game.scenes?.get(entry?.sceneId)?.tokens?.get(entry?.tokenId) ?? null;
}

/** The aimed-at token for a parked entry, for naming it in chat. */
function pendingTarget(entry) {
  return game.scenes?.get(entry?.sceneId)?.tokens?.get(entry?.targetId) ?? null;
}

async function writePending(actor, queue) {
  if (!actor) return;
  if (queue.length) await actor.setFlag(SYSTEM_ID, PENDING_FLAG, queue);
  else if (actor.getFlag(SYSTEM_ID, PENDING_FLAG))
    await actor.unsetFlag(SYSTEM_ID, PENDING_FLAG);
}

/**
 * Spend, break or park the aim for an attack that is about to be rolled.
 *
 * Called from getAttackRolls — the one choke point every weapon attack and
 * combat ability passes through — and from the explosive throw, which builds its
 * own roll. Defense rolls never reach it.
 *
 * Which token is being attacked comes from the user's target reticle. Attacks in
 * this system roll without requiring a target, so an empty reticle is read as
 * "the one I was aiming at": that is overwhelmingly the common case, and the
 * alternative reading (attacking someone else) burns the aim anyway for anyone
 * without Advanced Aim.
 *
 * @param {object}  opts
 * @param {Actor}   opts.actor    the attacker
 * @param {Item}    [opts.weapon] weapon in hand — gates every duellist perk
 * @param {object}  [opts.context] resolved weapon context (grip, off hand)
 * @param {Item}    [opts.ability] the combat ability used, if any
 * @param {boolean} [opts.sneak]  whether this attack is a Sneak Attack
 */
export async function resolveAimOnAttack({
  actor,
  weapon = null,
  context = null,
  ability = null,
  sneak = false,
} = {}) {
  if (!actor) return;
  if (abilityIgnoresAim(ability)) return;

  const aimer = getAimerToken(actor);
  if (!aimer) return;

  const aim = readAim(aimer);
  const perks = aimPerks(actor, weapon, context);

  const targetIds = [...(game.user?.targets ?? [])]
    .map((t) => t.id)
    .filter(Boolean);
  // An empty reticle counts as attacking the aimed target (see above).
  const struckAimed =
    !!aim?.targetId &&
    (targetIds.length === 0 || targetIds.includes(aim.targetId));
  // A Sneak Attack grant lands on whoever actually took the hit.
  const sneakTargetId = struckAimed ? aim.targetId : (targetIds[0] ?? null);

  let pending = null;

  if (aim?.targetId) {
    if (!struckAimed) {
      // Attacking somebody else: Advanced Aim holds the aim intact and unspent,
      // otherwise it is broken outright.
      if (!perks.improved) await clearAim(aimer);
    } else if (perks.reduction || perks.laceration) {
      // Aim reduction — what this costs depends on whether the attack lands, and
      // on whether it lands as a critical, so park it and settle later. The live
      // profile travels with the record: by the time Apply Damage runs there is
      // no weapon context left to re-derive it from, and the blade may well have
      // been swapped since.
      //
      // Laceration parks on the same record even with no reduction profile
      // behind it, because it too is an offer that only exists once the attack
      // is known to have landed. `reduction: null` then says exactly that: this
      // hit costs the whole aim unless Laceration buys it back.
      pending = {
        sceneId: aimer.document?.parent?.id ?? canvas?.scene?.id ?? null,
        tokenId: aimer.id,
        targetId: aim.targetId,
        stamp: aim.stamp ?? 0,
        sneak: !!sneak,
        reduction: perks.reduction ?? null,
        laceration: !!perks.laceration,
      };
    } else {
      await clearAim(aimer);
    }
  }

  if (pending) {
    await writePending(actor, [...readPending(actor), pending]);
    return;
  }

  // Sneak Attack grants one Aim on the token that took it. When that is not the
  // token already aimed at, this moves the aim — and Duelist's Stance carries
  // all but one of the old stacks across with it.
  if (sneak && perks.reduction?.sneakGrant && sneakTargetId) {
    const target = canvas?.tokens?.get(sneakTargetId);
    if (target) await addAimStackOn(aimer, target, perks);
  }
}

/**
 * Laceration (Sword Dancer) — what this landed attack may still sacrifice.
 *
 * The rule fires after the hit, so the offer only exists while the attack is
 * parked: the entry proves the blow went at the aimed target with the blade in
 * hand, and the aim on the token is what there is left to spend. Both halves
 * are checked, since the player may have re-aimed by hand between rolling and
 * applying, in which case the parked attack no longer owns those stacks.
 *
 * Read by the Apply Damage dialog to build the control and by the GM apply to
 * re-check it — the payload arrives over the socket, so nothing in it is
 * trusted.
 *
 * @param {Actor}  actor          the attacker
 * @param {string} targetTokenId  the token the damage is being applied to
 * @returns {{available: boolean, stacks: number, sneak: boolean}}
 */
export function getLacerationOffer(actor, targetTokenId) {
  const none = { available: false, stacks: 0, sneak: false };
  if (!actor || !targetTokenId) return none;

  const entry = readPending(actor).find(
    (p) => p.laceration && p.targetId === targetTokenId,
  );
  if (!entry) return none;

  const aim = readAim(pendingToken(entry));
  // Re-aimed or already spent by hand since the attack: those stacks are not
  // this attack's to sacrifice.
  if (!aim || aim.targetId !== entry.targetId || (aim.stamp ?? 0) !== entry.stamp) {
    return none;
  }

  const stacks = Math.min(MAX_STACKS, Math.max(0, aim.stacks ?? 0));
  return { available: stacks > 0, stacks, sneak: !!entry.sneak };
}

/**
 * Tag the attack just parked as a critical failure.
 *
 * Sword Dancer halves what a miss costs, but a fumble is explicitly carved out:
 * a critical failure still burns every stack. The attack roll does not exist yet
 * when resolveAimOnAttack parks the record, so getAttackRolls calls back here
 * once the dice have landed and marks the entry it just created — the newest one
 * on the queue, since nothing else can have been pushed in between.
 *
 * Silent when nothing is parked: no perk was live, so the aim was already spent
 * outright and there is nothing left to reduce.
 */
export async function markAimCritFail(actor) {
  const queue = readPending(actor);
  if (!queue.length) return;
  queue[queue.length - 1] = { ...queue[queue.length - 1], critFail: true };
  await writePending(actor, queue);
}

/**
 * Settle a parked aim as a HIT, from Apply Damage: a normal hit costs one stack,
 * a critical none, and a landed Sneak Attack costs nothing at all under the Sword
 * Dancer profile. Servant of the Sword's grant lands on top of whichever it was.
 *
 * Runs on the GM, since that is where applyDamageAsGM executes.
 *
 * Laceration is settled here too: Aim sacrificed into the wound is the entire
 * cost of the hit, so sacrificing even one stack means nothing further is taken
 * on top.
 *
 * @param {Actor}    actor        the attacker
 * @param {string[]} targetIds    tokens the damage was applied to
 * @param {string}   mode         "normal" | "critical" | "breakthrough"
 * @param {object}   [opts]
 * @param {Record<string, number>} [opts.laceration] targetId → stacks sacrificed
 */
export async function resolveAimOnDamage(
  actor,
  targetIds = [],
  mode = "normal",
  { laceration = {} } = {},
) {
  const queue = readPending(actor);
  if (!queue.length) return;

  const index = queue.findIndex((p) => targetIds.includes(p.targetId));
  if (index < 0) return;

  const [entry] = queue.splice(index, 1);
  await writePending(actor, queue);

  const aimer = pendingToken(entry);
  const aim = readAim(aimer);

  // The aim has moved on since the attack (re-aimed, or consumed by hand) —
  // whatever the player did by hand wins.
  if (!aim || aim.targetId !== entry.targetId || (aim.stamp ?? 0) !== entry.stamp) {
    return;
  }

  // No profile at all means the attack was only parked so Laceration could be
  // offered: with nothing sacrificed, the hit spends the aim outright, exactly
  // as it would have at attack time.
  const profile = entry.reduction ?? null;
  const before = aim.stacks ?? 0;
  const spent = Math.min(before, Math.max(0, Math.round(laceration[entry.targetId] ?? 0)));

  let loss;
  if (spent > 0) loss = spent;
  else if (!profile) loss = before;
  else if (mode === "critical") loss = profile.critLoss;
  else if (entry.sneak) loss = profile.sneakHitLoss;
  else loss = profile.hitLoss;

  const grant = entry.sneak && profile?.sneakGrant ? 1 : 0;
  await setAim(aimer, entry.targetId, before - loss + grant);
}

/**
 * Grant the Aim an ability owes for a landed hit — Perfect Opening, today.
 *
 * Called from Apply Damage right after resolveAimOnDamage, so a duellist's
 * leftover stacks are settled first and this piles on top of whatever survived
 * (still capped at 4). Damage landing is the only "the attack hit" signal in the
 * system, which is what makes this the right place: an attack that never gets
 * here missed, and the rules give a miss a different, smaller grant that the GM
 * hands out by hand.
 *
 * Only a critical is worth the larger grant. Breakthrough damage is a hit like
 * any other and pays the ordinary amount.
 *
 * The aim moves to whichever token took the damage: an aim already pointing
 * somewhere else is burned by the switch, exactly as adding a stack by hand
 * would burn it.
 *
 * Runs on the GM, since that is where applyDamageAsGM executes.
 *
 * @param {object}   opts
 * @param {Actor}    opts.actor        the attacker
 * @param {string}   [opts.tokenId]    the attacking token (aim lives on tokens)
 * @param {string}   [opts.sceneId]    scene that token is on
 * @param {string[]} [opts.targetIds]  tokens the damage was applied to
 * @param {string}   [opts.mode]       "normal" | "critical" | "breakthrough"
 * @param {string}   [opts.abilityKey] localisation key off the attack card
 * @param {string}   [opts.abilityName] raw ability name off the attack card
 * @param {ChatMessage} [opts.message] the attack card, to stamp as already paid
 */
export async function grantAimOnDamage({
  actor,
  tokenId = null,
  sceneId = null,
  targetIds = [],
  mode = "normal",
  abilityKey = null,
  abilityName = null,
  message = null,
} = {}) {
  if (!actor) return;
  const grant = aimGrantForAbility(abilityKey, abilityName);
  if (!grant) return;

  const stacks = mode === "critical" ? grant.critical : grant.normal;
  if (!(stacks > 0)) return;

  const aimer =
    game.scenes?.get(sceneId)?.tokens?.get(tokenId) ?? getAimerToken(actor);
  if (!aimer) return;

  const targetId = targetIds.find((id) => id && id !== aimer.id) ?? null;
  if (!targetId) return;

  // Applying the same card twice must not pay twice — the GM re-opening Apply
  // Damage to correct a target is routine, and without this the second press
  // would walk the aim straight to the cap.
  const paid = message?.getFlag(SYSTEM_ID, "aimGranted") ?? [];
  if (paid.includes(targetId)) return;

  const aim = readAim(aimer);
  const before = aim?.targetId === targetId ? (aim.stacks ?? 0) : 0;
  const after = Math.min(MAX_STACKS, before + stacks);

  await setAim(aimer, targetId, after);
  if (message) {
    await message.setFlag(SYSTEM_ID, "aimGranted", [...paid, targetId]);
  }

  const target = game.scenes?.get(sceneId)?.tokens?.get(targetId) ?? null;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div style="text-align:center;">${game.i18n.format(
      "REDSTEEL.Aim.Granted",
      {
        actor: actor.name,
        stacks: after - before,
        target: target?.name ?? game.i18n.localize("REDSTEEL.Aim.UnknownTarget"),
        after,
      },
    )}</div>`,
  });
}

/**
 * Settle whatever is still parked as a MISS, at the end of the turn: no damage
 * was ever applied, so the attack failed. That costs the whole aim, or half of it
 * rounded up under the Sword Dancer profile — unless the roll was a critical
 * failure, which costs the whole aim under every profile.
 *
 * This is the one inferred branch in the system — a hit the GM narrated without
 * pressing Apply Damage looks identical to a miss from here — so it reports the
 * before and after in chat rather than silently changing the number on the token.
 */
async function sweepPendingAim(actor) {
  const queue = readPending(actor);
  if (!queue.length) return;
  await writePending(actor, []);

  for (const entry of queue) {
    const aimer = pendingToken(entry);
    const aim = readAim(aimer);
    // Untouched since the attack? Then the miss stands. Otherwise the player has
    // already re-aimed and that new aim is left exactly as it is.
    if (
      !aim ||
      aim.targetId !== entry.targetId ||
      (aim.stamp ?? 0) !== entry.stamp
    ) {
      continue;
    }

    const profile = entry.reduction ?? null;
    const before = aim.stacks ?? 0;
    // Half on an ordinary miss under Sword Dancer, but a critical failure burns
    // the lot whatever the profile says — as does a miss with no profile behind
    // it (a Laceration-only park).
    const loss =
      profile?.missLoss === "half" && !entry.critFail
        ? Math.ceil(before / 2)
        : before;
    // A missed Sneak Attack still earns Servant of the Sword its stack.
    const grant = entry.sneak && profile?.sneakGrant ? 1 : 0;
    const after = Math.min(MAX_STACKS, Math.max(0, before - loss + grant));

    await setAim(aimer, entry.targetId, after);

    const target = pendingTarget(entry);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${game.i18n.format("REDSTEEL.Aim.Swept", {
        actor: actor.name,
        target: target?.name ?? game.i18n.localize("REDSTEEL.Aim.UnknownTarget"),
        before,
        after,
      })}</p>`,
      whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
    });
  }
}

/* -------------------------------------------- */
/*  Macros                                      */
/* -------------------------------------------- */

/** Add a stack toward the user's current target. */
export async function addAimStack() {
  const token = getActingToken();
  if (!token) return;
  const target = game.user.targets.first();
  if (!target) return;
  await addAimStackOn(token, target, livePerks(token.actor));
}

/** Remove a stack from the acting token's current aim. */
export async function removeAimStack() {
  const token = getActingToken();
  if (!token) return;
  await removeAimStackOn(token, null);
}

/**
 * Consume Aim — run when the token attacks its aimed target. Burns all stacks
 * regardless of how many there were.
 */
export async function consumeAim() {
  const token = getActingToken();
  if (!token) return;
  await clearAim(token);
  // Doing it by hand settles anything the attack parked for later.
  await writePending(token.actor, []);
}

/* -------------------------------------------- */
/*  Canvas overlay (state shared by arrows +    */
/*  ALT buttons)                                */
/* -------------------------------------------- */

let overlay = null; // PIXI.Container on canvas.interface
let arrowGfx = null; // per-frame redrawn lines / rings / badge backgrounds
let badgeLayer = null; // PIXI.Text badges (positioned each frame)
let buttonLayer = null; // interactive ALT buttons
let infoLayer = null; // movement/armor info panels (shown while ALT held)
let badges = new Map(); // sourceTokenId -> PIXI.Text
let relationships = []; // { source, target, stacks, color }
let phase = 0; // animation clock

// ALT-button state
let buttonsVisible = false;
let currentAimer = null; // the token whose aim the buttons mutate
let aimButtons = new Map(); // targetTokenId -> { container, gfx, label, target }

// ALT info-panel state (movement + armor, shown for every token)
let infoVisible = false;
let infoPanels = new Map(); // tokenId -> { container }

/**
 * Host layer for the overlay. `canvas.controls` (ControlsLayer) is rendered
 * ABOVE the token meshes — door controls, cursors and rulers all live here — so
 * arrows, badges and buttons draw on top of tokens instead of behind them
 * (which is what `canvas.interface` did).
 */
function overlayHost() {
  return canvas.controls ?? canvas.interface;
}

/** True once the overlay container is live on the current host layer. */
function overlayLive() {
  return !!overlay && !overlay.destroyed && overlay.parent === overlayHost();
}

function ensureOverlay() {
  if (overlayLive()) return overlay;

  overlay = new PIXI.Container();
  overlay.eventMode = "passive"; // not interactive itself, but children may be
  overlay.sortableChildren = true;
  overlay.zIndex = 1000; // float above the host layer's own children

  arrowGfx = new PIXI.Graphics();
  arrowGfx.eventMode = "none";

  badgeLayer = new PIXI.Container();
  badgeLayer.eventMode = "none";
  badgeLayer.zIndex = 1;

  buttonLayer = new PIXI.Container();
  buttonLayer.eventMode = "passive";
  buttonLayer.zIndex = 2;
  buttonLayer.visible = false;

  infoLayer = new PIXI.Container();
  infoLayer.eventMode = "none";
  infoLayer.zIndex = 3;
  infoLayer.visible = false;

  overlay.addChild(arrowGfx, badgeLayer, buttonLayer, infoLayer);

  badges.clear();
  aimButtons.clear(); // text/graphics from a torn-down canvas died with it
  infoPanels.clear();
  buttonsVisible = false;
  infoVisible = false;

  const host = overlayHost();
  host.sortableChildren = true;
  host.addChild(overlay);

  // One stable ticker callback; remove-then-add prevents duplicates on rebuild.
  canvas.app.ticker.remove(animate);
  canvas.app.ticker.add(animate);

  return overlay;
}

/* -------------------------------------------- */
/*  Aim relationships → arrows + rings          */
/* -------------------------------------------- */

/**
 * Rebuild the cached aim relationships and badge text. Called whenever flags or
 * the token set might have changed. Live positions are read each frame in
 * animate(), so arrows track moving tokens.
 */
export function refreshAimOverlay() {
  if (!canvas?.ready) return;
  ensureOverlay();

  relationships = [];
  const seen = new Set();

  for (const token of canvas.tokens.placeables) {
    const aim = token.document?.getFlag(SYSTEM_ID, FLAG);
    if (!aim?.targetId) continue;
    const target = canvas.tokens.get(aim.targetId);
    if (!target || target === token) continue;

    const stacks = Math.max(1, Math.min(MAX_STACKS, aim.stacks ?? 1));
    relationships.push({ source: token, target, stacks, color: ownerColor(token) });
    seen.add(token.id);

    let badge = badges.get(token.id);
    if (!badge) {
      badge = new PIXI.Text("", badgeStyle());
      badge.anchor.set(0.5);
      badgeLayer.addChild(badge);
      badges.set(token.id, badge);
    }
    badge.text = `+${stacks * PER_STACK}%`;
  }

  for (const [id, badge] of badges) {
    if (seen.has(id)) continue;
    badge.destroy();
    badges.delete(id);
  }

  if (buttonsVisible) updateButtonStates();
}

function badgeStyle() {
  return new PIXI.TextStyle({
    fontFamily: "Signika, sans-serif",
    fontSize: 22,
    fontWeight: "700",
    fill: "#ffffff",
    stroke: "#1a1108",
    strokeThickness: 4,
    align: "center",
  });
}

/** Per-frame redraw: animated dashes + badge/button placement. */
function animate(delta) {
  if (!overlayLive() || !arrowGfx) return;

  phase += delta;
  const dashOffset = phase * 0.9;

  arrowGfx.clear();

  for (const rel of relationships) {
    const s = rel.source;
    const t = rel.target;
    if (!s?.center || !t?.center || s.destroyed || t.destroyed) continue;

    const from = s.center;
    const to = t.center;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const ux = dx / len;
    const uy = dy / len;

    const targetRadius = Math.max(t.w, t.h) / 2;
    const tipDist = Math.max(0, len - targetRadius);
    const tipX = from.x + ux * tipDist;
    const tipY = from.y + uy * tipDist;

    drawDashedLine(arrowGfx, from.x, from.y, tipX, tipY, {
      dash: 18,
      gap: 12,
      offset: dashOffset,
      width: 4,
      color: rel.color,
      alpha: 0.95,
    });
    drawArrowhead(arrowGfx, tipX, tipY, ux, uy, rel.color);

    const badge = badges.get(s.id);
    if (badge) {
      const mx = (from.x + tipX) / 2;
      const my = (from.y + tipY) / 2;
      badge.position.set(mx, my);

      const halfW = badge.width / 2 + 8;
      const halfH = badge.height / 2 + 4;
      arrowGfx.beginFill(0x000000, 0.55);
      arrowGfx.lineStyle(2, rel.color, 0.9);
      arrowGfx.drawRoundedRect(mx - halfW, my - halfH, halfW * 2, halfH * 2, 6);
      arrowGfx.endFill();
    }
  }

  badgeLayer.visible = relationships.length > 0;

  // Keep ALT buttons glued to their (possibly moving) tokens; self-clean any
  // whose token has gone away.
  if (buttonsVisible) {
    for (const [tid, btn] of aimButtons) {
      const t = canvas.tokens.get(tid);
      if (!t || t.destroyed) {
        btn.container.destroy({ children: true });
        aimButtons.delete(tid);
        continue;
      }
      btn.container.position.set(t.center.x, t.center.y);
    }
  }

  // Float info panels just above each token.
  if (infoVisible) {
    for (const [tid, p] of infoPanels) {
      const t = canvas.tokens.get(tid);
      if (!t || t.destroyed) {
        p.container.destroy({ children: true });
        infoPanels.delete(tid);
        continue;
      }
      p.container.position.set(t.center.x, t.center.y - t.h / 2 - 6);
    }
  }
}

function drawDashedLine(gfx, x1, y1, x2, y2, opts) {
  const { dash = 16, gap = 12, offset = 0, width = 4, color = 0xffffff, alpha = 1 } = opts;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  const period = dash + gap;

  gfx.lineStyle(width, color, alpha);
  let d = -(offset % period);
  while (d < len) {
    const start = Math.max(0, d);
    const end = Math.min(len, d + dash);
    if (end > start) {
      gfx.moveTo(x1 + ux * start, y1 + uy * start);
      gfx.lineTo(x1 + ux * end, y1 + uy * end);
    }
    d += period;
  }
}

function drawArrowhead(gfx, tipX, tipY, ux, uy, color) {
  const size = 14;
  const px = -uy;
  const py = ux;
  const baseX = tipX - ux * size;
  const baseY = tipY - uy * size;
  const half = size * 0.6;

  gfx.lineStyle(0);
  gfx.beginFill(color, 0.95);
  gfx.drawPolygon([
    tipX,
    tipY,
    baseX + px * half,
    baseY + py * half,
    baseX - px * half,
    baseY - py * half,
  ]);
  gfx.endFill();
}

/* -------------------------------------------- */
/*  ALT interactive aim buttons                 */
/* -------------------------------------------- */

/**
 * Button side length in world units, scaled to the grid so it's visible on both
 * fine and coarse (e.g. large-hex) maps. Clamped to a sensible range.
 */
function buttonSize() {
  const g = canvas?.grid?.size ?? 100;
  return Math.round(Math.min(160, Math.max(44, g * 0.45)));
}

function buttonTextStyle(size) {
  return new PIXI.TextStyle({
    fontFamily: "Signika, sans-serif",
    fontSize: Math.round(size * 0.42),
    fontWeight: "700",
    fill: "#1a1108",
    stroke: "#ffffff",
    strokeThickness: Math.max(2, Math.round(size * 0.05)),
    align: "center",
  });
}

function getCurrentAimer() {
  // Prefer the still-controlled token; fall back to the one we opened with.
  return canvas.tokens?.controlled[0] ?? currentAimer ?? null;
}

function makeAimButton(target) {
  const size = buttonSize();
  const container = new PIXI.Container();
  container.eventMode = "static";
  container.cursor = "pointer";
  container.hitArea = new PIXI.Rectangle(-size / 2, -size / 2, size, size);

  const gfx = new PIXI.Graphics();
  const label = new PIXI.Text("", buttonTextStyle(size));
  label.anchor.set(0.5);
  container.addChild(gfx, label);
  container.position.set(target.center.x, target.center.y);

  const btn = { container, gfx, label, target };

  container.on("pointerdown", async (event) => {
    // Don't let the click reach the token layer (deselect / drag-select).
    event.stopPropagation();
    event.nativeEvent?.preventDefault?.();

    const aimer = getCurrentAimer();
    if (!aimer) return;

    if (event.button === 2) {
      await removeAimStackOn(aimer, target);
    } else if (event.button === 0) {
      await addAimStackOn(aimer, target, livePerks(aimer.actor));
    }
    // setFlag fires updateToken → refreshAimOverlay → updateButtonStates().
    // Update immediately too so the label responds without waiting on the hook.
    updateButtonStates();
  });

  return btn;
}

function buildAimButtons(aimer) {
  for (const btn of aimButtons.values()) btn.container.destroy({ children: true });
  aimButtons.clear();

  currentAimer = aimer;

  for (const t of canvas.tokens.placeables) {
    if (t.id === aimer.id) continue;
    if (!t.visible) continue;
    const btn = makeAimButton(t);
    buttonLayer.addChild(btn.container);
    aimButtons.set(t.id, btn);
  }

  updateButtonStates();
}

function drawButton(btn, stacks) {
  const color = stackColor(stacks);
  const s = buttonSize();
  btn.gfx.clear();
  // Bright, opaque fill with a dark outline so it stands out on any map.
  btn.gfx.lineStyle(Math.max(2, s * 0.06), 0x1a1108, 0.95);
  btn.gfx.beginFill(color, 0.95);
  btn.gfx.drawRoundedRect(-s / 2, -s / 2, s, s, Math.round(s * 0.18));
  btn.gfx.endFill();

  btn.label.text = stacks > 0 ? `+${stacks * PER_STACK}` : "＋";
}

function updateButtonStates() {
  const aimer = getCurrentAimer();
  const aim = aimer?.document?.getFlag(SYSTEM_ID, FLAG);
  for (const [tid, btn] of aimButtons) {
    const stacks = aim?.targetId === tid ? aim.stacks : 0;
    drawButton(btn, stacks);
  }
}

/* -------------------------------------------- */
/*  ALT info panels (movement + armor)          */
/* -------------------------------------------- */

// Font Awesome glyphs (FA6 solid). Foundry bundles the webfont, so PIXI text can
// render them once it's loaded (always true by the time ALT is pressed).
const FA_FAMILY = ["Font Awesome 6 Pro", "Font Awesome 6 Free", "FontAwesome"];
const ICON_MOVE = ""; // fa-person-running
const ICON_ARMOR = ""; // fa-shield-halved

/** Movement + armor-total for a token. Movement is Speed for every actor type. */
function getTokenStats(token) {
  const sys = token?.actor?.system ?? {};
  const armor = Math.round(sys.armor?.total ?? 0);
  const movement = sys.secondaryAttributes?.spd?.total ?? 0;
  return { movement: Math.round(movement), armor };
}

/** A small dark, slightly translucent panel: [run icon] N  [shield icon] N. */
function makeInfoPanel(token) {
  const { movement, armor } = getTokenStats(token);

  const container = new PIXI.Container();
  container.eventMode = "none";

  const bg = new PIXI.Graphics();
  container.addChild(bg);

  const fontSize = Math.round(Math.max(13, (canvas.grid?.size ?? 100) * 0.16));
  const iconStyle = new PIXI.TextStyle({
    fontFamily: FA_FAMILY,
    fontWeight: "900",
    fontSize,
    fill: "#ffffff",
  });
  const numStyle = new PIXI.TextStyle({
    fontFamily: "Signika, sans-serif",
    fontWeight: "700",
    fontSize,
    fill: "#ffffff",
    stroke: "#000000",
    strokeThickness: 3,
  });

  const pad = Math.round(fontSize * 0.55);
  const gapSmall = Math.round(fontSize * 0.25); // icon → its number
  const gapLarge = Math.round(fontSize * 0.7); // pair → pair
  const h = fontSize + pad * 2;
  const cy = h / 2;
  let x = pad;

  const addPair = (glyph, value, iconColor) => {
    const icon = new PIXI.Text(glyph, iconStyle.clone());
    icon.style.fill = iconColor;
    icon.anchor.set(0, 0.5);
    icon.position.set(x, cy);
    container.addChild(icon);
    x += icon.width + gapSmall;

    const num = new PIXI.Text(String(value), numStyle);
    num.anchor.set(0, 0.5);
    num.position.set(x, cy);
    container.addChild(num);
    x += num.width + gapLarge;
  };

  addPair(ICON_MOVE, movement, "#8fd0ff"); // movement — blue
  addPair(ICON_ARMOR, armor, "#d7d7d7"); // armor — steel

  const w = x - gapLarge + pad;
  bg.beginFill(0x0c0c0a, 0.7);
  bg.lineStyle(1, 0xffffff, 0.18);
  bg.drawRoundedRect(0, 0, w, h, 6);
  bg.endFill();

  // Anchor bottom-centre so it floats just above the token.
  container.pivot.set(w / 2, h);

  return { container };
}

function buildInfoPanels() {
  for (const p of infoPanels.values()) p.container.destroy({ children: true });
  infoPanels.clear();

  for (const t of canvas.tokens.placeables) {
    if (!t.visible) continue;
    const panel = makeInfoPanel(t);
    infoLayer.addChild(panel.container);
    infoPanels.set(t.id, panel);
  }
}

function hideInfoPanels() {
  infoVisible = false;
  if (infoLayer) infoLayer.visible = false;
  for (const p of infoPanels.values()) p.container.destroy({ children: true });
  infoPanels.clear();
}

/* -------------------------------------------- */
/*  Show / hide on ALT                          */
/* -------------------------------------------- */

export function showAimButtons() {
  if (!canvas?.ready) return;
  ensureOverlay();

  // Info panels show for every token, regardless of selection.
  infoVisible = true;
  infoLayer.visible = true;
  buildInfoPanels();

  // Aim buttons require a selected aimer token.
  const aimer = canvas.tokens.controlled[0];
  if (!aimer) return;
  buttonsVisible = true;
  buttonLayer.visible = true;
  buildAimButtons(aimer);
}

function hideAimButtons() {
  buttonsVisible = false;
  if (buttonLayer) buttonLayer.visible = false;
  for (const btn of aimButtons.values()) btn.container.destroy({ children: true });
  aimButtons.clear();
  currentAimer = null;
  hideInfoPanels();
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

/** Register the visualisation + ALT-button hooks. Call once during `init`. */
export function registerAimOverlay() {
  Hooks.on("canvasReady", refreshAimOverlay);
  Hooks.on("updateToken", refreshAimOverlay);
  Hooks.on("deleteToken", refreshAimOverlay);
  Hooks.on("createToken", () => {
    refreshAimOverlay();
    if (buttonsVisible) {
      const aimer = getCurrentAimer();
      if (aimer) buildAimButtons(aimer);
    }
    if (infoVisible) buildInfoPanels();
  });
  Hooks.on("updateScene", refreshAimOverlay);

  // Rebuild buttons when the controlled token changes while ALT is held.
  Hooks.on("controlToken", () => {
    if (!buttonsVisible) return;
    const aimer = canvas.tokens.controlled[0];
    if (aimer) buildAimButtons(aimer);
    else hideAimButtons();
  });

  // End of turn settles any attack still parked as a miss. Sweeping every
  // combatant rather than working out who just finished keeps this independent
  // of turn bookkeeping: a pending record only exists for a few seconds, and
  // only for a duellist who rolled an aim-reduction attack this turn.
  // Active-GM only, so it happens once however many clients are connected.
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user.isGM || game.user.id !== game.users.activeGM?.id) return;
    if (!("turn" in changed) && !("round" in changed)) return;
    for (const combatant of combat.combatants) {
      await sweepPendingAim(combatant.actor);
    }
  });

  // Piggyback on Foundry's core "Highlight Objects" keybinding (ALT by default).
  // It fires `highlightObjects(active)` on press/release and already handles
  // key-repeat, focus-in-text-field, and window-blur for us.
  Hooks.on("highlightObjects", (active) => {
    if (active) showAimButtons();
    else hideAimButtons();
  });
}

/**
 * Ensure the three shared Aim macros exist in the "Redsteel Macros" folder.
 * They live here rather than in redsteel.mjs's SYSTEM_MACROS list so the Aim
 * feature stays self-contained, but they are made the same way and share its
 * rules: GM-only creation, never pinned to a hotbar slot, filed on the way past
 * if an older version left them loose in the root.
 */
export async function ensureAimMacros() {
  if (!game.user.isGM) return;

  const macros = [
    {
      name: "Add Aim Stack",
      command: "game.redsteel.addAimStack();",
      img: "icons/skills/targeting/target-strike-triple-orange.webp",
    },
    {
      name: "Remove Aim Stack",
      command: "game.redsteel.removeAimStack();",
      img: "icons/skills/targeting/crosshair-arrow-yellow.webp",
    },
    {
      name: "Consume Aim (Attack)",
      command: "game.redsteel.consumeAim();",
      img: "icons/skills/ranged/arrow-flying-broadhead-metal.webp",
    },
  ];

  return ensureSystemMacros(macros);
}
