// Application entry: loads dictionaries and data, keeps the view in sync with the hash-backed
// state and wires the UI modules. Start order (architecture 3.8): language, dictionaries, core
// data, hash, points of the current world, render; the change log loads on demand.
// Render pipelines are separate: the world info panel depends on world + language only, the pinned
// spawn card on world + dimension + language, and only the list follows search and tags.
// Worlds with commands: true get a Commands tab after the dimension tabs (view=commands); its data
// loads on first use and its two settings live only in app memory (never in the hash or storage).

import { createRepository } from "./data/repository.js";
import { getLang, initI18n, setLang, t, textLang } from "./i18n.js";
import { DEFAULT_SETTINGS } from "./lib/commands.js";
import { indexTags, matchPoint, sortPoints } from "./lib/filter.js";
import { defaultState, toHref } from "./lib/hash.js";
import { getState, setContext, setState, subscribe, syncFromHash } from "./state.js";
import { createChangelogView } from "./ui/changelog.js";
import { COMMANDS_HEADING_ID, createCommandsPanel } from "./ui/commands-panel.js";
import { closeDialog, initDialog, openSubmitDialog } from "./ui/dialog.js";
import { createTabs } from "./ui/dimension-tabs.js";
import { createScope, h, prefersReducedMotion, replaceChildren } from "./ui/dom.js";
import { renderError } from "./ui/error-view.js";
import { createToolbar } from "./ui/filters.js";
import { announceFilterResult, initLive, resetFilterAnnouncement } from "./ui/live.js";
import { closeOpenMenu } from "./ui/menu.js";
import { buildTagFilters, countByDimension, hasConditions, orderedDimensions, resultSummary } from "./ui/model.js";
import { renderPointList } from "./ui/point-list.js";
import { commandsSkeleton, pointsSkeleton } from "./ui/skeleton.js";
import { renderSpawnCard, SPAWN_TITLE_ID } from "./ui/spawn-card.js";
import { initToast, showToast } from "./ui/toast.js";
import { renderVpn, vpnsForWorld } from "./ui/vpn.js";
import { renderWorldInfo } from "./ui/world-info.js";

const SKELETON_DELAY_MS = 150;
const FILTER_DELAY_MS = 150;
const HASH_DELAY_MS = 300;
const HIGHLIGHT_MS = 2000;

const $ = (id) => document.getElementById(id);
const dom = {
  app: $("pc-app"),
  skip: $("pc-skip"),
  header: $("pc-header"),
  main: $("pc-main"),
  status: $("pc-status"),
  pointsPage: document.querySelector('[data-page="points"]'),
  changelogPage: $("pc-changelog"),
  worldbar: $("pc-worldbar"),
  worldTitle: $("pc-world-title"),
  aside: $("pc-aside"),
  tabsBar: $("pc-tabs-bar"),
  tabpanel: $("pc-tabpanel"),
  pointsView: $("pc-points-view"),
  commandsHost: $("pc-commands-host"),
  toolbarHost: $("pc-toolbar-host"),
  pointsHeading: $("pc-points-heading"),
  pinnedHost: $("pc-pinned-host"),
  cards: $("pc-cards"),
  empty: $("pc-empty"),
  discord: $("pc-discord"),
  footerDiscord: $("pc-footer-discord"),
  minecraftZh: $("pc-minecraft-zh"),
};

const repo = createRepository();
const app = {
  core: null,
  points: {},
  commands: {},
  // Commands tab: raw values of the two settings and the panel's own display state, kept for this visit only.
  commandSettings: { ...DEFAULT_SETTINGS },
  commandsUi: { blockOpen: true, notice: false },
  commandsPanel: null,
  commandsRequest: 0,
  ctx: null,
  ready: false,
  lastPointsState: null,
  lastLog: "updates",
  pendingQuery: null,
  pendingTarget: null,
  vpnExpanded: null,
  keys: { world: "", pinned: "", list: "", commands: "" },
  scopes: { world: createScope(), pinned: createScope(), list: createScope(), commands: createScope() },
  timers: { filter: null, hash: null, highlight: null },
  highlighted: null,
  userFilterChange: false,
};

initLive($("pc-live"));
initToast($("pc-toast"));
initDialog(dom.app);

// ------------------------------------------------------------------ Helpers

