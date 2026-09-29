// Pure view logic of the UI modules (no DOM, no browser globals), unit tested in Node.

import { DIMENSION_ORDER } from "../lib/coords.js";
import { indexTags, matchPoint } from "../lib/filter.js";

/** Card tags shown before "+N": at most 4 tags are shown as is; above that 3 tags plus "+N" (N >= 2). */
export const CARD_TAG_LIMIT = 4;
/** Change log entries shown per "Load more" step. */
export const CHANGELOG_PAGE_SIZE = 30;
/** A coordinate string of this length or more switches the coordinate block to the stacked layout. */
export const LONG_COORD_LENGTH = 8;

/**
 * Tag order on a card: tags selected in the filter first, then tags.json order (unknown ids last).
 * Duplicates are removed.
 * @param {string[]} tagIds
 * @param {{ selected?: string[], tags?: object[] }} [options]
 */
export function orderCardTags(tagIds, { selected = [], tags = [] } = {}) {
  const rank = new Map(tags.map((tag, i) => [tag.id, i]));
  const chosen = new Set(selected);
  const position = (id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...new Set(tagIds ?? [])].sort((a, b) => Number(!chosen.has(a)) - Number(!chosen.has(b)) || position(a) - position(b));
}

/**
 * Visible card tags and the "+N" toggle.
 * - 4 tags or fewer: all visible, no toggle.
 * - More than 4: collapsed shows 3 tags and "+N" (N = total - 3); expanded shows all tags and "Show less".
 * @returns {{ visible: string[], hiddenCount: number, collapsible: boolean }}
 */
export function cardTagLayout(orderedTagIds, { expanded = false, limit = CARD_TAG_LIMIT } = {}) {
  const all = [...orderedTagIds];
  if (all.length <= limit) return { visible: all, hiddenCount: 0, collapsible: false };
  if (expanded) return { visible: all, hiddenCount: 0, collapsible: true };
  const shown = limit - 1;
  return { visible: all.slice(0, shown), hiddenCount: all.length - shown, collapsible: true };
}

/** Tags that apply to a dimension and an edition (tag.editions omitted means every edition). */
export function tagsForDimension(tags, dimension, edition) {
  return (tags ?? []).filter(
    (tag) => tag.dimensions?.includes(dimension) && (!Array.isArray(tag.editions) || tag.editions.includes(edition)),
  );
}

/**
 * Filter chips of the toolbar for the current dimension.
 * - Order: tag group order of tags.json, then tags with points before tags without, then tags.json order.
 * - count: points of the dimension that carry the tag (independent of the search and of other tags,
 *   so the order stays stable while filtering).
 * - Retired tags are listed only while selected (so they can be removed).
 * - disabled: count 0 and not selected.
 * @returns {{ id: string, tag: object, count: number, selected: boolean, disabled: boolean }[]}
 */
