// Report markers and snapshot hash (scripts/lib/snapshot.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_MARKER,
  SNAPSHOT_KEYS,
  buildSnapshotPayload,
  canonicalJson,
  findReportComment,
  formatSnapshotMarker,
  isTrustedBotComment,
  parseSnapshotMarker,
  snapshotHash,
} from "../../scripts/lib/snapshot.mjs";
import { evaluateRequest } from "../../scripts/lib/issue-parse.mjs";
import { createDataset } from "../fixtures/dataset.mjs";
import { createIssue } from "../fixtures/issues.mjs";

const bot = { login: "github-actions[bot]", type: "Bot" };

test("payload has every key, missing values are null", () => {
  const payload = buildSnapshotPayload({ issue: 3, type: "delete", targetId: "p0001", extra: "ignored" });
  assert.deepEqual(Object.keys(payload), SNAPSHOT_KEYS);
  assert.equal(payload.name, null);
  assert.equal("extra" in payload, false);
});

test("canonical JSON sorts keys at every level and keeps array order", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [2, 1], c: null } }), '{"a":{"c":null,"d":[2,1]},"b":1}');
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
});

test("hash is 64 hex characters, stable across key order, sensitive to values", () => {
  const a = snapshotHash({ issue: 1, type: "add", name: "Base", baseSpawn: { x: 1, y: 2, z: 3 } });
  const b = snapshotHash({ baseSpawn: { z: 3, y: 2, x: 1 }, name: "Base", type: "add", issue: 1 });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);
  assert.notEqual(a, snapshotHash({ issue: 1, type: "add", name: "Base ", baseSpawn: { x: 1, y: 2, z: 3 } }));
});

test("baseUpdatedAt makes the hash change when the target changes after validation", () => {
  const dataset = createDataset();
  const issue = createIssue("edit", { target_id: "p0001", name: "Renamed" });
  const before = snapshotHash(evaluateRequest({ dataset, issue }).request);
  dataset.points.player_club.points[0].updatedAt = "2026-09-29T02:00:00Z";
  const after = snapshotHash(evaluateRequest({ dataset, issue }).request);
  assert.notEqual(before, after);
});

test("clearing Y and leaving Y unchanged hash differently", () => {
  const dataset = createDataset();
  const unchanged = evaluateRequest({ dataset, issue: createIssue("edit", { target_id: "p0001", name: "Renamed" }) });
  const cleared = evaluateRequest({ dataset, issue: createIssue("edit", { target_id: "p0001", name: "Renamed", y: "-" }) });
  assert.notEqual(snapshotHash(unchanged.request), snapshotHash(cleared.request));
});

test("snapshot marker is written and read from the last line only", () => {
  const hash = "a".repeat(64);
  const marker = formatSnapshotMarker({ status: "pass", hash });
  assert.equal(marker, `<!-- pcmw:snapshot v=1 status=pass sha256=${hash} -->`);
  assert.deepEqual(parseSnapshotMarker(`${REPORT_MARKER}\nbody\n${marker}\n`), { version: 1, status: "pass", hash });
  // A marker quoted earlier in the report (e.g. inside user text) is ignored.
  assert.equal(parseSnapshotMarker(`${REPORT_MARKER}\n${marker}\nmore text`), null);
  assert.equal(parseSnapshotMarker(`<!-- pcmw:snapshot v=1 status=ok sha256=${hash} -->`), null);
  assert.throws(() => formatSnapshotMarker({ status: "maybe", hash }), RangeError);
  assert.throws(() => formatSnapshotMarker({ status: "pass", hash: "xyz" }), TypeError);
});

test("only github-actions[bot] report comments are trusted", () => {
  const body = `${REPORT_MARKER}\nreport`;
  assert.equal(isTrustedBotComment({ user: bot, body }), true);
  assert.equal(isTrustedBotComment({ user: { login: "github-actions[bot]", type: "User" }, body }), false);
  assert.equal(isTrustedBotComment({ user: { login: "friend-01", type: "User" }, body }), false);
  const forged = { id: 1, user: { login: "friend-01", type: "User" }, body };
  const real = { id: 2, user: bot, body };
  const other = { id: 3, user: bot, body: "no marker" };
  assert.equal(findReportComment([forged, other, real]).id, 2);
  assert.equal(findReportComment([forged]), null);
});
