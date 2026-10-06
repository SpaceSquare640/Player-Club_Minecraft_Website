// URL hash state: parse and serialise "#key=value&key=value" (query string form, no "#/").
// Pure functions: no DOM and no browser globals. Invalid parameters are dropped and fall back
// to defaults; parse(serialize(state)) is stable, so a parsed hash can be rewritten in canonical form.
//
// ctx = { config, worlds, tags, points }
//   worlds: worlds.json "worlds" array; tags: tags.json "tags" array
//   points: { [worldId]: Point[] } for loaded worlds; a missing world means "not loaded yet"

import { DIMENSION_ORDER } from "./coords.js";
import { isStandardId } from "./ids.js";
import { codePointLength, stripControlChars } from "./text.js";

export const TABS = ["points", "changelog"];
export const LOGS = ["updates", "points"];
/** Views of tab=points other than the point list: the Commands tab of worlds with commands: true. */
export const VIEWS = ["commands"];
export const MAX_HASH_LENGTH = 2048;
export const MAX_QUERY_LENGTH = 100;
/** Output order of keys; also the set of known keys. */
export const HASH_KEYS = ["tab", "log", "world", "view", "dim", "q", "tags", "point"];

const findWorld = (ctx, worldId) => (ctx?.worlds ?? []).find((world) => world.id === worldId);

/** config.defaultWorldId when it exists, otherwise the first world (null without worlds). */
export function defaultWorldId(ctx) {
  const configured = ctx?.config?.defaultWorldId;
  if (findWorld(ctx, configured)) return configured;
  return ctx?.worlds?.[0]?.id ?? null;
}

/** First dimension of the world in the fixed order Overworld, Nether, End. */
export function defaultDimension(world) {
  return DIMENSION_ORDER.find((dim) => world?.dimensions?.includes(dim)) ?? null;
}

/** State with every hash-backed field at its default. */
export function defaultState(ctx) {
  const worldId = defaultWorldId(ctx);
  return {
    tab: "points",
    log: "updates",
    worldId,
    view: null,
    dimension: defaultDimension(findWorld(ctx, worldId)),
    query: "",
    tagIds: [],
    pointId: null,
  };
}

/**
 * Cleans a search string: NFC, control characters removed, trimmed, at most 100 code points.
 * @returns {{ query: string, reason: null | "invalid" | "tooLong" }}
 */
export function cleanQuery(value) {
  const query = stripControlChars(String(value ?? "").normalize("NFC")).trim();
  if (codePointLength(query) > MAX_QUERY_LENGTH) return { query: "", reason: "tooLong" };
  if (query === "" && value !== "") return { query: "", reason: "invalid" };
  return { query, reason: null };
}

/** Removes duplicates and orders tag ids by their order in tags.json (unknown ids last). */
export function orderTagIds(tagIds, ctx) {
  const order = new Map((ctx?.tags ?? []).map((tag, i) => [tag.id, i]));
  const rank = (id) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...new Set(tagIds)].sort((a, b) => rank(a) - rank(b));
}

/**
 * Parses a location hash. Validation order: tab, log, world, point, view, dim, tags, q.
 * - Longer than 2048 characters: everything falls back to defaults.
 * - A leading "#" and "/" are tolerated; unknown keys are ignored; duplicate keys keep the first.
 * - Invalid world: default world, and dim / point are dropped.
 * - point needs tab=points, the standard form and a point of the current world; when valid it
 *   overrides dim and clears q and tags. If the world's points are not loaded yet, a well-formed
 *   point is kept and should be verified by parsing again after loading.
 * - view=commands needs tab=points and a world with commands: true; a valid or pending point clears it.
 *   dim, q and tags are kept (hidden while the Commands tab is shown) and validated as usual.
 * @returns {{ state: object, dropped: { key: string, value: string | null, reason: string }[] }}
 *   reason: tooLong | unknown | duplicate | invalid | notApplicable | notFound | cleared
 */
