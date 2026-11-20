/**
 * Mancer follow-ups: the cryomancer, geomancer, pyromancer, entomancer and
 * astramancer nodes that act around a cast rather than inside it (that is
 * helpers/mancerPassives.mjs). Each is one call site in a shared file plus
 * the code here.
 *
 * Source: docs/rules-source/rules/specializace-wip.md
 *   r967  Ledové kopí (cryomancer `ledoveKopi`): "Ledové kopí: Zasahuje až
 *         tři cíle". The spell itself hits up to two.
 *   r987  Ledové úlomky (cryomancer `ledoveUlomky`): "Zabije-li cíl ledovým
 *         kouzlem, dělí se přebytečné zranění do sousedních cílů dle výběru
 *         sesilatele."
 *   r1064 Kamenná kůže (geomancer `kamennaKuze`): "Kamenná kůže: Obětování
 *         zbroje Omráčí zvolené sousedy". Omráčení = Stagger (`stagger`).
 *   r1087 Pevný krok (geomancer `pevnyKrok`): "Ruší postihy za Těžký terén a
 *         získává Výhodu na Testy na odolání efektům Tekutého písku, Kořenů a
 *         Povalení."
 *   r1501 Ohnivá aura (pyromancer `ohnivaAura`): "Ohnivá aura: Podpálení
 *         +5%". The Fiery Aura spell's own bonus is +10% Burn to the hostile
 *         in a 6 m area around the caster.
 *   r1041 Travič III (entomancer `travic3`): "Pokud by měl být již Otrávený
 *         cíl být znovu Otráven, může místo toho Otrávit sousedící cíl."
 *   r877  Řetězení (astramancer `retezeni`): offensive Air spells, +35% chance
 *         to Chain. The chained bolt deals half damage, same Penetration, to
 *         a target within 4,5 m the caster picks. Its "+35% against a Wet
 *         target" is the general rule (ruzne-info r1365), already added by
 *         the Wet status's own effectMods.chain change, so nothing here adds
 *         it again.
 *   r879  Dvojité řetězení (astramancer `dvojiteRetezeni`): +15% chance, and a
 *         chain hits one more target; no target twice.
 *         Blesková odolnost (astramancer `bleskovaOdolnost`): free action, 10
 *         Mana: if he would be Staggered he can spend 10 Mana to avoid it.
 *         Řetězový blesk (astramancer `retezovyBlesk`): "Cíl +1". The spell
 *         itself hits up to five.
 *
 * Callers:
 *   - spellTargetCapRefusal: utils/castSpell.mjs performCast, before anything
 *     is paid. performCast is shared by the cast dialog, the quick cast and a
 *     scroll, so the cap is a property of the spell.
 *   - offerIceShards, offerChaining: utils/applyDamage.mjs applyDamageAsGM,
 *     after the loop.
 *   - offerLightningResilience: utils/applyDamage.mjs applyEffectToActor,
 *     shared by applyDamageAsGM and applyEffectsAsGM.
 *   - resolveLightningResilienceAsGM: the card's button on the GM, and the
 *     "lightningResilience" socket request in module/redsteel.mjs.
 *   - claimMancerFollowup: applyDamageAsGM and applyEffectsAsGM, first thing.
 *   - STONE_SKIN_DURABILITY, getStoneSkinDurability, stoneSkinLabel,
 *     sacrificeStoneSkin: the Apply Damage dialog's durability sacrifice and
 *     its GM resolution (utils/applyDamage.mjs).
 *   - firmStepAdvantage: utils/attributeFollowup.mjs rollAttributeFollowup.
 *   - fieryAuraBurnBonus: utils/applyDamage.mjs openDamageSelectionDialog
 *     (the Burn box's default tick).
 *   - applyFieryAura: utils/castSpell.mjs applyPostCastEffects.
 *   - offerPoisonerRedirect: applyDamageAsGM and applyEffectsAsGM, after a
 *     Poison lands on a target that already had one.
 *   - registerMancerFollowupHooks: module/redsteel.mjs (the card buttons).
 *
 * Rulings (lead, 2026-11-17):
 *   - Ice Lance: the targets counted are the targeted tokens other than the
 *     caster's own, as Cleave counts them (vanguard.mjs). Two, three with the
 *     node; NPCs get two. No target at all is not refused.
 *   - Ice Shards: an "ice spell" is a card cast by the holder, of the School
 *     of Water, whose damage types include Frost. "Kill" is the dead-only
 *     kill Half Pirouette reads. The excess is the damage past 0 Life. The
 *     caster splits it among the tokens next to the victim; each share is a
 *     NEW Frost hit their own armor and resistances reduce, landed as an
 *     environment card. That card has no casting context, so shards never
 *     chain into more shards.
 *   - Stone Skin: an unarmored wearer holds one point of armor durability,
 *     sacrificed in the Apply Damage dialog like an item's. The effect and
 *     its armor stay. When the caster holds Kamenná kůže, the wearer may then
 *     Stagger the neighbours they pick (default duration).
 *   - Pevný krok: Advantage on answering Roots, Quicksand or a Prone test.
 *     The system has no Difficult Terrain, so that half needs nothing.
 *   - Fiery Aura: a marker status on the caster. "6 m around the caster" is 4
 *     hexes. Hostile means opposite token dispositions (Friendly against
 *     Hostile); Neutral and Secret never count. Several auras do not add up:
 *     the highest one counts. Only the Apply Damage preview reads it, where
 *     the Burn box's default is decided.
 *   - Travič III: the holder's School of Earth card Poisons an already
 *     Poisoned target. The card offers to move that Poison onto one neighbour
 *     instead: the neighbour gets 1 Poison from the original caster (so
 *     Toxiny still applies), and the stack the victim just gained is taken
 *     back. At Poison's cap the re-apply only refreshed the clock, so there
 *     is no stack to take back. Ignoring the card keeps the stack.
 *   - Chain lightning: five targets, six with Řetězový blesk, counted as Ice
 *     Lance counts them.
 *   - Řetězení: Chain is a chance row per target in Apply Damage, like
 *     Stagger, never applied as an effect (the Apply Effects path drops it:
 *     a chain needs damage). A ticked row posts an offer card per victim; the
 *     caster picks one target within 3 hexes of the victim and the chained
 *     bolt lands itself as an environment card with the spell's damage types,
 *     half the damage that victim was dealt (before armor) and the same
 *     Penetration. Dvojité řetězení hops once more from the chained target,
 *     still half of the ORIGINAL damage, never onto a target this chain
 *     already hit. A chain hit never chains on its own.
 *   - Blesková odolnost: an owner's card when a NEW Stagger lands on the
 *     holder with 10 Mana or more. Spending removes that Stagger.
 *
 * The cards are posted by the GM applying the damage or effects. A player's click is
 * relayed through the existing GM paths (the "applyDamage" and
 * "applyEffects" socket payloads); claimMancerFollowup, on the GM, is what
 * marks a card used, so it is used once whoever clicks. Blesková odolnost
 * applies nothing, so it has its own "lightningResilience" request, and
 * resolveLightningResilienceAsGM marks its card.
 */

