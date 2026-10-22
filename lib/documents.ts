export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;

export const DOCUMENT_CONTENT_TYPES: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  md: "text/markdown",
  txt: "text/plain",
};

export type DocumentUpload = {
  jobId: string;
  filename: string;
  contentType: string;
  dataBase64: string;
};

export function validateDocumentUpload(body: unknown): { upload?: DocumentUpload; error?: string } {
  if (!body || typeof body !== "object") return { error: "Body must be a JSON object." };
  const data = body as Record<string, unknown>;
  if (typeof data.jobId !== "string" || !data.jobId.trim()) return { error: "jobId is required." };
  if (typeof data.filename !== "string" || !/^[\w][\w .()-]{0,120}$/.test(data.filename)) {
    return { error: "filename is required and must be a plain file name." };
  }
  const extension = data.filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = DOCUMENT_CONTENT_TYPES[extension];
  if (!contentType) return { error: `Unsupported file type ".${extension}".` };
  if (typeof data.dataBase64 !== "string" || !data.dataBase64) return { error: "dataBase64 is required." };
  if (!/^[A-Za-z0-9+/=]+$/.test(data.dataBase64)) return { error: "dataBase64 must be base64." };
  const approximateBytes = Math.floor(data.dataBase64.length * 0.75);
  if (approximateBytes > MAX_DOCUMENT_BYTES) return { error: "File exceeds the 4 MB limit." };
  return {
    upload: {
      jobId: data.jobId.trim(),
      filename: data.filename,
      contentType,
      dataBase64: data.dataBase64,
    },
  };
}
