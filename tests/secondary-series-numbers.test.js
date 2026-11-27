"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../app.js"), "utf8");
const start = source.indexOf("function athleteNumberForSeries(");
const end = source.indexOf("\nfunction hasAthleteSeries", start);
assert(start >= 0 && end > start, "series-specific number helper must exist");
const helper = source.slice(start, end);
const context = {
  clean: value => String(value ?? "").trim(),
  norm: value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
  cls: athlete => String(athlete?.primarySeries || athlete?.class || "450").trim(),
  athleteSeries: athlete => [String(athlete?.primarySeries || athlete?.class || "450"), ...(athlete?.secondarySeries || [])],
  SERIES_GROUPS: { SMX: ["250", "450"], "MXGP": ["MXGP", "MX2"], "Triple Crown Series": ["CAN 250", "CAN 450"], MotoGP: ["MotoGP"], F1: ["F1"] }
};
vm.runInNewContext(`${helper}; globalThis.getSeriesNumber = athleteNumberForSeries; globalThis.getDraftSeries = athleteSeriesForDraftRoom; globalThis.getDraftNumber = athleteNumberForDraftRoom;`, context);
const sacha = { name: "Sacha Coenen", number: "19", primarySeries: "MX2", secondarySeries: ["250"], secondaryNumbers: { "250": "109" } };
assert.equal(context.getSeriesNumber(sacha, "MX2"), "19", "primary MX2 number remains the main number");
assert.equal(context.getSeriesNumber(sacha, "250"), "109", "SMX 250 uses the secondary number");
assert.equal(context.getSeriesNumber(sacha, "450"), "19", "an unconfigured secondary class safely falls back to the main number");
assert.equal(context.getSeriesNumber({ ...sacha, secondaryNumbers: { "250": "" } }, "250"), "19", "blank secondary numbers reuse the primary number");
assert.equal(context.getDraftSeries(sacha, "SMX"), "250", "the SMX draft room uses the athlete's eligible secondary class when their primary class is outside that room");
assert.equal(context.getDraftNumber(sacha, "SMX"), "109", "projected and live SMX draft rows use the secondary 250 number");
assert(source.includes('numberHTML(a.number,a.manufacturer,a)'), "Commissioner athlete directory must continue to display the main number");
assert.match(source, /function renderAthletes\(\).*athleteDetailButtonHTML\(a\)/, "All Athletes page must continue to display the primary/main number, not a secondary-series number");
assert(source.includes('secondaryNumbers:secondaryNumbersFromInputs("athSecondaryNumberFields")'), "new athlete form must save secondary numbers");
assert(source.includes('secondaryNumbers:secondaryNumbersFromInputs("editAthSecondaryNumberFields")'), "edit athlete form must save secondary numbers");
assert(source.includes('athleteNumberForSeries(a,division)'), "scoring dropdowns must display the selected class number");
assert(source.includes('riderNumber:clean(athleteNumberForSeries(x.a,division))'), "scored records must snapshot the number used in that series/class");
assert(source.includes('athleteNumberForDraftRoom(a,room)'), "draft list must display the number for the selected draft room");
assert(source.includes('athleteDetailButtonHTML(athlete,true,true,displaySeries,number)'), "Projected Draft Pick rows must render the room-specific number and plate class");
assert(source.includes('const number=clean(record.riderNumber)||athleteNumberForSeries(athlete,resultClass)'), "public scored-result history must show the number recorded for that series/class");
assert(source.includes('"Class / Session","Number","Event / Round"'), "public rider result history must label the series-specific number");
assert(source.includes('const number=clean(record.riderNumber)||athleteNumberForSeries(athlete,resultClass)'), "historical profile rows must prefer their season-specific number snapshot");
const server = fs.readFileSync(require.resolve("../server.js"), "utf8");
assert(server.includes('secondaryNumbers: athlete.secondaryNumbers'), "public draft projections must provide secondary-number data for the selected draft room");
assert(source.includes('athleteDraftSeries'), "draft picks must snapshot which series number was used");
const commissioner = fs.readFileSync(require.resolve("../commissioner.html"), "utf8");
assert(commissioner.includes('id="athSecondaryNumberFields"') && commissioner.includes('id="editAthSecondaryNumberFields"'), "commissioner add/edit forms must expose secondary number inputs");
console.log("Secondary series number tests passed: Sacha Coenen-style primary/secondary numbers, projected and live draft display, series scoring snapshots, and public history.");
