/**
 * Fold in the extra damage an ability only deals with a Heavy weapon.
 *
 * The rules write Zteč as one action ("Damage +2d4; additional +2d4 if using a
 * Heavy weapon") rather than two, so the ability carries the conditional dice
 * in `system.roll.heavyDiceBonus` and we resolve it here, once the weapon that
 * will actually swing is known. Non-heavy weapons and abilities without the
 * field are left untouched.
 *
 * @param {string} formula  damage formula assembled so far ("" if none yet)
 * @param {Item|null} weapon  the resolved weapon, or null for a weaponless attack
 * @param {Item[]} sources  ability and/or modifiers that may carry heavy dice
 * @returns {string} the formula, with any heavy bonuses appended
 */
export function appendHeavyWeaponDamage(formula, weapon, sources = []) {
  if (weapon?.system?.type !== "heavy") return formula;

  let out = formula;
  for (const source of sources) {
    const bonus = source?.system?.roll?.heavyDiceBonusFormula;
    if (!bonus) continue;
    out = out ? `(${out}) + (${bonus})` : bonus;
  }
  return out;
}

/**
 * The freeform tags a weapon carries, lower-cased. `system.tags` is a
 * comma-separated field the GM fills in ("trident, spear") — the same list
 * weapon specialisations and Wounding Impale read.
 * @param {Item|null} weapon
 * @returns {string[]}
 */
export function getWeaponTags(weapon) {
  return String(weapon?.system?.tags ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Does this weapon carry the given tag? The weapon's `system.class` counts as a
 * tag too, so a whole weapon class ("polearm" → Impale) can gate an ability
 * without the GM having to retype it into every weapon's freeform tag field.
 * @param {Item|null} weapon
 * @param {string} tag
 * @returns {boolean}
 */
export function weaponHasTag(weapon, tag) {
  const wanted = String(tag ?? "").trim().toLowerCase();
  if (!wanted) return true;
  const weaponClass = String(weapon?.system?.class ?? "").trim().toLowerCase();
  if (weaponClass && weaponClass === wanted) return true;
  return getWeaponTags(weapon).includes(wanted);
}

/**
 * May this ability be used with this weapon? Only abilities that declare a
 * `system.requiredWeaponTag` are restricted (Fuscina Ictus → "trident");
 * everything else is allowed, which is every ability that existed before the
 * field did. A restricted ability fails against a null weapon: a weaponless
 * attack is not a trident.
 * @param {Item|null} ability
 * @param {Item|null} weapon
 * @returns {boolean}
 */
export function abilityAllowedForWeapon(ability, weapon) {
  const required = String(ability?.system?.requiredWeaponTag ?? "").trim();
  if (!required) return true;
  return weaponHasTag(weapon, required);
}

/**
 * Drop the items this actor cannot use right now because of the weapon tag
 * they name (Fuscina Ictus → "trident", Imbroccata → "rapier"). With a weapon
 * already resolved (a character's active set) the check is against that weapon.
 * Without one — an NPC, or a character with no active set, who picks the weapon
 * after this dialog — the entry survives if the actor owns any weapon with the
 * tag, so it isn't hidden on a technicality; the roll path makes the final call
 * once the weapon is known.
 * @param {Item[]} items  abilities and/or attack modifiers
 * @param {Actor} actor
 * @param {Item|null} weapon  the resolved weapon, or null when unknown
 * @returns {Item[]}
 */
export function filterByRequiredWeaponTag(items, actor, weapon = null) {
  return items.filter((item) => {
    const required = String(item?.system?.requiredWeaponTag ?? "").trim();
    if (!required) return true;
    if (weapon) return weaponHasTag(weapon, required);
    return actor.items.some(
      (i) => i.type === "weapon" && weaponHasTag(i, required),
    );
  });
}

/**
 * @see filterByRequiredWeaponTag — the modifier-pill call sites' name for it.
 * @param {Item[]} modifiers  the actor's modifiesAttack abilities
 * @param {Actor} actor
 * @param {Item|null} weapon
 * @returns {Item[]}
 */
export function filterModifiersByWeapon(modifiers, actor, weapon = null) {
  return filterByRequiredWeaponTag(modifiers, actor, weapon);
}

export function resolveWeaponContext(
  actor,
  ability = null,
  selectedWeapon = null,
) {
  if (actor.type === "character") {
    // Active set mode
    const activeSet = actor.system.combat?.activeWeaponSet;
    if (!activeSet) return null;

    const weaponSets = buildWeaponSetView(actor);
    const ws = weaponSets[activeSet];
    if (!ws?.main) return null;

    const weapon = ws.main;
    // Manual selection override (dialog mode)

    if (selectedWeapon) {
      return {
        weapon: selectedWeapon,
        offWeapon: ws.off || null,
        isDualWield: ws.off && !ws.mainIsTwoHanded && !ws.offIsShield,
        hasShield: ws.offIsShield || false,
      };
    }
    //  Ability filtering (optional)
    if (ability && ability.system?.type === "melee") {
      if (
        !["axe", "sword", "blunt", "polearm"].includes(weapon.system.class) ||
        weapon.system.thrown
      )
        return null;
    }

    if (ability && ability.system?.type === "ranged") {
      if (
        !["bow", "crossbow"].includes(weapon.system.class) &&
        weapon.system.thrown !== true
      )
        return null;
    }

    return {
      weapon,
      offWeapon: ws.off || null,
      isDualWield: ws.isDualWield || false,
      hasShield: ws.offIsShield || false,
    };
  }

  //  NPC branch stays separate
  if (actor.type === "npc") {
    if (!selectedWeapon) return null;

    const offWeapon = actor.items.find(
      (i) =>
        i.type === "weapon" &&
        i.system.npcOffhand === true &&
        i.id !== selectedWeapon.id,
    );

    return {
      weapon: selectedWeapon,
      offWeapon: offWeapon || null,
      isDualWield: !!offWeapon,
      hasShield: false,
    };
  }

  return null;
}

export function buildWeaponSetView(actor) {
  if (!actor || actor.type !== "character") return null;
  const sets = actor.system.combat.weaponSets;
  const result = {};

  for (const setId of [1, 2]) {
    const slots = sets?.[setId] ?? {};
    const main = slots.main ? actor.items.get(slots.main) : null;
    const off = slots.off ? actor.items.get(slots.off) : null;

    const mainIsTwoHanded = main
      ? main.system.type === "heavy" ||
        ["crossbow", "bow"].includes(main.system.class) ||
        main.system.gripMode === "two"
      : false;

    const offIsShield = !!off?.system?.shield;
    const isDualWield = !!main && !!off && !mainIsTwoHanded && !offIsShield;

    result[setId] = {
      main,
      off,
      mainIsTwoHanded,
      offIsShield,
      isDualWield,
    };
  }

  return result;
}
