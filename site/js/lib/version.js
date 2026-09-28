// Game version parsing and coordinate bounds resolution, shared by the site and Node scripts.

const VERSION_RE = /^[0-9]+\.[0-9]+(\.[0-9]+)?$/;

/**
 * @returns {{ latest: true } | { latest: false, parts: number[] } | null}
 *   parts always has 3 numbers (a missing patch is 0); null when invalid.
 */
export function parseGameVersion(value) {
  if (value === "latest") return { latest: true };
  if (typeof value !== "string" || !VERSION_RE.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.length === 2) parts.push(0);
  return { latest: false, parts };
}

/** Compares two numeric versions ("1.17", "1.17.1") segment by segment; returns -1, 0 or 1. */
export function compareVersion(a, b) {
  const pa = parseGameVersion(a);
  const pb = parseGameVersion(b);
  if (!pa || pa.latest || !pb || pb.latest) {
    throw new TypeError(`Cannot compare versions: ${a}, ${b}`);
  }
  for (let i = 0; i < 3; i += 1) {
    if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] < pb.parts[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Resolves coordinate bounds for an edition and game version.
 * "latest" always uses the default bounds; otherwise the first override whose inclusive
 * [minVersion, maxVersion] range contains the version wins.
 * @param {{ bounds: object, versionOverrides?: object[] }} edition
 * @param {string} gameVersion
 */
export function resolveBounds(edition, gameVersion) {
  const parsed = parseGameVersion(gameVersion);
  if (!parsed) throw new TypeError(`Invalid game version: ${gameVersion}`);
  if (parsed.latest) return edition.bounds;
  for (const override of edition.versionOverrides ?? []) {
    const aboveMin = override.minVersion === undefined || compareVersion(gameVersion, override.minVersion) >= 0;
    const belowMax = override.maxVersion === undefined || compareVersion(gameVersion, override.maxVersion) <= 0;
    if (aboveMin && belowMax) return override.bounds;
  }
  return edition.bounds;
}
