"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createGithubBackup } = require("../github-backup");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function testConnectedStatusIsConcise() {
  const bootstrap = read("bootstrap.js");
  assert.match(bootstrap, /setStatus\("Connected", "good"(?:, statusTicket)?\)/, "successful GitHub initialization should display only Connected");
  assert.doesNotMatch(bootstrap, /Connected — all shared league changes save directly to GitHub:/, "the detailed repository path should not appear in the connection banner");
  assert.match(bootstrap, /await verifyGithubStatus\(\)/, "startup must verify GitHub itself before reporting Connected");
  assert.match(bootstrap, /await verifyGithubStatus\(target\)/, "season switching must verify the selected season file directly in GitHub");
  const server = read("server.js");
  assert.match(server, /status\.verified = !!status\.configured && !status\.error/, "the server status endpoint must expose the live GitHub verification result");
  assert.match(server, /status\.build = BUILD_ID/, "the status response must identify the deployed server build");
  assert.match(server, /githubAutoLastError = `GitHub save for season/, "server write failures must be retained for subsequent status checks");
  assert.match(server, /githubIndexSaveFailed/, "a failed season-index save must be retried instead of being forgotten by a later season write");
  const statusRoute = server.slice(server.indexOf('if (url.pathname === "/api/github/status"'), server.indexOf('if (url.pathname === "/api/github/save"'));
  assert.match(statusRoute, /await ensureIndexLoaded\(\)/, "status checks must resolve the active season index");
  assert.match(statusRoute, /githubBackup\.getStatus\(/, "status checks must query GitHub directly");
  assert.doesNotMatch(statusRoute, /await ensureGithubReady\(\)/, "status checks must not mistake the server's in-memory season cache for live GitHub availability");
  const app = read("app.js");
  assert.match(app, /github\/status\?year=/, "the Data & Backup status must check the currently selected season file");
  assert.match(app, /publishStatus\("Connected","good"\)/, "the successful status label should remain concise");
  assert.match(app, /const message=`Unavailable:/, "a failed live GitHub check must display Unavailable");
  assert.match(app, /beginStatusCheck\?\.\(\)/, "Data & Backup status checks must use the same sequenced status state as the header");
  assert.match(app, /reportStatus\(text,state,statusTicket\)/, "Data & Backup must publish through the shared status updater");
  assert.match(bootstrap, /dirtyKeys\.size > 0/, "the shared status updater must not report Connected while writes remain pending");
}

testConnectedStatusIsConcise();

