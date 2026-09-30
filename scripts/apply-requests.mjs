// Applies approved coordinate requests (workflow apply-approved.yml, loaded by actions/github-script).
// Issue content comes only from REST responses (or, for --dry-run, an event file) and is handled as data in
// JavaScript; nothing from it reaches a workflow expression, a shell or the log. Git runs through execFile.
//
// run (job apply, architecture 3.15): scan open Issues labeled coord-request + approved in approval order.
//   1. The last account that added "approved" must be in config.approvers (case-insensitive).
//   2. A "Request-Issue: #<n>" trailer in a bot commit of the first-parent history (author and committer
//      both github-actions[bot]; see lib/git.mjs) or a change log entry of the Issue means the request was
//      written earlier: it only waits for deployment and closing.
//   3. The bot report must have status=pass, the approval must be strictly later than the report was last
//      written, and its snapshot hash must equal the hash recomputed from the current body and data in
//      memory (including requests applied earlier in the same scan).
//   4. The request is applied in memory (applyRequest), the whole data set validated, the changed files
//      written and committed as github-actions[bot] with the trailer: one commit per request.
//   Then push; a push rejected as not a fast-forward resets to the remote and scans again (at most 3 times).
//   Label and comment changes happen only after the push succeeded (or when nothing was committed), so a
//   scan that is thrown away leaves no trace. Outputs: needs_deploy, results (JSON), head_sha.
// report (job report): after the deployment, applied Issues get a comment with the site link, the applied
//   label and are closed, but only when the deployment succeeded, or when it was cancelled (replaced by a
//   newer one) and within about 10 minutes the live github-pages deployment is a commit that contains
//   head_sha. Otherwise a cancelled deployment only gets a comment; a failed one also gets deploy-failed. Both
//   keep approved and stay open, so the next scan deploys again and closes them. All three notices are one
//   comment per Issue (the deploy status comment), updated in place by later runs: a failed or cancelled
//   notice becomes the published notice with the site link. Report jobs run one at a time (apply-report).
// Local: node scripts/apply-requests.mjs --event <event.json> --dry-run   (prints what would be written)

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LABELS } from "../site/js/lib/forms-meta.js";
import { formatId, parseId } from "../site/js/lib/ids.js";
import { createValidator } from "./lib/ajv.mjs";
import { buildPointChangeEntry, buildSpawnChangeEntry } from "./lib/changelog-templates.mjs";
import { allPointIds, maxIdNumber } from "./lib/cross-rules.mjs";
import { dateInTimeZone, formatUtcTimestamp } from "./lib/dates.mjs";
import * as gitOps from "./lib/git.mjs";
import {
  addLabels,
  closeIssue,
  commitContains,
  createComment,
  describeError,
  findLiveDeployment,
  listIssueComments,
  listIssueEvents,
  listOpenIssuesWithLabels,
  removeLabel,
  repoOf,
  upsertBotComment,
} from "./lib/github.mjs";
import { evaluateRequest } from "./lib/issue-parse.mjs";
import { stringifyJson } from "./lib/json-io.mjs";
import { CORE_FILES, REPO_ROOT, createFsReader, loadDataset, pathOf, pointsPath } from "./lib/load-data.mjs";
import {
  isDeployStatusBody,
  problemText,
  renderAppliedComment,
  renderDeployCancelledComment,
  renderDeployFailedComment,
  renderRejectedComment,
  renderStaleComment,
  renderUnauthorizedComment,
} from "./lib/messages.mjs";
import { SNAPSHOT_VERSION, findReportComment, parseSnapshotMarker, snapshotHash } from "./lib/snapshot.mjs";
import { validateDataset } from "./validate.mjs";
import { validateIssue } from "./validate-issue.mjs";

export const BRANCH = "Source_Code";
export const MAX_PUSH_RETRIES = 3;
/** Result statuses that wait for the deployment and are closed by report. */
export const REPORTED_STATUSES = Object.freeze(["applied", "already-applied"]);
/** How long report waits, after a cancelled deployment, for a newer one that contains the commit (about 10 minutes). */
export const SUPERSEDED_WAIT = Object.freeze({ attempts: 20, intervalMs: 30_000 });
const PAGES_ENVIRONMENT = "github-pages";
const COMMIT_SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const RESULT_STATUSES = ["applied", "already-applied", "unauthorized", "stale", "rejected"];
const RESULT_KINDS = ["add", "edit", "delete", "spawn"];
const SUBJECT_NAME_LENGTH = 60;
const WORLD_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;

