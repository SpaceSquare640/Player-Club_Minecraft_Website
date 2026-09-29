// Page shell, styles and UI sources: CSP, assets, design tokens, dictionary keys used by the UI,
// the built-in English error text, and the local preview server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/load-data.mjs";
import { SITE_ROOT, contentType, createPreviewServer, resolveRequestPath } from "../../scripts/serve.mjs";
import { FALLBACK_TEXT } from "../../site/js/ui/error-view.js";

const SITE = path.join(REPO_ROOT, "site");
const read = (rel) => readFile(path.join(SITE, rel), "utf8");
const html = await read("index.html");
const cssFiles = ["css/tokens.css", "css/base.css", "css/components.css"];
const css = Object.fromEntries(await Promise.all(cssFiles.map(async (f) => [f, await read(f)])));
const en = JSON.parse(await read("i18n/en.json")).messages;

async function listFiles(dir, ext) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full, ext)));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}
const jsSources = await Promise.all((await listFiles(path.join(SITE, "js"), ".js")).map(async (file) => ({ file, source: await readFile(file, "utf8") })));

test("index.html: CSP meta allows only self, no inline scripts, styles or handlers", () => {
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
  assert.equal(
    csp,
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'",
  );
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type="module" src="js\/app\.js"/);
  assert.equal(scripts[0][2].trim(), "");
  assert.doesNotMatch(html, /<style\b|\sstyle="|\son[a-z]+="/i);
  assert.doesNotMatch(html, /https?:\/\/(?!spacesquare640\.github\.io\/Player-Club_Minecraft_Website\/)/, "no external resources except the canonical page and share image URLs");
});

test("index.html: every external link opens in a new tab with noopener noreferrer; the invite link is not hard-coded", () => {
  for (const match of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) assert.match(match[0], /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /discord\.gg/, "the Discord invite lives only in config.json");
  for (const { file, source } of jsSources) assert.doesNotMatch(source, /discord\.gg/, file);
});

