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
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || "0.0.0.0";
const MIN_SEASON_YEAR = 2010;
const MAX_SEASON_YEAR = 2099;
const DEFAULT_ACTIVE_YEAR = Number(process.env.KF_ACTIVE_SEASON || 2027);
const SEASON_DIRECTORY = safeRelativePath(process.env.GITHUB_SEASON_DIRECTORY || "league-data/seasons");
const SEASON_INDEX_PATH = safeRelativePath(process.env.GITHUB_SEASON_INDEX_PATH || "league-data/season-index.json");
if (!SEASON_DIRECTORY || !SEASON_INDEX_PATH) throw new Error("GitHub season paths must be safe repository-relative paths.");
const LEGACY_DATA_PATH = process.env.GITHUB_DATA_PATH || "league-data/league-data.json";
const INDEXED_SEASON_KEYS = [
  "kaiserFantasyAthletes", "kaiserFantasyTeams", "kaiserFantasyScores",
  "kaiserFantasyTrades", "kaiserFantasyDraftState", "kaiserFantasyDraftSettings",
  "kaiserFantasySchedule"
];
const KEYS = new Set(INDEXED_SEASON_KEYS);
const COMMISSIONER_SESSION_COOKIE = "kf_commissioner_session";
const COMMISSIONER_SESSION_MS = 12 * 60 * 60 * 1000;
const COMMISSIONER_PASSWORD = process.env.COMMISSIONER_PASSWORD || process.env.GITHUB_BACKUP_PASSWORD || "TR3#$21a930T";
const SESSION_SECRET = process.env.COMMISSIONER_SESSION_SECRET || process.env.GITHUB_BACKUP_PASSWORD || process.env.GITHUB_TOKEN || "Kaiser-Family-Fantasy-Commissioner-Session";

let activeYear = validYear(DEFAULT_ACTIVE_YEAR) ? DEFAULT_ACTIVE_YEAR : 2027;
let seasonIndex = { version: 1, activeYear, seasons: {} };
let indexLoaded = false;
let indexLoadPromise = null;
const seasonCache = new Map();
const seasonLoadPromises = new Map();
let githubOperationQueue = Promise.resolve();
let githubAutoLastError = "";
let githubAutoLastAt = "";
let githubLastSync = { source: "not checked", at: "", message: "" };
const publicHistoryCache = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8", ".ico": "image/x-icon"
};

