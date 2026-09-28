// site/js/state.js with a fake window: hash sync, history modes, normalisation rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, diffState } from "../../site/js/state.js";
import { createFakeWindow, createHashContext } from "../fixtures/front.mjs";

function setup(hash = "", options = {}) {
  const win = createFakeWindow(hash);
  const ctx = options.ctx ?? createHashContext();
  const store = createStore({ win, lang: options.lang ?? "en" });
  const events = [];
  store.subscribe((state, prev, meta) => events.push({ state, prev, meta }));
  store.setContext(ctx);
  return { win, store, events, ctx };
}

test("initial state before data: defaults, and syncFromHash leaves the hash untouched", () => {
  const win = createFakeWindow("world=survival_two");
  const store = createStore({ win });
  assert.deepEqual(store.getState(), { tab: "points", log: "updates", worldId: null, dimension: null, query: "", tagIds: [], pointId: null, lang: "en" });
  store.syncFromHash();
  assert.equal(win.location.hash, "#world=survival_two");
  assert.deepEqual(win.calls, []);
});

test("syncFromHash applies the hash, rewrites it canonically with replaceState and reports dropped params", () => {
  const { win, store, events } = setup("/tags=nether_fortress,base&dim=the_nether&foo=1&point=p0999");
  const { state, dropped } = store.syncFromHash();
  assert.equal(state.dimension, "the_nether");
  assert.deepEqual(state.tagIds, ["base", "nether_fortress"]);
  assert.deepEqual(dropped.map((d) => `${d.key}:${d.reason}`), ["foo:unknown", "point:notFound"]);
  assert.deepEqual(win.calls, [{ mode: "replace", url: "#dim=the_nether&tags=base,nether_fortress" }]);
  assert.equal(events.length, 1);
  assert.equal(events[0].meta.source, "hash");
  assert.deepEqual(events[0].meta.dropped, dropped);
});

test("an invalid-only hash is removed entirely (URL without #)", () => {
  const { win, store } = setup("world=nope");
  store.syncFromHash();
  assert.deepEqual(win.calls, [{ mode: "replace", url: "/Player-Club_Minecraft_Website/" }]);
  assert.equal(win.location.hash, "");
});

test("setState writes history with push / replace / none", () => {
  const { win, store } = setup();
  store.syncFromHash();
  store.setState({ dimension: "the_nether" }, { history: "push" });
  store.setState({ query: "hub" }, { history: "replace" });
  store.setState({ tagIds: ["base"] }, { history: "none" });
  assert.deepEqual(win.calls, [
    { mode: "push", url: "#dim=the_nether" },
    { mode: "replace", url: "#dim=the_nether&q=hub" },
  ]);
  assert.deepEqual(store.getState().tagIds, ["base"]);
  assert.throws(() => store.setState({ tab: "changelog" }, { history: "back" }), RangeError);
});

test("no change means no history entry and no notification", () => {
  const { win, store, events } = setup();
  store.syncFromHash();
  const count = events.length;
  assert.equal(store.setState({ dimension: "overworld" }, { history: "push" }), false);
  assert.deepEqual(win.calls, []);
  assert.equal(events.length, count);
});

test("switching world resets the dimension and clears tags, keeping the query", () => {
  const { store } = setup("dim=the_nether&q=hub&tags=base");
  store.syncFromHash();
  store.setState({ worldId: "survival_two" }, { history: "push" });
  const state = store.getState();
  assert.equal(state.worldId, "survival_two");
  assert.equal(state.dimension, "overworld");
  assert.deepEqual(state.tagIds, []);
  assert.equal(state.query, "hub");
});

test("switching dimension keeps the query and drops tags not allowed there", () => {
  const { store } = setup("q=v&tags=village,base");
  store.syncFromHash();
  store.setState({ dimension: "the_nether" }, { history: "push" });
  assert.deepEqual(store.getState().tagIds, ["base"]);
  assert.equal(store.getState().query, "v");
});

test("any state change removes point; an explicit point clears q and tags", () => {
  const { win, store } = setup("point=p0002");
  store.syncFromHash();
  assert.equal(store.getState().pointId, "p0002");
  assert.equal(store.getState().dimension, "the_nether");
  store.setState({ query: "fort" }, { history: "replace" });
  assert.equal(store.getState().pointId, null);
  assert.equal(win.location.hash, "#dim=the_nether&q=fort");
  store.setState({ pointId: "p0001" }, { history: "push" });
  assert.deepEqual([store.getState().pointId, store.getState().dimension, store.getState().query], ["p0001", "overworld", ""]);
  store.setState({ pointId: null }, { history: "replace" });
  assert.equal(win.location.hash, "");
});

test("lang lives in state but never in the hash", () => {
  const { win, store, events } = setup("tab=changelog");
  store.syncFromHash();
  store.setState({ lang: "zh-TW" }, { history: "push" });
  assert.equal(store.getState().lang, "zh-TW");
  assert.equal(win.location.hash, "#tab=changelog");
  assert.deepEqual(win.calls, []);
  assert.deepEqual(events.at(-1).meta.changed, ["lang"]);
});

test("popstate / hashchange re-parse and notify only when the state differs", () => {
  const { win, store, events } = setup();
  store.syncFromHash();
  store.start();
  store.start();
  assert.equal(win.listenerCount("popstate"), 1);
  assert.equal(win.listenerCount("hashchange"), 1);
  win.navigate("tab=changelog&log=points", "popstate");
  assert.equal(store.getState().tab, "changelog");
  assert.equal(store.getState().log, "points");
  const count = events.length;
  win.navigate("tab=changelog&log=points", "hashchange");
  assert.equal(events.length, count, "same state, no re-render");
  win.navigate("tab=changelog&log=bogus");
  assert.equal(store.getState().log, "updates");
  assert.equal(win.location.hash, "#tab=changelog");
  store.stop();
  assert.equal(win.listenerCount("popstate"), 0);
  win.navigate("");
  assert.equal(store.getState().tab, "changelog", "no longer listening");
});

test("a point verified after its world's points load", () => {
  const notLoaded = createHashContext({ loaded: [] });
  const { win, store } = setup("world=survival_two&q=x&point=p0003", { ctx: notLoaded });
  store.syncFromHash();
  assert.equal(store.getState().pointId, "p0003");
  assert.equal(win.location.hash, "#world=survival_two&q=x&point=p0003");
  store.setContext(createHashContext());
  const { dropped } = store.syncFromHash();
  assert.deepEqual(dropped.map((d) => d.reason), ["cleared"]);
  assert.equal(store.getState().dimension, "the_nether");
  assert.equal(win.location.hash, "#world=survival_two&dim=the_nether&point=p0003");
});

test("state objects are frozen and unsubscribe works", () => {
  const { store, events } = setup();
  store.syncFromHash();
  assert.ok(Object.isFrozen(store.getState()));
  assert.ok(Object.isFrozen(store.getState().tagIds));
  const off = store.subscribe(() => {
    throw new Error("should not be called");
  });
  off();
  store.setState({ tab: "changelog" }, { history: "push" });
  assert.equal(events.at(-1).state.tab, "changelog");
  assert.deepEqual(diffState({ tagIds: ["a"] }, { tagIds: ["a"] }), []);
  assert.deepEqual(diffState({ tagIds: ["a"] }, { tagIds: ["b"] }), ["tagIds"]);
});
