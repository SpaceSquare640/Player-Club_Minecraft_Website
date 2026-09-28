// Allocates the next id and records it in manifest.json (ids are never reused).
// Usage: npm run new-id -- point|change|update [--dry-run]
// Run git pull first so the sequence does not collide with ids allocated by the bot.

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
import { formatId } from "../site/js/lib/ids.js";
import { allPointIds, maxIdNumber } from "./lib/cross-rules.mjs";
import { writeJsonFile } from "./lib/json-io.mjs";
import { REPO_ROOT, createFsReader, loadDataset, pathOf } from "./lib/load-data.mjs";

export const ID_KINDS = {
  point: { prefix: "p", seqKey: "pointSeq", ids: (ds) => allPointIds(ds) },
  change: { prefix: "c", seqKey: "changeSeq", ids: (ds) => (ds.changes?.entries ?? []).map((e) => e?.id) },
  update: { prefix: "u", seqKey: "updateSeq", ids: (ds) => (ds.updates?.entries ?? []).map((e) => e?.id) },
};

/**
 * next = max(manifest seq, highest existing id number) + 1.
 * @returns {{ id: string, n: number, manifest: object }} manifest is a new object with the sequence advanced.
 */
export function allocateId(dataset, kind) {
  const spec = ID_KINDS[kind];
  if (!spec) throw new Error(`Unknown id kind: ${kind} (expected point, change or update)`);
  const current = dataset.manifest[spec.seqKey];
  if (!Number.isInteger(current) || current < 0) throw new Error(`manifest.${spec.seqKey} is not a non-negative integer`);
  const n = Math.max(current, maxIdNumber(spec.ids(dataset), spec.prefix)) + 1;
  return { id: formatId(spec.prefix, n), n, manifest: { ...dataset.manifest, [spec.seqKey]: n } };
}

export async function run({ argv = process.argv.slice(2), root = REPO_ROOT, log = console.log, logError = console.error } = {}) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { "dry-run": { type: "boolean", default: false } },
  });
  const kind = positionals[0];
  const { dataset, issues } = await loadDataset(createFsReader(root));
  if (!dataset.manifest) {
    for (const issue of issues) logError(`${issue.file}: ${issue.message}`);
    return 1;
  }
  let result;
  try {
    result = allocateId(dataset, kind);
  } catch (error) {
    logError(error.message);
    return 1;
  }
  if (!values["dry-run"]) await writeJsonFile(path.join(root, pathOf("manifest")), result.manifest, "manifest");
  log(result.id);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
