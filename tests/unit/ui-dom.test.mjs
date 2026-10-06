// UI modules against the fake DOM of tests/fixtures/fake-dom.mjs (architecture 4.8 items 1, 24, 25, 30):
// the "⋯" menu button, copy buttons and their manual-copy fallback, the pinned world spawn card and the
// seed in the world info panel. Layout (menu flipping), real focus rings and contrast need a browser and
// are left to the manual regression list. The default i18n instance is loaded with the committed English
// dictionary, so expectations use the real interface text.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/load-data.mjs";
import { initI18n, setLang } from "../../site/js/i18n.js";
import { COLORS, DEFAULT_SETTINGS, SYMBOLS, buildCommand } from "../../site/js/lib/commands.js";
import { createCommandsPanel } from "../../site/js/ui/commands-panel.js";
import { createCopyButton, createFallbackHost, writeClipboard } from "../../site/js/ui/copy.js";
import { createTabs } from "../../site/js/ui/dimension-tabs.js";
import { createScope } from "../../site/js/ui/dom.js";
import { initLive } from "../../site/js/ui/live.js";
import { closeOpenMenu, createMenuButton } from "../../site/js/ui/menu.js";
import { renderSpawnCard } from "../../site/js/ui/spawn-card.js";
import { renderWorldInfo } from "../../site/js/ui/world-info.js";
import { createDataset } from "../fixtures/dataset.mjs";
import { installFakeDom } from "../fixtures/fake-dom.mjs";
import { createFakeFetch } from "../fixtures/front.mjs";

const readDict = async (lang) => JSON.parse(await readFile(path.join(REPO_ROOT, "site/i18n", `${lang}.json`), "utf8"));
const en = (await readDict("en")).messages;
const COMMANDS = JSON.parse(await readFile(path.join(REPO_ROOT, "site/data/commands/builder_world.json"), "utf8")).commands;

let dom;
let document;

before(async () => {
  dom = installFakeDom();
  document = dom.document;
  // The default dictionary loader fetches ./i18n/en.json against document.baseURI.
  const savedFetch = globalThis.fetch;
  globalThis.fetch = createFakeFetch({ "i18n/en.json": await readDict("en") }).fetch;
  try {
    assert.equal(await initI18n("en"), "en");
  } finally {
    globalThis.fetch = savedFetch;
  }
});

after(() => dom.restore());

/**
 * Replaces globalThis.navigator (a getter in Node) for fn, then puts the original back. The restore check
 * runs only when fn succeeded, so it never hides the original failure.
 */
async function withNavigator(value, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", { value, configurable: true, writable: true });
  let result;
  try {
    result = await fn();
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    else delete globalThis.navigator;
  }
  assert.equal(globalThis.navigator, original, "navigator restored");
  return result;
}

/** Appends nodes to the page and takes them off again after the test, also when it fails. */
function mount(t, ...nodes) {
  document.body.append(...nodes);
  t.after(() => {
    for (const node of nodes) node.remove();
  });
}

/** Timer scope disposed after the test (clears the 2 s "copied" timers), also when it fails. */
function testScope(t) {
  const scope = createScope();
  t.after(() => scope.dispose());
  return scope;
}

const rejectingClipboard = { clipboard: { writeText: async () => Promise.reject(new Error("NotAllowedError: Document is not focused")) } };
const isInput = (el) => el.tagName === "INPUT";
const byRole = (role) => (el) => el.getAttribute("role") === role;

function menuFixture(t) {
  const selected = [];
  const card = document.createElement("article");
  const anchor = createMenuButton({
    ariaLabel: "More actions: Village 1",
    host: card,
    items: [
      { label: "Request edit", icon: "pencil", onSelect: (trigger) => selected.push(["edit", trigger]) },
      { label: "Request deletion", icon: "trash", danger: true, onSelect: (trigger) => selected.push(["delete", trigger]) },
    ],
  });
  card.append(anchor);
  mount(t, card);
  t.after(closeOpenMenu); // the open menu is module state shared by every test
  const [trigger] = anchor.children;
  const menu = () => anchor.find(byRole("menu"));
  const items = () => anchor.findAll(byRole("menuitem"));
  return { card, anchor, trigger, menu, items, selected };
}

