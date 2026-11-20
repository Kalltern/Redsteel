/**
 * Mentalist specialisation: the nodes that act around a cast rather than
 * inside it. Each is one call site in a shared file plus the code here.
 *
 * Source: docs/rules-source/rules/specializace-wip.md
 *   Mentální úder (mentalist `mentalniUder`): "Mentální úder: Zabití cíle
 *   obnoví 1 MŽ". A kill with the Mental strike spell gives the caster 1 Mind
 *   back, once per card.
 *
 *   Vytrvalá snaha (mentalist `vytrvalaSnaha`): "Jednou za kolo může vyčerpat
 *   jeden Mentální život a opakovat šanci na zahájení Mentálního souboje." A
 *   failed initiation roll may be thrown again for 1 Mind, once a round.
 *
 * Callers:
 *   - settleMentalStrikeKill: utils/applyDamage.mjs applyDamageAsGM, in the
 *     post-apply block beside offerIceShards. GM only, so the card's flag is
 *     written by the GM, the way mancerFollowups.mjs writes its own.
 *   - offerPersistentEffort: utils/castSpell.mjs maybeStartMentalDuel, after a
 *     failed initiation roll and before the voluntary acceptance request. Runs
 *     on the caster's client, which owns the caster.
 *   - applyStrainUpgrades: utils/mentalDuel.mjs applyMentalStrain, on the GM
 *     or the target's owner, once the target's Mental Strain exists.
 *   - castHiddenTelepathy: utils/castSpell.mjs castSpell and quickCastSpell,
 *     after the spell is chosen and before performCast pays for anything.
 *
 * Import cycle: this file imports mindBending.mjs, which imports
 * mentalDuel.mjs, which imports this file. Safe because none of the three
 * reads an imported binding at module top level; every use is inside a
 * function called long after all three have loaded.
 */

import { actorHasSpecNode } from "../helpers/specialisations.mjs";
import { matchesPackSpell } from "../helpers/mancerSpells.mjs";
import {
  isMindBendingDuelRunning,
  lapseMindBending,
  mindBendingEffect,
} from "./mindBending.mjs";
import { stanceAbilityFor } from "./stances.mjs";

const SYSTEM_ID = "redsteel";

/** The pack spell Mental strike (Mentální úder). */
const MENTAL_STRIKE = { id: "FX5L3udPT0TM49af", name: "Mental strike" };

/** Flag on the spell card: its kill refund was already paid. */
const MENTAL_STRIKE_REFUNDED = "mentalStrikeRefunded";

/** Was the card a cast of Mental strike? */
function isMentalStrikeCard(caster, message) {
  const spellId = message?.flags?.redsteel?.spellId;
  if (!spellId) return false;
  const spell = caster?.items?.get?.(spellId) ?? null;
  // A scroll's spell is never embedded; it keeps the pack id it was cast as
  // (the same fallback as mancerFollowups.mjs isFirmStepSpellCard).
  if (!spell) return spellId === MENTAL_STRIKE.id;
  return matchesPackSpell(spell, MENTAL_STRIKE);
}

/**
 * Apply Damage landed a spell: when it was the holder's Mental strike and it
 * killed someone, the caster regains 1 Mind, clamped to the derived maximum.
 * Once per card, however many targets fell and however often the GM
 * re-applies it.
 *
 * @param {{caster: Actor|null, school: string|null}} castingContext  the
 *   card's casting context (applyDamage.mjs getCastingContext)
 * @param {ChatMessage} message  the spell card
 * @param {string[]} killedIds  token ids this Apply Damage killed
 */
