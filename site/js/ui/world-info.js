// World info panel: version, seed and world spawn, each copyable. It depends only on the current
// world and language (never on search, tags, sorting or the dimension) and is never collapsed.

import { t } from "../i18n.js";
import { formatCopyText } from "../lib/coords.js";
import { createCopyButton, createFallbackHost } from "./copy.js";
import { renderCoords } from "./coords-block.js";
import { h } from "./dom.js";
import { versionLabel } from "./model.js";

/** Version badge text, for example "Java Edition · Latest release". */
export function versionText(world) {
  const label = versionLabel(world);
  return t(label.key, { ...label.params, edition: t(label.editionKey) });
}

/**
 * @param {object} world
 * @param {{ scope: object }} ctx scope: timers of the copy buttons (disposed on re-render).
 * @returns {HTMLElement}
 */
export function renderWorldInfo(world, { scope }) {
  const titleId = "pc-worldinfo-title";
  const groups = [
    h(
      "div",
      { className: "pc-worldinfo__group" },
      h("dt", { className: "pc-worldinfo__label pc-worldinfo__label--plain", text: t("world.version") }),
      h("dd", {}, h("span", { className: "pc-badge", text: versionText(world) })),
    ),
  ];

  // The seed stays a string end to end (int64 values do not fit in a JS number).
  if (typeof world.seed === "string" && world.seed !== "") {
    const fallback = createFallbackHost();
    groups.push(
      h(
        "div",
        { className: "pc-worldinfo__group" },
        h(
          "dt",
          { className: "pc-worldinfo__label" },
          h("span", { text: t("world.seed") }),
          createCopyButton({
            variant: "icon",
            value: world.seed,
            ariaLabel: t("world.seed.copy"),
            liveMessage: () => t("world.seed.copied"),
            scope,
            fallbackHost: fallback,
          }),
        ),
        h("dd", {}, h("span", { className: "pc-worldinfo__seed", text: world.seed }), fallback),
      ),
    );
  }

  if (world.spawn) {
    const fallback = createFallbackHost();
    const copyText = formatCopyText(world.spawn);
    groups.push(
      h(
        "div",
        { className: "pc-worldinfo__group" },
        h(
          "dt",
          { className: "pc-worldinfo__label" },
          h("span", { text: t("world.spawn") }),
          createCopyButton({
            variant: "icon",
            value: copyText,
            ariaLabel: t("world.spawn.copy"),
            liveMessage: (value) => t("world.spawn.copied", { value }),
            scope,
            fallbackHost: fallback,
          }),
        ),
        h("dd", {}, renderCoords(world.spawn, { small: true }), fallback),
      ),
    );
  }

  return h(
    "section",
    { className: "pc-worldinfo", attrs: { "aria-labelledby": titleId } },
    h("h2", { className: "pc-worldinfo__title", attrs: { id: titleId }, text: t("world.info") }),
    h("dl", { className: "pc-worldinfo__list" }, groups),
  );
}