// ---------------------------------------------------------------------------
// Approval and snapshot checks (pure)

/** The last "labeled: approved" event as { login, at (ms), createdAt }, or null. */
export function findApproval(events = []) {
  let last = null;
  for (const event of events) {
    if (event?.event !== "labeled" || event?.label?.name !== LABELS.approved) continue;
    const at = Date.parse(event.created_at);
    if (!Number.isFinite(at)) continue;
    if (!last || at >= last.at) last = { login: typeof event.actor?.login === "string" ? event.actor.login : null, at, createdAt: event.created_at };
  }
  return last;
}

/** config.approvers membership, compared without case (GitHub logins are case-insensitive). */
export function isApprover(login, approvers = []) {
  if (typeof login !== "string" || login === "") return false;
  const lower = login.toLowerCase();
  return approvers.some((a) => typeof a === "string" && a.toLowerCase() === lower);
}

/**
 * The trusted report passed, the approval came strictly after the report was last written (same second is
 * not enough), and the report's hash equals the hash recomputed now.
 * @param {{ approval: object | null, report: object | null, hash: string }} p report: a trusted bot comment
 * @returns {{ ok: boolean, reason: "" | "noReport" | "reportFailed" | "approvedBeforeReport" | "hashMismatch" }}
 */
export function checkSnapshot({ approval, report, hash }) {
  const marker = report ? parseSnapshotMarker(report.body) : null;
  if (!marker || marker.version !== SNAPSHOT_VERSION) return { ok: false, reason: "noReport" };
  if (marker.status !== "pass") return { ok: false, reason: "reportFailed" };
  const written = Date.parse(report.updated_at ?? report.created_at);
  if (!approval || !Number.isFinite(written) || !(approval.at > written)) return { ok: false, reason: "approvedBeforeReport" };
  if (marker.hash !== hash) return { ok: false, reason: "hashMismatch" };
  return { ok: true, reason: "" };
}

// ---------------------------------------------------------------------------
// Applying one request (pure)

const byIdNumber = (a, b) => (parseId(a.id)?.n ?? 0) - (parseId(b.id)?.n ?? 0);
const sameSpawn = (a, b) => a?.x === b?.x && a?.y === b?.y && a?.z === b?.z;