import {
  CHAIN_LIGHTNING_SPELL,
  FIERY_AURA_SPELL,
  hasMancerNode,
  wearsStoneSkinArmor,
} from "../helpers/mancerPassives.mjs";
import { matchesPackSpell } from "../helpers/mancerSpells.mjs";
import { SOCKET, applyDamageAsGM, applyEffectsAsGM } from "./applyDamage.mjs";
import { pushForCard } from "./forcedMovement.mjs";
import { areAdjacent, tokenHexDistance } from "./positioning.mjs";

const SYSTEM_ID = "redsteel";

const L = (key) => game.i18n.localize(`REDSTEEL.MancerFollowups.${key}`);
const F = (key, data) => game.i18n.format(`REDSTEEL.MancerFollowups.${key}`, data);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** A token next to the victim / wearer that a follow-up may reach. */
function neighbourTokens(scene, centre) {
  return scene.tokens.contents.filter((other) => {
    if (other.id === centre.id || !other.actor) return false;
    if (other.hidden && !game.user.isGM) return false;
    if (other.actor.statuses?.has("dead")) return false;
    return areAdjacent(centre, other);
  });
}

/** Put a button into the card's container, or drop it for everyone else. */
function wireButton(button, { allowed, spent, onClick }) {
  if (!allowed) {
    button.closest(".button-container")?.remove();
    return;
  }
  button.disabled = !!spent;
  if (spent) {
    button.dataset.tooltip = L("AlreadyUsed");
    return;
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    onClick(button);
  });
}

/* -------------------------------------------- */
/*  Spell target caps (Ledové kopí,             */
/*  Řetězový blesk)                             */
/* -------------------------------------------- */

/** The Ice lance pack spell (All-Spells, Water, Master). */
export const ICE_LANCE_SPELL = { id: "aEEDVBUB2ntCyFlX", name: "Ice lance" };

/**
 * Spells that strike a fixed number of targets, and the node that adds one:
 *   spell  the pack spell ({id, name}); its variants count as the spell
 *   base   targets the spell itself strikes
 *   spec / node  the star that raises the cap by one
 */
const SPELL_TARGET_CAPS = [
  // r967 Ledové kopí: "Zasahuje až tři cíle". The spell hits up to two.
  { spell: ICE_LANCE_SPELL, base: 2, spec: "cryomancer", node: "ledoveKopi" },
  // Řetězový blesk "Cíl +1": the spell hits up to five.
  { spell: CHAIN_LIGHTNING_SPELL, base: 5, spec: "astramancer", node: "retezovyBlesk" },
];

/** A spell's variant ids (system.variants, array or object form). */
function variantIdsOf(spell) {
  const raw = spell?.system?.variants;
  const ids = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return ids.filter((id) => typeof id === "string").map((id) => id.trim());
}

/**
 * The pack spell itself, or a variant of it. A variant carries no link back
 * to its parent: the parent lists it in `system.variants`, so the caster's own
 * copy of the pack spell is asked whether it names this spell.
 */
function isCappedSpell(actor, spell, ref) {
  if (matchesPackSpell(spell, ref)) return true;
  const id = spell?.id;
  if (!id) return false;
  return (actor?.items?.contents ?? []).some(
    (item) =>
      item.type === "spell" &&
      matchesPackSpell(item, ref) &&
      variantIdsOf(item).includes(id),
  );
}

/**
 * Why this spell cannot be cast at the current targets, localized, or null
 * when it has no cap or the targets fit it. Same count as
 * cleaveTargetRefusal (vanguard.mjs): every targeted token but the caster's
 * own.
 *
 * @param {Actor} actor
 * @param {Token|null} token  the caster's token
 * @param {Item} spell
 * @param {Token[]} targets
 * @returns {string|null}
 */
export function spellTargetCapRefusal(actor, token, spell, targets = []) {
  const cap = SPELL_TARGET_CAPS.find((entry) => isCappedSpell(actor, spell, entry.spell));
  if (!cap) return null;
  const count = targets.filter(
    (t) => t && t !== token && t.id !== token?.id,
  ).length;
  const max = cap.base + (hasMancerNode(actor, cap.spec, cap.node) ? 1 : 0);
  if (count <= max) return null;
  return F("TooManyTargets", {
    spell: spell.localizedName ?? spell.name,
    count,
    max,
  });
}

/* -------------------------------------------- */
/*  Ledové úlomky (Ice Shards)                  */
/* -------------------------------------------- */

/** Flag on the offer card. */
const ICE_SHARDS_OFFER = "iceShardsOffer";
/** Flag on the spell card: victims already offered, `{tokenId: true}`. */
const ICE_SHARDS_OFFERED = "iceShardsOffered";

/** Does this card deal Frost damage? */
function isFrostCard(message) {
  const expression = message?.flags?.attack?.damageProfile?.expression ?? [];
  return expression.some((token) => String(token ?? "").toLowerCase() === "frost");
}

/**
 * Apply Damage landed a spell: when it was the holder's Frost Water spell and
 * it killed someone with damage to spare, post one card per such victim
 * offering that excess to the neighbours. GM only (applyDamageAsGM). Once per
 * victim per card, so the GM re-applying it offers nothing new.
 *
 * @param {{caster: Actor|null, school: string|null}} castingContext  the
 *   card's casting context (applyDamage.mjs getCastingContext)
 * @param {ChatMessage} message  the spell card
 * @param {Scene|null} scene
 * @param {{tokenId: string, excess: number}[]} kills
 */
export async function offerIceShards(castingContext, message, scene, kills = []) {
  if (!message || !scene) return;
  // A shard card has no casting context and never offers shards of its own.
  if (message.flags?.redsteel?.iceShards) return;
  const caster = castingContext?.caster ?? null;
  if (!caster || castingContext.school !== "water") return;
  if (!hasMancerNode(caster, "cryomancer", "ledoveUlomky")) return;
  if (!isFrostCard(message)) return;

  const offered = { ...(message.getFlag(SYSTEM_ID, ICE_SHARDS_OFFERED) ?? {}) };
  const fresh = kills.filter(
    (k) => k?.tokenId && Number(k.excess) > 0 && !offered[k.tokenId],
  );
  if (!fresh.length) return;
  for (const kill of fresh) offered[kill.tokenId] = true;
  await message.setFlag(SYSTEM_ID, ICE_SHARDS_OFFERED, offered);

  const title = L("IceShardsTitle");
  const buttonLabel = esc(L("IceShardsButton"));
  for (const { tokenId, excess } of fresh) {
    const victim = scene.tokens.get(tokenId);
    if (!victim) continue;
    const amount = Math.floor(Number(excess));
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: caster }),
      content: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
<p style="text-align:center;">${F("IceShardsOffer", {
        excess: amount,
        target: esc(victim.name),
      })}</p>
