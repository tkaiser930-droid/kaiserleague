"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { createGithubBackup } = require("./github-backup");
const { fetchOfficialResults } = require("./race-results-import");

const ROOT = __dirname;
const githubBackup = createGithubBackup(ROOT);
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || "0.0.0.0";
const KEYS = new Set([
  "kaiserFantasyAthletes", "kaiserFantasyTeams", "kaiserFantasyScores",
  "kaiserFantasyTrades", "kaiserFantasyDraftState", "kaiserFantasyDraftSettings",
  "kaiserFantasySchedule"
]);

// The server keeps only an in-memory working copy. GitHub is the sole shared,
// persistent league-data store; no league JSON is read from or written to disk.
let db = { version: 1, state: {}, keyUpdatedAt: {}, savedAt: 0 };
let githubReady = false;
let githubLoadPromise = null;
let githubOperationQueue = Promise.resolve();
let lastGithubStateSignature = "";
let githubAutoLastError = "";
let githubAutoLastAt = "";
let githubLastSync = { source: "not checked", at: "", message: "" };

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon"
};

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}

function queueGithubOperation(operation) {
  const job = githubOperationQueue.then(operation);
  // A failed save must not poison the queue; a later explicit retry can recover.
  githubOperationQueue = job.catch(() => {});
  return job;
}

function onlyKnownState(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const key of KEYS) if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  return out;
}

function timestampMs(value) {
  if (typeof value === "string") return Date.parse(value) || 0;
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function maxKeyTimestamp(keyUpdatedAt) {
  return Math.max(0, ...Object.values(keyUpdatedAt || {}).map(value => Number(value) || 0));
}

function normalizeDatabase(input, fallbackTimestamp = 0) {
  const keyUpdatedAt = input?.keyUpdatedAt && typeof input.keyUpdatedAt === "object" && !Array.isArray(input.keyUpdatedAt) ? input.keyUpdatedAt : {};
  const savedAt = timestampMs(input?.savedAt) || maxKeyTimestamp(keyUpdatedAt) || Number(fallbackTimestamp) || 0;
  return {
    version: 1,
    state: onlyKnownState(input?.state),
    keyUpdatedAt: { ...keyUpdatedAt },
    savedAt
  };
}

function databaseTimestamp(value, fallbackTimestamp = 0) {
  return timestampMs(value?.savedAt) || maxKeyTimestamp(value?.keyUpdatedAt) || Number(fallbackTimestamp) || 0;
}

function stateSignature(value) {
  const normalized = normalizeDatabase(value);
  return JSON.stringify({ version: normalized.version, state: normalized.state, keyUpdatedAt: normalized.keyUpdatedAt });
}

function formatVancouverDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Vancouver", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true
  }).format(date);
}

function githubStorageLabel() {
  const cfg = githubBackup.getConfigSummary();
  return `GitHub repository ${cfg.repository}/${cfg.dataPath} (${cfg.branch})`;
}

async function ensureGithubReady() {
  if (!githubBackup.configured()) {
    throw new Error("GitHub-only saving is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY in the server environment.");
  }
  if (githubReady) return;
  if (!githubLoadPromise) {
    githubLoadPromise = (async () => {
      const remote = await githubBackup.getLatestLeagueData();
      if (remote.found) {
        db = normalizeDatabase(remote.data, remote.savedAt);
        lastGithubStateSignature = stateSignature(db);
        githubLastSync = {
          source: "GitHub",
          at: new Date().toISOString(),
          message: `Loaded the active league database from GitHub (${formatVancouverDateTime(remote.savedAt)}).`
        };
        console.log(`Loaded league data from GitHub (${remote.path}, ${remote.branch}).`);
      } else {
        db = { version: 1, state: {}, keyUpdatedAt: {}, savedAt: 0 };
        lastGithubStateSignature = stateSignature(db);
        githubLastSync = {
          source: "GitHub",
          at: new Date().toISOString(),
          message: "No league-data file exists in GitHub yet. The first league save will create it."
        };
        console.log("GitHub repository is ready; no league-data JSON exists yet.");
      }
      githubReady = true;
    })();
  }
  try {
    await githubLoadPromise;
  } finally {
    githubLoadPromise = null;
  }
}

