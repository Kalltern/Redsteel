/**
 * Velení — Leadership Commands.
 *
 * A Commander spends an action, tests Leadership, and improves the people
 * fighting alongside them. The rules split the ten Commands into two halves,
 * one unlocked per rank of the Leadership skill:
 *
 *   Ranks 1-5, Passive Commands — an aura on every ally within earshot
 *     (Nerves +1, Speed +1, Hit +5%, Melee Defense +5%, Cover +10%). It lasts
 *     until the Commander falls or the fight ends, and a new Passive Command
 *     replaces the one before it. These are fully automated here.
 *
 *   Ranks 6-10, Active Commands — a one-off order to a single chosen ally
 *     (Advantage on their next Defense / Attack, an immediate Disengage or
 *     Opportunity Attack Reaction) or a mark on one enemy. These roll the test
 *     and post the card; the table applies the result by hand, which is what
 *     the "Resolve manually" line on the card is for.
 *
 * ## Who is affected
 * Whoever the Commander has *targeted* — earshot is a table judgement, not a
 * measured radius, so the targeting reticule is the input. The Commander is
 * excluded from their own aura unless they own the Battlebrother feature
 * ("Your passive Leadership command effects now also apply to you"), and the
 * Magic Commander feature adds Channeling +5% to the aura it hands out.
 *
 * ## Why the effects are applied by the GM
 * A player commanding another player's character is writing to an actor they
 * do not own, so the aura is relayed over the system socket and created on the
 * GM client — the same route Apply Effects and Binding Strike already take.
 *
 * ## How an aura is recognised again later
 * Every applied aura carries `flags.redsteel.command` = `{ commander, rank,
 * key, commanderName }`. That flag, not the status id, is what the override
 * rule, the combat-end sweep and the commander-falls sweep all match on, so a
 * later Command that reuses an existing status still ends the previous one.
 */

import { SOCKET } from "./applyDamage.mjs";

/**
 * The ten Commands, keyed by the ability item's `system.key`.
 * `aura` is the effect definition applied to each commanded ally (Passive
 * Commands only); a null `aura` marks the Active Commands, which are resolved
 * at the table for now.
 */
export const COMMANDS = {
  commandNerve: { rank: 1, aura: "command_nerve" },
  commandSpeed: { rank: 2, aura: "command_speed" },
  commandHit: { rank: 3, aura: "command_hit" },
  commandDefense: { rank: 4, aura: "command_defense" },
  commandCover: { rank: 5, aura: "command_cover" },
  commandBrace: { rank: 6, aura: null },
  commandStrikeNow: { rank: 7, aura: null },
  commandFallBack: { rank: 8, aura: null },
  commandOpening: { rank: 9, aura: null },
  commandMark: { rank: 10, aura: null },
};

/** Statuses that mean the Commander is no longer commanding anyone. */
const COMMANDER_DOWN_STATUSES = ["dying", "downed", "incapacitated", "dead"];

const loc = (key, data) =>
  game.i18n.format(`REDSTEEL.Command.${key}`, data ?? {});

/** Owning a named feature — the two Commander features are matched by name. */
function hasFeature(actor, name) {
  return !!actor?.items?.some((i) => i.type === "feature" && i.name === name);
}

/**
 * Every actor that could be carrying a Command aura: the tokens on the current
 * scene plus the combatants of the active encounter, deduplicated. Same scope
 * (and the same `.contents` caveat — a Collection's iterator silently yields
 * nothing here) as the Bane mark sweep in baneCombat.mjs.
 * @returns {Actor[]}
 */
function commandCandidates() {
  const actors = new Map();

  const sceneTokens =
    canvas.scene?.tokens?.contents ?? canvas.tokens?.placeables ?? [];
  for (const token of sceneTokens) {
    if (token?.actor) actors.set(token.actor.uuid, token.actor);
  }

  for (const combatant of game.combat?.combatants?.contents ?? []) {
    if (combatant?.actor) actors.set(combatant.actor.uuid, combatant.actor);
  }

  return [...actors.values()];
}

