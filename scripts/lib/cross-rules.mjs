// Cross validation rules X01-X21 and X23 (X22 is the Issue Forms check, added with the forms generator).
// Input is a schema-valid data set (see load-data.mjs); output is a list of issues:
// { level: "error" | "warning", code, file, path (JSON pointer), message }.

import { parseId, isStandardId } from "../../site/js/lib/ids.js";
import { compareVersion, resolveBounds } from "../../site/js/lib/version.js";
import { isWithinBounds } from "../../site/js/lib/coords.js";
import { CORE_FILES, I18N_DIR, LANGS, SUPPORTED_SCHEMA_VERSION, i18nPath, listDataFiles, pointsPath } from "./load-data.mjs";
import { findInternalTextExcept } from "./public-text-guard.mjs";
import { addDays, dateInTimeZone } from "./dates.mjs";
import { POINT_FIELDS, SPAWN_FIELDS } from "./changelog-templates.mjs";

export const DIMENSIONS = ["overworld", "the_nether", "the_end"];
const SEED_RE = /^(0|-?[1-9][0-9]{0,18})$/;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const SECRET_KEY_RE = /pass|pwd|secret|token/i;
const PLACEHOLDER_RE = /\{([A-Za-z0-9_]+)\}/g;
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
const SEQ_KEYS = ["pointSeq", "changeSeq", "updateSeq"];

/** True when value is a canonical decimal string within the signed 64-bit range (BigInt only, never Number). */
export function isInt64String(value) {
  if (typeof value !== "string" || !SEED_RE.test(value)) return false;
  const n = BigInt(value);
  return n >= INT64_MIN && n <= INT64_MAX;
}

/** Highest sequence number among ids with the given prefix (0 when none). */
export function maxIdNumber(ids, prefix) {
  let max = 0;
  for (const id of ids) {
    const parsed = parseId(id);
    if (parsed && parsed.prefix === prefix && parsed.n > max) max = parsed.n;
  }
  return max;
}

/** Every point id across all points files. */
export function allPointIds(dataset) {
  return Object.values(dataset.points ?? {}).flatMap((file) => (file?.points ?? []).map((p) => p?.id));
}

// ---------------------------------------------------------------------------
// Diff against HEAD (shared by X21 and changelog-sync)

const blankToNull = (v) => (v === undefined || v === "" ? null : v);

function sameSet(a = [], b = []) {
  return a.length === b.length && a.every((v) => b.includes(v));
}

function changedPointFields(before, after) {
  return POINT_FIELDS.filter((f) =>
    f === "tags" ? !sameSet(before.tags, after.tags) : blankToNull(before[f]) !== blankToNull(after[f]),
  );
}

function indexPoints(dataset) {
  const index = new Map();
  for (const [worldId, file] of Object.entries(dataset?.points ?? {})) {
    for (const point of file?.points ?? []) {
      if (point && typeof point.id === "string" && !index.has(point.id)) index.set(point.id, { worldId, point });
    }
  }
  return index;
}

const idOrder = (id) => parseId(id)?.n ?? Number.MAX_SAFE_INTEGER;

/**
 * Compares a data set with its HEAD version.
 * @returns {{ changes: object[], seedChanges: string[], newWorlds: string[] }}
 *   changes: { type: "spawn" | "point", action, worldId, id?, changedFields?, before?, after? }
 */
export function diffDatasets(head, current) {
  const spawnChanges = [];
  const seedChanges = [];
  const newWorlds = [];
  const headWorlds = new Map((head?.worlds?.worlds ?? []).map((w) => [w.id, w]));
  for (const world of current.worlds?.worlds ?? []) {
    const before = headWorlds.get(world.id);
    if (!before) {
      newWorlds.push(world.id);
      continue;
    }
    if (before.seed !== world.seed) seedChanges.push(world.id);
    const fields = SPAWN_FIELDS.filter((f) => before.spawn?.[f] !== world.spawn?.[f]);
    if (fields.length > 0) {
      spawnChanges.push({ type: "spawn", action: "edit", worldId: world.id, changedFields: fields, before: before.spawn, after: world.spawn });
    }
  }

  const pointChanges = [];
  const headPoints = indexPoints(head);
  const currentPoints = indexPoints(current);
  for (const [id, cur] of currentPoints) {
    const prev = headPoints.get(id);
    if (prev && prev.worldId === cur.worldId) {
      const fields = changedPointFields(prev.point, cur.point);
      if (fields.length > 0) {
        pointChanges.push({ type: "point", action: "edit", worldId: cur.worldId, id, changedFields: fields, before: prev.point, after: cur.point });
      }
      continue;
    }
    if (prev) pointChanges.push({ type: "point", action: "delete", worldId: prev.worldId, id, before: prev.point });
    pointChanges.push({ type: "point", action: "add", worldId: cur.worldId, id, after: cur.point });
  }
  for (const [id, prev] of headPoints) {
    if (!currentPoints.has(id)) pointChanges.push({ type: "point", action: "delete", worldId: prev.worldId, id, before: prev.point });
  }
  pointChanges.sort((a, b) => idOrder(a.id) - idOrder(b.id));
  return { changes: [...spawnChanges, ...pointChanges], seedChanges, newWorlds };
}

