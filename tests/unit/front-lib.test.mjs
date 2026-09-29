// site/js/lib pure functions added for the front end: coords, filter, text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSpawnCard, convertCoord, formatCopyText, spawnTargetId, toNether, toOverworld } from "../../site/js/lib/coords.js";
import { indexTags, matchPoint, normalizeSearch, sortChangelogEntries, sortPoints } from "../../site/js/lib/filter.js";
import { codePointLength, hasControlChars, isPlainText, stripControlChars } from "../../site/js/lib/text.js";
import { createHashContext } from "../fixtures/front.mjs";

test("formatCopyText: X Y Z, or X Z when Y is null", () => {
  assert.equal(formatCopyText({ x: -426, y: 72, z: 300 }), "-426 72 300");
  assert.equal(formatCopyText({ x: -50, y: null, z: 40 }), "-50 40");
  assert.equal(formatCopyText({ x: 0, y: 0, z: 0 }), "0 0 0");
  assert.equal(formatCopyText({ x: 30000000, y: -64, z: -30000000 }), "30000000 -64 -30000000");
});

test("Nether conversion floors (also for negatives) and never converts Y", () => {
  assert.deepEqual(toNether({ x: 7, y: 103, z: 5 }), { x: 0, y: 103, z: 0 });
  assert.deepEqual(toNether({ x: -426, y: 72, z: 300 }), { x: -54, y: 72, z: 37 });
  assert.deepEqual(toNether({ x: -1, y: null, z: -8 }), { x: -1, y: null, z: -1 });
  assert.deepEqual(toNether({ x: -9, y: 5, z: 15 }), { x: -2, y: 5, z: 1 });
  assert.ok(Object.is(toNether({ x: -0, y: 1, z: 0 }).x, 0), "no negative zero");
  assert.deepEqual(toOverworld({ x: -54, y: 72, z: 37 }), { x: -432, y: 72, z: 296 });
  assert.deepEqual(toOverworld({ x: 0, y: null, z: -1 }), { x: 0, y: null, z: -8 });
});

test("convertCoord: Overworld <-> Nether only; the End has no conversion", () => {
  assert.deepEqual(convertCoord({ x: 16, y: 64, z: -17 }, "overworld"), { dimension: "the_nether", coord: { x: 2, y: 64, z: -3 } });
  assert.deepEqual(convertCoord({ x: 2, y: 64, z: -3 }, "the_nether"), { dimension: "overworld", coord: { x: 16, y: 64, z: -24 } });
  assert.equal(convertCoord({ x: 1, y: 1, z: 1 }, "the_end"), null);
});

test("buildSpawnCard: only on the Overworld tab, generated from world.spawn", () => {
  const { worlds } = createHashContext();
  const card = buildSpawnCard(worlds[0], "overworld");
  assert.deepEqual(card, {
    kind: "spawn",
    worldId: "player_club",
    targetId: "spawn:player_club",
    dimension: "overworld",
    x: 7,
    y: 103,
    z: 5,
    copyText: "7 103 5",
  });
  assert.equal(buildSpawnCard(worlds[0], "the_nether"), null);
  assert.equal(buildSpawnCard(worlds[0], "the_end"), null);
  assert.equal(buildSpawnCard({ ...worlds[0], spawn: undefined }, "overworld"), null);
  assert.equal(buildSpawnCard(null, "overworld"), null);
  assert.equal(spawnTargetId("survival_two"), "spawn:survival_two");
  assert.equal(buildSpawnCard(worlds[1], "overworld").copyText, "0 64 0");
});

test("normalizeSearch: NFKC, lower case, collapsed whitespace", () => {
  assert.equal(normalizeSearch(`  ＶＩＬＬＡＧＥ${String.fromCodePoint(0x3000)}１  `), "village 1"); // ideographic space
  assert.equal(normalizeSearch("Nether\tFortress"), "nether fortress");
  assert.equal(normalizeSearch(undefined), "");
});

test("matchPoint searches id, name, note, bilingual tag names and submittedBy", () => {
  const ctx = createHashContext();
  const [village, fortress] = ctx.points.player_club;
  const tags = indexTags(ctx.tags);
  assert.equal(matchPoint(village, { query: "" }, tags), true);
  assert.equal(matchPoint(village, { query: "village" }, tags), true);
  assert.equal(matchPoint(village, { query: "P0001" }, tags), true);
  assert.equal(matchPoint(village, { query: "村莊" }, tags), true, "zh-TW tag name");
  assert.equal(matchPoint(fortress, { query: "lava" }, tags), true, "note");
  assert.equal(matchPoint(fortress, { query: "FRIEND-01" }, tags), true, "submittedBy");
  assert.equal(matchPoint(fortress, { query: "要塞" }, ctx.tags), true, "accepts the tags array");
  assert.equal(matchPoint(fortress, { query: "nether gate" }, tags), true, "every word matches some field");
  assert.equal(matchPoint(fortress, { query: "nether village" }, tags), false);
  assert.equal(matchPoint(village, { query: "fortress" }, tags), false);
});

