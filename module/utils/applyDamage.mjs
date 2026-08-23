import {
  evaluateDmgVsArmor,
  applyToHp,
  getActiveShield,
} from "./combatSkillBonuses.mjs";
import {
  resolveEffectDefinition,
  isImmuneToEffect,
} from "./customConditions.mjs";
import { AIMED_PARTS, getBodyPartOverrides } from "./aimedStrike.mjs";
import { resolveBaneVariant } from "./baneCombat.mjs";
import { BANE_TYPES } from "../helpers/banes.mjs";
import {
  resolveAimOnDamage,
  grantAimOnDamage,
  getLacerationOffer,
} from "./aim.mjs";
import { attackerTokenIdFromMessage } from "./overwhelm.mjs";
import { gainBlood } from "./bloodPool.mjs";
import { combatantForActor } from "./combatants.mjs";

export const SOCKET = "system.redsteel";

/* -------------------------------------------- */
/*  Krvavý štít (Blood Shield perk)             */
/* -------------------------------------------- */

/**
 * Raise the Blood Shield if this actor has the perk and just lost Life. The
 * shield is a physical-absorbing pool worth half the Life lost (floored). It
 * stacks: several hits in one round add to the same pool. While a combat is
 * running its "until end of round" expiry is driven by the round-start hook;
 * out of combat it simply persists until rounds advance or it is cleared.
 * No-ops unless the perk node is unlocked and the loss halves to a non-zero
 * shield.
 *
 * @param {Actor} actor
 * @param {number} hpLost  Life removed by the hit (before − after).
 */
async function maybeApplyBloodShield(actor, hpLost) {
  if (!actor?.system?.specialisations?.bloodSchool?.nodes?.krvavyStit) return;

  const amount = Math.floor((Number(hpLost) || 0) / 2);
  if (amount <= 0) return;

  await game.redsteel.applyEffect(actor, "blood_shield", {
    stacks: amount,
    poolOverride: amount,
  });
}

/* -------------------------------------------- */
/*  Durability sacrifice                        */
/* -------------------------------------------- */

/**
 * Base damage removed per durability point sacrificed. Applies to the
 * final damage (after armor/resistances), i.e. what would otherwise hit
 * temporary health and health.
 */
export const BASE_DURABILITY_DAMAGE_REDUCTION = 15;

/**
 * Damage removed per durability point for this actor (and optionally the
 * specific item being sacrificed).
 *
 * Extension point: character skills that improve the trade can add to
 * `context.value` here, e.g.
 *   context.value += Number(actor.system.skills?.maintenance?.rating ?? 0);
 * External code can also adjust it via the "redsteelDurabilityReduction"
 * hook without touching this file.
 */
export function getDurabilityReductionPerPoint(actor, item = null) {
  const context = { value: BASE_DURABILITY_DAMAGE_REDUCTION, actor, item };

  Hooks.callAll("redsteelDurabilityReduction", context);

  return Math.max(0, Number(context.value) || 0);
}

/**
 * Items the actor can sacrifice durability from. Only characters may do
 * this, and only gear with durability remaining qualifies.
 */
export function getDurabilityItems(actor) {
  if (!actor || actor.type !== "character") return [];

  return actor.items
    .filter(
      (item) =>
        item.type === "gear" &&
        Number(item.system.armor?.durability ?? 0) > 0,
    )
    .sort((a, b) => Number(b.system.equipped) - Number(a.system.equipped));
}

/**
 * Evaluate an attack against an actor, optionally reducing the final
 * damage by sacrificed durability. The reduction applies after armor,
 * penetration and resistances — to the damage that would otherwise hit
 * temporary health / health.
 *
 * Returns the usual evaluateDmgVsArmor result plus:
 *  - durabilityReduction: damage removed by the sacrifice
 *  - durabilityPointsUsed: points actually consumed (never more than
 *    needed to zero the damage, so durability is not wasted on overkill)
 */
function evaluateAttackDamage({
  attack,
  selectedAttack,
  actor,
  durabilityPoints = 0,
  perPoint = 0,
  halfDamage,
}) {
  const damageProfile = attack.damageProfile ?? { expression: [] };
  const hp = actor.system.stats.health.value;
  const tempHp = actor.system.stats.temporaryHealth.value;
  const tempHpMagic = actor.system.stats.temporaryHealthMagic?.value ?? 0;
  // Absorb pool spent before armor. Null when the target has no shield, or
  // when the one it has does not match this packet (checked downstream).
  const activeShield = getActiveShield(actor);

  const base = evaluateDmgVsArmor({
    damage: selectedAttack.damage,
    penetration: selectedAttack.penetration ?? 0,
    damageProfile,
    // TODO(head damage): when the target has its helmet off
    // (flags.redsteel.helmetOff, set from the Armor panel on the Inventory
    // tab) and this attack is an aimed head hit that landed
    // (attack.aimedStrike?.part === "head" && attack.aimedStrike.su >= 0),
    // armor should be bypassed for this packet. Not implemented yet: the
    // toggle currently only drops the helmet's own archery/perception
    // penalties in documents/actor.mjs.
    armor: actor.system.armor,
    hp,
    tempHp,
    tempHpMagic,
    shield: activeShield,
    // Half damage applies if EITHER the Apply Damage dialog requested it (the
    // spell half-damage checkbox) OR the attack itself is inherently half (e.g.
    // Flurry's `@Half`). Must be `||`, not `??`: the dialog value is always a
    // boolean, so `false ?? …` would short-circuit and drop the attack's flag.
    halfDamage: Boolean(halfDamage) || Boolean(selectedAttack.halfDamage),
    penCap: selectedAttack.penCap ?? false,
  });

  // Fully mitigated damage, before it is split into temp HP / HP pools. Only
  // one of the two temp pools can have absorbed anything (a packet never falls
  // through from one to the other), but both are summed so the figure is right
  // whichever class this packet was.
  const damageBeforePools =
    base.tempHpLoss + (base.tempHpMagicLoss ?? 0) + base.finalDamage;

  const requestedPoints = Math.max(0, Math.floor(durabilityPoints));
  const pointsUsed =
    perPoint > 0 && requestedPoints > 0
      ? Math.min(requestedPoints, Math.ceil(damageBeforePools / perPoint))
      : 0;
  const durabilityReduction = Math.min(
    damageBeforePools,
    pointsUsed * perPoint,
  );

  if (!durabilityReduction) {
    return {
      ...base,
      activeShield,
      durabilityReduction: 0,
      durabilityPointsUsed: 0,
    };
  }

  return {
    shieldLoss: base.shieldLoss,
    shieldPoolSpent: base.shieldPoolSpent,
    shieldBroke: base.shieldBroke,
    activeShield,
    durabilityReduction,
    durabilityPointsUsed: pointsUsed,
    // Re-split the reduced damage into the same pool the first pass chose, so
    // a durability sacrifice cannot move a magical hit onto the physical ward.
    ...applyToHp(
      damageBeforePools - durabilityReduction,
      hp,
      tempHp,
      tempHpMagic,
      base.damageClass,
    ),
  };
}

/**
 * Pick the attack packet that applies to one target: the Bane variant that
 * applies to it (its own Bane match, or the strongest Odhalení slabiny mark
 * placed on it — see `resolveBaneVariant`), otherwise the normal one. This is
 * what lets a single roll hit a mixed group correctly (e.g. a cleave into an
 * undead and a human) without a second roll or a second chat card.
 */
function resolveAttackForTarget(attack, actor) {
  const variant = resolveBaneVariant(attack, actor);
  if (variant) return { ...attack, ...variant };
  return attack;
}

/**
 * The critical degree to use for one target. A Bane target crits on its own
 * shifted degree, because its crit-range bonus was already applied to the same
 * d20 at roll time. An explicit GM override of the degree selector outranks
 * that and applies to every target.
 *
 * The override signal is explicit (`overridden`, set by the dialog the moment
 * the GM touches the degree radio group), not inferred by comparing the
 * selected degree against the base packet's degree — that inference broke on
 * cards whose base packet carries no `degree` at all.
 *
 * Both the preview dialog and the GM apply call this, so the number shown can
 * never disagree with the number applied.
 */
function resolveDegreeForTarget(effAttack, selectedDegree, overridden) {
  if (overridden) return selectedDegree;
  return effAttack.critical?.degree ?? selectedDegree;
}

/* -------------------------------------------- */
/*  Krvavý úder (Cordinas IV)                   */
/* -------------------------------------------- */

/** Doctrine rank at which both Blood Strike features come online. */
const CORDINAS_BLOOD_STRIKE_RANK = 4;

/** Life drawn from the Blood Reserve to force a wound open. */
export const OPEN_WOUND_BLOOD_COST = 3;

/* -------------------------------------------- */
/*  Tržná rána (Laceration, Sword Dancer)       */
/* -------------------------------------------- */

