import { resolveEffectDefinition } from "../utils/customConditions.mjs";
import { evaluateDmgVsArmor } from "../utils/combatSkillBonuses.mjs";

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

    this._hooksRegistered = true;
  }
  static _isAuthoritative() {
    if (!game.user.isGM) return false;
    if (!game.users.activeGM) return false;
    return game.user.id === game.users.activeGM.id;
  }
  static async _onTurnStart(combat) {
    const actor = combat.combatant?.actor;
    if (!actor) return;

    for (const effect of actor.effects) {
      await effect.executeTrigger?.("onTurnStart");
      await effect.decrementActorTurn?.();
    }
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

  static async applyEffect(actor, effectId, { stacks = 1, turns } = {}) {
    const resolved = resolveEffectDefinition(effectId);
    if (!resolved) {
      ui.notifications.error(`Effect not found: ${effectId}`);
      return;
    }
    // Canonical status id — free-typed condition names are normalized
    // (e.g. "Curse of Doom" → "curse_of_doom").
    effectId = resolved.id;
    const def = resolved.def;

    const maxStacks = def.maxStacks ?? 99;

    const turnsDuration = turns ?? def.defaultTurns ?? 0;
    const roundsDuration = def.defaultRounds ?? 0;

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

    // ============================================
    // DYNAMIC EFFECTS
    // ============================================
    if (effectId === "sleep") {
      const caster = canvas.tokens.controlled[0]?.actor ?? game.user.character; // character or controlled token
      if (!caster) {
        ui.notifications.warn("No valid caster found.");
        return;
      }
      const spellPower = caster?.system?.schools?.water?.spellPower ?? 0;

      const penalty = Math.floor(spellPower / 2);

      changes.push({
        key: "system.secondaryAttributes.ini.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: -penalty,
      });
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
      triggers: def.triggers ?? {},
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

    if (trigger.custom === "conditionDamage") {
      return this._handleConditionDamage(trigger);
    }

    if (trigger.custom === "clearBleeds") {
      return this._handleClearBleeds();
    }

    if (trigger.custom === "insectSwarm") {
      return this._handleInsectSwarm(trigger);
    }
    let formula = trigger.formula;
    if (!formula) return;

    const stacks = this.getFlag("redsteel", "stacks") ?? 1;
    const appliedStacks = context.appliedStacks ?? stacks;

    formula = formula
      .replace("{stacks}", stacks)
      .replace("{appliedStacks}", appliedStacks);

    const roll = await new Roll(formula).evaluate();

    if (trigger.target) {
      const current = foundry.utils.getProperty(actor, trigger.target) ?? 0;

      await actor.update({
        [trigger.target]: current - roll.total,
      });
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
      const currentMana = actor.system.stats.mana?.value ?? 0;

      // 🔴 CHECK FIRST
      if (currentMana < costPerRound) {
        await this.delete();

        ui.notifications.info(
          `<p><b>Channeling Broken (Not Enough Mana)</b></p>`,
        );

        return;
      }

      // 🔋 THEN PAY
      const newMana = currentMana - costPerRound;

      await actor.update({
        "system.stats.mana.value": newMana,
      });

      ui.notifications.info(
        `<p><b>Maintaining Channeling:</b> -${costPerRound} Mana</p>`,
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
      ui.notifications.info(
        `${actor.name} will act last next round due to being prone.`,
      );

      return;
    }

    // -----------------------------------
    // Has not acted yet
    // -----------------------------------

    await combatant.update({
      initiative: 1,
    });

    ui.notifications.info(
      `${actor.name} falls prone and drops to initiative 1.`,
    );
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
