import PostalMime from "postal-mime";
import type { MailMessage } from "./mail-tracker.ts";

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", lt: "<", gt: ">" };

/** Visible text of an HTML part. Kept in step with html_to_text in scraper mailtracker.py. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Raw RFC 822 bytes -> the {sender, subject, body} shape the tracker reads,
 * decoded the way the Python tracker decodes IMAP mail: the From header as
 * written (so review ids match), and the plain-text part plus the HTML part's
 * text (LinkedIn puts the decision only in the HTML part).
 */
export async function toMailMessage(raw: Uint8Array): Promise<MailMessage> {
  const email = await PostalMime.parse(raw);
  const from = email.headers.find((h) => h.key === "from")?.value ?? "";
  const body = [email.text ?? "", email.html ? htmlToText(email.html) : ""].filter(Boolean).join("\n");
  return { sender: from, subject: email.subject ?? "", body };
}
