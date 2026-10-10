/**
 * Compatible weapons: which compendium weapons a doctrine fights with, or a
 * weapon skill covers, read from the weapons themselves.
 *
 * Shared by the creation window (step 2's doctrine info panel) and the Learn
 * window (the track note beside a doctrine's or weapon skill's ranks). Both
 * show a "Compatible weapons" pill (compatibleWeaponsPill) that, on click,
 * lists the weapons in a tooltip (compatibleWeapons); hovering one shows its
 * stats (compatibleWeapon).
 *
 * The catalog is built once per session from the item pack's index
 * (loadCompatibleWeapons). A compendium edit shows after a reload.
 */

import { FEATURE_PACK_ID } from "../helpers/progressionEngine.mjs";
import { registerTooltip, ttEscape, ttFrame } from "./tooltips.mjs";

/**
 * The skill a weapon class is fought with (the sheet's weapon skills; bows and
 * crossbows fall to Archery), as "<group>.<key>" under system.
 */
const WEAPON_CLASS_SKILL = {
  axe: "weaponSkills.axes",
  blunt: "weaponSkills.blunt",
  sword: "weaponSkills.swords",
  polearm: "weaponSkills.polearms",
  bow: "combatSkills.archery",
  crossbow: "combatSkills.archery",
};

/**
 * Ranged doctrines whose weapons are fought with a combat skill, whatever the
 * weapon's class (a thrown axe is still a Throwing weapon).
 */
const DOCTRINE_WEAPON_SKILL = {
  archer: "combatSkills.archery",
  arbalest: "combatSkills.archery",
  peltast: "combatSkills.throwing",
  juggler: "combatSkills.throwing",
};

/** How a weapon can be held (weaponGrip), plus weapons for the off hand only. */
const WEAPON_GRIPS = ["two", "versatile", "one", "offhand"];

/**
 * How each doctrine fights, which decides what its weapons are shown as
 * (user ruling 2026-09-30). A weapon's own doctrine flags are not enough on
 * their own: the Two handed flail names Shieldbearer, but a shield leaves one
 * hand free, so a one-handed style never lists two-handed weapons, and a
 * weapon that goes in one hand or both is shown the way the style holds it.
 *   oneHand  one weapon in one hand (a shield or nothing in the other)
 *   dual     a one-handed weapon in each hand
 *   twoHand  both hands on one weapon
 *   ranged   bows and crossbows
 *   thrown   thrown weapons
 *   mixed    anything goes (Rogue)
 * A doctrine not named here is shown as "mixed".
 */
const DOCTRINE_STYLE = {
  shieldbearer: "oneHand",
  duelist: "oneHand",
  dimakerus: "dual",
  reaver: "twoHand",
  pikeman: "twoHand",
  swordsman: "twoHand",
  archer: "ranged",
  arbalest: "ranged",
  peltast: "thrown",
  juggler: "thrown",
  rogue: "mixed",
};

/**
 * Per style: the weapon groups, in order. Each takes the weapons of the listed
 * grips and shows them under its label (REDSTEEL.Creation.Doctrine.Group.<label>).
 * Grips a style leaves out are not shown at all. "skill" is a weapon skill's
 * own grouping: every weapon of its class, by how it is held.
 */
const STYLE_GROUPS = {
  oneHand: [
    { label: "oneChoice", grips: ["one", "versatile"] },
    { label: "offhand", grips: ["offhand"] },
  ],
  dual: [
    { label: "dualChoice", grips: ["one", "versatile"] },
    { label: "offhand", grips: ["offhand"] },
  ],
  twoHand: [
    { label: "twoChoice", grips: ["two"] },
    { label: "bothHands", grips: ["versatile"] },
    { label: "oneChoice", grips: ["one"] },
    { label: "offhand", grips: ["offhand"] },
  ],
  ranged: [{ label: "anyChoice", grips: ["two", "versatile", "one"] }],
  thrown: [{ label: "thrownChoice", grips: ["two", "versatile", "one"] }],
  mixed: [
    { label: "twoChoice", grips: ["two"] },
    { label: "oneChoice", grips: ["versatile", "one"] },
    { label: "offhand", grips: ["offhand"] },
  ],
  skill: [
    { label: "twoHanded", grips: ["two"] },
    { label: "versatile", grips: ["versatile"] },
    { label: "oneHanded", grips: ["one"] },
  ],
};

