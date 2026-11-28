(() => {
  "use strict";
  const KEYS = [
    "kaiserFantasyAthletes", "kaiserFantasyTeams", "kaiserFantasyScores",
    "kaiserFantasyTrades", "kaiserFantasyDraftState", "kaiserFantasyDraftSettings",
    "kaiserFantasySchedule"
  ];
  const TS_PREFIX = "__kf_saved_at__";
  const UNSYNCED_PREFIX = "__kf_unsynced__";
  let mode = "browser";
  let pending = Promise.resolve();
  let lastError = null;
  let lastExportUsedBrowserCopy = false;
  const dirtyKeys = new Set();
  let statusNode = null;
  let statusRevision = 0;
  let storageLabel = "GitHub season files";
  let activeYear = 2027;
  let seasonYear = 2027;
  const parseLocal = key => {
    try { const value = localStorage.getItem(key); return value === null ? null : JSON.parse(value); }
    catch { return null; }
  };
  const localTime = key => Number(localStorage.getItem(TS_PREFIX + key) || 0) || 0;
  function beginStatusCheck() { return ++statusRevision; }
  function isCurrentStatusCheck(ticket) { return ticket === statusRevision; }
  function setStatus(text, state, ticket) {
    if (ticket !== undefined) {
      if (!isCurrentStatusCheck(ticket)) return false;
    } else statusRevision++;
    if (statusNode) {
      statusNode.textContent = text;
      statusNode.className = "storage-banner " + (state || "info");
    }
    // One authoritative status is reflected everywhere. This also prevents
    // the header, Data & Backup panel, and draft status from disagreeing.
    const detailClass = state === "good" ? "good" : "warn";
    const backupStatus = typeof document.getElementById === "function" ? document.getElementById("githubBackupStatus") : null;
    if (backupStatus) {
      backupStatus.textContent = text;
      backupStatus.className = "storage-detail " + detailClass;
    }
    const dataMode = typeof document.getElementById === "function" ? document.getElementById("dataModeDetail") : null;
    if (dataMode) {
      dataMode.textContent = text;
      dataMode.className = "storage-detail " + detailClass;
    }
    return true;
  }
  function ensureBanner() {
    if (statusNode || !document.body) return;
    statusNode = document.createElement("div");
    statusNode.id = "kfStorageBanner";
    statusNode.className = "storage-banner info";
    const header = document.querySelector(".top");
    if (header) header.insertAdjacentElement("afterend", statusNode);
    else document.body.prepend(statusNode);
  }
  function yearUrl(path, year = seasonYear) {
    const url = new URL(path, location.origin);
    url.searchParams.set("year", String(year));
    return url.pathname + url.search;
  }
  async function readJson(response, fallbackMessage) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `${fallbackMessage} (HTTP ${response.status}).`);
    return body;
  }
  const retryWait = ms => new Promise(resolve => setTimeout(resolve, ms));
  function retryableStatus(status) { return [408, 429, 500, 502, 503, 504].includes(Number(status)); }
  function absoluteApiUrl(url) {
    try { return new URL(url, location.origin).href; } catch { return String(url); }
  }
  function browserApiFailure(error, url) {
    const endpoint = absoluteApiUrl(url);
    const pageOrigin = String(location.origin || "unknown origin");
    const protocol = String(location.protocol || "");
    if (protocol === "file:") {
      return `This page is opened directly from a file. Open the deployed Render service URL or run the Node.js server with npm start; the browser cannot reach its /api/state endpoint. (${error?.message || "network failure"})`;
    }
    return `The browser could not reach this site's Node.js API at ${endpoint} (page origin: ${pageOrigin}). This fails before GitHub is contacted. Open ${pageOrigin}/healthz: it must return JSON with \"ok\":true and build \"kf-batch-season-athlete-import-20261127b\". If /healthz does not load, verify the Render web service is live and that you are using its service URL, not a static/GitHub Pages URL. Browser error: ${error?.message || "Network request failed"}.`;
  }
  async function fetchJson(url, options = {}, fallbackMessage = "GitHub season storage is unavailable", attempts = 4) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const response = await fetch(url, { ...options, cache: "no-store", credentials: options.credentials || "same-origin" });
        const contentType = response.headers?.get?.("content-type") || "";
        let body = {};
        let responseText = "";
        try {
          if (/application\/json/i.test(contentType) || typeof response.text !== "function") body = await response.json();
          else {
            responseText = await response.text();
            try { body = responseText ? JSON.parse(responseText) : {}; } catch { body = {}; }
          }
        } catch { body = {}; }
        if (response.ok) {
          if (!body || typeof body !== "object" || Array.isArray(body)) {
            throw new Error(`The Node.js API at ${absoluteApiUrl(url)} returned an invalid JSON response.`);
          }
          return body;
        }
        const serverDetail = body.error || body.message || (responseText ? responseText.slice(0, 240) : "");
        let message = serverDetail || `${fallbackMessage} (HTTP ${response.status}).`;
        if (response.status === 404 && !/application\/json/i.test(contentType)) {
          message = `The Node.js API endpoint ${absoluteApiUrl(url)} returned HTTP 404 or an HTML page. This usually means the site is being served by a static host or an older deployment without the GitHub API routes.`;
        } else if (response.status === 401) {
          message = `The Node.js API returned HTTP 401 for ${absoluteApiUrl(url)}. The commissioner session or API authorization must be checked. ${serverDetail}`;
        }
        const error = new Error(message);
        error.status = response.status;
        if (!retryableStatus(response.status) || attempt === attempts) throw error;
        lastError = error;
      } catch (error) {
        if (error.status && !retryableStatus(error.status)) throw error;
        if (!error.status && (error.name === "TypeError" || /Failed to fetch|NetworkError|fetch failed/i.test(error.message || ""))) {
          lastError = new Error(browserApiFailure(error, url));
        } else lastError = error;
        if (attempt === attempts) break;
      }
      await retryWait(Math.min(3000, 300 * (2 ** (attempt - 1))));
    }
    const detail = lastError?.message || "Network request failed";
    throw new Error(`${fallbackMessage} after ${attempts} attempts: ${detail}`);
  }
  async function apiState(year) {
    const url = year == null ? "/api/state" : yearUrl("/api/state", year);
    const body = await fetchJson(url, { credentials: "same-origin" }, "GitHub season storage is unavailable");
    if (!body || typeof body.state !== "object" || !body.keyUpdatedAt) throw new Error("Invalid GitHub season response.");
    return body;
  }
  async function verifyGithubStatus(year) {
    const url = year == null ? "/api/github/status" : yearUrl("/api/github/status", year);
    const status = await fetchJson(url, { credentials: "same-origin" }, "Could not verify live GitHub storage");
    if (status.build !== "kf-batch-season-athlete-import-20261127b") {
      throw new Error("The deployed server is running an older storage-status build. Deploy the latest GitHub live-status project ZIP and reopen the site.");
    }
    if (!status.configured) throw new Error(status.error || "GitHub token or repository configuration is missing on the server.");
    if (status.error || status.verified !== true) throw new Error(status.error || "The server could not verify the selected season file in GitHub.");
    return status;
  }
  async function apiPut(key, value, updatedAt, targetYear = seasonYear) {
    const result = await fetchJson(yearUrl("/api/state/" + encodeURIComponent(key), targetYear), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      // Do not use fetch keepalive for league saves. Browsers cap the aggregate
      // body size of keepalive requests (typically 64 KiB); historical scoring arrays
      // can exceed that limit and reject with TypeError: Failed to fetch before the
      // Node API receives the request. Normal saves are awaited and retried instead.
      body: JSON.stringify({ value, updatedAt }), cache: "no-store", credentials: "same-origin"
    }, "GitHub save failed for " + key, 4);
    if (result.applied === false) {
      const remote = await apiState(targetYear);
      if (Object.prototype.hasOwnProperty.call(remote.state, key)) {
        loadLocal(key, remote.state[key], Number(remote.keyUpdatedAt[key] || remote.savedAt || 0));
      } else clearLocal(key);
    } else localStorage.removeItem(UNSYNCED_PREFIX + key);
    return result;
  }
  function clearLocal(key) {
    localStorage.removeItem(key);
    localStorage.removeItem(TS_PREFIX + key);
    localStorage.removeItem(UNSYNCED_PREFIX + key);
  }
  function loadLocal(key, value, updatedAt, pendingSync = false) {
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem(TS_PREFIX + key, String(updatedAt || 0));
    if (pendingSync) localStorage.setItem(UNSYNCED_PREFIX + key, "1");
    else localStorage.removeItem(UNSYNCED_PREFIX + key);
  }
  function applyRemoteState(remote) {
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(remote.state, key)) {
        loadLocal(key, remote.state[key], Number(remote.keyUpdatedAt[key] || remote.savedAt || 0));
      } else clearLocal(key);
    }
    dirtyKeys.clear();
    lastError = null;
  }
  function storageWrite(key, value) {
    const prev = localTime(key);
    const updatedAt = Math.max(Date.now(), prev + 1);
    const targetYear = seasonYear;
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem(TS_PREFIX + key, String(updatedAt));
    localStorage.setItem(UNSYNCED_PREFIX + key, "1");
    if (mode !== "server") return;
    dirtyKeys.add(key);
    setStatus("Saving changes to GitHub…", "saving");
    pending = pending.then(() => apiPut(key, value, updatedAt, targetYear)).then(() => {
      dirtyKeys.delete(key);
      if (dirtyKeys.size === 0) {
        lastError = null;
        setStatus("Connected", "good");
      } else if (lastError) {
        setStatus("GitHub save unavailable: " + lastError.message, "warn");
      }
    }).catch(err => {
      lastError = err;
      setStatus("GitHub save unavailable: " + err.message + ". The browser copy is retained; retry from Data & Backup.", "warn");
      throw err;
    });
    pending = pending.catch(err => { lastError = err; });
  }
  async function flush() {
    await pending;
    if (mode === "server" && dirtyKeys.size) {
      for (const key of [...dirtyKeys]) {
        const value = parseLocal(key);
        if (value === null) continue;
        try {
          await apiPut(key, value, localTime(key) || Date.now(), seasonYear);
          dirtyKeys.delete(key);
          lastError = null;
        } catch (error) { lastError = error; throw error; }
      }
      if (dirtyKeys.size === 0) {
        lastError = null;
        setStatus("Connected", "good");
      }
    }
    if (lastError && dirtyKeys.size) throw lastError;
  }
  async function loadServerState() {
    const statusTicket = beginStatusCheck();
    if (mode !== "server") throw new Error("GitHub storage is not connected in this browser.");
    const liveStatus = await verifyGithubStatus(seasonYear);
    const remote = await apiState(seasonYear);
    applyRemoteState(remote);
    if (liveStatus.autoSaveLastError) {
      lastError = new Error(liveStatus.autoSaveLastError);
      setStatus("GitHub save unavailable: " + liveStatus.autoSaveLastError, "warn", statusTicket);
    } else setStatus("Connected", "good", statusTicket);
    return true;
  }
  async function refreshFromServer() {
    if (mode !== "server") return false;
    await flush();
    const remote = await apiState(seasonYear);
    let changed = false;
    for (const key of KEYS) {
      const hasRemoteStamp = Object.prototype.hasOwnProperty.call(remote.keyUpdatedAt, key);
      const remoteTs = Number(remote.keyUpdatedAt[key] || 0);
      const localTs = localTime(key);
      const localValue = parseLocal(key);
      if (Object.prototype.hasOwnProperty.call(remote.state, key)) {
        if (remoteTs > localTs || (remoteTs === localTs && JSON.stringify(localValue) !== JSON.stringify(remote.state[key]))) {
          loadLocal(key, remote.state[key], remoteTs);
          changed = true;
        }
      } else if (hasRemoteStamp && remoteTs >= localTs && localValue !== null) {
        clearLocal(key); changed = true;
      }
    }
    return changed;
  }
  async function exportState() {
    lastExportUsedBrowserCopy = false;
    const browserState = {};
    for (const key of KEYS) { const value = parseLocal(key); if (value !== null) browserState[key] = value; }
    if (mode === "server") {
      try { await flush(); return (await apiState(seasonYear)).state; }
      catch (error) { lastExportUsedBrowserCopy = true; if (Object.keys(browserState).length) return browserState; throw error; }
    }
    return browserState;
  }
  async function replaceState(state) {
    await pending.catch(() => {});
    const filtered = {};
    for (const key of KEYS) if (Object.prototype.hasOwnProperty.call(state, key)) filtered[key] = state[key];
    const timestamp = Date.now();
    if (mode === "server") {
      const res = await fetch(yearUrl("/api/state", seasonYear), {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: filtered, updatedAt: timestamp }), cache: "no-store", credentials: "same-origin"
      });
      await readJson(res, "The GitHub season save could not be replaced");
    }
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(filtered, key)) loadLocal(key, filtered[key], timestamp, mode !== "server");
      else { clearLocal(key); if (mode !== "server") localStorage.setItem(UNSYNCED_PREFIX + key, "1"); }
    }
    dirtyKeys.clear(); lastError = null;
    setStatus(mode === "server" ? "Connected" : "Browser-only storage", mode === "server" ? "good" : "warn");
  }
  async function clearAll() {
    await pending.catch(() => {});
    if (mode === "server") {
      const res = await fetch(yearUrl("/api/state", seasonYear), { method: "DELETE", cache: "no-store", credentials: "same-origin" });
      await readJson(res, "Could not clear the GitHub season save");
    }
    for (const key of KEYS) clearLocal(key);
    dirtyKeys.clear(); lastError = null;
  }
  async function commissionerLogin(password) {
    const res = await fetch("/api/commissioner/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: String(password || "") }), credentials: "same-origin", cache: "no-store"
    });
    await readJson(res, "Commissioner sign-in failed");
    return true;
  }
  async function commissionerSession() {
    const res = await fetch("/api/commissioner/session", { credentials: "same-origin", cache: "no-store" });
    const result = await readJson(res, "Could not check commissioner session");
    return !!result.authenticated;
  }
  async function commissionerLogout() {
    await fetch("/api/commissioner/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
  }
  async function getSeasonMeta() {
    const result = await readJson(await fetch("/api/seasons/meta", { credentials: "same-origin", cache: "no-store" }), "Could not load season list");
    activeYear = Number(result.activeYear || activeYear);
    return result;
  }
  async function setSeasonYear(year) {
    const statusTicket = beginStatusCheck();
    const target = Number(year);
    if (!Number.isInteger(target) || target < 2010 || target > 2099) throw new Error("Choose a season between 2010 and 2099.");
    if (mode !== "server") throw new Error("Season switching requires a connection to GitHub. Your browser copy remains available for download.");
    // Always refresh the selected season from GitHub, even when the year has not
    // changed. Copy-between-seasons and manual reload actions update GitHub first;
    // a same-year refresh prevents a stale browser copy from overwriting that file.
    await flush();
    const liveStatus = await verifyGithubStatus(target);
    const remote = await apiState(target);
    applyRemoteState(remote);
    seasonYear = target;
    activeYear = Number(remote.activeYear || activeYear);
    storageLabel = remote.storageLabel || "GitHub season files";
    if (liveStatus.autoSaveLastError) {
      lastError = new Error(liveStatus.autoSaveLastError);
      setStatus("GitHub save unavailable: " + liveStatus.autoSaveLastError, "warn", statusTicket);
    } else setStatus("Connected", "good", statusTicket);
    return remote;
  }
  async function archiveSeason(year) {
    await flush();
    const res = await fetch("/api/seasons/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year: Number(year) }), credentials: "same-origin", cache: "no-store" });
    const result = await readJson(res, "Season archive failed");
    activeYear = Number(result.currentYear);
    seasonYear = activeYear;
    const remote = await apiState(seasonYear);
    applyRemoteState(remote);
    return result;
  }
  async function copySeason(sourceYear, destinationYear, parts, filters = {}) {
    await flush();
    const res = await fetch("/api/seasons/copy", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceYear: Number(sourceYear), destinationYear: Number(destinationYear), parts,
        riderSeries: filters.riderSeries || "all", scheduleSeries: filters.scheduleSeries || "all"
      }),
      credentials: "same-origin", cache: "no-store"
    });
    return readJson(res, "Season copy failed");
  }
  window.KFStorage = {
    get mode() { return mode; },
    get lastError() { return lastError; },
    get lastExportUsedBrowserCopy() { return lastExportUsedBrowserCopy; },
    get location() { return storageLabel; },
    get activeYear() { return activeYear; },
    get seasonYear() { return seasonYear; },
    beginStatusCheck,
    get pendingWrites() { return dirtyKeys.size; },
    reportStatus: (text, state, ticket) => {
      if (!isCurrentStatusCheck(ticket)) return false;
      if (text === "Connected") {
        // A successful GitHub probe alone is insufficient: /api/state must
        // also have completed in this browser, and no local writes may remain.
        if (mode !== "server" || dirtyKeys.size > 0) return false;
        lastError = null;
      } else if (/^Unavailable:|save unavailable|could not reach/i.test(text)) {
        lastError = new Error(text);
      }
      return setStatus(text, state, ticket);
    },
    write: storageWrite,
    flush, refreshFromServer, loadServerState, exportState, replaceState, clearAll,
    commissionerLogin, commissionerSession, commissionerLogout, getSeasonMeta, setSeasonYear, archiveSeason, copySeason, reconnect,
    keys: KEYS.slice()
  };

  let reconnecting = false;
  let reconnectTimer = null;
  async function connectToServer(statusTicket = beginStatusCheck()) {
    // /api/state may be served from the Node process cache. Probe GitHub itself
    // first so a warm cache cannot produce a false Connected indication.
    const liveStatus = await verifyGithubStatus();
    activeYear = Number(liveStatus.activeYear || liveStatus.statusYear || 2027);
    const remote = await apiState(activeYear);
    mode = "server";
    activeYear = Number(remote.activeYear || remote.seasonYear || activeYear);
    seasonYear = activeYear;
    storageLabel = remote.storageLabel || "GitHub season files";
    const work = [];
    for (const key of KEYS) {
      const localValue = parseLocal(key), localTs = localTime(key);
      const hasRemote = Object.prototype.hasOwnProperty.call(remote.state, key);
      const remoteTs = Number(remote.keyUpdatedAt[key] || 0);
      const unsynced = localStorage.getItem(UNSYNCED_PREFIX + key) === "1";
      if (localValue !== null && unsynced && (!hasRemote || localTs >= remoteTs)) {
        const updatedAt = localTs || Date.now();
        loadLocal(key, localValue, updatedAt, true);
        work.push(apiPut(key, localValue, updatedAt, seasonYear));
      } else if (hasRemote) loadLocal(key, remote.state[key], remoteTs);
      else clearLocal(key);
    }
    await Promise.all(work);
    // Recheck after any recovered offline writes. The first status response
    // predates those commits and may still contain the previous save error.
    const finalStatus = await verifyGithubStatus(seasonYear);
    dirtyKeys.clear();
    if (finalStatus.autoSaveLastError) {
      lastError = new Error(finalStatus.autoSaveLastError);
      setStatus("GitHub save unavailable: " + finalStatus.autoSaveLastError, "warn", statusTicket);
      return false;
    }
    lastError = null;
    setStatus("Connected", "good", statusTicket);
    return true;
  }
  async function reconnect() {
    if (reconnecting) return false;
    const statusTicket = beginStatusCheck();
    reconnecting = true;
    try {
      return await connectToServer(statusTicket);
    } catch (err) {
      if (!isCurrentStatusCheck(statusTicket)) return mode === "server";
      mode = "browser";
      lastError = err;
      setStatus("Unavailable: " + err.message + ". The browser copy remains available for download; reconnecting automatically.", "warn", statusTicket);
      return false;
    } finally {
      reconnecting = false;
    }
  }
  async function verifyLiveConnection() {
    if (mode !== "server" || reconnecting) return mode === "server";
    const statusTicket = beginStatusCheck();
    try {
      await flush();
      const liveStatus = await verifyGithubStatus(seasonYear);
      if (!isCurrentStatusCheck(statusTicket)) return mode === "server";
      if (liveStatus.autoSaveLastError) {
        lastError = new Error(liveStatus.autoSaveLastError);
        setStatus("Unavailable: " + liveStatus.autoSaveLastError, "warn", statusTicket);
        return false;
      }
      if (dirtyKeys.size) {
        setStatus("Saving changes to GitHub…", "saving", statusTicket);
        return false;
      }
      lastError = null;
      setStatus("Connected", "good", statusTicket);
      return true;
    } catch (err) {
      if (!isCurrentStatusCheck(statusTicket)) return mode === "server";
      mode = "browser";
      lastError = err;
      setStatus("Unavailable: " + err.message + ". The browser copy remains available for download; reconnecting automatically.", "warn", statusTicket);
      return false;
    }
  }
  function ensureReconnectLoop() {
    if (reconnectTimer || typeof setInterval !== "function") return;
    reconnectTimer = setInterval(() => {
      if (mode === "server") verifyLiveConnection();
      else reconnect();
    }, 30000);
  }
  async function start() {
    ensureBanner(); setStatus("Connecting to the GitHub league database…", "info");
    await reconnect();
    ensureReconnectLoop();
    if (typeof window.addEventListener === "function") {
      window.addEventListener("online", () => { if (mode !== "server") reconnect(); else verifyLiveConnection(); });
      window.addEventListener("focus", () => { if (mode !== "server") reconnect(); else verifyLiveConnection(); });
    }
    const script = document.createElement("script");
    script.src = "app.js?v=kf-batch-season-athlete-import-20261127b";
    script.onerror = () => setStatus("Could not load app.js. Make sure this page is opened from the project folder.", "error");
    document.body.appendChild(script);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
