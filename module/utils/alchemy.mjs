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
 * The Alchemist specialisation tree feeds the roll through
 * {@link getAlchemistCraftModifiers} (per output-type family) and
 * {@link getAlchemistSubstanceModifiers} (herb boiling). Automated so far:
 *  - the craft roll — advantage, critical-failure relief, duplication,
 *    guaranteed success, the ingredient discount;
 *  - the crafted potion's numbers — toxicity, healing dice, stop-bleed chance,
 *    baked in by {@link applyProductBoons}.
 * Still table rulings, and why: every `Trvani` node (duration exists only as
 * prose in the description), the poison/oil damage nodes (those items carry no
 * numbers yet), drug addictiveness (no drug items), the `kombinace` nodes (a
 * second crafting mode, not a modifier) and the mutation nodes (no system).
 */

import { withRollBias, tagRollSkill } from "./rollAdvantage.mjs";
import { actorHasSpecNode } from "../helpers/specialisations.mjs";

/**
 * The six alchemical substances. Owned stocks are identified by
 * `flags.redsteel.alchSubstance` (set on the compendium items) with a
 * case-insensitive name fallback for copies created before the flag existed.
 * Colors are the accent for the substance strip on the Alchemy tab and must
 * match the vial artwork in assets/icons — the tile reads as the potion.
 */
export const SUBSTANCES = [
  { key: "yliaster",    name: "Yliaster",    code: "Yl", icon: "systems/redsteel/assets/icons/Yliaster.png",    color: "#2f6cf0" },
  { key: "bezoardicum", name: "Bezoardicum", code: "Be", icon: "systems/redsteel/assets/icons/Bezoardicum.png", color: "#2fc4bb" },
  { key: "alkahest",    name: "Alkahest",    code: "Al", icon: "systems/redsteel/assets/icons/Alkahest.png",    color: "#a04ee0" },
  { key: "qudat",       name: "Qudat",       code: "Qu", icon: "systems/redsteel/assets/icons/Qudat.png",       color: "#e02b2b" },
  { key: "panacea",     name: "Panacea",     code: "Pa", icon: "systems/redsteel/assets/icons/Panacea.png",     color: "#f0c40f" },
  { key: "verdigris",   name: "Verdigris",   code: "Ve", icon: "systems/redsteel/assets/icons/Verdigris.png",   color: "#33bf33" },
];

/**
 * What a recipe is for, and the colour that stands for it on the recipe cards.
 * Purpose is authored per recipe (`system.purpose`): nothing in the substance
 * cost implies it, since most recipes mix two or three of them. An untagged
 * recipe keeps the default gold border.
 *
 * Five purposes borrow their tint from the substance that defines them, so the
 * cards and the substance strip can never drift apart. Explosives answer to no
 * substance and carry their own orange.
 */
export const RECIPE_PURPOSES = [
  { key: "poison",    labelKey: "REDSTEEL.Alchemy.Purpose.Poison",    substance: "verdigris" },
  { key: "mana",      labelKey: "REDSTEEL.Alchemy.Purpose.Mana",      substance: "yliaster" },
  { key: "healing",   labelKey: "REDSTEEL.Alchemy.Purpose.Healing",   substance: "qudat" },
  { key: "buff",      labelKey: "REDSTEEL.Alchemy.Purpose.Buff",      substance: "panacea" },
  { key: "unique",    labelKey: "REDSTEEL.Alchemy.Purpose.Unique",    substance: "alkahest" },
  { key: "explosive", labelKey: "REDSTEEL.Alchemy.Purpose.Explosive", color: "#ef7d1a" },
];

/**
 * Accent colour for a recipe purpose, or null when the recipe carries none.
 * @param {string} purpose
 * @returns {string|null}
 */
export function getPurposeColor(purpose) {
  const def = RECIPE_PURPOSES.find((p) => p.key === purpose);
  if (!def) return null;
  if (def.color) return def.color;
  return SUBSTANCES.find((s) => s.key === def.substance)?.color ?? null;
}

/**
 * Alchemical bases. One crafted unit consumes one base use; a base item unit
 * holds `usesPerUnit` uses (partially-spent units tracked via
 * `flags.redsteel.baseUsesSpent` on the owned stack).
 * strongAlcohol/distillate uses are placeholders — tune when the rules settle.
 * `names` lists accepted item names (flag `flags.redsteel.alchBase` wins).
 * Plain alcohol is deliberately absent: no recipe brews on it, only on the
 * strong variant.
 */
export const BASES = {
  fat: {
    usesPerUnit: 3,
    labelKey: "REDSTEEL.Alchemy.Base.Fat",
    icon: "icons/commodities/materials/slime-white.webp",
    names: ["fat", "tuk"],
  },
  strongAlcohol: {
    usesPerUnit: 5,
    labelKey: "REDSTEEL.Alchemy.Base.StrongAlcohol",
    icon: "icons/consumables/drinks/alcohol-spirits-bottle-green.webp",
    names: ["strong alcohol", "silný alkohol", "silny alkohol"],
  },
  distillate: {
    usesPerUnit: 5,
    labelKey: "REDSTEEL.Alchemy.Base.Distillate",
    icon: "icons/consumables/drinks/alcohol-jar-spirits-gray.webp",
    names: ["distillate", "destilát", "destilat"],
  },
};

