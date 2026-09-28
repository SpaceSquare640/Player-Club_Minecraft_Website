// Adds a bilingual "updates" change log entry (English first) and advances manifest.updateSeq.
// Usage: npm run changelog:update
//        npm run changelog:update -- --summary-en "..." --summary-zh "..." --scope-en "..." --scope-zh "..." [--date YYYY-MM-DD] [--dry-run]
// Missing values are asked interactively. Text must be public: no internal tooling names, notes or local paths.

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { formatId } from "../site/js/lib/ids.js";
import { createValidator } from "./lib/ajv.mjs";
import { maxIdNumber } from "./lib/cross-rules.mjs";
import { dateInTimeZone } from "./lib/dates.mjs";
import { writeJsonFile } from "./lib/json-io.mjs";
import { REPO_ROOT, createFsReader, loadDataset, pathOf } from "./lib/load-data.mjs";
import { findInternalText } from "./lib/public-text-guard.mjs";

const clean = (text) => (typeof text === "string" ? text.normalize("NFC").trim() : text);

/**
 * Pure step: appends an entry and advances updateSeq. Throws with every problem listed when the input is invalid.
 * @param {object} dataset needs manifest, config and updates
 * @param {{ summary: { en, "zh-TW" }, scope: { en, "zh-TW" }, date?: string, now?: Date, validator?: object }} input
 * @returns {{ dataset: object, entry: object }}
 */
export function addUpdateEntry(dataset, { summary, scope, date, now = new Date(), validator = createValidator() }) {
  const next = structuredClone(dataset);
  const seq = Math.max(next.manifest.updateSeq, maxIdNumber(next.updates.entries.map((e) => e.id), "u")) + 1;
  const entry = {
    id: formatId("u", seq),
    date: date ?? dateInTimeZone(now, next.config.changelogTimeZone),
    summary: { en: clean(summary?.en), "zh-TW": clean(summary?.["zh-TW"]) },
    scope: { en: clean(scope?.en), "zh-TW": clean(scope?.["zh-TW"]) },
  };
  next.updates.entries.push(entry);
  next.manifest.updateSeq = seq;

  const problems = validator
    .validate("changelog-updates", next.updates)
    .map((e) => `${e.path} ${e.message}`);
  for (const field of ["summary", "scope"]) {
    for (const lang of ["en", "zh-TW"]) {
      const hits = findInternalText(entry[field][lang]);
      if (hits.length > 0) problems.push(`${field}.${lang} contains internal information (${hits.join(", ")})`);
    }
  }
  if (problems.length > 0) throw new Error(`Invalid update entry:\n  ${problems.join("\n  ")}`);
  return { dataset: next, entry };
}

export async function run({ argv = process.argv.slice(2), root = REPO_ROOT, now = new Date(), log = console.log, input = process.stdin, output = process.stdout } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      "summary-en": { type: "string" },
      "summary-zh": { type: "string" },
      "scope-en": { type: "string" },
      "scope-zh": { type: "string" },
      date: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const { dataset, issues } = await loadDataset(createFsReader(root));
  if (!dataset.manifest || !dataset.config || !dataset.updates) {
    for (const issue of issues) log(`${issue.file}: ${issue.message}`);
    return 1;
  }

  const prompts = [
    ["summary-en", "Summary (English, max 200): "],
    ["summary-zh", "Summary (繁體中文, max 200): "],
    ["scope-en", "Scope (English, max 100): "],
    ["scope-zh", "Scope (繁體中文, max 100): "],
  ];
  const answers = { ...values };
  if (prompts.some(([key]) => answers[key] === undefined)) {
    // Line iterator (not rl.question) so piped input is not lost between prompts.
    const rl = createInterface({ input, output, terminal: Boolean(input.isTTY) });
    const lines = rl[Symbol.asyncIterator]();
    try {
      for (const [key, question] of prompts) {
        if (answers[key] !== undefined) continue;
        output.write(question);
        const { value, done } = await lines.next();
        if (done) break;
        answers[key] = value;
      }
    } finally {
      rl.close();
    }
  }

  let result;
  try {
    result = addUpdateEntry(dataset, {
      summary: { en: answers["summary-en"], "zh-TW": answers["summary-zh"] },
      scope: { en: answers["scope-en"], "zh-TW": answers["scope-zh"] },
      date: answers.date,
      now,
    });
  } catch (error) {
    log(error.message);
    return 1;
  }
  log(`${result.entry.id} ${result.entry.date} - ${result.entry.summary.en} - ${result.entry.scope.en}`);
  log(`${" ".repeat(result.entry.id.length)} ${result.entry.date} - ${result.entry.summary["zh-TW"]} - ${result.entry.scope["zh-TW"]}`);
  if (values["dry-run"]) {
    log("Dry run: no files written");
    return 0;
  }
  await writeJsonFile(path.join(root, pathOf("updates")), result.dataset.updates, "changelog-updates");
  await writeJsonFile(path.join(root, pathOf("manifest")), result.dataset.manifest, "manifest");
  log("Updated site/data/changelog/updates.json and site/data/manifest.json; next: npm run check");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
