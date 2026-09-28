// site/js/i18n.js with fake storage / loader, plus checks on the committed dictionaries (X19 active).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_LANG,
  LANGS,
  LANG_NAMES,
  STORAGE_KEY,
  createDictionaryLoader,
  createI18n,
  formatMessage,
  readStoredLang,
  resolveInitialLang,
  writeStoredLang,
} from "../../site/js/i18n.js";
import { DataError } from "../../site/js/data/repository.js";
import { REPO_ROOT, createFsReader, loadDataset } from "../../scripts/lib/load-data.mjs";
import { validateDataset } from "../../scripts/validate.mjs";
import { createFakeFetch, createFakeStorage } from "../fixtures/front.mjs";

const DICTS = {
  en: {
    "nav.changelog": "Change Log",
    "world.spawn.copied": "Copied world spawn: {value}",
    "result.count.one": "{n} point",
    "result.count.other": "{n} points",
    "footer.minecraftNotice": "NOT AN OFFICIAL MINECRAFT PRODUCT.",
    "only.en": "English only",
  },
  "zh-TW": {
    "nav.changelog": "變更紀錄",
    "world.spawn.copied": "已複製世界出生點：{value}",
    "result.count.one": "顯示 {n} 筆座標",
    "result.count.other": "顯示 {n} 筆座標",
    "footer.minecraftNotice": "（非官方 Minecraft 產品。）",
  },
};

function setup({ stored, throwing = false, failLangs = [] } = {}) {
  const storage = createFakeStorage(stored ? { [STORAGE_KEY]: stored } : {}, { throwing });
  const root = { lang: "" };
  const warnings = [];
  const loads = [];
  const i18n = createI18n({
    storage,
    documentElement: root,
    warn: (...args) => warnings.push(args.map(String).join(" ")),
    loadDictionary: async (lang) => {
      loads.push(lang);
      if (failLangs.includes(lang)) throw new DataError("NETWORK", `i18n/${lang}.json`);
      return DICTS[lang];
    },
  });
  return { i18n, storage, root, warnings, loads };
}

test("first visit is always English; the browser language is never consulted", async () => {
  const { i18n, root, loads, storage } = setup();
  assert.equal(await i18n.init(), "en");
  assert.equal(i18n.getLang(), "en");
  assert.equal(root.lang, "en");
  assert.deepEqual(loads, ["en"]);
  assert.equal(storage.data.size, 0, "init does not write storage");
  const source = await readFile(path.join(REPO_ROOT, "site/js/i18n.js"), "utf8");
  assert.doesNotMatch(source, /navigator|Accept-Language/i);
});

test("stored language is used and both dictionaries are loaded", async () => {
  const { i18n, root, loads } = setup({ stored: "zh-TW" });
  assert.equal(await i18n.init(), "zh-TW");
  assert.equal(root.lang, "zh-TW");
  assert.deepEqual(loads, ["en", "zh-TW"]);
  assert.equal(i18n.t("nav.changelog"), "變更紀錄");
});

test("invalid stored value and throwing storage fall back to English", async () => {
  assert.equal(await setup({ stored: "fr" }).i18n.init(), "en");
  const blocked = setup({ stored: "zh-TW", throwing: true });
  assert.equal(await blocked.i18n.init(), "en");
  assert.equal(await blocked.i18n.setLang("zh-TW"), "zh-TW", "switching works even when storage throws");
  assert.equal(readStoredLang(createFakeStorage({}, { throwing: true })), null);
  assert.equal(writeStoredLang(createFakeStorage({}, { throwing: true }), "en"), false);
  assert.equal(writeStoredLang(null, "en"), false);
  assert.equal(readStoredLang(undefined), null);
  assert.equal(resolveInitialLang("zh-TW", null), "zh-TW");
  assert.equal(resolveInitialLang("de", createFakeStorage({ [STORAGE_KEY]: "zh-TW" })), "zh-TW");
});

test("setLang remembers the choice, syncs <html lang> and keeps the language when loading fails", async () => {
  const { i18n, storage, root } = setup();
  await i18n.init();
  await i18n.setLang("zh-TW");
  assert.equal(storage.data.get(STORAGE_KEY), "zh-TW");
  assert.equal(root.lang, "zh-TW");
  await i18n.setLang("en");
  assert.equal(storage.data.get(STORAGE_KEY), "en");
  await assert.rejects(i18n.setLang("fr"), RangeError);

  const failing = setup({ failLangs: ["zh-TW"] });
  await failing.i18n.init();
  await assert.rejects(failing.i18n.setLang("zh-TW"), DataError);
  assert.equal(failing.i18n.getLang(), "en");
  assert.equal(failing.root.lang, "en");
  assert.equal(failing.storage.data.size, 0);
});

test("zh-TW failing at start stays in English for this visit; en failing rejects", async () => {
  const zhFails = setup({ stored: "zh-TW", failLangs: ["zh-TW"] });
  assert.equal(await zhFails.i18n.init(), "en");
  assert.equal(zhFails.storage.data.get(STORAGE_KEY), "zh-TW", "stored choice is kept");
  assert.equal(zhFails.warnings.length, 1);
  await assert.rejects(setup({ failLangs: ["en"] }).i18n.init(), (e) => e instanceof DataError && e.code === "NETWORK");
});

