import assert from "node:assert/strict";
import test from "node:test";
import { classifyHeading, requirementItems, splitSections } from "../lib/jd-sections.ts";

test("common headings from stored postings classify correctly", () => {
  for (const [heading, kind] of [
    ["Qualifications", "required"], ["Basic Qualifications", "required"], ["What You’ll Bring", "required"], ["Who You Are", "required"],
    ["Preferred Qualifications", "preferred"], ["Nice to have", "preferred"], ["Bonus points", "preferred"],
    ["Responsibilities", "duties"], ["What you'll do", "duties"], ["How You Will Contribute", "duties"],
    ["Benefits", "boilerplate"], ["About Us", "boilerplate"], ["EEO Statement", "boilerplate"], ["Clearance Required", "boilerplate"], ["Pay Range", "boilerplate"],
  ]) assert.equal(classifyHeading(heading), kind, heading);
  assert.equal(classifyHeading("Strong SQL skills and a sense of humor that carries the team through long quarters"), null);
});

test("splits bold, colon, hash, and plain headings; bullets are never headings", () => {
  const raw = "Intro line\n**Responsibilities**\n* Build dashboards\n### Qualifications\n- SQL\n* Ability to travel as required\nPreferred: Tableau\nBenefits\nHealth\n**The Team**\nWe are small";
  assert.deepEqual(splitSections(raw).map((s) => [s.kind, s.lines]), [
    ["unknown", ["Intro line"]],
    ["duties", ["Build dashboards"]],
    ["required", ["SQL", "Ability to travel as required"]],
    ["preferred", ["Tableau"]],
    ["boilerplate", ["Health"]],
    ["unknown", ["We are small"]],
  ]);
  assert.deepEqual(requirementItems(splitSections(raw)), ["Ability to travel as required"]);
});
