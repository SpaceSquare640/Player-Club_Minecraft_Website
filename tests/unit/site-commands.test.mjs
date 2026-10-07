// site/js/lib/commands.js: give commands of the Commands tab (name rules, settings whitelist, exact
// command strings and lengths). Not the Issue comment commands (scripts/lib/commands.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CHAT_COMMAND_LIMIT,
  DEFAULT_SETTINGS,
  MODES,
  NAME_PLACEHOLDER,
  buildCommand,
  cleanNameInput,
  commandLength,
  escapeSnbtString,
  exceedsChatLimit,
  filterNameChars,
  groupCommands,
  isCommandEntry,
  normalizeSettings,
  parseEnchantments,
  sanitizeName,
} from "../../site/js/lib/commands.js";
import { REPO_ROOT } from "../../scripts/lib/load-data.mjs";

const { commands: DATA } = JSON.parse(await readFile(path.join(REPO_ROOT, "site/data/commands/builder_world.json"), "utf8"));
const byId = (id) => DATA.find((c) => c.id === id);
const SHIELD = byId("shield");
// The 22 /give lines of the command list the site follows, copied verbatim (obfuscated:true, @s).
const GOLDEN = (await readFile(path.join(REPO_ROOT, "tests/fixtures/give-commands.txt"), "utf8")).split("\n").filter((line) => line !== "");
const nameText = (command) => /custom_name=\{text:"(.*)",obfuscated:false\},enchantments=/.exec(command)[1];

// Exact strings (architecture 6.8).
const E1 = '/give @s shield[custom_name={text:"input the name you want",obfuscated:false},enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1';
const E2 = '/give @p shield[custom_name={text:"Excalibur",obfuscated:false},enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1';
const E3 = '/give @s shield[custom_name={text:"Say \\"Hi\\" \\\\o/",obfuscated:false},enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1';
const E5 =
  '/give @s diamond_sword[custom_name={text:"input the name you want",obfuscated:false},enchantments={sweeping_edge:3,sharpness:5,knockback:2,fire_aspect:2,looting:3,unbreaking:3,mending:1,smite:5,bane_of_arthropods:5,vanishing_curse:1}] 1';
const E6 = '/give @s bow[custom_name={text:"input the name you want",obfuscated:false},enchantments={unbreaking:3,power:5,punch:2,flame:1,infinity:1,mending:1,vanishing_curse:1}]';

// Default and one-letter-name lengths of the 22 commands (architecture 6.4.4); both modes have the same length.
const LENGTHS = {
  diamond_sword: [236, 214], bow: [166, 144], crossbow: [176, 154], trident_channeling: [171, 149], trident_riptide: [168, 146],
  diamond_axe_fortune: [205, 183], diamond_axe_silk_touch: [208, 186], diamond_hoe_fortune: [164, 142], diamond_hoe_silk_touch: [167, 145],
  diamond_pickaxe_fortune: [168, 146], diamond_pickaxe_silk_touch: [171, 149], diamond_shovel_fortune: [167, 145], diamond_shovel_silk_touch: [170, 148],
  fishing_rod: [166, 144], shears: [149, 127], shield: [136, 114], elytra: [219, 197], diamond_helmet: [257, 235],
  diamond_chestplate: [231, 209], diamond_leggings: [243, 221], diamond_boots_depth_strider: [273, 251], diamond_boots_frost_walker: [272, 250],
};

test("constants: modes, defaults (chat, empty name)", () => {
  assert.deepEqual(MODES.map((m) => [m.id, m.selector]), [["block", "@p"], ["chat", "@s"]]);
  assert.deepEqual({ ...DEFAULT_SETTINGS }, { mode: "chat", name: "" });
  assert.equal(NAME_PLACEHOLDER, "input the name you want");
  assert.equal(CHAT_COMMAND_LIMIT, 256);
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS) && Object.isFrozen(MODES) && Object.isFrozen(MODES[0]));
});

test("golden: default output with obfuscated:false changed to true equals the 22 lines of the command list", () => {
  assert.equal(GOLDEN.length, 22);
  assert.equal(DATA.length, 22);
  DATA.forEach((entry, i) => {
    const raw = buildCommand(entry, DEFAULT_SETTINGS);
    assert.equal(raw.match(/obfuscated:false/g)?.length, 1, `${entry.id}: the raw default output contains obfuscated:false once`);
    assert.ok(!raw.includes("obfuscated:true"), entry.id);
    assert.equal(raw.replace("obfuscated:false", "obfuscated:true"), GOLDEN[i], entry.id);
    assert.equal(buildCommand(entry, {}), raw, `${entry.id}: empty settings use the defaults`);
  });
  assert.ok(GOLDEN[1].startsWith("/give @s bow[") && GOLDEN[1].endsWith("vanishing_curse:1}]"), "bow has no count");
  assert.ok(GOLDEN.filter((_, i) => i !== 1).every((line) => line.endsWith("}] 1")), "every other line ends with a count of 1");
});

