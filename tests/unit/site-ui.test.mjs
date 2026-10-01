// Page shell, styles and UI sources: CSP, assets, design tokens and their contrast, dictionary keys used
// by the UI, the Discord link label, reduced motion, the built-in English error text, and the local
// preview server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/load-data.mjs";
import { SITE_ROOT, contentType, createPreviewServer, resolveRequestPath } from "../../scripts/serve.mjs";
import { prefersReducedMotion } from "../../site/js/ui/dom.js";
import { FALLBACK_TEXT } from "../../site/js/ui/error-view.js";

const SITE = path.join(REPO_ROOT, "site");
const read = (rel) => readFile(path.join(SITE, rel), "utf8");
const html = await read("index.html");
const cssFiles = ["css/tokens.css", "css/base.css", "css/components.css"];
const css = Object.fromEntries(await Promise.all(cssFiles.map(async (f) => [f, await read(f)])));
const en = JSON.parse(await read("i18n/en.json")).messages;
const zh = JSON.parse(await read("i18n/zh-TW.json")).messages;

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
  assert.match(scripts[0][1], /type="module" src="js\/app\.js\?v=__ASSET_VERSION__"/);
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
      // The asset version query (?v=__ASSET_VERSION__, stamped at deploy) is not part of the file path.
      const url = part.trim().split(/\s+/)[0].split("?")[0];
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

