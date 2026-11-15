"use strict";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const SMX_EVENT_ARCHIVE = "https://www.supermotocross.com/results/";
const F1_RESULTS_ARCHIVE = "https://www.formula1.com/en/results";

const OFFICIAL_HOSTS_BY_SERIES = {
  SMX: ["supermotocross.com", "results.supermotocross.com", "supercross.com", "results.supercrosslive.com", "results.supercross.com"],
  "Triple Crown Series": ["triplecrownseries.ca", "cmrc.tracksideresults.com", "tracksideresults.com", "livelaps.com"],
  MXGP: ["mxgp.com", "results.mxgp.com", "docs.mxgp.com", "fim-moto.com"],
  MXON: ["mxgp.com", "results.mxgp.com", "docs.mxgp.com", "fim-moto.com"],
  F1: ["formula1.com"],
  MotoGP: ["motogp.com", "stats.motogp.com"]
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
  let numberIndex = findColumn(headers, [/^(no|number|racenumber|carnumber|ridernumber|ridernum|platenumber|plate)$/]);
  if (numberIndex < 0) numberIndex = headers.findIndex(header => String(header || "").trim() === "#");
  const teamIndex = findColumn(headers, [/^team/, /^raceteam/, /^constructor$/]);
  const bestLapIndex = findColumn(headers, [/^bestlap/, /^fastestlap/]);
  const divisionIndex = findColumn(headers, [/^(class|division|category|raceclass|seriesclass)$/]);
  const requestedDivision = options.series === "SMX" ? divisionKey(options.division) : "";
  const normalized = [];
  for (const cells of rawRows.slice(headerIndex + 1)) {
    if (!Array.isArray(cells)) continue;
    if (requestedDivision && divisionIndex >= 0) {
      const rowDivision = divisionKey(cells[divisionIndex]);
      if (rowDivision && rowDivision !== requestedDivision) continue;
    }
    const position = parsePosition(cells[positionIndex]);
    const riderName = cleanRiderName(cells[nameIndex]);
    if (!position || !riderName || ["rider", "driver"].includes(normalizeHeader(riderName))) continue;
    let number = numberIndex >= 0 ? cleanNumber(cells[numberIndex]) : "";
    if (!number) {
      const leadingNumber = String(cells[nameIndex] || "").trim().match(/^#?(\d{1,3})\s+.+$/);
      if (leadingNumber) number = leadingNumber[1];
    }
    normalized.push({
      position,
      number,
      name: riderName,
      team: teamIndex >= 0 ? String(cells[teamIndex] || "").trim() : "",
      bestLap: bestLapIndex >= 0 ? String(cells[bestLapIndex] || "").trim() : ""
    });
  }
  const unique = new Map();
  for (const row of normalized) {
    const key = `${row.position}|${row.number}|${normalizeHeader(row.name)}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  const results = [...unique.values()].sort((a, b) => a.position - b.position);
  if (!results.length) throw new Error("The selected official results table contains no classified rider rows for the selected class.");
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
        "Accept": "text/html,text/csv,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.5"
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
  return hostIsAllowed(url?.hostname, "F1") && /^\/en\/results\/\d{4}\/races\/\d+\/[^/]+\/(?:race-result|sprint-results)$/i.test(path);
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
  next.pathname = next.pathname.replace(/\/(?:race-result|sprint-results)\/?$/i, "").replace(/\/+$/, "") + "/race-result";
  next.search = "";
  next.hash = "";
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

async function fetchOfficialResults({ url: inputUrl, series, division, csv, csvName, event, round, eventDate, eventType, phase, supercrossFormat } = {}) {
  if (!OFFICIAL_HOSTS_BY_SERIES[series]) throw new Error("Choose a supported racing series before importing results.");
  const options = { series, division };
  if (series === "SMX" && !divisionKey(division)) throw new Error("Choose either the 250 or 450 class before importing SMX results.");
  if (typeof csv === "string" && csv.trim()) {
    const result = parseCsv(csv, csvName || "Official CSV results", options);
    return { ...result, source: "Official CSV upload", division: divisionKey(division) || "" };
  }
  let url;
  try { url = new URL(String(inputUrl || "")); } catch { throw new Error("Paste a valid official results URL or upload an official CSV file."); }
  if (url.protocol !== "https:" || url.username || url.password || !hostIsAllowed(url.hostname, series)) {
    throw new Error(`For ${series}, use a secure results link from its official source website. This host isn't approved for that series.`);
  }
  if (url.port && url.port !== "443") throw new Error("Only standard secure (HTTPS) official results links are supported.");

  let resolved = null;
  if (series === "F1") {
    const context = { event, round, eventDate, eventType, phase: phase || "Grand Prix" };
    if (isF1ArchiveLandingUrl(url)) resolved = await resolveF1ArchiveUrl(url, context);
    else if (isF1EventResultUrl(url)) resolved = await resolveF1EventSession(url, context);
    else throw new Error("For F1, paste the official season results archive or a direct event Race Result / Sprint Result page. The selected Grand Prix or Sprint scoring tab determines which classification is fetched.");
  } else if (series === "SMX") {
    const context = { event, round, eventDate, division, eventType, phase, supercrossFormat };
    if (url.searchParams.get("p") === "view_event") {
      resolved = await resolveSmxEventPage(url, context);
    } else if (isModernSmxEventPage(url)) {
      resolved = await resolveSmxEventPage(url, context);
    } else if (isSmxArchiveLanding(url)) {
      // Use the supplied SuperMotocross archive URL by default. Normalize its
      // trailing slash to avoid an unnecessary redirect; the legacy
      // results.supermotocross.com event list remains accepted when pasted.
      const archiveUrl = new URL(url.href);
      if (archiveUrl.hostname.endsWith("supermotocross.com") && /^\/results$/i.test(archiveUrl.pathname)) archiveUrl.pathname = "/results/";
      resolved = await resolveSmxArchiveUrl(archiveUrl, context);
    }
    if (resolved) url = new URL(resolved.url);
  }

  const page = resolved?.page || await readOfficialPage(resolved ? new URL(resolved.url) : url, series);
  const parseOptions = { ...options, url: page.finalUrl.href };
  const title = page.title || page.finalUrl.hostname;
  let result;
  if (page.contentType.includes("json") || /^[\s]*[\[{]/.test(page.body)) result = parseJsonResults(page.body, title, parseOptions);
  else if (page.contentType.includes("csv") || /\.csv(?:$|\?)/i.test(page.finalUrl.href)) result = parseCsv(page.body, title, parseOptions);
  else if (page.contentType.includes("html") || /<html|<table|<tr\b/i.test(page.body)) result = parseHtml(page.body, title, parseOptions);
  else if (page.contentType.includes("pdf") || page.contentType.includes("spreadsheet") || /\.pdf(?:$|\?)|\.xlsx?(?:$|\?)/i.test(page.finalUrl.href)) {
    throw new Error("This official source links to a PDF or spreadsheet. Download its CSV export if available, then upload the CSV file here. PDF and Excel imports aren't supported yet.");
  } else throw new Error("The official source format isn't readable by this importer. Try its HTML result page or an official CSV export.");

  const fetchedUrl = page.finalUrl.href;
  let fastestLap = null;
  if (series === "F1" && !normalizeHeader(phase || "Grand Prix").includes("sprint")) {
    try {
      const fastestLapUrl = f1EventBaseUrl(new URL(fetchedUrl));
      fastestLapUrl.pathname = fastestLapUrl.pathname.replace(/\/race-result$/i, "/fastest-laps");
      const fastestPage = await readOfficialPage(fastestLapUrl, "F1");
      const fastestResults = parseHtml(fastestPage.body, fastestPage.title, { series: "F1", url: fastestPage.finalUrl.href });
      if (fastestResults.rows[0]) fastestLap = fastestResults.rows[0];
    } catch { /* Race classification remains usable if the optional fastest-lap page is unavailable. */ }
  }
  return {
    ...result,
    source: resolved ? resolved.url : fetchedUrl,
    fetchedUrl,
    division: divisionKey(division) || "",
    eventTitle: resolved?.eventTitle || "",
    sessionTitle: resolved?.sessionTitle || "",
    fastestLap
  };
}

module.exports = {
  OFFICIAL_HOSTS_BY_SERIES,
  SMX_EVENT_ARCHIVE,
  F1_RESULTS_ARCHIVE,
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
  resolveF1EventSession
};
