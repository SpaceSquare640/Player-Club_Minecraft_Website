// Minimal git access through execFile (argument arrays, no shell).

import { execFile } from "node:child_process";
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
