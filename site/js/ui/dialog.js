// Submit dialog: choose between the GitHub Issue form and the Discord invite (native <dialog>).
// Opening focuses the first option; Esc, the close button, a click on the backdrop or choosing an
// option closes it, and focus returns to the element that opened it.

import { t } from "../i18n.js";
import { buildNewIssueUrl } from "../lib/issue-links.js";
import { createCopyButton, createFallbackHost } from "./copy.js";
import { createScope, h, icon, nextId, replaceChildren } from "./dom.js";

const SHIELD_SRC = "assets/img/pc-shield-32.webp";
const SHIELD_SRCSET = "assets/img/pc-shield-32.webp 1x, assets/img/pc-shield-64.webp 2x, assets/img/pc-shield-96.webp 3x";

let root = null;
let dialog = null;
let scope = null;
let returnFocus = null;

/** Sets the element that hosts the dialog (the app root, so the design tokens apply). */
export function initDialog(appRoot) {
  root = appRoot;
}

function ensureDialog() {
  if (dialog) return dialog;
  dialog = h("dialog", { className: "pc-dialog" });
  dialog.addEventListener("click", (event) => {
    // A click on the dialog element itself (not its content) is a click on the backdrop.
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    scope?.dispose();
    scope = null;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected) target.focus();
  });
  root.append(dialog);
  return dialog;
}

function titleFor(kind, point) {
  if (kind === "edit") return t("dialog.edit.title", { name: point.name });
  if (kind === "delete") return t("dialog.delete.title", { name: point.name });
  if (kind === "spawn") return t("dialog.editSpawn.title");
  return t("dialog.submit.title");
}

function option({ href, iconNode, title, sub, hint, onChoose }) {
  return h(
    "a",
    { className: "pc-option", attrs: { href, target: "_blank", rel: "noopener noreferrer" }, on: { click: onChoose } },
    iconNode,
    h(
      "span",
      { className: "pc-option__text" },
      h("span", { className: "pc-option__title", text: title }),
      h("span", { className: "pc-option__sub", text: sub }),
      hint ? h("span", { className: "pc-option__hint", text: hint }) : null,
    ),
  );
}

/**
 * @param {{ kind: "add" | "edit" | "delete" | "spawn", config: object, world: object,
 *   point?: object, dimensionName?: string, opener?: HTMLElement }} options
 *   dimensionName: display name of the target's dimension (edit / delete / spawn).
 */
export function openSubmitDialog({ kind, config, world, point, dimensionName, opener }) {
  const el = ensureDialog();
  if (el.open) el.close();
  scope = createScope();
  returnFocus = opener ?? null;
  const titleId = nextId("pc-dialog-title");
  const close = () => el.close();
  const hasTarget = kind !== "add";

  let target = null;
  if (hasTarget) {
    const targetText = kind === "spawn" ? t("dialog.spawnTarget", { world: world.name }) : point.id;
    const fallback = createFallbackHost();
    target = h(
      "div",
      { className: "pc-dialog__target" },
      h("p", { className: "pc-dialog__target-label", text: kind === "spawn" ? t("dialog.target") : t("dialog.pointId") }),
      h(
        "div",
        { className: "pc-dialog__target-row" },
        h("span", { className: `pc-dialog__target-id${kind === "spawn" ? "" : " pc-mono"}`, text: targetText }),
        createCopyButton({ variant: "icon", value: targetText, ariaLabel: t("dialog.copyTarget"), scope, fallbackHost: fallback }),
      ),
      h("p", { className: "pc-dialog__target-where", text: `${world.name} · ${dimensionName ?? ""}` }),
      fallback,
    );
  }

  const params = kind === "spawn" ? { worldId: world.id } : hasTarget ? { pointId: point.id } : {};
  const options = h(
    "div",
    { className: "pc-dialog__options" },
    option({
      href: buildNewIssueUrl(config, kind, params),
      iconNode: icon("external-link", "pc-option__icon"),
      title: t("dialog.github"),
      sub: t("dialog.github.sub"),
      onChoose: close,
    }),
    option({
      href: config.discordInviteUrl,
      iconNode: h("img", {
        className: "pc-option__img",
        attrs: { src: SHIELD_SRC, srcset: SHIELD_SRCSET, width: 28, height: 28, alt: "", decoding: "async" },
      }),
      title: t("dialog.discord"),
      sub: t("dialog.discord.sub"),
      hint: hasTarget ? t("dialog.discord.hint") : null,
      onChoose: close,
    }),
  );

  replaceChildren(
    el,
    h(
      "div",
      { className: "pc-dialog__inner" },
      h("span", { className: "pc-dialog__handle", attrs: { "aria-hidden": "true" } }),
      h(
        "div",
        { className: "pc-dialog__head" },
        h("h2", { className: "pc-dialog__title", attrs: { id: titleId }, text: titleFor(kind, point) }),
        h("button", { className: "pc-icon-btn pc-dialog__close", attrs: { type: "button", "aria-label": t("dialog.close") }, on: { click: close } }, icon("x")),
      ),
      target,
      h("p", { className: "pc-dialog__review", text: t("dialog.review") }),
      options,
    ),
  );
  el.setAttribute("aria-labelledby", titleId);
  el.showModal();
  options.querySelector("a")?.focus();
}

/** Closes the dialog when it is open (for example on a language change). */
export function closeDialog() {
  if (dialog?.open) dialog.close();
}
