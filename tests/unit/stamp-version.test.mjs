// Asset version stamping (scripts/stamp-version.mjs). Everything runs in memory; nothing is written to disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/load-data.mjs";
import { PLACEHOLDER, StampError, fsIo, resolveOutDir, run, stampModule, stampSite, versionFromSha } from "../../scripts/stamp-version.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const V = "0123456789ab";
const siteFiles = await fsIo.readTree(path.join(REPO_ROOT, "site"));

/** In-memory io for run(): the site tree comes from the real site/, writes are recorded. */
function memoryIo({ existing = [] } = {}) {
  const written = new Map();
  return {
    written,
    exists: (p) => existing.includes(p),
    readTree: async () => new Map(siteFiles),
    write: async (p, content) => written.set(p, content),
  };
}

test("the version is the first 12 hex digits of a full commit SHA", () => {
  assert.equal(versionFromSha(SHA), V);
  assert.equal(versionFromSha(` ${SHA.toUpperCase()}\n`), V);
  assert.equal(versionFromSha("a".repeat(64)), "a".repeat(12));
  for (const bad of [undefined, null, "", "0123456789ab", "g".repeat(40), `${SHA}0`, "HEAD"]) {
    assert.throws(() => versionFromSha(bad), StampError, String(bad));
  }
});

test("index.html references CSS and the entry module with the placeholder", async () => {
  const html = await readFile(path.join(REPO_ROOT, "site/index.html"), "utf8");
  for (const name of ["css/tokens.css", "css/base.css", "css/components.css", "js/app.js"]) {
    assert.ok(html.includes(`"${name}?v=${PLACEHOLDER}"`), name);
  }
});

test("static relative imports and export-from statements get ?v=", () => {
  const source = [
    '// import { nope } from "./comment.js";',
    'import { a } from "./a.js";',
    "import b from '../b.js';",
    'import * as c from "./lib/c.js";',
    'import "./side-effect.js";',
    "import {",
    "  d,",
    "  e,",
    '} from "./multi.js";',
    'export { f } from "./f.js";',
    'export * from "./g.js";',
    'export * as h from "./h.js";',
    "export const text = 'import x from \"./not-an-import.js\"';",
    'const label = "from";',
    "export function load() { return import.meta.url; }",
  ].join("\n");
  const { text, imports } = stampModule(source, V);
  assert.equal(imports, 8);
  for (const spec of ["./a.js", "../b.js", "./lib/c.js", "./side-effect.js", "./multi.js", "./f.js", "./g.js", "./h.js"]) {
    assert.ok(text.includes(`${spec}?v=${V}`), spec);
  }
  assert.ok(text.includes('// import { nope } from "./comment.js";'), "comments are untouched");
  assert.ok(text.includes('"./not-an-import.js"'), "strings are untouched");
});

test("import forms that cannot be stamped fail", () => {
  const cases = [
    ['const m = await import("./a.js");', /dynamic import/],
    ['import x from "lib";', /must be relative/],
    ['import x from "https://example.com/x.js";', /must be relative/],
    ['import data from "./data.json";', /must be relative and end with \.js/],
    ['import x from "./x.js?v=1";', /must be relative/],
    ["import x from `./x.js`;", /cannot be stamped/],
    ['foo(); import x from "./x.js";', /cannot be stamped/],
  ];
  for (const [source, error] of cases) assert.throws(() => stampModule(source, V, "m.js"), error, source);
});

test("the real site is stamped: every module import and every placeholder", () => {
  const { files, stats } = stampSite(siteFiles, V);
  assert.equal(files.size, siteFiles.size);
  assert.equal(stats.placeholders, 4);
  assert.ok(stats.modules >= 20 && stats.imports >= 50, JSON.stringify(stats));
  const html = files.get("index.html");
  assert.ok(html.includes(`src="js/app.js?v=${V}"`));
  assert.ok(!html.includes(PLACEHOLDER));
  for (const [rel, content] of files) {
    if (!rel.startsWith("js/") || !rel.endsWith(".js")) continue;
    for (const m of content.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gm)) assert.ok(m[1].endsWith(`.js?v=${V}`), `${rel}: ${m[1]}`);
  }
  // Binary files are copied unchanged.
  assert.equal(files.get("assets/img/favicon-32.png"), siteFiles.get("assets/img/favicon-32.png"));
});

test("a missing placeholder in index.html or a placeholder left elsewhere fails", () => {
  const without = new Map(siteFiles);
  without.set("index.html", Buffer.from("<!doctype html><script type=module src=js/app.js></script>"));
  assert.throws(() => stampSite(without, V), /no __ASSET_VERSION__ placeholder/);

  const leftover = new Map(siteFiles);
  leftover.set("css/extra.css", Buffer.from(`a { background: url("x.png?v=${PLACEHOLDER}"); }`));
  assert.throws(() => stampSite(leftover, V), /css\/extra\.css still contains/);

  const noIndex = new Map(siteFiles);
  noIndex.delete("index.html");
  assert.throws(() => stampSite(noIndex, V), /index\.html is missing/);
  assert.throws(() => stampSite(siteFiles, "XYZ"), /12 lowercase hex digits/);
});

test("the output directory stays inside the repository and outside site/", () => {
  const root = path.resolve("/repo");
  assert.equal(resolveOutDir(root, "_site"), path.join(root, "_site"));
  for (const bad of [".", "..", "../_site", "site", "site/out", ".git/x", path.resolve("/elsewhere")]) {
    assert.throws(() => resolveOutDir(root, bad), StampError, bad);
  }
});

test("run: writes the stamped copy, refuses an existing output directory, dry run writes nothing", async () => {
  const logs = [];
  const errors = [];
  const io = memoryIo();
  assert.equal(await run({ argv: ["--out", "_site"], root: REPO_ROOT, io, headSha: SHA, log: (m) => logs.push(m), logError: (m) => errors.push(m) }), 0);
  assert.equal(io.written.size, siteFiles.size);
  assert.ok(io.written.get(path.join(REPO_ROOT, "_site", "index.html")).includes(`?v=${V}`));
  assert.match(logs[0], /^Asset version 0123456789ab: 4 placeholder\(s\)/);

  const existing = memoryIo({ existing: [path.join(REPO_ROOT, "_site")] });
  assert.equal(await run({ argv: [], root: REPO_ROOT, io: existing, headSha: SHA, log: () => {}, logError: (m) => errors.push(m) }), 1);
  assert.equal(existing.written.size, 0);
  assert.match(errors.at(-1), /_site already exists; remove it before stamping/);

  const dry = memoryIo({ existing: [path.join(REPO_ROOT, "_site")] });
  assert.equal(await run({ argv: ["--dry-run", "--version", SHA], root: REPO_ROOT, io: dry, log: () => {}, logError: (m) => errors.push(m) }), 0);
  assert.equal(dry.written.size, 0);

  assert.equal(await run({ argv: ["--version", "main"], root: REPO_ROOT, io: memoryIo(), log: () => {}, logError: (m) => errors.push(m) }), 1);
  assert.match(errors.at(-1), /full commit SHA/);
});
