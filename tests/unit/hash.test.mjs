// site/js/lib/hash.js: URL hash spec (parse, validation order, canonical serialisation, links).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_HASH_LENGTH, changelogLink, cleanQuery, defaultState, parseHash, serializeHash, toHref } from "../../site/js/lib/hash.js";
import { createHashContext } from "../fixtures/front.mjs";

const ctx = createHashContext();
const parse = (hash, c = ctx) => parseHash(hash, c);
const reasons = (dropped) => dropped.map((d) => `${d.key}:${d.reason}`);

test("empty hash and defaults", () => {
  const expected = { tab: "points", log: "updates", worldId: "player_club", dimension: "overworld", query: "", tagIds: [], pointId: null };
  assert.deepEqual(defaultState(ctx), expected);
  for (const hash of ["", "#", "#/", undefined]) {
    assert.deepEqual(parse(hash), { state: expected, dropped: [] });
  }
  assert.equal(serializeHash(expected, ctx), "");
});

test("architecture examples parse and serialise back unchanged", () => {
  const example = "world=survival_two&dim=the_nether&q=fortress&tags=base";
  const { state, dropped } = parse(`#${example}`);
  assert.deepEqual(dropped, []);
  assert.deepEqual(state, { tab: "points", log: "updates", worldId: "survival_two", dimension: "the_nether", query: "fortress", tagIds: ["base"], pointId: null });
  assert.equal(serializeHash(state, ctx), example);
  assert.equal(serializeHash(parse("#tab=changelog&log=points").state, ctx), "tab=changelog&log=points");
  assert.equal(serializeHash(parse("#dim=the_nether&tags=nether_fortress,base").state, ctx), "dim=the_nether&tags=base,nether_fortress", "tags.json order");
});

test("a leading slash is tolerated; unknown keys ignored; duplicate keys keep the first", () => {
  const { state, dropped } = parse("#/tab=changelog&foo=1&tab=points");
  assert.equal(state.tab, "changelog");
  assert.deepEqual(reasons(dropped), ["foo:unknown", "tab:duplicate"]);
});

test("hash longer than 2048 characters falls back to defaults entirely", () => {
  const { state, dropped } = parse(`#tab=changelog&q=${"a".repeat(2100)}`);
  assert.deepEqual(state, defaultState(ctx));
  assert.deepEqual(reasons(dropped), ["*:tooLong"]);
});

test("invalid tab and log fall back; log only applies to the change log tab", () => {
  assert.deepEqual(reasons(parse("#tab=map").dropped), ["tab:invalid"]);
  const invalidLog = parse("#tab=changelog&log=all");
  assert.equal(invalidLog.state.log, "updates");
  assert.deepEqual(reasons(invalidLog.dropped), ["log:invalid"]);
  const onPoints = parse("#log=points");
  assert.equal(onPoints.state.log, "updates");
  assert.deepEqual(reasons(onPoints.dropped), ["log:notApplicable"]);
});

test("invalid world uses the default world and drops dim and point", () => {
  const { state, dropped } = parse("#world=nope&dim=the_nether&point=p0002&q=x");
  assert.equal(state.worldId, "player_club");
  assert.equal(state.dimension, "overworld");
  assert.equal(state.pointId, null);
  assert.equal(state.query, "x");
  assert.deepEqual(reasons(dropped), ["world:invalid", "point:cleared", "dim:cleared"]);
});

test("dim must belong to the world; default is the first in fixed order", () => {
  assert.deepEqual(reasons(parse("#world=survival_two&dim=the_end").dropped), ["dim:invalid"]);
  assert.equal(parse("#world=survival_two&dim=the_end").state.dimension, "overworld");
  const noOverworld = createHashContext();
  noOverworld.worlds = [{ ...noOverworld.worlds[0], dimensions: ["the_end", "the_nether"] }];
  assert.equal(defaultState(noOverworld).dimension, "the_nether");
});

