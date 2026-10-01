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
import { initI18n } from "../../site/js/i18n.js";
import { createCopyButton, createFallbackHost, writeClipboard } from "../../site/js/ui/copy.js";
import { createScope } from "../../site/js/ui/dom.js";
import { closeOpenMenu, createMenuButton } from "../../site/js/ui/menu.js";
import { renderSpawnCard } from "../../site/js/ui/spawn-card.js";
import { renderWorldInfo } from "../../site/js/ui/world-info.js";
import { createDataset } from "../fixtures/dataset.mjs";
import { installFakeDom } from "../fixtures/fake-dom.mjs";
import { createFakeFetch } from "../fixtures/front.mjs";

const readDict = async (lang) => JSON.parse(await readFile(path.join(REPO_ROOT, "site/i18n", `${lang}.json`), "utf8"));
const en = (await readDict("en")).messages;

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