// Menu button (24)

test("menu button: opening renders the items in order and focuses the first one", async (t) => {
  const { card, anchor, trigger, menu, items } = menuFixture(t);
  assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(trigger.getAttribute("aria-label"), "More actions: Village 1");
  assert.equal(menu(), null, "closed menus are not in the DOM");

  await trigger.click();
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(menu().getAttribute("id"), trigger.getAttribute("aria-controls"));
  assert.equal(menu().getAttribute("aria-labelledby"), trigger.getAttribute("id"));
  assert.deepEqual(items().map((b) => b.textContent), ["Request edit", "Request deletion"]);
  assert.deepEqual(items().map((b) => b.getAttribute("tabindex")), ["-1", "-1"]);
  assert.deepEqual(items().map((b) => b.classList.contains("pc-menu__item--danger")), [false, true]);
  assert.equal(document.activeElement, items()[0]);
  assert.ok(card.classList.contains("has-open-menu"), "the card is raised while the menu is open");
  assert.equal(document.listenerCount("pointerdown"), 1);

  // Arrows cycle, Home / End jump (the keydown bubbles from the item to the menu).
  const keys = [];
  for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"]) {
    document.activeElement.dispatch("keydown", { key });
    keys.push(items().indexOf(document.activeElement));
  }
  assert.deepEqual(keys, [1, 0, 1, 1, 0]);
  closeOpenMenu();
  assert.equal(anchor.children.length, 1);
});

test("menu button: Escape closes the menu and returns focus to the button", async (t) => {
  const { card, anchor, trigger, menu, items } = menuFixture(t);
  await trigger.click();
  document.activeElement.dispatch("keydown", { key: "ArrowDown" });
  items()[1].dispatch("keydown", { key: "Escape" });
  assert.equal(menu(), null);
  assert.equal(anchor.children.length, 1);
  assert.equal(document.activeElement, trigger);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(card.classList.contains("has-open-menu"), false);
  assert.equal(document.listenerCount("pointerdown"), 0, "the outside-click listener is removed");

  // ArrowUp on the button opens at the last item; Escape on the button closes it again.
  trigger.dispatch("keydown", { key: "ArrowUp" });
  assert.equal(document.activeElement, items()[1]);
  trigger.dispatch("keydown", { key: "Escape" });
  assert.equal(menu(), null);
  assert.equal(document.activeElement, trigger);
});

test("menu button: closeOpenMenu, a second menu, Tab, outside clicks and selecting an item close it", async (t) => {
  const first = menuFixture(t);
  const second = menuFixture(t);
  closeOpenMenu(); // nothing open: no-op

  await first.trigger.click();
  closeOpenMenu();
  assert.equal(first.menu(), null);
  assert.equal(first.trigger.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, document.body, "closeOpenMenu does not return focus to the button");

  await first.trigger.click();
  await second.trigger.click();
  assert.equal(first.menu(), null, "opening another menu closes the first");
  assert.notEqual(second.menu(), null);
  second.items()[0].dispatch("keydown", { key: "Tab" });
  assert.equal(second.menu(), null, "Tab closes and lets focus move on");

  await first.trigger.click();
  document.pointerDown(first.items()[0]);
  assert.notEqual(first.menu(), null, "a pointerdown inside the menu keeps it open");
  document.pointerDown(document.body);
  assert.equal(first.menu(), null, "a pointerdown outside closes it");

  await first.trigger.click();
  await first.items()[1].click();
  assert.equal(first.menu(), null);
  assert.deepEqual(first.selected, [["delete", first.trigger]], "onSelect receives the trigger to restore focus later");
  await first.trigger.click();
  await first.trigger.click();
  assert.equal(first.menu(), null, "a second click on the button toggles it closed");
});

// Copy (25)