test("tags: unknown or not allowed in the dimension are removed one by one; deduplicated", () => {
  const { state, dropped } = parse("#tags=village,nope,nether_fortress,village,,base");
  assert.deepEqual(state.tagIds, ["base", "village"]);
  assert.deepEqual(reasons(dropped), ["tags:invalid", "tags:invalid"]);
  assert.deepEqual(dropped.map((d) => d.value), ["nope", "nether_fortress"]);
  assert.deepEqual(parse("#dim=the_nether&tags=village").state.tagIds, []);
  assert.deepEqual(parse("#tags=old_tag").state.tagIds, ["old_tag"], "retired tags still filter existing points");
});

test("q: decoded, NFC, control characters removed, trimmed, 1-100 characters", () => {
  assert.equal(parse("#q=nether%20fortress").state.query, "nether fortress");
  assert.equal(parse("#q=nether+fortress").state.query, "nether fortress", "a typed + is a space");
  assert.equal(parse("#q=%E6%9D%91%E8%8E%8A").state.query, "村莊");
  assert.equal(parse("#q=100%25").state.query, "100%");
  assert.equal(parse("#q=%20%20a%E2%80%AEb%00%20").state.query, "ab");
  assert.equal(parse("#q=e%CC%81").state.query, "é", "NFC");
  assert.deepEqual(reasons(parse(`#q=${"a".repeat(101)}`).dropped), ["q:tooLong"]);
  assert.equal(parse(`#q=${"村".repeat(100)}`).state.query.length, 100);
  assert.deepEqual(reasons(parse("#q=%00%01").dropped), ["q:invalid"]);
  assert.deepEqual(parse("#q=").dropped, []);
  assert.deepEqual(cleanQuery(" x "), { query: "x", reason: null });
});

test("point: valid point overrides dim and clears q and tags", () => {
  const { state, dropped } = parse("#dim=overworld&q=abc&tags=village&point=p0002");
  assert.equal(state.pointId, "p0002");
  assert.equal(state.dimension, "the_nether");
  assert.equal(state.query, "");
  assert.deepEqual(state.tagIds, []);
  assert.deepEqual(reasons(dropped), ["dim:cleared", "tags:cleared", "q:cleared"]);
  assert.equal(serializeHash(state, ctx), "dim=the_nether&point=p0002");
  assert.deepEqual(parse("#point=p0002&dim=the_nether").dropped, [], "a matching dim is not reported");
});

test("point: invalid form, other world, deleted, wrong tab", () => {
  assert.deepEqual(reasons(parse("#point=p00002").dropped), ["point:invalid"]);
  assert.deepEqual(reasons(parse("#point=spawn").dropped), ["point:invalid"]);
  assert.deepEqual(reasons(parse("#point=p0003").dropped), ["point:notFound"], "p0003 is in another world");
  assert.equal(parse("#world=survival_two&point=p0003").state.pointId, "p0003");
  assert.deepEqual(reasons(parse("#point=p0999").dropped), ["point:notFound"]);
  assert.deepEqual(reasons(parse("#tab=changelog&point=p0001").dropped), ["point:notApplicable"]);
});

test("point before the world's points are loaded is kept and verified on the next parse", () => {
  const notLoaded = createHashContext({ loaded: [] });
  const first = parseHash("#q=abc&point=p0002", notLoaded);
  assert.equal(first.state.pointId, "p0002");
  assert.equal(first.state.query, "abc");
  assert.equal(serializeHash(first.state, notLoaded), "q=abc&point=p0002");
  const second = parseHash(`#${serializeHash(first.state, notLoaded)}`, ctx);
  assert.equal(second.state.dimension, "the_nether");
  assert.equal(second.state.query, "");
});

test("serialisation: defaults omitted, fixed key order, %20 for spaces, unencoded tag commas", () => {
  const state = {
    tab: "points",
    log: "points",
    worldId: "survival_two",
    dimension: "the_nether",
    query: "a b&c=d",
    tagIds: ["base"],
    pointId: "p0003",
  };
  assert.equal(serializeHash(state, ctx), "world=survival_two&dim=the_nether&q=a%20b%26c%3Dd&tags=base&point=p0003");
  assert.equal(serializeHash({ ...state, tab: "changelog" }, ctx), "tab=changelog&log=points&world=survival_two&dim=the_nether&q=a%20b%26c%3Dd&tags=base");
  assert.equal(toHref(defaultState(ctx), ctx), "#");
});

