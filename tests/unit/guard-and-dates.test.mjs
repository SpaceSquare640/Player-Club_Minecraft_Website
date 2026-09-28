// Public text guard (X16) and date helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findInternalText } from "../../scripts/lib/public-text-guard.mjs";
import { addDays, dateInTimeZone, formatUtcTimestamp, isValidTimeZone } from "../../scripts/lib/dates.mjs";

test("guard flags internal words and paths", () => {
  assert.deepEqual(findInternalText("Updated by the Agent"), ["agent"]);
  assert.deepEqual(findInternalText("subagent notes"), ["subagent"]);
  assert.deepEqual(findInternalText("Claude helped"), ["claude"]);
  assert.deepEqual(findInternalText("Obsidian vault"), ["obsidian"]);
  assert.deepEqual(findInternalText("更新筆記"), ["notes-zh"]);
  assert.deepEqual(findInternalText("見操作紀錄"), ["operation-log-zh"]);
  assert.deepEqual(findInternalText("D:\\Code\\site"), ["windows-path"]);
  assert.deepEqual(findInternalText("/Users/kingsley/site"), ["home-path"]);
});

test("guard does not flag ordinary text", () => {
  for (const text of ["Added a reagent farm", "Management page", "Nether conversion", "新增座標：Village 1", "Point data: Player_Club / Overworld", "X: 1/2"]) {
    assert.deepEqual(findInternalText(text), [], text);
  }
});

test("formatUtcTimestamp drops milliseconds", () => {
  assert.equal(formatUtcTimestamp(new Date("2026-09-29T08:00:00.789Z")), "2026-09-29T08:00:00Z");
});

test("dateInTimeZone uses the configured zone around midnight", () => {
  assert.equal(dateInTimeZone(new Date("2026-09-29T15:59:59Z"), "Asia/Taipei"), "2026-09-29");
  assert.equal(dateInTimeZone(new Date("2026-09-29T16:00:00Z"), "Asia/Taipei"), "2026-09-30");
  assert.equal(dateInTimeZone(new Date("2026-09-29T16:00:00Z"), "UTC"), "2026-09-29");
});

test("addDays handles month and year ends", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
});

test("isValidTimeZone accepts IANA names only", () => {
  assert.equal(isValidTimeZone("Asia/Taipei"), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("Mars/Olympus"), false);
  assert.equal(isValidTimeZone("+08:00"), false);
  assert.equal(isValidTimeZone(""), false);
});
