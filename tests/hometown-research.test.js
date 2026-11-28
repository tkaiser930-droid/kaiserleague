"use strict";
const assert = require("node:assert/strict");
const { researchHometown, expandHometownQuery, cleanRegionCode } = require("../hometown-research");

(async () => {
  assert.equal(expandHometownQuery("Chattanooga,TN"), "Chattanooga, Tennessee, United States");
  assert.equal(expandHometownQuery("Kamloops,BC"), "Kamloops, British Columbia, Canada");
  assert.equal(expandHometownQuery("Brisbane,QLD"), "Brisbane, Queensland, Australia");
  assert.equal(expandHometownQuery("London,ENG"), "London, England, United Kingdom");
  assert.equal(expandHometownQuery("Barcelona, Spain"), "Barcelona, Spain");
  assert.equal(cleanRegionCode("US", { "ISO3166-2-lvl4": "US-TN", state: "Tennessee" }), "US-TN");

  let requestedUrl = "";
  const lookup = await researchHometown("Chattanooga,TN", async (url, options) => {
    requestedUrl = String(url);
    assert.match(options.headers["User-Agent"], /KaiserFamilyFantasySMX/);
    return new Response(JSON.stringify([{
      display_name: "Chattanooga, Hamilton County, Tennessee, United States",
      address: { city: "Chattanooga", state: "Tennessee", country: "United States", country_code: "us", "ISO3166-2-lvl4": "US-TN" }
    }]), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(new URL(requestedUrl).searchParams.get("q"), "Chattanooga, Tennessee, United States");
  assert.equal(lookup.found, true);
  assert.equal(lookup.countryCode, "US");
  assert.equal(lookup.regionCode, "US-TN");
  assert.equal(lookup.provider, "OpenStreetMap Nominatim");
  console.log("Hometown research tests passed: US / Canada hometown expansion, ISO region extraction and geocoding response normalization.");
})().catch(error => { console.error(error); process.exitCode = 1; });
