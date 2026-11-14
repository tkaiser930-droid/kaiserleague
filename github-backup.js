"use strict";

const path = require("path");
const crypto = require("crypto");

const API_ROOT = "https://api.github.com";
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
      backupPassword: process.env.GITHUB_BACKUP_PASSWORD || "",
      autoEnabled: String(process.env.GITHUB_AUTO_BACKUP || "true").toLowerCase() !== "false"
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
  const encodedDataPath = () => config().dataPath.split("/").map(encodeURIComponent).join("/");
  const encodeRefPath = branch => encodeURIComponent(branch).replace(/%2F/gi, "/");

  async function api(endpoint, options = {}) {
    const cfg = config();
    if (!cfg.token) throw new Error("GitHub token is not configured. Set GITHUB_TOKEN on the Render server.");
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
      if (response.status === 401) err.message = `GitHub rejected GITHUB_TOKEN (401). Create a valid token and check that it has not expired. ${err.message}`;
      if (response.status === 403) err.message = `GitHub denied access (403). The token needs Contents: Read and write plus Metadata: Read access to ${config().repository}. ${err.message}`;
      if (response.status === 404) err.message = `GitHub could not find ${config().repository} or the requested branch/file. Verify GITHUB_REPOSITORY is exactly \"${config().repository}\" and that GITHUB_TOKEN has access to this repository. ${err.message}`;
      if (response.status === 409 && /empty/i.test(err.message)) err.message = `The GitHub repository ${config().repository} has no first commit yet. The backup service will create its initial commit automatically.`;
      throw err;
    }
    return data;
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

  async function getLatestLeagueData() {
    if (!configured()) return { configured: false, found: false, data: null, savedAt: 0, sha: null, commit: null, branchExists: false };
    const cfg = config();
    const branchInfo = await resolveBranch();
    if (!branchInfo.branchExists) {
      return { configured: true, found: false, data: null, savedAt: 0, sha: null, commit: null, path: cfg.dataPath, branch: branchInfo.branch, branchExists: false };
    }
    let file;
    try {
      file = await api(repoApi(`/contents/${encodedDataPath()}?ref=${encodeURIComponent(branchInfo.branch)}`));
    } catch (err) {
      if (err.status === 404) return { configured: true, found: false, data: null, savedAt: 0, sha: null, commit: null, path: cfg.dataPath, branch: branchInfo.branch, branchExists: true };
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
      path: cfg.dataPath,
      branch: branchInfo.branch,
      branchExists: true
    };
  }

  async function createFirstCommit(content, message, branch) {
    const cfg = config();
    // The Contents API cannot create a file in a repository with no commits.
    // Use Git Database APIs to create the first tree, commit, and branch ref.
    const tree = await api(repoApi("/git/trees"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tree: [{ path: cfg.dataPath, mode: "100644", type: "blob", content }]
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

  async function saveLeagueData(database, message = "Kaiser Family Fantasy SMX: automatic league-data save") {
    if (!configured()) throw new Error("GitHub league-data backup is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY on the server.");
    if (!database || typeof database !== "object" || !database.state || typeof database.state !== "object" || Array.isArray(database.state)) {
      throw new Error("The current league database is not valid and cannot be saved to GitHub.");
    }
    const cfg = config();
    const current = await getLatestLeagueData();
    const content = JSON.stringify(database, null, 2);
    const commitMessage = String(message || "Kaiser Family Fantasy SMX: league-data save").replace(/[\r\n]+/g, " ").trim().slice(0, 180);
    if (current.found && JSON.stringify(current.data, null, 2) === content) {
      return {
        ok: true, changed: false, savedAt: savedAtMs(database), path: cfg.dataPath, branch: current.branch,
        commit: current.commit || { sha: "", url: "", date: "" }
      };
    }

    if (!current.branchExists) {
      const commit = await createFirstCommit(content, commitMessage, current.branch || cfg.branchOverride || "main");
      return {
        ok: true, changed: true, initialCommit: true, savedAt: savedAtMs(database), path: cfg.dataPath, branch: current.branch || cfg.branchOverride || "main",
        commit: { sha: commit.sha, shortSha: String(commit.sha).slice(0, 7), url: commit.html_url || "", date: commit.committer?.date || commit.author?.date || new Date().toISOString() }
      };
    }

    const payload = { message: commitMessage, content: Buffer.from(content, "utf8").toString("base64"), branch: current.branch };
    if (current.sha) payload.sha = current.sha;
    const result = await api(repoApi(`/contents/${encodedDataPath()}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return {
      ok: true, changed: true, savedAt: savedAtMs(database), path: cfg.dataPath, branch: current.branch,
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
      return { configured: false, writeReady: false, automaticSave: false, repository: "", branch: "repository default", dataPath: "", tokenSet: !!process.env.GITHUB_TOKEN, backupPasswordSet: !!process.env.GITHUB_BACKUP_PASSWORD, latestGitHubSave: null, error: err.message, ...localInfo };
    }
    const result = {
      configured: configured(),
      writeReady: writeConfigured(),
      autoBackupEnabled: cfg.autoEnabled,
      automaticSave: !!(cfg.autoEnabled && configured()),
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
      const remote = await getLatestLeagueData();
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
    isAutoEnabled: () => { try { return config().autoEnabled && configured(); } catch { return false; } },
    authorize,
    getLatestLeagueData,
    saveLeagueData,
    getStatus,
    getConfigSummary: () => ({ repository: config().repository, branch: config().branchOverride || "repository default (auto-detect)", dataPath: config().dataPath })
  };
}

module.exports = { createGithubBackup };
