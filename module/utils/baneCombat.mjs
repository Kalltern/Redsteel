import { BANE_TYPES, getActorBanes } from "../helpers/banes.mjs";
import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { critScoreToDegree } from "./combatSkillBonuses.mjs";

/**
 * Bane ("Metla") attack bonuses — Phase 4.
 *
 * The attacker's Bane picks (module/helpers/banes.mjs) grant a fixed bundle of
 * additive combat bonuses that apply only when the actual target turns out to
 * belong to one of the picked categories. Because the target is not known at
 * roll time, `getBaneProfile` returns the bonus bundle for the attacker alone;
 * the target match — and, since Phase 4, any shared Bane bonus granted by an
 * Odhalení slabiny ("Expose Weakness") mark from a different Ranger — is
 * resolved later per-target in applyDamage.mjs via `resolveBaneVariant`.
 */

const EMPTY_PROFILE = Object.freeze({
  active: false,
  keys: [],
  canMark: false,
  attack: 0,
  critChance: 0,
  critRange: 0,
  penetration: 0,
  critDamage: 0,
  critPen: 0,
  precision: 0,
  damageFormula: "1d6x",
  defense: 0,
  critDefense: 0,
});

/**
 * The bonus block that applies if the target turns out to be one of the
 * attacker's Banes. Fields are always present (0/empty when inactive) so
 * callers can read them unconditionally.
 * @param {Actor} actor
 * @returns {{active: boolean, keys: string[], attack: number, critChance: number,
 *   critRange: number, penetration: number, critDamage: number, critPen: number,
 *   precision: number, damageFormula: string}}
 */
export function getBaneProfile(actor) {
  const keys = [...getActorBanes(actor)];
  if (!keys.length) return { ...EMPTY_PROFILE };

  const profile = {
    active: true,
    keys,
    // Informational only — does NOT gate `active`. Odhalení slabiny can only
    // mark a target the Ranger already has a Bane on (see the
    // `expose_weakness` branch in RedsteelActiveEffect.applyEffect), so an
    // active profile can never have an empty `keys` array.
    canMark: actorHasSpecNode(actor, "ranger", "odhaleniSlabiny"),
    attack: 5,
    critChance: 1,
    critRange: 0,
    penetration: 1,
    critDamage: 0,
    critPen: 0,
    precision: 0,
    damageFormula: "1d6x",
    defense: 5,
    critDefense: 0,
  };

  if (actorHasSpecNode(actor, "ranger", "metlaPrubojnost")) {
    profile.penetration += 3;
  }
  if (actorHasSpecNode(actor, "ranger", "metlaKritRozsah")) {
    profile.critRange += 2;
  }
  if (actorHasSpecNode(actor, "ranger", "metlaKritZasah")) {
    profile.critChance += 3;
  }
  if (actorHasSpecNode(actor, "ranger", "metlaOvereni")) {
    profile.precision += 10;
  }
  if (actorHasSpecNode(actor, "ranger", "metlaKritZraneni")) {
    profile.critDamage += 5;
    profile.critPen += 5;
  }
  if (actorHasSpecNode(actor, "ranger", "metlaKritObrana")) {
    profile.critDefense += 3;
  }

  return profile;
}

/**
 * The combined attack/crit/penetration score used to rank competing Bane
 * profiles when more than one could apply to the same target (the rules say
 * bonuses never stack — only the larger single profile applies).
 * @param {ReturnType<typeof getBaneProfile>} profile
 * @returns {number}
 */
export function baneProfileScore(profile) {
  return (
    profile.attack +
    profile.critChance +
    profile.critRange +
    profile.penetration +
    profile.critDamage +
    profile.critPen +
    profile.precision
  );
}

/* -------------------------------------------- */
/*  Odhalení slabiny ("Expose Weakness")         */
/* -------------------------------------------- */

/**
 * Every actor in play that could be carrying an `expose_weakness` mark:
 * tokens on the current scene plus every combatant in the active combat,
 * deduplicated. Deliberately scoped this way rather than `game.actors`
 * wholesale, since a mark can only ever land on something actually on the
 * board.
 * @returns {Actor[]}
 */
function markedCandidates() {
  const actors = new Map();

  // `.contents` (a plain array), not the collection itself: relying on a
  // Foundry Collection's iterator here made the scene half silently yield
  // nothing, so marks were only ever found via the combatants half and the
  // whole feature appeared to work in combat and do nothing outside it.
  const sceneTokens =
    canvas.scene?.tokens?.contents ?? canvas.tokens?.placeables ?? [];
  for (const token of sceneTokens) {
    const tokenActor = token?.actor;
    if (tokenActor) actors.set(tokenActor.id, tokenActor);
  }

  const combatants = game.combat?.combatants?.contents ?? [];
  for (const combatant of combatants) {
    if (combatant?.actor) actors.set(combatant.actor.id, combatant.actor);
  }

  return [...actors.values()];
}

