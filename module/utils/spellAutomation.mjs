/**
 * Per-spell automation for casts whose whole effect is a script rather than a
 * status effect the chat card can hand out.
 *
 * Three spells live here:
 *   - Wound exchange (Blood, apprentice) — moves the target's Bleeding onto the
 *     caster.
 *   - Blood gift (Blood, expert) — clears the caster's Bleeding, then a
 *     contested Will + SK vs Endurance test decides how much of it the target
 *     receives.
 *   - Magic rope (Spirit, expert) — summons the rope, then resolves a repeatable
 *     contested Will + SK vs Str/Dex test that Roots (and on a wide margin
 *     stuns + damages) the target.
 *
 * All three change actors the caster may not own, so the mutation always runs on
 * the GM client: the casting client gathers targets and the caster's baked test
 * value, then either calls the resolver directly (it is the GM) or relays the
 * payload over the system socket. This is the same split Binding Strike uses.
 *
 * Spells are keyed on their raw English name so this resolves on copies already
 * owned by live actors, without needing a re-import. A `flags.redsteel.spellAuto`
 * override wins when present.
 */

import { getSpellPower } from "./spellPower.mjs";

const SOCKET = "system.redsteel";

/**
 * Spell name → automation key. The "(WIP)" names stay listed alongside the
 * finals: the pack has been renamed, but copies already sitting on live actors
 * keep the name they were dragged in under, and re-importing the pack does not
 * rename them. Dropping these keys would silently unhook those copies.
 */
const SPELL_AUTOMATION = {
  "Wound exchange": "woundExchange",
  "Wound exchange (WIP)": "woundExchange",
  "Blood gift": "bloodGift",
  "Blood gift (WIP)": "bloodGift",
  "Magic rope": "magicRope",
  "Magic rope (WIP)": "magicRope",
};

/**
 * @param {Item} spell
 * @returns {string|null} the automation key for this spell, or null.
 */
export function getSpellAutomation(spell) {
  const flag = spell?.getFlag?.("redsteel", "spellAuto");
  if (flag) return flag;
  return SPELL_AUTOMATION[String(spell?.name ?? "").trim()] ?? null;
}

/* -------------------------------------------- */
/*  Shared helpers                              */
/* -------------------------------------------- */

/**
 * An attribute's test value. NPCs roll their raw `value`, PCs their `mod` —
 * the same split every other contested test in the system uses.
 * @param {Actor} actor
 * @param {string} key - Attribute key, e.g. "end".
 * @returns {number}
 */
function attrTest(actor, key) {
  const isNpc = actor.type === "npc";
  return Number(
    (isNpc
      ? actor.system.attributes?.[key]?.value
      : actor.system.attributes?.[key]?.mod) ?? 0,
  );
}

/**
 * How many Bleeding stacks an actor is carrying (0 when not bleeding).
 * @param {Actor} actor
 * @returns {number}
 */
export function countBleedStacks(actor) {
  const bleed = actor?.effects?.find(
    (e) => e.getFlag("core", "statusId") === "bleed",
  );
  if (!bleed) return 0;
  return Number(bleed.getFlag("redsteel", "stacks") ?? 1);
}

/**
 * Removes every Bleeding effect from an actor.
 * @param {Actor} actor
 * @returns {Promise<number>} how many stacks were removed.
 */
async function stripBleeds(actor) {
  const bleeds = actor.effects.filter(
    (e) => e.getFlag("core", "statusId") === "bleed",
  );
  let total = 0;
  for (const bleed of bleeds) {
    total += Number(bleed.getFlag("redsteel", "stacks") ?? 1);
    await bleed.delete();
  }
  return total;
}

/** The tokens the casting user has targeted, as `{sceneId, ids}`. */
function currentTargets() {
  const ids = [...(game.user.targets ?? [])].map((t) => t.id).filter(Boolean);
  return { sceneId: canvas.scene?.id, ids };
}

/**
 * Runs `payload` on the GM client: directly when this user is the GM, over the
 * system socket otherwise.
 * @param {object} payload - Must carry a `type` the socket handler dispatches.
 * @param {Function} resolver - The GM-side resolver for that type.
 */
