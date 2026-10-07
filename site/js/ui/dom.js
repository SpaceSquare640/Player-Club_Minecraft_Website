// Small DOM helpers. Text is always set through textContent / setAttribute (never parsed as HTML).

/**
 * Creates an element.
 * @param {string} tag
 * @param {{ className?: string, text?: string, attrs?: Record<string, string | number | boolean | null | undefined>,
 *   dataset?: Record<string, string>, on?: Record<string, EventListener>, hidden?: boolean }} [props]
 * @param {...(Node | string | null | undefined | false)} children Strings become text nodes.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.text !== undefined && props.text !== null) el.textContent = String(props.text);
  for (const [name, value] of Object.entries(props.attrs ?? {})) setAttr(el, name, value);
  for (const [name, value] of Object.entries(props.dataset ?? {})) el.dataset[name] = value;
  for (const [type, fn] of Object.entries(props.on ?? {})) el.addEventListener(type, fn);
  if (props.hidden) el.hidden = true;
  append(el, ...children);
  return el;
}

/** Sets an attribute; false, null and undefined remove it, true sets an empty value. */
export function setAttr(el, name, value) {
  if (value === false || value === null || value === undefined) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? "" : String(value));
}

/** Appends nodes and strings (as text nodes), skipping empty values. */
export function append(parent, ...children) {
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return parent;
}

/** Replaces all children of parent. */
export function replaceChildren(parent, ...children) {
  parent.replaceChildren();
  return append(parent, ...children);
}

/** Visually hidden text for screen readers. */
export const srOnly = (text) => h("span", { className: "pc-sr-only", text });

/** Tabler icon rendered as a CSS mask in currentColor (decorative). */
export function icon(name, className = "") {
  return h("span", { className: `pc-icon pc-icon--${name}${className ? ` ${className}` : ""}`, attrs: { "aria-hidden": "true" } });
}

let uid = 0;
/** Unique element id with a prefix. */
export const nextId = (prefix) => `${prefix}-${(uid += 1)}`;

/**
 * Timer scope: every timer created through it is cleared by dispose() (re-render or removal).
 */
export function createScope() {
  const timers = new Set();
  const cleanups = new Set();
  return {
    timeout(fn, ms) {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
      return id;
    },
    clear(id) {
      clearTimeout(id);
      timers.delete(id);
    },
    onDispose(fn) {
      cleanups.add(fn);
    },
    dispose() {
      for (const id of timers) clearTimeout(id);
      timers.clear();
      for (const fn of cleanups) fn();
      cleanups.clear();
    },
  };
}

/** External link attributes, icon and the visually hidden "(opens in a new tab)" note. */
export function externalLink(href, className, label, newTabText, { iconName = "external-link" } = {}) {
  return h(
    "a",
    { className, attrs: { href, target: "_blank", rel: "noopener noreferrer" } },
    h("span", { className: "pc-link__text", text: label }),
    iconName ? icon(iconName) : null,
    srOnly(` ${newTabText}`),
  );
}

/** True when the user asked for reduced motion. */
export function prefersReducedMotion() {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Horizontal scroll strip state as classes (no inline styles, CSP): is-scrollable while the content is
 * wider than the box, has-overflow-start / has-overflow-end while content is hidden on that side. CSS
 * uses them for edge fades. Updated on resize and scroll; call the returned function after a re-render.
 * @param {HTMLElement} el
 * @returns {() => void}
 */
export function watchHorizontalOverflow(el) {
  const update = () => {
    const max = el.scrollWidth - el.clientWidth;
    const scrollable = max > 1;
    el.classList.toggle("is-scrollable", scrollable);
    el.classList.toggle("has-overflow-start", scrollable && el.scrollLeft > 1);
    el.classList.toggle("has-overflow-end", scrollable && el.scrollLeft < max - 1);
  };
  if (typeof ResizeObserver === "function") new ResizeObserver(update).observe(el);
  el.addEventListener("scroll", update, { passive: true });
  return update;
}
