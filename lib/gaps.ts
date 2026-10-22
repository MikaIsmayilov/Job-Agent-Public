// Aggregate resume-gap demand across scraped postings: which missing skills
// appear most often in the jobs you would actually apply to. This turns the
// per-job gap chips into a single actionable signal ("add dbt evidence to
// unlock N jobs") instead of 900 individual observations.

const PLACEHOLDER_GAP = "Review role-specific requirements";

export type GapJobLike = {
  gaps: string[];
  score: number;
  experienceLevel?: string;
  company: string;
  roleFamily?: string;
};

export type GapInsight = {
  label: string;
  count: number;
  /** Share of the relevant-job pool mentioning this gap, 0-100 (rounded). */
  share: number;
  /** Up to three example companies, most recent first as provided. */
  companies: string[];
  /** Role families where this gap appears most. */
  families: string[];
};

/**
 * Tally gap labels across the postings worth applying to (entry/unknown level,
 * non-trivial fit). Returns insights sorted by demand, placeholder excluded.
 */
export function aggregateResumeGaps(jobs: GapJobLike[], minScore = 50): { pool: number; insights: GapInsight[] } {
  const relevant = jobs.filter(
    (job) => (job.experienceLevel === "entry" || job.experienceLevel === "unknown" || job.experienceLevel === undefined) && job.score >= minScore,
  );
  const tally = new Map<string, { count: number; companies: string[]; families: Map<string, number> }>();
  for (const job of relevant) {
    for (const gap of job.gaps) {
      if (!gap || gap === PLACEHOLDER_GAP) continue;
      const entry = tally.get(gap) ?? { count: 0, companies: [] as string[], families: new Map<string, number>() };
      entry.count += 1;
      if (entry.companies.length < 3 && !entry.companies.includes(job.company)) entry.companies.push(job.company);
      const family = job.roleFamily || "Other";
      entry.families.set(family, (entry.families.get(family) ?? 0) + 1);
      tally.set(gap, entry);
    }
  }
  const insights = [...tally.entries()]
    .map(([label, entry]) => ({
      label,
      count: entry.count,
      share: relevant.length ? Math.round((entry.count / relevant.length) * 100) : 0,
      companies: entry.companies,
      families: [...entry.families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([family]) => family),
    }))
    .sort((a, b) => b.count - a.count);
  return { pool: relevant.length, insights };
}
