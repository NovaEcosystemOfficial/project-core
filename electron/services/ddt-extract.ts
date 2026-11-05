import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { AppError } from "../errors/app-error.ts";
import { DDT_MAX_PAGES, type DdtAllowedMime } from "../../shared/ddt.ts";
import { parseDdtText, type ParsedDdtDocument } from "./ddt-parser.ts";
import { configurePdfJsWorker } from "./pdfjs-worker.ts";

const require = createRequire(import.meta.url);

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    configurePdfJsWorker(pdfjs);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.internal(
      "Impossibile configurare il worker PDF.js per l'estrazione DDT.",
      error,
    );
  }
  return pdfjs;
}

export type DdtExtractionResult = {
  parsed: ParsedDdtDocument;
  strategy: "native_text" | "ocr";
  pageCount: number;
  ocrUsed: boolean;
  message: string | null;
  /** Raw rebuilt text kept for diagnostics (not shown as HTML). */
  rawText: string;
};

const MIN_NATIVE_TEXT_CHARS = 40;
/** Horizontal gap (PDF units) treated as a column separator → double space. */
const COLUMN_GAP = 12;
/** Vertical tolerance when grouping items into the same text line. */
const LINE_Y_TOLERANCE = 3.5;

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  hasEOL?: boolean;
};

/** Strip decorative markup sometimes embedded in generated test PDFs. */
export function stripPdfMarkup(text: string): string {
  return text
    .replace(/<\/?b>/gi, "")
    .replace(/<\/?strong>/gi, "")
    .replace(/<\/?i>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

/**
 * Rebuild readable lines from pdf.js text items using Y/X coordinates.
 * Large horizontal gaps become multi-space column separators for the parser.
 */
export function textContentToLines(items: PdfTextItem[]): string {
  type Piece = { x: number; y: number; endX: number; str: string; hasEOL: boolean };
  const pieces: Piece[] = [];
  for (const item of items) {
    if (!item || typeof item.str !== "string") {
      continue;
    }
    const raw = item.str;
    if (raw.length === 0) {
      continue;
    }
    const transform = item.transform;
    const x = Array.isArray(transform) ? Number(transform[4]) || 0 : 0;
    const y = Array.isArray(transform) ? Number(transform[5]) || 0 : 0;
    const width = typeof item.width === "number" ? item.width : 0;
    pieces.push({
      x,
      y,
      endX: x + Math.max(width, 0),
      str: raw,
      hasEOL: Boolean(item.hasEOL),
    });
  }
  if (pieces.length === 0) {
    return "";
  }

  // PDF Y grows upward — sort top-to-bottom, then left-to-right.
  pieces.sort((a, b) => (b.y !== a.y ? b.y - a.y : a.x - b.x));

  const rows: Piece[][] = [];
  let currentY = pieces[0].y;
  let current: Piece[] = [];
  for (const piece of pieces) {
    if (Math.abs(piece.y - currentY) > LINE_Y_TOLERANCE) {
      rows.push(current);
      current = [piece];
      currentY = piece.y;
    } else {
      current.push(piece);
    }
  }
  if (current.length) {
    rows.push(current);
  }

  const lines = rows.map((row) => {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    let line = "";
    let prevEnd = Number.NEGATIVE_INFINITY;
    for (const piece of ordered) {
      const gap = piece.x - prevEnd;
      if (line.length === 0) {
        line = piece.str;
      } else if (gap >= COLUMN_GAP) {
        line += `  ${piece.str}`;
      } else if (
        gap > 1 &&
        !/\s$/.test(line) &&
        !/^\s/.test(piece.str)
      ) {
        line += ` ${piece.str}`;
      } else {
        line += piece.str;
      }
      prevEnd = Math.max(prevEnd, piece.endX);
    }
    return stripPdfMarkup(line).replace(/[ \t]+\n/g, "\n").trimEnd();
  });

  return lines
    .map((line) => line.replace(/[ \t]{3,}/g, "  ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

async function extractPdfText(absolutePath: string): Promise<{
  text: string;
  pageCount: number;
}> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(fs.readFileSync(absolutePath));
  let pdf;
  try {
    const loadingTask = pdfjs.getDocument({
      data,
      useSystemFonts: true,
    });
    pdf = await loadingTask.promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/fake worker|workerSrc|pdf\.worker/i.test(message)) {
      throw AppError.internal(
        `Estrazione PDF non riuscita: worker PDF.js non disponibile (${message}).`,
        error,
      );
    }
    throw AppError.validation(
      `PDF non leggibile o corrotto: ${message}`,
      error,
    );
  }
  if (pdf.numPages > DDT_MAX_PAGES) {
    throw AppError.validation(
      `Il PDF ha troppe pagine (max ${DDT_MAX_PAGES}).`,
    );
  }
  const parts: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    parts.push(textContentToLines(content.items as PdfTextItem[]));
  }
  return { text: parts.join("\n"), pageCount: pdf.numPages };
}

function resolveTessLangPath(): string | null {
  const candidates = [
    path.join(process.resourcesPath ?? "", "tessdata"),
    path.join(process.cwd(), "resources", "tessdata"),
    path.join(process.cwd(), "electron", "tessdata"),
  ];
  for (const dir of candidates) {
    const ita = path.join(dir, "ita.traineddata");
    if (fs.existsSync(ita)) {
      return dir;
    }
  }
  return null;
}

async function ocrImageBuffer(
  buffer: Buffer,
): Promise<{ text: string; message: string | null }> {
  const langPath = resolveTessLangPath();
  if (!langPath) {
    return {
      text: "",
      message:
        "Dati lingua Tesseract (ita.traineddata) non trovati in resources/tessdata. OCR non eseguito.",
    };
  }

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("ita", 1, {
    langPath: pathToFileURL(langPath).href,
    cachePath: langPath,
    gzip: false,
  });
  try {
    const {
      data: { text },
    } = await worker.recognize(buffer);
    return { text: stripPdfMarkup(text ?? ""), message: null };
  } finally {
    await worker.terminate();
  }
}

async function ocrPdfPages(absolutePath: string): Promise<{
  text: string;
  pageCount: number;
  message: string | null;
}> {
  const langPath = resolveTessLangPath();
  if (!langPath) {
    return {
      text: "",
      pageCount: 0,
      message:
        "Dati lingua Tesseract (ita.traineddata) non trovati. Impossibile OCR su PDF scansionato.",
    };
  }

  type CanvasFactory = (w: number, h: number) => {
    width: number;
    height: number;
    getContext: (type: string) => unknown;
    toBuffer: (mime?: string) => Buffer;
  };
  let canvasFactory: CanvasFactory | null;
  try {
    const canvasMod = require("canvas") as { createCanvas: CanvasFactory };
    canvasFactory = canvasMod.createCanvas;
  } catch {
    canvasFactory = null;
  }

  if (!canvasFactory) {
    const { text, pageCount } = await extractPdfText(absolutePath);
    return {
      text,
      pageCount,
      message:
        "OCR PDF scansionato richiede il modulo opzionale 'canvas' per il render pagine. Usa un PDF testuale o un'immagine.",
    };
  }

  const renderPage = canvasFactory;
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(fs.readFileSync(absolutePath));
  const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  if (pdf.numPages > DDT_MAX_PAGES) {
    throw AppError.validation(
      `Il PDF ha troppe pagine (max ${DDT_MAX_PAGES}).`,
    );
  }

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("ita", 1, {
    langPath: pathToFileURL(langPath).href,
    cachePath: langPath,
    gzip: false,
  });
  const parts: string[] = [];
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = renderPage(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height),
      );
      const context = canvas.getContext("2d");
      await page.render({
        canvasContext: context as never,
        viewport,
      }).promise;
      const png = canvas.toBuffer("image/png");
      const {
        data: { text },
      } = await worker.recognize(png);
      parts.push(stripPdfMarkup(text ?? ""));
    }
  } finally {
    await worker.terminate();
  }
  return { text: parts.join("\n"), pageCount: pdf.numPages, message: null };
}

