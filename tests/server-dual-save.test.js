"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const root = path.resolve(__dirname, "..");
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "kf-dual-save-"));
  const port = await freePort();
  const mockPath = path.join(__dirname, "mock-github-fetch.cjs");
  const child = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: temp,
      GITHUB_TOKEN: "test-token-not-a-real-secret",
      GITHUB_REPOSITORY: "tkaiser930-droid/LeagueSave",
      GITHUB_DATA_PATH: "league-data/league-data.json",
      GITHUB_AUTO_BACKUP: "true",
      GITHUB_BACKUP_PASSWORD: "test-backup-password",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${mockPath}`.trim()
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk.toString(); });
  child.stderr.on("data", chunk => { output += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  async function request(url, options) {
    const response = await fetch(base + url, options);
    const body = await response.json().catch(() => ({}));
    return { response, body };
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited early.\n${output}`);
      try {
        const result = await request("/api/state");
        if (result.response.ok) { ready = true; break; }
      } catch { /* wait for listen */ }
      await sleep(125);
    }
    assert.equal(ready, true, `Server did not start.\n${output}`);

    const initial = await request("/api/state");
    assert.equal(initial.body.storageMode, "local");
    assert.equal(initial.body.githubBackup.repository, "tkaiser930-droid/LeagueSave");
    assert.equal(initial.body.githubBackup.automaticSaveEnabled, true, "server reports the configured automatic GitHub mirror without exposing its token");

    const stamp = Date.now() + 10000;
    const update = await request("/api/state/kaiserFantasyScores", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: [{ id: "test-score", riderId: "rider-1", points: 25 }], updatedAt: stamp })
    });
    assert.equal(update.response.ok, true);

    // Normal edits should be mirrored automatically after the server debounce.
    await sleep(1750);
    const afterAutomaticMirror = await request("/api/github/status");
    assert.equal(afterAutomaticMirror.response.ok, true);
    assert.equal(afterAutomaticMirror.body.automaticSave, true);
    assert.ok(afterAutomaticMirror.body.latestGitHubSave?.savedAt, "ordinary database edits are automatically mirrored to the configured GitHub repository");
    assert.ok(afterAutomaticMirror.body.autoSaveLastAt, "the server records the automatic GitHub save attempt");

    const dual = await request("/api/storage/flush", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    assert.equal(dual.response.ok, true, dual.body.error || "dual-save endpoint should succeed");
    assert.equal(dual.body.primarySaved, true);
    assert.equal(dual.body.githubSaved, true);
    assert.equal(dual.body.primaryStorage, "local project database");
    assert.equal(dual.body.githubRepository, "tkaiser930-droid/LeagueSave");

    const savedFile = JSON.parse(await fs.promises.readFile(path.join(temp, "league-data.json"), "utf8"));
    assert.equal(savedFile.state.kaiserFantasyScores[0].id, "test-score", "the primary database contains the new save");
    assert.ok(dual.body.githubCommit, "the confirmed GitHub mirror reports its commit");
    console.log("Dual-save integration tests passed: server API storage, GitHub repository configuration, primary JSON persistence, and explicit GitHub mirror confirmation.");
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise(resolve => child.once("exit", resolve)), sleep(2000)]);
    await fs.promises.rm(temp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
