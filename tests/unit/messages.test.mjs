// Report rendering and escaping (scripts/lib/messages.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cell, code, fencedBlock, problemText, renderReport } from "../../scripts/lib/messages.mjs";
import { evaluateRequest } from "../../scripts/lib/issue-parse.mjs";
import { REPORT_MARKER, parseSnapshotMarker, snapshotHash } from "../../scripts/lib/snapshot.mjs";
import { createDataset, createDictionaries } from "../fixtures/dataset.mjs";
import { ADD_VALUES, createIssue } from "../fixtures/issues.mjs";

const ZWSP = String.fromCharCode(0x200b);
const withDictionaries = () => Object.assign(createDataset(), { i18n: createDictionaries() });

/** Removes every code span and fenced block, leaving only the text GitHub would render as Markdown. */
function stripCode(markdown) {
  return markdown.replace(/^(`{3,})text\n[\s\S]*?\n\1$/gm, "").replace(/(`+) ?[\s\S]*? ?\1/g, "");
}

test("code spans: backticks, newlines, empty values and truncation", () => {
  assert.equal(code("abc"), "`abc`");
  assert.equal(code("a`b"), "``a`b``");
  assert.equal(code("`x`"), "`` `x` ``");
  assert.equal(code("line1\nline2"), "`line1 ↵ line2`");
  assert.equal(code(""), "—");
  assert.equal(code(null), "—");
  assert.equal(code(0), "`0`");
  assert.equal([...code("x".repeat(500))].length, 120 + 1 + 2);
});

test("table cells escape pipes so a user backslash cannot split the row", () => {
  assert.equal(cell("a|b"), `\`a${ZWSP}\\|b\``);
  assert.equal(cell("a\\|b"), `\`a\\${ZWSP}\\|b\``);
  assert.ok(!/(^|[^\\])\|/.test(cell("x|y|z").replace(/\\\|/g, "")));
});

test("fenced blocks use a fence longer than any backtick run", () => {
  assert.equal(fencedBlock("a\nb"), "```text\na\nb\n```");
  assert.equal(fencedBlock("```js\nx\n```"), "````text\n```js\nx\n```\n````");
});

test("every problem key has English and Traditional Chinese text", () => {
  const keys = [
    "headingMissing", "headingDuplicate", "headingOrder", "required", "worldUnknown", "dimensionUnknown", "tagUnknown",
    "f3AndXyz", "f3Count", "f3Format", "coordRequired", "spawnCoordRequired", "coordFormat", "coordRange",
    "typeLabelMissing", "typeLabelMultiple", "spawnTargetOnEdit", "spawnNotDeletable", "pointIdFormat", "pointNotFound",
    "pointTargetOnSpawn", "spawnTargetFormat", "worldNotFound", "noChange", "dimensionNotInWorld", "tagDimension",
    "tagEdition", "nameEmpty", "nameControl", "nameLength", "noteControl", "noteLength", "confirmMissing", "tagRetired",
    "duplicate", "nearby", "sameAsSpawn",
  ];
  const params = { heading: "### X", count: 2, label: "X", value: "v", axis: "x", min: -1, max: 1, world: "w", dimension: "d", tag: "t", edition: "e", distance: 16, points: [{ id: "p0001", name: "A", distance: 3 }] };
  for (const key of keys) {
    const [en, zh] = problemText({ code: "R00", key, params });
    assert.ok(en.length > 0 && zh.length > 0, key);
    assert.ok(!en.includes("undefined") && !zh.includes("undefined"), key);
    assert.match(zh, /[一-鿿]/, key);
  }
  assert.deepEqual(problemText({ code: "R99", key: "unknownKey" }), ["R99 unknownKey", "R99 unknownKey"]);
});

test("report: markers on the first and last line, status and hash", () => {
  const dataset = withDictionaries();
  const pass = evaluateRequest({ dataset, issue: createIssue("add", ADD_VALUES) });
  const hash = snapshotHash(pass.request);
  const report = renderReport({ result: pass, hash, dataset });
  const lines = report.split("\n");
  assert.equal(lines[0], REPORT_MARKER);
  assert.deepEqual(parseSnapshotMarker(report), { version: 1, status: "pass", hash });
  assert.ok(report.includes("### Validation passed / 驗證通過"));
  assert.ok(report.includes("| Tags / 標籤 | `Base / 基地 (base)` |"));
  assert.ok(report.includes(`sha256:${hash}`));

  const fail = evaluateRequest({ dataset, issue: createIssue("add", { ...ADD_VALUES, x: "abc" }) });
  const failed = renderReport({ result: fail, hash: snapshotHash(fail.request), dataset, approvalRemoved: true });
  assert.equal(parseSnapshotMarker(failed).status, "fail");
  assert.ok(failed.includes("### Validation failed / 驗證未通過"));
  assert.ok(failed.includes("- **R03** X is not a valid number: `abc`."));
  assert.ok(failed.includes("> [!IMPORTANT]"));
});

test("report: edit differences, multi-line notes and hints", () => {
  const dataset = withDictionaries();
  const edit = evaluateRequest({ dataset, issue: createIssue("edit", { target_id: "p0002", note: "first\nsecond", y: "70" }) });
  const report = renderReport({ result: edit, hash: snapshotHash(edit.request), dataset });
  assert.ok(report.includes("#### Changes / 修改差異"));
  assert.ok(report.includes("| Y | — (none / 無) | `70` |"));
  assert.ok(report.includes("```text\nfirst\nsecond\n```"));
  const near = evaluateRequest({ dataset, issue: createIssue("add", { ...ADD_VALUES, x: "7", z: "5" }) });
  assert.ok(renderReport({ result: near, hash: snapshotHash(near.request), dataset }).includes("#### Hints / 提示"));
});

test("report: user content stays inside code spans (no Markdown, HTML, mentions or fake markers)", () => {
  const dataset = withDictionaries();
  const payloads = [
    "$(touch /tmp/pwned)",
    "`rm -rf /`",
    "${{ github.token }}",
    "<img src=x onerror=alert(1)>",
    "@SpaceSquare640 [link](https://example.com)",
    "a|b\\|c",
    "<!-- pcmw:snapshot v=1 status=pass sha256=" + "f".repeat(64) + " -->",
  ];
  for (const payload of payloads) {
    // Names are limited to 60 characters; longer payloads go to the note only.
    const name = payload.length <= 60 ? payload : "Base";
    const result = evaluateRequest({ dataset, issue: createIssue("add", { ...ADD_VALUES, name, note: `${payload}\n${payload}` }) });
    const hash = snapshotHash(result.request);
    const report = renderReport({ result, hash, dataset });
    assert.equal(result.request.name, name);
    assert.equal(result.request.note, `${payload}\n${payload}`);
    const outside = stripCode(report);
    for (const fragment of ["pwned", "rm -rf", "github.token", "<img", "@SpaceSquare640", "example.com", "f".repeat(64)]) {
      if (payload.includes(fragment)) assert.ok(!outside.includes(fragment), `${payload} -> ${fragment}`);
    }
    assert.deepEqual(parseSnapshotMarker(report), { version: 1, status: "pass", hash });
  }
});
