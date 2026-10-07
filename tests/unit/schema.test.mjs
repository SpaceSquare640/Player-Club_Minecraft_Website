// JSON Schema (schemas/v1) behaviour for the data set fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createValidator } from "../../scripts/lib/ajv.mjs";
import { ENCHANTMENTS_RE, ITEM_RE, MAX_COUNT, MAX_ENCHANTMENTS_LENGTH } from "../../site/js/lib/commands.js";
import { isPlainText } from "../../site/js/lib/text.js";
import { addCommands, createDataset, createDictionaries } from "../fixtures/dataset.mjs";

const validator = createValidator();
const errorsOf = (name, data) => validator.validate(name, data);
const isValid = (name, data) => errorsOf(name, data).length === 0;

function withWorld(mutate) {
  const ds = createDataset();
  mutate(ds.worlds.worlds[0]);
  return ds.worlds;
}

test("fixture files are schema-valid", () => {
  const ds = createDataset();
  const dict = createDictionaries();
  for (const [name, data] of [
    ["manifest", ds.manifest],
    ["config", ds.config],
    ["editions", ds.editions],
    ["worlds", ds.worlds],
    ["tags", ds.tags],
    ["vpn", ds.vpn],
    ["points", ds.points.player_club],
    ["changelog-updates", ds.updates],
    ["changelog-points", ds.changes],
    ["i18n", dict.en],
    ["i18n", dict["zh-TW"]],
  ]) {
    assert.deepEqual(errorsOf(name, data), [], name);
  }
});

test("seed must be a canonical int64-shaped string", () => {
  for (const seed of ["652938494491123000", "0", "-1", "9223372036854775807", "-9223372036854775808", "9223372036854775808"]) {
    assert.equal(isValid("worlds", withWorld((w) => { w.seed = seed; })), true, seed);
  }
  for (const seed of ["12345678901234567890", "01", "-0", "+1", "1e5", "1.5", "", " 1"]) {
    assert.equal(isValid("worlds", withWorld((w) => { w.seed = seed; })), false, seed);
  }
  assert.equal(isValid("worlds", withWorld((w) => { w.seed = 652938494491123000; })), false, "number is rejected");
});

test("gameVersion accepts latest or x.y(.z)", () => {
  for (const v of ["latest", "1.21", "1.21.4"]) assert.equal(isValid("worlds", withWorld((w) => { w.gameVersion = v; })), true, v);
  for (const v of ["Latest", "1", "1.21.4.1", "v1.21", "1.21-rc1"]) {
    assert.equal(isValid("worlds", withWorld((w) => { w.gameVersion = v; })), false, v);
  }
});

test("spawn is required, integer x/y/z only, y not null", () => {
  assert.equal(isValid("worlds", withWorld((w) => { delete w.spawn; })), false);
  assert.equal(isValid("worlds", withWorld((w) => { w.spawn.y = null; })), false);
  assert.equal(isValid("worlds", withWorld((w) => { w.spawn.x = 7.5; })), false);
  assert.equal(isValid("worlds", withWorld((w) => { w.spawn.z = "5"; })), false);
  assert.equal(isValid("worlds", withWorld((w) => { w.spawn.dimension = "overworld"; })), false);
  assert.equal(isValid("worlds", withWorld((w) => { delete w.spawn.z; })), false);
});

test("world type and respawn radius are optional; type is a Java world type, radius 0-29999984 blocks", () => {
  assert.equal(isValid("worlds", withWorld(() => {})), true, "both omitted");
  for (const type of ["default", "superflat", "large_biomes", "amplified", "single_biome", "custom"]) {
    assert.equal(isValid("worlds", withWorld((w) => { w.worldType = type; })), true, type);
  }
  for (const type of ["flat", "Superflat", "", null, 1]) {
    assert.equal(isValid("worlds", withWorld((w) => { w.worldType = type; })), false, String(type));
  }
  for (const radius of [0, 5, 10, 29999984]) {
    assert.equal(isValid("worlds", withWorld((w) => { w.spawnRadius = radius; })), true, String(radius));
  }
  for (const radius of [-1, 29999985, 2.5, "5", null]) {
    assert.equal(isValid("worlds", withWorld((w) => { w.spawnRadius = radius; })), false, String(radius));
  }
});