/**
 * Vessels the product is made in. Unlike a base, a vessel has no "uses": one
 * whole unit is consumed per crafted unit and the empty is gone. Owned stock
 * is identified by `flags.redsteel.alchVessel`, with a name fallback for
 * hand-made copies.
 */
export const VESSELS = {
  vial: {
    labelKey: "REDSTEEL.Alchemy.Vessel.Vial",
    icon: "icons/tools/laboratory/vials-blue-pink.webp",
    names: ["vial", "vials", "flakónek", "flakonek", "lahvička", "lahvicka"],
    // Only used by deliverVessel's fallback, when the pack item is missing.
    fallbackName: "Vial",
    localizationKey: "REDSTEEL.Items.Vial.name",
  },
  container: {
    labelKey: "REDSTEEL.Alchemy.Vessel.Container",
    icon: "icons/containers/kitchenware/jug-wrapped-red.webp",
    names: ["container", "nádoba", "nadoba", "nádobka", "nadobka"],
    fallbackName: "Container",
    localizationKey: "REDSTEEL.Items.Container.name",
  },
};

/**
 * Which vessel each output type needs, one per crafted unit. Ointments, oils
 * and drugs have none: their base (fat) is also what they are stored in.
 */
export const OUTPUT_VESSEL = {
  potion: "vial",
  poison: "vial",
  explosive: "container",
};

/** Alchemical stations and their flat roll modifiers (to be tuned later). */
export const STATIONS = [
  { key: "cauldron", mod: -10, labelKey: "REDSTEEL.Alchemy.Station.Cauldron" },
  { key: "foldable", mod: 0,   labelKey: "REDSTEEL.Alchemy.Station.Foldable" },
  { key: "lab",      mod: 15,  labelKey: "REDSTEEL.Alchemy.Station.Lab" },
];

/** Max units per craft action, by recipe output type. */
export const MAX_BATCH = {
  potion: 5,
  ointment: 3,
  poison: 5,
  oil: 5,
  explosive: 5,
  drug: 5,
};

/**
 * Alchemist specialisation node families, one per recipe output type.
 *
 * Each family owns four craft-relevant nodes: three Duplikace steps (a percent
 * chance of a bonus unit), Vyhoda (advantage on the craft roll) and
 * KritNeuspech (critical failure 3% less likely, gated behind Vyhoda). Every
 * other node in the tree changes the finished product, not the crafting, and
 * stays a table ruling.
 */
export const ALCHEMIST_FAMILIES = {
  potion: {
    node: "lek",
    duplication: [10, 5, 10],
    // Nodes that change the produced potion's stored numbers, applied to the
    // crafted copy by applyProductBoons. Only the potion family has these:
    // poisons, oils and salves are still prose-only items with no numbers to
    // move, and duration lives nowhere but the description text.
    product: {
      toxicity: [["lekToxicita", -2]],
      healingDice: [["lecZivoty1", 1], ["lecZivoty2", 1]],
      bleed: [["lecZastaveni1", 25], ["lecZastaveni2", 25]],
    },
  },
  ointment:  { node: "mast",  duplication: [10, 5, 10] },
  poison:    { node: "jed",   duplication: [10, 5, 10] },
  oil:       { node: "olej",  duplication: [10, 5, 10] },
  explosive: {
    node: "pet",
    duplication: [10, 5, 10],
    // Unlike the potion nodes, this one names a single explosive: only the
    // Cracker gains the dice (see PRODUCT_BOON_ITEMS).
    product: { damageDice: [["traskavice", 4]] },
  },
  drug:      { node: "droga", duplication: [10, 10, 10] },
};

/**
 * Product boons that belong to one specific item rather than a whole family,
 * by the item's `system.localizationKey` — that survives renames and is the
 * same in every language, unlike the item's name.
 */
const PRODUCT_BOON_ITEMS = {
  damageDice: "REDSTEEL.Items.Cracker.name",
};

/** Whether a product boon may land on this item at all. */
function productTakesBoon(stat, product) {
  const required = PRODUCT_BOON_ITEMS[stat];
  if (!required) return true;
  // Without product data (the generic panel listing) assume it may apply.
  if (!product) return true;
  return product.localizationKey === required;
}

/** Critical-failure threshold relief granted by a `{fam}KritNeuspech` node. */
const CRIT_FAILURE_RELIEF = 3;

/**
 * Boiling herbs down into a substance (rules: "Alchemie" sheet).
 * Five ingredients carrying the substance make one dose, the recipe itself is
 * an easy one, and any number of doses may be boiled in one pot — resolved by
 * a single roll, at the standard mass-production penalty.
 */
export const SUBSTANCE_HERB_COST = 5;
/** Signed craft modifiers, same convention as a recipe's system.difficulty. */
export const SUBSTANCE_CRAFT_MOD = -10;
export const SUBSTANCE_BATCH_MOD = -10;
/** Sanity cap on one brew action, so a stray keystroke can't eat the pack. */
export const SUBSTANCE_MAX_BATCH = 20;

/** Pack the substance stock items are pulled from when the actor has none. */
const ITEM_PACK_ID = "redsteel.redsteel-items";

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

