// Cross validation rules (scripts/lib/cross-rules.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isInt64String, runCrossRules } from "../../scripts/lib/cross-rules.mjs";
import { validateDataset } from "../../scripts/validate.mjs";
import { NOW, addSecondWorld, createDataset, createDictionaries } from "../fixtures/dataset.mjs";

const run = (ds, options = {}) => runCrossRules(ds, { now: NOW, ...options });
const errors = (issues, code) => issues.filter((i) => i.level === "error" && (!code || i.code === code));
const warnings = (issues, code) => issues.filter((i) => i.level === "warning" && (!code || i.code === code));
const point = (ds, i = 0) => ds.points.player_club.points[i];

function withDictionaries(ds = createDataset()) {
  ds.i18n = createDictionaries();
  return ds;
}

test("valid fixture has no errors (and only the dictionary warning without i18n)", () => {
  const issues = run(createDataset());
  assert.deepEqual(errors(issues), []);
  assert.deepEqual(warnings(issues).map((i) => i.code), ["X19"]);
  assert.deepEqual(run(withDictionaries()), []);
});

test("validateDataset: schema errors block cross rules", () => {
  const ds = createDataset();
  ds.worlds.worlds[0].seed = 123;
  const result = validateDataset(ds, { now: NOW });
  assert.equal(result.crossSkipped, true);
  assert.ok(result.errors.every((e) => e.code === "SCHEMA"));
  assert.ok(result.errors.length > 0);
});

test("X01 every file uses the supported schemaVersion from the manifest", () => {
  const ds = createDataset();
  ds.tags.schemaVersion = 2;
  assert.equal(errors(run(ds), "X01")[0].file, "site/data/tags.json");
  const ds2 = createDataset();
  ds2.manifest.schemaVersion = 2;
  assert.ok(errors(run(ds2), "X01").some((e) => e.file === "site/data/manifest.json"));
});

test("X02 default world must exist", () => {
  const ds = createDataset();
  ds.config.defaultWorldId = "missing_world";
  assert.equal(errors(run(ds), "X02").length, 1);
});

test("X03 world edition must exist", () => {
  const ds = createDataset();
  ds.worlds.worlds[0].edition = "pocket";
  assert.equal(errors(run(ds), "X03").length, 1);
});

test("X04 one points file per world and no orphan files; X05 worldId equals file name", () => {
  const missing = createDataset();
  delete missing.points.player_club;
  assert.equal(errors(run(missing), "X04")[0].file, "site/data/points/player_club.json");

  const orphan = createDataset();
  orphan.points.old_world = { schemaVersion: 1, worldId: "old_world", points: [] };
  assert.equal(errors(run(orphan), "X04")[0].file, "site/data/points/old_world.json");

  const mismatch = createDataset();
  mismatch.points.player_club.worldId = "other";
  assert.equal(errors(run(mismatch), "X05").length, 1);
});

test("X06 point ids: standard form, 1..pointSeq, ascending, globally unique", () => {
  const nonStandard = createDataset();
  point(nonStandard, 1).id = "p00002";
  assert.match(errors(run(nonStandard), "X06")[0].message, /not a standard id/);

  const zero = createDataset();
  point(zero).id = "p0000";
  assert.ok(errors(run(zero), "X06").some((e) => /outside 1\.\.pointSeq/.test(e.message)));

  const aboveSeq = createDataset();
  point(aboveSeq, 1).id = "p0003";
  assert.ok(errors(run(aboveSeq), "X06").some((e) => /outside 1\.\.pointSeq \(2\)/.test(e.message)));

  const big = createDataset();
  big.manifest.pointSeq = 10000;
  point(big, 1).id = "p10000";
  assert.deepEqual(errors(run(big), "X06"), [], "p10000 is valid once pointSeq reaches 10000");

  const order = createDataset();
  order.points.player_club.points.reverse();
  assert.ok(errors(run(order), "X06").some((e) => /ascending/.test(e.message)));

  const crossFile = addSecondWorld(createDataset(), [
    { ...point(createDataset()), dimension: "overworld", tags: ["base"] },
  ]);
  const dup = errors(run(crossFile), "X06");
  assert.equal(dup.length, 1);
  assert.match(dup[0].message, /Duplicate point id p0001/);
});

test("X07 point dimension must belong to its world", () => {
  const ds = addSecondWorld(createDataset(), [
    {
      id: "p0003",
      dimension: "the_end",
      name: "End spot",
      tags: ["base"],
      x: 0,
      y: 60,
      z: 0,
      submittedBy: "SpaceSquare640",
      createdAt: "2026-09-29T00:00:00Z",
      updatedAt: "2026-09-29T00:00:00Z",
    },
  ]);
  ds.manifest.pointSeq = 3;
  assert.equal(errors(run(ds), "X07").length, 1);
});

