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
  let storageLabel = "GitHub league-data repository";
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
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `GitHub league storage is unavailable (HTTP ${res.status}).`);
    if (!body || typeof body.state !== "object" || !body.keyUpdatedAt) throw new Error("Invalid database response.");
    return body;
  }
  async function apiPut(key, value, updatedAt) {
    const res = await fetch("/api/state/" + encodeURIComponent(key), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, updatedAt }), keepalive: true, cache: "no-store"
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || ("GitHub save failed for " + key + " (HTTP " + res.status + ")."));
    if (result.applied === false) {
      // Another client has a newer value for this category; converge to GitHub.
      const remote = await apiState();
      if (Object.prototype.hasOwnProperty.call(remote.state, key)) {
        loadLocal(key, remote.state[key], Number(remote.keyUpdatedAt[key] || remote.savedAt || 0));
      } else {
        clearLocal(key);
      }
    } else {
      localStorage.removeItem(UNSYNCED_PREFIX + key);
    }
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
  function storageWrite(key, value) {
    const prev = localTime(key);
    const updatedAt = Math.max(Date.now(), prev + 1);
    localStorage.setItem(key, JSON.stringify(value));
    localStorage.setItem(TS_PREFIX + key, String(updatedAt));
    localStorage.setItem(UNSYNCED_PREFIX + key, "1");
    if (mode !== "server") return;
    dirtyKeys.add(key);
    setStatus("Saving changes directly to GitHub…", "saving");
    pending = pending.then(() => apiPut(key, value, updatedAt)).then(() => {
      dirtyKeys.delete(key);
      lastError = null;
      setStatus("Saved to GitHub: " + storageLabel, "good");
    }).catch(err => {
      lastError = err;
      setStatus("GitHub save failed. The browser copy is retained; check GitHub access and retry from Data & Backup.", "error");
      throw err;
    });
    // Mark the queued rejection as handled for the UI; flush() still reports it through lastError.
    pending = pending.catch(err => { lastError = err; });
  }
  async function flush() {
    await pending;
    if (mode === "server" && dirtyKeys.size) {
      for (const key of [...dirtyKeys]) {
        const value = parseLocal(key);
        if (value === null) continue;
        try {
          await apiPut(key, value, localTime(key) || Date.now());
          dirtyKeys.delete(key);
          lastError = null;
        } catch (error) {
          lastError = error;
          throw error;
        }
      }
    }
    if (lastError) throw lastError;
  }
  async function loadServerState() {
    if (mode !== "server") throw new Error("GitHub storage is not connected in this browser.");
    const remote = await apiState();
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(remote.state, key)) {
        loadLocal(key, remote.state[key], Number(remote.keyUpdatedAt[key] || remote.savedAt || 0));
      } else {
        clearLocal(key);
      }
    }
    dirtyKeys.clear();
    lastError = null;
    setStatus("Loaded the latest GitHub save: " + storageLabel, "good");
    return true;
  }
  async function refreshFromServer() {
    if (mode !== "server") return false;
    await flush();
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
        clearLocal(key);
        changed = true;
      }
    }
    return changed;
  }
  async function exportState() {
    lastExportUsedBrowserCopy = false;
    const browserState = {};
    for (const key of KEYS) {
      const value = parseLocal(key);
      if (value !== null) browserState[key] = value;
    }
    if (mode === "server") {
      try {
        await flush();
        return (await apiState()).state;
      } catch (error) {
        // Keep the portable download available even when GitHub is temporarily offline.
        lastExportUsedBrowserCopy = true;
        if (Object.keys(browserState).length) return browserState;
        throw error;
      }
    }
    return browserState;
  }
  async function replaceState(state) {
    // Drain earlier writes before replacing the entire state during backup restore.
    await pending.catch(() => {});
    const filtered = {};
    for (const key of KEYS) if (Object.prototype.hasOwnProperty.call(state, key)) filtered[key] = state[key];
    const timestamp = Date.now();
    if (mode === "server") {
      const res = await fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: filtered, updatedAt: timestamp }), cache: "no-store" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "The GitHub league save could not be replaced.");
    }
    for (const key of KEYS) {
      if (Object.prototype.hasOwnProperty.call(filtered, key)) loadLocal(key, filtered[key], timestamp, mode !== "server");
      else { clearLocal(key); if (mode !== "server") localStorage.setItem(UNSYNCED_PREFIX + key, "1"); }
    }
    dirtyKeys.clear();
    lastError = null;
    setStatus(mode === "server" ? "Backup restored and saved to GitHub: " + storageLabel : "Backup restored to this browser only. Download a JSON copy and reconnect to GitHub to share it.", mode === "server" ? "good" : "warn");
  }
  async function clearAll() {
    await pending.catch(() => {});
    if (mode === "server") {
      const res = await fetch("/api/state", { method: "DELETE", cache: "no-store" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || "Could not clear the GitHub league save.");
    }
    for (const key of KEYS) clearLocal(key);
    dirtyKeys.clear();
    lastError = null;
  }
  window.KFStorage = {
    get mode() { return mode; },
    get lastError() { return lastError; },
    get lastExportUsedBrowserCopy() { return lastExportUsedBrowserCopy; },
    get location() { return storageLabel; },
    write: storageWrite,
    flush,
    refreshFromServer,
    loadServerState,
    exportState,
    replaceState,
    clearAll,
    keys: KEYS.slice()
  };

  async function start() {
    ensureBanner();
    setStatus("Connecting to the GitHub league database…", "info");
    try {
      const remote = await apiState();
      mode = "server";
      storageLabel = remote.storageLabel || "GitHub league-data repository";
      const work = [];
      for (const key of KEYS) {
        const localValue = parseLocal(key);
        const localTs = localTime(key);
        const hasRemote = Object.prototype.hasOwnProperty.call(remote.state, key);
        const hasRemoteStamp = Object.prototype.hasOwnProperty.call(remote.keyUpdatedAt, key);
        const remoteTs = Number(remote.keyUpdatedAt[key] || 0);
        const hasUnsyncedLocalEdit = localStorage.getItem(UNSYNCED_PREFIX + key) === "1";
        if (localValue !== null && (hasUnsyncedLocalEdit || (!hasRemote && !hasRemoteStamp))) {
          // Only explicitly marked unsynced edits may override GitHub. A stale browser cache
          // with a newer local clock must never replace the canonical repository copy.
          const updatedAt = localTs || Date.now();
          loadLocal(key, localValue, updatedAt, true);
          work.push(apiPut(key, localValue, updatedAt));
        } else if (hasRemote) {
          loadLocal(key, remote.state[key], remoteTs);
        } else {
          // A timestamp without a value is a saved deletion. Missing categories on GitHub
          // are not migrated from an old browser cache unless they carry an unsynced marker.
          clearLocal(key);
        }
      }
      await Promise.all(work);
      setStatus("Connected — all shared league changes save directly to GitHub: " + storageLabel, "good");
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
