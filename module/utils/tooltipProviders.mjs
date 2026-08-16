/**
 * Content providers for the stacked tooltip system.
 *
 * Each provider turns a `data-tt-kind` / `data-tt-id` pair into tooltip HTML.
 * Anything they emit gets keyword-linkified automatically, and any element
 * they emit carrying `data-tt-kind` becomes a link to the next tooltip.
 */

import { registerTooltip, ttFrame, ttEscape } from "./tooltips.mjs";
import { TOOLTIP_KEYWORDS } from "./tooltipKeywords.mjs";
import { ruleNoteFooter } from "./tooltipJournals.mjs";
import { buildSpellCard, renderInspectorCard } from "./spellCards.mjs";
import { REDSTEEL } from "../helpers/config.mjs";
import { effectiveCombatRating } from "./testRating.mjs";

/* -------------------------------------------- */
/*  Shared rendering                            */
/* -------------------------------------------- */

function statsBlock(stats = []) {
  const rows = stats
    .filter((s) => s.value !== undefined && s.value !== null && s.value !== "")
    .map(
      (s) =>
        `<div class="tt-stat"><span class="tt-stat-label">${ttEscape(s.label)}</span><span class="tt-stat-value">${ttEscape(s.value)}</span></div>`,
    );
  return rows.length ? `<div class="tt-stats">${rows.join("")}</div>` : "";
}

function sectionsBlock(sections = []) {
  return sections
    .filter((s) => s.lines?.length)
    .map(
      (s) =>
        `<div class="tt-section"><div class="tt-section-label">${ttEscape(s.label)}</div><div class="tt-section-lines">${s.lines.join("<br>")}</div></div>`,
    )
    .join("");
}

/* -------------------------------------------- */
/*  item                                        */
/* -------------------------------------------- */

/**
 * Resolve an item from either an explicit uuid or an id plus the owning actor.
 * Falls back to the world item collection so compendium-free chat cards work.
 */
function resolveItem({ id, dataset, actor }) {
  if (dataset.ttUuid) {
    try {
      const doc = fromUuidSync(dataset.ttUuid);
      if (doc) return doc;
    } catch (err) {
      /* fall through to id lookup */
    }
  }
  if (!id) return null;
  return actor?.items?.get(id) ?? game.items?.get(id) ?? null;
}

registerTooltip("item", (ctx) => {
  const item = resolveItem(ctx);
  if (!item) return null;

  const data = item.getTooltipData?.() ?? {};
  const body = [
    statsBlock(data.stats),
    sectionsBlock(data.sections),
    data.description ? `<div class="tt-desc">${data.description}</div>` : "",
  ].join("");

  return ttFrame({
    title: data.title ?? item.name,
    img: data.icon ?? data.img ?? item.img,
    subtitle: data.subtitle ?? null,
    body,
  });
});

/* -------------------------------------------- */
/*  effect                                      */
/* -------------------------------------------- */

registerTooltip("effect", (ctx) => {
  const { id, dataset, actor } = ctx;
  let effect = null;
  if (dataset.ttUuid) {
    try {
      effect = fromUuidSync(dataset.ttUuid);
    } catch (err) {
      effect = null;
    }
  }
  if (!effect && id) {
    effect = actor?.effects?.get(id) ?? null;
    // Effects transferred from items live on the item, not the actor collection.
    if (!effect && actor) {
      for (const item of actor.items ?? []) {
        const hit = item.effects?.get(id);
        if (hit) {
          effect = hit;
          break;
        }
      }
    }
  }
  if (!effect) return null;

  const stats = [];
  if (effect.duration?.label) {
    stats.push({
      label: game.i18n.localize("EFFECT.TabDuration"),
      value: effect.duration.label,
    });
  }
  if (effect.sourceName) {
    stats.push({
      label: game.i18n.localize("REDSTEEL.Effect.Source"),
      value: effect.sourceName,
    });
  }
  if (effect.disabled) {
    stats.push({
      label: game.i18n.localize("REDSTEEL.Effect.Toggle"),
      value: game.i18n.localize("EFFECT.Disabled") || "—",
    });
  }

  // Each change is shown as a raw stat line; these are GM-facing details.
  const changes = (effect.changes ?? []).map(
    (c) => `${ttEscape(c.key)} ${ttEscape(modeSymbol(c.mode))} ${ttEscape(c.value)}`,
  );

  const body = [
    statsBlock(stats),
    changes.length
      ? sectionsBlock([
          { label: game.i18n.localize("EFFECT.Changes") || "Changes", lines: changes },
        ])
      : "",
    effect.description ? `<div class="tt-desc">${effect.description}</div>` : "",
  ].join("");

  return ttFrame({ title: effect.name, img: effect.img, body });
});

