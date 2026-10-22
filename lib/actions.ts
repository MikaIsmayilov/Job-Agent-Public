export const actionKinds = ["Assessment", "Interview", "Documents", "Follow-up", "Other"] as const;
export type ApplicationAction = { id: string; jobId: string; title: string; kind: string; dueDate: string; url: string; notes: string; completed: boolean; createdAt: string };
export function validateAction(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Provide an action.");
  const v = value as Record<string, unknown>;
  const field = (name: string, max: number) => {
    if (v[name] !== undefined && typeof v[name] !== "string") throw new Error(`Invalid ${name}.`);
    const s = ((v[name] as string) || "").trim();
    if (s.length > max) throw new Error(`${name} is too long.`);
    return s;
  };
  const jobId = field("jobId", 100), title = field("title", 200), kind = field("kind", 30);
  const dueDate = field("dueDate", 10), url = field("url", 2000), notes = field("notes", 4000);
  if (!jobId || !title) throw new Error("Choose an application and enter an action.");
  if (!actionKinds.includes(kind as typeof actionKinds[number])) throw new Error("Choose a valid action type.");
  if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate)) throw new Error("Enter a valid deadline.");
  if (url) { let parsed: URL; try { parsed = new URL(url); } catch { throw new Error("Enter a valid link."); } if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Use an http or https link without credentials."); }
  return { jobId, title, kind, dueDate, url, notes };
}
export function dueLabel(date: string, today: string) {
  if (!date) return "No deadline";
  if (date < today) return "Overdue";
  if (date === today) return "Due today";
  return `Due ${new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}
