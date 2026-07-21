/**
 * Bane ("Metla") registry and picker.
 *
 * A Bane is a creature category a character has trained against. Certain
 * specialisation trees have `bane1`..`baneN` nodes that, once unlocked,
 * grant the player a slot to pick which category fills it. The registry
 * below is the single source of truth for which categories exist and which
 * trees may draw from them; storage and the picker dialog only ever read
 * from it, they never hardcode a category list of their own.
 *
 * Picks live on the actor at
 * `system.specialisations.<specId>.baneChoices.<nodeId>` as an array of
 * registry keys (an array because a single node can grant more than one
 * pick, e.g. countermage's bane2). There is no separate "resolved" flag —
 * a node's pick is simply whatever is stored there, and an empty/missing
 * array means the node is unlocked but not yet resolved.
 */

/**
 * The full Bane registry, keyed by english slug. `label` is always a lang
 * key (never raw Czech text) so the actual strings can live in lang/*.json.
 * `specs` lists every specialisation tree id allowed to pick this Bane.
 */
export const BANE_TYPES = Object.freeze({
  draconic: { label: "REDSTEEL.Banes.Types.draconic", specs: ["ranger", "grimm"] },
  ogroid: { label: "REDSTEEL.Banes.Types.ogroid", specs: ["ranger", "grimm"] },
  lycanthrope: { label: "REDSTEEL.Banes.Types.lycanthrope", specs: ["grimm"] },
  sylvan: { label: "REDSTEEL.Banes.Types.sylvan", specs: ["grimm", "countermage"] },
  vampire: { label: "REDSTEEL.Banes.Types.vampire", specs: ["grimm"] },
  undead: { label: "REDSTEEL.Banes.Types.undead", specs: ["ranger"] },
  beast: { label: "REDSTEEL.Banes.Types.beast", specs: ["ranger"] },
  corrupt: { label: "REDSTEEL.Banes.Types.corrupt", specs: ["ranger"] },
  elf: { label: "REDSTEEL.Banes.Types.elf", specs: ["shadow"] },
  yormun: { label: "REDSTEEL.Banes.Types.yormun", specs: ["shadow"] },
  avesan: { label: "REDSTEEL.Banes.Types.avesan", specs: ["shadow"] },
  insectoid: { label: "REDSTEEL.Banes.Types.insectoid", specs: ["ranger", "grimm"] },
  relict: { label: "REDSTEEL.Banes.Types.relict", specs: ["ranger", "mystic"] },
  necrophage: { label: "REDSTEEL.Banes.Types.necrophage", specs: ["ranger", "grimm"] },
  specter: { label: "REDSTEEL.Banes.Types.specter", specs: ["grimm"] },
  magical: { label: "REDSTEEL.Banes.Types.magical", specs: ["countermage"] },
  demon: { label: "REDSTEEL.Banes.Types.demon", specs: ["ranger", "countermage"] },
  human: { label: "REDSTEEL.Banes.Types.human", specs: ["shadow"] },
  dwarf: { label: "REDSTEEL.Banes.Types.dwarf", specs: ["shadow"] },
  halfling: { label: "REDSTEEL.Banes.Types.halfling", specs: ["shadow"] },
  argos: { label: "REDSTEEL.Banes.Types.argos", specs: ["shadow"] },
  cambion: { label: "REDSTEEL.Banes.Types.cambion", specs: ["shadow"] },
  seraphar: { label: "REDSTEEL.Banes.Types.seraphar", specs: ["shadow"] },
  orcoid: { label: "REDSTEEL.Banes.Types.orcoid", specs: ["ranger"] },
});

/**
 * All Bane registry entries (in registry order) eligible for a given
 * specialisation tree.
 * @param {string} specId
 * @returns {[string, {label: string, specs: string[]}][]}
 */
export function getBaneTypesForSpec(specId) {
  return Object.entries(BANE_TYPES).filter(([, def]) => def.specs.includes(specId));
}

/**
 * Every Bane key an actor currently has picked, across every specialisation
 * tree and every node. Stale keys that no longer exist in the registry are
 * filtered out.
 * @param {Actor|null} actor
 * @returns {Set<string>}
 */
export function getActorBanes(actor) {
  const picked = new Set();
  const specialisations = actor?.system?.specialisations ?? {};

  for (const specData of Object.values(specialisations)) {
    const baneChoices = specData?.baneChoices ?? {};
    for (const keys of Object.values(baneChoices)) {
      for (const key of Array.isArray(keys) ? keys : []) {
        if (key in BANE_TYPES) picked.add(key);
      }
    }
  }

  return picked;
}

