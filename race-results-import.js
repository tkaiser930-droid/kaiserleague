"use strict";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;
const SMX_EVENT_ARCHIVE = "https://www.supermotocross.com/results/";
const F1_RESULTS_ARCHIVE = "https://www.formula1.com/en/results";
const TCS_RESULTS_ARCHIVE = "https://triplecrownseries.ca/results";
const MXGP_RESULTS_ARCHIVE = "https://results.mxgp.com/";
const MOTOGP_RESULTS_ARCHIVE = "https://www.motogp.com/en/gp-results/";
// Use the long-standing MotoGP results API hostname documented by the public
// results integrations. Keep the alternate Pulselive hostname as a fallback.
// The reversed api.motogp.com hostname is NOT the same service and must not be used.
const MOTOGP_API_BASE = "https://api.motogp.pulselive.com/motogp/v1";
const MOTOGP_API_BASES = [MOTOGP_API_BASE, "https://api.pulselive.motogp.com/motogp/v1"];

const OFFICIAL_HOSTS_BY_SERIES = {
  SMX: ["supermotocross.com", "results.supermotocross.com", "supercross.com", "results.supercrosslive.com", "results.supercross.com"],
  "Triple Crown Series": ["triplecrownseries.ca", "cmrc.tracksideresults.com", "tracksideresults.com", "livelaps.com"],
  MXGP: ["mxgp.com", "results.mxgp.com", "docs.mxgp.com", "fim-moto.com"],
  MXON: ["mxgp.com", "results.mxgp.com", "docs.mxgp.com", "fim-moto.com"],
  F1: ["formula1.com"],
  MotoGP: ["motogp.com", "api.pulselive.motogp.com", "api.motogp.pulselive.com", "resources.motogp.com", "resources.motogp.pulselive.com"]
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

async function fetchApprovedUrl(initialUrl, series, requestOptions = {}) {
  let current = new URL(initialUrl.href);
  let method = String(requestOptions.method || "GET").toUpperCase();
  let body = requestOptions.body;
  const extraHeaders = requestOptions.headers || {};
  for (let hop = 0; hop <= 4; hop++) {
    if (current.protocol !== "https:" || current.username || current.password || (current.port && current.port !== "443") || !hostIsAllowed(current.hostname, series)) {
      throw new Error("The official source redirected outside its approved HTTPS domain list.");
    }
    const headers = {
      "User-Agent": series === "MotoGP"
        ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        : "KaiserFamilyFantasySMXResultsImporter/1.2 (+official-results preview)",
      "Accept": series === "MotoGP"
        ? "application/json, text/plain, application/pdf;q=0.9, */*;q=0.8"
        : "text/html,text/csv,application/json,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5",
      ...(series === "MotoGP" ? {
        "Origin": "https://www.motogp.com",
        "Referer": "https://www.motogp.com/",
        "x-origin": "2"
      } : {}),
      ...extraHeaders
    };
    const response = await fetch(current, {
      method,
      ...(body !== undefined && method !== "GET" && method !== "HEAD" ? { body } : {}),
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The official results source returned a redirect without a destination.");
      if (hop === 4) throw new Error("The official source redirected too many times.");
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
      }
      current = new URL(location, current);
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error("The official results source could not be reached safely.");
}

async function readOfficialPage(url, series, requestOptions = {}) {
  const { response, finalUrl } = await fetchApprovedUrl(url, series, requestOptions);
  if (!response.ok) throw new Error(`The official source returned HTTP ${response.status}. Check that the event results are published and the URL is correct.`);
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  const body = await readLimitedResponse(response);
  const sourceTitle = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return { body, contentType, finalUrl, title: sourceTitle ? stripHtml(sourceTitle) : finalUrl.hostname, setCookies };
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

function parseHtmlAttributes(source) {
  const attrs = {};
  const text = String(source || "");
  const regex = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = regex.exec(text))) {
    const name = String(match[1] || "").toLowerCase();
    if (!name) continue;
    attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function parseMxgpSelectControls(html, baseUrl, selectedValues = {}) {
  const source = String(html || "");
  const forms = [...source.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const containers = forms.length
    ? forms.map(match => ({ attrs: parseHtmlAttributes(match[1]), html: match[2] }))
    : [{ attrs: { method: "get", action: baseUrl }, html: source }];
  return containers.map((container, formIndex) => {
    const controls = [];
    const fields = [];
    const selectRegex = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
    let selectMatch;
    while ((selectMatch = selectRegex.exec(container.html))) {
      const attrs = parseHtmlAttributes(selectMatch[1]);
      const name = attrs.name || attrs.id || "";
      if (!name) continue;
      const options = [];
      const optionRegex = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
      let optionMatch;
      while ((optionMatch = optionRegex.exec(selectMatch[2]))) {
        const optionAttrs = parseHtmlAttributes(optionMatch[1]);
        const text = stripHtml(optionMatch[2]);
        const value = optionAttrs.value !== undefined ? optionAttrs.value : text;
        options.push({ value: String(value), text, selected: Object.prototype.hasOwnProperty.call(optionAttrs, "selected"), disabled: Object.prototype.hasOwnProperty.call(optionAttrs, "disabled") });
      }
      const override = Object.prototype.hasOwnProperty.call(selectedValues, name)
        ? selectedValues[name]
        : (attrs.id && Object.prototype.hasOwnProperty.call(selectedValues, attrs.id) ? selectedValues[attrs.id] : undefined);
      const selected = override !== undefined
        ? options.find(option => option.value === String(override)) || null
        : options.find(option => option.selected && !option.disabled) || options.find(option => !option.disabled) || null;
      const control = { name, id: attrs.id || "", attrs, options, selectedValue: selected?.value ?? (override !== undefined ? String(override) : ""), formIndex };
      controls.push(control);
      fields.push({ name, value: control.selectedValue, kind: "select", control });
    }

    const inputRegex = /<input\b([^>]*)>/gi;
    let inputMatch;
    while ((inputMatch = inputRegex.exec(container.html))) {
      const attrs = parseHtmlAttributes(inputMatch[1]);
      const name = attrs.name || attrs.id || "";
      const type = String(attrs.type || "text").toLowerCase();
      if (!name || ["submit", "button", "reset", "image", "file"].includes(type)) continue;
      if (["checkbox", "radio"].includes(type) && !Object.prototype.hasOwnProperty.call(attrs, "checked")) continue;
      fields.push({ name, value: attrs.value ?? "", kind: "input" });
    }
    const textareaRegex = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi;
    let textareaMatch;
    while ((textareaMatch = textareaRegex.exec(container.html))) {
      const attrs = parseHtmlAttributes(textareaMatch[1]);
      const name = attrs.name || attrs.id || "";
      if (name) fields.push({ name, value: stripHtml(textareaMatch[2]), kind: "textarea" });
    }
    const action = new URL(container.attrs.action || baseUrl, baseUrl).href;
    return { action, method: String(container.attrs.method || "GET").toUpperCase(), attrs: container.attrs, controls, fields, formIndex };
  });
}

function mxgpFindSelect(forms, label, optionPredicate) {
  for (const form of forms) {
    for (const control of form.controls) {
      if (control.options.some(option => optionPredicate(option.text))) return { form, control, label };
    }
  }
  const available = forms.flatMap(form => form.controls.flatMap(control => control.options.map(option => option.text).filter(Boolean))).slice(0, 35);
  throw new Error(`The official MXGP results page did not expose the ${label} dropdown. Available options: ${available.join("; ") || "none"}. Open https://results.mxgp.com/ and check that the results filters have loaded.`);
}

function mxgpOptionExact(text, expected) {
  return normalizeHeader(text) === normalizeHeader(expected);
}

function mxgpRoundTokens(value) {
  const ignored = new Set(["mxgp", "mx2", "fim", "motocross", "world", "championship", "grand", "prix", "of", "the", "round", "event", "gp"]);
  return [...new Set((String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z]+|\d+/g) || []).filter(token => !ignored.has(token)))];
}

function chooseMxgpRoundOption(control, context = {}) {
  const candidates = control.options.filter(option => /^grand\s+prix\s+of\b/i.test(option.text));
  if (!candidates.length) throw new Error("The official MXGP Round dropdown did not contain any options beginning with ‘Grand Prix of’. Make sure the FIM Motocross World Championship selection has loaded.");
  const eventTokens = mxgpRoundTokens(context.event || "");
  const locationTokens = mxgpRoundTokens(context.eventLocation || "");
  const targetTokens = [...new Set([...eventTokens, ...locationTokens])];
  const requestedRound = Number(context.round || 0);
  const scored = candidates.map((option, index) => {
    const tokens = mxgpRoundTokens(option.text);
    const eventOverlap = eventTokens.filter(token => tokens.includes(token)).length;
    const locationOverlap = locationTokens.filter(token => tokens.includes(token)).length;
    const score = (eventTokens.length ? eventOverlap / eventTokens.length : 0) * 3
      + (locationTokens.length ? locationOverlap / locationTokens.length : 0);
    const explicitRound = option.text.match(/\b(?:round|rnd)\s*0?(\d+)\b/i);
    const roundMatch = !!(requestedRound && explicitRound && Number(explicitRound[1]) === requestedRound);
    const date = isoDate(option.text);
    const dateMatch = !!(context.eventDate && date && date === String(context.eventDate).slice(0, 10));
    return { option, index, score, eventOverlap, locationOverlap, roundMatch, dateMatch };
  });
  if (requestedRound && scored.some(item => item.roundMatch)) {
    const roundMatches = scored.filter(item => item.roundMatch);
    if (roundMatches.length === 1) return roundMatches[0].option;
    if (targetTokens.length) {
      const roundBest = Math.max(...roundMatches.map(item => item.score));
      const best = roundMatches.filter(item => item.score === roundBest && item.score > 0);
      if (best.length === 1) return best[0].option;
    }
  }
  if (scored.some(item => item.dateMatch)) {
    const dateMatches = scored.filter(item => item.dateMatch);
    if (dateMatches.length === 1) return dateMatches[0].option;
  }
  // Prefer a unique match from the scheduled event title. Venue text often
  // contains extra city/track tokens that do not appear in the official GP label.
  if (eventTokens.length) {
    const bestOverlap = Math.max(...scored.map(item => item.eventOverlap));
    const best = scored.filter(item => item.eventOverlap === bestOverlap && bestOverlap > 0);
    if (best.length === 1) return best[0].option;
  }
  if (locationTokens.length) {
    const bestOverlap = Math.max(...scored.map(item => item.locationOverlap));
    const best = scored.filter(item => item.locationOverlap === bestOverlap && bestOverlap > 0);
    if (best.length === 1) return best[0].option;
  }
  if (targetTokens.length) {
    const bestScore = Math.max(...scored.map(item => item.score));
    const best = scored.filter(item => item.score === bestScore && bestScore > 0);
    if (best.length === 1) return best[0].option;
    if (best.length > 1) {
      const names = best.map(item => item.option.text).join("; ");
      throw new Error(`More than one official MXGP round could match “${context.event || context.eventLocation || "the scheduled event"}”: ${names}. Check the event name and venue on the Commissioner schedule.`);
    }
  }
  if (candidates.length === 1) return candidates[0];
  const available = candidates.slice(0, 12).map(option => option.text).join("; ");
  throw new Error(`Couldn't match the scheduled event “${context.event || ""}”${context.round ? ` (Round ${context.round})` : ""} to the official MXGP Round dropdown. Available rounds include: ${available}. Check the scheduled event name and venue.`);
}

function mxgpSessionOptionMatches(text, phase) {
  const label = normalizeHeader(text);
  const requested = normalizeHeader(phase || "");
  // The official dropdown has appeared with both "Race Qualifying" and
  // "Qualifying Race" wording. Treat these as the same dedicated session.
  if (requested.includes("qualifying")) {
    return label.includes("qualifying") && (label.includes("race") || label === "qualifying");
  }
  // Never use a loose substring test here: Race 1 and Race 2 must remain
  // mutually exclusive even when the portal shortens its option labels.
  const wantsMoto1 = requested.includes("moto1") || requested.includes("grandprixrace1") || requested === "race1";
  const wantsMoto2 = requested.includes("moto2") || requested.includes("grandprixrace2") || requested === "race2";
  if (wantsMoto1) return label === "grandprixrace1" || label === "race1" || label === "moto1";
  if (wantsMoto2) return label === "grandprixrace2" || label === "race2" || label === "moto2";
  return false;
}

function mxgpResultsFrameUrl(html, pageUrl) {
  const source = String(html || "");
  const frames = [...source.matchAll(/<iframe\b([^>]*)>/gi)];
  for (const match of frames) {
    const attrs = parseHtmlAttributes(match[1]);
    const src = attrs.src || attrs["data-src"] || "";
    if (!src) continue;
    const candidate = new URL(src, pageUrl);
    if (candidate.hostname.toLowerCase() === "results.mxgp.com" && /reslists\.aspx/i.test(candidate.pathname)) return candidate;
  }
  return null;
}

async function submitMxgpSelectChoice(page, series, selectedControl, selectedOption, selectedValues = {}, readPage = readOfficialPage) {
  const { form, control } = selectedControl;
  if (!control.name) throw new Error(`The official MXGP ${selectedControl.label} dropdown did not expose a form field name.`);
  const values = new URLSearchParams();
  let selectedFieldWritten = false;
  for (const field of form.fields) {
    if (field.name === control.name) {
      values.append(field.name, selectedOption.value);
      selectedFieldWritten = true;
      continue;
    }
    const value = Object.prototype.hasOwnProperty.call(selectedValues, field.name) ? selectedValues[field.name] : field.value;
    values.append(field.name, value);
  }
  if (!selectedFieldWritten) values.append(control.name, selectedOption.value);
  const changeHandler = String(control.attrs.onchange || "");
  if (/__doPostBack/i.test(changeHandler)) {
    values.set("__EVENTTARGET", control.name);
    if (!values.has("__EVENTARGUMENT")) values.set("__EVENTARGUMENT", "");
  }
  const action = new URL(form.action || page.finalUrl.href, page.finalUrl.href);
  const requestOptions = form.method === "POST"
    ? { method: "POST", body: values.toString(), headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Referer": page.finalUrl.href } }
    : { headers: { "Referer": page.finalUrl.href } };
  if (form.method !== "POST") {
    for (const [name, value] of values.entries()) action.searchParams.set(name, value);
  }
  return readPage(action, series, requestOptions);
}

async function resolveMxgpOfficialPage(inputUrl, context = {}) {
  const standingsUrl = new URL("https://results.mxgp.com/mxgp/standings.aspx");
  const resultsUrl = new URL("https://results.mxgp.com/reslists.aspx");
  // Always start at the official chooser when the supplied URL is a landing
  // page or only a partially filtered reslists URL. The selected event, class
  // and scoring phase are derived from the Commissioner scoring controls.
  const cookieJar = new Map();
  let previousPage = null;
  const readMxgpPage = async (targetUrl, _series, requestOptions = {}) => {
    const headers = { ...(requestOptions.headers || {}), Referer: requestOptions.headers?.Referer || previousPage?.finalUrl.href || "https://results.mxgp.com/" };
    if (cookieJar.size) headers.Cookie = [...cookieJar].map(([name, value]) => `${name}=${value}`).join("; ");
    const fetched = await readOfficialPage(targetUrl, "MXGP", { ...requestOptions, headers });
    for (const cookie of fetched.setCookies || []) {
      const pair = String(cookie).split(";")[0];
      const equals = pair.indexOf("=");
      if (equals <= 0) continue;
      const name = pair.slice(0, equals).trim();
      const value = pair.slice(equals + 1).trim();
      if (/max-age=0/i.test(cookie) || /expires=Thu, 01 Jan 1970/i.test(cookie)) cookieJar.delete(name);
      else cookieJar.set(name, value);
    }
    previousPage = fetched;
    return fetched;
  };
  // Start from the requested official Standings page. Its iframe contains the
  // four-filter results application; follow that frame so the importer uses
  // the same entry point as a browser user. Keep reslists.aspx as a fallback
  // for direct links and older portal responses without an iframe.
  const startUrl = inputUrl && /\/mxgp\/standings\.aspx$/i.test(new URL(inputUrl).pathname)
    ? new URL(inputUrl)
    : standingsUrl;
  const landingPage = await readMxgpPage(startUrl, "MXGP");
  const frameUrl = mxgpResultsFrameUrl(landingPage.body, landingPage.finalUrl.href);
  let page = frameUrl ? await readMxgpPage(frameUrl, "MXGP") : landingPage;
  if (!parseMxgpSelectControls(page.body, page.finalUrl.href).some(form => form.controls.length >= 4)) {
    page = await readMxgpPage(resultsUrl, "MXGP");
  }
  // Keep filter choices explicitly between requests. Some portal responses do
  // not mark prior <option> values as selected, so relying only on markup can
  // silently reset the championship or round when the next dropdown is posted.
  const selectedValues = Object.create(null);
  let forms = parseMxgpSelectControls(page.body, page.finalUrl.href, selectedValues);
  const selections = [];

  const championship = mxgpFindSelect(forms, "Championship", text => mxgpOptionExact(text, "FIM Motocross World Championship"));
  const championshipOption = championship.control.options.find(option => mxgpOptionExact(option.text, "FIM Motocross World Championship"));
  if (!championshipOption) throw new Error("The FIM Motocross World Championship option is not available on the official MXGP source.");
  page = await submitMxgpSelectChoice(page, "MXGP", championship, championshipOption, selectedValues, readMxgpPage);
  selectedValues[championship.control.name] = championshipOption.value;
  if (championship.control.id) selectedValues[championship.control.id] = championshipOption.value;
  selections.push(championshipOption.text);
  if (!mxgpOptionExact(championshipOption.text, "FIM Motocross World Championship")) throw new Error("MXGP championship selection verification failed.");

  // The official results portal exposes the Class filter before the Grand
  // Prix filter. Keep this exact order: Championship -> Class -> Round ->
  // Session. Selecting the round first can leave the class list in its
  // default state and the subsequent response may silently reset the round.
  forms = parseMxgpSelectControls(page.body, page.finalUrl.href, selectedValues);
  const targetClass = mxgpDivisionKey(context.division);
  if (!targetClass) throw new Error("Choose MXGP or MX2 in the Commissioner Class / Division field before importing MXGP results.");
  const classSelection = mxgpFindSelect(forms, "Class", text => mxgpOptionExact(text, targetClass));
  const classOption = classSelection.control.options.find(option => mxgpOptionExact(option.text, targetClass));
  page = await submitMxgpSelectChoice(page, "MXGP", classSelection, classOption, selectedValues, readMxgpPage);
  selectedValues[classSelection.control.name] = classOption.value;
  if (classSelection.control.id) selectedValues[classSelection.control.id] = classOption.value;
  selections.push(classOption.text);
  if (!mxgpOptionExact(classOption.text, targetClass)) throw new Error(`MXGP class selection verification failed: expected ${targetClass}.`);

  forms = parseMxgpSelectControls(page.body, page.finalUrl.href, selectedValues);
  const round = mxgpFindSelect(forms, "Round", text => /^grand\s+prix\s+of\b/i.test(text));
  const roundOption = chooseMxgpRoundOption(round.control, context);
  page = await submitMxgpSelectChoice(page, "MXGP", round, roundOption, selectedValues, readMxgpPage);
  selectedValues[round.control.name] = roundOption.value;
  if (round.control.id) selectedValues[round.control.id] = roundOption.value;
  selections.push(roundOption.text);
  if (!/^grand\s+prix\s+of\b/i.test(roundOption.text)) throw new Error("MXGP round selection verification failed: the selected event must begin with ‘Grand Prix of’. ");

  forms = parseMxgpSelectControls(page.body, page.finalUrl.href, selectedValues);
  const phaseLabel = String(context.phase || "").trim();
  if (!phaseLabel) throw new Error("Choose Qualifying Race, Moto 1 or Moto 2 in the Commissioner scoring segment before importing MXGP results.");
  const session = mxgpFindSelect(forms, "Session", text => mxgpSessionOptionMatches(text, phaseLabel));
  const sessionOption = session.control.options.find(option => mxgpSessionOptionMatches(option.text, phaseLabel));
  if (!sessionOption) throw new Error(`The official MXGP Session dropdown does not contain ${phaseLabel}.`);
  page = await submitMxgpSelectChoice(page, "MXGP", session, sessionOption, selectedValues, readMxgpPage);
  selectedValues[session.control.name] = sessionOption.value;
  if (session.control.id) selectedValues[session.control.id] = sessionOption.value;
  selections.push(sessionOption.text);
  if (!mxgpSessionOptionMatches(sessionOption.text, phaseLabel)) throw new Error(`MXGP session selection verification failed: expected ${phaseLabel}.`);

  const parsed = parseHtml(page.body, page.title, { series: "MXGP", division: targetClass, phase: phaseLabel, url: page.finalUrl.href });
  parsed.eventTitle = roundOption.text;
  parsed.sessionTitle = sessionOption.text;
  parsed.filterSelections = selections;
  parsed.fastestLap = parsed.rows.filter(row => row.bestLap && /^\d{1,2}:\d{2}\.\d{2,3}$/.test(String(row.bestLap).trim()))
    .sort((a, b) => parseMxgpLapTime(a.bestLap) - parseMxgpLapTime(b.bestLap))[0] || null;
  if (parsed.fastestLap) parsed.fastestLap.sourceUrl = page.finalUrl.href;
  return { page, url: page.finalUrl.href, eventTitle: roundOption.text, sessionTitle: sessionOption.text, selections, parsed };
}

function parseMxgpLapTime(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2}(?:\.\d{1,3})?)$/);
  return match ? Number(match[1]) * 60000 + Number(match[2]) * 1000 : Infinity;
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
      const raceNumber = phase.includes("moto2") || phase.includes("grandprixrace2") || phase === "race2" ? "2"
        : phase.includes("moto1") || phase.includes("grandprixrace1") || phase === "race1" ? "1" : "";
      const isQualifying = phase.includes("qualifying");
      if (isQualifying && !isQualifyingHeading) {
        throw new Error(`The official MXGP page is ${heading || "not labelled as a qualifying classification"}, not the selected Qualifying Race. Choose the correct session in the results page and fetch again.`);
      }
      if (raceNumber && (isQualifyingHeading || !raceMatch || raceMatch[1] !== raceNumber)) {
        throw new Error(`The official MXGP page is ${heading || "not labelled with a Grand Prix race number"}, not Moto ${raceNumber}. Choose the correct session in the results page and fetch again.`);
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

async function officialHttpError(response, finalUrl, sourceLabel) {
  let detail = "";
  try {
    const raw = await response.text();
    if (raw) {
      detail = stripHtml(raw).replace(/\s+/g, " ").slice(0, 220);
    }
  } catch { /* Keep the status + request target even if the body cannot be read. */ }
  const server = response.headers?.get?.("server") || "";
  const requestId = response.headers?.get?.("cf-ray") || response.headers?.get?.("x-request-id") || response.headers?.get?.("x-correlation-id") || "";
  const diagnostics = [server && `server ${server}`, requestId && `request ${requestId}`, detail && `response: ${detail}`].filter(Boolean).join("; ");
  return `${sourceLabel} returned HTTP ${response.status} (${response.statusText || "request refused"}) from ${finalUrl.hostname}${finalUrl.pathname}${diagnostics ? ` — ${diagnostics}` : ""}.`;
}

async function readOfficialJson(url, series) {
  const { response, finalUrl } = await fetchApprovedUrl(url, series);
  if (!response.ok) throw new Error(await officialHttpError(response, finalUrl, "The official results service"));
  const body = await readLimitedResponse(response);
  let json;
  try { json = JSON.parse(body); } catch { throw new Error(`The official MotoGP results service returned invalid JSON from ${finalUrl.hostname}${finalUrl.pathname}.`); }
  return { json, finalUrl };
}

async function readMotoGPApiJson(pathAndQuery) {
  const errors = [];
  for (const [index, base] of MOTOGP_API_BASES.entries()) {
    const url = new URL(String(pathAndQuery || "").replace(/^\/+/, ""), `${base}/`);
    try {
      return await readOfficialJson(url, "MotoGP");
    } catch (error) {
      errors.push(error.message || String(error));
      // The documented api.motogp.pulselive.com hostname is tried first;
      // retry the alternate official hostname if its edge refuses the request.
      if (index === 0 && /HTTP 403|HTTP 429|HTTP 5\d\d|fetch failed|timed out/i.test(error.message || "")) {
        await new Promise(resolve => setTimeout(resolve, 350));
      }
    }
  }
  const blocked = errors.some(message => /HTTP 403/.test(message));
  throw new Error(`${blocked ? "MotoGP's public results API refused the request on both official hostnames (HTTP 403)." : "MotoGP's official results API could not be reached through either published host."} The primary endpoint is ${MOTOGP_API_BASE}. ${errors.join(" | ")}`);
}

async function readLimitedBuffer(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error("The official results PDF is larger than the 5 MB import limit.");
    return buffer;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) { await reader.cancel(); throw new Error("The official results PDF is larger than the 5 MB import limit."); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function extractMotoGPPdfText(buffer) {
  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (error) {
    throw new Error("The MotoGP Fast Lap Rider PDF parser is unavailable. Reinstall the project dependencies and redeploy so pdfjs-dist is installed.");
  }
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
    stopAtErrors: true
  });
  const document = await loadingTask.promise;
  const lines = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content.items || []).filter(item => typeof item.str === "string" && item.str.trim()).map(item => ({
        text: item.str.trim(),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0)
      })).sort((a, b) => b.y - a.y || a.x - b.x);
      const pageLines = [];
      for (const item of items) {
        let line = pageLines[pageLines.length - 1];
        if (!line || Math.abs(line.y - item.y) > 1.5) {
          line = { y: item.y, items: [] };
          pageLines.push(line);
        }
        line.items.push(item);
      }
      for (const line of pageLines) {
        line.items.sort((a, b) => a.x - b.x);
        const text = line.items.map(item => item.text).join(" ").replace(/\s+/g, " ").trim();
        if (text) lines.push(text);
      }
      page.cleanup?.();
    }
  } finally {
    await document.destroy();
  }
  return lines.join("\n");
}

