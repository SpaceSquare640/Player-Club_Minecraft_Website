// Bilingual bot comment text (English first, Traditional Chinese second) and the validation report.
// Every user-supplied value is rendered inside a code span or a fenced block, so Markdown, HTML,
// mentions and links in Issue content stay inert text. The snapshot marker is always the last line.
// The report size is bounded whatever the Issue contains: at most MAX_LISTED problems of one kind and
// points per list, and at most MAX_REPORT_LENGTH characters in total (GitHub rejects comments over 65536).

import { FORMS } from "./form-fields.mjs";
import { REPORT_MARKER, formatSnapshotMarker } from "./snapshot.mjs";
import { dimensionName } from "./changelog-templates.mjs";
import { LABELS } from "../../site/js/lib/forms-meta.js";

export const MAX_LISTED = 20;
export const MAX_REPORT_LENGTH = 60000;
const MAX_VALUE_LENGTH = 120;
const DASH = "—";

function truncate(text) {
  const chars = [...text];
  return chars.length > MAX_VALUE_LENGTH ? `${chars.slice(0, MAX_VALUE_LENGTH).join("")}…` : text;
}

/** Inline code span that is safe for any single-line value (backticks handled by a longer fence). */
export function code(value) {
  if (value === null || value === undefined || value === "") return DASH;
  const text = truncate(String(value).replace(/\r\n?|\n/g, " ↵ "));
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") || (text.startsWith(" ") && text.endsWith(" ")) ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * Code span inside a table cell: every pipe becomes "\|" preceded by a zero-width space, so a backslash
 * typed by the user can never cancel the escape and split the row.
 */
export function cell(value) {
  return code(value).replace(/\|/g, "\u200B\\|");
}

/** Fenced block for multi-line text (the fence is longer than any backtick run inside). */
export function fencedBlock(text) {
  const longest = Math.max(0, ...(String(text).match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/** Up to MAX_LISTED points; the rest is counted ("en" or "zh"). */
function pointList(points, lang, withDistance = false) {
  const listed = points
    .slice(0, MAX_LISTED)
    .map((p) => `${code(p.id)} ${code(p.name)}${withDistance ? ` (~${p.distance})` : ""}`)
    .join(", ");
  const more = points.length - MAX_LISTED;
  if (more <= 0) return listed;
  return lang === "en" ? `${listed} and ${more} more` : `${listed}，另有 ${more} 筆`;
}

/** Message templates: key -> params -> [English, Traditional Chinese]. */
const TEXT = {
  headingMissing: (p) => [
    `The heading ${code(p.heading)} is missing. Please create the issue from the form and keep its headings.`,
    `缺少標題 ${code(p.heading)}。請使用表單建立 Issue，並保留表單標題。`,
  ],
  headingDuplicate: (p) => [
    `The heading ${code(p.heading)} appears ${p.count} times; it must appear exactly once. Do not type form headings inside text fields.`,
    `標題 ${code(p.heading)} 出現 ${p.count} 次，必須恰好一次；請勿在文字欄位內輸入表單標題。`,
  ],
  headingOrder: () => ["The form headings are out of order. Please keep the layout created by the form.", "表單標題順序不正確，請保留表單產生的版面。"],
  required: (p) => [`${code(p.label)} is required.`, `${code(p.label)} 為必填。`],
  worldUnknown: (p) => [`Unknown world: ${code(p.value)}.`, `未知的世界：${code(p.value)}。`],
  dimensionUnknown: (p) => [`Unknown dimension: ${code(p.value)}.`, `未知的維度：${code(p.value)}。`],
  tagUnknown: (p) => [`Unknown tag: ${code(p.value)}.`, `未知的標籤：${code(p.value)}。`],
  f3AndXyz: () => ["Fill in either F3 coordinates or X / Y / Z, not both.", "F3 座標整串與 X / Y / Z 請擇一填寫。"],
  f3Count: (p) => [`F3 coordinates must contain exactly three numbers: ${code(p.value)}.`, `F3 座標整串必須恰好包含三個數值：${code(p.value)}。`],
  f3Format: (p) => [`F3 coordinates contain a value that is not a number: ${code(p.value)}.`, `F3 座標整串含有非數值：${code(p.value)}。`],
  coordRequired: (p) => [`${p.axis.toUpperCase()} is required when F3 coordinates is empty.`, `未填 F3 座標整串時，${p.axis.toUpperCase()} 為必填。`],
  spawnCoordRequired: (p) => [
    `${p.axis.toUpperCase()} is required for the world spawn (empty and - are not accepted).`,
    `世界出生座標的 ${p.axis.toUpperCase()} 為必填（不接受空白或 -）。`,
  ],
  coordFormat: (p) => [
    `${p.axis.toUpperCase()} is not a valid number: ${code(p.value)}. Use digits with an optional minus sign and decimal point.`,
    `${p.axis.toUpperCase()} 不是有效數值：${code(p.value)}。請使用數字，可含負號與小數點。`,
  ],
  coordRange: (p) => [
    `${p.axis.toUpperCase()} ${p.value} is outside the allowed range ${p.min} to ${p.max}.`,
    `${p.axis.toUpperCase()} ${p.value} 超出允許範圍 ${p.min} 至 ${p.max}。`,
  ],
  typeLabelMissing: () => [
    "The request type label (type:add, type:edit, type:delete or type:spawn) is missing. Please create the issue from one of the forms.",
    "缺少請求類型標籤（type:add、type:edit、type:delete 或 type:spawn），請使用表單建立 Issue。",
  ],
  typeLabelMultiple: () => ["The issue has more than one request type label; keep exactly one.", "Issue 有多個請求類型標籤，只能保留一個。"],
  spawnTargetOnEdit: (p) => [
    `${code(p.value)} is a world spawn. Use the "Edit world spawn" form instead.`,
    `${code(p.value)} 是世界出生點，請改用「修改世界出生座標」表單。`,
  ],
  spawnNotDeletable: (p) => [`The world spawn cannot be deleted: ${code(p.value)}.`, `世界出生點不可刪除：${code(p.value)}。`],
  pointIdFormat: (p) => [`${code(p.value)} is not a valid point ID (for example p0001).`, `${code(p.value)} 不是有效的座標 ID（例如 p0001）。`],
  pointNotFound: (p) => [`Point ${code(p.value)} does not exist (it may have been deleted).`, `座標 ${code(p.value)} 不存在（可能已被刪除）。`],
  pointTargetOnSpawn: (p) => [
    `${code(p.value)} is a point ID. Use the "Edit a point" form to change points.`,
    `${code(p.value)} 是座標 ID，修改座標請改用「修改座標」表單。`,
  ],
  spawnTargetFormat: (p) => [
    `${code(p.value)} is not a valid world spawn target (for example spawn:player_club).`,
    `${code(p.value)} 不是有效的世界出生點目標（例如 spawn:player_club）。`,
  ],
  worldNotFound: (p) => [`World ${code(p.value)} does not exist.`, `世界 ${code(p.value)} 不存在。`],
  noChange: () => ["Nothing would change: every value is the same as the current data.", "沒有任何實際變更：所有欄位都與目前資料相同。"],
  dimensionNotInWorld: (p) => [`World ${code(p.world)} does not have the dimension ${code(p.dimension)}.`, `世界 ${code(p.world)} 沒有 ${code(p.dimension)} 維度。`],
  tagDimension: (p) => [`Tag ${code(p.tag)} is not allowed in ${code(p.dimension)}.`, `標籤 ${code(p.tag)} 不適用於 ${code(p.dimension)}。`],
  tagEdition: (p) => [`Tag ${code(p.tag)} is not available for the ${code(p.edition)} edition.`, `標籤 ${code(p.tag)} 不適用於 ${code(p.edition)} 版本。`],
  nameEmpty: () => ["Name is empty.", "名稱為空白。"],
  nameControl: () => ["Name contains control or invisible formatting characters.", "名稱含有控制字元或隱形格式字元。"],
  nameLength: () => ["Name must be 1 to 60 characters.", "名稱須為 1–60 字。"],
  noteControl: () => ["Note contains control or invisible formatting characters.", "說明含有控制字元或隱形格式字元。"],
  noteLength: () => ["Note must be at most 500 characters.", "說明最多 500 字。"],
  confirmMissing: () => ["Please tick the confirmation box.", "請勾選確認方塊。"],
  tagRetired: (p) => [`Tag ${code(p.tag)} is retired and cannot be chosen for new use.`, `標籤 ${code(p.tag)} 已停用，不可新選用。`],
  duplicate: (p) => [
    `Another point in this world and dimension has the same X and Z: ${pointList(p.points, "en")}. The owner will check it; a duplicate is rejected when applied.`,
    `此世界與維度已有相同 X、Z 的座標：${pointList(p.points, "zh")}。擁有者會確認；寫入時重複將被拒絕。`,
  ],
  nearby: (p) => [
    `Points within ${p.distance} blocks: ${pointList(p.points, "en", true)}.`,
    `水平 ${p.distance} 格內的座標：${pointList(p.points, "zh", true)}。`,
  ],
  duplicateOnApply: (p) => [
    `Another point in this world and dimension already has the same X and Z: ${pointList(p.points, "en")}. A duplicate cannot be added.`,
    `此世界與維度已有相同 X、Z 的座標：${pointList(p.points, "zh")}，重複座標不可新增。`,
  ],
  targetChanged: () => ["The target changed after the request was validated.", "請求驗證後，目標資料已變更。"],
  sameAsSpawn: () => [
    "Same X and Z as the world spawn. The spawn is already pinned at the top of the Overworld list.",
    "與世界出生點相同，出生點已置頂顯示。",
  ],
};

/** [English, Traditional Chinese] for a problem { code, key, params }. */
export function problemText(problem) {
  const template = TEXT[problem.key];
  if (!template) return [`${problem.code} ${problem.key}`, `${problem.code} ${problem.key}`];
  return template(problem.params ?? {});
}

/**
 * List items for problems, in their original order. At most MAX_LISTED problems of one kind (same code and
 * key) are listed; the rest is counted in one item placed where the first unlisted problem would be.
 */
function problemLines(problems) {
  const counts = new Map();
  const overflow = new Map();
  const lines = [];
  for (const p of problems) {
    const kind = `${p.code} ${p.key}`;
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    if (n <= MAX_LISTED) {
      const [en, zh] = problemText(p);
      lines.push(`- **${p.code}** ${en}\n  ${zh}`);
    } else if (n === MAX_LISTED + 1) {
      overflow.set(kind, { index: lines.length, code: p.code });
      lines.push("");
    }
  }
  for (const [kind, { index, code: problemCode }] of overflow) {
    const more = counts.get(kind) - MAX_LISTED;
    lines[index] = `- **${problemCode}** … and ${more} more of the same kind (not listed).\n  另有 ${more} 筆同類問題（未列出）。`;
  }
  return lines;
}

const TRUNCATED_NOTICE = [
  "> [!WARNING]",
  "> This report was too long for a comment and has been truncated. Fix the problems above and edit the issue to validate it again.",
  "> 報告超過留言長度上限，已截斷；請先修正上方問題，再編輯 Issue 重新驗證。",
  "",
];

/**
 * Joins the report. Over MAX_REPORT_LENGTH, whole entries are dropped from the end of the body (an entry
 * such as a fenced block is never cut in half) and a notice is added; the footer with the snapshot marker is
 * always kept, so the first and last lines are unchanged.
 */
function fitReport(body, footer) {
  const full = [...body, ...footer].join("\n");
  if (full.length <= MAX_REPORT_LENGTH) return full;
  const tail = [...TRUNCATED_NOTICE, ...footer];
  let budget = MAX_REPORT_LENGTH - tail.join("\n").length - 1;
  const kept = [];
  for (const entry of body) {
    if (entry.length + 1 > budget) break;
    kept.push(entry);
    budget -= entry.length + 1;
  }
  return [...kept, "", ...tail].join("\n");
}

const KIND_NAMES = Object.fromEntries(Object.entries(FORMS).map(([kind, form]) => [kind, form.name]));

function dimensionText(dimension, dataset) {
  if (!dimension) return DASH;
  return cell(`${dimensionName(dimension, "en", dataset?.i18n)} / ${dimensionName(dimension, "zh-TW", dataset?.i18n)} (${dimension})`);
}

function tagsText(tagIds, dataset) {
  if (!Array.isArray(tagIds) || tagIds.length === 0) return DASH;
  const byId = new Map((dataset?.tags?.tags ?? []).map((t) => [t.id, t]));
  return tagIds
    .map((id) => {
      const tag = byId.get(id);
      return cell(tag ? `${tag.name.en} / ${tag.name["zh-TW"]} (${id})` : id);
    })
    .join(", ");
}

const worldText = (world, worldId) => (world ? cell(`${world.name} (${world.id})`) : cell(worldId));
const yText = (y) => (y === null || y === undefined ? `${DASH} (none / 無)` : cell(y));
const noteText = (note) => {
  if (note === null || note === undefined) return DASH;
  return note.includes("\n") ? "(see below / 見下方)" : cell(note);
};

function fieldValue(field, value, dataset) {
  switch (field) {
    case "dimension":
      return dimensionText(value, dataset);
    case "tags":
      return tagsText(value, dataset);
    case "y":
      return yText(value);
    case "note":
      return value === null || value === undefined ? DASH : cell(value);
    default:
      return cell(value);
  }
}

const FIELD_NAMES = {
  targetId: "Target / 目標",
  world: "World / 世界",
  dimension: "Dimension / 維度",
  name: "Name / 名稱",
  tags: "Tags / 標籤",
  x: "X",
  y: "Y",
  z: "Z",
  note: "Note / 說明",
  submittedBy: "Submitted by / 提交者",
};

function requestRows(result, dataset) {
  const { kind, request, world, target } = result;
  const rows = [];
  const add = (field, value) => rows.push(`| ${FIELD_NAMES[field]} | ${value} |`);
  if (kind !== "add") add("targetId", cell(request.targetId));
  if (kind === "delete") {
    const p = target?.point;
    add("world", request.worldId ? worldText(world, request.worldId) : DASH);
    if (p) {
      add("dimension", dimensionText(p.dimension, dataset));
      add("name", cell(p.name));
      add("tags", tagsText(p.tags, dataset));
      add("x", cell(p.x));
      add("y", yText(p.y));
      add("z", cell(p.z));
    }
  } else if (kind === "spawn") {
    add("world", request.worldId ? worldText(world, request.worldId) : DASH);
    add("dimension", dimensionText("overworld", dataset));
    add("x", cell(request.x));
    add("y", yText(request.y));
    add("z", cell(request.z));
  } else {
    add("world", request.worldId ? worldText(world, request.worldId) : DASH);
    add("dimension", dimensionText(request.dimension, dataset));
    add("name", cell(request.name));
    add("tags", tagsText(request.tags, dataset));
    add("x", cell(request.x));
    add("y", yText(request.y));
    add("z", cell(request.z));
    add("note", noteText(request.note));
  }
  add("submittedBy", cell(request.submittedBy));
  return rows;
}

/**
 * Renders the validation report comment.
 * @param {{ result: object, hash: string, dataset: object, approvalRemoved?: boolean, approvalReason?: "changed" | "stale" }} p
 *   approvalReason "stale": the approval was withdrawn when applying (the request, its target or the report
 *   changed after the approval); otherwise the Issue was opened, edited or reopened.
 */
export function renderReport({ result, hash, dataset, approvalRemoved = false, approvalReason = "changed" }) {
  const status = result.ok ? "pass" : "fail";
  const lines = [REPORT_MARKER];
  lines.push(result.ok ? "### Validation passed / 驗證通過" : "### Validation failed / 驗證未通過", "");
  const kindName = result.kind ? KIND_NAMES[result.kind] : "Unknown / 未知";
  lines.push(`**Request / 請求：** ${kindName}`, "");

  if (approvalRemoved && approvalReason === "stale") {
    lines.push(
      "> [!IMPORTANT]",
      `> The ${code(LABELS.approved)} label was removed because the request or its target changed after it was reviewed, or the approval came before this report. The owner must review it again.`,
      `> 由於請求或其目標在審核後已變更，或核准早於本報告，${code(LABELS.approved)} 標籤已移除，需擁有者重新審核。`,
      "",
    );
  } else if (approvalRemoved) {
    lines.push(
      "> [!IMPORTANT]",
      `> The ${code(LABELS.approved)} label was removed because the issue was opened, edited or reopened. The owner must review it again.`,
      `> 由於 Issue 已開啟、編輯或重新開啟，${code(LABELS.approved)} 標籤已移除，需擁有者重新審核。`,
      "",
    );
  }

  if (result.kind) {
    lines.push("#### Normalized request / 正規化後內容", "", "| Field / 欄位 | Value / 值 |", "| --- | --- |", ...requestRows(result, dataset), "");
    if (typeof result.request.note === "string" && result.request.note.includes("\n") && result.kind !== "delete") {
      lines.push("Note / 說明：", "", fencedBlock(result.request.note), "");
    }
  }

  if (result.diff.length > 0) {
    lines.push("#### Changes / 修改差異", "", "| Field / 欄位 | Current / 原值 | Requested / 新值 |", "| --- | --- | --- |");
    for (const { field, before, after } of result.diff) {
      lines.push(`| ${FIELD_NAMES[field] ?? field} | ${fieldValue(field, before, dataset)} | ${fieldValue(field, after, dataset)} |`);
    }
    lines.push("");
  }

  if (result.errors.length > 0) lines.push("#### Problems / 問題", "", ...problemLines(result.errors), "");
  if (result.warnings.length > 0) lines.push("#### Warnings / 警告", "", ...problemLines(result.warnings), "");
  if (result.hints.length > 0) lines.push("#### Hints / 提示", "", ...problemLines(result.hints), "");

  const footer = ["---", ""];
  if (result.ok) {
    footer.push(
      `**Owner / 擁有者：** review the data above and add the ${code(LABELS.approved)} label to apply it. Editing the issue removes the approval and runs validation again.`,
      `確認上方資料後加上 ${code(LABELS.approved)} 標籤即會寫入；編輯 Issue 會移除核准並重新驗證。`,
    );
  } else {
    footer.push(
      "**Submitter / 提交者：** edit this issue to fix the problems above; validation runs again automatically.",
      "請編輯此 Issue 修正上述問題，儲存後會自動重新驗證。",
    );
  }
  footer.push("", `Snapshot / 快照：${code(`sha256:${hash}`)}`, formatSnapshotMarker({ status, hash }));
  return fitReport(lines, footer);
}

// ---------------------------------------------------------------------------
// Result comments of apply-approved (one new comment per outcome). They carry no snapshot and are never
// trusted as input; user values only appear inside code spans.

export const RESULT_MARKER = "<!-- pcmw:result -->";

const STALE_REASONS = {
  noReport: ["No validation report was found for this request.", "找不到此請求的驗證報告。"],
  reportFailed: ["The latest validation report did not pass.", "最新的驗證報告未通過。"],
  approvedBeforeReport: ["The approval was given before the latest validation report was written.", "核准早於最新的驗證報告。"],
  hashMismatch: ["The request or the data it changes was modified after it was validated.", "請求內容或其目標資料在驗證後已變更。"],
  invalidNow: ["The request no longer passes validation with the current data.", "以目前資料驗證，此請求已不再通過。"],
};

/** The approved label was added by an account that is not an approver. */
export function renderUnauthorizedComment() {
  return [
    RESULT_MARKER,
    "### Approval not accepted / 核准未被接受",
    "",
    `The ${code(LABELS.approved)} label was added by an account that is not an approver, so it has been removed. Only the site owner can approve requests.`,
    `${code(LABELS.approved)} 標籤由非核准者加上，已移除；只有網站擁有者可以核准請求。`,
  ].join("\n");
}

/** The approval no longer matches the request; it was withdrawn and the request validated again. */
export function renderStaleComment({ reason }) {
  const [en, zh] = STALE_REASONS[reason] ?? STALE_REASONS.hashMismatch;
  return [
    RESULT_MARKER,
    "### Approval withdrawn / 核准已撤回",
    "",
    en,
    zh,
    "",
    `The approval was removed and the request was validated again (see the report comment). The owner must review it and add ${code(LABELS.approved)} again.`,
    `已移除核准並重新驗證（見報告留言）；需擁有者重新審核後再加上 ${code(LABELS.approved)}。`,
  ].join("\n");
}

/** Data validation issues are technical English; each is shown as one code span. */
function dataIssueLines(issues) {
  const lines = issues.slice(0, MAX_LISTED).map((i) => `- ${code(`${i.code} ${i.file}${i.path ? `#${i.path}` : ""}: ${i.message}`)}`);
  if (issues.length > MAX_LISTED) lines.push(`- … and ${issues.length - MAX_LISTED} more (not listed) / 另有 ${issues.length - MAX_LISTED} 筆（未列出）`);
  return lines;
}

/** The approved request could not be applied (duplicate, changed target or invalid data after applying). */
export function renderRejectedComment({ problems = [], dataIssues = [] } = {}) {
  const lines = [
    RESULT_MARKER,
    "### Request not applied / 請求未寫入",
    "",
    "The request could not be applied, so the approval was removed.",
    "請求無法寫入，已移除核准。",
    "",
  ];
  if (problems.length > 0) lines.push("#### Problems / 問題", "", ...problemLines(problems), "");
  if (dataIssues.length > 0) lines.push("#### Data validation / 資料驗證", "", ...dataIssueLines(dataIssues), "");
  lines.push(
    "Edit the issue if the request needs to change; the owner can approve it again afterwards.",
    "如需調整請編輯 Issue，之後擁有者可再次核准。",
  );
  return lines.join("\n");
}

/** Written and published. url is built from config.siteUrl and validated ids only. */
export function renderAppliedComment({ url, pointId = null }) {
  const lines = [RESULT_MARKER, "### Applied / 已寫入", "", `The request was applied and published: ${url}`, `請求已寫入並發布：${url}`];
  if (pointId) lines.push("", `Point ID / 座標 ID：${code(pointId)}`);
  lines.push(
    "",
    "> [!NOTE]",
    "> The site can take about 10 minutes to show the change (page cache).",
    "> 網站快取約 10 分鐘，更新可能稍後才會顯示。",
  );
  return lines.join("\n");
}

/** Written, but the deployment failed; the next run deploys again and closes the Issue. */
export function renderDeployFailedComment() {
  return [
    RESULT_MARKER,
    "### Publishing failed / 發布失敗",
    "",
    `The request was written to the data, but publishing the site failed. The ${code(LABELS.approved)} label is kept; the next scheduled run (daily) or a manual run publishes the site again and closes this issue.`,
    `請求已寫入資料，但網站發布失敗。${code(LABELS.approved)} 標籤保留，下次排程（每日）或手動執行時會重新發布並關閉此 Issue。`,
  ].join("\n");
}
