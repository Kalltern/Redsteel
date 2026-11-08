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
 * A feature that names its stat on arrival: Expertíza picks a non-combat skill
 * (`flags.redsteel.skillCritChoice`, the Critical Success it adds) and Trénink a
 * primary attribute (`flags.redsteel.attributeChoice`, the points it adds). The
 * pick becomes a real Active Effect on the item, so it behaves like any other
 * passive buff and leaves with the item.
 * @param {Item} item
 */
async function runStatChoice(item) {
  const flags = item.flags?.redsteel ?? {};
  const asSkill = Number(flags.skillCritChoice) || 0;
  const asAttribute = Number(flags.attributeChoice) || 0;
  if (!asSkill && !asAttribute) return;

  const system = item.parent.system;
  const options = asSkill
    ? Object.keys(system.skills ?? {}).map((key) => [
        key,
        game.i18n.localize(`REDSTEEL.Actor.Character.skills.${key}.label`),
      ])
    : Object.keys(system.attributes ?? {}).map((key) => [
        key,
        game.i18n.localize(`REDSTEEL.Actor.Character.Attribute.${key.capitalize()}.long`),
      ]);
  options.sort((a, b) => a[1].localeCompare(b[1]));
  const prompt = game.i18n.localize(
    `REDSTEEL.FeatureAction.${asSkill ? "ChooseSkill" : "ChooseAttribute"}`,
  );
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: item.localizedName ?? item.name },
    content: `<p>${prompt}</p><select name="pick">${options
      .map(([key, label]) => `<option value="${key}">${label}</option>`)
      .join("")}</select>`,
    ok: { callback: (_event, button) => button.form.elements.pick.value },
    rejectClose: false,
  });
  if (!picked) return;
  const change = asSkill
    ? { key: `system.skills.${picked}.critbonus`, type: "add", value: asSkill }
    : { key: `system.attributes.${picked}.bonus`, type: "add", value: asAttribute };
  await item.createEmbeddedDocuments("ActiveEffect", [
    { name: item.name, img: item.img, transfer: true, changes: [change] },
  ]);
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

  await runStatChoice(item);

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
