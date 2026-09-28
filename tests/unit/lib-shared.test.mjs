// Pure functions in site/js/lib shared by the site and scripts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatId, isStandardId, parseId } from "../../site/js/lib/ids.js";
import { compareVersion, parseGameVersion, resolveBounds } from "../../site/js/lib/version.js";
import { isWithinBounds } from "../../site/js/lib/coords.js";

test("formatId pads to at least 4 digits and grows beyond 9999", () => {
  assert.equal(formatId("p", 1), "p0001");
  assert.equal(formatId("c", 42), "c0042");
  assert.equal(formatId("p", 9999), "p9999");
  assert.equal(formatId("p", 10000), "p10000");
  assert.throws(() => formatId("p", -1), RangeError);
  assert.throws(() => formatId("p", 1.5), RangeError);
  assert.throws(() => formatId("pp", 1), TypeError);
});

test("parseId is lenient; isStandardId requires the round trip", () => {
  assert.deepEqual(parseId("p0001"), { prefix: "p", n: 1 });
  assert.deepEqual(parseId("p00001"), { prefix: "p", n: 1 });
  assert.deepEqual(parseId("p10000"), { prefix: "p", n: 10000 });
  assert.equal(parseId("p001"), null);
  assert.equal(parseId("P0001"), null);
  assert.equal(parseId(1), null);
  assert.equal(isStandardId("p0001", "p"), true);
  assert.equal(isStandardId("p10000", "p"), true);
  assert.equal(isStandardId("p0000", "p"), true, "p0000 is well-formed; X06 rejects n < 1");
  assert.equal(isStandardId("p00001", "p"), false);
  assert.equal(isStandardId("p010000", "p"), false);
  assert.equal(isStandardId("c0001", "p"), false);
});

test("parseGameVersion accepts latest and x.y(.z) only", () => {
  assert.deepEqual(parseGameVersion("latest"), { latest: true });
  assert.deepEqual(parseGameVersion("1.21"), { latest: false, parts: [1, 21, 0] });
  assert.deepEqual(parseGameVersion("1.21.4"), { latest: false, parts: [1, 21, 4] });
  for (const bad of ["Latest", "1", "1.21.4.1", "v1.21", "1.21-pre1", "", null]) {
    assert.equal(parseGameVersion(bad), null, String(bad));
  }
});

test("compareVersion compares segments numerically with a missing patch as 0", () => {
  assert.equal(compareVersion("1.17", "1.17.0"), 0);
  assert.equal(compareVersion("1.9", "1.17"), -1);
  assert.equal(compareVersion("1.21.10", "1.21.9"), 1);
  assert.throws(() => compareVersion("latest", "1.17"), TypeError);
});

test("resolveBounds: latest uses defaults, otherwise first matching inclusive override", () => {
  const edition = {
    bounds: { xzAbsMax: 30000000, yMin: -64, yMax: 320 },
    versionOverrides: [
      { maxVersion: "1.17.1", bounds: { xzAbsMax: 30000000, yMin: 0, yMax: 256 } },
      { minVersion: "1.17", maxVersion: "1.20", bounds: { xzAbsMax: 1000, yMin: 0, yMax: 100 } },
    ],
  };
  assert.equal(resolveBounds(edition, "latest"), edition.bounds);
  assert.equal(resolveBounds(edition, "1.16.5"), edition.versionOverrides[0].bounds);
  assert.equal(resolveBounds(edition, "1.17.1"), edition.versionOverrides[0].bounds, "max is inclusive; first match wins");
  assert.equal(resolveBounds(edition, "1.17.2"), edition.versionOverrides[1].bounds);
  assert.equal(resolveBounds(edition, "1.20"), edition.versionOverrides[1].bounds, "max 1.20 includes 1.20.0");
  assert.equal(resolveBounds(edition, "1.21"), edition.bounds);
  assert.equal(resolveBounds({ bounds: edition.bounds }, "1.8"), edition.bounds);
  assert.throws(() => resolveBounds(edition, "1.x"), TypeError);
});

test("isWithinBounds checks X/Z limits and Y range or null", () => {
  const b = { xzAbsMax: 30000000, yMin: -64, yMax: 320 };
  assert.equal(isWithinBounds({ x: 30000000, y: 320, z: -30000000 }, b), true);
  assert.equal(isWithinBounds({ x: -30000000, y: -64, z: 30000000 }, b), true);
  assert.equal(isWithinBounds({ x: 30000001, y: 0, z: 0 }, b), false);
  assert.equal(isWithinBounds({ x: 0, y: 0, z: -30000001 }, b), false);
  assert.equal(isWithinBounds({ x: 0, y: -65, z: 0 }, b), false);
  assert.equal(isWithinBounds({ x: 0, y: 321, z: 0 }, b), false);
  assert.equal(isWithinBounds({ x: 0, y: null, z: 0 }, b), true);
  assert.equal(isWithinBounds({ x: 0.5, y: 0, z: 0 }, b), false);
});
