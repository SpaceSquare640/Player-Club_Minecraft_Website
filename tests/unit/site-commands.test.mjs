// site/js/lib/commands.js: give commands of the Commands tab (name rules, settings whitelist, exact
// command strings and lengths). Not the Issue comment commands (scripts/lib/commands.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  CHAT_COMMAND_LIMIT,
  COLORS,
  DEFAULT_SETTINGS,
  MODES,
  NAME_PLACEHOLDER,
  SYMBOLS,
  buildCommand,
  cleanNameInput,
  commandLength,
  commandParts,
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
const SHORTEST = { name: "a", symbols: "X", symbolColor: "red", nameColor: "red" };
const middle = (command) => /\{text:" .*? ",obfuscated:false,color:"[a-z_]+"\}/.exec(command)[0];

// Exact strings (architecture 6.8, E1 to E9).
const E1 =
  '/give @p shield[custom_name=[{text:"###",obfuscated:true,color:"gold",italic:false},{text:" input the name you want ",obfuscated:false,color:"yellow"},{text:"###",obfuscated:true,color:"gold"}],enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1';
const E2 =
  '/give @s shield[custom_name=[{text:"***",obfuscated:true,color:"red",italic:false},{text:" Excalibur ",obfuscated:false,color:"aqua"},{text:"***",obfuscated:true,color:"red"}],enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1';
const E3 =
  '/give @p shield[custom_name=[{text:"###",obfuscated:true,color:"gold",italic:false},{text:" Say \\"Hi\\" \\\\o/ ",obfuscated:false,color:"yellow"},{text:"###",obfuscated:true,color:"gold"}],enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1';
const E5 =
  '/give @p diamond_sword[custom_name=[{text:"###",obfuscated:true,color:"gold",italic:false},{text:" input the name you want ",obfuscated:false,color:"yellow"},{text:"###",obfuscated:true,color:"gold"}],enchantments={sweeping_edge:3,sharpness:5,knockback:2,fire_aspect:2,looting:3,unbreaking:3,mending:1,smite:5,bane_of_arthropods:5,vanishing_curse:1}] 1';
const E6 =
  '/give @p bow[custom_name=[{text:"###",obfuscated:true,color:"gold",italic:false},{text:" input the name you want ",obfuscated:false,color:"yellow"},{text:"###",obfuscated:true,color:"gold"}],enchantments={unbreaking:3,power:5,punch:2,flame:1,infinity:1,mending:1,vanishing_curse:1}] 1';

// Default and shortest lengths of the 22 commands (architecture 6.4.4).
const LENGTHS = {
  diamond_sword: [352, 321], bow: [284, 253], crossbow: [292, 261], trident_channeling: [287, 256], trident_riptide: [284, 253],
  diamond_axe_fortune: [321, 290], diamond_axe_silk_touch: [324, 293], diamond_hoe_fortune: [280, 249], diamond_hoe_silk_touch: [283, 252],
  diamond_pickaxe_fortune: [284, 253], diamond_pickaxe_silk_touch: [287, 256], diamond_shovel_fortune: [283, 252], diamond_shovel_silk_touch: [286, 255],
  fishing_rod: [282, 251], shears: [265, 234], shield: [252, 221], elytra: [335, 304], diamond_helmet: [373, 342],
  diamond_chestplate: [347, 316], diamond_leggings: [359, 328], diamond_boots_depth_strider: [389, 358], diamond_boots_frost_walker: [388, 357],
};

test("constants: modes, symbols, 16 colours in game order, defaults", () => {
  assert.deepEqual(MODES.map((m) => [m.id, m.selector]), [["block", "@p"], ["chat", "@s"]]);
  assert.deepEqual([...SYMBOLS], ["X", "***", "###"]);
  assert.deepEqual([...COLORS], ["black", "dark_blue", "dark_green", "dark_aqua", "dark_red", "dark_purple", "gold", "gray", "dark_gray", "blue", "green", "aqua", "red", "light_purple", "yellow", "white"]);
  assert.deepEqual({ ...DEFAULT_SETTINGS }, { mode: "block", name: "", symbols: "###", symbolColor: "gold", nameColor: "yellow" });
  assert.equal(NAME_PLACEHOLDER, "input the name you want");
  assert.equal(CHAT_COMMAND_LIMIT, 256);
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS) && Object.isFrozen(COLORS) && Object.isFrozen(MODES[0]));
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

