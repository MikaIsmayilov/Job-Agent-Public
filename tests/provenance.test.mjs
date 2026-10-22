import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJobRecord,
  findJobPostingJsonLd,
  safePublicUrl,
  sourceMetadata,
} from "../lib/job-provenance.ts";

const fit = { score: 86, matches: ["Python", "SQL & BigQuery"], gaps: [] };

test("verifies a non-expired posting only when structured identity evidence exists", () => {
  const job = buildJobRecord({
    raw: "Product Data Analyst. Use Python and SQL to guide product decisions.",
    source: "Greenhouse",
    sourceUrl: "https://boards.greenhouse.io/acme/jobs/123",
    canonicalUrl: "https://boards.greenhouse.io/acme/jobs/123",
    sourceHttpStatus: 200,
    sourceKind: "official_ats",
    fetchedAt: "2026-08-09T12:00:00.000Z",
    contentHash: "abc123",
    fit,
    structured: {
      "@type": "JobPosting",
      title: "Product Data Analyst",
      hiringOrganization: { name: "Acme" },
      jobLocation: { address: { addressLocality: "Boston", addressRegion: "MA", addressCountry: "US" } },
      datePosted: "2026-08-01",
      validThrough: "2026-09-01",
      baseSalary: { currency: "USD", value: { minValue: 85000, maxValue: 110000, unitText: "YEAR" } },
      description: "Use Python and SQL to guide product decisions and create trusted analytical products.",
    },
  });

  assert.equal(job.verificationStatus, "verified");
  assert.equal(job.company, "Acme");
  assert.equal(job.salary, "USD 85000–110000 YEAR");
  assert.equal(job.evidence.find((item) => item.field === "title")?.direct, true);
  assert.equal(job.verifiedAt, job.fetchedAt);
});

test("keeps pasted and heuristic fields unverified and labels them inferred", () => {
  const job = buildJobRecord({
    raw: "Marketing Analytics Analyst\nCompany: Example Commerce\nLocation: New York, NY\nBuild dashboards. Compensation $90k-$105k for this hybrid position while analyzing campaign and customer performance.",
    source: "Pasted description",
    sourceKind: "pasted_text",
    fetchedAt: "2026-08-09T12:00:00.000Z",
    contentHash: "def456",
    fit,
  });

  assert.equal(job.verificationStatus, "unverified");
  assert.equal(job.title, "Marketing Analytics Analyst");
  assert.equal(job.evidence.find((item) => item.field === "title")?.direct, false);
  assert.equal(job.verifiedAt, undefined);
});

test("marks a structured posting expired when validThrough has passed", () => {
  const job = buildJobRecord({
    raw: "Data Analyst role with enough supporting description content to pass through the importer safely.",
    source: "Ashby",
    sourceKind: "official_ats",
    fetchedAt: "2026-08-09T12:00:00.000Z",
    contentHash: "expired",
    fit,
    structured: {
      "@type": "JobPosting",
      title: "Data Analyst",
      hiringOrganization: { name: "Example" },
      validThrough: "2026-08-01",
    },
  });
  assert.equal(job.verificationStatus, "expired");
});

test("does not automatically verify structured data on an unknown webpage", () => {
  const job = buildJobRecord({
    raw: "Data Analyst role with structured identity on an unrecognized source website.",
    source: "example.com",
    sourceKind: "webpage",
    fetchedAt: "2026-08-09T12:00:00.000Z",
    contentHash: "unknown-source",
    fit,
    structured: { "@type": "JobPosting", title: "Data Analyst", hiringOrganization: { name: "Example" } },
  });
  assert.equal(job.verificationStatus, "unverified");
});

test("recognizes JSON-LD graph postings and array types", () => {
  const structured = findJobPostingJsonLd(`<script type="application/ld+json">{"@graph":[{"@type":["Thing","JobPosting"],"title":"AI Product Manager"}]}</script>`);
  assert.equal(structured?.title, "AI Product Manager");
});

