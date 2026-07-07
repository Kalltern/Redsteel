/**
 * Alchemy crafting.
 *
 * A `recipe` item names the consumable it produces (`system.resultUuid`), the
 * six-substance costs per crafted unit, an optional special ingredient (one
 * whole unit consumed per craft ACTION, no matter the batch size — Dragon root
 * style), and an alchemical base (1 base use per crafted unit).
 *
 * Crafting rolls the Alchemy skill exactly like other margin tests
 * (`rating - 1d100` with roll-advantage bias), modified by the alchemical
 * station in use. Ingredients are consumed whether the roll succeeds or not;
 * only a success delivers the potions into the crafter's inventory.
 *
 * The Alchemist specialisation tree will later feed the roll through
 * {@link getAlchemistCraftModifiers} — the single extension point for
 * duplication / advantage / guaranteed-success nodes.
 */

import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";

/**
 * The six alchemical substances. Owned stocks are identified by
 * `flags.redsteel.alchSubstance` (set on the compendium items) with a
 * case-insensitive name fallback for copies created before the flag existed.
 * Colors are muted accents for the substance strip on the Alchemy tab.
 */
export const SUBSTANCES = [
  { key: "yliaster",    name: "Yliaster",    code: "Yl", icon: "systems/redsteel/assets/icons/Yliaster.png",    color: "#c9a227" },
  { key: "bezoardicum", name: "Bezoardicum", code: "Be", icon: "systems/redsteel/assets/icons/Bezoardicum.png", color: "#7a5c3e" },
  { key: "alkahest",    name: "Alkahest",    code: "Al", icon: "systems/redsteel/assets/icons/Alkahest.png",    color: "#6e8fa3" },
  { key: "qudat",       name: "Qudat",       code: "Qu", icon: "systems/redsteel/assets/icons/Qudat.png",       color: "#7b5e8f" },
  { key: "panacea",     name: "Panacea",     code: "Pa", icon: "systems/redsteel/assets/icons/Panacea.png",     color: "#6f8f5e" },
  { key: "verdigris",   name: "Verdigris",   code: "Ve", icon: "systems/redsteel/assets/icons/Verdigris.png",   color: "#4e8f7e" },
];

/**
 * Alchemical bases. One crafted unit consumes one base use; a base item unit
 * holds `usesPerUnit` uses (partially-spent units tracked via
 * `flags.redsteel.baseUsesSpent` on the owned stack).
 * strongAlcohol/distillate uses are placeholders — tune when the rules settle.
 * `names` lists accepted item names (flag `flags.redsteel.alchBase` wins).
 */
export const BASES = {
  fat: {
    usesPerUnit: 3,
    labelKey: "REDSTEEL.Alchemy.Base.Fat",
    names: ["fat", "tuk"],
  },
  alcohol: {
    usesPerUnit: 5,
    labelKey: "REDSTEEL.Alchemy.Base.Alcohol",
    names: ["alcohol", "alkohol"],
  },
  strongAlcohol: {
    usesPerUnit: 5,
    labelKey: "REDSTEEL.Alchemy.Base.StrongAlcohol",
    names: ["strong alcohol", "silný alkohol", "silny alkohol"],
  },
  distillate: {
    usesPerUnit: 5,
    labelKey: "REDSTEEL.Alchemy.Base.Distillate",
    names: ["distillate", "destilát", "destilat"],
  },
};

/** Alchemical stations and their flat roll modifiers (to be tuned later). */
export const STATIONS = [
  { key: "cauldron", mod: -10, labelKey: "REDSTEEL.Alchemy.Station.Cauldron" },
  { key: "foldable", mod: 0,   labelKey: "REDSTEEL.Alchemy.Station.Foldable" },
  { key: "lab",      mod: 15,  labelKey: "REDSTEEL.Alchemy.Station.Lab" },
];

/** Max units per craft action, by recipe output type. */
export const MAX_BATCH = { potion: 5, ointment: 3 };

