import { env } from "cloudflare:workers";
import { recordRun, resolveReview, runStatus } from "../../../db/agent-runs";
import { validateRunReport } from "../../../lib/agent-runs.ts";

export const runtime = "edge";

export async function GET() {
  try {
    return Response.json(await runStatus());
  } catch {
    return Response.json({ error: "Could not load run status." }, { status: 500 });
  }
}

// The scheduled scrape and mail check report here, with the ingest token.
export async function POST(request: Request) {
  const token = env.INGEST_TOKEN;
  if (!token || request.headers.get("x-ingest-token") !== token) {
    return Response.json({ error: "Invalid or missing ingest token." }, { status: 401 });
  }
  try {
    const report = validateRunReport(await request.json());
    await recordRun(report);
    return Response.json({ ok: true, reviews: report.reviews.length }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not record run." }, { status: 400 });
  }
}

// The dashboard closes a mail review once the user has picked the role (or dismissed it).
export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { reviewId?: unknown; resolution?: unknown };
    if (typeof body.reviewId !== "string" || typeof body.resolution !== "string" || !body.resolution) {
      return Response.json({ error: "Provide reviewId and resolution." }, { status: 400 });
    }
    if (!(await resolveReview(body.reviewId, body.resolution))) return Response.json({ error: "Review not found." }, { status: 404 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Could not resolve review." }, { status: 500 });
  }
}
