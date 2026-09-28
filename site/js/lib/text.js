// Plain-text helpers shared by the site and Node scripts. No DOM and no browser globals.
// Character rules match the plainText / multilineText definitions in schemas/v1/defs.schema.json.

// C0 controls, DEL, zero-width and bidirectional control characters.
const CONTROL_RE = /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/u;
const CONTROL_RE_G = /[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/gu;
// Same set without line feed (U+000A), for multi-line text such as notes.
const CONTROL_NO_LF_RE = /[\u0000-\u0009\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/u;

/** True when text contains a control, zero-width or bidi character (line feed allowed with allowNewline). */
export function hasControlChars(text, { allowNewline = false } = {}) {
  return (allowNewline ? CONTROL_NO_LF_RE : CONTROL_RE).test(text);
}

/** Removes every control, zero-width and bidi character (line feed included). */
export function stripControlChars(text) {
  return text.replace(CONTROL_RE_G, "");
}

/** plainText rule: a string without control characters and without leading or trailing whitespace. */
export function isPlainText(text, { allowNewline = false } = {}) {
  if (typeof text !== "string") return false;
  if (text !== text.trim()) return false;
  return !hasControlChars(text, { allowNewline });
}

/** Length in Unicode code points (surrogate pairs count once). */
export function codePointLength(text) {
  let n = 0;
  for (const _ of text) n += 1;
  return n;
}
