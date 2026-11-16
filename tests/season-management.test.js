const assert = require('node:assert/strict');
const { createRouter, shiftIsoYear, clone } = require('../season-store');

const ACTIVE = '2027';
let selected = ACTIVE;
let authorized = true;
const raw = {
  athletes: [{ id: 'r1', name: 'Rider One', number: '18', raceTeam: 'Current Team' }],
  teams: [{ key: 'team-1', name: 'Team One', roster: [] }],
  scores: [{ id: 's1', riderId: 'r1', points: 42, recordedAt: '2027-02-01T00:00:00.000Z' }],
  schedule: [{ id: 'event-1', name: 'Current GP', date: '2027-02-01' }],
  history: null
};
const readRaw = (key, fallback) => Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== null ? clone(raw[key]) : fallback;
const writeRaw = (key, value) => { raw[key] = clone(value); };
const router = createRouter({
  historyKey: 'history',
  keys: ['athletes', 'teams', 'scores', 'schedule'],
  readRaw, writeRaw,
  getActiveYear: () => ACTIVE,
  getSelectedYear: () => selected,
  isCommissioner: () => authorized
});

// Historical writes are routed to the private history bucket and never mutate the live keys.
selected = '2026';
assert.deepEqual(router.read('scores', []), []);
router.write('scores', [{ id: 'old-score', riderId: 'r1', points: 15 }]);
assert.equal(raw.scores[0].points, 42, 'live season scores must remain unchanged');
assert.equal(router.getSeasonRecord('2026').state.scores[0].points, 15);

// Rider identity and season-specific metadata are independent between years.
router.write('athletes', [{ id: 'r1', name: 'Rider One', number: '7', raceTeam: 'Previous Team' }]);
assert.equal(raw.athletes[0].number, '18');
assert.equal(router.read('athletes', [])[0].raceTeam, 'Previous Team');

// Active-year writes still use the original persistence keys.
selected = ACTIVE;
router.write('scores', [{ id: 'new-score', points: 77 }]);
assert.equal(raw.scores[0].points, 77);

// Archive snapshots are deep copies and do not share object references with the live season.
router.archiveYear(ACTIVE, { athletes: raw.athletes, scores: raw.scores });
raw.athletes[0].number = '99';
assert.equal(router.getSeasonRecord(ACTIVE).state.athletes[0].number, '18');
assert.equal(router.getSeasonRecord(ACTIVE).status, 'archived');

// Date copying changes the year while preserving month/day and time components.
assert.equal(shiftIsoYear('2026-05-30', '2027'), '2027-05-30');
assert.equal(shiftIsoYear('2026-05-30T15:30:00.000Z', '2027'), '2027-05-30T15:30:00.000Z');
assert.equal(shiftIsoYear('2024-02-29', '2025'), '2025-02-28', 'copying a leap-day event into a non-leap year clamps to the last valid day');
assert.equal(shiftIsoYear('2023-02-28', '2024'), '2024-02-28');
assert.equal(shiftIsoYear('not-a-date', '2027'), 'not-a-date');

// Non-commissioner views can never route reads into archived data.
authorized = false;
selected = '2026';
assert.equal(router.read('scores', [])[0].points, 77, 'public mode must remain on the live season');

console.log('Season management tests passed.');
