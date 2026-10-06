// The only data entry point of the site: UI modules never fetch; they read through a repository.
// A future host (for example a community site) can swap baseUrl or provide the same interface.
// Browser globals (fetch, document) are touched only when a default is actually needed,
// so the module can be imported and tested in Node with injected dependencies.

export const SUPPORTED_SCHEMA_VERSION = 1;
export const CHANGELOG_KINDS = ["updates", "points"];
const WORLD_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const CORE_FILES = ["config.json", "editions.json", "worlds.json", "tags.json", "vpn.json"];

/**
 * Data loading error, rendered by the error view instead of a blank page.
 * code: NETWORK (request failed), HTTP (non-2xx), PARSE (invalid JSON or shape),
 * SCHEMA_VERSION (file version differs from the supported version).
 */
export class DataError extends Error {
  constructor(code, file, { status = null, expected = null, actual = null, cause } = {}) {
    const detail = code === "HTTP" ? ` (HTTP ${status})` : code === "SCHEMA_VERSION" ? ` (${actual}, expected ${expected})` : "";
    super(`${code}: ${file}${detail}`, cause === undefined ? undefined : { cause });
    this.name = "DataError";
    this.code = code;
    this.file = file;
    this.status = status;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Dictionary keys and action for the error view.
 * SCHEMA_VERSION asks for a reload (stale page and data); everything else offers a retry.
 */
export function errorView(error) {
  if (error instanceof DataError && error.code === "SCHEMA_VERSION") {
    return { titleKey: "error.load.title", bodyKey: "error.schema", actionKey: "error.reload", retryable: false };
  }
  return { titleKey: "error.load.title", bodyKey: "error.load.body", actionKey: "error.retry", retryable: true };
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

/**
 * Fetches and parses one JSON file with cache: "no-cache" (always revalidated).
 * @param {URL | string} url
 * @param {string} file Path shown in errors, relative to the data root.
 * @param {typeof fetch} fetchImpl
 */
export async function fetchJson(url, file, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(String(url), { cache: "no-cache" });
  } catch (cause) {
    throw new DataError("NETWORK", file, { cause });
  }
  if (!response.ok) throw new DataError("HTTP", file, { status: response.status });
  let text;
  try {
    text = await response.text();
  } catch (cause) {
    throw new DataError("NETWORK", file, { cause });
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new DataError("PARSE", file, { cause });
  }
  if (!isObject(data)) throw new DataError("PARSE", file);
  return data;
}

/** Throws SCHEMA_VERSION unless the file's schemaVersion is the supported version. */
export function checkSchemaVersion(data, file) {
  if (data.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new DataError("SCHEMA_VERSION", file, { expected: SUPPORTED_SCHEMA_VERSION, actual: data.schemaVersion ?? null });
  }
}

function requireArray(data, key, file) {
  if (!Array.isArray(data[key])) throw new DataError("PARSE", file);
  return data[key];
}

function normalizeBaseUrl(baseUrl) {
  const url = new URL(String(baseUrl ?? new URL("./data/", globalThis.document.baseURI)));
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

// Caches a promise per key; a rejected load is evicted so that a retry fetches again.
function cached(cache, key, load) {
  if (!cache.has(key)) {
    const promise = load();
    cache.set(key, promise);
    promise.catch(() => {
      if (cache.get(key) === promise) cache.delete(key);
    });
  }
  return cache.get(key);
}

/**
 * @param {{ baseUrl?: URL | string, fetch?: typeof fetch }} [options]
 *   baseUrl defaults to new URL("./data/", document.baseURI); fetch defaults to the global fetch.
 * @returns {{ loadCore: () => Promise<object>, loadPoints: (worldId: string) => Promise<object[]>,
 *   loadCommands: (worldId: string) => Promise<object[]>, loadChangelog: (kind: "updates" | "points") => Promise<object[]> }}
 *   Results are cached and deeply frozen.
 */
export function createRepository({ baseUrl, fetch: fetchImpl } = {}) {
  let base = null;
  const cache = new Map();
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));

  async function get(file) {
    base ??= normalizeBaseUrl(baseUrl);
    const data = await fetchJson(new URL(file, base), file, doFetch);
    checkSchemaVersion(data, file);
    return data;
  }

  /** manifest first (the authoritative schemaVersion), then the other core files in parallel. */
  function loadCore() {
    return cached(cache, "core", async () => {
      const manifest = await get("manifest.json");
      const [config, editions, worlds, tags, vpn] = await Promise.all(CORE_FILES.map(get));
      return deepFreeze({
        manifest,
        config,
        editions: requireArray(editions, "editions", "editions.json"),
        worlds: requireArray(worlds, "worlds", "worlds.json"),
        tagGroups: requireArray(tags, "groups", "tags.json"),
        tags: requireArray(tags, "tags", "tags.json"),
        vpns: requireArray(vpn, "vpns", "vpn.json"),
      });
    });
  }

  /** Points of one world; worldId is stored only at file level and injected into every point here. */
  function loadPoints(worldId) {
    if (typeof worldId !== "string" || !WORLD_ID_RE.test(worldId)) throw new TypeError(`Invalid world id: ${worldId}`);
    return cached(cache, `points:${worldId}`, async () => {
      const file = `points/${worldId}.json`;
      const data = await get(file);
      if (data.worldId !== worldId) throw new DataError("PARSE", file);
      return deepFreeze(requireArray(data, "points", file).map((point) => ({ ...point, worldId })));
    });
  }

  /**
   * Give commands of one world (Commands tab), loaded on demand for worlds with commands: true.
   * Unknown fields are ignored; the panel skips entries that fail isCommandEntry (lib/commands.js).
   */
  function loadCommands(worldId) {
    if (typeof worldId !== "string" || !WORLD_ID_RE.test(worldId)) throw new TypeError(`Invalid world id: ${worldId}`);
    return cached(cache, `commands:${worldId}`, async () => {
      const file = `commands/${worldId}.json`;
      const data = await get(file);
      if (data.worldId !== worldId) throw new DataError("PARSE", file);
      return deepFreeze(requireArray(data, "commands", file));
    });
  }

  /** Change log entries: kind "updates" (Updates) or "points" (Coordinate changes), loaded on demand. */
  function loadChangelog(kind) {
    if (!CHANGELOG_KINDS.includes(kind)) throw new TypeError(`Invalid change log kind: ${kind}`);
    return cached(cache, `changelog:${kind}`, async () => {
      const file = `changelog/${kind}.json`;
      return deepFreeze(requireArray(await get(file), "entries", file));
    });
  }

  return { loadCore, loadPoints, loadCommands, loadChangelog };
}
