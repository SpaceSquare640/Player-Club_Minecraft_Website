// Front-end fixtures: hash context, fake window / storage / fetch built on the data set fixture.
import { addSecondWorld, createDataset } from "./dataset.mjs";

/** Hash context { config, worlds, tags, points } with two worlds; points injected with worldId. */
export function createHashContext({ loaded = ["player_club", "survival_two"] } = {}) {
  const ds = addSecondWorld(createDataset(), [
    {
      id: "p0003",
      dimension: "the_nether",
      name: "Hub",
      tags: ["base"],
      x: 10,
      y: 70,
      z: -10,
      submittedBy: "friend-01",
      createdAt: "2026-09-29T02:00:00Z",
      updatedAt: "2026-09-29T02:00:00Z",
    },
  ]);
  const points = {};
  for (const worldId of loaded) {
    points[worldId] = ds.points[worldId].points.map((p) => ({ ...p, worldId }));
  }
  return { config: ds.config, worlds: ds.worlds.worlds, tags: ds.tags.tags, points, dataset: ds };
}

/** Minimal window with location, history and event listeners; records history calls. */
export function createFakeWindow(hash = "") {
  const listeners = new Map();
  const calls = [];
  const win = {
    location: { hash: hash ? `#${hash.replace(/^#/, "")}` : "", pathname: "/Player-Club_Minecraft_Website/", search: "" },
    history: {
      pushState: (_s, _t, url) => {
        calls.push({ mode: "push", url });
        win.setUrl(url);
      },
      replaceState: (_s, _t, url) => {
        calls.push({ mode: "replace", url });
        win.setUrl(url);
      },
    },
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
    setUrl(url) {
      win.location.hash = url.startsWith("#") && url.length > 1 ? url : "";
    },
    /** Simulates the user navigating (typing a hash, back / forward). */
    navigate(nextHash, type = "hashchange") {
      win.location.hash = nextHash ? `#${nextHash.replace(/^#/, "")}` : "";
      for (const fn of listeners.get(type) ?? []) fn({ type });
    },
    listenerCount: (type) => (listeners.get(type) ?? []).length,
    calls,
  };
  return win;
}

/** Storage stub; throwing: true makes every access throw (private mode, blocked storage). */
export function createFakeStorage(initial = {}, { throwing = false } = {}) {
  const data = new Map(Object.entries(initial));
  const guard = () => {
    if (throwing) throw new Error("SecurityError: storage is not available");
  };
  return {
    getItem: (key) => (guard(), data.has(key) ? data.get(key) : null),
    setItem: (key, value) => (guard(), data.set(key, String(value))),
    removeItem: (key) => (guard(), data.delete(key)),
    data,
  };
}

/**
 * Fake fetch over a map of URL (or path suffix) to body. A body can be an object (JSON-encoded),
 * a string (raw text), an Error (network failure) or { status } (HTTP error).
 */
export function createFakeFetch(routes) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const key = Object.keys(routes).find((k) => url === k || url.endsWith(k));
    const body = key === undefined ? { status: 404 } : routes[key];
    if (body instanceof Error) throw body;
    if (body && typeof body === "object" && Object.keys(body).length === 1 && typeof body.status === "number") {
      return { ok: false, status: body.status, text: async () => "" };
    }
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { ok: true, status: 200, text: async () => text };
  };
  return { fetch: fetchImpl, requests };
}