/**
 * Owned herb stacks that yield one substance. Gathered herbs carry
 * `flags.redsteel.substance` holding the substance's display name (see
 * gatherHerbs.mjs); the key is accepted too for hand-made items. Finished
 * substances are excluded — they carry `alchSubstance`, never `substance`.
 */
export function findHerbItems(actor, key) {
  const def = SUBSTANCES.find((s) => s.key === key);
  if (!def) return [];
  return actor.items.filter((i) => {
    if (i.getFlag("redsteel", "alchSubstance")) return false;
    const flag = norm(i.getFlag("redsteel", "substance"));
    return flag && (flag === norm(def.name) || flag === norm(def.key));
  });
}

/** Total owned herbs yielding one substance. */
export function getHerbCount(actor, key) {
  return findHerbItems(actor, key).reduce(
    (sum, i) => sum + (Number(i.system.quantity) || 0),
    0,
  );
}

/** Doses of one substance the actor's herbs could currently make. */
export function getMaxSubstanceBatch(actor, key, herbCost = SUBSTANCE_HERB_COST) {
  return Math.min(
    SUBSTANCE_MAX_BATCH,
    Math.floor(getHerbCount(actor, key) / Math.max(1, herbCost)),
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

/** Owned stacks of one vessel (flag first, name fallback). */
export function findVesselItems(actor, vesselKey) {
  const def = VESSELS[vesselKey];
  if (!def) return [];
  return actor.items.filter(
    (i) =>
      i.type === "item" &&
      (i.getFlag("redsteel", "alchVessel") === vesselKey ||
        def.names.includes(norm(i.name))),
  );
}

/** Total owned units of one vessel. */
export function getVesselCount(actor, vesselKey) {
  return findVesselItems(actor, vesselKey).reduce(
    (sum, i) => sum + (Number(i.system.quantity) || 0),
    0,
  );
}

/** The vessel key a recipe's output needs, or null. */
export function getRecipeVessel(recipe) {
  return OUTPUT_VESSEL[recipe?.system?.outputType || "potion"] ?? null;
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
 * Craft modifiers granted by the Alchemist specialisation tree, for the family
 * matching this recipe's output type.
 *
 * @returns {{rollBonus: number, advantage: number, critFailureRelief: number,
 *            duplication: number, family: string}}
 *   duplication is a percent chance, rolled once per crafted unit.
 */
export function getAlchemistCraftModifiers(actor, recipe) {
  const outputType = recipe?.system?.outputType || "potion";
  const fam = ALCHEMIST_FAMILIES[outputType] ?? ALCHEMIST_FAMILIES.potion;
  const has = (node) => actorHasSpecNode(actor, "alchemist", node);

  const duplication = fam.duplication.reduce(
    (sum, pct, i) => (has(`${fam.node}Duplikace${i + 1}`) ? sum + pct : sum),
    0,
  );

  // Sum each product stat over the nodes the actor actually owns.
  const product = {};
  for (const [stat, entries] of Object.entries(fam.product ?? {})) {
    const total = entries.reduce(
      (sum, [node, value]) => (has(node) ? sum + value : sum),
      0,
    );
    if (total) product[stat] = total;
  }

  return {
    rollBonus: 0,
    advantage: has(`${fam.node}Vyhoda`) ? 1 : 0,
    critFailureRelief: has(`${fam.node}KritNeuspech`) ? CRIT_FAILURE_RELIEF : 0,
    duplication,
    product,
    family: fam.node,
  };
}

/* -------------------------------------------- */
/*  Product boons                                */
/* -------------------------------------------- */

/**
 * Stable identity for a set of product boons, used to keep master-crafted
 * output out of a plain stack of the same potion. Null when nothing was
 * changed, which is exactly what an unboosted stack carries.
 * @returns {string|null}
 */
export function productSignature(product) {
  const parts = Object.entries(product ?? {})
    .filter(([, v]) => Number(v))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}${v > 0 ? "+" : ""}${v}`);
  return parts.length ? parts.join("|") : null;
}

/**
 * Apply the Alchemist product boons to a crafted item's data, in place.
 *
 * Deliberately conservative about which items each boon may touch:
 *  - toxicity only drops on potions that HAVE a toxicity cost. Items with a
 *    negative value (Calendula Alba) are cures, not costs, and are left alone.
 *  - healing dice only land on `type: "health"` potions. Every one of those is
 *    Nd6 today, so the die count grows; a different die size gets the d6s
 *    appended to the flat bonus instead, so the node never silently turns into
 *    "+1d8".
 *  - the stop-bleed bonus lands on every `type: "health"` potion, including
 *    ones that never stopped bleeding before (Scarlet tear goes from 0 to a
 *    real chance), and never past 100%.
 *
 * `applied` holds only the boons that actually changed something on THIS item,
 * which is what the stack signature is built from: a mana potion that only
 * took the toxicity drop must stack with another identical mana potion, even
 * if the crafter also owns the healing and bleed nodes.
 *
 * @param {object} data     An item's toObject() data, mutated in place.
 * @param {object} product  From getAlchemistCraftModifiers().product.
 * @returns {{notes: string[], applied: object}}
 */
export function applyProductBoons(data, product) {
  const notes = [];
  const applied = {};
  const sys = data?.system;
  if (!sys || !product) return { notes, applied };
  const i18n = game.i18n;
  const set = (path, value) => foundry.utils.setProperty(data, path, value);

  // Add Nd6 to a roll that is already d6-based; anything else takes the dice
  // as a bonus term so a node can never silently change the die size.
  const addD6 = (path, roll, dice) => {
    if (String(roll?.diceSize) === "6") {
      set(`${path}.diceNum`, (Number(roll.diceNum) || 0) + dice);
    } else {
      const bonus = String(roll?.diceBonus ?? "").trim();
      set(`${path}.diceBonus`, `${bonus ? `${bonus} + ` : ""}${dice}d6`);
    }
  };

  // The Cracker's damage node — the one product boon outside the potions.
  const damage = Number(product.damageDice) || 0;
  if (
    damage > 0 &&
    sys.option === "explosive" &&
    productTakesBoon("damageDice", productBoonTarget(data))
  ) {
    addD6("system.roll", sys.roll ?? {}, damage);
    applied.damageDice = damage;
    notes.push(
      i18n.format("REDSTEEL.Alchemy.Chat.Boon.Damage", { count: damage }),
    );
  }

  if (sys.option !== "potion") {
    if (notes.length) {
      const label = i18n.localize("REDSTEEL.Alchemy.Chat.Boons");
      set(
        "system.description",
        `${sys.description ?? ""}<p><em>${label}: ${notes.join(", ")}</em></p>`,
      );
    }
    return { notes, applied };
  }

  const toxicity = Number(sys.toxicity) || 0;
  if (product.toxicity && toxicity > 0) {
    const next = Math.max(0, toxicity + product.toxicity);
    if (next !== toxicity) {
      set("system.toxicity", next);
      applied.toxicity = next - toxicity;
      notes.push(
        i18n.format("REDSTEEL.Alchemy.Chat.Boon.Toxicity", {
          from: toxicity,
          to: next,
        }),
      );
    }
  }

  const dice = Number(product.healingDice) || 0;
  if (dice > 0 && sys.type === "health") {
    addD6("system.roll", sys.roll ?? {}, dice);
    applied.healingDice = dice;
    notes.push(
      i18n.format("REDSTEEL.Alchemy.Chat.Boon.Healing", { count: dice }),
    );
  }

  const bleed = Number(sys.bleed) || 0;
  if (Number(product.bleed) > 0 && sys.type === "health") {
    const next = Math.min(100, bleed + product.bleed);
    if (next !== bleed) {
      set("system.bleed", next);
      applied.bleed = next - bleed;
      notes.push(
        i18n.format("REDSTEEL.Alchemy.Chat.Boon.Bleed", { value: next }),
      );
    }
  }

  if (notes.length) {
    const label = i18n.localize("REDSTEEL.Alchemy.Chat.Boons");
    set(
      "system.description",
      `${sys.description ?? ""}<p><em>${label}: ${notes.join(", ")}</em></p>`,
    );
  }
  return { notes, applied };
}

/**
 * Craft modifiers for boiling herbs into a substance. Two nodes land here:
 * "substance crafting is a guaranteed success" and "substance crafting needs
 * one ingredient less". Substances have no Duplikace line of their own.
 */
export function getAlchemistSubstanceModifiers(actor, substanceKey) {
  return {
    rollBonus: 0,
    advantage: 0,
    critFailureRelief: 0,
    herbDiscount: actorHasSpecNode(actor, "alchemist", "meneIngredienci") ? 1 : 0,
    guaranteed: actorHasSpecNode(actor, "alchemist", "garantovanyUspech"),
  };
}

/* -------------------------------------------- */
/*  Requirements                                 */
/* -------------------------------------------- */

/** Shown for an ingredient with no artwork of its own (special ingredients). */
const FALLBACK_INGREDIENT_ICON = "icons/sundries/misc/bowl-clay-brown.webp";

/**
 * Artwork for special ingredients. A recipe names these in plain text and no
 * compendium item exists for any of them, so without this table the craft
 * panel has nothing to draw. Keys are lower-cased names. An owned item of the
 * same name still wins: that carries whatever art the GM gave it.
 */
const SPECIAL_INGREDIENT_ICONS = {
  "blood lily": "icons/commodities/flowers/lily-water-pink.webp",
  bluebell: "icons/consumables/mushrooms/ovate-blue.webp",
  "dragon root": "icons/consumables/plants/thorned-dried-stem-red.webp",
  "dream orchid": "icons/commodities/flowers/iris-blue.webp",
  "fire stone": "icons/commodities/gems/gem-rough-square-red.webp",
  "ice stone": "icons/commodities/gems/gem-rough-rose-teal.webp",
  "lightning stone": "icons/commodities/gems/gem-rough-square-orange-red.webp",
  mandrake: "icons/consumables/vegetable/root-ginger-brown.webp",
  "moss stone": "icons/commodities/gems/gem-rough-trapeze-yellow-green.webp",
  "powdered pearl": "icons/commodities/gems/powder-raw-white.webp",
  "shadow dust": "icons/consumables/food/salt-seasoning-spice-pink.webp",
  shrapnel: "icons/commodities/metal/fragments-steel-barbed.webp",
  "sulca zairita": "icons/commodities/flowers/lotus-violet.webp",
  sulfur: "icons/commodities/stone/ore-pile-nuggets-gold.webp",
};

/**
 * Every ingredient a craft of `amount` units consumes, next to what the actor
 * actually holds. Same accounting as {@link checkCraftRequirements}, but it
 * reports the full list instead of only the shortfalls, so the craft panel can
 * show stock before the player commits to a roll.
 *
 * The totals count each line capped at its own requirement: `have === need`
 * therefore means "nothing missing", not "stock happens to add up" — a drawer
 * full of vials must not paper over a missing substance.
 *
 * @returns {{lines: {label:string, need:number, have:number, ok:boolean}[],
 *            have:number, need:number, ok:boolean}}
 */
export function getCraftIngredients(actor, recipe, amount = 1) {
  const sys = recipe?.system ?? {};
  const lines = [];

  for (const def of SUBSTANCES) {
    const need = (Number(sys.substances?.[def.key]) || 0) * amount;
    if (need <= 0) continue;
    lines.push({
      key: def.key,
      label: def.name,
      icon: def.icon,
      color: def.color,
      need,
      have: getSubstanceCount(actor, def.key),
    });
  }

  const baseKey = sys.base && sys.base !== "none" ? sys.base : null;
  if (baseKey) {
    lines.push({
      key: `base-${baseKey}`,
      label: game.i18n.localize(BASES[baseKey]?.labelKey ?? baseKey),
      icon: BASES[baseKey]?.icon ?? FALLBACK_INGREDIENT_ICON,
      need: amount,
      have: getBaseUses(actor, baseKey),
    });
  }

  const vesselKey = getRecipeVessel(recipe);
  if (vesselKey) {
    lines.push({
      key: `vessel-${vesselKey}`,
      label: game.i18n.localize(VESSELS[vesselKey].labelKey),
      icon: VESSELS[vesselKey].icon ?? FALLBACK_INGREDIENT_ICON,
      need: amount,
      have: getVesselCount(actor, vesselKey),
    });
  }

  // One whole unit per craft ACTION, never per crafted unit.
  const specialName = sys.specialIngredient?.name?.trim();
  if (specialName) {
    const special = findSpecialIngredient(actor, specialName);
    lines.push({
      key: "special",
      label: specialName,
      icon:
        special?.img ||
        SPECIAL_INGREDIENT_ICONS[norm(specialName)] ||
        FALLBACK_INGREDIENT_ICON,
      need: 1,
      have: Number(special?.system?.quantity) || 0,
    });
  }

  for (const line of lines) line.ok = line.have >= line.need;
  return {
    lines,
    have: lines.reduce((sum, l) => sum + Math.min(l.have, l.need), 0),
    need: lines.reduce((sum, l) => sum + l.need, 0),
    ok: lines.every((l) => l.ok),
  };
}

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

  // One vessel per crafted unit — a potion needs a vial to go in.
  const vesselKey = getRecipeVessel(recipe);
  if (vesselKey) {
    const have = getVesselCount(actor, vesselKey);
    if (have < amount) {
      missing.push({
        label: game.i18n.localize(VESSELS[vesselKey].labelKey),
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

/**
 * Deduct `amount` from a list of stacks, deleting emptied ones.
 * @returns {Promise<{name: string, taken: number}[]>} what each stack gave up.
 */
async function consumeFromStacks(stacks, amount) {
  let left = amount;
  const taken = [];
  for (const item of stacks) {
    if (left <= 0) break;
    const qty = Number(item.system.quantity) || 0;
    const take = Math.min(qty, left);
    if (take <= 0) continue;
    left -= take;
    taken.push({ name: item.name, taken: take });
    if (qty - take <= 0) await item.delete();
    else await item.update({ "system.quantity": qty - take });
  }
  return taken;
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

  const vesselKey = getRecipeVessel(recipe);
  if (vesselKey) {
    await consumeFromStacks(findVesselItems(actor, vesselKey), amount);
    spent.push(
      `${amount}× ${game.i18n.localize(VESSELS[vesselKey].labelKey)}`,
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

/**
 * Add `amount` copies of the recipe's result item to the actor's inventory,
 * with the Alchemist product boons baked into the copy.
 *
 * Boosted output must never merge into a plain stack of the same potion: the
 * two have different numbers. `flags.redsteel.craftBoons` holds the boon
 * signature (absent on plain output) and the stack lookup matches on it, so a
 * master-crafted batch stacks only with an identical master-crafted batch.
 */
async function deliverResult(actor, recipe, amount, mods) {
  const source = await fromUuid(recipe.system.resultUuid);
  if (!source) {
    ui.notifications.error(
      game.i18n.localize("REDSTEEL.Alchemy.Warn.ResultMissing"),
    );
    return null;
  }

  const data = source.toObject();
  const { applied } = applyProductBoons(data, mods?.product);
  const signature = productSignature(applied);

  const existing = actor.items.find(
    (i) =>
      i.type === source.type &&
      i.name === source.name &&
      (i.getFlag("redsteel", "craftBoons") ?? null) === signature,
  );
  if (existing) {
    const update = {
      "system.quantity": (Number(existing.system.quantity) || 0) + amount,
    };
    // A merge keeps the OLD document, so a stack crafted before the result item
    // gained its automation would swallow the new units and leave them inert.
    // Carry the source's status-effect ids over (see the flag read in
    // applyConsumableStatusEffects, usePotion.mjs) so drinking from that stack
    // still applies the buff.
    const sourceEffects = source.getFlag?.("redsteel", "statusEffects");
    if (sourceEffects) update["flags.redsteel.statusEffects"] = sourceEffects;

    await existing.update(update);
    return existing;
  }

  delete data._id;
  foundry.utils.setProperty(data, "system.quantity", amount);
  if (signature) {
    foundry.utils.setProperty(data, "flags.redsteel.craftBoons", signature);
  }
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

/**
 * Put `amount` empty vessels back into the actor's inventory, stacking onto an
 * owned stack when there is one.
 *
 * The glass survives what was in it: a drunk potion leaves its vial behind, and
 * that vial is worth exactly as much to the next craft as a bought one, so it
 * is written with the same `flags.redsteel.alchVessel` the craft lookup reads.
 * The pack item is the preferred source (name, art, localisation key); the
 * fabricated fallback only matters in a world without the compendium.
 *
 * @param {Actor}  actor
 * @param {string} vesselKey     A VESSELS key.
 * @param {number} [amount=1]    How many empties to hand back.
 * @returns {Promise<Item|null>} The stack they landed in, null if nothing was given.
 */
export async function deliverVessel(actor, vesselKey, amount = 1) {
  const def = VESSELS[vesselKey];
  if (!actor || !def || !(amount > 0)) return null;

  const existing = findVesselItems(actor, vesselKey)[0];
  if (existing) {
    await existing.update({
      "system.quantity": (Number(existing.system.quantity) || 0) + amount,
    });
    return existing;
  }

  const pack = game.packs.get(ITEM_PACK_ID);
  let source = null;
  if (pack) {
    const docs = await pack.getDocuments();
    source =
      docs.find((d) => d.getFlag("redsteel", "alchVessel") === vesselKey) ??
      docs.find((d) => d.type === "item" && def.names.includes(norm(d.name))) ??
      null;
  }

  const data = source
    ? source.toObject()
    : {
        name: def.fallbackName,
        type: "item",
        img: def.icon,
        system: { localizationKey: def.localizationKey },
      };
  delete data._id;
  foundry.utils.setProperty(data, "system.quantity", amount);
  foundry.utils.setProperty(data, "flags.redsteel.alchVessel", vesselKey);
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
  // A {fam}KritNeuspech node pushes the fumble window up, out of reach.
  const critFail = Math.min(
    101,
    Number(skill.criticalFailureThreshold ?? 101) +
      (Number(mods?.critFailureRelief) || 0),
  );

  const total =
    rating + stationMod + (Number(mods?.rollBonus) || 0) + (Number(difficulty) || 0);

  // A {fam}Vyhoda node grants advantage for this craft only, so the bias is
  // layered onto a COPY — never onto the actor's live rollAdvantage object.
  const rollData = withRollBias({}, actor);
  const advantage = Number(mods?.advantage) || 0;
  if (advantage) {
    const buckets = { ...(rollData.rollAdvantage ?? {}) };
    buckets.alchemy = (Number(buckets.alchemy) || 0) + advantage;
    rollData.rollAdvantage = buckets;
  }

  const roll = new Roll(`${total} - 1d100`, rollData);
  tagRollSkill(roll, "alchemy");
  await roll.evaluate();
  const d100 = roll.dice?.[0]?.total ?? total - roll.total;

  return {
    d100,
    margin: roll.total,
    critSuccess: d100 <= critSucc,
    critFailure: d100 >= critFail,
    success: roll.total >= 0 && !(d100 >= critFail),
    advantage,
    critFailureRelief: critFail - Number(skill.criticalFailureThreshold ?? 101),
  };
}

/**
 * Roll the Duplikace chance once per crafted unit; each hit is a bonus unit.
 * @returns {Promise<number>} extra units produced.
 */
async function rollDuplication(chance, units) {
  const pct = Number(chance) || 0;
  if (pct <= 0 || units <= 0) return 0;
  let extra = 0;
  for (let i = 0; i < units; i++) {
    const roll = await new Roll("1d100").evaluate();
    if (roll.total <= pct) extra += 1;
  }
  return extra;
}

const fmtMargin = (m) => (m >= 0 ? `+${m}` : `${m}`);

/**
 * Human-readable list of the Alchemist boons active on a craft. Takes either a
 * modifiers object (sheet preview, before the roll) or a finished outcome
 * (chat card), so both always word it the same way.
 * @param {object} mods
 * @returns {string[]}
 */
/**
 * The output fields that decide which product boons may land on a crafted
 * item, in the shape {@link describeCraftBoons} expects. Kept next to
 * {@link applyProductBoons} so the two can never drift on what "a healing
 * potion" means.
 * @param {Item|null} doc  The item a recipe produces.
 */
export function productBoonTarget(doc) {
  if (!doc) return null;
  return {
    option: doc.system?.option ?? "",
    type: doc.system?.type ?? "",
    toxicity: Number(doc.system?.toxicity) || 0,
    localizationKey: doc.system?.localizationKey ?? "",
  };
}

export function describeCraftBoons(mods, product = null) {
  const i18n = game.i18n;
  const out = [];
  if (Number(mods?.advantage) > 0) {
    out.push(i18n.localize("REDSTEEL.Alchemy.Chat.Boon.Advantage"));
  }
  if (Number(mods?.critFailureRelief) > 0) {
    out.push(
      i18n.format("REDSTEEL.Alchemy.Chat.Boon.CritFailure", {
        value: mods.critFailureRelief,
      }),
    );
  }
  if (Number(mods?.duplication) > 0) {
    out.push(
      i18n.format("REDSTEEL.Alchemy.Chat.Boon.Duplication", {
        chance: mods.duplication,
      }),
    );
  }
  if (mods?.guaranteed) {
    out.push(i18n.localize("REDSTEEL.Alchemy.Chat.Boon.Guaranteed"));
  }

  // Product boons: stated as the modifier, since the exact before/after
  // depends on the potion and is written into the crafted item's description.
  // With the crafted item's data in hand, only the boons that would actually
  // land on THAT item are listed — the healing nodes must not be advertised on
  // a mana or stamina potion that applyProductBoons will refuse to touch.
  const boons = mods?.product ?? {};
  const canTakeProductBoons = !product || product.option === "potion";
  const restoresHealth = !product || product.type === "health";
  const hasToxicityCost = !product || Number(product.toxicity) > 0;

  if (Number(boons.toxicity) && canTakeProductBoons && hasToxicityCost) {
    out.push(
      i18n.format("REDSTEEL.Alchemy.Chat.Boon.ToxicityMod", {
        value: fmtMargin(boons.toxicity),
      }),
    );
  }
  if (Number(boons.healingDice) > 0 && canTakeProductBoons && restoresHealth) {
    out.push(
      i18n.format("REDSTEEL.Alchemy.Chat.Boon.Healing", {
        count: boons.healingDice,
      }),
    );
  }
  if (Number(boons.bleed) > 0 && canTakeProductBoons && restoresHealth) {
    out.push(
      i18n.format("REDSTEEL.Alchemy.Chat.Boon.BleedMod", { value: boons.bleed }),
    );
  }
  if (
    Number(boons.damageDice) > 0 &&
    (!product || product.option === "explosive") &&
    productTakesBoon("damageDice", product)
  ) {
    out.push(
      i18n.format("REDSTEEL.Alchemy.Chat.Boon.Damage", {
        count: boons.damageDice,
      }),
    );
  }
  return out;
}

/** Build and send the public craft chat card. NEVER attach a rolls array —
 *  the global chat hook would bolt a generic reroll button onto any d100
 *  roll and desync it from craft resolution. */
async function sendCraftMessage(actor, subject, outcome, spentLines, { isReroll = false } = {}) {
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

  const duplicated = Number(outcome.duplicated) || 0;
  const dupNote = duplicated
    ? ` <span style="opacity:0.85;">(${i18n.format("REDSTEEL.Alchemy.Chat.Duplicated", {
        count: duplicated,
        chance: Number(outcome.duplication) || 0,
      })})</span>`
    : "";

  const resultLine = outcome.success
    ? `<p style="text-align:center;font-size:16px;"><b>${i18n.localize("REDSTEEL.Alchemy.Chat.Success")}</b> — ${i18n.format(
        "REDSTEEL.Alchemy.Chat.Created",
        { count: outcome.created ?? outcome.amount, name: outcome.resultName },
      )}${dupNote}</p>`
    : `<p style="text-align:center;font-size:16px;"><b>${i18n.localize("REDSTEEL.Alchemy.Chat.Failure")}</b> — ${i18n.localize("REDSTEEL.Alchemy.Chat.IngredientsWasted")}</p>`;

  // Which specialisation boons were in play, so the table can audit the roll.
  // Filtered by the item actually made: a mana potion's card must not claim
  // healing dice that applyProductBoons never granted it.
  const boons = describeCraftBoons(outcome, outcome.productItem ?? null);
  const boonBlock = boons.length
    ? `<p style="font-size:12px;opacity:0.85;"><b>${i18n.localize("REDSTEEL.Alchemy.Chat.Boons")}:</b> ${boons.join(" · ")}</p>`
    : "";

  const spentBlock = spentLines?.length
    ? `<p style="font-size:12px;opacity:0.85;"><b>${i18n.localize("REDSTEEL.Alchemy.Chat.Consumed")}:</b> ${spentLines.join(", ")}</p>`
    : "";

  const difficulty = Number(outcome.difficulty) || 0;
  const difficultyNote = difficulty
    ? ` · ${i18n.localize("REDSTEEL.Alchemy.Chat.Difficulty")} ${fmtMargin(difficulty)}`
    : "";

  const content = `
    <div class="rs-alchemy-card">
      <p style="text-align:center;font-size:18px;"><b><i class="fa-light fa-flask"></i> ${i18n.localize(outcome.isSubstance ? "REDSTEEL.Alchemy.Substance.ChatTitle" : "REDSTEEL.Alchemy.Chat.Title")} — ${subject}</b></p>
      ${rerollTag}
      <p style="text-align:center;font-size:12px;opacity:0.8;">${i18n.localize("REDSTEEL.Alchemy.Chat.UsedStation")}: ${stationName}${difficultyNote}</p>
      <p style="text-align:center;">d100: <b>${outcome.d100}</b> → ${i18n.localize("REDSTEEL.Alchemy.Chat.Margin")} <b>${fmtMargin(outcome.margin)}</b><span style="font-size:12px;opacity:0.8;">${critTxt}</span></p>
      ${resultLine}
      ${spentBlock}
      ${boonBlock}
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
    duplication: mods.duplication,
    duplicated: 0,
    product: mods.product,
    productItem: productBoonTarget(source),
    created: 0,
  };

  if (test.success) {
    outcome.duplicated = await rollDuplication(mods.duplication, amount);
    outcome.created = amount + outcome.duplicated;
    await deliverResult(actor, recipe, outcome.created, mods);
  }

  await sendCraftMessage(
    actor,
    recipe.localizedName ?? recipe.name,
    outcome,
    spentLines,
  );
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
    duplication: mods.duplication,
    duplicated: 0,
    product: mods.product,
    productItem: productBoonTarget(source),
    created: 0,
  };

  if (test.success) {
    outcome.duplicated = await rollDuplication(mods.duplication, lastOutcome.amount);
    outcome.created = lastOutcome.amount + outcome.duplicated;
    await deliverResult(actor, recipe, outcome.created, mods);
  }

  await sendCraftMessage(
    actor,
    recipe.localizedName ?? recipe.name,
    outcome,
    null,
    { isReroll: true },
  );
  return outcome;
}

