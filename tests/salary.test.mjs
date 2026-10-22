import assert from "node:assert/strict";
import test from "node:test";
import { benchmarkSalaries, formatUsd, midpoint, parseAnnualSalary } from "../lib/salary.ts";

test("parses the salary shapes our sources actually produce", () => {
  assert.deepEqual(parseAnnualSalary("USD 70000–90000 YEARLY"), { min: 70000, max: 90000 });
  assert.deepEqual(parseAnnualSalary("$60k - $75k"), { min: 60000, max: 75000 });
  assert.deepEqual(parseAnnualSalary("$85,000"), { min: 85000, max: 85000 });
  assert.deepEqual(parseAnnualSalary("USD 108000.0–135000.0 YEARLY"), { min: 108000, max: 135000 });
  assert.deepEqual(parseAnnualSalary("Salary range: $72,500 to $88,000 plus equity"), { min: 72500, max: 88000 });
});

test("refuses to guess on non-annual or unusable strings", () => {
  assert.equal(parseAnnualSalary("$25 per hour"), null);
  assert.equal(parseAnnualSalary("$4,000 monthly"), null);
  assert.equal(parseAnnualSalary("Not listed"), null);
  assert.equal(parseAnnualSalary(""), null);
  assert.equal(parseAnnualSalary(undefined), null);
  assert.equal(parseAnnualSalary("Competitive"), null);
  // implausible annual figures are dropped
  assert.equal(parseAnnualSalary("$500 signing bonus"), null);
});

test("benchmarks per family with a minimum sample size", () => {
  const jobs = [
    ...Array.from({ length: 6 }, (_, i) => ({ roleFamily: "Data analytics", salary: `$${70 + i * 2}k` })),
    { roleFamily: "Data analytics", salary: "Not listed" },
    { roleFamily: "Marketing analytics", salary: "$65k" }, // below minSamples -> excluded
  ];
  const benchmarks = benchmarkSalaries(jobs);
  assert.equal(benchmarks.length, 1);
  const bench = benchmarks[0];
  assert.equal(bench.family, "Data analytics");
  assert.equal(bench.count, 6);
  assert.ok(bench.p25 <= bench.median && bench.median <= bench.p75);
  assert.equal(bench.median, 75000);
});

test("midpoint and formatting", () => {
  assert.equal(midpoint({ min: 70000, max: 90000 }), 80000);
  assert.equal(formatUsd(82500), "$82,500");
});
