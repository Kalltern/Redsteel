import {
  spellCastSucceeded,
  startChannelingForSpell,
} from "./magicSkillBonuses.mjs";
import { getSpellPower } from "./spellPower.mjs";
import { resolveSpellAutomation } from "./spellAutomation.mjs";

/**
 * Strike spells → the caster status effect they impose on a successful cast.
 * Keyed on the item's raw (English) name so this resolves on spell copies that
 * are already owned by live actors, without needing a re-import to pick up a
 * flag. A `flags.redsteel.strike` override wins when present.
 *
 * Enchanted strike is listed under both its final and its old "(WIP)" name —
 * the pack was renamed, but copies already on live actors keep the old one.
 */
const STRIKE_SPELLS = {
  "Lightning strike": "lightning_strike",
  "Fire strike": "fire_strike",
  "Frost strike": "frost_strike",
  "Venomous strike": "venomous_strike",
  "Enchanted strike": "enchanted_strike",
  "Enchanted strike (WIP)": "enchanted_strike",
  "Dark strike": "dark_strike",
  "Binding strike": "binding_strike",
  "Empower strike": "empower_strike",
};

/**
 * @param {Item} spell
 * @returns {string|null} the strike effect id this spell applies, or null.
 */
export function getStrikeId(spell) {
  const flag = spell?.getFlag?.("redsteel", "strike");
  if (flag) return flag;
  return STRIKE_SPELLS[String(spell?.name ?? "").trim()] ?? null;
}

export async function castSpell() {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;
  const result = await game.redsteel.showSpellSelectionDialogs(actor);
  if (!result) {
    ui.notifications.info("Spell casting canceled.");
    return;
  }

  const { freeCast, focusSpent } = result;
  let { ignoreChanneling } = result;

  // If the spell has linked variants, let the player choose which version to
  // cast. Resolves with the parent spell itself when no valid variants exist.
  const spell = await game.redsteel.showVariantSelectionDialog(result.spell);
  if (!spell) {
    ui.notifications.info("Spell casting canceled.");
    return;
  }

  // Lindar's Strikes (veneficus tree): while unlocked, strike spells never
  // trigger channeling evaluation — cast as though "No Channeling Evaluation"
  // were ticked, so a fumbled channeling roll can't crit-fail the strike.
  if (
    getStrikeId(spell) &&
    actor.system.specialisations?.veneficus?.nodes?.lindarovyUdery === true
  ) {
    ignoreChanneling = true;
  }

  if (!freeCast) {
    const ok = await game.redsteel.deductMana(actor, spell);
    if (!ok) return;
  }

  const bonuses = game.redsteel.calculateAttackBonuses(actor, spell);

  const attackResults = await game.redsteel.performAttackRoll(
    actor,
    spell,
    bonuses.attackBonus,
    focusSpent,
    { ignoreChanneling },
  );

  await game.redsteel.finalizeRollsAndPostChat(
    actor,
    spell,
    bonuses,
    attackResults,
    {
      focusSpent,
      ignoreChanneling,
      freeCast,
    },
  );

  // Everything the cast imposes on the caster only happens when it landed.
  // A failed cast leaves the caster clean; the chat card carries a
  // `pendingCast` flag so a successful reroll can apply this side late.
  await applyPostCastEffects(actor, spell, attackResults, {
    token,
    focusSpent,
    ignoreChanneling,
  });
}

/**
 * The caster-side consequences of a successful cast, in the order the cast
 * pipeline has always applied them:
 *
 *   1. Channeling upkeep for spells with a per-round mana cost (this is what
 *      makes a spell sustained/concentration).
 *   2. `flags.redsteel.casterEffects` — status effects the spell imposes on
 *      its own caster, e.g. Mind Bending's Slow Movement + −20% Success.
 *   3. Mind Bending's Mental Duel kick-off.
 *
 * Returns early unless the cast actually landed, so this is safe to call
 * unconditionally. Exported because the chat reroll handler calls it when a
 * reroll turns a failed cast into a successful one.
 *
 * @param {Actor} actor - The casting actor.
 * @param {Item} spell - The spell that was cast.
 * @param {object} attackResults - Result of performAttackRoll, or a reroll
 *   shaped the same way.
 * @param {{token?: Token|null, focusSpent?: number, ignoreChanneling?: boolean}}
 *   [options]
 */
