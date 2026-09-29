// Deploy step: copies site/ to the output directory (default _site) and stamps the asset version, so a new
// deployment is never mixed with cached CSS or JS of an older one (architecture 1.2 / 3.14).
// - Every "__ASSET_VERSION__" in HTML files becomes the first 12 hex digits of the commit SHA.
// - Every static relative import / export-from in site/js gets "?v=<version>", so the whole module graph
//   is loaded with one version (the same URL everywhere, therefore one instance of each module).
// Fails when index.html has no placeholder, a placeholder is left anywhere, or a module uses an import
// form that cannot be stamped (dynamic import(), a non-relative specifier, a specifier without ".js").
// The script never deletes anything: the output directory must not exist yet.
// Usage: node scripts/stamp-version.mjs [--out _site] [--version <commit sha>] [--dry-run]
//   --version defaults to the checked-out HEAD (the deploy builds Source_Code HEAD, not the event SHA).

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { resolveCommit } from "./lib/git.mjs";
import { REPO_ROOT } from "./lib/load-data.mjs";

export const PLACEHOLDER = "__ASSET_VERSION__";
export const SITE_DIR = "site";
export const DEFAULT_OUT = "_site";
const VERSION_LENGTH = 12;
const TEXT_EXTENSIONS = [".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".webmanifest"];

// import ... from "x" | import "x" | export * [as n] from "x" | export { ... } from "x", at the start of a line.
const STATEMENT_RE =
  /^([ \t]*(?:import\b(?![ \t]*[.(])[^;'"`]*?|export[ \t]*(?:\*(?:[ \t]+as[ \t]+[\w$]+)?|\{[^}]*\})[ \t]*from[ \t]*))(["'])([^"'\r\n]*)\2/gm;
// Every import / export-from anywhere in the code (comments and string contents removed); each one must be
// a statement that STATEMENT_RE rewrites, otherwise it has a form that cannot be stamped.
const IMPORT_COUNT_RE = /(?<![\w$.])import\b(?![ \t]*[.(:])/g;
const EXPORT_FROM_COUNT_RE = /(?<![\w$.])export\s*(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\b/g;
const SPECIFIER_RE = /^\.\.?\/[^?#"'\s]*\.js$/;

export class StampError extends Error {
  constructor(message) {
    super(message);
    this.name = "StampError";
  }
}

/** First 12 hex digits of a full commit SHA (SHA-1 or SHA-256). */
export function versionFromSha(sha) {
  const value = String(sha ?? "").trim().toLowerCase();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) throw new StampError("A full commit SHA is required for the asset version");
  return value.slice(0, VERSION_LENGTH);
}

// Removes comments and string / template literal contents so that counts only see code.
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
}

const countMatches = (text, re) => [...text.matchAll(re)].length;

/**
 * Adds "?v=<version>" to every static relative import / export-from of one module.
 * @returns {{ text: string, imports: number }}
 */
export function stampModule(source, version, file = "module") {
  const code = codeOnly(source);
  if (/\bimport\s*\(/.test(code)) throw new StampError(`${file}: dynamic import() cannot be stamped`);
  const expected = countMatches(code, IMPORT_COUNT_RE) + countMatches(code, EXPORT_FROM_COUNT_RE);
  let imports = 0;
  const text = source.replace(STATEMENT_RE, (_match, head, quote, specifier) => {
    if (!SPECIFIER_RE.test(specifier)) throw new StampError(`${file}: import "${specifier}" must be relative and end with .js`);
    imports += 1;
    return `${head}${quote}${specifier}?v=${version}${quote}`;
  });
  if (imports !== expected) throw new StampError(`${file}: ${expected - imports} import statement(s) have a form that cannot be stamped`);
  return { text, imports };
}

const posix = (p) => p.split(path.sep).join("/");
const isText = (rel) => TEXT_EXTENSIONS.includes(path.posix.extname(rel).toLowerCase());

/**
 * Stamps a site held in memory.
 * @param {Map<string, Buffer | string>} files Paths relative to site/ (forward slashes) and contents.
 * @param {string} version 12 lowercase hex digits.
 * @returns {{ files: Map<string, Buffer | string>, stats: { placeholders: number, modules: number, imports: number } }}
 */
export function stampSite(files, version) {
  if (typeof version !== "string" || !new RegExp(`^[0-9a-f]{${VERSION_LENGTH}}$`).test(version)) {
    throw new StampError(`The asset version must be ${VERSION_LENGTH} lowercase hex digits`);
  }
  if (!files.has("index.html")) throw new StampError("index.html is missing");
  const out = new Map();
  const stats = { placeholders: 0, modules: 0, imports: 0 };
  for (const [rel, content] of files) {
    const ext = path.posix.extname(rel).toLowerCase();
    if (ext === ".html") {
      const text = content.toString("utf8");
      const count = text.split(PLACEHOLDER).length - 1;
      if (rel === "index.html" && count === 0) throw new StampError(`index.html has no ${PLACEHOLDER} placeholder`);
      stats.placeholders += count;
      out.set(rel, text.split(PLACEHOLDER).join(version));
    } else if (ext === ".js" && rel.startsWith("js/")) {
      const { text, imports } = stampModule(content.toString("utf8"), version, `${SITE_DIR}/${rel}`);
      stats.modules += 1;
      stats.imports += imports;
      out.set(rel, text);
    } else {
      out.set(rel, content);
    }
  }
  for (const [rel, content] of out) {
    if (isText(rel) && content.toString("utf8").includes(PLACEHOLDER)) throw new StampError(`${SITE_DIR}/${rel} still contains ${PLACEHOLDER}`);
  }
  return { files: out, stats };
}

/** Output directory inside the repository, outside site/, and not existing yet. */
export function resolveOutDir(root, out) {
  const target = path.resolve(root, out);
  const rel = path.relative(root, target);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) throw new StampError("The output directory must be inside the repository");
  const top = posix(rel).split("/")[0];
  if (top === SITE_DIR || top === ".git") throw new StampError(`The output directory cannot be inside ${top}/`);
  return target;
}

/** File access used by run (replaceable in tests). */
export const fsIo = {
  exists: (p) => existsSync(p),
  async readTree(dir) {
    const files = new Map();
    async function walk(current) {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) files.set(posix(path.relative(dir, full)), await readFile(full));
      }
    }
    await walk(dir);
    return files;
  },
  async write(filePath, content) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  },
};

export async function run({ argv = process.argv.slice(2), root = REPO_ROOT, io = fsIo, headSha, log = console.log, logError = console.error } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: "string", default: DEFAULT_OUT },
      version: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  try {
    const sha = values.version ?? headSha ?? (await resolveCommit(root, "HEAD"));
    const version = versionFromSha(sha);
    const outDir = resolveOutDir(root, values.out);
    if (!values["dry-run"] && io.exists(outDir)) throw new StampError(`${values.out} already exists; remove it before stamping`);
    const { files, stats } = stampSite(await io.readTree(path.join(root, SITE_DIR)), version);
    if (!values["dry-run"]) {
      for (const [rel, content] of files) await io.write(path.join(outDir, ...rel.split("/")), content);
    }
    log(
      `Asset version ${version}: ${stats.placeholders} placeholder(s), ${stats.imports} import(s) in ${stats.modules} module(s), ${files.size} file(s)${values["dry-run"] ? " (dry run, nothing written)" : ` written to ${values.out}`}`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof StampError)) throw error;
    logError(`stamp-version: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