function modeSymbol(mode) {
  const M = CONST.ACTIVE_EFFECT_MODES;
  switch (mode) {
    case M.ADD:
      return "+";
    case M.MULTIPLY:
      return "×";
    case M.OVERRIDE:
      return "=";
    case M.UPGRADE:
      return "↑";
    case M.DOWNGRADE:
      return "↓";
    default:
      return ":";
  }
}

/* -------------------------------------------- */
/*  keyword                                     */
/* -------------------------------------------- */

registerTooltip("keyword", ({ id }) => {
  const def = TOOLTIP_KEYWORDS[id];
  if (!def) return null;

  const title = game.i18n.localize(def.labelKey);
  const desc = game.i18n.localize(def.descKey);
  // An unlocalized key means the glossary entry has no lang text yet.
  if (desc === def.descKey) return null;

  return ttFrame({
    title: title === def.labelKey ? id : title,
    body: `<div class="tt-desc">${desc}</div>`,
    footer: ruleNoteFooter(def.note),
  });
});

/* -------------------------------------------- */
/*  text — plain localized string, no lookup    */
/* -------------------------------------------- */

registerTooltip("text", ({ dataset }) => {
  const raw = dataset.ttText;
  if (!raw) return null;
  const text = game.i18n.localize(raw);
  const title = dataset.ttTitle ? game.i18n.localize(dataset.ttTitle) : null;
  return title
    ? ttFrame({ title, body: `<div class="tt-desc">${ttEscape(text)}</div>` })
    : `<div class="tt-desc">${ttEscape(text)}</div>`;
});

/* -------------------------------------------- */
/*  Shared localization helper                  */
/* -------------------------------------------- */

/**
 * Localize `key`, or return null when the lang files carry no entry for it
 * (Foundry hands back the key itself in that case).
 * @param {string} key
 * @returns {string|null}
 */
function localizeOrNull(key) {
  if (!key) return null;
  const text = game.i18n.localize(key);
  return text === key ? null : text;
}

/** The glossary description for a keyword id, or null when it has no lang text. */
function keywordDesc(keywordId) {
  const def = TOOLTIP_KEYWORDS[keywordId];
  return def ? localizeOrNull(def.descKey) : null;
}

/* -------------------------------------------- */
/*  spellCard — spells / miracles / abilities   */
/* -------------------------------------------- */

/**
 * The card grid on the Spells / Miracles / Abilities tabs. Reuses the very
 * same view-model and renderer the old floating inspector used, so the panel
 * a player sees on hover is unchanged; only the delivery moved.
 */
registerTooltip("spellCard", (ctx) => {
  const item = resolveItem(ctx);
  if (!item) return null;
  const kind = ctx.dataset.cardKind || "spell";
  return renderInspectorCard(buildSpellCard(item, kind));
});

/* -------------------------------------------- */
/*  skill                                       */
/* -------------------------------------------- */

/**
 * Where a skill key may live under `actor.system`, in lookup order, with the
 * lang key pattern each group uses for its labels.
 */
const SKILL_GROUPS = [
  { path: "skills", lang: "skills" },
  { path: "combatSkills", lang: "combatSkills" },
  { path: "weaponSkills", lang: "weaponSkills" },
  { path: "doctrines", lang: "doctrines" },
  { path: "schools", lang: "schools" },
];

/**
 * Sub-skills are plain numbers stored on their parent skill (athletics.swimming,
 * acting.blend), not skill objects, so they need their parent for rank and
 * governing attribute.
 */
const SUB_SKILLS = {
  swimming: { parent: "athletics" },
  blend: { parent: "acting" },
};

/** Attribute label for a skill's `id`, which indexes system.attributes. */
function attributeLabelFor(system, index) {
  if (!Number.isInteger(index)) return null;
  const key = Object.keys(system.attributes ?? {})[index];
  if (!key) return null;
  const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
  return (
    localizeOrNull(`REDSTEEL.Actor.Character.Attribute.${capitalized}.long`) ?? key
  );
}

