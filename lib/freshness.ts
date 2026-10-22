// Posting freshness: entry-level roles fill within a week or two of posting.
// Applying to postings already weeks old wastes effort, so freshness ranks
// ALONGSIDE the fit score; it never changes the score.

export const FRESH_DAYS = 7;
export const STALE_DAYS = 30;

export type FreshnessBand = "fresh" | "recent" | "stale" | "undated";

const DAY_MS = 86_400_000;

/** Whole days between the posting date and `nowMs`, or null when undated/unparseable. */
export function postingAgeDays(datePosted: string | undefined, nowMs: number): number | null {
  if (!datePosted) return null;
  const posted = Date.parse(datePosted);
  if (Number.isNaN(posted)) return null;
  return Math.max(0, Math.floor((nowMs - posted) / DAY_MS));
}

export function freshnessBand(datePosted: string | undefined, nowMs: number): FreshnessBand {
  const age = postingAgeDays(datePosted, nowMs);
  if (age === null) return "undated";
  if (age <= FRESH_DAYS) return "fresh";
  if (age <= STALE_DAYS) return "recent";
  return "stale";
}

// Undated postings rank with "recent": no evidence they are stale, none that they are new.
const BAND_RANK: Record<FreshnessBand, number> = { fresh: 0, recent: 1, undated: 1, stale: 2 };

/** Sort comparator: fresher band first, then higher fit score. */
export function byFreshnessThenScore<T extends { datePosted?: string; score: number }>(nowMs: number) {
  return (a: T, b: T) =>
    BAND_RANK[freshnessBand(a.datePosted, nowMs)] - BAND_RANK[freshnessBand(b.datePosted, nowMs)] || b.score - a.score;
}