async function readOfficialPdf(url, series) {
  const { response, finalUrl } = await fetchApprovedUrl(url, series);
  if (!response.ok) throw new Error(await officialHttpError(response, finalUrl, "The official MotoGP PDF"));
  const buffer = await readLimitedBuffer(response);
  if (buffer.length < 5 || buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new Error("The official Fast Lap Rider link did not return a valid PDF file.");
  }
  const text = await extractMotoGPPdfText(buffer);
  return { text, finalUrl };
}

async function readMotoGPResourcePdf(url) {
  const initial = new URL(url.href || String(url));
  const resourceHosts = [initial.hostname, "resources.motogp.com", "resources.motogp.pulselive.com"]
    .filter((host, index, all) => all.indexOf(host) === index);
  const errors = [];
  for (const host of resourceHosts) {
    if (!hostIsAllowed(host, "MotoGP")) continue;
    const candidate = new URL(initial.href);
    candidate.hostname = host;
    try {
      return await readOfficialPdf(candidate, "MotoGP");
    } catch (error) {
      const message = error.message || String(error);
      errors.push(message);
      // A missing PDF.js dependency or a PDF parsing failure is not a CDN
      // hostname problem; surface it directly rather than issuing another GET.
      if (/PDF parser is unavailable|pdfjs-dist/i.test(message)) throw error;
      // MotoGP has used both official resources hostnames. Try the paired
      // host if its CDN edge returns a 403/404 in the Render region.
    }
  }
  throw new Error(`The official MotoGP PDF could not be fetched from either published resources host. ${errors.join(" | ")}`);
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

function motogpSessionMatches(session, code) {
  const wanted = normalizeHeader(code);
  const values = [
    session?.type, session?.code, session?.session_type, session?.sessionType,
    session?.session_code, session?.sessionCode, session?.session_shortname,
    session?.sessionShortName, session?.short_name, session?.shortName,
    session?.abbreviation, session?.name, session?.description, session?.label
  ].map(value => typeof value === "object"
    ? [value.code, value.type, value.name, value.description, value.label].filter(Boolean).join(" ")
    : String(value || ""));
  const hasExplicitQ2Number = Number(session?.number ?? session?.session_number ?? session?.sessionNumber) === 2;
  return values.some(value => {
    const normalized = normalizeHeader(value);
    if (normalized === wanted) return true;
    if (wanted === "q2") {
      return /(?:^|[^a-z0-9])q2(?:$|[^a-z0-9])/i.test(value) ||
        /qualifying(?:session)?\s*2/i.test(value) ||
        /second\s+qualifying/i.test(value) ||
        (hasExplicitQ2Number && (/qualifying/i.test(value) || normalizeHeader(value) === "q"));
    }
    if (wanted === "rac") return /(?:^|[^a-z0-9])rac(?:$|[^a-z0-9])/i.test(value) || /grand\s*prix\s*(?:race)?/i.test(value) || /^race$/i.test(value.trim());
    if (wanted === "spr") return /(?:^|[^a-z0-9])spr(?:$|[^a-z0-9])/i.test(value) || /sprint/i.test(value);
    return new RegExp(`(^|[^a-z0-9])${wanted}([^a-z0-9]|$)`, "i").test(value);
  });
}

function motogpStatusText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(motogpStatusText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return [value.code, value.short_code, value.shortCode, value.name, value.label, value.description, value.text, value.status]
      .map(motogpStatusText).filter(Boolean).join(" ");
  }
  return "";
}