export function parseHash(hash, ctx) {
  const state = defaultState(ctx);
  const dropped = [];
  let raw = typeof hash === "string" ? hash : "";
  if (raw.startsWith("#")) raw = raw.slice(1);
  if (raw.length > MAX_HASH_LENGTH) {
    dropped.push({ key: "*", value: null, reason: "tooLong" });
    return { state, dropped };
  }
  if (raw.startsWith("/")) raw = raw.slice(1);

  const params = new Map();
  for (const [key, value] of new URLSearchParams(raw)) {
    if (!HASH_KEYS.includes(key)) dropped.push({ key, value, reason: "unknown" });
    else if (params.has(key)) dropped.push({ key, value, reason: "duplicate" });
    else params.set(key, value);
  }
  const drop = (key, reason, value = params.get(key)) => dropped.push({ key, value, reason });

  if (params.has("tab")) {
    if (TABS.includes(params.get("tab"))) state.tab = params.get("tab");
    else drop("tab", "invalid");
  }

  if (params.has("log")) {
    if (!LOGS.includes(params.get("log"))) drop("log", "invalid");
    else if (state.tab !== "changelog") drop("log", "notApplicable");
    else state.log = params.get("log");
  }

  let worldValid = true;
  if (params.has("world")) {
    if (findWorld(ctx, params.get("world"))) state.worldId = params.get("world");
    else {
      drop("world", "invalid");
      worldValid = false;
    }
  }
  const world = findWorld(ctx, state.worldId);
  state.dimension = defaultDimension(world);

  let pointDimension = null;
  if (params.has("point")) {
    const id = params.get("point");
    const loaded = ctx?.points?.[state.worldId];
    if (!worldValid) drop("point", "cleared");
    else if (state.tab !== "points") drop("point", "notApplicable");
    else if (!isStandardId(id, "p")) drop("point", "invalid");
    else if (loaded === undefined || loaded === null) state.pointId = id;
    else {
      const point = loaded.find((p) => p.id === id);
      if (!point || !world.dimensions.includes(point.dimension)) drop("point", "notFound");
      else {
        state.pointId = id;
        pointDimension = point.dimension;
      }
    }
  }

  if (params.has("view")) {
    if (!VIEWS.includes(params.get("view"))) drop("view", "invalid");
    else if (!worldValid) drop("view", "cleared");
    else if (state.tab !== "points" || world?.commands !== true) drop("view", "notApplicable");
    else if (state.pointId) drop("view", "cleared");
    else state.view = params.get("view");
  }

  if (params.has("dim")) {
    const dim = params.get("dim");
    if (!worldValid) drop("dim", "cleared");
    else if (pointDimension) {
      if (dim !== pointDimension) drop("dim", "cleared");
    } else if (world?.dimensions?.includes(dim)) state.dimension = dim;
    else drop("dim", "invalid");
  }
  if (pointDimension) state.dimension = pointDimension;

  if (params.has("tags")) {
    if (pointDimension) drop("tags", "cleared");
    else {
      const tagsById = new Map((ctx?.tags ?? []).map((tag) => [tag.id, tag]));
      const valid = [];
      for (const item of params.get("tags").split(",")) {
        const id = item.trim();
        if (!id) continue;
        if (tagsById.get(id)?.dimensions?.includes(state.dimension)) valid.push(id);
        else drop("tags", "invalid", id);
      }
      state.tagIds = orderTagIds(valid, ctx);
    }
  }

  if (params.has("q")) {
    if (pointDimension) drop("q", "cleared");
    else {
      const { query, reason } = cleanQuery(params.get("q"));
      if (reason) drop("q", reason);
      else state.query = query;
    }
  }

  return { state, dropped };
}

/**
 * Serialises state to a hash without the leading "#" ("" when everything is default).
 * Defaults are omitted; key order is tab, log, world, view, dim, q, tags, point. Values use
 * encodeURIComponent (space as %20); tags are joined with an unencoded comma in tags.json order.
 * log is written only for tab=changelog; view and point only for tab=points.
 */
export function serializeHash(state, ctx) {
  const parts = [];
  const add = (key, value) => parts.push(`${key}=${value}`);
  const tab = TABS.includes(state.tab) ? state.tab : "points";
  if (tab !== "points") add("tab", encodeURIComponent(tab));
  if (tab === "changelog" && state.log && state.log !== "updates") add("log", encodeURIComponent(state.log));
  const worldId = state.worldId ?? defaultWorldId(ctx);
  if (worldId && worldId !== defaultWorldId(ctx)) add("world", encodeURIComponent(worldId));
  if (tab === "points" && VIEWS.includes(state.view)) add("view", encodeURIComponent(state.view));
  if (state.dimension && state.dimension !== defaultDimension(findWorld(ctx, worldId))) {
    add("dim", encodeURIComponent(state.dimension));
  }
  if (state.query) add("q", encodeURIComponent(state.query));
  if (state.tagIds?.length) add("tags", orderTagIds(state.tagIds, ctx).map(encodeURIComponent).join(","));
  if (tab === "points" && state.pointId) add("point", encodeURIComponent(state.pointId));
  return parts.join("&");
}

/** In-page link for a state: "#" followed by the serialised hash. */
export function toHref(state, ctx) {
  return `#${serializeHash(state, ctx)}`;
}

/**
 * Link of a change log entry (Change Log > Coordinate changes).
 * - spawn: #world=<worldId>&dim=overworld with defaults omitted (pinned card on the Overworld tab)
 * - point that still exists: #world=<worldId>&point=<id> with the default world omitted
 * @returns {{ kind: "point" | "spawn", href: string } | { kind: "removed" } | { kind: "pending" }}
 *   removed: the point or world no longer exists; pending: the world's points are not loaded yet.
 */
export function changelogLink(entry, ctx) {
  const target = entry?.target;
  const world = findWorld(ctx, target?.worldId);
  if (!world) return { kind: "removed" };
  const base = { ...defaultState(ctx), worldId: world.id, dimension: defaultDimension(world) };
  if (target.type === "spawn") {
    if (!world.dimensions.includes("overworld")) return { kind: "removed" };
    return { kind: "spawn", href: toHref({ ...base, dimension: "overworld" }, ctx) };
  }
  if (target.type !== "point") return { kind: "removed" };
  const loaded = ctx?.points?.[world.id];
  if (loaded === undefined || loaded === null) return { kind: "pending" };
  const point = loaded.find((p) => p.id === target.id);
  if (!point) return { kind: "removed" };
  // dim is omitted: a valid point parameter selects the point's dimension on arrival.
  return { kind: "point", href: toHref({ ...base, pointId: point.id }, ctx) };
}
