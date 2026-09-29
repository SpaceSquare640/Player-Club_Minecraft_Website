// Issue body parsing and request rules R01-R09 (architecture 3.5 / 3.12), shared by validate-issue and apply.
// Issue content is untrusted data: it is only parsed here, never executed, evaluated or passed to a shell.
// Problems are returned as { code, key, params } (rendered by messages.mjs); nothing is thrown for bad input.

import { DIMENSION_ORDER } from "../../site/js/lib/coords.js";
import { TYPE_LABELS } from "../../site/js/lib/forms-meta.js";
import { isStandardId } from "../../site/js/lib/ids.js";
import { resolveBounds } from "../../site/js/lib/version.js";
import { POINT_FIELDS, SPAWN_FIELDS } from "./changelog-templates.mjs";
import { DROPDOWN_NONE, FORMS, NO_RESPONSE, OPTION_ID_RE, REQUEST_KINDS, bodyFields } from "./form-fields.mjs";
import {
  isAxisInBounds,
  normalizeName,
  normalizeNote,
  normalizeNumberText,
  normalizeTargetId,
  parseCoordinate,
  parseF3,
  parseOptionalY,
} from "./normalize.mjs";

export const SPAWN_TARGET_RE = /^spawn:([a-z][a-z0-9_]{1,31})$/;
export const NEARBY_DISTANCE = 16;
const MULTI_SEPARATOR = ", ";
const CHECKED_RE = /^\s*[-*] \[[xX]\] (.+)$/;
const AXES = ["x", "y", "z"];

/** CRLF / CR to LF. */
export function normalizeLineEndings(text) {
  return String(text ?? "").replace(/\r\n?/g, "\n");
}

const labelNames = (labels) =>
  (Array.isArray(labels) ? labels : []).map((l) => (typeof l === "string" ? l : l?.name)).filter((n) => typeof n === "string");

/** Label names of an Issue (labels may be strings or { name } objects). */
export const issueLabelNames = labelNames;

/**
 * Request kind from the type:* labels. Exactly one type label is required.
 * @returns {{ kind: string | null, count: number }}
 */
export function requestKindFromLabels(labels) {
  const names = labelNames(labels);
  const kinds = REQUEST_KINDS.filter((k) => names.includes(TYPE_LABELS[k]));
  return { kind: kinds.length === 1 ? kinds[0] : null, count: kinds.length };
}

/** Id from a dropdown option "Text (id)", or null. */
export function optionId(text) {
  const m = OPTION_ID_RE.exec(String(text ?? "").trim());
  return m ? m[1] : null;
}

/** True when a checkboxes section contains "- [X] <option>" for the expected option text. */
export function isChecked(value, option) {
  return normalizeLineEndings(value)
    .split("\n")
    .some((line) => {
      const m = CHECKED_RE.exec(line);
      return m !== null && m[1].trim() === option;
    });
}

/**
 * Splits an Issue body into field values by the "### <label>" headings of the form.
 * R01: every expected heading appears exactly once and in form order (a heading typed inside a text
 * field therefore fails), and required fields are not empty. "_No response_" and, for dropdowns, "None"
 * are empty values.
 * @returns {{ values: object | null, errors: object[] }}
 */
export function parseIssueBody(body, kind) {
  const fields = bodyFields(kind);
  const lines = normalizeLineEndings(body).split("\n");
  const errors = [];
  const positions = [];
  for (const field of fields) {
    const heading = `### ${field.label}`;
    const found = [];
    lines.forEach((line, i) => {
      if (line.trim() === heading) found.push(i);
    });
    if (found.length === 1) positions.push({ field, line: found[0] });
    else errors.push({ code: "R01", key: found.length === 0 ? "headingMissing" : "headingDuplicate", params: { heading, count: found.length } });
  }
  if (errors.length > 0) return { values: null, errors };
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i].line < positions[i - 1].line) return { values: null, errors: [{ code: "R01", key: "headingOrder", params: {} }] };
  }
  const values = {};
  positions.forEach(({ field, line }, i) => {
    const end = i + 1 < positions.length ? positions[i + 1].line : lines.length;
    let value = lines.slice(line + 1, end).join("\n").trim();
    if (value === NO_RESPONSE || (field.type === "dropdown" && value === DROPDOWN_NONE)) value = "";
    values[field.id] = value;
  });
  for (const field of fields) {
    if (field.required && field.type !== "checkboxes" && values[field.id] === "") {
      errors.push({ code: "R01", key: "required", params: { label: field.label } });
    }
  }
  return { values, errors };
}

