// Coordinate helpers shared by the site and Node scripts.
// M1 provides the bounds check; copy text and Nether conversion helpers are added with the front end.

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
