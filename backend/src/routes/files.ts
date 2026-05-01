import { Router } from "express";
import * as fs from "fs";
import {
  verifyFileToken,
  resolveStoragePath,
  buildContentDisposition,
  streamableExists,
} from "../lib/storage";

export const filesRouter = Router();

const EXT_CONTENT_TYPE: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function contentTypeFor(filename: string): string {
  const lower = filename.toLowerCase();
  for (const ext of Object.keys(EXT_CONTENT_TYPE)) {
    if (lower.endsWith(ext)) return EXT_CONTENT_TYPE[ext];
  }
  return "application/octet-stream";
}

// GET /files?t=<token>
//
// Pre-signed-URL replacement. The token bakes in the storage key + intended
// download filename. Auth-header–free so the URL can be used in <a href>
// or <iframe src>. Token TTL is short (1h) to limit replay.
filesRouter.get("/", (req, res) => {
  const token = req.query.t;
  if (typeof token !== "string" || !token) {
    return void res.status(400).json({ detail: "Missing token" });
  }
  let claim;
  try {
    claim = verifyFileToken(token);
  } catch (err) {
    return void res
      .status(401)
      .json({ detail: (err as Error).message || "Invalid token" });
  }
  if (!streamableExists(claim.key)) {
    return void res.status(404).json({ detail: "File not found" });
  }
  const abs = resolveStoragePath(claim.key);
  const filename = claim.filename ?? claim.key.split("/").pop() ?? "download";
  res.setHeader("Content-Type", contentTypeFor(filename));
  res.setHeader(
    "Content-Disposition",
    buildContentDisposition("inline", filename),
  );
  fs.createReadStream(abs).pipe(res);
});
