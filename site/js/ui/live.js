// Screen reader announcements through the shared polite region #pc-live.

let region = null;
let pending = null;
let filterTimer = null;
let lastFilterMessage = "";

/** Binds the live region element (aria-live="polite", aria-atomic="true"). */
export function initLive(el) {
  region = el;
}

/** Announces a message; the region is emptied first so that a repeated message is read again. */
export function announce(message) {
  if (!region || !message) return;
  clearTimeout(pending);
  region.textContent = "";
  pending = setTimeout(() => {
    region.textContent = message;
  }, 60);
}

/**
 * Announces the filter result count 500 ms after the last change; identical consecutive messages are
 * not repeated.
 */
export function announceFilterResult(message) {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    if (message === lastFilterMessage) return;
    lastFilterMessage = message;
    announce(message);
  }, 500);
}

/** Forgets the last filter message (for example after a page or language change). */
export function resetFilterAnnouncement() {
  clearTimeout(filterTimer);
  lastFilterMessage = "";
}
