// Change Log page: "Site updates" and "Point changes" sections, grouped by date (Taipei time,
// newest first), 30 entries per "Load more". Each section loads on first visit; a failure only
// affects this page. Entry text is data and is rendered as plain text.

import { pick, plural, t } from "../i18n.js";
import { sortChangelogEntries } from "../lib/filter.js";
import { changelogLink, toHref, defaultState } from "../lib/hash.js";
import { createTabs } from "./dimension-tabs.js";
import { h, icon, replaceChildren } from "./dom.js";
import { renderError } from "./error-view.js";
import { announce } from "./live.js";
import { groupByDate, pageEntries } from "./model.js";
import { changelogSkeleton } from "./skeleton.js";

const SKELETON_DELAY_MS = 150;

/**
 * @param {HTMLElement} page <section data-page="changelog">
 * @param {{ onSelectLog: (log: string) => void, loadEntries: (kind: string) => Promise<object[]>,
 *   ensurePoints: (worldIds: string[]) => Promise<void>, getCtx: () => object,
 *   onTargetLink: (target: { type: string, worldId: string }) => void, getDiscordUrl: () => string | null }} deps
 */
export function createChangelogView(page, deps) {
  const title = h("h1", { className: "pc-changelog__title", attrs: { id: "pc-changelog-title", tabindex: "-1" } });
  const intro = h("p", { className: "pc-changelog__intro" });
  const tabs = createTabs({ className: "pc-tabs--sm pc-changelog__tabs", idPrefix: "pc-log-tab", panelId: "pc-log-panel", onSelect: deps.onSelectLog });
  const list = h("div", { className: "pc-changelog__list" });
  const more = h("button", { className: "pc-btn pc-btn--secondary pc-changelog__more", attrs: { type: "button" }, hidden: true });
  const status = h("div", { className: "pc-changelog__status" });
  const panel = h("div", { className: "pc-changelog__panel", attrs: { id: "pc-log-panel", role: "tabpanel", tabindex: "-1" } }, status, list, more);
  replaceChildren(page, h("header", { className: "pc-changelog__head" }, title, intro), tabs.el, panel);

  const pages = { updates: 1, points: 1 };
  const loaded = new Map();
  let currentLog = null;
  let requestId = 0;

  more.addEventListener("click", () => {
    const entries = loaded.get(currentLog);
    if (!entries) return;
    const before = pageEntries(entries, pages[currentLog]).shown.length;
    pages[currentLog] += 1;
    const result = drawEntries(currentLog, entries);
    announce(plural("changelog.loaded", result.shown.length));
    if (!result.hasMore) list.querySelectorAll(".pc-log-entry")[before]?.focus();
  });

  function pointEntry(entry, ctx) {
    const target = entry.target ?? {};
    const world = ctx.worlds.find((w) => w.id === target.worldId);
    const dimension = target.type === "spawn" ? "overworld" : target.dimension;
    const where = [world?.name ?? target.worldId, dimension ? t(`dimension.${dimension}`) : null].filter(Boolean).join(" · ");
    let link = changelogLink(entry, ctx);
    if (link.kind === "pending") {
      link = { kind: "point", href: toHref({ ...defaultState(ctx), worldId: target.worldId, dimension: null, pointId: target.id }, ctx) };
    }
    const action = ["add", "edit", "delete"].includes(entry.action) ? entry.action : "edit";
    const linkNode =
      link.kind === "removed"
        ? h("span", { className: "pc-log-entry__deleted", text: t("changelog.deleted") })
        : h(
            "a",
            {
              className: "pc-log-entry__link",
              attrs: { href: link.href },
              on: { click: () => deps.onTargetLink({ type: target.type, worldId: target.worldId }) },
            },
            h("span", { text: t("changelog.view") }),
            icon("arrow-right"),
          );
    return h(
      "li",
      { className: "pc-log-entry pc-log-entry--point", attrs: { tabindex: "-1" } },
      h("span", { className: `pc-action-badge pc-action-badge--${action}`, text: t(`changelog.action.${action}`) }),
      h(
        "div",
        { className: "pc-log-entry__main" },
        h("p", { className: "pc-log-entry__summary", text: pick(entry.summary) }),
        h("div", { className: "pc-log-entry__foot" }, h("span", { className: "pc-log-entry__scope", text: where }), linkNode),
      ),
    );
  }

  function updateEntry(entry) {
    return h(
      "li",
      { className: "pc-log-entry pc-log-entry--update", attrs: { tabindex: "-1" } },
      h("p", { className: "pc-log-entry__summary", text: pick(entry.summary) }),
      h("p", { className: "pc-log-entry__scope", text: t("changelog.scope", { scope: pick(entry.scope) }) }),
    );
  }

  function drawEntries(kind, entries) {
    const ctx = deps.getCtx();
    const result = pageEntries(entries, pages[kind]);
    if (entries.length === 0) {
      replaceChildren(list, h("p", { className: "pc-changelog__empty", text: t("changelog.empty") }));
    } else {
      replaceChildren(
        list,
        groupByDate(result.shown).map((group) =>
          h(
            "section",
            { className: "pc-log-group", attrs: { "aria-label": group.date } },
            h("h2", { className: "pc-log-group__date" }, h("time", { attrs: { datetime: group.date }, text: group.date })),
            h(
              "ul",
              { className: "pc-log-group__list", attrs: { role: "list" } },
              group.entries.map((entry) => (kind === "points" ? pointEntry(entry, ctx) : updateEntry(entry))),
            ),
          ),
        ),
      );
    }
    more.textContent = t("changelog.loadMore");
    more.hidden = !result.hasMore;
    return result;
  }

  async function load(kind) {
    const id = (requestId += 1);
    list.replaceChildren();
    more.hidden = true;
    status.replaceChildren();
    panel.setAttribute("aria-busy", "true");
    const skeletonTimer = setTimeout(() => {
      if (id === requestId) replaceChildren(status, changelogSkeleton(t("app.loading")));
    }, SKELETON_DELAY_MS);
    try {
      const entries = sortChangelogEntries(await deps.loadEntries(kind));
      if (kind === "points") {
        const worldIds = [...new Set(entries.map((entry) => entry.target?.worldId).filter(Boolean))];
        await deps.ensurePoints(worldIds);
      }
      if (id !== requestId) return;
      loaded.set(kind, entries);
      status.replaceChildren();
      drawEntries(kind, entries);
    } catch (error) {
      if (id !== requestId) return;
      renderError(status, { error, titleKey: "changelog.error", discordUrl: deps.getDiscordUrl(), onRetry: () => load(kind) });
    } finally {
      clearTimeout(skeletonTimer);
      if (id === requestId) panel.removeAttribute("aria-busy");
    }
  }

  /** Renders the page for a change log section ("updates" or "points"); texts follow the language. */
  function render(log) {
    title.textContent = t("changelog.title");
    intro.textContent = t("changelog.intro");
    tabs.update(
      [
        { id: "updates", label: t("changelog.tab.updates") },
        { id: "points", label: t("changelog.tab.points") },
      ],
      log,
      t("changelog.tabs"),
    );
    panel.setAttribute("aria-labelledby", tabs.idOf(log));
    const logChanged = log !== currentLog;
    currentLog = log;
    if (loaded.has(log)) drawEntries(log, loaded.get(log));
    else if (logChanged || !panel.hasAttribute("aria-busy")) load(log);
  }

  return { render, focusTitle: () => title.focus(), focusList: () => panel.focus() };
}
