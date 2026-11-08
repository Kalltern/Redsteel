/**
 * One-shot backfill of a spell's own Magic Attack (`system.magicAttack` and
 * `system.magicAttackFixed`) onto spell copies that already exist in the world.
 *
 * An actor's spell is a copy of the compendium entry, so a value added to the
 * pack never reaches it on its own. This copies the two fields across once,
 * matching by name, and only onto a copy still at the default 0, so a value set
 * by hand on one copy is left alone. `system.uncontested` travels with them,
 * because a spell's Magic ATK only prints when the spell is contested.
 */

const SETTING = "spellMagicAttackSynced";

export function registerSpellMagicAttackSetting() {
  game.settings.register("redsteel", SETTING, {
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
  });
}

/**
 * The pack's spells that carry a Magic Attack, keyed by name.
 * @returns {Promise<Map<string, {magicAttack: number,
 *   magicAttackFixed: boolean, uncontested: boolean}>>}
 */
async function loadPackValues() {
  const pack = game.packs.get("redsteel.All-Spells");
  const index = await pack?.getIndex({
    fields: [
      "system.magicAttack",
      "system.magicAttackFixed",
      "system.uncontested",
    ],
  });
  const values = new Map();
  for (const entry of index?.contents ?? []) {
    const magicAttack = Number(entry.system?.magicAttack) || 0;
    if (!magicAttack) continue;
    values.set(entry.name, {
      magicAttack,
      magicAttackFixed: entry.system?.magicAttackFixed === true,
      uncontested: entry.system?.uncontested === true,
    });
  }
  return values;
}

/** The updates that bring one collection of items in line with the pack. */
function buildUpdates(items, values) {
  const updates = [];
  for (const item of items) {
    if (item.type !== "spell" || !values.has(item.name)) continue;
    if (Number(item.system.magicAttack) || 0) continue;
    const { magicAttack, magicAttackFixed, uncontested } = values.get(item.name);
    updates.push({
      _id: item.id,
      "system.magicAttack": magicAttack,
      "system.magicAttackFixed": magicAttackFixed,
      "system.uncontested": uncontested,
    });
  }
  return updates;
}

async function syncActor(actor, values) {
  const updates = buildUpdates(actor?.items?.contents ?? [], values);
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
}

/**
 * Run the backfill once per world. A pack with no values yet (the JSON has not
 * been compiled) writes nothing and leaves the setting unset, so the next load
 * tries again rather than marking the world done with nothing copied.
 */
export async function syncSpellMagicAttack() {
  if (!game.user.isGM || game.settings.get("redsteel", SETTING)) return;

  const values = await loadPackValues();
  if (!values.size) return;

  const worldUpdates = buildUpdates(game.items.contents, values);
  if (worldUpdates.length) await Item.updateDocuments(worldUpdates);

  // Base actors first, so unlinked tokens that merely inherit a spell already
  // read the new value and only genuine token-level copies get written.
  for (const actor of game.actors.contents) await syncActor(actor, values);
  for (const scene of game.scenes.contents) {
    for (const token of scene.tokens.contents) {
      if (!token.actorLink) await syncActor(token.actor, values);
    }
  }

  await game.settings.set("redsteel", SETTING, true);
}
