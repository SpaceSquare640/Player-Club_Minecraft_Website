// Records manual edits of points and world spawns as "coordinate changes" entries (source manual),
// by comparing the working tree with HEAD. Also fills timestamps: new points get createdAt/updatedAt,
// edited points get a fresh updatedAt. Safe to re-run: changes already covered by a new manual entry are skipped.
// Usage: npm run changelog:sync [-- --dry-run]

import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import path from "node:path";
import { formatId } from "../site/js/lib/ids.js";
import { buildPointChangeEntry, buildSpawnChangeEntry } from "./lib/changelog-templates.mjs";
import { diffDatasets, findCoveringEntry, maxIdNumber, newEntries } from "./lib/cross-rules.mjs";
import { dateInTimeZone, formatUtcTimestamp } from "./lib/dates.mjs";
import { stringifyJson, writeJsonFile } from "./lib/json-io.mjs";
import { CORE_FILES, REPO_ROOT, createFsReader, loadDataset, pathOf, pointsPath } from "./lib/load-data.mjs";
import { formatIssue, loadHeadDataset, validateDataset } from "./validate.mjs";

const isBlank = (v) => v === undefined || v === null || v === "";

/**
 * Pure sync step.
 * @param {{ current: object, head: object | null, now?: Date }} p
 * @returns {{ dataset: object, created: object[], stamped: string[] }}
 */
export function syncChangelog({ current, head, now = new Date() }) {
  const next = structuredClone(current);
  const diff = diffDatasets(head, next);
  const fresh = newEntries(head?.changes?.entries, next.changes.entries);
  const date = dateInTimeZone(now, next.config.changelogTimeZone);
  const stamp = formatUtcTimestamp(now);
  const worldNames = new Map([...(head?.worlds?.worlds ?? []), ...next.worlds.worlds].map((w) => [w.id, w.name]));
  const worldName = (worldId) => worldNames.get(worldId) ?? worldId;
  const source = { type: "manual" };
  const dictionaries = next.i18n ?? null;

  let seq = Math.max(next.manifest.changeSeq, maxIdNumber(next.changes.entries.map((e) => e.id), "c"));
  const created = [];
  for (const change of diff.changes) {
    if (findCoveringEntry(fresh, change)) continue;
    seq += 1;
    const id = formatId("c", seq);
    let entry;
    if (change.type === "spawn") {
      entry = buildSpawnChangeEntry({ id, date, worldId: change.worldId, changedFields: change.changedFields, worldName: worldName(change.worldId), source, dictionaries });
    } else {
      const snapshot = change.action === "delete" ? change.before : change.after;
      entry = buildPointChangeEntry({
        id,
        date,
        action: change.action,
        target: { worldId: change.worldId, id: change.id, dimension: snapshot.dimension, name: snapshot.name },
        changedFields: change.changedFields,
        worldName: worldName(change.worldId),
        source,
        dictionaries,
      });
    }
    next.changes.entries.push(entry);
    created.push(entry);
  }
  next.manifest.changeSeq = seq;

  // Timestamps for added and edited points.
  const stamped = [];
  for (const change of diff.changes) {
    if (change.type !== "point" || change.action === "delete") continue;
    const point = next.points[change.worldId].points.find((p) => p.id === change.id);
    if (change.action === "add") {
      if (isBlank(point.createdAt) || isBlank(point.updatedAt)) stamped.push(change.id);
      if (isBlank(point.createdAt)) point.createdAt = stamp;
      if (isBlank(point.updatedAt)) point.updatedAt = point.createdAt;
    } else {
      if (isBlank(point.createdAt)) point.createdAt = change.before.createdAt;
      if (isBlank(point.updatedAt) || point.updatedAt === change.before.updatedAt) {
        point.updatedAt = stamp;
        stamped.push(change.id);
      }
    }
  }
  return { dataset: next, created, stamped };
}

export async function run({ argv = process.argv.slice(2), root = REPO_ROOT, now = new Date(), log = console.log } = {}) {
  const { values } = parseArgs({ args: argv, options: { "dry-run": { type: "boolean", default: false } } });
  const { dataset, issues } = await loadDataset(createFsReader(root));
  const blocking = issues.filter((i) => i.level === "error");
  if (blocking.length > 0 || CORE_FILES.some((f) => dataset[f.key] === undefined)) {
    for (const issue of blocking) log(formatIssue(issue));
    log("changelog:sync stopped: fix the file errors above first");
    return 1;
  }
  const head = await loadHeadDataset(root);
  if (!head) {
    log("changelog:sync stopped: HEAD not found");
    return 1;
  }

  const result = syncChangelog({ current: dataset, head, now });
  for (const entry of result.created) log(`New entry ${entry.id}: ${entry.summary.en}`);
  if (result.created.length === 0) log("No new entries needed");
  if (values["dry-run"]) {
    log("Dry run: no files written");
    return 0;
  }

  // Write only files whose canonical text changed.
  const targets = [
    { path: pathOf("manifest"), schema: "manifest", before: dataset.manifest, after: result.dataset.manifest },
    { path: pathOf("changes"), schema: "changelog-points", before: dataset.changes, after: result.dataset.changes },
    ...Object.keys(result.dataset.points).map((stem) => ({
      path: pointsPath(stem),
      schema: "points",
      before: dataset.points[stem],
      after: result.dataset.points[stem],
    })),
  ];
  for (const t of targets) {
    if (stringifyJson(t.before, t.schema) !== stringifyJson(t.after, t.schema)) {
      await writeJsonFile(path.join(root, t.path), t.after, t.schema);
      log(`Updated ${t.path}`);
    }
  }

  const check = validateDataset(result.dataset, { head, now });
  for (const issue of check.issues) log(formatIssue(issue));
  log(`Validation after sync: ${check.errors.length} error(s), ${check.warnings.length} warning(s)`);
  if (check.errors.length === 0) log("Next: npm run check");
  return check.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run();
}
