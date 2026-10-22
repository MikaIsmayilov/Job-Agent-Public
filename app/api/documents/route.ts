import { env } from "cloudflare:workers";
import { getDocument, listDocuments, saveDocument } from "../../../db/documents";
import { validateDocumentUpload } from "../../../lib/documents";

export const runtime = "edge";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const jobId = url.searchParams.get("job");

    if (jobId) {
      return Response.json({ documents: await listDocuments(jobId) });
    }
    if (!id) return Response.json({ error: "Provide ?id= to download or ?job= to list." }, { status: 400 });

    const document = await getDocument(id);
    if (!document) return Response.json({ error: "Document not found." }, { status: 404 });

    const binary = Uint8Array.from(atob(document.dataBase64), (char) => char.charCodeAt(0));
    return new Response(binary, {
      headers: {
        "content-type": document.contentType,
        "content-length": String(binary.byteLength),
        "content-disposition": `attachment; filename="${document.filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Download failed." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const token = env.INGEST_TOKEN;
  if (!token || request.headers.get("x-ingest-token") !== token) {
    return Response.json({ error: "Invalid or missing ingest token." }, { status: 401 });
  }
  try {
    const { upload, error } = validateDocumentUpload(await request.json());
    if (!upload) return Response.json({ error }, { status: 400 });
    const meta = await saveDocument(upload);
    return Response.json({ document: meta }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload failed." }, { status: 500 });
  }
}
