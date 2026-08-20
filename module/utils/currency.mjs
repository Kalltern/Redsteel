/**
 * Currency roster — the GM's coinage, propagated to every character sheet.
 *
 * Before this, every player invented their own free-form coin rows, so no two
 * purses agreed and nothing could charge anybody. The roster inverts that: the
 * GM defines the denominations and the prices once, in a world setting, and the
 * sheets render whatever the roster says.
 *
 * Denomination keys are deliberately generic — c1/c2/s1/s2/g1/g2. Tier 1 of a
 * metal is the mixed (alloyed) coin, tier 2 the pure one, and each rung is
 * worth ten of the one below. The *names* are data: a world that calls c1 a
 * "Copper Bone" and a world that calls it a "Farthing" store the same key, so
 * renaming coinage never touches a single purse.
 *
 * Everything is counted in **base units**: the value of the lowest rung, which
 * must be 1. Purses, prices and every API here speak base units, and only the
 * display layer breaks a number back into coins.
 */

const { ApplicationV2 } = foundry.applications.api;

const ROSTER_SETTING = "currencyRoster";
const PRICES_SETTING = "currencyPrices";

/**
 * The ladder the game ships with: six rungs, ×10 apart. Labels are English
 * placeholders on purpose — the GM renames them in the config app and that
 * rename is the world's own data, never a shipped translation.
 */
export const DEFAULT_ROSTER = [
  { key: "c1", label: "Copper I", value: 1, color: "#b87333" },
  { key: "c2", label: "Copper II", value: 10, color: "#d9944e" },
  { key: "s1", label: "Silver I", value: 100, color: "#9ba0a8" },
  { key: "s2", label: "Silver II", value: 1000, color: "#d5dae1" },
  { key: "g1", label: "Gold I", value: 10000, color: "#c8a24a" },
  { key: "g2", label: "Gold II", value: 100000, color: "#e6c878" },
];

/**
 * Seeded lodging prices, in base units, from the tavern table.
 *
 * The ten-day columns are the table's bulk rate: 9× the daily rate for rooms
 * (a 10% discount) and 8× for stabling. Noble rooms read "2 Kosti" against the
 * merchant room's "2 Lebky" — the only reading where a noble room costs more
 * is the silver rung, so that is what they are priced at.
 */
export const DEFAULT_PRICES = [
  { key: "meal", label: "Food and drink (per person, per day)", value: 10 },
  { key: "roomCommon", label: "Common room (per day)", value: 10 },
  { key: "roomCommon10", label: "Common room (10 days)", value: 90 },
  { key: "roomMerchant", label: "Merchant room (per day)", value: 20 },
  { key: "roomMerchant10", label: "Merchant room (10 days)", value: 180 },
  { key: "roomNoble", label: "Noble room (per day)", value: 200 },
  { key: "roomNoble10", label: "Noble room (10 days)", value: 1800 },
  { key: "stabling", label: "Stabling and animal upkeep (per day)", value: 10 },
  { key: "stabling10", label: "Stabling and animal upkeep (10 days)", value: 80 },
];

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

export function registerCurrency() {
  game.settings.register("redsteel", ROSTER_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: foundry.utils.deepClone(DEFAULT_ROSTER),
  });

  game.settings.register("redsteel", PRICES_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: foundry.utils.deepClone(DEFAULT_PRICES),
  });

  game.settings.registerMenu("redsteel", "currencyConfig", {
    name: "REDSTEEL.Currency.MenuName",
    label: "REDSTEEL.Currency.MenuLabel",
    hint: "REDSTEEL.Currency.MenuHint",
    icon: "fa-solid fa-coins",
    type: CurrencyConfig,
    restricted: true,
  });
}

/**
 * The roster, cleaned up and sorted **largest first** — every routine below
 * relies on that order to break a total down greedily.
 */
export function getRoster() {
  const raw = game.settings.get("redsteel", ROSTER_SETTING);
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list
    .filter((d) => d?.key && Number(d.value) > 0)
    .map((d) => ({
      key: String(d.key),
      label: String(d.label ?? d.key),
      value: Math.floor(Number(d.value)),
      color: d.color || "#e6c878",
    }))
    .sort((a, b) => b.value - a.value);
}

