// Point card: name, "⋯" menu (request edit / deletion), tags with "+N", coordinates, tag hints,
// note, submitter and date (Taipei time), and the "Copy coordinates" button.
// Every user-provided value is rendered as text (textContent / setAttribute only).

import { pick, t } from "../i18n.js";
import { formatCopyText } from "../lib/coords.js";
import { createCopyButton, createFallbackHost } from "./copy.js";
import { renderCoords } from "./coords-block.js";
import { h, replaceChildren } from "./dom.js";
import { createMenuButton } from "./menu.js";
import { cardTagLayout, orderCardTags, pointDateMeta } from "./model.js";

function renderTags(list, orderedIds, tagsById, expanded, onToggle) {
  const layout = cardTagLayout(orderedIds, { expanded });
  const items = layout.visible.map((id) =>
    h("li", {}, h("span", { className: "pc-chip pc-chip--static", text: pick(tagsById.get(id)?.name) || id })),
  );
  if (layout.collapsible) {
    const more = h("button", {
      className: "pc-chip pc-chip--more",
      attrs: {
        type: "button",
        "aria-expanded": String(expanded),
        "aria-label": expanded ? null : t("card.tagsMore.aria", { n: layout.hiddenCount }),
      },
      text: expanded ? t("card.tagsLess") : t("card.tagsMore", { n: layout.hiddenCount }),
      on: { click: onToggle },
    });
    items.push(h("li", {}, more));
    replaceChildren(list, items);
    return more;
  }
  replaceChildren(list, items);
  return null;
}

/**
 * @param {object} point Point with worldId.
 * @param {{ tags: object[], tagsById: Map<string, object>, selectedTagIds: string[], timeZone: string,
 *   scope: object, onRequest: (kind: "edit" | "delete", point: object, opener: HTMLElement) => void }} ctx
 * @returns {HTMLLIElement}
 */
export function renderPointCard(point, ctx) {
  const titleId = `pc-point-${point.id}`;
  const article = h("article", { className: "pc-card", attrs: { "aria-labelledby": titleId }, dataset: { pointId: point.id } });

  const menu = createMenuButton({
    ariaLabel: t("card.more", { name: point.name }),
    host: article,
    items: [
      { label: t("card.requestEdit"), icon: "pencil", onSelect: (trigger) => ctx.onRequest("edit", point, trigger) },
      { label: t("card.requestDelete"), icon: "trash", danger: true, onSelect: (trigger) => ctx.onRequest("delete", point, trigger) },
    ],
  });
  const head = h(
    "div",
    { className: "pc-card__head" },
    h("h3", { className: "pc-card__title", attrs: { id: titleId, tabindex: "-1" }, text: point.name }),
    menu,
  );

  // Tags: filter selection first, then tags.json order; "+N" expands in place and keeps focus.
  const orderedIds = orderCardTags(point.tags, { selected: ctx.selectedTagIds, tags: ctx.tags });
  const tagList = h("ul", { className: "pc-card__tags", attrs: { role: "list" } });
  let expanded = false;
  const drawTags = (focusToggle) => {
    const toggle = renderTags(tagList, orderedIds, ctx.tagsById, expanded, () => {
      expanded = !expanded;
      drawTags(true);
    });
    if (focusToggle) toggle?.focus();
  };
  drawTags(false);

  const hints = orderedIds.map((id) => ctx.tagsById.get(id)?.hint).filter(Boolean);
  const meta = pointDateMeta(point, ctx.timeZone);
  const fallback = createFallbackHost();
  const copyText = formatCopyText(point);

  replaceChildren(
    article,
    head,
    orderedIds.length > 0 ? tagList : null,
    renderCoords(point),
    ...hints.map((hint) => h("p", { className: "pc-card__hint", text: t("card.hint", { hint: pick(hint) }) })),
    point.note ? h("p", { className: "pc-card__note", text: point.note }) : null,
    h(
      "p",
      { className: "pc-card__meta" },
      h("span", { className: "pc-card__by", attrs: { title: point.submittedBy } }, `${t("card.submittedBy")} `, h("span", { text: point.submittedBy })),
      meta ? h("span", { className: "pc-card__sep", attrs: { "aria-hidden": "true" }, text: " · " }) : null,
      meta
        ? h(
            "span",
            { className: "pc-card__date" },
            `${t(meta.labelKey)} `,
            h("time", { attrs: { datetime: meta.timestamp, title: t("time.taipei", { time: meta.time }) }, text: meta.date }),
          )
        : null,
    ),
    createCopyButton({
      variant: "text",
      value: copyText,
      label: t("card.copy"),
      liveMessage: (value) => t("card.copy.live", { value }),
      scope: ctx.scope,
      fallbackHost: fallback,
      className: "pc-card__copy",
    }),
    fallback,
  );

  return h("li", { className: "pc-cards__item" }, article);
}