/** Stamina burned per Aim stack sacrificed into the wound. */
export const LACERATION_STAMINA_PER_AIM = 2;
/** Extra Bleeding when the sacrificing blow was a Sneak Attack. */
export const LACERATION_SNEAK_BLEEDS = 2;

/**
 * The actor who made this attack — whose Blood Reserve pays for Open Wound and
 * who earns the Blood Strike charge on a kill. Resolved from the card's speaker
 * (token first, then actor), which every attack path fills in.
 */
function getAttackingActor(message) {
  return ChatMessage.getSpeakerActor(message?.speaker ?? {}) ?? null;
}

/** Does this actor hold Cordinas at the rank the Blood Strike features need? */
function hasBloodStrikeDoctrine(actor) {
  return (
    Number(actor?.system?.doctrines?.cordinas?.value ?? 0) >=
    CORDINAS_BLOOD_STRIKE_RANK
  );
}

/* -------------------------------------------- */
/*  Blood harvest (Cordinas I)                  */
/* -------------------------------------------- */

/** Doctrine rank at which wounds start feeding the attacker's Reserve. */
const CORDINAS_BLOOD_HARVEST_RANK = 1;

/** Life into the Reserve per wounded target, and again per target killed. */
const BLOOD_HARVEST_PER_TARGET = 1;

/** Only an edge or a point spills blood the doctrine can gather. */
const BLOOD_HARVEST_DAMAGE_TYPES = new Set(["slash", "piercing"]);

/** Does this actor hold Cordinas at all? */
function hasBloodHarvestDoctrine(actor) {
  return (
    Number(actor?.system?.doctrines?.cordinas?.value ?? 0) >=
    CORDINAS_BLOOD_HARVEST_RANK
  );
}

/**
 * Can this card's damage feed the Reserve? It must cut or pierce, and it must
 * be a weapon or ability attack — a spell is blood the doctrine cannot claim,
 * so a spell card is excluded even on the (rare) chance it carries a kinetic
 * damage type. Read from the base packet's own damageProfile, the same
 * expression evaluateAttackDamage resolves the hit with; a Bane variant swaps
 * damage and penetration, never the damage types.
 */
function isBloodHarvestAttack(message, attack) {
  if (message?.flags?.redsteel?.spellSchool) return false;
  const expression = attack?.damageProfile?.expression ?? [];
  return expression.some((token) =>
    BLOOD_HARVEST_DAMAGE_TYPES.has(String(token ?? "").toLowerCase()),
  );
}

/* -------------------------------------------- */
/*  Apply Damage                                */
/* -------------------------------------------- */

export async function handleApplyDamage(messageId) {
  const message = game.messages.get(messageId);
  if (!message?.flags?.attack) return;

  const checkTargetsAndContinue = () => {
    const targets = Array.from(game.user.targets);
    if (!targets.length) {
      ui.notifications.warn("Please select at least one target.");
      return false;
    }
    openDamageSelectionDialog(message, targets);
    return true;
  };

  // Initial check
  if (!Array.from(game.user.targets).length) {
    new Dialog({
      title: "No Targets Selected",
      content: "<p>Please select one or more targets, then press OK.</p>",
      buttons: {
        ok: {
          label: "OK",
          callback: checkTargetsAndContinue,
        },
      },
      default: "ok",
    }).render(true);
    return;
  }

  // Targets already selected
  checkTargetsAndContinue();
}

async function applyDamageToTargets(
  message,
  targets,
  mode,
  selectedEffects,
  criticalDegree = null,
  durabilitySpend = {},
  halfDamage = false,
  degreeOverridden = false,
  openWound = {},
  laceration = {},
) {
  const data = {
    type: "applyDamage",
    messageId: message.id,
    mode: mode,
    criticalDegree,
    sceneId: canvas.scene.id,
    targetIds: targets.map((t) => t.id),
    selectedEffects: selectedEffects,
    durabilitySpend,
    halfDamage,
    degreeOverridden,
    openWound,
    laceration,
  };

  if (game.user.isGM) {
    await applyDamageAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
  }
}

/**
 * Resolve how many Bleeding stacks an attack applies, from the stored bleed
 * data (chance, the original attack roll, sharp-weapon extra stacks, crit
 * stacks and the auto flag) and the target's own bleed modifiers. Shared by the
 * Apply Damage preview and the GM apply so the count shown always matches the
 * count applied — previously the preview omitted the sharp-weapon extra stacks.
 */
function resolveBleedStacks(effect, { targetMod = 0, stackMod = 0, mode } = {}) {
  const crit = effect.critStacks ?? 0;
  const normalStacks = effect.normalStacks ?? 0;

  let stacks;
  if (effect.auto) {
    // Auto bleed is guaranteed — chance/resistance don't apply.
    stacks = normalStacks;
  } else {
    // Each gathered bleed counts as 100% chance: the stored `chance` already
    // encodes "full stacks ×100 + remainder" (e.g. 120%). Deduct the target's
    // bleed resistance (targetMod, negative for resistance), then resolve
    // against the original attack roll.
    const baseChance = effect.chance ?? 0;
    const roll = effect.roll ?? 100;

    const resolve = (chancePct) => {
      if (chancePct <= 0) return 0;
      let s = Math.floor(chancePct / 100);
      const remainder = chancePct % 100;
      if (remainder > 0 && roll <= remainder) s += 1;
      return s;
    };

    const resistedRegular = resolve(baseChance + targetMod);
    // Extra stacks rolled separately (e.g. sharp-weapon bleed) that aren't
    // represented in `chance`.
    const extraStacks = Math.max(0, normalStacks - resolve(baseChance));
    stacks = resistedRegular + extraStacks;
  }

  if (mode === "critical") stacks += crit;
  stacks += stackMod;
  // Guaranteed stacks from a Blood Strike charge (Krvavý úder): added after the
  // chance resolution and outside `targetMod`, so neither a failed roll nor the
  // target's bleed resistance can take them away. Outright immunity still does —
  // that is gated one level up, before this is ever called.
  stacks += Number(effect.bonusStacks) || 0;
  return Math.max(0, stacks);
}