/* -------------------------------------------- */
/*  Ingredient lookup                            */
/* -------------------------------------------- */

const norm = (s) => String(s ?? "").trim().toLowerCase();

/** Owned stacks of one substance (flag first, name fallback). */
export function findSubstanceItems(actor, key) {
  const def = SUBSTANCES.find((s) => s.key === key);
  if (!def) return [];
  return actor.items.filter(
    (i) =>
      i.type === "item" &&
      (i.getFlag("redsteel", "alchSubstance") === key ||
        norm(i.name) === norm(def.name)),
  );
}

/** Total owned quantity of one substance. */
export function getSubstanceCount(actor, key) {
  return findSubstanceItems(actor, key).reduce(
    (sum, i) => sum + (Number(i.system.quantity) || 0),
    0,
  );
}

/** Owned stacks of one alchemical base (flag first, name fallback). */
export function findBaseItems(actor, baseKey) {
  const def = BASES[baseKey];
  if (!def) return [];
  return actor.items.filter(
    (i) =>
      i.type === "item" &&
      (i.getFlag("redsteel", "alchBase") === baseKey ||
        def.names.includes(norm(i.name))),
  );
}

/** Total remaining base uses across all owned stacks of one base. */
export function getBaseUses(actor, baseKey) {
  const def = BASES[baseKey];
  if (!def) return 0;
  return findBaseItems(actor, baseKey).reduce((sum, i) => {
    const qty = Number(i.system.quantity) || 0;
    const spent = Number(i.getFlag("redsteel", "baseUsesSpent")) || 0;
    return sum + Math.max(0, qty * def.usesPerUnit - spent);
  }, 0);
}

/** Owned special-ingredient stack matched by name (case-insensitive). */
export function findSpecialIngredient(actor, name) {
  if (!norm(name)) return null;
  return (
    actor.items.find(
      (i) => norm(i.name) === norm(name) && "quantity" in (i.system ?? {}),
    ) ?? null
  );
}

/* -------------------------------------------- */
/*  Specialisation extension point               */
/* -------------------------------------------- */

/**
 * Craft modifiers granted by the Alchemist specialisation tree.
 * Placeholder: always zero for now. Later reads
 * `actor.system.specialisations.alchemist.nodes` (lekVyhoda → advantage,
 * lekDuplikace* → extraDuplicates, garantovanyUspech, sleva*, …) keyed by the
 * recipe's output type.
 */
export function getAlchemistCraftModifiers(actor, recipe) {
  return { rollBonus: 0, extraDuplicates: 0, advantage: 0 };
}

/* -------------------------------------------- */
/*  Requirements                                 */
/* -------------------------------------------- */

/**
 * Check that a craft of `amount` units is possible with the actor's stocks.
 * @returns {{ok: boolean, reason?: string, missing?: {label:string, need:number, have:number}[]}}
 */
export function checkCraftRequirements(actor, recipe, amount) {
  const sys = recipe.system;
  const outputType = sys.outputType || "potion";
  const maxBatch = MAX_BATCH[outputType] ?? 5;

  if (!sys.resultUuid) {
    return { ok: false, reason: game.i18n.localize("REDSTEEL.Alchemy.Warn.NoResult") };
  }
  if (!(amount >= 1 && amount <= maxBatch)) {
    return {
      ok: false,
      reason: game.i18n.format("REDSTEEL.Alchemy.Warn.BadAmount", { max: maxBatch }),
    };
  }

  const missing = [];
  for (const def of SUBSTANCES) {
    const need = (Number(sys.substances?.[def.key]) || 0) * amount;
    if (need <= 0) continue;
    const have = getSubstanceCount(actor, def.key);
    if (have < need) missing.push({ label: def.name, need, have });
  }

  const baseKey = sys.base && sys.base !== "none" ? sys.base : null;
  if (baseKey) {
    const have = getBaseUses(actor, baseKey);
    if (have < amount) {
      missing.push({
        label: game.i18n.localize(BASES[baseKey]?.labelKey ?? baseKey),
        need: amount,
        have,
      });
    }
  }

  const specialName = sys.specialIngredient?.name?.trim();
  if (specialName) {
    const special = findSpecialIngredient(actor, specialName);
    const have = Number(special?.system?.quantity) || 0;
    if (have < 1) missing.push({ label: specialName, need: 1, have });
  }

  if (missing.length) {
    const list = missing
      .map((m) => `${m.label} (${m.have}/${m.need})`)
      .join(", ");
    return {
      ok: false,
      missing,
      reason: `${game.i18n.localize("REDSTEEL.Alchemy.Warn.NotEnough")}: ${list}`,
    };
  }
  return { ok: true };
}

