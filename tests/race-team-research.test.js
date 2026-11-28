"use strict";
const assert = require("node:assert/strict");
const { parseBingRss, buildTeamSearchQuery, teamCandidatesFromResults, researchRaceTeam } = require("../race-team-research");

const rss = `<?xml version="1.0"?><rss><channel><item><title>Sacha Coenen signs with Red Bull KTM Factory Racing</title><link>https://example.com/sacha-team</link><description>Sacha Coenen will continue with Red Bull KTM Factory Racing for the upcoming season.</description></item></channel></rss>`;
const parsed = parseBingRss(rss);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].url, "https://example.com/sacha-team");
assert(teamCandidatesFromResults(parsed, "MXGP").includes("Red Bull KTM Factory Racing"), "team names mentioned by search results become confirmable suggestions");
assert.match(buildTeamSearchQuery({ name: "Sacha Coenen", number: "19", series: "SMX", division: "250", year: 2027 }), /Sacha Coenen.*#19.*2027 SMX 250/);
const inferred = teamCandidatesFromResults([
  { title: "Rider announcement", url: "https://example.com/rider", snippet: "Rider joins Apex Velocity Racing for the 2027 season." }
], "SMX", []);
assert(inferred.includes("Apex Velocity Racing"), "search snippets may surface previously unknown teams as unconfirmed suggestions");

(async () => {
  const fakeFetch = async url => ({ ok: true, status: 200, text: async () => rss });
  const result = await researchRaceTeam({ name: "Sacha Coenen", number: "19", series: "SMX", division: "250", year: 2027 }, fakeFetch);
  assert.equal(result.provider, "Bing");
  assert.equal(result.results.length, 1);
  assert(result.teamCandidates.includes("Red Bull KTM Factory Racing"));
  console.log("Race-team online research tests passed: query context, RSS parsing, source links, and candidate team extraction.");
})().catch(error => { console.error(error); process.exitCode = 1; });
