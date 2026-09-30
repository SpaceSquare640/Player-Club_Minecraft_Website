// Approved request writer (scripts/apply-requests.mjs): approval and snapshot checks, applyRequest,
// the scan / commit / push loop (idempotence, retries) and the report after the deployment.
// GitHub, git and files are in-memory stand-ins; nothing touches the disk or the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRANCH,
  MAX_PUSH_RETRIES,
  applyRequest,
  checkSnapshot,
  dryRun,
  findApproval,
  isApprover,
  parseResults,
  report,
  run,
  siteLink,
  subjectText,
} from "../../scripts/apply-requests.mjs";
import { BOT_IDENTITY, parseRequestLog, requestIssueNumbers, requestLogFormat } from "../../scripts/lib/git.mjs";
import { evaluateRequest } from "../../scripts/lib/issue-parse.mjs";
import { stringifyJson } from "../../scripts/lib/json-io.mjs";
import { I18N_DIR, POINTS_DIR, listDataFiles, loadDataset } from "../../scripts/lib/load-data.mjs";
import { RESULT_MARKER } from "../../scripts/lib/messages.mjs";
import { findInternalText } from "../../scripts/lib/public-text-guard.mjs";
import { REPORT_MARKER, formatSnapshotMarker, parseSnapshotMarker, snapshotHash } from "../../scripts/lib/snapshot.mjs";
import { validateDataset } from "../../scripts/validate.mjs";
import { LABELS, TYPE_LABELS } from "../../site/js/lib/forms-meta.js";
import { NOW, createDataset } from "../fixtures/dataset.mjs";
import { ADD_VALUES, createIssue } from "../fixtures/issues.mjs";
import { memoryReader } from "../fixtures/memory.mjs";

const BOT = { login: "github-actions[bot]", type: "Bot" };
const REPO = { owner: "SpaceSquare640", repo: "Player-Club_Minecraft_Website" };
const ROOT = path.resolve("/repo");
const REPORT_AT = "2026-09-29T12:00:00Z";
const APPROVED_AT = "2026-09-29T12:05:00Z";
const LATER = "2026-09-29T13:00:00Z";

// ------------------------------------------------------------------ Stand-ins

/** Data files as canonical text, the way they are stored in the repository. */
const toFiles = (dataset) => new Map(listDataFiles(dataset).map((f) => [f.path, stringifyJson(f.data, f.schema)]));

/**
 * Repository stand-in: a remote branch and a working tree (text maps), local commits with trailers.
 * rejectPushes: number of pushes rejected as not a fast-forward; onReject(state) runs on each rejection
 * (for example to move the remote branch on).
 */
