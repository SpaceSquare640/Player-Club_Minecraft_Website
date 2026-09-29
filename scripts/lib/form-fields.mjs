// Issue Form field definitions shared by the form generator (gen-issue-forms.mjs) and the Issue parser
// (issue-parse.mjs). The label of every non-markdown field is also the "### <label>" heading GitHub writes
// into the Issue body, so changing a label breaks parsing of open Issues created with the old forms.
// Bilingual text is English first, Traditional Chinese second.

import { FORM_FIELDS, ISSUE_TEMPLATES, LABELS, TYPE_LABELS } from "../../site/js/lib/forms-meta.js";

export const REQUEST_KINDS = ["add", "edit", "delete", "spawn"];

/** Heading labels. Keys are internal; values are written to the forms and parsed back. */
export const FIELD_LABELS = Object.freeze({
  world: "World / 世界",
  dimension: "Dimension / 維度",
  name: "Name / 名稱",
  tags: "Tags / 標籤",
  f3: "F3 coordinates / F3 座標整串",
  x: "X",
  y: "Y",
  yOptional: "Y (optional) / Y（選填）",
  z: "Z",
  note: "Note / 說明",
  noteOptional: "Note (optional) / 說明（選填）",
  confirm: "Confirmation / 確認",
  pointId: "Point ID / 座標 ID",
  spawnTarget: "World spawn / 世界出生點",
  reason: "Reason (optional) / 原因（選填）",
});

export const CONFIRM_LABELS = Object.freeze({
  add: "This point may be made public, and my GitHub account will be shown as the submitter. / 此座標可公開，且我的 GitHub 帳號將顯示為提交者。",
  edit: "These changes may be made public, and my GitHub account will be shown in this issue. / 修改內容可公開，且我的 GitHub 帳號將顯示於此 Issue。",
  delete: "I confirm that this point should be deleted. / 我確認刪除此座標。",
  spawn: "This world spawn may be made public, and my GitHub account will be shown in this issue. / 此出生座標可公開，且我的 GitHub 帳號將顯示於此 Issue。",
});

/** Values treated as empty: GitHub writes "_No response_" for empty fields and "None" for unselected dropdowns. */
export const NO_RESPONSE = "_No response_";
export const DROPDOWN_NONE = "None";

/** Option suffix "(id)" at the end of a dropdown option. */
export const OPTION_ID_RE = /\(([a-z][a-z0-9_]*)\)$/;

const PLACEHOLDER_F3 = "XYZ: 7.534 / 103.00000 / 5.699";

const f3Field = (description) => ({
  id: "f3",
  type: "input",
  label: FIELD_LABELS.f3,
  description,
  placeholder: PLACEHOLDER_F3,
  required: false,
});
const coordField = (id, label, description, required = false) => ({ id, type: "input", label, description, required });

/**
 * Form definitions. Field types: markdown (not in the body), dropdown, input, textarea, checkboxes.
 * Dropdown options come from data: "worlds", "dimensions" or "tags" (see gen-issue-forms.mjs).
 * markdown values are functions of the generator context ({ config, tagTable }).
 */
