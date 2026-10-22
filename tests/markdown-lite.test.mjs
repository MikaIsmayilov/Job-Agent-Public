import assert from "node:assert/strict";
import test from "node:test";
import { inlineSegments, parseDescription, summarySegments, unescapeMarkdown } from "../lib/markdown-lite.ts";

test("backslash escapes from ATS exports are removed", () => {
  assert.equal(unescapeMarkdown("Alvarez \\& Marsal (A\\&M) \\- results\\-oriented \\| team"), "Alvarez & Marsal (A&M) - results-oriented | team");
});

test("bold runs split on ** pairs; an unpaired ** stays literal", () => {
  assert.deepEqual(inlineSegments("Join **Massanutten** today"), [
    { text: "Join ", bold: false }, { text: "Massanutten", bold: true }, { text: " today", bold: false },
  ]);
  assert.deepEqual(inlineSegments("Truncated **two di"), [{ text: "Truncated **two di", bold: false }]);
});

test("real description structure: headings, paragraphs, bullets", () => {
  const raw = "**Description**\n**About Alvarez \\& Marsal**\n Alvarez \\& Marsal is a global firm.\n   \n\n* Build **dashboards** in Power BI\n- Write SQL\n1. Present results\n**Requirements:**";
  assert.deepEqual(parseDescription(raw).map((b) => [b.kind, b.segments.map((s) => (s.bold ? `**${s.text}**` : s.text)).join("")]), [
    ["heading", "Description"],
    ["heading", "About Alvarez & Marsal"],
    ["paragraph", "Alvarez & Marsal is a global firm."],
    ["bullet", "Build **dashboards** in Power BI"],
    ["bullet", "Write SQL"],
    ["bullet", "Present results"],
    ["heading", "Requirements"],
  ]);
});

test("summary keeps bold and collapses whitespace", () => {
  assert.deepEqual(summarySegments("**Role**   Analyst \\- Boston"), [{ text: "Role", bold: true }, { text: " Analyst - Boston", bold: false }]);
});
