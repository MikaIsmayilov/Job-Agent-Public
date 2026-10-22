import assert from "node:assert/strict";
import test from "node:test";
import { byFreshnessThenScore, freshnessBand, postingAgeDays } from "../lib/freshness.ts";

const NOW = Date.parse("2026-10-13T12:00:00Z");

test("posting age and bands", () => {
  assert.equal(postingAgeDays("2026-10-10", NOW), 3);
  assert.equal(postingAgeDays(undefined, NOW), null);
  assert.equal(postingAgeDays("Date not provided", NOW), null);
  assert.equal(freshnessBand("2026-10-06", NOW), "fresh"); // 7 days
  assert.equal(freshnessBand("2026-09-20", NOW), "recent");
  assert.equal(freshnessBand("2026-08-01", NOW), "stale");
  assert.equal(freshnessBand(undefined, NOW), "undated");
});

test("fresh beats a higher score; stale ranks last; undated ranks with recent", () => {
  const jobs = [
    { id: "stale-90", datePosted: "2026-08-01", score: 90 },
    { id: "recent-80", datePosted: "2026-09-25", score: 80 },
    { id: "undated-85", score: 85 },
    { id: "fresh-70", datePosted: "2026-10-12", score: 70 },
  ];
  assert.deepEqual(jobs.sort(byFreshnessThenScore(NOW)).map((j) => j.id), ["fresh-70", "undated-85", "recent-80", "stale-90"]);
});
