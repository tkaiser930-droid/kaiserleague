"use strict";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const SMX_EVENT_ARCHIVE = "https://www.supermotocross.com/results/";
const F1_RESULTS_ARCHIVE = "https://www.formula1.com/en/results";
const TCS_RESULTS_ARCHIVE = "https://triplecrownseries.ca/results";
const MXGP_RESULTS_ARCHIVE = "https://results.mxgp.com/";
const MOTOGP_RESULTS_ARCHIVE = "https://www.motogp.com/en/gp-results/";

const OFFICIAL_HOSTS_BY_SERIES = {
  SMX: ["supermotocross.com", "results.supermotocross.com", "supercross.com", "results.supercrosslive.com", "results.supercross.com"],
  "Triple Crown Series": ["triplecrownseries.ca", "cmrc.tracksideresults.com", "tracksideresults.com", "livelaps.com"],
  MXGP: ["mxgp.com", "results.mxgp.com", "docs.mxgp.com", "fim-moto.com"],
  MXON: ["mxgp.com", "results.mxgp.com", "docs.mxgp.com", "fim-moto.com"],
  F1: ["formula1.com"],
  MotoGP: ["motogp.com", "stats.motogp.com", "api.motogp.pulselive.com"]
};

function hostIsAllowed(hostname, series) {
  const allowed = OFFICIAL_HOSTS_BY_SERIES[series] || [];
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return allowed.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function normalizeHeader(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function divisionKey(value) {
  const text = String(value || "");
  const has250 = /(^|\D)250(\D|$)/i.test(text);
  const has450 = /(^|\D)450(\D|$)/i.test(text);
  return has250 === has450 ? "" : (has250 ? "250" : "450");
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function stripHtml(value) {
  return decodeEntities(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ").trim();
}

function cleanRiderName(value) {
  let name = String(value || "").trim()
    .replace(/^Image:\s*/i, "")
    .replace(/\b(Holeshot|Fastest Lap|DNF|DNS|DSQ)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  const leadingNumber = name.match(/^#?(\d{1,3})\s+(.+)$/);
  if (leadingNumber) name = leadingNumber[2];
  const parts = name.split(/\s+/);
  if (parts.length >= 3 && /^[A-Z]{3}$/.test(parts.at(-1)) && parts.slice(0, -1).some(part => /[a-z]/.test(part))) parts.pop();
  return parts.join(" ").trim();
}

function extractRiderCell(cellHtml) {
  const source = String(cellHtml || "");
  // SuperMotocross result tables wrap rider names in linked images. Prefer the
  // image's alt text so hometown / country text beside the image is not treated
  // as part of the athlete's name.
  const imageAlts = [...source.matchAll(/<img\b[^>]*\balt\s*=\s*(["'])(.*?)\1/gi)]
    .map(match => cleanRiderName(decodeEntities(match[2])))
    .filter(text => text && normalizeHeader(text) !== "image");
  if (imageAlts.length) return imageAlts[0];
  const anchors = [...source.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const anchor of anchors) {
    const text = stripHtml(anchor[1]);
    if (text && normalizeHeader(text) !== "image") return cleanRiderName(text);
  }
  return cleanRiderName(stripHtml(source));
}

function parsePosition(value) {
  const match = String(value || "").trim().match(/^(\d{1,3})(?:st|nd|rd|th)?(?:\s|\.|$)/i);
  return match ? Number(match[1]) : 0;
}

function cleanNumber(value) {
  // Preserve official championship plate suffixes such as 1W rather than
  // silently converting them to #1. The commissioner can still match by name.
  const match = String(value || "").trim().match(/#?\s*(\d{1,3}[A-Za-z]?)/);
  return match ? match[1] : "";
}

function findColumn(headers, patterns) {
  return headers.findIndex(header => patterns.some(pattern => pattern.test(normalizeHeader(header))));
}

function headerColumns(headers) {
  const position = findColumn(headers, [/^(pos|position|rank|place|finish|finishposition)$/]);
  const name = findColumn(headers, [/^(rider|driver|racer|competitor|athlete|name|ridername|drivername)$/]);
  return { position, name };
}

function normalizeRows(rawRows, sourceTitle, options = {}) {
  if (!Array.isArray(rawRows) || rawRows.length < 2) {
    throw new Error("No result rows were found. Use an official classification page or export its results as CSV.");
  }
  let headerIndex = -1, positionIndex = -1, nameIndex = -1;
  for (let i = 0; i < Math.min(rawRows.length, 30); i++) {
    const headers = rawRows[i].map(cell => String(cell || "").trim());
    const cols = headerColumns(headers);
    if (cols.position >= 0 && cols.name >= 0) {
      headerIndex = i; positionIndex = cols.position; nameIndex = cols.name; break;
    }
  }
  if (headerIndex < 0) {
    throw new Error("I couldn't identify the position and rider/driver columns. Use the official result table or a CSV with Position and Rider (or Driver) headers.");
  }
  const headers = rawRows[headerIndex].map(cell => String(cell || "").trim());
  let numberIndex = findColumn(headers, [/^(no|nr|number|racenumber|carnumber|ridernumber|ridernum|platenumber|plate)$/]);
  if (numberIndex < 0) numberIndex = headers.findIndex(header => String(header || "").trim() === "#");
  const teamIndex = findColumn(headers, [/^team/, /^raceteam/, /^constructor$/]);
  const bestLapIndex = findColumn(headers, [/^bestlap/, /^fastestlap/]);
  const divisionIndex = findColumn(headers, [/^(class|division|category|raceclass|seriesclass)$/]);
  const requestedDivision = options.series === "SMX" ? divisionKey(options.division) : "";
  const normalized = [];
  for (const [sourceOrder, cells] of rawRows.slice(headerIndex + 1).entries()) {
    if (!Array.isArray(cells)) continue;
    if (requestedDivision && divisionIndex >= 0) {
      const rowDivision = divisionKey(cells[divisionIndex]);
      if (rowDivision && rowDivision !== requestedDivision) continue;
    }
    const rawPosition = String(cells[positionIndex] || "").trim();
    const status = options.series === "F1" && /^NC$/i.test(rawPosition) ? "NC" : "";
    const position = parsePosition(rawPosition);
    const riderName = normalizeSeriesRiderName(cells[nameIndex], options.series);
    // Formula 1's official classifications display non-classified drivers as
    // NC after the numbered finishers. Keep those rows in source order and
    // give them sequential internal slots so they can be reviewed/imported.
    if ((!position && !status) || !riderName || ["rider", "driver"].includes(normalizeHeader(riderName))) continue;
    let number = numberIndex >= 0 ? cleanNumber(cells[numberIndex]) : "";
    if (!number) {
      const leadingNumber = String(cells[nameIndex] || "").trim().match(/^#?(\d{1,3})\s+.+$/);
      if (leadingNumber) number = leadingNumber[1];
    }
    normalized.push({
      position,
      displayPosition: status || String(position),
      status,
      sourceOrder,
      number,
      name: riderName,
      team: teamIndex >= 0 ? String(cells[teamIndex] || "").trim() : "",
      bestLap: bestLapIndex >= 0 ? String(cells[bestLapIndex] || "").trim() : ""
    });
  }
  if (options.series === "F1") {
    const lastClassifiedPosition = normalized.reduce((max, row) => Math.max(max, row.position || 0), 0);
    let nextNcPosition = lastClassifiedPosition + 1;
    for (const row of normalized) {
      if (row.status === "NC") row.position = nextNcPosition++;
    }
  }
  const unique = new Map();
  for (const row of normalized) {
    const key = `${row.status || "classified"}|${row.position}|${row.number}|${normalizeHeader(row.name)}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  const values = [...unique.values()];
  const results = options.series === "F1"
    ? values.sort((a, b) => a.sourceOrder - b.sourceOrder)
    : values.sort((a, b) => a.position - b.position);
  if (!results.length) throw new Error("The selected official results table contains no rider rows for the selected class.");
  return { title: sourceTitle || "Official race results", rows: results.slice(0, 100) };
}

function rowsFromCsv(csv) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const input = String(csv || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(cell => cell !== "")) rows.push(row);
  return rows;
}

function parseCsv(csv, sourceTitle = "Official CSV results", options = {}) {
  return normalizeRows(rowsFromCsv(csv), sourceTitle, options);
}

function extractHtmlTableRows(tableHtml) {
  const rows = [];
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  while ((tr = trRegex.exec(tableHtml))) {
    const cells = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellRegex.exec(tr[1]))) cells.push(cell[1]);
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

function latestHeadingBefore(html, index) {
  const before = String(html || "").slice(0, index);
  const headings = [...before.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)];
  return headings.length ? stripHtml(headings[headings.length - 1][2]) : "";
}

function parseHtmlTable(tableHtml, sourceTitle, options = {}) {
  const rawRows = extractHtmlTableRows(tableHtml);
  if (!rawRows.length) return null;
  let headerIndex = -1, nameIndex = -1;
  for (let i = 0; i < Math.min(rawRows.length, 20); i++) {
    const headers = rawRows[i].map(cell => stripHtml(cell));
    const cols = headerColumns(headers);
    if (cols.position >= 0 && cols.name >= 0) { headerIndex = i; nameIndex = cols.name; break; }
  }
  if (headerIndex < 0) return null;
  const mapped = rawRows.map((cells, rowIndex) => cells.map((cell, columnIndex) => {
    if (rowIndex > headerIndex && columnIndex === nameIndex) return extractRiderCell(cell);
    return stripHtml(cell);
  }));
  const headerCount = mapped[headerIndex].length;
  // Some live-timing result pages include lap-chart rows inside the same table.
  // Keep only rows shaped like the classification header; lap detail rows are shorter.
  const classificationRows = mapped.filter((cells, index) => index <= headerIndex || cells.length >= headerCount);
  try {
    const result = normalizeRows(classificationRows, sourceTitle, options);
    const normalizedHeaders = rawRows[headerIndex].map(cell => normalizeHeader(stripHtml(cell)));
    // Prefer the actual classification table over secondary tables such as
    // Hard Charger, which also contain Rank / Rider columns.
    const tableScore = (normalizedHeaders.includes("pos") ? 5 : 0)
      + (normalizedHeaders.some(value => value.startsWith("bestlap")) ? 5 : 0)
      + (normalizedHeaders.includes("team") ? 2 : 0)
      + (normalizedHeaders.includes("laps") ? 2 : 0)
      + (normalizedHeaders.includes("time") ? 2 : 0)
      + (normalizedHeaders.includes("interval") ? 2 : 0)
      + (normalizedHeaders.includes("result") ? 2 : 0);
    return { ...result, _tableScore: tableScore };
  } catch { return null; }
}

function parseHtml(html, sourceTitle = "Official race results", options = {}) {
  const source = String(html || "");
  const tableRegex = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
  const candidates = [];
  let table;
  while ((table = tableRegex.exec(source))) {
    const heading = latestHeadingBefore(source, table.index);
    const parsed = parseHtmlTable(table[0], sourceTitle, options);
    if (!parsed) continue;
    if (options.series === "SMX") {
      const target = divisionKey(options.division);
      const headingDivision = divisionKey(heading);
      const titleDivision = divisionKey(sourceTitle);
      const urlDivision = divisionKey(options.url || "");
      const detected = headingDivision || titleDivision || urlDivision;
      if (!target) throw new Error("Select 250 or 450 before importing official SMX results.");
      if (detected && detected !== target) continue;
      if (!detected) continue; // Never accept a mixed or unlabelled SMX table.
    }
    candidates.push({ ...parsed, tableHeading: heading });
  }
  if (candidates.length) {
    if (options.series === "SMX" && candidates.length > 1) {
      candidates.sort((a, b) => (b._tableScore || 0) - (a._tableScore || 0) || b.rows.length - a.rows.length);
    }
    const chosen = candidates[0];
    delete chosen._tableScore;
    if (options.series === "MXGP" || options.series === "MXON") return validateMxgpClassification(chosen, options);
    return chosen;
  }
  if (options.series === "SMX") {
    const target = divisionKey(options.division) || "selected";
    const pageDivision = divisionKey(`${sourceTitle} ${options.url || ""}`);
    if (pageDivision && pageDivision !== target) {
      throw new Error(`You selected ${target}, but this official results page is for ${pageDivision}. Open the ${target} result link for the same event and session.`);
    }
    throw new Error(`No ${target} results table was found. Open the selected event in the official SMX archive, then use its ${target} result link for the correct session (for example, ${target} Moto #1 or ${target} Overall Results).`);
  }
  if (/\b(position|pos)\b.{0,80}\b(rider|driver|name)\b/i.test(source) && source.includes(",")) return parseCsv(source, sourceTitle, options);
  throw new Error("The official page did not expose a readable results table. Try its direct session-results link or upload the official CSV export.");
}

function parseJsonResults(json, sourceTitle = "Official race results", options = {}) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error("The official result feed returned invalid JSON."); }
  const candidates = [];
  const visit = (value, depth = 0) => {
    if (depth > 7 || value == null) return;
    if (Array.isArray(value)) {
      if (value.length && value.every(item => item && typeof item === "object" && !Array.isArray(item))) candidates.push(value);
      else value.forEach(item => visit(item, depth + 1));
    } else if (typeof value === "object") Object.values(value).forEach(item => visit(item, depth + 1));
  };
  visit(parsed);
  for (const array of candidates.sort((a, b) => b.length - a.length)) {
    const keys = Object.keys(array[0]);
    const rawRows = [keys];
    array.forEach(item => rawRows.push(keys.map(key => String(item[key] ?? ""))));
    try { return normalizeRows(rawRows, sourceTitle, options); } catch { /* Check next candidate array. */ }
  }
  throw new Error("The official JSON feed did not contain recognizable position and rider/driver fields for the selected class.");
}

async function readLimitedResponse(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_SOURCE_BYTES) throw new Error("The official results page is larger than the 5 MB import limit.");
    return text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error("The official results page is larger than the 5 MB import limit."); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function fetchApprovedUrl(initialUrl, series) {
  let current = new URL(initialUrl.href);
  for (let hop = 0; hop <= 4; hop++) {
    if (current.protocol !== "https:" || current.username || current.password || (current.port && current.port !== "443") || !hostIsAllowed(current.hostname, series)) {
      throw new Error("The official source redirected outside its approved HTTPS domain list.");
    }
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "KaiserFamilyFantasySMXResultsImporter/1.1 (+official-results preview)",
        "Accept": "text/html,text/csv,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        ...(series === "MotoGP" ? { "Origin": "https://www.motogp.com", "Referer": "https://www.motogp.com/", "x-origin": "2" } : {})
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The official results source returned a redirect without a destination.");
      if (hop === 4) throw new Error("The official source redirected too many times.");
      current = new URL(location, current);
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error("The official results source could not be reached safely.");
}

async function readOfficialPage(url, series) {
  const { response, finalUrl } = await fetchApprovedUrl(url, series);
  if (!response.ok) throw new Error(`The official source returned HTTP ${response.status}. Check that the event results are published and the URL is correct.`);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const body = await readLimitedResponse(response);
  const sourceTitle = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  return { body, contentType, finalUrl, title: sourceTitle ? stripHtml(sourceTitle) : finalUrl.hostname };
}


// --- Official Triple Crown Series, MXGP / MXON and MotoGP source adapters ---
function normalizeSeriesRiderName(value, series) {
  const name = cleanRiderName(value);
  if (series === "MXGP" || series === "MXON") {
    const comma = name.match(/^\s*([^,]+),\s*(.+?)\s*$/);
    if (comma) return `${comma[2]} ${comma[1]}`.replace(/\s+/g, " ").trim();
  }
  return name;
}

function tcsDivisionKey(value) {
  const text = String(value || "").toLowerCase();
  if (/\b250\b/.test(text)) return "250";
  if (/\b450\b/.test(text)) return "450";
  if (/\bwmx\b/.test(text)) return "WMX";
  return "";
}

function mxgpDivisionKey(value) {
  const text = normalizeHeader(value);
  if (text.includes("mx2")) return "MX2";
  if (text.includes("mxgp")) return "MXGP";
  return "";
}

function resultYear(context = {}, url = null) {
  const dateYear = String(context.eventDate || "").match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  if (dateYear) return dateYear;
  const pathYear = String(url?.pathname || "").match(/^\/(\d{4})(?:\/|$)/)?.[1];
  if (pathYear) return pathYear;
  return String(new Date().getUTCFullYear());
}

function tcsEventLinkCandidates(html, baseUrl, context = {}, year = "") {
  const desiredRound = Number(context.round || 0);
  const desiredDate = String(context.eventDate || "").slice(0, 10);
  const nameTokens = normalizedEventTokens(`${context.event || ""} ${context.eventLocation || ""}`);
  const links = parseAnchorLinks(html, baseUrl).filter(link => {
    try {
      const target = new URL(link.href);
      return hostIsAllowed(target.hostname, "Triple Crown Series") && /\/events\/[^/]+\/?$/i.test(target.pathname);
    } catch { return false; }
  });
  const unique = [...new Map(links.map(link => [link.href, link])).values()];
  return unique.map(link => {
    let href = link.href;
    let parsed = new URL(href);
    let yearPath = !!year && parsed.pathname.includes(`/${year}/events/`);
    // The current TCS navigation points at the live event page (often next
    // season). Historical event pages live under /{year}/events/{slug}.
    // When importing a past season, prefer its archived route instead of
    // accidentally following the current-season navigation link.
    const targetYear = Number(year || 0);
    const currentYear = new Date().getUTCFullYear();
    if (year && targetYear < currentYear && !yearPath && /^\/events\//i.test(parsed.pathname)) {
      parsed.pathname = `/${year}${parsed.pathname}`;
      href = parsed.href;
      yearPath = true;
    }
    const text = `${link.text} ${link.linkText} ${link.contextText}`;
    const roundMatch = desiredRound > 0 && new RegExp(`\\bR(?:ound)?\\s*0?${desiredRound}\\b`, "i").test(text);
    const date = isoDate(text);
    const dateMatch = !!desiredDate && date === desiredDate;
    const tokens = normalizedEventTokens(text);
    const overlap = nameTokens.filter(token => tokens.includes(token)).length;
    const nameScore = nameTokens.length ? overlap / nameTokens.length : 0;
    const yearMatch = !year || yearPath;
    return { ...link, href, roundMatch, dateMatch, nameScore, yearMatch, yearPath };
  });
}

function chooseTcsEventLink(html, baseUrl, context = {}, year = "") {
  const links = tcsEventLinkCandidates(html, baseUrl, context, year);
  if (!links.length) return null;
  let candidates = links;
  const yearLinks = candidates.filter(link => link.yearPath);
  if (yearLinks.length) candidates = yearLinks;
  if (context.round) {
    const roundLinks = candidates.filter(link => link.roundMatch);
    if (roundLinks.length) candidates = roundLinks;
  }
  if (context.eventDate) {
    const dateLinks = candidates.filter(link => link.dateMatch);
    if (dateLinks.length === 1) return dateLinks[0];
    if (dateLinks.length) candidates = dateLinks;
  }
  if (context.event || context.eventLocation) {
    const best = Math.max(...candidates.map(link => link.nameScore));
    const nameLinks = candidates.filter(link => link.nameScore === best && best >= 0.35);
    if (nameLinks.length === 1) return nameLinks[0];
    if (nameLinks.length) candidates = nameLinks;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function tcsSlugCandidates(context = {}) {
  const values = [];
  const location = String(context.eventLocation || "").split(",")[0].trim();
  const event = String(context.event || "").trim();
  for (const value of [location, event]) {
    const slug = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (slug && !values.includes(slug)) values.push(slug);
  }
  const aliases = {
    "wild-rose-mx": "calgary", "prairie-hill-mx": "pilot-mound", "motocross-ste-julie": "ste-julie",
    "gopher-dunes-mx": "courtland", "riverglade-mx": "moncton", "sand-del-lee-mx": "ottawa",
    "mx-deschambault": "deschambault", "walton-raceway": "walton"
  };
  return [...new Set(values.flatMap(value => aliases[value] ? [value, aliases[value]] : [value]))];
}

async function resolveTcsEventPage(inputUrl, context = {}) {
  const supplied = new URL(inputUrl.href);
  if (/\/events\/[^/]+\/?$/i.test(supplied.pathname)) {
    const year = resultYear(context, supplied);
    const requestedYear = Number(year || 0);
    const currentYear = new Date().getUTCFullYear();
    if (requestedYear && requestedYear < currentYear && /^\/events\//i.test(supplied.pathname)) {
      supplied.pathname = `/${year}${supplied.pathname}`;
    }
    const page = await readOfficialPage(supplied, "Triple Crown Series");
    return { page, url: page.finalUrl.href, eventTitle: extractEventHeading(page), sessionTitle: "" };
  }

  const year = resultYear(context, supplied);
  const archiveUrl = new URL(`https://triplecrownseries.ca/${year}`);
  const archive = await readOfficialPage(archiveUrl, "Triple Crown Series");
  const link = chooseTcsEventLink(archive.body, archive.finalUrl.href, context, year);
  if (link) {
    const page = await readOfficialPage(new URL(link.href), "Triple Crown Series");
    return { page, url: page.finalUrl.href, eventTitle: extractEventHeading(page), sessionTitle: "" };
  }

  const slugs = tcsSlugCandidates(context);
  const basePaths = year ? [`/${year}/events/`, "/events/"] : ["/events/"];
  for (const base of basePaths) {
    for (const slug of slugs) {
      const candidate = new URL(`${base}${encodeURIComponent(slug)}`, "https://triplecrownseries.ca");
      try {
        const page = await readOfficialPage(candidate, "Triple Crown Series");
        const title = extractEventHeading(page);
        const wanted = normalizedEventTokens(`${context.event || ""} ${context.eventLocation || ""}`);
        const found = normalizedEventTokens(title);
        const overlap = wanted.filter(token => found.includes(token)).length;
        if (!wanted.length || overlap >= 1 || /round\s*0?\d+/i.test(title)) {
          return { page, url: page.finalUrl.href, eventTitle: title, sessionTitle: "" };
        }
      } catch (error) {
        if (/HTTP 404|HTTP 410/i.test(error.message || "")) continue;
        if (/redirected outside|too many redirects/i.test(error.message || "")) throw error;
      }
    }
  }

  const available = tcsEventLinkCandidates(archive.body, archive.finalUrl.href, {}, year)
    .map(item => item.text || item.linkText).filter(Boolean).slice(0, 8).join("; ");
  throw new Error(`Couldn't locate the official Triple Crown event page for ${context.event || `Round ${context.round || "?"}`} (${year}). Check the scheduled event name, round and venue. ${available ? `Available event links: ${available}.` : "Open the TCS event page and paste its direct URL."}`);
}

function extractTcsClassMarker(html, tableIndex, tableHtml, heading) {
  const openTag = String(tableHtml || "").match(/^\s*<table\b([^>]*)>/i)?.[1] || "";
  const attrs = `${openTag} ${String(tableHtml || "").slice(0, 220)}`;
  let detected = tcsDivisionKey(`${attrs} ${heading}`);
  if (detected) return detected;

  const before = String(html || "").slice(Math.max(0, tableIndex - 5000), tableIndex);
  const activePattern = /(\bactive\b|\bselected\b|\bcurrent\b|aria-selected\s*=\s*["']true|aria-pressed\s*=\s*["']true|aria-current\s*=\s*["']true|data-state\s*=\s*["']active|data-active\s*=\s*["']true)/i;
  const activeButtons = [...before.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi)]
    .map(match => ({ attrs: match[2], text: stripHtml(match[3]) }))
    .filter(item => tcsDivisionKey(`${item.attrs} ${item.text}`) && activePattern.test(item.attrs));
  if (activeButtons.length === 1) return tcsDivisionKey(`${activeButtons[0].attrs} ${activeButtons[0].text}`);
  const roleTabs = [...before.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\brole\s*=\s*["']tab["'][^>]*)>([\s\S]*?)<\/\1>/gi)]
    .map(match => ({ attrs: match[2], text: stripHtml(match[3]) }))
    .filter(item => tcsDivisionKey(`${item.attrs} ${item.text}`) && activePattern.test(item.attrs));
  if (roleTabs.length === 1) return tcsDivisionKey(`${roleTabs[0].attrs} ${roleTabs[0].text}`);

  // The official event pages render 450 Pro first by default when the class tab
  // state isn't represented in the serialized markup. Never infer 250 from that.
  if (/\b450\s*Pro\b/i.test(before) && !/\b250\s*Pro\b/i.test(before.slice(before.lastIndexOf("Full Event Results")))) return "450";
  return "";
}

function extractTcsRiderName(cellHtml) {
  let text = stripHtml(cellHtml);
  text = text.replace(/\bImage(?:Image)?\s*:?\s*/gi, " ")
    .replace(/\b(?:yamaha|honda|ktm|husqvarna|kawasaki|gasgas|gas\s*gas|beta|triumph|ducati|fantic|suzuki)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  return cleanRiderName(text);
}

function parseTcsEventResults(html, sourceTitle, context = {}) {
  const target = tcsDivisionKey(context.division);
  if (!target) throw new Error("Select CAN 250 or CAN 450 before importing Triple Crown Series results.");
  const phaseText = String(context.phase || "Moto 1").toLowerCase();
  const motoNumber = phaseText.includes("2") ? 2 : 1;
  const source = String(html || "");
  const tableRegex = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
  const candidates = [];
  let match;
  while ((match = tableRegex.exec(source))) {
    const tableHtml = match[0];
    const rawRows = extractHtmlTableRows(tableHtml);
    if (!rawRows.length) continue;
    let headerIndex = -1, columns = null;
    for (let index = 0; index < Math.min(rawRows.length, 20); index++) {
      const headers = rawRows[index].map(cell => stripHtml(cell));
      const normalized = headers.map(normalizeHeader);
      const pos = findColumn(headers, [/^(pos|position|rank)$/]);
      const number = findColumn(headers, [/^(no|number|nr|plate)$/]);
      const rider = findColumn(headers, [/^(rider|name|athlete)$/]);
      const moto1 = findColumn(headers, [/^moto1$/, /^race1$/]);
      const moto2 = findColumn(headers, [/^moto2$/, /^race2$/]);
      if (pos >= 0 && rider >= 0 && (moto1 >= 0 || moto2 >= 0)) {
        headerIndex = index; columns = { pos, number, rider, moto1, moto2 }; break;
      }
      if (pos >= 0 && rider >= 0 && number >= 0 && normalized.includes("team")) {
        headerIndex = index; columns = { pos, number, rider, moto1: -1, moto2: -1 }; break;
      }
    }
    if (headerIndex < 0 || !columns) continue;
    const heading = latestHeadingBefore(source, match.index);
    const classMarker = extractTcsClassMarker(source, match.index, tableHtml, heading);
    const requested = target;
    if (classMarker && classMarker !== requested) continue;
    if (!classMarker && requested !== "450") continue;

    const motoIndex = motoNumber === 2 ? columns.moto2 : columns.moto1;
    if (motoIndex < 0 && columns.moto1 >= 0) continue;
    const rows = [];
    for (const [sourceOrder, cells] of rawRows.slice(headerIndex + 1).entries()) {
      const name = extractTcsRiderName(cells[columns.rider] || "");
      if (!name || /^(rider|name)$/i.test(name)) continue;
      const motoFinish = motoIndex >= 0 ? parsePosition(stripHtml(cells[motoIndex] || "")) : parsePosition(stripHtml(cells[columns.pos] || ""));
      if (!motoFinish) continue; // A dash indicates no classified finish in that moto.
      const number = columns.number >= 0 ? cleanNumber(stripHtml(cells[columns.number] || "")) : "";
      rows.push({
        position: motoFinish,
        displayPosition: String(motoFinish),
        status: "",
        sourceOrder,
        number,
        name,
        team: "",
        bestLap: "",
        overallPosition: parsePosition(stripHtml(cells[columns.pos] || "")) || null
      });
    }
    if (rows.length) {
      rows.sort((a, b) => a.position - b.position || a.sourceOrder - b.sourceOrder);
      candidates.push({ title: `${sourceTitle} — ${target} Pro`, rows, tableHeading: heading, division: `CAN ${target}`, sessionTitle: `Moto ${motoNumber}`, _rows: rows.length });
    }
  }
  if (!candidates.length) {
    throw new Error(`The TCS event page did not expose a readable ${target} Pro ${motoNumber === 1 ? "Moto 1" : "Moto 2"} Full Event Results table. Open the selected event on the official Triple Crown Series site, confirm the ${target} Pro class tab is active, and try its direct event URL. Championship standings are not used as moto results.`);
  }
  candidates.sort((a, b) => b._rows - a._rows);
  const chosen = candidates[0];
  delete chosen._rows;
  return chosen;
}

function validateMxgpClassification(parsed, context = {}) {
  const series = context.series;
  const heading = String(parsed.tableHeading || "");
  const normalizedHeading = normalizeHeader(heading);
  const raceMatch = heading.match(/(?:race|moto)\s*([123])\b/i);
  const isQualifyingHeading = /qualifying/i.test(heading);
  if (series === "MXGP") {
    const target = mxgpDivisionKey(context.division);
    const detected = mxgpDivisionKey(heading);
    if (target && detected && target !== detected) {
      throw new Error(`You selected ${target}, but the official MXGP result page is labelled ${detected}. Select the matching class in the official results filters and fetch again.`);
    }
    const phase = normalizeHeader(context.phase || "");
    if (phase) {
      const raceNumber = phase.includes("moto2") ? "2" : phase.includes("moto1") ? "1" : "";
      const isQualifying = phase.includes("qualifyingrace");
      if (isQualifying && !isQualifyingHeading) {
        throw new Error(`The official MXGP page is ${heading || "not labelled as a qualifying classification"}, not the selected Qualifying Race. Choose the correct session in the results page and fetch again.`);
      }
      if (raceNumber && (isQualifyingHeading || (raceMatch && raceMatch[1] !== raceNumber))) {
        throw new Error(`The official MXGP page is ${heading}, not Moto ${raceNumber}. Choose the correct session in the results page and fetch again.`);
      }
    }
  }
  if (series === "MXON") {
    const phase = normalizeHeader(context.phase || "");
    if (phase.includes("mx2qualifyingrace") && (!/\bmx2\b/i.test(heading) || /mxgp\s*\+?\s*open/i.test(heading))) {
      throw new Error(`The official page is ${heading}, not the MXON MX2 Qualifying Race. Select the MXON MX2 classification and fetch again.`);
    }
    if (phase.includes("mxgpqualifyingrace") && (!/mxgp/i.test(heading) || /\bmx2\b/i.test(heading))) {
      throw new Error(`The official page is ${heading}, not the MXON MXGP Qualifying Race. Select the correct MXON classification and fetch again.`);
    }
    if (phase.includes("openqualifyingrace") && !/\bopen\b/i.test(heading)) {
      throw new Error(`The official page is ${heading}, not the MXON Open Qualifying Race. Select the correct MXON classification and fetch again.`);
    }
    const expectedRace = phase.includes("moto1") ? "1" : phase.includes("moto2") ? "2" : phase.includes("moto3") ? "3" : "";
    if (expectedRace && (isQualifyingHeading || (raceMatch && raceMatch[1] !== expectedRace))) {
      throw new Error(`The official page is ${heading}, not ${context.phase}. Select the matching MXON race and fetch again.`);
    }
  }
  return parsed;
}

async function readOfficialJson(url, series) {
  const { response, finalUrl } = await fetchApprovedUrl(url, series);
  if (!response.ok) throw new Error(`The official results service returned HTTP ${response.status}.`);
  const body = await readLimitedResponse(response);
  let json;
  try { json = JSON.parse(body); } catch { throw new Error("The official MotoGP results service returned invalid JSON."); }
  return { json, finalUrl };
}

function arrayFromPayload(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of keys) if (Array.isArray(payload[key])) return payload[key];
  for (const key of ["data", "results", "items", "content", "classification", "events", "sessions", "categories"]) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === "object") {
      const found = arrayFromPayload(payload[key], keys);
      if (found.length) return found;
    }
  }
  return [];
}

function motogpEventText(event) {
  return [event?.name, event?.event_name, event?.eventName, event?.sponsored_name, event?.sponsoredName, event?.official_name,
    event?.circuit?.name, event?.circuit?.short_name, event?.country?.name, event?.location?.name].filter(Boolean).join(" ");
}

function motogpEventDate(event) {
  for (const key of ["date", "start_date", "startDate", "event_date", "eventDate", "date_start", "start", "event_start_date"]) {
    const value = event?.[key];
    if (!value) continue;
    const date = isoDate(value);
    if (date) return date;
  }
  return "";
}

function motogpSessionCode(session) {
  const values = [session?.type, session?.code, session?.session_type, session?.sessionType, session?.name, session?.description]
    .map(value => typeof value === "object" ? (value.code || value.type || value.name || "") : String(value || ""));
  return normalizeHeader(values.join(" "));
}

function motogpClassificationRows(payload, sourceTitle) {
  const rows = arrayFromPayload(payload, ["classification", "results", "rows", "data"]);
  if (!rows.length) throw new Error("The official MotoGP classification response did not contain rider rows.");
  const mapped = [];
  rows.forEach((item, sourceOrder) => {
    const rider = item?.rider || item?.competitor || item?.athlete || {};
    const first = rider.first_name || rider.firstName || rider.given_name || "";
    const last = rider.last_name || rider.lastName || rider.family_name || "";
    const name = normalizeSeriesRiderName(rider.full_name || rider.fullName || rider.name || item.rider_name || item.riderName || `${first} ${last}`, "MotoGP");
    const positionValue = item.position ?? item.pos ?? item.rank ?? item.position_number ?? item.classification_position;
    const position = parsePosition(positionValue) || Number(positionValue) || 0;
    if (!name || !position) return;
    const lap = item.best_lap || item.bestLap || item.fastest_lap || item.fastestLap || {};
    const teamValue = item.team?.name || item.team_name || item.teamName || rider.team?.name || "";
    mapped.push({
      position,
      displayPosition: String(position),
      status: "",
      sourceOrder,
      number: cleanNumber(rider.number ?? item.rider_number ?? item.number ?? ""),
      name,
      team: String(teamValue || ""),
      bestLap: String(lap.time || lap.lap_time || lap.lapTime || item.best_lap_time || item.bestLapTime || "")
    });
  });
  mapped.sort((a, b) => a.position - b.position || a.sourceOrder - b.sourceOrder);
  if (!mapped.length) throw new Error("The official MotoGP classification had no classified riders.");
  return { title: sourceTitle, rows: mapped };
}

function chooseMotoGPEvent(events, context = {}, year = "") {
  const desiredDate = String(context.eventDate || "").slice(0, 10);
  const desiredRound = Number(context.round || 0);
  const desiredTokens = normalizedEventTokens(context.event || "").filter(token => !["grand", "prix", "gp", "motogp"].includes(token));
  let candidates = events.map(event => {
    const eventDate = motogpEventDate(event);
    const eventRound = Number(event.round || event.round_number || event.roundNumber || event.number || event.sequence || 0);
    const tokens = normalizedEventTokens(motogpEventText(event)).filter(token => !["grand", "prix", "gp", "motogp"].includes(token));
    const overlap = desiredTokens.filter(token => tokens.includes(token)).length;
    const nameScore = desiredTokens.length ? overlap / desiredTokens.length : 0;
    return { event, eventDate, eventRound, dateMatch: !!desiredDate && eventDate === desiredDate, nameScore };
  });
  if (desiredDate) {
    const exact = candidates.filter(item => item.dateMatch);
    if (exact.length === 1) return exact[0].event;
    if (exact.length > 1) candidates = exact;
    else if (desiredRound) {
      const near = candidates.filter(item => item.eventRound === desiredRound && item.eventDate && Math.abs(Date.parse(`${item.eventDate}T00:00:00Z`) - Date.parse(`${desiredDate}T00:00:00Z`)) <= 86400000);
      if (near.length === 1) return near[0].event;
    }
  }
  if (desiredRound) {
    const byRound = candidates.filter(item => item.eventRound === desiredRound);
    if (byRound.length === 1 && (!desiredTokens.length || byRound[0].nameScore >= 0.25)) return byRound[0].event;
    if (byRound.length) candidates = byRound;
  }
  if (desiredTokens.length) {
    const maxScore = Math.max(...candidates.map(item => item.nameScore));
    const best = candidates.filter(item => item.nameScore === maxScore && maxScore >= 0.5);
    if (best.length === 1) return best[0].event;
  }
  const examples = candidates.slice(0, 10).map(item => `${motogpEventText(item.event) || "Grand Prix"}${item.eventDate ? ` (${item.eventDate})` : ""}`).join("; ");
  throw new Error(`Couldn't uniquely match the scheduled MotoGP event${context.event ? ` “${context.event}”` : ""}${desiredDate ? ` on ${desiredDate}` : ""} in the official ${year} results archive. Check the event name/date. ${examples ? `Available events: ${examples}` : ""}`);
}

async function resolveMotoGPResults(context = {}) {
  const yearMatch = String(context.eventDate || "").match(/\b(19\d{2}|20\d{2})\b/);
  const seasonsUrl = new URL("https://api.motogp.pulselive.com/motogp/v1/results/seasons");
  const seasonsResponse = await readOfficialJson(seasonsUrl, "MotoGP");
  const seasons = arrayFromPayload(seasonsResponse.json, ["seasons", "results"]);
  const requestedYear = yearMatch?.[1] || "";
  const season = (requestedYear ? seasons.find(item => String(item.year) === requestedYear) : null) || seasons.find(item => item.current) || seasons[0];
  if (!season?.id) throw new Error(`The official MotoGP archive does not list season ${requestedYear || "current"}.`);
  const year = String(season.year || requestedYear || "");

  const eventsUrl = new URL("https://api.motogp.pulselive.com/motogp/v1/results/events");
  eventsUrl.searchParams.set("seasonUuid", season.id);
  eventsUrl.searchParams.set("isFinished", "true");
  const eventsResponse = await readOfficialJson(eventsUrl, "MotoGP");
  const events = arrayFromPayload(eventsResponse.json, ["events", "results"]);
  if (!events.length) throw new Error(`The official MotoGP archive has no published event results for ${year}.`);
  const event = chooseMotoGPEvent(events, context, year);
  const eventId = event.id || event.uuid;
  if (!eventId) throw new Error("The selected MotoGP event did not include an official event identifier.");

  const categoriesUrl = new URL("https://api.motogp.pulselive.com/motogp/v1/results/categories");
  categoriesUrl.searchParams.set("eventUuid", eventId);
  const categoriesResponse = await readOfficialJson(categoriesUrl, "MotoGP");
  const categories = arrayFromPayload(categoriesResponse.json, ["categories", "results"]);
  const category = categories.find(item => normalizeHeader(item.name || item.description || item.category) === "motogp" || /motogp/i.test(String(item.name || item.description || ""))) || categories.find(item => String(item.legacy_id || item.legacyId || "") === "3");
  if (!category?.id && !category?.uuid) throw new Error("The selected MotoGP weekend did not expose its MotoGP category in the official results service.");
  const categoryId = category.id || category.uuid;

  const sessionsUrl = new URL("https://api.motogp.pulselive.com/motogp/v1/results/sessions");
  sessionsUrl.searchParams.set("eventUuid", eventId);
  sessionsUrl.searchParams.set("categoryUuid", categoryId);
  const sessionsResponse = await readOfficialJson(sessionsUrl, "MotoGP");
  const sessions = arrayFromPayload(sessionsResponse.json, ["sessions", "results"]);
  const sprint = normalizeHeader(context.phase || "Grand Prix").includes("sprint");
  const raceCode = sprint ? "spr" : "rac";
  const raceSession = sessions.find(item => motogpSessionCode(item).includes(raceCode));
  if (!raceSession) throw new Error(`The official ${motogpEventText(event)} session list does not contain a ${sprint ? "Sprint" : "Grand Prix Race"} classification. Check the selected scoring tab and whether results have been published.`);
  const raceSessionId = raceSession.id || raceSession.uuid;
  if (!raceSessionId) throw new Error("The official MotoGP race session did not include a session identifier.");
  const classificationUrl = new URL(`https://api.motogp.pulselive.com/motogp/v1/results/session/${encodeURIComponent(raceSessionId)}/classification`);
  classificationUrl.searchParams.set("seasonYear", year);
  classificationUrl.searchParams.set("test", "false");
  const classificationResponse = await readOfficialJson(classificationUrl, "MotoGP");
  const eventTitle = motogpEventText(event) || `${year} MotoGP Grand Prix`;
  const sessionTitle = sprint ? "Sprint" : "Grand Prix";
  const result = motogpClassificationRows(classificationResponse.json, `${eventTitle} — ${sessionTitle}`);

  let fastestQualifier = null;
  let fastestQualifierError = "";
  const q2Session = sessions.find(item => motogpSessionCode(item).includes("q2"))
    || sessions.find(item => /qualifying\s*2/i.test(String(item.name || item.description || "")));
  if (q2Session?.id || q2Session?.uuid) {
    try {
      const q2Url = new URL(`https://api.motogp.pulselive.com/motogp/v1/results/session/${encodeURIComponent(q2Session.id || q2Session.uuid)}/classification`);
      q2Url.searchParams.set("seasonYear", year);
      q2Url.searchParams.set("test", "false");
      const q2Response = await readOfficialJson(q2Url, "MotoGP");
      fastestQualifier = motogpClassificationRows(q2Response.json, `${eventTitle} — Qualifying 2`).rows[0] || null;
      if (fastestQualifier) fastestQualifier.sourceUrl = q2Url.href;
    } catch (error) {
      fastestQualifierError = error.message || "Could not read the official MotoGP Qualifying 2 classification.";
    }
  } else {
    fastestQualifierError = "The official event session list did not include a Q2 classification.";
  }
  return {
    ...result,
    source: "https://www.motogp.com/en/gp-results/",
    fetchedUrl: classificationResponse.finalUrl.href,
    division: "MotoGP",
    eventTitle,
    sessionTitle,
    fastestLap: null,
    fastestQualifier,
    fastestQualifierSessionTitle: "Qualifying 2",
    fastestQualifierError
  };
}


function smxSessionLabelFromUrl(value) {
  let url;
  try { url = new URL(value); } catch { return ""; }
  const path = decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, "");
  let match = path.match(/\/(250|450)-moto-(1|2)$/);
  if (match) return `${match[1]} Moto #${match[2]}`;
  match = path.match(/\/(250|450)-main-event$/);
  if (match) return `${match[1]} Main Event`;
  match = path.match(/\/(250|450)-heat-(1|2)$/);
  if (match) return `${match[1]} Heat #${match[2]}`;
  match = path.match(/\/(250|450)-lcq$/);
  if (match) return `${match[1]} LCQ`;
  match = path.match(/\/overall\/(250|450)$/);
  if (match) return `${match[1]} Overall Results`;
  match = path.match(/\/(250|450)-combined-qualifying$/);
  if (match) return `${match[1]} Combined Qualifying`;
  return "";
}

function isModernSmxEventPage(url) {
  const host = String(url?.hostname || "").toLowerCase();
  const path = String(url?.pathname || "").replace(/\/+$/, "");
  return hostIsAllowed(host, "SMX") && host.endsWith("supermotocross.com") && /^\/results\/\d{4}\/[^/]+$/i.test(path);
}

function isModernSmxEventLink(value) {
  try { return isModernSmxEventPage(new URL(value)); } catch { return false; }
}

function parseAnchorLinks(html, baseUrl) {
  const links = [];
  const source = String(html || "");
  const re = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(source))) {
    const href = decodeEntities(match[3]);
    let url;
    try { url = new URL(href, baseUrl); } catch { continue; }
    const linkText = stripHtml(match[5]);
    const pathLabel = smxSessionLabelFromUrl(url.href);
    const rowText = rowTextAround(source, match.index);
    links.push({
      href: url.href,
      text: pathLabel || linkText,
      linkText,
      contextText: rowText || stripHtml(source.slice(Math.max(0, match.index - 180), Math.min(source.length, re.lastIndex + 180))),
      index: match.index
    });
  }
  return links;
}

function rowTextAround(html, index) {
  const source = String(html || "");
  const start = source.toLowerCase().lastIndexOf("<tr", index);
  const end = source.toLowerCase().indexOf("</tr>", index);
  if (start < 0 || end < 0) return "";
  return stripHtml(source.slice(start, end + 5));
}

function isoDate(value) {
  if (!value) return "";
  const match = String(value).match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/i);
  const date = match ? new Date(match[0]) : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function normalizedEventTokens(value) {
  const ignored = new Set(["smx", "supermotocross", "round", "event", "national", "championship"]);
  const plain = String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return plain.match(/[a-z]+|\d+/g)?.filter(token => !ignored.has(token)) || [];
}

function chooseArchiveEvent(html, archiveUrl, context) {
  const allLinks = parseAnchorLinks(html, archiveUrl.href);
  const links = allLinks.filter(link => {
    try {
      const url = new URL(link.href);
      if (url.searchParams.get("p") === "view_event") return true; // Legacy Live Timing archive.
      return isModernSmxEventLink(link.href); // Current supermotocross.com event archive.
    } catch { return false; }
  });
  const events = links.map(link => {
    // Use the containing result-list row for its date when available. A broad
    // nearby text slice can include the previous event's date on a non-table list.
    const rowText = rowTextAround(html, link.index);
    return { ...link, rowText: rowText || link.contextText || "", date: isoDate(rowText) };
  }).filter(event => event.text && !/^results?$/i.test(event.text));
  if (!events.length) throw new Error("The official SuperMotocross results archive did not return its event list. Open the archive in a browser and try again later.");

  const desiredName = String(context.event || "").trim();
  const desiredDate = isoDate(context.eventDate);
  const desiredTokens = normalizedEventTokens(desiredName);
  let candidates = events.map(event => {
    const candidateTokens = normalizedEventTokens(event.text);
    const overlap = desiredTokens.filter(token => candidateTokens.includes(token)).length;
    const nameScore = desiredTokens.length ? overlap / desiredTokens.length : 0;
    const dateMatch = desiredDate && event.date === desiredDate;
    return { ...event, nameScore, dateMatch: !!dateMatch };
  });
  if (desiredDate) {
    const dateMatches = candidates.filter(item => item.dateMatch);
    if (dateMatches.length) candidates = dateMatches;
  }
  if (desiredTokens.length) {
    const bestScore = Math.max(...candidates.map(item => item.nameScore));
    candidates = candidates.filter(item => item.nameScore === bestScore && bestScore >= 0.6);
  }
  if (candidates.length !== 1) {
    const requested = desiredName || (desiredDate ? `the event dated ${desiredDate}` : "the selected event");
    const choices = events.slice(0, 6).map(item => item.text).join("; ");
    throw new Error(`Couldn't uniquely match “${requested}” to the official SMX event archive. Select the scheduled event and check its name/date. Recent official events include: ${choices}`);
  }
  return candidates[0];
}

function wantedSmxSessionText(context) {
  const division = divisionKey(context.division);
  const type = String(context.eventType || "SMX").toLowerCase();
  const phase = String(context.phase || "").toLowerCase();
  const tripleCrown = String(context.supercrossFormat || "").toLowerCase() === "triple crown";
  if (type === "motocross") return `${division} moto #${phase.includes("2") ? "2" : "1"}`;
  if (type === "supercross" && tripleCrown) return `${division} overall`;
  if (type === "supercross") return `${division} main event`;
  return `${division} overall`;
}

function sessionLinkMatches(link, context) {
  const targetDivision = divisionKey(context.division);
  // Prefer the session link's own label/path. Nearby WordPress markup can
  // contain both class headings, so it must never override the link's class.
  const linkDivision = divisionKey(`${link.text || ""} ${link.linkText || ""} ${link.href || ""}`) || divisionKey(link.contextText || "");
  if (!targetDivision || linkDivision !== targetDivision) return false;
  let url;
  try { url = new URL(link.href); } catch { return false; }
  const resultType = url.searchParams.get("p") || "";
  const modernLabel = smxSessionLabelFromUrl(url.href);
  const isLegacyResult = /^view_(?:race_result|multi_main_result)$/.test(resultType);
  const isModernResult = !!modernLabel;
  if (!isLegacyResult && !isModernResult) return false;
  const label = normalizeHeader(`${link.text || ""} ${link.linkText || ""} ${modernLabel}`);
  const type = String(context.eventType || "SMX").toLowerCase();
  const phase = String(context.phase || "").toLowerCase();
  const tripleCrown = String(context.supercrossFormat || "").toLowerCase() === "triple crown";
  if (type === "motocross") return label.includes("moto") && label.includes(phase.includes("2") ? "2" : "1");
  if (type === "supercross" && tripleCrown) return label.includes("overall");
  if (type === "supercross") return label.includes("mainevent");
  return label.includes("overall");
}

function extractEventHeading(page) {
  const h1 = String(page.body || "").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? stripHtml(h1[1]) : page.title || "Official SMX event";
}

async function resolveSmxEventPage(eventUrl, context) {
  const eventPage = await readOfficialPage(eventUrl, "SMX");
  const links = parseAnchorLinks(eventPage.body, eventPage.finalUrl.href);
  const selected = links.filter(link => sessionLinkMatches(link, context));
  if (selected.length !== 1) {
    const division = divisionKey(context.division);
    const phase = String(context.phase || "").trim();
    const eventType = String(context.eventType || "SMX").trim();
    const available = links.map(link => link.text).filter(Boolean).slice(0, 12).join(", ");
    throw new Error(`The official SuperMotocross event page did not contain one unambiguous ${division} ${eventType} ${phase || "overall / main-event"} result link. Available sessions: ${available || "none found"}. Choose the matching class/session in the event page.`);
  }
  return { url: selected[0].href, eventTitle: extractEventHeading(eventPage), sessionTitle: selected[0].text || selected[0].linkText };
}

async function resolveSmxArchiveUrl(archiveUrl, context) {
  const archive = await readOfficialPage(archiveUrl, "SMX");
  const event = chooseArchiveEvent(archive.body, archive.finalUrl, context);
  const eventUrl = new URL(event.href);
  if (!hostIsAllowed(eventUrl.hostname, "SMX")) throw new Error("The official SMX event archive linked to an unapproved host.");
  return resolveSmxEventPage(eventUrl, context);
}

function isSmxArchiveLanding(url) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const queryType = url.searchParams.get("p") || "";
  if (queryType === "view_event") return true;
  if (host.endsWith("supermotocross.com") && /^\/results$/i.test(path)) return true;
  if (host === "results.supermotocross.com" && (/^\/events?$/i.test(path) || path === "/")) return true;
  return false;
}


function isF1ArchiveLandingUrl(url) {
  const path = String(url?.pathname || "").replace(/\/+$/, "") || "/";
  return hostIsAllowed(url?.hostname, "F1") && /^\/en\/results(?:\/\d{4}\/races)?$/i.test(path);
}

function isF1EventResultUrl(url) {
  const path = String(url?.pathname || "").replace(/\/+$/, "");
  return hostIsAllowed(url?.hostname, "F1") && /^\/en\/results\/\d{4}\/races\/\d+\/[^/]+\/(?:race-result|sprint-results|qualifying|sprint-qualifying|fastest-laps)$/i.test(path);
}

function f1YearFromContext(context = {}) {
  const match = String(context.eventDate || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : "";
}

function f1ArchiveUrlForContext(url, context = {}) {
  const next = new URL(url.href);
  const year = f1YearFromContext(context);
  const match = next.pathname.match(/^\/en\/results(?:\/(\d{4})\/races)?\/?$/i);
  if (match && year && match[1] !== year) next.pathname = `/en/results/${year}/races`;
  else if (match && !match[1] && year) next.pathname = `/en/results/${year}/races`;
  return next;
}

function f1ArchiveDate(rowText, year) {
  const text = String(rowText || "");
  const months = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
  let match = text.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i);
  let day, month;
  if (match) { day = Number(match[1]); month = months[match[2].toLowerCase()]; }
  else {
    match = text.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\b/i);
    if (!match) return "";
    month = months[match[1].toLowerCase()]; day = Number(match[2]);
  }
  const parsedYear = Number(year);
  if (!parsedYear || !month || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(parsedYear, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return date.toISOString().slice(0, 10);
}

function normalizeF1EventTokens(value) {
  const aliases = {
    australian: "australia", chinese: "china", japanese: "japan", canadian: "canada",
    spanish: "spain", austrian: "austria", british: "greatbritain", belgian: "belgium",
    hungarian: "hungary", dutch: "netherlands", italian: "italy", mexican: "mexico",
    "sao": "brazil", "paulo": "brazil"
  };
  const ignored = new Set(["formula", "formula1", "grand", "prix", "gp", "round", "race", "results", "airways", "crypto", "com", "aramco", "heineken", "pirelli", "aws", "lenovo", "rolex"]);
  const raw = (String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(token => !ignored.has(token))
    .map(token => aliases[token] || token);
  const tokens = [];
  for (let index = 0; index < raw.length; index++) {
    const current = raw[index], next = raw[index + 1];
    if (current === "great" && next === "britain") { tokens.push("greatbritain"); index++; }
    else if (current === "united" && next === "states") { tokens.push("unitedstates"); index++; }
    else if (current === "abu" && next === "dhabi") { tokens.push("abudhabi"); index++; }
    else if (current === "las" && next === "vegas") { tokens.push("lasvegas"); index++; }
    else if (current === "brazil" && next === "brazil") { tokens.push("brazil"); index++; }
    else tokens.push(current);
  }
  return tokens;
}

function chooseF1ArchiveEvent(html, archiveUrl, context = {}) {
  const yearMatch = archiveUrl.pathname.match(/\/results\/(\d{4})\/races/i);
  const year = yearMatch?.[1] || f1YearFromContext(context);
  const allLinks = parseAnchorLinks(html, archiveUrl.href);
  const byHref = new Map();
  for (const link of allLinks) {
    let parsed;
    try { parsed = new URL(link.href); } catch { continue; }
    const match = parsed.pathname.match(/^\/en\/results\/(\d{4})\/races\/(\d+)\/([^/]+)\/race-result\/?$/i);
    if (!match || !hostIsAllowed(parsed.hostname, "F1")) continue;
    const rowHtml = rowTextAround(html, link.index);
    const rowText = rowHtml || link.contextText || link.linkText;
    const eventSlug = match[3].replace(/-/g, " ");
    const event = {
      ...link,
      href: parsed.href,
      year: match[1],
      eventSlug,
      eventLabel: link.linkText || eventSlug,
      rowText,
      date: f1ArchiveDate(rowText, match[1])
    };
    if (!byHref.has(parsed.href)) byHref.set(parsed.href, event);
  }
  const events = [...byHref.values()];
  if (!events.length) throw new Error("The official Formula 1 results archive did not expose its Grand Prix result links. Paste a direct official Race Result or Sprint page URL instead.");

  const desiredDate = String(context.eventDate || "").slice(0, 10);
  const desiredTokens = normalizeF1EventTokens(context.event || "");
  let candidates = events.map(event => {
    const candidateTokens = normalizeF1EventTokens(`${event.eventLabel} ${event.eventSlug}`);
    const overlap = desiredTokens.filter(token => candidateTokens.includes(token)).length;
    const score = overlap / Math.max(1, Math.min(desiredTokens.length, candidateTokens.length));
    return { ...event, dateMatch: !!desiredDate && event.date === desiredDate, nameScore: score };
  });

  if (desiredDate) {
    const dateMatches = candidates.filter(event => event.dateMatch);
    if (dateMatches.length === 1) return dateMatches[0];
    if (dateMatches.length > 1 && desiredTokens.length) candidates = dateMatches;
  }
  if (desiredTokens.length) {
    const bestScore = Math.max(...candidates.map(event => event.nameScore));
    const best = candidates.filter(event => event.nameScore === bestScore && bestScore >= 0.5);
    if (best.length === 1) return best[0];
  }

  const requested = String(context.event || (desiredDate ? `the event on ${desiredDate}` : "the selected Grand Prix")).trim();
  const choices = events.slice(0, 8).map(event => `${event.eventLabel}${event.date ? ` (${event.date})` : ""}`).join("; ");
  throw new Error(`Couldn't uniquely match “${requested}” to the official Formula 1 results archive. Check the scheduled event name/date. Available events include: ${choices}`);
}

function f1EventBaseUrl(url) {
  const next = new URL(url.href);
  next.pathname = next.pathname.replace(/\/(?:race-result|sprint-results|qualifying|sprint-qualifying|fastest-laps)\/?$/i, "").replace(/\/+$/, "") + "/race-result";
  next.search = "";
  next.hash = "";
  return next;
}

function f1SessionUrl(eventResultUrl, sessionSlug) {
  if (!["race-result", "sprint-results", "qualifying", "sprint-qualifying", "fastest-laps"].includes(sessionSlug)) {
    throw new Error("Unsupported Formula 1 result session.");
  }
  const next = f1EventBaseUrl(eventResultUrl);
  next.pathname = next.pathname.replace(/\/race-result$/i, `/${sessionSlug}`);
  return next;
}

async function resolveF1EventSession(eventResultUrl, context = {}) {
  const grandPrixUrl = f1EventBaseUrl(eventResultUrl);
  if (!isF1EventResultUrl(grandPrixUrl)) throw new Error("Use an official Formula 1 event Race Result page, Sprint Result page, or the season results archive.");
  const grandPrixPage = await readOfficialPage(grandPrixUrl, "F1");
  const eventTitle = extractEventHeading(grandPrixPage);
  const sprintSelected = normalizeHeader(context.phase || "Grand Prix").includes("sprint");
  if (!sprintSelected) {
    return { url: grandPrixPage.finalUrl.href, page: grandPrixPage, eventTitle, sessionTitle: "Grand Prix" };
  }

  const links = parseAnchorLinks(grandPrixPage.body, grandPrixPage.finalUrl.href);
  const sprintLinks = links.filter(link => {
    try {
      const target = new URL(link.href);
      return hostIsAllowed(target.hostname, "F1") && /\/sprint-results\/?$/i.test(target.pathname);
    } catch { return false; }
  });
  const unique = [...new Map(sprintLinks.map(link => [link.href, link])).values()];
  if (unique.length !== 1) {
    throw new Error(`The official ${eventTitle || "selected Grand Prix"} page does not provide one clear Sprint result page. This event may not be a Sprint weekend. Choose the Grand Prix scoring tab or check the official event page.`);
  }
  const sprintPage = await readOfficialPage(new URL(unique[0].href), "F1");
  return { url: sprintPage.finalUrl.href, page: sprintPage, eventTitle, sessionTitle: "Sprint" };
}

async function resolveF1ArchiveUrl(archiveUrl, context = {}) {
  const normalizedArchiveUrl = f1ArchiveUrlForContext(archiveUrl, context);
  const archive = await readOfficialPage(normalizedArchiveUrl, "F1");
  const event = chooseF1ArchiveEvent(archive.body, archive.finalUrl, context);
  return resolveF1EventSession(new URL(event.href), context);
}

async function fetchOfficialResults({ url: inputUrl, series, division, csv, csvName, event, round, eventDate, eventLocation, eventType, phase, supercrossFormat } = {}) {
  if (!OFFICIAL_HOSTS_BY_SERIES[series]) throw new Error("Choose a supported racing series before importing results.");
  const options = { series, division, phase };
  if (series === "SMX" && !divisionKey(division)) throw new Error("Choose either the 250 or 450 class before importing SMX results.");
  if (series === "Triple Crown Series" && !tcsDivisionKey(division)) throw new Error("Choose CAN 250 or CAN 450 before importing Triple Crown Series results.");
  if (typeof csv === "string" && csv.trim()) {
    const result = parseCsv(csv, csvName || "Official CSV results", options);
    return { ...result, source: "Official CSV upload", division: series === "Triple Crown Series" ? `CAN ${tcsDivisionKey(division)}` : (divisionKey(division) || division || "") };
  }
  let url;
  try { url = new URL(String(inputUrl || "")); } catch { throw new Error("Paste a valid official results URL or upload an official CSV file."); }
  if (url.protocol !== "https:" || url.username || url.password || !hostIsAllowed(url.hostname, series)) {
    throw new Error(`For ${series}, use a secure results link from its official source website. This host isn't approved for that series.`);
  }
  if (url.port && url.port !== "443") throw new Error("Only standard secure (HTTPS) official results links are supported.");

  if (series === "MotoGP") {
    // The official MotoGP results page uses the results backend behind its
    // public archive. Resolve season -> event -> category -> session -> rows.
    return resolveMotoGPResults({ event, round, eventDate, phase: phase || "Grand Prix" });
  }

  let resolved = null;
  let context = { event, round, eventDate, eventLocation, division, eventType, phase, supercrossFormat };
  if (series === "F1") {
    context = { event, round, eventDate, eventType, phase: phase || "Grand Prix" };
    if (isF1ArchiveLandingUrl(url)) resolved = await resolveF1ArchiveUrl(url, context);
    else if (isF1EventResultUrl(url)) resolved = await resolveF1EventSession(url, context);
    else throw new Error("For F1, paste the official season results archive or a direct event Race Result / Sprint Result page. The selected Grand Prix or Sprint scoring tab determines which classification is fetched.");
  } else if (series === "SMX") {
    if (url.searchParams.get("p") === "view_event") {
      resolved = await resolveSmxEventPage(url, context);
    } else if (isModernSmxEventPage(url)) {
      resolved = await resolveSmxEventPage(url, context);
    } else if (isSmxArchiveLanding(url)) {
      const archiveUrl = new URL(url.href);
      if (archiveUrl.hostname.endsWith("supermotocross.com") && /^\/results$/i.test(archiveUrl.pathname)) archiveUrl.pathname = "/results/";
      resolved = await resolveSmxArchiveUrl(archiveUrl, context);
    }
    if (resolved) url = new URL(resolved.url);
  } else if (series === "Triple Crown Series") {
    resolved = await resolveTcsEventPage(url, context);
  } else if (series === "MXGP" || series === "MXON") {
    // The official MXGP results root opens the server-rendered classification
    // chooser. Its selected classification is served from reslists.aspx.
    if (url.hostname.toLowerCase() === "results.mxgp.com" && ["/", "/mxgp/", "/mxon/", "/mxgp", "/mxon"].includes(url.pathname.toLowerCase())) {
      url.pathname = "/reslists.aspx";
    }
  }

  const page = resolved?.page || await readOfficialPage(resolved ? new URL(resolved.url) : url, series);
  const parseOptions = { ...options, url: page.finalUrl.href };
  const title = page.title || page.finalUrl.hostname;
  let result;
  if (series === "Triple Crown Series") {
    result = parseTcsEventResults(page.body, title, context);
    result.eventTitle = resolved?.eventTitle || extractEventHeading(page);
    result.sessionTitle = result.sessionTitle || (String(phase || "Moto 1").includes("2") ? "Moto 2" : "Moto 1");
  } else if (page.contentType.includes("json") || /^[\s]*[\[{]/.test(page.body)) {
    result = parseJsonResults(page.body, title, parseOptions);
  } else if (page.contentType.includes("csv") || /\.csv(?:$|\?)/i.test(page.finalUrl.href)) {
    result = parseCsv(page.body, title, parseOptions);
  } else if (page.contentType.includes("html") || /<html|<table|<tr\b/i.test(page.body)) {
    result = parseHtml(page.body, title, parseOptions);
  } else if (page.contentType.includes("pdf") || page.contentType.includes("spreadsheet") || /\.pdf(?:$|\?)|\.xlsx?(?:$|\?)/i.test(page.finalUrl.href)) {
    throw new Error("This official source links to a PDF or spreadsheet. Download its CSV export if available, then upload the CSV file here. PDF and Excel imports aren't supported yet.");
  } else {
    throw new Error("The official source format isn't readable by this importer. Try its HTML result page or an official CSV export.");
  }

  const fetchedUrl = page.finalUrl.href;
  let fastestLap = null;
  let fastestQualifier = null;
  let fastestQualifierSessionTitle = "";
  let fastestQualifierError = "";
  if (series === "F1") {
    const sprintSession = normalizeHeader(phase || "Grand Prix").includes("sprint");
    const qualifierSlug = sprintSession ? "sprint-qualifying" : "qualifying";
    fastestQualifierSessionTitle = sprintSession ? "Sprint Qualifying" : "Qualifying";
    try {
      const qualifierUrl = f1SessionUrl(new URL(fetchedUrl), qualifierSlug);
      const qualifierPage = await readOfficialPage(qualifierUrl, "F1");
      const qualifierResults = parseHtml(qualifierPage.body, qualifierPage.title, { series: "F1", url: qualifierPage.finalUrl.href });
      fastestQualifier = qualifierResults.rows.find(row => row.position === 1) || qualifierResults.rows[0] || null;
      if (!fastestQualifier) fastestQualifierError = `The official ${fastestQualifierSessionTitle} page did not contain a fastest qualifier row.`;
      if (fastestQualifier) fastestQualifier.sourceUrl = qualifierPage.finalUrl.href;
    } catch (error) {
      fastestQualifierError = error.message || `Could not read the official ${fastestQualifierSessionTitle} classification.`;
    }
  }
  if (series === "F1" && !normalizeHeader(phase || "Grand Prix").includes("sprint")) {
    try {
      const fastestLapUrl = f1SessionUrl(new URL(fetchedUrl), "fastest-laps");
      const fastestPage = await readOfficialPage(fastestLapUrl, "F1");
      const fastestResults = parseHtml(fastestPage.body, fastestPage.title, { series: "F1", url: fastestPage.finalUrl.href });
      if (fastestResults.rows[0]) fastestLap = fastestResults.rows[0];
    } catch { /* Race classification remains usable if the optional fastest-lap page is unavailable. */ }
  }
  const outputDivision = series === "Triple Crown Series" ? `CAN ${tcsDivisionKey(division)}` : (divisionKey(division) || (series === "MXGP" || series === "MXON" ? String(division || "") : ""));
  return {
    ...result,
    source: resolved ? resolved.url : fetchedUrl,
    fetchedUrl,
    division: result.division || outputDivision,
    eventTitle: result.eventTitle || resolved?.eventTitle || "",
    sessionTitle: result.sessionTitle || resolved?.sessionTitle || result.tableHeading || "",
    fastestLap,
    fastestQualifier,
    fastestQualifierSessionTitle,
    fastestQualifierError
  };
}

module.exports = {
  OFFICIAL_HOSTS_BY_SERIES,
  SMX_EVENT_ARCHIVE,
  F1_RESULTS_ARCHIVE,
  TCS_RESULTS_ARCHIVE,
  MXGP_RESULTS_ARCHIVE,
  MOTOGP_RESULTS_ARCHIVE,
  MOTOGP_API_BASE: "https://api.motogp.pulselive.com/motogp/v1",
  hostIsAllowed,
  divisionKey,
  parseCsv,
  parseHtml,
  parseJsonResults,
  fetchOfficialResults,
  chooseArchiveEvent,
  sessionLinkMatches,
  isF1ArchiveLandingUrl,
  isF1EventResultUrl,
  chooseF1ArchiveEvent,
  resolveF1EventSession,
  parseTcsEventResults,
  resolveTcsEventPage,
  validateMxgpClassification,
  motogpClassificationRows,
  resolveMotoGPResults,
  normalizeSeriesRiderName
};
