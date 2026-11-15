"use strict";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12000;

const OFFICIAL_HOSTS_BY_SERIES = {
  SMX: ["supercross.com", "results.supercrosslive.com", "results.supercross.com"],
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
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/\s+/g, " ").trim();
}

function parsePosition(value) {
  const match = String(value || "").trim().match(/^(\d{1,3})(?:st|nd|rd|th)?(?:\s|\.|$)/i);
  return match ? Number(match[1]) : 0;
}

function cleanRiderName(value) {
  let name = String(value || "").trim()
    .replace(/\b(Holeshot|Fastest Lap|DNF|DNS|DSQ)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  const leadingNumber = name.match(/^#?(\d{1,3})\s+(.+)$/);
  if (leadingNumber) name = leadingNumber[2];
  // F1 result tables sometimes append a three-letter timing abbreviation to title-case names.
  const parts = name.split(/\s+/);
  if (parts.length >= 3 && /^[A-Z]{3}$/.test(parts.at(-1)) && parts.slice(0, -1).some(part => /[a-z]/.test(part))) parts.pop();
  name = parts.join(" ").trim();
  return name;
}

function cleanNumber(value) {
  const match = String(value || "").trim().match(/#?\s*(\d{1,3})/);
  return match ? match[1] : "";
}

function findColumn(headers, patterns) {
  return headers.findIndex(header => patterns.some(pattern => pattern.test(normalizeHeader(header))));
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

function normalizeRows(rawRows, sourceTitle) {
  if (!Array.isArray(rawRows) || rawRows.length < 2) {
    throw new Error("No result rows were found. Use an official classification page or export its results as CSV.");
  }
  let headerIndex = -1, positionIndex = -1, nameIndex = -1;
  for (let i = 0; i < Math.min(rawRows.length, 30); i++) {
    const headers = rawRows[i].map(cell => String(cell || "").trim());
    const p = findColumn(headers, [/^(pos|position|rank|place|finish|finishposition)$/]);
    const n = findColumn(headers, [/^(rider|driver|racer|competitor|athlete|name|ridername|drivername)$/]);
    if (p >= 0 && n >= 0) { headerIndex = i; positionIndex = p; nameIndex = n; break; }
  }
  if (headerIndex < 0) {
    throw new Error("I couldn't identify the position and rider/driver columns. Use the official CSV export with Position and Rider (or Driver) headers.");
  }
  const headers = rawRows[headerIndex].map(cell => String(cell || "").trim());
  let numberIndex = findColumn(headers, [/^(no|number|racenumber|carnumber|ridernumber|ridernum|platenumber|plate)$/]);
  if (numberIndex < 0) numberIndex = headers.findIndex(header => String(header || "").trim() === "#");
  const teamIndex = findColumn(headers, [/^team/, /^raceteam/, /^constructor$/]);
  const bestLapIndex = findColumn(headers, [/^bestlap/, /^fastestlap/]);
  const normalized = [];
  for (const cells of rawRows.slice(headerIndex + 1)) {
    if (!Array.isArray(cells)) continue;
    const position = parsePosition(cells[positionIndex]);
    const riderName = cleanRiderName(cells[nameIndex]);
    if (!position || !riderName || normalizeHeader(riderName) === "rider" || normalizeHeader(riderName) === "driver") continue;
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
  if (!results.length) throw new Error("The selected page contains a results table, but no classified rider rows could be read.");
  return { title: sourceTitle || "Official race results", rows: results.slice(0, 100) };
}

function parseCsv(csv, sourceTitle = "Official CSV results") {
  return normalizeRows(rowsFromCsv(csv), sourceTitle);
}

function parseHtml(html, sourceTitle = "Official race results") {
  const source = String(html || "");
  const tables = [];
  const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr;
  const rows = [];
  while ((tr = trRegex.exec(source))) {
    const cells = [];
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cell;
    while ((cell = cellRegex.exec(tr[1]))) cells.push(stripHtml(cell[1]));
    if (cells.length >= 2) rows.push(cells);
  }
  // Parse each candidate header independently so unrelated navigation/timing tables are ignored.
  for (let i = 0; i < rows.length; i++) {
    const headers = rows[i];
    const p = findColumn(headers, [/^(pos|position|rank|place|finish|finishposition)$/]);
    const n = findColumn(headers, [/^(rider|driver|racer|competitor|athlete|name|ridername|drivername)$/]);
    if (p >= 0 && n >= 0) {
      const candidate = normalizeRows(rows.slice(i), sourceTitle);
      tables.push(candidate);
    }
  }
  if (!tables.length) {
    // A few official result feeds publish CSV text directly while retaining a text/plain content type.
    if (/\b(position|pos)\b.{0,80}\b(rider|driver|name)\b/i.test(source) && source.includes(",")) return parseCsv(source, sourceTitle);
    throw new Error("The official page did not expose a readable results table. Try its direct session-results link or download the official CSV and upload it here.");
  }
  return tables.sort((a, b) => b.rows.length - a.rows.length)[0];
}

function parseJsonResults(json, sourceTitle = "Official race results") {
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error("The official result feed returned invalid JSON."); }
  const candidates = [];
  const visit = (value, depth = 0) => {
    if (depth > 6 || value == null) return;
    if (Array.isArray(value)) {
      if (value.length && value.every(item => item && typeof item === "object" && !Array.isArray(item))) candidates.push(value);
      else value.forEach(item => visit(item, depth + 1));
    } else if (typeof value === "object") Object.values(value).forEach(item => visit(item, depth + 1));
  };
  visit(parsed);
  for (const array of candidates.sort((a, b) => b.length - a.length)) {
    const rawRows = [];
    const keys = Object.keys(array[0]);
    rawRows.push(keys);
    array.forEach(item => rawRows.push(keys.map(key => String(item[key] ?? ""))));
    try { return normalizeRows(rawRows, sourceTitle); } catch { /* Check the next candidate array. */ }
  }
  throw new Error("The official JSON feed did not contain recognizable position and rider/driver fields.");
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
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error("The official results page is larger than the 5 MB import limit.");
    }
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
        "User-Agent": "KaiserFamilyFantasySMXResultsImporter/1.0 (+official-results preview)",
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

async function fetchOfficialResults({ url: inputUrl, series, csv } = {}) {
  if (!OFFICIAL_HOSTS_BY_SERIES[series]) throw new Error("Choose a supported racing series before importing results.");
  if (typeof csv === "string" && csv.trim()) return { ...parseCsv(csv), source: "Official CSV upload" };
  let url;
  try { url = new URL(String(inputUrl || "")); } catch { throw new Error("Paste a valid official results URL or upload an official CSV file."); }
  if (url.protocol !== "https:" || url.username || url.password || !hostIsAllowed(url.hostname, series)) {
    throw new Error(`For ${series}, use a secure results link from its official source website. This host isn't approved for that series.`);
  }
  if (url.port && url.port !== "443") throw new Error("Only standard secure (HTTPS) official results links are supported.");
  const { response, finalUrl } = await fetchApprovedUrl(url, series);
  if (!response.ok) throw new Error(`The official source returned HTTP ${response.status}. Check that the event results are published and the URL is correct.`);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const body = await readLimitedResponse(response);
  const sourceTitle = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const title = sourceTitle ? stripHtml(sourceTitle) : finalUrl.hostname;
  if (contentType.includes("json") || /^[\s]*[\[{]/.test(body)) return { ...parseJsonResults(body, title), source: finalUrl.href };
  if (contentType.includes("csv") || /\.csv(?:$|\?)/i.test(finalUrl.href)) return { ...parseCsv(body, title), source: finalUrl.href };
  if (contentType.includes("html") || /<html|<table|<tr\b/i.test(body)) return { ...parseHtml(body, title), source: finalUrl.href };
  if (contentType.includes("pdf") || contentType.includes("spreadsheet") || /\.pdf(?:$|\?)|\.xlsx?(?:$|\?)/i.test(finalUrl.href)) {
    throw new Error("This official source links to a PDF or spreadsheet. Download its CSV export if available, then upload the CSV file here. PDF and Excel imports aren't supported yet.");
  }
  throw new Error("The official source format isn't readable by this importer. Try its HTML result page or an official CSV export.");
}

module.exports = {
  OFFICIAL_HOSTS_BY_SERIES,
  hostIsAllowed,
  parseCsv,
  parseHtml,
  parseJsonResults,
  fetchOfficialResults
};
