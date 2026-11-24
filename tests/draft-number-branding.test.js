"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const start = app.indexOf("const BRAND={");
const end = app.indexOf("function normalizeNumber", start);
assert.notEqual(start, -1, "manufacturer and race-team color definitions exist");
assert.notEqual(end, -1, "number plate renderer exists");

const helpers = app.slice(start, end);
const context = {
  clean: value => String(value ?? "").trim(),
  norm: value => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
  esc: value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]),
  cls: athlete => String(athlete?.primarySeries || athlete?.class || athlete?.riderClass || athlete?.category || athlete?.series || "450").trim()
};
vm.runInNewContext(`${helpers}\nglobalThis.__test = { numberHTML, raceTeamBrand };`, context);

const f1 = context.__test.numberHTML("1", "Ferrari", {
  class: "F1", raceTeam: "Oracle Red Bull Racing", manufacturer: "Ferrari"
});
assert.match(f1, /--number-color:#000000/);
assert.match(f1, /--number-ink:#001E62/, "F1 number plate uses Red Bull Racing team color");
assert.doesNotMatch(f1, /#DC0000/, "F1 number plate does not use Ferrari manufacturer color");

const motoGp = context.__test.numberHTML("63", "KTM", {
  class: "MotoGP", raceTeam: "BK8 Gresini Racing MotoGP", manufacturer: "KTM"
});
assert.match(motoGp, /--number-ink:#77C9F1/, "MotoGP number plate uses Gresini team number color");
assert.doesNotMatch(motoGp, /#FF6600/, "MotoGP number plate does not use KTM manufacturer color");

const racingBulls = context.__test.numberHTML("30", "Ford", {
  class: "F1", raceTeam: "Visa Cash App Racing Bulls", manufacturer: "Ford"
});
assert.match(racingBulls, /--number-ink:#65C7F7/, "Racing Bulls resolves to its own team palette");

const unknownTeam = context.__test.numberHTML("99", "Kawasaki", {
  class: "MotoGP", raceTeam: "Unmapped Factory Team", manufacturer: "Kawasaki"
});
assert.match(unknownTeam, /--number-ink:#D1D5DB/, "unmapped F1/MotoGP teams use a neutral fallback, never manufacturer color");
assert.doesNotMatch(unknownTeam, /#006B3F/);

assert.match(app, /raceTeam:athlete\?clean\(athlete\.raceTeam\):""/, "draft picks snapshot the race team so the plate can be rendered later");
assert.match(app, /raceTeam:p\?\.raceTeam\|\|p\?\.riderRaceTeam/, "legacy draft picks can render from saved race-team metadata");
assert.match(server, /raceTeam: String\(athlete\.raceTeam \|\| athlete\.riderRaceTeam \|\| ""\)/, "public draft projections include race-team data for the projected-pick tab");

console.log("Draft F1/MotoGP team-color number plate tests passed.");
