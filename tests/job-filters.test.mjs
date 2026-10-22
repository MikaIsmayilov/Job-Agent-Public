import assert from "node:assert/strict";
import test from "node:test";
import { activeFilterCount, DEFAULT_FILTERS, fromSearch, matchesFilters, toSearch } from "../lib/job-filters.ts";

const job = {
  title: "Data Analyst", company: "Ledgerly", location: "Boston, MA", workMode: "Hybrid", status: "new", roleFamily: "Data analytics",
  jobType: "fulltime", experienceLevel: "entry", sourceKind: "official_ats", sponsorship: "likely", tags: ["startup"],
  salary: "$70,000", score: 88, skills: ["SQL"], firstSeenAt: "2026-10-14T08:00:00Z",
};

test("default filters match everything; each filter narrows", () => {
  assert.equal(matchesFilters(job, DEFAULT_FILTERS, ""), true);
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, query: "sql" }, ""), true);
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, query: "tableau" }, ""), false);
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, sponsorship: "friendly" }, ""), true);
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, location: "remote" }, ""), false);
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, minScore: 90 }, ""), false);
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, newOnly: true }, "2026-10-13T12:00:00Z"), true);
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, newOnly: true }, "2026-10-14T12:00:00Z"), false);
});

test("active count ignores the search box", () => {
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, query: "x" }), 0);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, status: "applied", salaryOnly: true, minScore: 60 }), 3);
});

test("URL state round-trips and a plain visit stays clean", () => {
  const plain = { view: "inbox", scope: "worth", sort: "fresh", job: "", layout: "table", filters: DEFAULT_FILTERS };
  assert.equal(toSearch(plain), "");
  const state = { view: "applications", scope: "all", sort: "score", job: "abc-123", layout: "list", filters: { ...DEFAULT_FILTERS, query: "data & ml", status: "applied", newOnly: true, minScore: 70 } };
  const search = toSearch(state);
  assert.deepEqual(fromSearch(search), state);
  // Each view's own default sort is implied, not written.
  assert.equal(toSearch({ ...plain, view: "applications", sort: "appliedNewest" }), "?view=applications");
});

test("hostile or junk URL values fall back to defaults", () => {
  const state = fromSearch("?view=admin&sort=drop&min=9999&scope=x&layout=grid");
  assert.equal(state.view, "inbox");
  assert.equal(state.sort, "fresh");
  assert.equal(state.filters.minScore, 95);
  assert.equal(state.scope, "worth");
  assert.equal(state.layout, "table");
});

test("profile location options: no places means anywhere, unknown place index matches nothing", () => {
  // data/profile.json ships with no places until /onboard.
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, location: "target" }, ""), true);
  assert.equal(matchesFilters(job, { ...DEFAULT_FILTERS, location: "place:7" }, ""), false);
});