async function runAsGM(payload, resolver) {
  if (game.user.isGM) await resolver(payload);
  else game.socket.emit(SOCKET, payload);
}

/* -------------------------------------------- */
/*  Cast entry point                            */
/* -------------------------------------------- */

/**
 * Dispatches a landed cast to its automation. Called from applyPostCastEffects,
 * so it only ever runs on a successful cast.
 * @param {Actor} actor - The casting actor.
 * @param {Item} spell - The spell that was cast.
 */
export async function resolveSpellAutomation(actor, spell) {
  const key = getSpellAutomation(spell);
  if (!key) return;

  const school = spell.system?.type ?? null;

  if (key === "woundExchange") return castWoundExchange(actor, spell);
  if (key === "bloodGift") return castBloodGift(actor, spell, school);
  if (key === "magicRope") return castMagicRope(actor, spell, school);
}

/* -------------------------------------------- */
/*  Wound exchange                              */
/* -------------------------------------------- */

/**
 * "Heals all Bleeding effects on the target and transfers them to the Caster."
 * The caster picks up whatever the target was carrying, capped by Bleeding's own
 * 6-stack maximum on the receiving end (applyEffect enforces that).
 */
async function castWoundExchange(actor, spell) {
  const { sceneId, ids } = currentTargets();
  if (!ids.length) {
    ui.notifications.warn(
      "Wound exchange: target the bleeding creature before casting.",
    );
    return;
  }

  await runAsGM(
    {
      type: "woundExchange",
      casterUuid: actor.uuid,
      targetIds: ids,
      sceneId,
      spellName: spell.localizedName ?? spell.name,
    },
    resolveWoundExchangeAsGM,
  );
}

/**
 * GM side of Wound exchange.
 * @param {{casterUuid: string, targetIds: string[], sceneId: string,
 *   spellName?: string}} data
 */
export async function resolveWoundExchangeAsGM({
  casterUuid,
  targetIds = [],
  sceneId,
  spellName = "Wound exchange",
}) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  const caster = casterUuid ? await fromUuid(casterUuid) : null;
  if (!scene || !caster) return;

  for (const tokenId of targetIds) {
    const target = scene.tokens.get(tokenId)?.actor;
    if (!target) continue;

    const moved = await stripBleeds(target);

    if (!moved) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: caster }),
        content: `<p style="text-align:center;"><b>${spellName}</b> — ${target.name} is not bleeding. Nothing to transfer.</p>`,
      });
      continue;
    }

    const before = countBleedStacks(caster);
    await game.redsteel.applyEffect(caster, "bleed", {
      stacks: moved,
      caster,
    });
    const taken = Math.max(0, countBleedStacks(caster) - before);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      content: `
        <p style="text-align:center;">
          <b>${spellName}</b><br>
          ${target.name} loses <b>${moved}</b> Bleeding.<br>
          ${caster.name} takes on <b>${taken}</b>${
            taken < moved
              ? ` <span style="opacity:.8;">(${moved - taken} lost to the Bleeding cap)</span>`
              : ""
          }.
        </p>`,
    });
  }
}

/* -------------------------------------------- */
/*  Blood gift                                  */
/* -------------------------------------------- */

/**
 * "Removes all Bleeding effects from the Caster and triggers a Will Test
 * (bonus SK) vs. target's Endurance Test. On a success, it applies to the target
 * as many Bleeding effects as were removed from the Caster. On a failure, it
 * applies at most one."
 *
 * The caster's Bleeding goes regardless of how the contest turns out — that part
 * of the spell is not contested. It is stripped here, on the casting client
 * (which owns the caster), and the count travels with the payload.
 */
async function castBloodGift(actor, spell, school) {
  const { sceneId, ids } = currentTargets();
  if (!ids.length) {
    ui.notifications.warn("Blood gift: target a creature before casting.");
    return;
  }

  const carried = await stripBleeds(actor);
  if (!carried) {
    ui.notifications.info(
      "Blood gift: the caster has no Bleeding to give — nothing is transferred.",
    );
    return;
  }

  const testValue =
    attrTest(actor, "wil") + getSpellPower(actor, school ?? "blood");

  await runAsGM(
    {
      type: "bloodGift",
      casterUuid: actor.uuid,
      targetIds: ids,
      sceneId,
      testValue,
      carried,
      spellName: spell.localizedName ?? spell.name,
    },
    resolveBloodGiftAsGM,
  );
}