/**
 * Resolve an actor id that may belong either to a world actor or to an
 * unlinked token actor on the board. `game.actors.get` only knows the former,
 * so an unlinked NPC carrying its own Bane (or having placed a mark) would
 * otherwise silently resolve to nothing.
 * @param {string|null|undefined} actorId
 * @returns {Actor|null}
 */
function resolveActorById(actorId) {
  if (!actorId) return null;
  return (
    game.actors.get(actorId) ??
    markedCandidates().find((a) => a.id === actorId) ??
    null
  );
}

/**
 * Delete every `expose_weakness` effect placed by `actorId`. Pass `null` to
 * clear every `expose_weakness` effect in play regardless of who placed it
 * (used on combat end).
 * @param {string|null} actorId
 */
export async function clearMarksBy(actorId) {
  for (const targetActor of markedCandidates()) {
    const effects = targetActor.effects.filter((e) => {
      if (!e.statuses?.has("expose_weakness")) return false;
      if (actorId === null) return true;
      return e.getFlag("redsteel", "baneMarkedBy") === actorId;
    });
    if (!effects.length) continue;
    await targetActor.deleteEmbeddedDocuments(
      "ActiveEffect",
      effects.map((e) => e.id),
    );
  }
}

/**
 * True when `targetActor` carries an `expose_weakness` effect placed by
 * `attackerId`.
 * @param {Actor|null} targetActor
 * @param {string|null|undefined} attackerId
 * @returns {boolean}
 */
export function hasExposeWeaknessFrom(targetActor, attackerId) {
  if (!targetActor || !attackerId) return false;
  return targetActor.effects.some(
    (e) =>
      e.statuses?.has("expose_weakness") &&
      e.getFlag("redsteel", "baneMarkedBy") === attackerId,
  );
}

/**
 * Strip diacritics and normalize case/whitespace so manually-typed tags match
 * regardless of accents or capitalization (e.g. "Nemrtví" / "nemrtvi").
 * @param {*} s
 * @returns {string}
 */
const normalize = (s) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Every creature-type tag on an actor, normalized for case and diacritics.
 *
 * Tags are gathered from the union of two sources: the actor's own manually
 * tagged `system.baneTypes` field, and the `system.baneTypes` field of any
 * race Item it carries (so tagging a race once — e.g. "Zombie" — tags every
 * actor of that race without per-actor work). The race tag is purely
 * additive and never removes a tag the actor field supplied on its own.
 *
 * Exported because the tag set is the system's creature-type taxonomy, not
 * just Bane input: the Redsteel hotbar reads it to colour a portrait band.
 * @param {Actor|null} actor
 * @returns {Set<string>}
 */
export function getActorBaneTags(actor) {
  const rawSources = [actor?.system?.baneTypes];

  // `.contents`, not the Item Collection itself — iterating a Foundry
  // Collection directly with for...of has silently yielded nothing before
  // in this feature (see markedCandidates above).
  const raceItems = (actor?.items?.contents ?? []).filter(
    (i) => i.type === "race",
  );
  for (const raceItem of raceItems) {
    rawSources.push(raceItem.system?.baneTypes);
  }

  return new Set(
    rawSources
      .filter((raw) => raw)
      .flatMap((raw) =>
        String(raw)
          .split(",")
          .map((t) => normalize(t)),
      )
      .filter((t) => t.length),
  );
}

/**
 * Every Bane key that matches the target, compared against the registry key
 * alone. Tags are English registry keys only — not localized labels.
 * @param {Actor|null} targetActor
 * @param {string[]} baneKeys
 * @returns {string[]}
 */
function matchedBaneKeys(targetActor, baneKeys) {
  if (!targetActor || !Array.isArray(baneKeys) || !baneKeys.length) return [];

  const tokens = getActorBaneTags(targetActor);
  if (!tokens.size) return [];

  return baneKeys.filter((key) => {
    const def = BANE_TYPES[key];
    if (!def) return false;
    return tokens.has(normalize(key));
  });
}

/**
 * True if `targetActor` belongs to any category in `baneKeys`. Matches
 * against the union of the actor's own manual `system.baneTypes` tag field
 * and the `system.baneTypes` field of any race Item on the actor (English
 * registry keys only — no actor-name inference).
 * @param {Actor|null} targetActor
 * @param {string[]} baneKeys
 * @returns {boolean}
 */
export function actorMatchesBane(targetActor, baneKeys) {
  return matchedBaneKeys(targetActor, baneKeys).length > 0;
}

