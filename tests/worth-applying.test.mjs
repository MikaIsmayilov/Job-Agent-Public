import assert from "node:assert/strict";
import test from "node:test";
import { isTargetLocation, worthApplying as worthFor } from "../lib/worth-applying.ts";
import { normalizeProfile } from "../lib/profile.ts";
import sample from "./fixtures/sample-profile.json" with { type: "json" };

// The fixture candidate: entry level, OPT, Boston or remote.
const profile = normalizeProfile(sample);
const worthApplying = (job, now) => worthFor(job, now, profile);

const NOW = Date.parse("2026-10-14T12:00:00Z");
const base = { status: "new", location: "Boston, MA", workMode: "Hybrid", datePosted: "2026-10-10", sponsorship: "unknown", experienceLevel: "entry" };

test("in a target place or remote", () => {
  assert.equal(isTargetLocation("Boston, MA", "Hybrid", profile), true);
  assert.equal(isTargetLocation("Houston, TX", "Remote", profile), true);
  assert.equal(isTargetLocation("United States (Remote)", "Unknown", profile), true);
  assert.equal(isTargetLocation("Reston, VA", "Onsite", profile), false);
  assert.equal(isTargetLocation("Houston, TX", "Remote", { ...profile, remoteOk: false }), false);
  // No places at all means anywhere.
  assert.equal(isTargetLocation("Reston, VA", "Onsite", { ...profile, places: [] }), true);
});

test("seniority follows the profile", () => {
  const job = { ...base, experienceLevel: "senior" };
  assert.equal(worthApplying(job, NOW), false);
  assert.equal(worthFor(job, NOW, { ...profile, seniority: "senior" }), true);
  assert.equal(worthFor({ ...base, experienceLevel: "mid" }, NOW, { ...profile, seniority: "mid" }), true);
});

test("a fresh Boston entry-level job is worth applying", () => {
  assert.equal(worthApplying(base, NOW), true);
  assert.equal(worthApplying({ ...base, status: "shortlisted", datePosted: undefined, experienceLevel: undefined }, NOW), true);
});

test("each hard rule excludes on its own", () => {
  for (const [why, job] of [
    ["already applied", { ...base, status: "applied" }],
    ["ready lives in Applications", { ...base, status: "ready" }],
    ["screened out", { ...base, screenedOut: "3+ years required" }],
    ["outside Boston, not remote", { ...base, location: "Lynchburg, VA", workMode: "Onsite" }],
    ["mid level", { ...base, experienceLevel: "mid" }],
    ["stale posting", { ...base, datePosted: "2026-08-01" }],
    ["citizenship required", { ...base, sponsorship: "not_offered", sponsorshipNote: "Must be a U.S. citizen." }],
    ["blocker found in the full posting", { ...base, sponsorship: "likely", gaps: ["Blocker: Posting explicitly excludes OPT/F-1 or requires permanent work authorization."] }],
  ]) {
    assert.equal(worthApplying(job, NOW), false, why);
  }
});

test("a plain no-sponsorship warning still shows (the user decides)", () => {
  assert.equal(worthApplying({ ...base, sponsorship: "not_offered", sponsorshipNote: "No visa sponsorship." }, NOW), true);
});

test("remote only counts when the source stated it", () => {
  const nyc = { ...base, location: "New York, NY", workMode: "Remote" };
  assert.equal(worthApplying({ ...nyc, evidence: [{ field: "workMode", direct: false }] }, NOW), false);
  assert.equal(worthApplying({ ...nyc, evidence: [{ field: "workMode", direct: true }] }, NOW), true);
  assert.equal(worthApplying({ ...nyc, workMode: "Unknown", location: "Remote, US" }, NOW), true);
});