/**
 * How a weapon is held, by the sheet's own reading (actor-sheet.mjs
 * _isEffectivelyTwoHanded): heavy weapons, bows and crossbows need both hands;
 * a weapon with the two-hand grip option goes in one hand or both; the rest
 * in one.
 * @returns {"two"|"versatile"|"one"}
 */
function weaponGrip(system) {
  if (system?.type === "heavy" || ["bow", "crossbow"].includes(system?.class)) return "two";
  if (system?.twoHandGrip) return "versatile";
  return "one";
}

/**
 * The weapon tooltip's stat lines (compatibleWeapon), labelled the way the
 * weapon sheet labels its fields: damage dice and types, Attack, Defense,
 * Penetration, Crit chance, Bleed and Stagger. Zero values are left out.
 * @returns {[string, string][]} label → value
 */
function weaponStats(system) {
  const i18n = game.i18n;
  const field = (key) => i18n.localize(`REDSTEEL.Item.Weapon.FIELDS.${key}.label`);
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const out = [];
  const roll = system?.roll ?? {};
  const dice = Number(roll.diceNum) || 0;
  if (dice) {
    const bonus = String(roll.diceBonus ?? "").trim();
    const extra = bonus && bonus !== "0" ? (/^[-+]/.test(bonus) ? bonus : `+${bonus}`) : "";
    out.push([i18n.localize("REDSTEEL.Creation.Doctrine.damage"), `${dice}d${roll.diceSize}${extra}`]);
  }
  const types = [system?.dmgType1, system?.dmgType2, system?.dmgType3, system?.dmgType4]
    .filter(Boolean)
    .map((type) => {
      const key = `REDSTEEL.Bg3Hotbar.DamageType.${type}`;
      return i18n.has(key, false) ? i18n.localize(key) : type;
    });
  if (types.length) out.push([i18n.localize("REDSTEEL.Creation.Doctrine.damageType"), types.join(", ")]);
  for (const key of ["attack", "defense"]) {
    const n = Number(system?.[key]) || 0;
    if (n) out.push([field(key), `${signed(n)}%`]);
  }
  const penetration = Number(system?.penetration) || 0;
  if (penetration) out.push([field("penetration"), String(penetration)]);
  const crit = Number(system?.critChance) || 0;
  if (crit) out.push([field("critChance"), `${signed(crit)}%`]);
  for (const key of ["bleed", "stagger"]) {
    const n = Number(system?.effects?.[key]) || 0;
    if (n) out.push([field(key), `${n}%`]);
  }
  return out;
}

/** A skill path's ("weaponSkills.swords") localized name. */
function skillLabel(path) {
  const [group, key] = path.split(".");
  const labelKey = `REDSTEEL.Actor.Character.${group}.${key}.label`;
  return game.i18n.has(labelKey, false) ? game.i18n.localize(labelKey) : key;
}

/** A weapon index entry's name in the active language. */
function weaponName(entry) {
  const key = entry?.system?.localizationKey?.trim();
  return key && game.i18n.has(key, false) ? game.i18n.localize(key) : (entry?.name ?? "");
}

/**
 * One track's entry: its weapons by grip laid out in the style's groups,
 * sorted by name, each knowing its skill. `skills` are the skill names those
 * weapons are fought with; `weaponSkills` the weapon skill keys among them.
 * @returns {{skills: string[], weaponSkills: Set<string>, groups: {label: string, weapons: object[]}[]}}
 */
