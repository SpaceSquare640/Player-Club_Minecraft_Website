// Canonical JSON output (scripts/lib/json-io.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseJsonText, stringifyJson } from "../../scripts/lib/json-io.mjs";
import { createDictionaries } from "../fixtures/dataset.mjs";

test("keys follow schema property order; primitive arrays stay on one line", () => {
  const scrambled = {
    points: [
      {
        updatedAt: "2026-09-29T08:00:00Z",
        tags: ["village", "base"],
        name: "Village 1",
        id: "p0001",
        z: 300,
        y: null,
        x: -426,
        dimension: "overworld",
        submittedBy: "SpaceSquare640",
        createdAt: "2026-09-29T08:00:00Z",
      },
    ],
    worldId: "player_club",
    schemaVersion: 1,
  };
  const expected = [
    "{",
    '  "schemaVersion": 1,',
    '  "worldId": "player_club",',
    '  "points": [',
    "    {",
    '      "id": "p0001",',
    '      "dimension": "overworld",',
    '      "name": "Village 1",',
    '      "tags": ["village", "base"],',
    '      "x": -426,',
    '      "y": null,',
    '      "z": 300,',
    '      "submittedBy": "SpaceSquare640",',
    '      "createdAt": "2026-09-29T08:00:00Z",',
    '      "updatedAt": "2026-09-29T08:00:00Z"',
    "    }",
    "  ]",
    "}",
    "",
  ].join("\n");
  assert.equal(stringifyJson(scrambled, "points"), expected);
});

test("localized text is written English first; nested $defs are followed", () => {
  const text = stringifyJson(
    {
      entries: [
        {
          source: { type: "manual" },
          scope: { "zh-TW": "全站", en: "Entire site" },
          summary: { "zh-TW": "網站上線", en: "Site launched" },
          target: { name: "A", dimension: "overworld", id: "p0001", worldId: "w1", type: "point" },
          action: "add",
          date: "2026-09-29",
          id: "c0001",
        },
      ],
      schemaVersion: 1,
    },
    "changelog-points",
  );
  const keys = [...text.matchAll(/"([A-Za-z-]+)":/g)].map((m) => m[1]);
  assert.deepEqual(keys, [
    "schemaVersion", "entries", "id", "date", "action", "target", "type", "worldId", "id", "dimension", "name",
    "summary", "en", "zh-TW", "scope", "en", "zh-TW", "source", "type",
  ]);
  assert.ok(text.includes("網站上線"), "non-ASCII text is not escaped");
});

test("dictionary messages are sorted by key; unknown keys are kept at the end", () => {
  const dict = createDictionaries().en;
  dict.messages = { "world.version.latest": "b", "app.title": "a" };
  const text = stringifyJson({ ...dict, extra: true }, "i18n");
  assert.ok(text.indexOf('"app.title"') < text.indexOf('"world.version.latest"'));
  assert.ok(text.trimEnd().endsWith('"extra": true\n}'));
});

test("output is LF-only with a single trailing newline; empty containers are compact", () => {
  const text = stringifyJson({ schemaVersion: 1, vpns: [] }, "vpn");
  assert.equal(text, '{\n  "schemaVersion": 1,\n  "vpns": []\n}\n');
  assert.ok(!text.includes("\r"));
});

test("parseJsonText flags a BOM", () => {
  assert.deepEqual(parseJsonText('{"a":1}'), { data: { a: 1 }, bom: false });
  assert.deepEqual(parseJsonText('\uFEFF{"a":1}'), { data: { a: 1 }, bom: true });
  assert.throws(() => parseJsonText("{a:1}"), SyntaxError);
});

test("large seed strings survive a round trip unchanged", () => {
  const worlds = { schemaVersion: 1, worlds: [{ id: "w1", seed: "-9223372036854775808" }] };
  const back = parseJsonText(stringifyJson(worlds, "worlds")).data;
  assert.equal(back.worlds[0].seed, "-9223372036854775808");
  assert.equal(typeof back.worlds[0].seed, "string");
});

test("optional world fields: world type follows gameVersion, respawn radius follows spawn", () => {
  const world = { dimensions: ["overworld"], spawnRadius: 5, spawn: { z: 0, y: 64, x: 0 }, seed: "1", worldType: "superflat", gameVersion: "latest", edition: "java", name: "W", id: "w1" };
  const back = parseJsonText(stringifyJson({ schemaVersion: 1, worlds: [world] }, "worlds")).data;
  assert.deepEqual(Object.keys(back.worlds[0]), ["id", "name", "edition", "gameVersion", "worldType", "seed", "spawn", "spawnRadius", "dimensions"]);
});

test("commands files: schema key order, English first; the flag follows dimensions; committed file is canonical", async () => {
  const scrambled = {
    commands: [{ count: 1, enchantments: "{unbreaking:3}", item: "trident", variant: { "zh-TW": "引雷", en: "Channeling" }, label: { "zh-TW": "三叉戟", en: "Trident" }, id: "trident_channeling" }],
    worldId: "builder_world",
    schemaVersion: 1,
  };
  const text = stringifyJson(scrambled, "commands");
  const keys = [...text.matchAll(/"([A-Za-z-]+)":/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["schemaVersion", "worldId", "commands", "id", "label", "en", "zh-TW", "variant", "en", "zh-TW", "item", "enchantments", "count"]);

  const world = { commands: true, dimensions: ["overworld"], spawn: { x: 0, y: 64, z: 0 }, seed: "1", gameVersion: "latest", edition: "java", name: "W", id: "w1" };
  const back = parseJsonText(stringifyJson({ schemaVersion: 1, worlds: [world] }, "worlds")).data;
  assert.deepEqual(Object.keys(back.worlds[0]).slice(-2), ["dimensions", "commands"]);

  const original = await readFile(new URL("../../site/data/commands/builder_world.json", import.meta.url), "utf8");
  assert.equal(stringifyJson(parseJsonText(original).data, "commands"), original);
});
