import {
  resolveEffectDefinition,
  isImmuneToEffect,
} from "../utils/customConditions.mjs";
import { evaluateDmgVsArmor } from "../utils/combatSkillBonuses.mjs";
import { getSpellPower } from "../utils/spellPower.mjs";
import { gainBloodFromBleed, bloodGainNote } from "../utils/bloodPool.mjs";
import { STATE_GATED_IMMUNITIES } from "../helpers/specialisations-generated.mjs";
import {
  isFloorEffect,
  syncFloorInitiative,
  syncCombatFloorInitiative,
  registerFloorInitiativeClamp,
} from "../utils/floorInitiative.mjs";
import {
  openRoundDigest,
  setRoundDigestRound,
  finishRoundDigest,
  postRoundEntry,
  afterRoundDigest,
} from "../utils/roundDigest.mjs";

export class RedsteelActiveEffect extends ActiveEffect {
  /* -------------------------------------------- */
  /*  CHANGE STRUCTURE                            */
  /* -------------------------------------------- */
  static EFFECT_OVERRIDES = {
    stun: ["stagger"],
    paralyze: ["stun", "stagger"],
    terror: ["fear"],
    guard: ["defensive_stance"],
    // Falling unconscious supersedes being Downed: a Downed character is still
    // marginally acting (1 hex, 1 action), an unconscious one is not. Dying is
    // deliberately NOT listed — the death countdown runs independently of both.
    incapacitated: ["downed"],
    // "Není slučitelný s dalšími Štíty (ani podobnými)" — the three absorb
    // shields plus the two retaliation auras (Flame / Lightning shield) all
    // replace one another, so a target is only ever under one of them.
    shield_physical: [
      "shield_magic",
      "shield_elemental",
      "flame_shield",
      "lightning_shield",
    ],
    shield_magic: [
      "shield_physical",
      "shield_elemental",
      "flame_shield",
      "lightning_shield",
    ],
    shield_elemental: [
      "shield_physical",
      "shield_magic",
      "flame_shield",
      "lightning_shield",
    ],
    flame_shield: [
      "shield_physical",
      "shield_magic",
      "shield_elemental",
      "lightning_shield",
    ],
    lightning_shield: [
      "shield_physical",
      "shield_magic",
      "shield_elemental",
      "flame_shield",
    ],
    // "Ochrana před teplem" vs "Ochrana před žárem" — the apprentice and expert
    // heat wards are explicitly not compatible, so casting one clears the other.
    protection_warmth: ["protection_heat"],
    protection_heat: ["protection_warmth"],
  };
  /**
   * What re-applying an effect does when its definition does not say.
   *
   * The creation path and the re-application path have to derive this the same
   * way. They used to disagree: creation only stored a `stacks` flag for a
   * definition that spelled out `stackBehavior: "stack"`, while a second apply
   * defaulted to `"stack"` for *anything* that left the field out. An effect
   * like Slow was therefore created with no stack count and then re-applied
   * down the stacking branch, which invented one and wrote it over the
   * countdown the token counter was showing — the number went 3 → 2 and looked
   * like the timer had jumped a turn.
   *
   * Only an effect that declares a ceiling counts stacks (a shield too: its
   * remaining absorb lives in `stacks`). Everything else is binary and simply
   * refreshes its duration.
   *
   * @param {object} def - An entry of CONFIG.REDSTEEL.effectDefinitions.
   * @returns {"stack"|"refresh"|"reset"|"ignore"}
   */
  static stackBehaviorOf(def) {
    if (def?.stackBehavior) return def.stackBehavior;
    return def?.maxStacks || def?.shield ? "stack" : "refresh";
  }

  /**
   * Whether the token counter on this kind of effect shows a stack count.
   *
   * A duration always wins: an effect that both stacks and expires (Poison)
   * shows the rounds it has left, because that is the number the GM has to act
   * on. Stacks are only shown when there is no countdown to show instead.
   *
   * @param {object} def - An entry of CONFIG.REDSTEEL.effectDefinitions.
   * @returns {boolean}
   */
  static countsStacks(def) {
    const behavior = this.stackBehaviorOf(def);
    return behavior === "stack" || behavior === "reset" || !!def?.shield;
  }

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

      // Shields keep their remaining absorb in `stacks` (stackBehavior
      // "reset", since recasting replaces the pool rather than adding to it),
      // so they need the counter just as much as a stacking effect.
      const hasStacks = RedsteelActiveEffect.countsStacks(def);

      const hasRounds = !!def.defaultRounds;
      const hasTurns = !!def.defaultTurns;

      const shouldShowCounter = hasStacks || hasRounds || hasTurns;

      if (!shouldShowCounter) {
        effect.updateSource({
          "flags.statuscounter.visible": false,
        });

        return;
      }

      // Duration first, stacks only when there is no countdown — the same
      // precedence the counter keeps for the rest of the effect's life.
      const duration =
        (effect.getFlag("redsteel", "rounds") ?? 0) ||
        (effect.getFlag("redsteel", "actorTurns") ?? 0);