function layOut(byGrip, style) {
  const lang = game.i18n.lang;
  const groups = (STYLE_GROUPS[style] ?? STYLE_GROUPS.mixed)
    .map(({ label, grips }) => ({
      label,
      weapons: grips.flatMap((grip) => byGrip[grip] ?? []).sort((a, b) => a.name.localeCompare(b.name, lang)),
    }))
    .filter((group) => group.weapons.length);
  const all = groups.flatMap((group) => group.weapons);
  const skills = new Set(all.map((w) => w.skillLabel).filter(Boolean));
  const weaponSkills = new Set(
    all
      .map((w) => w.skill)
      .filter((path) => path?.startsWith("weaponSkills."))
      .map((path) => path.split(".")[1]),
  );
  return { skills: [...skills].sort((a, b) => a.localeCompare(b, lang)), weaponSkills, groups };
}

/**
 * Build the catalog: every doctrine a weapon names (system.doctrines.<key>,
 * or for the off hand only system.offhandProperties.doctrines.<key>) and
 * every weapon skill, keyed by track id ("doctrines.dimakerus",
 * "weaponSkills.blunt").
 * @returns {Promise<Map<string, ReturnType<typeof layOut>>>}
 */
async function buildCatalog() {
  const pack = game.packs.get(FEATURE_PACK_ID);
  let index = null;
  try {
    index = pack
      ? await pack.getIndex({
          fields: [
            "img",
            "system.class",
            "system.type",
            "system.twoHandGrip",
            "system.doctrines",
            "system.offhandProperties.doctrines",
            "system.localizationKey",
            // The weapon tooltip's stat block (weaponStats).
            "system.roll",
            "system.attack",
            "system.defense",
            "system.penetration",
            "system.critChance",
            "system.effects",
            "system.dmgType1",
            "system.dmgType2",
            "system.dmgType3",
            "system.dmgType4",
          ],
        })
      : null;
  } catch (err) {
    console.warn(`Redsteel | Compatible weapons: could not index ${FEATURE_PACK_ID}`, err);
  }
  const weapons = (index?.contents ?? []).filter((entry) => entry.type === "weapon");
  const row = (entry, skill) => ({
    id: entry._id,
    name: weaponName(entry),
    img: entry.img,
    skill,
    skillLabel: skill ? skillLabel(skill) : "",
    stats: weaponStats(entry.system ?? {}),
  });

  const out = new Map();

  // Doctrines: every key any weapon names.
  const doctrineKeys = new Set();
  for (const entry of weapons) {
    const system = entry.system ?? {};
    for (const flags of [system.doctrines, system.offhandProperties?.doctrines]) {
      for (const [key, on] of Object.entries(flags ?? {})) if (on) doctrineKeys.add(key);
    }
  }
  for (const key of doctrineKeys) {
    const byGrip = Object.fromEntries(WEAPON_GRIPS.map((grip) => [grip, []]));
    for (const entry of weapons) {
      const system = entry.system ?? {};
      const main = !!system.doctrines?.[key];
      const offhand = !main && !!system.offhandProperties?.doctrines?.[key];
      if (!main && !offhand) continue;
      const skill = DOCTRINE_WEAPON_SKILL[key] ?? WEAPON_CLASS_SKILL[system.class] ?? null;
      byGrip[offhand ? "offhand" : weaponGrip(system)].push(row(entry, skill));
    }
    out.set(`doctrines.${key}`, layOut(byGrip, DOCTRINE_STYLE[key] ?? "mixed"));
  }

  // Weapon skills: every weapon of the class the skill covers.
  for (const path of new Set(Object.values(WEAPON_CLASS_SKILL))) {
    if (!path.startsWith("weaponSkills.")) continue;
    const byGrip = Object.fromEntries(WEAPON_GRIPS.map((grip) => [grip, []]));
    for (const entry of weapons) {
      const system = entry.system ?? {};
      if (WEAPON_CLASS_SKILL[system.class] !== path) continue;
      byGrip[weaponGrip(system)].push(row(entry, path));
    }
    out.set(path, layOut(byGrip, "skill"));
  }
  return out;
}

let catalogPromise = null;
let catalog = null;