test("sanitizeName: whitelist, spaces, NFC and trimming (name / removed)", () => {
  const cases = [
    ["  Excalibur  ", "Excalibur", false],
    ["   ", "", false],
    ["\u3000 \u00A0", "", false],
    ["Excalibur\u3000Sword", "Excalibur Sword", false],
    ["Excalibur \u2605", "Excalibur", true],
    ["劍神", "劍神", false],
    ["Épée", "Épée", false],
    ["你好，世界！", "你好世界", true],
    ["Sword \u{1F5E1}\uFE0F", "Sword", true],
    ["1\uFE0F\u20E3", "1", true],
    ["A\tB", "AB", true],
    ["A\u00A7B", "AB", true],
    ["Cafe\u0301", "Caf\u00E9", false],
    ["\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", "", true],
    ["x\u0000y\u200Bz\u202E", "xyz", true],
    ["\u3164", "", true],
    ["\u115F", "", true],
    ["\u034F", "", true],
    ["a\u{E0100}", "a", true],
    ["<b>x</b>", "<b>x</b>", false],
    ["$&", "$&", false],
    ["\uFF25\uFF58\uFF43\uFF11", "\uFF25\uFF58\uFF43\uFF11", false],
    ["it\u2019s", "its", true],
  ];
  for (const [raw, name, removed] of cases) {
    const result = sanitizeName(raw);
    assert.deepEqual([result.name, result.removed], [name, removed], JSON.stringify(raw));
  }
  assert.ok(!sanitizeName("Sword \u{1F5E1}\uFE0F").name.includes("\uFE0F"));
  assert.equal(sanitizeName("Cafe\u0301").name.length, 4, "é is one code point");
  assert.deepEqual(sanitizeName(undefined), { name: "", removed: false, truncated: false });
});

test("sanitizeName: at most 50 code points", () => {
  assert.deepEqual(sanitizeName("a".repeat(50)), { name: "a".repeat(50), removed: false, truncated: false });
  assert.deepEqual(sanitizeName("a".repeat(60)), { name: "a".repeat(50), removed: false, truncated: true });
  assert.equal(sanitizeName("劍".repeat(50)).name, "劍".repeat(50));
  assert.equal(sanitizeName("\u{1D538}".repeat(51)).name, "\u{1D538}".repeat(50), "astral letters count once and are never split");
  assert.equal(sanitizeName(`${"a".repeat(49)} bcd`).name, "a".repeat(49), "no trailing space after cutting");
  assert.equal(sanitizeName(`   ${"a".repeat(50)}   `).truncated, false, "outer spaces are not counted");
});

test("sanitizeName: Devanagari, Thai and stacked combining marks are kept (QA gap)", () => {
  assert.deepEqual(sanitizeName("नमस्ते"), { name: "नमस्ते", removed: false, truncated: false });
  assert.deepEqual(sanitizeName("ภาษาไทย"), { name: "ภาษาไทย", removed: false, truncated: false });
  assert.deepEqual(sanitizeName("á̂"), { name: "á̂".normalize("NFC"), removed: false, truncated: false });
  assert.equal(sanitizeName("á̂").name, "á̂", "NFC composes the first mark; the second mark stays");
});

test("cleanNameInput keeps trailing spaces after 50 characters; sanitizeName drops them (QA gap)", () => {
  const raw = `${"a".repeat(50)}  `;
  assert.deepEqual(cleanNameInput(raw), { value: raw, caret: 52, removed: false });
  assert.deepEqual(sanitizeName(raw), { name: "a".repeat(50), removed: false, truncated: false });
});