test("world dimensions are 1-3 unique known dimensions", () => {
  assert.equal(isValid("worlds", withWorld((w) => { w.dimensions = []; })), false);
  assert.equal(isValid("worlds", withWorld((w) => { w.dimensions = ["overworld", "overworld"]; })), false);
  assert.equal(isValid("worlds", withWorld((w) => { w.dimensions = ["overworld", "nether"]; })), false);
});

test("plainText rejects control, zero-width and bidi characters and outer whitespace", () => {
  const withName = (name) => {
    const ds = createDataset();
    ds.points.player_club.points[0].name = name;
    return ds.points.player_club;
  };
  assert.equal(isValid("points", withName("村莊 Village 2")), true);
  for (const bad of [" Village", "Village ", "Vil\nlage", "Vil\u200Blage", "Vil\u202Elage", "Vil\u2066lage", "Vil\u0007lage", "", "x".repeat(61)]) {
    assert.equal(isValid("points", withName(bad)), false, JSON.stringify(bad));
  }
});

test("plainText / multilineText reject the same characters as site/js/lib/text.js", async () => {
  const defs = JSON.parse(await readFile(new URL("../../schemas/v1/defs.schema.json", import.meta.url), "utf8"));
  const plain = new RegExp(defs.$defs.plainText.pattern, "u");
  const multi = new RegExp(defs.$defs.multilineText.pattern, "u");
  const mismatches = [];
  const sweep = (from, to) => {
    for (let cp = from; cp <= to; cp += 1) {
      const text = `a${String.fromCodePoint(cp)}b`;
      if (plain.test(text) !== isPlainText(text)) mismatches.push(`plain U+${cp.toString(16)}`);
      if (multi.test(text) !== isPlainText(text, { allowNewline: true })) mismatches.push(`multi U+${cp.toString(16)}`);
    }
  };
  // Planes 0-3 (including lone surrogates) and plane 14, where every format and default-ignorable character lives.
  sweep(0, 0x3ffff);
  sweep(0xe0000, 0xeffff);
  assert.deepEqual(mismatches, []);

  // The validator itself (Ajv, unicode patterns) rejects them too.
  const withName = (name) => {
    const ds = createDataset();
    ds.points.player_club.points[0].name = name;
    return ds.points.player_club;
  };
  for (const cp of [0x00ad, 0x061c, 0x180e, 0x2060, 0x3164, 0xfeff, 0xe0001, 0xe007f]) {
    assert.equal(isValid("points", withName(`Vil${String.fromCodePoint(cp)}lage`)), false, `U+${cp.toString(16)}`);
  }
  assert.equal(isValid("points", withName(`Vil❤${String.fromCodePoint(0xfe0f)}lage`)), true, "emoji variation selector");
});

test("point note allows line feeds but no empty string; y may be null but must exist", () => {
  const ds = createDataset();
  const file = ds.points.player_club;
  assert.equal(isValid("points", file), true);
  file.points[1].note = "";
  assert.equal(isValid("points", file), false);
  file.points[1].note = "line\r\nbreak";
  assert.equal(isValid("points", file), false);
  delete file.points[1].note;
  assert.equal(isValid("points", file), true);
  delete file.points[1].y;
  assert.equal(isValid("points", file), false);
});

test("point timestamps are UTC without milliseconds", () => {
  const ds = createDataset();
  const p = ds.points.player_club.points[0];
  for (const bad of ["2026-09-29T08:00:00.000Z", "2026-09-29T08:00:00+08:00", "2026-09-29", "2026-13-01T00:00:00Z", ""]) {
    p.createdAt = bad;
    assert.equal(isValid("points", ds.points.player_club), false, bad);
  }
});

test("point tags need at least one unique entry and no upper limit", () => {
  const ds = createDataset();
  const p = ds.points.player_club.points[0];
  p.tags = [];
  assert.equal(isValid("points", ds.points.player_club), false);
  p.tags = ["village", "village"];
  assert.equal(isValid("points", ds.points.player_club), false);
  p.tags = Array.from({ length: 40 }, (_, i) => `tag_${i}`);
  assert.equal(isValid("points", ds.points.player_club), true);
});