function safeRelativePath(value) {
  const clean = String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean || clean.includes("\0") || clean.split("/").some(part => !part || part === "." || part === "..")) return null;
  return clean;
}
function validYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= MIN_SEASON_YEAR && year <= MAX_SEASON_YEAR;
}
function seasonPath(year) { return `${SEASON_DIRECTORY}/${Number(year)}.json`; }
function emptyState() {
  return {
    kaiserFantasyAthletes: [], kaiserFantasyTeams: [], kaiserFantasyScores: [],
    kaiserFantasyTrades: [], kaiserFantasyDraftState: { picks: [] },
    kaiserFantasyDraftSettings: {}, kaiserFantasySchedule: []
  };
}
function emptyDatabase(year) {
  return { version: 1, seasonYear: Number(year), archived: false, state: emptyState(), keyUpdatedAt: {}, savedAt: 0 };
}
function send(res, status, data, type = "application/json; charset=utf-8", extraHeaders = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extraHeaders });
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
function timestampMs(value) {
  if (typeof value === "string") return Date.parse(value) || 0;
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
function maxKeyTimestamp(keyUpdatedAt) {
  return Math.max(0, ...Object.values(keyUpdatedAt || {}).map(value => Number(value) || 0));
}
function normalizeDatabase(input, year, fallbackTimestamp = 0) {
  const keyUpdatedAt = input?.keyUpdatedAt && typeof input.keyUpdatedAt === "object" && !Array.isArray(input.keyUpdatedAt) ? input.keyUpdatedAt : {};
  const savedAt = timestampMs(input?.savedAt) || maxKeyTimestamp(keyUpdatedAt) || Number(fallbackTimestamp) || 0;
  const state = { ...emptyState(), ...onlyKnownState(input?.state) };
  return {
    version: 1,
    seasonYear: Number(year),
    archived: !!input?.archived,
    archivedAt: input?.archivedAt || "",
    state,
    keyUpdatedAt: { ...keyUpdatedAt },
    savedAt
  };
}
function stateSignature(value) {
  return JSON.stringify({ version: value.version, seasonYear: value.seasonYear, archived: value.archived, state: value.state, keyUpdatedAt: value.keyUpdatedAt });
}
function formatVancouverDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Vancouver", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}
function parseCookies(req) {
  const result = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    try { result[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch {}
  }
  return result;
}
function timingSafeEqualText(leftText, rightText) {
  const left = Buffer.from(String(leftText || ""));
  const right = Buffer.from(String(rightText || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function sessionSignature(issuedAt) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(String(issuedAt)).digest("hex");
}
function commissionerAuthenticated(req) {
  const token = parseCookies(req)[COMMISSIONER_SESSION_COOKIE] || "";
  const [issuedAtText, signature] = token.split(".");
  const issuedAt = Number(issuedAtText);
  if (!Number.isFinite(issuedAt) || !signature || Date.now() - issuedAt > COMMISSIONER_SESSION_MS || issuedAt > Date.now() + 60_000) return false;
  return timingSafeEqualText(sessionSignature(issuedAt), signature);
}
function commissionerCookie(req, clear = false) {
  const secure = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production";
  return `${COMMISSIONER_SESSION_COOKIE}=${clear ? "" : encodeURIComponent(`${Date.now()}.${sessionSignature(Date.now())}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : Math.floor(COMMISSIONER_SESSION_MS / 1000)}${secure ? "; Secure" : ""}`;
}
function requireCommissioner(req) {
  if (commissionerAuthenticated(req)) return true;
  const error = new Error("Commissioner sign-in is required to access or edit previous seasons.");
  error.status = 401;
  throw error;
}
function requireYearAccess(req, year) {
  if (Number(year) !== Number(activeYear)) requireCommissioner(req);
}
function selectedYear(url) {
  const raw = url.searchParams.get("year");
  if (!raw) return Number(activeYear);
  if (!validYear(raw)) {
    const error = new Error(`Season year must be between ${MIN_SEASON_YEAR} and ${MAX_SEASON_YEAR}.`);
    error.status = 400;
    throw error;
  }
  return Number(raw);
}

async function ensureIndexLoaded() {
  if (indexLoaded) return;
  if (!indexLoadPromise) {
    indexLoadPromise = (async () => {
      const remote = await githubBackup.getJsonFile(SEASON_INDEX_PATH);
      if (remote.found) {
        const value = remote.data;
        const candidate = Number(value.activeYear);
        if (validYear(candidate)) activeYear = candidate;
        seasonIndex = {
          version: 1,
          activeYear,
          seasons: value.seasons && typeof value.seasons === "object" && !Array.isArray(value.seasons) ? value.seasons : {}
        };
      } else {
        seasonIndex = { version: 1, activeYear, seasons: {} };
      }
      indexLoaded = true;
    })();
  }
  try { await indexLoadPromise; } finally { indexLoadPromise = null; }
}
async function persistSeasonIndex(message = "Kaiser Family Fantasy SMX: update season index") {
  seasonIndex.activeYear = activeYear;
  await queueGithubOperation(() => githubBackup.saveJsonFile(seasonIndex, message, SEASON_INDEX_PATH));
}
async function loadSeasonDatabase(year) {
  const target = Number(year);
  if (!validYear(target)) throw new Error("Invalid season year.");
  await ensureIndexLoaded();
  if (seasonCache.has(target)) return seasonCache.get(target);
  if (seasonLoadPromises.has(target)) return seasonLoadPromises.get(target);
  const promise = (async () => {
    let remote = await githubBackup.getLatestLeagueData(seasonPath(target));
    if (!remote.found && target === activeYear) {
      const legacyPath = githubBackup.getConfigSummary().dataPath || LEGACY_DATA_PATH;
      if (legacyPath !== seasonPath(target)) {
        const legacy = await githubBackup.getLatestLeagueData(legacyPath);
        if (legacy.found) {
          const migrated = normalizeDatabase(legacy.data, target, legacy.savedAt);
          await queueGithubOperation(() => githubBackup.saveLeagueData(migrated, `Kaiser Family Fantasy SMX: migrate active league data into ${target} season file`, seasonPath(target)));
          seasonIndex.seasons[String(target)] = { year: target, status: "current", archived: false, migratedFrom: legacyPath, updatedAt: new Date().toISOString() };
          await persistSeasonIndex(`Kaiser Family Fantasy SMX: register ${target} season file`);
          seasonCache.set(target, migrated);
          return migrated;
        }
      }
    }
    const database = remote.found ? normalizeDatabase(remote.data, target, remote.savedAt) : emptyDatabase(target);
    if (remote.found && !seasonIndex.seasons[String(target)]) {
      seasonIndex.seasons[String(target)] = { year: target, status: database.archived ? "archived" : target === activeYear ? "current" : "workspace", archived: !!database.archived, createdAt: new Date().toISOString() };
      await persistSeasonIndex(`Kaiser Family Fantasy SMX: register existing ${target} season file`);
    }
    seasonCache.set(target, database);
    return database;
  })();
  seasonLoadPromises.set(target, promise);
  try { return await promise; } finally { seasonLoadPromises.delete(target); }
}
async function saveSeasonDatabase(year, database, message = "Kaiser Family Fantasy SMX: season save") {
  const target = Number(year);
  if (!validYear(target)) throw new Error("Invalid season year.");
  const normalized = normalizeDatabase({ ...database, savedAt: Math.max(Date.now(), Number(database.savedAt || 0) + 1) }, target);
  const wasIndexed = !!seasonIndex.seasons[String(target)];
  const result = await queueGithubOperation(() => githubBackup.saveLeagueData(normalized, message, seasonPath(target)));
  seasonCache.set(target, normalized);
  const entry = seasonIndex.seasons[String(target)] || { year: target, createdAt: new Date().toISOString() };
  seasonIndex.seasons[String(target)] = {
    ...entry,
    year: target,
    status: normalized.archived ? "archived" : target === activeYear ? "current" : (entry.status || "workspace"),
    archived: normalized.archived,
    archivedAt: normalized.archivedAt || entry.archivedAt || "",
    savedAt: normalized.savedAt,
    updatedAt: new Date().toISOString()
  };
  if (target === activeYear) seasonIndex.activeYear = activeYear;
  // Register a newly-created year file as soon as its first successful save commits.
  // Existing index entries are not rewritten for every ordinary score edit.
  if (!wasIndexed) await persistSeasonIndex(`Kaiser Family Fantasy SMX: register ${target} season file`);
  githubAutoLastAt = new Date().toISOString();
  githubAutoLastError = "";
  githubLastSync = { source: "GitHub", at: githubAutoLastAt, message: `Saved season ${target} directly to GitHub (${result.path}).` };
  return { ...result, seasonYear: target };
}
async function ensureGithubReady() {
  if (!githubBackup.configured()) throw new Error("GitHub-only saving is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY in the server environment.");
  await ensureIndexLoaded();
  const current = await loadSeasonDatabase(activeYear);
  // Recover an archive whose season file and next-year file were committed but whose
  // index update was interrupted. The next-year JSON is the durable recovery marker.
  if (current.archived && activeYear < MAX_SEASON_YEAR) {
    const nextYear = activeYear + 1;
    const nextRemote = await githubBackup.getLatestLeagueData(seasonPath(nextYear));
    if (nextRemote.found) {
      activeYear = nextYear;
      seasonIndex.activeYear = nextYear;
      seasonIndex.seasons[String(activeYear - 1)] = {
        ...(seasonIndex.seasons[String(activeYear - 1)] || {}), year: activeYear - 1,
        status: "archived", archived: true, archivedAt: current.archivedAt || ""
      };
      seasonIndex.seasons[String(nextYear)] = {
        ...(seasonIndex.seasons[String(nextYear)] || {}), year: nextYear, status: "current", archived: false
      };
      await persistSeasonIndex(`Kaiser Family Fantasy SMX: recover ${nextYear} active-season index after archive`);
      await loadSeasonDatabase(nextYear);
    }
  }
}
async function reloadSeasonFromGithub(year) {
  const target = Number(year);
  const remote = await githubBackup.getLatestLeagueData(seasonPath(target));
  if (!remote.found) throw new Error(`No saved GitHub season file exists for ${target}.`);
  const database = normalizeDatabase(remote.data, target, remote.savedAt);
  seasonCache.set(target, database);
  githubLastSync = { source: "GitHub", at: new Date().toISOString(), message: `Loaded season ${target} from GitHub.` };
  return database;
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
function cleanSeasonDate(value, year) {
  if (typeof value !== "string" || !value) return value;
  return value.replace(/(^|\D)(19|20)\d{2}(?=-)/, (match, prefix) => `${prefix}${year}`);
}
function cloneJson(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function normalizedName(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function scoreMatchesRider(record, riderId, riderName, riderClass) {
  if (riderId && String(record.riderId || "") === String(riderId)) return true;
  return normalizedName(record.riderName || record.athleteName) === normalizedName(riderName)
    && (!riderClass || normalizedName(record.riderClass || record.athleteClass) === normalizedName(riderClass));
}
function scoreRoundKey(record) {
  const series = normalizedName(record.series || record.riderClass || record.division || "unknown");
  const year = Number(record.seasonYear || (record.recordedAt ? new Date(record.recordedAt).getUTCFullYear() : activeYear));
  if (record.scheduledEventId) return `${year}|${series}|event:${record.scheduledEventId}`;
  return `${year}|${series}|event:${normalizedName(record.event || "")}|round:${record.round ?? ""}`;
}
function summarizeHistoricalRider(database, riderId, riderName, riderClass, year) {
  const state = database.state || {};
  const athletes = Array.isArray(state.kaiserFantasyAthletes) ? state.kaiserFantasyAthletes : [];
  const athlete = athletes.find(item => (riderId && String(item.id || item.riderId) === String(riderId))
    || (normalizedName(item.name || item.riderName) === normalizedName(riderName) && (!riderClass || normalizedName(item.primarySeries || item.class || item.riderClass) === normalizedName(riderClass)))) || null;
  const scores = Array.isArray(state.kaiserFantasyScores) ? state.kaiserFantasyScores : [];
  const records = scores.filter(record => scoreMatchesRider(record, riderId, riderName, riderClass)).map(record => ({
    id: record.id || "", riderId: record.riderId || riderId || "", riderName: record.riderName || record.athleteName || athlete?.name || riderName || "",
    riderClass: record.riderClass || record.athleteClass || athlete?.primarySeries || athlete?.class || riderClass || "",
    riderNumber: record.riderNumber || athlete?.number || "", riderRaceTeam: record.riderRaceTeam || record.raceTeam || athlete?.raceTeam || "",
    manufacturer: record.manufacturer || athlete?.manufacturer || "", series: record.series || "", division: record.division || record.riderClass || "",
    event: record.event || "", round: record.round ?? "", eventType: record.eventType || "", scoringPhase: record.scoringPhase || "",
    place: record.place || 0, points: Number(record.points || 0), bonuses: Array.isArray(record.bonuses) ? record.bonuses : [],
    teamName: record.teamName || "Unrostered / Free Agent", recordedAt: record.recordedAt || "", seasonYear: Number(year)
  }));
  const groups = new Map();
  for (const record of records) {
    const series = String(record.series || record.riderClass || "Unknown");
    const division = String(record.division || record.riderClass || "Unknown");
    const key = `${normalizedName(series)}|${normalizedName(division)}`;
    if (!groups.has(key)) groups.set(key, { series, division, total: 0, rounds: new Set() });
    const group = groups.get(key);
    group.total += record.points;
    group.rounds.add(scoreRoundKey({ ...record, seasonYear: Number(year) }));
  }
  const averages = [...groups.values()].map(group => ({
    series: group.series, division: group.division, total: group.total, rounds: group.rounds.size,
    average: group.rounds.size ? group.total / group.rounds.size : 0
  }));
  return {
    year: Number(year), archived: !!database.archived,
    athlete: athlete ? {
      id: athlete.id || athlete.riderId || riderId || "", name: athlete.name || athlete.riderName || riderName || "",
      number: athlete.number || "", class: athlete.primarySeries || athlete.class || athlete.riderClass || riderClass || "",
      secondarySeries: athlete.secondarySeries || [], raceTeam: athlete.raceTeam || "", manufacturer: athlete.manufacturer || "",
      nationality: athlete.nationality || "", nationalityRegion: athlete.nationalityRegion || ""
    } : null,
    records, averages
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/commissioner/login" && req.method === "POST") {
    const body = await readBody(req);
    if (!timingSafeEqualText(body.password, COMMISSIONER_PASSWORD)) return send(res, 401, { error: "Incorrect commissioner password." });
    const issuedAt = Date.now();
    const cookie = `${COMMISSIONER_SESSION_COOKIE}=${encodeURIComponent(`${issuedAt}.${sessionSignature(issuedAt)}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(COMMISSIONER_SESSION_MS / 1000)}${req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
    return send(res, 200, { ok: true, expiresAt: issuedAt + COMMISSIONER_SESSION_MS }, "application/json; charset=utf-8", { "Set-Cookie": cookie });
  }
  if (url.pathname === "/api/commissioner/session" && req.method === "GET") {
    return send(res, 200, { authenticated: commissionerAuthenticated(req), expiresInMs: commissionerAuthenticated(req) ? COMMISSIONER_SESSION_MS : 0 });
  }
  if (url.pathname === "/api/commissioner/logout" && req.method === "POST") {
    return send(res, 200, { ok: true }, "application/json; charset=utf-8", { "Set-Cookie": `${COMMISSIONER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production" ? "; Secure" : ""}` });
  }

  if (url.pathname === "/api/seasons/meta" && req.method === "GET") {
    await ensureGithubReady();
    const years = {};
    for (const [year, metadata] of Object.entries(seasonIndex.seasons || {})) {
      if (validYear(year)) years[year] = { status: metadata.status || (Number(year) === activeYear ? "current" : "workspace"), archived: !!metadata.archived };
    }
    years[String(activeYear)] = { ...(years[String(activeYear)] || {}), status: "current", archived: false };
    return send(res, 200, { activeYear, minYear: MIN_SEASON_YEAR, maxYear: MAX_SEASON_YEAR, seasons: years });
  }

  if (url.pathname === "/api/seasons/archive" && req.method === "POST") {
    requireCommissioner(req);
    await ensureGithubReady();
    const body = await readBody(req);
    const year = Number(body.year);
    if (!validYear(year) || year !== activeYear) {
      const error = new Error(`Only the active season (${activeYear}) can be archived.`); error.status = 409; throw error;
    }
    if (year >= MAX_SEASON_YEAR) throw new Error("The next season would exceed the supported year range.");
    const current = await loadSeasonDatabase(year);
    current.archived = true;
    current.archivedAt = current.archivedAt || new Date().toISOString();
    await saveSeasonDatabase(year, current, `Kaiser Family Fantasy SMX: archive ${year} season`);

    const nextYear = year + 1;
    let nextRemote = await githubBackup.getLatestLeagueData(seasonPath(nextYear));
    let next;
    let nextSave;
    if (nextRemote.found) {
      // Preserve a next-year file from a previous partial archive attempt or an
      // intentionally prepared workspace; never overwrite an existing year's work.
      next = normalizeDatabase(nextRemote.data, nextYear, nextRemote.savedAt);
      nextSave = { path: seasonPath(nextYear), commit: nextRemote.commit || null };
    } else {
      next = emptyDatabase(nextYear);
      // Carry the rider directory and team identities forward as independent copies.
      // Riders, teams' ownership/passwords persist, but no points, rosters, trades,
      // draft data/settings or schedule are carried into the new season.
      next.state.kaiserFantasyAthletes = cloneJson(Array.isArray(current.state.kaiserFantasyAthletes) ? current.state.kaiserFantasyAthletes : []);
      const currentTeams = Array.isArray(current.state.kaiserFantasyTeams) ? current.state.kaiserFantasyTeams : [];
      next.state.kaiserFantasyTeams = currentTeams.map(team => ({ ...cloneJson(team), roster: [] }));
      const initializedAt = Date.now();
      next.savedAt = initializedAt;
      for (const key of KEYS) next.keyUpdatedAt[key] = initializedAt;
      nextSave = await queueGithubOperation(() => githubBackup.saveLeagueData(next, `Kaiser Family Fantasy SMX: start ${nextYear} season`, seasonPath(nextYear)));
    }
    seasonCache.set(nextYear, next);
    seasonIndex.seasons[String(year)] = { ...(seasonIndex.seasons[String(year)] || {}), year, status: "archived", archived: true, archivedAt: current.archivedAt, savedAt: current.savedAt };
    seasonIndex.seasons[String(nextYear)] = { year: nextYear, status: "current", archived: false, savedAt: next.savedAt, createdAt: new Date().toISOString() };
    activeYear = nextYear;
    seasonIndex.activeYear = activeYear;
    await persistSeasonIndex(`Kaiser Family Fantasy SMX: activate ${nextYear} after archiving ${year}`);
    publicHistoryCache.clear();
    return send(res, 200, { ok: true, archivedYear: year, currentYear: nextYear, path: seasonPath(nextYear), commit: nextSave.commit || null });
  }

  if (url.pathname === "/api/seasons/copy" && req.method === "POST") {
    requireCommissioner(req);
    await ensureGithubReady();
    const body = await readBody(req);
    const sourceYear = Number(body.sourceYear), destinationYear = Number(body.destinationYear);
    const parts = Array.isArray(body.parts) ? body.parts.filter(part => ["riders", "schedule"].includes(part)) : [];
    if (!validYear(sourceYear) || !validYear(destinationYear) || sourceYear === destinationYear || !parts.length) throw new Error("Choose two different valid seasons and at least one copy type.");
    const source = await loadSeasonDatabase(sourceYear);
    const destination = await loadSeasonDatabase(destinationYear);
    if (parts.includes("riders")) {
      const riders = Array.isArray(source.state.kaiserFantasyAthletes) ? cloneJson(source.state.kaiserFantasyAthletes) : [];
      destination.state.kaiserFantasyAthletes = riders;
      const byId = new Map(riders.map(rider => [String(rider.id || rider.riderId || ""), rider]));
      const byNameClass = new Map(riders.map(rider => [`${normalizedName(rider.name || rider.riderName)}|${normalizedName(rider.primarySeries || rider.class || rider.riderClass)}`, rider]));
      destination.state.kaiserFantasyTeams = (Array.isArray(destination.state.kaiserFantasyTeams) ? destination.state.kaiserFantasyTeams : []).map(team => ({
        ...team,
        roster: (Array.isArray(team.roster) ? team.roster : []).map(rider => {
          const replacement = byId.get(String(rider.id || rider.riderId || "")) || byNameClass.get(`${normalizedName(rider.name || rider.riderName)}|${normalizedName(rider.primarySeries || rider.class || rider.riderClass)}`);
          return replacement ? cloneJson(replacement) : rider;
        })
      }));
    }
    if (parts.includes("schedule")) {
      const events = Array.isArray(source.state.kaiserFantasySchedule) ? source.state.kaiserFantasySchedule : [];
      destination.state.kaiserFantasySchedule = events.map(event => ({
        ...cloneJson(event), id: crypto.randomUUID(), date: cleanSeasonDate(event.date, destinationYear), endDate: cleanSeasonDate(event.endDate, destinationYear)
      }));
    }
    const saved = await saveSeasonDatabase(destinationYear, destination, `Kaiser Family Fantasy SMX: copy ${parts.join(" and ")} from ${sourceYear} to ${destinationYear}`);
    publicHistoryCache.delete(sourceYear);
    return send(res, 200, { ok: true, sourceYear, destinationYear, copied: parts, riderCount: destination.state.kaiserFantasyAthletes.length, scheduleCount: destination.state.kaiserFantasySchedule.length, path: saved.path });
  }

  if (url.pathname === "/api/public/athlete-history" && req.method === "GET") {
    await ensureGithubReady();
    const riderId = url.searchParams.get("riderId") || "";
    const riderName = url.searchParams.get("name") || "";
    const riderClass = url.searchParams.get("class") || "";
    if (!riderId && !riderName) return send(res, 400, { error: "A rider ID or name is required." });
    const years = Object.entries(seasonIndex.seasons || {}).map(([year, meta]) => Number(year)).filter(year => validYear(year) && year < activeYear && seasonIndex.seasons[String(year)]?.archived).sort((a, b) => b - a);
    const seasons = [];
    for (const year of years) {
      try {
        const database = await loadSeasonDatabase(year);
        if (!database.archived) continue;
        const result = summarizeHistoricalRider(database, riderId, riderName, riderClass, year);
        if (result.records.length || result.athlete) seasons.push(result);
      } catch (error) {
        console.warn(`Could not read archived season ${year} for public athlete history: ${error.message}`);
      }
    }
    return send(res, 200, { seasons });
  }

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
    await ensureGithubReady();
    const status = await githubBackup.getStatus({
      dataPath: seasonPath(activeYear),
      storageMode: "github-only", storageLabel: `GitHub season files in ${githubBackup.getConfigSummary().repository}`,
      activeSavedAt: seasonCache.get(activeYear)?.savedAt || 0,
      activeYear,
      autoSaveLastAt: githubAutoLastAt,
      autoSaveLastError: githubAutoLastError,
      lastSync: githubLastSync
    });
    return send(res, 200, status);
  }

  if (url.pathname === "/api/github/save" && req.method === "POST") {
    const body = await readBody(req);
    if (!githubBackup.authorize(req.headers["x-kf-github-backup-password"])) return send(res, 401, { error: "GitHub backup password is incorrect or not configured." });
    const year = Number(body.year || activeYear);
    if (!validYear(year)) throw new Error("Choose a valid season year to save.");
    requireYearAccess(req, year);
    const database = await loadSeasonDatabase(year);
    const saved = await saveSeasonDatabase(year, database, `Kaiser Family Fantasy SMX: manual save of ${year} season`);
    await persistSeasonIndex(`Kaiser Family Fantasy SMX: confirm ${year} season save`);
    return send(res, 200, saved);
  }

  if (url.pathname === "/api/github/reload" && req.method === "POST") {
    const body = await readBody(req);
    if (!githubBackup.authorize(req.headers["x-kf-github-backup-password"])) return send(res, 401, { error: "GitHub backup password is incorrect or not configured." });
    const year = Number(body.year || activeYear);
    requireYearAccess(req, year);
    const database = await reloadSeasonFromGithub(year);
    return send(res, 200, { ok: true, source: "GitHub", seasonYear: year, savedAt: database.savedAt, message: `Loaded season ${year} from GitHub.` });
  }

  if (url.pathname === "/api/state" && req.method === "GET") {
    await ensureGithubReady();
    const year = selectedYear(url);
    requireYearAccess(req, year);
    const database = await loadSeasonDatabase(year);
    const meta = seasonIndex.seasons[String(year)] || {};
    return send(res, 200, {
      version: database.version, state: database.state, keyUpdatedAt: database.keyUpdatedAt, savedAt: database.savedAt,
      storageMode: "github", storageLabel: `GitHub season file ${seasonPath(year)}`,
      seasonYear: year, activeYear, archived: !!database.archived || !!meta.archived, status: meta.status || (year === activeYear ? "current" : "workspace")
    });
  }

  if (url.pathname === "/api/state" && req.method === "PUT") {
    await ensureGithubReady();
    const year = selectedYear(url);
    requireYearAccess(req, year);
    const body = await readBody(req);
    if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) return send(res, 400, { error: "The submitted league state must be a JSON object." });
    const database = await loadSeasonDatabase(year);
    const incoming = onlyKnownState(body.state);
    const stamp = Number(body.updatedAt) || Date.now();
    database.state = { ...emptyState(), ...incoming };
    for (const key of KEYS) database.keyUpdatedAt[key] = stamp;
    const saved = await saveSeasonDatabase(year, database, `Kaiser Family Fantasy SMX: restore ${year} season to GitHub`);
    await persistSeasonIndex(`Kaiser Family Fantasy SMX: register ${year} season`);
    return send(res, 200, { ok: true, keysSaved: Object.keys(incoming).length, savedAt: database.savedAt, storage: "GitHub", seasonYear: year, commit: saved.commit || null });
  }

  if (url.pathname === "/api/state" && req.method === "DELETE") {
    await ensureGithubReady();
    const year = selectedYear(url);
    requireYearAccess(req, year);
    const database = emptyDatabase(year);
    const clearedAt = Date.now();
    for (const key of KEYS) database.keyUpdatedAt[key] = clearedAt;
    await saveSeasonDatabase(year, database, `Kaiser Family Fantasy SMX: clear ${year} season in GitHub`);
    await persistSeasonIndex(`Kaiser Family Fantasy SMX: register cleared ${year} season`);
    return send(res, 200, { ok: true, savedAt: database.savedAt, storage: "GitHub", seasonYear: year });
  }

  const match = url.pathname.match(/^\/api\/state\/([^/]+)$/);
  if (match && req.method === "PUT") {
    await ensureGithubReady();
    const year = selectedYear(url);
    requireYearAccess(req, year);
    const key = decodeURIComponent(match[1]);
    if (!KEYS.has(key)) return send(res, 400, { error: "Unknown data category." });
    const body = await readBody(req);
    if (!Object.prototype.hasOwnProperty.call(body, "value")) return send(res, 400, { error: "The data category value is missing." });
    const database = await loadSeasonDatabase(year);
    const stamp = Number(body.updatedAt) || Date.now();
    const current = Number(database.keyUpdatedAt[key] || 0);
    if (stamp >= current) {
      database.state[key] = body.value;
      database.keyUpdatedAt[key] = stamp;
      const saved = await saveSeasonDatabase(year, database, `Kaiser Family Fantasy SMX: save ${key} for ${year} to GitHub`);
      return send(res, 200, { ok: true, applied: true, savedAt: database.savedAt, storage: "GitHub", seasonYear: year, commit: saved.commit || null });
    }
    return send(res, 200, { ok: true, applied: false, savedAt: database.savedAt, storage: "GitHub", seasonYear: year });
  }

  return send(res, 404, { error: "API endpoint not found." });
}

async function serve(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/healthz" && req.method === "GET") {
    return send(res, 200, { ok: true, storage: "github-only-season-files", activeYear, timestamp: new Date().toISOString() });
  }
  if (url.pathname.startsWith("/api/")) {
    try { return await handleApi(req, res, url); }
    catch (error) {
      if (error.status !== 401) console.error("API error:", error);
      const status = error.status === 401 ? 401 : (error.status === 400 ? 400 : error.status === 409 ? 409 : (error.status === 403 || error.status === 404 ? 502 : 503));
      return send(res, status, { error: error.message || "GitHub request failed." });
    }
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, "Bad URL", "text/plain; charset=utf-8"); }
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
  } catch { return send(res, 404, "Not found", "text/plain; charset=utf-8"); }
}

async function main() {
  if (githubBackup.configured()) {
    try {
      await ensureGithubReady();
      console.log(`Loaded active ${activeYear} season from GitHub (${seasonPath(activeYear)}).`);
    } catch (error) {
      console.error("Could not load GitHub season data. Shared saving is unavailable until GitHub is reachable:", error.message);
    }
  } else {
    console.warn("GITHUB_TOKEN is not configured. Shared data requires GitHub; local JSON download remains available in the browser.");
  }
  const server = http.createServer((req, res) => { serve(req, res); });
  server.on("error", error => {
    if (error.code === "EADDRINUSE") console.error(`Port ${PORT} is already in use. Stop the other server, then run npm start again.`);
    else console.error(error);
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`Kaiser Family Fantasy SMX is listening on ${HOST}:${PORT}/\nLeague-data persistence: GitHub only (${githubBackup.configured() ? "configured" : "not configured"})\nSeason files: ${SEASON_DIRECTORY}/YYYY.json\nNo Render persistent disk is used for league data.\nPress Ctrl+C to stop the server.`);
  });
}

main().catch(error => { console.error("Server startup failed:", error); process.exit(1); });
