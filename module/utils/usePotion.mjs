import { applyPoisonToWeapon } from "./usePoison.mjs";
import { clearBleedEffects } from "./otherActions.mjs";

/**
 * Copy the buff Active Effects authored on a consumable onto an actor as
 * permanent, passive effects. The effects are blueprints on the item (they do
 * not transfer just by carrying it — see RedsteelItem#transferredEffects); on
 * use they are duplicated onto the drinker, where they persist until removed.
 * Their duration is intentionally not tied to combat rounds/turns.
 *
 * @param {Actor} actor          The actor receiving the buffs.
 * @param {Item}  consumable     The potion/poison being used.
 * @returns {Promise<string>}    Chat summary fragment ("" if no buffs).
 */
export async function applyItemBuffsToActor(actor, consumable) {
  const sources = consumable.effects.filter((e) => !e.disabled);
  if (!sources.length) return "";

  const effectData = sources.map((effect) => {
    const data = effect.toObject();
    delete data._id;
    data.disabled = false;
    // Actor-owned effects don't transfer; be explicit anyway.
    data.transfer = false;
    // Permanent buff — no combat-round/turn duration.
    data.duration = {};
    data.origin = consumable.uuid;
    foundry.utils.setProperty(
      data,
      "flags.redsteel.fromConsumable",
      consumable.localizedName ?? consumable.name,
    );
    return data;
  });

  const created = await actor.createEmbeddedDocuments(
    "ActiveEffect",
    effectData,
  );

  const names = created.map((e) => e.name).join(", ");
  return `<p><b>Buff:</b> ${names}</p>`;
}

export async function usePotion() {
  const context = game.redsteel.selectToken({ notifyFallback: true });
  if (!context) return;

  const { actor, token } = context;

  const applyConsumableEffects = async (consumable, roll, drinkingRoll) => {
    let effectResults = "";
    // Number() on both sides: a hand-typed sheet value can be a string, and
    // "8" + 8 silently produces 88 instead of 16.
    const toxicityIncrease = Number(consumable.system.toxicity) || 0;
    const finalToxicity =
      drinkingRoll.total >= 0
        ? Math.floor(toxicityIncrease / 2)
        : toxicityIncrease;

    await actor.update({
      "system.stats.toxicity.value":
        (Number(actor.system.stats.toxicity.value) || 0) + finalToxicity,
    });
    effectResults += `<p><b>Toxicity:</b> Increased by ${finalToxicity}</p>`;

    const applyStat = async (statKey, label) => {
      const amount = Number(roll.total) || 0;
      await actor.update({
        [`system.stats.${statKey}.value`]:
          (Number(actor.system.stats[statKey].value) || 0) + amount,
      });
      effectResults += `<p><b>${label}:</b> Increased by ${amount}</p>`;
    };

    if (consumable.system.type === "health")
      await applyStat("health", "Health");
    if (consumable.system.type === "stamina")
      await applyStat("stamina", "Stamina");
    if (consumable.system.type === "mana") await applyStat("mana", "Mana");

    if (consumable.system.bleed) {
      const bleedRoll = await new Roll("1d100").evaluate();
      // System-wide percentage convention: a chance of N succeeds on 1..N
      // (see resolveBleedStacks in applyDamage.mjs), so 100% is guaranteed.
      const success = bleedRoll.total <= consumable.system.bleed;
      let result = "";

      if (success) {
        // Same rule as First Aid / the Stop Bleeding action: a success clears
        // every Bleeding effect, it does not peel off a single stack.
        const removed = await clearBleedEffects(actor);
        result = removed ? "SUCCESS" : "SUCCESS (no bleeding)";
      }

      effectResults += `<p><b>Stop bleed:</b> ${bleedRoll.total} / ${consumable.system.bleed}% ${result}</p>`;
    }

    // Apply any buff Active Effects authored on the potion (must run before the
    // item is consumed/deleted below).
    effectResults += await applyItemBuffsToActor(actor, consumable);

    if (consumable.system.quantity > 0) {
      const newQty = consumable.system.quantity - 1;
      newQty > 0
        ? await consumable.update({ "system.quantity": newQty })
        : await consumable.delete();
    }

    return effectResults;
  };

  const handlePotionSelection = async (consumable) => {
    const rollData = actor.getRollData();
    const roll = await new Roll(consumable.system.formula, rollData).evaluate();
    const drinkingRoll = await new Roll(
      "@skills.drinking.rating - 1d100",
      rollData,
    ).evaluate();

    const effectResults = await applyConsumableEffects(
      consumable,
      roll,
      drinkingRoll,
    );

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker(),
      rolls: [roll, drinkingRoll],
      flavor: `
    <span style="display:inline-flex; align-items:center;">
      <img src="${consumable.img}" title="${consumable.localizedName ?? consumable.name}" width="36" height="36" style="margin-right:8px;">
      <strong style="font-size:20px;">Drinking ${consumable.localizedName ?? consumable.name}</strong>
    </span>
        <table style="width: 100%; text-align: center; font-size: 15px;">
          <tr><th>Potion Effects</th></tr>
          <tr><td><b>${effectResults}</b></td></tr>
        </table>
      `,
    });
  };

  const css = `
    #potion-list .potion-choice {
      font-size: 16px;
      color: #c8bea8;
    }
    #potion-list .potion-choice:hover {
      color: #d7c697;
      text-shadow: 1px 1px 0 #000;
    }
    .potion-dialog .window-content {
      max-width: 300px;
      width: 100%;
    }
  `;
  const style = document.createElement("style");
  style.type = "text/css";
  style.innerText = css;
  document.head.appendChild(style);

  const renderPotionDialog = () => {
    const potions = actor.items.filter(
      (i) => i.type === "consumable" && i.system.option === "potion",
    );
    const poisons = actor.items.filter(
      (i) => i.type === "consumable" && i.system.option === "poison",
    );

    if (!potions.length && !poisons.length) {
      ui.notifications.warn("No potions or poisons left.");
      return;
    }

    const listItems = (items, kind) =>
      items
        .map(
          (c, i) => `
            <li class="potion-choice" data-kind="${kind}" data-value="${i}" style="cursor: pointer; padding: 5px; border-bottom: 1px solid #444;">
              ${c.localizedName ?? c.name} (${c.system.quantity ?? 1})
            </li>`,
        )
        .join("");

    const section = (label, items, kind) =>
      items.length
        ? `<li class="potion-section" style="list-style:none; padding:5px 0 2px; font-weight:bold; opacity:.8;">${label}</li>${listItems(items, kind)}`
        : "";

    let dialog;

    dialog = new Dialog({
      title: "Use Potion / Poison",
      content: `
      <form>
        <ul id="potion-list" style="list-style: none; padding: 0;">
          ${section("Potions", potions, "potion")}
          ${section("Poisons", poisons, "poison")}
        </ul>
      </form>
    `,
      classes: ["potion-dialog"],
      buttons: {},
      render: function (html) {
        html.find("#potion-list li.potion-choice").click(async (event) => {
          const { kind, value } = event.currentTarget.dataset;
          const index = parseInt(value);

          dialog.close();

          if (kind === "poison") {
            // Poisons coat a weapon (their own follow-up dialog opens).
            applyPoisonToWeapon(actor, poisons[index]);
            return;
          }

          await handlePotionSelection(potions[index]);

          renderPotionDialog();
        });
      },
    });

    dialog.render(true);
  };

  renderPotionDialog();
}