test("writeClipboard reports failure when the Clipboard API is missing, throws or rejects", async () => {
  const written = [];
  const cases = [
    [undefined, false],
    [{}, false],
    [{ clipboard: {} }, false],
    [rejectingClipboard, false],
    [
      {
        clipboard: {
          writeText: () => {
            throw new TypeError("sync failure");
          },
        },
      },
      false,
    ],
    [{ clipboard: { writeText: async (text) => written.push(text) } }, true],
  ];
  for (const [navigator, expected] of cases) {
    await withNavigator(navigator, async () => {
      assert.equal(await writeClipboard("-426 72 300"), expected, JSON.stringify(navigator));
    });
  }
  assert.deepEqual(written, ["-426 72 300"]);
});

test("copy button: when writing fails, the fallback field shows the exact text, focused and selected", async (t) => {
  const seed = "-9223372036854775808";
  for (const navigator of [{}, rejectingClipboard]) {
    await withNavigator(navigator, async () => {
      const scope = testScope(t);
      const host = createFallbackHost();
      const button = createCopyButton({ variant: "icon", value: () => seed, ariaLabel: en["world.seed.copy"], scope, fallbackHost: host });
      mount(t, button, host);
      assert.equal(host.hidden, true);

      await button.click();
      assert.equal(host.hidden, false);
      const input = host.find(isInput);
      assert.equal(input.value, seed);
      assert.equal(input.getAttribute("readonly"), "");
      assert.equal(input.getAttribute("aria-label"), en["copy.fallback"]);
      assert.equal(host.find((el) => el.tagName === "P").textContent, en["copy.fallback"]);
      assert.equal(document.activeElement, input);
      assert.equal(input.selected, true);
      assert.equal(button.dataset.state, "idle", "no success state after a failure");

      input.dispatch("keydown", { key: "Escape" });
      assert.equal(host.hidden, true);
      assert.equal(host.children.length, 0);
      assert.equal(document.activeElement, button, "Esc returns focus to the copy button");
    });
  }
});

test("copy button: the fallback close button returns focus; a later success hides the fallback", async (t) => {
  let fail = true;
  const written = [];
  const navigator = {
    clipboard: {
      writeText: async (text) => {
        if (fail) throw new Error("denied");
        written.push(text);
      },
    },
  };
  await withNavigator(navigator, async () => {
    const scope = testScope(t); // also clears the 2 s reset timer of the successful copy
    const host = createFallbackHost();
    const button = createCopyButton({ variant: "text", value: "-426 72 300", scope, fallbackHost: host });
    mount(t, button, host);
    const label = () => button.find((el) => el.classList.contains("pc-copy__label")).textContent;
    assert.equal(label(), en["card.copy"]);

    await button.click();
    assert.equal(host.find(isInput).value, "-426 72 300");
    await host.find((el) => el.getAttribute("aria-label") === en["dialog.close"]).click();
    assert.equal(host.hidden, true);
    assert.equal(document.activeElement, button);

    await button.click();
    assert.equal(host.hidden, false);
    fail = false;
    await button.click();
    assert.deepEqual(written, ["-426 72 300"]);
    assert.equal(host.hidden, true, "a successful copy hides the fallback");
    assert.equal(button.dataset.state, "copied");
    assert.equal(label(), en["card.copied"]);
  });
});

// Pinned world spawn card (30) and the seed in the world info panel (1)

