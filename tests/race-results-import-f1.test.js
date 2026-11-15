"use strict";
const assert = require("node:assert/strict");
const {
  F1_RESULTS_ARCHIVE,
  hostIsAllowed,
  isF1ArchiveLandingUrl,
  isF1EventResultUrl,
  parseHtml,
  fetchOfficialResults
} = require("../race-results-import");

const archiveUrl = "https://www.formula1.com/en/results/2026/races";
const gpUrl = "https://www.formula1.com/en/results/2026/races/1284/miami/race-result";
const sprintUrl = "https://www.formula1.com/en/results/2026/races/1284/miami/sprint-results";
const qualifyingUrl = "https://www.formula1.com/en/results/2026/races/1284/miami/qualifying";
const sprintQualifyingUrl = "https://www.formula1.com/en/results/2026/races/1284/miami/sprint-qualifying";
const fastestUrl = "https://www.formula1.com/en/results/2026/races/1284/miami/fastest-laps";

const archivePage = `<!doctype html><html><head><title>2026 Race Results</title></head><body>
<h1>2026 RACE RESULTS</h1>
<table><thead><tr><th>Grand Prix</th><th>Date</th><th>Winner</th><th>Team</th></tr></thead><tbody>
<tr><td><a href="/en/results/2026/races/1279/australia/race-result">Australia</a></td><td>08 Mar</td><td>George Russell</td><td>Mercedes</td></tr>
<tr><td><a href="/en/results/2026/races/1284/miami/race-result">Miami</a></td><td>03 May</td><td>Kimi Antonelli</td><td>Mercedes</td></tr>
</tbody></table></body></html>`;

const eventPageShell = `<nav><a href="/en/results/2026/races/1284/miami/sprint-results">Sprint</a><a href="/en/results/2026/races/1284/miami/race-result">Race Result</a></nav>`;

function f1ResultPage(session, rows) {
  const data = rows.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td><a href="#"><img alt="${row[2]}" src="/driver.png"></a> ${row[2]} ${row[3] || ""}</td><td>${row[4]}</td><td>19</td><td>${row[5] || "+1.234s"}</td><td>${row[6] || 0}</td></tr>`).join("");
  return `<!doctype html><html><head><title>Formula 1 Miami Grand Prix 2026 - ${session}</title></head><body>
  <h1>FORMULA 1 CRYPTO.COM MIAMI GRAND PRIX 2026 - ${session.toUpperCase()}</h1>
  <table><thead><tr><th>Pos.</th><th>No.</th><th>Driver</th><th>Team</th><th>Laps</th><th>Time / Retired</th><th>Pts.</th></tr></thead><tbody>${data}</tbody></table>
  </body></html>`;
}

const gpPage = f1ResultPage("Race Result", [
  [1, 1, "Lando Norris", "NOR", "McLaren", "1:33:19.273", 25],
  [2, 81, "Oscar Piastri", "PIA", "McLaren", "+3.766s", 18],
  [3, 12, "Kimi Antonelli", "ANT", "Mercedes", "+6.251s", 15],
  ["NC", 27, "Nico Hulkenberg", "HUL", "Audi", "DNF", 0]
]).replace("</body></html>", `${eventPageShell}</body></html>`);
const sprintPage = f1ResultPage("Sprint", [
  [1, 1, "Lando Norris", "NOR", "McLaren", "29:15.045", 8],
  [2, 81, "Oscar Piastri", "PIA", "McLaren", "+3.766s", 7],
  [3, 16, "Charles Leclerc", "LEC", "Ferrari", "+6.251s", 6]
]);
function f1QualifyingPage(session, rows) {
  const data = rows.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td><a href="#"><img alt="${row[2]}" src="/driver.png"></a> ${row[2]} ${row[3] || ""}</td><td>${row[4]}</td><td>${row[5] || "1:30.000"}</td><td>${row[6] || "1:29.000"}</td><td>${row[7] || "1:28.000"}</td><td>19</td></tr>`).join("");
  return `<!doctype html><html><head><title>Formula 1 Miami Grand Prix 2026 - ${session}</title></head><body>
  <h1>FORMULA 1 CRYPTO.COM MIAMI GRAND PRIX 2026 - ${session.toUpperCase()}</h1>
  <table><thead><tr><th>Pos.</th><th>No.</th><th>Driver</th><th>Team</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Laps</th></tr></thead><tbody>${data}</tbody></table>
  </body></html>`;
}
const qualifyingPage = f1QualifyingPage("Qualifying", [
  [1, 1, "Lando Norris", "NOR", "McLaren", "1:28.000", "1:27.500", "1:27.100"],
  [2, 81, "Oscar Piastri", "PIA", "McLaren", "1:28.200", "1:27.700", "1:27.300"]
]);
const sprintQualifyingPage = f1QualifyingPage("Sprint Qualifying", [
  [1, 81, "Oscar Piastri", "PIA", "McLaren", "1:28.000", "1:27.500", "1:27.100"],
  [2, 1, "Lando Norris", "NOR", "McLaren", "1:28.200", "1:27.700", "1:27.300"]
]);
const fastestLapsPage = `<!doctype html><html><head><title>Formula 1 Miami Grand Prix 2026 - Fastest Laps</title></head><body>
<h1>FORMULA 1 CRYPTO.COM MIAMI GRAND PRIX 2026 - FASTEST LAPS</h1>
<table><thead><tr><th>Pos.</th><th>No.</th><th>Driver</th><th>Team</th><th>Lap</th><th>Time of Day</th><th>Time</th><th>Avg. Speed</th></tr></thead><tbody>
<tr><td>1</td><td>1</td><td><a><img alt="Lando Norris" src="/driver.png"></a> Lando Norris NOR</td><td>McLaren</td><td>35</td><td>14:03:29</td><td>1:31.869</td><td>212.075</td></tr>
<tr><td>2</td><td>81</td><td><a><img alt="Oscar Piastri" src="/driver.png"></a> Oscar Piastri PIA</td><td>McLaren</td><td>30</td><td>13:56:02</td><td>1:31.949</td><td>211.891</td></tr>
</tbody></table></body></html>`;

