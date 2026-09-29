// Start-up with data of an unsupported schemaVersion shows the error page, not a blank page (architecture
// 3.6 / 4.8 item 19). app.js runs against the real DOM, so its path is covered in parts: the repository and
// dictionary loader reject with SCHEMA_VERSION, app.js hands core failures to the error view, and the error
// view renders into a minimal DOM stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/load-data.mjs";
import { createRepository } from "../../site/js/data/repository.js";
import { createDictionaryLoader } from "../../site/js/i18n.js";
import { FALLBACK_TEXT, renderError } from "../../site/js/ui/error-view.js";
import { createDataset } from "../fixtures/dataset.mjs";
import { createFakeFetch } from "../fixtures/front.mjs";

const BASE = "https://example.test/site/data/";

/** Just enough of the DOM for ui/dom.js: elements with attributes, text, children and click listeners. */
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.className = "";
    this.hidden = false;
    this.ownText = "";
  }
  get textContent() {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this.children = [];
    this.ownText = String(value);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.ownText = "";
    this.children = [...nodes];
  }
  click() {
    for (const fn of this.listeners.get("click") ?? []) fn({ type: "click" });
  }
  findAll(predicate) {
    const found = [];
    for (const child of this.children) {
      if (!(child instanceof FakeElement)) continue;
      if (predicate(child)) found.push(child);
      found.push(...child.findAll(predicate));
    }
    return found;
  }
}

async function withFakeDom(fn) {
  const saved = { document: globalThis.document, location: globalThis.location };
  const reloads = [];
  globalThis.document = { createElement: (tag) => new FakeElement(tag), createTextNode: (text) => ({ textContent: String(text) }) };
  globalThis.location = { reload: () => reloads.push(true) };
  try {
    return await fn(reloads);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

function routesFor(ds) {
  return {
    [`${BASE}manifest.json`]: ds.manifest,
    [`${BASE}config.json`]: ds.config,
    [`${BASE}editions.json`]: ds.editions,
    [`${BASE}worlds.json`]: ds.worlds,
    [`${BASE}tags.json`]: ds.tags,
    [`${BASE}vpn.json`]: ds.vpn,
  };
}

async function coreError(ds) {
  try {
    await createRepository({ baseUrl: BASE, fetch: createFakeFetch(routesFor(ds)).fetch }).loadCore();
  } catch (error) {
    return error;
  }
  assert.fail("loadCore should reject");
}

test("app.js sends every start-up failure (dictionaries or core data) to the fallback error view", async () => {
  const source = await readFile(path.join(REPO_ROOT, "site/js/app.js"), "utf8");
  assert.match(source, /function failCore\(error\) \{[\s\S]*?renderError\(dom\.status, \{ error, fallbackOnly: true, onRetry: \(\) => boot\(\{ retry: true \}\) \}\);/);
  assert.match(source, /const lang = await initI18n\(\);[\s\S]*?app\.core = await repo\.loadCore\(\);\s*\} catch \(error\) \{\s*clearTimeout\(timer\);\s*failCore\(error\);\s*return;/);
});

test("a newer data version renders the error page with Reload (no retry loop, no Discord link)", async () => {
  const ds = createDataset();
  ds.manifest.schemaVersion = 2;
  const error = await coreError(ds);
  assert.equal(error.code, "SCHEMA_VERSION");

  await withFakeDom(async (reloads) => {
    const host = new FakeElement("div");
    const retries = [];
    const button = renderError(host, { error, fallbackOnly: true, discordUrl: "https://discord.gg/example", onRetry: () => retries.push(true) });
    const [panel] = host.children;
    assert.equal(panel.getAttribute("role"), "alert");
    assert.equal(panel.getAttribute("lang"), "en");
    const texts = panel.findAll((el) => el.tagName === "P").map((el) => el.textContent);
    assert.deepEqual(texts, [FALLBACK_TEXT["error.load.title"], FALLBACK_TEXT["error.schema"]]);
    assert.equal(button.textContent, FALLBACK_TEXT["error.reload"]);
    assert.equal(panel.findAll((el) => el.tagName === "A").length, 0, "no Discord link on the fallback page");
    button.click();
    assert.deepEqual(reloads, [true], "Reload reloads the page");
    assert.deepEqual(retries, [], "a version mismatch is not retried");
  });
});

test("an older file among the core files and an unsupported dictionary also end on the version error page", async () => {
  const ds = createDataset();
  ds.worlds.schemaVersion = 0;
  const error = await coreError(ds);
  assert.equal(error.code, "SCHEMA_VERSION");
  assert.equal(error.file, "worlds.json");

  const dictionary = { schemaVersion: 2, lang: "en", messages: { "app.title": "x" } };
  const loadDictionary = createDictionaryLoader({ baseUrl: "https://example.test/site/i18n/", fetch: createFakeFetch({ "i18n/en.json": dictionary }).fetch });
  const dictError = await loadDictionary("en").then(
    () => assert.fail("the dictionary should be rejected"),
    (e) => e,
  );
  assert.equal(dictError.code, "SCHEMA_VERSION");

  await withFakeDom(async () => {
    for (const e of [error, dictError]) {
      const host = new FakeElement("div");
      const button = renderError(host, { error: e, fallbackOnly: true, onRetry: () => {} });
      assert.equal(button.textContent, FALLBACK_TEXT["error.reload"]);
      assert.ok(host.textContent.includes(FALLBACK_TEXT["error.schema"]));
    }
  });
});

test("other start-up failures render Retry, which calls boot again", async () => {
  const ds = createDataset();
  const error = await createRepository({ baseUrl: BASE, fetch: createFakeFetch({ ...routesFor(ds), [`${BASE}worlds.json`]: { status: 500 } }).fetch })
    .loadCore()
    .then(
      () => assert.fail("loadCore should reject"),
      (e) => e,
    );
  assert.equal(error.code, "HTTP");
  await withFakeDom(async (reloads) => {
    const host = new FakeElement("div");
    const retries = [];
    const button = renderError(host, { error, fallbackOnly: true, onRetry: () => retries.push(true) });
    assert.equal(button.textContent, FALLBACK_TEXT["error.retry"]);
    button.click();
    assert.deepEqual(retries, [true]);
    assert.deepEqual(reloads, []);
  });
});
