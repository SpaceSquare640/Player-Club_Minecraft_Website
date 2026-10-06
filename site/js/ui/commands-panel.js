// Commands tab of worlds with commands: true (design spec 15): settings (usage mode, item name, symbols,
// two colours, reset), a preview and one card per item with its /give commands and copy buttons.
// The settings live in app memory only (never in the hash or browser storage). Controls are created
// once; a settings change rewrites the command texts, lengths and preview in place (no rebuild, no
// announcement of command text). Every text is set through h() / textContent; no HTML is parsed.

import { getLang, pick, t } from "../i18n.js";
import {
  CHAT_COMMAND_LIMIT,
  COLORS,
  DEFAULT_SETTINGS,
  MAX_NAME_LENGTH,
  MODES,
  NAME_PLACEHOLDER,
  SYMBOLS,
  buildCommand,
  cleanNameInput,
  commandLength,
  commandParts,
  exceedsChatLimit,
  filterNameChars,
  groupCommands,
  isCommandEntry,
  normalizeSettings,
  sanitizeName,
} from "../lib/commands.js";
import { codePointLength } from "../lib/text.js";
import { createCopyButton, createFallbackHost } from "./copy.js";
import { h, icon, replaceChildren } from "./dom.js";
import { announce } from "./live.js";

export const COMMANDS_HEADING_ID = "pc-commands-heading";
/** Game colours that are hard to read on the dark preview box; their segments get a light backing. */
export const DARK_COLORS = Object.freeze(["black", "dark_blue", "dark_red", "dark_purple", "dark_gray"]);
const GIVE_COMMAND_BLOCK = "/give @s command_block";
const SERVER_SETTING = "enable-command-block=true";
const PASTE_INPUT_TYPES = new Set(["insertFromPaste", "insertFromDrop", "insertReplacementText"]);

/** Splits a dictionary template at {name} and puts a code element there (no HTML parsing). */
function withCode(template, name, codeText) {
  const parts = template.split(`{${name}}`);
  return parts.flatMap((part, i) => (i === 0 ? [part] : [h("code", { className: "pc-cmd__inline-code", attrs: { translate: "no" }, text: codeText }), part])).filter((p) => p !== "");
}

/** Text with a <wbr> after every comma, so long commands break at commas. */
function breakAtCommas(text) {
  const nodes = [];
  text.split(",").forEach((piece, i, all) => {
    nodes.push(i < all.length - 1 ? `${piece},` : piece);
    if (i < all.length - 1) nodes.push(h("wbr"));
  });
  return nodes.filter((n) => n !== "");
}

/** LocalizedText in the current language; lang is "en" when pick() fell back to English. */
function localized(value) {
  const lang = getLang();
  const own = typeof value?.[lang] === "string" && value[lang] !== "";
  return { text: pick(value), lang: lang !== "en" && !own ? "en" : null };
}

/**
 * @param {{ commands: object[], settings: object, onSettingsChange: (raw: object) => void, scope: object,
 *   ui?: { blockOpen: boolean, notice: boolean } }} options
 *   settings: raw values { mode, name, symbols, symbolColor, nameColor } (app memory); they are checked
 *   against the whitelists before use. ui: app-owned state of the command block instructions (open or
 *   closed) and the removed-characters notice, kept when the panel is rebuilt for another language.
 * @returns {{ el: HTMLElement, focusTitle: () => void }}
 */