async function saveDatabaseToGithub(message = "Kaiser Family Fantasy SMX: automatic league-data save") {
  await ensureGithubReady();
  return queueGithubOperation(async () => {
    const pendingSignature = stateSignature(db);
    if (pendingSignature === lastGithubStateSignature) {
      return { ok: true, changed: false, savedAt: db.savedAt, path: githubBackup.getConfigSummary().dataPath, commit: null };
    }
    db.savedAt = Math.max(Date.now(), timestampMs(db.savedAt) + 1);
    const snapshot = normalizeDatabase(JSON.parse(JSON.stringify(db)));
    try {
      const result = await githubBackup.saveLeagueData(snapshot, message);
      lastGithubStateSignature = stateSignature(snapshot);
      githubAutoLastAt = new Date().toISOString();
      githubAutoLastError = "";
      if (result.changed) {
        console.log(`Saved league data directly to GitHub (${result.commit.shortSha || result.commit.sha.slice(0, 7)}; ${result.path}).`);
      }
      githubLastSync = {
        source: "GitHub",
        at: githubAutoLastAt,
        message: result.changed ? `Committed the latest league data to GitHub (${result.commit.shortSha || result.commit.sha.slice(0, 7)}).` : "GitHub already contains the latest league data."
      };
      return result;
    } catch (error) {
      githubAutoLastAt = new Date().toISOString();
      githubAutoLastError = error.message || "GitHub league-data save failed.";
      throw error;
    }
  });
}

async function reloadLatestGithubSave() {
  if (!githubBackup.configured()) throw new Error("GitHub is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY on the server.");
  return queueGithubOperation(async () => {
    const remote = await githubBackup.getLatestLeagueData();
    if (!remote.found) throw new Error(`No league-data save was found at ${remote.path || "the configured GitHub path"}.`);
    db = normalizeDatabase(remote.data, remote.savedAt);
    lastGithubStateSignature = stateSignature(db);
    githubReady = true;
    githubLastSync = {
      source: "GitHub",
      at: new Date().toISOString(),
      message: `Loaded the latest GitHub league save (${formatVancouverDateTime(remote.savedAt)}).`
    };
    return { ok: true, source: "GitHub", savedAt: db.savedAt, message: githubLastSync.message };
  });
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) throw new Error("Request is too large (64 MB limit).");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new Error("Request body is not valid JSON."); }
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/results/preview" && req.method === "POST") {
    const body = await readBody(req);
    const result = await fetchOfficialResults({
      url: body.url, series: body.series, division: body.division, csv: body.csv, csvName: body.csvName,
      event: body.event, round: body.round, eventDate: body.eventDate, eventLocation: body.eventLocation, eventType: body.eventType,
      phase: body.phase, supercrossFormat: body.supercrossFormat
    });
    return send(res, 200, result);
  }

  if (url.pathname === "/api/github/status" && req.method === "GET") {
    const status = await githubBackup.getStatus({
      storageMode: "github-only",
      storageLabel: githubStorageLabel(),
      activeSavedAt: db.savedAt,
      githubReady,
      autoSaveLastAt: githubAutoLastAt,
      autoSaveLastError: githubAutoLastError,
      lastSync: githubLastSync
    });
    return send(res, 200, status);
  }

  if (url.pathname === "/api/github/save" && req.method === "POST") {
    await readBody(req);
    if (!githubBackup.authorize(req.headers["x-kf-github-backup-password"])) {
      return send(res, 401, { error: "GitHub backup password is incorrect or not configured." });
    }
    const result = await saveDatabaseToGithub("Kaiser Family Fantasy SMX: manual save to GitHub");
    return send(res, 200, result);
  }

  if (url.pathname === "/api/github/reload" && req.method === "POST") {
    await readBody(req);
    if (!githubBackup.authorize(req.headers["x-kf-github-backup-password"])) {
      return send(res, 401, { error: "GitHub backup password is incorrect or not configured." });
    }
    const result = await reloadLatestGithubSave();
    return send(res, 200, result);
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    await ensureGithubReady();
    return send(res, 200, {
      version: db.version,
      state: db.state,
      keyUpdatedAt: db.keyUpdatedAt,
      savedAt: db.savedAt,
      storageMode: "github",
      storageLabel: githubStorageLabel()
    });
  }

  if (url.pathname === "/api/state" && req.method === "PUT") {
    await ensureGithubReady();
    const body = await readBody(req);
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) {
      return send(res, 400, { error: "The submitted league state must be a JSON object." });
    }
    const incoming = onlyKnownState(body.state);
    const stamp = Number(body.updatedAt) || Date.now();
    db = { version: 1, state: incoming, keyUpdatedAt: {}, savedAt: stamp };
    for (const key of KEYS) db.keyUpdatedAt[key] = stamp;
    const saved = await saveDatabaseToGithub("Kaiser Family Fantasy SMX: league-data restore to GitHub");
    return send(res, 200, { ok: true, keysSaved: Object.keys(incoming).length, savedAt: db.savedAt, storage: "GitHub", commit: saved.commit || null });
  }

  if (url.pathname === "/api/state" && req.method === "DELETE") {
    await ensureGithubReady();
    const clearedAt = Date.now();
    db = { version: 1, state: {}, keyUpdatedAt: Object.fromEntries([...KEYS].map(key => [key, clearedAt])), savedAt: clearedAt };
    const saved = await saveDatabaseToGithub("Kaiser Family Fantasy SMX: clear league data in GitHub");
    return send(res, 200, { ok: true, savedAt: db.savedAt, storage: "GitHub", commit: saved.commit || null });
  }

  const match = url.pathname.match(/^\/api\/state\/([^/]+)$/);
  if (match && req.method === "PUT") {
    await ensureGithubReady();
    const key = decodeURIComponent(match[1]);
    if (!KEYS.has(key)) return send(res, 400, { error: "Unknown data category." });
    const body = await readBody(req);
    if (!Object.prototype.hasOwnProperty.call(body, "value")) return send(res, 400, { error: "The data category value is missing." });
    const stamp = Number(body.updatedAt) || Date.now();
    const current = Number(db.keyUpdatedAt[key] || 0);
    if (stamp >= current) {
      db.state[key] = body.value;
      db.keyUpdatedAt[key] = stamp;
      const saved = await saveDatabaseToGithub(`Kaiser Family Fantasy SMX: save ${key} to GitHub`);
      return send(res, 200, { ok: true, applied: true, savedAt: db.savedAt, storage: "GitHub", commit: saved.commit || null });
    }
    return send(res, 200, { ok: true, applied: false, savedAt: db.savedAt, storage: "GitHub" });
  }

  return send(res, 404, { error: "API endpoint not found." });
}

