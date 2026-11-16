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
assert.equal(archiveStore.getCurrentYear({}), 2026, "existing installations start with 2026 as the current season year");
assert.deepEqual(archiveStore.listArchivedYears({}).slice(0, 2), [2026, 2025], "the initial commissioner year selector exposes 2026 through 2016");
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
assert.match(commissionerHtml, /id="startNextSeason"[^>]*>Start Next Season/);
assert.match(appSource, /function runStartNextSeason\(\)/);
assert.match(appSource, /KFStorage\.replaceState/);
assert.match(appSource, /activeCurrentSeasonYear\(\)-1/);
assert.match(appSource, /latestArchiveYear=Math\.max\(2026,activeCurrentSeasonYear\(\)-1\)/);
assert.match(appSource, /commissionerSeasonRollover/);
for (let year = 2026; year >= 2016; year--) assert.ok(commissionerHtml.includes(`<option value="${year}">${year}</option>`));
assert.ok(commissionerHtml.includes(`<option value="Current">Current</option>`));
assert.match(appSource, /function changeCommissionerSeason\(year\)/);
assert.ok(appSource.includes(`document.body?.dataset.page==="commissioner"`));
assert.match(appSource, /previousSeasonAverageForAthlete/);
assert.match(bootstrapSource, /kaiserFantasySeasonArchives/);
assert.ok(bootstrapSource.includes("season-archive-store.js"));
assert.match(serverSource, /kaiserFantasySeasonArchives/);
console.log("Season archive integration checks passed: commissioner-only selector, 2016–2026 options, scoped storage routing, previous-year average display, and server backup persistence.");

const rolloverSource = {
  [A]: [{ id: "rider-current", name: "Current Rider", number: "1", class: "450" }],
  [T]: [{ key: "team-current", name: "Team Current", owner: "Owner", passwordHash: "secret", roster: [{ id: "rider-current" }], points: 321 }],
  [S]: [{ id: "score-current", riderId: "rider-current", series: "SMX", event: "Final", round: 17, points: 27, place: 1, recordedAt: "2026-11-15T18:00:00Z" }],
  [TR]: [{ id: "trade-current", status: "accepted", viewedAt: "2026-11-15T19:00:00Z" }],
  [D]: { picks: [{ id: "pick-current", teamKey: "team-current" }] },
  [DS]: { SMX: { status: "Complete", orderTeamKeys: ["team-current"], start: "2026-01-01T00:00:00Z", scheduledStart: "2026-01-01T00:00" } },
  [CAL]: [{ id: "event-current", name: "Final", date: "2026-11-15" }]
};
const beforeRollover = JSON.parse(JSON.stringify(rolloverSource));
const rollover = archiveStore.startNextSeason({}, rolloverSource, { timestamp: "2026-11-16T00:00:00.000Z" });
assert.equal(rollover.archivedYear, 2026);
assert.equal(rollover.currentYear, 2027);
assert.deepEqual(rollover.archives["2026"], beforeRollover, "the complete old current season, including scoring input, is archived without edits");
assert.equal(archiveStore.getCurrentYear(rollover.archives), 2027);
assert.deepEqual(rollover.currentState[A], beforeRollover[A], "the athlete catalogue carries into the new current year");
assert.equal(rollover.currentState[T][0].owner, "Owner", "team ownership carries forward");
assert.equal(rollover.currentState[T][0].passwordHash, "secret", "team login credentials carry forward");
assert.deepEqual(rollover.currentState[T][0].roster, [], "new season rosters start empty");
assert.equal(rollover.currentState[T][0].points, undefined, "old fantasy points do not carry forward");
assert.deepEqual(rollover.currentState[S], [], "new-season scoring entry starts empty while old scoring stays archived");
assert.deepEqual(rollover.currentState[TR], [], "old trades are archived and new-season trade history starts empty");
assert.deepEqual(rollover.currentState[D], { picks: [] }, "old draft picks are archived and new draft picks start empty");
assert.equal(rollover.currentState[DS].SMX.status, "Not started", "draft status resets for the new season");
assert.deepEqual(rollover.currentState[DS].SMX.orderTeamKeys, ["team-current"], "commissioner draft order is retained for the next season");
assert.equal(rollover.currentState[DS].SMX.start, "");
assert.deepEqual(rollover.currentState[CAL], [], "new season schedule starts empty while old schedule remains archived");
assert.deepEqual(archiveStore.listArchivedYears(rollover.archives).slice(0, 2), [2026, 2025]);
assert.equal(archiveStore.listArchivedYears(rollover.archives).at(-1), 2016, "all archive options from 2016 remain available after the rollover");
const secondRollover = archiveStore.startNextSeason(rollover.archives, rollover.currentState, { timestamp: "2027-11-16T00:00:00.000Z" });
assert.equal(secondRollover.archivedYear, 2027, "each subsequent rollover advances from the persisted current year");
assert.equal(secondRollover.currentYear, 2028);
assert.deepEqual(secondRollover.archives["2027"], rollover.currentState);
assert.equal(archiveStore.listArchivedYears(secondRollover.archives)[0], 2027);
const collisionArchive = { "2026": { [A]: [{ id: "independently-entered-2026" }] } };
const collisionRollover = archiveStore.startNextSeason(collisionArchive, rolloverSource, { timestamp: "2026-11-16T00:00:00.000Z" });
assert.equal(collisionRollover.archives._meta.supersededArchives[0].state[A][0].id, "independently-entered-2026", "an existing same-year archive is retained before the live season snapshot replaces its year slot");
console.log("Season rollover tests passed: prior season snapshot preservation, current-year increment, fresh new-season state, carry-forward athlete/team/draft-order configuration, archived scoring/trades/draft/schedule data, and repeated rollover.");
