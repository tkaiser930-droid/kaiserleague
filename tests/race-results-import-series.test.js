"use strict";
const assert = require("node:assert/strict");
const {
  fetchOfficialResults,
  parseTcsEventResults,
  parseHtml,
  hostIsAllowed,
  OFFICIAL_HOSTS_BY_SERIES,
  MOTOGP_API_BASE
} = require("../race-results-import");

async function withMockFetch(map, callback) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (!(url in map)) throw new Error(`Unexpected fetch: ${url}`);
    const entry = map[url];
    if (entry instanceof Error) throw entry;
    const value = typeof entry === "string" ? { body: entry, type: "text/html; charset=utf-8" } : entry;
    return new Response(value.body, { status: value.status || 200, headers: { "content-type": value.type || "application/json; charset=utf-8" } });
  };
  try { return await callback(calls); }
  finally { global.fetch = original; }
}

function tcsEventPage(activeClass = "250", rows = null) {
  const defaultRows = activeClass === "250"
    ? [[1, 31, "Ryder Malinoski", 2, 1], [2, 24, "Dylan Rempel", 1, 2]]
    : [[1, 2, "Preston Kilroy", 2, 1], [2, 9, "Dylan Wright", 1, 2]];
  const data = (rows || defaultRows).map(row => `<tr><td>${row[0]}</td><td>#${row[1]}</td><td><img alt="yamaha" src="/yamaha.png"><span>${row[2]}</span></td><td>${row[3]}</td><td>${row[4]}</td></tr>`).join("");
  return `<!doctype html><html><head><title>Round 8 — Walton Raceway — Triple Crown Series</title></head><body>
    <h1>Round 8 — Walton Raceway</h1><h2>Full Event Results</h2>
    <div class="class-tabs">
      <button class="tab ${activeClass === "450" ? "active" : ""}" data-class="450" aria-pressed="${activeClass === "450"}">450 Pro</button>
      <button class="tab ${activeClass === "250" ? "active" : ""}" data-class="250" aria-pressed="${activeClass === "250"}">250 Pro</button>
      <button class="tab" data-class="WMX">WMX</button>
    </div>
    <table><thead><tr><th>Pos</th><th>No.</th><th>Rider</th><th>Moto 1</th><th>Moto 2</th></tr></thead><tbody>${data}</tbody></table>
  </body></html>`;
}

function mxgpPage(heading, riders) {
  const body = riders.map(row => `<tr><td>${row.pos}</td><td>${row.number}</td><td><a href="#rider">${row.name}</a></td><td>${row.nat || "NED"}</td><td>${row.fed || "KNMV"}</td><td>${row.bike || "Honda"}</td><td>35:15.127</td><td>18</td><td>0:00.000</td><td>0:00.000</td><td>${row.bestLap || "1:47.954"}</td><td>7</td><td>55.69</td></tr>`).join("");
  return `<!doctype html><html><head><title>Results Infront Moto Racing</title></head><body><h2>${heading}</h2>
    <table><thead><tr><th>Pos</th><th>Nr</th><th>Rider</th><th>Nat.</th><th>Fed.</th><th>Bike</th><th>Time</th><th>laps</th><th>Diff. First</th><th>Diff. Prev.</th><th>Bestlaptime</th><th>in lap</th><th>Speed</th></tr></thead><tbody>${body}</tbody></table>
  </body></html>`;
}

function json(body) { return { body: JSON.stringify(body), type: "application/json; charset=utf-8" }; }