test("pinned spawn card: coordinates from world.spawn, copy text and a menu with only Request edit", async (t) => {
  const world = createDataset().worlds.worlds[0];
  const scope = testScope(t);
  const opened = [];
  const section = renderSpawnCard(world, "overworld", { scope, onRequestSpawn: (opener) => opened.push(opener) });
  mount(t, section);
  assert.equal(section.getAttribute("aria-label"), en["pin.region"]);
  assert.equal(section.find((el) => el.tagName === "H3").textContent, en["world.spawn"]);
  assert.deepEqual(section.findAll((el) => el.tagName === "DD").map((el) => el.textContent), ["7", "103", "5"]);

  const trigger = section.find((el) => el.getAttribute("aria-haspopup") === "menu");
  assert.equal(trigger.getAttribute("aria-label"), `More actions: ${en["world.spawn"]}`);
  await trigger.click();
  const items = section.findAll(byRole("menuitem"));
  assert.deepEqual(items.map((el) => el.textContent), [en["card.requestEdit"]], "no delete: the spawn cannot be removed");
  assert.equal(section.findAll((el) => el.classList.contains("pc-menu__item--danger") || el.classList.contains("pc-icon--trash")).length, 0);
  await items[0].click();
  assert.deepEqual(opened, [trigger]);
  assert.equal(section.find(byRole("menu")), null);

  await withNavigator({}, async () => {
    await section.find((el) => el.classList.contains("pc-pinned__copy")).click();
    assert.equal(section.find(isInput).value, "7 103 5");
  });
  assert.equal(renderSpawnCard(world, "the_nether", { scope, onRequestSpawn: () => {} }), null);
});

test("world info: int64 seeds are shown and copied exactly as stored", async (t) => {
  for (const seed of ["652938494491123000", "9223372036854775807", "-9223372036854775808"]) {
    const world = { ...createDataset().worlds.worlds[0], seed };
    const panel = renderWorldInfo(world, { scope: testScope(t) });
    mount(t, panel);
    assert.equal(panel.find((el) => el.classList.contains("pc-worldinfo__seed")).textContent, seed);
    await withNavigator({}, async () => {
      await panel.find((el) => el.getAttribute("aria-label") === en["world.seed.copy"]).click();
      assert.equal(panel.find(isInput).value, seed);
    });
  }
});

// Commands panel (architecture 6.6.4, design spec 15)

const SHIELD_DEFAULT =
  '/give @p shield[custom_name=[{text:"###",obfuscated:true,color:"gold",italic:false},{text:" input the name you want ",obfuscated:false,color:"yellow"},{text:"###",obfuscated:true,color:"gold"}],enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1';
const byClass = (name) => (el) => el.classList.contains(name);
const byId = (id) => (el) => el.getAttribute("id") === id;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mounts a commands panel; returns handles, the settings reported to the app and the live region. */
function commandsFixture(t, { settings = { ...DEFAULT_SETTINGS }, ui, commands = COMMANDS } = {}) {
  const live = document.createElement("div");
  mount(t, live);
  initLive(live);
  const reported = [];
  const panel = createCommandsPanel({ commands, settings, ui, scope: testScope(t), onSettingsChange: (raw) => reported.push(raw) });
  mount(t, panel.el);
  const el = panel.el;
  const codes = () => el.findAll((n) => n.tagName === "CODE" && n.classList.contains("pc-cmd__code"));
  const input = el.find(byId("pc-cmd-name"));
  const selects = el.findAll((n) => n.tagName === "SELECT");
  const radios = el.findAll((n) => n.tagName === "INPUT" && n.getAttribute("type") === "radio");
  const notice = el.find(byId("pc-cmd-name-removed"));
  const reset = el.find(byId("pc-cmd-reset"));
  const copies = () => el.findAll(byClass("pc-cmd-row__copy"));
  const type = (value, init = {}) => {
    input.value = value;
    input.dispatch("input", { inputType: "insertText", ...init });
  };
  const choose = (select, value) => {
    select.value = value;
    select.dispatch("change");
  };
  const setMode = (id) => {
    for (const radio of radios) radio.checked = radio.getAttribute("value") === id;
    radios.find((r) => r.getAttribute("value") === id).dispatch("change");
  };
  return { panel, el, codes, input, selects, radios, notice, reset, copies, type, choose, setMode, reported, live };
}

