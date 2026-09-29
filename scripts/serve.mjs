// Local preview server for site/ (Node built-in modules only).
// Usage: npm run serve [-- --port 5173]   ->  http://127.0.0.1:5173/
// Binds to 127.0.0.1 only, serves GET / HEAD for files inside site/, never lists directories and
// rejects paths that leave the site root.

import { createServer } from "node:http";
import { stat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 5173;
export const SITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");

export const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
});

/**
 * Maps a request URL path to a file inside root; null when the path is invalid or leaves the root.
 * "/" and paths ending with "/" map to index.html.
 */
export function resolveRequestPath(urlPath, root = SITE_ROOT) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath).split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  // NUL bytes and backslashes (a path separator on Windows) are never valid in site URLs.
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const relative = decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  const resolved = path.resolve(root, `.${path.posix.normalize(`/${relative}`)}`);
  const inside = path.relative(root, resolved);
  if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return resolved;
}

/** Content type by file extension (application/octet-stream when unknown). */
export const contentType = (file) => MIME_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

/** Creates the preview server (not listening yet). */
export function createPreviewServer({ root = SITE_ROOT } = {}) {
  return createServer(async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
      return;
    }
    const file = resolveRequestPath(new URL(req.url ?? "/", `http://${HOST}`).pathname, root);
    if (!file) {
      send(res, 400, "Bad Request");
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) {
        send(res, 404, "Not Found");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": contentType(file),
        "Content-Length": body.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      send(res, 404, "Not Found");
    }
  });
}

async function main() {
  const { values } = parseArgs({ options: { port: { type: "string", default: String(DEFAULT_PORT) } } });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid port: ${values.port}`);
    process.exitCode = 1;
    return;
  }
  const server = createPreviewServer();
  server.on("error", (error) => {
    console.error(`Preview server error: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, HOST, () => console.log(`Serving site/ at http://${HOST}:${port}/ (Ctrl+C to stop)`));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
