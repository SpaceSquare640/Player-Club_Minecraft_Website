// In-memory replacements for file access: a data set reader (same interface as createFsReader)
// and a simple file store, so script entry points can be tested without touching the disk.

import { CORE_FILES, I18N_DIR, LANGS, POINTS_DIR, i18nPath, pointsPath } from "../../scripts/lib/load-data.mjs";

/** Reader over an in-memory data set (see tests/fixtures/dataset.mjs). */
export function memoryReader(dataset) {
  const files = new Map();
  for (const file of CORE_FILES) {
    if (dataset[file.key] !== undefined) files.set(file.path, JSON.stringify(dataset[file.key]));
  }
  for (const [stem, data] of Object.entries(dataset.points ?? {})) files.set(pointsPath(stem), JSON.stringify(data));
  if (dataset.i18n) {
    for (const lang of LANGS) {
      if (dataset.i18n[lang]) files.set(i18nPath(lang), JSON.stringify(dataset.i18n[lang]));
    }
  }
  return {
    async read(relPath) {
      return files.has(relPath) ? files.get(relPath) : null;
    },
    async list(relDir) {
      if (relDir === POINTS_DIR) return Object.keys(dataset.points ?? {}).map((stem) => `${stem}.json`);
      if (relDir === I18N_DIR) return dataset.i18n ? LANGS.map((lang) => `${lang}.json`) : null;
      return null;
    },
  };
}

/** Map-backed { read, write } file store. */
export function memoryIo(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async read(filePath) {
      return files.has(filePath) ? files.get(filePath) : null;
    },
    async write(filePath, content) {
      files.set(filePath, content);
    },
  };
}
