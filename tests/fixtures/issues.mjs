// Issue fixtures: bodies rendered the way GitHub renders Issue Forms ("### <label>", blank line, value),
// Issue objects and "issues" event payloads.

import { bodyFields } from "../../scripts/lib/form-fields.mjs";
import { LABELS, TYPE_LABELS } from "../../site/js/lib/forms-meta.js";

/**
 * Renders an Issue body for a form. values: { [fieldId]: string | string[] | boolean }.
 * Missing values become "_No response_"; checkboxes default to ticked (pass false to leave empty).
 */
export function renderBody(kind, values = {}) {
  return bodyFields(kind)
    .map((field) => {
      let value = values[field.id];
      if (field.type === "checkboxes") value = `- [${value === false ? " " : "X"}] ${field.option}`;
      else if (Array.isArray(value)) value = value.join(", ");
      if (value === undefined || value === "") value = "_No response_";
      return `### ${field.label}\n\n${value}`;
    })
    .join("\n\n");
}

export const ADD_VALUES = Object.freeze({
  world: "Player_Club (player_club)",
  dimension: "Overworld / 主世界 (overworld)",
  name: "My Base",
  tags: ["Base / 基地 (base)"],
  x: "100",
  y: "64",
  z: "-200",
  note: "Near the river",
});

export function createIssue(kind, values, { number = 12, login = "friend-01", labels } = {}) {
  return {
    number,
    state: "open",
    title: "[Add / 新增] test",
    body: renderBody(kind, values),
    user: { login, type: "User" },
    labels: (labels ?? [LABELS.coordRequest, TYPE_LABELS[kind]]).map((name) => ({ name })),
  };
}

export function createEvent(action, issue) {
  return {
    action,
    issue,
    repository: { name: "Player-Club_Minecraft_Website", owner: { login: "SpaceSquare640" } },
    sender: { login: issue.user.login, type: "User" },
  };
}