/** One line for the commit subject: no control characters, at most 60 characters. */
export function subjectText(text) {
  const chars = [...String(text ?? "").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").trim()];
  return chars.length > SUBJECT_NAME_LENGTH ? `${chars.slice(0, SUBJECT_NAME_LENGTH).join("")}…` : chars.join("");
}

const pointsFile = (worldId) => ({ path: pointsPath(worldId), schema: "points", select: (ds) => ds.points[worldId] });
const COMMON_FILES = [
  { path: pathOf("changes"), schema: "changelog-points", select: (ds) => ds.changes },
  { path: pathOf("manifest"), schema: "manifest", select: (ds) => ds.manifest },
];
const WORLDS_FILE = { path: pathOf("worlds"), schema: "worlds", select: (ds) => ds.worlds };

/**
 * Applies one evaluated, valid request to a copy of the data set. Nothing is written.
 * add: next point id (never reused), timestamps now; edit: the reviewed values, updatedAt now;
 * delete: the point is removed; spawn: world.spawn is replaced. Each adds one change log entry
 * (source issue, date in config.changelogTimeZone) and advances the manifest sequences.
 * @param {{ dataset: object, result: object, issueNumber: number, now: Date }} p result from evaluateRequest
 * @returns {{ ok: true, dataset: object, entry: object, files: object[], kind: string, pointId: string | null,
 *   worldId: string, subject: string } | { ok: false, problems: object[] }}
 */
export function applyRequest({ dataset, result, issueNumber, now }) {
  const fail = (problem) => ({ ok: false, problems: [problem] });
  const changed = { code: "R04", key: "targetChanged", params: {} };
  if (!result?.ok) return fail(changed);
  const next = structuredClone(dataset);
  const req = result.request;
  const kind = result.kind;
  const world = next.worlds.worlds.find((w) => w.id === req.worldId);
  if (!world) return fail(changed);
  const stamp = formatUtcTimestamp(now);
  const changeN = Math.max(next.manifest.changeSeq, maxIdNumber(next.changes.entries.map((e) => e.id), "c")) + 1;
  const common = {
    id: formatId("c", changeN),
    date: dateInTimeZone(now, next.config.changelogTimeZone),
    worldName: world.name,
    source: { type: "issue", issue: issueNumber },
    dictionaries: next.i18n ?? null,
  };
  const file = next.points[world.id];
  let entry;
  let pointId = null;
  let files;
  let subject;

  if (kind === "spawn") {
    if (!sameSpawn(world.spawn, req.baseSpawn)) return fail(changed);
    world.spawn = { x: req.x, y: req.y, z: req.z };
    entry = buildSpawnChangeEntry({ ...common, worldId: world.id, changedFields: result.changedFields });
    files = [WORLDS_FILE, ...COMMON_FILES];
    subject = `update world spawn of ${world.id}`;
  } else {
    if (!file) return fail(changed);
    files = [pointsFile(world.id), ...COMMON_FILES];
    if (kind === "add") {
      const duplicates = file.points.filter((p) => p.dimension === req.dimension && p.x === req.x && p.z === req.z);
      if (duplicates.length > 0) {
        return fail({ code: "X17", key: "duplicateOnApply", params: { points: duplicates.map((p) => ({ id: p.id, name: p.name })) } });
      }
      const n = Math.max(next.manifest.pointSeq, maxIdNumber(allPointIds(next), "p")) + 1;
      pointId = formatId("p", n);
      const point = { id: pointId, dimension: req.dimension, name: req.name, tags: [...req.tags], x: req.x, y: req.y, z: req.z };
      if (req.note !== null && req.note !== undefined) point.note = req.note;
      Object.assign(point, { submittedBy: req.submittedBy, createdAt: stamp, updatedAt: stamp });
      file.points.push(point);
      file.points.sort(byIdNumber);
      next.manifest.pointSeq = n;
      entry = buildPointChangeEntry({ ...common, action: "add", target: { worldId: world.id, id: pointId, dimension: point.dimension, name: point.name } });
      subject = `add point ${pointId} ${subjectText(point.name)}`;
    } else {
      const index = file.points.findIndex((p) => p.id === req.targetId);
      const before = file.points[index];
      if (index < 0 || before.updatedAt !== req.baseUpdatedAt) return fail(changed);
      pointId = before.id;
      if (kind === "edit") {
        const point = { ...before, dimension: req.dimension, name: req.name, tags: [...req.tags], x: req.x, y: req.y, z: req.z, updatedAt: stamp };
        if (req.note === null || req.note === undefined) delete point.note;
        else point.note = req.note;
        file.points[index] = point;
        entry = buildPointChangeEntry({
          ...common,
          action: "edit",
          target: { worldId: world.id, id: pointId, dimension: point.dimension, name: point.name },
          changedFields: result.changedFields,
        });
        subject = `update point ${pointId} ${subjectText(point.name)}`;
      } else if (kind === "delete") {
        file.points.splice(index, 1);
        entry = buildPointChangeEntry({ ...common, action: "delete", target: { worldId: world.id, id: pointId, dimension: before.dimension, name: before.name } });
        subject = `remove point ${pointId} ${subjectText(before.name)}`;
      } else {
        return fail(changed);
      }
    }
  }
  next.changes.entries.push(entry);
  next.manifest.changeSeq = changeN;
  return { ok: true, dataset: next, entry, files, kind, pointId, worldId: world.id, subject: `chore(data): ${subject}` };
}

// ---------------------------------------------------------------------------
// Scan, commit, push

/** File writes used by run (replaceable in tests). */
export const fsIo = {
  write: (filePath, text) => writeFile(filePath, text, "utf8"),
};

/** Writes the files whose canonical text changed; returns their repo-relative paths. */
async function writeChanged(root, io, before, after, files) {
  const paths = [];
  for (const file of files) {
    const text = stringifyJson(file.select(after), file.schema);
    if (text === stringifyJson(file.select(before), file.schema)) continue;
    await io.write(path.join(root, ...file.path.split("/")), text);
    paths.push(file.path);
  }
  return paths;
}

/** Target of a change log entry written for an Issue (for requests applied by an earlier run). */
function recordedTarget(entry) {
  if (!entry) return { kind: null, pointId: null, worldId: null };
  const kind = entry.target?.type === "spawn" ? "spawn" : entry.action;
  return { kind, pointId: entry.target?.id ?? null, worldId: entry.target?.worldId ?? null };
}

async function loadValidData(ctx) {
  const { dataset, issues } = await loadDataset(ctx.reader);
  const check = validateDataset(dataset, { fileIssues: issues, now: ctx.now(), validator: ctx.validator });
  if (check.errors.length > 0 || CORE_FILES.some((f) => dataset[f.key] === undefined)) {
    ctx.log(`The data on ${BRANCH} has ${check.errors.length} error(s); nothing is applied until it is fixed`);
    throw Object.assign(new Error("Data is invalid"), { code: "DATA_INVALID" });
  }
  return dataset;
}

/**
 * One scan over the approved Issues: applies and commits locally, and records what to do with the others.
 * @returns {Promise<{ outcomes: object[], commits: number, dataset: object }>}
 */
async function scan(ctx) {
  const { github, repo, root, git } = ctx;
  let current = await loadValidData(ctx);
  const recorded = await git.requestIssueNumbers(root);
  const items = [];
  for (const issue of await listOpenIssuesWithLabels(github, repo, [LABELS.coordRequest, LABELS.approved])) {
    if (!Number.isInteger(issue?.number) || issue.number < 1) continue;
    items.push({ issue, approval: findApproval(await listIssueEvents(github, repo, issue.number)) });
  }
  items.sort((a, b) => (a.approval?.at ?? 0) - (b.approval?.at ?? 0) || a.issue.number - b.issue.number);

  const outcomes = [];
  let commits = 0;
  for (const { issue, approval } of items) {
    const n = issue.number;
    if (!approval || !isApprover(approval.login, current.config.approvers)) {
      outcomes.push({ issue: n, status: "unauthorized" });
      continue;
    }
    const entry = current.changes.entries.find((e) => e.source?.type === "issue" && e.source.issue === n);
    if (recorded.has(n) || entry) {
      outcomes.push({ issue: n, status: "already-applied", ...recordedTarget(entry) });
      continue;
    }
    const report = findReportComment(await listIssueComments(github, repo, n));
    const result = evaluateRequest({ dataset: current, issue });
    const snapshot = checkSnapshot({ approval, report, hash: snapshotHash(result.request) });
    if (!snapshot.ok || !result.ok) {
      outcomes.push({ issue: n, status: "stale", reason: snapshot.ok ? "invalidNow" : snapshot.reason, source: issue });
      continue;
    }
    const applied = applyRequest({ dataset: current, result, issueNumber: n, now: ctx.now() });
    if (!applied.ok) {
      outcomes.push({ issue: n, status: "rejected", problems: applied.problems });
      continue;
    }
    const check = validateDataset(applied.dataset, { now: ctx.now(), validator: ctx.validator });
    if (check.errors.length > 0) {
      outcomes.push({ issue: n, status: "rejected", dataIssues: check.errors });
      continue;
    }
    const paths = await writeChanged(root, ctx.io, current, applied.dataset, applied.files);
    await git.commitFiles(root, { paths, subject: applied.subject, trailer: gitOps.requestTrailer(n) });
    commits += 1;
    current = applied.dataset;
    outcomes.push({ issue: n, status: "applied", kind: applied.kind, pointId: applied.pointId, worldId: applied.worldId });
  }
  return { outcomes, commits, dataset: current };
}

/** Label and comment changes for requests that were not applied (after the push). Failures are counted. */
async function settle(ctx, plan) {
  const { github, repo, log } = ctx;
  let failures = 0;
  for (const outcome of plan.outcomes) {
    const n = outcome.issue;
    try {
      if (outcome.status === "unauthorized") {
        await removeLabel(github, repo, n, LABELS.approved);
        await createComment(github, repo, n, renderUnauthorizedComment());
      } else if (outcome.status === "stale") {
        // Validation runs again on the data as pushed; its report replaces the outdated one.
        await validateIssue({ event: { issue: outcome.source }, dataset: plan.dataset, github, repo, log, approvalReason: "stale" });
        await createComment(github, repo, n, renderStaleComment({ reason: outcome.reason }));
      } else if (outcome.status === "rejected") {
        await removeLabel(github, repo, n, LABELS.approved);
        await addLabels(github, repo, n, [LABELS.needsFix]);
        await removeLabel(github, repo, n, LABELS.pendingReview);
        await createComment(github, repo, n, renderRejectedComment({ problems: outcome.problems, dataIssues: outcome.dataIssues }));
      }
    } catch (error) {
      failures += 1;
      log(`Issue #${n}: follow-up for ${outcome.status} failed: ${describeError(error)}`);
    }
  }
  return failures;
}

/** Public result of an outcome (the job output): numbers, statuses and ids only. */
function publicResult(outcome) {
  const out = { issue: outcome.issue, status: outcome.status };
  if (outcome.kind) out.kind = outcome.kind;
  if (outcome.pointId) out.pointId = outcome.pointId;
  if (outcome.worldId) out.worldId = outcome.worldId;
  if (outcome.reason) out.reason = outcome.reason;
  return out;
}

/**
 * Scans, commits and pushes (retrying on a moved branch), then settles the other Issues.
 * @param {{ github, repo, root, reader, io, git, now: () => Date, log, validator }} ctx
 * @returns {Promise<{ needsDeploy: boolean, results: object[], headSha: string, commits: number, followUpFailures: number }>}
 */
export async function applyApproved(ctx) {
  let plan;
  for (let attempt = 0; ; attempt += 1) {
    plan = await scan(ctx);
    if (plan.commits === 0) break;
    if ((await ctx.git.pushHead(ctx.root, BRANCH)).pushed) break;
    if (attempt >= MAX_PUSH_RETRIES) throw Object.assign(new Error("Push rejected"), { code: "PUSH_REJECTED" });
    ctx.log(`Push rejected because ${BRANCH} moved on; resetting and scanning again (${attempt + 1}/${MAX_PUSH_RETRIES})`);
    await ctx.git.resetToRemote(ctx.root, BRANCH);
  }
  const followUpFailures = await settle(ctx, plan);
  const results = plan.outcomes.map(publicResult);
  return {
    needsDeploy: results.some((r) => REPORTED_STATUSES.includes(r.status)),
    results,
    headSha: await ctx.git.headCommit(ctx.root),
    commits: plan.commits,
    followUpFailures,
  };
}

/**
 * github-script entry point of job apply: await run({ github, context, core }).
 * Every error is replaced by one that states only its class, code and HTTP status (see validate-issue).
 */
export async function run({ github, context, core, env = process.env, root = REPO_ROOT, reader, io = fsIo, git = gitOps, now = () => new Date() } = {}) {
  const log = (message) => (core ? core.info(message) : console.log(message));
  try {
    const repo = repoOf(context, env);
    const outcome = await applyApproved({ github, repo, root, reader: reader ?? createFsReader(root), io, git, now, log, validator: createValidator() });
    for (const r of outcome.results) log(`Issue #${r.issue}: ${r.status}${r.pointId ? ` ${r.pointId}` : ""}${r.reason ? ` (${r.reason})` : ""}`);
    log(`${outcome.commits} request(s) applied; deployment ${outcome.needsDeploy ? "needed" : "not needed"}; ${outcome.followUpFailures} follow-up failure(s)`);
    core?.setOutput("needs_deploy", String(outcome.needsDeploy));
    core?.setOutput("results", JSON.stringify(outcome.results));
    core?.setOutput("head_sha", outcome.headSha);
    return outcome;
  } catch (error) {
    throw new Error(`Applying approved requests failed: ${describeError(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Report after the deployment

/** Results from the apply job output; anything malformed is dropped. */
export function parseResults(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (r) =>
        r !== null &&
        typeof r === "object" &&
        Number.isInteger(r.issue) &&
        r.issue >= 1 &&
        RESULT_STATUSES.includes(r.status) &&
        (r.kind === undefined || r.kind === null || RESULT_KINDS.includes(r.kind)) &&
        (r.pointId === undefined || r.pointId === null || (typeof r.pointId === "string" && parseId(r.pointId)?.prefix === "p" && formatId("p", parseId(r.pointId).n) === r.pointId)) &&
        (r.worldId === undefined || r.worldId === null || (typeof r.worldId === "string" && WORLD_ID_RE.test(r.worldId))),
    )
    .map((r) => ({ issue: r.issue, status: r.status, kind: r.kind ?? null, pointId: r.pointId ?? null, worldId: r.worldId ?? null }));
}

/** Site link for a result: the point (not for deletions), in its world when that is not the default world. */
export function siteLink(config, result) {
  const params = [];
  if (result.worldId && result.worldId !== config.defaultWorldId) params.push(`world=${result.worldId}`);
  if (result.pointId && result.kind !== "delete") params.push(`point=${result.pointId}`);
  return params.length > 0 ? `${config.siteUrl}#${params.join("&")}` : config.siteUrl;
}

async function loadConfig(reader) {
  const { dataset } = await loadDataset(reader);
  const config = dataset.config;
  if (!config || typeof config.siteUrl !== "string" || !config.siteUrl.startsWith("https://")) {
    throw Object.assign(new Error("config.json could not be loaded"), { code: "DATA_UNAVAILABLE" });
  }
  return config;
}

/**
 * After a cancelled deployment: polls (at most wait.attempts times, wait.intervalMs apart) until the live
 * github-pages deployment is a commit that contains headSha, which happens when a newer deployment
 * replaced the cancelled one and finished. A deployment's commit is the one of the run that started it;
 * the site it built is never older (Source_Code HEAD at build time), so a match means the change is live.
 * Any API error ends the wait with false (the Issues then get the cancelled notice).
 */
async function publishedByLaterDeployment({ github, repo, headSha, wait, sleep, log }) {
  for (let attempt = 1; attempt <= wait.attempts; attempt += 1) {
    try {
      const live = await findLiveDeployment(github, repo, PAGES_ENVIRONMENT);
      if (live && COMMIT_SHA_RE.test(String(live.sha)) && (await commitContains(github, repo, live.sha, headSha))) return true;
    } catch (error) {
      log(`Checking the live deployment failed: ${describeError(error)}`);
      return false;
    }
    if (attempt < wait.attempts) await sleep(wait.intervalMs);
  }
  return false;
}

/**
 * github-script entry point of job report: await report({ github, context, core }).
 * env: DEPLOY_RESULT (needs.deploy.result), APPLY_RESULTS (needs.apply.outputs.results) and HEAD_SHA
 * (needs.apply.outputs.head_sha, the commit the deployment had to include).
 */
export async function report({
  github,
  context,
  core,
  env = process.env,
  root = REPO_ROOT,
  reader,
  wait = SUPERSEDED_WAIT,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const log = (message) => (core ? core.info(message) : console.log(message));
  try {
    const repo = repoOf(context, env);
    const deployResult = String(env.DEPLOY_RESULT ?? "");
    // Only a deployment that finished counts as published; anything else leaves the Issues open.
    let deployed = deployResult === "success";
    let cancelled = deployResult === "cancelled";
    const results = parseResults(env.APPLY_RESULTS).filter((r) => REPORTED_STATUSES.includes(r.status));
    const config = await loadConfig(reader ?? createFsReader(root));
    const headSha = String(env.HEAD_SHA ?? "");
    if (cancelled && results.length > 0 && COMMIT_SHA_RE.test(headSha)) {
      log(`Deployment cancelled; waiting for a newer live deployment that contains ${headSha}`);
      if (await publishedByLaterDeployment({ github, repo, headSha, wait, sleep, log })) {
        log("A newer live deployment contains the commit; reporting it as published");
        [deployed, cancelled] = [true, false];
      }
    }
    let failures = 0;
    for (const r of results) {
      try {
        if (deployed) {
          const applied = renderAppliedComment({ url: siteLink(config, r), pointId: r.kind === "add" ? r.pointId : null });
          await upsertBotComment(github, repo, r.issue, applied, isDeployStatusBody);
          await addLabels(github, repo, r.issue, [LABELS.applied]);
          await removeLabel(github, repo, r.issue, LABELS.pendingReview);
          await removeLabel(github, repo, r.issue, LABELS.deployFailed);
          await closeIssue(github, repo, r.issue);
        } else if (cancelled) {
          await upsertBotComment(github, repo, r.issue, renderDeployCancelledComment(), isDeployStatusBody);
        } else {
          await addLabels(github, repo, r.issue, [LABELS.deployFailed]);
          await upsertBotComment(github, repo, r.issue, renderDeployFailedComment(), isDeployStatusBody);
        }
        log(`Issue #${r.issue}: ${deployed ? "closed as applied" : cancelled ? "left open (deployment cancelled)" : "marked deploy-failed"}`);
      } catch (error) {
        failures += 1;
        log(`Issue #${r.issue}: report failed: ${describeError(error)}`);
      }
    }
    log(`Deployment ${deployResult === "" ? "unknown" : deployResult.replace(/[^a-z_]/g, "")}: ${results.length} Issue(s) reported, ${failures} failure(s)`);
    if (failures > 0) throw Object.assign(new Error("Some Issues could not be updated"), { code: "REPORT_INCOMPLETE" });
    return { deployed, reported: results.length };
  } catch (error) {
    throw new Error(`Reporting the deployment failed: ${describeError(error)}`);
  }
}

// ---------------------------------------------------------------------------
// Local dry run

/**
 * Evaluates and applies the Issue of an event file in memory and prints what would be committed.
 * The approval and snapshot checks need the GitHub API and are skipped. Nothing is written.
 */
export async function dryRun({ eventPath, root = REPO_ROOT, reader, readFileImpl = readFile, now = new Date(), log = console.log } = {}) {
  const event = JSON.parse(await readFileImpl(eventPath, "utf8"));
  const issue = event?.issue;
  if (!issue || !Number.isInteger(issue.number) || issue.number < 1) {
    log("The event file has no Issue with a valid number");
    return 2;
  }
  const { dataset } = await loadDataset(reader ?? createFsReader(root));
  const result = evaluateRequest({ dataset, issue });
  log(`Issue #${issue.number} (${result.kind ?? "unknown"}): validation ${result.ok ? "pass" : "fail"}, sha256 ${snapshotHash(result.request)}`);
  log("Dry run: approval and snapshot checks need the GitHub API and are skipped; nothing is written.");
  if (!result.ok) {
    for (const problem of result.errors) log(`  ${problem.code} ${problemText(problem)[0]}`);
    return 1;
  }
  const applied = applyRequest({ dataset, result, issueNumber: issue.number, now });
  if (!applied.ok) {
    for (const problem of applied.problems) log(`  ${problem.code} ${problemText(problem)[0]}`);
    return 1;
  }
  const check = validateDataset(applied.dataset, { now });
  for (const i of check.errors) log(`  ${i.code} ${i.file} ${i.message}`);
  const files = applied.files.filter((f) => stringifyJson(f.select(applied.dataset), f.schema) !== stringifyJson(f.select(dataset), f.schema));
  log(`Would write: ${files.map((f) => f.path).join(", ")}`);
  log(`Commit: ${applied.subject}`);
  log(`        ${gitOps.requestTrailer(issue.number)}`);
  log(`Change log entry: ${JSON.stringify(applied.entry)}`);
  return check.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { event: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  if (!values.event || !values["dry-run"]) {
    console.error("Usage: node scripts/apply-requests.mjs --event <event.json> --dry-run");
    process.exitCode = 2;
  } else {
    process.exitCode = await dryRun({ eventPath: values.event });
  }
}