test("classifies sources and rejects unsafe URL targets", () => {
  assert.equal(sourceMetadata("jobs.lever.co").sourceKind, "official_ats");
  assert.equal(sourceMetadata("www.linkedin.com").sourceKind, "aggregator");
  assert.equal(sourceMetadata("greenhouse.io.evil.example").sourceKind, "webpage");
  assert.equal(safePublicUrl("http://127.0.0.1/private"), null);
  assert.equal(safePublicUrl("https://user:pass@example.com/job"), null);
  assert.equal(safePublicUrl("https://example.com:8443/job"), null);
  assert.equal(safePublicUrl("https://example.com/job")?.hostname, "example.com");
});

test("negative sponsorship catches every qualifier variant (2026-08-13 Fairway regression)", () => {
  const cases = [
    "Note: Fairway will not provide immigration sponsorship for this position.",
    "We will not be able to provide work sponsorship now or in the future.",
    "The company cannot provide H-1B sponsorship for this role.",
    "We do not offer immigration sponsorship.",
    "No work sponsorship is available.",
    // 2026-09-02 NorthStar regression: "is not able to provide visa sponsorship"
    // matched the POSITIVE "provide visa sponsorship" pattern and was stored as
    // an offer, the one direction that actively misleads a visa candidate.
    "Please note that NorthStar Group is not able to provide visa sponsorship for this position.",
    "The firm is not able to sponsor applicants for employment visas.",
    "We are not in a position to provide employment sponsorship.",
    "This employer does not provide employment sponsorship.",
    "No employment sponsorship is available for this opening.",
  ];
  for (const raw of cases) {
    const job = buildJobRecord({
      raw: `Analyst role at a large firm. ${raw} Apply on our careers site today for this analytical position.`,
      source: "Workday",
      sourceKind: "official_ats",
      fetchedAt: "2026-08-13T12:00:00.000Z",
      contentHash: `neg-${raw.length}`,
      fit,
    });
    assert.equal(job.sponsorship, "not_offered", `should be not_offered for: ${raw}`);
  }
});

test("Workday Remote Type field overrides the generic TELECOMMUTE flag (2026-08-13 BVH regression)", () => {
  const base = {
    source: "Workday",
    sourceKind: "official_ats",
    fetchedAt: "2026-08-13T12:00:00.000Z",
    fit,
    structured: {
      "@type": "JobPosting",
      title: "BFT Temporary Business Systems Analyst I",
      hiringOrganization: { name: "Bayview Health" },
      jobLocationType: "TELECOMMUTE",
    },
  };
  const onsite = buildJobRecord({
    ...base,
    contentHash: "remote-type-onsite",
    raw: "Business Systems Analyst position. Remote Type Onsite Work Location 399 Revolution Drive Employee Type Temporary. Analytical duties in Somerville MA office.",
  });
  assert.equal(onsite.workMode, "Onsite");
  const hybrid = buildJobRecord({
    ...base,
    contentHash: "remote-type-hybrid",
    raw: "Business Systems Analyst position. Remote Type Hybrid Work Location 399 Revolution Drive Employee Type Regular. Analytical duties, partial office attendance.",
  });
  assert.equal(hybrid.workMode, "Hybrid");
  const stillRemote = buildJobRecord({
    ...base,
    contentHash: "telecommute-no-remote-type",
    raw: "Business Systems Analyst position with fully distributed team. Analytical duties supporting enterprise systems and stakeholders.",
  });
  assert.equal(stillRemote.workMode, "Remote");
});

test("an aggregator's related-searches footer does not make a job an internship (2026-09-02 NorthStar regression)", () => {
  const footer = "People also viewed. Data Analyst jobs. Product Management Intern jobs. Sales Operations Intern jobs.";
  const fullTime = buildJobRecord({
    raw: `Data & Product Analyst (Insights). Analyze benchmark datasets and support client demos. ${footer}`,
    source: "linkedin.com",
    sourceKind: "aggregator",
    fetchedAt: "2026-09-02T12:00:00.000Z",
    contentHash: "jobtype-footer",
    fit,
  });
  assert.notEqual(fullTime.jobType, "internship");

  const realIntern = buildJobRecord({
    raw: `Data Science Intern, Summer 2027. A paid internship for current students. ${footer}`,
    source: "linkedin.com",
    sourceKind: "aggregator",
    fetchedAt: "2026-09-02T12:00:00.000Z",
    contentHash: "jobtype-intern",
    fit,
  });
  assert.equal(realIntern.jobType, "internship");
});
