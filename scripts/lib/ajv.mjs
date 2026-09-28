// Ajv (draft 2020-12) setup and schema loading for schemas/v1.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { isValidTimeZone } from "./dates.mjs";

export const SCHEMA_DIR = fileURLToPath(new URL("../../schemas/v1/", import.meta.url));

/** Schema names (file stem without .schema.json) for data files. */
export const SCHEMA_NAMES = [
  "manifest",
  "config",
  "editions",
  "worlds",
  "tags",
  "vpn",
  "points",
  "changelog-updates",
  "changelog-points",
  "i18n",
];

export const schemaId = (name) => `urn:player-club:v1:${name}`;

let schemaCache = null;

/** Loads every schema (including defs) once; returns Map of $id to schema object. */
export function loadSchemas() {
  if (schemaCache) return schemaCache;
  const byId = new Map();
  for (const name of ["defs", ...SCHEMA_NAMES]) {
    const schema = JSON.parse(readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), "utf8"));
    if (schema.$id !== schemaId(name)) throw new Error(`Unexpected $id in ${name}.schema.json: ${schema.$id}`);
    byId.set(schema.$id, schema);
  }
  schemaCache = byId;
  return byId;
}

function formatAjvError(error) {
  const { keyword, params, message } = error;
  let text = message ?? keyword;
  if (keyword === "additionalProperties") text += `: ${params.additionalProperty}`;
  if (keyword === "enum") text += `: ${params.allowedValues.join(", ")}`;
  if (keyword === "const") text += `: ${JSON.stringify(params.allowedValue)}`;
  return { path: error.instancePath || "/", message: text };
}

/** Creates a validator; validate(name, data) returns [{ path, message }] (empty when valid). */
export function createValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv, ["date", "date-time", "uri"]);
  ajv.addFormat("iana-time-zone", { type: "string", validate: isValidTimeZone });
  for (const schema of loadSchemas().values()) ajv.addSchema(schema);
  const compiled = new Map();
  return {
    validate(name, data) {
      if (!SCHEMA_NAMES.includes(name)) throw new Error(`Unknown schema: ${name}`);
      if (!compiled.has(name)) compiled.set(name, ajv.getSchema(schemaId(name)));
      const fn = compiled.get(name);
      if (fn(data)) return [];
      // "if" errors only restate that a "then"/"else" branch failed; the branch errors carry the detail.
      return fn.errors.filter((e) => e.keyword !== "if").map(formatAjvError);
    },
  };
}