/* -------------------------------------------- */
/*  Substances from herbs                        */
/* -------------------------------------------- */

/** Add `amount` doses of a substance to the actor, pulling the pack item once. */
async function deliverSubstance(actor, def, amount) {
  const existing = findSubstanceItems(actor, def.key)[0];
  if (existing) {
    await existing.update({
      "system.quantity": (Number(existing.system.quantity) || 0) + amount,
    });
    return existing;
  }

  const pack = game.packs.get(ITEM_PACK_ID);
  let source = null;
  if (pack) {
    const docs = await pack.getDocuments();
    source =
      docs.find((d) => d.getFlag("redsteel", "alchSubstance") === def.key) ??
      docs.find((d) => d.type === "item" && norm(d.name) === norm(def.name)) ??
      null;
  }

  const data = source
    ? source.toObject()
    : { name: def.name, type: "item", img: def.icon };
  delete data._id;
  foundry.utils.setProperty(data, "system.quantity", amount);
  foundry.utils.setProperty(data, "flags.redsteel.alchSubstance", def.key);
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created;
}

/**
 * Boil owned herbs down into doses of one substance.
 *
 * Five herbs carrying the substance make one dose. Any batch size resolves on
 * a single Alchemy roll: −10% for the substance recipe itself, another −10%
 * once more than one dose shares the pot. Herbs are consumed either way.
 *
 * @param {Actor}  actor
 * @param {string} substanceKey   A SUBSTANCES key.
 * @param {object} options
 * @param {number} options.amount       Doses to brew.
 * @param {string} options.stationKey   STATIONS key in use.
 */
