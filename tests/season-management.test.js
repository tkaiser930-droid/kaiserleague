"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const APP_SOURCE = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
const SERVER_SOURCE = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const BOOTSTRAP_SOURCE = fs.readFileSync(path.join(ROOT, "bootstrap.js"), "utf8");
const COMMISSIONER_HTML = fs.readFileSync(path.join(ROOT, "commissioner.html"), "utf8");
const DRAFT_HTML = fs.readFileSync(path.join(ROOT, "draft.html"), "utf8");
const REPO_PREFIX = "/repos/test-owner/test-league";
assert.match(APP_SOURCE, /Most Recent Scored Results/, "athlete profiles show recent results across published seasons");
assert.match(APP_SOURCE, /Career average \/ round/, "athlete profiles display a career average per round");
assert.match(APP_SOURCE, /Career rounds scored/, "athlete profiles display rounds accumulated across seasons");
assert.doesNotMatch(APP_SOURCE, /Previously Scored Results|Archived Season Results|No archived results have been published/, "old split result placeholders are removed from athlete profiles");
assert.doesNotMatch(APP_SOURCE, /Historical Workspace|Historical workspace/, "commissioner season selector and summary do not present a separate workspace lifecycle");
assert.match(APP_SOURCE, /· Archived/, "every non-current year is labeled as an archived season in the commissioner selector");
assert.match(COMMISSIONER_HTML, /Every year before the current season is an archived season/, "commissioner page explains that every prior year is an archived season");
assert.doesNotMatch(COMMISSIONER_HTML, /previous-year workspaces|full previous-season workspaces/i, "commissioner page does not describe a separate historical workspace state");
assert.match(DRAFT_HTML, />Draft<\/button>/, "the existing draft interface is available under the Draft tab");
assert.match(DRAFT_HTML, /Projected Draft Pick/, "draft page includes a separate Projected Draft Pick tab");
assert.match(DRAFT_HTML, /id="draftProjectionTable"/, "projected picks have a dedicated table container");
assert.match(APP_SOURCE, /api\/public\/draft-projections\?room=/, "the projection table loads room-specific career averages from the public API");
assert.match(APP_SOURCE, /Number\(b\.average\|\|0\)-Number\(a\.average\|\|0\)/, "projected pick ranks athletes by descending average points per round");
assert.match(APP_SOURCE, /\["Projected Pick Number","Athlete","Average Points \/ Round"\]/, "projected pick table shows the requested three columns");
assert.match(COMMISSIONER_HTML, /id="copyRiderSeries"/, "commissioner can select the athlete series to transfer");
assert.match(COMMISSIONER_HTML, /id="copyScheduleSeries"/, "commissioner can select the schedule series to transfer independently");
assert.match(BOOTSTRAP_SOURCE, /riderSeries: filters\.riderSeries \|\| "all", scheduleSeries: filters\.scheduleSeries \|\| "all"/, "season copy sends independent athlete and schedule series filters");
assert.match(SERVER_SOURCE, /function athleteMatchesCopySeries/, "server filters athlete transfers using primary and secondary series affiliations");
assert.match(SERVER_SOURCE, /function eventMatchesCopySeries/, "server filters schedule transfers by event series");


