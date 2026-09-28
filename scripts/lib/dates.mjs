// Date helpers for timestamps (UTC) and change log dates (config.changelogTimeZone).

const TIME_ZONE_NAME_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/** UTC timestamp without milliseconds, e.g. 2026-09-29T08:00:00Z. */
export function formatUtcTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** True for an IANA time zone name that Intl can resolve (offset strings such as "+08:00" are rejected). */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !TIME_ZONE_NAME_RE.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Calendar date (YYYY-MM-DD) of an instant in the given time zone. */
export function dateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds days to a YYYY-MM-DD date string. */
export function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
