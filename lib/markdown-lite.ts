// Just enough markdown for scraped job descriptions: ATS exports arrive as
// "**Heading**" lines, "* " bullets, and backslash escapes ("\-", "\&"), which
// the detail panel used to print raw. Output is plain data that React renders
// as text, so nothing here can inject markup.

export type Segment = { text: string; bold: boolean };
export type Block = { kind: "heading" | "bullet" | "paragraph"; segments: Segment[] };

const BULLET = /^\s*(?:[*\-•·]|\d+[.)])\s+/;

export function unescapeMarkdown(text: string): string {
  return text.replace(/\\([\\`*_{}[\]()#+\-.!|&>~])/g, "$1");
}

/** Split one line into bold and plain runs on ** pairs; an unpaired ** stays literal. */
export function inlineSegments(line: string): Segment[] {
  const parts = line.split("**");
  if (parts.length % 2 === 0) parts[parts.length - 2] += "**" + parts.pop();
  const segments: Segment[] = [];
  parts.forEach((part, index) => {
    const text = unescapeMarkdown(part);
    if (!text) return;
    const bold = index % 2 === 1;
    const last = segments.at(-1);
    if (last && last.bold === bold) last.text += text;
    else segments.push({ text, bold });
  });
  return segments;
}

export function parseDescription(raw: string): Block[] {
  const blocks: Block[] = [];
  for (const rawLine of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (BULLET.test(line) && !/^\*\*/.test(line)) {
      blocks.push({ kind: "bullet", segments: inlineSegments(line.replace(BULLET, "")) });
      continue;
    }
    const segments = inlineSegments(line);
    // A short line that is entirely bold reads as a section heading.
    const heading = segments.length === 1 && segments[0].bold && segments[0].text.length <= 90;
    blocks.push({ kind: heading ? "heading" : "paragraph", segments: heading ? [{ text: segments[0].text.replace(/:$/, ""), bold: false }] : segments });
  }
  return blocks;
}

/** The one-line summary: bold runs kept, escapes removed, whitespace collapsed. */
export function summarySegments(summary: string): Segment[] {
  return inlineSegments(summary.replace(/\s+/g, " ").trim());
}