export const FORMS = Object.freeze({
  add: {
    kind: "add",
    file: ISSUE_TEMPLATES.add,
    name: "Add a point / 新增座標",
    description: "Submit a new coordinate for review. / 提交新座標，待擁有者審核。",
    title: "[Add / 新增] ",
    labels: [LABELS.coordRequest, TYPE_LABELS.add],
    fields: [
      {
        type: "markdown",
        value: ({ config }) =>
          [
            "**One point per issue.** Everything you submit is public, and your GitHub account is shown as the submitter.",
            "**一個 Issue 只提交一筆座標。** 提交內容會公開，你的 GitHub 帳號將顯示為提交者。",
            "",
            "How to get coordinates: in Java Edition press F3 and copy the `XYZ` or `Block` line; in Bedrock Edition turn on Show Coordinates. Paste the whole line into **F3 coordinates**, or fill in **X / Y / Z** instead.",
            "取得座標：Java 版按 F3 複製 `XYZ` 或 `Block` 那一行；基岩版開啟「顯示座標」。將整行貼到「F3 座標整串」，或改填 X / Y / Z。",
            "",
            `No GitHub account? Join our Discord and ask the owner to add it for you: ${config.discordInviteUrl}`,
            `沒有 GitHub 帳號？請加入 Discord，由擁有者代為登錄：${config.discordInviteUrl}`,
          ].join("\n"),
      },
      { id: "world", type: "dropdown", label: FIELD_LABELS.world, options: "worlds", required: true },
      { id: "dimension", type: "dropdown", label: FIELD_LABELS.dimension, options: "dimensions", required: true },
      { id: "name", type: "input", label: FIELD_LABELS.name, description: "1-60 characters. / 1–60 字。", required: true },
      { type: "markdown", value: ({ tagTable }) => tagTable },
      {
        id: "tags",
        type: "dropdown",
        label: FIELD_LABELS.tags,
        description: "At least one tag; each tag must be allowed in the chosen dimension (see the table above). / 至少一個標籤，且須符合所選維度（見上表）。",
        options: "tags",
        multiple: true,
        required: true,
      },
      f3Field("Paste the whole F3 line, or leave empty and fill in X / Y / Z. / 貼上整行 F3 座標，或留空改填 X / Y / Z。"),
      coordField("x", FIELD_LABELS.x, "Required when F3 coordinates is empty. / 未填 F3 座標時必填。"),
      coordField("y", FIELD_LABELS.yOptional, "Leave empty or enter - when unknown. / 未知時留空或填 -。"),
      coordField("z", FIELD_LABELS.z, "Required when F3 coordinates is empty. / 未填 F3 座標時必填。"),
      { id: "note", type: "textarea", label: FIELD_LABELS.noteOptional, description: "Up to 500 characters. / 最多 500 字。", required: false },
      { id: "confirm", type: "checkboxes", label: FIELD_LABELS.confirm, option: CONFIRM_LABELS.add, required: true },
    ],
  },
  edit: {
    kind: "edit",
    file: ISSUE_TEMPLATES.edit,
    name: "Edit a point / 修改座標",
    description: "Request changes to an existing point. / 申請修改既有座標。",
    title: "[Edit / 修改] ",
    labels: [LABELS.coordRequest, TYPE_LABELS.edit],
    fields: [
      {
        id: FORM_FIELDS.targetId,
        type: "input",
        label: FIELD_LABELS.pointId,
        description: "Use the card menu on the website to prefill it, e.g. p0001. / 可由網站卡片選單預填，例如 p0001。",
        placeholder: "p0001",
        required: true,
      },
      {
        type: "markdown",
        value: () =>
          [
            "Leave a field empty to keep it unchanged. Enter `-` in **Y** or **Note** to clear it. The world cannot be changed.",
            "欄位留空表示不變；Y 或說明填 `-` 表示清除。無法更換世界。",
            "",
            "Choosing tags replaces all tags. Filling **F3 coordinates** replaces X, Y and Z together.",
            "選擇標籤會整組取代原標籤；填寫 F3 座標會整組取代 X、Y、Z。",
          ].join("\n"),
      },
      { id: "dimension", type: "dropdown", label: FIELD_LABELS.dimension, options: "dimensions", required: false },
      { id: "name", type: "input", label: FIELD_LABELS.name, required: false },
      { type: "markdown", value: ({ tagTable }) => tagTable },
      {
        id: "tags",
        type: "dropdown",
        label: FIELD_LABELS.tags,
        description: "Replaces all tags when filled. / 填寫即整組取代。",
        options: "tags",
        multiple: true,
        required: false,
      },
      f3Field("Replaces X, Y and Z together; do not fill X / Y / Z at the same time. / 整組取代 X、Y、Z，請勿同時填寫 X / Y / Z。"),
      coordField("x", FIELD_LABELS.x),
      coordField("y", FIELD_LABELS.y, "Enter - to clear. / 填 - 表示清除。"),
      coordField("z", FIELD_LABELS.z),
      { id: "note", type: "textarea", label: FIELD_LABELS.note, description: "Enter - to clear. / 填 - 表示清除。", required: false },
      { id: "reason", type: "textarea", label: FIELD_LABELS.reason, description: "Not saved to the data. / 不會寫入資料。", required: false },
      { id: "confirm", type: "checkboxes", label: FIELD_LABELS.confirm, option: CONFIRM_LABELS.edit, required: true },
    ],
  },
  delete: {
    kind: "delete",
    file: ISSUE_TEMPLATES.delete,
    name: "Delete a point / 刪除座標",
    description: "Request the removal of a point. / 申請刪除座標。",
    title: "[Delete / 刪除] ",
    labels: [LABELS.coordRequest, TYPE_LABELS.delete],
    fields: [
      {
        id: FORM_FIELDS.targetId,
        type: "input",
        label: FIELD_LABELS.pointId,
        description: "Use the card menu on the website to prefill it, e.g. p0001. The world spawn cannot be deleted. / 可由網站卡片選單預填，例如 p0001。世界出生點不可刪除。",
        placeholder: "p0001",
        required: true,
      },
      { id: "reason", type: "textarea", label: FIELD_LABELS.reason, description: "Not saved to the data. / 不會寫入資料。", required: false },
      { id: "confirm", type: "checkboxes", label: FIELD_LABELS.confirm, option: CONFIRM_LABELS.delete, required: true },
    ],
  },
  spawn: {
    kind: "spawn",
    file: ISSUE_TEMPLATES.spawn,
    name: "Edit world spawn / 修改世界出生座標",
    description: "Request a new world spawn (Overworld). / 申請修改世界出生座標（主世界）。",
    title: "[Spawn / 出生點] ",
    labels: [LABELS.coordRequest, TYPE_LABELS.spawn],
    fields: [
      {
        id: FORM_FIELDS.targetId,
        type: "input",
        label: FIELD_LABELS.spawnTarget,
        description: "Use the pinned spawn card menu on the website to prefill it, e.g. spawn:player_club. / 可由網站置頂出生點卡片選單預填，例如 spawn:player_club。",
        placeholder: "spawn:player_club",
        required: true,
      },
      {
        type: "markdown",
        value: () =>
          [
            "The world spawn is part of the world data and belongs to the Overworld. X, Y and Z are all required and replace the current spawn together. The spawn cannot be deleted.",
            "世界出生座標屬於世界資料（主世界）。X、Y、Z 皆必填，並整組取代目前的出生座標；出生座標不可刪除。",
          ].join("\n"),
      },
      f3Field("Paste the whole F3 line, or leave empty and fill in X, Y and Z. / 貼上整行 F3 座標，或留空改填 X、Y、Z。"),
      coordField("x", FIELD_LABELS.x, "Required when F3 coordinates is empty. / 未填 F3 座標時必填。"),
      coordField("y", FIELD_LABELS.y, "Required when F3 coordinates is empty; - is not accepted. / 未填 F3 座標時必填，不接受 -。"),
      coordField("z", FIELD_LABELS.z, "Required when F3 coordinates is empty. / 未填 F3 座標時必填。"),
      { id: "reason", type: "textarea", label: FIELD_LABELS.reason, description: "Not saved to the data. / 不會寫入資料。", required: false },
      { id: "confirm", type: "checkboxes", label: FIELD_LABELS.confirm, option: CONFIRM_LABELS.spawn, required: true },
    ],
  },
});

/** Fields that appear in the Issue body (every type except markdown), in form order. */
export function bodyFields(kind) {
  const form = FORMS[kind];
  if (!form) throw new RangeError(`Unknown request kind: ${kind}`);
  return form.fields.filter((f) => f.type !== "markdown");
}