test("t: zh-TW falls back to en per key, then returns the key name and warns once", async () => {
  const { i18n, warnings } = setup({ stored: "zh-TW" });
  await i18n.init();
  assert.equal(i18n.t("only.en"), "English only");
  assert.equal(i18n.textLang("only.en"), "en");
  assert.equal(i18n.textLang("nav.changelog"), "zh-TW");
  assert.deepEqual(warnings, []);
  assert.equal(i18n.t("missing.key"), "missing.key");
  assert.equal(i18n.t("missing.key"), "missing.key");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /missing\.key/);
  assert.equal(i18n.textLang("missing.key"), null);
});

test("t: placeholders and the explicit language argument (permanent English notice)", async () => {
  const { i18n } = setup({ stored: "zh-TW" });
  await i18n.init();
  assert.equal(i18n.t("world.spawn.copied", { value: "7 103 5" }), "已複製世界出生點：7 103 5");
  assert.equal(i18n.t("world.spawn.copied", { value: "<b>" }), "已複製世界出生點：<b>", "plain text, no markup handling");
  assert.equal(i18n.t("footer.minecraftNotice", {}, "en"), "NOT AN OFFICIAL MINECRAFT PRODUCT.");
  assert.equal(i18n.t("footer.minecraftNotice"), "（非官方 Minecraft 產品。）");
  assert.equal(formatMessage("{a} {b} {a}", { a: 1 }), "1 {b} 1");
  assert.equal(formatMessage("{n}", { n: 0 }), "0");
});

test("plural uses Intl.PluralRules categories with {n}", async () => {
  const { i18n } = setup();
  await i18n.init();
  assert.equal(i18n.plural("result.count", 1), "1 point");
  assert.equal(i18n.plural("result.count", 0), "0 points");
  assert.equal(i18n.plural("result.count", 12), "12 points");
  await i18n.setLang("zh-TW");
  assert.equal(i18n.plural("result.count", 1), "顯示 1 筆座標");
});

test("pick returns the current language of LocalizedText with en fallback", async () => {
  const { i18n } = setup();
  await i18n.init();
  const text = { en: "Village", "zh-TW": "村莊" };
  assert.equal(i18n.pick(text), "Village");
  assert.equal(i18n.pick(text, "zh-TW"), "村莊");
  await i18n.setLang("zh-TW");
  assert.equal(i18n.pick(text), "村莊");
  assert.equal(i18n.pick({ en: "Only en" }), "Only en");
  assert.equal(i18n.pick("Player_Club"), "Player_Club");
  assert.equal(i18n.pick(null), "");
});

test("dictionary loader: no-cache fetch, schemaVersion and lang checks", async () => {
  const base = "https://example.test/site/i18n/";
  const ok = createFakeFetch({ [`${base}en.json`]: { schemaVersion: 1, lang: "en", messages: { "a.b": "x" } } });
  assert.deepEqual(await createDictionaryLoader({ baseUrl: base, fetch: ok.fetch })("en"), { "a.b": "x" });
  assert.equal(ok.requests[0].init.cache, "no-cache");
  const wrongLang = createFakeFetch({ [`${base}en.json`]: { schemaVersion: 1, lang: "zh-TW", messages: {} } });
  await assert.rejects(createDictionaryLoader({ baseUrl: base, fetch: wrongLang.fetch })("en"), (e) => e.code === "PARSE" && e.file === "i18n/en.json");
  const version = createFakeFetch({ [`${base}en.json`]: { schemaVersion: 9, lang: "en", messages: {} } });
  await assert.rejects(createDictionaryLoader({ baseUrl: base, fetch: version.fetch })("en"), (e) => e.code === "SCHEMA_VERSION");
});

// Committed dictionaries

const readDict = async (lang) => JSON.parse(await readFile(path.join(REPO_ROOT, "site/i18n", `${lang}.json`), "utf8"));
const placeholders = (text) => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();

test("committed dictionaries: en is complete and both languages have the same keys and placeholders", async () => {
  const en = (await readDict("en")).messages;
  const zh = (await readDict("zh-TW")).messages;
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.deepEqual(placeholders(zh[key]), placeholders(en[key]), key);
    assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9_]*)+$/);
    for (const text of [en[key], zh[key]]) assert.doesNotMatch(text, /[—–]|<[a-z/]/i, `${key}: no dashes or markup`);
  }
  for (const key of ["dimension.overworld", "dimension.the_nether", "dimension.the_end", "edition.java", "edition.bedrock", "vpn.radmin.title", "footer.minecraftNotice", "result.count.one", "result.count.other", "nav.changelog", "world.spawn", "error.schema"]) {
    assert.ok(Object.hasOwn(en, key), key);
  }
  assert.equal(en["nav.changelog"], "Change Log");
  assert.equal(zh["nav.changelog"], "變更紀錄");
  assert.deepEqual(LANGS, ["en", "zh-TW"]);
  assert.equal(DEFAULT_LANG, "en");
  assert.deepEqual(Object.keys(LANG_NAMES), ["en", "zh-TW"]);
});

test("X19 is active on the committed data: dictionaries present, no errors or warnings", async () => {
  const { dataset, issues } = await loadDataset(createFsReader(REPO_ROOT));
  assert.deepEqual(issues, []);
  assert.ok(dataset.i18n?.en && dataset.i18n["zh-TW"]);
  const result = validateDataset(dataset);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.crossSkipped, false);
});
