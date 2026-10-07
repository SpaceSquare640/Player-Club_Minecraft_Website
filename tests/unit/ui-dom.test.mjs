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
import { DEFAULT_SETTINGS, buildCommand } from "../../site/js/lib/commands.js";
import { createCommandsPanel } from "../../site/js/ui/commands-panel.js";
import { createCopyButton, createFallbackHost, writeClipboard } from "../../site/js/ui/copy.js";
import { createTabs } from "../../site/js/ui/dimension-tabs.js";
import { createToolbar } from "../../site/js/ui/filters.js";
import { createScope } from "../../site/js/ui/dom.js";
import { initLive } from "../../site/js/ui/live.js";
import { closeOpenMenu, createMenuButton } from "../../site/js/ui/menu.js";
import { renderSpawnCard } from "../../site/js/ui/spawn-card.js";
import { renderWorldInfo } from "../../site/js/ui/world-info.js";
import { createDataset } from "../fixtures/dataset.mjs";
import { FakeElement, installFakeDom } from "../fixtures/fake-dom.mjs";
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

const SHIELD_DEFAULT = '/give @s shield[custom_name={text:"input the name you want",obfuscated:false},enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1';
const NAME_DESCRIBED_BY = "pc-cmd-name-hint pc-cmd-name-obfuscated";
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
  const radios = el.findAll((n) => n.tagName === "INPUT" && n.getAttribute("type") === "radio");
  const notice = el.find(byId("pc-cmd-name-removed"));
  const reset = el.find(byId("pc-cmd-reset"));
  const copies = () => el.findAll(byClass("pc-cmd-row__copy"));
  const type = (value, init = {}) => {
    input.value = value;
    input.dispatch("input", { inputType: "insertText", ...init });
  };
  const setMode = (id) => {
    for (const radio of radios) radio.checked = radio.getAttribute("value") === id;
    radios.find((r) => r.getAttribute("value") === id).dispatch("change");
  };
  return { panel, el, codes, input, radios, notice, reset, copies, type, setMode, reported, live };
}

test("commands panel: 16 item cards, 22 commands with the default settings, names in the current language", (t) => {
  const { el, codes, radios, input } = commandsFixture(t);
  assert.equal(el.findAll((n) => n.tagName === "H3" && n.classList.contains("pc-cmd-card__title")).length, 16);
  assert.equal(codes().length, 22);
  codes().forEach((code, i) => assert.equal(code.textContent, buildCommand(COMMANDS[i], DEFAULT_SETTINGS), COMMANDS[i].id));
  assert.equal(codes()[15].textContent, SHIELD_DEFAULT);
  assert.ok(codes()[1].textContent.endsWith("vanishing_curse:1}]"), "the bow command has no count");
  assert.equal(el.find(byId("pc-cmd-group-diamond_pickaxe_fortune")).textContent, "Diamond Pickaxe");
  assert.equal(el.find(byId("pc-cmd-row-diamond_pickaxe_silk_touch-variant")).textContent, "Silk Touch");
  assert.equal(el.find(byId("pc-cmd-row-shield-variant")), null, "no variant chip for a single command");
  assert.equal(radios.length, 2);
  assert.deepEqual(radios.map((r) => [r.getAttribute("name"), r.getAttribute("value"), r.checked]), [["pc-cmd-mode", "block", false], ["pc-cmd-mode", "chat", true]]);
  assert.equal(el.findAll((n) => n.tagName === "SELECT").length, 0, "no symbol or colour settings");
  assert.equal(el.find(byClass("pc-cmd-preview")), null, "no preview");
  const hint = el.find(byId("pc-cmd-name-obfuscated"));
  assert.equal(hint.textContent, en["commands.name.obfuscated"]);
  assert.equal(input.getAttribute("aria-describedby"), NAME_DESCRIBED_BY);
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
  assert.equal(input.getAttribute("aria-describedby"), `pc-cmd-name-removed ${NAME_DESCRIBED_BY}`);
  await wait(80);
  assert.equal(live.textContent, en["commands.name.removed"]);
  live.textContent = "";
  type("Excalibur ★★");
  await wait(80);
  assert.equal(live.textContent, "", "already shown: no second announcement");
  assert.deepEqual(codes(), before, "cards are not rebuilt");
  assert.equal(el.find(byId("pc-cmd-name")), input, "the input is not rebuilt");
  assert.ok(codes().every((code) => code.textContent.includes('custom_name={text:"Excalibur",obfuscated:false}')));
  assert.equal(reported.at(-1).name, "Excalibur ");

  type("Excalibur S");
  assert.equal(notice.hidden, true, "a change without removed characters hides the notice");
  assert.equal(input.getAttribute("aria-describedby"), NAME_DESCRIBED_BY);
  assert.ok(codes()[0].textContent.includes('{text:"Excalibur S",'));
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
  assert.ok(codes()[15].textContent.includes('{text:"劍",'));
});

