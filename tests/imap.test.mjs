import test from "node:test";
import assert from "node:assert/strict";
import { ImapSession, imapDate } from "../lib/imap.ts";
import { toMailMessage } from "../lib/mail-message.ts";

const MESSAGE =
  'From: "PlayField" <no-reply@playfield.com>\r\n' +
  "Subject: =?UTF-8?B?VXBkYXRlIOKAkyBQbGF5RmllbGQ=?=\r\n" +
  'Content-Type: multipart/alternative; boundary="b"\r\n\r\n' +
  "--b\r\nContent-Type: text/html\r\n\r\n<p>Unfortunately&nbsp;we will not be moving forward.</p>\r\n--b--\r\n";

// A scripted IMAP server: answers each tagged command with canned lines,
// split into small chunks so literals straddle reads.
function fakeServer(script) {
  const sent = [];
  const enc = new TextEncoder();
  let push;
  const readable = new ReadableStream({
    start(controller) {
      push = (text) => {
        const bytes = enc.encode(text);
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
      };
      push("* OK Gimap ready\r\n");
    },
  });
  const writable = new WritableStream({
    write(chunk) {
      const line = new TextDecoder().decode(chunk).trimEnd();
      sent.push(line);
      const [tag, verb] = line.split(" ");
      push((script[verb] ?? ((t) => `${t} OK done\r\n`))(tag));
    },
  });
  return { stream: { readable, writable }, sent };
}

test("reads recent messages read-only, including literals split across chunks", async () => {
  const { stream, sent } = fakeServer({
    SEARCH: (t) => `* SEARCH 3 7 9\r\n${t} OK SEARCH completed\r\n`,
    FETCH: (t) =>
      `* 7 FETCH (BODY[]<0> {${Buffer.byteLength(MESSAGE)}}\r\n${MESSAGE})\r\n` +
      `* 9 FETCH (FLAGS (\\Seen))\r\n` +
      `${t} OK FETCH completed\r\n`,
  });
  const session = new ImapSession(stream);
  await session.greeting();
  await session.login("me@gmail.com", 'pa"ss word');
  const raw = await session.recentMessages(new Date(Date.UTC(2026, 9, 11)), 2);
  await session.logout();

  assert.equal(sent[0], 'A1 LOGIN "me@gmail.com" "pa\\"ss word"');
  assert.equal(sent[1], "A2 EXAMINE INBOX");
  assert.equal(sent[2], "A3 SEARCH SINCE 11-Oct-2026");
  // Only the newest `max` ids, fetched with PEEK so nothing is marked read.
  assert.equal(sent[3], "A4 FETCH 7,9 (BODY.PEEK[]<0.131072>)");
  assert.equal(raw.length, 1);

  const msg = await toMailMessage(raw[0]);
  assert.equal(msg.sender, '"PlayField" <no-reply@playfield.com>');
  assert.equal(msg.subject, "Update – PlayField");
  assert.match(msg.body, /Unfortunately we will not be moving forward\./);
  assert.doesNotMatch(msg.body, /<p>/);
});

test("a refused login throws without echoing the password", async () => {
  const { stream } = fakeServer({ LOGIN: (t) => `${t} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n` });
  const session = new ImapSession(stream);
  await session.greeting();
  await assert.rejects(session.login("me@gmail.com", "secret-app-password"), (error) => {
    assert.match(error.message, /IMAP LOGIN failed: NO \[AUTHENTICATIONFAILED\]/);
    assert.doesNotMatch(error.message, /secret-app-password/);
    return true;
  });
});

test("no recent mail means no FETCH", async () => {
  const { stream, sent } = fakeServer({ SEARCH: (t) => `* SEARCH\r\n${t} OK SEARCH completed\r\n` });
  const session = new ImapSession(stream);
  await session.greeting();
  assert.deepEqual(await session.recentMessages(new Date(), 200), []);
  assert.ok(!sent.some((line) => line.includes("FETCH")));
});

test("imapDate uses the IMAP day-month-year form", () => {
  assert.equal(imapDate(new Date(Date.UTC(2026, 0, 5))), "05-Jan-2026");
});
