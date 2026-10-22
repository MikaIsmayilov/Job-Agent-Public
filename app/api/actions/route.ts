import { completeAction, listActions, saveAction } from "../../../db/actions";
import { getJob } from "../../../db/jobs";
import { validateAction } from "../../../lib/actions.ts";
export const runtime = "edge";
export async function GET() {
  try { return Response.json({ actions: await listActions() }); }
  catch { return Response.json({ error: "Could not load pending actions." }, { status: 500 }); }
}
async function write(request: Request, edit: boolean) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") throw new Error("Provide an action.");
    if (edit && (typeof body.id !== "string" || !body.id)) throw new Error("Action ID is required.");
    if (edit && "completed" in body) {
      if (typeof body.completed !== "boolean") throw new Error("Invalid completion status.");
      if (!await completeAction(body.id, body.completed)) return Response.json({ error: "Action not found." }, { status: 404 });
    } else {
      const action = validateAction(body);
      if (!await getJob(action.jobId)) throw new Error("Application not found.");
      if (!await saveAction(action, edit ? body.id : undefined)) return Response.json({ error: "Action not found." }, { status: 404 });
    }
    return Response.json({ actions: await listActions() }, { status: edit ? 200 : 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not save action." }, { status: 400 }); }
}
export const POST = (request: Request) => write(request, false);
export const PATCH = (request: Request) => write(request, true);
