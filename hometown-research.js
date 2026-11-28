"use strict";

const LOOKUP_CACHE = new Map();
let lastLookupAt = 0;
const MIN_LOOKUP_INTERVAL_MS = 1100;

const US_STATES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia"
};
const CANADA_PROVINCES = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador",
  NS: "Nova Scotia", NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island",
  QC: "Quebec", SK: "Saskatchewan", YT: "Yukon"
};
const AUSTRALIA_REGIONS = {
  ACT: "Australian Capital Territory", NSW: "New South Wales", NT: "Northern Territory", QLD: "Queensland",
  SA: "South Australia", TAS: "Tasmania", VIC: "Victoria", WA: "Western Australia"
};
const UK_REGIONS = { ENG: "England", NIR: "Northern Ireland", SCT: "Scotland", WLS: "Wales" };

function expandHometownQuery(value) {
  const location = String(value || "").trim();
  const match = location.match(/^(.*?),\s*([A-Z]{2,3})$/i);
  if (!match) return location;
  const code = match[2].toUpperCase();
  if (US_STATES[code]) return `${match[1]}, ${US_STATES[code]}, United States`;
  if (CANADA_PROVINCES[code]) return `${match[1]}, ${CANADA_PROVINCES[code]}, Canada`;
  if (AUSTRALIA_REGIONS[code]) return `${match[1]}, ${AUSTRALIA_REGIONS[code]}, Australia`;
  if (UK_REGIONS[code]) return `${match[1]}, ${UK_REGIONS[code]}, United Kingdom`;
  return location;
}

function cleanRegionCode(countryCode, address) {
  const country = String(countryCode || "").toUpperCase();
  const candidates = Object.entries(address || {})
    .filter(([key, value]) => /^ISO3166-2-lvl\d+$/i.test(key) && value)
    .sort(([a], [b]) => Number(a.match(/\d+$/)?.[0] || 99) - Number(b.match(/\d+$/)?.[0] || 99));
  for (const [, value] of candidates) {
    const code = String(value).split(";")[0].trim().toUpperCase();
    if (code.startsWith(`${country}-`)) return code;
  }
  const stateCode = String(address?.state_code || address?.province_code || "").trim().toUpperCase();
  if (stateCode.startsWith(`${country}-`)) return stateCode;
  if (stateCode && /^[A-Z0-9-]{1,12}$/.test(stateCode)) return `${country}-${stateCode}`;
  return "";
}

async function waitForRateLimit() {
  const delay = MIN_LOOKUP_INTERVAL_MS - (Date.now() - lastLookupAt);
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  lastLookupAt = Date.now();
}

async function researchHometown(hometown, fetchImpl = globalThis.fetch) {
  const original = String(hometown || "").trim().replace(/\s+/g, " ");
  if (!original) return { hometown: original, found: false, error: "A hometown is required." };
  const cacheKey = original.toLowerCase();
  if (LOOKUP_CACHE.has(cacheKey)) return { ...LOOKUP_CACHE.get(cacheKey), hometown: original, cached: true };

  await waitForRateLimit();
  const query = expandHometownQuery(original);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");

  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "KaiserFamilyFantasySMX/1.0 (rider hometown country and region lookup)",
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Hometown lookup returned HTTP ${response.status}.`);
  const matches = await response.json();
  const result = Array.isArray(matches) ? matches[0] : null;
  const address = result?.address || {};
  const countryCode = String(address.country_code || "").toUpperCase();
  const regionCode = cleanRegionCode(countryCode, address);
  const regionName = String(address.state || address.province || address.region || address.county || "").trim();
  const found = !!countryCode;
  const payload = {
    hometown: original,
    found,
    countryCode,
    regionCode,
    regionName,
    displayName: String(result?.display_name || ""),
    provider: "OpenStreetMap Nominatim",
    sourceUrl: `https://nominatim.openstreetmap.org/ui/search.html?q=${encodeURIComponent(query)}`,
    error: found ? "" : "No country-level location match was returned."
  };
  LOOKUP_CACHE.set(cacheKey, payload);
  return payload;
}

module.exports = { researchHometown, expandHometownQuery, cleanRegionCode, US_STATES, CANADA_PROVINCES, AUSTRALIA_REGIONS, UK_REGIONS };