/**
 * The catalog, built on first call and shared after. Await it before reading
 * getCompatibleWeapons or building a pill.
 * @returns {Promise<Map<string, object>>}
 */
export function loadCompatibleWeapons() {
  catalogPromise ??= buildCatalog().then((map) => (catalog = map));
  return catalogPromise;
}

/** One track's weapons ("doctrines.reaver", "weaponSkills.axes"), or null before the catalog is in. */
export function getCompatibleWeapons(trackId) {
  return catalog?.get(trackId) ?? null;
}

/**
 * The "Compatible weapons" pill for a track: click it (data-tt-click) to list
 * the weapons in a tooltip. "" when the track has no weapons or the catalog
 * is not in yet. `className` adds the caller's own chip class.
 */
export function compatibleWeaponsPill(trackId, className = "") {
  if (!getCompatibleWeapons(trackId)?.groups.length) return "";
  return (
    `<span class="rs-weapons-pill ${ttEscape(className)}" data-tt-kind="compatibleWeapons" data-tt-id="${ttEscape(trackId)}" data-tt-click>` +
    `<i class="fa-solid fa-swords"></i> ${ttEscape(game.i18n.localize("REDSTEEL.Creation.Doctrine.compatibleWeapons"))}</span>`
  );
}

/** A track's localized name, for the list tooltip's subtitle. */
function trackName(trackId) {
  const [group, key] = trackId.split(".");
  const labelKey = `REDSTEEL.Actor.Character.${group}.${key}.label`;
  return game.i18n.has(labelKey, false) ? game.i18n.localize(labelKey) : key;
}

/**
 * The pill's tooltip: every weapon of the track, grouped by how they are
 * held; each row opens that weapon's stats on hover (compatibleWeapon).
 */
registerTooltip("compatibleWeapons", async ({ id }) => {
  const data = (await loadCompatibleWeapons()).get(id);
  if (!data?.groups.length) return null;
  const i18n = game.i18n;
  const body = data.groups
    .map(
      ({ label, weapons }) =>
        `<div class="tt-section"><div class="tt-section-label">${ttEscape(
          i18n.localize(`REDSTEEL.Creation.Doctrine.Group.${label}`),
        )}</div>${weapons
          .map(
            (weapon) =>
              `<div class="rs-tt-weapon" data-tt-kind="compatibleWeapon" data-tt-id="${ttEscape(weapon.id)}" data-tt-track="${ttEscape(id)}">` +
              `<img src="${ttEscape(weapon.img)}" alt=""><span>${ttEscape(weapon.name)}</span></div>`,
          )
          .join("")}</div>`,
    )
    .join("");
  return ttFrame({
    title: i18n.localize("REDSTEEL.Creation.Doctrine.compatibleWeapons"),
    subtitle: trackName(id),
    body,
  });
});

/** One weapon from a track's list: how the track holds it, its skill, its stats. */
registerTooltip("compatibleWeapon", async ({ id, dataset }) => {
  const data = (await loadCompatibleWeapons()).get(dataset.ttTrack);
  const group = data?.groups.find(({ weapons }) => weapons.some((w) => w.id === id));
  const weapon = group?.weapons.find((w) => w.id === id);
  if (!weapon) return null;
  const i18n = game.i18n;
  const rows = [
    ...(weapon.skillLabel ? [[i18n.localize("REDSTEEL.Creation.Doctrine.skill"), weapon.skillLabel]] : []),
    ...weapon.stats,
  ];
  return ttFrame({
    title: weapon.name,
    img: weapon.img,
    subtitle: i18n.localize(`REDSTEEL.Creation.Doctrine.Group.${group.label}`),
    body: rows.length
      ? `<div class="tt-stats">${rows
          .map(
            ([label, value]) =>
              `<div class="tt-stat"><span class="tt-stat-label">${ttEscape(label)}</span>` +
              `<span class="tt-stat-value">${ttEscape(value)}</span></div>`,
          )
          .join("")}</div>`
      : "",
  });
});
