"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  fetchOfficialResults,
  parseTcsEventResults,
  parseHtml,
  mxgpSessionOptionMatches,
  chooseMxgpRoundOption,
  parseMxgpClassificationPdfText,
  findMxgpClassificationPdfLink,
  parseMxgpPageWithPdfFallback,
  resolveMxgpOfficialPage,
  hostIsAllowed,
  OFFICIAL_HOSTS_BY_SERIES,
  MOTOGP_API_BASE,
  MOTOGP_API_BASES,
  motogpFastLapRiderPdfUrl,
  motogpClassificationPdfUrl,
  parseMotoGPClassificationPdfText,
  readMotoGPApiJson,
  parseMotoGPFastLapRiderText,
  motogpSessionMatches,
  motogpPositionNumber,
  motogpStatsClassificationUrl,
  parseMotoGPStatsClassificationHtml,
  motogpFastestQualifierFromRows
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

function mxgpFilterPage(stage, selected = {}) {
  const renderOptions = (options, value) => options.map(option =>
    `<option value="${option.value}"${option.value === value ? " selected" : ""}>${option.text}</option>`
  ).join("");
  const placeholder = [{ value: "", text: "Select..." }];
  const championship = [
    { value: "championship-other", text: "FIM Snowcross World Championship" },
    { value: "championship-mxgp", text: "FIM Motocross World Championship" }
  ];
  const classes = stage >= 1 ? [
    { value: "class-mxgp", text: "MXGP" },
    { value: "class-mx2", text: "MX2" }
  ] : placeholder;
  const rounds = stage >= 2 ? [
    { value: "round-gbr", text: "Grand Prix of Great Britain" },
    { value: "round-spa", text: "Grand Prix of Spain" }
  ] : placeholder;
  const sessions = stage >= 3 ? [
    { value: "session-qualifying", text: "Race Qualifying" },
    { value: "session-race-1", text: "Grand Prix Race 1" },
    { value: "session-race-2", text: "Grand Prix Race 2" }
  ] : placeholder;
  const select = (name, options) => `<select name="${name}" onchange="__doPostBack('${name}','')">${renderOptions(options, selected[name] ?? options[0].value)}</select>`;
  return `<!doctype html><html><head><title>Results Infront Moto Racing</title></head><body>
    <form method="post" action="/reslists.aspx">
      <input type="hidden" name="__VIEWSTATE" value="fixture-state">
      ${select("ctl$Championship", championship)}
      ${select("ctl$Class", classes)}
      ${select("ctl$Round", rounds)}
      ${select("ctl$Session", sessions)}
    </form>
  </body></html>`;
}

function json(body) { return { body: JSON.stringify(body), type: "application/json; charset=utf-8" }; }

