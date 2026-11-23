"use strict";

const path = require("path");
const crypto = require("crypto");

const API_ROOT = (process.env.GITHUB_API_BASE_URL || "https://api.github.com").replace(/\/$/, "");
const DEFAULT_REPOSITORY = "tkaiser930-droid/LeagueSave";

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
      repository: (process.env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY).trim(),
      // Empty means automatically use the repository's actual default branch.
      branchOverride: (process.env.GITHUB_BRANCH || "").trim(),
      dataPath,
      backupPassword: process.env.GITHUB_BACKUP_PASSWORD || ""
    };
  };
  const repositoryParts = () => {
    const { repository } = config();
    const parts = repository.split("/");
    if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1])) {
      throw new Error(`GITHUB_REPOSITORY must be owner/repository. The configured value is \"${repository}\"; expected \"${DEFAULT_REPOSITORY}\".`);
    }
    return parts;
  };
  const configured = () => !!(config().token && config().repository);
  const writeConfigured = () => !!(configured() && config().backupPassword);
  const repoApi = suffix => {
    const [owner, repo] = repositoryParts();
    return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
  };
  const resolvedDataPath = value => {
    const pathValue = safeRelativePath(value || config().dataPath);
    if (!pathValue) throw new Error("The requested GitHub JSON path is invalid.");
    return pathValue;
  };
  const encodedDataPath = value => resolvedDataPath(value).split("/").map(encodeURIComponent).join("/");
  const encodeRefPath = branch => encodeURIComponent(branch).replace(/%2F/gi, "/");

  const API_MAX_ATTEMPTS = Math.max(1, Math.min(5, Number(process.env.GITHUB_API_MAX_ATTEMPTS || 4)));
  const API_TIMEOUT_MS = Math.max(5000, Math.min(60000, Number(process.env.GITHUB_API_TIMEOUT_MS || 20000)));
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function transientHttp(response) {
    const status = Number(response?.status || 0);
    return [408, 429, 500, 502, 503, 504].includes(status)
      || (status === 403 && (response.headers?.get?.("retry-after") || response.headers?.get?.("x-ratelimit-remaining") === "0"));
  }
  function retryDelay(response, attempt) {
    const retryAfter = Number(response?.headers?.get?.("retry-after") || 0);
    if (retryAfter > 0) return Math.min(10000, retryAfter * 1000);
    const resetAt = Number(response?.headers?.get?.("x-ratelimit-reset") || 0);
    if (resetAt > 0) return Math.min(10000, Math.max(250, resetAt * 1000 - Date.now()));
    return Math.min(4000, 250 * (2 ** Math.max(0, attempt - 1)));
  }
  function networkFailureMessage(error) {
    const code = error?.cause?.code || error?.code || error?.cause?.name || "";
    const detail = code ? `${error?.message || "Network request failed"} (${code})` : (error?.message || "Network request failed");
    const host = (() => { try { return new URL(API_ROOT).host; } catch { return API_ROOT; } })();
    return `Could not reach the GitHub API at ${host} after ${API_MAX_ATTEMPTS} attempts. Last error: ${detail}. Check outbound HTTPS/DNS access from the hosting service and try again.`;
  }
  async function api(endpoint, options = {}) {
    const cfg = config();
    if (!cfg.token) throw new Error("GitHub token is not configured. Set GITHUB_TOKEN in the hosting service environment.");
    let lastNetworkError = null;
    for (let attempt = 1; attempt <= API_MAX_ATTEMPTS; attempt++) {
      let response;
      try {
        const timeoutSignal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(API_TIMEOUT_MS) : undefined;
        response = await fetch(`${API_ROOT}${endpoint}`, {
          ...options,
          signal: options.signal || timeoutSignal,
          headers: {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${cfg.token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Kaiser-Family-Fantasy-SMX-League-Backup",
            ...(options.headers || {})
          }
        });
      } catch (error) {
        lastNetworkError = error;
        if (attempt < API_MAX_ATTEMPTS) {
          await wait(Math.min(4000, 250 * (2 ** (attempt - 1))));
          continue;
        }
        throw new Error(networkFailureMessage(lastNetworkError));
      }

      let text;
      try { text = await response.text(); }
      catch (error) {
        lastNetworkError = error;
        if (attempt < API_MAX_ATTEMPTS) {
          await wait(Math.min(4000, 250 * (2 ** (attempt - 1))));
          continue;
        }
        throw new Error(networkFailureMessage(lastNetworkError));
      }
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 500) }; }
      if (!response.ok) {
        const err = new Error(data.message || `GitHub returned HTTP ${response.status}.`);
        err.status = response.status;
        if (response.status === 401) err.message = `GitHub rejected GITHUB_TOKEN (401). Create a valid token and check that it has not expired. ${err.message}`;
        if (response.status === 403) err.message = `GitHub denied access (403). The token needs Contents: Read and write plus Metadata: Read access to ${cfg.repository}. ${err.message}`;
        if (response.status === 404) err.message = `GitHub could not find ${cfg.repository} or the requested branch/file. Verify GITHUB_REPOSITORY is exactly \"${cfg.repository}\" and that GITHUB_TOKEN has access to this repository. ${err.message}`;
        if (response.status === 409 && /empty/i.test(err.message)) err.message = `The GitHub repository ${cfg.repository} has no first commit yet. The backup service will create its initial commit automatically.`;
        if (transientHttp(response) && attempt < API_MAX_ATTEMPTS) {
          await wait(retryDelay(response, attempt));
          continue;
        }
        throw err;
      }
      return data;
    }
    throw new Error(networkFailureMessage(lastNetworkError));
  }

  function isMissingRef(err) {
    return err?.status === 404 || (err?.status === 409 && /empty/i.test(err.message || ""));
  }

  function savedAtMs(data) {
    const direct = typeof data?.savedAt === "string" ? Date.parse(data.savedAt) : Number(data?.savedAt || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const values = Object.values(data?.keyUpdatedAt || {}).map(Number).filter(n => Number.isFinite(n) && n > 0);
    return values.length ? Math.max(...values) : 0;
  }

  async function resolveBranch() {
    const cfg = config();
    const repository = await api(repoApi(""));
    const preferred = cfg.branchOverride || repository.default_branch || "main";
    try {
      const ref = await api(repoApi(`/git/ref/heads/${encodeRefPath(preferred)}`));
      return { branch: preferred, branchExists: true, ref, defaultBranch: repository.default_branch || "" };
    } catch (err) {
      if (!isMissingRef(err)) throw err;
      const fallback = repository.default_branch;
      if (fallback && fallback !== preferred) {
        try {
          const ref = await api(repoApi(`/git/ref/heads/${encodeRefPath(fallback)}`));
          console.warn(`Configured GitHub branch \"${preferred}\" was not found; using repository default branch \"${fallback}\".`);
          return { branch: fallback, branchExists: true, ref, defaultBranch: fallback, usedDefaultFallback: true };
        } catch (fallbackErr) {
          if (!isMissingRef(fallbackErr)) throw fallbackErr;
        }
      }
      // A brand-new repository has no branch until its first commit is created.
      return { branch: preferred, branchExists: false, ref: null, defaultBranch: fallback || "" };
    }
  }

  async function getJsonFile(dataPathOverride) {
    if (!configured()) return { configured: false, found: false, data: null, savedAt: 0, sha: null, commit: null, branchExists: false };
    const dataPath = resolvedDataPath(dataPathOverride);
    const branchInfo = await resolveBranch();
    if (!branchInfo.branchExists) {
      return { configured: true, found: false, data: null, savedAt: 0, sha: null, commit: null, path: dataPath, branch: branchInfo.branch, branchExists: false };
    }
    let file;
    try {
      file = await api(repoApi(`/contents/${encodedDataPath(dataPath)}?ref=${encodeURIComponent(branchInfo.branch)}`));
    } catch (err) {
      if (err.status === 404) return { configured: true, found: false, data: null, savedAt: 0, sha: null, commit: null, path: dataPath, branch: branchInfo.branch, branchExists: true };
      throw err;
    }
    if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") {
      throw new Error(`GitHub returned an unsupported format for ${dataPath}. The saved file must be a base64 JSON file.`);
    }
    let data;
    try { data = JSON.parse(Buffer.from(file.content.replace(/\n/g, ""), "base64").toString("utf8")); }
    catch { throw new Error(`The GitHub JSON file at ${dataPath} is not valid JSON.`); }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`The GitHub JSON file at ${dataPath} does not contain a valid JSON object.`);
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
      path: dataPath,
      branch: branchInfo.branch,
      branchExists: true
    };
  }

  async function getLatestLeagueData(dataPathOverride) {
    const result = await getJsonFile(dataPathOverride);
    if (result.found && (!result.data.state || typeof result.data.state !== "object" || Array.isArray(result.data.state))) {
      throw new Error(`The GitHub league save at ${result.path} does not contain a valid state object.`);
    }
    return result;
  }

  async function createFirstCommit(content, message, branch, dataPathOverride) {
    const dataPath = resolvedDataPath(dataPathOverride);
    // The Contents API cannot create a file in a repository with no commits.
    // Use Git Database APIs to create the first tree, commit, and branch ref.
    const tree = await api(repoApi("/git/trees"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tree: [{ path: dataPath, mode: "100644", type: "blob", content }]
      })
    });
    if (!tree.sha) throw new Error("GitHub did not return a tree SHA while creating the initial league backup.");
    const commit = await api(repoApi("/git/commits"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, tree: tree.sha, parents: [] })
    });
    if (!commit.sha) throw new Error("GitHub did not return a commit SHA while creating the initial league backup.");
    await api(repoApi("/git/refs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha })
    });
    return commit;
  }

  async function saveJsonFile(value, message = "Kaiser Family Fantasy SMX: JSON save", dataPathOverride) {
    if (!configured()) throw new Error("GitHub JSON storage is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY on the server.");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The submitted JSON document is invalid.");
    const cfg = config();
    const dataPath = resolvedDataPath(dataPathOverride);
    const current = await getJsonFile(dataPath);
    const content = JSON.stringify(value, null, 2);
    const commitMessage = String(message || "Kaiser Family Fantasy SMX: JSON save").replace(/[\r\n]+/g, " ").trim().slice(0, 180);
    if (current.found && JSON.stringify(current.data, null, 2) === content) {
      return { ok: true, changed: false, savedAt: savedAtMs(value), path: dataPath, branch: current.branch, commit: current.commit || { sha: "", url: "", date: "" } };
    }
    if (!current.branchExists) {
      const commit = await createFirstCommit(content, commitMessage, current.branch || cfg.branchOverride || "main", dataPath);
      return {
        ok: true, changed: true, initialCommit: true, savedAt: savedAtMs(value), path: dataPath, branch: current.branch || cfg.branchOverride || "main",
        commit: { sha: commit.sha, shortSha: String(commit.sha).slice(0, 7), url: commit.html_url || "", date: commit.committer?.date || commit.author?.date || new Date().toISOString() }
      };
    }
    const payload = { message: commitMessage, content: Buffer.from(content, "utf8").toString("base64"), branch: current.branch };
    if (current.sha) payload.sha = current.sha;
    const result = await api(repoApi(`/contents/${encodedDataPath(dataPath)}`), {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    return {
      ok: true, changed: true, savedAt: savedAtMs(value), path: dataPath, branch: current.branch,
      commit: { sha: result.commit?.sha || "", shortSha: String(result.commit?.sha || "").slice(0, 7), url: result.commit?.html_url || "", date: result.commit?.committer?.date || result.commit?.author?.date || new Date().toISOString() }
    };
  }

  async function saveLeagueData(database, message = "Kaiser Family Fantasy SMX: automatic league-data save", dataPathOverride) {
    if (!database || typeof database !== "object" || !database.state || typeof database.state !== "object" || Array.isArray(database.state)) {
      throw new Error("The current league database is not valid and cannot be saved to GitHub.");
    }
    return saveJsonFile(database, message, dataPathOverride);
  }

  async function getStatus(localInfo = {}) {
    let cfg;
    try { cfg = config(); }
    catch (err) {
      return { configured: false, writeReady: false, automaticSave: false, repository: "", branch: "repository default", dataPath: "", tokenSet: !!process.env.GITHUB_TOKEN, backupPasswordSet: !!process.env.GITHUB_BACKUP_PASSWORD, latestGitHubSave: null, error: err.message, ...localInfo };
    }
    const result = {
      configured: configured(),
      writeReady: writeConfigured(),
      autoBackupEnabled: true,
      automaticSave: configured(),
      repository: cfg.repository || "",
      branch: cfg.branchOverride || "repository default (auto-detect)",
      dataPath: cfg.dataPath,
      tokenSet: !!cfg.token,
      backupPasswordSet: !!cfg.backupPassword,
      latestGitHubSave: null,
      error: "",
      ...localInfo
    };
    if (!result.configured) {
      result.error = "GitHub backup needs GITHUB_TOKEN. The repository is preconfigured; add a fine-grained token with Contents: Read and write and Metadata: Read for tkaiser930-droid/LeagueSave.";
      return result;
    }
    try {
      const remote = await getLatestLeagueData(localInfo.dataPath);
      result.branch = remote.branch || cfg.branchOverride || "main";
      result.branchExists = !!remote.branchExists;
      if (remote.found) {
        result.latestGitHubSave = {
          savedAt: remote.savedAt,
          commit: remote.commit,
          shortSha: remote.commit?.sha ? remote.commit.sha.slice(0, 7) : "",
          path: remote.path
        };
      } else {
        result.repositoryReadyForFirstSave = !remote.branchExists;
        result.githubSaveFileMissing = !!remote.branchExists;
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
    isAutoEnabled: () => { try { return configured(); } catch { return false; } },
    authorize,
    getJsonFile,
    saveJsonFile,
    getLatestLeagueData,
    saveLeagueData,
    getStatus,
    getConfigSummary: (dataPathOverride) => ({ repository: config().repository, branch: config().branchOverride || "repository default (auto-detect)", dataPath: resolvedDataPath(dataPathOverride) })
  };
}

module.exports = { createGithubBackup };
