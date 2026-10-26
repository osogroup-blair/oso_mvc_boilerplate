/* eslint-disable no-control-regex -- Explicitly reject browser control characters. */
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { extname } from "node:path";
import { AppError } from "./AppError.js";

export const MAX_PUBLIC_UPLOAD_BYTES = 10 * 1024 * 1024;
const formats: Record<string, { mime: string; extensions: string[] }> = {
  jpg: { mime: "image/jpeg", extensions: [".jpg", ".jpeg"] },
  png: { mime: "image/png", extensions: [".png"] },
  gif: { mime: "image/gif", extensions: [".gif"] },
  webp: { mime: "image/webp", extensions: [".webp"] },
  pdf: { mime: "application/pdf", extensions: [".pdf"] },
  zip: { mime: "application/zip", extensions: [".zip"] },
  txt: { mime: "text/plain", extensions: [".txt"] },
};

export async function validatePublicUpload(buffer: Buffer, filename: string, mime: string, declaredSize: number) {
  if (!buffer.length || buffer.length > MAX_PUBLIC_UPLOAD_BYTES || declaredSize !== buffer.length) throw AppError.badRequest("Invalid upload size (maximum 10MB)");
  if (filename.length > 200 || /[\\/\u0000-\u001f\u007f]/.test(filename)) throw AppError.badRequest("Invalid filename");
  try {
    const detected = await fileTypeFromBuffer(buffer);
    let format = detected?.ext;
    if (!detected && mime === "text/plain") {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) || /<\s*[!/?a-z]/i.test(text)) throw AppError.badRequest("Active content is not allowed");
      format = "txt";
    }
    const rule = formats[format ?? ""];
    if (!rule || rule.mime !== mime || !rule.extensions.includes(extname(filename).toLowerCase())) throw AppError.badRequest("File contents, type and extension must agree");
    if (mime.startsWith("image/")) {
      // Decode all frames under a total pixel limit, strip metadata and trailing payloads.
      const image = sharp(buffer, { failOn: "warning", limitInputPixels: 16_000_000, animated: true });
      const metadata = await image.metadata();
      if ((metadata.pages ?? 1) > 100) throw AppError.badRequest("Too many image frames");
      const result = await image.toFormat(format === "jpg" ? "jpeg" : format as "png" | "gif" | "webp").toBuffer();
      if (result.length > MAX_PUBLIC_UPLOAD_BYTES) throw AppError.badRequest("Processed image is too large");
      return { buffer: result, mimeType: rule.mime, extension: format!, size: result.length };
    }
    if (format === "pdf" && (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-")) || !/%%EOF\s*$/.test(buffer.subarray(-1024).toString("latin1")))) throw AppError.badRequest("Invalid PDF");
    if (format === "zip" && buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) < Math.max(0, buffer.length - 65557)) throw AppError.badRequest("Invalid ZIP directory");
    return { buffer, mimeType: rule.mime, extension: format!, size: buffer.length };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw AppError.badRequest("Invalid or unsupported file contents");
  }
}

/** Safe at all public aliases, including old objects that bypass new validation. */
export function publicObjectHeaders(filename: string) {
  const raster = /^[a-f0-9-]{36}\.(?:png|jpg|gif|webp)$/i.test(filename);
  const extension = extname(filename).toLowerCase();
  const types: Record<string, string> = raster
    ? { ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" }
    : { ".pdf": "application/pdf", ".zip": "application/zip", ".txt": "text/plain; charset=utf-8" };
  return {
    "Content-Type": types[extension] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
    "Content-Disposition": raster ? "inline" : "attachment",
  };
}
