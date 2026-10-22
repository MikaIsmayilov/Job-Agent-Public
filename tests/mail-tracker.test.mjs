import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, companyNames, evaluateMessages, matchJobs } from "../lib/mail-tracker.ts";

// Same cases as scraper/tests/test_mail_parity.py: the cloud cron and the
// local Python check must decide identically.
const CASES = JSON.parse(readFileSync(new URL("./fixtures/mail-cases.json", import.meta.url), "utf8"));

test("classify matches the Python tracker", () => {
  for (const c of CASES.classify) assert.equal(classify(c.subject, c.body), c.expect, c.subject);
});

test("companyNames matches the Python tracker", () => {
  for (const c of CASES.companyNames) assert.deepEqual(companyNames(c.company), c.expect, c.company);
});

test("matchJobs matches the Python tracker", () => {
  for (const group of CASES.match) {
    for (const c of group.cases) {
      assert.deepEqual(matchJobs(group.jobs, c.sender, c.subject, c.body).map((j) => j.id), c.expect, `${c.sender} / ${c.subject}`);
    }
  }
});

for (const c of CASES.evaluate) {
  test(`evaluateMessages: ${c.name}`, async () => {
    const { updates, notes, reviews } = await evaluateMessages(c.messages, c.tracked);
    assert.deepEqual(Object.fromEntries([...updates].map(([id, u]) => [id, u.status])), c.expect.updates);
    assert.equal(notes.length, c.expect.notes);
    assert.deepEqual(reviews.map(({ id, kind, reason, candidateIds }) => ({ id, kind, reason, candidateIds })), c.expect.reviews);
  });
}

test("body extraction matches the Python tracker", async () => {
  const { toMailMessage } = await import("../lib/mail-message.ts");
  for (const c of CASES.bodies) {
    const msg = await toMailMessage(new TextEncoder().encode(c.raw));
    assert.equal(msg.sender, c.sender);
    assert.equal(msg.subject, c.subject);
    const body = msg.body.replace(/\s+/g, " ");
    for (const text of c.contains) assert.ok(body.includes(text), text);
    for (const text of c.excludes) assert.ok(!body.includes(text), text);
  }
});
