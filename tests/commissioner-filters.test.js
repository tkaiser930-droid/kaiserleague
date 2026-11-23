"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "commissioner.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

const requiredIds = [
  "commAthleteSearch", "commAthleteSeriesFilter", "commAthleteOwnerFilter",
  "clearCommAthleteFilters", "commAthleteFilterSummary",
  "commScheduleSearch", "commScheduleSeriesFilter", "commScheduleTypeFilter",
  "commScheduleYearFilter", "clearCommScheduleFilters", "commScheduleFilterSummary"
];
for (const id of requiredIds) assert.match(html, new RegExp(`id=["']${id}["']`), `Missing commissioner filter control: ${id}`);

assert.match(app, /function renderCommissionerAthletes\(\)/, "Commissioner athlete filter renderer is missing");
assert.match(app, /athleteSeries\(a\)\.includes\(seriesFilter\)/, "Athlete series filter must include the athlete's series affiliations");
assert.match(app, /ownerFilter==="__free_agent__"\?!team:!!team&&key\(team\)===ownerFilter/, "Athlete owner/free-agent filter is missing");
assert.match(app, /function renderCommSchedule\(\)/, "Commissioner schedule filter renderer is missing");
assert.match(app, /room===seriesFilter/, "Scheduled-event series filter is missing");
assert.match(app, /type===typeFilter/, "Scheduled-event type filter is missing");
assert.match(app, /year===yearFilter/, "Scheduled-event year filter is missing");
assert.match(app, /events\.forEach\(event=>picker\.add\(/, "Scheduled-event edit picker must use the filtered event list");

for (const id of ["commAthleteSearch", "commScheduleSearch"]) {
  assert.ok(app.includes(`$("${id}").addEventListener("input"`), `Search input is not wired: ${id}`);
}
for (const id of ["commAthleteSeriesFilter", "commAthleteOwnerFilter"]) {
  assert.ok(app.includes(`$("${id}").addEventListener("change"`), `Select filter is not wired: ${id}`);
}
assert.match(app, /\["commScheduleSeriesFilter","commScheduleTypeFilter","commScheduleYearFilter"\]\.forEach\(id=>\$\(id\)\.addEventListener\("change",renderCommSchedule\)\)/, "Scheduled event dropdown filters are not wired to the renderer");
for (const id of ["clearCommAthleteFilters", "clearCommScheduleFilters"]) {
  assert.ok(app.includes(`$("${id}").onclick=`), `Clear action is not wired: ${id}`);
}
assert.match(css, /\.commissioner-filter-bar\s*\{/, "Commissioner filter styling is missing");

console.log("Commissioner filter tests passed: athlete search/series/owner filters and scheduled-event search/series/type/year filters are present, wired, and reflected in the edit picker.");