/**
 * Localized labels (registry order) for every Bane an actor has picked.
 * @param {Actor|null} actor
 * @returns {string[]}
 */
export function getActorBaneLabels(actor) {
  const picked = getActorBanes(actor);
  return Object.entries(BANE_TYPES)
    .filter(([key]) => picked.has(key))
    .map(([, def]) => game.i18n.localize(def.label));
}

/**
 * Build the pill-style option markup + inline structural CSS shared by the
 * Bane picker. Copied verbatim from the pattern in module/utils/race.mjs —
 * same class names, only renamed to bane-* — since the global dialog theme
 * in css/redsteel.css re-skins `.pill` with `!important`.
 */
function pillStyleBlock() {
  return `
    <style>
      .form-group { margin-bottom: 8px; }
      .bane-group { margin-bottom: 10px; }
      .bane-options { display: flex; flex-wrap: wrap; gap: 6px; }
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
    </style>`;
}

/**
 * Open the Bane picker dialog for a newly unlocked (or re-opened) bane node.
 * The pool offered is every Bane eligible for `specId` minus every Bane the
 * actor has picked anywhere else, except whatever is already stored at this
 * exact node (so re-opening shows the current pick as available/pre-checked
 * instead of filtering it out).
 * @param {Actor} actor
 * @param {string} specId
 * @param {string} nodeId
 * @param {number} count how many picks this node grants
 * @returns {Promise<boolean>} true if a pick was written, false if cancelled/invalid
 */
export async function openBanePicker(actor, specId, nodeId, count) {
  const stored = actor?.system?.specialisations?.[specId]?.baneChoices?.[nodeId] ?? [];
  const storedSet = new Set(Array.isArray(stored) ? stored : []);
  const takenElsewhere = getActorBanes(actor);

  const pool = getBaneTypesForSpec(specId).filter(
    ([key]) => storedSet.has(key) || !takenElsewhere.has(key),
  );

  if (!pool.length) {
    ui.notifications.warn(game.i18n.localize("REDSTEEL.Banes.NoneAvailable"));
    return false;
  }

  return new Promise((resolve) => {
    // Foundry's V1 Dialog closes right after a button callback runs and does
    // not wait for an async callback to finish. Two consequences are handled
    // here: `reopening` keeps the close of a dialog we are deliberately
    // replacing (invalid selection) from resolving, and `write` lets the close
    // handler wait for a confirm's actor.update before deciding what to
    // resolve — otherwise a successful pick resolves false and the caller
    // wrongly reports that nothing was chosen.
    let settled = false;
    let reopening = false;
    let write = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const open = () => {
      const inputType = count === 1 ? "radio" : "checkbox";
      const optionsHtml = pool
        .map(([key, def]) => {
          const checked = storedSet.has(key) ? "checked" : "";
          return `
            <label class="pill">
              <input type="${inputType}" name="bane-choice" value="${key}" ${checked}>
              <span>${game.i18n.localize(def.label)}</span>
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
        title: game.i18n.format("REDSTEEL.Banes.PickerTitle", { count }),
        content,
        buttons: {
          confirm: {
            label: game.i18n.localize("REDSTEEL.Banes.Apply"),
            callback: async (html) => {
              const checked = html
                .find(`input[name="bane-choice"]:checked`)
                .map((_, el) => el.value)
                .get();
              const selected = new Set(checked);

              if (selected.size !== count) {
                ui.notifications.warn(
                  game.i18n.format("REDSTEEL.Banes.InvalidCount", { count }),
                );
                reopening = true;
                open(); // re-open unchanged; nothing has been applied yet
                return;
              }

              write = actor
                .update({
                  [`system.specialisations.${specId}.baneChoices.${nodeId}`]: [
                    ...selected,
                  ],
                })
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
          if (reopening) {
            reopening = false;
            return;
          }
          // A confirm may still be writing — resolve on its outcome, not on
          // the fact that the dialog happened to close first.
          if (write) write.then(finish, () => finish(false));
          else finish(false);
        },
      }).render(true);
    };

    open();
  });
}

/**
 * Clear a node's stored Bane pick(s), if any. No-op if nothing is stored.
 * @param {Actor} actor
 * @param {string} specId
 * @param {string} nodeId
 */
export async function clearBaneChoice(actor, specId, nodeId) {
  const stored = actor?.system?.specialisations?.[specId]?.baneChoices?.[nodeId];
  if (stored === undefined) return;

  await actor.update({
    [`system.specialisations.${specId}.baneChoices.-=${nodeId}`]: null,
  });
}
