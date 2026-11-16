(() => {
  "use strict";
  const KEYS = [
    "kaiserFantasyAthletes", "kaiserFantasyTeams", "kaiserFantasyScores",
    "kaiserFantasyTrades", "kaiserFantasyDraftState", "kaiserFantasyDraftSettings",
    "kaiserFantasySchedule", "kaiserFantasySeasonSettings"
  ];
  const HISTORICAL_KEY = "kaiserFantasyHistoricalSeasons";
  let commissionerToken = sessionStorage.getItem("commApiToken") || "";
  const TS_PREFIX = "__kf_saved_at__";
  // A public visitor on a shared browser must not inherit the commissioner's cached private history.
  if (!commissionerToken) {
    localStorage.removeItem(HISTORICAL_KEY);
    localStorage.removeItem(TS_PREFIX + HISTORICAL_KEY);
  }
  let mode = "browser";
  let pending = Promise.resolve();
  let lastError = null;
  let statusNode = null;
  let storageLabel = "project file data/league-data.json";
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
  async function apiState() {
    const res = await fetch("/api/state", { cache: "no-store" });
    if (!res.ok) throw new Error("The local database server is not running.");
    const body = await res.json();
    if (!body || typeof body.state !== "object" || !body.keyUpdatedAt) throw new Error("Invalid database response.");
    return body;
  }
  async function apiPut(key, value, updatedAt) {
    const res = await fetch("/api/state/" + encodeURIComponent(key), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, updatedAt }), keepalive: true, cache: "no-store"
    });
    if (!res.ok) throw new Error("Database write failed for " + key + ".");
    return res.json();
  }
  async function apiHistoricalPut(value) {
    if (!commissionerToken) throw new Error("Sign in as commissioner again to save historical seasons.");
    const res = await fetch("/api/historical", {
      method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + commissionerToken },
      body: JSON.stringify({ value }), keepalive: true, cache: "no-store"
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Historical season data could not be saved.");
    return body;
  }
  async function apiHistoricalGet() {
    if (!commissionerToken) throw new Error("Commissioner sign-in is required to access previous seasons.");
    const res = await fetch("/api/historical", { headers: { Authorization: "Bearer " + commissionerToken }, cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Historical season data could not be loaded.");
    loadLocal(HISTORICAL_KEY, body.value || { version: 1, seasons: {} }, body.updatedAt || Date.now());
    return body.value || { version: 1, seasons: {} };
  }
  function loadLocal(key, value, updatedAt) {
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem(TS_PREFIX + key, String(updatedAt || 0));
  }
  function storageWrite(key, value) {
    const prev = localTime(key);
    const updatedAt = Math.max(Date.now(), prev + 1);
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem(TS_PREFIX + key, String(updatedAt));
    if (mode !== "server") return;
    setStatus("Saving changes to the project database…", "saving");
    const saveRequest = key === HISTORICAL_KEY ? () => apiHistoricalPut(value) : () => apiPut(key, value, updatedAt);
    pending = pending.then(saveRequest).then(() => {
      lastError = null;
      setStatus("Saved to server storage: " + storageLabel, "good");
    }).catch(err => {
      lastError = err;
      setStatus("Save to project file failed. The browser copy is retained; check the server and use Data & Backup to retry.", "error");
      throw err;
    });
    // Mark the queued rejection as handled for the UI; flush() still reports it through lastError.
    pending = pending.catch(err => { lastError = err; });
  }
  async function flush() {
    await pending;
    if (lastError) throw lastError;
  }
  async function refreshFromServer() {
    if (mode !== "server") return false;
    const remote = await apiState();
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
        localStorage.removeItem(key);
        localStorage.removeItem(TS_PREFIX + key);
        changed = true;
      }
    }
    return changed;
  }
  async function exportState() {
    if (mode === "server") {
      await flush();
      const state = (await apiState()).state;
      if (commissionerToken) state[HISTORICAL_KEY] = await apiHistoricalGet();
      return state;
    }
    const state = {};
    for (const key of KEYS) { const value = parseLocal(key); if (value !== null) state[key] = value; }
    if (commissionerToken) { const history = parseLocal(HISTORICAL_KEY); if (history !== null) state[HISTORICAL_KEY] = history; }
    return state;
  }
  async function replaceState(state) {
    // Drain earlier writes before replacing the entire state during backup restore.
    await pending.catch(() => {});
    const filtered = {};
    for (const key of KEYS) if (Object.prototype.hasOwnProperty.call(state, key)) filtered[key] = state[key];
    const includesHistory = Object.prototype.hasOwnProperty.call(state, HISTORICAL_KEY);
    const timestamp = Date.now();
    if (mode === "server") {
      const res = await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: filtered, updatedAt: timestamp }), cache: "no-store" });
      if (!res.ok) throw new Error("The project database could not replace its saved data.");
      await res.json();
      if (includesHistory) await apiHistoricalPut(state[HISTORICAL_KEY]);
    }
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(filtered, key)) loadLocal(key, filtered[key], timestamp);
      else { localStorage.removeItem(key); localStorage.removeItem(TS_PREFIX + key); }
    }
    if (includesHistory) loadLocal(HISTORICAL_KEY, state[HISTORICAL_KEY], timestamp);
    lastError = null;
    setStatus(mode === "server" ? "Backup restored to server storage: " + storageLabel : "Backup restored to browser storage only. Start the project with npm start for file-based saving.", mode === "server" ? "good" : "warn");
  }
  async function clearAll() {
    await pending.catch(() => {});
    if (mode === "server") {
      const res = await fetch("/api/state", { method: "DELETE", cache: "no-store" });
      if (!res.ok) throw new Error("Could not clear the project database.");
      await res.json();
      if (commissionerToken) {
        const historyRes = await fetch("/api/historical", { method: "DELETE", headers: { Authorization: "Bearer " + commissionerToken }, cache: "no-store" });
        if (!historyRes.ok) throw new Error("Could not clear archived seasons. Sign in again and retry.");
      }
    }
    for (const key of [...KEYS, HISTORICAL_KEY]) { localStorage.removeItem(key); localStorage.removeItem(TS_PREFIX + key); }
    lastError = null;
  }
  async function commissionerLogin(password) {
    const res = await fetch("/api/commissioner/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }), cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) throw new Error(body.error || "Commissioner sign-in failed.");
    commissionerToken = body.token;
    sessionStorage.setItem("commApiToken", commissionerToken);
    sessionStorage.setItem("commAuthV2", "yes");
    await apiHistoricalGet();
    return body;
  }
  async function commissionerRefresh() { return apiHistoricalGet(); }
  async function archiveSeason(year, history, nextState) {
    if (!commissionerToken) throw new Error("Sign in as commissioner again before archiving a season.");
    if (mode !== "server") throw new Error("Season archiving requires the Node.js server so the archive and new season can be saved together. Start the project with npm start.");
    await flush();
    const res = await fetch("/api/historical/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + commissionerToken },
      body: JSON.stringify({ year: Number(year), history, nextState }),
      cache: "no-store"
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Season archive failed (HTTP ${res.status}).`);
    const timestamp = Number(body.savedAt) || Date.now();
    loadLocal(HISTORICAL_KEY, history, timestamp);
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(nextState, key)) loadLocal(key, nextState[key], timestamp);
    }
    lastError = null;
    setStatus(`Archived season ${year} and started ${Number(year) + 1} in ${storageLabel}.`, "good");
    return body;
  }
  function commissionerLogout() {
    commissionerToken = "";
    sessionStorage.removeItem("commApiToken");
    sessionStorage.removeItem("commAuthV2");
    // Historical records stay on the server but are removed from this browser cache at sign-out.
    localStorage.removeItem(HISTORICAL_KEY);
    localStorage.removeItem(TS_PREFIX + HISTORICAL_KEY);
  }
  window.KFStorage = {
    get mode() { return mode; },
    get lastError() { return lastError; },
    get location() { return storageLabel; },
    write: storageWrite,
    flush,
    refreshFromServer,
    exportState,
    replaceState,
    clearAll,
    commissionerLogin,
    commissionerRefresh,
    archiveSeason,
    commissionerLogout,
    keys: [...KEYS, HISTORICAL_KEY]
  };

  async function start() {
    ensureBanner();
    setStatus("Checking the project database…", "info");
    try {
      const remote = await apiState();
      mode = "server";
      storageLabel = remote.storageLabel || (remote.storageMode === "render" ? "Render persistent disk" : "project file data/league-data.json");
      const work = [];
      for (const key of KEYS) {
        const localValue = parseLocal(key);
        const localTs = localTime(key);
        const hasRemote = Object.prototype.hasOwnProperty.call(remote.state, key);
        const hasRemoteStamp = Object.prototype.hasOwnProperty.call(remote.keyUpdatedAt, key);
        const remoteTs = Number(remote.keyUpdatedAt[key] || 0);
        if (localValue !== null && ((!hasRemote && !hasRemoteStamp) || localTs > remoteTs)) {
          // Local-only data is migrated, and a newer unsynced browser edit wins safely.
          loadLocal(key, localValue, localTs || Date.now());
          work.push(apiPut(key, localValue, localTs || Date.now()));
        } else if (hasRemote) {
          loadLocal(key, remote.state[key], remoteTs);
        } else if (hasRemoteStamp && remoteTs >= localTs) {
          // A timestamp without a value is a saved deletion, not a missing category to migrate.
          localStorage.removeItem(key);
          localStorage.removeItem(TS_PREFIX + key);
        }
      }
      await Promise.all(work);
      setStatus("Connected — changes save to server storage: " + storageLabel, "good");
    } catch (err) {
      mode = "browser";
      setStatus("Browser-only storage is active. To save data inside the project folder, stop Live Server and start this project with npm start.", "warn");
    }
    const script = document.createElement("script");
    script.src = "app.js";
    script.onerror = () => setStatus("Could not load app.js. Make sure this page is opened from the project folder.", "error");
    document.body.appendChild(script);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