test("X08 tags exist, allow the dimension and the world edition; retired tags stay valid", () => {
  const unknown = createDataset();
  point(unknown).tags = ["village", "castle"];
  assert.match(errors(run(unknown), "X08")[0].message, /castle does not exist/);

  const wrongDim = createDataset();
  point(wrongDim).tags = ["nether_fortress"];
  assert.match(errors(run(wrongDim), "X08")[0].message, /not allowed in overworld/);

  const wrongEdition = createDataset();
  point(wrongEdition).tags = ["bedrock_only"];
  assert.match(errors(run(wrongEdition), "X08")[0].message, /edition java/);

  const retired = createDataset();
  assert.ok(point(retired).tags.includes("old_tag"));
  assert.deepEqual(errors(run(retired), "X08"), []);
});

test("X09 point and spawn bounds, including version overrides", () => {
  const edge = createDataset();
  Object.assign(point(edge), { x: 30000000, y: 320, z: -30000000 });
  Object.assign(point(edge, 1), { y: null });
  edge.worlds.worlds[0].spawn = { x: -30000000, y: -64, z: 30000000 };
  assert.deepEqual(errors(run(edge), "X09"), []);

  const outside = createDataset();
  point(outside).x = 30000001;
  point(outside, 1).y = -65;
  assert.equal(errors(run(outside), "X09").length, 2);

  const spawn = createDataset();
  spawn.worlds.worlds[0].spawn.y = 321;
  assert.equal(errors(run(spawn), "X09")[0].path, "/worlds/0/spawn");

  const spawnX = createDataset();
  spawnX.worlds.worlds[0].spawn.x = 30000001;
  assert.equal(errors(run(spawnX), "X09").length, 1);

  const override = createDataset();
  override.worlds.worlds[0].gameVersion = "1.16.5";
  override.editions.editions[0].versionOverrides = [{ maxVersion: "1.17.1", bounds: { xzAbsMax: 30000000, yMin: 0, yMax: 256 } }];
  point(override).y = -10;
  assert.equal(errors(run(override), "X09").length, 1, "old version uses the override (yMin 0)");
  override.worlds.worlds[0].gameVersion = "latest";
  assert.deepEqual(errors(run(override), "X09"), [], "latest ignores overrides");

  const badBounds = createDataset();
  badBounds.editions.editions[1].bounds.yMin = 400;
  badBounds.editions.editions[0].versionOverrides = [{ minVersion: "1.20", maxVersion: "1.18", bounds: { xzAbsMax: 1, yMin: 0, yMax: 1 } }];
  assert.equal(errors(run(badBounds), "X09").length, 2);
});

test("X10 createdAt <= updatedAt <= now + 10 minutes", () => {
  const order = createDataset();
  point(order).createdAt = "2026-09-29T00:00:00Z";
  point(order).updatedAt = "2026-09-28T00:00:00Z";
  assert.match(errors(run(order), "X10")[0].message, /createdAt is later/);

  const future = createDataset();
  point(future).updatedAt = "2026-09-29T12:11:00Z";
  assert.match(errors(run(future), "X10")[0].message, /future/);

  const tolerated = createDataset();
  point(tolerated).updatedAt = "2026-09-29T12:09:00Z";
  assert.deepEqual(errors(run(tolerated), "X10"), []);
});

test("X11 seed within int64 using BigInt", () => {
  assert.equal(isInt64String("652938494491123000"), true);
  assert.equal(isInt64String("9223372036854775807"), true);
  assert.equal(isInt64String("-9223372036854775808"), true);
  assert.equal(isInt64String("9223372036854775808"), false);
  assert.equal(isInt64String("-9223372036854775809"), false);
  assert.equal(isInt64String("9999999999999999999"), false);
  assert.equal(isInt64String(652938494491123000), false);

  const ds = createDataset();
  ds.worlds.worlds[0].seed = "9223372036854775808";
  assert.equal(errors(run(ds), "X11").length, 1);
  ds.worlds.worlds[0].seed = "-9223372036854775808";
  assert.deepEqual(errors(run(ds), "X11"), []);
});

