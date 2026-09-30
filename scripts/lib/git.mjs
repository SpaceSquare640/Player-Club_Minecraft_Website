// Minimal git access through execFile (argument arrays, no shell).

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(args, { cwd }) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

/** Resolves a ref to a commit SHA, or null when it does not exist. */
export async function resolveCommit(root, ref) {
  try {
    const sha = (await git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root })).trim();
    return sha || null;
  } catch {
    return null;
  }
}

/** Reader (same interface as createFsReader) over a commit; read/list return null when missing. */
export function createGitReader(root, commit) {
  return {
    async read(relPath) {
      try {
        return await git(["show", `${commit}:${relPath}`], { cwd: root });
      } catch {
        return null;
      }
    },
    async list(relDir) {
      try {
        const out = await git(["ls-tree", "--name-only", commit, `${relDir}/`], { cwd: root });
        const names = out
          .split("\n")
          .filter(Boolean)
          .map((p) => p.slice(relDir.length + 1));
        return names.length > 0 ? names : null;
      } catch {
        return null;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Writing (apply-requests): bot commits with a Request-Issue trailer, push, reset to the remote.
// Branch names and identities are constants of the caller; nothing here comes from Issue content except
// the commit subject, which the caller reduces to one short line.

export const BOT_IDENTITY = Object.freeze({ name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" });
export const REQUEST_TRAILER = "Request-Issue";

/** The trailer line of a commit that applies the request of an Issue. */
export function requestTrailer(issueNumber) {
  if (!Number.isInteger(issueNumber) || issueNumber < 1) throw new RangeError("Invalid Issue number");
  return `${REQUEST_TRAILER}: #${issueNumber}`;
}

const SEPARATOR_RE = /^[0-9a-f]{32}$/;

/** A fresh separator for one git log call: 128 random bits as hex, so no commit text can contain it. */
export const newLogSeparator = () => randomBytes(16).toString("hex");

/**
 * git log format with sep: one record per commit ("<sep>R") with author name / e-mail, committer name /
 * e-mail and the trailer values, each field starting with "<sep>F". Names, e-mails and trailer values may
 * hold any text, control characters included; only the unpredictable separator marks the boundaries.
 */
export function requestLogFormat(sep) {
  if (!SEPARATOR_RE.test(sep)) throw new TypeError("Invalid log separator");
  return `${sep}R%an${sep}F%ae${sep}F%cn${sep}F%ce${sep}F%(trailers:key=${REQUEST_TRAILER},valueonly)`;
}

/**
 * Issue numbers from `git log --format=requestLogFormat(sep)` output. Only commits whose author and
 * committer are both exactly BOT_IDENTITY count (the way commitFiles writes them); a trailer in any other
 * commit is ignored, including pull request commits that GitHub squashes or rebases on merge (GitHub
 * becomes the committer). A record that does not split into exactly five fields is ignored.
 * Git identities are not authenticated, so a commit whose author and committer were both set to the bot by
 * hand would still count here; requestIssueNumbers therefore reads the first-parent history only.
 */
export function parseRequestLog(out, sep) {
  if (!SEPARATOR_RE.test(sep)) throw new TypeError("Invalid log separator");
  const numbers = new Set();
  const bot = (name, email) => name === BOT_IDENTITY.name && email === BOT_IDENTITY.email;
  for (const record of String(out ?? "").split(`${sep}R`).slice(1)) {
    const fields = record.split(`${sep}F`);
    if (fields.length !== 5) continue;
    const [authorName, authorEmail, committerName, committerEmail, trailers] = fields;
    if (!bot(authorName, authorEmail) || !bot(committerName, committerEmail)) continue;
    for (const line of trailers.split("\n")) {
      const m = /^#([1-9][0-9]{0,9})$/.exec(line.trim());
      if (m) numbers.add(Number(m[1]));
    }
  }
  return numbers;
}

/**
 * Issue numbers named by "Request-Issue: #<n>" trailers of bot commits in the first-parent history of HEAD.
 * The bot pushes its commits straight onto Source_Code, so they are on that chain; commits brought in by a
 * merge commit (for example a pull request with a hand-made bot identity) are not. When a bot commit is
 * off the chain (the owner merged Source_Code into a local branch and pushed the merge), apply-requests
 * still recognizes the request by the change log entry that every applied request writes.
 */
export async function requestIssueNumbers(root, run = git, separator = newLogSeparator) {
  const sep = separator();
  return parseRequestLog(await run(["log", "--first-parent", `--format=${requestLogFormat(sep)}`, "HEAD"], { cwd: root }), sep);
}

/** Current HEAD commit SHA. */
export async function headCommit(root) {
  return (await git(["rev-parse", "HEAD"], { cwd: root })).trim();
}

/** Commits exactly the given paths as the bot, with the trailer as the last paragraph; returns the SHA. */
export async function commitFiles(root, { paths, subject, trailer, identity = BOT_IDENTITY }) {
  if (paths.length === 0) throw new Error("Nothing to commit");
  if (/[\r\n]/.test(subject) || /[\r\n]/.test(trailer)) throw new Error("Commit subject and trailer must be single lines");
  await git(["add", "--", ...paths], { cwd: root });
  await git(["-c", `user.name=${identity.name}`, "-c", `user.email=${identity.email}`, "commit", "-m", subject, "-m", trailer, "--", ...paths], { cwd: root });
  return headCommit(root);
}

/**
 * Pushes HEAD to the branch. Returns { pushed: false } when the remote rejects it as not a fast-forward
 * (the branch moved on); any other failure (for example a rule rejecting the push) is thrown.
 */
export async function pushHead(root, branch) {
  try {
    await git(["push", "--porcelain", "origin", `HEAD:refs/heads/${branch}`], { cwd: root });
    return { pushed: true };
  } catch (error) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    if (/\[rejected\]/.test(output)) return { pushed: false };
    throw error;
  }
}

/** Fetches the branch and resets the working tree and HEAD to it (drops local commits that were not pushed). */
export async function resetToRemote(root, branch) {
  await git(["fetch", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`], { cwd: root });
  await git(["reset", "--hard", `refs/remotes/origin/${branch}`], { cwd: root });
}
