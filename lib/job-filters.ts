// Dashboard filter state as one plain object, so it can be matched, counted,
// cleared, and round-tripped through the URL (refresh and Back keep your place).

import { isTargetLocation } from "./worth-applying.ts";
import { PROFILE, placeMatches } from "./profile.ts";

export type Filters = {
  query: string;
  status: string;
  family: string;
  workMode: string;
  location: string;
  jobType: string;
  experience: string;
  source: string;
  sponsorship: string;
  companyTag: string;
  salaryOnly: boolean;
  minScore: number;
  newOnly: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  query: "", status: "all", family: "all", workMode: "all", location: "all", jobType: "all", experience: "all",
  source: "all", sponsorship: "all", companyTag: "all", salaryOnly: false, minScore: 0, newOnly: false,
};

export type FilterableJob = {
  title: string;
  company: string;
  location: string;
  workMode: string;
  status: string;
  roleFamily: string;
  jobType?: string;
  experienceLevel?: string;
  sourceKind: string;
  sponsorship: string;
  tags: string[];
  salary: string;
  score: number;
  skills: string[];
  firstSeenAt?: string;
};

export function matchesFilters(job: FilterableJob, f: Filters, dayAgo: string): boolean {
  const loc = (job.location ?? "").toLowerCase();
  const isRemote = job.workMode === "Remote" || loc.includes("remote");
  const needle = f.query.trim().toLowerCase();
  return (
    (f.status === "all" || job.status === f.status) &&
    (f.family === "all" || (job.roleFamily || "Adjacent role") === f.family) &&
    (f.workMode === "all" || job.workMode === f.workMode) &&
    (f.location === "all" ||
      (f.location === "target" && isTargetLocation(job.location, job.workMode)) ||
      (f.location.startsWith("place:") && PROFILE.places[Number(f.location.slice(6))] !== undefined && placeMatches(job.location, PROFILE.places[Number(f.location.slice(6))])) ||
      (f.location === "remote" && isRemote)) &&
    (f.jobType === "all" || (job.jobType ?? "unset") === f.jobType) &&
    (f.experience === "all" || (job.experienceLevel ?? "unknown") === f.experience) &&
    (f.source === "all" || job.sourceKind === f.source) &&
    (f.sponsorship === "all" ||
      (f.sponsorship === "friendly" ? job.sponsorship === "offered" || job.sponsorship === "likely" : job.sponsorship === f.sponsorship)) &&
    (f.companyTag === "all" || job.tags.includes(f.companyTag)) &&
    (!f.salaryOnly || (job.salary !== "Not listed" && job.salary !== "")) &&
    job.score >= f.minScore &&
    (!f.newOnly || Boolean(dayAgo && job.firstSeenAt && job.firstSeenAt > dayAgo)) &&
    (!needle || `${job.title} ${job.company} ${job.location} ${job.skills.join(" ")}`.toLowerCase().includes(needle))
  );
}

/** Filters that differ from the default, not counting the search box. */
export function activeFilterCount(f: Filters): number {
  return (Object.keys(DEFAULT_FILTERS) as Array<keyof Filters>).filter((key) => key !== "query" && f[key] !== DEFAULT_FILTERS[key]).length;
}

export type View = "inbox" | "applications" | "documents";
export type Scope = "worth" | "all";
export type SortKey = "fresh" | "score" | "newest" | "appliedNewest" | "appliedOldest";
export type AppsLayout = "table" | "list";

export type UrlState = { view: View; scope: Scope; sort: SortKey; job: string; layout: AppsLayout; filters: Filters };

export const defaultSort = (view: View): SortKey => (view === "applications" ? "appliedNewest" : "fresh");

// Short URL keys; only non-default values are written, so a plain visit stays "/".
const KEYS: Record<keyof Filters, string> = {
  query: "q", status: "status", family: "family", workMode: "mode", location: "loc", jobType: "type", experience: "exp",
  source: "src", sponsorship: "spons", companyTag: "co", salaryOnly: "salary", minScore: "min", newOnly: "new",
};
const VIEWS: View[] = ["inbox", "applications", "documents"];
const SORTS: SortKey[] = ["fresh", "score", "newest", "appliedNewest", "appliedOldest"];

export function toSearch(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.view !== "inbox") params.set("view", state.view);
  if (state.scope !== "worth") params.set("scope", state.scope);
  if (state.sort !== defaultSort(state.view)) params.set("sort", state.sort);
  if (state.layout !== "table") params.set("layout", state.layout);
  for (const key of Object.keys(KEYS) as Array<keyof Filters>) {
    const value = state.filters[key];
    if (value === DEFAULT_FILTERS[key]) continue;
    params.set(KEYS[key], typeof value === "boolean" ? "1" : String(value));
  }
  if (state.job) params.set("job", state.job);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function fromSearch(search: string): UrlState {
  const params = new URLSearchParams(search);
  const view = VIEWS.includes(params.get("view") as View) ? (params.get("view") as View) : "inbox";
  const sort = SORTS.includes(params.get("sort") as SortKey) ? (params.get("sort") as SortKey) : defaultSort(view);
  const filters: Filters = { ...DEFAULT_FILTERS };
  for (const key of Object.keys(KEYS) as Array<keyof Filters>) {
    const raw = params.get(KEYS[key]);
    if (raw === null) continue;
    const fallback = DEFAULT_FILTERS[key];
    if (typeof fallback === "boolean") (filters[key] as boolean) = raw === "1";
    else if (typeof fallback === "number") (filters[key] as number) = Math.max(0, Math.min(95, Number(raw) || 0));
    else (filters[key] as string) = raw.slice(0, 200);
  }
  return {
    view,
    scope: params.get("scope") === "all" ? "all" : "worth",
    sort,
    job: (params.get("job") ?? "").slice(0, 100),
    layout: params.get("layout") === "list" ? "list" : "table",
    filters,
  };
}
