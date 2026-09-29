// Validates a coordinate request Issue (workflow validate-issue.yml, loaded by actions/github-script).
// The Issue is read only from the event file at GITHUB_EVENT_PATH and handled as data in JavaScript;
// nothing from it is interpolated into workflow expressions, shell commands or logs.
// Steps: parse and check R01-R09 -> remove "approved" -> upsert the report comment (snapshot hash on its
// last line) -> remove "approved" again -> pass: pending-review / fail: needs-fix.
// Any failed API call fails closed (needs-fix, no pending-review or approved) and fails the job with a
// log-safe error (class and HTTP status only).
// Local: node scripts/validate-issue.mjs --event <event.json> --dry-run   (prints the report, no API calls)

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LABELS } from "../site/js/lib/forms-meta.js";
import { addLabels, describeError, removeLabel, repoOf, upsertReportComment } from "./lib/github.mjs";
import { evaluateRequest, issueLabelNames } from "./lib/issue-parse.mjs";
import { REPO_ROOT, createFsReader, loadDataset } from "./lib/load-data.mjs";
import { renderReport } from "./lib/messages.mjs";
import { snapshotHash } from "./lib/snapshot.mjs";

export const HANDLED_ACTIONS = ["opened", "edited", "reopened"];
const REQUIRED_DATA = ["config", "editions", "worlds", "tags"];

/** Reads and parses the event payload file. */
export async function readEventFile(eventPath, readFileImpl = readFile) {
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is not set");
  return JSON.parse(await readFileImpl(eventPath, "utf8"));
}

/** Only open Issues with the coord-request label, on opened / edited / reopened. */
export function shouldValidate(event) {
  const issue = event?.issue;
  if (!HANDLED_ACTIONS.includes(event?.action)) return { ok: false, reason: "event action is not handled" };
  if (!issue || issue.pull_request) return { ok: false, reason: "not an issue" };
  if (issue.state !== "open") return { ok: false, reason: "issue is not open" };
  if (!issueLabelNames(issue.labels).includes(LABELS.coordRequest)) return { ok: false, reason: `no ${LABELS.coordRequest} label` };
  return { ok: true, reason: "" };
}

/**
 * Best effort after a failed step: the Issue is left without approved or pending-review and with needs-fix.
 * Failures here are only logged (safely); the original error is what fails the job.
 */
async function failClosed(github, repo, number, log) {
  const steps = [
    ["removeLabel approved", () => removeLabel(github, repo, number, LABELS.approved)],
    ["addLabels needs-fix", () => addLabels(github, repo, number, [LABELS.needsFix])],
    ["removeLabel pending-review", () => removeLabel(github, repo, number, LABELS.pendingReview)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (error) {
      log(`Fail-closed step failed: ${name}: ${describeError(error)}`);
    }
  }
}

/**
 * Validates the Issue of an event and updates labels and the report comment.
 * "approved" is removed before and again after the report is written, whatever labels the event payload
 * lists (a 404 means the Issue does not have it), so an approval added while validation runs is withdrawn
 * too. When any API call fails (for example the report cannot be created or updated) the Issue fails
 * closed: needs-fix is added, pending-review and approved are removed, and the error is rethrown.
 * @returns {Promise<{ status: "pass" | "fail", hash: string, approvalRemoved: boolean, comment: object, result: object }>}
 */
export async function validateIssue({ event, dataset, github, repo, log = () => {} }) {
  const issue = event.issue;
  const number = issue.number;
  const result = evaluateRequest({ dataset, issue });
  const status = result.ok ? "pass" : "fail";
  const hash = snapshotHash(result.request);

  try {
    // Opening, editing or reopening always withdraws an earlier approval, before anything else.
    let approvalRemoved = await removeLabel(github, repo, number, LABELS.approved);
    const body = renderReport({ result, hash, dataset, approvalRemoved });
    const comment = await upsertReportComment(github, repo, number, body);
    if (await removeLabel(github, repo, number, LABELS.approved)) approvalRemoved = true;

    const [add, remove] = result.ok ? [LABELS.pendingReview, LABELS.needsFix] : [LABELS.needsFix, LABELS.pendingReview];
    await addLabels(github, repo, number, [add]);
    await removeLabel(github, repo, number, remove);
    return { status, hash, approvalRemoved, comment, result };
  } catch (error) {
    await failClosed(github, repo, number, log);
    throw error;
  }
}

async function validateFromEvent({ github, context, env, root, reader, readFileImpl, log }) {
  const event = await readEventFile(env.GITHUB_EVENT_PATH, readFileImpl);
  const check = shouldValidate(event);
  if (!check.ok) {
    log(`Skipped: ${check.reason}`);
    return { skipped: true, reason: check.reason };
  }
  const { dataset, issues } = await loadDataset(reader ?? createFsReader(root));
  if (REQUIRED_DATA.some((key) => dataset[key] === undefined)) {
    log(`Data could not be loaded: ${issues.length} problem(s) in ${[...new Set(issues.map((i) => i.file))].join(", ")}`);
    throw Object.assign(new Error("Data could not be loaded"), { code: "DATA_UNAVAILABLE" });
  }
  const outcome = await validateIssue({ event, dataset, github, repo: repoOf(context, env), log });
  // Only non-user values are logged (workflow logs are public and parse "::" commands).
  log(`Issue #${Number(event.issue.number)}: ${outcome.status}, ${outcome.result.errors.length} problem(s), sha256 ${outcome.hash}, report ${outcome.comment.action}`);
  return outcome;
}

/**
 * github-script entry point: await run({ github, context, core }).
 * github-script prints a thrown error in full (console.error), and Octokit errors carry the request, whose
 * body is Issue text. Every error is therefore replaced by one that states only the class and HTTP status.
 * @param {{ github: object, context?: object, core?: object, env?: object, root?: string, reader?: object, readFileImpl?: Function }} deps
 */
export async function run({ github, context, core, env = process.env, root = REPO_ROOT, reader, readFileImpl } = {}) {
  const log = (message) => (core ? core.info(message) : console.log(message));
  try {
    return await validateFromEvent({ github, context, env, root, reader, readFileImpl, log });
  } catch (error) {
    throw new Error(`Issue validation failed: ${describeError(error)}`);
  }
}

/** Stand-in client for --dry-run: prints what would be sent, never calls the API. */
export function createDryRunGithub(log = console.log) {
  const record = (name) => async (params) => {
    const { body, ...rest } = params;
    log(`[dry-run] ${name} ${JSON.stringify(rest)}`);
    if (body !== undefined) log(body);
    return { data: { id: 0 } };
  };
  return {
    rest: {
      issues: {
        addLabels: record("addLabels"),
        removeLabel: record("removeLabel"),
        createComment: record("createComment"),
        updateComment: record("updateComment"),
        listComments: async () => ({ data: [] }),
      },
    },
    paginate: async () => [],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { event: { type: "string" }, "dry-run": { type: "boolean", default: false } } });
  if (!values.event || !values["dry-run"]) {
    console.error("Usage: node scripts/validate-issue.mjs --event <event.json> --dry-run");
    process.exitCode = 2;
  } else {
    await run({
      github: createDryRunGithub(),
      env: { GITHUB_EVENT_PATH: values.event, GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY ?? "local/dry-run" },
    });
  }
}
