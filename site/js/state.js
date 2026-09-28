// Single application state, kept in sync with the URL hash (lib/hash.js).
// state: { tab, log, worldId, dimension, query, tagIds, pointId, lang }; lang is never written to the hash.
// history option of setState: "push" (tab, change log sub-tab, world, dimension), "replace" (search,
// tags, canonical rewrites) or "none". Browser globals are read lazily through the win option.

import { defaultState, parseHash, serializeHash } from "./lib/hash.js";

export const HASH_FIELDS = ["tab", "log", "worldId", "dimension", "query", "tagIds", "pointId"];
const FIELDS = [...HASH_FIELDS, "lang"];
const HISTORY_MODES = ["push", "replace", "none"];

const sameValue = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b);

/** Names of the fields that differ between two states. */
export function diffState(a, b) {
  return FIELDS.filter((key) => !sameValue(a[key], b[key]));
}

const rawHash = (win) => String(win?.location?.hash ?? "").replace(/^#/, "");

/**
 * @param {{ win?: Window | object, ctx?: object, lang?: string }} [options]
 *   win: object with location, history and addEventListener (defaults to the global window when present).
 *   ctx: hash context { config, worlds, tags, points } (see lib/hash.js); set later with setContext.
 */
export function createStore({ win, ctx = null, lang = "en" } = {}) {
  const getWin = () => (win !== undefined ? win : globalThis.window ?? null);
  let context = ctx;
  let state = Object.freeze({ ...defaultState(context), lang });
  const listeners = new Set();
  let started = null;

  function freeze(next) {
    return Object.freeze({ ...next, tagIds: Object.freeze([...(next.tagIds ?? [])]) });
  }

  // Canonical form: serialise and parse again, so the same validation rules apply to both
  // user actions and hash input (tags filtered by dimension, invalid values dropped, and so on).
  function normalize(next) {
    if (!context) return next;
    const { state: parsed } = parseHash(serializeHash(next, context), context);
    return { ...parsed, lang: next.lang };
  }

  function writeHistory(mode, next) {
    const w = getWin();
    if (mode === "none" || !w?.history || !w.location) return;
    const hash = serializeHash(next, context);
    if (hash === rawHash(w)) return;
    const url = hash ? `#${hash}` : `${w.location.pathname ?? ""}${w.location.search ?? ""}`;
    if (mode === "push") w.history.pushState(null, "", url);
    else w.history.replaceState(null, "", url);
  }

  function commit(next, meta) {
    const prev = state;
    const changed = diffState(prev, next);
    if (changed.length === 0) return false;
    state = freeze(next);
    for (const fn of [...listeners]) fn(state, prev, { ...meta, changed });
    return true;
  }

  /** Current state (frozen). */
  function getState() {
    return state;
  }

  /**
   * Applies a patch, normalises it and writes history.
   * - World change: dimension resets to the world's first dimension and tags are cleared unless the patch sets them.
   * - Any hash field change clears pointId unless the patch sets it.
   * @returns {boolean} true when the state changed.
   */
  function setState(patch, { history = "none" } = {}) {
    if (!HISTORY_MODES.includes(history)) throw new RangeError(`Invalid history mode: ${history}`);
    let next = { ...state, ...patch };
    if (patch.worldId !== undefined && patch.worldId !== state.worldId) {
      if (!("dimension" in patch)) next.dimension = null;
      if (!("tagIds" in patch)) next.tagIds = [];
    }
    if (!("pointId" in patch) && HASH_FIELDS.some((key) => key !== "pointId" && !sameValue(next[key], state[key]))) {
      next.pointId = null;
    }
    // A null dimension serialises as "default", so normalize() picks the world's first dimension.
    next = normalize(next);
    const hashChanged = diffState(state, next).some((key) => key !== "lang");
    if (hashChanged) writeHistory(history, next);
    return commit(next, { source: "set", dropped: [] });
  }

  /** Registers a listener fn(state, prevState, { changed, source, dropped }); returns an unsubscribe function. */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /** Replaces the hash context (for example after loading core data or a world's points). */
  function setContext(nextCtx) {
    context = nextCtx;
  }

  /**
   * Reads location.hash, applies it (listeners are called only when the state differs) and rewrites
   * the hash in canonical form with replaceState when needed.
   * @returns {{ state: object, dropped: object[] }} dropped lists ignored parameters (e.g. point notFound).
   */
  function syncFromHash() {
    // Without data the hash cannot be validated; leave it untouched until setContext is called.
    if (!context) return { state, dropped: [] };
    const w = getWin();
    const raw = rawHash(w);
    const { state: parsed, dropped } = parseHash(raw, context);
    const next = { ...parsed, lang: state.lang };
    const canonical = serializeHash(next, context);
    if (canonical !== raw && w?.history && w.location) {
      w.history.replaceState(null, "", canonical ? `#${canonical}` : `${w.location.pathname ?? ""}${w.location.search ?? ""}`);
    }
    commit(next, { source: "hash", dropped });
    return { state, dropped };
  }

  /** Listens to popstate and hashchange (back / forward and manual edits). */
  function start() {
    const w = getWin();
    if (started || !w?.addEventListener) return;
    started = () => syncFromHash();
    w.addEventListener("popstate", started);
    w.addEventListener("hashchange", started);
  }

  function stop() {
    const w = getWin();
    if (!started || !w?.removeEventListener) return;
    w.removeEventListener("popstate", started);
    w.removeEventListener("hashchange", started);
    started = null;
  }

  return { getState, setState, subscribe, setContext, syncFromHash, start, stop };
}

// Default store for the site.
const store = createStore();
export const getState = () => store.getState();
export const setState = (patch, options) => store.setState(patch, options);
export const subscribe = (fn) => store.subscribe(fn);
export const setContext = (ctx) => store.setContext(ctx);
export const syncFromHash = () => store.syncFromHash();
export const startHashSync = () => store.start();
export const stopHashSync = () => store.stop();
