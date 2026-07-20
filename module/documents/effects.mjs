import {
  resolveEffectDefinition,
  isImmuneToEffect,
} from "../utils/customConditions.mjs";
import { evaluateDmgVsArmor } from "../utils/combatSkillBonuses.mjs";
import { getSpellPower } from "../utils/spellPower.mjs";
import { STATE_GATED_IMMUNITIES } from "../helpers/specialisations-generated.mjs";

export class RedsteelActiveEffect extends ActiveEffect {
  /* -------------------------------------------- */
  /*  CHANGE STRUCTURE                            */
  /* -------------------------------------------- */
  static EFFECT_OVERRIDES = {
    stun: ["stagger"],
    paralyze: ["stun", "stagger"],
    terror: ["fear"],
    guard: ["defensive_stance"],
  };
  static registerStatusCounterIntegration() {
    if (!game.user.isGM) {
      console.log(
        "Skipping StatusCounter integration on non-GM:",
        game.user.name,
      );
      return;
    }

    const module = game.modules.get("statuscounter");
    if (!module?.active) return;

    Hooks.on("preCreateActiveEffect", (effect) => {
      const statusId = effect.getFlag("core", "statusId");
      const def = resolveEffectDefinition(statusId)?.def;
      if (!def) return;

      const hasStacks = def.stackBehavior === "stack";

      const hasRounds = !!def.defaultRounds;
      const hasTurns = !!def.defaultTurns;

      const shouldShowCounter = hasStacks || hasRounds || hasTurns;

      if (!shouldShowCounter) {
        effect.updateSource({
          "flags.statuscounter.visible": false,
        });

        return;
      }

      const useStacks = def.stackBehavior === "stack";

      const stackValue = effect.getFlag("redsteel", "stacks");

      effect.updateSource({
        "flags.statuscounter.visible": true,

        "flags.statuscounter.value": useStacks
          ? stackValue
          : def.defaultRounds
            ? (effect.getFlag("redsteel", "rounds") ?? 0)
            : (effect.getFlag("redsteel", "actorTurns") ?? 0),
      });
    });

    Hooks.on("updateActiveEffect", async (effect) => {
      const statusId = effect.getFlag("core", "statusId");
      const def = resolveEffectDefinition(statusId)?.def;
      if (!def?.maxStacks) return;

      const stacks = effect.getFlag("redsteel", "stacks");
      if (stacks > def.maxStacks) {
        await effect.setFlag("redsteel", "stacks", def.maxStacks);
      }
    });
  }
  /**
   * Last line of defense: block creation of any status effect the parent
   * actor is immune to (system.effectMods.<id>.immune). Catches paths that
   * bypass applyEffect, e.g. toggling statuses from the token HUD.
   * @override
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;

    const actor = this.parent instanceof Actor ? this.parent : null;
    if (!actor) return;

    for (const statusId of this.statuses ?? []) {
      if (isImmuneToEffect(actor, statusId)) {
        ui.notifications.warn(
          `${actor.name} is immune to "${statusId}" — effect not applied.`,
        );
        return false;
      }
    }

    // State-gated spec immunities: when this effect IS a "gate" status (e.g.
    // Frenzy), bake the owning actor's node-granted immunities into THIS
    // effect's own changes. They then live and die with the state — a
    // Berserker is immune to Panic/Fear/Terror only while Frenzied, and only
    // if the granting node is unlocked. Covers every apply path (ability,
    // applyEffect, HUD toggle) since all creation funnels through _preCreate.
    const gateChanges = [];
    for (const entry of STATE_GATED_IMMUNITIES) {
      if (!this.statuses?.has(entry.gate)) continue;
      const spec = actor.system?.specialisations?.[entry.spec];
      if (!spec?.active || !spec?.nodes?.[entry.node]) continue;
      for (const status of entry.statuses) {
        gateChanges.push({
          key: `system.effectMods.${status}.immune`,
          mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
          value: true,
        });
      }
    }
    if (gateChanges.length) {
      const current = this.toObject().changes ?? [];
      this.updateSource({ changes: [...current, ...gateChanges] });
    }
  }

  static registerHooks() {
    if (this._hooksRegistered) return;

    Hooks.on("updateCombat", async (combat, changed) => {
      if (!this._isAuthoritative()) return;

      const turnKey = `${combat.round}-${combat.turn}`;
      const lastProcessed = combat.getFlag("redsteel", "lastTurnKey");

      // 🔒 Prevent double execution globally
      if (lastProcessed === turnKey) return;

      // -------------------------
      // ROUND START
      // -------------------------
      if ("round" in changed) {
        await this._onRoundStart(combat);
      }

      // -------------------------
      // TURN START (including round rollover)
      // -------------------------
      if ("turn" in changed || "combatantId" in changed || "round" in changed) {
        await combat.setFlag("redsteel", "lastTurnKey", turnKey);
        await this._onTurnStart(combat);
      }
    });

    // Resource-threshold conditions (Fatigued / Toxic Shock) follow the
    // actor's current Stamina and Toxicity. Re-synced by the active GM on
    // every actor update.
    Hooks.on("updateActor", async (actor, changed, options) => {
      if (!this._isAuthoritative()) return;
      await this._syncResourceStateEffects(actor);

      // Hex (Zranitelnost): an original instance of damage just hit a Hexed
      // target — add the 1d8 armor-ignoring rider. The flag is set in the
      // preUpdateActor hook below (which still has the pre-damage pool to
      // compare against).
      if (options?.redsteelDamageInstance) {
        await this._applyHexRider(actor);
      }
    });

    // Hex damage detection. preUpdate still sees the pre-damage HP pool, so we
    // flag genuine decreases here and apply the rider in the updateActor hook
    // above. `redsteelHex` guards our own rider update so it can never
    // re-trigger itself.
    Hooks.on("preUpdateActor", (actor, changed, options) => {
      if (options?.redsteelHex) return;

      const newHealth = foundry.utils.getProperty(
        changed,
        "system.stats.health.value",
      );
      const newTemp = foundry.utils.getProperty(
        changed,
        "system.stats.temporaryHealth.value",
      );
      if (newHealth == null && newTemp == null) return;

      // Compare the combined HP pool (health + temporary health) so damage
      // that only eats temporary health still counts as "taking damage".
      const oldHealth = Number(actor.system.stats.health?.value ?? 0);
      const oldTemp = Number(actor.system.stats.temporaryHealth?.value ?? 0);
      const nextPool =
        Number(newHealth ?? oldHealth) + Number(newTemp ?? oldTemp);

      if (nextPool < oldHealth + oldTemp) {
        options.redsteelDamageInstance = true;
      }
    });

    this._hooksRegistered = true;
  }

  /**
   * Auto-apply / remove the resource-threshold conditions:
   *   • "fatigued"    while Stamina (Výdrž) is at 0.
   *   • "toxic_shock" while Toxicity exceeds its maximum.
   * Only writes when the state actually changes, so it is safe to run on every
   * actor update without looping.
   */
  static async _syncResourceStateEffects(actor) {
    if (!actor?.system?.stats) return;

    const sync = async (statusId, shouldHave) => {
      const existing = actor.effects.find((e) => e.statuses?.has(statusId));
      if (shouldHave && !existing) {
        await this.applyEffect(actor, statusId);
      } else if (!shouldHave && existing) {
        await existing.delete();
      }
    };

    const stamina = actor.system.stats.stamina;
    if (stamina) {
      await sync("fatigued", Number(stamina.value ?? 0) <= 0);
    }

    const toxicity = actor.system.stats.toxicity;
    if (toxicity) {
      await sync(
        "toxic_shock",
        Number(toxicity.value ?? 0) > Number(toxicity.max ?? Infinity),
      );
    }

    // Corruption: keep the "corrupted" token marker in step with degree 2+, and
    // fire the degree-4 mutation the moment corruption reaches its maximum.
    const corruption = actor.system.stats.corruption;
    if (corruption) {
      await sync("corrupted", Number(actor.system.corruptionDegree ?? 0) >= 2);

      const val = Number(corruption.value ?? 0);
      const max = Number(corruption.max ?? Infinity);
      if (Number.isFinite(max) && val >= max) {
        await this._handleCorruptionMutation(actor, val, max);
      }
    }
  }