/**
 * Delete the Command auras on one actor.
 * @param {Actor} actor
 * @param {string|null} commanderUuid  Only auras placed by this Commander;
 *   null clears whoever placed them (the override rule and combat end).
 * @returns {number} How many auras were removed.
 */
async function clearCommandsOn(actor, commanderUuid = null) {
  const effects = actor.effects.filter((e) => {
    const flag = e.getFlag("redsteel", "command");
    if (!flag) return false;
    return commanderUuid === null || flag.commander === commanderUuid;
  });
  if (!effects.length) return 0;
  await actor.deleteEmbeddedDocuments(
    "ActiveEffect",
    effects.map((e) => e.id),
  );
  return effects.length;
}

/**
 * Sweep Command auras off the whole board.
 * @param {string|null} commanderUuid  Null clears every Command in play.
 * @returns {number} How many auras were removed.
 */
export async function clearCommandsBy(commanderUuid = null) {
  let removed = 0;
  for (const actor of commandCandidates()) {
    removed += await clearCommandsOn(actor, commanderUuid);
  }
  return removed;
}

/**
 * The tokens this Command is aimed at. Notifies and returns null when nothing
 * is targeted — call this *before* anything is spent.
 * @returns {Token[]|null}
 */
export function getCommandTargets() {
  const targets = [...(game.user.targets ?? [])].filter((t) => t?.id);
  if (!targets.length) {
    ui.notifications.warn(loc("NoTargets"));
    return null;
  }
  return targets;
}

/**
 * Issue a Command: the Leadership test has already been rolled by the caller,
 * this decides what the result does and posts the card.
 *
 * @param {Actor}  actor    The Commander.
 * @param {Item}   ability  The Command ability item.
 * @param {Token[]} targets Targeted tokens (from {@link getCommandTargets}).
 * @param {{roll: Roll, label: string, html: string}|null} test
 *   The rolled Leadership test, as returned by combatAbilities' rollUtilityTest.
 */
export async function runCommand(actor, ability, targets, test) {
  const key = ability.system.key;
  const command = COMMANDS[key];
  if (!command) {
    ui.notifications.warn(loc("Unknown", { key: key ?? "—" }));
    return;
  }
  // Every Command is a Leadership test; an item missing its Test Type would
  // otherwise succeed silently and for free.
  if (!test) {
    ui.notifications.warn(loc("NoTest"));
    return;
  }

  const succeeded = test.roll.total >= 0;
  const name = ability.localizedName ?? ability.name;
  const targetNames = targets.map((t) => t.name).join(", ");

  if (succeeded && command.aura) {
    await issueAura(actor, ability, command, targets);
  }

  const kindLabel = command.aura ? loc("Passive") : loc("Active");
  const outcome = succeeded ? loc("Success") : loc("Failure");
  // No "resolve manually" line here: the Active Commands carry that appendix in
  // their own description, which the card already prints.

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    rolls: [test.roll],
    content: `
<div class="dual-roll">
  <div class="roll-column">
    <div class="roll-label">${test.label}</div>
    ${await test.roll.render()}
  </div>
</div>`,
    flavor: `
<span style="display:inline-flex; align-items:center;">
  <img src="${ability.img}" width="36" height="36" style="margin-right:8px;">
  <strong style="font-size:20px;">${name}</strong>
</span>
<hr>
<div style="text-align:center; font-size:16px;">
  ${ability.system.description ?? ""}
  <hr>
  ${test.html}
  <p style="font-size:13px; opacity:0.85;">${kindLabel} · ${loc("Commanded")}: ${targetNames}</p>
  <p style="font-size:16px;"><b>${outcome}</b></p>
</div>`,
  });
}

/**
 * Hand the aura to the GM client (or apply it directly when we are the GM).
 * The Commander's own features are read here, on the client that owns them,
 * and travel as plain booleans — the GM side never re-derives them.
 */
