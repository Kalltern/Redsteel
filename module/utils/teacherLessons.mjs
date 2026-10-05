/**
 * Teacher lessons: the days a character spends with a trainer before the
 * teacher requirement on a rank, a specialisation or a star is met.
 *
 * Rulebook, "Teaching" (Výuka): Učitel 0 takes 4 days, Učitel I 5, Učitel II 6
 * and Učitel III 8. Génius takes 2 days off, Učenost (Studiousness) 1, a Mentor
 * teacher 2, Hvězda Učence (Starsign: Scholar) 1 and Lidská učenlivost
 * (Willingness to learn) 1. Learning always takes at least one day.
 *
 * Each day is a diamond in a small pop-up beside the teacher badge. Ticking the
 * last one grants the teacher exactly as the GM's own click does, and unticking
 * below the total takes it back. Progress is stored per badge under
 * flags.redsteel.teacherLessons, so a half-finished course survives a reload.
 */

const TEMPLATE = "systems/redsteel/templates/actor/teacher-lessons.hbs";

/** Days per teacher tier, index = tier. Above III reads as III. */
const BASE_DAYS = [4, 5, 6, 8];

/** Days a Mentor teacher takes off. */
const MENTOR_DAYS = 2;

/**
 * Owned features and traits that shorten learning. Matched on the item's
 * English name or its localization key, so a renamed copy still counts.
 */
const SPEED_UPS = [
  { name: "Genius", key: "REDSTEEL.Items.Genius.name", days: 2 },
  { name: "Studiousness", key: "REDSTEEL.Items.Studiousness.name", days: 1 },
  { name: "Starsign: Scholar", key: "REDSTEEL.Items.StarsignScholar.name", days: 1 },
  { name: "Willingness to learn", key: "REDSTEEL.Items.WillingnessToLearn.name", days: 1 },
];

const ROMAN = ["0", "I", "II", "III", "IV", "V"];

/** The one pop-up open at a time. */
let current = null;

/** The speed-ups this character owns, each once however many copies it has. */
function ownedSpeedUps(actor) {
  const items = actor?.items?.contents ?? [];
  return SPEED_UPS.filter((entry) =>
    items.some(
      (item) =>
        (item.type === "feature" || item.type === "trait") &&
        (item.name?.toLowerCase() === entry.name.toLowerCase() ||
          item.system?.localizationKey === entry.key),
    ),
  );
}

function readProgress(actor, key) {
  const entry = foundry.utils.getProperty(
    actor,
    `flags.redsteel.teacherLessons.${key}`,
  );
  return {
    done: Math.max(0, Number(entry?.done) || 0),
    mentor: !!entry?.mentor,
  };
}

/** Days this course takes, with every reduction that applies listed. */
export function lessonDays(actor, tier, mentor) {
  const base = BASE_DAYS[Math.min(Math.max(Number(tier) || 0, 0), BASE_DAYS.length - 1)];
  const speedUps = ownedSpeedUps(actor);
  let days = base;
  for (const entry of speedUps) days -= entry.days;
  if (mentor) days -= MENTOR_DAYS;
  return { base, speedUps, required: Math.max(1, days) };
}

async function writeProgress(actor, key, patch) {
  await actor.update({ [`flags.redsteel.teacherLessons.${key}`]: patch });
}

function buildContext(actor, target) {
  const { done, mentor } = readProgress(actor, target.key);
  const { base, speedUps, required } = lessonDays(actor, target.tier, mentor);
  const granted = !!target.isGranted();
  // A teacher the GM granted outright shows a finished course.
  const shown = granted ? Math.max(done, required) : Math.min(done, required);
  const fmt = (days) => game.i18n.format("REDSTEEL.Learn.Lessons.days", { days });
  return {
    title: target.title,
    tier: ROMAN[target.tier] ?? String(target.tier),
    granted,
    progress: game.i18n.format("REDSTEEL.Learn.Lessons.progress", {
      done: Math.min(shown, required),
      required,
    }),
    left: required - Math.min(shown, required),
    leftLabel: game.i18n.format("REDSTEEL.Learn.Lessons.left", {
      left: required - Math.min(shown, required),
    }),
    diamonds: Array.from({ length: required }, (_, i) => ({
      index: i + 1,
      filled: i < shown,
    })),
    baseLabel: fmt(base),
    speedUps: speedUps.map((entry) => ({
      label: game.i18n.localize(entry.key),
      days: `−${fmt(entry.days)}`,
    })),
    mentor,
    mentorDays: `−${fmt(MENTOR_DAYS)}`,
    editable: !!actor.isOwner,
  };
}