/** The GM's price list, as a plain array. */
export function getPrices() {
  const raw = game.settings.get("redsteel", PRICES_SETTING);
  const list = Array.isArray(raw) ? raw : Object.values(raw ?? {});
  return list
    .filter((p) => p?.key)
    .map((p) => ({
      key: String(p.key),
      label: String(p.label ?? p.key),
      value: Math.max(0, Math.floor(Number(p.value) || 0)),
    }));
}

/** One named price in base units, or 0 if the GM has not defined it. */
export function getPrice(key) {
  return getPrices().find((p) => p.key === key)?.value ?? 0;
}

/* -------------------------------------------- */
/*  Purses                                      */
/* -------------------------------------------- */

/** What the actor is carrying, in base units. */
export function purseTotal(actor) {
  const purse = actor?.system?.purse ?? {};
  return getRoster().reduce(
    (sum, d) => sum + Math.max(0, Math.floor(Number(purse[d.key]) || 0)) * d.value,
    0,
  );
}

/**
 * Break a base-unit total back into coins, largest first.
 *
 * On a ×10 ladder this is just carrying digits, which is why making change is
 * safe to do automatically: paying 1 c2 out of 12 c1 leaves 2 c1 behind and
 * nobody has to think about it.
 *
 * Anything below the lowest rung cannot be represented and is dropped, so the
 * roster's lowest rung must be worth 1. The config app enforces that.
 */
export function layoutPurse(total) {
  const out = {};
  let left = Math.max(0, Math.floor(Number(total) || 0));
  for (const d of getRoster()) {
    const n = Math.floor(left / d.value);
    out[d.key] = n;
    left -= n * d.value;
  }
  return out;
}

/** Can this actor cover `cost` base units? */
export function canAfford(actor, cost) {
  return purseTotal(actor) >= Math.max(0, Math.floor(Number(cost) || 0));
}

/**
 * Take `cost` base units out of the actor's purse, making change.
 *
 * Returns null when the purse cannot cover it and `allowDebt` is off, so the
 * caller can report a refusal rather than silently emptying someone out.
 *
 * @param {Actor} actor
 * @param {number} cost                Base units to charge.
 * @param {{allowDebt?: boolean}} [options]
 * @returns {Promise<{paid: number, short: number, before: number, after: number}|null>}
 */
export async function chargeActor(actor, cost, { allowDebt = false } = {}) {
  const price = Math.max(0, Math.floor(Number(cost) || 0));
  const before = purseTotal(actor);

  if (!price) return { paid: 0, short: 0, before, after: before };
  if (before < price && !allowDebt) return null;

  const paid = Math.min(price, before);
  const after = before - paid;

  await actor.update({ "system.purse": layoutPurse(after) });

  return { paid, short: price - paid, before, after };
}

/** Put `amount` base units into the actor's purse, re-laying the coins. */
export async function creditActor(actor, amount) {
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  if (!gain) return purseTotal(actor);
  const after = purseTotal(actor) + gain;
  await actor.update({ "system.purse": layoutPurse(after) });
  return after;
}

/* -------------------------------------------- */
/*  Display                                     */
/* -------------------------------------------- */

/**
 * Base units as coins, e.g. "2 Silver I 3 Copper I". Rungs that come to zero
 * are left out, so a round price reads as one coin rather than a column of
 * noughts.
 */
export function formatPrice(baseUnits) {
  const roster = getRoster();
  if (!roster.length) return String(baseUnits ?? 0);

  const parts = [];
  let left = Math.max(0, Math.floor(Number(baseUnits) || 0));
  for (const d of roster) {
    const n = Math.floor(left / d.value);
    if (n > 0) {
      parts.push(`${n} ${d.label}`);
      left -= n * d.value;
    }
  }
  return parts.length ? parts.join(" ") : `0 ${roster.at(-1).label}`;
}

/**
 * The rungs the purse summary is expressed in: tier 1 of each metal, i.e.
 * c1 / s1 / g1 on the shipped ladder. Ascending.
 *
 * A summary in every rung is unreadable at six denominations, and it is also
 * redundant: on a x10 ladder each tier-1 rung is worth a hundred of the one
 * below, so a total broken down over tier 1 alone never shows more than 99 of
 * any coin and never needs more than three figures.
 *
 * Keys are generic and fixed (see the file header), so the tier is read off
 * the key. The index fallback covers a GM who invented their own keys: on a
 * paired ladder every other rung from the bottom is tier 1.
 */
function summaryRungs() {
  const ascending = getRoster().slice().reverse();
  const tier1 = ascending.filter((d) => /1$/.test(d.key));
  return tier1.length ? tier1 : ascending.filter((_, i) => i % 2 === 0);
}

