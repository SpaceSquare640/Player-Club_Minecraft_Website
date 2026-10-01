// Issue body parsing and request rules R01-R09 (scripts/lib/issue-parse.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRequest, isChecked, optionId, parseIssueBody, requestKindFromLabels } from "../../scripts/lib/issue-parse.mjs";
import { FIELD_LABELS } from "../../scripts/lib/form-fields.mjs";
import { createDataset } from "../fixtures/dataset.mjs";
import { ADD_VALUES, createIssue, renderBody } from "../fixtures/issues.mjs";

const evaluate = (kind, values, options, dataset = createDataset()) => evaluateRequest({ dataset, issue: createIssue(kind, values, options) });
const keys = (list) => list.map((e) => `${e.code}:${e.key}`);

test("labels decide the request kind (exactly one type label)", () => {
  assert.deepEqual(requestKindFromLabels([{ name: "coord-request" }, { name: "type:edit" }]), { kind: "edit", count: 1 });
  assert.deepEqual(requestKindFromLabels(["type:add", "type:delete"]), { kind: null, count: 2 });
  assert.deepEqual(requestKindFromLabels([]), { kind: null, count: 0 });
  assert.deepEqual(keys(evaluate("add", ADD_VALUES, { labels: ["coord-request"] }).errors), ["R04:typeLabelMissing"]);
  assert.deepEqual(keys(evaluate("add", ADD_VALUES, { labels: ["type:add", "type:spawn"] }).errors), ["R04:typeLabelMultiple"]);
});

test("option ids and checkboxes", () => {
  assert.equal(optionId("Base / 基地 (base)"), "base");
  assert.equal(optionId("Player_Club (player_club) "), "player_club");
  assert.equal(optionId("Base"), null);
  assert.equal(optionId("Evil (Base)"), null);
  assert.equal(isChecked("- [X] I agree", "I agree"), true);
  assert.equal(isChecked("- [x] I agree", "I agree"), true);
  assert.equal(isChecked("- [ ] I agree", "I agree"), false);
  assert.equal(isChecked("- [X] Something else", "I agree"), false);
});

test("parse: values, _No response_ and None, CRLF bodies", () => {
  const body = renderBody("edit", { target_id: "p0001", dimension: "None", name: "New name" }).replace(/\n/g, "\r\n");
  const { values, errors } = parseIssueBody(body, "edit");
  assert.deepEqual(errors, []);
  assert.equal(values.target_id, "p0001");
  assert.equal(values.dimension, "");
  assert.equal(values.name, "New name");
  assert.equal(values.tags, "");
});

test("R01: missing, duplicated (forged in a text field) and reordered headings", () => {
  const missing = renderBody("add", ADD_VALUES).replace(`### ${FIELD_LABELS.name}\n\n`, "");
  assert.deepEqual(keys(parseIssueBody(missing, "add").errors), ["R01:headingMissing"]);

  const forged = renderBody("add", { ...ADD_VALUES, note: `ok\n### ${FIELD_LABELS.name}\nInjected` });
  const dup = parseIssueBody(forged, "add");
  assert.equal(dup.values, null);
  assert.deepEqual(keys(dup.errors), ["R01:headingDuplicate"]);
  assert.equal(dup.errors[0].params.count, 2);

  const blocks = renderBody("delete", { target_id: "p0001" }).split("\n\n### ");
  const reordered = [blocks[0], `### ${blocks[2]}`, `### ${blocks[1]}`].join("\n\n");
  assert.deepEqual(keys(parseIssueBody(reordered, "delete").errors), ["R01:headingOrder"]);
});

test("add: a valid request is normalized", () => {
  const result = evaluate("add", { ...ADD_VALUES, name: "  My   Base ", tags: ["Village / 村莊 (village)", "Base / 基地 (base)", "Base / 基地 (base)"], note: "line 1\r\n\r\n\r\nline 2" });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.request, {
    issue: 12,
    type: "add",
    submittedBy: "friend-01",
    worldId: "player_club",
    dimension: "overworld",
    name: "My Base",
    tags: ["base", "village"],
    x: 100,
    y: 64,
    z: -200,
    note: "line 1\n\nline 2",
  });
});

test("add: F3 line, Y optional and the either-or rule", () => {
  const f3 = evaluate("add", { ...ADD_VALUES, x: "", y: "", z: "", f3: "XYZ: -0.5 / 64.00000 / 5.699" });
  assert.deepEqual([f3.request.x, f3.request.y, f3.request.z], [-1, 64, 5]);
  const noY = evaluate("add", { ...ADD_VALUES, y: "-" });
  assert.equal(noY.ok, true);
  assert.equal(noY.request.y, null);
  const both = evaluate("add", { ...ADD_VALUES, f3: "1 2 3" });
  assert.deepEqual(keys(both.errors), ["R03:f3AndXyz"]);
  const missing = evaluate("add", { ...ADD_VALUES, x: "", z: "" });
  assert.deepEqual(keys(missing.errors), ["R03:coordRequired", "R03:coordRequired"]);
});

