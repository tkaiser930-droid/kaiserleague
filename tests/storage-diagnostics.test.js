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
  assert.match(banner.textContent, /Node\.js API at https:\/\/league\.example\/api\/state/,
    "a browser-to-server failure must identify the Node.js API endpoint");
  assert.match(banner.textContent, /fails before GitHub is contacted/,
    "a browser-to-server failure must not be mislabeled as a GitHub API failure");
  assert.equal(calls, 4, "temporary browser network failures should be retried four times");

  const htmlFiles = fs.readdirSync(root).filter(file => file.endsWith(".html"));
  for (const file of htmlFiles) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    if (/bootstrap\.js/.test(html)) {
      assert.match(html, /bootstrap\.js\?v=kf-github-storage-diagnostics-20261123b/,
        `${file} must request the cache-busted storage bootstrap`);
    }
  }
  assert.match(bootstrap, /app\.js\?v=kf-github-storage-diagnostics-20261123b/,
    "the dynamically loaded app must also be cache-busted");
  console.log("Storage diagnostics tests passed: browser/API failure distinction, automatic retries, and cache-busting.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
