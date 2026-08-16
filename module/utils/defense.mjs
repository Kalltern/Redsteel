import { getTraitPills } from "./traitPills.mjs";
import { withRollBias, applyDesperateCrit, tagRollSkill } from "./rollAdvantage.mjs";
import { getDefenseRerollTokens } from "./rerolls.mjs";
import { getBaneProfile } from "./baneCombat.mjs";
import { buildTempHealthGrantFlag } from "./tempHealthGrant.mjs";
import { buildManeuverFlag } from "./advantageousManeuver.mjs";
import { getAimDefenseBonus } from "./aim.mjs";
import {
  OVERWHELM_MAX_STACKS,
  OVERWHELM_PENALTY_PER_STACK,
  attackerTokenIdFromMessage,
  getOverwhelmSources,
  inferAttackerTokenId,
  isOverwhelmTracked,
  overwhelmSourceName,
  forgetOverwhelmSource,
  recordOverwhelmDefense,
  resolveDefenderToken,
  stacksFromSources,
} from "./overwhelm.mjs";

/** "Úspěšný zásah, který je o 60 silnější než protivníkova obrana." */
const CRITICAL_GAP = 60;

/**
 * The defender's armor, as the block every defense card ends with. Typed armor
 * is listed only where it exists, so a plain leather jerkin shows one row.
 *
 * Exported because a rerolled defense card has to redraw it — the numbers are
 * read live off the actor, which is where they were read from the first time.
 *
 * @param {Actor} actor
 * @returns {string} HTML, or "" when the actor carries no armor block.
 */