(async () => {
  // Official domain allow-list includes the JSON results service used by the MotoGP results archive.
  assert.equal(hostIsAllowed("triplecrownseries.ca", "Triple Crown Series"), true);
  assert.equal(hostIsAllowed("results.mxgp.com", "MXGP"), true);
  assert.equal(hostIsAllowed("api.motogp.pulselive.com", "MotoGP"), true);
  assert.equal(hostIsAllowed("example.com", "MotoGP"), false);
  assert.ok(OFFICIAL_HOSTS_BY_SERIES.MotoGP.includes("api.motogp.pulselive.com"));

  // TCS root archive follows the selected season / round to the archived event page.
  const tcsRoot = "https://triplecrownseries.ca/results";
  const tcsYearArchive = "https://triplecrownseries.ca/2026";
  const tcsEvent = "https://triplecrownseries.ca/2026/events/walton";
  const tcsArchiveHtml = `<!doctype html><html><body>
    <a href="/events/walton">R8 · Walton Raceway — Walton, ON · August 15, 2027</a>
    <a href="/2026/events/walton">R8 · Walton Raceway — Walton, ON · August 16, 2026</a>
  </body></html>`;
  const tcs250Html = tcsEventPage("250");
  const tcs250Moto2 = await withMockFetch({ [tcsYearArchive]: tcsArchiveHtml, [tcsEvent]: tcs250Html }, async calls => {
    const result = await fetchOfficialResults({
      url: tcsRoot, series: "Triple Crown Series", division: "CAN 250", event: "Walton Raceway",
      eventLocation: "Walton, ON", round: 8, eventDate: "2026-08-16", phase: "Moto 2"
    });
    assert.deepEqual(calls, [tcsYearArchive, tcsEvent]);
    return result;
  });
  assert.equal(tcs250Moto2.division, "CAN 250");
  assert.equal(tcs250Moto2.sessionTitle, "Moto 2");
  assert.deepEqual(tcs250Moto2.rows.map(row => [row.position, row.number, row.name]), [[1, "31", "Ryder Malinoski"], [2, "24", "Dylan Rempel"]]);

  const tcs450Html = tcsEventPage("450");
  const tcs450Moto1 = parseTcsEventResults(tcs450Html, "Walton Results", { division: "CAN 450", phase: "Moto 1" });
  assert.deepEqual(tcs450Moto1.rows.map(row => [row.number, row.name, row.position]), [["2", "Preston Kilroy", 2], ["9", "Dylan Wright", 1]].sort((a, b) => a[2] - b[2]));
  assert.throws(() => parseTcsEventResults(tcs450Html, "Walton Results", { division: "CAN 250", phase: "Moto 1" }), /250 Pro Moto 1/i,
    "a 450-active result table must never be imported as 250");
  assert.throws(() => parseTcsEventResults(tcsEventPage("250", [[1, 31, "Ryder Malinoski", 1, 2]]), "Walton", { division: "CAN 450", phase: "Moto 1" }), /450 Pro Moto 1/i,
    "a 250-active result table must never be imported as 450");

  // MXGP/MX2 official reslists.aspx classification headings are used to enforce both class and session.
  const mx2Url = "https://results.mxgp.com/reslists.aspx?c=7&ct=1";
  const mx2Html = mxgpPage("MX2 - Grand Prix Race 2 - Classification", [
    { pos: 1, number: 99, name: "Farres, Guillem", bestLap: "1:55.113", bike: "Triumph" },
    { pos: 2, number: 26, name: "Everts, Liam", bestLap: "1:56.075", bike: "Husqvarna" }
  ]);
  const mx2Result = await withMockFetch({ [mx2Url]: mx2Html }, async calls => {
    const result = await fetchOfficialResults({ url: mx2Url, series: "MXGP", division: "MX2", event: "Grand Prix", phase: "Moto 2" });
    assert.deepEqual(calls, [mx2Url]);
    return result;
  });
  assert.equal(mx2Result.rows[0].name, "Guillem Farres", "MXGP comma-form names normalize to first-name last-name");
  assert.equal(mx2Result.rows[0].number, "99");
  assert.equal(mx2Result.rows[0].bestLap, "1:55.113");
  assert.equal(mx2Result.division, "MX2");
  assert.throws(() => parseHtml(mx2Html, "MXGP results", { series: "MXGP", division: "MXGP", phase: "Moto 2" }), /selected MXGP.*labelled MX2/i);
  assert.throws(() => parseHtml(mx2Html, "MXGP results", { series: "MXGP", division: "MX2", phase: "Moto 1" }), /not Moto 1/i);

  const mxgpQualUrl = "https://results.mxgp.com/reslists.aspx?c=1&ct=7";
  const mxgpQualHtml = mxgpPage("MXGP - Qualifying Race - Classification", [
    { pos: 1, number: 84, name: "Herlings, Jeffrey", bestLap: "1:43.111" },
    { pos: 2, number: 1, name: "Febvre, Romain", bestLap: "1:43.187", bike: "Kawasaki" }
  ]);
  const mxgpQual = parseHtml(mxgpQualHtml, "MXGP qualifying", { series: "MXGP", division: "MXGP", phase: "Qualifying Race" });
  assert.equal(mxgpQual.rows[0].name, "Jeffrey Herlings");
  assert.throws(() => parseHtml(mxgpQualHtml, "MXGP qualifying", { series: "MXGP", division: "MXGP", phase: "Moto 1" }), /not Moto 1/i);

  // MXON shares the official result system but uses Nation/combined-class event titles.
  const mxonHtml = mxgpPage("Race 2 (MXGP + Open) - Classification", [
    { pos: 1, number: 84, name: "Herlings, Jeffrey" },
    { pos: 2, number: 1, name: "Febvre, Romain" }
  ]);
  const mxon = parseHtml(mxonHtml, "MXON results", { series: "MXON", division: "MXON", phase: "Moto 2" });
  assert.equal(mxon.rows.length, 2);
  assert.throws(() => parseHtml(mxgpPage("Race 3 (MXGP + Open) - Classification", [{ pos: 1, number: 84, name: "Herlings, Jeffrey" }]), "MXON", { series: "MXON", phase: "Moto 2" }), /not Moto 2/i);
  const mxonMx2Qual = parseHtml(mxgpPage("MX2 - Qualifying Race - Classification", [{ pos: 1, number: 26, name: "Everts, Liam" }]), "MXON", { series: "MXON", phase: "MX2 Qualifying Race" });
  assert.equal(mxonMx2Qual.rows[0].name, "Liam Everts");
  assert.throws(() => parseHtml(mxgpQualHtml, "MXON", { series: "MXON", phase: "MX2 Qualifying Race" }), /not the MXON MX2/i);

  // MotoGP official archive is resolved through the live results JSON service, preserving the selected Grand Prix / Sprint tab.
  const api = MOTOGP_API_BASE;
  const seasonUrl = `${api}/results/seasons`;
  const eventsUrl = `${api}/results/events?seasonUuid=season-2026&isFinished=true`;
  const categoriesUrl = `${api}/results/categories?eventUuid=event-qatar`;
  const sessionsUrl = `${api}/results/sessions?eventUuid=event-qatar&categoryUuid=category-motogp`;
  const raceUrl = `${api}/results/session/race-qatar/classification?seasonYear=2026&test=false`;
  const sprintUrl = `${api}/results/session/sprint-qatar/classification?seasonYear=2026&test=false`;
  const q2Url = `${api}/results/session/q2-qatar/classification?seasonYear=2026&test=false`;
  const apiMap = {
    [seasonUrl]: json([{ id: "season-2026", year: 2026, current: true }]),
    [eventsUrl]: json([{ id: "event-qatar", name: "Qatar Grand Prix", date: "2026-11-08", round: 20, circuit: { name: "Lusail International Circuit" } }]),
    [categoriesUrl]: json([{ id: "category-motogp", name: "MotoGP" }]),
    [sessionsUrl]: json([{ id: "race-qatar", type: "RAC", name: "Grand Prix" }, { id: "sprint-qatar", type: "SPR", name: "Sprint" }, { id: "q2-qatar", type: "Q2", name: "Qualifying 2" }]),
    [raceUrl]: json([{ position: 1, rider: { full_name: "Marco Bezzecchi", number: 72 }, team: { name: "Aprilia Racing" }, best_lap: { time: "1:52.123" } }, { position: 2, rider: { full_name: "Marc Marquez", number: 93 }, team: { name: "Ducati Lenovo Team" }, best_lap: { time: "1:52.245" } }]),
    [sprintUrl]: json([{ position: 1, rider: { full_name: "Marc Marquez", number: 93 }, team: { name: "Ducati Lenovo Team" } }, { position: 2, rider: { full_name: "Marco Bezzecchi", number: 72 }, team: { name: "Aprilia Racing" } }]),
    [q2Url]: json([{ position: 1, rider: { full_name: "Francesco Bagnaia", number: 63 }, team: { name: "Ducati Lenovo Team" } }, { position: 2, rider: { full_name: "Marco Bezzecchi", number: 72 }, team: { name: "Aprilia Racing" } }])
  };
  const motogpRace = await withMockFetch(apiMap, async calls => {
    const result = await fetchOfficialResults({ url: "https://www.motogp.com/en/gp-results/", series: "MotoGP", event: "Qatar Grand Prix", round: 20, eventDate: "2026-11-08", phase: "Grand Prix" });
    assert.deepEqual(calls, [seasonUrl, eventsUrl, categoriesUrl, sessionsUrl, raceUrl, q2Url]);
    return result;
  });
  assert.equal(motogpRace.rows[0].name, "Marco Bezzecchi");
  assert.equal(motogpRace.rows[0].number, "72");
  assert.equal(motogpRace.rows[0].bestLap, "1:52.123");
  assert.equal(motogpRace.fastestQualifier.name, "Francesco Bagnaia");
  assert.equal(motogpRace.fastestQualifierSessionTitle, "Qualifying 2");
  assert.equal(motogpRace.sessionTitle, "Grand Prix");

  const motogpSprint = await withMockFetch(apiMap, async calls => {
    const result = await fetchOfficialResults({ url: "https://www.motogp.com/en/gp-results/", series: "MotoGP", event: "Qatar Grand Prix", round: 20, eventDate: "2026-11-08", phase: "Sprint" });
    assert.deepEqual(calls, [seasonUrl, eventsUrl, categoriesUrl, sessionsUrl, sprintUrl, q2Url]);
    return result;
  });
  assert.equal(motogpSprint.sessionTitle, "Sprint");
  assert.equal(motogpSprint.rows[0].name, "Marc Marquez", "Sprint selection uses the SPR classification, not the RAC classification");

  console.log("TCS / MXGP / MXON / MotoGP importer tests passed: year-specific TCS event selection, strict TCS class and moto filtering, MXGP/MXON class/session validation, rider-number/best-lap parsing, and MotoGP RAC/SPR/Q2 routing.");
})().catch(error => { console.error(error); process.exitCode = 1; });