export async function applyDamageAsGM(data) {
  const { messageId, mode, targetIds, sceneId, selectedEffects } = data;
  const durabilitySpend = data.durabilitySpend ?? {};
  const halfDamage = data.halfDamage ?? false;
  const degreeOverridden = data.degreeOverridden ?? false;
  const openWound = data.openWound ?? {};
  const lacerationRequest = data.laceration ?? {};
  const message = game.messages.get(messageId);

  const attack = message.flags.attack;
  const castingContext = getCastingContext(message);
  const selectedCriticalDegree = Number.isFinite(Number(data.criticalDegree))
    ? Number(data.criticalDegree)
    : (attack.critical?.degree ?? null);
  const suggestedCriticalDegree = Number.isFinite(
    Number(attack.critical?.degree),
  )
    ? Number(attack.critical.degree)
    : selectedCriticalDegree;

  const scene = game.scenes.get(sceneId);
  const combat = game.combat;
  const criticalOverrideRows = [];
  // Krvavý úder (Cordinas IV) — the attacker pays for Open Wound out of their
  // Blood Reserve and earns the Blood Strike charge if this attack kills a
  // bleeding target. Both are re-checked here rather than trusted from the
  // dialog: the payload comes off the socket from another client.
  const attacker = getAttackingActor(message);
  const attackerHasBloodStrike = hasBloodStrikeDoctrine(attacker);
  let bloodStrikeEarned = false;
  const openWoundVictims = [];
  // Tržná rána — tokenId → Aim actually sacrificed, handed to resolveAimOnDamage
  // once the loop is done so it can charge the hit nothing further.
  const lacerationSpent = {};
  const lacerationVictims = [];
  // Cordinas I — every wounded target feeds the attacker's Blood Reserve, and
  // a target that dies feeds it once more. Counted per target here, banked
  // once after the loop.
  const bloodHarvestActive =
    hasBloodHarvestDoctrine(attacker) && isBloodHarvestAttack(message, attack);
  let bloodHarvest = 0;
  for (const tokenId of targetIds) {
    const tokenDoc = scene.tokens.get(tokenId);
    if (!tokenDoc) {
      console.warn(`GM: Token ${tokenId} not found in scene ${sceneId}`);
      continue;
    }

    const actor = tokenDoc.actor;
    if (!actor) continue;

    // Bane-aware packet: a target matching the attacker's Bane uses the
    // Bane variant of normal/critical/breakthrough instead of the base one.
    // If the GM did not explicitly override the suggested critical degree,
    // a Bane target crits on its own (shifted) degree rather than the
    // suggested one.
    const effAttack = resolveAttackForTarget(attack, actor);
    const degreeForTarget = resolveDegreeForTarget(
      effAttack,
      selectedCriticalDegree,
      degreeOverridden,
    );
    const selectedAttack =
      mode === "critical"
        ? getCriticalAttackData(effAttack, degreeForTarget)
        : effAttack[mode];

    // Resolve the requested durability sacrifice against the live item
    // state — the dialog preview may be stale by the time this runs.
    const spend = durabilitySpend[tokenId];
    let durabilityItem = null;
    let durabilityPoints = 0;
    let perPoint = 0;

    if (spend?.itemId && actor.type === "character") {
      durabilityItem = actor.items.get(spend.itemId);
      const available = Number(
        durabilityItem?.system.armor?.durability ?? 0,
      );
      durabilityPoints = Math.min(
        Math.max(0, Math.floor(Number(spend.points) || 0)),
        available,
      );
      if (durabilityPoints > 0) {
        perPoint = getDurabilityReductionPerPoint(actor, durabilityItem);
      }
    }

    const result = evaluateAttackDamage({
      attack,
      selectedAttack,
      actor,
      durabilityPoints,
      perPoint,
      halfDamage,
    });

    if (
      mode === "critical" &&
      selectedCriticalDegree !== null &&
      selectedCriticalDegree !== suggestedCriticalDegree
    ) {
      const suggestedAttack = getCriticalAttackData(
        effAttack,
        suggestedCriticalDegree,
      );
      const suggestedResult = evaluateAttackDamage({
        attack: effAttack,
        selectedAttack: suggestedAttack,
        actor,
        halfDamage,
      });
      // Compare without durability so both columns measure the same thing
      const selectedBaseResult = evaluateAttackDamage({
        attack: effAttack,
        selectedAttack,
        actor,
        halfDamage,
      });

      criticalOverrideRows.push({
        targetName: actor.name,
        suggestedDamage: suggestedResult.finalDamage,
        selectedDamage: selectedBaseResult.finalDamage,
      });
    }

    const author = [message.author, message.user, message.userId]
      .map((candidate) =>
        typeof candidate === "string" ? game.users.get(candidate) : candidate,
      )
      .find((user) => user?.name);
    const authorIsGM = author?.isGM;

    const durabilityNote =
      result.durabilityPointsUsed > 0
        ? ` (${result.durabilityReduction} damage absorbed by ${result.durabilityPointsUsed} durability from ${durabilityItem?.name})`
        : "";

    if (game.user.isGM && author && !authorIsGM) {
      ui.notifications.info(
        `${author.name} applied ${result.totalHpLoss} damage to ${actor.name}${durabilityNote}`,
      );
    }
    console.log(
      `GM: Applying ${result.totalHpLoss} damage to ${actor.name}. New HP: ${result.newHp}${durabilityNote}`,
    );

    const hpBeforeDamage = Number(actor.system.stats.health.value) || 0;
    // Read before the hit lands: the Blood Strike charge is earned for killing
    // someone who was *already* bleeding, not someone this very attack made
    // bleed a moment later in the effects loop below.
    const wasBleedingBeforeHit = actor.statuses.has("bleed");

    await actor.update({
      "system.stats.temporaryHealth.value": Number(result.newTempHp),
      "system.stats.temporaryHealthMagic.value": Number(
        result.newTempHpMagic ?? actor.system.stats.temporaryHealthMagic?.value ?? 0,
      ),
      "system.stats.health.value": Number(result.newHp),
    });

    // Drain the absorb pool, and delete the shield once it is spent. The pool
    // lives in `stacks`, mirrored to the token counter.
    if (result.activeShield && result.shieldPoolSpent > 0) {
      const shieldEffect = result.activeShield.effect;
      const remaining = Math.max(
        0,
        result.activeShield.value - result.shieldPoolSpent,
      );
      if (remaining <= 0) {
        await shieldEffect.delete();
        ui.notifications.info(`${actor.name}: ${shieldEffect.name} broke.`);
      } else {
        await shieldEffect.update({
          "flags.redsteel.stacks": remaining,
          "flags.statuscounter.value": remaining,
        });
      }
    }

    // Krvavý štít (Blood Shield perk): losing Life to a hit raises a physical
    // shield worth half the Life just lost, until the end of the round. Applied
    // after the drain above so it never touches the shield that soaked this hit.
    await maybeApplyBloodShield(actor, hpBeforeDamage - Number(result.newHp));

    if (durabilityItem && result.durabilityPointsUsed > 0) {
      const remaining =
        Number(durabilityItem.system.armor.durability) -
        result.durabilityPointsUsed;
      await durabilityItem.update({
        "system.armor.durability": Math.max(0, remaining),
      });
    }

    // NPC body-part overrides for the aimed location (e.g. extra bleed on exposed limbs).
    const aimedStrikeForEffects = attack.aimedStrike;
    const aimedHitForEffects = aimedStrikeForEffects?.su >= 0 && aimedStrikeForEffects?.part;
    const npcOverrides = aimedHitForEffects
      ? getBodyPartOverrides(actor, aimedStrikeForEffects.part)
      : { armorMod: 0, staggerMod: 0, bleedMod: 0, precisionMod: 0 };

    const effects = message.flags.attack.effects || {};
    // Whether this hit drew blood on its own — Open Wound below only pays out
    // when it did not.
    let bleedLanded = false;
    for (const [name, effect] of Object.entries(effects)) {
      // NOTE: the Bane ("Metla") Ověření bonus is deliberately NOT applied
      // here. Below, `targetMod` is only read again inside the `bleed` branch;
      // every other effect is gated purely on `allowedEffectsForTarget`, the
      // checkbox state the GM submitted. Success for precision is therefore
      // decided in openDamageSelectionDialog's preview (which is where the
      // bonus is added, and which sets each checkbox's default), not here.
      // Adding it to `targetMod` again would be a no-op that reads as though
      // this path enforced the chance.
      const targetMod = actor.system.effectMods?.[name]?.applyChance || 0;
      const stackMod = actor.system.effectMods?.[name]?.stackMod || 0;

      const allowedEffectsForTarget = selectedEffects?.[tokenId] || [];

      if (!allowedEffectsForTarget.includes(name)) continue;

      if (isImmuneToEffect(actor, name)) {
        console.log(`GM: ${actor.name} is immune to ${name} — skipped`);
        continue;
      }

      // Magický štít "chrání před některými magickými efekty": while it holds,
      // effects riding a magical-class packet do not land. Read from the
      // shield resolved before the pool was drained, so a shield that broke on
      // this very hit still blocks its rider.
      if (
        result.activeShield?.config?.blocksMagicEffects &&
        result.damageClass === "magical"
      ) {
        console.log(
          `GM: ${actor.name}'s Magic Shield blocked ${name} (magical source)`,
        );
        continue;
      }

      // Bleeding requires an actual wound: a hit fully absorbed by temporary
      // health (no health damage) never bleeds.
      if (name === "bleed" && result.hpLoss <= 0) continue;

      let stacks = 1;

      if (name === "bleed") {
        const bleedMod = aimedHitForEffects ? npcOverrides.bleedMod : 0;
        stacks = resolveBleedStacks(effect, { targetMod: targetMod + bleedMod, stackMod, mode });
      } else {
        stacks += stackMod;
      }

      if (stacks <= 0) continue;
      if (name === "bleed") bleedLanded = true;
      const applied = await applyEffectToActor(
        actor,
        name,
        stacks,
        castingContext,
      );

      // Wounding Impale: Impale applies the Rooted effect; carry the
      // pre-computed Bleeding count (set in getEffectRolls) onto that Root so it
      // fires when the Root is removed (see effects.mjs _onDelete). Only
      // Impale-sourced Roots carry the tag.
      if (name === "root" && applied) {
        const bleeds = Number(effect.bleedStacks) || 0;
        if (bleeds > 0) {
          await applied.setFlag("redsteel", "impaleBleeds", bleeds);
        }
      }
    }

    // Aimed Strike — apply body part effect when the aimed location was hit (SU ≥ 0).
    const aimedStrike = attack.aimedStrike;
    if (aimedStrike?.part && aimedStrike.su >= 0) {
      const partDef = AIMED_PARTS[aimedStrike.part];
      if (partDef?.effectId) {
        if (!isImmuneToEffect(actor, partDef.effectId)) {
          await applyEffectToActor(actor, partDef.effectId, 1, castingContext);
        }
      }
    }

    // Tržná rána (Laceration, Sword Dancer) — the duellist wrenches the wound
    // wider by giving up the aim the blow was lined up with: one Bleeding per
    // Aim sacrificed, two more when it was a Sneak Attack, at
    // LACERATION_STAMINA_PER_AIM Stamina a stack. Everything is re-checked here
    // rather than trusted: the payload arrived over the socket from whichever
    // client opened the dialog.
    const lacerationAsked = Math.max(
      0,
      Math.round(Number(lacerationRequest?.[tokenId]) || 0),
    );
    if (lacerationAsked > 0) {
      const offer = getLacerationOffer(attacker, tokenId);
      const stamina = Number(attacker?.system?.stats?.stamina?.value) || 0;
      const affordable = Math.floor(stamina / LACERATION_STAMINA_PER_AIM);
      const spend = Math.min(lacerationAsked, offer.stacks, affordable);

      if (!offer.available) {
        ui.notifications.warn(
          `Laceration: ${attacker?.name ?? "the attacker"} no longer holds the Aim this attack was lined up with — nothing sacrificed.`,
        );
      } else if (result.hpLoss <= 0) {
        ui.notifications.warn(
          `Laceration: the hit on ${actor.name} did no Life damage — no wound to tear open, no Aim sacrificed.`,
        );
      } else if (isImmuneToEffect(actor, "bleed")) {
        ui.notifications.warn(
          `Laceration: ${actor.name} is immune to Bleeding — no Aim sacrificed.`,
        );
      } else if (spend <= 0) {
        ui.notifications.warn(
          `Laceration: ${attacker.name} has ${stamina} Stamina — ${LACERATION_STAMINA_PER_AIM} is needed per Aim sacrificed.`,
        );
      } else {
        // The Sneak Attack bonus rides on having sacrificed at all, not on how
        // much: one stack given up buys it just as well as four.
        const stacks = spend + (offer.sneak ? LACERATION_SNEAK_BLEEDS : 0);
        await attacker.update({
          "system.stats.stamina.value":
            stamina - spend * LACERATION_STAMINA_PER_AIM,
        });
        await applyEffectToActor(actor, "bleed", stacks, castingContext);
        lacerationSpent[tokenId] = spend;
        lacerationVictims.push({ name: actor.name, spend, stacks });
      }
    }

    // Otevřená rána (Open Wound) — the attacker tears the wound open by hand,
    // paying OPEN_WOUND_BLOOD_COST Life out of their Blood Reserve for one
    // Bleeding. Only on a hit that failed to draw blood by itself, and only on
    // a hit that actually reached Life: a blow soaked entirely by temporary
    // health leaves nothing to open, same rule the bleed effect follows above.
    if (openWound?.[tokenId] && attackerHasBloodStrike) {
      const reserve = Number(attacker?.system?.stats?.bloodPool?.value) || 0;

      if (bleedLanded) {
        ui.notifications.warn(
          `Open Wound: ${actor.name} is already bleeding from this hit — no blood spent.`,
        );
      } else if (result.hpLoss <= 0) {
        ui.notifications.warn(
          `Open Wound: the hit on ${actor.name} did no Life damage — no wound to open, no blood spent.`,
        );
      } else if (isImmuneToEffect(actor, "bleed")) {
        ui.notifications.warn(
          `Open Wound: ${actor.name} is immune to Bleeding — no blood spent.`,
        );
      } else if (reserve < OPEN_WOUND_BLOOD_COST) {
        ui.notifications.warn(
          `Open Wound: ${attacker.name} has only ${reserve} in the Blood Reserve — ${OPEN_WOUND_BLOOD_COST} needed.`,
        );
      } else {
        await attacker.update({
          "system.stats.bloodPool.value": reserve - OPEN_WOUND_BLOOD_COST,
        });
        await applyEffectToActor(actor, "bleed", 1, castingContext);
        openWoundVictims.push(actor.name);
      }
    }

    // Krvavý úder — killing a target that was already bleeding arms one
    // guaranteed Bleeding on the attacker's next attack. "Killed" is the drop
    // to 0 Life: an NPC dies, a character starts Dying. Damage from the bleed
    // itself never reaches here — this is the attack path only, as the rule
    // requires (Zásah).
    if (
      attackerHasBloodStrike &&
      wasBleedingBeforeHit &&
      hpBeforeDamage > 0 &&
      Number(result.newHp) <= 0
    ) {
      bloodStrikeEarned = true;
    }

    // Cordinas I — the wound has to reach Life: a blow soaked entirely by
    // temporary health or a shield spills no blood, the same line Bleeding and
    // Open Wound draw. Killing the target (the drop to 0 Life) pays once more,
    // per target, since `hpLoss` is already 0 for anyone hit at 0 Life.
    if (bloodHarvestActive && result.hpLoss > 0) {
      bloodHarvest += BLOOD_HARVEST_PER_TARGET;
      if (Number(result.newHp) <= 0) bloodHarvest += BLOOD_HARVEST_PER_TARGET;
    }

    const combatant = combat?.combatants.find((c) => c.tokenId === tokenDoc.id);
    await handlePostDamageStatus({ actor, combatant });
  }

  if (lacerationVictims.length) {
    const totalAim = lacerationVictims.reduce((sum, v) => sum + v.spend, 0);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div style="text-align:center; color:#a01818;">${game.i18n.format(
        "REDSTEEL.Laceration.Applied",
        {
          name: attacker.name,
          targets: lacerationVictims
            .map((v) => `${v.name} (${v.stacks})`)
            .join(", "),
          aim: totalAim,
          stamina: totalAim * LACERATION_STAMINA_PER_AIM,
        },
      )}</div>`,
    });
  }

  if (openWoundVictims.length) {
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div style="text-align:center; color:#a01818;">${game.i18n.format(
        "REDSTEEL.BloodStrike.OpenWoundApplied",
        {
          name: attacker.name,
          targets: openWoundVictims.join(", "),
          cost: OPEN_WOUND_BLOOD_COST * openWoundVictims.length,
        },
      )}</div>`,
    });
  }

  // Cordinas I — banked after the loop so the Open Wound spends above are
  // already settled, and clamped to the Reserve's capacity by gainBlood (a
  // full Reserve, or an actor with none at all, simply gains nothing).
  if (bloodHarvest > 0) {
    const gained = await gainBlood(attacker, bloodHarvest);
    if (gained > 0) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: attacker }),
        content: `<div style="text-align:center; color:#a01818;">${game.i18n.format(
          "REDSTEEL.BloodHarvest.Gained",
          { name: attacker.name, amount: gained },
        )}</div>`,
      });
    }
  }

  // Applied once even when several bleeding targets went down: the charge is a
  // single guaranteed Bleeding on the next attack, not one per corpse.
  if (bloodStrikeEarned && !attacker.statuses.has("blood_strike")) {
    await game.redsteel.applyEffect(attacker, "blood_strike");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: attacker }),
      content: `<div style="text-align:center; color:#a01818;">${game.i18n.format(
        "REDSTEEL.BloodStrike.ChargeEarned",
        { name: attacker.name },
      )}</div>`,
    });
  }

  if (criticalOverrideRows.length) {
    await notifyCriticalDegreeOverride({
      message,
      attack,
      suggestedDegree: suggestedCriticalDegree,
      selectedDegree: selectedCriticalDegree,
      rows: criticalOverrideRows,
    });
  }

  // Damage landing is the only reliable "the attack hit" signal in the system,
  // so this is where an aim-reduction attack finds out what it cost: one stack
  // normally, none on a critical. Attacks that never get here are settled as
  // misses by the end-of-turn sweep in utils/aim.mjs.
  // Aim sacrificed to Laceration above is the whole price of the hit, so it
  // travels along and stops the usual stack being taken on top of it.
  await resolveAimOnDamage(attacker, targetIds, mode, {
    laceration: lacerationSpent,
  });

  // …and the same signal pays Perfect Opening, which hands Aim back instead of
  // spending it: two on a hit, three on a critical. Runs second so the line
  // above has already settled whatever the attack cost, and this stacks on top
  // of the remainder rather than being overwritten by it.
  await grantAimOnDamage({
    actor: attacker,
    tokenId: attackerTokenIdFromMessage(message),
    sceneId,
    targetIds,
    mode,
    abilityKey: message.flags?.redsteel?.abilityKey ?? null,
    abilityName: message.flags?.redsteel?.abilityName ?? null,
    message,
  });
}