export function renderArmorTable(actor) {
  const armor = actor?.system?.armor;
  if (!armor) return "";

  const armorRows = [
    ["Armor", armor.total],
    ["Acid Armor", armor.acid?.total],
    ["Fire Armor", armor.fire?.total],
    ["Frost Armor", armor.frost?.total],
    ["Lightning Armor", armor.lightning?.total],
    ["Magic Armor", armor.magic?.total],
  ].filter(([label, value]) => {
    if (label === "Armor") return true;
    return value > 0;
  });

  return `
      <table style="width:100%;text-align:center;font-size:15px;">
        <tr><th>Type</th><th>Value</th></tr>
        ${armorRows
          .map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`)
          .join("")}
      </table>
    `;
}

/**
 * Resolve a defense against the attack it is answering.
 *
 * Defense is a versus Test ("Alternativní forma obrany, versus Test Úhybu
 * proti Zásahu oponenta"), so the two margins are compared directly and the
 * gap between them is the number the rules read. Two things outrank that plain
 * comparison, in this order:
 *
 * 1. A *natural* critical roll is absolute. It settles the contest on its own
 *    and the margins stop mattering, so a natural 1 on defense is a Critical
 *    Defense even against an attack that was 69 ahead. A natural critical
 *    failure on defense reads the same way from the other end: the guard came
 *    apart, so the blow lands critically whatever the margins said.
 *    Only the *other side's* natural critical can deny one. A 60-clear margin
 *    cannot, which is the whole point of calling the natural roll absolute.
 *    Denied criticals fall back to whoever rolled closer to 1 on the d100,
 *    with a tie going to the attacker as every versus Test does.
 * 2. Failing any natural critical, a side that is 60 clear on margin is
 *    critical ("Úspěšný zásah, který je o 60 silnější než protivníkova
 *    obrana"), and below that the plain margin comparison decides.
 *
 * Advisory only: the attack card keeps its Apply Damage buttons, because
 * whether a blow lands is still the GM's call.
 *
 * Module-level (rather than a closure inside `defenseRoll`) because a rerolled
 * defense card has to redraw this block from the answered attack stored on the
 * card it was rerolled from — see `flags.redsteel.versusAttack`.
 *
 * @param {object|null} attack  the answered attack: `{margin, criticalSuccess,
 *   criticalFailure, d100}`. A null/absent margin means "not answering a card",
 *   and yields an empty block.
 * @param {object} params
 * @param {number} params.defenseTotal   this defense's own margin
 * @param {number|null} params.defenseD100 the raw die, for the crit tiebreak
 * @param {boolean} params.defenseCrit   natural critical success on defense
 * @param {boolean} params.defenseCritFailure natural critical failure on defense
 * @returns {{html: string, versus: object|null}}
 */
export function renderVersusBlock(
  attack,
  {
    defenseTotal,
    defenseD100 = null,
    defenseCrit = false,
    defenseCritFailure = false,
  } = {},
) {
  // `== null` catches both null and undefined before the cast, because
  // Number(null) is 0 and a hotbar defense would otherwise contest a phantom
  // attack of margin zero.
  const parsedMargin = attack?.margin == null ? NaN : Number(attack.margin);
  if (!Number.isFinite(parsedMargin)) return { html: "", versus: null };
  const knownAttackMargin = parsedMargin;

  const attackCrit = attack?.criticalSuccess === true;
  const attackCritFailure = attack?.criticalFailure === true;
  const attackD100 = attack?.d100 ?? null;

  const gap = defenseTotal - knownAttackMargin;

  // Which side each natural critical favours. A fumble helps the other guy.
  const naturalForDefense = defenseCrit || attackCritFailure;
  const naturalForAttack = defenseCritFailure || attackCrit;

  let blocked;
  let critical = null; // "defense" | "hit" | null
  let onDice = false;

  if (naturalForDefense && naturalForAttack) {
    // Two natural criticals pulling opposite ways deny each other, and the
    // margins are ignored entirely: whoever rolled closer to 1 takes it.
    if (attackD100 != null && defenseD100 != null) {
      blocked = defenseD100 < attackD100;
      onDice = true;
    } else {
      blocked = gap > 0;
    }
  } else if (naturalForDefense) {
    blocked = true;
    critical = "defense";
  } else if (naturalForAttack) {
    blocked = false;
    critical = "hit";
  } else if (gap >= CRITICAL_GAP) {
    blocked = true;
    critical = "defense";
  } else if (-gap >= CRITICAL_GAP) {
    blocked = false;
    critical = "hit";
  } else {
    blocked = gap > 0;
  }

  const outcome = critical
    ? game.i18n.localize(
        critical === "defense"
          ? "REDSTEEL.Versus.CriticalDefense"
          : "REDSTEEL.Versus.CriticalHit",
      )
    : !onDice && gap === 0
      ? game.i18n.localize("REDSTEEL.Versus.Tie")
      : game.i18n.localize(
          blocked ? "REDSTEEL.Versus.Blocked" : "REDSTEEL.Versus.Hit",
        );

  const detail = game.i18n.format("REDSTEEL.Versus.Detail", {
    attack: knownAttackMargin,
    defense: defenseTotal,
    gap: gap > 0 ? `+${gap}` : gap,
  });

  // The margin line is actively misleading when the dice decided it, so say
  // so rather than leaving a +53 sitting under a "Hit".
  const diceNote = onDice
    ? `<div class="rs-versus-note">${game.i18n.format(
        "REDSTEEL.Versus.DeniedOnDice",
        { attack: attackD100, defense: defenseD100 },
      )}</div>`
    : "";

  // Coloured from the defender's point of view, because this is the
  // defender's card: gold only for their own critical, red for a critical
  // landing on them.
  const state =
    critical === "defense"
      ? "is-critical-defense"
      : critical === "hit"
        ? "is-critical-hit"
        : blocked
          ? "is-blocked"
          : "is-hit";

  const html = `
      <div class="rs-versus ${state}">
        <div class="rs-versus-outcome">${outcome}</div>
        <div class="rs-versus-detail">${detail}</div>
        ${diceNote}
      </div>`;

  return {
    html,
    versus: {
      attackMargin: knownAttackMargin,
      gap,
      blocked,
      critical,
      onDice,
    },
  };
}

export async function defenseRoll({
  actor,
  weapon,
  ability = null,
  attackerTokenId = null,
  attack = null,
} = {}) {
  let defenderToken = null;

  if (!actor) {
    const context = game.redsteel.selectToken();
    if (!context) return;

    actor = context.actor;
    defenderToken = context.token ?? null;
  }

  defenderToken = resolveDefenderToken(actor, defenderToken);

  /* -------------------------------------------- */
  /*  OVERWHELM                                   */
  /* -------------------------------------------- */

  // Who is swinging. An explicit id from a Defend button is a fact; the
  // newest-attack-card guess is a fallback for hotbar-launched defenses and is
  // the reason the dialog lets you take a name back out again.
  let pendingAttackerId = isOverwhelmTracked()
    ? (attackerTokenId ?? inferAttackerTokenId(defenderToken?.id))
    : null;

  // Answering your own attack card (a GM holding both sides) must not put the
  // defender in their own set, or show them as a chip they cannot remove.
  if (pendingAttackerId && pendingAttackerId === defenderToken?.id) {
    pendingAttackerId = null;
  }

  /** Recorded attackers plus the one about to be recorded by this defense. */
  const projectedSources = () => {
    const sources = getOverwhelmSources(defenderToken);
    if (pendingAttackerId && !sources.includes(pendingAttackerId)) {
      sources.push(pendingAttackerId);
    }
    return sources;
  };

  /**
   * Write the attacker into the record and settle the number this roll uses.
   *
   * Called at roll time, never when the dialog opens, so cancelling out leaves
   * no phantom attacker behind. `override` is the value the GM dialled on the
   * counter: it changes this roll only and deliberately does not rewrite the
   * record, because the record is corrected by removing a chip instead.
   */
  const commitOverwhelm = async (override = null) => {
    if (!isOverwhelmTracked()) return Number(override) || 0;

    const stacks = await recordOverwhelmDefense(
      defenderToken,
      pendingAttackerId,
    );
    return override === null ? stacks : Number(override) || 0;
  };

  /**
   * The token this defense is answering, for perks that care who is swinging
   * (today: the Duelist VII aim bonus). Read at roll time, not dialog time.
   *
   * Deliberately independent of combat state. `pendingAttackerId` is only ever
   * populated while Overwhelm is tracking, which means a started encounter — so
   * borrowing it wholesale silently switched the perk off outside combat, and
   * off for anyone the tracker was not following. Who is swinging at you is a
   * fact about the attack, not about the initiative order, so the last branch
   * asks the chat log directly rather than giving up.
   *
   * Order is strongest evidence first: an id handed over by a Defend button is
   * the card naming its own author. Failing that, and only while the chips are
   * live to override it, the attacker the Overwhelm block settled on — which
   * respects a chip the GM took back out, their way of saying "not that one".
   */
  const defendingAgainstId = () => {
    if (attackerTokenId) return attackerTokenId;
    if (isOverwhelmTracked()) return pendingAttackerId;
    return inferAttackerTokenId(defenderToken?.id);
  };

  /* -------------------------------------------- */
  /*  VERSUS THE ATTACK                           */
  /* -------------------------------------------- */

  // `== null` catches both null and undefined before the cast, because
  // Number(null) is 0 and a hotbar defense would otherwise contest a phantom
  // attack of margin zero.
  const parsedAttackMargin =
    attack?.margin == null ? NaN : Number(attack.margin);
  const knownAttackMargin = Number.isFinite(parsedAttackMargin)
    ? parsedAttackMargin
    : null;

  /** This defense against the attack it is answering. See {@link renderVersusBlock}. */
  const resolveVersusAttack = (defense) => renderVersusBlock(attack, defense);

  const baneProfile = getBaneProfile(actor);

  const hasGuard = actor.effects.some(
    (e) =>
      e.getFlag("core", "statusId") === "guard" || e.statuses?.has("guard"),
  );

  /* -------------------------------------------- */
  /*  SHARED CSS                                  */
  /* -------------------------------------------- */

  const css = `
#weapon-list .weapon-choice {
  position: relative;
  font-size: 16px;
  color: black;
}

#weapon-list .weapon-choice:hover {
  color: black;
  text-shadow: 0 0 1px red, 0 0 2px red;
}

