// Splits a job description into the sections that matter for fit: what the
// employer requires, what they would merely like, what the job involves, and
// boilerplate (benefits, EEO, company blurb). Headings were surveyed from about
// a thousand real postings ("Qualifications", "Responsibilities", "Preferred
// qualifications", "Benefits", ...).

export type SectionKind = "required" | "preferred" | "duties" | "boilerplate" | "unknown";
export type Section = { kind: SectionKind; heading: string; lines: string[] };

// Order matters: "Preferred qualifications" is preferred, not required, and
// "Clearance required" is an eligibility blurb, not a skill list.
const HEADING_RULES: Array<[SectionKind, RegExp]> = [
  ["preferred", /prefer|nice to have|nice-to-have|bonus|\bplus\b|desired|desirable|ideally|extra credit|would be great/],
  ["boilerplate", /benefit|compensation|\bpay\b|salary|about us|about the company|who we are|company overview|our company|\bcompany\b|eeo|equal (?:employment )?opportunity|working conditions|work environment|physical|location|travel|additional information|perks|what we offer|why join|shift|job family|category|clearance|^li-|disclaimer|accommodation|how to apply|privacy|culture|our values|diversity|inclusion|inclusive|your journey|unsolicited|recruit|^about [a-z]/],
  ["required", /qualification|requirement|required|must[- ]have|what you(?:’|')?(?:ll| will)? (?:need|bring)|what you have|who you are|about you|you have|you bring|you(?:’|')?ll bring|looking for|ideal candidate|minimum|basic|skills|experience|education|competenc|certification|knowledge/],
  ["duties", /responsibilit|what you(?:’|')?(?:ll| will) do|in this role|the role|role overview|essential (?:functions|duties)|duties|day[- ]to[- ]day|job description|description|summary|overview|the opportunity|position|what you(?:’|')?ll be doing|key accountabilities|your impact|the job|contribute|you will|you(?:’|')ll/],
];

export function classifyHeading(heading: string): SectionKind | null {
  const text = heading.toLowerCase().replace(/[^a-z0-9’' &/+-]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > 60) return null;
  for (const [kind, pattern] of HEADING_RULES) if (pattern.test(text)) return kind;
  return null;
}

const MARKDOWN = /\\([\\`*_{}[\]()#+\-.!|&>~])/g;

function clean(line: string): string {
  return line.replace(MARKDOWN, "$1").replace(/\*\*/g, "").replace(/^#+\s*/, "").replace(/^\s*(?:[*\-•·]|\d+[.)])\s+/, "").trim();
}

/** A heading line, optionally followed by text on the same line ("**Requirements:** SQL, Python"). */
function headingOf(rawLine: string): { kind: SectionKind; heading: string; rest: string } | null {
  const line = rawLine.trim();
  // A bullet is content ("* Ability to travel as required"), never a heading.
  if (/^(?:[*\-•·]|\d+[.)])\s+(?!\*)/.test(line)) return null;
  const bold = line.match(/^\*\*([^*]{2,60}?)\*\*:?\s*(.*)$/);
  if (bold) {
    // An unrecognized bold heading ("The Team") still ends the previous
    // section, so its text is not misfiled as, say, boilerplate.
    const kind = classifyHeading(bold[1]) ?? (bold[2].trim() ? null : "unknown");
    return kind ? { kind, heading: bold[1].trim(), rest: bold[2] } : null;
  }
  const hash = line.match(/^#{1,4}\s+(.{2,60})$/);
  if (hash) {
    const kind = classifyHeading(hash[1]);
    return kind ? { kind, heading: hash[1].trim(), rest: "" } : null;
  }
  const colon = line.match(/^([A-Za-z][^.:!?]{1,58}):\s*(.*)$/);
  if (colon) {
    const kind = classifyHeading(colon[1]);
    return kind ? { kind, heading: colon[1].trim(), rest: colon[2] } : null;
  }
  // A short plain line that is exactly a known heading ("Qualifications").
  if (line.length <= 40 && !/[.!?]$/.test(line)) {
    const kind = classifyHeading(line);
    return kind ? { kind, heading: line, rest: "" } : null;
  }
  return null;
}

export function splitSections(raw: string): Section[] {
  const sections: Section[] = [{ kind: "unknown", heading: "", lines: [] }];
  for (const rawLine of raw.replace(/\r\n?/g, "\n").split("\n")) {
    if (!rawLine.trim()) continue;
    const heading = headingOf(rawLine);
    if (heading) {
      sections.push({ kind: heading.kind, heading: heading.heading, lines: [] });
      const rest = clean(heading.rest);
      if (rest) sections.at(-1)!.lines.push(rest);
      continue;
    }
    const text = clean(rawLine);
    if (text) sections.at(-1)!.lines.push(text);
  }
  return sections.filter((section) => section.lines.length);
}

/** Requirement items: one per line, long paragraphs split into sentences. */
export function requirementItems(sections: Section[]): string[] {
  return sections
    .filter((section) => section.kind === "required")
    .flatMap((section) => section.lines)
    .flatMap((line) => (line.length > 220 ? line.split(/(?<=[.;])\s+/) : [line]))
    .map((line) => line.trim())
    .filter((line) => line.length >= 8);
}