test("commands panel: names are text only; typing past 50 is refused, a paste keeps the first 50", (t) => {
  const { codes, input, type, el } = commandsFixture(t);
  type("<img src=x onerror=alert(1)>");
  assert.equal(el.findAll((n) => n.tagName === "IMG").length, 0);
  assert.ok(codes()[15].textContent.includes('{text:"<img src=x onerror=alert(1)>",'));
  assert.equal(codes()[15].findAll((n) => n.tagName === "SPAN").length, 0, "the command is plain text with line break hints");

  type("a".repeat(50));
  type(`${"a".repeat(50)}b`);
  assert.equal(input.value, "a".repeat(50), "the 51st character is not accepted");
  input.value = "x".repeat(60);
  input.dispatch("input", { inputType: "insertFromPaste" });
  assert.equal(input.value, "x".repeat(50));
  assert.equal(el.find(byClass("pc-cmd-name__count")).textContent, "50 / 50");
});

test("commands panel: chat by default marks the 3 long commands; command block mode switches to @p and shows the guide", (t) => {
  const { el, codes, setMode, copies } = commandsFixture(t);
  const guide = el.find(byClass("pc-cmd-block"));
  assert.equal(guide.hidden, true);
  assert.ok(codes().every((code) => code.textContent.startsWith("/give @s ")));
  const warns = el.findAll(byClass("pc-cmd-row__warn"));
  assert.deepEqual(warns.map((n) => n.getAttribute("id")), ["pc-cmd-row-diamond_helmet-len", "pc-cmd-row-diamond_boots_depth_strider-len", "pc-cmd-row-diamond_boots_frost_walker-len"]);
  assert.equal(el.find(byId("pc-cmd-row-shield-len")).textContent, "136 / 256 characters");
  assert.match(el.find(byId("pc-cmd-row-diamond_helmet-len")).textContent, /^Too long for chat \(257 \/ 256 characters\)/);
  assert.match(el.find(byId("pc-cmd-row-diamond_boots_depth_strider-len")).textContent, /^Too long for chat \(273 \/ 256 characters\)/);
  assert.match(el.find(byId("pc-cmd-row-diamond_boots_frost_walker-len")).textContent, /^Too long for chat \(272 \/ 256 characters\)/);
  assert.equal(copies()[0].getAttribute("aria-describedby"), "pc-cmd-group-diamond_sword pc-cmd-row-diamond_sword-len");
  assert.equal(copies()[4].getAttribute("aria-describedby"), "pc-cmd-group-trident_channeling pc-cmd-row-trident_riptide-variant pc-cmd-row-trident_riptide-len");

  setMode("block");
  assert.equal(guide.hidden, false);
  assert.ok(el.findAll(byClass("pc-cmd-row__len")).every((n) => n.hidden), "block mode shows no length");
  codes().forEach((code, i) => assert.equal(code.textContent, buildCommand(COMMANDS[i], { ...DEFAULT_SETTINGS, mode: "block" })));
  assert.ok(codes().every((code) => code.textContent.startsWith("/give @p ")));
  assert.equal(copies()[4].getAttribute("aria-describedby"), "pc-cmd-group-trident_channeling pc-cmd-row-trident_riptide-variant");
});

test("commands panel: a mode value outside the whitelist falls back to chat", (t) => {
  const { codes, radios } = commandsFixture(t, { settings: { mode: "block", name: "" } });
  radios[0].setAttribute("value", "@a");
  radios[0].checked = true;
  radios[1].checked = false;
  radios[0].dispatch("change");
  assert.equal(codes()[15].textContent, SHIELD_DEFAULT);
  assert.equal(radios[1].checked, true);
});

