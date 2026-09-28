// Canonical JSON I/O: UTF-8 without BOM, LF, 2-space indent, trailing newline.
// Key order follows the "properties" order of the file's schema; map-like objects
// (no declared properties, e.g. dictionary messages) are sorted by key.
// Arrays of primitives are written on one line.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadSchemas, schemaId } from "./ajv.mjs";

/** Parses JSON text; reports a leading BOM instead of silently accepting it. */
export function parseJsonText(text) {
  const bom = text.charCodeAt(0) === 0xfeff;
  return { data: JSON.parse(bom ? text.slice(1) : text), bom };
}

function decodePointer(segment) {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function deref(ref, baseId, schemas) {
  const [uri, pointer = ""] = ref.split("#");
  const docId = uri || baseId;
  let node = schemas.get(docId);
  for (const seg of pointer.split("/").slice(1)) node = node?.[decodePointer(seg)];
  if (node === undefined) throw new Error(`Unresolvable $ref: ${ref}`);
  return { schema: node, baseId: docId };
}

// Follows a $ref chain and returns every schema node that applies to the same value.
function expand(schema, baseId, schemas) {
  const nodes = [];
  let current = { schema, baseId };
  while (current) {
    nodes.push(current);
    const s = current.schema;
    current = s && typeof s === "object" && typeof s.$ref === "string" ? deref(s.$ref, current.baseId, schemas) : null;
  }
  return nodes;
}

function canonicalize(value, nodes, schemas) {
  if (Array.isArray(value)) {
    const itemNodes = nodes.flatMap(({ schema, baseId }) =>
      schema && typeof schema === "object" && schema.items ? expand(schema.items, baseId, schemas) : [],
    );
    return value.map((item) => canonicalize(item, itemNodes, schemas));
  }
  if (value === null || typeof value !== "object") return value;

  const order = [];
  const propNodes = new Map();
  const additional = [];
  for (const { schema, baseId } of nodes) {
    if (!schema || typeof schema !== "object") continue;
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (!propNodes.has(key)) {
        order.push(key);
        propNodes.set(key, []);
      }
      propNodes.get(key).push(...expand(sub, baseId, schemas));
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      additional.push(...expand(schema.additionalProperties, baseId, schemas));
    }
  }
  const known = order.filter((key) => Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !propNodes.has(key));
  if (order.length === 0) unknown.sort();
  const out = {};
  for (const key of [...known, ...unknown]) {
    if (value[key] === undefined) continue;
    out[key] = canonicalize(value[key], propNodes.get(key) ?? additional, schemas);
  }
  return out;
}

function serialize(value, depth) {
  const pad = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((v) => v === null || typeof v !== "object")) {
      return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    }
    return `[\n${value.map((v) => pad + serialize(v, depth + 1)).join(",\n")}\n${close}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (keys.length === 0) return "{}";
    return `{\n${keys.map((k) => `${pad}${JSON.stringify(k)}: ${serialize(value[k], depth + 1)}`).join(",\n")}\n${close}}`;
  }
  return JSON.stringify(value);
}

/** Canonical JSON text; schemaName (e.g. "points") selects the key order, null keeps insertion order. */
export function stringifyJson(data, schemaName = null) {
  const schemas = loadSchemas();
  const ordered = schemaName ? canonicalize(data, expand({ $ref: schemaId(schemaName) }, "", schemas), schemas) : data;
  return `${serialize(ordered, 0)}\n`;
}

export async function readJsonFile(filePath) {
  return parseJsonText(await readFile(filePath, "utf8")).data;
}

export async function writeJsonFile(filePath, data, schemaName = null) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stringifyJson(data, schemaName), "utf8");
}
