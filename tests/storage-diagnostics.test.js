"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const bootstrap = fs.readFileSync(path.join(root, "bootstrap.js"), "utf8");

async function runBootstrap(fetchImpl) {
  const nodes = [];
  const body = {
    prepend(node) { nodes.push(node); },
    appendChild(node) { nodes.push(node); }
  };
  const document = {
    readyState: "complete",
    body,
    createElement(tagName) { return { tagName, textContent: "", className: "", setAttribute() {} }; },
    querySelector() { return null; },
    getElementById() { return null; },
    addEventListener() {}
  };
  const window = { addEventListener() {} };
  vm.runInNewContext(bootstrap, {
    window, document,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: fetchImpl,
    console: { warn() {}, error() {}, log() {} },
    Date, Promise, Set, JSON, Object, Number, String, URL,
    location: { origin: "https://league.example", protocol: "https:" },
    setTimeout(callback) { queueMicrotask(callback); return 1; },
    setInterval() { return 1; },
    clearInterval() {}
  }, { timeout: 2000 });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, window };
}

(async () => {
  let calls = 0;
  const browserFailure = await runBootstrap(async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  });
  const banner = browserFailure.nodes.find(node => node.tagName === "div");
  assert.ok(banner, "storage banner should be created");
  assert.match(banner.textContent, /Node\.js API at https:\/\/league\.example\/api\/github\/status/,
    "a browser-to-server failure must identify the live GitHub status endpoint");
  assert.match(banner.textContent, /fails before GitHub is contacted/,
    "a browser-to-server failure must not be mislabeled as a GitHub API failure");
  assert.equal(calls, 4, "temporary browser network failures should be retried four times");

  const htmlFiles = fs.readdirSync(root).filter(file => file.endsWith(".html"));
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    if (/bootstrap\.js/.test(html)) {
      assert.match(html, /bootstrap\.js\?v=kf-draft-projection-20261123a/,
        `${file} must request the cache-busted storage bootstrap`);
    }
  }
  assert.match(bootstrap, /app\.js\?v=kf-draft-projection-20261123a/,
    "the dynamically loaded app must also be cache-busted");
  assert.match(bootstrap, /One authoritative status is reflected everywhere/, "header and Data & Backup storage status should not contradict each other");
  assert.match(bootstrap, /statusRevision/, "newer status operations must prevent stale async probes from overwriting the latest result");
  assert.match(bootstrap, /fetchJson\(yearUrl\("\/api\/state\/"/, "GitHub writes should use the bounded retry wrapper");
  assert.match(bootstrap, /status.build !== "kf-draft-projection-20261123a"/, "an older cached server deployment must not be accepted as connected");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /reportStatus\(text,state,statusTicket\)/, "a failed live status probe must update the header through the authoritative status helper");
  assert.match(app, /!info\.writeReady\|\|!storageVerified/, "manual actions must be disabled when the active GitHub file cannot be verified");
  assert.match(app, /info\.autoSaveLastError/, "the status UI must surface a previous GitHub write failure instead of saying Connected");
  assert.match(app, /storageMode!=="server"/, "a direct GitHub probe must not display Connected if this browser is not connected to the season-state API");
  assert.match(app, /pendingWrites>0/, "the status UI must show saving rather than Connected while edits are pending");
  assert.match(bootstrap, /finalStatus\.autoSaveLastError/, "reconnect must preserve an outstanding server-side write failure");
  // A warm server cache must not make the browser report Connected when the
  // direct GitHub probe reports an outage.
  const unavailable = await runBootstrap(async url => {
    if (String(url).startsWith("/api/github/status")) {
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ configured: true, verified: false, build: "kf-draft-projection-20261123a", error: "Could not reach api.github.com" }) };
    }
    throw new Error(`Unexpected request after failed live GitHub probe: ${url}`);
  });
  const unavailableBanner = unavailable.nodes.find(node => node.tagName === "div");
  assert.match(unavailableBanner.textContent, /Unavailable: Could not reach api\.github\.com/,
    "the browser must not display Connected when GitHub itself cannot be verified");
  assert.equal(unavailable.window.KFStorage?.mode, "browser", "failed live GitHub verification must use the retained browser copy");

  // A successful GitHub status probe is not enough if the browser cannot load
  // the selected season state through the same Node service.
  const stateApiUnavailable = await runBootstrap(async url => {
    if (String(url).startsWith("/api/github/status")) {
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ configured: true, verified: true, build: "kf-draft-projection-20261123a", activeYear: 2027, statusYear: 2027 }) };
    }
    if (String(url).startsWith("/api/state")) throw new TypeError("Failed to fetch season state");
    throw new Error(`Unexpected request after state API failure: ${url}`);
  });
  const stateFailureBanner = stateApiUnavailable.nodes.find(node => node.tagName === "div");
  assert.match(stateFailureBanner.textContent, /Unavailable:/, "a GitHub status success must not hide a failed browser-to-season-state request");
  assert.notEqual(stateFailureBanner.textContent, "Connected", "the overall site must not show Connected until both GitHub verification and season state loading succeed");
  assert.equal(stateApiUnavailable.window.KFStorage?.mode, "browser", "failed season-state loading must retain the browser copy and disable shared mode");

  // Large scoring histories must not use fetch keepalive: browsers impose a
  // small aggregate body limit on keepalive requests (typically 64 KiB), which
  // makes larger score payloads fail in the browser before reaching Node.
  let capturedScoreSave = null;
  const largeSave = await runBootstrap(async (url, options = {}) => {
    const parsed = new URL(String(url), "https://league.example");
    const method = String(options.method || "GET").toUpperCase();
    const jsonResponse = value => ({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      json: async () => value
    });
    if (parsed.pathname === "/api/github/status" && method === "GET") {
      return jsonResponse({ configured: true, verified: true, build: "kf-draft-projection-20261123a", activeYear: 2027, statusYear: 2027 });
    }
    if (parsed.pathname === "/api/state" && method === "GET") {
      return jsonResponse({ state: {}, keyUpdatedAt: {}, savedAt: 0, activeYear: 2027, seasonYear: 2027 });
    }
    if (parsed.pathname === "/api/state/kaiserFantasyScores" && method === "PUT") {
      capturedScoreSave = options;
      return jsonResponse({ ok: true, applied: true, savedAt: Date.now(), storage: "GitHub", seasonYear: 2027 });
    }
    throw new Error(`Unexpected large-save test request: ${method} ${parsed.pathname}`);
  });
  assert.equal(largeSave.window.KFStorage?.mode, "server", "the large-save fixture should connect to the Node API first");
  const largeScores = Array.from({ length: 2500 }, (_, index) => ({
    id: `score-${index}`, athleteId: `athlete-${index % 80}`,
    event: `Grand Prix Round ${index % 24 + 1}`, details: "race-classification-and-scoring-record-".repeat(5)
  }));
  largeSave.window.KFStorage.write("kaiserFantasyScores", largeScores);
  await largeSave.window.KFStorage.flush();
  assert.ok(capturedScoreSave, "a large scoring array must be sent to the season-state PUT endpoint");
  assert.ok(Buffer.byteLength(capturedScoreSave.body, "utf8") > 64 * 1024, "the regression payload must exceed the browser keepalive body limit");
  assert.notEqual(capturedScoreSave.keepalive, true, "large league saves must not use fetch keepalive, which browsers reject above their small body quota");

  console.log("Storage diagnostics tests passed: live GitHub and season-state verification, cached-state false-positive prevention, retries, cache-busting, and large score-save payloads.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
