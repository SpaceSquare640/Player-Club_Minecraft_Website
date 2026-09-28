// Id allocation (scripts/new-id.mjs): max(manifest seq, existing ids) + 1, never reused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allocateId } from "../../scripts/new-id.mjs";
import { createDataset } from "../fixtures/dataset.mjs";

test("allocates the next point, change and update ids", () => {
  const ds = createDataset();
  assert.deepEqual(allocateId(ds, "point"), { id: "p0003", n: 3, manifest: { ...ds.manifest, pointSeq: 3 } });
  assert.equal(allocateId(ds, "change").id, "c0003");
  assert.equal(allocateId(ds, "update").id, "u0002");
  assert.equal(ds.manifest.pointSeq, 2, "input is not mutated");
});

test("deleted ids are not recycled", () => {
  const ds = createDataset();
  ds.points.player_club.points.pop(); // p0002 deleted
  assert.equal(allocateId(ds, "point").id, "p0003");
});

test("existing ids win when the manifest is behind", () => {
  const ds = createDataset();
  ds.manifest.pointSeq = 0;
  ds.manifest.changeSeq = 1;
  assert.equal(allocateId(ds, "point").id, "p0003");
  assert.equal(allocateId(ds, "change").id, "c0003");
});

test("grows past four digits", () => {
  const ds = createDataset();
  ds.manifest.pointSeq = 9999;
  assert.equal(allocateId(ds, "point").id, "p10000");
});

test("rejects unknown kinds and broken manifests", () => {
  const ds = createDataset();
  assert.throws(() => allocateId(ds, "tag"), /Unknown id kind/);
  ds.manifest.updateSeq = "1";
  assert.throws(() => allocateId(ds, "update"), /updateSeq/);
});
