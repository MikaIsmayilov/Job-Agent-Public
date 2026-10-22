/** Salary parsing + benchmarking over the jobs already in the DB.
 *
 * Posted salary strings arrive in many shapes ("USD 70000–90000 YEARLY",
 * "$60k - $75k", "$85,000"). parseAnnualSalary normalizes them to an annual
 * min/max; benchmarkSalaries aggregates per role family so the dashboard can
 * show what the scraped market actually pays and suggest an ask range.
 */

export type SalaryRange = { min: number; max: number };

const NUMBER_RE = /\$?\s*(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s*(k)?/gi;

export function parseAnnualSalary(text: string | undefined): SalaryRange | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/hour|hr\b|\/h\b|weekly|per week|monthly|per month/.test(lower)) return null; // non-annual, skip rather than guess

  const values: number[] = [];
  for (const match of lower.matchAll(NUMBER_RE)) {
    let value = Number(match[1].replace(/[,.](?=\d{3}\b)/g, ""));
    if (match[2]) value *= 1000;
    if (Number.isFinite(value)) values.push(value);
  }
  const annual = values.filter((v) => v >= 20_000 && v <= 500_000);
  if (!annual.length) return null;
  const min = Math.min(...annual);
  const max = Math.max(...annual);
  return { min, max };
}

export function midpoint(range: SalaryRange): number {
  return (range.min + range.max) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

export type FamilyBenchmark = {
  family: string;
  count: number;
  p25: number;
  median: number;
  p75: number;
};

export function benchmarkSalaries(
  jobs: Array<{ roleFamily?: string; salary?: string }>,
  minSamples = 5,
): FamilyBenchmark[] {
  const byFamily = new Map<string, number[]>();
  for (const job of jobs) {
    const range = parseAnnualSalary(job.salary);
    if (!range) continue;
    const family = job.roleFamily || "Other";
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family)!.push(midpoint(range));
  }
  const benchmarks: FamilyBenchmark[] = [];
  for (const [family, mids] of byFamily) {
    if (mids.length < minSamples) continue;
    const sorted = [...mids].sort((a, b) => a - b);
    benchmarks.push({
      family,
      count: sorted.length,
      p25: Math.round(quantile(sorted, 0.25)),
      median: Math.round(quantile(sorted, 0.5)),
      p75: Math.round(quantile(sorted, 0.75)),
    });
  }
  return benchmarks.sort((a, b) => b.count - a.count);
}

export function formatUsd(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}