function openDamageSelectionDialog(message, targets) {
  const attack = message.flags.attack;
  const effects = attack.effects || {};
  let mode = "normal";
  let halfDamage = false;
  let criticalDegree = attack.critical?.degree ?? 0;
  let degreeTouched = false;
  const hasCritical = attack.critical !== "" && attack.critical !== undefined;
  const hasBreakthrough =
    attack.breakthrough?.damage !== "" &&
    attack.breakthrough?.damage !== undefined;
  const criticalOptions = getCriticalOptions(attack);

  // tokenId -> { itemId, points } for targets sacrificing durability
  const durabilityState = {};
  const durabilityTargets = targets
    .map((t) => ({ token: t, actor: t.actor, items: getDurabilityItems(t.actor) }))
    .filter((entry) => entry.items.length > 0);

  // Otevřená rána (Open Wound, Cordinas IV) — offered per target to whoever is
  // applying the attack, but paid for out of the attacker's Blood Reserve, so
  // it is only offered to someone who owns that actor. The option shows up for
  // any hit that failed to draw blood, including attacks that never had a bleed
  // chance to begin with (a mace, a stun-only ability).
  const openWoundActor = getAttackingActor(message);
  const canOpenWounds =
    hasBloodStrikeDoctrine(openWoundActor) && openWoundActor.isOwner;
  // tokenId -> true for targets the attacker is paying to open up
  const openWoundState = {};
  const openWoundReserve = () =>
    Number(openWoundActor?.system?.stats?.bloodPool?.value) || 0;
  const openWoundSpent = () =>
    Object.values(openWoundState).filter(Boolean).length *
    OPEN_WOUND_BLOOD_COST;

  // Tržná rána (Laceration) — offered only on the target this attack was aimed
  // at, and only to someone who owns the attacker: it is their Aim and their
  // Stamina being spent. tokenId -> Aim stacks to sacrifice.
  const lacerationActor = getAttackingActor(message);
  const canLacerate = !!lacerationActor?.isOwner;
  const lacerationState = {};
  const lacerationStamina = () =>
    Number(lacerationActor?.system?.stats?.stamina?.value) || 0;
  const lacerationAimSpent = () =>
    Object.values(lacerationState).reduce((sum, n) => sum + n, 0);

  const getSelectedAttack = (targetActor) => {
    const effAttack = resolveAttackForTarget(attack, targetActor);
    return mode === "critical"
      ? getCriticalAttackData(
          effAttack,
          resolveDegreeForTarget(effAttack, criticalDegree, degreeTouched),
        )
      : effAttack[mode];
  };

  const renderPreview = () =>
    targets
      .map((t) => {
        const effAttack = resolveAttackForTarget(attack, t.actor);
        const selectedAttack = getSelectedAttack(t.actor);
        console.log("attack[mode]:", selectedAttack);

        const baneVariant = resolveBaneVariant(attack, t.actor);
        const matchedBaneLabels = baneVariant
          ? baneVariant.viaMark
            ? [game.i18n.localize("REDSTEEL.Banes.ExposedLabel")]
            : (baneVariant.keys ?? []).map((k) =>
                game.i18n.localize(BANE_TYPES[k]?.label ?? k),
              )
          : [];
        const baneMarker = matchedBaneLabels.length
          ? ` <span style="color:#c8a84b; font-size:12px;">(${game.i18n.localize("REDSTEEL.Banes.Label")}: ${matchedBaneLabels.join(", ")})</span>`
          : "";
        const baneCritNote =
          baneVariant && baneVariant.critSuccess !== attack.bane?.baseCritSuccess
            ? ` <span style="color:#c8a84b; font-size:12px;">(${game.i18n.localize(
                baneVariant.critSuccess
                  ? "REDSTEEL.Banes.CritOnlyWithBane"
                  : "REDSTEEL.Banes.CritLostWithBane",
              )})</span>`
            : "";

        const spend = durabilityState[t.id];
        const perPoint = spend?.itemId
          ? getDurabilityReductionPerPoint(t.actor, t.actor.items.get(spend.itemId))
          : 0;
        const result = evaluateAttackDamage({
          attack: effAttack,
          selectedAttack,
          actor: t.actor,
          durabilityPoints: spend?.points ?? 0,
          perPoint,
          halfDamage,
        });

        const durabilityNote = result.durabilityReduction
          ? ` <em>(−${result.durabilityReduction} from ${result.durabilityPointsUsed} durability)</em>`
          : "";

        const gmPreview = game.user.isGM
          ? `<div style="margin-left:15px;">
               Remaining: <strong>${result.newHp}/${t.actor.system.stats.health.max} HP</strong>,
               ${result.newTempHp} temp HP
             </div>`
          : "";

        // NPC body-part overrides adjust effect chances for the aimed location.
        const aimedStrike = attack.aimedStrike;
        const aimedHit = aimedStrike?.su >= 0 && aimedStrike?.part;
        const aimedPart = aimedHit ? aimedStrike.part : null;
        const npcOverrides = getBodyPartOverrides(t.actor, aimedPart);

        // Set by the bleed branch below; stays false when the packet carries no
        // bleed at all, which is exactly when Open Wound is most wanted.
        let bleedLanded = false;

        const effectPreview = Object.entries(effects)
          .map(([name, effect]) => {
            if (isImmuneToEffect(t.actor, name)) {
              return `
      <div style="margin-left:15px;">
        <label>
          <input type="checkbox" name="effect-${t.id}-${name}" disabled>
          ${name.toUpperCase()} → <strong>IMMUNE</strong>
        </label>
      </div>
    `;
            }

            const targetMod = t.actor.system.effectMods?.[name]?.applyChance || 0;

            // NPC body-part overrides (e.g. exposed limb → extra bleed chance).
            let npcBonus = 0;
            if (aimedHit) {
              if (name === "stagger") npcBonus += npcOverrides.staggerMod;
              else if (name === "bleed") npcBonus += npcOverrides.bleedMod;
              else if (name === "precision") npcBonus += npcOverrides.precisionMod;
            }

            // Bane ("Metla") Ověření bonus: applies only to the precision
            // effect, only when a Bane variant applies to this target.
            const baneBonus =
              name === "precision" && baneVariant ? baneVariant.precision : 0;

            const modifiedChance = effect.chance + targetMod + npcBonus + baneBonus;

            const displayChance = modifiedChance;
            let extraInfo = npcBonus ? ` <em style="color:#c8a84b;">(+${npcBonus}% body part)</em>` : "";
            let success = effect.roll <= modifiedChance;

            if (name === "bleed") {
              const stackMod =
                t.actor.system.effectMods?.[name]?.stackMod || 0;
              // No health damage (e.g. fully absorbed by temp HP) → no bleed.
              const bleedDenied = result.hpLoss <= 0;
              const predicted = bleedDenied
                ? 0
                : resolveBleedStacks(effect, { targetMod: targetMod + npcBonus, stackMod, mode });
              success = predicted > 0;
              bleedLanded = success;
              const bleedNote = npcBonus
                ? ` <em style="color:#c8a84b;">(+${npcBonus}% body part)</em>`
                : "";
              const bonusNote = effect.bonusStacks
                ? ` <em style="color:#a01818;">(+${effect.bonusStacks} Blood Strike)</em>`
                : "";
              extraInfo = bleedDenied
                ? " — no health damage, no bleed"
                : ` → ${predicted} stack(s)${bleedNote}${bonusNote}`;
            }

            // An auto effect, or a bleed packet carried purely by a Blood
            // Strike charge, has no roll to show — "null < null%" reads as a
            // failed roll that was never made.
            const rollLine =
              effect.auto || effect.roll == null
                ? "AUTO"
                : `${effect.roll} < ${displayChance}%`;

            return `
      <div style="margin-left:15px;">
        <label>
          <input type="checkbox"
                 name="effect-${t.id}-${name}"
                 ${success ? "checked" : ""}>
          ${name.toUpperCase()} →
          ${rollLine}${extraInfo}
        </label>
      </div>
    `;
          })
          .join("");

        // Open Wound: only when this hit drew no blood on its own. A hit fully
        // soaked by temporary health leaves no wound to open, and a target
        // immune to Bleeding cannot be opened at all.
        const openWoundBlocked = isImmuneToEffect(t.actor, "bleed")
          ? "immune to Bleeding"
          : result.hpLoss <= 0
            ? "no Life damage"
            : "";
        // Switching to a critical (or sacrificing durability) can make the
        // bleed land, or stop the hit reaching Life, after the box was already
        // ticked — drop the tick with the row so no blood is charged for an
        // option that is no longer on offer.
        if (bleedLanded || openWoundBlocked) delete openWoundState[t.id];
        const openWoundRow =
          canOpenWounds && !bleedLanded
            ? `
      <div style="margin-left:15px;">
        <label style="${openWoundBlocked ? "opacity:0.5;" : "color:#c86a6a;"}">
          <input type="checkbox"
                 name="openwound-${t.id}"
                 ${openWoundState[t.id] ? "checked" : ""}
                 ${openWoundBlocked ? "disabled" : ""}>
          ${game.i18n.format("REDSTEEL.BloodStrike.OpenWoundOption", {
            cost: OPEN_WOUND_BLOOD_COST,
          })}${openWoundBlocked ? ` — ${openWoundBlocked}` : ""}
        </label>
      </div>
    `
            : "";

        // Tržná rána: the Aim this attack was lined up with, sold for Bleeding.
        // Same two gates the bleed effect and Open Wound draw — a blow that
        // never reached Life opens no wound, and a target immune to Bleeding
        // cannot be made to bleed however much Aim is thrown at it.
        const lacerationOffer = canLacerate
          ? getLacerationOffer(lacerationActor, t.id)
          : { available: false, stacks: 0, sneak: false };
        const lacerationBlocked = isImmuneToEffect(t.actor, "bleed")
          ? "immune to Bleeding"
          : result.hpLoss <= 0
            ? "no Life damage"
            : "";
        // Switching to a critical or sacrificing durability can move the hit
        // off Life after the Aim was already committed — drop the choice with
        // the row, exactly as Open Wound drops its tick.
        if (lacerationBlocked) delete lacerationState[t.id];
        const lacerationRow = (() => {
          if (!lacerationOffer.available) return "";
          const chosen = Math.min(
            lacerationState[t.id] ?? 0,
            lacerationOffer.stacks,
          );
          const options = Array.from(
            { length: lacerationOffer.stacks + 1 },
            (_, n) =>
              `<option value="${n}" ${n === chosen ? "selected" : ""}>${n}</option>`,
          ).join("");
          const sneakNote = lacerationOffer.sneak
            ? ` (incl. +${LACERATION_SNEAK_BLEEDS} Sneak Attack)`
            : "";
          const preview = chosen
            ? ` → ${chosen + (lacerationOffer.sneak ? LACERATION_SNEAK_BLEEDS : 0)} Bleeding${sneakNote}, ${chosen * LACERATION_STAMINA_PER_AIM} Stamina`
            : "";
          return `
      <div style="margin-left:15px;">
        <label style="${lacerationBlocked ? "opacity:0.5;" : "color:#c86a6a;"}">
          ${game.i18n.format("REDSTEEL.Laceration.Option", {
            cost: LACERATION_STAMINA_PER_AIM,
          })}
          <select name="laceration-${t.id}" ${lacerationBlocked ? "disabled" : ""}>
            ${options}
          </select>${lacerationBlocked ? ` — ${lacerationBlocked}` : preview}
        </label>
      </div>
    `;
        })();

        const aimedStrikeLabel = (() => {
          const as = attack.aimedStrike;
          if (!as?.part) return "";
          const partDef = AIMED_PARTS[as.part];
          const hitLabel = as.su >= 0
            ? `<b style="color:#8e8;">Hit — ${partDef.label}</b>`
            : `<span style="color:#e88;">Torso (SU &lt; 0)</span>`;
          return `<div style="margin-left:15px; font-size:12px; color:#c8a84b;">⚔️ Aimed Attack: ${hitLabel}</div>`;
        })();

        return `
    <li>
      ${t.name}${baneMarker}${baneCritNote} →
      <strong>${result.finalDamage} HP</strong>${durabilityNote}
      ${gmPreview}
      ${aimedStrikeLabel}
      ${effectPreview}
      ${lacerationRow}
      ${openWoundRow}
    </li>
  `;
      })
      .join("");

  const renderOpenWoundStatus = () => {
    if (!canOpenWounds) return "";
    const reserve = openWoundReserve();
    const spent = openWoundSpent();
    return `
      <div style="margin:4px 0; font-size:12px; color:#c86a6a;">
        ${game.i18n.format("REDSTEEL.BloodStrike.ReserveStatus", {
          name: openWoundActor.name,
          spent,
          reserve,
        })}
      </div>
    `;
  };

  const renderDurabilityControls = () => {
    if (!durabilityTargets.length) return "";

    const rows = durabilityTargets
      .map(({ token, actor, items }) => {
        const perPoint = getDurabilityReductionPerPoint(actor);
        const options = items
          .map((item) => {
            const current = Number(item.system.armor?.durability ?? 0);
            const max = Number(item.system.armor?.durabilityMax ?? 0) || current;
            const name = item.localizedName ?? item.name;
            return `<option value="${item.id}">${name} (${current}/${max})</option>`;
          })
          .join("");

        return `
          <div style="margin-bottom:4px;">
            <strong>${token.name}</strong>
            <span style="font-size:0.9em;">(−${perPoint} damage for 1 point)</span><br>
            <select name="durability-item-${token.id}" style="max-width:60%;">
              <option value="">— no item —</option>
              ${options}
            </select>
          </div>
        `;
      })
      .join("");

    return `
      <fieldset>
        <legend>Sacrifice Durability</legend>
        ${rows}
      </fieldset>
    `;
  };

  new Dialog(
    {
      title: "Apply Damage",
      content: `
      <form>
        <fieldset>
          <legend>Damage Type</legend>
          <label><input type="radio" name="mode" value="normal" checked> Normal</label>
         ${
           hasCritical
             ? ` <label> <input type="radio" name="mode" value="critical"> Critical </label> `
             : ""
         }
          ${
            hasBreakthrough
              ? ` <label> <input type="radio" name="mode" value="breakthrough"> Breakthrough </label> `
              : ""
          }
        </fieldset>
        <fieldset class="critical-degree-fieldset" style="display:none;">
          <legend>Critical Degree</legend>
          ${criticalOptions
            .map(
              (option) => `
                <label>
                  <input type="radio" name="criticalDegree" value="${option.degree}"
                    ${option.degree === criticalDegree ? "checked" : ""}>
                  ${option.degree}
                </label>
              `,
            )
            .join("")}
        </fieldset>
        <!-- Manual half-damage toggle hidden 2026-08-10: attacks that halve
             damage already carry system.roll.halfDamage, so the GM no longer
             needs to set it here. The control and its wiring are kept intact
             (just not displayed) until we are sure nothing relies on the
             manual override. Delete this block and the "halfDamage" handler
             below to remove it for good, or drop the inline display:none to
             bring it back. -->
        <div class="attack-options-row" style="display:none;">
          <label class="pill">
            <input type="checkbox" name="halfDamage" ${halfDamage ? "checked" : ""}>
            <span>${game.i18n.localize("REDSTEEL.Item.Spell.FIELDS.halfDamage.label")}</span>
          </label>
        </div>
        ${renderDurabilityControls()}
        <div class="open-wound-status">${renderOpenWoundStatus()}</div>

        <ul class="damage-preview">
          ${renderPreview()}
        </ul>
      </form>
      <style>
        .attack-options-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 8px;
        }
        .pill input {
          display: none;
        }
        .pill {
          cursor: pointer;
          flex: 0 0 auto;
        }
        .pill span {
          display: inline-block;
          padding: 3px 8px;
          border: 1px solid #666;
          border-radius: 999px;
          background: #2b2b2b;
          color: #ccc;
          font-size: 12px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .pill span:hover {
          border-color: #999;
          color: white;
        }
        .pill input:checked + span {
          background: #4a6fa5;
          border-color: #6ea8ff;
          color: white;
        }
      </style>
    `,
      buttons: {
        apply: {
          label: "Apply",
          callback: (html) => {
            const selectedEffects = {};

            html.find('input[type="checkbox"]').each((_, el) => {
              if (!el.checked) return;
              // Only effect checkboxes are named "effect-<tokenId>-<name>";
              // Open Wound rides its own "openwound-<tokenId>" name so it never
              // lands in the effect list.
              if (!el.name.startsWith("effect-")) return;

              const parts = el.name.split("-");
              const tokenId = parts[1];
              // Effect names may themselves contain hyphens
              const effectName = parts.slice(2).join("-");

              if (!selectedEffects[tokenId]) {
                selectedEffects[tokenId] = [];
              }

              selectedEffects[tokenId].push(effectName);
            });

            const durabilitySpend = {};
            for (const [tokenId, state] of Object.entries(durabilityState)) {
              if (state?.itemId && state.points > 0) {
                durabilitySpend[tokenId] = {
                  itemId: state.itemId,
                  points: state.points,
                };
              }
            }

            const openWound = {};
            for (const [tokenId, on] of Object.entries(openWoundState)) {
              if (on) openWound[tokenId] = true;
            }

            const laceration = {};
            for (const [tokenId, n] of Object.entries(lacerationState)) {
              if (n > 0) laceration[tokenId] = n;
            }

            applyDamageToTargets(
              message,
              targets,
              mode,
              selectedEffects,
              mode === "critical" ? criticalDegree : null,
              durabilitySpend,
              halfDamage,
              degreeTouched,
              openWound,
              laceration,
            );
          },
        },
        cancel: { label: "Cancel" },
      },
      render: (html) => {
        // Open Wound checkboxes live inside .damage-preview, so re-rendering it
        // rebuilds them; bindOpenWound re-attaches the handler each time and
        // openWoundState carries the ticks across the rebuild.
        const bindOpenWound = () => {
          html.find('input[name^="openwound-"]').on("change", (ev) => {
            const tokenId = ev.target.name.slice("openwound-".length);
            if (ev.target.checked) {
              // Never let the dialog promise more blood than the attacker has —
              // the GM re-checks on apply, but failing here is clearer.
              if (openWoundSpent() + OPEN_WOUND_BLOOD_COST > openWoundReserve()) {
                ev.target.checked = false;
                ui.notifications.warn(
                  game.i18n.format("REDSTEEL.BloodStrike.ReserveTooLow", {
                    name: openWoundActor.name,
                    cost: OPEN_WOUND_BLOOD_COST,
                    reserve: openWoundReserve(),
                  }),
                );
                return;
              }
              openWoundState[tokenId] = true;
            } else {
              delete openWoundState[tokenId];
            }
            html.find(".open-wound-status").html(renderOpenWoundStatus());
          });
        };

        // Laceration's selects live in the same rebuilt preview, so they rebind
        // alongside the Open Wound ticks and read their value back out of
        // lacerationState.
        const bindLaceration = () => {
          html.find('select[name^="laceration-"]').on("change", (ev) => {
            const tokenId = ev.target.name.slice("laceration-".length);
            const want = Math.max(0, Number(ev.target.value) || 0);
            // Stamina already promised to other targets is off the table. The
            // GM re-checks on apply, but refusing here says why.
            const committed = lacerationAimSpent() - (lacerationState[tokenId] ?? 0);
            const affordable =
              Math.floor(lacerationStamina() / LACERATION_STAMINA_PER_AIM) -
              committed;
            if (want > affordable) {
              ev.target.value = String(lacerationState[tokenId] ?? 0);
              ui.notifications.warn(
                game.i18n.format("REDSTEEL.Laceration.StaminaTooLow", {
                  name: lacerationActor.name,
                  stamina: lacerationStamina(),
                  cost: LACERATION_STAMINA_PER_AIM,
                }),
              );
              return;
            }
            if (want > 0) lacerationState[tokenId] = want;
            else delete lacerationState[tokenId];
            refreshPreview();
          });
        };

        const refreshPreview = () => {
          html.find(".damage-preview").html(renderPreview());
          bindOpenWound();
          bindLaceration();
          html.find(".open-wound-status").html(renderOpenWoundStatus());
        };

        bindOpenWound();
        bindLaceration();

        const updateCriticalDegreeVisibility = () => {
          html
            .find(".critical-degree-fieldset")
            .toggle(mode === "critical" && criticalOptions.length > 0);
          html.closest(".app").css("height", "auto");
        };

        updateCriticalDegreeVisibility();
        html.find('input[name="mode"]').on("change", (ev) => {
          mode = ev.target.value;
          updateCriticalDegreeVisibility();
          html
            .find(`input[name="criticalDegree"][value="${criticalDegree}"]`)
            .prop("checked", true);
          refreshPreview();
        });
        html.find('input[name="criticalDegree"]').on("change", (ev) => {
          criticalDegree = Number(ev.target.value);
          degreeTouched = true;
          refreshPreview();
        });
        // Kept wired while the checkbox itself is hidden (see the note in the
        // dialog content). It simply never fires as long as the row is hidden.
        html.find('input[name="halfDamage"]').on("change", (ev) => {
          halfDamage = ev.target.checked;
          refreshPreview();
        });

        for (const { token, items } of durabilityTargets) {
          const select = html.find(`select[name="durability-item-${token.id}"]`);

          select.on("change", () => {
            const itemId = select.val();
            const item = items.find((i) => i.id === itemId) ?? null;

            // Picking an item always sacrifices exactly one durability point.
            durabilityState[token.id] = item ? { itemId, points: 1 } : null;
            refreshPreview();
          });
        }
      },
    },
    {
      height: "auto",
    },
  ).render(true);
}

