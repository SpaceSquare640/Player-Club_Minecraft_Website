// GitHub REST helpers over the Octokit client injected by actions/github-script (github.rest.*,
// github.paginate). Tests and --dry-run pass a stand-in with the same shape.

import { findReportComment, isTrustedBotComment } from "./snapshot.mjs";

/** { owner, repo } from github-script's context, else from GITHUB_REPOSITORY. */
export function repoOf(context, env = process.env) {
  if (context?.repo?.owner && context?.repo?.repo) return { owner: context.repo.owner, repo: context.repo.repo };
  const [owner, repo] = String(env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !repo) throw new Error("Repository is unknown (context.repo or GITHUB_REPOSITORY is required)");
  return { owner, repo };
}

/**
 * Log-safe summary of an error: its class, a code such as ENOENT and the HTTP status only. The message and
 * any request / response data are left out, because API errors carry the request body (Issue text) and
 * workflow logs are public.
 */
export function describeError(error) {
  const name = typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(error.name) ? error.name : "Error";
  const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(error.code) ? ` [${error.code}]` : "";
  const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : "";
  return `${name}${code}${status}`;
}

export async function addLabels(github, repo, issueNumber, labels) {
  if (labels.length === 0) return;
  await github.rest.issues.addLabels({ ...repo, issue_number: issueNumber, labels });
}

/** Removes a label; returns false when the Issue did not have it (HTTP 404). */
export async function removeLabel(github, repo, issueNumber, name) {
  try {
    await github.rest.issues.removeLabel({ ...repo, issue_number: issueNumber, name });
    return true;
  } catch (error) {
    if (error?.status === 404) return false;
    throw error;
  }
}

export async function listIssueComments(github, repo, issueNumber) {
  return github.paginate(github.rest.issues.listComments, { ...repo, issue_number: issueNumber, per_page: 100 });
}

/**
 * Creates or updates the single report comment. Only a comment by github-actions[bot] with the report
 * marker on its first line is updated; comments by anyone else are never touched or trusted.
 * @returns {Promise<{ action: "created" | "updated", id: number }>}
 */
export async function upsertReportComment(github, repo, issueNumber, body) {
  const existing = findReportComment(await listIssueComments(github, repo, issueNumber));
  if (existing) {
    await github.rest.issues.updateComment({ ...repo, comment_id: existing.id, body });
    return { action: "updated", id: existing.id };
  }
  const { data } = await github.rest.issues.createComment({ ...repo, issue_number: issueNumber, body });
  return { action: "created", id: data?.id };
}

/**
 * Creates or updates one comment of a kind: the latest comment by github-actions[bot] whose body matches
 * is updated, otherwise a new one is created. Comments by anyone else are never touched.
 * @param {(body: string) => boolean} matches
 * @returns {Promise<{ action: "created" | "updated", id: number }>}
 */
export async function upsertBotComment(github, repo, issueNumber, body, matches) {
  const comments = await listIssueComments(github, repo, issueNumber);
  const existing = comments.filter((c) => isTrustedBotComment(c) && typeof c.body === "string" && matches(c.body)).at(-1);
  if (existing) {
    await github.rest.issues.updateComment({ ...repo, comment_id: existing.id, body });
    return { action: "updated", id: existing.id };
  }
  const { data } = await github.rest.issues.createComment({ ...repo, issue_number: issueNumber, body });
  return { action: "created", id: data?.id };
}

/** Open Issues that have every one of the labels (pull requests are left out). */
export async function listOpenIssuesWithLabels(github, repo, labels) {
  const items = await github.paginate(github.rest.issues.listForRepo, { ...repo, state: "open", labels: labels.join(","), per_page: 100 });
  return items.filter((item) => !item.pull_request);
}

/** Issue events (labeled, unlabeled, ...) in API order, oldest first. */
export async function listIssueEvents(github, repo, issueNumber) {
  return github.paginate(github.rest.issues.listEvents, { ...repo, issue_number: issueNumber, per_page: 100 });
}

export async function createComment(github, repo, issueNumber, body) {
  const { data } = await github.rest.issues.createComment({ ...repo, issue_number: issueNumber, body });
  return data;
}

/** Closes an Issue as completed. */
export async function closeIssue(github, repo, issueNumber) {
  await github.rest.issues.update({ ...repo, issue_number: issueNumber, state: "closed", state_reason: "completed" });
}
