// Error panels: whole coordinates page (core data or points) and the change log area.
// Works even when no dictionary could be loaded: built-in English text is used for every missing key.

import { textLang, t } from "../i18n.js";
import { errorView } from "../data/repository.js";
import { h, icon, replaceChildren } from "./dom.js";

/** English text used when the dictionaries themselves failed to load. */
export const FALLBACK_TEXT = Object.freeze({
  "changelog.error": "Couldn't load the change log",
  "error.load.body": "Check your connection and try again.",
  "error.load.title": "Couldn't load data",
  "error.reload": "Reload",
  "error.report": "Report on Discord",
  "error.retry": "Retry",
  "error.schema": "This data version isn't supported. Please reload the page.",
  "link.newTab": "(opens in a new tab)",
});

/** Dictionary text when available, otherwise the built-in English text. */
export function textFor(key) {
  return textLang(key) ? t(key) : (FALLBACK_TEXT[key] ?? key);
}

/**
 * Renders an error panel (role="alert") into host.
 * @param {HTMLElement} host
 * @param {{ error: unknown, onRetry: () => void, discordUrl?: string | null, titleKey?: string,
 *   fallbackOnly?: boolean }} options
 *   A schema version error offers "Reload" (a stale page); every other error offers "Retry".
 *   titleKey overrides the title (the change log uses "changelog.error").
 *   fallbackOnly: core data or dictionaries failed; only the built-in English text is used and no
 *   Discord link is shown (the invite link lives only in config.json).
 * @returns {HTMLButtonElement} the primary button.
 */
export function renderError(host, { error, onRetry, discordUrl = null, titleKey, fallbackOnly = false }) {
  const view = errorView(error);
  const safeText = fallbackOnly ? (key) => FALLBACK_TEXT[key] ?? key : textFor;
  const primary = h("button", {
    className: "pc-btn pc-btn--primary",
    attrs: { type: "button" },
    text: safeText(view.actionKey),
    on: { click: () => (view.retryable ? onRetry() : globalThis.location.reload()) },
  });
  const report =
    discordUrl && !fallbackOnly
      ? h(
          "a",
          { className: "pc-link-community", attrs: { href: discordUrl, target: "_blank", rel: "noopener noreferrer" } },
          h("span", { text: safeText("error.report") }),
          icon("external-link"),
          h("span", { className: "pc-sr-only", text: ` ${safeText("link.newTab")}` }),
        )
      : null;
  replaceChildren(
    host,
    h(
      "div",
      { className: "pc-error", attrs: { role: "alert", lang: fallbackOnly ? "en" : null } },
      icon("alert-triangle", "pc-error__icon"),
      h("p", { className: "pc-error__title", text: safeText(titleKey ?? view.titleKey) }),
      h("p", { className: "pc-error__body", text: safeText(view.bodyKey) }),
      h("div", { className: "pc-error__actions" }, primary, report),
    ),
  );
  return primary;
}
