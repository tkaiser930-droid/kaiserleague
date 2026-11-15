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

  const directParsed = parseHtml(gpPage, "Official Formula 1 Race Result", { series: "F1", url: gpUrl });
  assert.deepEqual(directParsed.rows.map(row => [row.position, row.number, row.name]), [
    [1, "1", "Lando Norris"], [2, "81", "Oscar Piastri"], [3, "12", "Kimi Antonelli"]
  ]);
  assert.equal(directParsed.rows[0].team, "McLaren");
  assert.equal(directParsed.rows.length, 3, "NC rows without a numeric official finishing position are not assigned a finishing place");

  const sprintImport = await withMockFetch({ [archiveUrl]: archivePage, [gpUrl]: gpPage, [sprintUrl]: sprintPage }, async calls => {
    const result = await fetchOfficialResults({
      url: F1_RESULTS_ARCHIVE,
      series: "F1",
      event: "Miami Grand Prix",
      eventDate: "2026-05-03",
      phase: "Sprint"
    });
    assert.deepEqual(calls, [archiveUrl, gpUrl, sprintUrl]);
    return result;
  });
  assert.equal(sprintImport.sessionTitle, "Sprint");
  assert.equal(sprintImport.eventTitle, "FORMULA 1 CRYPTO.COM MIAMI GRAND PRIX 2026 - RACE RESULT");
  assert.deepEqual(sprintImport.rows.map(row => row.position), [1, 2, 3]);
  assert.equal(sprintImport.rows[0].name, "Lando Norris");
  assert.equal(sprintImport.fastestLap, null, "Sprint imports must not use the event-wide Grand Prix fastest-laps table");

  const gpImport = await withMockFetch({ [archiveUrl]: archivePage, [gpUrl]: gpPage, [fastestUrl]: fastestLapsPage }, async calls => {
    const result = await fetchOfficialResults({
      url: F1_RESULTS_ARCHIVE,
      series: "F1",
      event: "Miami Grand Prix",
      eventDate: "2026-05-03",
      phase: "Grand Prix"
    });
    assert.deepEqual(calls, [archiveUrl, gpUrl, fastestUrl]);
    return result;
  });
  assert.equal(gpImport.sessionTitle, "Grand Prix");
  assert.equal(gpImport.rows[0].name, "Lando Norris");
  assert.equal(gpImport.fastestLap.name, "Lando Norris");
  assert.equal(gpImport.fastestLap.number, "1");

  // A direct Sprint URL still obeys the selected scoring tab; Grand Prix selection resolves to Race Result.
  await withMockFetch({ [gpUrl]: gpPage, [fastestUrl]: fastestLapsPage }, async calls => {
    const result = await fetchOfficialResults({ url: sprintUrl, series: "F1", phase: "Grand Prix" });
    assert.equal(result.sessionTitle, "Grand Prix");
    assert.equal(result.rows[0].name, "Lando Norris");
    assert.deepEqual(calls, [gpUrl, fastestUrl]);
  });

  const nonSprintEvent = `<!doctype html><html><body><h1>British Grand Prix 2026</h1><a href="/en/results/2026/races/1290/great-britain/race-result">Race Result</a></body></html>`;
  await withMockFetch({ ["https://www.formula1.com/en/results/2026/races/1290/great-britain/race-result"]: nonSprintEvent }, async () => {
    await assert.rejects(
      () => fetchOfficialResults({ url: "https://www.formula1.com/en/results/2026/races/1290/great-britain/race-result", series: "F1", phase: "Sprint" }),
      /does not provide.*Sprint|may not be a Sprint weekend/i
    );
  });

  console.log("F1 importer tests passed: official archive event/date matching, Grand Prix and Sprint session routing, driver/number/team extraction, fastest-lap page mapping, direct URL session enforcement, and non-Sprint weekend validation.");
})().catch(error => { console.error(error); process.exitCode = 1; });
