"use strict";
const assert = require("node:assert/strict");
const {
  fetchOfficialResults,
  parseHtml,
  divisionKey,
  hostIsAllowed,
  SMX_EVENT_ARCHIVE
} = require("../race-results-import");

const archiveUrl = "https://www.supermotocross.com/results/";
const eventUrl = "https://www.supermotocross.com/results/2026/smx-world-championship-final-ridgedale-mo/";
const archivePage = `<!doctype html><html><head><title>Results | SuperMotocross</title></head><body><h1>2026 Season Results</h1><table>
<tr><td><a href="/results/2026/smx-world-championship-final-ridgedale-mo/">SMX World Championship Final - Ridgedale, MO</a></td><td>Sep 26, 2026</td><td>SMX</td></tr>
<tr><td><a href="/results/2026/smx-playoff-2-los-angeles-ca/">SMX Playoff 2 - Los Angeles, CA</a></td><td>Sep 19, 2026</td><td>SMX</td></tr>
</table></body></html>`;
const eventPage = `<!doctype html><html><head><title>SMX World Championship Final - Ridgedale, MO Results | SuperMotocross</title></head><body>
<h1>SMX World Championship Final - Ridgedale, MO</h1>
<h2>250</h2><h3>Main Event</h3>
<div><span>250 Moto #1</span><a href="/results/2026/smx-world-championship-final-ridgedale-mo/250-moto-1/">Results</a></div>
<div><span>250 Moto #2</span><a href="/results/2026/smx-world-championship-final-ridgedale-mo/250-moto-2/">Results</a></div>
<a href="/results/2026/smx-world-championship-final-ridgedale-mo/overall/250/">250 Overall Results</a>
<h2>450</h2><h3>Main Event</h3>
<div><span>450 Moto #1</span><a href="/results/2026/smx-world-championship-final-ridgedale-mo/450-moto-1/">Results</a></div>
<div><span>450 Moto #2</span><a href="/results/2026/smx-world-championship-final-ridgedale-mo/450-moto-2/">Results</a></div>
<a href="/results/2026/smx-world-championship-final-ridgedale-mo/overall/450/">450 Overall Results</a>
</body></html>`;