export async function applyPostCastEffects(
  actor,
  spell,
  attackResults,
  { token = null, focusSpent = 0, ignoreChanneling = false } = {},
) {
  const succeeded = spellCastSucceeded(attackResults);

  // A strike cast with "No Channeling Evaluation" (Lindar's Strikes forces this)
  // isn't gated on the channeling margin — the strike applies whatever the roll,
  // so a negative Margin of Success can't stop it. applyStrikeEffect is
  // idempotent, so a later reroll re-running this is a no-op.
  if (getStrikeId(spell) && (succeeded || ignoreChanneling)) {
    await applyStrikeEffect(actor, spell);
  }

  // Spells whose whole effect is a script (Wound exchange, Blood gift, Magic
  // rope) rather than a status the chat card hands out. Gated exactly like the
  // strikes above, and for the same reason: with "No Channeling Evaluation" the
  // cast is not judged on its margin, so a negative Margin of Success must not
  // swallow the spell's entire effect. Everything the chat card applies already
  // behaves this way — only the scripted side needs saying out loud.
  if (succeeded || ignoreChanneling) {
    await resolveSpellAutomation(actor, spell);
  }

  if (!succeeded) return;

  await startChannelingForSpell(actor, spell, { focusSpent });
  await applyCasterEffects(actor, spell);
  await maybeStartMentalDuel(actor, token, spell, attackResults);
}

/**
 * Strike spells (Lindarovy údery) apply a same-name status effect to the caster
 * that enhances their next weapon attack. Reached through applyPostCastEffects,
 * so it is already gated on a successful cast and re-runs when a reroll rescues
 * a failed one. The effect is consumed by the next attack (see the
 * consumeOnAttack hook in redsteel.mjs).
 *
 * The static enhancement lives in the effect definition (config.mjs). Two
 * strikes need caster-specific values baked at cast time:
 *   - dark_strike:  +1d4 + SK/2 bonus damage, and Corruption +2 on the caster.
 *   - binding_strike: the Will + SK*2 test value for the on-hit contested root.
 *
 * A new strike replaces any enhancement already in the weaponEnchant group
 * ("cannot be combined with other attack enhancement"): the old effect document
 * is deleted and the group is (re)written here as the final, authoritative step.
 * Writing the group explicitly last sidesteps a race where the replaced
 * effect's own delete cleanup could otherwise wipe the freshly-applied group.
 *
 * @param {Actor} actor - The casting actor.
 * @param {Item} spell - The spell that was cast.
 */
async function applyStrikeEffect(actor, spell) {
  const strikeId = getStrikeId(spell);
  if (!strikeId) return;

  // Idempotent: a reroll re-runs applyPostCastEffects. If this exact strike is
  // already held, do nothing — never re-bake Corruption / damage.
  if (actor.effects.some((e) => e.statuses?.has(strikeId))) return;

  const def = CONFIG.REDSTEEL.effectDefinitions[strikeId];
  const groupKey = def?.combatModifiers?.exclusiveGroup ?? "weaponEnchant";
  const school = spell.system?.type ?? null;

  // Remove any other enhancement in the same exclusive group (a previous strike
  // or a weapon enchant), document and all, so nothing stacks.
  const stale = actor.effects.filter((e) => {
    const sid = e.getFlag("core", "statusId");
    if (!sid || sid === strikeId) return false;
    return (
      CONFIG.REDSTEEL.effectDefinitions[sid]?.combatModifiers?.exclusiveGroup ===
      groupKey
    );
  });
  for (const e of stale) await e.delete();

  await game.redsteel.applyEffect(actor, strikeId, { caster: actor, school });

  const applied = actor.effects.find((e) => e.statuses?.has(strikeId));
  if (!applied) return;

  // Build this cast's combat-modifier group from the definition, folding in any
  // caster-specific values.
  const group = foundry.utils.deepClone(def?.combatModifiers ?? {});

  // Show the spell's own (localized) name on the token, and tag the effect so
  // the post-attack hook knows to consume it.
  const updates = {
    name: spell.localizedName ?? spell.name ?? applied.name,
    "flags.redsteel.consumeOnAttack": true,
  };

  // Strikes that add 1d4 + SK/2 bonus damage, baked from this caster's SK in the
  // spell's school (Dark for Dark Strike, Body for Empower Strike).
  if (strikeId === "dark_strike" || strikeId === "empower_strike") {
    // SK/2 rounds down (getSpellPower floors multiplied results).
    const halfSk = getSpellPower(actor, school, { multiplier: 0.5 });
    group.damageRoll = `1d4 + ${halfSk}`;
  }

  // Dark Strike additionally corrupts the caster.
  if (strikeId === "dark_strike") {
    const corruption = actor.system.stats?.corruption;
    if (corruption) {
      const max = Number(corruption.max ?? Infinity);
      const next = Math.min(Number(corruption.value ?? 0) + 2, max);
      await actor.update({ "system.stats.corruption.value": next });
    }
  }

  if (strikeId === "binding_strike") {
    const wil =
      actor.type === "npc"
        ? actor.system.attributes?.wil?.value
        : actor.system.attributes?.wil?.mod;
    const testValue =
      Number(wil ?? 0) + getSpellPower(actor, school, { multiplier: 2 });
    updates["flags.redsteel.strikeBinding"] = { testValue, school };
  }

  await applied.update(updates);

  // Authoritative final write of the group — wins over any in-flight delete
  // cleanup from the replaced enhancement above.
  await actor.update({
    [`system.activeCombatEffects.${groupKey}`]: group,
  });
}

