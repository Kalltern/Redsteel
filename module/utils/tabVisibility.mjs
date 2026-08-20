/**
 * Per-actor tab visibility.
 *
 * The GM decides, per actor, which of the optional sheet tabs that actor shows:
 * visible to everyone, GM only, or hidden from everyone. The choice is stored on
 * the actor (`system.tabVisibility`) and enforced in RedsteelActorSheet by
 * dropping the part before it renders, so a switched-off tab is genuinely absent
 * from the sheet rather than hidden with CSS.
 *
 * The controls live in core's "Configure Sheet" dialog (the header menu entry
 * every document sheet already has), injected on render. That is the one place
 * that stays reachable no matter what is switched off, which matters because the
 * Config tab is itself one of the tabs that can be hidden.
 */

/**
 * Tabs the GM can switch off. Every key must be both a PARTS key and a primary
 * tab id on the actor sheet (they match for all primary tabs), since the setting
 * is enforced by dropping the part. `types` lists the actor types that render
 * the tab at all — the NPC sheet has no Config tab, so it gets no row for one.
 */
export const CONFIGURABLE_TABS = [
  {
    key: "biography",
    label: "REDSTEEL.Actor.Tabs.Biography",
    types: ["character", "npc"],
  },
  { key: "config", label: "REDSTEEL.Actor.Tabs.Config", types: ["character"] },
  {
    key: "effects",
    label: "REDSTEEL.Actor.Tabs.Effects",
    types: ["character", "npc"],
  },
];

/**
 * The three states. "visible" is the default for any actor that has never been
 * configured, and for any tab missing from the stored object, so leaving this
 * alone changes nothing.
 */
export const TAB_VISIBILITY_MODES = [
  { value: "visible", label: "REDSTEEL.Actor.SheetConfig.Visible" },
  { value: "gm", label: "REDSTEEL.Actor.SheetConfig.GmOnly" },
  { value: "hidden", label: "REDSTEEL.Actor.SheetConfig.Hidden" },
];

/**
 * Build the fieldset added to the Configure Sheet dialog.
 *
 * The selects deliberately carry no `name`: the dialog's root element is itself
 * the form, so a named field would be swept into core's submit data and sent to
 * the document as an unknown update key. They are read by `data-tab-key` and
 * written on change instead, which also means the choice applies whether the GM
 * closes the dialog with "Save Changes" or with the window's X.
 *
 * @param {Actor} actor
 * @param {object[]} tabs The rows to render, already filtered by actor type.
 * @returns {HTMLFieldSetElement}
 */
function buildFieldset(actor, tabs) {
  const i18n = game.i18n;
  const modes = actor.system?.tabVisibility ?? {};

  const fieldset = document.createElement("fieldset");
  fieldset.classList.add("rs-tab-visibility");

  const legend = document.createElement("legend");
  legend.textContent = i18n.localize("REDSTEEL.Actor.SheetConfig.Title");
  fieldset.append(legend);

  for (const { key, label } of tabs) {
    const current = modes[key] || "visible";

    const group = document.createElement("div");
    group.classList.add("form-group");

    const name = document.createElement("label");
    name.textContent = i18n.localize(label);

    const fields = document.createElement("div");
    fields.classList.add("form-fields");

    const select = document.createElement("select");
    select.dataset.tabKey = key;
    for (const mode of TAB_VISIBILITY_MODES) {
      const option = document.createElement("option");
      option.value = mode.value;
      option.textContent = i18n.localize(mode.label);
      option.selected = mode.value === current;
      select.append(option);
    }

    fields.append(select);
    group.append(name, fields);
    fieldset.append(group);
  }

  const hint = document.createElement("p");
  hint.classList.add("hint");
  hint.textContent = i18n.localize("REDSTEEL.Actor.SheetConfig.Hint");
  fieldset.append(hint);

  return fieldset;
}

/**
 * Add the tab-visibility rows to an open Configure Sheet dialog.
 *
 * @param {ApplicationV2} app     The DocumentSheetConfig instance.
 * @param {HTMLElement} element   Its rendered root element.
 */
function injectTabVisibility(app, element) {
  if (!game.user.isGM) return;

  const actor = app.document;
  if (actor?.documentName !== "Actor") return;

  const tabs = CONFIGURABLE_TABS.filter((tab) => tab.types.includes(actor.type));
  if (!tabs.length) return;

  const root = element instanceof HTMLElement ? element : element?.[0];
  // Re-renders of the dialog rebuild its parts, but guard anyway: a second copy
  // of the fieldset would silently fight the first over the same field.
  if (!root || root.querySelector(".rs-tab-visibility")) return;

  const form = root.tagName === "FORM" ? root : root.querySelector("form");
  if (!form) return;

  const fieldset = buildFieldset(actor, tabs);
  const footer = form.querySelector("footer, .form-footer, .sheet-footer");
  if (footer) footer.before(fieldset);
  else form.append(fieldset);

  fieldset.querySelectorAll("select[data-tab-key]").forEach((select) =>
    select.addEventListener("change", async (event) => {
      const target = event.currentTarget;
      await actor.update({
        [`system.tabVisibility.${target.dataset.tabKey}`]: target.value,
      });
    }),
  );

  // The dialog was sized before the fieldset existed.
  app.setPosition({ height: "auto" });
}

/**
 * Wire the injection into core's Configure Sheet dialog.
 *
 * Both hook names are listened for: the generic ApplicationV2 render hook (the
 * one the item-directory localisation already relies on) and the class-specific
 * one. Whichever fires, `injectTabVisibility` bails out when the fieldset is
 * already there, so listening twice cannot inject twice.
 */
export function registerTabVisibilityConfig() {
  const handler = (app, element) => {
    const SheetConfig = foundry.applications.apps?.DocumentSheetConfig;
    if (!SheetConfig || !(app instanceof SheetConfig)) return;
    injectTabVisibility(app, element);
  };
  Hooks.on("renderApplicationV2", handler);
  Hooks.on("renderDocumentSheetConfig", handler);
}
