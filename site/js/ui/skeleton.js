// Loading skeletons with the shape of the final layout (no spinners). Shown only after 150 ms.

import { h } from "./dom.js";

const bar = (modifier) => h("span", { className: `pc-skeleton pc-skeleton--${modifier}`, attrs: { "aria-hidden": "true" } });

function cardSkeleton() {
  return h(
    "li",
    { className: "pc-cards__item pc-cards__item--skeleton" },
    h(
      "div",
      { className: "pc-skeleton-card" },
      bar("line"),
      h("div", { className: "pc-skeleton-card__chips" }, bar("chip"), bar("chip")),
      bar("coords"),
      bar("button"),
    ),
  );
}

/** Coordinates page: world title, world info panel, 3 tabs, pinned strip and cards (2 or 3). */
export function pointsSkeleton(label) {
  return h(
    "div",
    { className: "pc-page--points", attrs: { role: "status", "aria-label": label } },
    h("div", { className: "pc-worldbar" }, bar("title")),
    h("div", { className: "pc-aside" }, bar("panel")),
    h(
      "div",
      { className: "pc-maincol" },
      h("div", { className: "pc-skeleton-tabs" }, bar("tab"), bar("tab"), bar("tab")),
      bar("pinned"),
      h("ul", { className: "pc-cards", attrs: { role: "list" } }, cardSkeleton(), cardSkeleton(), cardSkeleton()),
    ),
  );
}

/** Change log: 5 rows. */
export function changelogSkeleton(label) {
  return h("div", { className: "pc-skeleton-rows", attrs: { role: "status", "aria-label": label } }, ...[1, 2, 3, 4, 5].map(() => bar("row")));
}

/** Commands tab: settings outline (title, mode, two fields) and 3 command cards. */
export function commandsSkeleton(label) {
  const card = () => h("li", { className: "pc-skeleton-card pc-skeleton-card--cmd" }, bar("line"), bar("code"), bar("button"));
  return h(
    "div",
    { className: "pc-cmd__inner", attrs: { role: "status", "aria-label": label } },
    h("div", { className: "pc-skeleton-settings" }, bar("line"), bar("tab"), bar("tab"), bar("tab")),
    h("ul", { className: "pc-cmd-list", attrs: { role: "list" } }, card(), card(), card()),
  );
}
