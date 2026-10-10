/**
 * Trait choices made when a trait lands on an actor.
 *
 * Two kinds of choice are handled here, both only on the client of the user
 * who created the item:
 *
 * - Effect choice groups. A feature item may carry several Active Effects
 *   tagged `flags.redsteel.traitChoice: "<group>"` (all shipped disabled).
 *   Per group the player picks one; that effect is enabled and the others in
 *   the group stay disabled. Example: Elder Blood (Starší krev) picks
 *   base Mana +2 or Health +5. Cancelling leaves the whole group disabled; the
 *   choice can still be made later by enabling one of the effects on the item.
 *
 * - Hated Enemy (Nenáviděný nepřítel). An item flagged
 *   `flags.redsteel.hatedEnemyTrait` opens the Bane picker; the pick is stored
 *   on the item at `flags.redsteel.hatedEnemy` (see helpers/banes.mjs).
 */

import { openHatedEnemyPicker, pillStyleBlock } from "../helpers/banes.mjs";

/**
 * Lang key prefix for a choice group: "elderBlood" → "REDSTEEL.Traits.ElderBlood".
 * @param {string} group
 */
function groupKeyPrefix(group) {
  return `REDSTEEL.Traits.${group.charAt(0).toUpperCase()}${group.slice(1)}`;
}

/**
 * Open the choice dialog for one effect group on an item.
 * @param {Item} item
 * @param {string} group the traitChoice value shared by `effects`
 * @param {ActiveEffect[]} effects
 * @returns {Promise<boolean>} true if a choice was written
 */
function openEffectChoice(item, group, effects) {
  const prefix = groupKeyPrefix(group);
  const titleKey = `${prefix}.PickerTitle`;
  const title = game.i18n.has(titleKey, false) ? game.i18n.localize(titleKey) : item.name;

  return new Promise((resolve) => {
    // Same V1 Dialog close/async handling as the Bane picker: the dialog
    // closes before an async button callback finishes, so the close handler
    // waits on `write` instead of resolving false on its own.
    let settled = false;
    let write = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (!value) {
        const laterKey = `${prefix}.PickLater`;
        if (game.i18n.has(laterKey, false)) {
          ui.notifications.info(game.i18n.localize(laterKey));
        }
      }
      resolve(value);
    };

    const optionsHtml = effects
      .map((effect) => {
        const labelKey = effect.flags?.redsteel?.choiceLabel;
        const label = labelKey ? game.i18n.localize(labelKey) : effect.name;
        const checked = effect.disabled ? "" : "checked";
        return `
          <label class="pill">
            <input type="radio" name="trait-choice" value="${effect.id}" ${checked}>
            <span>${label}</span>
          </label>`;
      })
      .join("");

    const content = `
      <form>
        <fieldset class="bane-group">
          <div class="bane-options">${optionsHtml}</div>
        </fieldset>
      </form>
      ${pillStyleBlock()}`;

    new Dialog({
      title,
      content,
      buttons: {
        confirm: {
          label: game.i18n.localize("REDSTEEL.Banes.Apply"),
          callback: async (html) => {
            const chosen = html.find(`input[name="trait-choice"]:checked`).val();
            if (!chosen) {
              finish(false);
              return;
            }
            write = item
              .updateEmbeddedDocuments(
                "ActiveEffect",
                effects.map((effect) => ({ _id: effect.id, disabled: effect.id !== chosen })),
              )
              .then(() => true);
            await write;
            finish(true);
          },
        },
        cancel: {
          label: game.i18n.localize("REDSTEEL.Banes.Cancel"),
          callback: () => finish(false),
        },
      },
      default: "confirm",
      close: () => {
        if (write) write.then(finish, () => finish(false));
        else finish(false);
      },
    }).render(true);
  });
}

/**
 * Run every choice a freshly created trait item asks for, one after another.
 * @param {Item} item
 */
async function runTraitChoices(item) {
  // Group the choice effects by their traitChoice value, in effect order.
  const groups = new Map();
  for (const effect of item.effects?.contents ?? []) {
    const group = effect.flags?.redsteel?.traitChoice;
    if (typeof group !== "string" || !group) continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(effect);
  }

  for (const [group, effects] of groups) {
    await openEffectChoice(item, group, effects);
  }

  if (item.flags?.redsteel?.hatedEnemyTrait) {
    const picked = await openHatedEnemyPicker(item);
    if (!picked) {
      ui.notifications.info(game.i18n.localize("REDSTEEL.Traits.HatedEnemy.PickLater"));
    }
  }
}

/**
 * Register the createItem hook. Call once at ready.
 */
export function registerTraitChoices() {
  Hooks.on("createItem", (item, options, userId) => {
    if (userId !== game.user.id) return;
    if (item.parent?.documentName !== "Actor") return;
    if (item.type !== "feature") return;
    runTraitChoices(item);
  });
}
