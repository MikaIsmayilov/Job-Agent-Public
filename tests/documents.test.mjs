import assert from "node:assert/strict";
import test from "node:test";
import { validateDocumentUpload } from "../lib/documents.ts";

const valid = {
  jobId: "9615902a-867b-48d0-9a52-082b67bf3d95",
  filename: "Alex-Rivera-Resume.docx",
  dataBase64: Buffer.from("hello").toString("base64"),
};

test("accepts docx/pdf/md uploads and infers content type", () => {
  const docx = validateDocumentUpload(valid);
  assert.ok(docx.upload);
  assert.equal(docx.upload.contentType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.ok(validateDocumentUpload({ ...valid, filename: "resume.pdf" }).upload);
  assert.ok(validateDocumentUpload({ ...valid, filename: "REPORT.md" }).upload);
});

test("rejects bad uploads", () => {
  assert.ok(validateDocumentUpload(null).error);
  assert.ok(validateDocumentUpload({ ...valid, jobId: "" }).error);
  assert.ok(validateDocumentUpload({ ...valid, filename: "../../etc/passwd" }).error);
  assert.ok(validateDocumentUpload({ ...valid, filename: "malware.exe" }).error);
  assert.ok(validateDocumentUpload({ ...valid, dataBase64: "not base64!!" }).error);
  assert.ok(validateDocumentUpload({ ...valid, dataBase64: "A".repeat(6 * 1024 * 1024) }).error);
});
