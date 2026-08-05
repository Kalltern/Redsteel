/**
 * Canvas zoom-out extension.
 *
 * Foundry clamps how far the canvas can zoom out: the floor is the scale at
 * which the padded scene still fills the viewport, so it varies per scene and
 * per window size. `CONFIG.Canvas.minZoom` is documented as an override for it
 * but is not honoured on this V14 build (verified in-world: the property held
 * its value, and the wheel still stopped dead at the computed floor).
 *
 * `Canvas#_constrainView` is what the wheel actually calls, and it is the
 * documented method that turns a requested camera position into an allowed one.
 * Wrapping it lets us relax the floor for every zoom path at once — wheel, pan,
 * animatePan — without touching the wheel handler itself.
 *
 * The wrapper is self-calibrating: whenever core hands back a scale *higher*
 * than the one requested, that returned value is by definition the natural
 * floor, so we simply divide it down. No probing, no re-deriving Foundry's
 * arithmetic.
 */

const SETTING = "extraZoomOut";

/** Absolute safety floor, so a silly setting can't zoom out to nothing. */
const HARD_FLOOR = 0.005;

/** How much wider than core allows, as a multiplier. Refreshed on change. */
let factor = 1;

/** Guard so a hot reload can't wrap the wrapper. */
let patched = false;

/**
 * Convert the stored percentage into the multiplier used by the wrapper.
 */
function refreshFactor() {
  const extra = Number(game.settings.get("redsteel", SETTING));
  factor = Number.isFinite(extra) && extra > 0 ? 1 + extra / 100 : 1;
}

/**
 * Wrap Canvas#_constrainView so the zoom-out floor is `factor` times looser.
 */
function patchConstrainView() {
  if (patched) return;
  const proto = foundry.canvas.Canvas.prototype;
  const original = proto._constrainView;
  if (typeof original !== "function") {
    console.warn("Redsteel | Canvas#_constrainView missing, zoom-out unchanged");
    return;
  }

  proto._constrainView = function (position) {
    const constrained = original.call(this, position);

    // A pure pan (right-click drag) asks for x/y only. Without a requested
    // scale we would fall through and hand back core's clamped floor, which
    // then gets applied and snaps the view back in. Treat "no scale asked for"
    // as "keep the one we are already at".
    const asked = position?.scale;
    const wanted = Number.isFinite(asked) ? asked : this.stage?.scale?.x;

    // Core only ever hands back a *larger* scale than requested when it is
    // enforcing the zoom-out floor; a too-large request gets clamped downwards
    // by maxZoom instead. So this branch is the zoom-out floor and nothing else.
    if (factor > 1 && Number.isFinite(wanted) && wanted < constrained.scale) {
      const floor = Math.max(constrained.scale / factor, HARD_FLOOR);
      constrained.scale = Math.max(wanted, floor);
    }
    return constrained;
  };

  patched = true;
}

/**
 * Register the client setting and install the canvas patch.
 * Call from the `init` hook.
 */
export function registerCanvasZoom() {
  game.settings.register("redsteel", SETTING, {
    config: true,
    scope: "client", // depends on the player's own screen
    name: "REDSTEEL.Config.ZoomOut.name",
    hint: "REDSTEEL.Config.ZoomOut.label",
    type: Number,
    default: 300,
    range: { min: 0, max: 900, step: 10 },
    onChange: () => refreshFactor(),
  });

  refreshFactor();
  patchConstrainView();
}