<div class="button-container single"><button type="button" class="rs-ice-shards-button">${buttonLabel}</button></div>`,
      flags: {
        redsteel: {
          [ICE_SHARDS_OFFER]: {
            casterUuid: caster.uuid,
            sceneId: scene.id,
            tokenId,
            targetName: victim.name,
            excess: amount,
            spent: null,
          },
        },
      },
    });
  }
}

/**
 * Ask how the excess is split: one number per neighbour, a live "remaining"
 * line, Apply greyed out while the shares add up to more than there is.
 * Resolves `{tokenId: share}`, or null when dismissed or over the excess.
 */
async function promptShares(excess, victimName, neighbours) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const read = (root) => {
    const shares = {};
    for (const input of root?.querySelectorAll?.("input[data-token-id]") ?? []) {
      shares[input.dataset.tokenId] = Math.max(0, Math.floor(Number(input.value) || 0));
    }
    return shares;
  };
  const sum = (shares) => Object.values(shares).reduce((a, b) => a + b, 0);

  const rows = neighbours
    .map(
      (t) => `<div class="form-group">
  <label>${esc(t.name)}</label>
  <div class="form-fields"><input type="number" data-token-id="${esc(t.id)}" min="0" max="${excess}" step="1" value="0"></div>
</div>`,
    )
    .join("");

  const result = await DialogV2.wait({
    window: { title: L("IceShardsTitle"), icon: "fa-solid fa-snowflake" },
    classes: ["redsteel"],
    position: { width: 380 },
    content: `<p>${F("IceShardsPrompt", { excess, target: esc(victimName) })}</p>
${rows}
<p class="rs-ice-shards-remaining" style="text-align:center;"></p>`,
    buttons: [
      {
        action: "apply",
        label: L("Apply"),
        icon: "fas fa-check",
        default: true,
        callback: (_event, _button, dialog) => {
          const shares = read(dialog.element);
          const total = sum(shares);
          if (total > excess) {
            ui.notifications.warn(F("IceShardsTooMuch", { total, excess }));
            return null;
          }
          return shares;
        },
      },
      { action: "cancel", label: L("Cancel"), icon: "fas fa-xmark" },
    ],
    render: (_event, dialog) => {
      const root = dialog.element;
      const readout = root?.querySelector(".rs-ice-shards-remaining");
      const apply = root?.querySelector('button[data-action="apply"]');
      const refresh = () => {
        const left = excess - sum(read(root));
        if (readout) readout.textContent = F("IceShardsRemaining", { left });
        if (apply) apply.disabled = left < 0;
      };
      root?.addEventListener("input", refresh);
      refresh();
    },
    rejectClose: false,
  });
  return result && typeof result === "object" ? result : null;
}

/**
 * The Ice Shards button: pick the shares, then land each one as its own
 * Frost environment card. A shard card carries the offer's id and this
 * click's batch id, which the GM's claimMancerFollowup reads.
 */
async function splitIceShards(message, button) {
  const offer = message.flags?.redsteel?.[ICE_SHARDS_OFFER];
  if (!offer || offer.spent) return;
  if (!game.user.isGM && !game.users.activeGM) {
    ui.notifications.warn(L("NoGM"));
    return;
  }
  const scene = game.scenes.get(offer.sceneId) ?? null;
  const victim = scene?.tokens.get(offer.tokenId) ?? null;
  if (!scene || !victim) {
    ui.notifications.warn(L("TokenGone"));
    return;
  }
  // Adjacency is asked of the grid on screen.
  if (canvas.scene?.id !== scene.id) {
    ui.notifications.warn(L("WrongScene"));
    return;
  }
  const neighbours = neighbourTokens(scene, victim);
  if (!neighbours.length) {
    ui.notifications.info(F("NoNeighbours", { target: victim.name }));
    return;
  }

  const excess = Math.max(0, Math.floor(Number(offer.excess) || 0));
  const shares = await promptShares(excess, victim.name, neighbours);
  if (!shares) return;
  const landed = Object.entries(shares).filter(([, share]) => share > 0);
  if (!landed.length) {
    ui.notifications.info(L("IceShardsNothing"));
    return;
  }

  button.disabled = true;
  const caster = offer.casterUuid ? fromUuidSync(offer.casterUuid) : null;
  const title = L("IceShardsTitle");
  const batch = foundry.utils.randomID();
  for (const [tokenId, share] of landed) {
    const target = scene.tokens.get(tokenId);
    if (!target) continue;
    const card = await ChatMessage.create({
      // Never the caster itself: Apply Damage would read the shard as the
      // caster's attack (the collision card's rule, forcedMovement.mjs).
      speaker: {
        scene: scene.id,
        actor: null,
        token: null,
        alias: caster?.name ?? title,
      },
      content: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
<p style="text-align:center;">${F("IceShardsHit", {
        target: esc(target.name),
        damage: share,
        source: esc(victim.name),
      })}</p>`,
      flags: {
        redsteel: {
          rollName: title,
          autoApplied: true,
          iceShards: true,
          iceShardsSource: message.id,
          iceShardsBatch: batch,
        },
        attack: {
          type: "environment",
          // The shape evaluateDmgVsArmor reads: Frost armor and Frost
          // resistance / vulnerability / immunity apply, and Frost is not a
          // physical type, so it is a magical hit for the temporary pools.
          damageProfile: { expression: ["frost"] },
          effects: {},
          normal: { damage: share, penetration: 0 },
        },
      },
    });
    const data = {
      type: "applyDamage",
      messageId: card.id,
      mode: "normal",
      sceneId: scene.id,
      targetIds: [tokenId],
      selectedEffects: {},
      requestedBy: game.user.id,
    };
    if (game.user.isGM) await applyDamageAsGM(data);
    else game.socket.emit(SOCKET, data);
  }
}

/* -------------------------------------------- */
/*  Kamenná kůže (Stone Skin)                   */
/* -------------------------------------------- */

/** The Apply Damage dialog's durability option for Stone Skin. */
export const STONE_SKIN_DURABILITY = "stone-skin";

const STONE_SKIN_STATUS = "stone_skin";
/** Flag on the Stone Skin effect, stamped by documents/effects.mjs. */
const STONE_SKIN_FLAG = "stoneSkin";
/** Flag on the Stagger card. */
const STONE_SKIN_CARD = "stoneSkinSacrifice";

/** "Stone Skin", localized, for the dialog and the durability note. */
export function stoneSkinLabel() {
  return L("StoneSkin");
}

/**
 * The armor durability Stone Skin gives this actor right now. A character
 * only (as getDurabilityItems), with an active Stone Skin, and unarmored by
 * the same test the effect's armor uses (wearsStoneSkinArmor).
 *
 * @param {Actor} actor
 * @returns {{effect: ActiveEffect|null, available: number}}
 */
export function getStoneSkinDurability(actor) {
  if (!actor || actor.type !== "character") return { effect: null, available: 0 };
  const effect =
    actor.effects.contents.find(
      (e) => e.statuses?.has(STONE_SKIN_STATUS) && e.active !== false,
    ) ?? null;
  if (!effect || wearsStoneSkinArmor(actor)) return { effect, available: 0 };
  const stored = effect.getFlag(SYSTEM_ID, STONE_SKIN_FLAG) ?? {};
  const available = Math.max(0, Math.floor(Number(stored.durability) || 0));
  return { effect, available };
}

/**
 * Stone Skin's point was sacrificed in Apply Damage (GM, applyDamageAsGM):
 * spend it, then, when its caster holds Kamenná kůže, post the card that lets
 * the wearer Stagger the neighbours they pick.
 *
 * @param {Actor} actor             the wearer
 * @param {TokenDocument} tokenDoc  the wearer's token
 * @param {ActiveEffect} effect     the Stone Skin effect
 * @param {Scene|null} scene
 */
