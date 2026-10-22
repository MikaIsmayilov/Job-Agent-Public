import assert from "node:assert/strict";
import test from "node:test";
import { applyUserEdits, buildJobRecord, preserveUserEdits, userEditedFields } from "../lib/job-provenance.ts";

const fit = { score: 82, matches: ["Python"], gaps: [] };

function importedJob(raw = "Decision Scientist - 214951 - Electronic Arts\nUse Python to inform game design decisions in Vancouver.") {
  return buildJobRecord({
    raw,
    source: "ea.com",
    sourceUrl: "https://ea.com/careers/214951",
    canonicalUrl: "https://ea.com/careers/214951",
    sourceKind: "webpage",
    fetchedAt: "2026-08-13T12:00:00.000Z",
    contentHash: "hash-1",
    fit,
  });
}

test("applyUserEdits overwrites fields and records direct user_edit evidence", () => {
  const job = importedJob();
  const edited = applyUserEdits(job, { title: "  Decision Scientist ", company: "Electronic Arts" }, "2026-08-13T20:00:00.000Z");

  assert.equal(edited.title, "Decision Scientist");
  assert.equal(edited.company, "Electronic Arts");
  assert.equal(edited.location, job.location);

  const titleEvidence = edited.evidence.find((item) => item.field === "title");
  assert.equal(titleEvidence?.origin, "user_edit");
  assert.equal(titleEvidence?.direct, true);
  assert.equal(titleEvidence?.confidence, "high");
  assert.match(titleEvidence?.evidence ?? "", /2026-08-13/);
  assert.equal(edited.evidence.filter((item) => item.field === "title").length, 1);

  // The input record must not be mutated.
  assert.notEqual(job.company, "Electronic Arts");
  assert.equal(job.evidence.find((item) => item.field === "company")?.origin, "page_text");
});

test("applyUserEdits ignores empty values and clips overlong ones", () => {
  const job = importedJob();
  const edited = applyUserEdits(job, { title: "   ", company: "x".repeat(300) }, "2026-08-13T20:00:00.000Z");
  assert.equal(edited.title, job.title);
  assert.equal(edited.company.length, 140);
});

test("userEditedFields reports only fields with user_edit evidence", () => {
  const job = importedJob();
  assert.deepEqual(userEditedFields(job), []);
  const edited = applyUserEdits(job, { company: "Electronic Arts", workMode: "Hybrid" }, "2026-08-13T20:00:00.000Z");
  assert.deepEqual(userEditedFields(edited), ["company", "workMode"]);
});

test("preserveUserEdits carries manual corrections through a dedup refresh", () => {
  const stored = applyUserEdits(importedJob(), { title: "Decision Scientist", company: "Electronic Arts" }, "2026-08-13T20:00:00.000Z");
  const rescraped = importedJob();

  const refreshed = preserveUserEdits(rescraped, stored);
  assert.equal(refreshed.title, "Decision Scientist");
  assert.equal(refreshed.company, "Electronic Arts");
  assert.equal(refreshed.evidence.find((item) => item.field === "company")?.origin, "user_edit");
  assert.equal(refreshed.evidence.filter((item) => item.field === "company").length, 1);
  // Unedited fields keep the freshly scraped values and evidence.
  assert.equal(refreshed.location, rescraped.location);
  assert.equal(refreshed.evidence.find((item) => item.field === "location")?.origin, "page_text");
});

test("preserveUserEdits leaves records without manual edits untouched", () => {
  const stored = importedJob();
  const rescraped = importedJob();
  assert.equal(preserveUserEdits(rescraped, stored), rescraped);
});
