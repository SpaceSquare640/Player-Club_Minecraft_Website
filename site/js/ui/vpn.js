// Radmin VPN block (rendered only when vpn.worldIds contains the current world). Collapsed by
// default below 1024 px and expanded from 1024 px on the first load; afterwards the visitor's
// choice is kept. Expanding and collapsing are instant (no height animation).

import { t } from "../i18n.js";
import { createCopyButton, createFallbackHost } from "./copy.js";
import { externalLink, h, icon } from "./dom.js";

/** VPN entries of a world. */
export const vpnsForWorld = (vpns, worldId) => (vpns ?? []).filter((vpn) => vpn.worldIds?.includes(worldId));

/**
 * @param {object} vpn Entry of vpn.json (type "radmin").
 * @param {{ scope: object, discordUrl: string, expanded: boolean, onToggle: (expanded: boolean) => void }} ctx
 */
export function renderVpn(vpn, { scope, discordUrl, expanded, onToggle }) {
  const key = (name) => `vpn.${vpn.type}.${name}`;
  const titleId = `pc-vpn-title-${vpn.id}`;
  const bodyId = `pc-vpn-body-${vpn.id}`;
  const fallback = createFallbackHost();
  const newTab = t("link.newTab");

  const body = h(
    "div",
    { className: "pc-vpn__body", attrs: { id: bodyId }, hidden: !expanded },
    h(
      "ol",
      { className: "pc-vpn__steps" },
      h(
        "li",
        { className: "pc-vpn__step" },
        h("p", { text: t(key("step1")) }),
        h(
          "div",
          { className: "pc-vpn__value" },
          h("span", { className: "pc-vpn__network", text: vpn.networkName }),
          createCopyButton({
            variant: "icon",
            value: vpn.networkName,
            ariaLabel: t(key("step1")),
            liveMessage: (value) => t(key("copied"), { value }),
            scope,
            fallbackHost: fallback,
          }),
        ),
        fallback,
      ),
      h("li", { className: "pc-vpn__step" }, h("p", { text: t(key("step2")) }), externalLink(discordUrl, "pc-btn pc-btn--community", t("discord.cta"), newTab)),
      h(
        "li",
        { className: "pc-vpn__step" },
        h("p", { text: t(key("step3")) }),
        externalLink(vpn.contactUrl, "pc-btn pc-btn--community", t(key("step3.link")), newTab),
        h("p", { className: "pc-vpn__note", text: t(key("step3.note")) }),
        h("p", { className: "pc-vpn__password" }, icon("lock"), h("span", { text: t(key("passwordLine"), { value: t(key("password.value")) }) })),
      ),
    ),
  );

  const toggle = h(
    "button",
    {
      className: "pc-vpn__toggle",
      attrs: { type: "button", "aria-expanded": String(expanded), "aria-controls": bodyId },
      on: {
        click: () => {
          const next = toggle.getAttribute("aria-expanded") !== "true";
          toggle.setAttribute("aria-expanded", String(next));
          body.hidden = !next;
          onToggle(next);
        },
      },
    },
    h("span", { text: t(key("title")) }),
    icon("chevron-down"),
  );

  return h("section", { className: "pc-vpn", attrs: { "aria-labelledby": titleId } }, h("h2", { className: "pc-vpn__heading", attrs: { id: titleId } }, toggle), body);
}