(async () => {
  // Official domain allow-list includes the JSON results service used by the MotoGP results archive.
  assert.equal(hostIsAllowed("triplecrownseries.ca", "Triple Crown Series"), true);
  assert.equal(hostIsAllowed("results.mxgp.com", "MXGP"), true);
  assert.equal(hostIsAllowed("api.pulselive.motogp.com", "MotoGP"), true);
  assert.equal(hostIsAllowed("api.motogp.pulselive.com", "MotoGP"), true, "documented official MotoGP results API host is allowed");
  assert.equal(hostIsAllowed("example.com", "MotoGP"), false);
  assert.ok(OFFICIAL_HOSTS_BY_SERIES.MotoGP.includes("api.pulselive.motogp.com"));
  assert.equal(hostIsAllowed("resources.motogp.com", "MotoGP"), true, "MotoGP result PDFs are served from the official resources host");
  assert.equal(hostIsAllowed("resources.motogp.pulselive.com", "MotoGP"), true, "current MotoGP resources host is allow-listed");
  assert.equal(mxgpSessionOptionMatches("Qualifying Race", "Qualifying Race"), true);
  assert.equal(mxgpSessionOptionMatches("Race Qualifying", "Qualifying Race"), true);
  assert.equal(mxgpSessionOptionMatches("Race Qualifying", "Race Qualifying"), true);
  assert.equal(mxgpSessionOptionMatches("Grand Prix Race 1", "Moto 1"), true);
  assert.equal(mxgpSessionOptionMatches("Grand Prix Race 2", "Moto 2"), true);
  assert.equal(mxgpSessionOptionMatches("Race 2", "Moto 2"), true);
  assert.equal(mxgpSessionOptionMatches("Moto 2", "Moto 2"), true);
  assert.equal(mxgpSessionOptionMatches("Race 2", "Moto 1"), false);
  assert.equal(mxgpSessionOptionMatches("Qualifying", "Qualifying Race"), true);
  assert.equal(mxgpSessionOptionMatches("Grand Prix Race 2", "Moto 1"), false);
  assert.equal(mxgpSessionOptionMatches("Grand Prix Race 1", "Moto 2"), false);

  // Event identity must take priority over round/date metadata. In particular,
  // a single stale French option must not be silently accepted for Great Britain.
  {
    const roundControl = { options: [
      { value: "4113", text: "Grand Prix of France" },
      { value: "4116", text: "Grand Prix of Great Britain" }
    ] };
    assert.equal(chooseMxgpRoundOption(roundControl, {
      event: "Grand Prix of Great Britain", eventLocation: "Foxhills, Great Britain",
      round: 20, eventDate: "2026-10-04"
    }).value, "4116");
    assert.throws(() => chooseMxgpRoundOption({ options: [{ value: "4113", text: "Grand Prix of France" }] }, {
      event: "Grand Prix of Great Britain", eventLocation: "Foxhills, Great Britain"
    }), /did not match any official Grand Prix round/i);
  }

  // Official classification PDFs are a fallback when the results portal
  // returns a page shell rather than its HTML classification table.
  {
    const pdfRows = [
      "Race 1 (MXGP) - Classification",
      "Pos Nat. Nation Rider Fed. Motorcycle Total Tm. Gap1 Speed Points",
      "1 NED The Netherlands 57 HERLINGS, Jeffrey KNMV Honda 35:15.127 0.000 51.163 1",
      "2 ESP Spain 28 PRADO, Jorge RFME KTM 35:27.162 12.035 50.873 2",
      "Fastest lap by HERLINGS, Jeffrey; 1:47.954 in lap 7 with 55.690km/h"
    ].join("\n");
    const parsedPdf = parseMxgpClassificationPdfText(pdfRows, "MXGP PDF", { division: "MXGP", phase: "Moto 1" });
    assert.equal(parsedPdf.rows.length, 2);
    assert.equal(parsedPdf.rows[0].name, "Jeffrey HERLINGS");
    assert.equal(parsedPdf.rows[0].number, "57");
    assert.equal(parsedPdf.fastestLap.name, "Jeffrey HERLINGS");
    assert.equal(parsedPdf.fastestLap.bestLap, "1:47.954");
    const wrongPdf = pdfRows.replace("Race 1 (MXGP)", "Race 3 (MXGP + Open)");
    assert.throws(() => parseMxgpClassificationPdfText(wrongPdf, "MXGP PDF", { division: "MXGP", phase: "Moto 1" }), /not Moto 1/i);

    const pdfLink = findMxgpClassificationPdfLink(
      '<a href="https://docs.mxgp.com/resultservice/ResPDF/2026/event/RaceClassification.pdf">Download result as PDF</a>',
      "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4113&type=351&y=2026"
    );
    assert.match(pdfLink.href, /docs\.mxgp\.com\/.+RaceClassification\.pdf/i);

    await assert.rejects(() => parseMxgpPageWithPdfFallback({
      body: '<html><body><h2>Race 3 (MXGP + Open) - Classification</h2></body></html>',
      title: "Results Infront Moto Racing",
      contentType: "text/html; charset=utf-8",
      finalUrl: new URL("https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4113&type=351&y=2026")
    }, { division: "MXGP", phase: "Moto 1" }), /not Moto 1/i,
    "a shell response exposing the 2026 MXON Race 3 caption must be rejected as Moto 1 before fallback");
  }

  // Regression test for the official standings iframe filter order:
  // Championship -> Class -> Grand Prix -> Session. The mock intentionally
  // withholds class options until the championship is posted and round
  // options until the class is posted, matching the portal's dependencies.
  {
    const originalFetch = global.fetch;
    const selectionPostbacks = [];
    let filterStage = 0;
    global.fetch = async (input, init = {}) => {
      const requestUrl = new URL(String(input));
      const method = String(init.method || "GET").toUpperCase();
      if (requestUrl.pathname === "/mxgp/standings.aspx") {
        return new Response('<html><body><iframe src="/reslists.aspx"></iframe></body></html>', {
          status: 200, headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
      if (requestUrl.pathname !== "/reslists.aspx") throw new Error(`Unexpected MXGP test URL: ${requestUrl.href}`);
      if (method === "GET") {
        if (requestUrl.searchParams.has("type")) {
          return new Response(mxgpPage("MXGP - Grand Prix Race 2 - Classification", [
            { pos: 1, number: 243, name: "Guillem Farres", bestLap: "1:55.113" },
            { pos: 2, number: 26, name: "Liam Everts", bestLap: "1:56.075" }
          ]), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
        }
        return new Response(mxgpFilterPage(0), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      const posted = new URLSearchParams(String(init.body || ""));
      const eventTarget = posted.get("__EVENTTARGET");
      selectionPostbacks.push(eventTarget);
      const selected = {
        "ctl$Championship": posted.get("ctl$Championship") || "",
        "ctl$Class": posted.get("ctl$Class") || "",
        "ctl$Round": posted.get("ctl$Round") || "",
        "ctl$Session": posted.get("ctl$Session") || ""
      };
      if (eventTarget === "ctl$Championship") filterStage = 1;
      else if (eventTarget === "ctl$Class") filterStage = 2;
      else if (eventTarget === "ctl$Round") filterStage = 3;
      else if (eventTarget === "ctl$Session") {
        filterStage = 4;
        return new Response(mxgpPage("MXGP - Grand Prix Race 2 - Classification", [
          { pos: 1, number: 243, name: "Guillem Farres", bestLap: "1:55.113" },
          { pos: 2, number: 26, name: "Liam Everts", bestLap: "1:56.075" }
        ]), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      } else {
        throw new Error(`Unexpected MXGP filter postback: ${eventTarget}`);
      }
      return new Response(mxgpFilterPage(filterStage, selected), {
        status: 200, headers: { "content-type": "text/html; charset=utf-8" }
      });
    };
    try {
      const resolved = await resolveMxgpOfficialPage("https://results.mxgp.com/mxgp/standings.aspx", {
        division: "MXGP", event: "Great Britain", eventLocation: "Great Britain", phase: "Moto 2"
      });
      assert.deepEqual(selectionPostbacks, ["ctl$Championship", "ctl$Class", "ctl$Round", "ctl$Session"],
        "the importer posts championship, class, Grand Prix, and session in the order required by the live filter dependencies");
      assert.deepEqual(resolved.selections, [
        "FIM Motocross World Championship", "MXGP", "Grand Prix of Great Britain", "Grand Prix Race 2"
      ]);
      assert.equal(resolved.parsed.rows[0].name, "Guillem Farres");
      assert.equal(resolved.parsed.fastestLap.name, "Guillem Farres");
    } finally {
      global.fetch = originalFetch;
    }
  }
  assert.equal(MOTOGP_API_BASE, "https://api.motogp.pulselive.com/motogp/v1");
  assert.equal(MOTOGP_API_BASES[1], "https://api.pulselive.motogp.com/motogp/v1");
  await withMockFetch({
    "https://api.motogp.pulselive.com/motogp/v1/results/seasons": json([{ id: "primary-season", year: 2025 }]),
    "https://api.pulselive.motogp.com/motogp/v1/results/seasons": json([{ id: "alternate-season", year: 2025 }])
  }, async calls => {
    const result = await readMotoGPApiJson("results/seasons");
    assert.deepEqual(calls, [
      "https://api.motogp.pulselive.com/motogp/v1/results/seasons"
    ], "the long-standing documented MotoGP API host is tried first");
    assert.equal(result.json[0].id, "primary-season");
  });
  await withMockFetch({
    "https://api.motogp.pulselive.com/motogp/v1/results/seasons": { body: "Forbidden by edge", status: 403, type: "text/plain" },
    "https://api.pulselive.motogp.com/motogp/v1/results/seasons": json([{ id: "alternate-season", year: 2025 }])
  }, async calls => {
    const result = await readMotoGPApiJson("results/seasons");
    assert.deepEqual(calls, [
      "https://api.motogp.pulselive.com/motogp/v1/results/seasons",
      "https://api.pulselive.motogp.com/motogp/v1/results/seasons"
    ], "a 403 from the primary official API host falls back to the alternate official host");
    assert.equal(result.json[0].id, "alternate-season");
  });
  await withMockFetch({
    "https://api.motogp.pulselive.com/motogp/v1/results/seasons": { body: "Primary blocked", status: 403, type: "text/plain" },
    "https://api.pulselive.motogp.com/motogp/v1/results/seasons": { body: "Alternate blocked", status: 403, type: "text/plain" }
  }, async () => {
    await assert.rejects(
      readMotoGPApiJson("results/seasons"),
      error => /HTTP 403/.test(error.message) && /api.motogp.pulselive.com/.test(error.message) && /api.pulselive.motogp.com/.test(error.message) && /Primary blocked/.test(error.message) && /Alternate blocked/.test(error.message),
      "when both hosts refuse the call, return both exact request targets and upstream response details"
    );
  });

  // The Fast Lap Rider PDF is a ranked table; some official PDF exports omit
  // the heading from their extractable text, so row structure is authoritative.
  const fastLapText = [
    "1 73 Alex MARQUEZ SPA Gresini Racing MotoGP DUCATI 2'10.415 3 10",
    "2 72 Marco BEZZECCHI ITA Mooney VR46 Racing Team DUCATI 2'10.453 9 10 0.038 0.038",
    "3 5 Johann ZARCO FRA Prima Pramac Racing DUCATI 2'10.735 8 10 0.320 0.282"
  ].join("\n");
  const parsedFastLap = parseMotoGPFastLapRiderText(fastLapText, "British GP Sprint Fast Lap Rider");
  assert.deepEqual(parsedFastLap.rows.map(row => [row.position, row.number, row.name, row.bestLap]), [
    [1, "73", "Alex MARQUEZ", "2'10.415"],
    [2, "72", "Marco BEZZECCHI", "2'10.453"],
    [3, "5", "Johann ZARCO", "2'10.735"]
  ]);
  const parsedRacePdf = parseMotoGPClassificationPdfText([
    "MOTOGP RACE CLASSIFICATION",
    "Pos Pts # Rider Nation Team Motorcycle Total Time Km/h Gap",
    "1 25 93 Rider Alpha SPA Team Alpha DUCATI 39'37.244 179.3",
    "2 20 72 Rider Beta ITA Team Beta APRILIA 39'38.976 179.1 1.732",
    "Not classified",
    "25 Rider Gamma FRA Team Gamma APRILIA 34'16.402 175.3 4 laps",
    "Not finished first lap",
    "21 Rider Delta ITA Team Delta DUCATI"
  ].join("\n"), "Test RAC", "RAC");
  assert.deepEqual(parsedRacePdf.rows.map(row => [row.position, row.displayPosition, row.name, row.status, row.bestLap]), [
    [1, "1", "Rider Alpha", "", ""],
    [2, "2", "Rider Beta", "", ""],
    [3, "NC", "Rider Gamma", "NC", ""],
    [4, "DNF", "Rider Delta", "DNF", ""]
  ], "official Classification PDFs preserve classified and unclassified groups in source order without treating race times as fastest laps");
  const parsedQ2Pdf = parseMotoGPClassificationPdfText([
    "MOTOGP QUALIFYING 2 CLASSIFICATION",
    "Pos # Rider Nation Team Motorcycle Time Gap",
    "1 93 Rider Alpha SPA Team Alpha DUCATI 1'30.123",
    "2 72 Rider Beta ITA Team Beta APRILIA 1'30.456 0.333"
  ].join("\n"), "Test Q2", "Q2");
  assert.equal(motogpFastestQualifierFromRows(parsedQ2Pdf.rows).name, "Rider Alpha", "Q2 PDF lap time is parsed as the fastest qualifier source");
  assert.equal(motogpClassificationPdfUrl({ file: "https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/FastLapRider.pdf" }).href,
    "https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/Classification.pdf", "Fast Lap Rider metadata resolves to its paired official session Classification PDF for position fallback");
  assert.equal(motogpClassificationPdfUrl({ file: "https://resources.motogp.pulselive.com/files/results/2026/QAT/MotoGP/Q2/FastLapRider.pdf" }).href,
    "https://resources.motogp.pulselive.com/files/results/2026/QAT/MotoGP/Q2/Classification.pdf", "the current MotoGP resources hostname is preserved when resolving the paired Classification PDF");
  assert.equal(motogpFastLapRiderPdfUrl({ file: "https://resources.motogp.com/files/results/2023/GBR/MotoGP/SPR/Classification.pdf" }).href,
    "https://resources.motogp.com/files/results/2023/GBR/MotoGP/SPR/FastLapRider.pdf", "SPR classification resolves to the Fast Lap Rider PDF in the same session folder");
  assert.equal(motogpFastLapRiderPdfUrl({ files: [{ label: "Fast Lap Rider", href: "https://resources.motogp.com/files/results/2023/GBR/MotoGP/RAC/FastLapRider.pdf" }] }).href,
    "https://resources.motogp.com/files/results/2023/GBR/MotoGP/RAC/FastLapRider.pdf", "a directly published Fast Lap Rider hyperlink is preferred when present");
  assert.equal(motogpFastLapRiderPdfUrl({ session_files: [{ name: "Fast Lap Rider", path: "/files/results/2023/GBR/MotoGP/SPR/FastLapRider.pdf" }] }).href,
    "https://resources.motogp.com/files/results/2023/GBR/MotoGP/SPR/FastLapRider.pdf", "relative Fast Lap Rider file paths are resolved against the official resources host");

  // The official session list may identify Q2 as type Q + a descriptive label,
  // rather than using Q2 as the raw type code. Race / sprint codes must remain exact.
  assert.equal(motogpSessionMatches({ id: "q2", type: "Q", name: "Qualifying 2", number: 2 }, "Q2"), true);
  assert.equal(motogpSessionMatches({ id: "q2", session_shortname: "Q2" }, "Q2"), true);
  assert.equal(motogpSessionMatches({ id: "q1", type: "Q", name: "Qualifying 1", number: 1 }, "Q2"), false);
  assert.equal(motogpPositionNumber("01:52.345"), 0, "lap times must never be converted into race positions");
  assert.equal(motogpPositionNumber("1'52.345"), 0, "apostrophe-formatted lap times must never become race positions");
  assert.equal(motogpPositionNumber("12"), 12);
  assert.equal(motogpPositionNumber({ value: "3" }), 3);
  const unresolvedRaceRows = require("../race-results-import").motogpClassificationRows([
    { position: "01:52.345", status: "INSTND", rider: { full_name: "Test Rider", number: 11 }, best_lap: { time: "01:52.345" } }
  ], "Test RAC", "RAC").rows;
  assert.equal(unresolvedRaceRows[0].position, 0, "a lap time is not a race finishing position");
  assert.equal(unresolvedRaceRows[0].status, "", "an unresolved rank is not falsely labelled NC");
  assert.equal(unresolvedRaceRows[0].requiresPositionFallback, true, "incomplete positions trigger official Stats classification fallback");
  const unresolvedWithoutNumber = require("../race-results-import").motogpClassificationRows([
    { position: "01:53.001", status: "INSTND", rider: { full_name: "Rider Missing Number" } }
  ], "Test RAC", "RAC").rows;
  assert.equal(unresolvedWithoutNumber.length, 1, "a named official rider row is retained even when the API omits its race number");
  assert.equal(unresolvedWithoutNumber[0].requiresPositionFallback, true);
  assert.equal(motogpStatsClassificationUrl({ file: "https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/Classification.pdf" }).href,
    "https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/Classification.pdf");
  assert.equal(motogpStatsClassificationUrl({}, { session: { session_files: [{ name: "Fast Lap Rider", href: "https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/FastLapRider.pdf" }] } }).href,
    "https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/Classification.pdf", "session metadata Fast Lap Rider links resolve to the paired Classification PDF, not the protected Stats page");
  assert.equal(motogpStatsClassificationUrl({}, { event: { short_name: "QAT" }, year: 2026, sessionCode: "Q2" }).href,
    "https://resources.motogp.com/files/results/2026/QAT/MotoGP/Q2/Classification.pdf", "event short code can identify the selected session Classification PDF when no file URL is attached");

  const motoGpStatsHtml = `<!doctype html><html><body><table>
    <tr><th>Pos.</th><th>Points</th><th>Rider</th><th>Nation</th><th>Team</th><th>Bike</th><th>Km/h</th><th>Time/Gap</th></tr>
    <tr><td>1</td><td>25</td><td><span>72</span> <a>Marco Bezzecchi</a></td><td>IT</td><td>Aprilia Racing</td><td>Aprilia</td><td>171.1</td><td>41'29.173</td></tr>
    <tr><td>2</td><td>20</td><td><span>93</span> <a>Marc Marquez</a></td><td>ES</td><td>Ducati Lenovo Team</td><td>Ducati</td><td>170.9</td><td>+3.083</td></tr>
    <tr><td colspan="8">Non-classified riders</td></tr>
    <tr><td></td><td></td><td><span>33</span> <a>Brad Binder</a></td><td>ZA</td><td>Red Bull KTM Factory Racing</td><td>KTM</td><td>166.4</td><td>31'01.657</td></tr>
  </table></body></html>`;
  const parsedMotoGpStats = parseMotoGPStatsClassificationHtml(motoGpStatsHtml, "Qatar RAC", "RAC");
  assert.deepEqual(parsedMotoGpStats.rows.map(row => [row.position, row.displayPosition, row.name, row.status]), [
    [1, "1", "Marco Bezzecchi", ""], [2, "2", "Marc Marquez", ""], [3, "NC", "Brad Binder", "NC"]
  ], "official Stats table positions are read from Pos. and unclassified riders stay in source order");
  const q2Html = `<!doctype html><html><body><table>
    <tr><th>Pos.</th><th>Rider</th><th>Team</th><th>Time/Gap</th></tr>
    <tr><td>1</td><td>93 Marc Marquez</td><td>Ducati Lenovo Team</td><td>01:31.432</td></tr>
    <tr><td>2</td><td>72 Marco Bezzecchi</td><td>Aprilia Racing</td><td>01:31.201</td></tr>
  </table></body></html>`;
  const parsedQ2Html = parseMotoGPStatsClassificationHtml(q2Html, "Qatar Q2", "Q2");
  assert.equal(motogpFastestQualifierFromRows(parsedQ2Html.rows).name, "Marco Bezzecchi", "Q2 fastest qualifier is selected from the lowest Q2 lap time");

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
  const mx2Html = mxgpPage("MX2 - Grand Prix Race 2 - Classification", [
    { pos: 1, number: 99, name: "Farres, Guillem", bestLap: "1:55.113", bike: "Triumph" },
    { pos: 2, number: 26, name: "Everts, Liam", bestLap: "1:56.075", bike: "Husqvarna" }
  ]);
  const mx2Result = parseHtml(mx2Html, "MXGP results", { series: "MXGP", division: "MX2", phase: "Moto 2" });
  assert.equal(mx2Result.rows[0].name, "Guillem Farres", "MXGP comma-form names normalize to first-name last-name");
  assert.equal(mx2Result.rows[0].number, "99");
  assert.equal(mx2Result.rows[0].bestLap, "1:55.113");
  // The live Infront page can render the session caption in a DIV rather than
  // an H2/H3; session verification must still read that actual page caption.
  const mxgpDivHeadingHtml = mx2Html.replace("<h2>MX2 - Grand Prix Race 2 - Classification</h2>", "<div class=\"session-title\">MX2 - Grand Prix Race 2 - Classification</div>");
  assert.equal(parseHtml(mxgpDivHeadingHtml, "MXGP results", { series: "MXGP", division: "MX2", phase: "Moto 2" }).rows[0].name, "Guillem Farres");
  assert.throws(() => parseHtml(mx2Html, "MXGP results", { series: "MXGP", division: "MXGP", phase: "Moto 2" }), /selected MXGP.*labelled MX2/i);
  assert.throws(() => parseHtml(mx2Html, "MXGP results", { series: "MXGP", division: "MX2", phase: "Moto 1" }), /not Moto 1/i);

  const mxgpQualUrl = "https://results.mxgp.com/reslists.aspx?view=classification&ct=1&c=9&e=4104&type=11";
  const mxgpQualHtml = mxgpPage("MXGP - Qualifying Race - Classification", [
    { pos: 1, number: 84, name: "Herlings, Jeffrey", bestLap: "1:43.111" },
    { pos: 2, number: 1, name: "Febvre, Romain", bestLap: "1:43.187", bike: "Kawasaki" }
  ]);
  const mxgpQual = parseHtml(mxgpQualHtml, "MXGP qualifying", { series: "MXGP", division: "MXGP", phase: "Qualifying Race" });
  assert.equal(mxgpQual.rows[0].name, "Jeffrey Herlings");
  assert.throws(() => parseHtml(mxgpQualHtml, "MXGP qualifying", { series: "MXGP", division: "MXGP", phase: "Moto 1" }), /not Moto 1/i);
  assert.equal(parseHtml(mxgpQualHtml, "MXGP qualifying", { series: "MXGP", division: "MXGP", phase: "Race Qualifying" }).rows[0].name, "Jeffrey Herlings");

  // The MXGP importer must navigate the official four-filter workflow in
  // order: championship -> class -> Grand Prix of round -> session. Explicit
  // selectedValues are carried between requests even if the source HTML omits
  // selected attributes on previously chosen dropdowns.
  // Deliberately supply the stale URL from the reported failure. For MXGP,
  // this query must never be fetched as-is: the importer must revisit the
  // Standings page and select the current event/class/session from context.
  const mxgpPortalUrl = "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4113&type=351&y=2026";
  const mxgpFilterForm = `<!doctype html><html><body><form action="/reslists.aspx" method="get">
    <select id="championship" name="ct"><option value="">Select Championship</option><option value="1">FIM Motocross World Championship</option><option value="2">FIM Motocross of Nations</option></select>
    <select id="class" name="c"><option value="">Select Class</option><option value="9">MXGP</option><option value="7">MX2</option></select>
    <select id="round" name="e"><option value="">Select Round</option><option value="4104">Grand Prix of Argentina</option><option value="4105">Grand Prix of Spain</option></select>
    <select id="session" name="type"><option value="">Select Session</option><option value="11">Qualifying Race</option><option value="12">Grand Prix Race 1</option><option value="13">Grand Prix Race 2</option></select>
    <input type="hidden" name="view" value="classification">
  </form></body></html>`;
  const mxgpFilteredResult = mxgpPage("MX2 - Grand Prix Race 2 - Classification", [
    { pos: 1, number: 99, name: "Farres, Guillem", bestLap: "1:55.113", bike: "Triumph" },
    { pos: 2, number: 26, name: "Everts, Liam", bestLap: "1:54.912", bike: "Husqvarna" }
  ]);
  await withMockFetch({
    "https://results.mxgp.com/mxgp/standings.aspx": '<html><iframe src="/reslists.aspx"></iframe></html>',
    "https://results.mxgp.com/reslists.aspx": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=&e=&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=7&e=&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=7&e=4104&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=7&e=4104&type=13&view=classification": mxgpFilteredResult,
    "https://results.mxgp.com/reslists.aspx?view=classification&ct=1&c=7&e=4104&type=13&y=2026": mxgpFilteredResult
  }, async calls => {
    const result = await fetchOfficialResults({
      url: mxgpPortalUrl, series: "MXGP", division: "MX2", event: "Grand Prix of Argentina",
      eventLocation: "Villa La Angostura, Argentina", round: 3, eventDate: "2026-04-12", phase: "Moto 2"
    });
    assert.equal(result.eventTitle, "Grand Prix of Argentina");
    assert.equal(result.sessionTitle, "Grand Prix Race 2");
    assert.equal(new URL(result.fetchedUrl).searchParams.get("view"), "classification", "the official hidden classification view parameter is retained in the final request");
    assert.deepEqual(result.filterSelections, ["FIM Motocross World Championship", "MX2", "Grand Prix of Argentina", "Grand Prix Race 2"]);
    assert.equal(result.rows[0].name, "Guillem Farres");
    assert.equal(result.fastestLap.name, "Liam Everts", "the minimum Bestlaptime in the selected MX2 race is identified for the fastest-lap bonus");
    assert.equal(calls.includes(mxgpPortalUrl), false, "the stale filtered URL is never fetched directly");
    assert.deepEqual(calls, [
      "https://results.mxgp.com/mxgp/standings.aspx",
      "https://results.mxgp.com/reslists.aspx",
      "https://results.mxgp.com/reslists.aspx?ct=1&c=&e=&type=&view=classification",
      "https://results.mxgp.com/reslists.aspx?ct=1&c=7&e=&type=&view=classification",
      "https://results.mxgp.com/reslists.aspx?ct=1&c=7&e=4104&type=&view=classification",
      "https://results.mxgp.com/reslists.aspx?ct=1&c=7&e=4104&type=13&view=classification",
      "https://results.mxgp.com/reslists.aspx?view=classification&ct=1&c=7&e=4104&type=13&y=2026"
    ], "the importer submits all four official dropdown selections in the requested order");
  });

  await withMockFetch({
    "https://results.mxgp.com/mxgp/standings.aspx": '<html><iframe src="/reslists.aspx"></iframe></html>',
    "https://results.mxgp.com/reslists.aspx": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=&e=&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4104&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4104&type=11&view=classification": mxgpPage("MXGP - Qualifying Race - Classification", [
      { pos: 1, number: 84, name: "Herlings, Jeffrey", bestLap: "1:43.111" },
      { pos: 2, number: 1, name: "Febvre, Romain", bestLap: "1:43.187" }
    ]),
    "https://results.mxgp.com/reslists.aspx?view=classification&ct=1&c=9&e=4104&type=11": mxgpPage("MXGP - Qualifying Race - Classification", [
      { pos: 1, number: 84, name: "Herlings, Jeffrey", bestLap: "1:43.111" },
      { pos: 2, number: 1, name: "Febvre, Romain", bestLap: "1:43.187" }
    ])
  }, async calls => {
    const result = await fetchOfficialResults({
      url: mxgpPortalUrl, series: "MXGP", division: "MXGP", event: "Grand Prix of Argentina",
      eventLocation: "Argentina", round: 3, phase: "Qualifying Race"
    });
    assert.equal(result.rows[0].name, "Jeffrey Herlings");
    assert.equal(result.fastestLap.name, "Jeffrey Herlings");
    assert.ok(calls.every(url => !new URL(url).searchParams.has("s")), "the old unrecognized `s` session parameter is never sent");
    assert.equal(new URL(calls.at(-1)).searchParams.get("type"), "11");
  });

  // A stale Motocross of Nations classification URL must also be ignored
  // when the requested session is Moto 1. The importer must select the GP
  // event and the official Grand Prix Race 1 option from the filters.
  const mxgpMoto1StaleUrl = "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4113&type=351&y=2026";
  const mxgpMoto1Html = mxgpPage("MXGP - Grand Prix Race 1 - Classification", [
    { pos: 1, number: 84, name: "Herlings, Jeffrey", bestLap: "1:43.111" },
    { pos: 2, number: 1, name: "Febvre, Romain", bestLap: "1:43.187" }
  ]);
  await withMockFetch({
    "https://results.mxgp.com/mxgp/standings.aspx": '<html><iframe src="/reslists.aspx"></iframe></html>',
    "https://results.mxgp.com/reslists.aspx": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=&e=&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4104&type=&view=classification": mxgpFilterForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4104&type=12&view=classification": mxgpMoto1Html,
    "https://results.mxgp.com/reslists.aspx?view=classification&ct=1&c=9&e=4104&type=12": mxgpMoto1Html
  }, async calls => {
    const result = await fetchOfficialResults({
      url: mxgpMoto1StaleUrl, series: "MXGP", division: "MXGP", event: "Grand Prix of Argentina",
      eventLocation: "Argentina", round: 3, phase: "Moto 1"
    });
    assert.equal(result.sessionTitle, "Grand Prix Race 1");
    assert.equal(result.rows[0].name, "Jeffrey Herlings");
    assert.equal(new URL(result.fetchedUrl).searchParams.get("type"), "12");
    assert.equal(calls.includes(mxgpMoto1StaleUrl), false, "the stale Race 3 URL is never fetched for Moto 1");
    assert.equal(calls.at(-1), "https://results.mxgp.com/reslists.aspx?view=classification&ct=1&c=9&e=4104&type=12");
  });

  // Short-form portal session labels must resolve to the requested race,
  // including Moto 2, without accidentally selecting Race 1.
  const shortSessionForm = mxgpFilterForm.replace('<option value="11">Qualifying Race</option><option value="12">Grand Prix Race 1</option><option value="13">Grand Prix Race 2</option>', '<option value="11">Qualifying</option><option value="12">Race 1</option><option value="13">Race 2</option>');
  await withMockFetch({
    "https://results.mxgp.com/mxgp/standings.aspx": '<html><iframe src="/reslists.aspx"></iframe></html>',
    "https://results.mxgp.com/reslists.aspx": shortSessionForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=&e=&type=&view=classification": shortSessionForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=&type=&view=classification": shortSessionForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4104&type=&view=classification": shortSessionForm,
    "https://results.mxgp.com/reslists.aspx?ct=1&c=9&e=4104&type=13&view=classification": mxgpPage("MXGP - Grand Prix Race 2 - Classification", [
      { pos: 1, number: 84, name: "Herlings, Jeffrey", bestLap: "1:43.111" }
    ]),
    "https://results.mxgp.com/reslists.aspx?view=classification&ct=1&c=9&e=4104&type=13": mxgpPage("MXGP - Grand Prix Race 2 - Classification", [
      { pos: 1, number: 84, name: "Herlings, Jeffrey", bestLap: "1:43.111" }
    ])
  }, async () => {
    const result = await fetchOfficialResults({ url: mxgpPortalUrl, series: "MXGP", division: "MXGP", event: "Grand Prix of Argentina", phase: "Moto 2" });
    assert.equal(result.sessionTitle, "Race 2");
    assert.equal(result.rows[0].name, "Jeffrey Herlings");
  });

  // The portal may use ASP.NET WebForms postbacks. Retain viewstate + the
  // ASP.NET session cookie, and submit __EVENTTARGET for each dropdown change.
  const mxgpWebForms = `<!doctype html><html><body><form action="/reslists.aspx" method="post">
    <input type="hidden" name="__VIEWSTATE" value="viewstate-v1">
    <select id="ctl00$filters$championship" name="ctl00$filters$championship" onchange="javascript:__doPostBack('ctl00$filters$championship','')"><option value="">Select Championship</option><option value="1">FIM Motocross World Championship</option></select>
    <select id="ctl00$filters$round" name="ctl00$filters$round" onchange="javascript:__doPostBack('ctl00$filters$round','')"><option value="">Select Round</option><option value="5101">Grand Prix of France</option></select>
    <select id="ctl00$filters$class" name="ctl00$filters$class" onchange="javascript:__doPostBack('ctl00$filters$class','')"><option value="">Select Class</option><option value="9">MXGP</option><option value="7">MX2</option></select>
    <select id="ctl00$filters$session" name="ctl00$filters$session" onchange="javascript:__doPostBack('ctl00$filters$session','')"><option value="">Select Session</option><option value="1">Qualifying Race</option><option value="2">Grand Prix Race 1</option><option value="3">Grand Prix Race 2</option></select>
  </form></body></html>`;
  const originalMxgpFetch = global.fetch;
  const mxgpPostRequests = [];
  let mxgpInitialRequestDone = false;
  try {
    global.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (!mxgpInitialRequestDone) {
        mxgpInitialRequestDone = true;
        return new Response(mxgpWebForms, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "ASP.NET_SessionId=mxgp-test-session; path=/; HttpOnly" } });
      }
      const body = new URLSearchParams(String(init.body || ""));
      mxgpPostRequests.push({ method: init.method || "GET", url: url.href, body, headers: init.headers });
      if (url.searchParams.get("type") === "3" || body.get("ctl00$filters$session") === "3") {
        return new Response(mxgpPage("MXGP - Grand Prix Race 2 - Classification", [
          { pos: 1, number: 84, name: "Herlings, Jeffrey", bestLap: "1:43.111" },
          { pos: 2, number: 1, name: "Febvre, Romain", bestLap: "1:43.187" }
        ]), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response(mxgpWebForms, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    };
    const result = await fetchOfficialResults({
      url: "https://results.mxgp.com/", series: "MXGP", division: "MXGP", event: "MXGP of France",
      eventLocation: "Ernee, France", round: 8, phase: "Moto 2"
    });
    assert.equal(result.rows[0].name, "Jeffrey Herlings");
    assert.equal(result.fastestLap.name, "Jeffrey Herlings");
    assert.equal(mxgpPostRequests.filter(request => request.method === "POST").length, 4, "four filter changes are submitted to the official WebForms page");
    assert.equal(mxgpPostRequests.at(-1).url, "https://results.mxgp.com/reslists.aspx?view=classification&ct=1&c=9&e=5101&type=3", "the final URL preserves the official classification view flag as well as the four selected filters");
    const webFormsPosts = mxgpPostRequests.filter(request => request.method === "POST");
    assert.deepEqual(webFormsPosts.map(request => request.body.get("__EVENTTARGET")), [
      "ctl00$filters$championship", "ctl00$filters$class", "ctl00$filters$round", "ctl00$filters$session"
    ]);
    assert.ok(webFormsPosts.every(request => request.body.get("__VIEWSTATE") === "viewstate-v1"));
    assert.ok(webFormsPosts.every(request => String(request.headers.Cookie || "").includes("ASP.NET_SessionId=mxgp-test-session")), "session cookies are retained across dropdown postbacks");
  } finally {
    global.fetch = originalMxgpFetch;
  }

  // A direct filtered reslists URL remains supported as a manual override.
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

  let pdfJsInstalled = false;
  try { require.resolve("pdfjs-dist/legacy/build/pdf.mjs"); pdfJsInstalled = true; } catch { /* Dependencies are installed by npm install on Render. */ }
  if (pdfJsInstalled) {
    // MotoGP official archive is resolved through the live results JSON service, preserving the selected Grand Prix / Sprint tab.
    const api = MOTOGP_API_BASE;
    const seasonUrl = `${api}/results/seasons`;
    const eventsUrl = `${api}/results/events?seasonUuid=season-2026&isFinished=true`;
    const categoriesUrl = `${api}/results/categories?eventUuid=event-qatar`;
    const sessionsUrl = `${api}/results/sessions?eventUuid=event-qatar&categoryUuid=category-motogp`;
    const raceUrl = `${api}/results/session/race-qatar/classification?seasonYear=2026&test=false`;
    const sprintUrl = `${api}/results/session/sprint-qatar/classification?seasonYear=2026&test=false`;
    const q2Url = `${api}/results/session/q2-qatar/classification?seasonYear=2026&test=false`;
    const raceFastLapUrl = "https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/FastLapRider.pdf";
    const sprintFastLapUrl = "https://resources.motogp.com/files/results/2026/QAT/MotoGP/SPR/FastLapRider.pdf";
    const pdfStub = { body: Buffer.from("%PDF-1.4 mock pdf"), type: "application/pdf" };
    const apiMap = {
      [seasonUrl]: json([{ id: "season-2026", year: 2026, current: true }]),
      [eventsUrl]: json([{ id: "event-qatar", name: "Qatar Grand Prix", short_name: "QAT", date: "2026-11-08", round: 20, circuit: { name: "Lusail International Circuit" } }]),
      [categoriesUrl]: json([{ id: "category-motogp", name: "MotoGP" }]),
      [sessionsUrl]: json([
        { id: "race-qatar", type: "RAC", name: "Grand Prix", session_files: [{ name: "Fast Lap Rider", href: raceFastLapUrl }] },
        { id: "sprint-qatar", type: "SPR", name: "Sprint", session_files: [{ name: "Fast Lap Rider", href: sprintFastLapUrl }] },
        { id: "q2-qatar", type: "Q", name: "Qualifying 2", number: 2,
          session_files: [{ name: "Fast Lap Rider", href: "https://resources.motogp.com/files/results/2026/QAT/MotoGP/Q2/FastLapRider.pdf" }] }
      ]),
      [raceUrl]: json({
        // Regression case: the JSON provider sometimes exposes a lap-time string
        // where the importer expects a numeric position. The Stats page must be
        // used for the actual race order instead of converting these rows to NC.
        classification: [
          { position: "01:52.123", status: "INSTND", rider: { full_name: "Marco Bezzecchi", number: 72 }, team: { name: "Aprilia Racing" }, best_lap: { time: "01:52.123" } },
          { position: "01:52.245", status: "INSTND", rider: { full_name: "Marc Marquez", number: 93 }, team: { name: "Ducati Lenovo Team" }, best_lap: { time: "01:52.245" } }
        ],
        sections: [
          { title: "Non-classified riders", rows: [
            { rider: { full_name: "Toprak Razgatlioglu", number: 7 }, team: { name: "Prima Pramac Yamaha MotoGP" } },
            { rider: { full_name: "Raul Fernandez", number: 25 }, team: { name: "Trackhouse MotoGP Team" } }
          ] },
          { title: "Riders who did not finish first lap", rows: [
            { rider: { full_name: "Franco Morbidelli", number: 21 }, team: { name: "Pertamina Enduro VR46 Racing Team" } }
          ] }
        ]
      }),
      [sprintUrl]: json({
        file: sprintFastLapUrl.replace("FastLapRider.pdf", "Classification.pdf"),
        classification: [
          { position: 1, rider: { full_name: "Marc Marquez", number: 93 }, team: { name: "Ducati Lenovo Team" } },
          { position: 2, rider: { full_name: "Marco Bezzecchi", number: 72 }, team: { name: "Aprilia Racing" } }
        ],
        non_classified_riders: [
          { rider: { full_name: "Toprak Razgatlioglu", number: 7 }, team: { name: "Prima Pramac Yamaha MotoGP" } }
        ]
      }),
      [raceFastLapUrl]: pdfStub,
      [sprintFastLapUrl]: pdfStub,
      ["https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/Classification.pdf"]: { body: fs.readFileSync(path.join(__dirname, "fixtures", "motogp-rac-classification.pdf")), type: "application/pdf" },
      [q2Url]: json([
        { position: "01:31.500", rider: { full_name: "Francesco Bagnaia", number: 63 }, team: { name: "Ducati Lenovo Team" }, time: "01:31.500" },
        { position: "01:31.200", rider: { full_name: "Marco Bezzecchi", number: 72 }, team: { name: "Aprilia Racing" }, time: "01:31.200" }
      ]),
      ["https://resources.motogp.com/files/results/2026/QAT/MotoGP/Q2/Classification.pdf"]: { body: fs.readFileSync(path.join(__dirname, "fixtures", "motogp-q2-classification.pdf")), type: "application/pdf" }
    };
    const motogpRace = await withMockFetch(apiMap, async calls => {
      const result = await fetchOfficialResults({ url: "https://www.motogp.com/en/gp-results/", series: "MotoGP", event: "Qatar Grand Prix", round: 20, eventDate: "2026-11-08", phase: "Grand Prix" });
      assert.deepEqual(calls, [seasonUrl, eventsUrl, categoriesUrl, sessionsUrl, raceUrl,
        "https://resources.motogp.com/files/results/2026/QAT/MotoGP/RAC/Classification.pdf", raceFastLapUrl, q2Url,
        "https://resources.motogp.com/files/results/2026/QAT/MotoGP/Q2/Classification.pdf"]);
      return result;
    });
    assert.equal(motogpRace.rows[0].name, "Marco Bezzecchi");
    assert.equal(motogpRace.rows[0].number, "72");
    assert.equal(motogpRace.rows[0].bestLap, "", "race time/gap cells must not be mistaken for lap times");
    assert.deepEqual(motogpRace.rows.map(row => [row.position, row.displayPosition, row.name, row.status]), [
      [1, "1", "Marco Bezzecchi", ""],
      [2, "2", "Marc Marquez", ""],
      [3, "NC", "Toprak Razgatlioglu", "NC"],
      [4, "NC", "Raul Fernandez", "NC"],
      [5, "DNF", "Franco Morbidelli", "DNF"]
    ], "RAC retains every non-classified rider in the order displayed after the classified finishers");
    assert.equal(motogpRace.fastestQualifier.name, "Marco Bezzecchi", "Q2 fastest qualifier follows the best Q2 lap, even if a row's displayed position does not match the time order");
    assert.equal(motogpRace.fastestQualifier.sourceUrl, "https://resources.motogp.com/files/results/2026/QAT/MotoGP/Q2/Classification.pdf", "fastest qualifier is sourced from the official Q2 Classification PDF, not the protected Stats page or RAC/SPR laps");
    assert.equal(motogpRace.fastestLap, null, "a malformed mocked PDF should not invent a fastest-lap rider");
    assert.ok(motogpRace.fastestLapError, "PDF parsing failures are returned as an explicit importer warning");
    assert.equal(motogpRace.fastestQualifierSessionTitle, "Qualifying 2");
    assert.equal(motogpRace.sessionTitle, "Grand Prix");

    const motogpSprint = await withMockFetch(apiMap, async calls => {
      const result = await fetchOfficialResults({ url: "https://www.motogp.com/en/gp-results/", series: "MotoGP", event: "Qatar Grand Prix", round: 20, eventDate: "2026-11-08", phase: "Sprint" });
      assert.deepEqual(calls, [seasonUrl, eventsUrl, categoriesUrl, sessionsUrl, sprintUrl, sprintFastLapUrl, q2Url,
        "https://resources.motogp.com/files/results/2026/QAT/MotoGP/Q2/Classification.pdf"]);
      return result;
    });
    assert.equal(motogpSprint.sessionTitle, "Sprint");
    assert.equal(motogpSprint.rows[0].name, "Marc Marquez", "Sprint selection uses the SPR classification, not the RAC classification");
    assert.deepEqual(motogpSprint.rows.map(row => [row.position, row.displayPosition, row.name]), [
      [1, "1", "Marc Marquez"], [2, "2", "Marco Bezzecchi"], [3, "NC", "Toprak Razgatlioglu"]
    ], "SPR also retains non-classified riders in official display order");
  } else {
    console.warn("MotoGP live PDF integration test skipped locally because pdfjs-dist is not installed. The dependency is declared in package.json and is installed by npm install on Render.");
  }

  console.log("TCS / MXGP / MXON / MotoGP importer tests passed: year-specific TCS event selection, strict TCS class and moto filtering, MXGP four-dropdown navigation (championship, class, Grand Prix round, session), strict class/session validation, Bestlaptime bonus extraction, MXON class/session validation, rider-number parsing, MotoGP RAC/SPR ordering including NC/DNF riders, Q2 fastest-qualifier routing, and session-specific Fast Lap Rider PDF resolution/parsing.");
})().catch(error => { console.error(error); process.exitCode = 1; });
