"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const ROOT = __dirname;
// Render mounts persistent disks at DATA_DIR (/var/data in render.yaml).
// Local development defaults to a data folder inside this project.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "league-data.json");
const PORT = Number(process.env.PORT || 10000);
// Render web services must bind to all interfaces. This also works for manual Render
// deployments where render.yaml environment variables may not have been applied.
const HOST = process.env.HOST || "0.0.0.0";
const KEYS = new Set([
  "kaiserFantasyAthletes", "kaiserFantasyTeams", "kaiserFantasyScores",
  "kaiserFantasyTrades", "kaiserFantasyDraftState", "kaiserFantasyDraftSettings",
  "kaiserFantasySchedule"
]);
let db = { version: 1, state: {}, keyUpdatedAt: {} };
let writeChain = Promise.resolve();
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon"
};
function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}
function queueSave() {
  writeChain = writeChain.then(async () => {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    const temporary = DB_FILE + ".tmp";
    await fs.promises.writeFile(temporary, JSON.stringify(db, null, 2), "utf8");
    await fs.promises.rename(temporary, DB_FILE);
  });
  return writeChain;
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 15 * 1024 * 1024) throw new Error("Request is too large (15 MB limit).");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
function onlyKnownState(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const key of KEYS) if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  return out;
}
async function handleApi(req, res, url) {
  if (url.pathname === "/api/state" && req.method === "GET") {
    await writeChain;
    return send(res, 200, {
      version: db.version, state: db.state, keyUpdatedAt: db.keyUpdatedAt,
      storageMode: DATA_DIR === "/var/data" ? "render" : "local",
      storageLabel: DATA_DIR === "/var/data" ? "Render persistent disk (/var/data/league-data.json)" : (DATA_DIR === path.join(ROOT, "data") ? "project file data/league-data.json" : `server directory ${DATA_DIR}/league-data.json`)
    });
  }
  if (url.pathname === "/api/state" && req.method === "PUT") {
    const body = await readBody(req);
    const incoming = onlyKnownState(body.state);
    const stamp = Number(body.updatedAt) || Date.now();
    db = { version: 1, state: incoming, keyUpdatedAt: {} };
    for (const key of Object.keys(incoming)) db.keyUpdatedAt[key] = stamp;
    await queueSave();
    return send(res, 200, { ok: true, keysSaved: Object.keys(incoming).length });
  }
  if (url.pathname === "/api/state" && req.method === "DELETE") {
    db = { version: 1, state: {}, keyUpdatedAt: {} };
    await queueSave();
    return send(res, 200, { ok: true });
  }
  const match = url.pathname.match(/^\/api\/state\/([^/]+)$/);
  if (match && req.method === "PUT") {
    const key = decodeURIComponent(match[1]);
    if (!KEYS.has(key)) return send(res, 400, { error: "Unknown data category." });
    const body = await readBody(req);
    const stamp = Number(body.updatedAt) || Date.now();
    const current = Number(db.keyUpdatedAt[key] || 0);
    if (stamp >= current) {
      db.state[key] = body.value;
      db.keyUpdatedAt[key] = stamp;
      await queueSave();
    }
    return send(res, 200, { ok: true, applied: stamp >= current, savedAt: db.keyUpdatedAt[key] || current });
  }
  return send(res, 404, { error: "API endpoint not found." });
}
async function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/healthz" && req.method === "GET") {
    return send(res, 200, { ok: true, storage: DATA_DIR === "/var/data" ? "render-persistent-disk" : "local-file", timestamp: new Date().toISOString() });
  }
  if (url.pathname.startsWith("/api/")) {
    try { return await handleApi(req, res, url); }
    catch (err) { console.error("API error:", err); return send(res, 400, { error: err.message || "Request failed." }); }
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, "Bad URL", "text/plain; charset=utf-8"); }
  if (pathname === "/") pathname = "/index.html";
  // Keep the persistent database file private from direct static-file requests.
  if (pathname === "/data" || pathname.startsWith("/data/")) return send(res, 404, "Not found", "text/plain; charset=utf-8");
  const file = path.resolve(ROOT, "." + pathname);
  if (!file.startsWith(ROOT + path.sep) || file === DB_FILE) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const contents = await fs.promises.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    res.end(contents);
  } catch { return send(res, 404, "Not found", "text/plain; charset=utf-8"); }
}
async function main() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  try {
    const stored = JSON.parse(await fs.promises.readFile(DB_FILE, "utf8"));
    if (stored && typeof stored === "object") db = {
      version: 1,
      state: onlyKnownState(stored.state),
      keyUpdatedAt: stored.keyUpdatedAt && typeof stored.keyUpdatedAt === "object" ? stored.keyUpdatedAt : {}
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      // Create the database on first launch, but do not ship an empty DB file in the ZIP.
      // This prevents future project updates from overwriting an existing league database.
      await queueSave();
    } else {
      console.error("Could not read league database; starting with an empty store.", err);
    }
  }
  const server = http.createServer((req, res) => { serve(req, res); });
  server.on("error", err => {
    if (err.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Stop Live Server in VS Code, then run npm start again.`);
    else console.error(err);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => console.log(`Kaiser Family Fantasy SMX is listening on ${HOST}:${PORT}/\nLeague data saves to: ${DB_FILE}\nPress Ctrl+C to stop the server.`));
}
main();