/**
 * GM side of Blood gift: the caster's Will + SK test against the target's
 * Endurance. Ties go to the caster, matching Binding Strike.
 * @param {{casterUuid: string, targetIds: string[], sceneId: string,
 *   testValue: number, carried: number, spellName?: string}} data
 */
export async function resolveBloodGiftAsGM({
  casterUuid,
  targetIds = [],
  sceneId,
  testValue,
  carried,
  spellName = "Blood gift",
}) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  const caster = casterUuid ? await fromUuid(casterUuid) : null;
  if (!scene || !caster) return;

  const casterTest = Number(testValue ?? 0);
  const pool = Number(carried ?? 0);

  for (const tokenId of targetIds) {
    const target = scene.tokens.get(tokenId)?.actor;
    if (!target) continue;

    const targetTest = attrTest(target, "end");

    const casterRoll = await new Roll(`${casterTest} - 1d100`).evaluate();
    const targetRoll = await new Roll(`${targetTest} - 1d100`).evaluate();
    const casterWins = casterRoll.total >= targetRoll.total;

    // "At most one" on a failure — a caster carrying a single Bleeding gives
    // that one either way.
    const stacks = casterWins ? pool : Math.min(1, pool);
    await game.redsteel.applyEffect(target, "bleed", { stacks, caster });

    const casterHTML = await casterRoll.render();
    const targetHTML = await targetRoll.render();

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      flavor: `<b>${spellName} — ${target.name}</b>`,
      rolls: [casterRoll, targetRoll],
      content: `
        <div class="dual-roll">
          <div class="roll-column">
            <div class="roll-label">${caster.name} — Will + SK (${casterTest}%)</div>
            ${casterHTML}
          </div>
          <div class="roll-column">
            <div class="roll-label">${target.name} — Endurance (${targetTest}%)</div>
            ${targetHTML}
          </div>
        </div>
        <p style="text-align:center; font-size:16px;">
          <b>${target.name} receives ${stacks} Bleeding</b>
          ${casterWins ? "" : ` <span style="opacity:.8;">(resisted — ${pool} carried)</span>`}
        </p>`,
    });
  }
}

/* -------------------------------------------- */
/*  Magic rope                                  */
/* -------------------------------------------- */

/**
 * Casting summons the rope: a marker effect on the caster carrying the baked
 * Will + SK test value, plus the card that sends it at a target. The contest is
 * not part of the cast — the rules let the rope be sent in a later round, and
 * the test repeats at the start of each round, so the card is re-posted after
 * every resolution the rope survives.
 */
async function castMagicRope(actor, spell, school) {
  const testValue =
    attrTest(actor, "wil") + getSpellPower(actor, school ?? "spirit");

  await game.redsteel.applyEffect(actor, "magic_rope", {
    caster: actor,
    school,
  });

  const rope = actor.effects.find((e) => e.statuses?.has("magic_rope"));
  if (rope) {
    await rope.update({
      name: spell.localizedName ?? spell.name ?? rope.name,
      "flags.redsteel.magicRope": { testValue, school },
    });
  }

  await postMagicRopeCard(actor, testValue);
}

/**
 * Posts the "send the rope" card. Re-posted at the end of each resolution the
 * rope survives, so the start-of-round retest is one click.
 * @param {Actor} actor - The rope's caster.
 * @param {number} testValue - Baked Will + SK.
 */
export async function postMagicRopeCard(actor, testValue) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `
      <div class="redsteel-magic-rope">
        <p style="text-align:center;">
          <b>Magic rope</b> — Will + SK <b>${testValue}%</b> vs. the target's
          better Strength / Dexterity.
        </p>
        <p style="text-align:center; font-size:11px; opacity:.8;">
          Target a creature within 15 m, then send the rope. Repeat at the start
          of each round; losing the contest destroys the rope.
        </p>
        <div class="redsteel-action-buttons">
          <button type="button" data-action="magicRopeSend">Send the rope</button>
        </div>
      </div>`,
    flags: { redsteel: { type: "magicRope", actorUuid: actor.uuid } },
  });
}