export function buildTagFilters({ tags = [], groups = [], points = [], dimension, edition, selected = [] }) {
  const chosen = new Set(selected);
  const inDimension = points.filter((point) => point.dimension === dimension);
  const counts = new Map();
  for (const point of inDimension) {
    for (const id of new Set(point.tags ?? [])) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const groupRank = new Map(groups.map((group, i) => [group.id, i]));
  const tagRank = new Map(tags.map((tag, i) => [tag.id, i]));
  return tagsForDimension(tags, dimension, edition)
    .filter((tag) => !tag.retired || chosen.has(tag.id))
    .map((tag) => {
      const count = counts.get(tag.id) ?? 0;
      return { id: tag.id, tag, count, selected: chosen.has(tag.id), disabled: count === 0 && !chosen.has(tag.id) };
    })
    .sort(
      (a, b) =>
        (groupRank.get(a.tag.group) ?? Number.MAX_SAFE_INTEGER) - (groupRank.get(b.tag.group) ?? Number.MAX_SAFE_INTEGER) ||
        Number(a.count === 0) - Number(b.count === 0) ||
        tagRank.get(a.id) - tagRank.get(b.id),
    );
}

/**
 * Dimension tab counts: points of each dimension matching the search query (tags are ignored because
 * they differ per dimension). The pinned world spawn card is never counted.
 * @returns {Record<string, number>}
 */
export function countByDimension(points, dimensions, query, tags) {
  const tagsById = indexTags(tags);
  const counts = Object.fromEntries(dimensions.map((dim) => [dim, 0]));
  for (const point of points) {
    if (Object.hasOwn(counts, point.dimension) && matchPoint(point, { query }, tagsById)) counts[point.dimension] += 1;
  }
  return counts;
}

/** Dimensions of a world in the fixed display order Overworld, Nether, End. */
export function orderedDimensions(world) {
  return DIMENSION_ORDER.filter((dim) => world?.dimensions?.includes(dim));
}

/**
 * Result summary under the toolbar (the pinned card is not counted).
 * @returns {{ key: string, plural: boolean, params: object }}
 */
export function resultSummary({ shown, total, filtered }) {
  if (!filtered) return { key: "result.count", plural: true, params: { n: shown } };
  return { key: "result.filtered", plural: false, params: { n: shown, total } };
}

/** True when a search query or tag filter is active. */
export const hasConditions = (state) => Boolean(state?.query) || (state?.tagIds?.length ?? 0) > 0;

/**
 * Display strings of a coordinate: values as in the copy text (no grouping, ASCII minus), y null when
 * not provided, and long = true when any value string has 8 or more characters (stacked layout).
 */
export function coordDisplay(coord) {
  const x = String(coord.x);
  const z = String(coord.z);
  const y = coord.y === null || coord.y === undefined ? null : String(coord.y);
  const long = [x, y, z].some((value) => value !== null && value.length >= LONG_COORD_LENGTH);
  return { x, y, z, long };
}

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Calendar date and time of a timestamp in a time zone (default Asia/Taipei), independent of the
 * visitor's zone: { date: "YYYY-MM-DD", time: "HH:mm" }. Returns null for an invalid timestamp.
 */
export function zonedDateTime(timestamp, timeZone = "Asia/Taipei") {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${pad2(hour)}:${pad2(parts.minute)}` };
}

/**
 * Meta line of a card: "Added" when updatedAt equals createdAt, otherwise "Updated", with the
 * Taipei-time date of the relevant timestamp.
 * @returns {{ labelKey: string, timestamp: string, date: string, time: string } | null}
 */
export function pointDateMeta(point, timeZone) {
  const edited = point.updatedAt && point.updatedAt !== point.createdAt;
  const timestamp = edited ? point.updatedAt : point.createdAt;
  const zoned = zonedDateTime(timestamp, timeZone);
  if (!zoned) return null;
  return { labelKey: edited ? "card.updatedAt" : "card.createdAt", timestamp, ...zoned };
}

/** Groups sorted change log entries by date, keeping their order: [{ date, entries }]. */
export function groupByDate(entries) {
  const groups = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else groups.push({ date: entry.date, entries: [entry] });
  }
  return groups;
}

/** First pages * pageSize entries and whether more remain. */
export function pageEntries(entries, pages, pageSize = CHANGELOG_PAGE_SIZE) {
  const count = Math.max(1, pages) * pageSize;
  return { shown: entries.slice(0, count), hasMore: entries.length > count };
}

/**
 * Menu and tab keyboard navigation with wrap-around.
 * @param {number} current Current index (-1 when none).
 * @param {string} key KeyboardEvent.key
 * @param {number} count Number of items.
 * @param {{ axis?: "vertical" | "horizontal" }} [options]
 * @returns {number | null} next index, or null when the key does not move.
 */
export function nextIndex(current, key, count, { axis = "vertical" } = {}) {
  if (count <= 0) return null;
  const forward = axis === "vertical" ? "ArrowDown" : "ArrowRight";
  const backward = axis === "vertical" ? "ArrowUp" : "ArrowLeft";
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === forward) return current < 0 ? 0 : (current + 1) % count;
  if (key === backward) return current < 0 ? count - 1 : (current - 1 + count) % count;
  return null;
}

/** Dictionary key and params of a world's version badge. */
export function versionLabel(world) {
  const edition = `edition.${world.edition}`;
  if (world.gameVersion === "latest") return { key: "world.version.latest", editionKey: edition, params: {} };
  return { key: "world.version.fixed", editionKey: edition, params: { version: world.gameVersion } };
}