function resultPage(division, rows, session = "Moto #1") {
  const dataRows = rows.map(row => `<tr><td>${row[0]}</td><td>${row[1]}</td><td><img alt="${row[2]}" src="/rider.png"> ${row[4] || "Hometown, USA"}</td><td>Yamaha</td><td>17</td><td>21:50.230</td><td>—</td><td>${row[3]}</td><td>Test Team</td></tr>`).join("");
  return `<!doctype html><html><head><title>${division} ${session} Results – SMX World Championship Final | SuperMotocross</title></head><body>
  <h2>${division} ${session} Results</h2><table><thead><tr><th>Pos</th><th>#</th><th>Rider</th><th>Mfr</th><th>Laps</th><th>Time</th><th>Interval</th><th>Best Lap (Lap #)</th><th>Team</th></tr></thead><tbody>${dataRows}</tbody></table>
  <h2>Hard Charger</h2><table><thead><tr><th>Rank</th><th>#</th><th>Rider</th><th>Mfr</th><th>Gained</th><th>From</th><th>Finish</th></tr></thead><tbody><tr><td>1</td><td>47</td><td>Levi Kitchen</td><td>Kawasaki</td><td>+5</td><td>8</td><td>3</td></tr></tbody></table>
  </body></html>`;
}

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
  assert.equal(SMX_EVENT_ARCHIVE, archiveUrl);
  assert.equal(divisionKey("250 SMX"), "250");
  assert.equal(divisionKey("450 Moto #1"), "450");
  assert.equal(hostIsAllowed("www.supermotocross.com", "SMX"), true);
  assert.equal(hostIsAllowed("results.supermotocross.com", "SMX"), true);
  assert.equal(hostIsAllowed("example.com", "SMX"), false);

  const bothClassPage = `<!doctype html><html><head><title>SMX Results</title></head><body>
    <h2>250 SMX Overall Results</h2><table><tr><th>Pos</th><th>#</th><th>Rider</th><th>Mfr</th><th>Result</th><th>Team</th></tr><tr><td>1</td><td>37</td><td>Cole Davies</td><td>Yamaha</td><td>1-1</td><td>Star Yamaha</td></tr></table>
    <h2>450 SMX Overall Results</h2><table><tr><th>Pos</th><th>#</th><th>Rider</th><th>Mfr</th><th>Result</th><th>Team</th></tr><tr><td>1</td><td>38</td><td>Haiden Deegan</td><td>Yamaha</td><td>1-1</td><td>Star Yamaha</td></tr></table>
  </body></html>`;
  const only250 = parseHtml(bothClassPage, "SMX Results", { series: "SMX", division: "250", url: "https://www.supermotocross.com/results/2026/event/overall/250/" });
  assert.equal(only250.rows.length, 1);
  assert.equal(only250.rows[0].name, "Cole Davies");
  assert.equal(only250.rows[0].number, "37");
  const only450 = parseHtml(bothClassPage, "SMX Results", { series: "SMX", division: "450", url: "https://www.supermotocross.com/results/2026/event/overall/450/" });
  assert.equal(only450.rows.length, 1);
  assert.equal(only450.rows[0].name, "Haiden Deegan");
  assert.throws(() => parseHtml(resultPage("450", [[1, 38, "Haiden Deegan", "1:15.2"]]), "450 Moto #1", { series: "SMX", division: "250", url: "https://www.supermotocross.com/results/2026/event/450-moto-1/" }), /selected.*250|250.*official/i);

  const moto250Url = "https://www.supermotocross.com/results/2026/smx-world-championship-final-ridgedale-mo/250-moto-1/";
  const moto450Url = "https://www.supermotocross.com/results/2026/smx-world-championship-final-ridgedale-mo/450-moto-1/";
  const moto250Page = resultPage("250", [[1, 37, "COLE DAVIES", "1:15.698", "Waitoki, New Zealand"], [2, 47, "LEVI KITCHEN", "1:16.693"]]);
  const moto450Page = resultPage("450", [[1, 38, "HAIDEN DEEGAN", "1:15.252"], [2, 26, "JORGE PRADO", "1:15.924"]]);

  const imported250 = await withMockFetch({ [archiveUrl]: archivePage, [eventUrl]: eventPage, [moto250Url]: moto250Page }, async calls => {
    const result = await fetchOfficialResults({
      url: "https://www.supermotocross.com/results", series: "SMX", division: "250",
      event: "SMX World Championship Final", eventDate: "2026-09-26", eventType: "Motocross", phase: "Moto 1"
    });
    assert.deepEqual(calls, [archiveUrl, eventUrl, moto250Url]);
    return result;
  });
  assert.equal(imported250.division, "250");
  assert.equal(imported250.sessionTitle, "250 Moto #1");
  assert.deepEqual(imported250.rows.map(row => row.number), ["37", "47"]);
  assert.equal(imported250.rows[0].name, "COLE DAVIES", "use image alt text instead of hometown text");
  assert.equal(imported250.rows[0].hometown, "Waitoki, New Zealand", "the HTML rider cell retains the adjacent hometown separately from the rider name");
  assert.equal(imported250.rows[0].bestLap, "1:15.698");

  const imported450 = await withMockFetch({ [archiveUrl]: archivePage, [eventUrl]: eventPage, [moto450Url]: moto450Page }, async calls => {
    const result = await fetchOfficialResults({
      url: "https://www.supermotocross.com/results", series: "SMX", division: "450",
      event: "SMX World Championship Final", eventDate: "2026-09-26", eventType: "Motocross", phase: "Moto 1"
    });
    assert.deepEqual(calls, [archiveUrl, eventUrl, moto450Url]);
    return result;
  });
  assert.equal(imported450.division, "450");
  assert.deepEqual(imported450.rows.map(row => row.number), ["38", "26"]);

  const leaderPlate = parseHtml(resultPage("250", [[1, "1W", "HAIDEN DEEGAN", "0:53.297"]]), "250 Main Event Results", { series: "SMX", division: "250", url: "https://www.supermotocross.com/results/2026/san-diego/250-main-event/" });
  assert.equal(leaderPlate.rows[0].number, "1W", "preserve official points-leader plate suffixes");

  // A direct event-page URL also resolves to the selected class rather than importing a mixed page.
  await withMockFetch({ [eventUrl]: eventPage, [moto250Url]: moto250Page }, async calls => {
    const result = await fetchOfficialResults({
      url: eventUrl, series: "SMX", division: "250", eventType: "Motocross", phase: "Moto 1"
    });
    assert.deepEqual(calls, [eventUrl, moto250Url]);
    assert.equal(result.division, "250");
  });

  // Main-event and Overall routes use distinct class-specific URL patterns.
  const sxEventUrl = "https://www.supermotocross.com/results/2026/san-diego/";
  const sxEventPage = `<!doctype html><html><head><title>San Diego Results | SuperMotocross</title></head><body>
    <h1>San Diego</h1><h2>250</h2>
    <a href="/results/2026/san-diego/250-heat-1/">Results</a>
    <a href="/results/2026/san-diego/250-heat-2/">Results</a>
    <a href="/results/2026/san-diego/250-main-event/">Results</a>
    <a href="/results/2026/san-diego/combined/250/">250 Combined Qualifying</a>
    <a href="/results/2026/san-diego/overall/250/">250 Overall Results</a>
    <h2>450</h2><a href="/results/2026/san-diego/450-main-event/">Results</a><a href="/results/2026/san-diego/overall/450/">450 Overall Results</a>
  </body></html>`;
  const sx250Url = "https://www.supermotocross.com/results/2026/san-diego/250-main-event/";
  const sx250Heat1Url = "https://www.supermotocross.com/results/2026/san-diego/250-heat-1/";
  const sx250Heat2Url = "https://www.supermotocross.com/results/2026/san-diego/250-heat-2/";
  const sx250CombinedUrl = "https://www.supermotocross.com/results/2026/san-diego/combined/250/";
  const sx250Page = resultPage("250", [[1, 1, "HAIDEN DEEGAN", "0:53.297 (6)"], [2, 47, "LEVI KITCHEN", "0:52.950 (5)"]], "Main Event");
  const sx250Heat1Page = resultPage("250", [[1, 61, "MAX ANSTIE", "0:52.870 (4)"]], "Heat #1");
  const sx250Heat2Page = resultPage("250", [[1, 37, "COLE DAVIES", "0:53.100 (3)"]], "Heat #2");
  const sx250CombinedPage = resultPage("250", [[1, "1W", "HAIDEN DEEGAN", "0:51.012"]], "Combined Qualifying");
  const sxImportMap = { [sxEventUrl]: sxEventPage, [sx250Url]: sx250Page, [sx250Heat1Url]: sx250Heat1Page, [sx250Heat2Url]: sx250Heat2Page, [sx250CombinedUrl]: sx250CombinedPage };
  await withMockFetch(sxImportMap, async calls => {
    const result = await fetchOfficialResults({ url: sxEventUrl, series: "SMX", division: "250", eventType: "Supercross", supercrossFormat: "Standard" });
    assert.deepEqual(calls, [sxEventUrl, sx250Url, sx250Heat1Url, sx250Heat2Url, sx250CombinedUrl]);
    assert.equal(result.sessionTitle, "250 Main Event");
    assert.deepEqual(result.heatWinners.map(winner => [winner.heatNumber, winner.name, winner.number]), [[1, "MAX ANSTIE", "61"], [2, "COLE DAVIES", "37"]]);
    assert.equal(result.fastestQualifier.name, "HAIDEN DEEGAN");
    assert.equal(result.fastestQualifierSessionTitle, "Combined Qualifying");
    assert.equal(result.fastestLap.name, "LEVI KITCHEN", "the fastest main-event Best Lap value should be selected, including the lap-number suffix");
  });

  // A direct Main Event result URL should also discover and fetch both heats and Combined Qualifying.
  await withMockFetch(sxImportMap, async calls => {
    const result = await fetchOfficialResults({ url: sx250Url, series: "SMX", division: "250", eventType: "Supercross", supercrossFormat: "Standard" });
    assert.deepEqual(calls, [sxEventUrl, sx250Url, sx250Heat1Url, sx250Heat2Url, sx250CombinedUrl]);
    assert.equal(result.heatWinners.length, 2);
  });

  // Triple Crown Supercross must not try to award standard heat-winner or combined-qualifying bonuses.
  const sxTriplePage = `<!doctype html><html><head><title>San Diego Results</title></head><body><h1>San Diego</h1><h2>250</h2><a href="/results/2026/san-diego/250-main-event/">Main</a><a href="/results/2026/san-diego/overall/250/">Overall</a><a href="/results/2026/san-diego/250-heat-1/">Heat</a><a href="/results/2026/san-diego/250-heat-2/">Heat</a><a href="/results/2026/san-diego/combined/250/">Combined</a></body></html>`;
  const sxOverallUrl = "https://www.supermotocross.com/results/2026/san-diego/overall/250/";
  const sxOverallPage = resultPage("250", [[1, 1, "HAIDEN DEEGAN", "0:53.297"]], "Overall Results");
  await withMockFetch({ [sxEventUrl]: sxTriplePage, [sxOverallUrl]: sxOverallPage }, async calls => {
    const result = await fetchOfficialResults({ url: sxEventUrl, series: "SMX", division: "250", eventType: "Supercross", supercrossFormat: "Triple Crown" });
    assert.deepEqual(calls, [sxEventUrl, sxOverallUrl]);
    assert.deepEqual(result.heatWinners, []);
    assert.equal(result.fastestQualifier, null);
  });

  const csv = "Position,Number,Rider,Class,Team\n1,37,Cole Davies,250,Star Yamaha\n1,38,Haiden Deegan,450,Star Yamaha";
  const csv250 = require("../race-results-import").parseCsv(csv, "SMX export", { series: "SMX", division: "250" });
  assert.deepEqual(csv250.rows.map(row => row.name), ["Cole Davies"]);

  console.log("SMX importer tests passed: official event archive, separate heat winners, combined qualifying, main-event Best Lap extraction, direct Supercross links, Triple Crown isolation, strict 250/450 filtering and CSV class filtering.");
})().catch(error => { console.error(error); process.exitCode = 1; });
