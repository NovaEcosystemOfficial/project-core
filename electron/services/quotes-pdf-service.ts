import { BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { AppError } from "../errors/app-error.ts";
import { getDatabase } from "../db/connection.ts";
import { findQuoteById } from "../repositories/quotes-repository.ts";
import { readCompanyProfile } from "../repositories/company-profile-repository.ts";
import { parseQuoteIdInput } from "../../shared/quotes.ts";
import type { QuotePdfExportResult } from "../../shared/quote-pdf.ts";
import { buildQuoteDocumentHtml } from "./quote-document-html.ts";
import {
  buildQuotePdfBaseName,
  isPdfBuffer,
} from "./quote-document-format.ts";

function getDialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function mapWriteError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("enospc") || message.includes("no space")) {
    return AppError.internal("Spazio su disco insufficiente.", error);
  }
  if (
    message.includes("eacces") ||
    message.includes("eperm") ||
    message.includes("readonly")
  ) {
    return AppError.internal("Destinazione non scrivibile.", error);
  }
  return AppError.internal("Impossibile salvare il PDF.", error);
}

/**
 * Renders trusted HTML to a PDF buffer via a sandboxed, non-privileged window.
 * Exported for automated Electron render tests.
 */
export async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const win = new BrowserWindow({
    width: 900,
    height: 1200,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => {
      event.preventDefault();
    });

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await win.loadURL(dataUrl);

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      landscape: false,
      pageSize: "A4",
      preferCSSPageSize: true,
    });

    const buffer = Buffer.from(pdf);
    if (!isPdfBuffer(buffer)) {
      throw AppError.internal("La generazione PDF non ha prodotto un file valido.");
    }
    return buffer;
  } finally {
    if (!win.isDestroyed()) {
      win.close();
    }
  }
}

/**
 * Export quote PDF: load trusted quote + company profile, render, save via dialog.
 */
export async function exportQuotePdf(
  input: unknown,
): Promise<QuotePdfExportResult> {
  let id: string;
  try {
    id = parseQuoteIdInput(input);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Identificativo preventivo non valido.";
    throw AppError.validation(message, error);
  }

  const db = getDatabase();
  const quote = findQuoteById(db, id);
  if (!quote) {
    throw AppError.notFound("Preventivo non trovato.");
  }

  let profile;
  try {
    profile = readCompanyProfile(db);
  } catch (error) {
    throw AppError.internal("Impossibile leggere il profilo aziendale.", error);
  }

  const html = buildQuoteDocumentHtml(quote, profile);
  const defaultName = buildQuotePdfBaseName(quote.number);

  const parent = getDialogParent();
  const saveOptions = {
    title: "Esporta preventivo PDF",
    defaultPath: defaultName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"] as Array<
      "createDirectory" | "showOverwriteConfirmation"
    >,
  };
  const dialogResult = parent
    ? await dialog.showSaveDialog(parent, saveOptions)
    : await dialog.showSaveDialog(saveOptions);

  if (dialogResult.canceled || !dialogResult.filePath) {
    return { status: "cancelled" };
  }

  let targetPath = dialogResult.filePath;
  if (!targetPath.toLowerCase().endsWith(".pdf")) {
    targetPath = `${targetPath}.pdf`;
  }
  if (targetPath !== dialogResult.filePath && fs.existsSync(targetPath)) {
    throw AppError.conflict(
      "Esiste già un file con questo nome. Scegli un nome diverso.",
    );
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderHtmlToPdfBuffer(html);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw AppError.internal("Impossibile generare il PDF del preventivo.", error);
  }

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, pdfBuffer);
  } catch (error) {
    throw mapWriteError(error);
  }

  return {
    status: "completed",
    fileName: path.basename(targetPath),
  };
}

/** Test helper: write PDF for a quote id to an absolute path (no dialog). */
export async function exportQuotePdfToPathForTests(
  quoteId: string,
  destinationPath: string,
): Promise<void> {
  const db = getDatabase();
  const quote = findQuoteById(db, quoteId);
  if (!quote) {
    throw AppError.notFound("Preventivo non trovato.");
  }
  const profile = readCompanyProfile(db);
  const html = buildQuoteDocumentHtml(quote, profile);
  const pdfBuffer = await renderHtmlToPdfBuffer(html);
  fs.writeFileSync(destinationPath, pdfBuffer);
}
