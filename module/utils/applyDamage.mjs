import { evaluateDmgVsArmor, applyToHp } from "./combatSkillBonuses.mjs";
import {
  resolveEffectDefinition,
  isImmuneToEffect,
} from "./customConditions.mjs";
import { AIMED_PARTS, getBodyPartOverrides } from "./aimedStrike.mjs";
import { resolveBaneVariant } from "./baneCombat.mjs";
import { BANE_TYPES } from "../helpers/banes.mjs";

export const SOCKET = "system.redsteel";

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

  const base = evaluateDmgVsArmor({
    damage: selectedAttack.damage,
    penetration: selectedAttack.penetration ?? 0,
    damageProfile,
    armor: actor.system.armor,
    hp,
    tempHp,
    // Half damage applies if EITHER the Apply Damage dialog requested it (the
    // spell half-damage checkbox) OR the attack itself is inherently half (e.g.
    // Flurry's `@Half`). Must be `||`, not `??`: the dialog value is always a
    // boolean, so `false ?? …` would short-circuit and drop the attack's flag.
    halfDamage: Boolean(halfDamage) || Boolean(selectedAttack.halfDamage),
    penCap: selectedAttack.penCap ?? false,
  });

  // Fully mitigated damage, before it is split into temp HP / HP pools.
  const damageBeforePools = base.tempHpLoss + base.finalDamage;

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
    return { ...base, durabilityReduction: 0, durabilityPointsUsed: 0 };
  }

  return {
    shieldLoss: base.shieldLoss,
    durabilityReduction,
    durabilityPointsUsed: pointsUsed,
    ...applyToHp(damageBeforePools - durabilityReduction, hp, tempHp),
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
  return Math.max(0, stacks);
}

export async function applyDamageAsGM(data) {
  const { messageId, mode, targetIds, sceneId, selectedEffects } = data;
  const durabilitySpend = data.durabilitySpend ?? {};
  const halfDamage = data.halfDamage ?? false;
  const degreeOverridden = data.degreeOverridden ?? false;
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

    await actor.update({
      "system.stats.temporaryHealth.value": Number(result.newTempHp),
      "system.stats.health.value": Number(result.newHp),
    });

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
    for (const [name, effect] of Object.entries(effects)) {
      const targetMod = actor.system.effectMods?.[name]?.applyChance || 0;
      const stackMod = actor.system.effectMods?.[name]?.stackMod || 0;

      const allowedEffectsForTarget = selectedEffects?.[tokenId] || [];

      if (!allowedEffectsForTarget.includes(name)) continue;

      if (isImmuneToEffect(actor, name)) {
        console.log(`GM: ${actor.name} is immune to ${name} — skipped`);
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

    const combatant = combat?.combatants.find((c) => c.tokenId === tokenDoc.id);
    await handlePostDamageStatus({ actor, combatant });
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

            const modifiedChance = effect.chance + targetMod + npcBonus;

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
              const bleedNote = npcBonus
                ? ` <em style="color:#c8a84b;">(+${npcBonus}% body part)</em>`
                : "";
              extraInfo = bleedDenied
                ? " — no health damage, no bleed"
                : ` → ${predicted} stack(s)${bleedNote}`;
            }

            return `
      <div style="margin-left:15px;">
        <label>
          <input type="checkbox"
                 name="effect-${t.id}-${name}"
                 ${success ? "checked" : ""}>
          ${name.toUpperCase()} →
          ${effect.roll} < ${displayChance}%${extraInfo}
        </label>
      </div>
    `;
          })
          .join("");

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
    </li>
  `;
      })
      .join("");

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
            <span style="font-size:0.9em;">(−${perPoint} damage per point)</span><br>
            <select name="durability-item-${token.id}" style="max-width:60%;">
              <option value="">— no item —</option>
              ${options}
            </select>
            <input type="number" name="durability-points-${token.id}"
                   value="0" min="0" max="0" step="1"
                   style="width:55px;" disabled>
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
        <div class="attack-options-row">
          <label class="pill">
            <input type="checkbox" name="halfDamage" ${halfDamage ? "checked" : ""}>
            <span>${game.i18n.localize("REDSTEEL.Item.Spell.FIELDS.halfDamage.label")}</span>
          </label>
        </div>
        ${renderDurabilityControls()}

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
              // Only effect checkboxes are named "effect-<tokenId>-<name>".
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

            applyDamageToTargets(
              message,
              targets,
              mode,
              selectedEffects,
              mode === "critical" ? criticalDegree : null,
              durabilitySpend,
              halfDamage,
              degreeTouched,
            );
          },
        },
        cancel: { label: "Cancel" },
      },
      render: (html) => {
        const refreshPreview = () =>
          html.find(".damage-preview").html(renderPreview());

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
        html.find('input[name="halfDamage"]').on("change", (ev) => {
          halfDamage = ev.target.checked;
          refreshPreview();
        });

        for (const { token, items } of durabilityTargets) {
          const select = html.find(`select[name="durability-item-${token.id}"]`);
          const input = html.find(`input[name="durability-points-${token.id}"]`);

          select.on("change", () => {
            const itemId = select.val();
            const item = items.find((i) => i.id === itemId) ?? null;
            const max = Number(item?.system.armor?.durability ?? 0);

            input.prop("disabled", !item);
            input.attr("max", max);

            const points = item
              ? Math.min(Number(input.val()) || 0, max)
              : 0;
            input.val(points);

            durabilityState[token.id] = item ? { itemId, points } : null;
            refreshPreview();
          });

          input.on("change input", () => {
            const state = durabilityState[token.id];
            if (!state) return;

            const item = items.find((i) => i.id === state.itemId);
            const max = Number(item?.system.armor?.durability ?? 0);
            let points = Math.max(0, Math.floor(Number(input.val()) || 0));
            if (points > max) {
              points = max;
              input.val(points);
            }

            state.points = points;
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
    if (!actor.statuses.has("downed")) {
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
  combatant ??= game.combat?.combatants.find((c) => c.actorId === actor.id);
  if (combatant) {
    await combatant.parent.deleteEmbeddedDocuments("Combatant", [combatant.id]);
  }
}

async function handlePostDamageStatus({ actor, combatant }) {
  await applyZeroHealthState(actor, { combatant });
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