function getCriticalOptions(attack) {
  const fallback = attack.critical
    ? [
        {
          degree: attack.critical.degree ?? 0,
          damage: attack.critical.damage,
          penetration: attack.critical.penetration,
        },
      ]
    : [];

  return Array.isArray(attack.critical?.options)
    ? attack.critical.options
    : fallback;
}

function getCriticalAttackData(attack, degree) {
  const critical = attack.critical ?? {};
  const option = getCriticalOptions(attack).find(
    (candidate) => Number(candidate.degree) === Number(degree),
  );

  return {
    ...critical,
    ...(option ?? {}),
    degree: option?.degree ?? critical.degree ?? degree,
    halfDamage: critical.halfDamage ?? false,
    penCap: critical.penCap ?? false,
  };
}

async function notifyCriticalDegreeOverride({
  message,
  attack,
  suggestedDegree,
  selectedDegree,
  rows,
}) {
  const suggestedAttack = getCriticalAttackData(attack, suggestedDegree);
  const selectedAttack = getCriticalAttackData(attack, selectedDegree);
  const targetRows = rows
    .map(
      (row) => `
        <tr>
          <td>${row.targetName}</td>
          <td style="text-align:center;">${row.suggestedDamage}</td>
          <td style="text-align:center;">${row.selectedDamage}</td>
          <td style="text-align:center;">${row.selectedDamage - row.suggestedDamage}</td>
        </tr>
      `,
    )
    .join("");

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ user: game.user }),
    whisper: ChatMessage.getWhisperRecipients("GM"),
    content: `
      <div class="redsteel-critical-override">
        <strong>Critical degree changed during damage application.</strong>
        <p>
          Suggested degree ${suggestedDegree} was changed to ${selectedDegree}.
          Critical range result: ${attack.critical?.result ?? "unknown"}.
        </p>
        <p>
          Suggested critical: ${suggestedAttack.damage} damage / ${suggestedAttack.penetration ?? 0} penetration.<br>
          Applied critical: ${selectedAttack.damage} damage / ${selectedAttack.penetration ?? 0} penetration.
        </p>
        <table style="width:100%;">
          <tr>
            <th>Target</th>
            <th>Suggested Damage</th>
            <th>Applied Damage</th>
            <th>Diff</th>
          </tr>
          ${targetRows}
        </table>
        <p>Source message: ${message.id}</p>
      </div>
    `,
  });
}

