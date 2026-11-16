(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.KFSeasonArchive = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const KEYS = {
    athletes: "kaiserFantasyAthletes",
    teams: "kaiserFantasyTeams",
    scores: "kaiserFantasyScores",
    trades: "kaiserFantasyTrades",
    draftState: "kaiserFantasyDraftState",
    draftSettings: "kaiserFantasyDraftSettings",
    schedule: "kaiserFantasySchedule"
  };
  const META_KEY = "_meta";
  const DEFAULT_CURRENT_YEAR = 2026;
  const FIRST_ARCHIVE_YEAR = 2016;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

  function getCurrentYear(archives, fallback = DEFAULT_CURRENT_YEAR) {
    const value = Number(object(object(archives)[META_KEY]).currentYear);
    return Number.isInteger(value) && value >= FIRST_ARCHIVE_YEAR && value <= 9998 ? value : fallback;
  }

  function listArchivedYears(archives, firstYear = FIRST_ARCHIVE_YEAR) {
    const currentYear = getCurrentYear(archives);
    // The initial setup exposes 2016–2026 as selectable season archives. After
    // each rollover, the completed prior season becomes the newest archive.
    const latestArchiveYear = Math.max(DEFAULT_CURRENT_YEAR, currentYear - 1);
    const present = new Set(Object.keys(object(archives)).filter(key => /^\d{4}$/.test(key) && Number(key) >= firstYear && Number(key) <= latestArchiveYear).map(Number));
    for (let year = firstYear; year <= latestArchiveYear; year++) present.add(year);
    return [...present].sort((a, b) => b - a);
  }

  function createInitialSeason(currentState = {}) {
    const currentTeams = Array.isArray(currentState[KEYS.teams]) ? currentState[KEYS.teams] : [];
    const teams = clone(currentTeams).map(team => {
      const copy = { ...team, roster: [] };
      // Points are calculated from season score records; do not carry the live season's values into an archive.
      ["points", "score", "seasonPoints", "totalPoints"].forEach(field => delete copy[field]);
      return copy;
    });
    return {
      [KEYS.athletes]: clone(Array.isArray(currentState[KEYS.athletes]) ? currentState[KEYS.athletes] : []),
      [KEYS.teams]: teams,
      [KEYS.scores]: [],
      [KEYS.trades]: [],
      [KEYS.draftState]: { picks: [] },
      [KEYS.draftSettings]: {},
      [KEYS.schedule]: []
    };
  }

  function ensureYear(archives, year, currentState = {}) {
    const next = { ...object(archives) };
    const yearKey = String(year);
    const created = !object(next[yearKey]) || !Object.keys(object(next[yearKey])).length;
    const defaults = createInitialSeason(currentState);
    const state = created ? defaults : { ...defaults, ...object(next[yearKey]) };
    next[yearKey] = state;
    return { archives: next, state, created };
  }

  function updateYear(archives, year, key, value, currentState = {}) {
    const ensured = ensureYear(archives, year, currentState);
    const state = { ...ensured.state, [key]: clone(value) };
    return { ...ensured, state, archives: { ...ensured.archives, [String(year)]: state } };
  }

  function createNextSeasonState(currentState = {}) {
    const next = createInitialSeason(currentState);
    const previousSettings = object(currentState[KEYS.draftSettings]);
    const nextSettings = {};
    for (const [room, config] of Object.entries(previousSettings)) {
      if (!config || typeof config !== "object" || Array.isArray(config)) continue;
      // Carry forward the commissioner-configured snake order, but never carry an
      // open/paused/completed draft or its previous start time into a new season.
      nextSettings[room] = {
        ...clone(config),
        status: "Not started",
        start: "",
        scheduledStart: ""
      };
    }
    next[KEYS.draftSettings] = nextSettings;
    return next;
  }

  function startNextSeason(archives, currentState = {}, options = {}) {
    const source = object(archives);
    const meta = object(source[META_KEY]);
    const fromYear = getCurrentYear(source, options.fallbackYear || DEFAULT_CURRENT_YEAR);
    if (fromYear >= 9998) throw new Error("The current season year cannot be incremented any further.");
    const toYear = fromYear + 1;
    const next = { ...source };
    const currentSnapshot = clone(currentState);
    const previousArchive = object(next[String(fromYear)]);
    const retained = Array.isArray(meta.supersededArchives) ? meta.supersededArchives.slice() : [];
    if (Object.keys(previousArchive).length && JSON.stringify(previousArchive) !== JSON.stringify(currentSnapshot)) {
      // A commissioner may have separately populated the same year from the
      // historical selector. Retain that copy inside archive metadata before
      // replacing the year with the authoritative live-season snapshot.
      retained.push({
        year: fromYear,
        retainedAt: options.timestamp || new Date().toISOString(),
        state: clone(previousArchive)
      });
    }
    next[String(fromYear)] = currentSnapshot;
    next[META_KEY] = {
      ...meta,
      currentYear: toYear,
      lastRollover: { fromYear, toYear, completedAt: options.timestamp || new Date().toISOString() },
      supersededArchives: retained
    };
    return {
      archives: next,
      archivedYear: fromYear,
      currentYear: toYear,
      archivedState: currentSnapshot,
      currentState: createNextSeasonState(currentState)
    };
  }

  function roundKey(record, fallbackYear) {
    const series = String(record.series || record.division || record.riderClass || "").trim().toLowerCase();
    if (record.scheduledEventId) return `${series}|scheduled:${record.scheduledEventId}`;
    const event = String(record.event || "").trim().toLowerCase();
    const round = record.round == null ? "" : String(record.round);
    if (event || round) return `${series}|year:${fallbackYear}|event:${event}|round:${round}`;
    return `${series}|group:${record.resultGroupId || record.recordedAt || `${record.division || record.riderClass || "unknown"}-${record.place || "unknown"}`}`;
  }

  function athleteAverage(state, currentAthlete, year) {
    const archived = object(state);
    const roster = Array.isArray(archived[KEYS.athletes]) ? archived[KEYS.athletes] : [];
    const scores = Array.isArray(archived[KEYS.scores]) ? archived[KEYS.scores] : [];
    const id = value => String((value && (value.id ?? value.athleteId)) ?? "");
    const norm = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const name = value => value && (value.name || value.athleteName || value.riderName) || "";
    const cls = value => value && (value.class || value.primarySeries || value.riderClass || value.athleteClass) || "";
    let pastAthlete = null;
    const currentId = id(currentAthlete);
    if (currentId) pastAthlete = roster.find(item => id(item) === currentId) || null;
    if (!pastAthlete) pastAthlete = roster.find(item => norm(name(item)) === norm(name(currentAthlete)) && norm(cls(item)) === norm(cls(currentAthlete))) || null;
    if (!pastAthlete) return { total: 0, rounds: 0, average: 0, records: [], matched: false };
    const pastId = id(pastAthlete);
    const records = scores.filter(record => {
      const byId = pastId && String(record.riderId || record.athleteId || "") === pastId;
      const byName = norm(record.riderName || record.athleteName) === norm(name(pastAthlete)) && (!record.riderClass && !record.athleteClass || norm(record.riderClass || record.athleteClass) === norm(cls(pastAthlete)));
      return Boolean(byId || byName);
    });
    const total = records.reduce((sum, record) => sum + Number(record.points || 0), 0);
    const rounds = new Set(records.map(record => roundKey(record, year))).size;
    return { total, rounds, average: rounds ? total / rounds : 0, records, matched: true };
  }

  return {
    KEYS, META_KEY, DEFAULT_CURRENT_YEAR, FIRST_ARCHIVE_YEAR,
    getCurrentYear, listArchivedYears,
    createInitialSeason, createNextSeasonState,
    ensureYear, updateYear, startNextSeason, athleteAverage
  };
});
