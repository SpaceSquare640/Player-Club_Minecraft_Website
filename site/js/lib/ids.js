// Sequential id helpers shared by the site and Node scripts.
// Standard form: prefix + at least 4 digits, e.g. p0001, p10000. Ids are never reused.

const ID_RE = /^([a-z])([0-9]{4,})$/;

/**
 * Formats a sequence number as a standard id.
 * @param {string} prefix Single lowercase letter ("p", "c", "u").
 * @param {number} n Non-negative safe integer.
 */
export function formatId(prefix, n) {
  if (!/^[a-z]$/.test(prefix)) throw new TypeError(`Invalid id prefix: ${prefix}`);
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`Invalid id number: ${n}`);
  return prefix + String(n).padStart(4, "0");
}

/**
 * Parses an id leniently ("p00001" parses as n = 1); use isStandardId to reject non-standard forms.
 * @returns {{ prefix: string, n: number } | null}
 */
export function parseId(id) {
  if (typeof id !== "string") return null;
  const m = ID_RE.exec(id);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isSafeInteger(n)) return null;
  return { prefix: m[1], n };
}

/** True when id has the given prefix and round-trips: formatId(parseId(id)) === id. */
export function isStandardId(id, prefix) {
  const parsed = parseId(id);
  return parsed !== null && parsed.prefix === prefix && formatId(prefix, parsed.n) === id;
}