/**
 * Pure arithmetic that turns a Bane profile + the packet's stored dice/base
 * numbers into the finished result block for one attack. Moved verbatim out
 * of `buildBanePacket` (Phase 4) so the same computation can be re-run per
 * target against whichever profile actually applies (the attacker's own, or
 * a marking Ranger's).
 * @param {ReturnType<typeof getBaneProfile>} profile
 * @param {object} bane the stored packet (`attack.bane`)
 * @returns {{keys: string[], score: number, su: number, critSuccess: boolean,
 *   critThreshold: number, normal: object, critical: object, breakthrough: object}}
 */
export function computeBaneVariant(profile, bane) {
  const { dice, base } = bane;

  const baneSu = dice.su + profile.attack;
  const baneCritSuccess = dice.die <= dice.critThreshold + profile.critChance;

  const failedRecovery = dice.su < 0 && baneSu >= 0 ? 5 : 0;
  const baneCritScoreResult =
    dice.critScoreResult + profile.critRange + failedRecovery;
  const baneDegree = critScoreToDegree(baneCritScoreResult);

  const baneCritOptions = base.criticalOptions.map((o) => ({
    degree: o.degree,
    damage: o.damage + bane.damageBonus + profile.critDamage,
    penetration: o.penetration + profile.penetration + profile.critPen,
  }));
  const baneSelectedCrit = baneCritOptions[baneDegree] ?? baneCritOptions[0];

  return {
    keys: profile.keys,
    score: baneProfileScore(profile),
    su: baneSu,
    critSuccess: baneCritSuccess,
    critThreshold: dice.critThreshold + profile.critChance,
    precision: profile.precision,
    normal: {
      damage: base.damageTotal + bane.damageBonus,
      penetration: base.penetration + profile.penetration,
      halfDamage: base.halfDamage,
      penCap: base.penCap,
    },
    critical: {
      degree: baneDegree,
      result: baneCritScoreResult,
      damage: baneSelectedCrit.damage,
      penetration: baneSelectedCrit.penetration,
      halfDamage: base.halfDamage,
      penCap: base.penCap,
      options: baneCritOptions,
    },
    breakthrough: {
      // Weapons without breakthrough yield "" here; guard nullish and
      // non-numeric too, so a missing value can never become "NaN" damage.
      damage:
        Number.isFinite(Number(base.breakthroughRollResult)) &&
        String(base.breakthroughRollResult ?? "").trim() !== ""
          ? String(Number(base.breakthroughRollResult) + bane.damageBonus)
          : "",
      penetration: base.penetration + profile.penetration,
      halfDamage: base.halfDamage,
      penCap: base.penCap,
    },
  };
}

/**
 * The Bane variant that applies to one target, or null. Candidates are the
 * attacker's own Bane (when the target is tagged as one of their categories)
 * and the Bane of every Ranger who has personally Exposed this target via
 * Odhalení slabiny. Per the rules, these never stack — the strongest single
 * profile wins. Profiles are read live (not snapshotted at roll time): a mark
 * placed after the attack roll but before damage is applied still counts, and
 * a Ranger's spec changes mid-fight are always reflected.
 * @param {object|null} attack the stored attack flags (with `.bane`)
 * @param {Actor|null} targetActor
 * @returns {(ReturnType<typeof computeBaneVariant> & {viaMark?: boolean})|null}
 */
