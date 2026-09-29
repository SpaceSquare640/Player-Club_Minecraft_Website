// Tabs (WAI-ARIA tabs, automatic activation, roving tabindex), used for the dimensions and the
// change log sections. Left / Right / Home / End move and activate.
// Visual design adapted from Uiverse.io by chase2k25 (rare-quail-40), MIT License; see css/components.css.

import { h, replaceChildren } from "./dom.js";
import { nextIndex } from "./model.js";

/**
 * @param {{ className?: string, idPrefix: string, panelId: string, onSelect: (id: string) => void }} options
 * @returns {{ el: HTMLElement, update: (tabs: { id: string, label: string, shortLabel?: string,
 *   count?: number | null }[], selectedId: string, ariaLabel: string) => void, focusSelected: () => void }}
 */
export function createTabs({ className = "", idPrefix, panelId, onSelect }) {
  const el = h("div", { className: `pc-tabs${className ? ` ${className}` : ""}`, attrs: { role: "tablist" } });
  let buttons = new Map();
  let signature = "";

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
  }

  return {
    el,
    update,
    focusSelected: () => [...buttons.values()].find((button) => button.getAttribute("aria-selected") === "true")?.focus(),
    idOf: (id) => `${idPrefix}-${id}`,
  };
}