test("commands panel: reset restores the two defaults, keeps focus on the button and announces once", async (t) => {
  const { codes, setMode, type, reset, input, notice, radios, live, reported } = commandsFixture(t);
  setMode("block");
  type("Excalibur ★");
  assert.equal(codes()[15].textContent, '/give @p shield[custom_name={text:"Excalibur",obfuscated:false},enchantments={unbreaking:3,mending:1,vanishing_curse:1}] 1');
  reset.focus();
  await reset.click();
  assert.equal(codes()[15].textContent, SHIELD_DEFAULT);
  assert.deepEqual([radios[0].checked, radios[1].checked, input.value], [false, true, ""]);
  assert.equal(notice.hidden, true);
  assert.equal(document.activeElement, reset);
  assert.deepEqual(reported.at(-1), { mode: "chat", name: "" });
  await wait(80);
  assert.equal(live.textContent, en["commands.reset.live"]);
});

test("commands panel: copy buttons copy the current command; failure shows the same text; settings close the fallback", async (t) => {
  const { el, copies, type } = commandsFixture(t);
  const shieldCopy = copies()[15];
  assert.equal(shieldCopy.textContent, en["commands.copy"]);
  assert.equal(shieldCopy.getAttribute("aria-label"), null, "the visible text is the name");
  assert.equal(shieldCopy.getAttribute("aria-describedby"), "pc-cmd-group-shield pc-cmd-row-shield-len");
  const written = [];
  await withNavigator({ clipboard: { writeText: async (text) => written.push(text) } }, () => shieldCopy.click());
  assert.deepEqual(written, [SHIELD_DEFAULT]);
  assert.ok(written[0].includes("obfuscated:false"), "the copied command keeps obfuscated:false");

  await withNavigator({}, () => shieldCopy.click());
  const fallback = el.find(byId("pc-cmd-row-shield")).find(byClass("pc-copy-fallback-host"));
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.find(isInput).value, SHIELD_DEFAULT);
  type("Ex");
  assert.equal(fallback.hidden, true, "a settings change closes the stale fallback field");
});

test("commands panel: in command block mode a copy writes the shown command with the typed name; a failure shows the same text", async (t) => {
  const { el, codes, copies, type, setMode } = commandsFixture(t);
  type("Ex");
  setMode("block");
  const expected = buildCommand(COMMANDS.find((entry) => entry.id === "shield"), { mode: "block", name: "Ex" });
  const shown = codes()[15].textContent;
  assert.equal(shown, expected);
  const written = [];
  await withNavigator({ clipboard: { writeText: async (text) => written.push(text) } }, () => copies()[15].click());
  assert.deepEqual(written, [expected]);
  assert.ok(written[0].startsWith('/give @p shield[custom_name={text:"Ex",'), "the copy uses the current mode and name");

  await withNavigator({}, () => copies()[15].click());
  const fallback = el.find(byId("pc-cmd-row-shield")).find(byClass("pc-copy-fallback-host"));
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.find(isInput).value, shown, "the manual-copy field holds the displayed command");
});

test("commands panel: each comma of a command is followed by one line break hint, and only commas are", (t) => {
  const { codes, type, setMode } = commandsFixture(t);
  const check = (label) => {
    for (const code of codes()) {
      const text = code.textContent;
      const nodes = code.children;
      const breaks = nodes.filter((n) => n.tagName === "WBR");
      assert.ok(breaks.length > 0, `${label}: ${text}`);
      assert.equal(breaks.length, (text.match(/,/g) ?? []).length, `${label}: ${text}`);
      nodes.forEach((n, i) => {
        if (n.tagName !== "WBR") return;
        const before = nodes[i - 1];
        assert.ok(before && before.tagName === undefined && before.textContent.endsWith(","), `${label}: break ${i} follows a comma`);
      });
    }
  };
  check("default");
  type("Ex, Calibur");
  setMode("block");
  check("name with a comma");
});

test("commands panel: the name hint fills {max} and {placeholder}; no text in the panel shows a raw {param}", async (t) => {
  const textsOf = (node) => node.children.flatMap((c) => (c instanceof FakeElement ? [c.ownText, ...textsOf(c)] : [c.textContent]));
  const checkPanel = (lang) => {
    const { el } = commandsFixture(t);
    const hint = el.find(byId("pc-cmd-name-hint")).textContent;
    assert.ok(hint.includes("input the name you want"), `${lang}: ${hint}`);
    assert.ok(hint.includes("50"), `${lang}: ${hint}`);
    assert.ok(!hint.includes("{"), `${lang}: ${hint}`);
    const raw = [el.ownText, ...textsOf(el)].filter((text) => /\{[A-Za-z0-9_]+\}/.test(text));
    assert.deepEqual(raw, [], `${lang}: unfilled parameters`);
  };
  checkPanel("en");
  const savedFetch = globalThis.fetch;
  globalThis.fetch = createFakeFetch({ "i18n/zh-TW.json": await readDict("zh-TW") }).fetch;
  try {
    await setLang("zh-TW");
  } finally {
    globalThis.fetch = savedFetch;
  }
  t.after(() => setLang("en"));
  checkPanel("zh-TW");
});

