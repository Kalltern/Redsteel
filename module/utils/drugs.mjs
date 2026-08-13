/**
 * Drugs and addiction (Drogy a Závislost).
 *
 * A drug is an ordinary `option: "potion"` consumable — it is drunk through the
 * same picker, pays the same Toxicity and rolls the same Drinking Test — that
 * additionally carries `flags.redsteel.drug`. That flag is what turns it into a
 * drug, and it is the only thing this module reads off the item:
 *
 *   key                Addiction id. Also the value remembered in the actor's
 *                      `flags.redsteel.curedAddictions` once they kick it.
 *   combat             true for a "bojová droga". See the split below.
 *   attribute          Attribute Tested to resist addiction ("wil" / "end").
 *   difficulty         Signed modifier on that Test (−30 = Velmi těžká).
 *   relapseDifficulty  Used instead of `difficulty` once this actor has already
 *                      been cured of this addiction once. Falling back into a
 *                      habit you broke is harder to resist than picking it up
 *                      the first time.
 *   insanityChance     Percent chance the dose burns off one point of Madness.
 *   addictionEffect    Effect-definition id applied when the Test fails.
 *
 * The rules split (rules journal, "Drogy"): a recreational drug is only
 * addictive in the moment it does what it is taken for, so the Test happens
 * *only* when a point of Madness actually came off. A combat drug — defined in
 * the rules as one whose addiction is resisted with Endurance rather than Will
 * — is Tested on every single use, Madness or no Madness.
 *
 * Everything downstream of becoming addicted (the abstinence clock, the
 * withdrawal effect, the multi-Test cure over days) is GM-driven: those run on
 * calendar time, not on rounds, so they are applied and removed by hand from
 * the effect definitions. The one piece that is not manual is the *record* of a
 * cure — see registerDrugHooks below.
 */

/** Actor flag listing addiction keys this actor has already been cured of. */
const CURED_FLAG = "curedAddictions";

/**
 * Naming convention: every addiction effect definition is `addiction_<key>`,
 * where `<key>` matches the drug flag's `key`. The cure hook derives one from
 * the other rather than needing a flag on the effect — applyEffect rewrites
 * `flags.redsteel` wholesale when it creates the document, so a definition
 * cannot smuggle custom flags onto the applied effect.
 */
const ADDICTION_PREFIX = "addiction_";

/**
 * Addiction keys this actor has been cured of. Tolerates both array and
 * object-map storage, the same way readCasterEffects does — Foundry hands a
 * flag back as an object once it has been through a merged update.
 *
 * @param {Actor} actor
 * @returns {string[]}
 */
function curedAddictions(actor) {
  const raw = actor?.getFlag?.("redsteel", CURED_FLAG);
  if (Array.isArray(raw)) return raw;
  return raw ? Object.values(raw) : [];
}

/**
 * Resolve a drug's Madness relief and its addiction Test.
 *
 * Called from usePotion after the potion's own effects have landed and before
 * the dose is consumed. Returns a chat fragment in the same style as the rest
 * of the potion card ("" when the item is not a drug).
 *
 * @param {Actor} actor       The taker.
 * @param {Item}  consumable  The drug being taken.
 * @returns {Promise<string>} HTML summary fragment.
 */
export async function resolveDrug(actor, consumable) {
  const drug = consumable?.getFlag?.("redsteel", "drug");
  if (!drug?.key) return "";

  let out = "";

  // ---------------------------------------------------------------- Madness
  // The dose only counts as "relief" when there was a point to lose: rolling
  // under the chance with a clear head is not what makes the drug addictive.
  let relieved = false;
  const chance = Number(drug.insanityChance) || 0;
  if (chance > 0) {
    const held = Number(actor.system.stats?.insanity?.value) || 0;
    const roll = await new Roll("1d100").evaluate();
    // System-wide percentage convention: a chance of N succeeds on 1..N
    // (see resolveBleedStacks in applyDamage.mjs), so 100% is guaranteed.
    const success = roll.total <= chance;
    relieved = success && held > 0;

    if (relieved) {
      await actor.update({ "system.stats.insanity.value": held - 1 });
    }

    const verdict = !success
      ? "FAILED"
      : held > 0
        ? "SUCCESS (-1 Madness)"
        : "SUCCESS (no Madness to lose)";
    out += `<p><b>Madness:</b> ${roll.total} / ${chance}% ${verdict}</p>`;
  }

  // -------------------------------------------------------------- Addiction
  if (!drug.combat && !relieved) return out;

  // Already hooked — there is nothing left to resist. Resolved the same way
  // applyEffect looks an effect up, by the status its document carries.
  const addictionId = drug.addictionEffect ?? `${ADDICTION_PREFIX}${drug.key}`;
  if (actor.effects.find((e) => e.statuses?.has(addictionId))) {
    out += `<p><b>Addiction:</b> already addicted.</p>`;
    return out;
  }

  const attrKey = drug.attribute || "wil";
  // `mod` is the success chance the sheet itself rolls against (15 +
  // attribute×10 + globalMod), the same number promptAttributeFollowup uses —
  // reading the raw value here would drop every modifier the actor has.
  const rating = Number(actor.system.attributes?.[attrKey]?.mod) || 0;

  const relapsing = curedAddictions(actor).includes(drug.key);
  const modifier =
    Number(relapsing ? drug.relapseDifficulty : drug.difficulty) || 0;

  const roll = await new Roll(`${rating} + ${modifier} - 1d100`).evaluate();
  const resisted = roll.total >= 0;

  const label = attrKey === "end" ? "Endurance" : "Will";
  const note = relapsing ? " (relapse)" : "";
  out += `<p><b>Addiction ${label} Test${note}:</b> ${rating}${modifier >= 0 ? "+" : ""}${modifier}% → ${roll.total >= 0 ? "+" : ""}${roll.total} ${resisted ? "RESISTED" : "ADDICTED"}</p>`;

  if (!resisted) {
    await game.redsteel.applyEffect(actor, addictionId);
  }

  return out;
}

/**
 * Remember that an actor has been cured of an addiction.
 *
 * Removing the addiction effect IS the cure — the six-to-twelve successful
 * Tests that earn it are counted at the table, and the GM deletes the effect
 * when they are in. Recording it here is what makes `relapseDifficulty` mean
 * something later, and it costs nothing at the table.
 *
 * Runs on the active GM only: every connected client sees the deletion, and
 * the flag would otherwise be written several times over.
 */
export function registerDrugHooks() {
  Hooks.on("deleteActiveEffect", async (effect) => {
    const actor = effect.parent;
    if (!(actor instanceof Actor)) return;
    if (game.users.activeGM?.id !== game.user.id) return;

    const statusId = [...(effect.statuses ?? [])].find((s) =>
      s.startsWith(ADDICTION_PREFIX),
    );
    if (!statusId) return;

    const key = statusId.slice(ADDICTION_PREFIX.length);
    const cured = curedAddictions(actor);
    if (cured.includes(key)) return;

    await actor.setFlag("redsteel", CURED_FLAG, [...cured, key]);
  });
}
