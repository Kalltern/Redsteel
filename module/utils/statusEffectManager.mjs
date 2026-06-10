import {
  getConditionItems,
  conditionStatusId,
} from "./customConditions.mjs";

export async function statusEffectManager() {
  const builtInEffects = Object.entries(
    CONFIG.REDSTEEL.effectDefinitions,
  ).map(([id, def]) => ({
    id,
    name: def.name,
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

  async function applyEffectToAll(effectId) {
    const actors = getSelectedActors();
    if (!actors.length) return;

    await Promise.all(
      actors.map((actor) => game.redsteel.applyEffect(actor, effectId)),
    );
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

  async function reduceEffectStackFromAll(effectId) {
    const actors = getSelectedActors();
    if (!actors.length) return;

    await Promise.all(
      actors.map(async (actor) => {
        const existing = getEffect(actor, effectId);
        if (!existing) return;

        const stacks = existing.getFlag("redsteel", "stacks") ?? 0;

        // If no stacks tracked → just delete
        if (!stacks || stacks <= 1) {
          await existing.delete();
          return;
        }

        // Otherwise reduce by 1
        const newStacks = stacks - 1;

        await existing.update({
          "flags.redsteel.stacks": newStacks,
          "flags.statuscounter.value": newStacks,
        });
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

.redsteel-actions span {
  cursor:pointer;
  margin-left:6px;
  transition:0.15s;
}

.redsteel-actions span:hover {
  color:#ff4d4d;
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
    content += `
<div
  class="redsteel-row"
  data-effect-row="${effect.id}"
  data-effect-name="${effect.name.toLowerCase()}"
>
  <div class="redsteel-effect-info">
    <img src="${effect.icon}" class="redsteel-effect-icon"/>
    <span class="redsteel-effect-name">${effect.name}</span>
  </div>
  <div class="redsteel-actions">
        <span data-apply="${effect.id}">APPLY</span> |
        <span data-reduce="${effect.id}">REDUCE</span> |
        <span data-remove="${effect.id}">REMOVE</span>
      </div>
    </div>
  `;
  }

  content += `
  </div>
</div>
`;

  new Dialog({
    title: "Status Effects",
    content,
    buttons: {},
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
      root
        .querySelector('[data-action="removeAll"]')
        .addEventListener("click", async () => {
          await removeAllEffects();
        });

      root.querySelectorAll("[data-apply]").forEach((el) => {
        el.addEventListener("click", async (e) => {
          const effectId = e.currentTarget.dataset.apply;
          await applyEffectToAll(effectId);
        });
      });

      root.querySelectorAll("[data-reduce]").forEach((el) => {
        el.addEventListener("click", async (e) => {
          const effectId = e.currentTarget.dataset.reduce;
          await reduceEffectStackFromAll(effectId);
        });
      });
      root.querySelectorAll("[data-remove]").forEach((el) => {
        el.addEventListener("click", async (e) => {
          const effectId = e.currentTarget.dataset.remove;
          await removeEffectFromAll(effectId);
        });
      });
      root.querySelectorAll(".redsteel-row").forEach((row) => {
        const apply = row.querySelector("[data-apply]");
        const reduce = row.querySelector("[data-reduce]");
        const remove = row.querySelector("[data-remove]");

        const addHover = () => row.classList.add("hovering");
        const removeHover = () => row.classList.remove("hovering");

        if (apply) {
          apply.addEventListener("mouseenter", addHover);
          apply.addEventListener("mouseleave", removeHover);
        }

        if (remove) {
          remove.addEventListener("mouseenter", addHover);
          remove.addEventListener("mouseleave", removeHover);
        }

        if (reduce) {
          reduce.addEventListener("mouseenter", addHover);
          reduce.addEventListener("mouseleave", removeHover);
        }
      });
    },
  }).render(true);
}
