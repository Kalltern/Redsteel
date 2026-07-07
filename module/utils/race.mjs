/**
 * Race selection and racial "choice group" resolution.
 *
 * A race Item's fixed bonuses are ordinary Active Effects living on the race
 * Item itself (already enabled). Player CHOICES (e.g. "+1 Obratnost NEBO
 * Inteligence") are authored as `system.choices` — an array of groups, each
 * naming a set of Active Effect ids (also on the same race Item) and how many
 * of them the player must pick. There is no separate "selected" flag anywhere:
 * an option counts as selected purely because its Active Effect is currently
 * enabled (`disabled: false`).
 */

/**
 * Normalize a race Item's `system.choices` into a clean array of groups.
 * Tolerates the array arriving as an indexed object after a form submit.
 * Groups with no effect ids are dropped.
 * @param {Item} item
 * @returns {{label: string, count: number, effectIds: string[]}[]}
 */
export function getRaceChoiceGroups(item) {
  const raw = item?.system?.choices;
  const groups = Array.isArray(raw) ? raw : Object.values(raw ?? {});

  return groups
    .map((group) => {
      const rawIds = group?.effectIds;
      const ids = Array.isArray(rawIds) ? rawIds : Object.values(rawIds ?? {});
      return {
        label: group?.label ?? "",
        count: Math.max(1, Number(group?.count) || 1),
        effectIds: ids.filter((id) => typeof id === "string" && id),
      };
    })
    .filter((group) => group.effectIds.length > 0);
}

/**
 * Collect every available race Item: world items plus every race found in any
 * Item compendium pack. A world item wins over a compendium item sharing its
 * name (world items are considered the authoritative copy).
 * @returns {Promise<Item[]>} sorted by localized name
 */
export async function getAvailableRaces() {
  const byName = new Map();

  for (const item of game.items.filter((i) => i.type === "race")) {
    byName.set(item.name, item);
  }

  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    const docs = await pack.getDocuments({ type: "race" });
    for (const doc of docs) {
      if (!byName.has(doc.name)) byName.set(doc.name, doc);
    }
  }

  return [...byName.values()].sort((a, b) => {
    const nameA = a.localizedName ?? a.name;
    const nameB = b.localizedName ?? b.name;
    return nameA.localeCompare(nameB);
  });
}

/**
 * Disable every Active Effect referenced by any choice group on a race Item.
 * Called right after the race Item lands on an actor, so no choice option
 * applies until the player actually picks it. Effect ids that no longer exist
 * on the item are silently skipped.
 * @param {Item} item
 */
export async function initializeRaceChoices(item) {
  const groups = getRaceChoiceGroups(item);
  if (!groups.length) return;

  const effectIds = new Set();
  for (const group of groups) {
    for (const id of group.effectIds) effectIds.add(id);
  }

  const updates = [];
  for (const id of effectIds) {
    if (!item.effects.get(id)) continue;
    updates.push({ _id: id, disabled: true });
  }

  if (updates.length) {
    await item.updateEmbeddedDocuments("ActiveEffect", updates);
  }
}

/**
 * Build the pill-style option markup + inline structural CSS shared by the
 * race picker and the choices dialog. Colors are deliberately left as the
 * existing pill pattern (see attackActions.mjs) — the global dialog theme in
 * css/redsteel.css re-skins `.pill` with `!important`.
 */
function pillStyleBlock() {
  return `
    <style>
      .form-group { margin-bottom: 8px; }
      .race-choice-group { margin-bottom: 10px; }
      .race-choice-options { display: flex; flex-wrap: wrap; gap: 6px; }
      .pill input { display: none; }
      .pill {
        cursor: pointer;
        flex: 0 0 auto;
      }
      .pill span:hover {
        border-color: #999;
        color: white;
      }
      .pill span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border: 1px solid #666;
        border-radius: 999px;
        background: #2b2b2b;
        color: #ccc;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .pill input:checked + span {
        background: #4a6fa5;
        border-color: #6ea8ff;
        color: white;
      }
      .race-picker-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 360px;
        overflow-y: auto;
      }
      .race-picker-list .race-choice {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 6px;
        cursor: pointer;
      }
    </style>`;
}

/**
 * Open a dialog listing every available race. Clicking a race replaces (with
 * confirmation, if one is already present) or adds it as an owned Item on the
 * actor, then initializes and — if it has choice groups — opens the choices
 * dialog for it.
 * @param {Actor} actor
 */
