// Normalization of Issue form values (architecture 3.12). Pure functions; errors are returned as
// { error: <reason> } objects, never thrown, so the caller can report every problem at once.

import { codePointLength, hasControlChars } from "../../site/js/lib/text.js";

// U+2212 minus sign, U+2012-U+2015 dashes, U+FE63 small hyphen-minus, U+FF0D full-width hyphen-minus.
const MINUS_RE = /[\u2212\u2012-\u2015\uFE63\uFF0D]/g;
const THOUSANDS_RE = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const F3_LABEL_RE = /^[\p{L}\p{M} ]{1,30}:/u;
const F3_SPLIT_RE = /[\s/,]+/;
const MAX_NUMBER_TEXT = 40;

export const NAME_MAX = 60;
export const NOTE_MAX = 500;

/** NFKC, then every minus-like character becomes "-". */
export function normalizeNumberText(raw) {
  return String(raw ?? "").normalize("NFKC").replace(MINUS_RE, "-");
}

const noNegativeZero = (n) => (n === 0 ? 0 : n);

/** Steps 5-8 of the single value rule: decimal format only (no exponent, one dot), floor, -0 to 0. */
function toInteger(text) {
  if (text.length > MAX_NUMBER_TEXT || !NUMBER_RE.test(text)) return { error: "format" };
  const value = noNegativeZero(Math.floor(Number(text)));
  if (!Number.isFinite(value)) return { error: "format" };
  return { value };
}

/**
 * One coordinate value: NFKC, minus signs, no whitespace, thousands separators (1,234,567), then
 * integer or decimal (floored). Range checks are done by the caller with the world bounds.
 * @returns {{ value: number } | { error: "empty" | "format" }}
 */
export function parseCoordinate(raw) {
  let text = normalizeNumberText(raw).replace(/\s+/gu, "");
  if (text === "") return { error: "empty" };
  if (THOUSANDS_RE.test(text)) text = text.replace(/,/g, "");
  return toInteger(text);
}

/**
 * Y of the add and edit forms: empty, "-" (no Y / clear), or a coordinate.
 * @returns {{ empty: true } | { clear: true } | { value: number } | { error: "format" }}
 */
export function parseOptionalY(raw) {
  const text = normalizeNumberText(raw).replace(/\s+/gu, "");
  if (text === "") return { empty: true };
  if (text === "-") return { clear: true };
  return parseCoordinate(text);
}

/**
 * The whole F3 line, e.g. "XYZ: 7.534 / 103.00000 / 5.699", "Block: 7 103 5", "Position: 7, 103, 5".
 * Leading label removed; values split by whitespace, "/" or ","; exactly three numbers (no thousands separators).
 * @returns {{ x: number, y: number, z: number } | { error: "empty" | "count" | "format" }}
 */
export function parseF3(raw) {
  const text = normalizeNumberText(raw).trim().replace(F3_LABEL_RE, "").trim();
  if (text === "") return { error: "empty" };
  const tokens = text.split(F3_SPLIT_RE).filter(Boolean);
  if (tokens.length !== 3) return { error: "count" };
  const values = tokens.map(toInteger);
  if (values.some((v) => v.error)) return { error: "format" };
  const [x, y, z] = values.map((v) => v.value);
  return { x, y, z };
}

/**
 * Point name: NFC, trim, control / zero-width / bidi characters rejected, whitespace runs collapsed, 1-60.
 * @returns {{ value: string } | { error: "empty" | "control" | "length" }}
 */
export function normalizeName(raw) {
  const trimmed = String(raw ?? "").normalize("NFC").trim();
  if (trimmed === "") return { error: "empty" };
  if (hasControlChars(trimmed)) return { error: "control" };
  const value = trimmed.replace(/\s+/gu, " ");
  if (codePointLength(value) > NAME_MAX) return { error: "length" };
  return { value };
}

/**
 * Note: NFC, CRLF to LF, trailing spaces of lines removed, trim, at most one blank line in a row,
 * control characters other than LF rejected, up to 500.
 * @returns {{ empty: true } | { value: string } | { error: "control" | "length" }}
 */
export function normalizeNote(raw) {
  const value = String(raw ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+\n/gu, "\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");
  if (value === "") return { empty: true };
  if (hasControlChars(value, { allowNewline: true })) return { error: "control" };
  if (codePointLength(value) > NOTE_MAX) return { error: "length" };
  return { value };
}

/** target_id: NFKC and trim (full-width "ｐ０００１" becomes "p0001"). */
export function normalizeTargetId(raw) {
  return String(raw ?? "").normalize("NFKC").trim();
}

/**
 * Axis range check against resolved bounds.
 * @param {"x" | "y" | "z"} axis
 * @param {{ xzAbsMax: number, yMin: number, yMax: number }} bounds
 */
export function isAxisInBounds(axis, value, bounds) {
  if (!Number.isSafeInteger(value)) return false;
  if (axis === "y") return value >= bounds.yMin && value <= bounds.yMax;
  return Math.abs(value) <= bounds.xzAbsMax;
}
