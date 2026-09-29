// Report comment markers and request snapshot hash (architecture 3.13).
// The report comment starts with REPORT_MARKER and ends with the snapshot marker line. Only comments by
// github-actions[bot] (user.type "Bot") are trusted, so nobody can forge a report or a snapshot.

import { createHash } from "node:crypto";

export const SNAPSHOT_VERSION = 1;
export const REPORT_MARKER = "<!-- pcmw:report -->";
export const BOT_LOGIN = "github-actions[bot]";

/** Keys of the normalized request that the hash covers; missing values are null. */
export const SNAPSHOT_KEYS = Object.freeze([
  "issue",
  "type",
  "targetId",
  "baseUpdatedAt",
  "baseSpawn",
  "worldId",
  "dimension",
  "name",
  "tags",
  "x",
  "y",
  "z",
  "note",
  "submittedBy",
]);

const SNAPSHOT_LINE_RE = /^<!-- pcmw:snapshot v=([0-9]+) status=(pass|fail) sha256=([0-9a-f]{64}) -->$/;

/** Request fields reduced to SNAPSHOT_KEYS (undefined becomes null). */
export function buildSnapshotPayload(request = {}) {
  return Object.fromEntries(SNAPSHOT_KEYS.map((key) => [key, request[key] === undefined ? null : request[key]]));
}

/** JSON with object keys sorted at every level (arrays keep their order). */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] === undefined ? null : value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** SHA-256 (hex) of the canonical JSON of the snapshot payload. */
export function snapshotHash(request) {
  return createHash("sha256").update(canonicalJson(buildSnapshotPayload(request)), "utf8").digest("hex");
}

/** The last line of a report comment. */
export function formatSnapshotMarker({ status, hash }) {
  if (status !== "pass" && status !== "fail") throw new RangeError(`Invalid snapshot status: ${status}`);
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) throw new TypeError("Invalid snapshot hash");
  return `<!-- pcmw:snapshot v=${SNAPSHOT_VERSION} status=${status} sha256=${hash} -->`;
}

/**
 * Reads the snapshot marker from the last non-empty line of a comment body (never from elsewhere, so
 * user text quoted inside the report cannot pose as a marker).
 * @returns {{ version: number, status: "pass" | "fail", hash: string } | null}
 */
export function parseSnapshotMarker(body) {
  if (typeof body !== "string") return null;
  const lines = body.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const m = SNAPSHOT_LINE_RE.exec(lines.at(-1) ?? "");
  if (!m) return null;
  return { version: Number(m[1]), status: m[2], hash: m[3] };
}

/** True only for comments written by the Actions bot. */
export function isTrustedBotComment(comment) {
  return comment?.user?.login === BOT_LOGIN && comment?.user?.type === "Bot";
}

/** True for a trusted comment whose first line is the report marker. */
export function isReportComment(comment) {
  if (!isTrustedBotComment(comment) || typeof comment.body !== "string") return false;
  return comment.body.replace(/\r\n?/g, "\n").split("\n")[0].trim() === REPORT_MARKER;
}

/** The first trusted report comment, or null. */
export function findReportComment(comments = []) {
  return comments.find(isReportComment) ?? null;
}
