// Public text guard (X16): public change log and dictionary text must not leak internal information
// such as tooling names, note-taking systems or local paths.

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