export function resolveBaneVariant(attack, targetActor) {
  if (!attack?.bane || !targetActor) return null;

  const candidates = [];

  const attacker = resolveActorById(attack.bane.attackerId);
  if (attacker) {
    const ownProfile = getBaneProfile(attacker);
    if (ownProfile.active && actorMatchesBane(targetActor, ownProfile.keys)) {
      candidates.push({ profile: ownProfile, viaMark: false });
    }
  }

  // `.contents` for the same reason as markedCandidates above.
  for (const effect of targetActor.effects?.contents ?? []) {
    if (!effect?.statuses?.has("expose_weakness")) continue;
    const markerId = effect.getFlag("redsteel", "baneMarkedBy");
    if (!markerId) continue;
    const marker = resolveActorById(markerId);
    if (!marker) continue;
    const markerProfile = getBaneProfile(marker);
    if (!markerProfile.active) continue;
    // The mark IS the qualification — no tag match required.
    candidates.push({ profile: markerProfile, viaMark: true });
  }

  if (!candidates.length) return null;

  let best = candidates[0];
  let bestScore = baneProfileScore(best.profile);
  for (const candidate of candidates.slice(1)) {
    const score = baneProfileScore(candidate.profile);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  const variant = computeBaneVariant(best.profile, attack.bane);
  if (best.viaMark) variant.viaMark = true;
  return variant;
}

/**
 * Every Bane variant that could apply to this attack, for card display. The
 * attacker's own Bane (when they have one) plus one entry per Ranger who
 * currently has a target Exposed — the card cannot know which target will be
 * picked, so it shows all of them and lets the reader match it up.
 * @param {object} bane the stored flags.attack.bane packet
 * @returns {{label: string, viaMark: boolean, variant: object}[]}
 */
export function getDisplayBaneVariants(bane) {
  if (!bane) return [];

  const results = [];
  const seenMarkerIds = new Set();

  if (bane.self) {
    const labels = (bane.self.keys ?? []).map((k) =>
      game.i18n.localize(BANE_TYPES[k]?.label ?? k),
    );
    results.push({
      label: labels.join(", "),
      viaMark: false,
      variant: bane.self,
    });
    seenMarkerIds.add(bane.attackerId);
  }

  for (const targetActor of markedCandidates()) {
    // `.contents` for the same reason as markedCandidates/resolveBaneVariant.
    for (const effect of targetActor.effects?.contents ?? []) {
      if (!effect?.statuses?.has("expose_weakness")) continue;
      const markerId = effect.getFlag("redsteel", "baneMarkedBy");
      if (!markerId || seenMarkerIds.has(markerId)) continue;
      const marker = resolveActorById(markerId);
      if (!marker) continue;
      const profile = getBaneProfile(marker);
      if (!profile.active) continue;

      seenMarkerIds.add(markerId);
      results.push({
        label: game.i18n.format("REDSTEEL.Banes.ExposedByLabel", {
          ranger: marker.name,
          target: targetActor.name,
        }),
        viaMark: true,
        variant: computeBaneVariant(profile, bane),
      });
    }
  }

  return results;
}

/**
 * Build the Bane ("Metla") packet for an attack: a second reading of the same
 * dice, never re-rolling the attack or crit-range roll, only re-bucketing
 * them under Bane bonuses. The only new randomness is the bonus damage die,
 * rolled exactly once. Shared by every attack chat card (basic attacks and
 * weapon abilities) so the packet shape and arithmetic never drift between
 * them.
 *
 * Since Phase 4 the packet stores the raw dice/base numbers rather than a
 * finished result: the applicable Bane profile (the attacker's own, or a
 * marking Ranger's) is only known once the target is known, so it is
 * resolved later per-target via `resolveBaneVariant`. The packet is still
 * built — even for an attacker with no active Bane profile of their own — as
 * long as *some* Odhalení slabiny mark exists in play, since that mark alone
 * can grant the shared bonus to any attacker.
 * @param {object} params
 * @param {Actor} params.actor
 * @param {Roll} params.attackRoll
 * @param {number} params.criticalSuccessThreshold
 * @param {number} params.critScoreResult
 * @param {{degree: number, damage: number, penetration: number}[]} params.criticalOptions
 * @param {number} params.damageTotal
 * @param {number} params.penetration
 * @param {string} params.breakthroughRollResult
 * @param {boolean|number} params.halfDamage
 * @param {boolean} params.penCap
 * @param {boolean} [params.baseCritSuccess] whether the attacker's own (non-Bane)
 *   roll was a critical success, stored so chat cards can flag when a Bane
 *   variant changes that outcome
 * @returns {Promise<{packet: object|null, roll: Roll|null}>}
 */
export async function buildBanePacket({
  actor,
  attackRoll,
  criticalSuccessThreshold,
  critScoreResult,
  criticalOptions,
  damageTotal,
  penetration,
  breakthroughRollResult,
  halfDamage,
  penCap,
  baseCritSuccess,
}) {
  const ownProfile = getBaneProfile(actor);
  const anyMarkInPlay = markedCandidates().some((a) =>
    a.effects.some((e) => e.statuses?.has("expose_weakness")),
  );
  if (!ownProfile.active && !anyMarkInPlay) return { packet: null, roll: null };

  const baneDamageRoll = new Roll(ownProfile.damageFormula);
  await baneDamageRoll.evaluate();
  const baneDamageExtra = Math.floor(baneDamageRoll.total ?? 0);

  const packet = {
    attackerId: actor.id,
    damageBonus: baneDamageExtra,
    baseCritSuccess: Boolean(baseCritSuccess),
    dice: {
      su: attackRoll.total,
      die: attackRoll.dice[0].total,
      critThreshold: criticalSuccessThreshold,
      critScoreResult,
    },
    base: {
      damageTotal,
      penetration,
      breakthroughRollResult,
      halfDamage,
      penCap,
      criticalOptions,
    },
    self: null,
  };

  packet.self = ownProfile.active
    ? computeBaneVariant(ownProfile, packet)
    : null;

  return { packet, roll: baneDamageRoll };
}