/** Entries present in current but not in head (by id). */
export function newEntries(headEntries, currentEntries) {
  const known = new Set((headEntries ?? []).map((e) => e?.id));
  return (currentEntries ?? []).filter((e) => !known.has(e?.id));
}

/** A new manual change entry that records the given change, if any. */
export function findCoveringEntry(entries, change) {
  return entries.find(
    (e) =>
      e?.source?.type === "manual" &&
      e.action === change.action &&
      e.target?.type === change.type &&
      e.target?.worldId === change.worldId &&
      (change.type === "spawn" || e.target?.id === change.id),
  );
}

export function describeChange(change) {
  return change.type === "spawn" ? `spawn of world ${change.worldId} (edit)` : `point ${change.id} (${change.action})`;
}

// ---------------------------------------------------------------------------

function scanKeys(value, pointer, visit) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanKeys(v, `${pointer}/${i}`, visit));
  } else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      const child = `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      visit(key, child);
      scanKeys(v, child, visit);
    }
  }
}

function placeholders(text) {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).sort();
}

const describeBounds = (b) => `|x|,|z| <= ${b.xzAbsMax}, ${b.yMin} <= y <= ${b.yMax}`;

/**
 * Runs cross validation on a schema-valid data set.
 * @param {object} dataset
 * @param {{ now?: Date, baselineManifest?: object | null, head?: object | null }} [options]
 *   baselineManifest enables X18; head (data set at HEAD) enables X21.
 */
export function runCrossRules(dataset, options = {}) {
  const now = options.now ?? new Date();
  const issues = [];
  const error = (code, file, path, message) => issues.push({ level: "error", code, file, path, message });
  const warning = (code, file, path, message) => issues.push({ level: "warning", code, file, path, message });
  const P = Object.fromEntries(CORE_FILES.map((f) => [f.key, f.path]));
  const { manifest, config, editions, worlds, tags, vpn, updates, changes } = dataset;

  // X01 schema version
  if (manifest.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    error("X01", P.manifest, "/schemaVersion", `schemaVersion ${manifest.schemaVersion} is not the supported version ${SUPPORTED_SCHEMA_VERSION}`);
  }
  for (const file of listDataFiles(dataset)) {
    if (file.path !== P.manifest && file.data.schemaVersion !== manifest.schemaVersion) {
      error("X01", file.path, "/schemaVersion", `schemaVersion ${file.data.schemaVersion} differs from manifest (${manifest.schemaVersion})`);
    }
  }

  // X12 unique ids
  const indexUnique = (list, file, pointer, label) => {
    const map = new Map();
    list.forEach((item, i) => {
      if (map.has(item.id)) error("X12", file, `${pointer}/${i}/id`, `Duplicate ${label} id: ${item.id}`);
      else map.set(item.id, item);
    });
    return map;
  };
  const editionById = indexUnique(editions.editions, P.editions, "/editions", "edition");
  const worldById = indexUnique(worlds.worlds, P.worlds, "/worlds", "world");
  const groupById = indexUnique(tags.groups, P.tags, "/groups", "group");
  const tagById = indexUnique(tags.tags, P.tags, "/tags", "tag");
  indexUnique(vpn.vpns, P.vpn, "/vpns", "vpn");

  // X12 tag references, empty groups; X20 tag names without half-width commas
  tags.tags.forEach((tag, i) => {
    if (!groupById.has(tag.group)) error("X12", P.tags, `/tags/${i}/group`, `Tag ${tag.id} refers to unknown group ${tag.group}`);
    (tag.editions ?? []).forEach((ed, j) => {
      if (!editionById.has(ed)) error("X12", P.tags, `/tags/${i}/editions/${j}`, `Tag ${tag.id} refers to unknown edition ${ed}`);
    });
    for (const lang of ["en", "zh-TW"]) {
      if (tag.name[lang].includes(",")) error("X20", P.tags, `/tags/${i}/name/${lang}`, `Tag name must not contain a half-width comma: ${tag.name[lang]}`);
    }
  });
  tags.groups.forEach((group, i) => {
    if (!tags.tags.some((t) => t.group === group.id)) warning("X12", P.tags, `/groups/${i}`, `Group ${group.id} has no tags`);
  });

  // X09 edition bounds sanity
  const checkBounds = (b, pointer) => {
    if (b.yMin >= b.yMax) error("X09", P.editions, pointer, `yMin (${b.yMin}) must be lower than yMax (${b.yMax})`);
  };
  editions.editions.forEach((ed, i) => {
    checkBounds(ed.bounds, `/editions/${i}/bounds`);
    (ed.versionOverrides ?? []).forEach((o, j) => {
      checkBounds(o.bounds, `/editions/${i}/versionOverrides/${j}/bounds`);
      if (o.minVersion && o.maxVersion && compareVersion(o.minVersion, o.maxVersion) > 0) {
        error("X09", P.editions, `/editions/${i}/versionOverrides/${j}`, `minVersion ${o.minVersion} is above maxVersion ${o.maxVersion}`);
      }
    });
  });

  // X02 default world
  if (!worldById.has(config.defaultWorldId)) {
    error("X02", P.config, "/defaultWorldId", `defaultWorldId ${config.defaultWorldId} does not exist in worlds`);
  }

  // X03 edition, X11 seed, X23 overworld, X09 spawn
  const boundsByWorld = new Map();
  worlds.worlds.forEach((world, i) => {
    const base = `/worlds/${i}`;
    const edition = editionById.get(world.edition);
    if (!edition) error("X03", P.worlds, `${base}/edition`, `Edition ${world.edition} does not exist`);
    if (!isInt64String(world.seed)) error("X11", P.worlds, `${base}/seed`, `Seed ${world.seed} is outside the signed 64-bit range`);
    if (!world.dimensions.includes("overworld")) {
      error("X23", P.worlds, `${base}/dimensions`, `World ${world.id} must include overworld (the spawn belongs to the overworld)`);
    }
    if (edition) {
      const bounds = resolveBounds(edition, world.gameVersion);
      boundsByWorld.set(world.id, bounds);
      if (world.spawn.y === null || !isWithinBounds(world.spawn, bounds)) {
        error("X09", P.worlds, `${base}/spawn`, `Spawn ${world.spawn.x} ${world.spawn.y} ${world.spawn.z} is outside ${describeBounds(bounds)}`);
      }
    }
  });

  // X04 one points file per world, no orphans; X05 worldId equals file name
  for (const world of worlds.worlds) {
    if (!dataset.points[world.id]) error("X04", pointsPath(world.id), "", `World ${world.id} has no points file`);
  }
  for (const [stem, file] of Object.entries(dataset.points)) {
    if (!worldById.has(stem)) error("X04", pointsPath(stem), "", `Orphan points file: world ${stem} does not exist`);
    if (file.worldId !== stem) error("X05", pointsPath(stem), "/worldId", `worldId ${file.worldId} does not match the file name ${stem}`);
  }

  // X06-X10, X17 points
  const nowMs = now.getTime();
  const seenPointIds = new Map();
  for (const [stem, file] of Object.entries(dataset.points)) {
    const fpath = pointsPath(stem);
    const world = worldById.get(stem);
    const bounds = boundsByWorld.get(stem);
    const byPosition = new Map();
    let previous = 0;
    file.points.forEach((point, i) => {
      const base = `/points/${i}`;
      if (!isStandardId(point.id, "p")) {
        error("X06", fpath, `${base}/id`, `${point.id} is not a standard id (p + at least 4 digits, no extra leading zeros)`);
      } else {
        const n = parseId(point.id).n;
        if (n < 1 || n > manifest.pointSeq) error("X06", fpath, `${base}/id`, `${point.id} is outside 1..pointSeq (${manifest.pointSeq})`);
        if (n <= previous) error("X06", fpath, `${base}/id`, `${point.id} breaks ascending id order`);
        previous = Math.max(previous, n);
      }
      if (seenPointIds.has(point.id)) error("X06", fpath, `${base}/id`, `Duplicate point id ${point.id} (also in ${seenPointIds.get(point.id)})`);
      else seenPointIds.set(point.id, fpath);

      if (world) {
        if (!world.dimensions.includes(point.dimension)) {
          error("X07", fpath, `${base}/dimension`, `Dimension ${point.dimension} is not part of world ${world.id}`);
        }
        point.tags.forEach((tagId, j) => {
          const tag = tagById.get(tagId);
          const pointer = `${base}/tags/${j}`;
          if (!tag) return error("X08", fpath, pointer, `Tag ${tagId} does not exist`);
          if (!tag.dimensions.includes(point.dimension)) error("X08", fpath, pointer, `Tag ${tagId} is not allowed in ${point.dimension}`);
          if (tag.editions && !tag.editions.includes(world.edition)) error("X08", fpath, pointer, `Tag ${tagId} is not available for edition ${world.edition}`);
          return undefined;
        });
      }
      if (bounds && !isWithinBounds(point, bounds)) {
        error("X09", fpath, base, `${point.id} ${point.x} ${point.y} ${point.z} is outside ${describeBounds(bounds)}`);
      }

      const created = Date.parse(point.createdAt);
      const updated = Date.parse(point.updatedAt);
      if (created > updated) error("X10", fpath, `${base}/createdAt`, `${point.id} createdAt is later than updatedAt`);
      if (updated > nowMs + FUTURE_TOLERANCE_MS) error("X10", fpath, `${base}/updatedAt`, `${point.id} updatedAt is in the future`);

      const key = `${point.dimension}|${point.x}|${point.z}`;
      if (!byPosition.has(key)) byPosition.set(key, []);
      byPosition.get(key).push(point.id);
    });
    for (const [key, ids] of byPosition) {
      if (ids.length > 1) {
        const [dim, x, z] = key.split("|");
        warning("X17", fpath, "", `Duplicate position in ${dim} at X ${x} Z ${z}: ${ids.join(", ")}`);
      }
    }
  }

  // X13 VPN worlds
  vpn.vpns.forEach((v, i) => {
    v.worldIds.forEach((worldId, j) => {
      if (!worldById.has(worldId)) error("X13", P.vpn, `/vpns/${i}/worldIds/${j}`, `World ${worldId} does not exist`);
    });
  });

  // X14 no password-like keys anywhere in site/data
  for (const file of listDataFiles(dataset)) {
    if (!file.path.startsWith("site/data/")) continue;
    scanKeys(file.data, "", (key, pointer) => {
      if (SECRET_KEY_RE.test(key)) error("X14", file.path, pointer, `Key "${key}" looks like a secret; passwords and tokens must never be stored`);
    });
  }

  // X15 change log ids, dates, issue numbers, target world
  const maxDate = addDays(dateInTimeZone(now, config.changelogTimeZone), 1);
  const checkEntries = (entries, prefix, seqKey, file) => {
    const seen = new Set();
    let previous = 0;
    entries.forEach((entry, i) => {
      const pointer = `/entries/${i}`;
      if (!isStandardId(entry.id, prefix)) {
        error("X15", file, `${pointer}/id`, `${entry.id} is not a standard id`);
      } else {
        const n = parseId(entry.id).n;
        if (n < 1 || n > manifest[seqKey]) error("X15", file, `${pointer}/id`, `${entry.id} is outside 1..${seqKey} (${manifest[seqKey]})`);
        if (n <= previous) error("X15", file, `${pointer}/id`, `${entry.id} breaks ascending id order`);
        previous = Math.max(previous, n);
      }
      if (seen.has(entry.id)) error("X15", file, `${pointer}/id`, `Duplicate id ${entry.id}`);
      seen.add(entry.id);
      if (entry.date > maxDate) error("X15", file, `${pointer}/date`, `Date ${entry.date} is later than ${maxDate}`);
    });
  };
  checkEntries(updates.entries, "u", "updateSeq", P.updates);
  checkEntries(changes.entries, "c", "changeSeq", P.changes);
  const issueNumbers = new Map();
  changes.entries.forEach((entry, i) => {
    if (entry.source.type === "issue") {
      if (issueNumbers.has(entry.source.issue)) {
        error("X15", P.changes, `/entries/${i}/source/issue`, `Issue #${entry.source.issue} is already recorded by ${issueNumbers.get(entry.source.issue)}`);
      } else {
        issueNumbers.set(entry.source.issue, entry.id);
      }
    }
    if (!worldById.has(entry.target.worldId)) {
      warning("X15", P.changes, `/entries/${i}/target/worldId`, `World ${entry.target.worldId} no longer exists`);
    }
  });

  // X16 public text guard: only our own wording is checked. Update entries and dictionaries are written by us
  // in full; coordinate change entries are fixed templates that embed user data (point and world names),
  // which is masked so a name such as "Agent's Base" is not rejected.
  const guard = (file, pointer, text, userValues = []) => {
    const hits = findInternalTextExcept(text, userValues);
    if (hits.length > 0) error("X16", file, pointer, `Public text contains internal information (${hits.join(", ")})`);
  };
  for (const [key, file] of [["updates", P.updates], ["changes", P.changes]]) {
    dataset[key].entries.forEach((entry, i) => {
      const userValues = key === "changes" ? [entry.target?.name, worldById.get(entry.target?.worldId)?.name] : [];
      for (const field of ["summary", "scope"]) {
        for (const lang of ["en", "zh-TW"]) guard(file, `/entries/${i}/${field}/${lang}`, entry[field][lang], userValues);
      }
    });
  }
  for (const lang of LANGS) {
    const dict = dataset.i18n?.[lang];
    if (!dict) continue;
    for (const [key, value] of Object.entries(dict.messages)) guard(i18nPath(lang), `/messages/${key}`, value);
  }

  // X18 sequences never decrease
  if (options.baselineManifest) {
    for (const key of SEQ_KEYS) {
      const base = options.baselineManifest[key];
      if (Number.isInteger(base) && manifest[key] < base) {
        error("X18", P.manifest, `/${key}`, `${key} ${manifest[key]} is lower than the baseline ${base}; restore it to at least ${base} so ids are never reused`);
      }
    }
  }

  // X19 dictionaries (en is the primary dictionary; zh-TW falls back to en at runtime)
  if (!dataset.i18n) {
    warning("X19", I18N_DIR, "", "Dictionaries not found; dictionary checks skipped");
  } else {
    for (const lang of LANGS) {
      const dict = dataset.i18n[lang];
      if (!dict) error("X19", i18nPath(lang), "", "Dictionary file is missing");
      else if (dict.lang !== lang) error("X19", i18nPath(lang), "/lang", `lang ${dict.lang} does not match the file name ${lang}`);
    }
    const en = dataset.i18n.en?.messages;
    const zh = dataset.i18n["zh-TW"]?.messages;
    if (en && zh) {
      for (const key of Object.keys(zh)) {
        if (!Object.hasOwn(en, key)) error("X19", i18nPath("en"), `/messages/${key}`, `Key ${key} exists in zh-TW but not in en (en is the primary dictionary)`);
      }
      for (const key of Object.keys(en)) {
        if (!Object.hasOwn(zh, key)) {
          warning("X19", i18nPath("zh-TW"), `/messages/${key}`, `Key ${key} is missing in zh-TW (falls back to en)`);
        } else if (placeholders(en[key]).join(",") !== placeholders(zh[key]).join(",")) {
          error("X19", i18nPath("zh-TW"), `/messages/${key}`, `Placeholders of ${key} differ between en and zh-TW`);
        }
      }
    }
    if (en) {
      const dims = new Set([...worlds.worlds.flatMap((w) => w.dimensions), ...tags.tags.flatMap((t) => t.dimensions)]);
      const required = [
        ...[...dims].map((d) => `dimension.${d}`),
        ...editions.editions.map((e) => `edition.${e.id}`),
      ];
      for (const key of required) {
        if (!Object.hasOwn(en, key)) error("X19", i18nPath("en"), "/messages", `Missing dictionary key ${key}`);
      }
      for (const type of new Set(vpn.vpns.map((v) => v.type))) {
        if (!Object.keys(en).some((k) => k.startsWith(`vpn.${type}.`))) {
          error("X19", i18nPath("en"), "/messages", `Missing dictionary keys vpn.${type}.*`);
        }
      }
    }
  }

  // X21 manual edits must be recorded in the change log (npm run check only)
  if (options.head) {
    const diff = diffDatasets(options.head, dataset);
    const freshChanges = newEntries(options.head.changes?.entries, changes.entries);
    for (const change of diff.changes) {
      if (!findCoveringEntry(freshChanges, change)) {
        const file = change.type === "spawn" ? P.worlds : pointsPath(change.worldId);
        error("X21", file, "", `${describeChange(change)} has no manual change log entry; run npm run changelog:sync`);
      }
    }
    if (newEntries(options.head.updates?.entries, updates.entries).length === 0) {
      for (const worldId of diff.seedChanges) {
        warning("X21", P.worlds, "", `Seed of world ${worldId} changed without a new update entry; run npm run changelog:update`);
      }
      for (const worldId of diff.newWorlds) {
        warning("X21", P.worlds, "", `World ${worldId} was added without a new update entry; run npm run changelog:update`);
      }
    }
  }

  return issues;
}