      effect.updateSource({
        "flags.statuscounter.visible": true,

        "flags.statuscounter.value":
          duration || (hasStacks ? (effect.getFlag("redsteel", "stacks") ?? 1) : 0),
      });
    });

    // Clamp runs on the client that made the update only: the hook fires on
    // every client, and a non-owner writing the flag back would just raise a
    // permission error toast.
    Hooks.on("updateActiveEffect", async (effect, changed, options, userId) => {
      if (game.user.id !== userId) return;
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

    // Backfill the definition's own changes when the document arrives without
    // any. `applyEffect` writes them in an update straight after creation, so
    // for that path this is a no-op that the update then overwrites with the
    // identical (possibly SK-scaled) array. What it rescues is every other
    // path — clicking the status icon in the core Token HUD creates a bare
    // effect, and a Slow with no changes is a pure icon: the speed halving,
    // and the defense and dodge penalties, silently never happen.
    if (!this.toObject().changes?.length) {
      const defChanges = [];
      for (const statusId of this.statuses ?? []) {
        const def = resolveEffectDefinition(statusId)?.def;
        if (def?.changes?.length) defChanges.push(...def.changes);
      }
      if (defChanges.length) {
        this.updateSource({ changes: foundry.utils.deepClone(defChanges) });
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

      // Both handlers have finished their await-chains, so nothing more will be
      // rolled for this rollover. Signalled here rather than at the end of
      // _onRoundStart because _onTurnStart runs after it and ticks the first
      // combatant's turn-start effects — those belong on the same card.
      if ("round" in changed) finishRoundDigest();
    });

    // Resource-threshold conditions (Fatigued / Toxic Shock) follow the
    // actor's current Stamina and Toxicity. Re-synced by the active GM on
    // every actor update.
    Hooks.on("updateActor", async (actor, changed, options) => {
      if (!this._isAuthoritative()) return;
      await this._syncResourceStateEffects(actor);
      await this._syncDyingOnHeal(actor, changed);

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
      const newTempMagic = foundry.utils.getProperty(
        changed,
        "system.stats.temporaryHealthMagic.value",
      );
      if (newHealth == null && newTemp == null && newTempMagic == null) return;

      // Compare the combined HP pool (health + both temporary health pools) so
      // damage that only eats a ward still counts as "taking damage".
      const oldHealth = Number(actor.system.stats.health?.value ?? 0);
      const oldTemp = Number(actor.system.stats.temporaryHealth?.value ?? 0);
      const oldTempMagic = Number(
        actor.system.stats.temporaryHealthMagic?.value ?? 0,
      );
      const nextPool =
        Number(newHealth ?? oldHealth) +
        Number(newTemp ?? oldTemp) +
        Number(newTempMagic ?? oldTempMagic);

      if (nextPool < oldHealth + oldTemp + oldTempMagic) {
        options.redsteelDamageInstance = true;
      }
    });

    // Prone / Downed pin turn order to 1 for as long as they are on the actor.
    // Driven from the effect collection rather than from the apply path, so a
    // status toggled straight from the Token HUD counts too.
    Hooks.on("createActiveEffect", async (effect) => {
      if (!this._isAuthoritative()) return;
      if (!isFloorEffect(effect)) return;
      if (!(effect.parent instanceof Actor)) return;
      await syncFloorInitiative(effect.parent);
    });

    Hooks.on("deleteActiveEffect", async (effect, options) => {
      if (!this._isAuthoritative()) return;
      if (options?.redsteelOverrideSwap) return;
      if (!isFloorEffect(effect)) return;
      if (!(effect.parent instanceof Actor)) return;
      // The actor's derived status set may not have been rebuilt yet, so tell
      // the check to treat this effect as already gone.
      await syncFloorInitiative(effect.parent, { ignoreId: effect.id });
    });

    registerFloorInitiativeClamp();

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
   * Healing a character back above 0 health ends Dying, exactly as a successful
   * Stabilise does — see `endDyingIfHealed` in applyDamage.mjs for the rule and
   * why it is driven off the actor update instead of from each heal call site.
   */
  static async _syncDyingOnHeal(actor, changed) {
    // Only a health write can end Dying. Gating on it also stops the +1 Wound
    // update inside `_onDelete` from re-entering this handler, and narrows the
    // window the shared in-flight guard has to cover (drinking a potion writes
    // toxicity and health as two separate updates).
    const healthWrite = foundry.utils.getProperty(
      changed ?? {},
      "system.stats.health.value",
    );
    if (healthWrite == null) return;

    await game.redsteel.endDyingIfHealed?.(actor);
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

    // A round-start bleed tick is itself an instance of damage, so the Hex
    // rider it triggers belongs on the same round card.
    await postRoundEntry(actor, {
      kind: "damage",
      label: hex.name,
      roll,
      note: "ignores armor",
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

    // Everything this method rolls goes into one Announcer card. Already open
    // when dynamic initiative is on (the nextRound wrapper opens it before
    // rerolling), so this covers the case where it is off and the round's only
    // rolls are the effect ticks below. Either way `setRoundDigestRound` fixes
    // up the round number, which the wrapper could only guess at.
    openRoundDigest(combat.round);
    setRoundDigestRound(combat.round);

    // Krvavý štít is strictly "until the end of the round". Clear every Blood
    // Shield in the scene at the top of each round so it can never carry into
    // the next one — this catches bearers who are not combatants (whose effects
    // the per-combatant loop below never decrements) and any that were created
    // without a rounds counter. A shield raised later this round is untouched
    // and expires at the next round start.
    const roundScene = combat.scene ?? canvas.scene;
    for (const token of roundScene?.tokens ?? []) {
      const actor = token.actor;
      if (!actor) continue;
      const bloodShields = actor.effects.filter((e) =>
        e.statuses?.has("blood_shield"),
      );
      for (const bloodShield of bloodShields) await bloodShield.delete();
    }

    for (const combatant of combat.combatants.values()) {
      const actor = combatant.actor;
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
    }

    // -------------------------
    // 3. Floor statuses (Prone / Downed) pin turn order to 1
    // -------------------------
    // Runs after the effect countdowns above, so a Prone that expired this
    // round hands the actor their old order back instead of pinning them for
    // another round. Also catches anyone who fell after already acting last
    // round — that drop is deferred to here to avoid granting a second turn.
    await syncCombatFloorInitiative(combat);
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
  /**
   * Effects whose change is worth a fixed amount *per stack*.
   *
   * Their definition in config.mjs carries the single-stack value, which is
   * what a first application writes. This rewrites that one change to
   * `perStack * stacks` so the number the sheet reads always matches the stack
   * count. Run from both apply paths (freshly created, and re-stacked), which
   * is the only reason a stacking effect can carry a real Active Effect change
   * at all.
   *
   * Keyed by status id → the change key it owns. Any other change on the same
   * effect is left alone.
   */
  static STACK_SCALED_CHANGES = {
    corrosion: { key: "system.armor.natural.bonus", perStack: -4 },
    corrosion_severe: { key: "system.armor.natural.bonus", perStack: -8 },
    // "Rychlá reakce" — +4 Initiative per action spent on it.
    fast_reaction: {
      key: "system.secondaryAttributes.ini.bonus",
      perStack: 4,
    },
  };

  async updateStackScaledChanges() {
    const statusId = this.getFlag("core", "statusId");
    const scaled = RedsteelActiveEffect.STACK_SCALED_CHANGES[statusId];
    if (!scaled) return;

    const stacks = this.getFlag("redsteel", "stacks") ?? 1;
    const value = scaled.perStack * stacks;

    const changes = this.changes.map((c) => {
      if (c.key === scaled.key) {
        return { ...c, value };
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
    {
      stacks = 1,
      turns,
      rounds,
      caster = null,
      school = null,
      poolOverride = null,
    } = {},
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
        `${actor.name} is immune to ${def.name ? game.i18n.localize(def.name) : effectId}.`,
      );
      return null;
    }

    const maxStacks = def.maxStacks ?? 99;

    // `let`, not `const`: Spell Power-scaled effects (see the dynamic block
    // below) can override how long the effect lasts.
    let turnsDuration = turns ?? def.defaultTurns ?? 0;
    let roundsDuration = rounds ?? def.defaultRounds ?? 0;

    // Hemophylia — "for each Bleeding gained, gains one additional Bleeding":
    // incoming Bleeding stacks are doubled for the receiving actor (then clamped
    // to maxStacks by the paths below, which both read `stacks`).
    if (effectId === "bleed" && actor.system?.hemophilia) {
      stacks = (Number(stacks) || 1) * 2;
    }

    // `let`, not `const`: a shield's pool is baked from the caster's Spell
    // Power in the dynamic block below and overrides the passed-in stacks.
    let initialStacks =
      effectId === "fear" ? 3 : Math.min(stacks, maxStacks);

    // Shield config baked at apply time, stored alongside the pool.
    let shieldConfig = null;

    // `let`, not `const`: the expose_weakness gate below can delete this very
    // document (a Ranger re-marking the target they already marked), so it has
    // to be re-resolved afterwards or the refresh path updates a deleted doc.
    let existing = actor.effects.find((e) => e.statuses?.has(effectId));
    // ============================================
    // Effect Override Rules
    // ============================================
    const overrides = this.EFFECT_OVERRIDES?.[effectId];
    if (overrides?.length) {
      for (const overrideId of overrides) {
        const existing = actor.effects.find((e) => e.statuses?.has(overrideId));
        if (existing) {
          // Tagged as a swap: the replacement is created a few lines below, so
          // teardown that reacts to a status ending (floor initiative giving
          // the actor their turn order back) must sit this one out.
          await existing.delete({ redsteelOverrideSwap: true });
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

    // Odhalení slabiny ("Expose Weakness") — marking is driven by the status
    // effect itself so it works no matter how it arrives (ability effect
    // list, status effect manager, manual toggle). Namespace indirection
    // (game.redsteel.*) is used instead of importing from baneCombat.mjs to
    // avoid a circular import through combatSkillBonuses.mjs.
    if (effectId === "expose_weakness") {
      if (!sourceCaster) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Banes.ExposeNoCaster"));
        return null;
      }
      const profile = game.redsteel.getBaneProfile(sourceCaster);
      if (!profile.canMark) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Banes.ExposeNotUnlocked"));
        return null;
      }
      if (!game.redsteel.actorMatchesBane(actor, profile.keys)) {
        ui.notifications.warn(game.i18n.localize("REDSTEEL.Banes.ExposeNeedsBaneTarget"));
        return null;
      }
      // One mark per Ranger: marking a new target releases the previous one.
      await game.redsteel.clearMarksBy(sourceCaster.id);
      // That delete may have removed the effect captured in `existing` above,
      // when the Ranger re-marks a target they had already marked. Re-resolve
      // so the paths below never touch a deleted document.
      existing = actor.effects.find((e) => e.statuses?.has(effectId));
    }

    // Shields — bake the absorb pool from the caster's Spell Power and stash
    // the matching config on the effect. The pool lives in `stacks` so the
    // token counter renders it and the GM can edit it like any other stack.
    if (def.shield) {
      shieldConfig = foundry.utils.deepClone(def.shield);
      const { base = 0, perSpellPower = 0 } = shieldConfig.pool ?? {};
      // `poolOverride` sets the pool directly (used by Krvavý štít, whose size is
      // half the Life just lost — including 1, which the `stacks > 1` branch
      // below would otherwise read as "no explicit pool" and collapse to the SK
      // formula). Otherwise an explicit `stacks` (a GM granting a pool by hand,
      // or a spell passing a fixed size) wins over that formula.
      const scaled =
        poolOverride != null
          ? poolOverride
          : stacks > 1
            ? stacks
            : base +
              perSpellPower *
                (sourceCaster
                  ? getSpellPower(sourceCaster, school ?? "spirit")
                  : 0);
      initialStacks = Math.max(0, Math.min(Math.floor(scaled), maxStacks));
    }

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

    // Depetrification — the Petrification ward it leaves behind lasts SK turns
    // of the target's own turns (Earth Spell Power).
    if (effectId === "petrify_ward" && sourceCaster) {
      turnsDuration =
        getSpellPower(sourceCaster, school ?? "earth") || turnsDuration;
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

    // Skin cracking — SK/4 Bleeding effects per round, rounded UP (so even a
    // low Blood SK still inflicts one). getSpellPower floors its multiplied
    // results, so the division is done here on the full SK instead.
    if (effectId === "skin_cracking" && sourceCaster) {
      const sk = getSpellPower(sourceCaster, school ?? "blood");
      const perRound = Math.max(1, Math.ceil(sk / 4));
      for (const key of ["onApply", "onRoundStart"]) {
        if (triggers[key]) triggers[key].bleedStacks = perRound;
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

    // Blight bomb — Dark + Poison DoT of 3d6 + SK/2 per round for six rounds.
    // The on-death explosion is NOT built (it waits on P11 on-death triggers).
    if (effectId === "blight_bomb" && sourceCaster) {
      const sk = getSpellPower(sourceCaster, school ?? "blood", {
        multiplier: 0.5,
      });
      for (const key of ["onApply", "onRoundStart"]) {
        if (triggers[key]) triggers[key].damage = `3d6 + ${sk}`;
      }
    }

    // ============================================
    // DARK-SCHOOL SK-SCALED EFFECTS
    // ============================================
    // Dark curse — Magic + Dark DoT of 1d6 + SK per round for two rounds; the
    // SK term is appended to the stored damage formula so each tick re-rolls.
    if (effectId === "dark_curse" && sourceCaster) {
      const sk = getSpellPower(sourceCaster, school ?? "darkness");
      for (const key of ["onApply", "onRoundStart"]) {
        if (triggers[key]) triggers[key].damage = `1d6 + ${sk}`;
      }
    }

    // Black Itch — 1d4/round for SK/2 + 1 rounds. Only the duration scales;
    // the damage is flat. defaultRounds is "ticks - 1", so SK/2 + 1 ticks
    // means a roundsDuration of SK/2.
    // Floored at 1, not 0: a roundsDuration of 0 never writes
    // flags.redsteel.rounds (see the `roundsDuration > 0` guards below), so
    // nothing would count the effect down and a Darkness SK under 2 would
    // leave a permanent DoT on the target. One extra tick beats forever.
    if (effectId === "black_itch" && sourceCaster) {
      roundsDuration = Math.max(
        1,
        getSpellPower(sourceCaster, school ?? "darkness", { multiplier: 0.5 }),
      );
    }

    // Entropy — the −10 Armor is fixed (in the definition's changes); the mark
    // lasts SK/2 + 1 rounds of Darkness Spell Power. getSpellPower floors the
    // multiplied result, so the +1 is added after the division rounds down —
    // the same order the description's `{{math spellPower "/" 2 + 1}}` reads.
    if (effectId === "entropy" && sourceCaster) {
      roundsDuration =
        getSpellPower(sourceCaster, school ?? "darkness", { multiplier: 0.5 }) +
        1;
    }

    // ============================================
    // FIRE-SCHOOL SK-SCALED EFFECTS
    // ============================================
    // Burning Mark — Magic + Fire DoT of 2d6 + SK/2 per round for three
    // rounds; the SK term is appended to the stored damage formula.
    if (effectId === "burning_mark" && sourceCaster) {
      const sk = getSpellPower(sourceCaster, school ?? "fire", {
        multiplier: 0.5,
      });
      for (const key of ["onApply", "onRoundStart"]) {
        if (triggers[key]) triggers[key].damage = `2d6 + ${sk}`;
      }
    }

    // ============================================
    // WATER-SCHOOL SK-SCALED EFFECTS
    // ============================================
    // Hypothermia — Magic + Frost DoT of 1d6 + SK/2 per round for three
    // rounds; the SK term is appended to the stored damage formula.
    if (effectId === "hypothermia" && sourceCaster) {
      const sk = getSpellPower(sourceCaster, school ?? "water", {
        multiplier: 0.5,
      });
      for (const key of ["onApply", "onRoundStart"]) {
        if (triggers[key]) triggers[key].damage = `1d6 + ${sk}`;
      }
    }

    // ============================================
    // BODY-SCHOOL SK-SCALED EFFECTS
    // ============================================
    // Eluviel's touch — heals 2 + SK per round for as long as it is left on
    // the target; regenerationHeal reads `formula`, not `damage`.
    if (effectId === "eluviels_touch" && sourceCaster) {
      const sk = getSpellPower(sourceCaster, school ?? "body");
      for (const key of ["onApply", "onRoundStart"]) {
        if (triggers[key]) triggers[key].formula = `2 + ${sk}`;
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
      const stackBehavior = RedsteelActiveEffect.stackBehaviorOf(def);

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

        // The token counter is a separate flag that decrementRound/Turn keeps in
        // step — refreshing the duration without rewriting it leaves the token
        // counting down from the *old* value while the effect actually runs on
        // the new one. Mirror the new-effect path's precedence (rounds first).
        if (roundsDuration > 0 || turnsDuration > 0) {
          updates["flags.statuscounter.value"] =
            roundsDuration || turnsDuration;
        }

        await existing.update(updates);

        // The mark moves to whoever most recently placed it — the gate above
        // already released the marking Ranger's own previous mark, so this
        // simply reassigns ownership of the (possibly re-used) effect doc.
        if (effectId === "expose_weakness" && sourceCaster) {
          await existing.setFlag("redsteel", "baneMarkedBy", sourceCaster.id);
        }

        return existing;
      }

      // =========================================
      // RESET STACKS
      // =========================================
      if (stackBehavior === "reset") {
        await existing.update({
          "flags.redsteel.stacks": initialStacks,
          "flags.statuscounter.value": initialStacks,
          // Also set on re-cast so a shield created before the counter was
          // wired up starts displaying without needing to be removed first.
          ...(def.shield && { "flags.statuscounter.visible": true }),
          // Recasting a shield replaces its config too, so a new element pick
          // or a different caster's SK takes effect.
          ...(shieldConfig && {
            "flags.redsteel.shield": {
              ...shieldConfig,
              max: initialStacks,
            },
          }),
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
        // Counter included: a duration written without its counter leaves the
        // token counting down from the old number while the effect actually
        // runs on the new one, which reads as "the timer did not refresh".
        const updates = {};

        if (turnsDuration > 0) {
          updates["flags.redsteel.actorTurns"] = turnsDuration;
        }

        if (roundsDuration > 0) {
          updates["flags.redsteel.rounds"] = roundsDuration;
        }

        // Only claim the counter when there is no countdown on this effect.
        // Poison stacks *and* expires; the rounds left is the number the GM
        // acts on, and writing the stack count there would look like the timer
        // had jumped (and be undone by the next decrementRound anyway).
        updates["flags.statuscounter.value"] =
          (turnsDuration > 0 ? turnsDuration : 0) ||
          (roundsDuration > 0 ? roundsDuration : 0) ||
          (existing.getFlag("redsteel", "rounds") ?? 0) ||
          (existing.getFlag("redsteel", "actorTurns") ?? 0) ||
          newStacks;

        // Stack-side bookkeeping only when a stack was actually gained — at the
        // cap the re-apply is a pure duration refresh.
        if (appliedStacks > 0) {
          updates["flags.redsteel.stacks"] = newStacks;

          // A shield that stacks (Krvavý štít) must keep its absorb config in
          // sync, and (re)writes it here so an effect that was created without
          // one — e.g. toggled straight from the token HUD — still soaks damage
          // rather than just growing an inert counter. `max` tracks the peak.
          if (shieldConfig) {
            updates["flags.redsteel.shield"] = {
              ...shieldConfig,
              max: newStacks,
            };
            updates["flags.statuscounter.visible"] = true;
          }
        }

        await existing.update(updates);

        if (appliedStacks <= 0) return existing;

        await existing.updateStackScaledChanges();

        // `onlyOnCreate` marks an onApply that belongs to *contracting* the
        // condition rather than to the dose that re-applied it — Poison's flat
        // 2d6. Re-applying such an effect refreshes its clock and its stacks
        // and nothing else; the damage after that comes from onRoundStart.
        // Triggers that are about the new stacks (Bleeding's {appliedStacks}d4)
        // or that re-test the target (Fear) leave the flag off and still fire.
        if (!def.triggers?.onApply?.onlyOnCreate) {
          await existing.executeTrigger("onApply", {
            appliedStacks,
          });
        }

        return existing;
      }
    }

    // ============================================
    // NEW EFFECT
    // ============================================
    const redsteelFlags = {
      triggers,
    };

    // Derived, not a literal check on the definition: an effect the
    // re-application path will treat as stacking has to be *created* with a
    // stack count, or the second apply invents one. See stackBehaviorOf().
    if (RedsteelActiveEffect.countsStacks(def)) {
      redsteelFlags.stacks = initialStacks;
    }

    // Shields carry their matching rules and starting pool alongside `stacks`,
    // which holds the remaining absorb.
    if (shieldConfig) {
      redsteelFlags.shield = { ...shieldConfig, max: initialStacks };
    }

    if (turnsDuration > 0) {
      redsteelFlags.actorTurns = turnsDuration;
    }

    if (roundsDuration > 0) {
      redsteelFlags.rounds = roundsDuration;
    }

    await actor.toggleStatusEffect(effectId, { active: true });

    const created = actor.effects.find((e) => e.statuses?.has(effectId));
    // Without this the next line throws a TypeError and leaves behind exactly
    // the failure that is hardest to read at the table: the icon is on the
    // token, but the document never received its `changes`, so the effect is
    // inert. Say so instead.
    if (!created) {
      ui.notifications.error(
        `Could not apply "${effectId}" to ${actor.name} — the status was toggled but no effect document came back.`,
      );
      console.error("REDSTEEL | applyEffect: effect missing after toggle", {
        actor: actor.uuid,
        effectId,
      });
      return null;
    }

    const counterValue = roundsDuration || turnsDuration || 0;
    await created.update({
      name: game.i18n.localize(def.name),
      img: def.img,
      changes,

      flags: {
        core: {
          statusId: effectId,
        },

        redsteel: redsteelFlags,

        statuscounter: {
          // Shields keep their absorb pool in `stacks` under stackBehavior
          // "reset" (recasting replaces the pool), so they need the counter
          // just as much as a "stack" effect does. Durations are read from the
          // resolved numbers rather than the definition's defaults, so a
          // hand-set duration (the GM's effect manager) still gets a counter.
          visible: RedsteelActiveEffect.countsStacks(def) || counterValue > 0,

          value: counterValue || initialStacks,
        },
      },
    });
    await created.executeTrigger("onApply", { appliedStacks: initialStacks });
    // Per-stack change value (Corrosion armor, Fast Reaction initiative).
    await created.updateStackScaledChanges();
    // --------------------------------------------
    // COMBAT MODIFIER INTEGRATION
    // --------------------------------------------
    if (def.combatModifiers) {
      await this._applyCombatModifiers(actor, def.combatModifiers);
    }
    if (effectId === "expose_weakness" && sourceCaster) {
      await created.setFlag("redsteel", "baneMarkedBy", sourceCaster.id);
    }
    return created;
  }

  /**
   * Turn a single GM-facing amount into the right `applyEffect` option.
   *
   * One number per effect, and it always means the same thing: what the token
   * counter will read. A countdown wins over a stack count for the same reason
   * the counter shows it — Slow "5" is five turns, Bleeding "5" is five
   * stacks, Poison "5" is five rounds (its stacks still climb by one per
   * re-apply, capped by its own maxStacks).
   *
   * @param {object} def - An entry of CONFIG.REDSTEEL.effectDefinitions.
   * @param {number} amount
   * @returns {object} Options for applyEffect.
   */
  static amountOption(def, amount) {
    if (def?.defaultRounds) return { rounds: amount };
    if (def?.defaultTurns || def?.useDuration) return { turns: amount };
    if (this.countsStacks(def)) return { stacks: amount };
    return {};
  }

  /**
   * Where a live effect keeps the number its counter is showing.
   *
   * @param {ActiveEffect} effect
   * @param {object} def
   * @returns {{path: string, value: number, kind: "rounds"|"turns"|"stacks"}|null}
   *   null for a marker that counts nothing at all (Prone, Dead, …).
   */
  static trackedAmount(effect, def) {
    const rounds = effect.getFlag("redsteel", "rounds") ?? 0;
    if (rounds > 0) {
      return { path: "flags.redsteel.rounds", value: rounds, kind: "rounds" };
    }

    const turns = effect.getFlag("redsteel", "actorTurns") ?? 0;
    if (turns > 0) {
      return {
        path: "flags.redsteel.actorTurns",
        value: turns,
        kind: "turns",
      };
    }

    if (this.countsStacks(def)) {
      return {
        path: "flags.redsteel.stacks",
        value: effect.getFlag("redsteel", "stacks") ?? 1,
        kind: "stacks",
      };
    }

    // No flag yet, but the definition says this effect runs on a clock — an
    // effect toggled from the Token HUD arrives with nothing set. Report the
    // slot at zero so the GM can still give it a duration from the manager.
    if (def?.defaultRounds) {
      return { path: "flags.redsteel.rounds", value: 0, kind: "rounds" };
    }
    if (def?.defaultTurns || def?.useDuration) {
      return { path: "flags.redsteel.actorTurns", value: 0, kind: "turns" };
    }

    return null;
  }

  /**
   * Nudge an effect's counter up or down without going through a re-apply.
   *
   * A re-apply is the wrong tool for "give it one more turn": it re-runs
   * onApply (another Poison tick, another Burning panic test) and resets the
   * duration to the definition's default instead of adding to what is left.
   * This walks the stored number directly, and removes the effect when it
   * reaches zero.
   *
   * @param {Actor} actor
   * @param {string} effectId
   * @param {number} delta - Signed. Bumping an effect the actor does not have
   *   applies it at `delta`.
   * @param {object} [options]
   * @param {number} [options.max=99] - Ceiling for durations; stacks use the
   *   definition's own maxStacks when it has one.
   * @returns {Promise<ActiveEffect|null>}
   */
  static async adjustEffectAmount(actor, effectId, delta, { max = 99 } = {}) {
    const resolved = resolveEffectDefinition(effectId);
    if (!resolved) return null;

    const { id, def } = resolved;
    const existing = actor.effects.find((e) => e.statuses?.has(id));

    if (!existing) {
      if (delta <= 0) return null;
      return this.applyEffect(
        actor,
        id,
        this.amountOption(def, Math.min(delta, max)),
      );
    }

    const tracked = this.trackedAmount(existing, def);

    // Nothing to count: down removes the marker, up has nothing to raise.
    if (!tracked) {
      if (delta < 0) await existing.delete();
      return null;
    }

    const ceiling = tracked.kind === "stacks" ? (def.maxStacks ?? max) : max;
    const next = Math.min(Math.max(0, tracked.value + delta), ceiling);

    if (next <= 0) {
      await existing.delete();
      return null;
    }
    if (next === tracked.value) return existing;

    const updates = {
      [tracked.path]: next,
      "flags.statuscounter.value": next,
      "flags.statuscounter.visible": true,
    };

    // A shield's absorb pool lives in `stacks`; `max` is its high-water mark,
    // which the bar reads to draw how much is left.
    const shield = existing.getFlag("redsteel", "shield");
    if (tracked.kind === "stacks" && shield) {
      updates["flags.redsteel.shield"] = {
        ...shield,
        max: Math.max(Number(shield.max) || 0, next),
      };
    }

    await existing.update(updates);
    return existing;
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

    await postRoundEntry(actor, {
      kind: "test",
      label: "Burning – Panic Test",
      roll,
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

    await postRoundEntry(actor, {
      kind: "test",
      label: "Fear – Resolve Test",
      roll,
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

    if (trigger.custom === "incapacitatedStart") {
      return this._handleIncapacitatedStart();
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

    if (trigger.custom === "skinCracking") {
      return this._handleSkinCracking(trigger);
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

    // Life lost to Bleeding feeds a Blood caster's Reserve (see bloodPool.mjs).
    // Banked before the zero-health handling so the transfer still happens on
    // the tick that drops the actor.
    let bloodGained = 0;

    if (trigger.target) {
      const current = foundry.utils.getProperty(actor, trigger.target) ?? 0;

      await actor.update({
        [trigger.target]: current - roll.total,
      });

      if (
        this.getFlag("core", "statusId") === "bleed" &&
        trigger.target === "system.stats.health.value"
      ) {
        bloodGained = await gainBloodFromBleed(actor, roll.total);
      }

      // A DoT (bleed, burn, …) that drops the actor to 0 health triggers the
      // same Dying/Downed (or death) handling as taking a hit.
      if (trigger.target === "system.stats.health.value") {
        await this._maybeApplyZeroHealthState();
      }
    }

    const bloodNote = bloodGainNote(actor, bloodGained);

    await postRoundEntry(actor, {
      kind: trigger.target === "system.stats.health.value" ? "damage" : "note",
      label: this.name,
      roll,
      note: bloodNote,
      flavor: `${this.name} – ${type}${bloodNote}`,
      messageData: { create: true },
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

    // Combat-modifier groups live on the actor, so clearing one is an actor
    // write. _onDelete runs on EVERY connected client, and the ones that do not
    // own the actor fail that write with a "lacks permission to update Actor"
    // toast (every strike replaced or consumed spammed the whole table). The
    // user who deleted the effect necessarily owns the parent actor — deleting
    // an embedded document requires it — so let only that client clean up.
    if (game.user.id === userId) {
      await RedsteelActiveEffect._removeCombatModifiers(actor, effectId);
    }

    // Possession ends when the "Possessed" marker is removed. Ownership changes
    // need GM authority, so only the active GM restores — regardless of who
    // cleared the status. Restore the exact prior levels recorded at seize time
    // (removing keys that were absent before) and drop the tracking flag.
    if (effectId === "possessed" && game.user.id === game.users.activeGM?.id) {
      const possession = actor.getFlag("redsteel", "possession");
      if (possession) {
        // Rebuild the full ownership map and replace it wholesale. Foundry
        // merges partial ownership updates, so `-=` key removal is unreliable;
        // {diff:false, recursive:false} forces a deterministic replace.
        const ownership = foundry.utils.deepClone(actor.ownership ?? {});
        for (const [userId, prior] of Object.entries(possession.grants ?? {})) {
          if (prior === null || prior === undefined) delete ownership[userId];
          else ownership[userId] = prior;
        }
        await actor.update({ ownership }, { diff: false, recursive: false });
        await actor.unsetFlag("redsteel", "possession");
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<p style="text-align:center;">
            <b>${actor.name}</b> is released from possession${
              possession.possessorName ? ` by ${possession.possessorName}` : ""
            }; control returns to normal.</p>`,
        });
      }
    }

    // Wounding Impale: Impale applies the Rooted effect. When such a Root is
    // torn free, the target takes the Bleeding stacks the applying attack
    // stashed on it (2, or 3 with a Trident). A plain Root has no tag, so this
    // is a no-op for every Root that did not come from a Wounding Impale.
    if (effectId === "root" && game.user.id === userId) {
      const bleeds = Number(this.getFlag("redsteel", "impaleBleeds")) || 0;
      if (bleeds > 0) {
        await game.redsteel.applyEffect(actor, "bleed", { stacks: bleeds });
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `
            <div class="redsteel-downed">
              <p><b>${actor.name}</b> is torn free of the impale.</p>
              <p>Wounding Impale inflicts <b>${bleeds} Bleeding</b>.</p>
            </div>`,
        });
      }
    }

    // Coming round clears the `defeated` mark that Incapacitated set, putting
    // the character back in the turn order. Updating a Combatant needs GM
    // authority, so the active GM does it no matter who cleared the status.
    if (
      effectId === "incapacitated" &&
      game.user.id === game.users.activeGM?.id
    ) {
      const combatant = game.combat?.combatants.find(
        (c) => c.actorId === actor.id,
      );
      if (combatant?.defeated) {
        await combatant.update({ defeated: false });
      }
    }

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
      tempHpMagic: actor.system.stats.temporaryHealthMagic?.value ?? 0,
      // Condition ticks bypass base armor — only specialized armor,
      // resistances, vulnerabilities and immunities mitigate them.
      ignoreBaseArmor: true,
    });

    const updateData = {
      "system.stats.health.value": Number(result.newHp),
      "system.stats.temporaryHealth.value": Number(result.newTempHp),
      "system.stats.temporaryHealthMagic.value": Number(
        result.newTempHpMagic ?? 0,
      ),
    };

    // Some conditions (e.g. Black Itch) convert their own damage into
    // Corruption. Corruption is deliberately left unclamped elsewhere in the
    // system, so it isn't clamped here either.
    const gainsCorruption =
      trigger.corruptionFromDamage === true && result.totalHpLoss > 0;
    if (gainsCorruption) {
      const currentCorruption = Number(
        actor.system.stats.corruption?.value ?? 0,
      );
      updateData["system.stats.corruption.value"] =
        currentCorruption + result.totalHpLoss;
    }

    await actor.update(updateData);

    await this._maybeApplyZeroHealthState();

    const types = (trigger.damageProfile?.expression ?? [])
      .filter((t) => t !== "and" && t !== "or")
      .join(", ");

    const detail = `${result.totalHpLoss} damage${
      types ? ` (${types})` : ""
    } after specialized armor & resistances${
      gainsCorruption ? ` (+${result.totalHpLoss} Corruption)` : ""
    }`;

    await postRoundEntry(actor, {
      kind: "damage",
      label: this.name,
      roll,
      note: detail,
      flavor: `${this.name} – ${detail}`,
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

    await postRoundEntry(actor, {
      kind: "damage",
      label: this.name,
      roll,
      note: "25 damage; Endurance (−40) vs Stun",
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
        tempHpMagic: actor.system.stats.temporaryHealthMagic?.value ?? 0,
        // "Ignores Armor": bypass base armor, keep specialized armor & resists.
        ignoreBaseArmor: true,
      });

      await actor.update({
        "system.stats.health.value": Number(result.newHp),
        "system.stats.temporaryHealth.value": Number(result.newTempHp),
        "system.stats.temporaryHealthMagic.value": Number(
          result.newTempHpMagic ?? 0,
        ),
      });

      await this._maybeApplyZeroHealthState();

      const types = (trigger.damageProfile?.expression ?? [])
        .filter((t) => t !== "and" && t !== "or")
        .join(", ");

      const detail = `${result.totalHpLoss} damage${
        types ? ` (${types})` : ""
      } after specialized armor & resistances`;

      await postRoundEntry(actor, {
        kind: "damage",
        label: this.name,
        roll,
        note: detail,
        flavor: `${this.name} – ${detail}`,
      });
    }

    // Two Bleeding effects each round.
    const bleedStacks = Number(trigger.bleedStacks ?? 0);
    if (bleedStacks > 0) {
      await game.redsteel.applyEffect(actor, "bleed", { stacks: bleedStacks });
    }
  }

  /**
   * Skin cracking tick: applies `trigger.bleedStacks` (SK/4 rounded up, baked at
   * apply time) Bleeding effects. Bleeding caps at 6 stacks, so any stack the
   * target had no room for deals 1d8 damage instead — measured by how far the
   * stack counter actually moved rather than by predicting the cap, so
   * Hemophylia's doubling counts as stacks that landed.
   */
  async _handleSkinCracking(trigger) {
    const actor = this.parent;
    if (!actor) return;

    const wanted = Number(trigger.bleedStacks ?? 0);
    if (wanted <= 0) return;

    const bleedStacksOn = () => {
      const bleed = actor.effects.find(
        (e) => e.getFlag("core", "statusId") === "bleed",
      );
      return bleed ? Number(bleed.getFlag("redsteel", "stacks") ?? 1) : 0;
    };

    const before = bleedStacksOn();
    await game.redsteel.applyEffect(actor, "bleed", { stacks: wanted });
    const applied = Math.max(0, bleedStacksOn() - before);
    const refused = Math.max(0, wanted - applied);

    if (refused <= 0) return;

    // Every Bleeding the target had no room for becomes 1d8 damage. Untyped
    // health loss, exactly like a Bleeding tick itself.
    const roll = await new Roll(`${refused}d8`).evaluate();
    const current = Number(actor.system.stats.health.value ?? 0);
    await actor.update({
      "system.stats.health.value": current - roll.total,
    });

    await postRoundEntry(actor, {
      kind: "damage",
      label: this.name,
      roll,
      note: `${refused} Bleeding refused (at the cap) → ${refused}d8 damage`,
      flavor: `${this.name} – ${refused} Bleeding refused (at the cap) → ${refused}d8 damage`,
    });

    await this._maybeApplyZeroHealthState();
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

    await postRoundEntry(actor, {
      kind: "damage",
      label: `${this.name} – Damage`,
      roll,
    });

    const resolve = actor.system.secondaryAttributes.res?.total ?? 0;

    const test = await new Roll(`${resolve * 10} - 1d100`).roll();

    await postRoundEntry(actor, {
      kind: "test",
      label: `${this.name} – Panic Test`,
      roll: test,
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
    const max = foundry.utils.getProperty(actor, "system.stats.health.max");
    const next =
      typeof max === "number" && max > 0
        ? Math.min(max, current + roll.total)
        : current + roll.total;

    await actor.update({
      [path]: next,
    });

    await postRoundEntry(actor, {
      kind: "healing",
      label: `${this.name} – Healing`,
      roll,
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
    //
    // The re-roll posts a full spell card of its own rather than a digest line.
    // This handler runs inside round processing, while the Announcer is still
    // buffering, so the card would land above it. Hand the emit to the digest
    // instead: it fires once the round card is in chat (and immediately when no
    // round card is coming, which is every path outside a round rollover).
    const actorId = actor.id;
    const effectId = this.id;
    afterRoundDigest(() => {
      game.socket.emit("system.redsteel", {
        type: "sustainSpell",
        actorId,
        effectId,
      });
    });
  }

  /**
   * Prone's onApply trigger. The real enforcement lives in the floor-initiative
   * layer (which also covers Downed, HUD toggles, round starts and any direct
   * initiative write); this just nudges it on the apply path. Idempotent, so it
   * costs nothing when the createActiveEffect hook has already run.
   */
  async _handleProneInitiative() {
    return syncFloorInitiative(this.parent);
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

    await postRoundEntry(actor, {
      kind: "test",
      label: "Dying — rounds until bleed-out",
      roll,
      gm: true,
      flavor: `${actor.name} is Dying — rounds until bleed-out`,
      messageData: {
        whisper: ChatMessage.getWhisperRecipients("GM"),
        blind: true,
      },
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

    await postRoundEntry(actor, {
      kind: "note",
      label: "Dying",
      note: `Rounds until death: <b>${rounds}</b>${suffix}`,
      gm: true,
      // Standalone fallback reproduces the old whisper exactly — no flavor line.
      flavor: "",
      content: `<p><b>${actor.name}</b> — Rounds until death: <b>${rounds}</b>${suffix}</p>`,
      messageData: {
        whisper: ChatMessage.getWhisperRecipients("GM"),
        blind: true,
      },
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

    // Being Downed pins turn order to 1, like Prone.
    await syncFloorInitiative(actor);

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
   * On Incapacitated ("Vyřazen"): the character is unconscious and out of the
   * fight. Downed is already gone by this point — EFFECT_OVERRIDES deletes it
   * before this effect is created — so all that is left is to take them out of
   * the turn order.
   *
   * They are marked `defeated` rather than deleted from the tracker on purpose:
   * the per-combatant round loop in `_onRoundStart` is what drives the Dying
   * countdown and any bleed/burn ticks, and an unconscious character still
   * bleeds out on schedule. Turn `Skip Defeated` on in the tracker to stop the
   * turn from landing on them.
   */
  async _handleIncapacitatedStart() {
    const actor = this.parent;
    if (!actor) return;

    // Also pins them at initiative 1 — harmless when Downed already did it, and
    // needed when unconsciousness arrives on its own (a head crit's failed
    // Endurance test, Mind hitting 0 outside the Downed flow).
    await syncFloorInitiative(actor);

    const combatant = game.combat?.combatants.find(
      (c) => c.actorId === actor.id,
    );
    if (combatant && !combatant.defeated) {
      await combatant.update({ defeated: true });
    }
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
