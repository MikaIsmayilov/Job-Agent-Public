import assert from "node:assert/strict";
import test from "node:test";
import { evaluateResumeFit, seniorityAdjustedScore } from "../lib/matching.ts";
import {
  buildIngestRecord,
  MAX_BATCH_SIZE,
  SITE_TO_KIND,
  synthesizeStructured,
  validateIngestPayload,
} from "../lib/ingest.ts";

const validJob = {
  title: "Data Analyst",
  company: "Acme Analytics",
  location: "Boston, MA",
  description:
    "Entry-level data analyst role. Use SQL and BigQuery to build dashboards in Power BI and Tableau, apply Python for forecasting, and surface customer insights for marketing analytics stakeholders across the business.",
  url: "https://boards.greenhouse.io/acme/jobs/123",
  date_posted: "2026-08-05",
  work_mode: "Hybrid",
  job_type: "fulltime",
  experience_level: "entry",
};

test("maps every official ATS site to official_ats and aggregators to aggregator", () => {
  for (const site of ["greenhouse", "lever", "ashby", "smartrecruiters", "workday", "workable", "recruitee", "phenom", "icims", "successfactors", "eightfold", "company_site", "amazon"]) {
    assert.equal(SITE_TO_KIND[site].sourceKind, "official_ats", `${site} should be official_ats`);
  }
  for (const site of ["linkedin", "indeed", "glassdoor", "google", "zip_recruiter", "themuse", "remotive", "workingnomads"]) {
    assert.equal(SITE_TO_KIND[site].sourceKind, "aggregator", `${site} should be aggregator`);
  }
});

test("legitimacy red flags are detected and clean postings stay clean", async () => {
  const at = "2026-08-09T12:00:00.000Z";
  const flagged = await buildIngestRecord(
    "indeed",
    {
      ...validJob,
      url: "https://www.indeed.com/viewjob?jk=flag",
      description:
        "Join our sales team! This is a commission-only position with unlimited earning potential. Be your own boss and make money fast with our proven network marketing system. Analyst work with data and dashboards included.",
    },
    at,
  );
  assert.ok(flagged.redFlags.includes("Commission-only pay"));
  assert.ok(flagged.redFlags.includes("MLM-style language"));

  const clean = await buildIngestRecord("greenhouse", validJob, at);
  assert.deepEqual(clean.redFlags, []);
});

test("accepts a valid payload and normalizes jobs", () => {
  const { payload, issues } = validateIngestPayload({ source_site: "greenhouse", jobs: [validJob] });
  assert.equal(issues.length, 0);
  assert.equal(payload.jobs.length, 1);
  assert.equal(payload.jobs[0].job_type, "fulltime");
  assert.equal(payload.jobs[0].experience_level, "entry");
});

test("rejects bad payloads and reports per-job issues", () => {
  assert.ok(validateIngestPayload(null).issues.length);
  assert.ok(validateIngestPayload({ source_site: "myspace", jobs: [validJob] }).issues[0].reason.includes("source_site"));
  assert.ok(validateIngestPayload({ source_site: "indeed", jobs: [] }).issues.length);
  assert.ok(
    validateIngestPayload({ source_site: "indeed", jobs: Array(MAX_BATCH_SIZE + 1).fill(validJob) }).issues[0].reason.includes("exceeds"),
  );

  const mixed = validateIngestPayload({
    source_site: "indeed",
    jobs: [validJob, { ...validJob, description: "too short" }, { ...validJob, url: "http://127.0.0.1/x" }],
  });
  assert.equal(mixed.payload.jobs.length, 1);
  assert.equal(mixed.issues.length, 2);
  assert.equal(mixed.issues[0].index, 1);
  assert.equal(mixed.issues[1].index, 2);
});

test("synthesizes a JSON-LD-shaped JobPosting from flat fields", () => {
  const structured = synthesizeStructured({ ...validJob, work_mode: "Remote" });
  assert.equal(structured["@type"], "JobPosting");
  assert.equal(structured.title, "Data Analyst");
  assert.equal(structured.hiringOrganization.name, "Acme Analytics");
  assert.equal(structured.jobLocation.address.addressLocality, "Boston");
  assert.equal(structured.jobLocation.address.addressRegion, "MA");
  assert.equal(structured.jobLocationType, "TELECOMMUTE");
  assert.equal(structured.datePosted, "2026-08-05");
});

test("ATS-sourced jobs come out verified with ats_api evidence", async () => {
  const record = await buildIngestRecord("greenhouse", validJob, "2026-08-09T12:00:00.000Z");
  assert.equal(record.verificationStatus, "verified");
  assert.equal(record.sourceKind, "official_ats");
  assert.equal(record.sourceSite, "greenhouse");
  assert.equal(record.company, "Acme Analytics");
  assert.equal(record.jobType, "fulltime");
  assert.equal(record.experienceLevel, "entry");
  assert.ok(record.roleFamily.length > 0, "roleFamily must be persisted");
  const titleEvidence = record.evidence.find((item) => item.field === "title");
  assert.equal(titleEvidence.origin, "ats_api");
  assert.equal(titleEvidence.direct, true);
});

