export function registerEffectSheetExtensions() {
  Hooks.on("renderActiveEffectConfig", (app, html) => {
    const effect = app.document;

    const durationTab = html.querySelector('.tab[data-tab="duration"]');
    if (durationTab) {
      const current = effect?.getFlag("redsteel", "actorTurns") ?? "";

      const field = `
        <div class="form-group">
          <label>Actor Turns</label>
          <div class="form-fields">
            <input type="number"
                   name="flags.redsteel.actorTurns"
                   value="${current}"
                   min="0"
                   step="1"/>
          </div>
        </div>
      `;

      durationTab.insertAdjacentHTML("beforeend", field);
    }

    // Roll trigger pill tags — same behavior as trait/feature items:
    // pills appear in chat when a matching roll is made.
    const detailsTab = html.querySelector('.tab[data-tab="details"]');
    if (detailsTab) {
      const rawTriggers = foundry.utils.escapeHTML(
        String(effect?.getFlag("redsteel", "rollTriggersRaw") ?? ""),
      );

      const triggersField = `
        <div class="form-group">
          <label>Roll Triggers</label>
          <div class="form-fields">
            <input type="text"
                   name="flags.redsteel.rollTriggersRaw"
                   value="${rawTriggers}"
                   placeholder="e.g. res, athletics"/>
          </div>
          <p class="hint">
            Comma-separated. Pills appear in chat when a matching roll is made.
            Attributes are written with shortcut only (str, res).
          </p>
        </div>
      `;

      detailsTab.insertAdjacentHTML("beforeend", triggersField);
    }
  });
}