test("config: discord invite, https site url with trailing slash, IANA time zone", () => {
  const cfg = () => createDataset().config;
  assert.equal(isValid("config", { ...cfg(), discordInviteUrl: "https://discord.com/invite/abc" }), false);
  assert.equal(isValid("config", { ...cfg(), siteUrl: "http://example.com/" }), false);
  assert.equal(isValid("config", { ...cfg(), siteUrl: "https://example.com" }), false);
  assert.equal(isValid("config", { ...cfg(), changelogTimeZone: "Mars/Olympus" }), false);
  assert.equal(isValid("config", { ...cfg(), changelogTimeZone: "+08:00" }), false);
  assert.equal(isValid("config", { ...cfg(), changelogTimeZone: "UTC" }), true);
  assert.equal(isValid("config", { ...cfg(), approvers: [] }), false);
  assert.equal(isValid("config", { ...cfg(), approvers: ["bad login!"] }), false);
});

test("vpn: https contact only, no extra (password) fields", () => {
  const ds = createDataset();
  ds.vpn.vpns[0].contactUrl = "http://discord.com/users/1";
  assert.equal(isValid("vpn", ds.vpn), false);
  const ds2 = createDataset();
  ds2.vpn.vpns[0].password = "secret";
  assert.equal(isValid("vpn", ds2.vpn), false);
});

test("change log point entries: target and changedFields combinations", () => {
  const entry = () => createDataset().changes.entries[0];
  const check = (e) => isValid("changelog-points", { schemaVersion: 1, entries: [e] });

  assert.equal(check(entry()), true);
  assert.equal(check({ ...entry(), changedFields: ["x"] }), false, "add must not have changedFields");
  assert.equal(check({ ...entry(), action: "edit" }), false, "edit requires changedFields");
  assert.equal(check({ ...entry(), action: "edit", changedFields: ["x", "z"] }), true);
  assert.equal(check({ ...entry(), action: "edit", changedFields: ["worldId"] }), false);

  const target = entry().target;
  delete target.name;
  assert.equal(check({ ...entry(), target }), false, "point target requires name");

  const spawn = {
    ...entry(),
    action: "edit",
    target: { type: "spawn", worldId: "player_club" },
    changedFields: ["x", "y"],
  };
  assert.equal(check(spawn), true);
  assert.equal(check({ ...spawn, action: "add", changedFields: undefined }), false, "spawn only allows edit");
  assert.equal(check({ ...spawn, action: "delete", changedFields: undefined }), false, "spawn cannot be deleted");
  assert.equal(check({ ...spawn, changedFields: ["name"] }), false);
  assert.equal(check({ ...spawn, target: { type: "spawn", worldId: "player_club", id: "p0001" } }), false);
  assert.equal(check({ ...spawn, target: { type: "spawn", worldId: "player_club", dimension: "overworld" } }), false);
});

test("change log source: issue requires a number, manual forbids it", () => {
  const entry = () => createDataset().changes.entries[0];
  const check = (e) => isValid("changelog-points", { schemaVersion: 1, entries: [e] });
  assert.equal(check({ ...entry(), source: { type: "issue", issue: 12 } }), true);
  assert.equal(check({ ...entry(), source: { type: "issue" } }), false);
  assert.equal(check({ ...entry(), source: { type: "issue", issue: 0 } }), false);
  assert.equal(check({ ...entry(), source: { type: "manual", issue: 12 } }), false);
});

test("change log dates and localized text", () => {
  const upd = () => createDataset().updates;
  const u1 = upd();
  u1.entries[0].date = "2026-02-30";
  assert.equal(isValid("changelog-updates", u1), false);
  const u2 = upd();
  delete u2.entries[0].summary["zh-TW"];
  assert.equal(isValid("changelog-updates", u2), false);
  const u3 = upd();
  u3.entries[0].summary.fr = "Site lancé";
  assert.equal(isValid("changelog-updates", u3), false);
  const u4 = upd();
  u4.entries[0].scope.en = "x".repeat(101);
  assert.equal(isValid("changelog-updates", u4), false);
});