/**
 * Progressive extraction: native PDF text first, OCR when needed.
 */
export async function extractDdtContent(params: {
  absolutePath: string;
  mimeType: DdtAllowedMime;
}): Promise<DdtExtractionResult> {
  if (params.mimeType === "application/pdf") {
    const native = await extractPdfText(params.absolutePath);
    if (native.text.replace(/\s+/g, "").length >= MIN_NATIVE_TEXT_CHARS) {
      return {
        parsed: parseDdtText(native.text, { source: "pdf_text" }),
        strategy: "native_text",
        pageCount: native.pageCount,
        ocrUsed: false,
        message: null,
        rawText: native.text,
      };
    }
    const ocr = await ocrPdfPages(params.absolutePath);
    const text = ocr.text || native.text;
    const parsed = parseDdtText(text, {
      source: ocr.text ? "ocr" : "pdf_text",
    });
    if (ocr.message) {
      parsed.warnings.push(ocr.message);
    }
    return {
      parsed,
      strategy: ocr.text ? "ocr" : "native_text",
      pageCount: ocr.pageCount || native.pageCount,
      ocrUsed: Boolean(ocr.text),
      message: ocr.message,
      rawText: text,
    };
  }

  const buffer = fs.readFileSync(params.absolutePath);
  const ocr = await ocrImageBuffer(buffer);
  const parsed = parseDdtText(ocr.text, { source: "ocr" });
  if (ocr.message) {
    parsed.warnings.push(ocr.message);
  }
  if (!ocr.text.trim()) {
    parsed.warnings.push(
      "Nessun testo estratto dall'immagine: inserimento manuale richiesto.",
    );
  }
  return {
    parsed,
    strategy: "ocr",
    pageCount: 1,
    ocrUsed: !ocr.message,
    message: ocr.message,
    rawText: ocr.text,
  };
}
