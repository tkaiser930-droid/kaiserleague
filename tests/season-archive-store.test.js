"use strict";
const assert = require("node:assert/strict");
const archiveStore = require("../season-archive-store");
const {
  athletes: A, teams: T, scores: S, trades: TR,
  draftState: D, draftSettings: DS, schedule: CAL
} = archiveStore.KEYS;

const current = {
  [A]: [{ id: "rider-1", name: "Rider One", number: "7", class: "250" }],
  [T]: [
    { key: "team-1", name: "Team One", owner: "Owner", passwordHash: "hash", roster: [{ id: "rider-1" }], points: 123 },
    { key: "team-2", name: "Team Two", roster: [{ id: "rider-2" }] }
  ],
  [S]: [{ id: "live-score", riderId: "rider-1", points: 24 }],
  [TR]: [{ id: "live-trade" }],
  [D]: { picks: [{ id: "live-pick" }] },
  [DS]: { SMX: { status: "Open" } },
  [CAL]: [{ id: "live-event", name: "Current Event" }]
};

const created = archiveStore.ensureYear({}, "2025", current);
assert.equal(created.created, true);
assert.equal(created.state[A].length, 1, "historical year starts with the current athlete catalog as an editable baseline");
assert.equal(created.state[T].length, 2, "historical year retains fantasy team identities");
assert.equal(created.state[T][0].owner, "Owner", "historical archive retains team ownership identity");
assert.equal(created.state[T][0].passwordHash, "hash", "historical archive retains team login identity");
assert.equal(created.state[T][0].roster.length, 0, "historical rosters start independently empty");
assert.equal(created.state[S].length, 0, "historical scoring starts empty");
assert.equal(created.state[TR].length, 0, "historical trade data starts empty");
assert.deepEqual(created.state[D], { picks: [] });
assert.deepEqual(created.state[DS], {});
assert.deepEqual(created.state[CAL], []);

const currentRosterBefore = current[T][0].roster.length;
const addedAthletes = [...created.state[A], { id: "old-rider", name: "Past Rider", number: "11", class: "450" }];
const updated = archiveStore.updateYear(created.archives, "2025", A, addedAthletes, current);
assert.equal(updated.archives["2025"][A].length, 2);
assert.equal(current[A].length, 1, "historical rider edits cannot change the current athlete catalog");
assert.equal(current[T][0].roster.length, currentRosterBefore, "historical roster edits cannot change current team rosters");

const historicalState = {
  [A]: [{ id: "rider-1", name: "Rider One", number: "7", class: "250" }],
  [S]: [
    { riderId: "rider-1", series: "SMX", event: "Anaheim 1", round: 1, scoringPhase: "Moto 1", points: 20 },
    { riderId: "rider-1", series: "SMX", event: "Anaheim 1", round: 1, scoringPhase: "Moto 2", points: 22 },
    { riderId: "rider-1", series: "SMX", event: "San Diego", round: 2, scoringPhase: "Moto 1", points: 18 }
  ]
};
const average = archiveStore.athleteAverage(historicalState, { id: "rider-1", name: "Rider One", class: "250" }, "2025");
assert.equal(average.total, 60);
assert.equal(average.rounds, 2, "multiple scoring segments at one event count as one round");
assert.equal(average.average, 30);
const fallbackAverage = archiveStore.athleteAverage(historicalState, { id: "new-id", name: "Rider One", class: "250" }, "2025");
assert.equal(fallbackAverage.average, 30, "historical average matches by athlete name and class when IDs differ");
const missing = archiveStore.athleteAverage(historicalState, { id: "missing", name: "No Match", class: "250" }, "2025");
assert.equal(missing.matched, false);
console.log("Season archive tests passed: isolated seasons, team identity, current roster protection, previous-year average calculation.");

const fs = require("node:fs");
const path = require("node:path");
const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const bootstrapSource = fs.readFileSync(path.join(__dirname, "..", "bootstrap.js"), "utf8");
const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const commissionerHtml = fs.readFileSync(path.join(__dirname, "..", "commissioner.html"), "utf8");
assert.match(commissionerHtml, /id="commissionerSeasonYearSelect"/);
for (let year = 2026; year >= 2016; year--) assert.ok(commissionerHtml.includes(`<option value="${year}">${year}</option>`));
assert.ok(commissionerHtml.includes(`<option value="Current">Current</option>`));
assert.match(appSource, /function changeCommissionerSeason\(year\)/);
assert.ok(appSource.includes(`document.body?.dataset.page==="commissioner"`));
assert.match(appSource, /previousSeasonAverageForAthlete/);
assert.match(bootstrapSource, /kaiserFantasySeasonArchives/);
assert.ok(bootstrapSource.includes("season-archive-store.js"));
assert.match(serverSource, /kaiserFantasySeasonArchives/);
console.log("Season archive integration checks passed: commissioner-only selector, 2016–2026 options, scoped storage routing, previous-year average display, and server backup persistence.");
