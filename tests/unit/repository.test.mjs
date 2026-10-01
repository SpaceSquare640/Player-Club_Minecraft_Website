// site/js/data/repository.js with a fake fetch: no-cache fetch, schemaVersion gate, caching, errors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CHANGELOG_KINDS, DataError, SUPPORTED_SCHEMA_VERSION, createRepository, errorView } from "../../site/js/data/repository.js";
import { REPO_ROOT, SUPPORTED_SCHEMA_VERSION as SCRIPTS_SCHEMA_VERSION } from "../../scripts/lib/load-data.mjs";
import { createDataset } from "../fixtures/dataset.mjs";
import { createFakeFetch } from "../fixtures/front.mjs";

const BASE = "https://example.test/site/data/";

function routesFor(ds = createDataset()) {
  return {
    [`${BASE}manifest.json`]: ds.manifest,
    [`${BASE}config.json`]: ds.config,
    [`${BASE}editions.json`]: ds.editions,
    [`${BASE}worlds.json`]: ds.worlds,
    [`${BASE}tags.json`]: ds.tags,
    [`${BASE}vpn.json`]: ds.vpn,
    [`${BASE}points/player_club.json`]: ds.points.player_club,
    [`${BASE}changelog/updates.json`]: ds.updates,
    [`${BASE}changelog/points.json`]: ds.changes,
  };
}

const rejectsWith = (promise, code, file) =>
  assert.rejects(promise, (error) => {
    assert.ok(error instanceof DataError, String(error));
    assert.equal(error.code, code);
    if (file) assert.equal(error.file, file);
    return true;
  });

test("front end and scripts support the same schemaVersion", () => {
  assert.equal(SUPPORTED_SCHEMA_VERSION, SCRIPTS_SCHEMA_VERSION);
  assert.deepEqual(CHANGELOG_KINDS, ["updates", "points"]);
});

test("loadCore: manifest first, no-cache fetches, flattened and frozen result, cached", async () => {
  const { fetch, requests } = createFakeFetch(routesFor());
  const repo = createRepository({ baseUrl: BASE, fetch });
  const core = await repo.loadCore();
  assert.equal(requests[0].url, `${BASE}manifest.json`);
  assert.equal(requests.length, 6);
  assert.ok(requests.every((r) => r.init.cache === "no-cache"));
  assert.equal(core.config.defaultWorldId, "player_club");
  assert.deepEqual(core.worlds.map((w) => w.id), ["player_club"]);
  assert.deepEqual(core.tagGroups.map((g) => g.id), ["facility", "structure"]);
  assert.equal(core.tags.length, 5);
  assert.equal(core.editions.length, 2);
  assert.equal(core.vpns[0].type, "radmin");
  assert.equal(typeof core.worlds[0].seed, "string");
  assert.ok(Object.isFrozen(core.worlds[0].spawn));
  assert.equal(await repo.loadCore(), core);
  assert.equal(requests.length, 6, "cached");
});

test("seeds stay strings and unchanged, including both int64 ends (no Number rounding)", async () => {
  const seeds = ["652938494491123000", "9223372036854775807", "-9223372036854775808"];
  const ds = createDataset();
  ds.worlds.worlds = seeds.map((seed, i) => ({ ...ds.worlds.worlds[0], id: i === 0 ? "player_club" : `seed_world_${i}`, seed }));
  // Raw text on the wire: the seeds are JSON strings; as numbers, 9223372036854775807 would become 2^63.
  const worldsText = JSON.stringify(ds.worlds);
  for (const seed of seeds) assert.ok(worldsText.includes(`"seed":"${seed}"`), seed);
  const { fetch } = createFakeFetch({ ...routesFor(ds), [`${BASE}worlds.json`]: worldsText });
  const core = await createRepository({ baseUrl: BASE, fetch }).loadCore();
  assert.deepEqual(core.worlds.map((w) => w.seed), seeds);
  for (const world of core.worlds) assert.equal(typeof world.seed, "string");
});

test("baseUrl without a trailing slash is treated as a directory", async () => {
  const { fetch, requests } = createFakeFetch(routesFor());
  await createRepository({ baseUrl: BASE.slice(0, -1), fetch }).loadCore();
  assert.equal(requests[0].url, `${BASE}manifest.json`);
});

test("unknown manifest schemaVersion gives SCHEMA_VERSION before loading anything else", async () => {
  const ds = createDataset();
  ds.manifest.schemaVersion = 2;
  const { fetch, requests } = createFakeFetch(routesFor(ds));
  const repo = createRepository({ baseUrl: BASE, fetch });
  await assert.rejects(repo.loadCore(), (error) => {
    assert.equal(error.code, "SCHEMA_VERSION");
    assert.equal(error.file, "manifest.json");
    assert.equal(error.expected, 1);
    assert.equal(error.actual, 2);
    assert.deepEqual(errorView(error), { titleKey: "error.load.title", bodyKey: "error.schema", actionKey: "error.reload", retryable: false });
    return true;
  });
  assert.equal(requests.length, 1);
});

