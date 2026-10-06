// Loads the data set (site/data and site/i18n) through a reader, so the same code reads
// the working tree (fs) or a git revision (see git.mjs).

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseJsonText } from "./json-io.mjs";

export const SUPPORTED_SCHEMA_VERSION = 1;
export const LANGS = ["en", "zh-TW"];
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Repo-relative paths (forward slashes) and the schema of each core file. */
export const CORE_FILES = [
  { key: "manifest", path: "site/data/manifest.json", schema: "manifest" },
  { key: "config", path: "site/data/config.json", schema: "config" },
  { key: "editions", path: "site/data/editions.json", schema: "editions" },
  { key: "worlds", path: "site/data/worlds.json", schema: "worlds" },
  { key: "tags", path: "site/data/tags.json", schema: "tags" },
  { key: "vpn", path: "site/data/vpn.json", schema: "vpn" },
  { key: "updates", path: "site/data/changelog/updates.json", schema: "changelog-updates" },
  { key: "changes", path: "site/data/changelog/points.json", schema: "changelog-points" },
];
export const POINTS_DIR = "site/data/points";
export const COMMANDS_DIR = "site/data/commands";
export const I18N_DIR = "site/i18n";

export const pathOf = (key) => CORE_FILES.find((f) => f.key === key).path;
export const pointsPath = (worldId) => `${POINTS_DIR}/${worldId}.json`;
export const commandsPath = (worldId) => `${COMMANDS_DIR}/${worldId}.json`;
export const i18nPath = (lang) => `${I18N_DIR}/${lang}.json`;

/** Reader over the working tree rooted at root. read/list return null when missing. */
export function createFsReader(root) {
  return {
    async read(relPath) {
      try {
        return await readFile(path.join(root, relPath), "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async list(relDir) {
      try {
        const entries = await readdir(path.join(root, relDir), { withFileTypes: true });
        return entries.filter((e) => e.isFile()).map((e) => e.name);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

function fileIssue(file, message) {
  return { level: "error", code: "FILE", file, path: "", message };
}

async function readJson(reader, relPath, issues, { required }) {
  const text = await reader.read(relPath);
  if (text === null) {
    if (required) issues.push(fileIssue(relPath, "File is missing"));
    return undefined;
  }
  try {
    const { data, bom } = parseJsonText(text);
    if (bom) issues.push(fileIssue(relPath, "File must be UTF-8 without BOM (run npm run format)"));
    return data;
  } catch (error) {
    issues.push(fileIssue(relPath, `Invalid JSON: ${error.message}`));
    return undefined;
  }
}

/**
 * Loads the data set. Missing or unparsable files are reported as FILE issues and left undefined.
 * @returns {Promise<{ dataset: object, issues: object[] }>}
 *   dataset: { manifest, config, editions, worlds, tags, vpn, updates, changes,
 *              points: { [fileStem]: data }, commands: { [fileStem]: data }, i18n: null | { en?, "zh-TW"? } }
 *   A missing commands directory means no world has commands.
 */
export async function loadDataset(reader) {
  const issues = [];
  const dataset = { points: {}, commands: {}, i18n: null };
  for (const file of CORE_FILES) {
    dataset[file.key] = await readJson(reader, file.path, issues, { required: true });
  }
  const pointFiles = (await reader.list(POINTS_DIR)) ?? [];
  for (const name of pointFiles.filter((n) => n.endsWith(".json")).sort()) {
    const data = await readJson(reader, `${POINTS_DIR}/${name}`, issues, { required: true });
    if (data !== undefined) dataset.points[name.slice(0, -".json".length)] = data;
  }
  const commandFiles = (await reader.list(COMMANDS_DIR)) ?? [];
  for (const name of commandFiles.filter((n) => n.endsWith(".json")).sort()) {
    const data = await readJson(reader, `${COMMANDS_DIR}/${name}`, issues, { required: true });
    if (data !== undefined) dataset.commands[name.slice(0, -".json".length)] = data;
  }
  const i18nFiles = await reader.list(I18N_DIR);
  if (i18nFiles !== null) {
    dataset.i18n = {};
    for (const lang of LANGS) {
      const data = await readJson(reader, i18nPath(lang), issues, { required: true });
      if (data !== undefined) dataset.i18n[lang] = data;
    }
  }
  return { dataset, issues };
}

/** Lists every loaded file as { path, schema, data } in a stable order. */
export function listDataFiles(dataset) {
  const files = [];
  for (const file of CORE_FILES) {
    if (dataset[file.key] !== undefined) files.push({ path: file.path, schema: file.schema, data: dataset[file.key] });
  }
  for (const stem of Object.keys(dataset.points ?? {}).sort()) {
    files.push({ path: pointsPath(stem), schema: "points", data: dataset.points[stem] });
  }
  for (const stem of Object.keys(dataset.commands ?? {}).sort()) {
    files.push({ path: commandsPath(stem), schema: "commands", data: dataset.commands[stem] });
  }
  for (const lang of LANGS) {
    const data = dataset.i18n?.[lang];
    if (data !== undefined) files.push({ path: i18nPath(lang), schema: "i18n", data });
  }
  return files;
}