  /**
   * Corruption degree 4: reaching maximum corruption causes an immediate
   * mutation and drops corruption by 50. The mutation itself is GM-adjudicated,
   * so we announce it on a chat card and apply the -50 automatically. Dropping
   * the value below `max` means this never re-triggers on the follow-up update.
   */
  static async _handleCorruptionMutation(actor, val, max) {
    const newVal = Math.max(0, val - 50);
    await actor.update(
      { "system.stats.corruption.value": newVal },
      { redsteelCorruptionMutation: true },
    );
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: "Mutace / Mutation",
      content:
        `<div class="redsteel corruption-mutation">` +
        `<p><strong>${actor.name}</strong> dosáhl(a) maximální Korupce (${max}) — ` +
        `dochází k okamžité <strong>mutaci</strong>.</p>` +
        `<p>Korupce klesá o 50: ${val} → ${newVal}.</p>` +
        `<p><em>GM: adjudikujte mutaci.</em></p></div>`,
    });
  }

  static _isAuthoritative() {
    if (!game.user.isGM) return false;
    if (!game.users.activeGM) return false;
    return game.user.id === game.users.activeGM.id;
  }

  /**
   * Hex (Zranitelnost) rider: when a Hexed actor takes an original instance of
   * damage, it suffers an extra 1d8 that ignores armor (Kz) — written straight
   * to health, like the other armor-ignoring ticks. Each distinct damage
   * source triggers its own call (one combined Bleeding tick is a single
   * instance, so three Bleeds still only add one 1d8). The update is tagged
   * `redsteelHex` so it never re-triggers itself.
   */
  static async _applyHexRider(actor) {
    if (!actor) return;

    const hex = actor.effects.find(
      (e) => e.getFlag("core", "statusId") === "hex",
    );
    if (!hex) return;

    const roll = await new Roll("1d8").evaluate();

    const current = Number(actor.system.stats.health?.value ?? 0);
    await actor.update(
      { "system.stats.health.value": current - roll.total },
      { redsteelHex: true },
    );

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${hex.name} — +${roll.total} damage (ignores armor)`,
    });

    // The rider can itself drop the target to 0 → Dying/Downed (or death).
    if (Number(actor.system.stats.health?.value ?? 0) <= 0) {
      await game.redsteel.applyZeroHealthState?.(actor);
    }
  }
  static async _onTurnStart(combat) {
    const actor = combat.combatant?.actor;
    if (!actor) return;

    for (const effect of actor.effects) {
      await effect.executeTrigger?.("onTurnStart");
      await effect.decrementActorTurn?.();
    }

    // Advance any in-combat First Aid the actor has committed to.
    await game.redsteel.advanceCombatFirstAid?.(actor);
  }

  static async _onRoundStart(combat) {
    const combatant = combat.combatant;

    const lastProcessed = combat.getFlag("redsteel", "lastProcessedRound");

    if (lastProcessed === combat.round) {
      console.warn("Redsteel | Round already processed:", combat.round);
      return;
    }

    await combat.setFlag("redsteel", "lastProcessedRound", combat.round);

    console.log("Redsteel | Processing round:", combat.round);

    for (const combatant of combat.combatants.values()) {
      const actor = combatant.actor;
      if (!actor) continue;
      const prone = actor.effects.find(
        (e) =>
          e.getFlag("core", "statusId") === "prone" &&
          e.getFlag("redsteel", "proneDelayInit"),
      );
      if (!actor) continue;

      // -------------------------
      // 1. Run ROUND effects
      // -------------------------
      for (const effect of actor.effects) {
        await effect.executeTrigger?.("onRoundStart");
        await effect.decrementRound?.();
      }

      // -------------------------
      // 2. Regeneration bleed rule
      // -------------------------
      const hasRegen = actor.effects.some(
        (e) => e.getFlag("core", "statusId") === "regeneration",
      );

      if (hasRegen) {
        const bleed = actor.effects.find(
          (e) => e.getFlag("core", "statusId") === "bleed",
        );

        if (bleed) {
          await bleed.delete();
        }
      }

      if (prone) {
        await combatant.setFlag("redsteel", "proneInitiativePending", true);

        await prone.unsetFlag("redsteel", "proneDelayInit");

        ui.notifications.info(
          `${actor.name} drops to initiative 1 from Prone.`,
        );
      }
    }
  }

  static async _applyCombatModifiers(actor, combatModifiers) {
    const group = combatModifiers.exclusiveGroup ?? "default";

    const current = foundry.utils.deepClone(
      actor.system.activeCombatEffects ?? {},
    );

    // Remove any existing modifier in same exclusive group
    if (current[group]) {
      delete current[group];
    }

    current[group] = combatModifiers;

    await actor.update({
      "system.activeCombatEffects": current,
    });
  }

  static async _removeCombatModifiers(actor, effectId) {
    const def = resolveEffectDefinition(effectId)?.def;
    if (!def?.combatModifiers) return;

    const group = def.combatModifiers.exclusiveGroup ?? "default";

    console.log("Removing group:", group);

    await actor.update({
      [`system.activeCombatEffects.-=${group}`]: null,
    });
  }
  static CORROSION_PENALTIES = {
    corrosion: -4,
    corrosion_severe: -8,
  };

  async updateCorrosionChange() {
    const statusId = this.getFlag("core", "statusId");
    const perStack = RedsteelActiveEffect.CORROSION_PENALTIES[statusId];
    if (perStack == null) return;

    const stacks = this.getFlag("redsteel", "stacks") ?? 1;
    const penalty = perStack * stacks;

    const changes = this.changes.map((c) => {
      if (c.key === "system.armor.natural.bonus") {
        return { ...c, value: penalty };
      }
      return c;
    });

    await this.update({ changes });
  }

  async _onActorTurnStart() {
    await this.executeTrigger("onTurnStart");
    await this.decrementActorTurn();
  }

  static async applyEffect(
    actor,
    effectId,
    { stacks = 1, turns, caster = null, school = null } = {},
  ) {
    const resolved = resolveEffectDefinition(effectId);
    if (!resolved) {
      ui.notifications.error(`Effect not found: ${effectId}`);
      return;
    }
    // Canonical status id — free-typed condition names are normalized
    // (e.g. "Curse of Doom" → "curse_of_doom").
    effectId = resolved.id;
    const def = resolved.def;

    // ============================================
    // Immunity (system.effectMods.<id>.immune)
    // ============================================
    if (isImmuneToEffect(actor, effectId)) {
      ui.notifications.info(
        `${actor.name} is immune to ${def.name ?? effectId}.`,
      );
      return null;
    }

    const maxStacks = def.maxStacks ?? 99;

    // `let`, not `const`: Spell Power-scaled effects (see the dynamic block
    // below) can override how long the effect lasts.
    let turnsDuration = turns ?? def.defaultTurns ?? 0;
    let roundsDuration = def.defaultRounds ?? 0;

    // Hemophylia — "for each Bleeding gained, gains one additional Bleeding":
    // incoming Bleeding stacks are doubled for the receiving actor (then clamped
    // to maxStacks by the paths below, which both read `stacks`).
    if (effectId === "bleed" && actor.system?.hemophilia) {
      stacks = (Number(stacks) || 1) * 2;
    }

    const initialStacks = effectId === "fear" ? 3 : Math.min(stacks, maxStacks);

    const existing = actor.effects.find((e) => e.statuses?.has(effectId));
    // ============================================
    // Effect Override Rules
    // ============================================
    const overrides = this.EFFECT_OVERRIDES?.[effectId];
    if (overrides?.length) {
      for (const overrideId of overrides) {
        const existing = actor.effects.find((e) => e.statuses?.has(overrideId));
        if (existing) {
          await existing.delete();
        }
      }
    }

    let changes = def.changes ? foundry.utils.deepClone(def.changes) : [];
    // Cloned so Spell Power-scaled effects can bake their caster's SK into the
    // stored trigger (formula / damage) without mutating the shared CONFIG
    // definition. Used for the NEW EFFECT path below.
    let triggers = def.triggers ? foundry.utils.deepClone(def.triggers) : {};

    // ============================================
    // DYNAMIC EFFECTS
    // ============================================
    // The casting context is threaded in from the chat card (caster + the
    // spell's school). Fall back to the controlled token only when an effect
    // is applied outside a spell cast (e.g. a manual toggle).
    const sourceCaster =
      caster ?? canvas.tokens.controlled[0]?.actor ?? game.user.character;

    if (effectId === "sleep") {
      if (!sourceCaster) {
        ui.notifications.warn("No valid caster found.");
        return;
      }
      // Sleep is a Water-school spell — its initiative penalty scales off
      // the caster's Water Spell Power (SK / 2).
      const penalty = getSpellPower(sourceCaster, school ?? "water", {
        multiplier: 0.5,
      });

      changes.push({
        key: "system.secondaryAttributes.ini.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -penalty,
      });
    }

    // Flicker — fixed −3 Initiative (in the definition's changes); lasts
    // SK rounds of the casting school (full Spell Power).
    if (effectId === "flicker" && sourceCaster) {
      roundsDuration = getSpellPower(sourceCaster, school); // multiplier 1 → SK
    }

    // ============================================
    // BLOOD-SCHOOL SK-SCALED EFFECTS
    // ============================================
    // Coagulation — lasts SK rounds (Blood Spell Power). While active its
    // `clampBleeds` trigger keeps every Bleeding effect to one remaining round.
    if (effectId === "coagulation" && sourceCaster) {
      roundsDuration =
        getSpellPower(sourceCaster, school ?? "blood") || roundsDuration;
    }

    // Poisoned blood — Dark + Poison DoT of 1d6 + SK per round; the SK term is
    // appended to the stored damage formula so each tick re-rolls 1d6 + SK.
    if (effectId === "poisoned_blood" && sourceCaster) {
      const sk = getSpellPower(sourceCaster, school ?? "blood");
      for (const key of ["onApply", "onRoundStart"]) {
        if (triggers[key]) triggers[key].damage = `1d6 + ${sk}`;
      }
    }

    // Demonic grasp — Dark + Blunt DoT of SK × 4 per round (baked as a flat
    // number); the 2 Bleeding effects / round come from the trigger's
    // bleedStacks, and the Root penalties travel in the definition's changes.
    if (effectId === "demonic_grasp" && sourceCaster) {
      const dmg = getSpellPower(sourceCaster, school ?? "blood", {
        multiplier: 4,
      });
      for (const key of ["onApply", "onRoundStart"]) {
        if (triggers[key]) triggers[key].damage = `${dmg}`;
      }
    }

    // ============================================
    // DEMO / TEMPLATE — Spell Power (SK) scaling
    // --------------------------------------------
    // Copy this block as a starting point for new SK-driven effects.
    // It shows getSpellPower() driving BOTH the effect's magnitude and
    // its duration. `sourceCaster` is the casting actor and `school` is the
    // spell's school (`spell.system.type`), both threaded from the cast.
    // ============================================
    if (effectId === "sk_demo" && sourceCaster) {
      // Three ways a rule can reference SK — pick whichever the rule needs:
      const sk = getSpellPower(sourceCaster, school); //  +SK      (full)
      const halfSk = getSpellPower(sourceCaster, school, { multiplier: 0.5 }); //  +SK/2
      const doubleSk = getSpellPower(sourceCaster, school, { multiplier: 2 }); //  +2×SK
      void doubleSk; // (unused here — shown for reference)

      // --- MAGNITUDE: scale a change value off SK ---------------------
      // e.g. weaken the target's global bonus by the caster's full SK.
      changes.push({
        key: "system.globalBonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -sk, // swap for -halfSk / -doubleSk as the rule dictates
      });

      // --- DURATION: scale how long the effect lasts off SK -----------
      // Reassign turnsDuration / roundsDuration here. Patterns:
      //   • Y + SK   →  2 + sk
      //   • SK × X   →  doubleSk
      //   • SK / 2   →  halfSk
      turnsDuration = 2 + halfSk; // e.g. lasts (2 + SK/2) of the target's turns
      // roundsDuration = sk;     // …or in rounds instead, scaled by full SK
    }

    // ============================================
    // EXISTING EFFECT
    // ============================================
    if (existing) {
      const stackBehavior = def.stackBehavior ?? "stack";

      // =========================================
      // IGNORE
      // =========================================
      if (stackBehavior === "ignore") {
        return existing;
      }

      // =========================================
      // REFRESH DURATION
      // =========================================
      if (stackBehavior === "refresh") {
        const updates = {};

        if (turnsDuration > 0) {
          updates["flags.redsteel.actorTurns"] = turnsDuration;
        }

        if (roundsDuration > 0) {
          updates["flags.redsteel.rounds"] = roundsDuration;
        }

        await existing.update(updates);

        return existing;
      }

      // =========================================
      // RESET STACKS
      // =========================================
      if (stackBehavior === "reset") {
        await existing.update({
          "flags.redsteel.stacks": initialStacks,
          "flags.statuscounter.value": initialStacks,
        });

        return existing;
      }

      // =========================================
      // NORMAL STACKING
      // =========================================
      if (stackBehavior === "stack") {
        const currentStacks = existing.getFlag("redsteel", "stacks") ?? 1;

        const newStacks = Math.min(currentStacks + stacks, maxStacks);

        const appliedStacks = newStacks - currentStacks;

        // Always refresh the duration on re-application — even when already at
        // max stacks (so e.g. poison's timer resets to its full duration).
        if (turnsDuration > 0) {
          await existing.setFlag("redsteel", "actorTurns", turnsDuration);
        }

        if (roundsDuration > 0) {
          await existing.setFlag("redsteel", "rounds", roundsDuration);
        }

        if (appliedStacks <= 0) return existing;

        await existing.update({
          "flags.redsteel.stacks": newStacks,
          "flags.statuscounter.value": newStacks,
        });

        await existing.updateCorrosionChange();

        await existing.executeTrigger("onApply", {
          appliedStacks,
        });

        return existing;
      }
    }

    // ============================================
    // NEW EFFECT
    // ============================================
    const redsteelFlags = {
      triggers,
    };

    if (def.stackBehavior === "stack" || def.stackBehavior === "reset") {
      redsteelFlags.stacks = initialStacks;
    }

    if (turnsDuration > 0) {
      redsteelFlags.actorTurns = turnsDuration;
    }

    if (roundsDuration > 0) {
      redsteelFlags.rounds = roundsDuration;
    }

    await actor.toggleStatusEffect(effectId, { active: true });

    const created = actor.effects.find((e) => e.statuses?.has(effectId));
    await created.update({
      name: def.name,
      img: def.img,
      changes,

      flags: {
        core: {
          statusId: effectId,
        },

        redsteel: redsteelFlags,

        statuscounter: {
          visible:
            def.stackBehavior === "stack" ||
            !!def.defaultRounds ||
            !!def.defaultTurns,

          value:
            def.stackBehavior === "stack"
              ? initialStacks
              : roundsDuration || turnsDuration || 0,
        },
      },
    });
    await created.executeTrigger("onApply", { appliedStacks: initialStacks });
    // Corrosion armor update
    await created.updateCorrosionChange();
    // --------------------------------------------
    // COMBAT MODIFIER INTEGRATION
    // --------------------------------------------
    if (def.combatModifiers) {
      await this._applyCombatModifiers(actor, def.combatModifiers);
    }
    return created;
  }

  getChangesByKey(key) {
    return this.allChanges.filter((c) => c.key === key);
  }

  async addChange({ key, mode, value }) {
    const changes = [...this.allChanges, { key, mode, value }];
    return this.update({ changes });
  }

  /* -------------------------------------------- */
  /*  DURATION STRUCTURE                          */
  /* -------------------------------------------- */

  get actorTurns() {
    return this.getFlag("redsteel", "actorTurns") ?? 0;
  }

  async decrementActorTurn() {
    if (!this.actorTurns) return;

    const remaining = this.actorTurns - 1;
    console.log("Remaining stacks", remaining);
    if (remaining <= 0) {
      await this.delete();
      return;
    }

    await this.update({
      "flags.redsteel.actorTurns": remaining,
      "flags.statuscounter.value": remaining,
    });
  }

  async decrementRound() {
    const rounds = this.getFlag("redsteel", "rounds");
    if (rounds == null) return;

    const remaining = rounds - 1;

    if (remaining <= 0) {
      await this.delete();
      return;
    }

    await this.update({
      "flags.redsteel.rounds": remaining,
      "flags.statuscounter.value": remaining,
    });
  }
  /* -------------------------------------------- */
  /*  TRIGGER STRUCTURE                           */
  /* -------------------------------------------- */

  get triggers() {
    return this.getFlag("redsteel", "triggers") ?? {};
  }

  async _handleBurningPanic() {
    // Only resolve once
    if (this.getFlag("redsteel", "panicResolved")) return;

    const actor = this.parent;
    if (!actor) return;
    const resolve = actor.system.secondaryAttributes.res?.total ?? 0;

    const roll = await new Roll(`${resolve * 10} - 1d100`).roll();

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: "Burning – Panic Test",
    });

    if (roll.total >= 0) {
      // Success → no further panic tests
      await this.setFlag("redsteel", "panicResolved", true);
      return;
    }

    // Failure → apply panic effect
    await game.redsteel.applyEffect(actor, "panic");

    // Only test once per burn instance
    await this.setFlag("redsteel", "panicResolved", true);
  }

  async _handleFearTest() {
    const actor = this.parent;
    if (!actor) return;

    const resolve = actor.system.secondaryAttributes.res?.total ?? 0;

    const roll = await new Roll(`${resolve * 10} - 1d100`).roll();

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: "Fear – Resolve Test",
    });

    const total = roll.total;

    // Extract raw d100 result safely
    const dice = roll.terms.find((t) => t.faces === 100);
    const diceResult = dice?.results?.[0]?.result ?? 0;

    let stacks = this.getFlag("redsteel", "stacks") ?? 1;

    // =========================
    // CRITICAL FAILURE
    // =========================
    if (total <= -60 || diceResult >= 96) {
      stacks += 1;
      await this.update({
        "flags.redsteel.stacks": stacks,
        "flags.statuscounter.value": stacks,
      });

      ui.notifications.info(`${actor.name} is overwhelmed by fear! (+1 round)`);
      return;
    }

    // =========================
    // CRITICAL SUCCESS
    // =========================
    if (total >= 60 || diceResult <= 5) {
      stacks -= 1;

      if (stacks <= 0) {
        await this.delete();
        ui.notifications.info(`${actor.name} overcomes their fear!`);
        return;
      }

      await this.update({
        "flags.redsteel.stacks": stacks,
        "flags.statuscounter.value": stacks,
      });
      ui.notifications.info(`${actor.name} steels their nerves. (-1 round)`);
      return;
    }

    // Any fail will apply panic
    if (roll.total >= 0) return;
    await game.redsteel.applyEffect(actor, "panic");
  }

  async _handleStoneSkin() {
    const actor = this.parent;
    if (!actor) return;

    // ----------------------------------
    // Check armor
    // ----------------------------------
    const hasArmor = actor.items.some(
      (item) =>
        item.type === "gear" &&
        item.system?.equipped === true &&
        ["Bottom", "Middle", "Top"].includes(item.system?.layer),
    );

    const armorBonus = hasArmor ? 2 : 15;

    // ----------------------------------
    // Dodge bonus clamp logic
    // ----------------------------------
    const currentBonus = actor.system.dodge.limit.bonus ?? 0;

    let penalty = 0;

    if (currentBonus > 20) {
      penalty = 20 - currentBonus; // negative value
    }

    // ----------------------------------
    // Clone changes
    // ----------------------------------
    const changes = foundry.utils.deepClone(this._source.changes);

    for (let c of changes) {
      if (c.key === "system.armor.natural.bonus") {
        c.value = armorBonus;
      }

      if (c.key === "system.dodge.limit.bonus") {
        c.value = penalty;
      }
    }

    await this.update({ changes });
  }

  async _handleFearRound() {
    const actor = this.parent;
    if (!actor) return;

    let stacks = this.getFlag("redsteel", "stacks") ?? 1;

    // -------------------------
    // Automatic decrement
    // -------------------------
    stacks -= 1;

    if (stacks <= 0) {
      await this.delete();
      ui.notifications.info(`${actor.name} is no longer afraid.`);
      return;
    }

    await this.update({
      "flags.redsteel.stacks": stacks,
      "flags.statuscounter.value": stacks,
    });

    // -------------------------
    // Now perform resolve test
    // -------------------------
    await this._handleFearTest();
  }

  async executeTrigger(type, context = {}) {
    const trigger = this.triggers?.[type];
    if (!trigger) return;

    const actor = this.parent;
    if (!actor) return;

    // Handle custom trigger
    if (trigger.custom === "fearTest") {
      return this._handleFearTest();
    }

    if (trigger.custom === "staminaDrain") {
      return this._handleStaminaDrain(trigger);
    }

    if (trigger.custom === "channelingDrain") {
      return this._handleChannelingDrain();
    }

    if (trigger.custom === "stoneSkinUpdate") {
      return this._handleStoneSkin();
    }

    if (trigger.custom === "fearRound") {
      return this._handleFearRound();
    }

    if (trigger.custom === "regenerationHeal") {
      return this._handleRegenerationHeal(trigger);
    }

    if (trigger.custom === "proneInitiative") {
      return this._handleProneInitiative();
    }

    if (trigger.custom === "dyingStart") {
      return this._handleDyingStart();
    }

    if (trigger.custom === "dyingCountdown") {
      return this._handleDyingCountdown();
    }

    if (trigger.custom === "downedStart") {
      return this._handleDownedStart();
    }

    if (trigger.custom === "conditionDamage") {
      return this._handleConditionDamage(trigger);
    }

    if (trigger.custom === "toxicShock") {
      return this._handleToxicShock();
    }

    if (trigger.custom === "clearBleeds") {
      return this._handleClearBleeds();
    }

    if (trigger.custom === "clampBleeds") {
      return this._handleClampBleeds();
    }

    if (trigger.custom === "demonicGrasp") {
      return this._handleDemonicGrasp(trigger);
    }

    if (trigger.custom === "insectSwarm") {
      return this._handleInsectSwarm(trigger);
    }
    let formula = trigger.formula;
    if (!formula) return;

    const stacks = this.getFlag("redsteel", "stacks") ?? 1;
    const appliedStacks = context.appliedStacks ?? stacks;

    // While the target is being first-aided, bleed damage is held: collect the
    // dice to be rolled later (on resume or abort) instead of applying now.
    if (this.getFlag("core", "statusId") === "bleed") {
      const pause = actor.getFlag("redsteel", "firstAidPause");
      if (pause) {
        await actor.setFlag("redsteel", "firstAidPause", {
          ...pause,
          dice: (pause.dice ?? 0) + appliedStacks,
        });
        return;
      }
    }

    formula = formula
      .replace("{stacks}", stacks)
      .replace("{appliedStacks}", appliedStacks);

    const roll = await new Roll(formula).evaluate();

    if (trigger.target) {
      const current = foundry.utils.getProperty(actor, trigger.target) ?? 0;

      await actor.update({
        [trigger.target]: current - roll.total,
      });

      // A DoT (bleed, burn, …) that drops the actor to 0 health triggers the
      // same Dying/Downed (or death) handling as taking a hit.
      if (trigger.target === "system.stats.health.value") {
        await this._maybeApplyZeroHealthState();
      }
    }

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${this.name} – ${type}`,
      create: true,
    });

    // Burning panic logic
    if (trigger.panic) {
      await this._handleBurningPanic();
    }
  }
  async _onDelete(options, userId) {
    await super._onDelete(options, userId);

    const actor = this.parent;
    if (!actor) return;

    console.log("Deleting effect:", this.name);
    console.log("StatusId:", this.getFlag("core", "statusId"));
    console.log("Combat Effects BEFORE:", actor.system.activeCombatEffects);

    const effectId = this.getFlag("core", "statusId");
    if (!effectId) return;

    await RedsteelActiveEffect._removeCombatModifiers(actor, effectId);

    // When Dying ends (e.g. stabilised by First Aid), the survivor must test
    // their resolve or take an Insanity point. Posted once, by the user who
    // removed the effect, with a chat button to roll the test.
    if (effectId === "dying" && game.user.id === userId) {
      // Surviving the brink leaves a lasting mark: +1 Wound. Applied every
      // time Dying is removed — not clamped to the (often very low) wound cap,
      // which would otherwise silently swallow the increment.
      const gw = actor.system.stats.graveWounds ?? {};
      const newWounds = (Number(gw.value) || 0) + 1;
      await actor.update({ "system.stats.graveWounds.value": newWounds });

      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `
          <div class="redsteel-dying">
            <p><b>${actor.name} steps back from the brink.</b></p>
            <p>They receive <b>+1 Wound</b> (now ${newWounds}).</p>
            <p>Once per day, after being close to death, you must test your
            resolve to prevent receiving an Insanity point.</p>
            <div class="redsteel-action-buttons">
              <button type="button" data-action="dyingResolveTest">Resolve Test</button>
            </div>
          </div>`,
        flags: { redsteel: { type: "dyingResolve", actorUuid: actor.uuid } },
      });
    }
  }

  /**
   * Per-round damage tick of a user-created condition. The rolled damage is
   * mitigated by the target's armor, resistances, vulnerabilities and
   * immunities against the condition's damage type expression — the same
   * evaluateDmgVsArmor pipeline used for attacks.
   */
  async _handleConditionDamage(trigger) {
    const actor = this.parent;
    if (!actor) return;

    const formula = String(trigger.damage ?? "").trim();
    if (!formula) return;

    let roll;
    try {
      roll = await new Roll(formula).evaluate();
    } catch (err) {
      console.error(
        `Redsteel | Invalid condition damage formula "${formula}" on "${this.name}"`,
        err,
      );
      ui.notifications.warn(
        `Condition "${this.name}" has an invalid damage formula: ${formula}`,
      );
      return;
    }

    const result = evaluateDmgVsArmor({
      damage: roll.total,
      penetration: 0,
      damageProfile: trigger.damageProfile ?? { expression: [] },
      armor: actor.system.armor,
      hp: actor.system.stats.health.value ?? 0,
      tempHp: actor.system.stats.temporaryHealth.value ?? 0,
      // Condition ticks bypass base armor — only specialized armor,
      // resistances, vulnerabilities and immunities mitigate them.
      ignoreBaseArmor: true,
    });

    await actor.update({
      "system.stats.health.value": Number(result.newHp),
      "system.stats.temporaryHealth.value": Number(result.newTempHp),
    });

    await this._maybeApplyZeroHealthState();

    const types = (trigger.damageProfile?.expression ?? [])
      .filter((t) => t !== "and" && t !== "or")
      .join(", ");

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${this.name} – ${result.totalHpLoss} damage${
        types ? ` (${types})` : ""
      } after specialized armor & resistances`,
    });
  }

  /**
   * Toxic Shock tick (Toxický šok): 25 raw damage that bypasses all armor —
   * written straight to health, like the other DoT ticks — plus an Endurance
   * (−40) test; on a failure the victim is Stunned (Ochromení = stun).
   */
  async _handleToxicShock() {
    const actor = this.parent;
    if (!actor) return;

    const current = Number(actor.system.stats.health?.value ?? 0);
    await actor.update({ "system.stats.health.value": current - 25 });
    await this._maybeApplyZeroHealthState();

    // Endurance test: mod% − 40 − 1d100 ≥ 0 (same convention as the Downed
    // Endurance/Will tests). Failure → Stun.
    const mod = Number(actor.system.attributes?.end?.mod ?? 0);
    const roll = await new Roll(`${mod} - 40 - 1d100`).evaluate();
    const success = roll.total >= 0;

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${this.name} — 25 damage; Endurance (−40) vs Stun`,
    });

    if (!success) {
      await game.redsteel.applyEffect(actor, "stun");
    }
  }

  /**
   * Removes all bleed effects from the actor (e.g. Bleed Ward on apply).
   */
  async _handleClearBleeds() {
    const actor = this.parent;
    if (!actor) return;

    const bleeds = actor.effects.filter(
      (e) => e.getFlag("core", "statusId") === "bleed",
    );

    for (const bleed of bleeds) {
      await bleed.delete();
    }

    if (bleeds.length) {
      ui.notifications.info(`${actor.name}'s bleeding is stopped.`);
    }
  }

  /**
   * Coagulation tick: caps every Bleeding effect on the actor to a single
   * remaining round, so the engine's own round decrement removes it after one
   * tick — "all Bleeding effects last only one round" while Coagulation holds.
   * Setting `flags.redsteel.rounds = 1` lets the standard decrementRound
   * machinery (which runs right after this trigger) handle removal.
   */
  async _handleClampBleeds() {
    const actor = this.parent;
    if (!actor) return;

    const bleeds = actor.effects.filter(
      (e) => e.getFlag("core", "statusId") === "bleed",
    );

    for (const bleed of bleeds) {
      const rounds = bleed.getFlag("redsteel", "rounds");
      if (rounds == null || rounds > 1) {
        await bleed.update({
          "flags.redsteel.rounds": 1,
          "flags.statuscounter.value": 1,
        });
      }
    }
  }

  /**
   * Demonic grasp tick: Dark + Blunt damage (SK × 4, baked into trigger.damage)
   * ignoring base armor — mitigated only by specialized armor / resistances /
   * vulnerabilities, like the other DoT ticks — then applies two Bleeding
   * effects. The Root portion lives in the effect's `changes`.
   */
  async _handleDemonicGrasp(trigger) {
    const actor = this.parent;
    if (!actor) return;

    const formula = String(trigger.damage ?? "").trim();
    if (formula) {
      let roll;
      try {
        roll = await new Roll(formula).evaluate();
      } catch (err) {
        console.error(
          `Redsteel | Invalid Demonic grasp damage formula "${formula}"`,
          err,
        );
        ui.notifications.warn(
          `Demonic grasp has an invalid damage formula: ${formula}`,
        );
        return;
      }

      const result = evaluateDmgVsArmor({
        damage: roll.total,
        penetration: 0,
        damageProfile: trigger.damageProfile ?? { expression: [] },
        armor: actor.system.armor,
        hp: actor.system.stats.health.value ?? 0,
        tempHp: actor.system.stats.temporaryHealth.value ?? 0,
        // "Ignores Armor": bypass base armor, keep specialized armor & resists.
        ignoreBaseArmor: true,
      });

      await actor.update({
        "system.stats.health.value": Number(result.newHp),
        "system.stats.temporaryHealth.value": Number(result.newTempHp),
      });

      await this._maybeApplyZeroHealthState();

      const types = (trigger.damageProfile?.expression ?? [])
        .filter((t) => t !== "and" && t !== "or")
        .join(", ");

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `${this.name} – ${result.totalHpLoss} damage${
          types ? ` (${types})` : ""
        } after specialized armor & resistances`,
      });
    }

    // Two Bleeding effects each round.
    const bleedStacks = Number(trigger.bleedStacks ?? 0);
    if (bleedStacks > 0) {
      await game.redsteel.applyEffect(actor, "bleed", { stacks: bleedStacks });
    }
  }

  /**
   * Insect swarm round tick: armor-ignoring damage plus a resolve test —
   * failure applies panic (same test pattern as burning).
   */
  async _handleInsectSwarm(trigger) {
    const actor = this.parent;
    if (!actor) return;

    const roll = await new Roll(trigger.formula).evaluate();

    const path = "system.stats.health.value";
    const current = foundry.utils.getProperty(actor, path) ?? 0;

    await actor.update({
      [path]: current - roll.total,
    });

    await this._maybeApplyZeroHealthState();

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${this.name} – Damage`,
    });

    const resolve = actor.system.secondaryAttributes.res?.total ?? 0;

    const test = await new Roll(`${resolve * 10} - 1d100`).roll();

    await test.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${this.name} – Panic Test`,
    });

    if (test.total < 0) {
      await game.redsteel.applyEffect(actor, "panic");
    }
  }

  async _handleRegenerationHeal(trigger) {
    const actor = this.parent;
    if (!actor) return;

    const roll = await new Roll(trigger.formula).evaluate();

    const path = "system.stats.health.value";
    const current = foundry.utils.getProperty(actor, path) ?? 0;

    await actor.update({
      [path]: current + roll.total,
    });

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${this.name} – Healing`,
    });
  }
  async _handleStaminaDrain(trigger) {
    const actor = this.parent;
    if (!actor) return;

    let formula = trigger.formula;

    const stacks = this.getFlag("redsteel", "stacks") ?? 1;
    formula = formula.replace("{stacks}", stacks);

    const roll = await new Roll(formula).evaluate();
    const cost = roll.total;

    const path = trigger.target;
    const current = foundry.utils.getProperty(actor, path) ?? 0;

    // ❌ Not enough stamina → remove effect
    if (current < cost) {
      await this.delete();

      ui.notifications.info(
        `${actor.name} drops Defensive Stance (no stamina)`,
      );

      return;
    }

    // ✅ Safe update
    const latest = foundry.utils.getProperty(actor, path) ?? 0;

    await actor.update({
      [path]: Math.max(0, latest - cost),
    });

    ui.notifications.info(`${this.name} – Stamina Drain`);
  }

  async _handleChannelingDrain() {
    const actor = this.parent;
    if (!actor) return;

    const data = this.getFlag("redsteel", "channelingData");
    if (!data) return;

    const costPerRound = this.getFlag("redsteel", "costPerRound") ?? 0;

    if (costPerRound > 0) {
      // Blood school spells sustain from the blood pool instead of mana
      const spell =
        actor.items.get(data.spellId) ?? game.items.get(data.spellId);
      const isBloodSpell = spell?.system?.type === "blood";
      const statKey = isBloodSpell ? "bloodPool" : "mana";
      const resourceName = isBloodSpell ? "Blood" : "Mana";

      const current = actor.system.stats[statKey]?.value ?? 0;

      // 🔴 CHECK FIRST
      if (current < costPerRound) {
        await this.delete();

        ui.notifications.info(
          `<p><b>Channeling Broken (Not Enough ${resourceName})</b></p>`,
        );

        return;
      }

      // 🔋 THEN PAY
      await actor.update({
        [`system.stats.${statKey}.value`]: current - costPerRound,
      });

      ui.notifications.info(
        `<p><b>Maintaining Channeling:</b> -${costPerRound} ${resourceName}</p>`,
      );
    }

    // ✅ Now resolve (even if mana is now 0)
    game.socket.emit("system.redsteel", {
      type: "sustainSpell",
      actorId: actor.id,
      effectId: this.id,
    });
  }

  async _handleProneInitiative() {
    return this._dropToInitiativeOne({
      actedMsg: `${this.parent?.name} will act last next round due to being prone.`,
      droppedMsg: `${this.parent?.name} falls prone and drops to initiative 1.`,
    });
  }

  /**
   * Drops the parent actor's combatant to initiative 1. If they have already
   * acted this round, they instead act last next round (the engine's natural
   * ordering at initiative 1). Shared by Prone and Downed.
   */
  async _dropToInitiativeOne({ actedMsg, droppedMsg } = {}) {
    const actor = this.parent;
    if (!actor) return;

    const combat = game.combat;
    if (!combat) return;

    const combatant = combat.combatants.find((c) => c.actorId === actor.id);

    if (!combatant) return;

    const currentTurn = combat.turn;

    const combatantTurn = combat.turns.findIndex((t) => t.id === combatant.id);

    const alreadyActed = combatantTurn < currentTurn;

    // -----------------------------------
    // Already acted
    // -----------------------------------

    if (alreadyActed) {
      if (actedMsg) ui.notifications.info(actedMsg);
      return;
    }

    // -----------------------------------
    // Has not acted yet
    // -----------------------------------

    await combatant.update({
      initiative: 1,
    });

    if (droppedMsg) ui.notifications.info(droppedMsg);
  }

  /* -------------------------------------------- */
  /*  DYING / DOWNED (0-health state)             */
  /* -------------------------------------------- */

  /**
   * On Dying: blind GM-only roll of 2d4dl1 (drop the lower die). The higher
   * die becomes the number of rounds until bleed-out, stored on the effect so
   * the per-round countdown can decrement it (into negatives) and First Aid
   * can read the worsening penalty.
   */
  async _handleDyingStart() {
    const actor = this.parent;
    if (!actor) return;

    // Guard: only roll the countdown once per Dying instance.
    if (this.getFlag("redsteel", "roundsUntilDeath") != null) return;

    const roll = await new Roll("2d4dl1").evaluate();
    await this.setFlag("redsteel", "roundsUntilDeath", roll.total);

    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${actor.name} is Dying — rounds until bleed-out`,
      whisper: ChatMessage.getWhisperRecipients("GM"),
      blind: true,
    });
  }

  /**
   * Each round start, decrement the bleed-out counter and privately tell the
   * GM how many rounds remain. Once it reaches zero it keeps counting into
   * negative numbers until the Dying effect is removed (the more negative,
   * the harder First Aid is to stabilise).
   */
  async _handleDyingCountdown() {
    const actor = this.parent;
    if (!actor) return;

    let rounds = this.getFlag("redsteel", "roundsUntilDeath");
    if (rounds == null) return;

    // Decrement first, then announce — so the stored counter always equals the
    // number shown to the GM (Stabilise reads this exact value; announcing
    // before decrementing left the flag one lower than displayed).
    rounds -= 1;
    await this.setFlag("redsteel", "roundsUntilDeath", rounds);

    let suffix = "";
    if (rounds === 0) {
      suffix = ` — at the <b>end of this round</b> the character will <b>die</b> unless actively being stabilised.`;
    } else if (rounds === -1) {
      suffix = ` — now <b>dead</b> unless actively being stabilised.`;
    } else if (rounds < -1) {
      // −20% per negative round (Stabilise adds its own −10% base on top).
      const penalty = 20 * Math.abs(rounds);
      suffix = ` — <b>−${penalty}%</b> penalty to stabilisation attempts.`;
    }

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p><b>${actor.name}</b> — Rounds until death: <b>${rounds}</b>${suffix}</p>`,
      whisper: ChatMessage.getWhisperRecipients("GM"),
      blind: true,
    });
  }

  /**
   * On Downed: lose Mind points equal to half (rounded up) the current total.
   * At 0 Mind the character is knocked unconscious (Incapacitated). Otherwise
   * they post a prompt to test Endurance or Will (resolved via chat buttons).
   */
  async _handleDownedStart() {
    const actor = this.parent;
    if (!actor) return;

    // Being Downed drops the character to initiative 1, like Prone.
    await this._dropToInitiativeOne({
      actedMsg: `${actor.name} will act last next round (Downed).`,
      droppedMsg: `${actor.name} is Downed and drops to initiative 1.`,
    });

    const current = Number(actor.system.stats.mind?.value ?? 0);
    const loss = Math.ceil(current / 2);
    const newMind = Math.max(0, current - loss);

    await actor.update({ "system.stats.mind.value": newMind });

    const speaker = ChatMessage.getSpeaker({ actor });
    const lostLabel = `${loss} Mind point${loss === 1 ? "" : "s"}`;

    if (newMind <= 0) {
      await game.redsteel.applyEffect(actor, "incapacitated");

      await ChatMessage.create({
        speaker,
        content: `
          <div class="redsteel-downed">
            <p><b>${actor.name} is Downed.</b></p>
            <p>They lose <b>${lostLabel}</b> and fall <b>unconscious immediately</b> — they cannot act.</p>
            <p><em>At 0 Mind points, ${actor.name} regains 1 Mind point after a short rest.</em></p>
          </div>`,
      });
      return;
    }

    // Indestructible: the steadying test succeeds automatically, so skip the
    // prompt entirely and post the success outcome directly.
    const indestructible = actor.items.some(
      (i) =>
        i.system?.localizationKey === "REDSTEEL.Items.Indestructible.name" ||
        i.name === "Indestructible",
    );

    if (indestructible) {
      await ChatMessage.create({
        speaker,
        content: `
          <div class="redsteel-downed">
            <p><b>${actor.name} is Downed.</b></p>
            <p>They lose <b>${lostLabel}</b> (Mind now <b>${newMind}</b>) but remain conscious.</p>
            <p><b>Endurance Test — Automatic Success</b> (Indestructible).</p>
            <p>${actor.name} may move only <b>1 hex</b> and has only <b>1 action</b>
            per turn. They cannot stand up, defend themselves, nor attack. If they
            move, they must move away from enemies (this does not provoke an Attack
            of Opportunity).</p>
          </div>`,
      });
      return;
    }

    await ChatMessage.create({
      speaker,
      content: `
        <div class="redsteel-downed">
          <p><b>${actor.name} is Downed.</b></p>
          <p>They lose <b>${lostLabel}</b> (Mind now <b>${newMind}</b>) but remain conscious.</p>
          <p>Test to steady yourself — choose an attribute:</p>
          <div class="redsteel-action-buttons">
            <button type="button" data-action="downedTest" data-attr="end">Endurance Test</button>
            <button type="button" data-action="downedTest" data-attr="wil">Will Test</button>
          </div>
        </div>`,
      flags: { redsteel: { type: "downedChoice", actorUuid: actor.uuid } },
    });
  }

  /**
   * Re-reads the parent actor's health after an automated health-reducing tick
   * and, if it has dropped to 0, applies the same 0-health state used by the
   * apply-damage flow (Dying + Downed for characters, death for NPCs).
   */
  async _maybeApplyZeroHealthState() {
    const actor = this.parent;
    if (!actor) return;
    if (Number(actor.system.stats.health?.value ?? 0) > 0) return;
    await game.redsteel.applyZeroHealthState?.(actor);
  }
}

Hooks.on("updateItem", async (item) => {
  if (item.type !== "gear") return;

  const actor = item.parent;
  if (!actor) return;

  const effect = actor.effects.find(
    (e) => e.getFlag("core", "statusId") === "stone_skin",
  );

  if (!effect) return;

  await effect._handleStoneSkin();
});