export async function sacrificeStoneSkin(actor, tokenDoc, effect, scene) {
  if (!effect) return;
  const stored = effect.getFlag(SYSTEM_ID, STONE_SKIN_FLAG) ?? {};
  await effect.setFlag(SYSTEM_ID, STONE_SKIN_FLAG, { ...stored, durability: 0 });

  const caster = stored.casterUuid ? fromUuidSync(stored.casterUuid) : null;
  if (!hasMancerNode(caster, "geomancer", "kamennaKuze")) return;
  if (!tokenDoc || !scene) return;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor, token: tokenDoc }),
    content: `<p class="rs-card-headline"><b>${esc(L("StoneSkinTitle"))}</b></p>
<p style="text-align:center;">${F("StoneSkinSacrificed", { name: esc(tokenDoc.name) })}</p>
<div class="button-container single"><button type="button" class="rs-stone-skin-button">${esc(L("StoneSkinButton"))}</button></div>`,
    flags: {
      redsteel: {
        [STONE_SKIN_CARD]: {
          sceneId: scene.id,
          wearerTokenId: tokenDoc.id,
          casterUuid: stored.casterUuid ?? null,
          spent: false,
        },
      },
      // What applyEffectsAsGM applies from this card. redsteel.mjs keeps its
      // generic Apply Effects button off it.
      effects: { stagger: {} },
    },
  });
}

/** Pick the neighbours to Stagger. Resolves their token ids, or null. */
async function promptStaggerPicks(wearerName, neighbours) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const rows = neighbours
    .map(
      (t) => `<div class="form-group">
  <label><input type="checkbox" data-token-id="${esc(t.id)}"> ${esc(t.name)}</label>
</div>`,
    )
    .join("");
  const result = await DialogV2.wait({
    window: { title: L("StoneSkinTitle"), icon: "fa-solid fa-mountain" },
    classes: ["redsteel"],
    position: { width: 360 },
    content: `<p>${F("StoneSkinPrompt", { name: esc(wearerName) })}</p>${rows}`,
    buttons: [
      {
        action: "apply",
        label: L("Apply"),
        icon: "fas fa-check",
        default: true,
        callback: (_event, _button, dialog) =>
          [...(dialog.element?.querySelectorAll("input[data-token-id]:checked") ?? [])].map(
            (input) => input.dataset.tokenId,
          ),
      },
      { action: "cancel", label: L("Cancel"), icon: "fas fa-xmark" },
    ],
    rejectClose: false,
  });
  return Array.isArray(result) ? result : null;
}

/**
 * The Stagger button: pick, then Stagger through applyEffectsAsGM (directly
 * on the GM, else the existing "applyEffects" socket payload).
 */
async function staggerNeighbours(message, button) {
  const data = message.flags?.redsteel?.[STONE_SKIN_CARD];
  if (!data || data.spent) return;
  if (!game.user.isGM && !game.users.activeGM) {
    ui.notifications.warn(L("NoGM"));
    return;
  }
  const scene = game.scenes.get(data.sceneId) ?? null;
  const wearer = scene?.tokens.get(data.wearerTokenId) ?? null;
  if (!scene || !wearer) {
    ui.notifications.warn(L("TokenGone"));
    return;
  }
  if (canvas.scene?.id !== scene.id) {
    ui.notifications.warn(L("WrongScene"));
    return;
  }
  const neighbours = neighbourTokens(scene, wearer);
  if (!neighbours.length) {
    ui.notifications.info(F("NoNeighbours", { target: wearer.name }));
    return;
  }
  const picks = await promptStaggerPicks(wearer.name, neighbours);
  if (!picks) return;
  if (!picks.length) {
    ui.notifications.info(L("StoneSkinNothing"));
    return;
  }

  button.disabled = true;
  const payload = {
    type: "applyEffects",
    messageId: message.id,
    sceneId: scene.id,
    targetIds: picks,
    selectedEffects: Object.fromEntries(picks.map((id) => [id, ["stagger"]])),
  };
  if (game.user.isGM) await applyEffectsAsGM(payload);
  else game.socket.emit(SOCKET, payload);
}

/* -------------------------------------------- */
/*  Ohnivá aura (Fiery Aura)                    */
/* -------------------------------------------- */

const FIERY_AURA_STATUS = "fiery_aura";
/** "6 m around the caster", 1 hex = 1.5 m. */
const FIERY_AURA_RADIUS = 4;
/** The spell's Burn bonus, and with Ohnivá aura (r1501, +5%). */
const FIERY_AURA_BURN = 10;
const FIERY_AURA_BURN_NODE = 15;

/** A token's side: 1 Friendly, -1 Hostile, 0 for Neutral and Secret. */
function sideOf(tokenDoc) {
  const { FRIENDLY, HOSTILE } = CONST.TOKEN_DISPOSITIONS;
  const disposition = tokenDoc?.disposition;
  if (disposition === FRIENDLY) return 1;
  if (disposition === HOSTILE) return -1;
  return 0;
}

/**
 * The Burn chance a Fiery Aura adds against this target: the highest of the
 * auras whose owner stands within 4 hexes and is hostile to it. 0 for any
 * other effect.
 *
 * @param {Token|TokenDocument|null} targetToken
 * @param {string} effectName
 * @returns {number}
 */
export function fieryAuraBurnBonus(targetToken, effectName) {
  if (effectName !== "burn") return 0;
  const target = targetToken?.document ?? targetToken;
  const scene = target?.parent;
  if (!target || !scene?.tokens) return 0;
  const targetSide = sideOf(target);
  if (!targetSide) return 0;

  let best = 0;
  for (const other of scene.tokens.contents) {
    if (other.id === target.id) continue;
    const owner = other.actor;
    if (!owner?.statuses?.has(FIERY_AURA_STATUS)) continue;
    if (sideOf(other) * targetSide >= 0) continue;
    if (tokenHexDistance(target, other) > FIERY_AURA_RADIUS) continue;
    const bonus = hasMancerNode(owner, "pyromancer", "ohnivaAura")
      ? FIERY_AURA_BURN_NODE
      : FIERY_AURA_BURN;
    best = Math.max(best, bonus);
  }
  return best;
}

/**
 * A landed Fiery Aura puts its marker status on the caster
 * (castSpell.mjs applyPostCastEffects, the caster effects' gate).
 *
 * @param {Actor} actor
 * @param {Item} spell
 */
export async function applyFieryAura(actor, spell) {
  if (!actor || !matchesPackSpell(spell, FIERY_AURA_SPELL)) return;
  await game.redsteel.applyEffect(actor, FIERY_AURA_STATUS, {
    caster: actor,
    school: spell.system?.type ?? null,
  });
}

/* -------------------------------------------- */
/*  Travič III (Poisoner III)                   */
/* -------------------------------------------- */

const POISON_STATUS = "poison";
/** Flag on the redirect card, also read by applyDamage.mjs (no chains). */
const POISONER_CARD = "poisonerRedirect";

/**
 * A Poison just landed on a target that already had one (GM,
 * applyDamageAsGM / applyEffectsAsGM). When it came from the holder's
 * School of Earth card, post the card that offers to Poison one neighbour
 * instead.
 *
 * @param {{caster: Actor|null, school: string|null}} castingContext
 * @param {ChatMessage} message   the card the Poison came from
 * @param {Scene|null} scene
 * @param {TokenDocument|null} tokenDoc  the victim
 * @param {{addedStack?: boolean}} [options]  `addedStack`: the apply raised
 *   the victim's stacks (false at the cap, where only the clock refreshed)
 */
