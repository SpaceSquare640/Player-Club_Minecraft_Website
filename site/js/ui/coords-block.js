// Coordinate block shared by point cards, the pinned world spawn card and the world info panel.

import { t } from "../i18n.js";
import { h } from "./dom.js";
import { coordDisplay } from "./model.js";

/**
 * <dl class="pc-coords"> with X / Y / Z. A missing Y shows "N/A" with an explicit accessible text.
 * data-long switches to the stacked layout when a value has 8 or more characters.
 * @param {{ x: number, y: number | null, z: number }} coord
 * @param {{ small?: boolean }} [options] small: world info variant (.pc-coords--sm).
 */
export function renderCoords(coord, { small = false } = {}) {
  const view = coordDisplay(coord);
  const item = (axis, value) => {
    const dd =
      value === null
        ? h("dd", { className: "pc-coords__value pc-coords__value--empty", attrs: { "aria-label": t("card.yEmpty.aria") } }, h("span", { attrs: { "aria-hidden": "true" }, text: t("card.yEmpty") }))
        : h("dd", { className: "pc-coords__value", text: value });
    return h("div", { className: "pc-coords__item" }, h("dt", { className: "pc-coords__axis", text: axis }), dd);
  };
  return h(
    "dl",
    { className: `pc-coords${small ? " pc-coords--sm" : ""}`, dataset: { long: String(view.long) } },
    item("X", view.x),
    item("Y", view.y),
    item("Z", view.z),
  );
}