/* -------------------------------------------- */
/*  Consumption / production                     */
/* -------------------------------------------- */

/** Deduct `amount` from a list of stacks, deleting emptied ones. */
async function consumeFromStacks(stacks, amount) {
  let left = amount;
  for (const item of stacks) {
    if (left <= 0) break;
    const qty = Number(item.system.quantity) || 0;
    const take = Math.min(qty, left);
    left -= take;
    if (qty - take <= 0) await item.delete();
    else await item.update({ "system.quantity": qty - take });
  }
}

/** Spend `uses` base uses, tracking partial units via baseUsesSpent. */
async function consumeBaseUses(actor, baseKey, uses) {
  const def = BASES[baseKey];
  if (!def) return;
  let left = uses;
  for (const item of findBaseItems(actor, baseKey)) {
    if (left <= 0) break;
    let qty = Number(item.system.quantity) || 0;
    let spent = Number(item.getFlag("redsteel", "baseUsesSpent")) || 0;
    const available = Math.max(0, qty * def.usesPerUnit - spent);
    const take = Math.min(available, left);
    left -= take;
    spent += take;
    // Convert fully-spent uses into consumed units.
    const unitsGone = Math.floor(spent / def.usesPerUnit);
    qty -= unitsGone;
    spent -= unitsGone * def.usesPerUnit;
    if (qty <= 0) await item.delete();
    else
      await item.update({
        "system.quantity": qty,
        "flags.redsteel.baseUsesSpent": spent,
      });
  }
}

/**
 * Consume everything a craft action costs. Call only after
 * {@link checkCraftRequirements} returned ok.
 * @returns {Promise<string[]>} human-readable summary lines of what was spent.
 */
async function consumeIngredients(actor, recipe, amount) {
  const sys = recipe.system;
  const spent = [];

  for (const def of SUBSTANCES) {
    const need = (Number(sys.substances?.[def.key]) || 0) * amount;
    if (need <= 0) continue;
    await consumeFromStacks(findSubstanceItems(actor, def.key), need);
    spent.push(`${need}× ${def.name}`);
  }

  const baseKey = sys.base && sys.base !== "none" ? sys.base : null;
  if (baseKey) {
    await consumeBaseUses(actor, baseKey, amount);
    spent.push(
      `${amount}× ${game.i18n.localize(BASES[baseKey]?.labelKey ?? baseKey)} (${game.i18n.localize("REDSTEEL.Alchemy.Chat.Uses")})`,
    );
  }

  const specialName = sys.specialIngredient?.name?.trim();
  if (specialName) {
    const special = findSpecialIngredient(actor, specialName);
    if (special) await consumeFromStacks([special], 1);
    spent.push(`1× ${specialName}`);
  }

  return spent;
}

