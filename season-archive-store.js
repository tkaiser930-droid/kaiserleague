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
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};

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

  return { KEYS, createInitialSeason, ensureYear, updateYear, athleteAverage };
});