// ---------------------------------------------------------------------------
// Evaluation against the data set

function createContext(dataset) {
  const worldById = new Map(dataset.worlds.worlds.map((w) => [w.id, w]));
  const editionById = new Map(dataset.editions.editions.map((e) => [e.id, e]));
  const tagById = new Map(dataset.tags.tags.map((t) => [t.id, t]));
  const tagOrder = new Map(dataset.tags.tags.map((t, i) => [t.id, i]));
  const pointIndex = new Map();
  for (const [worldId, file] of Object.entries(dataset.points ?? {})) {
    for (const point of file?.points ?? []) {
      if (!pointIndex.has(point.id)) pointIndex.set(point.id, { worldId, point });
    }
  }
  return {
    dataset,
    worldById,
    tagById,
    pointIndex,
    sortTags: (ids) => [...ids].sort((a, b) => tagOrder.get(a) - tagOrder.get(b)),
    boundsOf(world) {
      const edition = world ? editionById.get(world.edition) : undefined;
      if (!edition) return null;
      try {
        return resolveBounds(edition, world.gameVersion);
      } catch {
        return null;
      }
    },
  };
}

function parseDimension(raw, errors) {
  if (raw === "") return null;
  const id = optionId(raw);
  if (!id || !DIMENSION_ORDER.includes(id)) {
    errors.push({ code: "R02", key: "dimensionUnknown", params: { value: raw } });
    return null;
  }
  return id;
}

function parseTags(ctx, raw, errors) {
  const ids = [];
  for (const option of raw.split(MULTI_SEPARATOR).map((s) => s.trim()).filter(Boolean)) {
    const id = optionId(option);
    if (!id || !ctx.tagById.has(id)) {
      errors.push({ code: "R02", key: "tagUnknown", params: { value: option } });
    } else if (!ids.includes(id)) {
      ids.push(id);
    }
  }
  return ctx.sortTags(ids);
}

/** X08 on the resulting tags: each tag allowed in the dimension and the world edition. */
function checkTagRules(ctx, tagIds, dimension, world, errors) {
  for (const id of tagIds) {
    const tag = ctx.tagById.get(id);
    if (!tag) continue;
    if (dimension && !tag.dimensions.includes(dimension)) errors.push({ code: "X08", key: "tagDimension", params: { tag: id, dimension } });
    if (world && tag.editions && !tag.editions.includes(world.edition)) {
      errors.push({ code: "X08", key: "tagEdition", params: { tag: id, edition: world.edition } });
    }
  }
}

/** R09: newly chosen tags must not be retired. */
function checkRetired(ctx, tagIds, previous, errors) {
  for (const id of tagIds) {
    if (ctx.tagById.get(id)?.retired && !previous.includes(id)) errors.push({ code: "R09", key: "tagRetired", params: { tag: id } });
  }
}

function textValue(result, field, errors) {
  if (result.error) {
    errors.push({ code: "R07", key: `${field}${result.error[0].toUpperCase()}${result.error.slice(1)}`, params: {} });
    return undefined;
  }
  return result.empty ? null : result.value;
}

/**
 * Coordinates of the form. mode "add": X and Z required, Y optional ("-" or empty is no Y);
 * "edit": every value optional (undefined = unchanged, Y "-" = clear); "spawn": X, Y and Z required.
 * The F3 field and X / Y / Z are mutually exclusive.
 * @returns {{ source: "f3" | "xyz", x, y, z } | null} null when nothing usable was given
 */