/**
 * Reaction to an actor being at (or below) 0 health, whether from applying
 * damage or from an automated effect tick (bleed, burn, condition damage).
 * Characters receive the Dying + Downed effects; NPCs die and are removed
 * from combat. Safe to call repeatedly — the per-effect guards prevent the
 * Dying countdown and the Downed Mind loss from re-triggering.
 *
 * Runs on the authoritative GM (damage application and effect ticks are both
 * GM-side), so it may freely update any actor and create chat messages.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {Combatant} [options.combatant] - Pre-resolved combatant, if known.
 */
export async function applyZeroHealthState(actor, { combatant } = {}) {
  if (!actor) return;
  const hp = actor.system.stats.health.value;
  if (hp > 0) return;

  // Characters begin Dying and are Downed (instead of merely falling prone).
  if (actor.type === "character") {
    if (!actor.statuses.has("dying")) {
      await game.redsteel.applyEffect(actor, "dying");
    }
    // Unconsciousness supersedes Downed and deletes it, so a later tick at 0
    // health (bleed, burn) must not put Downed back on an unconscious
    // character — that would re-run the Mind loss prompt every round.
    if (
      !actor.statuses.has("downed") &&
      !actor.statuses.has("incapacitated")
    ) {
      await game.redsteel.applyEffect(actor, "downed");
    }
    return;
  }

  // NPCs die
  if (!actor.statuses.has("dead")) {
    await actor.toggleStatusEffect("dead", {
      active: true,
      overlay: true,
    });
  }

  // Remove from combat if applicable
  combatant ??= combatantForActor(actor);
  if (combatant) {
    await combatant.parent.deleteEmbeddedDocuments("Combatant", [combatant.id]);
  }
}