test("commands panel: 16 item cards, 22 commands with the default settings, names in the current language", (t) => {
  const { el, codes, selects, radios } = commandsFixture(t);
  assert.equal(el.findAll((n) => n.tagName === "H3" && n.classList.contains("pc-cmd-card__title")).length, 16);
  assert.equal(codes().length, 22);
  codes().forEach((code, i) => assert.equal(code.textContent, buildCommand(COMMANDS[i], DEFAULT_SETTINGS), COMMANDS[i].id));
  assert.equal(codes()[15].textContent, SHIELD_DEFAULT);
  assert.equal(el.find(byId("pc-cmd-group-diamond_pickaxe_fortune")).textContent, "Diamond Pickaxe");
  assert.equal(el.find(byId("pc-cmd-row-diamond_pickaxe_silk_touch-variant")).textContent, "Silk Touch");
  assert.equal(el.find(byId("pc-cmd-row-shield-variant")), null, "no variant chip for a single command");
  assert.equal(radios.length, 2);
  assert.deepEqual(radios.map((r) => [r.getAttribute("name"), r.getAttribute("value"), r.checked]), [["pc-cmd-mode", "block", true], ["pc-cmd-mode", "chat", false]]);
  assert.equal(selects.length, 3);
  assert.deepEqual(selects[0].children.map((o) => o.getAttribute("value")), [...SYMBOLS]);
  for (const select of selects.slice(1)) {
    assert.deepEqual(select.children.map((o) => o.getAttribute("value")), [...COLORS]);
    assert.equal(select.children[6].textContent, en["commands.colors.gold"]);
  }
  assert.deepEqual(selects.map((s) => s.value), ["###", "gold", "yellow"]);
  assert.equal(el.findAll((n) => n.tagName === "FORM").length, 0, "no form: Enter cannot submit or reload");
  assert.equal(el.find(byId("pc-commands-heading")).getAttribute("tabindex"), "-1");
  for (const label of el.findAll((n) => n.tagName === "LABEL")) assert.ok(el.find(byId(label.getAttribute("for"))), label.textContent);
});

test("commands panel: unsupported characters are removed, written back and announced once; all commands update in place", async (t) => {
  const { codes, input, notice, type, reported, live, el } = commandsFixture(t);
  const before = codes();
  type("Excalibur ★");
  assert.equal(input.value, "Excalibur ");
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, en["commands.name.removed"]);
  assert.equal(input.getAttribute("aria-describedby"), "pc-cmd-name-removed pc-cmd-name-hint");
  await wait(80);
  assert.equal(live.textContent, en["commands.name.removed"]);
  live.textContent = "";
  type("Excalibur ★★");
  await wait(80);
  assert.equal(live.textContent, "", "already shown: no second announcement");
  assert.deepEqual(codes(), before, "cards are not rebuilt");
  assert.equal(el.find(byId("pc-cmd-name")), input, "the input is not rebuilt");
  assert.ok(codes().every((code) => code.textContent.includes('{text:" Excalibur ",obfuscated:false')));
  assert.equal(reported.at(-1).name, "Excalibur ");

  type("Excalibur S");
  assert.equal(notice.hidden, true, "a change without removed characters hides the notice");
  assert.equal(input.getAttribute("aria-describedby"), "pc-cmd-name-hint");
  assert.ok(codes()[0].textContent.includes(" Excalibur S "));
});

test("commands panel: nothing is processed while an IME composes; compositionend processes once", (t) => {
  const { codes, input, notice } = commandsFixture(t);
  input.dispatch("compositionstart");
  input.value = "劍。";
  input.dispatch("input", { isComposing: true, inputType: "insertCompositionText" });
  assert.equal(input.value, "劍。", "not written back during composition");
  assert.equal(codes()[15].textContent, SHIELD_DEFAULT);
  input.dispatch("compositionend");
  assert.equal(input.value, "劍");
  assert.equal(notice.hidden, false);
  assert.ok(codes()[15].textContent.includes('{text:" 劍 ",'));
});

test("commands panel: names are text only; typing past 50 is refused, a paste keeps the first 50", (t) => {
  const { codes, input, type, el } = commandsFixture(t);
  type("<img src=x onerror=alert(1)>");
  assert.equal(el.findAll((n) => n.tagName === "IMG").length, 0);
  assert.ok(codes()[15].textContent.includes('{text:" <img src=x onerror=alert(1)> ",'));
  assert.equal(el.find(byClass("pc-cmd__name")).textContent, "<img src=x onerror=alert(1)>");

  type("a".repeat(50));
  type(`${"a".repeat(50)}b`);
  assert.equal(input.value, "a".repeat(50), "the 51st character is not accepted");
  input.value = "x".repeat(60);
  input.dispatch("input", { inputType: "insertFromPaste" });
  assert.equal(input.value, "x".repeat(50));
  assert.equal(el.find(byClass("pc-cmd-name__count")).textContent, "50 / 50");
});