test("add: R02 unknown ids, R03 range, X07 / X08, R07 text, R08 confirmation, R09 retired", () => {
  const dataset = createDataset();
  dataset.worlds.worlds[0].dimensions = ["overworld", "the_nether"];
  const result = evaluate(
    "add",
    {
      ...ADD_VALUES,
      dimension: "The End / 終界 (the_end)",
      name: "bad\u202Ename",
      tags: ["Nope (nope)", "Village / 村莊 (village)", "Old (old_tag)", "Bedrock (bedrock_only)"],
      x: "30,000,001",
      y: "400",
      note: "n".repeat(501),
      confirm: false,
    },
    {},
    dataset,
  );
  assert.deepEqual(keys(result.errors), [
    "R02:tagUnknown",
    "R03:coordRange",
    "R03:coordRange",
    "X07:dimensionNotInWorld",
    "X08:tagDimension",
    "X08:tagDimension",
    "X08:tagEdition",
    "X08:tagDimension",
    "R07:nameControl",
    "R07:noteLength",
    "R08:confirmMissing",
    "R09:tagRetired",
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(keys(evaluate("add", { ...ADD_VALUES, world: "Other (other_world)" }).errors), ["R02:worldUnknown"]);
});

test("add: R06 duplicate warning, nearby hint and same-as-spawn hint", () => {
  const dup = evaluate("add", { ...ADD_VALUES, tags: ["Village / 村莊 (village)"], x: "-426", z: "300" });
  assert.equal(dup.ok, true);
  assert.deepEqual(keys(dup.warnings), ["R06:duplicate"]);
  assert.deepEqual(dup.warnings[0].params.points, [{ id: "p0001", name: "Village 1" }]);

  const near = evaluate("add", { ...ADD_VALUES, x: "-420", z: "310" });
  assert.deepEqual(keys(near.hints), ["R06:nearby"]);
  assert.deepEqual(near.hints[0].params.points, [{ id: "p0001", name: "Village 1", distance: 12 }]);

  const spawn = evaluate("add", { ...ADD_VALUES, x: "7", z: "5" });
  assert.deepEqual(keys(spawn.hints), ["R06:sameAsSpawn"]);
  const nether = evaluate("add", { ...ADD_VALUES, dimension: "The Nether / 地獄 (the_nether)", x: "7", z: "5" });
  assert.deepEqual(nether.hints, []);
});

test("edit: blank keeps, '-' clears, changed fields and the resulting data", () => {
  const result = evaluate("edit", { target_id: "p0002", y: "70", note: "-", name: "Fortress East" });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.changedFields, ["name", "y", "note"]);
  assert.deepEqual(result.diff, [
    { field: "name", before: "Fortress", after: "Fortress East" },
    { field: "y", before: null, after: 70 },
    { field: "note", before: "Near the lava lake\nWest gate", after: null },
  ]);
  assert.equal(result.request.baseUpdatedAt, "2026-09-29T01:00:00Z");
  assert.equal(result.request.targetId, "p0002");
  assert.deepEqual(result.request.tags, ["nether_fortress"]);

  const clearY = evaluate("edit", { target_id: "p0001", y: "－" });
  assert.deepEqual(clearY.changedFields, ["y"]);
  assert.equal(clearY.request.y, null);
});

test("edit: R05 no change, dimension change invalidating tags, R09 only for new tags", () => {
  assert.deepEqual(keys(evaluate("edit", { target_id: "p0001" }).errors), ["R05:noChange"]);
  assert.deepEqual(keys(evaluate("edit", { target_id: "p0001", name: "Village 1", tags: ["Village / 村莊 (village)", "Old (old_tag)"] }).errors), [
    "R05:noChange",
  ]);
  const moved = evaluate("edit", { target_id: "p0001", dimension: "The Nether / 地獄 (the_nether)" });
  assert.deepEqual(keys(moved.errors), ["X08:tagDimension", "X08:tagDimension"]);
  const retired = evaluate("edit", { target_id: "p0002", dimension: "Overworld / 主世界 (overworld)", tags: ["Old (old_tag)"] });
  assert.deepEqual(keys(retired.errors), ["R09:tagRetired"]);
});

test("edit / delete: R04 target checks", () => {
  assert.deepEqual(keys(evaluate("edit", { target_id: "p9999", name: "x" }).errors), ["R04:pointNotFound"]);
  assert.deepEqual(keys(evaluate("edit", { target_id: "p00001", name: "x" }).errors), ["R04:pointIdFormat"]);
  assert.deepEqual(keys(evaluate("edit", { target_id: "spawn:player_club", name: "x" }).errors), ["R04:spawnTargetOnEdit"]);
  assert.deepEqual(keys(evaluate("delete", { target_id: "spawn:player_club" }).errors), ["R04:spawnNotDeletable"]);
  const del = evaluate("delete", { target_id: "p0001", reason: "gone" });
  assert.equal(del.ok, true);
  assert.deepEqual(del.request, { issue: 12, type: "delete", submittedBy: "friend-01", targetId: "p0001", baseUpdatedAt: "2026-09-28T23:00:00Z", worldId: "player_club" });
  assert.deepEqual(keys(evaluate("delete", { target_id: "p0001", confirm: false }).errors), ["R08:confirmMissing"]);
});

test("spawn: X / Y / Z all required, '-' rejected, R05 and target checks", () => {
  const ok = evaluate("spawn", { target_id: "spawn:player_club", f3: "Block: 8 100 -3" });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.changedFields, ["x", "y", "z"]);
  assert.deepEqual(ok.request.baseSpawn, { x: 7, y: 103, z: 5 });
  assert.deepEqual([ok.request.x, ok.request.y, ok.request.z], [8, 100, -3]);

  assert.deepEqual(keys(evaluate("spawn", { target_id: "spawn:player_club", x: "1", y: "-", z: "2" }).errors), ["R03:spawnCoordRequired"]);
  assert.deepEqual(keys(evaluate("spawn", { target_id: "spawn:player_club", x: "1", z: "2" }).errors), ["R03:spawnCoordRequired"]);
  assert.deepEqual(keys(evaluate("spawn", { target_id: "spawn:player_club", x: "7", y: "103", z: "5" }).errors), ["R05:noChange"]);
  assert.deepEqual(keys(evaluate("spawn", { target_id: "spawn:nowhere", x: "1", y: "2", z: "3" }).errors), ["R04:worldNotFound"]);
  assert.deepEqual(keys(evaluate("spawn", { target_id: "p0001", x: "1", y: "2", z: "3" }).errors), ["R04:pointTargetOnSpawn"]);
  assert.deepEqual(keys(evaluate("spawn", { target_id: "spawn:Bad", x: "1", y: "2", z: "3" }).errors), ["R04:spawnTargetFormat"]);
  assert.deepEqual(keys(evaluate("spawn", { target_id: "spawn:player_club", x: "1", y: "999", z: "3" }).errors), ["R03:coordRange"]);
});