// WCAG 2.2 contrast of the token colours (design spec 3.2). Translucent tokens are composited over
// --pc-color-bg first, as they are painted on the page background.
function tokenColors(text) {
  const colors = new Map();
  for (const m of text.matchAll(/(--pc-[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6}|rgba\([^)]*\))\s*;/gi)) {
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(m[2]);
    const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(m[2]);
    assert.ok(hex || rgba, `${m[1]}: ${m[2]}`);
    const [r, g, b] = hex ? hex.slice(1).map((v) => parseInt(v, 16)) : rgba.slice(1, 4).map(Number);
    colors.set(m[1].slice("--pc-".length), { r, g, b, a: hex ? 1 : Number(rgba[4]) });
  }
  return colors;
}
const composite = (fg, bg) => ({ ...Object.fromEntries(["r", "g", "b"].map((c) => [c, fg[c] * fg.a + bg[c] * (1 - fg.a)])), a: 1 });
const linear = (c) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ({ r, g, b }) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("CSS: token colour pairs of the design contrast table meet WCAG AA", () => {
  const colors = tokenColors(css["css/tokens.css"]);
  const bg = colors.get("color-bg");
  assert.equal(bg.a, 1, "the page background is opaque");
  const color = (name) => {
    assert.ok(colors.has(name), name);
    const value = colors.get(name);
    return value.a < 1 ? composite(value, bg) : value;
  };
  const TEXT = 4.5;
  const NON_TEXT = 3;
  const pairs = [
    ["color-text", "color-bg", TEXT],
    ["color-text", "color-surface", TEXT],
    ["color-text", "color-surface-raised", TEXT],
    ["color-text", "tint-secondary", TEXT],
    ["color-text-muted", "color-bg", TEXT],
    ["color-text-muted", "color-surface", TEXT],
    ["color-text-muted", "color-surface-raised", TEXT],
    ["color-primary", "color-bg", TEXT],
    ["color-primary", "color-surface", TEXT],
    ["color-primary-active", "color-bg", TEXT], // text button while pressed
    ["color-primary-active", "color-surface", TEXT],
    ["color-secondary", "color-bg", TEXT],
    ["color-secondary", "color-surface", TEXT],
    ["color-secondary", "tint-secondary", TEXT],
    ["color-secondary-hover", "color-bg", TEXT], // community link / button on hover
    ["color-secondary-hover", "color-surface", TEXT],
    ["color-secondary-hover", "tint-secondary", TEXT],
    ["color-success", "color-bg", TEXT],
    ["color-success", "color-surface", TEXT],
    ["color-danger", "color-bg", TEXT],
    ["color-danger", "color-surface", TEXT],
    ["color-text-on-accent", "color-primary", TEXT],
    ["color-text-on-accent", "color-primary-hover", TEXT],
    ["color-text-on-accent", "color-primary-active", TEXT],
    ["color-border-strong", "color-bg", NON_TEXT],
    ["color-border-strong", "color-surface", NON_TEXT],
    ["color-focus", "color-bg", NON_TEXT], // focus outline
    ["color-focus", "color-surface", NON_TEXT],
  ];
  // Every token the CSS uses as a text colour has a pair above (disabled controls are exempt), so a new
  // text colour such as primary-hover cannot slip in unchecked.
  const textPairs = new Set(pairs.filter(([, , min]) => min === TEXT).map(([fg]) => fg));
  const unchecked = new Set();
  for (const text of Object.values(css)) {
    for (const m of text.matchAll(/(?:^|[^-\w])color\s*:\s*var\(--pc-(color-[a-z0-9-]+)\)/g)) {
      if (m[1] !== "color-text-disabled" && !textPairs.has(m[1])) unchecked.add(m[1]);
    }
  }
  assert.deepEqual([...unchecked], [], "text colours without a contrast pair");
  const failing = [];
  for (const [fg, back, min] of pairs) {
    const ratio = contrast(color(fg), color(back));
    if (ratio < min) failing.push(`${fg} on ${back}: ${ratio.toFixed(2)}:1 < ${min}:1`);
  }
  assert.deepEqual(failing, []);
  // Spot values from the table (rounded to one decimal).
  assert.equal(contrast(color("color-text"), color("color-bg")).toFixed(1), "17.5");
  assert.equal(contrast(color("color-secondary"), color("tint-secondary")).toFixed(1), "5.4");
  // Light text on solid purple is 2.8:1, so the spec never paints the secondary colour as a background.
  assert.ok(contrast(color("color-text"), color("color-secondary")) < TEXT);
  for (const [file, text] of Object.entries(css)) assert.doesNotMatch(text, /background(?:-color)?\s*:\s*var\(--pc-color-secondary(?:-hover)?\)/, file);
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

test("Discord links: accessible names come from dictionary keys present in en and zh-TW, applied by app.js", () => {
  const header = /<a\b[^>]*\bid="pc-discord"[^>]*>/.exec(html)?.[0];
  assert.ok(header, "header Discord link");
  const ariaKey = /data-i18n-attr="aria-label:([^"]+)"/.exec(header)?.[1];
  assert.equal(ariaKey, "discord.aria");
  const footer = /<a\b[^>]*\bid="pc-footer-discord"[^>]*>\s*<img\b[^>]*>/.exec(html)?.[0];
  assert.ok(footer, "footer badge link");
  const altKey = /data-i18n-attr="alt:([^"]+)"/.exec(footer)?.[1];
  assert.equal(altKey, "footer.badgeAlt");
  for (const key of [ariaKey, altKey]) {
    for (const [lang, dict] of [["en", en], ["zh-TW", zh]]) {
      assert.equal(typeof dict[key], "string", `${lang} ${key}`);
      assert.notEqual(dict[key].trim(), "", `${lang} ${key}`);
    }
  }
  assert.match(en[ariaKey], /Discord.*\(opens in a new tab\)$/);
  assert.match(zh[ariaKey], /Discord.*（在新分頁開啟）$/);
  // app.js (not importable in Node) walks every [data-i18n-attr] element, splits "attr:key" pairs and sets
  // each attribute from t(); the patterns tolerate formatting and naming changes.
  const app = jsSources.find(({ file }) => file.endsWith(path.join("js", "app.js"))).source;
  assert.match(app, /querySelectorAll\(\s*(["'`])\[data-i18n-attr\]\1\s*\)[\s\S]*?\.split\(\s*(["'`]);\2\s*\)[\s\S]*?\.setAttribute\([^;]*?\bt\(/);
  for (const id of ["pc-discord", "pc-footer-discord"]) assert.match(app, new RegExp(`(["'\`])${id}\\1`), id);
});

test("prefersReducedMotion follows matchMedia and is false when matchMedia is missing", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  const original = globalThis.matchMedia;
  const queries = [];
  try {
    for (const matches of [true, false]) {
      globalThis.matchMedia = (query) => {
        queries.push(query);
        return { matches, media: query };
      };
      assert.equal(prefersReducedMotion(), matches);
    }
    delete globalThis.matchMedia;
    assert.equal(prefersReducedMotion(), false);
  } finally {
    if (saved) Object.defineProperty(globalThis, "matchMedia", saved);
    else delete globalThis.matchMedia;
  }
  assert.deepEqual(queries, ["(prefers-reduced-motion: reduce)", "(prefers-reduced-motion: reduce)"]);
  assert.equal(globalThis.matchMedia, original, "matchMedia restored");
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
