/**
 * Auto-select the active combatant's token when the turn changes.
 *
 * The GM drives every NPC turn from the same tokens the tracker is already
 * pointing at, so having to click the token first is pure repetition. A player
 * running more than one token (a companion, a summon, a mount) has the same
 * problem in miniature: the bar and the canvas keys both belong to whoever is
 * selected, and on their turn that should be whoever the tracker says.
 *
 * So on every turn change each client selects the new combatant's token, if it
 * is one they are allowed to control. Nobody else's turn touches their
 * selection, and the selection is theirs to change again straight afterwards:
 * this sets the starting point of a turn, it does not hold it.
 *
 * With the Redsteel panel on, the panel follows the canvas selection, so this
 * also swings the bar onto the active combatant for free.
 */

const SETTING = "combatAutoSelect";

/* -------------------------------------------- */

/**
 * Select the token of `combat`'s current combatant, when this user may.
 *
 * Every guard here is a case where selecting would either fail or be wrong:
 * combat not started yet (no combatant), the fight running on another scene,
 * a combatant with no token placed, or a token this user cannot control.
 * `token.control` would refuse the last one anyway, but reading it out loud
 * keeps the GM/player split visible.
 */
function selectActiveCombatant(combat) {
  if (!game.settings.get("redsteel", SETTING)) return;
  if (!canvas?.ready || !combat?.started) return;

  const combatant = combat.combatant;
  const tokenDoc = combatant?.token;
  if (!tokenDoc) return;

  // The fight can be running on a scene this client is not looking at. The
  // placeable only exists on the viewed scene, which is exactly the test.
  const token = tokenDoc.object;
  if (!token || tokenDoc.parent?.id !== canvas.scene?.id) return;

  // A GM owns everything; a player only gets their own combatants. Ownership
  // is read off the actor because that is where players are granted it, and
  // off the token as well because an unlinked token can diverge. Anything this
  // lets through that core still refuses is a no-op: `control` returns false
  // rather than throwing.
  if (!game.user.isGM && !combatant.actor?.isOwner && !tokenDoc.isOwner) return;

  // Already there: selecting again would release a deliberate multi-select.
  if (token.controlled) return;
  token.control({ releaseOthers: true });
}

/* -------------------------------------------- */

/**
 * Register the client setting and the turn hooks. Call from the `init` hook.
 */
export function registerCombatAutoSelect() {
  game.settings.register("redsteel", SETTING, {
    config: true,
    scope: "client", // whose selection it is decides who opts out
    name: "REDSTEEL.Config.CombatAutoSelect.name",
    hint: "REDSTEEL.Config.CombatAutoSelect.label",
    type: Boolean,
    default: true,
  });

  // `turn` covers advancing and stepping back, `round` covers the wrap from
  // the last combatant to the first, where `turn` can land on the same number.
  Hooks.on("updateCombat", (combat, changed) => {
    if (!("turn" in changed) && !("round" in changed)) return;
    selectActiveCombatant(combat);
  });

  // Starting the fight sets round 1 without the tracker having moved a turn on
  // some paths, and it is the one moment everyone wants the first token up.
  Hooks.on("combatStart", (combat) => selectActiveCombatant(combat));

  // Removing the combatant whose turn it was hands the turn to somebody else
  // without a `turn` change of its own. Deliberately not `updateCombatant`:
  // dynamic initiative rewrites every combatant each round, and defeated flags
  // fire it mid-turn, so that hook would keep grabbing the selection back.
  Hooks.on("deleteCombatant", (combatant) => selectActiveCombatant(combatant?.parent));

  // Switching to the scene the fight is on: the placeable did not exist when
  // the turn changed, so the selection never happened.
  Hooks.on("canvasReady", () => selectActiveCombatant(game.combat));
}