/**
 * Break base units down over the tier-1 rungs only, largest first, for the
 * purse total on the sheet. Rungs that come to zero are dropped; a purse worth
 * nothing still reports one row so the strip is never blank.
 *
 * Returns the denomination records (label and colour included) rather than a
 * string, so the sheet can colour each figure by its own coin.
 *
 * @param {number} baseUnits
 * @returns {Array<{key: string, label: string, color: string, count: number}>}
 */
export function summarisePurse(baseUnits) {
  const rungs = summaryRungs();
  if (!rungs.length) return [];

  let left = Math.max(0, Math.floor(Number(baseUnits) || 0));
  const parts = [];
  for (const d of [...rungs].reverse()) {
    const count = Math.floor(left / d.value);
    left -= count * d.value;
    if (count > 0) parts.push({ ...d, count });
  }
  return parts.length ? parts : [{ ...rungs[0], count: 0 }];
}

/* -------------------------------------------- */
/*  GM config app                               */
/* -------------------------------------------- */

/**
 * The GM's one window for coinage: the denomination ladder on top, the price
 * list under it. Follows the raw-ApplicationV2 shape the rest of the system
 * uses (string out of `_renderHTML`, listeners wired in `_replaceHTML`).
 */
export class CurrencyConfig extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "redsteel-currency-config",
    classes: ["redsteel", "rs-currency-config"],
    window: {
      title: "REDSTEEL.Currency.Title",
      icon: "fa-solid fa-coins",
      resizable: true,
    },
    position: { width: 620, height: "auto" },
  };

  /** Working copies, so Cancel really cancels. */
  _roster = null;
  _prices = null;

  _load() {
    if (!this._roster) this._roster = getRoster().sort((a, b) => a.value - b.value);
    if (!this._prices) this._prices = getPrices();
  }

  async _renderHTML() {
    this._load();
    const t = (k) => game.i18n.localize(`REDSTEEL.Currency.${k}`);

    // Warn rather than block: a ladder whose bottom rung is not 1 cannot
    // represent every price, and silently rounding people's money is worse
    // than telling the GM the ladder is wrong.
    const lowest = this._roster[0]?.value;
    const badBase =
      this._roster.length && lowest !== 1
        ? `<p class="rs-currency-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${t("BaseWarning")}</p>`
        : "";

    const denomRows = this._roster
      .map(
        (d, i) => `
        <li class="rs-currency-row" data-index="${i}">
          <input type="text" class="rs-cur-key" value="${foundry.utils.escapeHTML(d.key)}" placeholder="c1">
          <input type="text" class="rs-cur-label" value="${foundry.utils.escapeHTML(d.label)}" placeholder="${t("LabelPlaceholder")}">
          <input type="number" class="rs-cur-value" value="${d.value}" min="1" step="1">
          <input type="color" class="rs-cur-color" value="${d.color}">
          <a class="rs-cur-del" data-action="delDenom" data-index="${i}" title="${t("Remove")}"><i class="fa-solid fa-xmark"></i></a>
        </li>`,
      )
      .join("");

    const priceRows = this._prices
      .map(
        (p, i) => `
        <li class="rs-currency-row rs-price-row" data-index="${i}">
          <input type="text" class="rs-price-key" value="${foundry.utils.escapeHTML(p.key)}" placeholder="key">
          <input type="text" class="rs-price-label" value="${foundry.utils.escapeHTML(p.label)}" placeholder="${t("LabelPlaceholder")}">
          <input type="number" class="rs-price-value" value="${p.value}" min="0" step="1">
          <span class="rs-price-readout">${foundry.utils.escapeHTML(formatPrice(p.value))}</span>
          <a class="rs-cur-del" data-action="delPrice" data-index="${i}" title="${t("Remove")}"><i class="fa-solid fa-xmark"></i></a>
        </li>`,
      )
      .join("");

    return `
      <div class="rs-currency-body">
        ${badBase}
        <h3>${t("Denominations")}</h3>
        <p class="rs-currency-hint">${t("DenominationsHint")}</p>
        <ol class="rs-currency-head">
          <li><span>${t("ColKey")}</span><span>${t("ColLabel")}</span><span>${t("ColValue")}</span><span></span><span></span></li>
        </ol>
        <ol class="rs-currency-list rs-denom-list">${denomRows}</ol>
        <a class="rs-cur-add" data-action="addDenom"><i class="fa-solid fa-plus"></i> ${t("AddDenomination")}</a>

        <h3>${t("Prices")}</h3>
        <p class="rs-currency-hint">${t("PricesHint")}</p>
        <ol class="rs-currency-list rs-price-list">${priceRows}</ol>
        <a class="rs-cur-add" data-action="addPrice"><i class="fa-solid fa-plus"></i> ${t("AddPrice")}</a>
      </div>

      <footer class="rs-currency-footer">
        <button type="button" data-action="reset"><i class="fa-solid fa-rotate-left"></i> ${t("Reset")}</button>
        <button type="button" data-action="save" class="default"><i class="fa-solid fa-floppy-disk"></i> ${t("Save")}</button>
      </footer>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
    this._activateListeners(content);
  }

  /** Read every input back into the working copies before acting on them. */
  _scrape(root) {
    this._roster = Array.from(root.querySelectorAll(".rs-denom-list .rs-currency-row")).map(
      (li) => ({
        key: li.querySelector(".rs-cur-key").value.trim(),
        label: li.querySelector(".rs-cur-label").value.trim(),
        value: Math.max(1, Math.floor(Number(li.querySelector(".rs-cur-value").value) || 1)),
        color: li.querySelector(".rs-cur-color").value,
      }),
    );
    this._roster.sort((a, b) => a.value - b.value);

    this._prices = Array.from(root.querySelectorAll(".rs-price-list .rs-currency-row")).map(
      (li) => ({
        key: li.querySelector(".rs-price-key").value.trim(),
        label: li.querySelector(".rs-price-label").value.trim(),
        value: Math.max(0, Math.floor(Number(li.querySelector(".rs-price-value").value) || 0)),
      }),
    );
  }

  _activateListeners(root) {
    root.querySelectorAll("[data-action]").forEach((el) => {
      el.addEventListener("click", async (event) => {
        event.preventDefault();
        const action = el.dataset.action;
        const index = Number(el.dataset.index);
        this._scrape(root);

        switch (action) {
          case "addDenom":
            this._roster.push({ key: "", label: "", value: 1, color: "#e6c878" });
            break;
          case "delDenom":
            this._roster.splice(index, 1);
            break;
          case "addPrice":
            this._prices.push({ key: "", label: "", value: 0 });
            break;
          case "delPrice":
            this._prices.splice(index, 1);
            break;
          case "reset":
            this._roster = foundry.utils.deepClone(DEFAULT_ROSTER);
            this._prices = foundry.utils.deepClone(DEFAULT_PRICES);
            break;
          case "save":
            if ((await this._save()) === false) return this.render();
            ui.notifications.info(game.i18n.localize("REDSTEEL.Currency.Saved"));
            return this.close();
        }
        this.render();
      });
    });

    // Live coin readout next to each price, so the GM sees "1 Copper II"
    // rather than counting zeroes.
    root.querySelectorAll(".rs-price-value").forEach((input) => {
      input.addEventListener("input", () => {
        const readout = input.parentElement.querySelector(".rs-price-readout");
        if (readout) readout.textContent = formatPrice(input.value);
      });
    });
  }

  async _save() {
    const denoms = this._roster.filter((d) => d.key);

    // The purse is stored as `system.purse.<key>`, and Foundry expands a
    // dotted path whose segments are all digits into an *array*. A numeric key
    // would therefore quietly reshape every purse in the world, so it is
    // refused at the door rather than debugged later.
    const numeric = denoms.filter((d) => /^\d+$/.test(d.key)).map((d) => d.key);
    if (numeric.length) {
      ui.notifications.error(
        game.i18n.format("REDSTEEL.Currency.NumericKey", {
          keys: numeric.join(", "),
        }),
      );
      return false;
    }

    // Two rungs sharing a key would share a purse slot and double-count.
    const seen = new Set();
    const duplicate = denoms.find((d) => seen.size === seen.add(d.key).size);
    if (duplicate) {
      ui.notifications.error(
        game.i18n.format("REDSTEEL.Currency.DuplicateKey", {
          key: duplicate.key,
        }),
      );
      return false;
    }

    await game.settings.set("redsteel", ROSTER_SETTING, denoms);
    await game.settings.set(
      "redsteel",
      PRICES_SETTING,
      this._prices.filter((p) => p.key),
    );
  }
}