test("filterNameChars and cleanNameInput: written back to the input with the caret", () => {
  assert.deepEqual(filterNameChars(" a\u3000b "), { value: " a b ", removed: false });
  assert.deepEqual(cleanNameInput("abc "), { value: "abc ", caret: 4, removed: false }, "trailing space kept");
  assert.equal(cleanNameInput(`${"a".repeat(50)}b`).value, "a".repeat(50));
  assert.equal(cleanNameInput(`  ${"a".repeat(51)}`).value, `  ${"a".repeat(50)}`);
  assert.deepEqual(cleanNameInput("A\u2605B", 3), { value: "AB", caret: 2, removed: true });
  assert.deepEqual(cleanNameInput("A\u2605B", 1), { value: "AB", caret: 1, removed: true });
  assert.deepEqual(cleanNameInput("x".repeat(60), 60), { value: "x".repeat(50), caret: 50, removed: false });
});

test("escapeSnbtString: backslash first, then double quote (E4)", () => {
  assert.equal(escapeSnbtString("\\"), "\\\\");
  assert.equal(escapeSnbtString('"'), '\\"');
  assert.equal(escapeSnbtString('a\\"b'), 'a\\\\\\"b');
  assert.equal(escapeSnbtString("$&$1$$"), "$&$1$$");
});

test("normalizeSettings: defaults; a mode outside the whitelist falls back to chat", () => {
  const defaults = { mode: "chat", selector: "@s", name: "" };
  assert.deepEqual(normalizeSettings(undefined), defaults);
  assert.deepEqual(normalizeSettings(DEFAULT_SETTINGS), defaults);
  for (const raw of [{ mode: "commandBlock" }, { mode: "@a" }, { mode: "Block" }, { mode: " block" }, { mode: ["block"] }, { mode: "toString" }]) {
    assert.deepEqual(normalizeSettings(raw), defaults, JSON.stringify(raw));
  }
  assert.deepEqual(normalizeSettings({ mode: "block", name: "  Ex ", symbols: "X", nameColor: "red" }), { mode: "block", selector: "@p", name: "Ex" });
});

test("buildCommand: exact strings E1, E2, E3, E5, E6 (bow has no count)", () => {
  assert.equal(buildCommand(SHIELD, DEFAULT_SETTINGS), E1);
  assert.equal(buildCommand(SHIELD, {}), E1);
  assert.equal(buildCommand(SHIELD, { mode: "block", name: "Excalibur" }), E2);
  assert.equal(buildCommand(SHIELD, { name: 'Say "Hi" \\o/' }), E3);
  assert.equal(buildCommand(byId("diamond_sword"), DEFAULT_SETTINGS), E5);
  assert.equal(buildCommand(byId("bow"), DEFAULT_SETTINGS), E6);
  assert.equal(buildCommand({ ...SHIELD, count: 64 }, {}), E1.replace(/ 1$/, " 64"));
  assert.equal(buildCommand({ ...SHIELD, count: undefined }, {}), E1.replace(/ 1$/, ""));
  assert.equal(nameText(buildCommand(SHIELD, { name: "   " })), NAME_PLACEHOLDER, "spaces only keep the placeholder");
});