export async function offerPoisonerRedirect(
  castingContext,
  message,
  scene,
  tokenDoc,
  { addedStack = false } = {},
) {
  if (!message || !scene || !tokenDoc) return;
  if (message.flags?.redsteel?.[POISONER_CARD]) return;
  const caster = castingContext?.caster ?? null;
  if (!caster || castingContext.school !== "earth") return;
  if (!hasMancerNode(caster, "entomancer", "travic3")) return;
  // Adjacency is asked of the grid on screen; on another scene the click
  // asks again.
  if (canvas.scene?.id === scene.id && !poisonerCandidates(scene, tokenDoc, caster).length) {
    return;
  }

  const flags = message.flags?.redsteel ?? {};
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<p class="rs-card-headline"><b>${esc(L("PoisonerTitle"))}</b></p>
<p style="text-align:center;">${F("PoisonerOffer", { name: esc(tokenDoc.name) })}</p>
<div class="button-container single"><button type="button" class="rs-poisoner-button">${esc(L("PoisonerButton"))}</button></div>`,
    flags: {
      redsteel: {
        [POISONER_CARD]: {
          sceneId: scene.id,
          victimTokenId: tokenDoc.id,
          casterUuid: flags.casterUuid ?? caster.uuid,
          addedStack: !!addedStack,
          spent: false,
        },
        // The original card's casting context, so the neighbour's Poison is
        // the caster's own (Toxiny bakes in, applyEffectsAsGM).
        casterUuid: flags.casterUuid ?? caster.uuid,
        spellSchool: flags.spellSchool ?? castingContext.school,
      },
      // What applyEffectsAsGM applies from this card. redsteel.mjs keeps its
      // generic Apply Effects button off it.
      effects: { [POISON_STATUS]: {} },
    },
  });
}

/**
 * Who the Poison may go to: the victim's neighbours, never the caster's own
 * token (the pick list pre-selects its first row, and the caster often
 * stands next to the victim). Same exclusion as chainCandidates.
 */
function poisonerCandidates(scene, victim, caster) {
  return neighbourTokens(scene, victim).filter((t) => !isCasterToken(t, caster));
}

/** Pick the one neighbour to Poison. Resolves its token id, or null. */
async function promptPoisonerPick(victimName, neighbours) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const rows = neighbours
    .map(
      (t, index) => `<div class="form-group">
  <label><input type="radio" name="rs-poisoner-pick" value="${esc(t.id)}"${
    index === 0 ? " checked" : ""
  }> ${esc(t.name)}</label>
</div>`,
    )
    .join("");
  const result = await DialogV2.wait({
    window: { title: L("PoisonerTitle"), icon: "fa-solid fa-skull-crossbones" },
    classes: ["redsteel"],
    position: { width: 360 },
    content: `<p>${F("PoisonerPrompt", { name: esc(victimName) })}</p>${rows}`,
    buttons: [
      {
        action: "apply",
        label: L("Apply"),
        icon: "fas fa-check",
        default: true,
        callback: (_event, _button, dialog) =>
          dialog.element?.querySelector('input[name="rs-poisoner-pick"]:checked')?.value ??
          null,
      },
      { action: "cancel", label: L("Cancel"), icon: "fas fa-xmark" },
    ],
    rejectClose: false,
  });
  return typeof result === "string" && result !== "cancel" ? result : null;
}

/**
 * The Redirect Poison button: pick a neighbour, then Poison it through
 * applyEffectsAsGM (directly on the active GM, else the existing
 * "applyEffects" socket payload). The GM's claim takes the stack back.
 */
async function redirectPoison(message, button) {
  const data = message.flags?.redsteel?.[POISONER_CARD];
  if (!data || data.spent) return;
  if (!game.users.activeGM) {
    ui.notifications.warn(L("NoGM"));
    return;
  }
  const scene = game.scenes.get(data.sceneId) ?? null;
  const victim = scene?.tokens.get(data.victimTokenId) ?? null;
  if (!scene || !victim) {
    ui.notifications.warn(L("TokenGone"));
    return;
  }
  if (canvas.scene?.id !== scene.id) {
    ui.notifications.warn(L("WrongScene"));
    return;
  }
  const caster = data.casterUuid ? fromUuidSync(data.casterUuid) : null;
  const neighbours = poisonerCandidates(scene, victim, caster);
  if (!neighbours.length) {
    ui.notifications.info(F("NoNeighbours", { target: victim.name }));
    return;
  }
  const pick = await promptPoisonerPick(victim.name, neighbours);
  if (!pick) return;

  button.disabled = true;
  const payload = {
    type: "applyEffects",
    messageId: message.id,
    sceneId: scene.id,
    targetIds: [pick],
    selectedEffects: { [pick]: [POISON_STATUS] },
  };
  if (game.users.activeGM?.isSelf) await applyEffectsAsGM(payload);
  else game.socket.emit(SOCKET, payload);
}

/* -------------------------------------------- */
/*  Řetězení / Dvojité řetězení (Chaining)      */
/* -------------------------------------------- */

/** Flag on the offer card. */
const CHAIN_OFFER = "chainOffer";
/** Flag on the spell card: victims already offered, `{tokenId: true}`. */
const CHAIN_OFFERED = "chainOffered";
/** "4,5 m" from the target the bolt jumps from, 1 hex = 1.5 m. */
const CHAIN_RADIUS = 3;

/** Is this token one of the caster's own (linked or unlinked)? */
function isCasterToken(tokenDoc, caster) {
  if (!caster || !tokenDoc?.actor) return false;
  if (tokenDoc.actor === caster || tokenDoc.actor.uuid === caster.uuid) return true;
  return !!tokenDoc.actorLink && tokenDoc.actorId === caster.id;
}

/**
 * Post one chain offer card: the bolt may jump from `fromToken`.
 *
 * @param {Actor} caster
 * @param {Scene} scene
 * @param {TokenDocument} fromToken
 * @param {{excluded: string[], damage: number, penetration: number,
 *          expression: string[], hop: number}} chain
 */
async function postChainOffer(caster, scene, fromToken, chain) {
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    content: `<p class="rs-card-headline"><b>${esc(L("ChainTitle"))}</b></p>
<p style="text-align:center;">${F("ChainOffer", { target: esc(fromToken.name) })}</p>
<div class="button-container single"><button type="button" class="rs-chain-button">${esc(L("ChainButton"))}</button></div>`,
    flags: {
      redsteel: {
        [CHAIN_OFFER]: {
          casterUuid: caster.uuid,
          sceneId: scene.id,
          fromTokenId: fromToken.id,
          excluded: [...(chain.excluded ?? [])],
          damage: chain.damage,
          penetration: chain.penetration,
          expression: [...(chain.expression ?? [])],
          hop: chain.hop,
          spent: null,
        },
      },
    },
  });
}

/**
 * Apply Damage landed the holder's spell with its Chain row ticked on some
 * targets: post one card per such victim offering to chain the bolt on. GM
 * only (applyDamageAsGM). Once per victim per card, so the GM re-applying it
 * offers nothing new. A chain hit card never chains again by itself: the
 * second hop of Dvojité řetězení is posted by claimMancerFollowup.
 *
 * @param {{caster: Actor|null, school: string|null}} castingContext
 * @param {ChatMessage} message  the spell card
 * @param {Scene|null} scene
 * @param {{tokenId: string, damage: number, penetration: number}[]} victims
 *   `damage` is already half of the damage that target was dealt
 */
export async function offerChaining(castingContext, message, scene, victims = []) {
  if (!message || !scene) return;
  if (message.flags?.redsteel?.chainHit) return;
  const caster = castingContext?.caster ?? null;
  if (!caster || !hasMancerNode(caster, "astramancer", "retezeni")) return;

  const offered = { ...(message.getFlag(SYSTEM_ID, CHAIN_OFFERED) ?? {}) };
  const fresh = victims.filter(
    (v) => v?.tokenId && Number(v.damage) > 0 && !offered[v.tokenId],
  );
  if (!fresh.length) return;
  for (const victim of fresh) offered[victim.tokenId] = true;
  await message.setFlag(SYSTEM_ID, CHAIN_OFFERED, offered);

  const raw = message.flags?.attack?.damageProfile?.expression;
  const expression = Array.isArray(raw) ? raw : [];
  for (const { tokenId, damage, penetration } of fresh) {
    const victim = scene.tokens.get(tokenId);
    if (!victim) continue;
    await postChainOffer(caster, scene, victim, {
      excluded: [tokenId],
      damage: Math.floor(Number(damage)),
      penetration: Number(penetration) || 0,
      expression,
      hop: 1,
    });
  }
}

/**
 * Who the bolt may jump to: tokens with an actor within 3 hexes of the one it
 * jumps from, alive, visible to this user, not already hit by this chain and
 * not the caster's own.
 */
function chainCandidates(scene, fromToken, excluded, caster) {
  return scene.tokens.contents.filter((other) => {
    if (other.id === fromToken.id || !other.actor) return false;
    if (excluded.includes(other.id)) return false;
    if (other.hidden && !game.user.isGM) return false;
    if (other.actor.statuses?.has("dead")) return false;
    if (isCasterToken(other, caster)) return false;
    return tokenHexDistance(fromToken, other) <= CHAIN_RADIUS;
  });
}

/** Pick the one target the bolt jumps to. Resolves its token id, or null. */
async function promptChainPick(fromName, candidates) {
  const DialogV2 = foundry.applications.api.DialogV2;
  const rows = candidates
    .map(
      (t, index) => `<div class="form-group">
  <label><input type="radio" name="rs-chain-pick" value="${esc(t.id)}"${
    index === 0 ? " checked" : ""
  }> ${esc(t.name)}</label>
</div>`,
    )
    .join("");
  const result = await DialogV2.wait({
    window: { title: L("ChainTitle"), icon: "fa-solid fa-bolt" },
    classes: ["redsteel"],
    position: { width: 360 },
    content: `<p>${F("ChainPrompt", { target: esc(fromName) })}</p>${rows}`,
    buttons: [
      {
        action: "apply",
        label: L("Apply"),
        icon: "fas fa-check",
        default: true,
        callback: (_event, _button, dialog) =>
          dialog.element?.querySelector('input[name="rs-chain-pick"]:checked')?.value ??
          null,
      },
      { action: "cancel", label: L("Cancel"), icon: "fas fa-xmark" },
    ],
    rejectClose: false,
  });
  return typeof result === "string" && result !== "cancel" ? result : null;
}

/**
 * The Chain the bolt button: pick the next target, then land the chained
 * bolt as its own environment card (half the damage, the same Penetration and
 * damage types). The hit card carries the offer's id, which the GM's
 * claimMancerFollowup spends.
 */
async function chainBolt(message, button) {
  const offer = message.flags?.redsteel?.[CHAIN_OFFER];
  if (!offer || offer.spent) return;
  if (!game.user.isGM && !game.users.activeGM) {
    ui.notifications.warn(L("NoGM"));
    return;
  }
  const scene = game.scenes.get(offer.sceneId) ?? null;
  const from = scene?.tokens.get(offer.fromTokenId) ?? null;
  if (!scene || !from) {
    ui.notifications.warn(L("TokenGone"));
    return;
  }
  // Distance is asked of the grid on screen.
  if (canvas.scene?.id !== scene.id) {
    ui.notifications.warn(L("WrongScene"));
    return;
  }
  const caster = offer.casterUuid ? fromUuidSync(offer.casterUuid) : null;
  const candidates = chainCandidates(scene, from, offer.excluded ?? [], caster);
  if (!candidates.length) {
    ui.notifications.info(F("ChainNoTargets", { target: from.name }));
    return;
  }
  const pick = await promptChainPick(from.name, candidates);
  if (!pick) return;
  const target = scene.tokens.get(pick);
  if (!target) return;

  button.disabled = true;
  const title = L("ChainTitle");
  const damage = Math.max(0, Math.floor(Number(offer.damage) || 0));
  const penetration = Number(offer.penetration) || 0;
  const card = await ChatMessage.create({
    // Never the caster itself: Apply Damage would read the chained bolt as
    // the caster's attack (the collision card's rule, forcedMovement.mjs).
    speaker: {
      scene: scene.id,
      actor: null,
      token: null,
      alias: caster?.name ?? title,
    },
    content: `<p class="rs-card-headline"><b>${esc(title)}</b></p>
<p style="text-align:center;">${F("ChainHit", {
      target: esc(target.name),
      damage,
      penetration,
      source: esc(from.name),
    })}</p>`,
    flags: {
      redsteel: {
        rollName: title,
        autoApplied: true,
        chainHit: true,
        chainSource: message.id,
        chainTargetId: pick,
      },
      attack: {
        type: "environment",
        // The spell card's own damage types, so the target's armor and
        // resistances read the chained bolt as they read the spell.
        damageProfile: { expression: [...(offer.expression ?? [])] },
        effects: {},
        normal: { damage, penetration },
      },
    },
  });
  const data = {
    type: "applyDamage",
    messageId: card.id,
    mode: "normal",
    sceneId: scene.id,
    targetIds: [pick],
    selectedEffects: {},
    requestedBy: game.user.id,
  };
  if (game.user.isGM) await applyDamageAsGM(data);
  else game.socket.emit(SOCKET, data);
}

/**
 * Dvojité řetězení (GM, from claimMancerFollowup): a first-hop chain landed,
 * so the bolt may jump once more from the target it just hit. Same damage
 * (half of the original, not halved again) and Penetration; nobody this
 * chain already hit can be picked. The second hop never chains further.
 */
async function offerSecondChainHop(state, chainTargetId) {
  if (state?.hop !== 1 || !chainTargetId) return;
  const caster = state.casterUuid ? fromUuidSync(state.casterUuid) : null;
  if (!caster || !hasMancerNode(caster, "astramancer", "dvojiteRetezeni")) return;
  const scene = game.scenes.get(state.sceneId) ?? null;
  const from = scene?.tokens.get(chainTargetId) ?? null;
  if (!scene || !from) return;
  await postChainOffer(caster, scene, from, {
    excluded: [...(state.excluded ?? []), chainTargetId],
    damage: state.damage,
    penetration: state.penetration,
    expression: state.expression,
    hop: 2,
  });
}

/* -------------------------------------------- */
/*  Blesková odolnost (Lightning Resilience)    */
/* -------------------------------------------- */

/** Flag on the owner's card. */
const LIGHTNING_RESILIENCE = "lightningResilience";
/** "může utratit 10 Many". */
const LIGHTNING_RESILIENCE_MANA = 10;
const STAGGER_STATUS = "stagger";

/** The actor's current Mana. */
function manaOf(actor) {
  return Number(actor?.system?.stats?.mana?.value) || 0;
}

/** The name shown for the actor: its token's for an unlinked token. */
function displayName(actor) {
  return actor?.token?.name ?? actor?.name ?? "";
}

/**
 * Why the card cannot be used right now, localized, or null.
 *
 * @param {Actor|null} actor
 * @param {{effectId: string}} state
 * @returns {string|null}
 */
function lightningResilienceRefusal(actor, state) {
  if (!actor) return L("TokenGone");
  const effect = actor.effects.get(state.effectId);
  if (!effect || !effect.statuses?.has(STAGGER_STATUS)) {
    return F("LightningResilienceGone", { name: displayName(actor) });
  }
  if (manaOf(actor) < LIGHTNING_RESILIENCE_MANA) {
    return F("LightningResilienceNoMana", { name: displayName(actor) });
  }
  return null;
}

/**
 * The holder was just Staggered (GM, applyDamage.mjs applyEffectToActor):
 * post the owner's card offering to spend 10 Mana to shake it off. The caller
 * has already checked the node, the Mana and that the Stagger is new.
 *
 * @param {Actor} actor
 * @param {ActiveEffect} effect  the Stagger just created
 */
export async function offerLightningResilience(actor, effect) {
  if (!actor || !effect) return;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p class="rs-card-headline"><b>${esc(L("LightningResilienceTitle"))}</b></p>
<p style="text-align:center;">${F("LightningResilienceOffer", { name: esc(displayName(actor)) })}</p>
<div class="button-container single"><button type="button" class="rs-lightning-resilience-button">${esc(L("LightningResilienceButton"))}</button></div>`,
    flags: {
      redsteel: {
        [LIGHTNING_RESILIENCE]: {
          actorUuid: actor.uuid,
          effectId: effect.id,
          spent: null,
        },
      },
    },
  });
}