function motogpGroupStatus(key) {
  const normalized = normalizeHeader(key);
  if (/nonclassified|notclassified/.test(normalized)) return "NC";
  if (/didnotfinishfirstlap|notfinishedfirstlap|didnotfinish|dnf/.test(normalized)) return "DNF";
  if (/didnotstart|dns/.test(normalized)) return "DNS";
  if (/disqualified|disqualification|dsq/.test(normalized)) return "DSQ";
  if (/withdrawn|withdrawals|wd/.test(normalized)) return "WD";
  return "";
}

function collectMotoGPClassificationItems(payload) {
  const collected = [];
  const seenObjects = new Set();
  const isRiderRow = value => value && typeof value === "object" && !Array.isArray(value) &&
    (value.rider || value.competitor || value.athlete || value.rider_name || value.riderName || value.full_name || value.fullName);
  const visit = (value, inheritedStatus = "", depth = 0) => {
    if (depth > 10 || value == null) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, inheritedStatus, depth + 1);
      return;
    }
    if (typeof value !== "object" || seenObjects.has(value)) return;
    seenObjects.add(value);
    const ownLabel = [value.label, value.title, value.name, value.description, value.section, value.status]
      .map(motogpStatusText).filter(Boolean).join(" ");
    const ownGroupStatus = motogpGroupStatus(ownLabel) || inheritedStatus;
    if (isRiderRow(value)) {
      collected.push({ item: value, groupStatus: ownGroupStatus, sourceOrder: collected.length });
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const groupStatus = motogpGroupStatus(key) || ownGroupStatus;
      if (child && typeof child === "object") visit(child, groupStatus, depth + 1);
    }
  };
  visit(payload);
  // Some older result-service responses wrap a flat list under a less common
  // key; retain compatibility with the original result-array discovery path.
  if (!collected.length) {
    const fallback = arrayFromPayload(payload, ["classification", "results", "rows", "data"]);
    fallback.forEach((item, sourceOrder) => collected.push({ item, groupStatus: "", sourceOrder }));
  }
  return collected;
}

