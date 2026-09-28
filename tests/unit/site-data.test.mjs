// The committed data set in site/data: validity and first-batch content.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, createFsReader, loadDataset } from "../../scripts/lib/load-data.mjs";
import { validateDataset } from "../../scripts/validate.mjs";

const { dataset, issues } = await loadDataset(createFsReader(REPO_ROOT));

test("site data loads and validates without errors", () => {
  assert.deepEqual(issues, []);
  const result = validateDataset(dataset, { fileIssues: issues });
  assert.deepEqual(result.errors, []);
  assert.equal(result.crossSkipped, false);
});

test("first batch: manifest sequences, world, spawn and seed", () => {
  assert.deepEqual(dataset.manifest, { schemaVersion: 1, pointSeq: 1, changeSeq: 1, updateSeq: 1 });
  const [world] = dataset.worlds.worlds;
  assert.equal(world.id, "player_club");
  assert.equal(world.name, "Player_Club");
  assert.equal(world.edition, "java");
  assert.equal(world.gameVersion, "latest");
  assert.equal(world.seed, "652938494491123000");
  assert.equal(typeof world.seed, "string");
  assert.deepEqual(world.spawn, { x: 7, y: 103, z: 5 });
  assert.deepEqual(world.dimensions, ["overworld", "the_nether", "the_end"]);
  assert.equal(dataset.config.discordInviteUrl, "https://discord.gg/aaUQVJeCgC");
  assert.deepEqual(dataset.config.approvers, ["SpaceSquare640"]);
});

test("first batch: Village 1 is p0001 and the spawn is not a point", () => {
  const points = dataset.points.player_club.points;
  assert.equal(points.length, 1);
  assert.deepEqual(
    { id: points[0].id, name: points[0].name, tags: points[0].tags, x: points[0].x, y: points[0].y, z: points[0].z },
    { id: "p0001", name: "Village 1", tags: ["village"], x: -426, y: 72, z: 300 },
  );
  assert.ok(!points.some((p) => /spawn/i.test(p.name) || p.tags.includes("spawn")));
  const [c1] = dataset.changes.entries;
  assert.equal(c1.id, "c0001");
  assert.equal(c1.target.id, "p0001");
  assert.equal(c1.source.type, "manual");
  assert.equal(dataset.updates.entries[0].id, "u0001");
});

test("17 tags with bilingual names; three groups", () => {
  assert.deepEqual(dataset.tags.groups.map((g) => g.id), ["facility", "structure", "misc"]);
  assert.equal(dataset.tags.tags.length, 17);
  for (const tag of dataset.tags.tags) {
    assert.deepEqual(Object.keys(tag.name), ["en", "zh-TW"], tag.id);
    if (tag.hint) assert.deepEqual(Object.keys(tag.hint), ["en", "zh-TW"], tag.id);
  }
});

test("VPN data never contains a password", async () => {
  const text = await readFile(path.join(REPO_ROOT, "site/data/vpn.json"), "utf8");
  assert.doesNotMatch(text, /pass|pwd|secret|token/i);
  assert.deepEqual(Object.keys(dataset.vpn.vpns[0]).sort(), ["contactUrl", "id", "networkName", "type", "worldIds"]);
});