async function handlePostDamageStatus({ actor, combatant }) {
  await applyZeroHealthState(actor, { combatant });
}

// Guards against two health writes landing close enough together that both
// callers read the Dying effect before either of them has deleted it — which
// ends with one delete request failing on a document that is already gone.
const dyingHealInFlight = new Set();

/**
 * Counterpart to applyZeroHealthState: a character healed back above 0 health
 * is no longer Dying.
 *
 * Deleting the Dying effect is what grants the +1 Wound and posts the resolve
 * test (RedsteelActiveEffect#_onDelete), so this is the only thing that makes
 * surviving the brink cost the same however it happened. Only Stabilise and
 * First Aid used to remove Dying, so a character drinking a health potion from
 * negative health stood back up at full health with the effect — and the death
 * countdown — still running, and never received the Wound.
 *
 * Called from the authoritative GM's `updateActor` hook (see
 * RedsteelActiveEffect#_syncDyingOnHeal) rather than from each heal call site,
 * so every route into positive health counts: potions, healing spells, First
 * Aid, Regeneration ticks, Absorb Blood, a long rest, a hand-edited health
 * field, a dragged token bar. Safe to call directly and repeatedly.
 *
 * Downed is deliberately left in place, exactly as performStabilise leaves it —
 * getting back on your feet is its own action.
 *
 * @param {Actor} actor
 * @returns {Promise<boolean>} Whether this call removed the Dying effect.
 */
export async function endDyingIfHealed(actor) {
  if (!actor?.system?.stats?.health) return false;
  if (!(Number(actor.system.stats.health.value) > 0)) return false;

  const dying = actor.effects.find((e) => e.statuses?.has("dying"));
  if (!dying) return false;

  if (dyingHealInFlight.has(actor.id)) return false;
  dyingHealInFlight.add(actor.id);
  try {
    await dying.delete();
    return true;
  } finally {
    dyingHealInFlight.delete(actor.id);
  }
}