registerTooltip("skill", ({ id, actor }) => {
  if (!id || !actor?.system) return null;
  const system = actor.system;

  const rankLabel = game.i18n.localize("REDSTEEL.UI.rank");
  const ratingLabel = game.i18n.localize("REDSTEEL.Tooltip.rating");
  const attributeLabel = game.i18n.localize("REDSTEEL.Tooltip.attribute");

  // Sub-skill: its own rating number, its parent's rank and attribute.
  const sub = SUB_SKILLS[id];
  if (sub) {
    const parent = system.skills?.[sub.parent];
    if (!parent) return null;
    const title =
      localizeOrNull(`REDSTEEL.Actor.Character.skills.${id}.label`) ?? id;
    const stats = [
      { label: ratingLabel, value: parent[id] },
      { label: rankLabel, value: parent.value },
    ];
    if (parent.type !== 2) {
      const attr = attributeLabelFor(system, parent.id);
      if (attr) stats.push({ label: attributeLabel, value: attr });
    }
    return ttFrame({ title, body: statsBlock(stats) });
  }

  for (const group of SKILL_GROUPS) {
    const skill = system[group.path]?.[id];
    if (!skill || typeof skill !== "object") continue;

    const title =
      localizeOrNull(`REDSTEEL.Actor.Character.${group.lang}.${id}.label`) ?? id;

    const stats = [
      {
        label: ratingLabel,
        value:
          group.path === "combatSkills"
            ? effectiveCombatRating(skill, id)
            : skill.rating,
      },
      { label: rankLabel, value: skill.value },
    ];
    // How much of that rating the weapon in hand is responsible for (its attack
    // value, quality, the doctrine it unlocks, a specialisation, the off hand).
    const weaponAttack = Number(skill.weaponAttack) || 0;
    if (weaponAttack) {
      // statsBlock escapes for us — no ttEscape here or the weapon name comes
      // out double-escaped.
      const source = skill.weaponAttackSource
        ? ` (${skill.weaponAttackSource})`
        : "";
      stats.push({
        label: game.i18n.localize("REDSTEEL.Tooltip.weaponAttack"),
        value: `${weaponAttack > 0 ? "+" : ""}${weaponAttack}${source}`,
      });
    }
    if (group.path === "schools") {
      stats.push({
        label: game.i18n.localize(
          "REDSTEEL.Actor.Character.schools.spellPower.label",
        ),
        value: skill.spellPower,
      });
    }
    // Skill type 2 (muscles, nimbleness) derives purely from its rank, so it
    // has no governing attribute to show.
    if (group.path === "skills" && skill.type !== 2) {
      const attr = attributeLabelFor(system, skill.id);
      if (attr) stats.push({ label: attributeLabel, value: attr });
    }

    return ttFrame({ title, body: statsBlock(stats) });
  }

  return null;
});

/* -------------------------------------------- */
/*  attribute — the seven primary attributes    */
/* -------------------------------------------- */