test("matchPoint: tags OR, AND with the query, optional dimension", () => {
  const ctx = createHashContext();
  const [village, fortress] = ctx.points.player_club;
  assert.equal(matchPoint(village, { tagIds: ["village", "nether_fortress"] }), true);
  assert.equal(matchPoint(fortress, { tagIds: ["village", "nether_fortress"] }), true);
  assert.equal(matchPoint(village, { tagIds: ["base"] }), false);
  assert.equal(matchPoint(village, { query: "village", tagIds: ["nether_fortress"] }, ctx.tags), false);
  assert.equal(matchPoint(village, { dimension: "overworld" }), true);
  assert.equal(matchPoint(village, { dimension: "the_nether" }), false);
});

test("sortPoints: createdAt descending, then numeric id descending; input untouched", () => {
  const points = [
    { id: "p0002", createdAt: "2026-09-29T01:00:00Z" },
    { id: "p9999", createdAt: "2026-09-29T02:00:00Z" },
    { id: "p10000", createdAt: "2026-09-29T02:00:00Z" },
    { id: "p0001", createdAt: "2026-09-30T00:00:00Z" },
  ];
  const copy = structuredClone(points);
  assert.deepEqual(sortPoints(points).map((p) => p.id), ["p0001", "p10000", "p9999", "p0002"]);
  assert.deepEqual(points, copy);
});

test("sortChangelogEntries: date descending, then id descending within a day", () => {
  const entries = [
    { id: "c0001", date: "2026-09-29" },
    { id: "c0003", date: "2026-09-30" },
    { id: "c0002", date: "2026-09-30" },
    { id: "c0010", date: "2026-09-29" },
  ];
  assert.deepEqual(sortChangelogEntries(entries).map((e) => e.id), ["c0003", "c0002", "c0010", "c0001"]);
});

test("text helpers follow the plainText rule", () => {
  assert.equal(hasControlChars("a\u0000b"), true);
  assert.equal(hasControlChars("a\u202Eb"), true, "bidi override");
  assert.equal(hasControlChars("a\u200Bb"), true, "zero-width space");
  assert.equal(hasControlChars("a\nb"), true);
  assert.equal(hasControlChars("a\nb", { allowNewline: true }), false);
  assert.equal(stripControlChars("vi\u200Bllage\u0007\n"), "village");
  assert.equal(isPlainText("Village 1"), true);
  assert.equal(isPlainText(" Village"), false);
  assert.equal(isPlainText("a\nb"), false);
  assert.equal(isPlainText("a\nb", { allowNewline: true }), true);
  assert.equal(isPlainText(1), false);
  assert.equal(codePointLength("村莊😀"), 3);
});

test("text helpers reject every format, control and invisible character", () => {
  const rejected = [
    0x007f, 0x0080, 0x0085, 0x009f, 0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180e, 0x180f,
    0x200b, 0x200d, 0x200e, 0x202e, 0x2028, 0x2029, 0x2060, 0x2064, 0x2065, 0x2066, 0x2800, 0x3164, 0xfeff, 0xffa0,
    0xfff0, 0xfff9, 0xfffb, 0x1d159, 0x1d173, 0xe0000, 0xe0001, 0xe0020, 0xe007f, 0xe0100, 0xe01ef, 0xe0fff,
  ];
  for (const cp of rejected) {
    const text = `a${String.fromCodePoint(cp)}b`;
    const label = `U+${cp.toString(16).toUpperCase()}`;
    assert.equal(hasControlChars(text), true, label);
    assert.equal(hasControlChars(text, { allowNewline: true }), true, label);
    assert.equal(isPlainText(text), false, label);
    assert.equal(stripControlChars(text), "ab", label);
  }
  assert.equal(hasControlChars("a\uD800b"), true, "lone surrogate");
  assert.equal(stripControlChars("a\uDC00b"), "ab", "lone surrogate");
  // Invisible and combining characters come from code points: VS16, combining acute, ideographic space, NBSP.
  const cp = (n) => String.fromCodePoint(n);
  for (const ok of ["村莊 Village", "😀", `❤${cp(0xfe0f)}`, `Cafe${cp(0x301)}`, `a${cp(0x3000)}b`, "Ｘ１２", `a${cp(0xa0)}b`]) {
    assert.equal(hasControlChars(ok), false, ok);
  }
});

test("text.js writes every rejected character as an escape (the source is printable ASCII)", async () => {
  const source = (await readFile(new URL("../../site/js/lib/text.js", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const offending = [...source].filter((ch) => ch !== "\n" && (ch < " " || ch > "~"));
  assert.deepEqual(offending.map((ch) => ch.codePointAt(0).toString(16)), []);
});
