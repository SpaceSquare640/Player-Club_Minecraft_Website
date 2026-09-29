// Pure view logic of site/js/ui/model.js and the issue links of site/js/lib/issue-links.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CARD_TAG_LIMIT,
  CHANGELOG_PAGE_SIZE,
  buildTagFilters,
  cardTagLayout,
  coordDisplay,
  countByDimension,
  groupByDate,
  hasConditions,
  nextIndex,
  orderCardTags,
  orderedDimensions,
  pageEntries,
  pointDateMeta,
  resultSummary,
  spawnRadiusLabel,
  tagsForDimension,
  versionLabel,
  worldTypeKey,
  zonedDateTime,
} from "../../site/js/ui/model.js";
import { ISSUE_KINDS, buildNewIssueUrl } from "../../site/js/lib/issue-links.js";
import { ISSUE_TEMPLATES } from "../../site/js/lib/forms-meta.js";

const TAGS = [
  { id: "spawn", group: "facility", dimensions: ["overworld"], name: { en: "Spawn", "zh-TW": "出生點" } },
  { id: "base", group: "facility", dimensions: ["overworld", "the_nether", "the_end"], name: { en: "Base", "zh-TW": "基地" } },
  { id: "farm", group: "facility", dimensions: ["overworld", "the_nether"], name: { en: "Farm", "zh-TW": "農場" } },
  { id: "village", group: "structure", dimensions: ["overworld"], name: { en: "Village", "zh-TW": "村莊" } },
  { id: "fortress", group: "structure", dimensions: ["the_nether"], name: { en: "Fortress", "zh-TW": "地獄要塞" } },
  { id: "old", group: "misc", dimensions: ["overworld"], retired: true, name: { en: "Old", "zh-TW": "舊" } },
  { id: "java_only", group: "misc", dimensions: ["overworld"], editions: ["java"], name: { en: "Java", "zh-TW": "Java" } },
  { id: "bedrock_only", group: "misc", dimensions: ["overworld"], editions: ["bedrock"], name: { en: "Bedrock", "zh-TW": "基岩" } },
];
const GROUPS = [{ id: "facility" }, { id: "structure" }, { id: "misc" }];
const point = (id, dimension, tags, extra = {}) => ({ id, dimension, tags, name: id, x: 0, y: 0, z: 0, ...extra });

test("card tags: selected first, then tags.json order, duplicates removed", () => {
  assert.deepEqual(orderCardTags(["village", "base", "spawn", "base"], { tags: TAGS }), ["spawn", "base", "village"]);
  assert.deepEqual(orderCardTags(["village", "base", "spawn"], { tags: TAGS, selected: ["village"] }), ["village", "spawn", "base"]);
  assert.deepEqual(orderCardTags(["unknown", "base"], { tags: TAGS }), ["base", "unknown"]);
});

test("card tags +N rule: up to 4 shown as is, above that 3 plus +N (N >= 2)", () => {
  assert.equal(CARD_TAG_LIMIT, 4);
  const ids = (n) => Array.from({ length: n }, (_, i) => `t${i}`);
  assert.deepEqual(cardTagLayout(ids(3)), { visible: ids(3), hiddenCount: 0, collapsible: false });
  assert.deepEqual(cardTagLayout(ids(4)), { visible: ids(4), hiddenCount: 0, collapsible: false });
  assert.deepEqual(cardTagLayout(ids(5)), { visible: ids(3), hiddenCount: 2, collapsible: true });
  assert.deepEqual(cardTagLayout(ids(12)), { visible: ids(3), hiddenCount: 9, collapsible: true });
  assert.deepEqual(cardTagLayout(ids(12), { expanded: true }), { visible: ids(12), hiddenCount: 0, collapsible: true });
  assert.deepEqual(cardTagLayout(ids(4), { expanded: true }), { visible: ids(4), hiddenCount: 0, collapsible: false });
});