/** Add `amount` copies of the recipe's result item to the actor's inventory. */
async function deliverResult(actor, recipe, amount) {
  const source = await fromUuid(recipe.system.resultUuid);
  if (!source) {
    ui.notifications.error(
      game.i18n.localize("REDSTEEL.Alchemy.Warn.ResultMissing"),
    );
    return null;
  }
  const existing = actor.items.find(
    (i) => i.type === source.type && i.name === source.name,
  );
  if (existing) {
    await existing.update({
      "system.quantity": (Number(existing.system.quantity) || 0) + amount,
    });
    return existing;
  }
  const data = source.toObject();
  delete data._id;
  foundry.utils.setProperty(data, "system.quantity", amount);
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

/* -------------------------------------------- */
/*  The craft roll                               */
/* -------------------------------------------- */

/**
 * Roll the Alchemy test for a craft attempt.
 *
 * Formula mirrors the system-wide margin roll used for spells
 * (`rating + difficulty + bonus - 1d100`): every term is a signed modifier
 * added to the rating, so a negative `difficulty` on the result item makes the
 * craft harder and a negative station mod (cauldron) subtracts as well.
 *
 * @param {Actor}  actor
 * @param {string} stationKey
 * @param {object} mods         From getAlchemistCraftModifiers.
 * @param {number} difficulty   The result item's signed craft difficulty.
 */
async function rollAlchemyTest(actor, stationKey, mods, difficulty = 0) {
  const skill = actor.system.skills?.alchemy ?? {};
  const rating = Number(skill.rating) || 0;
  const stationMod = STATIONS.find((s) => s.key === stationKey)?.mod ?? 0;
  const critSucc = Number(skill.criticalSuccessThreshold ?? 0);
  const critFail = Number(skill.criticalFailureThreshold ?? 101);

  const total =
    rating + stationMod + (Number(mods?.rollBonus) || 0) + (Number(difficulty) || 0);
  const roll = new Roll(`${total} - 1d100`, withRollBias({}, actor));
  tagRollSkill(roll, "alchemy");
  await roll.evaluate();
  const d100 = roll.dice?.[0]?.total ?? total - roll.total;

  return {
    d100,
    margin: roll.total,
    critSuccess: d100 <= critSucc,
    critFailure: d100 >= critFail,
    success: roll.total >= 0 && !(d100 >= critFail),
  };
}

const fmtMargin = (m) => (m >= 0 ? `+${m}` : `${m}`);

/** Build and send the public craft chat card. NEVER attach a rolls array —
 *  the global chat hook would bolt a generic reroll button onto any d100
 *  roll and desync it from craft resolution. */
async function sendCraftMessage(actor, recipe, outcome, spentLines, { isReroll = false } = {}) {
  const i18n = game.i18n;
  const station = STATIONS.find((s) => s.key === outcome.stationKey);
  const stationName = i18n.localize(station?.labelKey ?? outcome.stationKey);
  const critTxt = outcome.critSuccess
    ? ` · ${i18n.localize("REDSTEEL.Alchemy.Chat.CritSuccess")}`
    : outcome.critFailure
      ? ` · ${i18n.localize("REDSTEEL.Alchemy.Chat.CritFailure")}`
      : "";

  const rerollTag = isReroll
    ? `<p style="text-align:center;font-size:12px;opacity:0.8;"><i class="fa-light fa-rotate"></i> ${i18n.localize("REDSTEEL.Alchemy.Chat.Reroll")}</p>`
    : "";

  const resultLine = outcome.success
    ? `<p style="text-align:center;font-size:16px;"><b>${i18n.localize("REDSTEEL.Alchemy.Chat.Success")}</b> — ${i18n.format(
        "REDSTEEL.Alchemy.Chat.Created",
        { count: outcome.amount, name: outcome.resultName },
      )}</p>`
    : `<p style="text-align:center;font-size:16px;"><b>${i18n.localize("REDSTEEL.Alchemy.Chat.Failure")}</b> — ${i18n.localize("REDSTEEL.Alchemy.Chat.IngredientsWasted")}</p>`;

  const spentBlock = spentLines?.length
    ? `<p style="font-size:12px;opacity:0.85;"><b>${i18n.localize("REDSTEEL.Alchemy.Chat.Consumed")}:</b> ${spentLines.join(", ")}</p>`
    : "";

  const difficulty = Number(outcome.difficulty) || 0;
  const difficultyNote = difficulty
    ? ` · ${i18n.localize("REDSTEEL.Alchemy.Chat.Difficulty")} ${fmtMargin(difficulty)}`
    : "";

  const content = `
    <div class="rs-alchemy-card">
      <p style="text-align:center;font-size:18px;"><b><i class="fa-light fa-flask"></i> ${i18n.localize("REDSTEEL.Alchemy.Chat.Title")} — ${recipe.localizedName ?? recipe.name}</b></p>
      ${rerollTag}
      <p style="text-align:center;font-size:12px;opacity:0.8;">${i18n.localize("REDSTEEL.Alchemy.Chat.UsedStation")}: ${stationName}${difficultyNote}</p>
      <p style="text-align:center;">d100: <b>${outcome.d100}</b> → ${i18n.localize("REDSTEEL.Alchemy.Chat.Margin")} <b>${fmtMargin(outcome.margin)}</b><span style="font-size:12px;opacity:0.8;">${critTxt}</span></p>
      ${resultLine}
      ${spentBlock}
    </div>`;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
}

/* -------------------------------------------- */
/*  Public crafting API                          */
/* -------------------------------------------- */

/**
 * Perform one craft action: verify stocks, roll, consume ingredients (always),
 * deliver potions on success, announce in chat.
 *
 * @param {Actor}  actor
 * @param {Item}   recipe                    The recipe item (type "recipe").
 * @param {object} options
 * @param {number} options.amount            Units to craft (1..MAX_BATCH).
 * @param {string} options.stationKey        STATIONS key in use.
 * @returns {Promise<object>} outcome — { ok, success, d100, margin, ... }
 */
export async function craftRecipe(actor, recipe, { amount, stationKey }) {
  amount = Math.floor(Number(amount) || 0);
  const check = checkCraftRequirements(actor, recipe, amount);
  if (!check.ok) return { ok: false, reason: check.reason };

  const source = await fromUuid(recipe.system.resultUuid);
  if (!source) {
    return {
      ok: false,
      reason: game.i18n.localize("REDSTEEL.Alchemy.Warn.ResultMissing"),
    };
  }

  const mods = getAlchemistCraftModifiers(actor, recipe);
  const difficulty = Number(source.system?.difficulty) || 0;
  const test = await rollAlchemyTest(actor, stationKey, mods, difficulty);

  // Grimdark: the cauldron doesn't refund failure.
  const spentLines = await consumeIngredients(actor, recipe, amount);

  const outcome = {
    ok: true,
    ...test,
    amount,
    stationKey,
    difficulty,
    recipeId: recipe.id,
    recipeName: recipe.localizedName ?? recipe.name,
    resultName: source.localizedName ?? source.name,
    created: 0,
  };

  if (test.success) {
    await deliverResult(actor, recipe, amount);
    outcome.created = amount;
  }

  await sendCraftMessage(actor, recipe, outcome, spentLines);
  return outcome;
}

/**
 * Re-roll a FAILED craft's Alchemy test. Ingredients are NOT consumed again;
 * a new success delivers the originally attempted amount. The caller is
 * responsible for spending the reroll charge before calling this.
 */
export async function rerollCraft(actor, recipe, lastOutcome, { stationKey }) {
  const mods = getAlchemistCraftModifiers(actor, recipe);
  const source = await fromUuid(recipe.system.resultUuid);
  const difficulty = Number(source?.system?.difficulty) || 0;
  const test = await rollAlchemyTest(actor, stationKey, mods, difficulty);

  const outcome = {
    ok: true,
    ...test,
    amount: lastOutcome.amount,
    stationKey,
    difficulty,
    recipeId: recipe.id,
    recipeName: recipe.localizedName ?? recipe.name,
    resultName: source?.localizedName ?? source?.name ?? lastOutcome.resultName,
    created: 0,
  };

  if (test.success) {
    await deliverResult(actor, recipe, lastOutcome.amount);
    outcome.created = lastOutcome.amount;
  }

  await sendCraftMessage(actor, recipe, outcome, null, { isReroll: true });
  return outcome;
}
