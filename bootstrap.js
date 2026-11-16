(() => {
  "use strict";
  const KEYS = [
    "kaiserFantasyAthletes", "kaiserFantasyTeams", "kaiserFantasyScores",
    "kaiserFantasyTrades", "kaiserFantasyDraftState", "kaiserFantasyDraftSettings",
    "kaiserFantasySchedule", "kaiserFantasySeasonArchives"
  ];
  const TS_PREFIX = "__kf_saved_at__";
  let mode = "browser";
  let pending = Promise.resolve();
  let lastError = null;
  let statusNode = null;
  let storageLabel = "project file data/league-data.json";
  let serverMode = "";
  let githubBackup = null;
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
      const primaryName = serverMode === "render" ? "Render persistent disk" : "local project database";
      if (githubBackup?.automaticSaveEnabled) {
        setStatus(`Saved to ${primaryName}; automatic GitHub backup queued for ${githubBackup.repository}.`, "good");
      } else {
        setStatus(`Saved to ${primaryName}, but automatic GitHub backup is NOT active. Check GITHUB_TOKEN and GITHUB_AUTO_BACKUP in the server environment.`, "warn");
      }
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
  async function flushBoth() {
    await flush();
    if (mode !== "server") throw new Error("This page is in browser-only mode. It is not connected to Render or GitHub. Open the Render-hosted site or start the Node server with npm start.");
    const response = await fetch("/api/storage/flush", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store"
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || `Dual save failed (HTTP ${response.status}).`);
    lastError = null;
    const target = serverMode === "render" ? "Render persistent disk" : "local project database";
    setStatus(`Saved to ${target} and confirmed GitHub backup to ${result.githubRepository || githubBackup?.repository || "the configured repository"}.`, "good");
    return result;
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
    if (mode === "server") {
      const primaryName = serverMode === "render" ? "Render persistent disk" : "local project database";
      setStatus(githubBackup?.automaticSaveEnabled ? `Backup restored to ${primaryName}; automatic GitHub backup queued for ${githubBackup.repository}.` : `Backup restored to ${primaryName}, but automatic GitHub backup is NOT active.`, githubBackup?.automaticSaveEnabled ? "good" : "warn");
    } else {
      setStatus("Backup restored to this browser only. It is NOT saved to Render or GitHub. Open the Render-hosted site or start the Node server with npm start.", "warn");
    }
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
    get serverMode() { return serverMode; },
    get githubBackup() { return githubBackup ? { ...githubBackup } : null; },
    write: storageWrite,
    flush,
    flushBoth,
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
      serverMode = remote.storageMode || "local";
      githubBackup = remote.githubBackup || null;
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
      const primaryName = serverMode === "render" ? "Render persistent disk" : "local project database";
      if (githubBackup?.automaticSaveEnabled) {
        setStatus(`Connected to ${primaryName}. Automatic GitHub backup is configured for ${githubBackup.repository}; the Data & Backup page can confirm a completed mirror.`, "good");
      } else {
        setStatus(`Connected to ${primaryName}, but GitHub automatic backup is NOT active. Configure GITHUB_TOKEN and GITHUB_AUTO_BACKUP=true on the server.`, "warn");
      }
    } catch (err) {
      mode = "browser";
      serverMode = "";
      githubBackup = null;
      setStatus("Browser-only storage is active. Changes are NOT being saved to Render or GitHub. Stop VS Code Live Server and run npm start for local server storage, or open the Render-hosted website for shared Render + GitHub saving.", "warn");
    }
    const seasonHelper = document.createElement("script");
    seasonHelper.src = "season-archive-store.js";
    seasonHelper.onload = () => {
      const script = document.createElement("script");
      script.src = "app.js";
      script.onerror = () => setStatus("Could not load app.js. Make sure this page is opened from the project folder.", "error");
      document.body.appendChild(script);
    };
    seasonHelper.onerror = () => setStatus("Could not load season-archive-store.js. Refresh the project files and try again.", "error");
    document.body.appendChild(seasonHelper);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