function parseCoords(values, mode, errors) {
  const f3 = values.f3 ?? "";
  const hasXyz = AXES.some((a) => (values[a] ?? "") !== "");
  if (f3 !== "") {
    if (hasXyz) {
      errors.push({ code: "R03", key: "f3AndXyz", params: {} });
      return null;
    }
    const r = parseF3(f3);
    if (r.error) {
      errors.push({ code: "R03", key: r.error === "count" ? "f3Count" : "f3Format", params: { value: f3 } });
      return null;
    }
    return { source: "f3", ...r };
  }
  const coords = { source: "xyz" };
  for (const axis of AXES) {
    const raw = values[axis] ?? "";
    if (axis === "y" && mode !== "spawn") {
      const r = parseOptionalY(raw);
      if (r.error) errors.push({ code: "R03", key: "coordFormat", params: { axis, value: raw } });
      else if (r.empty) coords.y = mode === "add" ? null : undefined;
      else coords.y = r.clear ? null : r.value;
      continue;
    }
    if (raw === "") {
      if (mode === "edit") coords[axis] = undefined;
      else errors.push({ code: "R03", key: mode === "spawn" ? "spawnCoordRequired" : "coordRequired", params: { axis } });
      continue;
    }
    if (axis === "y" && normalizeNumberText(raw).trim() === "-") {
      errors.push({ code: "R03", key: "spawnCoordRequired", params: { axis } });
      continue;
    }
    const r = parseCoordinate(raw);
    if (r.error) errors.push({ code: "R03", key: "coordFormat", params: { axis, value: raw } });
    else coords[axis] = r.value;
  }
  return coords;
}

function checkRange(coords, bounds, errors) {
  if (!coords || !bounds) return;
  for (const axis of AXES) {
    const value = coords[axis];
    if (typeof value !== "number") continue;
    if (!isAxisInBounds(axis, value, bounds)) {
      const [min, max] = axis === "y" ? [bounds.yMin, bounds.yMax] : [-bounds.xzAbsMax, bounds.xzAbsMax];
      errors.push({ code: "R03", key: "coordRange", params: { axis, value, min, max } });
    }
  }
}

/** Point target of edit / delete requests (R04). */
function resolvePointTarget(ctx, raw, kind, errors) {
  const id = normalizeTargetId(raw);
  if (id === "") return { id, target: null };
  if (id.startsWith("spawn:")) {
    errors.push({ code: "R04", key: kind === "delete" ? "spawnNotDeletable" : "spawnTargetOnEdit", params: { value: id } });
    return { id, target: null };
  }
  if (!isStandardId(id, "p")) {
    errors.push({ code: "R04", key: "pointIdFormat", params: { value: id } });
    return { id, target: null };
  }
  const found = ctx.pointIndex.get(id);
  if (!found) {
    errors.push({ code: "R04", key: "pointNotFound", params: { value: id } });
    return { id, target: null };
  }
  return { id, target: found };
}

const sameTags = (a = [], b = []) => a.length === b.length && a.every((t) => b.includes(t));
const orNull = (v) => (v === undefined ? null : v);