test("any other file with a different schemaVersion is also a SCHEMA_VERSION error", async () => {
  const ds = createDataset();
  delete ds.tags.schemaVersion;
  await rejectsWith(createRepository({ baseUrl: BASE, fetch: createFakeFetch(routesFor(ds)).fetch }).loadCore(), "SCHEMA_VERSION", "tags.json");
});

test("network, HTTP and parse failures map to DataError codes", async () => {
  const routes = routesFor();
  const net = createFakeFetch({ ...routes, [`${BASE}manifest.json`]: new TypeError("Failed to fetch") });
  await rejectsWith(createRepository({ baseUrl: BASE, fetch: net.fetch }).loadCore(), "NETWORK", "manifest.json");
  const http = createFakeFetch({ ...routes, [`${BASE}worlds.json`]: { status: 404 } });
  await assert.rejects(createRepository({ baseUrl: BASE, fetch: http.fetch }).loadCore(), (e) => e.code === "HTTP" && e.status === 404 && e.file === "worlds.json");
  const bad = createFakeFetch({ ...routes, [`${BASE}config.json`]: "{ not json" });
  await rejectsWith(createRepository({ baseUrl: BASE, fetch: bad.fetch }).loadCore(), "PARSE", "config.json");
  const array = createFakeFetch({ ...routes, [`${BASE}config.json`]: "[]" });
  await rejectsWith(createRepository({ baseUrl: BASE, fetch: array.fetch }).loadCore(), "PARSE", "config.json");
  const shape = createFakeFetch({ ...routes, [`${BASE}worlds.json`]: { schemaVersion: 1, worlds: {} } });
  await rejectsWith(createRepository({ baseUrl: BASE, fetch: shape.fetch }).loadCore(), "PARSE", "worlds.json");
  assert.equal(errorView(new DataError("NETWORK", "manifest.json")).actionKey, "error.retry");
  assert.equal(errorView(new Error("boom")).retryable, true);
});

test("a failed load is not cached, so retry fetches again", async () => {
  const routes = routesFor();
  let fail = true;
  const inner = createFakeFetch(routes);
  const fetch = async (url, init) => {
    if (fail && url.endsWith("vpn.json")) throw new TypeError("offline");
    return inner.fetch(url, init);
  };
  const repo = createRepository({ baseUrl: BASE, fetch });
  await rejectsWith(repo.loadCore(), "NETWORK", "vpn.json");
  fail = false;
  const core = await repo.loadCore();
  assert.equal(core.vpns.length, 1);
});

test("loadPoints injects worldId, is cached per world and rejects unsafe world ids", async () => {
  const { fetch, requests } = createFakeFetch(routesFor());
  const repo = createRepository({ baseUrl: BASE, fetch });
  const points = await repo.loadPoints("player_club");
  assert.deepEqual(points.map((p) => [p.id, p.worldId]), [["p0001", "player_club"], ["p0002", "player_club"]]);
  assert.equal(points[1].y, null);
  assert.ok(Object.isFrozen(points));
  assert.equal(await repo.loadPoints("player_club"), points);
  assert.equal(requests.length, 1);
  for (const bad of ["../config", "Player", "a", "", null]) {
    assert.throws(() => repo.loadPoints(bad), TypeError, String(bad));
  }
  await rejectsWith(repo.loadPoints("missing_world"), "HTTP", "points/missing_world.json");
});

test("loadPoints: worldId in the file must match the requested world", async () => {
  const ds = createDataset();
  ds.points.player_club.worldId = "other";
  await rejectsWith(createRepository({ baseUrl: BASE, fetch: createFakeFetch(routesFor(ds)).fetch }).loadPoints("player_club"), "PARSE");
});

test("loadChangelog loads each kind on demand", async () => {
  const { fetch, requests } = createFakeFetch(routesFor());
  const repo = createRepository({ baseUrl: BASE, fetch });
  const updates = await repo.loadChangelog("updates");
  assert.equal(updates[0].id, "u0001");
  assert.equal(requests.length, 1);
  const changes = await repo.loadChangelog("points");
  assert.deepEqual(changes.map((e) => e.id), ["c0001", "c0002"]);
  assert.throws(() => repo.loadChangelog("all"), TypeError);
});

test("the committed site/data loads through the repository", async () => {
  const fetch = async (url) => {
    const rel = url.slice(BASE.length);
    try {
      const text = await readFile(path.join(REPO_ROOT, "site/data", rel), "utf8");
      return { ok: true, status: 200, text: async () => text };
    } catch {
      return { ok: false, status: 404, text: async () => "" };
    }
  };
  const repo = createRepository({ baseUrl: BASE, fetch });
  const core = await repo.loadCore();
  assert.equal(core.worlds[0].seed, "652938494491123000");
  const points = await repo.loadPoints(core.config.defaultWorldId);
  assert.equal(points[0].worldId, "player_club");
  assert.ok((await repo.loadChangelog("updates")).length >= 1);
  assert.ok((await repo.loadChangelog("points")).length >= 1);
});