.weapon-dialog .window-content {
  max-width: 300px;
  width: 100%;
}

.weapon-dialog .window {
  width: auto;
}

/* Defense dialog buttons */
.dialog .dialog-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.dialog .dialog-buttons button {
  width: 100%;
  min-width: 0;
}
`;

  if (!document.getElementById("redsteel-defense-css")) {
    const styleSheet = document.createElement("style");
    styleSheet.id = "redsteel-defense-css";
    styleSheet.type = "text/css";
    styleSheet.innerText = css;
    document.head.appendChild(styleSheet);
  }

  /* -------------------------------------------- */
  /*  Overwrite the logic if the ability is given */
  /* -------------------------------------------- */
  if (ability) {
    if (ability.system?.rangedDefense != null) {
      return rangedDefense({ ability, weapon });
    }

    if (ability.system?.dodge != null) {
      return dodgeDefense({ ability, weapon });
    }

    if (ability.system?.defense != null) {
      return meleeDefense({ ability, weapon });
    }
  }

  /* -------------------------------------------- */
  /*  DEFENSE SELECTOR                            */
  /* -------------------------------------------- */

  const isCharacter = actor.type === "character";
  const hasActiveSet = isCharacter && actor.system.combat?.activeWeaponSet;

  const activeSetPreview = hasActiveSet
    ? renderWeaponLoadoutsDialog(actor)
    : "";

  let hasLongReach = false;

  // Try active weapon first (PC flow)
  const context = game.redsteel.resolveWeaponContext(actor, ability);
  const activeWeapon = context?.weapon;

  if (activeWeapon?.system?.longReach) {
    hasLongReach = true;
  } else if (actor.type !== "character") {
    hasLongReach = actor.items.some(
      (i) => i.type === "weapon" && i.system?.longReach,
    );
  }

  if (!ability) {
    /** The counter's current value: what this one roll is taken at. */
    const readOverwhelm = (html) =>
      Number(html.find('input[name="overwhelm"]').val()) || 0;

    const buttons = {
      melee: {
        label: "Melee Defense",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const longReachPenalty = html
            .find('[name="longReachPenalty"]')
            .is(":checked")
            ? -5
            : 0;
          const useBane = html.find('[name="baneDefense"]').is(":checked");

          meleeDefense({ overwhelm, longReachPenalty, useBane });
        },
      },

      ranged: {
        label: "Ranged Defense",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const useBane = html.find('[name="baneDefense"]').is(":checked");
          rangedDefense({ overwhelm, useBane });
        },
      },
    };

    if (hasGuard) {
      buttons.guardMelee = {
        label: "Melee Guard",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const useBane = html.find('[name="baneDefense"]').is(":checked");

          meleeDefense({
            overwhelm,
            useBane,
            ability: { system: { defense: -10 } },
          });
        },
      };

      buttons.guardRanged = {
        label: "Ranged Guard",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          const useBane = html.find('[name="baneDefense"]').is(":checked");

          rangedDefense({
            overwhelm,
            useBane,
            ability: { system: { rangedDefense: -10 } },
          });
        },
      };
    }

    buttons.dodge = {
      label: "Dodge",
      callback: (html) => {
        const overwhelm = readOverwhelm(html);
        const useBane = html.find('[name="baneDefense"]').is(":checked");
        dodgeDefense({ overwhelm, useBane });
      },
    };
    // Add spell defense if actor can use magic
    if (actor.system.magicPotential || actor.system.priest) {
      buttons.spell = {
        label: "Magic defense",
        callback: (html) => {
          const overwhelm = readOverwhelm(html);
          spellDefense({ overwhelm });
        },
      };
    }

    const dialog = new Dialog({
      title: "Select Defense Type",
      content: `
      ${activeSetPreview}
      <hr>
      ${
        knownAttackMargin === null
          ? ""
          : `<div class="rs-versus-target">${game.i18n.format(
              "REDSTEEL.Versus.DialogAttackMargin",
              { margin: knownAttackMargin },
            )}</div>`
      }
      <div class="rs-overwhelm"></div>
      <div class="rs-aim-defense"></div>

        ${
          hasLongReach
            ? `
      <div style="margin-top:6px;">
        <label>
          <input type="checkbox" name="longReachPenalty">
          Long Reach penalty (-5)
        </label>
      </div>
    `
            : ""
        }

        ${
          baneProfile.active
            ? `
      <div style="margin-top:6px;">
        <label>
          <input type="checkbox" name="baneDefense">
          ${game.i18n.localize("REDSTEEL.Banes.DefenseToggle")}
        </label>
      </div>
    `
            : ""
        }
    `,
      buttons: buttons,
      default: "melee",
      render: (html) => {
        html.find(".weapon-set-toggle").on("click", async () => {
          await game.redsteel.switchWeaponSet(actor);

          dialog.close();
          defenseRoll({ actor, attackerTokenId, attack }); // 🔁 reopen with updated preview
        });

        renderOverwhelmBlock(html);
      },
    });

    dialog.render(true);
  }

  /* -------------------------------------------- */
  /*  OVERWHELM BLOCK                             */
  /* -------------------------------------------- */

  /**
   * Counter plus one removable chip per attacker.
   *
   * The two controls have deliberately different reach. The −/+ counter moves
   * the number this roll is taken at and stores nothing, which is also the only
   * control shown out of combat where there is nothing to track. Taking a chip
   * out edits the record itself, so it fixes every remaining defense this round
   * rather than just the roll in front of you.
   *
   * Chips are the recorded attackers, never the encounter roster: the list is
   * bounded by how many things have swung at *this* token, so a twenty-token
   * battle still shows at most a handful of names.
   */
  function renderOverwhelmBlock(html) {
    const container = html.find(".rs-overwhelm");
    if (!container.length) return;

    const tracked = isOverwhelmTracked();
    const sources = tracked ? projectedSources() : [];
    const auto = stacksFromSources(sources);

    // A value the user already dialled survives a chip removal; only the
    // untouched counter follows the record.
    const input = container.find('input[name="overwhelm"]');
    const dirty = input.data("dirty") === true;
    const current = dirty
      ? Math.min(Number(input.val()) || 0, OVERWHELM_MAX_STACKS)
      : auto;

    const penalty = current * OVERWHELM_PENALTY_PER_STACK;
    const label = game.i18n.localize("REDSTEEL.Overwhelm.Label");

    const chips = sources
      .map(
        (id) => `
        <span class="rs-overwhelm-chip" data-attacker-id="${id}">
          ${overwhelmSourceName(id)}
          <a class="rs-overwhelm-remove" data-attacker-id="${id}"
             data-tooltip="${game.i18n.localize("REDSTEEL.Overwhelm.RemoveTooltip")}">×</a>
        </span>`,
      )
      .join("");

    container.html(`
      <div class="rs-overwhelm-row">
        <label>${label}</label>
        <button type="button" class="rs-overwhelm-step" data-step="-1">−</button>
        <span class="rs-overwhelm-value">${current}</span>
        <button type="button" class="rs-overwhelm-step" data-step="1">+</button>
        <span class="rs-overwhelm-penalty">${penalty === 0 ? "" : penalty}</span>
        <input type="hidden" name="overwhelm" value="${current}">
      </div>
      ${
        chips
          ? `<div class="rs-overwhelm-sources-label">${game.i18n.localize(
              "REDSTEEL.Overwhelm.SourcesLabel",
            )}</div>
             <div class="rs-overwhelm-chips">${chips}</div>`
          : ""
      }
    `);

    container.find('input[name="overwhelm"]').data("dirty", dirty);

    container.find(".rs-overwhelm-step").on("click", (event) => {
      const step = Number(event.currentTarget.dataset.step);
      const field = container.find('input[name="overwhelm"]');
      const next = Math.max(
        0,
        Math.min((Number(field.val()) || 0) + step, OVERWHELM_MAX_STACKS),
      );

      field.val(next).data("dirty", true);
      container.find(".rs-overwhelm-value").text(next);
      container
        .find(".rs-overwhelm-penalty")
        .text(next === 0 ? "" : next * OVERWHELM_PENALTY_PER_STACK);
    });

    container.find(".rs-overwhelm-remove").on("click", async (event) => {
      const id = event.currentTarget.dataset.attackerId;

      // The attacker this defense is about to add is not in the record yet, so
      // dropping it is just a matter of not adding it.
      if (id === pendingAttackerId) pendingAttackerId = null;
      else await forgetOverwhelmSource(defenderToken, id);

      renderOverwhelmBlock(html);
    });

    // Taking a chip out can change who this defense believes it is answering,
    // which is the one thing the Aim hint below is keyed on — so it is redrawn
    // from here rather than once when the dialog opens, and never claims a
    // bonus the roll will not actually take.
    renderAimDefenseHint(html);
  }

  /**
   * Duelist VII, announced before the player picks a defense type: the bonus is
   * melee-only, so knowing it is live is exactly what decides parry over dodge.
   * Silent whenever there is nothing to claim.
   */
  function renderAimDefenseHint(html) {
    const container = html.find(".rs-aim-defense");
    if (!container.length) return;

    const { perk, aimTargetId, held, attackerTokenId: against, stacks, bonus } =
      getAimDefenseBonus({
        actor,
        token: defenderToken,
        weapon: activeWeapon,
        context,
        attackerTokenId: defendingAgainstId(),
      });

    // Nothing to report for a defender who has no aim out, or no perk to spend
    // it on. Everyone else gets a straight answer either way.
    if (!perk || !aimTargetId || !held) return container.html("");

    const name = (id) =>
      (id ? tokenName(id) : null) ??
      game.i18n.localize("REDSTEEL.Aim.UnknownTarget");

    container.html(
      bonus > 0
        ? `<div class="rs-versus-target">${game.i18n.format(
            "REDSTEEL.Aim.DefenseHint",
            { stacks, bonus },
          )}</div>`
        : `<div class="rs-versus-target rs-aim-mismatch">${game.i18n.format(
            "REDSTEEL.Aim.DefenseMismatch",
            { target: name(aimTargetId), attacker: name(against) },
          )}</div>`,
    );
  }

  /** A token's name, looked up in the scene this defense is happening on. */
  function tokenName(tokenId) {
    const scene = defenderToken?.parent ?? canvas?.scene ?? null;
    return scene?.tokens?.get(tokenId)?.name ?? null;
  }

  /* -------------------------------------------- */
  /*  WEAPON DIALOG                               */
  /* -------------------------------------------- */

  function showWeaponDialog(weapons, onSelect) {
    new Dialog({
      title: "Select Weapon",
      content: `
      <form>
        <fieldset>
          <ul id="weapon-list" style="list-style:none;padding:0;">
            ${weapons
              .map(
                (weapon, index) => `
                <li class="weapon-choice"
                    data-value="${index}"
                    style="cursor:pointer;padding:5px;border-bottom:1px solid #444;">
                  ${weapon.localizedName ?? weapon.name}
                </li>`,
              )
              .join("")}
          </ul>
        </fieldset>
      </form>
      `,
      buttons: {},
      resizable: true,
      width: 200,
      height: 100,
      render: (html) => {
        html.find("#weapon-list li").click(async (event) => {
          const index = Number(event.currentTarget.dataset.value);
          await onSelect(index);
        });
      },
    }).render(true);
  }
  /* -------------------------------------------- */
  /*  MELEE DEFENSE                               */
  /* -------------------------------------------- */
  async function meleeDefense({
    ability = null,
    weapon = null,
    overwhelm = null,
    longReachPenalty = 0,
    useBane = false,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;
      const offProps = getOffhandProps(context);
      const rollName = `Defense with ${weapon.localizedName ?? weapon.name}`;
      // Weapon quality: main hand uses the Zbraň column, off-hand the Druhá ruka column.
      const mainQuality = weapon.system.qualityMods ?? {};
      const offQuality = getOffhandQualityMods(context);
      const mainDefense =
        (Number(weapon.system.defense) || 0) + (Number(mainQuality.defense) || 0);
      const offDefense =
        (Number(offProps?.defense) || 0) + (Number(offQuality.defense) || 0);
      // Characters fold weapon defense into meleeDefense.bonus during
      // prepareDerivedData so the sheet shows the real number, which means it
      // already sits inside defenseRating here. NPCs have no weapon sets, so
      // they still pick it up at roll time.
      const weaponDefense =
        actor.type === "character" ? 0 : mainDefense + offDefense;
      const mainCrit =
        (Number(weapon.system.critDefense) || 0) +
        (Number(mainQuality.critDefense) || 0);
      const offCrit =
        (Number(offProps?.critDefense) || 0) +
        (Number(offQuality.critDefense) || 0);
      // Records the attacker and settles the number in one step. Null means the
      // caller passed no override (an ability-driven defense that never showed
      // the dialog), so the tracked value stands.
      const overwhelmStacks = await commitOverwhelm(overwhelm);
      const overwhelmPenalty = overwhelmStacks * OVERWHELM_PENALTY_PER_STACK;
      console.log("DEFENSE CONTEXT:", context);

      const weaponSpec = game.redsteel.getWeaponSpecBonuses(actor, weapon);

      const { doctrineCritDefenseBonus, doctrineDefenseBonus } =
        await game.redsteel.getDoctrineBonuses(actor, weapon);

      const defense = actor.system.combatSkills.meleeDefense;
      const defenseRating = defense.rating;
      const abilityDefense = Number(ability?.system?.defense) || 0;

      // Duelist VII: parrying the opponent you are aiming at is worth +5% per
      // stack. Passive — the aim is not spent, so it is still there to attack
      // with on the duellist's own turn.
      const aimDefense = getAimDefenseBonus({
        actor,
        token: defenderToken,
        weapon,
        context,
        attackerTokenId: defendingAgainstId(),
      });

      // Advantageous Maneuver: a parry that holds may be turned into an Aim on
      // the attacker for Stamina. Built here rather than in the card, because
      // this is the only scope that knows both the weapon context that gates it
      // and the attacker it would point at.
      const maneuver = buildManeuverFlag({
        actor,
        token: defenderToken,
        weapon,
        context,
        attackerTokenId: defendingAgainstId(),
        defenseKey: "meleeDefense",
      });

      const criticalSuccessThreshold =
        defense.criticalSuccessThreshold +
        mainCrit +
        offCrit +
        doctrineCritDefenseBonus +
        weaponSpec.critDefense +
        (useBane ? baneProfile.critDefense : 0);

      const criticalFailureThreshold = defense.criticalFailureThreshold;

      const rollData = {
        defenseRating,
        weaponDefense,
        doctrineDefenseBonus,
        abilityDefense,
        overwhelmPenalty,
        longReachPenalty,
        specDefense: weaponSpec.defense,
        baneDefense: useBane ? baneProfile.defense : 0,
        aimDefense: aimDefense.bonus,
      };

      const roll = new Roll(
        "@defenseRating + @weaponDefense + @doctrineDefenseBonus + @abilityDefense + @overwhelmPenalty + @longReachPenalty + @specDefense + @baneDefense + @aimDefense - 1d100",
        withRollBias(rollData, actor),
      );

      await roll.evaluate();

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelmStacks,
        {
          deflectValue: Number(actor.system.defenseDeflect) || 0,
          defenseKey: "meleeDefense",
          useBane,
          aimDefense,
          maneuver,
        },
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) {
        return resolveWithContext(context);
      }
    }
    /* -------------------------------------------- */
    /*  IF WEAPON ALREADY KNOWN → SKIP DIALOG       */
    /* -------------------------------------------- */
    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    /* -------------------------------------------- */
    /*  OTHERWISE → ASK PLAYER                     */
    /* -------------------------------------------- */
    const weapons = actor.items.filter(
      (i) =>
        i.type === "weapon" &&
        ["axe", "sword", "blunt", "polearm"].includes(i.system.class) &&
        i.system.thrown !== true,
    );

    if (!weapons.length) {
      ui.notifications.warn("This actor has no melee weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  /* -------------------------------------------- */
  /*  RANGED DEFENSE                              */
  /* -------------------------------------------- */
  async function rangedDefense({
    ability = null,
    weapon = null,
    overwhelm = null,
    useBane = false,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;
      const offProps = getOffhandProps(context);

      const rollName = `Ranged defense with ${weapon.localizedName ?? weapon.name}`;

      const { doctrineCritDefenseBonus, doctrineRangedDefenseBonus } =
        await game.redsteel.getDoctrineBonuses(actor, weapon);

      const defense = actor.system.combatSkills.rangedDefense;
      // Records the attacker and settles the number in one step. Null means the
      // caller passed no override (an ability-driven defense that never showed
      // the dialog), so the tracked value stands.
      const overwhelmStacks = await commitOverwhelm(overwhelm);
      const overwhelmPenalty = overwhelmStacks * OVERWHELM_PENALTY_PER_STACK;
      const abilityDefense = Number(ability?.system?.rangedDefense) || 0;

      const criticalSuccessThreshold =
        defense.criticalSuccessThreshold +
        doctrineCritDefenseBonus +
        (useBane ? baneProfile.critDefense : 0);

      const criticalFailureThreshold = defense.criticalFailureThreshold;

      const rollData = {
        defenseRating: defense.rating,
        doctrineRangedDefenseBonus,
        abilityDefense,
        overwhelmPenalty,
        baneDefense: useBane ? baneProfile.defense : 0,
      };

      const roll = new Roll(
        "@defenseRating + @doctrineRangedDefenseBonus + @abilityDefense + @overwhelmPenalty + @baneDefense - 1d100",
        withRollBias(rollData, actor),
      );

      await roll.evaluate();

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelmStacks,
        { defenseKey: "rangedDefense", useBane },
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) return resolveWithContext(context);
    }

    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    const weapons = actor.items.filter((i) => i.type === "weapon");

    if (!weapons.length) {
      ui.notifications.warn("This actor has no weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  /* -------------------------------------------- */
  /*  DODGE DEFENSE                               */
  /* -------------------------------------------- */

  async function dodgeDefense({
    ability = null,
    weapon = null,
    overwhelm = null,
    useBane = false,
  } = {}) {
    const resolveWithContext = async (context) => {
      const weapon = context.weapon;
      const offProps = getOffhandProps(context);

      const rollName = `Dodge with ${weapon.localizedName ?? weapon.name}`;

      const offQuality = getOffhandQualityMods(context);
      const mainDodge = Number(weapon.system.dodge) || 0;
      const offDodge = Number(offProps?.dodge) || 0;
      const offCritDodge =
        (Number(offProps?.critDodge) || 0) + (Number(offQuality.critDodge) || 0);

      const dodge = actor.system.combatSkills.dodge;
      const abilityDefense = Number(ability?.system?.dodge) || 0;
      // Records the attacker and settles the number in one step. Null means the
      // caller passed no override (an ability-driven defense that never showed
      // the dialog), so the tracked value stands.
      const overwhelmStacks = await commitOverwhelm(overwhelm);
      const overwhelmPenalty = overwhelmStacks * OVERWHELM_PENALTY_PER_STACK;

      const criticalSuccessThreshold =
        dodge.criticalSuccessThreshold +
        (Number(weapon.system.critDodge) || 0) +
        offCritDodge +
        (useBane ? baneProfile.critDefense : 0);

      const criticalFailureThreshold = dodge.criticalFailureThreshold;

      const staminaCost = 4;
      const stamina = actor.system.stats.stamina.value ?? 0;

      if (stamina < staminaCost) {
        ui.notifications.warn("Not enough stamina!");
        return;
      }

      await actor.update({
        "system.stats.stamina.value": stamina - staminaCost,
      });

      const rollData = {
        dodgeRating: dodge.rating,
        weaponDodge: mainDodge + offDodge,
        abilityDefense,
        overwhelmPenalty,
        baneDefense: useBane ? baneProfile.defense : 0,
      };

      const roll = new Roll(
        "@dodgeRating + @weaponDodge + @abilityDefense + @overwhelmPenalty + @baneDefense - 1d100",
        withRollBias(rollData, actor),
      );
      tagRollSkill(roll, "dodge");
      await roll.evaluate();
      const d100 = roll.dice.find((d) => d.faces === 100);
      const d100Result = d100?.total;
      const dodgeFailed =
        d100Result > actor.system.dodgeLimit.total && roll.total >= 0;
      console.log("dodgeFailed", dodgeFailed);

      await createDefenseChatMessage(
        roll,
        weapon,
        rollName,
        criticalSuccessThreshold,
        criticalFailureThreshold,
        overwhelmStacks,
        {
          dodgeFailed,
          deflectValue: Number(actor.system.dodgeDeflect) || 0,
          defenseKey: "dodge",
          useBane,
        },
      );
    };

    if (!weapon) {
      const context = game.redsteel.resolveWeaponContext(actor, ability);
      if (context?.weapon) return resolveWithContext(context);
    }

    if (weapon) {
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        weapon,
      );
      if (!context) return;
      return resolveWithContext(context);
    }

    const weapons = actor.items.filter((i) => i.type === "weapon");

    if (!weapons.length) {
      ui.notifications.warn("This actor has no weapons.");
      return;
    }

    showWeaponDialog(weapons, async (index) => {
      const selected = weapons[index];
      const context = game.redsteel.resolveWeaponContext(
        actor,
        ability,
        selected,
      );
      if (!context) return;
      await resolveWithContext(context);
    });
  }

  async function spellDefense({ overwhelm = null } = {}) {
    // Settled only once the defense has actually paid its resource cost. Both
    // branches below can bail out on "not enough Holy Energy / Mana", and a
    // defense that never rolled must not leave a phantom attacker in the set.
    let overwhelmStacks = 0;
    let overwhelmPenalty = 0;

    const settleOverwhelm = async () => {
      overwhelmStacks = await commitOverwhelm(overwhelm);
      overwhelmPenalty = overwhelmStacks * OVERWHELM_PENALTY_PER_STACK;
    };

    // ─────────────────────────────
    // Priest: Holy Defense
    // ─────────────────────────────
    if (actor.system.priest) {
      let holyEnergy = actor.system.stats.holyEnergy.value ?? 0;
      let holyEnergyCast = actor.system.stats.holyEnergy.cast ?? 0;

      if (holyEnergy <= 0) {
        ui.notifications.warn("Not enough Holy Energy!");
        return;
      }

      await actor.update({
        "system.stats.holyEnergy.value": holyEnergy - 1,
      });

      await settleOverwhelm();

      const faith = actor.system.secondaryAttributes.fth.total ?? 0;

      const roll = new Roll(
        "@holyEnergyCast + @faithBonus + @overwhelmPenalty - 1d100",
        withRollBias(
          {
            holyEnergyCast,
            faithBonus: faith * 8,
            overwhelmPenalty,
          },
          actor,
        ),
      );

      await roll.evaluate();

      // Faith tests know no critical success or failure ("vyjma Víry, Rychlosti
      // a Mentálního souboje"), so this contest is decided on margins alone.
      const versus = resolveVersusAttack({
        defenseTotal: roll.total,
        defenseD100: roll.dice.find((d) => d.faces === 100)?.total ?? null,
        defenseCrit: false,
      });

      await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        flavor: `<strong>Holy Defense</strong>${versus.html}`,
        flags: {
          redsteel: {
            traitPills: getTraitPills(actor, "defense"),
            versus: versus.versus,
          },
        },
      });

      return;
    }

    // ─────────────────────────────
    // Magic Defense (non-priests)
    // ─────────────────────────────

    const defenseLevels = {
      Wild: 0,
      Apprentice: 1,
      Expert: 2,
      Master: 3,
      Grandmaster: 5,
    };

    new Dialog({
      title: "Magic defense",
      content: `<p>Select your Magic defense level:</p>`,
      buttons: Object.entries(defenseLevels).reduce(
        (buttons, [level, cost]) => {
          buttons[level] = {
            label: `${level} (-${cost} Mana)`,
            callback: async () => {
              const mana = actor.system.stats.mana.value ?? 0;

              if (mana < cost) {
                ui.notifications.warn("Not enough Mana!");
                return;
              }

              await actor.update({
                "system.stats.mana.value": mana - cost,
              });

              await settleOverwhelm();

              const rating =
                actor.system.combatSkills.channeling.rating +
                actor.system.combatSkills.channeling.defense;

              const roll = new Roll(
                "@rating + @overwhelmPenalty - 1d100",
                withRollBias({ rating, overwhelmPenalty }, actor),
              );

              await roll.evaluate();

              // Channeling defense posts no crit thresholds of its own, so the
              // contest rests on margins here too.
              const versus = resolveVersusAttack({
                defenseTotal: roll.total,
                defenseD100:
                  roll.dice.find((d) => d.faces === 100)?.total ?? null,
                defenseCrit: false,
              });

              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                flavor: `
                <div style="display:flex;align-items:center;gap:8px;font-size:1.3em;font-weight:bold;">
                  <img src="icons/magic/defensive/shield-barrier-blades-teal.webp" width="36" height="36">
                  <span>Magic Defense (${level})</span>
                </div>

                ${overwhelmStacks > 0 ? `<p style="text-align:center">${game.i18n.localize("REDSTEEL.Overwhelm.Label")}: ${overwhelmPenalty}</p>` : ""}
                ${versus.html}
                `,
                flags: {
                  redsteel: {
                    traitPills: getTraitPills(actor, "defense"),
                    versus: versus.versus,
                  },
                },
              });
            },
          };

          return buttons;
        },
        {},
      ),
      default: "Wild",
    }).render(true);
  }
  /* -------------------------------------------- */
  /*  CHAT MESSAGE                                */
  /* -------------------------------------------- */

  async function createDefenseChatMessage(
    roll,
    weapon,
    rollName,
    criticalSuccessThreshold,
    criticalFailureThreshold,
    overwhelm,
    {
      dodgeFailed = false,
      deflectValue = 0,
      defenseKey = "meleeDefense",
      useBane = false,
      aimDefense = null,
      maneuver = null,
    } = {},
  ) {
    const rollResult = roll.dice[0].total;

    // Deflect (Odklonění): auto-roll the chance and surface it on the card,
    // mirroring how attack "precision" is displayed. Manual beyond the roll.
    let deflectHTML = "";
    const deflectChance = Math.floor(Number(deflectValue) || 0);
    if (deflectChance > 0) {
      const deflectRoll = new Roll("1d100");
      await deflectRoll.evaluate();
      const deflectLabel = game.i18n.localize("REDSTEEL.UI.deflect");
      const successText =
        deflectRoll.total <= deflectChance
          ? `<i class="fa-regular fa-star" style="--fa-primary-color: #c4c700; --fa-secondary-color: #5c5400;"></i> SUCCESS`
          : ``;
      deflectHTML = `<p style="text-align:center;"><b>${deflectLabel}:</b> ${deflectRoll.total} < ${deflectChance}% ${successText}</p>`;
    }

    // Desperate Effort shifts the crit thresholds for this defense roll.
    const { successThreshold, failureThreshold } = applyDesperateCrit(
      roll,
      criticalSuccessThreshold,
      criticalFailureThreshold,
    );
    const critSuccess = rollResult <= successThreshold;
    const critFailure = rollResult >= failureThreshold;

    const armorTable = renderArmorTable(actor);

    const traitPills = getTraitPills(actor, "defense");
    if (useBane) {
      traitPills.push({
        name: game.i18n.localize("REDSTEEL.Banes.Label"),
        description: game.i18n.localize("REDSTEEL.Banes.DefenseToggle"),
      });
    }

    // Weapon Skill 4+ / Swordsman 3+ let the defender claim temporary HP off
    // this defense. Null on every card that has no claim, which is the signal
    // for the button not to render.
    const tempHealthGrant = buildTempHealthGrantFlag(actor, weapon, defenseKey);

    // Nothing when the defense was launched from the hotbar: the margin only
    // arrives when a Defend button names the attack being answered.
    const versus = resolveVersusAttack({
      defenseTotal: roll.total,
      defenseD100: rollResult,
      defenseCrit: critSuccess,
      defenseCritFailure: critFailure,
    });

    // Whether the guard actually held. The contested result is the truth when
    // this defense answered an attack card; otherwise the roll's own margin is
    // all there is to go on. Only ever dims the Temporary Health claim, never
    // blocks it: the rule is the GM's to apply, not the card's to enforce.
    const defenseFailed = versus.versus
      ? !versus.versus.blocked
      : roll.total < 0;

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      rolls: [roll],
      flavor: `
        <div style="display:flex;align-items:center;gap:8px;font-size:1.3em;font-weight:bold;">
          <img src="${weapon.img}" width="36" height="36">
          <span>${rollName}</span>
        </div>
        <hr>
        <p style="text-align:center;font-size:20px;"><b>
          ${
            critSuccess
              ? "Critical Success!"
              : critFailure
                ? "Critical Failure!"
                : dodgeFailed
                  ? "Bad Dodge!"
                  : ""
          }

        </b></p>
          <div style="display:flex;justify-content:center;align-items:center;gap:8px;font-size:1.3em;font-weight:bold;">
            ${overwhelm > 0 ? `<p>${game.i18n.localize("REDSTEEL.Overwhelm.Label")}: ${overwhelm * OVERWHELM_PENALTY_PER_STACK}</p>` : ""}
            ${
              aimDefense?.bonus > 0
                ? `<p>${game.i18n.format("REDSTEEL.Aim.DefenseBonus", {
                    stacks: aimDefense.stacks,
                    bonus: aimDefense.bonus,
                  })}</p>`
                : ""
            }
          </div>
       ${versus.html}
       ${deflectHTML}
       ${armorTable}
      `,
      flags: {
        redsteel: {
          rollName,
          criticalSuccessThreshold,
          criticalFailureThreshold,
          traitPills,
          // Reroll tokens for the chat reroll picker: "defense" + the defense
          // skill + its governing attribute (dodge→dex, ranged→per, melee→dex
          // unless steelGrip/predatorySenses flips it).
          rerollTokens: getDefenseRerollTokens(actor, defenseKey),
          // The attack this card answered, kept whole rather than only as the
          // resolved `versus` below: a reroll of this defense has to contest
          // the same attack again from a different die, and the crit flags and
          // raw die are part of that contest.
          ...(versus.versus ? { versusAttack: attack ?? null } : {}),
          ...(versus.versus ? { versus: versus.versus } : {}),
          ...(tempHealthGrant
            ? { tempHealthGrant: { ...tempHealthGrant, defenseFailed } }
            : {}),
          // Carries `defenseFailed` for the same reason the grant above does:
          // the card is the only place that knows whether the guard held, and
          // the button hook has nothing else to read it from.
          ...(maneuver
            ? { advantageousManeuver: { ...maneuver, defenseFailed } }
            : {}),
        },
      },
    });
  }
}

/**
 * Put a Defend button on every attack card.
 *
 * This is the binding that makes Overwhelm exact. The card already knows who
 * swung (its speaker), so answering the card carries the attacker's identity
 * into the defense roll as a fact, where a defense launched from the hotbar can
 * only fall back to guessing from the newest attack card.
 *
 * Shown to everyone except the attacker's own player. The GM keeps it on their
 * own cards because NPC-versus-NPC is a normal thing to have to roll.
 */
export function registerDefendButton() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    if (message.flags?.attack?.type !== "attack") return;

    const attackerTokenId = attackerTokenIdFromMessage(message);
    if (!attackerTokenId) return;

    // `rolls[0]` is the fallback for cards posted before the margin was stored
    // on the flag, so older chat history stays answerable. Those cards carry no
    // crit flag or raw die, which degrades to a plain margin contest.
    const attack = {
      margin: message.flags.attack.margin ?? message.rolls?.[0]?.total ?? null,
      criticalSuccess: message.flags.attack.criticalSuccess === true,
      d100: message.flags.attack.d100 ?? null,
    };

    const isAuthor = game.user.id === message.author?.id;
    if (isAuthor && !game.user.isGM) return;

    let buttonContainer = html.querySelector(".button-container");
    if (!buttonContainer) {
      buttonContainer = document.createElement("div");
      buttonContainer.className = "button-container";
      html.querySelector(".message-content")?.appendChild(buttonContainer);
    }

    // The hook can fire more than once against the same element.
    if (buttonContainer.querySelector(".rs-defend-button")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "rs-defend-button";
    button.innerHTML = `<i class="fa-light fa-shield"></i><span>${game.i18n.localize(
      "REDSTEEL.Overwhelm.Defend",
    )}</span>`;
    button.dataset.tooltip = game.i18n.localize(
      "REDSTEEL.Overwhelm.DefendTooltip",
    );

    // The defender is resolved at click time, not render time: which token you
    // control changes long after the card was drawn.
    button.addEventListener("click", () =>
      defenseRoll({ attackerTokenId, attack }),
    );

    buttonContainer.appendChild(button);
  });
}

function buildWeaponSetView(actor) {
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

    result[setId] = {
      main,
      off,
      mainIsTwoHanded,
      offIsShield,
    };
  }

  return result;
}
function renderWeaponLoadoutsDialog(actor) {
  const weaponSets = buildWeaponSetView(actor);
  const activeSet = actor.system.combat.activeWeaponSet;

  return `
