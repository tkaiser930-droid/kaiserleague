"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { createGithubBackup } = require("./github-backup");
const { fetchOfficialResults } = require("./race-results-import");

const ROOT = __dirname;
const githubBackup = createGithubBackup(ROOT);
// Render's persistent disk is the live working copy. GitHub stores a second copy
// of this same JSON file so the server can select the newest save on startup.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "league-data.json");
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || "0.0.0.0";
const KEYS = new Set([
  "kaiserFantasyAthletes", "kaiserFantasyTeams", "kaiserFantasyScores",
  "kaiserFantasyTrades", "kaiserFantasyDraftState", "kaiserFantasyDraftSettings",
  "kaiserFantasySchedule"
]);
let db = { version: 1, state: {}, keyUpdatedAt: {}, savedAt: 0 };
let writeChain = Promise.resolve();
let githubOperationQueue = Promise.resolve();
let githubAutoTimer = null;
let githubAutoLastError = "";
let githubAutoLastAt = "";
let githubLastSync = { source: "not checked", at: "", message: "" };
let lastDbFileHash = "";
let databaseWatchStarted = false;

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
function queueGithubOperation(operation) {
  const job = githubOperationQueue.then(operation);
  githubOperationQueue = job.catch(() => {});
  return job;
}
function onlyKnownState(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const key of KEYS) if (Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  return out;
}
function formatVancouverDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Vancouver", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true
  }).format(date);
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
function fileHash(contents) {
  return crypto.createHash("sha256").update(contents).digest("hex");
}
function queueSave({ syncGithub = true, preserveSavedAt = false } = {}) {
  writeChain = writeChain.then(async () => {
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    if (!preserveSavedAt) db.savedAt = Math.max(Date.now(), timestampMs(db.savedAt) + 1);
    const contents = JSON.stringify(db, null, 2);
    const temporary = DB_FILE + ".tmp";
    await fs.promises.writeFile(temporary, contents, "utf8");
    await fs.promises.rename(temporary, DB_FILE);
    lastDbFileHash = fileHash(contents);
    if (syncGithub) scheduleAutomaticGithubSave();
  });
  return writeChain;
}
function scheduleAutomaticGithubSave() {
  if (!githubBackup.isAutoEnabled()) return;
  if (githubAutoTimer) clearTimeout(githubAutoTimer);
  githubAutoTimer = setTimeout(() => {
    githubAutoTimer = null;
    queueGithubOperation(async () => {
      await writeChain;
      const contents = await fs.promises.readFile(DB_FILE, "utf8");
      const current = normalizeDatabase(JSON.parse(contents));
      return githubBackup.saveLeagueData(current, "Kaiser Family Fantasy SMX: automatic league-data save");
    }).then(result => {
      githubAutoLastAt = new Date().toISOString();
      githubAutoLastError = "";
      if (result.changed) {
        console.log(`Automatic GitHub league-data save: ${result.commit.shortSha || result.commit.sha.slice(0, 7)} (${result.path}).`);
      }
    }).catch(err => {
      githubAutoLastAt = new Date().toISOString();
      githubAutoLastError = err.message || "Automatic GitHub league-data save failed.";
      console.error("Automatic GitHub league-data save failed:", githubAutoLastError);
    });
  }, 1300);
  if (githubAutoTimer.unref) githubAutoTimer.unref();
}
async function currentDiskDatabase() {
  await writeChain;
  const contents = await fs.promises.readFile(DB_FILE, "utf8");
  const stat = await fs.promises.stat(DB_FILE);
  return { data: normalizeDatabase(JSON.parse(contents), stat.mtimeMs), contents, stat };
}
async function syncNewestLeagueSave(sourceLabel = "manual scan") {
  await writeChain;
  if (!githubBackup.configured()) throw new Error("GitHub is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY on the server.");
  const local = await currentDiskDatabase();
  const localSavedAt = databaseTimestamp(local.data, local.stat.mtimeMs);
  const remote = await githubBackup.getLatestLeagueData();
  const remoteSavedAt = remote.found ? databaseTimestamp(remote.data, remote.savedAt) : 0;

  if (remote.found && remoteSavedAt > localSavedAt) {
    db = normalizeDatabase(remote.data, remoteSavedAt);
    await queueSave({ syncGithub: false, preserveSavedAt: true });
    githubLastSync = { source: "GitHub", at: new Date().toISOString(), message: `Loaded the newer GitHub save (${formatVancouverDateTime(remoteSavedAt)}) into ${DATA_DIR}.` };
    return { ok: true, source: "GitHub", localSavedAt, githubSavedAt: remoteSavedAt, savedAt: remoteSavedAt, message: githubLastSync.message };
  }

  // Render/local disk wins ties. When it is newer (or GitHub has no copy yet),
  // update GitHub from the exact live JSON currently on disk.
  const isSameData = remote.found && JSON.stringify(remote.data) === JSON.stringify(local.data);
  let githubSave = null;
  if (githubBackup.isAutoEnabled() && (!remote.found || localSavedAt > remoteSavedAt || !isSameData)) {
    githubSave = await githubBackup.saveLeagueData(local.data, `Kaiser Family Fantasy SMX: ${sourceLabel} sync from Render`);
  }
  const message = remote.found
    ? `Render is the newest save (${formatVancouverDateTime(localSavedAt)}); GitHub was checked${githubSave?.changed ? " and updated" : ""}.`
    : `Only the Render save existed; ${githubSave?.changed ? "a GitHub copy was created" : "GitHub auto-backup is currently disabled"}.`;
  githubLastSync = { source: "Render", at: new Date().toISOString(), message };
  return { ok: true, source: "Render", localSavedAt, githubSavedAt: githubSave?.savedAt || remoteSavedAt, savedAt: localSavedAt, githubCommit: githubSave?.commit || null, message };
}
function startDatabaseFileWatcher() {
  if (databaseWatchStarted || !githubBackup.isAutoEnabled()) return;
  databaseWatchStarted = true;
  fs.watchFile(DB_FILE, { interval: 1000, persistent: false }, async (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
    try {
      const contents = await fs.promises.readFile(DB_FILE, "utf8");
      const hash = fileHash(contents);
      if (hash === lastDbFileHash) return;
      const parsed = JSON.parse(contents);
      const previousState = db.state;
      db = normalizeDatabase(parsed, current.mtimeMs);
      const externalStamp = Math.max(db.savedAt, Date.now(), current.mtimeMs);
      db.savedAt = externalStamp;
      for (const key of KEYS) {
        if (JSON.stringify(previousState[key]) !== JSON.stringify(db.state[key])) db.keyUpdatedAt[key] = externalStamp;
      }
      lastDbFileHash = hash;
      await queueSave({ syncGithub: true, preserveSavedAt: true });
      console.log("Detected an external change to league-data.json; GitHub backup queued.");
    } catch (err) {
      console.warn("A change to league-data.json could not be read for GitHub backup:", err.message);
    }
  });
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
async function handleApi(req, res, url) {
  if (url.pathname === "/api/results/preview" && req.method === "POST") {
    const body = await readBody(req);
    const result = await fetchOfficialResults({
      url: body.url, series: body.series, division: body.division, csv: body.csv, csvName: body.csvName,
      event: body.event, round: body.round, eventDate: body.eventDate, eventType: body.eventType,
      phase: body.phase, supercrossFormat: body.supercrossFormat
    });
    return send(res, 200, result);
  }
  if (url.pathname === "/api/github/status" && req.method === "GET") {
    const local = await currentDiskDatabase().catch(() => ({ data: db, stat: null }));
    const localSavedAt = databaseTimestamp(local.data, local.stat?.mtimeMs || 0);
    const status = await githubBackup.getStatus({
      localSavedAt,
      localStorage: DATA_DIR === "/var/data" ? "Render persistent disk" : "Local server JSON file",
      autoSaveLastAt: githubAutoLastAt,
      autoSaveLastError: githubAutoLastError,
      lastSync: githubLastSync
    });
    return send(res, 200, status);
  }
  if (url.pathname === "/api/github/save" && req.method === "POST") {
    await readBody(req);
    if (!githubBackup.authorize(req.headers["x-kf-github-backup-password"])) return send(res, 401, { error: "GitHub backup password is incorrect or not configured." });
    const result = await queueGithubOperation(async () => {
      const local = await currentDiskDatabase();
      return githubBackup.saveLeagueData(local.data, "Kaiser Family Fantasy SMX: manual league-data save to GitHub");
    });
    githubAutoLastAt = new Date().toISOString(); githubAutoLastError = "";
    return send(res, 200, result);
  }
  if (url.pathname === "/api/github/sync" && req.method === "POST") {
    await readBody(req);
    if (!githubBackup.authorize(req.headers["x-kf-github-backup-password"])) return send(res, 401, { error: "GitHub backup password is incorrect or not configured." });
    const result = await queueGithubOperation(() => syncNewestLeagueSave("manual"));
    return send(res, 200, result);
  }
  if (url.pathname === "/api/state" && req.method === "GET") {
    await writeChain;
    return send(res, 200, {
      version: db.version, state: db.state, keyUpdatedAt: db.keyUpdatedAt, savedAt: db.savedAt,
      storageMode: DATA_DIR === "/var/data" ? "render" : "local",
      storageLabel: DATA_DIR === "/var/data" ? "Render persistent disk (/var/data/league-data.json)" : (DATA_DIR === path.join(ROOT, "data") ? "project file data/league-data.json" : `server directory ${DATA_DIR}/league-data.json`)
    });
  }
  if (url.pathname === "/api/state" && req.method === "PUT") {
    const body = await readBody(req);
    const incoming = onlyKnownState(body.state);
    const stamp = Number(body.updatedAt) || Date.now();
    db = { version: 1, state: incoming, keyUpdatedAt: {}, savedAt: stamp };
    for (const key of KEYS) db.keyUpdatedAt[key] = stamp;
    await queueSave();
    return send(res, 200, { ok: true, keysSaved: Object.keys(incoming).length, savedAt: db.savedAt });
  }
  if (url.pathname === "/api/state" && req.method === "DELETE") {
    const clearedAt = Date.now();
    db = { version: 1, state: {}, keyUpdatedAt: Object.fromEntries([...KEYS].map(key => [key, clearedAt])), savedAt: clearedAt };
    await queueSave();
    return send(res, 200, { ok: true, savedAt: db.savedAt });
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
    return send(res, 200, { ok: true, applied: stamp >= current, savedAt: db.savedAt || db.keyUpdatedAt[key] || current });
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
  // Keep persistent league data, Git metadata, dependencies, and server secrets private.
  const pathParts = pathname.split("/").filter(Boolean);
  if (pathParts.some(part => part === "data" || part === ".git" || part === "node_modules" || part === ".env" || (part.startsWith(".env.") && part !== ".env.example"))) {
    return send(res, 404, "Not found", "text/plain; charset=utf-8");
  }
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
  let localFileExists = true;
  try {
    const contents = await fs.promises.readFile(DB_FILE, "utf8");
    const stat = await fs.promises.stat(DB_FILE);
    const parsed = JSON.parse(contents);
    db = normalizeDatabase(parsed, stat.mtimeMs);
    const embeddedSavedAt = databaseTimestamp(parsed);
    if (stat.mtimeMs > embeddedSavedAt + 3000) {
      db.savedAt = stat.mtimeMs;
      for (const key of KEYS) db.keyUpdatedAt[key] = Math.max(Number(db.keyUpdatedAt[key] || 0), stat.mtimeMs);
      // Persist the inferred timestamp before comparing against GitHub.
      await queueSave({ syncGithub: false, preserveSavedAt: true });
    } else {
      lastDbFileHash = fileHash(contents);
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      localFileExists = false;
      db = { version: 1, state: {}, keyUpdatedAt: {}, savedAt: 0 };
    } else {
      console.error("Could not read Render/local league database; starting with an empty store.", err);
      localFileExists = false;
    }
  }

  // On every server start, compare the live Render/local JSON with GitHub's JSON
  // copy. Whichever has the later savedAt timestamp becomes the active database.
  if (githubBackup.configured()) {
    try {
      const remote = await githubBackup.getLatestLeagueData();
      let localSavedAt = db.savedAt;
      if (!localFileExists) localSavedAt = 0;
      const remoteSavedAt = remote.found ? databaseTimestamp(remote.data, remote.savedAt) : 0;
      if (remote.found && (!localFileExists || remoteSavedAt > localSavedAt)) {
        db = normalizeDatabase(remote.data, remoteSavedAt);
        await queueSave({ syncGithub: false, preserveSavedAt: true });
        githubLastSync = { source: "GitHub", at: new Date().toISOString(), message: "Loaded the newer GitHub league-data JSON into Render/local storage." };
        console.log(`Loaded newer GitHub league save (${new Date(remoteSavedAt).toISOString()}).`);
      } else {
        if (!localFileExists) {
          db = { version: 1, state: {}, keyUpdatedAt: {}, savedAt: Date.now() };
          await queueSave({ syncGithub: false });
        }
        const local = normalizeDatabase(db);
        const same = remote.found && JSON.stringify(remote.data) === JSON.stringify(local);
        if (githubBackup.isAutoEnabled() && (!remote.found || localSavedAt > remoteSavedAt || !same)) {
          const saved = await githubBackup.saveLeagueData(local, "Kaiser Family Fantasy SMX: startup sync from Render");
          console.log(saved.changed ? `Synced Render league save to GitHub (${saved.commit.shortSha}).` : "Render and GitHub league saves already match.");
        }
        githubLastSync = { source: "Render", at: new Date().toISOString(), message: remote.found ? "Render was the newest save." : "No GitHub JSON copy existed; Render is the active save." };
      }
    } catch (err) {
      console.error("Could not compare Render and GitHub league saves; keeping the Render/local copy:", err.message);
      githubLastSync = { source: "Render (GitHub check failed)", at: new Date().toISOString(), message: err.message };
      if (!localFileExists) await queueSave({ syncGithub: false });
    }
  } else if (!localFileExists) {
    await queueSave({ syncGithub: false });
    githubLastSync = { source: "Render/local only", at: new Date().toISOString(), message: "GitHub is not configured; the local database was initialized." };
  }

  // A file watcher also catches direct edits to league-data.json made outside the app.
  startDatabaseFileWatcher();

  const server = http.createServer((req, res) => { serve(req, res); });
  server.on("error", err => {
    if (err.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Stop Live Server in VS Code, then run npm start again.`);
    else console.error(err);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Kaiser Family Fantasy SMX is listening on ${HOST}:${PORT}/\nLeague data saves to: ${DB_FILE}\nGitHub JSON backup: ${githubBackup.configured() ? "connected" : "not configured"}\nPress Ctrl+C to stop the server.`);
  });
}
main().catch(err => { console.error("Server startup failed:", err); process.exit(1); });
