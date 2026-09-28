// Schema + cross validation of site/data and site/i18n.
// Usage: node scripts/validate.mjs [--coverage] [--baseline <ref>|none] [--format]
//   --coverage  X21: manual data edits relative to HEAD must have change log entries (npm run check)
//   --baseline  X18 baseline ref (default: env PCMW_BASELINE_REF, then origin/Source_Code; "none" or all zeros skips)
//   --format    rewrite data and dictionary files in canonical format before validating

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { createValidator } from "./lib/ajv.mjs";
import { runCrossRules } from "./lib/cross-rules.mjs";
import { createGitReader, resolveCommit } from "./lib/git.mjs";
import { parseJsonText, stringifyJson } from "./lib/json-io.mjs";
import { CORE_FILES, REPO_ROOT, createFsReader, listDataFiles, loadDataset } from "./lib/load-data.mjs";

/**
 * Validates a loaded data set. Cross rules run only when there are no file or schema errors.
 * @param {object} dataset
 * @param {{ fileIssues?: object[], now?: Date, baselineManifest?: object | null, head?: object | null, validator?: object }} [options]
 */
export function validateDataset(dataset, options = {}) {
  const issues = [...(options.fileIssues ?? [])];
  const validator = options.validator ?? createValidator();
  for (const file of listDataFiles(dataset)) {
    for (const e of validator.validate(file.schema, file.data)) {
      issues.push({ level: "error", code: "SCHEMA", file: file.path, path: e.path, message: e.message });
    }
  }
  const coreMissing = CORE_FILES.some((f) => dataset[f.key] === undefined);
  const crossSkipped = coreMissing || issues.some((i) => i.level === "error");
  if (!crossSkipped) issues.push(...runCrossRules(dataset, options));
  return {
    issues,
    errors: issues.filter((i) => i.level === "error"),
    warnings: issues.filter((i) => i.level === "warning"),
    crossSkipped,
  };
}

/** Formats an issue as one output line. */
export function formatIssue(issue) {
  const location = issue.path ? `${issue.file}#${issue.path}` : issue.file;
  return `${issue.level === "error" ? "ERROR  " : "WARNING"} ${issue.code.padEnd(6)} ${location}  ${issue.message}`;
}

async function formatFiles(root, log) {
  const reader = createFsReader(root);
  const { dataset } = await loadDataset(reader);
  let changed = 0;
  for (const file of listDataFiles(dataset)) {
    const original = await reader.read(file.path);
    const formatted = stringifyJson(file.data, file.schema);
    if (original !== formatted) {
      await writeFile(path.join(root, file.path), formatted, "utf8");
      log(`Formatted ${file.path}`);
      changed += 1;
    }
  }
  log(`Format: ${changed} file(s) rewritten`);
}

async function loadBaselineManifest(root, ref, notes) {
  if (!ref || ref === "none" || /^0+$/.test(ref)) {
    notes.push("X18 skipped: no baseline");
    return null;
  }
  const commit = await resolveCommit(root, ref);
  if (!commit) {
    notes.push(`X18 skipped: baseline ${ref} not found`);
    return null;
  }
  const text = await createGitReader(root, commit).read(CORE_FILES.find((f) => f.key === "manifest").path);
  if (text === null) {
    notes.push(`X18 skipped: ${ref} has no manifest yet`);
    return null;
  }
  try {
    return parseJsonText(text).data;
  } catch {
    notes.push(`X18 skipped: manifest at ${ref} is not valid JSON`);
    return null;
  }
}

/** Loads the data set at HEAD for X21 / changelog-sync; null when HEAD cannot be read. */
export async function loadHeadDataset(root) {
  const commit = await resolveCommit(root, "HEAD");
  if (!commit) return null;
  return (await loadDataset(createGitReader(root, commit))).dataset;
}

export async function run({ argv = process.argv.slice(2), root = REPO_ROOT, env = process.env, log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      coverage: { type: "boolean", default: false },
      baseline: { type: "string" },
      format: { type: "boolean", default: false },
    },
  });
  if (values.format) await formatFiles(root, log);

  const notes = [];
  const { dataset, issues: fileIssues } = await loadDataset(createFsReader(root));
  const baselineRef = values.baseline ?? env.PCMW_BASELINE_REF ?? "origin/Source_Code";
  const baselineManifest = await loadBaselineManifest(root, baselineRef, notes);
  let head = null;
  if (values.coverage) {
    head = await loadHeadDataset(root);
    if (!head) notes.push("X21 skipped: HEAD not found");
  }

  const result = validateDataset(dataset, { fileIssues, baselineManifest, head });
  for (const issue of result.issues) log(formatIssue(issue));
  for (const note of notes) log(`NOTE    ${note}`);
  if (result.crossSkipped) log("NOTE    Cross validation skipped until file and schema errors are fixed");
  const fileCount = listDataFiles(dataset).length;
  log(`Validation: ${result.errors.length} error(s), ${result.warnings.length} warning(s) in ${fileCount} file(s)`);
  return result.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
