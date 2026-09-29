// Pinned world spawn card, generated from world.spawn (the spawn is not a point). Shown only on the
// Overworld tab, above the list; never filtered, sorted or counted. Its "⋯" menu offers only
// "Request edit" (the spawn cannot be deleted).

import { t } from "../i18n.js";
import { buildSpawnCard } from "../lib/coords.js";
import { createCopyButton, createFallbackHost } from "./copy.js";
import { renderCoords } from "./coords-block.js";
import { h, icon } from "./dom.js";
import { createMenuButton } from "./menu.js";

export const SPAWN_TITLE_ID = "pc-spawn-title";

/**
 * @param {object} world
 * @param {string} dimension
 * @param {{ scope: object, onRequestSpawn: (opener: HTMLElement) => void }} ctx
 * @returns {HTMLElement | null} <section aria-label="Pinned"> or null when there is no card.
 */
export function renderSpawnCard(world, dimension, { scope, onRequestSpawn }) {
  const card = buildSpawnCard(world, dimension);
  if (!card) return null;
  const article = h("article", { className: "pc-card pc-card--pinned", attrs: { "aria-labelledby": SPAWN_TITLE_ID }, dataset: { spawn: world.id } });
  const fallback = createFallbackHost();
  const menu = createMenuButton({
    ariaLabel: t("card.more", { name: t("world.spawn") }),
    host: article,
    items: [{ label: t("card.requestEdit"), icon: "pencil", onSelect: (trigger) => onRequestSpawn(trigger) }],
  });
  menu.classList.add("pc-pinned__menu");
  const copy = createCopyButton({
    variant: "text",
    value: card.copyText,
    label: t("card.copy"),
    liveMessage: (value) => t("world.spawn.copied", { value }),
    scope,
    fallbackHost: fallback,
    className: "pc-pinned__copy",
  });
  fallback.classList.add("pc-pinned__fallback");
  article.append(
    h(
      "div",
      { className: "pc-pinned__body" },
      h("p", { className: "pc-pinned__label" }, icon("pin"), h("span", { text: t("pin.label") })),
      h("h3", { className: "pc-pinned__name", attrs: { id: SPAWN_TITLE_ID, tabindex: "-1" }, text: t("world.spawn") }),
      h("div", { className: "pc-pinned__coords" }, renderCoords(card)),
      copy,
      menu,
      fallback,
    ),
  );
  return h("section", { className: "pc-pinned", attrs: { "aria-label": t("pin.region") } }, article);
}
