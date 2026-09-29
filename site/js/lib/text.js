// Plain-text helpers shared by the site and Node scripts. No DOM and no browser globals.
// Character rules match the plainText / multilineText definitions in schemas/v1/defs.schema.json.

// Rejected characters (every one written as an escape so it is visible in reviews):
// - C0 and C1 controls and DEL (general category Cc; line feed is allowed in multi-line text)
// - every format character (Cf): zero-width, bidi controls, soft hyphen, word joiner, BOM, tag characters ...
// - lone surrogates (Cs), line and paragraph separators (U+2028, U+2029)
// - invisible characters that are letters, marks or symbols in Unicode: combining grapheme joiner,
//   Hangul fillers, Khmer inherent vowels, Mongolian variation selectors, braille blank, the null notehead,
//   the default-ignorable range U+E0000-U+E0FFF (tags, variation selectors supplement) and U+FFF0-U+FFF8.
// Variation selectors U+FE00-U+FE0F stay allowed because emoji use them.
const INVISIBLE =
  String.raw`\u007F-\u009F\p{Cf}\p{Cs}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2028\u2029\u2065\u2800\u3164\uFFA0\uFFF0-\uFFF8\u{1D159}\u{E0000}-\u{E0FFF}`;

const CONTROL_RE = new RegExp(String.raw`[\u0000-\u001F${INVISIBLE}]`, "u");
const CONTROL_RE_G = new RegExp(String.raw`[\u0000-\u001F${INVISIBLE}]`, "gu");
// Same set without line feed (U+000A), for multi-line text such as notes.
const CONTROL_NO_LF_RE = new RegExp(String.raw`[\u0000-\u0009\u000B-\u001F${INVISIBLE}]`, "u");

/** True when text contains a control or invisible formatting character (line feed allowed with allowNewline). */
export function hasControlChars(text, { allowNewline = false } = {}) {
  return (allowNewline ? CONTROL_NO_LF_RE : CONTROL_RE).test(text);
}

/** Removes every control and invisible formatting character (line feed included). */
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
