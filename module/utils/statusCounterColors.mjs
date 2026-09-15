import { RedsteelActiveEffect } from "../documents/effects.mjs";
import {
  buildConditionDefinition,
  conditionStatusId,
  getConditionItems,
} from "./customConditions.mjs";

/**
 * Token status counters coloured by what they count, so the number on an icon
 * reads at a glance: turquoise for stacks, green for combat rounds, yellow for the
 * bearer's own turns.
 *
 * The badge belongs to the Status Icon Counters module. It picks one counter
 * class per effect (by the effect's first status id) and takes the badge font
 * from that class's static createFont, which is its supported way to recolour.
 * So each kind gets a StatusCounter subclass, and every status id is registered
 * under the kind RedsteelActiveEffect.counterKind() reads off its definition.
 * The *number* on the badge is held to the same kind by counterAmount()
 * wherever effects.mjs writes it, so the colour never describes a different
 * quantity than the one shown.
 *
 * Token badges only: the module's combat tracker badges take their colour
 * straight from its world settings.
 */

export const COUNTER_COLORS = {
  stacks: "#00f9f9",
  rounds: "#6fd66f",
  turns: "#ffd84a",
};

/** Counter type ids as registered with the module. Also its font cache key. */
export const COUNTER_TYPES = {
  stacks: "redsteel.stacks",
  rounds: "redsteel.rounds",
  turns: "redsteel.turns",
};

export function registerStatusCounterColors() {
  // The module builds its API in its own init, which runs after the system's.
  // `setup` is after that and before the UI or canvas draws a single counter,
  // and the module caches each effect's counter class on first draw.
  Hooks.once("setup", () => {
    const module = game.modules.get("statuscounter");
    const api = module?.active ? module.api : null;
    if (!api?.StatusCounter || !api?.addCounterType) return;

    const classes = {};
    for (const [kind, typeId] of Object.entries(COUNTER_TYPES)) {
      classes[kind] = counterClass(api.StatusCounter, typeId, COUNTER_COLORS[kind]);
    }

    const register = () => registerStatusIds(api.addCounterType, classes);
    register();

    // A condition item created or retimed mid-session: effects applied from
    // then on get its colour. Counters already drawn keep the class they have.
    for (const hook of ["createItem", "updateItem"]) {
      Hooks.on(hook, (item) => {
        if (item.type === "condition") register();
      });
    }
  });
}

function counterClass(StatusCounter, typeId, color) {
  return class extends StatusCounter {
    type = typeId;

    // Kept out of the module's per-effect Configure dialog. Switching a live
    // counter's type there relabels the cached counter without changing its
    // class, which would cache the wrong colour under this type for every
    // badge of the kind.
    static allowType() {
      return false;
    }

    static createFont(size) {
      const font = super.createFont(size);
      font.fill = color;
      return font;
    }
  };
}

function registerStatusIds(addCounterType, classes) {
  const ids = { stacks: [], rounds: [], turns: [] };
  const add = (id, def) => {
    const kind = RedsteelActiveEffect.counterKind(def);
    if (kind) ids[kind].push(def.statuses?.[0] ?? id);
  };

  for (const [id, def] of Object.entries(CONFIG.REDSTEEL.effectDefinitions ?? {})) {
    add(id, def);
  }
  for (const item of getConditionItems()) {
    add(conditionStatusId(item), buildConditionDefinition(item));
  }

  for (const [kind, typeId] of Object.entries(COUNTER_TYPES)) {
    addCounterType(typeId, classes[kind], ids[kind]);
  }
}
