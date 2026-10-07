// Tabs (WAI-ARIA tabs, automatic activation, roving tabindex), used for the dimensions and the
// change log sections. Left / Right / Home / End move and activate. On narrow screens the strip scrolls
// sideways: its edges fade where tabs are hidden, and the selected tab is scrolled into view when it is
// new or when new labels or counts move it.
// Visual design adapted from Uiverse.io by chase2k25 (rare-quail-40), MIT License; see css/components.css.

import { h, prefersReducedMotion, replaceChildren, watchHorizontalOverflow } from "./dom.js";
import { nextIndex } from "./model.js";

/** Width of the edge fade (--pc-mask-fade-start / -end in tokens.css): a revealed tab stops clear of it. */
const EDGE_FADE_PX = 16;

/**
 * @param {{ className?: string, idPrefix: string, panelId: string, onSelect: (id: string) => void }} options
 * @returns {{ el: HTMLElement, update: (tabs: { id: string, label: string, shortLabel?: string,
 *   count?: number | null }[], selectedId: string, ariaLabel: string) => void, focusSelected: () => void }}
 */
export function createTabs({ className = "", idPrefix, panelId, onSelect }) {
  const el = h("div", { className: `pc-tabs${className ? ` ${className}` : ""}`, attrs: { role: "tablist" } });
  let buttons = new Map();
  let signature = "";
  let text = ""; // labels, short labels and counts of the last render
  let revealedId = null;

  el.addEventListener("keydown", (event) => {
    const list = [...buttons.values()];
    const index = list.indexOf(document.activeElement);
    if (index < 0) return;
    const next = nextIndex(index, event.key, list.length, { axis: "horizontal" });
    if (next === null) return;
    event.preventDefault();
    list[next].focus();
    onSelect(list[next].dataset.id);
  });

  const selectedButton = () => [...buttons.values()].find((button) => button.getAttribute("aria-selected") === "true");

  /**
   * Scrolls the strip itself (never the page) so the selected tab shows clear of the edge fade. Does
   * nothing while the strip has no layout or the tab is already in view.
   */
  function reveal(smooth) {
    const button = selectedButton();
    if (!button || typeof el.scrollTo !== "function") return;
    const strip = el.getBoundingClientRect();
    if (strip.width === 0) return;
    const tab = button.getBoundingClientRect();
    let delta = 0;
    if (tab.left < strip.left + EDGE_FADE_PX) delta = tab.left - strip.left - EDGE_FADE_PX;
    else if (tab.right > strip.right - EDGE_FADE_PX) delta = tab.right - strip.right + EDGE_FADE_PX;
    const left = Math.max(0, Math.min(el.scrollLeft + delta, el.scrollWidth - el.clientWidth));
    if (!(Math.abs(left - el.scrollLeft) >= 1)) return;
    el.scrollTo({ left, behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto" });
  }

  const refreshOverflow = watchHorizontalOverflow(el);
  // A size change (first layout, rotation) keeps the selected tab in view, without animation.
  if (typeof ResizeObserver === "function") new ResizeObserver(() => reveal(false)).observe(el);

  function build(tabs) {
    buttons = new Map();
    const nodes = tabs.map((tab) => {
      const button = h("button", {
        className: "pc-tab",
        attrs: { type: "button", role: "tab", id: `${idPrefix}-${tab.id}`, "aria-controls": panelId },
        dataset: { id: tab.id },
        on: { click: () => onSelect(tab.id) },
      });
      buttons.set(tab.id, button);
      return button;
    });
    replaceChildren(el, nodes);
  }

  function update(tabs, selectedId, ariaLabel) {
    const nextSignature = tabs.map((tab) => tab.id).join(",");
    if (nextSignature !== signature) {
      build(tabs);
      signature = nextSignature;
    }
    el.setAttribute("aria-label", ariaLabel);
    for (const tab of tabs) {
      const button = buttons.get(tab.id);
      const selected = tab.id === selectedId;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      const parts = [h("span", { className: "pc-tab__name pc-tab__name--long", text: tab.label })];
      if (tab.shortLabel !== undefined) parts.push(h("span", { className: "pc-tab__name pc-tab__name--short", text: tab.shortLabel }));
      if (tab.count !== undefined && tab.count !== null) parts.push(h("span", { className: "pc-tab__count", text: String(tab.count) }));
      replaceChildren(button, parts);
    }
    // Labels and counts change the content width (language, filters), not the strip size.
    refreshOverflow();
    // Click, keyboard, hash and back / forward all end here. A newly selected tab is revealed: smoothly,
    // except on the first render (page load or a link to a tab), which jumps. The same tab is revealed
    // again, at once, only when the tab text changed (language, filter counts): that moves the tabs
    // without resizing the strip, so the ResizeObserver stays silent. A plain re-render leaves a strip
    // the user scrolled by hand where it is.
    const nextText = JSON.stringify(tabs.map((tab) => [tab.label, tab.shortLabel ?? null, tab.count ?? null]));
    if (selectedId !== revealedId) {
      const first = revealedId === null;
      revealedId = selectedId;
      reveal(!first);
    } else if (nextText !== text) {
      reveal(false);
    }
    text = nextText;
  }

  return {
    el,
    update,
    focusSelected: () => selectedButton()?.focus(),
    idOf: (id) => `${idPrefix}-${id}`,
  };
}
