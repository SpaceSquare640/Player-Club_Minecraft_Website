// New Issue links for point requests. No DOM and no browser globals.

import { spawnTargetId } from "./coords.js";
import { FORM_FIELDS, ISSUE_TEMPLATES } from "./forms-meta.js";
import { isStandardId } from "./ids.js";

export const ISSUE_KINDS = Object.freeze(Object.keys(ISSUE_TEMPLATES));
const WORLD_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;

/**
 * https://github.com/<owner>/<repo>/issues/new?template=<file>[&target_id=<id>]
 * - add: no prefill
 * - edit / delete: target_id = pointId (standard form)
 * - spawn: target_id = spawn:<worldId>
 * @param {{ repo: { owner: string, name: string } }} config
 * @param {"add" | "edit" | "delete" | "spawn"} kind
 * @param {{ pointId?: string, worldId?: string }} [params]
 */
export function buildNewIssueUrl(config, kind, params = {}) {
  if (!ISSUE_KINDS.includes(kind)) throw new RangeError(`Invalid issue kind: ${kind}`);
  const owner = config?.repo?.owner;
  const name = config?.repo?.name;
  if (typeof owner !== "string" || typeof name !== "string" || !owner || !name) throw new TypeError("config.repo is required");
  const query = new URLSearchParams({ template: ISSUE_TEMPLATES[kind] });
  if (kind === "edit" || kind === "delete") {
    if (!isStandardId(params.pointId, "p")) throw new TypeError(`Invalid point id: ${params.pointId}`);
    query.set(FORM_FIELDS.targetId, params.pointId);
  } else if (kind === "spawn") {
    if (typeof params.worldId !== "string" || !WORLD_ID_RE.test(params.worldId)) throw new TypeError(`Invalid world id: ${params.worldId}`);
    query.set(FORM_FIELDS.targetId, spawnTargetId(params.worldId));
  }
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/new?${query.toString()}`;
}
