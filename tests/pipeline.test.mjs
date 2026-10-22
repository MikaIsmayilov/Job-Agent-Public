import assert from "node:assert/strict";
import test from "node:test";
import { analyzePipeline, byAppliedAt, daysWaiting, followUpDue } from "../lib/pipeline.ts";

const app = (overrides) => ({
  status: "applied",
  score: 70,
  roleFamily: "Data analytics",
  company: "Acme",
  ...overrides,
});

test("counts, response rate, and splits", () => {
  const stats = analyzePipeline([
    app({}),
    app({ status: "interview", score: 85, appliedAt: "2026-08-01T00:00:00Z", statusChangedAt: "2026-08-05T00:00:00Z" }),
    app({ status: "rejected", score: 55, roleFamily: "Financial analysis", appliedAt: "2026-08-01T00:00:00Z", statusChangedAt: "2026-08-09T00:00:00Z" }),
    app({ status: "new" }), // not an application
    app({ status: "ready" }), // not an application
  ]);
  assert.equal(stats.total, 3);
  assert.equal(stats.awaiting, 1);
  assert.equal(stats.interviews, 1);
  assert.equal(stats.rejected, 1);
  assert.equal(stats.responseRate, 67);
  assert.equal(stats.avgDaysToResponse, 6); // (4 + 8) / 2
  assert.equal(stats.byFamily[0].family, "Data analytics");
  assert.equal(stats.byFamily[0].total, 2);
  assert.deepEqual(stats.byScoreBand.map((b) => b.band), ["80+", "65-79", "50-64"]);
});

test("no responses yet: rate 0, avg null", () => {
  const stats = analyzePipeline([app({}), app({})]);
  assert.equal(stats.responseRate, 0);
  assert.equal(stats.avgDaysToResponse, null);
});

test("responses without appliedAt do not fabricate timing", () => {
  const stats = analyzePipeline([app({ status: "rejected", statusChangedAt: "2026-08-09T00:00:00Z" })]);
  assert.equal(stats.avgDaysToResponse, null);
  assert.equal(stats.responseRate, 100);
});

test("advanced counts actions; splits only use applications 14+ days old", () => {
  const now = Date.parse("2026-10-13T00:00:00Z");
  const stats = analyzePipeline(
    [
      app({ id: "a", appliedAt: "2026-09-20T00:00:00Z", datePosted: "2026-09-18", sponsorship: "not_offered", sourceKind: "official_ats" }),
      app({ id: "b", status: "rejected", appliedAt: "2026-09-20T00:00:00Z", datePosted: "2026-08-01", sourceKind: "official_ats" }),
      app({ id: "c", status: "interview", appliedAt: "2026-09-21T00:00:00Z", sourceKind: "pasted_text" }),
      app({ id: "d", appliedAt: "2026-10-12T00:00:00Z", datePosted: "2026-10-11" }), // too recent for splits
    ],
    { advancedIds: new Set(["a"]), nowMs: now },
  );
  assert.equal(stats.advanced, 2); // a via action, c via interview status
  assert.equal(stats.mature, 3);
  assert.deepEqual(
    Object.fromEntries(stats.byPostingAge.map((r) => [r.key, [r.total, r.advanced, r.rejected]])),
    { "0-7d": [1, 1, 0], "30d+": [1, 0, 1], undated: [1, 1, 0] },
  );
  assert.deepEqual(stats.bySponsorship.find((r) => r.key === "not_offered"), { key: "not_offered", total: 1, advanced: 1, rejected: 0 });
  assert.equal(stats.bySource[0].key, "official_ats");
});

test("byAppliedAt orders by date and time applied; never-applied jobs last", () => {
  const jobs = [
    { id: "ready" }, // no appliedAt
    { id: "first-am", appliedAt: "2026-05-04T09:05:00Z" },
    { id: "later", appliedAt: "2026-06-01T16:39:21Z" },
    { id: "first-pm", appliedAt: "2026-05-04T18:16:00Z" },
  ];
  assert.deepEqual([...jobs].sort(byAppliedAt("newest")).map((j) => j.id), ["later", "first-pm", "first-am", "ready"]);
  assert.deepEqual([...jobs].sort(byAppliedAt("oldest")).map((j) => j.id), ["first-am", "first-pm", "later", "ready"]);
});

test("follow-up is due after 10 silent days unless an action is planned", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const sent = { id: "a", status: "applied", appliedAt: "2026-09-27T19:50:00Z" };
  assert.equal(daysWaiting(sent, now), 16);
  assert.equal(followUpDue(sent, now, new Set()), true);
  assert.equal(followUpDue(sent, now, new Set(["a"])), false);
  assert.equal(followUpDue({ ...sent, appliedAt: "2026-10-13T16:39:00Z" }, now, new Set()), false);
  assert.equal(daysWaiting({ ...sent, status: "rejected" }, now), null); // they replied
  assert.equal(daysWaiting({ id: "b", status: "applied" }, now), null);
});
