// GitHub REST helpers over the Octokit client injected by actions/github-script (github.rest.*,
// github.paginate). Tests and --dry-run pass a stand-in with the same shape.

import { findReportComment } from "./snapshot.mjs";

/** { owner, repo } from github-script's context, else from GITHUB_REPOSITORY. */
export function repoOf(context, env = process.env) {
  if (context?.repo?.owner && context?.repo?.repo) return { owner: context.repo.owner, repo: context.repo.repo };
  const [owner, repo] = String(env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !repo) throw new Error("Repository is unknown (context.repo or GITHUB_REPOSITORY is required)");
  return { owner, repo };
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