test("X12 unique ids, known tag group and edition; empty group is a warning", () => {
  const dupTag = createDataset();
  dupTag.tags.tags.push({ ...dupTag.tags.tags[0] });
  assert.match(errors(run(dupTag), "X12")[0].message, /Duplicate tag id: base/);

  const dupWorld = addSecondWorld(createDataset());
  dupWorld.worlds.worlds[1].id = "player_club";
  delete dupWorld.points.survival_two;
  assert.ok(errors(run(dupWorld), "X12").some((e) => /Duplicate world id/.test(e.message)));

  const badGroup = createDataset();
  badGroup.tags.tags[0].group = "nope";
  assert.match(errors(run(badGroup), "X12")[0].message, /unknown group/);

  const badEdition = createDataset();
  badEdition.tags.tags[3].editions = ["console"];
  assert.match(errors(run(badEdition), "X12")[0].message, /unknown edition/);

  const emptyGroup = createDataset();
  emptyGroup.tags.groups.push({ id: "misc", name: { en: "Miscellaneous", "zh-TW": "其他" } });
  assert.equal(warnings(run(emptyGroup), "X12").length, 1);
});

test("X13 VPN worlds must exist", () => {
  const ds = createDataset();
  ds.vpn.vpns[0].worldIds.push("gone_world");
  assert.equal(errors(run(ds), "X13").length, 1);
});

test("X14 password-like keys are rejected anywhere in site/data", () => {
  const ds = createDataset();
  ds.vpn.vpns[0].networkPassword = "hunter2";
  ds.config.apiToken = "x";
  const found = errors(run(ds), "X14");
  assert.deepEqual(found.map((e) => e.path).sort(), ["/apiToken", "/vpns/0/networkPassword"]);
});