export async function settleMentalStrikeKill(castingContext, message, killedIds = []) {
  if (!message || !killedIds?.length) return;
  const caster = castingContext?.caster ?? null;
  if (!caster || !actorHasSpecNode(caster, "mentalist", "mentalniUder")) return;
  if (!isMentalStrikeCard(caster, message)) return;
  if (message.getFlag(SYSTEM_ID, MENTAL_STRIKE_REFUNDED)) return;
  await message.setFlag(SYSTEM_ID, MENTAL_STRIKE_REFUNDED, true);

  const mind = caster.system?.stats?.mind ?? {};
  const before = Number(mind.value) || 0;
  const max = Number(mind.max) || 0;
  const after = Math.max(before, Math.min(max, before + 1));
  if (after !== before) {
    await caster.update({ "system.stats.mind.value": after });
  }

  const name = foundry.utils.escapeHTML(caster.name ?? "");
  const key =
    after > before
      ? "REDSTEEL.Mentalist.MentalStrike.Card"
      : "REDSTEEL.Mentalist.MentalStrike.CardFull";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<p class="rs-card-headline"><b>${foundry.utils.escapeHTML(
      game.i18n.localize("REDSTEEL.Mentalist.MentalStrike.Title"),
    )}</b></p>
<p style="text-align:center;">${game.i18n.format(key, { name })}</p>`,
  });
}

/* -------------------------------------------- */
/*  Vytrvalá snaha (Persistent Effort)          */
/* -------------------------------------------- */

/** Actor flag: the combat and round Persistent Effort was last used in. */
const PERSISTENT_EFFORT_FLAG = "persistentEffort";

/** Mind exhausted (not burned) for the reroll. */
const PERSISTENT_EFFORT_COST = 1;

/** True when the caster already used Persistent Effort this combat round. */
function persistentEffortUsedThisRound(actor) {
  const combat = game.combat;
  if (!combat?.started) return false;
  const used = actor.getFlag(SYSTEM_ID, PERSISTENT_EFFORT_FLAG);
  return used?.combat === combat.id && used?.round === combat.round;
}

/**
 * Offer Persistent Effort after a failed initiation roll: spend 1 Mind to roll
 * the initiation again against the same chance. Once a round inside a started
 * combat (stamped on the caster); outside combat the caller offers it at most
 * once per cast, so no stamp is needed there.
 *
 * The Mind is exhausted, a plain decrease of the current value; the maximum is
 * untouched (a burn would also lower it, see mindPoints.mjs).
 *
 * @param {Actor} actor  the caster
 * @param {number} chance  the initiation chance the reroll is thrown against
 * @returns {Promise<boolean>} true when the Mind was spent and the caller
 *   should roll again
 */
export async function offerPersistentEffort(actor, chance) {
  if (!actor || !actorHasSpecNode(actor, "mentalist", "vytrvalaSnaha")) {
    return false;
  }
  const mind = Number(actor.system?.stats?.mind?.value) || 0;
  if (mind < PERSISTENT_EFFORT_COST) return false;
  if (persistentEffortUsedThisRound(actor)) return false;

  const DialogV2 = foundry.applications.api.DialogV2;
  const answer = await DialogV2.wait({
    window: {
      title: game.i18n.localize("REDSTEEL.Mentalist.PersistentEffort.Title"),
    },
    content: `
      <p style="margin-top:0;">
        ${game.i18n.format("REDSTEEL.Mentalist.PersistentEffort.Intro", {
          chance,
          mind,
        })}
      </p>`,
    buttons: [
      {
        action: "reroll",
        label: game.i18n.format("REDSTEEL.Mentalist.PersistentEffort.Reroll", {
          chance,
        }),
        icon: "fas fa-brain",
        default: true,
      },
      {
        action: "skip",
        label: game.i18n.localize("REDSTEEL.Mentalist.PersistentEffort.Skip"),
      },
    ],
    rejectClose: false,
  });
  if (answer !== "reroll") return false;

  // Re-read: the Mind may have moved while the dialog was open.
  const now = Number(actor.system?.stats?.mind?.value) || 0;
  if (now < PERSISTENT_EFFORT_COST) return false;
  await actor.update({
    "system.stats.mind.value": Math.max(0, now - PERSISTENT_EFFORT_COST),
  });

  const combat = game.combat;
  if (combat?.started) {
    await actor.setFlag(SYSTEM_ID, PERSISTENT_EFFORT_FLAG, {
      combat: combat.id,
      round: combat.round,
    });
  }
  return true;
}

/* -------------------------------------------- */
/*  Mentální vytížení upgrades (Mental Strain)  */
/* -------------------------------------------- */

/*
 * Source: docs/rules-source/rules/specializace-wip.md r1370. The Mentalist's
 * own Mental Strain gains, per node the CASTER holds:
 *   vytizeniKoncentrace "Ruší Koncentrace a postoje"
 *   vytizeniReakce      "-1 Reakce"
 *   vytizeniZakerne     "Útoky na cíl se počítají jako Zákeřné"
 *   vytizeniAkce        "-1 Akce"
 *
 * The strain is one effect on the target (stackBehavior "ignore"), so the
 * upgrades are stamped on it as `flags.redsteel.strainUpgrades =
 * {concentration?, reaction?, sneak?, action?}` and merged: a second caster
 * only ever adds, never takes away an upgrade the first one gave. The -1
 * Reaction / -1 Action are AE changes on that same effect, so they go when
 * the strain is lifted (mindBending.mjs liftTargetStrain deletes it). The
 * Sneak clause is read by utils/sneakTriggers.mjs ("mentalStrain").
 *
 * The cancel bites once, when the strain lands (user ruling): every
 * application that carries the concentration upgrade cancels what the target
 * is holding at that moment, and nothing is cancelled later while the strain
 * sits on it.
 */

/** Strain upgrade → the Mentalist node that grants it. */
export const STRAIN_UPGRADE_NODES = {
  concentration: "vytizeniKoncentrace",
  reaction: "vytizeniReakce",
  sneak: "vytizeniZakerne",
  action: "vytizeniAkce",
};

/** Flag on the target's `mental_strain` effect: the upgrades it carries. */
export const STRAIN_UPGRADES_FLAG = "strainUpgrades";

/** The AE change each economy upgrade adds to the strain, at most once. */
const STRAIN_UPGRADE_CHANGES = {
  reaction: { key: "system.actionEconomy.reactions", type: "add", value: -1 },
  action: { key: "system.actionEconomy.actions", type: "add", value: -1 },
};

/**
 * The strain upgrades this caster gives, as `{upgrade: true}` for each node
 * held. PCs and NPCs alike.
 * @param {Actor|null} caster
 * @returns {{concentration?: true, reaction?: true, sneak?: true, action?: true}}
 */
export function strainUpgradesOf(caster) {
  const out = {};
  if (!caster) return out;
  for (const [upgrade, node] of Object.entries(STRAIN_UPGRADE_NODES)) {
    if (actorHasSpecNode(caster, "mentalist", node)) out[upgrade] = true;
  }
  return out;
}

/** The target's live `mental_strain` effect, or null. */
function mentalStrainEffect(actor) {
  return (
    actor?.effects?.contents?.find((e) => e.statuses?.has("mental_strain")) ??
    null
  );
}

/**
 * Stamp the caster's strain upgrades on the target's Mental Strain, then run
 * the Concentration cancel when this caster carries it. Runs where the user
 * may write to the target (the GM, or the target's owner; see
 * mentalDuel.mjs applyMentalStrain), after the strain exists.
 *
 * @param {Actor} targetActor
 * @param {Actor} casterActor
 * @param {{casterTokenUuid?: string|null}} [options]  the caster's token, so
 *   the cancel can tell the duel this caster is opening apart from others.
 */
export async function applyStrainUpgrades(
  targetActor,
  casterActor,
  { casterTokenUuid = null } = {},
) {
  if (!targetActor || !casterActor) return;
  const given = strainUpgradesOf(casterActor);
  if (!Object.keys(given).length) return;
  const effect = mentalStrainEffect(targetActor);
  if (!effect) return;

  const had = effect.getFlag(SYSTEM_ID, STRAIN_UPGRADES_FLAG) ?? {};
  const update = {};
  for (const upgrade of Object.keys(given)) {
    if (had[upgrade] !== true) {
      update[`flags.${SYSTEM_ID}.${STRAIN_UPGRADES_FLAG}.${upgrade}`] = true;
    }
  }

  const changes = effect.toObject().changes ?? [];
  let changesAdded = false;
  for (const [upgrade, change] of Object.entries(STRAIN_UPGRADE_CHANGES)) {
    if (!given[upgrade]) continue;
    if (changes.some((c) => c?.key === change.key)) continue;
    changes.push({ ...change, priority: null });
    changesAdded = true;
  }
  if (changesAdded) update.changes = changes;

  if (Object.keys(update).length) await effect.update(update);

  if (given.concentration) {
    await cancelConcentration(targetActor, casterActor, { casterTokenUuid });
  }
}

/**
 * Vytížení: ruší Koncentrace a postoje. Deletes on the target every
 * channelled spell (an effect carrying `channelingData`, the held casts of
 * utils/actionSuggestions.mjs sustainChips), every stance (an effect
 * utils/stances.mjs stanceAbilityFor ties to a stance ability, held with or
 * without an upkeep), and lets the target's own Mind Bending lapse
 * (mindBending.mjs lapseMindBending, GM side; it ends a duel that spell
 * holds). The one exception is the duel this caster is opening against the
 * target: lapsing the target's Mind Bending there would end it on the spot.
 * One short card names what went; none when nothing did.
 *
 * @param {Actor} targetActor
 * @param {Actor} casterActor
 * @param {{casterTokenUuid?: string|null}} [options]
 */
async function cancelConcentration(
  targetActor,
  casterActor,
  { casterTokenUuid = null } = {},
) {
  const names = [];
  const ids = [];
  for (const effect of targetActor.effects.contents) {
    if (effect.statuses?.has("mental_strain")) continue;
    const data = effect.getFlag?.(SYSTEM_ID, "channelingData");
    if (data) {
      const spell =
        targetActor.items.get(data.spellId) ?? game.items.get(data.spellId) ?? null;
      ids.push(effect.id);
      names.push(spell?.localizedName ?? spell?.name ?? effect.name);
      continue;
    }
    const ability = stanceAbilityFor(targetActor, effect);
    if (ability) {
      ids.push(effect.id);
      names.push(ability.localizedName ?? ability.name);
    }
  }

  // Re-read just before the delete: a second application landing at the
  // same moment may already have taken some of them.
  const live = ids.filter((id) => targetActor.effects.has(id));
  if (live.length) {
    await targetActor.deleteEmbeddedDocuments("ActiveEffect", live);
  }

  if (mindBendingEffect(targetActor) && game.user.isGM) {
    const duel = game.settings.get("redsteel", "mentalDuelActive");
    const thisDuel =
      !!casterTokenUuid &&
      duel?.attackerUuid === casterTokenUuid &&
      isMindBendingDuelRunning(targetActor);
    if (!thisDuel) {
      await lapseMindBending(targetActor, { silent: true });
      names.push(game.i18n.localize("REDSTEEL.MindBendingUpkeep.Title"));
    }
  }

  if (!names.length) return;
  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: casterActor }),
    content: `<p class="rs-card-headline"><b>${esc(
      game.i18n.localize("REDSTEEL.Mentalist.StrainCancel.Title"),
    )}</b></p>
<p style="text-align:center;">${game.i18n.format(
      "REDSTEEL.Mentalist.StrainCancel.Card",
      { target: esc(targetActor.name), list: names.map(esc).join(", ") },
    )}</p>`,
  });
}

/* -------------------------------------------- */
/*  Telepat I (hidden Telepathy)                */
/* -------------------------------------------- */

/** The pack spell Telepathy (Telepatie). */
const TELEPATHY = { id: "4QENA3tyVgydt6ZB", name: "Telepathy" };

/**
 * Telepat I (mentalist `telepat1`, book r1402): "Umožňuje sesílat kouzlo
 * Telepatie zdarma jako Volnou akci bez nutnosti Testu Usměrňování. Sesílání
 * Telepatie je skryté a nepovažuje se za aktivní magii."
 *
 * For a holder casting Telepathy this replaces the whole cast: no Mana, no
 * Action, no Channeling roll and no casting card for the table, and so none
 * of what a cast normally triggers (caster effects, Lindar, the next spell's
 * discounts, Channeling upkeep). Instead one card is whispered to every GM,
 * the caster's owners and the targeted token's owners.
 *
 * Called from the two casts of an owned spell, castSpell and quickCastSpell
 * (utils/castSpell.mjs), right before performCast, the same place the mancer
 * spell lock is read. A scroll does not come here: breaking a seal is reading
 * the scroll, not the holder's own Telepathy.
 *
 * @param {Actor} actor  the caster
 * @param {Item} spell  the spell chosen (variant resolved)
 * @param {Token|null} [token]  the caster's token
 * @returns {Promise<boolean>} true when the cast was handled here and the
 *   caller must stop.
 */
export async function castHiddenTelepathy(actor, spell, token = null) {
  if (!actor || !spell) return false;
  if (!actorHasSpecNode(actor, "mentalist", "telepat1")) return false;
  if (!matchesPackSpell(spell, TELEPATHY)) return false;

  const target = [...(game.user?.targets ?? [])][0] ?? null;
  const targetActor = target?.actor ?? null;
  const ownersOf = (a) =>
    a
      ? game.users.filter((u) => !u.isGM && a.testUserPermission(u, "OWNER"))
      : [];
  const whisper = [
    ...new Set(
      [
        ...game.users.filter((u) => u.isGM),
        ...ownersOf(actor),
        ...ownersOf(targetActor),
      ].map((u) => u.id),
    ),
  ];

  const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
  const caster = esc(token?.name ?? actor.name);
  const line = target
    ? game.i18n.format("REDSTEEL.Mentalist.Telepathy.Card", {
        caster,
        target: esc(target.name),
      })
    : game.i18n.format("REDSTEEL.Mentalist.Telepathy.CardNoTarget", { caster });

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: token?.document ?? token }),
    whisper,
    content: `<p class="rs-card-headline"><b>${esc(
      game.i18n.localize("REDSTEEL.Mentalist.Telepathy.Title"),
    )}</b></p>
<p style="text-align:center;">${line}</p>`,
  });
  return true;
}