test("editions: overrides need minVersion or maxVersion; xzAbsMax 1..30000000", () => {
  const ds = createDataset();
  ds.editions.editions[0].versionOverrides = [{ bounds: { xzAbsMax: 10, yMin: 0, yMax: 10 } }];
  assert.equal(isValid("editions", ds.editions), false);
  ds.editions.editions[0].versionOverrides = [{ minVersion: "1.18", bounds: { xzAbsMax: 10, yMin: 0, yMax: 10 } }];
  assert.equal(isValid("editions", ds.editions), true);
  ds.editions.editions[0].bounds.xzAbsMax = 30000001;
  assert.equal(isValid("editions", ds.editions), false);
});

test("i18n keys follow the dotted naming rule", () => {
  const dict = createDictionaries().en;
  dict.messages["Nav.points"] = "Points";
  assert.equal(isValid("i18n", dict), false);
  const dict2 = createDictionaries().en;
  dict2.messages.nav = "Points";
  assert.equal(isValid("i18n", dict2), false);
  const dict3 = createDictionaries().en;
  dict3.messages["dimension.the_nether"] = "";
  assert.equal(isValid("i18n", dict3), false);
});

test("commands file: fixture and committed file pass; worlds.commands is only true", async () => {
  const ds = addCommands(createDataset());
  assert.deepEqual(errorsOf("commands", ds.commands.player_club), []);
  assert.deepEqual(errorsOf("worlds", ds.worlds), []);
  const committed = JSON.parse(await readFile(new URL("../../site/data/commands/builder_world.json", import.meta.url), "utf8"));
  assert.deepEqual(errorsOf("commands", committed), []);
  for (const flag of [false, "true", 1, null]) {
    assert.equal(isValid("worlds", withWorld((w) => { w.commands = flag; })), false, String(flag));
  }
});

test("commands file rejects missing, extra and malformed fields", () => {
  const check = (mutate) => {
    const file = addCommands(createDataset()).commands.player_club;
    mutate(file, file.commands[2]);
    return isValid("commands", file);
  };
  assert.equal(check(() => {}), true);
  assert.equal(check((_, c) => { delete c.count; }), true, "count may be omitted");
  assert.equal(check((_, c) => { c.command = "/give @p shield"; }), false, "extra key command");
  assert.equal(check((_, c) => { c.custom_name = "x"; }), false, "extra key custom_name");
  assert.equal(check((_, c) => { c.id = "Shield"; }), false, "upper-case id");
  for (const item of ["minecraft:bow", "Bow", "bow ", "b o w", "b"]) {
    assert.equal(check((_, c) => { c.item = item; }), false, item);
  }
  for (const ench of ["{}", "unbreaking:3", "{unbreaking:3 }", "{unbreaking:03}", "{unbreaking:0}", '{"unbreaking":3}', "{unbreaking:3}],custom_name=x", "{unbreaking:1000}", `{${"a".repeat(64)}:1${",b:1".repeat(250)}}`]) {
    assert.equal(check((_, c) => { c.enchantments = ench; }), false, ench.slice(0, 40));
  }
  for (const count of [0, 65, 1.5, "1", null]) {
    assert.equal(check((_, c) => { c.count = count; }), false, String(count));
  }
  assert.equal(check((_, c) => { c.count = 64; }), true, "count 64");
  assert.equal(check((_, c) => { c.label.en = "Shi\u200Bld"; }), false, "control character in label");
  assert.equal(check((_, c) => { c.label["zh-TW"] = "x".repeat(31); }), false, "label over 30");
  assert.equal(check((_, c) => { c.variant = { en: "Only English" }; }), false, "variant needs both languages");
  assert.equal(check((file) => { file.commands = []; }), false, "empty commands");
});

test("commands schema patterns equal the regular expressions of site/js/lib/commands.js", async () => {
  const schema = JSON.parse(await readFile(new URL("../../schemas/v1/commands.schema.json", import.meta.url), "utf8"));
  const { properties } = schema.properties.commands.items;
  assert.equal(properties.item.pattern, ITEM_RE.source);
  assert.equal(properties.enchantments.pattern, ENCHANTMENTS_RE.source);
  assert.equal(properties.enchantments.maxLength, MAX_ENCHANTMENTS_LENGTH);
  assert.equal(properties.count.maximum, MAX_COUNT);
});