test("normalizeSettings: defaults; values outside the whitelists fall back to defaults", () => {
  const defaults = { mode: "block", selector: "@p", name: "", symbols: "###", symbolColor: "gold", nameColor: "yellow" };
  assert.deepEqual(normalizeSettings(undefined), defaults);
  assert.deepEqual(normalizeSettings(DEFAULT_SETTINGS), defaults);
  for (const raw of [
    { mode: "commandBlock" },
    { mode: "@a" },
    { symbols: "<b>" },
    { symbols: "**" },
    { symbolColor: "#ffffff" },
    { symbolColor: "Gold" },
    { nameColor: 'gold"' },
    { nameColor: " yellow" },
    { mode: ["chat"] },
    { symbolColor: "toString" },
  ]) {
    assert.deepEqual(normalizeSettings(raw), defaults, JSON.stringify(raw));
  }
  assert.deepEqual(normalizeSettings({ mode: "chat", name: "  Ex ", symbols: "X", symbolColor: "red", nameColor: "red" }), {
    mode: "chat", selector: "@s", name: "Ex", symbols: "X", symbolColor: "red", nameColor: "red",
  });
});

test("buildCommand: exact strings E1, E2, E3, E5, E6", () => {
  assert.equal(buildCommand(SHIELD, DEFAULT_SETTINGS), E1);
  assert.equal(buildCommand(SHIELD, {}), E1);
  assert.equal(buildCommand(SHIELD, { mode: "chat", name: "Excalibur", symbols: "***", symbolColor: "red", nameColor: "aqua" }), E2);
  assert.equal(buildCommand(SHIELD, { name: 'Say "Hi" \\o/' }), E3);
  assert.equal(buildCommand(byId("diamond_sword"), DEFAULT_SETTINGS), E5);
  assert.equal(buildCommand(byId("bow"), DEFAULT_SETTINGS), E6);
  const parts = commandParts(SHIELD, {});
  assert.equal(parts.before + parts.name + parts.after, E1);
  assert.deepEqual([parts.name, parts.placeholder], [NAME_PLACEHOLDER, true]);
  const quoted = commandParts(SHIELD, { name: 'a"b' });
  assert.deepEqual([quoted.name, quoted.placeholder], ['a\\"b', false]);
});

test("buildCommand: name written as is (E7), symbols (E8) and name colour (E9)", () => {
  assert.equal(middle(buildCommand(SHIELD, { name: "$&" })), '{text:" $& ",obfuscated:false,color:"yellow"}');
  for (const name of ["$1", "$$", "$`", "$'", "<symbols>", "###", "gold", "@s", '{text:"x"}']) {
    assert.equal(middle(buildCommand(SHIELD, { name })), `{text:" ${escapeSnbtString(name)} ",obfuscated:false,color:"yellow"}`, name);
  }
  const x = buildCommand(SHIELD, { symbols: "X" });
  assert.ok(x.includes('[{text:"X",obfuscated:true,color:"gold",italic:false},'));
  assert.ok(x.includes(',{text:"X",obfuscated:true,color:"gold"}],'));
  const purple = buildCommand(SHIELD, { nameColor: "light_purple" });
  assert.equal(middle(purple), '{text:" input the name you want ",obfuscated:false,color:"light_purple"}');
  assert.equal(purple.match(/light_purple/g).length, 1);
  assert.equal(purple.match(/color:"gold"/g).length, 2);
  assert.ok(buildCommand(SHIELD, { symbolColor: "aqua", nameColor: "aqua" }).includes('color:"aqua"},{text:"###"'), "same colour twice is fine");
});

