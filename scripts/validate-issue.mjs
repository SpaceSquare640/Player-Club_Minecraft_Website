// Validates a coordinate request Issue (workflow validate-issue.yml, loaded by actions/github-script).
// The Issue is read only from the event file at GITHUB_EVENT_PATH and handled as data in JavaScript;
// nothing from it is interpolated into workflow expressions, shell commands or logs.
// Steps: remove "approved" if present -> parse and check R01-R09 -> upsert the report comment
// (snapshot hash on its last line) -> pass: pending-review / fail: needs-fix.
// Local: node scripts/validate-issue.mjs --event <event.json> --dry-run   (prints the report, no API calls)

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LABELS } from "../site/js/lib/forms-meta.js";
import { addLabels, removeLabel, repoOf, upsertReportComment } from "./lib/github.mjs";
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
 * Validates the Issue of an event and updates labels and the report comment.
 * @returns {Promise<{ status: "pass" | "fail", hash: string, approvalRemoved: boolean, comment: object, result: object }>}
 */
export async function validateIssue({ event, dataset, github, repo }) {
  const issue = event.issue;
  const number = issue.number;
  const result = evaluateRequest({ dataset, issue });
  const status = result.ok ? "pass" : "fail";
  const hash = snapshotHash(result.request);

  // Opening, editing or reopening always withdraws an earlier approval, before anything else.
  let approvalRemoved = false;
  if (issueLabelNames(issue.labels).includes(LABELS.approved)) {
    approvalRemoved = await removeLabel(github, repo, number, LABELS.approved);
  }

  const body = renderReport({ result, hash, dataset, approvalRemoved });
  const comment = await upsertReportComment(github, repo, number, body);

  const [add, remove] = result.ok ? [LABELS.pendingReview, LABELS.needsFix] : [LABELS.needsFix, LABELS.pendingReview];
  await addLabels(github, repo, number, [add]);
  await removeLabel(github, repo, number, remove);
  return { status, hash, approvalRemoved, comment, result };
}

/**
 * github-script entry point: await run({ github, context, core }).
 * @param {{ github: object, context?: object, core?: object, env?: object, root?: string, reader?: object, readFileImpl?: Function }} deps
 */
export async function run({ github, context, core, env = process.env, root = REPO_ROOT, reader, readFileImpl } = {}) {
  const log = (message) => (core ? core.info(message) : console.log(message));
  const event = await readEventFile(env.GITHUB_EVENT_PATH, readFileImpl);
  const check = shouldValidate(event);
  if (!check.ok) {
    log(`Skipped: ${check.reason}`);
    return { skipped: true, reason: check.reason };
  }
  const { dataset, issues } = await loadDataset(reader ?? createFsReader(root));
  if (REQUIRED_DATA.some((key) => dataset[key] === undefined)) {
    throw new Error(`Data could not be loaded: ${issues.map((i) => `${i.file} ${i.message}`).join("; ")}`);
  }
  const outcome = await validateIssue({ event, dataset, github, repo: repoOf(context, env) });
  // Only non-user values are logged (workflow logs are public and parse "::" commands).
  log(`Issue #${Number(event.issue.number)}: ${outcome.status}, ${outcome.result.errors.length} problem(s), sha256 ${outcome.hash}, report ${outcome.comment.action}`);
  return outcome;
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