test("index.html: landmarks, live region, lang and the permanent English Minecraft notice", () => {
  assert.match(html, /<html lang="en">/);
  for (const re of [/<header\b/, /<nav\b[^>]*aria-label=/, /<main\b[^>]*id="pc-main"/, /<footer\b/, /id="pc-live"[^>]*aria-live="polite"/, /role="tabpanel"/]) assert.match(html, re);
  assert.match(html, /<span lang="en" data-i18n-en="footer\.minecraftNotice">NOT AN OFFICIAL MINECRAFT PRODUCT\./);
  assert.doesNotMatch(html, /href="#pc-/, "no #id anchors (the hash holds the state)");
});

test("every local asset referenced by HTML, CSS and JS exists", () => {
  const refs = new Set();
  for (const m of html.matchAll(/(?:src|href|srcset)="([^"]+)"/g)) {
    for (const part of m[1].split(",")) {
      const url = part.trim().split(/\s+/)[0];
      if (url && !url.startsWith("#") && !/^https?:/.test(url)) refs.add(url);
    }
  }
  for (const [file, text] of Object.entries(css)) {
    for (const m of text.matchAll(/url\("([^"]+)"\)/g)) refs.add(path.posix.join(path.posix.dirname(file), m[1]));
  }
  for (const { source } of jsSources) for (const m of source.matchAll(/"(assets\/[^"\s,]+)"/g)) refs.add(m[1]);
  assert.ok(refs.size > 10);
  for (const ref of refs) assert.ok(existsSync(path.join(SITE, ref)), ref);
});

test("icons: only the Tabler files listed by the design spec plus the MIT license", async () => {
  const names = (await readdir(path.join(SITE, "assets/icons"))).sort();
  const expected = ["alert-triangle", "arrow-right", "check", "chevron-down", "copy", "dots", "external-link", "lock", "map-pin-off", "pencil", "pin", "plus", "search", "trash", "x"];
  assert.deepEqual(names, ["LICENSE", ...expected.map((n) => `${n}.svg`)].sort());
  const license = await read("assets/icons/LICENSE");
  assert.match(license, /^MIT License/);
  assert.match(license, /Paweł Kuna/);
  for (const name of expected) assert.match(css["css/components.css"], new RegExp(`\\.pc-icon--${name} \\{`));
});

test("CSS: every custom property used is defined in the token file (or base.css)", () => {
  const defined = new Set();
  for (const text of Object.values(css)) for (const m of text.matchAll(/(--pc-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
  for (const [file, text] of Object.entries(css)) {
    for (const m of text.matchAll(/var\((--pc-[a-z0-9-]+)/g)) assert.ok(defined.has(m[1]), `${file}: ${m[1]}`);
  }
  assert.match(css["css/tokens.css"], /^\.pc-app \{/m, "tokens are scoped to .pc-app");
  assert.match(css["css/base.css"], /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css["css/components.css"], /@media \(forced-colors: active\)/);
});

test("CSS: UI Verse adaptations keep their source notes; no text shadows or remote imports", () => {
  const components = css["css/components.css"];
  for (const [author, name] of [["chase2k25", "rare-quail-40"], ["elijahgummer", "kind-pig-24"], ["vinodjangid07", "wonderful-squid-57"]]) {
    assert.match(components, new RegExp(`Adapted from Uiverse\\.io by ${author} \\(${name}\\), MIT License`));
    assert.match(components, new RegExp(`https://uiverse\\.io/${author}/${name}`));
  }
  assert.doesNotMatch(components, /text-shadow|@import|url\(["']?https?:/);
});

test("UI dictionary keys: every literal key used in site/js exists in en", () => {
  const missing = [];
  for (const { file, source } of jsSources) {
    for (const m of source.matchAll(/\b(?:t|textFor|safeText|textLang)\(\s*"([a-z][A-Za-z0-9_.]+)"/g)) {
      if (!Object.hasOwn(en, m[1])) missing.push(`${path.basename(file)}: ${m[1]}`);
    }
    for (const m of source.matchAll(/\bplural\(\s*"([a-z][A-Za-z0-9_.]+)"/g)) {
      if (!Object.hasOwn(en, `${m[1]}.other`)) missing.push(`${path.basename(file)}: ${m[1]}.other`);
    }
  }
  for (const m of html.matchAll(/data-i18n(?:-en)?="([^"]+)"/g)) if (!Object.hasOwn(en, m[1])) missing.push(`index.html: ${m[1]}`);
  for (const m of html.matchAll(/data-i18n-attr="([^"]+)"/g)) {
    for (const pair of m[1].split(";")) if (!Object.hasOwn(en, pair.split(":")[1])) missing.push(`index.html: ${pair}`);
  }
  assert.deepEqual(missing, []);
});

test("error view: the built-in English text matches the English dictionary", () => {
  for (const [key, text] of Object.entries(FALLBACK_TEXT)) assert.equal(text, en[key], key);
});

test("UI sources render user data as text only", () => {
  for (const { file, source } of jsSources) {
    assert.doesNotMatch(source, /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/, file);
  }
});

test("preview server: path resolution stays inside site/", () => {
  const root = SITE_ROOT;
  assert.equal(root, SITE);
  assert.equal(resolveRequestPath("/", root), path.join(root, "index.html"));
  assert.equal(resolveRequestPath("/css/base.css?v=1", root), path.join(root, "css/base.css"));
  assert.equal(resolveRequestPath("/i18n/zh-TW.json", root), path.join(root, "i18n/zh-TW.json"));
  assert.equal(resolveRequestPath("/../package.json", root), path.join(root, "package.json"));
  assert.equal(resolveRequestPath("/%2e%2e/%2e%2e/package.json", root), path.join(root, "package.json"));
  assert.equal(resolveRequestPath("/..%5C..%5Cpackage.json", root), null);
  assert.equal(resolveRequestPath("/%E0%A4%A", root), null);
  assert.equal(resolveRequestPath("/a%00b", root), null);
  assert.equal(contentType("x.webp"), "image/webp");
  assert.equal(contentType("x.JS"), "text/javascript; charset=utf-8");
  assert.equal(contentType("x.bin"), "application/octet-stream");
});

test("preview server: serves files on 127.0.0.1, 404 for missing files, 405 for other methods", async () => {
  const server = createPreviewServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { address, port } = server.address();
  assert.equal(address, "127.0.0.1");
  try {
    const base = `http://127.0.0.1:${port}`;
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type"), /^text\/html/);
    assert.match(await index.text(), /Content-Security-Policy/);
    const js = await fetch(`${base}/js/app.js`);
    assert.equal(js.headers.get("content-type"), "text/javascript; charset=utf-8");
    await js.arrayBuffer();
    const missing = await fetch(`${base}/nope.json`);
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
    const post = await fetch(`${base}/`, { method: "POST" });
    assert.equal(post.status, 405);
    await post.arrayBuffer();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