/**
 * Card button handler: gathers the sender's targets and relays the contest.
 * @param {Actor} actor - The rope's caster (resolved from the card's speaker).
 */
export async function sendMagicRope(actor) {
  const rope = actor.effects.find((e) => e.statuses?.has("magic_rope"));
  if (!rope) {
    ui.notifications.warn("Magic rope: this caster has no rope summoned.");
    return;
  }

  const { sceneId, ids } = currentTargets();
  if (!ids.length) {
    ui.notifications.warn("Magic rope: target the creature to bind.");
    return;
  }

  const binding = rope.getFlag("redsteel", "magicRope") ?? {};

  await runAsGM(
    {
      type: "magicRope",
      casterUuid: actor.uuid,
      targetIds: ids,
      sceneId,
      testValue: binding.testValue ?? 0,
    },
    resolveMagicRopeAsGM,
  );
}

/**
 * GM side of Magic rope. Caster's Will + SK against the target's better
 * Strength / Dexterity test:
 *   - caster wins  → Root for 2 of the target's turns
 *   - margin ≥ 50  → additionally Stun for 2 turns and 2d6 damage
 *   - caster loses → the rope is destroyed (the marker effect is deleted)
 *
 * Ties go to the caster, as everywhere else. "Success is 50+" is read as the
 * caster's own margin of success, not the gap between the two rolls.
 * @param {{casterUuid: string, targetIds: string[], sceneId: string,
 *   testValue: number}} data
 */
export async function resolveMagicRopeAsGM({
  casterUuid,
  targetIds = [],
  sceneId,
  testValue,
}) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  const caster = casterUuid ? await fromUuid(casterUuid) : null;
  if (!scene || !caster) return;

  const casterTest = Number(testValue ?? 0);
  let ropeSurvives = true;

  for (const tokenId of targetIds) {
    const target = scene.tokens.get(tokenId)?.actor;
    if (!target) continue;

    const targetTest = Math.max(attrTest(target, "str"), attrTest(target, "dex"));

    const casterRoll = await new Roll(`${casterTest} - 1d100`).evaluate();
    const targetRoll = await new Roll(`${targetTest} - 1d100`).evaluate();
    const casterWins = casterRoll.total >= targetRoll.total;
    const wideMargin = casterWins && casterRoll.total >= 50;

    let outcome;
    let damageRoll = null;

    if (casterWins) {
      await game.redsteel.applyEffect(target, "root", { turns: 2, caster });
      outcome = `${target.name} is Rooted for 2 turns.`;

      if (wideMargin) {
        await game.redsteel.applyEffect(target, "stun", { turns: 2, caster });

        damageRoll = await new Roll("2d6").evaluate();
        const current = Number(target.system.stats.health.value ?? 0);
        await target.update({
          "system.stats.health.value": current - damageRoll.total,
        });
        await game.redsteel.applyZeroHealthState?.(target);

        outcome = `${target.name} is Rooted and Stunned for 2 turns, and takes ${damageRoll.total} damage.`;
      }
    } else {
      ropeSurvives = false;
      const rope = caster.effects.find((e) => e.statuses?.has("magic_rope"));
      if (rope) await rope.delete();
      outcome = `${target.name} breaks free — the rope is destroyed.`;
    }

    const casterHTML = await casterRoll.render();
    const targetHTML = await targetRoll.render();

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      flavor: `<b>Magic rope — ${target.name}</b>`,
      rolls: damageRoll
        ? [casterRoll, targetRoll, damageRoll]
        : [casterRoll, targetRoll],
      content: `
        <div class="dual-roll">
          <div class="roll-column">
            <div class="roll-label">${caster.name} — Will + SK (${casterTest}%)</div>
            ${casterHTML}
          </div>
          <div class="roll-column">
            <div class="roll-label">${target.name} — Str / Dex (${targetTest}%)</div>
            ${targetHTML}
          </div>
        </div>
        <p style="text-align:center; font-size:16px;"><b>${outcome}</b></p>`,
    });
  }

  // The rope only gets another go if it survived every contest it just fought.
  if (ropeSurvives && caster.effects.some((e) => e.statuses?.has("magic_rope"))) {
    await postMagicRopeCard(caster, casterTest);
  }
}
