import {
  spellCastSucceeded,
  startChannelingForSpell,
} from "./magicSkillBonuses.mjs";

export async function castSpell() {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;
  const result = await game.redsteel.showSpellSelectionDialogs(actor);
  if (!result) {
    ui.notifications.info("Spell casting canceled.");
    return;
  }

  const { freeCast, focusSpent, ignoreChanneling } = result;

  // If the spell has linked variants, let the player choose which version to
  // cast. Resolves with the parent spell itself when no valid variants exist.
  const spell = await game.redsteel.showVariantSelectionDialog(result.spell);
  if (!spell) {
    ui.notifications.info("Spell casting canceled.");
    return;
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
 * @param {{token?: Token|null, focusSpent?: number}} [options]
 */
export async function applyPostCastEffects(
  actor,
  spell,
  attackResults,
  { token = null, focusSpent = 0 } = {},
) {
  if (!spellCastSucceeded(attackResults)) return;

  await startChannelingForSpell(actor, spell, { focusSpent });
  await applyCasterEffects(actor, spell);
  await maybeStartMentalDuel(actor, token, spell, attackResults);
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
