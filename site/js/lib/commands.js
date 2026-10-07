// Minecraft /give commands of the Commands tab; not the Issue comment commands of scripts/lib/commands.mjs.
// Pure functions shared by the site and the cross validation (X25): no DOM and no browser globals.
// Data files store only the item, the enchantments (SNBT map text) and an optional count; the custom name
// and the target selector are built here from two settings (usage mode, name) that live only in page memory.
// Syntax: Java Edition 1.21.5 or later (custom_name as an SNBT text component).

import { codePointLength, stripControlChars } from "./text.js";

/** Name text when the name is empty; also the placeholder of the name input. */
export const NAME_PLACEHOLDER = "input the name you want";
/** Name limit in code points, like renaming in an anvil. */
export const MAX_NAME_LENGTH = 50;
/** Usage modes: a command block has no @s target, so it uses the nearest player. */
export const MODES = Object.freeze([Object.freeze({ id: "block", selector: "@p" }), Object.freeze({ id: "chat", selector: "@s" })]);
export const DEFAULT_SETTINGS = Object.freeze({ mode: "chat", name: "" });
/** Java Edition chat accepts at most 256 characters (UTF-16 length); longer pastes are cut off. */
export const CHAT_COMMAND_LIMIT = 256;

/** Item id without namespace; schemas/v1/commands.schema.json uses the same pattern. */
export const ITEM_RE = /^[a-z][a-z0-9_]{1,63}$/;
/** SNBT map of the enchantments component, e.g. {unbreaking:3,mending:1}; same pattern as the schema. */
export const ENCHANTMENTS_RE = /^\{[a-z][a-z0-9_]{0,63}:[1-9][0-9]{0,2}(?:,[a-z][a-z0-9_]{0,63}:[1-9][0-9]{0,2})*\}$/;
export const MAX_ENCHANTMENTS_LENGTH = 1000;
export const MAX_ENCHANTMENT_LEVEL = 255;
export const MAX_COUNT = 64;

const COMMAND_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
// Name whitelist: letters, marks, numbers, space and printable ASCII stay. Everything else is removed,
// and so are variation selectors and enclosing marks (they are marks, but only decorate emoji).
// Written as an alternation instead of a v-flag set difference for browser support.
export const DISALLOWED_NAME_RE = /[^\p{L}\p{M}\p{N}\x20-\x7E]|[︀-️\u{E0100}-\u{E01EF}]|\p{Me}/gu;
const SPACE_SEPARATOR_RE = /\p{Zs}/gu;

/**
 * Name rule steps 1 to 3: NFC, every space separator becomes U+0020, then control and invisible
 * characters (text.js) and characters outside the whitelist are removed.
 * @returns {{ value: string, removed: boolean }} removed: step 3 removed at least one character
 */
export function filterNameChars(raw) {
  const spaced = String(raw ?? "").normalize("NFC").replace(SPACE_SEPARATOR_RE, " ");
  const value = stripControlChars(spaced).replace(DISALLOWED_NAME_RE, "");
  return { value, removed: value !== spaced };
}

/**
 * Value to write back into the name input. Leading and trailing spaces stay (so typing can go on);
 * when the trimmed text is longer than 50 code points, the leading spaces and the first 50 code points
 * of the text are kept. caret is mapped to the filtered text before it.
 * @returns {{ value: string, caret: number, removed: boolean }}
 */
export function cleanNameInput(raw, caret) {
  const text = String(raw ?? "");
  const { value: filtered, removed } = filterNameChars(text);
  let value = filtered;
  const rest = filtered.trimStart();
  if (codePointLength(rest.trimEnd()) > MAX_NAME_LENGTH) {
    value = filtered.slice(0, filtered.length - rest.length) + Array.from(rest).slice(0, MAX_NAME_LENGTH).join("");
  }
  const at = Number.isInteger(caret) ? filterNameChars(text.slice(0, Math.max(0, caret))).value.length : value.length;
  return { value, caret: Math.min(at, value.length), removed };
}