function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}
function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}
async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}
function jsonResponse(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

async function createFakeGithub(initialFiles) {
  const files = new Map(Object.entries(initialFiles).map(([file, value]) => [file, JSON.stringify(value, null, 2)]));
  let commitNumber = 0;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const method = req.method.toUpperCase();
      if (url.pathname === REPO_PREFIX && method === "GET") return jsonResponse(res, 200, { default_branch: "main", private: true });
      if (url.pathname === `${REPO_PREFIX}/git/ref/heads/main` && method === "GET") return jsonResponse(res, 200, { ref: "refs/heads/main", object: { sha: "main-sha" } });
      if (url.pathname.startsWith(`${REPO_PREFIX}/contents/`)) {
        const filePath = decodeURIComponent(url.pathname.slice(`${REPO_PREFIX}/contents/`.length));
        if (method === "GET") {
          if (!files.has(filePath)) return jsonResponse(res, 404, { message: "Not Found" });
          const body = JSON.parse(files.get(filePath));
          return jsonResponse(res, 200, {
            type: "file", encoding: "base64", content: Buffer.from(files.get(filePath), "utf8").toString("base64"),
            sha: `file-sha-${filePath}`, commit: { sha: `commit-${commitNumber}`, html_url: `https://github.com/test-owner/test-league/commit/${commitNumber}`, committer: { date: new Date(body.savedAt || Date.now()).toISOString() } }
          });
        }
        if (method === "PUT") {
          const payload = await readRequestBody(req);
          const content = Buffer.from(payload.content || "", "base64").toString("utf8");
          JSON.parse(content); // Reject anything that isn't valid JSON.
          files.set(filePath, content);
          commitNumber += 1;
          return jsonResponse(res, 200, {
            content: { sha: `file-sha-${commitNumber}` },
            commit: { sha: `commit-sha-${commitNumber}`, html_url: `https://github.com/test-owner/test-league/commit/${commitNumber}`, committer: { date: new Date().toISOString() } }
          });
        }
      }
      return jsonResponse(res, 404, { message: `Unexpected fake GitHub request ${method} ${url.pathname}` });
    } catch (error) {
      return jsonResponse(res, 500, { message: error.message });
    }
  });
  const port = await listen(server);
  return { server, files, url: `http://127.0.0.1:${port}` };
}

