// Change log templates, changelog:sync and changelog:update.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPointChangeEntry, buildSpawnChangeEntry, dimensionName } from "../../scripts/lib/changelog-templates.mjs";
import { syncChangelog } from "../../scripts/changelog-sync.mjs";
import { addUpdateEntry } from "../../scripts/changelog-update.mjs";
import { validateDataset } from "../../scripts/validate.mjs";
import { NOW, createDataset, createDictionaries } from "../fixtures/dataset.mjs";

const STAMP = "2026-09-29T12:00:00Z";

test("point templates: add, edit (merged coordinates) and delete", () => {
  const base = { id: "c0009", date: "2026-09-30", worldName: "Player_Club", source: { type: "issue", issue: 12 } };
  const target = { worldId: "player_club", id: "p0003", dimension: "the_nether", name: "Village 2" };

  const add = buildPointChangeEntry({ ...base, action: "add", target });
  assert.deepEqual(add.summary, { en: "Added point: Village 2", "zh-TW": "新增座標：Village 2" });
  assert.deepEqual(add.scope, { en: "Point data: Player_Club / The Nether", "zh-TW": "座標資料：Player_Club／地獄" });
  assert.equal("changedFields" in add, false);

  const edit = buildPointChangeEntry({ ...base, action: "edit", target, changedFields: ["z", "note", "x", "name"] });
  assert.deepEqual(edit.changedFields, ["name", "x", "z", "note"]);
  assert.deepEqual(edit.summary, {
    en: "Updated point: Village 2 (name, coordinates, note)",
    "zh-TW": "修改座標：Village 2（名稱、座標、說明）",
  });

  const del = buildPointChangeEntry({ ...base, action: "delete", target });
  assert.deepEqual(del.summary, { en: "Removed point: Village 2", "zh-TW": "刪除座標：Village 2" });
});

test("spawn template uses the overworld and only x/y/z", () => {
  const entry = buildSpawnChangeEntry({
    id: "c0010",
    date: "2026-09-30",
    worldId: "player_club",
    changedFields: ["z", "x"],
    worldName: "Player_Club",
    source: { type: "manual" },
  });
  assert.deepEqual(entry.target, { type: "spawn", worldId: "player_club" });
  assert.deepEqual(entry.changedFields, ["x", "z"]);
  assert.deepEqual(entry.summary, { en: "Updated world spawn: Player_Club", "zh-TW": "修改世界出生座標：Player_Club" });
  assert.deepEqual(entry.scope, { en: "World spawn: Player_Club / Overworld", "zh-TW": "世界出生座標：Player_Club／主世界" });
});

test("dimension names come from dictionaries when available", () => {
  const dict = createDictionaries();
  dict.en.messages["dimension.the_end"] = "End";
  assert.equal(dimensionName("the_end", "en", dict), "End");
  assert.equal(dimensionName("the_end", "zh-TW", dict), "終界");
  assert.equal(dimensionName("the_end", "en", null), "The End");
});

function editedDataset() {
  const ds = createDataset();
  const [p1] = ds.points.player_club.points;
  // edit p0001: name and coordinates
  p1.name = "Village One";
  p1.x = -400;
  p1.z = 310;
  // delete p0002
  ds.points.player_club.points = [p1];
  // add p0003 with blank timestamps (allocated with new-id)
  ds.manifest.pointSeq = 3;
  ds.points.player_club.points.push({
    id: "p0003",
    dimension: "overworld",
    name: "Base camp",
    tags: ["base"],
    x: 100,
    y: 64,
    z: -100,
    submittedBy: "SpaceSquare640",
    createdAt: "",
    updatedAt: "",
  });
  // spawn change
  ds.worlds.worlds[0].spawn = { x: 8, y: 103, z: 5 };
  return ds;
}

test("changelog:sync adds entries for add / edit / delete / spawn and fills timestamps", () => {
  const head = createDataset();
  const result = syncChangelog({ current: editedDataset(), head, now: NOW });

  assert.deepEqual(result.created.map((e) => [e.id, e.action, e.target.type, e.target.id ?? null]), [
    ["c0003", "edit", "spawn", null],
    ["c0004", "edit", "point", "p0001"],
    ["c0005", "delete", "point", "p0002"],
    ["c0006", "add", "point", "p0003"],
  ]);
  const [spawn, edit, del, add] = result.created;
  assert.deepEqual(spawn.changedFields, ["x"]);
  assert.deepEqual(edit.changedFields, ["name", "x", "z"]);
  assert.equal(edit.summary["zh-TW"], "修改座標：Village One（名稱、座標）");
  assert.deepEqual(del.target, { type: "point", worldId: "player_club", id: "p0002", dimension: "the_nether", name: "Fortress" });
  assert.equal(add.summary.en, "Added point: Base camp");
  assert.ok(result.created.every((e) => e.date === "2026-09-29" && e.source.type === "manual"));
  assert.equal(result.dataset.manifest.changeSeq, 6);

  const [p1, p3] = result.dataset.points.player_club.points;
  assert.equal(p1.updatedAt, STAMP);
  assert.equal(p1.createdAt, "2026-09-28T23:00:00Z");
  assert.equal(p3.createdAt, STAMP);
  assert.equal(p3.updatedAt, STAMP);

  const check = validateDataset(result.dataset, { head, now: NOW });
  assert.deepEqual(check.errors, []);
});

test("changelog:sync is idempotent", () => {
  const head = createDataset();
  const first = syncChangelog({ current: editedDataset(), head, now: NOW });
  const second = syncChangelog({ current: first.dataset, head, now: new Date("2026-09-29T13:00:00Z") });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.dataset, first.dataset);
});

test("changelog:sync with no changes does nothing", () => {
  const result = syncChangelog({ current: createDataset(), head: createDataset(), now: NOW });
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.dataset, createDataset());
});

test("changelog:update appends a bilingual entry and advances updateSeq", () => {
  const { dataset, entry } = addUpdateEntry(createDataset(), {
    summary: { en: "  Added Nether conversion ", "zh-TW": "新增地獄座標換算" },
    scope: { en: "Point cards", "zh-TW": "座標卡片" },
    now: NOW,
  });
  assert.deepEqual(entry, {
    id: "u0002",
    date: "2026-09-29",
    summary: { en: "Added Nether conversion", "zh-TW": "新增地獄座標換算" },
    scope: { en: "Point cards", "zh-TW": "座標卡片" },
  });
  assert.equal(dataset.manifest.updateSeq, 2);
  assert.equal(dataset.updates.entries.length, 2);
});

test("changelog:update rejects empty, too long or internal text", () => {
  const input = (summaryEn, scopeZh = "全站") => ({
    summary: { en: summaryEn, "zh-TW": "更新" },
    scope: { en: "Entire site", "zh-TW": scopeZh },
    now: NOW,
  });
  assert.throws(() => addUpdateEntry(createDataset(), input("")), /Invalid update entry/);
  assert.throws(() => addUpdateEntry(createDataset(), input("x".repeat(201))), /Invalid update entry/);
  assert.throws(() => addUpdateEntry(createDataset(), input("Built with an agent")), /internal information \(agent\)/);
  assert.throws(() => addUpdateEntry(createDataset(), input("Fix", "詳見操作記錄")), /internal information/);
});