test("commands panel: chat mode switches to @s, marks the 21 long commands and hides the command block guide", (t) => {
  const { el, codes, setMode, copies } = commandsFixture(t);
  const guide = el.find(byClass("pc-cmd-block"));
  assert.equal(guide.hidden, false);
  assert.ok(el.findAll(byClass("pc-cmd-row__len")).every((n) => n.hidden), "block mode shows no length");
  setMode("chat");
  assert.equal(guide.hidden, true);
  assert.ok(codes().every((code) => code.textContent.startsWith("/give @s ")));
  codes().forEach((code, i) => assert.equal(code.textContent, buildCommand(COMMANDS[i], { ...DEFAULT_SETTINGS, mode: "chat" })));
  const warns = el.findAll(byClass("pc-cmd-row__warn"));
  assert.equal(warns.length, 21);
  assert.ok(!warns.some((n) => n.getAttribute("id") === "pc-cmd-row-shield-len"));
  assert.equal(el.find(byId("pc-cmd-row-shield-len")).textContent, "252 / 256 characters");
  assert.match(el.find(byId("pc-cmd-row-diamond_sword-len")).textContent, /^Too long for chat \(352 \/ 256 characters\)/);
  assert.equal(copies()[0].getAttribute("aria-describedby"), "pc-cmd-group-diamond_sword pc-cmd-row-diamond_sword-len");
  assert.equal(copies()[4].getAttribute("aria-describedby"), "pc-cmd-group-trident_channeling pc-cmd-row-trident_riptide-variant pc-cmd-row-trident_riptide-len");
  setMode("block");
  assert.equal(copies()[4].getAttribute("aria-describedby"), "pc-cmd-group-trident_channeling pc-cmd-row-trident_riptide-variant");
});

test("commands panel: control values outside the whitelists fall back to the defaults", (t) => {
  const { codes, selects, choose, radios } = commandsFixture(t);
  choose(selects[0], "<b>");
  choose(selects[1], "#ffffff");
  choose(selects[2], 'gold"');
  radios[1].setAttribute("value", "@a");
  radios[1].checked = true;
  radios[0].checked = false;
  radios[1].dispatch("change");
  assert.equal(codes()[15].textContent, SHIELD_DEFAULT);
  assert.deepEqual(selects.map((s) => s.value), ["###", "gold", "yellow"]);
});

test("commands panel: reset restores the five defaults, keeps focus on the button and announces once", async (t) => {
  const { codes, selects, choose, setMode, type, reset, input, notice, radios, live, reported } = commandsFixture(t);
  setMode("chat");
  type("Excalibur ★");
  choose(selects[0], "***");
  choose(selects[1], "red");
  choose(selects[2], "aqua");
  assert.equal(
    codes()[15].textContent,
    '/give @s shield[custom_name=[{text:"***",obfuscated:true,color:"red",italic:false},{text:" Excalibur ",obfuscated:false,color:"aqua"},{text:"***",obfuscated:true,color:"red"}],enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1',
  );
  reset.focus();
  await reset.click();
  assert.equal(codes()[15].textContent, SHIELD_DEFAULT);
  assert.deepEqual([radios[0].checked, input.value, ...selects.map((s) => s.value)], [true, "", "###", "gold", "yellow"]);
  assert.equal(notice.hidden, true);
  assert.equal(document.activeElement, reset);
  assert.deepEqual(reported.at(-1), { mode: "block", name: "", symbols: "###", symbolColor: "gold", nameColor: "yellow" });
  await wait(80);
  assert.equal(live.textContent, en["commands.reset.live"]);
});