async function waitForHealth(baseUrl, child) {
  const deadline = Date.now() + 12000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited before health check (code ${child.exitCode}).`);
    try {
      const response = await fetch(`${baseUrl}/healthz`, { cache: "no-store" });
      if (response.ok) return;
      lastError = new Error(`Health check returned HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error("Timed out waiting for the season server.");
}
async function api(baseUrl, route, options = {}, cookie = "") {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${route}`, { ...options, headers, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

(async () => {
  const initialLegacy = {
    version: 1,
    state: {
      kaiserFantasyAthletes: [{ id: "rider-1", name: "Historic Racer", number: "21", class: "450", primarySeries: "450", secondarySeries: ["250"], secondaryNumbers: { "250": "109", "MotoGP": "12" }, raceTeam: "2027 Factory Team", manufacturer: "KTM" }],
      kaiserFantasyTeams: [{ key: "team-1", name: "Team One", owner: "League Owner", passwordHash: "team-password-hash", roster: [{ id: "rider-1", name: "Historic Racer", number: "21", class: "450", primarySeries: "450", raceTeam: "2027 Factory Team" }] }],
      kaiserFantasyScores: [
        { id: "score-1", riderId: "rider-1", riderName: "Historic Racer", riderClass: "450", series: "SMX", division: "450", event: "Anaheim 1", round: 1, scheduledEventId: "event-2027-1", seasonYear: 2027, place: 1, points: 20, teamName: "Team One", teamKey: "team-1", riderNumber: "21", riderRaceTeam: "2027 Factory Team", recordedAt: "2027-01-08T20:00:00.000Z" },
        { id: "score-2", riderId: "rider-1", riderName: "Historic Racer", riderClass: "450", series: "SMX", division: "450", event: "Anaheim 1", round: 1, scheduledEventId: "event-2027-1", seasonYear: 2027, place: 2, points: 15, teamName: "Team One", teamKey: "team-1", riderNumber: "21", riderRaceTeam: "2027 Factory Team", recordedAt: "2027-01-08T21:00:00.000Z" }
      ],
      kaiserFantasyTrades: [{ id: "trade-1", status: "pending" }],
      kaiserFantasyDraftState: { picks: [{ id: "pick-1" }] },
      kaiserFantasyDraftSettings: { SMX: { status: "Complete" } },
      kaiserFantasySchedule: [{ id: "event-2027-1", name: "Anaheim 1", date: "2027-01-08", endDate: "2027-01-08", series: "SMX", round: 1 }]
    },
    keyUpdatedAt: {}, savedAt: 1_800_000_000_000
  };
  const historical2025 = {
    version: 1, seasonYear: 2025, archived: true, archivedAt: "2025-12-01T00:00:00.000Z", savedAt: 1_765_000_000_000,
    state: {
      kaiserFantasyAthletes: [{ id: "rider-1", name: "Historic Racer", number: "12", class: "250", primarySeries: "250", raceTeam: "2025 Factory Team", manufacturer: "KTM" }],
      kaiserFantasyTeams: [],
      kaiserFantasyScores: [
        { id: "score-2025-1", riderId: "rider-1", riderName: "Historic Racer", riderClass: "250", series: "SMX", division: "250", event: "Anaheim 1", round: 1, scheduledEventId: "event-2025-1", seasonYear: 2025, scoringPhase: "Moto 1", place: 1, points: 12, teamName: "Team One", riderNumber: "12", riderRaceTeam: "2025 Factory Team", recordedAt: "2025-01-11T20:00:00.000Z" },
        { id: "score-2025-2", riderId: "rider-1", riderName: "Historic Racer", riderClass: "250", series: "SMX", division: "250", event: "Anaheim 1", round: 1, scheduledEventId: "event-2025-1", seasonYear: 2025, scoringPhase: "Moto 2", place: 2, points: 13, teamName: "Team One", riderNumber: "12", riderRaceTeam: "2025 Factory Team", recordedAt: "2025-01-11T21:00:00.000Z" }
      ],
      kaiserFantasyTrades: [], kaiserFantasyDraftState: { picks: [] }, kaiserFantasyDraftSettings: {},
      kaiserFantasySchedule: [{ id: "event-2025-1", name: "Anaheim 1", date: "2025-01-11", series: "SMX", round: 1 }]
    },
    keyUpdatedAt: {}
  };
  const initialSeasonIndex = { version: 1, activeYear: 2027, seasons: {
    "2025": { year: 2025, status: "archived", archived: true, archivedAt: "2025-12-01T00:00:00.000Z" },
    // Simulate a pre-existing historical workspace from the older application.
    // The new app must normalize it into the same archived-season state.
    "2026": { year: 2026, status: "workspace", archived: false },
    "2027": { year: 2027, status: "current", archived: false }
  } };
  const fakeGithub = await createFakeGithub({
    "league-data/league-data.json": initialLegacy,
    "league-data/season-index.json": initialSeasonIndex,
    "league-data/seasons/2025.json": historical2025
  });
  const appPort = await freePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(appPort), HOST: "127.0.0.1", NODE_ENV: "test",
      GITHUB_API_BASE_URL: fakeGithub.url,
      GITHUB_TOKEN: "test-github-token", GITHUB_REPOSITORY: "test-owner/test-league", GITHUB_BRANCH: "main",
      GITHUB_DATA_PATH: "league-data/league-data.json", GITHUB_SEASON_DIRECTORY: "league-data/seasons",
      GITHUB_SEASON_INDEX_PATH: "league-data/season-index.json", GITHUB_BACKUP_PASSWORD: "manual-backup-password",
      COMMISSIONER_PASSWORD: "commissioner-test-password", COMMISSIONER_SESSION_SECRET: "integration-test-session-secret",
      KF_ACTIVE_SEASON: "2027"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let childOutput = "";
  child.stdout.on("data", chunk => { childOutput += chunk.toString(); });
  child.stderr.on("data", chunk => { childOutput += chunk.toString(); });

  try {
    await waitForHealth(baseUrl, child);
    let result = await api(baseUrl, "/api/seasons/meta");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.minYear, 2010, "the commissioner season range begins at 2010");
    assert.equal(result.body.activeYear, 2027);
    assert.equal(result.body.seasons["2026"].status, "archived", "legacy historical workspaces are normalized to archived seasons in the season selector");
    assert.equal(result.body.seasons["2026"].archived, true);
    const normalizedIndex = JSON.parse(fakeGithub.files.get("league-data/season-index.json"));
    assert.equal(normalizedIndex.seasons["2026"].status, "archived", "legacy workspace metadata is normalized in GitHub");
    assert.equal(normalizedIndex.seasons["2026"].archived, true);

    result = await api(baseUrl, "/api/state");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.activeYear, 2027);
    assert.equal(result.body.state.kaiserFantasyAthletes[0].number, "21");
    assert.ok(fakeGithub.files.has("league-data/seasons/2027.json"), "legacy single-file data is migrated to the active year's dedicated file");
    assert.ok(fakeGithub.files.has("league-data/season-index.json"), "the season index is persisted separately");

    result = await api(baseUrl, "/api/state?year=2026");
    assert.equal(result.response.status, 401, "public users cannot read a previous season workspace");

    result = await api(baseUrl, "/api/commissioner/login", { method: "POST", body: JSON.stringify({ password: "commissioner-test-password" }) });
    assert.equal(result.response.status, 200, result.body.error || "commissioner login should succeed");
    const cookie = String(result.response.headers.get("set-cookie") || "").split(";")[0];
    assert.match(cookie, /^kf_commissioner_session=/);

    result = await api(baseUrl, "/api/state?year=2026", {}, cookie);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.archived, true, "a previously-created workspace behaves exactly like an archived season");
    assert.equal(result.body.status, "archived");
    assert.deepEqual(result.body.state.kaiserFantasyScores, [], "a new historical season does not inherit current-year points");

    result = await api(baseUrl, "/api/seasons/copy", {
      method: "POST", body: JSON.stringify({ sourceYear: 2027, destinationYear: 2026, parts: ["riders", "schedule"] })
    }, cookie);
    assert.equal(result.response.status, 200, result.body.error || "copying riders and schedule should succeed");
    assert.equal(result.body.riderCount, 1);
    assert.equal(result.body.scheduleCount, 1);

    result = await api(baseUrl, "/api/state/kaiserFantasyAthletes?year=2026", {
      method: "PUT", body: JSON.stringify({ value: [{ ...initialLegacy.state.kaiserFantasyAthletes[0], number: "99", raceTeam: "2026 Independent Team" }], updatedAt: Date.now() })
    }, cookie);
    assert.equal(result.response.status, 200);
    const season2026 = JSON.parse(fakeGithub.files.get("league-data/seasons/2026.json"));
    assert.equal(season2026.state.kaiserFantasyAthletes[0].number, "99");
    assert.equal(season2026.archived, true, "a saved historical season file carries the archived flag");
    assert.equal(season2026.state.kaiserFantasySchedule[0].date, "2026-01-08", "schedule dates are shifted to the destination season");

    result = await api(baseUrl, "/api/state/kaiserFantasyScores?year=2026", {
      method: "PUT", body: JSON.stringify({ value: [{ id: "score-2026-1", riderId: "rider-1", riderName: "Historic Racer", riderClass: "450", series: "SMX", division: "450", event: "Anaheim 1", round: 1, eventDate: "2026-01-08", seasonYear: 2026, place: 1, points: 18, teamName: "Team One", riderNumber: "99", riderRaceTeam: "2026 Independent Team", recordedAt: "2026-01-08T20:00:00.000Z" }], updatedAt: Date.now() })
    }, cookie);
    assert.equal(result.response.status, 200, "commissioner can enter and save scoring in any archived season");

    result = await api(baseUrl, "/api/state?year=2026");
    assert.equal(result.response.status, 401, "previous-year workspace reads remain commissioner-only after a separate year is created");
    result = await api(baseUrl, "/api/state?year=2027", {}, cookie);
    assert.equal(result.response.status, 200);
    assert.equal(result.body.state.kaiserFantasyAthletes[0].number, "21", "editing a previous year does not change the current season rider number");
    assert.equal(result.body.state.kaiserFantasyAthletes[0].raceTeam, "2027 Factory Team");

    // Create a separate archived source year covering all series and a secondary-series athlete.
    const transferSourceState = {
      kaiserFantasyAthletes: [
        { id: "transfer-smx", name: "Transfer SMX Rider", number: "7", class: "250", primarySeries: "250", secondarySeries: [], raceTeam: "SMX Team", manufacturer: "KTM" },
        { id: "transfer-f1", name: "Transfer F1 Driver", number: "44", class: "F1", primarySeries: "F1", secondarySeries: [], raceTeam: "F1 Team", manufacturer: "Mercedes" },
        { id: "transfer-motogp", name: "Transfer MotoGP Rider", number: "93", class: "MotoGP", primarySeries: "MotoGP", secondarySeries: [], raceTeam: "MotoGP Team", manufacturer: "Ducati" },
        { id: "transfer-secondary-f1", name: "Multi Series Driver", number: "8", class: "450", primarySeries: "450", secondarySeries: ["F1"], raceTeam: "Dual Series Team", manufacturer: "Honda" },
        { id: "transfer-mxon", name: "MXON Entry", number: "9", class: "MX2", primarySeries: "MX2", secondarySeries: ["MXON MXGP"], raceTeam: "MXGP Team", manufacturer: "KTM" }
      ],
      kaiserFantasyTeams: [], kaiserFantasyScores: [], kaiserFantasyTrades: [],
      kaiserFantasyDraftState: { picks: [] }, kaiserFantasyDraftSettings: {},
      kaiserFantasySchedule: [
        { id: "transfer-event-smx", name: "Transfer Supercross", date: "2024-01-06", series: "SMX", round: 1 },
        { id: "transfer-event-f1", name: "Transfer Grand Prix", date: "2024-03-10", series: "F1", round: 1 },
        { id: "transfer-event-motogp", name: "Transfer MotoGP GP", date: "2024-04-14", series: "MotoGP", round: 1 },
        { id: "transfer-event-mxon", name: "Transfer MXON", date: "2024-09-29", series: "MXON", round: 1 }
      ]
    };
    result = await api(baseUrl, "/api/state?year=2024", { method: "PUT", body: JSON.stringify({ state: transferSourceState, updatedAt: Date.now() }) }, cookie);
    assert.equal(result.response.status, 200, result.body.error || "the source season for series-specific transfers should save");
    result = await api(baseUrl, "/api/state/kaiserFantasySchedule?year=2026", {
      method: "PUT", body: JSON.stringify({ value: [
        { id: "event-2026-1", name: "Anaheim 1", date: "2026-01-08", endDate: "2026-01-08", series: "SMX", round: 1 },
        { id: "old-destination-f1", name: "Old Destination GP", date: "2026-03-01", series: "F1", round: 1 }
      ], updatedAt: Date.now() })
    }, cookie);
    assert.equal(result.response.status, 200, result.body.error || "destination schedule setup for series transfer should save");

    result = await api(baseUrl, "/api/seasons/copy", {
      method: "POST", body: JSON.stringify({ sourceYear: 2024, destinationYear: 2026, parts: ["riders"], riderSeries: "F1" })
    }, cookie);
    assert.equal(result.response.status, 200, result.body.error || "F1-only athlete copy should succeed");
    assert.equal(result.body.copiedRiderCount, 2, "F1 copy includes primary F1 riders and riders with F1 as a secondary affiliation");
    result = await api(baseUrl, "/api/state?year=2026", {}, cookie);
    const afterF1Copy = result.body.state.kaiserFantasyAthletes;
    assert.ok(afterF1Copy.some(rider => rider.id === "transfer-f1"));
    assert.ok(afterF1Copy.some(rider => rider.id === "transfer-secondary-f1"));
    assert.ok(afterF1Copy.some(rider => rider.id === "rider-1"), "F1-only athlete copy preserves destination SMX athletes");
    assert.ok(!afterF1Copy.some(rider => rider.id === "transfer-motogp" || rider.id === "transfer-smx"), "F1-only athlete copy excludes unrelated series");

    result = await api(baseUrl, "/api/seasons/copy", {
      method: "POST", body: JSON.stringify({ sourceYear: 2024, destinationYear: 2026, parts: ["riders"], riderSeries: "MotoGP" })
    }, cookie);
    assert.equal(result.response.status, 200, result.body.error || "MotoGP-only athlete copy should succeed");
    assert.equal(result.body.copiedRiderCount, 1);
    result = await api(baseUrl, "/api/state?year=2026", {}, cookie);
    const afterMotoGPCopy = result.body.state.kaiserFantasyAthletes;
    assert.ok(afterMotoGPCopy.some(rider => rider.id === "transfer-f1"), "copying MotoGP after F1 does not remove F1 athletes");
    assert.ok(afterMotoGPCopy.some(rider => rider.id === "transfer-motogp"));
    assert.ok(afterMotoGPCopy.some(rider => rider.id === "rider-1"), "series-specific transfers preserve the pre-existing destination roster directory");
    assert.ok(!afterMotoGPCopy.some(rider => rider.id === "transfer-smx"));

    result = await api(baseUrl, "/api/seasons/copy", {
      method: "POST", body: JSON.stringify({ sourceYear: 2024, destinationYear: 2026, parts: ["schedule"], scheduleSeries: "F1" })
    }, cookie);
    assert.equal(result.response.status, 200, result.body.error || "F1-only schedule copy should succeed");
    assert.equal(result.body.copiedScheduleCount, 1);
    result = await api(baseUrl, "/api/state?year=2026", {}, cookie);
    const afterF1ScheduleCopy = result.body.state.kaiserFantasySchedule;
    assert.ok(afterF1ScheduleCopy.some(event => event.series === "SMX" && event.name === "Anaheim 1"), "F1 schedule copy preserves destination SMX events");
    assert.ok(afterF1ScheduleCopy.some(event => event.series === "F1" && event.name === "Transfer Grand Prix" && event.date === "2026-03-10"));
    assert.ok(!afterF1ScheduleCopy.some(event => event.id === "old-destination-f1"), "F1 schedule transfer replaces old destination F1 events");
    assert.ok(!afterF1ScheduleCopy.some(event => event.series === "MotoGP"));

    result = await api(baseUrl, "/api/seasons/copy", {
      method: "POST", body: JSON.stringify({ sourceYear: 2024, destinationYear: 2026, parts: ["schedule"], scheduleSeries: "MotoGP" })
    }, cookie);
    assert.equal(result.response.status, 200, result.body.error || "MotoGP-only schedule copy should succeed");
    assert.equal(result.body.copiedScheduleCount, 1);
    result = await api(baseUrl, "/api/state?year=2026", {}, cookie);
    const afterMotoGPScheduleCopy = result.body.state.kaiserFantasySchedule;
    assert.ok(afterMotoGPScheduleCopy.some(event => event.series === "F1" && event.name === "Transfer Grand Prix"), "copying MotoGP schedule preserves already-copied F1 events");
    assert.ok(afterMotoGPScheduleCopy.some(event => event.series === "MotoGP" && event.name === "Transfer MotoGP GP" && event.date === "2026-04-14"));
    assert.ok(afterMotoGPScheduleCopy.some(event => event.series === "SMX" && event.name === "Anaheim 1"));

    result = await api(baseUrl, "/api/public/athlete-history?riderId=rider-1&name=Historic%20Racer&class=450");
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.seasons.map(season => season.year), [2027, 2026, 2025], "public profile history includes active and all archived seasons, including years previously labeled historical workspaces");
    assert.equal(result.body.career.totalPoints, 78, "career history combines rider points across active and archived season files without changing team season totals");
    assert.equal(result.body.career.rounds, 3, "career rounds accumulate across every season while multiple motos within each event count once");
    assert.equal(result.body.career.average, 26, "career average is total points across active and archived seasons divided by unique event rounds across those seasons");
    assert.equal(result.body.career.currentSeasonPoints, 35, "current-season points remain separately identifiable and do not include archived points");
    assert.equal(result.body.career.averages.length, 2, "career averages retain separate series/class buckets when a rider changes class between seasons");
    const average250 = result.body.career.averages.find(item => item.division === "250");
    const average450 = result.body.career.averages.find(item => item.division === "450");
    assert.deepEqual([average250.total, average250.rounds, average250.average], [25, 1, 25]);
    assert.deepEqual([average450.total, average450.rounds, average450.average], [53, 2, 26.5]);
    assert.equal(result.body.records[0].seasonYear, 2027, "combined results are ordered newest event first");
    assert.equal(result.body.records[0].eventDate, "2027-01-08", "older scoring records can derive race dates from that season's schedule");
    assert.equal(result.body.records.find(record => record.seasonYear === 2025).eventDate, "2025-01-11");
    assert.equal(result.body.records.find(record => record.seasonYear === 2025).division, "250", "career history follows the same rider across a class change");
    assert.equal(result.body.records.find(record => record.seasonYear === 2025).riderNumber, "12", "historical number is retained on old score records");
    assert.equal(result.body.records.find(record => record.seasonYear === 2025).riderRaceTeam, "2025 Factory Team", "historical race team is retained on old score records");

    result = await api(baseUrl, "/api/state/kaiserFantasyAthletes?year=2027", {
      method: "PUT", body: JSON.stringify({ value: [...initialLegacy.state.kaiserFantasyAthletes, { id: "rider-2", name: "Projection Leader", number: "44", class: "450", primarySeries: "450", secondarySeries: [] }], updatedAt: Date.now() })
    }, cookie);
    assert.equal(result.response.status, 200);
    result = await api(baseUrl, "/api/state/kaiserFantasyScores?year=2027", {
      method: "PUT", body: JSON.stringify({ value: [...initialLegacy.state.kaiserFantasyScores, { id: "score-rider-2", riderId: "rider-2", riderName: "Projection Leader", riderClass: "450", series: "SMX", division: "450", event: "Anaheim 1", round: 1, scheduledEventId: "event-2027-1", seasonYear: 2027, place: 1, points: 50, teamName: "Unrostered / Free Agent", riderNumber: "44", recordedAt: "2027-01-08T22:00:00.000Z" }], updatedAt: Date.now() })
    }, cookie);
    assert.equal(result.response.status, 200);
    result = await api(baseUrl, "/api/public/draft-projections?room=SMX");
    assert.equal(result.response.status, 200, result.body.error || "public draft projections should load without exposing archived workspaces");
    assert.equal(result.body.room, "SMX");
    assert.equal(result.body.athletes[0].id, "rider-2", "projected pick numbers rank higher class-specific average points per round first");
    assert.equal(result.body.athletes[1].id, "rider-1", "lower average athletes follow higher average athletes");
    const projectedRider = result.body.athletes.find(athlete => athlete.id === "rider-1");
    assert.ok(projectedRider, "current SMX riders appear in the projection table");
    assert.equal(projectedRider.averageClass, "450", "draft projection uses the rider's primary class within the selected draft room");
    assert.deepEqual(projectedRider.secondaryNumbers, { "250": "109" }, "SMX draft projection exposes its secondary 250 number and excludes numbers for other series");
    assert.equal(projectedRider.totalPoints, 53, "projection points combine active and archived scores in the same series and class");
    assert.equal(projectedRider.rounds, 2, "projection counts one round per event across seasons, not one per moto");
    assert.equal(projectedRider.average, 26.5, "projected pick average uses the cross-season class-specific average");
    assert.equal(Object.prototype.hasOwnProperty.call(projectedRider, "passwordHash"), false, "public projections do not expose private authentication fields");
    assert.equal(Object.prototype.hasOwnProperty.call(projectedRider, "owner"), false, "public projections do not expose team ownership");
    result = await api(baseUrl, "/api/public/draft-projections?room=not-a-room");
    assert.equal(result.response.status, 400, "unknown draft rooms are rejected");

    result = await api(baseUrl, "/api/seasons/archive", { method: "POST", body: JSON.stringify({ year: 2027 }) }, cookie);
    assert.equal(result.response.status, 200, result.body.error || "archiving the current season should succeed");
    assert.equal(result.body.currentYear, 2028);
    const archived2027 = JSON.parse(fakeGithub.files.get("league-data/seasons/2027.json"));
    const new2028 = JSON.parse(fakeGithub.files.get("league-data/seasons/2028.json"));
    const index = JSON.parse(fakeGithub.files.get("league-data/season-index.json"));
    assert.equal(archived2027.archived, true);
    assert.equal(index.activeYear, 2028);
    assert.equal(new2028.state.kaiserFantasyScores.length, 0, "points never carry into a new season");
    assert.ok(new2028.savedAt > 0, "the initial next-season save has a real GitHub saved timestamp");
    assert.equal(new2028.state.kaiserFantasyTrades.length, 0);
    assert.deepEqual(new2028.state.kaiserFantasyDraftState, { picks: [] });
    assert.deepEqual(new2028.state.kaiserFantasyDraftSettings, {});
    assert.deepEqual(new2028.state.kaiserFantasySchedule, [], "schedule must be fresh after archive; copy is an explicit tool");
    assert.equal(new2028.state.kaiserFantasyAthletes[0].number, "21", "next season starts from the current year's rider details, not edits in other years");
    assert.equal(new2028.state.kaiserFantasyAthletes[0].raceTeam, "2027 Factory Team");
    assert.equal(new2028.state.kaiserFantasyTeams[0].owner, "League Owner", "team identity is carried forward");
    assert.equal(new2028.state.kaiserFantasyTeams[0].passwordHash, "team-password-hash");
    assert.deepEqual(new2028.state.kaiserFantasyTeams[0].roster, [], "team rosters reset for the new year");

    result = await api(baseUrl, "/api/public/athlete-history?riderId=rider-1&name=Historic%20Racer&class=450");
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.seasons.map(season => season.year), [2027, 2026, 2025], "all seasons remain in the same archived history lifecycle after the active season rolls forward");
    const historic = result.body.seasons[0];
    assert.equal(historic.year, 2027);
    assert.equal(historic.averages[0].total, 35);
    assert.equal(historic.averages[0].rounds, 1, "two moto/session results at one event count as one round");
    assert.equal(historic.averages[0].average, 35);
    assert.equal(historic.records[0].riderNumber, "21");
    assert.equal(historic.records[0].riderRaceTeam, "2027 Factory Team");
    assert.equal(result.body.career.totalPoints, 78, "career average and rounds persist across the season archive transition");
    assert.equal(result.body.career.rounds, 3);
    assert.equal(result.body.career.average, 26);
    assert.equal(result.body.career.currentSeasonPoints, 0, "archived points do not carry into the new active season total");
    result = await api(baseUrl, "/api/public/draft-projections?room=SMX");
    assert.equal(result.response.status, 200);
    const projectionAfterArchive = result.body.athletes.find(athlete => athlete.id === "rider-1");
    assert.equal(projectionAfterArchive.average, 26.5, "projected draft averages remain cumulative after the current season is archived");
    assert.equal(projectionAfterArchive.rounds, 2, "projected round counts persist after the season archive transition");
    assert.equal(result.body.athletes[0].id, "rider-2", "projection ranking remains sorted after the active season is archived");
    assert.equal(Object.prototype.hasOwnProperty.call(historic.records[0], "teamKey"), false, "public history omits internal team keys");
    assert.equal(Object.prototype.hasOwnProperty.call(historic.athlete, "passwordHash"), false);

    result = await api(baseUrl, "/api/state?year=2027");
    assert.equal(result.response.status, 401, "archived season full state remains private");
    result = await api(baseUrl, "/api/state");
    assert.equal(result.response.status, 200);
    assert.equal(result.body.activeYear, 2028);
    assert.deepEqual(result.body.state.kaiserFantasyScores, [], "public current state starts with no points carried from the archived year");

    // Separate save files are the only league-data JSON persistence destinations.
    const seasonFiles = [...fakeGithub.files.keys()].filter(file => /^league-data\/seasons\/\d{4}\.json$/.test(file)).sort();
    assert.deepEqual(seasonFiles, ["league-data/seasons/2024.json", "league-data/seasons/2025.json", "league-data/seasons/2026.json", "league-data/seasons/2027.json", "league-data/seasons/2028.json"]);
    console.log("Historical season integration tests passed: per-year GitHub files, workspace-to-archive normalization, commissioner-only archived season editing/scoring, isolated rider edits, all-series and series-scoped athlete/schedule transfers with preservation of other series, event-round averages, public history for every archived season, and archive/new-season reset behavior.");
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    await close(fakeGithub.server);
    if (childOutput && /Server startup failed|API error:/.test(childOutput)) {
      // Only surface errors that are not expected 401 access-control checks.
      const relevant = childOutput.split(/\r?\n/).filter(line => !/401|Commissioner sign-in/.test(line));
      if (relevant.length) process.stderr.write(relevant.join("\n") + "\n");
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