async function withMockFetch(map, callback) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async input => {
    const url = String(input);
    calls.push(url);
    if (!(url in map)) throw new Error(`Unexpected fetch: ${url}`);
    return new Response(map[url], { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
  try { return await callback(calls); }
  finally { global.fetch = original; }
}

(async () => {
  assert.equal(F1_RESULTS_ARCHIVE, "https://www.formula1.com/en/results");
  assert.equal(hostIsAllowed("www.formula1.com", "F1"), true);
  assert.equal(hostIsAllowed("formula1.com", "F1"), true);
  assert.equal(hostIsAllowed("example.com", "F1"), false);
  assert.equal(isF1ArchiveLandingUrl(new URL("https://www.formula1.com/en/results")), true);
  assert.equal(isF1ArchiveLandingUrl(new URL(archiveUrl)), true);
  assert.equal(isF1EventResultUrl(new URL(gpUrl)), true);
  assert.equal(isF1EventResultUrl(new URL(sprintUrl)), true);
  assert.equal(isF1EventResultUrl(new URL(qualifyingUrl)), true);
  assert.equal(isF1EventResultUrl(new URL(sprintQualifyingUrl)), true);

  const directParsed = parseHtml(gpPage, "Official Formula 1 Race Result", { series: "F1", url: gpUrl });
  assert.deepEqual(directParsed.rows.map(row => [row.position, row.displayPosition, row.number, row.name]), [
    [1, "1", "1", "Lando Norris"], [2, "2", "81", "Oscar Piastri"], [3, "3", "12", "Kimi Antonelli"], [4, "NC", "27", "Nico Hulkenberg"]
  ]);
  assert.equal(directParsed.rows[0].team, "McLaren");
  assert.equal(directParsed.rows[3].status, "NC");
  assert.equal(directParsed.rows[3].sourceOrder, 3);
  const multipleNc = parseHtml(f1ResultPage("Race Result", [
    [1, 1, "Lando Norris", "NOR", "McLaren", "1:33:19.273", 25],
    ["NC", 27, "Nico Hulkenberg", "HUL", "Audi", "DNF", 0],
    ["NC", 11, "Sergio Perez", "PER", "Cadillac", "DNF", 0]
  ]), "F1 NC order", { series: "F1" });
  assert.deepEqual(multipleNc.rows.filter(row => row.status === "NC").map(row => [row.position, row.name]), [[2, "Nico Hulkenberg"], [3, "Sergio Perez"]], "NC drivers receive sequential positions in their official displayed order");

  const sprintImport = await withMockFetch({ [archiveUrl]: archivePage, [gpUrl]: gpPage, [sprintUrl]: sprintPage, [sprintQualifyingUrl]: sprintQualifyingPage }, async calls => {
    const result = await fetchOfficialResults({
      url: F1_RESULTS_ARCHIVE,
      series: "F1",
      event: "Miami Grand Prix",
      eventDate: "2026-05-03",
      phase: "Sprint"
    });
    assert.deepEqual(calls, [archiveUrl, gpUrl, sprintUrl, sprintQualifyingUrl]);
    return result;
  });
  assert.equal(sprintImport.sessionTitle, "Sprint");
  assert.equal(sprintImport.eventTitle, "FORMULA 1 CRYPTO.COM MIAMI GRAND PRIX 2026 - RACE RESULT");
  assert.deepEqual(sprintImport.rows.map(row => row.position), [1, 2, 3]);
  assert.equal(sprintImport.rows[0].name, "Lando Norris");
  assert.equal(sprintImport.fastestLap, null, "Sprint imports must not use the event-wide Grand Prix fastest-laps table");
  assert.equal(sprintImport.fastestQualifier.name, "Oscar Piastri", "Sprint sessions use Sprint Qualifying, not Grand Prix Qualifying");
  assert.equal(sprintImport.fastestQualifierSessionTitle, "Sprint Qualifying");
  assert.equal(sprintImport.fastestQualifier.sourceUrl, sprintQualifyingUrl);

  const gpImport = await withMockFetch({ [archiveUrl]: archivePage, [gpUrl]: gpPage, [qualifyingUrl]: qualifyingPage, [fastestUrl]: fastestLapsPage }, async calls => {
    const result = await fetchOfficialResults({
      url: F1_RESULTS_ARCHIVE,
      series: "F1",
      event: "Miami Grand Prix",
      eventDate: "2026-05-03",
      phase: "Grand Prix"
    });
    assert.deepEqual(calls, [archiveUrl, gpUrl, qualifyingUrl, fastestUrl]);
    return result;
  });
  assert.equal(gpImport.sessionTitle, "Grand Prix");
  assert.equal(gpImport.rows[0].name, "Lando Norris");
  assert.equal(gpImport.fastestLap.name, "Lando Norris");
  assert.equal(gpImport.fastestLap.number, "1");
  assert.equal(gpImport.fastestQualifier.name, "Lando Norris");
  assert.equal(gpImport.fastestQualifierSessionTitle, "Qualifying");

  // A direct Sprint URL still obeys the selected scoring tab; Grand Prix selection resolves to Race Result.
  await withMockFetch({ [gpUrl]: gpPage, [qualifyingUrl]: qualifyingPage, [fastestUrl]: fastestLapsPage }, async calls => {
    const result = await fetchOfficialResults({ url: sprintUrl, series: "F1", phase: "Grand Prix" });
    assert.equal(result.sessionTitle, "Grand Prix");
    assert.equal(result.rows[0].name, "Lando Norris");
    assert.deepEqual(calls, [gpUrl, qualifyingUrl, fastestUrl]);
  });

  const nonSprintEvent = `<!doctype html><html><body><h1>British Grand Prix 2026</h1><a href="/en/results/2026/races/1290/great-britain/race-result">Race Result</a></body></html>`;
  await withMockFetch({ ["https://www.formula1.com/en/results/2026/races/1290/great-britain/race-result"]: nonSprintEvent }, async () => {
    await assert.rejects(
      () => fetchOfficialResults({ url: "https://www.formula1.com/en/results/2026/races/1290/great-britain/race-result", series: "F1", phase: "Sprint" }),
      /does not provide.*Sprint|may not be a Sprint weekend/i
    );
  });

  // Direct qualifying and sprint-qualifying URLs are accepted but the selected scoring phase still chooses the matching source.
  await withMockFetch({ [gpUrl]: gpPage, [sprintUrl]: sprintPage, [sprintQualifyingUrl]: sprintQualifyingPage }, async calls => {
    const result = await fetchOfficialResults({ url: qualifyingUrl, series: "F1", phase: "Sprint" });
    assert.equal(result.sessionTitle, "Sprint");
    assert.equal(result.fastestQualifier.name, "Oscar Piastri");
    assert.deepEqual(calls, [gpUrl, sprintUrl, sprintQualifyingUrl]);
  });

  console.log("F1 importer tests passed: NC retention and source order, archive event/date matching, Grand Prix and Sprint routing, separate Qualifying/Sprint Qualifying fastest-qualifier lookups, fastest-lap page mapping, direct session URL enforcement, and non-Sprint weekend validation.");
})().catch(error => { console.error(error); process.exitCode = 1; });