test("commands panel: the notice, the guide state, the mode and the typed name survive a rebuild", (t) => {
  const ui = { blockOpen: false, notice: true };
  const { el, notice, input, codes } = commandsFixture(t, { settings: { mode: "block", name: "Ex " }, ui });
  assert.equal(notice.hidden, false);
  assert.equal(input.getAttribute("aria-describedby"), `pc-cmd-name-removed ${NAME_DESCRIBED_BY}`);
  assert.equal(el.find(byClass("pc-cmd-block")).open, false);
  assert.equal(input.value, "Ex ");
  assert.ok(codes()[15].textContent.startsWith('/give @p shield[custom_name={text:"Ex",'));
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

test("commands panel: item names, variant names and the obfuscated hint follow the current language", async (t) => {
  const savedFetch = globalThis.fetch;
  const zh = await readDict("zh-TW");
  globalThis.fetch = createFakeFetch({ "i18n/zh-TW.json": zh }).fetch;
  try {
    await setLang("zh-TW");
  } finally {
    globalThis.fetch = savedFetch;
  }
  t.after(() => setLang("en"));
  const { el } = commandsFixture(t);
  assert.equal(el.find(byId("pc-cmd-group-diamond_pickaxe_fortune")).textContent, "鑽石鎬");
  assert.equal(el.find(byId("pc-cmd-row-diamond_pickaxe_silk_touch-variant")).textContent, "精準採集");
  assert.equal(el.find(byId("pc-cmd-name-obfuscated")).textContent, zh.messages["commands.name.obfuscated"]);
});

// Tab strip on narrow screens (design spec 6 and 15): edge fades and scrolling a selected tab into view.

const WORLD_TABS = [
  { id: "overworld", label: "Overworld", shortLabel: "Overworld", count: 3 },
  { id: "the_nether", label: "The Nether", shortLabel: "Nether", count: 1 },
  { id: "the_end", label: "The End", shortLabel: "End", count: 0 },
  { id: "commands", label: "Commands", shortLabel: "Commands", count: null },
];

/** Replaces a global (ResizeObserver, matchMedia) for one test and restores it afterwards. */
function stubGlobal(t, name, value) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, name, saved);
    else delete globalThis[name];
  });
}

/**
 * Tabs with a fake layout: a 296 px strip holding four tabs 326 px wide in total (Builder World at 320 px).
 * ResizeObserver callbacks are collected so the test can fire them; scrollTo moves scrollLeft at once.
 */
function tabsFixture(t) {
  const observers = [];
  stubGlobal(t, "ResizeObserver", class {
    constructor(fn) {
      this.fn = fn;
    }
    observe(target) {
      observers.push({ fn: this.fn, target });
    }
  });
  let tabs;
  const render = (id) => tabs.update(WORLD_TABS, id, "Dimensions");
  tabs = createTabs({ idPrefix: "pc-dim-tab", panelId: "pc-tabpanel", onSelect: render });
  const strip = tabs.el;
  const scrolls = [];
  const pageScrolls = [];
  Object.assign(strip, { scrollWidth: 326, clientWidth: 296, scrollLeft: 0 });
  strip.scrollTo = (options) => {
    scrolls.push(options);
    strip.scrollLeft = options.left;
  };
  const widths = [96, 80, 60, 90];
  strip.getBoundingClientRect = () => ({ left: 0, right: 296, top: 0, bottom: 52, width: 296, height: 52 });
  const layout = () => {
    let x = -strip.scrollLeft;
    tabs.el.children.forEach((button, i) => {
      const left = x;
      button.getBoundingClientRect = () => ({ left, right: left + widths[i], top: 0, bottom: 52, width: widths[i], height: 52 });
      button.scrollIntoView = () => pageScrolls.push(button);
      x += widths[i];
    });
  };
  mount(t, strip);
  const resize = () => observers.filter((o) => o.target === strip).forEach((o) => o.fn([]));
  const button = (id) => strip.find(byId(`pc-dim-tab-${id}`));
  const select = (id) => {
    layout();
    render(id);
  };
  return { tabs, strip, scrolls, pageScrolls, select, resize, button, layout, render };
}

