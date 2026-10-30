(() => {
  "use strict";
  const KEYS = [
    "kaiserFantasyAthletes", "kaiserFantasyTeams", "kaiserFantasyScores",
    "kaiserFantasyTrades", "kaiserFantasyDraftState", "kaiserFantasyDraftSettings",
    "kaiserFantasySchedule"
  ];
  const TS_PREFIX = "__kf_saved_at__";
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
    pending = pending.then(() => apiPut(key, value, updatedAt)).then(() => {
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
      if (!Object.prototype.hasOwnProperty.call(remote.state, key)) continue;
      const remoteTs = Number(remote.keyUpdatedAt[key] || 0);
      const localTs = localTime(key);
      const localValue = parseLocal(key);
      if (remoteTs > localTs || (remoteTs === localTs && JSON.stringify(localValue) !== JSON.stringify(remote.state[key]))) {
        loadLocal(key, remote.state[key], remoteTs);
        changed = true;
      }
    }
    return changed;
  }
  async function exportState() {
    if (mode === "server") {
      await flush();
      return (await apiState()).state;
    }
    const state = {};
    for (const key of KEYS) { const value = parseLocal(key); if (value !== null) state[key] = value; }
    return state;
  }
  async function replaceState(state) {
    // Drain earlier writes before replacing the entire state during backup restore.
    await pending.catch(() => {});
    const filtered = {};
    for (const key of KEYS) if (Object.prototype.hasOwnProperty.call(state, key)) filtered[key] = state[key];
    const timestamp = Date.now();
    if (mode === "server") {
      const res = await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: filtered, updatedAt: timestamp }), cache: "no-store" });
      if (!res.ok) throw new Error("The project database could not replace its saved data.");
      await res.json();
    }
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(filtered, key)) loadLocal(key, filtered[key], timestamp);
      else { localStorage.removeItem(key); localStorage.removeItem(TS_PREFIX + key); }
    }
    lastError = null;
    setStatus(mode === "server" ? "Backup restored to server storage: " + storageLabel : "Backup restored to browser storage only. Start the project with npm start for file-based saving.", mode === "server" ? "good" : "warn");
  }
  async function clearAll() {
    await pending.catch(() => {});
    if (mode === "server") {
      const res = await fetch("/api/state", { method: "DELETE", cache: "no-store" });
      if (!res.ok) throw new Error("Could not clear the project database.");
      await res.json();
    }
    for (const key of KEYS) { localStorage.removeItem(key); localStorage.removeItem(TS_PREFIX + key); }
    lastError = null;
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
    keys: KEYS.slice()
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
        const remoteTs = Number(remote.keyUpdatedAt[key] || 0);
        if (localValue !== null && (!hasRemote || localTs > remoteTs)) {
          // Local-only data is migrated, and a newer unsynced browser edit wins safely.
          loadLocal(key, localValue, localTs || Date.now());
          work.push(apiPut(key, localValue, localTs || Date.now()));
        } else if (hasRemote) {
          loadLocal(key, remote.state[key], remoteTs);
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
