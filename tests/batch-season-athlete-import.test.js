"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const app = fs.readFileSync(require.resolve("../app.js"), "utf8");
const html = fs.readFileSync(require.resolve("../commissioner.html"), "utf8");
const server = fs.readFileSync(require.resolve("../server.js"), "utf8");
const resultsSource = fs.readFileSync(require.resolve("../race-results-import.js"), "utf8");

for (const id of ["batchSeasonResultsTools", "researchBatchRaceTeams", "applyBatchSeasonAthletes", "batchSeasonResultsTable", "batchTeamResearchResults"]) {
  assert(html.includes(`id="${id}"`), `commissioner results preview must include ${id}`);
assert(html.includes("Load Matched Positions into Scoring Table") && html.includes("Record Race Results"), "athlete setup step explains how to continue into the normal race-scoring flow");
}
assert(app.includes("function batchResultDivision"), "batch athlete import resolves the active scoring class");
assert(app.includes("function batchResultAthleteMatch"), "batch athlete import matches existing athletes before creating new profiles");
assert(app.includes("function applyBatchSeasonAthletesFromResults"), "batch application creates new athletes and updates existing ones");
assert(app.includes("function batchSeasonImportScope()"), "batch changes are tied to the exact season and scoring scope used for the imported results");
assert(app.includes("batchSeasonScopeSnapshot=batchSeasonImportScope()"), "the batch scope is captured when a result preview successfully loads");
assert(app.includes("batchSeasonScopeSnapshot!==batchSeasonImportScope()"), "team research and athlete changes are blocked if the year, series, class, event, round or session changes after preview");
assert(app.includes("changed.set(oldId,updated)"), "updates are collected by stable athlete ID");
assert(app.includes("changed.get(id(rider))"), "batch changes propagate to team-roster copies");
assert(app.includes("row.number=number"), "confirmed batch plate changes flow back into the result matcher");
assert(server.includes("/api/commissioner/team-research") && server.includes("requireCommissioner(req)"), "online team research is commissioner-authenticated");
assert(server.includes("researchRaceTeam({ name, number, series, division, year, knownTeams })"), "team research includes season, series, class, number and existing team names");
assert(resultsSource.includes("manufacturer: manufacturerIndex >= 0") && resultsSource.includes("division: divisionIndex >= 0"), "official CSV parsing preserves manufacturer and row class for batch creation");

const context = {
  scoringSeries: "SMX", scoringClass: "250", scoringPhase: "",
  $: id => ({ value: id === "scoreSeries" ? context.scoringSeries : context.scoringClass }),
  clean: value => String(value ?? "").trim(),
  norm: value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  normalizeImportedRiderName: value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""),
  importedAthleteNumber: value => String(value ?? "").replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, ""),
  athleteNumberForSeries: (athlete, series) => {
    const primary = String(athlete.primarySeries || athlete.class || "");
    if (series === primary) return String(athlete.number || "");
    return String(athlete.secondaryNumbers?.[series] || athlete.number || "");
  },
  athleteSeries: athlete => [String(athlete.primarySeries || athlete.class || ""), ...(athlete.secondarySeries || [])],
  athletes: () => context.currentAthletes,
  id: athlete => String(athlete.id || `${athlete.name}-${athlete.primarySeries || athlete.class}`),
  name: athlete => String(athlete.name || ""),
  cls: athlete => String(athlete.primarySeries || athlete.class || ""),
  SERIES: ["250", "450", "MXGP", "MX2", "CAN 250", "CAN 450", "F1", "MotoGP"]
};
context.currentAthletes = [
  { id: "rider-1", name: "Rider One", number: "5", primarySeries: "250", class: "250", secondarySeries: ["450"], secondaryNumbers: { "450": "105" }, raceTeam: "Old Team" },
  { id: "rider-2", name: "Rider Two", number: "19", primarySeries: "MX2", class: "MX2", secondarySeries: ["250"], secondaryNumbers: { "250": "109" } },
  { id: "rider-3", name: "Rider Three", number: "28", primarySeries: "250", class: "250", secondarySeries: [] }
];
const helpers = app.slice(app.indexOf("function batchResultDivision("), app.indexOf("function renderBatchSeasonResultsTools("));
assert(helpers.includes("function batchResultDivision") && helpers.includes("function batchResultAthleteMatch"), "batch matching helper source is available");
vm.runInNewContext(`${helpers}; globalThis.batchResultDivision=batchResultDivision; globalThis.batchResultAthleteMatch=batchResultAthleteMatch;`, context);
let result = context.batchResultAthleteMatch({ name: "Rider One", number: "8" });
assert.equal(result.state, "update", "name-matched riders can be renumbered");
assert.equal(result.oldNumber, "5");
result = context.batchResultAthleteMatch({ name: "Rider Two", number: "111" });
assert.equal(result.state, "update", "multi-series riders can update the selected secondary class number");
assert.equal(result.division, "250");
result = context.batchResultAthleteMatch({ name: "New Rider", number: "77" });
assert.equal(result.state, "create", "unknown number/name pairs are planned as new athletes");
result = context.batchResultAthleteMatch({ name: "Another Rider", number: "28" });
assert.equal(result.state, "conflict", "the importer will not overwrite another athlete when a plate number conflicts");

const scopeContext = {
  selectedSeasonYear: 2027,
  activeSeasonYear: () => 2027,
  currentScoringScope: () => scopeContext.scope,
  scope: { series: "SMX", division: "250", event: "Anaheim 1", round: "1", scoringPhase: "Moto 1" }
};
const scopeHelper = app.slice(app.indexOf("function batchSeasonImportScope()"), app.indexOf("function officialSourceInfo()"));
vm.runInNewContext(`${scopeHelper}; globalThis.batchSeasonImportScope=batchSeasonImportScope;`, scopeContext);
const originalBatchScope = scopeContext.batchSeasonImportScope();
scopeContext.scope = { ...scopeContext.scope, division: "450" };
assert.notEqual(scopeContext.batchSeasonImportScope(), originalBatchScope, "changing the selected scoring class invalidates the batch preview snapshot");
scopeContext.scope = { ...scopeContext.scope, division: "250" };
scopeContext.selectedSeasonYear = 2026;
assert.notEqual(scopeContext.batchSeasonImportScope(), originalBatchScope, "changing the selected season invalidates the batch preview snapshot");

console.log("Batch season athlete import tests passed: create/update matching, primary and secondary number updates, collision safety, roster-copy updates, season/scope validation and commissioner-only online team research.");
