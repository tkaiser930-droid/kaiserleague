"use strict";

// In-memory GitHub API used only by server-dual-save.test.js. No real GitHub
// requests or credentials are used by this integration test.
const realFetch = global.fetch.bind(global);
let branchExists = false;
let initialTreeContent = "";
let savedContentBase64 = "";
let blobSha = "blob-1";
let commitNumber = 0;
const repositoryPath = "/repos/tkaiser930-droid/LeagueSave";
const dataPath = `${repositoryPath}/contents/league-data/league-data.json`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function missing(message = "Not Found") { return json({ message }, 404); }

global.fetch = async (input, options = {}) => {
  const rawUrl = typeof input === "string" ? input : input.url;
  const url = new URL(rawUrl);
  if (url.hostname !== "api.github.com") return realFetch(input, options);
  const method = String(options.method || "GET").toUpperCase();
  const path = url.pathname;

  if (path === repositoryPath && method === "GET") return json({ default_branch: "main" });
  if (path === `${repositoryPath}/git/ref/heads/main` && method === "GET") {
    return branchExists ? json({ ref: "refs/heads/main", object: { sha: "commit-main" } }) : missing("Reference does not exist");
  }
  if (path === dataPath && method === "GET") {
    if (!branchExists || !savedContentBase64) return missing("File not found");
    return json({
      type: "file", encoding: "base64", content: savedContentBase64,
      sha: blobSha,
      commit: { sha: "commit-main", html_url: "https://github.test/commit-main", committer: { date: new Date().toISOString() } }
    });
  }
  if (path === `${repositoryPath}/git/trees` && method === "POST") {
    const body = JSON.parse(options.body || "{}");
    initialTreeContent = body.tree?.[0]?.content || "";
    return json({ sha: "tree-initial" });
  }
  if (path === `${repositoryPath}/git/commits` && method === "POST") {
    commitNumber++;
    return json({ sha: `commit-${commitNumber}`, html_url: `https://github.test/commit-${commitNumber}`, committer: { date: new Date().toISOString() } });
  }
  if (path === `${repositoryPath}/git/refs` && method === "POST") {
    branchExists = true;
    savedContentBase64 = Buffer.from(initialTreeContent, "utf8").toString("base64");
    blobSha = "blob-initial";
    return json({ ref: "refs/heads/main" });
  }
  if (path === dataPath && method === "PUT") {
    const body = JSON.parse(options.body || "{}");
    savedContentBase64 = body.content || "";
    blobSha = `blob-${++commitNumber}`;
    return json({ commit: { sha: `commit-${commitNumber}`, html_url: `https://github.test/commit-${commitNumber}`, committer: { date: new Date().toISOString() } } });
  }
  return json({ message: `Unexpected mocked GitHub request: ${method} ${path}` }, 500);
};