async function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/healthz" && req.method === "GET") {
    return send(res, 200, {
      ok: true,
      storage: "github-only",
      githubConfigured: githubBackup.configured(),
      githubReady,
      timestamp: new Date().toISOString()
    });
  }
  if (url.pathname.startsWith("/api/")) {
    try { return await handleApi(req, res, url); }
    catch (error) {
      console.error("API error:", error);
      const status = error.status === 401 ? 502 : (error.status === 403 || error.status === 404 ? 502 : 503);
      return send(res, status, { error: error.message || "GitHub request failed." });
    }
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return send(res, 400, "Bad URL", "text/plain; charset=utf-8"); }
  if (pathname === "/") pathname = "/index.html";
  const pathParts = pathname.split("/").filter(Boolean);
  if (pathParts.some(part => part === "data" || part === ".git" || part === "node_modules" || part === ".env" || (part.startsWith(".env.") && part !== ".env.example"))) {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
  const file = path.resolve(ROOT, "." + pathname);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile()) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const contents = await fs.promises.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    res.end(contents);
  } catch {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
}

async function main() {
  if (githubBackup.configured()) {
    try {
      await ensureGithubReady();
    } catch (error) {
      console.error("Could not load the GitHub league database. Shared saving is disabled until GitHub is reachable:", error.message);
      githubReady = false;
      githubLastSync = { source: "GitHub unavailable", at: new Date().toISOString(), message: error.message };
    }
  } else {
    console.warn("GITHUB_TOKEN is not configured. The site will use browser-only storage until GitHub is configured.");
  }

  const server = http.createServer((req, res) => { serve(req, res); });
  server.on("error", error => {
    if (error.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Stop the other server, then run npm start again.`);
    else console.error(error);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Kaiser Family Fantasy SMX is listening on ${HOST}:${PORT}/\nLeague-data persistence: GitHub only (${githubBackup.configured() ? "configured" : "not configured"})\nNo Render persistent disk is used for league data.\nPress Ctrl+C to stop the server.`);
  });
}

main().catch(error => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
