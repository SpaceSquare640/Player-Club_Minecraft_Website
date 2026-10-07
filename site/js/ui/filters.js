// Toolbar: search box, "Submit a point", tag filter chips and the result summary.
// The search input and the chips are created once and updated in place, so typing and toggling
// never lose focus. Esc in the search box clears it when it has a value.

import { plural, pick, t } from "../i18n.js";
import { h, icon, replaceChildren, watchHorizontalOverflow } from "./dom.js";

/**
 * @param {{ onInput: (query: string) => void, onClearQuery: () => void, onToggleTag: (tagId: string) => void,
 *   onClearAll: () => void, onSubmit: (button: HTMLElement) => void }} handlers
 */
export function createToolbar({ onInput, onClearQuery, onToggleTag, onClearAll, onSubmit }) {
  const label = h("label", { className: "pc-sr-only", attrs: { for: "pc-search" } });
  const input = h("input", {
    className: "pc-search__input",
    attrs: {
      id: "pc-search",
      type: "search",
      enterkeyhint: "search",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      maxlength: "100",
    },
  });
  const clear = h(
    "button",
    { className: "pc-icon-btn pc-search__clear", attrs: { type: "button" }, hidden: true, on: { click: () => onClearQuery() } },
    icon("x"),
  );
  input.addEventListener("input", () => {
    clear.hidden = input.value === "";
    onInput(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value !== "") {
      event.preventDefault();
      onClearQuery();
    }
  });

  const submitText = h("span");
  const submit = h(
    "button",
    { className: "pc-btn pc-btn--secondary pc-toolbar__submit", attrs: { type: "button" }, on: { click: () => onSubmit(submit) } },
    icon("plus"),
    submitText,
  );

  const chips = h("div", { className: "pc-chips", attrs: { role: "group" } });
  const chipButtons = new Map();
  let chipSignature = "";
  const result = h("p", { className: "pc-result" });
  const clearAll = h("button", { className: "pc-btn pc-btn--text", attrs: { type: "button" }, hidden: true, on: { click: () => onClearAll() } });
  const summary = h("div", { className: "pc-toolbar__summary" }, result, clearAll);

  const el = h(
    "div",
    { className: "pc-toolbar" },
    h("div", { className: "pc-toolbar__search pc-search" }, label, icon("search"), input, clear),
    submit,
    chips,
    summary,
  );

  // Fade the chip row edges on phones only while it can actually scroll (checked again after each render).
  const updateScrollable = watchHorizontalOverflow(chips);

  function chipButton(id) {
    return h("button", {
      className: "pc-chip",
      attrs: { type: "button" },
      dataset: { id },
      on: {
        click: (event) => {
          if (event.currentTarget.getAttribute("aria-disabled") === "true") return;
          onToggleTag(id);
        },
      },
    });
  }

  function updateChips(filters) {
    const signature = filters.map((f) => f.id).join(",");
    if (signature !== chipSignature) {
      chipButtons.clear();
      replaceChildren(
        chips,
        filters.map((f) => {
          const button = chipButton(f.id);
          chipButtons.set(f.id, button);
          return button;
        }),
      );
      chipSignature = signature;
    }
    for (const f of filters) {
      const button = chipButtons.get(f.id);
      button.setAttribute("aria-pressed", String(f.selected));
      if (f.disabled) button.setAttribute("aria-disabled", "true");
      else button.removeAttribute("aria-disabled");
      replaceChildren(
        button,
        f.selected ? icon("check") : null,
        h("span", { text: pick(f.tag.name) }),
        h("span", { className: "pc-chip__count", text: String(f.count) }),
        f.disabled ? h("span", { className: "pc-sr-only", text: `, ${t("filter.tag.noData")}` }) : null,
      );
    }
    updateScrollable();
  }

  /**
   * @param {{ query: string, filters: object[], hasPoints: boolean, summary: { key: string, plural: boolean,
   *   params: object }, showClearAll: boolean, showSummary: boolean }} view
   */
  function update(view) {
    label.textContent = t("search.label");
    input.placeholder = t("search.placeholder");
    clear.setAttribute("aria-label", t("search.clear"));
    submitText.textContent = t("submit.add");
    chips.setAttribute("aria-label", t("filter.tags.label"));
    clearAll.textContent = t("clear.all");
    if (document.activeElement !== input && input.value !== view.query) input.value = view.query;
    clear.hidden = input.value === "";
    chips.hidden = !view.hasPoints;
    summary.hidden = !view.hasPoints || !view.showSummary;
    if (view.hasPoints) updateChips(view.filters);
    const text = view.summary.plural ? plural(view.summary.key, view.summary.params.n, view.summary.params) : t(view.summary.key, view.summary.params);
    result.textContent = text;
    clearAll.hidden = !view.showClearAll;
    return text;
  }

  /** Sets the search box value (for example after "Clear search & filters") and focuses it. */
  function resetQuery({ focus = false } = {}) {
    input.value = "";
    clear.hidden = true;
    if (focus) input.focus();
  }

  return { el, input, update, resetQuery };
}
