// Cloud mail check, run by the Worker's cron trigger (deploy.cloudflare.json).
// Same rules as the local launchd check (scraper mailtracker.py, shared cases
// in tests/fixtures/mail-cases.json) and the same Gmail app password, set as
// Worker secrets GMAIL_ADDRESS / GMAIL_APP_PASSWORD
// (scripts/push-mail-secrets.sh). Each run reports with summary.cloud = 1; the
// local check skips while those reports are recent, and takes over by itself
// when they stop (for example if Workers Paid lapses and this exceeds Free CPU).
import { connect } from "cloudflare:sockets";
import { recordRun } from "../db/agent-runs";
import { listTrackedJobs, updateJobStatus } from "../db/jobs";
import { ImapSession } from "../lib/imap.ts";
import { toMailMessage } from "../lib/mail-message.ts";
import { evaluateMessages, type MailMessage } from "../lib/mail-tracker.ts";

const DAYS = 3;
const MAX_MESSAGES = 200;

type MailEnv = { GMAIL_ADDRESS?: string; GMAIL_APP_PASSWORD?: string };

export async function runCloudMail(env: MailEnv): Promise<void> {
  if (!env.GMAIL_ADDRESS || !env.GMAIL_APP_PASSWORD) {
    console.log("[mail] skipped: GMAIL_ADDRESS and GMAIL_APP_PASSWORD are not set as Worker secrets");
    return;
  }
  const tracked = await listTrackedJobs();
  if (!tracked.length) {
    await recordRun({ kind: "mail", ok: true, summary: { cloud: 1, scanned: 0, tracked: 0 }, reviews: [] });
    return;
  }

  let messages: MailMessage[];
  try {
    messages = await fetchMessages(env.GMAIL_ADDRESS, env.GMAIL_APP_PASSWORD);
  } catch (error) {
    console.log(`[mail] fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    await recordRun({ kind: "mail", ok: false, summary: { cloud: 1, tracked: tracked.length }, reviews: [] });
    return;
  }

  const { updates, notes, reviews } = await evaluateMessages(messages, tracked);
  for (const { job, status } of updates.values()) {
    console.log(`[mail] setting ${status.toUpperCase()}: ${job.title.slice(0, 50)} @ ${job.company}`);
    await updateJobStatus(job.id, status);
  }
  for (const note of notes) console.log(`[mail] ${note}`);
  await recordRun({
    kind: "mail",
    ok: true,
    summary: { cloud: 1, scanned: messages.length, tracked: tracked.length, updates: updates.size, reviews: reviews.length },
    reviews,
  });
}

async function fetchMessages(address: string, password: string): Promise<MailMessage[]> {
  const socket = connect({ hostname: "imap.gmail.com", port: 993 }, { secureTransport: "on" });
  const session = new ImapSession(socket);
  try {
    await session.greeting();
    await session.login(address, password);
    const raw = await session.recentMessages(new Date(Date.now() - DAYS * 86_400_000), MAX_MESSAGES);
    const messages: MailMessage[] = [];
    for (const bytes of raw) {
      try {
        messages.push(await toMailMessage(bytes));
      } catch {
        // One malformed message must not sink the run.
      }
    }
    return messages;
  } finally {
    await session.logout();
    socket.close().catch(() => {});
  }
}
