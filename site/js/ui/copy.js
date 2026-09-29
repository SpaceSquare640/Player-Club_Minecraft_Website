// Copy buttons (text and icon variants) with the manual-copy fallback field.
// States (data-state): idle, copied (2 s, a repeated click copies again and restarts the timer).
// On failure the button stays idle and the fallback field opens below it.
// Visual design adapted from Uiverse.io by vinodjangid07 (wonderful-squid-57), MIT License; see css/components.css.

import { t } from "../i18n.js";
import { h, icon, replaceChildren } from "./dom.js";
import { announce } from "./live.js";

const FEEDBACK_MS = 2000;

/** Writes text to the clipboard; resolves true on success, false otherwise (never rejects). */
export async function writeClipboard(text) {
  try {
    if (!globalThis.navigator?.clipboard?.writeText) return false;
    await globalThis.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function hideFallback(host) {
  if (!host || host.hidden) return;
  host.replaceChildren();
  host.hidden = true;
}

/**
 * Manual-copy fallback: explanation, read-only field (focused and selected) and a close button.
 * Esc or close removes it and returns focus to the button.
 */
function showFallback(host, value, button) {
  if (!host) return;
  const close = () => {
    hideFallback(host);
    button.focus();
  };
  const input = h("input", {
    className: "pc-copy-fallback__input",
    attrs: { type: "text", readonly: true, "aria-label": t("copy.fallback"), spellcheck: "false" },
    on: {
      keydown: (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        close();
      },
    },
  });
  input.value = value;
  replaceChildren(
    host,
    h(
      "div",
      { className: "pc-copy-fallback" },
      h("p", { className: "pc-copy-fallback__text", text: t("copy.fallback") }),
      h(
        "div",
        { className: "pc-copy-fallback__row" },
        input,
        h("button", { className: "pc-icon-btn", attrs: { type: "button", "aria-label": t("dialog.close") }, on: { click: close } }, icon("x")),
      ),
    ),
  );
  host.hidden = false;
  input.focus();
  input.select();
  announce(t("copy.fallback"));
}

/**
 * Creates a copy button.
 * @param {{ variant?: "text" | "icon", value: string | (() => string), label?: string, ariaLabel?: string,
 *   liveMessage?: (value: string) => string, scope: { timeout: Function, clear: Function },
 *   fallbackHost?: HTMLElement, className?: string }} options
 *   label: visible text of the text variant (default "Copy coordinates").
 *   ariaLabel: accessible name of the icon variant (the tooltip is aria-hidden).
 *   liveMessage: announcement after a successful copy (default "Copied: {value}").
 *   fallbackHost: hidden element that receives the manual-copy field on failure (createFallbackHost).
 */
export function createCopyButton({ variant = "text", value, label, ariaLabel, liveMessage, scope, fallbackHost, className = "" }) {
  const isIcon = variant === "icon";
  const idleText = label ?? t("card.copy");
  let glyph = icon("copy", "pc-copy__icon");
  const text = isIcon ? null : h("span", { className: "pc-copy__label", text: idleText });
  const tip = isIcon ? h("span", { className: "pc-copy__tip", text: t("copy.tip"), attrs: { "aria-hidden": "true" } }) : null;
  const button = h(
    "button",
    {
      className: `pc-copy${isIcon ? " pc-copy--icon" : ""}${className ? ` ${className}` : ""}`,
      attrs: { type: "button", "aria-label": isIcon ? ariaLabel : null },
      dataset: { state: "idle" },
    },
    glyph,
    text,
    tip,
  );
  let timer = null;

  // The icon node is replaced on every transition so that its entrance animation replays.
  function setState(state) {
    const next = icon(state === "copied" ? "check" : "copy", "pc-copy__icon");
    glyph.replaceWith(next);
    glyph = next;
    button.dataset.state = state;
    if (text) text.textContent = state === "copied" ? t("card.copied") : idleText;
    if (tip) tip.textContent = state === "copied" ? t("card.copied") : t("copy.tip");
  }

  button.addEventListener("click", async () => {
    const copyText = typeof value === "function" ? value() : value;
    const ok = await writeClipboard(copyText);
    if (!button.isConnected) return;
    if (timer) scope.clear(timer);
    timer = null;
    if (!ok) {
      if (button.dataset.state !== "idle") setState("idle");
      showFallback(fallbackHost, copyText, button);
      return;
    }
    hideFallback(fallbackHost);
    setState("copied");
    timer = scope.timeout(() => {
      timer = null;
      setState("idle");
    }, FEEDBACK_MS);
    announce(liveMessage ? liveMessage(copyText) : t("copy.live", { value: copyText }));
  });

  return button;
}

/** Hidden container for the manual-copy fallback field of a copy button. */
export const createFallbackHost = () => h("div", { className: "pc-copy-fallback-host", hidden: true });