export function createCommandsPanel({ commands, settings, onSettingsChange, scope, ui = { blockOpen: true, notice: false } }) {
  const heading = h("h2", { className: "pc-sr-only", attrs: { id: COMMANDS_HEADING_ID, tabindex: "-1" }, text: t("commands.heading") });
  const entries = (commands ?? []).filter(isCommandEntry);
  const focusTitle = () => heading.focus();
  if (entries.length === 0) {
    return { el: h("div", { className: "pc-cmd__inner" }, heading, h("p", { className: "pc-cmd-empty", text: t("commands.empty") })), focusTitle };
  }

  const start = normalizeSettings(settings);

  // ---------------------------------------------------------------- Usage mode
  const radios = MODES.map((mode) =>
    h("input", {
      className: "pc-segmented__input",
      attrs: { type: "radio", name: "pc-cmd-mode", id: `pc-cmd-mode-${mode.id}`, value: mode.id, checked: mode.id === start.mode },
      on: { change: () => update() },
    }),
  );
  for (const radio of radios) radio.checked = radio.getAttribute("value") === start.mode;
  const segmented = h(
    "div",
    { className: "pc-segmented" },
    MODES.flatMap((mode, i) => [radios[i], h("label", { className: "pc-segmented__option", attrs: { for: `pc-cmd-mode-${mode.id}` }, text: t(`commands.mode.${mode.id}`) })]),
  );

  const blockGuide = h(
    "details",
    { className: "pc-cmd-block", attrs: { open: ui.blockOpen !== false } },
    h("summary", { className: "pc-cmd-block__summary" }, h("span", { text: t("commands.block.title") }), icon("chevron-down")),
  );
  blockGuide.open = ui.blockOpen !== false;
  blockGuide.addEventListener("toggle", () => {
    ui.blockOpen = blockGuide.open;
  });
  const guideFallback = createFallbackHost();
  blockGuide.append(
    h(
      "ol",
      { className: "pc-cmd-block__steps" },
      h(
        "li",
        { className: "pc-cmd-block__step" },
        h(
          "div",
          { className: "pc-cmd-block__row" },
          h("p", {}, withCode(t("commands.block.step1"), "command", GIVE_COMMAND_BLOCK)),
          createCopyButton({ variant: "icon", value: GIVE_COMMAND_BLOCK, ariaLabel: t("commands.block.copy"), scope, fallbackHost: guideFallback }),
        ),
        guideFallback,
      ),
      ["step2", "step3", "step4"].map((step) => h("li", { className: "pc-cmd-block__step" }, h("p", { text: t(`commands.block.${step}`) }))),
    ),
    h("p", { className: "pc-cmd-block__note" }, withCode(t("commands.block.requires"), "setting", SERVER_SETTING)),
    h("p", { className: "pc-cmd-block__note" }, withCode(t("commands.block.nearest"), "selector", MODES[0].selector)),
  );
  const chatNote = h("p", { className: "pc-cmd-mode__chat", text: t("commands.mode.chat.note", { max: CHAT_COMMAND_LIMIT }) });
  const modeNote = h("div", { className: "pc-cmd-mode__note", attrs: { id: "pc-cmd-mode-note" } }, blockGuide, chatNote);
  const modeField = h(
    "fieldset",
    { className: "pc-cmd-mode", attrs: { "aria-describedby": "pc-cmd-mode-note" } },
    h("legend", { className: "pc-cmd-mode__legend", text: t("commands.mode.label") }),
    segmented,
    modeNote,
  );

  // ---------------------------------------------------------------- Item name
  const nameInput = h("input", {
    className: "pc-cmd-name__input",
    attrs: {
      id: "pc-cmd-name",
      type: "text",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      enterkeyhint: "done",
      placeholder: NAME_PLACEHOLDER,
      "aria-describedby": "pc-cmd-name-hint",
    },
  });
  nameInput.value = String(settings?.name ?? "");
  const count = h("span", { className: "pc-cmd-name__count", attrs: { "aria-hidden": "true" } });
  const clearName = h(
    "button",
    { className: "pc-icon-btn pc-cmd-name__clear", attrs: { type: "button", "aria-label": t("commands.name.clear") }, on: { click: () => clearNameInput() } },
    icon("x"),
  );
  const notice = h("p", { className: "pc-field__notice", attrs: { id: "pc-cmd-name-removed" }, hidden: true });
  const hint = h("p", {
    className: "pc-field__hint",
    attrs: { id: "pc-cmd-name-hint" },
    text: t("commands.name.hint", { max: MAX_NAME_LENGTH, placeholder: NAME_PLACEHOLDER }),
  });
  const nameField = h(
    "div",
    { className: "pc-field pc-field--name" },
    h("div", { className: "pc-field__head" }, h("label", { className: "pc-field__label", attrs: { for: "pc-cmd-name" }, text: t("commands.name.label") }), count),
    h("div", { className: "pc-cmd-name" }, nameInput, clearName),
    notice,
    hint,
  );

  // ---------------------------------------------------------------- Symbols and colours
  function selectField(id, labelKey, values, optionText, value, swatch) {
    const select = h(
      "select",
      { className: `pc-select${swatch ? " pc-select--swatch" : " pc-select--mono"}`, attrs: { id }, on: { change: () => update() } },
      values.map((v) => h("option", { attrs: { value: v, selected: v === value }, text: optionText(v) })),
    );
    select.value = value;
    const chip = swatch ? h("span", { className: `pc-swatch pc-mc--${value}`, attrs: { "aria-hidden": "true" } }) : null;
    const field = h(
      "div",
      { className: "pc-field" },
      h("div", { className: "pc-field__head" }, h("label", { className: "pc-field__label", attrs: { for: id }, text: t(labelKey) })),
      swatch ? h("div", { className: "pc-swatch-select" }, chip, select) : select,
    );
    return { field, select, chip };
  }
  const colorName = (id) => t(`commands.colors.${id}`);
  const symbols = selectField("pc-cmd-symbols", "commands.symbols.label", SYMBOLS, (v) => v, start.symbols, false);
  const symbolColor = selectField("pc-cmd-symbol-color", "commands.symbolColor.label", COLORS, colorName, start.symbolColor, true);
  const nameColor = selectField("pc-cmd-name-color", "commands.nameColor.label", COLORS, colorName, start.nameColor, true);

  // ---------------------------------------------------------------- Preview and reset
  const previewSegs = [0, 1, 2].map(() => h("span", { className: "pc-cmd-preview__seg" }));
  const darkNote = h("p", { className: "pc-field__hint", text: t("commands.preview.darkNote"), hidden: true });
  const preview = h(
    "div",
    { className: "pc-cmd-preview" },
    h("p", { className: "pc-cmd-preview__label", text: t("commands.preview.label") }),
    h("div", { className: "pc-cmd-preview__box", attrs: { lang: "en", translate: "no" } }, previewSegs),
    h("p", { className: "pc-field__hint", text: t("commands.preview.note") }),
    darkNote,
  );
  const reset = h("button", {
    className: "pc-btn pc-btn--text pc-cmd-reset",
    attrs: { type: "button", id: "pc-cmd-reset" },
    text: t("commands.reset"),
    on: { click: () => resetSettings() },
  });

  const settingsSection = h(
    "section",
    { className: "pc-cmd-settings", attrs: { "aria-labelledby": "pc-cmd-settings-title" } },
    h("h3", { className: "pc-cmd-settings__title", attrs: { id: "pc-cmd-settings-title" }, text: t("commands.settings.title") }),
    h("p", { className: "pc-cmd-settings__version", text: t("commands.version") }),
    modeField,
    h("div", { className: "pc-cmd-fields" }, nameField, symbols.field, symbolColor.field, nameColor.field),
    preview,
    reset,
  );

  // ---------------------------------------------------------------- Command cards
  const rows = [];
  const cards = groupCommands(entries).map((group) => {
    const titleId = `pc-cmd-group-${group.entries[0].id}`;
    const title = localized(group.label);
    const article = h(
      "article",
      { className: "pc-card pc-cmd-card", attrs: { "aria-labelledby": titleId } },
      h("h3", { className: "pc-cmd-card__title", attrs: { id: titleId, lang: title.lang }, text: title.text }),
    );
    for (const entry of group.entries) {
      const rowId = `pc-cmd-row-${entry.id}`;
      const variant = entry.variant ? localized(entry.variant) : null;
      const variantId = variant ? `${rowId}-variant` : null;
      const lengthId = `${rowId}-len`;
      const code = h("code", { className: "pc-cmd__code", attrs: { lang: "en", translate: "no" } });
      const length = h("p", { className: "pc-cmd-row__len", attrs: { id: lengthId }, hidden: true });
      const fallback = createFallbackHost();
      const item = variant ? t("commands.item.variant", { item: title.text, variant: variant.text }) : title.text;
      const copy = createCopyButton({
        variant: "text",
        label: t("commands.copy"),
        value: () => buildCommand(entry, current()),
        liveMessage: () => t("commands.copy.live", { item }),
        scope,
        fallbackHost: fallback,
        className: "pc-cmd-row__copy",
      });
      article.append(
        h(
          "div",
          { className: "pc-cmd-row", attrs: { id: rowId } },
          variant ? h("span", { className: "pc-chip pc-chip--static pc-cmd-row__variant", attrs: { id: variantId, lang: variant.lang }, text: variant.text }) : null,
          code,
          h("div", { className: "pc-cmd-row__foot" }, length, copy),
          fallback,
        ),
      );
      rows.push({ entry, code, length, lengthId, copy, fallback, describedBy: [titleId, variantId].filter(Boolean) });
    }
    return h("li", { className: "pc-cmd-list__item" }, article);
  });

  const el = h("div", { className: "pc-cmd__inner" }, heading, settingsSection, h("ul", { className: "pc-cmd-list", attrs: { role: "list" } }, cards));

  // ---------------------------------------------------------------- Behaviour

  /** Raw values of the five controls (validated by normalizeSettings before any use). */
  function raw() {
    return {
      mode: radios.find((r) => r.checked)?.getAttribute("value") ?? DEFAULT_SETTINGS.mode,
      name: nameInput.value,
      symbols: symbols.select.value,
      symbolColor: symbolColor.select.value,
      nameColor: nameColor.select.value,
    };
  }
  const current = () => normalizeSettings(raw());

  function renderCode(row, s) {
    const parts = commandParts(row.entry, s);
    replaceChildren(
      row.code,
      breakAtCommas(parts.before),
      h("span", { className: `pc-cmd__name${parts.placeholder ? " is-placeholder" : ""}`, text: parts.name }),
      breakAtCommas(parts.after),
    );
    const chat = s.mode === "chat";
    row.length.hidden = !chat;
    if (chat) {
      const command = parts.before + parts.name + parts.after;
      const n = commandLength(command);
      const over = exceedsChatLimit(command);
      row.length.className = over ? "pc-cmd-row__len pc-cmd-row__warn" : "pc-cmd-row__len";
      replaceChildren(
        row.length,
        over ? icon("alert-triangle") : null,
        h("span", { text: t(over ? "commands.length.over" : "commands.length", { n, max: CHAT_COMMAND_LIMIT }) }),
      );
    } else {
      row.length.replaceChildren();
    }
    row.copy.setAttribute("aria-describedby", [...row.describedBy, chat ? row.lengthId : null].filter(Boolean).join(" "));
    // An open manual-copy field holds the old command; close it.
    if (!row.fallback.hidden) {
      row.fallback.replaceChildren();
      row.fallback.hidden = true;
    }
  }

  function renderPreview(s) {
    const name = s.name === "" ? NAME_PLACEHOLDER : s.name;
    const segs = [
      [s.symbols, s.symbolColor],
      [` ${name} `, s.nameColor],
      [s.symbols, s.symbolColor],
    ];
    segs.forEach(([text, color], i) => {
      previewSegs[i].textContent = text;
      previewSegs[i].className = `pc-cmd-preview__seg pc-mc--${color}${DARK_COLORS.includes(color) ? " is-on-light" : ""}`;
    });
    darkNote.hidden = !DARK_COLORS.includes(s.symbolColor) && !DARK_COLORS.includes(s.nameColor);
  }

  function setNotice(show) {
    const wasHidden = notice.hidden;
    notice.hidden = !show;
    notice.textContent = show ? t("commands.name.removed") : "";
    nameInput.setAttribute("aria-describedby", show ? "pc-cmd-name-removed pc-cmd-name-hint" : "pc-cmd-name-hint");
    ui.notice = show;
    if (show && wasHidden) announce(t("commands.name.removed"));
  }

  function update() {
    const s = current();
    for (const radio of radios) radio.checked = radio.getAttribute("value") === s.mode;
    blockGuide.hidden = s.mode !== "block";
    chatNote.hidden = s.mode !== "chat";
    // Values outside the whitelists (edited in developer tools) are shown as the defaults that are used.
    if (symbols.select.value !== s.symbols) symbols.select.value = s.symbols;
    if (symbolColor.select.value !== s.symbolColor) symbolColor.select.value = s.symbolColor;
    if (nameColor.select.value !== s.nameColor) nameColor.select.value = s.nameColor;
    symbolColor.chip.className = `pc-swatch pc-mc--${s.symbolColor}`;
    nameColor.chip.className = `pc-swatch pc-mc--${s.nameColor}`;
    count.textContent = t("commands.name.count", { n: codePointLength(sanitizeName(nameInput.value).name), max: MAX_NAME_LENGTH });
    clearName.hidden = nameInput.value === "";
    for (const row of rows) renderCode(row, s);
    renderPreview(s);
    onSettingsChange?.(raw());
  }

  // Name input: rule steps 1 to 3 are written back at once, except while an IME is composing.
  let composing = false;
  let accepted = nameInput.value;
  function processName(inputType) {
    const value = nameInput.value;
    const caret = Number.isInteger(nameInput.selectionStart) ? nameInput.selectionStart : value.length;
    const filtered = filterNameChars(value);
    let next;
    if (codePointLength(filtered.value.trim()) > MAX_NAME_LENGTH && !PASTE_INPUT_TYPES.has(inputType)) {
      // Typing past 50 characters is not accepted: back to the previous value and caret.
      next = { value: accepted, caret: Math.max(0, Math.min(accepted.length, caret - (value.length - accepted.length))), removed: filtered.removed };
    } else {
      next = cleanNameInput(value, caret);
    }
    if (next.value !== value) {
      nameInput.value = next.value;
      nameInput.setSelectionRange?.(next.caret, next.caret);
    }
    accepted = next.value;
    setNotice(next.removed);
    update();
  }
  nameInput.addEventListener("compositionstart", () => {
    composing = true;
  });
  nameInput.addEventListener("compositionend", () => {
    composing = false;
    processName("insertCompositionText");
  });
  nameInput.addEventListener("input", (event) => {
    if (composing || event.isComposing) return;
    processName(event.inputType);
  });
  nameInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nameInput.value !== "") {
      event.preventDefault();
      clearNameInput();
    }
  });

  function clearNameInput() {
    nameInput.value = "";
    accepted = "";
    setNotice(false);
    update();
    nameInput.focus();
  }

  function resetSettings() {
    for (const radio of radios) radio.checked = radio.getAttribute("value") === DEFAULT_SETTINGS.mode;
    nameInput.value = "";
    accepted = "";
    symbols.select.value = DEFAULT_SETTINGS.symbols;
    symbolColor.select.value = DEFAULT_SETTINGS.symbolColor;
    nameColor.select.value = DEFAULT_SETTINGS.nameColor;
    setNotice(false);
    update();
    reset.focus();
    announce(t("commands.reset.live"));
  }

  // First render: the notice state survives a rebuild (for example a language change) without a new announcement.
  notice.hidden = !ui.notice;
  if (ui.notice) {
    notice.textContent = t("commands.name.removed");
    nameInput.setAttribute("aria-describedby", "pc-cmd-name-removed pc-cmd-name-hint");
  }
  update();

  return { el, focusTitle };
}
