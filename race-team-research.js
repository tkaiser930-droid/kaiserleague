"use strict";

const SERIES_TEAM_TERMS = {
  SMX: [
    "Monster Energy Yamaha Star Racing", "Honda HRC Progressive", "Team Honda HRC",
    "Monster Energy Pro Circuit Kawasaki", "Monster Energy Kawasaki", "Red Bull KTM Factory Racing",
    "Rockstar Energy Husqvarna Factory Racing", "Triumph Racing", "HEP Suzuki",
    "Muc-Off / FXR / ClubMX Yamaha", "Phoenix Racing Honda", "BarX Yamaha",
    "Partzilla PRMX Racing", "Liqui Moly Beta Racing", "Team Tedder Monster Energy KTM"
  ],
  MXGP: [
    "Red Bull KTM Factory Racing", "Monster Energy Yamaha Factory MXGP", "Kawasaki Racing Team MXGP",
    "Honda HRC", "Nestaan Husqvarna Factory Racing", "Ducati Factory MXGP Team",
    "Fantic Factory Racing MXGP", "Beta MRT Racing Team", "Triumph Racing Factory Team",
    "KTM Factory Racing", "Monster Energy Kawasaki"
  ],
  MXON: [
    "Red Bull KTM Factory Racing", "Monster Energy Yamaha Factory MXGP", "Kawasaki Racing Team MXGP",
    "Honda HRC", "Nestaan Husqvarna Factory Racing", "Ducati Factory MXGP Team",
    "Fantic Factory Racing MXGP", "Beta MRT Racing Team", "Triumph Racing Factory Team"
  ],
  MotoGP: [
    "Ducati Lenovo Team", "Aprilia Racing", "Red Bull KTM Factory Racing", "Monster Energy Yamaha MotoGP",
    "Honda HRC Castrol", "Prima Pramac Yamaha", "Pertamina Enduro VR46 Racing Team",
    "BK8 Gresini Racing MotoGP", "Trackhouse MotoGP Team", "LCR Honda", "Red Bull KTM Tech3"
  ],
  F1: [
    "McLaren Mastercard F1 Team", "Oracle Red Bull Racing", "Scuderia Ferrari HP",
    "Mercedes-AMG PETRONAS F1 Team", "Aston Martin Aramco F1 Team", "BWT Alpine Formula One Team",
    "Williams Racing", "Visa Cash App Racing Bulls", "MoneyGram Haas F1 Team", "Audi F1 Team",
    "Cadillac Formula 1 Team"
  ],
  "Triple Crown Series": [
    "Red Bull KTM", "Honda HRC", "Yamaha Canada", "Kawasaki Canada", "KTM Canada",
    "Husqvarna Canada", "GasGas Canada", "Triumph Racing"
  ]
};

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function stripTags(value) { return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(); }
function xmlTag(block, tag) {
  const match = String(block || "").match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
}
function parseBingRss(xml) {
  return [...String(xml || "").matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(match => {
    const block = match[1];
    return { title: xmlTag(block, "title"), url: xmlTag(block, "link"), snippet: xmlTag(block, "description") };
  }).filter(item => item.title && /^https?:\/\//i.test(item.url)).slice(0, 8);
}
function parseDuckDuckGo(html) {
  const source = String(html || "");
  const anchors = [...source.matchAll(/<a\b([^>]*\bclass\s*=\s*(["'])[^"']*result__a[^"']*\2[^>]*)>([\s\S]*?)<\/a>/gi)];
  return anchors.map(match => {
    const attrs = match[1], href = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2] || "";
    const title = stripTags(match[3]);
    const nearby = source.slice(match.index, match.index + 2400);
    const snippetMatch = nearby.match(/<a\b[^>]*class\s*=\s*(["'])[^"']*result__snippet[^"']*\1[^>]*>([\s\S]*?)<\/a>/i)
      || nearby.match(/<div\b[^>]*class\s*=\s*(["'])[^"']*result__snippet[^"']*\1[^>]*>([\s\S]*?)<\/div>/i);
    let url = decodeEntities(href);
    try { const parsed = new URL(url, "https://duckduckgo.com"); const redirected = parsed.searchParams.get("uddg"); url = redirected ? decodeURIComponent(redirected) : parsed.href; } catch { /* Invalid search result link is filtered below. */ }
    return { title, url, snippet: snippetMatch ? stripTags(snippetMatch[2]) : "" };
  }).filter(item => item.title && /^https?:\/\//i.test(item.url)).slice(0, 8);
}
function teamCandidatesFromResults(results, series, extraKnownTeams = []) {
  const sourceText = results.map(item => `${item.title} ${item.snippet}`).join("\n");
  const text = sourceText.toLocaleLowerCase();
  const preferred = SERIES_TEAM_TERMS[series] || [];
  const all = [...preferred, ...Object.values(SERIES_TEAM_TERMS).flat(), ...(Array.isArray(extraKnownTeams) ? extraKnownTeams : [])];
  const candidates = [];
  const seen = new Set();
  const add = value => {
    const team = String(value || "").replace(/[\s,;:.|]+$/g, "").replace(/\s+(?:race )?team$/i, "").trim();
    const key = team.toLocaleLowerCase();
    if (!team || team.length < 3 || team.length > 70 || key.split(/\s+/).length > 7 || seen.has(key)) return;
    seen.add(key); candidates.push(team);
  };
  for (const team of all) if (text.includes(team.toLocaleLowerCase())) add(team);
  // Search snippets often state a signing or team announcement directly. Surface
  // unfamiliar names as suggestions too; the commissioner must confirm them.
  const patterns = [
    /\b(?:signed|signs|signing)\s+(?:with|for)\s+([A-Z][A-Za-z0-9&'’./-]*(?:\s+[A-Z0-9][A-Za-z0-9&'’./-]*){0,5})/g,
    /\b(?:joins?|joining)\s+([A-Z][A-Za-z0-9&'’./-]*(?:\s+[A-Z0-9][A-Za-z0-9&'’./-]*){0,5})/g,
    /\b(?:will ride for|rides for|will race for|racing for|team is)\s+([A-Z][A-Za-z0-9&'’./-]*(?:\s+[A-Z0-9][A-Za-z0-9&'’./-]*){0,5})/g
  ];
  for (const pattern of patterns) for (const match of sourceText.matchAll(pattern)) add(match[1]);
  return candidates.slice(0, 8);
}
function buildTeamSearchQuery({ name, number, series, division, year }) {
  const rider = String(name || "").trim();
  const plate = String(number || "").trim().replace(/^#/, "");
  const context = [String(year || ""), String(series || ""), String(division || "")].filter(Boolean).join(" ");
  return [rider ? `"${rider}"` : "", plate ? `#${plate}` : "", context, "race team roster"].filter(Boolean).join(" ");
}
async function fetchSearchResults(query, fetchImpl = globalThis.fetch) {
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; KaiserFamilyFantasy/1.0; +https://kaiserleague.onrender.com)", "Accept": "application/rss+xml, application/xml, text/html;q=0.9, */*;q=0.8" };
  const bingUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  try {
    const response = await fetchImpl(bingUrl, { headers, signal: AbortSignal.timeout(6500) });
    if (!response.ok) throw new Error(`Bing search returned HTTP ${response.status}.`);
    const results = parseBingRss(await response.text());
    if (results.length) return { provider: "Bing", results };
  } catch (error) { var bingError = error; }
  const duckUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const response = await fetchImpl(duckUrl, { headers, signal: AbortSignal.timeout(6500) });
    if (!response.ok) throw new Error(`DuckDuckGo search returned HTTP ${response.status}.`);
    const results = parseDuckDuckGo(await response.text());
    if (results.length) return { provider: "DuckDuckGo", results };
  } catch (error) { var duckError = error; }
  return { provider: "Unavailable", results: [], error: [bingError?.message, duckError?.message].filter(Boolean).join("; ") || "No public search results were returned." };
}
async function researchRaceTeam(rider, fetchImpl = globalThis.fetch) {
  const query = buildTeamSearchQuery(rider);
  const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const search = await fetchSearchResults(query, fetchImpl);
  return {
    query, searchUrl, provider: search.provider, error: search.error || "",
    results: search.results,
    teamCandidates: teamCandidatesFromResults(search.results, rider.series, rider.knownTeams)
  };
}
module.exports = { SERIES_TEAM_TERMS, decodeEntities, parseBingRss, parseDuckDuckGo, teamCandidatesFromResults, buildTeamSearchQuery, fetchSearchResults, researchRaceTeam };
