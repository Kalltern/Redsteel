import {
  getConditionItems,
  conditionStatusId,
  resolveEffectDefinition,
} from "./customConditions.mjs";
import { RedsteelActiveEffect } from "../documents/effects.mjs";

/** Hard ceiling on anything the GM types in, stacks or turns alike. */
const MAX_AMOUNT = 99;

export async function statusEffectManager() {
  const builtInEffects = Object.entries(
    CONFIG.REDSTEEL.effectDefinitions,
  ).map(([id, def]) => ({
    id,
    name: game.i18n.localize(def.name),
    icon: def.img,
  }));

  const builtInIds = new Set(builtInEffects.map((e) => e.id));
  const conditionEffects = [];
  for (const item of getConditionItems()) {
    const id = conditionStatusId(item);
    if (!id || builtInIds.has(id)) continue;
    if (conditionEffects.some((e) => e.id === id)) continue;
    conditionEffects.push({ id, name: item.name, icon: item.img });
  }

  const STATUS_EFFECTS = [...builtInEffects, ...conditionEffects].sort(
    (a, b) => a.name.localeCompare(b.name),
  );

  /**
   * What one unit of an effect's amount means, and what it starts at.
   *
   * The row's number box drives APPLY, + and − alike, so it has to describe a
   * single number. That number is always the one the token counter shows:
   * turns for Slow, rounds for Poison, stacks for Bleeding. Effects that count
   * nothing (Prone, Dead, most markers) get no box.
   */
  function amountInfo(effectId) {
    const def = resolveEffectDefinition(effectId)?.def;
    if (!def) return null;

    if (def.defaultRounds) {
      return { unit: "rounds", fallback: def.defaultRounds, max: MAX_AMOUNT };
    }
    if (def.defaultTurns || def.useDuration) {
      return {
        unit: "turns",
        fallback: def.defaultTurns || 1,
        max: MAX_AMOUNT,
      };
    }
    if (RedsteelActiveEffect.countsStacks(def)) {
      return {
        unit: "stacks",
        fallback: 1,
        max: def.maxStacks ?? MAX_AMOUNT,
      };
    }
    return null;
  }
  function getSelectedActors() {
    const tokens = canvas.tokens.controlled;

    if (!tokens.length) {
      ui.notifications.warn("Select at least one token.");
      return [];
    }

    return [...new Set(tokens.map((t) => t.actor).filter(Boolean))];
  }

  function getEffect(actor, effectId) {
    return actor.effects.find((e) => e.statuses?.has(effectId));
  }

  function normalizeSearchText(value) {
    return String(value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  }

  function effectMatchesSearch(effectName, searchValue) {
    const normalizedEffectName = normalizeSearchText(effectName);
    const normalizedSearch = normalizeSearchText(searchValue);

    if (!normalizedSearch) return true;

    return normalizedSearch
      .split(" ")
      .every((term) => normalizedEffectName.includes(term));
  }

  /**
   * @param {string} effectId
   * @param {number|null} amount - Typed by the GM, or null to use the
   *   definition's own default duration / one stack.
   */
  async function applyEffectToAll(effectId, amount) {
    const actors = getSelectedActors();
    if (!actors.length) return;

    const info = amountInfo(effectId);
    const options =
      info && amount
        ? RedsteelActiveEffect.amountOption(
            resolveEffectDefinition(effectId)?.def,
            Math.min(amount, info.max),
          )
        : {};

    // Sequential, not Promise.all: two actors sharing one unlinked prototype
    // both write to the same delta, and interleaved effect creation there ends
    // up with one of the two silently missing its changes.
    for (const actor of actors) {
      await game.redsteel.applyEffect(actor, effectId, options);
    }
  }

  /**
   * Walk the counter up or down by `delta` on every selected token. Bumping an
   * effect nobody has applies it at that amount, which is what makes "+5" a
   * single click rather than apply-then-adjust.
   */
  async function adjustEffectOnAll(effectId, delta) {
    const actors = getSelectedActors();
    if (!actors.length) return;

    const info = amountInfo(effectId);
    if (!info && delta > 0) {
      ui.notifications.info(
        `"${effectId}" has nothing to count — use APPLY or REMOVE.`,
      );
      return;
    }

    for (const actor of actors) {
      await game.redsteel.adjustEffectAmount(actor, effectId, delta, {
        max: MAX_AMOUNT,
      });
    }
  }

  async function removeEffectFromAll(effectId) {
    const actors = getSelectedActors();
    if (!actors.length) return;

    await Promise.all(
      actors.map(async (actor) => {
        const existing = getEffect(actor, effectId);
        if (existing) await existing.delete();
      }),
    );
  }

  async function removeAllEffects() {
    const actors = getSelectedActors();
    if (!actors.length) return;

    await Promise.all(
      actors.map(async (actor) => {
        const redsteelEffects = actor.effects.filter((e) =>
          e.getFlag("core", "statusId"),
        );

        for (const effect of [...redsteelEffects]) {
          await effect.delete();
        }
      }),
    );

    ui.notifications.info("All status effects removed.");
  }

  /* ---------------- UI BUILD ---------------- */

  let content = `
<style>
.redsteel-status-wrapper {
  display:flex;
  flex-direction:column;
  gap:6px;
}

.redsteel-scroll {
  max-height:400px;
  overflow-y:auto;
  padding-right:4px;
}

.redsteel-row {
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-size:13px;
  padding:4px 0;
}

.redsteel-effect-info {
  display:flex;
  align-items:center;
  gap:6px;
}

.redsteel-effect-icon {
  width:18px;
  height:18px;
  object-fit:contain;
}

.redsteel-effect-name {
  transition:0.15s;
}

.redsteel-row.hovering .redsteel-effect-name {
  color:#ff4d4d;

}

.redsteel-actions {
  display:flex;
  align-items:center;
  gap:2px;
  white-space:nowrap;
}

.redsteel-actions span {
  cursor:pointer;
  margin-left:6px;
  transition:0.15s;
}

.redsteel-actions span:hover {
  color:#ff4d4d;
}

/* The amount box drives APPLY, + and − alike. Placeholder shows what the
   effect does on its own, so an empty box is never a mystery. */
.redsteel-amount {
  width:34px;
  margin-right:4px;
  padding:1px 2px;
  text-align:center;
  font-size:12px;
}

/* A marker that counts nothing keeps the space so every row's buttons stay
   on the same column. */
.redsteel-amount-spacer {
  display:inline-block;
  width:34px;
  margin-right:4px;
}

.redsteel-step {
  cursor:pointer;
  padding:0 4px;
  font-weight:bold;
  transition:0.15s;
}

.redsteel-step:hover {
  color:#ff4d4d;
}

.redsteel-current {
  min-width:18px;
  font-size:11px;
  opacity:0.7;
  text-align:right;
}
</style>

<div class="redsteel-status-wrapper">
  <button data-action="removeAll" style="background:#5a1d1d;color:white;">
    🗑 Remove All Status Effects
  </button>
  <hr/>
  <div style="margin-bottom:6px;">
  <input
    type="text"
    id="redsteel-effect-search"
    placeholder="Search effects..."
    style="width:100%; padding:4px;"
  />
</div>
  <div class="redsteel-scroll">
`;

  for (const effect of STATUS_EFFECTS) {
    const info = amountInfo(effect.id);
    const amountCell = info
      ? `<input
           type="number"
           class="redsteel-amount"
           data-amount="${effect.id}"
           min="1"
           max="${info.max}"
           step="1"
           placeholder="${info.fallback}"
           data-tooltip="${info.unit} (max ${info.max})"
         />`
      : `<span class="redsteel-amount-spacer"></span>`;

    const stepCells = info
      ? `<span class="redsteel-step" data-step-down="${effect.id}" data-tooltip="Remove one ${info.unit.slice(0, -1)} (or the typed amount)">−</span>
         <span class="redsteel-step" data-step-up="${effect.id}" data-tooltip="Add one ${info.unit.slice(0, -1)} (or the typed amount)">+</span>`
      : "";

    content += `
<div
  class="redsteel-row"
  data-effect-row="${effect.id}"
  data-effect-name="${effect.name.toLowerCase()}"
>
  <div class="redsteel-effect-info">
    <img src="${effect.icon}" class="redsteel-effect-icon"/>
    <span class="redsteel-effect-name">${effect.name}</span>
    <span class="redsteel-current" data-current="${effect.id}"></span>
  </div>
  <div class="redsteel-actions">
        ${amountCell}${stepCells}
        <span data-apply="${effect.id}">APPLY</span> |
        <span data-remove="${effect.id}">REMOVE</span>
      </div>
    </div>
  `;
  }

  content += `
  </div>
</div>
`;

  // Assigned during render, called on close: the row readouts follow the
  // canvas selection, so the dialog holds live hooks that have to come off
  // with it.
  let teardown = () => {};

  new Dialog({
    title: "Status Effects",
    content,
    buttons: {},
    close: () => teardown(),
    render: (html) => {
      const root = html[0];

      const searchInput = root.querySelector("#redsteel-effect-search");

      searchInput?.addEventListener("input", (e) => {
        const value = e.currentTarget.value;

        const rows = root.querySelectorAll(".redsteel-row");

        rows.forEach((row) => {
          const effectName = row.dataset.effectName ?? "";

          const matches = effectMatchesSearch(effectName, value);

          row.style.display = matches ? "flex" : "none";
        });
      });
      /** The number typed in a row, or null when the box is empty. */
      const typedAmount = (effectId) => {
        const box = root.querySelector(`[data-amount="${effectId}"]`);
        const raw = Number(box?.value);
        if (!Number.isFinite(raw) || raw <= 0) return null;
        return Math.min(Math.floor(raw), MAX_AMOUNT);
      };

      /**
       * Print what the first selected token currently has, so raising a count
       * is not done blind. One token's worth is enough to steer by; the
       * buttons still act on the whole selection.
       */
      const refreshCurrent = () => {
        const actor = canvas.tokens?.controlled?.[0]?.actor ?? null;

        for (const cell of root.querySelectorAll("[data-current]")) {
          const effectId = cell.dataset.current;
          const effect = actor ? getEffect(actor, effectId) : null;

          if (!effect) {
            cell.textContent = "";
            continue;
          }

          const def = resolveEffectDefinition(effectId)?.def;
          const tracked = RedsteelActiveEffect.trackedAmount(effect, def);
          cell.textContent = tracked ? `${tracked.value}` : "•";
        }
      };

      // Selection changes while the dialog is open are normal GM work: pick
      // the next token, read its counts, act on it.
      const onControl = () => refreshCurrent();
      Hooks.on("controlToken", onControl);
      Hooks.on("updateActiveEffect", onControl);
      Hooks.on("createActiveEffect", onControl);
      Hooks.on("deleteActiveEffect", onControl);
      refreshCurrent();

      root
        .querySelector('[data-action="removeAll"]')
        .addEventListener("click", async () => {
          await removeAllEffects();
        });

      root.querySelectorAll("[data-apply]").forEach((el) => {
        el.addEventListener("click", async (e) => {
          const effectId = e.currentTarget.dataset.apply;
          await applyEffectToAll(effectId, typedAmount(effectId));
        });
      });

      root.querySelectorAll("[data-step-up]").forEach((el) => {
        el.addEventListener("click", async (e) => {
          const effectId = e.currentTarget.dataset.stepUp;
          await adjustEffectOnAll(effectId, typedAmount(effectId) ?? 1);
        });
      });

      root.querySelectorAll("[data-step-down]").forEach((el) => {
        el.addEventListener("click", async (e) => {
          const effectId = e.currentTarget.dataset.stepDown;
          await adjustEffectOnAll(effectId, -(typedAmount(effectId) ?? 1));
        });
      });

      root.querySelectorAll("[data-remove]").forEach((el) => {
        el.addEventListener("click", async (e) => {
          const effectId = e.currentTarget.dataset.remove;
          await removeEffectFromAll(effectId);
        });
      });

      // Enter in the amount box applies — the common case is type a number,
      // apply, move on.
      root.querySelectorAll("[data-amount]").forEach((el) => {
        el.addEventListener("keydown", async (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const effectId = e.currentTarget.dataset.amount;
          await applyEffectToAll(effectId, typedAmount(effectId));
        });
      });

      root.querySelectorAll(".redsteel-row").forEach((row) => {
        const addHover = () => row.classList.add("hovering");
        const removeHover = () => row.classList.remove("hovering");

        for (const el of row.querySelectorAll(
          "[data-apply], [data-remove], [data-step-up], [data-step-down]",
        )) {
          el.addEventListener("mouseenter", addHover);
          el.addEventListener("mouseleave", removeHover);
        }
      });

      teardown = () => {
        Hooks.off("controlToken", onControl);
        Hooks.off("updateActiveEffect", onControl);
        Hooks.off("createActiveEffect", onControl);
        Hooks.off("deleteActiveEffect", onControl);
      };
    },
  }).render(true);
}
