// Fixed bilingual sentence templates for "coordinate changes" entries (English first).
// {dim} comes from dictionary keys dimension.<id>; built-in names are used until dictionaries exist.

export const POINT_FIELDS = ["name", "dimension", "tags", "x", "y", "z", "note"];
export const SPAWN_FIELDS = ["x", "y", "z"];

const FALLBACK_DIMENSION_NAMES = {
  overworld: { en: "Overworld", "zh-TW": "主世界" },
  the_nether: { en: "The Nether", "zh-TW": "地獄" },
  the_end: { en: "The End", "zh-TW": "終界" },
};

const FIELD_LABELS = {
  name: { en: "name", "zh-TW": "名稱" },
  dimension: { en: "dimension", "zh-TW": "維度" },
  tags: { en: "tags", "zh-TW": "標籤" },
  coordinates: { en: "coordinates", "zh-TW": "座標" },
  note: { en: "note", "zh-TW": "說明" },
};

/** Dimension display name from dictionaries ({ en, "zh-TW" } i18n files) or the built-in fallback. */
export function dimensionName(dimension, lang, dictionaries = null) {
  return (
    dictionaries?.[lang]?.messages?.[`dimension.${dimension}`] ?? FALLBACK_DIMENSION_NAMES[dimension]?.[lang] ?? dimension
  );
}

/** Orders changed fields canonically: name, dimension, tags, x, y, z, note. */
export function sortChangedFields(fields) {
  return POINT_FIELDS.filter((f) => fields.includes(f));
}

function fieldsText(changedFields, lang) {
  const labels = [];
  for (const field of sortChangedFields(changedFields)) {
    const key = ["x", "y", "z"].includes(field) ? "coordinates" : field;
    const label = FIELD_LABELS[key][lang];
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.join(lang === "en" ? ", " : "、");
}

function pointSummary(action, name, changedFields) {
  switch (action) {
    case "add":
      return { en: `Added point: ${name}`, "zh-TW": `新增座標：${name}` };
    case "edit":
      return {
        en: `Updated point: ${name} (${fieldsText(changedFields, "en")})`,
        "zh-TW": `修改座標：${name}（${fieldsText(changedFields, "zh-TW")}）`,
      };
    case "delete":
      return { en: `Removed point: ${name}`, "zh-TW": `刪除座標：${name}` };
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Builds a point change entry. target is the snapshot: after the change for add/edit, before it for delete.
 * @param {{ id, date, action, target: { worldId, id, dimension, name }, changedFields?, worldName, source, dictionaries? }} p
 */
export function buildPointChangeEntry({ id, date, action, target, changedFields, worldName, source, dictionaries = null }) {
  const entry = {
    id,
    date,
    action,
    target: { type: "point", worldId: target.worldId, id: target.id, dimension: target.dimension, name: target.name },
  };
  if (action === "edit") entry.changedFields = sortChangedFields(changedFields);
  entry.summary = pointSummary(action, target.name, changedFields ?? []);
  entry.scope = {
    en: `Point data: ${worldName} / ${dimensionName(target.dimension, "en", dictionaries)}`,
    "zh-TW": `座標資料：${worldName}／${dimensionName(target.dimension, "zh-TW", dictionaries)}`,
  };
  entry.source = source;
  return entry;
}

/** Builds a world spawn change entry (always action edit, dimension fixed to the overworld). */
export function buildSpawnChangeEntry({ id, date, worldId, changedFields, worldName, source, dictionaries = null }) {
  return {
    id,
    date,
    action: "edit",
    target: { type: "spawn", worldId },
    changedFields: SPAWN_FIELDS.filter((f) => changedFields.includes(f)),
    summary: { en: `Updated world spawn: ${worldName}`, "zh-TW": `修改世界出生座標：${worldName}` },
    scope: {
      en: `World spawn: ${worldName} / ${dimensionName("overworld", "en", dictionaries)}`,
      "zh-TW": `世界出生座標：${worldName}／${dimensionName("overworld", "zh-TW", dictionaries)}`,
    },
    source,
  };
}
