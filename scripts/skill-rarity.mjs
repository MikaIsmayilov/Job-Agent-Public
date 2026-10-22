#!/usr/bin/env node
// Regenerates data/skill-rarity.json: for each resume skill, the share of
// stored postings that mention it. lib/matching.ts gives skills found in most
// postings ("stakeholder", "dashboard") less weight than rare, specific ones.
//
// Usage: node scripts/skill-rarity.mjs <jobs.json>
//   <jobs.json> is an array of jobs with title and rawDescription, e.g. saved
//   from `jobagent_scraper.api request GET "/api/jobs?id=<id>"` for every job.

import { readFileSync, writeFileSync } from "node:fs";
import { aliasMatches, rulesFromResume } from "../lib/matching.ts";
import resume from "../data/resume.json" with { type: "json" };

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/skill-rarity.mjs <jobs.json>");
  process.exit(1);
}
const jobs = JSON.parse(readFileSync(path, "utf8")).filter((job) => job.rawDescription);
const { evidence } = rulesFromResume(resume);
const share = {};
for (const rule of evidence) {
  const hits = jobs.filter((job) => aliasMatches(`${job.title} ${job.rawDescription}`.toLowerCase(), rule.aliases)).length;
  share[rule.label] = Math.round((hits / jobs.length) * 1000) / 1000;
}
const out = { generatedAt: new Date().toISOString().slice(0, 10), postings: jobs.length, share };
writeFileSync(new URL("../data/skill-rarity.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote data/skill-rarity.json from ${jobs.length} postings.`);
