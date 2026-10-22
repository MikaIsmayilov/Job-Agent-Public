import test from "node:test";
import assert from "node:assert/strict";
import { runAge, validateRunReport } from "../lib/agent-runs.ts";

test("validateRunReport keeps numeric summary fields and well-formed reviews", () => {
  const report = validateRunReport({
    kind: "mail",
    ok: true,
    summary: { scanned: 20, updates: 3, note: "text is dropped" },
    reviews: [
      { id: "abc", kind: "rejected", reason: "ambiguous", subject: "Your application to PlayField", sender: "PlayField <no-reply@playfield.com>", candidateIds: ["j1", "j2"] },
      { id: "no-candidates", kind: "rejected", reason: "ambiguous", candidateIds: [] },
      { id: "bad-kind", kind: "offer", reason: "ambiguous", candidateIds: ["j1"] },
    ],
  });
  assert.deepEqual(report.summary, { scanned: 20, updates: 3 });
  assert.deepEqual(report.reviews.map((r) => r.id), ["abc"]);
});

test("validateRunReport rejects unknown run kinds", () => {
  assert.throws(() => validateRunReport({ kind: "deploy" }), /scrape or mail/);
});

test("runAge flags overdue runs per kind", () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  assert.deepEqual(runAge("2026-10-14T11:20:00Z", "mail", now), { label: "40m ago", stale: false });
  assert.deepEqual(runAge("2026-10-14T02:00:00Z", "mail", now), { label: "10h ago", stale: true });
  assert.deepEqual(runAge("2026-10-13T09:00:00Z", "scrape", now), { label: "27h ago", stale: false });
  assert.deepEqual(runAge("2026-10-10T12:00:00Z", "scrape", now), { label: "4d ago", stale: true });
  assert.deepEqual(runAge(undefined, "scrape", now), { label: "never", stale: true });
});