test("aggregator-sourced jobs keep real identity but stay unverified", async () => {
  const record = await buildIngestRecord("linkedin", { ...validJob, url: "https://www.linkedin.com/jobs/view/456" }, "2026-08-09T12:00:00.000Z");
  assert.equal(record.verificationStatus, "unverified");
  assert.equal(record.sourceKind, "aggregator");
  assert.equal(record.company, "Acme Analytics");
  assert.equal(record.title, "Data Analyst");
});

test("seniority adjusts the fit score: entry above unknown above mid", async () => {
  const at = "2026-08-09T12:00:00.000Z";
  // Mild description so the base score sits below the 95 cap and the
  // adjustment is observable.
  const mildJob = {
    ...validJob,
    description:
      "We are looking for an operations analyst to support reporting workflows, coordinate with stakeholders across departments, and maintain recurring documentation for the leadership team every quarter.",
  };
  const entry = await buildIngestRecord("greenhouse", { ...mildJob, experience_level: "entry" }, at);
  const unknown = await buildIngestRecord("greenhouse", { ...mildJob, experience_level: "unknown" }, at);
  const mid = await buildIngestRecord("greenhouse", { ...mildJob, experience_level: "mid" }, at);
  // Ingest must apply the same adjustment as rescoring, whatever resume is onboarded.
  const base = evaluateResumeFit(mildJob.title, mildJob.description).score;
  assert.equal(entry.score, seniorityAdjustedScore(base, "entry"));
  assert.equal(unknown.score, seniorityAdjustedScore(base, "unknown"));
  assert.equal(mid.score, seniorityAdjustedScore(base, "mid"));
  // ...and at an entry-level target the order is entry >= unknown >= mid.
  assert.ok(seniorityAdjustedScore(60, "entry", "entry") > seniorityAdjustedScore(60, "unknown", "entry"));
  assert.ok(seniorityAdjustedScore(60, "unknown", "entry") > seniorityAdjustedScore(60, "mid", "entry"));
});

test("job type and work mode are inferred from description text when the source omits them", async () => {
  const at = "2026-08-09T12:00:00.000Z";
  const job = {
    ...validJob,
    job_type: undefined,
    work_mode: undefined,
    description:
      "This is a full-time position based on-site in our Boston office. You will build dashboards in Tableau and write SQL queries to support customer insight reporting for stakeholders.",
  };
  const record = await buildIngestRecord("greenhouse", job, at);
  assert.equal(record.jobType, "fulltime");
  assert.equal(record.workMode, "Onsite");

  const intern = await buildIngestRecord(
    "greenhouse",
    { ...job, title: "Data Analytics Intern", description: job.description.replace("full-time position", "internship") },
    at,
  );
  assert.equal(intern.jobType, "internship");
});

test("sponsorship stance is extracted from posting text, negatives first", async () => {
  const at = "2026-08-09T12:00:00.000Z";
  const base = { ...validJob };

  const no1 = await buildIngestRecord("greenhouse", { ...base, description: `${base.description} We are unable to sponsor work visas for this position.` }, at);
  assert.equal(no1.sponsorship, "not_offered");
  assert.ok(no1.evidence.some((item) => item.field === "sponsorship" && item.direct));

  const no2 = await buildIngestRecord("greenhouse", { ...base, description: `${base.description} Applicants must be authorized to work in the United States without the need for visa sponsorship now or in the future.` }, at);
  assert.equal(no2.sponsorship, "not_offered");

  // negative phrasing that contains a positive-looking substring must stay negative
  const no3 = await buildIngestRecord("greenhouse", { ...base, description: `${base.description} We do not offer H-1B sponsorship for this role.` }, at);
  assert.equal(no3.sponsorship, "not_offered");

  const yes = await buildIngestRecord("greenhouse", { ...base, description: `${base.description} Visa sponsorship is available for exceptional candidates.` }, at);
  assert.equal(yes.sponsorship, "offered");

  const silent = await buildIngestRecord("greenhouse", base, at);
  assert.equal(silent.sponsorship, "unknown");
});

test("company-level sponsorship hint applies only when the posting is silent", async () => {
  const at = "2026-08-09T12:00:00.000Z";
  const hinted = await buildIngestRecord(
    "greenhouse",
    { ...validJob, sponsorship_hint: "likely", sponsorship_note: "~120 H-1B filings on record", company_tags: ["startup"] },
    at,
  );
  assert.equal(hinted.sponsorship, "likely");
  assert.equal(hinted.sponsorshipNote, "~120 H-1B filings on record");
  assert.deepEqual(hinted.tags, ["startup"]);

  const overridden = await buildIngestRecord(
    "greenhouse",
    { ...validJob, description: `${validJob.description} We cannot sponsor visas.`, sponsorship_hint: "likely" },
    at,
  );
  assert.equal(overridden.sponsorship, "not_offered", "explicit posting text beats the company hint");
});

test("expired ATS postings are marked expired, not verified", async () => {
  const record = await buildIngestRecord(
    "lever",
    { ...validJob, url: "https://jobs.lever.co/acme/1", valid_through: "2026-01-01" },
    "2026-08-09T12:00:00.000Z",
  );
  assert.equal(record.verificationStatus, "expired");
});