test("commands panel: copy buttons copy the current command; failure shows the same text; settings close the fallback", async (t) => {
  const { el, copies, type } = commandsFixture(t);
  const shieldCopy = copies()[15];
  assert.equal(shieldCopy.textContent, en["commands.copy"]);
  assert.equal(shieldCopy.getAttribute("aria-label"), null, "the visible text is the name");
  assert.equal(shieldCopy.getAttribute("aria-describedby"), "pc-cmd-group-shield");
  const written = [];
  await withNavigator({ clipboard: { writeText: async (text) => written.push(text) } }, () => shieldCopy.click());
  assert.deepEqual(written, [SHIELD_DEFAULT]);

  await withNavigator({}, () => shieldCopy.click());
  const fallback = el.find(byId("pc-cmd-row-shield")).find(byClass("pc-copy-fallback-host"));
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.find(isInput).value, SHIELD_DEFAULT);
  type("Ex");
  assert.equal(fallback.hidden, true, "a settings change closes the stale fallback field");
});

test("commands panel: the notice and the guide state survive a rebuild; dark colours add the preview note", (t) => {
  const ui = { blockOpen: false, notice: true };
  const { el, notice, choose, selects } = commandsFixture(t, { settings: { mode: "chat", name: "Ex ", symbols: "X", symbolColor: "red", nameColor: "aqua" }, ui });
  assert.equal(notice.hidden, false);
  assert.equal(el.find(byClass("pc-cmd-block")).open, false);
  assert.equal(el.find(byId("pc-cmd-name")).value, "Ex ");
  const segs = el.findAll(byClass("pc-cmd-preview__seg"));
  assert.deepEqual(segs.map((s) => s.textContent), ["X", " Ex ", "X"]);
  const darkNote = el.find(byClass("pc-cmd-preview")).children.at(-1);
  assert.equal(darkNote.hidden, true);
  choose(selects[2], "dark_blue");
  assert.equal(darkNote.hidden, false);
  assert.ok(segs[1].classList.contains("is-on-light") && segs[1].classList.contains("pc-mc--dark_blue"));
});

test("commands panel: invalid entries are skipped; no valid entry shows the empty text; the tab has no badge", (t) => {
  const { codes } = commandsFixture(t, { commands: [{ ...COMMANDS[15], item: "minecraft:shield" }, COMMANDS[0]] });
  assert.equal(codes().length, 1);
  const empty = createCommandsPanel({ commands: [], settings: DEFAULT_SETTINGS, scope: testScope(t), onSettingsChange: () => {} });
  assert.equal(empty.el.find(byClass("pc-cmd-empty")).textContent, en["commands.empty"]);

  const tabs = createTabs({ idPrefix: "pc-dim-tab", panelId: "pc-tabpanel", onSelect: () => {} });
  tabs.update([{ id: "overworld", label: "Overworld", shortLabel: "Overworld", count: 3 }, { id: "commands", label: en["commands.tab"], shortLabel: en["commands.tab.short"], count: null }], "commands", en["commands.tablist"]);
  const button = tabs.el.find(byId("pc-dim-tab-commands"));
  assert.equal(button.getAttribute("aria-selected"), "true");
  assert.equal(button.find(byClass("pc-tab__count")), null);
  assert.ok(button.find(byClass("pc-tab__name--short")), "short label for the stacked layout");
});

test("commands panel: item, variant and colour names follow the current language", async (t) => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = createFakeFetch({ "i18n/zh-TW.json": await readDict("zh-TW") }).fetch;
  try {
    await setLang("zh-TW");
  } finally {
    globalThis.fetch = savedFetch;
  }
  t.after(() => setLang("en"));
  const { el, selects } = commandsFixture(t);
  assert.equal(el.find(byId("pc-cmd-group-diamond_pickaxe_fortune")).textContent, "鑽石鎬");
  assert.equal(el.find(byId("pc-cmd-row-diamond_pickaxe_silk_touch-variant")).textContent, "精準採集");
  assert.equal(selects[1].children[6].textContent, "金色");
});
