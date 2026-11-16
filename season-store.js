(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KFSeasonStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const validYear = value => /^20(?:1\d|2\d|3\d|4\d|5\d|6\d|7\d|8\d|9\d)$/.test(String(value));

  function shiftIsoYear(value, targetYear) {
    const text = String(value || "");
    const match = text.match(/^\d{4}-(\d{2})-(\d{2})(.*)$/);
    if (!validYear(targetYear) || !match) return text;
    const month = Number(match[1]);
    const requestedDay = Number(match[2]);
    if (month < 1 || month > 12 || requestedDay < 1 || requestedDay > 31) return text;
    const lastDay = new Date(Date.UTC(Number(targetYear), month, 0)).getUTCDate();
    const day = Math.min(requestedDay, lastDay);
    return `${targetYear}-${match[1]}-${String(day).padStart(2, "0")}${match[3]}`;
  }

  function createRouter(options) {
    const {
      historyKey,
      keys,
      readRaw,
      writeRaw,
      getActiveYear,
      getSelectedYear,
      isCommissioner
    } = options;
    if (!historyKey || !Array.isArray(keys) || typeof readRaw !== "function" || typeof writeRaw !== "function") {
      throw new Error("Season router requires a history key, season keys, and raw read/write functions.");
    }

    function readHistory() {
      const saved = readRaw(historyKey, null);
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return { version: 1, seasons: {} };
      return {
        ...saved,
        version: 1,
        seasons: saved.seasons && typeof saved.seasons === "object" && !Array.isArray(saved.seasons) ? saved.seasons : {}
      };
    }

    function writeHistory(history) {
      writeRaw(historyKey, history);
      return history;
    }

    function isHistoricalContext() {
      return typeof isCommissioner === "function" && isCommissioner()
        && String(getSelectedYear()) !== String(getActiveYear());
    }

    function read(key, fallback) {
      if (!keys.includes(key) || !isHistoricalContext()) return readRaw(key, fallback);
      const year = String(getSelectedYear());
      const state = readHistory().seasons?.[year]?.state;
      return state && Object.prototype.hasOwnProperty.call(state, key) ? clone(state[key]) : fallback;
    }

    function write(key, value) {
      if (!keys.includes(key) || !isHistoricalContext()) return writeRaw(key, value);
      const year = String(getSelectedYear());
      const history = readHistory();
      const record = history.seasons[year] && typeof history.seasons[year] === "object"
        ? history.seasons[year]
        : { year: Number(year), status: "workspace", state: {} };
      record.state = record.state && typeof record.state === "object" ? record.state : {};
      record.state[key] = clone(value);
      record.updatedAt = new Date().toISOString();
      history.seasons[year] = record;
      return writeHistory(history);
    }

    function getYearState(year, activeState, fallbackState = {}) {
      const target = String(year);
      if (target === String(getActiveYear())) return clone(activeState || {});
      const record = readHistory().seasons?.[target];
      return record?.state && typeof record.state === "object" ? clone(record.state) : clone(fallbackState);
    }

    function setYearState(year, state, metadata = {}) {
      const target = String(year);
      if (!validYear(target) || !state || typeof state !== "object" || Array.isArray(state)) {
        throw new Error("A valid year and season state object are required.");
      }
      if (target === String(getActiveYear())) {
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(state, key)) writeRaw(key, clone(state[key]));
        }
        return state;
      }
      const history = readHistory();
      const prior = history.seasons[target] || {};
      history.seasons[target] = {
        ...prior,
        ...metadata,
        year: Number(target),
        status: metadata.status || prior.status || "workspace",
        state: clone(state),
        updatedAt: new Date().toISOString()
      };
      writeHistory(history);
      return state;
    }

    function archiveYear(year, state, archivedAt = new Date().toISOString()) {
      const target = String(year);
      if (!validYear(target)) throw new Error("A valid season year is required for archiving.");
      const history = readHistory();
      const prior = history.seasons[target] || {};
      history.seasons[target] = {
        ...prior,
        year: Number(target),
        status: "archived",
        archived: true,
        archivedAt,
        state: clone(state),
        updatedAt: archivedAt
      };
      writeHistory(history);
      return history.seasons[target];
    }

    function getSeasonRecord(year) {
      const record = readHistory().seasons?.[String(year)];
      return record ? clone(record) : null;
    }

    return {
      read,
      write,
      readHistory,
      writeHistory,
      getYearState,
      setYearState,
      archiveYear,
      getSeasonRecord,
      isHistoricalContext
    };
  }

  return { clone, shiftIsoYear, createRouter };
});