/**
 * The Spend 10 Mana button: checked here first so the clicker hears why it
 * cannot be used, then resolved on the GM (directly, or through the
 * "lightningResilience" socket request, module/redsteel.mjs).
 */
async function useLightningResilience(message, button) {
  const state = message.flags?.redsteel?.[LIGHTNING_RESILIENCE];
  if (!state || state.spent) return;
  const actor = state.actorUuid ? fromUuidSync(state.actorUuid) : null;
  const refusal = lightningResilienceRefusal(actor, state);
  if (refusal) {
    ui.notifications.warn(refusal);
    return;
  }
  if (!game.user.isGM && !game.users.activeGM) {
    ui.notifications.warn(L("NoGM"));
    return;
  }
  button.disabled = true;
  if (game.user.isGM) await resolveLightningResilienceAsGM({ messageId: message.id });
  else game.socket.emit(SOCKET, { type: "lightningResilience", messageId: message.id });
}

/**
 * GM side of Blesková odolnost: check again, mark the card used, pay the 10
 * Mana, remove the Stagger and say so in chat. The card is marked first so a
 * second request arriving meanwhile is refused.
 *
 * @param {{messageId: string}} data
 */
export async function resolveLightningResilienceAsGM(data) {
  const message = game.messages.get(data?.messageId);
  const state = message?.flags?.redsteel?.[LIGHTNING_RESILIENCE];
  if (!state) return;
  if (state.spent) {
    ui.notifications.warn(L("AlreadyUsed"));
    return;
  }
  const actor = state.actorUuid ? fromUuidSync(state.actorUuid) : null;
  const refusal = lightningResilienceRefusal(actor, state);
  if (refusal) {
    ui.notifications.warn(refusal);
    return;
  }
  await message.update({ [`flags.${SYSTEM_ID}.${LIGHTNING_RESILIENCE}.spent`]: true });
  await actor.update({
    "system.stats.mana.value": manaOf(actor) - LIGHTNING_RESILIENCE_MANA,
  });
  await actor.effects.get(state.effectId)?.delete();
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${F("LightningResilienceSpent", { name: esc(displayName(actor)) })}</p>`,
  });
}

/* -------------------------------------------- */
/*  GM claim                                    */
/* -------------------------------------------- */

/**
 * GM side, first thing in applyDamageAsGM and applyEffectsAsGM: mark a
 * follow-up card used, or refuse it when it already was. Any other card
 * passes untouched.
 *
 *   - A shard card (`iceShards`) spends its offer with its click's batch id.
 *     The other shares of the same click pass; a later click is refused.
 *   - A chained bolt (`chainHit`) spends its offer; a first hop posts the
 *     second hop's offer when the caster holds Dvojité řetězení.
 *   - Kamenná kůže's card spends itself.
 *   - Travič III's card spends itself and takes back the victim's new stack.
 *
 * @param {ChatMessage|undefined} message
 * @returns {Promise<boolean>} false = land nothing
 */
export async function claimMancerFollowup(message) {
  const flags = message?.flags?.redsteel ?? {};

  if (flags.iceShards && flags.iceShardsSource) {
    const offer = game.messages.get(flags.iceShardsSource);
    const state = offer?.flags?.redsteel?.[ICE_SHARDS_OFFER];
    if (!state) return true;
    const batch = flags.iceShardsBatch ?? true;
    if (state.spent && state.spent !== batch) {
      ui.notifications.warn(L("AlreadyUsed"));
      return false;
    }
    if (!state.spent) {
      await offer.update({ [`flags.${SYSTEM_ID}.${ICE_SHARDS_OFFER}.spent`]: batch });
    }
    return true;
  }

  // A chained bolt spends its offer (one jump per offer), and a first hop
  // under Dvojité řetězení offers the second one.
  if (flags.chainHit && flags.chainSource) {
    const offer = game.messages.get(flags.chainSource);
    const state = offer?.flags?.redsteel?.[CHAIN_OFFER];
    if (!state) return true;
    if (state.spent) {
      ui.notifications.warn(L("AlreadyUsed"));
      return false;
    }
    await offer.update({ [`flags.${SYSTEM_ID}.${CHAIN_OFFER}.spent`]: message.id });
    await offerSecondChainHop(state, flags.chainTargetId);
    return true;
  }

  const stoneSkin = flags[STONE_SKIN_CARD];
  if (stoneSkin) {
    if (stoneSkin.spent) {
      ui.notifications.warn(L("AlreadyUsed"));
      return false;
    }
    await message.update({ [`flags.${SYSTEM_ID}.${STONE_SKIN_CARD}.spent`]: true });
    return true;
  }

  // Travič III's card spends itself and hands back the stack the victim
  // gained, when it gained one.
  const redirect = flags[POISONER_CARD];
  if (redirect) {
    if (redirect.spent) {
      ui.notifications.warn(L("AlreadyUsed"));
      return false;
    }
    await message.update({ [`flags.${SYSTEM_ID}.${POISONER_CARD}.spent`]: true });
    if (redirect.addedStack) {
      const victim = game.scenes.get(redirect.sceneId)?.tokens.get(redirect.victimTokenId)?.actor;
      const poison =
        victim?.effects.contents.find((e) => e.statuses?.has(POISON_STATUS)) ?? null;
      if (poison) await game.redsteel.removeEffectStacks(poison, 1);
    }
    return true;
  }

  return true;
}

/* -------------------------------------------- */
/*  Pevný krok (Firm Step)                      */
/* -------------------------------------------- */

/** Kořeny (Roots): the All-Spells copy and the redsteel-items copy. */
const ROOTS_SPELLS = [
  { id: "3zkHN7nxSUQPOT8N", name: "Roots" },
  { id: "sLjWeCu5QNYrXApo", name: "Roots" },
];
/** Tekutý písek (Quicksand). */
const QUICKSAND_SPELL = { id: "JthKClgzkffFRdbI", name: "Quicksand" };
const FIRM_STEP_SPELLS = [...ROOTS_SPELLS, QUICKSAND_SPELL];

/** Was the card a cast of Roots or Quicksand? */
function isFirmStepSpellCard(flags) {
  if (!flags.casterUuid || !flags.spellId) return false;
  const caster = fromUuidSync(flags.casterUuid);
  const spell = caster?.items?.get?.(flags.spellId) ?? null;
  // A scroll's spell is never embedded; it keeps the pack id it was cast as.
  if (!spell) return FIRM_STEP_SPELLS.some((ref) => ref.id === flags.spellId);
  return FIRM_STEP_SPELLS.some((ref) => matchesPackSpell(spell, ref));
}

/**
 * Is the answered line a test to resist Roots, Quicksand or being knocked
 * Prone? (a) a Roots or Quicksand cast card; (b) a Trip card, when the line
 * answered is the Trip line itself (`tripTest`, same margin and source,
 * forcedMovement.mjs resolveVersusAnswer); (c) a pushing ability that knocks
 * Prone on a wide win (PUSH_ON_HIT `proneGap`, Shield Bash and Shield Charge).
 */
function resistsFirmStepEffect(card, { margin, source }) {
  const flags = card?.flags?.redsteel ?? {};
  const trip = flags.tripTest;
  if (
    trip &&
    Number(trip.margin) === Number(margin) &&
    (trip.source ?? "") === (source ?? "")
  ) {
    return true;
  }
  if (pushForCard(card)?.proneGap) return true;
  return isFirmStepSpellCard(flags);
}

/**
 * A versus answer is about to be rolled (rollAttributeFollowup): with Pevný
 * krok and an origin card that qualifies, the roll takes Advantage as one
 * more item bias, the way Magic Reinforcement adds it (veneficus.mjs
 * takeMagicReinforcement). Nothing is spent. No origin (the hotbar's Break
 * Free) means no Advantage.
 *
 * @param {Actor} actor
 * @param {Roll} roll
 * @param {string|null} origin  id of the card whose line is answered
 * @param {{margin?: number, source?: string}} [line]  the answered line
 * @returns {boolean} whether it applied
 */
export function firmStepAdvantage(actor, roll, origin, { margin = null, source = "" } = {}) {
  if (!roll || !origin || !actor?.isOwner) return false;
  if (!hasMancerNode(actor, "geomancer", "pevnyKrok")) return false;
  const card = game.messages?.get(origin);
  if (!card || !resistsFirmStepEffect(card, { margin, source })) return false;
  roll.options ??= {};
  const tags = roll.options.redsteel ?? {};
  roll.options.redsteel = {
    ...tags,
    itemBias: (Number(tags.itemBias) || 0) + 1,
  };
  return true;
}

/* -------------------------------------------- */
/*  Registration                                */
/* -------------------------------------------- */

/**
 * Wire the cards' buttons. Rendered at ready, after the hooks that build
 * the other card buttons (the Champion re-stagger card's pattern). Usable by
 * the GM and by the owners of the caster (Ice Shards, Travič III, Řetězení),
 * the wearer (Stone Skin) or the Staggered actor (Blesková odolnost); removed
 * for everyone else.
 */
export function registerMancerFollowupHooks() {
  Hooks.once("ready", () => {
    Hooks.on("renderChatMessageHTML", (message, html) => {
      const offer = message.flags?.redsteel?.[ICE_SHARDS_OFFER];
      if (offer) {
        const caster = offer.casterUuid ? fromUuidSync(offer.casterUuid) : null;
        for (const button of html.querySelectorAll(".rs-ice-shards-button")) {
          wireButton(button, {
            allowed: game.user.isGM || !!caster?.isOwner,
            spent: offer.spent,
            onClick: (b) =>
              splitIceShards(message, b).catch((err) =>
                console.error("Redsteel | Ice Shards failed", err),
              ),
          });
        }
      }

      const sacrifice = message.flags?.redsteel?.[STONE_SKIN_CARD];
      if (sacrifice) {
        const wearer =
          game.scenes?.get(sacrifice.sceneId)?.tokens.get(sacrifice.wearerTokenId)?.actor ??
          null;
        for (const button of html.querySelectorAll(".rs-stone-skin-button")) {
          wireButton(button, {
            allowed: game.user.isGM || !!wearer?.isOwner,
            spent: sacrifice.spent,
            onClick: (b) =>
              staggerNeighbours(message, b).catch((err) =>
                console.error("Redsteel | Stone Skin Stagger failed", err),
              ),
          });
        }
      }

      const redirect = message.flags?.redsteel?.[POISONER_CARD];
      if (redirect) {
        const caster = redirect.casterUuid ? fromUuidSync(redirect.casterUuid) : null;
        for (const button of html.querySelectorAll(".rs-poisoner-button")) {
          wireButton(button, {
            allowed: game.user.isGM || !!caster?.isOwner,
            spent: redirect.spent,
            onClick: (b) =>
              redirectPoison(message, b).catch((err) =>
                console.error("Redsteel | Poisoner III redirect failed", err),
              ),
          });
        }
      }

      const chain = message.flags?.redsteel?.[CHAIN_OFFER];
      if (chain) {
        const caster = chain.casterUuid ? fromUuidSync(chain.casterUuid) : null;
        for (const button of html.querySelectorAll(".rs-chain-button")) {
          wireButton(button, {
            allowed: game.user.isGM || !!caster?.isOwner,
            spent: chain.spent,
            onClick: (b) =>
              chainBolt(message, b).catch((err) =>
                console.error("Redsteel | Chaining failed", err),
              ),
          });
        }
      }

      const resilience = message.flags?.redsteel?.[LIGHTNING_RESILIENCE];
      if (resilience) {
        const actor = resilience.actorUuid ? fromUuidSync(resilience.actorUuid) : null;
        for (const button of html.querySelectorAll(".rs-lightning-resilience-button")) {
          wireButton(button, {
            allowed: game.user.isGM || !!actor?.isOwner,
            spent: resilience.spent,
            onClick: (b) =>
              useLightningResilience(message, b).catch((err) =>
                console.error("Redsteel | Lightning Resilience failed", err),
              ),
          });
        }
      }
    });
  });
}