function motogpClassificationStatus(item, positionValue, groupStatus = "") {
  const rider = item?.rider || item?.competitor || item?.athlete || {};
  const raw = [
    positionValue,
    item?.status, item?.status_code, item?.statusCode, item?.status_name, item?.statusName,
    item?.result_status, item?.resultStatus, item?.classification_status, item?.classificationStatus,
    item?.position_status, item?.positionStatus, item?.rider_status, item?.riderStatus,
    item?.reason, item?.reason_description, item?.reasonDescription,
    rider?.status, rider?.result_status, rider?.classification_status
  ].map(motogpStatusText).filter(Boolean).join(" ");
  if (/non[ -]?classified|not[ -]?classified|outstnd|out of standings|\bNC\b/i.test(raw)) return "NC";
  if (/did not finish first lap|not finish(?:ed)? first lap|\bDNF\b|did not finish|retired/i.test(raw)) return "DNF";
  if (/did not start|not started|\bDNS\b/i.test(raw)) return "DNS";
  if (/disqualif|\bDSQ\b/i.test(raw)) return "DSQ";
  if (/withdrawn|\bWD\b/i.test(raw)) return "WD";
  return groupStatus;
}

function motogpPositionNumber(value) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : 0;
  if (value && typeof value === "object") {
    for (const key of ["position", "pos", "rank", "place", "order", "value", "number"]) {
      const parsed = motogpPositionNumber(value[key]);
      if (parsed) return parsed;
    }
    return 0;
  }
  const text = String(value ?? "").trim();
  // Never interpret a lap time (for example 01:32.456 or 1'32.456) as a
  // finishing position. A race position must be an integer rank token.
  if (/^\d{1,2}\s*[:']\s*\d{2}/.test(text)) return 0;
  const match = text.match(/^(\d{1,3})(?:st|nd|rd|th)?(?:\s*\.?$|\s+)/i) || text.match(/^(\d{1,3})$/);
  return match ? Number(match[1]) : 0;
}

function motogpPositionFromItem(item) {
  for (const key of ["position", "pos", "rank", "place", "position_number", "positionNumber",
    "classification_position", "classificationPosition", "result_position", "resultPosition",
    "rider_position", "riderPosition", "order", "classification_order", "classificationOrder"]) {
    const parsed = motogpPositionNumber(item?.[key]);
    if (parsed) return parsed;
  }
  return 0;
}

function motogpStatsClassificationUrl(payload, sessionContext = {}) {
  // Backward-compatible name retained for older callers. The Stats Centre
  // HTML now redirects to SSO, so this resolves the official session PDF.
  return motogpClassificationPdfUrl(payload, sessionContext);
}

function motogpClassificationPdfUrl(payload, sessionContext = {}) {
  const candidates = [];
  const visit = (value, depth = 0) => {
    if (depth > 10 || value == null) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (/\/(?:Classification|FastLapRider)\.pdf(?:$|[?#])/i.test(text)) candidates.push(text);
      return;
    }
    if (Array.isArray(value)) { value.forEach(child => visit(child, depth + 1)); return; }
    if (typeof value === "object") Object.values(value).forEach(child => visit(child, depth + 1));
  };
  visit(payload);
  visit(sessionContext);
  const preferred = candidates.find(value => /\/Classification\.pdf(?:$|[?#])/i.test(value)) ||
    candidates.find(value => /\/FastLapRider\.pdf(?:$|[?#])/i.test(value));
  if (preferred) {
    const url = new URL(preferred, "https://resources.motogp.com");
    if (/\/FastLapRider\.pdf(?:$|[?#])/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/FastLapRider\.pdf$/i, "Classification.pdf");
    }
    if (!hostIsAllowed(url.hostname, "MotoGP")) throw new Error("The official MotoGP Classification PDF points to an unapproved host.");
    return url;
  }
  const year = String(sessionContext.year || sessionContext.seasonYear || "").match(/^(19\d{2}|20\d{2})$/)?.[1] || "";
  const event = sessionContext.event || {};
  const eventCode = String(event.short_name || event.shortName || event.event_code || event.eventCode || event.code || "").trim().toUpperCase();
  const sessionCode = String(sessionContext.sessionCode || "").trim().toUpperCase();
  if (year && /^[A-Z0-9]{2,5}$/.test(eventCode) && ["RAC", "SPR", "Q2"].includes(sessionCode)) {
    return new URL(`/files/results/${year}/${eventCode}/MotoGP/${sessionCode}/Classification.pdf`, "https://resources.motogp.com");
  }
  return null;
}

function normalizeMotoGPPdfRiderName(value) {
  const cleaned = normalizeSeriesRiderName(value, "MotoGP");
  return cleaned.split(/\s+/).map(token => {
    if (!/^[A-Z][A-Z'’\-]+$/.test(token)) return token;
    return token.toLowerCase().replace(/(^|[-'’])([a-z])/g, (_match, boundary, letter) => `${boundary}${letter.toUpperCase()}`);
  }).join(" ");
}

function parseMotoGPClassificationPdfText(text, sourceTitle = "MotoGP official classification", sessionCode = "RAC") {
  const nationCodes = new Set(["ARG", "AUS", "AUT", "BEL", "BRA", "CAN", "CHI", "CHN", "COL", "CRO", "CZE", "DEN", "ESP", "FIN", "FRA", "GBR", "GER", "HUN", "INA", "IND", "IRL", "ITA", "JPN", "KAZ", "KOR", "MAL", "MEX", "NED", "NOR", "NZL", "POL", "POR", "QAT", "ROU", "RSA", "RSM", "SLO", "SPA", "SUI", "SWE", "THA", "TUR", "UKR", "USA", "VEN"]);
  const classified = [];
  const unclassified = [];
  let activeStatus = "";
  const rows = String(text || "").split(/\r?\n/);
  const timePattern = /^\d{1,2}[’']\d{2}\.\d{3}$/;
  const colonTimePattern = /^\d{1,2}:\d{2}\.\d{3}$/;

  for (const [sourceOrder, rawLine] of rows.entries()) {
    const line = rawLine.trim().replace(/\s+/g, " ");
    if (!line) continue;
    const sectionStatus = motogpGroupStatus(line);
    if (sectionStatus && !/^\d/.test(line)) { activeStatus = sectionStatus; continue; }
    if (/^(pos\.?|pts\.?|#\s+rider|rider\s+nation|classification|race|sprint|grand prix|pole position|fastest lap|best race lap|all-time lap record|race condition|air:|ground:|humidity:|dry$|wet$)/i.test(line)) continue;

    const tokens = line.split(/\s+/);
    if (tokens.length < 5) continue;
    let position = 0;
    let numberIndex = 0;
    let status = activeStatus;

    if (activeStatus) {
      // In MotoGP PDF sections such as "Not classified", the first numeric
      // field is the bike number; the row remains after the classified order.
      numberIndex = 0;
    } else {
      position = motogpPositionNumber(tokens[0]);
      if (!position) continue;
      // Race classification sheets include championship points between Pos
      // and bike number; Q2 sheets generally go directly from Pos to No.
      numberIndex = /^\d{1,3}[A-Za-z]?$/.test(tokens[1] || "") && /^\d{1,3}[A-Za-z]?$/.test(tokens[2] || "") ? 2 : 1;
      if (!/^\d{1,3}[A-Za-z]?$/.test(tokens[numberIndex] || "")) continue;
    }

    const number = cleanNumber(tokens[numberIndex]);
    if (!number) continue;
    let nationIndex = -1;
    for (let i = numberIndex + 2; i < tokens.length; i++) {
      if (nationCodes.has(tokens[i].toUpperCase())) { nationIndex = i; break; }
    }
    if (nationIndex <= numberIndex + 1) continue;
    const name = normalizeMotoGPPdfRiderName(tokens.slice(numberIndex + 1, nationIndex).join(" "));
    if (!name || name.split(/\s+/).length < 2) continue;
    const timeToken = tokens.slice(nationIndex + 1).find(token => timePattern.test(token) || colonTimePattern.test(token)) || "";
    const row = {
      position: position || 0,
      displayPosition: status || (position ? String(position) : "—"),
      status,
      sourceOrder,
      number,
      name,
      team: "",
      // Only Q2's table time represents a qualifying lap. RAC/SPR total race
      // times must never be mistaken for the fastest-lap bonus.
      bestLap: normalizeHeader(sessionCode) === "q2" ? timeToken.replace(/[’]/g, "'") : ""
    };
    if (status) unclassified.push(row); else classified.push(row);
  }

  classified.sort((a, b) => a.position - b.position || a.sourceOrder - b.sourceOrder);
  unclassified.sort((a, b) => a.sourceOrder - b.sourceOrder);
  let nextPosition = classified.reduce((max, row) => Math.max(max, row.position), 0) + 1;
  for (const row of unclassified) {
    row.position = nextPosition++;
    row.displayPosition = row.status || "NC";
  }
  const ordered = [...classified, ...unclassified];
  if (!ordered.length) throw new Error("The official MotoGP Classification PDF did not contain readable rider rows.");
  return { title: sourceTitle, rows: ordered };
}

function motogpRiderCellParts(cellHtml) {
  const visible = stripHtml(cellHtml).replace(/Image:\s*/gi, " ").replace(/\b(?:flag|rider)\b/gi, " ").replace(/\s+/g, " ").trim();
  const numberMatch = visible.match(/^#?\s*(\d{1,3})\s+(.+)$/);
  if (numberMatch) return { number: cleanNumber(numberMatch[1]), name: cleanRiderName(numberMatch[2]) };
  const anchors = [...String(cellHtml || "").matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
    .map(match => cleanRiderName(stripHtml(match[1])))
    .filter(name => name && !/^(rider|image|flag)$/i.test(name));
  const name = anchors.find(value => value.split(/\s+/).length >= 2) || cleanRiderName(visible);
  const number = (visible.match(/(?:^|\s)#?(\d{1,3})(?:\s|$)/) || [])[1] || "";
  return { number: cleanNumber(number), name };
}

function parseMotoGPStatsClassificationHtml(html, sourceTitle, sessionCode = "RAC") {
  const tableMatches = [...String(html || "").matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)];
  let selected = null;
  for (const match of tableMatches) {
    const rawRows = [];
    const trRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr;
    while ((tr = trRegex.exec(match[1]))) {
      const cells = [];
      const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cell;
      while ((cell = cellRegex.exec(tr[1]))) cells.push(cell[1]);
      // Keep one-cell colspan headings such as "Non-classified riders";
      // those headings establish the status for all following rows.
      if (cells.length) rawRows.push(cells);
    }
    for (let headerIndex = 0; headerIndex < Math.min(rawRows.length, 8); headerIndex++) {
      const headers = rawRows[headerIndex].map(stripHtml);
      const positionIndex = findColumn(headers, [/^(pos|position|rank|place)$/]);
      const riderIndex = findColumn(headers, [/^rider$/, /^ridername$/]);
      if (positionIndex >= 0 && riderIndex >= 0) {
        selected = { rawRows, headerIndex, headers, positionIndex, riderIndex };
        break;
      }
    }
    if (selected) break;
  }
  if (!selected) throw new Error("The official MotoGP Stats classification page did not expose its Pos. and Rider table.");
  const { rawRows, headerIndex, headers, positionIndex, riderIndex } = selected;
  const teamIndex = findColumn(headers, [/^team$/, /^raceteam$/]);
  const timeIndex = findColumn(headers, [/^time$/, /^timegap$/, /^fastestlap$/, /^bestlap$/]);
  let groupStatus = "";
  const mapped = [];
  for (const [sourceOrder, cells] of rawRows.slice(headerIndex + 1).entries()) {
    if (!Array.isArray(cells) || !cells.length) continue;
    const visibleCells = cells.map(stripHtml).filter(Boolean);
    if (!visibleCells.length) continue;
    const rowLabel = visibleCells.join(" ");
    const headingStatus = motogpGroupStatus(rowLabel);
    if (headingStatus && (cells.length <= 2 || !stripHtml(cells[riderIndex] || ""))) { groupStatus = headingStatus; continue; }
    const rider = motogpRiderCellParts(cells[riderIndex] || "");
    if (!rider.name || ["rider", "competitor"].includes(normalizeHeader(rider.name))) continue;
    const rawPosition = stripHtml(cells[positionIndex] || "");
    const position = motogpPositionNumber(rawPosition);
    const explicitStatus = motogpClassificationStatus({ status: rowLabel }, rawPosition, groupStatus);
    const status = explicitStatus || (!position ? (groupStatus || "NC") : "");
    const bestLap = normalizeHeader(sessionCode) === "q2" && timeIndex >= 0 ? stripHtml(cells[timeIndex] || "") : "";
    mapped.push({ position, displayPosition: status || String(position || "NC"), status, sourceOrder,
      number: rider.number, name: rider.name, team: teamIndex >= 0 ? stripHtml(cells[teamIndex] || "") : "", bestLap });
    if (position) groupStatus = "";
  }
  const classified = mapped.filter(row => row.position > 0 && !row.status)
    .sort((a, b) => a.position - b.position || a.sourceOrder - b.sourceOrder);
  const unclassified = mapped.filter(row => row.status || !row.position)
    .sort((a, b) => a.sourceOrder - b.sourceOrder);
  let nextPosition = classified.reduce((max, row) => Math.max(max, row.position), 0) + 1;
  for (const row of unclassified) {
    row.position = nextPosition++;
    row.displayPosition = row.status || "NC";
    row.status = row.status || "NC";
  }
  const ordered = [...classified, ...unclassified];
  if (!ordered.length) throw new Error("The official MotoGP Stats page did not contain readable rider rows.");
  return { title: sourceTitle || "MotoGP official classification", rows: ordered };
}

function motogpClassificationRows(payload, sourceTitle, sessionCode = "") {
  const rows = collectMotoGPClassificationItems(payload);
  if (!rows.length) throw new Error("The official MotoGP classification response did not contain rider rows.");
  const mapped = [];
  rows.forEach(({ item, groupStatus, sourceOrder }) => {
    const rider = item?.rider || item?.competitor || item?.athlete || {};
    const first = rider.first_name || rider.firstName || rider.given_name || "";
    const last = rider.last_name || rider.lastName || rider.family_name || "";
    const name = normalizeSeriesRiderName(rider.full_name || rider.fullName || rider.name || item.rider_name || item.riderName || `${first} ${last}`, "MotoGP");
    const parsedPosition = motogpPositionFromItem(item);
    const explicitStatus = motogpClassificationStatus(item, "", groupStatus);
    const status = explicitStatus || (!parsedPosition && groupStatus ? groupStatus : "");
    if (!name || ["rider", "competitor"].includes(normalizeHeader(name))) return;
    const lap = item.best_lap || item.bestLap || item.fastest_lap || item.fastestLap || {};
    const teamValue = item.team?.name || item.team_name || item.teamName || rider.team?.name || "";
    const number = cleanNumber(rider.number ?? item.rider_number ?? item.riderNumber ?? item.number ?? "");
    // A named rider without a usable number/position still needs the Stats
    // fallback; do not silently discard an incomplete official result row.
    const q2Time = normalizeHeader(sessionCode) === "q2" ? (item.time || item.lap_time || item.lapTime || item.best_time || item.bestTime || "") : "";
    const bestLap = lap.time || lap.lap_time || lap.lapTime || item.best_lap_time || item.bestLapTime || q2Time || "";
    mapped.push({
      position: parsedPosition,
      displayPosition: status || (parsedPosition ? String(parsedPosition) : "—"),
      status,
      requiresPositionFallback: !parsedPosition && !status,
      sourceOrder,
      number,
      name,
      team: String(teamValue || ""),
      bestLap: String(bestLap)
    });
  });
  const classified = mapped.filter(row => row.position > 0 && !row.status)
    .sort((a, b) => a.position - b.position || a.sourceOrder - b.sourceOrder);
  const unclassified = mapped.filter(row => row.status)
    .sort((a, b) => a.sourceOrder - b.sourceOrder);
  const unresolved = mapped.filter(row => row.requiresPositionFallback)
    .sort((a, b) => a.sourceOrder - b.sourceOrder);
  let nextScoringPosition = classified.reduce((max, row) => Math.max(max, row.position), 0) + 1;
  for (const row of unclassified) {
    row.position = nextScoringPosition++;
    row.displayPosition = row.status;
  }
  const ordered = [...classified, ...unclassified, ...unresolved];
  if (!ordered.length) throw new Error("The official MotoGP classification did not contain any readable rider rows.");
  return { title: sourceTitle, rows: ordered };
}

function motogpHasRankedClassificationRows(result) {
  const rows = result?.rows || [];
  return rows.some(row => Number(row.position) > 0 && !row.status) &&
    !rows.some(row => row.requiresPositionFallback || (!Number(row.position) && !row.status));
}

async function readMotoGPClassification(payload, sourceTitle, sessionCode, sessionContext = {}) {
  let result = null;
  let jsonError = "";
  try { result = motogpClassificationRows(payload, sourceTitle, sessionCode); }
  catch (error) { jsonError = error.message || "The JSON classification could not be parsed."; }
  if (motogpHasRankedClassificationRows(result)) return result;

  // The HTML Stats Centre now redirects to an SSO sign-in for some requests.
  // Use the official session Classification.pdf linked from MotoGP's own
  // session metadata instead; it exposes explicit Pos / Rider / Nation rows
  // and the ordered unclassified sections without relying on the protected UI.
  const pdfUrl = motogpClassificationPdfUrl(payload, { ...sessionContext, sessionCode });
  if (pdfUrl) {
    const pdf = await readMotoGPResourcePdf(pdfUrl);
    const pdfResult = parseMotoGPClassificationPdfText(pdf.text, sourceTitle, sessionCode);
    if (!motogpHasRankedClassificationRows(pdfResult)) {
      throw new Error(`The official MotoGP ${sessionCode} Classification PDF did not contain a complete ranked list. No lap times were imported as race positions.`);
    }
    pdfResult.sourceUrl = pdf.finalUrl.href;
    return pdfResult;
  }
  if (result) {
    throw new Error(`The official MotoGP ${sessionCode} response did not provide a complete numeric classification${jsonError ? ` (${jsonError})` : ""}, and its session metadata did not expose a Classification PDF. No lap times were imported as race positions.`);
  }
  throw new Error(jsonError || `The official MotoGP ${sessionCode} classification could not be parsed.`);
}

function motogpLapTimeMilliseconds(value) {
  const text = String(value || "").trim().replace(/[’]/g, "'");
  let match = text.match(/^(\d{1,2})[:'](\d{2}(?:\.\d+)?)$/);
  if (match) return Number(match[1]) * 60000 + Number(match[2]) * 1000;
  match = text.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if (match) return Number(match[1]) * 3600000 + Number(match[2]) * 60000 + Number(match[3]) * 1000;
  return Infinity;
}

function motogpFastestQualifierFromRows(rows) {
  const candidates = (rows || []).filter(row => row && row.name && !row.status && Number(row.position) > 0);
  if (!candidates.length) return null;
  const timed = candidates.map(row => ({ row, time: motogpLapTimeMilliseconds(row.bestLap) })).filter(item => Number.isFinite(item.time));
  if (timed.length) return timed.sort((a, b) => a.time - b.time || a.row.position - b.row.position)[0].row;
  return candidates.sort((a, b) => a.position - b.position || a.sourceOrder - b.sourceOrder)[0];
}

function motogpFastLapRiderPdfUrl(classificationPayload) {
  const candidateUrls = [];
  const labelledUrls = [];
  const seen = new Set();
  const addUrl = value => {
    if (typeof value !== "string" || seen.has(value)) return;
    let candidate = value.trim();
    if (!/^https:\/\//i.test(candidate)) {
      if (!/\/(?:FastLapRider|Classification)\.pdf(?:$|[?#])/i.test(candidate)) return;
      candidate = new URL(candidate, "https://resources.motogp.com").href;
    }
    seen.add(candidate);
    candidateUrls.push(candidate);
  };
  const visit = (value, depth = 0) => {
    if (depth > 7 || value == null) return;
    if (typeof value === "string") {
      addUrl(value);
    } else if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
    } else if (typeof value === "object") {
      const label = [value.label, value.title, value.name, value.description, value.type, value.file_name, value.fileName, value.filename, value.file_title, value.fileTitle].filter(Boolean).join(" ");
      const href = value.href || value.url || value.uri || value.file || value.path || value.download_url || value.downloadUrl || value.file_url || value.fileUrl;
      if (/fast\s*lap\s*rider/i.test(label) && typeof href === "string") labelledUrls.push(href);
      Object.values(value).forEach(item => visit(item, depth + 1));
    }
  };
  visit(classificationPayload);
  const direct = [...labelledUrls, ...candidateUrls].find(value => /\/FastLapRider\.pdf(?:$|[?#])/i.test(value));
  if (direct) {
    const directUrl = new URL(direct, "https://resources.motogp.com");
    if (!hostIsAllowed(directUrl.hostname, "MotoGP")) throw new Error("The official MotoGP Fast Lap Rider link points to an unapproved host.");
    return directUrl;
  }
  const classificationFile = candidateUrls.find(value => /\/Classification\.pdf(?:$|[?#])/i.test(value));
  if (!classificationFile) throw new Error("The selected official MotoGP session did not expose its Fast Lap Rider PDF link or paired Classification PDF URL.");
  const url = new URL(classificationFile);
  if (!hostIsAllowed(url.hostname, "MotoGP")) throw new Error("The official MotoGP classification PDF points to an unapproved host.");
  url.pathname = url.pathname.replace(/Classification\.pdf$/i, "FastLapRider.pdf");
  return url;
}

function parseMotoGPFastLapRiderText(text, sourceTitle = "MotoGP Fast Lap Rider") {
  const source = String(text || "");
  // The official PDF is reached through the session's dedicated Fast Lap Rider
  // hyperlink. Some PDF exports omit the report heading from extracted text,
  // so identify the document by its ranked row structure rather than requiring
  // a heading string that is not present in every export.
  const rows = [];
  for (const [sourceOrder, line] of source.split(/\r?\n/).entries()) {
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 8 || !/^\d{1,2}$/.test(tokens[0]) || !/^\d{1,3}$/.test(tokens[1])) continue;
    const timeIndex = tokens.findIndex((token, index) => index >= 4 && /^\d{1,2}[’']\d{2}\.\d{3}$/.test(token));
    if (timeIndex < 7) continue;
    const nationIndex = tokens.findIndex((token, index) => index >= 3 && index < timeIndex - 2 && /^[A-Z]{3}$/.test(token));
    if (nationIndex <= 2 || nationIndex >= timeIndex - 2) continue;
    const position = Number(tokens[0]);
    const number = cleanNumber(tokens[1]);
    const name = normalizeSeriesRiderName(tokens.slice(2, nationIndex).join(" "), "MotoGP");
    const team = tokens.slice(nationIndex + 1, timeIndex - 1).join(" ");
    const bestLap = tokens[timeIndex].replace(/[’]/g, "'");
    if (!position || !number || !name || !/^\d{1,2}'\d{2}\.\d{3}$/.test(bestLap)) continue;
    rows.push({
      position,
      displayPosition: String(position),
      status: "",
      sourceOrder,
      number,
      name,
      team,
      bestLap
    });
  }
  rows.sort((a, b) => a.position - b.position || a.sourceOrder - b.sourceOrder);
  if (!rows.length) throw new Error("The MotoGP Fast Lap Rider PDF did not contain readable ranked rider rows.");
  return { title: sourceTitle, rows };
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
  const seasonsResponse = await readMotoGPApiJson("results/seasons");
  const seasons = arrayFromPayload(seasonsResponse.json, ["seasons", "results"]);
  const requestedYear = yearMatch?.[1] || "";
  const season = (requestedYear ? seasons.find(item => String(item.year) === requestedYear) : null) || seasons.find(item => item.current) || seasons[0];
  if (!season?.id) throw new Error(`The official MotoGP archive does not list season ${requestedYear || "current"}.`);
  const year = String(season.year || requestedYear || "");

  const eventsResponse = await readMotoGPApiJson(`results/events?seasonUuid=${encodeURIComponent(season.id)}&isFinished=true`);
  const events = arrayFromPayload(eventsResponse.json, ["events", "results"]);
  if (!events.length) throw new Error(`The official MotoGP archive has no published event results for ${year}.`);
  const event = chooseMotoGPEvent(events, context, year);
  const eventId = event.id || event.uuid;
  if (!eventId) throw new Error("The selected MotoGP event did not include an official event identifier.");

  const categoriesResponse = await readMotoGPApiJson(`results/categories?eventUuid=${encodeURIComponent(eventId)}`);
  const categories = arrayFromPayload(categoriesResponse.json, ["categories", "results"]);
  const category = categories.find(item => normalizeHeader(item.name || item.description || item.category) === "motogp" || /motogp/i.test(String(item.name || item.description || ""))) || categories.find(item => String(item.legacy_id || item.legacyId || "") === "3");
  if (!category?.id && !category?.uuid) throw new Error("The selected MotoGP weekend did not expose its MotoGP category in the official results service.");
  const categoryId = category.id || category.uuid;

  const sessionsResponse = await readMotoGPApiJson(`results/sessions?eventUuid=${encodeURIComponent(eventId)}&categoryUuid=${encodeURIComponent(categoryId)}`);
  const sessions = arrayFromPayload(sessionsResponse.json, ["sessions", "results"]);
  const sprint = normalizeHeader(context.phase || "Grand Prix").includes("sprint");
  const raceCode = sprint ? "spr" : "rac";
  const raceSession = sessions.find(item => motogpSessionMatches(item, raceCode));
  if (!raceSession) throw new Error(`The official ${motogpEventText(event)} session list does not contain a ${sprint ? "Sprint" : "Grand Prix Race"} classification. Check the selected scoring tab and whether results have been published.`);
  const raceSessionId = raceSession.id || raceSession.uuid;
  if (!raceSessionId) throw new Error("The official MotoGP race session did not include a session identifier.");
  const classificationPath = `results/session/${encodeURIComponent(raceSessionId)}/classification?seasonYear=${encodeURIComponent(year)}&test=false`;
  const classificationResponse = await readMotoGPApiJson(classificationPath);
  const classificationUrl = classificationResponse.finalUrl;
  const eventTitle = motogpEventText(event) || `${year} MotoGP Grand Prix`;
  const sessionTitle = sprint ? "Sprint" : "Grand Prix";
  const result = await readMotoGPClassification(classificationResponse.json, `${eventTitle} — ${sessionTitle}`, raceCode.toUpperCase(), { session: raceSession, event, year });

  let fastestLap = null;
  let fastestLapError = "";
  let fastestLapSourceUrl = "";
  try {
    // Prefer the selected session's own "Fast Lap Rider" link from its
    // session metadata. If only the paired Classification.pdf is present,
    // the official FastLapRider.pdf lives in the same session folder.
    const fastLapPdfUrl = motogpFastLapRiderPdfUrl({ session: raceSession, classification: classificationResponse.json });
    const fastLapPdf = await readMotoGPResourcePdf(fastLapPdfUrl);
    const fastLapResults = parseMotoGPFastLapRiderText(fastLapPdf.text, `${eventTitle} — ${sessionTitle} Fast Lap Rider`);
    fastestLapSourceUrl = fastLapPdf.finalUrl.href;
    fastestLap = fastLapResults.rows[0] || null;
    if (fastestLap) fastestLap.sourceUrl = fastestLapSourceUrl;
    if (!fastestLap) fastestLapError = "The official Fast Lap Rider PDF did not identify a fastest rider.";
  } catch (error) {
    fastestLapError = error.message || "Could not read the official MotoGP Fast Lap Rider PDF.";
  }

  let fastestQualifier = null;
  let fastestQualifierError = "";
  // Fastest qualifier is taken from the event's own Q2 session page, in the
  // same session-results structure as RAC and SPR (not from a generic grid or
  // pole-position summary elsewhere on the event page).
  const q2Session = sessions.find(item => motogpSessionMatches(item, "Q2"));
  if (q2Session?.id || q2Session?.uuid) {
    try {
      const q2Path = `results/session/${encodeURIComponent(q2Session.id || q2Session.uuid)}/classification?seasonYear=${encodeURIComponent(year)}&test=false`;
      const q2Response = await readMotoGPApiJson(q2Path);
      const q2Url = q2Response.finalUrl;
      const q2Results = await readMotoGPClassification(q2Response.json, `${eventTitle} — Q2`, "Q2", { session: q2Session, event, year });
      fastestQualifier = motogpFastestQualifierFromRows(q2Results.rows);
      if (fastestQualifier) fastestQualifier.sourceUrl = q2Results.sourceUrl || q2Url.href;
      else fastestQualifierError = "The official Q2 classification did not contain a rider with a valid numeric position or lap time.";
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
    fastestLap,
    fastestLapSourceUrl,
    fastestLapError,
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
    if (series === "MXGP") {
      const isFilteredResult = url.hostname.toLowerCase() === "results.mxgp.com" &&
        /\/reslists\.aspx$/i.test(url.pathname) && url.searchParams.has("ct") && url.searchParams.has("c") && url.searchParams.has("e");
      if (!isFilteredResult) resolved = await resolveMxgpOfficialPage(url, context);
    } else if (url.hostname.toLowerCase() === "results.mxgp.com" && ["/", "/mxgp/", "/mxon/", "/mxgp", "/mxon"].includes(url.pathname.toLowerCase())) {
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
  if (series === "MXGP") {
    const lapRows = result.rows.filter(row => row.bestLap && Number.isFinite(parseMxgpLapTime(row.bestLap)));
    fastestLap = lapRows.sort((a, b) => parseMxgpLapTime(a.bestLap) - parseMxgpLapTime(b.bestLap))[0] || null;
    if (fastestLap) fastestLap.sourceUrl = fetchedUrl;
  }
  const outputDivision = series === "Triple Crown Series" ? `CAN ${tcsDivisionKey(division)}` : (divisionKey(division) || (series === "MXGP" || series === "MXON" ? String(division || "") : ""));
  return {
    ...result,
    source: resolved ? resolved.url : fetchedUrl,
    fetchedUrl,
    division: result.division || outputDivision,
    eventTitle: result.eventTitle || resolved?.eventTitle || "",
    sessionTitle: result.sessionTitle || resolved?.sessionTitle || result.tableHeading || "",
    filterSelections: resolved?.selections || result.filterSelections || [],
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
  MOTOGP_API_BASE,
  MOTOGP_API_BASES,
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
  parseMxgpSelectControls,
  chooseMxgpRoundOption,
  mxgpSessionOptionMatches,
  resolveMxgpOfficialPage,
  parseMxgpLapTime,
  motogpClassificationRows,
  collectMotoGPClassificationItems,
  motogpSessionMatches,
  motogpPositionNumber,
  motogpStatsClassificationUrl,
  motogpClassificationPdfUrl,
  parseMotoGPClassificationPdfText,
  readMotoGPResourcePdf,
  readMotoGPApiJson,
  parseMotoGPStatsClassificationHtml,
  motogpFastestQualifierFromRows,
  motogpFastLapRiderPdfUrl,
  parseMotoGPFastLapRiderText,
  extractMotoGPPdfText,
  resolveMotoGPResults,
  normalizeSeriesRiderName
};