async function testGithubBackupRoundTrip() {
  const originalFetch = global.fetch;
  const originalEnv = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_BRANCH: process.env.GITHUB_BRANCH,
    GITHUB_DATA_PATH: process.env.GITHUB_DATA_PATH,
    GITHUB_BACKUP_PASSWORD: process.env.GITHUB_BACKUP_PASSWORD,
    GITHUB_AUTO_BACKUP: process.env.GITHUB_AUTO_BACKUP,
    GITHUB_API_MAX_ATTEMPTS: process.env.GITHUB_API_MAX_ATTEMPTS,
    GITHUB_API_TIMEOUT_MS: process.env.GITHUB_API_TIMEOUT_MS
  };

  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPOSITORY = "test-owner/test-league";
  process.env.GITHUB_BRANCH = "";
  process.env.GITHUB_DATA_PATH = "league-data/league-data.json";
  process.env.GITHUB_BACKUP_PASSWORD = "test-manual-password";
  process.env.GITHUB_AUTO_BACKUP = "false"; // Must not disable GitHub-only persistence.
  process.env.GITHUB_API_MAX_ATTEMPTS = "4";

  let transientFailures = 1;
  let transientRetryObserved = false;
  let branchExists = false;
  let pendingTreeContent = "";
  let storedContent = "";
  let storedSha = "";
  let commitNumber = 0;

  const response = (status, value) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => value === null ? "" : JSON.stringify(value)
  });

  global.fetch = async (input, options = {}) => {
    if (transientFailures > 0) {
      transientFailures--;
      transientRetryObserved = true;
      const cause = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
      throw new TypeError("fetch failed", { cause });
    }
    const url = new URL(String(input));
    const method = String(options.method || "GET").toUpperCase();
    const body = options.body ? JSON.parse(options.body) : {};

    if (url.pathname === "/repos/test-owner/test-league" && method === "GET") {
      return response(200, { default_branch: "main" });
    }
    if (url.pathname === "/repos/test-owner/test-league/git/ref/heads/main" && method === "GET") {
      return branchExists ? response(200, { ref: "refs/heads/main", object: { sha: "branch-sha" } }) : response(404, { message: "Not Found" });
    }
    if (url.pathname === "/repos/test-owner/test-league/contents/league-data/league-data.json" && method === "GET") {
      if (!storedContent) return response(404, { message: "Not Found" });
      return response(200, {
        type: "file",
        encoding: "base64",
        content: Buffer.from(storedContent, "utf8").toString("base64"),
        sha: storedSha,
        commit: { sha: `commit-${commitNumber}`, html_url: "https://github.com/test-owner/test-league/commit/test", committer: { date: new Date(1_800_000_000_000).toISOString() } }
      });
    }
    if (url.pathname === "/repos/test-owner/test-league/git/trees" && method === "POST") {
      pendingTreeContent = body.tree?.[0]?.content || "";
      return response(201, { sha: "tree-sha" });
    }
    if (url.pathname === "/repos/test-owner/test-league/git/commits" && method === "POST") {
      storedContent = pendingTreeContent;
      storedSha = `file-sha-${++commitNumber}`;
      return response(201, { sha: `commit-sha-${commitNumber}`, html_url: "https://github.com/test-owner/test-league/commit/first", committer: { date: new Date(1_800_000_000_000).toISOString() } });
    }
    if (url.pathname === "/repos/test-owner/test-league/git/refs" && method === "POST") {
      branchExists = true;
      return response(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (url.pathname === "/repos/test-owner/test-league/contents/league-data/league-data.json" && method === "PUT") {
      storedContent = Buffer.from(body.content, "base64").toString("utf8");
      storedSha = `file-sha-${++commitNumber}`;
      return response(200, { content: { sha: storedSha }, commit: { sha: `commit-sha-${commitNumber}`, html_url: "https://github.com/test-owner/test-league/commit/update", committer: { date: new Date(1_800_000_000_000).toISOString() } } });
    }
    throw new Error(`Unexpected fake GitHub request: ${method} ${url.pathname}`);
  };

  try {
    const github = createGithubBackup(root);
    const initial = {
      version: 1,
      state: { kaiserFantasyAthletes: [{ id: "rider-1", name: "Test Rider" }] },
      keyUpdatedAt: { kaiserFantasyAthletes: 1_800_000_000_000 },
      savedAt: 1_800_000_000_000
    };

    const firstSave = await github.saveLeagueData(initial, "test initial GitHub save");
    assert.equal(firstSave.changed, true);
    assert.equal(firstSave.initialCommit, true);
    assert.equal(transientRetryObserved, true, "a temporary GitHub network failure should be retried automatically");

    const loaded = await github.getLatestLeagueData();
    assert.equal(loaded.found, true);
    assert.deepEqual(loaded.data, initial);

    const changed = {
      ...initial,
      savedAt: 1_800_000_000_001,
      state: { kaiserFantasyAthletes: [{ id: "rider-1", name: "Updated Rider" }] },
      keyUpdatedAt: { kaiserFantasyAthletes: 1_800_000_000_001 }
    };
    const updateSave = await github.saveLeagueData(changed, "test updated GitHub save");
    assert.equal(updateSave.changed, true);
    assert.equal(updateSave.initialCommit, undefined);
    assert.deepEqual((await github.getLatestLeagueData()).data, changed);

    const status = await github.getStatus();
    assert.equal(status.configured, true);
    assert.equal(status.automaticSave, true, "GITHUB_AUTO_BACKUP=false must not disable mandatory GitHub-only saves");
    assert.equal(status.dataPath, "league-data/league-data.json");
    assert.equal(github.authorize("test-manual-password"), true);
    assert.equal(github.authorize("wrong-password"), false);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}


async function testGithubIsCanonicalOverStaleBrowserCache() {
  const bootstrap = read("bootstrap.js");
  const values = new Map([
    ["kaiserFantasyScores", JSON.stringify([{ id: "stale-browser-score" }])],
    ["__kf_saved_at__kaiserFantasyScores", "9999999999999"],
    ["kaiserFantasyAthletes", JSON.stringify([{ id: "pending-unsynced-athlete" }])],
    ["__kf_saved_at__kaiserFantasyAthletes", "1000000000000"],
    ["__kf_unsynced__kaiserFantasyAthletes", "1"]
  ]);
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const putCalls = [];
  const remote = {
    state: {
      kaiserFantasyScores: [{ id: "github-canonical-score" }],
      kaiserFantasyAthletes: [{ id: "github-before-pending-edit" }]
    },
    keyUpdatedAt: {
      kaiserFantasyScores: 900000000000,
      kaiserFantasyAthletes: 900000000000
    },
    savedAt: 900000000000,
    storageLabel: "GitHub repository test-owner/test-league"
  };
  const fetch = async (url, options = {}) => {
    if (String(url).startsWith("/api/github/status") && !options.method) {
      return { ok: true, status: 200, json: async () => ({ configured: true, verified: true, build: "kf-series-season-transfer-20261125a", activeYear: 2027, statusYear: 2027 }) };
    }
    if (String(url).startsWith("/api/state") && !options.method) {
      return { ok: true, status: 200, json: async () => remote };
    }
    if (String(url).startsWith("/api/state/") && options.method === "PUT") {
      putCalls.push({ url: String(url), body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true, applied: true }) };
    }
    throw new Error(`Unexpected bootstrap request: ${options.method || "GET"} ${url}`);
  };
  const body = { prepend() {}, appendChild(node) { this.lastScript = node; } };
  const document = {
    readyState: "complete",
    body,
    createElement: () => ({}),
    querySelector: () => null,
    addEventListener() {}
  };
  const window = {};
  vm.runInNewContext(bootstrap, { window, document, localStorage, fetch, console, Date, Promise, Set, JSON, Object, Number, String, URL, location: { origin: "https://league.example" } });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(JSON.parse(values.get("kaiserFantasyScores")), [{ id: "github-canonical-score" }], "a stale browser cache with a newer local clock must not overwrite GitHub");
  assert.equal(values.get("__kf_saved_at__kaiserFantasyScores"), "900000000000");
  assert.equal(putCalls.length, 1, "only the explicitly marked unsynced local edit should be uploaded");
  assert.equal(putCalls[0].url, "/api/state/kaiserFantasyAthletes?year=2027");
  assert.deepEqual(putCalls[0].body.value, [{ id: "pending-unsynced-athlete" }]);
  assert.equal(values.has("__kf_unsynced__kaiserFantasyAthletes"), false, "successful GitHub sync clears the pending marker");
}


async function testSameYearRefreshAppliesRemoteCopy() {
  const bootstrap = read("bootstrap.js");
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  let remoteAthletes = [{ id: "before-copy", name: "Before Copy" }];
  const fetch = async (url, options = {}) => {
    const textUrl = String(url);
    if (textUrl.startsWith("/api/github/status")) {
      return { ok: true, status: 200, json: async () => ({ configured: true, verified: true, build: "kf-series-season-transfer-20261125a", activeYear: 2027, statusYear: 2027 }) };
    }
    if (textUrl === "/api/state" || textUrl.startsWith("/api/state?year=2027")) {
      return {
        ok: true, status: 200,
        json: async () => ({
          state: { kaiserFantasyAthletes: remoteAthletes },
          keyUpdatedAt: { kaiserFantasyAthletes: remoteAthletes[0]?.id === "after-copy" ? 200 : 100 },
          savedAt: 200, activeYear: 2027, seasonYear: 2027, storageLabel: "GitHub season files"
        })
      };
    }
    throw new Error(`Unexpected same-year refresh request: ${options.method || "GET"} ${textUrl}`);
  };
  const body = { prepend() {}, appendChild(node) { this.lastScript = node; } };
  const document = {
    readyState: "complete", body,
    createElement: () => ({}),
    querySelector: () => null,
    addEventListener() {}
  };
  const window = {};
  vm.runInNewContext(bootstrap, {
    window, document, localStorage, fetch, console, Date, Promise, Set, JSON,
    Object, Number, String, URL, location: { origin: "https://league.example" }
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(window.KFStorage.mode, "server");
  assert.deepEqual(JSON.parse(values.get("kaiserFantasyAthletes")), [{ id: "before-copy", name: "Before Copy" }]);

  // Simulate a server-side copy that has updated the selected year's GitHub file.
  remoteAthletes = [{ id: "after-copy", name: "Copied Rider" }];
  await window.KFStorage.setSeasonYear(2027);
  assert.deepEqual(JSON.parse(values.get("kaiserFantasyAthletes")), [{ id: "after-copy", name: "Copied Rider" }],
    "refreshing the already-selected year must apply the updated GitHub file to the browser copy");
}

async function testPermanentGithubNetworkFailureIsActionable() {
  const originalFetch = global.fetch;
  const originalEnv = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_API_MAX_ATTEMPTS: process.env.GITHUB_API_MAX_ATTEMPTS,
    GITHUB_API_TIMEOUT_MS: process.env.GITHUB_API_TIMEOUT_MS
  };
  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPOSITORY = "test-owner/test-league";
  process.env.GITHUB_API_MAX_ATTEMPTS = "2";
  let calls = 0;
  global.fetch = async () => {
    calls++;
    const cause = Object.assign(new Error("getaddrinfo EAI_AGAIN api.github.com"), { code: "EAI_AGAIN" });
    throw new TypeError("fetch failed", { cause });
  };
  try {
    const github = createGithubBackup(root);
    await assert.rejects(
      github.getJsonFile("league-data/seasons/2027.json"),
      /Could not reach the GitHub API at api\.github\.com after 2 attempts.*EAI_AGAIN.*outbound HTTPS\/DNS access/
    );
    assert.equal(calls, 2, "the GitHub client should stop after the configured retry count");
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function testBootstrapRetriesTemporaryServerFailure() {
  const bootstrap = read("bootstrap.js");
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  let requests = 0;
  const remote = {
    state: { kaiserFantasyAthletes: [{ id: "github-rider", name: "GitHub Rider" }] },
    keyUpdatedAt: { kaiserFantasyAthletes: 100 },
    savedAt: 100, activeYear: 2027, seasonYear: 2027, storageLabel: "GitHub season files"
  };
  const fetch = async (url) => {
    requests++;
    if (requests === 1) return { ok: false, status: 503, json: async () => ({ error: "GitHub temporarily unavailable" }) };
    if (String(url).startsWith("/api/github/status")) return { ok: true, status: 200, json: async () => ({ configured: true, verified: true, build: "kf-series-season-transfer-20261125a", activeYear: 2027, statusYear: 2027 }) };
    return { ok: true, status: 200, json: async () => remote };
  };
  const body = { prepend() {}, appendChild(node) { this.lastScript = node; } };
  const document = {
    readyState: "complete", body,
    createElement: () => ({}), querySelector: () => null,
    getElementById: () => null, addEventListener() {}
  };
  const window = { addEventListener() {} };
  vm.runInNewContext(bootstrap, {
    window, document, localStorage, fetch, console, Date, Promise, Set, JSON,
    Object, Number, String, URL, location: { origin: "https://league.example" },
    setTimeout, setInterval: () => 1, clearInterval: () => {}
  });
  await new Promise(resolve => setTimeout(resolve, 450));
  assert.equal(window.KFStorage.mode, "server", "a temporary 503 must not leave the site stuck in browser-only mode");
  assert.ok(requests >= 2, "the browser should retry the API request");
  assert.deepEqual(JSON.parse(values.get("kaiserFantasyAthletes")), remote.state.kaiserFantasyAthletes);
  assert.equal(body.lastScript.src, "app.js?v=kf-series-season-transfer-20261125a");
}

function testNoServerSideDiskPersistence() {
  const server = read("server.js");
  const render = read("render.yaml");
  const docker = read("Dockerfile");
  const bootstrap = read("bootstrap.js");
  const commissioner = read("commissioner.html");
  const app = read("app.js");

  assert.doesNotMatch(server, /\bDATA_DIR\b|\bDB_FILE\b|fs\.watchFile|fs\.promises\.writeFile|\/var\/data/);
  assert.match(server, /githubBackup\.saveLeagueData/);
  assert.match(server, /storage: "github-only-season-files"/);
  assert.match(server, /function seasonPath\(year\).*SEASON_DIRECTORY/);
  assert.match(server, /GITHUB_SEASON_INDEX_PATH|SEASON_INDEX_PATH/);
  assert.doesNotMatch(render, /^\s*disk:/m);
  assert.doesNotMatch(render, /DATA_DIR/);
  assert.doesNotMatch(docker, /DATA_DIR|\/var\/data/);

  // Keep the local browser JSON export and the Restore-a-backup flow intact.
  assert.match(bootstrap, /async function exportState\(\)/);
  assert.match(bootstrap, /UNSYNCED_PREFIX/);
  assert.match(bootstrap, /async function reconnect\(\)/, "the browser copy must be able to reconnect without a page reload");
  assert.match(bootstrap, /if \(mode === "server"\) verifyLiveConnection\(\);\s*else reconnect\(\);/, "the heartbeat must verify GitHub while online and reconnect while offline");
  assert.match(app, /window\.KFStorage\.reconnect\(\)/, "Data & Backup refresh should offer a manual reconnect");
  assert.doesNotMatch(bootstrap, /localTs > remoteTs/, "local wall-clock timestamps must not override the GitHub canonical copy");
  assert.match(commissioner, /id="exportData"/);
  assert.match(commissioner, /id="importData"/);
  assert.match(app, /a\.download=`kaiser-fantasy-backup-/);
  assert.match(app, /window\.KFStorage\.replaceState\(state\)/);
}

(async () => {
  testNoServerSideDiskPersistence();
  await testGithubBackupRoundTrip();
  await testGithubIsCanonicalOverStaleBrowserCache();
  await testSameYearRefreshAppliesRemoteCopy();
  await testPermanentGithubNetworkFailureIsActionable();
  await testBootstrapRetriesTemporaryServerFailure();
  console.log("GitHub-only storage tests passed: no Render/local server database writes, automatic GitHub commits, transient GitHub API retry, actionable permanent network errors, browser retry after temporary server failure, initial repository setup, update/load round trip, stale browser-cache protection, pending offline edit recovery, same-year post-copy refresh, token/password checks, and local JSON download/restore retention.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