const currentWorld = () => app.core?.worlds.find((world) => world.id === getState().worldId) ?? null;
const discordUrl = () => app.core?.config.discordInviteUrl ?? null;
const loadingLabel = () => (textLang("app.loading") ? t("app.loading") : "Loading…");
const COMMANDS_TAB = "commands";
/** True when the Commands tab is shown (hash validation already requires a world with commands: true). */
const isCommandsView = (state) => state.tab === "points" && state.view === COMMANDS_TAB;

/** Text content and attributes of static elements (data-i18n, data-i18n-attr, data-i18n-en). */
function applyStaticText() {
  const lang = getLang();
  for (const el of dom.app.querySelectorAll("[data-i18n]")) {
    const key = el.dataset.i18n;
    el.textContent = t(key);
    const source = textLang(key);
    if (source && source !== lang) el.setAttribute("lang", source);
    else el.removeAttribute("lang");
  }
  for (const el of dom.app.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of el.dataset.i18nAttr.split(";")) {
      const [attr, key] = pair.split(":");
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
  for (const el of dom.app.querySelectorAll("[data-i18n-en]")) el.textContent = t(el.dataset.i18nEn, {}, "en");
  // Minecraft notice: the English original is always shown; the zh-TW interface adds the translation.
  const zh = lang === "zh-TW";
  dom.minecraftZh.hidden = !zh;
  dom.minecraftZh.textContent = zh ? t("footer.minecraftNotice") : "";
  for (const button of dom.app.querySelectorAll(".pc-lang__btn")) {
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
    button.setAttribute("aria-label", t("lang.switch", {}, button.dataset.lang));
  }
}

function setDiscordLinks() {
  const url = discordUrl();
  if (!url) return;
  dom.discord.href = url;
  dom.footerDiscord.href = url;
}

function pointsHref(state) {
  const base = state.tab === "points" ? state : (app.lastPointsState ?? defaultState(app.ctx));
  return toHref({ ...base, tab: "points", pointId: null }, app.ctx);
}

function updateHeader(state) {
  if (!app.ctx) return;
  const hrefs = {
    points: pointsHref(state),
    changelog: toHref({ ...defaultState(app.ctx), tab: "changelog", log: state.tab === "changelog" ? state.log : app.lastLog }, app.ctx),
  };
  for (const link of dom.app.querySelectorAll("[data-page-link]")) {
    const page = link.dataset.pageLink;
    link.setAttribute("href", hrefs[page]);
    if (link.classList.contains("pc-pagenav__link")) {
      if (page === state.tab) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
  }
  dom.skip.textContent = state.tab === "changelog" ? t("skip.changelog") : isCommandsView(state) ? t("skip.commands") : t("skip.points");
}

function updateTitle(state) {
  const site = t("site.name");
  if (state.tab === "changelog") {
    document.title = t("title.changelog", { site });
    return;
  }
  const world = currentWorld();
  if (world && isCommandsView(state)) {
    document.title = t("title.commands", { world: world.name, site });
    return;
  }
  document.title = world ? t("title.points", { world: world.name, dimension: t(`dimension.${state.dimension}`), site }) : site;
}

function showPage(tab) {
  dom.pointsPage.hidden = tab !== "points";
  dom.changelogPage.hidden = tab !== "changelog";
}

function showSkeleton() {
  replaceChildren(dom.status, pointsSkeleton(loadingLabel()));
}

function setBusy(busy) {
  if (busy) dom.main.setAttribute("aria-busy", "true");
  else dom.main.removeAttribute("aria-busy");
}

// ------------------------------------------------------------------ Coordinates page

const dimensionTabs = createTabs({
  idPrefix: "pc-dim-tab",
  panelId: "pc-tabpanel",
  onSelect: (id) => {
    flushQuery();
    if (id === COMMANDS_TAB) setState({ view: COMMANDS_TAB }, { history: "push" });
    else setState({ dimension: id, view: null }, { history: "push" });
  },
});
dom.tabsBar.append(dimensionTabs.el);

const toolbar = createToolbar({
  onInput: (value) => {
    app.pendingQuery = value;
    clearTimeout(app.timers.filter);
    clearTimeout(app.timers.hash);
    app.timers.filter = setTimeout(() => {
      app.userFilterChange = true;
      renderPoints(getState());
    }, FILTER_DELAY_MS);
    app.timers.hash = setTimeout(flushQuery, HASH_DELAY_MS);
  },
  onClearQuery: () => {
    cancelPendingQuery();
    toolbar.resetQuery({ focus: true });
    app.userFilterChange = true;
    if (!setState({ query: "" }, { history: "replace" })) renderPoints(getState());
  },
  onToggleTag: (tagId) => {
    flushQuery();
    const { tagIds } = getState();
    const next = tagIds.includes(tagId) ? tagIds.filter((id) => id !== tagId) : [...tagIds, tagId];
    app.userFilterChange = true;
    setState({ tagIds: next }, { history: "replace" });
  },
  onClearAll: clearAll,
  onSubmit: (opener) => {
    const world = currentWorld();
    if (world) openSubmitDialog({ kind: "add", config: app.core.config, world, opener });
  },
});
dom.toolbarHost.append(toolbar.el);

function cancelPendingQuery() {
  clearTimeout(app.timers.filter);
  clearTimeout(app.timers.hash);
  app.pendingQuery = null;
}

/** Commits a pending search to the state (and the hash with replaceState). */
function flushQuery() {
  if (app.pendingQuery === null) return;
  const query = app.pendingQuery;
  cancelPendingQuery();
  app.userFilterChange = true;
  if (!setState({ query }, { history: "replace" })) renderPoints(getState());
}

function clearAll() {
  cancelPendingQuery();
  toolbar.resetQuery({ focus: true });
  app.userFilterChange = true;
  if (!setState({ query: "", tagIds: [] }, { history: "replace" })) renderPoints(getState());
}

function renderWorldSection(world, state) {
  const key = `${world.id}|${state.lang}|${app.core.worlds.length}`;
  if (key === app.keys.world) return;
  app.keys.world = key;
  app.scopes.world.dispose();

  dom.worldTitle.textContent = world.name;
  dom.worldbar.querySelector(".pc-worldswitch")?.remove();
  if (app.core.worlds.length > 1) {
    const select = h(
      "select",
      { className: "pc-select", attrs: { id: "pc-world-select" }, on: { change: (event) => setState({ worldId: event.target.value }, { history: "push" }) } },
      app.core.worlds.map((w) => h("option", { attrs: { value: w.id, selected: w.id === world.id }, text: w.name })),
    );
    select.value = world.id;
    dom.worldbar.append(
      h("div", { className: "pc-worldswitch" }, h("label", { className: "pc-worldswitch__label", attrs: { for: "pc-world-select" }, text: t("world.switch") }), select),
    );
  }

  const blocks = [renderWorldInfo(world, { scope: app.scopes.world })];
  // The breakpoint decides only on first render; afterwards the visitor's choice is kept.
  app.vpnExpanded ??= globalThis.matchMedia?.("(min-width: 1024px)").matches ?? false;
  const expanded = app.vpnExpanded;
  for (const vpn of vpnsForWorld(app.core.vpns, world.id)) {
    blocks.push(
      renderVpn(vpn, {
        scope: app.scopes.world,
        discordUrl: discordUrl(),
        expanded,
        onToggle: (next) => {
          app.vpnExpanded = next;
        },
      }),
    );
  }
  replaceChildren(dom.aside, blocks);
}

function renderPinned(world, state) {
  const key = `${world.id}|${state.dimension}|${state.lang}`;
  if (key === app.keys.pinned) return;
  app.keys.pinned = key;
  app.scopes.pinned.dispose();
  const section = renderSpawnCard(world, state.dimension, {
    scope: app.scopes.pinned,
    onRequestSpawn: (opener) => openSubmitDialog({ kind: "spawn", config: app.core.config, world, dimensionName: t("dimension.overworld"), opener }),
  });
  replaceChildren(dom.pinnedHost, section);
}

function renderPoints(state) {
  const world = currentWorld();
  if (!world) return;
  const { config, tags, tagGroups } = app.core;
  const query = app.pendingQuery ?? state.query;
  const allPoints = app.points[world.id] ?? [];
  const tagsById = indexTags(tags);
  const dimensions = orderedDimensions(world);

  renderWorldSection(world, state);

  // Dimension badges keep counting with the kept search and tags, also while the Commands tab is shown.
  const counts = countByDimension(allPoints, dimensions, query, tagsById);
  const tabs = dimensions.map((dim) => ({ id: dim, label: t(`dimension.${dim}`), shortLabel: t(`dimension.${dim}.short`), count: counts[dim] }));
  if (world.commands === true) tabs.push({ id: COMMANDS_TAB, label: t("commands.tab"), shortLabel: t("commands.tab.short"), count: null });
  const commandsView = isCommandsView(state) && world.commands === true;
  const selectedTab = commandsView ? COMMANDS_TAB : state.dimension;
  dimensionTabs.update(tabs, selectedTab, world.commands === true ? t("commands.tablist") : t("dimension.label"));
  dom.tabpanel.setAttribute("aria-labelledby", dimensionTabs.idOf(selectedTab));

  // The two views switch as whole containers; the list keeps its own render cache meanwhile.
  dom.pointsView.hidden = commandsView;
  dom.commandsHost.hidden = !commandsView;
  if (commandsView) {
    app.userFilterChange = false;
    renderCommands(world, state);
    return;
  }
  renderPinned(world, state);

  const inDimension = allPoints.filter((point) => point.dimension === state.dimension);
  const shown = sortPoints(inDimension.filter((point) => matchPoint(point, { query, tagIds: state.tagIds }, tagsById)));
  const filtered = hasConditions({ query, tagIds: state.tagIds });
  const summaryText = toolbar.update({
    query,
    filters: buildTagFilters({ tags, groups: tagGroups, points: allPoints, dimension: state.dimension, edition: world.edition, selected: state.tagIds }),
    hasPoints: inDimension.length > 0,
    showSummary: true,
    showClearAll: filtered && shown.length > 0,
    summary: resultSummary({ shown: shown.length, total: inDimension.length, filtered }),
  });

  const listKey = [world.id, state.dimension, query, state.tagIds.join(","), state.lang, allPoints.length].join("|");
  if (listKey !== app.keys.list) {
    app.keys.list = listKey;
    closeOpenMenu();
    app.scopes.list.dispose();
    renderPointList(
      { list: dom.cards, empty: dom.empty },
      {
        points: shown,
        total: inDimension.length,
        query,
        tagIds: state.tagIds,
        onClearAll: clearAll,
        cardCtx: {
          tags,
          tagsById,
          selectedTagIds: state.tagIds,
          timeZone: config.changelogTimeZone,
          scope: app.scopes.list,
          onRequest: (kind, point, opener) =>
            openSubmitDialog({ kind, config, world, point, dimensionName: t(`dimension.${point.dimension}`), opener }),
        },
      },
    );
  }
  if (app.userFilterChange) {
    app.userFilterChange = false;
    announceFilterResult(summaryText);
  }
}

// ------------------------------------------------------------------ Commands tab

/** Builds the panel once per world and language; settings changes update it in place. */
function renderCommands(world, state) {
  const commands = app.commands[world.id];
  if (!commands) return; // the loading skeleton or the error panel stays in the host
  const key = `${world.id}|${state.lang}`;
  if (key === app.keys.commands) return;
  app.keys.commands = key;
  // A rebuild (language change) keeps focus on the same control when it has an id.
  const focusedId = dom.commandsHost.contains(document.activeElement) ? document.activeElement.id : "";
  app.scopes.commands.dispose();
  app.commandsPanel = createCommandsPanel({
    commands,
    settings: app.commandSettings,
    ui: app.commandsUi,
    scope: app.scopes.commands,
    onSettingsChange: (raw) => {
      app.commandSettings = raw;
    },
  });
  replaceChildren(dom.commandsHost, app.commandsPanel.el);
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
}

/** Loads a world's commands (cached by the repository); the skeleton appears after 150 ms. */
async function loadWorldCommands(worldId) {
  if (app.commands[worldId]) return true;
  const request = (app.commandsRequest += 1);
  app.keys.commands = "";
  const timer = setTimeout(() => {
    if (request !== app.commandsRequest) return;
    replaceChildren(dom.commandsHost, commandsSkeleton(loadingLabel()));
    dom.tabpanel.setAttribute("aria-busy", "true");
  }, SKELETON_DELAY_MS);
  try {
    app.commands[worldId] = await repo.loadCommands(worldId);
    return true;
  } catch (error) {
    // An older request that failed must not replace the view of a newer one.
    if (request === app.commandsRequest) {
      app.keys.commands = "";
      renderError(dom.commandsHost, {
        error,
        discordUrl: discordUrl(),
        titleKey: "commands.error",
        onRetry: async () => {
          if (!(await loadWorldCommands(worldId))) return;
          render(getState());
          app.commandsPanel?.focusTitle();
        },
      });
    }
    return false;
  } finally {
    clearTimeout(timer);
    if (request === app.commandsRequest) dom.tabpanel.removeAttribute("aria-busy");
  }
}

/** After a render: loads the current world's commands when the Commands tab needs them, then renders again. */
async function ensureCommandsView() {
  const state = getState();
  if (!isCommandsView(state) || app.commands[state.worldId]) return;
  const worldId = state.worldId;
  await loadWorldCommands(worldId);
  const now = getState();
  if (isCommandsView(now) && now.worldId === worldId) render(now);
}

// ------------------------------------------------------------------ Change log page

const changelog = createChangelogView(dom.changelogPage, {
  onSelectLog: (log) => setState({ log }, { history: "push" }),
  loadEntries: (kind) => repo.loadChangelog(kind),
  ensurePoints: async (worldIds) => {
    const known = worldIds.filter((id) => app.core.worlds.some((world) => world.id === id));
    await Promise.allSettled(known.map((id) => ensurePoints(id)));
    setContext(app.ctx);
  },
  getCtx: () => app.ctx,
  onTargetLink: (target) => {
    app.pendingTarget = target;
  },
  getDiscordUrl: discordUrl,
});

// ------------------------------------------------------------------ Deep links

function clearHighlight() {
  clearTimeout(app.timers.highlight);
  app.highlighted?.classList.remove("is-target");
  app.highlighted = null;
}

/** Scrolls to the card of #point=<id> (or the pinned spawn card after a change log link), focuses its title and highlights it for 2 s. */
function handleDeepLink() {
  const state = getState();
  const pending = app.pendingTarget;
  app.pendingTarget = null;
  if (state.tab !== "points") return;
  let card = null;
  if (state.pointId) card = dom.cards.querySelector(`[data-point-id="${state.pointId}"]`);
  else if (pending?.type === "spawn" && pending.worldId === state.worldId) card = document.getElementById(SPAWN_TITLE_ID)?.closest(".pc-card") ?? null;
  if (card) {
    clearHighlight();
    card.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    card.querySelector("h3")?.focus({ preventScroll: true });
    card.classList.add("is-target");
    app.highlighted = card;
    app.timers.highlight = setTimeout(clearHighlight, HIGHLIGHT_MS);
  }
  if (state.pointId) setState({ pointId: null }, { history: "replace" });
}

function toastNotFound(dropped) {
  if (dropped?.some((item) => item.key === "point" && item.reason === "notFound")) showToast(t("toast.pointNotFound"));
}

// ------------------------------------------------------------------ Rendering

function render(state, changed = null) {
  const tabChanged = changed?.includes("tab");
  const viewChanged = !tabChanged && state.tab === "points" && changed?.includes("view");
  updateHeader(state);
  showPage(state.tab);
  if (state.tab === "points") {
    app.lastPointsState = state;
    renderPoints(state);
  } else {
    app.lastLog = state.log;
    changelog.render(state.log);
  }
  updateTitle(state);
  if (tabChanged) {
    resetFilterAnnouncement();
    globalThis.scrollTo({ top: 0, behavior: "auto" });
    if (state.tab === "points") dom.worldTitle.focus({ preventScroll: true });
    else changelog.focusTitle();
  }
  // Switching to or from the Commands tab far down a long list: show the top of the panel.
  if (viewChanged && dom.tabpanel.getBoundingClientRect().top < dom.tabsBar.getBoundingClientRect().bottom) {
    dom.tabpanel.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
}

async function ensurePoints(worldId) {
  if (!app.points[worldId]) app.points[worldId] = await repo.loadPoints(worldId);
  return app.points[worldId];
}

async function onStateChange(state, _prev, meta) {
  if (!app.ready) return;
  if (meta.changed.includes("lang")) {
    closeDialog();
    closeOpenMenu();
    applyStaticText();
  }
  if (state.tab === "points" && !app.points[state.worldId]) {
    const ok = await loadWorldPoints(state.worldId);
    if (!ok) return;
    toastNotFound(syncFromHash().dropped);
  }
  render(getState(), meta.changed);
  handleDeepLink();
  await ensureCommandsView();
}

// ------------------------------------------------------------------ Loading and errors

/** Core data or dictionaries failed: built-in English text only, no Discord link. */
function failCore(error) {
  setBusy(false);
  showPage(null);
  renderError(dom.status, { error, fallbackOnly: true, onRetry: () => boot({ retry: true }) });
}

async function loadWorldPoints(worldId) {
  const timer = setTimeout(showSkeleton, SKELETON_DELAY_MS);
  setBusy(true);
  try {
    await ensurePoints(worldId);
    return true;
  } catch (error) {
    showPage(null);
    renderError(dom.status, {
      error,
      discordUrl: discordUrl(),
      onRetry: async () => {
        if (await loadWorldPoints(worldId)) {
          toastNotFound(syncFromHash().dropped);
          render(getState());
          handleDeepLink();
          dom.worldTitle.focus();
        }
      },
    });
    return false;
  } finally {
    clearTimeout(timer);
    setBusy(false);
    if (app.points[worldId]) dom.status.replaceChildren();
  }
}

async function boot({ retry = false } = {}) {
  setBusy(true);
  const timer = setTimeout(showSkeleton, SKELETON_DELAY_MS);
  try {
    const lang = await initI18n();
    applyStaticText();
    setState({ lang }, { history: "none" });
    app.core = await repo.loadCore();
  } catch (error) {
    clearTimeout(timer);
    failCore(error);
    return;
  }
  clearTimeout(timer);
  setDiscordLinks();
  app.ctx = { config: app.core.config, worlds: app.core.worlds, tags: app.core.tags, points: app.points };
  setContext(app.ctx);
  let { dropped } = syncFromHash();
  if (!app.ready) {
    // From here on the state drives the view (hash changes, back / forward, user actions).
    app.ready = true;
    subscribe(onStateChange);
    // Back / forward and edited hashes. Parameters that were dropped (for example a point that no
    // longer exists) are reported even when the state itself does not change.
    const onHash = () => toastNotFound(syncFromHash().dropped);
    globalThis.addEventListener("popstate", onHash);
    globalThis.addEventListener("hashchange", onHash);
  }
  let state = getState();
  if (state.tab === "points") {
    if (!(await loadWorldPoints(state.worldId))) return;
    dropped = syncFromHash().dropped;
    state = getState();
  }
  dom.status.replaceChildren();
  setBusy(false);
  toastNotFound(dropped);
  render(state);
  handleDeepLink();
  await ensureCommandsView();
  if (retry) (state.tab === "points" ? dom.worldTitle : dom.changelogPage.querySelector("h1"))?.focus();
}

// ------------------------------------------------------------------ Global controls

for (const button of dom.app.querySelectorAll(".pc-lang__btn")) {
  button.addEventListener("click", async () => {
    const lang = button.dataset.lang;
    if (lang === getLang()) return;
    try {
      await setLang(lang);
    } catch {
      return;
    }
    applyStaticText();
    if (app.ready) setState({ lang }, { history: "none" });
    // On phones the pressed button is hidden; keep focus on the visible one.
    if (button.offsetParent === null) dom.app.querySelector(`.pc-lang__btn[data-lang="${lang === "en" ? "zh-TW" : "en"}"]`)?.focus();
  });
}

dom.skip.addEventListener("click", () => {
  const state = getState();
  if (state.tab === "changelog") changelog.focusList();
  else if (isCommandsView(state)) (document.getElementById(COMMANDS_HEADING_ID) ?? dom.commandsHost.querySelector("button"))?.focus();
  else dom.pointsHeading.focus();
});

// Header border after scrolling and the stuck state of the dimension tabs: IntersectionObserver
// on sentinel elements (no scroll listeners).
function observeSentinels() {
  if (typeof IntersectionObserver !== "function") return;
  const top = dom.app.querySelector('[data-sentinel="top"]');
  new IntersectionObserver(([entry]) => dom.header.classList.toggle("is-scrolled", !entry.isIntersecting)).observe(top);

  const tabsSentinel = dom.app.querySelector('[data-sentinel="tabs"]');
  let observer = null;
  const watchTabs = () => {
    observer?.disconnect();
    const headerHeight = dom.header.getBoundingClientRect().height || 56;
    observer = new IntersectionObserver(
      ([entry]) => dom.tabsBar.classList.toggle("is-stuck", !entry.isIntersecting && entry.boundingClientRect.top < headerHeight + 1),
      { rootMargin: `-${Math.round(headerHeight) + 1}px 0px 0px 0px` },
    );
    observer.observe(tabsSentinel);
  };
  watchTabs();
  globalThis.matchMedia?.("(min-width: 768px)").addEventListener?.("change", watchTabs);
}

observeSentinels();
boot();