test("parse(serialize(state)) is stable for canonical states", () => {
  const hashes = [
    "",
    "tab=changelog",
    "tab=changelog&log=points&world=survival_two",
    "world=survival_two&dim=the_nether&q=hub&tags=base",
    "dim=the_nether&point=p0002",
    "q=%E6%9D%91%20100%25",
  ];
  for (const hash of hashes) {
    const { state, dropped } = parse(`#${hash}`);
    assert.deepEqual(dropped, [], hash);
    assert.equal(serializeHash(state, ctx), hash);
    assert.deepEqual(parse(`#${serializeHash(state, ctx)}`).state, state);
  }
});

test("changelogLink: existing point, removed point, spawn, unknown world, points not loaded", () => {
  const point = (worldId, id) => ({ target: { type: "point", worldId, id } });
  assert.deepEqual(changelogLink(point("player_club", "p0001"), ctx), { kind: "point", href: "#point=p0001" });
  assert.deepEqual(changelogLink(point("survival_two", "p0003"), ctx), { kind: "point", href: "#world=survival_two&point=p0003" });
  assert.deepEqual(changelogLink(point("player_club", "p0999"), ctx), { kind: "removed" });
  assert.deepEqual(changelogLink(point("gone_world", "p0001"), ctx), { kind: "removed" });
  assert.deepEqual(changelogLink(point("player_club", "p0001"), createHashContext({ loaded: [] })), { kind: "pending" });
  assert.deepEqual(changelogLink({ target: { type: "spawn", worldId: "player_club" } }, ctx), { kind: "spawn", href: "#" });
  assert.deepEqual(changelogLink({ target: { type: "spawn", worldId: "survival_two" } }, ctx), { kind: "spawn", href: "#world=survival_two" });
});

// Many tags (architecture 4.8 item 37). Ids use the longest snake id (32 characters) to stress the length limit.
function withManyTags(count) {
  const many = createHashContext();
  const ids = Array.from({ length: count }, (_, i) => `tag_${String(i + 1).padStart(2, "0")}_${"x".repeat(25)}`);
  many.tags = [...many.tags, ...ids.map((id) => ({ id, group: "facility", name: { en: id, "zh-TW": id }, dimensions: ["overworld"] }))];
  return { many, ids };
}

test("40 tags serialise in tags.json order, parse back unchanged and stay within 2048 characters", () => {
  const { many, ids } = withManyTags(40);
  assert.ok(ids.every((id) => id.length === 32));
  const state = { ...defaultState(many), tagIds: [...ids].reverse() };
  const hash = serializeHash(state, many);
  assert.equal(hash, `tags=${ids.join(",")}`);
  assert.ok(hash.length <= MAX_HASH_LENGTH, String(hash.length));
  const parsed = parseHash(`#${hash}`, many);
  assert.deepEqual(parsed.dropped, []);
  assert.deepEqual(parsed.state.tagIds, ids);
  assert.equal(serializeHash(parsed.state, many), hash);
});

test("many long tags: a hash of exactly 2048 characters is read, one character more falls back to defaults", () => {
  const { many, ids } = withManyTags(61);
  const tagsOnly = serializeHash({ ...defaultState(many), tagIds: ids }, many);
  const pad = MAX_HASH_LENGTH - tagsOnly.length - "q=&".length;
  assert.ok(pad >= 1 && pad < 100, String(pad));
  const atLimit = serializeHash({ ...defaultState(many), tagIds: ids, query: "a".repeat(pad) }, many);
  assert.equal(atLimit.length, MAX_HASH_LENGTH);
  const read = parseHash(`#${atLimit}`, many);
  assert.deepEqual(read.dropped, []);
  assert.deepEqual(read.state.tagIds, ids);
  assert.equal(read.state.query.length, pad);

  const over = serializeHash({ ...defaultState(many), tagIds: ids, query: "a".repeat(pad + 1) }, many);
  assert.equal(over.length, MAX_HASH_LENGTH + 1);
  const fallback = parseHash(`#${over}`, many);
  assert.deepEqual(fallback.state, defaultState(many));
  assert.deepEqual(reasons(fallback.dropped), ["*:tooLong"]);
});
