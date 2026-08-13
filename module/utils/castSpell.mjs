import {
  getDarkHexChance,
  spellCastSucceeded,
  startChannelingForSpell,
} from "./magicSkillBonuses.mjs";
import { getSpellPower } from "./spellPower.mjs";
import { resolveSpellAutomation } from "./spellAutomation.mjs";
import { getStrikeId } from "./strikes.mjs";

export { getStrikeId };

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

  await performCast(actor, spell, {
    token,
    freeCast,
    focusSpent,
    ignoreChanneling,
  });
}

/**
 * Runs the cast pipeline for an already-chosen spell: mana, attack roll, chat
 * card, caster-side consequences. Everything upstream of this (which token,
 * which spell, which variant, focus/free-cast options) is the caller's job, so
 * the dialog-driven `castSpell` and the dialog-free `quickCastSpell` share one
 * body and cannot drift apart.
 *
 * @param {Actor} actor - The casting actor.
 * @param {Item} spell - The spell to cast (already variant-resolved).
 * @param {{token?: Token|null, freeCast?: boolean, focusSpent?: number,
 *   ignoreChanneling?: boolean}} [options]
 * @returns {Promise<boolean>} False when the cast never happened (not enough
 *   mana/blood), true otherwise.
 */
export async function performCast(
  actor,
  spell,
  {
    token = null,
    freeCast = false,
    focusSpent = 0,
    ignoreChanneling = false,
  } = {},
) {
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
    if (!ok) return false;
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

  return true;
}

/**
 * Quick cast — the entry point behind a spell dragged onto the hotbar.
 *
 * Casts the spell exactly as it sits on the sheet: no school/spell picker, no
 * variant prompt (the parent spell is what gets cast), no Focus, no free cast,
 * no "ignore channeling". Mana/blood is still paid and every downstream rule
 * (channeling, caster effects, strikes, Mental Duel) runs as usual, because
 * this shares `performCast` with the normal dialog route.
 *
 * @param {string} spellUuid - UUID of the embedded spell the macro was made from.
 * @param {string} [spellName] - Name recorded at drop time, used to re-find the
 *   spell if the UUID no longer resolves (re-imported sheet, new copy of the
 *   character).
 */
export async function quickCastSpell(spellUuid, spellName = "") {
  const spell = await resolveMacroSpell(spellUuid, spellName);
  if (!spell) {
    ui.notifications.warn(
      `Quick cast: could not find the spell ${spellName || spellUuid}. Drag it onto the hotbar again.`,
    );
    return;
  }

  const actor = spell.actor;
  if (!actor) {
    ui.notifications.warn(
      "Quick cast: this spell is not owned by an actor — cast it from the character sheet.",
    );
    return;
  }
  if (!actor.isOwner) {
    ui.notifications.warn(`You do not own ${actor.name}.`);
    return;
  }

  // Prefer the token the player actually has selected (that is the one the rest
  // of the pipeline treats as the caster), but only when it belongs to the
  // casting actor. Otherwise fall back to the actor's token on the scene.
  const controlled = canvas?.tokens?.controlled?.[0] ?? null;
  const token =
    controlled?.actor?.id === actor.id
      ? controlled
      : (actor.getActiveTokens()[0] ?? null);

  return performCast(actor, spell, { token });
}

/**
 * Resolves the spell a quick-cast macro points at. The UUID is authoritative;
 * the name is only a rescue path for when the original item is gone.
 * @param {string} uuid
 * @param {string} name
 * @returns {Promise<Item|null>}
 */
async function resolveMacroSpell(uuid, name) {
  let spell = null;
  try {
    spell = await fromUuid(uuid);
  } catch (_err) {
    spell = null;
  }
  if (spell?.type === "spell") return spell;

  if (!name) return null;
  const actor =
    game.redsteel.selectToken?.({ warn: false })?.actor ??
    game.user.character ??
    null;
  if (!actor) return null;

  return (
    actor.items.find(
      (i) =>
        i.type === "spell" && (i.name === name || i.localizedName === name),
    ) ?? null
  );
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

  // Maleficarum's Hexing (Zakletí) rides a Darkness strike too: the imbued
  // weapon attack carries the same rank-scaled Hex chance the caster's other
  // offensive Darkness spells get. It has to be baked into the enchant group
  // here rather than rolled on the cast card, because a strike targets nobody —
  // the Hex must land on whoever the imbued attack hits. The cast side skips
  // strikes for the same reason (see applySchoolTraitBonus).
  const hexChance = getDarkHexChance(actor, spell);
  if (hexChance) {
    group.extraEffects = { ...(group.extraEffects ?? {}), hex: hexChance };
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
