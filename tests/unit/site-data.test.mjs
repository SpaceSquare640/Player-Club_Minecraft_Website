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

test("Builder World commands: variants of one item differ in en and in zh-TW (X25)", () => {
  const byItem = new Map();
  for (const entry of dataset.commands.builder_world.commands) {
    if (!entry.variant) continue;
    const seen = byItem.get(entry.item) ?? { en: new Set(), "zh-TW": new Set() };
    for (const lang of ["en", "zh-TW"]) {
      assert.ok(!seen[lang].has(entry.variant[lang]), `${entry.id} ${lang}: ${entry.variant[lang]}`);
      seen[lang].add(entry.variant[lang]);
    }
    byItem.set(entry.item, seen);
  }
  assert.ok([...byItem.values()].some((seen) => seen.en.size > 1), "at least one item has several variants");
  const result = validateDataset(dataset, { fileIssues: issues });
  assert.deepEqual(result.errors.filter((e) => e.code === "X25"), []);
});

test("first batch: manifest sequences, world, spawn and seed", () => {
  // Sequences only grow as points and entries are added (approved requests or owner edits),
  // so the first-batch values are a floor, not a fixed snapshot.
  assert.equal(dataset.manifest.schemaVersion, 1);
  for (const key of ["pointSeq", "changeSeq", "updateSeq"]) {
    assert.ok(Number.isInteger(dataset.manifest[key]) && dataset.manifest[key] >= 1, key);
  }
  const world = dataset.worlds.worlds.find((w) => w.id === "player_club");
  assert.ok(world);
  assert.equal(world.name, "Player_Club");
  assert.equal(world.edition, "java");
  assert.equal(world.gameVersion, "latest");
  assert.equal(world.seed, "652938494491123000");
  assert.equal(typeof world.seed, "string");
  // The spawn can be changed through the spawn request form; only its shape is fixed.
  assert.deepEqual(Object.keys(world.spawn), ["x", "y", "z"]);
  for (const axis of ["x", "y", "z"]) assert.ok(Number.isInteger(world.spawn[axis]), axis);
  assert.deepEqual(world.dimensions, ["overworld", "the_nether", "the_end"]);
  assert.equal(dataset.config.discordInviteUrl, "https://discord.gg/aaUQVJeCgC");
  assert.deepEqual(dataset.config.approvers, ["SpaceSquare640"]);
});

test("first batch: Village 1 is p0001 and the spawn is not a point", () => {
  const points = dataset.points.player_club.points;
  const village = points.find((p) => p.id === "p0001");
  assert.ok(village);
  assert.deepEqual(
    { id: village.id, name: village.name, tags: village.tags, x: village.x, y: village.y, z: village.z },
    { id: "p0001", name: "Village 1", tags: ["village"], x: -426, y: 72, z: 300 },
  );
  assert.ok(!points.some((p) => /spawn/i.test(p.name) || p.tags.includes("spawn")));
  const [c1] = dataset.changes.entries;
  assert.equal(c1.id, "c0001");
  assert.equal(c1.target.id, "p0001");
  assert.equal(c1.source.type, "manual");
  assert.equal(dataset.updates.entries[0].id, "u0001");
});

test("Builder World: superflat Java world with a respawn radius, first point p0004, no VPN", () => {
  const world = dataset.worlds.worlds.find((w) => w.id === "builder_world");
  assert.ok(world);
  assert.deepEqual(
    { name: world.name, edition: world.edition, gameVersion: world.gameVersion, worldType: world.worldType, seed: world.seed, spawnRadius: world.spawnRadius },
    { name: "Builder World", edition: "java", gameVersion: "latest", worldType: "superflat", seed: "-766612653057462542", spawnRadius: 5 },
  );
  assert.equal(typeof world.seed, "string");
  assert.deepEqual(world.dimensions, ["overworld", "the_nether", "the_end"]);
  const point = dataset.points.builder_world.points.find((p) => p.id === "p0004");
  assert.ok(point);
  assert.deepEqual(
    { dimension: point.dimension, name: point.name, tags: point.tags, x: point.x, y: point.y, z: point.z, submittedBy: point.submittedBy },
    { dimension: "overworld", name: "自動化倉存建築", tags: ["other"], x: -2, y: 56, z: -14, submittedBy: "SpaceSquare640" },
  );
  assert.ok(dataset.changes.entries.some((e) => e.action === "add" && e.target.id === "p0004" && e.target.worldId === "builder_world" && e.source.type === "manual"));
  assert.ok(!dataset.vpn.vpns.some((v) => v.worldIds.includes("builder_world")), "Builder World has no VPN");
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

const COMMAND_IDS = [
  "diamond_sword", "bow", "crossbow", "trident_channeling", "trident_riptide",
  "diamond_axe_fortune", "diamond_axe_silk_touch", "diamond_hoe_fortune", "diamond_hoe_silk_touch",
  "diamond_pickaxe_fortune", "diamond_pickaxe_silk_touch", "diamond_shovel_fortune", "diamond_shovel_silk_touch",
  "fishing_rod", "shears", "shield", "elytra", "diamond_helmet", "diamond_chestplate", "diamond_leggings",
  "diamond_boots_depth_strider", "diamond_boots_frost_walker",
];

test("Builder World commands: only Builder World has the flag; 22 commands in 16 item groups", () => {
  const byId = new Map(dataset.worlds.worlds.map((w) => [w.id, w]));
  assert.equal(byId.get("builder_world").commands, true);
  assert.ok(!Object.hasOwn(byId.get("player_club"), "commands"));
  assert.deepEqual(Object.keys(dataset.commands), ["builder_world"]);

  const { commands } = dataset.commands.builder_world;
  assert.deepEqual(commands.map((c) => c.id), COMMAND_IDS);
  // Counts follow the command list: the bow has none, every other command gives 1.
  assert.ok(commands.every((c) => (c.id === "bow" ? !Object.hasOwn(c, "count") : c.count === 1)));
  // Adjacent commands of one item form a group.
  const sizes = [];
  commands.forEach((c, i) => {
    if (i > 0 && commands[i - 1].item === c.item) sizes[sizes.length - 1] += 1;
    else sizes.push(1);
  });
  assert.deepEqual(sizes, [1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 2]);
  const bow = commands.find((c) => c.id === "bow");
  assert.equal(bow.enchantments, "{unbreaking:3,power:5,punch:2,flame:1,infinity:1,mending:1,vanishing_curse:1}");
  const pick = commands.find((c) => c.id === "diamond_pickaxe_silk_touch");
  assert.deepEqual([pick.label, pick.variant], [{ en: "Diamond Pickaxe", "zh-TW": "鑽石鎬" }, { en: "Silk Touch", "zh-TW": "精準採集" }]);
});
