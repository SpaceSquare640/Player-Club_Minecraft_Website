// Short notifications without a fixed place (for example "Point not found"). Copy feedback never
// uses a toast. The region has role="status", so new messages are announced politely.

import { t } from "../i18n.js";
import { h, icon, replaceChildren } from "./dom.js";

const TOAST_MS = 4000;
let region = null;
let timer = null;

/** Binds the toast region element. */
export function initToast(el) {
  region = el;
}

export function hideToast() {
  clearTimeout(timer);
  region?.replaceChildren();
}

/** Shows a message for 4 seconds; it can also be closed by hand. */
export function showToast(message) {
  if (!region) return;
  clearTimeout(timer);
  replaceChildren(
    region,
    h(
      "div",
      { className: "pc-toast" },
      h("p", { className: "pc-toast__text", text: message }),
      h("button", { className: "pc-icon-btn", attrs: { type: "button", "aria-label": t("dialog.close") }, on: { click: hideToast } }, icon("x")),
    ),
  );
  timer = setTimeout(hideToast, TOAST_MS);
}