function createRepo(dataset, { rejectPushes = 0, onReject = null, trailers = [] } = {}) {
  const state = { remote: toFiles(dataset), local: null, remoteTrailers: new Set(trailers), localCommits: [], pushed: [], resets: 0, rejectPushes, writes: [] };
  state.local = new Map(state.remote);
  const reader = {
    async read(rel) {
      return state.local.get(rel) ?? null;
    },
    async list(dir) {
      const names = [...state.local.keys()].filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1));
      if (dir === POINTS_DIR) return names;
      if (dir === I18N_DIR) return names.length > 0 ? names : null;
      return null;
    },
  };
  const io = {
    async write(abs, text) {
      const rel = path.relative(ROOT, abs).split(path.sep).join("/");
      state.writes.push(rel);
      state.local.set(rel, text);
    },
  };
  const git = {
    async requestIssueNumbers() {
      return new Set([...state.remoteTrailers, ...state.localCommits.map((c) => c.issue)]);
    },
    async commitFiles(root, { paths, subject, trailer }) {
      assert.equal(root, ROOT);
      state.localCommits.push({ paths, subject, trailer, issue: Number(/#(\d+)$/.exec(trailer)[1]) });
      return "c".repeat(40);
    },
    async pushHead(root, branch) {
      assert.equal(branch, BRANCH);
      if (state.rejectPushes > 0) {
        state.rejectPushes -= 1;
        onReject?.(state);
        return { pushed: false };
      }
      state.remote = new Map(state.local);
      for (const c of state.localCommits) state.remoteTrailers.add(c.issue);
      state.pushed.push(...state.localCommits);
      state.localCommits = [];
      return { pushed: true };
    },
    async resetToRemote(root, branch) {
      assert.equal(branch, BRANCH);
      state.local = new Map(state.remote);
      state.localCommits = [];
      state.resets += 1;
    },
    async headCommit() {
      return "f".repeat(40);
    },
  };
  const remoteData = async () => (await loadDataset({ read: async (rel) => state.remote.get(rel) ?? null, list: reader.list })).dataset;
  return { state, reader, io, git, remoteData };
}

/** An approved request: the Issue, a trusted pass report with the snapshot hash, and the labeled events. */
function approvedEntry(dataset, kind, values, { number, approver = "SpaceSquare640", reportAt = REPORT_AT, approvedAt = APPROVED_AT, status, hash, login } = {}) {
  const issue = createIssue(kind, values, { number, login, labels: [LABELS.coordRequest, TYPE_LABELS[kind], LABELS.pendingReview, LABELS.approved] });
  const result = evaluateRequest({ dataset, issue });
  const marker = formatSnapshotMarker({ status: status ?? (result.ok ? "pass" : "fail"), hash: hash ?? snapshotHash(result.request) });
  return {
    issue,
    comments: [{ id: number * 10, user: BOT, body: `${REPORT_MARKER}\nreport\n${marker}`, created_at: reportAt, updated_at: reportAt }],
    events: [
      { event: "labeled", label: { name: TYPE_LABELS[kind] }, actor: { login: issue.user.login }, created_at: "2026-09-29T11:00:00Z" },
      { event: "labeled", label: { name: LABELS.approved }, actor: { login: approver }, created_at: approvedAt },
    ],
  };
}

/** Octokit stand-in over Issues with labels, comments and events; records every call. */
function fakeGithub(entries = []) {
  const calls = [];
  const issues = new Map(
    entries.map((e) => [e.issue.number, { issue: e.issue, labels: new Set(e.issue.labels.map((l) => l.name)), comments: e.comments.map((c) => ({ ...c })), events: e.events, state: "open" }]),
  );
  let nextId = 1000;
  const get = (n) => issues.get(n);
  const api = {
    async listForRepo(p) {
      calls.push(["listForRepo", p.state, p.labels]);
      const wanted = p.labels.split(",");
      const open = [...issues.values()].filter((s) => s.state === p.state && wanted.every((l) => s.labels.has(l)));
      return { data: open.map((s) => ({ ...s.issue, labels: [...s.labels].map((name) => ({ name })) })) };
    },
    async listEvents(p) {
      return { data: get(p.issue_number).events };
    },
    async listComments(p) {
      return { data: get(p.issue_number).comments };
    },
    async createComment(p) {
      const comment = { id: nextId++, user: BOT, body: p.body, created_at: LATER, updated_at: LATER };
      get(p.issue_number).comments.push(comment);
      calls.push(["createComment", p.issue_number]);
      return { data: comment };
    },
    async updateComment(p) {
      for (const [n, s] of issues) {
        const comment = s.comments.find((c) => c.id === p.comment_id);
        if (!comment) continue;
        Object.assign(comment, { body: p.body, updated_at: LATER });
        calls.push(["updateComment", n]);
      }
      return { data: {} };
    },
    async addLabels(p) {
      p.labels.forEach((l) => get(p.issue_number).labels.add(l));
      calls.push(["addLabels", p.issue_number, ...p.labels]);
    },
    async removeLabel(p) {
      calls.push(["removeLabel", p.issue_number, p.name]);
      if (!get(p.issue_number).labels.delete(p.name)) throw Object.assign(new Error("Label does not exist"), { status: 404 });
    },
    async update(p) {
      Object.assign(get(p.issue_number), { state: p.state, stateReason: p.state_reason });
      calls.push(["update", p.issue_number, p.state, p.state_reason]);
    },
  };
  return {
    calls,
    get,
    mutations: () => calls.filter(([name]) => name !== "listForRepo"),
    github: { rest: { issues: api }, paginate: async (fn, params) => (await fn(params)).data },
  };
}

async function runApply({ dataset = createDataset(), entries = [], repoOptions = {} } = {}) {
  const repo = createRepo(dataset, repoOptions);
  const gh = fakeGithub(entries);
  const outputs = {};
  const infos = [];
  const core = { info: (m) => infos.push(m), setOutput: (k, v) => (outputs[k] = v) };
  const outcome = await run({ github: gh.github, context: { repo: REPO }, core, root: ROOT, reader: repo.reader, io: repo.io, git: repo.git, now: () => new Date(NOW) });
  return { outcome, outputs, infos, gh, repo };
}

const EDIT = (values) => ({ target_id: "p0001", ...values });
const lastComment = (gh, n) => gh.get(n).comments.at(-1).body;

// ------------------------------------------------------------------ Pure checks

test("findApproval: the last approved label event wins; other labels are ignored", () => {
  const events = [
    { event: "labeled", label: { name: "approved" }, actor: { login: "SpaceSquare640" }, created_at: "2026-09-29T12:00:00Z" },
    { event: "unlabeled", label: { name: "approved" }, actor: { login: "SpaceSquare640" }, created_at: "2026-09-29T12:01:00Z" },
    { event: "labeled", label: { name: "needs-fix" }, actor: { login: "x" }, created_at: "2026-09-29T12:03:00Z" },
    { event: "labeled", label: { name: "approved" }, actor: { login: "friend-01" }, created_at: "2026-09-29T12:02:00Z" },
    { event: "labeled", label: { name: "approved" }, actor: { login: "friend-02" }, created_at: "2026-09-29T12:02:00Z" },
    { event: "labeled", label: { name: "approved" }, actor: { login: "x" }, created_at: "not a date" },
  ];
  assert.deepEqual(findApproval(events), { login: "friend-02", at: Date.parse("2026-09-29T12:02:00Z"), createdAt: "2026-09-29T12:02:00Z" });
  assert.equal(findApproval([]), null);
  assert.equal(findApproval([{ event: "labeled", label: { name: "approved" }, actor: null, created_at: REPORT_AT }]).login, null);
});

test("isApprover compares logins without case and rejects everything else", () => {
  assert.equal(isApprover("SpaceSquare640", ["SpaceSquare640"]), true);
  assert.equal(isApprover("spacesquare640", ["SpaceSquare640"]), true);
  assert.equal(isApprover("SPACESQUARE640", ["spacesquare640"]), true);
  for (const login of ["friend-01", "", null, undefined, "SpaceSquare6400"]) assert.equal(isApprover(login, ["SpaceSquare640"]), false, String(login));
  assert.equal(isApprover("SpaceSquare640", []), false);
});

test("checkSnapshot: pass report, approval strictly after the report, same hash", () => {
  const hash = "a".repeat(64);
  const reportOf = (status, at = REPORT_AT, h = hash) => ({ body: `${REPORT_MARKER}\nx\n${formatSnapshotMarker({ status, hash: h })}`, created_at: "2026-09-29T11:00:00Z", updated_at: at });
  const approval = (at) => ({ login: "SpaceSquare640", at: Date.parse(at) });
  assert.deepEqual(checkSnapshot({ approval: approval(APPROVED_AT), report: reportOf("pass"), hash }), { ok: true, reason: "" });
  assert.equal(checkSnapshot({ approval: approval(APPROVED_AT), report: null, hash }).reason, "noReport");
  assert.equal(checkSnapshot({ approval: approval(APPROVED_AT), report: { body: `${REPORT_MARKER}\nno marker`, updated_at: REPORT_AT }, hash }).reason, "noReport");
  assert.equal(checkSnapshot({ approval: approval(APPROVED_AT), report: reportOf("fail"), hash }).reason, "reportFailed");
  assert.equal(checkSnapshot({ approval: approval("2026-09-29T11:59:59Z"), report: reportOf("pass"), hash }).reason, "approvedBeforeReport");
  assert.equal(checkSnapshot({ approval: approval(REPORT_AT), report: reportOf("pass"), hash }).reason, "approvedBeforeReport", "same second is not later");
  assert.equal(checkSnapshot({ approval: null, report: reportOf("pass"), hash }).reason, "approvedBeforeReport");
  assert.equal(checkSnapshot({ approval: approval(APPROVED_AT), report: reportOf("pass", REPORT_AT, "b".repeat(64)), hash }).reason, "hashMismatch");
});

test("the snapshot hash changes when the world spawn changes after validation", () => {
  const dataset = createDataset();
  const issue = createIssue("spawn", { target_id: "spawn:player_club", x: "8", y: "100", z: "6" });
  const before = snapshotHash(evaluateRequest({ dataset, issue }).request);
  dataset.worlds.worlds[0].spawn = { x: 7, y: 104, z: 5 };
  const after = snapshotHash(evaluateRequest({ dataset, issue }).request);
  assert.notEqual(after, before);
  // The same holds for edits: the target's updatedAt is part of the hash.
  const edit = createIssue("edit", EDIT({ name: "Village One" }));
  const editBefore = snapshotHash(evaluateRequest({ dataset, issue: edit }).request);
  dataset.points.player_club.points[0].updatedAt = "2026-09-29T11:00:00Z";
  assert.notEqual(snapshotHash(evaluateRequest({ dataset, issue: edit }).request), editBefore);
});

// ------------------------------------------------------------------ applyRequest

function applyValid(kind, values, { dataset = createDataset(), now = NOW, number = 12, login } = {}) {
  const result = evaluateRequest({ dataset, issue: createIssue(kind, values, { number, login }) });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return { dataset, result, applied: applyRequest({ dataset, result, issueNumber: number, now }) };
}

test("applyRequest add: next point id, timestamps, bilingual change entry, sequences; the input is not changed", () => {
  const { dataset, applied } = applyValid("add", { ...ADD_VALUES, note: "" });
  assert.equal(applied.ok, true);
  assert.equal(applied.pointId, "p0003");
  const point = applied.dataset.points.player_club.points.at(-1);
  assert.deepEqual(point, {
    id: "p0003",
    dimension: "overworld",
    name: "My Base",
    tags: ["base"],
    x: 100,
    y: 64,
    z: -200,
    submittedBy: "friend-01",
    createdAt: "2026-09-29T12:00:00Z",
    updatedAt: "2026-09-29T12:00:00Z",
  });
  assert.ok(!Object.hasOwn(point, "note"), "an empty note is left out");
  assert.deepEqual(applied.entry, {
    id: "c0003",
    date: "2026-09-29",
    action: "add",
    target: { type: "point", worldId: "player_club", id: "p0003", dimension: "overworld", name: "My Base" },
    summary: { en: "Added point: My Base", "zh-TW": "新增座標：My Base" },
    scope: { en: "Point data: Player_Club / Overworld", "zh-TW": "座標資料：Player_Club／主世界" },
    source: { type: "issue", issue: 12 },
  });
  assert.deepEqual(applied.dataset.manifest, { schemaVersion: 1, pointSeq: 3, changeSeq: 3, updateSeq: 1 });
  assert.equal(applied.subject, "chore(data): add point p0003 My Base");
  assert.deepEqual(applied.files.map((f) => f.path), ["site/data/points/player_club.json", "site/data/changelog/points.json", "site/data/manifest.json"]);
  assert.equal(dataset.points.player_club.points.length, 2, "the input data set is unchanged");
  assert.deepEqual(validateDataset(applied.dataset, { now: NOW }).errors, []);
});

test("applyRequest: change log dates follow Asia/Taipei and ids are never reused", () => {
  const { applied } = applyValid("add", ADD_VALUES, { now: new Date("2026-09-29T16:30:00Z") });
  assert.equal(applied.entry.date, "2026-09-30");
  const dataset = createDataset();
  dataset.manifest.pointSeq = 9; // p0003..p0009 were used by deleted points
  dataset.manifest.changeSeq = 20;
  const next = applyValid("add", ADD_VALUES, { dataset }).applied;
  assert.equal(next.pointId, "p0010");
  assert.equal(next.entry.id, "c0021");
});

test("applyRequest edit: reviewed values, fresh updatedAt, changed fields; '-' clears the note", () => {
  const { applied } = applyValid("edit", { target_id: "p0002", name: "Fortress East", x: "-60", note: "-" });
  const point = applied.dataset.points.player_club.points.find((p) => p.id === "p0002");
  assert.equal(point.name, "Fortress East");
  assert.equal(point.x, -60);
  assert.equal(point.createdAt, "2026-09-28T23:10:00Z");
  assert.equal(point.updatedAt, "2026-09-29T12:00:00Z");
  assert.ok(!Object.hasOwn(point, "note"));
  assert.deepEqual(applied.entry.changedFields, ["name", "x", "note"]);
  assert.deepEqual(applied.entry.summary, { en: "Updated point: Fortress East (name, coordinates, note)", "zh-TW": "修改座標：Fortress East（名稱、座標、說明）" });
  assert.equal(applied.dataset.manifest.pointSeq, 2, "edits do not use point ids");
  assert.deepEqual(validateDataset(applied.dataset, { now: NOW }).errors, []);
});

test("applyRequest delete: the point is removed and the entry keeps its last name and dimension", () => {
  const { applied } = applyValid("delete", { target_id: "p0002" });
  assert.deepEqual(applied.dataset.points.player_club.points.map((p) => p.id), ["p0001"]);
  assert.deepEqual(applied.entry.target, { type: "point", worldId: "player_club", id: "p0002", dimension: "the_nether", name: "Fortress" });
  assert.equal(applied.entry.action, "delete");
  assert.equal(applied.subject, "chore(data): remove point p0002 Fortress");
  assert.deepEqual(validateDataset(applied.dataset, { now: NOW }).errors, []);
});

test("applyRequest spawn: only world.spawn changes; one spawn entry; point ids untouched", () => {
  const { dataset, applied } = applyValid("spawn", { target_id: "spawn:player_club", x: "8", y: "100", z: "5" });
  const world = applied.dataset.worlds.worlds[0];
  assert.deepEqual(world.spawn, { x: 8, y: 100, z: 5 });
  assert.deepEqual({ ...world, spawn: null }, { ...dataset.worlds.worlds[0], spawn: null }, "seed and the rest are unchanged");
  assert.deepEqual(applied.entry.target, { type: "spawn", worldId: "player_club" });
  assert.deepEqual(applied.entry.changedFields, ["x", "y"]);
  assert.deepEqual(applied.entry.summary, { en: "Updated world spawn: Player_Club", "zh-TW": "修改世界出生座標：Player_Club" });
  assert.deepEqual(applied.dataset.manifest, { schemaVersion: 1, pointSeq: 2, changeSeq: 3, updateSeq: 1 });
  assert.deepEqual(applied.files.map((f) => f.path), ["site/data/worlds.json", "site/data/changelog/points.json", "site/data/manifest.json"]);
  assert.equal(applied.subject, "chore(data): update world spawn of player_club");
  assert.deepEqual(validateDataset(applied.dataset, { now: NOW }).errors, []);
});

test("applyRequest refuses duplicates and targets that changed after validation", () => {
  const dataset = createDataset();
  const dup = evaluateRequest({ dataset, issue: createIssue("add", { ...ADD_VALUES, x: "-426", z: "300", tags: ["Village / 村莊 (village)"] }) });
  assert.equal(dup.ok, true, "a duplicate is only a warning when validating");
  const refused = applyRequest({ dataset, result: dup, issueNumber: 12, now: NOW });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.problems[0], { code: "X17", key: "duplicateOnApply", params: { points: [{ id: "p0001", name: "Village 1" }] } });

  const edit = evaluateRequest({ dataset, issue: createIssue("edit", EDIT({ name: "Village One" })) });
  const moved = structuredClone(dataset);
  moved.points.player_club.points[0].updatedAt = "2026-09-29T11:00:00Z";
  assert.equal(applyRequest({ dataset: moved, result: edit, issueNumber: 12, now: NOW }).problems[0].key, "targetChanged");
  const spawn = evaluateRequest({ dataset, issue: createIssue("spawn", { target_id: "spawn:player_club", x: "8", y: "100", z: "5" }) });
  const respawned = structuredClone(dataset);
  respawned.worlds.worlds[0].spawn.y = 90;
  assert.equal(applyRequest({ dataset: respawned, result: spawn, issueNumber: 12, now: NOW }).problems[0].key, "targetChanged");
  assert.equal(applyRequest({ dataset, result: { ...edit, ok: false }, issueNumber: 12, now: NOW }).ok, false);
});

test("commit subjects are one short line", () => {
  assert.equal(subjectText("Base\nRequest-Issue: #1"), "Base Request-Issue: #1");
  assert.equal(subjectText(`a${"\u2028"}b${"\u202E"}c`), "a b c");
  assert.equal([...subjectText("村".repeat(80))].length, 61);
});

// ------------------------------------------------------------------ Scan, commit, push

test("run: an approved add is committed with the trailer, pushed, and reported as needing a deployment", async () => {
  const dataset = createDataset();
  const entry = approvedEntry(dataset, "add", ADD_VALUES, { number: 12 });
  const { outcome, outputs, infos, gh, repo } = await runApply({ dataset, entries: [entry] });
  assert.deepEqual(repo.state.pushed, [
    { paths: ["site/data/points/player_club.json", "site/data/changelog/points.json", "site/data/manifest.json"], subject: "chore(data): add point p0003 My Base", trailer: "Request-Issue: #12", issue: 12 },
  ]);
  const remote = await repo.remoteData();
  assert.equal(remote.points.player_club.points.at(-1).id, "p0003");
  assert.deepEqual(remote.changes.entries.at(-1).source, { type: "issue", issue: 12 });
  assert.equal(remote.manifest.pointSeq, 3);
  assert.deepEqual(outputs, {
    needs_deploy: "true",
    results: JSON.stringify([{ issue: 12, status: "applied", kind: "add", pointId: "p0003", worldId: "player_club" }]),
    head_sha: "f".repeat(40),
  });
  assert.deepEqual(gh.calls[0], ["listForRepo", "open", "coord-request,approved"]);
  assert.deepEqual(gh.mutations(), [], "labels and comments are left to the report job");
  assert.equal(outcome.commits, 1);
  assert.ok(!infos.join("\n").includes("My Base"), "user content is not logged");
});

test("run: an approval by someone who is not an approver is removed and nothing is written", async () => {
  const dataset = createDataset();
  const entry = approvedEntry(dataset, "add", ADD_VALUES, { number: 12, approver: "friend-01" });
  const { outputs, gh, repo } = await runApply({ dataset, entries: [entry] });
  assert.equal(repo.state.pushed.length, 0);
  assert.equal(outputs.needs_deploy, "false");
  assert.deepEqual(gh.mutations(), [["removeLabel", 12, "approved"], ["createComment", 12]]);
  assert.ok(lastComment(gh, 12).startsWith(RESULT_MARKER));
  assert.ok(lastComment(gh, 12).includes("not an approver"));
  assert.ok(!gh.get(12).labels.has("needs-fix"), "the submitter has nothing to fix");

  // Logins are compared without case.
  const upper = approvedEntry(dataset, "add", ADD_VALUES, { number: 13, approver: "spacesquare640" });
  assert.equal((await runApply({ dataset, entries: [upper] })).repo.state.pushed.length, 1);
});

test("run: an approval before or in the same second as the report, a failed report or an edited body is stale", async () => {
  const dataset = createDataset();
  const edited = approvedEntry(dataset, "add", ADD_VALUES, { number: 14 });
  edited.issue.body = edited.issue.body.replace("My Base", "My Other Base");
  const cases = [
    [approvedEntry(dataset, "add", ADD_VALUES, { number: 11, approvedAt: "2026-09-29T11:59:00Z" }), "approvedBeforeReport"],
    [approvedEntry(dataset, "add", ADD_VALUES, { number: 12, approvedAt: REPORT_AT }), "approvedBeforeReport"],
    [approvedEntry(dataset, "add", { ...ADD_VALUES, x: "1e5" }, { number: 13, status: "pass" }), "invalidNow"],
    [edited, "hashMismatch"],
  ];
  for (const [entry, reason] of cases) {
    const { outputs, gh, repo } = await runApply({ dataset, entries: [entry] });
    const n = entry.issue.number;
    assert.equal(repo.state.pushed.length, 0, reason);
    assert.equal(JSON.parse(outputs.results)[0].reason, reason);
    assert.ok(!gh.get(n).labels.has("approved"), reason);
    const reportBody = gh.get(n).comments[0].body;
    assert.ok(reportBody.includes("changed after it was reviewed"), "the report says why the approval was withdrawn");
    assert.equal(parseSnapshotMarker(reportBody).hash, snapshotHash(evaluateRequest({ dataset, issue: entry.issue }).request), "the report is recomputed");
    assert.ok(lastComment(gh, n).includes("Approval withdrawn"));
    // Validated again: still valid waits for a new approval, no longer valid needs a fix.
    assert.ok(gh.get(n).labels.has(reason === "invalidNow" ? "needs-fix" : "pending-review"), reason);
  }
});

test("run: two approved edits of the same point: the first is applied, the second must be reviewed again", async () => {
  const dataset = createDataset();
  const first = approvedEntry(dataset, "edit", EDIT({ name: "Village One" }), { number: 21, approvedAt: "2026-09-29T12:05:00Z" });
  const second = approvedEntry(dataset, "edit", EDIT({ x: "-400" }), { number: 22, approvedAt: "2026-09-29T12:06:00Z" });
  const { outputs, gh, repo } = await runApply({ dataset, entries: [second, first] });
  assert.deepEqual(repo.state.pushed.map((c) => c.issue), [21], "approval order, not Issue order");
  assert.deepEqual(JSON.parse(outputs.results).map((r) => [r.issue, r.status, r.reason ?? ""]), [
    [21, "applied", ""],
    [22, "stale", "hashMismatch"],
  ]);
  const remote = await repo.remoteData();
  assert.equal(remote.points.player_club.points[0].name, "Village One");
  assert.equal(remote.points.player_club.points[0].x, -426, "the second edit is not applied");
  // Validated again against the data as pushed: still valid, so it waits for a new approval.
  const labels = gh.get(22).labels;
  assert.ok(labels.has("pending-review") && !labels.has("approved") && !labels.has("needs-fix"));
  const newHash = parseSnapshotMarker(gh.get(22).comments[0].body).hash;
  assert.equal(newHash, snapshotHash(evaluateRequest({ dataset: remote, issue: second.issue }).request));
});

test("run: two approved adds at the same X and Z: the second is refused with needs-fix", async () => {
  const dataset = createDataset();
  const a = approvedEntry(dataset, "add", ADD_VALUES, { number: 31, approvedAt: "2026-09-29T12:05:00Z" });
  const b = approvedEntry(dataset, "add", { ...ADD_VALUES, name: "Same Spot" }, { number: 32, approvedAt: "2026-09-29T12:06:00Z" });
  const { gh, repo } = await runApply({ dataset, entries: [a, b] });
  assert.deepEqual(repo.state.pushed.map((c) => c.issue), [31]);
  assert.deepEqual(gh.mutations(), [
    ["removeLabel", 32, "approved"],
    ["addLabels", 32, "needs-fix"],
    ["removeLabel", 32, "pending-review"],
    ["createComment", 32],
  ]);
  assert.ok(lastComment(gh, 32).includes("duplicate cannot be added"));
  assert.ok(lastComment(gh, 32).includes("`p0003`"));
});

test("run: a change that breaks the data set is refused (whole data set validated after applying)", async () => {
  const dataset = createDataset();
  const entry = approvedEntry(dataset, "add", ADD_VALUES, { number: 41, login: "x".repeat(60) }); // submittedBy over 50 characters
  const { gh, repo } = await runApply({ dataset, entries: [entry] });
  assert.equal(repo.state.pushed.length, 0);
  assert.equal(repo.state.writes.length, 0, "nothing is written before validation passes");
  assert.ok(gh.get(41).labels.has("needs-fix"));
  assert.ok(lastComment(gh, 41).includes("Data validation"));
});

test("run is idempotent: a Request-Issue trailer or a change entry of the Issue means already written", async () => {
  const dataset = createDataset();
  const trailer = approvedEntry(dataset, "add", ADD_VALUES, { number: 12 });
  const byTrailer = await runApply({ dataset, entries: [trailer], repoOptions: { trailers: [12] } });
  assert.equal(byTrailer.repo.state.pushed.length, 0);
  assert.deepEqual(JSON.parse(byTrailer.outputs.results), [{ issue: 12, status: "already-applied" }]);
  assert.equal(byTrailer.outputs.needs_deploy, "true", "deploy and close it");
  assert.deepEqual(byTrailer.gh.mutations(), []);

  // Fixture entry c0002 records Issue #3 (p0002).
  const byEntry = await runApply({ dataset, entries: [approvedEntry(dataset, "add", ADD_VALUES, { number: 3 })] });
  assert.equal(byEntry.repo.state.pushed.length, 0);
  assert.deepEqual(JSON.parse(byEntry.outputs.results), [{ issue: 3, status: "already-applied", kind: "add", pointId: "p0002", worldId: "player_club" }]);

  // Running again after a successful run writes nothing new.
  const first = await runApply({ dataset, entries: [approvedEntry(dataset, "add", ADD_VALUES, { number: 12 })] });
  const again = await run({
    github: first.gh.github,
    context: { repo: REPO },
    core: { info: () => {}, setOutput: () => {} },
    root: ROOT,
    reader: first.repo.reader,
    io: first.repo.io,
    git: first.repo.git,
    now: () => new Date(NOW),
  });
  assert.equal(again.commits, 0);
  assert.equal(first.repo.state.pushed.length, 1);
  assert.equal(again.results[0].status, "already-applied");
});

const LOG_SEP = "0123456789abcdef0123456789abcdef";
const logRecord = (an, ae, cn, ce, trailers = "") => `${LOG_SEP}R${an}${LOG_SEP}F${ae}${LOG_SEP}F${cn}${LOG_SEP}F${ce}${LOG_SEP}F${trailers}\n`;
const sorted = (set) => [...set].sort((a, b) => a - b);

test("Request-Issue trailers count only in commits authored and committed by the bot", async () => {
  const { name, email } = BOT_IDENTITY;
  const record = logRecord;
  const sep = LOG_SEP;
  const log = [
    record(name, email, name, email, "#4\n"), // written by commitFiles
    record("friend-01", "friend@example.com", "friend-01", "friend@example.com", "#9\n"), // pushed or merged from a pull request
    record("friend-01", "friend@example.com", "GitHub", "noreply@github.com", "#7\n"), // squash or rebase merge on GitHub
    record(name, email, "GitHub", "noreply@github.com", "#6\n"), // bot author, other committer
    record("friend-01", "friend@example.com", name, email, "#5\n"), // other author, bot committer
    record(name.toUpperCase(), email, name, email, "#8\n"), // not exactly the bot
    record(name, email, name, email, "#3\n#11\nnot-a-number\n#0\n"), // several values; malformed ones ignored
    `${sep}R${name}${sep}F${email}${sep}F${name}${sep}F${email}\n`, // too few fields
    `${sep}R${name}${sep}F${email}${sep}F${name}${sep}F${email}${sep}F#12${sep}Fextra\n`, // too many fields
  ].join("\n");
  assert.deepEqual(sorted(parseRequestLog(log, sep)), [3, 4, 11]);
  assert.deepEqual(sorted(parseRequestLog("", sep)), []);
  assert.throws(() => parseRequestLog(log, ""), TypeError);
  assert.throws(() => requestLogFormat("\x1e"), TypeError);
  assert.equal(requestLogFormat(sep), `${sep}R%an${sep}F%ae${sep}F%cn${sep}F%ce${sep}F%(trailers:key=Request-Issue,valueonly)`);

  // requestIssueNumbers asks git for exactly this format over the history of HEAD.
  const calls = [];
  const numbers = await requestIssueNumbers(
    ROOT,
    async (args, options) => {
      calls.push([args, options]);
      return log;
    },
    () => sep,
  );
  assert.deepEqual(sorted(numbers), [3, 4, 11]);
  assert.deepEqual(calls, [[["log", `--format=${requestLogFormat(sep)}`, "HEAD"], { cwd: ROOT }]]);

  // Every call uses a fresh random separator.
  const separators = [];
  for (let i = 0; i < 2; i += 1) {
    await requestIssueNumbers(ROOT, async (args) => {
      separators.push(/^--format=([0-9a-f]{32})R%an/.exec(args[1])[1]);
      return "";
    });
  }
  assert.equal(separators.length, 2);
  assert.notEqual(separators[0], separators[1]);
});

test("a non-bot commit cannot forge a bot record through control characters or a guessed separator", () => {
  const { name, email } = BOT_IDENTITY;
  const mallory = ["Mallory", "mallory@example.com"];
  // The fixed separators of the earlier format, followed by a whole fake bot record.
  const oldFake = `\x1e${name}\x1f${email}\x1f${name}\x1f${email}\x1f#12`;
  const guess = "f".repeat(32);
  const guessedFake = `${guess}R${name}${guess}F${email}${guess}F${name}${guess}F${email}${guess}F#13`;
  const log = [
    logRecord(...mallory, ...mallory, `#1\x1e\n${oldFake}\n`), // in the trailer value
    logRecord(`Mallory${oldFake}`, mallory[1], ...mallory, "#14\n"), // in the author name
    logRecord(...mallory, mallory[0], `${mallory[1]}\x1f${name}\x1f${email}\x1f#15`, "#15\n"), // in the committer e-mail
    logRecord(...mallory, ...mallory, `${guessedFake}\n`), // a separator the attacker guessed
  ].join("\n");
  assert.deepEqual(sorted(parseRequestLog(log, LOG_SEP)), []);
});

test("run: a push rejected because Source_Code moved on is retried on the new remote head", async () => {
  const dataset = createDataset();
  const entry = approvedEntry(dataset, "add", ADD_VALUES, { number: 12 });
  // Meanwhile the owner added p0003 (with its manual change entry) and pushed.
  const moved = createDataset();
  moved.points.player_club.points.push({ ...moved.points.player_club.points[0], id: "p0003", name: "Owner Point", x: 1, z: 1, tags: ["village"] });
  moved.manifest.pointSeq = 3;
  moved.manifest.changeSeq = 3;
  moved.changes.entries.push({ ...moved.changes.entries[0], id: "c0003", target: { ...moved.changes.entries[0].target, id: "p0003", name: "Owner Point" } });
  const onReject = (state) => (state.remote = toFiles(moved));
  const { outputs, repo, infos } = await runApply({ dataset, entries: [entry], repoOptions: { rejectPushes: 1, onReject } });
  assert.equal(repo.state.resets, 1);
  assert.equal(JSON.parse(outputs.results)[0].pointId, "p0004");
  const remote = await repo.remoteData();
  assert.deepEqual(remote.points.player_club.points.map((p) => p.id), ["p0001", "p0002", "p0003", "p0004"]);
  assert.deepEqual(remote.changes.entries.map((e) => e.id), ["c0001", "c0002", "c0003", "c0004"]);
  assert.ok(infos.some((m) => m.includes("resetting and scanning again (1/3)")));
});

test("run: when every retry is rejected the job fails and no Issue is touched", async () => {
  const dataset = createDataset();
  const ok = approvedEntry(dataset, "add", ADD_VALUES, { number: 12 });
  const bad = approvedEntry(dataset, "add", ADD_VALUES, { number: 13, approver: "friend-01" });
  const repo = createRepo(dataset, { rejectPushes: MAX_PUSH_RETRIES + 1 });
  const gh = fakeGithub([ok, bad]);
  await assert.rejects(
    run({ github: gh.github, context: { repo: REPO }, core: { info: () => {}, setOutput: () => assert.fail("no outputs") }, root: ROOT, reader: repo.reader, io: repo.io, git: repo.git, now: () => new Date(NOW) }),
    (error) => error.message === "Applying approved requests failed: Error [PUSH_REJECTED]",
  );
  assert.equal(repo.state.resets, MAX_PUSH_RETRIES);
  assert.equal(repo.state.pushed.length, 0);
  assert.deepEqual(gh.mutations(), [], "follow-ups wait for a successful push");
});

test("run: invalid data on the branch stops everything before any API call", async () => {
  const dataset = createDataset();
  dataset.manifest.pointSeq = 1; // p0002 is above the sequence (X06)
  const gh = fakeGithub([approvedEntry(createDataset(), "add", ADD_VALUES, { number: 12 })]);
  const repo = createRepo(dataset);
  await assert.rejects(
    run({ github: gh.github, context: { repo: REPO }, core: { info: () => {}, setOutput: () => {} }, root: ROOT, reader: repo.reader, io: repo.io, git: repo.git, now: () => new Date(NOW) }),
    /^Error: Applying approved requests failed: Error \[DATA_INVALID\]$/,
  );
  assert.deepEqual(gh.calls, []);
});

test("run: API errors fail the job with class and status only", async () => {
  const secret = "My Secret Base";
  const repo = createRepo(createDataset());
  const github = {
    rest: { issues: { listForRepo: async () => { throw Object.assign(new Error(secret), { name: "HttpError", status: 502, request: { body: secret } }); } } },
    paginate: async (fn, params) => (await fn(params)).data,
  };
  await assert.rejects(
    run({ github, context: { repo: REPO }, core: { info: () => {}, setOutput: () => {} }, root: ROOT, reader: repo.reader, io: repo.io, git: repo.git, now: () => new Date(NOW) }),
    (error) => error.message === "Applying approved requests failed: HttpError (HTTP 502)" && !String(error.stack).includes(secret),
  );
});

// ------------------------------------------------------------------ Report

test("parseResults keeps well-formed results only", () => {
  const good = { issue: 12, status: "applied", kind: "add", pointId: "p0003", worldId: "player_club" };
  const text = JSON.stringify([
    good,
    { issue: 3, status: "already-applied" },
    { issue: 0, status: "applied" },
    { issue: "12", status: "applied" },
    { issue: 13, status: "merged" },
    { issue: 14, status: "applied", pointId: "p00001" },
    { issue: 15, status: "applied", worldId: "../x" },
    { issue: 16, status: "applied", kind: "rename" },
    null,
  ]);
  assert.deepEqual(parseResults(text), [good, { issue: 3, status: "already-applied", kind: null, pointId: null, worldId: null }]);
  for (const bad of [undefined, "", "{", "{}", "null"]) assert.deepEqual(parseResults(bad), []);
});

test("siteLink points at the point (not for deletions) and names the world only when it is not the default", () => {
  const config = createDataset().config;
  assert.equal(siteLink(config, { kind: "add", pointId: "p0003", worldId: "player_club" }), `${config.siteUrl}#point=p0003`);
  assert.equal(siteLink(config, { kind: "edit", pointId: "p0003", worldId: "survival_two" }), `${config.siteUrl}#world=survival_two&point=p0003`);
  assert.equal(siteLink(config, { kind: "delete", pointId: "p0003", worldId: "player_club" }), config.siteUrl);
  assert.equal(siteLink(config, { kind: "spawn", pointId: null, worldId: "player_club" }), config.siteUrl);
});

async function runReport(deployResult, results, { entries } = {}) {
  const dataset = createDataset();
  const gh = fakeGithub(entries ?? results.map((r) => approvedEntry(dataset, "add", ADD_VALUES, { number: r.issue })));
  const infos = [];
  const outcome = await report({
    github: gh.github,
    context: { repo: REPO },
    core: { info: (m) => infos.push(m) },
    env: { DEPLOY_RESULT: deployResult, APPLY_RESULTS: JSON.stringify(results) },
    reader: memoryReader(dataset),
  });
  return { outcome, gh, infos };
}

test("report: a successful deployment comments the link, labels applied and closes", async () => {
  const results = [
    { issue: 12, status: "applied", kind: "add", pointId: "p0003", worldId: "player_club" },
    { issue: 13, status: "stale", reason: "hashMismatch" },
  ];
  const { outcome, gh, infos } = await runReport("success", results);
  assert.deepEqual(outcome, { deployed: true, reported: 1 });
  assert.deepEqual(gh.mutations(), [
    ["createComment", 12],
    ["addLabels", 12, "applied"],
    ["removeLabel", 12, "pending-review"],
    ["removeLabel", 12, "deploy-failed"],
    ["update", 12, "closed", "completed"],
  ]);
  const comment = lastComment(gh, 12);
  assert.ok(comment.includes("https://spacesquare640.github.io/Player-Club_Minecraft_Website/#point=p0003"));
  assert.ok(comment.includes("about 10 minutes"));
  assert.ok(gh.get(12).labels.has("approved"), "the approval stays as a record");
  assert.ok(infos.includes("Issue #12: closed as applied"));
});

test("report: a cancelled deployment is not treated as published; the Issue stays open with approved", async () => {
  const { outcome, gh, infos } = await runReport("cancelled", [
    { issue: 12, status: "applied", kind: "add", pointId: "p0003", worldId: "player_club" },
    { issue: 14, status: "already-applied" },
  ]);
  assert.deepEqual(outcome, { deployed: false, reported: 2 });
  assert.deepEqual(gh.mutations(), [["createComment", 12], ["createComment", 14]], "no applied label, no deploy-failed, not closed");
  for (const n of [12, 14]) {
    assert.equal(gh.get(n).state, "open");
    assert.ok(gh.get(n).labels.has("approved"), "the next scan deploys again and closes it");
    assert.ok(!gh.get(n).labels.has("applied"));
    const lines = lastComment(gh, n).split("\n");
    assert.equal(lines[1], "### Publishing cancelled / 發布已取消");
    assert.match(lines[3], /^The request was written to the data, but publishing the site was cancelled/, "English first");
    assert.match(lines[4], /^請求已寫入資料，但網站發布在完成前已取消/, "Traditional Chinese second");
    assert.ok(!lines.join("\n").includes("https://"), "no site link: the change is not confirmed to be published");
  }
  assert.ok(infos.includes("Issue #12: left open (deployment cancelled)"));
});

test("report: a failed (or unknown) deployment adds deploy-failed, keeps approved and leaves the Issue open", async () => {
  for (const result of ["failure", ""]) {
    const { outcome, gh } = await runReport(result, [{ issue: 12, status: "already-applied" }]);
    assert.deepEqual(outcome, { deployed: false, reported: 1 }, result);
    assert.deepEqual(gh.mutations(), [["addLabels", 12, "deploy-failed"], ["createComment", 12]], result);
    assert.equal(gh.get(12).state, "open");
    assert.ok(gh.get(12).labels.has("approved"));
    assert.ok(lastComment(gh, 12).includes("Publishing failed"));
  }
});

test("report: a failed Issue update fails the job after the others were handled", async () => {
  const dataset = createDataset();
  const entries = [12, 13].map((n) => approvedEntry(dataset, "add", ADD_VALUES, { number: n }));
  const gh = fakeGithub(entries);
  const original = gh.github.rest.issues.createComment;
  gh.github.rest.issues.createComment = async (p) => {
    if (p.issue_number === 12) throw Object.assign(new Error("secret"), { name: "HttpError", status: 500 });
    return original(p);
  };
  await assert.rejects(
    report({
      github: gh.github,
      context: { repo: REPO },
      env: { DEPLOY_RESULT: "success", APPLY_RESULTS: JSON.stringify([{ issue: 12, status: "applied" }, { issue: 13, status: "applied" }]) },
      reader: memoryReader(dataset),
      core: { info: () => {} },
    }),
    /^Error: Reporting the deployment failed: Error \[REPORT_INCOMPLETE\]$/,
  );
  assert.equal(gh.get(13).state, "closed");
});

test("result comments are bilingual, English first, and contain no internal information", async () => {
  const dataset = createDataset();
  const bodies = [];
  const stale = await runApply({ dataset, entries: [approvedEntry(dataset, "add", ADD_VALUES, { number: 12, approvedAt: REPORT_AT })] });
  bodies.push(lastComment(stale.gh, 12));
  const unauthorized = await runApply({ dataset, entries: [approvedEntry(dataset, "add", ADD_VALUES, { number: 12, approver: "x" })] });
  bodies.push(lastComment(unauthorized.gh, 12));
  bodies.push(lastComment((await runReport("success", [{ issue: 12, status: "applied", kind: "add", pointId: "p0003", worldId: "player_club" }])).gh, 12));
  bodies.push(lastComment((await runReport("failure", [{ issue: 12, status: "applied" }])).gh, 12));
  bodies.push(lastComment((await runReport("cancelled", [{ issue: 12, status: "applied" }])).gh, 12));
  for (const body of bodies) {
    assert.ok(body.startsWith(`${RESULT_MARKER}\n### `));
    assert.match(body.split("\n")[1], /^### [A-Za-z ]+ \/ \S+$/, "English title first");
    assert.deepEqual(findInternalText(body), []);
    assert.equal(parseSnapshotMarker(body), null, "result comments never carry a snapshot");
  }
});

// ------------------------------------------------------------------ Dry run, sources, workflow

test("dry run: evaluates and applies an event fixture in memory and writes nothing", async () => {
  const lines = [];
  const eventPath = fileURLToPath(new URL("../fixtures/events/add-point.json", import.meta.url));
  // The dry run reads the committed data, whose timestamps keep moving forward, so it runs on the
  // real clock (a fixed clock would flag newer points as "in the future", X10).
  const code = await dryRun({ eventPath, now: new Date(), log: (l) => lines.push(l) });
  assert.equal(code, 0, lines.join("\n"));
  assert.match(lines[0], /^Issue #7 \(add\): validation pass, sha256 [0-9a-f]{64}$/);
  assert.ok(lines.includes("Would write: site/data/points/player_club.json, site/data/changelog/points.json, site/data/manifest.json"));
  assert.ok(lines.includes("        Request-Issue: #7"));
  assert.match(lines.find((l) => l.startsWith("Commit: ")), /^Commit: chore\(data\): add point p\d{4,} Test Village$/);

  const missing = [];
  assert.equal(await dryRun({ eventPath, readFileImpl: async () => JSON.stringify({ action: "opened" }), log: (l) => missing.push(l) }), 2);
});

test("the writer never runs shell commands or evaluates code; git goes through lib/git.mjs (execFile)", async () => {
  const source = await readFile(new URL("../../scripts/apply-requests.mjs", import.meta.url), "utf8");
  for (const pattern of [/child_process/, /\beval\(/, /new Function\b/, /(?<![.\w])exec(File|Sync)?\(/, /(?<![.\w])spawn(Sync)?\(/]) {
    assert.ok(!pattern.test(source), `apply-requests.mjs matches ${pattern}`);
  }
  const git = await readFile(new URL("../../scripts/lib/git.mjs", import.meta.url), "utf8");
  assert.match(git, /promisify\(execFile\)/);
  assert.doesNotMatch(git, /shell:\s*true|(?<![.\w])exec\(|execSync/);
});