async function applyEffectToActor(
  actor,
  effectId,
  stacks = 1,
  { caster = null, school = null } = {},
) {
  if (!resolveEffectDefinition(effectId)) {
    console.warn(
      `Effect ${effectId} matches neither CONFIG.REDSTEEL.effectDefinitions nor a world Condition item`,
    );
    ui.notifications.warn(
      `Unknown effect "${effectId}" — create a Condition item with this name to make it applicable.`,
    );
    return;
  }

  return await game.redsteel.applyEffect(actor, effectId, {
    stacks,
    caster,
    school,
  });
}

/**
 * Resolve the casting context stored on a spell chat card so applied effects
 * can scale off the caster's Spell Power. Returns nulls for non-spell sources
 * (e.g. weapon attacks), which simply means SK-scaled effects fall back.
 */
function getCastingContext(message) {
  const flags = message?.flags?.redsteel ?? {};
  const caster = flags.casterUuid ? fromUuidSync(flags.casterUuid) : null;
  return { caster, school: flags.spellSchool ?? null };
}

/* -------------------------------------------- */
/*  Apply Effects                               */
/* -------------------------------------------- */

export async function handleApplyEffects(messageId) {
  const message = game.messages.get(messageId);
  if (!message?.flags?.effects) return;

  const checkTargetsAndContinue = () => {
    const targets = Array.from(game.user.targets);
    if (!targets.length) {
      ui.notifications.warn("Please select at least one target.");
      return false;
    }
    openEffectSelectionDialog(message, targets);
    return true;
  };

  if (!Array.from(game.user.targets).length) {
    new Dialog({
      title: "No Targets Selected",
      content: "<p>Please select one or more targets, then press OK.</p>",
      buttons: {
        ok: {
          label: "OK",
          callback: checkTargetsAndContinue,
        },
      },
      default: "ok",
    }).render(true);
    return;
  }

  checkTargetsAndContinue();
}

function openEffectSelectionDialog(message, targets) {
  const effects = message.flags.effects || {};

  const renderPreview = () =>
    targets
      .map((t) => {
        const effectList = Object.entries(effects)
          .map(([name, effect]) => {
            if (isImmuneToEffect(t.actor, name)) {
              return `
              <div style="margin-left:15px;">
                <label>
                  <input type="checkbox" name="effect-${t.id}-${name}" disabled>
                  ${name.toUpperCase()} → <strong>IMMUNE</strong>
                </label>
              </div>
            `;
            }

            const baseChance = effect?.chance;
            const roll = effect?.roll;

            let previewText = "";

            if (typeof baseChance === "number" && typeof roll === "number") {
              previewText = ` → ${roll} < ${baseChance}%`;
            }

            return `
              <div style="margin-left:15px;">
                <label>
                  <input type="checkbox"
                         name="effect-${t.id}-${name}">
                  ${name.toUpperCase()}${previewText}
                </label>
              </div>
            `;
          })
          .join("");

        return `
          <li>
            <strong>${t.name}</strong>
            ${effectList}
          </li>
        `;
      })
      .join("");

  new Dialog({
    title: "Apply Effects",
    content: `
      <form>
        <ul class="effect-preview">
          ${renderPreview()}
        </ul>
      </form>
    `,
    buttons: {
      apply: {
        label: "Apply",
        callback: (html) => {
          const selectedEffects = {};

          html.find('input[type="checkbox"]').each((_, el) => {
            if (!el.checked) return;

            const parts = el.name.split("-");
            const tokenId = parts[1];
            // Effect names may themselves contain hyphens
            const effectName = parts.slice(2).join("-");

            if (!selectedEffects[tokenId]) {
              selectedEffects[tokenId] = [];
            }

            selectedEffects[tokenId].push(effectName);
          });

          applyEffectsToTargets(message, targets, selectedEffects);
        },
      },
      cancel: { label: "Cancel" },
    },
  }).render(true);
}

async function applyEffectsToTargets(message, targets, selectedEffects) {
  const data = {
    type: "applyEffects",
    messageId: message.id,
    sceneId: canvas.scene.id,
    targetIds: targets.map((t) => t.id),
    selectedEffects: selectedEffects,
  };

  if (game.user.isGM) {
    await applyEffectsAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
    ui.notifications.info("Effect request sent to GM.");
  }
}

export async function applyEffectsAsGM(data) {
  const { messageId, targetIds, sceneId, selectedEffects } = data;

  const message = game.messages.get(messageId);
  const effects = message.flags?.effects || {};
  const scene = game.scenes.get(sceneId);
  const castingContext = getCastingContext(message);

  for (const tokenId of targetIds) {
    const tokenDoc = scene.tokens.get(tokenId);
    if (!tokenDoc) continue;

    const actor = tokenDoc.actor;
    if (!actor) continue;

    const allowedEffects = selectedEffects?.[tokenId] || [];
    for (const effectId of allowedEffects) {
      const effectData = effects[effectId];
      if (!effectData) continue;

      if (isImmuneToEffect(actor, effectId)) {
        console.log(`GM: ${actor.name} is immune to ${effectId} — skipped`);
        continue;
      }

      let stacks = 1;

      if (effectId === "bleed") {
        stacks = effectData.stacks ?? 0;
      }

      const applied = await applyEffectToActor(
        actor,
        effectId,
        stacks,
        castingContext,
      );

      // Wounding Impale: Impale applies the Rooted effect; carry the pre-computed
      // Bleeding count onto that Root so it fires when the Root is removed (see
      // effects.mjs _onDelete). Only Impale-sourced Roots get the tag.
      if (effectId === "root" && applied) {
        const bleeds = Number(effectData.bleedStacks) || 0;
        if (bleeds > 0) {
          await applied.setFlag("redsteel", "impaleBleeds", bleeds);
        }
      }
    }
  }
}

/* -------------------------------------------- */
/*  Apply Healing                               */
/* -------------------------------------------- */

/**
 * Entry point for the "Apply Healing" chat button. Mirrors handleApplyDamage:
 * requires one or more targets, then opens a confirm dialog. The heal amount
 * was rolled at cast time and lives in `message.flags.heal.total`.
 */
export async function handleApplyHealing(messageId) {
  const message = game.messages.get(messageId);
  if (!message?.flags?.heal) return;

  const proceed = () => {
    const targets = Array.from(game.user.targets);
    if (!targets.length) {
      ui.notifications.warn("Please select at least one target.");
      return false;
    }
    openHealingDialog(message, targets);
    return true;
  };

  if (!Array.from(game.user.targets).length) {
    new Dialog({
      title: "No Targets Selected",
      content: "<p>Please select one or more targets, then press OK.</p>",
      buttons: { ok: { label: "OK", callback: proceed } },
      default: "ok",
    }).render(true);
    return;
  }

  proceed();
}

function openHealingDialog(message, targets) {
  const total = Number(message.flags.heal?.total) || 0;
  const list = targets
    .map((t) => `<li><strong>${t.name}</strong> → +${total} HP</li>`)
    .join("");

  new Dialog({
    title: "Apply Healing",
    content: `<form><p>Restore <strong>${total}</strong> HP to:</p><ul>${list}</ul></form>`,
    buttons: {
      apply: {
        label: "Apply",
        callback: () => applyHealingToTargets(message, targets),
      },
      cancel: { label: "Cancel" },
    },
    default: "apply",
  }).render(true);
}

async function applyHealingToTargets(message, targets) {
  const data = {
    type: "applyHealing",
    messageId: message.id,
    sceneId: canvas.scene.id,
    targetIds: targets.map((t) => t.id),
  };

  if (game.user.isGM) {
    await applyHealingAsGM(data);
  } else {
    game.socket.emit(SOCKET, data);
    ui.notifications.info("Healing request sent to GM.");
  }
}

export async function applyHealingAsGM(data) {
  const { messageId, targetIds, sceneId } = data;
  const message = game.messages.get(messageId);
  const total = Number(message?.flags?.heal?.total) || 0;
  if (total <= 0) return;

  const scene = game.scenes.get(sceneId);
  const path = "system.stats.health.value";

  for (const tokenId of targetIds) {
    const actor = scene?.tokens.get(tokenId)?.actor;
    if (!actor) continue;

    const current = foundry.utils.getProperty(actor, path) ?? 0;
    const max = foundry.utils.getProperty(actor, "system.stats.health.max");
    const next =
      typeof max === "number" && max > 0
        ? Math.min(max, current + total)
        : current + total;
    const healed = next - current;
    if (healed <= 0) continue;

    await actor.update({ [path]: next });

    const cap = typeof max === "number" && max > 0 ? `/${max}` : "";
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><b>${actor.name}</b> healed <b>+${healed}</b> HP (${next}${cap}).</p>`,
    });
  }
}
