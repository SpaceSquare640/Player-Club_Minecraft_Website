// Coordinate helpers shared by the site and Node scripts. No DOM and no browser globals.
// coord is a point or a world spawn: { x, y, z } with integer x / z and integer-or-null y.

export const DIMENSION_ORDER = ["overworld", "the_nether", "the_end"];
export const NETHER_SCALE = 8;

/**
 * Checks a point or world spawn against resolved bounds.
 * x and z must be integers within +/- xzAbsMax; y must be null or an integer within [yMin, yMax].
 * @param {{ x: number, y: number | null, z: number }} coord
 * @param {{ xzAbsMax: number, yMin: number, yMax: number }} bounds
 */
export function isWithinBounds(coord, bounds) {
  const { x, y, z } = coord;
  if (!Number.isInteger(x) || !Number.isInteger(z)) return false;
  if (Math.abs(x) > bounds.xzAbsMax || Math.abs(z) > bounds.xzAbsMax) return false;
  if (y === null) return true;
  return Number.isInteger(y) && y >= bounds.yMin && y <= bounds.yMax;
}

// -0 would print as "0" but compares unequal in strict deep equality; normalise it.
const noNegativeZero = (n) => (n === 0 ? 0 : n);
const hasY = (y) => y !== null && y !== undefined;

/** Copy text shared by point cards, the pinned spawn card and the world info panel: "X Y Z", or "X Z" without Y. */
export function formatCopyText(coord) {
  const { x, y, z } = coord;
  return hasY(y) ? `${x} ${y} ${z}` : `${x} ${z}`;
}

/** Overworld to Nether: x / 8 and z / 8 rounded down (Math.floor, also for negatives); Y is not converted. */
export function toNether(coord) {
  return {
    x: noNegativeZero(Math.floor(coord.x / NETHER_SCALE)),
    y: hasY(coord.y) ? coord.y : null,
    z: noNegativeZero(Math.floor(coord.z / NETHER_SCALE)),
  };
}

/** Nether to Overworld: x * 8 and z * 8; Y is not converted. */
export function toOverworld(coord) {
  return {
    x: noNegativeZero(Math.floor(coord.x * NETHER_SCALE)),
    y: hasY(coord.y) ? coord.y : null,
    z: noNegativeZero(Math.floor(coord.z * NETHER_SCALE)),
  };
}

/**
 * Converted coordinates for the other dimension of the Overworld / Nether pair.
 * @returns {{ dimension: "the_nether" | "overworld", coord: object } | null} null for the End (no conversion).
 */
export function convertCoord(coord, dimension) {
  if (dimension === "overworld") return { dimension: "the_nether", coord: toNether(coord) };
  if (dimension === "the_nether") return { dimension: "overworld", coord: toOverworld(coord) };
  return null;
}

/** Target id of a world spawn in Issue form 4 (not a data id; uses no sequence number). */
export const spawnTargetId = (worldId) => `spawn:${worldId}`;

/**
 * Data for the pinned world spawn card, generated from world.spawn (the spawn is not a point).
 * The card exists only on the Overworld tab; it never goes through matchPoint / sortPoints and
 * is not counted in dimension totals.
 * @returns {null | { kind: "spawn", worldId: string, targetId: string, dimension: "overworld",
 *   x: number, y: number | null, z: number, copyText: string }}
 */
export function buildSpawnCard(world, dimension) {
  if (dimension !== "overworld" || !world || !world.spawn) return null;
  if (Array.isArray(world.dimensions) && !world.dimensions.includes("overworld")) return null;
  const { x, z } = world.spawn;
  const y = hasY(world.spawn.y) ? world.spawn.y : null;
  return {
    kind: "spawn",
    worldId: world.id,
    targetId: spawnTargetId(world.id),
    dimension: "overworld",
    x,
    y,
    z,
    copyText: formatCopyText({ x, y, z }),
  };
}
