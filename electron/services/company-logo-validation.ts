import { AppError } from "../errors/app-error.ts";
import {
  COMPANY_LOGO_MAX_BYTES,
  type CompanyLogoMimeType,
} from "../../shared/company-profile.ts";

/**
 * Detect image type from magic bytes — do not trust file extensions alone.
 */
export function detectImageMimeType(
  buffer: Buffer,
): CompanyLogoMimeType | null {
  if (buffer.length >= 8) {
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return "image/png";
    }
  }
  if (buffer.length >= 3) {
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return "image/jpeg";
    }
  }
  if (buffer.length >= 6) {
    const head = buffer.subarray(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") {
      return "image/gif";
    }
  }
  if (buffer.length >= 12) {
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    if (riff === "RIFF" && webp === "WEBP") {
      return "image/webp";
    }
  }
  return null;
}

export function validateCompanyLogoBuffer(buffer: Buffer): {
  mimeType: CompanyLogoMimeType;
  base64: string;
} {
  if (buffer.length === 0) {
    throw AppError.validation("Il file logo è vuoto.");
  }
  if (buffer.length > COMPANY_LOGO_MAX_BYTES) {
    throw AppError.validation(
      "Il logo supera la dimensione massima di 512 KB.",
    );
  }
  const mimeType = detectImageMimeType(buffer);
  if (!mimeType) {
    throw AppError.validation(
      "Formato logo non supportato. Usa PNG, JPEG, WebP o GIF.",
    );
  }
  return {
    mimeType,
    base64: buffer.toString("base64"),
  };
}