test("buildCommand: the name is written as is after escaping; one custom_name, no colours, no italic", () => {
  for (const name of ["$&", "$1", "$$", "$`", "$'", "<symbols>", "###", "gold", "@s", '{text:"x"}', "obfuscated:true", "\\"]) {
    assert.equal(nameText(buildCommand(SHIELD, { name })), escapeSnbtString(name), name);
  }
  for (const entry of DATA) {
    const command = buildCommand(entry, { name: "Excalibur" });
    assert.equal(command.match(/custom_name=/g).length, 1, entry.id);
    assert.doesNotMatch(command, /color:|italic|custom_name=\[/, entry.id);
  }
});

test("buildCommand: block and chat differ only in the selector", () => {
  for (const entry of DATA) {
    const block = buildCommand(entry, { mode: "block", name: "Excalibur" });
    const chat = buildCommand(entry, { mode: "chat", name: "Excalibur" });
    assert.equal(block.replace("/give @p ", "/give @s "), chat, entry.id);
    assert.ok(block.startsWith("/give @p ") && chat.startsWith("/give @s "));
    const count = entry.count === undefined ? "" : ` ${entry.count}`;
    assert.equal(chat, `/give @s ${entry.item}[custom_name={text:"Excalibur",obfuscated:false},enchantments=${entry.enchantments}]${count}`, entry.id);
  }
  assert.throws(() => buildCommand({ ...SHIELD, item: "minecraft:shield" }, {}), TypeError);
  assert.throws(() => buildCommand({ ...SHIELD, enchantments: "{unbreaking:3}],custom_name=x" }, {}), TypeError);
  assert.throws(() => buildCommand({ ...SHIELD, count: null }, {}), TypeError);
  assert.throws(() => buildCommand(null, {}), TypeError);
});

test("lengths: every command at default and one-letter settings; chat limit 256 is inclusive", () => {
  assert.deepEqual(Object.keys(LENGTHS), DATA.map((c) => c.id));
  for (const entry of DATA) {
    const [def, short] = LENGTHS[entry.id];
    assert.equal(commandLength(buildCommand(entry, {})), def, entry.id);
    assert.equal(commandLength(buildCommand(entry, { mode: "block" })), def, entry.id);
    assert.equal(commandLength(buildCommand(entry, { name: "a" })), short, entry.id);
  }
  // Chat warnings at the default settings: the helmet (257) and both boots (273, 272).
  assert.deepEqual(DATA.filter((c) => exceedsChatLimit(buildCommand(c, {}))).map((c) => c.id), [
    "diamond_helmet", "diamond_boots_depth_strider", "diamond_boots_frost_walker",
  ]);
  assert.equal(DATA.filter((c) => exceedsChatLimit(buildCommand(c, { name: "a" }))).length, 0, "a one-letter name fits every command");
  assert.deepEqual([commandLength(E1), exceedsChatLimit(E1)], [136, false]);
  assert.deepEqual([commandLength(E5), exceedsChatLimit(E5)], [236, false]);
  assert.equal(commandLength(E6), 166);
  const lengthOf = (entry, settings) => {
    const command = buildCommand(entry, settings);
    return [commandLength(command), exceedsChatLimit(command)];
  };
  const helmet = byId("diamond_helmet");
  assert.deepEqual(lengthOf(helmet, { name: "a".repeat(22) }), [256, false]);
  assert.deepEqual(lengthOf(helmet, { name: "a".repeat(23) }), [257, true]);
  assert.deepEqual(lengthOf(SHIELD, { name: '"'.repeat(50) }), [213, false], "escaping doubles each quote");
  assert.equal(commandLength("\u{20000}"), 2, "UTF-16 length");
});

test("parseEnchantments and isCommandEntry accept valid data and reject other shapes", () => {
  assert.deepEqual(parseEnchantments("{unbreaking:3,mending:1}"), [{ id: "unbreaking", level: 3 }, { id: "mending", level: 1 }]);
  assert.deepEqual(parseEnchantments("{a:255}"), [{ id: "a", level: 255 }]);
  const tooLong = `{a:1${",b:1".repeat(300)}}`;
  for (const bad of ["{}", "unbreaking:3", "{unbreaking:3 }", "{unbreaking:03}", "{unbreaking:0}", '{"unbreaking":3}', "{unbreaking:3}],custom_name=x", "{Unbreaking:3}", null, 3, tooLong]) {
    assert.equal(parseEnchantments(bad), null, String(bad).slice(0, 30));
  }
  for (const entry of DATA) assert.equal(isCommandEntry(entry), true, entry.id);
  for (const patch of [
    { id: "Shield" },
    { id: "x".repeat(33) },
    { item: "minecraft:shield" },
    { item: "Shield" },
    { enchantments: "{}" },
    { enchantments: tooLong },
    { count: 0 },
    { count: 65 },
    { count: 1.5 },
    { count: "1" },
    { count: null },
    { label: { "zh-TW": "盾牌" } },
    { label: { en: "" } },
    { label: null },
  ]) {
    assert.equal(isCommandEntry({ ...SHIELD, ...patch }), false, JSON.stringify(patch).slice(0, 40));
  }
  assert.equal(Object.hasOwn(byId("bow"), "count"), false);
  assert.equal(isCommandEntry(byId("bow")), true, "count may be omitted");
  assert.equal(isCommandEntry(null), false);
  assert.equal(isCommandEntry("shield"), false);
});

test("groupCommands: first batch has 16 adjacent item groups", () => {
  const groups = groupCommands(DATA);
  assert.equal(groups.length, 16);
  assert.deepEqual(groups.map((g) => g.entries.length), [1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 2]);
  assert.deepEqual(groups[3].label, { en: "Trident", "zh-TW": "三叉戟" });
  assert.deepEqual(groups[3].entries.map((e) => e.id), ["trident_channeling", "trident_riptide"]);
  assert.deepEqual(groupCommands([]), []);
  assert.equal(groupCommands([SHIELD, byId("bow"), SHIELD]).length, 3, "only adjacent entries are grouped");
});
