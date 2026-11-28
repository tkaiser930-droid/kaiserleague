"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { createGithubBackup } = require("./github-backup");
const { fetchOfficialResults } = require("./race-results-import");
const { researchRaceTeam } = require("./race-team-research");
const { researchHometown } = require("./hometown-research");

const ROOT = __dirname;
const githubBackup = createGithubBackup(ROOT);
const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || "0.0.0.0";
const MIN_SEASON_YEAR = 2010;
const MAX_SEASON_YEAR = 2099;
const DEFAULT_ACTIVE_YEAR = Number(process.env.KF_ACTIVE_SEASON || 2027);
const BUILD_ID = "kf-batch-hometown-city-suffix-20261127a";
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
let githubIndexSaveFailed = false;
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
  const target = Number(year);
  // Every non-current year is an archived season. There is no separate
  // historical-workspace lifecycle: a past year is the same editable archive
  // that the active season becomes when it is archived.
  return { version: 1, seasonYear: target, archived: target < activeYear, state: emptyState(), keyUpdatedAt: {}, savedAt: 0 };
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
    archived: Number(year) < Number(activeYear) || !!input?.archived,
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
  try {
    await queueGithubOperation(() => githubBackup.saveJsonFile(seasonIndex, message, SEASON_INDEX_PATH));
    githubIndexSaveFailed = false;
    githubAutoLastError = "";
  } catch (error) {
    githubIndexSaveFailed = true;
    githubAutoLastError = `GitHub season-index save failed: ${error.message || "Unknown GitHub error"}`;
    throw error;
  }
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
      seasonIndex.seasons[String(target)] = { year: target, status: target < activeYear || database.archived ? "archived" : target === activeYear ? "current" : "workspace", archived: target < activeYear || !!database.archived, createdAt: new Date().toISOString() };
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
  let result;
  try {
    result = await queueGithubOperation(() => githubBackup.saveLeagueData(normalized, message, seasonPath(target)));
  } catch (error) {
    githubAutoLastError = `GitHub save for season ${target} failed: ${error.message || "Unknown GitHub error"}`;
    throw error;
  }
  seasonCache.set(target, normalized);
  const entry = seasonIndex.seasons[String(target)] || { year: target, createdAt: new Date().toISOString() };
  const historical = target < activeYear || normalized.archived;
  seasonIndex.seasons[String(target)] = {
    ...entry,
    year: target,
    status: historical ? "archived" : target === activeYear ? "current" : (entry.status || "workspace"),
    archived: historical,
    archivedAt: normalized.archivedAt || entry.archivedAt || "",
    savedAt: normalized.savedAt,
    updatedAt: new Date().toISOString()
  };
  if (target === activeYear) seasonIndex.activeYear = activeYear;
  // Register a newly-created year file as soon as its first successful save commits.
  // Existing index entries are not rewritten for every ordinary score edit.
  if (!wasIndexed || githubIndexSaveFailed) await persistSeasonIndex(`Kaiser Family Fantasy SMX: register ${target} season file`);
  else githubAutoLastError = "";
  githubAutoLastAt = new Date().toISOString();
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
const COPY_SERIES = new Set(["all", "SMX", "Triple Crown Series", "MXGP", "MXON", "MotoGP", "F1"]);
const COPY_RIDER_CLASS_GROUPS = {
  SMX: ["250", "450"],
  "Triple Crown Series": ["CAN", "CAN 250", "CAN 450"],
  MXGP: ["MXGP", "MX2"],
  MXON: ["MXON", "MXON MXGP", "MXON MX2", "MXON Open"],
  MotoGP: ["MotoGP"],
  F1: ["F1"]
};
function athleteMatchesCopySeries(athlete, selectedSeries) {
  if (!selectedSeries || selectedSeries === "all") return true;
  const allowed = new Set((COPY_RIDER_CLASS_GROUPS[selectedSeries] || []).map(normalizedName));
  const affiliations = [
    athlete?.primarySeries, athlete?.class, athlete?.riderClass, athlete?.category,
    ...(Array.isArray(athlete?.secondarySeries) ? athlete.secondarySeries : []),
    ...(Array.isArray(athlete?.additionalSeries) ? athlete.additionalSeries : [])
  ].map(normalizedName).filter(Boolean);
  return affiliations.some(value => allowed.has(value));
}
function canonicalCopyScheduleSeries(value) {
  const series = String(value || "").trim();
  if (["CAN", "CAN 250", "CAN 450", "CAN WMX"].includes(series)) return "Triple Crown Series";
  if (["250", "450"].includes(series)) return "SMX";
  if (["MXGP", "MX2"].includes(series)) return "MXGP";
  return series;
}
function eventMatchesCopySeries(event, selectedSeries) {
  return !selectedSeries || selectedSeries === "all" || canonicalCopyScheduleSeries(event?.series) === selectedSeries;
}
function sameRiderIdentity(left, right) {
  const leftId = String(left?.id || left?.riderId || "");
  const rightId = String(right?.id || right?.riderId || "");
  if (leftId && rightId && leftId === rightId) return true;
  const leftName = normalizedName(left?.name || left?.riderName);
  const rightName = normalizedName(right?.name || right?.riderName);
  const leftClass = normalizedName(left?.primarySeries || left?.class || left?.riderClass);
  const rightClass = normalizedName(right?.primarySeries || right?.class || right?.riderClass);
  return !!leftName && leftName === rightName && leftClass === rightClass;
}
function scoreMatchesRider(record, riderId, riderName, riderClass) {
  if (riderId && String(record.riderId || "") === String(riderId)) return true;
  // Rider IDs normally survive season copies. The name fallback also includes
  // older season records where IDs were regenerated or the rider changed class.
  // Current class is intentionally not a hard filter: career results follow the
  // athlete across series/class changes while each result keeps its scored class.
  return normalizedName(record.riderName || record.athleteName) === normalizedName(riderName);
}
function scoreRoundKey(record) {
  const series = normalizedName(record.series || record.riderClass || record.division || "unknown");
  const year = Number(record.seasonYear || (record.recordedAt ? new Date(record.recordedAt).getUTCFullYear() : activeYear));
  if (record.scheduledEventId) return `${year}|${series}|event:${record.scheduledEventId}`;
  return `${year}|${series}|event:${normalizedName(record.event || "")}|round:${record.round ?? ""}`;
}
const DRAFT_PROJECTION_ROOMS = {
  SMX: ["250", "450"],
  "Triple Crown Series": ["CAN 250", "CAN 450"],
  MXGP: ["MXGP", "MX2"],
  MotoGP: ["MotoGP"],
  F1: ["F1"]
};
function draftProjectionRoomForSeries(value) {
  const key = normalizedName(value);
  if (["smx", "supercross", "motocross", "250", "450", "smxnext", "usawmx"].includes(key)) return "SMX";
  if (["triplecrownseries", "tcs", "can", "can250", "can450"].includes(key)) return "Triple Crown Series";
  if (["mxgp", "mx2", "wmx"].includes(key)) return "MXGP";
  if (["motogp", "moto2", "moto3"].includes(key)) return "MotoGP";
  if (["f1", "f2", "f3", "f1academy"].includes(key)) return "F1";
  return "";
}
function summarizeHistoricalRider(database, riderId, riderName, riderClass, year) {
  const state = database.state || {};
  const athletes = Array.isArray(state.kaiserFantasyAthletes) ? state.kaiserFantasyAthletes : [];
  const athlete = athletes.find(item => (riderId && String(item.id || item.riderId) === String(riderId))
    || (normalizedName(item.name || item.riderName) === normalizedName(riderName) && (!riderClass || normalizedName(item.primarySeries || item.class || item.riderClass) === normalizedName(riderClass)))) || null;
  const scores = Array.isArray(state.kaiserFantasyScores) ? state.kaiserFantasyScores : [];
  const scheduledEvents = Array.isArray(state.kaiserFantasySchedule) ? state.kaiserFantasySchedule : [];
  const eventById = new Map(scheduledEvents.map(event => [String(event.id || ""), event]));
  const records = scores.filter(record => scoreMatchesRider(record, riderId, riderName, riderClass)).map(record => {
    const scheduled = eventById.get(String(record.scheduledEventId || ""));
    return {
      id: record.id || "", riderId: record.riderId || riderId || "", riderName: record.riderName || record.athleteName || athlete?.name || riderName || "",
      riderClass: record.riderClass || record.athleteClass || athlete?.primarySeries || athlete?.class || riderClass || "",
      riderNumber: record.riderNumber || athlete?.number || "", riderRaceTeam: record.riderRaceTeam || record.raceTeam || athlete?.raceTeam || "",
      manufacturer: record.manufacturer || athlete?.manufacturer || "", series: record.series || "", division: record.division || record.riderClass || "",
      event: record.event || scheduled?.name || "", eventDate: record.eventDate || scheduled?.date || "", round: record.round ?? scheduled?.round ?? "", eventType: record.eventType || scheduled?.type || "", scoringPhase: record.scoringPhase || "",
      place: record.place || 0, points: Number(record.points || 0), bonuses: Array.isArray(record.bonuses) ? record.bonuses : [],
      teamName: record.teamName || "Unrostered / Free Agent", recordedAt: record.recordedAt || "", seasonYear: Number(year)
    };
  });
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
    let indexNeedsNormalization = false;
    for (const [yearText, metadata] of Object.entries(seasonIndex.seasons || {})) {
      if (!validYear(yearText)) continue;
      const year = Number(yearText);
      const historical = year < activeYear;
      const status = historical ? "archived" : year === activeYear ? "current" : (metadata.status || "workspace");
      const archived = historical;
      years[yearText] = { status, archived, archivedAt: metadata.archivedAt || "" };
      // Normalize older entries written by versions that called these years
      // "workspaces". Persist the same archive status used by the API/UI.
      if (metadata.status !== status || !!metadata.archived !== archived) {
        seasonIndex.seasons[yearText] = { ...metadata, year, status, archived };
        indexNeedsNormalization = true;
      }
    }
    // Every prior year is selectable and behaves as an archived season even
    // before its first save file is created.
    for (let year = MIN_SEASON_YEAR; year <= activeYear; year++) {
      if (!years[String(year)]) years[String(year)] = { status: year === activeYear ? "current" : "archived", archived: year < activeYear, archivedAt: "" };
    }
    years[String(activeYear)] = { ...(years[String(activeYear)] || {}), status: "current", archived: false, archivedAt: "" };
    if (indexNeedsNormalization) await persistSeasonIndex("Kaiser Family Fantasy SMX: normalize historical seasons as archived");
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
    const parts = Array.isArray(body.parts) ? [...new Set(body.parts.filter(part => ["riders", "schedule"].includes(part)))] : [];
    const riderSeries = String(body.riderSeries || "all");
    const scheduleSeries = String(body.scheduleSeries || "all");
    if (!validYear(sourceYear) || !validYear(destinationYear) || sourceYear === destinationYear || !parts.length) throw new Error("Choose two different valid seasons and at least one copy type.");
    if (parts.includes("riders") && !COPY_SERIES.has(riderSeries)) throw new Error("Choose a valid athlete series to copy.");
    if (parts.includes("schedule") && !COPY_SERIES.has(scheduleSeries)) throw new Error("Choose a valid schedule series to copy.");
    const source = await loadSeasonDatabase(sourceYear);
    const destination = await loadSeasonDatabase(destinationYear);
    let copiedRiderCount = 0, copiedScheduleCount = 0;
    if (parts.includes("riders")) {
      const sourceRiders = Array.isArray(source.state.kaiserFantasyAthletes) ? cloneJson(source.state.kaiserFantasyAthletes) : [];
      const riders = sourceRiders.filter(rider => athleteMatchesCopySeries(rider, riderSeries));
      copiedRiderCount = riders.length;
      if (riderSeries === "all") {
        // Preserve the original all-series operation: replace the full directory.
        destination.state.kaiserFantasyAthletes = riders;
      } else {
        // A series-scoped operation upserts only that series' athletes. Other
        // destination series remain untouched, and multi-series athletes remain
        // one record because the model stores a single shared athlete profile.
        const merged = Array.isArray(destination.state.kaiserFantasyAthletes) ? cloneJson(destination.state.kaiserFantasyAthletes) : [];
        for (const rider of riders) {
          const existingIndex = merged.findIndex(existing => sameRiderIdentity(existing, rider));
          if (existingIndex >= 0) merged[existingIndex] = cloneJson(rider);
          else merged.push(cloneJson(rider));
        }
        destination.state.kaiserFantasyAthletes = merged;
      }
      const byId = new Map(riders.map(rider => [String(rider.id || rider.riderId || ""), rider]).filter(([key]) => key));
      const byNameClass = new Map(riders.map(rider => [`${normalizedName(rider.name || rider.riderName)}|${normalizedName(rider.primarySeries || rider.class || rider.riderClass)}`, rider]));
      destination.state.kaiserFantasyTeams = (Array.isArray(destination.state.kaiserFantasyTeams) ? destination.state.kaiserFantasyTeams : []).map(team => ({
        ...team,
        roster: (Array.isArray(team.roster) ? team.roster : []).map(rosterRider => {
          const replacement = byId.get(String(rosterRider.id || rosterRider.riderId || "")) || byNameClass.get(`${normalizedName(rosterRider.name || rosterRider.riderName)}|${normalizedName(rosterRider.primarySeries || rosterRider.class || rosterRider.riderClass)}`);
          return replacement ? cloneJson(replacement) : rosterRider;
        })
      }));
    }
    if (parts.includes("schedule")) {
      const sourceEvents = Array.isArray(source.state.kaiserFantasySchedule) ? source.state.kaiserFantasySchedule : [];
      const events = sourceEvents.filter(event => eventMatchesCopySeries(event, scheduleSeries));
      copiedScheduleCount = events.length;
      const copiedEvents = events.map(event => ({
        ...cloneJson(event), id: crypto.randomUUID(), date: cleanSeasonDate(event.date, destinationYear), endDate: cleanSeasonDate(event.endDate, destinationYear)
      }));
      if (scheduleSeries === "all") {
        // Preserve the original all-series operation: replace the full calendar.
        destination.state.kaiserFantasySchedule = copiedEvents;
      } else {
        // Replace only the selected destination series, retaining every other
        // series' events and giving copied events fresh IDs in the new season.
        const existingEvents = Array.isArray(destination.state.kaiserFantasySchedule) ? destination.state.kaiserFantasySchedule : [];
        destination.state.kaiserFantasySchedule = existingEvents.filter(event => !eventMatchesCopySeries(event, scheduleSeries)).concat(copiedEvents);
      }
    }
    const copyDescription = [
      parts.includes("riders") ? `athletes (${riderSeries})` : "",
      parts.includes("schedule") ? `schedule (${scheduleSeries})` : ""
    ].filter(Boolean).join(" and ");
    const saved = await saveSeasonDatabase(destinationYear, destination, `Kaiser Family Fantasy SMX: copy ${copyDescription} from ${sourceYear} to ${destinationYear}`);
    publicHistoryCache.delete(sourceYear);
    publicHistoryCache.delete(destinationYear);
    return send(res, 200, {
      ok: true, sourceYear, destinationYear, copied: parts,
      riderSeries: parts.includes("riders") ? riderSeries : null,
      scheduleSeries: parts.includes("schedule") ? scheduleSeries : null,
      copiedRiderCount, copiedScheduleCount,
      riderCount: destination.state.kaiserFantasyAthletes.length,
      scheduleCount: destination.state.kaiserFantasySchedule.length,
      path: saved.path
    });
  }

  if (url.pathname === "/api/public/draft-projections" && req.method === "GET") {
    await ensureGithubReady();
    const room = url.searchParams.get("room") || "SMX";
    const roomClasses = DRAFT_PROJECTION_ROOMS[room];
    if (!roomClasses) return send(res, 400, { error: "Choose a valid draft room." });

    const activeDatabase = await loadSeasonDatabase(activeYear);
    const currentAthletes = Array.isArray(activeDatabase.state.kaiserFantasyAthletes)
      ? activeDatabase.state.kaiserFantasyAthletes : [];
    const years = [...new Set([
      activeYear,
      ...Object.keys(seasonIndex.seasons || {}).map(Number).filter(year => validYear(year) && year < activeYear)
    ])].sort((a, b) => b - a);
    const databases = [];
    for (const year of years) {
      try { databases.push({ year, database: year === activeYear ? activeDatabase : await loadSeasonDatabase(year) }); }
      catch (error) { console.warn(`Could not read ${year} for public draft projections: ${error.message}`); }
    }

    const projections = [];
    for (const athlete of currentAthletes) {
      if (!athlete || athlete.seriesArchived) continue;
      const primaryClass = String(athlete.primarySeries || athlete.class || athlete.riderClass || athlete.category || "").trim();
      const secondaryClasses = Array.isArray(athlete.secondarySeries) ? athlete.secondarySeries.map(value => String(value || "").trim()) : [];
      const athleteClasses = [primaryClass, ...secondaryClasses].filter(Boolean);
      if (!athleteClasses.some(value => roomClasses.includes(value))) continue;
      // Use the primary class whenever it belongs to this room. If the rider is
      // draft-eligible only through a secondary class, use that class for the
      // room-specific historical average. This matches roster scoring rules.
      const projectionClass = roomClasses.includes(primaryClass) ? primaryClass : roomClasses.find(value => athleteClasses.includes(value));
      const riderId = athlete.id || athlete.riderId || "";
      const riderName = athlete.name || athlete.riderName || "Unnamed athlete";
      const rounds = new Set();
      let totalPoints = 0;

      for (const { year, database } of databases) {
        const summary = summarizeHistoricalRider(database, riderId, riderName, projectionClass, year);
        for (const record of summary.records) {
          const division = String(record.division || record.riderClass || "").trim();
          const recordRoom = draftProjectionRoomForSeries(record.series || record.riderClass || division);
          if (normalizedName(division) !== normalizedName(projectionClass) || recordRoom !== room) continue;
          totalPoints += Number(record.points || 0);
          rounds.add(scoreRoundKey({ ...record, seasonYear: year }));
        }
      }

      projections.push({
        id: String(riderId || normalizedName(riderName) + "-" + normalizedName(primaryClass)),
        name: riderName,
        number: String(athlete.number || ""),
        primarySeries: primaryClass,
        class: primaryClass,
        secondarySeries: secondaryClasses,
        secondaryNumbers: athlete.secondaryNumbers && typeof athlete.secondaryNumbers === "object" && !Array.isArray(athlete.secondaryNumbers)
          ? Object.fromEntries(Object.entries(athlete.secondaryNumbers).filter(([series]) => secondaryClasses.includes(String(series)) && roomClasses.includes(String(series))))
          : {},
        nationality: String(athlete.nationality || ""),
        nationalityRegion: String(athlete.nationalityRegion || ""),
        manufacturer: String(athlete.manufacturer || ""),
        raceTeam: String(athlete.raceTeam || athlete.riderRaceTeam || ""),
        average: rounds.size ? totalPoints / rounds.size : 0,
        rounds: rounds.size,
        totalPoints,
        averageClass: projectionClass
      });
    }

    projections.sort((a, b) => Number(b.average) - Number(a.average)
      || Number(b.rounds) - Number(a.rounds)
      || Number(b.totalPoints) - Number(a.totalPoints)
      || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return send(res, 200, { ok: true, room, activeYear, athletes: projections });
  }

  if (url.pathname === "/api/public/athlete-history" && req.method === "GET") {
    await ensureGithubReady();
    const riderId = url.searchParams.get("riderId") || "";
    const riderName = url.searchParams.get("name") || "";
    const riderClass = url.searchParams.get("class") || "";
    if (!riderId && !riderName) return send(res, 400, { error: "A rider ID or name is required." });

    // Every non-current season is an archive, including years that older
    // versions called historical workspaces. Public profiles receive only the
    // sanitized scored-rider history, never the archived season workspace.
    const historicalYears = Object.keys(seasonIndex.seasons || {})
      .map(Number).filter(year => validYear(year) && year < activeYear);
    const years = [...new Set([activeYear, ...historicalYears])].sort((a, b) => b - a);
    const seasons = [];
    for (const year of years) {
      try {
        const database = await loadSeasonDatabase(year);
        const result = summarizeHistoricalRider(database, riderId, riderName, riderClass, year);
        if (result.records.length) seasons.push(result);
      } catch (error) {
        console.warn(`Could not read public athlete history for ${year}: ${error.message}`);
      }
    }

    const records = seasons.flatMap(season => season.records || []).sort((a, b) => {
      const dateValue = record => Date.parse(record.eventDate || "") || Date.parse(record.recordedAt || "") || 0;
      return dateValue(b) - dateValue(a) || Number(b.seasonYear || 0) - Number(a.seasonYear || 0)
        || Number(a.place || 999) - Number(b.place || 999);
    });
    const groups = new Map(), allRounds = new Set();
    for (const record of records) {
      const series = String(record.series || record.riderClass || "Unknown");
      const division = String(record.division || record.riderClass || "Unknown");
      const key = `${normalizedName(series)}|${normalizedName(division)}`;
      if (!groups.has(key)) groups.set(key, { series, division, total: 0, rounds: new Set() });
      const group = groups.get(key);
      group.total += Number(record.points || 0);
      const roundKey = scoreRoundKey(record);
      group.rounds.add(roundKey);
      allRounds.add(roundKey);
    }
    const averages = [...groups.values()].map(group => ({
      series: group.series, division: group.division, total: group.total, rounds: group.rounds.size,
      average: group.rounds.size ? group.total / group.rounds.size : 0
    })).sort((a, b) => a.series.localeCompare(b.series) || a.division.localeCompare(b.division));
    const totalPoints = records.reduce((sum, record) => sum + Number(record.points || 0), 0);
    const currentSeasonPoints = records.filter(record => Number(record.seasonYear) === activeYear)
      .reduce((sum, record) => sum + Number(record.points || 0), 0);
    const rounds = allRounds.size;
    return send(res, 200, {
      activeYear, seasons, records,
      career: { totalPoints, rounds, average: rounds ? totalPoints / rounds : 0, segmentCount: records.length, currentSeasonPoints, averages }
    });
  }

  if (url.pathname === "/api/commissioner/team-research" && req.method === "POST") {
    requireCommissioner(req);
    const body = await readBody(req);
    const year = Number(body.year || activeYear);
    if (!validYear(year)) throw new Error("Choose a valid season year for team research.");
    requireYearAccess(req, year);
    const series = String(body.series || "").trim();
    const allowedSeries = new Set(["SMX", "Triple Crown Series", "MXGP", "MXON", "F1", "MotoGP"]);
    if (!allowedSeries.has(series)) throw new Error("Choose a valid series before researching race teams.");
    const riders = Array.isArray(body.riders) ? body.riders.slice(0, 40) : [];
    if (!riders.length) throw new Error("No riders were supplied for team research.");
    const results = new Array(riders.length);
    const knownTeams = Array.isArray(body.knownTeams) ? body.knownTeams.map(value => String(value || "").trim()).filter(Boolean).slice(0, 120) : [];
    // Keep public search traffic modest while avoiding a slow sequential
    // request chain for a full 250/450 entry list.
    let nextIndex = 0;
    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= riders.length) return;
        const rider = riders[index] || {};
        const name = String(rider.name || "").trim().slice(0, 100);
        const number = String(rider.number || "").trim().slice(0, 12);
        const division = String(rider.division || body.division || "").trim().slice(0, 40);
        if (!name && !number) { results[index] = { index, error: "A rider name or number is required." }; continue; }
        try {
          const found = await researchRaceTeam({ name, number, series, division, year, knownTeams });
          results[index] = { index, name, number, ...found };
        } catch (error) {
          results[index] = { index, name, number, error: error.message || "Team research failed." };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, riders.length) }, () => worker()));
    return send(res, 200, { ok: true, year, series, results });
  }

  if (url.pathname === "/api/commissioner/hometown-research" && req.method === "POST") {
    requireCommissioner(req);
    const body = await readBody(req);
    const year = Number(body.year || activeYear);
    if (!validYear(year)) throw new Error("Choose a valid season year for hometown research.");
    requireYearAccess(req, year);
    const hometowns = Array.isArray(body.hometowns)
      ? [...new Set(body.hometowns.map(value => String(value || "").trim()).filter(Boolean))].slice(0, 40)
      : [];
    if (!hometowns.length) throw new Error("No rider hometowns were supplied for lookup.");
    const results = [];
    // OpenStreetMap's public Nominatim service asks clients to keep requests
    // at or below one request per second; researchHometown enforces that limit.
    for (let index = 0; index < hometowns.length; index++) {
      const hometown = hometowns[index];
      try {
        results.push({ index, ...await researchHometown(hometown) });
      } catch (error) {
        results.push({ index, hometown, found: false, provider: "OpenStreetMap Nominatim", error: error.message || "Hometown lookup failed." });
      }
    }
    return send(res, 200, { ok: true, year, results });
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
    // This endpoint is a live GitHub API probe, not a report of the server's
    // in-memory season cache. Resolve the active year, then read the selected
    // season file from GitHub before allowing the UI to display Connected.
    await ensureIndexLoaded();
    const statusYear = url.searchParams.has("year") ? selectedYear(url) : activeYear;
    requireYearAccess(req, statusYear);
    const status = await githubBackup.getStatus({
      dataPath: seasonPath(statusYear),
      storageMode: "github-only", storageLabel: `GitHub season files in ${githubBackup.getConfigSummary().repository}`,
      activeSavedAt: seasonCache.get(statusYear)?.savedAt || 0,
      activeYear,
      statusYear,
      autoSaveLastAt: githubAutoLastAt,
      autoSaveLastError: githubAutoLastError,
      lastSync: githubLastSync
    });
    status.verified = !!status.configured && !status.error;
    status.verifiedAt = status.verified ? new Date().toISOString() : "";
    status.build = BUILD_ID;
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
    return send(res, 200, {
      version: database.version, state: database.state, keyUpdatedAt: database.keyUpdatedAt, savedAt: database.savedAt,
      storageMode: "github", storageLabel: `GitHub season file ${seasonPath(year)}`,
      seasonYear: year, activeYear, archived: year < activeYear, status: year < activeYear ? "archived" : "current"
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
    return send(res, 200, { ok: true, service: "kaiser-family-fantasy-smx-node-api", build: BUILD_ID, storage: "github-only-season-files", activeYear, timestamp: new Date().toISOString() });
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
