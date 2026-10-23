import assert from "node:assert/strict";
import test from "node:test";
import { sponsorshipRisk as riskFor } from "../lib/eligibility.ts";

const OPT = { status: "opt", holdsClearance: false };
// Most cases below are written from an OPT candidate's point of view.
const sponsorshipRisk = (sponsorship, note, description) => riskFor(sponsorship, note, description, OPT);

// Notes below are quoted from real job postings.
test("citizenship or clearance requirement is a blocker", () => {
  const note = 'Stated in posting: "…Per the U.S. Government’s eligibility requirements, you must be a U.S Citizen to be considered for a security clearance."';
  assert.equal(sponsorshipRisk("not_offered", note)?.level, "blocker");
  assert.equal(sponsorshipRisk("unknown", "", "Candidates must obtain a Secret clearance.")?.level, "blocker");
});

test("no-sponsorship posting is a warning that says whether OPT is mentioned", () => {
  const plain = sponsorshipRisk("not_offered", 'Stated in posting: "This position is not eligible for visa sponsorship or visa transfer."');
  assert.equal(plain?.level, "warning");
  assert.match(plain.message, /does not mention OPT/);
  const opt = sponsorshipRisk("not_offered", "No sponsorship. Candidates on STEM OPT are welcome; we participate in E-Verify.");
  assert.equal(opt?.level, "warning");
  assert.match(opt.message, /mentions OPT or E-Verify/);
});

test("no risk when sponsorship is not ruled out", () => {
  assert.equal(sponsorshipRisk("likely", "Company has H-1B filing history."), null);
  assert.equal(sponsorshipRisk("unknown"), null);
  // "Optimize" must not read as OPT.
  assert.match(sponsorshipRisk("not_offered", "No sponsorship. You will optimize reporting.").message, /does not mention OPT/);
});

test("postings that name OPT only to exclude it are blockers", () => {
  for (const note of [
    "Unfortunately, we are not able to sponsor visas, including CPT/OPT or employ corp-to-corp.",
    "This employer will not sponsor applicants for the following work visas: F-1 student, H-1B worker, O-1 worker.",
    "Candidates must have permanent, unrestricted U.S. work authorization. (Please note, CPT and OPT are considered restricted forms of work authorization.)",
  ]) {
    assert.equal(sponsorshipRisk("not_offered", note)?.level, "blocker", note);
  }
});

test("an active or TS/SCI clearance requirement is a blocker", () => {
  assert.equal(sponsorshipRisk("unknown", "", "Requires: TS/SCI clearance with a polygraph.")?.level, "blocker");
  assert.equal(sponsorshipRisk("likely", "", "Candidates must hold an active security clearance.")?.level, "blocker");
  // Mentioning clearance work in general is not a requirement on the candidate.
  assert.equal(sponsorshipRisk("unknown", "", "You will support the clearance team's reporting."), null);
  // Many postings end with the federal rights poster.
  assert.equal(sponsorshipRisk("unknown", "", "Know Your Rights I Family & Medical Leave I Employee Polygraph Protection I Right to Work"), null);
});

test("each work-authorization status rules out different postings", () => {
  const citizen = { status: "citizen", holdsClearance: false };
  const greenCard = { status: "permanent_resident", holdsClearance: false };
  const needsVisa = { status: "needs_sponsorship", holdsClearance: false };
  const citizenOnly = "You must be a U.S. citizen to be considered.";
  const noSponsor = "This position is not eligible for visa sponsorship.";
  const permanent = "Candidates must have permanent, unrestricted U.S. work authorization.";

  assert.equal(riskFor("unknown", "", citizenOnly, citizen), null);
  assert.equal(riskFor("unknown", "", citizenOnly, greenCard)?.level, "blocker");
  assert.equal(riskFor("not_offered", noSponsor, "", greenCard), null);
  assert.equal(riskFor("not_offered", noSponsor, "", needsVisa)?.level, "blocker");
  assert.equal(riskFor("unknown", "", permanent, needsVisa)?.level, "blocker");
  assert.equal(riskFor("likely", "", "", needsVisa), null);
  // Clearance only blocks someone who does not hold one.
  assert.equal(riskFor("unknown", "", "Requires an active security clearance.", citizen)?.level, "blocker");
  assert.equal(riskFor("unknown", "", "Requires an active security clearance.", { status: "citizen", holdsClearance: true }), null);
  // Before onboarding nothing is flagged.
  assert.equal(riskFor("not_offered", citizenOnly, "", { status: "unset", holdsClearance: false }), null);
});

test("Canadian searches use Canadian rules", () => {
  const ca = (status) => ({ status, holdsClearance: false, country: "CA" });
  const prOrCitizen = "Applicants must be Canadian citizens or permanent residents.";
  const citizenOnly = "You must be a Canadian citizen to be considered for this position.";
  const preference = "Preference will be given to Canadian citizens and permanent residents.";
  const entitled = "Candidates must be legally entitled to work in Canada.";

  assert.equal(riskFor("unknown", "", prOrCitizen, ca("permanent_resident")), null);
  assert.equal(riskFor("unknown", "", citizenOnly, ca("permanent_resident"))?.level, "blocker");
  assert.equal(riskFor("unknown", "", citizenOnly, ca("citizen")), null);

  assert.equal(riskFor("unknown", "", prOrCitizen, ca("open_work_permit"))?.level, "blocker");
  assert.equal(riskFor("unknown", "", preference, ca("open_work_permit"))?.level, "warning");
  assert.equal(riskFor("unknown", "", entitled, ca("open_work_permit")), null);
  assert.equal(riskFor("not_offered", "", "No LMIA support is available.", ca("open_work_permit"))?.level, "warning");

  assert.equal(riskFor("not_offered", "", "No LMIA support is available.", ca("needs_sponsorship"))?.level, "blocker");
  assert.equal(riskFor("unknown", "", entitled, ca("needs_sponsorship"))?.level, "warning");
  assert.equal(riskFor("offered", "", `${entitled} LMIA support is available.`, ca("needs_sponsorship")), null);
  // A U.S.-citizenship line does not bind a Canadian permanent resident in a Canadian search.
  assert.equal(riskFor("unknown", "", "Must be a U.S. citizen.", ca("permanent_resident")), null);
  // Clearance applies everywhere.
  assert.equal(riskFor("unknown", "", "Requires an active Secret clearance.", ca("citizen"))?.level, "blocker");
});

test("a status from the other country normalizes to unset", async () => {
  const { normalizeProfile } = await import("../lib/profile.ts");
  assert.equal(normalizeProfile({ country: "CA", workAuthorization: { status: "opt" } }).workAuthorization.status, "unset");
  assert.equal(normalizeProfile({ workAuthorization: { status: "open_work_permit" } }).workAuthorization.status, "unset");
  const canadian = normalizeProfile({ country: "ca", workAuthorization: { status: "open_work_permit" } });
  assert.equal(canadian.country, "CA");
  assert.deepEqual(canadian.workAuthorization, { status: "open_work_permit", holdsClearance: false, country: "CA" });
  assert.equal(normalizeProfile({}).country, "US");
});