const stateOf = (strip) => ["is-scrollable", "has-overflow-start", "has-overflow-end"].filter((name) => strip.classList.contains(name));

test("tab strip: state classes only while it overflows, fading the edge that hides tabs", (t) => {
  const { strip, render, resize } = tabsFixture(t);
  render("overworld");
  assert.deepEqual(stateOf(strip), ["is-scrollable", "has-overflow-end"], "at the start only the right edge hides a tab");
  strip.scrollLeft = 15;
  strip.dispatch("scroll");
  assert.deepEqual(stateOf(strip), ["is-scrollable", "has-overflow-start", "has-overflow-end"]);
  strip.scrollLeft = 30;
  strip.dispatch("scroll");
  assert.deepEqual(stateOf(strip), ["is-scrollable", "has-overflow-start"], "at the end only the left edge fades");

  strip.clientWidth = 400; // wider screen: everything fits
  resize();
  assert.deepEqual(stateOf(strip), []);
  strip.clientWidth = 296;
  strip.scrollLeft = 0;
  render("overworld"); // a re-render (for example new labels) checks again
  assert.deepEqual(stateOf(strip), ["is-scrollable", "has-overflow-end"]);
});

test("tab strip: a newly selected tab is scrolled into view inside the strip, smooth unless reduced motion", async (t) => {
  let reduced = false;
  stubGlobal(t, "matchMedia", (query) => ({ media: query, matches: reduced }));
  const { strip, scrolls, pageScrolls, select, button, layout, render } = tabsFixture(t);
  select("overworld");
  assert.deepEqual(scrolls, [], "the first tab is already in view");

  select("commands"); // click or hash change: Commands is partly hidden on the right
  assert.deepEqual(scrolls, [{ left: 30, behavior: "smooth" }], "only the strip scrolls, never the page (no top)");
  strip.scrollLeft = 0; // the user scrolls the strip back by hand
  layout();
  render("commands");
  assert.equal(scrolls.length, 1, "re-rendering the same tab does not scroll a strip the user moved");

  reduced = true;
  strip.scrollLeft = 30;
  layout();
  button("commands").focus();
  button("commands").dispatch("keydown", { key: "Home" }); // keyboard selection through onSelect
  assert.equal(document.activeElement, button("overworld"));
  assert.deepEqual(scrolls.at(-1), { left: 0, behavior: "auto" }, "reduced motion jumps");
  assert.deepEqual(pageScrolls, [], "scrollIntoView is never used, so the page does not move");
});

test("tab strip: a size change keeps the selected tab in view without animation; no layout means no scroll", (t) => {
  const { strip, scrolls, render, resize, layout } = tabsFixture(t);
  const saved = strip.getBoundingClientRect;
  strip.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  render("commands"); // hash on load: the strip has no layout yet
  assert.deepEqual(scrolls, []);
  strip.getBoundingClientRect = saved;
  layout();
  resize(); // first layout
  assert.deepEqual(scrolls, [{ left: 30, behavior: "auto" }]);
});

test("filter chips share the strip state: is-scrollable follows a re-render of the chips", (t) => {
  const toolbar = createToolbar({ onInput() {}, onClearQuery() {}, onToggleTag() {}, onClearAll() {}, onSubmit() {} });
  mount(t, toolbar.el);
  const chips = toolbar.el.find(byClass("pc-chips"));
  Object.assign(chips, { scrollWidth: 500, clientWidth: 343, scrollLeft: 0 });
  const filters = ["farm", "base", "portal"].map((id, i) => ({ id, tag: { name: { en: id } }, count: i, selected: false, disabled: false }));
  const view = { query: "", filters, hasPoints: true, summary: { key: "commands.tab", plural: false, params: {} }, showClearAll: false, showSummary: true };
  toolbar.update(view);
  assert.deepEqual(stateOf(chips), ["is-scrollable", "has-overflow-end"]);
  chips.scrollWidth = 343;
  toolbar.update(view);
  assert.deepEqual(stateOf(chips), []);
});
