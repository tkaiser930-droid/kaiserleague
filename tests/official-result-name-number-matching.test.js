"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const start = appSource.indexOf("function matchOfficialResultAthlete(row){");
const end = appSource.indexOf("\nfunction renderOfficialResultsPreview()", start);
assert.ok(start >= 0 && end > start, "could locate the official result athlete matcher in app.js");
const matcherSource = appSource.slice(start, end);

let currentSeries = "SMX";
let currentDivision = "250";
let currentAthletes = [];
let blockedIds = new Set();
const sandbox = {
  $: selector => selector === "scoreSeries" ? { value: currentSeries } : selector === "scoreClass" ? { value: currentDivision } : null,
  athletes: () => currentAthletes,
  athleteEligibleForScoring: () => true,
  name: athlete => String(athlete.name || athlete.riderName || "Unnamed athlete"),
  id: athlete => String(athlete.id),
  clean: value => String(value ?? "").trim(),
  normalizeImportedRiderName: value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  importedAthleteNumber: value => {
    const raw = String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/^#+/, "").replace(/\s+/g, "");
    const numeric = raw.match(/^0*(\d+)([A-Z]?)$/);
    return numeric ? `${Number(numeric[1])}${numeric[2]}` : raw.replace(/[^A-Z0-9]/g, "");
  },
  alreadyScoredAthleteIds: () => blockedIds,
  currentScoringScope: () => ({}),
  editingScoreGroupKey: ""
};
const matchOfficialResultAthlete = vm.runInNewContext(`${matcherSource}\nmatchOfficialResultAthlete`, sandbox);

const seriesCases = [
  ["SMX", "250"], ["SMX", "450"], ["Triple Crown Series", "CAN 450"],
  ["MXGP", "MXGP"], ["MXON", "MXON MXGP"], ["F1", "F1"], ["MotoGP", "MotoGP"]
];
for (const [series, division] of seriesCases) {
  currentSeries = series;
  currentDivision = division;
  const correctAthlete = { id: `${series}-correct`, name: "Correct Name Rider", number: "18", primarySeries: division };
  const otherAthlete = { id: `${series}-other`, name: "Different Rider", number: "27", primarySeries: division };
  currentAthletes = [correctAthlete, otherAthlete];
  blockedIds = new Set();
  const result = matchOfficialResultAthlete({ name: "Correct Name Rider", number: "27" });
  assert.equal(result.athlete?.id, correctAthlete.id, `${series}: exact name must win when official number is wrong`);
  assert.equal(result.state, "matched", `${series}: number mismatch must not block a correct name match`);
  assert.equal(result.numberDiffers, true, `${series}: number mismatch must be shown for review`);
  assert.match(result.status, /official #27 differs from league #18/);
}

// Name-only / number-only source rows and non-exact name variants still work.
currentSeries = "F1";
currentDivision = "F1";
currentAthletes = [
  { id: "driver-a", name: "Alex Example", number: "11", primarySeries: "F1" },
  { id: "driver-b", name: "Jamie Example", number: "22", primarySeries: "F1" }
];
blockedIds = new Set();
let result = matchOfficialResultAthlete({ name: "Alex Example", number: "" });
assert.equal(result.athlete?.id, "driver-a", "name-only official rows still match");
assert.equal(result.state, "matched");
result = matchOfficialResultAthlete({ name: "Unknown Official Spelling", number: "22" });
assert.equal(result.athlete?.id, "driver-b", "unique number remains a fallback when the name does not match");
assert.equal(result.matchedByNumber, true);
result = matchOfficialResultAthlete({ name: "", number: "11" });
assert.equal(result.athlete?.id, "driver-a", "number-only rows still match");

// Duplicate names may be disambiguated by number, but a number may not
// redirect an ambiguous name to an athlete with a different name.
currentAthletes = [
  { id: "same-11", name: "Taylor Rider", number: "11", primarySeries: "F1" },
  { id: "same-22", name: "Taylor Rider", number: "22", primarySeries: "F1" },
  { id: "different-33", name: "Other Rider", number: "33", primarySeries: "F1" }
];
result = matchOfficialResultAthlete({ name: "Taylor Rider", number: "22" });
assert.equal(result.athlete?.id, "same-22", "race number disambiguates duplicate exact names");
result = matchOfficialResultAthlete({ name: "Taylor Rider", number: "33" });
assert.equal(result.athlete, null, "conflicting number cannot redirect duplicate name to another athlete");
assert.equal(result.state, "unmatched");
assert.equal(result.status, "Name is ambiguous");

// Already-scored protection remains in force after matching.
currentAthletes = [{ id: "blocked-driver", name: "Blocked Driver", number: "44", primarySeries: "F1" }];
blockedIds = new Set(["blocked-driver"]);
result = matchOfficialResultAthlete({ name: "Blocked Driver", number: "99" });
assert.equal(result.athlete?.id, "blocked-driver");
assert.equal(result.state, "blocked");

console.log("Official result matching tests passed: exact name precedence despite a wrong number across SMX, TCS, MXGP, MXON, F1 and MotoGP; name/number fallback; duplicate-name disambiguation; and already-scored protection.");