<section class="weapon-loadouts horizontal active-set-${activeSet}">

  ${[1, 2]
    .map((setId) => {
      const ws = weaponSets[setId];

      return `
<div class="weapon-set-block">
  <div class="weapon-loadout-label">Set ${setId}</div>

  <div class="weapon-slot-row">

    <!-- MAIN -->
    <div class="weapon-slot main ${ws.main ? "filled" : "empty"}"
         data-set="${setId}" data-slot="main">
      ${
        ws.main
          ? `<img src="${ws.main.img}" title="${ws.main.localizedName ?? ws.main.name}">`
          : `<span>Main</span>`
      }
    </div>

    <!-- OFF -->
    <div class="weapon-slot off
      ${ws.mainIsTwoHanded ? "blocked" : ws.off ? "filled" : "empty"}
      ${ws.offIsShield ? "shield" : ""}"
      data-set="${setId}" data-slot="off">

      ${
        ws.mainIsTwoHanded
          ? `
            <div class="two-handed-ghost">
              <img src="${ws.main.img}"
                   title="${ws.main.localizedName ?? ws.main.name} (Two-handed)"
                   width="44" height="44">
            </div>
          `
          : ws.off
            ? `<img src="${ws.off.img}" title="${ws.off.localizedName ?? ws.off.name}" width="44" height="44">`
            : `<span>Off</span>`
      }

    </div>

  </div>
</div>
`;
    })
    .join("")}

  <div class="weapon-set-switcher">
    <button type="button"
      class="weapon-set-toggle set-${activeSet}"
      title="Switch Weapon Set">
      <i class="fa-sharp fa-regular fa-arrows-repeat"></i>
    </button>
  </div>

</section>
`;
}

function getOffhandProps(weaponContext) {
  if (!weaponContext?.isDualWield || !weaponContext.offWeapon) {
    return null;
  }
  return weaponContext.offWeapon.system.offhandProperties ?? null;
}

/**
 * Quality modifiers (Druhá ruka column) of the off-hand weapon, when dual
 * wielding. Returns an empty object otherwise so callers can read keys safely.
 */
function getOffhandQualityMods(weaponContext) {
  if (!weaponContext?.isDualWield || !weaponContext.offWeapon) {
    return {};
  }
  return weaponContext.offWeapon.system.offhandQualityMods ?? {};
}