async function issueAura(actor, ability, command, targets) {
  const payload = {
    type: "commandApply",
    commanderUuid: actor.uuid,
    commandKey: ability.system.key,
    rank: command.rank,
    effectId: command.aura,
    sceneId: canvas.scene?.id,
    targetIds: targets.map((t) => t.id),
    // "Bez patřičné odbornosti se velitelské bonusy nevztahují na velitele
    // samotného" — Battlebrother is that odbornost.
    includeSelf: hasFeature(actor, "Battlebrother"),
    channeling: hasFeature(actor, "Magic Commander"),
    auraName: loc("AuraName", {
      command: ability.localizedName ?? ability.name,
      commander: actor.name,
    }),
  };

  if (game.user.isGM) {
    await applyCommandAsGM(payload);
  } else {
    game.socket.emit(SOCKET, payload);
    ui.notifications.info(loc("Relayed"));
  }
}

/**
 * Create the aura on each commanded ally. GM-only: a player may not write an
 * Active Effect onto someone else's character.
 */
export async function applyCommandAsGM({
  commanderUuid,
  commandKey,
  rank,
  effectId,
  sceneId,
  targetIds = [],
  includeSelf = false,
  channeling = false,
  auraName = "",
}) {
  const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
  const commander = commanderUuid ? await fromUuid(commanderUuid) : null;

  const targets = new Map();
  for (const tokenId of targetIds) {
    const actor = scene?.tokens.get(tokenId)?.actor;
    if (actor) targets.set(actor.uuid, actor);
  }
  if (includeSelf && commander) targets.set(commander.uuid, commander);
  if (!targets.size) return;

  // Collected rather than announced per ally: re-issuing a Command to a squad
  // of six would otherwise stack six identical notifications.
  const replacedNames = [];

  for (const target of targets.values()) {
    // One Command at a time, whoever gave it: a new order replaces the old.
    if (await clearCommandsOn(target, null)) replacedNames.push(target.name);

    const applied = await game.redsteel.applyEffect(target, effectId);
    if (!applied) continue;

    // Read the changes back off the created document rather than the CONFIG
    // definition — applyEffect has already written the definition's changes,
    // and Magic Commander only adds to them.
    const changes = applied.toObject().changes ?? [];
    if (channeling) {
      changes.push({
        key: "system.combatSkills.channeling.bonus",
        mode: CONST.ACTIVE_EFFECT_CHANGE_TYPES.ADD,
        value: 5,
        priority: null,
      });
    }

    await applied.update({
      // Naming the Commander on the effect is what makes a table of six
      // buffed allies readable at a glance.
      ...(auraName ? { name: auraName } : {}),
      changes,
      "flags.redsteel.command": {
        commander: commanderUuid ?? null,
        commanderName: commander?.name ?? "",
        rank,
        key: commandKey,
      },
    });
  }

  if (replacedNames.length) {
    ui.notifications.info(loc("Replaced", { name: replacedNames.join(", ") }));
  }
}

/**
 * Combat end and "the Commander falls" both end every aura that Commander
 * placed. Only the active GM performs the deletions — the hooks fire on every
 * client, and players cannot write to the actors involved.
 */
export function registerCommandHooks() {
  const isActingGM = () =>
    game.user.isGM && game.user.id === game.users.activeGM?.id;

  // "Trvá, dokud velitel nepadne nebo dokud souboj neskončí."
  Hooks.on("deleteCombat", async () => {
    if (!isActingGM()) return;
    await clearCommandsBy(null);
  });

  // The Commander goes down — Dying, Downed, unconscious or dead all count.
  Hooks.on("createActiveEffect", async (effect) => {
    if (!isActingGM()) return;
    if (!COMMANDER_DOWN_STATUSES.some((s) => effect.statuses?.has(s))) return;

    const commander = effect.parent;
    if (commander?.documentName !== "Actor") return;

    const removed = await clearCommandsBy(commander.uuid);
    if (removed) {
      ui.notifications.info(loc("CommanderDown", { name: commander.name }));
    }
  });
}
