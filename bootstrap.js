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
  let storageLabel = "GitHub season files";
  let activeYear = 2027;
  let seasonYear = 2027;
  const parseLocal = key => {
    try { const value = localStorage.getItem(key); return value === null ? null : JSON.parse(value); }
    catch { return null; }
  };
  const localTime = key => Number(localStorage.getItem(TS_PREFIX + key) || 0) || 0;
  function setStatus(text, state) {
    if (!statusNode) return;
    statusNode.textContent = text;
    statusNode.className = "storage-banner " + (state || "info");
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
  async function apiState(year) {
    const url = year == null ? "/api/state" : yearUrl("/api/state", year);
    const body = await readJson(await fetch(url, { cache: "no-store", credentials: "same-origin" }), "GitHub season storage is unavailable");
    if (!body || typeof body.state !== "object" || !body.keyUpdatedAt) throw new Error("Invalid GitHub season response.");
    return body;
  }
  async function apiPut(key, value, updatedAt, targetYear = seasonYear) {
    const res = await fetch(yearUrl("/api/state/" + encodeURIComponent(key), targetYear), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, updatedAt }), keepalive: true, cache: "no-store", credentials: "same-origin"
    });
    const result = await readJson(res, "GitHub save failed for " + key);
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
      lastError = null;
      setStatus("Connected", "good");
    }).catch(err => {
      lastError = err;
      setStatus("GitHub save failed. The browser copy is retained; check GitHub access and retry from Data & Backup.", "error");
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
    }
    if (lastError) throw lastError;
  }
  async function loadServerState() {
    if (mode !== "server") throw new Error("GitHub storage is not connected in this browser.");
    const remote = await apiState(seasonYear);
    applyRemoteState(remote);
    setStatus("Connected", "good");
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
    const target = Number(year);
    if (!Number.isInteger(target) || target < 2010 || target > 2099) throw new Error("Choose a season between 2010 and 2099.");
    if (mode !== "server") throw new Error("Season switching requires a connection to GitHub. Your browser copy remains available for download.");
    // Always refresh the selected season from GitHub, even when the year has not
    // changed. Copy-between-seasons and manual reload actions update GitHub first;
    // a same-year refresh prevents a stale browser copy from overwriting that file.
    await flush();
    const remote = await apiState(target);
    applyRemoteState(remote);
    seasonYear = target;
    activeYear = Number(remote.activeYear || activeYear);
    storageLabel = remote.storageLabel || "GitHub season files";
    setStatus("Connected", "good");
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
  async function copySeason(sourceYear, destinationYear, parts) {
    await flush();
    const res = await fetch("/api/seasons/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceYear: Number(sourceYear), destinationYear: Number(destinationYear), parts }), credentials: "same-origin", cache: "no-store" });
    return readJson(res, "Season copy failed");
  }
  window.KFStorage = {
    get mode() { return mode; },
    get lastError() { return lastError; },
    get lastExportUsedBrowserCopy() { return lastExportUsedBrowserCopy; },
    get location() { return storageLabel; },
    get activeYear() { return activeYear; },
    get seasonYear() { return seasonYear; },
    write: storageWrite,
    flush, refreshFromServer, loadServerState, exportState, replaceState, clearAll,
    commissionerLogin, commissionerSession, commissionerLogout, getSeasonMeta, setSeasonYear, archiveSeason, copySeason,
    keys: KEYS.slice()
  };

  async function start() {
    ensureBanner(); setStatus("Connecting to the GitHub league database…", "info");
    try {
      const remote = await apiState();
      mode = "server";
      activeYear = Number(remote.activeYear || remote.seasonYear || 2027);
      seasonYear = activeYear;
      storageLabel = remote.storageLabel || "GitHub season files";
      const work = [];
      for (const key of KEYS) {
        const localValue = parseLocal(key), localTs = localTime(key);
        const hasRemote = Object.prototype.hasOwnProperty.call(remote.state, key);
        const hasRemoteStamp = Object.prototype.hasOwnProperty.call(remote.keyUpdatedAt, key);
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
      setStatus("Connected", "good");
    } catch (err) {
      mode = "browser";
      setStatus("GitHub storage is unavailable: " + err.message + ". This browser copy remains available for download.", "warn");
    }
    const script = document.createElement("script");
    script.src = "app.js";
    script.onerror = () => setStatus("Could not load app.js. Make sure this page is opened from the project folder.", "error");
    document.body.appendChild(script);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