/** `id` with its first letter upper-cased, the casing the lang files use. */
function capitalize(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * The primary attribute boxes in the character header.
 *
 * The box the player is hovering already prints the total and the modifier, so
 * the tooltip deliberately carries no numbers: only the plain-language
 * description and the link out to the Attributes note. Nothing to say means no
 * tooltip at all, rather than an empty frame.
 */
registerTooltip("attribute", ({ id, actor }) => {
  if (!id || !actor?.system?.attributes?.[id]) return null;

  const desc = localizeOrNull(`REDSTEEL.StatInfo.${id}`);
  if (!desc) return null;

  return ttFrame({
    title:
      localizeOrNull(
        `REDSTEEL.Actor.Character.Attribute.${capitalize(id)}.long`,
      ) ?? id,
    body: `<div class="tt-desc">${desc}</div>`,
    footer: ruleNoteFooter("attributes"),
  });
});

/* -------------------------------------------- */
/*  secondaryAttribute — speed, luck, faith, …  */
/* -------------------------------------------- */

/**
 * Same deal as `attribute`, one level down. NPC-only keys have no
 * SecondaryAttribute lang entry, so their label comes from the NPC field list.
 */
registerTooltip("secondaryAttribute", ({ id, actor }) => {
  if (!id || !actor?.system?.secondaryAttributes?.[id]) return null;

  const desc = localizeOrNull(`REDSTEEL.StatInfo.${id}`);
  if (!desc) return null;

  return ttFrame({
    title:
      localizeOrNull(
        `REDSTEEL.Actor.Character.SecondaryAttribute.${capitalize(id)}.long`,
      ) ??
      localizeOrNull(`REDSTEEL.Actor.NPC.FIELDS.${id}.label`) ??
      id,
    body: `<div class="tt-desc">${desc}</div>`,
    footer: ruleNoteFooter("attributes"),
  });
});

/* -------------------------------------------- */
/*  stat — header resource bars + condition     */
/* -------------------------------------------- */

/**
 * The resource bars and the condition boxes in the header.
 *
 * `stat` / `read` record where the number on screen comes from; the tooltip
 * itself no longer prints it, because the very box being hovered already does.
 * `keyword` reuses an existing glossary description instead of duplicating the
 * Czech text, `note` names the rules note to link out to, and `extraRows` is
 * for the rare number the header has no room for.
 */
const HEADER_STATS = {
  health: {
    labelKey: "REDSTEEL.Actor.Character.stats.health.value.label",
    stat: "health",
    note: "vitals",
  },
  stamina: {
    labelKey: "REDSTEEL.Actor.Character.stats.stamina.value.label",
    stat: "stamina",
    note: "vitals",
  },
  toxicity: {
    labelKey: "REDSTEEL.Actor.Character.stats.toxicity.value.label",
    stat: "toxicity",
    note: "vitals",
  },
  mana: {
    labelKey: "REDSTEEL.Actor.Character.stats.mana.value.label",
    stat: "mana",
    note: "vitals",
  },
  holyEnergy: {
    labelKey: "REDSTEEL.Actor.Character.stats.holyEnergy.value.label",
    stat: "holyEnergy",
    note: "vitals",
  },
  bloodPool: {
    labelKey: "REDSTEEL.Actor.Character.stats.bloodPool.value.label",
    stat: "bloodPool",
    note: "channeling",
    // Transfer is the one blood-pool number the bar has nowhere to print.
    extraRows: (system) => [
      {
        label: game.i18n.localize(
          "REDSTEEL.Actor.Character.stats.bloodPool.transfer.label",
        ),
        value: system.stats?.bloodPool?.transfer,
      },
    ],
  },
  graveWounds: {
    labelKey: "REDSTEEL.Actor.Character.stats.graveWounds.value.label",
    stat: "graveWounds",
    keyword: "graveWound",
    note: "vitals",
  },
  mind: {
    labelKey: "REDSTEEL.Actor.Character.stats.mind.value.label",
    stat: "mind",
    note: "vitals",
  },
  insanity: {
    labelKey: "REDSTEEL.Actor.Character.stats.insanity.value.label",
    stat: "insanity",
    note: "madness",
  },
  corruption: {
    labelKey: "REDSTEEL.Actor.Character.stats.corruption.value.label",
    stat: "corruption",
    keyword: "corruption",
    note: "corruption",
  },
  fatigue: {
    labelKey: "REDSTEEL.Actor.Character.stats.fatigue.value.label",
    stat: "fatigue",
    keyword: "fatigue",
    note: "fatigue",
  },
  armor: {
    labelKey: "REDSTEEL.Actor.Character.Condition.armor",
    read: (system) => system.armor?.total,
    note: "damageTypes",
  },
  detection: {
    labelKey: "REDSTEEL.Actor.Character.Condition.detection",
    read: (system) => system.detection,
    note: "traps",
  },
};

registerTooltip("stat", ({ id, actor }) => {
  const def = HEADER_STATS[id];
  if (!def || !actor?.system) return null;
  const system = actor.system;

  // A dedicated StatInfo string wins; otherwise fall back to the glossary text
  // the keyword tooltip already uses, so the Czech is written down once.
  const desc =
    localizeOrNull(`REDSTEEL.StatInfo.${id}`) ??
    (def.keyword ? keywordDesc(def.keyword) : null);
  const extra = statsBlock(def.extraRows?.(system) ?? []);

  // Title plus a bare link is not worth a frame.
  if (!desc && !extra) return null;

  const body = [extra, desc ? `<div class="tt-desc">${desc}</div>` : ""].join("");

  return ttFrame({
    title: localizeOrNull(def.labelKey) ?? id,
    body,
    footer: ruleNoteFooter(def.note),
  });
});

/* -------------------------------------------- */
/*  weaponField — weapon sheet fields           */
/* -------------------------------------------- */

/**
 * The editable fields of the weapon item sheet.
 *
 * `labelKey` is the same string the sheet prints above the field, so the panel
 * is unmistakably about the thing being hovered, and `note` names the rules
 * note to link out to. The description is not stored here: it always lives at
 * `REDSTEEL.WeaponInfo.<id>`, one entry per id, written down once per language.
 */
const WEAPON_FIELDS = {
  attack: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.attack.label", note: "armoryRules" },
  defense: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.defense.label", note: "armoryRules" },
  dodge: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.dodge.label", note: "armoryRules" },
  critRange: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.critRange.label", note: "criticalHits" },
  critChance: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.critChance.label", note: "criticalHits" },
  critFail: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.critFail.label", note: "criticals" },
  critDefense: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.critDefense.label", note: "armoryRules" },
  critDodge: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.critDodge.label", note: "armoryRules" },
  critPenetration: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.critPenetration.label", note: "criticalHits" },
  critDamage: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.critDamage.label", note: "criticalHits" },
  penetration: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.penetration.label", note: "armoryRules" },
  breakthrough: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.breakthrough.label", note: "armoryRules" },
  sneakDamage: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.sneakDamage.label", note: "specialActions" },
  tags: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.tags.label", note: "armoryRules" },
  finesse: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.finesse.label", note: "armoryRules" },
  twoHandGrip: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.twoHandGrip.label", note: "armoryRules" },
  longReach: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.longReach.label", note: "armoryRules" },
  sharp: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.sharp.label", note: "armoryRules" },
  thrown: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.thrown.label", note: "armoryRules" },
  offhand: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.offhand.label", note: "armoryRules" },
  stagger: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.stagger.label", note: "effects" },
  bleed: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.bleed.label", note: "medicine" },
  diceNum: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.diceNum.label", note: "armoryRules" },
  dieSize: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.dieSize.label", note: "armoryRules" },
  rollMod: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.rollMod.label", note: "weaponMaterials" },
  quality: { labelKey: "REDSTEEL.Item.Weapon.FIELDS.quality.label", note: "weaponQuality" },
  weaponClass: { labelKey: "REDSTEEL.UI.weaponClass", note: "armoryRules" },
  weaponType: { labelKey: "REDSTEEL.UI.weaponType", note: "armoryRules" },
  dmgType: { labelKey: "REDSTEEL.Item.Spell.FIELDS.headerType.label", note: "damageTypes" },
};

/**
 * The fields of the weapon item sheet, hovered on their label.
 *
 * Like the header stats, this reads no values and takes no actor: the field's
 * own input sits right beside the label and already shows the number, so the
 * panel only explains what the field does and where the rule is written down.
 * Nothing to say means no tooltip at all, rather than an empty frame.
 */
registerTooltip("weaponField", ({ id }) => {
  const def = WEAPON_FIELDS[id];
  if (!def) return null;

  const desc = localizeOrNull(`REDSTEEL.WeaponInfo.${id}`);
  if (!desc) return null;

  return ttFrame({
    title: localizeOrNull(def.labelKey) ?? id,
    body: `<div class="tt-desc">${desc}</div>`,
    footer: ruleNoteFooter(def.note),
  });
});

/* -------------------------------------------- */
/*  specNode — specialisation tree nodes        */
/* -------------------------------------------- */

registerTooltip("specNode", ({ id, dataset }) => {
  const specId = dataset.ttSpec;
  const node = REDSTEEL.specialisations?.[specId]?.nodes?.[id];
  if (!node) return null;

  const title = localizeOrNull(node.label) ?? id;
  const desc = localizeOrNull(node.description);
  const specLabel = localizeOrNull(
    REDSTEEL.specialisations[specId]?.label ?? "",
  );

  return ttFrame({
    title,
    img: node.icon || null,
    subtitle: specLabel,
    body: desc ? `<div class="tt-desc">${desc}</div>` : "",
  });
});

export function registerCoreTooltipProviders() {
  // Import side effects do the registration; this exists so redsteel.mjs has
  // an explicit, greppable call site.
}
