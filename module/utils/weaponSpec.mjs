// Master weapon list — hardcoded from the redsteel-items weapon compendium JSON
// (src/packs/redsteel-items/Weapons_*). Thrown/melee variants of one weapon
// ("Javelin" / "Javelin melee", "Throwing axe" / "Throwing axe melee") are
// collapsed to their base name here, because a specialization covers both modes
// (see the " melee"-suffix handling in getWeaponSpecBonuses). Keep this in sync
// with the weapon compendium when weapons are added or renamed.
export const MASTER_WEAPON_NAMES = [
  "Bac-de-corbin",
  "Bardiche",
  "Baton",
  "Broadsword",
  "Crossbow",
  "Dagger",
  "Fencing dagger",
  "Flail",
  "Flamberge",
  "Glaive",
  "Great hammer",
  "Halberd",
  "Hatchet",
  "Heavy Crossbow",
  "Hunting bow",
  "Javelin",
  "Long axe",
  "Longbow",
  "Longsword",
  "Mace",
  "Military Cleaver",
  "Rapier",
  "Reflex bow",
  "Sabre",
  "Shortsword",
  "Spear",
  "Staff",
  "Throwing axe",
  "Throwing knife",
  "Two handed flail",
  "War axe",
  "War hammer",
  "War pick",
];

export function getMasterWeaponNames() {
  return [...MASTER_WEAPON_NAMES];
}

export async function openWeaponSpecDialog(item) {
  if (!item) return;
  const names = getMasterWeaponNames();
  const current = String(item.system?.weaponSpec?.tag ?? "");
  const tier = Number(item.system?.weaponSpec?.tier) || 0;

  const optionsHtml = names
    .map((n) => `<option value="${n}" ${n === current ? "selected" : ""}>${n}</option>`)
    .join("");

  const content = `
    <form>
      <p style="margin:0 0 8px;">Choose the weapon this specialization (Tier ${tier}) applies to. The bonus applies to any weapon with this name.</p>
      <div class="form-group">
        <label>Weapon</label>
        <select name="weaponSpecTag" style="width:100%;">
          <option value="">&mdash; none &mdash;</option>
          ${optionsHtml}
        </select>
      </div>
    </form>`;

  new Dialog({
    title: `Weapon Specialization — ${item.name}`,
    content,
    buttons: {
      confirm: {
        icon: '<i class="fas fa-check"></i>',
        label: "Confirm",
        callback: async (html) => {
          const value = html.find('select[name="weaponSpecTag"]').val() ?? "";
          await item.update({ "system.weaponSpec.tag": value });
        },
      },
      cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" },
    },
    default: "confirm",
  }).render(true);
}
