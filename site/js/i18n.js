// Interface dictionaries (site/i18n/<lang>.json). English is the primary language:
// - First visit is always "en"; the browser language is never detected.
// - The choice is remembered in localStorage under "pcmw.lang" (every access guarded).
// - zh-TW falls back to en per key; a key missing in both returns the key name and warns once.
// - <html lang> follows the current language.
// Browser globals are read lazily, so the module can be imported and tested in Node.

import { DataError, checkSchemaVersion, fetchJson } from "./data/repository.js";

export const LANGS = ["en", "zh-TW"];
export const DEFAULT_LANG = "en";
export const STORAGE_KEY = "pcmw.lang";
/** Language switcher labels in their own language; English first. */
export const LANG_NAMES = Object.freeze({ en: "English", "zh-TW": "繁中" });

export const isSupportedLang = (lang) => LANGS.includes(lang);

/** Stored language, or null when absent, invalid or when storage is unavailable. */
export function readStoredLang(storage) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return isSupportedLang(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remembers the language; returns false when storage is unavailable or throws. */
export function writeStoredLang(storage, lang) {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, lang);
    return true;
  } catch {
    return false;
  }
}

/** Requested language when supported, otherwise the stored one, otherwise "en". */
export function resolveInitialLang(requested, storage) {
  if (isSupportedLang(requested)) return requested;
  return readStoredLang(storage) ?? DEFAULT_LANG;
}

/** Replaces {name} placeholders; unknown placeholders are left as they are. Output is plain text. */
export function formatMessage(template, params) {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, name) =>
    params && Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Loader for i18n/<lang>.json, resolved against baseUrl (default new URL("./i18n/", document.baseURI)).
 * Uses the repository's fetch helper, so dictionaries share its no-cache policy and DataError codes.
 */
export function createDictionaryLoader({ baseUrl, fetch: fetchImpl } = {}) {
  let base = null;
  const doFetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
  return async function loadDictionary(lang) {
    base ??= new URL(String(baseUrl ?? new URL("./i18n/", globalThis.document.baseURI)));
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    const file = `i18n/${lang}.json`;
    const data = await fetchJson(new URL(`${lang}.json`, base), file, doFetch);
    checkSchemaVersion(data, file);
    if (data.lang !== lang || !isObject(data.messages)) throw new DataError("PARSE", file);
    return data.messages;
  };
}

/**
 * @param {{ loadDictionary?: (lang: string) => Promise<object>, storage?: Storage | null,
 *   documentElement?: { lang: string } | null, warn?: (...args: unknown[]) => void }} [deps]
 *   Defaults: fetch from ./i18n/, window.localStorage, document.documentElement, console.warn.
 */
export function createI18n(deps = {}) {
  const loadDictionary = deps.loadDictionary ?? createDictionaryLoader();
  const getStorage = () => (deps.storage !== undefined ? deps.storage : defaultStorage());
  const getRoot = () => (deps.documentElement !== undefined ? deps.documentElement : globalThis.document?.documentElement ?? null);
  const warn = deps.warn ?? ((...args) => globalThis.console?.warn(...args));

  const dictionaries = new Map();
  const pending = new Map();
  const warned = new Set();
  let lang = DEFAULT_LANG;

  function ensure(target) {
    if (dictionaries.has(target)) return Promise.resolve();
    if (!pending.has(target)) {
      const promise = Promise.resolve()
        .then(() => loadDictionary(target))
        .then((messages) => {
          dictionaries.set(target, messages);
        })
        .finally(() => pending.delete(target));
      pending.set(target, promise);
    }
    return pending.get(target);
  }

  function applyLang() {
    const root = getRoot();
    if (root) root.lang = lang;
  }

  const targetLang = (override) => (isSupportedLang(override) ? override : lang);

  function lookup(key, target) {
    const primary = dictionaries.get(target);
    if (primary && Object.hasOwn(primary, key)) return { text: primary[key], lang: target };
    const fallback = dictionaries.get(DEFAULT_LANG);
    if (target !== DEFAULT_LANG && fallback && Object.hasOwn(fallback, key)) return { text: fallback[key], lang: DEFAULT_LANG };
    return null;
  }

  /**
   * Decides the language and loads the dictionaries: en always (primary), plus the current language.
   * Rejects with a DataError when en cannot be loaded; if only zh-TW fails, the page stays in en
   * for this visit without overwriting the stored choice.
   * @param {string} [requested] Explicit language; otherwise the stored one, otherwise "en".
   */
  async function init(requested) {
    let target = resolveInitialLang(requested, getStorage());
    await ensure(DEFAULT_LANG);
    if (target !== DEFAULT_LANG) {
      try {
        await ensure(target);
      } catch (error) {
        warn(`[i18n] Could not load ${target}; using ${DEFAULT_LANG}`, error);
        target = DEFAULT_LANG;
      }
    }
    lang = target;
    applyLang();
    return lang;
  }

  /** Switches language after its dictionary is loaded (rejects and keeps the current one on failure). */
  async function setLang(next) {
    if (!isSupportedLang(next)) throw new RangeError(`Unsupported language: ${next}`);
    await ensure(next);
    lang = next;
    writeStoredLang(getStorage(), next);
    applyLang();
    return lang;
  }

  /**
   * Message for key with {name} placeholders filled from params.
   * @param {string} key
   * @param {object} [params]
   * @param {string} [langOverride] e.g. t("footer.minecraftNotice", {}, "en") for the permanent English notice.
   */
  function t(key, params, langOverride) {
    const found = lookup(key, targetLang(langOverride));
    if (!found) {
      if (!warned.has(key)) {
        warned.add(key);
        warn(`[i18n] Missing dictionary key: ${key}`);
      }
      return key;
    }
    return formatMessage(found.text, params);
  }

  /** Language that actually provides key ("en" when zh-TW fell back), or null; used for lang="en". */
  function textLang(key, langOverride) {
    return lookup(key, targetLang(langOverride))?.lang ?? null;
  }

  /** Plural message: key.<Intl.PluralRules category> (for example key.one / key.other), with {n}. */
  function plural(key, n, params, langOverride) {
    const target = targetLang(langOverride);
    let category = "other";
    try {
      category = new Intl.PluralRules(target).select(n);
    } catch {
      category = "other";
    }
    const chosen = lookup(`${key}.${category}`, target) ? `${key}.${category}` : `${key}.other`;
    return t(chosen, { ...params, n }, target);
  }

  /** Current-language value of a LocalizedText ({ en, "zh-TW" }); falls back to en. Strings pass through. */
  function pick(value, langOverride) {
    if (typeof value === "string") return value;
    if (!isObject(value)) return "";
    for (const candidate of [targetLang(langOverride), DEFAULT_LANG, ...LANGS]) {
      if (typeof value[candidate] === "string" && value[candidate] !== "") return value[candidate];
    }
    return "";
  }

  return { init, setLang, getLang: () => lang, t, textLang, plural, pick, isLoaded: (l) => dictionaries.has(l) };
}

// Default instance for the site (browser globals are read on first use).
const i18n = createI18n();
export const initI18n = (lang) => i18n.init(lang);
export const setLang = (lang) => i18n.setLang(lang);
export const getLang = () => i18n.getLang();
export const t = (key, params, lang) => i18n.t(key, params, lang);
export const textLang = (key, lang) => i18n.textLang(key, lang);
export const plural = (key, n, params, lang) => i18n.plural(key, n, params, lang);
export const pick = (value, lang) => i18n.pick(value, lang);
