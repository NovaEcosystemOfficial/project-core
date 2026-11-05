import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { AppError } from "../errors/app-error.ts";
import {
  DDT_ALLOWED_MIME,
  DDT_MAX_FILE_BYTES,
  type DdtAllowedMime,
} from "../../shared/ddt.ts";

export type DetectedDdtFile = {
  buffer: Buffer;
  mimeType: DdtAllowedMime;
  sha256: string;
  byteSize: number;
  originalFileName: string;
};

function sniffMime(buffer: Buffer): DdtAllowedMime | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("utf8") === "%PDF-") {
    return "application/pdf";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function sanitizeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-()+\s]/g, "_").trim();
  return base.slice(0, 120) || "documento";
}

export function getDdtOriginalsRoot(): string {
  return path.join(app.getPath("userData"), "ddt-originals");
}

export function resolveDdtAbsolutePath(relativePath: string): string {
  const root = path.resolve(getDdtOriginalsRoot());
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw AppError.validation("Percorso documento non valido.");
  }
  return absolute;
}

export function readAndValidateDdtFile(
  absoluteSourcePath: string,
): DetectedDdtFile {
  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(absoluteSourcePath);
  } catch {
    throw AppError.validation("Impossibile leggere il file selezionato.");
  }
  if (buffer.length === 0) {
    throw AppError.validation("Il file è vuoto.");
  }
  if (buffer.length > DDT_MAX_FILE_BYTES) {
    throw AppError.validation(
      `File troppo grande (max ${Math.floor(DDT_MAX_FILE_BYTES / (1024 * 1024))} MB).`,
    );
  }
  const mimeType = sniffMime(buffer);
  if (!mimeType || !(DDT_ALLOWED_MIME as readonly string[]).includes(mimeType)) {
    throw AppError.validation(
      "Formato non supportato. Usa PDF, JPEG, PNG o WebP (contenuto reale, non solo estensione).",
    );
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  return {
    buffer,
    mimeType,
    sha256,
    byteSize: buffer.length,
    originalFileName: sanitizeFileName(absoluteSourcePath),
  };
}

export function storeDdtOriginal(params: {
  documentId: string;
  detected: DetectedDdtFile;
}): { relativePath: string; absolutePath: string } {
  const dir = path.join(getDdtOriginalsRoot(), params.documentId);
  fs.mkdirSync(dir, { recursive: true });
  const ext =
    params.detected.mimeType === "application/pdf"
      ? ".pdf"
      : params.detected.mimeType === "image/png"
        ? ".png"
        : params.detected.mimeType === "image/webp"
          ? ".webp"
          : ".jpg";
  const fileName = `${randomUUID()}${ext}`;
  const absolutePath = path.join(dir, fileName);
  if (fs.existsSync(absolutePath)) {
    throw AppError.internal("Collisione nome file documento.");
  }
  fs.writeFileSync(absolutePath, params.detected.buffer);
  const relativePath = path.join(params.documentId, fileName);
  return { relativePath: relativePath.replace(/\\/g, "/"), absolutePath };
}

export function newDdtId(): string {
  return randomUUID();
}
