"use strict";

const path = require("path");
const crypto = require("crypto");

const API_ROOT = "https://api.github.com";

function loadDotEnv(root) {
  const file = path.join(root, ".env");
  try {
    const fs = require("fs");
    const contents = fs.readFileSync(file, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      else value = value.replace(/\s+#.*$/, "");
      process.env[match[1]] = value.replace(/\\n/g, "\n");
    }
  } catch (err) {
    if (err.code !== "ENOENT") console.warn("Could not read .env file:", err.message);
  }
}

function createGithubBackup(root) {
  loadDotEnv(root);

  const safeRelativePath = value => {
    const clean = String(value || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!clean || clean.includes("\0") || clean.split("/").some(part => !part || part === "." || part === "..")) return null;
    return clean;
  };
  const config = () => {
    const dataPath = safeRelativePath(process.env.GITHUB_DATA_PATH || "league-data/league-data.json");
    if (!dataPath) throw new Error("GITHUB_DATA_PATH must be a safe relative file path, such as league-data/league-data.json.");
    return {
      token: process.env.GITHUB_TOKEN || "",
      repository: (process.env.GITHUB_REPOSITORY || "").trim(),
      branch: (process.env.GITHUB_BRANCH || "main").trim() || "main",
      dataPath,
      backupPassword: process.env.GITHUB_BACKUP_PASSWORD || "",
      autoEnabled: String(process.env.GITHUB_AUTO_BACKUP || "true").toLowerCase() !== "false"
    };
  };
  const repositoryParts = () => {
    const { repository } = config();
    const parts = repository.split("/");
    if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) {
      throw new Error("Set GITHUB_REPOSITORY to the GitHub owner/repository name, for example owner/kaiser-family-fantasy-smx.");
    }
    return parts;
  };
  const configured = () => !!(config().token && config().repository);
  const writeConfigured = () => !!(configured() && config().backupPassword);
  const repoApi = suffix => {
    const [owner, repo] = repositoryParts();
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
  };
  const encodedDataPath = () => config().dataPath.split("/").map(encodeURIComponent).join("/");

  async function api(endpoint, options = {}) {
    const cfg = config();
    if (!cfg.token) throw new Error("GitHub token is not configured. Set GITHUB_TOKEN on the server.");
    const response = await fetch(`${API_ROOT}${endpoint}`, {
      ...options,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${cfg.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Kaiser-Family-Fantasy-SMX-League-Backup",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 500) }; }
    if (!response.ok) {
      const err = new Error(data.message || `GitHub returned HTTP ${response.status}.`);
      err.status = response.status;
      if (response.status === 401 || response.status === 403) err.message = `GitHub authorization failed (${response.status}). Check the token and repository Contents permissions: ${err.message}`;
      if (response.status === 404) err.message = `GitHub repository, branch, or save file was not found: ${err.message}`;
      throw err;
    }
    return data;
  }

  function savedAtMs(data) {
    const direct = typeof data?.savedAt === "string" ? Date.parse(data.savedAt) : Number(data?.savedAt || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const values = Object.values(data?.keyUpdatedAt || {}).map(Number).filter(n => Number.isFinite(n) && n > 0);
    return values.length ? Math.max(...values) : 0;
  }

  async function getLatestLeagueData() {
    if (!configured()) return { configured: false, found: false, data: null, savedAt: 0, sha: null, commit: null };
    const cfg = config();
    // Confirm the branch exists so a missing data file is not confused with a missing branch.
    const branchPath = encodeURIComponent(cfg.branch).replace(/%2F/gi, "/");
    await api(repoApi(`/git/ref/heads/${branchPath}`));
    let file;
    try {
      file = await api(repoApi(`/contents/${encodedDataPath()}?ref=${encodeURIComponent(cfg.branch)}`));
    } catch (err) {
      if (err.status === 404) return { configured: true, found: false, data: null, savedAt: 0, sha: null, commit: null };
      throw err;
    }
    if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
      throw new Error(`GitHub returned an unsupported format for ${cfg.dataPath}. The saved league file must be a base64 JSON file.`);
    }
    let data;
    try { data = JSON.parse(Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8")); }
    catch { throw new Error(`The GitHub league save at ${cfg.dataPath} is not valid JSON.`); }
    if (!data || typeof data !== "object" || !data.state || typeof data.state !== "object" || Array.isArray(data.state)) {
      throw new Error(`The GitHub league save at ${cfg.dataPath} does not contain a valid state object.`);
    }
    return {
      configured: true,
      found: true,
      data,
      savedAt: savedAtMs(data),
      sha: file.sha || null,
      commit: file.commit ? {
        sha: file.commit.sha || "",
        url: file.commit.html_url || "",
        date: file.commit.committer?.date || file.commit.author?.date || ""
      } : null,
      path: cfg.dataPath
    };
  }

  async function saveLeagueData(database, message = "Kaiser Family Fantasy SMX: automatic league-data save") {
    if (!configured()) throw new Error("GitHub league-data backup is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY on the server.");
    if (!database || typeof database !== "object" || !database.state || typeof database.state !== "object" || Array.isArray(database.state)) {
      throw new Error("The current league database is not valid and cannot be saved to GitHub.");
    }
    const cfg = config();
    const current = await getLatestLeagueData();
    const content = JSON.stringify(database, null, 2);
    if (current.found && JSON.stringify(current.data, null, 2) === content) {
      return {
        ok: true, changed: false, savedAt: savedAtMs(database), path: cfg.dataPath,
        commit: current.commit || { sha: "", url: "", date: "" }
      };
    }
    const payload = {
      message: String(message || "Kaiser Family Fantasy SMX: league-data save").replace(/[\r\n]+/g, " ").trim().slice(0, 180),
      content: Buffer.from(content, "utf8").toString("base64"),
      branch: cfg.branch
    };
    if (current.sha) payload.sha = current.sha;
    const result = await api(repoApi(`/contents/${encodedDataPath()}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return {
      ok: true, changed: true, savedAt: savedAtMs(database), path: cfg.dataPath,
      commit: {
        sha: result.commit?.sha || "",
        shortSha: String(result.commit?.sha || "").slice(0, 7),
        url: result.commit?.html_url || "",
        date: result.commit?.committer?.date || result.commit?.author?.date || new Date().toISOString()
      }
    };
  }

  async function getStatus(localInfo = {}) {
    let cfg;
    try { cfg = config(); }
    catch (err) {
      return { configured: false, writeReady: false, automaticSave: false, repository: "", branch: "main", dataPath: "", tokenSet: !!process.env.GITHUB_TOKEN, backupPasswordSet: !!process.env.GITHUB_BACKUP_PASSWORD, latestGitHubSave: null, error: err.message, ...localInfo };
    }
    const result = {
      configured: configured(),
      writeReady: writeConfigured(),
      autoBackupEnabled: cfg.autoEnabled,
      automaticSave: !!(cfg.autoEnabled && configured()),
      repository: cfg.repository || "",
      branch: cfg.branch,
      dataPath: cfg.dataPath,
      tokenSet: !!cfg.token,
      backupPasswordSet: !!cfg.backupPassword,
      latestGitHubSave: null,
      error: "",
      ...localInfo
    };
    if (!result.configured) {
      result.error = "GitHub league-data backup is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY on the server.";
      return result;
    }
    try {
      await api(repoApi(""));
      const remote = await getLatestLeagueData();
      if (remote.found) {
        result.latestGitHubSave = {
          savedAt: remote.savedAt,
          commit: remote.commit,
          shortSha: remote.commit?.sha ? remote.commit.sha.slice(0, 7) : "",
          path: remote.path
        };
      }
    } catch (err) {
      result.error = err.message;
    }
    return result;
  }

  function authorize(password) {
    const expected = config().backupPassword;
    if (!expected || typeof password !== "string") return false;
    const left = Buffer.from(expected);
    const right = Buffer.from(password);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  return {
    configured,
    isAutoEnabled: () => { try { return config().autoEnabled && configured(); } catch { return false; } },
    authorize,
    getLatestLeagueData,
    saveLeagueData,
    getStatus,
    getConfigSummary: () => ({ repository: config().repository, branch: config().branch, dataPath: config().dataPath })
  };
}

module.exports = { createGithubBackup };
