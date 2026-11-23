"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createGithubBackup } = require("../github-backup");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

async function testGithubBackupRoundTrip() {
  const originalFetch = global.fetch;
  const originalEnv = {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_BRANCH: process.env.GITHUB_BRANCH,
    GITHUB_DATA_PATH: process.env.GITHUB_DATA_PATH,
    GITHUB_BACKUP_PASSWORD: process.env.GITHUB_BACKUP_PASSWORD,
    GITHUB_AUTO_BACKUP: process.env.GITHUB_AUTO_BACKUP
  };

  process.env.GITHUB_TOKEN = "test-token";
  process.env.GITHUB_REPOSITORY = "test-owner/test-league";
  process.env.GITHUB_BRANCH = "";
  process.env.GITHUB_DATA_PATH = "league-data/league-data.json";
  process.env.GITHUB_BACKUP_PASSWORD = "test-manual-password";
  process.env.GITHUB_AUTO_BACKUP = "false"; // Must not disable GitHub-only persistence.

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
    if (url === "/api/state" && !options.method) {
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
  vm.runInNewContext(bootstrap, { window, document, localStorage, fetch, console, Date, Promise, Set, JSON, Object, Number, String });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(JSON.parse(values.get("kaiserFantasyScores")), [{ id: "github-canonical-score" }], "a stale browser cache with a newer local clock must not overwrite GitHub");
  assert.equal(values.get("__kf_saved_at__kaiserFantasyScores"), "900000000000");
  assert.equal(putCalls.length, 1, "only the explicitly marked unsynced local edit should be uploaded");
  assert.equal(putCalls[0].url, "/api/state/kaiserFantasyAthletes");
  assert.deepEqual(putCalls[0].body.value, [{ id: "pending-unsynced-athlete" }]);
  assert.equal(values.has("__kf_unsynced__kaiserFantasyAthletes"), false, "successful GitHub sync clears the pending marker");
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
  assert.match(server, /storage: "github-only"/);
  assert.doesNotMatch(render, /^\s*disk:/m);
  assert.doesNotMatch(render, /DATA_DIR/);
  assert.doesNotMatch(docker, /DATA_DIR|\/var\/data/);

  // Keep the local browser JSON export and the Restore-a-backup flow intact.
  assert.match(bootstrap, /async function exportState\(\)/);
  assert.match(bootstrap, /hasUnsyncedLocalEdit/);
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
  console.log("GitHub-only storage tests passed: no Render/local server database writes, automatic GitHub commits, initial repository setup, update/load round trip, stale browser-cache protection, pending offline edit recovery, token/password checks, and local JSON download/restore retention.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
