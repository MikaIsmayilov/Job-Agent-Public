import assert from "node:assert/strict";
import test from "node:test";
import { aggregateResumeGaps } from "../lib/gaps.ts";

const job = (overrides) => ({
  gaps: [],
  score: 70,
  experienceLevel: "entry",
  company: "Acme",
  roleFamily: "Data analytics",
  ...overrides,
});

test("tallies gaps across the relevant pool, sorted by demand", () => {
  const { pool, insights } = aggregateResumeGaps([
    job({ gaps: ["Modern analytics stack"], company: "A" }),
    job({ gaps: ["Modern analytics stack", "Experimentation design"], company: "B" }),
    job({ gaps: ["Modern analytics stack"], company: "C", roleFamily: "Product analytics" }),
    job({ gaps: ["Experimentation design"], company: "D" }),
  ]);
  assert.equal(pool, 4);
  assert.equal(insights[0].label, "Modern analytics stack");
  assert.equal(insights[0].count, 3);
  assert.equal(insights[0].share, 75);
  assert.deepEqual(insights[0].companies, ["A", "B", "C"]);
  assert.equal(insights[1].label, "Experimentation design");
  assert.equal(insights[1].count, 2);
});

test("excludes the placeholder gap, senior roles, and weak fits", () => {
  const { pool, insights } = aggregateResumeGaps([
    job({ gaps: ["Review role-specific requirements"] }),
    job({ gaps: ["Financial modeling / accounting"], experienceLevel: "senior" }),
    job({ gaps: ["Financial modeling / accounting"], score: 40 }),
    job({ gaps: ["Financial modeling / accounting"] }),
  ]);
  assert.equal(pool, 2); // placeholder job counts toward pool; senior + low-score do not
  assert.equal(insights.length, 1);
  assert.equal(insights[0].count, 1);
});

test("caps example companies at three unique names", () => {
  const { insights } = aggregateResumeGaps(
    ["A", "B", "C", "D", "A"].map((c) => job({ gaps: ["Marketing attribution tooling"], company: c })),
  );
  assert.deepEqual(insights[0].companies, ["A", "B", "C"]);
});
