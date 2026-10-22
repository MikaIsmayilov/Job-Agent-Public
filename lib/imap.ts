// Minimal read-only IMAP client for the cloud mail check: LOGIN, EXAMINE,
// SEARCH SINCE, FETCH BODY.PEEK[]. It works over any byte stream, so the
// Worker hands it a cloudflare:sockets TLS socket and tests hand it a fake
// server. The local check keeps using Python's imaplib (scraper mailtracker).

export type ByteStream = { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
type Untagged = { line: string; literals: Uint8Array[] };

// Partial fetch keeps a message with large attachments from blowing up memory;
// the text part comes first in practice.
const FETCH_BYTES = 131_072;

export class ImapSession {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buf = new Uint8Array(0);
  private tag = 0;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder("latin1");

  constructor(stream: ByteStream) {
    this.reader = stream.readable.getReader();
    this.writer = stream.writable.getWriter();
  }

  private async fill(): Promise<void> {
    const { value, done } = await this.reader.read();
    if (done) throw new Error("IMAP connection closed");
    const next = new Uint8Array(this.buf.length + value.length);
    next.set(this.buf);
    next.set(value, this.buf.length);
    this.buf = next;
  }

  private async readLine(): Promise<string> {
    for (;;) {
      const end = this.buf.findIndex((b, i) => b === 13 && this.buf[i + 1] === 10);
      if (end >= 0) {
        const line = this.decoder.decode(this.buf.subarray(0, end));
        this.buf = this.buf.slice(end + 2);
        return line;
      }
      await this.fill();
    }
  }

  private async readBytes(n: number): Promise<Uint8Array> {
    while (this.buf.length < n) await this.fill();
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }

  /** One server response line, with any {n} literals it carries. */
  private async readResponse(): Promise<Untagged> {
    let line = await this.readLine();
    const literals: Uint8Array[] = [];
    for (let m = line.match(/\{(\d+)\}$/); m; m = line.match(/\{(\d+)\}$/)) {
      literals.push(await this.readBytes(Number(m[1])));
      line = line.slice(0, -m[0].length) + "\u0000" + (await this.readLine());
    }
    return { line, literals };
  }

  async greeting(): Promise<void> {
    const { line } = await this.readResponse();
    if (!line.startsWith("* OK")) throw new Error(`IMAP greeting refused: ${line.slice(0, 80)}`);
  }

  /** Sends one command and returns its untagged responses; throws on NO/BAD. `label` replaces the command in errors. */
  async command(cmd: string, label = cmd): Promise<Untagged[]> {
    const tag = `A${++this.tag}`;
    await this.writer.write(this.encoder.encode(`${tag} ${cmd}\r\n`));
    const untagged: Untagged[] = [];
    for (;;) {
      const response = await this.readResponse();
      if (response.line.startsWith(`${tag} `)) {
        const status = response.line.slice(tag.length + 1);
        if (!status.startsWith("OK")) throw new Error(`IMAP ${label} failed: ${status.slice(0, 120)}`);
        return untagged;
      }
      untagged.push(response);
    }
  }

  async login(user: string, password: string): Promise<void> {
    await this.command(`LOGIN ${quote(user)} ${quote(password)}`, "LOGIN");
  }

  /** Raw RFC 822 bytes of the newest `max` INBOX messages since `since`, read-only (no \Seen flags set). */
  async recentMessages(since: Date, max: number): Promise<Uint8Array[]> {
    await this.command("EXAMINE INBOX");
    const search = await this.command(`SEARCH SINCE ${imapDate(since)}`);
    const ids = search.flatMap((r) => (r.line.startsWith("* SEARCH") ? r.line.slice(8).trim().split(/\s+/).filter(Boolean) : [])).slice(-max);
    if (!ids.length) return [];
    const fetched = await this.command(`FETCH ${ids.join(",")} (BODY.PEEK[]<0.${FETCH_BYTES}>)`, "FETCH");
    return fetched.filter((r) => / FETCH /.test(r.line) && r.literals.length).map((r) => r.literals[0]);
  }

  async logout(): Promise<void> {
    try {
      await this.command("LOGOUT");
    } catch {
      // The server may close the socket right after BYE.
    }
    try {
      await this.writer.close();
    } catch {
      // Already closed.
    }
  }
}

function quote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function imapDate(date: Date): string {
  return `${String(date.getUTCDate()).padStart(2, "0")}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}
