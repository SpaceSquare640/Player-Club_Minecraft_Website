// Search, filter and sort helpers for points and change log entries.
// Shared pure functions: no DOM and no browser globals. Inputs are never mutated.

import { parseId } from "./ids.js";

/** Search normalisation: NFKC, lower case, whitespace collapsed and trimmed. */
export function normalizeSearch(text) {
  if (typeof text !== "string") return "";
  return text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

/** Map of tag id to tag; accepts a Map (returned as is) or the tags array from tags.json. */
export function indexTags(tags) {
  if (tags instanceof Map) return tags;
  return new Map((tags ?? []).map((tag) => [tag.id, tag]));
}

function searchFields(point, tagsById) {
  const fields = [point.id, point.name, point.note, point.submittedBy];
  for (const tagId of point.tags ?? []) {
    const name = tagsById.get(tagId)?.name;
    if (name) fields.push(name.en, name["zh-TW"]);
  }
  return fields.filter((field) => typeof field === "string").map(normalizeSearch);
}

/**
 * True when a point matches the criteria.
 * - query: normalised and split on whitespace; every word must appear in the id, name, note,
 *   either tag name (en / zh-TW) or submittedBy.
 * - tagIds: OR across the selected tags; combined with the query by AND.
 * - dimension (optional): the point must be in that dimension.
 * The pinned spawn card is not a point and never goes through this function.
 * @param {object} point
 * @param {{ query?: string, tagIds?: string[], dimension?: string | null }} [criteria]
 * @param {Map<string, object> | object[]} [tags]
 */
export function matchPoint(point, criteria = {}, tags = new Map()) {
  const { query = "", tagIds = [], dimension = null } = criteria;
  if (dimension && point.dimension !== dimension) return false;
  if (tagIds.length > 0 && !(point.tags ?? []).some((id) => tagIds.includes(id))) return false;
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const fields = searchFields(point, indexTags(tags));
  return words.every((word) => fields.some((field) => field.includes(word)));
}

const compareDesc = (a, b) => (a === b ? 0 : a < b ? 1 : -1);
const idNumber = (id) => parseId(id)?.n ?? -1;

/** Display order of points: createdAt descending, then id descending (numeric, so p10000 > p9999). */
export function sortPoints(points) {
  return [...points].sort((a, b) => compareDesc(a.createdAt, b.createdAt) || idNumber(b.id) - idNumber(a.id));
}

/** Display order of change log entries: date descending, then id descending within the same day. */
export function sortChangelogEntries(entries) {
  return [...entries].sort((a, b) => compareDesc(a.date, b.date) || idNumber(b.id) - idNumber(a.id));
}