export async function openRacePicker(actor) {
  if (!actor) return;

  const races = await getAvailableRaces();

  const rowsHtml = races
    .map((race, index) => {
      const name = race.localizedName ?? race.name;
      return `
        <div class="race-choice" data-index="${index}">
          <img src="${race.img}" width="28" height="28" style="border:none; flex:0 0 auto;">
          <span>${name}</span>
        </div>`;
    })
    .join("");

  const content = `
    <div class="race-picker-list">
      ${rowsHtml}
    </div>
    ${pillStyleBlock()}`;

  const dialog = new Dialog({
    title: game.i18n.localize("REDSTEEL.Race.PickerTitle"),
    content,
    buttons: {},
    render: (html) => {
      const root = html instanceof HTMLElement ? html : html[0];
      root.querySelectorAll(".race-picker-list .race-choice[data-index]").forEach((row) => {
        row.addEventListener("click", async () => {
          const raceDoc = races[Number(row.dataset.index)];
          if (!raceDoc) return;

          const existingRace = actor.items.find((i) => i.type === "race");
          if (existingRace) {
            const confirmed = await Dialog.confirm({
              title: game.i18n.localize("REDSTEEL.Race.ReplaceTitle"),
              content: `<p>${game.i18n.format("REDSTEEL.Race.ReplaceContent", {
                race: existingRace.localizedName ?? existingRace.name,
              })}</p>`,
            });
            if (!confirmed) return;
            await existingRace.delete();
          }

          const [created] = await actor.createEmbeddedDocuments("Item", [
            raceDoc.toObject(),
          ]);

          await initializeRaceChoices(created);
          if (getRaceChoiceGroups(created).length) {
            await openRaceChoicesDialog(created);
          }

          dialog.close();
        });
      });
    },
  });

  dialog.render(true);
}

/**
 * Open the choice-resolution dialog for a race Item that has choice groups.
 * Radios are used for groups requiring exactly 1 pick, checkboxes otherwise.
 * On confirm, every group is validated to have exactly `count` distinct
 * selections; if any group fails validation, the dialog re-opens (unchanged)
 * with a localized warning instead of applying anything.
 * @param {Item} item
 */
export async function openRaceChoicesDialog(item) {
  const groups = getRaceChoiceGroups(item);
  if (!groups.length) return;

  const open = () => {
    const groupsHtml = groups
      .map((group, groupIndex) => {
        const inputType = group.count === 1 ? "radio" : "checkbox";
        const optionsHtml = group.effectIds
          .map((effectId) => {
            const effect = item.effects.get(effectId);
            if (!effect) return "";
            const checked = !effect.disabled ? "checked" : "";
            const icon = effect.img
              ? `<img src="${effect.img}" width="16" height="16" style="border:none;">`
              : "";
            return `
              <label class="pill">
                <input type="${inputType}" name="choice-${groupIndex}" value="${effectId}" ${checked}>
                <span>${icon}${effect.name}</span>
              </label>`;
          })
          .join("");

        return `
          <fieldset class="race-choice-group">
            <legend>${group.label} (${game.i18n.format("REDSTEEL.Race.Choices.PickCount", {
              count: group.count,
            })})</legend>
            <div class="race-choice-options">${optionsHtml}</div>
          </fieldset>`;
      })
      .join("");

    const content = `<form>${groupsHtml}</form>${pillStyleBlock()}`;

    new Dialog({
      title: game.i18n.format("REDSTEEL.Race.Choices.Title", {
        race: item.localizedName ?? item.name,
      }),
      content,
      buttons: {
        confirm: {
          label: game.i18n.localize("REDSTEEL.Race.Choices.Apply"),
          callback: async (html) => {
            const updates = [];

            for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
              const group = groups[groupIndex];
              const checked = html
                .find(`input[name="choice-${groupIndex}"]:checked`)
                .map((_, el) => el.value)
                .get();
              const selected = new Set(checked);

              if (selected.size !== group.count) {
                ui.notifications.warn(
                  game.i18n.format("REDSTEEL.Race.Choices.InvalidCount", {
                    label: group.label,
                    count: group.count,
                  }),
                );
                open(); // re-open unchanged; nothing has been applied yet
                return;
              }

              for (const effectId of group.effectIds) {
                updates.push({ _id: effectId, disabled: !selected.has(effectId) });
              }
            }

            if (updates.length) {
              await item.updateEmbeddedDocuments("ActiveEffect", updates);
            }
          },
        },
      },
      default: "confirm",
    }).render(true);
  };

  open();
}