test("filter chips: dimension and edition, group order, tags with points first, retired only when selected", () => {
  const points = [point("p0001", "overworld", ["village", "base"]), point("p0002", "overworld", ["village"]), point("p0003", "the_nether", ["farm"])];
  const chips = buildTagFilters({ tags: TAGS, groups: GROUPS, points, dimension: "overworld", edition: "java", selected: [] });
  assert.deepEqual(
    chips.map((c) => [c.id, c.count, c.disabled]),
    [
      ["base", 1, false],
      ["spawn", 0, true],
      ["farm", 0, true],
      ["village", 2, false],
      ["java_only", 0, true],
    ],
  );
  const withRetired = buildTagFilters({ tags: TAGS, groups: GROUPS, points, dimension: "overworld", edition: "java", selected: ["old", "spawn"] });
  const old = withRetired.find((c) => c.id === "old");
  assert.deepEqual([old.selected, old.disabled], [true, false]);
  assert.equal(withRetired.find((c) => c.id === "spawn").disabled, false, "a selected chip with no data stays usable");
  assert.deepEqual(tagsForDimension(TAGS, "the_nether", "java").map((tag) => tag.id), ["base", "farm", "fortress"]);
});

test("dimension counts follow the search query, not the tags", () => {
  const points = [
    point("p0001", "overworld", ["village"], { name: "Village 1" }),
    point("p0002", "overworld", ["base"], { name: "Home" }),
    point("p0003", "the_nether", ["farm"], { name: "Gold farm" }),
  ];
  const dims = ["overworld", "the_nether", "the_end"];
  assert.deepEqual(countByDimension(points, dims, "", TAGS), { overworld: 2, the_nether: 1, the_end: 0 });
  assert.deepEqual(countByDimension(points, dims, "village", TAGS), { overworld: 1, the_nether: 0, the_end: 0 });
  assert.deepEqual(countByDimension(points, dims, "農場", TAGS), { overworld: 0, the_nether: 1, the_end: 0 });
  assert.deepEqual(orderedDimensions({ dimensions: ["the_end", "overworld"] }), ["overworld", "the_end"]);
});

test("result summary and conditions", () => {
  assert.deepEqual(resultSummary({ shown: 3, total: 3, filtered: false }), { key: "result.count", plural: true, params: { n: 3 } });
  assert.deepEqual(resultSummary({ shown: 1, total: 3, filtered: true }), { key: "result.filtered", plural: false, params: { n: 1, total: 3 } });
  assert.equal(hasConditions({ query: "", tagIds: [] }), false);
  assert.equal(hasConditions({ query: "a", tagIds: [] }), true);
  assert.equal(hasConditions({ query: "", tagIds: ["village"] }), true);
});

test("coordinate display: ASCII values, missing Y, long values switch layout", () => {
  assert.deepEqual(coordDisplay({ x: -426, y: 72, z: 300 }), { x: "-426", y: "72", z: "300", long: false });
  assert.deepEqual(coordDisplay({ x: 7, y: null, z: 5 }), { x: "7", y: null, z: "5", long: false });
  assert.equal(coordDisplay({ x: -1234567, y: 64, z: 0 }).long, true);
  assert.equal(coordDisplay({ x: 1234567, y: 64, z: 0 }).long, false);
  assert.equal(coordDisplay({ x: 0, y: 0, z: -30000000 }).long, true);
});

test("dates use Asia/Taipei regardless of the visitor's time zone", () => {
  assert.deepEqual(zonedDateTime("2026-09-28T23:00:00Z"), { date: "2026-09-29", time: "07:00" });
  assert.deepEqual(zonedDateTime("2026-09-29T15:59:00Z"), { date: "2026-09-29", time: "23:59" });
  assert.deepEqual(zonedDateTime("2026-09-29T16:00:00Z"), { date: "2026-09-30", time: "00:00" });
  assert.deepEqual(zonedDateTime("2026-09-29T16:00:00Z", "UTC"), { date: "2026-09-29", time: "16:00" });
  assert.equal(zonedDateTime("not a date"), null);
  const added = pointDateMeta({ createdAt: "2026-09-28T23:00:00Z", updatedAt: "2026-09-28T23:00:00Z" }, "Asia/Taipei");
  assert.deepEqual(added, { labelKey: "card.createdAt", timestamp: "2026-09-28T23:00:00Z", date: "2026-09-29", time: "07:00" });
  const updated = pointDateMeta({ createdAt: "2026-09-28T23:00:00Z", updatedAt: "2026-09-30T16:30:00Z" }, "Asia/Taipei");
  assert.equal(updated.labelKey, "card.updatedAt");
  assert.equal(updated.date, "2026-10-01");
});