test("buildCommand: block and chat differ only in the selector; italic:false once, in the first segment", () => {
  const settings = { name: "Excalibur", symbols: "***", symbolColor: "red", nameColor: "aqua" };
  for (const entry of DATA) {
    const block = buildCommand(entry, { ...settings, mode: "block" });
    const chat = buildCommand(entry, { ...settings, mode: "chat" });
    assert.equal(block.replace("/give @p ", "/give @s "), chat, entry.id);
    assert.ok(block.startsWith("/give @p ") && chat.startsWith("/give @s "));
    assert.equal(block.match(/italic/g).length, 1, entry.id);
    assert.ok(
      block.endsWith(
        `${entry.item}[custom_name=[{text:"***",obfuscated:true,color:"red",italic:false},{text:" Excalibur ",obfuscated:false,color:"aqua"},{text:"***",obfuscated:true,color:"red"}],enchantments=${entry.enchantments}] ${entry.count}`,
      ),
      entry.id,
    );
  }
  assert.throws(() => buildCommand({ ...SHIELD, item: "minecraft:shield" }, {}), TypeError);
  assert.throws(() => buildCommand({ ...SHIELD, enchantments: "{unbreaking:3}],custom_name=x" }, {}), TypeError);
  assert.throws(() => buildCommand(null, {}), TypeError);
});

test("lengths: every command at default and shortest settings; chat limit 256 is inclusive", () => {
  assert.deepEqual(Object.keys(LENGTHS), DATA.map((c) => c.id));
  for (const entry of DATA) {
    const [def, short] = LENGTHS[entry.id];
    assert.equal(commandLength(buildCommand(entry, {})), def, entry.id);
    assert.equal(commandLength(buildCommand(entry, { ...SHORTEST, mode: "chat" })), short, entry.id);
  }
  assert.deepEqual(DATA.filter((c) => !exceedsChatLimit(buildCommand(c, {}))).map((c) => c.id), ["shield"]);
  assert.deepEqual(DATA.filter((c) => exceedsChatLimit(buildCommand(c, SHORTEST))).map((c) => c.id), [
    "diamond_sword", "crossbow", "diamond_axe_fortune", "diamond_axe_silk_touch", "elytra",
    "diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots_depth_strider", "diamond_boots_frost_walker",
  ]);
  assert.deepEqual([commandLength(E1), exceedsChatLimit(E1)], [252, false]);
  assert.deepEqual([commandLength(E5), exceedsChatLimit(E5)], [352, true]);
  assert.equal(commandLength(E2), 234);
  assert.equal(commandLength(E3), 244);
  const lengthOf = (entry, settings) => {
    const command = buildCommand(entry, settings);
    return [commandLength(command), exceedsChatLimit(command)];
  };
  const trident = byId("trident_channeling");
  assert.deepEqual(lengthOf(trident, SHORTEST), [256, false]);
  assert.deepEqual(lengthOf(trident, { ...SHORTEST, name: "ab" }), [257, true]);
  assert.deepEqual(lengthOf(SHIELD, { name: "a".repeat(27) }), [256, false]);
  assert.deepEqual(lengthOf(SHIELD, { name: "a".repeat(28) }), [257, true]);
  assert.equal(commandLength("\u{20000}"), 2, "UTF-16 length");
  assert.equal(commandLength(buildCommand(SHIELD, { nameColor: "light_purple", symbolColor: "light_purple" })), 252 + 22);
  assert.equal(commandLength(buildCommand(SHIELD, { symbols: "X" })), 252 - 4);
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
    { label: { "zh-TW": "盾牌" } },
    { label: { en: "" } },
    { label: null },
  ]) {
    assert.equal(isCommandEntry({ ...SHIELD, ...patch }), false, JSON.stringify(patch).slice(0, 40));
  }
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