function evaluateAdd(ctx, values, result) {
  const { errors } = result;
  const worldId = values.world === "" ? null : optionId(values.world);
  const world = worldId ? ctx.worldById.get(worldId) : undefined;
  if (values.world !== "" && !world) errors.push({ code: "R02", key: "worldUnknown", params: { value: values.world } });
  const dimension = parseDimension(values.dimension, errors);
  if (world && dimension && !world.dimensions.includes(dimension)) {
    errors.push({ code: "X07", key: "dimensionNotInWorld", params: { dimension, world: world.id } });
  }
  const name = values.name === "" ? null : textValue(normalizeName(values.name), "name", errors);
  const tags = values.tags === "" ? [] : parseTags(ctx, values.tags, errors);
  checkRetired(ctx, tags, [], errors);
  checkTagRules(ctx, tags, dimension, world, errors);
  const coords = parseCoords(values, "add", errors);
  checkRange(coords, ctx.boundsOf(world), errors);
  const note = values.note === "" ? null : textValue(normalizeNote(values.note), "note", errors);

  result.world = world ?? null;
  Object.assign(result.request, {
    worldId: world ? world.id : null,
    dimension,
    name: orNull(name),
    tags: tags.length > 0 ? tags : null,
    x: orNull(coords?.x),
    y: orNull(coords?.y),
    z: orNull(coords?.z),
    note: orNull(note),
  });

  // R06 duplicates (warning at validation), nearby points and the world spawn (hints)
  if (!world || !dimension || !coords || !Number.isInteger(coords.x) || !Number.isInteger(coords.z)) return;
  const others = (ctx.dataset.points[world.id]?.points ?? []).filter((p) => p.dimension === dimension);
  const duplicates = others.filter((p) => p.x === coords.x && p.z === coords.z);
  if (duplicates.length > 0) {
    result.warnings.push({ code: "R06", key: "duplicate", params: { points: duplicates.map((p) => ({ id: p.id, name: p.name })) } });
  }
  const nearby = others
    .filter((p) => !(p.x === coords.x && p.z === coords.z))
    .map((p) => ({ id: p.id, name: p.name, distance: Math.hypot(p.x - coords.x, p.z - coords.z) }))
    .filter((p) => p.distance <= NEARBY_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .map((p) => ({ ...p, distance: Math.round(p.distance) }));
  if (nearby.length > 0) result.hints.push({ code: "R06", key: "nearby", params: { points: nearby, distance: NEARBY_DISTANCE } });
  if (dimension === "overworld" && world.spawn && world.spawn.x === coords.x && world.spawn.z === coords.z) {
    result.hints.push({ code: "R06", key: "sameAsSpawn", params: {} });
  }
}

function evaluateEdit(ctx, values, result) {
  const { errors } = result;
  const { id, target } = resolvePointTarget(ctx, values.target_id, "edit", errors);
  result.request.targetId = id || null;

  const dimension = values.dimension === "" ? undefined : parseDimension(values.dimension, errors) ?? undefined;
  const name = values.name === "" ? undefined : textValue(normalizeName(values.name), "name", errors);
  const tags = values.tags === "" ? undefined : parseTags(ctx, values.tags, errors);
  const coords = parseCoords(values, "edit", errors);
  let note;
  if (values.note !== "") note = normalizeNumberText(values.note).trim() === "-" ? null : textValue(normalizeNote(values.note), "note", errors);
  if (!target) return;

  const base = target.point;
  const world = ctx.worldById.get(target.worldId);
  result.world = world ?? null;
  result.target = target;
  const pick = (value, fallback) => (value === undefined ? fallback : value);
  const final = {
    name: pick(name, base.name),
    dimension: pick(dimension, base.dimension),
    tags: tags === undefined || tags.length === 0 ? base.tags : tags,
    x: pick(coords?.x, base.x),
    y: pick(coords?.y, base.y),
    z: pick(coords?.z, base.z),
    note: pick(note, base.note ?? null),
  };
  if (world && !world.dimensions.includes(final.dimension)) {
    errors.push({ code: "X07", key: "dimensionNotInWorld", params: { dimension: final.dimension, world: world.id } });
  }
  checkRetired(ctx, final.tags, base.tags, errors);
  checkTagRules(ctx, final.tags, final.dimension, world, errors);
  checkRange(coords, ctx.boundsOf(world), errors);

  const baseValues = { ...base, note: base.note ?? null };
  const changed = POINT_FIELDS.filter((f) => (f === "tags" ? !sameTags(baseValues.tags, final.tags) : baseValues[f] !== final[f]));
  result.changedFields = changed;
  result.diff = changed.map((field) => ({ field, before: orNull(baseValues[field]), after: final[field] }));
  if (changed.length === 0 && !errors.some((e) => ["R02", "R03", "R07"].includes(e.code))) {
    errors.push({ code: "R05", key: "noChange", params: {} });
  }
  Object.assign(result.request, {
    baseUpdatedAt: base.updatedAt,
    worldId: target.worldId,
    dimension: final.dimension,
    name: final.name,
    tags: final.tags,
    x: final.x,
    y: final.y,
    z: final.z,
    note: final.note,
  });
}

function evaluateDelete(ctx, values, result) {
  const { id, target } = resolvePointTarget(ctx, values.target_id, "delete", result.errors);
  result.request.targetId = id || null;
  if (!target) return;
  result.world = ctx.worldById.get(target.worldId) ?? null;
  result.target = target;
  Object.assign(result.request, { baseUpdatedAt: target.point.updatedAt, worldId: target.worldId });
}

function evaluateSpawn(ctx, values, result) {
  const { errors } = result;
  const id = normalizeTargetId(values.target_id);
  result.request.targetId = id || null;
  const coords = parseCoords(values, "spawn", errors);
  if (id === "") return;
  const m = SPAWN_TARGET_RE.exec(id);
  if (!m) {
    errors.push({ code: "R04", key: isStandardId(id, "p") ? "pointTargetOnSpawn" : "spawnTargetFormat", params: { value: id } });
    return;
  }
  const world = ctx.worldById.get(m[1]);
  if (!world) {
    errors.push({ code: "R04", key: "worldNotFound", params: { value: m[1] } });
    return;
  }
  result.world = world;
  checkRange(coords, ctx.boundsOf(world), errors);
  const base = { x: world.spawn.x, y: world.spawn.y, z: world.spawn.z };
  const final = { x: pick0(coords?.x, base.x), y: pick0(coords?.y, base.y), z: pick0(coords?.z, base.z) };
  const changed = SPAWN_FIELDS.filter((f) => base[f] !== final[f]);
  result.changedFields = changed;
  result.diff = changed.map((field) => ({ field, before: base[field], after: final[field] }));
  if (changed.length === 0 && !errors.some((e) => e.code === "R03")) errors.push({ code: "R05", key: "noChange", params: {} });
  Object.assign(result.request, { baseSpawn: base, worldId: world.id, x: final.x, y: final.y, z: final.z });
}

const pick0 = (value, fallback) => (typeof value === "number" ? value : fallback);

const HANDLERS = { add: evaluateAdd, edit: evaluateEdit, delete: evaluateDelete, spawn: evaluateSpawn };
const CODE_ORDER = ["R01", "R02", "R03", "R04", "R05", "X07", "X08", "X09", "R06", "R07", "R08", "R09"];
const codeRank = (code) => {
  const i = CODE_ORDER.indexOf(code);
  return i === -1 ? CODE_ORDER.length : i;
};

/**
 * Parses and checks a request Issue against the data set.
 * @param {{ dataset: object, issue: { number: number, body: string, user: { login: string }, labels: Array } }} p
 * @returns {{ ok: boolean, kind: string | null, errors: object[], warnings: object[], hints: object[],
 *   request: object, world: object | null, target: { worldId, point } | null, changedFields: string[],
 *   diff: Array<{ field, before, after }> }}
 *   request holds the normalized values used for the snapshot hash (see snapshot.mjs).
 */
export function evaluateRequest({ dataset, issue }) {
  const ctx = createContext(dataset);
  const { kind, count } = requestKindFromLabels(issue?.labels);
  const result = {
    ok: false,
    kind,
    errors: [],
    warnings: [],
    hints: [],
    request: { issue: Number.isInteger(issue?.number) ? issue.number : null, type: kind, submittedBy: issue?.user?.login ?? null },
    world: null,
    target: null,
    changedFields: [],
    diff: [],
  };
  if (!kind) {
    result.errors.push({ code: "R04", key: count === 0 ? "typeLabelMissing" : "typeLabelMultiple", params: {} });
    return result;
  }
  const parsed = parseIssueBody(issue?.body ?? "", kind);
  result.errors.push(...parsed.errors);
  if (parsed.values) {
    const confirm = FORMS[kind].fields.find((f) => f.type === "checkboxes");
    if (!isChecked(parsed.values[confirm.id], confirm.option)) result.errors.push({ code: "R08", key: "confirmMissing", params: {} });
    HANDLERS[kind](ctx, parsed.values, result);
  }
  result.errors.sort((a, b) => codeRank(a.code) - codeRank(b.code));
  result.ok = result.errors.length === 0;
  return result;
}
