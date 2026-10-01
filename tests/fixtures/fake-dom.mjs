// Minimal DOM stand-in for UI modules in Node, grown from the FakeElement of error-page.test.mjs:
// a tree with parentNode, attributes, dataset, classList, text, bubbling listeners and focus tracking.
// There is no layout: getBoundingClientRect returns a zero rectangle, so positioning is not testable here.

export class FakeText {
  constructor(text) {
    this.textContent = String(text);
    this.parentNode = null;
  }
}

export class FakeElement {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.className = "";
    this.hidden = false;
    this.ownText = "";
    this.value = "";
    this.selected = false;
  }
  get textContent() {
    return this.ownText + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value) {
    this.detachChildren();
    this.ownText = String(value);
  }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (...add) => {
        this.className = [...new Set([...names(), ...add])].join(" ");
      },
      remove: (...remove) => {
        this.className = names().filter((n) => !remove.includes(n)).join(" ");
      },
      contains: (name) => names().includes(name),
    };
  }
  /** True when the element hangs below document.body, as in the real DOM. */
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument?.body;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn));
  }
  detachChildren() {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter((c) => c !== node);
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.detachChildren();
    this.ownText = "";
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  replaceWith(node) {
    const parent = this.parentNode;
    if (!parent) return;
    node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1);
    parent.children[parent.children.indexOf(this)] = node;
    node.parentNode = parent;
    this.parentNode = null;
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  select() {
    this.selected = true;
  }
  getBoundingClientRect() {
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
  }
  /**
   * Dispatches an event that bubbles to the ancestors until stopPropagation().
   * @returns {unknown[]} listener return values (async listeners return promises).
   */
  dispatch(type, init = {}) {
    let stopped = false;
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        event.defaultPrevented = true;
      },
      stopPropagation() {
        stopped = true;
      },
      ...init,
    };
    const results = [];
    for (let node = this; node && !stopped; node = node.parentNode) {
      for (const fn of node.listeners?.get(type) ?? []) results.push(fn(event));
    }
    return results;
  }
  /** Clicks and resolves once every (async) click listener has finished. */
  click() {
    return Promise.all(this.dispatch("click"));
  }
  findAll(predicate) {
    const found = [];
    for (const child of this.children) {
      if (!(child instanceof FakeElement)) continue;
      if (predicate(child)) found.push(child);
      found.push(...child.findAll(predicate));
    }
    return found;
  }
  find(predicate) {
    return this.findAll(predicate)[0] ?? null;
  }
}

/** Fake document with body, activeElement and document-level listeners (for outside clicks). */
export function createFakeDocument({ baseURI = "https://example.test/site/" } = {}) {
  const listeners = new Map();
  const doc = {
    baseURI,
    activeElement: null,
    createElement: (tag) => new FakeElement(tag, doc),
    createTextNode: (text) => new FakeText(text),
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
    listenerCount: (type) => (listeners.get(type) ?? []).length,
    /** A pointerdown anywhere on the page, delivered to the document-level listeners. */
    pointerDown(target) {
      for (const fn of listeners.get("pointerdown") ?? []) fn({ type: "pointerdown", target });
    },
  };
  doc.body = new FakeElement("body", doc);
  doc.activeElement = doc.body;
  return doc;
}

/**
 * Installs globalThis.document and globalThis.window (innerHeight only) and returns a restore function.
 * Other globals (fetch, navigator, matchMedia) are stubbed by the tests that need them.
 */
export function installFakeDom(options) {
  const saved = { document: globalThis.document, window: globalThis.window };
  const document = createFakeDocument(options);
  globalThis.document = document;
  globalThis.window = { innerHeight: 800 };
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  };
  return { document, restore };
}
