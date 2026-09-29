// Point list of the current dimension (newest first) and its empty states. The pinned world spawn
// card is rendered separately (spawn-card.js) and never goes through this pipeline.

import { plural, t } from "../i18n.js";
import { h, icon, replaceChildren } from "./dom.js";
import { renderPointCard } from "./point-card.js";

/**
 * @param {{ list: HTMLUListElement, empty: HTMLElement }} hosts
 * @param {{ points: object[], total: number, query: string, tagIds: string[], cardCtx: object,
 *   onClearAll: () => void }} view
 *   points: filtered and sorted points; total: points of the dimension before filtering.
 */
export function renderPointList({ list, empty }, { points, total, query, tagIds, cardCtx, onClearAll }) {
  replaceChildren(list, points.map((point) => renderPointCard(point, cardCtx)));
  list.hidden = points.length === 0;

  if (total === 0) {
    // No points at all: the toolbar's "Submit a point" is the next step (no duplicate button).
    replaceChildren(
      empty,
      icon("map-pin-off", "pc-empty__icon"),
      h("p", { className: "pc-empty__title", text: t("empty.dim.title") }),
      h("p", { className: "pc-empty__body", text: t("empty.dim.body") }),
    );
    empty.hidden = false;
    return;
  }
  if (points.length === 0) {
    const conditions = [];
    if (query) conditions.push(h("li", { text: t("empty.search.query", { query }) }));
    if (tagIds.length > 0) conditions.push(h("li", { text: plural("empty.search.tags", tagIds.length) }));
    replaceChildren(
      empty,
      icon("map-pin-off", "pc-empty__icon"),
      h("p", { className: "pc-empty__title", text: t("empty.search.title") }),
      conditions.length > 0 ? h("ul", { className: "pc-empty__conditions", attrs: { role: "list" } }, conditions) : null,
      h("p", { className: "pc-empty__body", text: t("empty.search.body") }),
      h(
        "div",
        { className: "pc-empty__actions" },
        h("button", { className: "pc-btn pc-btn--secondary", attrs: { type: "button" }, text: t("clear.all"), on: { click: onClearAll } }),
      ),
    );
    empty.hidden = false;
    return;
  }
  empty.replaceChildren();
  empty.hidden = true;
}