export async function brewSubstance(actor, substanceKey, { amount, stationKey }) {
  const def = SUBSTANCES.find((s) => s.key === substanceKey);
  if (!def) return { ok: false, reason: `Unknown substance "${substanceKey}".` };

  amount = Math.floor(Number(amount) || 0);
  if (!(amount >= 1 && amount <= SUBSTANCE_MAX_BATCH)) {
    return {
      ok: false,
      reason: game.i18n.format("REDSTEEL.Alchemy.Warn.BadAmount", {
        max: SUBSTANCE_MAX_BATCH,
      }),
    };
  }

  const mods = getAlchemistSubstanceModifiers(actor, substanceKey);
  const herbCost = Math.max(
    1,
    SUBSTANCE_HERB_COST - (Number(mods.herbDiscount) || 0),
  );
  const need = herbCost * amount;
  const have = getHerbCount(actor, substanceKey);
  if (have < need) {
    return {
      ok: false,
      reason: `${game.i18n.localize("REDSTEEL.Alchemy.Warn.NotEnough")}: ${def.name} (${have}/${need})`,
    };
  }

  const difficulty = SUBSTANCE_CRAFT_MOD + (amount > 1 ? SUBSTANCE_BATCH_MOD : 0);
  const test = await rollAlchemyTest(actor, stationKey, mods, difficulty);
  if (mods.guaranteed) {
    test.success = true;
    test.critFailure = false;
  }

  // Same bargain as recipe crafting: the pot keeps the herbs regardless.
  const taken = await consumeFromStacks(findHerbItems(actor, substanceKey), need);
  const spentLines = taken.map((t) => `${t.taken}× ${t.name}`);

  const outcome = {
    ok: true,
    ...test,
    isSubstance: true,
    substanceKey,
    amount,
    herbCost,
    stationKey,
    difficulty,
    resultName: def.name,
    guaranteed: !!mods.guaranteed,
    created: 0,
  };

  if (test.success) {
    await deliverSubstance(actor, def, amount);
    outcome.created = amount;
  }

  await sendCraftMessage(actor, def.name, outcome, spentLines);
  return outcome;
}
