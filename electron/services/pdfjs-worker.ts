import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AppError } from "../errors/app-error.ts";

const require = createRequire(import.meta.url);

export const PDFJS_WORKER_PACKAGE_ID =
  "pdfjs-dist/legacy/build/pdf.worker.mjs";

/**
 * Resolves pdf.js worker for Electron main / Node.
 * Prefer the installed package path; fall back to a sibling of the Electron
 * bundle (copied by scripts/build-electron.mjs).
 */
export function resolvePdfJsWorkerPath(): string {
  const candidates: string[] = [];

  try {
    candidates.push(require.resolve(PDFJS_WORKER_PACKAGE_ID));
  } catch {
    // package may be unavailable — try bundle sibling next
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  // Bundled main: electron/dist/main.js → sibling pdf.worker.mjs
  candidates.push(path.join(here, "pdf.worker.mjs"));
  // Source via tsx: electron/services/*.ts → electron/dist/pdf.worker.mjs
  candidates.push(path.join(here, "..", "dist", "pdf.worker.mjs"));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  throw AppError.internal(
    "Worker PDF.js (pdf.worker.mjs) non trovato. Verifica che pdfjs-dist sia installato e che la build Electron abbia copiato il worker in electron/dist/.",
  );
}

export function resolvePdfJsWorkerSrc(): string {
  return pathToFileURL(resolvePdfJsWorkerPath()).href;
}

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
};

let workerConfigured = false;

/**
 * Configures GlobalWorkerOptions.workerSrc once per process.
 * Must run before getDocument(); Node/Electron still loads the worker module
 * for the in-process "fake worker".
 *
 * Prefer an absolute file:// URL to the package worker so resolution does not
 * depend on the importer path (bundled main.js vs node_modules).
 */
export function configurePdfJsWorker(pdfjs: PdfJsModule): string {
  const workerPath = resolvePdfJsWorkerPath();
  const workerSrc = pathToFileURL(workerPath).href;
  // Always overwrite the pdf.js default (`./pdf.worker.mjs`).
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  workerConfigured = true;
  return workerSrc;
}

export function isPdfJsWorkerConfigured(): boolean {
  return workerConfigured;
}

/** Test helper: reset configuration flag between cases. */
export function resetPdfJsWorkerConfigForTests(): void {
  workerConfigured = false;
}