test("change log grouping and paging", () => {
  const entries = [
    { id: "u0003", date: "2026-10-02" },
    { id: "u0002", date: "2026-10-01" },
    { id: "u0001", date: "2026-10-01" },
  ];
  assert.deepEqual(
    groupByDate(entries).map((g) => [g.date, g.entries.map((e) => e.id)]),
    [
      ["2026-10-02", ["u0003"]],
      ["2026-10-01", ["u0002", "u0001"]],
    ],
  );
  assert.equal(CHANGELOG_PAGE_SIZE, 30);
  const many = Array.from({ length: 65 }, (_, i) => ({ id: i }));
  assert.equal(pageEntries(many, 1).shown.length, 30);
  assert.equal(pageEntries(many, 1).hasMore, true);
  assert.equal(pageEntries(many, 3).shown.length, 65);
  assert.equal(pageEntries(many, 3).hasMore, false);
  assert.equal(pageEntries(many, 0).shown.length, 30);
});

test("keyboard navigation wraps around", () => {
  assert.equal(nextIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextIndex(2, "ArrowDown", 3), 0);
  assert.equal(nextIndex(0, "ArrowUp", 3), 2);
  assert.equal(nextIndex(-1, "ArrowDown", 3), 0);
  assert.equal(nextIndex(-1, "ArrowUp", 3), 2);
  assert.equal(nextIndex(1, "Home", 3), 0);
  assert.equal(nextIndex(1, "End", 3), 2);
  assert.equal(nextIndex(1, "ArrowRight", 3), null);
  assert.equal(nextIndex(1, "ArrowRight", 3, { axis: "horizontal" }), 2);
  assert.equal(nextIndex(0, "ArrowLeft", 3, { axis: "horizontal" }), 2);
  assert.equal(nextIndex(0, "Enter", 3), null);
  assert.equal(nextIndex(0, "ArrowDown", 0), null);
});

test("version label", () => {
  assert.deepEqual(versionLabel({ edition: "java", gameVersion: "latest" }), { key: "world.version.latest", editionKey: "edition.java", params: {} });
  assert.deepEqual(versionLabel({ edition: "bedrock", gameVersion: "1.21.2" }), { key: "world.version.fixed", editionKey: "edition.bedrock", params: { version: "1.21.2" } });
});

test("optional world type and respawn radius: shown only when present and well formed", () => {
  assert.equal(worldTypeKey({ worldType: "superflat" }), "worldType.superflat");
  assert.equal(worldTypeKey({ worldType: "large_biomes" }), "worldType.large_biomes");
  for (const world of [{}, { worldType: "" }, { worldType: "Superflat" }, { worldType: "a.b" }, { worldType: 1 }, null]) {
    assert.equal(worldTypeKey(world), null, JSON.stringify(world));
  }
  assert.deepEqual(spawnRadiusLabel({ spawnRadius: 5 }), { key: "world.spawnRadius.value", n: 5 });
  assert.deepEqual(spawnRadiusLabel({ spawnRadius: 0 }), { key: "world.spawnRadius.value", n: 0 });
  for (const world of [{}, { spawnRadius: -1 }, { spawnRadius: 2.5 }, { spawnRadius: "5" }, { spawnRadius: null }, null]) {
    assert.equal(spawnRadiusLabel(world), null, JSON.stringify(world));
  }
});

test("issue links: template per kind and target_id prefill", () => {
  const config = { repo: { owner: "SpaceSquare640", name: "Player-Club_Minecraft_Website" } };
  const base = "https://github.com/SpaceSquare640/Player-Club_Minecraft_Website/issues/new?template=";
  assert.deepEqual(ISSUE_KINDS, ["add", "edit", "delete", "spawn"]);
  assert.equal(buildNewIssueUrl(config, "add"), `${base}${ISSUE_TEMPLATES.add}`);
  assert.equal(buildNewIssueUrl(config, "edit", { pointId: "p0001" }), `${base}2-edit-point.yml&target_id=p0001`);
  assert.equal(buildNewIssueUrl(config, "delete", { pointId: "p10000" }), `${base}3-delete-point.yml&target_id=p10000`);
  const spawn = new URL(buildNewIssueUrl(config, "spawn", { worldId: "player_club" }));
  assert.equal(spawn.searchParams.get("template"), "4-edit-spawn.yml");
  assert.equal(spawn.searchParams.get("target_id"), "spawn:player_club");
  assert.throws(() => buildNewIssueUrl(config, "edit", { pointId: "p00001" }), TypeError);
  assert.throws(() => buildNewIssueUrl(config, "spawn", { worldId: "Bad World" }), TypeError);
  assert.throws(() => buildNewIssueUrl(config, "rename"), RangeError);
  assert.throws(() => buildNewIssueUrl({}, "add"), TypeError);
});