test("X15 change log ids, sequences, dates, issue numbers and target worlds", () => {
  const nonStandard = createDataset();
  nonStandard.changes.entries[1].id = "c00002";
  assert.match(errors(run(nonStandard), "X15")[0].message, /not a standard id/);

  const aboveSeq = createDataset();
  aboveSeq.manifest.updateSeq = 0;
  assert.match(errors(run(aboveSeq), "X15")[0].message, /outside 1\.\.updateSeq/);

  const order = createDataset();
  order.changes.entries.reverse();
  assert.ok(errors(run(order), "X15").some((e) => /ascending/.test(e.message)));

  const dupIssue = createDataset();
  dupIssue.manifest.changeSeq = 3;
  dupIssue.changes.entries.push({ ...dupIssue.changes.entries[1], id: "c0003" });
  assert.ok(errors(run(dupIssue), "X15").some((e) => /Issue #3 is already recorded/.test(e.message)));

  const tomorrow = createDataset();
  tomorrow.updates.entries[0].date = "2026-09-30";
  assert.deepEqual(errors(run(tomorrow), "X15"), [], "today + 1 is allowed");
  tomorrow.updates.entries[0].date = "2026-10-01";
  assert.match(errors(run(tomorrow), "X15")[0].message, /later than 2026-09-30/);

  // 16:30 UTC is already 2026-09-30 in Asia/Taipei, so 2026-10-01 becomes allowed.
  const midnight = createDataset();
  midnight.updates.entries[0].date = "2026-10-01";
  assert.deepEqual(errors(runCrossRules(midnight, { now: new Date("2026-09-29T16:30:00Z") }), "X15"), []);
  assert.equal(errors(runCrossRules(midnight, { now: new Date("2026-09-29T15:59:00Z") }), "X15").length, 1);

  const goneWorld = createDataset();
  goneWorld.changes.entries[0].target.worldId = "deleted_world";
  assert.equal(warnings(run(goneWorld), "X15").length, 1);
  assert.deepEqual(errors(run(goneWorld), "X15"), []);
});

test("X16 public text guard on change log and dictionaries", () => {
  const ds = withDictionaries();
  ds.updates.entries[0].summary.en = "Refactored by an agent";
  ds.changes.entries[0].scope["zh-TW"] = "見筆記";
  ds.i18n.en.messages["nav.changelog"] = "See C:\\Users\\me";
  const found = errors(run(ds), "X16");
  assert.equal(found.length, 3);

  const clean = createDataset();
  clean.updates.entries[0].summary.en = "Added a reagent farm tag";
  assert.deepEqual(errors(run(clean), "X16"), []);
});

test("X17 same world, dimension, X and Z is a warning", () => {
  const ds = createDataset();
  Object.assign(point(ds, 1), { dimension: "overworld", tags: ["base"], x: -426, z: 300, y: 10 });
  const found = warnings(run(ds), "X17");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /p0001, p0002/);
  assert.deepEqual(errors(run(ds)), []);
});

test("X18 sequences must not drop below the baseline", () => {
  const ds = createDataset();
  assert.deepEqual(errors(run(ds, { baselineManifest: { pointSeq: 2, changeSeq: 2, updateSeq: 1 } }), "X18"), []);
  const found = errors(run(ds, { baselineManifest: { pointSeq: 5, changeSeq: 2, updateSeq: 3 } }), "X18");
  assert.deepEqual(found.map((e) => e.path).sort(), ["/pointSeq", "/updateSeq"]);
});

test("X19 dictionaries: en is primary, placeholders match, data ids are covered", () => {
  const extraZh = withDictionaries();
  extraZh.i18n["zh-TW"].messages["app.title"] = "座標";
  assert.match(errors(run(extraZh), "X19")[0].message, /exists in zh-TW but not in en/);

  const missingZh = withDictionaries();
  delete missingZh.i18n["zh-TW"].messages["nav.changelog"];
  assert.equal(warnings(run(missingZh), "X19").length, 1);
  assert.deepEqual(errors(run(missingZh), "X19"), []);

  const placeholder = withDictionaries();
  placeholder.i18n["zh-TW"].messages["point.tags.more"] = "+{n}";
  assert.match(errors(run(placeholder), "X19")[0].message, /Placeholders/);

  const coverage = withDictionaries();
  delete coverage.i18n.en.messages["dimension.the_end"];
  delete coverage.i18n["zh-TW"].messages["dimension.the_end"];
  delete coverage.i18n.en.messages["edition.bedrock"];
  delete coverage.i18n["zh-TW"].messages["edition.bedrock"];
  delete coverage.i18n.en.messages["vpn.radmin.title"];
  delete coverage.i18n["zh-TW"].messages["vpn.radmin.title"];
  const msgs = errors(run(coverage), "X19").map((e) => e.message);
  assert.deepEqual(msgs.sort(), [
    "Missing dictionary key dimension.the_end",
    "Missing dictionary key edition.bedrock",
    "Missing dictionary keys vpn.radmin.*",
  ]);

  const missingFile = withDictionaries();
  delete missingFile.i18n["zh-TW"];
  assert.match(errors(run(missingFile), "X19")[0].message, /missing/);

  const wrongLang = withDictionaries();
  wrongLang.i18n.en.lang = "zh-TW";
  assert.ok(errors(run(wrongLang), "X19").some((e) => e.path === "/lang"));
});

test("X20 tag names must not contain a half-width comma", () => {
  const ds = createDataset();
  ds.tags.tags[0].name.en = "Base, main";
  assert.equal(errors(run(ds), "X20").length, 1);
  ds.tags.tags[0].name.en = "Base，main";
  assert.deepEqual(errors(run(ds), "X20"), [], "full-width comma is allowed");
});

test("X21 manual edits relative to HEAD need change log entries", () => {
  const head = createDataset();

  const unchanged = createDataset();
  assert.deepEqual(run(unchanged, { head }).filter((i) => i.code === "X21"), []);

  const added = createDataset();
  added.manifest.pointSeq = 3;
  added.points.player_club.points.push({ ...point(createDataset()), id: "p0003", x: 1, z: 1 });
  assert.match(errors(run(added, { head }), "X21")[0].message, /point p0003 \(add\)/);
  added.manifest.changeSeq = 3;
  added.changes.entries.push({
    ...added.changes.entries[0],
    id: "c0003",
    target: { ...added.changes.entries[0].target, id: "p0003" },
  });
  assert.deepEqual(errors(run(added, { head }), "X21"), []);

  const edited = createDataset();
  point(edited).x = 1;
  assert.match(errors(run(edited, { head }), "X21")[0].message, /point p0001 \(edit\)/);
  const tsOnly = createDataset();
  point(tsOnly).updatedAt = "2026-09-29T02:00:00Z";
  assert.deepEqual(errors(run(tsOnly, { head }), "X21"), [], "timestamp-only changes need no entry");

  const deleted = createDataset();
  deleted.points.player_club.points.pop();
  assert.match(errors(run(deleted, { head }), "X21")[0].message, /point p0002 \(delete\)/);

  const spawn = createDataset();
  spawn.worlds.worlds[0].spawn.y = 90;
  assert.match(errors(run(spawn, { head }), "X21")[0].message, /spawn of world player_club/);

  const seed = createDataset();
  seed.worlds.worlds[0].seed = "1";
  assert.equal(warnings(run(seed, { head }), "X21").length, 1);
  seed.manifest.updateSeq = 2;
  seed.updates.entries.push({ ...seed.updates.entries[0], id: "u0002" });
  assert.deepEqual(warnings(run(seed, { head }), "X21"), []);

  const newWorld = addSecondWorld(createDataset());
  assert.match(warnings(run(newWorld, { head }), "X21")[0].message, /survival_two was added/);
});

test("X23 every world includes the overworld", () => {
  const ds = createDataset();
  ds.worlds.worlds[0].dimensions = ["the_nether", "the_end"];
  point(ds).dimension = "the_nether";
  point(ds).tags = ["nether_fortress"];
  assert.equal(errors(run(ds), "X23").length, 1);
});
