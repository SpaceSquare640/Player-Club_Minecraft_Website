// "⋯" menu button (WAI-ARIA menu button pattern).
// Enter / Space / ArrowDown open it and focus the first item, ArrowUp the last; arrows cycle,
// Home / End jump; Esc closes and returns focus to the button; Tab closes and moves on; a click
// outside closes it. The menu is positioned inside its card (so it scrolls with the page) and flips
// above the button when there is not enough room below.

import { h, icon, nextId } from "./dom.js";
import { nextIndex } from "./model.js";

let current = null;

/** Closes the open menu, if any (for example before a re-render). */
export function closeOpenMenu() {
  current?.close();
}

/**
 * @param {{ ariaLabel: string, items: { label: string, icon: string, danger?: boolean,
 *   onSelect: (trigger: HTMLButtonElement) => void }[], host?: HTMLElement | null }} options
 *   host: element raised above its neighbours while the menu is open (the card).
 * @returns {HTMLElement} anchor element containing the trigger.
 */
export function createMenuButton({ ariaLabel, items, host = null }) {
  const menuId = nextId("pc-menu");
  const triggerId = nextId("pc-menu-trigger");
  const trigger = h(
    "button",
    {
      className: "pc-icon-btn",
      attrs: { type: "button", id: triggerId, "aria-haspopup": "menu", "aria-expanded": "false", "aria-controls": menuId, "aria-label": ariaLabel },
    },
    icon("dots"),
  );
  const anchor = h("div", { className: "pc-menu-anchor" }, trigger);
  let menu = null;
  let buttons = [];

  const onOutside = (event) => {
    if (!anchor.contains(event.target)) close();
  };

  function close({ focus = false } = {}) {
    if (!menu) return;
    menu.remove();
    menu = null;
    buttons = [];
    trigger.setAttribute("aria-expanded", "false");
    host?.classList.remove("has-open-menu");
    document.removeEventListener("pointerdown", onOutside, true);
    if (current?.close === close) current = null;
    if (focus) trigger.focus();
  }

  function focusItem(index) {
    buttons[index]?.focus();
  }

  function onMenuKeydown(event) {
    const index = buttons.indexOf(document.activeElement);
    const next = nextIndex(index, event.key, buttons.length);
    if (next !== null) {
      event.preventDefault();
      focusItem(next);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close({ focus: true });
    } else if (event.key === "Tab") {
      close();
    }
  }

  function open(focusIndex = 0) {
    if (current && current.close !== close) current.close();
    if (menu) {
      focusItem(focusIndex);
      return;
    }
    buttons = items.map((item) =>
      h(
        "button",
        {
          className: `pc-menu__item${item.danger ? " pc-menu__item--danger" : ""}`,
          attrs: { type: "button", role: "menuitem", tabindex: "-1" },
          on: {
            click: () => {
              close();
              item.onSelect(trigger);
            },
          },
        },
        icon(item.icon),
        h("span", { text: item.label }),
      ),
    );
    menu = h("div", { className: "pc-menu", attrs: { id: menuId, role: "menu", "aria-labelledby": triggerId }, on: { keydown: onMenuKeydown } }, buttons);
    anchor.append(menu);
    trigger.setAttribute("aria-expanded", "true");
    host?.classList.add("has-open-menu");
    current = { close };
    // Flip above the button when the menu would leave the viewport and there is room above.
    const menuRect = menu.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    if (menuRect.bottom > window.innerHeight - 8 && triggerRect.top > menuRect.height + 8) menu.classList.add("is-above");
    document.addEventListener("pointerdown", onOutside, true);
    focusItem(focusIndex < 0 ? buttons.length - 1 : focusIndex);
  }

  trigger.addEventListener("click", () => {
    if (menu) close();
    else open(0);
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      open(-1);
    } else if (event.key === "Escape" && menu) {
      event.preventDefault();
      close({ focus: true });
    }
  });

  return anchor;
}
