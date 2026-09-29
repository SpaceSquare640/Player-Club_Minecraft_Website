// Issue value normalization (scripts/lib/normalize.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAxisInBounds,
  normalizeName,
  normalizeNote,
  normalizeTargetId,
  parseCoordinate,
  parseF3,
  parseOptionalY,
} from "../../scripts/lib/normalize.mjs";

test("coordinates: full-width digits, minus signs and whitespace", () => {
  assert.deepEqual(parseCoordinate("１２３"), { value: 123 });
  assert.deepEqual(parseCoordinate("−426"), { value: -426 });
  assert.deepEqual(parseCoordinate("－４２６"), { value: -426 });
  assert.deepEqual(parseCoordinate("– 42"), { value: -42 });
  assert.deepEqual(parseCoordinate("﹣10"), { value: -10 });
  assert.deepEqual(parseCoordinate(" 1 024 "), { value: 1024 });
});

test("coordinates: thousands separators and decimals (floor, no negative zero)", () => {
  assert.deepEqual(parseCoordinate("1,234,567"), { value: 1234567 });
  assert.deepEqual(parseCoordinate("-12,345.9"), { value: -12346 });
  assert.deepEqual(parseCoordinate("7.534"), { value: 7 });
  assert.deepEqual(parseCoordinate("-0.5"), { value: -1 });
  const zero = parseCoordinate("-0");
  assert.ok(Object.is(zero.value, 0));
  assert.ok(Object.is(parseCoordinate("-0.0").value, 0));
});

test("coordinates: exponents, extra dots, bad separators and junk are rejected", () => {
  for (const raw of ["1e5", "1E5", "1.2.3", "12,34", "1,2345", "+5", "abc", "5-", "--5", "0x10", "Infinity", "NaN", "1".repeat(41)]) {
    assert.deepEqual(parseCoordinate(raw), { error: "format" }, raw);
  }
  assert.deepEqual(parseCoordinate("   "), { error: "empty" });
});

test("optional Y: empty, dash (full-width and minus sign) and values", () => {
  assert.deepEqual(parseOptionalY(""), { empty: true });
  assert.deepEqual(parseOptionalY("-"), { clear: true });
  assert.deepEqual(parseOptionalY("－"), { clear: true });
  assert.deepEqual(parseOptionalY("−"), { clear: true });
  assert.deepEqual(parseOptionalY("64.9"), { value: 64 });
  assert.deepEqual(parseOptionalY("x"), { error: "format" });
});

test("F3: Java XYZ and Block lines, Bedrock Position, plain values", () => {
  assert.deepEqual(parseF3("XYZ: 7.534 / 103.00000 / 5.699"), { x: 7, y: 103, z: 5 });
  assert.deepEqual(parseF3("XYZ: -0.5 / 64.00000 / -1024.2"), { x: -1, y: 64, z: -1025 });
  assert.deepEqual(parseF3("Block: -124 64 789"), { x: -124, y: 64, z: 789 });
  assert.deepEqual(parseF3("Position: 7, 103, 5"), { x: 7, y: 103, z: 5 });
  assert.deepEqual(parseF3("７ １０３ ５"), { x: 7, y: 103, z: 5 });
  assert.deepEqual(parseF3("座標：−7, 103, 5"), { x: -7, y: 103, z: 5 });
});

test("F3: wrong count, exponents and thousands separators are rejected", () => {
  assert.deepEqual(parseF3("7 103"), { error: "count" });
  assert.deepEqual(parseF3("1,234 / 64 / 5"), { error: "count" });
  assert.deepEqual(parseF3("1e3 64 5"), { error: "format" });
  assert.deepEqual(parseF3("XYZ:"), { error: "empty" });
});

test("names: NFC, trim, collapsed whitespace, control and bidi characters, length", () => {
  assert.deepEqual(normalizeName("  My   Base  "), { value: "My Base" });
  assert.deepEqual(normalizeName("Café"), { value: "Café" });
  assert.deepEqual(normalizeName("Agent's Base"), { value: "Agent's Base" });
  assert.deepEqual(normalizeName("a\tb"), { error: "control" });
  assert.deepEqual(normalizeName("evil‮txt"), { error: "control" });
  assert.deepEqual(normalizeName("zero​width"), { error: "control" });
  assert.deepEqual(normalizeName("line\nbreak"), { error: "control" });
  assert.deepEqual(normalizeName("x".repeat(60)), { value: "x".repeat(60) });
  assert.deepEqual(normalizeName("x".repeat(61)), { error: "length" });
  assert.deepEqual(normalizeName("   "), { error: "empty" });
});

test("notes: CRLF, trailing spaces, blank lines, control characters and length", () => {
  assert.deepEqual(normalizeNote("  line 1  \r\n\r\n\r\n\r\nline 2 \n"), { value: "line 1\n\nline 2" });
  assert.deepEqual(normalizeNote(" \n "), { empty: true });
  assert.deepEqual(normalizeNote("bell\u0007"), { error: "control" });
  assert.deepEqual(normalizeNote("tab\there"), { error: "control" });
  assert.deepEqual(normalizeNote("n".repeat(500)), { value: "n".repeat(500) });
  assert.deepEqual(normalizeNote("n".repeat(501)), { error: "length" });
});

test("target ids and axis bounds", () => {
  assert.equal(normalizeTargetId(" ｐ０００１ "), "p0001");
  const bounds = { xzAbsMax: 30000000, yMin: -64, yMax: 320 };
  assert.equal(isAxisInBounds("x", -30000000, bounds), true);
  assert.equal(isAxisInBounds("z", 30000001, bounds), false);
  assert.equal(isAxisInBounds("y", -64, bounds), true);
  assert.equal(isAxisInBounds("y", 321, bounds), false);
  assert.equal(isAxisInBounds("x", 1e20, bounds), false);
});