/**
 * Name used in commands: steps 1 to 3, trimmed, at most 50 code points (never split inside a surrogate pair).
 * @returns {{ name: string, removed: boolean, truncated: boolean }}
 */
export function sanitizeName(raw) {
  const { value, removed } = filterNameChars(raw);
  const chars = Array.from(value.trim());
  const truncated = chars.length > MAX_NAME_LENGTH;
  return { name: truncated ? chars.slice(0, MAX_NAME_LENGTH).join("").trimEnd() : chars.join(""), removed, truncated };
}

/** Escapes text for an SNBT double-quoted string: backslashes first, then double quotes. */
export function escapeSnbtString(text) {
  return String(text).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * Settings: the mode is checked against MODES by strict equality (no trimming, no case folding) and
 * falls back to the default; the name goes through sanitizeName.
 * @returns {{ mode: string, selector: string, name: string }}
 */
export function normalizeSettings(raw) {
  const mode = MODES.find((m) => m.id === raw?.mode) ?? MODES.find((m) => m.id === DEFAULT_SETTINGS.mode);
  return { mode: mode.id, selector: mode.selector, name: sanitizeName(raw?.name).name };
}

/** True when an entry can be turned into a command (same limits as the schema). */
export function isCommandEntry(entry) {
  return (
    entry !== null &&
    typeof entry === "object" &&
    typeof entry.id === "string" &&
    COMMAND_ID_RE.test(entry.id) &&
    typeof entry.item === "string" &&
    ITEM_RE.test(entry.item) &&
    typeof entry.enchantments === "string" &&
    entry.enchantments.length <= MAX_ENCHANTMENTS_LENGTH &&
    ENCHANTMENTS_RE.test(entry.enchantments) &&
    (entry.count === undefined || (Number.isInteger(entry.count) && entry.count >= 1 && entry.count <= MAX_COUNT)) &&
    typeof entry.label?.en === "string" &&
    entry.label.en !== ""
  );
}

/**
 * Splits enchantments text into [{ id, level }] in written order.
 * @returns {Array<{ id: string, level: number }> | null} null when the text does not match ENCHANTMENTS_RE
 */
export function parseEnchantments(text) {
  if (typeof text !== "string" || text.length > MAX_ENCHANTMENTS_LENGTH || !ENCHANTMENTS_RE.test(text)) return null;
  return text
    .slice(1, -1)
    .split(",")
    .map((pair) => {
      const [id, level] = pair.split(":");
      return { id, level: Number(level) };
    });
}

/**
 * Full /give command for an entry and the current settings (shown and copied as is). This is the only
 * definition of the command layout, the same as the owner's command list except that obfuscated is
 * always false (players change it to true by hand). The name is joined by concatenation and never goes
 * through String.prototype.replace, so "$&" and setting-like text stay as typed. Without a count the
 * command ends at "]" (the game gives one item).
 */
export function buildCommand(entry, settings) {
  if (!isCommandEntry(entry)) throw new TypeError(`Invalid command entry: ${entry?.id}`);
  const s = normalizeSettings(settings);
  const name = s.name === "" ? NAME_PLACEHOLDER : escapeSnbtString(s.name);
  const count = entry.count === undefined ? "" : ` ${entry.count}`;
  return `/give ${s.selector} ${entry.item}[custom_name={text:"${name}",obfuscated:false},enchantments=${entry.enchantments}]${count}`;
}

/** Adjacent entries with the same item form one group: [{ item, label, entries }]. */
export function groupCommands(entries) {
  const groups = [];
  for (const entry of entries ?? []) {
    const last = groups.at(-1);
    if (last && last.item === entry.item) last.entries.push(entry);
    else groups.push({ item: entry.item, label: entry.label, entries: [entry] });
  }
  return groups;
}

/** Length as the game's chat box counts it (UTF-16 code units). */
export function commandLength(text) {
  return String(text).length;
}

/** True when the command is longer than the chat box accepts; exactly 256 still fits. */
export function exceedsChatLimit(text) {
  return commandLength(text) > CHAT_COMMAND_LIMIT;
}
