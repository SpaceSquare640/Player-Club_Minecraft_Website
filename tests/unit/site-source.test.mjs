// Source scans of site/js enforcing the front-end rules of the architecture (4.1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/load-data.mjs";

const SITE_JS = path.join(REPO_ROOT, "site/js");

async function listJs(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listJs(full)));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

// Removes comments and string / template literal contents so that scans only see code.
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
}

const files = await listJs(SITE_JS);
const sources = await Promise.all(files.map(async (file) => ({ file: path.relative(REPO_ROOT, file).replaceAll("\\", "/"), source: await readFile(file, "utf8") })));

test("site/js contains the M2 modules", () => {
  const names = sources.map((s) => s.file);
  for (const expected of ["site/js/i18n.js", "site/js/state.js", "site/js/data/repository.js", "site/js/lib/hash.js", "site/js/lib/filter.js", "site/js/lib/text.js", "site/js/lib/coords.js", "site/js/lib/commands.js"]) {
    assert.ok(names.includes(expected), expected);
  }
});

test("no innerHTML, insertAdjacentHTML, document.write, eval or new Function", () => {
  for (const { file, source } of sources) {
    const code = codeOnly(source);
    assert.doesNotMatch(code, /\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|document\.write|\beval\s*\(|\bnew\s+Function\b/, file);
  }
});

test("imports are static, relative and end with .js", () => {
  for (const { file, source } of sources) {
    assert.doesNotMatch(source, /\bimport\s*\(/, `${file}: no dynamic import`);
    for (const match of source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+(["'])([^"']+)\1/gm)) {
      assert.match(match[2], /^\.\.?\/.*\.js$/, `${file}: ${match[2]}`);
    }
  }
});

test("site/js/lib uses no DOM or browser globals", () => {
  const forbidden = /\b(?:window|document|globalThis|localStorage|sessionStorage|navigator|location|history|fetch|XMLHttpRequest|alert|console)\b/;
  for (const { file, source } of sources.filter((s) => s.file.startsWith("site/js/lib/"))) {
    assert.doesNotMatch(codeOnly(source), forbidden, file);
  }
});

test("only the repository (data) and i18n (dictionaries) fetch; other modules go through them", () => {
  for (const { file, source } of sources) {
    if (file === "site/js/data/repository.js" || file === "site/js/i18n.js") continue;
    assert.doesNotMatch(codeOnly(source), /\bfetch\s*\(/, file);
  }
});

test("seed is never converted to a number", () => {
  for (const { file, source } of sources) {
    assert.doesNotMatch(source, /(?:Number|parseInt|parseFloat|BigInt)\s*\([^)]*seed|\+\s*[\w.]*\.seed\b/, file);
  }
});

test("localStorage stores only pcmw.lang and every access is inside try", () => {
  for (const { file, source } of sources) {
    const keys = [...source.matchAll(/STORAGE_KEY\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    for (const key of keys) assert.equal(key, "pcmw.lang", file);
    assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem|removeItem)/, `${file}: storage goes through guarded helpers`);
  }
});