/**
 * Reads `spell.flags.redsteel.casterEffects` as an array of effect ids,
 * tolerating both array and object-map storage shapes.
 * @param {Item} spell
 * @returns {string[]}
 */
function readCasterEffects(spell) {
  const raw = spell.getFlag?.("redsteel", "casterEffects");
  return Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
}

/**
 * Applies each `casterEffects` status effect to the caster. Unknown/typo'd ids
 * are reported by applyEffect itself.
 * @param {Actor} actor - The casting actor.
 * @param {Item} spell - The spell that was cast.
 */
async function applyCasterEffects(actor, spell) {
  for (const effectId of readCasterEffects(spell)) {
    if (typeof effectId !== "string" || !effectId.trim()) continue;
    await game.redsteel.applyEffect(actor, effectId.trim());
  }
}

/**
 * Mind Bending duel kick-off. Triggered when the spell carries the
 * `mind_bending_caster` caster effect (so the same Flag Setter setup enables
 * it) or an explicit `flags.redsteel.startsMentalDuel` override.
 *
 * On a successful cast, rolls the initiation chance (35%, or 100% on a
 * Critical success). On success the Mental Duel window opens between caster
 * and target; on failure the caster is offered the rule's voluntary
 * acceptance before opening it anyway.
 * @param {Actor} actor - The casting actor.
 * @param {Token|null} token - The caster's token (from selectToken).
 * @param {Item} spell - The spell that was cast.
 * @param {object} attackResults - Result of performAttackRoll.
 */
async function maybeStartMentalDuel(actor, token, spell, attackResults) {
  const triggers =
    spell.getFlag?.("redsteel", "startsMentalDuel") === true ||
    readCasterEffects(spell).includes("mind_bending_caster");
  if (!triggers) return;

  // The spell has to land to seed the duel (margin of success ≥ 0).
  if (!spellCastSucceeded(attackResults)) return;

  const casterToken = token ?? actor.getActiveTokens()[0] ?? null;
  const targetToken = [...(game.user.targets ?? [])][0] ?? null;

  if (!casterToken || !targetToken) {
    ui.notifications.warn(
      "Mind Bending: target an opponent to start the Mental Duel.",
    );
    return;
  }

  // 35% to initiate; a Critical success forces it (100%).
  const crit =
    attackResults?.critSuccess || attackResults?.displayCritSuccess;
  const chance = crit ? 100 : 35;
  const roll = await new Roll("1d100").evaluate();
  const initiated = roll.total <= chance;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `<b>Mentální souboj — initiation</b>`,
    rolls: [roll],
    content: `
      <p style="text-align:center;">
        Chance to start: <b>${chance}%</b> — rolled ${roll.total} →
        <b>${initiated ? "Duel begins!" : "Not triggered"}</b>
      </p>
      ${
        initiated
          ? ""
          : `<p style="text-align:center;font-size:11px;opacity:.8;">The target may still voluntarily accept.</p>`
      }`,
  });

  if (initiated) {
    game.redsteel.openMentalDuel(casterToken, targetToken);
    return;
  }

  // Rule: "Lze ho dobrovolně přijmout" — the TARGET decides. Route the
  // acceptance prompt to the target's owner (GM for unowned targets).
  game.redsteel.requestVoluntaryMentalDuel(casterToken, targetToken, {
    chance,
    roll: roll.total,
  });
}