test("spawn: F3 and X / Y / Z filled together is rejected with R03 f3AndXyz and changes nothing", () => {
  const both = evaluate("spawn", { target_id: "spawn:player_club", f3: "Block: 8 100 -3", x: "8", y: "100", z: "-3" });
  assert.deepEqual(keys(both.errors), ["R03:f3AndXyz"]);
  assert.equal(both.ok, false);
  assert.deepEqual(both.changedFields, []);
  const oneAxis = evaluate("spawn", { target_id: "spawn:player_club", f3: "XYZ: 8.5 / 100 / -3.2", y: "100" });
  assert.deepEqual(keys(oneAxis.errors), ["R03:f3AndXyz"], "a single axis next to the F3 line is enough");
});

test("add / edit: a multi-select with 40 tags keeps every tag, deduplicated, in tags.json order", () => {
  const dataset = createDataset();
  const ids = Array.from({ length: 40 }, (_, i) => `tag_${String(i + 1).padStart(2, "0")}`);
  dataset.tags.tags.push(...ids.map((id, i) => ({ id, group: "facility", name: { en: `Tag ${i + 1}`, "zh-TW": `標籤 ${i + 1}` }, dimensions: ["overworld"] })));
  const options = ids.map((id, i) => `Tag ${i + 1} / 標籤 ${i + 1} (${id})`);
  const selected = [...options].reverse().concat(options[0]);

  const parsed = parseIssueBody(renderBody("add", { ...ADD_VALUES, tags: selected }), "add");
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.values.tags, selected.join(", "), "the multi-select line is kept whole");

  const add = evaluate("add", { ...ADD_VALUES, tags: selected }, {}, dataset);
  assert.deepEqual(add.errors, []);
  assert.deepEqual(add.request.tags, ids);

  const edit = evaluate("edit", { target_id: "p0001", tags: selected }, {}, dataset);
  assert.deepEqual(edit.errors, []);
  assert.deepEqual(edit.changedFields, ["tags"]);
  assert.deepEqual(edit.request.tags, ids);
});

test("injection strings are kept as inert data", () => {
  const payloads = ["$(touch /tmp/pwned)", "`id`", "${{ github.token }}", "<img src=x onerror=alert(1)>", "'; rm -rf / #"];
  for (const payload of payloads) {
    const result = evaluate("add", { ...ADD_VALUES, name: payload, note: payload });
    assert.equal(result.ok, true, payload);
    assert.equal(result.request.name, payload);
    assert.equal(result.request.note, payload);
  }
  const target = evaluate("edit", { target_id: "$(whoami)", name: "x" });
  assert.deepEqual(keys(target.errors), ["R04:pointIdFormat"]);
  assert.equal(target.request.targetId, "$(whoami)");
});
