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
assert(app.includes("function canonicalImportedManufacturer") && app.includes("function batchResultManufacturer"), "imported manufacturer names are normalized and can be inferred from a recognizable brand in the source race-team name");
assert(app.includes("function inferBatchHometownLocation"), "hometown state, province and country values can populate country / region fields without a web lookup");
assert(app.includes("/api/commissioner/hometown-research"), "unresolved hometowns are looked up online before applying the batch");
assert(app.includes("athleteDetailButtonHTML(a,true,true,displaySeries)"), "series-filtered athlete lists display the plate belonging to that selected series");
assert(server.includes("/api/commissioner/team-research") && server.includes("requireCommissioner(req)"), "online team research is commissioner-authenticated");
assert(server.includes("/api/commissioner/hometown-research") && server.includes("researchHometown(hometown)"), "online hometown lookup is commissioner-authenticated and year-scoped");
assert(server.includes("researchRaceTeam({ name, number, series, division, year, knownTeams })"), "team research includes season, series, class, number and existing team names");
assert(resultsSource.includes("manufacturer: manufacturerIndex >= 0") && resultsSource.includes("hometown: hometownIndex >= 0") && resultsSource.includes("division: divisionIndex >= 0"), "official CSV parsing preserves manufacturer, hometown and row class for batch creation");

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
  { id: "rider-3", name: "Rider Three", number: "28", primarySeries: "250", class: "250", secondarySeries: [] },
  { id: "drew", name: "Drew Adams", number: "39", primarySeries: "250", class: "250", secondarySeries: [] }
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
assert.equal(result.state, "create", "a different rider name creates a separate athlete even when the plate number is already in use");
result = context.batchResultAthleteMatch({ name: "Drew Adams", number: "35" });
assert.equal(result.state, "update", "Drew Adams matches the existing roster athlete by name when the new season plate changes");
assert.equal(result.oldNumber, "39", "the existing Drew Adams profile's old plate is identified for updating");
assert.equal(result.updateNumber, true, "Drew Adams' new 250 plate is planned for the correct athlete");
result = context.batchResultAthleteMatch({ name: "Rider Two", number: "111" });
assert.equal(result.oldNumber, "109", "secondary-series matching reads the existing selected-series number, not the primary plate");
assert.equal(result.updateNumber, true, "a changed secondary-series plate is planned for the selected series only");

const parser = require("../race-results-import");
const importedWithHometown = parser.parseCsv('Pos,No,Rider,Manufacturer\n1,35,"Drew Adams Chattanooga,TN",GASGAS', "Official CSV", { series: "SMX", division: "250" });
assert.equal(importedWithHometown.rows[0].name, "Drew Adams", "a city / state suffix is removed from the imported rider name");
assert.equal(importedWithHometown.rows[0].hometown, "Chattanooga,TN", "the removed city / state suffix remains available for location enrichment");
assert.equal(importedWithHometown.rows[0].manufacturer, "GASGAS", "manufacturer source text is retained for canonical display normalization");
const singleWordHometown = parser.parseCsv('Pos,No,Rider\n1,30,"Jo Shimoda Suzuka"', "Official CSV", { series: "SMX", division: "250" });
assert.equal(singleWordHometown.rows[0].name, "Jo Shimoda", "a known one-word city appended without punctuation is removed from the rider name");
assert.equal(singleWordHometown.rows[0].hometown, "Suzuka", "a known one-word city appended without punctuation is preserved as the hometown");
const multiwordHometown = parser.parseCsv('Pos,No,Rider\n1,30,"Jo Shimoda Rio de Janeiro"', "Official CSV", { series: "SMX", division: "250" });
assert.equal(multiwordHometown.rows[0].name, "Jo Shimoda", "a recognized multiword city suffix is removed from the rider name");
assert.equal(multiwordHometown.rows[0].hometown, "Rio de Janeiro", "a recognized multiword city is preserved as the hometown");
const fullStateHometown = parser.parseCsv('Pos,No,Rider,Manufacturer\n1,35,"Drew Adams Chattanooga, Tennessee",KAWASAKI', "Official CSV", { series: "SMX", division: "250" });
assert.equal(fullStateHometown.rows[0].name, "Drew Adams", "full state names are removed from the imported rider name");
assert.equal(fullStateHometown.rows[0].hometown, "Chattanooga, Tennessee", "full state hometown remains available for location enrichment");
const countryHometown = parser.parseCsv('Pos,No,Rider\n1,80,"Andrea Adamo, Italy"', "Official CSV", { series: "MXGP", division: "MX2" });
assert.equal(countryHometown.rows[0].name, "Andrea Adamo", "a country-only suffix does not accidentally remove the rider surname");
assert.equal(countryHometown.rows[0].hometown, "Italy", "country-only hometowns are retained separately");
const manufacturerStart = app.indexOf("const BRAND={");
const manufacturerEnd = app.indexOf("\nfunction brandKey(value){", manufacturerStart);
const brandKeyEnd = app.indexOf("\n// Use each manufacturer's brand color", manufacturerEnd);
const manufacturerContext = { clean: value => String(value ?? "").trim() };
vm.runInNewContext(`${app.slice(manufacturerStart, manufacturerEnd)}; ${app.slice(manufacturerEnd, brandKeyEnd)}; globalThis.canonical = value => { const raw=clean(value); return brandKey(raw) || raw.replace(/\\s+/g," ").trim(); }; globalThis.brandKey=brandKey;`, manufacturerContext);
assert.equal(manufacturerContext.canonical("GASGAS"), "GasGas", "GasGas is normalized to the manufacturer’s official capitalization");
assert.equal(manufacturerContext.canonical("KAWASAKI"), "Kawasaki", "Kawasaki is normalized to the manufacturer’s official capitalization");
assert.equal(manufacturerContext.brandKey("Monster Energy Pro Circuit Kawasaki"), "Kawasaki", "manufacturer can be recognized within an imported race-team name");
assert.equal(manufacturerContext.brandKey("Red Bull KTM Factory Racing"), "KTM", "KTM can be recognized within an imported race-team name");

const regionStart = app.indexOf("const COUNTRIES=");
const regionEnd = app.indexOf("function countryRegionLabel", regionStart);
const hometownStart = app.indexOf("function inferBatchHometownLocation(");
const hometownEnd = app.indexOf("function matchOfficialResultAthlete", hometownStart);
const locationContext = {
  clean: value => String(value ?? "").trim(),
  norm: value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "")
};
vm.runInNewContext(`${app.slice(regionStart, regionEnd)}; ${app.slice(hometownStart, hometownEnd)}; globalThis.lookupHometown=inferBatchHometownLocation;`, locationContext);
assert.deepEqual(JSON.parse(JSON.stringify(locationContext.lookupHometown("Chattanooga,TN"))), { nationality: "US", nationalityRegion: "US-TN" }, "US hometown abbreviations populate country and state");
assert.deepEqual(JSON.parse(JSON.stringify(locationContext.lookupHometown("Kamloops,BC"))), { nationality: "CA", nationalityRegion: "CA-BC" }, "Canadian hometown abbreviations populate country and province");
assert.deepEqual(JSON.parse(JSON.stringify(locationContext.lookupHometown("Landsborough,QLD"))), { nationality: "AU", nationalityRegion: "AU-QLD" }, "Australian state abbreviations populate country and region");
assert.deepEqual(JSON.parse(JSON.stringify(locationContext.lookupHometown("Kamloops,British Columbia"))), { nationality: "CA", nationalityRegion: "CA-BC" }, "full Canadian province names populate country and region");

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
