// Public text guard (X16): public text that we write (change log templates, update entries, dictionaries)
// must not leak internal information such as tooling names, note-taking systems or local paths.
// User-supplied values embedded in that text (point names, world names) are data, not our wording,
// so callers pass them as userValues and they are masked before the check.

export const INTERNAL_TEXT_PATTERNS = [
  { id: "agent", re: /\bagents?\b/i },
  { id: "subagent", re: /\bsub-?agents?\b/i },
  { id: "claude", re: /claude/i },
  { id: "anthropic", re: /anthropic/i },
  { id: "obsidian", re: /obsidian/i },
  { id: "notes-zh", re: /筆記/ },
  { id: "operation-log-zh", re: /操作(?:記錄|紀錄)/ },
  { id: "windows-path", re: /[A-Za-z]:\\/ },
  { id: "home-path", re: /\/(?:Users|home)\/[^\s/]+/ },
];

/** Returns the ids of every internal-text pattern found in text (empty when clean). */
export function findInternalText(text) {
  if (typeof text !== "string") return [];
  return INTERNAL_TEXT_PATTERNS.filter(({ re }) => re.test(text)).map(({ id }) => id);
}

/**
 * Masks every occurrence of the user-supplied values (longest first) with a space, so only our own
 * wording is left for the guard.
 * @param {string} text
 * @param {Array<string | null | undefined>} userValues
 */
export function maskUserValues(text, userValues = []) {
  if (typeof text !== "string") return text;
  const values = [...new Set(userValues.filter((v) => typeof v === "string" && v.length > 0))];
  values.sort((a, b) => b.length - a.length);
  let masked = text;
  for (const value of values) masked = masked.split(value).join(" ");
  return masked;
}

/** Like findInternalText, but ignores the user-supplied values embedded in the text. */
export function findInternalTextExcept(text, userValues = []) {
  return findInternalText(maskUserValues(text, userValues));
}