async function paint() {
  if (!current) return;
  const { actor, target, el } = current;
  const html = await foundry.applications.handlebars.renderTemplate(
    TEMPLATE,
    buildContext(actor, target),
  );
  if (current?.el !== el) return;
  el.innerHTML = html;
  place();
}

/** Below the badge, inside the viewport. */
function place() {
  if (!current) return;
  const { el, anchor } = current;
  const pad = 8;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  let left = anchor.left + anchor.width / 2 - width / 2;
  let top = anchor.bottom + 6;
  if (top + height > window.innerHeight - pad) top = anchor.top - height - 6;
  left = Math.min(Math.max(pad, left), window.innerWidth - width - pad);
  top = Math.max(pad, top);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

async function onTick(index) {
  if (!current) return;
  const { actor, target } = current;
  const { done, mentor } = readProgress(actor, target.key);
  const { required } = lessonDays(actor, target.tier, mentor);
  const granted = !!target.isGranted();
  const shown = granted ? Math.max(done, required) : Math.min(done, required);
  // Clicking the last filled diamond takes that day back.
  const next = index === shown ? index - 1 : index;
  await writeProgress(actor, target.key, { done: next });
  if (next >= required && !granted) await target.setGranted(true);
  else if (next < required && granted) await target.setGranted(false);
  await paint();
}

async function onMentor(checked) {
  if (!current) return;
  const { actor, target } = current;
  const { done } = readProgress(actor, target.key);
  await writeProgress(actor, target.key, { mentor: !!checked });
  // A Mentor can finish the course on the spot; turning one off never takes
  // a granted teacher away, only unticking a day does.
  const { required } = lessonDays(actor, target.tier, !!checked);
  if (done >= required && !target.isGranted()) await target.setGranted(true);
  await paint();
}

/**
 * Open the lessons pop-up for one teacher badge.
 *
 * @param {Actor} actor
 * @param {object} target
 * @param {string} target.key       flag path under teacherLessons
 * @param {number} target.tier      the teacher tier the book asks for
 * @param {string} target.title     what is being learnt
 * @param {() => boolean} target.isGranted
 * @param {(found: boolean) => Promise<unknown>} target.setGranted
 * @param {HTMLElement} anchorEl    the badge clicked
 * @param {number} zIndex           the Learn screen's own layer
 */
export async function openTeacherLessons(actor, target, anchorEl, zIndex) {
  const sameBadge = current?.actor === actor && current?.target.key === target.key;
  closeTeacherLessons();
  if (sameBadge) return;

  const el = document.createElement("div");
  el.className = "redsteel rs-teacher-lessons";
  if (Number.isFinite(zIndex)) el.style.setProperty("z-index", String(zIndex), "important");
  document.body.append(el);

  const onClick = (event) => {
    const tick = event.target.closest("[data-lesson-tick]");
    if (tick && current?.el === el && actor.isOwner) {
      event.preventDefault();
      onTick(Number(tick.dataset.lessonTick));
      return;
    }
    if (event.target.closest("[data-lesson-close]")) closeTeacherLessons();
  };
  const onChange = (event) => {
    if (event.target.matches("[data-lesson-mentor]") && actor.isOwner) {
      onMentor(event.target.checked);
    }
  };
  const onOutside = (event) => {
    if (!el.contains(event.target)) closeTeacherLessons();
  };
  const onKey = (event) => {
    if (event.key === "Escape") closeTeacherLessons();
  };
  el.addEventListener("click", onClick);
  el.addEventListener("change", onChange);
  // Deferred so the click that opened the pop-up does not close it again.
  setTimeout(() => {
    if (current?.el !== el) return;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey);
  }, 0);

  // Another player or the GM ticking a day repaints this one too.
  const hookId = Hooks.on("updateActor", (doc) => {
    if (doc?.id === actor.id) paint();
  });

  current = {
    actor,
    target,
    el,
    anchor: anchorEl.getBoundingClientRect(),
    cleanup: () => {
      Hooks.off("updateActor", hookId);
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey);
      el.remove();
    },
  };
  await paint();
}

export function closeTeacherLessons() {
  const open = current;
  current = null;
  open?.cleanup();
}
